'use strict';
const fs=require('node:fs/promises');
const {createHash,randomUUID}=require('node:crypto');
const {assertNoLinks,atomicWrite}=require('../lib/storage');

const TYPES=new Set(['owner','operator','support']);
// 兼容历史数据：v1.3.15 及更早用 xh- 前缀写加密记录，改名 XX 后仍要能读回。
const CREDENTIAL_FORMATS=new Set(['xx-local-accounts-dpapi-v1','xh-local-accounts-dpapi-v1']);
function credentialPath(storeId){return 'local-accounts/'+createHash('sha256').update(storeId).digest('hex').slice(0,24)+'.vault.json';}
function createCredentialService({dataDir,getStore,safeStorage,platform=process.platform}){
  const queues=new Map();let closed=false,closing=false,disposePromise;
  const available=()=>platform==='win32'&&safeStorage?.isEncryptionAvailable?.()===true;
  function requireEncryption(){if(!available())throw new Error('Windows 本机加密暂不可用，未保存账号密码。');}
  function scoped(storeId){getStore(storeId);if(closed)throw new Error('本机账号服务正在关闭');return credentialPath(storeId);}
  const metadata=record=>({id:record.id,type:record.type,username:record.username,updatedAt:record.updatedAt});
  async function read(storeId){
    const relative=scoped(storeId),filename=await assertNoLinks(dataDir,relative);
    let bytes;
    try{const stat=await fs.stat(filename);if(stat.size>1024*1024)throw new Error('invalid size');bytes=await fs.readFile(filename,'utf8');}
    catch(error){if(error.code==='ENOENT')return [];throw new Error('本机账号文件无法读取，请保留原文件。');}
    requireEncryption();
    try{
      const outer=JSON.parse(bytes);
      if(!CREDENTIAL_FORMATS.has(outer.format)||typeof outer.ciphertext!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(outer.ciphertext))throw Error('invalid format');
      const payload=JSON.parse(safeStorage.decryptString(Buffer.from(outer.ciphertext,'base64')));
      if(payload.storeId!==storeId||!Array.isArray(payload.accounts)||payload.accounts.length>20)throw Error('wrong store');
      const ids=new Set();
      for(const item of payload.accounts){
        if(typeof item.id!=='string'||ids.has(item.id)||!TYPES.has(item.type)||typeof item.username!=='string'||typeof item.password!=='string'||!item.username||!item.password)throw Error('invalid record');
        ids.add(item.id);
      }
      return payload.accounts;
    }catch{throw new Error('本机账号无法解密。请在原 Windows 用户下使用；换电脑后需要重新添加账号密码。');}
  }
  async function write(storeId,accounts){
    requireEncryption();let ciphertext;
    try{ciphertext=safeStorage.encryptString(JSON.stringify({storeId,accounts})).toString('base64');}
    catch{throw new Error('Windows 加密失败，账号密码未写入。');}
    await atomicWrite(dataDir,scoped(storeId),JSON.stringify({format:'xx-local-accounts-dpapi-v1',ciphertext}));
  }
  function serial(storeId,operation){
    if(closing)throw new Error('本机账号服务正在关闭');
    scoped(storeId);
    const pending=(queues.get(storeId)||Promise.resolve()).catch(()=>{}).then(operation);
    queues.set(storeId,pending);
    return pending.finally(()=>{if(queues.get(storeId)===pending)queues.delete(storeId);});
  }
  async function list(storeId){
    scoped(storeId);await queues.get(storeId);
    const accounts=await read(storeId);
    try{return {accounts:accounts.map(metadata),available:available()};}
    finally{accounts.forEach(item=>item.password='');}
  }
  async function handle(action,p={}){
    if(closing)throw new Error('本机账号服务正在关闭');
    scoped(p.storeId);
    if(action==='list')return list(p.storeId);
    if(action==='save')return serial(p.storeId,async()=>{
      requireEncryption();
      const username=typeof p.username==='string'?p.username.trim():'';
      const password=typeof p.password==='string'?p.password:'';
      if(!username||username.length>160||/[\u0000-\u001f\u007f]/.test(username))throw new Error('请输入有效账号，长度不超过160字。');
      if(!TYPES.has(p.type))throw new Error('请选择主账号、运营或客服类型。');
      if(password.length>1024||password.includes('\0'))throw new Error('密码格式无效。');
      const accounts=await read(p.storeId);
      try{
        const existing=p.id?accounts.find(item=>item.id===p.id):null;
        if(p.id&&!existing)throw new Error('本机账号已不存在，请刷新后重试。');
        if(!password&&!existing)throw new Error('首次添加账号需要填写密码。');
        if(accounts.some(item=>item.id!==p.id&&item.username===username))throw new Error('该账号已保存在此店铺，请编辑已有账号。');
        if(!existing&&accounts.length>=20)throw new Error('每家店铺最多保存20个本机账号。');
        const record={id:existing?.id||randomUUID(),type:p.type,username,password:password||existing.password,updatedAt:new Date().toISOString()};
        const next=existing?accounts.map(item=>item.id===existing.id?record:item):[...accounts,record];
        await write(p.storeId,next);
        return {accounts:next.map(metadata),available:true};
      }finally{accounts.forEach(item=>item.password='');}
    });
    if(action==='remove')return serial(p.storeId,async()=>{
      const accounts=await read(p.storeId);
      try{
        if(!accounts.some(item=>item.id===p.id))throw new Error('本机账号已不存在。');
        const next=accounts.filter(item=>item.id!==p.id);await write(p.storeId,next);
        return {accounts:next.map(metadata),available:available()};
      }finally{accounts.forEach(item=>item.password='');}
    });
    throw new Error('不支持的本机账号操作');
  }
  async function withCredential(storeId,id,operation){
    if(closing)throw new Error('本机账号服务正在关闭');
    scoped(storeId);await queues.get(storeId);const accounts=await read(storeId);
    try{
      const found=accounts.find(item=>item.id===id);if(!found)throw new Error('请先为这家店铺保存本机账号。');
      return await operation({username:found.username,password:found.password});
    }finally{accounts.forEach(item=>item.password='');}
  }
  function dispose(){
    if(disposePromise)return disposePromise;
    closing=true;
    disposePromise=Promise.allSettled([...queues.values()]).then(()=>{closed=true;});
    return disposePromise;
  }
  return {handle,withCredential,dispose};
}
module.exports={createCredentialService,credentialPath};
