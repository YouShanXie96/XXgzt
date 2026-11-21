'use strict';

// Page modules register independently; this file owns their shared local UI state
// and IPC workflow. No collector or business calculations run in the renderer.
(() => {
  const pages = new Map();
  const navItems = [
    ['business', '经营看板', 'home'], ['trends', '趋势关键词', 'promotion'],
    ['peers', '同行榜单', 'store'], ['recommendations', '月份推荐', 'clock'],
  ];
  const array = value => Array.isArray(value) ? value : [];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const display = value => value === null || value === undefined || value === '' ? '—' : String(value);
  const monthList = value => array(Array.isArray(value) ? value : String(value ?? '').split(/[,，、;；\s]+/)).map(Number).filter(month => Number.isInteger(month) && month >= 1 && month <= 12);
  const range = item => [item?.startDate || item?.dataStart, item?.endDate || item?.dataEnd].filter(Boolean).join(' 至 ') || '日期范围未提供';
  const textOf = value => value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

  function create(host) {
    const local = new Map();
    const h = { ...host, esc: host.esc || escape, arr: array, display, range, monthList };
    const ui = page => {
      const key = `${host.state.storeId || ''}:${page}`;
      if (!local.has(key)) local.set(key, { query:'', category:'', month:String(new Date().getMonth() + 1), page:1, selected:new Set(), detail:null, metric:'impressionIndex' });
      return local.get(key);
    };
    const button = (page, label, action, options = {}) => host.button(label, `insights:${action}`, { ...options, attrs:`data-insights-page="${escape(page)}" ${options.attrs || ''}` });
    const field = (page, name, label, options = {}) => {
      const id = `insights-${page}-${name}`;
      const value = ui(page)[name] ?? options.value ?? '';
      const common = `id="${id}" data-insights-page="${page}" data-insights-field="${name}"`;
      const control = options.options ? `<select ${common}>${options.options.map(([key, title]) => `<option value="${escape(key)}"${String(value) === String(key) ? ' selected' : ''}>${escape(title)}</option>`).join('')}</select>` : `<input ${common} type="${escape(options.type || 'text')}" value="${escape(value)}" ${options.placeholder ? `placeholder="${escape(options.placeholder)}"` : ''} ${options.maxlength ? `maxlength="${options.maxlength}"` : ''}>`;
      return `<div class="field insights-field"><label for="${id}">${escape(label)}</label>${control}</div>`;
    };
    const datasets = page => array(host.moduleData(page)?.datasets);
    const filtered = page => {
      const state = ui(page), query = state.query.trim().toLocaleLowerCase(), category = state.category.trim().toLocaleLowerCase();
      return datasets(page).filter(row => (!query || [row.context?.keyword, row.context?.rankingType, row.context?.subject].join(' ').toLocaleLowerCase().includes(query)) && (!category || String(row.context?.category || '').toLocaleLowerCase().includes(category)));
    };
    const paginate = (items, page, key = 'page') => {
      const state = ui(page), total = Math.max(1, Math.ceil(items.length / 30)), current = Math.min(total, Math.max(1, Number(state[key]) || 1));
      state[key] = current;
      return {
        rows:items.slice((current - 1) * 30, current * 30),
        footer:`<div class="table-footer"><span>共 ${escape(items.length)} 条 · 每页 30 条</span><div class="actions">${button(page, '上一页', 'paginate', {small:true,disabled:current === 1,attrs:`data-step="-1" data-key="${key}"`})}<span>${current} / ${total}</span>${button(page, '下一页', 'paginate', {small:true,disabled:current === total,attrs:`data-step="1" data-key="${key}"`})}</div></div>`,
      };
    };
    const renderWarnings = values => array(values).length ? `<ul class="insights-warnings">${array(values).map(value => `<li>${escape(typeof value === 'object' ? value.message || value.error || textOf(value) : value)}</li>`).join('')}</ul>` : '';
    const simpleTable = (rows, preferred = [], limit = 30) => {
      if (!rows.length) return host.empty('没有可展示的数据', '保存或导入数据后，这里显示实际记录。');
      const keys = [...new Set(rows.flatMap(row => Object.keys(row || {})))].filter(key => !['raw', 'payload', 'series', 'rows'].includes(key));
      const columns = preferred.length ? preferred.filter(([key]) => keys.includes(key)) : keys.slice(0, 14).map(key => [key, key]);
      if (!columns.length) return host.empty('当前数据没有明细列', '请检查来源页面或导入文件。');
      return host.table(columns.map(([,label]) => escape(label)), rows.slice(0,limit).map(row => `<tr>${columns.map(([key]) => `<td class="insights-data-cell">${escape(display(typeof row[key] === 'object' && row[key] !== null ? textOf(row[key]) : row[key]))}</td>`).join('')}</tr>`).join(''), '');
    };
    const logs = data => array(data?.logs).length ? host.panel('最近记录', '按后台和本地服务实际返回展示', `<div class="panel-body">${array(data.logs).slice(-8).reverse().map(log => `<div class="log-entry"><time>${escape(host.dateTime(log.at || log.createdAt))}</time><p>${escape(log.message || log.action || '本地数据更新')}</p></div>`).join('')}</div>`) : '';
    const captureBar = (page, kind, description, extra = '') => {
      const busy = host.state.busy.has(`${page}.capture`);
      return host.panel('采集当前后台视图', description, `<div class="insights-capture">${extra}<div class="actions">${button(page,'打开后台','open',{attrs:`data-kind="${kind}"`})}${button(page,busy ? '正在读取…' : '保存当前页数据','capture',{primary:true,disabled:busy})}${busy ? button(page,'停止读取','cancel') : ''}</div></div>`);
    };
    const selectedDetail = page => ui(page).detailClosed ? null : ui(page).detail || host.moduleData(page)?.selectedDataset;
    const ctx = { ...h, ui, button, field, datasets, filtered, paginate, simpleTable, renderWarnings, logs, captureBar, selectedDetail };

    function readFields(page) {
      if (typeof document === 'undefined') return;
      document.querySelectorAll(`[data-insights-field][data-insights-page="${page}"]`).forEach(element => { ui(page)[element.dataset.insightsField] = element.type === 'checkbox' ? element.checked : element.value; });
    }

    async function run(page, action, payload = {}, options = {}) {
      const storeId = host.state.storeId;
      return host.perform(`${page}.${action}`, () => host.api(`${page}.${action}`, { storeId, ...payload }), { module:page, reload:false, ...options });
    }

    async function previewImport(page, action = 'importPreview', commitAction = 'importCommit') {
      const storeId = host.state.storeId;
      const preview = await run(page, action);
      if (!preview || preview.canceled || host.state.storeId !== storeId) return;
      const errors = array(preview.errors), rows = array(preview.rows || preview.recommendations || preview.items), warnings = array(preview.warnings);
      const dialog = document.createElement('dialog');
      dialog.className = 'insights-dialog';
      dialog.setAttribute('aria-labelledby', 'insights-import-title');
      const invalid = errors.length > 0 || !preview.token;
      const added = preview.added ?? preview.summary?.added ?? 0, updated = preview.updated ?? preview.summary?.updated ?? 0;
      const previewColumns = page === 'recommendations' ? [['keyword','关键词'],['category','类目'],['recommendedMonth','建议上品月'],['risingMonth','预计起涨月'],['peakMonths','旺季月份'],['lowMonths','淡季月份'],['reason','推荐理由'],['dataStart','数据开始'],['dataEnd','数据结束'],['analyzedAt','分析日期']] : [['keyword','关键词'],['category','类目'],['startDate','数据开始'],['endDate','数据结束'],['rowCount','日记录数']];
      dialog.innerHTML = `<div class="insights-dialog-head"><h2 id="insights-import-title">${page === 'recommendations' ? '月份推荐导入预览' : '原始数据导入预览'}</h2><p>检查内容后写入本机。不会向店铺后台提交操作。</p></div><div class="insights-dialog-content"><div class="insights-summary"><span>新增 <b>${escape(added)}</b></span><span>更新 <b>${escape(updated)}</b></span><span>校验错误 <b>${errors.length}</b></span></div>${renderWarnings(errors)}${renderWarnings(warnings)}${simpleTable(rows, previewColumns, 20)}${rows.length > 20 ? '<p class="inline-note">预览前 20 行；确认后按完整校验结果导入。</p>' : ''}<p class="insights-dialog-error" role="alert"></p></div><div class="insights-dialog-actions"><button type="button" class="button" data-dialog-cancel>取消</button><button type="button" class="button primary" data-dialog-confirm ${invalid ? 'disabled' : ''}>${invalid ? '请先修正文件' : '确认导入本机'}</button></div>`;
      document.body.append(dialog);
      dialog.addEventListener('close', () => dialog.remove(), {once:true});
      dialog.querySelector('[data-dialog-cancel]').addEventListener('click', () => dialog.close());
      dialog.querySelector('[data-dialog-confirm]').addEventListener('click', async event => {
        const control = event.currentTarget;
        if (control.disabled) return;
        control.disabled = true;
        try {
          const result = await host.api(`${page}.${commitAction}`, {storeId, token:preview.token});
          if (result?.canceled) { control.disabled = false; return; }
          dialog.close();
          host.toast('已导入本机数据。');
          if (host.state.storeId === storeId) await host.loadPage(page, false);
        } catch (error) {
          dialog.querySelector('[role="alert"]').textContent = error?.message || String(error);
          control.disabled = false;
        }
      });
      dialog.showModal();
    }

    async function handleAction(action, element) {
      if (!action.startsWith('insights:')) return false;
      const page = element?.dataset?.insightsPage || host.state.page;
      if (!pages.has(page)) return false;
      const operation = action.slice('insights:'.length), state = ui(page);
      readFields(page);
      if (operation === 'filter') { state.page = 1; host.render(); }
      else if (operation === 'reset-filter') { state.query = ''; state.category = ''; state.page = 1; host.render(); }
      else if (operation === 'paginate') { const key = element.dataset.key || 'page'; state[key] = Math.max(1, (Number(state[key]) || 1) + Number(element.dataset.step || 0)); host.render(); }
      else if (operation === 'month') { state.month = element.dataset.month; state.page = 1; host.render(); }
      else if (operation === 'select-filtered') { filtered(page).forEach(row => state.selected.add(String(row.id))); host.render(); }
      else if (operation === 'clear-selection') { state.selected.clear(); host.render(); }
      else if (operation === 'toggle-raw') { state.rawOpen = !state.rawOpen; host.render(); }
      else if (operation === 'close-detail') { state.detail = null; state.detailClosed = true; host.render(); }
      else if (operation === 'open') await host.perform(`insights.open.${page}`, () => host.api('browser.open', {storeId:host.state.storeId,kind:element.dataset.kind}), {reload:false,module:page});
      else if (operation === 'cancel') {
        const result = await run(page,'cancel');
        if (result?.message) host.toast(result.message);
      }
      else if (operation === 'capture') {
        const storeId = host.state.storeId;
        const result = await run(page, 'capture', {keyword:state.keyword || '',category:state.captureCategory || '',startDate:state.startDate || '',endDate:state.endDate || '',period:state.period || ''});
        if (result && !result.canceled && host.state.storeId === storeId) {
          state.detail = result.selectedDataset || null;
          state.detailClosed = false;
          host.toast(result.message || '当前页数据已保存到本机。');
          await host.loadPage(page,false);
        }
      }
      else if (operation === 'detail') {
        const storeId = host.state.storeId, id = element.dataset.id;
        const result = await run(page,'detail',{id,datasetId:id});
        if (result && host.state.storeId === storeId) { state.detail = result.dataset || result; state.detailClosed = false; state.detailPage = 1; host.render(); }
      }
      else if (operation === 'export') {
        const available = new Set(datasets(page).map(row => String(row.id)));
        const ids = [...state.selected].filter(id => available.has(id));
        if (page === 'trends' && !ids.length) { host.toast('请先选择要导出的关键词批次。',true); return true; }
        const result = await run(page,'export',ids.length ? {datasetIds:ids} : {});
        if (result?.path && !result.canceled) host.toast(`已导出：${result.path}`);
      }
      else if (operation === 'template' || operation === 'raw-template') {
        const available = new Set(datasets(page).map(row => String(row.id)));
        const selectedIds = [...state.selected].filter(id => available.has(id));
        const result = await run(page,operation === 'raw-template' ? 'rawTemplate' : 'template',selectedIds.length ? {datasetIds:selectedIds} : {});
        if (result?.path && !result.canceled) host.toast(`模板已导出：${result.path}`);
      }
      else if (operation === 'import') await previewImport(page);
      else if (operation === 'import-data') await previewImport(page,'importDataPreview','importDataCommit');
      else if (operation === 'refresh') await host.loadPage(page,false);
      // 趋势选品（参考同类工作台）：5 个板块、上线节奏、看板筛选、过滤规则与趋势详情。
      else if (operation === 'tb-tab') { state.tbTab = element.dataset.value || 'monthly'; host.render(); }
      else if (operation === 'tb-maint') { state.tbMaint = !state.tbMaint; host.render(); }
      else if (operation === 'tb-lead' || operation === 'tb-lead-apply') {
        let lead = operation === 'tb-lead' ? Number(element.dataset.value) : Number(document.querySelector('[data-tb-lead-input]')?.value);
        if (!Number.isFinite(lead)) lead = Number(state.leadDays) || 60;
        lead = Math.min(180, Math.max(15, Math.round(lead)));
        state.leadDays = lead;
        const result = await run(page,'board',{leadDays:lead});
        if (result?.board) state.tbBoard = result.board;
        host.render();
      }
      else if (operation === 'tb-month') { state.tbMonth = String(element.dataset.value || ''); state.tbPageMonthly = 1; host.render(); }
      else if (operation === 'tb-month-view') { state.tbMonthView = element.dataset.value === 'big' ? 'big' : 'sub'; state.tbPageMonthly = 1; host.render(); }
      else if (operation === 'tb-month-grade') { state.tbMonthGrade = element.dataset.value || 'all'; state.tbPageMonthly = 1; host.render(); }
      else if (operation === 'tb-lines-view') { state.tbLineView = ['big','sub','kw','excl'].includes(element.dataset.value) ? element.dataset.value : 'big'; state.tbPageLines = 1; host.render(); }
      else if (operation === 'tb-line-status') { state.tbLineStatus = element.dataset.value || 'all'; state.tbPageLines = 1; host.render(); }
      else if (operation === 'tb-kw-status') { state.tbKwStatus = ['ok','removed','all'].includes(element.dataset.value) ? element.dataset.value : 'ok'; state.tbPageKw = 1; host.render(); }
      else if (operation === 'tb-kw-cells') { state.tbKwCells = element.dataset.value === 'num' ? 'num' : 'heat'; host.render(); }
      else if (operation === 'tb-cal-grade') { state.tbCalGrade = element.dataset.value || 'all'; state.tbPageCal = 1; host.render(); }
      else if (operation === 'tb-cal-horizon') { state.tbCalHorizon = Number(element.dataset.value) || 60; host.render(); }
      else if (operation === 'tb-filter-kind') { state.tbFilterKind = element.dataset.value === 'keyword' ? 'keyword' : 'brand'; host.render(); }
      else if (operation === 'tb-detail') { state.tbDetail = {kind:element.dataset.kind || 'keyword', id:element.dataset.id || ''}; host.render(); }
      else if (operation === 'tb-detail-close') { state.tbDetail = null; host.render(); }
      else if (operation === 'tb-rule-add') {
        const kind = element.dataset.kind === 'keyword' ? 'keyword' : 'brand';
        const text = String(document.getElementById('tb-rule-text')?.value || '').trim();
        if (!text) { host.toast('请先输入规则内容',true); return true; }
        const rule = {id:`rule-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,text,match:document.getElementById('tb-rule-match')?.value === 'exact' ? 'exact' : 'contains',enabled:true,note:String(document.getElementById('tb-rule-note')?.value || '').trim().slice(0,200)};
        const current = state.tbBoard?.filters || host.moduleData(page)?.trendFilters || {brandRules:[],keywordRules:[]};
        const brandRules = kind === 'brand' ? [...array(current.brandRules),rule] : array(current.brandRules);
        const keywordRules = kind === 'keyword' ? [...array(current.keywordRules),rule] : array(current.keywordRules);
        const result = await run(page,'saveFilters',{brandRules,keywordRules,leadDays:state.leadDays});
        if (result?.board) state.tbBoard = result.board;
        host.toast(result?.message || '规则已保存');
        host.render();
      }
      else if (operation === 'tb-rule-toggle' || operation === 'tb-rule-delete') {
        const kind = element.dataset.kind === 'keyword' ? 'keyword' : 'brand';
        const id = String(element.dataset.id || '');
        const current = state.tbBoard?.filters || host.moduleData(page)?.trendFilters || {brandRules:[],keywordRules:[]};
        const map = list => array(list).map(rule => {
          if (rule.id !== id) return rule;
          return operation === 'tb-rule-delete' ? null : {...rule,enabled:rule.enabled === false};
        }).filter(Boolean);
        const result = await run(page,'saveFilters',{brandRules:kind === 'brand' ? map(current.brandRules) : current.brandRules,keywordRules:kind === 'keyword' ? map(current.keywordRules) : current.keywordRules,leadDays:state.leadDays});
        if (result?.board) state.tbBoard = result.board;
        host.toast(operation === 'tb-rule-delete' ? '规则已删除' : '规则状态已更新');
        host.render();
      }
      else return false;
      return true;
    }

    function handleChange(event) {
      const element = event.target, page = element?.dataset?.insightsPage;
      if (!page || !pages.has(page)) return false;
      const state = ui(page);
      if (element.dataset.insightsSelect !== undefined) {
        if (element.checked) state.selected.add(element.dataset.insightsSelect); else state.selected.delete(element.dataset.insightsSelect);
        host.render(); return true;
      }
      if (!element.dataset.insightsField) return false;
      state[element.dataset.insightsField] = element.type === 'checkbox' ? element.checked : element.value;
      if (element.dataset.insightsField === 'metric' && event.type !== 'input') host.render();
      else if (String(element.dataset.insightsField).startsWith('tb') && event.type === 'change') { state.tbPageLines = 1; state.tbPageKw = 1; host.render(); }
      return true;
    }

    return {navItems, handlesPage:page => pages.has(page), render:page => `<div class="insights-page insights-${escape(page)}">${pages.get(page)?.(ctx) || ''}</div>`, handleAction, handleChange};
  }
  window.XXInsights = Object.freeze({ navItems, create, register:(name, renderer) => {if (pages.has(name)) throw new Error(`重复的数据页面：${name}`); pages.set(name,renderer);} });
})();
