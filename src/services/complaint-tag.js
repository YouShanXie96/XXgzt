'use strict';
// 投诉打标（独立模块）：营商保异常订单投诉 + 账号打标。
// 独立数据（complaint-tag/<storeId>.json）、独立店铺页面（kind='complaint'）、独立 IPC（complaint.*），
// 与内购会 / 托管礼金 / 违规排查一样互不影响。
const {randomUUID}=require('node:crypto');
const ysb=require('../shared/complaint-tag');
const defaultConnector=require('../connectors/complaint-tag-ysb-connector');

const PREVIEW_TTL_MS=30*60_000;
const MAX_RECORDS=2000;
const DEFAULT_GAP={min:3,max:6};
const CHUNK=ysb.COMPLAINT_MAX_ORDERS_PER_SUBMIT;

function describeError(error){
  const code=error&&error.code;
  const known={
    'needs-login':'店铺登录已失效，请先在桌面重新登录该店铺，再回来执行',
    'security-challenge':'营商保出现安全验证（滑块）。已弹出营商保窗口，请完成验证后点「继续」',
    'page-not-ready':'营商保页面加载超时，请稍后重试',
    'page-closed':'营商保页面已关闭，请重试'
  };
  const message=known[code]||(error instanceof Error?error.message:String(error))||'投诉打标操作未完成';
  const next=new Error(message);
  if(code)next.code=code;
  return next;
}

function createComplaintTagService(ctx,options={}){
  const api=options.connector||defaultConnector;
  let disposed=false;
  const key=storeId=>`complaint-tag/${storeId}.json`;
  const emptyStore=()=>({schemaVersion:1,lastRun:null,records:[]});
  const previews=new Map();
  const runs=new Map();
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function alive(){if(disposed)throw new Error('程序正在退出或恢复数据');}
  async function loadStore(storeId){
    const store=await ctx.readJson(key(storeId),emptyStore());
    if(!store||typeof store!=='object'||!Array.isArray(store.records))throw new Error('投诉打标本地数据格式错误，请从备份恢复');
    return store;
  }
  async function persist(storeId,store){
    store.records=store.records.slice(0,MAX_RECORDS);
    await ctx.writeJson(key(storeId),store);
    return store;
  }
  async function pageFor(storeId){
    alive();
    const wc=await ctx.browser.page(storeId,'complaint');
    alive();
    await api.waitForMtopReady(wc);
    return wc;
  }
  function publicRun(run){
    if(!run)return null;
    return {
      runId:run.runId,
      kind:run.kind,
      storeId:run.storeId,
      sceneName:run.sceneName,
      state:run.state,
      notice:run.notice,
      items:run.items.map(item=>({id:item.id,buyerNick:item.buyerNick,orderIds:[...item.orderIds],status:item.status,message:item.message})),
      startedAt:run.startedAt,
      finishedAt:run.finishedAt,
      gap:{...run.gap}
    };
  }
  function publish(run){
    alive();
    ctx.emit?.({module:'complaint',storeId:run.storeId,run:publicRun(run)});
  }
  function prunePreviews(){
    const now=Date.now();
    for(const [id,preview] of previews)if(preview.expiresAt<=now)previews.delete(id);
  }

  async function previewComplaint(storeId,input){
    const scene=ysb.findComplaintScene(input.sceneCode);
    if(!scene)throw new Error('不支持的投诉场景');
    const description=String(input.description||'').trim();
    if(!description)throw new Error('请填写投诉描述');
    if(description.length>ysb.COMPLAINT_MAX_DESCRIPTION)throw new Error(`投诉描述不能超过 ${ysb.COMPLAINT_MAX_DESCRIPTION} 字`);
    const orderIds=[...new Set((Array.isArray(input.orderIds)?input.orderIds:[]).map(String).filter(id=>/^\d{12,20}$/u.test(id)))];
    if(!orderIds.length)throw new Error('请粘贴订单号（每行一个，或用逗号/空格分隔）');
    if(orderIds.length>ysb.COMPLAINT_MAX_ORDERS_PER_BATCH)throw new Error(`一批最多 ${ysb.COMPLAINT_MAX_ORDERS_PER_BATCH} 个订单，请分批执行`);
    const wc=await pageFor(storeId);
    const quota=await api.queryComplaintQuota(wc);
    const orders=[];
    for(let index=0;index<orderIds.length;index+=CHUNK){
      const chunk=orderIds.slice(index,index+CHUNK);
      ctx.emit?.({module:'complaint',storeId,message:'正在查询营商保订单',current:index,total:orderIds.length});
      const found=await api.searchComplaintOrders(wc,{orderIds:chunk,sceneCode:scene.code});
      for(const order of found){
        if(orders.some(existing=>existing.orderId===order.orderId))continue;
        orders.push({...order,buyerKey:ysb.buyerKeyForOrder(order),buyerResolved:!/\*/.test(String(order.buyerNick||''))&&Boolean(String(order.buyerNick||'').trim())});
      }
      if(index+CHUNK<orderIds.length)await sleep(400);
    }
    const foundIds=new Set(orders.map(order=>order.orderId));
    const notFoundOrderIds=orderIds.filter(id=>!foundIds.has(id));
    prunePreviews();
    const previewId=randomUUID();
    const expiresAt=Date.now()+PREVIEW_TTL_MS;
    const preview={
      previewId,mode:'complaint',storeId,sceneCode:scene.code,sceneName:scene.name,description,
      availableQuota:quota,
      orders,
      notFoundOrderIds,
      groups:ysb.groupComplaintOrders(orders),
      expiresAt
    };
    previews.set(previewId,{mode:'complaint',storeId,expiresAt,preview});
    return preview;
  }

  async function previewTag(storeId,input){
    const scene=ysb.findTagScene(input.sceneCode);
    if(!scene)throw new Error('不支持的打标场景');
    const nicks=[...new Set((Array.isArray(input.buyerNicks)?input.buyerNicks:[]).map(nick=>String(nick).trim()).filter(Boolean))];
    if(!nicks.length)throw new Error('请粘贴买家旺旺昵称');
    if(nicks.length>ysb.TAG_MAX_NICKS_PER_BATCH)throw new Error(`一批最多 ${ysb.TAG_MAX_NICKS_PER_BATCH} 个旺旺，请分批执行`);
    const wc=await pageFor(storeId);
    const passed=await api.checkTagExam(wc);
    if(!passed)throw new Error('这个店铺还没通过营商保「账号打标」测评。请先在营商保 → 账号打标 → 我要打标 完成测评，再回来执行。');
    const rows=[];
    for(const [index,buyerNick] of nicks.entries()){
      ctx.emit?.({module:'complaint',storeId,message:'正在查询买家订单',current:index,total:nicks.length});
      const candidates=await api.queryTagOrders(wc,{buyerNick,sceneCode:scene.code});
      rows.push({buyerNick,...ysb.pickTagOrder(candidates)});
      if(index<nicks.length-1)await sleep(300);
    }
    prunePreviews();
    const previewId=randomUUID();
    const expiresAt=Date.now()+PREVIEW_TTL_MS;
    const preview={previewId,mode:'tag',storeId,sceneCode:scene.code,sceneName:scene.name,typeName:scene.type,nicks:rows,expiresAt};
    previews.set(previewId,{mode:'tag',storeId,expiresAt,preview});
    return preview;
  }

  function finishItem(run,item,status,message){
    item.status=status;
    item.message=message;
    item.finishedAt=new Date().toISOString();
    const record={
      id:randomUUID(),
      runId:run.runId,
      kind:run.kind,
      storeId:run.storeId,
      sceneName:run.sceneName,
      buyerNick:item.buyerNick,
      orderIds:[...item.orderIds],
      status,
      message,
      createdAt:item.finishedAt
    };
    run.recordQueue.push(record);
    void flushRecords(run).catch(()=>undefined);
  }
  let flushChain=Promise.resolve();
  function flushRecords(run){
    const pending=run.recordQueue.splice(0,run.recordQueue.length);
    if(!pending.length)return flushChain;
    flushChain=flushChain.then(async()=>{
      const store=await loadStore(run.storeId).catch(()=>emptyStore());
      store.records=[...pending.reverse(),...store.records].slice(0,MAX_RECORDS);
      store.lastRun={at:new Date().toISOString(),kind:run.kind,sceneName:run.sceneName,state:run.state,runId:run.runId};
      await persist(run.storeId,store);
    }).catch(()=>undefined);
    return flushChain;
  }

  async function waitWhilePaused(run){
    while((run.pauseRequested||run.state==='challenge')&&!run.stopRequested){
      await new Promise(resolve=>{run.wake=resolve;});
      run.wake=undefined;
    }
  }
  async function interruptibleDelay(run,ms){
    const deadline=Date.now()+ms;
    while(Date.now()<deadline&&!run.stopRequested&&!run.pauseRequested)await sleep(Math.min(250,Math.max(1,deadline-Date.now())));
  }
  function randomGapMs(gap){return Math.round((gap.min+Math.random()*(gap.max-gap.min))*1000);}
  function enterChallenge(run,notice){
    run.state='challenge';
    run.notice=notice;
    try{void Promise.resolve(ctx.browser.show(run.storeId,'complaint')).catch(()=>undefined);}catch{/* 手动打开 */}
    publish(run);
  }
  function blockRun(run,notice){
    run.state='blocked';
    run.notice=notice;
    for(const item of run.items)if(item.status==='queued'||item.status==='running'){item.status='skipped';item.message='任务已停止，未提交';}
    run.finishedAt=new Date().toISOString();
    publish(run);
  }

  async function executeRun(run,description){
    let wc=await pageFor(run.storeId);
    if(run.kind==='tag'){
      const passed=await api.checkTagExam(wc).catch(error=>{
        if(error&&(error.code==='needs-login'||error.code==='security-challenge'))throw error;
        return false;
      });
      if(!passed)return blockRun(run,'这个店铺还没通过营商保「账号打标」测评。请先在营商保 → 账号打标 → 我要打标 完成测评，再回来执行。');
    }
    let submittedAny=false;
    for(const item of run.items){
      if(item.status!=='queued')continue;
      while(item.status==='queued'){
        await waitWhilePaused(run);
        if(run.stopRequested)break;
        if(submittedAny)await interruptibleDelay(run,randomGapMs(run.gap));
        await waitWhilePaused(run);
        if(run.stopRequested)break;
        if(wc.isDestroyed())wc=await pageFor(run.storeId);
        item.status='running';
        publish(run);
        const data=run.kind==='complaint'
          ?ysb.buildComplaintSubmitData({sceneCode:run.sceneCode,orderIds:item.orderIds,description})
          :ysb.buildTagSubmitData({buyerNick:item.buyerNick,orderIds:item.orderIds,sceneCode:run.sceneCode});
        const result=run.kind==='complaint'?await api.submitComplaint(wc,data):await api.submitTag(wc,data);
        submittedAny=true;
        if(result.ok){
          const model=result.data&&typeof result.data==='object'?result.data.model:undefined;
          if(run.kind==='tag'&&(model===0||model==='0'||model===false))finishItem(run,item,'failed','营商保未受理本次打标');
          else finishItem(run,item,'succeeded',run.kind==='complaint'
            ?`投诉编号 ${(typeof model==='string'||typeof model==='number')?String(model):'已提交'}`
            :'打标成功');
        }else if(result.timedOut){
          // 请求可能已经到达平台，结果未知时不自动重试，避免重复投诉。
          finishItem(run,item,'failed','提交超时，结果未知，请到营商保记录核对，未自动重试');
          enterChallenge(run,'提交超时，可能出现了安全验证。请在弹出的营商保窗口检查后点「继续」');
        }else{
          const failure=ysb.classifyMtopFailure(result.ret);
          if(failure==='security-challenge'){
            item.status='queued';
            enterChallenge(run,'营商保出现安全验证（滑块），已暂停。请在弹出的窗口完成验证后点「继续」');
          }else if(failure==='login-required'){
            item.status='queued';
            return blockRun(run,'店铺登录已失效，请在桌面重新登录该店铺后再试');
          }else{
            finishItem(run,item,'failed',ysb.describeMtopRet(result.ret));
          }
        }
        publish(run);
      }
      if(run.stopRequested)break;
    }
    if(run.stopRequested){
      for(const item of run.items)if(item.status==='queued'||item.status==='running'){item.status='skipped';item.message='已手动停止，未提交';}
      run.state='stopped';
    }else{
      run.state='completed';
    }
    run.finishedAt=new Date().toISOString();
    await flushRecords(run);
    publish(run);
  }

  async function handle(action,p={}){
    if(disposed)throw new Error('程序正在退出或恢复数据');
    const store=ctx.getStore(p.storeId),storeId=store.id;
    if(action==='load'){
      const local=await loadStore(storeId);
      return {
        records:local.records,
        lastRun:local.lastRun,
        complaintScenes:ysb.COMPLAINT_ORDER_SCENES,
        descriptionTemplates:ysb.COMPLAINT_DESCRIPTION_TEMPLATES,
        tagTypes:ysb.TAG_SCENARIOS,
        limits:{
          maxOrdersPerSubmit:ysb.COMPLAINT_MAX_ORDERS_PER_SUBMIT,
          maxOrdersPerBatch:ysb.COMPLAINT_MAX_ORDERS_PER_BATCH,
          maxNicksPerBatch:ysb.TAG_MAX_NICKS_PER_BATCH,
          maxDescription:ysb.COMPLAINT_MAX_DESCRIPTION
        },
        gap:DEFAULT_GAP,
        run:publicRun(runs.get(storeId)||null)
      };
    }
    if(action==='open'){
      const wc=await ctx.browser.show(storeId,'complaint');
      return {url:wc?.getURL?.()||ysb.YSB_COMPLAINT_LIST_URL,message:'已打开营商保页面；请核对店铺登录状态，安全验证完成后回到工作台点「继续」。'};
    }
    if(action==='preview'){
      try{
        const preview=p.mode==='tag'?await previewTag(storeId,p):await previewComplaint(storeId,p);
        return {preview};
      }catch(error){
        // 安全验证时把营商保页面显示出来，用户处理完再重试预览。
        if(error&&error.code==='security-challenge'){try{await ctx.browser.show(storeId,'complaint');}catch{/* 手动打开 */}}
        throw describeError(error);
      }
    }
    if(action==='start'){
      prunePreviews();
      const stored=previews.get(p.previewId);
      if(!stored||stored.storeId!==storeId)throw new Error('预览已过期，请重新解析预览');
      const existing=runs.get(storeId);
      if(existing&&(existing.state==='running'||existing.state==='paused'||existing.state==='challenge'))throw new Error('这个店铺还有任务在执行，请先等待完成或停止');
      const excluded=new Set(Array.isArray(p.excludedKeys)?p.excludedKeys.map(String):[]);
      const items=stored.mode==='complaint'
        ?stored.preview.groups
          .map(group=>({...group,orderIds:group.orderIds.filter(id=>!excluded.has(id))}))
          .filter(group=>group.orderIds.length)
          .map(group=>({id:randomUUID(),buyerNick:group.buyerNick,orderIds:group.orderIds,status:'queued',message:''}))
        :stored.preview.nicks
          .filter(nick=>nick.status==='ready'&&!excluded.has(nick.buyerNick))
          .map(nick=>({id:randomUUID(),buyerNick:nick.buyerNick,orderIds:[nick.orderId],status:'queued',message:''}));
      if(!items.length)throw new Error('没有可提交的内容');
      if(stored.mode==='complaint'&&stored.preview.availableQuota!==null&&items.length>stored.preview.availableQuota){
        throw new Error(`投诉额度不足：剩余 ${stored.preview.availableQuota} 次，本批 ${items.length} 张投诉单。请移除部分订单后再提交。`);
      }
      previews.delete(p.previewId);
      const gapIn=p.gapSeconds||{};
      const min=Math.min(60,Math.max(2,Number.isFinite(Number(gapIn.min))?Math.round(Number(gapIn.min)):DEFAULT_GAP.min));
      const max=Math.max(min,Math.min(60,Number.isFinite(Number(gapIn.max))?Math.round(Number(gapIn.max)):DEFAULT_GAP.max));
      const run={
        runId:randomUUID(),
        kind:stored.mode,
        storeId,
        sceneName:stored.mode==='tag'?`${stored.preview.typeName} / ${stored.preview.sceneName}`:`异常订单 / ${stored.preview.sceneName}`,
        sceneCode:stored.preview.sceneCode,
        state:'running',
        notice:'',
        items,
        startedAt:new Date().toISOString(),
        gap:{min,max},
        pauseRequested:false,
        stopRequested:false,
        recordQueue:[]
      };
      runs.set(storeId,run);
      publish(run);
      const description=stored.mode==='complaint'?stored.preview.description:'';
      void executeRun(run,description).catch(error=>{
        blockRun(run,describeError(error).message);
      });
      return {run:publicRun(run)};
    }
    if(action==='control'){
      const run=runs.get(storeId);
      if(!run)return {run:null};
      if(!['pause','resume','stop'].includes(p.action))throw new Error('不支持的控制动作');
      if(!['running','paused','challenge'].includes(run.state))return {run:publicRun(run)};
      if(p.action==='pause'){
        run.pauseRequested=true;
        if(run.state==='running')run.state='paused';
      }else if(p.action==='resume'){
        run.pauseRequested=false;
        run.state='running';
        run.notice='';
        run.wake?.();
      }else{
        run.stopRequested=true;
        run.wake?.();
      }
      publish(run);
      return {run:publicRun(run)};
    }
    if(action==='status')return {run:publicRun(runs.get(storeId)||null)};
    throw new Error('不支持的投诉打标操作');
  }

  return {handle,dispose:async()=>{disposed=true;for(const run of runs.values())run.stopRequested=true;}};
}

module.exports={createComplaintTagService};
