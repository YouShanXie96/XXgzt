'use strict';
const {inspectAuthentication,safePageUrl}=require('./authentication');

const HOME='https://myseller.taobao.com/home.htm/QnworkbenchHome/';
const ABORTED=Symbol('aborted');
function interrupted(promise,signal){
  if(signal.aborted)return Promise.resolve(ABORTED);
  return new Promise((resolve,reject)=>{
    const stop=()=>{signal.removeEventListener('abort',stop);resolve(ABORTED);};
    signal.addEventListener('abort',stop,{once:true});
    Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',stop);resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});
  });
}
function pause(ms,signal){
  if(signal.aborted)return Promise.resolve();
  return new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
    const timer=setTimeout(finish,ms);signal.addEventListener('abort',finish,{once:true});
  });
}
function errorCode(error){return String(error?.code||error?.message||error||'').match(/\bERR_[A-Z0-9_]{1,64}\b/)?.[0]||'';}
function result(status,message,url='',extra={}){return {status,message,url:safePageUrl(url),checkedAt:new Date().toISOString(),source:'probe',...extra};}
function closeContents(wc){
  if(!wc||wc.isDestroyed?.())return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const finish=()=>{clearTimeout(timer);wc.removeListener('destroyed',finish);resolve();};
    const timer=setTimeout(()=>{wc.removeListener('destroyed',finish);reject(new Error('临时登录检查页面未能及时关闭。'));},1500);
    wc.once('destroyed',finish);
    try{wc.close({waitForBeforeUnload:false});}catch{clearTimeout(timer);wc.removeListener('destroyed',finish);reject(new Error('临时登录检查页面关闭失败。'));}
  });
}

// 用户实测：刚打开软件时，第一次登录检查要加载千牛首页（冷缓存、两个店铺同时检查），
// 18 秒的上限会让它“检查很久最后仍是快速判断”。放宽到 30 秒并提高并发上限，让首查能真正出结果。
// 并发仍保持 2：同时只开两个临时检查页，避免同时加载多个后台加重风控。
function createLoginProbe({electron,getSession,allowedUrl,timeoutMs=30000,pollMs=400,maxConcurrent=2,loginStableMs=800}){
  const duration=Math.max(1,Math.min(60000,Number(timeoutMs)||30000));
  const interval=Math.max(1,Math.min(1000,Number(pollMs)||400));
  const capacity=Math.max(1,Math.min(4,Math.floor(Number(maxConcurrent)||2)));
  const stableFor=Math.max(0,Math.min(5000,Number(loginStableMs)||0));
  const pending=new Map(),queue=[];let active=0,disposed=false,disposePromise;
  const cancelled=()=>result('unknown','本次登录检查已取消。','',{cancelled:true});
  function finish(record,value){
    if(record.finished)return;record.finished=true;
    if(record.active)active--;
    if(pending.get(record.storeId)===record)pending.delete(record.storeId);
    record.resolve(value);pump();
  }
  function pump(){
    while(!disposed&&active<capacity&&queue.length){
      const record=queue.shift();if(record.finished)continue;
      record.active=true;active++;
      run(record).then(value=>finish(record,value),()=>finish(record,result('error','独立登录检查未完成，请打开店铺后台手动确认。')));
    }
  }
  async function run(record){
    const {signal}=record.controller;
    const deadline=Date.now()+duration,timer=setTimeout(()=>record.controller.abort('timeout'),duration);
    let view,wc,accountSession,loadFailure='',lastObservation=null,loginSince=0,loginUrl='',loginCount=0;
    const listeners=[];let downloadHandler;
    const readUrl=()=>{try{return wc?.getURL?.()||'';}catch{return '';}};
    function stopped(){
      if(signal.reason==='timeout'){
        if(lastObservation?.status==='error')return result('error',lastObservation.message,readUrl(),{timedOut:true});
        return result('unknown','本次检查超时，暂未确认登录状态；请打开店铺后台后重试。',readUrl(),{timedOut:true});
      }
      if(signal.reason==='navigation')return result('error','官方登录跳转暂不支持，请打开店铺后台手动确认。',readUrl());
      return cancelled();
    }
    function listen(event,handler){wc.on(event,handler);listeners.push([event,handler]);}
    try{
      const provided=await interrupted(Promise.resolve().then(()=>getSession(record.storeId)),signal);
      if(provided===ABORTED)return stopped();
      if(!provided||typeof provided!=='object')return result('error','店铺会话不可用，请打开店铺后台后重试。');
      accountSession=provided;
      view=new electron.WebContentsView({webPreferences:{session:accountSession,nodeIntegration:false,nodeIntegrationInSubFrames:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,backgroundThrottling:false,spellcheck:false}});
      view.setBounds({x:0,y:0,width:1280,height:860});view.setVisible(false);wc=view.webContents;
      wc.setWindowOpenHandler(()=>({action:'deny'}));
      listen('will-attach-webview',event=>event.preventDefault());
      const navigation=(event,url)=>{const target=event.url||url;if(target&&!allowedUrl(target)){event.preventDefault();if(event.isMainFrame!==false)record.controller.abort('navigation');}};
      listen('will-navigate',navigation);listen('will-redirect',navigation);listen('will-frame-navigate',navigation);
      listen('did-fail-load',(_event,code,description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)loadFailure=errorCode(description)||'NETWORK_ERROR';});
      listen('render-process-gone',()=>{loadFailure='RENDERER_ERROR';});
      downloadHandler=(event,_item,origin)=>{if(origin===wc)event.preventDefault();};
      accountSession.on?.('will-download',downloadHandler);
      if(!allowedUrl(HOME))return result('error','店铺登录检查入口不受支持。');
      Promise.resolve(wc.loadURL(HOME)).catch(error=>{const code=errorCode(error);if(code!=='ERR_ABORTED')loadFailure=code||'NETWORK_ERROR';});
      while(true){
        if(signal.aborted)return stopped();
        if(loadFailure){const code=loadFailure.startsWith('ERR_')?`（${loadFailure}）`:'';return result('error','登录检查页面加载失败，请检查网络后重试。'+code,readUrl());}
        const observed=await interrupted(inspectAuthentication(wc,'seller',{timeoutMs:Math.max(1,Math.min(1200,deadline-Date.now()))}),signal);
        if(observed===ABORTED)return stopped();
        if(signal.aborted)return stopped();
        if(loadFailure)continue;
        lastObservation=observed;
        if(observed.status==='verified'||observed.status==='verification-required')return result(observed.status,observed.message,readUrl());
        // A login host can be a transient SSO hop. Wait for a stable, loaded
        // login page; do not mistake an intermediate redirect for logout.
        if(observed.status==='login-required'&&!wc.isLoadingMainFrame?.()){
          const url=readUrl();
          if(url!==loginUrl){loginUrl=url;loginSince=Date.now();loginCount=1;}else loginCount++;
          if(loginCount>=2&&Date.now()-loginSince>=stableFor)return result(observed.status,observed.message,url);
        }else{loginUrl='';loginSince=0;loginCount=0;}
        // Unknown and temporary script errors both continue until the overall
        // deadline. Main-document network failure is handled separately above.
        await pause(Math.min(interval,Math.max(1,deadline-Date.now())),signal);
      }
    }catch{
      return signal.aborted?stopped():result('error','独立登录检查未完成，请打开店铺后台手动确认。',readUrl());
    }finally{
      clearTimeout(timer);
      if(wc){for(const [event,handler] of listeners)wc.removeListener(event,handler);}
      if(downloadHandler)accountSession?.removeListener?.('will-download',downloadHandler);
      view?.setVisible(false);await closeContents(wc);
    }
  }
  function check(storeId){
    if(disposed)return Promise.reject(new Error('登录检查服务已停止'));
    if(typeof storeId!=='string'||!storeId)return Promise.reject(new Error('店铺标识无效'));
    if(pending.has(storeId))return pending.get(storeId).promise;
    const record={storeId,controller:new AbortController(),active:false,finished:false};
    record.promise=new Promise(resolve=>{record.resolve=resolve;});pending.set(storeId,record);queue.push(record);pump();return record.promise;
  }
  function cancel(storeId){
    const record=pending.get(storeId);if(!record)return Promise.resolve();
    record.controller.abort('cancelled');if(!record.active)finish(record,cancelled());return record.promise;
  }
  function dispose(){
    if(disposePromise)return disposePromise;disposed=true;
    const work=[...pending.values()].map(record=>{record.controller.abort('cancelled');if(!record.active)finish(record,cancelled());return record.promise;});
    queue.length=0;disposePromise=Promise.allSettled(work).then(()=>{});return disposePromise;
  }
  return {check,cancel,dispose};
}
module.exports={createLoginProbe};
