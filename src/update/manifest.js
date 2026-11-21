'use strict';
// 在线更新的公共约定：版本比较、索引校验、地址规范。客户端与推送脚本共用。
const crypto = require('node:crypto');

const SCHEMA_INDEX = 'xx-update-index-v1';
const SCHEMA_PACKAGE = 'xx-update-package-v1';
const PRODUCT = '谢谢工作台';
const DEFAULT_BASE_URL = 'https://xieys.de5.net/updates/workbench/';
// 客户端会同时查这几个源，取版本号最高的那个；任何一个下载失败自动换下一个。
const DEFAULT_SOURCES = [
  'https://xieys.de5.net/updates/workbench/',
  'https://gengxin.xieys.de5.net/',
];
const HEX64 = /^[a-f0-9]{64}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function parseVersion(value) {
  const text = String(value || '').trim();
  if (!VERSION.test(text)) return null;
  return text.split('.').map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`版本号格式不正确：${left} / ${right}`);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function isNewer(candidate, current) {
  try {
    return compareVersions(candidate, current) > 0;
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('缺少更新源地址');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('更新源地址格式不正确');
  }  if (url.protocol !== 'https:' && !LOOPBACK.test(raw)) {
    throw new Error('更新源必须使用 HTTPS（本机 127.0.0.1 自测除外）');
  }
  if (url.username || url.password) throw new Error('更新源地址不能包含账号密码');
  const text = url.toString();
  return text.endsWith('/') ? text : `${text}/`;
}

function resolveUrl(baseUrl, value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('更新包缺少下载地址');
  if (/^https?:\/\//i.test(raw)) return raw;
  return new URL(raw.replace(/^\/+/, ''), normalizeBaseUrl(baseUrl)).toString();
}

function validatePackageRecord(record, label) {
  if (!record || typeof record !== 'object') throw new Error(`${label}信息缺失`);
  const size = Number(record.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > 200 * 1024 * 1024) throw new Error(`${label}大小异常`);
  const hash = String(record.sha256 || '').trim().toLowerCase();
  if (!HEX64.test(hash)) throw new Error(`${label}校验值无效`);
  const from = record.from ? String(record.from).trim() : null;
  if (from && !parseVersion(from)) throw new Error(`${label}的起始版本无效`);
  return { url: String(record.url || '').trim(), size, sha256: hash, from };
}

function validateIndex(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('更新索引不是有效的 JSON 对象');
  if (payload.schema !== SCHEMA_INDEX) throw new Error('更新索引格式不受支持');
  if (payload.product !== PRODUCT) throw new Error('更新索引的产品名称不匹配');
  const version = String(payload.version || '').trim();
  if (!parseVersion(version)) throw new Error('更新索引版本号格式不正确');
  const packages = payload.packages && typeof payload.packages === 'object' ? payload.packages : {};
  if (!packages.full) throw new Error('更新索引缺少全量包');
  const full = validatePackageRecord(packages.full, '全量包');
  if (!full.url) throw new Error('全量包缺少下载地址');
  const delta = packages.delta ? validatePackageRecord(packages.delta, '增量包') : null;
  const notes = Array.isArray(payload.notes)
    ? payload.notes.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8).map(item => item.slice(0, 120))
    : [];
  return {
    version,
    releasedAt: String(payload.releasedAt || ''),
    channel: String(payload.channel || 'stable'),
    mandatory: payload.mandatory === true,
    minVersion: String(payload.minVersion || '0.0.0'),
    notes,
    packages: { full, delta },
  };
}

function validatePackageManifest(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('更新包清单不是有效的 JSON 对象');
  if (payload.schema !== SCHEMA_PACKAGE) throw new Error('更新包格式不受支持');
  if (payload.product !== PRODUCT) throw new Error('更新包的产品名称不匹配');
  const version = String(payload.version || '').trim();
  if (!parseVersion(version)) throw new Error('更新包版本号格式不正确');
  if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > 20000) throw new Error('更新包文件清单异常');
  const seen = new Set();
  const files = payload.files.map(record => {
    const filePath = String(record?.path || '').replace(/\\/g, '/');
    if (!filePath || filePath.startsWith('/') || filePath.split('/').includes('..')) throw new Error(`更新包路径不安全：${filePath}`);
    const key = filePath.toLowerCase();
    if (seen.has(key)) throw new Error(`更新包路径重复：${filePath}`);
    seen.add(key);
    const size = Number(record?.size);
    const hash = String(record?.sha256 || '').toLowerCase();
    if (!Number.isSafeInteger(size) || size < 0 || !HEX64.test(hash)) throw new Error(`更新包文件信息无效：${filePath}`);
    return { path: filePath, size, sha256: hash };
  });
  const deleted = Array.isArray(payload.deleted)
    ? payload.deleted.map(item => String(item || '').replace(/\\/g, '/')).filter(Boolean)
    : [];
  for (const item of deleted) {
    if (item.startsWith('/') || item.split('/').includes('..')) throw new Error(`更新包删除清单路径不安全：${item}`);
  }
  const baseVersion = payload.baseVersion ? String(payload.baseVersion).trim() : null;
  if (baseVersion && !parseVersion(baseVersion)) throw new Error('更新包起始版本无效');
  return { version, createdAt: String(payload.createdAt || ''), baseVersion, files, deleted };
}

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

module.exports = {
  SCHEMA_INDEX,
  SCHEMA_PACKAGE,
  PRODUCT,
  DEFAULT_BASE_URL,
  DEFAULT_SOURCES,
  HEX64,
  sha256,
  parseVersion,
  compareVersions,
  isNewer,
  normalizeBaseUrl,
  resolveUrl,
  validateIndex,
  validatePackageManifest,
  formatSize,
};
