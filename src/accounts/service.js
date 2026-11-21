'use strict';
const {BACKENDS,STATUS_LABELS,accountPagesForBackend,backendForKind}=require('./authentication');
const {detectSellerName}=require('./detect-name');
const {resolveStoreLoginState}=require('./store-login-state');
const {createStoreSessionKeepAlive}=require('./session-keepalive');

const EXPLANATION='同一店铺的各功能共用本机登录会话；不同店铺相互隔离。平台可能要求首次授权、重新登录或安全验证。';
function backendState(kind,pages,checkedAt){
  const matching=accountPagesForBackend(pages,kind);
  const byStatus=status=>matching.find(page=>page.authentication?.status===status);
  const visibleByStatus=status=>matching.find(page=>page.visible&&page.authentication?.status===status);
  // 可见的验证/登录浮层必须优先（不能被更早打开的标签掩盖）；其次以“已登录”为准；
  // 不可见的旧登录页不能盖过已确认的登录（用户实测：已登录却显示“需要登录”，点进去页面其实是登录的）。
  const selected=visibleByStatus('verification-required')
    ||visibleByStatus('login-required')
    ||byStatus('verified')
    ||byStatus('verification-required')
    ||byStatus('login-required')
    ||byStatus('error')
    ||matching[0];
  return {kind,label:BACKENDS.find(item=>item.kind===kind).label,
    status:selected?.authentication?.status||'unknown',
    message:selected?.authentication?.message||(matching.length?'当前页面登录状态待确认。':'尚未打开；可先统一登录，再按需打开此后台。'),
    open:matching.length>0,visible:matching.some(page=>page.visible),checkedAt};
}
function storeCard(store,result){
  const checkedAt=new Date().toISOString();
  const backends=BACKENDS.map(({kind})=>backendState(kind,result.pages||[],checkedAt));
  const seller=backends.find(item=>item.kind==='seller');
  return {id:store.id,name:store.name,status:seller.status,label:STATUS_LABELS[seller.status],checkedAt,backends};
}
// resultTtlMs：一次“已确认”的登录检查结果可以复用多久。用户实测：60 秒太短，
// 每次回到店铺登录页都在重新检查、看起来“一直在检测”。改为 5 分钟后后台保活会再复核。
function createAccountService(ctx,{now=()=>Date.now(),resultTtlMs=300000,autoRetryMs=10000,keepAlive=true,keepAliveMinMs,keepAliveMaxMs,random=Math.random}={}){
  // Results are short-lived observations for this process, never a persisted
  // "logged in" flag. Navigation invalidates them, as does every app restart.
  const results=new Map(),pending=new Map(),attempts=new Map(),generations=new Map(),signingIn=new Set(),verificationHolds=new Map(),quickCache=new Map();
  const canProbe=typeof ctx.browser.checkLogin==='function';
  const canQuick=typeof ctx.browser.quickLogin==='function';
  let disposed=false;
  const revision=id=>ctx.browser.accountRevision?.(id)||0;
  const generation=id=>generations.get(id)||0;
  const invalidate=id=>{generations.set(id,generation(id)+1);results.delete(id);attempts.delete(id);quickCache.delete(id);};
  const exists=id=>{try{return !!ctx.getStore(id);}catch{return false;}};
  // 后台保活：已登录店铺每 5–10 分钟复核一次（定时器 unref，不阻止退出；
  // 回调内部由 probe() 自行去重、暂停与取消）。
  const keepalive=keepAlive===false?null:createStoreSessionKeepAlive({
    run:storeId=>{
      if(disposed||!exists(storeId)||signingIn.has(storeId)||verificationHolds.has(storeId)||pending.has(storeId))return;
      return probe(storeId);
    },
    ...(Number.isSafeInteger(keepAliveMinMs)?{minMs:keepAliveMinMs}:{}),
    ...(Number.isSafeInteger(keepAliveMaxMs)?{maxMs:keepAliveMaxMs}:{}),
    random,
  });
  keepalive?.start();
  const active=()=>{if(disposed)throw new Error('店铺账号服务已停止，请重新启动工作台。');};
  const recent=id=>{const result=results.get(id);return result&&result.revision===revision(id)&&result.generation===generation(id)&&now()-result.time<resultTtlMs?result:null;};
  const autoReady=id=>{const attempt=attempts.get(id);return !attempt||now()-(attempt.finishedAt??attempt.startedAt)>=autoRetryMs;};
  const checkedAt=()=>new Date(now()).toISOString();
  function holdVerification(storeId,kind){
    if(verificationHolds.get(storeId)?.kind===kind)return;
    verificationHolds.set(storeId,{kind,revision:revision(storeId),observedPending:false});invalidate(storeId);
    try{void Promise.resolve(ctx.browser.cancelLoginCheck?.(storeId)).catch(()=>{});}catch{}
  }
  function applyProbe(card,result,pages){
    if(!result)return card;
    const challenge=accountPagesForBackend(pages,'seller').some(page=>page.popup&&page.visible&&['login-required','verification-required'].includes(page.authentication?.status));
    if(challenge||card.status==='verification-required')return card;
    // A current independent check can detect expiry while an old business page
    // still displays cached account data. Its explicit negative result wins;
    // navigation revokes the probe through the revision check above.
    const authentication=result.authentication;
    const backends=card.backends.map(item=>item.kind==='seller'?{...item,status:authentication.status,message:authentication.message,checkedAt:authentication.checkedAt}:item);
    return {...card,status:authentication.status,label:STATUS_LABELS[authentication.status]||STATUS_LABELS.unknown,checkedAt:authentication.checkedAt,backends};
  }
  async function read(storeId){
    active();ctx.getStore(storeId);
    let snapshot,readFailed=false;
    try{snapshot=await ctx.browser.status(storeId);}catch{snapshot={pages:[]};readFailed=true;}
    active();const store=ctx.getStore(storeId);
    let base=storeCard(store,snapshot||{pages:[]});
    if(readFailed){
      const message='当前页面状态暂时无法读取，请检查登录或重新打开后台。';
      base={...base,status:'error',label:STATUS_LABELS.error,backends:base.backends.map(item=>item.kind==='seller'?{...item,status:'error',message}:item)};
    }
    const challenge=base.backends.find(backend=>backend.status==='verification-required');
    if(challenge)holdVerification(storeId,challenge.kind);
    const held=verificationHolds.get(storeId),heldBackend=held&&base.backends.find(backend=>backend.kind===backendForKind(held.kind));
    // Only current evidence for the challenged backend releases its pause;
    // an old green Qianniu card cannot clear a different backend's captcha.
    if(held&&heldBackend?.status!=='verified')held.observedPending=true;
    if(held&&!challenge&&heldBackend?.status==='verified'&&(held.observedPending||held.revision!==revision(storeId)))verificationHolds.delete(storeId);
    const card=await applyQuick(storeId,applyProbe(base,recent(storeId),snapshot?.pages||[])),verificationPaused=verificationHolds.has(storeId);
    keepalive?.update(storeId,canProbe&&card.status==='verified'&&!signingIn.has(storeId)&&!verificationPaused);
    return {...card,checking:pending.has(storeId)&&!signingIn.has(storeId)&&!verificationPaused,signingIn:signingIn.has(storeId),verificationPaused};
  }
  // “快速判断”：毫秒级结论——先看本店分区是否命中强登录 Cookie（只关心是否命中，
  // 不读取值）；命中就先显示“已登录（快速判断）”，后续由官方页面 DOM 证据或后台保活确认。
  async function quickSample(storeId){
    if(!canQuick||disposed)return null;
    const cached=quickCache.get(storeId);
    if(cached&&now()-cached.time<3000)return cached.sample;
    let sample=null;
    try{sample=await ctx.browser.quickLogin(storeId);}catch{sample=null;}
    if(disposed||!exists(storeId))return null;
    quickCache.set(storeId,{sample,time:now()});
    return sample;
  }
  async function applyQuick(storeId,card){
    if(!canQuick||!['unknown','error'].includes(card.status))return card;
    const sample=await quickSample(storeId);
    if(!sample)return card;
    const state=resolveStoreLoginState(sample);
    if(state.status!=='logged-in')return card;
    const at=typeof sample.checkedAt==='string'&&Number.isFinite(Date.parse(sample.checkedAt))?new Date(sample.checkedAt).toISOString():checkedAt();
    const message=state.reason==='auth-cookie'
      ?'已登录（快速判断）：命中本机登录凭据；后台会用官方页面继续确认。'
      :'已登录（快速判断）：页面地址位于官方工作台；后台会用官方页面继续确认。';
    return {...card,status:'verified',label:'已登录（快速判断）',quick:true,checkedAt:at,message,
      backends:card.backends.map(item=>item.kind==='seller'?{...item,status:'verified',message,checkedAt:at}:item)};
  }
  function probe(storeId){
    ctx.getStore(storeId);
    if(!canProbe||disposed||signingIn.has(storeId)||verificationHolds.has(storeId))return Promise.resolve();
    if(pending.has(storeId))return pending.get(storeId);
    const started=revision(storeId),startedGeneration=generation(storeId);
    const attempt={startedAt:now(),finishedAt:null,outcome:'running'};
    attempts.set(storeId,attempt);
    const task=Promise.resolve().then(()=>{
      // A login may reserve this store before this scheduled probe starts.
      if(disposed||!exists(storeId)||signingIn.has(storeId)||verificationHolds.has(storeId)||startedGeneration!==generation(storeId))return {cancelled:true};
      return ctx.browser.checkLogin(storeId);
    }).then(authentication=>{
      if(disposed||!exists(storeId))return;
      if(started!==revision(storeId)||startedGeneration!==generation(storeId)){attempt.outcome='superseded';return;}
      if(authentication?.cancelled){attempt.outcome='cancelled';return;}
      if(!Object.hasOwn(STATUS_LABELS,authentication?.status))throw new Error('登录检查未返回有效结果');
      const timestamp=typeof authentication.checkedAt==='string'&&Number.isFinite(Date.parse(authentication.checkedAt))?new Date(authentication.checkedAt).toISOString():checkedAt();
      if(authentication.status==='verification-required')holdVerification(storeId,'seller');
      results.set(storeId,{authentication:{status:authentication.status,message:String(authentication.message||'登录状态检查已完成。'),checkedAt:timestamp},revision:started,generation:generation(storeId),time:now()});
      attempt.outcome='completed';
    }).catch(()=>{
      if(disposed||!exists(storeId))return;
      if(started!==revision(storeId)||startedGeneration!==generation(storeId)){attempt.outcome='superseded';return;}
      attempt.outcome='failed';
      results.set(storeId,{revision:started,generation:startedGeneration,time:now(),authentication:{status:'error',message:'登录检查未完成，请稍后重试。',checkedAt:checkedAt()}});
    }).finally(()=>{
      pending.delete(storeId);attempt.finishedAt=now();
      if(disposed||!exists(storeId)){results.delete(storeId);attempts.delete(storeId);generations.delete(storeId);return;}
      try{ctx.emit?.({module:'accounts',action:'checked',storeId});}catch{}
    });
    pending.set(storeId,task);return task;
  }
  async function check(storeId){
    ctx.getStore(storeId);
    const current=await read(storeId);if(verificationHolds.has(storeId))return current;
    if(canProbe)await probe(storeId);
    return read(storeId);
  }
  async function signIn(payload,backend=false,{signal,background=false}={}){
    const cancelled=(submitted=false)=>({status:'unknown',cancelled:true,submitted,message:'后台登录操作已取消；不会继续启动登录或重复提交。'});
    if(signal?.aborted)return cancelled();
    const store=ctx.getStore(payload.storeId),method=backend?'ensureBackend':'run';
    if(typeof ctx.autoLogin?.[method]!=='function')throw new Error('当前版本尚未提供本机账号自动登录，请手动登录。');
    if(signingIn.has(store.id)){
      const current=await read(store.id);
      return signal?.aborted?cancelled():{status:'unknown',message:'该店铺正在自动登录，请等待当前操作完成。',store:current};
    }
    signingIn.add(store.id);invalidate(store.id);
    let result,autoStarted=false;
    const abort=()=>{
      // Only the request owning this reservation may cancel its login work.
      // Before reserve starts, the checks after awaits prevent a late start.
      if(!autoStarted)return;
      try{void Promise.resolve(ctx.autoLogin.cancel?.(store.id)).catch(()=>{});}catch{}
    };
    signal?.addEventListener('abort',abort,{once:true});
    try{
      if(signal?.aborted)return cancelled();
      const oldProbe=pending.get(store.id);
      await ctx.browser.cancelLoginCheck?.(store.id);
      if(signal?.aborted)return cancelled();
      if(oldProbe){await oldProbe;if(signal?.aborted)return cancelled();}
      active();ctx.getStore(store.id);const current=await read(store.id);
      if(signal?.aborted)return cancelled();
      if(verificationHolds.has(store.id)){
        const held=verificationHolds.get(store.id);
        const heldPages=current.backends.filter(item=>item.kind===backendForKind(held.kind)&&item.open);
        const activeChallenge=heldPages.some(item=>item.status==='verification-required');
        // 用户明确点登录时把该店铺页面切到前台：能看到登录页或滑块，才能继续操作；
        // 如果该后台页面已打开、且当前没有任何验证元素（旧暂停已过期），解除暂停并按正常登录继续。
        if(!background)await ctx.browser.show(store.id,held.kind);
        if(signal?.aborted)return cancelled();
        // 仅当页面明确“需要登录”且没有验证元素时才解除旧暂停（过期的“已登录”绿页不能清暂停）。
        if(!activeChallenge&&heldPages.some(item=>item.status==='login-required')){
          verificationHolds.delete(store.id);
        }else{
          result={status:'verification-required',submitted:false,verificationKind:held.kind,message:'已把该店铺页面切到前台：请完成页面上的滑块/安全验证后，再点一次登录；自动登录已暂停。'};
        }
      }
      if(result===undefined){
        if(signal?.aborted)return cancelled();
        autoStarted=true;
        const operation=backend?ctx.autoLogin.ensureBackend({storeId:store.id,kind:payload.kind||'seller',...(background?{background:true}:{}),...(payload.purpose?{purpose:payload.purpose}:{}),...(payload.credentialId?{credentialId:payload.credentialId}:{})}):ctx.autoLogin.run(store.id,payload.credentialId);
        // Also covers a synchronous cancellation inside an implementation's
        // start callback, before its own active record was fully installed.
        if(signal?.aborted)abort();
        result=await operation;
      }
      if(result?.status==='verification-required')holdVerification(store.id,result.verificationKind||'seller');
      if(signal?.aborted)return cancelled(result?.submitted===true);
    }finally{signal?.removeEventListener('abort',abort);signingIn.delete(store.id);if(!disposed&&exists(store.id))invalidate(store.id);}
    const current=await read(store.id);
    return signal?.aborted?cancelled(result?.submitted===true):{...result,store:current};
  }
  function ensureBackend(payload={},options={}){
    active();
    const kind=payload.kind||'seller';if(!BACKENDS.some(backend=>backend.kind===backendForKind(kind)))throw new Error('不支持的店铺登录入口');
    return signIn({...payload,kind},true,options);
  }
  async function handle(action,payload={}){
    active();
    if(action==='load'||action==='refresh'){
      const allowed=Array.isArray(payload.allowedStoreIds)?new Set(payload.allowedStoreIds):null;
      const stores=(await ctx.listStores()).filter(store=>!allowed||allowed.has(store.id));
      const cards=await Promise.all(stores.map(async store=>{
        try{
          // The explicit refresh always rechecks, including green cards and
          // fresh cached observations. The browser probe owns concurrency.
          let card=await read(store.id);
          if(action==='refresh'&&!signingIn.has(store.id)&&!verificationHolds.has(store.id)){await probe(store.id);card=await read(store.id);}
          if(action==='load'&&canProbe&&!signingIn.has(store.id)&&!verificationHolds.has(store.id)&&!recent(store.id)&&['unknown','error'].includes(card.status)&&autoReady(store.id)){
            void probe(store.id);card.checking=true;
          }
          // 快速判断命中时也在后台立即复核：真登录会在几秒内升级为“已确认”，
          // 误判（例如只命中匿名跟踪 Cookie）会在几秒内纠正为真实状态，而不是干等保活。
          if(action==='load'&&canProbe&&card.quick===true&&!signingIn.has(store.id)&&!verificationHolds.has(store.id)&&!recent(store.id)&&autoReady(store.id)&&!pending.has(store.id)){
            void probe(store.id);
          }
          return card;
        }catch(error){if(disposed||!exists(store.id))return null;throw error;}
      }));
      return {stores:cards.filter(Boolean),message:EXPLANATION};
    }
    if(action==='open'){
      const store=ctx.getStore(payload.storeId),kind=payload.kind||'seller';
      if(!BACKENDS.some(backend=>backend.kind===kind))throw new Error('不支持的店铺登录入口');
      if(typeof ctx.autoLogin?.ensureBackend==='function')return signIn({...payload,kind},true);
      await ctx.browser.show(store.id,kind);
      return {store:await read(store.id)};
    }
    if(action==='autoLogin')return signIn(payload);
    if(action==='ensureBackend')return ensureBackend(payload);
    if(action==='check'){
      if(signingIn.has(payload.storeId))return {store:await read(payload.storeId),message:'该店铺正在自动登录，请等待当前操作完成后再检查。'};
      const store=await check(payload.storeId),seller=store.backends.find(item=>item.kind==='seller');
      if(verificationHolds.has(payload.storeId))return {store,message:'此店铺正在等待官方安全验证，已暂停后台登录检查；请在原页面手动完成。'};
      if(signingIn.has(payload.storeId))return {store,message:'该店铺正在自动登录，请等待当前操作完成后再检查。'};
      const outcome=attempts.get(payload.storeId)?.outcome;
      const explanation=outcome==='cancelled'?'本次登录检查已取消，请重新检查。':outcome==='superseded'?'检查期间页面发生跳转，旧检查结果未采用，请在页面稳定后重新检查。':seller?.message||'';
      return {store,message:`${store.name}：${store.label}。${explanation}`};
    }
    if(action==='detectName'){
      // Only the store's own seller page may supply a display name. Nothing is
      // persisted here; the caller decides whether to adopt the observation.
      const store=ctx.getStore(payload.storeId);
      const page=ctx.browser.existingPage?.(store.id,'seller');
      const result=await detectSellerName(page,{now});
      active();
      return {storeId:store.id,name:result.name,message:result.message};
    }
    throw new Error('不支持的店铺账号操作');
  }
  return {handle,ensureBackend,readState:async storeId=>{active();ctx.getStore(storeId);return read(storeId);},dispose:()=>{disposed=true;keepalive?.stop();results.clear();attempts.clear();pending.clear();generations.clear();signingIn.clear();verificationHolds.clear();quickCache.clear();}};
}
module.exports={createAccountService,storeCard,EXPLANATION};
