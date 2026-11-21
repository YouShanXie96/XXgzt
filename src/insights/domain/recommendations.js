'use strict';

const { createHash } = require('node:crypto');
const v = require('./validation');

const FIELDS = Object.freeze({
  datasetId: ['批次ID', '数据批次ID'], keyword: ['关键词'], category: ['类目'],
  dataStart: ['数据开始', '数据开始日期'], dataEnd: ['数据结束', '数据结束日期'],
  recommendedMonth: ['建议上品月份', '推荐上品月份'], risingMonth: ['预计起涨月份', '起涨月份'],
  peakMonths: ['旺季月份'], lowMonths: ['淡季月份'], productGroup: ['产品组'],
  reason: ['推荐理由', '分析理由'], analyzedAt: ['分析日期', '分析时间']
});

class RecommendationValidationError extends Error {
  constructor(issues) {
    super(`推荐结果整批未导入：${issues.slice(0, 8).map(item => `第${item.row}行 ${item.message}`).join('；')}${issues.length > 8 ? `；共${issues.length}处错误` : ''}`);
    this.name = 'RecommendationValidationError';
    this.issues = issues;
  }
}

function field(row, key) {
  const aliases = [key, ...FIELDS[key]];
  const values = aliases.filter(alias => Object.hasOwn(row, alias)).map(alias => row[alias]).filter(value => value != null && value !== '');
  if (values.length > 1 && values.some(value => String(value).trim() !== String(values[0]).trim())) throw new Error(`${FIELDS[key][0]}存在冲突列`);
  return values[0] ?? '';
}

function month(value, label, optional = false) {
  if (value == null || value === '') {
    if (optional) return null;
    throw new Error(`${label}不能为空`);
  }
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^(?:0?[1-9]|1[0-2])(?:月)?$/.test(raw)) throw new Error(`${label}只能填写1至12月`);
  return Number(raw.replace(/月$/, ''));
}

function months(value, label) {
  if (value == null || value === '') return [];
  const items = Array.isArray(value) ? value : String(value).trim().split(/[,，、;；\s]+/);
  if (items.length > 12) throw new Error(`${label}最多12个月，多个值用逗号分隔`);
  return [...new Set(items.map(item => month(item, label)))].sort((a, b) => a - b);
}

function recommendationKey(row) {
  return createHash('sha256').update(JSON.stringify([row.datasetId, row.keyword, row.category])).digest('hex');
}

function analyzeDate(value) {
  if (typeof value !== 'string') throw new Error('分析日期请填写 YYYY-MM-DD 文本');
  return value.includes('T') ? v.timestamp(value, '分析时间') : v.date(value.trim(), '分析日期');
}

/** All rows are validated before returning. Caller must never import a partial result. */
function parseRecommendations(inputRows, availableDatasets) {
  if (!Array.isArray(inputRows) || !inputRows.length || inputRows.length > 10000) throw new Error('推荐结果必须为1至10000行');
  const list = availableDatasets instanceof Map ? [...availableDatasets.values()] : availableDatasets;
  if (!Array.isArray(list)) throw new Error('缺少本机批次清单');
  const datasets = new Map();
  for (const dataset of list) {
    if (datasets.has(dataset.id)) throw new Error('本机批次ID重复，无法判断推荐来源');
    datasets.set(dataset.id, dataset);
  }
  const rows = [], issues = [], keys = new Set();
  inputRows.forEach((input, index) => {
    try {
      v.record(input, '推荐记录');
      const datasetId = v.identifier(field(input, 'datasetId'));
      const dataset = datasets.get(datasetId);
      if (!dataset || dataset.kind !== 'trends') throw new Error('批次不存在、属于其他店铺或不是趋势数据，请从当前店铺重新导出');
      const keyword = v.text(field(input, 'keyword'), '关键词', { required: true });
      const category = v.text(field(input, 'category'), '类目');
      if (keyword !== dataset.context?.keyword || category !== (dataset.context?.category || '')) throw new Error('关键词或类目与原始批次不一致');
      const dataStart = v.date(field(input, 'dataStart'), '数据开始日期');
      const dataEnd = v.date(field(input, 'dataEnd'), '数据结束日期');
      if (dataStart !== dataset.startDate || dataEnd !== dataset.endDate) throw new Error('数据日期范围与原始批次不一致');
      const row = {
        datasetId, keyword, category, dataStart, dataEnd,
        recommendedMonth: month(field(input, 'recommendedMonth'), '建议上品月份'),
        risingMonth: month(field(input, 'risingMonth'), '预计起涨月份', true),
        peakMonths: months(field(input, 'peakMonths'), '旺季月份'),
        lowMonths: months(field(input, 'lowMonths'), '淡季月份'),
        productGroup: v.text(field(input, 'productGroup'), '产品组', { max: 300 }),
        reason: v.text(field(input, 'reason'), '推荐理由', { required: true, max: 8000 }),
        analyzedAt: analyzeDate(field(input, 'analyzedAt'))
      };
      if (row.peakMonths.some(value => row.lowMonths.includes(value))) throw new Error('同一个月份不能同时列入旺季和淡季');
      if (row.risingMonth != null && row.recommendedMonth !== (row.risingMonth + 9) % 12 + 1) throw new Error('建议上品月份应为起涨月份提前两个月，请核对跨年月份');
      row.key = recommendationKey(row);
      if (keys.has(row.key)) throw new Error('同一批次、关键词和类目重复出现，请只保留一条推荐结果');
      keys.add(row.key);
      rows.push(row);
    } catch (error) { issues.push({ row: index + 2, message: error.message }); }
  });
  if (issues.length) throw new RecommendationValidationError(issues);
  return rows;
}

module.exports = { FIELDS, month, months, recommendationKey, parseRecommendations, RecommendationValidationError };
