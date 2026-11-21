'use strict';

/**
 * 个人淘宝号（复刻老软件 main-login.js / main.js 的设计，REA 证据来自 beta.268 解包源码）
 *
 * 为什么必须有它（老软件实测结论，pool-source-category.js 注释原文）：
 *   「在后台隐藏窗口里用『个人淘宝号』的登录打开商品详情页（店铺后台账号打开商品页会被要求重新登录，实测）」
 *   —— 店铺子账号会话访问 item.taobao.com / detail.tmall.com 会被淘宝要求登录个人账号，
 *   所以按商品 ID 读真实类目必须走个人淘宝号（买家账号）的独立会话。
 *
 * 老软件行为：
 *   - 登录窗口：1040x760，加载 https://login.taobao.com/member/login.jhtml，独立 partition，
 *     轮询强认证 cookie，登录成功 900ms 后自动关窗并通知。
 *   - 读类目：无 accountId（未登录个人号）时 open() 返回 null → 报 LOGIN「请在首页个人淘宝号登录后重试」。
 *   - 登录检测：强认证 cookie 名（lgc/tracknick/_nk_/dnk/unb/cookie17/cookie2/_l_g_/skt/t/sgcookie）
 *     出现在 *.taobao.com 域（store-login-state.js hasAuthenticatedTaobaoCookies）。
 */

const LOGIN_URL = 'https://login.taobao.com/member/login.jhtml';
const PARTITION = 'persist:xx-personal-taobao';

/** 老软件 store-login-state.js 的强认证 cookie 名单。 */
const STRONG_AUTH_COOKIE_NAMES = new Set([
  'lgc', 'tracknick', '_nk_', 'dnk', 'unb', 'cookie17', 'cookie2', '_l_g_', 'skt', 't', 'sgcookie',
]);

const LOGIN_HOST_RE = /(^|\.)login\.(taobao|tmall)\.com$/i;
const CHALLENGE_HOST_RE = /(^|\.)(aq|passport)\.taobao\.com$/i;
const RISK_HOST_RE = /(^|\.)(sec|risk)\.taobao\.com$/i;

function classifyTaobaoUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    const host = parsed.hostname.toLowerCase();
    const route = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if (RISK_HOST_RE.test(host) || /(?:^|[/_?&=-])(risk|punish|security-check)(?:$|[/_?&=-])/.test(route)) return 'risk-control';
    if (CHALLENGE_HOST_RE.test(host) || /(?:captcha|verify|verification|validate|challenge)/.test(route)) return 'challenge';
    if (LOGIN_HOST_RE.test(host) || /havanaone\/login|login_jump/i.test(route)) return 'login';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function isTaobaoCookieDomain(domain) {
  const d = String(domain || '').toLowerCase();
  return d.endsWith('.taobao.com') || d.endsWith('.tmall.com') || d === 'taobao.com' || d === 'tmall.com';
}

/** 老软件 hasAuthenticatedTaobaoCookies：强认证 cookie 出现在淘宝/天猫域即认为已登录。 */
function hasAuthenticatedTaobaoCookies(cookies) {
  return (Array.isArray(cookies) ? cookies : []).some(cookie => {
    const name = String(cookie?.name || '').toLowerCase();
    const value = String(cookie?.value || '').trim();
    return Boolean(value) && STRONG_AUTH_COOKIE_NAMES.has(name) && isTaobaoCookieDomain(cookie?.domain);
  });
}

function createPersonalTaobaoService({ electron, emit, getWindow } = {}) {
  const { BrowserWindow, session } = electron || {};
  if (!BrowserWindow || !session) throw new Error('personal-taobao 服务需要 electron 引用');

  const mainSession = () => session.fromPartition(PARTITION);
  let loginWindow = null;
  let loginTimer = null;

  async function cookiesSnapshot() {
    try { return await mainSession().cookies.get({}); }
    catch { return []; }
  }

  async function loggedIn() {
    return hasAuthenticatedTaobaoCookies(await cookiesSnapshot());
  }

  function stopWatching() {
    if (loginTimer) { clearInterval(loginTimer); loginTimer = null; }
  }

  /** 登录成功后自动关窗并通知（老软件 900ms 延迟关窗）。 */
  function startWatching(onDone) {
    stopWatching();
    loginTimer = setInterval(async () => {
      if (!loginWindow || loginWindow.isDestroyed()) { stopWatching(); return; }
      if (await loggedIn()) {
        stopWatching();
        try { loginWindow.setTitle('登录成功 · 个人淘宝号'); } catch { /* */ }
        try {
          if (emit) emit({ module: 'personal-taobao', status: 'logged-in', message: '个人淘宝号已登录', done: true });
        } catch { /* */ }
        setTimeout(() => {
          try { if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close(); } catch { /* */ }
          loginWindow = null;
          if (typeof onDone === 'function') onDone();
        }, 900);
      }
    }, 1500);
  }

  /** 打开个人淘宝号登录窗口（复刻 openPersonalTaobaoLoginWindow：1040x760，独立 partition）。 */
  function login() {
    if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.focus(); return { ok: true, partition: PARTITION, url: LOGIN_URL, already: true }; }
    loginWindow = new BrowserWindow({
      width: 1040, height: 760, minWidth: 920, minHeight: 680,
      title: '登录个人淘宝号',
      parent: typeof getWindow === 'function' ? (getWindow() || undefined) : undefined,
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    try { loginWindow.webContents.setWindowOpenHandler(({ url }) => { void loginWindow?.loadURL(url).catch(() => undefined); return { action: 'deny' }; }); } catch { /* */ }
    loginWindow.on('closed', () => { loginWindow = null; stopWatching(); });
    startWatching();
    void loginWindow.loadURL(LOGIN_URL);
    return { ok: true, partition: PARTITION, url: LOGIN_URL };
  }

  /**
   * 隐藏探测窗口工厂（老软件 main.js readSourceCategory deps.open 的等价实现）。
   * 未登录个人号时返回 null —— 调用方按老软件语义报 LOGIN。
   */
  async function openHidden({ width = 1400, height = 1000 } = {}) {
    if (!(await loggedIn())) return null;
    const win = new BrowserWindow({
      show: false, width, height,
      webPreferences: {
        partition: PARTITION, contextIsolation: true, nodeIntegration: false,
        sandbox: true, backgroundThrottling: false,
      },
    });
    try { win.webContents.setAudioMuted(true); } catch { /* */ }
    return {
      loadURL: url => win.loadURL(url),
      executeJavaScript: script => win.webContents.executeJavaScript(script, true),
      url: () => { try { return win.webContents.getURL(); } catch { return ''; } },
      close: () => { try { if (!win.isDestroyed()) win.destroy(); } catch { /* */ } },
    };
  }

  async function handle(method, payload = {}) {
    if (method === 'status') {
      const authed = await loggedIn();
      return { ok: true, loggedIn: authed, partition: PARTITION };
    }
    if (method === 'login') return login();
    if (method === 'logout') {
      try { await mainSession().clearStorageData(); await mainSession().clearCache(); } catch { /* */ }
      return { ok: true };
    }
    throw new Error(`个人淘宝号不支持的操作：${method}`);
  }

  return { handle, login, loggedIn, openHidden, classifyTaobaoUrl, PARTITION, LOGIN_URL };
}

module.exports = {
  createPersonalTaobaoService, hasAuthenticatedTaobaoCookies, classifyTaobaoUrl,
  PARTITION, LOGIN_URL, STRONG_AUTH_COOKIE_NAMES,
};
