'use strict';

const {identifier,mode:validateMode,validateRange,dateList,normalizeSource,normalizedShopName,normalizeRows}=require('./domain');

class FullSyncError extends Error {
  constructor(code,message){super(message);this.name='FullSyncError';this.code=code;}
}
const fail=(code,message)=>{throw new FullSyncError(code,message);};
function checkSignal(signal){if(signal?.aborted)fail('CANCELED','整店同步已取消，原已保存数据保持不变');}
function integer(value,label,{min=1,max=Number.MAX_SAFE_INTEGER}={}){
  if(!Number.isSafeInteger(value)||value<min||value>max)fail('INVALID_PAGE',`${label}必须是明确的有效整数`);
  return value;
}
function defaultWait(ms,signal){
  return new Promise((resolve,reject)=>{
    let timer;
    const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const abort=()=>{stop();reject(new FullSyncError('CANCELED','整店同步已取消，原已保存数据保持不变'));};
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    timer=setTimeout(()=>{stop();resolve();},ms);
  });
}
async function abortableWait(wait,ms,signal){
  checkSignal(signal);let abort;
  try{
    await Promise.race([
      Promise.resolve().then(()=>{checkSignal(signal);return wait(ms,signal);}),
      new Promise((_,reject)=>{
        abort=()=>reject(new FullSyncError('CANCELED','整店同步已取消，原已保存数据保持不变'));
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      }),
    ]);
    checkSignal(signal);
  }finally{signal.removeEventListener('abort',abort);}
}
function providerError(error){
  if(error instanceof FullSyncError)return error;
  const code=String(error?.code||'').toUpperCase();
  if(error?.status===429||error?.statusCode===429||/(?:RATE_LIMITED|THROTTLE|FREQUENCY)/.test(code))return new FullSyncError('RATE_LIMITED','平台限制了读取频率，整店同步已停止，请稍后手动重试');
  if(/(?:VALIDATION|VERIFICATION|CAPTCHA|RGV587|USER_VALIDATE)/.test(code))return new FullSyncError('USER_VALIDATION_REQUIRED','平台要求安全验证，整店同步已停止，请手动处理');
  if(/(?:LOGIN|NEED_LOGIN|SESSION_EXPIRED|TOKEN_EXPIRED)/.test(code))return new FullSyncError('LOGIN_EXPIRED','店铺登录已失效，整店同步已停止，请手动登录');
  if(/(?:CANCELED|CANCELLED|ABORT)/.test(code)||error?.name==='AbortError')return new FullSyncError('CANCELED','整店同步已取消，原已保存数据保持不变');
  if(/TIMEOUT/.test(code))return new FullSyncError('REQUEST_TIMEOUT','本页读取超时，整店同步已停止，请检查后台后手动重试');
  // Provider errors may contain authenticated URLs or response bodies.
  return new FullSyncError('PROVIDER_FAILED','本页读取失败，整店同步已停止，原已保存数据保持不变');
}

/**
 * Completeness-only scheduler. It has no browser, network, login, or storage API.
 * A verified provider must supply readPage({storeId,mode,date,page,signal}) and
 * return {source,date,page,pageSize,total,hasNext,rows}. Rows use domain fields.
 * The provider must bind date/page to its proven contract and abort its actual
 * transport on signal. We await each provider call, including cancellation, so
 * another run for this store cannot start before that call has settled.
 */
function createFullSync({provider,minIntervalMs=1500,maxPages=1000,maxRows=100000,now=Date.now,wait=defaultWait}={}){
  if(!provider||typeof provider.readPage!=='function')throw new TypeError('provider.readPage 必须是函数');
  if(typeof now!=='function'||typeof wait!=='function')throw new TypeError('now 和 wait 必须是函数');
  integer(minIntervalMs,'请求间隔',{min:0,max:3600000});integer(maxPages,'页数上限',{max:1000000});integer(maxRows,'行数上限',{max:100000});
  const active=new Set();
  const clock=()=>{const value=new Date(now()).getTime();if(!Number.isFinite(value))fail('INVALID_TIME','同步时钟无效');return value;};
  async function run({storeId,mode='daily',start,end,signal=new AbortController().signal,onProgress}={}){
    const selectedStore=identifier(storeId),kind=validateMode(mode),range=validateRange({start,end},new Date(clock())),dates=dateList(range.start,range.end);
    checkSignal(signal);if(active.has(selectedStore))fail('SYNC_BUSY','当前店铺已有整店同步任务，请等待完成或取消后重试');
    active.add(selectedStore);
    const rows=[],perDate=[],allKeys=new Set();let source,lastRequestAt=null,requestCount=0,completedPages=0;
    const progress=(message,extra={})=>onProgress?.({storeId:selectedStore,mode:kind,start:range.start,end:range.end,status:'running',message,current:perDate.length,total:dates.length,completedDays:perDate.length,totalDays:dates.length,completedPages,...extra});
    try{
      for(const date of dates){
        let stablePageSize,stableTotal,expectedPages,received=0;const dayKeys=new Set();
        for(let page=1;;page++){
          checkSignal(signal);
          if(requestCount>=maxPages)fail('PAGE_LIMIT','本次读取达到页数上限，未发布未完成的数据');
          if(lastRequestAt!==null){const remaining=Math.max(0,minIntervalMs-(clock()-lastRequestAt));if(remaining)await abortableWait(wait,remaining,signal);}
          checkSignal(signal);progress(`正在读取 ${date} 第 ${page} 页`,{date,currentDate:date,page,expectedPages:expectedPages??null});
          checkSignal(signal);lastRequestAt=clock();requestCount++;
          let result;
          try{result=await provider.readPage({storeId:selectedStore,mode:kind,date,page,signal});}
          catch(error){checkSignal(signal);throw providerError(error);}
          checkSignal(signal);
          if(result?.status===429||result?.statusCode===429)throw providerError({status:429});
          if(!result||typeof result!=='object'||Array.isArray(result))fail('INVALID_PAGE','单页响应格式无效，整店同步已停止');
          let pageSource;
          try{pageSource=normalizeSource(result.source);}catch{fail('SOURCE_MISMATCH','未取得可信的平台店铺身份，整店同步已停止');}
          if(source&&(source.platformShopId!==pageSource.platformShopId||normalizedShopName(source.shopName)!==normalizedShopName(pageSource.shopName)))fail('SOURCE_MISMATCH','分页过程中后台店铺身份发生变化，整店同步已停止');
          source??=pageSource;
          if(result.date!==date)fail('DATE_MISMATCH','后台返回日期与请求日期不一致，整店同步已停止');
          if(result.page!==page)fail('PAGE_MISMATCH','后台返回页码与请求页码不一致，整店同步已停止');
          const pageSize=integer(result.pageSize,'每页条数'),total=integer(result.total,'后台总条数',{min:0});
          if(typeof result.hasNext!=='boolean'||!Array.isArray(result.rows))fail('INVALID_PAGE','后台缺少明确分页终止标记或明细，整店同步已停止');
          if(stablePageSize!==undefined&&(stablePageSize!==pageSize||stableTotal!==total))fail('PAGINATION_CHANGED','分页大小或后台总条数发生变化，整店同步已停止');
          if(page===1){
            stablePageSize=pageSize;stableTotal=total;expectedPages=Math.max(1,Math.ceil(total/pageSize));
            if(rows.length+total>maxRows)fail('ROW_LIMIT','本次完整数据将超过行数上限，未发布未完成的数据');
            if(completedPages+expectedPages>maxPages)fail('PAGE_LIMIT','本次完整分页将超过页数上限，未发布未完成的数据');
            if(kind==='daily'&&total!==1)fail('INVALID_DAILY_TOTAL','店铺日报每天必须有一条真实汇总，不能将空结果补为零');
          }
          const expectedRows=Math.min(pageSize,Math.max(0,total-(page-1)*pageSize));
          if(result.rows.length!==expectedRows)fail('ROW_COUNT_MISMATCH','本页行数与后台总数及分页大小不一致，整店同步已停止');
          if(result.hasNext!==(page<expectedPages))fail('INCOMPLETE_PAGINATION','后台结束标记与总页数不一致，整店同步已停止');
          let normalized;
          try{normalized=normalizeRows(result.rows,{mode:kind,start:date,end:date},source);}
          // 把底层原因（字段名 + 规则，均为无值文本）带给用户，避免只看到一句笼统的失败。
          catch(error){fail('INVALID_ROWS','本页日期、商品标识或经营指标无效，整店同步已停止（'+String(error&&error.message||'未提供原因').slice(0,140)+'）');}
          for(const row of normalized){
            const key=kind==='product'?row.productId:'daily';
            if(dayKeys.has(key)||allKeys.has(`${date}:${key}`))fail('DUPLICATE_ROW','不同分页出现重复商品或日报记录，整店同步已停止');
            dayKeys.add(key);allKeys.add(`${date}:${key}`);rows.push(row);
          }
          received+=normalized.length;completedPages++;
          progress(`已核对 ${date} 第 ${page}/${expectedPages} 页`,{date,currentDate:date,page,expectedPages,dayRows:received});
          checkSignal(signal);
          if(!result.hasNext){
            if(received!==stableTotal||dayKeys.size!==stableTotal)fail('TOTAL_MISMATCH','全部分页条数与后台总数不一致，整店同步已停止');
            perDate.push({date,complete:true,pageSize:stablePageSize,expectedPages,completedPages:page,totalRows:stableTotal,uniqueRows:dayKeys.size});
            progress(`已完整核对 ${date}，共 ${received} 条`,{date,currentDate:date,page,expectedPages});break;
          }
        }
      }
      checkSignal(signal);
      return {rows,source,warnings:source.platformShopId?[]:['每次请求前后按页面真实店铺名称与当前店铺核对；未取得平台店铺ID。'],coverage:{scope:'full',complete:true,dates,expectedDays:dates.length,totalPages:completedPages,completedPages,totalRows:rows.length,rowCount:rows.length,perDate}};
    }finally{active.delete(selectedStore);}
  }
  return {run};
}

module.exports={createFullSync,FullSyncError};
