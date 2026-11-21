'use strict';

const {isoDate,identifier,normalizeSource}=require('../domain');
const {FullSyncError}=require('../full-sync');

// Fixed report descriptors and parsers. The range reader uses a separate
// transport that proves the current shop <-> advertiser binding on each call.
// The older injected one-page adapter below remains independently guarded.
// Request descriptors contain temporary anti-forgery parameters and MUST remain
// in main-process memory: never log, persist, export or return them through IPC.
const ORIGIN='https://one.alimama.com';
const PATH='/report/query.json';
const PAGE_SIZE=100,MAX_ROWS=100000;
const KINDS=Object.freeze(['item_promotion','site_cost_ratio']);
const FIELDS=Object.freeze({
  account:Object.freeze(['alipayInshopAmt','charge','cartInshopNum','adPv','click','roi','ctr','ecpc','alipayInshopNum','cvr','itemColInshopNum','shopColDirNum','colNum','itemColInshopCost']),
  item_promotion:Object.freeze(['adPv','click','charge','roi','ctr','ecpc','alipayInshopAmt','alipayInshopNum','cvr','cartInshopNum','itemColInshopNum','shopColDirNum','colNum','itemColInshopCost']),
  site_cost_ratio:Object.freeze(['adPv','click','ctr','cartDirNum','itemColDirNum','itemDirColCart','charge','trCostRatioNet','alipayDirAmtNet','prepayInshopAmt']),
});
const fail=(code,message)=>{throw new FullSyncError(code,message);};
function kindOf(value){if(!KINDS.includes(value))fail('PROMOTION_KIND','未确认的广告来源不能用于经营同步');return value;}
function pageOf(page){if(!Number.isSafeInteger(page)||page<1||page>MAX_ROWS/PAGE_SIZE)fail('INVALID_PAGE','广告页码超出已核实的读取范围');return page;}
function temporary(value,label,{optional=false}={}){
  if(optional&&(value===undefined||value===''))return '';
  if(typeof value!=='string'||!value||value.length>4096||/[\u0000-\u0020\u007f]/.test(value))fail('PROMOTION_CONTEXT',label+'不可用，请手动检查本店后台');
  return value;
}
function buildPromotionRequest({kind,date,page=1,csrfId,loginPointId}={}){
  if(kind!=='account')kind=kindOf(kind);isoDate(date);pageOf(page);
  csrfId=temporary(csrfId,'广告查询参数');loginPointId=temporary(loginPointId,'广告账户参数',{optional:true});
  if(kind==='account'){
    if(page!==1)fail('INVALID_PAGE','日报广告账户报表不支持分页');
    const body={bizCode:'universalBP',fromRealTime:false,source:'baseReport',startTime:date,endTime:date,
      unifyType:'zhai',effectEqual:15,splitType:'day',queryFieldIn:[...FIELDS.account],vsType:'off',vsTime:date,
      queryDomains:['date'],moduleSource:'foldLine',rptType:'account',csrfId};
    return {origin:ORIGIN,path:PATH,method:'POST',query:{csrfId,bizCode:'universalBP'},body:JSON.stringify(body),headers:{'Content-Type':'application/json','Referer':ORIGIN+'/index.html'}};
  }
  const bizCode=kind==='item_promotion'?'universalBP':'onebpSite';
  const body={fromRealTime:false,source:'baseReport',byPage:true,totalTag:true,needCountAccelerate:false,
    byPageWithoutCount:false,pageSize:PAGE_SIZE,offset:(page-1)*PAGE_SIZE,havingList:[],endTime:date,effectEqual:15,
    startTime:date,splitType:'day',queryDomains:['promotion'],csrfId,bizCode,rptType:kind,queryFieldIn:[...FIELDS[kind]]};
  const query={csrfId,bizCode};
  if(kind==='item_promotion'){
    query.lite2='false';Object.assign(body,{lite2:false,unifyType:'zhai',subPromotionTypes:['ITEM'],searchValue:'',searchKey:'itemIdOrName'});
  }else Object.assign(body,{activityType:'customActivity',unifyType:'real_whole_site',dataFlowId:'10786'});
  if(loginPointId)body.loginPointId=loginPointId;
  return {origin:ORIGIN,path:PATH,method:'POST',query,body:JSON.stringify(body),headers:{'Content-Type':'application/json','Referer':ORIGIN+'/index.html'}};
}
function record(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function responseProblem(body){
  const parts=[body,body?.info,body?.data?.info,body?.data?.data?.info].filter(record);
  const evidence=parts.flatMap(part=>['code','errorCode','message','msg','ret'].map(key=>Array.isArray(part[key])?part[key].filter(x=>typeof x==='string').join(' '):typeof part[key]==='string'?part[key]:'')).join(' ');
  if(/USER_VALIDATE|RGV587|CAPTCHA|验证码|安全验证|封禁|冻结|访问受限|punish/i.test(evidence))fail('USER_VALIDATION_REQUIRED','广告后台要求验证或限制了访问，本次同步已停止');
  if(/SESSION_EXPIRED|TOKEN_EXPIRED|TOKEN_EXOIRED|NEED_LOGIN|NOT_LOGIN|请.*登录|登录失效|未登录/i.test(evidence))fail('LOGIN_EXPIRED','广告后台登录已失效，本次同步已停止');
  if(/FREQUENCY|THROTTL|RATE_LIMIT|频繁|限流|频率/i.test(evidence))fail('RATE_LIMITED','广告后台限制了读取频率，本次同步已停止');
}
function totalOf(value){
  if(typeof value==='string'&&/^(?:0|[1-9]\d*)$/.test(value))value=Number(value);
  if(!Number.isSafeInteger(value)||value<0||value>MAX_ROWS)fail('INVALID_TOTAL','广告后台缺少明确总条数或超出读取上限，不能确认全量');
  return value;
}
function amount(value){
  if(value===null||value===undefined||value===''||value==='-'||value==='—'||value==='--')return null;
  if(typeof value==='number'&&(!Number.isFinite(value)||value<0))fail('INVALID_METRICS','广告金额格式无效，本次同步已停止');
  if(typeof value!=='number'&&typeof value!=='string')fail('INVALID_METRICS','广告金额格式无效，本次同步已停止');
  let text=String(value).trim();
  if(/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text))text=text.replace(/,/g,'');
  if(text.length>40||!/^\d+(?:\.\d+)?$/.test(text))fail('INVALID_METRICS','广告金额必须是精确数值，不能使用区间或缩写');
  const [whole,decimal='']=text.split('.');
  const cents=BigInt(whole)*100n+BigInt((decimal+'00').slice(0,2))+(decimal.length>2&&decimal[2]>='5'?1n:0n);
  if(cents>BigInt(Number.MAX_SAFE_INTEGER))fail('INVALID_METRICS','广告金额超出安全精度');
  return Number(cents)/100;
}
function productId(row){
  const candidates=[row.promotionId,row.itemId,row.item_id,row.materialId,row.material?.materialId,row.adgroupList?.[0]?.material?.materialId];
  const ids=[];
  for(const value of candidates){
    if(value===undefined||value===null||value==='')continue;
    if(typeof value==='number'&&!Number.isSafeInteger(value))fail('INVALID_PRODUCT','广告商品标识超出安全精度');
    if(typeof value!=='string'&&typeof value!=='number')fail('INVALID_PRODUCT','广告商品标识格式无效');
    const id=String(value).trim();if(!/^\d+$/.test(id)||/^0+$/.test(id)||id.length>128)continue;
    ids.push(id);
  }
  if(!ids.length)fail('INVALID_PRODUCT','广告明细缺少明确商品ID，不能丢弃该行后声明全量');
  if(new Set(ids).size>1)fail('AMBIGUOUS_PRODUCT','广告明细商品标识冲突，需要核对后台字段后再同步');
  return ids[0];
}
function reportData(body){
  if(!record(body))fail('INVALID_RESPONSE','广告后台返回格式无效，本次同步已停止');
  responseProblem(body);
  const info=body.info||body.data?.info||body.data?.data?.info;
  if(!record(info)||info.ok!==true||typeof info.message==='string'&&info.message.trim())fail('INVALID_RESPONSE','广告后台未明确返回成功，本次同步已停止');
  const data=body.data?.data||body.data;
  if(!record(data)||!Array.isArray(data.list))fail('INVALID_RESPONSE','广告后台缺少明细列表，不能确认全量');
  return data;
}
function accountId(value){
  if(typeof value==='number'&&!Number.isSafeInteger(value))fail('SOURCE_MISMATCH','广告账户ID超出安全精度');
  if((typeof value!=='number'&&typeof value!=='string')||!/^\d{1,30}$/.test(String(value))||/^0+$/.test(String(value)))fail('SOURCE_MISMATCH','广告报表缺少有效账户ID');
  return String(value);
}
function reportIdentity(row,{date,advertiserId,requireDates=false}){
  if(advertiserId!==undefined&&accountId(row.memberId)!==accountId(advertiserId))fail('SOURCE_MISMATCH','广告报表账户与当前店铺不一致');
  for(const key of ['thedate','startTime','endTime']){
    if(requireDates||row[key]!==undefined){if(row[key]!==date)fail('DATE_MISMATCH','广告报表日期与所选日期不一致');}
  }
}
function ratio(value){
  if(value===null||value===undefined||value===''||value==='-'||value==='—'||value==='--')return null;
  if(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value))value=Number(value);
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)fail('INVALID_METRICS','广告ROI不是可确认的精确数值');
  return value;
}
function parseAccountDay(body,{date,advertiserId}={}){
  isoDate(date);accountId(advertiserId);const data=reportData(body);
  if(data.list.length===0){
    // Verified September 16 response: successful account report with only an
    // empty list and no count. The request/transport supplies the bound date
    // and advertiser; do not turn the absence of a report into a zero report.
    const info=body.info||body.data?.info||body.data?.data?.info;
    if(Object.keys(data).some(key=>key!=='list')||['errorCode','redirectUrl','unlockUrl'].some(key=>info[key]!==undefined&&info[key]!==null&&info[key]!=='')||info.lockSla===true||info.disableTime===true||info.httpStatus!==undefined&&info.httpStatus!==null&&info.httpStatus!==200)fail('INVALID_RESPONSE','空广告日报响应尚未核实或包含异常状态，本次同步已停止');
    return {date,adSpend:null,adRevenue:null,adRoi:null,empty:true};
  }
  if(data.list.length!==1)fail('ROW_COUNT_MISMATCH','日报广告必须返回所选日的一条账户汇总，空结果不能补零');
  const row=data.list[0];if(!record(row))fail('INVALID_ROWS','日报广告汇总格式无效');
  reportIdentity(row,{date,advertiserId,requireDates:true});
  return {date,adSpend:amount(row.charge),adRevenue:amount(row.alipayInshopAmt),adRoi:ratio(row.roi)};
}
function parsePromotionPage(body,{kind,date,page=1,advertiserId}={}){
  kind=kindOf(kind);isoDate(date);pageOf(page);
  const data=reportData(body);
  if(advertiserId!==undefined){
    accountId(advertiserId);
    if(data.totalData!==undefined){
      if(!Array.isArray(data.totalData))fail('INVALID_RESPONSE','广告汇总结构无法确认');
      for(const total of data.totalData){if(!record(total))fail('INVALID_RESPONSE','广告汇总结构无法确认');reportIdentity(total,{date,advertiserId});}
    }
  }
  const total=totalOf(data.count),pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  if(page>pages)fail('PAGE_MISMATCH','广告页码超过后台总页数');
  const expected=Math.min(PAGE_SIZE,Math.max(0,total-(page-1)*PAGE_SIZE));
  if(data.list.length!==expected)fail('ROW_COUNT_MISMATCH','广告本页条数与总数不一致，本次全量同步已停止');
  const seen=new Set();
  const rows=data.list.map(row=>{
    if(!record(row))fail('INVALID_ROWS','广告明细格式无效');
    reportIdentity(row,{date,advertiserId});
    const id=productId(row);
    if(seen.has(id))fail('DUPLICATE_ROW','广告同页商品重复，需要核对报表粒度后再同步');seen.add(id);
    const title=typeof row.promotionName==='string'?row.promotionName:typeof row.itemName==='string'?row.itemName:'';
    if(title.length>600||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(title))fail('INVALID_ROWS','广告商品名称格式无效');
    return {date,productId:id,title,sourceKind:kind,adSpend:amount(row.charge),
      adRevenue:kind==='item_promotion'?amount(row.alipayInshopAmt):null,adRoi:kind==='item_promotion'?ratio(row.roi):null};
  });
  // Each source remains separate. In particular, site_cost_ratio's spend must
  // never become the denominator of item_promotion's revenue/ROI implicitly.
  return {kind,date,page,pageSize:PAGE_SIZE,total,hasNext:page<pages,rows};
}
function check(signal){if(signal?.aborted)fail('CANCELED','广告读取已取消，原完整数据保持不变');}
function verifiedContext(value,storeId){
  if(value?.blocked)fail('USER_VALIDATION_REQUIRED','广告页面出现验证或访问限制，本次同步已停止');
  if(!record(value)||value.storeId!==storeId||value.identityVerified!==true)fail('SOURCE_MISMATCH','尚未确认广告账户属于所选店铺，未发起广告请求');
  let source,advertiserId;
  try{source=normalizeSource(value.source);advertiserId=identifier(value.advertiserId,'广告账户ID');}
  catch{fail('SOURCE_MISMATCH','缺少广告账户与店铺的可信绑定，未发起广告请求');}
  if(!source.platformShopId)fail('SOURCE_MISMATCH','广告读取必须取得可信平台店铺ID');
  return {source,advertiserId,csrfId:temporary(value.csrfId,'广告查询参数'),loginPointId:temporary(value.loginPointId,'广告账户参数',{optional:true})};
}
function safeReadError(error){
  const codes={CANCELED:'广告读取已取消，原完整数据保持不变',USER_VALIDATION_REQUIRED:'广告后台要求安全验证，本次同步已停止',LOGIN_EXPIRED:'广告登录已失效，本次同步已停止',RATE_LIMITED:'广告后台限制了读取频率，本次同步已停止',SOURCE_MISMATCH:'广告账户或页面归属发生变化，本次同步已停止',REQUEST_TIMEOUT:'广告读取超时，本次同步已停止'};
  if(Object.hasOwn(codes,error?.code))fail(error.code,codes[error.code]);
  fail('REQUEST_FAILED','广告读取失败，本次同步已停止；详细响应未输出');
}
/**
 * Fixed-source, one-page adapter. readContext(storeId,signal) is a trusted main
 * process identity checker, never renderer input. readRequest(storeId,descriptor,
 * signal) must use that current store session and return {body,source}; it owns
 * timeouts, cancellation, rate limits and page-navigation invalidation. It must
 * abort the actual request and settle before another page starts. No retries.
 * The all-pages scheduler must still check stable total and cross-page IDs.
 */
function createPromotionReader({kind,readRequest,readContext}={}){
  kind=kindOf(kind);
  if(typeof readRequest!=='function'||typeof readContext!=='function')throw new TypeError('广告读取需要明确的只读请求和身份核对适配器');
  const active=new Set();
  async function readPage({storeId,date,page=1,signal}={}){
    storeId=identifier(storeId);isoDate(date);pageOf(page);check(signal);
    if(active.has(storeId))fail('SYNC_BUSY','当前店铺已有广告读取，请等待当前请求结束');
    active.add(storeId);let before;
    try{
      let context;try{context=await readContext(storeId,signal);}catch(error){check(signal);safeReadError(error);}
      check(signal);before=verifiedContext(context,storeId);
      let response;
      try{response=await readRequest(storeId,buildPromotionRequest({kind,date,page,csrfId:before.csrfId,loginPointId:before.loginPointId}),signal);}
      catch(error){check(signal);safeReadError(error);}
      check(signal);
      let afterContext;try{afterContext=await readContext(storeId,signal);}catch(error){check(signal);safeReadError(error);}
      check(signal);const after=verifiedContext(afterContext,storeId);
      if(before.source.platformShopId!==after.source.platformShopId||before.source.shopName!==after.source.shopName||before.advertiserId!==after.advertiserId||before.loginPointId!==after.loginPointId)fail('SOURCE_MISMATCH','广告读取期间店铺或广告账户发生变化，本次同步已停止');
      let requestSource;try{requestSource=normalizeSource(response?.source);}catch{fail('SOURCE_MISMATCH','广告请求未返回可信店铺绑定');}
      if(requestSource.platformShopId!==before.source.platformShopId||requestSource.shopName!==before.source.shopName)fail('SOURCE_MISMATCH','广告请求与所选店铺不一致');
      return {...parsePromotionPage(response.body,{kind,date,page}),source:before.source};
    }finally{if(before)before.csrfId='';active.delete(storeId);}
  }
  return {readPage};
}
module.exports={KINDS,PAGE_SIZE,buildPromotionRequest,parsePromotionPage,parseAccountDay,createPromotionReader,accountId,amount};
