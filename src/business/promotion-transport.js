'use strict';

const {FullSyncError}=require('./full-sync');
const {identifier,isoDate,normalizedShopName,shopNamesMatch}=require('./domain');
const {responseFailure}=require('./transport');
const {buildPromotionRequest}=require('./sources/promotion');
const {navigationAffectsAccount,sameBackendRoute,samePageUrl}=require('../browser/navigation');

const ORIGIN='https://one.alimama.com',ACCESS_PATH='/member/checkAccess.json',REPORT_PATH='/report/query.json';
const REPORT_KINDS=new Set(['account','item_promotion','site_cost_ratio']);
const fail=(code,message)=>{throw new FullSyncError(code,message);};
function checked(signal){if(signal?.aborted)fail('CANCELED','广告读取已取消，原完整数据保持不变');}
function temporary(value,label,{optional=false}={}){
  if(optional&&(value===undefined||value===''))return '';
  if(typeof value!=='string'||!value||value.length>4096||/[\u0000-\u0020\u007f]/.test(value))fail('PROMOTION_CONTEXT',`${label}不可用，请在官方后台检查本店登录`);
  return value;
}
function advertiserId(value){
  if(typeof value==='number'&&!Number.isSafeInteger(value))fail('SOURCE_MISMATCH','广告账户ID超出有效精度');
  if(!['string','number'].includes(typeof value)||!/^\d{1,30}$/.test(String(value))||/^0+$/.test(String(value)))fail('SOURCE_MISMATCH','尚未确认本店广告账户ID');
  return String(value);
}
function readPageEvidence(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const text=String(document.body?.innerText||'');
  const blocked=/请完成(?:安全)?验证|验证码|滑动验证|访问受限|访问过于频繁|账号(?:已)?(?:封禁|冻结)|账号存在风险|请拖动滑块/.test(text.slice(0,12000))||[...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="punish"],.nc-container')].some(visible);
  const loginRequired=[...document.querySelectorAll('input[type="password"]')].some(visible)||/请(?:先)?登录|登录已失效/.test(text.slice(0,1200));
  return {top:text.slice(0,400),blocked,loginRequired};
}
function pageIdentity(evidence,store){
  if(evidence?.blocked)fail('USER_VALIDATION_REQUIRED','广告页面要求安全验证或限制访问，本次同步已停止');
  if(evidence?.loginRequired)fail('LOGIN_EXPIRED','广告页面需要登录，本次同步已停止');
  if(typeof evidence?.top!=='string')fail('LOGIN_UNCONFIRMED','广告工作台尚未显示可核对的本店账号');
  const lines=evidence.top.split(/\r?\n/).map(value=>value.trim()).filter(Boolean),name=store.name.trim();
  const accounts=[...new Set(lines.filter(line=>shopNamesMatch(line,name)||line.startsWith(name+':')||line.startsWith(name+'：')))];
  const ids=[...new Set(lines.filter(line=>/^ID[：:]\s*\d{1,30}$/.test(line)).map(line=>line.replace(/^ID[：:]\s*/,'')))];
  if(accounts.length!==1||ids.length!==1||!['首页','推广','报表','账户'].every(label=>lines.includes(label)))fail('LOGIN_UNCONFIRMED','广告顶部店铺账号、账户ID或工作台菜单尚未确认，未发起报告请求');
  return {source:{platformShopId:'',shopName:store.name,identityType:'visible-name'},accountName:accounts[0],advertiserId:advertiserId(ids[0])};
}

function createPromotionTransport(ctx,{timeoutMs=20000,contextTimeoutMs=15000,prepareTimeoutMs=45000,pollIntervalMs=400,maxBytes=8*1024*1024,minIntervalMs=1500,cacheTtlMs=300000,now=Date.now,purpose='business-promotion'}={}){
  for(const [value,min]of [[timeoutMs,1],[contextTimeoutMs,1],[prepareTimeoutMs,1],[pollIntervalMs,1],[maxBytes,1],[minIntervalMs,0],[cacheTtlMs,1]])if(!Number.isSafeInteger(value)||value<min)throw new TypeError('广告读取限制无效');
 if(prepareTimeoutMs>60000)throw new TypeError('广告页面等待不能超过60秒');
  const active=new Map(),cache=new Map(),lastStarted=new Map();let disposed=false;
  function forget(storeId){const entry=cache.get(storeId);if(entry){entry.csrfId='';entry.loginPointId='';entry.cleanup?.();cache.delete(storeId);}}
  function validPage(wc){
    if(disposed)fail('COLLECTOR_DISPOSED','广告读取服务已停止');
    if(!wc||wc.isDestroyed?.())fail('PAGE_REQUIRED','请先在工作台打开本店推广后台');
    let url;try{url=new URL(wc.getURL());}catch{fail('PAGE_REQUIRED','推广页面尚未就绪');}
    if(url.origin!==ORIGIN||url.username||url.password||/login|captcha|punish|verify|security|validate/i.test(url.pathname))fail('LOGIN_EXPIRED','推广页面需要登录或验证，本次同步已停止');
  }
  // 万相台是单页应用：它自己的路由变化会改地址与“账号版本号”，但不会换账号。
  // 因此绑定校验只比较：同一个页面实例、同一个站点路径、店铺名与广告账户。
  function sameContext(left,right){return left.wc===right.wc&&samePageUrl(left.url,right.url)&&left.accountName===right.accountName&&left.advertiserId===right.advertiserId&&left.storeName===right.storeName;}
  async function verificationGuard(storeId,signal){
    checked(signal);if(typeof ctx.readAccountState!=='function')return;
    let timer,onAbort,state;
    try{
      state=await Promise.race([Promise.resolve().then(()=>{checked(signal);return ctx.readAccountState(storeId);}),new Promise((_,reject)=>{
        onAbort=()=>reject(new FullSyncError('CANCELED','广告读取已取消'));
        signal.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>reject(new FullSyncError('ACCOUNT_STATE_UNCONFIRMED','店铺验证暂停状态尚未确认，本次同步已停止')),contextTimeoutMs);if(signal.aborted)onAbort();
      })]);
    }catch(error){checked(signal);if(error instanceof FullSyncError)throw error;fail('ACCOUNT_STATE_UNCONFIRMED','无法确认店铺验证暂停状态，本次同步已停止');}
    finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
    checked(signal);const store=state?.store||state;
    if(store?.verificationPaused||store?.status==='verification-required'||store?.backends?.some(backend=>backend.status==='verification-required'))fail('USER_VALIDATION_REQUIRED','此店铺正在等待官方安全验证，广告同步已停止；请在原页面手动处理');
  }
  async function pause(ms,signal){
    checked(signal);await new Promise((resolve,reject)=>{let timer;const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};const abort=()=>{stop();reject(new FullSyncError('CANCELED','广告读取已取消'));};signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{stop();resolve();},ms);if(signal.aborted)abort();});checked(signal);
  }
  async function context(storeId,signal,limitMs=contextTimeoutMs){
    checked(signal);const store=ctx.getStore(storeId),wc=ctx.browser.existingPage(storeId,'promotion',{purpose});validPage(wc);
    // 刚打开的万相台首屏还在加载时，页面脚本会被排到导航之后执行，容易顶到超时；
    // 先等页面安静下来（最多 8 秒），再做身份读取，冷启动第一次同步就不会白等一个超时。
    if(typeof wc.isLoading==='function'&&wc.isLoading()){
      const settle=Date.now()+8000;
      while(wc.isLoading()&&Date.now()<settle&&!signal?.aborted){
        await pause(Math.min(pollIntervalMs,Math.max(1,settle-Date.now())),signal);
      }
      checked(signal);
    }
    const revisionBefore=ctx.browser.accountRevision?.(storeId),storeName=normalizedShopName(store.name);let timer,onAbort,onNavigate,onDestroyed,evidence;
    try{
      const interruption=new Promise((_,reject)=>{
        onAbort=()=>reject(new FullSyncError('CANCELED','广告读取已取消'));
        onDestroyed=()=>reject(new FullSyncError('SOURCE_MISMATCH','广告页面发生变化，本次同步已停止'));
        onNavigate=(...args)=>{if(sameBackendRoute(...args))return;if(navigationAffectsAccount(...args))onDestroyed();};
        signal.addEventListener('abort',onAbort,{once:true});wc.on('did-start-navigation',onNavigate);wc.on('destroyed',onDestroyed);
        timer=setTimeout(()=>reject(new FullSyncError('CONTEXT_TIMEOUT','广告页面身份读取超时，本次同步已停止')),limitMs);
        if(signal.aborted)onAbort();
      });
      evidence=await Promise.race([Promise.resolve().then(()=>{checked(signal);return wc.executeJavaScript(`(${readPageEvidence.toString()})()`,false);}),interruption]);
    }catch(error){checked(signal);if(error instanceof FullSyncError)throw error;fail('CONTEXT_FAILED','无法读取本店广告页面身份，本次同步已停止');}
    finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);wc.removeListener('did-start-navigation',onNavigate);wc.removeListener('destroyed',onDestroyed);}
    validPage(wc);checked(signal);
    // 万相台是单页应用：读完身份之前它自己换路由属于正常行为，地址与账号版本以
    // “读完身份之后”的值为准；页面被替换、店名变了才算真的出问题。
    if(ctx.browser.existingPage(storeId,'promotion',{purpose})!==wc)fail('SOURCE_MISMATCH','推广页面已被替换，本次同步已停止');
    if(normalizedShopName(ctx.getStore(storeId).name)!==storeName)fail('SOURCE_MISMATCH','店铺名称在核对期间发生变化，本次同步已停止');
    const revision=ctx.browser.accountRevision?.(storeId)??revisionBefore;
    const url=wc.getURL();
    return {wc,revision,url,storeName,...pageIdentity(evidence,store)};
  }
  async function send(storeId,descriptor,signal,expected){
    if(descriptor?.method!=='POST'||descriptor.origin!==ORIGIN||![ACCESS_PATH,REPORT_PATH].includes(descriptor.path))fail('REQUEST_NOT_ALLOWED','未确认的广告请求不能用于经营同步');
    checked(signal);const abort=new AbortController();let before,timer,timedOut=false;
    const cancel=()=>abort.abort(),navigate=(...args)=>{if(sameBackendRoute(...args))return;if(navigationAffectsAccount(...args))abort.abort();},destroy=()=>abort.abort();
    signal.addEventListener('abort',cancel,{once:true});
    const check=()=>{checked(signal);if(timedOut)fail('REQUEST_TIMEOUT','广告读取超时，本次同步已停止');if(disposed)fail('COLLECTOR_DISPOSED','广告读取已停止');if(abort.signal.aborted)fail('SOURCE_MISMATCH','广告页面发生跳转或关闭，本次同步已停止');};
    try{
      check();const previous=lastStarted.get(storeId);if(previous!==undefined){const ms=Math.max(0,minIntervalMs-(now()-previous));if(ms)await pause(ms,signal);}
      check();await verificationGuard(storeId,signal);check();before=await context(storeId,signal);check();
      if(expected){
        // prepare 与真正读取之间，万相台可能自己换过 SPA 路由（账号版本号/地址会变），
        // 只要还是同一个页面实例、同一个店铺账号，就继续读取；账号或店铺不同才算变化。
        const compatible=expected.wc===before.wc&&expected.accountName===before.accountName&&expected.advertiserId===before.advertiserId&&expected.storeName===before.storeName;
        if(!compatible||(Object.hasOwn(expected,'csrfId')&&cache.get(storeId)!==expected))fail('SOURCE_MISMATCH','广告请求前页面或账号绑定已经变化，本次同步已停止');
      }
      before.wc.on('did-start-navigation',navigate);before.wc.on('destroyed',destroy);
      timer=setTimeout(()=>{timedOut=true;abort.abort();},timeoutMs);
      const url=new URL(descriptor.path,ORIGIN);for(const [key,value]of Object.entries(descriptor.query||{}))url.searchParams.set(key,String(value));
      lastStarted.set(storeId,now());
      const response=await before.wc.session.fetch(url.href,{method:'POST',credentials:'include',redirect:'manual',cache:'no-store',headers:{'Accept':'application/json','Content-Type':'application/json','Referer':ORIGIN+'/index.html'},body:descriptor.body,signal:abort.signal});
      check();
      if(response.status===429)fail('RATE_LIMITED','广告后台限制了读取频率，本次同步已停止');
      if(response.status===401||response.status===403||response.status>=300&&response.status<400)fail('USER_VALIDATION_REQUIRED','广告后台要求登录或验证，本次同步已停止');
      if(!response.ok)fail('BACKEND_RESPONSE_FAILED','广告后台读取失败，本次同步已停止');
      if(!/json/i.test(response.headers.get('content-type')||''))fail('USER_VALIDATION_REQUIRED','广告后台返回登录、验证或非数据页面，本次同步已停止');
      const chunks=[];let size=0;const reader=response.body.getReader();
      const cancelRead=()=>{Promise.resolve(reader.cancel()).catch(()=>{});};abort.signal.addEventListener('abort',cancelRead,{once:true});
      try{for(;;){check();const {done,value}=await reader.read();check();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail('RESPONSE_TOO_LARGE','广告单页数据超过安全上限，本次同步已停止');}chunks.push(Buffer.from(value));}}
      finally{abort.signal.removeEventListener('abort',cancelRead);reader.releaseLock();}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('INVALID_RESPONSE','广告返回数据格式无效，本次同步已停止');}
      responseFailure(body);check();
      if(body?.info?.ok!==true)fail('BACKEND_RESPONSE_FAILED','广告后台未明确返回成功，本次同步已停止');
      await verificationGuard(storeId,abort.signal);check();const after=await context(storeId,abort.signal);check();
      if(!sameContext(before,after))fail('SOURCE_MISMATCH','读取期间广告账户或所选店铺发生变化，本次同步已停止');
      return {body,context:after};
    }catch(error){check();if(error instanceof FullSyncError)throw error;fail('REQUEST_FAILED','广告读取失败，本次同步已停止，详细认证响应未输出');}
    finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);if(before){before.wc.removeListener('did-start-navigation',navigate);before.wc.removeListener('destroyed',destroy);}if(descriptor.query?.csrfId)descriptor.query.csrfId='';descriptor.body='';}
  }
  async function access(storeId,signal,expected){
    const result=await send(storeId,{origin:ORIGIN,path:ACCESS_PATH,method:'POST',query:{bizCode:'universalBP'},body:JSON.stringify({bizCode:'universalBP'})},signal,expected),body=result.body,proof=result.context;
    if(body.data?.meta?.nickName!==proof.accountName||advertiserId(body.data?.meta?.memberId)!==proof.advertiserId)fail('SOURCE_MISMATCH','广告会话账户与顶部本店身份不一致，未发起报告请求');
    const csrfId=temporary(body.data?.accessInfo?.csrfId,'广告查询参数'),loginPointId=temporary(body.data?.loginPointId,'广告账户参数',{optional:true});
    forget(storeId);const entry={...proof,csrfId,loginPointId,expiresAt:now()+cacheTtlMs};
    const invalidate=(...args)=>{if(sameBackendRoute(...args))return;if(navigationAffectsAccount(...args))forget(storeId);},destroy=()=>forget(storeId);
    proof.wc.on('did-start-navigation',invalidate);proof.wc.on('destroyed',destroy);
    entry.cleanup=()=>{proof.wc.removeListener('did-start-navigation',invalidate);proof.wc.removeListener('destroyed',destroy);};cache.set(storeId,entry);return entry;
  }
  async function exclusive(storeId,signal,work){
    storeId=identifier(storeId);ctx.getStore(storeId);checked(signal);if(disposed)fail('COLLECTOR_DISPOSED','广告读取服务已停止');if(active.has(storeId))fail('SYNC_BUSY','当前店铺已有广告读取，请等待完成');
    const operation=new AbortController(),onAbort=()=>operation.abort();signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)operation.abort();active.set(storeId,operation);
    try{await verificationGuard(storeId,operation.signal);checked(operation.signal);const result=await work(storeId,operation.signal);await verificationGuard(storeId,operation.signal);checked(operation.signal);return result;}catch(error){forget(storeId);if(error instanceof FullSyncError)throw error;fail('REQUEST_FAILED','广告读取未完成，详细认证响应未输出');}
    finally{signal?.removeEventListener('abort',onAbort);active.delete(storeId);}
  }
  async function prepare(storeId,signal){return exclusive(storeId,signal,async(id,currentSignal)=>{
    // Page creation is the normal browser service, with the original store's
    // session. It never refreshes, re-enters passwords or solves verification.
    const end=Date.now()+prepareTimeoutMs;let proof,timer,onAbort;
    if(!ctx.browser.existingPage(id,'promotion',{purpose})){
      try{await Promise.race([Promise.resolve().then(()=>{checked(currentSignal);return ctx.browser.page(id,'promotion',{show:false,purpose,background:true});}),new Promise((_,reject)=>{onAbort=()=>reject(new FullSyncError('CANCELED','广告页面准备已取消'));currentSignal.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>reject(new FullSyncError('PAGE_REQUIRED','广告页面尚未就绪，请在工作台正常打开后重试')),prepareTimeoutMs);if(currentSignal.aborted)onAbort();})]);}
      finally{clearTimeout(timer);currentSignal.removeEventListener('abort',onAbort);}
      checked(currentSignal);
    }
    // 冷启动/首屏未渲染完时，“尚未确认”和“身份读取超时”都会在页面就绪后自愈：
    // 在总预算内重试，避免用户打开软件后的前几次同步必然失败（用户实测反馈）。
    // 注意：顶部账号/账户ID（access）也可能还没渲染出来——它和身份读取一起放进同一个重试预算里，
    // 否则新开的万相台页面会在“广告顶部店铺账号尚未确认”上直接把整批同步打断（实测踩到）。
    let entry=null;
    for(;;){
      try{
        proof=await context(id,currentSignal,Math.max(1,Math.min(contextTimeoutMs,end-Date.now())));
        entry=await access(id,currentSignal,proof);
        break;
      }catch(error){
        if(!['LOGIN_UNCONFIRMED','CONTEXT_TIMEOUT'].includes(error.code)||Date.now()>=end)throw error;
        await pause(Math.min(pollIntervalMs,Math.max(1,end-Date.now())),currentSignal);
      }
    }
    checked(currentSignal);
    if(!sameContext(proof,entry))fail('SOURCE_MISMATCH','广告页面准备期间账号发生变化，本次同步已停止');
    return {source:{...entry.source},advertiserId:entry.advertiserId};
  });}
  async function report(storeId,request,signal){
    if(!REPORT_KINDS.has(request?.kind))fail('REQUEST_NOT_ALLOWED','此广告报表类型未核实');isoDate(request.date);
    const page=request.page??1;if(!Number.isSafeInteger(page)||page<1||page>1000||request.kind==='account'&&page!==1)fail('INVALID_PAGE','广告报表页码无效');
    return exclusive(storeId,signal,async(id,currentSignal)=>{
      // “顶部账号/工作台菜单还没渲染出来”在刚打开的万相台页面里会持续几秒到十几秒；
      // 这里给一个总时间预算（20 秒）持续重试，避免第一次读取就被这种瞬时状态打断。
      const retryDeadline=Date.now()+20000;
      for(let attempt=0;;attempt++){
        try{
          let entry=cache.get(id);if(!entry)fail('PROMOTION_NOT_READY','广告读取尚未准备，或页面已变化；请重新点击同步');
          const proof=await context(id,currentSignal);
          if(!sameContext(proof,entry))fail('SOURCE_MISMATCH','广告读取前账号或页面已变化，本次同步已停止');
          if(entry.expiresAt<=now())entry=await access(id,currentSignal,entry);
          const descriptor=buildPromotionRequest({kind:request.kind,date:request.date,page,csrfId:entry.csrfId,loginPointId:entry.loginPointId});
          const result=await send(id,descriptor,currentSignal,entry);
          if(!sameContext(entry,result.context))fail('SOURCE_MISMATCH','广告读取期间账号绑定发生变化，本次同步已停止');
          return {body:result.body,source:result.context.source,advertiserId:result.context.advertiserId};
        }catch(error){
          // 页面刚打开时顶部菜单/身份可能还没渲染完（“尚未确认”）或短暂无响应（读取超时）：
          // 稍等后重试；绝不重试登录失效或验证。
          if(!(error instanceof FullSyncError)||!['LOGIN_UNCONFIRMED','CONTEXT_TIMEOUT'].includes(error.code)||Date.now()>=retryDeadline)throw error;
          await pause(Math.min(700+attempt*400,2000),currentSignal);
        }
      }
    });
  }
  function dispose(){disposed=true;for(const operation of active.values())operation.abort();for(const id of [...cache.keys()])forget(id);lastStarted.clear();}
  return {prepare,report,dispose};
}
module.exports={createPromotionTransport,pageIdentity};
