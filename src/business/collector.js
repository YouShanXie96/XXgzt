'use strict';
// Independently validated sources are committed together, never partially.
const {createBusinessTransport}=require('./transport');
const {createSycmProvider}=require('./sources/sycm');
const {createDailyRangeReader}=require('./sources/sycm-supplement');
const {createFullSync,FullSyncError}=require('./full-sync');
const {runWithValidationPause}=require('./validation-gate');
const {createLoginWarmup}=require('./login-warmup');
const {sameSource,normalizedShopName,shopNamesMatch,dateList,validateRange}=require('./domain');
const labels={sycm:'生意参谋',promotion:'广告报表',billing:'保证金扣款',insurance:'运费险',refund:'客户之声退款',reviews:'评价',seller:'商品资料',marketing:'品牌新享',affiliate:'淘宝联盟商品佣金'};
const available=mode=>mode==='daily'?['sycm','promotion','billing','marketing','refund']:['sycm','promotion','marketing','refund'];
const fail=(code,message)=>{throw new FullSyncError(code,message)};
// A failure must name the source that stopped and keep any value-free
// diagnosis (for example the four finance signing-session categories) intact.
function labelSourceError(error,id){
 if(!(error instanceof FullSyncError))return error;
 if(error.sourceId===undefined){error.sourceId=id;error.sourceLabel=labels[id];}
 if(error.sourceLabel&&!String(error.message).startsWith(error.sourceLabel))error.message=`${error.sourceLabel}未完成：${error.message}`;
 return error;
}
function createBusinessCollector(ctx,options={}){
 // 需求5（本轮）：日报与精细化可以同时同步——两种模式各自用一套隐藏页面（product 模式加 -product 后缀），
 // 不会互相抢同一个页面；注入的测试替身（options.*）保持两种模式共用。
 const scopedPurpose=(base,mode)=>mode==='product'?`${base}-product`:base;
 const modeKey=mode=>mode==='product'?'product':'daily';
 const clock=options.scheduler?.now?{now:()=>new Date(options.scheduler.now())}:{};
 const built={};let disposed=false;
 function transport(mode){
  const key=modeKey(mode);
  if(!built['transport:'+key])built['transport:'+key]=options.transport||createBusinessTransport(ctx,{...options.transportOptions,purpose:scopedPurpose('business-sycm',mode)});
  return built['transport:'+key];
 }
 function runner(mode){
  const key=modeKey(mode);
  if(!built['runner:'+key])built['runner:'+key]=createFullSync({provider:options.provider||createSycmProvider(transport(mode)),...options.scheduler});
  return built['runner:'+key];
 }
 function daily(mode){
  const key=modeKey(mode);
  if(!built['daily:'+key])built['daily:'+key]=options.dailyReader||createDailyRangeReader(transport(mode),clock);
  return built['daily:'+key];
 }
 // 已注入的测试替身（options.*）：两种模式共用同一个实例。
 // 需求2：滑动验证等待参数与“来源 → 同步页面”的映射（把同一个隐藏页面弹出来给用户划）。
 const validationWaitMs=Math.max(60000,Math.min(30*60_000,Number(options.validationWaitMs)||8*60_000));
 const validationPollMs=Math.max(500,Math.min(10000,Number(options.validationPollMs)||2000));
 const validationNow=typeof options.validationNow==='function'?options.validationNow:Date.now;
 const validationWait=typeof options.validationWait==='function'?options.validationWait:undefined;
 // 需求3：登录预热（先登录、再隐藏、后读取）——页面要求登录时先补登录，确认后收起页面继续读取。
 const loginWarmup=options.loginWarmup||createLoginWarmup(ctx,options.loginWarmupOptions);
 // 注意：商品资料（seller）不在这里——它由经营数据服务单独读取（service.js），
 // 那里的滑动验证暂停/断点续读逻辑是独立的一份。
  const SOURCE_PAGES={sycm:{kind:'sycm',purpose:'business-sycm'},promotion:{kind:'promotion',purpose:'business-promotion'},marketing:{kind:'seller',purpose:'business-ppxk'},seller:{kind:'seller',purpose:'business-catalog'},refund:{kind:'seller',purpose:'business-finance'},billing:{kind:'seller',purpose:'business-finance'},insurance:{kind:'seller',purpose:'business-finance'}};
  // 需求5：按模式取来源页面（日报用原名，精细化用 -product 后缀的独立页面）。
  const sourcePage=(id,mode)=>{const base=SOURCE_PAGES[id];return base?{kind:base.kind,purpose:scopedPurpose(base.purpose,mode)}:null;};
 const active=new Set();
  function promotion(mode='daily'){
   if(options.promotionReader)return options.promotionReader;
   const key='promotion:'+modeKey(mode),purpose=scopedPurpose('business-promotion',mode);
   if(!built[key+':transport'])built[key+':transport']=options.promotionTransport||require('./promotion-transport').createPromotionTransport(ctx,{...options.promotionTransportOptions,purpose});
   if(!built[key+':reader'])built[key+':reader']=require('./sources/promotion-range').createPromotionRangeReader(built[key+':transport'],clock);
   return built[key+':reader'];
 }
 // 品牌新享（营销费用）由 ppxk 数据中心按日读取；旧版“收支账单”读取仍保留给已注入账单传输的场景与历史明细。
  function marketing(mode='daily'){
   if(options.marketingReader)return options.marketingReader;
   const key='marketing:'+modeKey(mode),purpose=scopedPurpose('business-ppxk',mode);
   if(!built[key+':transport'])built[key+':transport']=options.ppxkTransport||require('./ppxk-transport').createPpxkTransport(ctx,{...options.ppxkTransportOptions,purpose});
   if(!built[key+':reader'])built[key+':reader']=require('./sources/ppxk-range').createPpxkRangeReader(built[key+':transport']);
   return built[key+':reader'];
 }
 function finance(mode){
   const injected=mode==='product'?options.productRefundReader:options.financeReader;
   if(injected)return injected;
   const key='finance:'+modeKey(mode);
   if(!built[key+':transport'])built[key+':transport']=options.financeTransport||require('./finance-transport').createFinanceTransport(ctx,{...options.financeTransportOptions,purpose:scopedPurpose('business-finance',mode),ppxkPurpose:scopedPurpose('business-ppxk',mode)});
   if(!built[key+':reader'])built[key+':reader']=mode==='product'
     ?require('./sources/product-refund-range').createProductRefundReader(built[key+':transport'],clock)
     :require('./sources/finance-range').createFinanceRangeReader(built[key+':transport'],clock);
   return built[key+':reader'];
 }
  function promotionTransportFor(mode='daily'){
   if(options.promotionTransport)return options.promotionTransport;
   promotion(mode);
   return built['promotion:'+modeKey(mode)+':transport'];
  }
 function check(request){if(disposed)fail('COLLECTOR_DISPOSED','经营数据服务已停止');if(request.signal?.aborted)fail('CANCELED','同步已取消');}
 async function verificationGuard(request){
  if(!ctx.readAccountState)return;
  const state=await ctx.readAccountState(request.storeId);check(request);
  if(state?.verificationPaused||state?.backends?.some(item=>item.status==='verification-required')){
   // 账户级“等待验证”没有明确页面可弹出，保持原有的停止行为（不进入滑动等待流程）。
   const error=new FullSyncError('USER_VALIDATION_REQUIRED','当前店铺有后台正在等待安全验证，已停止所有经营来源的同步');
   error.guard=true;throw error;
  }
 }
 // 每种来源用自己的浏览器标签（商品资料/品牌新享/账单/生意参谋/推广），同步时能分别在“店铺浏览器”里看到。
 // 需求5：按模式取登录/同步用页面（精细化用 -product 后缀的独立页面，和日报互不抢页面）。
 const syncPurpose=(kind,mode)=>scopedPurpose(kind==='seller'?'business-catalog':(kind==='promotion'?'business-promotion':'business-sycm'),mode);
  async function ready(request,kind='sycm',purpose,id,notify,repairedTracker){
  if(!ctx.ensureBackend)return;
   // 需求5：按请求模式取页面（精细化用带 -product 的独立页面）。
   const pagePurpose=purpose||syncPurpose(kind,request.mode);
   const sourceLabel=labels[id]||'该来源';
  const retryMs=Math.max(10,Math.min(5000,Number(options.accountRetryMs)||4000));
  // 只有生意参谋需要在这里反复确认（它的读取必须先有“已确认登录”）。其余来源的传输层
  // 自己会精确核对页面身份与登录态（各自带等待与明确报错），在这里重试只会让排队更久：
  // 用户实测广告报表/客户之声退款卡在“正在核对登录会话”几十秒就是被这些重试拖出来的。
  const configuredRetries=Math.max(0,Math.min(5,Number.isSafeInteger(options.accountRetries)?options.accountRetries:2));
  const retries=kind==='sycm'?configuredRetries:0;
  // 生意参谋页面可能刚刚才被创建：给它一个总时间预算（默认 45 秒），
  // 页面还在渲染时就多等一轮，避免“首屏还没出来就判成尚未确认”直接失败。
  const readyDeadline=Date.now()+(Number.isFinite(options.accountReadyTimeoutMs)?Math.max(5000,Math.min(180000,options.accountReadyTimeoutMs)):45000);
  let auth=null;
  for(let attempt=0;;attempt++){
     auth=await ctx.ensureBackend({storeId:request.storeId,kind,purpose:pagePurpose},{signal:request.signal,background:true});check(request);
    if(auth.cancelled)fail('CANCELED','同步已取消');
    if(auth.status==='verification-required'||auth.store?.verificationPaused||auth.store?.backends?.some(backend=>backend.status==='verification-required')){
     const error=new FullSyncError('USER_VALIDATION_REQUIRED',`${sourceLabel}页面要求安全验证：已把正在同步的页面显示出来，请完成滑块/验证后会自动继续`);
     error.sourceId=id;error.reveal={kind,purpose:pagePurpose};
     throw error;
    }
    // 页面明确要求登录：跳出重试循环，走下面的“登录预热”（先补登录，再隐藏，后读取）。
    if(auth.status==='login-required')break;
    // ensureBackend may finish during initial DOM load; its subsequent card read
    // is newer evidence. Accept only the selected backend's explicit success.
    if(auth.status==='verified'||auth.store?.backends?.some(item=>item.kind===kind&&item.status==='verified'))break;
    if(attempt>=retries)break;
    if(kind==='sycm'&&Date.now()>=readyDeadline)break;
    // 刚启动的第一次同步：后台页首屏可能还没渲染完（unknown），等几秒再确认一次，
    // 避免“第一次同步失败、再点一次就好”的体验；登录失效/验证不会走这里（上面已直接停止）。
    await new Promise(resolve=>{const timer=setTimeout(resolve,retryMs);request.signal?.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
    check(request);
  }
   const confirmed=()=>auth.status==='verified'||auth.store?.backends?.some(item=>item.kind===kind&&item.status==='verified');
   // 需求3（对齐亿满分软件助手）：读取前先登录——页面要登录时先按官方流程补登录，
   // 确认登录后自动收起页面继续同步，读取过程中就不会再撞到登录页。
   if(!confirmed()&&auth.status==='login-required'){
    notify?.(`${sourceLabel}需要登录：正在先补登录，完成后自动继续同步`);
    if(id&&repairedTracker)repairedTracker.add(id);
     const repaired=await loginWarmup.ensure(request.storeId,kind,pagePurpose,{signal:request.signal,label:sourceLabel,probeResult:auth});
    check(request);
    if(repaired.cancelled||repaired.status==='cancelled')fail('CANCELED','同步已取消');
    if(repaired.status==='verification-required'){
     const error=new FullSyncError('USER_VALIDATION_REQUIRED',`${sourceLabel}页面要求安全验证：已把页面显示出来，请完成滑块/验证后会自动继续`);
     error.sourceId=id;error.reveal=repaired.reveal||{kind,purpose:pagePurpose};
     throw error;
    }
    if(repaired.status!=='verified')fail('LOGIN_EXPIRED',repaired.message||`${sourceLabel}需要登录：请先在店铺浏览器里完成登录后再同步`);
   }
   if(kind==='sycm'&&!confirmed())fail('LOGIN_UNCONFIRMED','后台登录尚未确认，未发起整店数据请求，请等待官方页面加载完成后再检查');
 }
 async function run(request){
  const store=ctx.getStore(request.storeId);check(request);
  if(!['daily','product'].includes(request.mode))fail('INVALID_MODE','经营数据类型无效');
  validateRange(request,new Date(options.scheduler?.now?.()??Date.now()));
  const sources=request.sources??['sycm'];
  if(!Array.isArray(sources)||!sources.length||sources.some(id=>!available(request.mode).includes(id))||new Set(sources).size!==sources.length)fail('SOURCE_UNAVAILABLE','所选来源尚未完成接入，请只选择可用来源');
  // 需求5（本轮）：同一家店的日报与精细化是两件独立任务，可以同时进行；
  // 只有“同店同模式”才会被判为重复（避免同一份数据被两个任务重复写入）。
  const activeKey=`${request.storeId}:${request.mode}`;
  if(active.has(activeKey))fail('SYNC_BUSY','当前店铺这个页签已有经营数据同步任务，请等待完成或取消');active.add(activeKey);
  const states=sources.map(id=>({id,status:'pending',current:0,total:0})),results=[];
  const progress=(id,detail={})=>{
   const state=states.find(item=>item.id===id);Object.assign(state,detail,{id});
   request.onProgress?.({...detail,sourceId:id,sources:states.map(item=>({...item})),message:detail.message||`正在读取${labels[id]}`});
  };
  try{
   // 用户要求：每个渠道同时同步（各自用独立的浏览器标签），进度分开显示；
   // 账单类来源共用同一个千牛页面（互斥），所以它们自己串行、与其它渠道并行。
   // 需求2：平台要求滑动验证时不中止整批——暂停等待用户完成，然后从断点自动继续。
   const parentSignal=request.signal;
   const takeHint=typeof request.takeValidationHint==='function'?request.takeValidationHint:()=>false;
   const pageContextFor=sourceId=>{
    const target=SOURCE_PAGES[sourceId];
    if(!target||typeof ctx.browser?.syncPageContext!=='function')return null;
    try{return ctx.browser.syncPageContext(request.storeId,target.kind,{purpose:target.purpose});}catch{return null;}
   };
   const execute=async()=>{
   const batch=new AbortController();
   const cancelBatch=()=>batch.abort();
   parentSignal?.addEventListener('abort',cancelBatch,{once:true});
   try{
   const scoped={...request,signal:batch.signal};
   const order=available(request.mode).filter(id=>sources.includes(id));
   // 精细化：商品资料先单独读完（它最容易触发平台限流），读完后才同步其它渠道，
   // 免得商品资料失败时白读一遍生意参谋/广告/品牌新享。
   if(request.mode==='product'&&order.includes('seller'))await runOne('seller');
   const restIds=order.filter(id=>!(request.mode==='product'&&id==='seller'));
   const serialIds=restIds.filter(id=>['billing','insurance','refund'].includes(id));
   const parallelIds=restIds.filter(id=>!serialIds.includes(id));
   // 登录/页面准备必须一个一个来：同时准备时第二个会被“该店铺正在自动登录”直接跳过，
   // 结果对应的标签页根本没被创建（账单读取就会报“需要正常千牛首页”）。读取本身仍然并行。
   let readiness=Promise.resolve();
   // 本批里已经为哪些来源补过登录（同一个来源最多补一次，避免死循环和白等）。
   const repairedSources=new Set();
   // 页面准备必须一个一个来（同一个店铺同时准备时，第二个会被“正在自动登录”跳过，
   // 页面就不会被创建）。排队中的来源显示“正在准备…页面”，轮到自己时才显示“正在核对…登录会话”，
   // 免得看起来像一直在核对登录。
   const prepareOnce=(id,kind,purpose)=>{const next=readiness.then(()=>{progress(id,{status:'running',message:`正在核对${labels[id]}的本店登录会话`});return ready(scoped,kind,purpose,id,message=>progress(id,{status:'running',message}),repairedSources);});readiness=next.then(()=>{},()=>{});return next;};
   const runOne=async id=>{
    for(let attempt=0;;attempt++){
     try{
      await verificationGuard(scoped);
      check(scoped);progress(id,{status:'running',message:`正在准备${labels[id]}页面`});
      const input={...scoped,onProgress:detail=>progress(id,{...detail,status:'running'})};let result;
      if(id==='sycm'){
       await prepareOnce('sycm','sycm',sourcePage('sycm',scoped.mode)?.purpose);check(scoped);
       result=await (scoped.mode==='daily'?daily(scoped.mode).readRange(input):runner(scoped.mode).run(input));
      }else if(id==='promotion'){
       // Reuse an existing official page without activating its browser tab.
       // Generic promotion probes may stay unknown; the transport still checks
       // exact page/account identity before reading any report.
       await prepareOnce('promotion','promotion',sourcePage('promotion',scoped.mode)?.purpose);check(scoped);await verificationGuard(scoped);
       const reader=promotion(scoped.mode);await promotionTransportFor(scoped.mode).prepare(scoped.storeId,scoped.signal);check(scoped);
       result=await reader.readRange(input);
      }else{
       await prepareOnce(id,'seller',sourcePage(id,scoped.mode)?.purpose);check(scoped);await verificationGuard(scoped);
       const reader=id==='marketing'?marketing(scoped.mode):finance(scoped.mode);check(scoped);
       result=await reader.readRange({...input,sourceKey:id});
      }
      check(scoped);
      if(!result?.source||!shopNamesMatch(result.source.shopName,store.name)||results.some(previous=>!sameSource(previous.result.source,result.source)))fail('SOURCE_MISMATCH','不同来源的后台店铺身份不一致，本次未保存');
      if(result.coverage?.complete!==true||result.coverage.dates?.join(',')!==dateList(scoped.start,scoped.end).join(','))fail('INCOMPLETE_SOURCE','来源未覆盖全部日期，本次未保存');
      results.push({id,result});progress(id,{status:'completed',current:result.rows.length,total:result.rows.length,message:`${labels[id]}已核对完整日期与记录，等待本批保存`});
      return;
     }catch(error){
      const labeled=labelSourceError(error,id);
      // 需求3：读取中途撞到登录页/登录失效时，先按亿满分的方式补登录一次，
      // 确认后自动从当前来源重试；仍然失败才让整批停下。
      // 需求（2026-10-13）：刚创建的后台页面偶发“还没注册好”就开读（报“请先打开并登录该店铺的xx”），
      // 这类页面缺失也走同一条自愈重试：补一次准备（会重新创建页面）后再读。
      if(attempt===0&&!batch.signal.aborted&&sourcePage(id,scoped.mode)&&!repairedSources.has(id)&&['LOGIN_EXPIRED','LOGIN_UNCONFIRMED','PAGE_REQUIRED'].includes(labeled?.code)){
       const target=sourcePage(id,scoped.mode);
       progress(id,{status:'running',message:`${labels[id]}需要登录：正在先补登录，完成后自动继续同步`});
       const repaired=await loginWarmup.ensure(request.storeId,target.kind,target.purpose,{signal:batch.signal,label:labels[id]});
       check(scoped);
       if(repaired.cancelled||repaired.status==='cancelled'){batch.abort();fail('CANCELED','同步已取消');}
       if(repaired.status==='verified')continue;
       if(repaired.status==='verification-required'){
        const validation=new FullSyncError('USER_VALIDATION_REQUIRED',`${labels[id]}页面要求安全验证：已把正在同步的页面显示出来，请完成滑块/验证后会自动继续`);
        validation.sourceId=id;validation.reveal=repaired.reveal||{kind:target.kind,purpose:target.purpose};
        batch.abort();throw validation;
       }
       // 页面明确要求登录且补登录没成功：按登录失效停下（保留来源自己的错误描述）。
       if(repaired.login===true){batch.abort();throw labelSourceError(new FullSyncError('LOGIN_EXPIRED',repaired.message||`${labels[id]}需要登录：请先在店铺浏览器里完成登录后再同步`),id);}
       // 页面不存在（刚创建还没注册好）时已经重新准备过一次，再读一次；第二次仍失败才停下。
       // 其它“尚未确认”保留来源自己的原始错误快速停下，不再多绕一轮。
       if(labeled?.code==='PAGE_REQUIRED')continue;
       batch.abort();throw labeled;
      }
      batch.abort();throw labeled;
     }
    }
   };
   const units=[...parallelIds.map(id=>runOne(id)),(async()=>{for(const id of serialIds)await runOne(id);})()];
   try{await Promise.all(units);}
   catch(error){
    // 先把并发中的其它读取全部停下来再让上层处理（滑动验证等待时页面不能同时被两批读取占用）。
    batch.abort();await Promise.allSettled(units);throw error;
   }
   // 并行读取完成顺序不确定，但合并必须按固定来源顺序进行，否则同一（日期,商品）
   // 会被不同来源以不同顺序覆盖，最后的一致性校验就会报错。
   results.sort((left,right)=>order.indexOf(left.id)-order.indexOf(right.id));
   check(scoped);
   const rows=new Map(),warnings=results.flatMap(item=>item.result.warnings||[]);
   for(const {result}of results)for(const row of result.rows){
    const key=`${row.date}:${row.productId||''}`,previous=rows.get(key);
    rows.set(key,previous?{...previous,...row,title:previous.title||row.title||'',category:previous.category||row.category||''}:{...row});
   }
   const output=[...rows.values()],dates=dateList(request.start,request.end),ads=results.find(item=>item.id==='promotion')?.result;
   const coverage=results.length===1?results[0].result.coverage:{scope:'full',complete:true,dates,expectedDays:dates.length,rowCount:output.length};
   const sourceCoverage=Object.keys(labels).map(id=>{
    const completed=results.some(item=>item.id===id);
    if(!completed)return {key:id,status:available(request.mode).includes(id)?'not-selected':'unavailable',message:id==='affiliate'&&request.mode==='daily'&&sources.includes('sycm')?'日报淘宝客佣金由生意参谋趋势提供；商品淘宝联盟按本次要求暂不接入':'本批未读取该来源，相关指标留空'};
    const result=results.find(item=>item.id===id).result;
    const metrics=result.metrics||(id==='promotion'?['adSpend','adRevenue','adRoi',...(request.mode==='product'?['siteAdSpend','sitePromotion']:[])]:['visitors','pageViews','buyers','payAmount','conversionRate','unitPrice','searchVisitors','refundAmount',...(request.mode==='daily'?['affiliateCommission']:['cartItems','title'])]);
    return {key:id,status:'completed',start:request.start,end:request.end,metrics,message:id==='sycm'?'生意参谋官方原始指标，未扣除操作单':id==='promotion'?'广告各报表独立读取，详情见广告来源明细':id==='marketing'?'品牌新享数据中心按日读取总预估费用；金额未回写账房，实际加速费用仍以账房为准':id==='billing'?'完整现金及各保险保单支出，排除充值；原始流水见来源明细':'客户之声原始退款笔数、金额与订单分母，详见来源明细'};
   });
   warnings.push('采购、操作单、人工费用及全部利润指标未计算；未接入和未选择的指标留空。','销售额、买家数为店铺官方原始口径，尚未扣除操作单；不可直接与扣操作单后的参考值比较。');
   if(request.mode==='product')warnings.push('精细化按日期保存商品记录；访客和买家不能累加成区间去重人数。未提供的类目名称、上架时间保持为空；缺少已核实的区间退款分母时，退款率留空。');
   const sycm=results.find(item=>item.id==='sycm')?.result;
   const financeSources=results.flatMap(item=>item.result.financeSource?[item.result.financeSource]:[]);
   return {rows:output,source:results[0].result.source,coverage,sourceCoverage,warnings:[...new Set(warnings)],...(ads?{adSources:{rows:ads.sourceRows,coverage:ads.perDate}}:{}),...(sycm?{sycmCoverage:sycm.coverage}:{}),...(financeSources.length?{financeSources}:{})};
   }finally{parentSignal?.removeEventListener('abort',cancelBatch);}
   };
   // 需求2：滑动验证时暂停整批、把正在使用的页面弹出来，完成后从断点自动继续；
   // 超时（默认 8 分钟）则停下并保留断点。
   // error.reveal 指向“补登录时真正弹出/需要滑块的页面”（有时是登录入口页，而不是同步页）。
   const revealContext=error=>{
    const reveal=error?.reveal;
    if(reveal&&typeof ctx.browser?.syncPageContext==='function'){
     try{return ctx.browser.syncPageContext(request.storeId,reveal.kind,reveal.purpose?{purpose:reveal.purpose}:{});}catch{}
    }
    return error?.sourceId?pageContextFor(error.sourceId):null;
   };
   return await runWithValidationPause({execute,pageContext:revealContext,
    takeHint,timeoutMs:validationWaitMs,intervalMs:validationPollMs,now:validationNow,wait:validationWait,signal:parentSignal,
    emit:event=>request.onProgress?.({storeId:request.storeId,mode:request.mode,status:'running',...event})});
   }finally{active.delete(activeKey);}
 }
 async function open({storeId,backend='sycm'}){
  ctx.getStore(storeId);if(!['sycm','promotion'].includes(backend))throw new Error('不支持的经营后台');if(disposed)throw new Error('经营数据服务已停止');
  if(ctx.ensureBackend)return ctx.ensureBackend({storeId,kind:backend});
  await ctx.browser.show(storeId,backend);return {opened:true,backend};
 }
    const capabilities=Object.fromEntries(['daily','product'].map(mode=>[mode,{sync:true,verified:true,message:'按所选日期与来源读取当前店铺；验证、登录失效或数据不完整时停止并保留旧数据。',sources:Object.entries(labels).map(([id,label])=>({id,label,sync:available(mode).includes(id)||id==='seller'&&mode==='product',verified:available(mode).includes(id)||id==='seller'&&mode==='product',message:id==='sycm'?(mode==='daily'?'最近31个完整日；含搜索访客、退款及淘客佣金':'逐日完整商品列表；含状态原文和类目ID'):id==='promotion'?'复用本店推广登录，保留广告报表各自口径':id==='billing'?(mode==='daily'?'现金与各保险保单完整流水，按分转元、排除充值':'无商品归属，不能摊入单品'):id==='marketing'?(mode==='daily'?'品牌新享数据中心“佣金数据汇总”的每日总预估费用（约每日14点前更新昨日数据）':'品牌新享“商品维度”里每个商品的预估费用，按天累加到精细化'):id==='refund'?(mode==='daily'?'保留各退款场景及支付订单分母，不覆盖生意参谋退款额':'逐日完整退款商品；缺少区间支付订单分母时退款率留空'):id==='seller'?(mode==='product'?'先读天猫商家中心“商品管理”全部宝贝（每页20条自动翻完，约72页）：商品ID、标题、状态、创建时间；页面没有类目列，类目仍取生意参谋。':'商品资料是整店清单，只在“精细化”同步里读取'):['reviews','affiliate'].includes(id)?'按本次要求暂不接入':'尚未核实完整来源，暂不能同步'}))}]));
 return {run,open,capabilities,dispose:async()=>{disposed=true;for(const instance of Object.values(built)){if(instance&&typeof instance.dispose==='function'){try{await instance.dispose();}catch{}}}for(const injected of [options.transport,options.promotionTransport,options.financeTransport,options.ppxkTransport]){if(injected&&typeof injected.dispose==='function'){try{await injected.dispose();}catch{}}}}};
}
module.exports={createBusinessCollector};
