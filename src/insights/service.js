'use strict';
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {createInsightRepository,storeDirectory} = require('./data/repository');
const {buildTrendBoard} = require('./trend-board');
const {validateDataset} = require('./domain/datasets');
const {parseRecommendations, recommendationKey} = require('./domain/recommendations');
const {buildAnalysisWorkbook, buildRecommendationTemplate, RECOMMENDATION_COLUMNS} = require('./workbooks/analysis');
const {createCollectors} = require('./collectors');
const {createImportTickets} = require('./workflow/import-tickets');
const {parseRawTrendRows, rawTrendTemplate} = require('./workflow/raw-import');

const DATA_KINDS = new Set(['business','trends','peers']);
const LABELS = {business:'经营看板',trends:'趋势关键词',peers:'同行榜单',recommendations:'月份推荐'};

/** Composition only: platform reads, persistence and workbook rules stay separate. */
function createInsightServices(ctx, options = {}) {
  const repository = options.repository || createInsightRepository(ctx);
  const collectors = options.collectors || createCollectors(ctx);
  const tickets = createImportTickets(options.ticketOptions);
  const mutations = new Map();
  const closingStores = new Set();
  let disposed = false;
  const emit = (kind,storeId,message,extra={}) => ctx.emit?.({module:kind,storeId,message,...extra});

  // 趋势选品的过滤规则与上线节奏按店铺保存在本机（只含规则文本，不含任何业务数据）。
  const trendSettingsKey=storeId=>`${storeDirectory(storeId)}/trend-filters.json`;
  async function readTrendFilters(storeId){
    const raw=await ctx.readJson(trendSettingsKey(storeId),{schemaVersion:1,storeId,brandRules:[],keywordRules:[],settings:{leadDays:60}});
    if(!raw||raw.storeId!==storeId||!Array.isArray(raw.brandRules)||!Array.isArray(raw.keywordRules))throw new Error('趋势选品过滤规则文件无效，请从备份恢复');
    return raw;
  }
  function cleanRule(rule){
    if(!rule||typeof rule!=='object')return null;
    const text=String(rule.text||'').trim().slice(0,100);
    if(!text)return null;
    return {id:String(rule.id||randomUUID()),text,match:rule.match==='exact'?'exact':'contains',enabled:rule.enabled!==false,note:String(rule.note||'').trim().slice(0,200)};
  }
  async function saveTrendFilters(storeId,input){
    const previous=await readTrendFilters(storeId).catch(()=>null);
    const brandRules=(Array.isArray(input?.brandRules)?input.brandRules:previous?.brandRules||[]).map(cleanRule).filter(Boolean).slice(0,300);
    const keywordRules=(Array.isArray(input?.keywordRules)?input.keywordRules:previous?.keywordRules||[]).map(cleanRule).filter(Boolean).slice(0,500);
    const leadRaw=Number(input?.leadDays??previous?.settings?.leadDays??60);
    const leadDays=Number.isFinite(leadRaw)?Math.min(180,Math.max(15,Math.round(leadRaw))):60;
    const next={schemaVersion:1,storeId,brandRules,keywordRules,settings:{leadDays}};
    await ctx.writeJson(trendSettingsKey(storeId),next);
    return next;
  }
  async function buildBoardFor(storeId,{leadDays}={}){
    const summaries=await repository.listDatasets(storeId,'trends');
    const selected=summaries.slice(0,300);
    const datasets=[];
    for(const summary of selected)datasets.push(await repository.loadDataset(storeId,summary.id));
    const filters=await readTrendFilters(storeId).catch(()=>({brandRules:[],keywordRules:[],settings:{leadDays:60}}));
    const effectiveLead=Number.isFinite(Number(leadDays))?Math.min(180,Math.max(15,Math.round(Number(leadDays)))):(filters.settings?.leadDays||60);
    const board=buildTrendBoard(datasets,{leadDays:effectiveLead,today:new Date(),rules:{brandRules:filters.brandRules,keywordRules:filters.keywordRules}});
    board.datasetTotal=summaries.length;
    board.datasetUsed=datasets.length;
    board.truncated=summaries.length>datasets.length;
    return {board,filters};
  }

  async function mutate(storeId, task) {
    if(closingStores.has(storeId))throw new Error('此店铺正在移除，不能开始新的保存任务。');
    if (mutations.has(storeId)) throw new Error('当前店铺正在保存或导入数据，请等待完成。');
    const running = Promise.resolve().then(task);
    mutations.set(storeId,running);
    try {return await running;} finally {if(mutations.get(storeId)===running)mutations.delete(storeId);}
  }

  async function datasetsFor(storeId,kind,ids) {
    const summaries = await repository.listDatasets(storeId,kind);
    const wanted = ids == null ? summaries.map(item=>item.id) : ids;
    if (!Array.isArray(wanted) || !wanted.length || wanted.length > 1000) throw new Error('请选择 1 至 1000 个数据批次。');
    const available = new Set(summaries.map(item=>item.id));
    const datasets = [];
    let rows = 0;
    for (const id of [...new Set(wanted)]) {
      if (!available.has(id)) throw new Error('所选批次不存在或不属于当前店铺和模块，请刷新后重试。');
      const dataset = await repository.loadDataset(storeId,id);
      rows += dataset.rows.length;
      if (rows > 100000) throw new Error('本次超过 10 万行，请减少所选批次后分批导出。');
      datasets.push(dataset);
    }
    return datasets;
  }

  async function load(kind,storeId) {
    const datasets = await repository.listDatasets(storeId,kind==='recommendations'?'trends':kind);
    const result = {datasets, recommendations:kind==='recommendations'?await repository.loadRecommendations(storeId):[]};
    if(DATA_KINDS.has(kind)&&datasets.length) result.selectedDataset=await repository.loadDataset(storeId,datasets[0].id);
    result.summary={datasetCount:datasets.length,recordCount:datasets.reduce((n,d)=>n+(d.rowCount||0),0)};
    // 趋势关键词页面需要预算好的趋势选品看板（与本机已保存批次一致；不访问平台）。
    if(kind==='trends'){
      try{
        const {board,filters}=await buildBoardFor(storeId);
        result.board=board;
        result.trendFilters=filters;
      }catch(error){
        result.boardError=error?.message||String(error);
      }
    }
    return result;
  }

  async function previewRecommendations(storeId) {
    const file = await ctx.files.pickImport();
    if(file.canceled)return file;
    const summaries=await repository.listDatasets(storeId,'trends');
    try {
      const rows=parseRecommendations(file.rows,summaries);
      const current=await repository.loadRecommendations(storeId);
      const keys=new Set(current.map(recommendationKey));
      const updated=rows.filter(row=>keys.has(recommendationKey(row))).length;
      const meta={fileName:path.basename(file.path),importedAt:new Date().toISOString()};
      const token=tickets.issue(storeId,'recommendations',{rows,meta});
      return {token,rows:rows.slice(0,100),total:rows.length,added:rows.length-updated,updated,errors:[],warnings:rows.length>100?['预览展示前100条，确认后导入本批次全部已校验记录。']:[]};
    } catch(error) {
      return {rows:[],total:file.rows.length,added:0,updated:0,errors:error.issues||[error.message],warnings:[]};
    }
  }

  async function handle(kind,action,p={}) {
    if(disposed)throw new Error('数据服务已停止，请重新启动工作台。');
    const store=ctx.getStore(p.storeId),storeId=store.id;
    if(closingStores.has(storeId))throw new Error('此店铺正在移除，请选择其他店铺。');
    if(action==='load')return load(kind,storeId);
    if(kind==='trends'&&action==='board')return buildBoardFor(storeId,{leadDays:p.leadDays});
    if(kind==='trends'&&action==='saveFilters'){
      const filters=await saveTrendFilters(storeId,p);
      const {board}=await buildBoardFor(storeId,{leadDays:p.leadDays??filters.settings?.leadDays});
      return {filters,board,message:'趋势选品规则已保存。'};
    }
    if(action==='detail'){
      const dataset=await repository.loadDataset(storeId,p.id||p.datasetId);
      if(dataset.kind!==(kind==='recommendations'?'trends':kind))throw new Error('数据批次不属于此模块。');
      return dataset;
    }
    if(action==='cancel'){collectors.cancel(storeId);return {message:'已请求停止采集。'};}
    if(action==='capture'&&DATA_KINDS.has(kind))return mutate(storeId,async()=>{
      emit(kind,storeId,'正在读取已查询后台的数据…');
      try {
        const draft=await collectors.capture(kind,{...p,storeId});
        if(disposed)throw new Error('已停止采集，未保存未完成的数据。');
        const dataset=validateDataset({...draft,id:randomUUID(),kind,storeId,storeName:draft.storeName||store.name});
        const saved=await repository.saveDataset(dataset);
        emit(kind,storeId,`已保存 ${dataset.rows.length} 条记录`,{done:true,status:'completed'});
        return {...await load(kind,storeId),selectedDataset:saved,message:'当前页面数据已保存到本机。'};
      } catch(error){emit(kind,storeId,error.message,{done:true,status:'failed'});throw error;}
    });
    if(action==='export'){
      if(kind==='recommendations'){
        const rows=await repository.loadRecommendations(storeId);
        if(!rows.length)throw new Error('还没有月份推荐，请先导入分析结果。');
        return ctx.files.exportRows('XX_月份推荐.xlsx',rows.map(row=>({...row,peakMonths:row.peakMonths?.join('、')||'',lowMonths:row.lowMonths?.join('、')||''})),RECOMMENDATION_COLUMNS);
      }
      const datasets=await datasetsFor(storeId,kind,p.datasetIds);
      const sheets=buildAnalysisWorkbook(datasets);
      return ctx.files.exportWorkbook(`XX_${LABELS[kind]}_${new Date().toISOString().slice(0,10)}.xlsx`,sheets);
    }
    if(action==='template'&&(kind==='trends'||kind==='recommendations')){
      const datasets=await datasetsFor(storeId,'trends',p.datasetIds);
      return ctx.files.exportWorkbook('XX_月份推荐回填模板.xlsx',buildRecommendationTemplate(datasets));
    }
    if(action==='importPreview'&&kind==='recommendations')return previewRecommendations(storeId);
    if(action==='importCommit'&&kind==='recommendations')return mutate(storeId,async()=>{
      const ticket=tickets.read(p.token,storeId,kind);
      const result=await repository.mergeRecommendations(storeId,ticket.rows,ticket.meta);
      tickets.remove(p.token);return result;
    });
    if(action==='rawTemplate'&&kind==='trends')return ctx.files.exportWorkbook('XX_关键词日数据模板.xlsx',rawTrendTemplate());
    if(action==='importDataPreview'&&kind==='trends'){
      const file=await ctx.files.pickImport();if(file.canceled)return file;
      try {
        const datasets=parseRawTrendRows(file.rows,store).map(validateDataset);
        const token=tickets.issue(storeId,'raw-trends',{datasets});
        return {token,rows:datasets.map(d=>({keyword:d.context.keyword,category:d.context.category,startDate:d.startDate,endDate:d.endDate,rowCount:d.rows.length})),total:datasets.length,added:datasets.length,updated:0,errors:[],warnings:['导入文件将作为新的数据批次保存，来源标记为文件导入。']};
      } catch(error){return {rows:[],errors:error.issues||[error.message],warnings:[]};}
    }
    if(action==='importDataCommit'&&kind==='trends')return mutate(storeId,async()=>{
      const ticket=tickets.read(p.token,storeId,'raw-trends');
      tickets.remove(p.token);
      await repository.saveDatasets(ticket.datasets);
      const added=ticket.datasets.length;
      return {added,total:added,message:`已保存 ${added} 个关键词数据批次。`};
    });
    throw new Error('此数据模块不支持该操作。');
  }

  const modules=Object.fromEntries([...DATA_KINDS,'recommendations'].map(kind=>[kind,{handle:(action,p)=>handle(kind,action,p)}]));
  return {...modules,
    prepare:(webContents,kind)=>collectors.prepare?.(webContents,kind),
    async cancelStore(storeId){closingStores.add(storeId);collectors.cancel(storeId);tickets.clearStore(storeId);await Promise.allSettled([mutations.get(storeId)]);},
    async dispose(){disposed=true;tickets.clear();await collectors.dispose();await Promise.allSettled([...mutations.values()]);}
  };
}
module.exports={createInsightServices};
