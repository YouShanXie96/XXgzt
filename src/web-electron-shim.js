'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

function createElectronShim({ dataDir, onOpenExternal } = {}) {
  const resolvedDataDir = path.resolve(dataDir || path.join(__dirname, '..', '.dev-data'));
  fs.mkdirSync(resolvedDataDir, { recursive: true });

  // Persistent local symmetric key so credentials / sessions encrypted via safeStorage
  // remain readable across server restarts without Windows DPAPI.
  const keyFile = path.join(resolvedDataDir, '.web-vault-key');
  let vaultKey = null;
  function getVaultKey() {
    if (vaultKey) return vaultKey;
    try {
      const hex = fs.readFileSync(keyFile, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        vaultKey = Buffer.from(hex, 'hex');
        return vaultKey;
      }
    } catch {}
    vaultKey = crypto.randomBytes(32);
    try {
      fs.writeFileSync(keyFile, vaultKey.toString('hex'), { mode: 0o600 });
    } catch {}
    return vaultKey;
  }

  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => {
      const key = getVaultKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([Buffer.from('XXW1'), iv, tag, enc]);
    },
    decryptString: (buf) => {
      const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      if (raw.length < 32 || raw.subarray(0, 4).toString('utf8') !== 'XXW1') {
        throw new Error('Unsupported web vault payload');
      }
      const key = getVaultKey();
      const iv = raw.subarray(4, 16);
      const tag = raw.subarray(16, 32);
      const enc = raw.subarray(32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    },
  };

  const sessionMap = new Map();
  function createMockSession(partition = 'default') {
    const ses = new EventEmitter();
    const cookies = [];
    ses.storagePath = path.join(resolvedDataDir, 'browser', partition.replace(/[^a-zA-Z0-9_-]/g, '_'));
    ses.cookies = {
      get: async () => cookies.slice(),
      set: async (details) => { if (details && details.name) cookies.push(details); },
      remove: async (_url, name) => {
        const idx = cookies.findIndex((c) => c.name === name);
        if (idx >= 0) cookies.splice(idx, 1);
      },
      flushStore: async () => {},
    };
    ses.webRequest = {
      onBeforeRequest: () => {},
    };
    ses.setPermissionRequestHandler = () => {};
    ses.setPermissionCheckHandler = () => {};
    ses.clearStorageData = async () => { cookies.length = 0; };
    ses.clearCache = async () => {};
    ses.clearCodeCaches = async () => {};
    ses.clearHostResolverCache = async () => {};
    ses.flushStorageData = async () => {};
    ses.getCacheSize = async () => 0;
    ses.setCodeCachePath = () => {};
    return ses;
  }

  const defaultSession = createMockSession('default');
  const session = {
    defaultSession,
    fromPartition: (partition) => {
      const key = String(partition || 'default');
      if (!sessionMap.has(key)) sessionMap.set(key, createMockSession(key));
      return sessionMap.get(key);
    },
  };

  let wcIdSeq = 0;
  class MockWebContents extends EventEmitter {
    constructor(options = {}) {
      super();
      this.id = ++wcIdSeq;
      this.session = options.session || defaultSession;
      this.mainFrame = { url: '' };
      this._url = '';
      this._title = '';
      this._destroyed = false;
      this._history = [];
      this._historyIdx = -1;
      this._zoom = 1;
      this.navigationHistory = {
        canGoBack: () => this._historyIdx > 0,
        canGoForward: () => this._historyIdx >= 0 && this._historyIdx < this._history.length - 1,
        goBack: () => {
          if (this._historyIdx > 0) {
            this._historyIdx -= 1;
            this._url = this._history[this._historyIdx];
          }
        },
        goForward: () => {
          if (this._historyIdx < this._history.length - 1) {
            this._historyIdx += 1;
            this._url = this._history[this._historyIdx];
          }
        },
      };
    }
    isDestroyed() { return this._destroyed; }
    getURL() { return this._url; }
    getTitle() { return this._title; }
    setWindowOpenHandler() {}
    setAudioMuted() {}
    getZoomFactor() { return this._zoom; }
    setZoomFactor(z) { if (Number.isFinite(z) && z > 0) this._zoom = z; }
    canGoBack() { return this.navigationHistory.canGoBack(); }
    canGoForward() { return this.navigationHistory.canGoForward(); }
    goBack() { this.navigationHistory.goBack(); }
    goForward() { this.navigationHistory.goForward(); }
    stop() {}
    focus() {}
    send() {}
    async executeJavaScript() { return null; }
    async capturePage() { return { toPNG: () => Buffer.alloc(0) }; }
    async loadURL(url) {
      this._url = String(url || '');
      this.mainFrame.url = this._url;
      this._history = this._history.slice(0, this._historyIdx + 1);
      this._history.push(this._url);
      this._historyIdx = this._history.length - 1;
      this.emit('did-start-loading');
      this.emit('dom-ready');
      this.emit('did-navigate', {}, this._url);
      this.emit('did-stop-loading');
    }
    async loadFile(file) {
      await this.loadURL('file://' + String(file || ''));
    }
    reload() {
      this.emit('did-start-loading');
      this.emit('did-stop-loading');
    }
    close() { this.destroy(); }
    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      this.emit('destroyed');
    }
  }

  const allWindows = new Set();
  class MockBrowserWindow extends EventEmitter {
    constructor(options = {}) {
      super();
      this._destroyed = false;
      this._visible = options.show !== false;
      this._title = options.title || '';
      this._bounds = { x: 0, y: 0, width: options.width || 1280, height: options.height || 860 };
      const wp = options.webPreferences || {};
      const ses = wp.session || (wp.partition ? session.fromPartition(wp.partition) : defaultSession);
      this.webContents = wp.webContents || new MockWebContents({ session: ses });
      this.contentView = {
        addChildView: () => {},
        removeChildView: () => {},
      };
      allWindows.add(this);
    }
    static getAllWindows() { return [...allWindows]; }
    isDestroyed() { return this._destroyed; }
    isVisible() { return this._visible; }
    isMinimized() { return false; }
    show() { this._visible = true; }
    hide() { this._visible = false; }
    focus() {}
    restore() {}
    setMenuBarVisibility() {}
    setTitle(t) { this._title = String(t || ''); }
    setTitleBarOverlay() {}
    getContentSize() { return [this._bounds.width, this._bounds.height]; }
    getContentBounds() { return { ...this._bounds }; }
    async loadURL(url) { return this.webContents.loadURL(url); }
    async loadFile(file) { return this.webContents.loadFile(file); }
    close() {
      const ev = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      this.emit('close', ev);
      if (!ev.defaultPrevented) this.destroy();
    }
    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      allWindows.delete(this);
      this.webContents.destroy();
      this.emit('closed');
    }
  }

  class MockWebContentsView extends EventEmitter {
    constructor(options = {}) {
      super();
      const wp = options.webPreferences || {};
      const ses = wp.session || (wp.partition ? session.fromPartition(wp.partition) : defaultSession);
      this.webContents = options.webContents || new MockWebContents({ session: ses });
      this._bounds = { x: 0, y: 0, width: 1280, height: 860 };
      this._visible = false;
    }
    setVisible(v) { this._visible = Boolean(v); }
    setBounds(b) { if (b) this._bounds = { ...b }; }
    getBounds() { return { ...this._bounds }; }
  }

  // Pending upload queue populated by Express /api/upload before dispatching file-pick actions
  let stagedUploadPath = null;
  let stagedExportTarget = null;

  const dialog = {
    setStagedUpload(filePath) { stagedUploadPath = filePath || null; },
    consumeStagedUpload() { const v = stagedUploadPath; stagedUploadPath = null; return v; },
    getLastExportTarget() { return stagedExportTarget; },
    clearLastExportTarget() { stagedExportTarget = null; },
    showOpenDialog: async () => {
      const staged = stagedUploadPath;
      stagedUploadPath = null;
      if (staged) return { canceled: false, filePaths: [staged] };
      return { canceled: true, filePaths: [] };
    },
    showSaveDialog: async (_win, options = {}) => {
      const exportDir = path.join(resolvedDataDir, 'exports');
      fs.mkdirSync(exportDir, { recursive: true });
      const rawName = options.defaultPath ? path.basename(String(options.defaultPath)) : `export-${Date.now()}.bin`;
      const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      const filePath = path.join(exportDir, `${Date.now()}-${safeName}`);
      stagedExportTarget = filePath;
      return { canceled: false, filePath };
    },
    showMessageBox: async () => ({ response: 0 }),
  };

  const shell = {
    openPath: async () => '',
    openExternal: async (url) => { if (typeof onOpenExternal === 'function') onOpenExternal(url); },
  };

  const nativeImage = {
    createEmpty: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0), getSize: () => ({ width: 0, height: 0 }) }),
    createFromPath: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0), getSize: () => ({ width: 0, height: 0 }) }),
    createFromBuffer: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0), getSize: () => ({ width: 0, height: 0 }) }),
  };

  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    userAgentFallback: 'XXWorkbench',
    setName: () => {},
    setAppUserModelId: () => {},
    setPath: () => {},
    getPath: (name) => {
      if (name === 'documents') {
        const dir = path.join(resolvedDataDir, 'exports');
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      }
      return resolvedDataDir;
    },
    requestSingleInstanceLock: () => true,
    whenReady: async () => {},
    relaunch: () => {},
    quit: () => {},
    exit: () => {},
  });

  const Menu = { setApplicationMenu: () => {} };
  const ipcMain = { handle: () => {} };

  return {
    app,
    Menu,
    BrowserWindow: MockBrowserWindow,
    WebContentsView: MockWebContentsView,
    ipcMain,
    dialog,
    shell,
    nativeImage,
    session,
    safeStorage,
  };
}

module.exports = { createElectronShim };
