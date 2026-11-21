'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');

const { createElectronShim } = require('./src/web-electron-shim');
const { createStorage, atomicWrite } = require('./src/lib/storage');
const { createUiState } = require('./src/lib/ui-state');
const { createBackup, decodeBackup, restoreBackup, validateStores } = require('./src/lib/backup');
const { createBrowserManager, partitionForStore, allowedMerchantUrl } = require('./src/lib/browser');
const { createAccountService } = require('./src/accounts/service');
const { createCredentialService } = require('./src/accounts/credentials');
const { createSessionPersistence } = require('./src/accounts/session-persistence');
const { createAutoLogin } = require('./src/accounts/auto-login');
const { displayUrl } = require('./src/browser/workspace');
const { workbookBytes, readTable } = require('./src/lib/spreadsheet');
const { createReviewService } = require('./src/services/reviews');
const { createPromotionService } = require('./src/services/promotion');
const { createOperationsService } = require('./src/services/operations');
const { createComplianceService } = require('./src/services/compliance');
const { createHostedGiftService } = require('./src/services/hosted-gift');
const { createComplaintTagService } = require('./src/services/complaint-tag');
const { createCloudAuthService } = require('./src/cloud-auth/service');
const { createUpdateService } = require('./src/update/service');
const { createInsightServices } = require('./src/insights/service');
const { createBusinessService } = require('./src/business/service');
const { createBusinessCollector } = require('./src/business/collector');
const { createSelectionPoolService } = require('./src/selectionpool/service');
const { createPersonalTaobaoService } = require('./src/personal-taobao');
const { createPublishDriver } = require('./src/selectionpool/driver-v2');
const { createPathSettings } = require('./src/settings/path-settings');
const { REGISTRY_FILE, assignFolders, storeFolder } = require('./src/business/store-data');
const { migrateStoreData, writeStoreInfo, folderUsage, clearStoreData, listStoreFolders } = require('./src/lib/store-migration');
const { version, productName: PRODUCT_NAME } = require('./package.json');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const STANDALONE_MODE = process.env.XX_STANDALONE !== '0';
const dataDir = path.resolve(process.env.XX_DATA_DIR || path.join(__dirname, '.dev-data'));

const electron = createElectronShim({ dataDir });
const { BrowserWindow, dialog, nativeImage, session, safeStorage } = electron;

let mainWindow;
let storage;
let browser;
let services;
let cloudAuth;
let insightServices;
let businessService;
let businessCollector;
let sessionPersistence;
let pathSettings;
let updateService;
let stores = [];
let storeFolders = {};
const storeDataWarnings = new Map();
let visibleStoreCache = { at: 0, keys: null, rows: [] };
const inFlight = new Set();
const sseClients = new Set();
const downloadRegistry = new Map();
let maintenance = false;
let importBusy = false;
let quitting = false;
let shutdownPromise;

const normalizeTheme = (value) => (value === 'dark' ? 'dark' : value === 'eye' ? 'eye' : 'light');
async function readTheme() {
  try { return normalizeTheme((await storage.readJson('settings.json', {})).theme); } catch { return 'light'; }
}
const normalizeSidebar = (value) => (value === 'collapsed' ? 'collapsed' : 'pinned');
async function readSidebar() {
  try { return normalizeSidebar((await storage.readJson('settings.json', {})).sidebar); } catch { return 'pinned'; }
}

function broadcastEvent(eventName, payload) {
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload ?? {})}\n\n`;
  for (const res of sseClients) {
    try { res.write(frame); } catch { sseClients.delete(res); }
  }
}

function registerDownload(filePath) {
  if (!filePath || !fsSync.existsSync(filePath)) return null;
  const token = randomUUID();
  const filename = path.basename(filePath).replace(/^\d+-/, '');
  downloadRegistry.set(token, { filePath, filename, createdAt: Date.now() });
  // Prune entries older than 1 hour
  for (const [k, v] of downloadRegistry) {
    if (Date.now() - v.createdAt > 3600 * 1000) downloadRegistry.delete(k);
  }
  return { downloadUrl: `/api/download/${token}`, filename };
}

function permissionError(message, code = 'PERMISSION_DENIED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredActionPermission(action, p = {}) {
  if (action === 'stores.add') return 'workbench.accounts.add';
  if (action === 'stores.rename') return 'workbench.accounts.edit';
  if (action === 'stores.remove') return 'workbench.accounts.remove';
  if (action.startsWith('credentials.')) return 'workbench.accounts.credentials';
  if (action === 'accounts.load' || action === 'accounts.refresh') return 'workbench.accounts.view';
  if (['accounts.open', 'accounts.check', 'accounts.autoLogin', 'accounts.ensureBackend', 'accounts.detectName'].includes(action)) return 'workbench.accounts.login';
  if (action === 'browser.workspace' || action === 'browser.open' || action === 'browser.viewport') return 'workbench.browser.view';
  if (['browser.navigateTab', 'browser.back', 'browser.forward', 'browser.reloadTab', 'browser.homeTab'].includes(action)) return 'workbench.browser.navigate';
  if (['browser.newTab', 'browser.closeTab', 'browser.activateTab'].includes(action)) return 'workbench.browser.tabs';
  if (action === 'browser.checkTab' || action === 'browser.status') return 'workbench.browser.check';
  if (action === 'business.load' || action === 'business.detail' || action === 'business.uiStateLoad' || action === 'business.syncResults') return p.mode === 'product' ? 'workbench.business.product.view' : 'workbench.business.daily.view';
  if (action === 'business.catalogLoad' || action === 'business.marksLoad') return 'workbench.business.product.view';
  if (action === 'business.trend') return 'workbench.business.product.trend';
  if (action === 'business.export') return p.mode === 'product' ? 'workbench.business.product.export' : 'workbench.business.daily.export';
  if (action === 'business.sync' || action === 'business.cancel' || action === 'business.validationRetry') return Array.isArray(p.storeIds) && p.storeIds.length > 1 ? 'workbench.business.sync.manage' : (p.mode === 'product' ? 'workbench.business.product.sync' : 'workbench.business.daily.sync');
  if (action === 'business.catalogSync') return 'workbench.business.product.sync';
  if (action === 'business.feesLoad') return 'workbench.business.daily.view';
  if (action === 'business.feesSave') return 'workbench.business.fees';
  if (['business.manualSave', 'business.manualExclude'].includes(action)) return 'workbench.business.daily.manual';
  if (['business.markTodo', 'business.unmarkTodo', 'business.markBlacklist'].includes(action)) return 'workbench.business.product.marks';
  if (['business.open', 'business.revealSync', 'business.hideSyncPage'].includes(action)) return p.mode === 'product' ? 'workbench.business.product.sync' : 'workbench.business.daily.sync';
  if (action === 'business.uiStateSave') return p.mode === 'product' ? 'workbench.business.product.view' : 'workbench.business.daily.view';
  if (action.startsWith('reviews.')) return action === 'reviews.sync' || action === 'reviews.cancel' ? 'workbench.reviews.sync' : action === 'reviews.export' ? 'workbench.reviews.export' : action === 'reviews.open' ? 'workbench.reviews.open' : 'workbench.reviews.view';
  if (action.startsWith('promotion.')) return action === 'promotion.sync' ? 'workbench.promotion.sync' : action === 'promotion.export' ? 'workbench.promotion.export' : ['promotion.saveRule', 'promotion.deleteRule'].includes(action) ? 'workbench.promotion.rules' : ['promotion.run', 'promotion.pause', 'promotion.setMode'].includes(action) ? 'workbench.promotion.execute' : 'workbench.promotion.view';
  if (action.startsWith('purchase.')) return ['purchase.load', 'purchase.activities'].includes(action) ? 'workbench.marketing.purchase.view' : ['purchase.import', 'purchase.template'].includes(action) ? 'workbench.marketing.purchase.import' : action === 'purchase.export' ? 'workbench.marketing.purchase.export' : ['purchase.prepare', 'purchase.create', 'purchase.close', 'purchase.resolveCheck', 'purchase.save'].includes(action) ? 'workbench.marketing.purchase.create' : 'workbench.marketing.purchase.view';
  if (action.startsWith('hostedgift.')) return ['hostedgift.enroll', 'hostedgift.batchExit'].includes(action) ? 'workbench.marketing.gift.enroll' : action === 'hostedgift.export' ? 'workbench.marketing.gift.export' : 'workbench.marketing.gift.view';
  if (action.startsWith('complaint.')) return ['complaint.start', 'complaint.control', 'complaint.resume', 'complaint.pause'].includes(action) ? 'workbench.marketing.complaint.execute' : 'workbench.marketing.complaint.preview';
  if (action.startsWith('trends.')) return action === 'trends.export' ? 'workbench.selection.trends.export' : ['trends.capture', 'trends.cancel', 'trends.saveFilters'].includes(action) ? 'workbench.selection.trends.capture' : 'workbench.selection.trends.view';
  if (action.startsWith('peers.')) return action === 'peers.export' ? 'workbench.selection.peers.export' : ['peers.capture', 'peers.cancel'].includes(action) ? 'workbench.selection.peers.capture' : 'workbench.selection.peers.view';
  if (action.startsWith('recommendations.')) return action === 'recommendations.export' ? 'workbench.selection.recommendations.export' : ['recommendations.importPreview', 'recommendations.importCommit', 'recommendations.template'].includes(action) ? 'workbench.selection.recommendations.import' : 'workbench.selection.recommendations.view';
  if (action.startsWith('compliance.')) return action === 'compliance.import' || action === 'compliance.importPath' ? 'workbench.compliance.import' : action === 'compliance.scan' ? 'workbench.compliance.scan' : ['compliance.saveRules', 'compliance.importRules', 'compliance.resetRules'].includes(action) ? 'workbench.compliance.rules' : ['compliance.updateIssue', 'compliance.deleteJob', 'compliance.renameJob'].includes(action) ? 'workbench.compliance.issues' : action === 'compliance.export' ? 'workbench.compliance.export' : action === 'compliance.billingUpdate' ? 'workbench.compliance.billing' : 'workbench.compliance.view';
  if (action.startsWith('selectionpool.')) return 'workbench.accounts.view';
  if (action === 'settings.load') return 'workbench.settings.view';
  if (action === 'settings.save') return p.theme ? 'workbench.settings.theme' : 'workbench.settings.view';
  if (action === 'settings.choosePath' || action === 'settings.resetPath' || action === 'app.openDataDir') return 'workbench.settings.paths';
  if (action === 'data.exportBackup' || action === 'data.importBackup') return 'workbench.settings.backup';
  if (action === 'settings.clearStoreCache') return 'workbench.settings.cache';
  if (['settings.storeData', 'settings.openStoreData', 'settings.clearStoreData'].includes(action)) return 'workbench.settings.storeData';
  return null;
}

function payloadStoreIds(action, p = {}) {
  const ids = [];
  if (typeof p.storeId === 'string' && p.storeId) ids.push(p.storeId);
  if (Array.isArray(p.storeIds)) ids.push(...p.storeIds.filter((id) => typeof id === 'string'));
  if (action === 'stores.rename' || action === 'stores.remove') ids.push(String(p.id || ''));
  if (['settings.openStoreData', 'settings.clearStoreData'].includes(action)) ids.push(String(p.storeId || ''));
  return [...new Set(ids.filter(Boolean))];
}

async function visibleStoreAccess(force = false) {
  if (!force && visibleStoreCache.keys && Date.now() - visibleStoreCache.at < 4000) return visibleStoreCache;
  const data = await cloudAuth.syncStores({ stores: stores.map((store) => ({ id: store.id, name: store.name })) });
  const rows = Array.isArray(data?.stores) ? data.stores : [];
  const known = new Set(stores.map((store) => String(store.id)));
  const restored = rows
    .filter((row) => row?.store_key && row?.name && !known.has(String(row.store_key)))
    .map((row) => ({ id: String(row.store_key), name: String(row.name).slice(0, 60), createdAt: new Date().toISOString(), restoredFromAuthorization: true }));
  if (restored.length) {
    stores = [...stores, ...restored];
    await storage.writeJson('stores.json', stores);
    const assigned = assignFolders(stores, storeFolders);
    storeFolders = assigned.registry;
    if (assigned.changed) await storage.writeJson(REGISTRY_FILE, storeFolders);
    for (const store of restored) {
      const folder = storeFolders[store.id];
      if (!folder) continue;
      try {
        await migrateStoreData(dataDir, store, folder);
        await writeStoreInfo(dataDir, store, folder);
      } catch (error) {
        storeDataWarnings.set(store.id, `授权店铺本机数据恢复未完成：${String(error.message || error).slice(0, 200)}`);
      }
    }
  }
  const keys = new Set(Array.isArray(data?.store_keys) ? data.store_keys : []);
  visibleStoreCache = { at: Date.now(), keys, rows };
  return visibleStoreCache;
}

async function requireStoreAccess(ids, access = null) {
  if (!ids.length) return;
  access = access || (await visibleStoreAccess());
  const forbidden = ids.filter((id) => !access.keys.has(id));
  if (forbidden.length) throw permissionError('当前账号无权访问所选店铺，请联系管理员调整店铺范围。', 'STORE_FORBIDDEN');
}

function filterVisibleResult(action, result, access) {
  const keys = access.keys;
  const accessByKey = new Map((access.rows || []).map((row) => [row.store_key, row]));
  const decorate = (store) => {
    const row = accessByKey.get(store.id);
    return row ? { ...store, access: { scopeType: row.owner_user_id ? 'user' : row.department_id ? 'department' : row.team_id ? 'team' : 'unassigned', ownerName: row.owner_name || '', departmentName: row.department_name || '', teamName: row.team_name || '' } } : store;
  };
  if (action === 'stores.list') return Array.isArray(result) ? result.filter((store) => keys.has(store.id)).map(decorate) : result;
  if (action === 'accounts.load' && result && Array.isArray(result.stores)) return { ...result, stores: result.stores.filter((store) => keys.has(store.id)).map(decorate) };
  if (action === 'browser.workspace' && result && Array.isArray(result.tabs)) {
    const tabs = result.tabs.filter((tab) => !tab.storeId || keys.has(tab.storeId));
    const activeId = tabs.some((tab) => tab.id === result.activeId) ? result.activeId : (tabs[0]?.id || null);
    return { ...result, tabs, activeId };
  }
  if (action === 'settings.storeData' && result && Array.isArray(result.entries)) return { ...result, entries: result.entries.filter((entry) => !entry.id || keys.has(entry.id)) };
  if (action === 'business.syncResults' && result && typeof result === 'object' && !Array.isArray(result)) {
    return Object.fromEntries(Object.entries(result).filter(([storeId]) => keys.has(storeId)));
  }
  return result;
}

function storeById(id) {
  const store = stores.find((item) => item.id === id);
  if (!store) throw new Error('请先选择有效店铺');
  return store;
}
const folderFor = (storeId) => {
  const folder = storeFolders[storeId];
  return folder ? storeFolder(folder) : null;
};

let ctx;

async function initWorkbench() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, 'uploads'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'exports'), { recursive: true });

  storage = createStorage(dataDir);
  stores = await storage.readJson('stores.json', []);
  const uiState = createUiState(storage);
  validateStores(stores);

  const assigned = assignFolders(stores, await storage.readJson(REGISTRY_FILE, {}).catch(() => ({})));
  storeFolders = assigned.registry;
  if (assigned.changed) await storage.writeJson(REGISTRY_FILE, storeFolders).catch(() => {});
  for (const store of stores) {
    const folder = storeFolders[store.id];
    if (!folder) continue;
    try {
      await migrateStoreData(dataDir, store, folder);
      await writeStoreInfo(dataDir, store, folder);
      storeDataWarnings.delete(store.id);
    } catch (error) {
      storeDataWarnings.set(store.id, `店铺数据迁移未完成：${String(error.message || error).slice(0, 200)}`);
    }
  }
  if (!await fs.stat(path.join(dataDir, 'stores.json')).catch(() => null)) {
    await storage.writeJson('stores.json', stores);
  }

  const programDir = __dirname;
  pathSettings = createPathSettings({
    dataDir,
    appDir: programDir,
    sourceDir: __dirname,
    ...storage,
    dialog,
    getWindow: () => mainWindow,
    defaultExportDir: path.join(dataDir, 'exports'),
    protectedDirs: [],
  });
  await pathSettings.initialize();

  sessionPersistence = createSessionPersistence({ dataDir, safeStorage, platform: 'win32' });
  const resourceDir = path.join(__dirname, 'assets');
  const ocrDir = path.join(__dirname, 'resources', 'ocr');
  const icon = path.join(resourceDir, 'icon.svg');
  const getStore = (id) => {
    const s = stores.find((x) => x.id === id);
    if (!s) throw new Error('请先添加并选择店铺');
    return s;
  };
  const emit = (payload) => broadcastEvent('progress', payload);

  mainWindow = new BrowserWindow({ width: 1400, height: 900, show: true, title: PRODUCT_NAME });

  browser = createBrowserManager({
    electron,
    getStore,
    emit,
    icon,
    sessionPersistence,
    getHostWindow: () => mainWindow,
    beforeLoad: (wc, kind) => insightServices?.prepare(wc, kind),
  });

  const files = {
    async exportWorkbook(defaultName, sheets) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出表格',
        defaultPath: path.join(dataDir, 'exports', defaultName),
        filters: [{ name: 'Excel工作簿', extensions: ['xlsx'] }],
      });
      if (result.canceled) return { canceled: true };
      const bytes = workbookBytes(sheets);
      await fs.writeFile(result.filePath, bytes);
      const dl = registerDownload(result.filePath);
      return { path: result.filePath, ...(dl || {}), canceled: false };
    },
    exportRows(defaultName, rows, columns) {
      return this.exportWorkbook(defaultName, [{ name: '数据', rows, columns }]);
    },
    async pickTablePath() {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择要导入的数据表',
        properties: ['openFile'],
        filters: [{ name: 'Excel或CSV', extensions: ['xlsx', 'xlsm', 'csv'] }],
      });
      if (result.canceled) return { canceled: true };
      const file = result.filePaths[0];
      const stat = await fs.stat(file);
      return { path: file, name: path.basename(file), size: stat.size };
    },
    async pickImport() {
      const picked = await files.pickTablePath();
      if (picked.canceled) return picked;
      if (picked.size > 50 * 1024 * 1024) throw new Error('表格超过50MB，请分批导入');
      return { path: picked.path, rows: readTable(await fs.readFile(picked.path), path.extname(picked.path)) };
    },
    async pickImage() {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择真实标签图片',
        properties: ['openFile'],
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });
      return result.canceled ? { canceled: true } : { path: result.filePaths[0] };
    },
  };
  files.exportRows = files.exportRows.bind(files);
  files.pickImport = files.pickImport.bind(files);
  files.pickTablePath = files.pickTablePath.bind(files);

  ctx = {
    dataDir,
    resourceDir,
    ocrDir,
    getStore,
    listStores: () => stores.map((store) => ({ ...store })),
    ...storage,
    browser,
    files,
    emit,
    nativeImage,
    storeFolder: folderFor,
    appVersion: version,
    probePage: async () => ({
      loadError: 'Web 运行环境不支持后台无头商家窗口探测，请在桌面端使用。',
    }),
  };
  ctx.storeRoot = () => path.join(dataDir, '店铺数据');
  ctx.currentAccount = () => {
    try { return require('node:os').userInfo().username; } catch { return 'web-user'; }
  };

  const credentials = createCredentialService({ ...ctx, safeStorage, platform: 'win32' });
  const autoLogin = createAutoLogin({ browser, credentials });
  ctx.autoLogin = autoLogin;

  cloudAuth = createCloudAuthService({
    dataDir,
    storage,
    safeStorage,
    appVersion: version,
    standalone: STANDALONE_MODE,
    listLocalStores: () => stores.map((store) => ({ id: store.id, name: store.name })),
    createLocalStore: async (name) => {
      const before = new Set(stores.map((store) => store.id));
      const rows = await dispatch('stores.add', { name: String(name || '').trim() }, ctx);
      const created = (Array.isArray(rows) ? rows : stores).find((store) => !before.has(store.id));
      if (!created) throw new Error('店铺创建后未能取得店铺编号');
      return created;
    },
    removeLocalStore: async (storeId) => {
      await dispatch('stores.remove', { id: String(storeId || ''), confirmed: true }, ctx);
    },
    renameLocalStore: async (storeId, name) => {
      await dispatch('stores.rename', { id: String(storeId || ''), name: String(name || '').trim() }, ctx);
    },
  });

  const operations = createOperationsService(ctx);
  const personalTaobaoService = createPersonalTaobaoService({ electron, emit, getWindow: () => mainWindow });
  ctx.probePersonalSource = async () => personalTaobaoService.loggedIn();
  insightServices = createInsightServices(ctx);
  businessCollector = createBusinessCollector(ctx);
  businessService = createBusinessService(ctx, { collector: businessCollector });

  services = {
    credentials,
    autoLogin,
    cloudauth: cloudAuth,
    accounts: createAccountService(ctx),
    reviews: createReviewService(ctx),
    promotion: createPromotionService(ctx),
    compliance: createComplianceService(ctx),
    hostedgift: createHostedGiftService(ctx),
    complaint: createComplaintTagService(ctx),
    purchase: { handle: operations.handlePurchase },
    qualification: { handle: operations.handleQualification },
    operations,
    business: businessService,
    trends: insightServices.trends,
    peers: insightServices.peers,
    recommendations: insightServices.recommendations,
    insights: insightServices,
    selectionpool: createSelectionPoolService(ctx, {
      dialog,
      pluginAutoUpdate: false,
      autoIngest: false,
      openWindow: async ({ url }) => {
        const target = String(url || '').trim();
        if (!allowedMerchantUrl(target)) throw new Error('仅支持 https 的发布页地址');
        return { ok: true, webUrl: target };
      },
    }),
    personaltaobao: personalTaobaoService,
  };

  services.selectionpool.setDriver(createPublishDriver({ electron, partitionForStore, log: emit, dataDir }));
  ctx.ensureBackend = (payload, options) => services.accounts.ensureBackend(payload, options);
  ctx.readAccountState = (storeId) => services.accounts.readState(storeId);

  updateService = createUpdateService({
    appDir: __dirname,
    dataDir,
    currentVersion: version,
    onEvent: (payload) => broadcastEvent('update', payload),
    relaunch: () => {},
  });
}

async function dispatch(action, p, ctx) {
  const [module, method] = action.split('.');
  if (action === 'app.openExternal') {
    const url = String(p?.url || '');
    if (!/^https?:\/\//i.test(url)) return { ok: false, message: '只允许 http(s) 地址' };
    return { ok: true, openUrl: url };
  }
  if (action === 'app.info') {
    return {
      name: PRODUCT_NAME,
      version,
      dataDir,
      mode: STANDALONE_MODE ? 'Web 工作台' : '联网登录版',
      authMode: 'login-center',
      appId: '1001',
      aiEnabled: false,
      electron: 'web',
      theme: await readTheme(),
      sidebar: await readSidebar(),
      paths: pathSettings.view(),
    };
  }
  if (action === 'app.openDataDir') {
    return { path: dataDir, message: `本机数据目录：${dataDir}` };
  }
  if (module === 'stores') {
    if (method === 'list') return stores;
    if (method === 'add') {
      const requested = String(p.name || '').trim();
      if (requested.length > 60) throw new Error('店铺名称需为1–60个字符');
      if (requested && stores.some((s) => s.name === requested)) throw new Error('已存在同名店铺');
      let name = requested;
      if (!name) {
        let index = stores.length + 1;
        while (stores.some((s) => s.name === `新店铺${index}`)) index++;
        name = `新店铺${index}`;
      }
      const store = { id: randomUUID(), name, ...(requested ? {} : { pendingName: true }), createdAt: new Date().toISOString() };
      stores = [...stores, store];
      await storage.writeJson('stores.json', stores);
      const assigned = assignFolders(stores, storeFolders);
      storeFolders = assigned.registry;
      if (assigned.changed) await storage.writeJson(REGISTRY_FILE, storeFolders).catch(() => {});
      return stores;
    }
    if (method === 'rename') {
      const store = ctx.getStore(p.id);
      const name = String(p.name || '').trim();
      if (!name || name.length > 60) throw new Error('店铺名称需为1–60个字符');
      if (stores.some((s) => s.id !== store.id && s.name === name)) throw new Error('店铺名称已存在');
      store.name = name;
      delete store.pendingName;
      await storage.writeJson('stores.json', stores);
      return stores;
    }
    if (method === 'remove') {
      ctx.getStore(p.id);
      if (p.confirmed !== true) throw new Error('移除店铺前请确认');
      await services.reviews.handle('cancel', { storeId: p.id });
      await services.promotion.handle('setMode', { storeId: p.id, mode: 'observe' });
      await insightServices.cancelStore(p.id);
      await businessService.cancelStore(p.id);
      await services.autoLogin.cancel?.(p.id);
      await browser.closeStore(p.id, { forget: true });
      stores = stores.filter((s) => s.id !== p.id);
      await storage.writeJson('stores.json', stores);
      if (storeFolders[p.id]) {
        delete storeFolders[p.id];
        await storage.writeJson(REGISTRY_FILE, storeFolders).catch(() => {});
      }
      return stores;
    }
  }
  if (module === 'browser') {
    if (['workspace', 'activateTab', 'closeTab', 'navigateTab', 'back', 'forward', 'reloadTab', 'homeTab', 'viewport', 'checkTab'].includes(method)) {
      return browser.handleWorkspace(method, p);
    }
    if (method === 'open') {
      const wc = await browser.show(p.storeId, p.kind || 'orders');
      if (p.kind === 'purchase' && p.view === 'activities') await wc.loadURL('https://myseller.taobao.com/home.htm/private-domain-workbench/activityList');
      if (p.kind === 'purchase' && p.view === 'create') await wc.loadURL('https://myseller.taobao.com/home.htm/CRM-Workbench/ecrm-sop-form/Shop-Activities');
      const explicit = String(p.url || '').trim();
      if (explicit && allowedMerchantUrl(explicit)) await wc.loadURL(explicit);
      return { url: displayUrl(wc.getURL()), message: '已在工作台记录店铺页面地址（Web 模式下无法直接内嵌外部商家后台，请使用桌面客户端登录）。' };
    }
    if (method === 'newTab') return browser.openUserTab(p.storeId, p.kind || 'seller', String(p.url || '').trim());
    if (method === 'status') return browser.status(p.storeId);
  }
  if (action === 'settings.load') {
    return {
      ...(await storage.readJson('settings.json', { ai: { enabled: false, baseUrl: '', model: '', note: '' } })),
      theme: await readTheme(),
      sidebar: await readSidebar(),
      dataDir,
      version,
      paths: pathSettings.view(),
    };
  }
  if (action === 'settings.storeData') {
    const directory = (name) => path.join(dataDir, name);
    const entries = [];
    for (const store of stores) {
      const folder = folderFor(store.id);
      if (!folder) continue;
      let usage = { bytes: 0, files: 0 };
      try { usage = await folderUsage(directory(folder)); } catch {}
      entries.push({ id: store.id, name: store.name, folder, path: directory(folder), bytes: usage.bytes, files: usage.files, warning: storeDataWarnings.get(store.id) || null });
    }
    const known = new Set(Object.values(storeFolders));
    const orphans = [];
    for (const name of await listStoreFolders(dataDir)) {
      if (known.has(name)) continue;
      let usage = { bytes: 0, files: 0 };
      const orphanPath = path.join(dataDir, '店铺数据', name);
      try { usage = await folderUsage(orphanPath); } catch {}
      orphans.push({ name, path: orphanPath, bytes: usage.bytes, files: usage.files });
    }
    return { root: path.join(dataDir, '店铺数据'), entries, orphans };
  }
  if (action === 'settings.openStoreData') {
    const store = storeById(p.storeId);
    const folder = folderFor(store.id);
    if (!folder) throw new Error('该店铺尚未分配数据文件夹');
    const dir = path.join(dataDir, folder);
    await fs.mkdir(dir, { recursive: true });
    return { path: dir, message: `店铺数据目录：${dir}` };
  }
  if (action === 'settings.clearStoreData') {
    if (p.confirmed !== true) throw new Error('清理店铺数据前请先确认');
    if (typeof p.orphanName === 'string' && p.orphanName) {
      const wanted = p.orphanName;
      if (!wanted || Object.values(storeFolders).includes(wanted) || !(await listStoreFolders(dataDir)).includes(wanted)) {
        throw new Error('该数据文件夹不可清理');
      }
      await clearStoreData(dataDir, wanted);
      return { message: `已清理数据文件夹“${wanted}”。` };
    }
    const store = storeById(p.storeId);
    const folder = folderFor(store.id);
    if (!folder) throw new Error('该店铺尚未分配数据文件夹');
    await businessService.cancel(store.id);
    await services.reviews.handle('cancel', { storeId: store.id });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await clearStoreData(dataDir, folder);
    await writeStoreInfo(dataDir, store, folder);
    return { message: `已清理“${store.name}”的本机业务数据（日报、精细化、评价与标记）；店铺登录状态未改动。` };
  }
  if (action === 'settings.choosePath') return pathSettings.handle('choose', p);
  if (action === 'settings.resetPath') return pathSettings.handle('reset', p);
  if (action === 'settings.clearStoreCache') {
    const ids = Array.isArray(p.storeIds) ? p.storeIds : [];
    if (!ids.length) throw new Error('请选择要清除缓存的店铺');
    if (ids.length > 50) throw new Error('一次最多清除50家店铺的缓存');
    const cleared = [];
    for (const id of ids) {
      const store = storeById(id);
      const target = session.fromPartition(partitionForStore(store.id));
      const before = await target.getCacheSize().catch(() => 0);
      await target.clearCache();
      const after = await target.getCacheSize().catch(() => 0);
      cleared.push({ id: store.id, name: store.name, beforeBytes: before, afterBytes: after });
    }
    return { cleared, message: `已清除 ${cleared.length} 家店铺的网页缓存；登录状态、账号和业务数据未改动。` };
  }
  if (action === 'settings.save') {
    const incoming = p.settings || p;
    const previous = await storage.readJson('settings.json', {});
    const theme = normalizeTheme(incoming.theme !== undefined ? incoming.theme : previous.theme);
    const sidebar = normalizeSidebar(incoming.sidebar !== undefined ? incoming.sidebar : previous.sidebar);
    const settings = {
      theme,
      sidebar,
      ai: {
        enabled: false,
        baseUrl: String(incoming.ai?.baseUrl || incoming.baseUrl || previous.ai?.baseUrl || '').slice(0, 300),
        model: String(incoming.ai?.model || incoming.model || previous.ai?.model || '').slice(0, 100),
        note: String(incoming.ai?.note || incoming.note || previous.ai?.note || '').slice(0, 1000),
      },
    };
    await storage.writeJson('settings.json', settings);
    return { ...settings, dataDir, version, paths: pathSettings.view(), message: '设置已保存。AI功能尚未启用，不会调用接口。' };
  }
  if (action === 'data.exportBackup') return exportBackup();
  if (action === 'data.importBackup') return importBackup(p);
  if (services[module]?.handle) return services[module].handle(method, p);
  throw new Error('暂不支持此操作：' + action);
}

async function exportBackup() {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: '备份本机业务数据（不含登录状态）',
    defaultPath: path.join(dataDir, 'exports', `谢谢工作台_数据备份_${new Date().toISOString().slice(0, 10)}.zip`),
    filters: [{ name: 'ZIP备份', extensions: ['zip'] }],
  });
  if (r.canceled) return { canceled: true };
  await storage.flush();
  const bytes = await createBackup(dataDir, version);
  await fs.writeFile(r.filePath, bytes);
  const dl = registerDownload(r.filePath);
  return { path: r.filePath, ...(dl || {}), message: '业务数据已备份并开始下载；新环境需要重新登录店铺。' };
}

async function importBackup(p) {
  if (p.confirmed !== true) throw new Error('恢复备份将替换当前业务数据，请先确认并备份现有数据');
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '恢复谢谢工作台数据备份',
    properties: ['openFile'],
    filters: [{ name: 'ZIP备份', extensions: ['zip'] }],
  });
  if (r.canceled) return { canceled: true };
  if ((await fs.stat(r.filePaths[0])).size > 500 * 1024 * 1024) throw new Error('备份文件过大');
  const decoded = decodeBackup(await fs.readFile(r.filePaths[0]));
  maintenance = true;
  await sessionPersistence.forgetAll();
  const result = await restoreBackup(dataDir, decoded);
  stores = result.stores;
  maintenance = false;
  return { message: '恢复完成，已更新当前工作台数据。', previous: result.previous };
}

async function handleApiCall(action, payload = {}, uploadPath = null) {
  if (typeof action !== 'string' || !/^[a-z]+\.[a-zA-Z]+$/.test(action) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: '参数格式错误' };
  }
  if (uploadPath) {
    dialog.setStagedUpload(uploadPath);
  } else {
    dialog.setStagedUpload(null);
  }
  dialog.clearLastExportTarget();

  if (action.startsWith('update.')) {
    if (!updateService) return { ok: false, error: '更新服务尚未就绪' };
    try { return { ok: true, data: await updateService.handle(action.slice(7), payload) }; }
    catch (e) { return { ok: false, error: { code: String(e?.code || 'UPDATE_ERROR'), message: String(e?.message || e), details: {} } }; }
  }
  if (maintenance || quitting) return { ok: false, error: '正在停止服务或恢复数据，请稍候重试。' };
  if (importBusy && action !== 'data.importBackup') return { ok: false, error: '请先完成或取消当前的数据恢复文件选择。' };
  if (action === 'data.importBackup' && importBusy) return { ok: false, error: '已有一个数据恢复操作正在进行。' };

  const allowedBeforeLogin = action === 'app.info' || action === 'browser.viewport' || action.startsWith('cloudauth.');
  if (!cloudAuth?.hasSession() && !allowedBeforeLogin) {
    if (typeof cloudAuth?.ensureSession === 'function') await cloudAuth.ensureSession().catch(() => false);
    else await cloudAuth.handle('status', {}).catch(() => null);
  }
  if (!cloudAuth?.hasSession() && !allowedBeforeLogin) {
    return { ok: false, error: { code: 'AUTH_REQUIRED', message: '请先登录全域中枢。', details: {} } };
  }
  if (action === 'data.importBackup') importBusy = true;

  const request = { action, promise: null };
  request.promise = Promise.resolve().then(async () => {
    if (action === 'app.info' || action === 'browser.viewport' || action.startsWith('cloudauth.')) {
      return dispatch(action, payload, ctx);
    }
    const permission = requiredActionPermission(action, payload);
    if (permission) {
      await cloudAuth.ensurePermissionsFresh?.().catch(() => false);
      if (!cloudAuth.hasPermission(permission)) {
        await cloudAuth.ensurePermissionsFresh?.(0).catch(() => false);
        if (!cloudAuth.hasPermission(permission)) throw permissionError('当前账号没有执行这个功能的权限，请联系公司管理员。');
      }
    }
    const requestedStoreIds = payloadStoreIds(action, payload);
    const accessBefore = await visibleStoreAccess();
    await requireStoreAccess(requestedStoreIds, accessBefore);
    const oldStore = action === 'stores.rename' ? storeById(payload.id) : null;
    const oldStoreName = oldStore?.name;
    const beforeStoreIds = new Set(stores.map((store) => store.id));
    if (action === 'stores.remove') {
      await cloudAuth.handle('removeStore', { id: payload.id });
    }
    let result;
    const scopedPayload = action === 'accounts.load' ? { ...payload, allowedStoreIds: [...accessBefore.keys] } : payload;
    try { result = await dispatch(action, scopedPayload, ctx); }
    catch (error) {
      if (action === 'stores.remove') {
        const store = stores.find((item) => item.id === payload.id);
        if (store) await cloudAuth.handle('registerStore', { id: store.id, name: store.name }).catch(() => {});
      }
      throw error;
    }
    if (action === 'stores.add') {
      const created = Array.isArray(result) ? result.find((store) => !beforeStoreIds.has(store.id)) : null;
      if (created) {
        try { await cloudAuth.handle('registerStore', { id: created.id, name: created.name }); }
        catch (error) {
          stores = stores.filter((store) => store.id !== created.id);
          await storage.writeJson('stores.json', stores);
          throw error;
        }
      }
    }
    if (action === 'stores.rename' && oldStore) {
      try { await cloudAuth.handle('renameStore', { id: oldStore.id, name: String(payload.name || '') }); }
      catch (error) {
        oldStore.name = oldStoreName;
        await storage.writeJson('stores.json', stores);
        throw error;
      }
    }
    if (['stores.add', 'stores.rename', 'stores.remove'].includes(action)) visibleStoreCache = { at: 0, keys: null, rows: [] };
    const access = ['stores.add', 'stores.rename', 'stores.remove'].includes(action) ? await visibleStoreAccess(true) : accessBefore;
    const finalResult = filterVisibleResult(action, result, access);
    if (['cloudauth.addManagedStore', 'cloudauth.removeManagedStore', 'cloudauth.renameStore', 'cloudauth.saveManagedStoreGrants', 'cloudauth.setManagedStoreUserAccess'].includes(action)) {
      visibleStoreCache = { at: 0, keys: null, rows: [] };
    }
    const exportTarget = dialog.getLastExportTarget();
    if (exportTarget && finalResult && typeof finalResult === 'object' && !finalResult.downloadUrl && !finalResult.canceled) {
      const dl = registerDownload(exportTarget);
      if (dl) Object.assign(finalResult, dl);
    }
    return finalResult;
  });

  inFlight.add(request);
  try {
    return { ok: true, data: await request.promise };
  } catch (e) {
    const message = String(e.platformResponse?.message || e.message || e)
      .replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]')
      .slice(0, 1600);
    if (e?.code && /^[A-Z0-9_]{2,80}$/.test(String(e.code))) {
      return { ok: false, error: { code: String(e.code), message, details: e.details && typeof e.details === 'object' ? e.details : {} } };
    }
    return { ok: false, error: message };
  } finally {
    inFlight.delete(request);
    if (action === 'data.importBackup') importBusy = false;
  }
}

async function startServer() {
  await initWorkbench();

  const app = express();
  app.use(express.json({ limit: '16mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, product: PRODUCT_NAME, version });
  });

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write('event: ready\ndata: {}\n\n');
    sseClients.add(res);
    const keepAlive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(keepAlive); sseClients.delete(res); }
    }, 25000);
    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  app.post('/api/upload', express.raw({ type: '*/*', limit: '64mb' }), async (req, res) => {
    try {
      const rawName = decodeURIComponent(String(req.headers['x-file-name'] || 'upload.bin'));
      const safeName = path.basename(rawName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'upload.bin';
      const uploadDir = path.join(dataDir, 'uploads', randomUUID());
      await fs.mkdir(uploadDir, { recursive: true });
      const target = path.join(uploadDir, safeName);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      await fs.writeFile(target, body);
      res.json({ ok: true, path: target, name: safeName, size: body.length });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error?.message || error) });
    }
  });

  app.get('/api/download/:token', (req, res) => {
    const entry = downloadRegistry.get(String(req.params.token || ''));
    if (!entry || !fsSync.existsSync(entry.filePath)) {
      return res.status(404).json({ ok: false, error: '导出文件不存在或已过期' });
    }
    res.download(entry.filePath, entry.filename);
  });

  app.post('/api/call', async (req, res) => {
    const { action, payload, uploadPath } = req.body || {};
    const result = await handleApiCall(action, payload || {}, uploadPath || null);
    res.json(result);
  });

  // Expose the two shared browser-safe scripts referenced via ../ in index.html
  app.get('/business/report-schema.js', (_req, res) => {
    res.sendFile(path.join(__dirname, 'src/business/report-schema.js'));
  });
  app.get('/shared/permissions.js', (_req, res) => {
    res.sendFile(path.join(__dirname, 'src/shared/permissions.js'));
  });

  app.use(express.static(path.join(__dirname, 'src/renderer')));

  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(__dirname, 'src/renderer/index.html'));
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`[谢谢工作台] Web 服务已启动：http://${HOST}:${PORT} (模式: ${STANDALONE_MODE ? '单机工作台' : '联网登录版'})`);
  });

  const shutdown = async () => {
    if (quitting) return;
    quitting = true;
    maintenance = true;
    server.close();
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        const tasks = [...new Set(Object.values(services || {}))].map((s) => Promise.resolve().then(() => s.dispose?.()));
        await Promise.allSettled(tasks);
        await browser?.dispose?.();
        await storage?.sealWrites?.();
      })();
    }
    await Promise.race([shutdownPromise, new Promise((r) => setTimeout(r, 3000))]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('[谢谢工作台] 启动失败:', err);
  process.exit(1);
});
