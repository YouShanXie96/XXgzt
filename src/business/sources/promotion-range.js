'use strict';
const {identifier,mode:validateMode,validateRange,dateList,normalizeSource,normalizedShopName,yesterday}=require('../domain');
const {FullSyncError}=require('../full-sync');
const {KINDS,parsePromotionPage,parseAccountDay,accountId}=require('./promotion');
const fail=(code,message)=>{throw new FullSyncError(code,message);};
const check=signal=>{if(signal?.aborted)fail('CANCELED','广告读取已取消，原完整数据保持不变');};
function sumAmounts(values){
 if(values.some(value=>value===null))return null;
 const cents=values.reduce((sum,value)=>sum+BigInt(Math.round(value*100)),0n);
 if(cents>BigInt(Number.MAX_SAFE_INTEGER))fail('INVALID_METRICS','广告合计金额超出安全精度');
 return Number(cents)/100;
}
function mergeProductSources(date,sourceRows){
 const map=new Map();
 for(const row of sourceRows){
  if(row.date!==date||!KINDS.includes(row.sourceKind))fail('INVALID_ROWS','广告来源明细日期或类型不一致');
  let value=map.get(row.productId);if(!value){value={};map.set(row.productId,value);}
  if(value[row.sourceKind])fail('DUPLICATE_ROW','同日同来源广告商品重复');
  value[row.sourceKind]=row;
 }
 // Called only after both complete source lists were checked. No row in a
 // proven-complete source means zero spend for that source; a row whose amount
 // is missing remains null and poisons the combined spend rather than becoming 0.
  return [...map].map(([productId,items])=>{
  const item=items.item_promotion,site=items.site_cost_ratio;
  const itemSpend=item?item.adSpend:0,siteSpend=site?site.adSpend:0;
  return {date,productId,title:item?.title||site?.title||'',adSpend:sumAmounts([itemSpend,siteSpend]),siteAdSpend:siteSpend,
   adRevenue:item?item.adRevenue:null,adRoi:item?.adRoi??null,sitePromotion:null};
 }).sort((a,b)=>a.productId.localeCompare(b.productId));
}
function createPromotionRangeReader(transport,{now=()=>new Date(),maxPages=1000,maxRows=100000}={}){
 if(typeof transport?.report!=='function')throw new TypeError('transport.report 必须是函数');
 for(const [value,label,max]of [[maxPages,'页数',1000000],[maxRows,'行数',100000]])if(!Number.isSafeInteger(value)||value<1||value>max)throw new TypeError(`广告${label}限制无效`);
 const active=new Set();
 async function readRange({storeId,mode='daily',start,end,signal,onProgress}={}){
  storeId=identifier(storeId);mode=validateMode(mode);const observedAt=now(),range=validateRange({start,end},observedAt),dates=dateList(range.start,range.end);
  if(range.end>yesterday(observedAt))fail('DATE_MISMATCH','广告同步仅支持完整日期，当天数据不能作为完整日报');
  check(signal);if(active.has(storeId))fail('SYNC_BUSY','当前店铺已有广告同步任务');active.add(storeId);
  try{
   let source,advertiserId,requestCount=0;const rows=[],sourceRows=[],perDate=[];
   async function read(kind,date,page){
    check(signal);if(requestCount>=maxPages)fail('PAGE_LIMIT','广告读取达到页数上限，本次全量结果未提交');
    onProgress?.({storeId,mode,...range,status:'running',message:`正在读取 ${date} 广告${kind==='account'?'日报':kind==='item_promotion'?'商品':'全站'}第 ${page} 页`,date,source:kind,page,current:perDate.length,total:dates.length*(mode==='daily'?1:2),completedPages:requestCount});
    check(signal);requestCount++;let result;
    try{result=await transport.report(storeId,{kind,date,page},signal);}catch(error){
     check(signal);if(error instanceof FullSyncError)throw error;
     fail('REQUEST_FAILED','广告读取失败，本次同步已停止；详细响应未输出');
    }
    check(signal);let current,account;
    try{current=normalizeSource(result?.source);account=accountId(result?.advertiserId);}catch{fail('SOURCE_MISMATCH','广告请求未返回可核对的本店账户绑定');}
    if(source&&(source.platformShopId!==current.platformShopId||normalizedShopName(source.shopName)!==normalizedShopName(current.shopName)||advertiserId!==account))fail('SOURCE_MISMATCH','广告同步过程中店铺或广告账户发生变化');
    source??=current;advertiserId??=account;return result.body;
   }
   for(const date of dates){
    if(mode==='daily'){
     const body=await read('account',date,1),{empty,...row}=parseAccountDay(body,{date,advertiserId});
     if(rows.length>=maxRows)fail('ROW_LIMIT','广告日报超过行数上限，本次结果未提交');
     rows.push(row);if(!empty)sourceRows.push({...row,productId:'',sourceKind:'account'});
     perDate.push({date,kind:'account',total:empty?0:1,totalPages:1,completedPages:1,rowCount:empty?0:1,...(empty?{empty:true}:{})});
     continue;
    }
    const dateRows=[];
    for(const kind of KINDS){
     const seen=new Set();let total,totalPages,completedPages=0;
     for(let page=1;;page++){
      const body=await read(kind,date,page),result=parsePromotionPage(body,{kind,date,page,advertiserId});
      if(total!==undefined&&result.total!==total)fail('PAGINATION_CHANGED','广告分页总条数发生变化，本次全量结果未提交');
      if(total===undefined){
       total=result.total;totalPages=Math.max(1,Math.ceil(total/result.pageSize));
       if(sourceRows.length+dateRows.length+total>maxRows)fail('ROW_LIMIT','广告来源明细超过行数上限，本次全量结果未提交');
       if(requestCount+totalPages-1>maxPages)fail('PAGE_LIMIT','广告完整分页超过页数上限，本次全量结果未提交');
      }
      for(const row of result.rows){if(seen.has(row.productId))fail('DUPLICATE_ROW','广告不同分页出现重复商品，本次全量结果未提交');seen.add(row.productId);dateRows.push(row);}
      completedPages++;
      if(!result.hasNext)break;
     }
     if(seen.size!==total||completedPages!==totalPages)fail('TOTAL_MISMATCH','广告来源分页覆盖不完整，本次结果未提交');
     // Proven per-date pagination: declared total, completed pages and the
     // unique product count must agree before the batch may be committed.
     perDate.push({date,kind,total,totalPages,completedPages,rowCount:seen.size,uniqueProducts:seen.size});
    }
    rows.push(...mergeProductSources(date,dateRows));sourceRows.push(...dateRows);
   }
   check(signal);
   const emptyDates=perDate.filter(day=>day.empty===true).map(day=>day.date);
   return {rows,source,advertiserId,sourceRows,perDate,requestCount,
    coverage:{scope:'full',complete:true,dates,expectedDays:dates.length,rowCount:rows.length},
    warnings:mode==='product'?['商品广告费汇总商品推广与全站费比报表消耗；推广成交额仅来自商品推广，两来源归因口径不同，广告ROI留空。','“推广渠道”列由推广后台的“推广中”单元单独同步，不再从广告报表推断；广告独有商品保留。']:['日报广告取账户分日报表，不能用商品广告列表合计补差或替代账户总额。',...(emptyDates.length?[`${emptyDates.join('、')} 官方当日暂无广告报表记录；广告指标保留为空，不代表花费为0。`]:[])]};
  }finally{active.delete(storeId);}
 }
 return {readRange};
}
module.exports={createPromotionRangeReader,mergeProductSources};
