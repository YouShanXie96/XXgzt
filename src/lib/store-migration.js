'use strict';

// 一次性迁移：把旧版按哈希存放的数据搬进“每个店铺一个文件夹”的新结构。
// 迁移采用“复制 → 校验 → 删除旧文件”，校验失败立即停止并保留旧数据。
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { within } = require('./storage');
const { legacyStoreDirectory } = require('../business/repository');

const ROOT = '店铺数据';
const reviewsDigest = storeId => createHash('sha256').update(JSON.stringify(String(storeId).trim())).digest('hex');
const normalizeRelative = value => String(value).split(path.sep).join('/');

async function pathExists(target) { try { await fs.lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function sha256(file) { return createHash('sha256').update(await fs.readFile(file)).digest('hex'); }

async function listFiles(root, relative = '') {
  const directory = relative ? path.join(root, relative) : root, result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(root, name));
    else if (entry.isFile()) result.push(name);
  }
  return result;
}

async function copyVerified(source, target) {
  const files = await listFiles(source);
  if (!files.length) throw new Error('旧目录没有可迁移的数据文件');
  for (const name of files) {
    const from = path.join(source, name), to = path.join(target, name);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    const [before, after] = await Promise.all([sha256(from), sha256(to)]);
    if (before !== after) throw new Error(`迁移校验失败，已保留原文件：${name}`);
  }
  return files.length;
}

/** 迁移一个店铺的旧数据；失败时抛出错误，旧数据保持原样。 */
async function migrateStoreData(dataDir, store, folder) {
  if (!store || typeof store.id !== 'string' || typeof folder !== 'string' || !folder) return { moved: false };
  const target = within(dataDir, `${ROOT}/${folder}`);
  const result = { moved: false, files: 0 };
  const legacyBusiness = within(dataDir, legacyStoreDirectory(store.id));
  if (await pathExists(legacyBusiness)) {
    const already = await pathExists(path.join(target, 'index.json'));
    if (!already) {
      result.files += await copyVerified(legacyBusiness, target);
      await fs.rm(legacyBusiness, { recursive: true, force: true });
      result.moved = true;
    }
  }
  const legacyReviews = within(dataDir, `reviews/${reviewsDigest(store.id)}.json`);
  if (await pathExists(legacyReviews)) {
    const targetReviews = path.join(target, 'reviews.json');
    if (!await pathExists(targetReviews)) {
      await fs.mkdir(target, { recursive: true });
      await fs.copyFile(legacyReviews, targetReviews);
      const [before, after] = await Promise.all([sha256(legacyReviews), sha256(targetReviews)]);
      if (before !== after) { await fs.rm(targetReviews, { force: true }); throw new Error('评价数据迁移校验失败，已保留原文件'); }
      await fs.unlink(legacyReviews);
      result.moved = true; result.files += 1;
    }
  }
  return result;
}

/** 写入/刷新店铺文件夹里的说明文件，方便用户辨认并清理对应店铺的数据。 */
async function writeStoreInfo(dataDir, store, folder, extra = {}) {
  const target = within(dataDir, `${ROOT}/${folder}`);
  await fs.mkdir(target, { recursive: true });
  const record = { storeId: store.id, storeName: store.name, folder, updatedAt: new Date().toISOString(), ...extra };
  const file = path.join(target, '店铺信息.json');
  await fs.writeFile(file, JSON.stringify(record, null, 2), 'utf8');
  return normalizeRelative(path.relative(dataDir, file));
}

/** 统计一个店铺文件夹占用的空间，用于设置页展示。 */
async function folderUsage(directory) {
  let bytes = 0, files = 0;
  async function walk(current) {
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) { const stat = await fs.stat(next); bytes += stat.size; files += 1; }
    }
  }
  await walk(directory);
  return { bytes, files };
}

/** 清理一个店铺的本机业务数据：删除文件夹后重建，只保留说明文件。 */
async function clearStoreData(dataDir, folder) {
  const target = within(dataDir, `${ROOT}/${folder}`);
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
  return target;
}

async function listStoreFolders(dataDir) {
  const root = within(dataDir, ROOT);
  try { return (await fs.readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => entry.name); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

module.exports = { ROOT, reviewsDigest, migrateStoreData, writeStoreInfo, folderUsage, clearStoreData, listStoreFolders };
