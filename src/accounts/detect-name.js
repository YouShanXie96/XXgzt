'use strict';

// Reads the currently visible 千牛 shop name from one store's own seller page.
//
// Boundaries kept here: only the store's own persisted seller page is read,
// only visible official shop-name nodes are used, and nothing except the
// trimmed name leaves this module. Cookies, tokens, form values and other
// pages are never touched.
const SELLER_ORIGIN = 'https://myseller.taobao.com';
const GENERIC = /^(?:店铺|店铺名称|我的店铺|未登录|请登录|登录|账号|昵称|主店)$/;

function readVisibleShopName() {
  const visible = element => {
    if (!element?.getClientRects?.().length) return false;
    if (element.closest?.('input,textarea,select,[contenteditable]')) return false;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
    }
    return true;
  };
  const text = node => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const body = String(document.body?.innerText || '').slice(0, 120000);
  return {
    url: String(location.href || ''),
    names: [...document.querySelectorAll('.user-area-pop-up-panel [class*="shopName--"]')].filter(visible).map(text).filter(Boolean),
    blocked: /请完成(?:安全)?验证|验证码|滑动验证|访问受限|访问过于频繁|账号(?:已)?(?:封禁|冻结)|账号存在风险|请拖动滑块/.test(body)
      || [...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="punish"],.nc-container')].some(visible),
    loginRequired: [...document.querySelectorAll('input[type="password"]')].some(visible) || /请先登录|登录已失效|登录状态已失效/.test(body),
  };
}

function sellerPageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== SELLER_ORIGIN || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

function acceptedName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2 || name.length > 60 || GENERIC.test(name)) return '';
  if (/[\u0000-\u001f\u007f]/.test(name)) return '';
  return name;
}

/**
 * Returns {name} only when the seller page shows exactly one usable shop name.
 * Anything else returns {name:'', message} so the UI can explain what is missing
 * instead of guessing a name from a title, URL or the local label.
 */
function namesFromEvidence(evidence, expectedUrl) {
  const url = sellerPageUrl(evidence?.url || '');
  if (!url) return { name: '', message: '当前千牛页面地址不是官方商家中心，未识别店铺名称。' };
  if (!/^\/home\.htm(?:\/|$)/i.test(url.pathname)) return { name: '', message: '请先打开千牛工作台首页，再自动识别店铺名称。' };
  if (expectedUrl && sellerPageUrl(expectedUrl)?.href !== url.href) return { name: '', message: '读取时页面发生变化，未使用本次识别结果。' };
  if (evidence?.blocked) return { name: '', message: '页面要求安全验证，请先完成验证再识别店铺名称。' };
  if (evidence?.loginRequired) return { name: '', message: '千牛页面尚未登录，登录后再识别店铺名称。' };
  const names = [...new Set((Array.isArray(evidence?.names) ? evidence.names : []).map(acceptedName).filter(Boolean))];
  if (names.length !== 1) return { name: '', message: names.length ? '页面显示多个店铺名称，未自动改名。' : '页面尚未显示店铺名称，请等待千牛工作台加载完成后重试。' };
  return { name: names[0], message: '已按千牛页面显示的店铺名称自动识别。' };
}

async function detectSellerName(webContents, { now = Date.now } = {}) {
  if (!webContents || webContents.isDestroyed?.()) return { name: '', message: '请先在店铺浏览器打开千牛工作台，再识别店铺名称。' };
  let url = '';
  try { url = String(webContents.getURL?.() || ''); } catch { return { name: '', message: '千牛页面尚未就绪。' }; }
  const parsed = sellerPageUrl(url);
  if (!parsed) return { name: '', message: '当前页面不是官方商家中心，未识别店铺名称。' };
  let evidence;
  try { evidence = await webContents.executeJavaScript(`(${readVisibleShopName.toString()})()`, false); }
  catch { return { name: '', message: '页面暂时无法读取，请稍后重试。' }; }
  if (typeof now !== 'function' || !Number.isFinite(now())) return { name: '', message: '本机时间无效，未识别店铺名称。' };
  return namesFromEvidence(evidence, url);
}

module.exports = { SELLER_ORIGIN, readVisibleShopName, sellerPageUrl, acceptedName, namesFromEvidence, detectSellerName };
