'use strict';

const { buildReadScript, assertSnapshot, cleanText, numeric, dateRange, unique, requireRange } = require('./common');

const METRICS = Object.freeze([
  { metric: 'payAmount', label: '支付金额', sourceIds: ['payAmt'], markers: ['payAmt'], unit: '元' },
  { metric: 'netPaymentAmount', label: '净支付金额', sourceIds: ['netPaymentAmount'], markers: ['netPaymentAmount'], unit: '元' },
  { metric: 'visitors', label: '访客数', sourceIds: ['uv'], markers: ['overview-index-uv', 'source:uv|'], unit: '人' },
  { metric: 'buyers', label: '支付买家数', sourceIds: ['payBuyerCnt', 'payByrCnt'], markers: ['payBuyerCnt', 'payByrCnt'], unit: '人' },
  { metric: 'conversionRate', label: '支付转化率', sourceIds: ['payRate'], markers: ['payRate'], unit: '%' },
  { metric: 'refundAmount', label: '退款金额（完结时间）', sourceIds: ['rfdSucAmt', 'refundAmt', 'refundAmount'], aliases: ['退款金额(完结时间)', '退款金额'], markers: ['rfdSucAmt', 'refundAmt', 'refundAmount'], unit: '元' },
  { metric: 'refundRate', label: '金额退款率', sourceIds: ['payAmtRfdRate', 'refundRate'], markers: ['payAmtRfdRate', 'refundRate'], unit: '%' },
  { metric: 'cartBuyers', label: '加购人数', sourceIds: ['cartBuyerCnt', 'cartByrCnt'], markers: ['cartBuyerCnt', 'cartByrCnt'], unit: '人' },
  { metric: 'favorites', label: '商品收藏人数', sourceIds: ['cltItmCnt'], markers: ['cltItmCnt'], unit: '人' },
  { metric: 'pageViews', label: '浏览量', sourceIds: ['pv'], markers: ['overview-index-pv', 'source:pv|'], unit: '次' },
  { metric: 'cartItems', label: '加购件数', sourceIds: ['cartItemCnt'], markers: ['cartItemCnt'], unit: '件' },
  { metric: 'paidSubOrders', label: '支付子订单数', sourceIds: ['payOrdCnt'], markers: ['payOrdCnt'], unit: '笔' },
  { metric: 'refundOrderRate', label: '订单退款率', sourceIds: ['ordRfdRate'], markers: ['ordRfdRate'], unit: '%' },
  { metric: 'paidItems', label: '支付件数', sourceIds: ['payItmCnt'], markers: ['payItmCnt'], unit: '件' },
  { metric: 'unitPrice', label: '客单价', sourceIds: ['payPct', 'perTicketSales'], markers: ['payPct', 'perTicketSales', '客单价'], unit: '元' },
  { metric: 'promotionCost', label: '推广花费', markers: ['推广花费'], unit: '元' },
]);

function readBusinessPage(ctx, options) {
  const { visible, text } = ctx;
  const cards = [];
  const primarySourceIds = new Set(options.primarySourceIds);
  // Every dashboard module can have its own period. Bind an overview card to its
  // nearest preceding, explicitly labelled statistics date rather than a body-wide date.
  const anchors = [...document.querySelectorAll('span,div,p')].filter(node => {
    if (!visible(node)) return false;
    const value = text(node);
    return value.length < 180 && /统计(?:时间|日期)/.test(value) && /\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}/.test(value);
  });
  const statisticsFor = node => {
    let anchor;
    for (const item of anchors) {
      if (item.contains(node) || !(item.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (!anchor || anchor.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) anchor = item;
    }
    if (!anchor) return { dateEvidence: '', period: '' };
    let period = '';
    for (let holder = anchor.parentElement, depth = 0; holder && depth < 4; holder = holder.parentElement, depth++) {
      const selected = [...holder.querySelectorAll('[aria-selected="true"], [aria-checked="true"], .active, .selected, .ant-radio-button-wrapper-checked')]
        .filter(visible).map(text).find(s => /^(实时|日|周|月|自定义|今日|昨日)$/.test(s));
      if (selected) { period = selected; break; }
    }
    const evidence = text(anchor);
    return { dateEvidence: evidence, period: period || (/\d{1,2}:\d{2}(?::\d{2})?/.test(evidence) ? '实时' : '') };
  };
  for (const valueNode of document.querySelectorAll('.index-value[data-onetrace-index-id]')) {
    if (!visible(valueNode)) continue;
    const sourceId = valueNode.getAttribute('data-onetrace-index-id');
    if (!primarySourceIds.has(sourceId)) continue;
    let marked = '', card = valueNode.parentElement, mainLevel;
    for (let ancestor = valueNode.parentElement, depth = 0; ancestor && depth < 25; ancestor = ancestor.parentElement, depth++) {
      const classes = String(ancestor.className || '');
      // Yesterday and child ratios live under the same overview container. They
      // must never inherit its payAmt identity or current-day date.
      if (/(?:^|\s)(?:index-level-[2-9]\d*|level-ystValue)(?:\s|$)/.test(classes)) break;
      if (/(?:^|\s)index-level-1(?:\s|$)/.test(classes)) mainLevel = ancestor;
      const marker = classes + ' ' + (ancestor.id || '');
      if (/top-left-overview-|overview-index-/.test(marker)) { marked = marker; card = ancestor; break; }
      if (/home-incrise|growth-factor/.test(marker)) break;
    }
    // Only the verified top overview is collected. Growth-factor cards need a separate period adapter.
    if (!marked || !mainLevel) continue;
    const sourceField = `source:${sourceId}|${marked}`;
    const valueElement = valueNode.firstElementChild;
    // The sibling .cyclecrc contains a comparison (e.g. 100%), not the primary number.
    const primaryText = valueElement && visible(valueElement) && !/cyclecrc/.test(String(valueElement.className || '')) ? String(valueElement.innerText || '').replace(/\s/g, '') : '';
    const suffix = [...(valueNode.childNodes || [])].filter(node => node !== valueElement && !(node.nodeType === 1 && /cyclecrc/.test(String(node.className || ''))))
      .map(node => node.nodeType === 3 ? node.textContent : node.nodeType === 1 && visible(node) ? String(node.innerText || '') : '').join('').replace(/\s/g, '');
    const primary = primaryText ? primaryText + suffix : '';
    const label = [...mainLevel.querySelectorAll('.index-name')].filter(visible).map(text)[0] || '';
    cards.push({ text: `${label}\n${primary}`, primary, sourceField: sourceField.slice(0, 300),
      section: '顶部经营总览', ...statisticsFor(valueNode), comparison: [...valueNode.querySelectorAll('.cyclecrc')].filter(visible).map(node => String(node.innerText || '').trim()).join('；').slice(0, 200) });
  }
  return { url: ctx.url, selected: ctx.selected, blocked: ctx.blocked, cards: cards.slice(0, 60), dateScope: 'per-card-statistics-label' };
}

function parseBusinessSnapshot(snapshot, payload = {}) {
  assertSnapshot(snapshot);
  const globalPeriod = (snapshot.selected || []).find(value => /^(实时|日|周|月|自定义|今日|昨日)$/.test(value)) || '';
  const rows = [];
  const seen = new Set();
  let skippedDates = 0, manualDates = false;
  for (const card of (snapshot.cards || []).slice(0, 120)) {
    const content = cleanText(card.text, 1800);
    const sourceField = cleanText(card.sourceField, 300);
    const explicitSource = sourceField.match(/^source:([^|]+)\|/);
    const metric = explicitSource
      ? METRICS.find(item => item.sourceIds?.includes(explicitSource[1]))
      : METRICS.find(item => item.markers.some(marker => sourceField.includes(marker))) ||
        METRICS.find(item => [item.label, ...(item.aliases || [])].some(label => content.split(/\n/).some(line => line.trim() === label)));
    if (!metric) continue;
    let rawValue = cleanText(card.primary, 80);
    if (numeric(rawValue) === null) {
      const lines = content.split(/\n/).map(line => line.trim()).filter(Boolean);
      const labelIndex = lines.findIndex(line => [metric.label, ...(metric.aliases || [])].includes(line));
      // Comparisons and chart ticks are not a primary metric value.
      const candidates = labelIndex < 0 ? [] : lines.slice(labelIndex + 1, labelIndex + 5);
      rawValue = candidates.find(line => numeric(line) !== null) || '';
    }
    const value = numeric(rawValue);
    if (value === null) continue;
    const period = cleanText(card.period, 50) || globalPeriod || '当前页面所选周期（未识别）';
    if (payload.period && period !== payload.period) continue;
    const section = cleanText(card.section, 100) || '经营概览';
    let rowRange = dateRange(card.dateEvidence || card.rangeText || card.dates || []);
    if (!rowRange.startDate && snapshot.dateScope !== 'per-card-statistics-label') rowRange = dateRange(snapshot.ranges?.[0] || snapshot.dates || []);
    if (!rowRange.startDate) {
      try { rowRange = requireRange({}, payload); manualDates = true; }
      catch { skippedDates++; continue; }
    }
    const key = [metric.metric, period, section, rowRange.startDate, rowRange.endDate, value].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ metric: metric.metric, label: metric.label, value, rawValue, unit: metric.unit, period, section,
      startDate: rowRange.startDate, endDate: rowRange.endDate,
      comparison: cleanText(card.comparison || content.split(/\n/).filter(line => /同比|环比|较昨日|较前|较上|昨日同期/.test(line)).join('；'), 300), sourceField });
  }
  if (!rows.length && skippedDates) throw new Error('已识别经营指标，但无法确认所属统计日期，本次未保存。请核对顶部经营总览的日期，并在 XX 补充统计开始、结束日期后重试');
  if (!rows.length) throw new Error('未识别到生意参谋经营指标，请打开“首页/经营概况”，完成登录并等待数据展示后重试；本次未保存');
  const range = { startDate: rows.map(row => row.startDate).sort()[0], endDate: rows.map(row => row.endDate).sort().at(-1) };
  const warnings = ['本版仅采集当前页面顶部经营总览已展示且可确定日期的指标，增长因子、推广花费等其他模块未采集。', '店铺身份以生意参谋页面为准，请确认与 XX 当前选中的店铺一致。'];
  if (skippedDates) warnings.push(`${skippedDates} 个指标无法确认日期，已跳过，未混入本批。`);
  if (manualDates) warnings.push('部分指标的统计日期由用户根据顶部总览手动确认，不是页面自动识别结果。');
  if (rows.some(row => /未识别/.test(row.period))) warnings.push('部分模块的统计周期未识别，请对照原后台核对，避免混合实时、日、周、月数据。');
  return { ...range, rows, context: { scope: 'top-overview-current-query', period: globalPeriod || '当前总览所选周期', datesManuallyConfirmed: manualDates, capturedMetrics: unique(rows.map(row => row.label)) }, warnings };
}

const buildBusinessReadScript = () => buildReadScript(readBusinessPage, { primarySourceIds: METRICS.flatMap(metric => metric.sourceIds || []) });
async function captureBusiness(adapter, payload) { return parseBusinessSnapshot(await adapter.read(buildBusinessReadScript()), payload); }
module.exports = { METRICS, buildBusinessReadScript, parseBusinessSnapshot, captureBusiness };
