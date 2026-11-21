'use strict';

const {randomUUID}=require('node:crypto');
const {mode,identifier,text,validateRange,validateSnapshot,safeMessage,COLUMNS,REPORT_SCHEMA,dateList}=require('./domain');
const {createBusinessRepository,storeDirectory,checkSignal}=require('./repository');
const {normalizeBusinessQuery,filterAndSortRows,aggregateProductRows,summarizeReportRows,reportTotalRow,productKey,listedDaysOf}=require('./query');
const {composeSourceRows,composeMetricCoverage,composeSourceCoverage,fillProvenAbsentProductAds,provenSourceProductSets,officialSourceCounts}=require('./query-sources');
const {financeExportRows,FINANCE_EXPORT_COLUMNS}=require('./finance-details');
const {createManualDaily}=require('./manual-daily');
const {createCatalogReader,createCatalogStore}=require('./catalog');
const {createMarks}=require('./marks');
const {runWithValidationPause}=require('./validation-gate');
const {createPromotionChannelsReader,createPromotionChannelsStore}=require('./promotion-channels');
const {mergeDailyQueries}=require('./store-scope');
const {createLoginWarmup}=require('./login-warmup');
const {FullSyncError}=require('./full-sync');

function syncSources(value){
  const sources=value===undefined?['sycm']:value;
  if(!Array.isArray(sources)||!sources.length||sources.length>REPORT_SCHEMA.SYNC_SOURCES.length||sources.some(key=>!REPORT_SCHEMA.SYNC_SOURCES.includes(key))||new Set(sources).size!==sources.length)throw new Error('请选择有效且不重复的经营同步来源');
  return [...sources];
}

const VALIDATION_GATE_WAIT_MS=8*60_000,VALIDATION_GATE_POLL_MS=2000;
// 同步来源 → 对应的浏览器页面（“去店铺浏览器完成滑块”用它精确定位正在同步的那个页面）。
const SYNC_SOURCE_PAGES=Object.freeze({
  seller:{kind:'seller',purpose:'business-catalog'},
  sycm:{kind:'sycm',purpose:'business-sycm'},
  promotion:{kind:'promotion',purpose:'business-promotion'},
  channels:{kind:'promotion',purpose:'business-channels'},
  marketing:{kind:'seller',purpose:'business-ppxk'},
  refund:{kind:'seller',purpose:'business-finance'},
  billing:{kind:'seller',purpose:'business-finance'},
  insurance:{kind:'seller',purpose:'business-finance'},
});
// 需求5（本轮）：精细化用带 -product 后缀的独立页面（日报与精细化可以同时同步、互不抢页面）。
// 商品资料与推广渠道只有精细化会用，保持原名。
const MODE_SCOPED_SOURCES=new Set(['sycm','promotion','marketing','refund','billing','insurance']);
function syncPageFor(sourceId,mode){
  const base=SYNC_SOURCE_PAGES[sourceId];
  if(!base)return null;
  if(mode==='product'&&MODE_SCOPED_SOURCES.has(sourceId))return {kind:base.kind,purpose:`${base.purpose}-product`};
  return base;
}
function createBusinessService(ctx,{collector,now=()=>new Date(),cancelGraceMs=20000,channelsReader=null,catalogReader:injectedCatalogReader=null}={}){
  const reader=collector||require('./collector').createBusinessCollector(ctx),repository=createBusinessRepository(ctx);
  const fees=require('./fee-settings').createFeeSettings(ctx),manual=createManualDaily(ctx,{now});
  const catalogStore=createCatalogStore(ctx),catalogReader=injectedCatalogReader||createCatalogReader(ctx,{now});
  const channelsStore=createPromotionChannelsStore(ctx);
  // 需求3：同步前的登录预热（先登录、再隐藏、后读取）——对齐亿满分软件助手的同步方式。
  const loginWarmup=createLoginWarmup(ctx,{});
  // 商品资料超时/限流时，只有页面真的停在验证/滑块上才允许弹出页面；
  // 普通的接口超时（页面仍是正常列表/首页）绝不主动把窗口亮到前台。
  async function catalogPageHasVerification(storeId){
    try{
      const context=typeof ctx.browser?.syncPageContext==='function'
        ?ctx.browser.syncPageContext(storeId,'seller',{purpose:'business-catalog'})
        :null;
      const wc=context?.webContents;
      if(!wc||wc.isDestroyed?.())return false;
      let url='';try{url=wc.getURL?.()||'';}catch{}
      try{
        const parsed=new URL(url);
        if(/(?:^|\.)(?:login|passport|havanalogin)\.(?:taobao|tmall|alibaba)\.com$/i.test(parsed.hostname))return false;
        if(/(?:^|\/)(?:captcha|punish|verify|verification|security|validate|risk)(?:\/|\.|$|\?)/i.test(parsed.pathname+parsed.hash))return true;
      }catch{}
      const probe=await Promise.race([
        wc.executeJavaScript(`(()=>{const t=String(document.body?.innerText||'').slice(0,20000);return /请完成(?:安全)?验证|滑动验证|请拖动滑块|验证码|访问受限|访问过于频繁/.test(t)||!!document.querySelector('iframe[src*="captcha"],.nc-container,[class*="captcha"],[class*="punish"]');})()`,true).catch(()=>false),
        new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),1500);timer.unref?.();})
      ]);
      return probe===true;
    }catch{return false;}
  }
  let channelsService=null;
  const channels=()=>{channelsService=channelsService||channelsReader||createPromotionChannelsReader(ctx,{store:channelsStore});return channelsService;};
  // 每店界面状态（精细化/日报的列显示与列模板）。只保存列名，不保存任何业务数据。
  const UI_COLUMN_KEYS=new Set(REPORT_SCHEMA.DEFINITIONS.map(column=>column.key));
  const uiStatePath=storeId=>`${storeDirectory(identifier(storeId),typeof ctx.storeFolder==='function'?ctx.storeFolder(identifier(storeId)):null)}/ui-state.json`;
  const cleanHidden=list=>[...new Set((Array.isArray(list)?list:[]).filter(key=>typeof key==='string'&&UI_COLUMN_KEYS.has(key)))].slice(0,300);
  function cleanUiState(value){
    const result={schemaVersion:1,columns:{},templates:{}};
    for(const mode of ['daily','product']){
      const hidden=value?.columns?.[mode];if(Array.isArray(hidden))result.columns[mode]=cleanHidden(hidden);
      const templates=value?.templates?.[mode];
      if(templates&&typeof templates==='object'&&!Array.isArray(templates)){
        const map={};
        for(const [name,list]of Object.entries(templates)){
          const clean=String(name??'').trim().slice(0,20);
          if(!clean)continue;
          map[clean]=cleanHidden(list);
          if(Object.keys(map).length>=30)break;
        }
        result.templates[mode]=map;
      }
    }
    return result;
  }
  async function uiStateLoad(storeId){
    const raw=await ctx.readJson(uiStatePath(storeId),null).catch(()=>null);
    return cleanUiState(raw);
  }
  async function uiStateSave(storeId,state){
    const clean=cleanUiState(state);
    await ctx.writeJson(uiStatePath(storeId),{...clean,updatedAt:new Date(now()).toISOString()});
    return clean;
  }
  const marks=createMarks(ctx,{now,account:()=>typeof ctx.currentAccount==='function'?ctx.currentAccount():""});
  const jobs=new Map(),lastSync=new Map(),closingStores=new Set(),validationHints=new Set();let disposed=false,disposePromise;
  // 需求5（本轮）：任务按“店铺 + 页签”区分——同店日报与精细化可以同时进行。
  const jobKey=(id,kind)=>`${id}:${kind}`;
  // 需求（2026-10-13）：每个店铺的“上次同步结果（成功/失败/取消）”要能显示在数据同步面板上，
  // 关掉软件再打开也要看得到：结束状态除了内存里的 lastSync，还落一份很小的状态文件。
  const statusPath=id=>`${storeDirectory(id,typeof ctx.storeFolder==='function'?ctx.storeFolder(id):null)}/sync-status.json`;
  async function recordSyncStatus(storeId,kind,job){
    try{
      const file=await ctx.readJson(statusPath(storeId),null);
      const record=file&&typeof file==='object'?file:{};
      record.schemaVersion=1;
      record[kind]={status:job.phase,message:String(job.message||'').slice(0,600),finishedAt:job.finishedAt||new Date(now()).toISOString(),start:job.start||'',end:job.end||''};
      await ctx.writeJson(statusPath(storeId),record);
    }catch{}
  }
  const syncKey=(storeId,kind)=>`${storeId}:${kind}`;
  const numberOf=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
  const round2=value=>Number(value.toFixed(2));
  const monthDays=date=>{const [year,month]=String(date).split('-').map(Number);return new Date(Date.UTC(year,month,0)).getUTCDate();};
  const percent=value=>value===null?0:value;
  // 当天客服费用 = 月总额 ÷ 当月天数，再按本店当天买家数占全部店铺的比例分摊。
  async function customerServiceShare(storeId,rows){
    const share=new Map();
    const mine=new Map(rows.map(row=>[row.date,numberOf(row.buyers)]));
    for(const [date,own] of mine){
      if(own===null){continue;}
      let others=0;
      for(const store of await ctx.listStores()){
        if(store.id===storeId)continue;
        try{
          const {snapshots}=await repository.querySnapshots(store.id,'daily',{start:date,end:date});
          for(const snapshot of snapshots)for(const row of snapshot.rows)if(row.date===date&&numberOf(row.buyers)!==null)others+=row.buyers;
        }catch{}
      }
      const total=own+others;
      share.set(date,total>0?own/total:0);
    }
    return share;
  }
  // 扣点 =（当天销售额 − 退款金额）× 扣点费率；税费 = 增值税 + 企业所得税 + 印花税。
  // 未设置的费率/金额一律不计算，保持空白；缺失的分项按 0 参与所得税基数并写进说明。
  function applyFeeFormulas(rows,kind,feeRecord,share){
    const domestic=numberOf(feeRecord?.domesticRate);
    const vatRate=numberOf(feeRecord?.taxVat),incomeRate=numberOf(feeRecord?.taxIncome),stampRate=numberOf(feeRecord?.taxStamp);
    const perOrderTechnical=numberOf(feeRecord?.technicalFee),perOrderWarehouse=numberOf(feeRecord?.warehouseExpense),monthlyService=numberOf(feeRecord?.serviceMonthlyFee);
    const perOrder=kind==='daily'?numberOf(feeRecord?.logisticsPerOrder):null;
    for(const row of rows){
      const pay=numberOf(row.payAmount),refund=numberOf(row.refundAmount)??0;
      const net=pay===null?null:Math.max(0,pay-refund);
      if(net!==null&&domestic!==null)row.platformFee=round2(net*domestic/100);
      if(kind!=='daily')continue;
      const days=monthDays(row.date);
      // 每单费用：优先用操作单量；操作单来源尚未接入时按当天支付买家数计。
      const orders=numberOf(row.operationOrders)??numberOf(row.buyers);
      if(orders!==null){
        if(perOrderTechnical!==null)row.technicalFee=round2(orders*perOrderTechnical);
        if(perOrderWarehouse!==null)row.warehouseExpense=round2(orders*perOrderWarehouse);
      }
      if(monthlyService!==null){const portion=share?.get(row.date);row.customerServiceExpense=round2(monthlyService/days*(portion===undefined?0:portion));}
      if(perOrder!==null&&orders!==null)row.operationExpense=round2(orders*perOrder);
      if(net===null)continue;
      const vat=vatRate===null?null:round2(net*vatRate/100);
      const stamp=stampRate===null?null:round2(net*stampRate/100);
      let income=null,incomeBase=null;
      if(incomeRate!==null){
        const ad=numberOf(row.adSpend)??0,commission=numberOf(row.affiliateCommission)??0,brand=numberOf(row.marketingExpense)??0,platform=numberOf(row.platformFee)??0,hosted=0;
        incomeBase=Math.max(0,net-ad-commission-brand+hosted-platform);
        income=round2(incomeBase*incomeRate/100);
      }
      const parts=[vat,income,stamp].filter(value=>value!==null);
      row.taxFee=parts.length?round2(parts.reduce((sum,value)=>sum+value,0)):null;
      row.taxNote=[
        vatRate===null?'':'增值税：(销售额 − 退款金额) × '+vatRate+'% = '+vat,
        incomeRate===null?'':'企业所得税：(销售额 − 退款金额 − 推广总花费 − 淘客佣金 − 品牌新享 − 扣点) × '+incomeRate+'% = '+income,
        stampRate===null?'':'印花税：(销售额 − 退款金额) × '+stampRate+'% = '+stamp,
      ].filter(Boolean).join('\n');
    }
  }
  const checkedStore=storeId=>{const id=identifier(storeId),store=ctx.getStore(id);if(!store||store.id!==id)throw new Error('请先选择有效店铺');return store;};
  function ensureActive(storeId){if(disposed)throw new Error('经营数据服务已停止，请重新启动工作台');if(closingStores.has(storeId))throw new Error('该店铺正在移除，不能继续经营数据操作');}
  function emit(job,message,extra={}){
    const update={module:'business',storeId:job.storeId,mode:job.mode,taskId:job.id,start:job.start,end:job.end,selectedSources:[...job.sources],message:safeMessage(message),status:job.phase};
    for(const key of ['current','total'])if(Number.isFinite(extra[key])&&extra[key]>=0&&extra[key]<=10000000)update[key]=Math.trunc(extra[key]);
    const allowed=new Set(job.sources.filter(id=>REPORT_SCHEMA.SYNC_SOURCES.includes(id)));
    const statuses=new Set(['pending','running','completed','failed','canceled','cancelled']);
    const sources=new Map((job.sourceProgress||[]).map(item=>[item.id,{...item}]));
    if(Array.isArray(extra.sources))for(const item of extra.sources.slice(0,REPORT_SCHEMA.SYNC_SOURCES.length)){
      if(!item||typeof item!=='object'||!allowed.has(item.id)||!statuses.has(item.status))continue;
      const clean={id:item.id,status:item.status,message:safeMessage(typeof item.message==='string'?item.message:'来源状态已更新')};
      for(const key of ['current','total'])if(Number.isFinite(item[key])&&item[key]>=0&&item[key]<=10000000)clean[key]=Math.trunc(item[key]);
      sources.set(item.id,clean);
    }
    if(['failed','canceled','cancelled'].includes(job.phase))for(const [id,item]of sources){
      if(['pending','running'].includes(item.status))sources.set(id,{...item,status:job.phase,message:update.message});
      else if(item.status==='completed')sources.set(id,{...item,message:'读取完成，但本批未保存；原数据保留'});
    }
    if(job.phase==='completed')for(const [id,item]of sources)if(item.status==='completed')sources.set(id,{...item,message:'读取完成，已随本批保存'});
    job.sourceProgress=[...sources.values()];
    if(allowed.has(extra.sourceId))job.sourceId=extra.sourceId;
    if(job.sourceId)update.sourceId=job.sourceId;
    update.sources=job.sourceProgress.map(item=>({...item}));
    if(extra.done===true)update.done=true;
    // 需求2：滑动验证等待状态透传给界面（弹页面给用户划 + 自动继续）。
    if(typeof extra.waitingValidation==='boolean'){update.waitingValidation=extra.waitingValidation;job.waitingValidation=extra.waitingValidation;}
    if(extra.waitingValidation===false)delete job.tabId;
    if(typeof extra.tabId==='string'&&/^tab-\d+$/.test(extra.tabId)){update.tabId=extra.tabId;job.tabId=extra.tabId;}
    Object.assign(job,{message:update.message,...('current'in update?{current:update.current}:{}),...('total'in update?{total:update.total}:{})});
    ctx.emit?.(update);
  }
  function jobStatus(job){return {id:job.id,mode:job.mode,start:job.start,end:job.end,selectedSources:[...job.sources],sources:(job.sourceProgress||[]).map(item=>({...item})),...(job.sourceId?{sourceId:job.sourceId}:{}),...(job.diagnosis?{diagnosis:{...job.diagnosis}}:{}),...(job.waitingValidation===true?{waitingValidation:true,tabId:job.tabId||''}:{}),status:job.phase,message:job.message||'',current:job.current||0,total:job.total||0,startedAt:job.startedAt,...(job.finishedAt?{finishedAt:job.finishedAt}:{}),...(job.snapshotId?{snapshotId:job.snapshotId}:{})};}
  function pageNumber(value,fallback,max){if(value===undefined)return fallback;const result=Number(value);if(!Number.isSafeInteger(result)||result<1||result>max)throw new Error('经营明细分页参数无效');return result;}
  async function queryOne(storeId,p={}){
    const queryOptions=normalizeBusinessQuery(p,now()),kind=queryOptions.mode,range={start:queryOptions.start,end:queryOptions.end};
    // Reading immutable snapshots can overlap a new index commit. Capture job
    // state first so older rows never acquire a newly completed task's status.
    // A running state with newer rows is conservative; the next load refreshes it.
    const runningAtStart=jobs.get(jobKey(storeId,kind)),previousAtStart=lastSync.get(syncKey(storeId,kind));
    const observedSync=runningAtStart?.mode===kind?jobStatus(runningAtStart):previousAtStart?structuredClone(previousAtStart):null;
    const {index,snapshots,scope}=await repository.querySnapshots(storeId,kind,range,p.scope);
    const byDate=composeSourceRows(snapshots,{mode:kind,...range,scope});
    const sourceCoverageByDate=composeSourceCoverage(snapshots,{...range,scope});
    const provenSets=kind==='product'?provenSourceProductSets(snapshots,{...range,scope}):null;
    if(kind==='product')fillProvenAbsentProductAds(snapshots,byDate,{...range,scope});
    const sourceRawRows=[...byDate.values()].flat(),manualData=kind==='daily'?await manual.loadRange(storeId,range):{entries:[],history:[]};
    const manualByKey=new Map(manualData.entries.map(item=>[`${item.date}:${item.field}`,item]));
    const allRawRows=sourceRawRows.map(sourceRow=>{
      const row={...sourceRow};
      if(kind==='daily'){
        row.shopSalesRoi=typeof row.payAmount==='number'&&typeof row.adSpend==='number'&&row.adSpend>0?Number((row.payAmount/row.adSpend).toFixed(6)):null;
        // 每天的推广占比 = 当天推广总花费 ÷ 当天销售额 × 100%，与合计行同一口径；
        // 分母缺失或为 0 时保持空白，不用 0 冒充比例。
        row.promotionShare=typeof row.adSpend==='number'&&typeof row.payAmount==='number'&&row.payAmount>0?Number((row.adSpend/row.payAmount*100).toFixed(6)):null;
        for(const field of ['customProfit','reimbursementExpense']){
          const entry=manualByKey.get(`${row.date}:${field}`);row[field]=entry?.amount??null;row[`${field}Reason`]=entry?.reason||null;
        }
      }
      return row;
    });
    // 已确认的费用公式：扣点、技术费、中转仓、操作单物流费、客服费与三项税费。
    const feeRecord=await fees.load(storeId).catch(()=>null);
    const feeShare=kind==='daily'&&Number.isFinite(feeRecord?.serviceMonthlyFee)?await customerServiceShare(storeId,allRawRows):null;
    applyFeeFormulas(allRawRows,kind,feeRecord,feeShare);
    const latest=snapshots.at(-1);
    // 历史快照可能把一条说明误存成“商”“品”“维”…单个汉字（旧版展开字符串的 bug）。
    // 读取时过滤掉这类单字碎片；新快照已经按整句保存。
    const warnings=[...new Set(snapshots.flatMap(snapshot=>Array.isArray(snapshot.warnings)?snapshot.warnings:[])
      .filter(value=>typeof value==='string'&&value.trim().length>1))];
    const uncovered=dateList(range.start,range.end).filter(date=>!byDate.has(date));
    if(uncovered.length)warnings.push(`所选范围有 ${uncovered.length} 天没有本次展示的已保存数据：${uncovered.join('、')}`);
    const complete=scope==='full'&&uncovered.length===0;
    const metricCoverage=composeMetricCoverage(snapshots,{...range,scope}),dates=dateList(range.start,range.end);
    // 完全没有保存记录的整天按“未知”处理：合计只统计已同步日期（并在说明里逐日列出），
    // 而“有记录但该指标没有被来源覆盖”的日期仍然让该指标留空。
    const coveredDates=dates.filter(date=>byDate.has(date));
    const completeMetrics=scope==='visible-page'?null:new Set(REPORT_SCHEMA.METRICS.filter(key=>coveredDates.length>0&&coveredDates.every(date=>metricCoverage.get(date)?.has(key))));
    // 扣费设置算出的费用不是“来源指标”，只要该店设置了就用行值汇总；
    // 任一已保存行没有该值（例如后来才设置费率）时 sumMetric 仍会留空。
    if(completeMetrics)for(const key of ['platformFee','technicalFee','warehouseExpense','customerServiceExpense','taxFee','operationExpense'])completeMetrics.add(key);
    const catalog=kind==='product'?await catalogStore.load(storeId).catch(()=>null):null;
    const catalogIndex=catalog?new Map(catalog.items.map(item=>[String(item.itemId),item])):null;
    const channelsSnapshot=kind==='product'?await channelsStore.load(storeId).catch(()=>null):null;
    const channelsIndex=channelsSnapshot?new Map(Object.entries(channelsSnapshot.byProduct||{})):null;
    // 商品状态默认“出售中”，但状态来自商品资料；还没同步过商品资料时不能因此把全部商品过滤掉。
    if(kind==='product'&&queryOptions.itemStatus&&!(catalogIndex&&catalogIndex.size)){
      queryOptions.itemStatus='';
      warnings.push('尚未同步商品资料，商品状态筛选暂不生效（已按全部状态展示）；请在“同步整店数据”里勾选“商品资料”。');
    }
    const markData=kind==='product'?await marks.load(storeId).catch(()=>null):null;
    const rows=filterAndSortRows(kind==='product'?aggregateProductRows(allRawRows,{storeId,complete:scope==='visible-page'||complete,completeMetrics,partialTotals:scope==='full',expectedDays:dates.length,coverage:{dates,sourcesByDate:sourceCoverageByDate,proven:provenSets},catalog:catalogIndex,marks:markData,now:now(),channels:channelsIndex}):allRawRows,queryOptions);
    const selectedProductKeys=kind==='product'?new Set(rows.map(row=>productKey(row,storeId))):null;
    const rawRows=kind==='product'?sourceRawRows.filter(row=>selectedProductKeys.has(productKey(row,storeId))).sort((a,b)=>a.date.localeCompare(b.date)||String(a.productId).localeCompare(String(b.productId))):sourceRawRows.filter(row=>rows.some(selected=>selected.date===row.date));
    const summary=summarizeReportRows(rows,kind,{rawRows,complete,completeMetrics,partialTotals:scope==='full'});
    summary.coverage={scope,complete:scope==='full'&&uncovered.length===0,expectedDays:dateList(range.start,range.end).length,coveredDays:byDate.size,missingDates:uncovered};
    const official=officialSourceCounts(snapshots,{...range,scope});
    const localProducts=kind==='product'?new Set(sourceRawRows.map(row=>productKey(row,storeId))).size:0;
    const counts={local:{products:localProducts,records:sourceRawRows.length},matched:{products:kind==='product'?rows.length:rows.length,records:rawRows.length},official,
      ...(catalog?{catalog:{totalCount:catalog.totalCount,capturedAt:catalog.capturedAt,items:catalog.items.length,matched:catalogIndex?rows.filter(row=>catalogIndex.has(String(row.productId))).length:0,statuses:catalog.statuses||{}}}:{})};
    if(kind==='product'){
      // Dates with fewer proven days than the selected range must stay visible:
      // they are blank, not zero, and the row total must say so.
      const labels=[['sycm','生意参谋'],['promotion','广告'],['refund','退款']];
      for(const [source,label]of labels){
        const covered=dates.filter(date=>{const entry=sourceCoverageByDate.get(date);return entry&&!entry.legacy&&entry.sources?.has(source);}).length;
        if(covered&&covered<dates.length)warnings.push(`${label}来源只在 ${covered}/${dates.length} 天有完整证明，其余日期保持空白，不按 0 计算。`);
      }
      let zeroCells=0;
      if(provenSets){
        const productIds=new Set(sourceRawRows.map(row=>row.productId));
        for(const date of dates)for(const listed of Object.values(provenSets.get(date)||{}))for(const productId of productIds)if(!listed.has(productId))zeroCells++;
      }
      if(zeroCells)warnings.push(`已证明完整的官方报表中 ${zeroCells} 个商品日没有该来源记录，这些日期按 0 累计。`);
      const missingCreated=rows.filter(row=>!row.createdAt).length;
      if(missingCreated)warnings.push(`${missingCreated} 个商品未取得明确创建时间，创建时间列保持 —，创建时间筛选不会包含这些商品。`);
    }
    if(uncovered.length)summary.notes.push(`所选范围有 ${uncovered.length} 天尚未同步，合计只包含已同步的 ${byDate.size} 天，缺失日期不按 0 计算。`);
    if(scope==='visible-page'){
      summary.notes.push('当前仅展示最新一次当前页面快照，不拼接其他页或历史快照；指标数值只代表表中已保存行，不提供全店或整段总计。');
      summary.coverage.visibleRows=latest?.rows.length||0;
    }
    const history=index.snapshots.filter(item=>item.mode===kind).slice().reverse().map(item=>({...item,status:'completed',finishedAt:item.capturedAt,message:item.scope==='visible-page'?`已保存当前页面 ${item.rowCount} 行（部分数据）`:`完整保存 ${item.rowCount} 条经营数据`}));
    const newest=index.snapshots.filter(item=>item.mode===kind).at(-1);
    const sync=observedSync||{status:newest?'completed':'idle',mode:kind,message:newest?(newest.scope==='visible-page'?'展示已保存的当前页面快照（部分数据）':'展示已完整保存的经营数据'):'尚未保存经营页面快照',...(newest?{start:newest.start,end:newest.end,finishedAt:newest.capturedAt,snapshotId:newest.id}:{})};
    const sourceRecords=snapshots.flatMap(snapshot=>snapshot.sourceCoverage.map(source=>({snapshotId:snapshot.id,capturedAt:snapshot.capturedAt,...source})));
    const adDetails=[],financeDetails=[];
    if(p.includeSourceDetails===true){
      const selected=new Map(),rowKeys=new Set(rawRows.map(row=>`${row.date}:${row.productId||''}`));
      for(const snapshot of snapshots)for(const date of snapshot.coverage.dates){
        if(date<range.start||date>range.end)continue;
        if(!snapshot.sourceCoverage.length)selected.delete(date);
        else if(snapshot.sourceCoverage.some(source=>source.key==='promotion'&&source.status==='completed'))selected.set(date,snapshot);
      }
      for(const [date,snapshot]of selected)for(const row of snapshot.adSources?.rows||[]){
        if(row.date===date&&rowKeys.has(`${date}:${row.productId||''}`))adDetails.push({...row,snapshotId:snapshot.id,capturedAt:snapshot.capturedAt});
      }
      const financial=new Map(),keys=['billing','marketing','refund'];
      for(const snapshot of snapshots)for(const date of snapshot.coverage.dates){
        if(date<range.start||date>range.end)continue;
        if(!snapshot.sourceCoverage.length){for(const key of keys)financial.delete(`${key}:${date}`);}
        else for(const source of snapshot.financeSources||[])financial.set(`${source.key}:${date}`,snapshot);
      }
      for(const snapshot of new Set(financial.values()))for(const source of snapshot.financeSources||[]){
        const selectedDates=dates.filter(date=>financial.get(`${source.key}:${date}`)===snapshot);
        if(!selectedDates.length)continue;
        for(const row of financeExportRows([source])){
          if(row.date&&!selectedDates.includes(row.date))continue;
          if(row.productId&&!rowKeys.has(`${row.date}:${row.productId}`))continue;
          financeDetails.push({...row,snapshotId:snapshot.id,capturedAt:snapshot.capturedAt});
        }
      }
    }
    const aggregation={kind:kind==='product'?'product-range':'daily',...range,countSemantics:'daily-sum-not-deduplicated',recordSemantics:'saved-daily-records',complete};
    if(kind==='daily')summary.notes.push('自定义利润与报销费用按实际录入值合计，未填写或已剔除的日期不按0计算；每笔录入和剔除均保留原因。');
    const capabilityBase=reader.capabilities?.[kind]||null;
    // 需求4：同步弹窗里的“推广渠道”来源（数据来自推广后台的推广中单元）。
    const capabilities=kind==='product'&&capabilityBase?{...capabilityBase,sources:[...Array.isArray(capabilityBase.sources)?capabilityBase.sources:[],{id:'channels',label:'推广渠道',sync:true,verified:true,message:'读取万相台无界版四个渠道（全站商品/关键词/全站全店/全站费比）的“推广中”单元，按商品ID显示渠道编号；全部暂停或没有推广时为空白'}]}:capabilityBase;
    return {storeId,...queryOptions,scope,rows,total:rows.length,rawRowCount:rawRows.length,counts,aggregation,summary,history,sync,capabilities,lastUpdated:latest?.capturedAt||null,source:latest?.source||index.source||null,sourceCoverage:latest?.sourceCoverage||[],sourceRecords,...(p.includeSourceDetails===true?{adDetails,financeDetails,rawRows,manualDetails:kind==='daily'?manualData.history:[]}:{}),reportNotes:REPORT_SCHEMA.notes(kind),warnings,snapshotId:scope==='visible-page'?latest?.id||null:null};
  }
  // 多店铺日报（需求：全部店铺 / 勾选多家店铺合并统计）。只合并“日报”，
  // 精细化仍按当前店铺显示；同步、扣费设置等写操作也仍按当前店铺进行。
  async function resolveStoreScope(value){
    if(value===undefined||value===null||value==='')return null;
    if(!Array.isArray(value)||value.length>64)throw new Error('多店铺选择无效');
    const ids=[];
    for(const raw of value){
      if(raw==='*'){for(const store of await ctx.listStores())ids.push(store.id);continue;}
      ids.push(identifier(raw));
    }
    const known=[];
    for(const id of [...new Set(ids)]){
      try{const store=checkedStore(id);if(known.every(item=>item!==store.id))known.push(store.id);}catch{}
    }
    return known.length?known:null;
  }
  async function queryAcrossStores(storeId,p,storeIds){
    const activeId=identifier(storeId),ordered=[...new Set(storeIds)];
    const activeIndex=ordered.indexOf(activeId);
    if(activeIndex>0){ordered.splice(activeIndex,1);ordered.unshift(activeId);}
    const results=[];
    for(const id of ordered){
      const store=checkedStore(id),result=await queryOne(id,p);
      // 当前页面单次快照本来就是部分数据，不参与跨店合并。
      if(result.scope==='visible-page')return queryOne(activeId,p);
      results.push({storeId:id,name:store.name,result});
    }
    const queryOptions=normalizeBusinessQuery(p,now()),merged=mergeDailyQueries(results,{queryOptions});
    const base=results[0].result,lastUpdated=results.map(item=>item.result.lastUpdated).filter(Boolean).sort().at(-1)||null;
    const allStoreIds=(()=>{try{return ctx.listStores().map(store=>store.id);}catch{return ordered;}})();
    const result={...base,rows:merged.rows,total:merged.rows.length,rawRowCount:merged.rawRowCount,counts:merged.counts,summary:merged.summary,
      history:merged.history,warnings:merged.warnings,lastUpdated,snapshotId:null,
      aggregation:{...base.aggregation,stores:results.map(item=>item.name),storeScope:ordered.length>=allStoreIds.length?'all':'custom'},
      storeIds:ordered,storeNames:results.map(item=>item.name),storeScopeLabel:ordered.length>=allStoreIds.length?'all':'custom'};
    if(p.includeSourceDetails===true){
      result.rawRows=results.flatMap(item=>item.result.rawRows||[]);
      result.adDetails=results.flatMap(item=>item.result.adDetails||[]);
      result.financeDetails=results.flatMap(item=>item.result.financeDetails||[]);
      result.manualDetails=results.flatMap(item=>(item.result.manualDetails||[]).map(entry=>({...entry,storeId:item.storeId,storeName:item.name})));
    }
    return result;
  }
  async function query(storeId,p={}){
    const storeIds=await resolveStoreScope(p.storeIds);
    if(!storeIds||storeIds.length<=1||p.scope==='visible-page')return queryOne(storeId,p);
    if(p.mode!==undefined&&mode(p.mode)!=='daily')throw new Error('多店铺合并只支持店铺日报，精细化请切换回单个店铺');
    return queryAcrossStores(storeId,p,storeIds);
  }
  async function load(storeId,p={}){
    const result=await query(storeId,p),pageSize=pageNumber(p.pageSize,50,500),requestedPage=pageNumber(p.page,1,1000000),page=Math.min(requestedPage,Math.max(1,Math.ceil(result.total/pageSize)));
    return {...result,page,pageSize,rows:result.rows.slice((page-1)*pageSize,page*pageSize)};
  }
  async function synchronize(storeId,p){
    const kind=mode(p.mode),range=validateRange(p,now()),pageSize=pageNumber(p.pageSize,50,500),sources=syncSources(p.sources);
    if(jobs.has(jobKey(storeId,kind)))throw new Error(`当前店铺的${kind==='daily'?'日报':'精细化'}已有同步任务，请等待完成或取消后重试`);
    validationHints.delete(storeId);
    const job={id:randomUUID(),storeId,mode:kind,...range,sources,abort:new AbortController(),phase:'running',startedAt:new Date(now()).toISOString(),message:'正在准备经营数据同步',promise:null};
    jobs.set(jobKey(storeId,kind),job);
    job.promise=Promise.resolve().then(async()=>{
      try{
        checkSignal(job.abort.signal);ensureActive(storeId);emit(job,'正在准备当前店铺与所选日期的经营数据同步…');
        // 需求4：推广渠道（万相台“推广中”单元，按商品ID聚合 1/2/3/4）与其它来源并行读取，
        // 单独保存快照；失败时整批不保存。
        let channelsSaved=null;
        const channelsWork=(kind==='product'&&sources.includes('channels'))?(async()=>{
          channelsSaved=await runWithValidationPause({
            execute:async()=>{
              // 需求3：先登录预热（对齐亿满分“先登录、再隐藏、后读取”），读取过程中就不会撞到登录页。
              emit(job,'正在先登录：核对推广渠道的登录状态…',{sourceId:'channels',sources:[{id:'channels',status:'running',message:'正在先登录：确认推广页登录状态'}]});
              const warmed=await loginWarmup.ensure(storeId,'promotion','business-channels',{signal:job.abort.signal,label:'推广渠道'});
              checkSignal(job.abort.signal);ensureActive(storeId);
              if(warmed.status==='verification-required'){const error=new FullSyncError('USER_VALIDATION_REQUIRED','推广渠道页面要求安全验证：已把页面显示出来，请完成滑块/验证后会自动继续');error.sourceId='channels';error.reveal=warmed.reveal||{kind:'promotion',purpose:'business-channels'};throw error;}
              if(warmed.status==='login-required'){const error=new FullSyncError('LOGIN_EXPIRED',warmed.message||'推广渠道需要登录：请先在工作台里完成该店铺登录后再同步');error.sourceId='channels';throw error;}
              if(job.phase==='running')emit(job,'正在读取推广渠道（万相台推广中单元）…',{sourceId:'channels',sources:[{id:'channels',status:'running',message:'正在读取全站商品/关键词/全站全店/全站费比'}]});
              return channels().read({storeId,signal:job.abort.signal,onProgress:detail=>{checkSignal(job.abort.signal);ensureActive(storeId);if(job.phase==='running')emit(job,detail?.message||'正在读取推广渠道',{sourceId:'channels',current:detail?.current,total:detail?.total});}});
            },
            pageContext:error=>{const target=error?.reveal||{kind:'promotion',purpose:'business-channels'};if(typeof ctx.browser?.syncPageContext!=='function')return null;try{return ctx.browser.syncPageContext(storeId,target.kind,target.purpose?{purpose:target.purpose}:{});}catch{return null;}},
            takeHint:()=>validationHints.delete(storeId),
            timeoutMs:VALIDATION_GATE_WAIT_MS,intervalMs:VALIDATION_GATE_POLL_MS,
            signal:job.abort.signal,
            emit:event=>{if(job.phase==='running')emit(job,event?.message||'正在等待滑动验证',{sourceId:'channels',...event});},
          });
          checkSignal(job.abort.signal);ensureActive(storeId);
          const products=Object.keys(channelsSaved?.byProduct||{}).length;
          emit(job,`推广渠道已更新：${products} 个商品有推广中渠道`,{sourceId:'channels',current:products,total:products,sources:[{id:'channels',status:'completed',current:products,total:products,message:'按商品ID聚合的推广中渠道（1=全站商品；2=关键词；3=全站全店；4=全站费比）'}]});
        })():Promise.resolve();
        // 渠道失败在最终 await 时抛出；先挂一个消费器，避免出现未处理的 Promise 拒绝。
        channelsWork.catch(()=>{});
        // 整店同步先读商品资料（天猫“商品管理”全店清单：商品ID、标题、状态、创建时间），
        // 读完再同步生意参谋等按日期的来源，精细化里的商品行就能补上创建时间与状态。
        let catalogSaved=null;
        // 需求（本轮）：商品资料被平台限流/列表打不开时不再拖垮整批——保留断点、先用上次的清单
        // 继续同步其它来源，最后在结果里明确提示“商品资料本次未更新”。
        let catalogFailure='';
        if(kind==='product'&&sources.includes('seller')){
          emit(job,'正在先同步商品资料：读取天猫商家中心“商品管理”的全部商品…',{sourceId:'seller',sources:[{id:'seller',status:'running',message:'正在读取商品ID、创建时间与状态'}]});
          const progress=detail=>{checkSignal(job.abort.signal);ensureActive(storeId);if(job.phase==='running')emit(job,typeof detail==='string'?detail:detail?.message||'正在读取商品资料',typeof detail==='object'&&detail?{...detail,sourceId:'seller'}:{sourceId:'seller'});};
          // 需求2：商品资料遇到滑动验证时暂停等待——把正在读取的“商品管理”页面弹出来，
          // 完成后自动从断点（catalog-progress.json）继续；超时保留断点停下。
          const catalog=await runWithValidationPause({
            execute:async()=>{
              // 需求3：先登录预热（先登录、再隐藏、后读取），避免商品资料读取卡在登录页上。
              emit(job,'正在先登录：核对商品资料页面的登录状态…',{sourceId:'seller',sources:[{id:'seller',status:'running',message:'正在先登录：确认千牛商品页面登录状态'}]});
              const warmed=await loginWarmup.ensure(storeId,'seller','business-catalog',{signal:job.abort.signal,label:'商品资料'});
              checkSignal(job.abort.signal);ensureActive(storeId);
              if(warmed.status==='verification-required'){const error=new FullSyncError('USER_VALIDATION_REQUIRED','商品资料页面要求安全验证：已把页面显示出来，请完成滑块/验证后会自动继续');error.sourceId='seller';error.reveal=warmed.reveal||{kind:'seller',purpose:'business-catalog'};throw error;}
              if(warmed.status==='login-required'){const error=new FullSyncError('LOGIN_EXPIRED',warmed.message||'商品资料需要登录：请先在工作台里完成该店铺登录后再同步');error.sourceId='seller';throw error;}
              try{return await catalogReader.read({storeId,signal:job.abort.signal,onProgress:progress});}
              catch(error){
                // 2026-10-17 用户实测：列表接口只是超时/被限流（页面还是正常的千牛首页），
                // 自动把“商品管理”页弹成独立窗口会在前台一直挂着，用户不知道要做什么。
                // 现在只有页面**确实停在滑块/验证页**时才转为“暂停等待验证”，由用户点「去滑块」再弹出；
                // 普通超时/限流只记录失败原因（保留断点），不弹窗。
                if(['CATALOG_PAGE_TIMEOUT','CATALOG_RATE_LIMITED','CATALOG_NAVIGATION_FAILED'].includes(error?.code)&&await catalogPageHasVerification(storeId)){
                  const next=new FullSyncError('USER_VALIDATION_REQUIRED','商品资料页面要求安全验证：请点击「去滑块」完成验证后会自动继续');
                  next.sourceId='seller';
                  next.reveal={kind:'seller',purpose:'business-catalog'};
                  throw next;
                }
                throw error;
              }
            },
            pageContext:error=>{const target=error?.reveal||{kind:'seller',purpose:'business-catalog'};if(typeof ctx.browser?.syncPageContext!=='function')return null;try{return ctx.browser.syncPageContext(storeId,target.kind,target.purpose?{purpose:target.purpose}:{});}catch{return null;}},
            takeHint:()=>validationHints.delete(storeId),
            timeoutMs:VALIDATION_GATE_WAIT_MS,intervalMs:VALIDATION_GATE_POLL_MS,
            signal:job.abort.signal,
            emit:event=>{if(job.phase==='running')emit(job,event?.message||'正在等待滑动验证',{sourceId:'seller',...event});},
          }).catch(error=>{
            if(['CATALOG_RATE_LIMITED','CATALOG_PAGE_TIMEOUT','CATALOG_NAVIGATION_FAILED'].includes(error?.code)){catalogFailure=safeMessage(error);return null;}
            throw error;
          });
          // 取消/停止之后不再写入商品资料：读取可能因平台页面卡住而晚一点才返回。
          checkSignal(job.abort.signal);ensureActive(storeId);
          if(catalog){
            catalogSaved=await catalogStore.save(catalog);
            emit(job,`商品资料已更新：${catalogSaved.items.length} 个商品（含创建时间与状态）`,{sourceId:'seller',current:catalogSaved.items.length,total:catalogSaved.items.length,sources:[{id:'seller',status:'completed',current:catalogSaved.items.length,total:catalogSaved.items.length,message:`${catalogSaved.items.length} 个商品，已保存商品ID、标题、状态与创建时间`}]});
          }else{
            emit(job,`商品资料本次未更新（${catalogFailure}）。已保留断点，先用上次保存的商品清单继续同步其它来源…`,{sourceId:'seller',sources:[{id:'seller',status:'failed',message:catalogFailure}]});
          }
        }
        const dateSources=sources.filter(id=>id!=='seller'&&id!=='channels');
        if(!dateSources.length){
          // 只勾选商品资料/推广渠道时：保存清单与渠道快照即完成，不写按日期的快照。
          await channelsWork;
          // 只有商品资料被限流又没有日期来源：如实报失败（保留断点），不能报成功。
          if(catalogFailure&&!catalogSaved){const error=new Error(`商品资料本次未更新（${catalogFailure}）；已保留断点，稍后重试会从断点继续`);error.code='CATALOG_FAILED';throw error;}
          job.phase='completed';job.finishedAt=new Date(now()).toISOString();
          const parts=[catalogSaved?`商品资料 ${catalogSaved.items.length} 个商品`:null,channelsSaved?`推广渠道 ${Object.keys(channelsSaved.byProduct||{}).length} 个商品有推广中渠道`:null].filter(Boolean);
          emit(job,parts.length?`已更新：${parts.join('；')}`:'没有需要同步的日期来源',{done:true});
          lastSync.set(syncKey(storeId,kind),jobStatus(job));
          return load(storeId,{mode:kind,...range,page:1,pageSize});
        }
        let raw;
        try{[raw]=await Promise.all([reader.run({storeId,mode:kind,...range,sources:dateSources,signal:job.abort.signal,takeValidationHint:()=>validationHints.delete(storeId),onProgress:progress=>{
          if(!job.abort.signal.aborted&&job.phase==='running')emit(job,typeof progress==='string'?progress:progress?.message||'正在同步经营数据',typeof progress==='object'&&progress?progress:{});
        }}),channelsWork]);}
        catch(error){if(!job.abort.signal.aborted)job.internalAbort=true;job.abort.abort();throw error;}
        checkSignal(job.abort.signal);ensureActive(storeId);
        if(catalogSaved){
          // 商品资料是整店清单，不属于按日期的快照指标；只记录它已经单独保存过。
          const note=`商品资料已单独保存 ${catalogSaved.items.length} 个商品（商品ID、标题、状态、创建时间）；不写入按日期快照`;
          const list=Array.isArray(raw.sourceCoverage)?raw.sourceCoverage:[];
          raw.sourceCoverage=list.some(entry=>entry&&entry.key==='seller')
            ?list.map(entry=>entry&&entry.key==='seller'?{...entry,status:'not-selected',metrics:[],message:note}:entry)
            :[...list,{key:'seller',status:'not-selected',message:note}];
        }else if(catalogFailure){
          // 商品资料被平台限流：其它来源照常保存，但在快照里明确标注商品资料本次未更新。
          const note=`商品资料本次未更新（${catalogFailure}）；页面显示的是上一次保存的商品清单，断点已保留，稍后重试会从断点继续`;
          const list=Array.isArray(raw.sourceCoverage)?raw.sourceCoverage:[];
          raw.sourceCoverage=list.some(entry=>entry&&entry.key==='seller')
            ?list.map(entry=>entry&&entry.key==='seller'?{...entry,status:'unavailable',metrics:[],message:note}:entry)
            :[...list,{key:'seller',status:'unavailable',message:note}];
          raw.warnings=[...new Set([...(Array.isArray(raw.warnings)?raw.warnings:[]),note])];
        }
        if(channelsSaved){
          const note=`推广渠道快照已单独保存（${channelsSaved.capturedAt}）：${Object.keys(channelsSaved.byProduct||{}).length} 个商品有推广中渠道；不写入按日期快照`;
          const list=Array.isArray(raw.sourceCoverage)?raw.sourceCoverage:[];
          raw.sourceCoverage=list.some(entry=>entry&&entry.key==='channels')
            ?list.map(entry=>entry&&entry.key==='channels'?{...entry,status:'not-selected',metrics:[],message:note}:entry)
            :[...list,{key:'channels',status:'not-selected',message:note}];
        }
        const snapshot=validateSnapshot({...raw,id:randomUUID(),storeId,mode:kind,...range,capturedAt:new Date(now()).toISOString()},{now:now()});
        emit(job,snapshot.coverage.scope==='visible-page'?'页面日期与可见明细已校验，正在保存独立页面快照…':'全部日期与明细已校验，正在保存完整快照…',{current:snapshot.rows.length,total:snapshot.rows.length});
        const saved=await repository.save(snapshot,{signal:job.abort.signal,onCommit:()=>{job.phase='committing';emit(job,'已核对的数据正在原子提交，完成后生效');}});
        job.snapshotId=saved.id;job.phase='completed';job.finishedAt=new Date(now()).toISOString();emit(job,saved.coverage.scope==='visible-page'?`已保存当前页面 ${saved.rows.length} 行；这是部分数据，未自动翻页`:`已完整保存 ${saved.coverage.dates.length} 天、${saved.rows.length} 条经营数据`,{current:saved.rows.length,total:saved.rows.length,done:true});
        lastSync.set(syncKey(storeId,kind),jobStatus(job));
        return load(storeId,{mode:kind,...range,page:1,pageSize});
      }catch(error){
        const canceled=job.abort.signal.aborted&&!job.internalAbort;
        if(!job.abort.signal.aborted)job.abort.abort();
        job.phase=canceled&&job.phase!=='committing'?'canceled':'failed';job.finishedAt=new Date(now()).toISOString();
        if(error?.diagnosis&&typeof error.diagnosis==='object'&&!Array.isArray(error.diagnosis))job.diagnosis={...error.diagnosis};
        // A failed batch must never look like a zero or partial success: name
        // the reason, state that nothing was committed and that earlier saved
        // data is still what the page shows.
        const reason=safeMessage(error).replace(/[。；;]\s*$/,'');
        emit(job,job.phase==='canceled'?'同步已取消，原已保存数据保持不变':`${reason}。本批未保存任何来源，原先已保存的数据仍可查询。`,{done:true});lastSync.set(syncKey(storeId,kind),jobStatus(job));
        const safe=new Error(job.message);safe.code=job.phase==='canceled'?'BUSINESS_CANCELED':'BUSINESS_SYNC_FAILED';throw safe;
      }finally{
        if(job.cancelTimer){clearTimeout(job.cancelTimer);job.cancelTimer=null;}
        validationHints.delete(storeId);
        // 需求（本轮）：同步结束（成功/失败/取消）后把这次用到的同步页收回去——
        // “去滑块”弹出的独立窗口不会留在屏幕上，页面回到后台隐藏状态继续/等待下次同步。
        for(const id of [...new Set([...sources,...(kind==='product'?['seller','channels']:[])])]){
          const page=syncPageFor(id,kind);
          if(!page?.purpose)continue;
          try{ctx.browser?.hideSyncPage?.(storeId,page.kind,page.purpose);}catch{}
        }
        // 上次同步结果落盘：面板上的每店铺“成功/失败/取消”在重启后仍然看得到。
        await recordSyncStatus(storeId,kind,job);
        if(jobs.get(jobKey(storeId,kind))===job)jobs.delete(jobKey(storeId,kind));
      }
    });
    return job.promise;
  }
  function cancel(storeId,mode){
    // 需求5（本轮）：按页签取消；不传页签时取消这家店的全部任务（兼容旧调用/移除店铺）。
    const kinds=mode?[mode]:['daily','product'];
    const picked=kinds.map(kind=>jobs.get(jobKey(storeId,kind))).filter(Boolean);
    if(!picked.length)return {canceled:false,message:'当前没有经营数据同步任务'};
    const cancelable=picked.filter(job=>job.phase!=='committing'&&job.phase!=='completed');
    if(!cancelable.length)return {canceled:false,tooLate:true,message:'已保存数据进入原子提交阶段，本次提交会正常完成'};
    for(const job of cancelable){
      job.abort.abort();job.message='已请求取消，等待当前读取停止';
      // 兜底：个别平台调用（页面脚本/页面跳转）可能长时间不返回。取消后若在 cancelGraceMs
      // 内仍未结束，就直接结束这次同步（不写入任何数据），把界面和“再次同步”释放出来。
      if(typeof setTimeout==='function'&&!job.cancelTimer){
        job.cancelTimer=setTimeout(()=>{
          if(jobs.get(jobKey(storeId,job.mode))!==job||job.phase==='committing'||job.phase==='completed')return;
          job.phase='canceled';job.finishedAt=new Date(now()).toISOString();
          emit(job,'同步已取消，原已保存数据保持不变',{done:true});
          lastSync.set(syncKey(storeId,job.mode),jobStatus(job));
          jobs.delete(jobKey(storeId,job.mode));
        },cancelGraceMs);
        job.cancelTimer.unref?.();
      }
    }
    return {canceled:true,message:'已请求取消，等待当前读取停止'};
  }
  async function exportData(storeId,p){
    const result=await query(storeId,{...p,includeSourceDetails:true});
    if(!result.rows.length)throw new Error('所选日期与筛选条件下没有可导出的经营数据');
    const title=result.mode==='daily'?'店铺日报':'精细化';
    // 合并视图（多店铺日报）的文件名前缀不再用单个店铺名，避免把合并结果当成某一家店的数据。
    const scopeNames=Array.isArray(result.storeNames)&&result.storeNames.length>1?result.storeNames:null;
    const label=scopeNames?(result.storeScopeLabel==='all'?'全部店铺':`多店铺${scopeNames.length}家`):checkedStore(storeId).name;
    const columns=REPORT_SCHEMA.exportColumns(result.mode);
    const numericColumn=column=>['money','number','percent','decimal'].includes(column.type);
    if(result.mode==='product'){
      // 精细化导出：文件名前缀默认用店铺名称；只保留“精细化”一张表。
      // 商品资料里没有经营数据的商品也要导出，缺失的数值指标写 0；
      // 上架时间只保留日期，另加“商品状态”和“上架天数”两列（按导出当天现算）。
      const catalog=await catalogStore.load(storeId).catch(()=>null);
      const withZeros=row=>{const copy={...row};for(const column of columns)if(numericColumn(column)&&(copy[column.key]===null||copy[column.key]===undefined))copy[column.key]=0;return copy;};
      const dateOnly=value=>value?String(value).slice(0,10):'';
      const rows=result.rows.map(row=>withZeros({...row,createdAt:dateOnly(row.createdAt),listedDays:row.listedDays??null}));
      const seen=new Set(rows.map(row=>String(row.productId)));
      if(catalog)for(const item of catalog.items){
        const productId=String(item.itemId||'');
        if(!productId||seen.has(productId))continue;
        seen.add(productId);
        rows.push(withZeros({productId,title:item.title||'',itemStatus:item.itemStatus||'',storeName:label,
          createdAt:dateOnly(item.createdAt),listedDays:listedDaysOf(item.createdAt,now()),category:'',categoryId:''}));
      }
      rows.push(reportTotalRow(result.summary,result.mode));
      return ctx.files.exportWorkbook(`${label}_${title}_${result.start}_${result.end}.xlsx`,[{name:title,rows,columns}]);
    }
    const official=result.counts?.official||[],sycmOfficial=official.find(item=>item.key==='sycm');
    const metadata=[{storeName:label,storeList:(scopeNames||[]).join('、'),platformShopId:result.source?.platformShopId||'',sourceShopName:result.source?.shopName||'',identityType:result.source?.identityType==='visible-name'?'仅按页面可见名称核对，未取得平台ID':'平台店铺ID',scope:result.scope==='visible-page'?'当前页面单次快照（部分数据）':'已保存完整批次',snapshotId:result.snapshotId||'',mode:title,start:result.start,end:result.end,query:result.query,title:result.title,productIds:result.productIds.join('\n'),category:result.category,itemStatus:result.itemStatus,creationStart:result.creationStart||'',creationEnd:result.creationEnd||'',categoryId:result.categoryId,sort:`${result.sortBy} ${result.sortDirection}`,rowCount:result.total,localProductCount:result.counts?.local?.products??null,matchedProductCount:result.counts?.matched?.products??null,officialReportRows:official.reduce((sum,item)=>sum+item.totalRows,0),officialSycmUniqueProducts:sycmOfficial?sycmOfficial.uniqueProducts:null,officialSources:official.map(item=>`${item.label} ${item.days}天 ${item.totalRows}条/去重${item.uniqueProducts}个`).join('；'),exportedAt:new Date(now()).toISOString(),notes:[...result.reportNotes,...result.warnings,...result.summary.notes].join('\n')}];
    // 日报主导出：空值保持空白，原始指标页与合计行保持原值。
    const displayRows=result.rows;
    const rawColumns=[...COLUMNS.filter(column=>!['productId','title','category'].includes(column.key)),{key:'siteAdSpend',label:'全站花费'}];
    const sourceRows=result.sourceRecords.map(source=>({...source,metrics:source.metrics.join('、')}));
    const manualRows=(result.manualDetails||[]).map(item=>({...item,action:item.action==='save'?'录入/修改':'剔除',amount:item.amountCents===null?null:item.amountCents/100}));
    return ctx.files.exportWorkbook(`${label}_${title}_${result.start}_${result.end}.xlsx`,[
      {name:title,rows:[...displayRows,reportTotalRow(result.summary,result.mode)],columns},
      {name:'统计说明',rows:metadata,columns:[{key:'storeName',label:'本机店铺名称'},{key:'storeList',label:'合并店铺清单'},{key:'platformShopId',label:'来源店铺ID'},{key:'sourceShopName',label:'来源店铺名称'},{key:'identityType',label:'身份核对依据'},{key:'scope',label:'数据覆盖范围'},{key:'snapshotId',label:'页面快照ID'},{key:'mode',label:'数据类型'},{key:'start',label:'开始日期'},{key:'end',label:'结束日期'},{key:'query',label:'快捷搜索'},{key:'title',label:'商品标题筛选'},{key:'productIds',label:'商品ID筛选'},{key:'category',label:'类目筛选'},{key:'itemStatus',label:'商品状态筛选'},{key:'creationStart',label:'商品创建开始日期'},{key:'creationEnd',label:'商品创建结束日期'},{key:'categoryId',label:'类目ID筛选'},{key:'sort',label:'排序'},{key:'rowCount',label:'导出行数'},{key:'localProductCount',label:'本机经营商品数'},{key:'matchedProductCount',label:'筛选后商品数'},{key:'officialReportRows',label:'官方报表总条数'},{key:'officialSycmUniqueProducts',label:'官方商品去重数'},{key:'officialSources',label:'官方来源汇总'},{key:'exportedAt',label:'导出时间'},{key:'notes',label:'口径与缺失说明'}]},
      {name:'官方原始指标',rows:result.rawRows,columns:rawColumns},
      {name:'广告来源明细',rows:result.adDetails,columns:[{key:'date',label:'日期'},{key:'productId',label:'商品ID'},{key:'sourceKind',label:'广告原报表'},{key:'adSpend',label:'来源花费'},{key:'adRevenue',label:'来源成交额'},{key:'adRoi',label:'来源官方ROI'},{key:'snapshotId',label:'批次ID'},{key:'capturedAt',label:'采集时间'}]},
      {name:'手工调整记录',rows:manualRows,columns:[{key:'date',label:'日期'},{key:'field',label:'字段'},{key:'action',label:'操作'},{key:'amount',label:'金额（元）'},{key:'reason',label:'原因'},{key:'at',label:'操作时间'}]},
      {name:'账单与退款来源',rows:result.financeDetails,columns:[...FINANCE_EXPORT_COLUMNS,{key:'snapshotId',label:'批次ID'},{key:'capturedAt',label:'采集时间'}]},
      {name:'来源记录',rows:sourceRows,columns:[{key:'snapshotId',label:'批次ID'},{key:'capturedAt',label:'采集时间'},{key:'key',label:'来源'},{key:'status',label:'来源状态'},{key:'start',label:'开始日期'},{key:'end',label:'结束日期'},{key:'metrics',label:'来源指标'},{key:'message',label:'说明'}]},
      {name:'来源与分页证明',rows:official.flatMap(item=>item.perDate.map(day=>({source:item.label,key:item.key,date:day.date,totalRows:day.totalRows,uniqueProducts:day.uniqueProducts,pages:day.pages,totalPages:day.totalPages}))),columns:[{key:'source',label:'来源'},{key:'key',label:'来源键'},{key:'date',label:'日期'},{key:'totalRows',label:'报表总条数'},{key:'uniqueProducts',label:'唯一商品ID数'},{key:'pages',label:'已完成页'},{key:'totalPages',label:'总页数'}]},
      {name:'商品数据完整度',rows:[],columns:[{key:'productId',label:'商品ID'},{key:'title',label:'商品标题'},{key:'recordDays',label:'已保存日记录数'},{key:'dataCoverage',label:'来源完整度'},{key:'createdAt',label:'上架时间'},{key:'listedDays',label:'上架天数'},{key:'createdAtSource',label:'上架时间来源'},{key:'createdAtReason',label:'上架时间缺失原因'}]},
    ]);
  }
  async function handle(action,p={}){
    const store=checkedStore(p.storeId),storeId=store.id;
    if(action==='cancel')return cancel(storeId,p.mode);
    ensureActive(storeId);
    // 数据同步面板：一次拿到多店铺 × 两页签的“上次结果 + 正在进行的任务”。
    if(action==='syncResults'){
      const ids=(Array.isArray(p.storeIds)?p.storeIds:[]).filter(id=>typeof id==='string'&&id);
      const results={};
      for(const id of ids){
        let entry={daily:null,product:null,running:[]},stored=null;
        try{ctx.getStore(id);stored=await ctx.readJson(statusPath(id),null);}catch{continue;}
        for(const mode of ['daily','product']){
          const job=jobs.get(jobKey(id,mode));
          if(job)entry.running.push({mode,status:job.phase,message:job.message||'',current:job.current,total:job.total,start:job.start,end:job.end});
          const last=lastSync.get(syncKey(id,mode)),persisted=stored&&typeof stored==='object'&&stored[mode]&&typeof stored[mode]==='object'?stored[mode]:null;
          const chosen=last||persisted;
          if(chosen)entry[mode]={status:chosen.status,message:String(chosen.message||'').slice(0,600),finishedAt:chosen.finishedAt||chosen.at||null};
        }
        results[id]=entry;
      }
      return {results};
    }
    if(action==='validationRetry'){validationHints.add(storeId);return {requested:true,message:'已请求立即继续：如果平台仍要求验证，会继续等待。'};}
    if(action==='revealSync'){
      const page=syncPageFor(p.sourceId,p.mode);
      if(!page||typeof ctx.browser?.focusSyncPage!=='function')return {tabId:'',message:'没有可显示的同步页面。'};
      return ctx.browser.focusSyncPage(storeId,page.kind,page.purpose);
    }
    // 已滑块/验证结束后把显示出来的同步页面收回去（参考亿满分：同步走隐藏窗口）。
    if(action==='hideSyncPage'){
      const page=syncPageFor(p.sourceId,p.mode);
      if(!page||typeof ctx.browser?.hideSyncPage!=='function')return {hidden:false,message:'没有可收起的同步页面。'};
      return ctx.browser.hideSyncPage(storeId,page.kind,page.purpose);
    }
    if(action==='feesLoad')return fees.load(storeId);
    if(action==='feesSave')return fees.save(storeId,p.rates);
    if(action==='manualSave'||action==='manualExclude'){
      const date=validateRange({start:p.date,end:p.date},now()).start,existing=await query(storeId,{mode:'daily',start:date,end:date});
      if(existing.scope!=='full'||existing.summary.coverage?.complete!==true||!existing.rows.some(row=>row.date===date))throw new Error('请先同步该日期的完整店铺日报，再录入或剔除手工金额');
      return action==='manualSave'?manual.save(storeId,{...p,date}):manual.exclude(storeId,{...p,date});
    }
    if(action==='load')return load(storeId,p);
    if(action==='sync')return synchronize(storeId,p);
    if(action==='catalogLoad')return catalogStore.load(storeId);
    // 需求9：点击某个指标看“每日趋势”。只读本机已保存的数据，不访问平台。
    if(action==='trend'){
      const key=String(p.key||''),kind=p.mode==='daily'?'daily':'product';
      const column=REPORT_SCHEMA.DEFINITIONS.find(item=>item.key===key);
      if(!column)throw new Error('趋势指标无效');
      const result=await query(storeId,{mode:kind,start:p.start,end:p.end,productIds:p.productId?[String(p.productId)]:[],includeSourceDetails:true});
      const rawRows=Array.isArray(result.rawRows)?result.rawRows:[];
      // 派生指标（减操作单、付转化率、客单价、推广占比、全店销售ROI）在原始行里没有存储，
      // 这里按同一套公式逐日算出来，保证点这些列也能看到趋势。
      const valueOf=row=>{
        if(typeof row[key]==='number')return row[key];
        const num=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
        const buyers=num(row.buyers),orders=num(row.operationOrders),principal=num(row.operationPrincipal),visitors=num(row.visitors),pay=num(row.payAmount),ad=num(row.adSpend);
        const adjustedBuyers=buyers===null?null:buyers-(orders??0),adjustedPay=pay===null?null:Number((pay-(principal??0)).toFixed(2));
        if(key==='adjustedBuyers')return adjustedBuyers;
        if(key==='adjustedPayAmount')return adjustedPay;
        if(key==='adjustedConversionRate')return adjustedBuyers!==null&&visitors>0?Number((adjustedBuyers/visitors*100).toFixed(6)):null;
        if(key==='conversionRate')return buyers!==null&&visitors>0?Number((buyers/visitors*100).toFixed(6)):null;
        if(key==='unitPrice')return pay!==null&&buyers>0?Number((pay/buyers).toFixed(6)):null;
        if(key==='shopSalesRoi')return pay!==null&&ad>0?Number((pay/ad).toFixed(6)):null;
        if(key==='promotionShare')return ad!==null&&pay>0?Number((ad/pay*100).toFixed(6)):null;
        return null;
      };
      const points=rawRows.map(row=>({date:row.date,value:valueOf(row)})).sort((left,right)=>String(left.date).localeCompare(String(right.date)));
      const known=points.filter(item=>item.value!==null);
      const sum=known.length?Number(known.reduce((total,item)=>total+item.value,0).toFixed(6)):null;
      return {key,label:column.label,type:column.type,unit:column.type==='money'?'元':column.type==='percent'?'%':'',points,sum,count:known.length,totalDays:points.length};
    }
    if(action==='uiStateLoad')return uiStateLoad(storeId);
    if(action==='uiStateSave')return uiStateSave(storeId,p.state);
    if(action==='marksLoad')return marks.load(storeId);
    if(action==='markTodo')return marks.addTodo(storeId,{productIds:p.productIds,content:p.content});
    if(action==='unmarkTodo')return marks.removeTodo(storeId,{productId:p.productId,todoId:p.todoId});
    if(action==='markBlacklist')return marks.setBlacklist(storeId,{productIds:p.productIds,remove:p.remove===true});
    if(action==='catalogSync'){
      // 商品资料来自天猫“我的商品”列表页，与按日期的经营数据分开保存。
      const result=await catalogReader.read({storeId,onProgress:detail=>ctx.emit?.({module:'business',storeId,mode:'product',status:'running',message:safeMessage(detail.message||'正在读取商品资料'),current:detail.current,total:detail.total})});
      const saved=await catalogStore.save(result);
      ctx.emit?.({module:'business',storeId,mode:'product',status:'completed',message:`商品资料已更新：共 ${saved.totalCount} 件商品`,done:true,current:saved.items.length,total:saved.items.length});
      return {storeId,totalCount:saved.totalCount,capturedAt:saved.capturedAt,statuses:saved.statuses,warnings:saved.warnings,total:saved.items.length,rows:saved.items.length};
    }
    if(action==='open')return reader.open({storeId,backend:p.backend||'sycm'});
    if(action==='export')return exportData(storeId,p);
    if(action==='detail')return repository.loadSnapshot(storeId,p.id||p.snapshotId||p.datasetId);
    throw new Error('经营数据不支持此操作');
  }
  async function cancelStore(storeId){closingStores.add(storeId);cancel(storeId);const pending=[...jobs.values()].filter(job=>job.storeId===storeId).map(job=>job.promise);if(pending.length)await Promise.allSettled(pending);await Promise.all([repository.flush(),manual.flush(storeId)]);}
  function dispose(){
    if(disposePromise)return disposePromise;disposed=true;
    disposePromise=(async()=>{for(const job of [...jobs.values()])cancel(job.storeId,job.mode);const pending=[...jobs.values()].map(job=>job.promise);let failure;try{await reader.dispose?.();}catch(error){failure=error;}try{await channelsService?.dispose?.();}catch{}await Promise.allSettled(pending);await Promise.all([repository.flush(),manual.flush()]);if(failure)throw failure;})();
    return disposePromise;
  }
  return {handle,cancelStore,dispose};
}

module.exports={createBusinessService,syncSources};
