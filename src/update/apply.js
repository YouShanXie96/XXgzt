'use strict';
// 启动时应用挂起的更新：备份 → 覆盖 → 校验 → 失败回滚。只碰 resources/app，不碰用户数据。
const fs = require('node:fs');
const path = require('node:path');
const {
  APPLYING_FILE,
  LAST_UPDATE_FILE,
  MANIFEST_IN_PACKAGE,
  UPDATE_ERROR_FILE,
  clearPending,
  ensureDir,
  readJson,
  readPending,
  removeDir,
  updatesRoot,
  writeJsonAtomic,
} = require('./package');
const { compareVersions, sha256, validatePackageManifest } = require('./manifest');

function currentVersion(appDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
    return String(pkg.version || '');
  } catch {
    return '';
  }
}

function copyFile(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function depthOfStaging(dataDir, stagingDir) {
  // 只接受 updates 目录下的暂存路径，防止 pending.json 被篡改成任意目录。
  const root = path.resolve(updatesRoot(dataDir));
  const target = path.resolve(stagingDir);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('暂存目录不在 updates 下，已拒绝');
  return target;
}

function restoreBackup({ appDir, backupDir, plan }) {
  for (const filePath of plan.files || []) {
    const backup = path.join(backupDir, 'files', filePath);
    const target = path.join(appDir, filePath);
    if (fs.existsSync(backup)) copyFile(backup, target);
    else {
      try {
        fs.unlinkSync(target);
      } catch {}
    }
  }
  for (const filePath of plan.deleted || []) {
    const backup = path.join(backupDir, 'deleted', filePath);
    if (fs.existsSync(backup)) copyFile(backup, path.join(appDir, filePath));
  }
}

function pruneBackups(dataDir, keep = 2) {
  const root = updatesRoot(dataDir);
  let names = [];
  try {
    names = fs.readdirSync(root).filter(name => name.startsWith('backup-'));
  } catch {
    return;
  }
  const sorted = names
    .map(name => ({ name, at: fs.statSync(path.join(root, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const item of sorted.slice(keep)) removeDir(path.join(root, item.name));
}

function applyPending({ appDir, dataDir }) {
  const pendingPath = path.join(dataDir, 'updates/pending.json');
  const applyingPath = path.join(dataDir, APPLYING_FILE);
  const applying = readJson(applyingPath);
  if (applying && applying.backupDir) {
    // 上次应用到一半就退出了：先回滚，再用旧版本启动，避免半新半旧。
    try {
      restoreBackup({ appDir, backupDir: applying.backupDir, plan: applying });
      removeDir(path.join(applying.backupDir));
    } catch (error) {
      writeJsonAtomic(path.join(dataDir, UPDATE_ERROR_FILE), { at: new Date().toISOString(), stage: 'rollback', message: String(error?.message || error) });
    }
    try {
      fs.unlinkSync(applyingPath);
    } catch {}
    clearPending(dataDir);
    return { status: 'rolled-back', version: applying.version || '', fromVersion: applying.fromVersion || '' };
  }
  if (!fs.existsSync(pendingPath)) return { status: 'none' };
  const pending = readPending(dataDir);
  if (!pending) {
    clearPending(dataDir);
    return { status: 'none' };
  }
  let stagingDir = '';
  try {
    stagingDir = depthOfStaging(dataDir, pending.stagingDir);
  } catch (error) {
    clearPending(dataDir);
    writeJsonAtomic(path.join(dataDir, UPDATE_ERROR_FILE), { at: new Date().toISOString(), stage: 'prepare', message: String(error?.message || error) });
    return { status: 'failed', error: String(error?.message || error) };
  }
  const manifestRaw = readJson(path.join(stagingDir, MANIFEST_IN_PACKAGE));
  let manifest;
  try {
    manifest = validatePackageManifest(manifestRaw);
  } catch (error) {
    clearPending(dataDir);
    writeJsonAtomic(path.join(dataDir, UPDATE_ERROR_FILE), { at: new Date().toISOString(), stage: 'manifest', message: String(error?.message || error) });
    return { status: 'failed', error: String(error?.message || error) };
  }
  const fromVersion = currentVersion(appDir);
  if (manifest.version === fromVersion) {
    clearPending(dataDir);
    return { status: 'none', version: fromVersion };
  }
  if (fromVersion && compareVersions(manifest.version, fromVersion) < 0) {
    clearPending(dataDir);
    return { status: 'none', version: fromVersion };
  }
  const backupDir = path.join(updatesRoot(dataDir), `backup-${fromVersion || 'unknown'}-${Date.now()}`);
  const plan = {
    backupDir,
    version: manifest.version,
    fromVersion,
    files: manifest.files.map(record => record.path),
    deleted: manifest.deleted.slice(),
    startedAt: new Date().toISOString(),
  };
  try {
    // 1) 先写“正在应用”标记：任何一步中断，下次启动都会据此回滚。
    writeJsonAtomic(applyingPath, plan);
    // 2) 备份将被覆盖或删除的旧文件。
    for (const filePath of plan.files) {
      const source = path.join(appDir, filePath);
      if (!fs.existsSync(source)) continue;
      copyFile(source, path.join(backupDir, 'files', filePath));
    }
    for (const filePath of plan.deleted) {
      const source = path.join(appDir, filePath);
      if (!fs.existsSync(source)) continue;
      copyFile(source, path.join(backupDir, 'deleted', filePath));
    }
    // 3) 覆盖写入，并逐文件校验。
    for (const record of manifest.files) {
      const from = path.join(stagingDir, record.path);
      const to = path.join(appDir, record.path);
      ensureDir(path.dirname(to));
      fs.copyFileSync(from, to);
      const bytes = fs.readFileSync(to);
      if (bytes.length !== record.size || sha256(bytes) !== record.sha256) throw new Error(`写入后校验失败：${record.path}`);
    }
    // 4) 删除清单里的旧文件。
    for (const filePath of plan.deleted) {
      try {
        fs.unlinkSync(path.join(appDir, filePath));
      } catch {}
    }
    // 5) 收尾：记录结果，清掉标记与暂存。
    writeJsonAtomic(path.join(dataDir, LAST_UPDATE_FILE), {
      format: 'xx-update-result-v1',
      version: manifest.version,
      fromVersion,
      at: new Date().toISOString(),
    });
    try {
      fs.unlinkSync(applyingPath);
    } catch {}
    clearPending(dataDir);
    removeDir(stagingDir);
    pruneBackups(dataDir);
    return { status: 'applied', version: manifest.version, fromVersion };
  } catch (error) {
    try {
      restoreBackup({ appDir, backupDir, plan });
      removeDir(backupDir);
    } catch {}
    try {
      fs.unlinkSync(applyingPath);
    } catch {}
    clearPending(dataDir);
    writeJsonAtomic(path.join(dataDir, UPDATE_ERROR_FILE), {
      at: new Date().toISOString(),
      stage: 'apply',
      message: String(error?.message || error),
      version: manifest.version,
    });
    return { status: 'failed', version: manifest.version, error: String(error?.message || error) };
  }
}

module.exports = { applyPending, currentVersion };
