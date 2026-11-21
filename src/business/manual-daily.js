'use strict';

const {identifier,isoDate,text}=require('./domain');
const {storeDirectory}=require('./repository');

const FIELDS=new Set(['customProfit','reimbursementExpense']);
const MAX_HISTORY=50000;
function fieldOf(value){if(!FIELDS.has(value))throw new Error('仅支持自定义利润和报销费用手工调整');return value;}
function centsOf(value,field){
  field=fieldOf(field);
  if(typeof value!=='string'&&typeof value!=='number')throw new Error('金额必须填写为数值');
  const raw=String(value).trim(),match=/^(-?)(\d{1,10})(?:\.(\d{1,2}))?$/.exec(raw);
  if(!match)throw new Error('金额最多填写两位小数，不能包含逗号或其他字符');
  const cents=BigInt(match[2])*100n+BigInt((match[3]||'').padEnd(2,'0')||'0');
  const signed=match[1]? -cents:cents;
  if(field==='reimbursementExpense'&&signed<0n)throw new Error('报销费用不能为负数');
  if(signed>1000000000000n||signed< -1000000000000n)throw new Error('金额超出可保存范围');
  return Number(signed);
}
function reasonOf(value){return text(value,'原因',{required:true,max:500});}
function cleanRecord(raw,storeId){
  if(raw===null)return {schemaVersion:1,storeId,entries:[],history:[]};
  if(!raw||raw.schemaVersion!==1||raw.storeId!==storeId||!Array.isArray(raw.entries)||!Array.isArray(raw.history)||raw.entries.length>100000||raw.history.length>MAX_HISTORY)throw new Error('手工调整记录格式无效，请保留文件检查');
  const seen=new Set(),entries=raw.entries.map(item=>{
    const date=isoDate(item?.date),field=fieldOf(item?.field),amountCents=item?.amountCents,reason=reasonOf(item?.reason),updatedAt=new Date(item?.updatedAt).toISOString();
    if(!Number.isSafeInteger(amountCents)||Math.abs(amountCents)>1000000000000||field==='reimbursementExpense'&&amountCents<0)throw new Error('已保存手工金额无效');
    const key=`${date}:${field}`;if(seen.has(key))throw new Error('手工调整中同日同字段存在重复记录');seen.add(key);
    return {date,field,amountCents,reason,updatedAt};
  });
  const history=raw.history.map(item=>{
    const date=isoDate(item?.date),field=fieldOf(item?.field),action=item?.action;
    if(!['save','exclude'].includes(action))throw new Error('手工调整审计操作无效');
    const amountCents=item?.amountCents??null;
    if(amountCents!==null&&(!Number.isSafeInteger(amountCents)||Math.abs(amountCents)>1000000000000))throw new Error('手工调整审计金额无效');
    const at=new Date(item?.at).toISOString();
    return {date,field,action,amountCents,reason:reasonOf(item?.reason),at};
  });
  return {schemaVersion:1,storeId,entries,history};
}
function createManualDaily(ctx,{now=()=>new Date()}={}){
  const queues=new Map();
  async function checked(storeId){const id=identifier(storeId),store=await ctx.getStore(id);if(!store||store.id!==id)throw new Error('手工调整所属店铺不存在');return id;}
  const filename=storeId=>`${storeDirectory(storeId,typeof ctx.storeFolder==='function'?ctx.storeFolder(storeId):null)}/manual-daily.json`;
  async function wait(id){while(queues.has(id))await queues.get(id).catch(()=>{});}
  async function read(id){return cleanRecord(await ctx.readJson(filename(id),null),id);}
  async function loadRange(storeId,{start,end}={}){
    const id=await checked(storeId),first=isoDate(start,'开始日期'),last=isoDate(end,'结束日期');if(first>last)throw new Error('手工调整日期范围无效');
    await wait(id);await checked(id);const data=await read(id);await checked(id);
    return {entries:data.entries.filter(item=>item.date>=first&&item.date<=last).map(item=>({...item,amount:item.amountCents/100})),history:data.history.filter(item=>item.date>=first&&item.date<=last)};
  }
  async function change(storeId,input,action){
    const id=await checked(storeId),date=isoDate(input?.date),field=fieldOf(input?.field),reason=reasonOf(input?.reason);
    const amountCents=action==='save'?centsOf(input?.amount,field):null,work=(queues.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{
      await checked(id);const data=await read(id),key=`${date}:${field}`,index=data.entries.findIndex(item=>`${item.date}:${item.field}`===key),previous=index<0?null:data.entries[index],at=new Date(now()).toISOString();
      if(action==='exclude'&&!previous)throw new Error('该日期没有可剔除的手工值');
      if(action==='save'){
        const next={date,field,amountCents,reason,updatedAt:at};if(index<0)data.entries.push(next);else data.entries[index]=next;
      }else data.entries.splice(index,1);
      if(data.history.length>=MAX_HISTORY)throw new Error('手工调整历史已达上限，请先导出留档后再继续');
      data.history.push({date,field,action,amountCents:action==='save'?amountCents:previous.amountCents,reason,at});
      await checked(id);await ctx.writeJson(filename(id),data);
      return {date,field,amount:action==='save'?amountCents/100:null,reason,updatedAt:at};
    });
    queues.set(id,work);try{return await work;}finally{if(queues.get(id)===work)queues.delete(id);}
  }
  async function flush(storeId){if(storeId!==undefined){await wait(identifier(storeId));return;}while(queues.size)await Promise.allSettled([...queues.values()]);}
  return {loadRange,save:(storeId,input)=>change(storeId,input,'save'),exclude:(storeId,input)=>change(storeId,input,'exclude'),flush};
}

module.exports={FIELDS,centsOf,createManualDaily};
