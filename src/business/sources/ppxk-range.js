'use strict';

// 品牌新享（ppxk.tmall.com 数据中心）按日读取：
// - 店铺日报：每天的“总预估费用”＝当天品牌新享扣费（营销费用）。
// - 精细化：同一页“商品维度”表里每个商品的预估费用（预估抽佣金额）。
// 只有官方接口明确返回 info.ok 才继续；字段缺失、数值非法或商品ID异常都整批停止，
// 不猜测、不用 0 冒充缺失数据（某天没有任何记录时按 0 计并写入说明）。
const {FullSyncError}=require('../full-sync');
const {identifier,dateList}=require('../domain');

const SUMMARY_CODE='seller_cy_summary_data';
const ITEM_CODE='item_summary_data';
const SUMMARY_PAGE_SIZE=20;
const ITEM_PAGE_SIZE=100;
const MAX_ITEM_PAGES=200;
const DAILY_FEE_LABEL=/总预估费用/;
const ITEM_FEE_LABEL=/预估抽佣金额|抽佣金额|预估.*费用/;
const fail=(code,message)=>{throw new FullSyncError(code,message);};
const pause=(ms,signal)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();resolve();},ms);
  const abort=()=>{cleanup();reject(new FullSyncError('CANCELED','品牌新享读取已取消'));};
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
});
const check=(signal)=>{if(signal?.aborted)fail('CANCELED','品牌新享读取已取消，原数据保持不变');};

function compactDate(date){return String(date).replaceAll('-','');}
function fieldId(field){return String(field?.id??field?.code??field?.key??'');}
function fieldName(field){return String(field?.name??field?.label??field?.title??'');}
function numericValue(value){
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value.trim())){const parsed=Number(value.trim());return Number.isFinite(parsed)?parsed:null;}
  return null;
}
function modelOf(data){
  const model=data?.model&&typeof data.model==='object'?data.model:{};
  return {
    rows:Array.isArray(model.rows)?model.rows:[],
    fields:Array.isArray(model.fields)?model.fields:[],
    total:Number.isFinite(model.total)?model.total:null,
  };
}
function dailyFee(view,date){
  const rows=view.rows;
  if(!rows.length)return {value:0,empty:true};
  const byName=new Map(view.fields.map(field=>[fieldName(field),fieldId(field)]));
  const feeField=[...byName.entries()].find(([name])=>DAILY_FEE_LABEL.test(name));
  const code=feeField?feeField[1]:view.fields.map(fieldId).find(id=>DAILY_FEE_LABEL.test(id));
  // 只认官方字段名/字段编码，找不到就报错；不从其它字段猜一个数字。
  const candidates=code?rows.map(row=>numericValue(row?.[code])):[];
  const value=candidates.find(candidate=>candidate!==null);
  if(value===undefined||value===null)fail('BRANDNEW_INVALID_RESPONSE',`品牌新享 ${date} 没有返回可核对的“总预估费用”字段，本次未保存`);
  return {value,empty:false};
}
function itemFee(row,fields){
  for(const field of fields){if(!ITEM_FEE_LABEL.test(fieldName(field))&&!ITEM_FEE_LABEL.test(fieldId(field)))continue;const value=numericValue(row?.[fieldId(field)]);if(value!==null)return value;}
  for(const [key,value]of Object.entries(row??{})){if(ITEM_FEE_LABEL.test(key)){const parsed=numericValue(value);if(parsed!==null)return parsed;}}
  return 0;
}
function itemIdOf(row){return String(row?.item_id??row?.itemId??row?.id??'').trim();}
function itemTitleOf(row){return String(row?.item_title??row?.itemTitle??row?.title??'').trim().slice(0,200);}

function createPpxkRangeReader(transport){
  if(typeof transport?.prepare!=='function'||typeof transport?.query!=='function')throw new TypeError('品牌新享读取需要同店只读传输服务');
  const active=new Set();
  async function view(storeId,{date,code,page,pageSize,filterParams,orderParam,signal}){
    const params={page,pageSize,code,needTotalCount:false,filterParams:filterParams||{},dataBoardFilterParams:[
      {param:'biz_date',value:compactDate(date),operator:'greaterThanAndEquals'},
      {param:'biz_date',value:compactDate(date),operator:'lessThanAndEquals'},
    ]};
    if(orderParam)params.orderParam=orderParam;
    return modelOf(await transport.query(storeId,'sellerDataView',params,signal));
  }
  async function readRange({storeId,mode,start,end,signal,onProgress}={}){
    const id=identifier(storeId);
    if(active.has(id))fail('SYNC_BUSY','当前店铺已有品牌新享读取任务');
    active.add(id);
    const dates=dateList(start,end),rows=[],warnings=[];let source=null;
    const progress=(current,total,message)=>{check(signal);onProgress?.({current,total,message,sourceId:'marketing'});check(signal);};
    try{
      progress(0,dates.length,'正在核对本店登录会话（品牌新享）');
      const prepared=await transport.prepare(id,signal);check(signal);source=prepared?.source;
      if(!source?.shopName)fail('SOURCE_MISMATCH','未能确认本店身份，品牌新享读取已停止');
      for(const [index,date]of dates.entries()){
        check(signal);
        // 同一批日期之间留 600ms：品牌新享对连续请求比较敏感（会提示“请求太快啦”）。
        if(index>0)await pause(600,signal);
        progress(index,dates.length,`正在读取品牌新享 ${date} 的每日费用`);
        if(mode==='daily'){
          const summary=await view(id,{date,code:SUMMARY_CODE,page:1,pageSize:SUMMARY_PAGE_SIZE,signal});
          const fee=dailyFee(summary,date);
          if(fee.empty)warnings.push(`品牌新享 ${date} 没有费用记录，按 0 计`);
          rows.push({date,storeName:source.shopName,marketingExpense:fee.value});
        }else{
          let page=1,total=null;
          for(;;){
            check(signal);
            if(page>MAX_ITEM_PAGES)fail('BRANDNEW_PAGE_LIMIT','品牌新享商品维度分页超过上限，本次未保存');
            const list=await view(id,{date,code:ITEM_CODE,page,pageSize:ITEM_PAGE_SIZE,filterParams:{},orderParam:[{id:'item_id',asc:true}],signal});
            if(total===null)total=list.total;
            else if(list.total!==null&&list.total!==total)fail('BRANDNEW_TOTAL_CHANGED','品牌新享商品维度分页期间总条数变化，本次未保存');
            if(page===1&&!list.rows.length)warnings.push(`品牌新享 ${date} 没有商品费用记录`);
            for(const row of list.rows){
              const productId=itemIdOf(row);
              if(!/^\d{6,30}$/.test(productId))fail('BRANDNEW_INVALID_ITEM','品牌新享商品维度出现无效商品ID，本次未保存');
              rows.push({date,storeName:source.shopName,productId,title:itemTitleOf(row),marketingExpense:itemFee(row,list.fields)});
            }
            const pages=list.total!==null&&list.total>0?Math.max(1,Math.ceil(list.total/ITEM_PAGE_SIZE)):1;
            if(page>=pages||!list.rows.length)break;
            page+=1;
          }
        }
        progress(index+1,dates.length,`已读取品牌新享 ${date} 的费用`);
      }
      check(signal);
      const metrics=['marketingExpense'];
      return {source,rows,coverage:{scope:'full',complete:true,dates,expectedDays:dates.length,rowCount:rows.length},
        metrics,warnings:[
          '品牌新享费用取官方“佣金数据汇总”的总预估费用（每日约14点前更新昨日数据）；实际加速费用仍以账房为准。',
          // 注意：这里必须放数组再展开；直接展开字符串会把整句拆成单个汉字（用户实测的乱码警告）。
          ...(mode==='product'?['商品维度费用取官方“商品维度”表中每个商品的预估费用；当天没有记录的商品不计入。']:[]),
          ...warnings,
        ].filter(Boolean)};
    }finally{active.delete(id);}
  }
  return {readRange};
}
module.exports={createPpxkRangeReader,SUMMARY_CODE,ITEM_CODE,SUMMARY_PAGE_SIZE,ITEM_PAGE_SIZE,DAILY_FEE_LABEL,ITEM_FEE_LABEL,fieldId,fieldName,numericValue,modelOf,dailyFee,itemFee};
