'use strict';

/**
 * 上品库 · 独立功能区渲染层（window.XXSelectionPool）
 *
 * UI 依据用户提供的老软件截图 1:1 复刻：
 *   工具条「总览 / 导出CSV / 上架日志 / 上架记录 / 本机图片 / 图片模板 / 失败N·查看 / 累计上品成功N」
 *   「列表 / 图墙」「我的选品 / 团队选品」「刷新 / 回操作界面图片 / 自动上架」
 *   筛选行「商品/ID/店铺 · 全部分组 · 全部平台 · 全部状态 · 最近加入 · 全部可见团队 · 全部成员 · 查询 · 重置」
 *   「加入时间：全部/今天/昨天/近7天/近30天/自定义」
 *   表格「商品 / 加入时间 / 作图图片 / 流程 / 分组·标签 / 归属 / 操作」
 *   流程列三步圆点「① 作图 → ② 已入仓(或上架失败) → ③ 已回填」
 *   操作列「图片 / 详情 / 上架 / 打开 / 删除 / 上架记录」
 *   底部「共 N 条 · 本页 N 条 第 1/1 页 · 50 条/页」
 *
 * ★ 用户明确要求：**不带面包屑**。本页不渲染任何 breadcrumb / 页面大标题，
 *   且 page id 为独立顶级项 `selectionpool`（不进 navigation.selectionPages），
 *   因此 navigation.wrap() 也不会给它套「选品」二级 tab。
 *
 * 本模块完全自包含：只使用注入的 helper，不引入新依赖、不使用内联脚本（CSP: script-src 'self'）。
 */

(() => {
  const FLOW_LABELS = {
    todraw: '待作图', drawing: '作图中', tolist: '待上架', landed: '已入仓',
    tofill: '待回填', done: '已完成', publishFailed: '上架失败',
  };
  const PLATFORM_LABELS = { taobao: '淘宝', tmall: '天猫', '1688': '1688' };
  /* ---- 加入时间：日期区间（用户 2026-11-21 要求按「2026-11-15 00:00:00 - 2026-11-20 23:59:59」这种形式展示） ---- */
  const pad2 = v => String(v).padStart(2, '0');
  const fmtDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const dayStart = d => `${fmtDay(d)} 00:00:00`;
  const dayEnd = d => `${fmtDay(d)} 23:59:59`;
  // 界面按本机时间显示，查询转成 ISO（后端存的是 UTC，直接比字符串会差 8 小时）
  const toIsoTime = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const date = new Date(raw.replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  };
  const monthKeyOf = date => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  const monthDate = key => { const [y, m] = String(key || '').split('-').map(Number); return new Date(y || new Date().getFullYear(), (m || 1) - 1, 1); };
  const shiftMonth = (key, delta) => { const d = monthDate(key); d.setMonth(d.getMonth() + delta); return monthKeyOf(d); };
  const monthCells = key => {
    const first = monthDate(key);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const out = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push({ date: fmtDay(d), day: d.getDate(), inMonth: d.getMonth() === first.getMonth() });
    }
    return out;
  };
  const DATE_QUICK = [
    ['today', '今天'], ['yesterday', '昨天'], ['before', '前天'],
    ['d3', '最近3天'], ['d7', '最近7天'], ['d15', '最近15天'], ['d30', '最近30天'],
    ['month', '本月'], ['lastMonth', '上个月'],
  ];
  const SORTS = [['newest', '最近加入'], ['oldest', '最早加入'], ['price_asc', '价格从低到高'], ['price_desc', '价格从高到低']];

  function create(deps) {
    const {
      state, api, esc, button, badge, panel, notice, empty, table,
      toast, render, loadPage, modal, showError, dateTime, moduleData, svg, navigate, editor,
    } = deps;
    // editor 是延迟注入的独立模块（window.XXSelectionPoolEditor），点「详情 / 图片」时打开。
    const editorUi = () => (typeof editor === 'function' ? editor() : null);

    // 功能区内部状态（独立于 app.js 的 state，重绘不丢失）
    const ui = {
      view: 'list',            // list | gallery
      scope: 'mine',           // mine | team
      keyword: '', group: 'all', platform: 'all', status: 'all',
      sort: 'newest', team: 'all', owner: 'all', range: 'all',
      // 加入时间区间（空 = 全部）；dateDraft 是弹层里正在编辑、点「确定」才生效
      dateRange: { start: '', end: '' },
      dateOpen: false,
      dateDraft: { start: '', end: '' },
      dateMonth: '',
      datePicking: 'start',
      dateRecent: { on: false, days: 7 },
      page: 1, size: 50,
      selected: new Set(),
      dialog: '',              // overview | logs | shelf | templates | localImages | apiConfig | detail
      detail: null,
      data: null,
      busy: false,
      message: '',
      drawingPair: null,       // AI作图 接口配对状态（接口配置弹窗内展示）
      localImages: null,       // 本机图片缓存统计（本机图片弹窗内展示）
      tpl: { tab: 'detail', selectedId: 0, draft: null, dirty: false, uploading: false },
    };

    const data = () => ui.data || moduleData('selectionpool') || {};
    // 老软件四组弹窗（自动上架日志 / 上品记录 / 表单填写窗口 / 类目面板）独立成模块。
    const dialogs = window.XXSelectionPoolDialogs ? window.XXSelectionPoolDialogs.create({
      api, esc, svg, toast, render, state, button, navigate, data, reload,
      openShopPage: info => openShopPage(info),
      registerManualFixes: (result, open) => registerManualFixes(result, open),
    }) : null;
    if (dialogs) window.XXSelectionPoolDialogs.instance = dialogs;
    const rows = () => (data().items || []);
    const stats = () => data().stats || { total: 0, failed: 0, publishSuccess: 0, landed: 0, filled: 0, todraw: 0 };
    const shops = () => (data().shopStates?.stores || []);
    const loggedIn = () => (data().shopStates?.loggedIn || []);

    function query(extra = {}) {
      return {
        keyword: ui.keyword, group: ui.group, platform: ui.platform, status: ui.status,
        sort: ui.sort, team: ui.team, owner: ui.owner, scope: ui.scope,
        recentDays: 0,
        start: toIsoTime(ui.dateRange.start),
        end: toIsoTime(ui.dateRange.end),
        page: ui.page, size: ui.size, ...extra,
      };
    }

    async function reload() {
      try {
        ui.data = await api('selectionpool.load', query());
        ui.message = '';
      } catch (error) { showError(error); }
      render();
    }

    async function call(method, payload = {}, { success = '', after = true } = {}) {
      if (ui.busy) return null;
      ui.busy = true; render();
      try {
        const result = await api(`selectionpool.${method}`, payload);
        if (success) toast(success);
        if (after) await reload();
        else render();
        return result;
      } catch (error) { showError(error); return null; }
      finally { ui.busy = false; render(); }
    }

    // ---------------------------------------------------------------- 小组件
    const money = fen => (fen == null || !Number.isFinite(Number(fen))) ? '—' : `¥${(Number(fen) / 100).toFixed(2)}`;
    const shortAt = value => {
      const text = String(value || '');
      if (!text) return '—';
      const d = new Date(text);
      if (Number.isNaN(d.getTime())) return text.slice(0, 16);
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const clip = (value, n = 30) => {
      const t = String(value || '');
      return t.length > n ? `${t.slice(0, n)}…` : t;
    };

    /** 流程列：三步圆点，与截图一致（② 失败显示红色感叹号）。 */
    function pipeline(row) {
      const flow = String(row.flow || 'todraw');
      const failed = flow === 'publishFailed';
      const drawDone = ['tolist', 'landed', 'tofill', 'done', 'publishFailed'].includes(flow);
      const drawRunning = flow === 'drawing';
      const landed = ['landed', 'tofill', 'done'].includes(flow);
      const filled = flow === 'done';
      const dot = (n, label, kind, text) => `<span class="sp-step sp-${kind}" title="${esc(text || label)}"><i>${kind === 'failed' ? '!' : kind === 'done' ? '✓' : n}</i><small>${esc(text || label)}</small></span>`;
      return `<div class="sp-pipeline">
        ${dot(1, '作图', drawDone ? 'done' : drawRunning ? 'running' : 'wait', '作图')}
        <span class="sp-line"></span>
        ${dot(2, '已入仓', failed ? 'failed' : landed ? 'done' : 'wait', failed ? '上架失败' : '已入仓')}
        <span class="sp-line"></span>
        ${dot(3, '已回填', filled ? 'done' : flow === 'tofill' ? 'running' : 'wait', flow === 'tofill' ? '回填' : '已回填')}
      </div>`;
    }

    function shopStatusStrip() {
      const list = shops();
      const ok = loggedIn();
      if (!list.length) return `<div class="sp-shop-strip sp-warn">${svg('info')}<span>尚未登记店铺。请到「店铺登录」添加并登录店铺后，上品库才能读取登录状态与执行上架。</span></div>`;
      const chips = list.map(s => `<span class="sp-shop-chip sp-${esc(s.state)}" title="检查时间：${esc(s.checkedAt || '—')}"><i></i>${esc(s.name || '未命名店铺')} · ${esc(s.label || '未知')}</span>`).join('');
      return `<div class="sp-shop-strip ${ok.length ? '' : 'sp-warn'}">
        ${svg('store')}<strong>店铺登录状态</strong>
        <span class="sp-shop-summary">已登录 ${ok.length} / ${list.length}</span>
        <div class="sp-shop-chips">${chips}</div>
        <button type="button" class="link-button" data-action="selectionpool:refresh-shops">刷新状态</button>
      </div>`;
    }

    /**
     * 待人工补全条：上架失败 / 参数不全时显示，可打开店铺发布页手动填写。
     * 与老软件一致，由用户点「我已填好，继续」才推进，不会自动谎报入仓。
     */
    function manualFixBar() {
      const rows = (data().manualFix || []).slice(0, 5);
      if (!rows.length) return '';
      return `<div class="sp-manual-fix">
        ${rows.map(row => `<div class="sp-manual-row">
          <div class="sp-manual-text"><strong>选品 #${esc(row.itemId)} 待人工补全</strong>
            <span>${esc(clip(row.title || '', 40))}${row.reason ? ` · ${esc(clip(row.reason, 60))}` : ''}</span></div>
          <div class="sp-manual-actions">
            <button type="button" class="button small" data-action="selectionpool:manual-open" data-id="${esc(row.itemId)}">打开店铺页面</button>
            <button type="button" class="button small" data-action="selectionpool:manual-fill" data-id="${esc(row.itemId)}">填写补全结果</button>
            <button type="button" class="button primary small" data-action="selectionpool:manual-resume" data-id="${esc(row.itemId)}">我已填好，继续</button>
            <button type="button" class="link-button" data-action="selectionpool:manual-dismiss" data-id="${esc(row.itemId)}">关闭</button>
          </div></div>`).join('')}
      </div>`;
    }

    function queueElapsed() {
      const q = data().queue || {};
      if (!q.startedAt) return '0 秒';
      const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(q.startedAt)) / 1000));
      if (seconds < 60) return `${seconds} 秒`;
      return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
    }

    function toolBar() {
      const s = stats();
      const q = data().queue || {};
      const t = (label, action, extra = {}) => `<button type="button" class="sp-tool ${extra.class || ''}" data-action="selectionpool:${action}" ${extra.attrs || ''}>${extra.icon ? svg(extra.icon) : ''}${esc(label)}</button>`;
      const failCount = Number(s.failed) || 0;
      const successCount = Number(s.publishSuccess) || 0;
      return `<div class="sp-toolbar">
        <div class="sp-toolbar-main">
          <button type="button" class="button primary small sp-primary-shelf" data-action="selectionpool:auto-shelf" ${ui.busy ? 'disabled' : ''}>${svg('arrow')}自动上架${ui.selected.size ? ` (${ui.selected.size})` : ''}</button>
          <button type="button" class="sp-tool sp-queue${q.running ? ' sp-queue-live' : ''}" data-action="selectionpool:show-queue" title="打开上架进度">${svg('clock')}${q.running ? `上架中 ${Number(q.done) || 0}/${Number(q.total) || 0} · ${esc(queueElapsed())} · 查看进度` : '查看进度'}</button>
          <div class="sp-track-group" role="group" aria-label="上品记录与执行状态">
            <button type="button" class="sp-track-item" data-action="selectionpool:shelf" title="打开上品记录中心（成功入仓 / 失败排查 / 执行日志）">${svg('folder')}上品记录</button>
            <button type="button" class="sp-track-item sp-track-success" data-action="selectionpool:show-success" title="查看已成功入仓记录">成功 <b>${successCount}</b></button>
            <button type="button" class="sp-track-item sp-track-fail${failCount ? ' has-fail' : ''}" data-action="selectionpool:show-failed" title="查看上架失败记录并排查">失败 <b>${failCount}</b></button>
            <button type="button" class="sp-track-item" data-action="selectionpool:logs" title="查看每次自动上架执行日志">${svg('clock')}执行日志</button>
          </div>
          ${t('库存总览', 'overview', { icon: 'home' })}
        </div>
        <div class="sp-toolbar-side">
          <div class="segmented sp-seg">${[['list', '列表'], ['gallery', '图墙']].map(([v, l]) => `<button type="button" class="${ui.view === v ? 'active' : ''}" data-action="selectionpool:view" data-value="${v}">${l}</button>`).join('')}</div>
          <div class="segmented sp-seg">${[['mine', '我的选品'], ['team', '团队选品']].map(([v, l]) => `<button type="button" class="${ui.scope === v ? 'active' : ''}" data-action="selectionpool:scope" data-value="${v}">${l}</button>`).join('')}</div>
        </div>
      </div>
      <div class="sp-toolbar-second">
        <button type="button" class="button small" data-action="selectionpool:refresh">${svg('refresh')}刷新</button>
        <span class="sp-toolbar-divider" aria-hidden="true"></span>
        ${t('图片模板', 'templates', { icon: 'image' })}
        ${t('图片缓存', 'local-images', { icon: 'image' })}
        ${t('导出 CSV', 'export-csv', { icon: 'export' })}
        ${t('接口配置', 'api-config', { icon: 'settings' })}
        <span class="spacer"></span>
        ${ui.selected.size ? `<span class="sp-selected-count">已选 <b>${ui.selected.size}</b> 件</span>` : ''}
        ${button('删除已选', 'selectionpool:remove-selected', { small: true, danger: true, disabled: !ui.selected.size })}
      </div>`;
    }

    function filterBar() {
      const d = data();
      const select = (action, current, options, label) => `<select class="sp-select" data-action="selectionpool:${action}" aria-label="${esc(label)}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(current) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      const groups = [['all', '全部分组'], ...(d.groups || []).map(g => [g, g])];
      const platforms = [['all', '全部平台'], ['taobao', '淘宝'], ['tmall', '天猫'], ['1688', '1688']];
      const statuses = [['all', '全部状态'], ...Object.entries(FLOW_LABELS).map(([v, l]) => [v, l])];
      const teams = [['all', '全部可见团队'], ...(d.teams || []).map(t => [t, t])];
      const owners = [['all', '全部成员'], ...(d.owners || []).map(o => [o, o])];
      return `<div class="sp-filterbar">
        <input class="search-input sp-search" data-sp-keyword value="${esc(ui.keyword)}" placeholder="商品 / ID / 店铺" aria-label="搜索选品">
        ${select('filter-group', ui.group, groups, '全部分组')}
        ${select('filter-platform', ui.platform, platforms, '全部平台')}
        ${select('filter-status', ui.status, statuses, '全部状态')}
        ${select('filter-sort', ui.sort, SORTS, '排序')}
        ${select('filter-team', ui.team, teams, '全部可见团队')}
        ${select('filter-owner', ui.owner, owners, '全部成员')}
        <button type="button" class="button primary small" data-action="selectionpool:query">查询</button>
        <button type="button" class="button small" data-action="selectionpool:reset">重置</button>
      </div>
      <div class="sp-rangebar">
        <span class="sp-range-label">加入时间</span>
        <div class="sp-daterange-wrap">
          <button type="button" class="sp-daterange${ui.dateRange.start || ui.dateRange.end ? ' has-value' : ''}" data-action="selectionpool:date-open" aria-label="选择加入时间区间">
            ${svg('clock')}
            ${ui.dateRange.start || ui.dateRange.end
              ? `<span class="sp-daterange-val">${esc(ui.dateRange.start || '不限')}</span><i>-</i><span class="sp-daterange-val">${esc(ui.dateRange.end || '不限')}</span>`
              : '<span class="sp-daterange-placeholder">全部时间</span>'}
            <em class="sp-daterange-caret">▾</em>
          </button>
          ${ui.dateOpen ? datePopover() : ''}
        </div>
        ${ui.dateRange.start || ui.dateRange.end ? '<button type="button" class="filter-chip" data-action="selectionpool:date-clear">清空</button>' : ''}
        <span class="spacer"></span>
      </div>`;
    }

    /** 加入时间的双月日历弹层（快捷区间 + 起止日期时间 + 最近 N 天）。 */
    function datePopover() {
      const draft = ui.dateDraft;
      const leftKey = ui.dateMonth || monthKeyOf(new Date());
      const rightKey = shiftMonth(leftKey, 1);
      const startDay = String(draft.start || '').slice(0, 10);
      const endDay = String(draft.end || '').slice(0, 10);
      const timeOf = (value, fallback) => String(value || '').slice(11, 19) || fallback;
      const monthPanel = key => {
        const first = monthDate(key);
        const cells = monthCells(key);
        return `<div class="sp-cal">
          <div class="sp-cal-head">
            <button type="button" class="sp-cal-nav" data-action="selectionpool:date-nav" data-dir="-1" aria-label="上个月">‹</button>
            <b>${first.getFullYear()}年${first.getMonth() + 1}月</b>
            <button type="button" class="sp-cal-nav" data-action="selectionpool:date-nav" data-dir="1" aria-label="下个月">›</button>
          </div>
          <div class="sp-cal-week">${['日', '一', '二', '三', '四', '五', '六'].map(w => `<span>${w}</span>`).join('')}</div>
          <div class="sp-cal-grid">${cells.map(cell => {
            const inRange = Boolean(startDay && endDay && cell.date > startDay && cell.date < endDay);
            const cls = ['sp-cal-day', cell.inMonth ? '' : 'out', cell.date === startDay ? 'start' : '', cell.date === endDay ? 'end' : '', inRange ? 'in' : ''].filter(Boolean).join(' ');
            return `<button type="button" class="${cls}" data-action="selectionpool:date-pick" data-date="${cell.date}">${cell.day}</button>`;
          }).join('')}</div>
        </div>`;
      };
      return `<div class="sp-datepop">
        <button type="button" class="sp-datepop-mask" data-action="selectionpool:date-close" aria-label="关闭时间选择"></button>
        <div class="sp-datepop-panel" role="dialog" aria-label="加入时间区间">
          <div class="sp-datepop-quick">${DATE_QUICK.map(([v, l]) => `<button type="button" class="filter-chip" data-action="selectionpool:date-quick" data-value="${v}">${l}</button>`).join('')}</div>
          <div class="sp-datepop-fields">
            <input class="sp-input" type="date" data-sp-date-field="startDate" value="${esc(startDay)}" aria-label="开始日期">
            <input class="sp-input" type="time" step="1" data-sp-date-field="startTime" value="${esc(timeOf(draft.start, '00:00:00'))}" aria-label="开始时间">
            <span>-</span>
            <input class="sp-input" type="date" data-sp-date-field="endDate" value="${esc(endDay)}" aria-label="结束日期">
            <input class="sp-input" type="time" step="1" data-sp-date-field="endTime" value="${esc(timeOf(draft.end, '23:59:59'))}" aria-label="结束时间">
          </div>
          <div class="sp-datepop-cals">${monthPanel(leftKey)}${monthPanel(rightKey)}</div>
          <div class="sp-datepop-foot">
            <label class="sp-datepop-recent"><input type="checkbox" data-sp-date-recent ${ui.dateRecent.on ? 'checked' : ''}><span>最近</span><input class="sp-input mini" type="number" min="1" max="365" value="${Number(ui.dateRecent.days) || 7}" data-sp-date-days><span>天（含今天）</span></label>
            <span class="spacer"></span>
            <button type="button" class="button small" data-action="selectionpool:date-clear">清空</button>
            <button type="button" class="button primary small" data-action="selectionpool:date-apply">确定</button>
          </div>
        </div>
      </div>`;
    }

    function actionCell(row) {
      const id = row.itemId;
      const l = (label, action, extra = '') => `<button type="button" class="link-button" data-action="selectionpool:${action}" data-id="${id}" ${extra}>${esc(label)}</button>`;
      return `<div class="sp-actions">
        ${l('图片', 'images')}${l('详情', 'detail')}${l('上架', 'publish-one')}${l('打开', 'open')}
        <span class="sp-actions-second">${l('店铺页', 'manual-open')}${l('删除', 'remove-one', 'class="sp-danger"')}${l('上架记录', 'shelf-one')}</span>
      </div>`;
    }

    function productCell(row) {
      const img = /^https:\/\//i.test(row.imageUrl || '')
        ? `<img class="sp-thumb" src="${esc(row.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : `<span class="sp-thumb sp-thumb-empty">${svg('image')}</span>`;
      return `<div class="sp-product">${img}<div class="sp-product-text">
        <span class="cell-main clip">${esc(clip(row.title || '未命名商品', 30))}</span>
        <span class="cell-sub mono">${esc(PLATFORM_LABELS[row.platform] || row.platform || '—')} · ${esc(row.productId || '—')} · ${esc(row.shopName || '—')} · ${esc(money(row.priceFen) === '—' ? (row.priceLabel || '—') : money(row.priceFen))}</span>
      </div></div>`;
    }

    function imageSlotsCell(row) {
      const slots = row.slots || [];
      const filled = slots.filter(s => s.state === 'filled').length;
      const changed = slots.filter(s => s.state === 'changed').length;
      return `<div class="sp-image-cell">
        <button type="button" class="sp-add-image" data-action="selectionpool:images" data-id="${row.itemId}" title="作图 / 管理图片">+</button>
        <span class="cell-sub">${slots.length ? `${filled}/${slots.length} 已回填${changed ? ` · ${changed} 待重新回填` : ''}` : '待作图请编码'}</span>
      </div>`;
    }

    function listView() {
      const d = data();
      const headers = [
        `<input type="checkbox" class="table-select" data-action="selectionpool:select-all" aria-label="选择当前页全部选品">`,
        '商品', '加入时间', '作图图片', '流程', '分组 / 标签', '归属', '操作',
      ];
      const body = rows().map(row => `<tr class="sp-row" data-action="selectionpool:images" data-id="${row.itemId}" title="点这一行的任意空白处都会打开商品图片工作台">
        <td class="select-col"><input type="checkbox" class="table-select" data-action="selectionpool:toggle-select" data-id="${row.itemId}" data-sp-select="${row.itemId}" ${ui.selected.has(row.itemId) ? 'checked' : ''} aria-label="选择 ${esc(clip(row.title, 20))}"></td>
        <td class="title-cell">${productCell(row)}</td>
        <td class="nowrap mono">${esc(shortAt(row.addedAt))}</td>
        <td>${imageSlotsCell(row)}</td>
        <td>${pipeline(row)}</td>
        <td class="nowrap">${row.groupName ? badge(esc(row.groupName)) : '—'}${(row.tags || []).length ? `<span class="cell-sub">${esc(row.tags.slice(0, 3).join('、'))}</span>` : ''}</td>
        <td class="nowrap">${esc(row.ownerName || '—')}</td>
        <td class="col-actions">${actionCell(row)}</td>
      </tr>`).join('');
      const total = d.total || 0;
      const page = d.page || 1;
      const size = d.size || 50;
      const pages = Math.max(1, Math.ceil(total / size));
      const footer = `<div class="table-footer sp-footer">
        <span>共 ${total} 条 · 本页 ${rows().length} 条 第 ${page}/${pages} 页</span>
        <div class="actions">
          ${button('上一页', 'selectionpool:page-prev', { small: true, disabled: page <= 1 })}
          ${button('下一页', 'selectionpool:page-next', { small: true, disabled: page >= pages })}
          <select class="sp-select sp-pagesize" data-action="selectionpool:pagesize" aria-label="每页条数">
            ${[50, 100, 200].map(n => `<option value="${n}" ${size === n ? 'selected' : ''}>${n} 条/页</option>`).join('')}
          </select>
        </div>
      </div>`;
      return table(headers, body, empty('上品库还是空的', '用 AI作图插件 采集竞品页后推送到本机，或在「接口配置」里启用本地接收端点。', '', 'folder')) + footer;
    }

    function galleryView() {
      if (!rows().length) return empty('上品库还是空的', '采集后即可在这里看到商品卡片。', '', 'folder');
      return `<div class="sp-gallery">${rows().map(row => `<div class="sp-card">
        <div class="sp-card-img">${/^https:\/\//i.test(row.imageUrl || '') ? `<img src="${esc(row.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : svg('image')}</div>
        <div class="sp-card-body"><strong class="clip">${esc(clip(row.title || '未命名商品', 26))}</strong>
          <span class="cell-sub mono">${esc(row.productId || '—')} · ${esc(money(row.priceFen))}</span>
          ${pipeline(row)}<div class="sp-card-actions">${actionCell(row)}</div></div>
      </div>`).join('')}</div>`;
    }

    // ---------------------------------------------------------------- 弹窗内容
    function dialogBody() {
      const d = data();
      if (ui.dialog === 'overview') {
        const s = stats();
        return `<div class="sp-stat-grid">
          ${[['选品总数', s.total], ['待作图', s.todraw], ['已入仓', s.landed], ['已完成回填', s.filled], ['上架失败', s.failed], ['累计上品成功', s.publishSuccess]]
            .map(([l, v]) => `<div class="stat"><div class="stat-label">${esc(l)}</div><div class="stat-value">${v}</div></div>`).join('')}
        </div>${d.storage ? notice(`数据存储：${esc(d.storage.root)} —— ${esc(d.storage.note)}`) : ''}`;
      }
      if (ui.dialog === 'logs') {
        const lines = d.logs || [];
        return `<div class="sp-log-list">${lines.length ? [...lines].reverse().slice(0, 200).map(l => `<div class="sp-log-line"><span class="mono">${esc(l.t || '')}</span> ${esc(l.line || '')}</div>`).join('') : '<p class="inline-note">暂无上架日志</p>'}</div>`;
      }
      if (ui.dialog === 'shelf') {
        const records = d.shelfRecords || [];
        return `<div class="sp-log-list">${records.length ? [...records].reverse().slice(0, 200).map(r => `<div class="sp-log-line"><span class="mono">${esc(r.at || '')}</span> 选品#${esc(r.itemId)} → ${esc(r.shopName || '')} 仓库商品 ${esc(r.warehouseItemId || '—')} · ${esc(r.status || '')}</div>`).join('') : '<p class="inline-note">暂无上架记录</p>'}</div>`;
      }

      if (ui.dialog === 'localImages') {
        const info = ui.localImages;
        if (!info) return '<p class="inline-note">正在统计本机图片…</p>';
        const mb = (info.bytes / 1048576).toFixed(1);
        return `<div class="sp-local-images">
          <div class="sp-li-bar">
            <span>已存 <b>${Number(info.count) || 0}</b> 张，占用 <b>${mb}MB</b>（${esc(info.root || '')}）</span>
            <button type="button" class="button small" data-action="selectionpool:local-images-refresh">刷新</button>
            <button type="button" class="button small danger" data-action="selectionpool:local-images-clear">一键清理</button>
          </div>
          <div class="sp-li-list">${(info.files || []).slice(0, 40).map(f => `<div class="sp-li-item" title="${esc(f.path)}"><span class="mono">${esc(f.name).slice(0, 24)}</span><span>${(f.bytes / 1024).toFixed(0)}KB</span></div>`).join('') || '<p class="inline-note">本机没有缓存图片。上架时会临时下载采集图到这里。</p>'}</div>
        </div>`;
      }
      // 「详情 / 图片」已改为打开独立编辑器 selectionpool/editor.js（1:1 移植），
      // 旧的 6 字段简易表单已移除，避免两套编辑界面并存造成困惑。
      if (ui.dialog === 'apiConfig') {
        return apiConfigBody();
      }
      return '';
    }

    /** AI作图 接口配对状态（自动配对结果，直接显示在接口配置里）。 */
    function pairStatusHtml() {
      const pair = ui.drawingPair;
      if (!pair) return '<span class="sp-pair-note">正在检测 AI作图 服务…</span>';
      const tone = pair.configured && pair.authorized ? 'ok' : 'warn';
      const label = pair.configured
        ? (pair.authorized ? '已配对 · 服务在线' : pair.reachable ? '已配置 · Key 不匹配' : '已配置 · 服务未启动')
        : '未配对';
      const rows = [];
      if (pair.root) rows.push(`服务 ${pair.root}${pair.serviceVersion ? `（AI作图 ${pair.serviceVersion}）` : ''}`);
      if (pair.keyMasked) rows.push(`Key ${pair.keyMasked}`);
      rows.push(pair.discovered?.found ? `程序目录 ${pair.discovered.dir}` : '未找到 AI作图 目录（可点「选择 AI作图 目录」）');
      if (pair.message) rows.push(pair.message);
      return `<div class="sp-pair-head"><em class="sp-pair-${tone}">${esc(label)}</em></div>
        <div class="sp-pair-rows">${rows.map(row => `<span>${esc(row)}</span>`).join('')}</div>`;
    }

    function apiConfigBody() {
      const d = data();
      const api = d.api || {};
      const catalog = api.catalog || [];
      const p0 = catalog.filter(a => a.priority === 'P0');
      return `<div class="sp-api-config">
        ${notice(`当前状态：<strong>${esc(api.note || '未配置')}</strong>。填入凭证后接口调用自动启用；未填时所有真实接口保持关闭，不会误发请求。`)}
        <h3>① 需要申请的 API（共 ${catalog.length} 个，其中必申请 P0 ${p0.length} 个）</h3>
        <div class="sp-api-table-wrap"><table class="sp-api-table"><thead><tr><th>优先级</th><th>接口名</th><th>权限组</th><th>授权</th><th>用途</th></tr></thead><tbody>
          ${catalog.map(a => `<tr class="sp-p-${esc(a.priority)}"><td>${esc(a.priority)}</td><td class="mono">${esc(a.method)}</td><td>${esc(a.group)}</td><td>${a.auth === 'session' ? '店铺 OAuth' : '仅 AppKey'}</td><td>${esc(a.use)}</td></tr>`).join('')}
        </tbody></table></div>
        <h3>② 凭证（后续给我，填这里即可，保存在本机）</h3>
        <div class="sp-form-grid">
          <label>AppKey<input class="sp-input" data-sp-api="appKey" placeholder="开放平台应用 AppKey"></label>
          <label>AppSecret<input class="sp-input" type="password" data-sp-api="appSecret" placeholder="${esc(api.appSecretMasked || 'AppSecret')}"></label>
          <label>sessionKey（OAuth）<input class="sp-input" type="password" data-sp-api="sessionKey" placeholder="${esc(api.sessionKeyMasked || '店铺授权后获得的 session')}"></label>
          <label>网关地址<input class="sp-input" data-sp-api="baseUrl" value="${esc(api.baseUrl || 'https://eco.taobao.com/router/rest')}"></label>
        </div>
        <p class="inline-note">已保存：AppKey ${esc(api.appKey || '（未填）')} · AppSecret ${esc(api.appSecretMasked || '（未填）')} · sessionKey ${esc(api.sessionKeyMasked || '（未填）')}</p>
        <h3>③ AI作图 服务（按编码读取作图成品）</h3>
        <p class="inline-note">点「自动配对」即可完成服务地址与接口 Key 的配置。</p>
        <div class="sp-pair">
          <div class="sp-pair-state">${pairStatusHtml()}</div>
          <div class="sp-pair-actions">
            ${button('自动配对', 'selectionpool:pair-drawing', { primary: true, small: true })}
            ${button('选择 AI作图 目录', 'selectionpool:pair-drawing-dir', { small: true })}
            ${button('重新检测', 'selectionpool:pair-drawing-refresh', { small: true })}
          </div>
        </div>
        <details class="sp-pair-manual">
          <summary>手动填写（自动配对不可用时）</summary>
          <div class="sp-form-grid">
            <label>AI作图 服务地址<input class="sp-input" data-sp-api="drawingApiRoot" value="${esc(api.drawingApiRoot || 'http://127.0.0.1:48180')}"></label>
            <label>接口 Key<input class="sp-input" type="password" data-sp-api="drawingApiKey" placeholder="${esc(api.drawingApiKeyMasked || '与 AI作图 config.json 的 taskLookup.apiKey 一致')}"></label>
          </div>
          <p class="inline-note">手动填写后点右上角「保存凭证」生效。</p>
        </details>
        <h3>④ 本地采集接收端点</h3>
        <p class="inline-note">选品推送 <code>http://127.0.0.1:49220</code>，作图提交 <code>http://127.0.0.1:48180</code>。</p>
        <div class="sp-ingest-status">状态：<strong>${d.ingest?.running ? `已启用，端口 ${esc(d.ingest.port)}` : '未启用'}</strong></div>
      </div>`;
    }

    // ---------------------------------------------------------------- 主渲染
    // 弹窗以内联浮层形式并入 render() 返回值（不使用 app.js 的 <dialog>，
    // 因为接口清单是长表格，原生 dialog 的字段体系装不下）。
    function renderPage() {
      return `<div class="selectionpool-page" data-selectionpool-page>
        ${shopStatusStrip()}
        ${ui.message ? `<div class="callout">${svg('info')}<div>${esc(ui.message)}</div></div>` : ''}
        ${manualFixBar()}
        ${toolBar()}
        ${filterBar()}
        <section class="panel sp-panel">${ui.view === 'gallery' ? galleryView() : listView()}</section>
      </div>${renderDialog()}${editorUi()?.render() || ''}${dialogs ? dialogs.render() : ''}`;
    }

    // ---------------------------------------------------------------- 动作

    function readDialogFields() {
      const result = {};
      for (const input of document.querySelectorAll('.sp-input[data-sp-api]')) result[input.dataset.spApi] = input.value;
      return result;
    }

    /** 自动配对：调一次主进程，把 AI作图 与上品库两边的地址/Key 写成一致，再刷新状态。 */
    async function pairDrawing(method, payload) {
      if (ui.busy) return true;
      ui.busy = true;
      render();
      try {
        const result = await api(method, payload);
        if (result?.message) toast(result.message);
        const [apiView, pair] = await Promise.all([
          api('selectionpool.apiConfig', {}),
          api('selectionpool.drawingPairStatus', {}),
        ]);
        if (ui.data) ui.data.api = apiView;
        ui.drawingPair = pair;
      } catch (error) {
        showError(error);
      } finally {
        ui.busy = false;
        render();
      }
      return true;
    }

    /** 上架失败时登记「待人工补全」，并按需直接打开店铺发布页让用户补参数。 */
    let manualFixInflight = false;
    async function registerManualFixes(result, openBrowser = false) {
      // 防止连点/重复调用叠出两个「手动修改」弹窗（用户 2026-11-11）。
      if (manualFixInflight) return null;
      const failed = (result?.results || []).filter(row => !row.ok).slice(0, 5);
      if (!failed.length) return null;
      const storeId = state.storeId || '';
      if (!storeId) return null;
      manualFixInflight = true;
      try {
        let first = null;
        for (const row of failed) {
          try {
            const info = await api('selectionpool.openShopPublishPage', {
              itemId: row.itemId, storeId,
              reason: row.message || '参数或类目不全，需人工补全',
              code: row.code || 'PUBLISH_FAILED',
            });
            if (!first) first = info;
          } catch { /* 单条登记失败不影响其它条 */ }
        }
        if (openBrowser && first?.url) {
          await openShopPage(first);
        }
        return first;
      } finally {
        manualFixInflight = false;
      }
    }

    /** 独立发布页弹窗（用户 2026-11-10 要求）：补全参数/滑块直接在单独窗口里做，不跳店铺浏览器页面。
     *  独立窗口打不开（旧版主进程）时回退到店铺浏览器标签。 */
    async function openShopPage(info) {
      if (!info?.url) return;
      try {
        const result = await api('selectionpool.openPublishWindow', { storeId: info.storeId || state.storeId, url: info.url, mode: info.mode });
        if (result?.opened) { toast('已打开独立发布页窗口：补齐参数与必填项后直接在里面提交入仓，回到上品库点「我已填好，继续」'); return; }
      } catch { /* 旧版主进程没有这个接口，走店铺浏览器 */ }
      await api('browser.open', { storeId: info.storeId || state.storeId, kind: 'publish', url: info.url });
      if (typeof navigate === 'function') await navigate('browser');
      toast('已打开店铺发布页，补齐参数与必填项后回到上品库点「我已填好，继续」');
    }

    async function handleAction(action, target) {
      if (!String(action).startsWith('selectionpool:')) return false;
      // 老软件四组弹窗（自动上架 / 上品记录 / 表单填写 / 类目）交给 dialogs 模块。
      if (action.startsWith('selectionpool:dlg-')) return dialogs ? await dialogs.handleAction(action, target) : false;
      // 编辑器所有动作交给独立模块处理（动作前缀 selectionpool:editor-*）。
      if (action.startsWith('selectionpool:editor-')) return editorUi()?.handleAction(action, target) ?? false;
      const cmd = action.slice('selectionpool:'.length);
      const id = Number(target.dataset.id || 0);
      const value = target.dataset.value;
      switch (cmd) {
        case 'refresh': await reload(); return true;
        case 'refresh-shops': {
          const result = await call('shopStates', {}, { after: false });
          if (result) { ui.data = { ...data(), shopStates: result }; render(); }
          return true;
        }
        case 'query': ui.page = 1; await reload(); return true;
        case 'reset':
          Object.assign(ui, {
            keyword: '', group: 'all', platform: 'all', status: 'all', sort: 'newest', team: 'all', owner: 'all', page: 1,
            dateRange: { start: '', end: '' }, dateDraft: { start: '', end: '' }, dateOpen: false,
          });
          await reload(); return true;
        case 'view': ui.view = value === 'gallery' ? 'gallery' : 'list'; render(); return true;
        case 'scope': ui.scope = value === 'team' ? 'team' : 'mine'; await reload(); return true;
        // ---- 加入时间：日期区间 ----
        case 'date-open': {
          ui.dateOpen = true;
          ui.dateDraft = { ...ui.dateRange };
          const base = ui.dateRange.start ? new Date(String(ui.dateRange.start).replace(' ', 'T')) : new Date();
          ui.dateMonth = monthKeyOf(Number.isNaN(base.getTime()) ? new Date() : base);
          ui.datePicking = ui.dateDraft.start && !ui.dateDraft.end ? 'end' : 'start';
          render(); return true;
        }
        case 'date-close': ui.dateOpen = false; render(); return true;
        case 'date-nav': {
          ui.dateMonth = shiftMonth(ui.dateMonth || monthKeyOf(new Date()), Number(target.dataset.dir) || 1);
          render(); return true;
        }
        case 'date-pick': {
          const day = String(target.dataset.date || '');
          if (!day) return true;
          const draft = { ...ui.dateDraft };
          if (ui.datePicking === 'start' || !draft.start || (draft.start && draft.end)) {
            draft.start = `${day} 00:00:00`;
            draft.end = '';
            ui.datePicking = 'end';
          } else {
            const startDay = String(draft.start).slice(0, 10);
            if (day < startDay) {
              draft.start = `${day} 00:00:00`;
              draft.end = `${startDay} 23:59:59`;
            } else {
              draft.end = `${day} 23:59:59`;
            }
            ui.datePicking = 'start';
          }
          ui.dateDraft = draft;
          ui.dateRecent = { ...ui.dateRecent, on: false };
          render(); return true;
        }
        case 'date-quick': {
          const preset = String(value || '');
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const from = new Date(today);
          const to = new Date(today);
          let days = 0;
          if (preset === 'yesterday') { from.setDate(from.getDate() - 1); to.setDate(to.getDate() - 1); }
          else if (preset === 'before') { from.setDate(from.getDate() - 2); to.setDate(to.getDate() - 2); }
          else if (preset === 'd3') days = 3;
          else if (preset === 'd7') days = 7;
          else if (preset === 'd15') days = 15;
          else if (preset === 'd30') days = 30;
          else if (preset === 'month') from.setDate(1);
          else if (preset === 'lastMonth') { from.setMonth(from.getMonth() - 1, 1); to.setDate(0); }
          if (days) from.setDate(today.getDate() - days + 1);
          ui.dateDraft = { start: dayStart(from), end: dayEnd(to) };
          ui.dateMonth = monthKeyOf(from);
          ui.datePicking = 'start';
          ui.dateRecent = { ...ui.dateRecent, on: false };
          render(); return true;
        }
        case 'date-apply': {
          ui.dateRange = { ...ui.dateDraft };
          ui.dateOpen = false;
          ui.page = 1;
          await reload(); return true;
        }
        case 'date-clear': {
          ui.dateRange = { start: '', end: '' };
          ui.dateDraft = { start: '', end: '' };
          ui.dateOpen = false;
          ui.dateRecent = { ...ui.dateRecent, on: false };
          ui.page = 1;
          await reload(); return true;
        }
        case 'show-success': if (dialogs) dialogs.open('publication', { tab: 'records' }); else { ui.status = 'landed'; ui.page = 1; await reload(); } return true;
        case 'show-failed': if (dialogs) dialogs.open('publication', { tab: 'failures' }); else { ui.status = 'publishFailed'; ui.page = 1; await reload(); } return true;
        case 'show-queue': if (dialogs) dialogs.open('queueProgress'); return true;
        case 'page-prev': ui.page = Math.max(1, ui.page - 1); await reload(); return true;
        case 'page-next': ui.page += 1; await reload(); return true;
        case 'export-csv': {
          const result = await api('selectionpool.exportCsv', query({ page: ui.page, size: 200 }));
          if (result?.status === 'saved') toast(`已导出 ${result.rowCount} 条到 ${result.filePath}`);
          else if (result?.status === 'empty') toast('当前页没有可导出的选品', true);
          return true;
        }
        case 'overview': ui.dialog = 'overview'; render(); return true;
        case 'logs': {
          // 统一收进「上品记录中心 -> 执行日志」标签页
          if (dialogs) { dialogs.open('publication', { tab: 'logs' }); return true; }
          const logs = await api('selectionpool.autoShelfLog');
          ui.data = { ...data(), logs }; ui.dialog = 'logs'; render(); return true;
        }
        case 'shelf': {
          if (dialogs) { dialogs.open('publication', { tab: 'records' }); return true; }
          const shelfRecords = await api('selectionpool.shelfRecords');
          ui.data = { ...data(), shelfRecords }; ui.dialog = 'shelf'; render(); return true;
        }
        case 'templates': {
          const templates = await api('selectionpool.imageTemplates', {});
          ui.data = { ...data(), templates };
          ui.dialog = 'templates';
          ui.tpl.draft = null;
          syncTplSelection(templates);
          render();
          return true;
        }
        case 'tpl-tab': {
          const nextTab = value === 'sku' ? 'sku' : 'detail';
          if (ui.tpl.tab === nextTab) return true;
          ui.tpl.tab = nextTab;
          ui.tpl.selectedId = 0;
          ui.tpl.draft = null;
          ui.tpl.dirty = false;
          syncTplSelection(data().templates || []);
          render();
          return true;
        }
        case 'tpl-select': {
          syncTplSelection(data().templates || [], id);
          render();
          return true;
        }
        case 'tpl-select-new': {
          render();
          return true;
        }
        case 'tpl-new': {
          const kind = ui.tpl.tab === 'sku' ? 'sku' : 'detail';
          const firstStore = loggedIn()[0] || shops()[0] || null;
          ui.tpl.selectedId = -1;
          ui.tpl.dirty = true;
          ui.tpl.draft = {
            id: 0, version: 1, kind,
            name: kind === 'sku' ? '新 SKU 营销模板' : '新详情页营销模板',
            owner: state.info?.userName || state.info?.displayName || (data().owners || [])[0] || '',
            storeId: firstStore ? String(firstStore.storeId || '') : '',
            storeName: firstStore ? String(firstStore.name || '') : '',
            images: [], skus: [], isNew: true,
          };
          render();
          return true;
        }
        case 'tpl-img-upload': {
          document.querySelector('[data-sp-tpl-file="detail"]')?.click();
          return true;
        }
        case 'tpl-img-remove': {
          const idx = Number(target.dataset.index);
          if (!ui.tpl.draft || !Number.isInteger(idx)) return true;
          ui.tpl.draft.images.splice(idx, 1);
          ui.tpl.dirty = true;
          render();
          return true;
        }
        case 'tpl-sku-add': {
          document.querySelector('[data-sp-tpl-file="sku-add"]')?.click();
          return true;
        }
        case 'tpl-sku-pick-img': {
          const picker = document.querySelector('[data-sp-tpl-file="sku-replace"]');
          if (picker) { picker.dataset.index = String(target.dataset.index || '0'); picker.click(); }
          return true;
        }
        case 'tpl-sku-move': {
          const idx = Number(target.dataset.index);
          const dir = Number(target.dataset.dir) || 0;
          const skus = ui.tpl.draft?.skus;
          if (!skus || !Number.isInteger(idx) || !dir) return true;
          const nextIdx = idx + dir;
          if (nextIdx < 0 || nextIdx >= skus.length) return true;
          const [row] = skus.splice(idx, 1);
          skus.splice(nextIdx, 0, row);
          ui.tpl.dirty = true;
          render();
          return true;
        }
        case 'tpl-sku-remove': {
          const idx = Number(target.dataset.index);
          if (!ui.tpl.draft?.skus || !Number.isInteger(idx)) return true;
          ui.tpl.draft.skus.splice(idx, 1);
          ui.tpl.dirty = true;
          render();
          return true;
        }
        case 'tpl-save': {
          const draft = ui.tpl.draft;
          if (!draft) return true;
          const name = String(draft.name || '').trim();
          if (!name) { toast('请先填写模板名称', true); return true; }
          if (draft.kind === 'sku') {
            const seen = new Set();
            for (let i = 0; i < draft.skus.length; i++) {
              const row = draft.skus[i];
              if (!String(row.name || '').trim()) { toast(`第 ${i + 1} 条宣传规格的文案不能为空`, true); return true; }
              const full = `${row.name || ''}${row.suffix || ''}`;
              if (skuCharLen(full) > 128) { toast(`第 ${i + 1} 条规格名超过 128 字符上限`, true); return true; }
              if (seen.has(full)) { toast(`宣传规格「${full}」重复，请调整文案或后缀`, true); return true; }
              seen.add(full);
            }
          }
          const storeObj = shops().find(s => String(s.storeId) === String(draft.storeId));
          const payload = draft.isNew
            ? { action: 'create', kind: draft.kind, name, owner: draft.owner, storeId: draft.storeId, storeName: storeObj?.name || draft.storeName || '', images: draft.images, skus: draft.skus }
            : { id: draft.id, version: draft.version, name, owner: draft.owner, storeId: draft.storeId, storeName: storeObj?.name || draft.storeName || '', images: draft.images, skus: draft.skus };
          const res = await api('selectionpool.changeImageTemplate', payload);
          if (res?.ok === false) { toast(res.message || '保存失败', true); return true; }
          const templates = Array.isArray(res?.templates) ? res.templates : await api('selectionpool.imageTemplates', {});
          ui.data = { ...data(), templates };
          const savedId = Number(res?.template?.id || draft.id || 0);
          ui.tpl.draft = null;
          syncTplSelection(templates, savedId);
          toast('模板已保存');
          render();
          return true;
        }
        case 'tpl-delete': {
          const draft = ui.tpl.draft;
          if (!draft) return true;
          if (draft.isNew) {
            ui.tpl.draft = null;
            syncTplSelection(data().templates || []);
            render();
            return true;
          }
          const ok = await modal({ title: '删除模板', description: `确定删除「${draft.name || '该模板'}」？删除后不可恢复。`, fields: '', confirm: '删除', danger: true });
          if (!ok) return true;
          const res = await api('selectionpool.changeImageTemplate', { action: 'delete', id: draft.id, version: draft.version });
          if (res?.ok === false) { toast(res.message || '删除失败', true); return true; }
          const templates = Array.isArray(res?.templates) ? res.templates : await api('selectionpool.imageTemplates', {});
          ui.data = { ...data(), templates };
          ui.tpl.draft = null;
          ui.tpl.selectedId = 0;
          syncTplSelection(templates);
          toast('模板已删除');
          render();
          return true;
        }
        case 'local-images': {
          ui.dialog = 'localImages'; ui.localImages = null; render();
          api('selectionpool.localImages', {})
            .then(info => { if (ui.dialog === 'localImages') { ui.localImages = info; render(); } })
            .catch(() => undefined);
          return true;
        }
        case 'local-images-refresh': {
          ui.localImages = await api('selectionpool.localImages', {});
          render(); return true;
        }
        case 'local-images-clear': {
          const ok = await modal({ title: '清理本机图片', description: '删除上架时临时下载的图片缓存。清理后下次上架会重新下载，不影响已上架商品。', fields: '', confirm: '一键清理', danger: true });
          if (!ok) return true;
          const res = await api('selectionpool.clearLocalImages', {});
          ui.localImages = await api('selectionpool.localImages', {});
          render();
          toast(`已清理 ${Number(res?.removed) || 0} 张，释放 ${((Number(res?.freed) || 0) / 1048576).toFixed(1)}MB`);
          return true;
        }
        case 'api-config': {
          ui.dialog = 'apiConfig';
          ui.drawingPair = null;
          render();
          // 配对状态单独拉：接口配置面板会显示「服务在不在、Key 通不通」。
          api('selectionpool.drawingPairStatus', {})
            .then(pair => { if (ui.dialog === 'apiConfig') { ui.drawingPair = pair; render(); } })
            .catch(() => undefined);
          return true;
        }
        case 'pair-drawing': return pairDrawing('selectionpool.drawingPair', {});
        case 'pair-drawing-dir': return pairDrawing('selectionpool.drawingPairChoose', {});
        case 'pair-drawing-refresh': {
          try { ui.drawingPair = await api('selectionpool.drawingPairStatus', {}); }
          catch (error) { showError(error); }
          render();
          return true;
        }
        // 「详情」按老软件打开「采集信息」弹窗（概览 / SKU / 参数 / 图文详情 / 评价 / 采集信息）；
        // 「图片」和整行空白处都打开完整「商品图片工作台」编辑器（用户 2026-11-11）。
        case 'detail': {
          editorUi()?.close();
          if (dialogs) { dialogs.open('detail', { itemId: id }); return true; }
          ui.dialog = 'overview'; render(); return true;
        }
        case 'images': {
          ui.dialog = ''; render();
          const ed = editorUi();
          if (ed) {
            const row = rows().find(r => Number(r.itemId) === id) || null;
            await ed.load(id, row);
          }
          return true;
        }
        case 'toggle-select': {
          const shouldSelect = !ui.selected.has(id);
          shouldSelect ? ui.selected.add(id) : ui.selected.delete(id);
          const box = target;
          if (box && box.checked !== shouldSelect) box.checked = shouldSelect;
          render();
          return true;
        }
        case 'remove-one': {
          const ok = await modal({ title: '删除选品', description: `确定删除选品 #${id}？本机采集原件与图片位记录会一并移除。`, fields: '', confirm: '确认删除', danger: true });
          if (ok) await call('remove', { itemIds: [id] }, { success: '已删除' });
          return true;
        }
        case 'remove-selected': {
          const ids = [...ui.selected];
          if (!ids.length) return true;
          const ok = await modal({ title: '批量删除选品', description: `确定删除已选的 ${ids.length} 条选品？整批原子执行。`, fields: '', confirm: '确认删除', danger: true });
          if (ok) { ui.selected.clear(); await call('remove', { itemIds: ids }, { success: '已删除' }); }
          return true;
        }
        case 'publish-one': {
          const shopsList = loggedIn();
          if (!shopsList.length) { toast('没有已登录的店铺，请先在「店铺登录」完成登录', true); return true; }
          const chosen = await modal({
            title: `上架选品 #${id}`,
            description: '按上品库内编辑好的类目与参数提交到店铺仓库（放进仓库、不直接开卖）。',
            fields: `<div class="field"><label>目标店铺</label><select name="storeId">${shopsList.map(s => `<option value="${esc(s.storeId)}">${esc(s.name)} · ${esc(s.label)}</option>`).join('')}</select></div>`,
            confirm: '提交上架',
          });
          if (!chosen) return true;
          const result = await api('selectionpool.autoShelf', { itemIds: [id], storeId: chosen.storeId });
          const first = result?.results?.[0];
          toast(first?.ok ? `已放入仓库 #${first.warehouseItemId}` : `未能上架：${first?.message || '驱动未接入'}`, !first?.ok);
          // 老软件：发布页还停在这件商品上时弹出店铺窗口，让人手动补参数；这里同等处理。
          // 驱动失败时已经把「填好的那个发布页窗口」显示出来给用户改了（用户 2026-11-12：
          // 「弹出手动调整的弹窗之后还是两个窗口，只需要我要改的那个」）。
          // 这里只登记待办 + 提示，不再另开第二个发布页窗口。
          if (!first?.ok) await registerManualFixes(result, false);
          await reload(); return true;
        }
        case 'auto-shelf': {
          const ids = [...ui.selected];
          if (dialogs) dialogs.open('autoShelf', { itemIds: ids });
          return true;
        }
        case 'open': {
          const detail = await api('selectionpool.detail', { itemId: id });
          const url = detail?.product?.productUrl;
          if (!url || !/^https:\/\//i.test(url)) { toast('该选品没有可打开的公开商品链接', true); return true; }
          // 通过店铺浏览器的已登录会话打开，不新开独立窗口
          await api('browser.open', { storeId: state.storeId, kind: 'user', url });
          return true;
        }
        case 'shelf-one': {
          if (dialogs) { dialogs.open('publication', { tab: 'records', itemId: id }); return true; }
          const shelfRecords = await api('selectionpool.shelfRecords');
          const mine = (shelfRecords || []).filter(r => Number(r.itemId) === id);
          ui.data = { ...data(), shelfRecords: mine }; ui.dialog = 'shelf'; render(); return true;
        }
        case 'select-all': {
          const all = rows().map(r => r.itemId);
          const shouldSelect = all.length > 0 && all.every(x => ui.selected.has(x));
          for (const x of all) shouldSelect ? ui.selected.delete(x) : ui.selected.add(x);
          render(); return true;
        }
        // 弹窗内动作
        case 'save-api-config': {
          await call('saveApiConfig', readDialogFields(), { success: '凭证已保存到本机' });
          return true;
        }
        case 'start-ingest': await call('startIngest', { port: 49220 }, { success: '本地接收端点已启用' }); return true;
        case 'stop-ingest': await call('stopIngest', {}, { success: '本地接收端点已关闭' }); return true;
        // ---- 店铺页面人工补全参数 ----
        case 'manual-open': {
          if (!state.storeId) { toast('请先在左上角选择店铺', true); return true; }
          const info = await api('selectionpool.openShopPublishPage', {
            itemId: id, storeId: state.storeId, reason: '参数或类目不全，人工在店铺页面补全',
          });
          await openShopPage(info);
          await reload(); return true;
        }
        case 'manual-fill': {
          // 老软件的人工补全是「表单填写窗口」：左侧分节导航 + 右侧字段 + 手机预览，不是简易输入框。
          if (dialogs) { dialogs.open('manualForm', { itemId: id }); return true; }
          const values = await modal({
            title: '手动补全参数',
            description: '每行一条，格式「参数名：值」。填写的类目与参数会写回这条选品，供后续上架使用。',
            fields: `<div class="field"><label>类目 ID</label><input name="categoryId" placeholder="例如 50025705"></div>
              <div class="field"><label>类目路径</label><input name="categoryPath" placeholder="食品 > 零食 > 糖果"></div>
              <div class="field"><label>参数（每行一条）</label><textarea name="text" rows="6" placeholder="生产许可证编号：SC12345678901234&#10;厂名：某某食品有限公司"></textarea></div>
              <div class="field"><label>仓库商品编号（已在店铺页面入仓时填）</label><input name="warehouseItemId"></div>`,
            confirm: '保存补全结果',
          });
          if (!values) return true;
          await call('saveManualParams', {
            itemId: id, categoryId: values.categoryId, categoryPath: values.categoryPath,
            text: values.text, warehouseItemId: values.warehouseItemId,
          }, { success: '补全结果已回写到这条选品' });
          return true;
        }
        case 'manual-resume': {
          const values = await modal({
            title: '我已填好，继续',
            description: '确认已在店铺页面补齐参数与必填项。若商品已放进仓库，请填仓库商品编号；留空则重新执行一次上架检查。',
            fields: '<div class="field"><label>仓库商品编号（选填）</label><input name="warehouseItemId" placeholder="已在店铺页面入仓时填写"></div>',
            confirm: '确认继续',
          });
          if (!values) return true;
          const result = await api('selectionpool.resumeManualShelf', { itemId: id, warehouseItemId: values.warehouseItemId || '' });
          toast(result?.landed ? `已确认入仓 #${result.warehouseItemId}` : '已重新执行上架检查', !result?.landed);
          await reload(); return true;
        }
        case 'manual-dismiss': await call('dismissManualFix', { itemId: id }, { success: '已关闭这条待办' }); return true;
        case 'close-dialog': ui.dialog = ''; render(); return true;
        default: return false;
      }
    }

    /** change 委托：下拉筛选与每页条数；编辑器字段优先交给独立模块。 */
    function handleChange(event) {
      if (dialogs?.handleChange(event)) return true;
      if (editorUi()?.isOpen() && editorUi().handleChange(event)) return true;
      const target = event.target;
      const action = target?.dataset?.action;
      // ---- 加入时间弹层里的日期/时间/最近N天 ----
      if (target?.dataset?.spDateField) {
        const val = name => String(document.querySelector(`[data-sp-date-field="${name}"]`)?.value || '');
        const normTime = (text, fallback) => {
          const raw = String(text || '').trim();
          if (!raw) return fallback;
          return raw.length === 5 ? `${raw}:00` : raw;
        };
        const startDay = val('startDate');
        const endDay = val('endDate');
        ui.dateDraft = {
          start: startDay ? `${startDay} ${normTime(val('startTime'), '00:00:00')}` : '',
          end: endDay ? `${endDay} ${normTime(val('endTime'), '23:59:59')}` : '',
        };
        if (startDay) ui.dateMonth = startDay.slice(0, 7);
        ui.dateRecent = { ...ui.dateRecent, on: false };
        render();
        return true;
      }
      if (target?.dataset?.spDateRecent !== undefined) {
        const on = Boolean(target.checked);
        ui.dateRecent = { ...ui.dateRecent, on };
        if (on) {
          const days = Math.max(1, Math.min(365, Number(ui.dateRecent.days) || 7));
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const from = new Date(today);
          from.setDate(today.getDate() - days + 1);
          ui.dateDraft = { start: dayStart(from), end: dayEnd(today) };
          ui.dateMonth = monthKeyOf(from);
          ui.datePicking = 'start';
        }
        render();
        return true;
      }
      if (target?.dataset?.spDateDays !== undefined) {
        const days = Math.max(1, Math.min(365, Number(target.value) || 7));
        ui.dateRecent = { ...ui.dateRecent, days };
        if (ui.dateRecent.on) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const from = new Date(today);
          from.setDate(today.getDate() - days + 1);
          ui.dateDraft = { start: dayStart(from), end: dayEnd(today) };
        }
        render();
        return true;
      }
      if (action === 'selectionpool:filter-group') { ui.group = target.value; ui.page = 1; reload(); return true; }
      if (action === 'selectionpool:filter-platform') { ui.platform = target.value; ui.page = 1; reload(); return true; }
      if (action === 'selectionpool:filter-status') { ui.status = target.value; ui.page = 1; reload(); return true; }
      if (action === 'selectionpool:filter-sort') { ui.sort = target.value; ui.page = 1; reload(); return true; }
      if (action === 'selectionpool:filter-team') { ui.team = target.value; ui.page = 1; reload(); return true; }
      if (action === 'selectionpool:filter-owner') { ui.owner = target.value; ui.page = 1; reload(); return true; }
      if (action === 'selectionpool:pagesize') { ui.size = Number(target.value) || 50; ui.page = 1; reload(); return true; }
      if (target?.dataset?.spTplField === 'storeId' && ui.tpl.draft) {
        ui.tpl.draft.storeId = String(target.value || '');
        const opt = target.options?.[target.selectedIndex];
        ui.tpl.draft.storeName = opt ? String(opt.textContent || '') : '';
        ui.tpl.dirty = true;
        const saveBtn = document.querySelector('[data-action="selectionpool:tpl-save"]');
        if (saveBtn) saveBtn.disabled = false;
        return true;
      }
      if (target?.dataset?.spTplFile) {
        const mode = target.dataset.spTplFile;
        const files = target.files;
        if (!files || !files.length || !ui.tpl.draft) return true;
        ui.tpl.uploading = true; render();
        void uploadTemplateMedia(files)
          .then(urls => {
            if (!ui.tpl.draft) return;
            if (mode === 'detail') {
              ui.tpl.draft.images = [...(ui.tpl.draft.images || []), ...urls];
            } else if (mode === 'sku-add' && urls[0]) {
              ui.tpl.draft.skus = [...(ui.tpl.draft.skus || []), { image: urls[0], name: '', suffix: '' }];
            } else if (mode === 'sku-replace' && urls[0]) {
              const idx = Number(target.dataset.index);
              if (ui.tpl.draft.skus?.[idx]) ui.tpl.draft.skus[idx].image = urls[0];
            }
            ui.tpl.dirty = true;
          })
          .catch(error => showError(error))
          .finally(() => { ui.tpl.uploading = false; render(); });
        return true;
      }
      if (target?.dataset?.spSelect !== undefined) {
        const id = Number(target.dataset.spSelect);
        target.checked ? ui.selected.add(id) : ui.selected.delete(id);
        render(); return true;
      }
      return false;
    }

    /** input 委托：搜索框；编辑器文本域优先交给独立模块。 */
    function handleInput(event) {
      if (dialogs?.handleInput(event)) return true;
      if (editorUi()?.isOpen() && editorUi().handleInput(event)) return true;
      const t = event.target;
      if (t?.dataset?.spTplField && ui.tpl.draft) {
        ui.tpl.draft[t.dataset.spTplField] = t.value;
        ui.tpl.dirty = true;
        const saveBtn = document.querySelector('[data-action="selectionpool:tpl-save"]');
        if (saveBtn) saveBtn.disabled = false;
        return true;
      }
      if (t?.dataset?.spTplSkuField && ui.tpl.draft) {
        const idx = Number(t.dataset.index);
        const row = ui.tpl.draft.skus?.[idx];
        if (row) {
          row[t.dataset.spTplSkuField] = t.value;
          ui.tpl.dirty = true;
          const preview = document.querySelector(`[data-sp-tpl-sku-preview="${idx}"]`);
          if (preview) {
            const full = `${row.name || ''}${row.suffix || ''}`;
            const len = skuCharLen(full);
            preview.textContent = `规格名：${full || '（未填文案）'} (${len}/128 字符)`;
            preview.classList.toggle('over', len > 128);
          }
          const saveBtn = document.querySelector('[data-action="selectionpool:tpl-save"]');
          if (saveBtn) saveBtn.disabled = false;
        }
        return true;
      }
      if (t?.dataset?.spKeyword !== undefined) { ui.keyword = t.value; return true; }
      return false;
    }

    /** 弹窗：由 app.js 的 modal 体系无法容纳复杂表格，这里返回内联面板由 renderDialog 注入。 */
    function skuCharLen(val) {
      let total = 0;
      for (const ch of String(val || '')) total += (ch.codePointAt(0) || 0) > 127 ? 2 : 1;
      return total;
    }
    function cloneTemplate(t) {
      if (!t) return null;
      return {
        id: Number(t.id) || 0,
        version: Number(t.version) || 1,
        kind: t.kind === 'sku' ? 'sku' : 'detail',
        name: String(t.name || ''),
        owner: String(t.owner || ''),
        storeId: String(t.storeId || ''),
        storeName: String(t.storeName || ''),
        images: [...(t.images || [])],
        skus: (t.skus || []).map(s => ({ image: String(s?.image || ''), name: String(s?.name || ''), suffix: String(s?.suffix || '') })),
        isNew: Boolean(t.isNew),
      };
    }
    function syncTplSelection(allTemplates, preferId = 0) {
      const kind = ui.tpl.tab === 'sku' ? 'sku' : 'detail';
      const list = (allTemplates || []).filter(t => (t.kind === 'sku' ? 'sku' : 'detail') === kind);
      if (!preferId && ui.tpl.draft?.isNew && ui.tpl.draft.kind === kind) return;
      const targetId = preferId || ui.tpl.selectedId;
      const found = list.find(t => Number(t.id) === Number(targetId)) || list[0] || null;
      ui.tpl.selectedId = found ? Number(found.id) : 0;
      ui.tpl.draft = found ? cloneTemplate(found) : null;
      ui.tpl.dirty = false;
    }
    async function uploadTemplateMedia(files) {
      const urls = [];
      for (const file of Array.from(files || [])) {
        if (!file) continue;
        const res = await fetch('/api/xx/upload-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name || 'image.png') },
          body: file,
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok || !json.url) throw new Error(json?.error || '图片上传失败');
        urls.push(json.url);
      }
      return urls;
    }
    const trashIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
    const uploadImgSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="16" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m19 15-4-4-7 7"/><path d="M18 3v6m-3-3h6"/></svg>';

    function templatesDialogHtml() {
      const d = data();
      const tab = ui.tpl.tab === 'sku' ? 'sku' : 'detail';
      const list = (d.templates || []).filter(t => (t.kind === 'sku' ? 'sku' : 'detail') === tab);
      if (!ui.tpl.draft && list.length) syncTplSelection(d.templates || []);
      const draft = ui.tpl.draft;
      const stores = shops();
      const ownerOptions = [...new Set([...(d.owners || []), draft?.owner].filter(Boolean))];
      const hasCurrentStore = draft?.storeId && stores.some(s => String(s.storeId) === String(draft.storeId));
      const hintText = tab === 'sku'
        ? '每条一张宣传图 + 规格名文案，套用时规格名就是这段文案，插到规格最上面'
        : '套用时插到详情页最前面，后面接商品自己的详情';

      const sideCard = (t) => {
        const isSku = t.kind === 'sku';
        const thumb = isSku ? (t.skus?.[0]?.image || '') : (t.images?.[0] || '');
        const count = isSku ? (t.skus || []).length : (t.images || []).length;
        const active = draft && !draft.isNew && Number(draft.id) === Number(t.id);
        return `<button type="button" class="sp-tpl-side-card${active ? ' active' : ''}" data-action="selectionpool:tpl-select" data-id="${esc(t.id)}">
          <span class="sp-tpl-side-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : svg('image')}</span>
          <span class="sp-tpl-side-info">
            <strong class="clip">${esc(t.name || '未命名模板')}</strong>
            <small>${esc(t.owner || '未指定')} · ${count} ${isSku ? '条' : '张'}</small>
          </span>
        </button>`;
      };

      let rightContent = '';
      if (!draft) {
        rightContent = `<div class="sp-tpl-empty">
          <div class="sp-tpl-empty-ico">${svg('image')}</div>
          <strong>还没有${tab === 'sku' ? ' SKU 模板' : '详情页模板'}</strong>
          <p>点击左侧「＋ ${tab === 'sku' ? '新建 SKU 模板' : '新建详情页模板'}」创建第一套模板。</p>
        </div>`;
      } else {
        const metaRow = `<div class="sp-tpl-meta-grid">
          <label><span>名称</span><input class="sp-tpl-pill-input" data-sp-tpl-field="name" value="${esc(draft.name)}" placeholder="输入模板名称"></label>
          <label><span>给谁用</span><input class="sp-tpl-pill-input" list="sp-tpl-owners-list" data-sp-tpl-field="owner" value="${esc(draft.owner)}" placeholder="成员名称（可选）"><datalist id="sp-tpl-owners-list">${ownerOptions.map(o => `<option value="${esc(o)}">`).join('')}</datalist></label>
          <label><span>图片存到店铺</span><select class="sp-tpl-pill-input sp-tpl-select" data-sp-tpl-field="storeId">
            ${stores.length ? stores.map(s => `<option value="${esc(s.storeId)}" ${String(draft.storeId) === String(s.storeId) ? 'selected' : ''}>${esc(s.name || s.storeId)}</option>`).join('') : '<option value="">本地图片空间（暂未绑定店铺）</option>'}
            ${draft.storeId && !hasCurrentStore ? `<option value="${esc(draft.storeId)}" selected>${esc(draft.storeName || draft.storeId)}</option>` : ''}
          </select></label>
        </div>`;

        if (tab === 'detail') {
          const imgs = draft.images || [];
          rightContent = `<div class="sp-tpl-work-body">
            ${metaRow}
            <div class="sp-tpl-img-grid">
              ${imgs.map((url, idx) => `<div class="sp-tpl-img-tile">
                <span class="sp-tpl-img-idx">${idx + 1}</span>
                <button type="button" class="sp-tpl-img-del" data-action="selectionpool:tpl-img-remove" data-index="${idx}" title="移除这张图片">${trashIconSvg}</button>
                <img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">
              </div>`).join('')}
              <button type="button" class="sp-tpl-upload-tile" data-action="selectionpool:tpl-img-upload" ${ui.tpl.uploading ? 'disabled' : ''}>
                ${uploadImgSvg}
                <span>${ui.tpl.uploading ? '上传中…' : '上传图片'}</span>
              </button>
              <input type="file" accept="image/*" multiple data-sp-tpl-file="detail" hidden>
            </div>
          </div>`;
        } else {
          const skus = draft.skus || [];
          rightContent = `<div class="sp-tpl-work-body">
            ${metaRow}
            <div class="sp-tpl-sku-rows">
              ${skus.map((row, idx) => {
                const full = `${row.name || ''}${row.suffix || ''}`;
                const len = skuCharLen(full);
                return `<div class="sp-tpl-sku-row">
                  <span class="sp-tpl-sku-idx">${idx + 1}</span>
                  <button type="button" class="sp-tpl-sku-thumb" data-action="selectionpool:tpl-sku-pick-img" data-index="${idx}" title="点击更换宣传图">
                    ${row.image ? `<img src="${esc(row.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : svg('image')}
                  </button>
                  <div class="sp-tpl-sku-main">
                    <input class="sp-tpl-pill-input" data-sp-tpl-sku-field="name" data-index="${idx}" value="${esc(row.name || '')}" placeholder="输入规格名文案，例如：【天猫TOP级商家｜只做优质产品｜权威保障】">
                    <div class="sp-tpl-sku-preview${len > 128 ? ' over' : ''}" data-sp-tpl-sku-preview="${idx}">规格名：${esc(full || '（未填文案）')} (${len}/128 字符)</div>
                  </div>
                  <input class="sp-tpl-pill-input sp-tpl-sku-suffix" data-sp-tpl-sku-field="suffix" data-index="${idx}" value="${esc(row.suffix || '')}" placeholder="后缀（可不填）">
                  <div class="sp-tpl-sku-acts">
                    <button type="button" class="sp-tpl-icon-btn" data-action="selectionpool:tpl-sku-move" data-index="${idx}" data-dir="-1" ${idx === 0 ? 'disabled' : ''} title="上移">↑</button>
                    <button type="button" class="sp-tpl-icon-btn" data-action="selectionpool:tpl-sku-move" data-index="${idx}" data-dir="1" ${idx === skus.length - 1 ? 'disabled' : ''} title="下移">↓</button>
                    <button type="button" class="sp-tpl-icon-btn danger" data-action="selectionpool:tpl-sku-remove" data-index="${idx}" title="删除">${trashIconSvg}</button>
                  </div>
                </div>`;
              }).join('')}
            </div>
            <button type="button" class="sp-tpl-sku-add" data-action="selectionpool:tpl-sku-add" ${ui.tpl.uploading ? 'disabled' : ''}>${ui.tpl.uploading ? '正在上传宣传图…' : '＋ 加一条宣传规格（先选宣传图）'}</button>
            <input type="file" accept="image/*" data-sp-tpl-file="sku-add" hidden>
            <input type="file" accept="image/*" data-sp-tpl-file="sku-replace" data-index="" hidden>
            <p class="sp-tpl-sku-note">套用时规格名就是「文案+后缀」，不接商品的规格名；价格、口味、包含产品跟商品第一条真实规格一样。几条之间、以及和商品原有规格都不能重名；规格名最长 128 字符（汉字算 2 个）。</p>
          </div>`;
        }
      }

      return `<div class="sp-dialog-backdrop">
        <div class="sp-dialog sp-tpl-modal" role="dialog" aria-label="图片模板">
          <div class="sp-tpl-modal-head">
            <div class="sp-tpl-head-top">
              <div class="sp-tpl-head-title">${svg('home')}<h2>图片模板</h2><span class="sp-tpl-scope">组长：全公司模板 + 你负责的组</span></div>
              <button type="button" class="sp-tpl-close" data-action="selectionpool:close-dialog" title="关闭">×</button>
            </div>
            <div class="sp-tpl-tabs-row">
              <button type="button" class="sp-tpl-tab${tab === 'detail' ? ' active' : ''}" data-action="selectionpool:tpl-tab" data-value="detail">详情页模板</button>
              <button type="button" class="sp-tpl-tab${tab === 'sku' ? ' active' : ''}" data-action="selectionpool:tpl-tab" data-value="sku">SKU 模板</button>
              <span class="sp-tpl-tab-hint">${esc(hintText)}</span>
            </div>
          </div>
          <div class="sp-tpl-split">
            <aside class="sp-tpl-sidebar">
              <button type="button" class="sp-tpl-create-btn" data-action="selectionpool:tpl-new">＋ ${tab === 'sku' ? '新建 SKU 模板' : '新建详情页模板'}</button>
              <div class="sp-tpl-sidebar-list">
                ${draft?.isNew && draft.kind === tab ? `<button type="button" class="sp-tpl-side-card active" data-action="selectionpool:tpl-select-new">
                  <span class="sp-tpl-side-thumb">${(tab === 'sku' ? draft.skus?.[0]?.image : draft.images?.[0]) ? `<img src="${esc(tab === 'sku' ? draft.skus[0].image : draft.images[0])}" alt="">` : svg('image')}</span>
                  <span class="sp-tpl-side-info"><strong class="clip">${esc(draft.name || '未命名模板')}</strong><small>新建中 · 未保存</small></span>
                </button>` : ''}
                ${list.length ? list.map(sideCard).join('') : (!draft?.isNew ? '<div class="sp-tpl-side-empty">暂无模板</div>' : '')}
              </div>
            </aside>
            <section class="sp-tpl-workspace">
              ${rightContent}
              ${draft ? `<div class="sp-tpl-work-foot">
                <button type="button" class="sp-tpl-del-btn" data-action="selectionpool:tpl-delete">${draft.isNew ? '放弃新建' : '删除模板'}</button>
                <button type="button" class="sp-tpl-save-btn" data-action="selectionpool:tpl-save" ${ui.tpl.dirty && !ui.tpl.uploading ? '' : 'disabled'}>保存</button>
              </div>` : ''}
            </section>
          </div>
        </div>
      </div>`;
    }

    function renderDialog() {
      if (!ui.dialog) return '';
      if (ui.dialog === 'templates') return templatesDialogHtml();
      const titles = {
        overview: '上品库总览', logs: '上架日志', shelf: '上架记录', templates: '图片模板',
        localImages: '本机图片', apiConfig: '接口配置 · 淘宝开放平台',
      };
      const actions = {
        apiConfig: `${button('保存凭证', 'selectionpool:save-api-config', { primary: true, small: true })}${data().ingest?.running ? button('停用本地接收', 'selectionpool:stop-ingest', { small: true, danger: true }) : button('启用本地接收', 'selectionpool:start-ingest', { small: true })}`,
      };
      // 遮罩不绑定关闭动作，避免点弹窗内部输入框时误关闭；只用右上角「关闭」按钮。
      return `<div class="sp-dialog-backdrop">
        <div class="sp-dialog">
          <div class="sp-dialog-head"><h2>${esc(titles[ui.dialog] || '')}</h2>
            <div class="actions">${actions[ui.dialog] || ''}${button('关闭', 'selectionpool:close-dialog', { small: true })}</div></div>
          <div class="sp-dialog-body">${dialogBody()}</div>
        </div></div>`;
    }

    /**
     * 队列进度实时更新（用户 2026-11-12）：只改工具栏那个按钮的文案，不整页重绘——
     * 整页重绘会把「上架日志」弹窗的滚动条拉回第一条。
     */
    function applyQueue(q) {
      if (!q || typeof q !== 'object') return;
      if (ui.data) ui.data.queue = q;
      const btn = document.querySelector('[data-action="selectionpool:show-queue"]');
      if (btn) {
        const running = Boolean(q.running);
        btn.classList.toggle('sp-queue-live', running);
        btn.innerHTML = running
          ? `${svg('clock')}上架中 ${Number(q.done) || 0}/${Number(q.total) || 0} · ${esc(queueElapsed())} · 查看进度`
          : `${svg('clock')}查看进度`;
      }
      if (dialogs?.applyQueue) { try { dialogs.applyQueue(q); } catch { /* */ } }
    }

    return { render: renderPage, renderDialog, handleAction, handleChange, handleInput, applyQueue };
  }

  window.XXSelectionPool = Object.freeze({ create });
})();
