'use strict';

const SOURCES = Object.freeze({
  business: { browserKind: 'sycm', host: 'sycm.taobao.com', path: '/portal/home.htm', label: '生意参谋' },
  trends: { browserKind: 'traffic', host: 'one.alimama.com', path: '/index.html', route: '!/insight/search/traffic-analysis/index', label: '流量解析' },
  peers: { browserKind: 'dmp', host: 'dmp.taobao.com', path: '/index_new.html', route: '!/compete/market-rank', label: '达摩盘市场榜单' },
});

function assertSourceUrl(kind, value) {
  const source = SOURCES[kind];
  if (!source) throw new Error('不支持的数据采集类型');
  let url;
  try { url = new URL(value); } catch { throw new Error('后台页面地址无效，请重新打开数据来源页面'); }
  const route = url.hash.slice(1).split('?')[0].replace(/\/+$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname !== source.host ||
      url.pathname !== source.path || (source.route && route !== source.route)) {
    throw new Error(`请先在 ${source.label} 对应页面完成登录和查询，再采集当前页。当前页面不符合采集范围。`);
  }
  // Persist a page identity, never authentication or tracking query strings.
  return `${url.origin}${url.pathname}${source.route ? '#' + source.route : ''}`;
}

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').trim().slice(0, max);
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cleanText(value, 100).replace(/[,，\s￥¥]/g, '');
  if (!text || /^[-—–/]+$/.test(text) || /[~～至<>＜＞]/.test(text)) return null;
  const match = text.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(亿|万|千)?(?:%|％|元|人|次|件|天)?$/);
  if (!match) return null;
  const result = Number(match[1]) * ({ 亿: 1e8, 万: 1e4, 千: 1e3 }[match[2]] || 1);
  return Number.isFinite(result) ? result : null;
}

function isoDate(value) {
  let text = cleanText(value, 80);
  if (/^\d{13}$/.test(text)) {
    const date = new Date(Number(text));
    if (!Number.isFinite(date.getTime())) return '';
    // The data sources use China business dates, irrespective of host timezone.
    text = new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  }
  const match = text.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})(?:日|\b|T|\s|$)/);
  if (!match) return '';
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dateRange(values) {
  const dates = (Array.isArray(values) ? values : [values]).flatMap(value =>
    String(value ?? '').match(/\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}日?/g) || []
  ).map(isoDate).filter(Boolean);
  return dates.length ? { startDate: dates[0], endDate: dates[1] || dates[0] } : { startDate: '', endDate: '' };
}

function unique(items) { return [...new Set(items.filter(Boolean))]; }

function requireRange(range, payload = {}) {
  if (range?.startDate && range?.endDate) {
    if (range.startDate > range.endDate) throw new Error('后台统计日期先后顺序异常，请核对查询范围');
    return { ...range, manuallyConfirmed: false };
  }
  const startDate = isoDate(payload.startDate || payload.start), endDate = isoDate(payload.endDate || payload.end);
  if (!startDate || !endDate || startDate > endDate) throw new Error('未识别到明确的统计起止日期，本次未保存。请核对后台当前查询范围，并在 XX 补充统计开始、结束日期后重试');
  return { startDate, endDate, manuallyConfirmed: true };
}

function assertSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('页面未返回可读取的数据，请检查页面加载和登录状态');
  if (snapshot.blocked) throw new Error('后台出现登录、安全验证或访问限制，请在后台窗口手动处理后重新采集');
}

// This helper is serialized into each read-only page script. It returns only display metadata.
function readPageContext() {
  const visible = el => !!el && !!(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const text = el => String(el?.innerText || el?.textContent || '').replace(/\u00a0/g, ' ').trim();
  const selected = [...document.querySelectorAll('[aria-selected="true"], [aria-checked="true"], input:checked, .ant-radio-button-wrapper-checked, .ant-tabs-tab-active, .next-tabs-tab.active, .ant-radio-wrapper-checked')]
    .filter(visible).map(el => text(el.closest('label') || el)).filter(Boolean).map(s => s.slice(0, 100)).slice(0, 50);
  const dates = [...document.querySelectorAll('input')].filter(visible).map(el => String(el.value || ''))
    .filter(s => /\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}/.test(s)).slice(0, 12);
  const body = text(document.body).slice(0, 160000);
  const ranges = [...body.matchAll(/\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}日?\s*(?:~|～|至|到|—|–|-)\s*\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}日?/g)].map(m => m[0]).slice(0, 12);
  const blocked = [...document.querySelectorAll('[role="dialog"], .ant-modal, .nc-container, #nc_1_wrapper, #login-form')]
    .filter(visible).some(el => /滑动验证|安全验证|扫码登录|账号登录|请先登录|访问受限/.test(text(el)));
  return { url: location.href, title: document.title, selected, dates, ranges, blocked, visible, text };
}

function buildReadScript(reader, options = {}) {
  return `(() => { 'use strict'; const readContext = ${readPageContext.toString()}; return (${reader.toString()})(readContext(), ${JSON.stringify(options)}); })()`;
}

module.exports = { SOURCES, assertSourceUrl, cleanText, numeric, isoDate, dateRange, unique, requireRange, assertSnapshot, buildReadScript };
