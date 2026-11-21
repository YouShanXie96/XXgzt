'use strict';
const {createHash}=require('node:crypto');
const PRODUCT=require('../../package.json').productName;
const {inspectAuthentication,accountPagesForBackend}=require('../accounts/authentication');
const {createBrowserWorkspace,displayUrl}=require('../browser/workspace');
const {createLoginProbe}=require('../accounts/login-probe');
const {hasStrongAuthCookie}=require('../accounts/store-login-state');
const {navigationAffectsAccount,inPageNavigationAffectsAccount,sameBackendRoute,samePageUrl}=require('../browser/navigation');
const URLS={
  seller:'https://myseller.taobao.com/home.htm',
  reviews:'https://myseller.taobao.com/home.htm/comment-manage/',
  orders:'https://myseller.taobao.com/home.htm/trade-platform/tp/sold',
  promotion:'https://one.alimama.com/index.html#!/manage/onesite',
  purchase:'https://myseller.taobao.com/home.htm/CRM-Workbench/ecrm-sop-form/Shop-Activities',
  // 托管礼金（品牌新享）：独立模块自己的店铺页面。
  hostedgift:'https://myseller.taobao.com/home.htm/qianniu-alimama-ppxx/',
  // 投诉打标（营商保）：独立模块自己的店铺页面。
  complaint:'https://ss.taobao.com/app#/complaint-center/list',
  qualification:'https://myseller.taobao.com/home.htm',
  // 上品库「打开店铺页面手动补全参数」：发布页本身可由调用方带 catId / id 打开。
  publish:'https://sell.publish.tmall.com/tmall/publish.htm',
  // 通用店铺标签：允许上品库打开任意 https 的商品 / 发布页（仍受 allowedMerchantUrl 校验）。
  user:'https://myseller.taobao.com/home.htm',
  sycm:'https://sycm.taobao.com/portal/home.htm',
  traffic:'https://one.alimama.com/index.html#!/insight/search/traffic-analysis/index',
  dmp:'https://dmp.taobao.com/index_new.html#!/compete/market-rank'
};
// Keep this ID stable: changing it would disconnect every existing shop login.
function partitionForStore(storeId){
  if(typeof storeId!=='string'||!storeId)throw new Error('店铺标识无效');
  return 'persist:xx-'+createHash('sha256').update(storeId).digest('hex').slice(0,24);
}
// 用户要求：店铺浏览器要像普通浏览器一样能输入其它域名。
// 现在放行任何 HTTPS 网址（仍禁止 http、本机/文件地址和带账号密码的地址；
// 页面本身没有 Node/preload 能力，下载与权限请求依旧被拦截）。
function allowedMerchantUrl(value){
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}
}
function safeLoadError(value){
  // Electron often appends the complete requested URL to loadURL errors. Only
  // a Chromium error identifier may leave the browser layer, never that URL.
  const code=String(value?.code||value?.message||value||'').match(/\bERR_[A-Z0-9_]{1,64}\b/)?.[0];
  return {code:code||'',message:'页面加载失败，请检查网络或登录状态。'+(code?`（${code}）`:'')};
}
// 同步时用的页面用途：每种来源一个独立标签，互不抢页面。
// 需求5（本轮）：日报与精细化可以同时同步——精细化用带 -product 后缀的独立页面，
// 两个任务各用一套页面，不会互相抢页面。
const BUSINESS_PURPOSES=new Set(['business-sync','business-sycm','business-sycm-product','business-promotion','business-promotion-product','business-channels','business-catalog','business-ppxk','business-ppxk-product','business-finance','business-finance-product','business-seller']);
// 需求2（本轮）：去滑块时如果对应页面还不存在，补开之后要直接落到该页面（而不是停在千牛首页）。
const SYNC_PAGE_URLS={
  'business-catalog':'https://wb.tmall.com/tmall/manager/render.htm?pagination.current=1&pagination.pageSize=20',
  'business-ppxk':'https://ppxk.tmall.com/',
};
function createBrowserManager({electron,getStore,emit,icon,beforeLoad,getHostWindow,sessionPersistence}){
  const {BrowserWindow,session}=electron;
  const pages=new Map(),creating=new Map(),configured=new Set(),owned=new Set(),states=new WeakMap(),sessions=new Map(),restorations=new Map(),sellerVerified=new Map(),accountRevisions=new Map(),retiredStores=new Set(),removals=new Map();
  let closing=false,disposePromise,uniqueTabSequence=0;
  const loginProbe=electron.WebContentsView?createLoginProbe({electron,getSession:storeId=>preparedSessionFor(getStore(storeId)),allowedUrl:allowedMerchantUrl}):null;
  const changedAccount=storeId=>accountRevisions.set(storeId,(accountRevisions.get(storeId)||0)+1);
  function merchantSessionFor(store){
    if(retiredStores.has(store.id))throw new Error('店铺已移除，请重新添加店铺');
    const partition=partitionForStore(store.id),merchantSession=session.fromPartition(partition);
    sessions.set(partition,merchantSession);
    if(!configured.has(partition)){
      merchantSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
      merchantSession.setPermissionCheckHandler(()=>false);
      merchantSession.on('will-download',e=>{e.preventDefault();emit({module:'browser',storeId:store.id,message:'后台触发了文件下载；请使用工作台的导出功能，或在普通浏览器下载该文件。'});});
      configured.add(partition);
      const restored=Promise.resolve().then(()=>{
        if(retiredStores.has(store.id))throw new Error('店铺已移除，请重新添加店铺');
        return sessionPersistence?.attach(store.id,merchantSession);
      });
      restorations.set(partition,restored);
      // Keep rejection available for the caller without an unhandled rejection
      // while another startup action is still preparing the page.
      void restored.catch(()=>{});
    }
    return merchantSession;
  }
  async function preparedSessionFor(store){
    const merchantSession=merchantSessionFor(store);
    await restorations.get(partitionForStore(store.id));
    if(closing)throw new Error('店铺会话正在关闭');
    if(retiredStores.has(store.id))throw new Error('店铺已移除，请重新添加店铺');
    return merchantSession;
  }
  const workspace=getHostWindow?createBrowserWorkspace({electron,getHostWindow,getStore,emit,readStoreStatus:id=>status(id,{workspaceOnly:true}),navigate:loadPage,allowedUrl:allowedMerchantUrl,urls:URLS}):null;
  function configureWindow(win,store,kind,{popup=false}={}){
    owned.add(win);
    states.set(win,{storeId:store.id,kind,popup,loadError:'',crashed:false});
    win.setMenuBarVisibility(false);
      win.on('page-title-updated',e=>{e.preventDefault();win.setTitle(`${PRODUCT} · ${store.name} · ${kind}`);});
    win.on('close',e=>{if(!closing&&!popup){e.preventDefault();win.hide();}});
    win.on('closed',()=>{owned.delete(win);for(const[key,value]of pages)if(value===win)pages.delete(key);});
    const wc=win.webContents;
    let lastUrl='';try{lastUrl=String(wc.getURL?.()||'');}catch{}
    const remember=value=>{if(typeof value==='string'&&value)lastUrl=value;};
    // 千牛首页 /home.htm 与 /home.htm/QnworkbenchHome/ 是同一页的两种路由，
    // 登录后会自动切换；不把这种自跳当成换账号，否则账单同步会被自己的跳转打断。
    const samePathAsLast=value=>samePageUrl(value,lastUrl);
    wc.on('did-start-navigation',(...args)=>{if(sameBackendRoute(...args))return;if(navigationAffectsAccount(...args))changedAccount(store.id);});
    wc.on('did-navigate',(_event,url)=>{const next=typeof url==='string'?url:String(wc.getURL?.()||'');const same=samePathAsLast(next);remember(next);if(same)return;changedAccount(store.id);});
    // 单页应用在同一个后台站点里换路由（万相台/生意参谋/千牛切页签）不算换账号，
    // 不再把“账号版本”往上加，免得读取被自己的页内跳转打断。
    wc.on('did-navigate-in-page',(...args)=>{const details=args[0],target=typeof details?.url==='string'?details.url:(typeof args[1]==='string'?args[1]:'');remember(target);if(sameBackendRoute({isInPlace:true,isMainFrame:true,url:target},target,true,true))return;if(inPageNavigationAffectsAccount(...args))changedAccount(store.id);});
    wc.on('will-attach-webview',event=>event.preventDefault());
    wc.setWindowOpenHandler(details=>{
      const {url}=details;
      if(closing||!allowedMerchantUrl(url))return {action:'deny'};
      const override={show:win.isVisible(),title:`${PRODUCT} · ${store.name}`,autoHideMenuBar:true,webPreferences:{session:wc.session,nodeIntegration:false,nodeIntegrationInSubFrames:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,backgroundThrottling:false}};
      if(!workspace)return {action:'allow',outlivesOpener:false,overrideBrowserWindowOptions:override};
      return {action:'allow',outlivesOpener:false,overrideBrowserWindowOptions:override,createWindow:options=>{
        const preferences={...options.webPreferences,...override.webPreferences};delete preferences.preload;
        const child=workspace.create({...options,webPreferences:preferences},{store,kind,popup:true});
        configureWindow(child,store,kind,{popup:true});
        if(details.disposition==='background-tab'){workspace.showBackground(child);void loadPage(child,url).catch(()=>{});}
        else if(win.isVisible())child.show();
        return child.webContents;
      }};
    });
    if(!workspace)wc.on('did-create-window',(child)=>configureWindow(child,store,kind,{popup:true}));
    wc.on('will-navigate',(e,url)=>{if(!allowedMerchantUrl(url))e.preventDefault();});
    wc.on('will-redirect',(e,url)=>{if(!allowedMerchantUrl(url))e.preventDefault();});
    wc.on('will-frame-navigate',event=>{if(event.url&&!allowedMerchantUrl(event.url))event.preventDefault();});
    wc.on('dom-ready',()=>{const state=states.get(win);if(state){state.loadError='';state.crashed=false;}});
    wc.on('did-fail-load',(_event,errorCode,errorDescription,_url,isMainFrame)=>{if(isMainFrame&&errorCode!==-3){const failure=safeLoadError(errorDescription),state=states.get(win);if(state)state.loadError=failure.code||failure.message;emit({module:'browser',storeId:store.id,message:failure.message});}});
    wc.on('did-navigate',()=>emit({module:'browser',storeId:store.id,message:/login|passport/.test(wc.getURL())?'请在店铺窗口完成登录':'店铺页面已更新'}));
    wc.on('render-process-gone',(_,details)=>{const state=states.get(win);if(state)state.crashed=true;emit({module:'browser',storeId:store.id,message:'店铺页面进程退出，请重新打开：'+details.reason});});
  }
  async function loadPage(win,url){
    const wc=win.webContents;
    return new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{clearTimeout(timer);wc.removeListener('dom-ready',ready);wc.removeListener('destroyed',destroyed);};
      const ready=()=>{cleanup();resolve(wc);};
      const destroyed=()=>{cleanup();reject(new Error('店铺页面已关闭'));};
      wc.once('dom-ready',ready);wc.once('destroyed',destroyed);
      timer=setTimeout(()=>{cleanup();const state=states.get(win);if(state)state.loadError='加载超时';reject(new Error('店铺页面加载超时，请打开页面检查网络后再同步。'));},25000);
      // dom-ready can precede loadURL completion; this lets capture attach before late list requests.
      Promise.resolve(wc.loadURL(url)).catch(error=>{const failure=safeLoadError(error);if(failure.code==='ERR_ABORTED')return;cleanup();const state=states.get(win);if(state)state.loadError=failure.code||failure.message;reject(new Error(failure.message));});
    });
  }
  // 单页应用（千牛首页/万相台/生意参谋）在 dom-ready 之后还会自己换路由；
  // 等页面安静一小段时间再交给读取，避免读取刚开始就被页内跳转打断。
  async function settlePage(wc,{quietMs=800,maxMs=6000}={}){
    const deadline=Date.now()+maxMs;
    for(;;){
      let moved=false;
      const onMove=()=>{moved=true;};
      wc.on('did-start-navigation',onMove);wc.on('did-navigate',onMove);wc.on('did-navigate-in-page',onMove);
      await new Promise(resolve=>setTimeout(resolve,quietMs));
      wc.removeListener('did-start-navigation',onMove);wc.removeListener('did-navigate',onMove);wc.removeListener('did-navigate-in-page',onMove);
      if(!moved||Date.now()>deadline)return;
    }
  }
  async function page(storeId,kind,options={}){
    if(closing)throw new Error('店铺页面正在关闭，请重新启动工作台');
    if(retiredStores.has(storeId))throw new Error('店铺已移除，请重新添加店铺');
    const store=getStore(storeId);if(!URLS[kind])throw new Error('不支持的店铺页面');
    const purpose=options.purpose;
    if(purpose!==undefined){
      if(!BUSINESS_PURPOSES.has(purpose))throw new Error('不支持的店铺页面用途');
      // 同步用的页面按用途分开：商品资料/品牌新享/账单各用自己那一个标签，互相不抢页面。
      if(['business-sycm','business-sycm-product'].includes(purpose)&&kind!=='sycm')throw new Error('生意参谋同步页必须是生意参谋页面');
      if(['business-promotion','business-promotion-product','business-channels'].includes(purpose)&&kind!=='promotion')throw new Error('推广同步页必须是推广页面');
      if(purpose==='business-sync'&&!['sycm','promotion'].includes(kind))throw new Error('经营同步仅支持生意参谋和推广页面');
      if(['business-catalog','business-ppxk','business-ppxk-product','business-finance','business-finance-product','business-seller'].includes(purpose)&&kind!=='seller')throw new Error('千牛来源同步页必须是千牛页面');
    }
    // Collection may navigate its own page without replacing the user's tab.
    // Only the page cache changes; the existing per-store login partition stays.
    if(options.unique===true&&purpose!==undefined)throw new Error('独立标签页不能使用同步用途');
    // unique=true（用户从“新标签页”输入网址）会生成独立缓存键，不复用已有页面。
    const key=storeId+':'+kind+(purpose?':'+purpose:'')+(options.unique===true?':u'+(++uniqueTabSequence):'');
    if(creating.has(key)){const wc=await creating.get(key);if(options.show){const win=pages.get(key)||BrowserWindow.fromWebContents(wc);win?.show();win?.focus();if(workspace)workspace.setHidden?.(win,false);}return wc;}
    const existing=pages.get(key);
    if(existing&&!existing.isDestroyed()){
      if(options.show){existing.show();existing.focus();}
      // 显式打开（show:true）时把之前收起的后台同步页面重新放回标签栏。
      if(options.show&&workspace)workspace.setHidden?.(existing,false);
      if(options.background&&workspace)workspace.showBackground(existing);
      const state=states.get(existing);
      if(state?.loadError||state?.crashed){if(!options.show)throw new Error('店铺页面尚未就绪，请先点击登录/打开页面重新加载。');return loadPage(existing,URLS[kind]);}
      if(options.show||state?.refreshAfterLogin){
        state.refreshAfterLogin=false;
        // A completed central login can leave another tab on the old login
        // screen. Re-enter its own official URL when next used, or when the user
        // explicitly reopens it, only if still asking for login. This also lets
        // SSO recover when a backend hides the logout control in a menu.
        const authentication=await inspectAuthentication(existing.webContents,kind);
        if(authentication.status==='login-required')return loadPage(existing,URLS[kind]);
      }
      return existing.webContents;
    }
    const promise=(async()=>{
      const merchantSession=await preparedSessionFor(store);
      const windowOptions={width:1280,height:860,minWidth:900,minHeight:620,show:!!options.show,icon,title:`${PRODUCT} · ${store.name}`,autoHideMenuBar:true,webPreferences:{session:merchantSession,nodeIntegration:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,backgroundThrottling:false,spellcheck:false}};
      // 同步用途的后台页面默认隐藏（不进标签栏），需要滑块时由 focusSyncPage 临时显示。
      const businessPurpose=typeof options.purpose==='string'&&BUSINESS_PURPOSES.has(options.purpose);
      const win=workspace?workspace.create({...windowOptions,...(businessPurpose&&options.show!==true?{hidden:true}:{})},{store,kind}):new BrowserWindow(windowOptions);
      pages.set(key,win);configureWindow(win,store,kind);
      if(workspace&&options.show)win.show();
      // background=true：同步用的页面也作为标签显示在“店铺浏览器”里。
      if(workspace&&options.background)workspace.showBackground(win);
      try { await beforeLoad?.(win.webContents,kind,{storeId:store.id,purpose}); }
      catch(error) {win.destroy();pages.delete(key);throw new Error('数据页面准备失败：'+error.message);}
      if(closing||retiredStores.has(storeId)||win.isDestroyed())throw new Error('店铺页面已关闭');
      const initialUrl=options.initialUrl;
      if(initialUrl!==undefined&&!allowedMerchantUrl(initialUrl))throw new Error('仅支持 https:// 开头的网址（不支持 http、本机地址或带账号密码的地址）');
      await loadPage(win,initialUrl||URLS[kind]);
      if(!win.isDestroyed())await settlePage(win.webContents);
      return win.webContents;
    })();
    creating.set(key,promise);try{return await promise;}finally{creating.delete(key);}
  }
  function existingPage(storeId,kind,options={}){
    getStore(storeId);
    if(!['seller','sycm','promotion'].includes(kind))throw new Error('经营读取仅支持千牛、生意参谋和推广页面');
    if(options.purpose!==undefined&&!BUSINESS_PURPOSES.has(options.purpose))throw new Error('不支持的店铺页面用途');
    if(closing)return null;
    // Cache lookup only: no window/session creation, page navigation, reload,
    // login inspection, focus change, or network request may occur here.
    // The default is the user's normal tab. Dedicated legacy tabs are only
    // available when their purpose is explicitly requested by the caller.
    const base=storeId+':'+kind,keys=options.purpose?[base+':'+options.purpose]:[base];
    for(const key of keys){
      const win=pages.get(key),wc=win?.webContents;
      if(win&&!win.isDestroyed()&&wc&&!wc.isDestroyed?.())return wc;
    }
    return null;
  }
  // 用户从“新标签页”输入网址：创建一个独立的店铺标签（同店也不复用已有页面），
  // 并把它切为当前标签；返回 tabId 供界面同步。
  async function openUserTab(storeId,kind,url){
    const store=getStore(storeId);
    if(!URLS[kind])throw new Error('不支持的店铺页面');
    const wc=await page(storeId,kind,{show:false,background:true,unique:true,...(url?{initialUrl:url}:{})});
    let win=null;
    for(const candidate of owned){
      if(states.get(candidate)?.storeId===store.id&&candidate.webContents===wc&&!candidate.isDestroyed()){win=candidate;break;}
    }
    const tabId=workspace&&win?workspace.idFor(win):'';
    if(tabId)await workspace.handle('activateTab',{tabId});
    return {tabId,url:displayUrl(wc.getURL?.()||''),message:'新标签页已打开。'};
  }
  // 把“正在同步用的那个页面”切到前台（滑块提示的“去店铺浏览器”用它精确定位，而不是随便找一家店的标签）。
  async function focusSyncPage(storeId,kind,purpose){
    let context=syncPageContext(storeId,kind,purpose===undefined?{}:{purpose});
    // 需求8（本轮）：去滑块时如果这个同步页还不存在（例如读取已经被停下、页面被收起关闭），
    // 就把该来源的官方页面打开再显示出来，绝不让“去滑块”跳过去看到空白。
    if(!context){
      try{await page(storeId,kind,{show:true,...(purpose?{purpose}:{})});}catch{return {tabId:'',message:'同步页面暂时打不开，请先确认这家店已登录。'};}
      context=syncPageContext(storeId,kind,purpose===undefined?{}:{purpose});
      // 新建的千牛页面默认停在首页；商品资料/品牌新享要直接打开它们对应的页面地址。
      const target=SYNC_PAGE_URLS[purpose];
      if(context&&target){
        try{const win=pages.get(`${storeId}:${kind}:${purpose}`);if(win)await loadPage(win,target);}catch{}
        context=syncPageContext(storeId,kind,purpose===undefined?{}:{purpose})||context;
      }
    }
    if(!context)return {tabId:'',message:'同步页面当前不存在（可能上一次同步已经结束）。'};
    // 需要滑块时才把这个隐藏页面显示到标签栏并切到前台（用户要求：平时隐藏，只在需要时弹出）。
    try{workspace?.setHidden?.(context.surface||context.webContents,false);}catch{}
    if(context.tabId&&workspace)await workspace.handle('activateTab',{tabId:context.tabId});
    // 需求2（本轮，参考亿满分）：同时把这个页面弹成“独立窗口”，用户不需要在店铺浏览器里
    // 找标签、也不受当前正在看哪家店的影响；验证结束后由 hideSyncPage 关掉窗口、页面继续后台同步。
    try{workspace?.popOut?.(context.surface||context.webContents);}catch{}
    return {tabId:context.tabId,url:displayUrl(context.webContents.getURL?.()||'')};
  }
  // 已滑块/验证结束后把它收回去（标签栏重新隐藏，页面继续在后台跑）。
  function hideSyncPage(storeId,kind,purpose){
    const context=syncPageContext(storeId,kind,purpose===undefined?{}:{purpose});
    if(!context)return {hidden:false,message:'同步页面当前不存在。'};
    try{workspace?.popIn?.(context.surface||context.webContents);}catch{}
    const hidden=workspace?.setHidden?.(context.surface||context.webContents,true)===true;
    return {hidden,tabId:context.tabId,message:hidden?'已收起同步页面，继续在后台同步。':'无法收起同步页面。'};
  }
  // 需求2：找到某个同步用途“正在使用”的那个隐藏页面（同一个 WebContentsView），
  // 把它显示为店铺浏览器里的标签并返回 tabId，供界面弹出来完成滑块；不新开页面。
  function syncPageContext(storeId,kind,options={}){
    getStore(storeId);
    if(!['seller','sycm','promotion'].includes(kind))throw new Error('同步页面仅支持千牛、生意参谋和推广页面');
    if(options.purpose!==undefined&&!BUSINESS_PURPOSES.has(options.purpose))throw new Error('不支持的店铺页面用途');
    if(closing)return null;
    const key=storeId+':'+kind+(options.purpose?':'+options.purpose:'');
    const win=pages.get(key);
    if(!win||win.isDestroyed())return null;
    const webContents=win.webContents;
    if(!webContents||webContents.isDestroyed?.())return null;
    if(workspace)workspace.showBackground(win);
    return {webContents,surface:win,tabId:workspace?.idFor(win)||''};
  }
  // 登录状态快速判断：只读取本店分区里 Cookie 的“名称/域名是否命中白名单”，
  // 不读取、记录或返回任何 Cookie 值；页面地址来自已打开的标签，不新开页面。
  async function quickLogin(storeId){
    if(closing)throw new Error('店铺页面正在关闭，请重新启动工作台');
    if(retiredStores.has(storeId))throw new Error('店铺已移除，请重新添加店铺');
    const store=getStore(storeId);
    let merchantSession;
    try{merchantSession=await preparedSessionFor(store);}
    catch{merchantSession=session.fromPartition(partitionForStore(store.id));}
    let cookies=[];
    try{cookies=await merchantSession.cookies.get({});}catch{cookies=[];}
    const strongCookie=hasStrongAuthCookie(cookies);
    const urls=[];
    for(const win of owned){
      const state=states.get(win);
      if(!state||state.storeId!==store.id||win.isDestroyed())continue;
      try{const value=win.webContents.getURL?.()||'';if(value)urls.push(value);}catch{}
    }
    return {storeId:store.id,strongCookie,urls,checkedAt:new Date().toISOString()};
  }
  async function status(storeId,{workspaceOnly=false}={}){
    getStore(storeId);
    const matching=[...owned].filter(win=>states.get(win)?.storeId===storeId&&!win.isDestroyed()&&(!workspaceOnly||workspace?.isTabOpen(win)));
    const checked=await Promise.all(matching.map(async win=>{
      const state=states.get(win),kind=state.kind;
      const authentication=state.loadError||state.crashed?{status:'error',message:'页面未正常加载，请重新打开。',url:''}:await inspectAuthentication(win.webContents,kind);
      return {kind,tabId:workspace?.idFor(win),popup:state.popup,open:!win.isDestroyed(),visible:!win.isDestroyed()&&win.isVisible(),url:authentication.url||'',error:state.loadError||'',crashed:state.crashed,authentication:{status:authentication.status,message:authentication.message},checkedAt:new Date().toISOString()};
    }));
    const sellerPages=accountPagesForBackend(checked,'seller');
    const verified=sellerPages.some(page=>page.authentication.status==='verified')&&!sellerPages.some(page=>['login-required','verification-required','error'].includes(page.authentication.status));
    if(verified&&!sellerVerified.get(storeId)){
      checked.forEach((page,index)=>{
        if(!page.popup&&page.kind!=='seller'&&page.authentication.status==='login-required')states.get(matching[index]).refreshAfterLogin=true;
      });
    }
    sellerVerified.set(storeId,verified);
    workspace?.acceptStatuses(checked);
    return {pages:checked,message:'登录状态和店铺身份以官方后台页面显示为准；仅检查已打开页面。'};
  }
  async function statusAll(storeIds){return Promise.all(storeIds.map(async storeId=>({storeId,...await status(storeId)})));}
  function closeStore(storeId,{forget=false}={}){
    if(forget&&removals.has(storeId))return removals.get(storeId);
    if(forget)retiredStores.add(storeId);
    changedAccount(storeId);const pending=loginProbe?.cancel?.(storeId);sellerVerified.delete(storeId);
    for(const win of [...owned])if(states.get(win)?.storeId===storeId&&!win.isDestroyed())win.destroy();
    if(!forget)return Promise.resolve(pending);
    const partition=partitionForStore(storeId);
    const removal=(async()=>{
      const results=await Promise.allSettled([pending,Promise.resolve().then(()=>sessionPersistence?.forget(storeId)),restorations.get(partition)]);
      restorations.delete(partition);configured.delete(partition);
      // A restoration aborted by removal is expected; failure to cancel a
      // probe or erase the supplement must still stop metadata deletion.
      const failed=results.slice(0,2).find(result=>result.status==='rejected');if(failed)throw failed.reason;
    })();
    removals.set(storeId,removal);
    // Remain blocked after an erase failure, but permit an explicit retry.
    void removal.catch(()=>{if(removals.get(storeId)===removal)removals.delete(storeId);});
    return removal;
  }
  function dispose(){
    if(disposePromise)return disposePromise;
    closing=true;for(const win of [...owned])if(!win.isDestroyed())win.destroy();pages.clear();owned.clear();
    workspace?.dispose();
    disposePromise=(async()=>{
      const results=await Promise.allSettled([Promise.resolve().then(()=>loginProbe?.dispose())]);
      const restoring=[...restorations].map(async([partition,promise])=>{
        try{await promise;}catch(error){if(![...retiredStores].some(id=>partitionForStore(id)===partition))throw error;}
      });
      results.push(...await Promise.allSettled([...restoring,...removals.values()]));
      results.push(...await Promise.allSettled([Promise.resolve().then(()=>sessionPersistence?.dispose())]));
      // A failed supplement or storage flush must not skip the native cookie
      // flush. Attempt every independent store, then report the first failure.
      results.push(...await Promise.allSettled([...sessions.values()].flatMap(merchantSession=>[
        Promise.resolve().then(()=>merchantSession.flushStorageData?.()),
        Promise.resolve().then(()=>merchantSession.cookies?.flushStore?.())
      ])));
      const failure=results.find(result=>result.status==='rejected');
      if(failure)throw new Error('店铺登录会话保存失败，请保留用户数据目录并重新登录。');
    })();
    return disposePromise;
  }
  return {page,existingPage,quickLogin,syncPageContext,openUserTab,focusSyncPage,hideSyncPage,show:(id,kind)=>page(id,kind,{show:true}),status,statusAll,dispose,closeStore,accountRevision:id=>accountRevisions.get(id)||0,...(loginProbe?{cancelLoginCheck:id=>loginProbe.cancel(id),checkLogin:id=>{getStore(id);if(closing)throw new Error('工作台正在关闭');if(retiredStores.has(id))throw new Error('店铺已移除，请重新添加店铺');return loginProbe.check(id);}}:{}),handleWorkspace:(method,payload)=>workspace?workspace.handle(method,payload):Promise.reject(new Error('当前窗口不支持内置浏览器标签页')),hasPages:()=>[...owned].some(win=>!win.isDestroyed())};
}
module.exports={createBrowserManager,allowedMerchantUrl,URLS,partitionForStore};
