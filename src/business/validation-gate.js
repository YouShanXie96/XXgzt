'use strict';

// 需求2：平台要求滑动验证/安全验证时“暂停而不是中止”的支持模块。
// 检测到验证 → 把正在同步的隐藏页面弹出来 → 用户完成后自动检测通过 →
// 收起并返回，让调用方从断点继续；超时则保留断点停下。
const {FullSyncError}=require('./full-sync');
const fail=(code,message)=>{throw new FullSyncError(code,message);};

// 页面侧脚本：只读 DOM 判断是否仍停留在滑动/安全验证；不点击、不提交、不跳转。
function validationProbeScript(){
  return `(()=>{const visible=e=>{if(!e||!e.getClientRects||!e.getClientRects().length)return false;const style=getComputedStyle(e);return style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse'&&style.opacity!=='0';};
  const text=String(document.body&&document.body.innerText||'').slice(0,20000);
  const blocked=/请完成(?:安全)?验证|请拖动滑块|拖动下方滑块|访问验证|安全验证中|访问过于频繁|被挤爆/.test(text)||['.nc-container','#nc_1_wrapper','[id^="baxia-dialog"]','iframe[src*="captcha"]','iframe[src*="punish"]'].some(selector=>[...document.querySelectorAll(selector)].some(visible));
  return {blocked};})()`;
}
// 读不到（脚本超时/页面异常）一律按“仍在验证”处理，绝不把未知当成已通过。
async function readValidationBlocked(webContents,{timeoutMs=5000}={}){
  if(!webContents||webContents.isDestroyed?.())return true;
  let timer;
  try{
    const value=await Promise.race([
      webContents.executeJavaScript(validationProbeScript(),false),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);timer.unref?.();}),
    ]);
    if(value===null||typeof value!=='object')return true;
    return value.blocked!==false;
  }catch{return true;}
  finally{clearTimeout(timer);}
}
async function waitForValidationCleared({isBlocked,takeHint,timeoutMs,intervalMs=2000,now=Date.now,wait,signal}={}){
  const deadline=now()+timeoutMs;let stable=0;
  const sleep=ms=>wait?Promise.resolve(wait(ms,signal)):new Promise(resolve=>{const timer=setTimeout(resolve,ms);timer.unref?.();signal?.addEventListener?.('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
  for(;;){
    if(signal?.aborted)fail('CANCELED','同步已取消，原已保存数据保持不变');
    if(takeHint?.()===true)return true;
    if(now()>deadline)return false;
    let blocked=true;
    try{blocked=await isBlocked()!==false;}catch{blocked=true;}
    if(!blocked){stable+=1;if(stable>=2)return true;}
    else stable=0;
    await sleep(intervalMs);
    if(signal?.aborted)fail('CANCELED','同步已取消，原已保存数据保持不变');
  }
}
// 把整批执行包在“遇到滑动验证就暂停等待”的循环里；
// 账户级“正在等待安全验证”的错误（error.guard）没有明确页面可弹出，保持原有停止行为。
async function runWithValidationPause({execute,pageContext,emit,takeHint,timeoutMs,intervalMs,now,wait,signal,timeoutMessage}={}){
  if(typeof execute!=='function')throw new TypeError('同步执行器必须是函数');
  for(;;){
    try{return await execute();}
    catch(error){
      if(!(error instanceof FullSyncError)||error.code!=='USER_VALIDATION_REQUIRED'||error.guard===true)throw error;
      let context=null;
      try{context=pageContext?pageContext(error):null;}catch{context=null;}
      if(!context||!context.webContents)throw error;
      emit?.({waitingValidation:true,tabId:typeof context.tabId==='string'?context.tabId:'',
        message:'平台要求完成滑动验证：已把正在同步的页面显示出来，请完成滑块；完成后会自动从断点继续'});
      const cleared=await waitForValidationCleared({isBlocked:()=>readValidationBlocked(context.webContents),takeHint,timeoutMs,intervalMs,now,wait,signal});
      if(!cleared)fail('USER_VALIDATION_TIMEOUT',timeoutMessage||'等待滑动验证超时（已保存断点）：稍后重新点“同步整店数据”会从断点继续，不必从头再翻');
      emit?.({waitingValidation:false,message:'验证已通过，正在从断点继续同步…'});
    }
  }
}
module.exports={validationProbeScript,readValidationBlocked,waitForValidationCleared,runWithValidationPause};
