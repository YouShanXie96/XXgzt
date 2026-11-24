'use strict';

/**
 * 上品库 · 「商品图片工作台」编辑器（window.XXSelectionPoolEditor）
 *
 * 按用户截图 1:1 复刻老软件 `pdw-*` 编辑抽屉：
 *   - 顶部：商品标题 + 流程 chip + 平台 / 商品ID / 店铺 / 采集价 + 关闭
 *   - 编码区：主图编码（8位）/ 第 5 张编码（6位，兼资质图·重要提示）/ SKU 编码（多个逗号空格分隔）
 *   - 素材图行：素材图 · 上架时自动生成 / 现在生成 / 填编码
 *   - 图位 tab：全部图位 / 1:1 主图 / 3:4 主图 / SKU 图 / 详情图 / 素材图 / 视频 / 参数
 *   - 左栏：1:1 主图（拖动排序·整组替换·最多5张）、作图成品 / 采集原图 单选、5 个图位、3:4 主图、SKU 图
 *   - 右栏：规格表（点名称/价格直接改）、全选、删除选中、SKU 模板、批量粘贴、批量改价
 *   - 底部：状态 / 恢复采集内容 / 保存；入仓提示；稍后 / 先上架入仓，才能回填
 *
 * 差异（如实标注）：本机没有 NAS/作图服务，编码只记本机草稿，不谎报"已读取作图成品"；
 * 真实回填仍需 driver 或淘宝 API 凭证。
 */

(() => {
  const PLATFORM_LABELS = { taobao: '淘宝', tmall: '天猫', '1688': '1688' };
  const FLOW_LABELS = {
    todraw: '待作图', drawing: '作图中', tolist: '待上架', landed: '已入仓',
    tofill: '待回填', done: '已完成', publishFailed: '上架失败',
  };
  const TAB_IDS = ['all', 'sq', 'tl', 'sku', 'detail', 'trans', 'video', 'params'];

  function create(deps) {
    const { api, esc, svg, toast, render, showError, modal } = deps;

    const ui = {
      open: false, itemId: 0, data: null, busy: false, dirty: false,
      tab: 'all', selected: new Set(),       repriceOpen: false, pasteOpen: false,
      pasteText: '', message: '', error: '', zoomUrl: '',
      codes: { main: '', fifth: '', sku: '' },
      // 列表行快照：打开瞬间先用标题/价格/店铺把外壳画出来（用户反馈「读取内容太慢、还显示未命名商品」）。
      row: null,
      // 本机 / 编码换图的预览（data URL，CSP 只允许 data: 与 https:）
      previews: {},
      // 当前打开的图位换图菜单：'square:0'
      slotMenu: '',
      // 拖动排序：{ group, index }
      drag: null,
    };

    const list = value => (Array.isArray(value) ? value : []);
    const d = () => ui.data || {};
    const draft = () => d().draft || {};
    const detail = () => d().detail || {};
    const skus = () => (draft().skus || []);
    const tabs = () => (d().tabs || []);

    /** 打开：先画外壳（标题来自列表行），再去读详情，避免长时间空白 + 「未命名商品」。 */
    async function load(itemId, row = null) {
      ui.open = true; ui.itemId = itemId; ui.busy = true; ui.error = ''; ui.message = '';
      ui.selected.clear(); ui.tab = 'all'; ui.slotMenu = ''; ui.zoomUrl = '';
      ui.row = row || (Number(ui.row?.itemId) === Number(itemId) ? ui.row : null);
      if (Number(ui.data?.itemId) !== Number(itemId)) ui.data = null;
      render();
      try {
        const data = await api('selectionpool.editorLoad', { itemId });
        ui.data = data;
        ui.previews = { ...(data.replacedThumbs || {}) };
        ui.codes = {
          main: data.draft?.mainCode || '',
          fifth: data.draft?.fifthCode || '',
          sku: data.draft?.skuCode || '',
        };
      } catch (error) { ui.error = String(error?.message || error); }
      finally { ui.busy = false; render(); }
    }

    /** 关闭：草稿是自动保存的，不再弹「有修改还没保存」把用户挡在弹窗里（用户反馈关不掉）。 */
    function close() { ui.open = false; ui.data = null; ui.dirty = false; ui.zoomUrl = ''; ui.slotMenu = ''; render(); }

    /** 自动保存草稿（点名称/价格/编码回车即落本机）。 */
    async function patch(patchObj, { success = '', after = null } = {}) {      if (ui.busy) return;
      ui.busy = true;
      try {
        const result = await api('selectionpool.editorPatch', { itemId: ui.itemId, patch: patchObj });
        if (ui.data) ui.data.draft = result.draft;
        if (success) toast(success);
        ui.dirty = true; ui.message = '有未保存的修改';
        if (after) ui.message = after;
      } catch (error) { showError(error); }
      finally { ui.busy = false; render(); }
    }

    /** 图位换图 / 拖动排序之后：把最新草稿与预览合并进界面，不整页重新拉数据。 */
    async function refreshWithDraft(result) {
      if (result?.draft && ui.data) ui.data.draft = result.draft;
      if (result?.preview && result?.value) ui.previews[String(result.value)] = result.preview;
      ui.dirty = true;
      ui.message = '有未保存的修改';
      render();
    }

    /** 拖动排序：把第 from 张图挪到第 to 个图位，落本机草稿（slotImages）。 */
    async function moveSlot(group, from, to) {
      if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
      const baseFor = g => (g === 'squareSrc'
        ? list(d().squareSrcImages)
        : g === 'tall'
          ? (list(draft().tallAiImages).length ? list(draft().tallAiImages)
            : [...new Set([...list(draft().tallSrcImages), ...list(detail().tallImages)])])
          : list(draft().squareAiImages));
      const slots = slotList(group, baseFor(group));
      if (from < 0 || from >= slots.length) return;
      const next = [...slots];
      const [moved] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
      const result = await api('selectionpool.editorPatch', {
        itemId: ui.itemId, patch: { slotImages: { ...(draft().slotImages || {}), [group]: next } },
      }).catch(error => ({ error: String(error?.message || error) }));
      if (result?.error) { toast(result.error, true); return; }
      if (result?.draft && ui.data) ui.data.draft = result.draft;
      ui.dirty = true; ui.message = '有未保存的修改';
      render();
    }

    /**
     * 拖动排序的 DOM 监听（只装一次）。图位之间拖过去就换顺序，
     * 老软件的商品图片工作台就是这个交互，之前只有按钮没有拖动。
     */
    function installDrag() {
      if (window.__xxSpedDragInstalled) return;
      window.__xxSpedDragInstalled = true;
      document.addEventListener('dragstart', event => {
        const slot = event.target.closest?.('[data-sped-slot]');
        if (!slot || !slot.closest('.sped-scrim')) return;
        ui.drag = { group: slot.dataset.spedGroup || 'square', index: Number(slot.dataset.spedSlot) || 0 };
        slot.classList.add('sped-slot-dragging');
        try {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', `${ui.drag.group}:${ui.drag.index}`);
        } catch { /* 忽略 */ }
      });
      document.addEventListener('dragover', event => {
        if (!ui.drag) return;
        const slot = event.target.closest?.('[data-sped-slot]');
        if (!slot || (slot.dataset.spedGroup || 'square') !== ui.drag.group) return;
        event.preventDefault();
        for (const node of document.querySelectorAll('.sped-slot-over')) node.classList.remove('sped-slot-over');
        slot.classList.add('sped-slot-over');
      });
      document.addEventListener('dragend', () => {
        for (const node of document.querySelectorAll('.sped-slot-dragging,.sped-slot-over')) node.classList.remove('sped-slot-dragging', 'sped-slot-over');
        ui.drag = null;
      });
      document.addEventListener('drop', event => {
        if (!ui.drag) return;
        const slot = event.target.closest?.('[data-sped-slot]');
        if (!slot) return;
        event.preventDefault();
        const group = slot.dataset.spedGroup || 'square';
        const to = Number(slot.dataset.spedSlot) || 0;
        const drag = ui.drag;
        ui.drag = null;
        for (const node of document.querySelectorAll('.sped-slot-dragging,.sped-slot-over')) node.classList.remove('sped-slot-dragging', 'sped-slot-over');
        if (drag.group !== group) return;
        void moveSlot(group, drag.index, to);
      });
    }

    /**
     * 弹窗交互护栏（用户 2026-11-11 第十次）：
     *   ① 滚轮只在弹窗里的卡片/列表滚动，不再带动后面整页（之前会「页面跟着跑」）；
     *   ② Esc 关弹窗，× 与「稍后」都直接关（草稿是自动保存的，不再弹保存确认把用户挡住）。
     */
    function installGuards() {
      if (window.__xxSpedGuardsInstalled) return;
      window.__xxSpedGuardsInstalled = true;
      // 注意：.spx-log 必须排在 .spx-body 前面（closest 取最近的祖先），
      // 否则鼠标在日志上滚动时会被当成「弹窗空白处」，滚轮被吃掉（用户 2026-11-24）。
      const SCROLLERS = '.spx-log,[data-spx-log],.sped-cols,.sped-sku-list,.sped-detail-grid,.sped-body-wrap,.spx-body,.spx-form-main,.sp-dialog-body,[data-sped-scroll]';
      document.addEventListener('wheel', event => {
        const overlay = event.target.closest?.('.sped-scrim,.spx-backdrop,.sp-dialog-backdrop');
        if (!overlay) return;
        const scroller = event.target.closest?.(SCROLLERS);
        if (!scroller) {
          // 弹窗里的空白处：吃掉滚轮，别把后面的整页滚走
          if (overlay.classList.contains('sped-scrim')) event.preventDefault();
          return;
        }
        const atTop = scroller.scrollTop <= 0;
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
        if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom) || scroller.scrollHeight <= scroller.clientHeight) {
          event.preventDefault();
        }
      }, { passive: false });
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !ui.open) return;
        if (ui.zoomUrl) { ui.zoomUrl = ''; render(); event.preventDefault(); return; }
        if (ui.slotMenu) { ui.slotMenu = ''; render(); event.preventDefault(); return; }
        close();
        event.preventDefault();
      });
    }

    async function run(method, payload, { success = '', mutate } = {}) {
      if (ui.busy) return null;
      ui.busy = true; render();
      try {
        const result = await api(`selectionpool.${method}`, { itemId: ui.itemId, ...payload });
        if (result?.draft && ui.data) ui.data.draft = result.draft;
        if (result?.duplicates && ui.data) ui.data.duplicates = result.duplicates;
        if (result?.tabs && ui.data) ui.data.tabs = result.tabs;
        if (typeof mutate === 'function') mutate(result);
        if (success || result?.message) toast(success || result.message);
        if (method === 'editorSave') { ui.dirty = false; ui.message = '本机草稿已保存'; }
        else ui.message = result?.message || '有未保存的修改';
        return result;
      } catch (error) { showError(error); return null; }
      finally { ui.busy = false; render(); }
    }

    // ---------------------------------------------------------------- 小组件
    const money = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? '—' : `¥${Number(v).toFixed(2)}`;
    const clip = (v, n = 40) => { const t = String(v || ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
    const safeImg = url => /^(?:https:\/\/|data:image\/)/i.test(String(url || '')) ? String(url) : '';

    function header() {
      const p = detail().product || {};
      const row = ui.row || {};
      const title = p.title || row.title || '';
      const flow = detail().flow || row.flow || 'todraw';
      const platform = p.platform || row.platform || '';
      const productId = p.id || row.productId || '';
      const shopName = p.shopName || row.shopName || '';
      const priceText = p.priceFen != null ? money(p.priceFen / 100)
        : row.priceFen != null ? money(Number(row.priceFen) / 100) : (row.priceLabel || '');
      return `<div class="sped-head">
        <div class="sped-head-main">
          <h2>${esc(clip(title || '正在读取商品信息…', 60))}</h2>
          <div class="sped-head-meta">
            <span class="sped-chip ${flow === 'done' ? 'ok' : flow === 'publishFailed' ? 'bad' : 'warn'}">${esc(FLOW_LABELS[flow] || flow)}</span>
            <span>${esc(PLATFORM_LABELS[platform] || platform || '—')}</span>
            <span class="mono">${esc(productId || '—')}</span>
            <span>${esc(shopName || '—')}</span>
            <b>${esc(priceText || '—')}</b>
            ${ui.busy ? '<span class="sped-head-busy"><span class="spinner"></span>读取中</span>' : ''}
          </div>
        </div>
        <button type="button" class="sped-close" data-action="selectionpool:editor-close" aria-label="关闭" title="关闭（草稿自动保存）">×</button>
      </div>`;
    }

    function codeBar() {
      const cell = (which, label, placeholder, badge) => `<div class="sped-code-cell">
        <span class="sped-code-label">${esc(label)}${badge ? `<em class="sped-fifth-tip">${esc(badge)}</em>` : ''}</span>
        <input class="sped-input" data-sped-code="${which}" value="${esc(ui.codes[which] || '')}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}">
      </div>`;
      const mode = draft().transMode || 'auto';
      return `<div class="sped-codebar">
        ${cell('main', '主图编码', '粘贴 8 位编码，回车')}
        ${cell('fifth', '第 5 张编码', '粘贴 6 位编码，回车', '重要提示')}
        ${cell('sku', 'SKU 编码', '粘贴编码，多个用逗号或空格分开，回车')}
      </div>
      <div class="sped-material-bar">
        <span class="sped-code-label">素材图</span>
        ${[['auto', '上架时自动生成'], ['generated', '现在生成'], ['code', '填编码']].map(([v, l]) =>
          `<button type="button" class="filter-chip ${mode === v ? 'active' : ''}" data-action="selectionpool:editor-trans-mode" data-value="${v}">${l}</button>`).join('')}
        ${mode === 'code' ? `<input class="sped-input sped-trans-code" data-sped-field="transCode" value="${esc(draft().transCode || '')}" placeholder="粘贴素材图编码" aria-label="素材图编码">` : ''}
        <span class="spacer"></span>
        ${drawingStatusBar()}
      </div>`;
    }

    /** AI作图 服务状态 + 按商品 ID 自动匹配最近任务（三端打通）。 */
    function drawingStatusBar() {
      const cfg = d().drawing || {};
      if (!cfg.configured) {
        return '<span class="sped-hint sped-hint-warn">AI作图 未配置：到「上品库 → 接口配置」填服务地址与 Key 后，粘贴编码即可读取成品</span>';
      }
      return `<span class="sped-hint sped-hint-ok">AI作图 已连接 · ${esc(cfg.apiRoot || '')}</span>
        <button type="button" class="button small" data-action="selectionpool:editor-drawing-auto" title="按商品 ID 从 AI作图 找最近的作图任务并读取成品">自动匹配作图任务</button>`;
    }

    /** 本机成品缩略图（data URL，由主进程生成）。 */
    function thumbStrip(items, label, variant) {
      const rows = list(items);
      if (!rows.length) return '';
      return `<div class="sped-thumbs ${variant === 'tall' ? 'sped-thumbs-tall' : ''}"><span class="sped-thumbs-label">${esc(label)} · ${rows.length} 张（已存本机）</span>
        ${rows.map(t => `<img src="${esc(t.dataUrl)}" alt="" title="${esc(t.path || '')}" loading="lazy">`).join('')}</div>`;
    }

    function tabBar() {
      return `<div class="sped-tabs">${tabs().map(t => `<button type="button" class="sped-tab ${ui.tab === t.id ? 'active' : ''}" data-action="selectionpool:editor-tab" data-value="${esc(t.id)}">${esc(t.label)}${t.count != null ? `<em>${t.count}</em>` : ''}</button>`).join('')}</div>`;
    }

    function imageThumb(url, caption, extra = '') {
      const src = safeImg(url);
      return `<div class="sped-thumb ${extra}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="sped-thumb-empty">${svg('image')}</span>`}<small>${esc(caption)}</small></div>`;
    }

    /** 图位最终列表：草稿里有 slotImages 就用它（按下标覆盖，拖动排序 / 单张换图都存在这里），否则用原图。 */
    function slotList(group, base) {
      const fromBase = list(base).map(u => String(u || '')).filter(Boolean).slice(0, 5);
      const saved = list(draft().slotImages?.[group]);
      if (!saved.length) return fromBase;
      const merged = fromBase.slice();
      for (let i = 0; i < 5; i++) if (saved[i]) merged[i] = String(saved[i]);
      for (let i = 0; i < 5; i++) if (!merged[i]) merged[i] = '';
      return merged.slice(0, 5);
    }

    /** 图位上的图怎么显示：https 直连；local: 用主进程给的 data URL 预览（CSP 只允许 data:/https:）。 */
    function slotSrc(group, index, url) {
      const raw = String(url || '');
      if (/^data:image\//i.test(raw)) return raw;
      if (/^https:\/\//i.test(raw)) return raw;
      return ui.previews[raw] || ui.previews[`${group}:${index}`] || '';
    }

    function slotMenuHtml(group, index, hasImage) {
      if (ui.slotMenu !== `${group}:${index}`) return '';
      return `<div class="sped-slot-menu" data-sped-menu="${esc(`${group}:${index}`)}">
        <button type="button" data-action="selectionpool:editor-slot-code" data-group="${esc(group)}" data-key="${index}">换编码的图</button>
        <button type="button" data-action="selectionpool:editor-slot-local" data-group="${esc(group)}" data-key="${index}">用本机图片</button>
        <button type="button" data-action="selectionpool:editor-slot-url" data-group="${esc(group)}" data-key="${index}">填图片地址</button>
        ${hasImage ? `<button type="button" class="danger" data-action="selectionpool:editor-slot-clear" data-group="${esc(group)}" data-key="${index}">还原这张</button>` : ''}
        <button type="button" class="dim" data-action="selectionpool:editor-slot-close">收起</button>
      </div>`;
    }

    /**
     * 图位卡片（用户 2026-11-11 第十次）：
     *   老软件的 1:1 / 3:4 图位可以「拖动换位置」「单张换成编码的图」，这里补上：
     *   - draggable + 拖动把手，拖到别的图位上就换顺序；
     *   - 「换图」菜单：换编码的图 / 本机图片 / 填图片地址 / 还原。
     */
    function slotCard(url, index, group, opt = {}) {
      const src = slotSrc(group, index, url);
      const no = index === 0 ? (opt.firstLabel || '首图') : `${opt.prefix || '图'} ${index + 1}`;
      return `<div class="sped-slot ${src ? 'has' : ''} ${opt.off ? 'off' : ''}" data-sped-slot="${index}" data-sped-group="${esc(group)}" draggable="true">
        ${src
          ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="sped-zoom" data-action="selectionpool:editor-zoom" data-sped-zoom="${esc(src)}" title="点击查看图片全貌">`
          : `<span class="sped-slot-plus">+</span>`}
        <span class="sped-slot-no">${esc(no)}</span>
        <span class="sped-slot-drag" title="按住拖动可以调整顺序">⠿</span>
        <button type="button" class="sped-slot-replace" data-action="selectionpool:editor-slot-menu" data-group="${esc(group)}" data-key="${index}" title="换这张图">${src ? '换图' : '选图'}</button>
        ${slotMenuHtml(group, index, Boolean(src))}
      </div>`;
    }

    /** 采集图条：按原网页顺序展示，点击任意图看全貌。字符串与 {src} 对象都接受。 */
    function captureImageStrip(urls, label, emptyHint) {
      const urlOf = u => (typeof u === 'string' ? u : (u?.src || u?.url || ''));
      const items = list(urls).map(urlOf).filter(Boolean);
      if (!items.length) return `<div class="sped-empty-box">${esc(emptyHint || '还没有采集到图片')}</div>`;
      return `<div class="sped-capture-strip"><div class="sped-capture-label">${esc(label)} · ${items.length} 张（按原网页顺序）</div>
        <div class="sped-capture-grid">${items.map((u, i) => {
          const src = safeImg(u);
          return src ? `<button type="button" class="sped-capture-item" data-action="selectionpool:editor-zoom" data-sped-zoom="${esc(src)}" title="点击查看图片全貌"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"><em>${i + 1}</em></button>` : '';
        }).join('')}</div></div>`;
    }

    /** 图片全貌浮层：不整页重绘，只开关这个浮层，避免页面跳动。 */
    function zoomLayer() {
      if (!ui.zoomUrl) return '';
      return `<div class="sped-zoom-mask" data-action="selectionpool:editor-zoom-close">
        <button type="button" class="sped-zoom-x" data-action="selectionpool:editor-zoom-close" title="关闭">×</button>
        <img class="sped-zoom-img" src="${esc(safeImg(ui.zoomUrl))}" alt="图片全貌">
      </div>`;
    }

    /**
     * 1:1 主图（用户 2026-11-11 第十次）：
     *   老软件的 5 个图位永远是「有图的」——有作图成品就用成品，没有就用采集原图（手机端 1:1）。
     *   之前固定先画「作图成品」那 5 个空位，用户看起来就是「1:1 主图没采到」。
     *   现在按当前选用的来源画一组图位，并允许拖动排序 / 单张换图。
     */
    function squareSection() {
      const aiImages = list(draft().squareAiImages);
      const srcImages = list(d().squareSrcImages);
      const useSrc = draft().useSquare === 'src' || !aiImages.length;
      const group = useSrc ? 'squareSrc' : 'square';
      const slots = slotList(group, useSrc ? srcImages : aiImages);
      const chip = (value, label, count, disabled) => `<button type="button" class="sped-src-chip ${(useSrc ? 'src' : 'ai') === value ? 'on' : ''}" data-action="selectionpool:editor-use-square" data-value="${value}" ${disabled ? 'data-empty="1"' : ''}>${esc(label)}<em>${count}</em></button>`;
      const note = useSrc
        ? (srcImages.length ? `采集到 ${srcImages.length} 张手机端 1:1 主图，上架按这 ${slots.length} 张整组替换` : '没有采集到 1:1 主图；可在「换图」里用编码或本机图片补')
        : (aiImages.length ? `将提交这 ${Math.min(aiImages.length, 5)} 张，统一处理为 1440×1440` : '还没有作图成品');
      return `<section class="sped-sec">
        <div class="sped-sec-h"><h3>1:1 主图</h3><span class="hint">拖动图片调整顺序 · 单张可以换成编码的图，最多 5 张</span></div>
        <div class="sped-src-switch">
          ${chip('ai', '作图成品', aiImages.length, false)}
          ${chip('src', '采集原图', srcImages.length, false)}
          <span class="spacer"></span>
          <span class="sped-sub-note">${esc(note)}</span>
        </div>
        ${thumbStrip(d().squareThumbs, '1:1 作图成品')}
        <div class="sped-grid5">${Array.from({ length: 5 }, (_, i) => slotCard(slots[i], i, group, { firstLabel: '首图' })).join('')}</div>
        <p class="sped-note">当前选用：${useSrc ? '采集原图（手机端 1:1）' : '作图成品'} · ${slots.length} 张${slots.length && slots.length < 5 ? `；整组替换，提交后仓库 1:1 主图只剩这 ${slots.length} 张` : ''}</p>
      </section>`;
    }

    function tallSection() {
      const images = list(draft().tallAiImages);
      const captured = [...new Set([...list(draft().tallSrcImages), ...list(detail().tallImages)])].slice(0, 5);
      const keep = draft().useTall === 'keep';
      const base = images.length ? images : captured;
      const slots = slotList('tall', base);
      return `<section class="sped-sec">
        <div class="sped-sec-h"><h3>3:4 主图</h3><span class="hint">最小 750×1000，最多 5 张 · 可拖动排序 / 单张换图</span>
          <label class="sped-check"><input type="checkbox" data-action="selectionpool:editor-use-tall-check" ${keep ? 'checked' : ''}>这组不提交（仓库保持原样）</label>
        </div>
        <div class="sped-src-switch plain">
          <b>${images.length ? '作图成品' : '采集原图'}</b>
          ${draft().mainCode ? `<span class="sped-code-tag">#${esc(draft().mainCode)}</span>` : ''}
          <span class="spacer"></span>
          <span class="sped-sub-note">${keep ? '这组不提交，仓库商品的 3:4 主图保持原样'
            : slots.length ? `将提交这 ${Math.min(slots.length, 5)} 张，统一处理为 1440×1920`
              : '还没有 3:4 图；这一组不提交，仓库商品保持原样'}</span>
        </div>
        ${thumbStrip(d().tallThumbs, '3:4 作图成品', 'tall')}
        ${slots.length
          ? `<div class="sped-grid5 sped-grid-tall ${keep ? 'sped-grid5-off' : ''}">${Array.from({ length: 5 }, (_, i) => slotCard(slots[i], i, 'tall', { prefix: '3:4 图' })).join('')}</div>`
          : '<div class="sped-empty-box">原网页没有单独的 3:4 主图，可用 1:1 主图生成</div>'}
        ${captureImageStrip(captured, '采集的 3:4 主图', '原网页没有单独的 3:4 主图，可用 1:1 主图生成')}
      </section>`;
    }

    function skuImageSection() {
      const rows = skus().filter(s => s.image);
      const urlOf = u => (typeof u === 'string' ? u : (u?.src || u?.url || ''));
      // 草稿里已经按采集基线种过一份，再拼采集详情会翻倍（用户 2026-11-11：14 张显示成 28 张）。
      const captured = [...new Set([...list(detail().skuImages), ...list(draft().skuImages)].map(urlOf).filter(Boolean))];
      return `<section class="sped-sec">
        <div class="sped-sec-h"><h3>SKU 图</h3></div>
        <p class="sped-note">点（输入）把作图里的规格（名称 + 图）放进右边规格列表，上架就按这些规格上新；没插入的在入仓后按规格名对应补图。</p>
        <p class="sped-note">没有 SKU 作图成品时，SKU 图沿用采集的规格图（入仓后自动补）。在作图后台做好 SKU 图后（「SKU 制作」或主图任务都行），把编码填到上方「SKU 编码」。</p>
        ${rows.length ? `<div class="sped-grid5">${rows.slice(0, 10).map(s => imageThumb(s.image, clip(s.name, 12))).join('')}</div>` : ''}
        ${captureImageStrip(captured, '采集的规格图', '还没有采集到规格图')}
      </section>`;
    }

    function detailSection() {
      const images = list(draft().detailImages);
      const sources = draft().detailImageSources || {};
      return `<section class="sped-sec">
        <div class="sped-sec-h">
          <h3>详情页 <em>${images.length}</em></h3>
          <span class="hint">按顺序全部上传；长图切段后算张数，最多 40 张${images.length ? `（现在约 ${images.length} 张）` : ''}</span>
          <button type="button" class="button small" data-action="selectionpool:editor-detail-template">模板</button>
          ${draft().detailEdited ? '<button type="button" class="button small" data-action="selectionpool:editor-detail-restore">恢复采集图</button>' : ''}
        </div>
        <div class="sped-detail-code">
          <span>详情页编码</span>
          ${draft().detailCode ? `<span class="sped-code-tag">#${esc(draft().detailCode)}</span>` : ''}
          <input class="sped-input" data-sped-detail-code value="${esc(draft().detailCode || '')}" placeholder="粘贴作图编码，回车或点别处读取，直接用 A 图" aria-label="详情页编码">
        </div>
        ${images.length ? `<div class="sped-detail-grid">${images.slice(0, 40).map((u, i) => `<div class="sped-detail-cell">
          <div class="sped-detail-img">${safeImg(u) ? `<img src="${esc(safeImg(u))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="sped-thumb-empty">${svg('image')}</span>`}
            <span class="sped-detail-no">${i + 1}</span>
            <span class="sped-detail-src ${sources[String(i)] === 'drawing' ? 'drawing' : ''}">${sources[String(i)] === 'drawing' ? '作图' : '采集'}</span>
          </div>
          <div class="sped-detail-ops">
            <button type="button" data-action="selectionpool:editor-detail-move" data-index="${i}" data-to="${i - 1}" ${i === 0 ? 'disabled' : ''} title="往前移">‹</button>
            <button type="button" data-action="selectionpool:editor-detail-move" data-index="${i}" data-to="${i + 1}" ${i === images.length - 1 ? 'disabled' : ''} title="往后移">›</button>
            <span class="spacer"></span>
            <button type="button" data-action="selectionpool:editor-detail-remove" data-index="${i}" title="删除这张详情图">🗑</button>
          </div>
        </div>`).join('')}</div>` : '<div class="sped-empty-box">采集包里没有详情图</div>'}
      </section>`;
    }

    function transSection() {
      const mode = draft().transMode || 'auto';
      const options = [
        ['auto', '上架时自动生成', '默认。这里不用管，上架时按产品自动生成提示词出图'],
        ['generated', '现在生成', '提前生成好看效果，上架时直接用这张'],
        ['code', '填素材图编码', '从图库调取已有的图（如作图系统做好的透明图）'],
      ];
      const box = (which, title, source, fileValue) => {
        const src = which === 'white' ? draft().whiteSource : draft().transSource;
        return `<div class="sped-material-box">
          <strong>${esc(title)}</strong>
          <div class="sped-checker ${which === 'white' ? 'white' : ''}">${fileValue && safeImg(fileValue)
            ? `<img src="${esc(safeImg(fileValue))}" alt="" referrerpolicy="no-referrer">`
            : `<span>上架时自动生成${which === 'white' ? '白底图' : '透明图'}</span>`}</div>
          <div class="sped-material-src">来源：${src === 'auto' ? '自动生成 · 暂无预览' : src === 'local' ? '本机上传' : '填编码'}</div>
          <div class="sped-material-acts">
            <button type="button" class="button small" data-action="selectionpool:editor-material-source" data-which="${which}" data-source="local">本机上传</button>
            <button type="button" class="button small" data-action="selectionpool:editor-material-source" data-which="${which}" data-source="code">填编码</button>
            ${src !== 'auto' ? `<button type="button" class="button small" data-action="selectionpool:editor-material-source" data-which="${which}" data-source="auto">改回自动生成</button>` : ''}
          </div>
        </div>`;
      };
      return `<section class="sped-sec"><div class="sped-sec-h"><h3>素材图</h3><span class="hint">透明素材图与白底图 · 800×800 · 两个图位可以各自本机上传或填编码</span></div>
        <div class="sped-tr-opts">${options.map(([v, label, note]) => `<button type="button" class="sped-tr-opt ${mode === v ? 'on' : ''}" data-action="selectionpool:editor-trans-mode" data-value="${v}"><b>${label}</b><span>${note}</span></button>`).join('')}</div>
        <div class="sped-material-grid">
          ${box('trans', '透明素材图', draft().transSource, draft().transFile)}
          ${box('white', '白底图', draft().whiteSource, draft().whiteFile)}
        </div>
        <p class="sped-note">白底图单独生效，生成后会在这里展示；也可以上传。</p>
        ${captureImageStrip([...list(d().materialImages), ...list(draft().materialImages)], '采集的素材图（透明图 / 白底图）', '原网页没有单独的素材图，上架时按产品自动生成')}
        <div class="sped-material-foot"><button type="button" class="button small" data-action="selectionpool:editor-material-reload">重新读取</button></div>
      </section>`;
    }

    function videoSection() {
      const videos = list(draft().videos);
      return `<section class="sped-sec"><div class="sped-sec-h"><h3>商品视频</h3></div>
        <p class="sped-note">手动选了才挂 · 入仓后回填时挂到仓库商品上，没挂上不影响入仓 · 5 秒–5 分钟 · 1:1 / 3:4 / 9:16 · 不低于 720p</p>
        <p class="sped-note">${videos.length ? `已选 ${videos.length} 个视频` : '没选视频，上架和回填都不挂视频'}</p>
        <div class="sped-video-acts">
          <button type="button" class="button small" data-action="selectionpool:editor-video-local">本机上传 ▾</button>
          <button type="button" class="button small" data-action="selectionpool:editor-video-library">从店铺视频库选 ▾</button>
          <span class="sped-hint">${list(detail().videos).length ? `源商品采集到 ${list(detail().videos).length} 个视频（已放进列表）` : '源商品没有采到视频'}</span>
        </div>
        ${videos.length ? `<div class="sped-video-list">${videos.map((v, i) => {
          const url = safeImg(v.url || v.file || '');
          return `<div class="sped-video-row">
          ${v.kind === 'source' && url ? `<button type="button" class="sped-video-cover" data-action="selectionpool:editor-video-open" data-url="${esc(url)}" title="点击在新窗口播放">
            <video src="${esc(url)}" ${(detail().videoPoster || detail().product?.imageUrl) ? `poster="${esc(detail().videoPoster || detail().product?.imageUrl)}"` : ''} preload="metadata" muted playsinline></video>
            <span class="sped-video-play">▶</span>
          </button>` : ''}
          <b>${esc(v.type || '宝贝展示')}</b><span>${esc(v.ratio || '—')}</span>
          <span class="sped-video-name" title="${esc(v.name || v.file || v.url || '')}">${esc(clip(v.name || v.file || v.url, 48))}</span>
          ${v.kind === 'source' && url ? `<button type="button" class="sped-video-open" data-action="selectionpool:editor-video-open" data-url="${esc(url)}" title="在新窗口播放">打开</button>` : ''}
          <button type="button" class="sped-ico" data-action="selectionpool:editor-video-remove" data-index="${i}" title="移除">🗑</button>
        </div>`;
        }).join('')}</div>` : ''}
      </section>`;
    }

    /** 老软件类目行格式：一级 xxx › 二级 xxx › 三级 xxx · ID xxxxx · 采集
     *  优先用采集包给的完整 levels 数组（不会被切分猜层级），再用路径字符串拆。
     *  老软件路径可到四级，级别名按索引生成，不截断。 */
    function categoryPathLabel() {
      const levelsFromData = [...list(d().categoryLevels), ...list(detail().categoryLevels)];
      const raw = String(d().categoryPath || draft().categoryPath || detail().categoryPath || '').trim();
      let parts = levelsFromData.map(x => String(x || '').trim()).filter(Boolean);
      if (parts.length < 2 && raw) {
        // 类目名本身可能带斜杠（如「粮油调味/速食/干货/烘焙」），只按层级分隔符切，不按单个 "/" 切。
        const splitted = raw.split(/\s*(?:›|>|→|\||、|,|，)\s*/).map(s => s.trim())
          .map(s => s.replace(/^(?:一级|二级|三级|四级|五级)\s*/, '')).filter(Boolean);
        if (splitted.length > parts.length) parts = splitted;
      }
      if (!parts.length) return `类目 ID ${d().categoryId || draft().categoryId || '—'}（中文路径未采集到，可在「修改类目」里选择）`;
      if (/^一级\s/.test(raw) && parts.length < 2) return raw;
      const levelNames = ['一级', '二级', '三级', '四级', '五级'];
      const label = parts.slice(0, 6).map((p, i) => `${levelNames[i] || `${i + 1}级`} ${p}`).join(' › ');
      return label;
    }
    function paramsSection() {
      const attrs = list(draft().attrs);
      const cat = detail();
      const custom = draft().categoryCustom;
      return `<section class="sped-sec">
        <div class="sped-cat-bar">
          <span class="sped-cat-label">类目</span>
          <span class="sped-cat-path">${esc(categoryPathLabel())}
            ${(d().categoryId || draft().categoryId) ? `<em>ID ${esc(d().categoryId || draft().categoryId)}</em>` : ''}
            <em>${custom ? '手工指定' : '采集'}</em></span>
          <button type="button" class="button small" data-action="selectionpool:editor-category-read">采集</button>
          <button type="button" class="button small" data-action="selectionpool:editor-category-edit">修改类目</button>
          ${custom ? '<button type="button" class="button small" data-action="selectionpool:editor-category-restore">恢复采集类目</button>' : ''}
        </div>
        <div class="sped-sec-h"><h3>参数 <em>${attrs.length}</em></h3><span class="hint">改过的项上架时照抄填写，不再由 AI 处理</span></div>
        ${attrs.length ? `<div class="sped-params-grid">${attrs.map((a, i) => `<div class="sped-param-cell">
          <span class="sped-attr-name" title="${esc(a.name)}">${esc(a.name || '—')}</span>
          <input class="sped-input" data-sped-attr="${i}" value="${esc(a.value || '')}" ${a.locked ? 'disabled' : ''} aria-label="${esc(a.name)}">
          <button type="button" class="sped-ico" data-action="selectionpool:editor-param-remove" data-index="${i}" title="删除这项参数" ${a.locked ? 'disabled' : ''}>🗑</button>
        </div>`).join('')}</div>` : '<div class="sped-empty-box">没有采集到参数</div>'}
        <button type="button" class="sped-add" data-action="selectionpool:editor-param-add">＋ 增加参数</button>
        <p class="sped-note">例如把「生产许可证编号」改成自己供应商的真实编号。品牌按店铺授权品牌填写，不在这里改。</p>
      </section>`;
    }

    function leftColumn() {
      const show = id => ui.tab === 'all' || ui.tab === id;
      const onlyParams = ui.tab === 'params';
      return `<div class="sped-col sped-col-images ${singleColumn() ? 'sped-col-full' : ''}">
        ${show('sq') ? squareSection() : ''}
        ${show('tl') ? tallSection() : ''}
        ${show('sku') ? skuImageSection() : ''}
        ${show('detail') ? detailSection() : ''}
        ${show('trans') ? transSection() : ''}
        ${show('video') ? videoSection() : ''}
        ${show('params') ? paramsSection() : ''}
      </div>`;
    }

    /**
     * 只有「全部图位」「SKU 图」保留右侧规格表；
     * 1:1 主图 / 3:4 主图 / 详情图 / 素材图 / 视频 / 参数 都改成整栏显示（用户 2026-11-11）。
     */
    function singleColumn() {
      return ui.tab === 'params' || !['all', 'sku'].includes(ui.tab);
    }

    // ---------------------------------------------------------------- 右侧规格表
    function repricePanel() {
      if (!ui.repriceOpen) return '';
      const r = draft().reprice || { factor: '1', amount: '3', direction: 'subtract' };
      return `<div class="sped-reprice" aria-label="批量改价">
        <span>同行价 ×</span>
        <input class="sped-input mini" data-sped-reprice="factor" value="${esc(r.factor)}" aria-label="倍数">
        <select class="sped-select mini" data-sped-reprice="direction" aria-label="加或减">
          <option value="subtract" ${r.direction === 'subtract' ? 'selected' : ''}>减</option>
          <option value="add" ${r.direction === 'add' ? 'selected' : ''}>加</option>
        </select>
        <input class="sped-input mini" data-sped-reprice="amount" value="${esc(r.amount)}" aria-label="金额">
        <span>元</span>
        <button type="button" class="button primary small" data-action="selectionpool:editor-reprice-apply">应用改价</button>
        <button type="button" class="button small" data-action="selectionpool:editor-reprice-close">收起</button>
      </div>`;
    }

    function pastePanel() {
      if (!ui.pasteOpen) return '';
      return `<div class="sped-paste">
        <p class="sped-note">从 Excel 或聊天里复制「规格名 价格」，一行一个，自动识别。</p>
        <textarea class="sped-textarea" data-sped-paste rows="5" placeholder="红糖味手工麻糍250g*5盒  85.90">${esc(ui.pasteText)}</textarea>
        <div class="sped-paste-foot">
          <button type="button" class="button primary small" data-action="selectionpool:editor-paste-apply">插入规格</button>
          <button type="button" class="button small" data-action="selectionpool:editor-paste-close">取消</button>
        </div>
      </div>`;
    }

    function skuRow(row, index) {
      const key = String(row.key || index);
      const img = safeImg(row.image);
      return `<div class="sped-sku-row ${row.removed ? 'removed' : ''}" data-sped-sku="${esc(key)}">
        <input type="checkbox" data-sped-sku-select="${esc(key)}" ${ui.selected.has(key) ? 'checked' : ''} aria-label="选择规格">
        <div class="sped-sku-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-action="selectionpool:editor-zoom" data-sped-zoom="${esc(img)}" title="点击放大这张规格图">` : `<span class="sped-thumb-empty">${svg('image')}</span>`}</div>
        <button type="button" class="sped-sku-replace" data-action="selectionpool:editor-sku-image" data-key="${esc(key)}" title="替换这张规格图">替换</button>
        <button type="button" class="sped-sku-star ${row.starred ? 'on' : ''}" data-action="selectionpool:editor-sku-star" data-key="${esc(key)}" title="设为主推">★</button>
        <span class="sped-sku-name">
          <input class="sped-inline" data-sped-sku-field="name" data-key="${esc(key)}" value="${esc(row.name || '')}" placeholder="规格名" aria-label="规格名">
          ${row.template ? '<em class="sped-tpl">宣传规格</em>' : ''}
          ${row.added ? '<em class="sped-added">新增</em>' : ''}
          ${(d().duplicates || []).includes(String(row.name || '').trim()) ? '<em class="sped-dup" title="上架时后面那条自动加（规格N）区分">同名</em>' : ''}
        </span>
        <span class="sped-sku-price">¥<input class="sped-inline price" data-sped-sku-field="price" data-key="${esc(key)}" value="${esc(row.price || '')}" placeholder="价格" aria-label="价格"></span>
        <span class="sped-sku-stock">库存 <input class="sped-inline stock" data-sped-sku-field="stock" data-key="${esc(key)}" value="${esc(row.stock || '1000')}" aria-label="库存"></span>
        <button type="button" class="sped-ico" data-action="selectionpool:editor-sku-edit" data-key="${esc(key)}" title="编辑这条规格">✎</button>
        <button type="button" class="sped-ico" data-action="selectionpool:editor-sku-remove" data-key="${esc(key)}" title="删除这条规格">🗑</button>
      </div>`;
    }

    function rightColumn() {
      const rows = skus();
      const dup = d().duplicates || [];
      return `<div class="sped-col sped-col-sku">
        <div class="sped-sku-bar">
          <input type="checkbox" data-action="selectionpool:editor-sku-select-all" aria-label="选择全部规格">
          <h3>规格 <em>${rows.length}</em></h3>
          ${ui.selected.size ? `<button type="button" class="button small danger" data-action="selectionpool:editor-sku-delete-selected">删除选中（${ui.selected.size}）</button>` : ''}
          <span class="hint">点名称、价格直接改，回车或点别处自动存；包含产品上架时自动识别，不用填</span>
        </div>
        <div class="sped-sku-actions">
          <button type="button" class="button small" data-action="selectionpool:editor-sku-template">SKU 模板</button>
          <button type="button" class="button small" data-action="selectionpool:editor-sku-clean" title="去掉规格名里的营销词/emoji，重名自动加（规格N）">清理规格名</button>
          <button type="button" class="button small ${ui.pasteOpen ? 'primary' : ''}" data-action="selectionpool:editor-paste-toggle">批量粘贴</button>
          <button type="button" class="button small ${ui.repriceOpen ? 'primary' : ''}" data-action="selectionpool:editor-reprice-toggle" ${rows.length ? '' : 'disabled'}>批量改价</button>
        </div>
        ${dup.length ? `<div class="sped-dup-hint">有 ${dup.length} 个规格名重复（${esc(dup.slice(0, 2).join('、'))}）：上架时后面那条会自动加「（规格N）」区分，每条用自己的图，不用改名。</div>` : ''}
        ${repricePanel()}${pastePanel()}
        <div class="sped-sku-row sped-sku-head"><span></span><span></span><span></span><span></span><span>规格名</span><span class="h-price">价格</span><span class="h-stock">库存</span><span></span><span></span></div>
        <div class="sped-sku-list">${rows.length ? rows.map(skuRow).join('') : '<div class="sped-empty-box">采集包里没有规格，可用「批量粘贴」或「SKU 模板」新增</div>'}</div>
        <div class="sped-sku-foot-actions">
          <button type="button" class="sped-add" data-action="selectionpool:editor-sku-add">＋ 增加规格</button>
          ${rows.some(r => r.template) ? '<button type="button" class="button small" data-action="selectionpool:editor-sku-remove-templates">去掉宣传规格</button>' : ''}
        </div>
      </div>`;
    }

    /** 参数页等单栏页面复用的底部操作条（老软件截图：状态 + 恢复采集内容 + 保存）。 */
    function standaloneEditFoot() {
      if (ui.tab !== 'params') return '';
      return `<div class="sped-edit-foot sped-edit-foot-standalone">
        <span class="sped-state ${ui.dirty ? 'warn' : ''}">${esc(ui.message || draftStateText())}</span>
        <button type="button" class="button small" data-action="selectionpool:editor-restore" ${ui.busy ? 'disabled' : ''} title="清除本机保存的修改，恢复成采集内容">恢复采集内容</button>
        <button type="button" class="button primary small" data-action="selectionpool:editor-save" ${ui.busy || !ui.dirty ? 'disabled' : ''}>保存</button>
      </div>`;
    }

    /** 草稿状态明细（老软件：本机草稿已保存 · 时间 · 参数改 N 项 · 规格已编辑 · 详情页已编辑）。 */
    function draftStateText() {
      const dr = draft();
      if (!d().savedAt && !ui.dirty) return '还没有修改；上架时按采集内容和 AI 自动处理';
      if (ui.dirty) return '有未保存的修改';
      const parts = [`本机草稿已保存 · ${String(d().savedAt).slice(0, 16).replace('T', ' ')}`,
        `参数改 ${dr.paramEdits || 0} 项`];
      if (dr.specEdited) parts.push('规格已编辑');
      if (dr.detailEdited) parts.push('详情页已编辑');
      if (dr.title) parts.push('标题已改');
      return parts.join(' · ');
    }

    /** 「本次回填目标」：每个店铺最近一次入仓的商品 + 图位级回读状态 + 历史记录。 */
    function backfillPanel() {
      const bf = d().backfill;
      const targets = list(bf?.targets);
      const selected = list(bf?.selected);
      if (!targets.length) {
        return `<div class="sped-targets-empty"><b>还没有入仓的仓库商品</b> 先「上架」放入仓库，入仓后这里会列出这个店铺的仓库商品</div>`;
      }
      return `<div class="sped-targets">
        <div class="sped-targets-h"><b>本次回填目标</b><span>每个店铺最近一次入仓的商品</span></div>
        ${targets.map(t => `<label class="sped-target ${selected.includes(t.warehouseItemId) ? 'on' : ''}">
          <input type="checkbox" data-action="selectionpool:editor-target-toggle" data-id="${esc(t.warehouseItemId)}" ${selected.includes(t.warehouseItemId) ? 'checked' : ''}>
          <span class="sped-target-name">${esc(t.shopName || '店铺')} <em>#${esc(t.warehouseItemId)}</em></span>
          <span class="sped-target-readback">已回填 1:1 主图 ${esc(t.readback?.square || '0/5')} · 3:4 主图 ${esc(t.readback?.tall || '0/5')} · 透明素材图 · 白底图</span>
          <span class="sped-target-tag ${t.filled ? 'ok' : ''}">${t.filled ? '已回填' : '待回填'}</span>
        </label>`).join('')}
        ${list(bf?.historical).length ? `<details class="sped-history"><summary>历史入仓记录 ${list(bf.historical).length} 条 · 不影响本次状态</summary>
          <div class="sped-history-hint">需要补图时再勾选对应商品；保存结果未知的记录请先在商家后台核对。</div>
          ${list(bf.historical).slice(0, 10).map(h => `<div class="sped-history-row">${esc(h.shopName || '')} #${esc(h.warehouseItemId)} · ${esc(String(h.at || '').slice(0, 16).replace('T', ' '))}</div>`).join('')}
        </details>` : ''}
      </div>`;
    }

    function footer() {
      const targets = list(d().backfill?.targets);
      const selected = list(d().backfill?.selected);
      const driverReady = Boolean(d().driverReady);
      // 回填要走开放平台接口（图片空间 + 商品编辑）：凭证没填时按钮直接说明缺什么，不让用户白点。
      const backfillReady = d().backfillReady !== false;
      const label = !targets.length ? '先上架入仓，才能回填'
        : !selected.length ? '先勾选要回填的仓库商品'
          : !driverReady ? '回填驱动未接入'
            : !backfillReady ? '回填需要接口凭证（见下方提示）'
              : `提交到 ${selected.length} 个仓库商品`;
      const enabled = targets.length > 0 && selected.length > 0 && driverReady && backfillReady;
      return `<div class="sped-foot">
        ${backfillPanel()}
        <div class="sped-foot-note">主图放大为 1440×1440 / 1440×1920；透明和白底素材为 800×800，保存到仓库后重新读取核对；主图组内有一张失败，该组就不替换。${d().backfillReady === false ? `<br><b>回填需要接口凭证</b>：${esc(d().backfillNote || '请到「上品库 → 接口配置」填入 AppKey / AppSecret / sessionKey')}。需要申请：taobao.picture.upload、taobao.item.joint.img、taobao.item.update、taobao.item.seller.get。` : ''}</div>
        <div class="sped-foot-actions">
          <button type="button" class="button" data-action="selectionpool:editor-close">稍后</button>
          <button type="button" class="button primary" data-action="selectionpool:editor-backfill" ${enabled ? '' : 'disabled'} title="${esc(label)}">${esc(label)}</button>
        </div>
      </div>`;
    }

    /** 首屏骨架：还没读到数据时先把外壳画出来，避免「未命名商品 + 正在读取」一片空白。 */
    function skeleton() {
      return `<div class="sped-body-wrap">
        <div class="sped-top">
          <div class="sped-codebar">${[1, 2, 3].map(() => '<div class="sped-code-cell"><span class="sped-code-label">&nbsp;</span><div class="sped-skel sped-skel-input"></div></div>').join('')}</div>
          <div class="sped-tabs">${['全部图位', '1:1 主图', '3:4 主图', 'SKU 图', '详情图', '素材图', '视频', '参数'].map(l => `<span class="sped-tab">${l}</span>`).join('')}</div>
        </div>
        <div class="sped-cols sped-cols-single">
          <div class="sped-col sped-col-full">
            <section class="sped-sec">
              <div class="sped-sec-h"><h3>1:1 主图</h3><span class="hint">正在读取采集内容与作图成品…</span></div>
              <div class="sped-grid5">${[1, 2, 3, 4, 5].map(() => '<div class="sped-skel sped-skel-slot"></div>').join('')}</div>
            </section>
            <section class="sped-sec">
              <div class="sped-sec-h"><h3>3:4 主图</h3><span class="hint">·</span></div>
              <div class="sped-grid5">${[1, 2, 3, 4, 5].map(() => '<div class="sped-skel sped-skel-slot"></div>').join('')}</div>
            </section>
          </div>
        </div>
      </div>`;
    }

    function renderEditor() {
      if (!ui.open) return '';
      return `<div class="sped-scrim"><div class="sped-dialog" role="dialog" aria-label="商品图片工作台">
        ${header()}
        ${ui.error ? `<div class="sped-error">${esc(ui.error)}</div>` : ''}
        ${ui.data ? `<div class="sped-body-wrap">
          <div class="sped-top">${codeBar()}${tabBar()}</div>
          <div class="sped-cols ${singleColumn() ? 'sped-cols-single' : ''}">${leftColumn()}${ui.tab === 'params' ? standaloneEditFoot() : (singleColumn() ? '' : rightColumn())}</div>
          ${footer()}
        </div>` : skeleton()}
        ${zoomLayer()}
      </div></div>`;
    }

    // ---------------------------------------------------------------- 动作
    async function handleAction(action, target) {
      if (!String(action).startsWith('selectionpool:editor-')) return false;
      const cmd = action.slice('selectionpool:editor-'.length);
      const value = target.dataset.value;
      const key = target.dataset.key;
      const zoomUrl = target.dataset.spedZoom;
      if (zoomUrl) { ui.zoomUrl = zoomUrl; render(); return true; }
      switch (cmd) {
        case 'zoom-close': ui.zoomUrl = ''; render(); return true;
        case 'close': close(); return true;
        case 'video-open': {
          const url = String(target.dataset.url || '');
          try {
            const result = await api('app.openExternal', { url });
            if (!result?.ok) toast(result?.message || '打不开这个地址（可能不是有效视频直链）', true);
          } catch (error) {
            toast(String(error?.message || error), true);
          }
          return true;
        }
        case 'tab': if (TAB_IDS.includes(value)) { ui.tab = value; render(); } return true;
        // ---- 图位换图（拖动排序 / 单张换编码的图 / 本机图片 / 图片地址 / 还原）----
        case 'slot-menu': {
          const menuId = `${target.dataset.group || 'square'}:${target.dataset.key || 0}`;
          ui.slotMenu = ui.slotMenu === menuId ? '' : menuId;
          render(); return true;
        }
        case 'slot-close': ui.slotMenu = ''; render(); return true;
        case 'slot-code': {
          const group = target.dataset.group || 'square', index = Number(target.dataset.key) || 0;
          const values = await modal({
            title: '换成编码的图',
            description: '粘贴 AI作图 的编码，程序按编码取成品图放进这个图位（第 1 张）。',
            fields: `<div class="field"><label>作图编码</label><input name="code" required placeholder="例如 1794390237"></div>
              <div class="field"><label>取第几张（默认 1）</label><input name="index" value="1" placeholder="1"></div>`,
            confirm: '换上这张',
          });
          if (!values?.code) return true;
          const pick = Math.max(1, Number(values.index) || 1) - 1;
          const result = await api('selectionpool.editorReplaceImage', {
            itemId: ui.itemId, group, key: String(index), index, code: String(values.code).trim(), pick,
          }).catch(error => ({ error: String(error?.message || error) }));
          if (result?.error) { toast(result.error, true); return true; }
          ui.slotMenu = '';
          await refreshWithDraft(result);
          return true;
        }
        case 'slot-local': {
          const group = target.dataset.group || 'square', index = Number(target.dataset.key) || 0;
          const result = await api('selectionpool.editorPickImage', { itemId: ui.itemId, group, key: String(index), index })
            .catch(error => ({ error: String(error?.message || error) }));
          if (result?.error) { toast(result.error, true); return true; }
          if (result?.canceled) return true;
          ui.slotMenu = '';
          await refreshWithDraft(result);
          return true;
        }
        case 'slot-url': {
          const group = target.dataset.group || 'square', index = Number(target.dataset.key) || 0;
          const values = await modal({
            title: '填图片地址', description: '填入 https 图片地址（图片空间 / CDN 上的直链）。',
            fields: '<div class="field"><label>图片地址</label><input name="src" required placeholder="https://…"></div>',
            confirm: '换上这张',
          });
          if (!values?.src) return true;
          const result = await api('selectionpool.editorReplaceImage', {
            itemId: ui.itemId, group, key: String(index), index, src: String(values.src).trim(),
          }).catch(error => ({ error: String(error?.message || error) }));
          if (result?.error) { toast(result.error, true); return true; }
          ui.slotMenu = '';
          await refreshWithDraft(result);
          return true;
        }
        case 'slot-clear': {
          const group = target.dataset.group || 'square', index = Number(target.dataset.key) || 0;
          const result = await api('selectionpool.editorReplaceImage', {
            itemId: ui.itemId, group, key: String(index), index, clear: true,
          }).catch(error => ({ error: String(error?.message || error) }));
          if (result?.error) { toast(result.error, true); return true; }
          ui.slotMenu = '';
          await refreshWithDraft(result);
          return true;
        }
        case 'use-square': {
          const want = target.dataset.value || value;
          if (want === 'ai' && !list(draft().squareAiImages).length) {
            toast('还没有 AI作图 成品：先粘贴「主图编码」回车读取，或点「自动匹配作图任务」；现在先用采集原图', true);
            return true;
          }
          if (want === 'src' && !list(d().squareSrcImages).length) {
            toast('这条选品没有采集到 1:1 主图，可以在「换图」里用编码或本机图片补', true);
            return true;
          }
          await patch({ useSquare: want });
          return true;
        }
        case 'use-tall': await patch({ useTall: value }); return true;
        case 'trans-mode': await patch({ transMode: value, materialsCustom: value !== 'auto' }); return true;
        case 'save': await run('editorSave', {}); return true;
        case 'restore': {
          const ok = await modal({ title: '恢复采集内容', description: '清除本机保存的修改（规格、详情页、参数、手工指定的类目、自己换的素材图），恢复成采集内容。', fields: '', confirm: '确认恢复', danger: true });
          if (ok) { await run('editorRestore', {}, { mutate: r => { ui.dirty = false; ui.selected.clear(); } }); }
          return true;
        }
        case 'reprice-toggle': ui.repriceOpen = !ui.repriceOpen; render(); return true;
        case 'reprice-close': ui.repriceOpen = false; render(); return true;
        case 'reprice-apply': {
          const read = name => document.querySelector(`[data-sped-reprice="${name}"]`)?.value;
          const rule = { factor: read('factor') || '1', amount: read('amount') || '0', direction: read('direction') || 'subtract' };
          await run('editorReprice', { rule }, { mutate: () => { ui.repriceOpen = false; } });
          return true;
        }
        case 'paste-toggle': ui.pasteOpen = !ui.pasteOpen; render(); return true;
        case 'paste-close': ui.pasteOpen = false; ui.pasteText = ''; render(); return true;
        case 'paste-apply': {
          const text = document.querySelector('[data-sped-paste]')?.value || '';
          await run('editorPasteSkus', { text }, { mutate: () => { ui.pasteOpen = false; ui.pasteText = ''; } });
          return true;
        }
        case 'sku-template': {
          // 用户 2026-11-21：必须先选模板，不再偷偷塞一套默认宣传语。
          const templates = list(await api('selectionpool.imageTemplates', { kind: 'sku' }).catch(() => []));
          const countOf = t => `${list(t.skus).length} 条规格${t.storeName ? ` · ${t.storeName}` : ''}`;
          const options = templates.map((t, i) => `<label class="sped-tpl-item"><input type="radio" name="templateId" value="${esc(t.id)}" ${i === 0 ? 'checked' : ''}><span class="sped-tpl-main"><b>${esc(t.name || '未命名模板')}</b><em>${esc(countOf(t))}</em></span></label>`).join('');
          const fields = `${templates.length
            ? `<div class="sped-tpl-list">${options}<label class="sped-tpl-item"><input type="radio" name="templateId" value="__new__"><span class="sped-tpl-main"><b>＋ 把当前规格存为新模板</b><em>保存后在其它商品也能直接选</em></span></label></div>`
            : '<p class="sped-note">还没有 SKU 模板。把当前规格存成第一个模板，下一次就能直接选。</p>'}
            <div class="field"><label>新模板名称</label><input name="newName" placeholder="例如：食品通用宣传规格"></div>`;
          const values = await modal({ title: '选择 SKU 模板', description: '选一个模板插到规格最上面；也可以把当前规格存成模板。', fields, confirm: '确定' });
          if (!values) return true;
          const wantsNew = values.templateId === '__new__' || (!values.templateId && String(values.newName || '').trim());
          if (wantsNew) {
            const name = String(values.newName || '').trim();
            if (!name) { toast('请填写新模板名称', true); return true; }
            const rows = skus().filter(s => !s.removed && String(s.name || '').trim()).map(s => ({
              name: String(s.name || '').trim(), suffix: '', image: String(s.image || ''), price: String(s.price || ''), stock: String(s.stock || ''),
            }));
            if (!rows.length) { toast('当前还没有规格可存为模板', true); return true; }
            const shop = list(d().shopStates?.loggedIn)[0] || list(d().shopStates?.stores)[0] || null;
            const saved = await api('selectionpool.changeImageTemplate', {
              action: 'create', kind: 'sku', name, storeId: shop?.storeId || '', storeName: shop?.name || '', images: [], skus: rows,
            }).catch(error => ({ ok: false, message: String(error?.message || error) }));
            if (saved?.ok === false) { toast(saved.message || '模板保存失败', true); return true; }
            toast(`已保存 SKU 模板「${name}」`);
            return true;
          }
          if (!values.templateId) { toast('请选择一个模板，或填写新模板名称', true); return true; }
          const result = await api('selectionpool.editorSkuTemplate', { itemId: ui.itemId, templateId: Number(values.templateId) })
            .catch(error => ({ ok: false, message: String(error?.message || error) }));
          if (result?.ok) {
            if (ui.data) ui.data.draft = result.draft;
            ui.dirty = true;
            toast(`已插入 ${result.added} 条宣传规格${result.templateName ? `（${result.templateName}）` : ''}`);
            render();
          } else toast(result?.message || '插入模板失败', true);
          return true;
        }
        case 'sku-clean': {
          const preview = await api('selectionpool.editorSkuMatch', { itemId: ui.itemId, action: 'preview' })
            .catch(error => ({ ok: false, message: String(error?.message || error) }));
          if (!preview?.ok) { toast(preview?.message || '清理失败', true); return true; }
          if (!preview.changed) { toast('规格名已经很干净，没有需要改的'); return true; }
          const go = await modal({
            title: `清理规格名（${preview.changed} 条）`,
            description: '会去掉【】()、emoji、包邮/现货这类营销词，重名自动加「（规格N）」。价格与库存不动。',
            fields: `<div class="sped-clean-preview">${preview.preview.slice(0, 12).map(row => `<div><em>${esc(clip(row.before || '', 26))}</em><span>→</span><b>${esc(clip(row.after || '', 26))}</b></div>`).join('')}</div>`,
            confirm: '应用',
          });
          if (!go) return true;
          const result = await api('selectionpool.editorSkuMatch', { itemId: ui.itemId, action: 'apply' })
            .catch(error => ({ ok: false, message: String(error?.message || error) }));
          if (result?.ok) {
            if (ui.data) ui.data.draft = result.draft;
            ui.dirty = true; ui.message = result.message;
          } else toast(result?.message || '清理失败', true);
          render();
          return true;
        }
        case 'sku-select-all': {
          const all = skus().map(s => String(s.key));
          const shouldSelect = all.length > 0 && all.every(k => ui.selected.has(k));
          for (const k of all) shouldSelect ? ui.selected.delete(k) : ui.selected.add(k);
          render(); return true;
        }
        case 'sku-delete-selected': {
          const picked = new Set(ui.selected);
          if (!picked.size) return true;
          const ok = await modal({ title: '删除勾选的规格', description: `确定删除 ${picked.size} 条规格？删除后可在「恢复采集内容」找回。`, fields: '', confirm: '确认删除', danger: true });
          if (ok) {
            const next = skus().map(s => picked.has(String(s.key)) ? { ...s, removed: true } : s);
            await patch({ skus: next });
            ui.selected.clear();
          }
          return true;
        }
        case 'sku-remove': {
          const next = skus().map(s => String(s.key) === key ? { ...s, removed: !s.removed } : s);
          await patch({ skus: next }); return true;
        }
        case 'sku-star': {
          const next = skus().map(s => String(s.key) === key ? { ...s, starred: !s.starred } : s);
          await patch({ skus: next }); return true;
        }
        case 'sku-image': case 'replace': {
          const values = await modal({
            title: '替换图片', description: '填入图片 https 地址（本机图片可先上传到图片空间拿到地址）。',
            fields: '<div class="field"><label>图片地址</label><input name="src" class="sped-input" placeholder="https://…"></div>', confirm: '替换',
          });
          if (values?.src) await run('editorReplaceImage', { group: target.dataset.group || 'sku', key: key || String(target.dataset.key || ''), src: values.src });
          return true;
        }
        case 'sku-edit': {
          const row = skus().find(s => String(s.key) === key);
          if (!row) return true;
          const values = await modal({
            title: '编辑规格', description: '规格名、价格、库存、商家编码。',
            fields: `<div class="field"><label>规格名</label><input name="name" value="${esc(row.name || '')}"></div>
              <div class="field"><label>价格</label><input name="price" value="${esc(row.price || '')}"></div>
              <div class="field"><label>库存</label><input name="stock" value="${esc(row.stock || '')}"></div>
              <div class="field"><label>商家编码</label><input name="outerId" value="${esc(row.outerId || '')}"></div>`,
            confirm: '保存',
          });
          if (values) {
            const next = skus().map(s => String(s.key) === key ? { ...s, ...values } : s);
            await patch({ skus: next });
          }
          return true;
        }
        // ---- 1:1 / 3:4 主图选用 ----
        case 'use-tall-check': {
          // checkbox 的 click 与 change 都会到达，按 draft 当前值做幂等翻转。
          const want = target.checked ? 'keep' : 'ai';
          if ((draft().useTall || 'ai') !== want) await patch({ useTall: want });
          return true;
        }
        // ---- 详情图 ----
        case 'detail-move': await run('editorDetail', { action: 'move', from: Number(target.dataset.index), to: Number(target.dataset.to) }); return true;
        case 'detail-remove': await run('editorDetail', { action: 'remove', index: Number(target.dataset.index) }); return true;
        case 'detail-restore': await run('editorDetail', { action: 'restore' }); return true;
        case 'detail-template': {
          // 用户 2026-11-21：详情页模板也要「先添加模板，再插入时从已添加的模板里选」。
          const templates = list(await api('selectionpool.imageTemplates', { kind: 'detail' }).catch(() => []));
          const countOf = t => `${list(t.images).length} 张图${t.storeName ? ` · ${t.storeName}` : ''}`;
          const options = templates.map((t, i) => `<label class="sped-tpl-item"><input type="radio" name="templateId" value="${esc(t.id)}" ${i === 0 ? 'checked' : ''}><span class="sped-tpl-main"><b>${esc(t.name || '未命名模板')}</b><em>${esc(countOf(t))}</em></span></label>`).join('');
          const fields = `${templates.length
            ? `<div class="sped-tpl-list">${options}<label class="sped-tpl-item"><input type="radio" name="templateId" value="__new__"><span class="sped-tpl-main"><b>＋ 把当前详情页存为新模板</b><em>保存当前 ${list(draft().detailImages).length} 张图</em></span></label></div>`
            : '<p class="sped-note">还没有详情页模板。把当前详情图存成第一个模板，下一次就能直接选。</p>'}
            <div class="field"><label>新模板名称</label><input name="newName" placeholder="例如：食品详情通用页"></div>`;
          const values = await modal({ title: '选择详情页模板', description: '选一个模板插到详情页最前面；已在详情页里的图不会重复插。', fields, confirm: '确定' });
          if (!values) return true;
          const wantsNew = values.templateId === '__new__' || (!values.templateId && String(values.newName || '').trim());
          if (wantsNew) {
            const name = String(values.newName || '').trim();
            if (!name) { toast('请填写新模板名称', true); return true; }
            const images = list(draft().detailImages).map(u => String(u || '')).filter(Boolean);
            if (!images.length) { toast('当前详情页还没有图可存为模板', true); return true; }
            const shop = list(d().shopStates?.loggedIn)[0] || list(d().shopStates?.stores)[0] || null;
            const saved = await api('selectionpool.changeImageTemplate', {
              action: 'create', kind: 'detail', name, storeId: shop?.storeId || '', storeName: shop?.name || '', images, skus: [],
            }).catch(error => ({ ok: false, message: String(error?.message || error) }));
            if (saved?.ok === false) { toast(saved.message || '模板保存失败', true); return true; }
            toast(`已保存详情页模板「${name}」`);
            return true;
          }
          if (!values.templateId) { toast('请选择一个模板，或填写新模板名称', true); return true; }
          const tpl = templates.find(t => String(t.id) === String(values.templateId));
          const images = list(tpl?.images).map(u => String(u || '')).filter(Boolean);
          if (!images.length) { toast('这个模板里没有图片', true); return true; }
          await run('editorDetail', { action: 'template', images });
          return true;
        }
        // ---- 参数 ----
        case 'param-add': {
          const values = await modal({ title: '增加参数', description: '参数名与值会照抄到上架表单，不再由 AI 处理。', fields: '<div class="field"><label>参数名</label><input name="name" required placeholder="例如：生产许可证编号"></div><div class="field"><label>参数值</label><input name="value"></div>', confirm: '增加' });
          if (values) await run('editorParam', { action: 'add', name: values.name, value: values.value });
          return true;
        }
        case 'param-remove': await run('editorParam', { action: 'remove', index: Number(target.dataset.index) }); return true;
        // ---- 类目 ----
        case 'category-edit': {
          // 老软件：点「修改类目」打开三级类目选择面板（类目来源店铺 / 搜索 / 级联 / 保存类目）。
          const dialogs = window.XXSelectionPoolDialogs?.instance;
          if (dialogs) { dialogs.open('category', { itemId: ui.itemId }); return true; }
          const values = await modal({ title: '修改类目', description: '上架时按这个类目填；不确定可留空，上架端会按商品 ID 读真实类目。', fields: `<div class="field"><label>类目 ID</label><input name="categoryId" value="${esc(draft().categoryId || '')}"></div><div class="field"><label>类目路径</label><input name="categoryPath" value="${esc(draft().categoryPath || '')}"></div>`, confirm: '保存类目' });
          if (values) await run('editorCategory', { action: 'set', categoryId: values.categoryId, categoryPath: values.categoryPath });
          return true;
        }
        case 'category-read': {
          // 「采集」：按商品 ID 去原链接重读真实类目（页面内嵌 SSR → 详情接口），写回选品与草稿。
          const product = detail().product || {};
          const result = await api('selectionpool.categoryReadSource', {
            itemId: ui.itemId, productId: product.id, platform: product.platform, refresh: true,
          }).catch(error => ({ ok: false, message: String(error?.message || error) }));
          if (result?.ok) {
            toast(`已采集类目 ${result.data?.leafId || ''}`);
            await load(ui.itemId);
          } else toast(result?.message || '没读到类目', true);
          return true;
        }
        case 'category-restore': await run('editorCategory', { action: 'restore' }); return true;
        // ---- 素材图 ----
        case 'material-source': {
          const which = target.dataset.which, source = target.dataset.source;
          if (source === 'code') {
            const values = await modal({ title: '填素材图编码', description: '从图库调取已有的图（如作图系统做好的透明图）。本机暂不接作图服务，只记录编码。', fields: '<div class="field"><label>素材图编码</label><input name="value" required></div>', confirm: '保存' });
            if (!values) return true;
            await run('editorMaterialSource', { which, source, value: values.value });
          } else if (source === 'local') {
            // 本机上传需要文件选择对话框；当前渲染层无此能力，明确提示而不谎报
            toast('本机上传需要图片文件选择能力，请在「接口配置」接入后使用；当前可用「填编码」', true);
            await run('editorMaterialSource', { which, source });
          } else await run('editorMaterialSource', { which, source });
          return true;
        }
        case 'material-reload': {
          const fresh = await api('selectionpool.editorBackfillTargets', { itemId: ui.itemId });
          if (ui.data) ui.data.backfill = fresh;
          toast('已重新读取本机草稿与入仓记录'); render(); return true;
        }
        // ---- 视频 ----
        case 'video-library': {
          const result = await run('editorVideo', { action: 'addLibrary' });
          if (result && result.ok === false) toast(result.message || '需要服务市场接口', true);
          return true;
        }
        case 'video-local': {
          const values = await modal({ title: '本机上传视频', description: '填入本机视频绝对路径（mp4 / mov / mkv）；入仓后回填时挂到仓库商品上。', fields: '<div class="field"><label>视频路径</label><input name="file" required placeholder="D://video//demo.mp4"></div><div class="field"><label>视频类型</label><select name="type"><option>宝贝展示</option><option>宝贝讲解</option><option>真人试吃</option><option>制作教程</option></select></div><div class="field"><label>比例</label><select name="ratio"><option value="">未指定</option><option>1:1</option><option>3:4</option><option>9:16</option></select></div>', confirm: '加入' });
          if (values) {
            const result = await run('editorVideo', { action: 'addLocal', file: values.file, type: values.type, ratio: values.ratio });
            if (result && result.ok === false) toast(result.message || '视频格式不支持', true);
          }
          return true;
        }
        case 'video-remove': await run('editorVideo', { action: 'remove', index: Number(target.dataset.index) }); return true;
        // ---- 规格表 ----
        case 'sku-add': await run('editorSkuAdd', {}); return true;
        case 'sku-remove-templates': await run('editorSkuRemoveTemplates', {}); return true;
        // ---- AI作图 成品回流 ----
        case 'drawing-auto': {
          if (!d().drawing?.configured) { toast('请先在「上品库 → 接口配置」填 AI作图 地址与 Key', true); return true; }
          const found = await api('selectionpool.editorFindDrawing', { itemId: ui.itemId });
          const tasks = list(found?.tasks);
          if (!tasks.length) { toast('AI作图 里没有这个商品的作图任务，可先在插件里提交作图', true); return true; }
          const first = tasks.find(t => /^\d+$/.test(String(t.orderNo || ''))) || tasks[0];
          const code = String(first.orderNo || first.taskId || '');
          const fetched = await run('editorLoadDrawing', { which: 'main', code });
          if (fetched?.ok) {
            if (ui.data) {
              ui.data.draft = fetched.draft;
              ui.data.squareThumbs = fetched.squareThumbs;
              ui.data.tallThumbs = fetched.tallThumbs;
            }
            ui.codes.main = code;
            ui.message = `已自动匹配 #${code}：` + fetched.message;
          }
          render(); return true;
        }
        // ---- 回填目标 ----
        case 'target-toggle': {
          const id = target.dataset.id;
          const current = list(d().backfill?.selected);
          const next = current.includes(id) ? current.filter(v => v !== id) : [...current, id];
          const result = await api('selectionpool.editorSelectTargets', { itemId: ui.itemId, selected: next });
          if (ui.data?.backfill) ui.data.backfill.selected = result?.selected || next;
          if (ui.data?.draft) ui.data.draft.selectedTargets = result?.selected || next;
          render(); return true;
        }
        case 'backfill': {
          await run('editorSave', {});
          const result = await api('selectionpool.backfill', { itemId: ui.itemId })
            .catch(error => ({ ok: false, message: String(error?.message || error) }));
          if (result?.ok) {
            toast(result.allMatched ? '回填完成，已回读一致' : '回填已提交，回读未完全一致，请到商家后台核对');
            await load(ui.itemId);
          } else {
            toast(result?.message || '回填未完成（可在「上架日志」看逐行原因）', true);
          }
          return true;
        }
        default: return false;
      }
    }

    /** change 委托：行内输入（规格名/价格/库存/参数/编码/改价/粘贴）。 */
    async function handleChange(event) {
      const t = event.target;
      if (!t?.dataset) return false;
      if (t.dataset.action === 'selectionpool:editor-use-tall-check') {
        const want = t.checked ? 'keep' : 'ai';
        if ((draft().useTall || 'ai') !== want) await patch({ useTall: want });
        return true;
      }
      if (t.dataset.spedCode !== undefined) {
        const which = t.dataset.spedCode;
        const value = String(t.value || "").trim();
        ui.codes[which] = value;
        // 先记编码（本机草稿），再尝试从 AI作图 读取成品——与老软件「粘贴编码回车即读取」一致。
        const recorded = await run('editorCodes', { which, value });
        if (value && d().drawing?.configured) {
          const fetched = await run('editorLoadDrawing', { which, code: value });
          if (fetched?.ok) {
            ui.message = fetched.message;
            if (ui.data) ui.data.draft = fetched.draft;
          } else if (fetched?.code) {
            toast(fetched.message || '按编码读取作图成品失败', true);
          }
        } else if (recorded?.drawingHint && !d().drawing?.configured) {
          ui.message = '已记录编码；要到「接口配置」填 AI作图 地址与 Key 才能读取成品';
        }
        render(); return true;
      }
      if (t.dataset.spedDetailCode !== undefined) {
        const value = String(t.value || "").trim();
        if (value && d().drawing?.configured) {
          const fetched = await run('editorLoadDrawing', { which: 'detail', code: value });
          if (fetched?.ok && ui.data) ui.data.draft = fetched.draft;
        } else {
          await run('editorDetail', { action: 'code', value });
        }
        return true;
      }
      if (t.dataset.spedSkuField !== undefined) {
        const field = t.dataset.spedSkuField;
        const key = t.dataset.key;
        const next = skus().map(s => String(s.key) === key ? { ...s, [field]: t.value } : s);
        await patch({ skus: next }, { after: '本机草稿已修改，点「保存」正式保存' });
        return true;
      }
      if (t.dataset.spedAttr !== undefined) {
        const index = Number(t.dataset.spedAttr);
        const attrs = [...(draft().attrs || [])];
        if (attrs[index] && !attrs[index].locked) attrs[index] = { ...attrs[index], value: t.value };
        await patch({ attrs }); return true;
      }
      if (t.dataset.spedField !== undefined) {
        await patch({ [t.dataset.spedField]: t.value }); return true;
      }
      if (t.dataset.spedSkuSelect !== undefined) {
        const key = t.dataset.spedSkuSelect;
        t.checked ? ui.selected.add(key) : ui.selected.delete(key);
        render(); return true;
      }
      if (t.dataset.spedReprice !== undefined || t.dataset.spedPaste !== undefined) return true; // 由「应用」按钮读取
      return false;
    }

    function handleInput(event) {
      if (event.target?.dataset?.spedPaste !== undefined) { ui.pasteText = event.target.value; return true; }
      return false;
    }

    // 拖动排序与滚轮/Esc 护栏只装一次（监听挂在 document 上，按 ui.open 自判）。
    try { installDrag(); installGuards(); } catch { /* 旧环境不支持时不影响编辑功能 */ }

    return {
      render: renderEditor, load, close, handleAction, handleChange, handleInput,
      isOpen: () => ui.open,
    };
  }

  window.XXSelectionPoolEditor = Object.freeze({ create });
})();
