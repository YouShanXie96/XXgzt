'use strict';

// “推广渠道”数据通道（需求4）：用店铺自己的持久会话，只读万相台无界版
// （one.alimama.com）的推广计划/单元列表；身份核对规则与广告报表读取一致，
// 不点击、不修改店铺数据、不重试验证。请求路径白名单固定为已核实的两个列表接口。
const {FullSyncError}=require('./full-sync');
const {identifier}=require('./domain');
const {pageIdentity}=require('./promotion-transport');
const {navigationAffectsAccount,sameBackendRoute}=require('../browser/navigation');

const ORIGIN='https://one.alimama.com';
const ACCESS_PATH='/member/checkAccess.json';
const ALLOWED_PATHS=new Set([ACCESS_PATH,'/campaign/horizontal/findPage.json','/adgroup/horizontal/findPage.json']);
const HOME_URL=ORIGIN+'/index.html#!/manage/onesite';
const fail=(code,message)=>{throw new FullSyncError(code,message);};
function checked(signal){if(signal?.aborted)fail('CANCELED','推广渠道读取已取消，本次未保存');}

function readPageEvidence(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const text=String(document.body?.innerText||'');
  const blocked=/请完成(?:安全)?验证|验证码|滑动验证|访问受限|访问过于频繁|账号(?:已)?(?:封禁|冻结)|账号存在风险|请拖动滑块/.test(text.slice(0,12000))||[...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="punish"],.nc-container')].some(visible);
  const loginRequired=[...document.querySelectorAll('input[type="password"]')].some(visible)||/请(?:先)?登录|登录已失效/.test(text.slice(0,1200));
  return {top:text.slice(0,400),blocked,loginRequired};
}
function temporary(value,label,{optional=false}={}){
  if(optional&&(value===undefined||value===''))return '';
  if(typeof value!=='string'||!value||value.length>4096||/[\u0000-\u0020\u007f]/.test(value))fail('CHANNELS_CONTEXT',label+'不可用，请在官方后台检查本店登录');
  return value;
}

function sleep(ms,signal){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();resolve();},Math.max(0,ms));
    const abort=()=>{cleanup();reject(new FullSyncError('CANCELED','推广渠道读取已取消，本次未保存'));};
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
  });
}

function createChannelsTransport(ctx,{timeoutMs=60000,contextTimeoutMs=15000,prepareTimeoutMs=30000,maxBytes=12*1024*1024,minIntervalMs=120,cacheTtlMs=300000,now=Date.now}={}){
  const cache=new Map(),lastStarted=new Map(),active=new Set();let disposed=false;
  function forget(storeId){const entry=cache.get(storeId);if(entry){entry.csrfId='';entry.loginPointId='';entry.cleanup?.();cache.delete(storeId);}}
  function validPage(wc){
    if(disposed)fail('COLLECTOR_DISPOSED','推广渠道读取服务已停止');
    if(!wc||wc.isDestroyed?.())fail('PAGE_REQUIRED','请先在工作台打开本店推广后台');
    let url;try{url=new URL(wc.getURL());}catch{fail('PAGE_REQUIRED','推广页面尚未就绪');}
    if(url.origin!==ORIGIN||url.username||url.password||/login|captcha|punish|verify|security|validate/i.test(url.pathname))fail('LOGIN_EXPIRED','推广页面需要登录或验证，本次读取已停止');
  }
  async function ensurePage(storeId,signal){
    let wc=ctx.browser.existingPage?.(storeId,'promotion',{purpose:'business-channels'});
    if(wc)return wc;
    let timer,onAbort;
    try{
      return await Promise.race([
        Promise.resolve().then(()=>{checked(signal);return ctx.browser.page(storeId,'promotion',{show:false,purpose:'business-channels',background:true});}),
        new Promise((_,reject)=>{onAbort=()=>reject(new FullSyncError('CANCELED','推广渠道读取已取消'));signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>reject(new FullSyncError('PAGE_REQUIRED','推广渠道页面尚未就绪，请重新点击同步')),prepareTimeoutMs);if(signal?.aborted)onAbort();}),
      ]);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
  }
  async function ensureHome(wc,signal){
    let url='';try{url=new URL(wc.getURL());}catch{}
    if(url&&url.origin===ORIGIN&&url.pathname==='/index.html')return;
    await Promise.race([Promise.resolve(wc.loadURL(HOME_URL)).catch(()=>null),sleep(12000,signal)]).catch(()=>null);
    await sleep(600,signal);
  }
  async function context(storeId,signal,limitMs=contextTimeoutMs){
    checked(signal);const store=ctx.getStore(storeId),wc=await ensurePage(storeId,signal);validPage(wc);
    await ensureHome(wc,signal);validPage(wc);
    let timer,onAbort,onNavigate,onDestroyed,evidence;
    try{
      const interruption=new Promise((_,reject)=>{
        onAbort=()=>reject(new FullSyncError('CANCELED','推广渠道读取已取消'));
        onDestroyed=()=>reject(new FullSyncError('SOURCE_MISMATCH','推广渠道页面发生变化，本次读取已停止'));
        onNavigate=(...args)=>{if(sameBackendRoute(...args))return;if(navigationAffectsAccount(...args))onDestroyed();};
        signal?.addEventListener('abort',onAbort,{once:true});wc.on('did-start-navigation',onNavigate);wc.on('destroyed',onDestroyed);
        timer=setTimeout(()=>reject(new FullSyncError('CONTEXT_TIMEOUT','推广渠道页面身份读取超时，本次读取已停止')),limitMs);
        if(signal?.aborted)onAbort();
      });
      evidence=await Promise.race([Promise.resolve().then(()=>{checked(signal);return wc.executeJavaScript(`(${readPageEvidence.toString()})()`,false);}),interruption]);
    }catch(error){checked(signal);if(error instanceof FullSyncError)throw error;fail('CONTEXT_FAILED','无法读取本店推广页面身份，本次读取已停止');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);wc.removeListener('did-start-navigation',onNavigate);wc.removeListener('destroyed',onDestroyed);}
    validPage(wc);checked(signal);
    return {wc,url:wc.getURL(),storeName:store.name,...pageIdentity(evidence,store)};
  }
  async function send(storeId,path,body,signal,expected){
    if(!ALLOWED_PATHS.has(path))fail('REQUEST_NOT_ALLOWED','未确认的推广渠道请求不能用于经营同步');
    checked(signal);const abort=new AbortController();let before,timer,timedOut=false;
    const cancel=()=>abort.abort(),navigate=(...args)=>{if(sameBackendRoute(...args))return;if(navigationAffectsAccount(...args))abort.abort();},destroy=()=>abort.abort();
    signal?.addEventListener('abort',cancel,{once:true});
    const check=()=>{checked(signal);if(timedOut)fail('REQUEST_TIMEOUT','推广渠道读取超时，本次读取已停止');if(disposed)fail('COLLECTOR_DISPOSED','推广渠道读取服务已停止');if(abort.signal.aborted)fail('SOURCE_MISMATCH','推广渠道页面发生跳转或关闭，本次读取已停止');};
    try{
      check();const previous=lastStarted.get(storeId);if(previous!==undefined){const ms=Math.max(0,minIntervalMs-(now()-previous));if(ms)await sleep(ms,signal);}
      check();before=await context(storeId,signal);
      before.wc.on('did-start-navigation',navigate);before.wc.on('destroyed',destroy);
      timer=setTimeout(()=>{timedOut=true;abort.abort();},timeoutMs);
      const url=new URL(path,ORIGIN);
      if(expected.csrfId)url.searchParams.set('csrfId',expected.csrfId);
      url.searchParams.set('bizCode',String(body.bizCode||''));
      lastStarted.set(storeId,now());
      const response=await before.wc.session.fetch(url.href,{method:'POST',credentials:'include',redirect:'manual',cache:'no-store',headers:{'Accept':'application/json','Content-Type':'application/json','Referer':ORIGIN+'/index.html'},body:JSON.stringify({...body,...(expected.csrfId?{csrfId:expected.csrfId}:{}),...(expected.loginPointId?{loginPointId:expected.loginPointId}:{})}),signal:abort.signal});
      check();
      if(response.status===429)fail('RATE_LIMITED','推广后台限制了读取频率，本次读取已停止');
      if(response.status===401||response.status===403||response.status>=300&&response.status<400)fail('USER_VALIDATION_REQUIRED','推广后台要求登录或验证，本次读取已停止');
      if(!response.ok)fail('BACKEND_RESPONSE_FAILED','推广后台读取失败，本次读取已停止');
      if(!/json/i.test(response.headers.get('content-type')||''))fail('USER_VALIDATION_REQUIRED','推广后台返回登录、验证或非数据页面，本次读取已停止');
      const chunks=[];let size=0;const reader=response.body.getReader();
      const cancelRead=()=>{Promise.resolve(reader.cancel()).catch(()=>{});};abort.signal.addEventListener('abort',cancelRead,{once:true});
      try{for(;;){check();const {done,value}=await reader.read();check();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail('RESPONSE_TOO_LARGE','推广渠道单页数据超过安全上限，本次读取已停止');}chunks.push(Buffer.from(value));}}
      finally{abort.signal.removeEventListener('abort',cancelRead);reader.releaseLock();}
      let parsed;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('INVALID_RESPONSE','推广渠道返回数据格式无效，本次读取已停止');}
      check();
      if(parsed?.info&&parsed.info.ok===false)fail('BACKEND_RESPONSE_FAILED','推广后台未明确返回成功，本次读取已停止');
      if(/USER_VALIDATE|RGV587|CAPTCHA|验证码|安全验证|请.{0,4}登录|登录失效|FREQUENCY|频繁|限流/i.test(JSON.stringify(parsed?.info||{})))fail('USER_VALIDATION_REQUIRED','推广后台要求验证或限制了访问，本次读取已停止');
      return parsed;
    }catch(error){check();if(error instanceof FullSyncError)throw error;fail('REQUEST_FAILED','推广渠道读取失败，本次读取已停止，详细认证响应未输出');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(before){before.wc.removeListener('did-start-navigation',navigate);before.wc.removeListener('destroyed',destroy);}}
  }
  async function access(storeId,signal){
    const before=await context(storeId,signal);
    const result=await send(storeId,ACCESS_PATH,{bizCode:'universalBP'},signal,{csrfId:'',loginPointId:''});
    const meta=result?.data?.meta||{};
    if(meta.nickName!==before.accountName||String(meta.memberId??'')!==before.advertiserId)fail('SOURCE_MISMATCH','推广渠道会话账户与页面本店身份不一致，未发起列表请求');
    const csrfId=temporary(result?.data?.accessInfo?.csrfId,'推广渠道查询参数'),loginPointId=temporary(result?.data?.loginPointId,'推广渠道账户参数',{optional:true});
    forget(storeId);
    const proof={csrfId,loginPointId,expiresAt:now()+cacheTtlMs};
    cache.set(storeId,proof);
    return proof;
  }
  async function post(storeId,{path,body},signal){
    storeId=identifier(storeId);ctx.getStore(storeId);checked(signal);
    if(disposed)fail('COLLECTOR_DISPOSED','推广渠道读取服务已停止');
    if(active.has(storeId))fail('SYNC_BUSY','当前店铺已有推广渠道读取，请等待完成');
    active.add(storeId);
    const controller=new AbortController(),onAbort=()=>controller.abort();
    signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)controller.abort();
    try{
      let entry=cache.get(storeId);
      if(!entry||entry.expiresAt<=now())entry=await access(storeId,controller.signal);
      checked(controller.signal);
      for(let attempt=0;;attempt++){
        try{checked(controller.signal);return await send(storeId,path,body,controller.signal,entry);}
        catch(error){
          // 页面刚打开时顶部菜单/身份可能还没渲染完（“尚未确认”）：稍等后重试，绝不重试登录失效或验证。
          if(!(error instanceof FullSyncError)||error.code!=='LOGIN_UNCONFIRMED'||attempt>=2)throw error;
          await sleep(700,controller.signal);
        }
      }
    }finally{signal?.removeEventListener('abort',onAbort);active.delete(storeId);}
  }
  function dispose(){disposed=true;for(const id of [...cache.keys()])forget(id);lastStarted.clear();}
  return {post,dispose};
}
module.exports={createChannelsTransport,pageIdentity};
