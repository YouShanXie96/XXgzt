'use strict';
// 趋势选品（参考同类工作台）：把本机保存的“趋势关键词”批次聚合成
// 每月上品推荐 / 品线看板 / 关键词列表 / 上品日历 / 过滤规则 所需的只读数据。
// 所有指标都来自已保存的生意参谋趋势批次；不访问平台、不伪造缺失值。

const DAY=86400000;
const GRADE_ORDER={S:3,A:2,B:1,'':0};
const num=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
const avg=values=>{const list=values.filter(value=>value!==null&&Number.isFinite(value));return list.length?list.reduce((sum,value)=>sum+value,0)/list.length:null;};
const median=values=>{const list=values.filter(value=>value!==null&&Number.isFinite(value)).sort((a,b)=>a-b);if(!list.length)return null;const mid=Math.floor(list.length/2);return list.length%2?list[mid]:(list[mid-1]+list[mid])/2;};
const dateMs=value=>{const ms=Date.parse(`${String(value||'')}T00:00:00Z`);return Number.isFinite(ms)?ms:null;};
const iso=ms=>new Date(ms).toISOString().slice(0,10);
const addDays=(ms,days)=>ms+days*DAY;
const monthOf=ms=>new Date(ms).getUTCMonth()+1;
const dayOf=ms=>new Date(ms).getUTCDate();
const pct=(current,previous)=>current==null||previous==null||previous===0?null:(current-previous)/previous;
// 类目路径用 ">" 分层；同一层内的 "/" 是类目名称的一部分（如“零食/坚果/特产 > 月饼”），不能拆开。
const normPath=value=>String(value||'').split(/\s*(?:>|＞|｜|\|)\s*/u).map(part=>part.trim()).filter(Boolean);
const fmtMonthDay=ms=>ms==null?'全年':`${monthOf(ms)}月${dayOf(ms)}日`;

function pctChange(current,previous){
  return pct(current,previous);
}

/** 同一关键词在多个批次里出现时，按日期合并；较新的批次覆盖同一天的旧值。 */
function mergeDatasets(datasets){
  const byKeyword=new Map();
  const ordered=[...datasets].sort((a,b)=>String(a.capturedAt||'').localeCompare(String(b.capturedAt||'')));
  for(const dataset of ordered){
    const keyword=String(dataset.context?.keyword||'').trim();
    if(!keyword)continue;
    const entry=byKeyword.get(keyword)||{keyword,categories:new Set(),rows:new Map(),batchCount:0,lastCapturedAt:''};
    entry.batchCount+=1;
    const category=String(dataset.context?.category||'').trim();
    if(category)entry.categories.add(category);
    for(const row of Array.isArray(dataset.rows)?dataset.rows:[]){
      const date=String(row?.date||'');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
      entry.rows.set(date,{...row,date});
    }
    if(String(dataset.capturedAt||'')>entry.lastCapturedAt)entry.lastCapturedAt=String(dataset.capturedAt||'');
    byKeyword.set(keyword,entry);
  }
  return [...byKeyword.values()].map(entry=>({...entry,rows:[...entry.rows.values()].sort((a,b)=>a.date.localeCompare(b.date))}));
}

function ruleMatches(keyword,rule){
  if(!rule||rule.enabled===false)return false;
  const text=String(rule.text||'').trim();
  if(!text)return false;
  return rule.match==='exact'?keyword===text:keyword.includes(text);
}

function reasonsForFilters(keyword,rules={}){
  const reasons=[];
  for(const rule of Array.isArray(rules.brandRules)?rules.brandRules:[])if(ruleMatches(keyword,rule))reasons.push(`大品牌删除：${rule.text}`);
  for(const rule of Array.isArray(rules.keywordRules)?rules.keywordRules:[])if(ruleMatches(keyword,rule))reasons.push(`关键词黑名单：${rule.text}`);
  return reasons;
}

/** 下一年的同一月日；若今年已过去超过 10 天则顺延到明年（年度季节词）。 */
function nextAnnualDate(ms,todayMs,graceDays=10){
  if(ms==null)return null;
  const source=new Date(ms),today=new Date(todayMs);
  let candidate=Date.UTC(today.getUTCFullYear(),source.getUTCMonth(),source.getUTCDate());
  if(candidate<todayMs-graceDays*DAY)candidate=Date.UTC(today.getUTCFullYear()+1,source.getUTCMonth(),source.getUTCDate());
  return candidate;
}

function phaseFor(record,todayMs){
  if(!record.seasonal)return {status:'常年在售',windowStart:null,windowEnd:null};
  const burst=record.burstDateMs;
  const half=Math.max(7,Math.round(record.durationDays/2))*DAY;
  const windowStart=burst-half,windowEnd=burst+half;
  if(todayMs>=windowStart&&todayMs<=windowEnd)return {status:'旺季中',windowStart,windowEnd};
  if(record.listDateMs!=null&&todayMs>=record.listDateMs&&todayMs<windowStart)return {status:'该上品了',windowStart,windowEnd};
  if(record.listDateMs!=null&&record.listDateMs>todayMs)return {status:'准备中',windowStart,windowEnd};
  return {status:'还早',windowStart,windowEnd};
}

function computeKeyword(entry,{leadDays=60,todayMs,rules={}}){
  const rows=entry.rows.map(row=>({date:row.date,t:dateMs(row.date),imp:num(row.impressionIndex),click:num(row.clickIndex),clickRate:num(row.clickRate),conversionRate:num(row.conversionRate)}))
    .filter(row=>Number.isFinite(row.t));
  const valid=rows.filter(row=>row.imp!==null);
  const dataDays=valid.length;
  const categories=[...entry.categories];
  const path=normPath(categories[0]||'');
  const bigLine=path[0]||'未分类';
  const subLine=path.slice(0,2).join(' > ')||bigLine;
  const monthly=Array.from({length:12},()=>({sum:0,count:0,avg:null}));
  for(const row of valid){const index=monthOf(row.t)-1;monthly[index].sum+=row.imp;monthly[index].count+=1;}
  for(const item of monthly)item.avg=item.count?item.sum/item.count:null;
  const monthlyValues=monthly.map(item=>item.avg);
  const maxMonthly=Math.max(...monthlyValues.filter(value=>value!==null),0);
  const heat=monthlyValues.map(value=>value===null||!maxMonthly?0:Number((value/maxMonthly).toFixed(4)));
  const last30=avg(valid.slice(-30).map(row=>row.imp));
  const prev30=avg(valid.slice(-60,-30).map(row=>row.imp));
  const lastDate=valid.at(-1)?.t||null;
  const yoyValues=lastDate==null?[]:valid.filter(row=>row.t<=lastDate-365*DAY&&row.t>lastDate-395*DAY).map(row=>row.imp);
  const yoyBase=avg(yoyValues);
  const baseline=median(valid.filter(row=>lastDate!=null&&row.t>lastDate-365*DAY).map(row=>row.imp));
  // 列表可在 展现/点击/点击率/转化率 之间切换；每个指标都按同一套 近30天/环比/同比口径。
  const metricStats=key=>{
    const list=rows.map(row=>({t:row.t,value:num(row[key])})).filter(row=>row.value!==null);
    const current=avg(list.slice(-30).map(row=>row.value));
    const previous=avg(list.slice(-60,-30).map(row=>row.value));
    const year=list.filter(row=>lastDate!=null&&row.t<=lastDate-365*DAY&&row.t>lastDate-395*DAY);
    return {last30:current,mom:pctChange(current,previous),yoy:pctChange(current,avg(year.map(row=>row.value)))};
  };
  const metrics={impressionIndex:{last30,mom:pctChange(last30,prev30),yoy:pctChange(last30,yoyBase)},clickIndex:metricStats('click'),clickRate:metricStats('clickRate'),conversionRate:metricStats('conversionRate')};
  // 30 天滑窗找最强的一段；再向前后扩展连续高于基线 1.15 倍的区间。
  let best=null;
  for(let index=0;index+30<=valid.length;index+=1){
    const slice=valid.slice(index,index+30),score=avg(slice.map(row=>row.imp));
    if(score==null)continue;
    // 多个年份强度相同时取最近的一段（推荐要按最近一年的季节）；
    // 否则合成数据/多年同样的旺季会一直指向最早那年。
    if(!best||score>best.score||(score===best.score&&index>best.start))best={score,start:index,end:index+29};
  }
  let seasonal=false,type='数据不足',grade='',strength=null,durationDays=0,peakDateMs=null,peakWindow=null,clickRising=false;
  if(dataDays>=120&&best&&baseline!=null&&baseline>0){
    let start=best.start,end=best.end;
    while(start>0&&valid[start-1].imp>=baseline*1.15&&best.start-start<150)start-=1;
    while(end<valid.length-1&&valid[end+1].imp>=baseline*1.15&&end-best.end<150)end+=1;
    peakWindow=valid.slice(start,end+1);
    // 平顶旺季（很多天的数值相同）取平顶的中点，避免把“高峰”算在季节第一天。
    const maxImp=Math.max(...peakWindow.map(row=>row.imp));
    const plateau=peakWindow.filter(row=>row.imp===maxImp);
    const middle=(peakWindow[0].t+peakWindow[peakWindow.length-1].t)/2;
    const peak=plateau.reduce((left,right)=>Math.abs(right.t-middle)<Math.abs(left.t-middle)?right:left);
    peakDateMs=peak.t;
    durationDays=end-start+1;
    strength=avg(peakWindow.map(row=>row.imp))/baseline;
    const clickBase=avg(valid.filter(row=>row.t>lastDate-365*DAY).map(row=>row.click));
    const clickPeak=avg(peakWindow.map(row=>row.click));
    clickRising=clickBase!=null&&clickPeak!=null&&clickPeak>=clickBase*1.03;
    if(durationDays<20&&strength>=1.45){type='短暂冲高型';seasonal=false;}
    else if(strength>=1.25&&durationDays>=20){type=strength>=1.45?'季节爆发型':'季节复现型';seasonal=true;}
    else{
      const first=avg(valid.slice(0,Math.max(10,Math.floor(valid.length/4))).map(row=>row.imp));
      const recent=avg(valid.slice(-Math.max(10,Math.floor(valid.length/4))).map(row=>row.imp));
      type=first&&recent&&recent>=first*1.25?'持续增长型':'平稳需求型';
    }
    if(strength>=1.7&&durationDays>=45&&clickRising)grade='S';
    else if(strength>=1.45&&durationDays>=30)grade='A';
    else if(strength>=1.25&&durationDays>=20)grade='B';
  }else if(dataDays>0){
    const first=avg(valid.slice(0,Math.max(10,Math.floor(valid.length/4))).map(row=>row.imp));
    const recent=avg(valid.slice(-Math.max(10,Math.floor(valid.length/4))).map(row=>row.imp));
    type=dataDays<120?'数据不足':first&&recent&&recent>=first*1.25?'持续增长型':'平稳需求型';
  }
  const annualPeak=seasonal?nextAnnualDate(peakDateMs,todayMs,Math.max(10,Math.round(durationDays/2))):null;
  const listDateMs=annualPeak==null?null:annualPeak-leadDays*DAY;
  const daysToBurst=annualPeak==null?null:Math.round((annualPeak-todayMs)/DAY);
  const removedBy=reasonsForFilters(entry.keyword,rules);
  const record={
    id:entry.keyword,keyword:entry.keyword,categories,bigLine,subLine,
    monthly,heat,last30,mom:pctChange(last30,prev30),yoy:pctChange(last30,yoyBase),metrics,
    peakMonth:monthly.reduce((bestIndex,item,index)=>item.avg!=null&&(bestIndex===null||item.avg>monthly[bestIndex].avg)?index:bestIndex,null),
    seasonal,seasonType:type,grade,strength,durationDays,clickRising,peakDateMs,burstDateMs:annualPeak,listDateMs,
    burstDate:annualPeak==null?null:iso(annualPeak),listDate:listDateMs==null?null:iso(listDateMs),daysToBurst,
    status:'',removed:removedBy.length>0,removedBy,dataDays,lastDate:lastDate==null?null:iso(lastDate),
    batchCount:entry.batchCount,lastCapturedAt:entry.lastCapturedAt,daily:rows.map(row=>({date:row.date,impressionIndex:row.imp,clickIndex:row.click}))
  };
  if(record.peakMonth!=null)record.peakMonth+=1;
  Object.assign(record,phaseFor(record,todayMs));
  if(record.removed)record.status='已剔除';
  return record;
}

function pickLead(members){
  const seasonal=members.filter(item=>item.seasonal&&!item.removed);
  const pool=seasonal.length?seasonal:members;
  return [...pool].sort((a,b)=>{
    const grade=GRADE_ORDER[b.grade]-GRADE_ORDER[a.grade];if(grade)return grade;
    const da=a.daysToBurst==null?9999:a.daysToBurst<0?Math.abs(a.daysToBurst)+1000:a.daysToBurst;
    const db=b.daysToBurst==null?9999:b.daysToBurst<0?Math.abs(b.daysToBurst)+1000:b.daysToBurst;
    return da-db||b.last30-a.last30;
  })[0]||null;
}

function weightedAverage(items,key,weightKey='last30'){
  const list=items.filter(item=>item[key]!==null&&Number.isFinite(item[key]));
  if(!list.length)return null;
  const weightTotal=list.reduce((sum,item)=>sum+Math.max(0,Number(item[weightKey])||0),0);
  if(!weightTotal)return avg(list.map(item=>item[key]));
  return list.reduce((sum,item)=>sum+item[key]*Math.max(0,Number(item[weightKey])||0),0)/weightTotal;
}

function aggregateLines(keywords,level){
  const groups=new Map();
  for(const item of keywords){
    if(item.removed)continue;
    const key=level==='big'?item.bigLine:item.subLine;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(item);
  }
  return [...groups.entries()].map(([name,members])=>{
    const lead=pickLead(members);
    const seasonalMembers=members.filter(item=>item.seasonal);
    const typeCounts=new Map();for(const item of seasonalMembers)typeCounts.set(item.seasonType,(typeCounts.get(item.seasonType)||0)+1);
    const seasonType=[...typeCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'平稳需求型';
    const grade=members.reduce((best,item)=>GRADE_ORDER[item.grade]>GRADE_ORDER[best]?item.grade:best,'');
    const last30=members.reduce((sum,item)=>sum+(item.last30||0),0)||null;
    const mom=weightedAverage(members,'mom');const yoy=weightedAverage(members,'yoy');
    const monthlyHeat=Array.from({length:12},(_,index)=>{
      const total=members.reduce((sum,item)=>sum+Math.max(0,item.last30||0),0);
      if(!total)return avg(members.map(item=>item.heat?.[index]||0))||0;
      return members.reduce((sum,item)=>sum+(item.heat?.[index]||0)*Math.max(0,item.last30||0),0)/total;
    });
    const subCount=level==='big'?new Set(members.map(item=>item.subLine)).size:null;
    return {
      id:name,name,level,members:members.length,
      scale:level==='big'?`${subCount} 个细分 · ${members.length} 个词`:`${members.length} 个关键词`,
      grade,seasonType,heat:monthlyHeat,last30,mom,yoy,
      burstDate:lead?.burstDate||null,listDate:lead?.listDate||null,daysToBurst:lead?.daysToBurst??null,
      status:lead?.status||'常年在售',strength:lead?.strength??null,durationDays:lead?.durationDays??0,
      mainKeywords:[...members].sort((a,b)=>(b.last30||0)-(a.last30||0)).slice(0,3).map(item=>item.keyword),
      leadKeyword:lead?.keyword||'',peakMonth:lead?.peakMonth||null
    };
  }).sort((a,b)=>{
    const grade=GRADE_ORDER[b.grade]-GRADE_ORDER[a.grade];if(grade)return grade;
    return (b.last30||0)-(a.last30||0);
  });
}

function calendarBuckets(keywords,{todayMs,horizonDays=60}){
  const lanes={now:[],soon:[],hot:[],flat:[]};
  for(const item of keywords){
    if(item.removed)continue;
    if(!item.seasonal){lanes.flat.push(item);continue;}
    if(item.status==='该上品了'||(item.listDateMs!=null&&item.listDateMs<=todayMs&&todayMs<item.windowStart))lanes.now.push(item);
    else if(item.status==='旺季中'||(item.windowStart!=null&&todayMs>=item.windowStart&&todayMs<=item.windowEnd))lanes.hot.push(item);
    else if(item.windowStart!=null&&item.windowStart>todayMs&&item.windowStart-todayMs<=horizonDays*DAY)lanes.soon.push(item);
  }
  const order=(a,b)=>GRADE_ORDER[b.grade]-GRADE_ORDER[a.grade]||(a.daysToBurst??9999)-(b.daysToBurst??9999);
  for(const key of Object.keys(lanes))lanes[key].sort(order);
  return lanes;
}

function buildTrendBoard(datasets,{leadDays=60,today=new Date(),rules={}}={}){
  const todayMs=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate());
  const merged=mergeDatasets(Array.isArray(datasets)?datasets:[]);
  const keywords=merged.map(entry=>computeKeyword(entry,{leadDays,todayMs,rules}));
  const usable=keywords.filter(item=>!item.removed);
  const bigLines=aggregateLines(usable,'big');
  const subLines=aggregateLines(usable,'sub');
  const months=Array.from({length:12},(_,index)=>({month:index+1,count:0,lines:[]}));
  for(const line of subLines){
    let month=null;
    if(line.listDate){const parsed=Date.parse(`${line.listDate}T00:00:00Z`);if(Number.isFinite(parsed))month=monthOf(parsed);}
    else if(line.peakMonth)month=line.peakMonth;
    if(month){months[month-1].count+=1;months[month-1].lines.push(line.name);}
  }
  const gradeCounts={S:0,A:0,B:0,all:subLines.length};
  for(const line of subLines)if(gradeCounts[line.grade]!==undefined)gradeCounts[line.grade]+=1;
  const lanes=calendarBuckets(usable,{todayMs,horizonDays:60});
  return {
    schemaVersion:1,
    generatedAt:new Date().toISOString(),
    today:iso(todayMs),
    leadDays,
    stats:{
      keywords:keywords.length,usable:usable.length,removed:keywords.length-usable.length,
      seasonal:usable.filter(item=>item.seasonal).length,
      bigLines:bigLines.length,subLines:subLines.length
    },
    gradeCounts,months,keywords,bigLines,subLines,
    calendar:{
      now:{count:lanes.now.length,items:lanes.now.slice(0,8).map(item=>item.keyword)},
      soon:{count:lanes.soon.length,items:lanes.soon.slice(0,8).map(item=>item.keyword)},
      hot:{count:lanes.hot.length,items:lanes.hot.slice(0,8).map(item=>item.keyword)},
      flat:{count:lanes.flat.length,items:lanes.flat.slice(0,8).map(item=>item.keyword)}
    },
    lanes,
    filters:{brandRules:Array.isArray(rules.brandRules)?rules.brandRules:[],keywordRules:Array.isArray(rules.keywordRules)?rules.keywordRules:[]}
  };
}

module.exports={buildTrendBoard,mergeDatasets,computeKeyword,reasonsForFilters,phaseFor,pctChange,nextAnnualDate,fmtMonthDay};
