'use strict';

const {buildBusinessReadScript,parseBusinessSnapshot}=require('../insights/collectors/business');
const {buildVisibleReadScript,sourceIdentity,productPageRows,exactNumber}=require('./page-reader');
const {checkSignal}=require('./repository');
const {METRICS}=require('./domain');

// User explicitly requires ordinary displayed-page reading. No requests,
// debugger/CDP listeners, background loading, refresh, pagination or retries.
function createBusinessCollector(ctx){
  let disposed=false;
  function guard(wc,signal){
    checkSignal(signal);if(disposed)throw new Error('经营数据服务已停止');if(!wc||wc.isDestroyed?.())throw new Error('请先正常打开该店铺的生意参谋页面，查询好数据后返回同步当前页面');
    let url;try{url=new URL(wc.getURL());}catch{throw new Error('后台页面尚未打开');}
    if(url.protocol!=='https:'||url.hostname!=='sycm.taobao.com'||url.port||url.username||url.password||/login|captcha|punish|verify|security/i.test(url.pathname))throw new Error('当前页面需要登录或验证，已停止读取；请手动处理后再试');
    return url.origin+url.pathname;
  }
  async function read(wc,script,signal){
    const before=guard(wc,signal);let timer,abort;
    try{
      const value=await Promise.race([wc.executeJavaScript(script,false),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('读取已显示页面超时，本次未保存')),5000);abort=()=>{try{checkSignal(signal)}catch(e){reject(e)}};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);
      if(guard(wc,signal)!==before)throw new Error('读取期间页面发生跳转，本次未保存');return value;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function run({storeId,mode,start,end,signal,onProgress}){
    const store=ctx.getStore(storeId);checkSignal(signal);
    if(start!==end)throw new Error('当前页面保存按单日核对，请选择后台正在显示的同一天');
    const wc=ctx.browser.existingPage?.(storeId,'sycm');guard(wc,signal);
    onProgress?.({message:'正在读取已打开页面上显示的数据，不刷新、不自动翻页',current:0,total:1});
    const visible=await read(wc,buildVisibleReadScript(),signal),source=sourceIdentity(visible,store);
    if(visible.loading)throw new Error('页面还在加载，请等待显示完成后再同步当前页面');
    let result;
    if(mode==='product')result=productPageRows(visible,{start,end});
    else{
      const snapshot=await read(wc,buildBusinessReadScript(),signal);
      const parsed=parseBusinessSnapshot(snapshot,{});
      if(parsed.rows.some(row=>row.startDate!==start||row.endDate!==end||/实时|周|月/.test(row.period)))throw new Error('顶部经营总览显示的日期或统计周期与所选单日不一致，本次未保存');
      const row={date:start};for(const metric of METRICS)row[metric]=null;
      for(const item of parsed.rows){if(!METRICS.includes(item.metric))continue;const value=exactNumber(item.rawValue);if(row[item.metric]!==null&&row[item.metric]!==value)throw new Error('顶部同一指标存在冲突，本次未保存');row[item.metric]=value;}
      if(METRICS.every(k=>row[k]===null))throw new Error('当前顶部总览没有可确认的精确数值，本次未保存');
      result={rows:[row],coverage:{scope:'visible-page',complete:false,dates:[start],visibleRows:1},warnings:['仅保存生意参谋当前页面顶部经营总览显示的指标，未查询其他日期或页面。','广告、账单、采购及操作单未接入本次页面读取；缺失值保持为空。']};
    }
    const afterPage=await read(wc,buildVisibleReadScript(),signal),after=sourceIdentity(afterPage,store);
    if(afterPage.loading)throw new Error('读取期间页面开始重新加载，本次未保存；请显示稳定后再试');
    if(after.shopName!==source.shopName||after.platformShopId!==source.platformShopId)throw new Error('读取期间店铺身份发生变化，本次未保存');
    checkSignal(signal);onProgress?.({message:`已读取当前页面 ${result.rows.length} 行，正在保存页面快照`,current:1,total:1});
    return {...result,source,warnings:[...result.warnings,...(!source.platformShopId?['本次仅按页面顶部店铺名称与所选店铺核对，未取得平台店铺ID。']:[]),'未读取隐藏数据或发起接口查询；页面未显示的数据不会自动补取。']};
  }
  async function open({storeId,backend='sycm'}){
    ctx.getStore(storeId);if(!['sycm','promotion'].includes(backend))throw new Error('不支持的经营后台');if(disposed)throw new Error('经营数据服务已停止');
    await ctx.browser.show(storeId,backend);return {opened:true,backend,message:'请在官方页面手动选好单日数据，返回后点击同步当前页面。'};
  }
  async function dispose(){disposed=true;}
  return {run,open,dispose};
}

module.exports={createBusinessCollector};
