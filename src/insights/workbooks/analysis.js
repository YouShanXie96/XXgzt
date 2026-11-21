'use strict';

const { validateDataset, TREND_METRICS } = require('../domain/datasets');
const { identifier } = require('../domain/validation');

const FORMAT_VERSION = 'xx-insights-v1';
const RECOMMENDATION_COLUMNS = Object.freeze([
  { key: 'datasetId', label: '批次ID' }, { key: 'keyword', label: '关键词' }, { key: 'category', label: '类目' },
  { key: 'dataStart', label: '数据开始' }, { key: 'dataEnd', label: '数据结束' },
  { key: 'recommendedMonth', label: '建议上品月份' }, { key: 'risingMonth', label: '预计起涨月份' },
  { key: 'peakMonths', label: '旺季月份' }, { key: 'lowMonths', label: '淡季月份' },
  { key: 'productGroup', label: '产品组' }, { key: 'reason', label: '推荐理由' }, { key: 'analyzedAt', label: '分析日期' }
]);

const TREND_COLUMNS = Object.freeze([
  { key: 'datasetId', label: '批次ID' }, { key: 'storeName', label: '店铺名称' },
  { key: 'keyword', label: '关键词' }, { key: 'category', label: '类目' }, { key: 'date', label: '日期' },
  { key: 'impressionIndex', label: '展现指数' }, { key: 'clickIndex', label: '点击指数' },
  { key: 'clickRate', label: '点击率' }, { key: 'conversionRate', label: '点击转化率' },
  { key: 'competitionIndex', label: '竞争指数' }, { key: 'marketPrice', label: '市场均价' }
]);

function checkedDatasets(datasets) {
  if (!Array.isArray(datasets) || !datasets.length) throw new Error('请先选择已保存的数据批次');
  const result = datasets.map(dataset => { identifier(dataset?.id); return validateDataset(dataset); });
  if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('导出批次重复');
  return result;
}

function templateRows(datasets) {
  return datasets.filter(dataset => dataset.kind === 'trends').map(dataset => ({
    datasetId: dataset.id, keyword: dataset.context.keyword, category: dataset.context.category,
    dataStart: dataset.startDate, dataEnd: dataset.endDate,
    recommendedMonth: '', risingMonth: '', peakMonths: '', lowMonths: '', productGroup: '', reason: '', analyzedAt: ''
  }));
}

function instructions() {
  return { name: '说明', columns: [{ key: 'item', label: '项目' }, { key: 'description', label: '说明' }], rows: [
    { item: '文件格式', description: FORMAT_VERSION },
    { item: '使用流程', description: '将数据分析包交给分析者；分析者填写推荐结果表并把它放在返回工作簿第一张表，再在 XX 工作台导入预览后确认。软件不调用 AI 模型。' },
    { item: '回填模板', description: '批次ID、关键词、类目、数据开始、数据结束必须保留原值。填写建议上品月份、推荐理由、分析日期；其他分析列可选。不要填写凭空推测的原始数据。' },
    { item: '月份规则', description: '月份填写1至12。若填写预计起涨月份，建议上品月份必须提前两个月，1月起涨对应11月上品。旺季/淡季多个值用逗号分隔。' },
    { item: '日期格式', description: '日期保留为 YYYY-MM-DD 文本；分析日期填实际分析日。不要把批次ID或商品ID转换为数字。' },
    { item: '缺失值', description: '空白表示页面未提供或未采集到，不等于0。原始区间保留原文，不用中位数代替。数据天数和实际范围见批次信息。' },
    { item: '趋势口径', description: '流量解析为付费搜索相关指数，不等同于自然搜索或全市场销量。点击率/转化率按采集原值保存，具体单位看批次提示，不能把不同时段比例直接相加。' },
    { item: '分析边界', description: '13个月通常仅覆盖一个年度周期。结合覆盖天数、缺失、本月是否完整、大促及节日日期判断，推荐是分析建议，不保证未来上涨。' },
    { item: '重复与版本', description: '同一批次ID+关键词+类目只保留一条当前推荐；再次导入会更新并保留旧版本。新采集批次拥有新ID，不会覆盖原始数据。' },
    { item: '导入校验', description: '任何一行批次不匹配、必填项缺失或月份日期不合法都会拒绝整个文件，不会部分导入。' }
  ] };
}

function batchesSheet(datasets) {
  const columns = [
    ['id', '批次ID'], ['kind', '数据类型'], ['source', '来源'], ['storeId', '店铺ID'], ['storeName', '店铺名称'],
    ['accountName', '网页店铺名称'], ['capturedAt', '采集时间'], ['startDate', '数据开始'], ['endDate', '数据结束'], ['keyword', '关键词'], ['category', '类目'],
    ['period', '周期'], ['rankingType', '榜单类型'], ['subject', '榜单对象'], ['rowCount', '记录数'], ['observedDays', '有记录天数'],
    ['expectedDays', '范围内天数'], ['queryContext', '完整查询条件'], ['warnings', '数据提示']
  ].map(([key, label]) => ({ key, label }));
  return { name: '批次信息', columns, rows: datasets.map(dataset => ({
    ...dataset, ...dataset.context, rowCount: dataset.rows.length,
    observedDays: dataset.kind === 'trends' ? dataset.rows.filter(row => TREND_METRICS.some(key => row[key] != null)).length : '',
    expectedDays: dataset.kind === 'trends' ? Math.round((Date.parse(dataset.endDate) - Date.parse(dataset.startDate)) / 86400000) + 1 : '',
    queryContext: JSON.stringify(dataset.context), warnings: dataset.warnings.join('；')
  })) };
}

function splitRows(name, rows, columns) {
  const size = 90000;
  if (rows.length <= size) return [{ name, rows, columns }];
  const sheets = [];
  for (let offset = 0; offset < rows.length; offset += size) sheets.push({ name: `${name}_${Math.floor(offset / size) + 1}`, rows: rows.slice(offset, offset + size), columns });
  return sheets;
}

function buildRecommendationTemplate(input) {
  const datasets = checkedDatasets(input);
  const rows = templateRows(datasets);
  if (!rows.length) throw new Error('请先选择至少一个趋势数据批次');
  return [{ name: '推荐结果', rows, columns: RECOMMENDATION_COLUMNS }, batchesSheet(datasets.filter(item => item.kind === 'trends')), instructions()];
}

function buildAnalysisWorkbook(input) {
  const datasets = checkedDatasets(input), sheets = [];
  const trends = datasets.filter(item => item.kind === 'trends');
  if (trends.length) {
    const rows = trends.flatMap(dataset => dataset.rows.map(row => ({ datasetId: dataset.id, storeName: dataset.storeName,
      keyword: dataset.context.keyword, category: dataset.context.category, ...row })));
    sheets.push(...splitRows('关键词日数据', rows, TREND_COLUMNS));
  }
  const business = datasets.filter(item => item.kind === 'business');
  if (business.length) {
    const columns = [['datasetId', '批次ID'], ['storeName', '店铺名称'], ['metric', '指标代码'], ['label', '指标名称'],
      ['value', '数值'], ['rawValue', '原始显示值'], ['unit', '单位'], ['period', '周期'], ['section', '页面区域'],
      ['startDate', '指标开始日期'], ['endDate', '指标结束日期'], ['comparison', '对比值'], ['sourceField', '来源字段']]
      .map(([key, label]) => ({ key, label }));
    sheets.push(...splitRows('经营指标', business.flatMap(dataset => dataset.rows.map(row => ({ datasetId: dataset.id, storeName: dataset.storeName, ...row }))), columns));
  }
  const peers = datasets.filter(item => item.kind === 'peers');
  if (peers.length) {
    const common = [['datasetId', '批次ID'], ['storeName', '采集店铺'], ['rank', '排名'], ['itemId', '商品ID'], ['title', '标题'],
      ['shopName', '同行店铺'], ['listedDays', '上架天数'], ['tradeCount', '成交件数'], ['views', '流量'], ['paidClicks', '付费点击'], ['viewsChange', '流量变化'], ['extra', '其他原始字段']];
    const seen = new Set(common.map(([key]) => key));
    for (const dataset of peers) for (const row of dataset.rows) for (const key of Object.keys(row)) if (!seen.has(key)) { common.push([key, key]); seen.add(key); }
    sheets.push(...splitRows('同行榜单', peers.flatMap(dataset => dataset.rows.map(row => ({ datasetId: dataset.id, storeName: dataset.storeName, ...row }))), common.map(([key, label]) => ({ key, label }))));
  }
  sheets.push(batchesSheet(datasets));
  if (trends.length) sheets.push({ name: '推荐回填模板', rows: templateRows(trends), columns: RECOMMENDATION_COLUMNS });
  sheets.push(instructions());
  return sheets;
}

module.exports = { FORMAT_VERSION, RECOMMENDATION_COLUMNS, TREND_COLUMNS, buildAnalysisWorkbook, buildRecommendationTemplate };
