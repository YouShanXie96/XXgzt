'use strict';
// 更新服务：多源检查（全域中枢 / R2 取最高版本）、下载、暂存与挂起。
const path = require('node:path');
const { createUpdateClient } = require('./client');
const { DEFAULT_SOURCES, compareVersions, formatSize, isNewer, normalizeBaseUrl } = require('./manifest');
const {
  LAST_UPDATE_FILE,
  PREFS_FILE,
  UPDATE_ERROR_FILE,
  ensureDir,
  extractPackage,
  readJson,
  readPending,
  removeDir,
  updatesRoot,
  writeJsonAtomic,
  writePending,
} = require('./package');

const AUTO_DELAY_MS = 8 * 1000;

function resolveSources(baseUrl, dataDir) {
  const raw = [];
  if (process.env.XX_UPDATE_URL) raw.push(process.env.XX_UPDATE_URL);
  const override = readJson(path.join(dataDir, 'updates/source.json'));
  if (override) {
    if (Array.isArray(override.sources)) raw.push(...override.sources);
    if (typeof override.baseUrl === 'string' && override.baseUrl.trim()) raw.push(override.baseUrl);
  }
  if (baseUrl) raw.push(baseUrl);
  raw.push(...DEFAULT_SOURCES);
  const seen = new Set();
  const list = [];
  for (const item of raw) {
    try {
      const normalized = normalizeBaseUrl(item);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      list.push(normalized);
    } catch {}
  }
  return list;
}

function createUpdateService({
  appDir,
  dataDir,
  currentVersion,
  baseUrl = '',
  sources: injectedSources = null,
  fetchImpl = globalThis.fetch,
  onEvent = null,
  relaunch = null,
} = {}) {
  if (!appDir || !dataDir) throw new Error('更新服务缺少程序目录或数据目录');
  const sources = Array.isArray(injectedSources) && injectedSources.length
    ? injectedSources.map(item => normalizeBaseUrl(item))
    : resolveSources(baseUrl, dataDir);
  const clients = sources.map(base => ({ base, client: createUpdateClient({ baseUrl: base, fetchImpl }) }));
  const prefsFile = path.join(dataDir, PREFS_FILE);
  let latest = null;
  let checking = false;
  let downloading = false;
  let progress = 0;
  let lastCheckAt = 0;
  let lastError = '';
  let timer = null;

  function emit(payload) {
    try {
      if (typeof onEvent === 'function') onEvent(payload);
    } catch {}
  }

  function readPrefs() {
    const value = readJson(prefsFile);
    return {
      skipped: Array.isArray(value?.skipped) ? value.skipped.map(String).filter(Boolean) : [],
      promptedVersion: String(value?.promptedVersion || ''),
      lastCheckAt: Number(value?.lastCheckAt) || 0,
    };
  }

  function writePrefs(patch) {
    const next = { ...readPrefs(), ...patch };
    writeJsonAtomic(prefsFile, next);
    return next;
  }

  function status() {
    const prefs = readPrefs();
    const pending = readPending(dataDir);
    return {
      currentVersion,
      sourceCount: sources.length,
      updateBase: sources[0] || '',
      sources,
      available: Boolean(latest),
      latest: latest
        ? {
            version: latest.version,
            notes: latest.notes,
            mandatory: latest.mandatory,
            size: latest.packages.full.size,
            sizeText: formatSize(latest.packages.full.size),
            releasedAt: latest.releasedAt,
            source: latest.sourceBase || '',
          }
        : null,
      ready: pending ? { version: pending.version, notes: pending.notes, size: pending.size } : null,
      checking,
      downloading,
      progress,
      lastCheckAt: lastCheckAt || prefs.lastCheckAt || 0,
      skipped: prefs.skipped,
      error: lastError,
    };
  }

  // 一次请求拿到成功与失败两边的结果：失败原因直接复用，避免所有源都失败时再请求第二轮。
  async function readAll() {
    const settled = await Promise.allSettled(clients.map(async item => ({ base: item.base, ...(await item.client.readIndex()) })));
    return {
      values: settled.filter(item => item.status === 'fulfilled').map(item => item.value),
      reasons: settled.filter(item => item.status === 'rejected')
        .map(item => String(item.reason?.message || item.reason || '未知原因')),
    };
  }

  async function check({ manual = false } = {}) {
    if (checking) return status();
    checking = true;
    lastError = '';
    try {
      const { values: results, reasons } = await readAll();
      if (!results.length) {
        // 所有源都是“还没发布版本”时不算错误，按“当前已是最新”处理，避免吓到用户。
        if (reasons.length && reasons.every(text => text.includes('还没有发布任何版本'))) {
          latest = null;
          lastCheckAt = Date.now();
          writePrefs({ lastCheckAt });
          emit({ type: 'checked', status: status() });
          if (manual) emit({ type: 'latest', version: currentVersion });
          return status();
        }
        throw new Error(`无法获取更新信息：${reasons.join('；') || '未知原因'}`);
      }
      const newer = results.filter(item => isNewer(item.index.version, currentVersion));
      newer.sort((a, b) => compareVersions(b.index.version, a.index.version));
      const best = newer[0] || null;
      latest = best ? { ...best.index, sourceBase: best.base } : null;
      lastCheckAt = Date.now();
      const prefs = writePrefs({ lastCheckAt });
      emit({ type: 'checked', status: status() });
      if (latest) {
        // 每个版本只弹一次：弹过之后只在图标上留红点，避免每次启动都打扰。
        const shouldPrompt = prefs.promptedVersion !== latest.version && (manual || !prefs.skipped.includes(latest.version));
        if (shouldPrompt) {
          writePrefs({ promptedVersion: latest.version });
          emit({ type: 'available', ...status() });
        }
      } else if (manual) {
        emit({ type: 'latest', version: currentVersion });
      }
      return status();
    } catch (error) {
      lastError = String(error?.message || error);
      if (manual) emit({ type: 'error', message: lastError });
      return { ...status(), error: lastError };
    } finally {
      checking = false;
    }
  }

  async function download() {
    if (downloading) return { ok: false, error: '正在下载中' };
    if (!latest) return { ok: false, error: '没有可用的新版本' };
    downloading = true;
    progress = 0;
    lastError = '';
    emit({ type: 'progress', received: 0, total: latest.packages.full.size, percent: 0 });
    const order = [latest.sourceBase, ...sources].filter(Boolean);
    const tried = new Set();
    let lastFailure = null;
    try {
      for (const base of order) {
        if (tried.has(base)) continue;
        tried.add(base);
        try {
          const client = createUpdateClient({ baseUrl: base, fetchImpl });
          const record = latest.packages.full;
          const { bytes } = await client.download(record, {
            onProgress: ({ received, total }) => {
              const capped = Math.min(received, total || received);
              progress = total ? Math.min(100, Math.round((capped / total) * 100)) : 0;
              emit({ type: 'progress', received, total, percent: progress });
            },
          });
          const { manifest, stagingDir } = extractPackage({ zipBytes: bytes, dataDir, version: latest.version });
          writePending(dataDir, { version: manifest.version, stagingDir, notes: latest.notes, size: record.size });
          progress = 100;
          const result = { ok: true, version: manifest.version, notes: latest.notes, kind: 'full', size: record.size, source: base };
          emit({ type: 'ready', ...result });
          return result;
        } catch (error) {
          lastFailure = error;
        }
      }
      throw lastFailure || new Error('下载失败');
    } catch (error) {
      lastError = String(error?.message || error);
      progress = 0;
      emit({ type: 'error', message: lastError });
      return { ok: false, error: lastError };
    } finally {
      downloading = false;
    }
  }

  function skip(version) {
    const target = String(version || latest?.version || '').trim();
    if (!target) return { ok: false, error: '缺少版本号' };
    const prefs = readPrefs();
    writePrefs({ skipped: [...new Set([...prefs.skipped, target])] });
    latest = null;
    return { ok: true, skipped: target };
  }

  function consumeResult() {
    const applied = readJson(path.join(dataDir, LAST_UPDATE_FILE));
    const failed = readJson(path.join(dataDir, UPDATE_ERROR_FILE));
    const boot = globalThis.__xxUpdateBoot || null;
    for (const file of [LAST_UPDATE_FILE, UPDATE_ERROR_FILE]) {
      try {
        require('node:fs').unlinkSync(path.join(dataDir, file));
      } catch {}
    }
    return {
      applied: applied && applied.version ? { version: applied.version, fromVersion: applied.fromVersion || '', at: applied.at || '' } : null,
      failed: failed && failed.message ? { message: failed.message, stage: failed.stage || '' } : null,
      rolledBack: boot?.status === 'rolled-back',
    };
  }

  // 只在启动后检查一次：不再定时轮询，避免长期占用网络。
  function start() {
    if (timer) return;
    timer = setTimeout(() => {
      void check({ manual: false });
    }, AUTO_DELAY_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  async function handle(action, payload = {}) {
    switch (action) {
      case 'status':
        return status();
      case 'check':
        return check({ manual: true });
      case 'download':
        return download();
      case 'apply': {
        const pending = readPending(dataDir);
        if (!pending) return { ok: false, error: '还没有下载好的更新' };
        if (typeof relaunch !== 'function') return { ok: false, error: '当前环境不支持自动重启' };
        writeJsonAtomic(path.join(updatesRoot(dataDir), 'apply-requested.json'), { at: new Date().toISOString(), version: pending.version });
        setTimeout(() => {
          try {
            relaunch();
          } catch (error) {
            writeJsonAtomic(path.join(updatesRoot(dataDir), 'apply-error.json'), { at: new Date().toISOString(), message: String(error?.message || error) });
          }
        }, 150);
        return { ok: true, version: pending.version };
      }
      case 'skip':
        return skip(payload.version);
      case 'consume':
        return consumeResult();
      default:
        throw new Error(`未知的更新操作：${action}`);
    }
  }

  function cleanOldStaging() {
    try {
      const root = updatesRoot(dataDir);
      ensureDir(root);
      const keep = readPending(dataDir)?.stagingDir;
      for (const name of require('node:fs').readdirSync(root)) {
        if (!name.startsWith('staging-')) continue;
        const full = path.join(root, name);
        if (keep && path.resolve(keep) === path.resolve(full)) continue;
        if (Date.now() - require('node:fs').statSync(full).mtimeMs > 3 * 24 * 60 * 60 * 1000) removeDir(full);
      }
    } catch {}
  }

  cleanOldStaging();

  return Object.freeze({ handle, start, stop, status, check, download, consumeResult });
}

module.exports = { createUpdateService, AUTO_DELAY_MS };
