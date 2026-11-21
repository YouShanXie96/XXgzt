'use strict';

const { randomUUID } = require('node:crypto');
const v = require('./validation');

const SOURCES = Object.freeze({ business: 'sycm', trends: 'traffic', peers: 'dmp' });
const TREND_METRICS = Object.freeze(['impressionIndex', 'clickIndex', 'clickRate', 'conversionRate', 'competitionIndex', 'marketPrice']);
const MAX_DATASET_ROWS = 100000;

function validateKind(kind) {
  if (!Object.hasOwn(SOURCES, kind)) throw new Error('不支持的数据类型');
  return kind;
}

function validateContext(input) {
  v.record(input || {}, '查询条件');
  const context = {};
  for (const key of ['keyword', 'category', 'categoryId', 'period', 'rankingType', 'subject', 'accountName', 'scope', 'origin', 'sourceUrl', 'metricUnits', 'method']) {
    context[key] = v.text(input?.[key], `查询条件 ${key}`);
  }
  for (const key of ['capturedMetrics', 'missingMetrics', 'filters', 'selected', 'scopeLabels']) {
    if (input?.[key] == null) continue;
    if (!Array.isArray(input[key]) || input[key].length > 200) throw new Error(`查询条件 ${key}必须是最多200项的文本列表`);
    context[key] = input[key].map(value => v.text(value, `查询条件 ${key}`, { max: 500 }));
  }
  for (const key of ['visibleRows', 'spanDays']) {
    if (input?.[key] == null) continue;
    if (!Number.isSafeInteger(input[key]) || input[key] < 0) throw new Error(`查询条件 ${key}无效`);
    context[key] = input[key];
  }
  if (input?.actualDates != null) {
    if (Array.isArray(input.actualDates)) {
      if (input.actualDates.length > 2000) throw new Error('实际日期列表过长');
      context.actualDates = input.actualDates.map(value => v.date(value, '实际日期'));
    } else if (Number.isSafeInteger(input.actualDates) && input.actualDates >= 0) context.actualDates = input.actualDates;
    else throw new Error('实际日期数量无效');
  }
  if (input?.requestedRange != null) {
    if (typeof input.requestedRange === 'string') context.requestedRange = v.text(input.requestedRange, '请求日期范围');
    else {
      v.record(input.requestedRange, '请求日期范围');
      context.requestedRange = {};
      for (const key of ['startDate', 'endDate']) if (input.requestedRange[key]) context.requestedRange[key] = v.date(input.requestedRange[key], `请求日期 ${key}`);
    }
  }
  if (input?.responseObservedAt) context.responseObservedAt = v.timestamp(input.responseObservedAt, '响应观察时间');
  if (input?.datesManuallyConfirmed != null) {
    if (typeof input.datesManuallyConfirmed !== 'boolean') throw new Error('手工确认日期标记必须为布尔值');
    context.datesManuallyConfirmed = input.datesManuallyConfirmed;
  }
  return context;
}

function trendRow(input, index, range) {
  v.record(input, `第${index + 1}条趋势记录`);
  const row = { date: v.date(input.date, `第${index + 1}条数据日期`) };
  if (row.date < range.startDate || row.date > range.endDate) throw new Error(`第${index + 1}条数据日期不在批次范围内`);
  for (const key of TREND_METRICS) row[key] = v.numberOrNull(input[key], `第${index + 1}条 ${key}`, { nonnegative: true });
  return row;
}

function businessRow(input, index) {
  v.record(input, `第${index + 1}条经营指标`);
  const row = {
    metric: v.text(input.metric, '指标代码', { required: true, max: 120 }),
    label: v.text(input.label, '指标名称', { required: true, max: 200 }),
    value: v.numberOrNull(input.value, `第${index + 1}条经营指标数值`),
    rawValue: v.text(input.rawValue, '原始指标文本', { max: 500 }),
    unit: v.text(input.unit, '指标单位', { max: 80 })
  };
  if (input.comparison != null) {
    if (typeof input.comparison === 'number') row.comparison = v.numberOrNull(input.comparison, '对比值');
    else row.comparison = v.text(input.comparison, '对比值', { max: 300 });
  }
  for (const key of ['period', 'section', 'sourceField']) row[key] = v.text(input[key], `经营指标 ${key}`, { max: 500 });
  for (const key of ['startDate', 'endDate']) row[key] = input[key] ? v.date(input[key], `经营指标 ${key}`) : '';
  if (row.startDate && row.endDate && row.startDate > row.endDate) throw new Error('经营指标开始日期不能晚于结束日期');
  return row;
}

function peerRow(input, index) {
  v.record(input, `第${index + 1}条榜单记录`);
  // Keep interval-valued data verbatim. Do not manufacture a midpoint or parse it as an exact count.
  const row = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)) throw new Error('榜单字段名无效');
    if (key === 'extra' && value != null) {
      v.record(value, '榜单附加原始字段');
      row.extra = {};
      if (Object.keys(value).length > 100) throw new Error('榜单附加字段过多');
      for (const [extraKey, extraValue] of Object.entries(value)) {
        v.text(extraKey, '榜单附加字段名', { required: true, max: 150 });
        if (['__proto__', 'constructor', 'prototype'].includes(extraKey)) throw new Error('榜单附加字段名无效');
        row.extra[extraKey] = extraValue == null ? null : typeof extraValue === 'number'
          ? v.numberOrNull(extraValue, '榜单附加字段') : v.text(extraValue, '榜单附加字段', { max: 2000 });
      }
    } else if (value == null) row[key] = null;
    else if (key === 'itemId') {
      if (typeof value !== 'string') throw new Error('榜单商品ID必须保留为文本，不能转换为数值');
      row[key] = v.text(value, '商品ID', { max: 150 });
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value) || (!Number.isSafeInteger(value) && key === 'rank')) throw new Error('榜单数值无效');
      row[key] = value;
    } else row[key] = v.text(value, `榜单字段 ${key}`, { max: 2000 });
  }
  if (!Object.keys(row).length) throw new Error('榜单记录不能为空');
  return row;
}

function validateDataset(input) {
  v.record(input, '采集批次');
  const kind = validateKind(input.kind);
  if (input.source !== SOURCES[kind]) throw new Error('数据类型与来源不匹配');
  const dataset = {
    schemaVersion: 1,
    id: v.identifier(input.id == null ? `ds_${randomUUID()}` : input.id),
    kind,
    source: input.source,
    storeId: v.identifier(input.storeId, '店铺ID'),
    storeName: v.text(input.storeName, '店铺名称', { required: true, max: 200 }),
    capturedAt: v.timestamp(input.capturedAt, '采集时间'),
    startDate: v.date(input.startDate, '数据开始日期'),
    endDate: v.date(input.endDate, '数据结束日期'),
    context: validateContext(input.context)
  };
  if (dataset.startDate > dataset.endDate) throw new Error('数据开始日期不能晚于结束日期');
  if (kind === 'trends' && !dataset.context.keyword) throw new Error('趋势批次必须记录关键词');
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > MAX_DATASET_ROWS) throw new Error(`采集记录必须为1至${MAX_DATASET_ROWS}条`);
  const mapper = kind === 'trends' ? trendRow : kind === 'business' ? businessRow : peerRow;
  dataset.rows = input.rows.map((row, index) => mapper(row, index, dataset));
  if (kind === 'trends') {
    if (new Set(dataset.rows.map(row => row.date)).size !== dataset.rows.length) throw new Error('趋势批次存在重复日期，请先按日期和指标合并');
    dataset.rows.sort((a, b) => a.date.localeCompare(b.date));
    if (!dataset.rows.some(row => TREND_METRICS.some(key => row[key] != null))) throw new Error('趋势批次没有可用指标，不能保存空采集结果');
  }
  if (input.warnings != null && (!Array.isArray(input.warnings) || input.warnings.length > 200)) throw new Error('批次提示信息无效');
  dataset.warnings = (input.warnings || []).map(item => v.text(item, '批次提示', { required: true, max: 2000 }));
  return dataset;
}

function summarizeDataset(dataset) {
  const { rows, ...summary } = dataset;
  return { ...structuredClone(summary), rowCount: rows.length };
}

module.exports = { SOURCES, TREND_METRICS, MAX_DATASET_ROWS, validateDataset, validateKind, summarizeDataset };
