'use strict';

const {METRICS,REPORT_SCHEMA,identifier,text,mode,chinaDate,validateRange,isoDate,summarizeRows}=require('./domain');

const SORT_FIELDS=new Set(['date','storeName','productId','title','category','itemStatus','categoryId',...REPORT_SCHEMA.DEFINITIONS.map(column=>column.key)]);
// “上架天数”是按导出/查询当天现算的展示列（不是历史指标），排序按数字比大小。
const NUMERIC_FIELDS=new Set([...METRICS,'listedDays']);
const collator=new Intl.Collator('zh-CN',{numeric:false,sensitivity:'base'});
const fold=value=>String(value??'').toLocaleLowerCase('zh-CN');
const choice=(value,allowed,label)=>{const result=String(value??'').trim();if(!result)return '';if(!allowed.includes(result))throw new Error(label+'筛选无效');return result;};

function productIds(value){
  if(value===undefined||value===null||value==='')return [];
  if(typeof value==='string'&&value.length>260000)throw new Error('商品ID输入过长，一次最多筛选2000个ID');
  const parts=typeof value==='string'?value.split(/[\s,，;；]+/).filter(Boolean):value;
  if(!Array.isArray(parts)||parts.length>2000)throw new Error('商品ID必须按行填写，一次最多筛选2000个');
  return [...new Set(parts.map(value=>identifier(value,'商品ID')))];
}
function monthRange(value,now=new Date()){
  if(typeof value!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value))throw new Error('月份必须是有效的 YYYY-MM');
  const today=chinaDate(now);if(value>today.slice(0,7))throw new Error('不能查询未来月份');
  const start=`${value}-01`,next=new Date(`${start}T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  const last=new Date(next.getTime()-86400000).toISOString().slice(0,10);
  return validateRange({start,end:last>today?today:last},now);
}
function normalizeBusinessQuery(input={},now=new Date()){
  const kind=mode(input.mode),range=input.month!==undefined&&input.start===undefined&&input.end===undefined?monthRange(input.month,now):validateRange(input,now);
  // Old saved product filters used the now-hidden daily date column. Translate
  // that legacy value to the confirmed product default (支付买家数降序) instead
  // of sorting an invisible column.
  const sortBy=kind==='product'&&input.sortBy==='date'?'buyers':input.sortBy??(kind==='daily'?'date':'buyers'),sortDirection=input.sortDirection??(kind==='daily'?'asc':'desc');
  if(!SORT_FIELDS.has(sortBy)||!['asc','desc'].includes(sortDirection))throw new Error('经营数据排序字段或方向无效');
  const creationStart=kind==='product'&&input.creationStart?isoDate(input.creationStart,'商品创建开始时间'):'',creationEnd=kind==='product'&&input.creationEnd?isoDate(input.creationEnd,'商品创建结束时间'):'';
  if(creationStart&&creationEnd&&creationStart>creationEnd)throw new Error('商品创建开始时间不能晚于结束时间');
  return {mode:kind,...range,query:fold(text(input.query,'搜索内容',{max:300})),title:text(input.title,'商品标题',{max:600}),productIds:productIds(input.productIds),category:text(input.category,'商品类目',{max:300}),itemStatus:text(input.itemStatus,'商品状态',{max:40}),creationStart,creationEnd,categoryId:input.categoryId?identifier(input.categoryId,'类目ID'):'',blacklist:kind==='product'?choice(input.blacklist,['yes','no'],'黑名单'):'',todoStatus:kind==='product'?choice(input.todoStatus,['has','none'],'待办状态'):'',sortBy,sortDirection};
}

const reserved=new Set(REPORT_SCHEMA.RESERVED_NULL_FIELDS);
const additive=REPORT_SCHEMA.DEFINITIONS.filter(column=>['money','number'].includes(column.type)&&column.key!=='unitPrice'&&!reserved.has(column.key)).map(column=>column.key);
const descriptive=['storeName','productId','title','category','itemStatus','categoryId','createdAt','operator','todo'];
const CREATED_AT_REASON='后台商品行未返回明确创建时间，保持空白；不能用统计日期代替';
const PRODUCT_COVERAGE_SOURCES=Object.freeze([['sycm','生意参谋'],['promotion','广告'],['refund','退款']]);
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const MANUAL_METRICS=new Set(['customProfit','reimbursementExpense']);
function sumMetric(rows,key){
  if(!rows.length||rows.some(row=>!numeric(row[key])))return null;
  const sum=rows.reduce((total,row)=>total+row[key],0);
  if(!Number.isFinite(sum)||Math.abs(sum)>Number.MAX_SAFE_INTEGER)throw new Error('经营指标汇总超过有效范围');
  return Number(sum.toFixed(6));
}
function sumPresentMetric(rows,key){
  const reasonField=`${key}Reason`,values=rows.filter(row=>numeric(row[key])&&typeof row[reasonField]==='string'&&row[reasonField].trim()).map(row=>row[key]);if(!values.length)return null;
  const sum=values.reduce((total,value)=>total+value,0);if(!Number.isFinite(sum)||Math.abs(sum)>Number.MAX_SAFE_INTEGER)throw new Error('手工经营指标汇总超过有效范围');
  return Number(sum.toFixed(2));
}
function ratio(numerator,denominator,scale=1){
  if(!numeric(numerator)||!numeric(denominator)||denominator<=0)return null;
  const value=numerator/denominator*scale;
  if(!Number.isFinite(value))throw new Error('经营比例汇总超过有效范围');
  return Number(value.toFixed(6));
}
function aggregateMetrics(rows,{kind='product',complete=true,completeMetrics=null,partialTotals=false}={}){
  const result=Object.fromEntries(METRICS.map(key=>[key,null]));
  // 已同步的日期里只要还有记录就先汇总（合计行会注明“仅含已同步日期”）；
  // 当前页面快照（visible-page）仍不提供任何合计，该指标未被来源覆盖时也留空。
  if(!complete&&!partialTotals)return result;
  for(const key of additive)if(!MANUAL_METRICS.has(key)&&key!=='adRoi'&&(!completeMetrics||completeMetrics.has(key)))result[key]=sumMetric(rows,key);
  for(const key of MANUAL_METRICS)result[key]=sumPresentMetric(rows,key);
  result.conversionRate=ratio(result.buyers,result.visitors,100);
  result.unitPrice=ratio(result.payAmount,result.buyers);
  result.shopSalesRoi=ratio(result.payAmount,result.adSpend);
  result.promotionShare=ratio(result.adSpend,result.payAmount,100);
  // Account daily spend/revenue use one attribution model. Product spend also
  // contains site_cost_ratio; product ROI is weighted from official item-report ROI below.
  if(kind==='daily')result.adRoi=ratio(result.adRevenue,result.adSpend);
  if(rows.length===1){
    for(const key of ['conversionRate','unitPrice','refundRate','adRoi'])if((!completeMetrics||completeMetrics.has(key))&&numeric(rows[0][key]))result[key]=rows[0][key];
  }
  return result;
}
// 减操作单数据 = 生意参谋原始值 − 操作单对应值（买家数−单量、销售额−本金）。
// 操作单来源尚未接入时该值按 0 参与计算；生意参谋原值缺失时保持空白，不产生假数据。
function adjustedValues(base){
  const orders=numeric(base?.operationOrders)?base.operationOrders:0;
  const principal=numeric(base?.operationPrincipal)?base.operationPrincipal:0;
  const buyers=numeric(base?.buyers)?base.buyers-orders:null;
  const payAmount=numeric(base?.payAmount)?Number((base.payAmount-principal).toFixed(2)):null;
  return {adjustedBuyers:buyers,adjustedPayAmount:payAmount,
    adjustedConversionRate:numeric(buyers)&&numeric(base?.visitors)&&base.visitors>0?Number((buyers/base.visitors*100).toFixed(6)):null};
}
function productKey(row,storeId=''){return JSON.stringify([row.storeId||storeId||row.storeName||'',row.productId]);}
// Per-product completeness text: how many days of the selected range are proven
// complete for each source and how many of those proven days had no record for
// this product (filled with zero). Missing sources stay visible instead of
// silently becoming zeros.
function productCoverageText(productId,{dates,sourcesByDate,proven}={}){
  if(!Array.isArray(dates)||!dates.length||!sourcesByDate)return null;
  const zeroDays=source=>{
    if(!proven)return 0;
    let count=0;
    for(const date of dates){const listed=proven.get(date)?.[source];if(listed&&!listed.has(productId))count++;}
    return count;
  };
  const parts=[];
  for(const [source,label]of PRODUCT_COVERAGE_SOURCES){
    let covered=0;
    for(const date of dates){const entry=sourcesByDate.get(date);if(entry&&!entry.legacy&&entry.sources?.has(source))covered++;}
    const zero=['sycm','promotion'].includes(source)?zeroDays(source):0;
    if(!covered&&!zero)continue;
    parts.push(`${label}：${covered}/${dates.length} 天完整${zero?`，其中 ${zero} 天官方完整报表无该商品记录，按 0 累计`:''}`);
  }
  return parts.length?parts.join('；'):null;
}
// 上架天数：上架“日期”到今天“日期”的自然日差（与参考软件一致，含时刻时只看日期）；
// 没有创建时间就留空。仅用于页面展示与导出的“上架天数”列，不写回历史快照。
function listedDaysOf(createdAt,now){
  if(!createdAt)return null;
  const day=String(createdAt).replace(' ','T').slice(0,10);
  const created=Date.parse(day+'T00:00:00Z');
  if(!Number.isFinite(created)||new Date(created).toISOString().slice(0,10)!==day)return null;
  const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  return Math.max(0,Math.floor((today-created)/86400000));
}
function aggregateProductRows(rows,{storeId='',complete=true,completeMetrics=null,expectedDays=null,coverage=null,catalog=null,partialTotals=false,marks=null,now=null,channels=null}={}){
  const grouped=new Map();
  for(const row of rows){const key=productKey(row,storeId);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}
  return [...grouped.values()].map(records=>{
    const ordered=records.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))),latest=ordered.at(-1);
    const result={...aggregateMetrics(ordered,{complete,completeMetrics,partialTotals}),recordDays:new Set(ordered.map(row=>row.date)).size};
    if(!completeMetrics||completeMetrics.has('adRoi'))result.adRoi=weightedItemRoi(ordered);
    // VOC lists refund-related products, not every paid product. A day absent
    // from that list has no observed paid-order denominator for this product.
    // Never turn a one-day rate into a seven-day rate or use SYCM buyers here.
    if(completeMetrics?.has('vocPaidOrderCount')){
      result.refundRate=complete&&result.recordDays===(expectedDays??result.recordDays)
        ?ratio(result.vocRefundCount,result.vocPaidOrderCount,100):null;
    }else if(expectedDays!==null&&result.recordDays<expectedDays)result.refundRate=null;
    // Descriptive values (including creation time) come from the newest record
    // that actually returned them; an advertisement-only day must not erase a
    // creation time already proven by the complete product report.
    for(const field of descriptive){
      let value=null;
      for(const record of ordered)if(record[field]!==null&&record[field]!==undefined&&record[field]!=='')value=record[field];
      result[field]=value??null;
    }
    if(latest.storeId)result.storeId=latest.storeId;
    // “推广渠道”按商品ID取推广后台快照：只显示仍有“推广中”单元的渠道编号（1/2/3/4）；
    // 旧的“全站报表有记录”文本不再输出，避免与渠道编号口径混淆。
    result.sitePromotion=channels?(channels.get(String(result.productId))??null):null;
    result.refundScenes=[...new Set(ordered.map(row=>row.refundScenes).filter(Boolean))].join('、')||null;
    if(!result.createdAt)result.createdAtReason=CREATED_AT_REASON;
    // 商品资料（天猫“我的商品”）只补齐经营报表没有的商品状态与创建时间，
    // 不会覆盖生意参谋已经返回的值；来源会写进导出与悬停说明。
    if(catalog){
      const entry=catalog.get(String(result.productId));
      if(entry){
        if(!result.title&&entry.title)result.title=entry.title;
        if(!result.itemStatus&&entry.itemStatus)result.itemStatus=entry.itemStatus;
        if(!result.categoryId&&entry.categoryId)result.categoryId=entry.categoryId;
        if(entry.createdAt){
          if(!result.createdAt){result.createdAt=entry.createdAt;delete result.createdAtReason;result.createdAtSource='商品库（我的商品）';}
          else result.createdAtSource='生意参谋';
        }
      }
    }
    if(coverage)result.dataCoverage=productCoverageText(result.productId,coverage);
    if(now)result.listedDays=listedDaysOf(result.createdAt,now);
    // 黑名单与待办是本机标记：表格显示数量并用颜色区分，导出写内容与时间。
    if(marks){
      const entries=marks.todos?.[result.productId]||[];
      if(entries.length){
        result.todoCount=entries.length;
        result.todo=entries.map(item=>item.content).join('\n');
        result.todoAt=entries.map(item=>item.at).sort().at(-1)||null;
        result.todoList=entries.map(item=>({id:item.id,at:item.at,account:item.account,content:item.content}));
      }
      const black=marks.blacklist?.[result.productId];
      if(black){result.blacklisted='是';result.blacklistAt=black.at;}
    }
    Object.assign(result,adjustedValues(result));
    return result;
  });
}
function weightedItemRoi(rows){
  let spend=0,weighted=0;
  for(const row of rows){
    if(!numeric(row.adSpend)||!numeric(row.siteAdSpend))return null;
    const itemSpend=Number((row.adSpend-row.siteAdSpend).toFixed(2));
    if(itemSpend<0)return null;
    if(itemSpend===0)continue;
    if(!numeric(row.adRoi))return null;
    spend+=itemSpend;weighted+=itemSpend*row.adRoi;
  }
  return spend>0?Number((weighted/spend).toFixed(6)):null;
}
function summarizeReportRows(rows,kind,{rawRows=rows,complete=true,completeMetrics=null,partialTotals=false}={}){
  const base=summarizeRows(rawRows,kind);
  const summary={...base,...aggregateMetrics(rows,{kind,complete,completeMetrics,partialTotals}),rows:rows.length,products:kind==='product'?rows.length:0};
  summary.notes=['访客、买家和搜索访客为日记录累计，不是区间去重人数；商品汇总只累计所选区间实际保存的日记录。','转化率、客单价及全店销售ROI按对应累计值相除，不平均每日比例；分母为0或缺失时留空。','合计只汇总已保存/已同步的日期；缺失的整天不按 0 计算，会在完整性说明里逐日列出。','采购、操作单来源、报销费用及利润暂不计算；“扣费设置”里的扣点、技术费、中转仓、客服、税费按已确认公式逐日计算。'];
  if(kind==='product'){
    summary.notes.push('商品广告费包含不同来源时不与单一来源成交额混算广告ROI；多日退款率缺少明确分母时留空。');
    summary.notes.push('完整来源已确认当天无该商品记录的日期按 0 累计；未同步、同步失败、分页不完整或字段缺失的日期保持空白，不按 0 计算。');
    summary.notes.push('创建时间只在官方商品行明确返回时写入并参与筛选；未返回时保持 —，不能用统计日期、标题或商品ID推断。');
    summary.notes.push('“减操作单数据”= 生意参谋买家数 − 操作单单量、生意参谋销售额 − 操作单本金；操作单来源未接入时按 0 相减。');
    Object.assign(summary,adjustedValues(summary));
  }
  return summary;
}
function reportTotalRow(summary,kind){
  const row=Object.fromEntries(REPORT_SCHEMA.columns(kind).map(column=>[column.key,summary[column.key]??null]));
  row[kind==='daily'?'date':'storeName']='合计';
  return row;
}
function filterAndSortRows(input,query){
  const ids=new Set(query.productIds),title=fold(query.title),category=fold(query.category),keyword=fold(query.query);
  const rows=input.map((row,index)=>({row,index})).filter(({row})=>
    (!keyword||[row.productId,row.title,row.category,row.storeName].some(value=>fold(value).includes(keyword)))&&
    (!title||fold(row.title).includes(title))&&(!category||fold(row.category).includes(category))&&(!query.itemStatus||row.itemStatus===query.itemStatus)&&(!query.creationStart&&!query.creationEnd||typeof row.createdAt==='string'&&(!query.creationStart||row.createdAt.slice(0,10)>=query.creationStart)&&(!query.creationEnd||row.createdAt.slice(0,10)<=query.creationEnd))&&(!query.categoryId||row.categoryId===query.categoryId)&&(!query.blacklist||(query.blacklist==='yes')===Boolean(row.blacklisted))&&(!query.todoStatus||(query.todoStatus==='has')===Boolean(row.todoCount))&&(!ids.size||ids.has(row.productId)));
  const missing=value=>value===null||value===undefined||value==='';
  rows.sort((left,right)=>{
    const a=left.row[query.sortBy],b=right.row[query.sortBy];
    // Missing values always remain last, for both ascending and descending order.
    if(missing(a)!==missing(b))return missing(a)?1:-1;
    let compared=0;
    if(!missing(a))compared=NUMERIC_FIELDS.has(query.sortBy)?a-b:collator.compare(String(a),String(b));
    if(compared)return query.sortDirection==='asc'?compared:-compared;
    return String(right.row.date).localeCompare(String(left.row.date))||String(left.row.productId||'').localeCompare(String(right.row.productId||''))||left.index-right.index;
  });
  return rows.map(({row})=>row);
}

module.exports={SORT_FIELDS,normalizeBusinessQuery,filterAndSortRows,monthRange,productIds,aggregateProductRows,summarizeReportRows,reportTotalRow,productKey,weightedItemRoi,productCoverageText,listedDaysOf,CREATED_AT_REASON};
