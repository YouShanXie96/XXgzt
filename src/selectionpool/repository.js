'use strict';

/**
 * 上品库 · 本地仓库（替代老软件 SaaS + NAS 49220）
 *
 * 存储：完全走新软件自带 storage（ctx.readJson / ctx.writeJson，带队列化 + .previous 备份），
 * 数据落在 `用户数据/selectionpool/` 下，**不发出任何网络请求、不写 NAS、不连 SaaS**。
 *
 * 移植时保留的老软件硬约束（见分析报告 §4.4）：
 *   ① request_id 幂等 —— 同一采集包重复推送不产生第二条
 *   ② 删除整批原子 —— 一条校验失败则整批不删
 *   ③ 上架记录上限 5000 —— 满了会让「已入仓」退回「未上架」造成重复铺货，老软件已修
 *   ④ 媒体路径白名单 —— 防 SSRF / 目录穿越
 *   ⑤ 超限不裁剪原件，只在展示层提示
 */

const path = require('node:path');
const C = require('./contract');

const DIR = 'selectionpool';
const FILES = {
  items: `${DIR}/items.json`,
  shelf: `${DIR}/shelf-records.json`,
  logs: `${DIR}/autoshelf-log.json`,
  templates: `${DIR}/image-templates.json`,
  tasks: `${DIR}/upload-tasks.json`,
  queue: `${DIR}/queue-state.json`,
  apiConfig: `${DIR}/taobao-api.json`,
  manualFix: `${DIR}/manual-fix.json`,
};

/** 与老软件 shelf-records-store 一致的上限（老版本 200 会误判重复铺货）。 */
const SHELF_RECORD_LIMIT = 5000;
const AUTO_SHELF_LOG_LIMIT = 5000;

/** 媒体路径白名单：只允许本机绝对路径或 https 图片 URL，杜绝 SSRF / 目录穿越。 */
function safeMediaPath(value) {
  const raw = C.str(value).trim();
  if (!raw) return '';
  if (/^https:\/\//i.test(raw)) return raw.slice(0, 2000);
  if (!path.isAbsolute(raw)) return '';
  const normalized = path.normalize(raw);
  if (normalized.includes('..')) return '';
  return normalized.slice(0, 1000);
}

function createSelectionPoolRepository(ctx) {
  // 注意：ctx 是引用，ctx.readAccountState 在 main.js 中于 services 创建后才赋值，
  // 因此不要在构造时解构它（见 shop-session.js）。
  const read = (file, fallback) => ctx.readJson(file, fallback);
  const write = (file, value) => ctx.writeJson(file, value);

  async function readItems() {
    const data = await read(FILES.items, { schemaVersion: C.SCHEMA_VERSION, nextId: 1, items: [], requestIds: {} });
    return {
      schemaVersion: data?.schemaVersion || C.SCHEMA_VERSION,
      nextId: Number.isSafeInteger(data?.nextId) && data.nextId > 0 ? data.nextId : 1,
      items: C.list(data?.items),
      // request_id -> itemId，幂等索引（老软件 request_id 16–100 位 URL-safe 字符）
      requestIds: data?.requestIds && typeof data.requestIds === 'object' ? data.requestIds : {},
    };
  }
  const writeItems = db => write(FILES.items, db);

  /**
   * 接收一条采集包（兼容老插件 schema_version 2 的 snake_case）。
   * 返回 { itemId, action, version, rawSaved, replayed } —— 与老软件 parsePushReceipt 同形，
   * 其中 rawSaved 恒为 true 表示原件已完整落本地盘。
   */
  async function ingest(payload = {}) {
    const db = await readItems();
    const requestId = C.trimmed(payload.request_id || payload.requestId);
    if (requestId && /^[A-Za-z0-9_-]{16,100}$/.test(requestId) && db.requestIds[requestId]) {
      const existing = db.items.find(i => C.int(i.id) === C.int(db.requestIds[requestId]));
      if (existing) {
        return { itemId: C.int(existing.id), action: 'unchanged', version: C.int(existing.version) || 1, rawSaved: true, replayed: true };
      }
    }
    const productId = C.trimmed(payload.product_id || payload.productId);
    const platform = C.str(payload.platform) || 'taobao';
    if (!productId) throw new Error('缺少商品 ID，采集包不完整');

    const now = new Date().toISOString();
    const snapshot = payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : {};
    const base = {
      product_id: productId,
      platform,
      title: C.str(payload.title).slice(0, 500),
      image_url: C.str(payload.image_url || payload.imageUrl),
      product_url: C.str(payload.product_url || payload.productUrl),
      shop_name: C.str(payload.shop_name || payload.shopName),
      price_fen: C.numOrNull(payload.price_fen ?? payload.priceFen),
      price_label: C.str(payload.price_label || payload.priceLabel),
      collected_at: C.str(payload.collected_at || payload.collectedAt) || now,
      group_name: C.str(payload.group_name || payload.groupName),
      tags: C.splitTags(payload.tags),
      note: C.str(payload.note),
      owner_name: C.str(payload.owner_name || payload.ownerName),
      team_name: C.str(payload.team_name || payload.teamName),
      snapshot,
      snapshot_error: payload.snapshot_error === true,
      updated_at: now,
    };

    // 插件重复提交单个商品时始终生成一条新选品，不覆盖已有记录。
    const itemId = db.nextId++;
    const version = 1;
    const action = 'created';
    db.items.push({
      ...base, id: itemId, version,
      added_at: now,
      flow: C.FLOW_STATES.TODRAW,
      slots: [],
      listing: C.normalizeListing({
        priceFen: base.price_fen,
        categoryId: C.str(snapshot.category_id),
        categoryPath: C.str(snapshot.category_path),
      }),
      warehouse_item_id: '',
      shop_profile_id: '',
      shop_id: '',
    });
    if (requestId) db.requestIds[requestId] = itemId;
    // 幂等索引上限，避免无界增长（老软件服务端同样有清理）
    const keys = Object.keys(db.requestIds);
    if (keys.length > 20000) {
      for (const key of keys.slice(0, 5000)) delete db.requestIds[key];
    }
    await writeItems(db);
    return { itemId, action, version, rawSaved: true, replayed: false, collectedAt: now };
  }

  /** 列表：筛选 / 排序 / 分页，参数与老软件 selection-pool:list 一致。 */
  async function list(query = {}) {
    const db = await readItems();
    let rows = db.items.map(C.toRow);

    const keyword = C.trimmed(query.keyword).toLowerCase();
    if (keyword) {
      rows = rows.filter(r => [r.title, r.productId, r.shopName, r.note, r.groupName, ...r.tags]
        .some(v => C.str(v).toLowerCase().includes(keyword)));
    }
    if (query.group && query.group !== 'all') rows = rows.filter(r => r.groupName === C.str(query.group));
    if (query.platform && query.platform !== 'all') rows = rows.filter(r => r.platform === C.str(query.platform));
    if (query.team && query.team !== 'all') rows = rows.filter(r => r.teamName === C.str(query.team));
    if (query.owner && query.owner !== 'all') rows = rows.filter(r => r.ownerName === C.str(query.owner));
    if (query.status && query.status !== 'all') rows = rows.filter(r => r.flow === C.str(query.status));
    if (query.scope === 'mine' && query.ownerName) rows = rows.filter(r => !r.ownerName || r.ownerName === query.ownerName);
    if (query.start) rows = rows.filter(r => r.addedAt >= C.str(query.start));
    if (query.end) rows = rows.filter(r => r.addedAt.slice(0, 10) <= C.str(query.end).slice(0, 10));

    const recentDays = Number(query.recentDays);
    if (Number.isFinite(recentDays) && recentDays > 0) {
      const since = Date.now() - recentDays * 86400000;
      rows = rows.filter(r => Date.parse(r.addedAt) >= since);
    }

    const sort = C.SORT_VALUES.has(query.sort) ? query.sort : 'newest';
    rows.sort((a, b) => {
      if (sort === 'price_asc') return (a.priceFen ?? Infinity) - (b.priceFen ?? Infinity);
      if (sort === 'price_desc') return (b.priceFen ?? -Infinity) - (a.priceFen ?? -Infinity);
      if (sort === 'oldest') return C.str(a.addedAt).localeCompare(C.str(b.addedAt));
      return C.str(b.addedAt).localeCompare(C.str(a.addedAt));
    });

    const total = rows.length;
    const size = C.PAGE_SIZES.has(Number(query.size)) ? Number(query.size) : 50;
    const page = Math.max(1, C.int(query.page) || 1);
    const items = rows.slice((page - 1) * size, page * size);

    const all = db.items.map(C.toRow);
    const stats = {
      total: all.length,
      failed: all.filter(r => r.flow === C.FLOW_STATES.PUBLISH_FAILED).length,
      publishSuccess: all.filter(r => r.warehouseItemId).length,
      landed: all.filter(r => r.flow === C.FLOW_STATES.LANDED || r.flow === C.FLOW_STATES.TOFILL || r.flow === C.FLOW_STATES.DONE).length,
      filled: all.filter(r => r.flow === C.FLOW_STATES.DONE).length,
      todraw: all.filter(r => r.flow === C.FLOW_STATES.TODRAW || r.flow === C.FLOW_STATES.DRAWING).length,
    };
    const groups = [...new Set(all.map(r => r.groupName).filter(Boolean))].sort();
    const teams = [...new Set(all.map(r => r.teamName).filter(Boolean))].sort();
    const owners = [...new Set(all.map(r => r.ownerName).filter(Boolean))].sort();

    return { items, total, page, size, stats, groups, teams, owners, viewer: { canUpdate: true, canDelete: true, canSupervise: true, allTeams: true } };
  }

  async function detail(itemId) {
    const db = await readItems();
    const raw = db.items.find(i => C.int(i.id) === C.int(itemId));
    if (!raw) throw Object.assign(new Error('选品不存在或已被删除'), { code: 'NOT_FOUND' });
    return C.buildDetailView(raw);
  }

  /** 编辑：只放行白名单字段，version 乐观锁。 */
  async function update(itemId, patch = {}, expectedVersion) {
    const db = await readItems();
    const index = db.items.findIndex(i => C.int(i.id) === C.int(itemId));
    if (index < 0) throw Object.assign(new Error('选品不存在或已被删除'), { code: 'NOT_FOUND' });
    const old = db.items[index];
    const currentVersion = C.int(old.version) || 1;
    if (expectedVersion != null && C.int(expectedVersion) !== currentVersion) {
      throw Object.assign(new Error('这条选品已被其它操作修改，请刷新后重试'), { code: 'VERSION_CONFLICT' });
    }
    const allowed = {};
    if (typeof patch.title === 'string') allowed.title = C.str(patch.title).slice(0, 500);
    if (typeof patch.note === 'string') allowed.note = C.str(patch.note).slice(0, 4000);
    if (typeof patch.groupName === 'string') allowed.group_name = C.str(patch.groupName).slice(0, 120);
    if (patch.tags !== undefined) allowed.tags = C.splitTags(patch.tags);
    if (typeof patch.aiTitle === 'string') allowed.ai_title = C.str(patch.aiTitle).slice(0, 500);
    if (typeof patch.aiDescription === 'string') allowed.ai_description = C.str(patch.aiDescription).slice(0, 60000);
    if (patch.listing !== undefined) {
      const merged = { ...C.normalizeListing(old.listing), ...(patch.listing && typeof patch.listing === 'object' ? patch.listing : {}) };
      allowed.listing = C.normalizeListing(merged);
    }
    if (patch.flow !== undefined) allowed.flow = C.normalizeFlow(patch.flow);
    if (Array.isArray(patch.slots)) allowed.slots = patch.slots.map(C.normalizeSlot);
    if (typeof patch.warehouseItemId === 'string') allowed.warehouse_item_id = C.str(patch.warehouseItemId).slice(0, 64);
    if (typeof patch.shopProfileId === 'string') allowed.shop_profile_id = C.str(patch.shopProfileId).slice(0, 160);
    if (typeof patch.shopId === 'string') allowed.shop_id = C.str(patch.shopId).slice(0, 80);

    db.items[index] = { ...old, ...allowed, version: currentVersion + 1, updated_at: new Date().toISOString() };
    await writeItems(db);
    return { itemId: C.int(itemId), version: currentVersion + 1 };
  }

  /** 整批原子删除：一条不合法则整批拒绝（老软件设计）。 */
  async function remove(ids) {
    const raw = C.list(ids);
    const normalized = raw.map(C.int).filter(n => n > 0);
    if (!normalized.length) return { ok: false, code: 'INVALID_ITEM', message: '请先勾选要删除的选品', ids: [] };
    if (normalized.length !== raw.length || new Set(normalized).size !== normalized.length) {
      return { ok: false, code: 'INVALID_ITEM', message: '删除列表包含无效或重复的选品，整批已取消', ids: [] };
    }
    const db = await readItems();
    const existing = new Set(db.items.map(i => C.int(i.id)));
    const missing = normalized.filter(id => !existing.has(id));
    if (missing.length) return { ok: false, code: 'NOT_FOUND', message: `选品 ${missing.slice(0, 3).join('、')} 不存在，整批已取消`, ids: [] };
    const drop = new Set(normalized);
    db.items = db.items.filter(i => !drop.has(C.int(i.id)));
    for (const [key, value] of Object.entries(db.requestIds)) if (drop.has(C.int(value))) delete db.requestIds[key];
    await writeItems(db);
    return { ok: true, ids: normalized };
  }

  // ---- 上架记录（上限 5000，超过裁剪最旧，避免「已入仓」被误判为未上架） ----
  async function appendShelfRecord(record = {}) {
    const data = await read(FILES.shelf, { records: [] });
    const rows = C.list(data?.records);
    rows.push({ ...record, at: C.str(record.at) || new Date().toISOString() });
    const trimmedRows = rows.length > SHELF_RECORD_LIMIT ? rows.slice(-SHELF_RECORD_LIMIT) : rows;
    await write(FILES.shelf, { records: trimmedRows });
    return { ok: true, total: trimmedRows.length, limit: SHELF_RECORD_LIMIT };
  }
  const listShelfRecords = async () => C.list((await read(FILES.shelf, { records: [] }))?.records);

  // ---- 自动上架日志（按 runId 落盘，重启可恢复） ----
  async function appendAutoShelfLog(entry = {}) {
    const data = await read(FILES.logs, { lines: [] });
    const lines = C.list(data?.lines);
    lines.push({ ...entry, t: C.str(entry.t) || new Date().toISOString() });
    const trimmed = lines.length > AUTO_SHELF_LOG_LIMIT ? lines.slice(-AUTO_SHELF_LOG_LIMIT) : lines;
    await write(FILES.logs, { lines: trimmed });
    return { ok: true, total: trimmed.length };
  }
  const listAutoShelfLog = async () => C.list((await read(FILES.logs, { lines: [] }))?.lines);

  /**
   * 按「一次上架」分组：上架日志弹窗要先列每一次上架（时间 / 选品 / 结果），
   * 点「查看」再展开那一次的完整日志（用户 2026-11-12）。
   */
  async function listAutoShelfRuns(limit = 100) {
    const rows = await listAutoShelfLog();
    const map = new Map();
    for (const row of rows) {
      const runId = C.str(row?.runId) || 'manual';
      const at = C.str(row?.t);
      const item = map.get(runId) || { runId, startedAt: at, finishedAt: at, lines: [], ok: 0, fail: 0, items: [], shop: '' };
      item.lines.push({ at, line: C.str(row?.line), code: C.str(row?.context?.code) });
      if (!item.startedAt) item.startedAt = at;
      item.finishedAt = at;
      if (!item.shop && C.str(row?.context?.shopProfileId)) item.shop = C.str(row.context.shopProfileId);
      const code = C.str(row?.context?.code);
      if (code === 'OK') item.ok += 1;
      else if (code && /FAIL|ERROR|NOT_/.test(code)) item.fail += 1;
      const pid = C.int(row?.context?.poolItemId);
      if (pid && !item.items.includes(pid)) item.items.push(pid);
      map.set(runId, item);
    }
    return [...map.values()]
      .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))
      .slice(0, limit)
      .map(row => ({
        runId: row.runId, startedAt: row.startedAt, finishedAt: row.finishedAt,
        ok: row.ok, fail: row.fail, items: row.items.slice(0, 20), shop: row.shop,
        lineCount: row.lines.length,
        lines: row.lines.slice(-400),
      }));
  }

  // ---- 图片模板（详情页 / SKU） ----
  async function listTemplates(kind) {
    const data = await read(FILES.templates, { nextId: 1, templates: [] });
    let rows = C.list(data?.templates);
    if (kind === 'detail' || kind === 'sku') rows = rows.filter(t => t.kind === kind);
    return rows;
  }
  function sanitizeTemplateSkus(skus) {
    return C.list(skus).slice(0, 200).map(item => ({
      image: C.str(item?.image).slice(0, 800),
      name: C.str(item?.name).slice(0, 200),
      suffix: C.str(item?.suffix).slice(0, 80),
    }));
  }

  async function changeTemplate(change) {
    const data = await read(FILES.templates, { nextId: 1, templates: [] });
    const db = { nextId: C.int(data?.nextId) || 1, templates: C.list(data?.templates) };
    if (change.action === 'create') {
      const row = {
        id: db.nextId++,
        kind: change.kind === 'sku' ? 'sku' : 'detail',
        name: C.str(change.name).slice(0, 160),
        owner: C.str(change.owner).slice(0, 80),
        storeId: C.str(change.storeId).slice(0, 80),
        storeName: C.str(change.storeName).slice(0, 120),
        images: C.strList(change.images).slice(0, 200),
        skus: sanitizeTemplateSkus(change.skus),
        teamId: C.str(change.teamId),
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      db.templates.push(row);
      await write(FILES.templates, db);
      return { ok: true, template: row, templates: db.templates };
    }
    const index = db.templates.findIndex(t => C.int(t.id) === C.int(change.id));
    if (index < 0) return { ok: false, code: 'NOT_FOUND', message: '模板不存在' };
    if (C.int(change.version) !== C.int(db.templates[index].version)) return { ok: false, code: 'VERSION_CONFLICT', message: '模板已被其它操作修改，请刷新' };
    if (change.action === 'delete') {
      db.templates.splice(index, 1);
    } else {
      db.templates[index] = {
        ...db.templates[index],
        ...(change.name !== undefined ? { name: C.str(change.name).slice(0, 160) } : {}),
        ...(change.owner !== undefined ? { owner: C.str(change.owner).slice(0, 80) } : {}),
        ...(change.storeId !== undefined ? { storeId: C.str(change.storeId).slice(0, 80) } : {}),
        ...(change.storeName !== undefined ? { storeName: C.str(change.storeName).slice(0, 120) } : {}),
        ...(change.images !== undefined ? { images: C.strList(change.images).slice(0, 200) } : {}),
        ...(change.skus !== undefined ? { skus: sanitizeTemplateSkus(change.skus) } : {}),
        version: C.int(db.templates[index].version) + 1,
        updatedAt: new Date().toISOString(),
      };
    }
    await write(FILES.templates, db);
    return { ok: true, template: db.templates[index] || null, templates: db.templates };
  }

  // ---- 上传任务 / 队列运行态 ----
  const listUploadTasks = async () => C.list((await read(FILES.tasks, { tasks: [] }))?.tasks);
  async function createUploadTasks(input = {}) {
    const data = await read(FILES.tasks, { tasks: [] });
    const tasks = C.list(data?.tasks);
    const itemIds = C.list(input.itemIds).map(C.int).filter(n => n > 0);
    const shops = C.strList(input.shops).slice(0, 20);
    if (!itemIds.length) throw new Error('请先勾选要上架的选品');
    if (!shops.length) throw new Error('请先选择要上架到的店铺');
    const created = { id: `task-${Date.now()}`, itemIds, shops, status: 'pending', createdAt: new Date().toISOString() };
    tasks.push(created);
    await write(FILES.tasks, { tasks: tasks.slice(-500) });
    return { ok: true, task: created };
  }
  const getQueueState = async () => (await read(FILES.queue, { running: false, runId: '', updatedAt: '' }));
  const setQueueState = async state => {
    // 队列进度 / 计时 / 执行日志必须一起落盘：老软件 autoshelf-log-store 的队列运行态
    // 在重开弹窗后能恢复最近一次 run，只存 running/runId 会让「上架中 1/1」永远显示 0/0。
    const next = {
      running: state?.running === true,
      runId: C.str(state?.runId).slice(0, 64),
      done: Math.max(0, C.int(state?.done)),
      total: Math.max(0, C.int(state?.total)),
      ok: Math.max(0, C.int(state?.ok)),
      fail: Math.max(0, C.int(state?.fail)),
      startedAt: C.str(state?.startedAt).slice(0, 40),
      title: C.str(state?.title).slice(0, 200),
      stopRequested: state?.stopRequested === true,
      lines: C.list(state?.lines).map(line => C.str(line).slice(0, 1000)).slice(-120),
      // 队列里每一件商品的运行态（正在上架 / 排队中 / 已完成 / 失败）：
      // 用户要求「直接在上架进度里看到正在上架和排队上架的品」，所以必须一起落盘。
      items: C.list(state?.items).slice(0, 500).map(row => ({
        queueId: C.str(row?.queueId).slice(0, 80),
        itemId: C.int(row?.itemId),
        title: C.str(row?.title).slice(0, 120),
        shopId: C.str(row?.shopId).slice(0, 80),
        shopName: C.str(row?.shopName).slice(0, 60),
        status: ['queued', 'running', 'done', 'failed', 'stopped'].includes(C.str(row?.status)) ? C.str(row.status) : 'queued',
        code: C.str(row?.code).slice(0, 60),
        message: C.str(row?.message).slice(0, 300),
        startedAt: C.str(row?.startedAt).slice(0, 40),
        finishedAt: C.str(row?.finishedAt).slice(0, 40),
      })),
      updatedAt: new Date().toISOString(),
    };
    await write(FILES.queue, next);
    return next;
  };

  // ---- 淘宝 API 凭证（本地保存，绝不外传；后续用户填入即可） ----
  async function readApiConfig() {
    const data = await read(FILES.apiConfig, {});
    const cfg = data && typeof data === 'object' ? data : {};
    const mask = v => (v ? `${C.str(v).slice(0, 6)}…${C.str(v).slice(-4)}` : '');
    return {
      configured: Boolean(cfg.appKey && cfg.appSecret),
      appKey: C.str(cfg.appKey),
      appSecretMasked: mask(cfg.appSecret),
      sessionKeyMasked: mask(cfg.sessionKey),
      baseUrl: C.str(cfg.baseUrl) || 'https://eco.taobao.com/router/rest',
      shopId: C.str(cfg.shopId),
      // ---- AI作图 服务（三端打通）：按编码读取作图成品 ----
      drawingApiRoot: C.str(cfg.drawingApiRoot) || 'http://127.0.0.1:48180',
      drawingApiKeyMasked: mask(cfg.drawingApiKey),
      drawingConfigured: Boolean(cfg.drawingApiRoot && cfg.drawingApiKey),
      // 自动配对记录：换电脑后优先用这个路径找 AI作图；找不到再扫盘符
      drawingConfigPath: C.str(cfg.drawingConfigPath),
      drawingPairedAt: C.str(cfg.drawingPairedAt),
      updatedAt: C.str(cfg.updatedAt),
    };
  }
  async function saveApiConfig(input = {}) {
    const old = await read(FILES.apiConfig, {});
    const next = {
      appKey: C.trimmed(input.appKey) || C.str(old?.appKey),
      appSecret: C.trimmed(input.appSecret) || C.str(old?.appSecret),
      sessionKey: C.trimmed(input.sessionKey) || C.str(old?.sessionKey),
      baseUrl: C.trimmed(input.baseUrl) || C.str(old?.baseUrl) || 'https://eco.taobao.com/router/rest',
      shopId: C.trimmed(input.shopId) || C.str(old?.shopId),
      drawingApiRoot: C.trimmed(input.drawingApiRoot) || C.str(old?.drawingApiRoot) || 'http://127.0.0.1:48180',
      drawingApiKey: C.trimmed(input.drawingApiKey) || C.str(old?.drawingApiKey),
      drawingConfigPath: C.trimmed(input.drawingConfigPath) || C.str(old?.drawingConfigPath),
      drawingPairedAt: C.trimmed(input.drawingPairedAt) || C.str(old?.drawingPairedAt),
      updatedAt: new Date().toISOString(),
    };
    await write(FILES.apiConfig, next);
    return readApiConfig();
  }
  const readApiSecrets = async () => await read(FILES.apiConfig, {});

  /**
   * 人工补全参数回写：把用户在店铺页面（或工作台补全框）里填好的类目 / 属性
   * 合并进选品记录，供后续上架使用。同名属性覆盖，新属性追加。
   */
  async function applyManualParams(itemId, input = {}) {
    const db = await readItems();
    const index = db.items.findIndex(i => C.int(i.id) === C.int(itemId));
    if (index < 0) throw Object.assign(new Error('选品不存在或已被删除'), { code: 'NOT_FOUND' });
    const old = db.items[index];
    const snap = old.snapshot && typeof old.snapshot === 'object' ? old.snapshot : {};
    const merged = C.list(snap.attributes)
      .map(a => ({ name: C.str(a?.name), value: C.str(a?.value) }))
      .filter(a => a.name && a.value);
    for (const row of C.list(input.attributes)) {
      const name = C.str(row?.name).slice(0, 120);
      const value = C.str(row?.value).slice(0, 500);
      if (!name) continue;
      const found = merged.find(a => a.name === name);
      if (found) found.value = value;
      else merged.push({ name, value });
    }
    const listing = C.normalizeListing(old.listing);
    const categoryId = input.categoryId !== undefined ? C.str(input.categoryId).slice(0, 60) : C.str(snap.category_id || listing.categoryId);
    const categoryPath = input.categoryPath !== undefined ? C.str(input.categoryPath).slice(0, 300) : C.str(snap.category_path || listing.categoryPath);
    const attributes = merged.slice(0, 200);
    listing.categoryId = categoryId;
    listing.categoryPath = categoryPath;
    listing.attributes = attributes;
    const warehouseItemId = C.str(input.warehouseItemId).slice(0, 64);
    const version = (C.int(old.version) || 1) + 1;
    db.items[index] = {
      ...old,
      snapshot: { ...snap, attributes, category_path: categoryPath, category_id: categoryId },
      listing,
      ...(warehouseItemId ? { warehouse_item_id: warehouseItemId } : {}),
      version,
      updated_at: new Date().toISOString(),
    };
    await writeItems(db);
    return { itemId: C.int(itemId), version, attributeCount: attributes.length, categoryId, categoryPath, warehouseItemId };
  }

  // ---- 人工补全（老软件 form-capture 的 resumable 机制） ----
  // 上架失败且发布页还停在这件商品上时，记一条待人工处理的记录；
  // 用户在店铺页面把参数 / 类目补全，回到工作台点「我已填好，继续」才推进状态。
  async function listManualFix() {
    const data = await read(FILES.manualFix, { items: [] });
    return C.list(data?.items).filter(row => row && row.status === 'pending').slice(0, 200);
  }
  async function setManualFix(entry = {}) {
    const itemId = C.int(entry.itemId);
    if (!itemId) throw new Error('缺少选品编号');
    const data = await read(FILES.manualFix, { items: [] });
    const items = C.list(data?.items).filter(row => C.int(row?.itemId) !== itemId);
    const row = {
      itemId,
      storeId: C.str(entry.storeId).slice(0, 80),
      title: C.str(entry.title).slice(0, 200),
      reason: C.str(entry.reason).slice(0, 500),
      code: C.str(entry.code).slice(0, 80),
      url: C.str(entry.url).slice(0, 2000),
      token: C.str(entry.token).slice(0, 80),
      status: entry.status === 'done' || entry.status === 'failed' ? entry.status : 'pending',
      warehouseItemId: C.str(entry.warehouseItemId).slice(0, 80),
      createdAt: C.str(entry.createdAt) || new Date().toISOString(),
      resolvedAt: entry.status === 'pending' ? '' : new Date().toISOString(),
    };
    items.push(row);
    await write(FILES.manualFix, { items: items.slice(-200) });
    return row;
  }
  async function clearManualFix(itemId) {
    const id = C.int(itemId);
    const data = await read(FILES.manualFix, { items: [] });
    const items = C.list(data?.items).filter(row => C.int(row?.itemId) !== id);
    await write(FILES.manualFix, { items });
    return { ok: true };
  }

  return {
    FILES, safeMediaPath,
    readItems, ingest, list, detail, update, remove,
    appendShelfRecord, listShelfRecords,
    appendAutoShelfLog, listAutoShelfLog, listAutoShelfRuns,
    listTemplates, changeTemplate,
    listUploadTasks, createUploadTasks, getQueueState, setQueueState,
    listManualFix, setManualFix, clearManualFix, applyManualParams,
    readApiConfig, saveApiConfig, readApiSecrets,
  };
}

module.exports = { createSelectionPoolRepository, FILES, SHELF_RECORD_LIMIT, safeMediaPath };
