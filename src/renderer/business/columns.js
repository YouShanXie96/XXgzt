'use strict';

// Display definitions only. Metric derivation and summary calculations belong
// to the business service, so absent values can never become invented zeros.
(() => {
  function groups(mode) {
    return window.XXBusinessReportSchema.groups(mode).map(group=>({label:group.label,columns:group.columns.map(column=>[column.key,column.label,column.type])}));
  }
  const numericTypes = new Set(['money','number','percent','decimal']);
  function display(value, type = 'text', options = {}) {
    // 精细化表格要求把空的数值指标显示为 0（待办等文本列不受影响）；
    // 原始明细与来源证明仍保留空白，避免把“未取得”当成真实 0 存储。
    if (value === null || value === undefined || value === '') return options.zero && numericTypes.has(type) ? '0' : '—';
    if (type === 'text' || type === 'title') return String(value);
    // Keep platform text (including ranges) intact, rather than coercing it.
    if (typeof value !== 'number') return String(value);
    if (!Number.isFinite(value)) return '—';
    const decimals = type === 'number' ? 0 : 2;
    return value.toLocaleString('zh-CN',{minimumFractionDigits:type === 'money'?2:0,maximumFractionDigits:decimals}) + (type === 'percent'?'%':'');
  }
  window.XXBusinessColumns = Object.freeze({groups,display});
})();
