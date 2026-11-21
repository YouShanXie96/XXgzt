'use strict';
// 托管礼金（独立模块）：参考同类工作台，直接对接淘宝“品牌新享（托管礼金）”页面接口。
// 与内购会 / 违规排查一样自成一套：自己的本地数据（hosted-gift/<storeId>.json）、自己的店铺页面（kind='hostedgift'）、
// 自己的 IPC 动作（hostedgift.*），互不影响其它模块。
const {randomUUID}=require('node:crypto');
const gift=require('../connectors/hosted-gift-ppxk-connector');
const {sanitizeHostedGiftErrorText}=require('../shared/hosted-gift-errors');

const ACTIVITIES=[
  {id:'xingpin',label:'超级新品加速',description:'新品推广期的礼金托管',solutionId:gift.HOSTED_GIFT_XINPIN_SOLUTION_ID},
  {id:'xinke',label:'超级新客加速 · 转化加速',description:'面向新客转化的礼金托管',solutionId:gift.HOSTED_GIFT_XINKE_SOLUTION_ID}
];
const RATE_PRESETS=[10,15,20,25];
const MAX_PRODUCTS=30;
const MAX_LOGS=100;
const MAX_RECORDS=200;
// 平台“稍后再试”类临时错误（系统繁忙/依赖校验抖动）可以短间隔重试；其它错误直接记录。
const RETRYABLE_ENROLL_MESSAGE=/系统繁忙|稍后(?:再|重)试|ERR_HTTP_DEPENDENCY|请求过于频繁/;

function createHostedGiftService(ctx,options={}){
  let disposed=false;
  const key=storeId=>`hosted-gift/${storeId}.json`;
  const emptySnapshot=()=>({schemaVersion:1,lastRun:null,records:[],logs:[]});
  const list=value=>Array.isArray(value)?value:[];
  const clean=value=>sanitizeHostedGiftErrorText(String(value??''),600);
  const normalizeIds=values=>gift.normalizeItemIds(list(values));
  async function loadSnapshot(storeId){
    const snapshot=await ctx.readJson(key(storeId),emptySnapshot());
    if(!snapshot||typeof snapshot!=='object'||!Array.isArray(snapshot.records)||!Array.isArray(snapshot.logs))throw new Error('托管礼金本地数据格式错误，请从备份恢复');
    return snapshot;
  }
  const save=snapshotStore=>snapshotStore;
  async function persist(storeId,snapshot){await ctx.writeJson(key(storeId),snapshot);return snapshot;}
  function log(snapshot,action,result,message){
    snapshot.logs=[{id:randomUUID(),at:new Date().toISOString(),action,result,message:clean(message).slice(0,400)},...snapshot.logs].slice(0,MAX_LOGS);
  }
  function activityOf(id){
    const hit=ACTIVITIES.find(item=>item.id===id);
    if(!hit)throw new Error('请选择托管礼金活动类型');
    return hit;
  }
  // 连接器抛出的错误 → 给用户看得懂的中文提示（需要登录/会话没就绪/平台消息）。
  function mapError(error){
    const code=error&&error.code;
    if(code==='needs-login')return new Error('需要登录：请先点“打开平台页面”，在店铺浏览器里完成千牛登录后再试');
    if(code==='session-unready')return new Error('平台会话还没准备好：请打开平台页面、等页面加载完成后再试');
    const message=clean(error instanceof Error?error.message:String(error));
    if(/login|需要登录/i.test(message))return new Error('需要登录：请先点“打开平台页面”，在店铺浏览器里完成千牛登录后再试');
    return new Error(message||'托管礼金操作未完成');
  }
  async function pageFor(storeId){
    const wc=await ctx.browser.page(storeId,'hostedgift');
    try{await gift.ensureHostedGiftPlatformPage(wc,{partitionKey:`store-${storeId}`});}catch(error){throw mapError(error);}
    return wc;
  }
  async function runLogged(storeId,action,label,operation){
    try{
      const result=await operation();
      return {result};
    }catch(error){
      const mapped=mapError(error);
      const snapshot=await loadSnapshot(storeId).catch(()=>emptySnapshot());
      log(snapshot,label,'failed',mapped.message);
      await persist(storeId,snapshot).catch(()=>undefined);
      throw mapped;
    }
  }
  async function handle(action,p={}){
    if(disposed)throw new Error('程序正在退出或恢复数据');
    const store=ctx.getStore(p.storeId),storeId=store.id;
    if(action==='load'){
      const snapshot=await loadSnapshot(storeId);
      // 注意：渲染层 setData() 会把返回值里的顶层 snapshot 字段当成“账号数据快照”直接剥出来，
      // 因此这里改名为 local，保证 activities/ratePresets 能一起到达页面。
      return {local:snapshot,activities:ACTIVITIES,ratePresets:RATE_PRESETS,maxProducts:MAX_PRODUCTS,platformUrl:gift.HOSTED_GIFT_PLATFORM_URL};
    }
    if(action==='openPlatform'){
      const wc=await ctx.browser.show(storeId,'hostedgift');
      return {url:wc.getURL?.()||gift.HOSTED_GIFT_PLATFORM_URL,message:'已打开淘宝“托管礼金”页面；请核对店铺登录状态后再操作。'};
    }
    if(action==='listSelectable'){
      const activity=activityOf(p.activity);
      const itemIds=normalizeIds(p.itemIds);
      const {result}=await runLogged(storeId,'listSelectable','查询可添加',async()=>{
        const wc=await pageFor(storeId);
        return gift.listSelectableItems(wc,{itemIds,marketingSolutionId:activity.solutionId});
      });
      return {activity:activity.id,result};
    }
    if(action==='listSku'){
      const activity=activityOf(p.activity);
      const itemId=normalizeIds([p.itemId])[0];
      if(!itemId)throw new Error('请填写一个有效的商品 ID（5–20 位数字）');
      const {result}=await runLogged(storeId,'listSku','查询商品 SKU',async()=>{
        const wc=await pageFor(storeId);
        return {items:await gift.listSelectSku(wc,itemId,activity.solutionId)};
      });
      return {activity:activity.id,itemId,result};
    }
    if(action==='listSigned'){
      const activity=activityOf(p.activity);
      const itemIds=normalizeIds(p.itemIds);
      const {result}=await runLogged(storeId,'listSigned','刷新已报名',async()=>{
        const wc=await pageFor(storeId);
        return gift.listSignedItems(wc,{itemIds,marketingSolutionId:activity.solutionId});
      });
      return {activity:activity.id,result};
    }
    if(action==='enroll'){
      const activity=activityOf(p.activity);
      const itemIds=normalizeIds(p.itemIds);
      if(!itemIds.length)throw new Error('请填写至少一个商品 ID（每行一个，5–20 位数字）');
      if(itemIds.length>MAX_PRODUCTS)throw new Error(`一次最多报名 ${MAX_PRODUCTS} 个商品`);
      const rateMode=p.rateMode==='sku'?'sku':'item';
      const rate=Number(p.ratePercent);
      if(!Number.isFinite(rate)||rate<=0||rate>100)throw new Error('费率需要是 1–100 之间的数字');
      const withLaoke=p.withLaoke===true;
      let result;
      try{
        const wc=await pageFor(storeId);
        // 2026-10-14 用户实测修复：
        // ① 报名前先查“可添加”列表。淘宝对不在列表里的商品会用依赖校验
        //    （ERR_HTTP_DEPENDENCY_CHECK_SELECT_NOT_PASS →“系统繁忙中，请稍后刷新重试”）拒绝，
        //    提前分组可以把真正原因写清楚，也避免无意义的提交请求。
        // ② 逐个商品提交（与同类工作台一致），可报名商品遇到“系统繁忙”类临时错误自动重试。
        let eligible=null;
        try{
          const payload=await gift.listSelectableItems(wc,{itemIds,marketingSolutionId:activity.solutionId});
          eligible=new Set(list(payload?.items).map(item=>String(item.itemId||'')).filter(Boolean));
        }catch(error){eligible=null;}
        const items=[];
        for(const itemId of itemIds){
          if(eligible&&!eligible.has(itemId)){
            items.push({itemId,ok:false,message:'平台不允许报名：该商品不在“可添加商品”列表里（依赖校验未通过）。常见原因：不满足活动条件、已被其它活动占用或暂不可报名；请先点“查询可添加”核对。'});
            continue;
          }
          let entry=null;
          for(let attempt=0;attempt<3;attempt+=1){
            if(attempt)await new Promise(resolve=>setTimeout(resolve,900+attempt*800));
            const single=await gift.signItems(wc,{itemIds:[itemId],rateMode,itemRatePercent:rate,skuRatePercent:rate,marketingSolutionId:activity.solutionId,withLaoke});
            entry=list(single?.items)[0]||{itemId,ok:single?.ok!==false,message:clean(single?.message||'')};
            if(entry.ok!==false||!RETRYABLE_ENROLL_MESSAGE.test(String(entry.message||'')))break;
          }
          items.push(entry);
          if(itemIds.length>1)await new Promise(resolve=>setTimeout(resolve,400));
        }
        const okCount=items.filter(item=>item.ok!==false).length;
        result={ok:okCount===items.length&&items.length>0,items,message:okCount===items.length?`已提交报名：${items.length} 个商品`:`报名${okCount?'部分':'全部'}失败：成功 ${okCount}，失败 ${items.length-okCount}`};
      }catch(error){
        const mapped=mapError(error);
        const snapshot=await loadSnapshot(storeId).catch(()=>emptySnapshot());
        log(snapshot,'报名提交','failed',mapped.message);
        await persist(storeId,snapshot).catch(()=>undefined);
        throw mapped;
      }
      const snapshot=await loadSnapshot(storeId);
      const at=new Date().toISOString();
      const items=list(result?.items);
      const ok=result?.ok!==false&&!items.some(item=>item.ok===false);
      snapshot.lastRun={at,activity:activity.id,activityLabel:activity.label,rateMode,ratePercent:rate,withLaoke,itemIds,ok,message:clean(result?.message||''),items};
      snapshot.records=[{id:randomUUID(),at,kind:'enroll',activity:activity.id,rateMode,ratePercent:rate,withLaoke,items},...snapshot.records].slice(0,MAX_RECORDS);
      log(snapshot,'报名提交',ok?'ok':'failed',(result?.message||`${items.filter(item=>item.ok!==false).length}/${itemIds.length} 个商品报名成功`)+(withLaoke?'（含同时报名超级老客加速）':''));
      await persist(storeId,snapshot);
      return {activity:activity.id,result,local:snapshot};
    }
    if(action==='batchExit'){
      const activity=activityOf(p.activity);
      const itemIds=normalizeIds(p.itemIds);
      if(!itemIds.length)throw new Error('请填写至少一个要退出的商品 ID');
      let result;
      try{
        const wc=await pageFor(storeId);
        result=await gift.cancelSignedItems(wc,{itemIds,marketingSolutionId:activity.solutionId});
      }catch(error){
        const mapped=mapError(error);
        const snapshot=await loadSnapshot(storeId).catch(()=>emptySnapshot());
        log(snapshot,'批量退出','failed',mapped.message);
        await persist(storeId,snapshot).catch(()=>undefined);
        throw mapped;
      }
      const snapshot=await loadSnapshot(storeId);
      const at=new Date().toISOString();
      snapshot.records=[{id:randomUUID(),at,kind:'exit',activity:activity.id,itemIds,message:clean(result?.message||'')},...snapshot.records].slice(0,MAX_RECORDS);
      log(snapshot,'批量退出',result?.ok===false?'failed':'ok',result?.message||`已提交退出 ${itemIds.length} 个商品`);
      await persist(storeId,snapshot);
      return {activity:activity.id,result,local:snapshot};
    }
    throw new Error('不支持的托管礼金操作');
  }
  return {handle,dispose:async()=>{disposed=true;}};
}

module.exports={createHostedGiftService,ACTIVITIES,RATE_PRESETS,RETRYABLE_ENROLL_MESSAGE};
