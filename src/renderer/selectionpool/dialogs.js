'use strict';

/**
 * 上品库 · 复刻老软件选品池的四个弹窗
 *
 * REA 依据（beta.268 renderer/assets/index-BAFOuonK.js 与 main 模块）：
 *  ① 自动上架 / 上传到店铺：目标店铺多选、自动上架（放进仓库·不立即上架）、店铺分类、
 *     上架价格（同行价 × 倍数 减 金额）、蓝色提示、进度 N/M·成功·失败、深色执行日志、
 *     「没入仓、可以接着处理的任务」+ 打开店铺窗口 / 继续入仓、停止队列 / 后台运行 / 追加上架。
 *  ② 上品记录：累计成功/失败、总览 / 失败记录 Tab、搜索、失败卡片（已修复、失败码+原因、
 *     完整原因 / 复制排查信息）、分页；失败记录里也能手动打开店铺窗口继续处理。
 *  ③ 表单填写窗口：顶部编辑中/基线信息标签、左侧分节导航、右侧字段表单、右侧手机预览、
 *     底部取消 / 保存 / 打开店铺窗口 / 我已改好，继续。
 *  ④ 类目面板：类目路径 + ID + 采集、类目来源店铺、刷新、按名搜叶子类目、三级级联、
 *     「请选到最后一级（叶子类目）才能保存」+ 保存类目。
 *
 * 全部走新软件自己的 selectionpool.* 接口，不接老软件运行时、不出现老软件名称。
 */

(() => {
  const FORM_SECTIONS = [
    { id: 'basic', label: '基本信息 / 类目属性', required: true },
    { id: 'qualification', label: '商品资质', required: true },
    { id: 'spec', label: '规格与类目及规格', required: false },
    { id: 'desc', label: '图文描述', required: false },
    { id: 'sku', label: 'SKU 信息', required: false },
    { id: 'sales', label: '销售信息', required: false },
    { id: 'pay', label: '支付信息', required: false },
    { id: 'logistics', label: '物流与售后', required: false },
  ];

  function create(deps) {
    const { api, esc, svg, toast, render: hostRender, state, data, reload, openShopPage, registerManualFixes, button, navigate } = deps;

    /**
     * 日志滚动位置（用户 2026-11-24）：
     *  - 整页重绘会换掉 DOM，滚动条跳回顶部 → 重绘前后记住并恢复；
     *  - 在底部时新日志自动跟到最新；用户自己往上翻过就保持原位置，不再被拉回底部。
     * 重绘来源不止本模块（顶部进度事件也会重绘整页），所以除了包 render 之外，
     * 再挂一个 MutationObserver：日志节点一换就立刻恢复（在浏览器绘制前，用户看不到跳动）。
     */
    let logView = { top: 0, atBottom: true, has: false };
    let logNode = null;
    function bindLogNode(el) {
      if (!el || el.dataset.followBound) return;
      el.dataset.followBound = '1';
      const stopFollow = () => { ui.progress.autoFollow = false; };
      el.addEventListener('wheel', stopFollow, { passive: true });
      el.addEventListener('touchstart', stopFollow, { passive: true });
      el.addEventListener('scroll', () => {
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
        if (!atBottom) ui.progress.autoFollow = false;
        logView = { top: el.scrollTop, atBottom, has: true };
      }, { passive: true });
    }
    function restoreLogScroll() {
      if (ui.name !== 'queueProgress' && ui.name !== 'autoShelf') return;
      const allBox = document.querySelector('[data-queue-select-all]');
      if (allBox) allBox.indeterminate = allBox.dataset.indeterminate === '1';
      const el = document.querySelector('[data-spx-log]');
      if (!el) { logNode = null; return; }
      bindLogNode(el);
      if (el !== logNode) {
        logNode = el;
        if (ui.progress.autoFollow) el.scrollTop = el.scrollHeight;
        else if (logView.has) el.scrollTop = logView.atBottom ? el.scrollHeight : logView.top;
        return;
      }
      if (ui.progress.autoFollow) el.scrollTop = el.scrollHeight;
    }
    function captureLogScroll() {
      const el = document.querySelector('[data-spx-log]');
      if (!el) { logView = { top: 0, atBottom: true, has: false }; return; }
      logView = {
        top: el.scrollTop,
        atBottom: el.scrollHeight - el.scrollTop - el.clientHeight <= 24,
        has: true,
      };
    }
    function render() {
      captureLogScroll();
      hostRender();
      restoreLogScroll();
    }

    // 详情缓存：同一件商品 2 分钟内再打开直接用（老软件也是缓存后秒开）
    const detailCache = new Map();

    const ui = {
      name: '', busy: false, message: '', messageTone: 'info',
      shelf: { itemIds: [], shops: new Set(), config: null, queue: null, pickKeyword: '', shopCats: {}, shopCatState: {}, shopcatOpen: '', templates: { sku: [], detail: [] }, showTips: false },
      progress: { queue: null, logs: [], resume: null, logAll: false, autoFollow: false, selectedQueueIds: new Set() },
      pub: { tab: 'failures', keyword: '', page: 1, size: 6, data: null, expanded: '', resume: null, shelfRecords: [], itemId: 0 },
      form: { itemId: 0, detail: null, section: 'basic', fields: [], categoryId: '', categoryPath: '', warehouseItemId: '', message: '' },
      detail: { itemId: 0, tab: 'overview', data: null, busy: false, error: '', imageIndex: 0 },
      cat: { itemId: 0, profileId: '', keyword: '', levels: [[], [], []], ids: ['', '', ''], picked: null, hits: [], busy: false, message: '', productId: '', personal: null },
      logs: { runs: [], runId: '', busy: false, error: '' },
    };

    try {
      const observer = new MutationObserver(() => restoreLogScroll());
      observer.observe(document.body, { childList: true, subtree: true });
    } catch { /* 老环境没有 MutationObserver */ }
    window.setInterval(() => { if (ui.name === 'queueProgress') restoreLogScroll(); }, 500);

    const shops = () => (data().shopStates?.stores || []);
    const loggedIn = () => (data().shopStates?.loggedIn || []);
    const queue = () => ui.progress.queue || ui.shelf.queue || data().queue || {};
    const resume = () => ui.progress.resume || ui.pub.resume || data().resumeTasks || { items: [], note: '', tail: '' };
    const pub = () => ui.pub.data || data().publication || { rows: [], totals: { success: 0, failed: 0 }, total: 0, page: 1, pages: 1 };
    const cfg = () => ui.shelf.config || data().autoShelfConfig || {};

    const short = (value, n = 30) => {
      const t = String(value || '');
      return t.length > n ? `${t.slice(0, n)}…` : t;
    };
    const time = value => {
      const text = String(value || '');
      if (!text) return '—';
      const d = new Date(text);
      if (Number.isNaN(d.getTime())) return text.slice(0, 19);
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    const elapsed = startedAt => {
      if (!startedAt) return '0 秒';
      const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
      if (seconds < 60) return `${seconds} 秒`;
      return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
    };
    const setDialogMessage = (text, isError = false) => {
      ui.message = String(text || '');
      ui.messageTone = isError ? 'error' : 'info';
      render();
    };

    // ---------------------------------------------------------------- 数据加载
    async function refreshShelf() {
      const [q, config, templates] = await Promise.all([
        api('selectionpool.queueStatus', {}).catch(() => null),
        api('selectionpool.autoShelfConfig', {}).catch(() => null),
        api('selectionpool.imageTemplates', {}).catch(() => []),
      ]);
      if (Array.isArray(templates)) {
        ui.shelf.templates = {
          sku: templates.filter(t => t.kind === 'sku'),
          detail: templates.filter(t => t.kind === 'detail'),
        };
      }
      if (q) {
        ui.shelf.queue = q;
        ui.progress.queue = q;
        if (data()) data().queue = q;
      }
      if (config) ui.shelf.config = config;
      if (!ui.shelf.shops.size) {
        for (const row of loggedIn()) ui.shelf.shops.add(row.storeId);
      }
      render();
      // 缓存里有就直接带出来；没有也不主动开窗口（等用户点「刷新」）
      void loadShelfCats();
    }

    /**
     * 店铺中分类（卖家自定义分类，用户 2026-11-21）：
     * 先读本机缓存（上面架过一次就有），点「刷新」才用店铺登录态开隐藏窗口读发布页。
     */
    let catLoading = false;
    async function loadShelfCats({ refresh = false, ids = [] } = {}) {
      const targets = (ids.length ? ids : [...ui.shelf.shops]).filter(Boolean);
      if (!targets.length) return;
      if (catLoading && !refresh) return;
      catLoading = true;
      let changed = false;
      try {
        for (const id of targets) {
          if (!refresh && (ui.shelf.shopCats[id] || []).length) continue;
          ui.shelf.shopCatState = { ...ui.shelf.shopCatState, [id]: { busy: true, error: '' } };
          changed = true;
          if (refresh) render();
          const res = await api('selectionpool.shopCategories', {
            storeId: id, refresh, cachedOnly: !refresh, itemId: ui.shelf.itemIds[0] || 0,
          }).catch(error => ({ ok: false, message: String(error?.message || error) }));
          const items = Array.isArray(res?.items) ? res.items : [];
          if (items.length) ui.shelf.shopCats = { ...ui.shelf.shopCats, [id]: items };
          ui.shelf.shopCatState = {
            ...ui.shelf.shopCatState,
            // 还没缓存过不算错误，面板里会提示点「刷新」，不用红字吓人
            [id]: { busy: false, error: res?.ok || res?.code === 'NO_CACHE' ? '' : (res?.message || '没读到这家店铺的「店铺中分类」') },
          };
        }
      } finally {
        catLoading = false;
        if (changed) render();
      }
    }

    async function refreshProgress() {
      const [q, logs, resumeTasks] = await Promise.all([
        api('selectionpool.queueStatus', {}).catch(() => null),
        api('selectionpool.autoShelfLog', {}).catch(() => []),
        api('selectionpool.resumeTasks', {}).catch(() => null),
      ]);
      if (q) {
        ui.progress.queue = q;
        ui.shelf.queue = q;
        if (data()) data().queue = q;
        pruneQueueSelection(q);
      }
      ui.progress.logs = Array.isArray(logs) ? logs.slice(-200) : [];
      if (resumeTasks) ui.progress.resume = resumeTasks;
      render();
    }

    async function refreshPublication() {
      const [report, tasks, shelfRecords] = await Promise.all([
        api('selectionpool.publicationReport', { tab: ui.pub.tab === 'operators' ? 'operators' : 'failures', keyword: ui.pub.keyword, page: ui.pub.page, size: ui.pub.size }).catch(() => null),
        api('selectionpool.resumeTasks', {}).catch(() => null),
        ui.pub.tab === 'records' ? api('selectionpool.shelfRecords', {}).catch(() => []) : Promise.resolve(null),
      ]);
      if (report) ui.pub.data = report;
      if (tasks) ui.pub.resume = tasks;
      if (Array.isArray(shelfRecords)) ui.pub.shelfRecords = shelfRecords;
      if (ui.pub.tab === 'logs') await refreshLogs();
      else render();
    }

    async function loadForm(itemId) {
      const detail = await api('selectionpool.detail', { itemId });
      const attributes = (detail?.attributes || detail?.listing?.attributes || []).map(a => ({ name: String(a.name || ''), value: String(a.value || '') }));
      ui.form = {
        itemId, detail, section: 'basic', attributes,
        categoryId: String(detail?.listing?.categoryId || detail?.categoryId || ''),
        categoryPath: String(detail?.listing?.categoryPath || detail?.categoryPath || ''),
        warehouseItemId: String(detail?.warehouseItemId || ''), message: '',
      };
      render();
    }

    async function loadCategory(itemId) {
      const detail = await api('selectionpool.detail', { itemId }).catch(() => null);
      const list = loggedIn();
      const profileId = ui.cat.profileId || list[0]?.storeId || '';
      ui.cat = {
        ...ui.cat, itemId, profileId, keyword: '', levels: [[], [], []], ids: ['', '', ''],
        picked: null, hits: [], busy: false,
        productId: String(detail?.product?.id || detail?.snapshot?.product_id || detail?.snapshot?.item_id || ''),
        personal: null,
        message: detail?.listing?.categoryPath ? `当前类目：${detail.listing.categoryPath}${detail.listing.categoryId ? ` · ID ${detail.listing.categoryId}` : ''}` : '还没采集到类目',
      };
      render();
      // 个人淘宝号登录状态（读商品真实类目用它——店铺子账号打开商品页会被淘宝要求重新登录）。
      void api('personaltaobao.status', {}).then(s => { ui.cat.personal = Boolean(s?.loggedIn); render(); }).catch(() => undefined);
      if (profileId) await loadLevel(0, '');
    }

    async function loadLevel(level, parentId) {
      ui.cat.busy = true; render();
      try {
        const result = await api('selectionpool.categoryChildren', { parentId, profileId: ui.cat.profileId, refresh: level === 0 && Boolean(ui.cat.message === 'refresh') });
        const levels = ui.cat.levels.slice();
        levels[level] = result?.items || [];
        for (let i = level + 1; i < 3; i++) levels[i] = [];
        const ids = ui.cat.ids.slice();
        for (let i = level; i < 3; i++) ids[i] = '';
        ui.cat.levels = levels;
        ui.cat.ids = ids;
        ui.cat.picked = null;
        if (!result?.ok && result?.message) ui.cat.message = result.message;
      } catch (error) { ui.cat.message = String(error?.message || error); }
      finally { ui.cat.busy = false; render(); }
    }

    async function loadDetail(itemId) {
      // 老软件打开快，很大一部分是「缓存了详情」：这里同样做 stale-while-revalidate，
      // 命中缓存立刻出画面，同时后台刷一次最新数据（用户 2026-11-12：我们打开比老软件慢）。
      const cached = detailCache.get(itemId);
      ui.detail = {
        ...ui.detail, itemId, busy: !cached, error: '', imageIndex: 0,
        data: cached ? cached.data : (ui.detail.itemId === itemId ? ui.detail.data : null),
      };
      if (cached) ui.detail.tab = ui.detail.tab || 'overview';
      render();
      if (cached) {
        void api('selectionpool.detail', { itemId })
          .then(fresh => {
            detailCache.set(itemId, { at: Date.now(), data: fresh });
            if (ui.detail.itemId === itemId && ui.name === 'detail') { ui.detail.data = fresh; render(); }
          })
          .catch(() => undefined);
        return;
      }
      try {
        const fresh = await api('selectionpool.detail', { itemId });
        detailCache.set(itemId, { at: Date.now(), data: fresh });
        ui.detail = { ...ui.detail, itemId, data: fresh, busy: false, error: '' };
      } catch (error) {
        ui.detail = { ...ui.detail, busy: false, error: String(error?.message || error) };
      }
      render();
    }

    function open(name, payload = {}) {
      ui.name = name;
      ui.message = '';
      ui.messageTone = 'info';
      if (name === 'autoShelf') {
        if (Array.isArray(payload.itemIds)) {
          // 保留未提交项并合并从表格新勾选的 itemIds（不重复）
          const merged = [...ui.shelf.itemIds];
          for (const rawId of payload.itemIds) {
            const num = Number(rawId);
            if (num > 0 && !merged.includes(num)) merged.push(num);
          }
          ui.shelf.itemIds = merged;
        }
        void refreshShelf();
      } else if (name === 'queueProgress') {
        ui.progress.autoFollow = true;
        void refreshProgress();
      } else if (name === 'publication') {
        const nextTab = ['failures', 'records', 'logs', 'operators'].includes(payload.tab) ? payload.tab : 'failures';
        ui.pub.tab = nextTab;
        ui.pub.page = 1;
        ui.pub.keyword = '';
        ui.pub.itemId = Number(payload.itemId) || 0;
        if (nextTab === 'logs') {
          ui.logs = { runs: [], runId: payload.runId || '', busy: true, error: '' };
        }
        void refreshPublication();
      } else if (name === 'manualForm' && payload.itemId) {
        void loadForm(Number(payload.itemId));
      } else if (name === 'category' && payload.itemId) {
        void loadCategory(Number(payload.itemId));
      } else if (name === 'detail' && payload.itemId) {
        ui.detail = { itemId: Number(payload.itemId), tab: payload.tab || 'overview', data: null, busy: true, error: '', imageIndex: 0 };
        void loadDetail(Number(payload.itemId));
      } else if (name === 'logs') {
        ui.name = 'publication';
        ui.pub.tab = 'logs';
        ui.pub.itemId = 0;
        ui.logs = { runs: [], runId: payload.runId || '', busy: true, error: '' };
        void refreshPublication();
      }
      render();
    }

    const close = () => { ui.name = ''; ui.message = ''; ui.messageTone = 'info'; render(); };
    const isOpen = () => Boolean(ui.name);

    // ---------------------------------------------------------------- 各弹窗 HTML
    const QUEUE_STATE = {
      queued: { label: '排队中', tone: 'queued' },
      running: { label: '上架中', tone: 'running' },
      done: { label: '成功', tone: 'done' },
      failed: { label: '失败', tone: 'failed' },
      stopped: { label: '未执行', tone: 'failed' },
    };
    const isQueueRemovable = row => row && (row.status === 'queued' || row.status === 'stopped');
    const poolItems = () => (data().items || []);
    const queueTitle = row => row.title || poolItems().find(x => Number(x.itemId) === Number(row.itemId))?.title || '正在读取标题…';

    function pruneQueueSelection(q) {
      const validIds = new Set((q?.items || []).filter(isQueueRemovable).map(r => r.queueId));
      for (const id of [...ui.progress.selectedQueueIds]) {
        if (!validIds.has(id)) ui.progress.selectedQueueIds.delete(id);
      }
    }

    function previewPriceText(c) {
      if (c?.useWorkbenchPrice) return '按工作台价格上架 · 不套用同行价公式';
      const f = Number(c?.priceFactor ?? 1);
      const o = Number(c?.priceOffset ?? 0);
      const factor = Number.isFinite(f) && f > 0 ? Math.min(f, 100) : 1;
      const offset = Number.isFinite(o) ? Math.min(Math.abs(o), 100000) : 0;
      const dir = c?.priceDirection === 'add' ? 1 : -1;
      const result = Math.max(0.01, 10 * factor + dir * offset);
      const unchanged = factor === 1 && offset === 0;
      return `例：同行价 ¥10.00 → ¥${result.toFixed(2)}${unchanged ? ' · 原价不变' : ''}`;
    }

    function queueSideStats(q) {
      const items = Array.isArray(q?.items) ? q.items : [];
      const total = Number(q?.total) || items.length;
      const done = Number(q?.done) || 0;
      const ok = Number(q?.ok) || 0;
      const fail = Number(q?.fail) || 0;
      const queuedCount = items.filter(r => r.status === 'queued').length;
      const percent = total ? Math.min(100, Math.round(done / total * 100)) : 0;
      const running = items.find(r => r.status === 'running');
      const current = q?.running
        ? (running ? `正在上架：选品#${running.itemId} ${short(queueTitle(running), 16)}` : '正在准备下一件…')
        : (items.length ? '本次队列已结束' : '暂无队列任务，请在「自动上架」提交');
      return { items, total, done, ok, fail, queuedCount, percent, current, running };
    }

    function queueTableRow(row, index) {
      const info = QUEUE_STATE[row.status] || QUEUE_STATE.queued;
      const title = queueTitle(row);
      const removable = isQueueRemovable(row);
      const checked = removable && ui.progress.selectedQueueIds.has(row.queueId);
      const shopTag = row.shopName || '—';
      const detail = info.tone === 'running' ? `已用时 ${elapsed(row.startedAt)}`
        : info.tone === 'failed' ? (row.message || row.code || '失败')
        : info.tone === 'done' ? (row.message || '已放入仓库')
        : '等待上架';
      const qid = esc(row.queueId || `row-${index}`);
      return `<tr class="spx-queue-tr is-${info.tone}${checked ? ' is-checked' : ''}" title="选品#${esc(row.itemId)} ${esc(title)} · ${esc(detail)}">
        <td class="select-col">
          <input type="checkbox" class="table-select" ${removable ? `data-queue-select="${qid}" ${checked ? 'checked' : ''}` : 'disabled'} aria-label="选择排队商品 #${esc(row.itemId)}" title="${removable ? '勾选后可移除排队' : (row.status === 'running' ? '正在上架中，不可移除' : '已执行结束')}">
        </td>
        <td class="mono spx-q-idx">${index + 1}</td>
        <td class="spx-q-title"><span class="cell-main clip">#${esc(row.itemId)} · ${esc(short(title, 24))}</span></td>
        <td class="spx-q-shop"><span class="clip">${esc(short(shopTag, 12))}</span></td>
        <td class="spx-q-state"><span class="spx-q-pill is-${info.tone}">${esc(info.label)}</span></td>
        <td class="spx-q-detail"><span class="clip">${esc(short(detail, 26))}</span></td>
      </tr>`;
    }

    function shelfQueuePanel(q) {
      const s = queueSideStats(q);
      const removableRows = s.items.filter(isQueueRemovable);
      const selectedRemovable = removableRows.filter(r => ui.progress.selectedQueueIds.has(r.queueId));
      const allChecked = removableRows.length > 0 && selectedRemovable.length === removableRows.length;
      const someChecked = selectedRemovable.length > 0 && selectedRemovable.length < removableRows.length;
      return `<section class="spx-queue-panel" data-spx-side data-spx-queue-panel>
        <div class="spx-side-head">
          <div>
            <b>右侧排队列表</b>
            <span data-spx-side-current>排队中 ${s.queuedCount} · 合计 ${s.items.length}</span>
          </div>
          <em data-spx-side-percent>${s.percent}%</em>
        </div>

        <div class="compliance-batch-bar spx-queue-batch-bar" data-spx-queue-toolbar>
          <button type="button" class="button small" data-action="selectionpool:dlg-queue-select-all" ${removableRows.length ? '' : 'disabled'}>全选</button>
          <button type="button" class="button small" data-action="selectionpool:dlg-queue-invert" ${removableRows.length ? '' : 'disabled'}>反选</button>
          <span class="spx-queue-selcount" data-spx-queue-selcount>${selectedRemovable.length ? `已选 <b>${selectedRemovable.length}</b> / 可移除 ${removableRows.length}` : (removableRows.length ? `可移除 <b>${removableRows.length}</b> 项` : '暂无可移除项')}</span>
          <span class="spacer"></span>
          <button type="button" class="button small danger spx-queue-remove-btn" data-action="selectionpool:dlg-queue-remove" ${selectedRemovable.length ? '' : 'disabled'}>批量移除选定排队项${selectedRemovable.length ? ` (${selectedRemovable.length})` : ''}</button>
        </div>

        <div class="table-wrap spx-queue-table-wrap">
          <table class="spx-queue-table">
            <thead>
              <tr>
                <th class="select-col">
                  <input type="checkbox" class="table-select" data-queue-select-all="1" ${allChecked ? 'checked' : ''} ${removableRows.length ? '' : 'disabled'} ${someChecked ? 'data-indeterminate="1"' : ''} aria-label="全选排队中商品" title="全选 / 取消全选所有排队中商品">
                </th>
                <th>#</th>
                <th>商品</th>
                <th>目标店铺</th>
                <th>状态</th>
                <th>详情 / 用时</th>
              </tr>
            </thead>
            <tbody data-spx-side-list>
              ${s.items.length ? s.items.map((r, i) => queueTableRow(r, i)).join('') : `<tr class="spx-queue-empty-row"><td colspan="6"><div class="spx-side-empty">当前没有排队的商品。可切换到「上架设置」选项卡新增商品并确认上架。</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </section>`;
    }

    function renderShopCatTree(storeId, options, savedNames) {
      const topItems = [];
      const childrenByGroup = new Map();
      for (const opt of options) {
        const g = String(opt.group || '').trim();
        const name = String(opt.name || '').trim();
        if (!name) continue;
        if (!g) {
          topItems.push({ ...opt, name, group: '' });
        } else {
          if (!childrenByGroup.has(g)) childrenByGroup.set(g, []);
          childrenByGroup.get(g).push({ ...opt, name, group: g });
        }
      }
      const consumedGroups = new Set();
      const renderOpt = (o, cls = '') => `<label class="spx-shopcat-opt ${cls}"><input type="checkbox" data-action="selectionpool:dlg-shopcat-pick" data-id="${esc(storeId)}" data-name="${esc(o.name)}" ${savedNames.includes(o.name) ? 'checked' : ''}><span>${esc(o.name)}</span></label>`;

      const parts = [];
      if (topItems.length) {
        parts.push(`<div class="spx-shopcat-tree">${topItems.map(parent => {
          const kids = childrenByGroup.get(parent.name) || [];
          if (kids.length) consumedGroups.add(parent.name);
          return `<div class="spx-shopcat-node${kids.length ? ' has-children' : ''}">
            ${renderOpt(parent, kids.length ? 'spx-shopcat-parent' : '')}
            ${kids.length ? `<div class="spx-shopcat-children">${kids.map(k => renderOpt(k, 'spx-shopcat-child')).join('')}</div>` : ''}
          </div>`;
        }).join('')}</div>`);
      }
      for (const [group, rows] of childrenByGroup.entries()) {
        if (consumedGroups.has(group)) continue;
        parts.push(`<div class="spx-shopcat-group">
          <div class="spx-shopcat-group-h">${esc(group)}</div>
          <div class="spx-shopcat-children">${rows.map(k => renderOpt(k, 'spx-shopcat-child')).join('')}</div>
        </div>`);
      }
      return parts.join('');
    }

    function shelfModalHeaderAndTabs(activeTab, q, qs, chosenCount, stagedCount) {
      const runBadge = q.running
        ? (q.stopRequested ? '<span class="spx-badge warn">停止中</span>' : '<span class="spx-badge live">正在上架</span>')
        : (qs.items.length ? '<span class="spx-badge idle">队列已结束</span>' : '');
      const progCount = (q.running || qs.items.length) ? ` (${qs.done}/${qs.total})` : '';
      const subText = activeTab === 'autoShelf'
        ? (q.running ? `当前批次上架中 (${qs.done}/${qs.total} · 排队 ${qs.queuedCount}) · 可继续新增商品到排队序列` : `待确认上架 ${stagedCount} 件选品 · 已选 ${chosenCount} 家店铺`)
        : `${q.runId ? `批次 ${esc(q.runId)}` : '暂无执行批次'} · ${q.running ? `已运行 ${esc(elapsed(q.startedAt))}` : (qs.items.length ? `共处理 ${qs.done}/${qs.total} 件` : '可在「上架设置」选择商品并确认上架')}`;

      return `<div class="spx-head">
        <div class="spx-head-icon ${activeTab === 'queueProgress' ? 'spx-head-icon-prog' : ''}">${svg(activeTab === 'queueProgress' ? 'clock' : 'arrow')}</div>
        <div class="spx-head-text">
          <h2>自动上架 ${runBadge}</h2>
          <span data-spx-prog-sub>${subText}</span>
        </div>
        <button type="button" class="spx-x" data-action="selectionpool:dlg-close" title="关闭" aria-label="关闭弹窗">×</button>
      </div>
      <div class="spx-modal-tabbar">
        <div class="selection-tabs spx-shelf-tabs" role="tablist" aria-label="自动上架功能切换">
          <button type="button" role="tab" aria-selected="${activeTab === 'autoShelf'}" class="selection-tab ${activeTab === 'autoShelf' ? 'active' : ''}" data-action="selectionpool:dlg-open-settings">上架设置</button>
          <button type="button" role="tab" aria-selected="${activeTab === 'queueProgress'}" class="selection-tab ${activeTab === 'queueProgress' ? 'active' : ''}" data-action="selectionpool:dlg-open-progress" data-spx-tab-progress>查看进度${progCount}</button>
        </div>
      </div>
      ${ui.message ? `<div class="spx-inline-alert ${ui.messageTone === 'error' ? 'is-error' : ''}" role="alert"><span>${esc(ui.message)}</span><button type="button" class="spx-inline-alert-x" data-action="selectionpool:dlg-dismiss-msg" aria-label="关闭提示">×</button></div>` : ''}`;
    }

    /**
     * 弹窗 Tab ①：上架设置（上架前设置 + 本批清单 + 运行中新增到排队序列 + 确认上架）
     * 与「查看进度」彻底分离，不包含 KPI、执行日志与排队监控表。
     */
    function shelfDialog() {
      const q = queue();
      const c = cfg();
      const list = shops();
      const chosen = ui.shelf.shops;
      const ids = ui.shelf.itemIds;
      const allPool = poolItems();
      const itemMap = new Map(allPool.map(r => [Number(r.itemId), r]));
      const stagedRows = ids.map(id => itemMap.get(Number(id)) || { itemId: id, title: `选品 #${id}`, priceFen: null, imageUrl: '' });
      const stagedSet = new Set(ids.map(Number));
      const kw = String(ui.shelf.pickKeyword || '').trim().toLowerCase();
      const candidateRows = allPool.filter(r => {
        if (!kw) return true;
        return String(r.itemId).includes(kw) || String(r.title || '').toLowerCase().includes(kw) || String(r.shopName || '').toLowerCase().includes(kw);
      });
      const qs = queueSideStats(q);
      const onlineCount = loggedIn().length;
      const priceYuan = fen => (fen == null || !Number.isFinite(Number(fen)) ? '—' : `¥${(Number(fen) / 100).toFixed(2)}`);

      return `<div class="spx-backdrop" data-spx="autoShelf"><div class="spx-dialog spx-shelf spx-setup-dialog">
        ${shelfModalHeaderAndTabs('autoShelf', q, qs, chosen.size, ids.length)}

        ${q.running ? `<div class="spx-live-banner" data-spx-live-banner>
          <span class="spx-live-dot"></span>
          <span class="spx-live-text">正在上架第 <b>${Math.min(qs.done + 1, qs.total)}/${qs.total}</b> 件（成功 ${qs.ok} · 失败 ${qs.fail} · 排队 ${qs.queuedCount}）· 本次确认将自动<b>新增到当前排队序列末尾</b></span>
        </div>` : ''}

        <div class="spx-setup-grid">
          <div class="spx-setup-left">
            <section class="spx-card">
              <div class="spx-card-h">
                <b>1. 选择目标店铺</b>
                <span>在线 ${onlineCount} / ${list.length} 家</span>
                ${onlineCount > 1 ? '<button type="button" class="link-button" data-action="selectionpool:dlg-shelf-all-shops">全选在线</button>' : ''}
              </div>
              <div class="spx-shops">${list.length ? list.map(s => {
                const ok = s.state === 'logged-in' || loggedIn().some(x => x.storeId === s.storeId);
                const on = chosen.has(s.storeId);
                return `<label class="spx-shop ${on ? 'on' : ''} ${ok ? '' : 'off'}"><input type="checkbox" data-action="selectionpool:dlg-shelf-shop" data-id="${esc(s.storeId)}" ${on ? 'checked' : ''} ${ok ? '' : 'disabled'}>
                  <i class="spx-shop-logo">${esc(String(s.name || '店').slice(0, 1))}</i><span class="spx-shop-name">${esc(s.name || '未命名店铺')}</span>
                  <em class="spx-shop-state ${ok ? 'ok' : 'bad'}">${ok ? '在线' : (s.label || '未登录')}</em></label>`;
              }).join('') : '<p class="spx-note">还没有登记店铺，请先到左侧「店铺登录」添加店铺后再上架。</p>'}</div>
            </section>

            <section class="spx-card spx-toggle-sec">
              <label class="spx-toggle"><input type="checkbox" data-action="selectionpool:dlg-shelf-config" data-key="autoPublish" ${c.autoPublish ? 'checked' : ''}><i></i></label>
              <div class="spx-toggle-text"><b>2. 自动填表入仓模式</b><span>开启后按选品类目与参数自动填报并放进店铺仓库（不会直接开卖）</span></div>
              <span class="spx-chip">${c.autoPublish ? '放进仓库' : '仅记录检查'}</span>
            </section>

            <section class="spx-card">
              <div class="spx-card-h"><b>3. 店铺中分类</b><span>选填 · 每家店铺单独记忆 · 支持一级与子分类多选</span></div>
              ${[...chosen].length ? [...chosen].map(id => {
                const s = list.find(x => x.storeId === id) || { name: id };
                const options = (ui.shelf.shopCats[id] || []);
                const savedNames = Array.isArray((c.shopCategoryNames || {})[id]) ? (c.shopCategoryNames || {})[id] : [];
                const open = ui.shelf.shopcatOpen === id;
                const catState = ui.shelf.shopCatState[id] || {};
                const picked = savedNames.length
                  ? `<b>已选 ${savedNames.length} 个</b>：${esc(savedNames.join('、'))}`
                  : '<span class="dim">未设置（上架时不选店铺中分类）</span>';
                return `<div class="spx-shopcat-block">
                  <div class="spx-shopcat-row">
                    <span class="spx-shopcat-shop">${esc(s.name || id)}</span>
                    <button type="button" class="spx-shopcat-toggle ${open ? 'on' : ''}" data-action="selectionpool:dlg-shopcat-toggle" data-id="${esc(id)}" title="展开/收起本店可选的「店铺中分类」">
                      <span class="spx-shopcat-current">${picked}</span><em>${open ? '▲' : '▼'}</em>
                    </button>
                    <button type="button" class="button small" data-action="selectionpool:dlg-shelf-shopcat-refresh" data-id="${esc(id)}" ${catState.busy ? 'disabled' : ''}>${catState.busy ? '读取中…' : '刷新'}</button>
                  </div>
                  ${open ? `<div class="spx-shopcat-panel">
                    ${catState.busy ? '<p class="spx-note">正在读取本店分类（含子分类）…</p>' : ''}
                    ${catState.error ? `<p class="spx-note spx-error">${esc(catState.error)}</p>` : ''}
                    ${options.length ? renderShopCatTree(id, options, savedNames) : (catState.busy ? '' : '<p class="spx-note">点「刷新」读取本店分类（含子分类）</p>')}
                    <div class="spx-shopcat-foot"><span class="spacer"></span>
                      <button type="button" class="link-button" data-action="selectionpool:dlg-shopcat-clear" data-id="${esc(id)}">清空本店分类</button></div>
                  </div>` : ''}
                </div>`;
              }).join('') : '<p class="spx-note">请先在上方勾选目标店铺，即可按店铺设置默认分类。</p>'}
            </section>

            <section class="spx-card">
              <div class="spx-card-h"><b>4. 上架价格规则</b><em class="spx-price-eg" data-spx-price-eg>${esc(previewPriceText(c))}</em></div>
              <label class="spx-price-check">
                <input type="checkbox" data-action="selectionpool:dlg-shelf-config" data-key="useWorkbenchPrice" ${c.useWorkbenchPrice ? 'checked' : ''}>
                <span>使用工作台价格</span>
                <em>勾选后不套用同行价公式，按工作台里已保存的价格上架</em>
              </label>
              <div class="spx-price-inline ${c.useWorkbenchPrice ? 'is-disabled' : ''}">
                <span>同行价 ×</span>
                <input class="spx-input mini" data-shelf-price="priceFactor" value="${esc(c.priceFactor || '1')}" aria-label="价格倍数" ${c.useWorkbenchPrice ? 'disabled' : ''}>
                <select class="spx-select mini" data-action="selectionpool:dlg-shelf-config" data-key="priceDirection" aria-label="减或加" ${c.useWorkbenchPrice ? 'disabled' : ''}><option value="subtract" ${c.priceDirection !== 'add' ? 'selected' : ''}>减</option><option value="add" ${c.priceDirection === 'add' ? 'selected' : ''}>加</option></select>
                <input class="spx-input mini" data-shelf-price="priceOffset" value="${esc(c.priceOffset || '1')}" aria-label="价格金额" ${c.useWorkbenchPrice ? 'disabled' : ''}>
                <span>元</span>
              </div>
              <p class="spx-price-note">${c.useWorkbenchPrice
                ? '当前按工作台价格上架：使用商品工作台里保存的规格价格，不再计算同行价。'
                : '默认套用到本批未单独调价的规格（支持两位小数）；工作台内已改价的规格以工作台为准。'}</p>
            </section>

            <section class="spx-card">
              <div class="spx-card-h"><b>5. 套用模板</b><span>选填 · 本批统一套用</span></div>
              <div class="spx-tpl-row">
                <span>SKU 模板</span>
                <select class="spx-select" data-action="selectionpool:dlg-shelf-config" data-key="skuTemplateId" aria-label="SKU 模板">
                  <option value="0">不使用</option>
                  ${(ui.shelf.templates.sku || []).map(t => `<option value="${esc(t.id)}" ${Number(c.skuTemplateId) === Number(t.id) ? 'selected' : ''}>${esc(t.name || '未命名模板')}（${(t.skus || []).length} 条）</option>`).join('')}
                </select>
                ${(ui.shelf.templates.sku || []).length ? '' : '<em class="spx-tpl-empty">还没有模板，可在上品库「图片模板」里新建</em>'}
              </div>
              <div class="spx-tpl-row">
                <span>详情页模板</span>
                <select class="spx-select" data-action="selectionpool:dlg-shelf-config" data-key="detailTemplateId" aria-label="详情页模板">
                  <option value="0">不使用</option>
                  ${(ui.shelf.templates.detail || []).map(t => `<option value="${esc(t.id)}" ${Number(c.detailTemplateId) === Number(t.id) ? 'selected' : ''}>${esc(t.name || '未命名模板')}（${(t.images || []).length} 张）</option>`).join('')}
                </select>
                ${(ui.shelf.templates.detail || []).length ? '' : '<em class="spx-tpl-empty">还没有模板，可在上品库「图片模板」里新建</em>'}
              </div>
            </section>

          </div>

          <div class="spx-setup-right">
            <section class="spx-batch-box">
              <div class="spx-card-h">
                <b>${q.running ? '准备新增到排队序列的商品' : '本批待上架清单'} <em>${ids.length} 件</em></b>
                ${ids.length ? '<button type="button" class="link-button" data-action="selectionpool:dlg-batch-clear">清空本批</button>' : ''}
              </div>
              <div class="spx-batch-list">
                ${stagedRows.length ? stagedRows.map(r => `<div class="spx-batch-item">
                  ${r.imageUrl ? `<img class="spx-batch-thumb" src="${esc(r.imageUrl)}" alt="" referrerpolicy="no-referrer">` : '<span class="spx-batch-thumb spx-batch-thumb-empty">#</span>'}
                  <div class="spx-batch-meta">
                    <b class="clip">#${esc(r.itemId)} · ${esc(short(r.title || '未命名商品', 28))}</b>
                    <span>${esc(priceYuan(r.priceFen))}${r.shopName ? ` · ${esc(short(r.shopName, 14))}` : ''}</span>
                  </div>
                  <button type="button" class="spx-batch-del" data-action="selectionpool:dlg-batch-remove" data-id="${esc(r.itemId)}" title="移出本批" aria-label="移出选品 #${esc(r.itemId)}">×</button>
                </div>`).join('') : '<div class="spx-batch-empty">还没有待确认商品。请在下方点击「+ 加入」新增商品，或在主列表中勾选后再点「自动上架」。</div>'}
              </div>
            </section>

            <section class="spx-picker-box">
              <div class="spx-card-h">
                <b>从上品库新增到排队序列</b>
                <button type="button" class="link-button" data-action="selectionpool:dlg-batch-add-page">本页全加入</button>
              </div>
              <div class="spx-picker-search">
                <input class="spx-input" data-dlg-shelf-pick value="${esc(ui.shelf.pickKeyword)}" placeholder="搜索商品名 / ID / 来源店铺快速加入" aria-label="搜索上品库商品">
              </div>
              <div class="spx-picker-list">
                ${candidateRows.length ? candidateRows.slice(0, 60).map(r => {
                  const inBatch = stagedSet.has(Number(r.itemId));
                  return `<div class="spx-picker-row${inBatch ? ' is-added' : ''}">
                    <span class="spx-picker-id">#${esc(r.itemId)}</span>
                    <span class="spx-picker-title clip" title="${esc(r.title || '')}">${esc(r.title || '未命名商品')}</span>
                    <span class="spx-picker-price">${esc(priceYuan(r.priceFen))}</span>
                    <button type="button" class="button small ${inBatch ? '' : 'primary'}" data-action="selectionpool:dlg-batch-add" data-id="${esc(r.itemId)}" ${inBatch ? 'disabled' : ''}>${inBatch ? '已在清单' : '+ 加入'}</button>
                  </div>`;
                }).join('') : '<div class="spx-note spx-empty">没有匹配的商品。</div>'}
              </div>
            </section>
          </div>
        </div>

        <div class="spx-foot">
          <span class="spx-hint">${q.running ? '确认后将保留当前运行进度，把本批商品按顺序追加到排队序列末尾。' : `目标：${chosen.size || 0} 家店铺 · 本批 ${ids.length} 件选品 · 共生成 ${ids.length * Math.max(1, chosen.size)} 条排队任务`}</span>
          <button type="button" class="button small" data-action="selectionpool:dlg-close">取消</button>
          <button type="button" class="button primary small" data-action="selectionpool:dlg-shelf-start" ${ui.busy ? 'disabled' : ''}>${q.running ? `确认并新增到排队 (${ids.length})` : `确认本批上架 (${ids.length})`}</button>
        </div>
      </div></div>`;
    }

    /**
     * 弹窗 Tab ②：查看进度（KPI 总览 + 当前商品详情 + 执行日志 + 待处理任务 + 右侧排队表格含 .table-select 与 .compliance-batch-bar）
     */
    function progressDialog() {
      const q = queue();
      const s = queueSideStats(q);
      const lines = (q.lines || []).length ? q.lines : (ui.progress.logs || []).map(l => l.line || '').filter(Boolean);
      const tasks = (resume().items || []).slice(0, 6);
      const running = s.running;

      return `<div class="spx-backdrop" data-spx="queueProgress"><div class="spx-dialog spx-shelf spx-progress-dialog">
        ${shelfModalHeaderAndTabs('queueProgress', q, s, ui.shelf.shops.size, ui.shelf.itemIds.length)}

        <div class="spx-prog-wrap">
          <div class="spx-prog-top">
            <div class="spx-kpi-grid" data-spx-kpi>
              <div class="spx-kpi"><span>总进度</span><b>${s.percent}%</b><small>${s.done} / ${s.total} 件</small></div>
              <div class="spx-kpi ok"><span>已入仓</span><b>${s.ok}</b><small>成功放入仓库</small></div>
              <div class="spx-kpi bad"><span>上架失败</span><b>${s.fail}</b><small>需查看原因或补全</small></div>
              <div class="spx-kpi wait"><span>排队等待</span><b>${s.queuedCount}</b><small>可在右侧勾选移除</small></div>
            </div>

            <div class="spx-spotlight" data-spx-spotlight>
              <div class="spx-spotlight-top">
                <strong data-spx-progress>${running ? `正在上架：选品#${esc(running.itemId)} · ${esc(short(queueTitle(running), 36))}` : esc(s.current)}</strong>
                <span data-spx-spotlight-meta>${running ? `${esc(running.shopName || '目标店铺')} · 已用时 ${esc(elapsed(running.startedAt))}` : `${s.done}/${s.total} (${s.percent}%)`}</span>
              </div>
              <progress class="spx-bar-native" value="${s.percent}" max="100" data-spx-progress-bar aria-label="上架总进度"></progress>
              <div class="spx-spotlight-msg" data-spx-spotlight-msg>${esc(q.title || (running ? '正在执行店铺发布页填充…' : '队列日志与每件商品实时详情会在这里持续更新。'))}</div>
            </div>
          </div>

          <div class="spx-prog-split">
            <div class="spx-prog-logs-col">
              <section class="spx-progress-log-sec">
                <div class="spx-log-head">
                  <b>执行详情与实时日志</b>
                  <span data-spx-log-count>${lines.length} 行</span>
                  <button type="button" class="link-button" data-action="selectionpool:dlg-shelf-log-copy">复制全部</button>
                  <button type="button" class="link-button" data-action="selectionpool:dlg-shelf-log-more">${ui.progress.logAll ? '只看最近 80 行' : '看全部'}</button>
                </div>
                <div class="spx-log" data-spx-log="1">${lines.length ? [...lines].slice(ui.progress.logAll ? -600 : -80).map(l => `<div>${esc(l)}</div>`).join('') : '<div class="dim">还没有执行日志。切换到「上架设置」选择商品并确认上架后，这里会逐行显示执行详情。</div>'}</div>
              </section>

              ${tasks.length ? `<section class="spx-resume"><div class="spx-resume-head"><b>没入仓、可以接着处理的任务 (${tasks.length})</b><span>${esc(resume().note || '')}</span></div>
                ${tasks.map(r => `<div class="spx-resume-row"><div class="spx-resume-text"><strong>选品#${esc(r.itemId)} → ${esc(short(r.title || '未命名商品', 24))}</strong><span>${esc(short(r.reason || '参数或类目不全', 90))}</span></div>
                  <div class="spx-resume-acts"><button type="button" class="button small" data-action="selectionpool:dlg-resume-open-shop" data-id="${esc(r.itemId)}">打开店铺窗口</button>
                  <button type="button" class="button primary small" data-action="selectionpool:dlg-resume-continue" data-id="${esc(r.itemId)}">继续入仓</button></div></div>`).join('')}
                <p class="spx-resume-tail">${esc(resume().tail || '')}</p></section>` : ''}
            </div>

            ${shelfQueuePanel(q)}
          </div>
        </div>

        <div class="spx-foot">
          <span class="spx-hint">右侧支持全选、反选及批量移除排队中商品；点「停止上架」将中断当前商品并清空剩余未执行队列。</span>
          <button type="button" class="button small" data-action="selectionpool:dlg-shelf-stop" ${q.running && !q.stopRequested ? '' : 'disabled'}>${q.stopRequested ? '正在停止…' : '停止上架'}</button>
          <button type="button" class="button primary small" data-action="selectionpool:dlg-close">后台运行</button>
        </div>
      </div></div>`;
    }

    function publicationRecordsTab() {
      const kw = String(ui.pub.keyword || '').trim().toLowerCase();
      const filterItemId = Number(ui.pub.itemId) || 0;
      const all = [...(ui.pub.shelfRecords || [])].reverse();
      const filtered = all.filter(r => {
        if (filterItemId && Number(r.itemId) !== filterItemId) return false;
        if (!kw) return true;
        return [r.itemId, r.shopName, r.warehouseItemId, r.status, r.title].some(v => String(v || '').toLowerCase().includes(kw));
      });
      const filterBar = `<div class="spx-search">
        <input class="spx-input" data-dlg-pub-keyword value="${esc(ui.pub.keyword)}" placeholder="选品 ID / 店铺名 / 仓库商品编号" aria-label="搜索入仓记录">
        <button type="button" class="button primary small" data-action="selectionpool:dlg-pub-query">查询</button>
        <button type="button" class="button small" data-action="selectionpool:dlg-pub-refresh">刷新</button>
        ${filterItemId ? `<button type="button" class="button small" data-action="selectionpool:dlg-pub-clear-item">仅看选品 #${filterItemId} · 显示全部</button>` : ''}
      </div>`;
      if (!filtered.length) return `${filterBar}<p class="spx-note spx-empty">${filterItemId ? `选品 #${filterItemId} 还没有成功入仓记录。` : '暂无入仓记录。自动上架成功后会记录目标店铺与仓库商品编号。'}</p>`;
      return `${filterBar}<div class="spx-records-table">
        <div class="spx-records-tr spx-records-th"><span>时间</span><span>选品</span><span>目标店铺</span><span>仓库商品编号</span><span>状态</span></div>
        ${filtered.slice(0, 100).map(r => `<div class="spx-records-tr">
          <span class="mono">${esc(time(r.at))}</span>
          <span class="mono">#${esc(r.itemId)}</span>
          <span class="clip">${esc(r.shopName || '—')}</span>
          <span class="mono">${esc(r.warehouseItemId || '—')}</span>
          <span><em class="spx-fixed">${esc(r.status || '已入仓')}</em></span>
        </div>`).join('')}
      </div>`;
    }

    function publicationLogsTab() {
      const st = ui.logs || { runs: [], runId: '' };
      const current = st.runId ? (st.runs || []).find(r => r.runId === st.runId) : null;
      if (current) {
        const lines = (current.lines || []).map(row => row.line).filter(Boolean);
        return `<div class="spx-log-subbar">
          <span class="spx-hint">选品 ${esc(current.items?.length ? `#${current.items.join('、#')}` : current.runId)} · ${esc(time(current.startedAt))} → ${esc(time(current.finishedAt))} · 成功 ${current.ok} · 失败 ${current.fail}</span>
          <button type="button" class="button small" data-action="selectionpool:dlg-log-back">返回列表</button>
          <button type="button" class="button small" data-action="selectionpool:dlg-log-copy">复制全部</button>
        </div>
        <div class="spx-log" data-spx-log="1">${lines.length ? lines.map(l => `<div>${esc(l)}</div>`).join('') : '<div class="dim">这次上架没有日志行</div>'}</div>`;
      }
      const rows = st.runs || [];
      return `<div class="spx-log-subbar">
        <span class="spx-hint">每次执行一行，点击「查看」可展开该次完整步骤与回执日志。</span>
        <button type="button" class="button small" data-action="selectionpool:dlg-log-refresh">刷新</button>
      </div>
      ${st.error ? `<p class="spx-note spx-error">${esc(st.error)}</p>` : ''}
      ${st.busy ? '<p class="spx-note">正在读取执行日志…</p>' : ''}
      ${rows.length ? `<div class="spx-run-table">
        <div class="spx-run-tr spx-run-th"><span>时间</span><span>选品</span><span>结果</span><span>行数</span><span>操作</span></div>
        ${rows.map(run => `<div class="spx-run-tr">
          <span class="mono">${esc(time(run.finishedAt || run.startedAt))}</span>
          <span class="clip">${esc((run.items || []).map(id => `#${id}`).join('、') || '—')}</span>
          <span>${run.ok ? `<em class="ok">成功 ${run.ok}</em>` : ''}${run.fail ? `<em class="bad">失败 ${run.fail}</em>` : ''}${!run.ok && !run.fail ? '—' : ''}</span>
          <span>${esc(String(run.lineCount || 0))}</span>
          <span><button type="button" class="link-button" data-action="selectionpool:dlg-log-open" data-run="${esc(run.runId)}">查看</button></span>
        </div>`).join('')}</div>`
        : (st.busy ? '' : '<p class="spx-note spx-empty">还没有执行日志。上架一次后这里会记录每一次完整过程。</p>')}`;
    }

    function publicationDialog() {
      const p = pub();
      const rows = p.rows || [];
      const totals = p.totals || { success: 0, failed: 0 };
      const tasks = (ui.pub.resume?.items || resume().items || []).slice(0, 3);
      const tab = ui.pub.tab;
      return `<div class="spx-backdrop" data-spx="publication"><div class="spx-dialog spx-pub">
        <div class="spx-head"><div class="spx-head-text"><h2>上品记录中心</h2><span>累计成功 ${totals.success} 次 · 失败 ${totals.failed} 次 · 尝试 ${totals.attempts || (totals.success + totals.failed)} 次</span></div>
          <button type="button" class="spx-x" data-action="selectionpool:dlg-close" title="关闭">×</button></div>
        <div class="spx-tabs">
          <button type="button" class="${tab === 'failures' ? 'on' : ''}" data-action="selectionpool:dlg-pub-tab" data-value="failures">失败排查${totals.failed ? ` (${totals.failed})` : ''}</button>
          <button type="button" class="${tab === 'records' ? 'on' : ''}" data-action="selectionpool:dlg-pub-tab" data-value="records">成功入仓</button>
          <button type="button" class="${tab === 'logs' ? 'on' : ''}" data-action="selectionpool:dlg-pub-tab" data-value="logs">执行日志</button>
          <button type="button" class="${tab === 'operators' ? 'on' : ''}" data-action="selectionpool:dlg-pub-tab" data-value="operators">统计与员工</button>
        </div>
        <div class="spx-body spx-pub-body">
          ${tab === 'records' ? publicationRecordsTab() : ''}
          ${tab === 'logs' ? publicationLogsTab() : ''}
          ${tab === 'operators' ? (() => {
            const opRows = Array.isArray(p.byOperator) ? p.byOperator : [];
            return `<div class="spx-overview"><div><span>累计上品成功</span><b>${totals.success}</b></div><div><span>失败</span><b>${totals.failed}</b></div><div><span>上品尝试</span><b>${totals.attempts || (totals.success + totals.failed)}</b></div></div>
            <p class="spx-note">每次上架尝试单独计数，失败后重试成功会保留原失败记录；停止、等待登录和未执行商品不计数。</p>
            ${opRows.length ? `<div class="spx-operator-table"><div class="spx-operator-tr spx-operator-th"><span>员工</span><span>尝试</span><span>成功</span><span>失败</span><span>成功率</span><span>主要失败原因</span></div>
              ${opRows.map(row => `<div class="spx-operator-tr"><span>${esc(row.operatorName || '本机')}${row.teamName ? `<em class="spx-op-team">${esc(row.teamName)}</em>` : ''}</span><span>${row.attempts}</span><span class="ok">${row.success}</span><span class="${row.failed ? 'bad' : ''}">${row.failed}</span><span class="spx-op-rate ${row.rate >= 80 ? 'ok' : row.rate >= 50 ? 'warn' : 'bad'}">${row.rate}%</span><span class="clip">${esc((row.topReasons || []).map(r => `${r.code}×${r.count}`).join(' · ') || '—')}</span></div>`).join('')}</div>`
              : '<p class="spx-note">还没有上架记录。上架一次后这里会按员工统计成功率。</p>'}`;
          })() : ''}
          ${tab === 'failures' ? `<div class="spx-search"><input class="spx-input" data-dlg-pub-keyword value="${esc(ui.pub.keyword)}" placeholder="商品 ID / 店铺 / 失败原因 / 员工" aria-label="搜索失败记录">
            <button type="button" class="button primary small" data-action="selectionpool:dlg-pub-query">查询</button>
            <button type="button" class="button small" data-action="selectionpool:dlg-pub-refresh">刷新</button></div>
            ${rows.length ? rows.map(r => `<div class="spx-fail-card">
            <div class="spx-fail-top"><strong>${esc(short(r.title || '未命名商品', 60))}</strong>
              ${r.fixedIn ? `<em class="spx-fixed">已修复 · ${esc(r.fixedIn)}</em>` : ''}<span class="spx-fail-time">${esc(time(r.at))}</span></div>
            <div class="spx-fail-meta">商品 ID: ${esc(r.productId || '—')} · 选品 #${esc(r.itemId || '—')}${r.operatorName ? ` · ${esc(r.operatorName)}` : ''} · ${esc(r.shopName || '—')}</div>
            <div class="spx-fail-reason">${esc(r.code || 'PUBLISH_FAILED')} · ${esc(r.summary || r.message || '失败')}</div>
            ${ui.pub.expanded === r.id ? `<pre class="spx-fail-full">${esc(r.diagnostic || rowMessage(r))}</pre>` : ''}
            <div class="spx-fail-acts"><button type="button" class="button small" data-action="selectionpool:dlg-pub-expand" data-id="${esc(r.id)}">${ui.pub.expanded === r.id ? '收起原因' : '完整原因'}</button>
              <button type="button" class="button small" data-action="selectionpool:dlg-pub-copy" data-id="${esc(r.id)}">复制排查信息</button>
              <button type="button" class="button small" data-action="selectionpool:dlg-pub-open-form" data-id="${esc(r.itemId)}">填写补全结果</button>
              <button type="button" class="button small" data-action="selectionpool:dlg-pub-open-shop" data-id="${esc(r.itemId)}">打开店铺窗口</button>
              <button type="button" class="button primary small" data-action="selectionpool:dlg-pub-resume" data-id="${esc(r.itemId)}">继续入仓</button></div>
          </div>`).join('') : '<p class="spx-note spx-empty">这段时间没有失败记录。</p>'}` : ''}
          ${tab === 'failures' && tasks.length ? `<section class="spx-resume"><div class="spx-resume-head"><b>没入仓、可以接着处理的任务</b><span>也可以在这里手动打开店铺窗口处理。</span></div>
            ${tasks.map(r => `<div class="spx-resume-row"><div class="spx-resume-text"><strong>选品#${esc(r.itemId)} → ${esc(short(r.title || '', 24))}</strong><span>${esc(short(r.reason || '', 80))}</span></div>
              <div class="spx-resume-acts"><button type="button" class="button small" data-action="selectionpool:dlg-resume-open-shop" data-id="${esc(r.itemId)}">打开店铺窗口</button>
              <button type="button" class="button primary small" data-action="selectionpool:dlg-resume-continue" data-id="${esc(r.itemId)}">继续入仓</button></div></div>`).join('')}</section>` : ''}
        </div>
        <div class="spx-foot">${tab === 'failures' ? `<span class="spx-hint">共 ${p.total || 0} 条失败记录</span>
          <button type="button" class="button small" data-action="selectionpool:dlg-pub-page" data-value="${Math.max(1, (p.page || 1) - 1)}" ${(p.page || 1) <= 1 ? 'disabled' : ''}>上一页</button>
          <span>${p.page || 1}/${p.pages || 1}</span>
          <button type="button" class="button small" data-action="selectionpool:dlg-pub-page" data-value="${(p.page || 1) + 1}" ${(p.page || 1) >= (p.pages || 1) ? 'disabled' : ''}>下一页</button>`
          : `<span class="spx-hint">${tab === 'records' ? `共 ${(ui.pub.shelfRecords || []).length} 条入仓记录` : tab === 'logs' ? `共 ${(ui.logs.runs || []).length} 次执行记录` : '含成功/失败与员工统计'}</span>`}
          <button type="button" class="button small" data-action="selectionpool:dlg-close">关闭</button></div>
      </div></div>`;
    }
    const rowMessage = r => r?.message || '';

    function formDialog() {
      const f = ui.form;
      const attrs = f.attributes || [];
      const d = f.detail || {};
      const section = FORM_SECTIONS.find(s => s.id === f.section) || FORM_SECTIONS[0];
      return `<div class="spx-backdrop" data-spx="manualForm"><div class="spx-dialog spx-form">
        <div class="spx-form-tabs"><span class="on">编辑中</span><span>基线信息</span><span>其他信息</span><span>销售信息</span><span>指定类目及属性</span>
          <button type="button" class="spx-x" data-action="selectionpool:dlg-close" title="关闭">×</button></div>
        <div class="spx-form-main">
          <aside class="spx-form-nav"><div class="spx-form-nav-head">选品#${esc(f.itemId)} · ${esc(short(d?.product?.title || '商品信息', 16))}</div>
            ${FORM_SECTIONS.map(s => `<button type="button" class="${s.id === f.section ? 'on' : ''}" data-action="selectionpool:dlg-form-section" data-value="${esc(s.id)}">${esc(s.label)}${s.required ? '<i>*</i>' : ''}</button>`).join('')}</aside>
          <div class="spx-form-fields">
            <div class="spx-form-sec-h"><h3>${esc(section.label)}</h3><span>${f.message ? esc(f.message) : '在这里补全店铺发布页需要的字段，保存后会写回这条选品。'}</span></div>
            <div class="spx-form-grid">
              <label><span>类目 ID</span><input class="spx-input" data-dlg-form="categoryId" value="${esc(f.categoryId)}" placeholder="叶子类目 ID"></label>
              <label><span>类目路径</span><input class="spx-input" data-dlg-form="categoryPath" value="${esc(f.categoryPath)}" placeholder="一级 / 二级 / 叶子类目"></label>
            </div>
            <div class="spx-form-row">
              <button type="button" class="button small" data-action="selectionpool:dlg-form-read-category">采集原链接类目</button>
              <button type="button" class="button small" data-action="selectionpool:dlg-form-category">选择类目</button>
              <button type="button" class="button small" data-action="selectionpool:dlg-form-open-shop">打开店铺窗口</button></div>
            <div class="spx-form-sec-h"><h3>商品参数 <em>${attrs.length}</em></h3><span>改过的项上架时照抄填写</span></div>
            ${attrs.length ? `<div class="spx-form-attrs">${attrs.map((a, i) => `<label><span title="${esc(a.name)}">${esc(a.name)}</span><input class="spx-input" data-dlg-form-attr="${i}" value="${esc(a.value)}"></label>`).join('')}</div>` : '<p class="spx-note">还没有采集到参数，可在下面新增。</p>'}
            <div class="spx-form-row"><input class="spx-input" data-dlg-form-new-name placeholder="参数名，例如 厂址"><input class="spx-input" data-dlg-form-new-value placeholder="参数值">
              <button type="button" class="button small" data-action="selectionpool:dlg-form-add-attr">增加参数</button></div>
            <div class="spx-form-grid"><label><span>仓库商品编号（已在店铺页面入仓时填）</span><input class="spx-input" data-dlg-form="warehouseItemId" value="${esc(f.warehouseItemId)}"></label></div>
          </div>
          <aside class="spx-form-preview"><div class="spx-phone"><div class="spx-phone-head">手机预览</div>
            <div class="spx-phone-img">${/^https:\/\//.test(d?.product?.imageUrl || '') ? `<img src="${esc(d.product.imageUrl)}" alt="">` : '<span>商品主图</span>'}</div>
            <div class="spx-phone-title">${esc(short(d?.product?.title || '商品标题', 28))}</div>
            <div class="spx-phone-price">¥ ${esc(d?.product?.priceLabel || '—')}</div>
            <div class="spx-phone-note">这里显示商品信息预览，真实发布页在店铺窗口里填写。</div></div></aside>
        </div>
        <div class="spx-foot"><span class="spx-hint">保存后可在「上品记录」里点「继续入仓」，不会自动提交。</span>
          <button type="button" class="button small" data-action="selectionpool:dlg-close">取消</button>
          <button type="button" class="button small" data-action="selectionpool:dlg-form-open-shop">打开店铺窗口</button>
          <button type="button" class="button small" data-action="selectionpool:dlg-form-save">保存补全结果</button>
          <button type="button" class="button primary small" data-action="selectionpool:dlg-form-resume">我已改好，继续</button></div>
      </div></div>`;
    }

    /* ---------------------------------------------------------------- 采集信息（详情） */
    const notTaken = '<em class="spx-miss">未采集</em>';
    const yuan = fen => (fen == null || !Number.isFinite(Number(fen)) ? '' : (Number(fen) / 100).toFixed(2));
    /**
     * 缩略图地址：alicdn 支持 `_120x120.jpg` 后缀返回小图，列表/缩略图用它，
     * 详情页一次要加载十几张图，用原图会明显变慢（用户 2026-11-12：老软件打开快、我们慢）。
     */
    const thumbUrl = (url, size = 120) => {
      const raw = String(url || '');
      if (!/^https:\/\//i.test(raw)) return raw;
      if (!/(?:alicdn|aliimg)\.com/i.test(raw)) return raw;
      if (/_\d+x\d+\.(?:jpe?g|png|webp)$/i.test(raw)) return raw;
      if (!/\.(?:jpe?g|png|webp)$/i.test(raw)) return raw;
      return `${raw}_${size}x${size}.jpg`;
    };

    function detailRows(d) {
      const p = d.product || {};
      const price = d.price || {};
      const shop = d.shop || {};
      return [
        ['店铺', p.shopName || shop.name || ''],
        ['采集价', p.priceFen != null ? `¥${yuan(p.priceFen)}` : (p.priceLabel || '')],
        ['原价', price.originalFen != null ? `¥${yuan(price.originalFen)}` : ''],
        ['促销价', price.promotionFen != null ? `¥${yuan(price.promotionFen)}` : ''],
        ['品牌', d.brand || ''],
        ['类目路径', d.categoryPath || ''],
        ['类目ID', d.categoryId || ''],
        ['采集时间', p.collectedAt ? time(p.collectedAt) : ''],
        ['副标题', d.subtitle || ''],
        ['服务承诺', (d.services || []).join(' · ')],
      ];
    }

    function detailCard(title, body) {
      return `<section class="spx-info-card"><div class="spx-info-card-h">${esc(title)}</div><div class="spx-info-card-b">${body || `<p class="spx-note">${notTaken}</p>`}</div></section>`;
    }

    function detailOverview(d) {
      const p = d.product || {};
      const images = (d.images || []).filter(u => /^https:\/\//i.test(u));
      const index = Math.min(ui.detail.imageIndex || 0, Math.max(0, images.length - 1));
      const main = images[index] || (p.imageUrl && /^https:\/\//i.test(p.imageUrl) ? p.imageUrl : '');
      const shop = d.shop || {};
      const ship = d.shipping || {};
      const sales = d.sales || {};
      return `<div class="spx-info-main">
        <div class="spx-info-media">
          <div class="spx-info-hero">${main ? `<img src="${esc(main)}" alt="">` : `<span>${notTaken}</span>`}</div>
          ${images.length ? `<div class="spx-info-thumbs">${images.slice(0, 8).map((u, i) => `<button type="button" class="${i === index ? 'on' : ''}" data-action="selectionpool:dlg-detail-image" data-index="${i}"><img src="${esc(thumbUrl(u, 80))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></button>`).join('')}</div>` : ''}
        </div>
        <div class="spx-info-grid">${detailRows(d).map(([label, value]) => `<div class="spx-info-row"><span>${esc(label)}</span><b class="${value ? '' : 'empty'}">${value ? esc(value) : notTaken}</b></div>`).join('')}</div>
      </div>
      <div class="spx-info-cards">
        ${detailCard('销量与评价', sales && Object.keys(sales).length
          ? Object.entries(sales).map(([k, v]) => `<div class="spx-info-row"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`).join('')
          : '')}
        ${detailCard('店铺信息', Object.keys(shop).length
          ? `<div class="spx-info-row"><span>店铺名</span><b>${esc(shop.name || p.shopName || '—')}</b></div>
             ${shop.sellerId ? `<div class="spx-info-row"><span>卖家 ID</span><b class="mono">${esc(shop.sellerId)}</b></div>` : ''}
             ${shop.url ? `<div class="spx-info-row"><span>店铺链接</span><b class="mono clip">${esc(shop.url)}</b></div>` : ''}
             ${(shop.scores || []).map(s => `<div class="spx-info-row"><span>${esc(s.name)}</span><b>${esc(s.value)}</b></div>`).join('')}`
          : '')}
        ${detailCard('物流', Object.keys(ship).length
          ? Object.entries(ship).filter(([, v]) => v).map(([k, v]) => `<div class="spx-info-row"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`).join('')
          : '')}
        ${detailCard('主图视频', (d.videos || []).length
          ? (d.videos || []).map((u, i) => `<div class="spx-info-video"><video src="${esc(u)}" ${d.videoPoster ? `poster="${esc(d.videoPoster)}"` : ''} preload="metadata" controls muted></video><button type="button" class="link-button" data-action="selectionpool:dlg-detail-video" data-index="${i}">用系统播放器打开</button></div>`).join('')
          : '')}
      </div>`;
    }

    function detailSku(d) {
      const rows = (d.skus || []);
      if (!rows.length) return `<p class="spx-note">这条选品没有采集到规格。${notTaken}</p>`;
      return `<div class="spx-detail-table"><div class="spx-detail-tr spx-detail-th"><span>SKU</span><span>规格</span><span>价格</span><span>库存</span><span>规格图</span></div>
        ${rows.map(r => {
          // buildDetailView 的字段名是 specs（不是 properties）：之前取错字段导致「规格」列只显示 SKU ID
          const props = Array.isArray(r.specs) ? r.specs : (Array.isArray(r.properties) ? r.properties : []);
          const name = props.map(x => x.value || x.vname || '').filter(Boolean).join(' / ');
          const price = r.priceFen != null ? `¥${yuan(r.priceFen)}` : (r.promotionFen != null ? `¥${yuan(r.promotionFen)}` : '');
          return `<div class="spx-detail-tr">
            <span class="mono clip" title="${esc(r.id || '')}">${esc(r.id || '—')}</span>
            <span class="clip" title="${esc(name || '')}">${name ? esc(name) : notTaken}</span>
            <span>${price ? esc(price) : notTaken}</span>
            <span>${esc(r.stockText || r.availability || '—')}</span>
            <span>${/^https:\/\//i.test(r.imageUrl || '') ? `<img class="spx-detail-skuimg" src="${esc(thumbUrl(r.imageUrl, 80))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : notTaken}</span>
          </div>`;
        }).join('')}</div>`;
    }

    function detailParams(d) {
      const rows = d.attributes || [];
      if (!rows.length) return `<p class="spx-note">没有采集到商品参数。${notTaken}</p>`;
      return `<div class="spx-detail-params">${rows.map(a => `<div class="spx-info-row"><span title="${esc(a.name)}">${esc(a.name)}</span><b>${esc(a.value || '')}</b></div>`).join('')}</div>`;
    }

    function detailDesc(d) {
      const desc = d.description || {};
      const images = (desc.images || []).filter(u => /^https:\/\//i.test(u));
      return `${desc.text ? `<pre class="spx-detail-text">${esc(desc.text)}</pre>` : ''}
        ${images.length ? `<div class="spx-detail-desc">${images.map((u, i) => `<button type="button" class="spx-detail-descimg" data-action="selectionpool:dlg-detail-open" data-url="${esc(u)}"><img src="${esc(thumbUrl(u, 220))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><em>${i + 1}</em></button>`).join('')}</div>`
          : `<p class="spx-note">没有采集到图文详情。${notTaken}</p>`}`;
    }

    function detailReviews(d) {
      const rows = d.reviews || [];
      if (!rows.length) return `<p class="spx-note">没有采集到评价（采集时只取页面已渲染的评价，不滚动、不翻页）。${notTaken}</p>`;
      return `<div class="spx-detail-reviews">${rows.map(r => `<div class="spx-review"><p>${esc(r.content || '')}</p>${(r.images || []).length ? `<div class="spx-review-imgs">${r.images.slice(0, 6).map(u => /^https:\/\//i.test(u) ? `<img src="${esc(u)}" alt="">` : '').join('')}</div>` : ''}</div>`).join('')}</div>`;
    }

    function detailSource(d) {
      const source = d.source || {};
      const history = d.history || [];
      return `<div class="spx-detail-params">
        <div class="spx-info-row"><span>商品链接</span><b class="mono clip">${esc(d.product?.productUrl || '—')}</b></div>
        <div class="spx-info-row"><span>归属</span><b>${esc(d.ownerName || '—')}${d.teamName ? ` · ${esc(d.teamName)}` : ''}</b></div>
        <div class="spx-info-row"><span>加入时间</span><b>${esc(time(d.addedAt))}</b></div>
        <div class="spx-info-row"><span>分组 / 标签</span><b>${esc([d.organization?.group, ...(d.organization?.tags || [])].filter(Boolean).join(' · ') || '—')}</b></div>
        ${Object.entries(source).map(([k, v]) => `<div class="spx-info-row"><span>${esc(k)}</span><b>${esc(String(v || ''))}</b></div>`).join('')}
        <div class="spx-info-row"><span>历次采集</span><b>${history.length ? `${history.length} 次 · 最近 ${esc(time(history[history.length - 1]?.receivedAt || history[history.length - 1]?.collectedAt))}` : '—'}</b></div>
        <div class="spx-info-row"><span>图位素材</span><b>1:1 ${(d.images || []).length} · 3:4 ${(d.tallImages || []).length} · SKU ${(d.skuImages || []).length} · 详情 ${(d.description?.images || []).length} · 视频 ${(d.videos || []).length}</b></div>
      </div>`;
    }

    function detailDialog() {
      const st = ui.detail;
      const d = st.data || {};
      const p = d.product || {};
      const tabs = [
        ['overview', '概览', null],
        ['sku', 'SKU', (d.skus || []).length],
        ['params', '商品参数', (d.attributes || []).length],
        ['desc', '图文详情', (d.description?.images || []).length],
        ['reviews', '评价', (d.reviews || []).length],
        ['source', '采集信息', null],
      ];
      const body = st.error ? `<p class="spx-note spx-error">${esc(st.error)}</p>`
        : !st.data ? '<p class="spx-note">正在读取采集信息…</p>'
          : st.tab === 'sku' ? detailSku(d)
            : st.tab === 'params' ? detailParams(d)
              : st.tab === 'desc' ? detailDesc(d)
                : st.tab === 'reviews' ? detailReviews(d)
                  : st.tab === 'source' ? detailSource(d)
                    : detailOverview(d);
      return `<div class="spx-backdrop" data-spx="detail"><div class="spx-dialog spx-detail">
        <div class="spx-head"><div class="spx-head-text">
          <h2>${esc(short(p.title || '未命名商品', 70))}</h2>
          <span>${esc(p.platform === 'tmall' ? '天猫' : p.platform === 'taobao' ? '淘宝' : (p.platform || '—'))} · 商品 ID ${esc(p.id || '—')} · 归属 ${esc(d.ownerName || '—')} · 加入 ${esc(time(d.addedAt))}</span>
        </div>
          ${/^https:\/\//i.test(p.productUrl || '') ? `<button type="button" class="button small" data-action="selectionpool:dlg-detail-open" data-url="${esc(p.productUrl)}">打开原页面</button>` : ''}
          <button type="button" class="button small" data-action="selectionpool:dlg-detail-editor" data-id="${esc(st.itemId)}">商品图片工作台</button>
          <button type="button" class="spx-x" data-action="selectionpool:dlg-close" title="关闭">×</button></div>
        <div class="spx-tabs">${tabs.map(([id, label, count]) => `<button type="button" class="${st.tab === id ? 'on' : ''}" data-action="selectionpool:dlg-detail-tab" data-value="${id}">${esc(label)}${count != null ? `<em>${count}</em>` : ''}</button>`).join('')}</div>
        <div class="spx-body spx-detail-body">${body}</div>
        <div class="spx-foot"><span class="spx-hint">缺失项显示「未采集」，不会编造数值；采集信息页可查看网站保留的历次入库记录。</span>
          <button type="button" class="button small" data-action="selectionpool:dlg-detail-refresh" data-id="${esc(st.itemId)}">重新读取</button>
          <button type="button" class="button small" data-action="selectionpool:dlg-close">关闭</button></div>
      </div></div>`;
    }

    async function refreshLogs() {
      ui.logs = { ...ui.logs, busy: true, error: '' };
      render();
      try {
        const runs = await api('selectionpool.autoShelfRuns', {}).catch(() => []);
        ui.logs = { ...ui.logs, runs: Array.isArray(runs) ? runs : [], busy: false };
      } catch (error) {
        ui.logs = { ...ui.logs, busy: false, error: String(error?.message || error) };
      }
      render();
    }

    /**
     * 上架日志：先列「每一次上架」（时间 / 选品 / 结果 / 行数），点「查看」展开那一次的完整日志。
     * 用户 2026-11-12：现在点开只有一个大窗口，看不到每条商品对应的那一次。
     */
    function logsDialog() {
      const st = ui.logs || { runs: [], runId: '' };
      const current = st.runId ? (st.runs || []).find(r => r.runId === st.runId) : null;
      const fmt = v => time(v);
      if (current) {
        const lines = (current.lines || []).map(row => row.line).filter(Boolean);
        return `<div class="spx-backdrop" data-spx="logs"><div class="spx-dialog spx-logs">
          <div class="spx-head"><div class="spx-head-text"><h2>上架日志 · ${esc(current.items?.length ? `选品#${current.items.join('、#')}` : current.runId)}</h2>
            <span>${esc(fmt(current.startedAt))} → ${esc(fmt(current.finishedAt))} · 成功 ${current.ok} · 失败 ${current.fail} · ${lines.length} 行</span></div>
            <button type="button" class="button small" data-action="selectionpool:dlg-log-back">返回列表</button>
            <button type="button" class="button small" data-action="selectionpool:dlg-log-copy">复制全部</button>
            <button type="button" class="spx-x" data-action="selectionpool:dlg-close" title="关闭">×</button></div>
          <div class="spx-body"><div class="spx-log" data-spx-log="1">${lines.length ? lines.map(l => `<div>${esc(l)}</div>`).join('') : '<div class="dim">这次上架没有日志行</div>'}</div></div>
        </div></div>`;
      }
      const rows = st.runs || [];
      return `<div class="spx-backdrop" data-spx="logs"><div class="spx-dialog spx-logs">
        <div class="spx-head"><div class="spx-head-text"><h2>上架日志</h2><span>每次上架一行，点「查看」看那一次的完整日志</span></div>
          <button type="button" class="button small" data-action="selectionpool:dlg-log-refresh">刷新</button>
          <button type="button" class="spx-x" data-action="selectionpool:dlg-close" title="关闭">×</button></div>
        <div class="spx-body">
          ${st.error ? `<p class="spx-note spx-error">${esc(st.error)}</p>` : ''}
          ${st.busy ? '<p class="spx-note">正在读取…</p>' : ''}
          ${rows.length ? `<div class="spx-run-table">
            <div class="spx-run-tr spx-run-th"><span>时间</span><span>选品</span><span>结果</span><span>行数</span><span>操作</span></div>
            ${rows.map(run => `<div class="spx-run-tr">
              <span class="mono">${esc(fmt(run.finishedAt || run.startedAt))}</span>
              <span class="clip">${esc((run.items || []).map(id => `#${id}`).join('、') || '—')}</span>
              <span>${run.ok ? `<em class="ok">成功 ${run.ok}</em>` : ''}${run.fail ? `<em class="bad">失败 ${run.fail}</em>` : ''}${!run.ok && !run.fail ? '—' : ''}</span>
              <span>${esc(String(run.lineCount || 0))}</span>
              <span><button type="button" class="link-button" data-action="selectionpool:dlg-log-open" data-run="${esc(run.runId)}">查看</button></span>
            </div>`).join('')}</div>`
            : (st.busy ? '' : '<p class="spx-note">还没有上架记录。上架一次后这里会出现每一次的完整日志。</p>')}
        </div>
        <div class="spx-foot"><span class="spx-hint">日志包含每一步命中/未命中、提交回执；复制后可直接发我定位。</span></div>
      </div></div>`;
    }


    function categoryDialog() {
      const c = ui.cat;
      const picked = c.picked;
      return `<div class="spx-backdrop" data-spx="category"><div class="spx-dialog spx-cat">
        <div class="spx-head"><div class="spx-head-text"><h2>类目</h2><span>${esc(c.message || '')}</span></div>
          <button type="button" class="spx-x" data-action="selectionpool:dlg-close" title="关闭">×</button></div>
        <div class="spx-body">
          <div class="spx-cat-bar"><span class="spx-label">类目</span>
            <span class="spx-cat-current">${esc(picked?.path || '未选择')}${picked ? ` <em>ID ${esc(picked.id)}</em>` : ''} <em>采集</em></span>
            <button type="button" class="button small" data-action="selectionpool:dlg-cat-read" title="插件采集没带类目时按商品 ID 兜底重读（需要本机个人淘宝号会话）">按商品 ID 采集</button></div>
          <div class="spx-cat-tools"><input class="spx-input" data-dlg-cat-keyword value="${esc(c.keyword)}" placeholder="按类目名搜索叶子类目，例如：辣椒酱、果冻" aria-label="搜索类目">
            <button type="button" class="button primary small" data-action="selectionpool:dlg-cat-query">查询</button>
            <label class="spx-cat-source"><span>类目来源</span><select class="spx-select" data-action="selectionpool:dlg-cat-source">${loggedIn().map(s => `<option value="${esc(s.storeId)}" ${c.profileId === s.storeId ? 'selected' : ''}>${esc(s.name)}</option>`).join('') || '<option value="">未登录店铺</option>'}</select></label>
            <button type="button" class="button small" data-action="selectionpool:dlg-cat-refresh">刷新</button></div>
          ${c.hits.length ? `<div class="spx-cat-hits">${c.hits.map(h => `<button type="button" class="spx-cat-hit" data-action="selectionpool:dlg-cat-hit" data-id="${esc(h.id)}" data-path="${esc(h.path)}"><strong>${esc(h.path)}</strong><em>ID ${esc(h.id)}</em></button>`).join('')}</div>` : ''}
          <div class="spx-cat-cols">${['一级类目', '二级类目', '三级类目'].map((label, i) => `<div class="spx-cat-col"><div class="spx-cat-col-h">${label}</div>
            ${(c.levels[i] || []).length ? c.levels[i].map(node => `<button type="button" class="spx-cat-node ${c.ids[i] === node.id ? 'on' : ''} ${node.leaf ? 'leaf' : ''}" data-action="selectionpool:dlg-cat-pick" data-level="${i}" data-id="${esc(node.id)}" data-name="${esc(node.name)}" data-leaf="${node.leaf ? '1' : ''}">
              <span>${esc(node.name)}</span>${node.leaf ? '' : '<i>›</i>'}${node.authorized === false ? '<em class="spx-unauth">未授权</em>' : ''}</button>`).join('') : `<p class="spx-note">${i === 0 ? '点「刷新」从店铺后台读取类目' : '先选上一级'}</p>`}</div>`).join('')}</div>
        </div>
        <div class="spx-foot"><span class="spx-hint">${picked ? `选中：${esc(picked.path)} · ID ${esc(picked.id)}` : '请选到最后一级（叶子类目）才能保存'}</span>
          <button type="button" class="button small" data-action="selectionpool:dlg-close">取消</button>
          <button type="button" class="button primary small" data-action="selectionpool:dlg-cat-save" ${picked ? '' : 'disabled'}>保存类目</button></div>
      </div></div>`;
    }

    /** 类目弹窗重绘时保留左右列的滚动位置（选三级叶子时上面两列不再跳回顶部）。 */
    function renderKeepCatScroll(skipIndex = -1) {
      const before = [...document.querySelectorAll('.spx-cat-col')].map(col => col.scrollTop);
      render();
      const after = [...document.querySelectorAll('.spx-cat-col')];
      after.forEach((col, index) => {
        if (index === skipIndex) return;
        if (before[index] != null) col.scrollTop = before[index];
      });
    }
    function renderDialogs() {
      if (!ui.name) return '';
      if (ui.name === 'autoShelf') return shelfDialog();
      if (ui.name === 'queueProgress') return progressDialog();
      if (ui.name === 'publication') return publicationDialog();
      if (ui.name === 'manualForm') return formDialog();
      if (ui.name === 'category') return categoryDialog();
      if (ui.name === 'detail') return detailDialog();
      if (ui.name === 'logs') return logsDialog();
      return '';
    }

    // ---------------------------------------------------------------- 动作
    function readFormFields() {
      const out = { attributes: [], categoryId: '', categoryPath: '', warehouseItemId: '' };
      for (const el of document.querySelectorAll('[data-dlg-form]')) out[el.dataset.dlgForm] = String(el.value || '');
      const attrs = ui.form.attributes || [];
      for (const el of document.querySelectorAll('[data-dlg-form-attr]')) {
        const i = Number(el.dataset.dlgFormAttr);
        if (attrs[i]) out.attributes.push({ name: attrs[i].name, value: String(el.value || '') });
      }
      return out;
    }

    async function collectFormFields() {
      const values = readFormFields();
      return api('selectionpool.saveManualParams', {
        itemId: ui.form.itemId, categoryId: values.categoryId, categoryPath: values.categoryPath,
        attributes: values.attributes, warehouseItemId: values.warehouseItemId,
      });
    }

    function showDialogFeedback(text, isError = false) {
      const msg = String(text || '');
      if (ui.name === 'manualForm') {
        ui.form.message = msg;
        render();
        return;
      }
      if (ui.name === 'category') {
        ui.cat.message = msg;
        render();
        return;
      }
      if (ui.name === 'detail' && isError) {
        ui.detail.error = msg;
        render();
        return;
      }
      setDialogMessage(msg, isError);
    }

    async function openShop(itemId, reason) {
      if (!state.storeId) { showDialogFeedback('请先在左上角选择店铺', true); return null; }
      try {
        const info = await api('selectionpool.openShopPublishPage', { itemId, storeId: state.storeId, reason: reason || '参数或类目不全，人工在店铺页面补全' });
        if (typeof openShopPage === 'function') await openShopPage(info);
        await reload();
        return info;
      } catch (error) { showDialogFeedback(String(error?.message || error), true); return null; }
    }

    async function handleAction(action, target) {
      if (!String(action).startsWith('selectionpool:dlg-')) return false;
      const cmd = action.slice('selectionpool:dlg-'.length);
      const id = Number(target.dataset.id || 0);
      const value = target.dataset.value;
      switch (cmd) {
        case 'close': close(); return true;
        case 'log-refresh': await refreshLogs(); return true;
        case 'log-open': ui.logs = { ...ui.logs, runId: String(target.dataset.run || '') }; render(); return true;
        case 'log-back': ui.logs = { ...ui.logs, runId: '' }; render(); return true;
        case 'log-copy': {
          const run = (ui.logs.runs || []).find(r => r.runId === ui.logs.runId);
          const text = ((run?.lines || []).map(r => r.line).join('\n')) || '';
          try { await navigator.clipboard.writeText(text); }
          catch { ui.logs = { ...ui.logs, error: '复制失败，请手动选中日志复制' }; render(); }
          return true;
        }
        case 'detail-tab': ui.detail.tab = ['overview', 'sku', 'params', 'desc', 'reviews', 'source'].includes(value) ? value : 'overview'; render(); return true;
        case 'detail-image': ui.detail.imageIndex = Number(target.dataset.index) || 0; render(); return true;
        case 'detail-refresh': await loadDetail(Number(target.dataset.id || ui.detail.itemId)); return true;
        case 'detail-editor': {
          const editor = window.XXSelectionPoolEditorApi;
          const targetId = Number(target.dataset.id || ui.detail.itemId);
          close();
          if (editor) await editor.load(targetId);
          return true;
        }
        case 'detail-open': {
          const url = String(target.dataset.url || '');
          if (!/^https:\/\//i.test(url)) { showDialogFeedback('这个地址打不开', true); return true; }
          try {
            const result = await api('app.openExternal', { url });
            if (!result?.ok) showDialogFeedback(result?.message || '打不开这个地址', true);
          } catch (error) { showDialogFeedback(String(error?.message || error), true); }
          return true;
        }
        case 'detail-video': {
          const url = String((ui.detail.data?.videos || [])[Number(target.dataset.index)] || '');
          try {
            const result = await api('app.openExternal', { url });
            if (!result?.ok) showDialogFeedback(result?.message || '这个视频没有直链，打不开', true);
          } catch (error) { showDialogFeedback(String(error?.message || error), true); }
          return true;
        }
        case 'dismiss-msg': ui.message = ''; render(); return true;
        case 'open-progress': open('queueProgress'); return true;
        case 'open-settings': open('autoShelf'); return true;
        case 'shelf-all-shops': {
          for (const row of loggedIn()) ui.shelf.shops.add(row.storeId);
          ui.message = '';
          render(); return true;
        }
        case 'batch-add': {
          if (id > 0 && !ui.shelf.itemIds.includes(id)) {
            ui.shelf.itemIds = [...ui.shelf.itemIds, id];
            ui.message = '';
            render();
          }
          return true;
        }
        case 'batch-add-page': {
          const merged = [...ui.shelf.itemIds];
          for (const row of poolItems()) {
            const rid = Number(row.itemId);
            if (rid > 0 && !merged.includes(rid)) merged.push(rid);
          }
          ui.shelf.itemIds = merged;
          ui.message = '';
          render(); return true;
        }
        case 'batch-remove': {
          ui.shelf.itemIds = ui.shelf.itemIds.filter(x => Number(x) !== id);
          render(); return true;
        }
        case 'batch-clear': {
          ui.shelf.itemIds = [];
          render(); return true;
        }
        case 'queue-select-all': {
          const q = queue();
          const removable = (q.items || []).filter(isQueueRemovable);
          const allSelected = removable.length > 0 && removable.every(r => ui.progress.selectedQueueIds.has(r.queueId));
          if (allSelected) {
            for (const r of removable) ui.progress.selectedQueueIds.delete(r.queueId);
          } else {
            for (const r of removable) ui.progress.selectedQueueIds.add(r.queueId);
          }
          updateQueueSelectionUi();
          return true;
        }
        case 'queue-invert': {
          const q = queue();
          const removable = (q.items || []).filter(isQueueRemovable);
          for (const r of removable) {
            if (ui.progress.selectedQueueIds.has(r.queueId)) ui.progress.selectedQueueIds.delete(r.queueId);
            else ui.progress.selectedQueueIds.add(r.queueId);
          }
          updateQueueSelectionUi();
          return true;
        }
        case 'queue-remove': {
          const q = queue();
          const removableIds = new Set((q.items || []).filter(isQueueRemovable).map(r => r.queueId));
          const toRemove = [...ui.progress.selectedQueueIds].filter(qid => removableIds.has(qid));
          if (!toRemove.length) { setDialogMessage('请先在右侧队列勾选要移除的排队项', true); return true; }
          const res = await api('selectionpool.queueRemove', { queueIds: toRemove }).catch(error => ({ error: String(error?.message || error) }));
          if (res?.error) { setDialogMessage(res.error, true); return true; }
          for (const qid of toRemove) ui.progress.selectedQueueIds.delete(qid);
          ui.message = '';
          if (res?.queue) applyQueue(res.queue);
          await refreshProgress();
          return true;
        }
        case 'shelf-shop': {
          // 仅由 handleChange 处理，避免 click + change 重复触发
          return true;
        }
        case 'shelf-config': {
          // 仅由 handleChange 处理，避免点击复选框被触发两次
          return true;
        }
        case 'shopcat-pick': {
          // 店铺中分类的多选框：只在 handleChange 里保存，避免 click + change 重复写配置
          return true;
        }
        case 'shelf-shopcat-refresh': {
          const storeId = String(target.dataset.id || '');
          ui.shelf.shopcatOpen = storeId;
          await loadShelfCats({ refresh: true, ids: [storeId] });
          return true;
        }
        case 'shopcat-toggle': {
          const storeId = String(target.dataset.id || '');
          ui.shelf.shopcatOpen = ui.shelf.shopcatOpen === storeId ? '' : storeId;
          render();
          if (ui.shelf.shopcatOpen && !(ui.shelf.shopCats[storeId] || []).length) void loadShelfCats({ ids: [storeId] });
          return true;
        }
        case 'shopcat-clear': {
          const storeId = String(target.dataset.id || '');
          const next = await api('selectionpool.saveAutoShelfConfig', { profileId: storeId, shopCategoryNameList: [] }).catch(() => null);
          if (next) {
            ui.shelf.config = next;
            ui.message = '';
          } else {
            setDialogMessage('清空本店分类失败，请重试', true);
            return true;
          }
          render();
          return true;
        }
        case 'shelf-log-more': ui.progress.logAll = !ui.progress.logAll; render(); return true;
        case 'shelf-log-copy': {
          const q = queue();
          const text = ((q.lines || []).length ? q.lines : (ui.progress.logs || []).map(l => l.line || '')).join('\n');
          try { await navigator.clipboard.writeText(text); }
          catch { setDialogMessage('复制日志失败，请手动选中复制', true); }
          return true;
        }
        case 'shelf-shopcat': {
          // select 由 handleChange 处理
          return true;
        }
        case 'shelf-stop': {
          // 用户 2026-11-21：点停止必须马上停，不是「跑完这一单再停」
          const res = await api('selectionpool.queueStop', {}).catch(() => null);
          if (res) applyQueue(res);
          await refreshProgress(); return true;
        }
        case 'shelf-start': {
          const ids = ui.shelf.itemIds.length ? ui.shelf.itemIds : [];
          const shopIds = [...ui.shelf.shops].filter(sid => loggedIn().some(x => x.storeId === sid));
          if (!ids.length) { setDialogMessage('请先在右侧添加或从列表勾选要上架的选品', true); return true; }
          if (!shopIds.length) { setDialogMessage('请先勾选至少一家已登录的目标店铺（未登录店铺请先到「店铺登录」登录）', true); return true; }
          ui.busy = true;
          ui.message = '';
          render();
          try {
            await api('selectionpool.startAutoShelf', { itemIds: ids, storeIds: shopIds });
            ui.shelf.itemIds = [];
            open('queueProgress');
          } catch (error) {
            setDialogMessage(String(error?.message || error), true);
          } finally {
            ui.busy = false;
            render();
          }
          return true;
        }
        case 'pub-tab':
          ui.pub.tab = ['failures', 'records', 'logs', 'operators'].includes(value) ? value : 'failures';
          ui.pub.page = 1;
          await refreshPublication();
          return true;
        case 'pub-clear-item':
          ui.pub.itemId = 0;
          render();
          return true;
        case 'pub-query': {
          const el = document.querySelector('[data-dlg-pub-keyword]');
          ui.pub.keyword = String(el?.value || '');
          ui.pub.page = 1;
          if (ui.pub.tab === 'records') render();
          else await refreshPublication();
          return true;
        }
        case 'pub-refresh': await refreshPublication(); return true;
        case 'pub-page': ui.pub.page = Math.max(1, Number(value) || 1); await refreshPublication(); return true;
        case 'pub-expand': ui.pub.expanded = ui.pub.expanded === target.dataset.id ? '' : target.dataset.id; render(); return true;
        case 'pub-copy': {
          const row = (pub().rows || []).find(r => r.id === target.dataset.id);
          const text = row?.diagnostic || row?.message || '';
          try { await navigator.clipboard.writeText(text); }
          catch { setDialogMessage('复制失败，请展开原因后手动复制', true); }
          return true;
        }
        case 'pub-open-form': open('manualForm', { itemId: id }); return true;
        case 'pub-open-shop': await openShop(id, '从失败记录打开，人工核对并补全'); return true;
        case 'pub-resume': {
          const result = await api('selectionpool.resumeManualShelf', { itemId: id }).catch(error => ({ error: String(error?.message || error) }));
          if (result?.error) setDialogMessage(result.error, true);
          await reload(); await refreshPublication(); return true;
        }
        case 'resume-open-shop': await openShop(id, '继续处理没入仓的任务'); return true;
        case 'resume-continue': {
          const result = await api('selectionpool.resumeManualShelf', { itemId: id }).catch(error => ({ error: String(error?.message || error) }));
          if (result?.error) setDialogMessage(result.error, true);
          await reload(); await refreshProgress(); return true;
        }
        case 'form-section': ui.form.section = value || 'basic'; render(); return true;
        case 'form-save': {
          const result = await collectFormFields().catch(error => ({ error: String(error?.message || error) }));
          if (result?.error) ui.form.message = result.error;
          else { ui.form.message = '补全结果已回写到这条选品'; await loadForm(ui.form.itemId); await reload(); }
          render();
          return true;
        }
        case 'form-open-shop': await openShop(ui.form.itemId, '人工补全参数'); return true;
        case 'form-resume': {
          await collectFormFields().catch(() => null);
          await api('selectionpool.resumeManualShelf', { itemId: ui.form.itemId, warehouseItemId: readFormFields().warehouseItemId }).catch(() => null);
          close(); await reload(); return true;
        }
        case 'form-add-attr': {
          const nameEl = document.querySelector('[data-dlg-form-new-name]');
          const valueEl = document.querySelector('[data-dlg-form-new-value]');
          const name = String(nameEl?.value || '').trim(), val = String(valueEl?.value || '').trim();
          if (!name) { ui.form.message = '请先填参数名'; render(); return true; }
          ui.form.attributes = [...(ui.form.attributes || []), { name, value: val }];
          ui.form.message = '';
          render(); return true;
        }
        case 'form-read-category': {
          const result = await api('selectionpool.categoryReadSource', {
            itemId: ui.form.itemId, productId: ui.form.detail?.product?.id,
            platform: ui.form.detail?.product?.platform, storeId: state.storeId, refresh: true,
          }).catch(error => ({ ok: false, message: String(error?.message || error) }));
          if (result?.ok) {
            await loadForm(ui.form.itemId);
            ui.form.message = `已补读类目 ${result.data?.leafId || ''}`;
            render();
          } else {
            ui.form.message = result?.message || '没读到类目';
            render();
          }
          return true;
        }
        case 'form-category': open('category', { itemId: ui.form.itemId }); return true;
        case 'cat-source': ui.cat.profileId = target.value; await loadLevel(0, ''); return true;
        case 'cat-refresh': await loadLevel(0, ''); return true;
        case 'cat-pick': {
          const level = Number(target.dataset.level);
          const ids = ui.cat.ids.slice();
          ids[level] = target.dataset.id;
          for (let i = level + 1; i < 3; i++) ids[i] = '';
          ui.cat.ids = ids;
          if (target.dataset.leaf === '1') {
            const names = [];
            for (let i = 0; i <= level; i++) {
              const node = (ui.cat.levels[i] || []).find(n => n.id === ids[i]);
              if (node) names.push(node.name);
            }
            ui.cat.picked = { id: target.dataset.id, names, path: names.join(' / ') };
            // 选完三级叶子不要让上面两列跳回顶部（用户 2026-11-11）。
            renderKeepCatScroll();
            return true;
          }
          ui.cat.picked = null;
          await loadLevel(level + 1, target.dataset.id);
          const names = [];
          for (let i = 0; i <= level; i++) {
            const node = (ui.cat.levels[i] || []).find(n => n.id === ids[i]);
            if (node) names.push(node.name);
          }
          ui.cat.currentNames = names;
          render(); return true;
        }
        case 'cat-query': {
          const el = document.querySelector('[data-dlg-cat-keyword]');
          ui.cat.keyword = String(el?.value || '');
          const result = await api('selectionpool.categoryLookup', { keyword: ui.cat.keyword }).catch(() => null);
          ui.cat.hits = result?.hits || [];
          if (!ui.cat.hits.length) ui.cat.message = '本机还没读过这个类目；可先在三级列表里逐级展开，或点「刷新」从店铺后台读取。';
          render(); return true;
        }
        case 'cat-hit': {
          ui.cat.picked = { id: target.dataset.id, names: String(target.dataset.path || '').split(' / '), path: target.dataset.path };
          render(); return true;
        }
        case 'cat-save': {
          const result = await api('selectionpool.categorySave', { itemId: ui.cat.itemId, categoryId: ui.cat.picked?.id, categoryPath: ui.cat.picked?.path }).catch(error => ({ error: String(error?.message || error) }));
          if (result?.error) { ui.cat.message = result.error; render(); }
          else { if (ui.form.itemId === ui.cat.itemId) await loadForm(ui.cat.itemId); else close(); await reload(); }
          return true;
        }
        case 'personal-login': {
          // 复刻老软件「首页个人淘宝号」：开独立会话登录窗口，登录成功自动关窗。
          const result = await api('personaltaobao.login', {}).catch(error => ({ ok: false, message: String(error?.message || error) }));
          ui.cat.message = result?.ok ? '已打开个人淘宝号登录窗口，请在窗口里登录，登录成功会自动关闭' : (result?.message || '打不开登录窗口');
          render();
          return true;
        }
        case 'cat-read': {
          // 老软件校验 /^\d{6,20}$/：必须把商品 ID 一起传上去，否则必然报「商品 ID 不对」。
          if (!ui.cat.productId) { ui.cat.message = '这条选品还没有商品 ID，请用插件重新采集'; render(); return true; }
          const result = await api('selectionpool.categoryReadSource', { itemId: ui.cat.itemId, productId: ui.cat.productId, storeId: ui.cat.profileId, refresh: true }).catch(error => ({ ok: false, message: String(error?.message || error) }));
          ui.cat.message = result?.ok ? `已按商品 ID 补读类目 ${result.data?.leafId || ''}` : (result?.message || '没读到类目');
          if (result?.needPersonalLogin) {
            void api('personaltaobao.status', {}).then(s => { ui.cat.personal = Boolean(s?.loggedIn); render(); }).catch(() => undefined);
          }
          if (result?.ok) { close(); await reload(); }
          else render();
          return true;
        }
        default: return false;
      }
    }

    function updateQueueSelectionUi() {
      const side = document.querySelector('[data-spx-side]');
      if (!side) return;
      const q = queue();
      const items = Array.isArray(q.items) ? q.items : [];
      const removable = items.filter(isQueueRemovable);
      const selected = removable.filter(r => ui.progress.selectedQueueIds.has(r.queueId));
      const allBox = side.querySelector('[data-queue-select-all]');
      if (allBox) {
        allBox.checked = removable.length > 0 && selected.length === removable.length;
        allBox.indeterminate = selected.length > 0 && selected.length < removable.length;
        allBox.disabled = !removable.length;
      }
      const selAllBtn = side.querySelector('[data-action="selectionpool:dlg-queue-select-all"]');
      if (selAllBtn) selAllBtn.disabled = !removable.length;
      const invertBtn = side.querySelector('[data-action="selectionpool:dlg-queue-invert"]');
      if (invertBtn) invertBtn.disabled = !removable.length;

      const selCountEl = side.querySelector('[data-spx-queue-selcount]');
      if (selCountEl) {
        selCountEl.innerHTML = selected.length
          ? `已选 <b>${selected.length}</b> / 可移除 ${removable.length}`
          : (removable.length ? `可移除 <b>${removable.length}</b> 项` : '暂无可移除项');
      }
      const removeBtn = side.querySelector('[data-action="selectionpool:dlg-queue-remove"]');
      if (removeBtn) {
        removeBtn.disabled = !selected.length;
        removeBtn.textContent = selected.length ? `批量移除选定排队项 (${selected.length})` : '批量移除选定排队项';
      }
      side.querySelectorAll('[data-queue-select]').forEach(box => {
        const isChecked = ui.progress.selectedQueueIds.has(box.dataset.queueSelect);
        if (box.checked !== isChecked) box.checked = isChecked;
        box.closest('tr')?.classList.toggle('is-checked', isChecked);
      });
    }

    function handleInput(event) {
      const t = event.target;
      if (!t?.dataset) return false;
      if (t.dataset.dlgShelfPick !== undefined) {
        ui.shelf.pickKeyword = String(t.value || '');
        const listEl = document.querySelector('.spx-picker-list');
        if (listEl) {
          const allPool = poolItems();
          const stagedSet = new Set(ui.shelf.itemIds.map(Number));
          const kw = ui.shelf.pickKeyword.trim().toLowerCase();
          const candidateRows = allPool.filter(r => !kw || String(r.itemId).includes(kw) || String(r.title || '').toLowerCase().includes(kw) || String(r.shopName || '').toLowerCase().includes(kw));
          const priceYuan = fen => (fen == null || !Number.isFinite(Number(fen)) ? '—' : `¥${(Number(fen) / 100).toFixed(2)}`);
          listEl.innerHTML = candidateRows.length ? candidateRows.slice(0, 60).map(r => {
            const inBatch = stagedSet.has(Number(r.itemId));
            return `<div class="spx-picker-row${inBatch ? ' is-added' : ''}">
              <span class="spx-picker-id">#${esc(r.itemId)}</span>
              <span class="spx-picker-title clip" title="${esc(r.title || '')}">${esc(r.title || '未命名商品')}</span>
              <span class="spx-picker-price">${esc(priceYuan(r.priceFen))}</span>
              <button type="button" class="button small ${inBatch ? '' : 'primary'}" data-action="selectionpool:dlg-batch-add" data-id="${esc(r.itemId)}" ${inBatch ? 'disabled' : ''}>${inBatch ? '已在清单' : '+ 加入'}</button>
            </div>`;
          }).join('') : '<div class="spx-note spx-empty">没有匹配的商品。</div>';
        }
        return true;
      }
      if (t.dataset.shelfPrice !== undefined) {
        const current = { ...cfg(), [t.dataset.shelfPrice]: String(t.value || '') };
        ui.shelf.config = current;
        const eg = document.querySelector('[data-spx-price-eg]');
        if (eg) eg.textContent = previewPriceText(current);
        return true;
      }
      if (t.dataset.dlgPubKeyword !== undefined) { ui.pub.keyword = String(t.value || ''); return true; }
      if (t.dataset.dlgCatKeyword !== undefined) { ui.cat.keyword = String(t.value || ''); return true; }
      if (t.dataset.dlgFormNewName !== undefined || t.dataset.dlgFormNewValue !== undefined) return true;
      if (t.dataset.dlgForm !== undefined || t.dataset.dlgFormAttr !== undefined) return true;
      return false;
    }

    function handleChange(event) {
      const t = event.target;
      if (!t?.dataset) return false;
      if (t.dataset.action === 'selectionpool:dlg-shopcat-pick') {
        // 店铺中分类多选：把该店当前所有勾选的名字整体保存（勾/取消都走这里，不弹右下角 toast）
        const storeId = String(t.dataset.id || '');
        const names = Array.from(document.querySelectorAll('[data-action="selectionpool:dlg-shopcat-pick"]'))
          .filter(box => String(box.dataset.id || '') === storeId && box.checked)
          .map(box => String(box.dataset.name || ''))
          .filter(Boolean);
        void api('selectionpool.saveAutoShelfConfig', { profileId: storeId, shopCategoryNameList: names }).then(next => {
          if (next) ui.shelf.config = next;
          ui.message = '';
          render();
        }).catch(() => setDialogMessage('店铺中分类保存失败，请重试', true));
        return true;
      }
      if (t.dataset.queueSelect !== undefined) {
        const qid = String(t.dataset.queueSelect || '');
        if (qid) {
          t.checked ? ui.progress.selectedQueueIds.add(qid) : ui.progress.selectedQueueIds.delete(qid);
          updateQueueSelectionUi();
        }
        return true;
      }
      if (t.dataset.queueSelectAll !== undefined) {
        const q = queue();
        const removable = (q.items || []).filter(isQueueRemovable);
        if (t.checked) {
          for (const r of removable) ui.progress.selectedQueueIds.add(r.queueId);
        } else {
          for (const r of removable) ui.progress.selectedQueueIds.delete(r.queueId);
        }
        updateQueueSelectionUi();
        return true;
      }
      if (t.dataset.shelfPrice !== undefined) {
        const key = t.dataset.shelfPrice;
        const val = String(t.value || '');
        void api('selectionpool.saveAutoShelfConfig', { [key]: val }).then(next => {
          if (next) ui.shelf.config = next;
          const eg = document.querySelector('[data-spx-price-eg]');
          if (eg) eg.textContent = previewPriceText(ui.shelf.config || cfg());
        }).catch(() => undefined);
        return true;
      }
      const action = t.dataset.action || '';
      if (action === 'selectionpool:dlg-shelf-shop') {
        const key = t.dataset.id;
        t.checked ? ui.shelf.shops.add(key) : ui.shelf.shops.delete(key);
        ui.message = '';
        render();
        // 新勾上的店铺：缓存里有店铺中分类就直接带出来（不主动开窗口）
        if (t.checked) void loadShelfCats({ ids: [key] });
        return true;
      }
      if (action === 'selectionpool:dlg-shelf-config') {
        const key = t.dataset.key;
        const val = t.type === 'checkbox' ? t.checked : t.value;
        void api('selectionpool.saveAutoShelfConfig', { [key]: val }).then(next => {
          if (next) ui.shelf.config = next;
          render();
        }).catch(() => undefined);
        return true;
      }
      if (action === 'selectionpool:dlg-cat-source' || action === 'selectionpool:dlg-shelf-shopcat-refresh') {
        void handleAction(action, t);
        return true;
      }
      return false;
    }

    /**
     * 队列进度实时更新：局部更新进度条、KPI、日志和右侧排队表格，保留用户复选框与滚动条位置。
     */
    function applyQueue(q) {
      if (!q) return;
      ui.progress.queue = q;
      ui.shelf.queue = q;
      if (data()) data().queue = q;
      pruneQueueSelection(q);

      const s = queueSideStats(q);
      const tabProg = document.querySelector('[data-spx-tab-progress]');
      if (tabProg) {
        const progCount = (q.running || s.items.length) ? ` (${s.done}/${s.total})` : '';
        tabProg.textContent = `查看进度${progCount}`;
      }

      if (ui.name === 'autoShelf') {
        const hasBanner = Boolean(document.querySelector('[data-spx-live-banner]'));
        const active = document.activeElement;
        const editing = active && active.closest && active.closest('.spx-dialog') && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
        if (Boolean(q.running) !== hasBanner && !editing) {
          render();
          return;
        }
        const banner = document.querySelector('[data-spx-live-banner] .spx-live-text');
        if (banner) {
          banner.innerHTML = `正在上架第 <b>${Math.min(s.done + 1, s.total)}/${s.total}</b> 件（成功 ${s.ok} · 失败 ${s.fail} · 排队 ${s.queuedCount}）· 本次确认将自动<b>新增到当前排队序列末尾</b>`;
        }
        return;
      }
      if (ui.name !== 'queueProgress') return;

      const kpi = document.querySelector('[data-spx-kpi]');
      if (kpi) {
        kpi.innerHTML = `
          <div class="spx-kpi"><span>总进度</span><b>${s.percent}%</b><small>${s.done} / ${s.total} 件</small></div>
          <div class="spx-kpi ok"><span>已入仓</span><b>${s.ok}</b><small>成功放入仓库</small></div>
          <div class="spx-kpi bad"><span>上架失败</span><b>${s.fail}</b><small>需查看原因或补全</small></div>
          <div class="spx-kpi wait"><span>排队等待</span><b>${s.queuedCount}</b><small>可在右侧勾选移除</small></div>`;
      }
      const head = document.querySelector('[data-spx-progress]');
      if (head) {
        head.textContent = s.running ? `正在上架：选品#${s.running.itemId} · ${short(queueTitle(s.running), 36)}` : s.current;
      }
      const meta = document.querySelector('[data-spx-spotlight-meta]');
      if (meta) {
        meta.textContent = s.running ? `${s.running.shopName || '目标店铺'} · 已用时 ${elapsed(s.running.startedAt)}` : `${s.done}/${s.total} (${s.percent}%)`;
      }
      const msg = document.querySelector('[data-spx-spotlight-msg]');
      if (msg) {
        msg.textContent = q.title || (s.running ? '正在执行店铺发布页填充…' : '队列日志与每件商品实时详情会在这里持续更新。');
      }
      const bar = document.querySelector('[data-spx-progress-bar]');
      if (bar) bar.value = s.percent;
      const stopBtn = document.querySelector('[data-spx="queueProgress"] [data-action="selectionpool:dlg-shelf-stop"]');
      if (stopBtn) {
        stopBtn.disabled = !(q.running && !q.stopRequested);
        stopBtn.textContent = q.stopRequested ? '正在停止…' : '停止上架';
      }

      const side = document.querySelector('[data-spx-side]');
      if (side) {
        const current = side.querySelector('[data-spx-side-current]');
        if (current) current.textContent = `排队中 ${s.queuedCount} · 合计 ${s.items.length}`;
        const percent = side.querySelector('[data-spx-side-percent]');
        if (percent) percent.textContent = `${s.percent}%`;
        const wrap = side.querySelector('.spx-queue-table-wrap');
        const list = side.querySelector('[data-spx-side-list]');
        if (list) {
          const atBottom = wrap ? (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 30) : false;
          const savedTop = wrap ? wrap.scrollTop : 0;
          list.innerHTML = s.items.length
            ? s.items.map((r, i) => queueTableRow(r, i)).join('')
            : `<tr class="spx-queue-empty-row"><td colspan="6"><div class="spx-side-empty">当前没有排队的商品。可切换到「上架设置」选项卡新增商品并确认上架。</div></td></tr>`;
          if (wrap) wrap.scrollTop = atBottom ? wrap.scrollHeight : savedTop;
        }
        updateQueueSelectionUi();
      }

      const logEl = document.querySelector('[data-spx-log]');
      const logCount = document.querySelector('[data-spx-log-count]');
      const lines = Array.isArray(q.lines) ? q.lines : [];
      if (logCount) logCount.textContent = `${lines.length} 行`;
      if (logEl) {
        // 用户自己往上翻过就别再把他拉回底部（wheel/拖动滚动条都算）
        if (!logEl.dataset.followBound) {
          logEl.dataset.followBound = '1';
          const stopFollow = () => { ui.progress.autoFollow = false; };
          logEl.addEventListener('wheel', stopFollow, { passive: true });
          logEl.addEventListener('touchstart', stopFollow, { passive: true });
          logEl.addEventListener('scroll', () => {
            if (logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight > 40) ui.progress.autoFollow = false;
          }, { passive: true });
        }
        if (lines.length) {
          const atBottom = ui.progress.autoFollow
            || logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
          const savedTop = logEl.scrollTop;
          const slice = ui.progress.logAll ? lines.slice(-600) : lines.slice(-80);
          logEl.innerHTML = slice.map(line => `<div>${esc(line)}</div>`).join('');
          logEl.scrollTop = atBottom ? logEl.scrollHeight : savedTop;
          ui.progress.autoFollow = false;
        }
      }
    }

    window.setInterval(() => {
      if (ui.name !== 'queueProgress' && ui.name !== 'autoShelf') return;
      const q = queue();
      if (!q.running) return;
      const active = document.activeElement;
      if (active && active.closest && active.closest('.spx-dialog') && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
      void api('selectionpool.queueStatus', {}).then(next => {
        if (next) applyQueue(next);
      }).catch(() => undefined);
    }, 2000);

    return { render: renderDialogs, handleAction, handleInput, handleChange, open, close, isOpen, refreshShelf, refreshProgress, refreshPublication, applyQueue };
  }

  // 注意：selectionpool.js 的 create() 会在这里挂一个 instance 属性供 editor.js 复用，
  // 所以不能用 Object.freeze——否则写入 instance 时抛 “Cannot add property instance”
  // 会导致 app.js 创建上品库模块时整段 IIFE 崩溃、登录页永久停在「正在自动登录…」。
  window.XXSelectionPoolDialogs = { create };
})();
