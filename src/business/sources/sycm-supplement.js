'use strict';

const {FullSyncError}=require('../full-sync');
const {identifier,validateRange,normalizeSource,normalizedShopName,dateList}=require('../domain');
const {dailyRequest,dailySeries,dailyRow,validateDailyDate}=require('./sycm-daily');
const SEARCH_PATH='/flow/long/period/nodistinct/shop/source/constitute/trend/v3.json';
const TREND_PATH='/portal/long/period/coreIndex/getTrend.json';
const fail=message=>{throw new FullSyncError('SYCM_SCHEMA_UNCONFIRMED',message);};
const check=signal=>{if(signal?.aborted)throw new FullSyncError('CANCELED','整店同步已取消，原已保存数据保持不变');};

function supplementRequests(date,{now=new Date()}={}){
 const main=dailyRequest(date,{now});
 const common={dateType:'compareRange',dateRange:main.query.dateRange};
 return {
  main,
  search:{method:'GET',path:SEARCH_PATH,query:{...common,indexCode:'',device:2,belong:'all',pPageId:30}},
  refund:{method:'GET',path:TREND_PATH,query:{...common,indexCode:'rfdSucAmt',device:0,includeRival:true}},
  affiliate:{method:'GET',path:TREND_PATH,query:{...common,indexCode:'tkExpendAmt',device:0,includeRival:true}},
 };
}
function exactValues(values,dates,{count=false,label}){
 if(!Array.isArray(values)||values.length!==dates.length)fail(`${label}未返回完整的31日序列，本次未保存`);
 return dates.map((_,index)=>{
  let value=values[index];
  if(value===undefined||value===null||value===''||value==='-'||value==='--')return null;
  if(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value))value=Number(value);
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||(count&&!Number.isSafeInteger(value)))fail(`${label}包含无法确认的精确数值，本次未保存`);
  return value;
 });
}
function sourceDate(value){
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
 // The observed channel response uses ISO days and, for its final point,
 // a millisecond timestamp for China midnight. A noon/UTC-midnight value is
 // not silently shifted onto a date.
 if(typeof value==='number'&&Number.isSafeInteger(value)){
  const date=new Date(value+8*3600000);
  if(Number.isFinite(date.getTime())&&date.toISOString().endsWith('T00:00:00.000Z'))return date.toISOString().slice(0,10);
 }
 return null;
}
function parseSearch(body,dates){
 const data=body?.data;
 if(body?.code!==0||!data||typeof data!=='object'||Array.isArray(data))fail('搜索访客未返回本店渠道趋势，本次未保存');
 if(!Array.isArray(data.statDate)||data.statDate.length!==dates.length||dates.some((date,index)=>sourceDate(data.statDate[index])!==date))fail('搜索访客日期与主营数据不一致，本次未保存');
 // This channel was matched against the reference shop's daily page. Other
 // channel IDs cannot stand in for search, even if their numbers are similar.
 return exactValues(data['23.s1150'],dates,{count:true,label:'搜索访客'});
}
function parseAmount(body,field,dates,label){
 const content=body?.content;
 if(body?.hasError===true||content?.code!==0||!content.data||typeof content.data!=='object'||Array.isArray(content.data))fail(`${label}未返回成功的本店趋势，本次未保存`);
 // These two observed APIs have no own statDate. They are only accepted with
 // an identical request range and the verified main + channel date anchor.
 // The 'value' branch is this shop; rivalAvg/rivalGood are never read.
 return exactValues(content.data[field]?.value,dates,{label});
}
function parseDailyRange(bodies,{start,end,now=new Date()}={}){
 const range=validateRange({start,end},now);
 validateDailyDate(range.start,now);validateDailyDate(range.end,now);
 const {dates,series}=dailySeries(bodies?.main,{date:range.end,now});
 const search=parseSearch(bodies?.search,dates);
 const refund=parseAmount(bodies?.refund,'rfdSucAmt',dates,'成功退款金额');
 const affiliate=parseAmount(bodies?.affiliate,'tkExpendAmt',dates,'淘宝客佣金');
 const rows=[];
 for(let index=0;index<dates.length;index++){
  const date=dates[index];if(date<range.start||date>range.end)continue;
  const row=dailyRow(series,index,date);
  for(const [key,values]of [['searchVisitors',search],['refundAmount',refund],['affiliateCommission',affiliate]]){
   if(values[index]===null)fail(`所选日报日期 ${date} 缺少已接通来源指标，本次未保存；缺失不会补零`);
   row[key]=values[index];
  }
  rows.push(row);
 }
 const requested=dateList(range.start,range.end);
 if(rows.length!==requested.length||rows.some((row,index)=>row.date!==requested[index]))fail('日报序列未完整覆盖所选日期，本次未保存');
 return {rows,dates:requested};
}
function createDailyRangeReader(transport,{now=()=>new Date()}={}){
 if(typeof transport?.request!=='function')throw new TypeError('transport.request 必须是函数');
 const active=new Set();
 async function readRange({storeId,start,end,signal,onProgress}={}){
  const selected=identifier(storeId),observedAt=now(),range=validateRange({start,end},observedAt);
  validateDailyDate(range.start,observedAt);validateDailyDate(range.end,observedAt);check(signal);
  if(active.has(selected))throw new FullSyncError('SYNC_BUSY','当前店铺已有日报同步任务');
  active.add(selected);
  try{
   // Every call owns these four responses. There is no cross-run, date-only,
   // shared-session or AbortSignal cache.
   const bodies={},descriptors=supplementRequests(range.end,{now:observedAt});let source,completed=0;
   const labels={main:'主营指标',search:'搜索访客',refund:'成功退款金额',affiliate:'淘宝客佣金'};
   for(const [name,descriptor]of Object.entries(descriptors)){
    check(signal);
    onProgress?.({storeId:selected,mode:'daily',start:range.start,end:range.end,status:'running',message:`正在读取${labels[name]}`,current:completed,total:4,source:name});
    check(signal);const response=await transport.request(selected,descriptor,signal);check(signal);
    let current;try{current=normalizeSource(response?.source);}catch{throw new FullSyncError('SOURCE_MISMATCH','日报未取得可核对的本店身份，本次未保存');}
    if(source&&(current.platformShopId!==source.platformShopId||normalizedShopName(current.shopName)!==normalizedShopName(source.shopName)))throw new FullSyncError('SOURCE_MISMATCH','日报各来源店铺身份不一致，本次未保存');
    source??=current;bodies[name]=response.body;completed++;
    // Reject malformed responses before issuing the next request. All sources
    // still undergo the combined range check before a result can be returned.
    const anchor=dailySeries(bodies.main,{date:range.end,now:observedAt}).dates;
    if(name==='search')parseSearch(bodies.search,anchor);
    if(name==='refund')parseAmount(bodies.refund,'rfdSucAmt',anchor,'成功退款金额');
    if(name==='affiliate')parseAmount(bodies.affiliate,'tkExpendAmt',anchor,'淘宝客佣金');
   }
   check(signal);const {rows,dates}=parseDailyRange(bodies,{...range,now:observedAt});
   return {rows,source,warnings:source.platformShopId?[]:['每次请求前后按页面真实店铺名称与当前店铺核对；未取得平台店铺ID。'],coverage:{scope:'full',complete:true,dates,expectedDays:dates.length,rowCount:rows.length}};
  }finally{active.delete(selected);}
 }
 return {readRange};
}
module.exports={supplementRequests,parseDailyRange,createDailyRangeReader,sourceDate};
