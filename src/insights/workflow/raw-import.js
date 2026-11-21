'use strict';
const {randomUUID} = require('node:crypto');

const METRICS = [
  ['impressionIndex','展现指数'], ['clickIndex','点击指数'], ['clickRate','点击率'],
  ['conversionRate','点击转化率'], ['competitionIndex','竞争指数'], ['marketPrice','市场均价']
];
const cell = (row, key, label) => row[key] ?? row[label] ?? '';

function numberCell(value, label, line, percentage = false) {
  if (value == null || String(value).trim() === '' || /^(?:—|--|-)$/u.test(String(value).trim())) return null;
  const raw = String(value).trim();
  if(raw.endsWith('%')&&!percentage)throw new Error(`第 ${line} 行的${label}不能填写百分比。`);
  const ungrouped = raw.replace(/%$/, '');
  if(ungrouped.includes(',')&&!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(ungrouped))throw new Error(`第 ${line} 行的${label}千位分隔格式错误。`);
  const text = ungrouped.replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) throw new Error(`第 ${line} 行的${label}必须为非负数字或留空。`);
  return Number(text);
}

/** Import the documented daily-data sheet; no inferred dates, category or zeros. */
function parseRawTrendRows(rows, store, capturedAt = new Date().toISOString()) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('没有可导入的关键词日数据。');
  if (rows.length > 100000) throw new Error('一次最多导入 10 万行，请分批导入。');
  const groups = new Map();
  rows.forEach((row, index) => {
    const keyword = String(cell(row,'keyword','关键词')).trim();
    const category = String(cell(row,'category','类目')).trim();
    const date = String(cell(row,'date','日期')).trim();
    if (!keyword || !category || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`第 ${index + 2} 行需填写关键词、类目及 YYYY-MM-DD 格式日期。`);
    const key = JSON.stringify([keyword, category]);
    if (!groups.has(key)) groups.set(key, {keyword, category, rows: []});
    const record = {date};
    for (const [metric,label] of METRICS) record[metric] = numberCell(cell(row,metric,label),label,index + 2,['clickRate','conversionRate'].includes(metric));
    groups.get(key).rows.push(record);
  });
  if(groups.size>1000)throw new Error('一次最多导入 1000 个关键词和类目组合，请分批导入。');
  return [...groups.values()].map(group => {
    const dates = group.rows.map(row=>row.date).sort();
    return {
      id: randomUUID(), kind:'trends', source:'traffic', storeId:store.id, storeName:store.name,
      capturedAt, startDate:dates[0], endDate:dates.at(-1),
      context:{keyword:group.keyword, category:group.category, origin:'file', period:'导入日数据', scope:'用户导入的关键词日数据'},
      rows:group.rows, warnings:['本批次来自用户导入的文件，未与官方后台逐条核对。']
    };
  });
}

function rawTrendTemplate() {
  return [{name:'关键词日数据',rows:[],columns:[{key:'keyword',label:'关键词'},{key:'category',label:'类目'},{key:'date',label:'日期'},...METRICS.map(([key,label])=>({key,label}))]},
    {name:'填写说明',rows:[
      {项目:'来源',说明:'填写流量解析的付费搜索指标；不能将销量或自然搜索量填写为展现/点击指数。'},
      {项目:'必填',说明:'关键词、类目、日期（YYYY-MM-DD），以及至少一个有值的指标。每个关键词和类目按日填写。'},
      {项目:'缺失值',说明:'没有数据请留空，不要填写0。确实为0才填写0。百分比按页面数字填写，例如3.5%可写3.5。'},
      {项目:'分析范围',说明:'请保留完整历史日数据。月份推荐需要另外导入分析结果，不会自动调用AI。'}
    ]}];
}
module.exports = {parseRawTrendRows, rawTrendTemplate};
