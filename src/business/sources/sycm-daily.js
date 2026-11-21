'use strict';
const {FullSyncError}=require('../full-sync');
const {isoDate,dateList,yesterday}=require('../domain');
const PATH='/flow/long/period/nodistinct/new/guide/trend.json';
const FIELDS={uv:'visitors',pv:'pageViews',payByrCnt:'buyers',payAmt:'payAmount'};
const fail=message=>{throw new FullSyncError('SYCM_SCHEMA_UNCONFIRMED',message);};
const shiftDay=(date,offset)=>new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
function validateDailyDate(date,now=new Date()){
 isoDate(date);const last=yesterday(now),first=shiftDay(last,-30);
 // MM-DD points cannot distinguish an old year's same-named day. Only use a
 // recent, bounded request interval for this proven rolling-window contract.
 if(date<first||date>last)fail('店铺日报仅支持最近31个完整日期；更早日期或当天数据尚未核对，本次未发起读取');
 return date;
}
function dailyRequest(date,{now=new Date()}={}){
 validateDailyDate(date,now);const year=date.slice(0,4);
 return {method:'GET',path:PATH,query:{dateType:'compareRange',dateRange:`${date}|${date},${year}-01-01|${year}-01-01`,indexCode:'',device:0}};
}
function point(value,key){
 if(value===null||value===undefined||value===''||value==='-'||value==='--')return null;
 if(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value))value=Number(value);
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||(key!=='payAmount'&&!Number.isSafeInteger(value)))fail('店铺日报指标不是可确认的精确计数或金额，本次未保存');
 return value;
}
function dailySeries(body,{date,now=new Date()}={}){
 validateDailyDate(date,now);
 const my=body?.data?.my;
 if(body?.code!==0||!my||typeof my!=='object'||Array.isArray(my))fail('店铺日报未返回本店趋势序列，本次未保存');
 const expected=dateList(shiftDay(date,-30),date);
 if(!Array.isArray(my.statDate)||my.statDate.length!==31||expected.some((value,index)=>my.statDate[index]!==value.slice(5)))fail('日报趋势日期未按所选日连续覆盖31天，无法确认末日归属，本次未保存');
 const series={};
 for(const [field,key]of Object.entries(FIELDS)){
  const values=my[field];
  if(!Array.isArray(values)||values.length!==31)fail('日报缺少完整的31天核心指标序列，本次未保存');
  const normalized=expected.map((_,index)=>point(values[index],key));
  series[key]=normalized;
 }
 return {dates:expected,series};
}
function dailyRow(series,index,date){
 const row={date};
 for(const key of Object.values(FIELDS)){
  if(series[key][index]===null)fail('所选日报日期缺少核心指标，本次未保存；缺失值不会补为零');
  row[key]=series[key][index];
 }
 // cartByrCnt counts people, and must not populate the cartItems column.
 for(const key of ['cartItems','searchVisitors','refundAmount','refundRate','adSpend','adRevenue','adRoi'])row[key]=null;
 row.conversionRate=row.visitors>0?row.buyers/row.visitors*100:null;
 row.unitPrice=row.buyers>0?row.payAmount/row.buyers:null;
 return row;
}
function parseDaily(body,{date,source,now=new Date()}={}){
 const {series}=dailySeries(body,{date,now});
 return {source,date,page:1,pageSize:1,total:1,hasNext:false,rows:[dailyRow(series,30,date)]};
}
module.exports={dailyRequest,parseDaily,validateDailyDate,dailySeries,dailyRow};
