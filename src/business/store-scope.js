'use strict';

// 多店铺“日报”合并：把每家店铺已保存的日报行按日期合并成一行。
// 金额与数量按店铺直接相加（任一店铺当天缺该指标就留空，不按 0 相加），
// 转化率、客单价、推广占比与 ROI 用合计值重新计算；“店铺 × 日期”缺数据的
// 组合会写进说明里，合计不会假装已经覆盖没有数据的店铺。
const {REPORT_SCHEMA,dateList}=require('./domain');
const {summarizeReportRows,filterAndSortRows}=require('./query');

const RESERVED=new Set(REPORT_SCHEMA.RESERVED_NULL_FIELDS);
const ADDITIVE=REPORT_SCHEMA.DEFINITIONS.filter(column=>['money','number'].includes(column.type)&&column.key!=='unitPrice'&&!RESERVED.has(column.key)).map(column=>column.key);
const MANUAL_FIELDS=['customProfit','reimbursementExpense'];
const TEXT_FIELDS=['refundScenes','taxNote'];
// [目标字段, 分子, 分母, 放大倍数]
const RATIOS=[['conversionRate','buyers','visitors',100],['unitPrice','payAmount','buyers',1],['shopSalesRoi','payAmount','adSpend',1],['promotionShare','adSpend','payAmount',100],['adRoi','adRevenue','adSpend',1]];

const isNumeric=value=>typeof value==='number'&&Number.isFinite(value);
function sumNumbers(values,digits=6){
  if(!values.length||values.some(value=>!isNumeric(value)))return null;
  const total=values.reduce((sum,value)=>sum+value,0);
  if(!Number.isFinite(total)||Math.abs(total)>Number.MAX_SAFE_INTEGER)throw new Error('多店铺经营指标汇总超过有效范围');
  return Number(total.toFixed(digits));
}
function ratio(numerator,denominator,scale){
  if(!isNumeric(numerator)||!isNumeric(denominator)||denominator<=0)return null;
  const value=numerator/denominator*scale;
  if(!Number.isFinite(value))throw new Error('多店铺经营比例汇总超过有效范围');
  return Number(value.toFixed(6));
}

function mergeDailyQueries(results,{queryOptions}){
  const dates=dateList(queryOptions.start,queryOptions.end);
  const byStore=results.map(item=>({storeId:item.storeId,name:item.name,byDate:new Map((item.result.rows||[]).map(row=>[row.date,row]))}));
  const presentDates=[...new Set(results.flatMap(item=>(item.result.rows||[]).map(row=>row.date)))].filter(date=>dates.includes(date)).sort();
  const missing=[];
  const mergedRows=presentDates.map(date=>{
    const present=[];
    for(const item of byStore){const row=item.byDate.get(date);if(row)present.push(row);else missing.push(`${item.name}·${date}`);}
    const row={date};
    for(const key of ADDITIVE){
      const values=present.map(source=>source[key]).filter(value=>isNumeric(value));
      row[key]=values.length===present.length?sumNumbers(values):null;
    }
    for(const key of MANUAL_FIELDS){
      const values=present.map(source=>source[key]).filter(value=>isNumeric(value));
      row[key]=values.length?Number(values.reduce((sum,value)=>sum+value,0).toFixed(2)):null;
      const reasons=present.map(source=>source[`${key}Reason`]).filter(value=>typeof value==='string'&&value.trim());
      row[`${key}Reason`]=reasons.length?reasons.join('；'):null;
    }
    for(const key of TEXT_FIELDS){
      const values=present.map(source=>source[key]).filter(value=>typeof value==='string'&&value.trim());
      row[key]=values.length?values.join('；'):null;
    }
    for(const [key,numerator,denominator,scale] of RATIOS)row[key]=ratio(row[numerator],row[denominator],scale);
    return row;
  });
  const rows=filterAndSortRows(mergedRows,queryOptions);
  const complete=missing.length===0&&presentDates.length===dates.length;
  const summary=summarizeReportRows(rows,'daily',{rawRows:rows,complete:true,completeMetrics:null,partialTotals:true});
  summary.coverage={scope:'full',complete,expectedDays:dates.length,coveredDays:presentDates.length,missingDates:dates.filter(date=>!presentDates.includes(date)),missingStoreDates:missing.length};
  summary.notes=[...summary.notes,`当前为 ${results.length} 家店铺（${results.map(item=>item.name).join('、')}）合并的日报：金额与数量按店铺已保存数据直接相加，转化率、客单价、推广占比与 ROI 按合计值重新计算。`];
  if(missing.length)summary.notes.push(`有 ${missing.length} 个“店铺 × 日期”还没有已保存数据（${missing.slice(0,8).join('、')}${missing.length>8?' 等':''}），这些日期的合计只包含有数据的店铺，不代表所选店铺的完整合计。`);
  const rawRowCount=results.reduce((total,item)=>total+Number(item.result.rawRowCount||0),0);
  const official=[],officialIndex=new Map();
  for(const item of results)for(const count of item.result.counts?.official||[]){
    const key=count.key||count.label;
    let target=officialIndex.get(key);
    if(!target){target={...count,days:0,totalRows:0,uniqueProducts:0,perDate:[]};officialIndex.set(key,target);official.push(target);}
    target.days+=Number(count.days||0);target.totalRows+=Number(count.totalRows||0);target.uniqueProducts+=Number(count.uniqueProducts||0);
    target.perDate=[...target.perDate,...(count.perDate||[]).map(day=>({...day,storeName:item.name}))];
  }
  const history=results.flatMap(item=>(item.result.history||[]).map(entry=>({...entry,storeId:item.storeId,storeName:item.name,message:`${item.name} · ${entry.message||''}`})))
    .sort((left,right)=>String(right.finishedAt||right.at||'').localeCompare(String(left.finishedAt||left.at||'')));
  const warnings=[...new Set(results.flatMap(item=>(item.result.warnings||[]).map(message=>`[${item.name}] ${message}`)))];
  const uncovered=dates.filter(date=>!presentDates.includes(date));
  if(uncovered.length)warnings.push(`所选范围有 ${uncovered.length} 天没有任何所选店铺的已保存数据：${uncovered.join('、')}`);
  if(missing.length)warnings.push(`有 ${missing.length} 个“店铺 × 日期”还没有已保存数据：${missing.slice(0,20).join('、')}${missing.length>20?' 等':''}`);
  return {rows,summary,warnings,rawRowCount,counts:{local:{products:0,records:rawRowCount},matched:{products:rows.length,records:rawRowCount},official},history,complete,missingStoreDates:missing};
}

module.exports={mergeDailyQueries,ADDITIVE};
