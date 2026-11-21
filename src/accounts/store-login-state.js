'use strict';

// 登录状态“快速判断”（参考“同类工作台”的方案）：毫秒级结论，不打开页面。
// - 强登录 Cookie 白名单：只判断“名称 + 域名 + 值是否非空”是否命中，
//   绝不读取、记录或返回任何 Cookie 值；
// - 官方页面地址分类：工作台 / 登录 / 验证 / 风控；
// - 命中后先显示“已登录（快速判断）”，再由已打开页面的 DOM 证据或后台保活复核确认。
// `t`、`cookie2` 等匿名访问也会被平台种下的跟踪 Cookie 不在这里：
// 它们单独出现不能证明“已登录”（2026-10-10 实测：未登录的腾味莱分区里就有 `t`）。
const STRONG_AUTH_COOKIE_NAMES = Object.freeze([
  'lgc', 'tracknick', '_nk_', 'dnk', 'unb', 'cookie17', '_l_g_', 'skt', 'sgcookie'
]);
const WEAK_AUTH_COOKIE_NAMES = Object.freeze(['t', 'cookie2']);
const WORKBENCH_HOSTS = Object.freeze([
  'myseller.taobao.com', 'qn.taobao.com', 'sycm.taobao.com', 'seller.taobao.com', 'sell.tmall.com'
]);
const LOGIN_HOSTS = Object.freeze(['login.taobao.com', 'login.tmall.com', 'loginmyseller.taobao.com']);
const CHALLENGE_HOSTS = Object.freeze(['aq.taobao.com', 'passport.taobao.com']);
const RISK_HOSTS = Object.freeze(['sec.taobao.com', 'risk.taobao.com']);

function matchHost(hostname, hosts) {
  return hosts.some(host => hostname === host || hostname.endsWith('.' + host));
}
function isTaobaoCookieDomain(domain) {
  const hostname = String(domain || '').replace(/^\.+/, '').toLowerCase();
  return matchHost(hostname, ['taobao.com', 'tmall.com']);
}
function hasStrongAuthCookie(cookies) {
  if (!Array.isArray(cookies)) return false;
  return cookies.some(cookie => {
    const name = String(cookie?.name || '').toLowerCase();
    const value = String(cookie?.value || '').trim();
    return Boolean(value) && STRONG_AUTH_COOKIE_NAMES.includes(name) && isTaobaoCookieDomain(cookie?.domain);
  });
}
function classifyTaobaoLoginPage(value) {
  try {
    const url = new URL(String(value || ''));
    const hostname = url.hostname.toLowerCase();
    const route = `${url.pathname}${url.search}${url.hash}`.toLowerCase();
    if (matchHost(hostname, RISK_HOSTS)
      || /(?:^|[\/_?&=-])(?:risk|punish|security-check)(?:$|[\/_?&=-])/.test(route)) return 'risk-control';
    if (matchHost(hostname, CHALLENGE_HOSTS)
      || /(?:captcha|verify|verification|validate|challenge)/.test(route)) return 'challenge';
    if (matchHost(hostname, LOGIN_HOSTS)) return 'login';
    if (matchHost(hostname, WORKBENCH_HOSTS)) return 'workbench';
    return 'unknown';
  } catch { return 'unknown'; }
}
// 输入只接受脱敏结果：strongCookie = 是否命中强登录 Cookie，urls = 已打开页面的地址。
function resolveStoreLoginState({ strongCookie = false, urls = [] } = {}) {
  const kinds = (Array.isArray(urls) ? urls : []).map(classifyTaobaoLoginPage);
  if (kinds.includes('risk-control')) return { status: 'verification-required', reason: 'risk-control' };
  if (kinds.includes('challenge')) return { status: 'verification-required', reason: 'challenge' };
  if (kinds.includes('login')) return { status: 'needs-login', reason: 'login-page' };
  if (strongCookie) return { status: 'logged-in', reason: 'auth-cookie' };
  if (kinds.includes('workbench')) return { status: 'logged-in', reason: 'store-workbench-url' };
  return { status: 'unknown', reason: 'missing-auth-signal' };
}
module.exports = { STRONG_AUTH_COOKIE_NAMES, WEAK_AUTH_COOKIE_NAMES, hasStrongAuthCookie, isTaobaoCookieDomain, classifyTaobaoLoginPage, resolveStoreLoginState };
