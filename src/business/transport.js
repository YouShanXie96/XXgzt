'use strict';
const {FullSyncError}=require('./full-sync');
const {normalizedShopName,shopNamesMatch,sameSource}=require('./domain');
const {sourceIdentity}=require('./page-reader');
const {readSycmSelectedShop}=require('./store-identity');
const {navigationAffectsAccount,sameBackendRoute,samePageUrl}=require('../browser/navigation');
const SYCM='https://sycm.taobao.com';
const PATHS=new Set(['/cc/item/view/top.json','/flow/long/period/nodistinct/new/guide/trend.json','/flow/long/period/nodistinct/shop/source/constitute/trend/v3.json','/portal/long/period/coreIndex/getTrend.json']);
const fail=(code,message)=>{throw new FullSyncError(code,message)};
function check(signal){if(signal?.aborted)fail('CANCELED','整店同步已取消');}
function readContext(){
 const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const text=e=>String(e?.innerText||'').trim();
 const body=text(document.body).slice(0,100000);
 const blocked=/请完成(?:安全)?验证|滑动验证|访问受限|访问过于频繁|账号(?:已)?(?:封禁|冻结)|账号存在风险|网络崩溃|请拖动滑块/.test(body)||[...document.querySelectorAll('input[type="password"],iframe[src*="captcha"],iframe[src*="punish"],.nc-container')].some(visible);
 const header=document.querySelector('header,.sycm-header,#header,.ebase-FusionHeader,.ebase-Header');
 const selectors='[data-shop-name],.shop-name,.shopName,.user-name,.userName,.user-nick,.userNick';
 const identities=[...document.querySelectorAll(selectors)].filter(visible).filter(e=>header?header.contains(e):e.getBoundingClientRect().top<240&&!e.closest('table')).map(e=>({name:text(e),id:e.getAttribute('data-shop-id')||''}));
 for(const a of [...(header||document).querySelectorAll('a[href]')].filter(visible)){
  if(!header&&(a.getBoundingClientRect().top>240||a.closest('table')))continue;
  try{const u=new URL(a.href);if(!/(^|\.)(taobao|tmall)\.com$/.test(u.hostname))continue;const id=u.searchParams.get('shopId')||u.searchParams.get('shop_id');if(id&&/^\d+$/.test(id))identities.push({name:text(a),id});}catch{}
 }
 const content=document.querySelector('meta[name="microdata"]')?.getAttribute('content')||'';
 const entry=content.split(';').map(s=>s.trim()).find(s=>s.startsWith('legalityToken='));
 return {blocked,identities:[...identities,...readSycmSelectedShop()],token:entry?entry.slice('legalityToken='.length):''};
}
const contextScript=()=>`(()=>{${readSycmSelectedShop.toString()};return (${readContext.toString()})();})()`;
function responseFailure(body){
 const parts=[body,body?.content,body?.info,body?.data?.info,body?.data?.data?.info].filter(x=>x&&typeof x==='object');
 const text=parts.flatMap(x=>['code','errorCode','message','msg','ret'].map(k=>Array.isArray(x[k])?x[k].join(' '):typeof x[k]==='string'?x[k]:'')).join(' ');
 if(/USER_VALIDATE|RGV587|CAPTCHA|安全验证|验证码|访问受限|封禁|冻结|punish/i.test(text))fail('USER_VALIDATION_REQUIRED','平台要求验证或限制了访问，整店同步已停止，请手动处理');
 if(/SESSION_EXPIRED|TOKEN_EXPIRED|NEED_LOGIN|NOT_LOGIN|登录失效|请.*登录|未登录/i.test(text))fail('LOGIN_EXPIRED','店铺登录已失效，整店同步已停止，请手动登录');
 if(/FREQUENCY|THROTTL|RATE_LIMIT|频繁|限流|频率/i.test(text))fail('RATE_LIMITED','平台限制了读取频率，整店同步已停止');
}
function createBusinessTransport(ctx,{timeoutMs=20000,maxBytes=8*1024*1024,minIntervalMs=1500,now=Date.now,purpose='business-sycm'}={}){
 for(const [value,min]of [[timeoutMs,1],[maxBytes,1],[minIntervalMs,0]])if(!Number.isSafeInteger(value)||value<min)throw new TypeError('经营数据读取限制无效');
 let disposed=false;const active=new Set(),lastStarted=new Map();
 function validPage(wc){
  if(disposed||!wc||wc.isDestroyed?.())fail('PAGE_REQUIRED','请先在工作台打开并登录该店铺的生意参谋');
  let u;try{u=new URL(wc.getURL())}catch{fail('PAGE_REQUIRED','生意参谋页面尚未就绪')}
  if(u.origin!==SYCM||u.username||u.password||/login|captcha|punish|verify|security/i.test(u.pathname))fail('LOGIN_EXPIRED','页面需要登录或验证，整店同步已停止');
 }
 async function context(storeId,signal){
  check(signal);const store=ctx.getStore(storeId),wc=ctx.browser.existingPage(storeId,'sycm',{purpose});validPage(wc);
  const revisionBefore=ctx.browser.accountRevision?.(storeId),storeName=normalizedShopName(store.name);
  let timer,onAbort,onNavigate,onDestroyed,result;
  try{
   // DOM reads cannot be canceled, but their eventual result is discarded after
   // cancellation/navigation. Never attach a new revision to an old DOM result.
   const interrupted=new Promise((_,reject)=>{
    onAbort=()=>reject(new FullSyncError('CANCELED','整店同步已取消'));
    onDestroyed=()=>reject(new FullSyncError('SOURCE_MISMATCH','读取期间店铺页面发生变化，整店同步已停止'));
    onNavigate=(...args)=>{if(sameBackendRoute(...args))return;if(navigationAffectsAccount(...args))onDestroyed();};
    signal?.addEventListener('abort',onAbort,{once:true});wc.on('did-start-navigation',onNavigate);wc.on('destroyed',onDestroyed);
    timer=setTimeout(()=>reject(new FullSyncError('CONTEXT_TIMEOUT','读取店铺身份超时，整店同步已停止')),5000);
    if(signal?.aborted)onAbort();
   });
   result=await Promise.race([Promise.resolve().then(()=>{check(signal);return wc.executeJavaScript(contextScript(),false)}),interrupted]);
  }catch(error){
   check(signal);if(error instanceof FullSyncError)throw error;
   fail('CONTEXT_FAILED','未能核对本店页面身份，整店同步已停止');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);wc.removeListener('did-start-navigation',onNavigate);wc.removeListener('destroyed',onDestroyed);}
  validPage(wc);check(signal);
  // 生意参谋是单页应用：读完身份之前它自己换路由属于正常行为，所以地址与账号版本
  // 以“读完身份之后”的值为准；页面被替换、店名变了才算真的出问题。
  if(ctx.browser.existingPage(storeId,'sycm',{purpose})!==wc)fail('SOURCE_MISMATCH','生意参谋页面已被替换，整店同步已停止');
  if(normalizedShopName(ctx.getStore(storeId).name)!==storeName)fail('SOURCE_MISMATCH','店铺名称在核对期间发生变化，整店同步已停止');
  const revision=ctx.browser.accountRevision?.(storeId)??revisionBefore;
  const url=wc.getURL();
  if(result?.blocked)fail('USER_VALIDATION_REQUIRED','页面出现验证或访问限制，整店同步已停止');
  let source;try{source=sourceIdentity(result,store)}catch{fail('SOURCE_MISMATCH','未确认生意参谋顶部店名与当前店铺一致，整店同步已停止')}
  if(!shopNamesMatch(source.shopName,store.name))fail('SOURCE_MISMATCH','后台与所选店铺不一致');
  if(typeof result.token!=='string'||!result.token||result.token.length>2048)fail('PAGE_REQUIRED','尚未读到本店页面的有效查询参数，请在工作台打开生意参谋后重试');
  return {wc,source,token:result.token,revision};
 }
 async function request(storeId,descriptor,signal){
  check(signal);
  if(descriptor?.method!=='GET'||!PATHS.has(descriptor.path))fail('REQUEST_NOT_ALLOWED','此请求不在经营数据只读清单内');
  const abort=new AbortController();active.add(abort);
  const onAbort=()=>abort.abort(),onNavigate=(...args)=>{if(sameBackendRoute(...args))return;if(navigationAffectsAccount(...args))abort.abort();},onDestroyed=()=>abort.abort();signal?.addEventListener('abort',onAbort,{once:true});
  let before,timer,timedOut=false;
  const checkOperation=()=>{
   check(signal);
   if(timedOut)fail('REQUEST_TIMEOUT','后台读取超时，整店同步已停止');
   if(disposed)fail('COLLECTOR_DISPOSED','整店同步已停止');
   if(abort.signal.aborted)fail('SOURCE_MISMATCH','页面发生跳转或关闭，整店同步已停止');
  };
  try{
   checkOperation();
   const prior=lastStarted.get(storeId);if(prior!==undefined){const ms=Math.max(0,minIntervalMs-(now()-prior));if(ms)await new Promise((resolve,reject)=>{const stop=()=>{clearTimeout(t);abort.signal.removeEventListener('abort',stop);reject(new FullSyncError('CANCELED','整店同步已取消'))};const t=setTimeout(()=>{abort.signal.removeEventListener('abort',stop);resolve()},ms);abort.signal.addEventListener('abort',stop,{once:true});if(abort.signal.aborted)stop()});}
   checkOperation();timer=setTimeout(()=>{timedOut=true;abort.abort()},timeoutMs);
   before=await context(storeId,abort.signal);checkOperation();
   before.wc.on('did-start-navigation',onNavigate);before.wc.on('destroyed',onDestroyed);
   const url=new URL(descriptor.path,SYCM);
   for(const[k,v]of Object.entries(descriptor.query||{})){if(['token','_'].includes(k))fail('REQUEST_NOT_ALLOWED','查询参数无效');url.searchParams.set(k,String(v))}
   url.searchParams.set('_',String(now()));url.searchParams.set('token',before.token);before.token='';
   lastStarted.set(storeId,now());
   const response=await before.wc.session.fetch(url.href,{method:'GET',credentials:'include',redirect:'manual',cache:'no-store',headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded','Referer':SYCM+'/'},signal:abort.signal});
   checkOperation();
   if(response.status===429)fail('RATE_LIMITED','平台限制了读取频率，整店同步已停止');
   if(response.status===401||response.status===403||response.status>=300&&response.status<400)fail('USER_VALIDATION_REQUIRED','平台要求登录或验证，整店同步已停止');
   if(!response.ok)fail('BACKEND_RESPONSE_FAILED','后台读取失败，整店同步已停止');
   if(!/json/i.test(response.headers.get('content-type')||''))fail('USER_VALIDATION_REQUIRED','后台返回登录、验证或非数据页面，整店同步已停止');
   const chunks=[];let size=0;const reader=response.body.getReader();
   const cancelRead=()=>{Promise.resolve(reader.cancel()).catch(()=>{})};abort.signal.addEventListener('abort',cancelRead,{once:true});
   try{for(;;){checkOperation();const {done,value}=await reader.read();checkOperation();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail('RESPONSE_TOO_LARGE','单页数据超过安全读取上限，整店同步已停止')}chunks.push(Buffer.from(value));}}finally{abort.signal.removeEventListener('abort',cancelRead);reader.releaseLock()}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail('INVALID_RESPONSE','后台返回格式无效，整店同步已停止')}
   responseFailure(body);checkOperation();validPage(before.wc);
   // 读取期间只要还是同一个页面实例、同一个店铺身份（店名/店铺ID）就认为没有换账号：
   // 生意参谋自己刷新路由会改变“版本号”，但那不代表换账号（跨站/登录跳转仍会立即中止）。
   const after=await context(storeId,abort.signal);after.token='';
   if(after.wc!==before.wc||!sameSource(before.source,after.source))fail('SOURCE_MISMATCH','读取期间店铺账号发生变化，整店同步已停止');
   return {body,source:before.source};
  }catch(error){
   checkOperation();if(error instanceof FullSyncError)throw error;
   fail('REQUEST_FAILED','后台读取失败，整店同步已停止，请检查官方页面');
  }finally{if(before){before.token='';before.wc.removeListener('did-start-navigation',onNavigate);before.wc.removeListener('destroyed',onDestroyed);}clearTimeout(timer);active.delete(abort);signal?.removeEventListener('abort',onAbort);}
 }
 return {request,context,dispose:()=>{disposed=true;for(const c of active)c.abort();active.clear()}};
}
module.exports={createBusinessTransport,contextScript,responseFailure,PATHS};
