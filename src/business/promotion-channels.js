'use strict';

// “推广渠道”读取器（需求4）：按商品ID聚合四个渠道的“推广中”单元：
//   1 = 全站标准模式下的商品（含全站商品/全站商品包）
//   2 = 关键词推广单元
//   3 = 全站标准模式下的全店（全店/计划组）
//   4 = 全站费比模式
// 规则：某渠道只要有任意一个“推广中”单元 → 该渠道编号显示；该渠道全部暂停 →
// 编号不显示；所有渠道都没有推广中（含只有暂停单元）或完全没有推广 → 空白。
const {FullSyncError}=require('./full-sync');
const {identifier}=require('./domain');
const {storeDirectory}=require('./repository');

const fail=(code,message)=>{throw new FullSyncError(code,message);};
const CAMPAIGN_PATH='/campaign/horizontal/findPage.json';
const ADGROUP_PATH='/adgroup/horizontal/findPage.json';
const SITE_SCENES=['promotion_scene_site','promotion_scene_site_package'];
const SITE_MODES=['shop','group'];
const COST_SCENES=['promotion_scene_cost_ratio'];
const REUSE_MS=15*60_000;
const CAMPAIGN_PAGE_SIZE=40,GROUP_PAGE_SIZE=5,KEYWORD_PAGE_SIZE=500;
const MAX_CAMPAIGN_PAGES=60,MAX_KEYWORD_PAGES=80,MAX_UNITS=200000;

function digitId(value){
  if(value===undefined||value===null||value==='')return '';
  if(typeof value==='number'&&!Number.isSafeInteger(value))fail('INVALID_PRODUCT','推广单元商品标识超出安全精度');
  const text=String(value).trim();
  return /^\d{6,30}$/.test(text)?text:'';
}
// 单元状态：只有明确“推广中”才算命中；暂停/未知一律不计入，避免把暂停单元当成推广中。
function unitPromoting(unit){
  const status=String(unit?.displayStatus??'').toLowerCase();
  if(status==='start')return true;
  if(status==='pause'||status==='stop'||status==='paused')return false;
  const online=unit?.onlineStatus;
  if(online===1||online==='1')return true;
  if(online===0||online==='0')return false;
  return false;
}
function sleep(ms,signal){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();resolve();},Math.max(0,ms));
    const abort=()=>{cleanup();reject(new FullSyncError('CANCELED','推广渠道读取已取消，本次未保存'));};
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
  });
}

function createPromotionChannelsReader(ctx,options={}){
  const transport=options.transport||require('./channels-transport').createChannelsTransport(ctx,options.transportOptions||{});
  const store=options.store||createPromotionChannelsStore(ctx);
  const now=typeof options.now==='function'?options.now:Date.now;
  const spacingMs=Math.max(0,Math.min(2000,Number(options.spacingMs)||150));
  let disposed=false;
  async function scan(storeId,{path,body,pageSize,maxPages,label,signal,onProgress}){
    const items=[];let count=null;
    for(let page=1;;page++){
      if(signal?.aborted)fail('CANCELED','推广渠道读取已取消，本次未保存');
      if(page>maxPages)fail('CHANNELS_PAGE_LIMIT',`${label}超过页数上限，本次未保存（已读取 ${items.length} 条）`);
      onProgress?.({message:`正在读取${label}第 ${page} 页…`,current:items.length,total:count??0});
      const payload=await transport.post(storeId,{path,body:{...body,offset:(page-1)*pageSize,pageSize}},signal);
      // transport.post 返回后台的完整 JSON（{data,info}）；扫描只用其中的 data。
      const data=payload&&typeof payload==='object'?(payload.data&&typeof payload.data==='object'?payload.data:payload):null;
      if(count===null){
        const value=Number(data?.count);
        if(!Number.isSafeInteger(value)||value<0||value>MAX_UNITS)fail('CHANNELS_TOTAL_UNCONFIRMED',`${label}未取得可信总条数，本次未保存`);
        count=value;
      }
      const list=Array.isArray(data?.list)?data.list:[];
      if(list.length>pageSize)fail('CHANNELS_INVALID','推广渠道分页条数异常，本次未保存');
      items.push(...list);
      if(items.length>count)fail('CHANNELS_TOTAL_MISMATCH',`${label}返回条数超过后台总数，本次未保存`);
      if(items.length>=count)break;
      if(!list.length)fail('CHANNELS_EMPTY_PAGE',`${label}第 ${page} 页为空但没有读完，本次未保存`);
      await sleep(spacingMs,signal);
    }
    return {count,items};
  }
  // 计划/单元列表 → 商品ID集合（只收集“推广中”的单元）。
  function collectCampaigns(items,channel,{channelName,excludeModes=null}){
    const hit=new Set();let units=0,promoting=0,ignored=0,empty=0,unresolved=0;
    for(const campaign of items){
      if(!campaign||typeof campaign!=='object'){unresolved++;continue;}
      if(excludeModes&&excludeModes.includes(String(campaign.itemSelectedMode))){ignored++;continue;}
      const list=Array.isArray(campaign.adgroupList)?campaign.adgroupList:[];
      // 真实数据里存在“已暂停且没有任何单元明细”的空计划（2026-10-10 实测腾味莱 248 个计划中有 1 个）：
      // 这类计划本来就没有可投放的商品，跳过并记录数量，不能因此让整批同步失败。
      if(!list.length){empty++;continue;}
      let found=false;
      for(const unit of list){
        const materialId=digitId(unit?.material?.materialId)||digitId(unit?.materialId)||digitId(unit?.itemId);
        if(!materialId)continue;
        found=true;units++;
        if(unitPromoting(unit)){promoting++;hit.add(materialId);}
      }
      if(!found)unresolved++;
    }
    // 有计划存在单元、但单元里没有商品ID：无法归属，仍然停止（避免漏掉推广中的商品）。
    if(unresolved)fail('CHANNELS_UNRESOLVED',`${channelName}有 ${unresolved} 个计划的单元缺少商品ID，本次未保存`);
    return {hit,units,promoting,ignored,empty};
  }
  function collectKeywordUnits(items){
    const hit=new Set();let units=0,promoting=0,unresolved=0;
    for(const unit of items){
      if(!unit||typeof unit!=='object'){unresolved++;continue;}
      const materialId=digitId(unit.materialId)||digitId(unit?.material?.materialId)||digitId(unit?.material?.bindItemId);
      if(!materialId){unresolved++;continue;}
      units++;
      if(unitPromoting(unit)){promoting++;hit.add(materialId);}
    }
    if(unresolved)fail('CHANNELS_UNRESOLVED',`关键词推广有 ${unresolved} 个单元没有可核对的商品ID，本次未保存`);
    return {hit,units,promoting};
  }
  async function read({storeId,signal,onProgress}={}){
    if(disposed)fail('COLLECTOR_DISPOSED','推广渠道读取服务已停止');
    const id=identifier(storeId);ctx.getStore(id);
    const saved=await store.load(id).catch(()=>null);
    if(saved&&Number.isFinite(Date.parse(saved.capturedAt))&&now()-Date.parse(saved.capturedAt)<=REUSE_MS){
      const minutes=Math.max(0,Math.round((now()-Date.parse(saved.capturedAt))/60000));
      onProgress?.({message:`使用 ${minutes} 分钟前的推广渠道快照（15 分钟内不重复读取）`,current:Object.keys(saved.byProduct||{}).length,total:Object.keys(saved.byProduct||{}).length});
      return {...saved,reused:true};
    }
    const stats={};
    onProgress?.({message:'正在读取全站商品（全站标准模式）…'});
    const site=await scan(id,{path:CAMPAIGN_PATH,pageSize:CAMPAIGN_PAGE_SIZE,maxPages:MAX_CAMPAIGN_PAGES,label:'全站商品',signal,onProgress,
      body:{adgroupRequired:true,adzoneRequired:false,bizCode:'onebpSite',promotionSceneList:SITE_SCENES}});
    const channel1=collectCampaigns(site.items,1,{channelName:'全站商品',excludeModes:SITE_MODES});
    stats.channel1={plans:site.count,units:channel1.units,promoting:channel1.promoting,products:channel1.hit.size,emptyPlans:channel1.empty};
    onProgress?.({message:'正在读取全站全店（全站标准模式-全店）…'});
    const group=await scan(id,{path:CAMPAIGN_PATH,pageSize:GROUP_PAGE_SIZE,maxPages:MAX_CAMPAIGN_PAGES,label:'全站全店',signal,onProgress,
      body:{adgroupRequired:true,adzoneRequired:false,bizCode:'onebpSite',promotionSceneList:SITE_SCENES,itemSelectedModeList:SITE_MODES}});
    const channel3=collectCampaigns(group.items,3,{channelName:'全站全店'});
    stats.channel3={plans:group.count,units:channel3.units,promoting:channel3.promoting,products:channel3.hit.size,emptyPlans:channel3.empty};
    onProgress?.({message:'正在读取全站费比模式…'});
    const cost=await scan(id,{path:CAMPAIGN_PATH,pageSize:CAMPAIGN_PAGE_SIZE,maxPages:MAX_CAMPAIGN_PAGES,label:'全站费比',signal,onProgress,
      body:{adgroupRequired:true,adzoneRequired:false,bizCode:'onebpSite',promotionSceneList:COST_SCENES}});
    const channel4=collectCampaigns(cost.items,4,{channelName:'全站费比'});
    stats.channel4={plans:cost.count,units:channel4.units,promoting:channel4.promoting,products:channel4.hit.size,emptyPlans:channel4.empty};
    onProgress?.({message:'正在读取关键词推广单元…',current:0,total:0});
    const keyword=await scan(id,{path:ADGROUP_PATH,pageSize:KEYWORD_PAGE_SIZE,maxPages:MAX_KEYWORD_PAGES,label:'关键词推广单元',signal,onProgress,
      body:{statusList:['start','pause'],adgroupRequired:false,bizCode:'onebpSearch'}});
    const channel2=collectKeywordUnits(keyword.items);
    stats.channel2={units:channel2.units,promoting:channel2.promoting,products:channel2.hit.size};
    const merged=new Map();
    for(const [channel,data] of [[1,channel1],[2,channel2],[3,channel3],[4,channel4]]){
      for(const productId of data.hit){
        if(!merged.has(productId))merged.set(productId,new Set());
        merged.get(productId).add(channel);
      }
    }
    const byProduct={};
    for(const productId of [...merged.keys()].sort((a,b)=>a.localeCompare(b)))byProduct[productId]=[...merged.get(productId)].sort((a,b)=>a-b).join(',');
    const warnings=[
      '推广渠道按商品ID统计“推广中”的单元：1=全站商品；2=关键词；3=全站全店；4=全站费比模式。',
      '某渠道全部单元暂停时不显示该渠道编号；所有渠道都没有推广中（或没有推广）时留空。',
    ];
    if(channel1.ignored)warnings.push(`全站商品列表忽略了 ${channel1.ignored} 个全店/计划组条目（已由全站全店渠道单独统计）。`);
    if(channel1.empty)warnings.push(`全站商品有 ${channel1.empty} 个空计划（已暂停且没有单元明细），已跳过；这些计划没有可投放商品。`);
    if(keyword.count>0)warnings.push(`关键词推广单元共 ${keyword.count} 条，其中 ${channel2.promoting} 条为推广中。`);
    const snapshot={schemaVersion:1,storeId:id,capturedAt:new Date(now()).toISOString(),byProduct,stats,warnings};
    await store.save(snapshot);
    return snapshot;
  }
  return {read,dispose:()=>{disposed=true;transport.dispose?.();}};
}

function createPromotionChannelsStore(ctx){
  const path=storeId=>`${storeDirectory(identifier(storeId),typeof ctx.storeFolder==='function'?ctx.storeFolder(identifier(storeId)):null)}/promotion-channels.json`;
  async function load(storeId){
    const id=identifier(storeId);
    const raw=await ctx.readJson(path(id),null);
    if(!raw||typeof raw!=='object'||raw.storeId!==id||!raw.byProduct||typeof raw.byProduct!=='object')return null;
    return raw;
  }
  async function save(value){
    const storeId=identifier(value?.storeId);
    const record={...value,storeId,capturedAt:new Date(value.capturedAt).toISOString()};
    await ctx.writeJson(path(storeId),record);
    return record;
  }
  return {load,save};
}

module.exports={createPromotionChannelsReader,createPromotionChannelsStore,unitPromoting};
