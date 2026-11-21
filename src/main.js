'use strict';
const electron=require('electron');
const {app,Menu,BrowserWindow,ipcMain,dialog,shell,nativeImage,session}=electron;
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const {createStorage,atomicWrite}=require('./lib/storage');
const {createUiState}=require('./lib/ui-state');
const {createBackup,decodeBackup,restoreBackup,validateStores}=require('./lib/backup');
const {createBrowserManager,partitionForStore,allowedMerchantUrl}=require('./lib/browser');
const {createAccountService}=require('./accounts/service');
const {createCredentialService}=require('./accounts/credentials');
const {createSessionPersistence}=require('./accounts/session-persistence');
const {createAutoLogin}=require('./accounts/auto-login');
const {displayUrl}=require('./browser/workspace');
const {workbookBytes,readTable}=require('./lib/spreadsheet');
const {createReviewService}=require('./services/reviews');
const {createPromotionService}=require('./services/promotion');
const {createOperationsService}=require('./services/operations');
const {createComplianceService}=require('./services/compliance');
const {createHostedGiftService}=require('./services/hosted-gift');
const {createComplaintTagService}=require('./services/complaint-tag');
const {createCloudAuthService}=require('./cloud-auth/service');
const {createUpdateService}=require('./update/service');
const {createInsightServices}=require('./insights/service');
const {createBusinessService}=require('./business/service');
const {createBusinessCollector}=require('./business/collector');
// 上品库独立功能区（移植自老软件，存储走本机、不走 NAS/SaaS）
const {createSelectionPoolService}=require('./selectionpool/service');
// 个人淘宝号（复刻老软件）：店铺子账号打开商品页会被要求登录（老软件实测），
// 按商品 ID 读真实类目必须走个人买家账号的独立会话。
const {createPersonalTaobaoService}=require('./personal-taobao');
// 上架驱动（复刻老软件 form-capture-publish 系列）：店铺会话打开发布页、组件级填标题。
const {createPublishDriver}=require('./selectionpool/driver-v2');
const {createPathSettings}=require('./settings/path-settings');
const {selectPackagedDataDir}=require('./lib/data-paths');
const permissionCatalog=require('./shared/permissions');
const {REGISTRY_FILE,assignFolders,storeFolder}=require('./business/store-data');
const {migrateStoreData,writeStoreInfo,folderUsage,clearStoreData,listStoreFolders}=require('./lib/store-migration');
const {version,productName:PRODUCT_NAME}=require('../package.json');
const packagedExecutable=typeof process.execPath==='string'?process.execPath:'';
const STANDALONE_MODE=process.env.XX_STANDALONE==='1'
  ||fsSync.existsSync(path.join(__dirname,'..','standalone.mode'))
  ||Boolean(packagedExecutable&&fsSync.existsSync(path.join(path.dirname(packagedExecutable),'standalone.mode')));

app.setName(PRODUCT_NAME);
app.setAppUserModelId('com.xx.workbench');
const executableDir=typeof process.execPath==='string'&&process.execPath
  ? path.dirname(process.execPath)
  : path.resolve(__dirname,'..');
const packagedDataDir=selectPackagedDataDir(executableDir);
const dataDir=path.resolve(process.env.XX_DATA_DIR||(app.isPackaged?packagedDataDir:path.join(__dirname,'../.dev-data')));
app.setPath('userData',path.join(dataDir,'browser'));
if(!app.requestSingleInstanceLock()){app.quit();}else{start().catch(async e=>{await dialog.showMessageBox({type:'error',title:'谢谢工作台启动失败',message:e.message});app.quit();});}
let mainWindow,storage,browser,services,cloudAuth,insightServices,businessService,businessCollector,sessionPersistence,pathSettings,updateService,stores=[];
let maintenance=false,importBusy=false,shutdownPromise;
const normalizeTheme=value=>value==='dark'?'dark':value==='eye'?'eye':'light';
async function readTheme(){try{return normalizeTheme((await storage.readJson('settings.json',{})).theme);}catch{return 'light';}}
const normalizeSidebar=value=>value==='collapsed'?'collapsed':'pinned';
async function readSidebar(){try{return normalizeSidebar((await storage.readJson('settings.json',{})).sidebar);}catch{return 'pinned';}}
// 顶部标题栏（参考同类工作台）：使用系统窗口按钮 + 自绘顶栏，颜色随深浅模式联动。
const TITLEBAR_COLORS={light:{color:'#f5f6fa',symbolColor:'#4b5468'},dark:{color:'#1b1f28',symbolColor:'#c9d1e0'},eye:{color:'#eef3e7',symbolColor:'#405044'}};
function applyTitleBarOverlay(theme){try{mainWindow?.setTitleBarOverlay?.({...(TITLEBAR_COLORS[theme]||TITLEBAR_COLORS.light),height:44});}catch{}}
const inFlight=new Set();
let visibleStoreCache={at:0,keys:null,rows:[]};
function permissionError(message,code='PERMISSION_DENIED'){const error=new Error(message);error.code=code;return error;}
function requiredActionPermission(action,p={}){
  if(action==='stores.add')return 'workbench.accounts.add';
  if(action==='stores.rename')return 'workbench.accounts.edit';
  if(action==='stores.remove')return 'workbench.accounts.remove';
  if(action.startsWith('credentials.'))return 'workbench.accounts.credentials';
  if(action==='accounts.load'||action==='accounts.refresh')return 'workbench.accounts.view';
  if(['accounts.open','accounts.check','accounts.autoLogin','accounts.ensureBackend','accounts.detectName'].includes(action))return 'workbench.accounts.login';
  if(action==='browser.workspace'||action==='browser.open'||action==='browser.viewport')return 'workbench.browser.view';
  if(['browser.navigateTab','browser.back','browser.forward','browser.reloadTab','browser.homeTab'].includes(action))return 'workbench.browser.navigate';
  if(['browser.newTab','browser.closeTab','browser.activateTab'].includes(action))return 'workbench.browser.tabs';
  if(action==='browser.checkTab'||action==='browser.status')return 'workbench.browser.check';
  if(action==='business.load'||action==='business.detail'||action==='business.uiStateLoad'||action==='business.syncResults')return p.mode==='product'?'workbench.business.product.view':'workbench.business.daily.view';
  if(action==='business.catalogLoad'||action==='business.marksLoad')return 'workbench.business.product.view';
  if(action==='business.trend')return 'workbench.business.product.trend';
  if(action==='business.export')return p.mode==='product'?'workbench.business.product.export':'workbench.business.daily.export';
  if(action==='business.sync'||action==='business.cancel'||action==='business.validationRetry')return Array.isArray(p.storeIds)&&p.storeIds.length>1?'workbench.business.sync.manage':(p.mode==='product'?'workbench.business.product.sync':'workbench.business.daily.sync');
  if(action==='business.catalogSync')return 'workbench.business.product.sync';
  if(action==='business.feesLoad')return 'workbench.business.daily.view';
  if(action==='business.feesSave')return 'workbench.business.fees';
  if(['business.manualSave','business.manualExclude'].includes(action))return 'workbench.business.daily.manual';
  if(['business.markTodo','business.unmarkTodo','business.markBlacklist'].includes(action))return 'workbench.business.product.marks';
  if(['business.open','business.revealSync','business.hideSyncPage'].includes(action))return p.mode==='product'?'workbench.business.product.sync':'workbench.business.daily.sync';
  if(action==='business.uiStateSave')return p.mode==='product'?'workbench.business.product.view':'workbench.business.daily.view';
  if(action.startsWith('reviews.'))return action==='reviews.sync'||action==='reviews.cancel'?'workbench.reviews.sync':action==='reviews.export'?'workbench.reviews.export':action==='reviews.open'?'workbench.reviews.open':'workbench.reviews.view';
  if(action.startsWith('promotion.'))return action==='promotion.sync'?'workbench.promotion.sync':action==='promotion.export'?'workbench.promotion.export':['promotion.saveRule','promotion.deleteRule'].includes(action)?'workbench.promotion.rules':['promotion.run','promotion.pause','promotion.setMode'].includes(action)?'workbench.promotion.execute':'workbench.promotion.view';
  if(action.startsWith('purchase.'))return ['purchase.load','purchase.activities'].includes(action)?'workbench.marketing.purchase.view':['purchase.import','purchase.template'].includes(action)?'workbench.marketing.purchase.import':action==='purchase.export'?'workbench.marketing.purchase.export':['purchase.prepare','purchase.create','purchase.close','purchase.resolveCheck','purchase.save'].includes(action)?'workbench.marketing.purchase.create':'workbench.marketing.purchase.view';
  if(action.startsWith('hostedgift.'))return ['hostedgift.enroll','hostedgift.batchExit'].includes(action)?'workbench.marketing.gift.enroll':action==='hostedgift.export'?'workbench.marketing.gift.export':'workbench.marketing.gift.view';
  if(action.startsWith('complaint.'))return ['complaint.start','complaint.control','complaint.resume','complaint.pause'].includes(action)?'workbench.marketing.complaint.execute':'workbench.marketing.complaint.preview';
  if(action.startsWith('trends.'))return action==='trends.export'?'workbench.selection.trends.export':['trends.capture','trends.cancel','trends.saveFilters'].includes(action)?'workbench.selection.trends.capture':'workbench.selection.trends.view';
  if(action.startsWith('peers.'))return action==='peers.export'?'workbench.selection.peers.export':['peers.capture','peers.cancel'].includes(action)?'workbench.selection.peers.capture':'workbench.selection.peers.view';
  if(action.startsWith('recommendations.'))return action==='recommendations.export'?'workbench.selection.recommendations.export':['recommendations.importPreview','recommendations.importCommit','recommendations.template'].includes(action)?'workbench.selection.recommendations.import':'workbench.selection.recommendations.view';
  if(action.startsWith('compliance.'))return action==='compliance.import'||action==='compliance.importPath'?'workbench.compliance.import':action==='compliance.scan'?'workbench.compliance.scan':['compliance.saveRules','compliance.importRules','compliance.resetRules'].includes(action)?'workbench.compliance.rules':['compliance.updateIssue','compliance.deleteJob','compliance.renameJob'].includes(action)?'workbench.compliance.issues':action==='compliance.export'?'workbench.compliance.export':action==='compliance.billingUpdate'?'workbench.compliance.billing':'workbench.compliance.view';
  // 上品库独立功能区：登录门禁 + 店铺可见范围已在上面统一处理。
  // 细粒度权限码（workbench.selectionpool.*）已登记在 shared/permissions.js 的 GROUPS 里，
  // 但登录中心尚未下发这些新码；为避免「页面能开、动作全被拒」，此处统一挂到
  // 所有角色都具备的 workbench.accounts.view。等登录中心下发新权限后，
  // 可把下面一行替换为按 method 分派的细粒度映射（注释保留在文档里）。
  if(action.startsWith('selectionpool.'))return 'workbench.accounts.view';
  if(action==='settings.load')return 'workbench.settings.view';
  if(action==='settings.save')return p.theme?'workbench.settings.theme':'workbench.settings.view';
if(action==='settings.choosePath'||action==='settings.resetPath'||action==='app.openDataDir')return 'workbench.settings.paths';
  if(action==='data.exportBackup'||action==='data.importBackup')return 'workbench.settings.backup';
  if(action==='settings.clearStoreCache')return 'workbench.settings.cache';
  if(['settings.storeData','settings.openStoreData','settings.clearStoreData'].includes(action))return 'workbench.settings.storeData';
  return null;
}
function payloadStoreIds(action,p={}){
  const ids=[];
  if(typeof p.storeId==='string'&&p.storeId)ids.push(p.storeId);
  if(Array.isArray(p.storeIds))ids.push(...p.storeIds.filter(id=>typeof id==='string'));
  if(action==='stores.rename'||action==='stores.remove')ids.push(String(p.id||''));
  if(['settings.openStoreData','settings.clearStoreData'].includes(action))ids.push(String(p.storeId||''));
  return [...new Set(ids.filter(Boolean))];
}
async function visibleStoreAccess(force=false){
  if(!force&&visibleStoreCache.keys&&Date.now()-visibleStoreCache.at<4000)return visibleStoreCache;
  const data=await cloudAuth.syncStores({stores:stores.map(store=>({id:store.id,name:store.name}))});
  const rows=Array.isArray(data?.stores)?data.stores:[];
  const known=new Set(stores.map(store=>String(store.id)));
  const restored=rows
    .filter(row=>row?.store_key&&row?.name&&!known.has(String(row.store_key)))
    .map(row=>({id:String(row.store_key),name:String(row.name).slice(0,60),createdAt:new Date().toISOString(),restoredFromAuthorization:true}));
  if(restored.length){
    stores=[...stores,...restored];
    await storage.writeJson('stores.json',stores);
    const assigned=assignFolders(stores,storeFolders);
    storeFolders=assigned.registry;
    if(assigned.changed)await storage.writeJson(REGISTRY_FILE,storeFolders);
    for(const store of restored){
      const folder=storeFolders[store.id];
      if(!folder)continue;
      try{
        await migrateStoreData(dataDir,store,folder);
        await writeStoreInfo(dataDir,store,folder);
      }catch(error){
        storeDataWarnings.set(store.id,`授权店铺本机数据恢复未完成：${String(error.message||error).slice(0,200)}`);
      }
    }
  }
  const keys=new Set(Array.isArray(data?.store_keys)?data.store_keys:[]);
  visibleStoreCache={at:Date.now(),keys,rows};
  return visibleStoreCache;
}
async function requireStoreAccess(ids,access=null){
  if(!ids.length)return;
  access=access||await visibleStoreAccess();
  const forbidden=ids.filter(id=>!access.keys.has(id));
  if(forbidden.length)throw permissionError('当前账号无权访问所选店铺，请联系管理员调整店铺范围。','STORE_FORBIDDEN');
}
function filterVisibleResult(action,result,access){
  const keys=access.keys;
  const accessByKey=new Map((access.rows||[]).map(row=>[row.store_key,row]));
  const decorate=store=>{
    const row=accessByKey.get(store.id);
    return row?{...store,access:{scopeType:row.owner_user_id?'user':row.department_id?'department':row.team_id?'team':'unassigned',ownerName:row.owner_name||'',departmentName:row.department_name||'',teamName:row.team_name||''}}:store;
  };
  if(action==='stores.list')return Array.isArray(result)?result.filter(store=>keys.has(store.id)).map(decorate):result;
  if(action==='accounts.load'&&result&&Array.isArray(result.stores))return {...result,stores:result.stores.filter(store=>keys.has(store.id)).map(decorate)};
  if(action==='browser.workspace'&&result&&Array.isArray(result.tabs)){
    const tabs=result.tabs.filter(tab=>!tab.storeId||keys.has(tab.storeId));
    const activeId=tabs.some(tab=>tab.id===result.activeId)?result.activeId:(tabs[0]?.id||null);
    return {...result,tabs,activeId};
  }
  if(action==='settings.storeData'&&result&&Array.isArray(result.entries))return {...result,entries:result.entries.filter(entry=>!entry.id||keys.has(entry.id))};
  if(action==='business.syncResults'&&result&&typeof result==='object'&&!Array.isArray(result)){
    return Object.fromEntries(Object.entries(result).filter(([storeId])=>keys.has(storeId)));
  }
  return result;
}
// 每个店铺一个独立数据文件夹：用户数据/店铺数据/<店铺名>_<ID前8位>/
let storeFolders={},storeDataWarnings=new Map();
// dispatch() 是独立函数，拿不到 start() 里的 getStore（此前“打开文件夹”就因此报 getStore is not defined）。
function storeById(id){const store=stores.find(item=>item.id===id);if(!store)throw new Error('请先选择有效店铺');return store;}
const folderFor=storeId=>{const folder=storeFolders[storeId];return folder?storeFolder(folder):null;};
const uiFile=path.resolve(__dirname,'renderer/index.html');
app.on('second-instance',()=>{
  if(mainWindow&&!mainWindow.isDestroyed()){
    if(mainWindow.isMinimized())mainWindow.restore();
    mainWindow.show();mainWindow.focus();
    return;
  }
  // 主窗口已经不在了却还占着单实例锁（异常退出/窗口被销毁）：直接重启，
  // 否则用户双击 exe 会「安静地什么都没发生」（用户 2026-11-12 的现象）。
  try{app.relaunch();}catch{}
  app.exit(0);
});
async function start(){
  await fs.mkdir(dataDir,{recursive:true});
  storage=createStorage(dataDir);stores=await storage.readJson('stores.json',[]);
  const uiState=createUiState(storage);
  validateStores(stores);
  // 为每家店铺分配稳定的数据文件夹，并把旧版哈希目录迁移进去（失败只记录，不阻断启动）。
  const assigned=assignFolders(stores,await storage.readJson(REGISTRY_FILE,{}).catch(()=>({})));
  storeFolders=assigned.registry;
  if(assigned.changed)await storage.writeJson(REGISTRY_FILE,storeFolders).catch(()=>{});
  for(const store of stores){
    const folder=storeFolders[store.id];if(!folder)continue;
    try{await migrateStoreData(dataDir,store,folder);await writeStoreInfo(dataDir,store,folder);storeDataWarnings.delete(store.id);}
    catch(error){storeDataWarnings.set(store.id,`店铺数据迁移未完成：${String(error.message||error).slice(0,200)}`);}
  }
  if(!await fs.stat(path.join(dataDir,'stores.json')).catch(()=>null))await storage.writeJson('stores.json',stores);
  const programDir=app.isPackaged?path.dirname(process.execPath):path.resolve(__dirname,'..');
  pathSettings=createPathSettings({dataDir,appDir:programDir,sourceDir:path.resolve(__dirname,'..'),...storage,dialog,getWindow:()=>mainWindow,
    defaultExportDir:app.getPath?.('documents'),protectedDirs:[process.env.WINDIR,process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.ProgramData,process.env.APPDATA,process.env.LOCALAPPDATA,
      path.join(path.dirname(programDir),'谢谢工作台源码'),path.join(path.dirname(programDir),'谢谢工作台更新')]});
  await pathSettings.initialize();
  app.on('session-created',merchantSession=>pathSettings.configureSession(merchantSession));
  await app.whenReady();
  // 按用户要求：去掉应用菜单，按住 Alt 不再弹出 File/Edit/View/Window 菜单栏。
  Menu?.setApplicationMenu?.(null);
  pathSettings.configureSession(session.defaultSession);
  sessionPersistence=createSessionPersistence({dataDir,safeStorage:electron.safeStorage});
  // Keep the Chinese product name in the UI; HTTP headers require an ASCII token.
  if(typeof app.userAgentFallback==='string')app.userAgentFallback=app.userAgentFallback.replace(new RegExp(PRODUCT_NAME,'g'),'XXWorkbench');
  if(await fs.stat(path.join(dataDir,'relogin-required.json')).catch(()=>null)){
    await sessionPersistence.forgetAll();
    for(const store of stores){const accountSession=session.fromPartition(partitionForStore(store.id));await accountSession.clearStorageData();await accountSession.clearCache();await accountSession.flushStorageData();await accountSession.cookies.flushStore();}
    await fs.unlink(path.join(dataDir,'relogin-required.json'));
  }
  const resourceDir=app.isPackaged?path.join(process.resourcesPath,'app','assets'):path.join(__dirname,'../assets');
  // 违规排查的 OCR 运行时（开源 Tesseract）：打包后在 resources/ocr，开发时在项目里的 resources/ocr。
  const ocrDir=app.isPackaged?path.join(process.resourcesPath,'ocr'):path.join(__dirname,'../resources/ocr');
  const icon=path.join(resourceDir,'icon.png');
  const getStore=id=>{const s=stores.find(x=>x.id===id);if(!s)throw new Error('请先添加并选择店铺');return s;};
  const emit=payload=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('xx:progress',payload);};
  browser=createBrowserManager({electron,getStore,emit,icon,sessionPersistence,getHostWindow:()=>mainWindow,beforeLoad:(wc,kind)=>insightServices?.prepare(wc,kind)});
  const files={
    async exportWorkbook(defaultName,sheets){const result=await dialog.showSaveDialog(mainWindow,{title:'导出表格',defaultPath:await pathSettings.exportPath(defaultName),filters:[{name:'Excel工作簿',extensions:['xlsx']}]});if(result.canceled)return {canceled:true};const bytes=workbookBytes(sheets);await fs.writeFile(result.filePath,bytes);return {path:result.filePath,canceled:false};},
    exportRows(defaultName,rows,columns){return this.exportWorkbook(defaultName,[{name:'数据',rows,columns}]);},
    // 只选路径不解析：违规排查的大表要在独立线程里解析，主线程/界面才不会卡住。
    async pickTablePath(){
      const options={title:'选择要导入的数据表',properties:['openFile'],filters:[{name:'Excel或CSV',extensions:['xlsx','xlsm','csv']}]};
      const lastDir=await uiState.lastImportDir();
      if(lastDir)options.defaultPath=lastDir;
      const result=await dialog.showOpenDialog(mainWindow,options);
      if(result.canceled)return {canceled:true};
      const file=result.filePaths[0];
      const dir=path.dirname(file);
      if(dir&&dir!==lastDir)await uiState.rememberImportDir(dir);
      const stat=await fs.stat(file);
      return {path:file,name:path.basename(file),size:stat.size};
    },
    async pickImport(){
      const picked=await files.pickTablePath();
      if(picked.canceled)return picked;
      if(picked.size>50*1024*1024)throw new Error('表格超过50MB，请分批导入');
      return {path:picked.path,rows:readTable(await fs.readFile(picked.path),path.extname(picked.path))};
    },
    async pickImage(){const result=await dialog.showOpenDialog(mainWindow,{title:'选择真实标签图片',properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}]});return result.canceled?{canceled:true}:{path:result.filePaths[0]};}
  };
  // Bind methods so they may also be destructured by services.
  files.exportRows=files.exportRows.bind(files);
  files.pickImport=files.pickImport.bind(files);
  files.pickTablePath=files.pickTablePath.bind(files);
  const ctx={dataDir,resourceDir,ocrDir,getStore,listStores:()=>stores.map(store=>({...store})),...storage,browser,files,emit,nativeImage,storeFolder:folderFor,appVersion:version,
    // 上品库「类目采集 / 类目树」的只读页面探测：用店铺自己的登录会话开一个隐藏窗口，
    // 只执行传入的只读 JS（不提交表单、不点击、不下载），用完立刻销毁。
    // personal:true 时改用「个人淘宝号」会话——店铺子账号打开商品页会被淘宝要求重新登录（老软件实测），
    // 按商品 ID 读真实类目必须走个人买家账号（persist:xx-personal-taobao）。
    // 与老软件不共享任何目录 / 配置 / 标记，纯新软件实现。
    // 老软件行为：页面加载失败（超时/跳转中）不立即报错，让探测脚本判断页面状态——
    // 登录过期时先出中间页，2–3 秒后才跳登录页，加载结果带回 loadError 由调用方重试。
    probePage:async({storeId,url,script,timeoutMs=20000,waitMs=1500,personal=false}={})=>{
      const target=String(url||'').trim();
      if(!allowedMerchantUrl(target))throw new Error('仅支持 https 且不带账号密码的网址');
      let win=null;
      try{
        const partition=personal?'persist:xx-personal-taobao':(storeId?partitionForStore(String(storeId)):'persist:xx-category-probe');
        win=new electron.BrowserWindow({show:false,width:1280,height:900,webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,javascript:true}});
        win.webContents.on('will-navigate',(e,next)=>{if(!allowedMerchantUrl(next))e.preventDefault();});
        let loadError='';
        try{
          await Promise.race([win.loadURL(target),new Promise((_,reject)=>setTimeout(()=>reject(new Error('页面打开超时')),30000))]);
        }catch(error){loadError=String(error&&error.message||error).slice(0,120);}
        if(waitMs)await new Promise(resolve=>setTimeout(resolve,Math.min(Number(waitMs)||0,5000)));
        const result=await Promise.race([
          win.webContents.executeJavaScript(String(script||''),true),
          new Promise((_,reject)=>setTimeout(()=>reject(new Error('只读探测超时')),Math.max(3000,Number(timeoutMs)||20000)))
        ]);
        if(result&&typeof result==='object')result.loadError=loadError;
        return result;
      }finally{if(win&&!win.isDestroyed())win.destroy();}
    }};
  ctx.storeRoot=()=>path.join(dataDir,'店铺数据');
  // 本机标记（待办/黑名单）记录操作账号：使用 Windows 登录账号名，不读取任何平台凭据。
  ctx.currentAccount=()=>{try{return require('node:os').userInfo().username;}catch{return '';}};
  const credentials=createCredentialService({...ctx,safeStorage:electron.safeStorage});
  const autoLogin=createAutoLogin({browser,credentials});
  ctx.autoLogin=autoLogin;
  cloudAuth=createCloudAuthService({
    dataDir,
    storage,
    safeStorage:electron.safeStorage,
    appVersion:version,
    standalone:STANDALONE_MODE,
    listLocalStores:()=>stores.map(store=>({id:store.id,name:store.name})),
    createLocalStore:async name=>{
      const before=new Set(stores.map(store=>store.id));
      const rows=await dispatch('stores.add',{name:String(name||'').trim()},ctx);
      const created=(Array.isArray(rows)?rows:stores).find(store=>!before.has(store.id));
      if(!created)throw new Error('店铺创建后未能取得店铺编号');
      return created;
    },
    removeLocalStore:async storeId=>{
      await dispatch('stores.remove',{id:String(storeId||''),confirmed:true},ctx);
    },
    renameLocalStore:async(storeId,name)=>{
      await dispatch('stores.rename',{id:String(storeId||''),name:String(name||'').trim()},ctx);
    },
  });
  const operations=createOperationsService(ctx);
  // 个人淘宝号：先于上品库创建，登录态检查挂 ctx.probePersonalSource（上品库读类目时预检查，
  // 未登录直接引导登录，不空跑五次探测）。
  const personalTaobaoService=createPersonalTaobaoService({electron,emit,getWindow:()=>mainWindow});
  ctx.probePersonalSource=async()=>personalTaobaoService.loggedIn();
  insightServices=createInsightServices(ctx);
  businessCollector=createBusinessCollector(ctx);
  businessService=createBusinessService(ctx,{collector:businessCollector});
  services={credentials,autoLogin,cloudauth:cloudAuth,accounts:createAccountService(ctx),reviews:createReviewService(ctx),promotion:createPromotionService(ctx),compliance:createComplianceService(ctx),hostedgift:createHostedGiftService(ctx),complaint:createComplaintTagService(ctx),purchase:{handle:operations.handlePurchase},qualification:{handle:operations.handleQualification},operations,
    business:businessService,trends:insightServices.trends,peers:insightServices.peers,recommendations:insightServices.recommendations,insights:insightServices,
    // 上品库独立功能区：dispatch 的通用路由 services[module].handle(method,p) 自动生效。
    selectionpool:createSelectionPoolService(ctx,{dialog:electron.dialog,
      // 独立发布页弹窗（用户要求：人工补全/滑块直接在单独窗口里做，不跳店铺浏览器页面）。
      // 店铺 partition 复用登录会话；窗口交给用户操作，关闭即回收。
      openWindow:async({storeId,url,title}={})=>{
        const target=String(url||'').trim();
        if(!allowedMerchantUrl(target))throw new Error('仅支持 https 的发布页地址');
        // 只留一个发布页窗口：上架驱动已经开过一个（里面是填好的表单）时直接复用，
        // 不再新开第二个（用户 2026-11-12「弹出手动调整后还是两个窗口」）。
        const isPublish=u=>/sell\.publish\.tmall\.com|sell\.tmall\.com\/.*publish|\/publish\.htm/i.test(String(u||''));
        const catOf=u=>{try{return new URL(String(u)).searchParams.get('catId')||'';}catch{return '';}};
        const existing=electron.BrowserWindow.getAllWindows().find(w=>{
          if(!w||w===mainWindow||w.isDestroyed?.())return false;
          try{return isPublish(w.webContents.getURL());}catch{return false;}
        });
        if(existing){
          try{
            const cur=(()=>{try{return String(existing.webContents.getURL()||'');}catch{return '';}})();
            // 同一件商品（catId 相同）只前置显示，绝不重载，免得把用户正在改的表单冲掉
            const same=cur===target||(catOf(cur)&&catOf(cur)===catOf(target));
            if(!same)await existing.loadURL(target).catch(()=>undefined);
            existing.show();existing.focus();
            return {ok:true,reused:true};
          }catch{/* 复用失败再走新建 */}
        }
        const win=new electron.BrowserWindow({width:1500,height:1000,minWidth:1200,minHeight:800,
          title:String(title||'发布页'),
          webPreferences:{partition:partitionForStore(String(storeId||'')),contextIsolation:true,nodeIntegration:false,sandbox:true}});
        try{win.webContents.setAudioMuted(false);}catch{}
        win.webContents.on('will-prevent-unload',e=>{e.preventDefault();});
        // 发布页（天猫）会挂 beforeunload 拦关闭，点 × 看起来没反应。
        // 这里兜一层：close 事件先 preventDefault 再 destroy，保证 × 立刻关得掉（页面数据不需要保存）。
        let forceClosing=false;
        win.on('close',event=>{
          if(forceClosing)return;
          forceClosing=true;
          try{event.preventDefault();}catch{}
          setTimeout(()=>{try{win.destroy();}catch{}},30);
        });
        await win.loadURL(target).catch(()=>undefined);
        try{win.show();win.focus();}catch{}
        return {ok:true};
      }}),
    // 个人淘宝号：上品库读商品真实类目的登录会话（店铺子账号打开商品页会被要求重新登录，老软件实测）。
    personaltaobao:personalTaobaoService};
  // 上架驱动：店铺会话打开发布页（复刻老软件 form-capture-publish 链路），autoShelf 经 driver.publish 调用。
  services.selectionpool.setDriver(createPublishDriver({electron,partitionForStore,log:emit,dataDir}));
  ctx.ensureBackend=(payload,options)=>services.accounts.ensureBackend(payload,options);
  ctx.readAccountState=storeId=>services.accounts.readState(storeId);
  // service 构造时 ctx.readAccountState 尚未赋值，此处按引用补挂，运行时可正常调用。
  // 在线更新：更新源固定为线上目录，可用 XX_UPDATE_URL 覆盖（自测时指向本机）。
  updateService=createUpdateService({
    appDir:path.resolve(__dirname,'..'),
    dataDir,
    currentVersion:version,
    onEvent:payload=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('xx:update',payload);},
    // 先按正常退出流程落盘（最多等 5 秒），再重启并硬退出：
    // 走 app.quit() 会被 before-quit 里的 preventDefault 拦一次，relaunch 在部分环境不会生效。
    relaunch:()=>{
      Promise.resolve()
        .then(()=>Promise.race([finishShutdown(),new Promise(resolve=>setTimeout(resolve,5000))]))
        .catch(()=>{})
        .finally(()=>{try{app.relaunch();}catch{}app.exit(0);});
    },
  });
  mainWindow=new BrowserWindow({width:1400,height:900,minWidth:920,minHeight:640,show:false,title:PRODUCT_NAME,icon,autoHideMenuBar:true,backgroundColor:'#f5f6fa',titleBarStyle:'hidden',titleBarOverlay:{color:TITLEBAR_COLORS.light.color,symbolColor:TITLEBAR_COLORS.light.symbolColor,height:44},webPreferences:{preload:path.join(__dirname,'preload.js'),nodeIntegration:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false}});
  void readTheme().then(applyTitleBarOverlay);
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(e,url)=>{if(url!==pathToFileURL(uiFile).href)e.preventDefault();});
  mainWindow.webContents.on('will-redirect',(e,url)=>{if(url!==pathToFileURL(uiFile).href)e.preventDefault();});
  mainWindow.webContents.on('will-attach-webview',event=>event.preventDefault());
  mainWindow.once('ready-to-show',()=>{if(process.env.XX_TEST_HIDDEN!=='1')mainWindow.show();});
  // 兜底显示：万一 ready-to-show 没触发（渲染层首帧失败），8 秒后也把窗口显示出来，
  // 不能让软件「在跑但看不见」，否则用户只会看到双击没反应。
  mainWindow.webContents.once('did-finish-load',()=>{
    setTimeout(()=>{try{if(process.env.XX_TEST_HIDDEN!=='1'&&mainWindow&&!mainWindow.isDestroyed()&&!mainWindow.isVisible())mainWindow.show();}catch{}},8000);
  });
  ipcMain.handle('xx:call',async(event,action,payload)=>{
    if(!mainWindow||mainWindow.isDestroyed()||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame||event.senderFrame.url!==pathToFileURL(uiFile).href)return {ok:false,error:'来源验证失败'};
    if(typeof action!=='string'||!/^[a-z]+\.[a-zA-Z]+$/.test(action)||!payload||typeof payload!=='object'||Array.isArray(payload))return {ok:false,error:'参数格式错误'};
    // 更新不需要登录态，也不参与权限校验，直接交给更新服务。
    if(action.startsWith('update.')){
      if(!updateService)return {ok:false,error:'更新服务尚未就绪'};
      try{return {ok:true,data:await updateService.handle(action.slice(7),payload)};}
      catch(e){return {ok:false,error:{code:String(e?.code||'UPDATE_ERROR'),message:String(e?.message||e),details:{}}};}
    }
    if(maintenance||quitting)return {ok:false,error:'正在停止服务或恢复数据，请等待工作台重新启动。'};
    if(importBusy&&action!=='data.importBackup')return {ok:false,error:'请先完成或取消当前的数据恢复文件选择。'};
    if(action==='data.importBackup'&&importBusy)return {ok:false,error:'已有一个数据恢复操作正在进行。'};
    const allowedBeforeLogin=action==='app.info'||action==='browser.viewport'||action.startsWith('cloudauth.');
    if(!cloudAuth?.hasSession()&&!allowedBeforeLogin){
      // Renderer may finish login just before a stale IPC request reaches main.
      // Coalesce encrypted-session restoration so startup requests do not race each other.
      if(typeof cloudAuth?.ensureSession==='function')await cloudAuth.ensureSession().catch(()=>false);
      else await cloudAuth.handle('status',{}).catch(()=>null);
    }
    if(!cloudAuth?.hasSession()&&!allowedBeforeLogin)return {ok:false,error:{code:'AUTH_REQUIRED',message:'请先登录全域中枢。',details:{}}};
    if(action==='data.importBackup')importBusy=true;
    const request={action,promise:null};
    request.promise=Promise.resolve().then(async()=>{
      if(action==='app.info'||action==='browser.viewport'||action.startsWith('cloudauth.'))return dispatch(action,payload,ctx);
      const permission=requiredActionPermission(action,payload);
      if(permission){
        await cloudAuth.ensurePermissionsFresh?.().catch(()=>false);
        if(!cloudAuth.hasPermission(permission)){
          // 本地缓存可能还没收到刚下达的授权；判定无权限时强制核对一次再拒绝。
          await cloudAuth.ensurePermissionsFresh?.(0).catch(()=>false);
          if(!cloudAuth.hasPermission(permission))throw permissionError('当前账号没有执行这个功能的权限，请联系公司管理员。');
        }
      }
      const requestedStoreIds=payloadStoreIds(action,payload);
      const accessBefore=await visibleStoreAccess();
      await requireStoreAccess(requestedStoreIds,accessBefore);
      const oldStore=action==='stores.rename'?storeById(payload.id):null;
      const oldStoreName=oldStore?.name;
      const beforeStoreIds=new Set(stores.map(store=>store.id));
      if(action==='stores.remove'){
        await cloudAuth.handle('removeStore',{id:payload.id});
      }
      let result;
      const scopedPayload=action==='accounts.load'?{...payload,allowedStoreIds:[...accessBefore.keys]}:payload;
      try{result=await dispatch(action,scopedPayload,ctx);}
      catch(error){
        if(action==='stores.remove'){
          const store=stores.find(item=>item.id===payload.id);
          if(store)await cloudAuth.handle('registerStore',{id:store.id,name:store.name}).catch(()=>{});
        }
        throw error;
      }
      if(action==='stores.add'){
        const created=Array.isArray(result)?result.find(store=>!beforeStoreIds.has(store.id)):null;
        if(created){
          try{await cloudAuth.handle('registerStore',{id:created.id,name:created.name});}
          catch(error){
            stores=stores.filter(store=>store.id!==created.id);
            await storage.writeJson('stores.json',stores);
            throw error;
          }
        }
      }
      if(action==='stores.rename'&&oldStore){
        try{await cloudAuth.handle('renameStore',{id:oldStore.id,name:String(payload.name||'')});}
        catch(error){
          oldStore.name=oldStoreName;
          await storage.writeJson('stores.json',stores);
          throw error;
        }
      }
      if(['stores.add','stores.rename','stores.remove'].includes(action))visibleStoreCache={at:0,keys:null,rows:[]};
      const access=['stores.add','stores.rename','stores.remove'].includes(action)?await visibleStoreAccess(true):accessBefore;
      const finalResult=filterVisibleResult(action,result,access);
      if(['cloudauth.addManagedStore','cloudauth.removeManagedStore','cloudauth.renameStore','cloudauth.saveManagedStoreGrants','cloudauth.setManagedStoreUserAccess'].includes(action))visibleStoreCache={at:0,keys:null,rows:[]};
      return finalResult;
    });inFlight.add(request);
    try{return {ok:true,data:await request.promise};}catch(e){
      const message=(String(e.platformResponse?.message||e.message||e)+(maintenance&&!quitting?' 服务已停止，请保留恢复前备份并关闭、重新启动工作台。':'')).replace(/Bearer\s+\S+/gi,'Bearer [已隐藏]').slice(0,1600);
      if(e?.code&&/^[A-Z0-9_]{2,80}$/.test(String(e.code)))return {ok:false,error:{code:String(e.code),message,details:e.details&&typeof e.details==='object'?e.details:{}}};
      return {ok:false,error:message};
    }
    finally{inFlight.delete(request);if(action==='data.importBackup')importBusy=false;}
  });
  await mainWindow.loadFile(uiFile);
  // 启动看门狗：15 秒后还没有可见主窗口就强制显示；连窗口都没了就退出，
  // 避免留下「占着单实例锁却不显示界面」的僵尸进程（用户只能重启电脑才能再打开）。
  setTimeout(()=>{
    try{
      if(!mainWindow||mainWindow.isDestroyed()){app.exit(1);return;}
      if(process.env.XX_TEST_HIDDEN!=='1'&&!mainWindow.isVisible())mainWindow.show();
    }catch{}
  },15000).unref?.();
  // 启动 8 秒后静默检查一次，之后每 6 小时一次；失败不打扰用户。
  updateService?.start();
  mainWindow.on('closed',()=>{mainWindow=null;app.quit();});
  if(process.env.XX_SCREENSHOT_PATH){await new Promise(r=>setTimeout(r,1000));const image=await mainWindow.webContents.capturePage();await fs.writeFile(process.env.XX_SCREENSHOT_PATH,image.toPNG());}
}
async function dispatch(action,p,ctx){
  const [module,method]=action.split('.');
  if(action==='app.openExternal'){const url=String(p?.url||'');if(!/^https?:\/\//i.test(url))return {ok:false,message:'只允许 http(s) 地址'};const title=String(p?.title||'商品视频');const html='<!doctype html><meta charset="utf-8"><title>'+title.replace(/[<>&]/g,'')+'</title><style>html,body{margin:0;height:100%;background:#111;display:flex;align-items:center;justify-content:center}video{max-width:100%;max-height:100%}</style><video src="'+url.replace(/"/g,'%22')+'" controls autoplay playsinline></video>';const w=new BrowserWindow({width:960,height:600,title,backgroundColor:'#111'});w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html)).catch(()=>{});return {ok:true};}
  if(action==='app.info')return {name:PRODUCT_NAME,version,dataDir,mode:'联网登录版',authMode:'login-center',appId:'1001',aiEnabled:false,electron:process.versions.electron,theme:await readTheme(),sidebar:await readSidebar(),paths:pathSettings.view()};
  if(action==='app.openDataDir'){await shell.openPath(dataDir);return {path:dataDir};}
  if(module==='stores'){
    if(method==='list')return stores;
    if(method==='add'){
      // An empty name is allowed: the store is created with a temporary label
      // and the visible 千牛店名 fills it in after the first login.
      const requested=String(p.name||'').trim();
      if(requested.length>60)throw new Error('店铺名称需为1–60个字符');
      if(requested&&stores.some(s=>s.name===requested))throw new Error('已存在同名店铺');
      let name=requested;
      if(!name){let index=stores.length+1;while(stores.some(s=>s.name===`新店铺${index}`))index++;name=`新店铺${index}`;}
      const store={id:randomUUID(),name,...(requested?{}:{pendingName:true}),createdAt:new Date().toISOString()};stores=[...stores,store];await storage.writeJson('stores.json',stores);return stores;
    }
    if(method==='rename'){const store=ctx.getStore(p.id),name=String(p.name||'').trim();if(!name||name.length>60)throw new Error('店铺名称需为1–60个字符');if(stores.some(s=>s.id!==store.id&&s.name===name))throw new Error('店铺名称已存在');store.name=name;delete store.pendingName;await storage.writeJson('stores.json',stores);return stores;}
    if(method==='remove'){ctx.getStore(p.id);if(p.confirmed!==true)throw new Error('移除店铺前请确认');await services.reviews.handle('cancel',{storeId:p.id});await services.promotion.handle('setMode',{storeId:p.id,mode:'observe'});await insightServices.cancelStore(p.id);await businessService.cancelStore(p.id);await services.autoLogin.cancel?.(p.id);await browser.closeStore(p.id,{forget:true});stores=stores.filter(s=>s.id!==p.id);await storage.writeJson('stores.json',stores);
      // 移除店铺只解除映射：数据文件夹保留在“店铺数据”里，可在设置页查看或清理。
      if(storeFolders[p.id]){delete storeFolders[p.id];await storage.writeJson(REGISTRY_FILE,storeFolders).catch(()=>{});}
      return stores;}
  }
  if(module==='browser'){
    if(['workspace','activateTab','closeTab','navigateTab','back','forward','reloadTab','homeTab','viewport','checkTab'].includes(method))return browser.handleWorkspace(method,p);
    if(method==='open'){
      const wc=await browser.show(p.storeId,p.kind||'orders');
      if(p.kind==='purchase'&&p.view==='activities')await wc.loadURL('https://myseller.taobao.com/home.htm/private-domain-workbench/activityList');
      if(p.kind==='purchase'&&p.view==='create')await wc.loadURL('https://myseller.taobao.com/home.htm/CRM-Workbench/ecrm-sop-form/Shop-Activities');
      // 上品库「打开店铺页面手动补全参数」：允许显式指定发布页 / 商品页地址。
      // 只放行 https 且不带账号密码的网址，其余一律忽略，沿用该店铺已登录的会话。
      const explicit=String(p.url||'').trim();
      if(explicit&&allowedMerchantUrl(explicit))await wc.loadURL(explicit);
      return {url:displayUrl(wc.getURL()),message:'请核对后台店铺名称，完成登录或安全验证后返回工作台同步。'};
    }
    if(method==='newTab')return browser.openUserTab(p.storeId,p.kind||'seller',String(p.url||'').trim());
    if(method==='status')return browser.status(p.storeId);
  }
  if(action==='settings.load')return {...await storage.readJson('settings.json',{ai:{enabled:false,baseUrl:'',model:'',note:''}}),theme:await readTheme(),sidebar:await readSidebar(),dataDir,version,paths:pathSettings.view()};
  if(action==='settings.storeData'){
    // 设置页展示“每个店铺一个文件夹”的实际位置与占用，并列出已移除店铺留下的文件夹。
    // folderFor() 返回的是“店铺数据/<文件夹名>”相对路径，不能再拼一次“店铺数据”。
    const directory=name=>path.join(dataDir,name);
    const entries=[];
    for(const store of stores){
      const folder=folderFor(store.id);if(!folder)continue;
      let usage={bytes:0,files:0};
      try{usage=await folderUsage(directory(folder));}catch{}
      entries.push({id:store.id,name:store.name,folder,path:directory(folder),bytes:usage.bytes,files:usage.files,warning:storeDataWarnings.get(store.id)||null});
    }
    const known=new Set(Object.values(storeFolders)),orphans=[];
    for(const name of await listStoreFolders(dataDir)){
      if(known.has(name))continue;
      let usage={bytes:0,files:0};
      const orphanPath=path.join(dataDir,'店铺数据',name);
      try{usage=await folderUsage(orphanPath);}catch{}
      orphans.push({name,path:orphanPath,bytes:usage.bytes,files:usage.files});
    }
    return {root:path.join(dataDir,'店铺数据'),entries,orphans};
  }
  if(action==='settings.openStoreData'){
    const store=storeById(p.storeId),folder=folderFor(store.id);
    if(!folder)throw new Error('该店铺尚未分配数据文件夹');
    const dir=path.join(dataDir,folder);
    await fs.mkdir(dir,{recursive:true});
    const opened=await shell.openPath(dir);
    // 个别环境下 shell.openPath 会返回错误字符串（资源管理器未接管），退回用 explorer.exe 打开。
    if(opened){
      try{require('node:child_process').spawn('explorer.exe',[dir],{detached:true}).unref();}
      catch{throw new Error('无法打开该店铺的数据文件夹：'+opened);}
    }
    return {path:dir,message:'已打开该店铺的数据文件夹'};
  }
  if(action==='settings.clearStoreData'){
    if(p.confirmed!==true)throw new Error('清理店铺数据前请先确认');
    // 允许清理“已移除店铺”留下的文件夹，但只接受本机真实存在的文件夹名。
    if(p.folder!==undefined){
      const wanted=String(p.folder||'').trim();
      const listed=await listStoreFolders(dataDir);
      if(!wanted||!listed.includes(wanted)||Object.values(storeFolders).includes(wanted))throw new Error('该数据文件夹不可清理');
      await clearStoreData(dataDir,wanted);
      return {message:`已清理数据文件夹“${wanted}”。`};
    }
    const store=storeById(p.storeId),folder=folderFor(store.id);
    if(!folder)throw new Error('该店铺尚未分配数据文件夹');
    // 先停止该店铺正在运行的读取任务，再删除它自己的文件夹；其他店铺不受影响。
    await businessService.cancel(store.id);
    await services.reviews.handle('cancel',{storeId:store.id});
    await new Promise(resolve=>setTimeout(resolve,300));
    await clearStoreData(dataDir,folder);
    await writeStoreInfo(dataDir,store,folder);
    return {message:`已清理“${store.name}”的本机业务数据（日报、精细化、评价与标记）；店铺登录状态未改动。`};
  }
  if(action==='settings.choosePath')return pathSettings.handle('choose',p);
  if(action==='settings.resetPath')return pathSettings.handle('reset',p);
  if(action==='settings.clearStoreCache'){
    // Only regenerable web caches are cleared. Cookies, sessions, saved
    // accounts and business data stay untouched, so no store is logged out.
    const ids=Array.isArray(p.storeIds)?p.storeIds:[];
    if(!ids.length)throw new Error('请选择要清除缓存的店铺');
    if(ids.length>50)throw new Error('一次最多清除50家店铺的缓存');
    const cleared=[];
    for(const id of ids){
      const store=storeById(id);
      const target=session.fromPartition(partitionForStore(store.id));
      const before=await target.getCacheSize().catch(()=>0);
      await target.clearCache();
      if(typeof target.clearCodeCaches==='function')await target.clearCodeCaches({});
      if(typeof target.clearHostResolverCache==='function')await target.clearHostResolverCache();
      await target.flushStorageData?.();
      const after=await target.getCacheSize().catch(()=>0);
      cleared.push({id:store.id,name:store.name,beforeBytes:before,afterBytes:after});
    }
    return {cleared,message:`已清除 ${cleared.length} 家店铺的网页缓存；登录状态、账号和业务数据未改动。`};
  }
  if(action==='settings.save'){
    const incoming=p.settings||p;const previous=await storage.readJson('settings.json',{});
    const theme=normalizeTheme(incoming.theme!==undefined?incoming.theme:previous.theme);
    const sidebar=normalizeSidebar(incoming.sidebar!==undefined?incoming.sidebar:previous.sidebar);
    const settings={theme,sidebar,ai:{enabled:false,baseUrl:String(incoming.ai?.baseUrl||incoming.baseUrl||previous.ai?.baseUrl||'').slice(0,300),model:String(incoming.ai?.model||incoming.model||previous.ai?.model||'').slice(0,100),note:String(incoming.ai?.note||incoming.note||previous.ai?.note||'').slice(0,1000)}};
    await storage.writeJson('settings.json',settings);applyTitleBarOverlay(theme);return {...settings,dataDir,version,paths:pathSettings.view(),message:'设置已保存。AI功能尚未启用，不会调用接口。'};
  }
  if(action==='data.exportBackup')return exportBackup();
  if(action==='data.importBackup')return importBackup(p);
  if(services[module]?.handle)return services[module].handle(method,p);
  throw new Error('暂不支持此操作：'+action);
}
async function exportBackup(){
  const r=await dialog.showSaveDialog(mainWindow,{title:'备份本机业务数据（不含登录状态）',defaultPath:await pathSettings.exportPath(`谢谢工作台_数据备份_${new Date().toISOString().slice(0,10)}.zip`),filters:[{name:'ZIP备份',extensions:['zip']}]});if(r.canceled)return {canceled:true};
  await storage.flush();const bytes=await createBackup(dataDir,version);await fs.writeFile(r.filePath,bytes);return {path:r.filePath,message:'业务数据已备份；新电脑需要重新登录店铺。'};
}
async function importBackup(p){
  if(p.confirmed!==true)throw new Error('恢复备份将替换当前业务数据，请先确认并备份现有数据');
  if(browser.hasPages())throw new Error('请重新启动软件，并在打开任何店铺页面之前恢复数据');
  const r=await dialog.showOpenDialog(mainWindow,{title:'恢复谢谢工作台数据备份',properties:['openFile'],filters:[{name:'ZIP备份',extensions:['zip']}]});if(r.canceled)return {canceled:true};
  if((await fs.stat(r.filePaths[0])).size>500*1024*1024)throw new Error('备份文件过大');
  const decoded=decodeBackup(await fs.readFile(r.filePaths[0]));
  maintenance=true;
  await stopServices();
  await sessionPersistence.forgetAll();
  await drainRequests('data.importBackup');
  await storage.sealWrites();
  const result=await restoreBackup(dataDir,decoded);
  await atomicWrite(dataDir,'relogin-required.json',JSON.stringify({restoredAt:new Date().toISOString()}));
  stores=result.stores;
  await dialog.showMessageBox(mainWindow,{type:'info',title:'数据恢复完成',message:'旧业务数据已保留在“恢复前备份”。软件将重启，店铺需重新登录；推广仍需手动启用。'});
  app.relaunch();setImmediate(()=>app.quit());return {message:'恢复完成，正在重启',previous:result.previous};
}
let quitting=false;
async function stopServices(){
  if(!shutdownPromise)shutdownPromise=(async()=>{
    const tasks=[...new Set(Object.values(services||{}))].map(service=>Promise.resolve().then(()=>service.dispose?.()));
    const results=await Promise.allSettled(tasks);
    await browser?.dispose();
    const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
  })();
  return shutdownPromise;
}
async function drainRequests(exceptAction){
  await Promise.allSettled([...inFlight].filter(request=>request.action!==exceptAction).map(request=>request.promise));
}
async function finishShutdown(){
  const results=[];
  // Even a session-encryption failure must not bypass pending business writes.
  // Keep shutdown order, collect errors, and show them only after every drain.
  for(const task of [stopServices,()=>drainRequests('data.importBackup'),()=>storage?.sealWrites()]){
    results.push(...await Promise.allSettled([Promise.resolve().then(task)]));
  }
  const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
}
app.on('before-quit',event=>{
  if(quitting)return;quitting=true;event.preventDefault();
  maintenance=true;
  // 退出必须有硬上限：任何一步 drain 卡住（本地接收端口的 keep-alive、浏览器会话刷新…）
  // 都不能让进程活着却又没有窗口——那种状态会一直占着单实例锁，用户再双击 exe 就「没反应」。
  const finish=result=>{
    if(result&&result!=='ok'&&result!=='timeout'){
      try{fsSync.appendFileSync(path.join(dataDir,'shutdown-error.log'),`[${new Date().toISOString()}] ${String(result&&result.stack||result&&result.message||result)}\n`);}catch{}
    }
    try{app.exit(0);}catch{try{app.quit();}catch{}}
  };
  Promise.race([
    Promise.resolve().then(finishShutdown).then(()=> 'ok').catch(error=>error),
    new Promise(resolve=>{try{setTimeout(()=>resolve('timeout'),6000).unref?.();}catch{resolve('timeout');}}),
  ]).then(finish).catch(()=>finish('timeout'));
});
app.on('window-all-closed',()=>app.quit());
