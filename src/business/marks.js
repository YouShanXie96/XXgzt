'use strict';

// 精细化商品标记：黑名单与待办。只保存商品ID、时间、账号和待办内容，
// 不保存任何平台凭据；按店铺分文件存放，随业务备份一起迁移。
const {randomUUID}=require('node:crypto');
const {identifier,text,safeMessage}=require('./domain');
const {storeDirectory}=require('./repository');

const MAX_PRODUCTS=100000,MAX_TODOS_PER_PRODUCT=50;
const PRODUCT=/^\d{1,30}$/;
const empty=storeId=>({schemaVersion:1,storeId,updatedAt:null,todos:{},blacklist:{}});
function timestamp(value,label){
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new Error(label+'时间无效');
  return value;
}
function normalize(raw,storeId){
  if(raw===null)return empty(storeId);
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.schemaVersion!==1||raw.storeId!==storeId)throw new Error('标记数据格式或店铺归属无效，请保留文件检查');
  if(!raw.todos||typeof raw.todos!=='object'||Array.isArray(raw.todos)||!raw.blacklist||typeof raw.blacklist!=='object'||Array.isArray(raw.blacklist))throw new Error('标记数据结构无效，请保留文件检查');
  const todos={},blacklist={};
  for(const [productId,list]of Object.entries(raw.todos)){
    if(!PRODUCT.test(productId)||!Array.isArray(list)||list.length>MAX_TODOS_PER_PRODUCT)throw new Error('待办标记数据无效，请保留文件检查');
    const clean=list.map(item=>{
      if(!item||typeof item!=='object'||typeof item.id!=='string'||typeof item.content!=='string')throw new Error('待办标记数据无效，请保留文件检查');
      return {id:item.id,at:timestamp(item.at,'待办'),account:safeMessage(item.account||'','')||'',content:text(item.content,'待办内容',{max:500})};
    });
    if(clean.length)todos[productId]=clean;
  }
  for(const [productId,item]of Object.entries(raw.blacklist)){
    if(!PRODUCT.test(productId)||!item||typeof item!=='object'||typeof item.at!=='string')throw new Error('黑名单标记数据无效，请保留文件检查');
    blacklist[productId]={at:timestamp(item.at,'加黑'),account:safeMessage(item.account||'','')||''};
  }
  return {schemaVersion:1,storeId,updatedAt:raw.updatedAt?timestamp(raw.updatedAt,'更新'):null,todos,blacklist};
}

function createMarks(ctx,{now=()=>new Date(),account=()=>''}={}){
  if(!ctx||!['getStore','readJson','writeJson'].every(name=>typeof ctx[name]==='function'))throw new TypeError('标记服务缺少存储或店铺校验');
  const queues=new Map();
  const file=storeId=>`${storeDirectory(storeId,typeof ctx.storeFolder==='function'?ctx.storeFolder(storeId):null)}/marks.json`;
  const who=()=>{try{return text(String(account()||''),'账号',{max:80});}catch{return '';}};
  async function read(storeId){
    const id=identifier(storeId);await ctx.getStore(id);
    return normalize(await ctx.readJson(file(id),null),id);
  }
  async function mutate(storeId,work){
    const id=identifier(storeId);await ctx.getStore(id);
    const run=(queues.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{
      const current=await read(id),updatedAt=new Date(now()).toISOString();
      const next=work({...current,updatedAt});
      const payload=normalize(next,id);
      if(Object.keys(payload.todos).length>MAX_PRODUCTS)throw new Error('待办商品数量超过上限');
      await ctx.writeJson(file(id),payload);
      return payload;
    });
    queues.set(id,run);
    try{return await run;}finally{if(queues.get(id)===run)queues.delete(id);}
  }
  const productIds=value=>{
    const list=Array.isArray(value)?value:[value];
    const ids=[...new Set(list.map(item=>String(item??'').trim()))];
    if(!ids.length||ids.length>2000)throw new Error('一次最多处理 2000 个商品ID');
    for(const id of ids)if(!PRODUCT.test(id))throw new Error('商品ID必须是数字');
    return ids;
  };
  async function addTodo(storeId,{productIds:ids,content}={}){
    const list=productIds(ids),body=text(content,'待办内容',{required:true,max:500}),at=new Date(now()).toISOString(),accountName=who();
    return mutate(storeId,current=>{
      for(const productId of list){
        const entries=current.todos[productId]||[];
        if(entries.length>=MAX_TODOS_PER_PRODUCT)throw new Error('单个商品的待办数量超过上限');
        current.todos[productId]=[...entries,{id:randomUUID(),at,account:accountName,content:body}];
      }
      return current;
    });
  }
  async function removeTodo(storeId,{productId,todoId}={}){
    const id=String(productId??'').trim();if(!PRODUCT.test(id))throw new Error('商品ID必须是数字');
    return mutate(storeId,current=>{
      const entries=current.todos[id]||[];
      const next=todoId?entries.filter(item=>item.id!==todoId):[];
      if(todoId&&next.length===entries.length)throw new Error('待办记录不存在');
      if(next.length)current.todos[id]=next;else delete current.todos[id];
      return current;
    });
  }
  async function setBlacklist(storeId,{productIds:ids,remove=false}={}){
    const list=productIds(ids),at=new Date(now()).toISOString(),accountName=who();
    return mutate(storeId,current=>{
      for(const productId of list){
        if(remove)delete current.blacklist[productId];
        else current.blacklist[productId]={at,account:accountName};
      }
      return current;
    });
  }
  return {load:read,addTodo,removeTodo,setBlacklist};
}

module.exports={createMarks,MAX_PRODUCTS,MAX_TODOS_PER_PRODUCT};
