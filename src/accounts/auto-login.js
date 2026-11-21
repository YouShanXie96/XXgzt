'use strict';
const {inspectAuthentication,BACKENDS,backendForKind}=require('./authentication');
const {loginAdapterForUrl}=require('./login-adapters');
const STOPPED=Symbol('stopped');
function trustedLogin(value){return !!loginAdapterForUrl(value);}
function readFrameUrl(frame){try{return frame.url||'';}catch{return '';}}
function loginFrames(wc){
  try{return [...new Set([wc.mainFrame,...(wc.mainFrame?.framesInSubtree||[])])].filter(frame=>frame&&trustedLogin(readFrameUrl(frame))&&typeof frame.executeJavaScript==='function');}catch{return [];}
}
function wait(ms,signal){return new Promise(resolve=>{if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});}
function bounded(promise,signal,ms=1800){
  if(signal.aborted)return Promise.resolve(STOPPED);
  return new Promise(resolve=>{
    const done=value=>{clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(value);};
    const abort=()=>done(STOPPED),timer=setTimeout(abort,ms);signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(done,()=>done(STOPPED));
  });
}

// The main process supplies a matched, exact official page adapter. Recheck its
// origin/path and current document inside the frame before touching any field.
function loginPageAction(packet){
  const safe={submitted:false};
  const adapter=packet.adapter;
  const current=()=>adapter&&location.origin===adapter.origin&&(!adapter.path||new URL(location.href).pathname===adapter.path)&&location.href===packet.expectedHref&&Date.now()<=packet.expiresAt;
  if(!current())return {...safe,reason:'navigation'};
  const visible=node=>{
    if(!node?.isConnected||![...node.getClientRects()].some(rect=>rect.width>0&&rect.height>0))return false;
    for(let item=node;item&&item.nodeType===1;item=item.parentElement){const style=getComputedStyle(item);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.opacity==='0')return false;}
    return true;
  };
  const active=selector=>[...document.querySelectorAll(selector)].filter(visible);
  const challenge=()=>active('.nc-container,#nc_1_wrapper,[id^="baxia-dialog"],iframe[src*="captcha"],iframe[src*="punish"],input[autocomplete="one-time-code"],input[name="smsCode"],input[name="smscode"],input[name="fm-smscode"]').length>0||/请完成安全验证|请拖动滑块|拖动下方滑块|输入短信验证码|安全验证中/.test(String(document.body?.innerText||'').slice(0,60000));
  if(challenge())return {...safe,reason:'verification'};
  let username,password,form,submit,selectors;
  const exactForms=adapter.form?active(adapter.form):null;
  for(const pair of adapter.fields){
    const users=active(pair.username),passwords=active(pair.password);
    if(users.length!==1||passwords.length!==1)continue;
    const a=users[0],b=passwords[0],owner=a.form;
    if(!(a instanceof HTMLInputElement)||!(b instanceof HTMLInputElement)||b.type!=='password'||!['text','email','tel'].includes(a.type)||!owner||owner!==b.form)continue;
    if(exactForms&&(exactForms.length!==1||owner!==exactForms[0]))continue;
    const buttons=[...owner.querySelectorAll(adapter.submit)].filter(node=>visible(node)&&node.form===owner);
    if(buttons.length!==1)continue;
    username=a;password=b;form=owner;submit=buttons[0];selectors=pair;break;
  }
  if(!form){
    const candidates=active(adapter.passwordSwitch).filter(node=>['账号密码登录','账户密码登录','密码登录'].includes(String(node.innerText||node.textContent||'').replace(/\s+/g,'')));
    if(packet.mode==='switch'&&candidates.length===1&&current()&&!challenge()){HTMLElement.prototype.click.call(candidates[0]);return {...safe,reason:'switched'};}
    return {...safe,reason:candidates.length===1?'password-mode':'unsupported'};
  }
  const allowedForm=()=>{
    if(!current()||!form.isConnected||username.form!==form||password.form!==form||submit.form!==form||username.disabled||password.disabled||username.readOnly||password.readOnly||submit.disabled||submit.getAttribute('aria-disabled')==='true')return false;
    const users=active(selectors.username),passwords=active(selectors.password),buttons=[...form.querySelectorAll(adapter.submit)].filter(visible);
    if(users.length!==1||users[0]!==username||passwords.length!==1||passwords[0]!==password||buttons.length!==1||buttons[0]!==submit||password.type!=='password'||!['text','email','tel'].includes(username.type))return false;
    if(adapter.form){const forms=active(adapter.form);if(forms.length!==1||forms[0]!==form||submit.type!=='submit')return false;}
    try{
      const formUrl=new URL(form.getAttribute('action')||location.href,location.href);
      const submitUrl=new URL(submit.getAttribute('formaction')||formUrl.href,location.href);
      if([formUrl,submitUrl].some(url=>url.origin!==adapter.origin||url.username||url.password))return false;
      const explicitMethod=String(submit.getAttribute('formmethod')||form.getAttribute('method')||'').toLowerCase();
      if(adapter.submission==='guarded-ajax'){
        if(explicitMethod&&explicitMethod!=='post')return false;
      }else if(submit.type!=='button'&&explicitMethod!=='post')return false;
    }catch{return false;}
    return true;
  };
  if(!allowedForm())return {...safe,reason:'unsafe-form'};
  const agreement=[...form.querySelectorAll('input[type="checkbox"]')].some(box=>visible(box)&&!box.checked&&(box.required||/同意|阅读|协议|隐私|条款/.test([...box.labels||[]].map(label=>label.innerText||label.textContent||'').join(' '))));
  if(agreement)return {...safe,reason:'agreement'};
  if(packet.mode!=='submit')return {...safe,reason:'ready'};
  if(typeof packet.username!=='string'||typeof packet.password!=='string'||!packet.username||!packet.password)return {...safe,reason:'credentials'};
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
  if(!setter)return {...safe,reason:'unsupported'};
  const clear=()=>{setter.call(username,'');setter.call(password,'');};
  const fill=(node,value)=>{setter.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
  if(!allowedForm()||challenge())return {...safe,reason:'verification'};
  fill(username,packet.username);
  if(!allowedForm()||challenge()){clear();return {...safe,reason:'changed'};}
  fill(password,packet.password);
  if(!allowedForm()||challenge()){clear();return {...safe,reason:'changed'};}
  if(adapter.submission==='guarded-ajax'){
    // Preserve the platform's click handler and AJAX request, but do not permit
    // this method-less form to fall back to a credential-bearing native GET.
    const preventNativeSubmit=event=>event.preventDefault();
    form.addEventListener('submit',preventNativeSubmit,true);
    try{HTMLElement.prototype.click.call(submit);}finally{form.removeEventListener('submit',preventNativeSubmit,true);}
  }else HTMLElement.prototype.click.call(submit);
  return {submitted:true,reason:'submitted'};
}
function actionScript(mode,expectedHref,credential){
  return `(${loginPageAction.toString()})(${JSON.stringify({mode,expectedHref,adapter:loginAdapterForUrl(expectedHref),expiresAt:Date.now()+1800,...credential})})`;
}
function response(status,message,submitted=false,extra={}){return {status,message,submitted,...extra};}
// backgroundWaitMs：后台只读检查时等页面把“已登录证据”渲染出来。
// 用户实测：刚打开软件/刚建页面时，生意参谋首页要 15 秒以上才渲染出店名与菜单，
// 8 秒会判成“尚未确认”导致同步直接失败，这里放宽到 20 秒（只在页面还没就绪时等待）。
function createAutoLogin({browser,credentials,formWaitMs=15000,resultWaitMs=6000,pollMs=200,credentialWaitMs=5000,backgroundWaitMs=20000}){
  const active=new Map(),selectedAccounts=new Map();let disposed=false,disposePromise;
  async function execute(frame,mode,signal,credential){
    const url=readFrameUrl(frame);if(!trustedLogin(url)||signal.aborted)return STOPPED;
    return bounded(Promise.resolve().then(()=>frame.executeJavaScript(actionScript(mode,url,credential),true)),signal);
  }
  const cancelled=()=>response('unknown','自动登录已取消。',false,{cancelled:true});
  async function perform(storeId,credentialId,signal,prepared){
    let submitted=false,attempted=false;
    try{
      const wc=prepared?.wc||await bounded(Promise.resolve().then(()=>browser.show(storeId,'seller')),signal,30000);
      if(wc===STOPPED)return signal.aborted?cancelled():response('unknown','店铺页面尚未准备好，请打开后台后重试。');
      const initial=prepared?.authentication||await bounded(inspectAuthentication(wc,'seller'),signal);
      if(signal.aborted)return cancelled();
      if(initial?.status==='verified')return response('verified','该店铺当前已登录，已打开后台。');
      if(initial?.status==='verification-required')return response('verification-required','请在官方页面完成安全验证。');
      // 官方登录页默认是扫码登录：要先点“账号密码登录”才会出现密码表单。
      // 页面刚开始加载时第一次点击可能落空，所以最多补点 3 次（每次间隔一个轮询周期）。
      let selected=null,switchAttempts=0;const deadline=Date.now()+formWaitMs;
      while(!selected&&Date.now()<deadline&&!signal.aborted){
        for(const frame of loginFrames(wc)){
          const state=await execute(frame,'inspect',signal);
          if(state?.reason==='verification')return response('verification-required','请在官方页面完成验证码或短信验证。');
          if(state?.reason==='agreement')return response('unknown','请先阅读并自行确认官方登录协议。');
          if(state?.reason==='unsafe-form')return response('unknown','当前登录表单无法安全确认，请手动登录。');
          if(state?.reason==='ready'){selected=frame;break;}
          if(state?.reason==='password-mode'&&switchAttempts<3){switchAttempts++;await execute(frame,'switch',signal);await wait(pollMs,signal);}
        }
        if(!selected)await wait(pollMs,signal);
      }
      if(signal.aborted)return cancelled();
      if(!selected)return response('unknown','未找到支持的官方账号密码表单，请在页面切换到密码登录或手动登录。');
      let credentialWindowOpen=true;
      const access=await bounded(Promise.resolve().then(()=>credentials.withCredential(storeId,credentialId,async credential=>{
        if(!credentialWindowOpen||signal.aborted)return STOPPED;
        if(!credential||typeof credential.username!=='string'||typeof credential.password!=='string'||!credential.username||!credential.password||credential.username.length>256||credential.password.length>4096)return {reason:'credentials'};
        attempted=true;return execute(selected,'submit',signal,{username:credential.username,password:credential.password});
      })).then(value=>({ok:true,value}),()=>({ok:false})),signal,credentialWaitMs);
      // A vault response that arrives after this request has finished must never
      // turn a reported timeout into an unobserved, delayed form submission.
      credentialWindowOpen=false;
      if(signal.aborted)return response('unknown','自动登录已停止，请查看官方页面结果。',access?.value?.submitted===true,{cancelled:true});
      if(access!==STOPPED&&!access.ok)return response('error','本机账号无法读取，请检查保存的账号配置。');
      const filled=access===STOPPED?STOPPED:access.value;
      if(filled===STOPPED)return response('unknown',attempted?'已尝试登录，请查看官方页面确认结果；不会重复提交。':'本机账号尚未准备好，请检查保存的账号配置后重试。',false,{attempted});
      submitted=filled?.submitted===true;
      if(!submitted){
        if(filled?.reason==='verification'||filled?.reason==='changed')return response('verification-required','页面出现验证或发生变化，请在官方页面继续操作。');
        return response('unknown','自动登录未提交，请检查账号配置或手动操作当前官方表单。');
      }
      const finishAt=Date.now()+resultWaitMs;
      while(Date.now()<finishAt&&!signal.aborted){
        const state=await bounded(inspectAuthentication(wc,'seller'),signal);
        if(state?.status==='verified')return response('verified','官方页面已确认登录。',true);
        if(state?.status==='verification-required')return response('verification-required','登录已提交，请在官方页面完成安全验证。',true);
        for(const frame of loginFrames(wc)){const state=await execute(frame,'inspect',signal);if(state?.reason==='verification')return response('verification-required','登录已提交，请在官方页面完成验证码或短信验证。',true);}
        await wait(pollMs,signal);
      }
      return signal.aborted?response('unknown','登录操作已停止，请查看官方页面结果。',submitted,{cancelled:true}):response('unknown','已点击登录，尚未确认成功；请查看官方页面提示，不会自动重试。',true);
    }catch{return response('error','自动登录未完成，请检查本机账号配置并在官方页面继续操作。',submitted,{attempted});}
  }
  async function ensure(storeId,kind,credentialId,signal,background=false,purpose){
    let submitted=false;
    const needsManual=message=>response('unknown',message,false,{kind,needsCredential:true});
    // A first sync after reopening may create its normal official entry page
    // with the saved session, but cannot activate tabs or submit credentials.
    if(background){
      const label=BACKENDS.find(backend=>backend.kind===backendForKind(kind))?.label||'后台';
      try{
        if(signal.aborted)return cancelled();
        const wc=await bounded(Promise.resolve().then(()=>signal.aborted?STOPPED:browser.page(storeId,kind,{show:false,...(purpose?{purpose,background:true}:{})})),signal,30000);
        if(signal.aborted)return cancelled();
        if(wc===STOPPED||!wc||wc.isDestroyed?.())return response('unknown',`本店${label}页面尚未准备好，请稍后重试或手动打开后台检查。`,false,{kind,background:true,needsManual:true});
        let authentication=await bounded(inspectAuthentication(wc,kind),signal);
        const deadline=Date.now()+backgroundWaitMs;
        // SPA headers may arrive after dom-ready. Wait for page evidence only;
        // no navigation, reload, network probe, or credential attempt occurs.
        while(authentication?.status==='unknown'&&!authentication.checkFailed&&!signal.aborted&&Date.now()<deadline){
          await wait(Math.min(Math.max(pollMs,200),Math.max(1,deadline-Date.now())),signal);
          if(signal.aborted)return cancelled();
          authentication=await bounded(inspectAuthentication(wc,kind),signal);
        }
        if(signal.aborted)return cancelled();
        const status=authentication?.status||'unknown';
        return response(status,status==='verified'?'已在后台复用本店页面会话。':status==='verification-required'?`本店${label}需要安全验证，已停止同步；请在原后台页面手动处理。`:status==='login-required'?`本店${label}需要登录，请在店铺登录中打开后台完成登录后再同步。`:`本店${label}页面尚未确认，请先手动打开并检查页面后再同步。`,false,
          {kind,background:true,needsManual:status!=='verified',...(status==='verification-required'?{verificationKind:kind}:{})});
      }catch{return response('error',`本店${label}页面读取未完成，请手动打开后台检查后再同步。`,false,{kind,background:true,needsManual:true});}
    }
    async function open(targetKind){
      const wc=await bounded(Promise.resolve().then(()=>browser.show(storeId,targetKind)),signal,30000);
      if(wc===STOPPED)return null;
      const authentication=await bounded(inspectAuthentication(wc,targetKind),signal);
      return {wc,authentication};
    }
    const observed=(authentication,message)=>response(authentication?.status||'unknown',message,submitted,{kind});
    try{
      const target=await open(kind);
      if(signal.aborted)return cancelled();
      if(!target)return observed(null,'后台页面尚未准备好，请等待页面加载后重试。');
      const initial=target.authentication;
      if(initial?.status==='verified')return observed(initial,'当前后台已登录，已复用本店会话。');
      if(initial?.status==='verification-required')return {...observed(initial,'请先在当前官方页面完成安全验证；不会切换后台或重复提交。'),verificationKind:kind};
      if(initial?.status!=='login-required'||initial.checkFailed)return observed(initial,'当前后台登录状态尚未明确，未尝试账号密码；请先查看官方页面。');
      // A backend login is repaired through the same Qianniu session. Never
      // submit passwords separately to analytics/advertising pages.
      const seller=kind==='seller'?target:await open('seller');
      if(signal.aborted)return cancelled();
      if(!seller)return observed(null,'店铺登录页面尚未准备好，请手动查看。');
      if(seller.authentication?.status==='verification-required')return {...observed(seller.authentication,'请在官方页面完成安全验证；不会再次提交或跳回其他后台。'),verificationKind:'seller'};
      if(seller.authentication?.status!=='verified'){
        if(seller.authentication?.status!=='login-required'||seller.authentication.checkFailed)return observed(seller.authentication,'店铺首页尚未明确要求登录，未尝试账号密码；请先查看官方页面。');
        const listing=await bounded(Promise.resolve().then(()=>credentials.handle('list',{storeId})),signal,credentialWaitMs);
        if(signal.aborted)return cancelled();
        if(listing===STOPPED||!Array.isArray(listing?.accounts))return needsManual('本机账号列表尚未准备好，请在本机账号中检查。');
        const accounts=listing.accounts;
        if(!accounts.length)return needsManual('这家店铺尚未保存本机账号，请在官方页面手动登录，或先添加本机账号。');
        const selected=credentialId?accounts.find(account=>account.id===credentialId):
          accounts.find(account=>account.id===selectedAccounts.get(storeId))||(accounts.length===1?accounts[0]:null);
        if(!selected)return needsManual(credentialId?'所选本机账号已不存在，请重新选择。':'这家店铺保存了多个账号，请选择本次登录使用的账号。');
        const result=await perform(storeId,selected.id,signal,seller);submitted=result.submitted===true;
        if(result.status!=='verified'||result.cancelled)return {...result,kind,...(result.status==='verification-required'?{verificationKind:'seller'}:{})};
        if(submitted)selectedAccounts.set(storeId,selected.id);
        if(kind==='seller')return {...result,kind};
      }
      if(signal.aborted)return cancelled();
      // Exactly one return to the requested entry point permits official SSO.
      // A second login page, unknown result or challenge never causes a loop.
      const returned=await open(kind);
      if(signal.aborted)return cancelled();
      const status=returned?.authentication?.status||'unknown';
      const message=status==='verified'?'当前后台已复用本店登录会话。':status==='verification-required'?
        '当前后台要求安全验证，请在页面手动完成；不会重复提交。':status==='login-required'?
        '店铺首页已登录，但此后台仍要求登录或授权，请在官方页面继续；不会自动重试。':
        '已返回原后台，当前登录状态尚未确认；请查看官方页面，不会继续刷新。';
      return response(status,message,submitted,{kind,sellerStatus:'verified',...(status==='verification-required'?{verificationKind:kind}:{})});
    }catch{return response('error','后台登录未完成，请检查本机账号配置并在官方页面继续操作。',submitted,{kind});}
  }
  function reserve(storeId,key,operation){
    if(disposed)return Promise.reject(new Error('自动登录服务已停止'));
    if(active.has(storeId))return active.get(storeId).key===key?active.get(storeId).promise:Promise.reject(new Error('该店铺已有自动登录正在进行，请稍后再试'));
    const record={key,controller:new AbortController()};record.promise=operation(record.controller.signal).finally(()=>active.delete(storeId));active.set(storeId,record);return record.promise;
  }
  function run(storeId,credentialId){
    if(typeof storeId!=='string'||!storeId||typeof credentialId!=='string'||!credentialId)return Promise.reject(new Error('请选择店铺和本机账号'));
    return reserve(storeId,'credential:'+credentialId,async signal=>{
      const result=await perform(storeId,credentialId,signal);
      if(result.status==='verified'&&result.submitted)selectedAccounts.set(storeId,credentialId);
      return result;
    });
  }
  function ensureBackend({storeId,kind='seller',credentialId,background=false,purpose}={}){
    if(typeof storeId!=='string'||!storeId||typeof kind!=='string'||!BACKENDS.some(backend=>backend.kind===backendForKind(kind)))return Promise.reject(new Error('请选择店铺和有效后台入口'));
    if(credentialId!==undefined&&(typeof credentialId!=='string'||!credentialId))return Promise.reject(new Error('请选择有效本机账号'));
    if(typeof background!=='boolean'||background&&!['seller','sycm','promotion'].includes(kind))return Promise.reject(new Error('不支持的后台检查模式'));
    return reserve(storeId,'backend:'+kind+':'+(credentialId||'')+(background?':background':'')+(purpose?':'+purpose:''),signal=>ensure(storeId,kind,credentialId,signal,background,purpose));
  }
  function cancel(storeId){const record=active.get(storeId);record?.controller.abort();return record?.promise||Promise.resolve();}
  function dispose(){if(disposePromise)return disposePromise;disposed=true;for(const record of active.values())record.controller.abort();disposePromise=Promise.allSettled([...active.values()].map(record=>record.promise)).then(()=>{});return disposePromise;}
  return {run,ensureBackend,cancel,dispose};
}
module.exports={createAutoLogin};
