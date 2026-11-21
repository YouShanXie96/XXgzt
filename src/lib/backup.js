'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');
const { within, assertNoLinks, atomicWrite } = require('./storage');

const MODULES = new Set(['reviews', 'promotion', 'purchase', 'qualification', 'compliance', 'insights', 'business']);
// 每个店铺一个文件夹：店铺数据/<店铺文件夹>/*.json。仅允许 JSON，图片等其它文件不进入备份。
const STORE_DATA = '店铺数据';
const EXCLUDED = new Set(['browser', 'local-accounts', 'cache', 'imports', '恢复前备份', 'backups', '.restore-staging']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// 改名 XX 后，仍要能导入 v1.3.15 及更早用 xh- 前缀导出的备份包。
const MANIFEST_NAME = 'xx-backup.json';
const LEGACY_MANIFEST_NAME = 'xh-backup.json';
const MANIFEST_FORMATS = new Set(['xx-workbench-data', 'xh-workbench-data']);

function allowedBusinessPath(name) {
  if (typeof name !== 'string' || name.includes('\\')) return false;
  try { within(path.resolve('.'), name); } catch { return false; }
  const parts = name.split('/');
  if (parts.some(part => EXCLUDED.has(part.toLowerCase()) || part.endsWith('.tmp') || part.endsWith('.previous'))) return false;
  if (parts.length === 1) return name === 'stores.json' || name === 'settings.json';
  if (parts[0] === STORE_DATA) return parts.length >= 3 && parts.every(part => part && part !== '.' && part !== '..') && name.endsWith('.json');
  if (!MODULES.has(parts[0])) return false;
  return name.endsWith('.json') || parts[0] === 'qualification' && parts[1] === 'images' && /\.(png|jpg|jpeg|webp)$/i.test(name);
}

async function dataFiles(dataDir) {
  const result = [];
  async function walk(relative) {
    const directory = relative ? await assertNoLinks(dataDir, relative) : dataDir;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('业务数据目录包含链接或目录联接，请先移除该链接后备份。');
      if (EXCLUDED.has(entry.name.toLowerCase()) || entry.name.endsWith('.tmp') || entry.name.endsWith('.previous')) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (relative || MODULES.has(entry.name) || entry.name === STORE_DATA) await walk(name);
      } else if (entry.isFile() && allowedBusinessPath(name)) result.push(name);
    }
  }
  await walk('');
  return result.sort();
}

async function createBackup(dataDir, version, attempt = 0) {
  const entries = Object.create(null);
  const checksums = Object.create(null);
  for (const name of await dataFiles(dataDir)) {
    const bytes = await fs.readFile(await assertNoLinks(dataDir, name));
    entries[name] = new Uint8Array(bytes); checksums[name] = hash(bytes);
  }
  if (!entries['stores.json']) throw new Error('业务数据缺少店铺列表，无法生成完整备份。');
  const verifyNames=await dataFiles(dataDir);
  let changed=verifyNames.length!==Object.keys(checksums).length;
  for(const name of verifyNames){
    try{if(checksums[name]!==hash(await fs.readFile(await assertNoLinks(dataDir,name))))changed=true;}
    catch(error){if(error.code==='ENOENT')changed=true;else throw error;}
  }
  if(changed){if(attempt<2)return createBackup(dataDir,version,attempt+1);throw new Error('业务数据仍在变化，请等待同步或扫描结束后重新备份。');}
  entries[MANIFEST_NAME] = strToU8(JSON.stringify({ format: 'xx-workbench-data', formatVersion: 2, version,
    createdAt: new Date().toISOString(), containsSessions: false, files: checksums }));
  return zipSync(entries, { level: 6 });
}

function validateStores(stores) {
  if (!Array.isArray(stores) || stores.length > 10000) throw new Error('备份店铺信息无效');
  const ids = new Set();
  for (const store of stores) {
    if (!store || typeof store.name !== 'string' || !store.name.trim() || store.name.length > 60
      || typeof store.id !== 'string' || !/^[-a-zA-Z0-9]{1,80}$/.test(store.id) || ids.has(store.id)) throw new Error('备份店铺信息无效');
    ids.add(store.id);
  }
  return stores;
}

function decodeBackup(raw, limits = {}) {
  const maxFile = limits.maxFile ?? 100 * 1024 * 1024;
  const maxTotal = limits.maxTotal ?? 800 * 1024 * 1024;
  if (raw.length > (limits.maxArchive ?? 500 * 1024 * 1024)) throw new Error('备份文件过大');
  let total = 0;
  const names = new Set();
  const files = unzipSync(raw, { filter(file) {
    const name = file.name;
    if (name.endsWith('/')) throw new Error('备份包含不支持的目录记录');
    if (name !== MANIFEST_NAME && name !== LEGACY_MANIFEST_NAME && !allowedBusinessPath(name)) throw new Error(`备份包含不支持的路径：${name.slice(0, 120)}`);
    const normalized = name.toLowerCase();
    if (names.has(normalized)) throw new Error('备份包含重复文件路径');
    names.add(normalized);
    total += file.originalSize;
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 || file.originalSize > maxFile || total > maxTotal || names.size > 20000) throw new Error('备份解压数据超过安全限制');
    return true;
  } });
  const manifestName = files[MANIFEST_NAME] ? MANIFEST_NAME : (files[LEGACY_MANIFEST_NAME] ? LEGACY_MANIFEST_NAME : '');
  if (!manifestName || !files['stores.json']) throw new Error('备份缺少说明文件或店铺列表');
  const manifest = JSON.parse(strFromU8(files[manifestName]));
  if (!MANIFEST_FORMATS.has(manifest.format) || manifest.containsSessions !== false) throw new Error('不是有效的谢谢工作台业务数据备份');
  const entries = Object.entries(files).filter(([name]) => name !== MANIFEST_NAME && name !== LEGACY_MANIFEST_NAME);
  if (manifest.formatVersion === 2 && (!manifest.files || typeof manifest.files !== 'object'
    || Object.keys(manifest.files).length !== entries.length)) throw new Error('备份文件清单不完整');
  for (const [name, bytes] of entries) {
    if (manifest.formatVersion === 2 && manifest.files[name] !== hash(bytes)) throw new Error(`备份文件校验失败：${name}`);
    if (name.endsWith('.json')) JSON.parse(strFromU8(bytes));
  }
  return { entries, manifest, stores: validateStores(JSON.parse(strFromU8(files['stores.json']))) };
}

/** Caller must stop services and seal their storage before this replacement begins. */
async function restoreBackup(dataDir, decoded, options = {}) {
  const identifier = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const previousRelative = `恢复前备份/${identifier}`;
  const previous = within(dataDir, previousRelative);
  const originalNames = await dataFiles(dataDir);
  const old = new Map();
  // Read every old file before creating the backup directory; nested old backups cannot enter this set.
  for (const name of originalNames) old.set(name, await fs.readFile(await assertNoLinks(dataDir, name)));
  const oldHashes = {};
  for (const [name, bytes] of old) {
    await atomicWrite(dataDir, `${previousRelative}/${name}`, bytes);
    const copied = await fs.readFile(within(dataDir, `${previousRelative}/${name}`));
    if (hash(copied) !== hash(bytes)) throw new Error('恢复前备份校验失败，原业务数据尚未替换。');
    oldHashes[name] = hash(bytes);
  }
  await atomicWrite(dataDir, `${previousRelative}/备份清单.json`, JSON.stringify({ createdAt: new Date().toISOString(), files: oldHashes }, null, 2));
  const incomingNames = new Set(decoded.entries.map(([name]) => name));
  for (const name of incomingNames) {
    if (!allowedBusinessPath(name)) throw new Error('恢复文件路径无效');
    await assertNoLinks(dataDir, name);
  }
  try {
    for (const [name, bytes] of decoded.entries) {
      await (options.write || atomicWrite)(dataDir, name, bytes);
    }
    // Remove only old business files absent from the new snapshot, after their backup was verified.
    for (const name of originalNames) {
      if (!incomingNames.has(name)) await fs.unlink(await assertNoLinks(dataDir, name));
    }
    for (const [name, bytes] of decoded.entries) {
      if (hash(await fs.readFile(await assertNoLinks(dataDir, name))) !== hash(bytes)) throw new Error('恢复后文件校验失败');
    }
  } catch (error) {
    try {
      for (const [name, bytes] of old) await atomicWrite(dataDir, name, bytes);
      for (const name of incomingNames) if (!old.has(name)) await fs.unlink(await assertNoLinks(dataDir, name)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    } catch (rollbackError) {
      throw new Error(`恢复失败且自动回滚未完成，旧数据完整保留在 ${previous}。请关闭软件后从该目录恢复。`, { cause: rollbackError });
    }
    throw new Error(`恢复失败，已回滚原业务数据。恢复前备份：${previous}`, { cause: error });
  }
  return { previous, stores: decoded.stores, fileCount: decoded.entries.length };
}

module.exports = { allowedBusinessPath, dataFiles, createBackup, decodeBackup, restoreBackup, validateStores };
