'use strict';

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`);
  return value;
}

function text(value, label, { required = false, max = 1000 } = {}) {
  if (value == null || value === '') {
    if (required) throw new Error(`${label}不能为空`);
    return '';
  }
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${label}必须是文本`);
  const result = value.trim();
  if (required && !result) throw new Error(`${label}不能为空`);
  if (result.length > max) throw new Error(`${label}超过${max}个字符`);
  return result;
}

function identifier(value, label = '批次ID') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)) throw new Error(`${label}无效`);
  return value;
}

function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}请使用 YYYY-MM-DD 文本日期`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '1900-01-01') throw new Error(`${label}不是有效日期`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error(`${label}必须包含日期、时间和时区`);
  date(value.slice(0, 10), label);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}不是有效时间`);
  return parsed.toISOString();
}

function numberOrNull(value, label, { nonnegative = false } = {}) {
  if (value == null || value === '' || value === '—' || value === '--' || value === '-') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonnegative && value < 0)) throw new Error(`${label}必须是${nonnegative ? '非负' : ''}数值或留空`);
  return value;
}

module.exports = { record, text, identifier, date, timestamp, numberOrNull };
