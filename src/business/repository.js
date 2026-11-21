'use strict';

const {createHash}=require('node:crypto');
const {identifier,mode,isoDate,dateList,normalizeSource,normalizedShopName,shopNamesMatch,sameSource,coverageScope,safeMessage,normalizeSourceCoverage,validateSnapshot}=require('./domain');
const {selectSourceSummaries}=require('./query-sources');

// 新目录：用户数据/店铺数据/<店铺名>_<ID前8位>/；旧目录 business/<哈希> 仅作为迁移前的后备。
const legacyStoreDirectory=storeId=>`business/${createHash('sha256').update(identifier(storeId)).digest('hex').slice(0,32)}`;
const storeDirectory=(storeId,folder)=>typeof folder==='string'&&folder?folder:legacyStoreDirectory(storeId);
function canceledError(){const error=new Error('经营数据同步已取消，原完整数据保持不变');error.code='BUSINESS_CANCELED';return error;}
function checkSignal(signal){if(signal?.aborted)throw canceledError();}
function snapshotSummary(snapshot){return {id:snapshot.id,mode:snapshot.mode,scope:snapshot.coverage.scope,start:snapshot.start,end:snapshot.end,capturedAt:snapshot.capturedAt,rowCount:snapshot.rows.length,source:snapshot.source,warnings:snapshot.warnings,coverage:snapshot.coverage,sourceCoverage:snapshot.sourceCoverage};}

function createBusinessRepository(ctx){
  // 每个店铺一个独立文件夹；文件夹名由 store-data 分配并在设置页可见。
  const root=storeId=>storeDirectory(storeId,typeof ctx.storeFolder==='function'?ctx.storeFolder(identifier(storeId)):null);
  const queues=new Map();
  async function requireStore(storeId){const id=identifier(storeId),store=await ctx.getStore(id);if(!store||store.id!==id)throw new Error('经营数据所属店铺不存在');return store;}
  function queue(storeId,work){const operation=(queues.get(storeId)||Promise.resolve()).catch(()=>{}).then(work);queues.set(storeId,operation);return operation.finally(()=>{if(queues.get(storeId)===operation)queues.delete(storeId);});}
  async function wait(storeId){while(queues.has(storeId))await queues.get(storeId).catch(()=>{});}
  async function readIndex(storeId){
    const raw=await ctx.readJson(`${root(storeId)}/index.json`,{schemaVersion:1,storeId,source:null,snapshots:[]});
    if(raw?.schemaVersion!==1||raw.storeId!==storeId||!Array.isArray(raw.snapshots)||raw.snapshots.length>10000)throw new Error('经营数据索引无效，请从备份恢复');
    const source=raw.source?normalizeSource(raw.source):null,seen=new Set();
    const snapshots=raw.snapshots.map(item=>{
      const id=identifier(item.id,'批次ID');if(seen.has(id))throw new Error('经营数据索引存在重复批次');seen.add(id);
      const kind=mode(item.mode),start=isoDate(item.start),end=isoDate(item.end),capturedAt=new Date(item.capturedAt).toISOString();
      if(start>end||(Date.parse(end)-Date.parse(start))/86400000>=31||!Number.isSafeInteger(item.rowCount)||item.rowCount<0)throw new Error('经营数据批次信息无效');
      const batchSource=normalizeSource(item.source);
      if(!source||!sameSource(source,batchSource))throw new Error('经营数据索引的后台店铺身份不一致');
      const scope=coverageScope(item.scope??item.coverage?.scope);
      if(item.coverage?.scope!==undefined&&scope!==item.coverage.scope||scope==='visible-page'&&start!==end)throw new Error('经营数据索引的页面快照范围不一致');
      return {id,mode:kind,scope,start,end,capturedAt,rowCount:item.rowCount,source:batchSource,warnings:Array.isArray(item.warnings)?item.warnings.filter(value=>typeof value==='string').map(value=>safeMessage(value)):[],sourceCoverage:normalizeSourceCoverage(item.sourceCoverage,{start,end,mode:kind})};
    });
    if(snapshots.length&&!source)throw new Error('经营数据缺少后台店铺绑定');
    return {schemaVersion:1,storeId,source,snapshots};
  }
  async function index(storeId){await requireStore(storeId);await wait(storeId);return structuredClone(await readIndex(storeId));}
  async function loadSnapshot(storeId,id){
    await requireStore(storeId);identifier(id,'批次ID');await wait(storeId);
    const current=await readIndex(storeId),summary=current.snapshots.find(item=>item.id===id);
    if(!summary)throw new Error('所选经营批次不存在或不属于当前店铺');
    const raw=await ctx.readJson(`${root(storeId)}/snapshots/${id}.json`,null);
    if(!raw||raw.storeId!==storeId||raw.id!==id)throw new Error('经营数据快照缺失或店铺不匹配');
    const snapshot=validateSnapshot(raw,{validateCurrentRange:false});
    if(!sameSource(snapshot.source,current.source)||!sameSource(snapshot.source,summary.source)||snapshot.coverage.scope!==summary.scope||snapshot.mode!==summary.mode||snapshot.start!==summary.start||snapshot.end!==summary.end||snapshot.rows.length!==summary.rowCount)throw new Error('经营数据快照与已提交索引不一致');
    return snapshot;
  }
  async function querySnapshots(storeId,kind,range,requestedScope){
    const current=await index(storeId),matching=current.snapshots.filter(item=>item.mode===kind&&item.end>=range.start&&item.start<=range.end),snapshots=[];
    const scope=requestedScope===undefined?(matching.at(-1)?.scope||'full'):coverageScope(requestedScope),summaries=matching.filter(item=>item.scope===scope);
    if(scope==='visible-page'){
      const latest=summaries.at(-1);if(latest)snapshots.push(await loadSnapshot(storeId,latest.id));
      return {index:current,snapshots,scope};
    }
    // New batches replace only the completed sources they declare. Legacy
    // batches remain whole-date barriers, so unused history is not reread.
    for(const summary of selectSourceSummaries(summaries,range))snapshots.push(await loadSnapshot(storeId,summary.id));
    return {index:current,snapshots,scope};
  }
  async function save(snapshot,{signal,onCommit}={}){
    await requireStore(snapshot.storeId);const validated=validateSnapshot(snapshot,{validateCurrentRange:false});
    return queue(validated.storeId,async()=>{
      checkSignal(signal);const store=await requireStore(validated.storeId);
      if(validated.source.identityType==='visible-name'&&!shopNamesMatch(validated.source.shopName,store.name))throw new Error('页面可见店铺名称与当前所选店铺不一致，本次不保存');
      const current=await readIndex(validated.storeId);
      if(current.source&&!sameSource(current.source,validated.source))throw new Error('后台店铺身份与本机经营数据绑定不一致，已拒绝混入另一家店铺的数据');
      if(current.snapshots.some(item=>item.id===validated.id))throw new Error('完整经营快照不可覆盖，请使用新的批次ID');
      if(current.snapshots.length>=10000)throw new Error('经营历史批次已达上限，请先归档数据');
      const snapshotPath=`${root(validated.storeId)}/snapshots/${validated.id}.json`;
      if(await ctx.readJson(snapshotPath,null))throw new Error('经营快照文件已存在，请重新同步生成新批次');
      checkSignal(signal);
      await ctx.writeJson(snapshotPath,validated);
      checkSignal(signal);await requireStore(validated.storeId);checkSignal(signal);
      // Name-only observations never downgrade a previously verified platform ID.
      const boundSource=current.source?.platformShopId?current.source:validated.source;
      const next={schemaVersion:1,storeId:validated.storeId,source:boundSource,snapshots:[...current.snapshots,snapshotSummary(validated)]};
      // Commit boundary: once this callback runs, a later cancellation cannot
      // undo an atomic index replacement. Orphan snapshots are never read.
      onCommit?.();
      await ctx.writeJson(`${root(validated.storeId)}/index.json`,next);
      return structuredClone(validated);
    });
  }
  async function flush(){while(queues.size)await Promise.allSettled([...queues.values()]);}
  return {index,loadSnapshot,querySnapshots,save,flush};
}

module.exports={createBusinessRepository,storeDirectory,legacyStoreDirectory,snapshotSummary,canceledError,checkSignal};
