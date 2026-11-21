'use strict';

const {isoDate,dateList}=require('../domain');
const {FullSyncError}=require('../full-sync');

// Pure DTO adapter for the observed SHOP_SCENE_DETAIL component only. No
// transport, sign/token handling, persistence, product mapping or SYCM override.
// Evidence: reference helper static protocol and 17 complete observed days on
// 2026-09-18. refundSceneId is constant across scenes; names are the scene keys.
const ORIGIN='https://h5api.m.taobao.com';
const API='mtop.com.taobao.voc.tmall.report.render';
const PATH=`/h5/${API}/1.0/`;
const COMPONENT_ID='REFUND_ANALYSIS_SHOP_SCENE_DETAIL';
const PAGE_SIZE=10;
const PRODUCT_COMPONENT_ID='REFUND_ANALYSIS_SHOP_PRODUCTS_DETAIL';
const PRODUCT_PAGE_SIZE=500,MAX_PRODUCT_ROWS=100000;
const SCENES=Object.freeze(['未发仅退','已发未收仅退','已收仅退','退货退款','其他']);
const SOURCE_KIND='voc-refund-scenes';
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message)=>{throw new FullSyncError(code,message);};

function requestOf({date,page=1}={}){
  isoDate(date);
  // The observed five fixed scene categories fit in the first ten-row page.
  // A new category count/pagination contract must be checked before expanding.
  if(page!==1)fail('REFUND_PAGE_MISMATCH','退款场景仅接入已核实的首页完整分类');
  return {date,page};
}
function buildRefundSceneRequest(input={}){
  const {date,page}=requestOf(input);
  return {origin:ORIGIN,path:PATH,method:'GET',api:API,version:'1.0',
    query:{jsv:'2.7.2',api:API,v:'1.0',componentId:COMPONENT_ID,params:'[object Object]',showToast:'true',type:'originaljson',dataType:'json'},
    data:{componentId:COMPONENT_ID,params:JSON.stringify({dateType:'1d',bizDate:date,current:page,pageSize:PAGE_SIZE})},
    headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:'https://voc.taobao.com/'}};
}
function checkSuccess(body){
  if(!record(body))fail('REFUND_INVALID_RESPONSE','退款场景后台响应结构无效');
  const ret=body.ret;
  const text=Array.isArray(ret)?ret.filter(value=>typeof value==='string').join(' '):typeof ret==='string'?ret:'';
  if(/USER_VALIDATE|RGV587|CAPTCHA|验证码|安全验证|封禁|访问受限|punish/i.test(text))fail('USER_VALIDATION_REQUIRED','退款场景后台要求验证或限制访问，本次读取已停止');
  if(/SESSION_EXPIRED|TOKEN_EXPIRED|TOKEN_EXOIRED|NEED_LOGIN|NOT_LOGIN|FAIL_SYS_LOGIN|请.*登录|登录失效|未登录/i.test(text))fail('LOGIN_EXPIRED','退款场景登录已失效，本次读取已停止');
  if(/FREQUENCY|THROTTL|RATE_LIMIT|频繁|限流|频率/i.test(text))fail('RATE_LIMITED','退款场景后台限制了读取频率，本次读取已停止');
  if(!Array.isArray(ret)||ret.length!==1||!['SUCCESS::Mtop','SUCCESS::调用成功'].includes(ret[0]))fail('REFUND_INVALID_RESPONSE','退款场景后台未明确返回成功');
  if(body.success===false||body.data?.success===false||body.errors!=null)fail('REFUND_INVALID_RESPONSE','退款场景后台同时返回失败或错误信息');
  if(body.api!==undefined&&body.api!==API)fail('REFUND_COMPONENT_MISMATCH','退款场景响应接口与请求不一致');
  if(body.v!==undefined&&body.v!=='1.0')fail('REFUND_COMPONENT_MISMATCH','退款场景响应版本与已核实版本不一致');
}
function amountOf(value){
  // Observed VOC amounts are explicit two-decimal strings. Retain them exactly;
  // do not add currency symbols, convert cents, accept ranges or fill missing 0.
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,13})\.\d{2}$/.test(value)||BigInt(value.replace('.',''))>BigInt(Number.MAX_SAFE_INTEGER))fail('REFUND_INVALID_AMOUNT','退款场景金额缺失或不是已核实的两位十进制金额');
  return value;
}
function countOf(value){
  if(!Number.isSafeInteger(value)||value<0||value>1000000000000)fail('REFUND_INVALID_COUNT','退款场景笔数缺失或不是有效非负整数');
  return value;
}
function rateOf(value,count,denominator){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,13})\.\d{2}%$/.test(value))fail('REFUND_INVALID_RATE','退款场景比例缺失或不是带百分号的两位百分数');
  const basisPoints=BigInt(value.slice(0,-1).replace('.',''));
  if(denominator===0){
    if(count!==0||basisPoints!==0n)fail('REFUND_RATE_MISMATCH','退款比例分母为零且后台比例无法核对');
  }else{
    // The 38 observed rows all match count / paidOrderCount, rounded half-up.
    // Past-order refunds can exceed today's denominator: do not cap at 100%.
    const numerator=BigInt(count)*10000n,base=BigInt(denominator);
    const expected=(numerator*2n+base)/(base*2n);
    if(basisPoints!==expected)fail('REFUND_RATE_MISMATCH','退款场景比例与该日支付订单笔数不一致');
  }
  return value;
}
function dateEcho(value,date){
  if(!record(value))return;
  for(const key of ['bizDate','date'])if(value[key]!==undefined&&value[key]!==date)fail('REFUND_DATE_MISMATCH','退款场景响应日期与请求不一致');
}
function parseRefundScenePage(body,input={}){
  const {date,page}=requestOf(input);checkSuccess(body);
  const data=body.data,source=data?.dataSource;
  if(!record(data)||!record(source)||!Array.isArray(source.data))fail('REFUND_INVALID_RESPONSE','退款场景后台缺少明确分类列表');
  for(const part of [data,source]){
    dateEcho(part,date);
    if(part.componentId!==undefined&&part.componentId!==COMPONENT_ID)fail('REFUND_COMPONENT_MISMATCH','后台返回了其他退款组件');
    if(part.current!==undefined&&part.current!==page||part.pageSize!==undefined&&part.pageSize!==PAGE_SIZE)fail('REFUND_PAGE_MISMATCH','退款场景响应分页与请求不一致');
  }
  if(!Number.isSafeInteger(source.total)||source.total<0||source.total>SCENES.length)fail('REFUND_INVALID_TOTAL','退款场景总数缺失或超出已核实的分类范围');
  if(source.data.length!==source.total)fail('REFUND_INCOMPLETE_ROWS','退款场景返回行数与明确总数不一致');
  if(source.hasNext!==undefined&&source.hasNext!==false)fail('REFUND_PAGE_MISMATCH','退款场景返回未完成的分页');
  const seen=new Set();let paidAmount=null,paidOrderCount=null;
  const rows=source.data.map(raw=>{
    if(!record(raw))fail('REFUND_INVALID_ROWS','退款场景明细不是有效对象');
    dateEcho(raw,date);
    const scene=raw.refundSceneName;
    if(!SCENES.includes(scene))fail('REFUND_UNKNOWN_SCENE','后台新增了未核实的退款场景分类');
    if(seen.has(scene))fail('REFUND_DUPLICATE_SCENE','同一天退款场景分类重复，不能重复累计');
    seen.add(scene);
    const baselineAmount=amountOf(raw.paidAmount),baselineCount=countOf(raw.paidOrderCount);
    if(paidAmount!==null&&(baselineAmount!==paidAmount||baselineCount!==paidOrderCount))fail('REFUND_DENOMINATOR_MISMATCH','同一天各退款场景的支付金额或笔数不一致');
    paidAmount=baselineAmount;paidOrderCount=baselineCount;
    const successRefundCount=countOf(raw.successRefundCount),refundInitiationCount=countOf(raw.refundInitiationCount);
    return {scene,successRefundCount,successRefundAmount:amountOf(raw.successRefundAmount),refundInitiationCount,refundInitiationAmount:amountOf(raw.refundInitiationAmount),
      refundRate:rateOf(raw.refundRate,successRefundCount,baselineCount),refundInitiationRate:rateOf(raw.refundInitiationRate,refundInitiationCount,baselineCount)};
  });
  return {sourceKind:SOURCE_KIND,scope:'shop-scene-day',date,dateEvidence:'request-bound',page,pageSize:PAGE_SIZE,total:source.total,hasNext:false,complete:true,
    amountUnit:'source-decimal',rateUnit:'percent',paidAmount,paidOrderCount,rows};
}
function assembleRefundSceneDays(entries,{start,end}={}){
  isoDate(start);isoDate(end);
  if(start>end||(Date.parse(end)-Date.parse(start))/86400000>=31)fail('REFUND_INVALID_RANGE','退款场景一次仅接受连续31天以内的日期区间');
  const expected=dateList(start,end);
  if(!Array.isArray(entries)||entries.length!==expected.length)fail('REFUND_INCOMPLETE_DAYS','退款场景原始返回没有覆盖全部所选日期');
  const byDate=new Map();
  for(const entry of entries){
    if(!record(entry)||!expected.includes(entry.date))fail('REFUND_DATE_MISMATCH','退款场景返回日期不属于所选区间');
    if(byDate.has(entry.date))fail('REFUND_DUPLICATE_DAY','退款场景日期重复，不能累计同一次返回');
    byDate.set(entry.date,parseRefundScenePage(entry.body,{date:entry.date}));
  }
  return {sourceKind:SOURCE_KIND,scope:'shop-scene-day',start,end,complete:true,days:expected.map(date=>byDate.get(date))};
}

function productRequestOf({date,page=1}={}){
  isoDate(date);
  if(!Number.isSafeInteger(page)||page<1||page>MAX_PRODUCT_ROWS/PRODUCT_PAGE_SIZE)fail('REFUND_PAGE_MISMATCH','商品退款页码无效或超过读取上限');
  return {date,page};
}
function buildProductRefundRequest(input={}){
  const {date,page}=productRequestOf(input),request=buildRefundSceneRequest({date});
  request.query.componentId=PRODUCT_COMPONENT_ID;
  request.data={componentId:PRODUCT_COMPONENT_ID,params:JSON.stringify({dateType:'1d',bizDate:date,current:page,pageSize:PRODUCT_PAGE_SIZE})};
  return request;
}
function productCountOf(value){
  // The helper's observed result uses strings; a direct official response uses
  // JSON integers. Accept both exact representations, never coercible blanks,
  // fractions, exponent strings or values outside the original count limit.
  if(typeof value==='number')return countOf(value);
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,12})$/.test(value))fail('REFUND_INVALID_COUNT','商品退款笔数缺失或不是有效的非负整数');
  return countOf(Number(value));
}
function productRateOf(value,count,denominator){
  // A refund may complete today for an order paid on a prior day. Zero paid
  // orders is a missing rate denominator, not zero successful refunds.
  if(denominator===0)return null;
  const numerator=BigInt(count)*10000n,base=BigInt(denominator),basisPoints=(numerator*2n+base)/(2n*base);
  if(basisPoints>BigInt(Number.MAX_SAFE_INTEGER))fail('REFUND_INVALID_RATE','商品退款比例超出精确数值范围');
  if(value!==undefined&&value!==null&&value!=='')rateOf(value,count,denominator);
  return Number(basisPoints)/100;
}
function parseProductRefundPage(body,input={}){
  const {date,page}=productRequestOf(input);checkSuccess(body);
  const data=body.data,source=data?.dataSource;
  if(!record(data)||!record(source)||!Array.isArray(source.data))fail('REFUND_INVALID_RESPONSE','商品退款后台缺少明确列表');
  for(const part of [data,source]){
    dateEcho(part,date);
    if(part.componentId!==undefined&&part.componentId!==PRODUCT_COMPONENT_ID)fail('REFUND_COMPONENT_MISMATCH','后台返回了其他退款组件');
    if(part.current!==undefined&&part.current!==page||part.pageSize!==undefined&&part.pageSize!==PRODUCT_PAGE_SIZE)fail('REFUND_PAGE_MISMATCH','商品退款响应分页与请求不一致');
  }
  const exactTotal=typeof source.total==='number'?Number.isSafeInteger(source.total)&&source.total>=0:typeof source.total==='string'&&/^(?:0|[1-9]\d{0,5})$/.test(source.total);
  if(!exactTotal||Number(source.total)>MAX_PRODUCT_ROWS)fail('REFUND_INVALID_TOTAL','商品退款总数缺失或不是有效的非负整数');
  const total=Number(source.total),pages=Math.max(1,Math.ceil(total/PRODUCT_PAGE_SIZE)),hasNext=page<pages;
  if(page>pages||source.hasNext!==undefined&&source.hasNext!==hasNext)fail('REFUND_PAGE_MISMATCH','商品退款分页状态与总数不一致');
  const expected=Math.min(PRODUCT_PAGE_SIZE,Math.max(0,total-(page-1)*PRODUCT_PAGE_SIZE));
  if(source.data.length!==expected)fail('REFUND_INCOMPLETE_ROWS','商品退款本页条数与总数不一致');
  const seen=new Set(),rows=source.data.map(raw=>{
    if(!record(raw))fail('REFUND_INVALID_ROWS','商品退款明细不是有效对象');
    dateEcho(raw,date);
    if(typeof raw.productId!=='string'||!/^[1-9]\d{4,19}$/.test(raw.productId))fail('REFUND_INVALID_PRODUCT','商品退款缺少有效商品标识');
    if(seen.has(raw.productId))fail('REFUND_DUPLICATE_PRODUCT','同页出现重复商品退款记录');
    seen.add(raw.productId);
    const successRefundCount=productCountOf(raw.successRefundCount),refundInitiationCount=productCountOf(raw.refundInitiationCount),paidOrderCount=productCountOf(raw.paidOrderCount);
    return {date,productId:raw.productId,successRefundCount,successRefundAmount:amountOf(raw.successRefundAmount),refundInitiationCount,refundInitiationAmount:amountOf(raw.refundInitiationAmount),
      paidOrderCount,paidAmount:amountOf(raw.paidAmount),refundRate:productRateOf(raw.refundRate,successRefundCount,paidOrderCount),refundInitiationRate:productRateOf(raw.refundInitiationRate,refundInitiationCount,paidOrderCount)};
  });
  return {sourceKind:'voc-product-refunds',scope:'product-refund-day',date,dateEvidence:'request-bound',page,pageSize:PRODUCT_PAGE_SIZE,total,hasNext,
    amountUnit:'source-decimal',rateUnit:'percent',population:'products-returned-by-refund-report',rows};
}
function assembleProductRefundPages(bodies,{date}={}){
  productRequestOf({date});
  if(!Array.isArray(bodies)||!bodies.length||bodies.length>MAX_PRODUCT_ROWS/PRODUCT_PAGE_SIZE)fail('REFUND_INCOMPLETE_PAGES','商品退款原始分页集合为空或超过上限');
  const pages=bodies.map((body,index)=>parseProductRefundPage(body,{date,page:index+1}));
  const total=pages[0].total,expected=Math.max(1,Math.ceil(total/PRODUCT_PAGE_SIZE));
  if(pages.length!==expected||pages.some(page=>page.total!==total))fail('REFUND_INCOMPLETE_PAGES','商品退款分页缺失或各页总数变化');
  const rows=[],seen=new Set();
  for(const page of pages)for(const row of page.rows){
    if(seen.has(row.productId))fail('REFUND_DUPLICATE_PRODUCT','不同分页出现重复商品退款记录');
    seen.add(row.productId);rows.push(row);
  }
  if(rows.length!==total)fail('REFUND_INCOMPLETE_ROWS','商品退款最终条数与明确总数不一致');
  return {sourceKind:'voc-product-refunds',scope:'product-refund-day',date,pageSize:PRODUCT_PAGE_SIZE,pages:pages.length,total,complete:true,
    amountUnit:'source-decimal',rateUnit:'percent',population:'products-returned-by-refund-report',rows};
}

module.exports={ORIGIN,API,PATH,COMPONENT_ID,PAGE_SIZE,SCENES,PRODUCT_COMPONENT_ID,PRODUCT_PAGE_SIZE,MAX_PRODUCT_ROWS,buildRefundSceneRequest,parseRefundScenePage,assembleRefundSceneDays,
  buildProductRefundRequest,parseProductRefundPage,assembleProductRefundPages};
