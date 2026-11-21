'use strict';

// 品牌新享（阿里妈妈天猫品牌新享数据中心）只读传输层。
//
// 2026-10-09 用真实会话核对：
//   1. 该店登录态在 ppxk.tmall.com 上可以通过淘宝 SSO 自动生效；
//   2. 接口 /new/api/querySellerDataView.json 需要页面自身带上 timeStr 与 dynamicToken
//      （由页面里的巴夏/Baxia 风控脚本生成，无法在主进程里自行拼出来）；
//   3. 因此做法是：在该店自己的页面上打开品牌新享数据中心页，用调试器捕获它自己发出的
//      一次签名请求作为模板，然后只替换 param（日期/分页/编码）重放——与“评价晒图”捕获
//      订单模板的做法一致。Token 过期时重新加载页面再捕获一次。
// 只读取当前店铺自己的会话；不登录、不刷新其他店铺、不写任何数据。
const {FullSyncError}=require('./full-sync');
const {identifier}=require('./domain');

const PPXK='https://ppxk.tmall.com';
const PAGE_URL=`${PPXK}/new/index.htm#!/data-center/summary/index`;
const API_PATH='/new/api/querySellerDataView.json';
const fail=(code,message)=>{throw new FullSyncError(code,message);};
// 失败原因只保留错误代码与“域名+路径”，绝不带出查询串、Cookie 或响应正文。
const safeReason=error=>String(error?.code||error?.message||error||'').replace(/https?:\/\/[^\s'"]+/g,value=>{try{const parsed=new URL(value);return parsed.origin+parsed.pathname;}catch{return '[链接]';}}).slice(0,160);
const delay=(ms,signal)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  const abort=()=>{clearTimeout(timer);reject(new FullSyncError('CANCELED','品牌新享读取已取消'));};
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
});

// 页面侧脚本：只读出顶部店名与登录/风控状态，不改动页面。
function readPpxkIdentity(){
  const text=String(document.body?.innerText||'').slice(0,40000).replace(/\s+/g,' ');
  return {
    text,
    loginRequired:document.querySelectorAll('input[type="password"]').length>0||/请先登录|登录已失效|登录状态已失效/.test(text),
    blocked:/请完成(?:安全)?验证|滑动验证|访问受限|访问过于频繁|请拖动滑块/.test(text),
    storeName:(text.match(/([\u4e00-\u9fa5A-Za-z0-9()（）·\-]{2,40}店)[:：]/)||[])[1]||'',
  };
}

function createPpxkTransport(ctx,{captureTimeoutMs=45000,timeoutMs=25000,maxBytes=8*1024*1024,refreshOnFailure=true,purpose='business-ppxk'}={}){
  const bindings=new Map();let disposed=false;
  const check=()=>{if(disposed)fail('COLLECTOR_DISPOSED','品牌新享读取服务已停止');};
  async function pageFor(storeId,signal){
    const store=ctx.getStore(storeId);
    const wc=await ctx.browser.page(storeId,'seller',{show:false,purpose,background:true});
    if(!wc||wc.isDestroyed?.())fail('PAGE_REQUIRED','请先在店铺登录里打开并登录该店铺的千牛页面');
    const currentUrl=()=>{try{return String(wc.getURL?.()||'');}catch{return '';}};
    // 跳到品牌新享数据中心：这一步可能被“当前页面还没走完的导航”顶掉（Electron 会报已取消），
    // 所以这里最多重试 4 次，并且只有页面真的落到 ppxk.tmall.com 之后才算就绪。
    const deadline=Date.now()+30000;
    let attempts=0,evidence=null,landedUrl=currentUrl();
    while(Date.now()<deadline){
      if(signal?.aborted)fail('CANCELED','品牌新享读取已取消');
      landedUrl=currentUrl();
      if(!landedUrl.startsWith(PPXK)&&attempts<4){
        attempts++;
        try{await Promise.race([wc.loadURL(PAGE_URL).catch(()=>null),new Promise(resolve=>setTimeout(resolve,8000))]);}catch{}
        if(currentUrl().startsWith(PPXK))continue;
        await delay(800,signal);
        continue;
      }
      try{evidence=await wc.executeJavaScript(`(${readPpxkIdentity.toString()})()`,false);}catch{evidence=null;}
      if(evidence?.blocked)fail('USER_VALIDATION_REQUIRED','品牌新享页面要求安全验证，读取已停止');
      if(evidence?.loginRequired)fail('LOGIN_EXPIRED','品牌新享页面需要登录，请先在店铺浏览器里登录后重试');
      const name=typeof store?.name==='string'?store.name.trim():'';
      // 必须是品牌新享页面、并且页面上出现本店店名，才算登录与店铺都对上。
      if(landedUrl.startsWith(PPXK)&&evidence&&name&&String(evidence.text||'').includes(name))break;
      if(landedUrl.startsWith(PPXK)&&evidence&&name&&/店[:：]/.test(String(evidence.text||''))&&String(evidence.text||'').indexOf(name)<0)fail('SOURCE_MISMATCH','品牌新享页面显示的店铺与所选店铺不一致，未发起请求');
      await delay(700,signal);
    }
    if(!landedUrl.startsWith(PPXK))fail('LOGIN_EXPIRED','品牌新享页面无法打开，读取已停止');
    if(!evidence||!String(evidence.text||'').includes(String(store.name||'').trim()))fail('LOGIN_UNCONFIRMED','尚未确认品牌新享页面的登录状态，请先在工作台里打开该页并等待加载完成');
    return {wc,source:{platformShopId:'',shopName:store.name,identityType:'visible-name'}};
  }
  // 捕获页面自己发出的签名请求（含 timeStr / dynamicToken），作为只读模板。
  async function captureTemplate(storeId,wc,signal){
    const debuggerClient=wc.debugger;
    if(!debuggerClient||typeof debuggerClient.sendCommand!=='function')fail('PAGE_REQUIRED','当前环境无法捕获品牌新享请求，读取已停止');
    let template='',owns=false;
    const onMessage=(_event,method,params={})=>{
      if(template)return;
      if(method!=='Network.requestWillBeSent')return;
      const url=String(params.request?.url||'');
      if(url.startsWith(PPXK+API_PATH))template=url;
    };
    try{
      if(!debuggerClient.isAttached()){debuggerClient.attach('1.3');owns=true;}
      debuggerClient.on('message',onMessage);
      await debuggerClient.sendCommand('Network.enable');
      // 需求（2026-10-13）：只 reload 一次时，若页面把路由恢复成别的页签就不会再发那个签名请求
      // （用户实测：“没有捕获到品牌新享的数据请求”）。改成在总预算内分段重试：第一轮重新打开
      // “品牌新享 → 数据中心 → 基础数据”，之后每轮重新加载一次，页面一发出请求就立刻继续。
      const deadline=Date.now()+captureTimeoutMs;
      let round=0;
      while(!template&&Date.now()<deadline){
        if(signal?.aborted)fail('CANCELED','品牌新享读取已取消');
        round+=1;
        try{
          // 第一轮先按老办法重新加载；后续轮次先回到“数据中心 → 基础数据”路由再加载，
          // 覆盖“页面把路由恢复成别的页签、不再发签名请求”的情况。
          if(round>1)await wc.loadURL(PAGE_URL).catch(()=>null);
          await wc.reload();
        }catch{}
        const roundDeadline=Math.min(deadline,Date.now()+15000);
        while(!template&&Date.now()<roundDeadline){
          if(signal?.aborted)fail('CANCELED','品牌新享读取已取消');
          await delay(400,signal);
        }
      }
    }catch(error){
      if(error instanceof FullSyncError)throw error;
      fail('PPXK_CAPTURE_FAILED','无法监听品牌新享页面（请关闭该页面的开发者工具后重试）：'+safeReason(error));
    }finally{
      try{debuggerClient.removeListener('message',onMessage);}catch{}
      try{if(owns&&debuggerClient.isAttached())debuggerClient.detach();}catch{}
    }
    if(!template)fail('PPXK_TEMPLATE_MISSING','没有捕获到品牌新享的数据请求，读取已停止；请在工作台的店铺浏览器里打开“品牌新享 → 数据中心 → 基础数据”并刷新一次后重试');
    return template;
  }
  function buildUrl(template,params){
    const url=new URL(template);
    const raw=url.searchParams.get('param');
    let base={};
    if(raw){try{base=JSON.parse(raw)||{};}catch{fail('PPXK_TEMPLATE_INVALID','品牌新享请求模板无法解析，读取已停止');}}
    const next={...base};
    for(const key of ['page','pageSize','code','needTotalCount','filterParams','orderParam','dataBoardFilterParams'])if(params[key]!==undefined)next[key]=params[key];
    url.searchParams.set('param',JSON.stringify(next));
    return url.href;
  }
  async function fetchUrl(wc,url,signal){
    check();
    let response;
    try{response=await wc.session.fetch(url,{method:'GET',credentials:'include',redirect:'manual',cache:'no-store',headers:{Accept:'application/json, text/javascript, */*; q=0.01',Referer:`${PPXK}/new/index.htm`,'X-Requested-With':'XMLHttpRequest'}});}
    catch(error){if(signal?.aborted)fail('CANCELED','品牌新享读取已取消');return {failed:true,reason:safeReason(error)};}
    if(response.status===429)fail('RATE_LIMITED','品牌新享后台限制了读取频率，本次读取已停止');
    if(response.status===401)fail('LOGIN_EXPIRED','品牌新享后台要求重新登录，本次读取已停止');
    if(response.status===403||response.status>=300&&response.status<400||response.redirected)return {expired:true,status:response.status};
    if(!response.ok)return {failed:true,reason:'HTTP '+response.status};
    const text=await response.text();
    if(text.length>maxBytes)fail('RESPONSE_TOO_LARGE','品牌新享单页数据超过读取上限');
    let body=null;try{body=JSON.parse(text);}catch{}
    if(!body||typeof body!=='object')return {failed:true,reason:'返回不是 JSON'};
    if(!body.info||body.info.ok!==true){
      const message=String(body.info&&body.info.message||'').slice(0,120);
      // 品牌新享自己的限频提示（“请求太快啦~~ 请稍后再试试。”）单独识别，按可重试处理。
      if(/太快|稍后|频繁|限流|too\s*fast|rate/i.test(message))return {throttled:true,reason:message};
      return {backendRet:message};
    }
    return {data:body.data??{}};
  }
  async function prepare(id,signal){
    const storeId=identifier(id);check();
    const {wc,source}=await pageFor(storeId,signal);
    const template=await captureTemplate(storeId,wc,signal);
    bindings.set(storeId,{wc,template,source});
    return {source:{...source}};
  }
  async function query(id,api,params,signal){
    const storeId=identifier(id);check();
    if(api!=='sellerDataView')fail('REQUEST_NOT_ALLOWED','品牌新享接口不在已核实的只读清单内');
    let binding=bindings.get(storeId);
    if(!binding){await prepare(storeId,signal);binding=bindings.get(storeId);}
    if(!binding||binding.wc.isDestroyed?.())fail('PAGE_REQUIRED','品牌新享页面已关闭，请重新同步');
    let result=await fetchUrl(binding.wc,buildUrl(binding.template,params),signal);
    // 平台限频时退避重试（1.5s / 3s / 6s），仍失败才报错；不会把提示当成数据。
    for(let attempt=0;result.throttled&&attempt<3;attempt++){
      await delay(1500*Math.pow(2,attempt),signal);
      result=await fetchUrl(binding.wc,buildUrl(binding.template,params),signal);
    }
    if(result.throttled)fail('RATE_LIMITED','品牌新享提示“'+String(result.reason||'请求太快')+'”，本次读取已停止；请稍后重试，已读到的日期会保留断点');
    if((result.expired||result.failed)&&refreshOnFailure){
      // Token 过期或被风控拦截：重新打开页面捕获一次新模板，再重试一次。
      const {wc,source}=await pageFor(storeId,signal);
      const template=await captureTemplate(storeId,wc,signal);
      binding={wc,template,source};bindings.set(storeId,binding);
      result=await fetchUrl(binding.wc,buildUrl(binding.template,params),signal);
    }
    if(result.expired)fail('LOGIN_EXPIRED','品牌新享后台要求重新登录，本次读取已停止');
    if(result.failed)fail('REQUEST_FAILED',`品牌新享请求未完成：${result.reason||'未知原因'}`);
    if(result.backendRet)fail('BACKEND_RESPONSE_FAILED',result.backendRet);
    return result.data;
  }
  return {prepare,query,dispose(){disposed=true;bindings.clear();}};
}
module.exports={createPpxkTransport,PPXK,PAGE_URL,API_PATH,readPpxkIdentity};
