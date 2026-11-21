'use strict';
const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {assertNoLinks,atomicWrite}=require('../lib/storage');

// This supplements Chromium's persistent cookie store; it never changes cookie
// expiry or stores authentication verdicts. Only the main process uses this API.
const DIRECTORY='browser/session-backup';
const FORMAT='xx-session-cookies-dpapi-v1';
// 兼容改名前的历史会话备份（xh- 前缀）。
const LEGACY_FORMAT='xh-session-cookies-dpapi-v1';
const MAX_FILE=16*1024*1024,MAX_COOKIES=4096;
const DOMAINS=['taobao.com','tmall.com','alimama.com','alicdn.com','alipay.com','1688.com'];
const SAME_SITE=new Set(['unspecified','no_restriction','lax','strict']);
const STORE_ID=/^[-a-zA-Z0-9]{1,80}$/;
function sessionBackupPath(storeId){
  if(typeof storeId!=='string'||!STORE_ID.test(storeId))throw new Error('店铺标识无效');
  return DIRECTORY+'/'+createHash('sha256').update(storeId).digest('hex').slice(0,24)+'.vault.json';
}
function cookieKey(cookie){return JSON.stringify([cookie.domain,cookie.path,cookie.name]);}
function sessionCookie(cookie){
  if(!cookie||cookie.session!==true||cookie.expirationDate!==undefined||cookie.partitionKey!==undefined||cookie.partitioned===true)return null;
  if(typeof cookie.domain!=='string'||!/^[.]?[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(cookie.domain))return null;
  const domain=cookie.domain.replace(/^\./,'');
  if(!DOMAINS.some(base=>domain===base||domain.endsWith('.'+base)))return null;
  if(typeof cookie.name!=='string'||cookie.name.length>4096||/[\u0000-\u0020\u007f;,=]/.test(cookie.name)
    ||typeof cookie.value!=='string'||cookie.value.length>16384||/[\u0000\r\n]/.test(cookie.value)
    ||typeof cookie.path!=='string'||!cookie.path.startsWith('/')||cookie.path.length>4096||/[\u0000-\u001f\u007f]/.test(cookie.path)
    ||typeof cookie.secure!=='boolean'||typeof cookie.httpOnly!=='boolean'||typeof cookie.hostOnly!=='boolean'
    ||cookie.hostOnly&&cookie.domain.startsWith('.')||!SAME_SITE.has(cookie.sameSite))return null;
  return {name:cookie.name,value:cookie.value,domain:cookie.domain,path:cookie.path,secure:cookie.secure,
    httpOnly:cookie.httpOnly,hostOnly:cookie.hostOnly,sameSite:cookie.sameSite,session:true};
}
function setDetails(cookie){
  const details={url:'https://'+cookie.domain.replace(/^\./,'')+'/',name:cookie.name,value:cookie.value,path:cookie.path,
    secure:cookie.secure,httpOnly:cookie.httpOnly,sameSite:cookie.sameSite};
  // Omitting domain preserves host-only cookies. Passing it would widen scope.
  if(!cookie.hostOnly)details.domain=cookie.domain;
  return details;
}

function createSessionPersistence({dataDir,safeStorage,platform=process.platform}){
  const states=new Map(),owners=new Map();let closing=false,disposePromise,resetting=false;
  function requireEncryption(){
    if(platform!=='win32'||safeStorage?.isEncryptionAvailable?.()!==true)throw new Error('Windows 本机加密不可用，无法安全保存或恢复店铺会话。');
  }
  async function read(storeId){
    const file=await assertNoLinks(dataDir,sessionBackupPath(storeId));let bytes;
    try{if((await fs.stat(file)).size>MAX_FILE)throw new Error('size');bytes=await fs.readFile(file,'utf8');}
    catch(error){if(error.code==='ENOENT')return [];throw new Error('店铺会话补存文件无法读取，请保留用户数据目录。');}
    requireEncryption();
    try{
      const outer=JSON.parse(bytes);
      if((outer.format!==FORMAT&&outer.format!==LEGACY_FORMAT)||typeof outer.ciphertext!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(outer.ciphertext))throw new Error('format');
      const payload=JSON.parse(safeStorage.decryptString(Buffer.from(outer.ciphertext,'base64')));
      if(payload.storeId!==storeId||!Array.isArray(payload.cookies)||payload.cookies.length>MAX_COOKIES)throw new Error('identity');
      const keys=new Set(),cookies=[];
      for(const raw of payload.cookies){
        const cookie=sessionCookie(raw);
        if(!cookie||keys.has(cookieKey(cookie)))throw new Error('cookie');
        keys.add(cookieKey(cookie));cookies.push(cookie);
      }
      return cookies;
    }catch{throw new Error('店铺会话补存无法解密或校验。请保留原文件；换电脑或 Windows 用户后需要重新登录。');}
  }
  async function write(state,cookies){
    requireEncryption();
    if(cookies.length>MAX_COOKIES)throw new Error('店铺会话数量超出本机安全保存限制。');
    let text;
    try{
      const ciphertext=safeStorage.encryptString(JSON.stringify({storeId:state.storeId,cookies})).toString('base64');
      text=JSON.stringify({format:FORMAT,ciphertext});
      if(text.length>MAX_FILE)throw new Error('size');
    }catch{throw new Error('店铺会话加密保存失败，请保留用户数据目录。');}
    if(!state.disabled)await atomicWrite(dataDir,sessionBackupPath(state.storeId),text);
  }
  async function snapshot(state){
    if(state.disabled)return;
    let raw;
    try{raw=await state.cookies.get({session:true});}
    catch{throw new Error('店铺会话无法读取，未覆盖已有补存。');}
    if(state.disabled)return;
    const cookies=raw.map(sessionCookie).filter(Boolean);
    try{await write(state,cookies);}
    finally{cookies.forEach(cookie=>{cookie.value='';});}
  }
  function schedule(state){
    if(state.disabled)return Promise.resolve();
    state.dirty=true;
    if(state.pending)return state.pending;
    const work=state.tail.catch(()=>{}).then(async()=>{
      await state.ready;
      while(state.dirty&&!state.disabled){state.dirty=false;await snapshot(state);}
      state.failure=null;
    });
    state.tail=work;state.pending=work;
    // Every event-triggered rejection is observed; flush/dispose still report it.
    void work.then(()=>{if(state.pending===work)state.pending=null;},error=>{
      state.failure=error;if(state.pending===work)state.pending=null;
    });
    return work;
  }
  async function restoreState(state){
    requireEncryption();
    const saved=await read(state.storeId);let restored=0;
    try{
      if(state.disabled)return {restored};
      let native;
      try{native=await state.cookies.get({});}
      catch{throw new Error('店铺会话无法读取，恢复已停止。');}
      const present=new Set(native.map(cookieKey));
      for(const cookie of saved){
        const key=cookieKey(cookie);
        if(state.disabled)break;
        // Native state and changes observed since attach always win. In
        // particular, deletion during an async read must not revive a login.
        if(present.has(key)||state.changedKeys.has(key))continue;
        try{await state.cookies.set(setDetails(cookie));restored++;}
        catch{throw new Error('店铺会话恢复失败，请在官方页面重新登录。');}
      }
      return {restored};
    }finally{saved.forEach(cookie=>{cookie.value='';});state.restoring=false;state.changedKeys.clear();}
  }
  function attach(storeId,session){
    sessionBackupPath(storeId);
    if(closing||resetting)throw new Error('店铺会话保存服务正在关闭或清理');
    const existing=states.get(storeId);
    if(existing){
      if(existing.disabled)throw new Error('此店铺的会话补存已停用');
      if(existing.session!==session)throw new Error('同一店铺不能绑定不同会话');
      return existing.ready;
    }
    const cookies=session?.cookies;
    if(!cookies||typeof cookies.get!=='function'||typeof cookies.set!=='function'||typeof cookies.on!=='function')throw new Error('店铺会话接口不可用');
    if(owners.has(session)&&owners.get(session)!==storeId)throw new Error('不同店铺不能共用登录会话');
    const state={storeId,session,cookies,disabled:false,restoring:true,changedKeys:new Set(),dirty:false,
      tail:Promise.resolve(),pending:null,failure:null};
    state.onChanged=(_event,cookie)=>{
      if(state.disabled)return;
      if(state.restoring&&cookie)state.changedKeys.add(cookieKey(cookie));
      void schedule(state);
    };
    states.set(storeId,state);owners.set(session,storeId);cookies.on('changed',state.onChanged);
    state.ready=restoreState(state);
    void state.ready.catch(()=>{});
    // The initial snapshot also removes skipped native/persistent replacements.
    void schedule(state);
    return state.ready;
  }
  async function flush(storeId){
    if(storeId!==undefined)sessionBackupPath(storeId);
    const selected=storeId===undefined?[...states.values()]:[states.get(storeId)].filter(Boolean);
    const results=await Promise.allSettled(selected.filter(state=>!state.disabled).map(state=>schedule(state)));
    const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  }
  function disable(state){if(!state)return;state.disabled=true;state.cookies.removeListener('changed',state.onChanged);}
  async function forget(storeId){
    const relative=sessionBackupPath(storeId),state=states.get(storeId);disable(state);
    if(state)await Promise.allSettled([state.ready,state.tail]);
    try{await fs.unlink(await assertNoLinks(dataDir,relative));}
    catch(error){if(error.code!=='ENOENT')throw new Error('店铺会话补存未能清除，请保留用户数据目录并重试。');}
  }
  async function forgetAll(){
    if(resetting)throw new Error('店铺会话补存正在清理');
    resetting=true;
    try{
      const old=[...states.values()];old.forEach(disable);
      await Promise.allSettled(old.flatMap(state=>[state.ready,state.tail]));
      const directory=await assertNoLinks(dataDir,DIRECTORY);let names;
      try{names=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')names=[];else throw error;}
      for(const entry of names){
        if(!/^[a-f0-9]{24}\.vault\.json$/.test(entry.name))continue;
        if(!entry.isFile()||entry.isSymbolicLink())throw new Error('补存路径异常');
        await fs.unlink(await assertNoLinks(dataDir,DIRECTORY+'/'+entry.name));
      }
      states.clear();owners.clear();
    }catch{throw new Error('店铺会话补存未能全部清除，请保留用户数据目录并重试。');}
    finally{resetting=false;}
  }
  function dispose(){
    if(disposePromise)return disposePromise;
    closing=true;
    disposePromise=flush().finally(()=>{for(const state of states.values())disable(state);});
    return disposePromise;
  }
  return {attach,restore:attach,flush,dispose,forget,forgetAll};
}
module.exports={createSessionPersistence,sessionBackupPath};
