'use strict';

// Queries compose independently synchronized sources in commit order. They never
// mutate snapshots or infer a missing value from another source's totals.
const {dateList,REPORT_SCHEMA}=require('./domain');
const hasValue=value=>value!==null&&value!==undefined&&value!=='';
const descriptive=new Set(['date','storeName','productId','title','category','itemStatus','categoryId','createdAt']);
const completed=snapshot=>(snapshot.sourceCoverage||[]).filter(source=>source.status==='completed');
// A completed source only contributes proven-absent zeros when its own
// pagination proof covers that exact date. Anything else stays "not obtained".
const adDateProof=(snapshot,date)=>{
  const proof=new Map((snapshot.adSources?.coverage||[]).filter(item=>item.date===date).map(item=>[item.kind,item]));
  return ['item_promotion','site_cost_ratio'].every(kind=>{
    const item=proof.get(kind);if(!item)return false;
    const unique=item.uniqueProducts===undefined?item.rowCount:item.uniqueProducts;
    return item.total===item.rowCount&&item.rowCount===unique&&item.totalPages===item.completedPages&&item.totalPages===Math.max(1,Math.ceil(item.total/100));
  });
};
const sycmDateProof=(snapshot,date)=>{
  const coverage=snapshot.sycmCoverage;
  if(!coverage)return snapshot.coverage?.complete===true&&(snapshot.coverage.dates||[]).includes(date);
  return coverage.complete===true&&(coverage.dates||[]).includes(date);
};
// Only activity metrics of the complete 生意参谋 item report may become zero
// when the product is absent from that report. Refund amount/rate are excluded:
// a refund can be recorded on a day without other activity, so absence from the
// activity report is not proof of a zero refund. Those stay blank instead.
const SYCM_ACTIVITY_METRICS=Object.freeze(['visitors','pageViews','buyers','payAmount','cartItems','searchVisitors']);
// 快照会把多来源合并成同一行，所以“该商品当天是否出现在生意参谋商品报表里”不能用
// “行是否存在”判断。这里与快照校验保持同一口径：至少有一个生意参谋指标有值才算列出。
const SYCM_VALUE_FIELDS=Object.freeze(['visitors','pageViews','buyers','payAmount','cartItems','searchVisitors','refundAmount','conversionRate','unitPrice']);
const sycmListedIds=(snapshot,date)=>new Set(snapshot.rows
  .filter(row=>row.date===date&&SYCM_VALUE_FIELDS.some(key=>row[key]!==null&&row[key]!==undefined))
  .map(row=>row.productId));
const sourceFields=source=>new Set([
  ...REPORT_SCHEMA.DEFINITIONS.filter(column=>column.source===source).map(column=>column.key),
  // Pre-VOC snapshots stored refundRate as a SYCM/page observation. Replacing
  // that legacy base must clear its old rate and coverage. This only clears
  // base fields; completed VOC layers are reapplied independently below.
  ...(source==='sycm'?['title','category','itemStatus','categoryId','createdAt','affiliateCommission','refundRate']:[]),
]);
const overlaps=(snapshot,range)=>dateList(snapshot.start>range.start?snapshot.start:range.start,snapshot.end<range.end?snapshot.end:range.end);

function selectSourceSummaries(summaries,range){
  const states=new Map(),needed=[];
  for(const snapshot of summaries.slice().reverse()){
    const legacy=!(snapshot.sourceCoverage||[]).length,sources=completed(snapshot);let contributes=false;
    for(const date of overlaps(snapshot,range)){
      if(!states.has(date))states.set(date,{legacy:false,sources:new Set()});
      const state=states.get(date);if(state.legacy)continue;
      if(legacy){state.legacy=true;contributes=true;continue;}
      for(const source of sources)if(!state.sources.has(source.key)){state.sources.add(source.key);contributes=true;}
    }
    if(contributes)needed.push(snapshot);
  }
  return needed.reverse();
}

function composeSourceRows(snapshots,{mode,start,end,scope='full'}){
  const byDate=new Map();
  if(scope==='visible-page'){
    const snapshot=snapshots.at(-1);if(!snapshot)return byDate;
    for(const date of snapshot.coverage.dates)if(date>=start&&date<=end)byDate.set(date,snapshot.rows.filter(row=>row.date===date).map(row=>({...row})));
    return byDate;
  }
  const states=new Map();
  for(const [position,snapshot]of snapshots.entries()){
    const legacy=!(snapshot.sourceCoverage||[]).length,sources=completed(snapshot);
    if(!legacy&&!sources.length)continue;
    const grouped=new Map(snapshot.coverage.dates.filter(date=>date>=start&&date<=end).map(date=>[date,[]]));
    for(const row of snapshot.rows)grouped.get(row.date)?.push(row);
    for(const [date,rows]of grouped){
      if(!states.has(date)||legacy)states.set(date,{base:new Map(),layers:new Map(),storeName:snapshot.source.shopName});
      const state=states.get(date),key=row=>mode==='product'?row.productId:'';
      if(legacy){state.base=new Map(rows.map(row=>[key(row),row]));continue;}
      for(const source of sources){
        const sourceRows=rows.filter(row=>mode==='daily'||source.metrics.some(metric=>!descriptive.has(metric)&&hasValue(row[metric])));
        state.layers.set(source.key,{source,position,rows:new Map(sourceRows.map(row=>[key(row),row]))});
      }
    }
  }
  for(const [date,state]of states){
    const layers=[...state.layers.values()].sort((a,b)=>a.position-b.position),clear=new Set(layers.flatMap(layer=>[...sourceFields(layer.source.key)]));
    const ids=new Set([...state.base.keys(),...layers.flatMap(layer=>[...layer.rows.keys()])]),rows=[];
    for(const id of ids){
      const base=state.base.get(id),row={...Object.fromEntries(REPORT_SCHEMA.DEFINITIONS.map(column=>[column.key,null])),itemStatus:null,categoryId:null,...base,date,storeName:base?.storeName||state.storeName,productId:mode==='product'?id:''};
      for(const field of clear)row[field]=null;
      // An old product disappears when its only remaining source was replaced.
      // Identity and descriptive text alone do not keep a stale product alive.
      const identity=new Set(['date','storeName','productId','title','category','itemStatus','categoryId']);
      let present=mode==='daily'||Boolean(base&&Object.entries(row).some(([key,value])=>!identity.has(key)&&hasValue(value)&&(!Array.isArray(value)||value.length)));
      for(const layer of layers){
        const update=layer.rows.get(id);if(!update)continue;present=true;
        for(const metric of layer.source.metrics)row[metric]=update[metric]??null;
        if(layer.source.key==='sycm')for(const field of ['title','category','itemStatus','categoryId','createdAt'])row[field]=update[field]??null;
      }
      if(!hasValue(row.title))for(const layer of layers.slice().reverse()){
        const title=layer.rows.get(id)?.title;
        if(hasValue(title)){row.title=title;break;}
      }
      if(present)rows.push(row);
    }
    byDate.set(date,rows);
  }
  return byDate;
}

function composeMetricCoverage(snapshots,{start,end,scope='full'}){
  const selected=scope==='visible-page'?snapshots.slice(-1):snapshots,states=new Map();
  for(const snapshot of selected){
    const legacy=!(snapshot.sourceCoverage||[]).length,sources=completed(snapshot);
    for(const date of snapshot.coverage.dates){
      if(date<start||date>end)continue;
      if(!states.has(date)||legacy)states.set(date,{base:new Set(),layers:new Map()});
      const state=states.get(date);
      if(legacy){
        for(const row of snapshot.rows)if(row.date===date)for(const key of REPORT_SCHEMA.METRICS)if(hasValue(row[key]))state.base.add(key);
      }else for(const source of sources)state.layers.set(source.key,source.metrics);
    }
  }
  return new Map([...states].map(([date,state])=>{
    const fields=new Set(state.base);
    for(const source of state.layers.keys())for(const key of sourceFields(source))fields.delete(key);
    for(const metrics of state.layers.values())for(const key of metrics)fields.add(key);
    return [date,fields];
  }));
}

/**
 * Per-date set of sources whose complete report proves absence for that date.
 * A date with a legacy (proof-less) snapshot is marked legacy and contributes
 * no proven-absent zeros, so old data is never turned into a new zero.
 */
function composeSourceCoverage(snapshots,{start,end,scope='full'}={}){
  const map=new Map();
  if(scope!=='full')return map;
  for(const snapshot of snapshots){
    const legacy=!(snapshot.sourceCoverage||[]).length,sources=completed(snapshot);
    for(const date of snapshot.coverage?.dates||[]){
      if(date<start||date>end)continue;
      if(legacy){map.set(date,{legacy:true,sources:new Set()});continue;}
      const entry=map.get(date);if(entry?.legacy)continue;
      const state=entry||{legacy:false,sources:new Set()};
      for(const source of sources){
        if(source.key==='sycm'&&!sycmDateProof(snapshot,date))continue;
        if(source.key==='promotion'&&!adDateProof(snapshot,date))continue;
        state.sources.add(source.key);
      }
      map.set(date,state);
    }
  }
  return map;
}

function fillProvenAbsentProductAds(snapshots,byDate,{start,end,scope='full'}={}){
  if(scope!=='full')return byDate;
  const promotionByDate=new Map(),sycmByDate=new Map();
  for(const snapshot of snapshots){
    const legacy=!(snapshot.sourceCoverage||[]).length;
    for(const date of snapshot.coverage.dates){
      if(date<start||date>end)continue;
      if(legacy){promotionByDate.delete(date);sycmByDate.delete(date);continue;}
      const sources=completed(snapshot);
      if(sources.some(source=>source.key==='promotion')&&adDateProof(snapshot,date))promotionByDate.set(date,snapshot);
      if(sources.some(source=>source.key==='sycm')&&sycmDateProof(snapshot,date))sycmByDate.set(date,snapshot);
    }
  }
  for(const [date,ads] of promotionByDate){
    const adProducts=new Set((ads.adSources?.rows||[]).filter(row=>row.date===date&&['item_promotion','site_cost_ratio'].includes(row.sourceKind)).map(row=>row.productId));
    const merged=new Map((byDate.get(date)||[]).map(row=>[row.productId,row]));
    const core=sycmByDate.get(date);
    const listed=core?sycmListedIds(core,date):new Set();
    for(const sourceRow of core?.rows||[]){
      if(sourceRow.date!==date)continue;
      if(!listed.has(sourceRow.productId))continue;
      if(adProducts.has(sourceRow.productId))continue;
      const row=merged.get(sourceRow.productId);if(!row)continue;
      row.adSpend=0;row.siteAdSpend=0;row.adRevenue=0;row.adRoi=null;row.sitePromotion=null;
    }
  }
  for(const [date,core] of sycmByDate){
    const listed=sycmListedIds(core,date);
    for(const row of byDate.get(date)||[]){
      if(listed.has(row.productId))continue;
      let filled=false;
      for(const key of SYCM_ACTIVITY_METRICS)if(row[key]===null||row[key]===undefined){row[key]=0;filled=true;}
      if(!filled)continue;
    }
  }
  return byDate;
}

/**
 * For every date with a proven complete report, the exact product ids that
 * report listed. A product missing from that set on that date is a proven zero
 * for the source's activity/advertisement metrics (never for refund amounts).
 */
function provenSourceProductSets(snapshots,{start,end,scope='full'}={}){
  if(scope!=='full')return null;
  const sets=new Map();
  const entry=date=>{if(!sets.has(date))sets.set(date,{});return sets.get(date);};
  for(const snapshot of snapshots){
    const legacy=!(snapshot.sourceCoverage||[]).length,sources=completed(snapshot).map(source=>source.key);
    for(const date of snapshot.coverage?.dates||[]){
      if(date<start||date>end)continue;
      if(legacy){sets.delete(date);continue;}
      if(sources.includes('sycm')){
        if(sycmDateProof(snapshot,date))entry(date).sycm=sycmListedIds(snapshot,date);
        else delete entry(date).sycm;
      }
      if(sources.includes('promotion')){
        if(adDateProof(snapshot,date))entry(date).promotion=new Set((snapshot.adSources?.rows||[]).filter(row=>row.date===date).map(row=>row.productId));
        else delete entry(date).promotion;
      }
    }
  }
  return sets;
}

/**
 * Official per-date/per-source totals taken from saved pagination proofs.
 * These numbers describe the platform reports this machine actually read; they
 * are never a claim about the whole shop catalogue.
 */
function officialSourceCounts(snapshots,{start,end,scope='full'}={}){
  if(scope!=='full')return [];
  const state=new Map();
  const put=(key,label,date,entry)=>{
    if(!state.has(key))state.set(key,{key,label,dates:new Map()});
    state.get(key).dates.set(date,entry);
  };
  for(const snapshot of snapshots){
    if(!(snapshot.sourceCoverage||[]).length)continue;
    const sources=completed(snapshot).map(source=>source.key);
    for(const date of snapshot.coverage?.dates||[]){
      if(date<start||date>end)continue;
      if(sources.includes('sycm')&&sycmDateProof(snapshot,date)){
        const ids=sycmListedIds(snapshot,date);
        const proof=(snapshot.sycmCoverage?.perDate||[]).find(item=>item.date===date);
        put('sycm','生意参谋商品报表',date,{totalRows:proof?.totalRows??ids.size,ids,pages:proof?.completedPages??1,totalPages:proof?.expectedPages??1});
      }
      if(sources.includes('promotion')&&(snapshot.adSources?.coverage||[]).some(item=>item.date===date)){
        const proofs=snapshot.adSources.coverage.filter(item=>item.date===date);
        const ids=new Set((snapshot.adSources.rows||[]).filter(row=>row.date===date).map(row=>row.productId));
        put('promotion','广告报表明细',date,{totalRows:proofs.reduce((sum,item)=>sum+item.total,0),ids,pages:proofs.reduce((sum,item)=>sum+item.completedPages,0),totalPages:proofs.reduce((sum,item)=>sum+item.totalPages,0)});
      }
      const refundSource=sources.includes('refund')?(snapshot.financeSources||[]).find(item=>item.key==='refund'):null;
      if(refundSource){
        const pages=(refundSource.pages||[]).filter(page=>page.date===date);
        if(pages.length)put('refund','商品退款来源',date,{totalRows:pages.reduce((sum,page)=>sum+page.total,0),ids:new Set(pages.flatMap(page=>(page.rows||[]).map(row=>row.productId))),pages:pages.length,totalPages:pages.length});
      }
    }
  }
  return [...state.values()].map(entry=>{
    const dates=[...entry.dates.keys()].sort(),ids=new Set();let totalRows=0,pages=0,totalPages=0;
    for(const value of entry.dates.values()){for(const id of value.ids)ids.add(id);totalRows+=value.totalRows;pages+=value.pages;totalPages+=value.totalPages;}
    return {key:entry.key,label:entry.label,dates,days:dates.length,totalRows,uniqueProducts:ids.size,pages,totalPages,
      perDate:dates.map(date=>{const value=entry.dates.get(date);return {date,totalRows:value.totalRows,uniqueProducts:value.ids.size,pages:value.pages,totalPages:value.totalPages};})};
  });
}

module.exports={selectSourceSummaries,composeSourceRows,composeMetricCoverage,composeSourceCoverage,fillProvenAbsentProductAds,provenSourceProductSets,officialSourceCounts,SYCM_ACTIVITY_METRICS};
