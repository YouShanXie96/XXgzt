'use strict';
// Per-store configuration only. This module never calculates a fee or profit;
// the business query layer applies the confirmed formulas.
const {identifier}=require('./domain');
const {storeDirectory}=require('./repository');
const RATE_KEYS=Object.freeze(['domesticRate','overseasRate','taxVat','taxIncome','taxStamp']);
const AMOUNT_KEYS=Object.freeze(['technicalFee','warehouseExpense','serviceMonthlyFee','logisticsPerOrder']);
const KEYS=Object.freeze([...RATE_KEYS,...AMOUNT_KEYS]);
const RECORD_KEYS=Object.freeze(['schemaVersion','storeId',...KEYS,'updatedAt']);
function rate(value,label){
  if(value===null)return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100||!/^\d+(?:\.\d{1,4})?$/.test(String(value)))throw new Error(label+'必须为空或 0–100 之间的数值，最多保留4位小数');
  return Object.is(value,-0)?0:value;
}
const AMOUNT_LABELS={technicalFee:'技术费（每单）',warehouseExpense:'中转仓费用（每单）',serviceMonthlyFee:'客服费用（每月）',logisticsPerOrder:'操作单物流费（每单）'};
function amount(value,label){
  if(value===null)return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000000000||!/^\d+(?:\.\d{1,2})?$/.test(String(value)))throw new Error(label+'必须为空或 0 以上的金额，最多保留2位小数');
  return Object.is(value,-0)?0:value;
}
function values(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw new Error('费率设置字段无效');
  if(Reflect.ownKeys(raw).some(key=>!KEYS.includes(key)))throw new Error('费率设置包含未知字段');
  if(Object.values(Object.getOwnPropertyDescriptors(raw)).some(item=>!Object.hasOwn(item,'value')))throw new Error('费率设置不能包含动态字段');
  const result={};
  for(const key of RATE_KEYS)result[key]=raw[key]===undefined?null:rate(raw[key],key==='domesticRate'?'国内费率':key==='overseasRate'?'海外费率':key==='taxVat'?'增值税率':key==='taxIncome'?'企业所得税率':'印花税率');
  for(const key of AMOUNT_KEYS)result[key]=raw[key]===undefined?null:amount(raw[key],AMOUNT_LABELS[key]);
  return result;
}
function record(raw,storeId){
  // 旧版只保存了国内/海外费率（schemaVersion 1），读取时其余字段按“未设置”处理。
  if(raw===null)return {storeId,...Object.fromEntries(KEYS.map(key=>[key,null])),updatedAt:null};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('已保存费率格式无效，请保留文件检查');
  const allowed=new Set(RECORD_KEYS);
  if(Reflect.ownKeys(raw).some(key=>!allowed.has(key)))throw new Error('已保存费率包含未知字段，请保留文件检查');
  if(![1,2].includes(raw.schemaVersion)||raw.storeId!==storeId||typeof raw.updatedAt!=='string'||!Number.isFinite(Date.parse(raw.updatedAt))||new Date(raw.updatedAt).toISOString()!==raw.updatedAt)throw new Error('已保存费率格式或店铺归属无效，请保留文件检查');
  return {storeId,...values(Object.fromEntries(KEYS.map(key=>[key,raw[key]??null]))),updatedAt:raw.updatedAt};
}
function createFeeSettings(ctx,{now=()=>new Date()}={}){
  if(!ctx||!['getStore','readJson','writeJson'].every(name=>typeof ctx[name]==='function'))throw new TypeError('费率设置缺少存储或店铺校验服务');
  const pending=new Map();
  async function checked(storeId){const id=identifier(storeId),store=await ctx.getStore(id);if(!store||store.id!==id)throw new Error('费率设置所属店铺不存在');return id;}
  const filename=storeId=>`${storeDirectory(storeId,typeof ctx.storeFolder==='function'?ctx.storeFolder(storeId):null)}/fee-settings.json`;
  async function settled(storeId){while(pending.has(storeId))await pending.get(storeId).catch(()=>{});}
  async function load(storeId){
    const id=await checked(storeId);await settled(id);await checked(id);
    const result=record(await ctx.readJson(filename(id),null),id);await checked(id);return result;
  }
  async function save(storeId,raw){
    const clean=values(raw),id=await checked(storeId);
    const work=(pending.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{
      await checked(id);const updatedAt=new Date(now()).toISOString();
      const next={schemaVersion:2,storeId:id,...clean,updatedAt};
      await ctx.writeJson(filename(id),next);return {storeId:id,...clean,updatedAt};
    });
    pending.set(id,work);
    try{return await work;}finally{if(pending.get(id)===work)pending.delete(id);}
  }
  return {load,save};
}
module.exports={createFeeSettings,KEYS,RATE_KEYS,AMOUNT_KEYS};
