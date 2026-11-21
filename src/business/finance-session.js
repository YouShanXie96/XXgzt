'use strict';

// Structural classification of one store's own MTOP signing cookie.
//
// Rules kept by this module:
// - Only the prepared store page's own persisted session may supply the cookie.
// - Cookie values are used once for the request signature and never returned,
//   logged, persisted or embedded in a diagnosis.
// - No renewal request, no retry, no fallback to another store or to a
//   reference helper profile.
// - The four recorded categories are exactly 缺失 / 多条 / 域名或路径不匹配 /
//   已过期（含格式无效）, so an operator can tell which case really happened.

const {FullSyncError}=require('./full-sync');

const COOKIE_NAME='_m_h5_tk';
// Confirmed official container domains; the store page's own host is also
// accepted so a first-party host-scoped cookie is never rejected.
const BASE_DOMAINS=Object.freeze(['taobao.com','m.taobao.com']);
const CATEGORY_LABELS=Object.freeze({
  missing:'缺失',
  multiple:'多条',
  'domain-path':'域名或路径不匹配',
  expired:'已过期',
});
const CATEGORY_MESSAGES=Object.freeze({
  missing:'本店财务签名会话缺失：本店持久会话没有可用于财务签名的会话 Cookie，本次读取已停止，不会自动刷新或改用其他店铺会话',
  multiple:'本店财务签名会话有多条候选：本店持久会话返回多条财务签名 Cookie，无法确认唯一来源，本次读取已停止，不会自动刷新或改用其他店铺会话',
  'domain-path':'本店财务签名会话的域名或路径与本次只读入口不一致，本次读取已停止，不会改用其他店铺或参考软件的会话',
  expired:'本店财务签名会话已过期或格式无效，本次读取已停止，不会自动刷新',
});

function scopeOf(origin,path){
  let host='';
  try{host=new URL(origin).hostname;}catch{host='';}
  return {host,path:String(path||'')};
}
function signingSessionFailure(category,extra={}){
  if(!Object.hasOwn(CATEGORY_LABELS,category))throw new TypeError('财务签名会话诊断类型无效');
  const error=new FullSyncError('LOGIN_EXPIRED',CATEGORY_MESSAGES[category]);
  // Structural, value-free diagnosis: category, candidate count and the scope
  // that was checked. Never the cookie value or its token.
  error.diagnosis={category,label:CATEGORY_LABELS[category],cookieName:COOKIE_NAME,candidates:0,scope:null,...extra};
  return error;
}
function cookieDomain(cookie){return String(cookie?.domain||'').replace(/^\./,'').toLocaleLowerCase('en-US');}
function parsedToken(value){
  if(typeof value!=='string')return null;
  const match=/^([A-Za-z0-9]{1,256})_(\d{13})$/.exec(value);
  return match?{token:match[1],expiresAt:Number(match[2])}:null;
}
/**
 * Classifies the signing cookies returned for one store's own session scope.
 * Returns {token,expiresAt} only when exactly one valid, unexpired cookie was
 * read; otherwise throws a FullSyncError carrying a value-free diagnosis.
 */
function inspectSigningCookie(cookies,{origin,path,now=Date.now}={}){
  const scope=scopeOf(origin,path),list=Array.isArray(cookies)?cookies:[];
  if(!list.length)throw signingSessionFailure('missing',{candidates:0,scope});
  if(list.length>1)throw signingSessionFailure('multiple',{candidates:list.length,scope});
  const cookie=list[0];
  if(cookie?.name!==COOKIE_NAME)throw signingSessionFailure('missing',{candidates:list.length,scope});
  const domain=cookieDomain(cookie),allowed=BASE_DOMAINS.includes(domain)||domain===scope.host;
  if(!allowed||!cookie.path||!scope.path.startsWith(cookie.path))throw signingSessionFailure('domain-path',{candidates:1,scope,observed:{domain,path:String(cookie.path||'')}});
  const parsed=parsedToken(cookie.value),timestamp=now();
  const expired=!parsed||!Number.isSafeInteger(timestamp)||timestamp<=0||parsed.expiresAt<=timestamp||cookie.expirationDate!==undefined&&(!Number.isFinite(cookie.expirationDate)||cookie.expirationDate*1000<=timestamp);
  if(expired)throw signingSessionFailure('expired',{candidates:1,scope,observed:!parsed?{format:'invalid'}:{format:'timestamp'}});
  return {token:parsed.token,expiresAt:parsed.expiresAt};
}
module.exports={COOKIE_NAME,BASE_DOMAINS,CATEGORY_LABELS,scopeOf,signingSessionFailure,inspectSigningCookie};
