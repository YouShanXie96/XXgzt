'use strict';
const {FullSyncError}=require('../full-sync');
const {isoDate}=require('../domain');
const {dailyRequest,parseDaily}=require('./sycm-daily');
const fail=message=>{throw new FullSyncError('SYCM_SCHEMA_UNCONFIRMED',message)};
const PRODUCT_PATH='/cc/item/view/top.json';
function productRequest(date,page){
 isoDate(date);if(!Number.isSafeInteger(page)||page<1)fail('商品页码无效');
 return {method:'GET',path:PRODUCT_PATH,query:{dateRange:`${date}|${date}`,dateType:'day',pageSize:20,page,order:'desc',orderBy:'itmUv',device:0,compareType:'cycle',keyword:'',follow:false,cateId:'',cateLevel:'',indexCode:'itmUv'}};
}
function scalar(value){
 if(value&&typeof value==='object'&&!Array.isArray(value))value=value.value;
 if(value===undefined||value===null||value===''||value==='-'||value==='--')return null;
 if(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value))value=Number(value);
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)fail('后台经营指标并非可确认的精确数值，本次未保存');
 return value;
}
function bodyData(body){if(body?.code!==0)fail('生意参谋未返回成功数据，已停止；请检查官方页面');if(!body.data||typeof body.data!=='object')fail('后台缺少经营明细，本次未保存');return body.data}
function derived(row){row.conversionRate=row.visitors>0&&row.buyers!==null?row.buyers/row.visitors*100:null;row.unitPrice=row.buyers>0&&row.payAmount!==null?row.payAmount/row.buyers:null;return row}
function createdAtOf(item){
 const candidates=[item?.item?.createTime,item?.item?.gmtCreate,item?.item?.createdAt,item?.item?.itemCreateTime,item?.createTime,item?.gmtCreate,item?.createdAt];
 for(let value of candidates){
  if(value&&typeof value==='object'&&!Array.isArray(value))value=value.value??value.time??null;
  if(typeof value==='number'&&Number.isFinite(value)){
   const timestamp=value<100000000000?value*1000:value;
   if(timestamp>=0&&timestamp<=8640000000000000)return new Date(timestamp+8*3600000).toISOString().slice(0,10);
  }
  if(typeof value==='string'){
   const text=value.trim();
   const match=/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/.exec(text);
   if(match&&Number.isFinite(Date.parse(`${match[1]}T00:00:00Z`))&&new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0,10)===match[1])return match[1];
  }
 }
 return null;
}
function productStatus(value){
 if(typeof value!=='string'||!value.trim())return null;
 const text=value.trim(),folded=text.toLocaleLowerCase('zh-CN');
 if(['出售中','当前在线','在线','onsale','on_sale','selling'].includes(folded)||/出售中|当前在线/.test(text))return '出售中';
 if(['仓库中','已下架','下架','offline','off_shelf','warehouse'].includes(folded)||/仓库中|已下架|已下架/.test(text))return '仓库中';
 return text;
}
function parseProducts(body,{date,page,source}){
 const data=bodyData(body),total=data.recordCount,items=data.data;
 if(!Number.isSafeInteger(total)||total<0||!Array.isArray(items))fail('后台未提供明确商品总数和明细，无法确认整店分页');
 const rows=items.map(item=>{
  const rawId=item?.item?.itemId;if(typeof rawId==='number'&&!Number.isSafeInteger(rawId))fail('后台商品ID超出安全整数范围');const productId=String(rawId??'');
  if(!/^\d{1,30}$/.test(productId)||productId==='0')fail('后台商品缺少有效商品ID');
  const rawCategory=item.item.categoryId;
  if(typeof rawCategory==='number'&&!Number.isSafeInteger(rawCategory))fail('后台类目ID超出安全整数范围');
  return derived({date,productId,title:typeof item.item.title==='string'?item.item.title:'',category:'',categoryId:rawCategory===undefined||rawCategory===null?'':String(rawCategory),createdAt:createdAtOf(item),itemStatus:productStatus(item.itemStatus),visitors:scalar(item.itmUv),pageViews:scalar(item.itmPv),buyers:scalar(item.payByrCnt),payAmount:scalar(item.payAmt),cartItems:scalar(item.itemCartCnt),searchVisitors:scalar(item.seGuideUv),refundAmount:scalar(item.sucRefundAmt)});
 });
 return {source,date,page,pageSize:20,total,hasNext:page*20<total,rows};
}
// 需求（2026-10-13）：生意参谋偶发返回 code!=0（“未返回成功数据”，多见于请求过于频繁或页面刚切
// 路由的瞬时状态）。等几秒再请求一次；仍失败才如实报错（同一份数据不会被算成两次）。
function createSycmProvider(transport,{now=()=>new Date(),retryDelayMs=3000}={}){
 const sleep=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);timer.unref?.();});
 const transient=error=>error instanceof FullSyncError&&/回成功数据/.test(String(error.message||''));
 return {async readPage({storeId,mode,date,page,signal}){
  if(!['daily','product'].includes(mode))fail('不支持的经营数据来源');
  if(mode==='daily'&&page!==1)fail('店铺日报只能读取每天一条本店汇总');
  const observedAt=mode==='daily'?now():undefined;
  const descriptor=mode==='daily'?dailyRequest(date,{now:observedAt}):productRequest(date,page);
  let attempt=0;
  for(;;){
   const {body,source}=await transport.request(storeId,descriptor,signal);
   try{
    return mode==='daily'?parseDaily(body,{date,source,now:observedAt}):parseProducts(body,{date,page,source});
   }catch(error){
    if(!transient(error)||attempt>=1)throw error;
    attempt+=1;
    if(signal?.aborted)throw error;
    await sleep(Math.max(0,Number(retryDelayMs)||0));
    if(signal?.aborted)throw error;
   }
  }
 }}}
module.exports={createSycmProvider,productRequest,dailyRequest,parseProducts,parseDaily,scalar,createdAtOf,productStatus};
