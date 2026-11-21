'use strict';

/**
 * 上品库 · 上品记录 / 失败记录 / 自动上架队列 / 上架配置
 *
 * REA 证据（老软件 beta.268）：
 *   main/publication-outbox.js        —— 每次上品尝试单独计数，同一次 runId+选品+店铺只记一条；
 *                                       同一失败原因连续重试不重复记；「复制排查信息」带批次与客户端版本。
 *   shared/pool-publish-outcomes.js  —— 从日志行解析成功/失败、失败码归一、原因摘要、失败后重试成功保留原记录。
 *   shared/publication-fixes.js      —— 「已修复 · beta.xxx」：只有原因命中已修复清单且记录早于修复版本才标。
 *   main/autoshelf-log-store.js      —— 日志按 runId 逐行落盘，重开弹窗能恢复最近一次队列；队列运行态落盘。
 *   renderer 自动上架弹窗            —— 目标店铺多选、自动上架（放进仓库·不立即上架）、店铺分类、
 *                                       上架价格（同行价 × 倍数 减 金额）、进度 0/N·成功·失败、
 *                                       「没入仓、可以接着处理的任务」、停止队列 / 后台运行 / 追加上架。
 *
 * 新软件全部本地实现，不接任何外部运行时，数据只写本机用户数据目录。
 */

const crypto = require('node:crypto');
const C = require('./contract');

const PUBLICATION_FILE = 'selectionpool/publication-records.json';
const CONFIG_FILE = 'selectionpool/autoshelf-config.json';
const MAX_RECORDS = 5000;

/** 老软件 RESUME_NOT_A_FAILURE：这些结果不算「上品失败」。 */
const RESUME_NOT_A_FAILURE = /^(?:PAGE_MISMATCH|NOT_FOUND|NO_SHOP_SESSION|PUBLISH_BUSY|DRIVER_NOT_READY)$/;

/**
 * 已修复的失败原因（新软件自己的版本号，不含老软件标识）。
 * 只有「记录产生时的版本 < 修复版本」才标「已修复」，避免把没修好的问题标成已修复。
 */
const FIXED_FAILURES = Object.freeze([
  { pattern: /人工验证后的素材窗口已关闭/, fixedIn: 105 },
  { pattern: /缺少类目\s*path\/categoryId|缺少类目，请先在上品库内补全/, fixedIn: 105 },
  { pattern: /没有这个类目授权|商品类目未授权/, fixedIn: 105 },
  { pattern: /生产日期.*必填|生产日期.*未填/, fixedIn: 105 },
]);

const FAILURE_CODES = Object.freeze({
  CAPTCHA_REQUIRED: '需要人工验证，队列已停止；请在店铺窗口完成验证后点「我已改好，继续」',
  CATEGORY_NOT_AUTHORIZED: '店铺没有这个类目的发布权限，请换类目或换店铺',
  MISSING_CATEGORY: '缺少上架类目，请在「参数」页采集或选择叶子类目',
  NEEDS_MANUAL_VERIFICATION: '需要人工验证，队列已停止',
  DRIVER_NOT_READY: '上架驱动未接入（需店铺会话驱动或开放平台凭证）',
  PUBLISH_FAILED: '上架失败',
});

function versionNumber(value) {
  const m = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}

function fixedIn(record, appVersion) {
  const current = versionNumber(appVersion);
  const recorded = versionNumber(record?.clientVersion);
  if (!current || !recorded || recorded >= current) return '';
  const hit = FIXED_FAILURES.find(f => f.pattern.test(String(record?.message || '')));
  if (!hit || recorded >= hit.fixedIn * 100) return '';
  return `v${Math.floor(hit.fixedIn / 10000)}.${Math.floor((hit.fixedIn % 10000) / 100)}.${hit.fixedIn % 100}`;
}

function summarize(message = '', code = '') {
  const clean = String(message || '').replace(/^\s*(?:(?:失败|上架填充失败|上传失败|继续入仓失败|Error)\s*[:：]\s*)+/, '').trim();
  if (/滑动|验证码|访问过快|频繁|punish|captcha/i.test(clean)) return '需要人工验证，队列已停止';
  if (/没有这个类目授权|商品类目未授权/.test(clean)) return '没有这个类目授权';
  if (/缺少类目/.test(clean)) return '缺少上架类目';
  if (FAILURE_CODES[code]) return FAILURE_CODES[code];
  return clean.slice(0, 200) || '本次上品未完成';
}

function diagnostic(record = {}) {
  return [
    `商品：${record.title || '—'}`,
    `商品 ID：${record.productId || '—'} · 选品 #${record.itemId || '—'}`,
    `店铺：${record.shopName || '—'}${record.operatorName ? ` · 操作人 ${record.operatorName}` : ''}`,
    `时间：${record.at || '—'}`,
    `失败码：${record.code || 'PUBLISH_FAILED'}`,
    `原因：${record.message || '—'}`,
    `批次：${record.runId || '—'} · 客户端：${record.clientVersion || '—'}`,
  ].join('\n');
}

function createPublicationService({ repo, ctx, emit }) {
  const readJson = (file, fallback) => ctx.readJson(file, fallback);
  const writeJson = (file, value) => ctx.writeJson(file, value);
  const appVersion = C.str(ctx.appVersion) || '1.3.9';
  const now = () => new Date();

  const defaultConfig = () => ({
    version: 1,
    autoPublish: false,             // 老软件「自动上架」开关：勾上才填发布页；不勾只记录任务
    putInWarehouse: true,           // 放进仓库 · 不立即上架（auctionStatus = -5）
    priceFactor: '1',
    priceOffset: '1',
    priceDirection: 'subtract',
    shopCategoryIds: {},            // profileId -> number[]
    intervalMs: 3000,
    updatedAt: '',
  });

  async function config() {
    const saved = await readJson(CONFIG_FILE, {});
    return { ...defaultConfig(), ...(saved && typeof saved === 'object' ? saved : {}) };
  }

  async function saveConfig(input = {}) {
    const next = { ...(await config()) };
    for (const key of ['autoPublish', 'putInWarehouse', 'intervalMs']) {
      if (input[key] !== undefined) next[key] = key === 'intervalMs' ? Math.max(0, Math.min(60000, Number(input[key]) || 0)) : Boolean(input[key]);
    }
    for (const key of ['priceFactor', 'priceOffset']) if (input[key] !== undefined) next[key] = String(input[key]).slice(0, 12);
    if (input.priceDirection === 'add' || input.priceDirection === 'subtract') next.priceDirection = input.priceDirection;
    if (input.shopCategoryIds && typeof input.shopCategoryIds === 'object') next.shopCategoryIds = input.shopCategoryIds;
    if (input.profileId && Array.isArray(input.shopCategories)) {
      next.shopCategoryIds = { ...next.shopCategoryIds, [C.str(input.profileId)]: input.shopCategories.map(Number).filter(n => Number.isSafeInteger(n) && n > 0).slice(0, 20) };
    }
    next.updatedAt = now().toISOString();
    await writeJson(CONFIG_FILE, next);
    return next;
  }

  /** 老软件「同行价 × 倍数 减/加 金额」：这里按分为单位算，保留两位小数。 */
  function applyPrice(priceFen, cfg = null) {
    const base = Number(priceFen);
    if (!Number.isFinite(base) || base <= 0) return null;
    const factor = Number(cfg?.priceFactor ?? 1);
    const offsetYuan = Number(cfg?.priceOffset ?? 0);
    const f = Number.isFinite(factor) && factor > 0 ? Math.min(factor, 100) : 1;
    const o = Number.isFinite(offsetYuan) ? Math.min(Math.abs(offsetYuan), 100000) : 0;
    const delta = (cfg?.priceDirection === 'add' ? 1 : -1) * Math.round(o * 100);
    const next = Math.max(1, Math.round(base * f) + delta);
    return { before: base, after: next, factor: f, offset: o, direction: cfg?.priceDirection === 'add' ? 'add' : 'subtract' };
  }

  async function records() {
    const data = await readJson(PUBLICATION_FILE, { version: 1, records: [] });
    return Array.isArray(data?.records) ? data.records : [];
  }

  /**
   * 记一条上品尝试。同一 runId + 选品 + 店铺只记一次；
   * 同一选品 + 店铺连续出现相同失败原因时不重复记（老软件 last-failures.state）。
   */
  async function capture(input = {}) {
    const itemId = Number(input.itemId) || 0;
    if (!itemId) return { ok: false, message: '缺少选品编号' };
    const status = input.status === 'success' ? 'success' : 'failed';
    const code = C.str(input.code) || (status === 'success' ? 'OK' : 'PUBLISH_FAILED');
    if (status === 'failed' && RESUME_NOT_A_FAILURE.test(code) && input.resume === true) return { ok: false, message: '继续入仓的中断不算失败' };
    const all = await records();
    const key = `${C.str(input.runId)}|${itemId}|${C.str(input.shopId || input.shopName)}`;
    const id = crypto.createHash('sha256').update(key).digest('hex').slice(0, 24);
    if (all.some(r => r.id === id)) return { ok: false, message: '这一尝试已记录', id };
    if (status === 'failed') {
      const same = all.find(r => r.itemId === itemId && r.status === 'failed' && r.shopName === C.str(input.shopName) && r.reasonKey === C.str(input.reasonKey || input.message).slice(0, 300));
      if (same && now().getTime() - Date.parse(same.at || '') < 5 * 60 * 1000) return { ok: false, message: '相同失败原因不重复记', id: same.id };
    }
    const row = {
      id, runId: C.str(input.runId), itemId,
      productId: C.str(input.productId), title: C.str(input.title).slice(0, 300),
      shopName: C.str(input.shopName), shopId: C.str(input.shopId),
      operatorName: C.str(input.operatorName), status, code,
      message: C.str(input.message).slice(0, 2000),
      summary: summarize(input.message, code),
      reasonKey: C.str(input.reasonKey || input.message).slice(0, 300),
      warehouseItemId: C.str(input.warehouseItemId),
      at: now().toISOString(), clientVersion: appVersion,
    };
    row.fixedIn = fixedIn(row, appVersion);
    row.diagnostic = diagnostic(row);
    const next = [row, ...all].slice(0, MAX_RECORDS);
    await writeJson(PUBLICATION_FILE, { version: 1, records: next });
    return { ok: true, record: row };
  }

  /** 「上品记录」弹窗的数据：总览计数 + 失败记录搜索分页。 */
  async function report(input = {}) {
    const all = await records();
    const tab = input.tab === 'overview' ? 'overview' : 'failures';
    const keyword = C.str(input.keyword).toLowerCase();
    const page = Math.max(1, Number(input.page) || 1);
    const size = Math.max(1, Math.min(50, Number(input.size) || 10));
    let rows = tab === 'failures' ? all.filter(r => r.status === 'failed') : all;
    if (keyword) {
      rows = rows.filter(r => [r.productId, r.title, r.shopName, r.message, r.code, r.operatorName].some(v => String(v || '').toLowerCase().includes(keyword)));
    }
    rows = [...rows].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    const totals = {
      success: all.filter(r => r.status === 'success').length,
      failed: all.filter(r => r.status === 'failed').length,
      attempts: all.length,
    };
    return {
      ok: true, tab, keyword: input.keyword || '', page, size,
      total: rows.length, pages: Math.max(1, Math.ceil(rows.length / size)),
      rows: rows.slice((page - 1) * size, page * size),
      totals,
      // 按员工/组统计成功率（老软件「组长看组员 · 成功率」）：
      // 谁做的上架、成功几次、失败几次、成功率，失败原因 Top3。
      byOperator: (() => {
        const map = new Map();
        for (const row of all) {
          const name = C.str(row.operatorName) || '本机';
          const team = C.str(row.teamName) || '';
          const key = `${team}|${name}`;
          const item = map.get(key) || { operatorName: name, teamName: team, success: 0, failed: 0, attempts: 0, reasons: new Map() };
          item.attempts += 1;
          if (row.status === 'success') item.success += 1;
          else {
            item.failed += 1;
            const code = C.str(row.code) || 'PUBLISH_FAILED';
            item.reasons.set(code, (item.reasons.get(code) || 0) + 1);
          }
          map.set(key, item);
        }
        return [...map.values()]
          .map(row => ({
            ...row,
            rate: row.attempts ? Math.round((row.success / row.attempts) * 100) : 0,
            topReasons: [...row.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([code, count]) => ({ code, count })),
          }))
          .sort((a, b) => b.attempts - a.attempts)
          .slice(0, 50);
      })(),
    };
  }

  let queueLock = Promise.resolve();
  const withQueueLock = fn => {
    const next = queueLock.then(fn, fn);
    queueLock = next.catch(() => {});
    return next;
  };
  let queueSeq = 0;
  const nextQueueId = (itemId = 0) => `q-${Date.now().toString(36)}-${++queueSeq}-${C.int(itemId)}`;

  function normalizeQueueItem(row = {}, idx = 0) {
    const itemId = C.int(row?.itemId);
    return {
      queueId: C.str(row?.queueId) || C.str(row?.id) || `q-legacy-${idx}-${itemId}`,
      itemId,
      title: C.str(row?.title).slice(0, 120),
      shopId: C.str(row?.shopId).slice(0, 80),
      shopName: C.str(row?.shopName).slice(0, 60),
      status: ['queued', 'running', 'done', 'failed', 'stopped'].includes(C.str(row?.status)) ? C.str(row.status) : 'queued',
      code: C.str(row?.code).slice(0, 60),
      message: C.str(row?.message).slice(0, 300),
      startedAt: C.str(row?.startedAt),
      finishedAt: C.str(row?.finishedAt),
    };
  }

  function queueStatsFromItems(items = []) {
    const list = C.list(items);
    const total = list.length;
    const ok = list.filter(r => r.status === 'done').length;
    const fail = list.filter(r => r.status === 'failed').length;
    const done = list.filter(r => r.status === 'done' || r.status === 'failed' || r.status === 'stopped').length;
    return { total, done, ok, fail };
  }

  function formatQueueState(state = {}) {
    const items = C.list(state.items).slice(0, 500).map((row, idx) => normalizeQueueItem(row, idx));
    const computed = items.length ? queueStatsFromItems(items) : null;
    return {
      running: Boolean(state.running),
      runId: C.str(state.runId),
      done: computed ? computed.done : (Number(state.done) || 0),
      total: computed ? computed.total : (Number(state.total) || 0),
      ok: computed ? computed.ok : (Number(state.ok) || 0),
      fail: computed ? computed.fail : (Number(state.fail) || 0),
      startedAt: C.str(state.startedAt),
      title: C.str(state.title),
      stopRequested: Boolean(state.stopRequested),
      lines: C.list(state.lines).slice(-120),
      items,
    };
  }

  /** 队列状态：运行态 + 进度 + 计时（顶部「上架中 1/1 · 1分25秒」）。 */
  async function queue() {
    const saved = await repo.getQueueState();
    return formatQueueState(saved && typeof saved === 'object' ? saved : {});
  }

  async function writeQueueState(next) {
    const normalized = formatQueueState(next);
    normalized.updatedAt = now().toISOString();
    await repo.setQueueState(normalized);
    if (emit) emit({ module: 'selectionpool', stage: 'queue', ...normalized, transient: true, done: !normalized.running });
    return normalized;
  }

  async function queuePatch(patch = {}) {
    return withQueueLock(async () => {
      const state = await queue();
      const merged = { ...state, ...patch };
      if (Array.isArray(patch.items)) {
        merged.items = patch.items.map((row, idx) => normalizeQueueItem(row, idx));
      }
      return writeQueueState(merged);
    });
  }

  async function queueUpdateItem(queueId, patch = {}) {
    const targetId = C.str(queueId);
    if (!targetId) return queue();
    return withQueueLock(async () => {
      const state = await queue();
      const items = state.items.map(row => (row.queueId === targetId ? normalizeQueueItem({ ...row, ...patch }) : row));
      return writeQueueState({ ...state, items });
    });
  }

  async function queueAppend(entries = [], extraPatch = {}) {
    const list = C.list(entries);
    if (!list.length) return { ok: true, added: 0, addedItems: [], queue: await queue() };
    return withQueueLock(async () => {
      const state = await queue();
      const addedItems = list.map((row, idx) => normalizeQueueItem({
        ...row,
        queueId: C.str(row?.queueId) || nextQueueId(row?.itemId || idx),
        status: 'queued',
      }));
      const items = [...state.items, ...addedItems].slice(0, 500);
      const next = await writeQueueState({ ...state, ...extraPatch, items });
      return { ok: true, added: addedItems.length, addedItems, queue: next };
    });
  }

  async function queueRemove(input = {}) {
    const queueIdSet = new Set(C.strList(input.queueIds));
    const itemIdSet = new Set(C.list(input.itemIds).map(C.int).filter(n => n > 0));
    const statusFilter = input.onlyQueued !== false;
    return withQueueLock(async () => {
      const state = await queue();
      if (!queueIdSet.size && !itemIdSet.size) {
        return { ok: true, removedCount: 0, skippedRunning: 0, queue: state };
      }
      let removedCount = 0;
      let skippedRunning = 0;
      const kept = [];
      for (const row of state.items) {
        const matched = (queueIdSet.size && queueIdSet.has(row.queueId))
          || (!queueIdSet.size && itemIdSet.has(row.itemId));
        if (!matched) {
          kept.push(row);
          continue;
        }
        if (row.status === 'running' || (statusFilter && row.status !== 'queued' && row.status !== 'stopped')) {
          skippedRunning += row.status === 'running' ? 1 : 0;
          kept.push(row);
          continue;
        }
        removedCount += 1;
      }
      if (!removedCount) {
        return { ok: true, removedCount: 0, skippedRunning, queue: state };
      }
      const nextLines = [...state.lines, `已从排队序列移除 ${removedCount} 件商品`].slice(-120);
      const next = await writeQueueState({ ...state, items: kept, lines: nextLines });
      return { ok: true, removedCount, skippedRunning, queue: next };
    });
  }

  async function queueStop() {
    return queuePatch({ stopRequested: true, title: '正在停止后续队列…' });
  }

  function isStopped(queueState) {
    return Boolean(queueState?.stopRequested);
  }

  /**
   * 「没入仓、可以接着处理的任务」：老软件在自动上架弹窗和上架日志里都能打开，
   * 这里统一从 manualFix 读，附带店铺名与剩余提示。
   */
  async function resumeTasks() {
    const items = C.list(await repo.listManualFix()).filter(r => r && r.status === 'pending');
    return {
      ok: true,
      items,
      count: items.length,
      note: '发布页还保留着填好的内容。打开店铺窗口把出错的地方改好，再点「继续入仓」，程序会补完剩下的步骤并提交，不用自己点提交。',
      tail: '同一店铺再上架别的商品后，这里的任务就不能继续了（发布页会被新商品用掉），到时重新上架即可。',
    };
  }

  return {
    config, saveConfig, applyPrice, capture, report, records,
    queue, queuePatch, queueUpdateItem, queueAppend, queueRemove, queueStop, isStopped, nextQueueId, queueStatsFromItems, resumeTasks,
    diagnostic, summarize, fixedIn, RESUME_NOT_A_FAILURE, FAILURE_CODES, API_ENDPOINTS: Object.freeze([
      { method: 'taobao.item.seller.get', use: '入仓后回读商品，确认仓库商品编号', status: 'placeholder' },
      { method: 'taobao.items.inventory.get', use: '列出仓库中商品，避免重复入仓', status: 'placeholder' },
      { method: 'tmall.item.add.schema.get', use: '按类目生成发布表单字段', status: 'placeholder' },
      { method: 'tmall.item.schema.add', use: '按表单提交商品到仓库', status: 'placeholder' },
    ]),
  };
}

module.exports = { createPublicationService, summarize, diagnostic, FIXED_FAILURES, FAILURE_CODES };
