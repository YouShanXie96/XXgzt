'use strict';

const { buildReadScript, assertSnapshot, cleanText, dateRange, unique, requireRange } = require('./common');

function readPeersPage(ctx) {
  const { visible, text } = ctx;
  const tables = [];
  for (const table of document.querySelectorAll('table,[role="table"],[role="grid"]')) {
    if (!visible(table)) continue;
    // DMP renders separate header/body tables inside the verified .bg-f5.radius block.
    const container = table.closest('.next-table,.ant-table,[class*="table-wrapper"],.bg-f5.radius') || table;
    let headers = [...table.querySelectorAll('thead th,thead td,[role="columnheader"]')].filter(visible).map(text);
    if (!headers.length) headers = [...container.querySelectorAll('thead th,thead td,[role="columnheader"]')].filter(visible).map(text);
    if (!headers.length || !headers.some(value => /成交|展现|商品|宝贝|店铺|排名/.test(value))) continue;
    const rows = [...table.querySelectorAll('tbody tr,[role="row"]')].filter(row => visible(row) && !row.querySelector('th,[role="columnheader"]')).slice(0, 200).map(row => {
      const cells = [...row.querySelectorAll('td,[role="cell"],[role="gridcell"]')].map(cell => ({
        text: text(cell).slice(0, 1000),
        links: [...cell.querySelectorAll('a[href]')].map(link => ({ text: text(link).slice(0, 300), href: link.getAttribute('href'), title: link.getAttribute('title') || '' })).slice(0, 5),
        title: cell.querySelector('[title]')?.getAttribute('title') || '',
      }));
      return { cells };
    }).filter(row => row.cells.length);
    if (rows.length) tables.push({ headers, rows });
  }
  const selectors = [...document.querySelectorAll('[role="combobox"],.next-select,.ant-select-selection-item,[class*="filter-item"],[class*="filterItem"]')]
    .filter(visible).map(text).filter(value => value && value.length < 250).slice(0, 35);
  // Verified DMP version: these selectable DIVs have no ARIA state. Keep the
  // exact version selector and value whitelist; a future hash change stays unknown.
  const rankingOptions = new Set(['店铺', '宝贝', '销量明星', '搜索热门', '营销明星', '热销新品']);
  const selectedRankingOptions = [...document.querySelectorAll('.special.dKqGwkpYDN')]
    .filter(visible).map(text).filter(value => rankingOptions.has(value));
  const body = text(document.body).slice(0, 120000);
  const scopes = [...body.matchAll(/(?:前\s*\d+\s*(?:名|条|个)|共\s*\d+\s*条|每页\s*\d+\s*条|第\s*\d+\s*页|近\s*\d+\s*天)/g)].map(match => match[0]).slice(0, 12);
  return { url: ctx.url, blocked: ctx.blocked, selected: [...new Set([...ctx.selected, ...selectedRankingOptions])], dates: ctx.dates, ranges: ctx.ranges,
    filters: selectors, scopes, tables: tables.slice(0, 8) };
}

function headerKey(value) { return cleanText(value, 100).replace(/[\uE000-\uF8FF]|\s|[（(][^）)]*[）)]/g, ''); }
function itemIdFromCells(cells) {
  for (const cell of cells) {
    const visibleId = cleanText(cell.text, 1500).match(/(?:商品|宝贝)?\s*ID\s*[:：]?\s*(\d{5,})/i);
    if (visibleId) return visibleId[1];
    for (const link of cell.links || []) {
      try {
        const url = new URL(link.href, 'https://dmp.taobao.com');
        if (!(url.hostname.endsWith('.taobao.com') || url.hostname.endsWith('.tmall.com'))) continue;
        const id = url.searchParams.get('id') || url.searchParams.get('itemId');
        if (/^\d{5,}$/.test(id || '')) return id;
      } catch {}
    }
  }
  return '';
}

function parsePeersSnapshot(snapshot, payload = {}) {
  assertSnapshot(snapshot);
  const range = requireRange(dateRange(snapshot.ranges?.[0] || snapshot.dates || []), payload);
  const byIdentity = new Map();
  for (const table of (snapshot.tables || []).slice(0, 8)) {
    const headers = (table.headers || []).map(headerKey);
    const find = regex => headers.findIndex(header => regex.test(header));
    const indices = {
      rank: find(/^(排名|排行|序号)$/),
      title: find(/^(商品|宝贝)(信息|名称|标题)?$|^标题$/),
      shopName: find(/^(?:所属)?店铺(信息|名称)?$/),
      listedDays: find(/上架天数|上架时长/),
      tradeCount: find(/^成交件数$|^成交量$|^销量$/),
      views: find(/^(浏览量|展现量|展现指数|曝光量|展现)$/),
      paidClicks: find(/^(付费点击量|付费点击|点击量|点击指数)$/),
      viewsChange: find(/(?:浏览|展现).*(?:环比|变化)|(?:环比|变化).*(?:浏览|展现)/),
    };
    if (indices.title < 0 && indices.shopName < 0) continue;
    for (const record of (table.rows || []).slice(0, 200)) {
      const cells = record.cells || [];
      if (cells.length !== headers.length) continue;
      const at = key => cleanText(cells[indices[key]]?.text, key === 'title' ? 500 : 250);
      const titleCell = cells[indices.title];
      const title = cleanText(titleCell?.title || titleCell?.links?.find(link => link.text)?.text || at('title'), 500);
      const shopName = at('shopName');
      if ((!title && !shopName) || /暂无数据|没有数据|加载中/.test(title || shopName)) continue;
      const rawRank = at('rank').split(/\r?\n/)[0].trim();
      const rank = /^\d+$/.test(rawRank) ? Number(rawRank) : null;
      const itemId = itemIdFromCells(cells);
      const extra = {};
      for (let index = 0; index < headers.length; index++) {
        if (!headers[index] || !cells[index] || Object.values(indices).includes(index)) continue;
        if (/操作|关注|加入推广/.test(headers[index])) continue;
        if (/ROI|成交件数环比/.test(headers[index])) continue; // platform removed these fields in 2026-08
        extra[headers[index]] = cleanText(cells[index].text, 300);
      }
      if (indices.views >= 0) extra.viewsMetric = headers[indices.views];
      if (indices.viewsChange >= 0) extra.viewsChangeMetric = headers[indices.viewsChange];
      const inlineListedDays = cleanText(titleCell?.text, 1000).match(/上架\s*(\d+)\s*天/);
      const listedDays = at('listedDays') || (inlineListedDays ? inlineListedDays[1] + '天' : '');
      const row = { rank, itemId, title, shopName, listedDays, tradeCount: at('tradeCount'),
        views: at('views'), paidClicks: at('paidClicks'), viewsChange: at('viewsChange'), extra };
      const key = itemId || [rank ?? '', title, shopName].join('|');
      const previous = byIdentity.get(key);
      if (previous) {
        for (const [field, value] of Object.entries(row)) if (value !== '' && value !== null && field !== 'extra') previous[field] = value;
        previous.extra = { ...previous.extra, ...extra };
      } else byIdentity.set(key, row);
    }
  }
  const rows = [...byIdentity.values()];
  if (!rows.length) throw new Error('未读取到达摩盘榜单表格，请在“市场榜单”选好类目、店铺/宝贝和榜单类型，等待结果展示后重试；本次未保存');
  const selected = unique(snapshot.selected || []);
  const subjects = selected.filter(value => /^(店铺|宝贝)$/.test(value));
  const rankingTypes = selected.filter(value => /^(销量明星|搜索热门|营销明星|热销新品)$/.test(value));
  const context = { scope: 'current-visible-ranking', subject: subjects.length === 1 ? subjects[0] : '',
    rankingType: rankingTypes.length === 1 ? rankingTypes[0] : '',
    category: cleanText(payload.category, 200),
    filters: unique(snapshot.filters || []), selected, scopeLabels: unique(snapshot.scopes || []), visibleRows: rows.length, datesManuallyConfirmed: range.manuallyConfirmed };
  const warnings = ['仅采集当前查询、当前已加载的榜单行，未翻页，不代表全行业或全部店铺。',
    '成交、浏览、展现、点击等区间数据保留后台原文及对应指标名称；不把区间中点当作精确数值，不混同浏览量与展现指数。',
    '达摩盘通知自 2026-08-12 起下线成交件数环比及宝贝 ROI，本采集不生成这两个指标。'];
  if (range.manuallyConfirmed) warnings.push('本批统计日期由用户根据原后台手动确认，不是页面自动识别结果。');
  if (context.category) warnings.push('本批类目由用户根据达摩盘当前查询手动填写，原页面筛选文本同时保留供核对。');
  if (!context.subject) warnings.push('未识别到唯一的榜单对象（店铺/宝贝），请对照达摩盘当前选择核对；本批不自动猜测。');
  if (!context.rankingType) warnings.push('未识别到唯一的榜单类型，请对照达摩盘当前选择核对；本批不自动猜测销量、搜索、营销或新品榜单。');
  return { ...range, rows, context, warnings };
}

const buildPeersReadScript = () => buildReadScript(readPeersPage);
async function capturePeers(adapter, payload) { return parsePeersSnapshot(await adapter.read(buildPeersReadScript()), payload); }
module.exports = { buildPeersReadScript, parsePeersSnapshot, capturePeers, itemIdFromCells };
