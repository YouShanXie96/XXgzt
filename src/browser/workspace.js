'use strict';
const {EventEmitter}=require('node:events');

// The address bar never receives authentication query strings. Routes are kept
// useful for humans, while query parameters and free-form fragments stay private.
function displayUrl(value){
  try{
    const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)return '';
    const route=url.hash.split('?')[0];
    return url.origin+url.pathname+(/^#!?\/[\w/.-]*$/.test(route)?route:'');
  }catch{return '';}
}
function viewportBounds(bounds,host){
  if(!bounds||!['x','y','width','height'].every(key=>typeof bounds[key]==='number'&&Number.isFinite(bounds[key])))throw new Error('浏览器显示区域无效');
  if(bounds.width<0||bounds.height<0)throw new Error('浏览器显示区域大小无效');
  const rawZoom=host.webContents?.getZoomFactor?.(),zoom=Number.isFinite(rawZoom)&&rawZoom>0?rawZoom:1;
  const content=host.getContentBounds?.()||(()=>{const [width,height]=host.getContentSize();return {width,height};})();
  const width=Math.max(0,Math.floor(content.width)),height=Math.max(0,Math.floor(content.height));
  const clamp=(value,max)=>Math.min(max,Math.max(0,value));
  const x=clamp(Math.floor(bounds.x*zoom),width),y=clamp(Math.floor(bounds.y*zoom),height);
  const right=clamp(Math.ceil((bounds.x+bounds.width)*zoom),width),bottom=clamp(Math.ceil((bounds.y+bounds.height)*zoom),height);
  return {x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)};
}
function historyFor(wc){return wc.navigationHistory||wc;}
function historyFlag(wc,name){try{return !!historyFor(wc)[name]?.();}catch{return false;}}

function createBrowserWorkspace({electron,getHostWindow,getStore,emit,readStoreStatus,navigate,allowedUrl,urls}){
  const records=new Map(),surfaces=new WeakMap(),checks=new Map(),checkedStores=new Map(),storeVersions=new Map(),checkedVersions=new Map();
  let sequence=0,activeId=null,visible=false,cssBounds=null,attached=null,attachedHost=null,disposed=false,changedQueued=false;
  let observedHost=null;
  function notify(action='changed',record){
    if(disposed)return;
    if(action==='show'){emit({module:'browser-workspace',action,storeId:record.storeId,tabId:record.id,kind:record.kind});return;}
    if(changedQueued)return;changedQueued=true;
    queueMicrotask(()=>{changedQueued=false;if(!disposed)emit({module:'browser-workspace',action:'changed'});});
  }
  function hostWindow(){
    const host=getHostWindow();if(!host||host.isDestroyed?.())return null;
    if(observedHost!==host){
      // 主窗口缩放（Ctrl+滚轮 / Ctrl+加减）同步到商家页面，内外页面一起放大缩小。
      observedHost=host;host.on?.('resize',layout);host.webContents?.on?.('zoom-changed',()=>{applyZoom(host);layout();});
      host.once?.('closed',()=>{visible=false;detach();});
    }
    return host;
  }
  function detach(){
    if(attached){try{attached.view.setVisible?.(false);attachedHost?.contentView?.removeChildView(attached.view);}catch{}attached=null;attachedHost=null;}
  }
  function layout(){
    const record=records.get(activeId),host=hostWindow();
    // 需求2（本轮，参考亿满分）：被“弹出独立窗口”的同步页由那个窗口显示，主窗口不再挂载它。
    if(!visible||!cssBounds||!host||!record?.opened||record.poppedOut||record.surface.isDestroyed()){detach();return;}
    const bounds=viewportBounds(cssBounds,host);
    if(!bounds.width||!bounds.height){detach();return;}
    if(attached!==record||attachedHost!==host){detach();host.contentView.addChildView(record.view);attached=record;attachedHost=host;}
    record.view.setBounds(bounds);record.view.setVisible?.(true);
    applyZoom(host);
  }
  // 需求2（本轮，参考亿满分）：需要用户操作的同步页（滑块/查看）弹成独立窗口，
  // 不再依赖“店铺浏览器”的标签列表——不管之前在看哪家店、标签是否隐藏，都能看到这一页。
  function popOut(surface){
    const record=recordFor(surface);if(!record||record.surface.isDestroyed())return null;
    const host=hostWindow();if(!host)return null;
    if(record.popupWindow&&!record.popupWindow.isDestroyed()){record.popupWindow.show();record.popupWindow.focus();return record.popupWindow;}
    if(attached===record)detach();
    record.poppedOut=true;
    let storeName='';try{storeName=getStore(record.storeId).name;}catch{storeName='';}
    const win=new electron.BrowserWindow({
      parent:host,width:1080,height:760,minWidth:640,minHeight:420,
      title:`${storeName||'店铺'} · ${record.kind==='sycm'?'生意参谋':record.kind==='promotion'?'推广':'千牛'}`,
      autoHideMenuBar:true,backgroundColor:'#1b1f28',
      webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webviewTag:false},
    });
    const size=()=>{try{const [width,height]=win.getContentSize();record.view.setBounds({x:0,y:0,width,height});}catch{}};
    try{win.contentView.addChildView(record.view);}catch{}
    // detach() 会把视图隐藏，挂到新窗口后必须重新显示，否则弹出来是空的（实测踩到）。
    try{record.view.setVisible?.(true);}catch{}
    win.on('resize',size);
    win.setMenuBarVisibility?.(false);
    win.on('closed',()=>{
      record.popupWindow=null;record.poppedOut=false;
      try{win.contentView.removeChildView(record.view);}catch{}
      if(visible)layout();
      notify('changed');
    });
    record.popupWindow=win;
    size();win.show();win.focus();
    notify('changed');
    return win;
  }
  // 验证结束/点“我已划完”：把独立窗口关掉，页面回到隐藏的后台继续同步（参考亿满分）。
  function popIn(surface){
    const record=recordFor(surface);
    if(!record)return false;
    const win=record.popupWindow;
    record.popupWindow=null;record.poppedOut=false;
    if(win){
      try{win.contentView.removeChildView(record.view);}catch{}
      try{win.removeAllListeners('closed');win.close();}catch{try{win.destroy();}catch{}}
    }
    if(visible)layout();
    notify('changed');
    return !!win;
  }
  // 外层窗口的 zoomFactor 必须同步给商家页面，否则缩放后内外大小不一致。
  function applyZoom(host=getHostWindow()){
    if(!host||host.isDestroyed?.())return;
    const raw=host.webContents?.getZoomFactor?.(),zoom=Number.isFinite(raw)&&raw>0?raw:1;
    for(const record of records.values()){
      if(record.surface.isDestroyed())continue;
      try{if(record.surface.webContents.getZoomFactor?.()!==zoom)record.surface.webContents.setZoomFactor?.(zoom);}catch{}
    }
  }
  function recordFor(surface){return surfaces.get(surface);}
  function invalidateStore(storeId){storeVersions.set(storeId,(storeVersions.get(storeId)||0)+1);checkedStores.delete(storeId);}
  function select(record,{show=false}={}){
    record.opened=true;activeId=record.id;
    // Rendering begins only after the main UI supplies its browser viewport.
    // Changing the selected tab cannot itself expose a view over another page.
    layout();notify(show?'show':'changed',record);
  }
  function nextAfterClose(record){
    if(activeId!==record.id)return;
    activeId=[...records.values()].reverse().find(item=>item!==record&&item.opened&&item.storeId===record.storeId)?.id||null;
  }
  function forget(record){
    if(!records.has(record.id))return;
    if(attached===record)detach();nextAfterClose(record);records.delete(record.id);layout();notify();
  }
  class Surface extends EventEmitter{
    constructor(view){
      super();this.view=view;this.webContents=view.webContents;this.destroyed=false;
      this.webContents.once('destroyed',()=>{this.destroyed=true;forget(recordFor(this));this.emit('closed');});
    }
    setMenuBarVisibility(){}setTitle(){}
    show(){select(recordFor(this),{show:true});}
    hide(){const record=recordFor(this);record.opened=false;nextAfterClose(record);layout();notify();}
    focus(){if(this.isVisible())this.webContents.focus?.();}
    isVisible(){return !this.isDestroyed()&&attached===recordFor(this)&&visible;}
    isDestroyed(){return this.destroyed||!!this.webContents.isDestroyed?.();}
    destroy(){
      if(this.isDestroyed())return;
      if(attached===recordFor(this))detach();
      if(this.webContents.close)this.webContents.close({waitForBeforeUnload:false});else this.webContents.destroy?.();
    }
  }
  function create(options,{store,kind,popup=false}={}){
    if(disposed)throw new Error('浏览器工作区已关闭');
    const view=new electron.WebContentsView({webPreferences:options.webPreferences,...(options.webContents?{webContents:options.webContents}:{})});
    view.setVisible?.(false);
    // Hidden first-use sync pages still need a layout viewport. They stay
    // detached from the host; setBounds alone never selects or shows a tab.
    const initialSize=value=>Number.isFinite(value)&&value>0?Math.min(4096,Math.round(value)):1280;
    view.setBounds({x:0,y:0,width:initialSize(options.width),height:initialSize(options.height||860)});
    // hidden：同步用的后台页面默认不出现在标签栏里（用户要求参考亿满分：同步走隐藏窗口，
    // 只有需要滑块/查看时才临时显示出来）。
    const surface=new Surface(view),record={id:'tab-'+(++sequence),storeId:store.id,kind,popup,hidden:options.hidden===true,view,surface,opened:!!options.show||popup,status:'unknown',message:'登录状态待检查。',checkedAt:'',title:''};
    surfaces.set(surface,record);records.set(record.id,record);invalidateStore(store.id);
    const wc=surface.webContents;
    const changed=()=>notify();
    const navigation=()=>{record.status='unknown';record.message='页面已更新，等待检查。';record.checkedAt='';invalidateStore(store.id);changed();};
    wc.on('did-start-loading',navigation);wc.on('did-stop-loading',changed);wc.on('page-title-updated',(_event,title)=>{record.title=String(title||'').slice(0,160);changed();});
    wc.on('did-navigate',()=>{navigation();void refreshStore(store.id,true).then(changed).catch(()=>{});});
    wc.on('did-navigate-in-page',()=>{navigation();void refreshStore(store.id,true).then(changed).catch(()=>{});});
    wc.on('dom-ready',()=>{void refreshStore(store.id,true).then(changed).catch(()=>{});});
    wc.on('content-bounds-updated',event=>event.preventDefault());
    notify();return surface;
  }
  function acceptStatuses(pages){
    for(const page of pages){const record=records.get(page.tabId);if(!record)continue;record.status=page.authentication?.status||'unknown';record.message=page.authentication?.message||'';record.checkedAt=page.checkedAt||new Date().toISOString();}
  }
  async function refreshStore(storeId,force=false){
    if(checks.has(storeId)){
      await checks.get(storeId);
      if(checkedVersions.get(storeId)!==storeVersions.get(storeId))return refreshStore(storeId);
      return;
    }
    const version=storeVersions.get(storeId)||0;
    if(!force&&checkedVersions.get(storeId)===version&&Date.now()-(checkedStores.get(storeId)||0)<5000)return;
    const pending=Promise.resolve().then(()=>readStoreStatus(storeId)).then(result=>{acceptStatuses(result.pages||[]);checkedStores.set(storeId,Date.now());checkedVersions.set(storeId,version);}).finally(()=>checks.delete(storeId));
    checks.set(storeId,pending);return pending;
  }
  function snapshot(){
    return {tabs:[...records.values()].filter(record=>record.opened&&!record.hidden&&!record.surface.isDestroyed()).map(record=>{
      const wc=record.surface.webContents;let title=record.title;try{title=wc.getTitle?.()||title;}catch{}
      let storeName;try{storeName=getStore(record.storeId).name;}catch{storeName='已移除店铺';}
      return {id:record.id,storeId:record.storeId,storeName,kind:record.kind,title:String(title||storeName).slice(0,160),url:displayUrl(wc.getURL?.()||''),status:record.status,message:record.message,checkedAt:record.checkedAt,loading:!!wc.isLoading?.(),canGoBack:historyFlag(wc,'canGoBack'),canGoForward:historyFlag(wc,'canGoForward'),popup:record.popup};
    }),activeId,visible};
  }
  function required(id){const record=records.get(id);if(!record?.opened||record.surface.isDestroyed())throw new Error('浏览器标签已关闭，请重新打开后台');getStore(record.storeId);return record;}
  async function handle(method,p={}){
    if(disposed)throw new Error('浏览器工作区已关闭');
    if(method==='viewport'){
      if(p.visible!==true){visible=false;detach();return snapshot();}
      const host=hostWindow();if(!host)throw new Error('工作台主窗口尚未就绪');
      try{viewportBounds(p.bounds,host);}catch(error){visible=false;detach();throw error;}
      cssBounds={...p.bounds};visible=true;
      if(p.storeId&&records.get(activeId)?.storeId!==p.storeId){activeId=[...records.values()].find(record=>record.opened&&record.storeId===p.storeId)?.id||null;}
      layout();return snapshot();
    }
    if(method==='workspace'){
      await Promise.all([...new Set([...records.values()].filter(record=>record.opened).map(record=>record.storeId))].map(storeId=>refreshStore(storeId)));
      return snapshot();
    }
    const record=required(p.tabId),wc=record.surface.webContents;
    // 需求8（本轮）：激活一个“隐藏的同步页”时必须先把它显示出来（去滑块跳过去不能再是空白页）。
    if(method==='activateTab'){if(record.hidden)setHidden(record.surface,false);select(record);record.surface.focus();}
    else if(method==='closeTab'){if(record.popup)record.surface.destroy();else record.surface.hide();}
    else if(method==='checkTab')await refreshStore(record.storeId,true);
    else if(method==='navigateTab'||method==='homeTab'){
      const url=method==='homeTab'?urls[record.kind]:String(p.url||'').trim();
      if(!allowedUrl(url))throw new Error('仅支持 https:// 开头的网址（不支持 http、本机地址或带账号密码的地址）');
      await navigate(record.surface,url);
    }else if(method==='reloadTab'){
      if(!allowedUrl(wc.getURL?.()||''))throw new Error('当前页面不能刷新，请先打开店铺后台');
      wc.reload();
    }else if(method==='back'||method==='forward'){
      const history=historyFor(wc),check=method==='back'?'canGoBack':'canGoForward',go=method==='back'?'goBack':'goForward';
      if(historyFlag(wc,check))await history[go]();
    }else throw new Error('不支持的浏览器操作');
    return snapshot();
  }
  function dispose(){disposed=true;visible=false;detach();for(const record of records.values()){if(record.popupWindow&&!record.popupWindow.isDestroyed()){try{record.popupWindow.removeAllListeners('closed');record.popupWindow.close();}catch{try{record.popupWindow.destroy();}catch{}}record.popupWindow=null;record.poppedOut=false;}}if(observedHost){observedHost.removeListener?.('resize',layout);observedHost.webContents?.removeListener?.('zoom-changed',layout);}records.clear();}
  // setHidden：临时显示/收起某个后台同步页面（收起来后标签栏里看不到，页面本身还在跑）。
  function setHidden(surface,hidden){
    const record=recordFor(surface);if(!record)return false;
    const next=hidden===true;
    if(record.hidden===next)return true;
    record.hidden=next;
    if(next&&activeId===record.id)nextAfterClose(record);
    layout();notify();
    return true;
  }
  return {create,handle,acceptStatuses,idFor:surface=>recordFor(surface)?.id,isTabOpen:surface=>!!recordFor(surface)?.opened,showBackground:surface=>{const record=recordFor(surface);record.opened=true;notify();},setHidden,isHidden:surface=>recordFor(surface)?.hidden===true,popOut,popIn,isPoppedOut:surface=>recordFor(surface)?.poppedOut===true,dispose};
}
module.exports={createBrowserWorkspace,viewportBounds,displayUrl};
