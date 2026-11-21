'use strict';

const {FullSyncError}=require('./full-sync');
const {createHash}=require('node:crypto');
const {identifier,shopNamesMatch}=require('./domain');
const {inspectAuthentication}=require('../accounts/authentication');
const {navigationAffectsAccount}=require('../browser/navigation');
const {responseFailure}=require('./transport');
const {buildBillingRequest,parseBillingPage,PAGE_SIZE,ORIGIN,PATH}=require('./sources/billing');
const {COOKIE_NAME,inspectSigningCookie,signingSessionFailure}=require('./finance-session');

// Preparation only observes an already-open, authenticated seller homepage.
// Endpoints and the public MTOP app identifiers were statically verified in
// ymf-soft 1.0.14. Only this XX shop's live session may supply the signing cookie.
// No login/refresh requests, arbitrary endpoints, collection loop or persistence.
const SELLER='https://myseller.taobao.com';
const MTOP='https://h5api.m.taobao.com',POLICY_API='mtop.alibaba.jibu.accounting.insurance.info.list.get';
const ROUTES=Object.freeze({
  billing:{origin:ORIGIN,path:PATH},
  deposit:{origin:MTOP,path:'/h5/mtop.alibaba.jibu.accounting.jour.get/1.0/',appKey:'12574478'},
  refund:{origin:MTOP,path:'/h5/mtop.com.taobao.voc.tmall.report.render/1.0/',appKey:'12574478'},
  productRefund:{origin:MTOP,path:'/h5/mtop.com.taobao.voc.tmall.report.render/1.0/',appKey:'12574478'},
  policies:{origin:'https://acs.m.taobao.com',path:`/h5/${POLICY_API}/1.0/`,appKey:'32484673'},
  policyList:{origin:'https://acs.m.taobao.com',path:`/h5/${POLICY_API}/1.0/`,appKey:'32484673'},
  insurance:{origin:'https://acs.m.taobao.com',path:'/h5/mtop.alibaba.jibu.accounting.jour.get/1.0/',appKey:'32484673'},
});
const fail=(code,message)=>{throw new FullSyncError(code,message);};
function readSellerIdentity(){
  const visible=element=>{
    if(!element?.getClientRects().length||element.closest?.('input,textarea,select,[contenteditable]'))return false;
    for(let node=element;node&&node.nodeType===1;node=node.parentElement){
      const style=getComputedStyle(node);
      if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.opacity==='0')return false;
    }
    return true;
  };
  const text=String(document.body?.innerText||'').slice(0,120000);
  return {
    names:[...document.querySelectorAll('.user-area-pop-up-panel [class*="shopName--"]')].filter(visible).map(node=>String(node.innerText||node.textContent||'').trim()),
    blocked:/请完成(?:安全)?验证|验证码|滑动验证|访问受限|访问过于频繁|账号(?:已)?(?:封禁|冻结)|账号存在风险|请拖动滑块/.test(text)||[...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="punish"],.nc-container')].some(visible),
    loginRequired:[...document.querySelectorAll('input[type="password"]')].some(visible)||/请先登录|登录已失效|登录状态已失效/.test(text),
  };
}
function sellerIdentity(evidence,store){
  if(evidence?.blocked)fail('USER_VALIDATION_REQUIRED','千牛页面要求验证或限制访问，账单读取已停止');
  if(evidence?.loginRequired)fail('LOGIN_EXPIRED','千牛页面需要登录，账单读取已停止');
  const name=typeof store?.name==='string'?store.name.trim():'';
  if(!name||!Array.isArray(evidence?.names)||evidence.names.length!==1||!shopNamesMatch(evidence.names[0],name))fail('SOURCE_MISMATCH','千牛顶部必须显示唯一且与所选店铺一致的店名，未发起账单请求');
  return {platformShopId:'',shopName:name,identityType:'visible-name'};
}
function checkedRequest(input,kind,policyNumber){
  const allowed={billing:['start','end','page','pageSize'],deposit:['start','end','page'],refund:['date','page'],productRefund:['date','page'],policies:[],policyList:[],insurance:['start','end','page','policyHash']}[kind];
  if(!allowed||!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Reflect.ownKeys(input).some(key=>!allowed.includes(key)))fail('REQUEST_NOT_ALLOWED','财务请求只能包含已核实的日期和分页参数');
  let request,descriptor,parse;
  if(kind==='policies'||kind==='policyList'){
    request={};descriptor={...ROUTES.policies,method:'GET',query:{jsv:'2.7.0',api:POLICY_API,ecode:'1',type:'originaljson',timeout:'20000',v:'1.0',dataType:'json'},data:{bizCode:'tmall.jibu'},headers:{Referer:'https://jibu.taobao.com/'}};
    parse=kind==='policyList'?require('./sources/guarantee').parsePolicyList:body=>{
      if(!Array.isArray(body?.ret)||body.ret.length!==1||!['SUCCESS::Mtop','SUCCESS::调用成功'].includes(body.ret[0])||body.success===false||body.data?.success===false||body.errors!=null||body.api!==undefined&&body.api!==POLICY_API||body.v!==undefined&&body.v!=='1.0')fail('DEPOSIT_POLICY_INVALID_RESPONSE','保证金保单后台未明确返回正确的成功结果');
      const model=body.data?.model;
      if(!Number.isSafeInteger(model?.total)||model.total<0||!Array.isArray(model.list))fail('DEPOSIT_POLICY_INVALID_RESPONSE','保证金保单列表缺少完整证明');
      if(model.total!==0||model.list.length!==0)fail('UNSUPPORTED_DEPOSIT_POLICY','此店存在保险保证金保单，当前现金读取不能作为完整保证金，已停止');
      return {empty:true};
    };
  }else if(kind==='insurance'){
    if(!/^[a-f0-9]{64}$/.test(input.policyHash||''))fail('REQUEST_NOT_ALLOWED','保险保证金仅接受当前本店保单摘要');
    request={start:input.start,end:input.end,page:input.page===undefined?1:input.page,policyNumber};
    const adapter=require('./sources/guarantee');descriptor=adapter.buildInsuranceRequest(request);parse=adapter.parseInsurancePage;
  }else if(kind==='refund'||kind==='productRefund'){
    request={date:input.date,page:input.page===undefined?1:input.page};
    const adapter=require('./sources/refund');descriptor=kind==='refund'?adapter.buildRefundSceneRequest(request):adapter.buildProductRefundRequest(request);parse=kind==='refund'?adapter.parseRefundScenePage:adapter.parseProductRefundPage;
  }else{
    request={start:input.start,end:input.end,page:input.page===undefined?1:input.page};
    if(kind==='billing'){
      if(input.pageSize!==undefined&&input.pageSize!==PAGE_SIZE)fail('REQUEST_NOT_ALLOWED','账单页大小必须为已确认的 200 条');
      descriptor=buildBillingRequest(request);parse=parseBillingPage;
    }else{const adapter=require('./sources/deposit');descriptor=adapter.buildDepositRequest(request);parse=adapter.parseDepositPage;}
  }
  const route=ROUTES[kind];
  if(descriptor.method!=='GET'||descriptor.origin!==route.origin||descriptor.path!==route.path)fail('REQUEST_NOT_ALLOWED','财务读取路径不在已核实的只读清单');
  return {request,descriptor,parse,route};
}
function createFinanceTransport(ctx,{timeoutMs=20000,contextTimeoutMs=5000,maxBytes=8*1024*1024,minIntervalMs=1500,now=Date.now,inspect=inspectAuthentication,purpose='business-finance',ppxkPurpose='business-ppxk'}={}){
  for(const [value,min]of [[timeoutMs,1],[contextTimeoutMs,1],[maxBytes,1],[minIntervalMs,0]])if(!Number.isSafeInteger(value)||value<min)throw new TypeError('账单读取限制无效');
  if(typeof now!=='function'||typeof inspect!=='function')throw new TypeError('账单读取依赖无效');
  const active=new Map(),bindings=new Map(),lastStarted=new Map();let disposed=false;
  function stop(operation,code,message){if(!operation.reason)operation.reason=new FullSyncError(code,message);operation.abort.abort();}
  function check(operation){if(operation.reason)throw operation.reason;if(disposed)fail('COLLECTOR_DISPOSED','账单读取服务已停止');}
  function forget(id){bindings.get(id)?.cleanup();bindings.delete(id);}
  function invalidate(id){forget(id);const operation=active.get(id);if(operation)stop(operation,'SOURCE_MISMATCH','千牛页面或店铺会话发生变化，账单读取已停止');}
  function validPage(wc){
    if(!wc||wc.isDestroyed?.())fail('PAGE_REQUIRED','请先在工作台正常打开本店千牛首页');
    let url;try{url=new URL(wc.getURL());}catch{fail('PAGE_REQUIRED','千牛首页尚未就绪');}
    if(url.origin!==SELLER||url.username||url.password||!/^\/home\.htm(?:\/QnworkbenchHome)?\/?$/i.test(url.pathname)||/login|captcha|punish|verify|security|validate/i.test(url.hash))fail('LOGIN_EXPIRED','账单读取需要已登录的正常千牛首页');
  }
  // 千牛工作台是单页应用：账单读取需要的是同一个已登录本店会话。
  // 千牛首页登录后会在 /home.htm 与 /home.htm/QnworkbenchHome/ 两套等价路由之间自跳，
  // URL 逐字符比对会把这种正常跳转误判成“店铺身份变化”。这里把它们折叠成同一个地址
  // （查询串/hash 仍参与比较，其它页面仍逐字符比较）。
  const bindingUrl=value=>{
    try{
      const url=new URL(String(value||''));
      if(url.origin===SELLER&&/^\/home\.htm(?:\/QnworkbenchHome)?\/?$/i.test(url.pathname))return SELLER+'/home.htm'+url.search+url.hash;
      return url.href;
    }catch{return String(value||'');}
  };
  // 用户停在“我的商品”等 /home.htm/ 子页面时，先把该店页面导航回千牛首页再核对身份；
  // 不改用其他店铺或参考会话，也不刷新其他后台页面。
  async function ensureSellerHome(wc){
    let url;try{url=new URL(wc.getURL());}catch{return;}
    const atHome=url.origin===SELLER&&!url.username&&!url.password&&/^\/home\.htm(?:\/QnworkbenchHome)?\/?$/i.test(url.pathname);
    if(atHome)return;
    // 同一店铺的千牛子页面，或被其他来源（品牌新享/商品管理）临时占用的淘宝域名页面，
    // 都先送回工作台首页再核对身份；其他站点不动。
    const sellerSubpage=url.origin===SELLER&&/^\/home\.htm\//i.test(url.pathname);
    // 只有“本店千牛子页面”或“其他淘宝/天猫域名的页面”（例如品牌新享、商品管理被临时占用）才导航回首页；
    // 同一域名下的其它路径属于异常页面，保持原样交给身份核对去拒绝。
    const sellerHost=url.hostname.toLowerCase()==='myseller.taobao.com';
    const otherSellerOrigin=!sellerHost&&url.protocol==='https:'&&/(?:^|\.)(?:taobao|tmall|alibaba)\.com$/i.test(url.hostname);
    if(!sellerSubpage&&!otherSellerOrigin)return;
    try{
      // 跳转可能长时间不返回（重定向/风控页），最多等 15 秒后交给下面的身份核对去判断。
      // SSO 重定向会让 Electron 把这次跳转报成“已取消”，不作为失败依据；
      // 后面本来就会等登录证据，真的打不开仍会被下面的核对拦下。
      await Promise.race([wc.loadURL(SELLER+'/home.htm').catch(()=>null),new Promise(resolve=>setTimeout(resolve,15000))]);
    }
    catch{fail('LOGIN_EXPIRED','千牛页面无法回到工作台首页，账单读取已停止');}
    // 千牛首页是单页应用：跳转完成后还要等它把工作台渲染出来，否则紧接着的登录核对会读到空页面。
    const settleDeadline=Date.now()+20000;
    for(;;){
      let status='';
      try{status=(await inspect(wc,'seller',{timeoutMs:2500}))?.status||'';}catch{}
      if(['verified','login-required','verification-required'].includes(status))break;
      if(Date.now()>settleDeadline)break;
      await new Promise(resolve=>setTimeout(resolve,900));
    }
    // 千牛首页是单页应用，登录态出来之后还会自己换路由（例如跳到 /QnworkbenchHome/）。
    // 这里再等它静默 1.2 秒，避免读取开始后又被自己的页内跳转打断。
    const quietDeadline=Date.now()+8000;
    for(;;){
      let moved=false;
      const onMove=()=>{moved=true;};
      wc.on('did-start-navigation',onMove);wc.on('did-navigate',onMove);wc.on('did-navigate-in-page',onMove);
      await new Promise(resolve=>setTimeout(resolve,1200));
      wc.removeListener('did-start-navigation',onMove);wc.removeListener('did-navigate',onMove);wc.removeListener('did-navigate-in-page',onMove);
      if(!moved||Date.now()>quietDeadline)break;
    }
  }
  // 账单读取用哪个千牛标签：先找账单专用标签，其次是品牌新享标签，最后才是用户自己打开的普通页面。
  function sellerPage(id){
    // 优先用账单专用标签；其次用用户自己打开的千牛页面；最后才退回品牌新享标签。
    return ctx.browser.existingPage(id,'seller',{purpose})
      ||ctx.browser.existingPage(id,'seller')
      ||ctx.browser.existingPage(id,'seller',{purpose:ppxkPurpose});
  }
  function unchanged(id,proof){
    validPage(proof.wc);
    if(sellerPage(id)!==proof.wc||ctx.browser.accountRevision(id)!==proof.revision||bindingUrl(proof.wc.getURL())!==bindingUrl(proof.url)||proof.wc.session!==proof.session||ctx.getStore(id).name.trim()!==proof.storeName)fail('SOURCE_MISMATCH','读取期间千牛页面或店铺身份发生变化，账单读取已停止');
  }
  const same=(a,b)=>a.wc===b.wc&&a.session===b.session&&a.revision===b.revision&&bindingUrl(a.url)===bindingUrl(b.url)&&a.storeName===b.storeName;
  async function bounded(work,operation,ms,code,message){
    check(operation);let timer,onAbort;
    try{
      return await Promise.race([Promise.resolve().then(()=>{check(operation);return work();}),new Promise((_,reject)=>{
        onAbort=()=>reject(operation.reason||new FullSyncError('CANCELED','账单读取已取消'));
        operation.abort.signal.addEventListener('abort',onAbort,{once:true});
        timer=setTimeout(()=>stop(operation,code,message),ms);
        if(operation.abort.signal.aborted)onAbort();
      })]);
    }finally{clearTimeout(timer);operation.abort.signal.removeEventListener('abort',onAbort);}
  }
  async function verificationGuard(id,operation){
    check(operation);if(typeof ctx.readAccountState!=='function')return;
    let state;
    try{state=await bounded(()=>ctx.readAccountState(id),operation,contextTimeoutMs,'ACCOUNT_STATE_UNCONFIRMED','店铺验证暂停状态尚未确认，账单读取已停止');}
    catch(error){check(operation);if(error instanceof FullSyncError)throw error;fail('ACCOUNT_STATE_UNCONFIRMED','无法确认店铺验证暂停状态，账单读取已停止');}
    check(operation);const store=state?.store||state;
    if(store?.verificationPaused||store?.status==='verification-required'||store?.backends?.some(backend=>backend.status==='verification-required'))fail('USER_VALIDATION_REQUIRED','此店铺正在等待官方安全验证，账单读取已停止');
  }
  async function context(id,operation){
    check(operation);const store=ctx.getStore(id);
    // 账单读取只复用已有页面（专用标签由同步流程先准备好），不会自己去开新窗口。
    const wc=sellerPage(id);
    // 每次读取前都把本店千牛页面送回工作台首页再核对身份：同一标签上次可能停在
    // 退款/账单子页面，直接核对就会报“千牛首页尚未确认登录，未发起账单请求”。
    await ensureSellerHome(wc);
    validPage(wc);
    const revision=ctx.browser.accountRevision?.(id);
    if(!Number.isSafeInteger(revision)||revision<0)fail('SOURCE_MISMATCH','无法确认本店会话版本，账单读取已停止');
    const proof={wc,session:wc.session,revision,url:wc.getURL(),storeName:store.name.trim()};
    const destroy=()=>stop(operation,'SOURCE_MISMATCH','千牛页面跳转或关闭，账单读取已停止');
    // 千牛首页是单页应用：同一个 myseller.taobao.com 里的页内路由切换（换页签）不会换账号，
    // 不应该把正在进行的账单读取打断；登录页、验证页和其它站点仍然照旧中止。
    const sameShopRoute=(details,url,isInPlace)=>{ 
      const target=typeof details?.url==='string'?details.url:(typeof url==='string'?url:'');
      const main=typeof details?.isMainFrame==='boolean'?details.isMainFrame:undefined;
      if(main===false)return false;
      try{
        const parsed=new URL(target);
        if(parsed.hostname.toLowerCase()!=='myseller.taobao.com')return false;
        if(/login|passport|captcha|punish|verify|verification|security|validate/i.test(parsed.pathname))return false;
        return details?.isInPlace===true||isInPlace===true||/^\/home\.htm/i.test(parsed.pathname);
      }catch{return false;}
    };
    const navigate=(details,url,isInPlace,isMainFrame)=>{if(sameShopRoute(details,url,isInPlace))return;if(navigationAffectsAccount(details,url,isInPlace,isMainFrame))destroy();};
    wc.on('did-start-navigation',navigate);wc.on('destroyed',destroy);
    try{
      return await bounded(async()=>{
        let authentication=await inspect(wc,'seller',{timeoutMs:contextTimeoutMs});check(operation);unchanged(id,proof);
        // 千牛首页是单页应用：刚回首页时可能还要几百毫秒才渲染出登录态，这里最多再等 5 次。
        for(let attempt=0;authentication?.status==='unknown'&&attempt<5;attempt++){
          await new Promise(resolve=>setTimeout(resolve,800));check(operation);
          authentication=await inspect(wc,'seller',{timeoutMs:contextTimeoutMs});check(operation);unchanged(id,proof);
        }
        if(authentication?.status==='verification-required')fail('USER_VALIDATION_REQUIRED','千牛页面要求安全验证，账单读取已停止');
        if(authentication?.status==='login-required')fail('LOGIN_EXPIRED','千牛页面登录已失效，账单读取已停止');
        if(authentication?.status!=='verified')fail('LOGIN_UNCONFIRMED','千牛首页尚未确认登录，未发起账单请求');
        const evidence=await wc.executeJavaScript(`(${readSellerIdentity.toString()})()`,false);check(operation);unchanged(id,proof);
        return {...proof,source:sellerIdentity(evidence,store)};
      },operation,contextTimeoutMs,'CONTEXT_TIMEOUT','千牛店铺身份读取超时，账单读取已停止');
    }catch(error){check(operation);if(error instanceof FullSyncError)throw error;fail('CONTEXT_FAILED','无法确认千牛本店身份，账单读取已停止');}
    finally{wc.removeListener('did-start-navigation',navigate);wc.removeListener('destroyed',destroy);}
  }
  function remember(id,proof){
    forget(id);const destroy=()=>invalidate(id),navigate=(...args)=>{if(navigationAffectsAccount(...args))invalidate(id);};
    proof.wc.on('did-start-navigation',navigate);proof.wc.on('destroyed',destroy);
    proof.cleanup=()=>{proof.wc.removeListener('did-start-navigation',navigate);proof.wc.removeListener('destroyed',destroy);};bindings.set(id,proof);
  }
  async function requestUrl(id,before,operation,descriptor,route){
    const url=new URL(route.path,route.origin);for(const [key,value]of Object.entries(descriptor.query))url.searchParams.set(key,String(value));
    if(!route.appKey)return url;
    // Never read a global/default browser jar or any reference-helper profile.
    // Cookie values are temporary main-process variables, not DTO or log fields.
    let cookies,token='';
    try{
      if(typeof before.session.cookies?.get!=='function')throw signingSessionFailure('missing',{candidates:0,scope:{host:new URL(route.origin).hostname,path:route.path}});
      // The signing session must belong to this store's own prepared page. A
      // replaced page object, a replaced session object or another store's
      // partition is refused before a cookie is read.
      const bound=sellerPage(id);
      if(bound!==before.wc||bound.session!==before.session)fail('SOURCE_MISMATCH','财务签名会话不属于当前准备的本店页面，本次读取已停止');
      cookies=await before.session.cookies.get({url:route.origin+route.path,name:COOKIE_NAME});check(operation);unchanged(id,before);
      const timestamp=now();
      token=inspectSigningCookie(cookies,{origin:route.origin,path:route.path,now:()=>timestamp}).token;const data=JSON.stringify(descriptor.data);
      const sign=createHash('md5').update(token+'&'+timestamp+'&'+route.appKey+'&'+data,'utf8').digest('hex');token='';
      url.searchParams.set('appKey',route.appKey);url.searchParams.set('t',String(timestamp));url.searchParams.set('sign',sign);url.searchParams.set('data',data);
      check(operation);return url;
    }finally{token='';cookies=null;}
  }
  async function exclusive(id,signal,work){
    id=identifier(id);ctx.getStore(id);if(disposed)fail('COLLECTOR_DISPOSED','账单读取服务已停止');
    if(signal?.aborted)fail('CANCELED','账单读取已取消');if(active.has(id))fail('SYNC_BUSY','当前店铺已有账单读取，请等待完成');
    const operation={abort:new AbortController(),reason:null};const cancel=()=>stop(operation,'CANCELED','账单读取已取消');
    signal?.addEventListener('abort',cancel,{once:true});active.set(id,operation);if(signal?.aborted)cancel();
    try{await verificationGuard(id,operation);check(operation);const result=await work(id,operation);await verificationGuard(id,operation);check(operation);const proof=bindings.get(id);if(!proof)fail('SOURCE_MISMATCH','本店账单读取绑定已变化');unchanged(id,proof);return result;}
    catch(error){forget(id);operation.abort.abort();check(operation);if(error instanceof FullSyncError)throw error;fail('REQUEST_FAILED','账单读取未完成，详细认证响应未输出');}
    finally{signal?.removeEventListener('abort',cancel);active.delete(id);}
  }
  async function prepare(id,signal){return exclusive(id,signal,async(storeId,operation)=>{const proof=await context(storeId,operation);check(operation);remember(storeId,proof);return {source:{...proof.source}};});}
  async function pageRead(id,input,signal,kind,policyNumber){
    const {request,descriptor,parse,route}=checkedRequest(input,kind,policyNumber);
    return exclusive(id,signal,async(storeId,operation)=>{
      const expected=bindings.get(storeId);if(!expected)fail('FINANCE_NOT_READY','账单读取尚未准备或页面已变化，请重新准备本店会话');
      if(kind==='insurance'&&expected.policies?.get(input.policyHash)!==policyNumber)fail('SOURCE_MISMATCH','保险保证金保单不属于当前准备的店铺会话');
      unchanged(storeId,expected);
      const previous=lastStarted.get(storeId),delay=previous===undefined?0:Math.max(0,minIntervalMs-(now()-previous));
      if(delay)await bounded(()=>new Promise(resolve=>{const done=()=>{clearTimeout(timer);operation.abort.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,delay);operation.abort.signal.addEventListener('abort',done,{once:true});if(operation.abort.signal.aborted)done();}),operation,delay+contextTimeoutMs,'REQUEST_TIMEOUT','账单请求间隔等待超时');
      check(operation);await verificationGuard(storeId,operation);const before=await context(storeId,operation);check(operation);
      if(bindings.get(storeId)!==expected||!same(expected,before))fail('SOURCE_MISMATCH','账单请求前店铺绑定已变化');
      return bounded(async()=>{
        // The caller never supplies an origin, URL, headers or arbitrary query.
        const url=await requestUrl(storeId,before,operation,descriptor,route);check(operation);await verificationGuard(storeId,operation);unchanged(storeId,before);
        const headers={Accept:'application/json',Referer:descriptor.headers.Referer};if(descriptor.headers['Content-Type'])headers['Content-Type']=descriptor.headers['Content-Type'];
        check(operation);lastStarted.set(storeId,now());
        const response=await before.session.fetch(url.href,{method:'GET',credentials:'include',redirect:'manual',cache:'no-store',headers,signal:operation.abort.signal});check(operation);
        if(response.status===429)fail('RATE_LIMITED','账单后台限制了读取频率，本次读取已停止');
        if(response.status===401)fail('LOGIN_EXPIRED','账单后台要求重新登录，本次读取已停止');
        if(response.status===403||response.status>=300&&response.status<400||response.redirected)fail('USER_VALIDATION_REQUIRED','账单后台要求登录或验证，本次读取已停止');
        if(!response.ok)fail('BACKEND_RESPONSE_FAILED','账单后台读取失败，本次读取已停止');
        if(response.url){const received=new URL(response.url);if(received.origin!==route.origin||received.pathname!==route.path)fail('REQUEST_NOT_ALLOWED','账单响应来自未经确认的位置');}
        if(!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|\s*$)/i.test(response.headers.get('content-type')||''))fail('USER_VALIDATION_REQUIRED','账单后台返回登录、验证或非数据页面，本次读取已停止');
        if(Number(response.headers.get('content-length'))>maxBytes)fail('RESPONSE_TOO_LARGE','账单单页数据超过读取上限');
        const reader=response.body.getReader(),chunks=[];let size=0;
        const cancelRead=()=>{Promise.resolve(reader.cancel()).catch(()=>{});};operation.abort.signal.addEventListener('abort',cancelRead,{once:true});
        try{for(;;){check(operation);const {done,value}=await reader.read();check(operation);if(done)break;size+=value.byteLength;if(size>maxBytes){cancelRead();fail('RESPONSE_TOO_LARGE','账单单页数据超过读取上限');}chunks.push(Buffer.from(value));}}
        finally{operation.abort.signal.removeEventListener('abort',cancelRead);try{reader.releaseLock();}catch{}}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'),(key,value,context)=>['deposit','insurance'].includes(kind)&&key==='jourId'&&typeof value==='number'&&/^\d+$/.test(context?.source||'')?context.source:value);}catch{fail('INVALID_RESPONSE','账单后台返回格式无效');}
        responseFailure(body);
        if(Array.isArray(body?.ret)&&body.ret.some(ret=>typeof ret==='string'&&/TOKEN_EXOIRED|FAIL_SYS_LOGIN/i.test(ret)))fail('LOGIN_EXPIRED','本店财务会话已过期，本次读取已停止，不会刷新或重试');
        const page=parse(body,request);check(operation);
        await verificationGuard(storeId,operation);const after=await context(storeId,operation);check(operation);
        if(bindings.get(storeId)!==expected||!same(before,after))fail('SOURCE_MISMATCH','读取期间本店身份发生变化，账单结果已丢弃');
        if(kind==='policyList'){
          expected.policies=new Map(page.policyHashes.map((hash,index)=>[hash,page.policyNumbers[index]]));
          return {policyHashes:[...page.policyHashes],source:{...after.source}};
        }
        return kind==='policies'?{empty:page.empty,source:{...after.source}}:{page,source:{...after.source}};
      },operation,timeoutMs,'REQUEST_TIMEOUT','账单读取超时，本次读取已停止');
    });
  }
  async function insurancePage(id,input,signal){
    id=identifier(id);ctx.getStore(id);
    const policyNumber=bindings.get(id)?.policies?.get(input?.policyHash);
    if(!policyNumber)fail('FINANCE_NOT_READY','请先核对本店保证金保单，不能指定外部保单读取');
    return pageRead(id,input,signal,'insurance',policyNumber);
  }
  function dispose(){disposed=true;for(const operation of active.values())stop(operation,'COLLECTOR_DISPOSED','账单读取服务已停止');for(const id of [...bindings.keys()])forget(id);lastStarted.clear();}
  return {prepare,billingPage:(id,input,signal)=>pageRead(id,input,signal,'billing'),depositPage:(id,input,signal)=>pageRead(id,input,signal,'deposit'),refundPage:(id,input,signal)=>pageRead(id,input,signal,'refund'),productRefundPage:(id,input,signal)=>pageRead(id,input,signal,'productRefund'),depositPolicies:(id,input,signal)=>pageRead(id,input,signal,'policies'),guaranteePolicies:(id,input,signal)=>pageRead(id,input,signal,'policyList'),insurancePage,dispose};
}
module.exports={createFinanceTransport,sellerIdentity,readSellerIdentity};
