'use strict';

/**
 * 上品库 · 独立功能区服务入口
 *
 * 挂接方式（新软件通用路由，见 main.js dispatch:502）：
 *   services.selectionpool = createSelectionPoolService(ctx)
 *   → 渲染层 window.xx.call('selectionpool.<method>', payload)
 *   → ipcMain.handle('xx:call') → dispatch() → services[module].handle(method, p)
 * 无需新增 IPC channel、无需改 preload。
 *
 * 本功能区与老软件的对应关系（功能等价，存储本地化）：
 *   老 SaaS `spgl.zgytp.com/api/selection-pool/v1/*`  →  repository（用户数据/selectionpool/*.json）
 *   老 NAS 49220（选品库原始档）                      →  repository.items[].snapshot
 *   老 main-store-session.js（shop-* 分区）            →  shop-session.js（复用新软件 persist:xx-*）
 *   老 selection-pool:xxx（29 个 IPC）                 →  selectionpool.xxx（下列 handle 分发）
 *   老 form-capture-publish*（自动上架填发布页）        →  autoShelf 状态机 + 可插拔 driver（待接入）
 *   老 drawing-*（回填）                              →  backfill 状态机 + 图位级回读（待接入驱动）
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const C = require('./contract');
const { createSelectionPoolRepository } = require('./repository');
const { createShopSession } = require('./shop-session');
const { createTaobaoApi, TAOBAO_API_CATALOG } = require('./taobao-api');
const { createEditorStore, draftFromDetail, cleanSkuRows, splitCodes } = require('./editor-store');
const { createDrawingClient } = require('./drawing-client');
const { createPluginManager } = require('./plugin-manager');
const { createDrawingPair } = require('./drawing-pair');
const { createCategoryService } = require('./category');
const { createPublicationService } = require('./publication');
const { createPictureSpace } = require('./picture-space');
const { createSuggestionEngine } = require('./required-suggest');
const { cleanSkuNames, matchToTemplate } = require('./sku-match');

function createSelectionPoolService(ctx, options = {}) {
  const repo = createSelectionPoolRepository(ctx);
  const shopSession = createShopSession(ctx);
  const taobaoApi = createTaobaoApi(repo, ctx, options);
  const editorStore = createEditorStore(ctx);
  const drawingClient = createDrawingClient(repo, ctx, options);
  const pluginManager = createPluginManager(ctx, options);
  const drawingPair = createDrawingPair(repo, ctx, options);
  const dialog = options.dialog || safeRequireDialog();
  // 独立发布页弹窗（用户 2026-11-10 要求：补全参数/滑块直接在单独弹窗里做，不再跳店铺浏览器页面）。
  // main.js 注入开窗回调（店铺 partition 复用登录会话），service 不直接持有 electron。
  const openWindow = typeof options.openWindow === 'function' ? options.openWindow : null;
  const emit = typeof ctx.emit === 'function' ? ctx.emit : () => {};
  const categoryService = createCategoryService({ repo, ctx, taobaoApi, editorStore });
  const publication = createPublicationService({ repo, ctx, emit });
  // 图片空间（taobao.picture.upload 那条链）：凭证没填时 configured:false，调用方回落，不发明成功。
  const pictureSpace = createPictureSpace({ taobaoApi, ctx, log: line => emit({ module: 'selectionpool', stage: 'log', message: line, done: true, transient: true }) });
  // 必填提议 + 记忆（老软件 form-capture-magix-ai / product-nutrient-memory 的确定性替代）
  const suggestions = createSuggestionEngine({ ctx });

  /** 自动上架 / 回填的真实平台写入驱动。默认未接入（见报告 §5、§7）。 */
  let driver = options.driver || null;
  let ingestServer = null;
  let disposed = false;

  function safeRequireDialog() {
    try { return require('electron').dialog; } catch { return null; }
  }

  /** 当前操作人 / 团队：上品记录的「按员工统计成功率」用它归类。 */
  function operatorName() {
    // 用户 2026-11-21：这里要显示对应账号名字，不能一律写「本机」。
    // 顺序：工作台登录账号显示名 → 传入的用户名 → Windows 登录账号 → 本机
    const fromLogin = (() => {
      try { return C.str(ctx.currentOperatorName?.()); } catch { return ''; }
    })();
    const fromCtx = C.str(ctx.userName || ctx.accountName || ctx.operatorName || '');
    const fromWindows = (() => {
      try { return C.str(ctx.currentAccount?.()); } catch { return ''; }
    })();
    return (fromLogin || fromCtx || fromWindows || '本机').slice(0, 60);
  }
  function teamName() {
    return C.str(ctx.teamName || ctx.team || '').slice(0, 60);
  }

  function progress(stage, message, extra = {}) {
    emit({ module: 'selectionpool', stage, message, ...extra });
  }

  /**
   * 一次性通知：不进入顶部常驻进度条。渲染层只做短暂提示并按需刷新列表，
   * 避免「加入上品库成功」后那一行提示一直挂着（用户明确要求删除）。
   */
  function notice(stage, message, extra = {}) {
    emit({ module: 'selectionpool', stage, message, done: true, transient: true, ...extra });
  }

  /** 批量任务结束：必须与 progress() 成对发送，否则顶部进度条不会消失。 */
  function progressEnd(stage, message, extra = {}) {
    emit({ module: 'selectionpool', stage, message, done: true, ...extra });
  }

  // ---------------------------------------------------------------- 本地采集接收端点
  /**
   * 让插件只改一个地址即可直连新软件：
   *   src/config.local.mjs  SERVER_URL = 'http://127.0.0.1:49220'
   * 端点：POST /api/selection-pool/v1/items
   * 回执：{ raw_saved:true, item_id, action, version, request_id, replayed }
   *       —— 与老 SaaS parsePushReceipt 完全同形，插件端无需改代码。
   * 默认不监听；需用户在「上品库 → 接口配置」里手动启用（不擅自开端口）。
   */
  /** 读取并解析本地请求体（限 8MB，已在调用处做 content-length 校验）。 */
  async function readBody(req) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) throw new Error('请求体过大');
    }
    return JSON.parse(raw || '{}');
  }

  /** 生成本机会话 token：sel_ + 43 位 URL-safe 字符（与老 SaaS 格式一致，不含真实凭据）。 */
  async function localSessionToken(username) {
    const crypto = require('node:crypto');
    const digest = crypto.createHash('sha256')
      .update(`${username}|${ctx.dataDir || 'xiexie-workbench'}|selection-pool-local`)
      .digest('base64url');
    return `sel_${digest.slice(0, 43)}`;
  }

  async function startIngestServer(port = 49220) {
    if (ingestServer) return { ok: true, port: ingestServer.address()?.port, already: true };
    const server = http.createServer(async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'OPTIONS') return send(204, {});
      const url = String(req.url || '').split('?')[0];
      // 只允许本机回环，杜绝局域网/公网写入（含登录与查询）。
      const remote = String(req.socket.remoteAddress || '');
      if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(remote)) return send(403, { ok: false, error: { code: 'FORBIDDEN', message: '只接受本机请求' } });

      // 老插件 workbench-client.mjs 的 login()：POST auth/password -> {token, identity, expires_at}
      // token 必须匹配 /^sel_[A-Za-z0-9_-]{43}$/，identity 必须有 user_id / team_id。
      if (req.method === 'POST' && url === '/api/selection-pool/v1/auth/password') {
        try {
          const body = await readBody(req);
          const username = C.str(body.username).trim();
          const password = C.str(body.password);
          if (!username || !password) return send(401, { ok: false, error: { code: 'INVALID_CREDENTIALS', message: '请输入账号和密码' } });
          // 本机端点：账号密码只做非空校验，真实身份由「已登录的谢谢工作台」承担，不存明文、不外传。
          const token = await localSessionToken(username);
          return send(200, {
            token,
            // user_id 固定为 'local'，确保 me 返回的 ownerKey 与登录时一致（否则插件会报 IDENTITY_CHANGED）。
            identity: { user_id: 'local', name: username, team_id: 'local', display_name: username },
            expires_at: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
            endpoint: 'local',
          });
        } catch (error) {
          return send(400, { ok: false, error: { code: 'BAD_REQUEST', message: C.str(error?.message || error).slice(0, 200) } });
        }
      }
      // checkedAccount() 会带 token 调 me 校验归属；必须返回与登录时同形的 identity。
      if (req.method === 'GET' && url === '/api/selection-pool/v1/me') {
        return send(200, { identity: { user_id: 'local', name: '本机账号', team_id: 'local' }, expires_at: '', endpoint: 'local' });
      }
      // 老插件 connect() 的 OAuth PKCE 路径本机不用，给出可读提示而不是静默失败。
      if (url === '/api/selection-pool/v1/auth/token') {
        return send(200, { ok: false, error: { code: 'USE_PASSWORD_LOGIN', message: '本机上品库请用账号密码登录，不用网页授权' } });
      }
      if (req.method !== 'POST' || url !== '/api/selection-pool/v1/items') return send(404, { ok: false, error: { code: 'NOT_FOUND', message: '未知端点' } });
      let raw = '';
      try {
        if (Number(req.headers['content-length']) > 8 * 1024 * 1024) return send(413, { ok: false, error: { code: 'TOO_LARGE', message: '采集包超过 8MB' } });
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 8 * 1024 * 1024) return send(413, { ok: false, error: { code: 'TOO_LARGE', message: '采集包超过 8MB' } });
        }
        // 老插件把采集包放在 payload.capture 里（schema_version 2），兼容扁平结构。
        const envelope = JSON.parse(raw || '{}');
        const capture = envelope?.capture && typeof envelope.capture === 'object' ? envelope.capture : envelope;
        const snapshot = capture?.snapshot && typeof capture.snapshot === 'object' ? capture.snapshot : {};
        const images = C.strList(snapshot.images || capture.images);
        const description = snapshot.description && typeof snapshot.description === 'object' ? snapshot.description : {};
        // 页面参数（宝贝属性）：同时兼容插件放在 capture 顶层、snapshot 里、以及老采集包的 snake_case。
        // 不写进 snapshot.attributes 的话，编辑器的「参数」页签永远是空的。
        const attributes = C.list(snapshot.attributes ?? snapshot.attribute_list ?? capture.attributes ?? capture.attribute_list)
          .map(a => ({ name: C.str(a?.name).slice(0, 40), value: C.str(a?.value).slice(0, 500) }))
          // 品牌不跟着商品走：哪个店铺上架就用哪个店铺的授权品牌（用户 2026-11-11）。
          .filter(a => a.name && a.value && !/^(?:品牌|品牌名称|brand|商标)$/i.test(a.name.trim()))
          .slice(0, 200);
        // 类目：插件采集包可能放在 capture.category{leaf_id,root_id}、capture.categoryId、
        // snapshot.category_id 或老采集包的 snake_case 里，统一归一后再入库。
        // 上架前校验读的是 listing.categoryId（由 contract.buildDetailView 从 snapshot.category_id 生成），
        // 少了这一步就会出现「上架读不到加入上品库那个原链接的类目」。
        const category = categoryService.normalizeCaptureCategory(capture, snapshot);
        const categoryPath = category.categoryPath;
        const categoryId = category.categoryId;
        const sku = C.trimmed(capture.sku || capture.skuId || capture.sku_id || snapshot.sku || snapshot.skuId || snapshot.sku_id);
        const result = await repo.ingest({
          request_id: C.trimmed(envelope.request_id || envelope.requestId || capture.request_id),
          product_id: C.trimmed(capture.productId || capture.product_id || capture.itemId || capture.item_id || snapshot.product_id || snapshot.item_id),
          sku,
          platform: C.str(capture.platform || snapshot.platform) || 'taobao',
          title: C.str(capture.title || snapshot.title),
          image_url: C.str(capture.imageUrl || capture.image_url || images[0]),
          product_url: C.str(capture.productUrl || capture.product_url || capture.pageUrl),
          shop_name: C.str(capture.shopName || capture.shop_name),
          price_fen: C.numOrNull(capture.priceFen ?? capture.price_fen),
          price_label: C.str(capture.priceLabel || capture.price_label),
          collected_at: C.str(capture.collectedAt || capture.collected_at),
          group_name: C.str(capture.groupName || capture.group_name),
          tags: capture.tags,
          owner_name: C.str(capture.ownerName || capture.owner_name),
          team_name: C.str(capture.teamName || capture.team_name),
          snapshot: {
            ...snapshot,
            ...(sku ? { sku } : {}),
            images,
            attributes,
            // 归一化失败时不要用空值覆盖插件已经采到的中文路径 / 类目 ID（用户 2026-11-11）。
            category_path: categoryPath || C.str(snapshot.category_path || capture.categoryPath),
            category_id: categoryId || C.str(snapshot.category_id || capture.categoryId),
            root_category_id: category.rootCategoryId || C.str(snapshot.root_category_id),
            category_source: category.source,
            description: { text: C.str(description.text), images: C.strList(description.images) },
          },
        });
        // 一次性通知，不写进顶部常驻进度条；列表直接新增并刷新。
        notice('ingest', '已接收插件采集', { itemId: result.itemId, refresh: true, paramCount: attributes.length, categoryId, categoryPath });
        // 回执与老 SaaS parsePushReceipt 同形；item_id/version 必须是整数，重复提交固定新增而非覆盖。
        return send(200, {
          raw_saved: result.rawSaved, item_id: C.int(result.itemId), action: result.action,
          category_id: categoryId, category_path: categoryPath,
          version: C.int(result.version), collected_at: result.collectedAt,
          request_id: C.trimmed(envelope.request_id || envelope.requestId), replayed: result.replayed,
          readded: false,
        });
      } catch (error) {
        return send(400, { ok: false, error: { code: 'BAD_REQUEST', message: C.str(error?.message || error).slice(0, 300) } });
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    ingestServer = server;
    return { ok: true, port: server.address()?.port, endpoint: `http://127.0.0.1:${server.address()?.port}/api/selection-pool/v1/items` };
  }

  async function stopIngestServer() {
    if (!ingestServer) return { ok: true, stopped: false };
    const server = ingestServer;
    ingestServer = null;
    // close() 只等「连接自然结束」；插件/浏览器留着 keep-alive 连接时它会永远不回调，
    // 退出流程就被卡住 → 进程活着但没窗口、还占着单实例锁（用户 2026-11-12「双击打不开」）。
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 2000);
      try { server.closeAllConnections?.(); } catch { /* 旧 Node 没有就靠超时 */ }
      try { server.close(() => { clearTimeout(timer); resolve(); }); } catch { clearTimeout(timer); resolve(); }
    });
    return { ok: true, stopped: true };
  }

  const ingestStatus = () => ({ running: Boolean(ingestServer), port: ingestServer?.address()?.port || null });

  // ---------------------------------------------------------------- 自动上架 / 回填状态机
  let activeQueueRunner = null;
  let activeRunId = '';
  let activeLogLine = null;
  /**
   * 当前正在执行的上架批次中断开关（用户 2026-11-21：「正在上架的产品没有办法停止」）。
   * 停止按钮置 stopped 并调 driver.cancel() 销毁发布窗口，当前这件商品当场中断；
   * 看门狗也用它：连续很久没有新日志（页面卡住）就按卡住处理，不再无限等。
   */
  let activeAbort = null;
  const PUBLISH_STALL_MS = 180 * 1000;      // 连续 3 分钟没有任何新日志 → 判卡住
  const PUBLISH_MAX_MS = 25 * 60 * 1000;    // 单件商品硬上限

  function driverStep() {
    try { return typeof driver?.currentStep === 'function' ? String(driver.currentStep() || '') : ''; } catch { return ''; }
  }

  /** 请求中断当前批次或当前正在上架的单个商品：置标记 + 立刻销毁发布窗口（挂着的页面脚本会马上失败）。 */
  function requestStop(reason = '已手动停止', kind = 'manual', stopMode = 'all') {
    if (!activeAbort) return { ok: false, running: false };
    if (!activeAbort.stopped) {
      activeAbort.stopped = true;
      activeAbort.reason = String(reason || '已手动停止');
      activeAbort.kind = kind === 'stall' ? 'stall' : 'manual';
      activeAbort.stopMode = stopMode === 'single' && kind !== 'stall' ? 'single' : 'all';
      try { activeAbort.onStop?.(); } catch { /* */ }
    } else if (stopMode === 'all') {
      activeAbort.stopMode = 'all';
    }
    try { driver?.cancel?.(activeAbort.reason); } catch { /* */ }
    return { ok: true, running: true, step: driverStep() };
  }

  /**
   * 停止右侧排队列表中的单个商品：
   *  - 如果是正在上架的当前商品（或仅有这一件在跑），立刻中断当前发布窗口并标记该商品为「已停止」；
   *    若队列里还有其他「排队中」的商品，则只停这一件并自动继续下一件；
   *  - 如果是「排队中」的等待商品，直接将其状态改为「已停止」；
   *  - 如果没有执行中的 runner（异常退出残留），调用 recoverStopped() 收干净运行态。
   */
  async function queueStopItem(input = {}) {
    const queueId = C.str(input.queueId);
    const currentQueue = await publication.queue();
    const target = queueId
      ? (currentQueue.items || []).find(r => r.queueId === queueId)
      : (currentQueue.items || []).find(r => r.status === 'running');

    if (!activeQueueRunner || !activeAbort) {
      if (target && (target.status === 'queued' || target.status === 'running')) {
        await publication.queueUpdateItem(target.queueId, {
          status: 'stopped',
          code: 'STOPPED',
          message: '已手动停止',
          finishedAt: new Date().toISOString(),
        });
      }
      const recovered = await publication.recoverStopped();
      return recovered?.queue || publication.queue();
    }

    if (!target) return currentQueue;
    if (target.status === 'queued') {
      await publication.queueUpdateItem(target.queueId, {
        status: 'stopped',
        code: 'STOPPED',
        message: '已手动停止',
        finishedAt: new Date().toISOString(),
      });
      if (activeLogLine) {
        await activeLogLine(`已停止排队商品：选品#${target.itemId} → ${target.shopName || '目标店铺'}`, { poolItemId: target.itemId, code: 'STOPPED' });
      }
      return publication.queue();
    }

    if (target.status === 'running' || (queueId && queueId === activeAbort.currentQueueId)) {
      const hasMoreQueued = (currentQueue.items || []).some(r => r.queueId !== target.queueId && r.status === 'queued');
      const stopMode = hasMoreQueued ? 'single' : 'all';
      requestStop(hasMoreQueued ? '已手动停止当前商品' : '已手动停止', 'manual', stopMode);
      await publication.queuePatch({
        stopRequested: stopMode === 'all',
        title: `正在停止：选品#${target.itemId}…`,
      });
      return publication.queue();
    }

    return currentQueue;
  }

  /**
   * 与老软件一致的三段推进：作图 → 入仓 → 回填。
   * 真实平台写入通过 driver 注入（driver.publish / driver.backfill）；
   * 未注入时**只推进本地状态并记录日志**，绝不谎报"已上架"。
   *
   * 支持：
   *  - 队列运行中再次提交（自动追加到当前排队序列末尾，不覆盖正在运行的进度）
   *  - 队列运行中从右侧队列移除「排队中」的商品
   *  - background: true 立即返回，供前端异步监控并随时追加/移除
   */
  async function autoShelf(input = {}) {
    const itemIds = C.list(input.itemIds).map(C.int).filter(n => n > 0);
    const rawStoreIds = C.strList(input.storeIds).length ? C.strList(input.storeIds) : [C.str(input.storeId)].filter(Boolean);
    const storeIds = [...new Set(rawStoreIds)];
    if (!itemIds.length) throw new Error('请先勾选要上架的选品');
    if (!storeIds.length) throw Object.assign(new Error('请先选择上架目标店铺'), { code: 'NO_SHOP' });

    const resolvedShops = [];
    for (const storeId of storeIds) {
      const shop = await shopSession.getShopState(storeId);
      if (!shop) throw Object.assign(new Error('请先选择上架目标店铺'), { code: 'NO_SHOP' });
      if (shop.state !== 'logged-in') throw Object.assign(new Error(`${shop.name}：${shop.label}，请先完成店铺登录`), { code: 'NO_SHOP_SESSION' });
      resolvedShops.push({ storeId, shop });
    }

    const db = await repo.readItems().catch(() => ({ items: [] }));
    const titleById = new Map();
    for (const row of C.list(db.items)) {
      titleById.set(C.int(row.id), C.str(row.title).slice(0, 120));
    }

    const newEntries = [];
    for (const { storeId, shop } of resolvedShops) {
      for (const id of itemIds) {
        newEntries.push({
          queueId: publication.nextQueueId(id),
          itemId: id,
          title: titleById.get(id) || '',
          shopId: storeId,
          shopName: shop.name,
          status: 'queued',
          code: '',
          message: '',
          startedAt: '',
          finishedAt: '',
        });
      }
    }

    // 队列已在运行时：追加到当前排队序列末尾，不重建 runId、不丢失已跑进度。
    if (activeQueueRunner) {
      const appended = await publication.queueAppend(newEntries);
      if (activeLogLine) {
        await activeLogLine(`已新增 ${newEntries.length} 件到排队序列（当前合计 ${appended.queue?.total || 0} 件）`, { code: 'QUEUE_APPEND', count: newEntries.length });
      }
      return {
        ok: true,
        runId: activeRunId,
        appended: true,
        addedCount: newEntries.length,
        total: appended.queue?.total || newEntries.length,
        results: [],
        success: 0,
        failed: 0,
      };
    }

    const runId = `run-${Date.now()}`;
    const startedAt = new Date().toISOString();
    const lines = [];
    await publication.queuePatch({
      running: true, runId, done: 0, total: newEntries.length, ok: 0, fail: 0,
      startedAt, title: '准备中…', stopRequested: false, lines: [], items: newEntries,
    });

    const logLine = async (line, context = {}) => {
      lines.push(line);
      // 心跳不算「有新进展」：否则页面真卡住时看门狗永远等不到超时
      if (activeAbort && context?.heartbeat !== true) activeAbort.lastProgressAt = Date.now();
      await repo.appendAutoShelfLog({ runId, line, context }).catch(() => undefined);
      await publication.queuePatch({ lines: lines.slice(-120), title: line.slice(0, 120) }).catch(() => undefined);
      emit({ module: 'selectionpool', stage: 'log', message: line, done: true, transient: true, runId });
    };

    activeRunId = runId;
    activeLogLine = logLine;
    const abort = {
      stopped: false, reason: '', onStop: null, stopMode: 'all', currentQueueId: '',
      startedAt: Date.now(), lastProgressAt: Date.now(), itemStartedAt: 0,
    };
    activeAbort = abort;
    const results = [];
    // 心跳：每 40 秒留一行「还在做什么」，页面慢的时候不会再像死机；
    // 心跳不刷新 lastProgressAt，真卡住时看门狗照样能判出来。
    const heartbeat = setInterval(() => {
      if (abort.stopped) return;
      const step = driverStep();
      const secs = Math.round((Date.now() - abort.startedAt) / 1000);
      void logLine(`⏱ 已运行 ${Math.floor(secs / 60)} 分 ${secs % 60} 秒${step ? ` · 当前步骤：${step}` : ''}（页面没有新进展时，连续 ${Math.round(PUBLISH_STALL_MS / 1000)} 秒会自动中断并说明原因）`, { heartbeat: true });
    }, 40000);
    // 看门狗：超过 2.5 分钟没有任何新日志，或单件超过 25 分钟，直接中断这件商品。
    // 以前页面被平台弹窗卡住时，停止按钮和队列都只能干等。
    const watchdog = setInterval(() => {
      if (abort.stopped) return;
      const idle = Date.now() - abort.lastProgressAt;
      // 25 分钟上限按「单件商品」算，不是整批：一批 10 件跑一小时不该被误杀
      const total = abort.itemStartedAt ? Date.now() - abort.itemStartedAt : 0;
      const step = driverStep();
      if (total > PUBLISH_MAX_MS) {
        requestStop(`上架超时：这件商品已经跑了 ${Math.round(total / 60000)} 分钟${step ? `（最后步骤：${step}）` : ''}，已自动中断；可直接重新上架这件商品`, 'stall');
      } else if (idle > PUBLISH_STALL_MS) {
        requestStop(`上架卡住：连续 ${Math.round(idle / 1000)} 秒没有新进展${step ? `（最后步骤：${step}）` : ''}，已自动中断；可直接重新上架这件商品`, 'stall');
      }
    }, 5000);

    const runLoop = async () => {
      let stepIndex = 0;
      let interrupted = false;
      try {
        while (true) {
          const currentQueue = await publication.queue();
          if (abort.stopped) {
            await logLine(`已停止：${abort.reason || '手动停止'}（未开始的排队商品不再执行）`);
            interrupted = true;
            break;
          }
          if (publication.isStopped(currentQueue)) {
            await logLine('已手动停止队列');
            interrupted = true;
            break;
          }
          const nextRow = (currentQueue.items || []).find(r => r.status === 'queued');
          if (!nextRow) break;

          stepIndex += 1;
          const totalNow = Math.max((currentQueue.items || []).length, stepIndex);
          const itemId = nextRow.itemId;
          const storeId = C.str(nextRow.shopId) || resolvedShops[0].storeId;
          const shop = (resolvedShops.find(x => x.storeId === storeId)?.shop) || (await shopSession.getShopState(storeId)) || resolvedShops[0].shop;
          const label = `[${stepIndex}/${totalNow}] 选品#${itemId} → ${shop.name}`;
          const cfg = await publication.config();
          const started = new Date().toISOString();

          abort.currentQueueId = nextRow.queueId;
          await publication.queueUpdateItem(nextRow.queueId, { status: 'running', startedAt: started });
          await publication.queuePatch({ title: `${shop.name} · 选品#${itemId}` });
          abort.lastProgressAt = Date.now();
          abort.itemStartedAt = Date.now();
          await logLine(`${label} 拉取详情…`, { poolItemId: itemId, shopProfileId: storeId, startedAt: started });
          progress('autoShelf', `[${stepIndex}/${totalNow}] 正在处理选品 #${itemId}`, { index: stepIndex - 1, current: stepIndex, total: totalNow });

          let detail = null;
          try {
            detail = await repo.detail(itemId);
            const draft = await editorStore.get(itemId).catch(() => null);
            const categoryId = C.str(
              draft?.categoryId || detail.listing?.categoryId || detail.categoryId || detail.snapshot?.category_id,
            );
            const categoryPath = C.str(
              draft?.categoryPath || detail.listing?.categoryPath || detail.categoryPath || detail.snapshot?.category_path,
            );
            if (!categoryId) {
              const reread = await categoryService.readSource({ itemId, productId: detail.product?.id, platform: detail.product?.platform, storeId, refresh: false });
              if (reread.ok) {
                await logLine(`${label} 已按商品 ID 补读类目 ${reread.data.leafId}`, { poolItemId: itemId, code: 'CATEGORY_REREAD' });
                detail = await repo.detail(itemId);
              }
            }
            if (!C.str(categoryId || detail.listing?.categoryId || detail.categoryId)) {
              throw Object.assign(new Error('缺少类目 path/categoryId，跳过：请在「参数」页点「采集」或选叶子类目'), { code: 'MISSING_CATEGORY' });
            }
            const price = publication.applyPrice(detail.product?.priceFen, cfg);
            if (cfg?.useWorkbenchPrice) {
              await logLine(`${label} 上架价格：按「工作台价格」上架（不套用同行价公式）`, { poolItemId: itemId, code: 'PRICE_WORKBENCH' });
            } else if (price && (price.factor !== 1 || price.offset)) {
              await logLine(`${label} 上架价格：同行价 ¥${(price.before / 100).toFixed(2)} → ¥${(price.after / 100).toFixed(2)}`, { poolItemId: itemId, code: 'REPRICE' });
            }
            let publishDraft = draft;
            // 上架设置里选的模板：先补宣传规格 / 详情页固定图，再按价格规则重算
            if (publishDraft && (cfg?.skuTemplateId || cfg?.detailTemplateId)) {
              publishDraft = await applyBatchTemplates(publishDraft, cfg, logLine, label);
            }
            const draftSkus = C.list(publishDraft?.skus).filter(s => !s.removed);
            if (draftSkus.length && cfg && !cfg.useWorkbenchPrice) {
              const rule = {
                factor: C.str(cfg.priceFactor || '1') || '1',
                amount: C.str(cfg.priceOffset || '0') || '0',
                direction: cfg.priceDirection === 'add' ? 'add' : 'subtract',
              };
              const repriced = C.repriceSkus(draftSkus, rule);
              if (repriced.summary.changed) {
                await logLine(`${label} ${C.describeReprice(repriced.formula, repriced.summary)}`, { poolItemId: itemId, code: 'REPRICE_SKU' });
                // 注意用 publishDraft 展开：直接用 draft 会把这批套用的模板图/规格丢掉
                publishDraft = { ...publishDraft, skus: repriced.skus };
              }
            }
            if (publishDraft && (C.list(publishDraft.attrs).length || C.list(publishDraft.skus).length)) {
              await logLine(`${label} 按本机保存的草稿上架：参数 ${C.list(publishDraft.attrs).length} 项 · 规格 ${C.list(publishDraft.skus).filter(s => !s.removed).length} 条`, { poolItemId: itemId, code: 'DRAFT' });
            }
            let warehouseItemId = detail.warehouseItemId;
            if (!driver || typeof driver.publish !== 'function') {
              throw Object.assign(new Error('上架驱动未接入（需店铺会话驱动或开放平台凭证）；已登记为「没入仓、可以接着处理的任务」'), { code: 'DRIVER_NOT_READY' });
            }
            let hints = [];
            try {
              hints = await suggestions.hintsFor(publishDraft || {}, detail);
            } catch { hints = []; }
            const derived = hints.filter(h => h.source && h.source !== '参数');
            if (derived.length) {
              await logLine(`${label} 必填提议 ${derived.length} 项（${[...new Set(derived.map(h => h.source))].join('/')}）：${derived.slice(0, 4).map(h => `${h.name}=${h.value}`).join('、')}`, { poolItemId: itemId, code: 'REQUIRED_HINTS' });
            }
            const publishTask = driver.publish({
              detail, draft: publishDraft, shop, storeId, taobaoApi, categoryId, categoryPath, config: cfg, price,
              hints, pictureSpace,
              shouldStop: () => abort.stopped,
              log: line => { void logLine(`${label} ${String(line || '').slice(0, 300)}`, { poolItemId: itemId, shopProfileId: storeId, stage: 'publish' }); },
            });
            publishTask.catch(() => undefined);
            // 与「停止」竞速：停止按钮/看门狗一置标记就立刻返回，不再等驱动自己跑完
            // （页面被平台弹窗卡住时，那个 promise 可能永远不会结束）。
            const stopSignal = new Promise((_resolve, reject) => {
              abort.onStop = () => reject(Object.assign(new Error(abort.reason || '已手动停止上架'), { code: 'STOPPED' }));
            });
            stopSignal.catch(() => undefined);
            const published = await Promise.race([publishTask, stopSignal]);

            if (!published?.warehouseItemId) throw new Error(published?.message || '填充完成但未确认入仓');
            warehouseItemId = C.str(published.warehouseItemId);
            // 把本次发布页真实读到的「店铺中分类」写回缓存，设置页下次打开就有完整选项
            if (Array.isArray(published.shopCategories) && published.shopCategories.length) {
              await categoryService.rememberShopCategories(
                storeId,
                published.shopCategories.map(item => (item && typeof item === 'object' ? item : { name: item })),
              ).catch(() => undefined);
            }
            await repo.update(itemId, { flow: C.FLOW_STATES.TOFILL, warehouseItemId, shopProfileId: storeId }, detail.version);
            await repo.appendShelfRecord({ runId, itemId, productId: detail.product?.id, shopId: storeId, shopName: shop.name, warehouseItemId, status: 'success', at: new Date().toISOString() });
            await logLine(`${label} 已放入仓库 #${warehouseItemId}`, { poolItemId: itemId, shopProfileId: storeId, productId: detail.product?.id, finishedAt: new Date().toISOString(), code: 'OK' });
            await publication.capture({ runId, itemId, productId: detail.product?.id, title: detail.product?.title, shopName: shop.name, shopId: storeId, status: 'success', code: 'OK', message: `已放入仓库 #${warehouseItemId}`, warehouseItemId, operatorName: operatorName(), teamName: teamName() });
            results.push({ itemId, ok: true, warehouseItemId });
            try {
              const usedHints = hints.filter(h => h.source && h.source !== '参数');
              if (usedHints.length) await suggestions.remember(publishDraft || {}, detail, usedHints);
            } catch { /* 记忆失败不影响上架结果 */ }
            await publication.queueUpdateItem(nextRow.queueId, {
              status: 'done', code: 'OK', message: `已放入仓库 #${warehouseItemId}`,
              title: C.str(publishDraft?.title || detail.product?.title).slice(0, 120),
              finishedAt: new Date().toISOString(),
            });
          } catch (error) {
            // 手动停止 / 看门狗中断：当前商品当场结束，不计「上架失败」，也不登记人工补全任务
            if (String(error?.code || '') === 'STOPPED' || abort.stopped) {
              const reason = abort.reason || String(error?.message || '') || '已手动停止';
              const stalled = abort.kind === 'stall';
              const singleStop = !stalled && abort.stopMode === 'single';
              await logLine(`${label} ${stalled ? '已自动中断' : '已停止'}：${reason}`, { poolItemId: itemId, shopProfileId: storeId, code: stalled ? 'PUBLISH_STALL' : 'STOPPED', finishedAt: new Date().toISOString() });
              if (stalled) {
                // 卡住要能在「失败排查」里查到原因，但不登记人工补全（窗口已关闭，重新上架即可）
                await publication.capture({
                  runId, itemId, productId: detail?.product?.id, title: detail?.product?.title,
                  shopName: shop.name, shopId: storeId, status: 'failed', code: 'PUBLISH_STALL',
                  message: reason, reasonKey: reason, operatorName: operatorName(), teamName: teamName(),
                }).catch(() => undefined);
              }
              await publication.queueUpdateItem(nextRow.queueId, {
                status: 'stopped', code: stalled ? 'PUBLISH_STALL' : 'STOPPED', message: String(reason).slice(0, 300),
                title: C.str(detail?.product?.title).slice(0, 120),
                finishedAt: new Date().toISOString(),
              }).catch(() => undefined);
              results.push({ itemId, ok: false, stopped: true, code: stalled ? 'PUBLISH_STALL' : 'STOPPED', message: reason });
              if (singleStop) {
                abort.stopped = false;
                abort.reason = '';
                abort.stopMode = 'all';
                abort.currentQueueId = '';
                abort.lastProgressAt = Date.now();
                await publication.queuePatch({ stopRequested: false }).catch(() => undefined);
                continue;
              }
              interrupted = true;
              break;
            }
            const { code, summary } = C.classifyFailure(error?.message);
            const finalCode = C.str(error?.code) && C.str(error.code) !== 'UNKNOWN' ? C.str(error.code) : code;
            const message = C.str(error?.message || error);
            await repo.update(itemId, { flow: C.FLOW_STATES.PUBLISH_FAILED }, undefined).catch(() => {});
            await logLine(`${label} 失败：${message}`, { poolItemId: itemId, shopProfileId: storeId, code: finalCode, finishedAt: new Date().toISOString() });
            await publication.capture({ runId, itemId, productId: detail?.product?.id, title: detail?.product?.title, shopName: shop.name, shopId: storeId, status: 'failed', code: finalCode, message, reasonKey: message, operatorName: operatorName(), teamName: teamName() });
            await repo.setManualFix({
              itemId, storeId, url: publishPageUrl(detail || {}, 'new'),
              token: `xx-${itemId}-${Date.now().toString(36)}`, status: 'pending',
              title: C.str(detail?.product?.title).slice(0, 200),
              reason: `${finalCode} · ${message}`.slice(0, 500), code: finalCode,
            }).catch(() => undefined);
            results.push({ itemId, ok: false, code: finalCode, message: summary });
            await publication.queueUpdateItem(nextRow.queueId, {
              status: 'failed', code: finalCode, message: message.slice(0, 300),
              title: C.str(detail?.product?.title).slice(0, 120),
              finishedAt: new Date().toISOString(),
            });
            if (code === 'NEEDS_MANUAL_VERIFICATION') {
              await logLine('其余任务已停止：需要人工验证（在店铺窗口处理完后点「继续入仓」）');
              interrupted = true;
              break;
            }
          }
        }
        const finalQueue = await publication.queue();
        let stoppedCount = 0;
        if (interrupted) {
          const updatedItems = (finalQueue.items || []).map(row => {
            if (row.status === 'queued') {
              stoppedCount += 1;
              return { ...row, status: 'stopped', finishedAt: new Date().toISOString() };
            }
            return row;
          });
          if (stoppedCount) {
            await publication.queuePatch({ items: updatedItems }).catch(() => undefined);
            await logLine(`${stoppedCount} 件未执行（队列已停止或需要人工处理），可再次勾选后继续`);
          }
        }
        const okCount = results.filter(r => r.ok).length;
        const failCount = results.filter(r => !r.ok && !r.stopped).length;
        const stopCount = results.filter(r => r.stopped).length;
        await logLine(`自动上架结束：成功 ${okCount} / 失败 ${failCount}${stopCount ? ` / 已停止 ${stopCount}` : ''} / 合计 ${results.length + stoppedCount}`);
      } finally {
        clearInterval(heartbeat);
        clearInterval(watchdog);
        activeAbort = null;
        activeQueueRunner = null;
        activeRunId = '';
        activeLogLine = null;
        // stopRequested 必须一起清掉：否则界面按钮会永远停在「正在停止…」
        await publication.queuePatch({ running: false, stopRequested: false, title: '' }).catch(() => undefined);
        const okCount = results.filter(r => r.ok).length;
        const failCount = results.filter(r => !r.ok && !r.stopped).length;
        const stopCount = results.filter(r => r.stopped).length;
        progressEnd('autoShelf', `上架处理结束：成功 ${okCount} 条，失败 ${failCount} 条${stopCount ? `，已停止 ${stopCount} 条` : ''}`, {});
      }
      return {
        ok: true,
        runId,
        results,
        success: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok && !r.stopped).length,
        stopped: results.filter(r => r.stopped).length,
      };
    };

    activeQueueRunner = runLoop();
    if (input.background === true) {
      void activeQueueRunner.catch(() => undefined);
      return { ok: true, runId, started: true, appended: false, total: newEntries.length, results: [], success: 0, failed: 0 };
    }
    return activeQueueRunner;
  }

  /**
   * 回填：图位级状态 + 只信回读（老软件最值得保留的设计）。
   * 未接入 driver 时只把图位标为待回填，不谎报成功。
   */
  async function backfill(input = {}) {
    const itemId = C.int(input.itemId);
    if (!itemId) throw new Error('请指定要回填的选品');
    const detail = await repo.detail(itemId);
    if (!detail.warehouseItemId) throw Object.assign(new Error('该选品尚未入仓，无法回填'), { code: 'NOT_LANDED' });
    if (!driver || typeof driver.backfill !== 'function') {
      return { ok: false, code: 'DRIVER_NOT_READY', message: '回填驱动未接入（需店铺会话驱动或官方 API 凭证）', itemId };
    }
    const draft = await editorStore.get(itemId).catch(() => null);
    const result = await driver.backfill({
      detail, draft, taobaoApi, slots: detail.slots,
      numIid: C.str(input.numIid || detail.warehouseItemId),
      pictureSpace,
      log: line => {
        void repo.appendAutoShelfLog({
          runId: `backfill-${itemId}`,
          line: `[backfill] ${String(line || '').slice(0, 300)}`,
          context: { poolItemId: itemId, stage: 'backfill' },
        }).catch(() => undefined);
      },
    });
    // 凭证没填（DRIVER_NOT_READY）时不要动图位状态，避免把「待回填」误标成失败。
    if (result && result.ok === false && result.code === 'DRIVER_NOT_READY') {
      return { ok: false, itemId, code: 'DRIVER_NOT_READY', message: result.message, slots: C.list(detail.slots) };
    }
    // 只信回读：readbackCount 必须与 expectedCount 对齐
    const slots = C.list(result?.slots).map(C.normalizeSlot);
    const allMatched = slots.length > 0 && slots.every(s => s.state === C.SLOT_STATES.FILLED && s.readbackCount === s.expectedCount);
    await repo.update(itemId, {
      slots,
      flow: allMatched ? C.FLOW_STATES.DONE : C.FLOW_STATES.TOFILL,
    }, detail.version);
    return { ok: true, itemId, allMatched, slots };
  }

  // ------------------------------------------------ 店铺页面人工补全参数（老软件 form-capture resumable）
  /**
   * 老软件的做法：自动填表失败但发布页还停在这件商品上时，把隐藏的店铺窗口显示出来，
   * 让用户手动补齐参数，再点「我已改好，继续」从断点继续入仓。
   * 新软件用同一个店铺登录会话打开内嵌的发布页，并提供补全结果回填 + 继续入仓。
   */
  const PUBLISH_PAGE = 'https://sell.publish.tmall.com/tmall/publish.htm';

  function publishPageUrl(detail, mode = 'new') {
    const url = new URL(PUBLISH_PAGE);
    const categoryId = C.str(detail?.listing?.categoryId || detail?.categoryId);
    if (categoryId) url.searchParams.set('catId', categoryId);
    const warehouseId = C.str(detail?.warehouseItemId);
    if (mode === 'edit' && warehouseId) url.searchParams.set('id', warehouseId);
    url.searchParams.set('fromAICategory', 'true');
    url.searchParams.set('fromAIPublish', 'true');
    url.searchParams.set('newRouter', '1');
    return url.toString();
  }

  /** 返回发布页地址并登记一条「待人工补全」记录；打开动作由渲染层调 browser.open 完成。 */
  async function openShopPublishPage(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const storeId = C.str(input.storeId) || C.str(detail.shopProfileId);
    if (!storeId) throw new Error('请先选择要上架的店铺');
    const url = publishPageUrl(detail, input.mode === 'edit' ? 'edit' : 'new');
    const token = `xx-${itemId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await repo.setManualFix({
      itemId, storeId, url, token, status: 'pending',
      title: C.str(detail.product?.title).slice(0, 200),
      reason: C.str(input.reason) || '参数或类目不全，需人工补全',
      code: C.str(input.code) || 'MANUAL_FIX',
    });
    await repo.appendAutoShelfLog({
      runId: `manual-${itemId}`,
      line: `选品#${itemId} 已打开店铺页面，等待人工补全参数`,
      context: { poolItemId: itemId, shopProfileId: storeId, code: 'MANUAL_FIX_OPENED', url },
    });
    return { ok: true, itemId, storeId, kind: 'publish', url, token };
  }

  /**
   * 独立发布页弹窗（用户 2026-11-10）：人工补全/滑块直接在这个单独窗口里做，
   * 不再跳店铺浏览器页面。窗口用店铺自己的 partition，登录会话直接可用。
   * 未注入 openWindow（测试环境）时退回只返回地址。
   */
  async function openPublishWindow(input = {}) {
    const itemId = C.int(input.itemId);
    let storeId = C.str(input.storeId);
    let url = C.str(input.url);
    if (itemId) {
      const detail = await repo.detail(itemId).catch(() => null);
      if (detail) {
        storeId = storeId || C.str(detail.shopProfileId);
        if (!url) url = publishPageUrl(detail, input.mode === 'edit' ? 'edit' : 'new');
      }
    }
    if (!url) url = 'https://sell.publish.tmall.com/tmall/publish.htm';
    if (!storeId) throw new Error('请先选择要上架的店铺');
    if (!openWindow) return { ok: true, opened: false, url, storeId };
    const result = await openWindow({ storeId, url, title: '发布页 · 请补全后提交入仓' });
    if (itemId) {
      await repo.setManualFix({
        itemId, storeId, url, token: `xx-${itemId}-${Date.now().toString(36)}`, status: 'pending',
        title: C.str((await repo.detail(itemId).catch(() => null))?.product?.title).slice(0, 200),
        reason: C.str(input.reason) || '已在独立发布页窗口补全参数',
      }).catch(() => undefined);
    }
    return { ok: true, opened: true, url, storeId, ...(result || {}) };
  }

  function parseManualAttributes(text) {
    return C.list(String(text || '').split(/\r?\n/)).map(line => {
      const at = String(line).search(/[:：=]/);
      if (at <= 0) return null;
      return { name: C.str(String(line).slice(0, at)).slice(0, 120), value: C.str(String(line).slice(at + 1)).slice(0, 500) };
    }).filter(row => row && row.name && row.value).slice(0, 200);
  }

  /** 把人工填好的类目 / 属性 / 仓库商品编号回写到选品记录。 */
  async function saveManualParams(input = {}) {
    const itemId = C.int(input.itemId);
    const attributes = [
      ...C.list(input.attributes).map(a => ({ name: C.str(a?.name), value: C.str(a?.value) })),
      ...parseManualAttributes(input.text),
    ];
    const result = await repo.applyManualParams(itemId, {
      attributes,
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.categoryPath !== undefined ? { categoryPath: input.categoryPath } : {}),
      ...(input.warehouseItemId !== undefined ? { warehouseItemId: input.warehouseItemId } : {}),
    });
    try { await editorStore.syncBaseline(itemId, await repo.detail(itemId), true); } catch { /* 草稿同步失败不影响回写 */ }
    await repo.appendAutoShelfLog({
      runId: `manual-${itemId}`,
      line: `选品#${itemId} 已回填人工补全的类目与参数（${result.attributeCount} 项）`,
      context: { poolItemId: itemId, code: 'MANUAL_FIX_SAVED' },
    });
    return { ok: true, ...result };
  }

  /** 用户点「我已填好，继续」：填了仓库编号就确认入仓，否则重跑一次上架。 */
  async function resumeManualShelf(input = {}) {
    const itemId = C.int(input.itemId);
    const pending = (await repo.listManualFix()).find(row => C.int(row.itemId) === itemId);
    if (!pending) throw new Error('没有待处理的人工补全记录，请先点「打开店铺页面」');
    if (input.saveParams !== false && (input.text || C.list(input.attributes).length || input.categoryId !== undefined)) {
      await saveManualParams({ ...input, itemId });
    }
    const warehouseItemId = C.str(input.warehouseItemId);
    if (warehouseItemId) {
      const detail = await repo.detail(itemId);
      await repo.update(itemId, { flow: C.FLOW_STATES.TOFILL, warehouseItemId, shopProfileId: pending.storeId });
      await repo.appendShelfRecord({
        runId: `manual-${itemId}`, itemId, productId: detail.product?.id,
        shopId: pending.storeId, shopName: '', warehouseItemId, status: 'manual', at: new Date().toISOString(),
      });
      await repo.appendAutoShelfLog({
        runId: `manual-${itemId}`, line: `选品#${itemId} 人工补全后已入仓 #${warehouseItemId}`,
        context: { poolItemId: itemId, code: 'MANUAL_FIX_DONE' },
      });
      await repo.setManualFix({ ...pending, status: 'done', warehouseItemId });
      return { ok: true, landed: true, warehouseItemId, itemId };
    }
    // 没有仓库编号就不谎报入仓：清掉待办、重新执行一次上架检查。
    await repo.setManualFix({ ...pending, status: 'done' });
    await repo.appendAutoShelfLog({
      runId: `manual-${itemId}`, line: `选品#${itemId} 人工补全已确认，重新执行上架检查`,
      context: { poolItemId: itemId, code: 'MANUAL_FIX_RESUMED' },
    });
    const retried = await autoShelf({ itemIds: [itemId], storeId: pending.storeId });
    return { ok: true, landed: false, retried };
  }

  async function dismissManualFix(input = {}) {
    await repo.clearManualFix(C.int(input.itemId));
    return { ok: true };
  }

  async function manualFixStatus() {
    const items = await repo.listManualFix();
    return { items, count: items.length };
  }

  // ---------------------------------------------------------------- CSV 导出
  async function exportCsv(input = {}) {
    const query = { ...input, page: input.page || 1, size: input.size || 200 };
    const result = await repo.list(query);
    const rows = result.items.map(C.rowToCsv);
    if (!rows.length) return { status: 'empty', rowCount: 0 };
    const buffer = C.buildCsvBuffer(rows);
    if (!dialog?.showSaveDialog) return { status: 'unsupported', rowCount: rows.length };
    const chosen = await dialog.showSaveDialog({
      title: '导出上品库 CSV',
      defaultPath: `上品库-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
    });
    if (chosen.canceled || !chosen.filePath) return { status: 'cancelled', rowCount: 0 };
    const target = path.extname(chosen.filePath).toLowerCase() === '.csv' ? chosen.filePath : `${chosen.filePath}.csv`;
    await fs.writeFile(target, buffer);
    return { status: 'saved', rowCount: rows.length, filePath: target };
  }

  // ---------------------------------------------------------------- 商品图片工作台（编辑器）
  /** 类目路径反查缓存：同一个叶子类目只查一次（老软件同样缓存），首屏不再等类目树。 */
  const categoryPathCache = new Map();

  /** 类目路径 + 层级：采集包优先，其次本机类目树，最后内置对照表。 */
  async function resolveCategory(detail, draft) {
    let categoryPath = C.str(draft?.categoryPath || detail.categoryPath || detail.listing?.categoryPath);
    const categoryId = C.str(draft?.categoryId || detail.categoryId || detail.listing?.categoryId);
    let categoryLevels = C.strList(detail.categoryLevels);
    if (categoryPath && /^类目\s*\d+$/.test(categoryPath)) categoryPath = '';
    if ((!categoryPath || /^\d+$/.test(categoryPath)) && /^\d{2,16}$/.test(categoryId)) {
      const cached = categoryPathCache.get(categoryId);
      if (cached) {
        categoryPath = cached.path;
        if (!categoryLevels.length) categoryLevels = cached.names;
      } else {
        try {
          const hit = await categoryService.lookup({ ids: [categoryId] });
          const resolved = C.str(hit?.paths?.[0]?.path);
          if (resolved) {
            const names = C.strList(hit?.paths?.[0]?.names);
            categoryPathCache.set(categoryId, { path: resolved, names });
            categoryPath = resolved;
            if (!categoryLevels.length) categoryLevels = names;
          }
        } catch { /* 类目树还没读取时保持原值 */ }
      }
    }
    if (!categoryPath) {
      categoryPath = require('./category-names').knownCategoryPath(
        categoryId,
        ctx.dataDir ? require('node:path').join(ctx.dataDir, 'selectionpool', 'category-cache.json') : undefined,
      );
    }
    if (categoryPath) {
      const fromPath = categoryPath.split(/\s*(?:›|>|\/|／)\s*/).map(s => C.str(s).replace(/^(?:一级|二级|三级|四级)\s*/, '')).filter(Boolean);
      if (fromPath.length > categoryLevels.length) categoryLevels = fromPath;
    }
    return { categoryPath, categoryId, categoryLevels };
  }

  /** 本机图片 → data URL（CSP 只允许 data:/https:，file: 与自定义协议都显示不出来）。 */
  async function imageDataUrl(absolutePath) {
    const fs = require('node:fs/promises');
    if (!ctx.nativeImage?.createFromBuffer || !absolutePath) return '';
    try {
      const bytes = await fs.readFile(absolutePath);
      const image = ctx.nativeImage.createFromBuffer(bytes);
      if (image.isEmpty?.()) return '';
      const size = image.getSize();
      const scale = Math.min(1, 240 / Math.max(size.width || 240, size.height || 240));
      const thumb = scale < 1
        ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) })
        : image;
      return thumb.toDataURL();
    } catch { return ''; }
  }

  /**
   * 把 replaced / slotImages 里的本机图转成可直接 <img src> 的 data URL。
   * 键用「存进去的原值」（local:/绝对路径）：拖动排序换了图位以后，预览仍然跟着那张图走。
   */
  async function replacedPreviews(draft) {
    const targets = new Set();
    for (const map of Object.values(draft?.replaced || {})) {
      for (const value of Object.values(map || {})) if (value) targets.add(C.str(value));
    }
    for (const arr of Object.values(draft?.slotImages || {})) {
      for (const value of C.list(arr)) if (value) targets.add(C.str(value));
    }
    const out = {};
    for (const raw of targets) {
      if (!raw || /^https:\/\//i.test(raw)) continue;
      const abs = raw.startsWith('local:') ? raw.slice(6) : raw;
      const url = await imageDataUrl(abs);
      if (url) out[raw] = url;
    }
    return out;
  }

  /**
   * 打开编辑器：合并「采集详情」与「本机草稿」，返回渲染层一次就能画全的数据。
   * 与老软件一致：首次打开用采集内容初始化规格表/参数/详情页；之后读本机草稿。
   *
   * 用户 2026-11-11 第十次反馈：「读取内容太慢，有的品打开特别慢」。
   * 原因是这里把 6 件事串行 await（店铺状态 / 入仓记录 / 作图服务 / 缩略图 / 类目反查），
   * 而 editorBackfillTargets 内部又把 items.json 和 editor-drafts.json 各读了一遍。
   * 现在：详情只读一次、草稿复用、其余全部并行，并且把「预览图 / 类目反查」拆成可选字段。
   */
  async function editorLoad(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    // 首次打开即把「采集基线」落盘，避免后续编辑动作读到空草稿覆盖规格表。
    const { draft, isFirst } = await editorStore.ensure(itemId, detail);
    const shopStatesP = shopSession.listShopStates().catch(() => ({ stores: [], loggedIn: [] }));
    const drawingP = drawingClient.readiness().catch(() => ({ configured: false }));
    const backfillP = editorBackfillTargets({ itemId, detail, draft })
      .catch(() => ({ ok: false, targets: [], selected: [], historical: [] }));
    const categoryP = resolveCategory(detail, draft).catch(() => ({ categoryPath: '', categoryId: '', categoryLevels: [] }));
    const previewsP = replacedPreviews(draft).catch(() => ({}));
    const spaceP = pictureSpace.readiness().catch(() => ({ configured: false, note: '' }));
    // 缩略图只在本机已经有作图成品时才做（没有就是空数组，别白读盘）。
    const thumbsP = (draft.squareAiImages.length || draft.tallAiImages.length)
      ? buildThumbnails([
        ...draft.squareAiImages.map((p, i) => ({
          ok: true, ratio: '1:1', path: p, index: i + 1,
          absolutePath: require('node:path').join(ctx.dataDir || '', ...C.str(p).replace(/\\/g, '/').split('/')),
        })),
        ...draft.tallAiImages.map((p, i) => ({
          ok: true, ratio: '3:4', path: p, index: i + 1,
          absolutePath: require('node:path').join(ctx.dataDir || '', ...C.str(p).replace(/\\/g, '/').split('/')),
        })),
      ], ctx.nativeImage).catch(() => ({ square: [], tall: [], other: [] }))
      : Promise.resolve({ square: [], tall: [], other: [] });
    const [shopStates, drawing, backfill, category, replacedThumbs, existingThumbs, space] = await Promise.all([
      shopStatesP, drawingP, backfillP, categoryP, previewsP, thumbsP, spaceP,
    ]);
    return {
      itemId,
      detail,
      draft,
      categoryPath: category.categoryPath,
      categoryId: category.categoryId,
      categoryLevels: category.categoryLevels,
      tabs: C.editorTabs(detail, draft),
      backfill,
      drawing,
      squareThumbs: existingThumbs.square,
      tallThumbs: existingThumbs.tall,
      replacedThumbs,
      duplicates: C.duplicateSkuNames(draft.skus),
      // 采集来的图位素材（用于「采集原图」与详情页）
      squareSrcImages: C.strList(detail.images).slice(0, 5),
      detailImages: C.strList(detail.description?.images).slice(0, C.DISPLAY_LIMITS.descriptionImages),
      // 作图成品：本机没有 NAS / 作图服务，编码只做记录；真实成品需接入后回填到这里
      drawingServiceReady: false,
      warehouseItems: detail.warehouseItemId
        ? [{ warehouseItemId: detail.warehouseItemId, shopName: C.str(detail.shopName) }]
        : [],
      shopStates,
      driverReady: Boolean(driver && typeof driver.backfill === 'function'),
      // 回填要开放平台凭证（图片空间 + 商品编辑）：没填时按钮明确说明，不让用户白点。
      backfillReady: Boolean(space?.configured),
      backfillNote: C.str(space?.note),
      savedAt: draft.savedAt,
      isFirst,
      readOnlyHint: '',
    };
  }

  /** 编辑器任一字段变更：落本机草稿（自动保存，未点「保存」不算正式草稿）。 */
  async function editorPatch(input = {}) {
    const itemId = C.int(input.itemId);
    if (!itemId) throw new Error('缺少选品 ID');
    const detail = await repo.detail(itemId);
    const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
    const draft = await editorStore.save(itemId, detail.product?.id, patch);
    return { ok: true, draft, duplicates: C.duplicateSkuNames(draft.skus) };
  }

  /** 点「保存」：标记为正式草稿（老软件「本机草稿已保存」）。 */
  async function editorSave(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    // 保存前把允许落到上架信息里的字段同步进 listing（标题/类目/价格），供 autoShelf 使用
    const draft = await editorStore.save(itemId, detail.product?.id, input.patch || {});
    await repo.update(itemId, {
      listing: {
        title: draft.title || detail.product?.title,
        categoryId: draft.categoryId || detail.categoryId,
        categoryPath: draft.categoryPath || detail.categoryPath,
        detailImages: draft.detailImages,
        description: draft.detail,
        skus: C.list(draft.skus).filter(s => !s.removed).map(s => ({
          id: s.key, imageUrl: s.image,
          specs: [{ name: '规格', value: s.name }],
          priceFen: s.price ? Math.round(Number(s.price) * 100) : null,
          stock: s.stock ? Number(s.stock) : 0,
        })),
        attributes: C.list(draft.attrs).map(a => ({ name: a.name, value: a.value })),
      },
    }, detail.version);
    const saved = await editorStore.markSaved(itemId, detail.product?.id);
    return { ok: true, savedAt: saved.savedAt, version: detail.version + 1 };
  }

  /** 「恢复采集内容」：清除本机保存的修改（规格/详情页/参数/手工类目/素材图）。 */
  async function editorRestore(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const fresh = await editorStore.restore(itemId, detail);
    return { ok: true, draft: fresh, message: '已清除本机保存的修改，恢复成采集内容' };
  }

  /** 批量改价：同行价 × factor [减/加] amount 元。 */
  async function editorReprice(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    let draft = (await editorStore.ensure(itemId, detail)).draft;
    const result = C.repriceSkus(draft.skus, input.rule || draft.reprice);
    const patch = { skus: cleanSkuRows(result.skus), reprice: input.rule || draft.reprice };
    draft = await editorStore.save(itemId, detail.product?.id, patch);
    return { ok: true, draft, summary: result.summary, formula: result.formula, message: C.describeReprice(result.formula, result.summary) };
  }

  /** 批量粘贴「规格名 价格」。 */
  async function editorPasteSkus(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const draft = (await editorStore.ensure(itemId, detail)).draft;
    const parsed = C.parsePastedSkus(input.text);
    if (!parsed.length) throw new Error('没有识别到规格，请按「规格名 价格」一行一个粘贴');
    const existing = C.list(draft.skus);
    const added = cleanSkuRows([
      ...parsed.map((row, index) => ({
        key: `paste-${Date.now()}-${index}`, name: row.name, price: row.price,
        added: true, origin: row.name,
      })),
      ...existing,
    ]).slice(0, 600);
    const next = await editorStore.save(itemId, detail.product?.id, { skus: added });
    return { ok: true, draft: next, added: parsed.length, duplicates: C.duplicateSkuNames(next.skus) };
  }

  /**
   * 规格名整理 / 对齐（老软件 sku-match-ai 的确定性版）：
   *   action=preview：返回「原名 → 清理后」对照，不落盘；
   *   action=apply  ：把清理后的名字写进草稿；可选 templateNames 做一次对齐（给出分数与未命中）。
   */
  async function editorSkuMatch(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const draft = (await editorStore.ensure(itemId, detail)).draft;
    const rows = C.list(draft.skus);
    const names = rows.map(r => C.str(r.name));
    const cleaned = cleanSkuNames(names);
    const templateNames = C.strList(input.templateNames);
    const matched = templateNames.length ? matchToTemplate(names, templateNames) : null;
    const preview = rows.map((row, index) => ({
      key: C.str(row.key), before: names[index], after: cleaned[index] || names[index],
    }));
    const changed = preview.filter(row => row.before !== row.after).length;
    if (input.action !== 'apply') {
      return { ok: true, preview, changed, matched, applied: false };
    }
    const next = rows.map((row, index) => ({ ...row, name: cleaned[index] || row.name }));
    const saved = await editorStore.save(itemId, detail.product?.id, { skus: cleanSkuRows(next), specEdited: true });
    return { ok: true, draft: saved, changed, matched, applied: true, message: `已整理 ${changed} 条规格名` };
  }

  /**
   * 模板里的宣传规格 → 规格行（用户 2026-11-21：SKU 模板必须从已保存的模板里选，
   * 没配模板就明确报错，绝不偷偷塞一套默认宣传语）。
   * 价格优先用模板自己的，没有就沿用第一个真实规格的价格。
   */
  function templateSkuRows(tpl, firstRealSku) {
    const base = firstRealSku || {};
    return C.list(tpl?.skus).map((row, index) => {
      const name = `${C.str(row?.name)}${C.str(row?.suffix)}`.trim().slice(0, 128);
      const price = C.str(row?.price) || C.str(base.price) || '';
      return {
        key: `tpl-${Date.now().toString(36)}-${index}`,
        name,
        price,
        stock: C.str(row?.stock) || '1000',
        image: C.str(row?.image),
        template: true,
        added: true,
        sourceSkuId: C.str(base.sourceSkuId || base.key || ''),
        originalName: '',
        originalPrice: price,
      };
    }).filter(row => row.name);
  }

  /** SKU 模板：按选中的模板把宣传规格插到最上面。 */
  async function editorSkuTemplate(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const draft = (await editorStore.ensure(itemId, detail)).draft;
    const firstReal = C.list(draft.skus).find(s => !s.template && !s.removed);
    let templateRows = [];
    let templateName = '';
    if (input.templateId) {
      const tpl = (await repo.listTemplates('sku')).find(t => C.int(t.id) === C.int(input.templateId));
      if (!tpl) throw Object.assign(new Error('模板不存在或已删除，请刷新后重试'), { code: 'TEMPLATE_NOT_FOUND' });
      templateRows = templateSkuRows(tpl, firstReal || detail.skus?.[0]);
      templateName = tpl.name;
    } else {
      const names = C.strList(input.names);
      if (!names.length) {
        throw Object.assign(new Error('请先选择一个 SKU 模板；还没有模板就到上品库「图片模板」里新建'), { code: 'NO_TEMPLATE' });
      }
      templateRows = C.buildTemplateRows(names, firstReal || detail.skus?.[0]);
    }
    if (!templateRows.length) throw new Error('这个模板里没有可插入的宣传规格');
    const next = await editorStore.save(itemId, detail.product?.id, {
      skus: cleanSkuRows([...templateRows, ...C.list(draft.skus)]).slice(0, 600),
    });
    return { ok: true, draft: next, added: templateRows.length, templateName };
  }

  /**
   * 上架设置里选的模板（用户 2026-11-21）：给本批草稿补 SKU 宣传规格 / 详情页固定图。
   * 已有同名规格、同一张详情图都不重复加；模板被删了就只记一行日志，不拦上架。
   */
  async function applyBatchTemplates(draft, cfg, log, label) {
    const next = { ...draft, skus: C.list(draft.skus), detailImages: C.list(draft.detailImages) };
    if (cfg?.skuTemplateId) {
      const tpl = (await repo.listTemplates('sku')).find(t => C.int(t.id) === C.int(cfg.skuTemplateId));
      if (!tpl) {
        await log(`${label} SKU 模板已不存在（#${cfg.skuTemplateId}），本批跳过`);
      } else {
        const firstReal = next.skus.find(row => !row.removed && !row.template);
        const rows = templateSkuRows(tpl, firstReal);
        const exists = new Set(next.skus.map(row => C.str(row.name).trim()));
        const fresh = rows.filter(row => !exists.has(row.name));
        if (fresh.length) {
          next.skus = cleanSkuRows([...fresh, ...next.skus]).slice(0, 600);
          await log(`${label} 已套用 SKU 模板「${tpl.name}」：新增 ${fresh.length} 条宣传规格`, { poolItemId: draft.itemId, code: 'SKU_TEMPLATE' });
        } else {
          await log(`${label} SKU 模板「${tpl.name}」的宣传规格都已在规格表里，跳过`);
        }
      }
    }
    if (cfg?.detailTemplateId) {
      const tpl = (await repo.listTemplates('detail')).find(t => C.int(t.id) === C.int(cfg.detailTemplateId));
      if (!tpl) {
        await log(`${label} 详情页模板已不存在（#${cfg.detailTemplateId}），本批跳过`);
      } else {
        const images = C.strList(tpl.images);
        const fresh = images.filter(url => !next.detailImages.includes(url));
        if (fresh.length) {
          next.detailImages = [...fresh, ...next.detailImages].slice(0, 40);
          await log(`${label} 已套用详情页模板「${tpl.name}」：插入 ${fresh.length} 张`, { poolItemId: draft.itemId, code: 'DETAIL_TEMPLATE' });
        } else {
          await log(`${label} 详情页模板「${tpl.name}」的图都已在详情页里，跳过`);
        }
      }
    }
    return next;
  }

  /** 编码提交：把主图/第5张/SKU 编码记入绑定；SKU 编码里的图尝试插进规格表。 */
  async function editorCodes(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const which = ['main', 'fifth', 'sku'].includes(input.which) ? input.which : 'main';
    const value = C.str(input.value).trim().slice(0, 200);
    const field = which === 'main' ? 'mainCode' : which === 'fifth' ? 'fifthCode' : 'skuCode';
    const patch = { [field]: value };
    if (which === 'sku' && value) {
      const codes = splitCodes(value);
      const draft = (await editorStore.ensure(itemId, detail)).draft;
      const inserted = cleanSkuRows([
        ...codes.map((code, index) => ({
          key: `code-${Date.now()}-${index}`, name: `SKU 图 · #${code}`,
          price: '', added: true, origin: code, image: '',
        })),
        ...C.list(draft.skus),
      ]).slice(0, 600);
      patch.skus = inserted;
    }
    const next = await editorStore.save(itemId, detail.product?.id, patch);
    return {
      ok: true, draft: next, field, value,
      // 本机没有作图服务，明确告知而不是谎报"已读取作图成品"
      drawingHint: which === 'sku'
        ? '编码已记入本机草稿；作图成品需接入作图服务后读取'
        : '编码已保存；作图成品需接入作图服务后读取',
    };
  }

  /** 图位换图 / 拖动排序（老软件 orders / replaced）。 */
  async function editorImageOrder(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const group = ['square', 'squareSrc', 'tall'].includes(input.group) ? input.group : 'square';
    const draft = (await editorStore.ensure(itemId, detail)).draft;
    const orders = { ...(draft.orders || {}) };
    const list = C.strList(input.order).slice(0, 30);
    if (list.length) orders[group] = list; else delete orders[group];
    const next = await editorStore.save(itemId, detail.product?.id, { orders });
    return { ok: true, draft: next };
  }

  /**
   * 图位换图（老软件 orders / replaced）。
   * 用户 2026-11-11 第十次反馈：「老软件里的图片可以做到替换、拖动位置、单张图换编码的图，
   * 你 REA 解析老软件的时候没解析全」——这里补齐三种换图来源：
   *   src:   https 图片地址直接换
   *   code:  粘贴 AI作图 编码 → 按编码取成品图（第 index 张）落到本机再换
   *   local: 本机图片（编辑器「本机图片」按钮选出来的绝对路径）
   * 存法：replaced[group][key] = 'https://…' | 'local:<绝对路径>'，渲染层按替换表覆盖原图。
   */
  async function editorReplaceImage(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const group = ['square', 'squareSrc', 'tall', 'sku', 'detail'].includes(input.group) ? input.group : 'square';
    const key = C.str(input.key).slice(0, 400);
    if (!key) throw new Error('缺少图位编号');
    const draft = (await editorStore.ensure(itemId, detail)).draft;
    const replaced = { ...(draft.replaced || {}) };
    const bucket = { ...(replaced[group] || {}) };
    // 清空某个图位的替换（恢复采集/作图原图）
    if (input.clear === true) {
      delete bucket[key];
      replaced[group] = bucket;
      const patch = { replaced };
      if (input.index !== undefined && input.index !== null && input.index !== '') {
        const index = Math.max(0, Math.min(4, Number(input.index) || 0));
        const slots = { ...(draft.slotImages || {}) };
        const baseOf = {
          square: C.strList(draft.squareAiImages),
          squareSrc: C.strList(detail.images),
          tall: C.list(draft.tallAiImages).length ? C.strList(draft.tallAiImages) : C.strList(draft.tallSrcImages),
        };
        const base = (baseOf[group] || []).slice(0, 5);
        const current = C.list(slots[group]).length ? [...C.list(slots[group])] : [...base];
        while (current.length < 5) current.push(base[current.length] || '');
        // 「还原这张」= 回到采集/作图原本那一位的图（不是清空成空位）
        current[index] = base[index] || '';
        slots[group] = current.slice(0, 5);
        patch.slotImages = slots;
      }
      const next = await editorStore.save(itemId, detail.product?.id, patch);
      return { ok: true, draft: next, cleared: true };
    }
    let value = '';
    let preview = '';
    const code = C.str(input.code).trim().slice(0, 40);
    if (code) {
      const index = Math.max(0, Math.min(9, Number(input.pick) || 0));
      const fetched = await drawingClient.fetchByCode(code);
      const pool = group === 'tall' ? [...C.list(fetched.tall), ...C.list(fetched.square)]
        : [...C.list(fetched.square), ...C.list(fetched.tall), ...C.list(fetched.other)];
      const picked = pool[index] || pool[0];
      if (!picked) throw new Error(`编码 #${code} 没有取到图片（作图任务可能还没出图）`);
      value = `local:${picked}`;
      preview = await imageDataUrl(require('node:path').join(ctx.dataDir || '', ...C.str(picked).replace(/\\/g, '/').split('/')));
    } else if (C.str(input.local).trim()) {
      const abs = C.str(input.local).trim();
      if (!require('node:path').isAbsolute(abs)) throw new Error('本机图片路径不合法');
      value = `local:${abs}`;
      preview = await imageDataUrl(abs);
    } else {
      const src = C.str(input.src).trim().slice(0, 800);
      if (!/^https:\/\/\S+$/i.test(src)) throw new Error('图片来源不合法（只接受 https 图片地址、作图编码或本机图片）');
      value = src;
      preview = src;
    }
    if (value.startsWith('local:')) bucket[key] = value;
    else bucket[key] = value;
    replaced[group] = bucket;
    // 图位级写入：拖动排序 / 单张换图都直接改 slotImages（渲染层读它，不再只存不画）。
    const patch = { replaced };
    if (input.index !== undefined && input.index !== null && input.index !== '') {
      const index = Math.max(0, Math.min(4, Number(input.index) || 0));
      const slots = { ...(draft.slotImages || {}) };
      // 图位数组按「下标」对齐：先把这一组的基线图铺满 5 个位置，再改指定那一位，
      // 否则「只换第 3 张」会因为没有前面的位置而挤到第 1 张（用户 2026-11-11）。
      const baseOf = {
        square: C.strList(draft.squareAiImages),
        squareSrc: C.strList(detail.images),
        tall: C.list(draft.tallAiImages).length ? C.strList(draft.tallAiImages) : C.strList(draft.tallSrcImages),
      };
      const base = (baseOf[group] || []).slice(0, 5);
      const current = C.list(slots[group]).length ? [...C.list(slots[group])] : [...base];
      while (current.length < 5) current.push(base[current.length] || '');
      current[index] = value;
      slots[group] = current.slice(0, 5);
      patch.slotImages = slots;
    }
    const next = await editorStore.save(itemId, detail.product?.id, patch);
    return { ok: true, draft: next, preview, value, group, key, index: input.index };
  }

  /** 编辑器「本机图片」：选一张本机图片，复制进本机素材目录，返回可换到图位的绝对路径。 */
  async function editorPickImage(input = {}) {
    if (!dialog?.showOpenDialog) throw new Error('当前环境无法选择本机图片');
    const picked = await dialog.showOpenDialog({
      title: '选择本机图片（jpg / png / webp）',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (picked?.canceled || !picked.filePaths?.[0]) return { ok: false, canceled: true };
    const source = picked.filePaths[0];
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const crypto = require('node:crypto');
    const bytes = await fs.readFile(source);
    if (bytes.length > 16 * 1024 * 1024) throw new Error('图片超过 16MB，请先压缩');
    const digest = crypto.createHash('sha1').update(bytes).digest('hex');
    const ext = (path.extname(source) || '.png').toLowerCase();
    const dir = path.join(ctx.dataDir || '', 'selectionpool', 'media');
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${digest}${ext}`);
    await fs.writeFile(target, bytes).catch(() => undefined);
    const preview = await imageDataUrl(target);
    if (input.group) {
      const result = await editorReplaceImage({
        itemId: input.itemId, group: input.group, key: input.key, local: target, index: input.index,
      });
      return { ...result, localPath: target, preview: preview || result.preview, fromLocal: true };
    }
    return { ok: true, localPath: target, preview };
  }

  // ---- 编辑器：详情图 / 参数 / 类目 / 素材来源 / 视频 / 规格增删 / 回填目标 ----

  /** 详情图动作：移动、删除、编码、恢复采集图、模板。本机最多 40 张（老软件 Rd 上限）。 */
  async function editorDetail(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const draft = (await editorStore.ensure(itemId, detail)).draft;
    const action = C.str(input.action);
    let images = C.strList(draft.detailImages).slice(0, 40);
    let sources = { ...(draft.detailImageSources || {}) };
    const collected = C.strList(detail.description?.images).slice(0, 40);
    let message = '';

    if (action === 'move') {
      const from = Number(input.from), to = Number(input.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= images.length || to < 0 || to >= images.length) {
        throw new Error('图片位置不对');
      }
      const oldSources = { ...(draft.detailImageSources || {}) };
      const tagged = images.map((url, i) => ({ url, source: oldSources[String(i)] || 'collect' }));
      const [moved] = tagged.splice(from, 1);
      tagged.splice(to, 0, moved);
      images = tagged.map(t => t.url);
      sources = Object.fromEntries(tagged.map((t, i) => [String(i), t.source]));
      message = '已调整详情图顺序';
    } else if (action === 'remove') {
      const index = Number(input.index);
      if (!Number.isInteger(index) || index < 0 || index >= images.length) throw new Error('图片位置不对');
      images.splice(index, 1);
      sources = Object.fromEntries(images.map((_, i) => [String(i), 'collect']));
      message = '已删除这张详情图';
    } else if (action === 'code') {
      const code = C.str(input.value).trim().slice(0, 200);
      message = code ? `详情页编码 #${code} 已记入本机草稿；作图成品需接入作图服务后读取` : '已清空详情页编码';
      const next = await editorStore.save(itemId, detail.product?.id, { detailCode: code, detailEdited: true });
      return { ok: true, draft: next, message };
    } else if (action === 'restore') {
      images = collected;
      sources = Object.fromEntries(collected.map((_, i) => [String(i), 'collect']));
      message = '已换回采集的详情图';
    } else if (action === 'template') {
      // 模板插到最前面（老软件：已在详情页里的图不重复插）
      const names = C.strList(input.images);
      const fresh = names.filter(url => !images.includes(url));
      images = [...fresh, ...images].slice(0, 40);
      sources = Object.fromEntries(images.map((_, i) => [String(i), i < fresh.length ? 'drawing' : 'collect']));
      message = fresh.length ? `已把 ${fresh.length} 张模板图插到详情页最前面` : '模板里的图都已在详情页，没有重复插入';
    } else {
      throw new Error('未知的详情图操作');
    }
    const next = await editorStore.save(itemId, detail.product?.id, {
      detailImages: images, detailImageSources: sources, detailEdited: true,
    });
    return { ok: true, draft: next, message, images, sources };
  }

  /** 参数：增加 / 删除 / 改值（改过的项上架时照抄，不再由 AI 处理）。 */
  async function editorParam(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const draft = (await editorStore.ensure(itemId, detail)).draft;
    const attrs = [...C.list(draft.attrs)];
    const action = C.str(input.action);
    if (action === 'add') {
      if (attrs.length >= 200) throw new Error('参数最多 200 项');
      attrs.push({ name: C.str(input.name).slice(0, 120) || '新参数', value: C.str(input.value).slice(0, 500), locked: false, ui: 'input' });
    } else if (action === 'remove') {
      const index = Number(input.index);
      if (!Number.isInteger(index) || index < 0 || index >= attrs.length) throw new Error('参数位置不对');
      attrs.splice(index, 1);
    } else if (action === 'value') {
      const index = Number(input.index);
      if (!Number.isInteger(index) || index < 0 || index >= attrs.length) throw new Error('参数位置不对');
      if (attrs[index].locked) throw new Error('这项参数已锁定，不能修改');
      attrs[index] = { ...attrs[index], value: C.str(input.value).slice(0, 500) };
    } else throw new Error('未知的参数操作');
    const next = await editorStore.save(itemId, detail.product?.id, { attrs, paramEdits: Math.max(0, C.int(draft.paramEdits)) + 1 });
    return { ok: true, draft: next };
  }

  /** 修改类目 / 恢复采集类目。 */
  async function editorCategory(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const action = C.str(input.action);
    const patch = action === 'restore'
      ? { categoryId: C.str(detail.categoryId), categoryPath: C.str(detail.categoryPath), categoryCustom: false }
      : { categoryId: C.str(input.categoryId).slice(0, 60), categoryPath: C.str(input.categoryPath).slice(0, 300), categoryCustom: true };
    const next = await editorStore.save(itemId, detail.product?.id, patch);
    return { ok: true, draft: next, message: action === 'restore' ? '已恢复采集类目' : '类目已改，上架时按这个类目填' };
  }

  /** 素材图来源（透明图 / 白底图各自可本机上传或填编码）。 */
  async function editorMaterialSource(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const which = input.which === 'white' ? 'white' : 'trans';
    const source = ['auto', 'local', 'code'].includes(input.source) ? input.source : 'auto';
    const patch = which === 'white' ? { whiteSource: source } : { transSource: source };
    if (source === 'code' && input.value) patch[which === 'white' ? 'whiteCode' : 'transCode'] = C.str(input.value).slice(0, 200);
    if (source !== 'auto') patch.materialsCustom = true;
    const next = await editorStore.save(itemId, detail.product?.id, patch);
    return { ok: true, draft: next, message: source === 'auto' ? '已改回上架时自动生成' : '素材图来源已记入本机草稿' };
  }

  /** 视频：本机上传（记路径）/ 从店铺视频库选（需服务市场接口，明确标注）/ 删除。 */
  async function editorVideo(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const draft = (await editorStore.ensure(itemId, detail)).draft;
    const action = C.str(input.action);
    let videos = C.list(draft.videos).slice(0, 5);
    let message = '';
    if (action === 'addLocal') {
      const file = C.str(input.file);
      if (!/\.(mp4|mov|mkv)$/i.test(file)) return { ok: false, code: 'INVALID_VIDEO', message: '只支持 mp4 / mov / mkv 视频文件' };
      videos.push({ kind: 'local', file, name: C.str(input.name).slice(0, 120) || file.split(/[\\/]/).pop(), type: ['宝贝讲解', '真人试吃', '宝贝展示', '制作教程'].includes(input.type) ? input.type : '宝贝展示', ratio: ['1:1', '3:4', '9:16'].includes(input.ratio) ? input.ratio : '', duration: 0 });
      message = '本机视频已加入；入仓后回填时挂到仓库商品上';
    } else if (action === 'addLibrary') {
      // 老软件走「从店铺视频库选」弹窗（pmv-*），依赖服务市场接口；本机未接凭证时如实告知。
      return { ok: false, code: 'NOT_CONFIGURED', message: '从店铺视频库选需要淘宝开放平台 / 服务市场接口，凭证到位后接入；当前可先用「本机上传」' };
    } else if (action === 'remove') {
      const index = Number(input.index);
      if (!Number.isInteger(index) || index < 0 || index >= videos.length) throw new Error('视频位置不对');
      videos.splice(index, 1);
      message = '已移除这个视频';
    } else throw new Error('未知的视频操作');
    const next = await editorStore.save(itemId, detail.product?.id, { videos });
    return { ok: true, draft: next, message };
  }

  /** 规格表：增加一条 / 去掉宣传规格 / 单品-信息说明切换。 */
  async function editorSkuAdd(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const draft = (await editorStore.ensure(itemId, detail)).draft;
    const skus = [...C.list(draft.skus)];
    if (skus.length >= 600) throw new Error('规格最多 600 条');
    skus.push({ key: `add-${Date.now()}`, name: C.str(input.name).slice(0, 128) || '新规格', price: '', stock: '1000', added: true });
    const next = await editorStore.save(itemId, detail.product?.id, { skus, specEdited: true });
    return { ok: true, draft: next, duplicates: C.duplicateSkuNames(next.skus) };
  }

  async function editorSkuRemoveTemplates(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const draft = (await editorStore.ensure(itemId, detail)).draft;
    const skus = C.list(draft.skus).filter(s => !s.template);
    const next = await editorStore.save(itemId, detail.product?.id, { skus, specEdited: true });
    return { ok: true, draft: next, removed: C.list(draft.skus).length - skus.length };
  }

  /**
   * 回填目标：每个店铺最近一次入仓的仓库商品 + 图位级回读状态。
   * 数据来自本机上架记录（shelf-records），不连 SaaS。
   */
  async function editorBackfillTargets(input = {}) {
    const itemId = C.int(input.itemId);
    // editorLoad 已经把 detail / draft 读出来了：直接复用，避免同一个 228KB 的
    // items.json 与 189KB 的 editor-drafts.json 在一次打开里各读两遍（用户反馈读取慢）。
    const detail = input.detail || await repo.detail(itemId);
    const draft = input.draft || (await editorStore.ensure(itemId, detail)).draft;
    const records = await repo.listShelfRecords();
    const byShop = new Map();
    for (const r of C.list(records)) {
      const key = C.str(r.shopId) || C.str(r.shopName) || 'default';
      const prev = byShop.get(key);
      if (!prev || C.str(r.at) > C.str(prev.at)) byShop.set(key, r);
    }
    const slots = C.list(draft.slotsForReadback);
    const readback = {
      square: `${slots.filter(s => s.kind === 'main' && s.state === 'filled').length}/${slots.filter(s => s.kind === 'main').length || 5}`,
      tall: '5/5', transparent: draft.transMode === 'auto' ? '自动生成' : '已指定',
      white: draft.whiteMode === 'custom' ? '已指定' : '自动生成',
    };
    const targets = [...byShop.values()].map(r => ({
      warehouseItemId: C.str(r.warehouseItemId), shopName: C.str(r.shopName) || C.str(detail.product?.shopName),
      shopId: C.str(r.shopId), at: C.str(r.at),
      status: C.str(r.status) === 'success' ? 'landed' : 'unknown',
      readback,
      filled: C.list(records).some(x => C.str(x.warehouseItemId) === C.str(r.warehouseItemId) && C.str(x.status) === 'filled'),
    }));
    const selected = C.strList(draft.selectedTargets);
    return {
      ok: true, targets, selected,
      historical: C.list(records).slice(-20).reverse().map(r => ({
        warehouseItemId: C.str(r.warehouseItemId), shopName: C.str(r.shopName), at: C.str(r.at),
      })),
    };
  }

  async function editorSelectTargets(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const selected = [...new Set(C.strList(input.selected).map(v => v.slice(0, 64)))].slice(0, 40);
    const next = await editorStore.save(itemId, detail.product?.id, { selectedTargets: selected });
    return { ok: true, draft: next, selected };
  }

  // ---------------------------------------------------------------- AI作图 成品回流
  /** 把本机成品图缩成 data URL 供编辑器缩略图使用（失败不影响主流程）。 */
  async function buildThumbnails(files, nativeImage) {
    const out = { square: [], tall: [], other: [] };
    const fs = require('node:fs/promises');
    if (!nativeImage?.createFromBuffer) return out;
    for (const f of C.list(files)) {
      if (!f.ok || !f.absolutePath) continue;
      const bucket = f.ratio === '1:1' ? 'square' : f.ratio === '3:4' ? 'tall' : 'other';
      try {
        const bytes = await fs.readFile(f.absolutePath);
        const image = nativeImage.createFromBuffer(bytes);
        const size = image.getSize();
        const scale = Math.min(1, 200 / Math.max(size.width || 200, size.height || 200));
        const thumb = scale < 1
          ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) })
          : image;
        out[bucket].push({ path: f.path, dataUrl: thumb.toDataURL(), width: size.width, height: size.height });
      } catch { /* 单张缩略图失败不影响其它图 */ }
    }
    return out;
  }

  /**
   * 按编码读取作图成品 → 落本机 → 写进编辑器草稿。
   * 这是「插件/AI作图 → 上品库」链路的最后一环，让编码回车后真正显示成品。
   */
  async function editorLoadDrawing(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    const draft = (await editorStore.ensure(itemId, detail)).draft;
    const code = C.trimmed(input.code);
    const which = ['main', 'fifth', 'sku', 'detail'].includes(input.which) ? input.which : 'main';
    let task;
    let usedCode = code;
    if (code) {
      task = await drawingClient.lookup(code);
    } else {
      const matches = await drawingClient.findByProduct(detail.product?.id, 5);
      const first = C.list(matches).find(m => /^\d+$/.test(C.str(m.orderNo))) || C.list(matches)[0];
      if (!first) {
        return { ok: false, code: 'NO_DRAWING_TASK', message: 'AI作图 里没有找到这个商品的作图任务，可先提交作图或粘贴编码' };
      }
      usedCode = C.str(first.orderNo || first.taskId);
      task = await drawingClient.lookup(usedCode);
    }
    const fetched = await drawingClient.fetchByCode(usedCode);
    // 图片路径是本机相对路径，渲染层不能直接 <img src>，通过自定义协议或 file 路径读取。
    // 这里把绝对路径也回传，供渲染层用 pathForFile / 自定义 URL 显示。
    const patch = { [which === 'fifth' ? 'fifthCode' : which === 'sku' ? 'skuCode' : which === 'detail' ? 'detailCode' : 'mainCode']: usedCode };
    if (which === 'main' || which === 'fifth') {
      patch.squareAiImages = fetched.square;
      patch.tallAiImages = fetched.tall;
    }
    if (which === 'sku') {
      patch.skuImages = C.list(fetched.skuItems).map(s => ({ name: C.str(s.label), src: '' })).slice(0, 100);
    }
    if (which === 'detail') {
      patch.detailImages = C.list(fetched.other).concat(C.list(fetched.square)).slice(0, 40);
      patch.detailEdited = true;
    }
    const next = await editorStore.save(itemId, detail.product?.id, patch);
    // 编辑器里要显示成品缩略图：本机相对路径渲染层不能直接 <img src>，
    // 由主进程用 nativeImage 缩到 200px 转 data URL（CSP 允许 img-src data:），原图仍留本机供上架。
    const thumbs = await buildThumbnails(fetched.files, ctx.nativeImage);
    return {
      ok: true, code: usedCode, which, draft: next,
      task: fetched.task, square: fetched.square, tall: fetched.tall,
      squareThumbs: thumbs.square, tallThumbs: thumbs.tall, otherThumbs: thumbs.other,
      readback: fetched.readback, files: fetched.files,
      message: `已读取作图编码 #${usedCode}：1:1 主图 ${fetched.square.length} 张 · 3:4 主图 ${fetched.tall.length} 张（回读 ${fetched.readback.saved}/${fetched.readback.planned}）`,
    };
  }

  async function editorDrawingStatus() {
    return drawingClient.readiness();
  }

  async function editorFindDrawing(input = {}) {
    const itemId = C.int(input.itemId);
    const detail = await repo.detail(itemId);
    return { ok: true, tasks: await drawingClient.findByProduct(detail.product?.id, input.limit || 5) };
  }

  // ---------------------------------------------------------------- 页面初始数据
  async function load(payload = {}) {
    const [state, shopStates, api, ingest, queue, manualFix, publicationReport, autoShelfConfig, resumeTasks, categoryLookup] = await Promise.all([
      repo.list({ page: 1, size: 50, ...payload }),
      shopSession.listShopStates(),
      taobaoApi.readiness(),
      Promise.resolve(ingestStatus()),
      publication.queue(),
      repo.listManualFix(),
      publication.report({ tab: 'failures', page: 1, size: 10 }),
      publication.config(),
      publication.resumeTasks(),
      categoryService.lookup({}),
    ]);
    return {
      ...state,
      // 「失败 N · 查看」与「累计上品成功 N」以每次上架尝试的记录为准，
      // 避免本地流程状态还没回写时统计对不上（老软件每次尝试单独计数）。
      stats: {
        ...(state.stats || {}),
        failed: Math.max(Number(state.stats?.failed) || 0, Number(publicationReport?.totals?.failed) || 0),
        publishSuccess: Math.max(Number(state.stats?.publishSuccess) || 0, Number(publicationReport?.totals?.success) || 0),
      },
      shopStates,
      api: { ...api, catalog: TAOBAO_API_CATALOG },
      ingest,
      queue,
      manualFix,
      publication: publicationReport,
      autoShelfConfig,
      resumeTasks,
      categoryIndex: { total: categoryLookup.total },
      categoryApi: categoryService.API_ENDPOINTS,
      publicationApi: publication.API_ENDPOINTS,
      // 页面级开关：真实平台写入是否已可用
      driverReady: Boolean(driver && typeof driver.publish === 'function'),
      storage: { kind: 'local', root: '用户数据/selectionpool/', note: '数据保存在本机用户数据目录' },
    };
  }

  // ---------------------------------------------------------------- AI作图插件
  /**
   * 安装插件（用户 2026-11-11 要求）：
   *   - chooseFolder=true：把最新版本下载/安装到用户指定的文件夹（「安装插件」按钮）
   *   - updateCurrent=true：把最新版本强制更新进当前插件文件夹（「更新现有文件夹」按钮，不弹选择框）
   *   - 传 dir：更新/接管指定目录
   */
  async function pluginInstall(input = {}) {
    let target = C.str(input.dir).trim();
    const force = input.updateCurrent === true || input.force === true;
    if (input.updateCurrent === true) {
      const st = await pluginManager.status();
      target = C.str(st?.installDir).trim();
      if (!target) throw new Error('还没有插件文件夹，请先点「安装插件」选一个文件夹');
    } else if (input.chooseFolder === true) {
      if (!dialog?.showOpenDialog) throw new Error('当前环境无法选择文件夹');
      const picked = await dialog.showOpenDialog({
        title: '选择插件安装文件夹（浏览器扩展页正在加载或准备加载的目录）',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked?.canceled || !picked?.filePaths?.[0]) throw new Error('已取消');
      target = picked.filePaths[0];
    }
    return pluginManager.install(target, { force });
  }
  const pluginStatus = () => pluginManager.status();
  const pluginCheck = (p = {}) => pluginManager.checkNow(p || {});
  const pluginOpenFolder = () => pluginManager.openFolder();
  const pluginVerify = () => pluginManager.verify();

  /** 手动指定 AI作图 插件目录（换电脑后路径变了时用）；chooseFolder 由主进程弹选择框。 */
  async function pluginSetSource(input = {}) {
    let target = C.str(input.dir).trim();
    if (input.chooseFolder === true) {
      if (!dialog?.showOpenDialog) throw new Error('当前环境无法选择文件夹');
      const picked = await dialog.showOpenDialog({
        title: '选择 AI作图 插件文件夹（里面有 manifest.json）',
        properties: ['openDirectory'],
      });
      if (picked?.canceled || !picked?.filePaths?.[0]) throw new Error('已取消');
      target = picked.filePaths[0];
    }
    return pluginManager.setSource(target);
  }

  // ---------------------------------------------------------------- AI作图 接口自动配对
  const drawingPairStatus = () => drawingPair.status();
  const drawingPairNow = input => drawingPair.pair(input || {});
  /** 选择 AI作图 目录后配对；允许选到上级目录（自动补 AI作图/ 与 config.json）。 */
  async function drawingPairChoose() {
    if (!dialog?.showOpenDialog) throw new Error('当前环境无法选择文件夹');
    const picked = await dialog.showOpenDialog({
      title: '选择 AI作图 程序目录（里面应有 config.json 与 server.mjs）',
      properties: ['openDirectory'],
    });
    if (picked?.canceled || !picked?.filePaths?.[0]) throw new Error('已取消');
    const base = picked.filePaths[0];
    const direct = path.join(base, 'config.json');
    const nested = path.join(base, 'AI作图', 'config.json');
    const exists = file => fs.access(file).then(() => true, () => false);
    const configPath = await exists(direct) ? direct : await exists(nested) ? nested : direct;
    return drawingPair.pair({ configPath });
  }

  // ---------------------------------------------------------------- 本机图片缓存
  /** 上架时把采集图下载到临时目录才能喂给发布页；这些文件随时能重下，属于可清理缓存。 */
  const IMAGE_CACHE_ROOT = path.join(require('node:os').tmpdir(), 'xx-images');
  async function scanLocalImages(limit = 60) {
    const out = { root: IMAGE_CACHE_ROOT, count: 0, bytes: 0, files: [] };
    async function walk(dir, depth) {
      let list = [];
      try { list = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of list) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (depth < 3) await walk(full, depth + 1); continue; }
        if (!/\.(jpe?g|png|webp)$/i.test(entry.name)) continue;
        try {
          const stat = await fs.stat(full);
          out.count += 1; out.bytes += stat.size;
          if (out.files.length < limit) out.files.push({ path: full, name: entry.name, bytes: stat.size, at: stat.mtimeMs });
        } catch { /* 单个文件失败跳过 */ }
      }
    }
    await walk(IMAGE_CACHE_ROOT, 0);
    out.files.sort((a, b) => b.at - a.at);
    return out;
  }
  async function clearLocalImages() {
    const before = await scanLocalImages(1);
    await fs.rm(IMAGE_CACHE_ROOT, { recursive: true, force: true }).catch(() => {});
    return { ok: true, removed: before.count, freed: before.bytes };
  }

  // ---------------------------------------------------------------- handle 分发
  const handlers = {
    load,
    list: p => repo.list(p || {}),
    detail: async p => {
      const detail = await repo.detail(p?.itemId);
      // 采集包没带中文类目路径时，用本机类目树/缓存按 ID 反查一次（老软件的「类目路径」一直有值）。
      if (!C.str(detail.categoryPath) && /^\d{2,16}$/.test(C.str(detail.categoryId))) {
        try {
          const resolved = await resolveCategory(detail, null);
          if (resolved.categoryPath) {
            return {
              ...detail,
              categoryPath: resolved.categoryPath,
              categoryLevels: resolved.categoryLevels.length ? resolved.categoryLevels : detail.categoryLevels,
            };
          }
        } catch { /* 反查失败保持原值 */ }
      }
      return detail;
    },
    ingest: p => repo.ingest(p || {}),
    update: p => repo.update(p?.itemId, p?.patch || {}, p?.version),
    remove: async p => {
      const result = await repo.remove(p?.itemIds || []);
      if (result.ok) await editorStore.remove(result.ids);
      return result;
    },
    exportCsv,
    // 店铺登录状态（用户要求：可直接读取已登录店铺的登录状态）
    shopStates: () => shopSession.listShopStates(),
    shopState: p => shopSession.getShopState(p?.storeId),
    openBackend: p => shopSession.openBackend(p?.storeId, p?.kind || 'seller'),
    // 流程与记录
    autoShelf,
    startAutoShelf: p => autoShelf({ ...(p || {}), background: true }),
    queueAppend: p => autoShelf({ ...(p || {}), background: true, append: true }),
    queueRemove: p => publication.queueRemove(p || {}),
    backfill,
    // 店铺页面人工补全参数（打开店铺发布页 → 回填 → 继续入仓）
    openShopPublishPage, openPublishWindow, saveManualParams, resumeManualShelf, dismissManualFix, manualFixStatus,
    shelfRecords: () => repo.listShelfRecords(),
    appendShelfRecord: p => repo.appendShelfRecord(p || {}),
    autoShelfLog: () => repo.listAutoShelfLog(),
    autoShelfRuns: () => repo.listAutoShelfRuns(),
    appendAutoShelfLog: p => repo.appendAutoShelfLog(p || {}),
    queueState: () => publication.queue(),
    queueStatus: () => publication.queue(),
    queueStop: async () => {
      // 先中断当前商品（销毁发布窗口），再落 stopRequested —— 顺序反了会出现
      // 「按钮变成正在停止，但商品还在跑」的空窗期。
      requestStop('已手动停止', 'manual', 'all');
      const state = await publication.queueStop();
      if (!activeQueueRunner) {
        // 没有执行中的批次（上次异常退出留下的 running=true）：直接把运行态收干净
        const recovered = await publication.recoverStopped();
        return recovered?.queue || state;
      }
      return state;
    },
    queueStopItem,
    setQueueState: p => publication.queuePatch(p || {}),
    // 上品记录 / 失败记录（点「失败 N · 查看」）
    // fallbackOperator：老记录里存成「本机」的，展示时用当前账号名字代替（不修改历史文件）
    publicationReport: p => publication.report({ ...(p || {}), fallbackOperator: operatorName() }),
    publicationDiagnostic: p => publication.report({ ...(p || {}), tab: 'failures', size: 50, fallbackOperator: operatorName() }),
    resumeTasks: () => publication.resumeTasks(),
    // 自动上架配置（目标店铺、放进仓库、上架价格、店铺分类、队列间隔）
    autoShelfConfig: () => publication.config(),
    saveAutoShelfConfig: p => publication.saveConfig(p || {}),
    // 类目：按商品 ID 重读、类目树逐层、路径/搜索、保存叶子类目
    categoryReadSource: p => categoryService.readSource(p || {}),
    categoryChildren: p => categoryService.children(p || {}),
    categoryLookup: p => categoryService.lookup(p || {}),
    categorySave: p => categoryService.save(p || {}),
    categoryParse: p => ({ ok: true, items: categoryService.parseChildren(p?.payload) }),
    // 店铺中分类（卖家自定义分类）：读取该店发布页「选择分类」里的选项
    shopCategories: p => categoryService.shopCategories(p || {}),
    uploadTasks: () => repo.listUploadTasks(),
    createUploadTasks: p => repo.createUploadTasks(p || {}),
    // 图片模板
    imageTemplates: p => repo.listTemplates(p?.kind),
    changeImageTemplate: p => repo.changeTemplate(p || {}),
    // 本机图片（上架时下载到临时目录的图，占空间且能随时重下）
    localImages: () => scanLocalImages(60),
    clearLocalImages: () => clearLocalImages(),
    // 商品图片工作台（编辑器）
    editorLoad, editorPatch, editorSave, editorRestore,
    editorReprice, editorPasteSkus, editorSkuTemplate, editorCodes,
    editorSkuMatch,
    editorImageOrder, editorReplaceImage, editorPickImage,
    editorDetail, editorParam, editorCategory, editorMaterialSource, editorVideo,
    editorSkuAdd, editorSkuRemoveTemplates, editorBackfillTargets, editorSelectTargets,
    editorLoadDrawing, editorDrawingStatus, editorFindDrawing,
    // 图片空间 / 回填接口状态（接口配置面板与编辑器底部都用它）
    pictureSpaceStatus: () => pictureSpace.readiness(),
    suggestionsPreview: async p => {
      const itemId = C.int(p?.itemId);
      const detail = await repo.detail(itemId);
      const draft = (await editorStore.ensure(itemId, detail)).draft;
      return { ok: true, hints: await suggestions.hintsFor(draft, detail) };
    },
    // 淘宝开放平台 API（凭证后续填）
    apiCatalog: () => TAOBAO_API_CATALOG,
    apiReadiness: () => taobaoApi.readiness(),
    apiConfig: () => repo.readApiConfig(),
    saveApiConfig: p => repo.saveApiConfig(p || {}),
    // AI作图 接口自动配对（换电脑后可一键重配）
    drawingPairStatus,
    drawingPair: drawingPairNow,
    drawingPairChoose,
    // AI作图插件 代管：状态/安装/接管/检查/打开/校验
    pluginStatus,
    pluginInstall,
    pluginSetSource,
    pluginCheck,
    pluginOpenFolder,
    pluginVerify,
    pluginDownloadZip: p => pluginManager.downloadZip(),
    apiCall: p => taobaoApi.call(C.str(p?.method), (p?.params && typeof p.params === 'object' ? p.params : {}), { session: p?.session !== false }),
    // 本地采集接收端点（手动开关）
    ingestStatus: () => ingestStatus(),
    startIngest: p => startIngestServer(C.int(p?.port) || 49220),
    stopIngest: () => stopIngestServer(),
    // 驱动注入（供后续接入 form-capture 引擎 / 官方 API 实现）
    hasDriver: () => Boolean(driver),
    setDriver: next => setDriver(next),
  };

  function handle(method, payload) {
    if (disposed) return Promise.reject(new Error('上品库功能正在关闭，请稍后重试'));
    const fn = handlers[method];
    if (typeof fn !== 'function') return Promise.reject(new Error(`上品库不支持此操作：${method}`));
    return Promise.resolve().then(() => fn(payload || {}));
  }

  function setDriver(next) { driver = next; return Boolean(driver); }

  async function dispose() {
    disposed = true;
    pluginManager.dispose();
    await stopIngestServer();
  }

  // 插件代更新：启动 1 分钟后检查一次，之后每 30 分钟一次（与老软件一致）。
  // 测试环境用 options.pluginAutoUpdate === false 关闭，避免定时器干扰断言。
  if (options.pluginAutoUpdate !== false) {
    try { pluginManager.start(); } catch { /* 定时器失败不影响主流程 */ }
  }

  // 本机接收：随工作台启动自动开启（只监听 127.0.0.1），插件不需要用户每次手动点「启用本地接收」。
  // 端口被占用时静默失败，用户仍可在「接口配置」里手动启用。
  if (options.autoIngest !== false) {
    void startIngestServer(C.int(options.ingestPort) || 49220).catch(() => undefined);
  }

  return { handle, dispose, setDriver, repository: repo, shopSession, taobaoApi, pluginManager };
}

module.exports = { createSelectionPoolService };
