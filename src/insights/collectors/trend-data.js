'use strict';

const { cleanText, numeric, isoDate } = require('./common');

const METRICS = Object.freeze({
  impressionIndex: ['impressionIndex', 'impression_index', 'impression', 'pvIndex', 'pv', '展现指数'],
  clickIndex: ['clickIndex', 'click_index', 'click', 'clicks', '点击指数'],
  clickRate: ['clickRate', 'click_rate', 'ctr', '点击率'],
  conversionRate: ['conversionRate', 'conversion_rate', 'clickConversionRate', 'cvr', '点击转化率', '转化率'],
  competitionIndex: ['competitionIndex', 'competition_index', 'competition', 'competitiveness', '竞争指数'],
  marketPrice: ['marketPrice', 'market_price', 'avgPrice', 'avgCpc', 'cpc', '市场均价'],
});
const keyOf = value => String(value || '').toLowerCase().replace(/[\s_-]/g, '');
const ALIASES = new Map(Object.entries(METRICS).flatMap(([field, aliases]) => aliases.map(alias => [keyOf(alias), field])));
const DATE_KEYS = new Set(['date', 'dt', 'rptdate', 'statdate', 'bizdate', 'thedate', 'day', 'time', 'timestamp', 'x']);
const IDENTITY_KEYS = { keyword: new Set(['keyword', 'word', 'queryword', 'searchword']), category: new Set(['categoryname', 'catname', 'catename']), categoryId: new Set(['categoryid', 'catid', 'cateid']) };

function metricField(value) { return ALIASES.get(keyOf(value)) || ''; }
function rowTemplate(date) { return { date, ...Object.fromEntries(Object.keys(METRICS).map(key => [key, null])) }; }
function valueNumber(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return numeric(value.value ?? value.index ?? value.amount);
  return numeric(value);
}
function sourceDate(value) {
  const text = String(value ?? '');
  if (/^\d{8}$/.test(text)) return isoDate(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`);
  return isoDate(value);
}
function recordDate(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return '';
  for (const [key, value] of Object.entries(row)) if (DATE_KEYS.has(keyOf(key))) {
    const date = sourceDate(value);
    if (date) return date;
  }
  return '';
}

// Only these harmless display identifiers may leave a request/response parser.
function extractIdentity(value, fallback = {}) {
  const result = { keyword: cleanText(fallback.keyword, 120), category: cleanText(fallback.category, 200), categoryId: cleanText(fallback.categoryId, 100) };
  let visited = 0;
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 4 || ++visited > 120) return;
    for (const [key, val] of Object.entries(node)) {
      for (const [field, keys] of Object.entries(IDENTITY_KEYS)) {
        if (keys.has(keyOf(key)) && ['string', 'number'].includes(typeof val)) result[field] = cleanText(val, field === 'category' ? 200 : 120);
      }
    }
    for (const val of Object.values(node)) if (val && typeof val === 'object' && !Array.isArray(val)) walk(val, depth + 1);
  };
  walk(value, 0);
  return result;
}

function parseRequestIdentity(rawUrl, postData = '', fallback = {}) {
  let url;
  try { url = new URL(rawUrl); } catch { return extractIdentity({}, fallback); }
  const identityObjects = [Object.fromEntries(url.searchParams)];
  const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '';
  if (hashQuery) identityObjects.push(Object.fromEntries(new URLSearchParams(hashQuery)));
  if (typeof postData === 'string' && postData.length <= 100000) {
    try { identityObjects.push(JSON.parse(postData)); }
    catch { identityObjects.push(Object.fromEntries(new URLSearchParams(postData))); }
  }
  let result = extractIdentity({}, fallback);
  for (const object of identityObjects) {
    result = extractIdentity(object, result);
    for (const key of ['data', 'query', 'params', 'param', 'request']) {
      if (typeof object?.[key] !== 'string' || object[key].length > 100000) continue;
      try { result = extractIdentity(JSON.parse(object[key]), result); } catch { /* no JSON identity */ }
    }
  }
  return result;
}

function parseRecords(records, inheritedMetric = '') {
  const byDate = new Map();
  for (const record of records.slice(0, 2000)) {
    const date = recordDate(record);
    if (!date) continue;
    const row = byDate.get(date) || rowTemplate(date);
    if (inheritedMetric) row[inheritedMetric] = valueNumber(record.value ?? record.index ?? record.y);
    for (const [key, value] of Object.entries(record)) {
      const field = metricField(key);
      if (field) row[field] = valueNumber(value);
    }
    if (Object.keys(METRICS).some(field => row[field] !== null)) byDate.set(date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function parseTrendPayload(payload, fallbackIdentity = {}) {
  const candidates = [];
  const seen = new WeakSet();
  let visited = 0;
  const add = (rows, identity, path) => {
    if (rows.length < 2) return;
    candidates.push({ rows, identity, path: path.slice(0, 200), startDate: rows[0].date, endDate: rows.at(-1).date });
  };
  const walk = (node, identity, path, inheritedMetric, depth) => {
    if (!node || typeof node !== 'object' || depth > 9 || ++visited > 2500 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      add(parseRecords(node, inheritedMetric), identity, path);
      // A date/metric table is already handled. Avoid scanning every observation twice.
      if (node.length > 40 && recordDate(node[0])) return;
      node.slice(0, 80).forEach((child, index) => walk(child, identity, `${path}[${index}]`, inheritedMetric, depth + 1));
      return;
    }
    const localIdentity = extractIdentity(Object.fromEntries(Object.entries(node).filter(([, v]) => typeof v !== 'object')), identity);
    const localMetric = metricField(node.name || node.metric || node.key) || inheritedMetric;
    // Common vector layout: dates: [...], pv: [...], click: [...].
    const dates = node.dates || node.dateList || (Array.isArray(node.date) ? node.date : null) || node.xAxis?.data;
    if (Array.isArray(dates) && dates.length <= 2000) {
      const rows = dates.map(date => rowTemplate(sourceDate(date)));
      for (const [key, values] of Object.entries(node)) {
        const field = metricField(key);
        if (field && Array.isArray(values) && values.length === dates.length) values.forEach((value, index) => { rows[index][field] = valueNumber(value); });
      }
      add(rows.filter(row => row.date && Object.keys(METRICS).some(field => row[field] !== null)).sort((a, b) => a.date.localeCompare(b.date)), localIdentity, path);
    }
    for (const [key, child] of Object.entries(node)) {
      if (child && typeof child === 'object') walk(child, localIdentity, `${path}.${key}`, metricField(key) || localMetric, depth + 1);
    }
  };
  walk(payload, extractIdentity({}, fallbackIdentity), '$', '', 0);
  return candidates.slice(0, 40);
}

function dateLabels(labels, range) {
  let year = range?.startDate ? Number(range.startDate.slice(0, 4)) : 0;
  let previous = '';
  return labels.map(value => {
    let date = sourceDate(value);
    if (!date && year) {
      const match = String(value || '').match(/^(\d{1,2})[-/月.](\d{1,2})日?$/);
      if (match) {
        date = isoDate(`${year}-${match[1]}-${match[2]}`);
        if (previous && date && date < previous) date = isoDate(`${++year}-${match[1]}-${match[2]}`);
      }
    }
    if (date) { previous = date; year = Number(date.slice(0, 4)); }
    return date;
  });
}

function parseChartOption(option, activeMetric, range) {
  const series = Array.isArray(option.series) ? option.series : option.series ? [option.series] : [];
  const axes = Array.isArray(option.xAxis) ? option.xAxis : option.xAxis ? [option.xAxis] : [];
  const byDate = new Map();
  const add = (date, field, value) => {
    if (!date || !field || valueNumber(value) === null) return;
    const row = byDate.get(date) || rowTemplate(date);
    row[field] = valueNumber(value);
    byDate.set(date, row);
  };
  for (const s of series) {
    // Never mistake last year's or a comparison curve for the selected metric.
    if (/去年|上年|同比|对比|参考/.test(String(s.name || ''))) continue;
    const field = metricField(s.name) || (series.length === 1 ? metricField(activeMetric) : '');
    if (!field) continue;
    const labels = dateLabels(axes[s.xAxisIndex || 0]?.data || [], range);
    (s.data || []).slice(0, 2000).forEach((point, index) => {
      const value = point && !Array.isArray(point) && typeof point === 'object' ? point.value : point;
      if (Array.isArray(value)) add(sourceDate(value[0]) || labels[index], field, value[1]);
      else add(recordDate(point) || labels[index], field, value);
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mergeRows(collections) {
  const byDate = new Map();
  for (const rows of collections) for (const item of rows) {
    const row = byDate.get(item.date) || rowTemplate(item.date);
    for (const field of Object.keys(METRICS)) if (item[field] !== null && item[field] !== undefined) row[field] = item[field];
    byDate.set(item.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { METRICS, metricField, sourceDate, recordDate, rowTemplate, extractIdentity, parseRequestIdentity, parseRecords, parseTrendPayload, parseChartOption, mergeRows };
