'use strict';
// Ads retain their original report families so that unlike attribution models
// cannot silently become a combined ROI. Only allowlisted business fields leave
// the transport; access tokens and account context never enter this structure.
const {isoDate,identifier,metric,dateList}=require('./domain');
function normalizeAdSources(input,request,rows,{required=false}={}){
 if(input===undefined){if(required)throw new Error('已完成的广告来源必须保留原始明细及完整分页证明');return {rows:[],coverage:[]};}
 if(!input||!Array.isArray(input.rows)||input.rows.length>100000||!Array.isArray(input.coverage))throw new Error('广告来源明细格式无效');
 if(!input.rows.length&&!input.coverage.length){if(required)throw new Error('已完成的广告来源缺少完整日期与分页证明');return {rows:[],coverage:[]};}
 const kinds=request.mode==='daily'?['account']:['item_promotion','site_cost_ratio'];
 const expected=dateList(request.start,request.end),keys=new Set(rows.map(row=>`${row.date}:${row.productId}`)),seen=new Set();
 const details=input.rows.map(row=>{
  const date=isoDate(row?.date),kind=row?.sourceKind;
  if(!expected.includes(date)||!kinds.includes(kind))throw new Error('广告来源日期或报表类型无效');
  const productId=request.mode==='daily'?'':identifier(row.productId,'广告商品ID');
  if(request.mode==='daily'&&row.productId)throw new Error('日报广告不能混入商品记录');
  const key=`${date}:${kind}:${productId}`;
  if(seen.has(key)||!keys.has(`${date}:${productId}`))throw new Error('广告来源明细重复或未纳入展示记录');
  seen.add(key);
  return {date,productId,sourceKind:kind,adSpend:metric(row.adSpend,'adSpend'),adRevenue:metric(row.adRevenue,'adRevenue'),adRoi:metric(row.adRoi,'adRoi')};
 });
 const dates=new Set();
 const coverage=input.coverage.map(page=>{
  const date=isoDate(page?.date),kind=page?.kind,key=`${date}:${kind}`;
  if(!expected.includes(date)||!kinds.includes(kind)||dates.has(key))throw new Error('广告分页覆盖重复或来源无效');
  dates.add(key);
  const count=details.filter(row=>row.date===date&&row.sourceKind===kind).length;
  const unique=new Set(details.filter(row=>row.date===date&&row.sourceKind===kind).map(row=>row.productId)).size;
  const pages=request.mode==='daily'?1:Math.max(1,Math.ceil(count/100));
  if(page.total!==count||page.rowCount!==count||page.totalPages!==pages||page.completedPages!==pages)throw new Error('广告完整分页证明与来源明细不一致');
  // Newer proofs also carry the unique product count. It must match the stored
  // detail exactly; older saved snapshots without the field stay readable.
  if(page.uniqueProducts!==undefined&&page.uniqueProducts!==unique)throw new Error('广告唯一商品数与来源明细不一致');
  const empty=request.mode==='daily'&&count===0;
  if(request.mode==='daily'&&(count>1||empty&&page.empty!==true||!empty&&page.empty===true))throw new Error('每日广告汇总缺失或缺少明确空结果证明');
  if(request.mode!=='daily'&&page.empty!==undefined)throw new Error('广告商品分页不能使用日报空结果证明');
  return {date,kind,total:count,rowCount:count,...(request.mode==='daily'?{}:{uniqueProducts:unique}),totalPages:pages,completedPages:pages,...(empty?{empty:true}:{})};
 });
 if(dates.size!==expected.length*kinds.length)throw new Error('广告来源未覆盖完整日期及全部所选报表');
 // Reuse the production merge rule. Source evidence is not meaningful if the
 // displayed values can disagree with it, including a fabricated combined ROI.
 const expectedRows=request.mode==='daily'?details:expected.flatMap(date=>require('./sources/promotion-range').mergeProductSources(date,details.filter(row=>row.date===date)));
 const byKey=new Map(expectedRows.map(row=>[`${row.date}:${row.productId}`,row]));
 const fields=['adSpend','adRevenue','adRoi','siteAdSpend','sitePromotion'];
 for(const row of rows){
  const original=byKey.get(`${row.date}:${row.productId}`);
  for(const name of fields)if((row[name]??null)!==(original?.[name]??null))throw new Error('展示广告指标与原始广告来源明细不一致');
 }
 return {rows:details,coverage};
}
module.exports={normalizeAdSources};
