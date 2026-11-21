'use strict';

// Electron emits navigation events for subframes as well as the main document.
// did-start-navigation supplies details.isMainFrame in current Electron and the
// fourth argument in older versions. did-navigate-in-page still uses argument 3.
// Loading-spinner events have no frame identity and must not represent a change
// of shop. Unknown navigation details remain fail-closed.
function affectsAccount(details,legacyUrl,legacyIsMainFrame){
 const isMainFrame=typeof details?.isMainFrame==='boolean'?details.isMainFrame:legacyIsMainFrame;
 if(isMainFrame!==false)return true;
 const target=typeof details?.url==='string'?details.url:legacyUrl;
 if(typeof target!=='string'||!target)return true;
 try{
  const url=new URL(target);
  // Even inside an iframe a login or security challenge invalidates an ongoing
  // read. Only routine subframe navigations are ignored; no requests are retried.
  return /login|passport|captcha|punish|verify|verification|security|validate/i.test(url.hostname+url.pathname);
 }catch{return true;}
}
function navigationAffectsAccount(details,url,_isInPlace,isMainFrame){return affectsAccount(details,url,isMainFrame);}
function inPageNavigationAffectsAccount(details,url,isMainFrame){return affectsAccount(details,url,isMainFrame);}
// 单页应用（千牛首页、万相台、生意参谋）在登录态出来之后还会自己换路由；
// 同一个后台站点内的“页内跳转”不换账号，不应把正在进行的读取打断。
function sameBackendRoute(details,legacyUrl,legacyIsInPlace,legacyIsMainFrame){
 const isMainFrame=typeof details?.isMainFrame==='boolean'?details.isMainFrame:legacyIsMainFrame;
 if(isMainFrame===false)return false;
 if(!(details?.isInPlace===true||legacyIsInPlace===true))return false;
 const target=typeof details?.url==='string'?details.url:legacyUrl;
 if(typeof target!=='string'||!target)return false;
 try{
  const url=new URL(target);
  if(url.protocol!=='https:')return false;
  if(!/(?:^|\.)(?:taobao|tmall|alibaba)\.com$/i.test(url.hostname))return false;
  return !/login|passport|captcha|punish|verify|verification|security|validate/i.test(url.hostname+url.pathname);
 }catch{return false;}
}
// 只比较站点与路径：SPA 的 hash/查询串变化不算换页。
// 千牛首页有两套等价路由（旧 /home.htm 与新工作台 /home.htm/QnworkbenchHome/），
// 登录后页面会在两者之间自跳；这是同一家店的工作台，不应按“换页/换账号”处理。
const isSellerHomePath=pathname=>/^\/home\.htm(?:\/QnworkbenchHome)?\/?$/i.test(String(pathname||''));
function samePageUrl(left,right){
 try{
  const a=new URL(String(left||'').trim()),b=new URL(String(right||'').trim());
  if(a.origin!==b.origin)return false;
  if(a.hostname.toLowerCase()==='myseller.taobao.com'&&isSellerHomePath(a.pathname)&&isSellerHomePath(b.pathname))return true;
  return a.pathname===b.pathname;
 }catch{return false;}
}
module.exports={navigationAffectsAccount,inPageNavigationAffectsAccount,sameBackendRoute,samePageUrl};
