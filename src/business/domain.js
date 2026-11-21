'use strict';

const { randomUUID } = require('node:crypto');
const REPORT_SCHEMA = require('./report-schema');

const MODES = new Set(['daily', 'product']);
const METRICS = REPORT_SCHEMA.METRICS;
const COUNTS = new Set(REPORT_SCHEMA.COUNTS);
const PERCENTAGES = new Set(REPORT_SCHEMA.PERCENTAGES);
const RESERVED_NULL_FIELDS = new Set(REPORT_SCHEMA.RESERVED_NULL_FIELDS);
const SOURCE_KEYS = new Set([...REPORT_SCHEMA.SYNC_SOURCES,...REPORT_SCHEMA.DEFINITIONS.map(column=>column.source).filter(key=>key!=='identity'&&key!=='unavailable')]);
const AMOUNTS = Object.freeze(['payAmount','refundAmount','adSpend','adRevenue']);
const COLUMNS = Object.freeze([
  {key:'date',label:'统计日期'},{key:'storeName',label:'后台店铺名称'},
  {key:'productId',label:'商品ID'},{key:'title',label:'商品名称'},{key:'category',label:'类目'},
  {key:'visitors',label:'访客数'},{key:'pageViews',label:'浏览量'},{key:'buyers',label:'支付买家数'},
  {key:'payAmount',label:'支付金额'},{key:'conversionRate',label:'支付转化率（%）'},{key:'unitPrice',label:'客单价'},
  {key:'cartItems',label:'加购件数'},{key:'searchVisitors',label:'搜索访客数'},
  {key:'refundAmount',label:'退款金额'},{key:'refundRate',label:'退款率（%）'},
  {key:'adSpend',label:'推广花费'},{key:'adRevenue',label:'推广成交额'},{key:'adRoi',label:'推广ROI'},
]);

function text(value, label, { required = false, max = 500 } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new Error(`${label}必须是文本`);
  const result = value.trim();
  if (required && !result || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) throw new Error(`${label}无效`);
  return result;
}
function identifier(value, label = '店铺ID') {
  const result = text(value,label,{required:true,max:128});
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new Error(`${label}无效`);
  return result;
}
function mode(value = 'daily') {
  if (!MODES.has(value)) throw new Error('经营模式仅支持 daily 或 product');
  return value;
}
function isoDate(value, label = '统计日期') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须是 YYYY-MM-DD 有效日期`);
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10) !== value) throw new Error(`${label}无效`);
  return value;
}
function chinaDate(now = new Date()) {
  const timestamp = new Date(now).getTime();
  if (!Number.isFinite(timestamp)) throw new Error('本机时间无效');
  return new Date(timestamp + 8*3600000).toISOString().slice(0,10);
}
function yesterday(now = new Date()) {
  return new Date(Date.parse(`${chinaDate(now)}T00:00:00Z`) - 86400000).toISOString().slice(0,10);
}
function dateList(start,end) {
  const days=[];
  for (let timestamp=Date.parse(`${start}T00:00:00Z`),last=Date.parse(`${end}T00:00:00Z`);timestamp<=last;timestamp+=86400000) days.push(new Date(timestamp).toISOString().slice(0,10));
  return days;
}
function validateRange(input = {}, now = new Date()) {
  const defaultDate=yesterday(now), start=isoDate(input.start ?? defaultDate,'开始日期'), end=isoDate(input.end ?? input.start ?? defaultDate,'结束日期');
  if (start>end) throw new Error('开始日期不能晚于结束日期');
  if (end>chinaDate(now)) throw new Error('经营数据不能查询未来日期');
  if ((Date.parse(end)-Date.parse(start))/86400000>=31) throw new Error('一次最多同步或查询31天，请缩小日期范围');
  return {start,end};
}
function safeMessage(value, fallback = '经营数据处理未完成') {
  let result=typeof value==='string'?value:String(value?.message||fallback);
  // Never try to retain fragments from credential-bearing headers or JSON: a
  // cookie may contain semicolon-separated values and quoted JSON can nest.
  if (/(?:^|[\s"'\[{,;])(?:cookie|set-cookie|authorization|password|passwd|token|access[_-]?token|refresh[_-]?token|csrf[_-]?(?:id|token)|_m_h5_tk(?:_enc)?|session[_-]?id)["']?\s*[:=]/i.test(result)||/Bearer\s+\S+/i.test(result)) return '后台返回包含认证信息，已隐藏详细内容；请检查登录状态后重试';
  if (/^\s*[\[{]/.test(result)) return '后台返回的详细响应已隐藏，请检查查询状态后重试';
  result=result.replace(/https?:\/\/[^\s<>'"]+/gi,url=>{try {const parsed=new URL(url);return `${parsed.origin}${parsed.pathname}`;}catch{return '[链接已隐藏]';}})
    .replace(/Bearer\s+[^\s,;]+/gi,'Bearer [已隐藏]')
    .replace(/(?:cookie|set-cookie|authorization|password|passwd|access[_-]?token|refresh[_-]?token|_m_h5_tk(?:_enc)?|session[_-]?id)\s*[:=]\s*[^\r\n;,]+/gi,'[认证内容已隐藏]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
  return (result||fallback).slice(0,1000);
}
function normalizeSource(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('未读取到真实后台店铺身份，本次不保存');
  const shopName=text(input.shopName,'后台店铺名称',{required:true,max:160});
  if (/(?:Bearer\s|(?:cookie|authorization|password|token)\s*[:=])/i.test(shopName)) throw new Error('后台店铺名称包含异常认证内容，本次不保存');
  if(input.identityType==='visible-name'&&(input.platformShopId===''||input.platformShopId===undefined))return {platformShopId:'',shopName,identityType:'visible-name'};
  const platformShopId=identifier(input.platformShopId,'平台店铺ID');
  return {platformShopId,shopName};
}
const normalizedShopName=value=>String(value||'').replace(/\s/g,'').trim();
// 平台显示的店名常与本机标签差一个“店”字（例如本机“腾味莱旗舰”、生意参谋“腾味莱旗舰店”），
// 也可能显示子账户“店铺名:姓名”；这些视为同一家店，避免误判“换店”而中止同步。
function shopNamesMatch(left,right){
  const a=normalizedShopName(left),b=normalizedShopName(right);
  if(!a||!b)return false;
  if(a===b||a+'店'===b||b+'店'===a)return true;
  return a.startsWith(b+':')||b.startsWith(a+':');
}
function sameSource(left,right){
  return left.platformShopId&&right.platformShopId?left.platformShopId===right.platformShopId:shopNamesMatch(left.shopName,right.shopName);
}
function coverageScope(value='full'){
  if(!['full','visible-page'].includes(value))throw new Error('经营数据范围仅支持 full 或 visible-page');
  return value;
}
function metric(value, name) {
  if (value===undefined || value===null || value==='' || value==='—' || value==='-') return null;
  if (typeof value==='string' && /^\d+(?:\.\d+)?$/.test(value.trim())) value=Number(value);
  if (typeof value!=='number' || !Number.isFinite(value) || value<0) throw new Error(`经营指标 ${name} 必须是非负数值或缺失值`);
  if (COUNTS.has(name) && !Number.isSafeInteger(value)) throw new Error(`经营指标 ${name} 必须是非负整数`);
  // 退款率与（买家数÷访客数的）支付转化率可以超过 100%：退款可能来自更早的订单，
  // 而当天的买家也可能直接付款而没有再次访问商品页，官方报表里“支付买家数”会大于
  // “商品访客数”（2026-10-06 实测：访客 1、买家 2 → 转化率 200%）。这两个比例由真实计数
  // 相除得出，不是来源给的裸百分数，不能当成单位错误把整批同步拦下。
  if (PERCENTAGES.has(name) && name!=='refundRate' && name!=='conversionRate' && value>100) throw new Error(`经营指标 ${name} 必须是0–100的百分数值`);
  return value;
}
function nullableText(value,label,max=1000){return value===undefined||value===null||value===''?null:text(value,label,{max});}
function normalizedProductStatus(value){
  const result=nullableText(value,'商品状态',40);if(!result)return null;
  const folded=result.toLocaleLowerCase('zh-CN');
  if(['出售中','当前在线','在线','onsale','on_sale','selling'].includes(folded)||/出售中|当前在线/.test(result))return '出售中';
  if(['仓库中','已下架','下架','offline','off_shelf','warehouse'].includes(folded)||/仓库中|已下架|下架/.test(result))return '仓库中';
  return result;
}
function productDate(value,label='商品创建时间'){
  if(value===undefined||value===null||value==='')return null;
  const result=text(value,label,{max:32});
  if(!/^\d{4}-\d{2}-\d{2}(?:[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?$/.test(result))throw new Error(`${label}必须为明确日期或日期时间`);
  isoDate(result.slice(0,10),label);return result;
}
function normalizeSourceCoverage(input,request){
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>SOURCE_KEYS.size)throw new Error('经营数据来源覆盖信息无效');
  const seen=new Set();
  return input.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||!SOURCE_KEYS.has(item.key)||seen.has(item.key))throw new Error('经营数据来源无效或重复');
    seen.add(item.key);
    if(!['completed','not-selected','unavailable'].includes(item.status))throw new Error('经营数据来源状态无效');
    const result={key:item.key,status:item.status,message:safeMessage(item.message||'来源状态已记录')};
    if(item.status==='completed'){
      if(['procurement','profit','adjusted'].includes(item.key))throw new Error('采购、利润或减操作指标尚未接通，不能标记来源已完成');
      if(item.start!==request.start||item.end!==request.end)throw new Error('来源覆盖日期与本次完整查询范围不一致');
      if(!Array.isArray(item.metrics)||!item.metrics.length||item.metrics.length>REPORT_SCHEMA.DEFINITIONS.length)throw new Error('已完成来源必须声明已取得的指标');
      const allowed=new Set(REPORT_SCHEMA.DEFINITIONS.filter(column=>column.source===item.key||item.key==='sycm'&&['affiliateCommission','refundRate'].includes(column.key)).map(column=>column.key));
      if(item.metrics.some(key=>!allowed.has(key)))throw new Error('来源指标不属于该来源');
      Object.assign(result,{start:item.start,end:item.end,metrics:[...new Set(item.metrics)]});
    }else result.metrics=[];
    return result;
  });
}
function normalizeRows(inputs, request, source, {allowEmptyDailyRows=false} = {}) {
  if (!Array.isArray(inputs) || inputs.length>100000) throw new Error('经营明细必须为数组且不超过10万行');
  const seen=new Set();
  return inputs.map(input=>{
    if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('经营明细格式无效');
    const date=isoDate(input.date);
    if (date<request.start || date>request.end) throw new Error('后台响应日期与本次查询范围不一致，本次不保存');
    const productId=request.mode==='product'?identifier(input.productId,'商品ID'):'';
    if (request.mode==='daily' && input.productId) throw new Error('店铺日报不能混入商品明细');
    const key=`${date}:${productId}`;
    if (seen.has(key)) throw new Error('同批经营数据出现重复日期或商品，可能分页重复，本次不保存');
    seen.add(key);
    const row={date,storeName:source.shopName,productId,title:request.mode==='product'?text(input.title,'商品名称',{max:600}):'',category:request.mode==='product'?text(input.category,'商品类目',{max:300}):''};
    for (const name of METRICS) row[name]=RESERVED_NULL_FIELDS.has(name)?null:metric(input[name],name);
    Object.assign(row,{createdAt:request.mode==='product'?productDate(input.createdAt):null,operator:request.mode==='product'?nullableText(input.operator,'运营',160):null,todo:request.mode==='product'?nullableText(input.todo,'待办',1000):null,refundScenes:nullableText(input.refundScenes,'退款场景',1000),sitePromotion:nullableText(input.sitePromotion,'全站标记',200),itemStatus:request.mode==='product'?normalizedProductStatus(input.itemStatus):null,categoryId:request.mode==='product'&&input.categoryId!==undefined&&input.categoryId!==null&&input.categoryId!==''?identifier(input.categoryId,'类目ID'):null});
    if (METRICS.every(name=>row[name]===null)&&!(allowEmptyDailyRows&&request.mode==='daily')) throw new Error('经营明细没有可确认的指标，不能作为成功同步保存');
    return row;
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.productId.localeCompare(b.productId));
}
function normalizeCoverage(input, rows, request) {
  const scope=coverageScope(input?.scope),expected=dateList(request.start,request.end);
  if(scope==='visible-page'){
    if(input?.complete!==false)throw new Error('当前页面快照必须明确标为部分数据，不能标为全量');
    if(request.start!==request.end)throw new Error('当前页面快照只支持单日，请缩小到页面显示的日期');
    if(!Array.isArray(input.dates)||input.dates.length!==1||isoDate(input.dates[0])!==request.start)throw new Error('当前页面日期覆盖与所选单日不一致，本次不保存');
    if(!rows.length||request.mode==='daily'&&rows.length!==1)throw new Error('当前页面没有可保存的真实明细');
    if(!Number.isSafeInteger(input.visibleRows)||input.visibleRows!==rows.length)throw new Error('当前页面可见行数与保存明细不一致，本次不保存');
    return {scope,complete:false,dates:[request.start],expectedDays:1,rowCount:rows.length,visibleRows:rows.length};
  }
  if (request.mode==='product' && (input?.complete!==true || !Array.isArray(input.dates))) throw new Error('商品明细必须具备后台完整分页与日期覆盖证明，本次不保存');
  if (input?.complete===false) throw new Error('后台数据覆盖不完整，本次不保存');
  const observed=[...new Set(rows.map(row=>row.date))].sort();
  const declared=input?.dates;
  if (declared!==undefined && (!Array.isArray(declared) || declared.length>31)) throw new Error('后台日期覆盖信息无效');
  const dates=declared===undefined?observed:[...new Set(declared.map(value=>isoDate(value)))].sort();
  if (dates.length!==expected.length || dates.some((value,index)=>value!==expected[index])) throw new Error('后台响应缺少请求日期或覆盖范围不一致，本次不保存');
  if (request.mode==='daily' && (rows.length!==expected.length || observed.length!==expected.length)) throw new Error('店铺日报必须包含请求范围每一天的真实数据');
  if (request.mode==='product' && observed.length<expected.length && input?.complete!==true) throw new Error('商品空日期必须由后台明确确认完整，不能将未读到数据当作零');
  const result={scope,complete:true,dates,expectedDays:expected.length,rowCount:rows.length};
  if (input?.totalPages!==undefined || input?.completedPages!==undefined) {
    const totalPages=input.totalPages,completedPages=input.completedPages;
    if (!Number.isSafeInteger(totalPages)||totalPages<0||!Number.isSafeInteger(completedPages)||completedPages!==totalPages||rows.length>0&&totalPages===0) throw new Error('后台分页未全部完成，本次不保存');
    result.totalPages=totalPages;result.completedPages=completedPages;
  }
  if (input?.totalRows!==undefined) {
    if (!Number.isSafeInteger(input.totalRows)||input.totalRows<0||input.totalRows!==rows.length) throw new Error('后台总条数与本次明细不一致，本次不保存');
    result.totalRows=input.totalRows;
  }
  if(input?.perDate!==undefined){
    if(!Array.isArray(input.perDate)||input.perDate.length!==expected.length)throw new Error('逐日分页覆盖证明缺失');
    let pageCount=0;
    result.perDate=input.perDate.map((day,i)=>{
      const actual=rows.filter(row=>row.date===expected[i]).length;
      if(day?.date!==expected[i]||day.complete!==true||!Number.isSafeInteger(day.pageSize)||day.pageSize<1||!Number.isSafeInteger(day.expectedPages)||day.expectedPages!==Math.max(1,Math.ceil(actual/day.pageSize))||day.completedPages!==day.expectedPages||day.totalRows!==actual||day.uniqueRows!==actual)throw new Error('逐日分页覆盖与真实明细不一致');
      pageCount+=day.completedPages;
      return {date:day.date,complete:true,pageSize:day.pageSize,expectedPages:day.expectedPages,completedPages:day.completedPages,totalRows:actual,uniqueRows:actual};
    });
    if(result.totalPages!==pageCount||result.completedPages!==pageCount||result.totalRows!==rows.length)throw new Error('逐日覆盖与批次汇总不一致');
  }
  return result;
}
function validateSnapshot(input, {now=new Date(),validateCurrentRange=true} = {}) {
  if(input?.schemaVersion!==undefined&&![1,2].includes(input.schemaVersion))throw new Error('经营数据快照版本不受支持');
  const storeId=identifier(input?.storeId),kind=mode(input?.mode);
  const range=validateCurrentRange?validateRange(input,now):{start:isoDate(input.start),end:isoDate(input.end)};
  if (range.start>range.end || (Date.parse(range.end)-Date.parse(range.start))/86400000>=31) throw new Error('数据批次日期范围无效');
  const source=normalizeSource(input.source),request={...range,mode:kind},sourceCoverage=normalizeSourceCoverage(input.sourceCoverage,request);
  const adCompleted=sourceCoverage.some(item=>item.key==='promotion'&&item.status==='completed');
  // marketing 自 v0.7.4 起由“品牌新享”接口读取，不再走账单证明；只有确实带了账单证明
  // （历史批次，或显式注入账单读取的批次）才把它算作财务来源，避免新旧数据互相冲突。
  const financeProofKeys=new Set((Array.isArray(input.financeSources)?input.financeSources:[]).map(item=>item&&typeof item==='object'?item.key:null).filter(Boolean));
  const financeCompleted=sourceCoverage.filter(item=>['billing','marketing','refund'].includes(item.key)&&item.status==='completed'&&(item.key!=='marketing'||financeProofKeys.has('marketing'))).map(item=>item.key);
  for(const key of financeCompleted){
    const expected=require('./finance-details').metricsFor(key,kind),declared=sourceCoverage.find(item=>item.key===key).metrics;
    if(!expected||expected.length!==declared.length||expected.some(name=>!declared.includes(name)))throw new Error('财务来源声明了尚无原始证明的指标');
  }
  // Only validation of an explicitly completed advertisement source may stage
  // empty daily candidates; matching empty-report proof is required below.
  const rows=normalizeRows(input.rows,request,source,{allowEmptyDailyRows:kind==='daily'&&(adCompleted||financeCompleted.includes('refund'))}),coverage=normalizeCoverage(input.coverage,rows,request);
  const capturedAt=new Date(input.capturedAt||now).toISOString(),id=identifier(input.id||randomUUID(),'批次ID');
  const warnings=Array.isArray(input.warnings)?input.warnings.slice(0,50).filter(value=>typeof value==='string').map(value=>safeMessage(value)):[];
  if(coverage.scope==='visible-page')warnings.push('仅保存当前已显示页面的单次快照，不代表全量数据；未自动请求、刷新或翻页。');
  if(source.identityType==='visible-name')warnings.push('本次仅按页面可见店铺名称核对，未取得平台店铺ID；名称核对不等于平台ID验证。');
  if(sourceCoverage.length&&!adCompleted&&(input.adSources?.rows?.length||input.adSources?.coverage?.length))throw new Error('未完成的广告来源不能保存广告明细证明');
  const adSources=require('./ad-details').normalizeAdSources(input.adSources,request,rows,{required:adCompleted});
  const financeSources=require('./finance-details').normalizeFinanceSources(input.financeSources,request,rows,{completed:financeCompleted});
  for(const key of financeCompleted){
    const proved=require('./finance-details').metricsFor(key,kind),unproved=REPORT_SCHEMA.DEFINITIONS.filter(column=>column.source===key&&!proved.includes(column.key)).map(column=>column.key);
    if(rows.some(row=>unproved.some(name=>row[name]!==null&&row[name]!==undefined)))throw new Error('财务来源包含尚未确认的费用或退款指标');
  }
  const emptyAdDates=new Set(adSources.coverage.filter(day=>day.kind==='account'&&day.empty===true).map(day=>day.date));
  if(rows.some(row=>METRICS.every(name=>row[name]===null)&&!(kind==='daily'&&(adCompleted&&emptyAdDates.has(row.date)||financeSources.some(item=>item.key==='refund')))))throw new Error('经营明细没有可确认的指标且缺少相符的官方空报表证明');
  let sycmCoverage;
  if(input.sycmCoverage!==undefined){
    if(sourceCoverage.length&&!sourceCoverage.some(item=>item.key==='sycm'&&item.status==='completed'))throw new Error('未读取的生意参谋来源不能保存分页证明');
    const fields=REPORT_SCHEMA.DEFINITIONS.filter(column=>column.source==='sycm'&&METRICS.includes(column.key)).map(column=>column.key);
    // A full SYCM row has at least one confirmed SYCM metric. Advertisement-only
    // products must not increase its original row count or create fake pages.
    const sourceRows=rows.filter(row=>fields.some(key=>row[key]!==null));
    sycmCoverage=normalizeCoverage(input.sycmCoverage,sourceRows,request);
  }
  return {schemaVersion:2,id,storeId,mode:kind,...range,capturedAt,source,rows,warnings:[...new Set(warnings)],coverage,sourceCoverage,adSources,...(sycmCoverage?{sycmCoverage}:{}),...(financeSources.length?{financeSources}:{})};
}
function summarizeRows(rows, kind) {
  const days=new Set(rows.map(row=>row.date)).size;
  const summary={rows:rows.length,days,products:kind==='product'?new Set(rows.map(row=>row.productId)).size:0,visitors:null,buyers:null,knownAmounts:{}};
  for (const name of AMOUNTS) {
    const known=rows.filter(row=>typeof row[name]==='number'),total=known.reduce((sum,row)=>sum+row[name],0);
    if (!Number.isFinite(total)) throw new Error('经营金额汇总超过有效范围');
    summary[name]=rows.length&&known.length===rows.length?total:null;
    summary.knownAmounts[name]={value:known.length?total:null,missingRows:rows.length-known.length,observedRows:known.length};
  }
  if (kind==='daily'&&rows.length===1) {summary.visitors=rows[0].visitors;summary.buyers=rows[0].buyers;}
  summary.notes=['访客数、买家数不能按日或商品相加当作区间去重人数。','采购成本暂未接入，不计算毛利或利润。','金额汇总仅在该指标所有记录完整时提供；缺失值保留为空。'];
  return summary;
}

module.exports={MODES,METRICS,AMOUNTS,COLUMNS,REPORT_SCHEMA,SOURCE_KEYS,text,identifier,mode,isoDate,chinaDate,yesterday,dateList,validateRange,safeMessage,normalizeSource,normalizedShopName,shopNamesMatch,sameSource,coverageScope,metric,normalizeRows,normalizeCoverage,normalizeSourceCoverage,validateSnapshot,summarizeRows};
