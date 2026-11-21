'use strict';
const {identifier,validateRange,dateList,normalizeSource,normalizedShopName,yesterday}=require('../domain');
const {FullSyncError}=require('../full-sync');
const {parseProductRefundPage,PRODUCT_PAGE_SIZE,MAX_PRODUCT_ROWS}=require('./refund');
const fail=(code,message)=>{throw new FullSyncError(code,message);};
const check=signal=>{if(signal?.aborted)fail('CANCELED','商品退款读取已取消，原完整数据保持不变');};
const METRICS=Object.freeze(['refundRate','vocRefundCount','vocPaidOrderCount','vocRefundAmount']);

// Revalidate sanitized DTOs at the range/evidence boundary. Never trust a saved
// row's derived percentage, declared total, date, or page termination flag.
function validateProductRefundPage(dto,{date,page}={}){
  if(!dto||typeof dto!=='object'||Array.isArray(dto)||!Array.isArray(dto.rows)||
    dto.sourceKind!=='voc-product-refunds'||dto.scope!=='product-refund-day'||dto.date!==date||dto.dateEvidence!=='request-bound'||
    dto.page!==page||dto.pageSize!==PRODUCT_PAGE_SIZE||!Number.isSafeInteger(dto.total)||dto.total<0||dto.total>MAX_PRODUCT_ROWS||
    dto.amountUnit!=='source-decimal'||dto.rateUnit!=='percent'||dto.population!=='products-returned-by-refund-report')fail('INVALID_REFUND_EVIDENCE','商品退款分页来源、日期或格式无效');
  const rows=dto.rows.map(row=>{
    if(!row||row.date!==date)fail('REFUND_DATE_MISMATCH','商品退款来源明细日期不一致');
    for(const key of ['successRefundCount','refundInitiationCount','paidOrderCount'])if(!Number.isSafeInteger(row[key])||row[key]<0)fail('REFUND_INVALID_COUNT','商品退款来源笔数无效');
    return {productId:row.productId,successRefundAmount:row.successRefundAmount,refundInitiationAmount:row.refundInitiationAmount,paidAmount:row.paidAmount,
      successRefundCount:String(row.successRefundCount),refundInitiationCount:String(row.refundInitiationCount),paidOrderCount:String(row.paidOrderCount)};
  });
  const canonical=parseProductRefundPage({ret:['SUCCESS::调用成功'],data:{dataSource:{data:rows,total:String(dto.total)}}},{date,page});
  if(dto.hasNext!==canonical.hasNext)fail('REFUND_PAGE_MISMATCH','商品退款后续页声明与总数不一致');
  for(let index=0;index<canonical.rows.length;index++)for(const key of ['refundRate','refundInitiationRate'])if(dto.rows[index][key]!==canonical.rows[index][key])fail('REFUND_RATE_MISMATCH','商品退款来源比例与原始笔数不一致');
  return canonical;
}
function displayRows(pages){
  return pages.flatMap(page=>page.rows.map(row=>{
    const amount=Number(row.successRefundAmount);
    if(!Number.isFinite(amount)||amount.toFixed(2)!==row.successRefundAmount)fail('REFUND_INVALID_AMOUNT','商品退款金额不能精确转换为展示数值');
    return {date:row.date,productId:row.productId,refundRate:row.refundRate,vocRefundCount:row.successRefundCount,vocPaidOrderCount:row.paidOrderCount,vocRefundAmount:amount};
  }));
}
function createProductRefundReader(transport,{now=()=>new Date(),maxPages=1000,maxRows=100000}={}){
  if(typeof transport?.prepare!=='function'||typeof transport?.productRefundPage!=='function')throw new TypeError('商品退款读取需要 prepare 和 productRefundPage');
  for(const [value,max]of [[maxPages,1000000],[maxRows,100000]])if(!Number.isSafeInteger(value)||value<1||value>max)throw new TypeError('商品退款读取限制无效');
  const active=new Set();
  async function readRange({storeId,mode='product',start,end,signal,onProgress}={}){
    storeId=identifier(storeId);if(mode!=='product')fail('INVALID_REFUND_MODE','商品退款来源仅用于精细化');
    const observedAt=now(),range=validateRange({start,end},observedAt),dates=dateList(range.start,range.end);
    if(range.end>yesterday(observedAt))fail('DATE_MISMATCH','商品退款同步仅支持已结束的完整日期');
    check(signal);if(active.has(storeId))fail('SYNC_BUSY','当前店铺已有商品退款同步任务');active.add(storeId);
    try{
      let source,completedPages=0,receivedRows=0;const pages=[],perDate=[];
      function identity(value){
        let current;try{current=normalizeSource(value);}catch{fail('SOURCE_MISMATCH','商品退款未返回可核对的本店身份');}
        if(source&&(source.platformShopId!==current.platformShopId||normalizedShopName(source.shopName)!==normalizedShopName(current.shopName)))fail('SOURCE_MISMATCH','商品退款读取期间店铺身份发生变化');
        source??=current;
      }
      async function call(work){
        check(signal);try{const result=await work();check(signal);identity(result?.source);return result;}
        catch(error){check(signal);if(error instanceof FullSyncError)throw error;fail('REQUEST_FAILED','商品退款读取失败，本次结果未提交；详细响应已隐藏');}
      }
      await call(()=>transport.prepare(storeId,signal));
      for(const date of dates){
        let total,expectedPages;const seen=new Set();let dayPages=0;
        for(let page=1;;page++){
          check(signal);if(completedPages>=maxPages)fail('PAGE_LIMIT','商品退款读取达到页数上限，本次结果未提交');
          onProgress?.({storeId,mode,...range,status:'running',source:'refund',message:`正在读取 ${date} 商品退款第 ${page} 页`,date,page,current:perDate.length,total:dates.length,completedPages});
          check(signal);const result=await call(()=>transport.productRefundPage(storeId,{date,page},signal));
          const data=validateProductRefundPage(result?.page,{date,page});
          if(total!==undefined&&data.total!==total)fail('PAGINATION_CHANGED','商品退款各页总数发生变化，本次结果未提交');
          if(total===undefined){
            total=data.total;expectedPages=Math.max(1,Math.ceil(total/PRODUCT_PAGE_SIZE));
            if(receivedRows+total>maxRows)fail('ROW_LIMIT','商品退款完整记录超过读取上限，本次结果未提交');
            if(completedPages+expectedPages>maxPages)fail('PAGE_LIMIT','商品退款完整分页超过读取上限，本次结果未提交');
          }
          for(const row of data.rows){if(seen.has(row.productId))fail('REFUND_DUPLICATE_PRODUCT','商品退款跨页出现重复商品，本次结果未提交');seen.add(row.productId);}
          pages.push(data);dayPages++;completedPages++;
          if(!data.hasNext)break;
        }
        if(seen.size!==total||dayPages!==expectedPages)fail('REFUND_INCOMPLETE_PAGES','商品退款日期分页未完整覆盖，本次结果未提交');
        receivedRows+=seen.size;
        perDate.push({date,complete:true,pageSize:PRODUCT_PAGE_SIZE,expectedPages,completedPages:dayPages,totalRows:total,uniqueRows:seen.size});
      }
      check(signal);const rows=displayRows(pages);
      return {rows,source,metrics:[...METRICS],requestCount:completedPages,
        coverage:{scope:'full',complete:true,dates,expectedDays:dates.length,rowCount:rows.length,totalRows:rows.length,totalPages:completedPages,completedPages,population:'products-returned-by-refund-report',perDate},
        financeSource:{key:'refund',kind:'product-refund',version:1,start:range.start,end:range.end,pages},
        warnings:['商品退款按客户之声原始订单笔数计算；退款相关商品未出现的日期不补支付分母，跨日缺少任一天分母时退款率留空。','成功退款金额与笔数独立保存，不替代生意参谋退款金额或买家数。']};
    }finally{active.delete(storeId);}
  }
  return {readRange};
}
module.exports={METRICS,validateProductRefundPage,displayRows,createProductRefundReader};
