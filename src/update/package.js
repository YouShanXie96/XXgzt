'use strict';
// 更新包的解压、校验与挂起记录。全部使用同步 IO，方便在启动引导（boot.js）里直接调用。
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync } = require('fflate');
const { sha256, validatePackageManifest, SCHEMA_PACKAGE, PRODUCT } = require('./manifest');

const UPDATES_DIR = 'updates';
const PENDING_FILE = 'updates/pending.json';
const APPLYING_FILE = 'updates/applying.json';
const LAST_UPDATE_FILE = 'updates/last-update.json';
const UPDATE_ERROR_FILE = 'updates/last-error.json';
const PREFS_FILE = 'updates/preferences.json';
const MANIFEST_IN_PACKAGE = 'update-manifest.json';
const MAX_FILES = 20000;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
// 这些目录属于运行数据或其它交付物，更新包永远不能写入。
const RESERVED = new Set(['用户数据', '.dev-data', 'browser', 'local-accounts', 'sessions', 'cookies', '.git', '.runtime', '版本备份', '源码备份', '源码', 'updates']);

function updatesRoot(dataDir) {
  return path.join(dataDir, UPDATES_DIR);
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function removeDir(directory) {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {}
}

function safeRelative(name) {
  const text = String(name || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!text || text.endsWith('/')) return '';
  if (text.startsWith('/') || /^[a-z]:/i.test(text)) throw new Error(`更新包包含绝对路径：${name}`);
  const parts = text.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`更新包路径不安全：${name}`);
  if (RESERVED.has(parts[0].toLowerCase()) || RESERVED.has(parts[0])) throw new Error(`更新包不能写入受保护目录：${name}`);
  if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === MANIFEST_IN_PACKAGE) throw new Error(`更新包路径异常：${name}`);
  return text;
}

function readZip(zipBytes) {
  if (!zipBytes || !zipBytes.length) throw new Error('更新包内容为空');
  let total = 0;
  let count = 0;
  const seen = new Set();
  const entries = unzipSync(new Uint8Array(zipBytes), {
    filter(file) {
      if (file.name.endsWith('/')) return false;
      const name = String(file.name).replace(/\\/g, '/');
      if (name === MANIFEST_IN_PACKAGE) return true;
      safeRelative(name);
      const key = name.toLowerCase();
      if (seen.has(key)) throw new Error(`更新包内文件重复：${name}`);
      seen.add(key);
      total += Number(file.originalSize) || 0;
      count += 1;
      if (count > MAX_FILES) throw new Error('更新包文件数量异常');
      if (total > MAX_TOTAL_BYTES) throw new Error('更新包解压后体积异常');
      return true;
    },
  });
  const manifestBytes = entries[MANIFEST_IN_PACKAGE];
  if (!manifestBytes) throw new Error('更新包缺少 update-manifest.json');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  } catch {
    throw new Error('更新包清单不是有效的 JSON');
  }
  if (parsed.schema !== SCHEMA_PACKAGE) throw new Error('更新包清单格式不受支持');
  const manifest = validatePackageManifest(parsed);
  const files = new Map();
  for (const [name, bytes] of Object.entries(entries)) {
    if (name === MANIFEST_IN_PACKAGE) continue;
    files.set(String(name).replace(/\\/g, '/'), Buffer.from(bytes));
  }
  return { manifest, files };
}

function extractPackage({ zipBytes, dataDir, version }) {
  const { manifest, files } = readZip(zipBytes);
  if (version && manifest.version !== String(version)) {
    throw new Error(`更新包版本不一致：索引 ${version} / 包内 ${manifest.version}`);
  }
  const missing = manifest.files.filter(record => !files.has(record.path));
  if (missing.length) throw new Error(`更新包缺少文件：${missing.slice(0, 3).map(item => item.path).join('、')}`);
  const extra = [...files.keys()].filter(name => !manifest.files.some(record => record.path === name));
  if (extra.length) throw new Error(`更新包包含清单外文件：${extra.slice(0, 3).join('、')}`);
  for (const record of manifest.files) {
    const bytes = files.get(record.path);
    if (bytes.length !== record.size || sha256(bytes) !== record.sha256) throw new Error(`更新包文件校验失败：${record.path}`);
  }
  const stagingDir = path.join(updatesRoot(dataDir), `staging-${manifest.version}`);
  removeDir(stagingDir);
  ensureDir(stagingDir);
  for (const record of manifest.files) {
    const target = path.join(stagingDir, record.path);
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, files.get(record.path));
  }
  fs.writeFileSync(path.join(stagingDir, MANIFEST_IN_PACKAGE), Buffer.from(JSON.stringify({ ...manifest, schema: SCHEMA_PACKAGE, product: PRODUCT }, null, 2)));
  return { manifest, stagingDir };
}

function verifyStaging(stagingDir, manifest) {
  for (const record of manifest.files) {
    const target = path.join(stagingDir, record.path);
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      throw new Error(`暂存文件缺失：${record.path}`);
    }
    if (!stat.isFile() || stat.size !== record.size) throw new Error(`暂存文件大小不符：${record.path}`);
    if (sha256(fs.readFileSync(target)) !== record.sha256) throw new Error(`暂存文件校验失败：${record.path}`);
  }
  return true;
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
  return value;
}

function writePending(dataDir, { version, stagingDir, notes, size }) {
  return writeJsonAtomic(path.join(dataDir, PENDING_FILE), {
    format: 'xx-update-pending-v1',
    version,
    stagingDir,
    notes: Array.isArray(notes) ? notes : [],
    size: Number(size) || 0,
    createdAt: new Date().toISOString(),
  });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readPending(dataDir) {
  const value = readJson(path.join(dataDir, PENDING_FILE));
  if (!value || value.format !== 'xx-update-pending-v1' || !value.stagingDir) return null;
  return value;
}

function clearPending(dataDir) {
  try {
    fs.unlinkSync(path.join(dataDir, PENDING_FILE));
  } catch {}
}

module.exports = {
  MANIFEST_IN_PACKAGE,
  PENDING_FILE,
  APPLYING_FILE,
  LAST_UPDATE_FILE,
  UPDATE_ERROR_FILE,
  PREFS_FILE,
  updatesRoot,
  ensureDir,
  removeDir,
  safeRelative,
  readZip,
  extractPackage,
  verifyStaging,
  writePending,
  readPending,
  clearPending,
  writeJsonAtomic,
  readJson,
};
