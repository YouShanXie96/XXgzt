'use strict';

/**
 * 上品库 ⇄ AI作图 接口自动配对（换电脑可复用）
 *
 * 背景：AI作图 的只读接口 `/task-lookup/*` 用独立 Key 鉴权（见 AI作图/task-lookup.mjs）。
 * 手工维护两处配置（AI作图 config.json + 上品库 接口配置）容易漏、换电脑就得再抄一遍。
 *
 * 这里做三件事：
 *   1. 发现 AI作图 目录：环境变量 → 上次记录的路径 → 常见盘符/目录组合（不写死 D 盘）。
 *   2. 读到 Key；没有就生成一串写回 AI作图 config.json（改前留一次 .bak-YYYYMMDD 备份）。
 *      AI作图 的 Key 是懒读取（5 秒缓存），写完**无需重启服务**即可生效。
 *   3. 把同一串 Key 写进上品库本地配置，并用 `/task-lookup/ping` 验证「服务在不在、Key 通不通」。
 *
 * 只允许本机回环地址，绝不把 Key 发到公网。
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('./contract');

const CONFIG_REL = [
  ['软件', 'AI软件', 'AI作图', 'AI作图', 'config.json'],
  ['AI软件', 'AI作图', 'AI作图', 'config.json'],
  ['软件', 'AI作图', 'AI作图', 'config.json'],
  ['AI作图', 'AI作图', 'config.json'],
  ['AI作图', 'config.json'],
];
const DRIVES = ['D', 'E', 'C', 'F'];

function normalizeRoot(value) {
  const raw = C.str(value).trim().replace(/\/+$/, '');
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(raw)) return '';
  return raw;
}

function generateKey() {
  // 32 字符 base64url：足够随机、可直接粘进 JSON。
  return crypto.randomBytes(24).toString('base64url');
}

function maskKey(key) {
  const v = C.str(key);
  return v ? `${v.slice(0, 4)}…${v.slice(-4)}` : '';
}

function createDrawingPair(repo, ctx = {}, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const now = options.now || (() => new Date());

  function candidateConfigPaths(savedPath) {
    const list = [];
    const push = value => {
      const file = C.str(value).trim();
      if (file && path.isAbsolute(file) && !list.includes(file)) list.push(file);
    };
    // 环境变量：既可给 config.json 本身，也可给 AI作图 根目录
    const envFile = C.str(process.env.XX_AI_ZUOTU_CONFIG).trim();
    if (envFile) push(/config\.json$/i.test(envFile) ? envFile : path.join(envFile, 'config.json'));
    const envRoot = C.str(process.env.XX_AI_ZUOTU_ROOT).trim();
    if (envRoot) push(path.join(envRoot, 'config.json'));
    push(savedPath);
    for (const drive of DRIVES) {
      for (const rel of CONFIG_REL) push(path.join(`${drive}:\\`, ...rel));
    }
    return list;
  }

  /** 只认真正的 AI作图 目录：config.json 可解析，且同目录有 server.mjs / task-lookup.mjs。 */
  async function looksLikeDrawingApp(configPath) {
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(raw);
      if (!config || typeof config !== 'object') return null;
      const dir = path.dirname(configPath);
      const server = await fs.stat(path.join(dir, 'server.mjs')).then(info => info.isFile(), () => false);
      const lookup = await fs.stat(path.join(dir, 'task-lookup.mjs')).then(info => info.isFile(), () => false);
      if (!server) return null;
      return { configPath, dir, config, hasLookup: lookup };
    } catch {
      return null;
    }
  }

  async function discover(savedPath) {
    for (const configPath of candidateConfigPaths(savedPath)) {
      const found = await looksLikeDrawingApp(configPath);
      if (found) {
        const key = C.trimmed(found.config?.taskLookup?.apiKey);
        return {
          found: true, configPath, dir: found.dir, config: found.config,
          port: Number(found.config?.port) || 48180,
          key, keyMasked: maskKey(key), hasLookup: found.hasLookup,
        };
      }
    }
    return { found: false, configPath: '', dir: '', port: 48180, key: '', keyMasked: '', hasLookup: false };
  }

  async function ping(root, key) {
    if (!root) return { reachable: false, authorized: false, version: '', message: '未配置地址' };
    try {
      const response = await fetchImpl(`${root}/task-lookup/ping`, {
        headers: key ? { authorization: `Bearer ${key}` } : {},
        credentials: 'omit', redirect: 'error',
        signal: AbortSignal.timeout(Number(options.pingTimeoutMs) || 4000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        return { reachable: false, authorized: false, version: '', message: `服务返回 HTTP ${response.status}` };
      }
      return {
        reachable: true,
        authorized: Boolean(body.authorized),
        version: C.str(body.version),
        keyConfigured: Boolean(body.keyConfigured),
        message: body.authorized ? '服务在线，Key 有效' : body.keyConfigured ? '服务在线，但 Key 不匹配' : '服务在线，但还没配置 Key',
      };
    } catch (error) {
      return { reachable: false, authorized: false, version: '', message: `连不上服务：${C.str(error?.message || error).slice(0, 80)}` };
    }
  }

  async function status() {
    const cfg = await repo.readApiConfig();
    const savedPath = C.str(cfg?.drawingConfigPath);
    const discovered = await discover(savedPath);
    const root = normalizeRoot(cfg?.drawingApiRoot);
    const key = C.trimmed((await repo.readApiSecrets())?.drawingApiKey);
    const probe = root && key ? await ping(root, key) : { reachable: false, authorized: false, version: '', message: '上品库还没保存作图接口' };
    return {
      configured: Boolean(root && key),
      root,
      keyMasked: maskKey(key),
      reachable: probe.reachable,
      authorized: probe.authorized,
      serviceVersion: probe.version || '',
      message: probe.message,
      configPath: savedPath || discovered.configPath,
      discovered: {
        found: discovered.found,
        dir: discovered.dir,
        configPath: discovered.configPath,
        port: discovered.port,
        hasKey: Boolean(discovered.key),
        keyMasked: discovered.keyMasked,
        hasLookup: discovered.hasLookup,
      },
      updatedAt: C.str(cfg?.drawingPairedAt || cfg?.updatedAt),
    };
  }

  async function pair(payload = {}) {
    const cfg = await repo.readApiConfig();
    const savedPath = C.str(cfg?.drawingConfigPath);
    let configPath = C.str(payload.configPath).trim();
    let discovered = null;
    if (configPath) {
      discovered = await looksLikeDrawingApp(configPath);
      if (!discovered) throw new Error('这个路径不是 AI作图 目录（需要 config.json + server.mjs）');
    } else {
      discovered = await discover(savedPath);
      if (!discovered.found) {
        throw new Error('没有找到 AI作图 目录。请点「选择 AI作图 目录」，或在 AI作图 的「接口配置」里手动填地址与 Key');
      }
      configPath = discovered.configPath;
    }

    const file = path.join(discovered.dir, 'config.json');
    // 重新读一次磁盘上的完整配置，避免只写入 taskLookup 而丢掉 port / omniHub 等字段。
    const current = await looksLikeDrawingApp(file);
    if (!current) throw new Error('读取 AI作图 config.json 失败，请检查文件权限');
    const config = { ...current.config };
    const explicitKey = C.trimmed(payload.apiKey);
    const existingKey = C.trimmed(config?.taskLookup?.apiKey);
    const key = explicitKey || existingKey || generateKey();
    let wroteConfig = false;

    if (key !== existingKey) {
      // 改前留一次当天备份，避免把用户其它配置改坏。
      const stamp = now().toISOString().slice(0, 10).replace(/-/g, '');
      const backup = `${file}.bak-${stamp}`;
      await fs.access(backup).then(() => undefined, () => fs.copyFile(file, backup).catch(() => undefined));
      config.taskLookup = { ...(config.taskLookup || {}), apiKey: key };
      await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      wroteConfig = true;
    }

    const port = Number(config?.port) || 48180;
    const root = normalizeRoot(payload.root) || `http://127.0.0.1:${port}`;
    await repo.saveApiConfig({
      drawingApiRoot: root,
      drawingApiKey: key,
      drawingConfigPath: file,
      drawingPairedAt: now().toISOString(),
    });

    // Key 懒读取，通常立即生效；仍在启动中的服务可能还没监听端口。
    const probe = await ping(root, key);
    return {
      ok: true,
      root,
      keyMasked: maskKey(key),
      generated: !explicitKey && !existingKey,
      wroteConfig,
      configPath: file,
      reachable: probe.reachable,
      authorized: probe.authorized,
      serviceVersion: probe.version || '',
      message: probe.reachable
        ? (probe.authorized ? '配对成功，作图接口已可用' : probe.message)
        : `已写入配置；${probe.message}。启动 AI作图 后会自动生效`,
    };
  }

  return { status, pair, discover, ping };
}

module.exports = { createDrawingPair, normalizeRoot, generateKey, maskKey, CONFIG_REL };
