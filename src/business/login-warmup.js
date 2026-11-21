'use strict';
// 需求3：同步前的“登录预热”——对齐亿满分软件助手“先登录、再隐藏、后同步”的做法。
// 每个来源在读取前先核对登录：页面明确要求登录时，先按官方流程补一次登录
// （必要时临时显示页面让用户确认/完成滑块），确认登录后把页面重新收起，再开始读取。
// 这样读取过程中不会再撞到登录页，也不会只剩“登录已失效”的报错。
function createLoginWarmup(ctx,{pollMs=2000,deadlineMs=30000,wait}={}={}){
  const sleep=ms=>wait?Promise.resolve(wait(ms)):new Promise(resolve=>{const timer=setTimeout(resolve,ms);timer.unref?.();});
  const verified=result=>result?.status==='verified';
  async function probe(storeId,kind,purpose,signal){
    if(typeof ctx.ensureBackend!=='function')return {status:'unavailable'};
    try{return await ctx.ensureBackend({storeId,kind,...(purpose?{purpose}:{})},{signal,background:true})||{status:'unknown'};}
    catch(error){return {status:'error',message:error?.message||String(error)};}
  }
  function hide(storeId,kind,purpose){
    // 补登录时打开的是普通业务页；确认登录后把它（以及对应同步页）收回去继续后台读取。
    try{ctx.browser?.hideSyncPage?.(storeId,kind);}catch{}
    if(purpose){try{ctx.browser?.hideSyncPage?.(storeId,kind,purpose);}catch{}}
  }
  // probeResult：调用方已经拿到的一次后台核对结果（避免重复探测）。
  // 返回 {status:'verified'|'login-required'|'verification-required'|'unknown'|'error'|'unavailable'|'cancelled',login}
  // 只在页面明确“要求登录”时才主动补登录；未知状态交给各来源自己的精确核对，避免误弹登录窗口。
  async function ensure(storeId,kind,purpose,{signal,label='',probeResult}={}){
    let current=probeResult||await probe(storeId,kind,purpose,signal);
    if(verified(current))return {...current,login:false};
    if(signal?.aborted)return {status:'cancelled',cancelled:true};
    // 初始核对是在同步页上做的；滑块/验证若出现在这里，弹出同步页给用户。
    if(current.status!=='login-required')return {...current,reveal:{kind,purpose}};
    let repaired=null;
    try{repaired=await ctx.ensureBackend({storeId,kind,...(purpose?{purpose}:{})},{signal});}
    catch(error){return {status:'error',message:error?.message||String(error),login:true};}
    if(repaired?.cancelled)return {...repaired,login:true};
    // 补登录走的是登录入口页（普通业务页）：滑块出现在那里时弹出该页。
    if(repaired?.status==='verification-required')return {...repaired,login:true,reveal:{kind}};
    if(!verified(repaired)&&(repaired?.submitted===true||repaired?.status==='unknown')){
      // 已提交登录/结果还没回证（跳转/扫码）：给官方页面一点时间再确认，不立刻判失败；
      // 明确“还需要人工登录”时直接返回，避免白等。
      const deadline=Date.now()+deadlineMs;
      while(!signal?.aborted&&Date.now()<deadline){
        await sleep(pollMs);
        if(signal?.aborted)return {status:'cancelled',cancelled:true};
        current=await probe(storeId,kind,purpose,signal);
        if(verified(current))return {...current,login:true};
        if(current.status==='verification-required')return {...current,login:true,reveal:{kind}};
      }
    }
    if(verified(repaired))current=repaired;
    if(verified(current)){
      hide(storeId,kind,purpose);
      return {...current,login:true};
    }
    // 补登录没有确认成功：不收起页面（用户可能还需要在页面上操作），交给调用方报错。
    const message=repaired?.message||current?.message||`${label||'后台'}需要登录，请先在店铺浏览器里完成登录后再同步。`;
    return {...(current||{}),...(repaired||{}),status:repaired?.status||current?.status||'unknown',login:true,message};
  }
  return {ensure,probe,hide};
}
module.exports={createLoginWarmup};
