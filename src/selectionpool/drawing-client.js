'use strict';

/**
 * 上品库 · AI作图 成品读取客户端
 *
 * 移植来源：老软件 `dist/main/drawing-task-client.js`（只读、按编号取图）。
 * 目标服务：`D:\软件\AI软件\AI作图` 的 `task-lookup.mjs` 三个端点（本次新增）。
 *
 * 契约（与老软件逐字对齐）：
 *   GET {apiRoot}/task-lookup/{code}                    -> { ok, task:{taskId,orderNo,status,results[],skuItems[]} }
 *   GET {apiRoot}/task-lookup?productId=xxx&limit=5     -> { ok, tasks[] }
 *   GET {apiRoot}/task-lookup/{code}/results/{resultId} -> 图片二进制
 * 鉴权：Authorization: Bearer <drawingApiKey>，与登录会话解耦，可无人值守。
 *
 * 安全：只接受 loopback 或显式配置的 http(s) 主机；编码做白名单；下载图片校验最小字节数；
 * 所有成品落新软件 `用户数据/selectionpool/drawing/<code>/`，不写 NAS、不连 SaaS。
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const C = require('./contract');

const DRAWING_DIR = 'selectionpool/drawing';

function isValidCode(code) {
  const v = C.str(code).trim();
  return Boolean(v) && v.length <= 200 && !/[\\/\u0000-\u001f]/.test(v) && v !== '.' && v !== '..';
}

function normalizeRoot(value) {
  const raw = C.str(value).trim().replace(/\/+$/, '');
  // 只允许本机回环；避免把 Key 发到公网。
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(raw)) return '';
  return raw;
}

function createDrawingClient(repo, ctx, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  // 生产默认 1KB（防损坏文件）；测试可注入更小值。
  const minBytes = Number.isFinite(options.minBytes) ? options.minBytes : 1024;

  async function config() {
    const secrets = await repo.readApiSecrets();
    const root = normalizeRoot(secrets?.drawingApiRoot);
    const key = C.trimmed(secrets?.drawingApiKey);
    return { root, key, configured: Boolean(root && key) };
  }

  async function request(route, { binary = false } = {}) {
    const { root, key, configured } = await config();
    if (!configured) {
      const e = new Error('还没有配置 AI作图 服务地址与接口 Key，请在「上品库 → 接口配置」填入');
      e.code = 'NOT_CONFIGURED'; throw e;
    }
    let response;
    try {
      response = await fetchImpl(root + route, {
        headers: { authorization: `Bearer ${key}` },
        redirect: 'error', credentials: 'omit',
        signal: AbortSignal.timeout(binary ? 60000 : 30000),
      });
    } catch (error) {
      const e = new Error('读取 AI作图 服务失败：' + C.str(error?.message || error).slice(0, 120));
      e.code = 'NETWORK'; throw e;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message = C.str(body?.error?.message || body?.error || body?.message);
      const code = C.str(body?.error?.code);
      let hint = message || `作图服务返回 HTTP ${response.status}`;
      if (response.status === 404 && /^\d{8}$/.test(C.str(route).split('/')[2] || '')) {
        hint = '这个 8 位编码在新作图系统里查不到：如果是旧作图系统的编码（旧系统已停用），请重新生成或换新编码';
      }
      const e = new Error(hint);
      e.code = response.status === 401 ? 'UNAUTHORIZED' : response.status === 404 ? 'TASK_NOT_FOUND' : code || 'HTTP_ERROR';
      throw e;
    }
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  }

  /** 按编码读取任务（含成品清单、比例、SKU 对应）。 */
  async function lookup(code) {
    const clean = C.str(code).trim();
    if (!isValidCode(clean)) {
      const e = new Error(`作图编号格式不对：${clean.slice(0, 60)}`); e.code = 'INVALID_CODE'; throw e;
    }
    const body = await request('/task-lookup/' + encodeURIComponent(clean));
    if (!body?.ok || !body?.task) {
      const e = new Error('作图服务返回的数据格式不对'); e.code = 'BAD_RESPONSE'; throw e;
    }
    return body.task;
  }

  /** 按商品 ID 找最近的作图任务（自动匹配，新的在前）。 */
  async function findByProduct(productId, limit = 5) {
    if (!/^\d+$/.test(C.str(productId))) return [];
    const body = await request(`/task-lookup?productId=${encodeURIComponent(productId)}&limit=${Math.min(Math.max(C.int(limit) || 5, 1), 20)}`);
    return C.list(body?.tasks);
  }

  /**
   * 把任务的成品图下载到本机，返回可直接在上品库里用的本地绝对/相对路径 + 元信息。
   * 与老软件一致：优先给放大后的 URL（服务端已在 results[].url 选好 variant）。
   */
  async function materialize(code, task) {
    const clean = C.str(code).trim();
    if (!isValidCode(clean)) throw new Error('作图编码不合法');
    const root = path.join(ctx.dataDir || '', DRAWING_DIR, clean.replace(/[^A-Za-z0-9_-]/g, '_'));
    await fs.mkdir(root, { recursive: true });
    const files = [];
    for (const [index, row] of C.list(task?.results).slice(0, 40).entries()) {
      const resultId = C.str(row?.resultId || row?.fileName);
      if (!resultId) continue;
      let bytes;
      try {
        bytes = await request(`/task-lookup/${encodeURIComponent(clean)}/results/${encodeURIComponent(resultId)}`, { binary: true });
      } catch {
        // 单张失败不阻断整组，与老软件「主图组内一张失败该组不替换」的谨慎哲学一致（这里标记失败）。
        files.push({ index: index + 1, resultId, ok: false, ratio: C.str(row?.ratio), error: '下载失败' });
        continue;
      }
      if (bytes.length < minBytes) {
        files.push({ index: index + 1, resultId, ok: false, ratio: C.str(row?.ratio), error: '图片太小或已损坏' });
        continue;
      }
      const ext = (C.str(row?.mimeType).includes('png') ? '.png' : C.str(row?.mimeType).includes('webp') ? '.webp' : '.jpg');
      const fileName = `${String(index + 1).padStart(2, '0')}-${resultId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}${ext}`;
      await fs.writeFile(path.join(root, fileName), bytes);
      files.push({
        index: index + 1, resultId, ok: true,
        ratio: C.str(row?.ratio) || 'other',
        width: C.int(row?.width), height: C.int(row?.height),
        bytes: bytes.length,
        path: [DRAWING_DIR, clean.replace(/[^A-Za-z0-9_-]/g, '_'), fileName].join('/'),
        absolutePath: path.join(root, fileName),
      });
    }
    return { code: clean, dir: root, files, orderNo: C.str(task?.orderNo), taskId: C.str(task?.taskId) };
  }

  /** 按编码一次完成：读取 + 落盘 + 按 1:1 / 3:4 / SKU 分组。 */
  async function fetchByCode(code) {
    const task = await lookup(code);
    const material = await materialize(code, task);
    const ok = material.files.filter(f => f.ok);
    return {
      task: {
        taskId: material.taskId, orderNo: material.orderNo,
        title: C.str(task?.title), productId: C.str(task?.productId),
        status: C.str(task?.status), createdAt: C.str(task?.createdAt),
      },
      square: ok.filter(f => f.ratio === '1:1').map(f => f.path).slice(0, 5),
      tall: ok.filter(f => f.ratio === '3:4').map(f => f.path).slice(0, 5),
      other: ok.filter(f => f.ratio === 'other').map(f => f.path),
      skuItems: C.list(task?.skuItems),
      files: material.files,
      readback: { planned: C.list(task?.results).length, saved: ok.length },
    };
  }

  async function readiness() {
    const { root, configured } = await config();
    return { configured, apiRoot: root, note: configured ? 'AI作图 服务已配置' : '未配置 AI作图 服务地址或接口 Key' };
  }

  return { lookup, findByProduct, materialize, fetchByCode, readiness, DRAWING_DIR, isValidCode, normalizeRoot };
}

module.exports = { createDrawingClient, isValidCode, normalizeRoot, DRAWING_DIR };
