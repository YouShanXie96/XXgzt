'use strict';

const { buildReadScript, assertSnapshot, cleanText, dateRange, unique } = require('./common');
const { METRICS, parseChartOption, mergeRows } = require('./trend-data');

function readTrendsPage(ctx) {
  const { visible, text } = ctx;
  const parsedUrl = new URL(location.href);
  const hashParams = new URLSearchParams(parsedUrl.hash.includes('?') ? parsedUrl.hash.slice(parsedUrl.hash.indexOf('?') + 1) : '');
  const urlWord = hashParams.get('word') || hashParams.get('keyword') || parsedUrl.searchParams.get('word') || parsedUrl.searchParams.get('keyword') || '';
  const keywordInput = [...document.querySelectorAll('input:not([type="password"]):not([type="hidden"])')].find(input => visible(input) && /关键词|keyword|queryWord/i.test([input.placeholder, input.name, input.id].join(' ')));
  const keyword = urlWord || keywordInput?.value || '';
  const checked = [...document.querySelectorAll('input[type="radio"]:checked,[role="radio"][aria-checked="true"]')].filter(node => visible(node) || visible(node.closest('label') || node.parentElement));
  const categoryNode = checked.find(node => {
    const label = text(node.closest('label') || node.parentElement);
    return label && !/^(过去\d+天|过去13个月|展现指数|点击指数|点击率|点击转化率|竞争指数|市场均价)$/.test(label);
  });
  const category = categoryNode ? text(categoryNode.closest('label') || categoryNode.parentElement).slice(0, 200) : '';
  const categoryId = categoryNode && /^\d{2,60}$/.test(String(categoryNode.value || '')) ? String(categoryNode.value) : '';
  const metricNames = ['展现指数', '点击指数', '点击率', '点击转化率', '竞争指数', '市场均价'];
  const active = [...document.querySelectorAll('[aria-selected="true"],[aria-checked="true"],.active,.selected,[class*="active"],[class*="selected"]')]
    .filter(visible).map(text).filter(value => metricNames.includes(value));
  const options = [];
  if (window.echarts && typeof window.echarts.getInstanceByDom === 'function') {
    for (const node of document.querySelectorAll('[_echarts_instance_],canvas')) {
      const chart = window.echarts.getInstanceByDom(node) || window.echarts.getInstanceByDom(node.parentElement);
      if (!chart || typeof chart.getOption !== 'function' || !visible(node)) continue;
      try {
        const option = chart.getOption();
        options.push({
          xAxis: (Array.isArray(option.xAxis) ? option.xAxis : [option.xAxis]).filter(Boolean).map(axis => ({ data: (axis.data || []).slice(0, 2000) })),
          series: (option.series || []).slice(0, 10).map(series => ({ name: series.name || '', xAxisIndex: series.xAxisIndex || 0, data: (series.data || []).slice(0, 2000) })),
        });
      } catch {}
      if (options.length >= 6) break;
    }
  }
  const labels = [...ctx.selected, ...document.querySelectorAll('button,[class*="date"],[class*="Date"]')].map(value => typeof value === 'string' ? value : visible(value) ? text(value) : '').filter(value => value && value.length <= 120);
  const selectedRange = labels.find(value => /过去13个月/.test(value)) || labels.find(value => /^过去\d+天$/.test(value)) || '';
  return { url: ctx.url, blocked: ctx.blocked, keyword: keyword.slice(0, 120), keywordSource: urlWord ? 'page-url' : 'visible-input',
    inputKeyword: String(keywordInput?.value || '').slice(0, 120), category, categoryId, activeMetric: active[0] || '',
    selectedRange, ranges: ctx.ranges, dates: ctx.dates, options };
}

function normalizeIdentity(value) { return cleanText(value, 200).replace(/\s/g, '').toLowerCase(); }
function pageRange(snapshot) {
  const candidates = (snapshot.ranges || []).map(dateRange).filter(range => range.startDate && range.endDate);
  if (!candidates.length) return dateRange(snapshot.dates || []);
  // A 13-month analysis may contain comparison/date widgets; take the widest valid displayed range.
  return candidates.sort((a, b) => (Date.parse(b.endDate) - Date.parse(b.startDate)) - (Date.parse(a.endDate) - Date.parse(a.startDate)))[0];
}

function parseTrendsSnapshot(snapshot, payload = {}, observation = {}) {
  assertSnapshot(snapshot);
  const keyword = cleanText(snapshot.keyword, 120);
  if (!keyword) throw new Error('未识别到当前查询关键词，请在流量解析输入关键词并完成查询后采集');
  if (payload.keyword && normalizeIdentity(payload.keyword) !== normalizeIdentity(keyword)) throw new Error('当前后台关键词与待采集关键词不一致，请先在后台查询该词再采集');
  if (snapshot.inputKeyword && snapshot.keywordSource === 'page-url' && normalizeIdentity(snapshot.inputKeyword) !== normalizeIdentity(keyword)) {
    throw new Error('关键词输入框与已提交查询不一致，请完成查询并等待趋势刷新后采集');
  }
  if (payload.category && snapshot.category && normalizeIdentity(payload.category) !== normalizeIdentity(snapshot.category)) {
    throw new Error('当前后台类目与指定类目不一致，请核对后重新查询');
  }
  const category = cleanText(snapshot.category || payload.category, 200);
  const categoryId = cleanText(snapshot.categoryId || payload.categoryId, 100);
  const range = pageRange(snapshot);
  const withinRange = rows => !range.startDate || (rows[0]?.date >= range.startDate && rows.at(-1)?.date <= range.endDate);
  let matching = (observation.batches || []).filter(batch => {
    if (normalizeIdentity(batch.identity?.keyword) !== normalizeIdentity(keyword) || !withinRange(batch.rows || [])) return false;
    if (categoryId && batch.identity.categoryId && normalizeIdentity(batch.identity.categoryId) !== normalizeIdentity(categoryId)) return false;
    if (category && batch.identity.category && normalizeIdentity(batch.identity.category) !== normalizeIdentity(category)) return false;
    // Same word can produce completely different curves in different categories.
    // A keyword-only response (including an old one) cannot inherit the current
    // page's category label. Require at least one provable category correspondence.
    return !!((categoryId && batch.identity.categoryId && normalizeIdentity(batch.identity.categoryId) === normalizeIdentity(categoryId)) ||
      (category && batch.identity.category && normalizeIdentity(batch.identity.category) === normalizeIdentity(category)));
  }).sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')));
  // Only the latest coverage window is merged. A previous 30-day query must never masquerade as 13 months.
  const newest = matching.at(-1);
  if (newest) {
    const provenCategory = newest.identity.categoryId || newest.identity.category;
    matching = matching.filter(batch => batch.startDate === newest.startDate && batch.endDate === newest.endDate &&
      (!provenCategory ? batch === newest :
        normalizeIdentity(batch.identity.categoryId || batch.identity.category) === normalizeIdentity(provenCategory)));
  }
  const chartRows = (snapshot.options || []).map(option => parseChartOption(option, snapshot.activeMetric, range)).filter(rows => rows.length > 1 && withinRange(rows));
  const rows = mergeRows([...matching.map(batch => batch.rows), ...chartRows]);
  if (rows.length < 2) {
    const detail = observation.error ? `（${observation.error}）` : '';
    throw new Error('未取得关键词、类目和日期都能对应的趋势序列，本次未保存。请保持流量解析窗口打开，重新查询关键词、选择类目和“过去13个月”，等待图表完成后再采集；若接口未提供可核对的类目身份，请使用来源后台导出的数据文件导入。' + detail);
  }
  const startDate = rows[0].date, endDate = rows.at(-1).date;
  const spanDays = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1;
  const capturedMetrics = Object.keys(METRICS).filter(field => rows.some(row => row[field] !== null));
  const missingMetrics = Object.keys(METRICS).filter(field => !capturedMetrics.includes(field));
  const warnings = ['流量解析反映付费搜索流量，不等同于自然搜索、全市场需求或实际销量。',
    '只保存后台返回的实际数值；缺失值保留为空，不补造历史数据。',
    '比率和价格按来源数值保存，未验证为百分数或元的字段不得自行乘除换算。'];
  if (spanDays < 350) warnings.push(`当前实际覆盖 ${spanDays} 天，不足约 13 个月，请切换“过去13个月”重新采集；本批可保存，但不足以完整分析年度淡旺季。`);
  if (rows.length < spanDays * 0.85) warnings.push('日期序列存在较多缺口或可能采用非逐日粒度，导出后需核对，不能将缺口当作零。');
  if (range.startDate && (startDate !== range.startDate || endDate !== range.endDate)) warnings.push(`显示范围为 ${range.startDate} 至 ${range.endDate}，实际可读数据为 ${startDate} 至 ${endDate}，仅保存实际覆盖部分。`);
  if (missingMetrics.length) warnings.push('部分指标尚未取得，可在原页面逐个查看其他指标后重新采集；当前只保存已读取指标。');
  if (!category) warnings.push('未识别到类目名称；已保留来源类目 ID（如有）。请在保存后核对类目，避免同名词混淆。');
  return { startDate, endDate, rows, context: { keyword, category, categoryId, scope: 'current-keyword-visible-query',
    requestedRange: range, period: snapshot.selectedRange || '当前查询范围', spanDays, actualDates: rows.length,
    capturedMetrics, missingMetrics, metricUnits: 'source-native', method: chartRows.length ? 'page-chart-and-observed-data' : 'passive-response',
    responseObservedAt: matching.at(-1)?.receivedAt || '' }, warnings: unique(warnings) };
}

const buildTrendsReadScript = () => buildReadScript(readTrendsPage);
async function captureTrends(adapter, payload, observer) {
  await observer.prepare(adapter.webContents, 'traffic');
  adapter.checkpoint();
  const snapshot = await adapter.read(buildTrendsReadScript());
  return parseTrendsSnapshot(snapshot, payload, observer.read(adapter.webContents));
}
module.exports = { buildTrendsReadScript, parseTrendsSnapshot, captureTrends, pageRange };
