'use strict';

// Only public page state is observed. Cookies, form values and account tokens are
// deliberately outside this module; an existing cookie is not proof of login.
const BACKENDS = Object.freeze([
  {kind:'seller',label:'店铺后台'},
  {kind:'promotion',label:'推广后台'},
  {kind:'sycm',label:'生意参谋'},
  {kind:'traffic',label:'流量解析'},
  {kind:'dmp',label:'达摩盘'}
]);
const SELLER_KINDS = new Set(['seller','reviews','orders','purchase','qualification']);
const STATUS_LABELS = Object.freeze({unknown:'待检查','login-required':'需要登录','verification-required':'需要验证',verified:'已登录',error:'页面异常'});
function backendForKind(kind){return SELLER_KINDS.has(kind)?'seller':kind;}
function isAccountStatusPage(page){
  return page.open&&(!page.popup||(page.visible&&['login-required','verification-required'].includes(page.authentication?.status)));
}
function accountPagesForBackend(pages,kind){
  let matching=pages.filter(page=>backendForKind(page.kind)===kind&&isAccountStatusPage(page));
  // Prefer the central seller page over old reviews/orders login tabs, while
  // retaining a live login challenge opened from any seller-backed module.
  if(kind==='seller'&&matching.some(page=>page.kind==='seller'&&!page.popup))matching=matching.filter(page=>page.kind==='seller'||page.popup);
  return matching;
}
function safePageUrl(value){
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.origin:'';}catch{return '';}
}
function expectedHost(host,kind){
  const expected={seller:'myseller.taobao.com',promotion:'one.alimama.com',traffic:'one.alimama.com',sycm:'sycm.taobao.com',dmp:'dmp.taobao.com'}[backendForKind(kind)];
  return host===expected;
}
function isSellerWorkbenchPath(value){return /^\/home\.htm(?:\/QnworkbenchHome)?\/?$/i.test(value);}
// The current merchant login shell embeds the official Havana login frame.
// These are negative login evidence only; successful account evidence still
// requires the exact backend host and its observed authenticated page content.
function isLoginHost(host){return host==='loginmyseller.taobao.com'||host==='havanalogin.taobao.com'||/^(?:login|passport|signin)\./i.test(host);}
function authenticationFromEvidence({url,kind,evidence={}}){
  let parsed;try{parsed=new URL(url);}catch{return {status:'unknown',message:'页面尚未就绪，登录状态待确认。'};}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password)return {status:'unknown',message:'当前页面不能用于确认登录。'};
  const route=parsed.pathname+parsed.hash.split('?')[0];
  if(evidence.verification===true||/\/(?:punish|captcha|safeverify|security-check)(?:[/.#]|$)/i.test(route))return {status:'verification-required',message:'请在官方窗口完成安全验证，再检查状态。'};
  if(evidence.password===true||evidence.login===true||isLoginHost(parsed.hostname)||/(?:^|[/#!])(?:login|signin)(?:[/.#]|$)/i.test(route))return {status:'login-required',message:'官方页面要求登录，请在店铺窗口完成登录。'};
  const workbench=evidence.sellerWorkbench;
  const sellerWorkbench=backendForKind(kind)==='seller'&&isSellerWorkbenchPath(parsed.pathname)&&
    workbench?.identity===true&&Number(workbench.menuCount)>=5&&Number(workbench.metricCount)>=2;
  const sycmWorkspace=kind==='sycm'&&evidence.sycmWorkspace?.identity===true&&
    evidence.sycmWorkspace.logout===true&&Number(evidence.sycmWorkspace.menuCount)>=5;
  if(expectedHost(parsed.hostname,kind)&&(sellerWorkbench||sycmWorkspace||(evidence.logout===true&&Number(evidence.navigationCount)>=2)))return {status:'verified',message:'当前官方页面显示已登录；请核对窗口中的店铺身份。'};
  if(backendForKind(kind)==='seller'&&expectedHost(parsed.hostname,kind)&&isSellerWorkbenchPath(parsed.pathname)){
    return {status:'unknown',message:workbench?.identity===true?'已读到店铺身份，后台首页的菜单或待办信息尚不完整，请等待加载完成后再检查。':'已打开千牛首页，暂未读到完整的店铺身份和待办信息，请等待加载完成后再检查。'};
  }
  return {status:'unknown',message:'已打开共用会话窗口，当前页面没有足够证据确认登录。'};
}

function readSellerWorkbenchEvidence(visible){
  const empty={identity:false,menuCount:0,metricCount:0};
  try{if(!isSellerWorkbenchPath(new URL(location.href).pathname))return empty;}catch{return empty;}
  const text=node=>String(node?.innerText||node?.textContent||'').trim().replace(/\s+/g,' ');
  const displayNode=node=>!node.closest?.('input,textarea,select,[contenteditable]')&&visible(node);
  // Observed in the live official Qianniu shell. This is the displayed shop
  // identity, never a locally entered store name, form value, cookie or token.
  const identity=[...document.querySelectorAll('.user-area-pop-up-panel [class*="shopName--"]')].some(node=>{
    const name=text(node);
    return displayNode(node)&&name.length>=2&&name.length<=80&&
      !/^(店铺|店铺名称|我的店铺|未登录|请登录|登录|账号|昵称)$/.test(name);
  });
  if(!identity)return empty;
  const menus=['首页','常用','营销','交易','商品','物流','推广','客服','店铺','私域','财务','金融','数据'];
  const menuNodes=[...document.querySelectorAll('[class*="navListWrap--"] a[role="button"]')].filter(displayNode).map(text);
  const menuCount=menus.filter(label=>menuNodes.includes(label)).length;
  const metrics=['待发货','待回复评价','待付款','待处理退款','待处理售后','改地址申请'];
  const number=/^(?:[¥￥]\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*(?:万|亿|%|元|人|笔|单|件))?$/;
  const measured=new Set();
  // These card/label/value classes were read from the live homepage. Only pair
  // a label with a displayed value from that same actual TODO item; help copy
  // or numbers elsewhere in the document do not count as account evidence.
  for(const item of document.querySelectorAll('#QN_TODO_LIST a[class*="QnToDoListContainer_dataItem__"]')){
    if(!displayNode(item))continue;
    const labels=[...item.querySelectorAll('span[class*="QnToDoListContainer_label__"]')].filter(displayNode).map(text);
    const values=[...item.querySelectorAll('span[class*="QnToDoListContainer_value__"]')].filter(displayNode).map(text);
    if(labels.length===1&&metrics.includes(labels[0])&&values.length===1&&number.test(values[0]))measured.add(labels[0]);
  }
  return {identity,menuCount,metricCount:measured.size};
}

function readSycmWorkspaceEvidence(visible){
  const empty={identity:false,logout:false,menuCount:0};
  try{if(new URL(location.href).origin!=='https://sycm.taobao.com')return empty;}catch{return empty;}
  const text=node=>String(node?.innerText||node?.textContent||'').trim();
  const inHeader=node=>{
    if(!visible(node)||node.closest?.('input,textarea,select,[contenteditable]'))return false;
    const top=node.getBoundingClientRect().top;return top>=0&&top<180;
  };
  // Observed in the current SYCM shell. The shop selector also contains a
  // "主店" badge; remove only the separate observed badge line, not arbitrary
  // words from the actual shop name. No name or token leaves this observation.
  const shops=[...document.querySelectorAll('.ebase-frame-header-headerShopSelect')].filter(inHeader);
  const identity=shops.length===1&&(()=>{
    const shop=shops[0],lines=text(shop).split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
    const badges=[...shop.querySelectorAll('span[class*="-shopTextIcon-"]')].filter(visible).map(text);
    while(lines.length&&badges.includes(lines.at(-1)))lines.pop();
    if(lines.length!==1)return false;
    const name=lines[0];return name.length>=2&&name.length<=80&&
      !/^(主店|店铺|店铺名称|我的店铺|未登录|请登录|登录|账号|昵称)$/.test(name);
  })();
  const logout=[...document.querySelectorAll('a.ebase-frame-header-userLink')].filter(inHeader).some(node=>text(node)==='退出');
  const menus=['首页','交易','流量','客户','商品','营销','服务','内容','市场','自助分析','业务专区'];
  const controls=[...document.querySelectorAll('a,button,[role="button"],nav li,[role="menuitem"]')].filter(inHeader).map(text);
  return {identity,logout,menuCount:menus.filter(label=>controls.includes(label)).length};
}

function observationScript(kind){
  const labels={
    seller:['商品管理','交易管理','店铺管理','客户运营','订单管理','已卖出的宝贝','店铺装修','发布宝贝','经营概览'],
    promotion:['推广计划','账户余额','账户信息','推广管理','报表','营销场景','流量解析'],
    traffic:['推广计划','账户余额','账户信息','推广管理','报表','营销场景','流量解析'],
    sycm:['经营分析','经营概览','实时概况','流量分析','商品分析','交易分析','生意参谋','市场洞察'],
    dmp:['人群管理','洞察分析','竞争洞察','市场榜单','人群洞察','竞争分析','达摩盘']
  }[backendForKind(kind)]||[];
  return `(() => {
    ${isSellerWorkbenchPath.toString()}
    ${isLoginHost.toString()}
    const visible = element => {
      if (!element || !element.getClientRects().length) return false;
      for (let node=element; node&&node.nodeType===1; node=node.parentElement) {
        const style=getComputedStyle(node);
        if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.opacity==='0')return false;
      }
      return true;
    };
    const text=String(document.body?.innerText||'').slice(0,120000);
    const controls=[...document.querySelectorAll('a,button,[role="button"],nav li,[role="menuitem"]')].slice(0,1500).filter(visible).map(node=>String(node.innerText||node.textContent||'').trim().replace(/\\s+/g,' ').slice(0,160));
    const hasVisible=selector=>[...document.querySelectorAll(selector)].some(visible);
    const logout=controls.some(value=>/^(退出登录|安全退出|退出|注销登录)$/.test(value));
    const navigationCount=${JSON.stringify(labels)}.filter(label=>controls.some(value=>value===label)).length;
    const password=hasVisible('input[type="password"]');
    const loginFrame=[...document.querySelectorAll('iframe')].filter(visible).some(frame=>{try{const u=new URL(frame.getAttribute('src')||'',location.href);return u.protocol==='https:'&&!u.username&&!u.password&&isLoginHost(u.hostname)&&!u.pathname.includes('login_check');}catch{return false;}});
    const login=loginFrame||(/扫码登录|账号密码登录|账户密码登录|请先登录|登录已失效|登录状态已失效/.test(text)&&controls.some(value=>/登录|重新登录/.test(value)));
    const verification=hasVisible('.nc-container,#nc_1_wrapper,[id^="baxia-dialog"],iframe[src*="captcha"],iframe[src*="punish"]')||/请完成安全验证|请拖动滑块|拖动下方滑块|访问验证|安全验证中/.test(text);
    const sellerWorkbench=${backendForKind(kind)==='seller'?`(${readSellerWorkbenchEvidence.toString()})(visible)`:'{identity:false,menuCount:0,metricCount:0}'};
    const sycmWorkspace=${kind==='sycm'?`(${readSycmWorkspaceEvidence.toString()})(visible)`:'{identity:false,logout:false,menuCount:0}'};
    return {password,login,verification,logout,navigationCount,sellerWorkbench,sycmWorkspace};
  })()`;
}
async function inspectAuthentication(wc,kind,{timeoutMs=1800}={}){
  const readUrl=()=>{try{return {url:wc.getURL?.()||'',failed:false};}catch{return {url:'',failed:true};}};
  const failure=(url,code)=>{
    const basic=authenticationFromEvidence({url,kind});
    const message=code==='AUTH_CHECK_TIMEOUT'?'登录状态检查超时，请等待官方页面加载完成后重试。':code==='AUTH_CHECK_INVALID_RESULT'?'登录状态检查未取得有效页面信息，请重新检查。':'暂时无法读取官方页面的登录状态，请重新打开后台或稍后重试。';
    return {status:basic.status==='unknown'?'error':basic.status,message:basic.status==='unknown'?message:basic.message+' '+message,url:safePageUrl(url),checkFailed:true,errorCode:code};
  };
  const initial=readUrl(),before=initial.url;
  if(initial.failed)return failure(before,'AUTH_CHECK_PAGE_UNAVAILABLE');
  const basic=authenticationFromEvidence({url:before,kind});
  // Login pages can contain an active slider challenge. Read their DOM before
  // treating them as a stale login screen that may safely re-enter an SSO URL.
  if(basic.status==='verification-required')return {...basic,url:safePageUrl(before)};
  if(typeof wc.executeJavaScript!=='function')return failure(before,'AUTH_CHECK_PAGE_UNAVAILABLE');
  let timer;
  try{
    const evidence=await Promise.race([
      wc.executeJavaScript(observationScript(kind),false),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Authentication observation timed out'),{code:'AUTH_CHECK_TIMEOUT'})),timeoutMs);})
    ]);
    const current=readUrl(),after=current.url;
    if(current.failed)return failure(after,'AUTH_CHECK_PAGE_UNAVAILABLE');
    // Navigation during observation invalidates any earlier success evidence.
    if(before!==after){const result=authenticationFromEvidence({url:after,kind});return {...result,message:result.status==='unknown'?'官方页面刚刚跳转，请等待加载完成后重新检查登录状态。':result.message,url:safePageUrl(after)};}
    if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))return failure(after,'AUTH_CHECK_INVALID_RESULT');
    const result=authenticationFromEvidence({url:after,kind,evidence});
    return {...result,url:safePageUrl(after)};
  }catch(error){return failure(readUrl().url,error?.code==='AUTH_CHECK_TIMEOUT'?'AUTH_CHECK_TIMEOUT':'AUTH_CHECK_PAGE_UNAVAILABLE');}
  finally{clearTimeout(timer);}
}
module.exports={BACKENDS,STATUS_LABELS,backendForKind,isAccountStatusPage,accountPagesForBackend,safePageUrl,authenticationFromEvidence,observationScript,inspectAuthentication};
