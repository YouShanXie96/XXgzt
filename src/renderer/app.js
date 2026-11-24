'use strict';

(() => {
  const icons = {
    home:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    review:'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/><path d="m9 11 2 2 4-4"/>',
    promotion:'<path d="M3 15h4l3-8 4 12 3-8h4"/>',
    purchase:'<path d="M3 7h18l-2 14H5L3 7Z"/><path d="M8 7V5a4 4 0 0 1 8 0v2M8 12h8"/>',
    gift:'<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18"/><path d="M12 8c-1.6-3.2-6.2-3-6.2-.6S9.6 8 12 8Zm0 0c1.6-3.2 6.2-3 6.2-.6S14.4 8 12 8Z"/>',
    complaint:'<path d="M3 10v4h3l7 4V6L6 10H3Z"/><path d="M16 8a5 5 0 0 1 0 8"/><path d="M19 5a9 9 0 0 1 0 14"/>',
    qualification:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h4m1 5 2 2 4-4"/>',
    compliance:'<path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Z"/><path d="m8 12 3 3 5-6"/>',
    ai:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M16 5.3a3 3 0 0 1 0 5.4M17 14a4 4 0 0 1 4 4v2"/>',
    store:'<path d="M3 8h18l-2-5H5L3 8Zm0 0v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V8M5 14v7h14v-7M9 21v-5h6v5"/>',
    refresh:'<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    update:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    export:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>',
    arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    folder:'<path d="M3 7V4h6l3 3h9v13H3V7Z"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    plugin:'<path d="M9 4a2 2 0 0 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 0 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 0 0-4 0v1H6a1 1 0 0 1-1-1v-3H4a2 2 0 0 1 0-4h1V6a1 1 0 0 1 1-1h3V4Z"/>',
  };
  const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.info}</svg>`;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const arr = value => Array.isArray(value) ? value : [];
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
  const money = value => Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
  const fileSize = value => { const bytes=Number(value)||0; if(bytes<1024) return `${bytes} B`; if(bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`; if(bytes<1024*1024*1024) return `${(bytes/1024/1024).toFixed(1)} MB`; return `${(bytes/1024/1024/1024).toFixed(2)} GB`; };
  const nowDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const dateTime = value => {if (!value) return '尚未同步'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('zh-CN',{hour12:false});};
  const dayOffset = offset => { const d = new Date(); d.setDate(d.getDate()+offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const state = {page:'accounts',selectionPage:'trends',marketingView:'purchase',storeId:'',stores:[],info:{},cache:{},loading:false,loadSequence:0,busy:new Set(),progress:{},selection:new Set(),filters:{reviews:'all',qualification:'all',compliance:'all'},search:{},tablePage:{},dates:{start:dayOffset(-6),end:nowDate()},prepared:{},settings:{},storeData:null,theme:'light'};
  // “营销创建”顶栏切换：内购会 / 托管礼金（侧边栏不再分别占两个入口）。
  function marketingTabs(){
    const view=['purchase','hostedgift','complaint'].includes(state.page)?state.page:'purchase';
    const codes={purchase:'workbench.marketing.purchase.view',hostedgift:'workbench.marketing.gift.view',complaint:'workbench.marketing.complaint.preview'};
    return `<div class="segmented marketing-tabs">${[['purchase','内购会'],['hostedgift','托管礼金'],['complaint','投诉打标']].filter(([id])=>!cloudAuthUi||cloudAuthUi.hasPermission(codes[id])).map(([id,label])=>`<button type="button" class="${view===id?'active':''}" data-action="marketing-tab" data-value="${id}" ${view===id?'aria-current="page"':''}>${label}</button>`).join('')}</div>`;
  }
  // 深色/浅色模式：只切换页面样式，不改动任何数据或店铺登录状态。
  function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : theme === 'eye' ? 'eye' : 'light';
    state.theme = next;
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = next;
    return next;
  }
  // 侧边栏：点击顶部 ☰ 在展开（180px）与收起（80px、图标下带名称）之间切换；有过渡动画，不再靠鼠标悬停。
  function applySidebar(pinned) {
    state.sidebarPinned = pinned !== false;
    if (typeof document !== 'undefined') document.documentElement.dataset.sidebar = state.sidebarPinned ? 'pinned' : 'collapsed';
    const button = typeof document !== 'undefined' ? document.querySelector('#sidebar-pin') : null;
    if (button) {
      button.setAttribute('aria-pressed', state.sidebarPinned ? 'true' : 'false');
      button.setAttribute('title', state.sidebarPinned ? '收起侧边栏' : '展开侧边栏');
      button.setAttribute('aria-label', state.sidebarPinned ? '收起侧边栏' : '展开侧边栏');
      const label = button.querySelector('.sidebar-pin-text');
      if (label) label.textContent = state.sidebarPinned ? '收起' : '展开';
    }
    return state.sidebarPinned;
  }
  const store = () => state.stores.find(item => item.id === state.storeId);
  const storePayload = extra => ({storeId:state.storeId,...extra});
  // 上品库是跨店铺的本机商品库，不依赖「当前已选店铺」，故加入白名单。
  const isStorePage = page => !['overview','accounts','browser','cloudaccount','ai','settings','compliance','selectionpool'].includes(page);
// 原生网页区域只在“店铺浏览器”页展示。
const hostsBrowser = page => page === 'browser';
  const cacheKey = (module,storeId=state.storeId) => module==='accounts'?'accounts:all':`${module}:${storeId}`;
  const moduleData = module => state.cache[cacheKey(module)] || {};
  const setData = (module,data,storeId=state.storeId) => { state.cache[cacheKey(module,storeId)] = data?.snapshot || data || {}; };

  async function api(action,payload={}) {
    if (!window.xx || typeof window.xx.call !== 'function') throw new Error('桌面服务未连接。请通过 谢谢工作台 桌面程序打开本页面。');
    const result = await window.xx.call(action,payload);
    if (!result?.ok) {
      const error = new Error(typeof result?.error === 'string' ? result.error : result?.error?.message || result?.error?.code || '操作未完成，请查看店铺页面后重试。');
      if (result?.error && typeof result.error === 'object') {
        error.code = result.error.code;
        error.details = result.error.details;
      }
      throw error;
    }
    return result.data;
  }
  const toastHistory={message:'',error:false,at:0};
  function toast(message,error=false) {
    // 同一条提示 4 秒内只显示一次：同一个登录结果会同时由“本机账号”和“店铺登录”两处上报，
    // 用户实测会叠成两条一模一样的大红框。
    const text=String(message??''),now=Date.now();
    if(text&&text===toastHistory.message&&error===toastHistory.error&&now-toastHistory.at<4000)return;
    toastHistory.message=text;toastHistory.error=error;toastHistory.at=now;
    const el = document.createElement('div'); el.className=`toast${error?' error':''}`; el.textContent=message;
    $('#toast-area').append(el); setTimeout(()=>el.remove(),6500);
  }
  function showError(error) {
    const message=error?.message || String(error);
    $('#error-area').innerHTML=`<div class="error-banner"><div><strong>操作未完成</strong><br>${esc(message)}</div><button data-action="dismiss-error" aria-label="关闭错误提示">×</button></div>`;
  }
  function clearError() { $('#error-area').innerHTML=''; }
  async function perform(key,operation,{success='',reload=true,module=state.page}={}) {
    if (state.busy.has(key)) return;
    const selectedStoreId=state.storeId;
    state.busy.add(key); clearError(); render();
    try {
      const result=await operation();
      if (result?.canceled) return result;
      if (success) toast(success);
      if (reload && state.storeId===selectedStoreId) await loadPage(module,false);
      return result;
    } catch(error) {showError(error);if(reload&&state.storeId===selectedStoreId)await loadPage(module,false);}
    finally {state.busy.delete(key);if (state.storeId===selectedStoreId) {delete state.progress[`${module}:${selectedStoreId}`];renderProgress();} render();}
  }
  function button(label,action,{icon='',primary=false,danger=false,small=false,disabled=false,attrs='',permission=''}={}) {
    if(permission&&!cloudAuthUi?.hasPermission(permission))return '';
    return `<button type="button" class="button${primary?' primary':''}${danger?' danger':''}${small?' small':''}" data-action="${esc(action)}" ${disabled?'disabled':''} ${attrs}>${icon?svg(icon):''}${label}</button>`;
  }
  function badge(label,style='') {return `<span class="badge ${style}">${esc(label)}</span>`;}
  function statusBadge(status) {
    const labels={idle:'未开始',running:'进行中',active:'推广中',syncing:'同步中',completed:'已完成',succeeded:'成功',success:'成功',failed:'失败',partial:'部分完成',cancelled:'已取消',canceled:'已取消','login-expired':'登录已失效',prepared:'待确认创建',created:'已创建',draft:'草稿',ended:'已结束',closed:'已关闭',pending:'待确认',confirmed:'已匹配',unmatched:'未匹配',paused:'已暂停',live:'自动执行',observe:'观察模式',ready:'就绪',blocked:'待处理','needs-check':'需要人工核对',uploaded:'已上传',missing:'未上传','not-uploaded':'未上传','not-required-category':'无需上传'};
    const text=labels[status] || status || '未开始';
    const good=/成功|完成|已创建|已匹配|就绪|已上传|已评价/.test(text)&&!/未|部分/.test(text);
    const bad=/失败|失效|异常/.test(text); const warn=/待|部分|暂停|处理/.test(text);
    return badge(text,good?'good':bad?'bad':warn?'warn':'');
  }
  function heading(title,description,actions='',eyebrow='') {
    // 页面名称已经显示在全局面包屑中。内容区不再重复大标题和说明；
    // 只把该页操作保留为紧凑工具栏，没有操作时完全不占高度。
    return actions?`<div class="page-action-row"><div class="heading-actions">${actions}</div></div>`:'';
  }
  // 有模块页签的页面，把操作并入现有页签栏，避免单独悬在右上角或占一整行。
  // 后续新增页签页时也会自动套用这条规则。
  function dockPageActions(content) {
    if(!content)return;
    const row=content.querySelector('.page-action-row');
    if(!row)return;
    const actions=row.querySelector('.heading-actions');
    if(!actions||!actions.children.length){row.remove();return;}
    const host=content.querySelector('.selection-navigation')
      ||content.querySelector('.business-tabs,.marketing-tabs,.compliance-tabs,.ct-tabs,.gift-tabs,.selection-tabs,.tb-subnav');
    if(host){
      row.classList.add('page-actions-docked');
      host.appendChild(row);
      return;
    }
    row.classList.add('page-actions-standalone');
  }
  function requiredUiPermission(element) {
    const action=String(element?.dataset?.action||''),kind=element?.dataset?.kind||'',mode=element?.dataset?.mode||'',module=element?.dataset?.module||'';
    if(action==='add-store')return 'workbench.accounts.add';
    if(action==='rename-store')return 'workbench.accounts.edit';
    if(action==='remove-store')return 'workbench.accounts.remove';
    if(action==='review-sync'||action==='review-cancel')return 'workbench.reviews.sync';
    if(action==='review-images'||action==='review-detail')return 'workbench.reviews.view';
    if(action==='export'&&module==='reviews')return 'workbench.reviews.export';
    if(action==='export'&&module==='promotion')return 'workbench.promotion.export';
    if(action==='open-backend')return kind==='promotion'?'workbench.promotion.view':'workbench.reviews.open';
    if(action==='promotion-sync')return 'workbench.promotion.sync';
    if(['promotion-mode','promotion-run','promotion-pause'].includes(action))return 'workbench.promotion.execute';
    if(action==='edit-rule'||action==='delete-rule')return 'workbench.promotion.rules';
    if(action==='purchase-new'||action==='purchase-save'||action==='purchase-prepare'||action==='purchase-create'||action==='purchase-claim'||action==='purchase-resolve-check'||action==='purchase-delete')return 'workbench.marketing.purchase.create';
    if(action==='purchase-template'||action==='purchase-import')return 'workbench.marketing.purchase.import';
    if(action==='purchase-export')return 'workbench.marketing.purchase.export';
    if(action==='gift-exit'||action==='gift-submit')return 'workbench.marketing.gift.enroll';
    if(action==='gift-export')return 'workbench.marketing.gift.export';
    if(action==='ct-preview'||action==='ct-view'||action==='ct-scene')return 'workbench.marketing.complaint.preview';
    if(['ct-start','ct-control','ct-open-window'].includes(action))return 'workbench.marketing.complaint.execute';
    if(action==='ct-export')return 'workbench.marketing.complaint.export';
    if(action==='compliance-import'||action==='compliance-import-path'||action==='compliance-job-scan')return action==='compliance-job-scan'?'workbench.compliance.scan':'workbench.compliance.import';
    if(action==='compliance-export')return 'workbench.compliance.export';
    if(['compliance-issue-status','compliance-issue-batch'].includes(action))return 'workbench.compliance.issues';
    if(action==='compliance-billing'||action==='compliance-topup')return 'workbench.compliance.billing';
    if(action==='set-theme')return 'workbench.settings.theme';
    if(action==='open-data'||action==='choose-path'||action==='reset-path')return 'workbench.settings.paths';
    if(action==='backup-export'||action==='backup-import')return 'workbench.settings.backup';
    if(action==='clear-store-cache')return 'workbench.settings.cache';
    if(action==='open-store-data'||action==='clear-store-data'||action==='clear-store-folder')return 'workbench.settings.storeData';
    if(action==='business:sync-panel'||action==='business:batch-open'||action==='business:batch-start')return 'workbench.business.sync.manage';
    if(action==='business:export')return mode==='product'?'workbench.business.product.export':'workbench.business.daily.export';
    if(action==='business:manual-open')return 'workbench.business.daily.manual';
    if(['business:todo-open','business:todo-batch','business:blacklist-batch','business:mark-save'].includes(action))return 'workbench.business.product.marks';
    if(action==='business:trend')return 'workbench.business.product.trend';
    if(action==='business:fees-save')return 'workbench.business.fees';
    return '';
  }
  function applyActionPermissions(content) {
    if(!content?.querySelectorAll)return;
    for(const element of content.querySelectorAll('[data-action]')){
      const permission=requiredUiPermission(element);
      if(permission&&!cloudAuthUi?.hasPermission(permission))element.remove?.();
    }
  }
  function panel(title,description,body,actions='') {return `<section class="panel"><div class="panel-head"><div><h2>${title}</h2>${description?`<p>${description}</p>`:''}</div>${actions?`<div class="actions">${actions}</div>`:''}</div>${body}</section>`;}
  function notice(text,type='') {return `<div class="callout ${type}">${svg('info')}<div>${text}</div></div>`;}
  function empty(title,description,actions='',icon='folder') {return `<div class="empty"><div class="empty-icon">${svg(icon)}</div><h3>${title}</h3><p>${description}</p>${actions?`<div class="actions">${actions}</div>`:''}</div>`;}
  function stat(label,value,note,icon='home') {return `<div class="stat"><div class="stat-label">${label}${svg(icon)}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`;}
  function table(headers,body,emptyContent) {return body?`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`:emptyContent;}
  function paginate(rows,module,size=30) {
    const total=Math.max(1,Math.ceil(rows.length/size));
    const page=Math.min(total,Math.max(1,state.tablePage[module]||1)); state.tablePage[module]=page;
    return {rows:rows.slice((page-1)*size,page*size),footer:`<div class="table-footer"><span>共 ${count(rows.length)} 条 · 每页 ${size} 条</span><div class="actions">${button('上一页','page-prev',{small:true,disabled:page===1,attrs:`data-module="${module}"`})}<span>${page} / ${total}</span>${button('下一页','page-next',{small:true,disabled:page===total,attrs:`data-module="${module}"`})}</div></div>`};
  }
  function dateFields() {return `<div class="field date-field"><label for="date-start">开始日期</label><input id="date-start" type="date" value="${esc(state.dates.start)}" max="${nowDate()}"></div><div class="field date-field"><label for="date-end">结束日期</label><input id="date-end" type="date" value="${esc(state.dates.end)}" max="${nowDate()}"></div>`;}
  function readDates() {const start=$('#date-start')?.value||state.dates.start,end=$('#date-end')?.value||state.dates.end;if(!start||!end||start>end)throw new Error('请选择有效日期范围，开始日期不能晚于结束日期。');state.dates={start,end};return state.dates;}
  function logsPanel(logs,title='执行记录') {
    return panel(title,'保留操作结果，异常信息按实际返回展示',arr(logs).length?`<div class="panel-body">${[...arr(logs)].sort((a,b)=>new Date(b.at||b.createdAt||b.time||b.timestamp||0)-new Date(a.at||a.createdAt||a.time||a.timestamp||0)).slice(0,30).map(log=>`<div class="log-entry"><time>${esc(dateTime(log.at||log.createdAt||log.time||log.timestamp))}</time><div>${log.status?statusBadge(log.status):''}<p>${esc(log.message||log.detail||log.error||log.reason||log.action||'操作记录')}</p>${log.campaignName||log.itemId?`<span class="cell-sub">${esc(log.campaignName||log.itemId)}</span>`:''}</div></div>`).join('')}</div>`:empty('还没有执行记录','操作完成后，这里会显示实际结果与时间。','','clock'));
  }
  function noStore() {const canAdd=cloudAuthUi?.hasPermission('workbench.accounts.add');return heading(navigation.label(state.page),canAdd?'先添加店铺，再连接对应的商家后台。':'当前账号没有店铺可见范围。')+`<section class="panel">${empty(canAdd?'添加你的第一家店铺':'暂无可查看店铺',canAdd?'每家店铺使用独立登录会话。数据同步直接读取你的店铺登录态，初次使用需要你在官方页面登录。':'请联系公司管理员为你分配店铺；普通成员只能看到自己已获授权的店铺。',canAdd?button('添加店铺','add-store',{primary:true,icon:'store'}):'','store')}</section>`;}

  function overview() {
    const reviews=moduleData('reviews'),promotion=moduleData('promotion');
    const summary=reviews.summary||{}, campaignCount=arr(promotion.campaigns).length;
    return heading('把店铺工作，安排得更清楚','集中处理评价、推广与商品资料。每一步都有结果可查。',button('店铺登录','navigate',{icon:'store',attrs:'data-page="accounts"'}),'谢谢工作台 / 本地工作空间')+
      `<div class="stats">${stat('已添加店铺',count(state.stores.length),'各店铺使用独立登录会话','store')}${stat('当前店铺订单',summary.orders===undefined?'—':count(summary.orders),'按最近一次订单同步结果','review')}${stat('已匹配晒图',summary.withImages===undefined?'—':count(summary.withImages),'合并初评与追评图片','image')}${stat('推广计划',promotion.lastSync?count(campaignCount):'—',promotion.mode==='live'?'当前已启用自动执行':'默认观察模式，先检查再操作','promotion')}</div>`+
      (!state.stores.length?notice('欢迎使用 谢谢工作台。先添加店铺并登录官方后台，即可开始同步真实数据。'):'')+
      `<div class="overview-grid">${panel('快捷工作','从常用工作开始',`<div class="quick-grid">${[
        ['reviews','评价晒图','核对订单评价与晒图，导出明细','review'],['promotion','自动推广','观察花费与 ROI，按规则管理计划','promotion'],
        ['purchase','内购会','准备 SKU 与折扣，确认后创建活动','purchase'],['qualification','标签资质','整理真实标签图，批量上传到商品','qualification'],
      ].map(([page,title,desc,icon])=>`<button class="quick-card" data-action="navigate" data-page="${page}"><span class="quick-icon">${svg(icon)}</span><span><strong>${title}</strong><p>${desc}</p></span></button>`).join('')}</div>`)}${panel('开始使用','三个步骤，建立你的本地工作空间',`<div class="panel-body"><div class="step"><span class="step-number">1</span><div><strong>添加并登录店铺</strong><p>在右上角添加店铺，在官方商家页面完成登录。</p></div></div><div class="step"><span class="step-number">2</span><div><strong>同步并检查数据</strong><p>先拉取真实订单、评价或计划，检查筛选范围与同步结果。</p></div></div><div class="step"><span class="step-number">3</span><div><strong>确认操作，保留结果</strong><p>发布和推广写入前确认对象，重要结果导出并定期备份。</p></div></div></div>`)}</div>`+
      panel('当前工作空间',store()?esc(store().name):'尚未选择店铺',`<div class="panel-body"><div class="summary-line"><span>运行方式 <b>本机桌面程序</b></span><span>AI 助手 <b>入口预留</b></span><span>店铺数据 <b>${state.storeId?'已选择店铺，按需同步':'等待添加店铺'}</b></span></div></div>`);
  }
  function reviewRows() {
    const d=moduleData('reviews');
    if(Array.isArray(d.rows))return d.rows;
    const matches=arr(d.matches);return arr(d.orders).map(order=>({...order,...(matches.find(m=>m.orderKey===(order.key||order.orderKey||order.orderLineId||order.subOrderId))||{})}));
  }
  function reviews() {
    const d=moduleData('reviews'),s=d.summary||{},all=reviewRows(),busy=state.busy.has('reviews.sync');
    const filter=state.filters.reviews,query=(state.search.reviews||'').toLowerCase();
    const filtered=all.filter(row=>{
      const status=String(row.reviewStatus||row.status||''),match=String(row.matchStatus||'');const images=Number(row.imageCount||arr(row.images).length);
      const filterMatch=filter==='all'||(filter==='images'&&images>0)||(filter==='no-images'&&images===0&&(row.matchedCount>0||/已评价|已追评|confirmed|已匹配/.test(status)))||(filter==='unreviewed'&&/未评价|未查到评价|未匹配|unmatched/.test(status))||(filter==='pending'&&/待|pending|失败/.test(status+match));
      return filterMatch&&(!query||[row.productTitle,row.title,row.mainOrderId,row.orderId,row.subOrderId,row.productId,row.skuId,row.content].some(v=>String(v||'').toLowerCase().includes(query)));
    });
    const page=paginate(filtered,'reviews');
    return heading('评价晒图','直接使用店铺登录态读取订单与评价，核对初评、追评和晒图。',button('打开订单后台','open-backend',{attrs:'data-kind="orders"',permission:'workbench.reviews.open'})+button('登录 / 评价后台','open-backend',{icon:'store',attrs:'data-kind="reviews"',permission:'workbench.reviews.open'})+button('导出明细','export',{icon:'export',attrs:'data-module="reviews"',disabled:!all.length,permission:'workbench.reviews.export'}))+
      `<div class="stats">${stat('订单明细',count(s.orders??all.length),'所选下单日期范围','purchase')}${stat('已匹配评价',count(s.matched??all.filter(r=>/已评价|confirmed/.test(r.reviewStatus||r.matchStatus||'')).length),'按订单与商品标识关联','review')}${stat('有晒图订单',count(s.withImages??all.filter(r=>Number(r.imageCount)>0).length),'初评与追评图片合计','image')}${stat('需要确认',count(s.pending??all.filter(r=>/待|pending/.test(r.reviewStatus||r.matchStatus||'')).length),'信息不足的记录单独保留','info')}</div>`+
      notice(esc(d.scopeNote||'首次同步前，请打开订单 / 评价后台并在所需范围选择“全部”查询一次。软件需要捕获页面的实际查询格式；登录或安全验证需在官方页面完成。'))+
      `<section class="panel"><div class="toolbar">${dateFields()}${button(busy?'正在同步…':'同步订单与评价','review-sync',{primary:true,icon:'refresh',attrs:'data-kind="all"',disabled:busy,permission:'workbench.reviews.sync'})}${button('仅订单','review-sync',{attrs:'data-kind="orders"',disabled:busy,permission:'workbench.reviews.sync'})}${button('仅评价','review-sync',{attrs:'data-kind="reviews"',disabled:busy,permission:'workbench.reviews.sync'})}${button('取消同步','review-cancel',{disabled:!busy,permission:'workbench.reviews.sync'})}</div>
      <div class="sync-details"><span>订单：<strong>${esc(syncText(d.sync?.orders||d.orderSync))}</strong></span><span>评价：<strong>${esc(syncText(d.sync?.reviews||d.reviewSync))}</strong></span></div>
      <div class="filterbar">${[['all','全部'],['images','有晒图'],['no-images','已评无图'],['unreviewed','范围内未查到'],['pending','待确认 / 失败']].map(([value,label])=>`<button class="filter-chip${filter===value?' active':''}" data-action="filter" data-module="reviews" data-value="${value}">${label}</button>`).join('')}<input class="search-input" data-search="reviews" value="${esc(state.search.reviews||'')}" placeholder="搜索订单号、商品名称 / ID" aria-label="搜索评价订单"></div>
      ${table(['订单 / 商品','商品 ID / SKU','订单时间','评价状态','晒图','评价内容','操作'],page.rows.map(row=>{
        const index=all.indexOf(row),images=Number(row.imageCount||arr(row.images).length);
        return `<tr><td class="title-cell"><span class="cell-main clip">${esc(row.productTitle||row.title||'未提供商品标题')}</span><span class="cell-sub mono">${esc(row.mainOrderId||row.orderId||row.subOrderId||row.orderLineId||'')}</span></td><td class="mono">${esc(row.productId||row.itemId||'—')}<span class="cell-sub">${esc(row.skuId||'')}</span></td><td class="nowrap">${esc(row.orderedAt?dateTime(row.orderedAt):'—')}</td><td>${statusBadge(row.reviewStatus||'待确认')}<span class="cell-sub">${esc(row.matchStatus||'')}</span></td><td><button class="image-count" data-action="review-images" data-index="${index}" ${images?'':'disabled'}>${images?`${images} 张图片`:'—'}</button></td><td class="title-cell"><span class="clip">${esc(row.content||row.reviewContent||'—')}</span>${row.hasFollowUp||row.followUpImageCount>0?'<span class="cell-sub">含追评</span>':''}</td><td>${button('查看','review-detail',{small:true,attrs:`data-index="${index}"`})}</td></tr>`;
      }).join(''),empty('还没有订单与评价记录','先登录店铺，选择日期范围并同步。未同步、失败和无法关联的记录不会伪装为成功。','','review'))}${all.length?page.footer:''}</section>`;
  }
  function syncText(sync) {if(!sync)return '尚未同步';const status={idle:'尚未同步',completed:'完成',partial:'部分完成',failed:'失败',running:'进行中',cancelled:'已取消',canceled:'已取消','login-expired':'登录过期'}[sync.status]||sync.status||'尚未同步';const parts=[status];if(sync.completedPages)parts.push(`${sync.completedPages}/${sync.totalPages||'?'} 页`);if(Number.isFinite(sync.recordCount))parts.push(`${sync.recordCount} 条`);if(Array.isArray(sync.failedPages)&&sync.failedPages.length)parts.push(`${sync.failedPages.length} 页未取到，再次同步会从第 ${sync.nextPage||'?'} 页继续`);if(sync.message)parts.push(sync.message);return parts.join(' · ');}

  function promotion() {
    const d=moduleData('promotion'),campaigns=arr(d.campaigns),rules=arr(d.rules),busy=state.busy.has('promotion.sync');
    const query=(state.search.promotion||'').toLowerCase();const filtered=campaigns.filter(c=>!query||`${c.name||c.campaignName||''} ${c.id||c.campaignId||''}`.toLowerCase().includes(query));const page=paginate(filtered,'promotion');
    return heading('自动推广','按花费与 ROI 条件观察推广计划，确认授权后执行暂停与恢复。',button('登录 / 推广后台','open-backend',{icon:'store',attrs:'data-kind="promotion"',permission:'workbench.promotion.view'})+button('导出数据与日志','export',{icon:'export',attrs:'data-module="promotion"',disabled:!campaigns.length&&!arr(d.logs).length,permission:'workbench.promotion.export'}))+
      `<div class="mode-card"><div><strong>运行模式 ${d.mode==='live'?badge('真实写入已启用','warn'):badge('先观察，再执行','brand')}</strong><p>${d.mode==='live'?'已按当前店铺规则授权定时执行。请保持程序运行，并留意平台回读与异常记录。':'观察模式会检查条件并记录建议，启用自动执行时将明确确认会影响哪些计划。'}</p></div><div class="segmented">${button('观察模式','promotion-mode',{attrs:`data-mode="observe" class="${d.mode!=='live'?'active':''}"`,permission:'workbench.promotion.execute'})}${button('自动执行','promotion-mode',{attrs:`data-mode="live" class="${d.mode==='live'?'active':''}"`,permission:'workbench.promotion.execute'})}</div></div>`+
      (d.notice?notice(esc(d.notice),'warning'):'')+
      panel('推广规则','保存或修改规则后返回观察模式，请重新检查并授权。',rules.length?rules.map(rule=>`<div class="active-rule"><div><strong>${esc(rule.name||'推广规则')}</strong> ${badge(rule.enabled===false?'已停用':'已启用',rule.enabled===false?'':'brand')}<p>花费 ≥ ${money(rule.spendThreshold)} 元 · ${rule.channel==='store'?'ROI':'净 ROI'} ≤ ${esc(rule.roiThreshold??'—')} · ${esc(rule.intervalMinutes||5)} 分钟检查 · ${Number(rule.recoverAfterMinutes)>0?`${rule.recoverAfterMinutes} 分钟后恢复`:'不自动恢复'}</p><p>${esc(rule.startTime||'00:00')}–${esc(rule.endTime||'23:59')} · ${esc(channelLabel(rule.channel))} · ${esc(presetLabel(rule.datePreset))}</p></div><div class="actions">${button('编辑','edit-rule',{small:true,attrs:`data-id="${esc(rule.id)}"`,permission:'workbench.promotion.rules'})}${button('删除','delete-rule',{small:true,attrs:`data-id="${esc(rule.id)}"`,permission:'workbench.promotion.rules'})}</div></div>`).join(''):empty('先添加一条推广规则','设置花费、ROI 和检查间隔。自动执行保持关闭，直到你明确启用。',button('添加规则','edit-rule',{primary:true,permission:'workbench.promotion.rules'}),'promotion'),rules.length?button('添加规则','edit-rule',{small:true,permission:'workbench.promotion.rules'}):'')+
      `<section class="panel"><div class="toolbar">${dateFields()}${button(busy?'同步中…':'同步推广计划','promotion-sync',{primary:true,icon:'refresh',disabled:busy,permission:'workbench.promotion.sync'})}${button('立即检查规则','promotion-run',{disabled:!rules.length||state.busy.has('promotion.run'),permission:'workbench.promotion.execute'})}<span class="spacer"></span>${button(`暂停已选${state.selection.size?` (${state.selection.size})`:''}`,'promotion-pause',{danger:true,disabled:!state.selection.size,permission:'workbench.promotion.execute'})}</div><div class="filterbar"><span class="inline-note">最近同步：${esc(dateTime(d.lastSync?.at||d.lastSync?.completedAt||d.lastSync))}</span><input class="search-input" data-search="promotion" value="${esc(state.search.promotion||'')}" placeholder="搜索计划名称 / ID" aria-label="搜索推广计划"></div>${table(['<input type="checkbox" class="table-select" id="campaign-select-all" aria-label="选择当前页全部计划">','推广计划','渠道','状态','花费','成交金额','ROI / 净 ROI','操作'],page.rows.map(c=>{const id=String(c.id||c.campaignId||'');return `<tr><td><input type="checkbox" class="table-select" data-campaign="${esc(id)}" ${state.selection.has(id)?'checked':''} aria-label="选择 ${esc(c.name||c.campaignName||id)}"></td><td class="title-cell"><span class="cell-main">${esc(c.name||c.campaignName||'未命名计划')}</span><span class="cell-sub mono">${esc(id)}</span></td><td>${esc(channelLabel(c.channel))}</td><td>${statusBadge(c.status||c.state||'未知')}</td><td>${money(c.spend??c.cost??c.charge)}</td><td>${money(c.revenue??c.transactionAmount??c.payAmount)}</td><td>${money(c.roi)}<span class="cell-sub">净 ROI ${money(c.netRoi)}</span></td><td>${button('暂停','promotion-pause',{small:true,attrs:`data-id="${esc(id)}"`,permission:'workbench.promotion.execute'})}</td></tr>`;}).join(''),empty('尚未同步推广计划','打开推广后台完成登录，再选择日期同步。真实暂停前会列出店铺与计划供你确认。','','promotion'))}${campaigns.length?page.footer:''}</section>`+logsPanel(d.logs);
  }
  function channelLabel(channel) {return {sitewide:'货品全站推广',product:'货品全站推广',store:'店铺全站推广'}[channel]||channel||'—';}
  function presetLabel(value) {return {today:'今天',yesterday:'昨天',last3:'近 3 天',last7:'近 7 天',last14:'近 14 天',last30:'近 30 天'}[value]||'今天';}

  // 内购会（对齐同类工作台）：左=创建记录，中=时间/名称 + 批量商品ID + 优惠设置，右=创建状态/线上活动/二维码/操作记录。
  function purchase() {
    const d=moduleData('purchase'),plans=arr(d.plans||d.activities);
    const canPurchaseCreate=Boolean(cloudAuthUi?.hasPermission('workbench.marketing.purchase.create'));
    const storeName=store()?.name||'未选择店铺';
    const selectedId=state.purchasePlanId||(plans[0]?String(plans[0].id):null);
    const isNew=selectedId==='__new__';
    const selected=isNew?null:(plans.find(plan=>String(plan.id)===String(selectedId))||null);
    const editable=isNew||Boolean(selected);
    const statusValue=String(selected?.status||selected?.executionStatus||'draft');
    const immutable=['created','ended','creating','needs-check'].includes(statusValue);
    const label=value=>({draft:'待填写',prepared:'预检通过',blocked:'被阻断','login-required':'需要登录',creating:'创建中',created:'已创建',ended:'已结束','needs-check':'待核对',failed:'失败',disabled:'已停用'}[value]||value||'待填写');
    const tone=value=>['created','prepared'].includes(value)?'good':['blocked','failed','needs-check'].includes(value)?'bad':value==='ended'?'':'warn';
    const preparation=selected?.preparation||null;
    const preparedToken=selected?state.prepared[selected.id]:null;
    const busyPrepare=selected?state.busy.has(`purchase.prepare:${selected.id}`):false;
    const products=arr(selected?.scope?.products||selected?.products);
    const skuRule=selected?.skuDiscountRule||{};
    const threshold=selected?.threshold||{kind:'none',value:0};
    const discount=selected?.discount||{kind:'percentage',value:skuRule.otherSkus??9.9};
    const stacking=selected?.stacking||{};
    const two=value=>String(value).padStart(2,'0');
    const hourLater=()=>{const date=new Date();date.setMinutes(date.getMinutes()+ (date.getSeconds()>0?1:0),0,0);date.setHours(date.getHours()+1);return `${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;};
    const defaultStart=hourLater();
    const defaultEnd=(()=>{const date=new Date(defaultStart);date.setTime(date.getTime()+3*3600*1000);return `${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;})();
    const fieldValue=value=>String(value??'').replace(' ','T').slice(0,16);
    const startValue=fieldValue(selected?.startsAt)||defaultStart;
    const endValue=fieldValue(selected?.endsAt)||defaultEnd;
    const nameValue=selected?.name||generatedPurchaseName(storeName,startValue);
    const planItems=plans.map(plan=>{const id=String(plan.id||''),value=String(plan.status||plan.executionStatus||'draft'),isActive=id===String(selectedId);return `<div class="purchase-plan${isActive?' active':''}"><button type="button" class="purchase-plan-open" data-action="purchase-select" data-id="${esc(id)}"><strong>${esc(plan.name||'未命名任务')}</strong><span>${badge(label(value),tone(value))}<small>${esc(String(plan.updatedAt||'').slice(0,16).replace('T',' ')||'—')}</small></span></button>${canPurchaseCreate?`<button type="button" class="link-button" data-action="purchase-delete" data-id="${esc(id)}" title="删除任务">删除</button>`:''}</div>`;}).join('');
    const sidePanel=panel('创建记录',`${count(plans.length)} 个任务`,plans.length?`<div class="panel-body purchase-plan-list">${planItems}</div>`:empty('还没有内购会任务','点右上角“新建任务”，填活动信息并粘贴商品 ID。',button('新建任务','purchase-new',{primary:true,permission:'workbench.marketing.purchase.create'}),'purchase'),button('新建任务','purchase-new',{small:true,primary:true,permission:'workbench.marketing.purchase.create'}));
    const invalidIds=0;
    const idsValue=products.map(item=>item.id).join('\n');
    const issues=[];
    if(products.length<3)issues.push(products.length?`适用商品不足（当前 ${products.length} 个，至少 3 个）`:'至少添加 3 个适用商品');
    if(!selected?.startsAt||!selected?.endsAt)issues.push('活动时间');
    const validationBar=`<div class="purchase-validation">${svg('info')}<span>${issues.length?`${esc(issues[0])}${issues.length>1?`，另有 ${issues.length-1} 项需要完善`:''}`:'校验通过：商品与活动时间已就绪，可以创建内购会'}</span></div>`;
    const editorBody=`<div class="panel-body">
      <div class="purchase-section-head"><strong>活动时间与名称</strong><span class="inline-note">名称自动生成 · 默认持续 3 小时</span></div>
      <div class="form-grid">
        <div class="field full"><label for="pf-name">活动名称</label><input id="pf-name" type="text" maxlength="12" value="${esc(nameValue)}" placeholder="自动生成 · 最长 12 字"><small>自动生成 · 最长 12 字；时间被淘宝顺延时名称会自动更新</small></div>
        <div class="field"><label for="pf-startsAt">开始时间</label><input id="pf-startsAt" type="datetime-local" value="${esc(startValue)}"></div>
        <div class="field"><label for="pf-endsAt">结束时间</label><input id="pf-endsAt" type="datetime-local" value="${esc(endValue)}"></div>
        <div class="field full"><label>快捷</label><div class="actions purchase-quick-time">${[1,2,4,8].map(hours=>button(`${hours} 小时后`,'purchase-quick-time',{small:true,attrs:`data-hours="${hours}"`})).join('')}<span class="inline-note">默认持续 3 小时</span></div></div>
        <div class="field"><label>选择人群</label><div class="readonly-chip">${badge('粉丝人群（固定）','brand')}<span class="inline-note">当前淘宝内购会只支持粉丝人群</span></div></div>
        <div class="field"><label for="pf-description">活动说明（可选）</label><input id="pf-description" type="text" maxlength="120" value="${esc(selected?.description||'')}" placeholder="给这个任务做个备注"></div>
      </div>
      <div class="purchase-section-head"><strong>批量导入商品 ID</strong><span class="inline-note">每行一个商品 ID，至少 3 个</span></div>
      <textarea id="pf-product-ids" class="purchase-ids-input" rows="6" placeholder="每行一个商品 ID，至少 3 个" ${immutable?'readonly':''}>${esc(idsValue)}</textarea>
      <div class="purchase-ids-meta"><span class="ok">已识别 <b>${count(products.length)}</b> 个商品</span><span class="bad">${count(invalidIds)} 个 ID 无效</span><div class="actions">${button('下载导入模板','purchase-template',{small:true,icon:'export',permission:'workbench.marketing.purchase.import'})}${button('导入表格','purchase-import',{small:true,icon:'folder',disabled:immutable,permission:'workbench.marketing.purchase.import'})}${products.length&&selected?button('清空','purchase-clear-products',{small:true,attrs:`data-id="${esc(selected.id)}"`,disabled:immutable,permission:'workbench.marketing.purchase.create'}):''}</div></div>
      <div class="purchase-section-head"><strong>商品优惠设置</strong><span class="inline-note">点击数值即可修改</span></div>
      <div class="form-grid">
        <div class="field"><label for="pf-other-skus">其他 SKU（折）</label><input id="pf-other-skus" type="number" min="0.1" max="9.9" step="0.1" value="${esc(String(skuRule.otherSkus??9.9))}"><small>默认 9.9 折 · 可设置 0.1–9.9 折，支持一位小数</small></div>
        <div class="field"><label for="pf-last-sku">第 6 个 SKU（折）</label><input id="pf-last-sku" type="number" min="0.1" max="9.9" step="0.1" value="${esc(String(skuRule.lastSku??0.1))}"><small>默认 0.1 折 · 不足 6 个时取最后一个</small></div>
        <div class="field"><label for="pf-threshold-kind">门槛</label><div class="inline-pair"><select id="pf-threshold-kind"><option value="none" ${threshold.kind==='none'?'selected':''}>无门槛</option><option value="amount" ${threshold.kind==='amount'?'selected':''}>满金额（元）</option><option value="quantity" ${threshold.kind==='quantity'?'selected':''}>满件数（件）</option></select><input id="pf-threshold-value" type="number" min="0" step="1" value="${esc(String(threshold.value||''))}" placeholder="数值" ${threshold.kind==='none'?'disabled':''}></div></div>
        <div class="field"><label for="pf-discount-kind">优惠形式</label><div class="inline-pair"><select id="pf-discount-kind"><option value="percentage" ${discount.kind==='percentage'?'selected':''}>打折（折）</option><option value="amount-off" ${discount.kind==='amount-off'?'selected':''}>减钱（元）</option><option value="fixed-price" ${discount.kind==='fixed-price'?'selected':''}>一口价（元）</option></select><input id="pf-discount-value" type="number" min="0.1" step="0.1" value="${esc(String(discount.value??''))}" placeholder="数值"></div></div>
        <div class="field full"><label>叠加设置</label><div class="checkline-group"><label class="checkline"><input type="checkbox" id="pf-stack-store" ${stacking.storeCoupon?'checked':''}>店铺优惠券</label><label class="checkline"><input type="checkbox" id="pf-stack-platform" ${stacking.platformCoupon?'checked':''}>平台优惠券</label><label class="checkline"><input type="checkbox" id="pf-stack-member" ${stacking.memberDiscount?'checked':''}>会员折扣</label></div></div>
      </div>
      ${validationBar}
      <div class="actions purchase-editor-actions">${button('人工单品测试','purchase-manual-test',{small:true,permission:'workbench.marketing.purchase.create'})}${button('保存草稿','purchase-save',{disabled:busyPrepare||immutable,permission:'workbench.marketing.purchase.create'})}${editable?button('创建内购会','purchase-prepare',{primary:true,disabled:busyPrepare||immutable,permission:'workbench.marketing.purchase.create'}):''}</div>
      <p class="inline-note">“创建内购会”只做预检并把活动信息、商品与折扣填到淘宝页面（不提交）；预检通过后再点“确认创建淘宝内购会”才会正式创建。每个商品第 6 个 SKU（不足 6 个取最后一个）用“第 6 个 SKU”折扣，其余用“其他 SKU”折扣。</p>
    </div>`;
    const editorPanel=editable?panel(isNew?'新建内购会任务':`方案 · ${esc(selected?.name||'未命名任务')}`,esc(storeName)+(isNew?'':' · '+label(statusValue)),editorBody,''):panel('方案编辑器','',empty('先选择一个任务','从左侧点一个任务，或新建一个内购会任务。',button('新建任务','purchase-new',{primary:true,permission:'workbench.marketing.purchase.create'}),'purchase'));
    const attentionCard=selected?.attention?`<div class="callout warning">${svg('info')}<div><strong>需要处理：</strong>${esc(selected.attention.detail||'')}</div></div><div class="actions purchase-attention-actions">${button('处理（打开店铺页面）','purchase-attention-open',{primary:true,small:true})}${button('我已处理，继续','purchase-attention-resume',{small:true,attrs:`data-id="${esc(selected.id)}"`})}</div>`:'';
    const loginCard=selected&&statusValue==='login-required'&&!selected.attention?`<div class="callout warning">${svg('info')}<div><strong>需要登录：</strong>${esc(preparation?.message||'店铺登录已失效，请重新登录后再预检。')}</div></div><div class="actions purchase-attention-actions">${button('去登录（打开店铺页面）','purchase-attention-open',{primary:true,small:true})}${button('我已登录，重新预检','purchase-attention-resume',{small:true,attrs:`data-id="${esc(selected.id)}"`})}</div>`:'';
    const statusHint={draft:'填好商品 ID 和活动时间后，点“创建内购会”即可执行。',prepared:'淘宝预检已通过，点“确认创建淘宝内购会”后立即生效。','login-required':'店铺登录已失效，先登录再重新预检。',blocked:'当前店铺已有运行中的内购会或商品被占用，先处理后重新预检。',creating:'正在提交淘宝，请稍候。',created:'已创建，可在“线上活动管理”里结束活动。','needs-check':'上次创建结果待核对，先去活动列表确认。',ended:'活动已结束。',failed:'上次预检失败，可修改后重试。'};
    const statusPanel=panel('创建状态',badge(label(statusValue),tone(statusValue)),`<div class="panel-body"><p class="inline-note">${esc(statusHint[statusValue]||statusHint.draft)}</p>${preparedToken?`<div class="actions">${button('确认创建淘宝内购会','purchase-create',{primary:true,small:true,attrs:`data-id="${esc(selected.id)}"`,permission:'workbench.marketing.purchase.create'})}</div>`:''}${selected&&['needs-check','creating'].includes(statusValue)?`<div class="actions">${button('核对后台活动…','purchase-claim',{small:true,attrs:`data-id="${esc(selected.id)}"`,permission:'workbench.marketing.purchase.create'})}${button('我已核对未创建，解锁草稿','purchase-resolve-check',{small:true,attrs:`data-id="${esc(selected.id)}"`,permission:'workbench.marketing.purchase.create'})}</div>`:''}</div>`);
    const onlinePanel=panel('线上活动管理','创建成功后可在这里结束线上活动。',`<div class="panel-body"><p class="inline-note">${selected?.platformActivityName?`当前任务对应后台活动：${esc(selected.platformActivityName)}${selected.platformStartsAt?`（${esc(selected.platformStartsAt)}${selected.platformEndsAt?` 至 ${esc(selected.platformEndsAt)}`:''}）`:''}`:'还没有已创建的线上活动。'}</p><div class="actions">${selected&&statusValue==='created'?button('结束活动','purchase-close',{small:true,danger:true,attrs:`data-id="${esc(selected.id)}"`}):''}${button('打开活动列表','open-backend',{small:true,attrs:'data-kind="purchase"'})}</div></div>`);
    const qrPanel=panel('二维码','创建后显示，复制的是高清二维码',`<div class="panel-body purchase-qr-panel">${selected?.qrCodeDataUrl?`<img class="purchase-qr" src="${esc(selected.qrCodeDataUrl)}" alt="活动二维码">`:`<div class="purchase-qr-placeholder">${svg('image')}<span>暂无二维码</span></div>`}<div class="actions">${selected?.qrCodeDataUrl?button('复制高清二维码','purchase-copy-qr',{small:true}):''}</div></div>`);
    const logItems=arr(d.logs).slice(0,20).map(log=>`<div class="purchase-log"><span>${esc(log.message||log.detail||'操作记录')}</span><time>${esc(String(log.at||'').slice(5,16).replace('T',' '))}</time></div>`).join('');
    const logsPanelHtml=panel('操作记录','最多 20 条',logItems?`<div class="panel-body purchase-logs">${logItems}</div>`:`<div class="panel-body"><p class="inline-note">还没有操作记录。</p></div>`);
    return marketingTabs()+
      heading('内购会','按店铺准备活动方案、预检淘宝页面，确认后创建到后台；支持二维码与结束活动。')+
      // 用户 2026-10-14：顶栏不再放“新建任务 / 下载导入模板 / 打开商家后台”，
      // “打开商家后台”挪到创建流程提示条右侧（截图 1 的黄框位置）。
      `<div class="purchase-notice-row">${notice('创建流程：填活动时间与名称 → 粘贴商品 ID（至少 3 个）→ 设置 SKU 折扣 → 创建内购会（预检）→ 确认创建淘宝内购会 → 二维码与结束活动。预检只填页面不提交。')}<div class="notice-actions">${button('打开商家后台','open-backend',{small:true,icon:'store',attrs:'data-kind="purchase"'})}</div></div>`+
      attentionCard+
      loginCard+
      `<div class="purchase-grid"><div class="purchase-side">${sidePanel}</div><div class="purchase-main">${editorPanel}</div><div class="purchase-right">${statusPanel}${onlinePanel}${qrPanel}${logsPanelHtml}</div></div>`;
  }
  // 托管礼金（独立模块，参考同类工作台）：报名操作 / 执行记录 两个页签；左=活动类型/商品ID/费率/操作，右=报名流水/可添加商品/已报名商品。
  function hostedGiftPage() {
    // 本地数据在服务层命名为 local（顶层 snapshot 会被 setData 当成账号数据剥走）。
    const d=moduleData('hostedgift')||{},snapshot=d.local||{},activities=arr(d.activities),presets=arr(d.ratePresets);
    const storeName=store()?.name||'未选择店铺';
    const g=state.gift||(state.gift={tab:'enroll',activity:activities[0]?.id||'xingpin',mode:'item',rate:15,custom:false,idsText:'',selectable:[],signed:[],queryAt:null,withLaoke:false});
    if(activities.length&&!activities.some(item=>item.id===g.activity))g.activity=activities[0].id;
    const tab=g.tab==='records'?'records':'enroll';
    const activity=activities.find(item=>item.id===g.activity)||{id:'xingpin',label:'超级新品加速',description:'新品推广期的礼金托管'};
    const parsed=parseGiftIds(g.idsText||'');
    const rate=Number(g.rate)||0;
    const busy=Array.from(state.busy).some(key=>key.startsWith('hostedgift.'));
    const lastRun=snapshot.lastRun||null;
    const logs=arr(snapshot.logs);
    const activityCards=activities.map(item=>`<label class="gift-activity${activity.id===item.id?' active':''}"><input type="radio" name="gift-activity" data-action="gift-activity" data-value="${esc(item.id)}" ${activity.id===item.id?'checked':''}><span class="gift-activity-body"><strong>${esc(item.label)}</strong><small>${esc(item.description||'')}</small></span></label>`).join('');
    const rateChips=[...presets,rate].filter((value,index,list)=>value>0&&list.indexOf(value)===index).sort((a,b)=>a-b);
    const rateButtons=rateChips.map(value=>`<button type="button" class="gift-rate${!g.custom&&Number(value)===rate?' active':''}" data-action="gift-rate" data-value="${value}">${value}%</button>`).join('')+`<span class="gift-rate-custom">自定义<input id="gift-rate-input" type="number" min="1" max="100" step="1" value="${g.custom?rate:''}" placeholder="—" ${g.custom?'class="active"':''}>%</span>`;
    const resultRow=item=>`<div class="gift-row"><span class="mono">${esc(item.itemId||'')}</span><span class="gift-row-title">${esc(item.title||'')}</span>${item.ok===false?badge('失败','bad'):item.status?badge(String(item.status),''):badge('成功','good')}<span class="gift-row-note">${esc(String(item.message||'').slice(0,80))}</span></div>`;
    const selectableRows=arr(g.selectable).slice(0,30).map(item=>`<div class="gift-row"><span class="mono">${esc(item.itemId||'')}</span><span class="gift-row-title">${esc(item.title||'')}</span><span class="gift-row-note">${arr(item.settleOptions).slice(0,4).map(option=>`${esc(String(option.ratePercent??''))}%`).filter(Boolean).join(' / ')}</span></div>`).join('');
    const signedRows=arr(g.signed).slice(0,30).map(item=>`<div class="gift-row"><span class="mono">${esc(item.itemId||'')}</span><span class="gift-row-title">${esc(item.title||'')}</span>${item.ratePercent?badge(`${esc(String(item.ratePercent))}%`,''):''}${item.rateMode?badge(item.rateMode==='sku'?'SKU费率':'单品费率',''):''}<span class="gift-row-note">${esc(String(item.status||'').slice(0,40))}</span></div>`).join('');
    const lastRunRows=lastRun?arr(lastRun.items).map(resultRow).join(''):'';
    const logsRows=logs.length?table(['时间','操作','结果','说明'],logs.map(entry=>`<tr><td class="nowrap">${esc(dateTime(entry.at))}</td><td>${esc(entry.action||'')}</td><td>${entry.result==='ok'?badge('成功','good'):entry.result==='failed'?badge('失败','bad'):badge(esc(String(entry.result||'—')),'')}</td><td class="title-cell"><span class="clip">${esc(entry.message||'')}</span></td></tr>`).join('')):empty('还没有执行记录','每次查询、报名、退出都会记录在这里。','','clock');
    const enrollTab=`
      ${panel('活动类型','选择要报名的托管礼金活动',`<div class="panel-body gift-activities">${activityCards||'<p class="inline-note">正在读取活动类型…</p>'}${(()=>{const canLaoke=g.activity==='xinke';return `<label class="gift-laoke${canLaoke?'':' disabled'}"><input type="checkbox" id="gift-laoke" data-action="gift-with-laoke" ${canLaoke&&g.withLaoke?'checked':''} ${canLaoke?'':'disabled'}><span>同时报名超级老客加速<small>勾选后同一批商品一并提交${canLaoke?'':'（仅“超级新客加速”支持）'}</small></span></label>`;})()}</div>`)}
      ${panel('商品 ID','每行一个，5–20 位数字',`<div class="panel-body"><div class="gift-ids-head"><span class="inline-note">每行一个商品 ID，也可用逗号分隔</span><span class="gift-ids-count">已输入 <b>${parsed.ids.length}</b> 个${parsed.invalid.length?` · ${parsed.invalid.length} 个无效`:''}</span></div><textarea id="gift-ids" class="gift-ids-input" rows="7" placeholder="每行一个商品 ID，也可用逗号分隔">${esc(g.idsText||'')}</textarea></div>`)}
      ${panel('费率设置','单品费率 / SKU 费率，自定义范围 1–100%',`<div class="panel-body"><div class="gift-rate-modes"><button type="button" class="gift-rate${g.mode!=='sku'?' active':''}" data-action="gift-rate-mode" data-value="item">单品费率</button><button type="button" class="gift-rate${g.mode==='sku'?' active':''}" data-action="gift-rate-mode" data-value="sku">SKU 费率</button><span class="inline-note">${g.mode==='sku'?'SKU 模式：按每个 SKU 分别报名，费率相同。':'单品模式：按商品分别报名，使用填写的费率。'}</span></div><div class="gift-rate-row">${rateButtons}</div></div>`)}
      <div class="actions gift-actions">${button(busy?'处理中…':'查询可添加','gift-query',{small:true,disabled:busy,permission:'workbench.marketing.gift.view'})}${button('刷新已报名','gift-refresh',{small:true,disabled:busy,permission:'workbench.marketing.gift.view'})}${button('批量退出','gift-exit',{small:true,danger:true,disabled:busy||!parsed.ids.length,permission:'workbench.marketing.gift.enroll'})}<span class="spacer"></span>${button('报名提交','gift-submit',{primary:true,disabled:busy||!parsed.ids.length,permission:'workbench.marketing.gift.enroll'})}</div>`;
    const rightColumn=`
      ${panel('报名流水','最近一次',lastRun?`<div class="panel-body gift-list"><div class="gift-list-head"><span>${esc(lastRun.activityLabel||'')}${lastRun.withLaoke?' · 含超级老客加速':''}</span><span>${esc(String(lastRun.ratePercent?`${lastRun.ratePercent}%`:'') )}${lastRun.rateMode?` · ${lastRun.rateMode==='sku'?'SKU费率':'单品费率'}`:''} · ${esc(dateTime(lastRun.at))}</span></div>${lastRunRows||'<p class="inline-note">这次提交没有返回逐商品结果。</p>'}</div>`:`<div class="panel-body"><p class="inline-note">暂无报名流水，点击“报名提交”后在此显示每个商品的结果。</p></div>`)}
      ${panel('可添加商品','最多 30 个',`<div class="panel-body gift-list">${selectableRows||`<p class="inline-note">点击「查询可添加」查看可报名的商品${parsed.ids.length?'（已填 ID 会按填写的筛选）':''}。</p>`}</div>`)}
      ${panel('已报名商品','',`<div class="panel-body gift-list">${signedRows||'<p class="inline-note">点击「刷新已报名」同步已报名的商品。</p>'}</div>`)}`;
    return marketingTabs()+
      heading('托管礼金','给“超级新品加速 / 超级新客加速”报名托管礼金，直接读取淘宝“品牌新享”页面；独立模块，不影响其它功能。')+
      // 用户 2026-10-14：顶栏不再放功能按钮，挪到流程提示条右侧（截图 2 的红色椭圆/方框位置）。
      `<div class="purchase-notice-row">${notice('流程：选活动类型 → 粘贴商品 ID → 选费率 → 查询可添加 → 报名提交。报名/退出会真实提交到淘宝，请提交前核对商品与费率。')}<div class="notice-actions">${button('刷新本地记录','gift-refresh-local',{small:true,icon:'refresh',permission:'workbench.marketing.gift.view'})}${button('打开平台页面','gift-open',{small:true,icon:'store',permission:'workbench.marketing.gift.view'})}</div></div>`+
      `<div class="gift-toolbar"><div class="segmented gift-tabs"><button type="button" class="${tab==='enroll'?'active':''}" data-action="gift-tab" data-value="enroll">报名操作</button><button type="button" class="${tab==='records'?'active':''}" data-action="gift-tab" data-value="records">执行记录<span class="tab-count">${esc(String(logs.length))}</span></button></div><span class="gift-store">当前店铺：${esc(storeName)}</span></div>`+
      (tab==='records'?logsRows:`<div class="gift-grid"><div class="gift-main">${enrollTab}</div><div class="gift-side">${rightColumn}</div></div>`);
  }

  // —— 投诉打标（独立模块，参考同类工作台）：异常订单投诉 / 账号打标 / 执行记录 ——
  function parseComplaintOrders(raw){
    const tokens=String(raw||'').split(/[\s,，;；、]+/u).map(token=>token.trim()).filter(Boolean);
    const seen=new Set(),valid=[],invalid=[],duplicates=[];
    for(const token of tokens){
      if(!/^\d{12,20}$/u.test(token))invalid.push(token);
      else if(seen.has(token))duplicates.push(token);
      else{seen.add(token);valid.push(token);}
    }
    return {valid,invalid,duplicates};
  }
  function parseComplaintNicks(raw){
    const tokens=String(raw||'').split(/[\r\n,，;；]+/u).map(token=>token.trim()).filter(Boolean);
    const seen=new Set(),valid=[],invalid=[],duplicates=[];
    for(const token of tokens){
      if(token.length>64||/\*\*/u.test(token))invalid.push(token);
      else if(seen.has(token))duplicates.push(token);
      else{seen.add(token);valid.push(token);}
    }
    return {valid,invalid,duplicates};
  }
  const fenMoney=fen=>Number.isFinite(Number(fen))?`¥${(Number(fen)/100).toFixed(2)}`:'—';
  function complaintPage(){
    const d=moduleData('complaint')||{};
    const records=arr(d.records),scenes=arr(d.complaintScenes),tagTypes=arr(d.tagTypes);
    const s=state.complaint||(state.complaint={view:'complaint',scene:'',desc:'',orders:'',nicks:'',tagType:'',tagScene:'',filter:'all',preview:null,run:null,gapMin:3,gapMax:6,excluded:new Set()});
    if(!s.scene&&scenes[0])s.scene=scenes[0].code;
    if(!s.desc&&arr(d.descriptionTemplates)[0])s.desc=arr(d.descriptionTemplates)[0];
    if(!s.tagType&&tagTypes[0])s.tagType=tagTypes[0].code;
    const tagType=tagTypes.find(type=>type.code===s.tagType)||tagTypes[0]||{scenes:[]};
    if(!s.tagScene||!arr(tagType.scenes).some(scene=>scene.code===s.tagScene))s.tagScene=arr(tagType.scenes)[0]?.code||'';
    if(!s.run&&d.run)s.run=d.run;
    const run=s.run,runActive=Boolean(run&&['running','paused','challenge'].includes(run.state));
    const view=['complaint','tag','records'].includes(s.view)?s.view:'complaint';
    const busy=Array.from(state.busy).some(key=>key.startsWith('complaint.'));
    const parsedOrders=parseComplaintOrders(s.orders||''),parsedNicks=parseComplaintNicks(s.nicks||'');
    const tabButton=(id,label,countText='')=>`<button type="button" class="${view===id?'on':''}" data-action="ct-view" data-value="${id}" ${view===id?'aria-current="page"':''}>${label}${countText?`<span class="tab-count">${esc(countText)}</span>`:''}</button>`;
    const tabs=`<div class="ct-toolbar"><div class="segmented ct-tabs">${tabButton('complaint','异常订单投诉')}${tabButton('tag','账号打标')}${tabButton('records','执行记录',String(records.length))}</div><span class="ct-store">当前店铺：${esc(store()?.name||'未选择店铺')}</span></div>`;
    const step=runActive?3:(s.preview?2:1);
    const steps=view==='records'?'':`<ol class="ct-steps">${[['粘贴',view==='complaint'?'订单号':'旺旺昵称'],['预览校验',view==='complaint'?'按买家分组':'自动关联订单'],['自动提交','逐条执行']].map(([title,sub],index)=>`<li class="${step>index+1?'done':step===index+1?'on':''}"><i>${step>index+1?'✓':index+1}</i>${title}<small>${sub}</small></li>`).join('')}</ol>`;
    // —— 设置（异常订单投诉）——
    const complaintSettings=`<section class="ct-card">
      <h3>${svg('complaint')}投诉设置</h3>
      <p class="ct-hint">与营商保「我要投诉 → 手动填写投诉单」一致，整批共用同一设置。投诉类型固定为「异常订单」。</p>
      <div class="ct-field"><label>具体场景</label><div class="ct-chips">${scenes.map(item=>`<button type="button" class="${s.scene===item.code?'on':''}" data-action="ct-scene" data-value="${esc(item.code)}">${esc(item.name)}</button>`).join('')}</div></div>
      <div class="ct-field"><label><em>*</em>投诉订单<small>每行一个，或用逗号/空格分隔，自动去重；仅限近 90 天订单</small></label>
        <textarea id="ct-orders" class="ct-paste" rows="8" placeholder="粘贴订单号，例如：\n5127298563347022422">${esc(s.orders||'')}</textarea>
        <div class="ct-parse"><span>识别 <b class="ct-orders-valid">${count(parsedOrders.valid.length)}</b> 个订单</span><span>重复 <b class="ct-orders-dup">${count(parsedOrders.duplicates.length)}</b></span><span class="${parsedOrders.invalid.length?'bad':''}">格式错误 <b class="ct-orders-bad">${count(parsedOrders.invalid.length)}</b></span></div></div>
      <div class="ct-field"><label><em>*</em>投诉描述</label><textarea id="ct-desc" class="ct-desc" rows="3" placeholder="说明买家的异常行为，平台审核会看这段描述">${esc(s.desc||'')}</textarea></div>
      <div class="ct-field"><label>旺旺举证</label><div class="ct-note">${svg('info')}<span><b>该场景平台要求必填</b>，提交时会勾选「授权小二查看近 90 天旺旺聊天记录」。</span></div></div>
      <div class="ct-actions"><span class="ct-grow"></span>${button(`解析并预览（${count(parsedOrders.valid.length)} 单）`,'ct-preview',{primary:true,disabled:busy||!parsedOrders.valid.length||!String(s.desc||'').trim(),permission:'workbench.marketing.complaint.preview'})}</div>
    </section>`;
    const complaintRules=`<section class="ct-card ct-rules">
      <h3>${svg('info')}场景说明（来自营商保）</h3>
      <h4>场景解释</h4>
      <p>消费者针对同一个店铺/多个店铺，存在批量付款后退款/商家发货后频繁故意拒收/恶意退回商品，实际不以真实购买为目的。</p>
      <h4>审核标准（需同时满足）</h4>
      <ul><li>消费者无真实购买意愿，批量付款后立即批量申请退款，或商家发货后批量故意拒收、批量退回商品</li><li>核实订单对应的消费者涉及同一个群体（如同账号、收货信息等）</li></ul>
      <h4>投诉成功处置点</h4>
      <p>如审核成立，可获得如关闭订单、投诉免责、剔除店铺体验分等保护点，以最终审核结果为准。</p>
      <div class="ct-safe">${svg('info')}<span><b>投诉提交后不能撤回。</b>请确认订单与描述真实；执行前会先预览整批内容，由你确认后再提交。</span></div>
    </section>`;
    // —— 设置（账号打标）——
    const tagSettings=`<section class="ct-card">
      <h3>${svg('complaint')}打标设置</h3>
      <p class="ct-hint">与营商保「账号打标 → 我要打标」一致；一批使用同一类型和场景，不同类型请分批执行。</p>
      <div class="ct-field"><label>打标类型</label>
        <div class="ct-chips">${tagTypes.map(type=>`<button type="button" class="${s.tagType===type.code?'on':''}" data-action="ct-tag-type" data-value="${esc(type.code)}">${esc(type.name)}</button>`).join('')}</div>
        <div class="ct-chips sub">${arr(tagType.scenes).map(scene=>`<button type="button" class="${s.tagScene===scene.code?'on':''}" data-action="ct-tag-scene" data-value="${esc(scene.code)}">${esc(scene.name)}</button>`).join('')}</div></div>
      <div class="ct-field"><label><em>*</em>买家旺旺昵称<small>每行一个，自动去重；需要完整昵称，不能是 t**6 这种打码昵称</small></label>
        <textarea id="ct-nicks" class="ct-paste" rows="8" placeholder="粘贴买家旺旺昵称，每行一个">${esc(s.nicks||'')}</textarea>
        <div class="ct-parse"><span>识别 <b class="ct-nicks-valid">${count(parsedNicks.valid.length)}</b> 个账号</span><span>重复 <b class="ct-nicks-dup">${count(parsedNicks.duplicates.length)}</b></span><span class="${parsedNicks.invalid.length?'bad':''}">无效 <b class="ct-nicks-bad">${count(parsedNicks.invalid.length)}</b></span></div></div>
      <div class="ct-field"><label>关联订单</label><div class="ct-note">${svg('info')}<span>自动选择该买家<b>最近一笔未打标</b>的订单；找不到订单的账号不会提交</span></div></div>
      <div class="ct-actions"><span class="ct-grow"></span>${button(`解析并预览（${count(parsedNicks.valid.length)} 个）`,'ct-preview',{primary:true,disabled:busy||!parsedNicks.valid.length,permission:'workbench.marketing.complaint.preview'})}</div>
    </section>`;
    const tagRules=`<section class="ct-card ct-rules">
      <h3>${svg('info')}账号打标说明</h3>
      <p>账号打标是标记异常买家账号的轻量工具，无需举证即可向平台反馈异常行为。</p>
      <h4>批量方式</h4>
      <ul><li>后台只能一个一个提交，这里粘贴一批后自动逐个提交</li><li>开始前会检查店铺是否已通过营商保打标测评，没通过会提醒先去考试并停止任务</li><li>遇到验证码 / 滑块会暂停，处理后点「继续」</li></ul>
      <div class="ct-safe">${svg('info')}<span><b>打标提交后不能撤回。</b>执行前会列出全部账号和关联订单，确认后再开始。</span></div>
    </section>`;
    // —— 预览（异常订单投诉）——
    let complaintPreview='';
    if(s.preview&&s.preview.mode==='complaint'){
      const preview=s.preview,excluded=s.excluded,ordersById=new Map(arr(preview.orders).map(order=>[order.orderId,order]));
      const groups=arr(preview.groups).map(group=>({...group,orderIds:group.orderIds.filter(id=>!excluded.has(id))})).filter(group=>group.orderIds.length);
      const totals=new Map();for(const group of arr(preview.groups))totals.set(group.buyerKey,(totals.get(group.buyerKey)||0)+group.orderIds.length);
      const multiKeys=new Set([...totals.entries()].filter(([key,total])=>total>1&&String(key).startsWith('nick:')).map(([key])=>key));
      const multiBuyers=[...totals.entries()].filter(([key,total])=>total>1&&String(key).startsWith('nick:')).length;
      const notAllow=arr(preview.orders).filter(order=>!order.allowComplaint);
      const quota=preview.availableQuota;
      const submitOrders=groups.reduce((sum,group)=>sum+group.orderIds.length,0);
      const groupRows=groups.map(group=>`<div class="ct-group"><div class="ct-group-head"><span class="ct-avatar">${esc(String(group.buyerNick||'?').slice(0,1))}</span><b>买家 ${esc(group.buyerNick||'未知买家')}</b><span class="ct-sub-inline">${String(group.buyerKey||'').startsWith('nick:')?(multiKeys.has(group.buyerKey)?'已核对 · 同一买家多单':'本批只有这一单'):'未能核对买家 · 单独投诉'}</span><span class="ct-tag">→ 1 张投诉单（${count(group.orderIds.length)} 单）</span></div>
        <table class="ct-table"><thead><tr><th>订单号</th><th>商品</th><th>金额</th><th>下单时间</th><th></th></tr></thead><tbody>
          ${group.orderIds.map(orderId=>{const order=ordersById.get(orderId)||{};return `<tr><td class="mono">${esc(orderId)}</td><td class="ct-item">${order.itemImageUrl?`<img alt="" src="${esc(order.itemImageUrl)}_60x60.jpg">`:''}<span>${esc(order.itemTitle||'')}</span></td><td>${fenMoney(order.totalFeeFen)}</td><td>${esc(order.orderTime||'')}</td><td><button type="button" class="ct-link" data-action="ct-exclude" data-order="${esc(orderId)}">移除</button></td></tr>`;}).join('')}
        </tbody></table></div>`).join('');
      const blockedRows=[...notAllow.map(order=>`<tr><td class="mono">${esc(order.orderId)}</td><td>${esc(order.buyerNick||'—')}</td><td colspan="2"><span class="ct-status skip">${esc(order.notAllowLabel)}</span></td></tr>`),...arr(preview.notFoundOrderIds).map(id=>`<tr><td class="mono">${esc(id)}</td><td>—</td><td colspan="2"><span class="ct-status bad">近 90 天未找到，可能不是本店订单或已超期</span></td></tr>`)].join('');
      complaintPreview=`<section class="ct-card">
        <div class="ct-kpis">
          <div><span>识别订单</span><b>${count(arr(preview.orders).length+arr(preview.notFoundOrderIds).length)}</b></div>
          <div class="accent"><span>将提交投诉单</span><b>${count(groups.length)}</b></div>
          <div class="warn"><span>不能投诉（已投诉等）</span><b>${count(notAllow.length)}</b></div>
          <div class="bad"><span>未找到订单</span><b>${count(arr(preview.notFoundOrderIds).length)}</b></div>
          <div><span>剩余投诉额度</span><b>${quota==null?'—':count(quota)}</b></div>
        </div>
        <p class="ct-hint">类型「异常订单 / ${esc(preview.sceneName)}」。同一买家（未打码昵称一致）才合并成一张投诉单（每张最多 20 单）；打码昵称（t**6 这类）会撞码，按单条分别提交，不做合并。</p>
        <div class="ct-filter-bar"><span>同一买家多次下单 <b>${count(multiBuyers)}</b> 位，更符合「同一群体」审核标准</span><button type="button" class="ct-btn small" data-action="ct-keep-multi" ${multiBuyers?'':'disabled'}>只保留同一买家多单</button><button type="button" class="ct-btn small" data-action="ct-restore-all" ${excluded.size?'':'disabled'}>恢复全部</button></div>
        ${quota!=null&&groups.length>quota?`<div class="ct-alert bad">${svg('info')}<span>投诉额度不足：剩余 ${count(quota)} 次，本批 ${count(groups.length)} 张投诉单。请移除部分订单后再提交。</span></div>`:''}
        ${groupRows||'<div class="ct-empty">没有可以投诉的订单</div>'}
        ${blockedRows?`<div class="ct-group"><div class="ct-group-head"><b>不会提交</b></div><table class="ct-table"><tbody>${blockedRows}</tbody></table></div>`:''}
        <div class="ct-actions ct-sticky-bar">
          ${button('取消','ct-preview-cancel',{small:true})}
          ${button('返回修改','ct-preview-back',{small:true})}
          <span class="ct-sticky-summary">将提交 <b>${count(groups.length)}</b> 张 · ${count(submitOrders)} 单 · 剩余额度 <b>${quota==null?'—':count(quota)}</b></span>
          <span class="ct-gap">间隔<input type="number" min="2" max="60" class="ct-gap-min" data-action="ct-gap" data-which="min" value="${esc(String(s.gapMin))}">–<input type="number" min="2" max="60" class="ct-gap-max" data-action="ct-gap" data-which="max" value="${esc(String(s.gapMax))}">秒</span>
          ${button(`确认提交 ${count(groups.length)} 张投诉单`,'ct-start',{primary:true,disabled:busy||!groups.length||(quota!=null&&groups.length>quota),permission:'workbench.marketing.complaint.execute'})}
        </div>
      </section>`;
    }
    // —— 预览（账号打标）——
    let tagPreview='';
    if(s.preview&&s.preview.mode==='tag'){
      const preview=s.preview,excluded=s.excluded;
      const ready=arr(preview.nicks).filter(nick=>nick.status==='ready'&&!excluded.has(nick.buyerNick));
      tagPreview=`<section class="ct-card">
        <div class="ct-kpis">
          <div><span>识别账号</span><b>${count(arr(preview.nicks).length)}</b></div>
          <div class="accent"><span>将打标</span><b>${count(ready.length)}</b></div>
          <div class="warn"><span>已打标过</span><b>${count(arr(preview.nicks).filter(nick=>nick.status==='already-tagged').length)}</b></div>
          <div class="bad"><span>找不到订单</span><b>${count(arr(preview.nicks).filter(nick=>nick.status==='no-order').length)}</b></div>
        </div>
        <p class="ct-hint">类型「${esc(preview.typeName)} / ${esc(preview.sceneName)}」；每个账号自动关联最近一笔未打标订单。</p>
        <table class="ct-table"><thead><tr><th>#</th><th>买家旺旺</th><th>自动关联订单</th><th>预检</th><th></th></tr></thead><tbody>
          ${arr(preview.nicks).map((nick,index)=>{const removed=excluded.has(nick.buyerNick);return `<tr class="${removed?'off':''}"><td>${index+1}</td><td><b>${esc(nick.buyerNick)}</b></td><td class="mono">${esc(nick.orderId||'—')}</td><td>${nick.status==='ready'?'<span class="ct-status ok">可打标</span>':nick.status==='already-tagged'?'<span class="ct-status skip">该买家订单都已打标过</span>':'<span class="ct-status bad">未找到该买家订单</span>'}</td><td>${nick.status==='ready'?`<button type="button" class="ct-link" data-action="ct-exclude" data-nick="${esc(nick.buyerNick)}">${removed?'恢复':'移除'}</button>`:''}</td></tr>`;}).join('')}
        </tbody></table>
        <div class="ct-actions ct-sticky-bar">
          ${button('取消','ct-preview-cancel',{small:true})}
          ${button('返回修改','ct-preview-back',{small:true})}
          <span class="ct-sticky-summary">将打标 <b>${count(ready.length)}</b> 个账号</span>
          <span class="ct-gap">间隔<input type="number" min="2" max="60" class="ct-gap-min" data-action="ct-gap" data-which="min" value="${esc(String(s.gapMin))}">–<input type="number" min="2" max="60" class="ct-gap-max" data-action="ct-gap" data-which="max" value="${esc(String(s.gapMax))}">秒</span>
          ${button(`确认打标 ${count(ready.length)} 个账号`,'ct-start',{primary:true,disabled:busy||!ready.length,permission:'workbench.marketing.complaint.execute'})}
        </div>
      </section>`;
    }
    // —— 执行面板 ——
    let runPanel='';
    if(run){
      const items=arr(run.items);
      const finished=items.filter(item=>['succeeded','failed','skipped'].includes(item.status)).length;
      const okCount=items.filter(item=>item.status==='succeeded').length;
      const failCount=items.filter(item=>item.status==='failed').length;
      const pct=items.length?Math.round(finished/items.length*100):0;
      const stateText={running:'正在执行…',paused:'已暂停',challenge:'等待安全验证',stopped:'已停止',completed:'已完成',blocked:'已停止'}[run.state]||run.state;
      const itemStatus=status=>({queued:['wait','排队中'],running:['run','提交中'],succeeded:['ok','已提交'],failed:['bad','失败'],skipped:['skip','未提交']}[status]||['wait',status]);
      runPanel=`<section class="ct-card">
        ${run.state==='challenge'?`<div class="ct-alert warn strong">${svg('info')}<div><b>${esc(run.notice||'营商保出现安全验证，已暂停')}</b><span>已提交的不受影响。</span></div><span class="ct-grow"></span>${button('打开验证窗口','ct-open-window',{small:true,permission:'workbench.marketing.complaint.execute'})}${button('我已完成验证，继续','ct-control',{small:true,primary:true,attrs:'data-value="resume"',permission:'workbench.marketing.complaint.execute'})}</div>`:''}
        ${run.state==='blocked'||(run.state==='stopped'&&run.notice)?`<div class="ct-alert bad strong">${svg('info')}<div><b>任务已停止</b><span>${esc(run.notice||'')}</span></div></div>`:''}
        ${run.state==='completed'?`<div class="ct-alert ok strong">${svg('info')}<div><b>本批执行完成</b><span>成功 ${count(okCount)} · 失败 ${count(failCount)} · 结果已保存到「执行记录」</span></div></div>`:''}
        <div class="ct-run-head"><div><b>${esc(stateText)}</b><small>${esc(run.sceneName||'')} · ${count(finished)} / ${count(items.length)} · 成功 ${count(okCount)} · 失败 ${count(failCount)}</small></div><div class="ct-progress"><i style="width:${pct}%"></i></div><span class="ct-percent">${pct}%</span>
          ${runActive?`${run.state==='paused'?button('继续','ct-control',{small:true,attrs:'data-value="resume"',permission:'workbench.marketing.complaint.execute'}):button('暂停','ct-control',{small:true,disabled:run.state==='challenge',attrs:'data-value="pause"',permission:'workbench.marketing.complaint.execute'})}${button('停止','ct-control',{small:true,danger:true,attrs:'data-value="stop"',permission:'workbench.marketing.complaint.execute'})}`:button('再来一批','ct-dismiss-run',{small:true,primary:true})}
        </div>
        <table class="ct-table"><thead><tr><th>#</th><th>${run.kind==='complaint'?'买家 / 订单':'买家旺旺 / 关联订单'}</th><th>状态</th><th>结果</th></tr></thead><tbody>
          ${items.map((item,index)=>{const [cls,label]=itemStatus(item.status);return `<tr><td>${index+1}</td><td><b>${esc(item.buyerNick)}</b><span class="ct-sub mono">${esc(arr(item.orderIds).slice(0,3).join('、'))}${arr(item.orderIds).length>3?` 等 ${count(arr(item.orderIds).length)} 单`:''}</span></td><td><span class="ct-status ${cls}">${label}</span></td><td class="${item.status==='failed'?'bad-text':'muted'}">${esc(item.message||'')}</td></tr>`;}).join('')}
        </tbody></table>
      </section>`;
    }
    // —— 执行记录 ——
    const filteredRecords=records.filter(record=>s.filter==='all'||(s.filter==='failed'?record.status==='failed':record.kind===s.filter));
    const recordsPanel=`<section class="ct-card">
      <div class="ct-records-head"><h3>${svg('clock')}执行记录</h3><span class="ct-hint">保存在本机，按店铺区分；投诉审核结果请到营商保「投诉记录」查看</span><span class="ct-grow"></span><div class="ct-chips">${[['all','全部'],['complaint','投诉'],['tag','打标'],['failed','失败']].map(([id,label])=>`<button type="button" class="${s.filter===id?'on':''}" data-action="ct-records-filter" data-value="${id}">${label}</button>`).join('')}</div></div>
      ${filteredRecords.length?table(['时间','类型','买家','订单','场景','状态','结果 / 原因'],filteredRecords.slice(0,500).map(record=>`<tr><td class="nowrap">${esc(dateTime(record.createdAt))}</td><td><span class="ct-status ${record.kind==='complaint'?'run':'wait'}">${record.kind==='complaint'?'投诉':'打标'}</span></td><td>${esc(record.buyerNick||'')}</td><td class="mono">${esc(arr(record.orderIds).slice(0,2).join('、'))}${arr(record.orderIds).length>2?` 等 ${count(arr(record.orderIds).length)} 单`:''}</td><td>${esc(record.sceneName||'')}</td><td><span class="ct-status ${record.status==='succeeded'?'ok':'bad'}">${record.status==='succeeded'?'已提交':'失败'}</span></td><td class="${record.status==='failed'?'bad-text':''}">${esc(record.message||'')}</td></tr>`).join('')):empty('还没有执行记录','投诉 / 打标 的提交结果会保存在这里，按店铺区分。','','clock')}
    </section>`;
    let content;
    if(view==='records')content=recordsPanel;
    else if(run)content=runPanel;
    else if(s.preview)content=s.preview.mode==='complaint'?complaintPreview:tagPreview;
    else content=`<div class="ct-grid"><div class="ct-main">${view==='complaint'?complaintSettings:tagSettings}</div><div class="ct-side">${view==='complaint'?complaintRules:tagRules}</div></div>`;
    return marketingTabs()+
      heading('投诉打标','营商保「异常订单投诉 / 账号打标」批量执行：先预览校验，再逐条提交；提交后不能撤回。')+
      `<div class="purchase-notice-row">${notice(`流程：粘贴${view==='complaint'?'订单号':'旺旺昵称'} → 解析并预览（${view==='complaint'?'按买家分组':'自动关联订单'}）→ 确认后逐条提交。账号打标需先通过营商保测评；遇到验证码 / 滑块会暂停，处理完点「继续」。`)}<div class="notice-actions">${button('打开营商保页面','ct-open-window',{small:true,icon:'store'})}</div></div>`+
      tabs+steps+content;
  }

  function qualification() {
    const d=moduleData('qualification'),all=arr(d.products||d.items),query=(state.search.qualification||'').toLowerCase();
    const filtered=all.filter(p=>!query||`${p.title||p.name||''} ${p.itemId||p.id||''}`.toLowerCase().includes(query));const page=paginate(filtered,'qualification');
    return heading('标签资质','选择商品对应的真实标签图片，检查后上传到天猫商品资料。',button('导入商品表','qualification-import',{icon:'folder'})+button('导出结果','export',{icon:'export',attrs:'data-module="qualification"',disabled:!all.length}))+
      notice('此版本使用本地真实图片，不提供 AI 生成资质。上传会修改商品资料；请确认图片属于对应商品，提交前再次核对商品 ID。')+
      panel('商品标签资料','导入表包含商品 ID 与商品名称；图片逐个选择，支持准备好后批量提交。',`<div class="filterbar"><span class="inline-note">${count(all.length)} 个商品</span><input class="search-input" data-search="qualification" value="${esc(state.search.qualification||'')}" placeholder="搜索商品名称 / ID" aria-label="搜索标签商品"></div>${table(['商品','商品 ID','本地标签图片','上传状态','操作'],page.rows.map(product=>{
        const id=String(product.itemId||product.id||product.productId||''),image=product.image||product.localImage||product.generatedImage;const imageName=product.imageName||image?.name||image?.fileName||image?.path||product.imagePath;
        return `<tr><td class="title-cell"><span class="cell-main">${esc(product.title||product.name||product.productTitle||'未提供名称')}</span></td><td class="mono">${esc(id)}</td><td>${image||imageName?`${badge('已选择','good')}<span class="cell-sub">${esc(String(imageName||'本地图片').split(/[\\/]/).pop())}</span>`:badge('未选择图片')}</td><td>${statusBadge(product.uploadStatus||product.status||'not-uploaded')}${product.message||product.error||product.errorReason?`<span class="cell-sub">${esc(product.message||product.error||product.errorReason)}</span>`:''}</td><td><div class="table-actions">${button('选择真实图片','qualification-image',{small:true,attrs:`data-id="${esc(id)}"`})}${button('预览','qualification-preview',{small:true,attrs:`data-id="${esc(id)}"`,disabled:!(image||imageName)})}${button('上传','qualification-upload',{small:true,attrs:`data-id="${esc(id)}"`,disabled:!(image||imageName)})}</div></td></tr>`;
      }).join(''),empty('先导入需要处理的商品','导入商品表后，为每个商品选择对应的本地标签图片。不会自动生成或填入图片。',button('导入商品表','qualification-import',{primary:true,icon:'folder'}),'qualification'))}${all.length?page.footer:''}`,button('上传已备图商品','qualification-upload',{primary:true,small:true,disabled:!all.some(p=>p.image||p.localImage||p.generatedImage||p.imagePath)}))+
      logsPanel(d.logs,'上传记录');
  }
  // 违规排查（参考同类工作台）：四个板块是主功能，页签放到顶栏；导入/词库等操作留在各板块页面里。
  // 违规排查（参考同类工作台）：四个板块是主功能，页签放到顶栏；导入/词库等操作留在各板块页面里。
  function compliance() {
    const d=moduleData('compliance'),jobs=arr(d.jobs),job=d.job||null,view=['scan','process','rules','billing'].includes(state.complianceView)?state.complianceView:'scan',busy=state.busy.has('compliance.scan')||d.running||d.busy;
    const billing=d.billing||{};
    const unitPrice=Number.isFinite(Number(billing.unitPrice))?Number(billing.unitPrice):0.01;
    const money=value=>`¥${Number(value||0).toFixed(2)}`;
    const rate=value=>`¥${Number(value||0).toFixed(3)}`;
    const shortAt=value=>{if(!value)return '—';const date=new Date(value);if(Number.isNaN(date.getTime()))return String(value);const pad=number=>String(number).padStart(2,'0');return `${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;};
    const shortId=value=>`#${String(value||'').replace(/[^0-9a-zA-Z]/g,'').slice(0,6).toUpperCase()||'—'}`;
    const jobStatus=item=>{const map={ready:['待扫描',''],scanning:['扫描中','warn'],paused:['已停止','warn'],completed:['已完成','good'],failed:['失败','bad']};const [text,tone]=map[item.status]||[item.status||'待扫描',''];return `<span class="badge ${tone}"><i class="badge-dot"></i>${esc(text)}</span>`;};
    const riskChip=(level,value)=>`<span class="risk-chip ${level}">${esc(String(value||0))}</span>`;
    const riskText=(item,key,label)=>`<span class="risk-text ${key}">${label} ${esc(String(item[key]||0))}</span>`;
    const jobPercent=item=>{const processed=Number(item.progress?.processed||0),total=Number(item.progress?.total||item.productCount||0);return total?Math.min(100,Math.round(processed/total*100)):0;};
    // 扫描中的剩余时间：用最近的进度事件估算（事件不足时显示“计算中”）。
    const etaText=(item,{live=false}={})=>{
      if(item.status==='completed')return '扫描完成';
      if(item.status==='failed')return '扫描失败';
      if(item.status==='paused')return '已停止，可继续扫描';
      if(item.status!=='scanning'&&!live)return '尚未开始';
      const sample=state.complianceRate;
      if(!sample||sample.jobId!==String(item.id))return '预计剩余时间计算中';
      const processed=sample.lastCurrent-sample.startCurrent,elapsed=(sample.lastAt-sample.startedAt)/1000,total=sample.total||Number(item.productCount||0);
      if(processed<=0||elapsed<3||!total)return '预计剩余时间计算中';
      const remaining=(total-sample.lastCurrent)*(elapsed/processed);
      if(!Number.isFinite(remaining)||remaining<=0)return '即将完成';
      if(remaining<60)return `预计剩余约 ${Math.max(1,Math.round(remaining))} 秒`;
      if(remaining<3600)return `预计剩余约 ${Math.round(remaining/60)} 分钟`;
      return `预计剩余约 ${(remaining/3600).toFixed(1)} 小时`;
    };
    const jobActions=(item,history)=>[
      history?button('打开结果','compliance-job-process',{small:true,attrs:`data-job="${esc(item.id)}"`}):button('查看已发现','compliance-job-process',{small:true,attrs:`data-job="${esc(item.id)}"`}),
      item.status==='completed'?button('重新扫描','compliance-job-scan',{small:true,disabled:busy,attrs:`data-job="${esc(item.id)}"`,permission:'workbench.compliance.scan'}):button(item.status==='paused'||item.status==='scanning'?'继续扫描':'开始扫描','compliance-job-scan',{small:true,primary:true,disabled:busy,attrs:`data-job="${esc(item.id)}"`,permission:'workbench.compliance.scan'}),
      button('导出报告','compliance-export',{small:true,attrs:`data-job="${esc(item.id)}" data-filter="all"`,permission:'workbench.compliance.export'}),
      busy?'':button('删除','compliance-job-delete',{small:true,attrs:`data-job="${esc(item.id)}"`})
    ].join('');
    const jobRows=(list,selectedJobId,history)=>list.map(item=>{
      const processed=Number(item.progress?.processed||0),total=Number(item.progress?.total||item.productCount||0),pct=jobPercent(item);
      const storeLabel=item.storeName?esc(item.storeName):'无';
      return `<tr class="${item.id===selectedJobId?'highlight':''}" data-action="compliance-job-select" data-id="${esc(item.id)}"><td class="title-cell"><span class="cell-main">${esc(item.sourceFile||item.name)}</span><button type="button" class="link-button job-store" title="点击修改店铺名（默认取表格第一列的“店铺名/旺旺名称”）" data-action="compliance-job-rename" data-id="${esc(item.id)}" data-name="${esc(item.storeName||'')}">${storeLabel}</button></td><td class="mono">${esc(shortId(item.id))}</td><td class="mono">${count(item.productCount)}</td><td class="mono">${count(processed)}</td><td class="nowrap"><span class="cell-main">${count(item.uniqueImageCount)} 张</span><span class="cell-sub">去重 / 总 ${count(item.imageCount)}</span></td><td class="nowrap"><span class="cell-main mono">${rate(item.actualCost)}</span><span class="cell-sub">预计 ${rate(item.estimatedCost)}</span></td><td class="nowrap">${jobStatus(item)}<span class="cell-sub job-risk-line">${riskText(item,'high','高')} ${riskText(item,'medium','中')} ${riskText(item,'low','低')} ${riskText(item,'issueCount','合')}</span></td><td><div class="cell-progress">${pct}%</div><div class="progress-line"><i style="width:${pct}%"></i></div><span class="cell-sub">${count(processed)} / ${count(total)} 行 · ${esc(etaText(item))}</span></td><td class="nowrap">${esc(shortAt(item.createdAt))}</td><td class="nowrap">${item.finishedAt?esc(shortAt(item.finishedAt)):'—'}</td><td class="nowrap"><div class="risk-counts">${riskChip('high',item.high)}${riskChip('medium',item.medium)}${riskChip('low',item.low)}${riskChip('total',item.issueCount)}</div></td><td class="nowrap">${jobActions(item,history)}</td></tr>`;
    }).join('');
    const jobTable=(list,selectedJobId,history,emptyContent)=>table(['文件 / 店铺','任务ID','总行数','已扫描','图片数','费用','状态','进度','创建时间','完成时间','问题','操作'],jobRows(list,selectedJobId,history),emptyContent);
    const tabs=`<div class="segmented compliance-tabs" role="tablist">${[['scan','违规扫描'],['process','违规处理中心'],['rules','违规管理库'],['billing','计费中心']].map(([id,label])=>`<button type="button" data-action="compliance-view" data-view="${id}" class="${view===id?'active':''}" ${view===id?'aria-current="page"':''}>${esc(label)}</button>`).join('')}</div>`;
    const head=heading('违规排查','违规扫描 · 违规处理中心 · 违规管理库 · 计费中心');
    const progress=state.progress&&state.progress['compliance:']||null;
    // 扫描中的实时信息统一放在“实时扫描进度”卡片里，这里只保留一行状态提示（避免两个“停止扫描”）。
    const progressLine=progress&&!jobs.some(item=>item.status==='scanning')&&!busy?`<div class="compliance-progress">${badge(progress.done?'已完成':'扫描中',progress.done?'good':'warn')}<span class="clip">${esc(progress.message||'')}</span>${Number.isFinite(Number(progress.total))&&Number(progress.total)>0?`<strong>${esc(String(progress.current||0))} / ${esc(String(progress.total))}</strong>`:''}</div>`:'';
    const jobBadgeWithCount=(label,countValue)=>`${esc(label)} <span class="badge brand">${esc(String(countValue||0))}</span>`;
    const livePanel=(()=>{
      const running=jobs.filter(item=>item.status==='scanning');
      const selected=job||jobs.find(entry=>entry.id===d.selectedJobId)||null;
      const liveJob=running[0]||(busy?selected:null);
      if(!liveJob&&!progress)return '';
      const item=liveJob||{};
      const rowsTotal=Number(item.productCount||0),rowsDone=Number(item.progress?.processed||0);
      const imagesTotal=Number(item.uniqueImageCount||0),imagesDone=Number(progress?.current||item.recognizedImageCount||0);
      // 图片识别阶段（先跑）和逐行核对阶段的进度分开显示，避免把“第 2 张图片”写成“第 2 行”。
      const imagePhase=/识别图片/.test(String(progress?.message||''))||(!rowsDone&&imagesDone>0);
      const pct=imagePhase?(imagesTotal?Math.min(100,Math.round(imagesDone/imagesTotal*100)):0):(rowsTotal?Math.min(100,Math.round(rowsDone/rowsTotal*100)):0);
      const headLine=[item.storeName||'',item.id?`任务 ID ${shortId(item.id)}`:''].filter(Boolean).join(' · ')||esc(progress?.message||'正在准备');
      const meta=imagePhase?`正在识别图片 ${count(imagesDone)} / ${count(imagesTotal)} · ${esc(etaText(item,{live:true}))}`:`${count(rowsDone)} / ${count(rowsTotal)} 行 · ${esc(etaText(item,{live:true}))}`;
      return panel('实时扫描进度',`${count(running.length||1)} 个任务运行中`,`<div class="live-scan"><div class="live-scan-head"><strong>${esc(item.sourceFile||item.name||'扫描任务')}</strong><span>${esc(headLine)}</span></div><div class="live-scan-bar"><div class="progress-line wide"><i style="width:${pct}%"></i></div><span class="live-scan-pct">${pct}%</span></div><div class="live-scan-meta">${meta}</div><div class="live-scan-foot"><span>已识别图片 ${count(item.recognizedImageCount||imagesDone)} / ${count(imagesTotal)}</span><b>${rate(item.actualCost||0)}</b></div></div>`,busy?button('停止扫描','compliance-cancel',{small:true}):'');
    })();

    if(view==='scan'){
      const queue=jobs.filter(item=>!['completed','failed'].includes(item.status));
      const history=jobs.filter(item=>['completed','failed'].includes(item.status));
      const filters=state.complianceJobFilter||(state.complianceJobFilter={status:'all',risk:'all'});
      const query=String(state.search.complianceJob||'').toLowerCase();
      const matchJob=item=>{
        if(filters.status!=='all'&&item.status!==filters.status)return false;
        if(filters.risk==='high'&&!Number(item.high))return false;
        if(filters.risk==='medium'&&!Number(item.medium))return false;
        if(filters.risk==='low'&&!Number(item.low))return false;
        if(!query)return true;
        return [item.name,item.sourceFile,item.storeName].some(value=>String(value||'').toLowerCase().includes(query));
      };
      const queueList=queue.filter(matchJob),historyList=history.filter(matchJob);
      const totalIssues=jobs.reduce((sum,item)=>sum+Number(item.issueCount||0),0);
      const highTotal=jobs.reduce((sum,item)=>sum+Number(item.high||0),0);
      const mediumTotal=jobs.reduce((sum,item)=>sum+Number(item.medium||0),0);
      const lowTotal=jobs.reduce((sum,item)=>sum+Number(item.low||0),0);
      const selectedJobId=job?.id||d.selectedJobId||null;
      const stripJob=job||jobs[0]||null;
      const statusFilters=[['all','全部'],['ready','待扫描'],['scanning','扫描中'],['paused','已停止'],['completed','已完成'],['failed','失败']];
      const filterBar=`<div class="compliance-toolbar">${statusFilters.map(([value,label])=>`<button type="button" class="filter-chip${filters.status===value?' active':''}" data-action="compliance-job-filter" data-field="status" data-value="${value}">${label}</button>`).join('')}<input class="search-input" data-search="complianceJob" value="${esc(state.search.complianceJob||'')}" placeholder="搜索文件 / 店铺 / 任务 ID" aria-label="搜索排查任务"><select class="compliance-select" data-compliance-job-filter="risk" aria-label="按风险筛选任务"><option value="all" ${filters.risk==='all'?'selected':''}>全部风险</option><option value="high" ${filters.risk==='high'?'selected':''}>仅高危</option><option value="medium" ${filters.risk==='medium'?'selected':''}>仅中危</option><option value="low" ${filters.risk==='low'?'selected':''}>仅低危</option></select></div>`;
      const billingNote=`<div class="compliance-billing-note">${svg('info')}<span>任务计费 · 文本检测免费，图片检测 ${rate(unitPrice)} / 张。${stripJob?`所选任务预计图片 ${count(stripJob.imageCount)} 张，去重后 ${count(stripJob.uniqueImageCount)} 张，预计费用 ${rate(stripJob.estimatedCost)}。`:''}</span><span class="note-right">已识别图片数 <b>${count(stripJob?.recognizedImageCount||0)}</b><b>当前费用 ${rate(stripJob?.actualCost||0)}</b></span></div>`;
      const footerOf=(list,label)=>`<div class="table-footer"><span>共 ${count(list.length)} 个任务</span><span>${label}</span></div>`;
      return head+tabs+progressLine+
        `<div class="compliance-stat-cards">
          <div class="compliance-stat purple"><span class="cs-label">扫描队列</span><span class="cs-value">${count(queue.length)}</span><span class="cs-note">等待处理的任务</span></div>
          <div class="compliance-stat green"><span class="cs-label">扫描中</span><span class="cs-value">${count(jobs.filter(item=>item.status==='scanning').length)}</span><span class="cs-note">当前进行中的任务</span></div>
          <div class="compliance-stat plain"><span class="cs-label">历史任务</span><span class="cs-value">${count(history.length)}</span><span class="cs-note">累计已完成</span></div>
          <div class="compliance-stat red"><span class="cs-label">问题合计</span><span class="cs-value">${count(totalIssues)}</span><span class="cs-note">高危 ${count(highTotal)} · 中危 ${count(mediumTotal)} · 低危 ${count(lowTotal)}</span></div>
        </div>`+
        `<div class="compliance-dropzone"${cloudAuthUi?.hasPermission('workbench.compliance.import')?' data-action="compliance-import"':''}><span class="compliance-drop-icon">${svg('export')}</span><div><strong>拖拽 Excel / CSV 到此处导入</strong><p>支持 .xlsx / .xlsm / .csv · 无文件大小上限，后台分批导入</p></div>${button('选择文件','compliance-import',{primary:true,disabled:busy,permission:'workbench.compliance.import'})}</div>`+
        `<details class="compliance-disclosure"><summary>使用本机文件路径导入</summary><div class="disclosure-body"><input class="search-input" data-compliance-path placeholder="粘贴或输入 Excel / CSV 的完整路径，例如 D:\\表格\\商品.xlsx" aria-label="商品表格本机路径"><span class="disclosure-note">适合从固定目录批量重跑，不弹文件选择框。</span>${button('按路径导入','compliance-import-path',{small:true,primary:true,disabled:busy,permission:'workbench.compliance.import'})}</div></details>`+
        billingNote+filterBar+livePanel+
        panel(jobBadgeWithCount('扫描队列',queueList.length),'',jobTable(queueList,selectedJobId,false,empty('队列里没有任务','点击上方“选择文件”导入商品表格后出现在这里。','','folder'))+footerOf(queueList,'单击任务行可切换当前任务'))+
        panel(jobBadgeWithCount('扫描历史',historyList.length),'',historyList.length?jobTable(historyList,selectedJobId,true)+footerOf(historyList,'历史任务可打开结果或导出报告'):empty('暂无扫描历史','完成或失败的扫描任务会归档到这里。','','clock'))+
        `<details class="compliance-disclosure"><summary>本机报告保存路径 · 导出到指定路径</summary><div class="disclosure-body"><span class="disclosure-note">报告默认保存到本机导出目录，可在“设置 → 文件位置”里修改。</span>${jobs.length?button('导出最近任务报告','compliance-export',{small:true,attrs:`data-job="${esc(selectedJobId||'')}" data-filter="all"`,disabled:!selectedJobId,permission:'workbench.compliance.export'}):''}</div></details>`;
    }

    if(view==='process'){
      const all=arr(job?.issues);
      const filters=state.complianceFilter||(state.complianceFilter={risk:'all',source:'all',status:'all'});
      const query=String(state.search.compliance||'').toLowerCase();
      const filtered=all.filter(issue=>{
        if(filters.risk!=='all'&&issue.riskLevel!==filters.risk)return false;
        if(filters.source!=='all'&&issue.sourceKind!==filters.source)return false;
        if(filters.status!=='all'&&issue.status!==filters.status)return false;
        if(!query)return true;
        return [issue.productId,issue.productTitle,issue.term,issue.evidence,issue.ruleName].some(value=>String(value||'').toLowerCase().includes(query));
      });
      const page=paginate(filtered,'compliance');
      const group=state.complianceGroup==='product'?'product':'issue';
      const statusMeta={pending:['待处理','warn'],confirmed:['已确认违规','bad'],ignored:['已忽略',''],fixed:['已整改','good']};
      const riskMeta={high:['高风险','bad'],medium:['中风险','warn'],low:['低风险','brand']};
      if(!job){
        return head+tabs+progressLine+`<div class="compliance-stat-cards">
          <div class="compliance-stat plain"><span class="cs-label">高危</span><span class="cs-value">0</span><span class="cs-note">重点复核</span></div>
          <div class="compliance-stat plain"><span class="cs-label">中危</span><span class="cs-value">0</span><span class="cs-note">需要确认</span></div>
          <div class="compliance-stat plain"><span class="cs-label">低危</span><span class="cs-value">0</span><span class="cs-note">建议核对</span></div>
          <div class="compliance-stat purple"><span class="cs-label">合计</span><span class="cs-value">0</span><span class="cs-note">命中问题总数</span></div>
        </div>`+empty('还没有可以复核的任务','请先在“违规扫描”里导入并扫描商品表，命中的问题会进入违规处理中心。',button('去导入商品表格','compliance-import',{primary:true,icon:'folder',disabled:busy}),'compliance');
      }
      const selected=all.find(issue=>issue.id===state.complianceIssueId)||null;
      const picked=state.complianceIssueSelection instanceof Set?state.complianceIssueSelection:(state.complianceIssueSelection=new Set());
      const statusChips=[['all','全部'],['pending','待处理'],['confirmed','已确认违规'],['ignored','已忽略'],['fixed','已整改']].map(([value,label])=>`<button type="button" class="filter-chip${filters.status===value?' active':''}" data-action="compliance-filter" data-field="status" data-value="${value}">${label} <b>${esc(String(value==='all'?all.length:all.filter(issue=>issue.status===value).length))}</b></button>`).join('');
      // 一行排完：视图切换 + 状态筛选 + 风险/来源/导出 + 导出报告，搜索框用 margin-left:auto 顶到最右边（用户截图绿框位置）。
      const toolbar=`<div class="compliance-toolbar">
        <div class="segmented compliance-group"><button type="button" data-action="compliance-group" data-value="issue" class="${group==='issue'?'active':''}">按问题</button><button type="button" data-action="compliance-group" data-value="product" class="${group==='product'?'active':''}">按商品</button></div>
        ${statusChips}
        <select class="compliance-select" data-compliance-filter="risk" aria-label="按风险筛选"><option value="all" ${filters.risk==='all'?'selected':''}>全部风险</option><option value="high" ${filters.risk==='high'?'selected':''}>高风险</option><option value="medium" ${filters.risk==='medium'?'selected':''}>中风险</option><option value="low" ${filters.risk==='low'?'selected':''}>低风险</option></select>
        <select class="compliance-select" data-compliance-filter="source" aria-label="按来源筛选"><option value="all" ${filters.source==='all'?'selected':''}>全部来源</option><option value="text" ${filters.source==='text'?'selected':''}>表格文字</option><option value="ocr" ${filters.source==='ocr'?'selected':''}>图片识别</option></select>
        <select class="compliance-select" data-compliance-export="1" aria-label="导出问题"><option value="">导出全部问题 ▾</option><option value="all">导出全部问题</option><option value="pending">仅导出待处理</option><option value="high">仅导出高风险</option><option value="text">仅导出表格文字</option><option value="ocr">仅导出图片识别</option></select>
        ${button('导出报告','compliance-export',{primary:true,small:true,attrs:`data-job="${esc(job.id)}" data-filter="all"`})}
        <input class="search-input" data-search="compliance" value="${esc(state.search.compliance||'')}" placeholder="搜索商品标题 / 命中词 / 证据 / 商品 ID" aria-label="搜索违规问题">
      </div>`;
      const riskCountText=level=>all.filter(issue=>issue.riskLevel===level).length;
      const riskCards=`<div class="compliance-stat-cards">
        <div class="compliance-stat plain risk-high"><span class="cs-label">高危</span><span class="cs-value">${count(riskCountText('high'))}</span><span class="cs-note">重点复核</span></div>
        <div class="compliance-stat plain risk-medium"><span class="cs-label">中危</span><span class="cs-value">${count(riskCountText('medium'))}</span><span class="cs-note">需要确认</span></div>
        <div class="compliance-stat plain risk-low"><span class="cs-label">低危</span><span class="cs-value">${count(riskCountText('low'))}</span><span class="cs-note">建议核对</span></div>
        <div class="compliance-stat purple"><span class="cs-label">合计</span><span class="cs-value">${count(all.length)}</span><span class="cs-note">命中问题总数</span></div>
      </div>`;
      const issueActions=issue=>`<span class="nowrap">${button('确认','compliance-issue-status',{small:true,attrs:`data-job="${esc(job.id)}" data-issue="${esc(issue.id)}" data-status="confirmed"`})}${button('忽略','compliance-issue-status',{small:true,attrs:`data-job="${esc(job.id)}" data-issue="${esc(issue.id)}" data-status="ignored"`})}${button('整改','compliance-issue-status',{small:true,attrs:`data-job="${esc(job.id)}" data-issue="${esc(issue.id)}" data-status="fixed"`})}</span>`;
      const issueRow=issue=>{
        const [statusText,statusTone]=statusMeta[issue.status]||statusMeta.pending,[riskText2,riskTone]=riskMeta[issue.riskLevel]||riskMeta.medium;
        return `<tr class="${issue.id===state.complianceIssueId?'highlight':''}" data-action="compliance-issue-select" data-id="${esc(issue.id)}"><td class="select-col"><input type="checkbox" class="table-select" data-compliance-issue-select="${esc(issue.id)}" ${picked.has(issue.id)?'checked':''} aria-label="选择这条问题"></td><td class="title-cell"><span class="cell-main">${esc(issue.productTitle||'—')}</span><span class="cell-sub mono">${esc(issue.productId||'')}</span></td><td class="title-cell"><span class="cell-main">${esc(issue.term||'—')}</span><span class="cell-sub">${esc(issue.ruleName||'')}</span></td><td>${badge(riskText2,riskTone)}</td><td>${esc(issue.field||'—')}<span class="cell-sub">${issue.sourceKind==='ocr'?'图片识别':'表格文字'}</span></td><td>${badge(statusText,statusTone)}</td><td>${issueActions(issue)}</td></tr>`;
      };
      const allSelectedInFilter=filtered.length>0&&filtered.every(issue=>picked.has(issue.id));
      const selectAllHead=`<label class="select-all-head"><input type="checkbox" class="table-select" data-compliance-issue-select-all="1" ${allSelectedInFilter?'checked':''} aria-label="全选当前筛选的问题"><span>全选</span></label>`;
      const issueTableHtml=table([selectAllHead,'商品','命中词','风险','位置','状态','操作'],page.rows.map(issueRow).join(''),empty('没有符合条件的问题',all.length?'换一个筛选条件，或清空搜索。':'这次扫描没有命中违规词。','','compliance'))+(filtered.length?page.footer:'');
      const batchBar=picked.size?`<div class="compliance-batch-bar"><span>已选 <b>${esc(String(picked.size))}</b> 条（可批量改状态）</span><span class="spacer"></span>${button('确认违规','compliance-issue-batch',{small:true,primary:true,attrs:`data-job="${esc(job.id)}" data-status="confirmed"`})}${button('忽略','compliance-issue-batch',{small:true,attrs:`data-job="${esc(job.id)}" data-status="ignored"`})}${button('标记已整改','compliance-issue-batch',{small:true,attrs:`data-job="${esc(job.id)}" data-status="fixed"`})}${button('清除选择','compliance-issue-clear',{small:true})}</div>`:'';
      const grouped=new Map();
      for(const issue of filtered){const key=issue.productId||issue.productTitle||'—';if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(issue);}
      const productTableHtml=(()=>{
        if(!grouped.size)return table(['商品','命中词','风险','位置','状态','操作'],'',empty('没有符合条件的问题','换一个筛选条件，或清空搜索。','','compliance'));
        const rows=[...grouped.entries()].map(([key,list])=>{
          const top=list.find(issue=>issue.riskLevel==='high')||list.find(issue=>issue.riskLevel==='medium')||list[0];
          const [riskText3,riskTone]=riskMeta[top.riskLevel]||riskMeta.medium;
          const fields=[...new Set(list.map(issue=>issue.field||'—'))].slice(0,3).join('、');
          const open=state.complianceProductOpen===key;
          const main=`<tr class="${open?'highlight':''}"><td class="title-cell"><span class="cell-main">${esc(top.productTitle||'—')}</span><span class="cell-sub mono">${esc(top.productId||'')}</span></td><td class="title-cell"><span class="clip">${esc(list.map(issue=>issue.term).filter(Boolean).slice(0,4).join('、')||'—')}</span><span class="cell-sub">共 ${esc(String(list.length))} 条命中</span></td><td>${badge(riskText3,riskTone)}</td><td><span class="clip">${esc(fields||'—')}</span></td><td>${badge(`${list.filter(issue=>issue.status==='pending').length} 待处理 / 共 ${list.length}`,'warn')}</td><td><span class="nowrap">${button(open?'收起':'展开','compliance-product-expand',{small:true,attrs:`data-id="${esc(key)}"`})}</span></td></tr>`;
          if(!open)return main;
          const subs=list.map(issue=>{const [statusText,statusTone]=statusMeta[issue.status]||statusMeta.pending,[subRiskText,subRiskTone]=riskMeta[issue.riskLevel]||riskMeta.medium;return `<tr class="issue-sub"><td class="sub-indent">↳ ${esc(issue.term||'—')}</td><td class="cell-sub">${esc(issue.ruleName||'')}</td><td>${badge(subRiskText,subRiskTone)}</td><td>${esc(issue.field||'—')}</td><td>${badge(statusText,statusTone)}</td><td>${issueActions(issue)}</td></tr>`;}).join('');
          return main+subs;
        }).join('');
        return table(['商品','命中词','风险','位置','状态','操作'],rows);
      })();
      const detailBody=selected?(()=>{
        const [statusText,statusTone]=statusMeta[selected.status]||statusMeta.pending,[riskText4,riskTone]=riskMeta[selected.riskLevel]||riskMeta.medium;
        return `<div class="compliance-detail-body">
          <div class="detail-row"><span>商品</span><div><strong>${esc(selected.productTitle||'—')}</strong><br><span class="mono">${esc(selected.productId||'')}</span></div></div>
          <div class="detail-row"><span>命中词</span><div>${esc(selected.term||'—')}<br><span class="cell-sub">${esc(selected.ruleName||'')}</span></div></div>
          <div class="detail-row"><span>风险</span><div>${badge(riskText4,riskTone)}</div></div>
          <div class="detail-row"><span>位置</span><div>${esc(selected.field||'—')} · ${selected.sourceKind==='ocr'?'图片识别':'表格文字'}</div></div>
          <div class="detail-row"><span>状态</span><div>${badge(statusText,statusTone)}</div></div>
          <div class="detail-evidence">${esc(selected.evidence||'没有可展示的上下文')}</div>
          ${selected.imageUrl?button('查看图片','compliance-issue-image',{small:true,attrs:`data-url="${esc(selected.imageUrl)}"`}):''}
          <div class="actions detail-actions">${button('确认违规','compliance-issue-status',{small:true,primary:true,attrs:`data-job="${esc(job.id)}" data-issue="${esc(selected.id)}" data-status="confirmed"`})}${button('忽略','compliance-issue-status',{small:true,attrs:`data-job="${esc(job.id)}" data-issue="${esc(selected.id)}" data-status="ignored"`})}${button('标记已整改','compliance-issue-status',{small:true,attrs:`data-job="${esc(job.id)}" data-issue="${esc(selected.id)}" data-status="fixed"`})}</div>
        </div>`;
      })():`<div class="compliance-detail-body">${empty('问题详情','扫描完成后，选择一条问题查看证据和改法。','','info')}</div>`;
      const taskCard=`<div class="compliance-task-card"><div><strong>${esc(job.sourceFile||job.name)}</strong><p>${esc(job.storeName||'无')} · 任务 ID: ${esc(shortId(job.id))} · 总商品数: ${count(job.productCount)} · 计费图片: ${count(job.recognizedImageCount)} / ${count(job.uniqueImageCount)} · 费用: ${rate(job.actualCost)}</p></div></div>`;
      // 去掉“问题列表 ×”标题行（用户截图里的绿框），选中和全选功能放在表格列与批量操作条里。
      const listPanel=`<section class="panel compliance-rules-panel">${toolbar}${group==='product'?'':batchBar}${group==='product'?productTableHtml:issueTableHtml}</section>`;
      const aiPanel=panel('AI 品牌复核 0 条','显示前 200 条',table(['品牌名称','AI 状态','最终风险','商品','命中信息','判断原因','图片'],'',empty('暂无 AI 品牌复核记录。','品牌复核为后续能力，命中记录会显示在这里。','','ai')));
      return head+tabs+progressLine+taskCard+riskCards+`<div class="compliance-process-grid"><div class="compliance-process-main">${listPanel}</div><aside class="compliance-detail">${panel('问题详情','',detailBody)}</aside></div>`+aiPanel;
    }

    if(view==='rules'){
      const rules=arr(d.rules);
      const filters=state.complianceRuleFilter||(state.complianceRuleFilter={category:'all',level:'all',position:'all'});
      const query=String(state.search.complianceRule||'').toLowerCase();
      const levelMeta={high:['高风险','bad'],medium:['中风险','warn'],low:['低风险','good']};
      const levelLabel={high:'高风险',medium:'中风险',low:'低风险'};
      const category=state.complianceRuleCategory||'高风险违规词';
      const categoryChips=['高风险违规词','品牌词','自定义'].map(value=>`<button type="button" data-action="compliance-rule-category" data-value="${esc(value)}" class="${category===value?'active':''}">${esc(value)}</button>`).join('');

      // —— 分组详情：点“查看”后进入这一组，里面的词按行展示（参考截图 3）。 ——
      const detailRule=state.complianceRuleDetailId?rules.find(rule=>rule.id===state.complianceRuleDetailId):null;
      if(detailRule){
        const words=arr(detailRule.keywords);
        const wordQuery=String(state.search.complianceWord||'').toLowerCase();
        const filtered=words.map((word,index)=>({word,index})).filter(item=>!wordQuery||item.word.toLowerCase().includes(wordQuery));
        const page=paginate(filtered,'complianceWords',50);
        const selected=state.complianceWordSelection instanceof Set?state.complianceWordSelection:(state.complianceWordSelection=new Set());
        const [levelText,levelTone]=levelMeta[detailRule.level]||levelMeta.medium;
        const exceptions=arr(detailRule.exceptions);
        const allSelected=page.rows.length>0&&page.rows.every(item=>selected.has(item.word));
        const wordRows=page.rows.map(item=>`<tr class="${selected.has(item.word)?'highlight':''}">
          <td class="select-col"><input type="checkbox" class="table-select" data-compliance-word-select="${esc(item.word)}" ${selected.has(item.word)?'checked':''} aria-label="选择这个词"></td>
          <td class="title-cell"><span class="cell-main">${esc(item.word)}</span><span class="cell-sub mono">ID ${esc(String(item.index+1))}</span></td>
          <td class="title-cell"><span class="clip">${exceptions.length?esc(exceptions.join('、')):'无'}</span><button type="button" class="link-button" data-action="compliance-rule-exceptions" data-id="${esc(detailRule.id)}">新增例外词</button></td>
          <td>${esc(detailRule.category||'自定义')}</td>
          <td>${badge(levelText,levelTone)}</td>
          <td>${esc(detailRule.position||'全部')}</td>
          <td class="title-cell"><span class="clip">${esc(detailRule.suggestion||'—')}</span></td>
          <td class="title-cell"><span class="clip">${esc(detailRule.note||'—')}</span></td>
          <td><span class="badge ${detailRule.enabled===false?'':'good'}">${detailRule.enabled===false?'已停用':'启用'}</span></td>
          <td class="nowrap">${button('编辑','compliance-word-edit',{small:true,attrs:`data-index="${esc(String(item.index))}"`})}${button('删除','compliance-word-delete',{small:true,attrs:`data-index="${esc(String(item.index))}"`})}</td>
        </tr>`).join('');
        const wordTable=table([`<label class="select-all-head"><input type="checkbox" class="table-select" data-compliance-word-select-all="1" ${allSelected?'checked':''} aria-label="全选本页词语"><span>全选</span></label>`,'关键词','例外词','分类','风险','匹配位置','整改建议','备注','状态','操作'],wordRows,empty(!words.length,'这一组还没有词','点右上角“添加一个词”补充。','','compliance'))+(filtered.length?page.footer:'');
        const toolbar=`<div class="compliance-toolbar compliance-toolbar-left">
          ${button('返回词库','compliance-rule-back',{small:true,icon:'arrow'})}
          <strong class="word-group-title">${esc(detailRule.name)}</strong>${badge(`${words.length} 个词`,'brand')}${badge(levelText,levelTone)}
          <input class="search-input" data-search="complianceWord" value="${esc(state.search.complianceWord||'')}" placeholder="搜索这一组里的词" aria-label="搜索这一组的违规词">
          <span class="spacer"></span>
          ${selected.size?button(`删除所选（${selected.size}）`,'compliance-word-delete-selected',{small:true,danger:true}):''}
          ${button('添加一个词','compliance-word-add-new',{small:true,primary:true,disabled:busy,attrs:`data-id="${esc(detailRule.id)}"`})}
        </div>`;
        return head+tabs+progressLine+
          `<section class="panel compliance-rules-panel compliance-word-panel"><div class="panel-head"><div><h2>分组详情 · ${esc(detailRule.name)}</h2><p>这一组里的每个词单独一行：可以单独编辑、单独删除，也可以勾选后批量删除。</p></div><div class="actions">${button('编辑本组','compliance-rule-edit',{small:true,disabled:busy,attrs:`data-id="${esc(detailRule.id)}"`})}</div></div>${toolbar}${wordTable}</section>`;
      }

      // —— 词库列表：分类/风险/命中位置筛选 + 搜索；搜索框放在右侧（参考截图 5 的黄色圈位置）。 ——
      const categories=['all',...new Set(rules.map(rule=>String(rule.category||'自定义')))];
      const positions=['全部','商品标题','商品详情','主图','其它'];
      const matchRule=rule=>{
        if(filters.category!=='all'&&String(rule.category||'自定义')!==filters.category)return false;
        if(filters.level!=='all'&&rule.level!==filters.level)return false;
        if(filters.position!=='all'&&String(rule.position||'全部')!==filters.position)return false;
        if(!query)return true;
        return [rule.name,rule.category,arr(rule.keywords).join('、'),arr(rule.exceptions).join('、'),rule.suggestion,rule.note].some(value=>String(value||'').toLowerCase().includes(query));
      };
      const filtered=rules.filter(matchRule);
      const page=paginate(filtered,'complianceRules',50);
      const countChips=categories.map(value=>`<button type="button" class="filter-chip${filters.category===value?' active':''}" data-action="compliance-rule-filter" data-field="category" data-value="${esc(value)}">${value==='all'?'全部':esc(value)} <b>${esc(String(value==='all'?rules.length:rules.filter(rule=>String(rule.category||'自定义')===value).length))}</b></button>`).join('');
      const rows=page.rows.map(rule=>{
        const [levelText,levelTone]=levelMeta[rule.level]||levelMeta.medium;
        return `<tr><td class="title-cell"><span class="cell-main clip">${esc(arr(rule.keywords).join('、')||rule.name)}</span><span class="cell-sub mono">ID ${esc(String(rule.id).slice(0,12))} · 共 ${esc(String(arr(rule.keywords).length))} 个词</span></td><td class="nowrap"><span class="clip">${arr(rule.exceptions).length?esc(arr(rule.exceptions).join('、')):'—'}</span><button type="button" class="link-button" data-action="compliance-rule-exceptions" data-id="${esc(rule.id)}">+ 添加</button></td><td>${esc(rule.category||'自定义')}</td><td>${badge(levelText,levelTone)}</td><td>${esc(rule.position||'全部')}</td><td><label class="switch" title="启用或停用这条违规词"><input type="checkbox" data-compliance-rule-toggle="${esc(rule.id)}" ${rule.enabled===false?'':'checked'} aria-label="启用或停用这条违规词"><span class="switch-slider"></span></label></td><td class="title-cell"><span class="clip">${esc(rule.suggestion||'—')}</span></td><td class="title-cell"><span class="clip">${esc(rule.note||'—')}</span></td><td class="nowrap col-actions">${button('查看','compliance-rule-view',{small:true,attrs:`data-id="${esc(rule.id)}"`})}${button('编辑','compliance-rule-edit',{small:true,attrs:`data-id="${esc(rule.id)}"`})}${button('删除','compliance-rule-delete',{small:true,attrs:`data-id="${esc(rule.id)}"`})}</td></tr>`;
      }).join('');
      const ruleTable=table(['关键词','例外词','分类','风险','命中位置','启用','整改建议','备注','操作'],rows,empty('词库还是空的','用左侧表单加入违规词，或点“上传文件”导入词库。','','compliance'))+(filtered.length?page.footer:'');
      const formPanel=panel('加入违规词','保存后下次扫描生效',`<div class="panel-body">
        <div class="field"><label for="compliance-rule-keywords">关键词</label><textarea id="compliance-rule-keywords" rows="4" placeholder="输入需要拦截的词语（支持单条或多条，一行一个关键词）"></textarea></div>
        <div class="field"><label>分类</label><div class="segmented compliance-category" role="group" aria-label="违规词分类">${categoryChips}</div></div>
        <div class="rule-form-2col"><div class="field"><label for="compliance-rule-level">风险等级</label><select id="compliance-rule-level"><option value="high" selected>高风险</option><option value="medium">中风险</option><option value="low">低风险</option></select></div><div class="field"><label for="compliance-rule-position">命中位置</label><select id="compliance-rule-position">${positions.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('')}</select></div></div>
        <label class="switch-row"><span class="switch"><input type="checkbox" id="compliance-rule-enabled" checked><span class="switch-slider"></span></span><span>启用（停用的词不参与扫描）</span></label>
        <div class="field"><label for="compliance-rule-suggestion">整改建议</label><textarea id="compliance-rule-suggestion" rows="3" placeholder="例如：删除或修改违规表述，并核对平台规则与经营资质。"></textarea></div>
        <div class="field"><label for="compliance-rule-note">备注</label><input id="compliance-rule-note" type="text" placeholder="可选 · 来源、批次或说明"></div>
        ${button('加入违规库','compliance-rule-create',{primary:true,disabled:busy})}
      </div>`,button('上传文件','compliance-rules-import',{small:true,icon:'folder',disabled:busy}));
      const toolbar=`<div class="compliance-toolbar">
        ${countChips}
        <select class="compliance-select" data-compliance-rule-filter="level" aria-label="按风险筛选"><option value="all" ${filters.level==='all'?'selected':''}>全部风险</option><option value="high" ${filters.level==='high'?'selected':''}>高风险</option><option value="medium" ${filters.level==='medium'?'selected':''}>中风险</option><option value="low" ${filters.level==='low'?'selected':''}>低风险</option></select>
        <select class="compliance-select" data-compliance-rule-filter="position" aria-label="按命中位置筛选"><option value="all" ${filters.position==='all'?'selected':''}>全部命中位置</option>${positions.map(value=>`<option value="${esc(value)}" ${filters.position===value?'selected':''}>${esc(value)}</option>`).join('')}</select>
        <input class="search-input" data-search="complianceRule" value="${esc(state.search.complianceRule||'')}" placeholder="搜索关键词 / 例外词 / 建议 / 备注" aria-label="搜索违规词">
        ${button('新增规则','compliance-rule-add',{small:true,disabled:busy})}${button('恢复默认词库','compliance-rules-reset',{small:true,disabled:busy})}
      </div>`;
      return head+tabs+progressLine+`<div class="compliance-rules-grid"><div class="compliance-rules-form">${formPanel}</div><div class="compliance-rules-list"><section class="panel compliance-rules-panel">${toolbar}${ruleTable}</section></div></div>`;
    }

    // 计费中心
    const entries=arr(billing.entries);
    const today=nowDate(),month=today.slice(0,7);
    const scanEntries=entries.filter(entry=>entry.type==='scan');
    const todayEntries=scanEntries.filter(entry=>String(entry.at||'').slice(0,10)===today);
    const monthEntries=scanEntries.filter(entry=>String(entry.at||'').slice(0,7)===month);
    const sumImages=list=>list.reduce((total,entry)=>total+Number(entry.images||0),0);
    const sumCost=list=>list.reduce((total,entry)=>total+Math.abs(Number(entry.amount)||0),0);
    const totalImages=sumImages(scanEntries),totalCost=sumCost(scanEntries);
    const statusText={ready:['待扫描',''],scanning:['扫描中','warn'],paused:['已停止','warn'],completed:['已完成','good'],failed:['失败','bad']};
    const taskRows=jobs.map(item=>{const [text,tone]=statusText[item.status]||statusText.ready;return `<tr><td class="mono">${esc(shortId(item.id))}</td><td class="title-cell"><span class="cell-main">${esc(item.sourceFile||item.name)}</span><span class="cell-sub">${esc(item.storeName||item.name)}</span></td><td><span class="cell-main">${count(item.recognizedImageCount)}</span><span class="cell-sub">总 ${count(item.imageCount)} · 去重 ${count(item.uniqueImageCount)}</span></td><td><span class="cell-main mono">${rate(item.actualCost)}</span><span class="cell-sub">预计 ${rate(item.estimatedCost)}</span></td><td>${badge(text,tone)}</td><td class="nowrap">${esc(shortAt(item.createdAt))}</td></tr>`;}).join('');
    const billingRows=entries.slice(0,100).map(entry=>`<tr><td class="nowrap">${esc(shortAt(entry.at))}</td><td>${badge(entry.type==='topup'?'充值':'扫描扣费',entry.type==='topup'?'good':'warn')}</td><td class="title-cell"><span class="clip">${esc(entry.jobName||'—')}</span></td><td>${count(entry.images)}</td><td>${count(entry.cached)}</td><td class="mono nowrap">${entry.amount<0?'-':''}${rate(Math.abs(Number(entry.amount)||0))}</td><td class="mono nowrap">${money(entry.balance)}</td><td class="title-cell"><span class="clip">${esc(entry.note||'')}</span></td></tr>`).join('');
    return head+tabs+progressLine+
      `<div class="compliance-stat-cards">
        <div class="compliance-stat purple"><span class="cs-label">今日图片数</span><span class="cs-value">${count(sumImages(todayEntries))}</span><span class="cs-note">今日费用 ${rate(sumCost(todayEntries))}</span></div>
        <div class="compliance-stat plain"><span class="cs-label">本月图片数</span><span class="cs-value">${count(sumImages(monthEntries))}</span><span class="cs-note">本月费用 ${rate(sumCost(monthEntries))}</span></div>
        <div class="compliance-stat plain"><span class="cs-label">累计计费图片数</span><span class="cs-value">${count(totalImages)}</span><span class="cs-note">累计费用 ${rate(totalCost)}</span></div>
        <div class="compliance-stat red"><span class="cs-label">累计费用</span><span class="cs-value">${rate(totalCost)}</span><span class="cs-note">按 ${rate(unitPrice)} / 图片</span></div>
      </div>`+
      `<div class="compliance-billing-grid"><div class="compliance-billing-main">
        ${panel(jobBadgeWithCount('任务费用明细',jobs.length),'',jobs.length?table(['任务ID','文件 / 店铺','图片数','费用','状态','创建时间'],taskRows)+`<div class="table-footer"><span>共 ${count(jobs.length)} 个任务</span><span>识别成功的图片才计费</span></div>`:empty('还没有计费任务','导入并扫描商品表后，任务费用会显示在这里。','','purchase'))}
        ${panel(jobBadgeWithCount('计费流水',entries.length),'',entries.length?table(['时间','类型','任务','识别图片','缓存命中','金额','余额','说明'],billingRows):empty('还没有计费记录','扫描任务识别图片后会自动记账。','','compliance'))}
      </div><aside class="compliance-billing-side">
        ${panel('计费规则','',`<div class="panel-body"><div class="billing-rate"><strong>${rate(unitPrice)}</strong><span>/ 张图片</span></div><ul class="billing-rules"><li>重复图片缓存命中不重复计费</li><li>下载失败图片不计费</li><li>纯文字扫描不计费，同一张图片在同一任务内只计一次</li><li>查看历史结果不计费</li></ul><div class="settings-row"><div><strong>账户余额</strong><p>本机记账，用于统计图片识别费用</p></div><b class="mono billing-balance">${money(billing.balance)}</b></div><div class="settings-row"><div><strong>图片单价</strong><p>识别成功的图片按这个单价计费（元 / 张）</p></div><div class="actions">${button('调整单价','compliance-billing',{small:true,disabled:busy})}${button('充值','compliance-topup',{small:true,primary:true,disabled:busy})}</div></div></div>`)}
        ${panel('预算控制',badge('即将开放','brand'),`<div class="panel-body"><p class="inline-note">月度预算与超额提醒将在后续版本提供，数据结构已预留。</p><div class="budget-chips"><span class="budget-chip">单任务费用上限</span><span class="budget-chip">每日费用上限</span><span class="budget-chip">每月费用上限</span><span class="budget-chip">余额不足暂停扫描</span></div></div>`)}
      </aside></div>`;
  }
  function ai() {
    return heading('AI 助手','为后续本地工作流程保留入口。')+`<section class="ai-reserved"><div class="ai-symbol">${svg('ai')}</div>${badge('功能预留 · 尚未启用','brand')}<h2>AI 助手，留给下一步</h2><p>当前版本不连接模型、不调用 AI API，也不生成对话。<br>其余店铺功能可独立使用。</p><div class="reserved-grid"><div class="reserved-card"><strong>运营问答</strong><p>后续可按需要接入模型，辅助理解店铺数据。</p></div><div class="reserved-card"><strong>内容辅助</strong><p>后续可扩展商品文案整理与人工审核流程。</p></div><div class="reserved-card"><strong>工作建议</strong><p>后续可提供建议，实际店铺操作仍需明确授权。</p></div></div><div class="reserved-input"><span>AI 服务未启用</span>${button('暂不可用','none',{disabled:true,small:true})}</div></section>`;
  }
  function settings() {
    const settings=state.settings;
    const locations=settings.paths||{};
    const can=code=>Boolean(cloudAuthUi?.hasPermission(code));
    const appearance=can('workbench.settings.theme')?panel('外观','',`<div class="panel-body"><div class="settings-row"><div><strong>显示模式</strong><p>当前：${state.theme==='dark'?'深色模式':state.theme==='eye'?'护眼模式':'浅色模式'}</p></div><div class="actions"><div class="segmented"><button type="button" data-action="set-theme" data-theme="light" class="${state.theme==='light'?'active':''}">浅色模式</button><button type="button" data-action="set-theme" data-theme="dark" class="${state.theme==='dark'?'active':''}">深色模式</button><button type="button" data-action="set-theme" data-theme="eye" class="${state.theme==='eye'?'active':''}">护眼模式</button></div></div></div></div>`):'';
    const fileLocations=can('workbench.settings.paths')?panel('文件位置','',`<div class="panel-body"><div class="settings-row"><div><strong>页面脚本缓存位置</strong><p style="overflow-wrap:anywhere">${esc(locations.cacheDir||locations.defaultCacheDir||'使用原位置')}</p>${locations.cacheRequiresRestart?`<p class="inline-note">已保存，重启后生效。当前使用：${esc(locations.activeCacheDir||'原位置')}</p>`:''}</div><div class="actions">${button('选择文件夹','choose-path',{attrs:'data-kind="cache"'})}${button('恢复默认','reset-path',{attrs:'data-kind="cache"',disabled:!locations.cacheDir})}</div></div><div class="settings-row"><div><strong>默认导出位置</strong><p style="overflow-wrap:anywhere">${esc(locations.effectiveExportDir||'系统默认位置')}</p></div><div class="actions">${button('选择文件夹','choose-path',{attrs:'data-kind="export"'})}${button('恢复默认','reset-path',{attrs:'data-kind="export"',disabled:!locations.exportDir})}</div></div>${locations.warning?`<p class="inline-note">${esc(locations.warning)}</p>`:''}</div>`):'';
    const storeData=can('workbench.settings.storeData')?storeDataPanel():'';
    const storeManage=(can('workbench.accounts.edit')||can('workbench.accounts.remove')||can('workbench.accounts.add'))?panel('店铺管理','每家店铺使用独立会话；新电脑需要重新登录。',state.stores.length?`<div class="panel-body">${state.stores.map(s=>`<div class="store-row"><span class="store-avatar">${esc(s.name?.slice(0,1)||'店')}</span><div><strong>${esc(s.name)}</strong> ${s.id===state.storeId?badge('当前店铺','brand'):''}<p>独立店铺会话</p></div><div class="actions">${button('切换','select-store',{small:true,attrs:`data-id="${esc(s.id)}"`,disabled:s.id===state.storeId})}${can('workbench.accounts.edit')?button('重命名','rename-store',{small:true,attrs:`data-id="${esc(s.id)}"`}):''}${can('workbench.accounts.remove')?button('移除','remove-store',{small:true,danger:true,attrs:`data-id="${esc(s.id)}"`}):''}</div></div>`).join('')}</div>`:empty('尚未添加店铺','添加店铺名称后，可在各模块打开官方页面登录。','','store'),can('workbench.accounts.add')?button('添加店铺','add-store',{primary:true,small:true}):''):'';
    const backup=can('workbench.settings.backup')?panel('数据备份','',`<div class="panel-body"><div class="settings-row"><div><strong>导出本地备份</strong></div>${button('导出备份','backup-export',{icon:'export'})}</div><div class="settings-row"><div><strong>从备份恢复</strong></div>${button('导入备份','backup-import')}</div></div>`):'';
    return heading('设置','管理店铺、本机数据与迁移备份。',button('打开数据目录','open-data',{icon:'folder',permission:'workbench.settings.paths'}))+
      appearance+fileLocations+storeData+storeManage+
      `<div class="section-grid">${backup}${panel('应用信息','当前程序与数据位置',`<div class="panel-body"><div class="settings-row"><div><strong>谢谢工作台</strong><p>版本 ${esc(state.info.version||'开发版')} · 单机桌面程序</p></div>${badge('本地运行','good')}</div><div class="settings-row"><div><strong>本机数据目录</strong><p>${esc(state.info.dataDir||settings.dataDir||'通过“打开数据目录”查看实际位置')}</p></div></div>${updateUi?updateUi.settingsRow():''}<div class="settings-row"><div><strong>AI 模型接入</strong><p>当前不配置模型，不发起 AI 请求。</p></div>${badge('未启用')}</div></div>`)}</div>`+
      panel('AI 预备备注','仅保存未来接入时的需求备注，当前不调用模型。',`<form id="settings-form" class="panel-body"><div class="field"><label for="settings-note">预备需求 / 使用备注</label><textarea id="settings-note" name="note" maxlength="1000" rows="3" placeholder="可记录后续希望接入的能力，例如运营问答、文案整理。">${esc(settings.ai?.note||'')}</textarea></div><p class="inline-note">推广与同步仅在程序运行期间执行。关闭桌面程序后，定时检查会停止。</p>${button('保存备注','save-settings',{primary:true})}</form>`);
  }

  // 每个店铺一个数据文件夹：可直接打开、单独清理，方便释放空间。
  function storeDataPanel() {
    const data=state.storeData||{},entries=arr(data.entries),orphans=arr(data.orphans);
    const storeRow=item=>`<div class="store-row"><span class="store-avatar">${esc(String(item.name||'店').slice(0,1))}</span><div><strong>${esc(item.name||'未命名店铺')}</strong> ${item.bytes!==undefined?badge(fileSize(item.bytes)):''}<p class="store-path">${esc(item.path||item.folder||'')}</p><p>${item.files!==undefined?`${esc(item.files)} 个文件`:'文件夹按店铺独立保存'}${item.warning?` · ${esc(item.warning)}`:''}</p></div><div class="actions">${item.id?button('打开文件夹','open-store-data',{small:true,attrs:`data-id="${esc(item.id)}"`}):''}${item.id?button('清理数据','clear-store-data',{small:true,danger:true,attrs:`data-id="${esc(item.id)}"`}):button('清理','clear-store-folder',{small:true,danger:true,attrs:`data-folder="${esc(item.name||'')}"`})}</div></div>`;
    const body=entries.length?entries.map(storeRow).join(''):empty('尚未建立店铺数据文件夹','添加并登录店铺后，这里会显示每个店铺独立的数据文件夹。','','folder');
    const orphanHtml=orphans.length?`<p class="inline-note">已移除店铺留下的文件夹（可单独清理）：</p>${orphans.map(storeRow).join('')}`:'';
    return panel('店铺数据','',`<div class="panel-body">${data.root?`<p class="inline-note">数据根目录：${esc(data.root)}</p>`:''}${body}${orphanHtml}${data.error?`<p class="inline-note">${esc(data.error)}</p>`:''}</div>`);
  }

  // 设置页的“清除店铺缓存”区块在页面渲染后追加，避免改动既有面板结构。
  function cachePanelHtml() {
    if (!state.stores.length||!cloudAuthUi?.hasPermission('workbench.settings.cache')) return '';
    return panel('店铺缓存','清除所选店铺的网页缓存；登录状态、账号密码和经营数据不会被删除。',`<div class="panel-body"><div class="store-cache-toolbar"><span>仅显示当前账号有权限的店铺</span><label class="checkline"><input type="checkbox" data-store-cache-all><span>全选</span></label></div><div class="store-cache-list">${state.stores.map(s=>`<label class="checkline store-cache-row"><input type="checkbox" data-store-cache="${esc(s.id)}"><span>${esc(s.name)}</span></label>`).join('')}</div><div class="actions">${button('清除所选店铺缓存','clear-store-cache',{danger:true,icon:'refresh'})}</div><p class="inline-note">只清除可重新生成的网页与脚本缓存，不会退出登录，也不改动 Cookie、账号和业务数据。清除后正在使用的页面可能需要重新加载。</p></div>`);
  }
  function injectCachePanel() {
    const content=$('#content');
    if(!content)return;
    // 店铺管理已移到“店铺登录”的店铺卡片菜单，设置页不再重复展示。
    for(const section of [...content.querySelectorAll('section')]){const title=section.querySelector('h2,h3');if(title&&String(title.textContent).trim()==='店铺管理')section.remove();}
    if(content.querySelector('[data-store-cache]'))return;
    content.insertAdjacentHTML('beforeend',cachePanelHtml());
  }
  function render() {
    if(!cloudAuthUi?.isAuthenticated()){
      cloudAuthUi?.renderGate();
      return;
    }
    if(!cloudAuthUi.canAccessPage(state.page))state.page=cloudAuthUi.firstAccessiblePage();
    $('#navigation').innerHTML=navigation.sidebar(state.page);
    const rail=$('#sidebar-rail');if(rail){rail.innerHTML=navigation.rail(state.page);if(updateUi?.hasNewVersion?.())rail.querySelector('[data-page="update"]')?.classList.add('has-update');}
    const breadcrumb=$('#breadcrumb');if(breadcrumb)breadcrumb.innerHTML=navigation.breadcrumb(state.page);
    const accountSlot=$('#cloud-account-slot');
    if(accountSlot)accountSlot.innerHTML=cloudAuthUi.accountChipHtml();
    const currentSelect=$('#store-select');
    if(currentSelect){currentSelect.innerHTML=state.stores.length?state.stores.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(''):'<option value="">尚未添加店铺</option>';currentSelect.value=state.storeId;}
    if(state.loading){browserUi.setVisible(false).catch(showError);$('#content').innerHTML=navigation.wrap(state.page,'<div class="loading"><span class="spinner"></span>正在读取本地数据…</div>');return;}
    if(!state.storeId&&isStorePage(state.page)){$('#content').innerHTML=navigation.wrap(state.page,noStore());return;}
    const pages={accounts:()=>accountUi.render(),browser:()=>browserUi.render(),cloudaccount:()=>cloudAuthUi.renderPage(),business:()=>businessUi.render(),reviews,promotion,purchase,hostedgift:hostedGiftPage,complaint:complaintPage,compliance,ai,settings,selectionpool:()=>selectionPoolUi.render()};
    const reRendered=state.page!=='browser'||!$('#content .browser-page');
    if(reRendered){
      // 全量重写 #content 会重建编辑器弹窗 DOM，滚动位置回到顶部（用户反馈「页面一直跳上去」）。
      // 重绘前记录所有可滚动容器的位置，重绘后原样恢复（含弹窗两栏与详情图区）。
      const scrollSave=(()=>{
        const out=[];
        const content=$('#content');
        if(!content)return out;
        for(const el of content.querySelectorAll('.sped-cols,.spx-body,.spx-form-main,.sp-dialog-body,[data-sped-scroll]')){
          out.push({sel:el.className||'',idx:Array.prototype.indexOf.call(content.querySelectorAll('.sped-cols,.spx-body,.spx-form-main,.sp-dialog-body,[data-sped-scroll]'),el),top:el.scrollTop,left:el.scrollLeft});
        }
        return out;
      })();
      $('#content').innerHTML=navigation.wrap(state.page,insightUi.handlesPage(state.page)?insightUi.render(state.page):pages[state.page]());
      if(scrollSave.length){
        const nodes=$('#content').querySelectorAll('.sped-cols,.spx-body,.spx-form-main,.sp-dialog-body,[data-sped-scroll]');
        for(const saved of scrollSave){const el=nodes[saved.idx];if(el&&(saved.top||saved.left)){el.scrollTop=saved.top;el.scrollLeft=saved.left;}}
      }
      dockPageActions($('#content'));
      applyActionPermissions($('#content'));
    }
    // 2026-10-22 用户要求：顶部栏只放全局导航与店铺选择。
    // 页面标题、页面按钮、模块页签、浏览器地址栏一律留在内容区；禁止再把页面内容搬进顶栏
    // （后续新增功能同样遵守，避免顶栏变成第二个功能菜单）。
    const headingHost=$('#topbar-heading');
    if(headingHost)headingHost.innerHTML='';
    renderStoreStatus();
    if(state.page==='browser')browserUi.afterRender();
    if(state.page==='business')businessUi.afterRender();
    if(state.page==='settings')injectCachePanel();
    if(state.page==='settings')applyActionPermissions($('#content'));
    browserUi.setVisible(hostsBrowser(state.page)&&!$('#dialog').open).catch(showError);
  }
  async function loadPage(page=state.page,loading=true) {
    const sequence=++state.loadSequence,selectedStoreId=state.storeId;
    if(loading){state.loading=true;render();}
    try {
      if(page==='settings'){
        state.settings=await api('settings.load')||{};
        try{state.storeData=await api('settings.storeData')||{};}catch(error){state.storeData={entries:[],orphans:[],error:error?.message||String(error)};}
      }
      else if(page==='cloudaccount'){
        // 登录中心在线上，整页首次拉取要等网络；已有会话时先用缓存立刻渲染，再后台刷新。
        if(cloudAuthUi.hasSessionView?.()){state.loading=false;render();}
        await cloudAuthUi.load();
      }
      else if(page==='accounts')setData('accounts',await api('accounts.load'));
      else if(page==='browser')await browserUi.load();
      else if(page==='business'&&selectedStoreId)await businessUi.load({storeId:selectedStoreId});
      // 上品库是跨店铺的本机商品库：无论当前是否选中店铺都要加载。
      else if(page==='selectionpool')setData('selectionpool',await api('selectionpool.load',{storeId:selectedStoreId}),selectedStoreId);
      else if(page==='overview'&&selectedStoreId){const result=await Promise.allSettled(['reviews','promotion'].map(async module=>setData(module,await api(`${module}.load`,{storeId:selectedStoreId}),selectedStoreId)));for(const item of result){if(item.status==='rejected')showError(item.reason);}}
      else if(!['overview','ai'].includes(page)&&(selectedStoreId||page==='compliance'))setData(page,await api(`${page}.load`,{storeId:selectedStoreId}),selectedStoreId);
    } catch(error){showError(error);}
    finally{if(sequence===state.loadSequence){state.loading=false;render();}}
  }
  async function navigate(requested) {const page=navigation.resolve(requested,state.selectionPage,state.marketingView);if(!page)return;if(!cloudAuthUi?.canAccessPage(page)){toast('当前账号没有这个功能的权限，请联系公司管理员。',true);return;}if(state.page==='business'&&page!=='business')businessUi.leave();if(page==='browser'&&state.page!=='browser')state.browserReturnPage=state.page;if(state.page==='browser'&&page!=='browser')await browserUi.setVisible(false);state.page=page;if(navigation.isSelection(page))state.selectionPage=page;if(['purchase','hostedgift','complaint'].includes(page))state.marketingView=page;state.selection.clear();clearError();await loadPage();}
  async function selectStore(id) {if(!state.stores.some(store=>store.id===id))throw new Error('店铺不存在，请刷新后重试。');if(state.page==='browser')await browserUi.setVisible(false);if(state.page==='business')businessUi.leave();state.storeId=id;businessUi.followStore(id);browserUi.setViewStore(id);state.selection.clear();clearError();renderProgress();if(state.page==='browser'){await api('browser.open',{storeId:id,kind:'seller'});await browserUi.load();render();}else await loadPage();}
  async function refreshStores() {const result=await api('stores.list');state.stores=arr(result?.stores||result);if(!state.stores.some(s=>s.id===state.storeId))state.storeId=state.stores[0]?.id||'';if(state.storeId)businessUi?.followStore(state.storeId);}
  // 顶部“店铺已登录/当前店铺/＋/店铺登录”这一排已按用户要求移除，这里保留空实现。
  function renderStoreStatus() {}
  function renderProgress() {
    // 经营数据的进度只显示在它自己的页面里（同步行 + “查看同步进度”），顶部不再重复显示。
    // 每条都带关闭按钮：任何任务卡住时用户都能手动收起，不会一直占着顶部一条。
    const visible=Object.entries(state.progress).filter(([,p])=>p.module!=='business'&&(!p.storeId||p.storeId===state.storeId));
    $('#progress-area').innerHTML=visible.map(([key,p])=>`<div class="progress-item"><span class="spinner"></span><span><strong>${esc(navigation.label(p.module,'任务'))}</strong> · ${esc(p.message||p.stage||'正在处理')}${p.total?` · ${esc(p.current||0)} / ${esc(p.total)}`:''}</span>${p.module==='reviews'?button('取消','review-cancel',{small:true}):p.module==='business'?button('查看同步','business-progress',{small:true,attrs:`data-mode="${esc(p.mode)}" data-id="${esc(p.storeId)}"`}):''}<button type="button" class="progress-dismiss" data-action="dismiss-progress" data-key="${esc(key)}" aria-label="关闭这条提示" title="关闭">×</button></div>`).join('');
  }
  let modalInFlight=null;
  async function modal({title,description='',fields='',confirm='确认',danger=false,details='',validate}) {
    const dialog=$('#dialog'),form=$('#dialog-form');
    if(modalInFlight||dialog.open)return null;
    const reservation={};modalInFlight=reservation;
    try {
      await browserUi.setVisible(false);
      $('#dialog-content').innerHTML=`<h2>${esc(title)}</h2>${description?`<p class="dialog-description">${esc(description)}</p>`:''}${fields}${details?`<div class="confirm-details">${esc(details)}</div>`:''}`;
      $('#dialog-confirm').textContent=confirm;$('#dialog-confirm').className=`button ${danger?'danger':'primary'}`;
      return await new Promise((resolve,reject)=>{
        const cancelButton=$('#dialog-cancel');let settled=false;
        const cleanup=()=>{form.removeEventListener('submit',submit);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',close);cancelButton.removeEventListener('click',cancel);};
        const finish=(values,result)=>{
          if(settled)return;settled=true;cleanup();
          if(modalInFlight===reservation)modalInFlight=null;
          // Capture this action now. Native close events may arrive after the
          // shared dialog has already been reopened for a different action.
          if(dialog.open)dialog.close(result);
          if(state.page==='browser'||state.page==='accounts'){browserUi.afterRender();browserUi.setVisible(true).catch(showError);}
          resolve(values);
        };
        const cancel=event=>{event.preventDefault();finish(null,'cancel');};
        const close=()=>{if(!dialog.open)finish(null,'cancel');};
        const submit=event=>{event.preventDefault();if(!form.reportValidity())return;const values=Object.fromEntries(new FormData(form));if(validate){const message=validate(values);if(message){toast(message,true);return;}}finish(values,'confirmed');};
        form.addEventListener('submit',submit);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',close);cancelButton.addEventListener('click',cancel);
        try{dialog.returnValue='';dialog.showModal();}catch(error){cleanup();reject(error);}
      });
    } finally {if(modalInFlight===reservation)modalInFlight=null;}
  }
  const inputField=(name,label,value='',type='text',extra='')=>`<div class="field"><label for="form-${name}">${label}</label><input id="form-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
  async function confirmWrite(title,description,details,confirm='确认执行') {return Boolean(await modal({title,description,details,confirm,danger:true}));}
  const LEVELS_FOR_RULES=['high','medium','low'];
  const RULE_POSITIONS=['全部','商品标题','商品详情','主图','其它'];
  // 违规排查：拉取一次数据并按当前板块渲染（服务端按 view/jobId 返回任务与问题）。
  async function refreshCompliance(view=state.complianceView,jobId=state.complianceJobId){
    const data=await api('compliance.load',{view,jobId:jobId||undefined});
    state.complianceJobId=data?.selectedJobId||null;
    setData('compliance',data||{});
    render();
    return data;
  }
  // 违规扫描导入入口：弹窗选择与“按路径导入/拖拽”共用同一条流程。
  function importComplianceFile(filePath) {
    toast('正在读取表格…大表需要 10–30 秒，请稍候（界面可以继续操作）');
    return perform('compliance.import',async()=>{
      const result=filePath?await api('compliance.importPath',{storeId:state.storeId,storeName:store()?.name||'',path:filePath}):await api('compliance.import',{storeId:state.storeId,storeName:store()?.name||''});
      if(result?.canceled)return result;
      state.complianceView='scan';
      if(result?.job?.id)state.complianceJobId=result.job.id;
      await refreshCompliance('scan',state.complianceJobId);
      return result;
    },{success:'商品表格已导入，点“开始扫描”即可排查',reload:false});
  }
  // 处理中心“全选”按当前筛选结果算，跟表格里看到的一致。
  function filteredIssuesForSelection(){
    const filters=state.complianceFilter||{};
    const query=String(state.search.compliance||'').toLowerCase();
    return arr(moduleData('compliance')?.job?.issues).filter(issue=>{
      if(filters.risk&&filters.risk!=='all'&&issue.riskLevel!==filters.risk)return false;
      if(filters.source&&filters.source!=='all'&&issue.sourceKind!==filters.source)return false;
      if(filters.status&&filters.status!=='all'&&issue.status!==filters.status)return false;
      if(!query)return true;
      return [issue.productId,issue.productTitle,issue.term,issue.evidence,issue.ruleName].some(value=>String(value||'').toLowerCase().includes(query));
    });
  }
  async function storeDialog(id) {
    const target=state.stores.find(s=>s.id===id),values=await modal({title:target?'重命名店铺':'添加店铺',description:'用容易识别的名称区分店铺。登录在官方商家页面完成，这里不收集账号密码。',fields:inputField('name','店铺名称',target?.name||'','text','required maxlength="60" placeholder="例如：XX旗舰店"'),confirm:target?'保存名称':'添加店铺',validate:v=>!v.name.trim()?'请输入店铺名称。':''});
    if(!values)return;
    await perform('stores',async()=>{const result=await api(target?'stores.rename':'stores.add',target?{id,name:values.name.trim()}:{name:values.name.trim()});await refreshStores();if(!target){const createdId=result?.id||result?.store?.id;state.storeId=createdId||state.stores.at(-1)?.id||state.storeId;}},{success:target?'店铺名称已更新':'店铺已添加，请打开对应后台登录',reload:false});
    await loadPage();
  }
  async function assignStore(store) {
    if (!store?.id) return;
    const users = await api('cloudauth.managementUsers');
    const activeUsers = arr(users).filter(user => user.status === 'active');
    const options = activeUsers.map(item => ({value:`user:${item.id}`, label:`成员：${item.display_name || item.login_id}（${item.role_name || item.role || ''}）`}));
    const values = await modal({
      title:`分配店铺：${store.name || '未命名店铺'}`,
      description:'店铺分配给成员后，普通成员只看到自己的店铺；组长可以看到本组所有成员的店铺，部门主管及更上级可以看到下级成员的店铺。',
      fields:`<div class="field"><label>分配对象</label><select name="scope" required><option value="">请选择</option>${options.map(item => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('')}</select></div>`,
      confirm:'保存分配',
      validate:input => !input.scope ? '请选择分配对象' : '',
    });
    if (!values?.scope) return;
    const [scopeType, scopeId] = String(values.scope).split(':');
    await perform('store.assign',()=>api('cloudauth.assignStore',{id:store.id,scopeType,scopeId}),{success:'店铺可见范围已更新',reload:false});
    await refreshStores();
    await loadPage('accounts',false);
  }
  async function ruleDialog(id) {
    const rule=arr(moduleData('promotion').rules).find(r=>r.id===id)||{};
    const fields=`<div class="form-grid">${inputField('name','规则名称',rule.name||'花费与 ROI 检查','text','required maxlength="80"')}<div class="field"><label for="form-channel">推广渠道</label><select id="form-channel" name="channel"><option value="product" ${rule.channel!=='store'?'selected':''}>货品全站推广</option><option value="store" ${rule.channel==='store'?'selected':''}>店铺全站推广</option></select></div>${inputField('spendThreshold','达到花费（元）',rule.spendThreshold??100,'number','required min="0.01" step="0.01"')}${inputField('roiThreshold','ROI 阈值（≤）',rule.roiThreshold??1,'number','required min="0" step="0.01"')}${inputField('recoverAfterMinutes','暂停后恢复（分钟，0 = 不恢复）',rule.recoverAfterMinutes??0,'number','required min="0" step="1"')}<div class="field"><label for="form-intervalMinutes">检查间隔</label><select id="form-intervalMinutes" name="intervalMinutes">${[5,10,15,30,60].map(n=>`<option value="${n}" ${Number(rule.intervalMinutes||5)===n?'selected':''}>${n} 分钟</option>`).join('')}</select></div>${inputField('startTime','执行时间开始',rule.startTime||'00:00','time','required')}${inputField('endTime','执行时间结束',rule.endTime||'23:59','time','required')}<div class="field"><label for="form-datePreset">指标统计范围</label><select name="datePreset" id="form-datePreset">${['today','yesterday','last3','last7','last14','last30'].map(p=>`<option value="${p}" ${rule.datePreset===p?'selected':''}>${presetLabel(p)}</option>`).join('')}</select></div><label class="checkline"><input type="checkbox" name="enabled" ${rule.enabled===false?'':'checked'}>启用本规则</label></div>`;
    const values=await modal({title:id?'编辑推广规则':'添加推广规则',description:'花费达到阈值且 ROI 不高于阈值时命中。货品全站使用净投产比，店铺全站使用投产比。保存后回到观察模式，启用自动执行需再次授权。',fields,confirm:'保存并观察'});if(!values)return;
    const next={...rule,...values,enabled:values.enabled==='on',spendThreshold:Number(values.spendThreshold),roiThreshold:Number(values.roiThreshold),recoverAfterMinutes:Number(values.recoverAfterMinutes),intervalMinutes:Number(values.intervalMinutes)};
    await perform('promotion.saveRule',()=>api('promotion.saveRule',storePayload({rule:next})),{success:'推广规则已保存，当前为观察模式'});
  }
  // 内购会方案表单：读值 / 保存草稿（新建时在渲染层生成 id，保存后继续用它）。
  // 活动名称自动生成（与同类工作台一致）：店铺名去掉“旗舰店/专营店/企业店/官方店/店铺”后缀，加 MMDDHHmm，最长 12 字。
  function generatedPurchaseName(storeName,startValue){
    const date=startValue?new Date(startValue):new Date();
    const safe=Number.isNaN(date.getTime())?new Date():date;
    const stamp=[safe.getMonth()+1,safe.getDate(),safe.getHours(),safe.getMinutes()].map(part=>String(part).padStart(2,'0')).join('');
    const normalized=String(storeName||'').trim().replace(/(?:旗舰店|专营店|企业店|官方店|店铺)$/u,'').replace(/\s+/g,'')||'店铺';
    return `${normalized.slice(0,Math.max(1,12-stamp.length))}${stamp}`.slice(0,12);
  }
  // 批量商品 ID：每行一个（也兼容逗号/空格分隔），只收 6–22 位数字，自动去重。
  function parsePurchaseIds(text){
    const seen=new Set(),ids=[],invalid=[];
    for(const raw of String(text||'').split(/[\n\r,，、;；\s]+/)){
      const value=raw.trim();
      if(!value)continue;
      if(!/^\d{6,22}$/.test(value)){invalid.push(value);continue;}
      if(seen.has(value))continue;
      seen.add(value);ids.push(value);
    }
    return {ids,invalid};
  }
  const formatLocalInput=value=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}T${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}`;
  // 托管礼金：商品 ID 每行一个（5–20 位数字，也兼容逗号/空格），自动去重并统计无效行。
  function parseGiftIds(text){
    const seen=new Set(),ids=[],invalid=[];
    for(const raw of String(text||'').split(/[\n\r,，、;；\s]+/)){
      const value=raw.trim();
      if(!value)continue;
      if(!/^\d{5,20}$/.test(value)){invalid.push(value);continue;}
      if(seen.has(value))continue;
      seen.add(value);ids.push(value);
    }
    return {ids,invalid};
  }
  function readPurchaseForm(){
    const read=selector=>document.querySelector(selector);
    return {
      name:String(read('#pf-name')?.value||'').trim(),
      description:String(read('#pf-description')?.value||'').trim(),
      startsAt:String(read('#pf-startsAt')?.value||''),
      endsAt:String(read('#pf-endsAt')?.value||''),
      threshold:{kind:String(read('#pf-threshold-kind')?.value||'none'),value:Number(read('#pf-threshold-value')?.value)||0},
      discount:{kind:String(read('#pf-discount-kind')?.value||'percentage'),value:Number(read('#pf-discount-value')?.value)},
      stacking:{storeCoupon:Boolean(read('#pf-stack-store')?.checked),platformCoupon:Boolean(read('#pf-stack-platform')?.checked),memberDiscount:Boolean(read('#pf-stack-member')?.checked)},
      otherSkus:Number(read('#pf-other-skus')?.value),
      lastSku:Number(read('#pf-last-sku')?.value)
    };
  }
  async function savePurchaseDraft(values=readPurchaseForm(),idsText=String(document.querySelector('#pf-product-ids')?.value??'')){
    const parsed=String(idsText||'').trim()?parsePurchaseIds(idsText):{ids:[],invalid:[]};
    const plans=arr(moduleData('purchase').plans||moduleData('purchase').activities);
    const current=state.purchasePlanId&&state.purchasePlanId!=='__new__'?plans.find(plan=>String(plan.id)===String(state.purchasePlanId)):null;
    const id=current?.id||((typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')?crypto.randomUUID():`plan-${Date.now()}`);
    if(values.startsAt&&values.endsAt&&values.startsAt>=values.endsAt)throw new Error('结束时间必须晚于开始时间。');
    const previous=arr(current?.scope?.products||current?.products);
    const previousById=new Map(previous.map(item=>[String(item.id),item]));
    const products=parsed.ids.map(productId=>({id:productId,title:String(previousById.get(productId)?.title||'')}));
    if(parsed.invalid.length)toast(`已忽略 ${parsed.invalid.length} 个无效 ID（只接受 6–22 位数字）`,true);
    const name=values.name||generatedPurchaseName(store()?.name||'',values.startsAt);
    const plan={...(current||{}),id,name,description:values.description,startsAt:values.startsAt,endsAt:values.endsAt,threshold:values.threshold,discount:values.discount,stacking:values.stacking,skuDiscountRule:{otherSkus:values.otherSkus,lastSku:values.lastSku},audience:'fans',scope:{...(current?.scope||{}),kind:'selected-products',products},products};
    const result=await api('purchase.save',storePayload({plan}));
    state.purchasePlanId=id;
    if(result)setData('purchase',result);
    return {result,id};
  }
  async function reviewDetail(index,imagesOnly=false) {
    const row=reviewRows()[index];if(!row)return;const images=arr(row.images||row.imageUrls).map(v=>typeof v==='string'?v:v?.url).filter(v=>typeof v==='string'&&/^https:\/\//i.test(v));
    const fields=images.length?`<div class="images-grid">${images.map((url,i)=>`<div><img src="${esc(url)}" alt="评价图片 ${i+1}" loading="lazy" referrerpolicy="no-referrer"><span class="cell-sub">图片 ${i+1}</span></div>`).join('')}</div>`:notice('当前记录未提供可预览的 HTTPS 图片链接。图片数量仍以同步返回为准。');
    await modal({title:imagesOnly?'评价晒图':'订单评价详情',description:`${row.productTitle||row.title||''}\n订单：${row.mainOrderId||row.orderId||row.subOrderId||'—'}\n${row.reviewStatus||row.matchStatus||'待确认'} · 初评 ${row.initialImageCount??0} 张 / 追评 ${row.followUpImageCount??0} 张`,fields:(!imagesOnly?`<div class="confirm-details">${esc(row.content||row.reviewContent||'暂无评价文本')}\n${esc(row.matchReason||row.reason||'')}</div><br>`:'')+fields,confirm:'关闭'});
  }

  async function dispatch(target) {
    const action=target.dataset.action,id=target.dataset.id,module=target.dataset.module;
    if(String(action).startsWith('cloud-')&&await cloudAuthUi.dispatch(target))return;
    if(updateUi?.handleAction(action))return;
    if(action==='open-plugin'){if(pluginUi)await pluginUi.open();return;}
    if(String(action).startsWith('plugin:')&&pluginUi&&await pluginUi.handleAction(action,target))return;
    if(action.startsWith('browserui:')&&await browserUi.handleAction(action,target))return;
    if(action.startsWith('accounts:')&&await accountUi.handleAction(action,target))return;
    if(action.startsWith('business:')&&await businessUi.handleAction(action,target))return;
    if(action.startsWith('insights:')&&await insightUi.handleAction(action,target))return;
    if(action.startsWith('selectionpool:')&&await selectionPoolUi.handleAction(action,target))return;
    if(action==='none')return;
    if(action==='navigate')return navigate(target.dataset.page);
    if(action==='business-progress'){if(id!==state.storeId||!['daily','product'].includes(target.dataset.mode))return;await navigate('business');return businessUi.showProgress(target.dataset.mode);}
    if(action==='dismiss-error')return clearError();
    if(action==='dismiss-progress'){const key=target.dataset.key||'';if(selectionpoolProgressTimer&&!key){clearTimeout(selectionpoolProgressTimer);selectionpoolProgressTimer=null;}delete state.progress[key];renderProgress();return;}
    if(action==='clear-store-cache'){
      const ids=[...document.querySelectorAll('[data-store-cache]')].filter(input=>input.checked).map(input=>input.dataset.storeCache);
      if(!ids.length){toast('请先勾选要清除缓存的店铺',true);return;}
      return perform('settings.clearStoreCache',()=>api('settings.clearStoreCache',{storeIds:ids}),{success:'已清除所选店铺的网页缓存；登录状态未改动。',reload:false});
    }
    if(action==='open-store-data')return perform('settings.openStoreData',()=>api('settings.openStoreData',{storeId:id}),{reload:false,success:'已打开该店铺的数据文件夹'});
    if(action==='clear-store-data'){
      const selected=state.stores.find(item=>item.id===id);if(!selected)return;
      if(!await confirmWrite('清理店铺数据',`即将清理“${selected.name}”在本机保存的日报、精细化、评价与标记数据。`,'店铺仍然保留，登录状态不会被清除；需要时重新同步即可恢复数据。','确认清理'))return;
      return perform('settings.clearStoreData',()=>api('settings.clearStoreData',{storeId:id,confirmed:true}),{success:'已清理该店铺的本机数据；登录状态未改动。',reload:true});
    }
    if(action==='clear-store-folder'){
      const folder=target.dataset.folder;if(!folder)return;
      if(!await confirmWrite('清理数据文件夹',`即将清理已移除店铺留下的数据文件夹“${folder}”。`,'该文件夹中的日报、精细化、评价与标记数据将被删除，无法撤销。','确认清理'))return;
      return perform('settings.clearStoreData',()=>api('settings.clearStoreData',{folder,confirmed:true}),{success:'已清理该文件夹。',reload:true});
    }
    if(action==='set-theme'){
      const theme=target.dataset.theme==='dark'?'dark':target.dataset.theme==='eye'?'eye':'light';
      if(state.theme===theme)return;
      return perform('settings.theme',async()=>{const result=await api('settings.save',{settings:{...state.settings,theme}});state.settings={...state.settings,...result,theme};applyTheme(theme);return result;},{success:'',reload:false});
    }
    if(action==='toggle-sidebar-pin'){
      if(state.busy.has('settings.sidebar'))return;
      const previous=state.sidebarPinned,next=!previous;
      applySidebar(next);
      state.busy.add('settings.sidebar');
      try{
        const result=await api('settings.save',{settings:{...state.settings,sidebar:next?'pinned':'collapsed'}});
        state.settings={...state.settings,...result};
      }catch(error){
        applySidebar(previous);
        showError(error);
      }finally{
        state.busy.delete('settings.sidebar');
      }
      return;
    }
    if(action==='add-store')return storeDialog();
    if(action==='rename-store')return storeDialog(id);
    if(action==='select-store')return selectStore(id);
    if(action==='remove-store'){
      const selected=state.stores.find(s=>s.id===id);if(!selected)return;
      if(!await confirmWrite('移除店铺',`即将从 谢谢工作台移除“${selected.name}”。请先导出需要保留的本机业务数据。`,'这不会删除淘宝平台中的店铺或商品。移除后的本地记录与登录状态以桌面服务处理结果为准。','确认移除'))return;
      return perform('stores.remove',async()=>{await api('stores.remove',{id,confirmed:true});await refreshStores();state.selection.clear();},{success:'店铺已移除',reload:false});
    }
    if(action==='open-backend')return perform('browser.open',()=>api('browser.open',storePayload({kind:target.dataset.kind})),{reload:false});
    if(action==='filter'){state.filters[module]=target.dataset.value;state.tablePage[module]=1;return render();}
    if(action==='page-prev'||action==='page-next'){state.tablePage[module]=Math.max(1,(state.tablePage[module]||1)+(action==='page-next'?1:-1));return render();}
    if(action==='export')return perform(`${module}.export`,async()=>{const result=await api(`${module}.export`,storePayload());if(!result?.canceled)toast(result?.path?`已导出：${result.path}`:'导出完成');return result;},{reload:false});
    if(action==='review-sync'){
      const dates=readDates(),selectedStoreId=state.storeId;
      return perform('reviews.sync',async()=>{const result=await api('reviews.sync',{storeId:selectedStoreId,kind:target.dataset.kind,...dates});setData('reviews',result,selectedStoreId);return result;},{module:'reviews',reload:true,success:'本次同步已结束，请查看同步状态与缺失记录'});
    }
    if(action==='review-cancel')return perform('reviews.cancel',()=>api('reviews.cancel',storePayload()),{module:'reviews',reload:false,success:'已请求停止同步，将保留已完成的数据'});
    if(action==='review-images'||action==='review-detail')return reviewDetail(Number(target.dataset.index),action==='review-images');
    if(action==='promotion-sync'){const dates=readDates();state.selection.clear();return perform('promotion.sync',()=>api('promotion.sync',storePayload(dates)),{module:'promotion',success:'推广同步已结束，请查看实际结果'});}
    if(action==='edit-rule')return ruleDialog(id);
    if(action==='delete-rule'){
      const rule=arr(moduleData('promotion').rules).find(r=>r.id===id);if(!rule)return;
      if(!await confirmWrite('删除推广规则',`删除“${rule.name||'此规则'}”后，该规则将不再参与检查。`,`店铺：${store()?.name||''}\n仅删除本地规则，不会恢复或修改已有推广计划。`,'删除规则'))return;
      return perform('promotion.deleteRule',()=>api('promotion.deleteRule',storePayload({id})),{success:'规则已删除'});
    }
    if(action==='promotion-mode'){
      const mode=target.dataset.mode,d=moduleData('promotion');if((d.mode||'observe')===mode)return;
      if(mode==='live'){
        const rules=arr(d.rules).filter(r=>r.enabled!==false);
        if(!rules.length)throw new Error('请先保存至少一条已启用规则，再启用自动执行。');
        const details=`店铺：${store()?.name||''}\n已同步计划：${arr(d.campaigns).length} 个\n规则：${rules.map(r=>`${r.name||'规则'}（${channelLabel(r.channel)}，花费 ≥ ${r.spendThreshold} 元且${r.channel==='store'?' ROI':'净 ROI'} ≤ ${r.roiThreshold}，每 ${r.intervalMinutes||5} 分钟检查${Number(r.recoverAfterMinutes)>0?`，${r.recoverAfterMinutes} 分钟后恢复`:'，不自动恢复'}）`).join('\n')}`;
        if(!await confirmWrite('启用真实自动推广操作','启用后，程序会按上述店铺已保存规则定时暂停命中的推广计划，并执行规则中授权的恢复操作。保持程序运行时授权持续生效；你可随时切回观察模式。',details,'确认启用自动执行'))return;
      }
      return perform('promotion.setMode',()=>api('promotion.setMode',storePayload({mode,confirmed:mode==='live'})),{success:mode==='live'?'已启用自动执行，请查看执行记录':'已切回观察模式'});
    }
    if(action==='promotion-run'){
      const d=moduleData('promotion');if(d.mode==='live'&&!await confirmWrite('立即执行推广检查','当前已启用自动执行。本次检查会对命中当前规则的计划执行真实暂停或恢复。',`店铺：${store()?.name||''}\n计划数量：${arr(d.campaigns).length}\n当前已启用规则：${arr(d.rules).filter(r=>r.enabled!==false).map(r=>r.name).join('、')}`,'确认检查并执行'))return;
      return perform('promotion.run',()=>api('promotion.run',storePayload()),{success:'规则检查已结束，请查看执行记录'});
    }
    if(action==='promotion-pause'){
      const ids=id?[id]:[...state.selection],campaigns=arr(moduleData('promotion').campaigns).filter(c=>ids.includes(String(c.id||c.campaignId||'')));if(!campaigns.length)return;
      if(!await confirmWrite('暂停推广计划',`将真实暂停当前店铺选定的 ${campaigns.length} 个推广计划。平台确认后才会记录成功。`,`店铺：${store()?.name||''}\n${campaigns.map(c=>`${c.name||c.campaignName||'计划'} · ${c.id||c.campaignId} · ${channelLabel(c.channel)}`).join('\n')}`,'确认暂停'))return;
      return perform('promotion.pause',async()=>{const result=await api('promotion.pause',storePayload({campaigns:campaigns.map(c=>({id:c.id||c.campaignId,channel:c.channel})),confirmed:true}));state.selection.clear();return result;},{success:'暂停操作已结束，请核对平台回读结果'});
    }
    if(action==='purchase-new'){state.purchasePlanId='__new__';render();return;}
    if(action==='purchase-select'){state.purchasePlanId=target.dataset.id||null;render();return;}
    if(action==='purchase-save'){
      // 先把表单值读出来：perform 会立刻重绘页面，重绘后输入框就恢复成已保存的值了。
      const values=readPurchaseForm();
      const idsText=String($('#pf-product-ids')?.value??'');
      return perform('purchase.save',async()=>{const saved=await savePurchaseDraft(values,idsText);toast('草稿已保存');return saved;},{module:'purchase'});
    }
    if(action==='purchase-delete'){
      const plan=arr(moduleData('purchase').plans||moduleData('purchase').activities).find(p=>String(p.id)===String(id));if(!plan)return;
      if(!await confirmWrite('删除内购会任务','只删除本机任务记录，不会影响淘宝后台已经创建的活动。',`店铺：${store()?.name||''}\n任务：${plan.name}`,'确认删除'))return;
      return perform('purchase.delete',async()=>{const result=await api('purchase.delete',storePayload({id}));if(String(state.purchasePlanId)===String(id))state.purchasePlanId=null;return result;},{module:'purchase',success:'任务已删除'});
    }
    if(action==='purchase-clear-products')return perform('purchase.save',async()=>{
      const plan=arr(moduleData('purchase').plans||moduleData('purchase').activities).find(p=>String(p.id)===String(id));if(!plan)throw new Error('任务不存在，请刷新后重试');
      const result=await api('purchase.save',storePayload({plan:{...plan,products:[],scope:{...plan.scope,kind:'selected-products',products:[]}}}));delete state.prepared[id];return result;
    },{module:'purchase',success:'已清空商品'});
    if(action==='purchase-attention-open')return perform('browser.open',async()=>{const result=await api('browser.open',storePayload({kind:'purchase'}));await navigate('browser');return result;},{reload:false});
    // —— 托管礼金（独立模块）——
    if(action==='gift-tab'){const g=state.gift||(state.gift={});g.tab=target.dataset.value==='records'?'records':'enroll';render();return;}
    // 营销创建：顶栏切换内购会 / 托管礼金（两个页签，切换后进入对应页面并加载各自数据）。
    if(action==='marketing-tab'){const value=['hostedgift','complaint'].includes(target.dataset.value)?target.dataset.value:'purchase';state.marketingView=value;return navigate(value);}
    // “同时报名超级老客加速”仅在超级新客加速下可用（与同类工作台一致）。
    if(action==='gift-with-laoke'){const g=state.gift||(state.gift={});g.withLaoke=!g.withLaoke;render();return;}
    if(action==='gift-activity'){const g=state.gift||(state.gift={});g.activity=target.dataset.value||'xingpin';if(g.activity!=='xinke')g.withLaoke=false;g.selectable=[];g.signed=[];render();return;}
    if(action==='gift-rate-mode'){const g=state.gift||(state.gift={});g.mode=target.dataset.value==='sku'?'sku':'item';render();return;}
    if(action==='gift-rate'){const g=state.gift||(state.gift={});g.custom=false;g.rate=Number(target.dataset.value)||15;render();return;}
    if(action==='gift-refresh-local')return loadPage('hostedgift',false);
    if(action==='gift-open')return perform('hostedgift.openPlatform',async()=>{const result=await api('hostedgift.openPlatform',storePayload());await navigate('browser');toast(result?.message||'已打开托管礼金平台页面');return result;},{reload:false});
    if(action==='gift-query')return perform('hostedgift.listSelectable',async()=>{
      const g=state.gift||(state.gift={});
      const result=await api('hostedgift.listSelectable',storePayload({activity:g.activity,itemIds:parseGiftIds(g.idsText).ids}));
      g.selectable=arr(result?.result?.items);g.queryAt=new Date().toISOString();
      toast(result?.result?.message||`查出 ${g.selectable.length} 个可添加商品`);render();return result;
    },{reload:true});
    if(action==='gift-refresh')return perform('hostedgift.listSigned',async()=>{
      const g=state.gift||(state.gift={});
      const result=await api('hostedgift.listSigned',storePayload({activity:g.activity,itemIds:parseGiftIds(g.idsText).ids}));
      g.signed=arr(result?.result?.items);
      toast(result?.result?.message||`已同步 ${g.signed.length} 个已报名商品`);render();return result;
    },{reload:true});
    if(action==='gift-submit'){
      const g=state.gift||(state.gift={}),ids=parseGiftIds(g.idsText).ids;
      if(!ids.length)throw new Error('请先填写商品 ID（每行一个，5–20 位数字）');
      const activity=arr(moduleData('hostedgift').activities).find(item=>item.id===g.activity);
      const withLaoke=g.withLaoke===true&&g.activity==='xinke';
      if(!await confirmWrite('提交托管礼金报名',`将把下列商品按 ${g.rate}% 的${g.mode==='sku'?'SKU 费率':'单品费率'}报名到淘宝“${activity?.label||''}”。${withLaoke?'\n同时报名：超级老客加速。':''}`, `店铺：${store()?.name||''}\n活动类型：${activity?.label||''}\n商品：${ids.length} 个\n费率：${g.rate}%${withLaoke?'\n同时报名：超级老客加速':''}\n${ids.slice(0,10).join('、')}${ids.length>10?' …':''}`,'确认报名'))return;
      return perform('hostedgift.enroll',async()=>{
        const result=await api('hostedgift.enroll',storePayload({activity:g.activity,itemIds:ids,rateMode:g.mode,ratePercent:g.rate,withLaoke}));
        if(result?.local)setData('hostedgift',{...moduleData('hostedgift'),local:result.local});
        const items=arr(result?.result?.items),okCount=items.filter(item=>item.ok!==false).length;
        toast(`报名已提交：${items.length?`${okCount}/${ids.length} 个商品成功`:'请查看报名流水'}`);
        render();return result;
      },{reload:true});
    }
    if(action==='gift-exit'){
      const g=state.gift||(state.gift={}),ids=parseGiftIds(g.idsText).ids;
      if(!ids.length)throw new Error('请先填写要退出的商品 ID');
      if(!await confirmWrite('批量退出托管礼金','将把下列商品从当前活动中退出，请先核对活动类型与商品。',`店铺：${store()?.name||''}\n商品：${ids.length} 个\n${ids.slice(0,10).join('、')}${ids.length>10?' …':''}`,'确认退出'))return;
      return perform('hostedgift.batchExit',async()=>{
        const result=await api('hostedgift.batchExit',storePayload({activity:g.activity,itemIds:ids}));
        if(result?.local)setData('hostedgift',{...moduleData('hostedgift'),local:result.local});
        toast(result?.result?.message||'已提交批量退出');render();return result;
      },{reload:true});
    }
    // —— 投诉打标（独立模块，参考同类工作台）——
    if(action==='ct-view'){const s=state.complaint||(state.complaint={});s.view=['complaint','tag','records'].includes(target.dataset.value)?target.dataset.value:'complaint';render();return;}
    if(action==='ct-scene'){const s=state.complaint||(state.complaint={});s.scene=target.dataset.value||s.scene;render();return;}
    if(action==='ct-tag-type'){const s=state.complaint||(state.complaint={});s.tagType=target.dataset.value||s.tagType;const type=arr(moduleData('complaint').tagTypes).find(item=>item.code===s.tagType);s.tagScene=arr(type?.scenes)[0]?.code||'';render();return;}
    if(action==='ct-tag-scene'){const s=state.complaint||(state.complaint={});s.tagScene=target.dataset.value||s.tagScene;render();return;}
    if(action==='ct-records-filter'){const s=state.complaint||(state.complaint={});s.filter=['all','complaint','tag','failed'].includes(target.dataset.value)?target.dataset.value:'all';render();return;}
    if(action==='ct-exclude'){
      const s=state.complaint||(state.complaint={}),key=target.dataset.order||target.dataset.nick;
      if(key){s.excluded.has(key)?s.excluded.delete(key):s.excluded.add(key);}
      render();return;
    }
    if(action==='ct-keep-multi'){
      const s=state.complaint||(state.complaint={}),preview=s.preview;if(!preview||preview.mode!=='complaint')return;
      const totals=new Map();for(const group of arr(preview.groups))totals.set(group.buyerKey,(totals.get(group.buyerKey)||0)+group.orderIds.length);
      const next=new Set();
      for(const group of arr(preview.groups)){
        const total=totals.get(group.buyerKey)||0;
        if(total<=1||!String(group.buyerKey||'').startsWith('nick:'))for(const id of group.orderIds)next.add(id);
      }
      s.excluded=next;render();return;
    }
    if(action==='ct-restore-all'){const s=state.complaint||(state.complaint={});s.excluded=new Set();render();return;}
    if(action==='ct-preview-back'){const s=state.complaint||(state.complaint={});s.preview=null;s.excluded=new Set();render();return;}
    if(action==='ct-preview-cancel'){const s=state.complaint||(state.complaint={});s.preview=null;s.excluded=new Set();s.orders='';s.nicks='';render();return;}
    if(action==='ct-dismiss-run'){const s=state.complaint||(state.complaint={});s.run=null;s.preview=null;s.excluded=new Set();if(state.page==='complaint')loadPage('complaint',false).catch(showError);render();return;}
    if(action==='ct-open-window')return perform('complaint.open',async()=>{const result=await api('complaint.open',storePayload());toast(result?.message||'已打开营商保页面');return result;},{reload:false});
    if(action==='ct-preview'){
      const s=state.complaint||(state.complaint={});
      const payload=s.view==='tag'
        ?{mode:'tag',sceneCode:s.tagScene,buyerNicks:parseComplaintNicks(s.nicks||'').valid}
        :{mode:'complaint',sceneCode:s.scene,description:String(s.desc||'').trim(),orderIds:parseComplaintOrders(s.orders||'').valid};
      return perform('complaint.preview',async()=>{
        const result=await api('complaint.preview',storePayload(payload));
        s.preview=result?.preview||null;s.excluded=new Set();
        toast(s.preview?(payload.mode==='tag'?`已核对 ${arr(s.preview.nicks).filter(nick=>nick.status==='ready').length} 个可打标账号`:`已核对 ${arr(s.preview.groups).length} 张投诉单`):'没有可提交的内容');
        render();return result;
      },{reload:false});
    }
    if(action==='ct-start'){
      const s=state.complaint||(state.complaint={}),preview=s.preview;if(!preview)return;
      const excluded=s.excluded;
      if(preview.mode==='complaint'){
        const groups=arr(preview.groups).map(group=>({...group,orderIds:group.orderIds.filter(id=>!excluded.has(id))})).filter(group=>group.orderIds.length);
        if(!groups.length){toast('没有可提交的投诉单',true);return;}
        const quota=preview.availableQuota;
        if(quota!=null&&groups.length>quota){toast(`投诉额度不足：剩余 ${quota} 次，本批 ${groups.length} 张。请移除部分订单后再提交。`,true);return;}
        const details=`店铺：${store()?.name||''}\n投诉类型：异常订单 / ${preview.sceneName}\n投诉单：${groups.length} 张（共 ${groups.reduce((sum,group)=>sum+group.orderIds.length,0)} 个订单，按买家合并）\n投诉描述：${preview.description}\n旺旺举证：授权小二查看近 90 天旺旺聊天记录\n间隔：每条之间随机 ${s.gapMin}–${s.gapMax} 秒`;
        const values=await modal({title:'确认提交投诉',description:'以下内容将用当前店铺的已登录浏览器逐条提交到营商保，提交后不能撤回。',fields:details.replace(/\n/g,'<br>')+`<label class="checkline"><input type="checkbox" name="confirmed">我已核对，内容真实</label>`,confirm:'开始提交',validate:v=>v.confirmed!=='on'?'请先勾选「我已核对，内容真实」':''});
        if(!values)return;
        return perform('complaint.start',async()=>{const result=await api('complaint.start',storePayload({previewId:preview.previewId,excludedKeys:[...excluded],gapSeconds:{min:s.gapMin,max:s.gapMax}}));s.run=result?.run||null;s.preview=null;s.excluded=new Set();render();return result;},{success:'已开始逐条提交，进度显示在下方',reload:false});
      }
      const ready=arr(preview.nicks).filter(nick=>nick.status==='ready'&&!excluded.has(nick.buyerNick));
      if(!ready.length){toast('没有可打标的账号',true);return;}
      const details=`店铺：${store()?.name||''}\n打标类型：${preview.typeName} / ${preview.sceneName}\n账号：${ready.length} 个（每个自动关联 1 笔订单）\n间隔：每条之间随机 ${s.gapMin}–${s.gapMax} 秒`;
      const values=await modal({title:'确认批量打标',description:'以下内容将用当前店铺的已登录浏览器逐条提交到营商保，提交后不能撤回。',fields:details.replace(/\n/g,'<br>')+`<label class="checkline"><input type="checkbox" name="confirmed">我已核对，内容真实</label>`,confirm:'开始提交',validate:v=>v.confirmed!=='on'?'请先勾选「我已核对，内容真实」':''});
      if(!values)return;
      return perform('complaint.start',async()=>{const result=await api('complaint.start',storePayload({previewId:preview.previewId,excludedKeys:[...excluded],gapSeconds:{min:s.gapMin,max:s.gapMax}}));s.run=result?.run||null;s.preview=null;s.excluded=new Set();render();return result;},{success:'已开始逐条提交，进度显示在下方',reload:false});
    }
    if(action==='ct-control'){
      const value=['pause','resume','stop'].includes(target.dataset.value)?target.dataset.value:'';if(!value)return;
      return perform(`complaint.control.${value}`,async()=>{
        const result=await api('complaint.control',storePayload({action:value}));
        const s=state.complaint||(state.complaint={});if(result?.run)s.run=result.run;
        render();return result;
      },{reload:false});
    }
    if(action==='purchase-manual-test')return perform('browser.open',async()=>{const result=await api('browser.open',storePayload({kind:'purchase',view:'create'}));await navigate('browser');toast('已打开淘宝内购会创建页，可人工做单品测试（软件不会自动提交）');return result;},{reload:false});
    if(action==='purchase-paste-ids'){
      return perform('purchase.pasteIds',async()=>{
        const input=$('#pf-product-ids');if(!input)throw new Error('请先打开一个任务再粘贴');
        let text='';
        try{text=await navigator.clipboard.readText();}catch{text='';}
        if(!text.trim())throw new Error('剪贴板里没有文本，先复制商品 ID 再点“从剪贴板粘贴”');
        input.value=[String(input.value||'').trim(),text.trim()].filter(Boolean).join('\n');
        const parsed=parsePurchaseIds(input.value);
        const meta=$('.purchase-ids-meta');
        const ok=meta?meta.querySelector('.ok'):null,bad=meta?meta.querySelector('.bad'):null;
        if(ok)ok.innerHTML=`已识别 <b>${parsed.ids.length}</b> 个商品`;
        if(bad)bad.textContent=`${parsed.invalid.length} 个 ID 无效`;
        toast(`已从剪贴板粘贴：识别 ${parsed.ids.length} 个商品${parsed.invalid.length?`，${parsed.invalid.length} 个 ID 无效`:''}`);
        return {ids:parsed.ids.length,invalid:parsed.invalid.length};
      },{reload:false});
    }
    if(action==='purchase-quick-time'){
      const hours=Number(target.dataset.hours)||1;
      const start=new Date(Date.now()+hours*3600*1000);start.setSeconds(0,0);
      const end=new Date(start.getTime()+3*3600*1000);
      const startInput=$('#pf-startsAt'),endInput=$('#pf-endsAt'),nameInput=$('#pf-name');
      if(startInput)startInput.value=formatLocalInput(start);
      if(endInput)endInput.value=formatLocalInput(end);
      if(nameInput&&!nameInput.value.trim())nameInput.value=generatedPurchaseName(store()?.name||'',startInput?.value);
      toast(`${hours} 小时后开始（默认持续 3 小时）`);
      return;
    }
    if(action==='purchase-copy-qr'){
      const plan=arr(moduleData('purchase').plans||moduleData('purchase').activities).find(p=>p.qrCodeDataUrl);
      if(!plan)throw new Error('还没有二维码，创建成功后才能复制');
      return perform('purchase.copyQr',async()=>{
        const blob=await (await fetch(plan.qrCodeDataUrl)).blob();
        if(typeof ClipboardItem!=='function')throw new Error('当前环境不支持复制图片，可右键另存二维码');
        await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
        toast('高清二维码已复制到剪贴板');
        return {ok:true};
      },{reload:false});
    }
    if(action==='purchase-attention-resume')return perform(`purchase.prepare:${id}`,async()=>{
      const result=await api('purchase.prepare',storePayload({id}));if(result?.requestId)state.prepared[id]=result;else delete state.prepared[id];
      toast(result?.preparation?.message||'已重新执行预检');return result;
    },{module:'purchase'});
    if(action==='purchase-template')return perform('purchase.template',async()=>{const result=await api('purchase.template',storePayload());if(!result?.canceled)toast(result?.path?`模板已保存：${result.path}`:'模板已保存');return result;},{reload:false});
    if(action==='purchase-import'){
      const values=readPurchaseForm();
      const idsText=String($('#pf-product-ids')?.value??'');
      return perform(`purchase.import:${id}`,async()=>{
      const planId=(await savePurchaseDraft(values,idsText)).id;
      const imported=await api('purchase.import',storePayload({id:planId}));if(imported?.canceled)return imported;
      const plan=arr(moduleData('purchase').plans||moduleData('purchase').activities).find(p=>String(p.id)===String(planId));if(!plan)throw new Error('活动草稿不存在，请刷新后重试。');
      const products=arr(imported?.products||imported?.rows);if(!products.length)throw new Error('导入表没有可用商品，请检查商品 ID 列。');
      await api('purchase.save',storePayload({plan:{...plan,products,scope:{...plan.scope,kind:'selected-products',products}}}));delete state.prepared[planId];toast(`已为草稿导入 ${products.length} 个商品`);return imported;
    },{module:'purchase'});
    }
    if(action==='purchase-prepare'){
      const values=readPurchaseForm();
      const idsText=String($('#pf-product-ids')?.value??'');
      return perform(`purchase.prepare:${id}`,async()=>{
      const planId=(await savePurchaseDraft(values,idsText)).id;
      const result=await api('purchase.prepare',storePayload({id:planId}));if(result?.requestId)state.prepared[planId]=result;else delete state.prepared[planId];
      toast(result?.preparation?.message||(result?.requestId?'预检通过，请核对并确认创建':'预检未完成，请查看返回状态'));return result;
    },{module:'purchase'});
    }
    if(action==='purchase-create'){
      const prepared=state.prepared[id],plan=arr(moduleData('purchase').plans||moduleData('purchase').activities).find(p=>p.id===id);if(!plan||!prepared?.requestId)throw new Error('请先重新准备活动，获得当前表单的确认凭据。');
      const p=prepared.preparation||{},products=arr(plan.products||plan.scope?.products),preparedProducts=arr(p.products),selectedProducts=preparedProducts.filter(product=>product.status==='selected'),actualCount=preparedProducts.length?selectedProducts.length:products.length,skuCount=selectedProducts.reduce((sum,product)=>sum+(Number(product.skuCount)||0),0);
      if(!await confirmWrite('确认创建淘宝内购会','淘宝预检已通过，确认后立即生效；请核对店铺、活动时间与折扣。',`店铺：${store()?.name||''}\n活动：${p.activityName||p.name||plan.name}\n开始：${p.startsAt||plan.startsAt}\n结束：${p.endsAt||plan.endsAt}\n商品数量：本次可用 ${actualCount} / 草稿 ${products.length}${skuCount?` · ${skuCount} 个 SKU`:''}\n普通 SKU：${plan.otherSkus??plan.skuDiscountRule?.otherSkus} 折\n特殊 SKU：${plan.lastSku??plan.skuDiscountRule?.lastSku} 折（每商品第 6 个，不足 6 个取最后一个）\n${p.message||''}`,'确认创建'))return;
      const requestId=prepared.requestId;delete state.prepared[id];
      return perform(`purchase.create:${id}`,()=>api('purchase.create',storePayload({id,requestId,confirmed:true})),{module:'purchase',success:'创建请求已处理，请检查平台确认结果'});
    }
    if(action==='purchase-close'){
      const plan=arr(moduleData('purchase').plans||moduleData('purchase').activities).find(p=>p.id===id);if(!plan)return;
      if(!await confirmWrite('结束淘宝内购会','将真实结束下列活动，请确认活动名称与所属店铺。',`店铺：${store()?.name||''}\n活动：${plan.name}\n活动 ID：${plan.id}`,'确认结束活动'))return;
      return perform(`purchase.close:${id}`,()=>api('purchase.close',storePayload({id,confirmed:true})),{module:'purchase',success:'结束活动请求已处理，请检查回读结果'});
    }
    if(action==='purchase-resolve-check'){
      const plan=arr(moduleData('purchase').plans||moduleData('purchase').activities).find(p=>p.id===id);if(!plan)return;
      await api('browser.open',storePayload({kind:'purchase',view:'activities'}));
      if(!await confirmWrite('核对内购会创建结果','已打开商家后台。请先在活动列表核对下列名称及时间是否已经创建。若已创建，请勿解锁草稿，以免重复创建。只有确认后台没有该活动后，才继续。',`店铺：${store()?.name||''}\n活动：${plan.platformActivityName||plan.preparation?.activityName||plan.name}\n开始：${plan.preparation?.startsAt||plan.startsAt}\n结束：${plan.preparation?.endsAt||plan.endsAt}\n确认后程序还会读取后台活动列表；若发现同名活动，将继续锁定。`,'我已核对未创建，解锁草稿'))return;
      return perform(`purchase.resolveCheck:${id}`,async()=>{const result=await api('purchase.resolveCheck',storePayload({id,confirmed:true,resolution:'not-created'}));delete state.prepared[id];return result;},{module:'purchase',success:'后台核对已完成，草稿已解锁，请重新准备后创建'});
    }
    // 待核对时读取淘宝活动列表，认领确实已创建的那一条：
    // 确认创建时淘宝会按当前时间校准活动名（如 荣锦初宇10141159 → 荣锦初宇1014033），旧数据会因此卡在“待核对”。
    if(action==='purchase-claim'&&id){
      return perform(`purchase.claim:${id}`,async()=>{
        let listed;
        try{listed=await api('purchase.activities',storePayload());}catch(error){throw new Error('读取淘宝活动列表失败：'+(error?.message||error));}
        const activities=arr(listed?.activities).filter(activity=>activity.status==='running');
        if(!activities.length){toast('淘宝活动列表里没有运行中的活动；如果确认未创建，请点“我已核对未创建，解锁草稿”。',true);return null;}
        const options=activities.map(activity=>`<option value="${esc(activity.name)}">${esc(activity.name)}${activity.startsAt?`（${esc(activity.startsAt)}${activity.endsAt?` 至 ${esc(activity.endsAt)}`:''}）`:''}</option>`).join('');
        const values=await modal({title:'认领已创建的活动',description:'从淘宝活动列表里选择本次任务对应的活动。认领后任务会标记为已创建，可继续用“结束活动”管理。',fields:`<div class="field"><label for="form-claim-activity">后台活动</label><select id="form-claim-activity" name="activityName">${options}</select></div>`,confirm:'认领活动'});
        if(!values?.activityName)return null;
        delete state.prepared[id];
        return api('purchase.resolveCheck',storePayload({id,resolution:'created',activityName:values.activityName,confirmed:true}));
      },{module:'purchase',success:'已认领后台活动，任务标记为已创建'});
    }
    if(action==='qualification-import')return perform('qualification.import',()=>api('qualification.import',storePayload()),{success:'商品表已导入'});
    if(action==='qualification-image')return perform('qualification.addImage',()=>api('qualification.addImage',storePayload({itemId:id})),{success:'真实图片已保存到商品资料'});
    if(action==='qualification-preview'){
      const result=await api('qualification.preview',storePayload({itemId:id}));if(!result?.dataUrl?.startsWith('data:image/'))throw new Error('无法读取本地图片预览。');
      return modal({title:'本地标签图片',description:`店铺：${store()?.name||''}\n商品 ID：${id}`,fields:`<div class="images-grid"><img src="${esc(result.dataUrl)}" alt="本地真实标签图片"></div>`,confirm:'关闭'});
    }
    if(action==='qualification-upload'){
      const all=arr(moduleData('qualification').products||moduleData('qualification').items),products=all.filter(p=>{const pid=String(p.itemId||p.id||p.productId||'');return id?pid===id:Boolean(p.image||p.localImage||p.generatedImage||p.imagePath);});if(!products.length)throw new Error('请先为商品选择真实标签图片。');
      const items=products.map(p=>String(p.itemId||p.id||p.productId));
      if(!await confirmWrite('上传真实标签图片','将把已选本地图片上传到下列商品的标签资料。请先通过“预览”确认图片与商品对应；已有标签或其他必填项异常以实际检查结果为准。',`店铺：${store()?.name||''}\n共 ${products.length} 个商品\n${products.map(p=>`${p.title||p.name||p.productTitle||'商品'} · ${p.itemId||p.id||p.productId}`).join('\n')}`,'确认上传标签图片'))return;
      return perform('qualification.upload',()=>api('qualification.upload',storePayload({itemIds:items,confirmed:true})),{success:'上传已结束，请逐项核对结果'});
    }
    if(action==='compliance-view'){
      state.complianceView=target.dataset.view||'scan';
      return refreshCompliance(state.complianceView,state.complianceJobId).then(()=>{});
    }
    if(action==='compliance-filter'){
      state.complianceFilter={...(state.complianceFilter||{query:'',risk:'all',source:'all',status:'all'}),[target.dataset.field||'risk']:target.dataset.value||'all'};
      render();return;
    }
    if(action==='compliance-job-filter'){
      state.complianceJobFilter={...(state.complianceJobFilter||{status:'all',risk:'all'}),[target.dataset.field||'status']:target.dataset.value||'all'};
      render();return;
    }
    if(action==='compliance-job-rename'){
      const jobId=target.dataset.id;
      const job=arr(moduleData('compliance').jobs).find(item=>item.id===jobId);
      if(!job)throw new Error('排查任务不存在，请刷新后重试');
      const values=await modal({title:'修改店铺名',description:'默认取表格第一列“店铺名/旺旺名称”；表格里没有识别到就显示“无”，可以在这里补上。',fields:inputField('storeName','店铺名',job.storeName||'','text','maxlength="60" placeholder="输入店铺名称；留空表示未识别"'),confirm:'保存店铺名'});
      if(!values)return;
      const name=String(values.storeName||'').trim();
      return perform('compliance.renameJob',async()=>{
        const result=await api('compliance.renameJob',{storeId:state.storeId,jobId,name});
        const data=moduleData('compliance');
        setData('compliance',{...data,jobs:arr(result?.jobs||data.jobs),job:data.job&&data.job.id===jobId?{...data.job,storeName:name}:data.job});
        render();
        return result;
      },{success:name?`店铺名已改为「${name}」`:'已清空店铺名（界面显示“无”）',reload:false});
    }
    if(action==='compliance-job-select'){
      const jobId=target.dataset.id||null;
      if(!jobId||jobId===state.complianceJobId)return;
      state.complianceJobId=jobId;
      state.complianceIssueSelection=new Set();
      state.complianceIssueId=null;
      return refreshCompliance(state.complianceView,state.complianceJobId).then(()=>{});
    }
    if(action==='compliance-issue-select'){
      state.complianceIssueId=target.dataset.id||null;
      render();return;
    }
    if(action==='compliance-group'){
      state.complianceGroup=target.dataset.value==='product'?'product':'issue';
      state.complianceProductOpen=null;
      render();return;
    }
    if(action==='compliance-product-expand'){
      const productId=target.dataset.id||'';
      state.complianceProductOpen=state.complianceProductOpen===productId?null:productId;
      render();return;
    }
    if(action==='compliance-import-path'){
      const filePath=String($('[data-compliance-path]')?.value||'').trim();
      if(!filePath)throw new Error('请先填写商品表格的完整路径');
      return importComplianceFile(filePath).then(result=>{const input=$('[data-compliance-path]');if(input&&!result?.canceled)input.value='';return result;});
    }
    if(action==='compliance-job-process'){
      state.complianceView='process';state.complianceJobId=target.dataset.job||null;
      state.complianceIssueSelection=new Set();
      state.complianceIssueId=null;
      return refreshCompliance('process',state.complianceJobId).then(()=>{});
    }
    if(action==='compliance-import')return importComplianceFile();
    if(action==='compliance-job-scan'){
      const jobId=target.dataset.job||state.complianceJobId;
      if(!jobId)throw new Error('请先导入商品表格');
      state.complianceRate=null;
      // 第一次进度回传之前也先按“扫描中”显示，队列和进度卡立刻有正确状态。
      const currentData=moduleData('compliance');
      state.complianceJobId=jobId;
      setData('compliance',{...currentData,selectedJobId:jobId,jobs:arr(currentData.jobs).map(item=>item.id===jobId?{...item,status:'scanning',progress:{...item.progress,message:'正在准备扫描'}}:item)});
      render();
      return perform('compliance.scan',async()=>{
        const result=await api('compliance.scan',{storeId:state.storeId,jobId});
        await refreshCompliance(state.complianceView==='process'?'process':'scan',jobId);
        const summary=result?.job||{};
        toast(summary.status==='completed'?`扫描完成：命中 ${Number(summary.issueCount||0)} 个问题，可到“违规处理中心”复核`:'扫描已停止，已完成的结果保留');
        return result;
      },{reload:false});
    }
    if(action==='compliance-cancel')return perform('compliance.cancel',async()=>{const result=await api('compliance.cancel',{storeId:state.storeId});toast(result?.message||'已请求停止');return result;},{reload:false});
    if(action==='compliance-job-delete'){
      const jobId=target.dataset.job||state.complianceJobId;
      const job=arr(moduleData('compliance').jobs).find(item=>item.id===jobId);
      if(!await confirmWrite('删除排查任务','任务与它的问题记录会从本机删除；已经导出的报告不受影响。',`任务：${job?.name||jobId}`,'删除任务'))return;
      return perform('compliance.deleteJob',async()=>{const result=await api('compliance.deleteJob',{storeId:state.storeId,jobId});if(state.complianceJobId===jobId)state.complianceJobId=null;await refreshCompliance();return result;},{success:'排查任务已删除',reload:false});
    }
    if(action==='compliance-export'){
      const jobId=target.dataset.job||state.complianceJobId,filter=target.dataset.filter||'all';
      if(!jobId)throw new Error('请先选择排查任务');
      return perform('compliance.export',async()=>{const result=await api('compliance.export',{storeId:state.storeId,jobId,filter});if(!result?.canceled)toast(result?.path?`报告已导出：${result.path}`:'报告已导出');return result;},{reload:false});
    }
    if(action==='compliance-issue-status'){
      const jobId=target.dataset.job,issueId=target.dataset.issue,status=target.dataset.status;
      return perform('compliance.updateIssue',async()=>{const result=await api('compliance.updateIssue',{storeId:state.storeId,jobId,issueId,status});const d=moduleData('compliance');if(d?.job?.issues){const issues=d.job.issues.map(issue=>issue.id===issueId?{...issue,status}:issue);setData('compliance',{...d,job:{...d.job,issues},jobs:arr(d.jobs).map(item=>item.id===jobId?{...item,pending:issues.filter(issue=>issue.status==='pending').length}:item)});}render();return result;},{reload:false});
    }
    if(action==='compliance-issue-image'){
      const url=target.dataset.url;
      return perform('compliance.image',async()=>{const result=await api('compliance.image',{storeId:state.storeId,url});if(!result?.dataUrl)throw new Error('图片读取失败');await modal({title:'违规图片预览',description:url,fields:`<div style="max-height:60vh;overflow:auto"><img src="${result.dataUrl}" alt="违规图片" style="max-width:100%;border-radius:8px"></div>`,confirm:'关闭',cancel:null});return result;},{reload:false});
    }
    if(action==='compliance-rules-import')return perform('compliance.importRules',async()=>{const result=await api('compliance.importRules',{storeId:state.storeId});if(result?.canceled)return result;await refreshCompliance('rules');return result;},{success:'词库已导入',reload:false});
    if(action==='compliance-rules-reset'){
      if(!await confirmWrite('恢复默认词库','本机自定义的规则会被内置词库替换（不会影响排查任务与问题记录）。','','恢复默认'))return;
      return perform('compliance.resetRules',async()=>{const result=await api('compliance.resetRules',{storeId:state.storeId});await refreshCompliance('rules');return result;},{success:'已恢复默认词库',reload:false});
    }
    if(action==='compliance-rule-delete'){
      const id=target.dataset.id;
      const rules=arr(moduleData('compliance').rules).filter(rule=>rule.id!==id);
      if(state.complianceRuleDetailId===id){state.complianceRuleDetailId=null;state.complianceWordSelection=new Set();}
      return perform('compliance.saveRules',async()=>{const result=await api('compliance.saveRules',{storeId:state.storeId,rules});setData('compliance',{...moduleData('compliance'),rules:result?.rules||rules});render();return result;},{success:'规则已删除',reload:false});
    }
    if(action==='compliance-rule-category'){
      state.complianceRuleCategory=target.dataset.value||'高风险违规词';
      render();return;
    }
    if(action==='compliance-rule-filter'){
      state.complianceRuleFilter={...(state.complianceRuleFilter||{category:'all',level:'all',position:'all'}),[target.dataset.field||'category']:target.dataset.value||'all'};
      render();return;
    }
    if(action==='compliance-rule-create'){
      const keywords=String($('#compliance-rule-keywords')?.value||'').split(/[,，;；\n\r]+/).map(item=>item.trim()).filter(Boolean).slice(0,200);
      if(!keywords.length)throw new Error('请先填写需要拦截的关键词');
      const rules=arr(moduleData('compliance').rules);
      const rule={id:`custom-${Date.now().toString(36)}`,name:keywords[0].slice(0,60),category:state.complianceRuleCategory||'高风险违规词',level:$('#compliance-rule-level')?.value||'high',keywords,exceptions:'',enabled:$('#compliance-rule-enabled')?.checked!==false,position:$('#compliance-rule-position')?.value||'全部',suggestion:String($('#compliance-rule-suggestion')?.value||'').trim().slice(0,200),note:String($('#compliance-rule-note')?.value||'').trim().slice(0,200)};
      const next=[...rules,rule];
      return perform('compliance.saveRules',async()=>{const result=await api('compliance.saveRules',{storeId:state.storeId,rules:next});setData('compliance',{...moduleData('compliance'),rules:result?.rules||next});render();return result;},{success:'违规词已加入词库',reload:false});
    }
    if(action==='compliance-rule-exceptions'){
      const id=target.dataset.id;
      const rule=arr(moduleData('compliance').rules).find(item=>item.id===id);
      if(!rule)throw new Error('规则不存在，请刷新后重试');
      const values=await modal({title:'例外词（不拦截）',description:'上下文里出现这些词时，这条规则会跳过不再命中。多个词用逗号或换行分隔。',fields:inputField('exceptions','例外词',arr(rule.exceptions).join('，'),'text','placeholder="例如：第一现场"'),confirm:'保存例外词'});
      if(!values)return;
      const next=arr(moduleData('compliance').rules).map(item=>item.id===id?{...item,exceptions:String(values.exceptions||'').trim()}:item);
      return perform('compliance.saveRules',async()=>{const result=await api('compliance.saveRules',{storeId:state.storeId,rules:next});setData('compliance',{...moduleData('compliance'),rules:result?.rules||next});render();return result;},{success:'例外词已保存',reload:false});
    }
    // 新增 / 编辑：只针对这一组违规词（不再把整份词库塞进同一个弹窗）。
    if(action==='compliance-rule-add'||action==='compliance-rule-edit'){
      const editing=action==='compliance-rule-edit';
      const rules=arr(moduleData('compliance').rules);
      const rule=editing?rules.find(item=>item.id===target.dataset.id):{name:'',category:'自定义',level:'medium',keywords:'',exceptions:'',enabled:true,position:'全部',suggestion:'',note:''};
      if(!rule)throw new Error('词组不存在，请刷新后重试');
      const level=LEVELS_FOR_RULES.includes(rule.level)?rule.level:'medium';
      const fields=`<div class="form-grid">
        ${inputField('name','词组名称',rule.name||'','text','required maxlength="100" placeholder="例如：绝对化用语"')}
        ${inputField('category','分类',rule.category||'自定义','text','maxlength="40" placeholder="例如：广告法"')}
        <div class="field"><label for="form-level">风险等级</label><select id="form-level" name="level">${LEVELS_FOR_RULES.map(value=>`<option value="${value}" ${level===value?'selected':''}>${value==='high'?'高风险':value==='medium'?'中风险':'低风险'}</option>`).join('')}</select></div>
        <div class="field"><label for="form-position">命中位置</label><select id="form-position" name="position">${RULE_POSITIONS.map(value=>`<option value="${esc(value)}" ${(rule.position||'全部')===value?'selected':''}>${esc(value)}</option>`).join('')}</select></div>
        <div class="field full"><label for="form-keywords">违规词（一行一个，也可用逗号分隔）</label><textarea id="form-keywords" name="keywords" rows="6" required placeholder="多个关键词用逗号或换行分隔">${esc(arr(rule.keywords).join('\n'))}</textarea></div>
        <div class="field full"><label for="form-exceptions">例外词（可选）</label><input id="form-exceptions" name="exceptions" type="text" value="${esc(arr(rule.exceptions).join('，'))}" placeholder="上下文含这些词时跳过"></div>
        <div class="field full"><label for="form-suggestion">整改建议</label><textarea id="form-suggestion" name="suggestion" rows="2" placeholder="例如：删除或修改违规表述，并核对平台规则与经营资质。">${esc(rule.suggestion||'')}</textarea></div>
        <div class="field full"><label for="form-note">备注</label><input id="form-note" name="note" type="text" value="${esc(rule.note||'')}" placeholder="可选 · 来源、批次或说明"></div>
        <label class="checkline full"><input type="checkbox" name="enabled" ${rule.enabled===false?'':'checked'}>启用（停用的词组不参与扫描）</label>
      </div>`;
      const values=await modal({title:editing?'编辑违规词组':'新增违规词组',description:'只改动这一组违规词；保存后立即生效。',fields,confirm:'保存词组',validate:v=>!String(v.keywords||'').trim()?'请至少填写一个违规词':''});
      if(!values)return;
      const nextRule={...(editing?rule:{}),id:editing?rule.id:`custom-${Date.now().toString(36)}`,name:String(values.name||'').trim()||String(values.keywords||'').split(/[,，;；\n\r]+/)[0].slice(0,40),category:String(values.category||'自定义').trim()||'自定义',level:LEVELS_FOR_RULES.includes(values.level)?values.level:'medium',position:values.position||'全部',suggestion:String(values.suggestion||'').trim(),note:String(values.note||'').trim(),keywords:String(values.keywords||'').trim(),exceptions:String(values.exceptions||'').trim(),enabled:values.enabled==='on'};
      const next=editing?rules.map(item=>item.id===rule.id?nextRule:item):[...rules,nextRule];
      return perform('compliance.saveRules',async()=>{const result=await api('compliance.saveRules',{storeId:state.storeId,rules:next});setData('compliance',{...moduleData('compliance'),rules:result?.rules||next});render();return result;},{success:editing?'词组已保存':'词组已加入词库',reload:false});
    }
    // 查看：进入这一组（页面内部跳转），里面的词逐个成行，可单独编辑/删除或勾选批量删除。
    if(action==='compliance-rule-view'){
      const rule=arr(moduleData('compliance').rules).find(item=>item.id===target.dataset.id);
      if(!rule)throw new Error('词组不存在，请刷新后重试');
      state.complianceRuleDetailId=rule.id;
      state.complianceWordSelection=new Set();
      state.search.complianceWord='';
      state.tablePage.complianceWords=1;
      render();return;
    }
    if(action==='compliance-rule-back'){
      state.complianceRuleDetailId=null;
      state.complianceWordSelection=new Set();
      render();return;
    }
    // 保存某一组的新词库（新增/改名/删除都走这里）。
    const saveRuleWords=(ruleId,keywords,success)=>{
      const next=arr(moduleData('compliance').rules).map(item=>item.id===ruleId?{...item,keywords}:item);
      return perform('compliance.saveRules',async()=>{const result=await api('compliance.saveRules',{storeId:state.storeId,rules:next});setData('compliance',{...moduleData('compliance'),rules:result?.rules||next});render();return result;},{success,reload:false});
    };
    if(action==='compliance-word-add-new'){
      const rule=arr(moduleData('compliance').rules).find(item=>item.id===target.dataset.id);
      if(!rule)throw new Error('词组不存在，请刷新后重试');
      const values=await modal({title:'添加一个违规词',description:`加到「${rule.name}」这一组。`,fields:inputField('word','违规词','','text','required maxlength="200" placeholder="例如：全网第一"'),confirm:'添加'});
      if(!values)return;
      const word=String(values.word||'').trim();
      if(!word)return;
      if(arr(rule.keywords).includes(word)){toast('这一组里已经有这个词了');return;}
      return saveRuleWords(rule.id,[...arr(rule.keywords),word],'已添加');
    }
    if(action==='compliance-word-edit'){
      const rule=arr(moduleData('compliance').rules).find(item=>item.id===state.complianceRuleDetailId);
      const index=Number(target.dataset.index);
      if(!rule||!Number.isInteger(index)||!arr(rule.keywords)[index])throw new Error('这个词不存在，请刷新后重试');
      const current=arr(rule.keywords)[index];
      const values=await modal({title:'编辑这个违规词',description:`所在分组：${rule.name}`,fields:inputField('word','违规词',current,'text','required maxlength="200"'),confirm:'保存'});
      if(!values)return;
      const word=String(values.word||'').trim();
      if(!word)return;
      const keywords=[...arr(rule.keywords)];keywords[index]=word;
      return saveRuleWords(rule.id,keywords,'已保存');
    }
    if(action==='compliance-word-delete'){
      const rule=arr(moduleData('compliance').rules).find(item=>item.id===state.complianceRuleDetailId);
      const index=Number(target.dataset.index);
      if(!rule||!Number.isInteger(index)||!arr(rule.keywords)[index])throw new Error('这个词不存在，请刷新后重试');
      const keywords=[...arr(rule.keywords)];
      if(keywords.length<=1)throw new Error('这一组至少要保留一个违规词；不想扫描就先把这一组停用');
      const [removed]=keywords.splice(index,1);
      if(!await confirmWrite('删除这个违规词',`将从「${rule.name}」里删除：${removed}`,'','确认删除'))return;
      state.complianceWordSelection.delete(removed);
      return saveRuleWords(rule.id,keywords,'已删除');
    }
    if(action==='compliance-word-delete-selected'){
      const rule=arr(moduleData('compliance').rules).find(item=>item.id===state.complianceRuleDetailId);
      const selected=state.complianceWordSelection instanceof Set?state.complianceWordSelection:new Set();
      if(!rule||!selected.size)return;
      const keywords=arr(rule.keywords).filter(word=>!selected.has(word));
      if(!keywords.length)throw new Error('这一组至少要保留一个违规词；不想扫描就先把这一组停用');
      if(!await confirmWrite('批量删除违规词',`将从「${rule.name}」里删除 ${selected.size} 个词。`,`删除：${[...selected].join('、')}`,'确认删除'))return;
      state.complianceWordSelection=new Set();
      return saveRuleWords(rule.id,keywords,`已删除 ${selected.size} 个词`);
    }
    // 处理中心：勾选多条后批量改状态。
    if(action==='compliance-issue-batch'){
      const status=target.dataset.status;
      const ids=[...(state.complianceIssueSelection instanceof Set?state.complianceIssueSelection:new Set())];
      const jobId=target.dataset.job||state.complianceJobId;
      if(!ids.length||!jobId)return;
      const labels={confirmed:'确认违规',ignored:'忽略',fixed:'标记已整改'};
      return perform('compliance.updateIssue',async()=>{
        const results=await Promise.all(ids.map(issueId=>api('compliance.updateIssue',{storeId:state.storeId,jobId,issueId,status})));
        const data=moduleData('compliance');
        if(data?.job?.issues){
          const next=ids.reduce((map,id)=>map.set(id,status),new Map());
          const issues=data.job.issues.map(issue=>next.has(issue.id)?{...issue,status:next.get(issue.id)}:issue);
          setData('compliance',{...data,job:{...data.job,issues},jobs:arr(data.jobs).map(item=>item.id===jobId?{...item,pending:issues.filter(issue=>issue.status==='pending').length}:item)});
        }
        state.complianceIssueSelection=new Set();
        render();
        return results;
      },{success:`已对 ${ids.length} 条问题执行「${labels[status]||'更新'}」`,reload:false});
    }
    if(action==='compliance-issue-clear'){state.complianceIssueSelection=new Set();render();return;}
    if(action==='compliance-billing'){
      const billing=moduleData('compliance').billing||{};
      const values=await modal({title:'图片识别单价',description:'识别成功的图片按这个单价计费（元/张）。',fields:inputField('unitPrice','单价（元/张）',String(billing.unitPrice??0.01),'number','required min="0" max="100" step="0.001"'),confirm:'保存单价'});
      if(!values)return;
      return perform('compliance.billingUpdate',async()=>{const result=await api('compliance.billingUpdate',{storeId:state.storeId,unitPrice:values.unitPrice});setData('compliance',{...moduleData('compliance'),billing:result?.billing||billing});render();return result;},{success:'单价已保存',reload:false});
    }
    if(action==='compliance-topup'){
      const billing=moduleData('compliance').billing||{};
      const values=await modal({title:'账户充值','description':`当前余额 ¥${Number(billing.balance||0).toFixed(2)}。充值是本机记账，用于统计图片识别费用。`,fields:inputField('amount','充值金额（元）','10','number','required min="0.01" max="100000" step="0.01"')+inputField('note','备注','手动充值','text','maxlength="120"'),confirm:'确认充值'});
      if(!values)return;
      return perform('compliance.billingUpdate',async()=>{const result=await api('compliance.billingUpdate',{storeId:state.storeId,topUp:values.amount,note:values.note});setData('compliance',{...moduleData('compliance'),billing:result?.billing||billing});render();return result;},{success:'充值已记录',reload:false});
    }
    if(action==='open-data')return perform('app.openDataDir',()=>api('app.openDataDir'),{reload:false});
    if(action==='backup-export')return perform('data.exportBackup',async()=>{const result=await api('data.exportBackup');if(!result?.canceled)toast(result?.path?`备份已导出：${result.path}`:'备份已导出');return result;},{reload:false});
    if(action==='backup-import'){
      if(!await confirmWrite('从备份恢复本地数据','导入会恢复备份中的业务数据，可能覆盖本机现有记录。请确认已经导出需要保留的当前数据。','恢复后请核对店铺与推广规则。店铺登录需要在本机官方页面重新完成。','选择备份并恢复'))return;
      return perform('data.importBackup',async()=>{const result=await api('data.importBackup',{confirmed:true});if(result?.canceled)return result;state.cache={};state.prepared={};await refreshStores();state.settings=await api('settings.load')||{};toast('数据恢复已结束，请核对店铺与规则');return result;},{reload:false});
    }
    if(action==='save-settings'){
      const values=Object.fromEntries(new FormData($('#settings-form')));return perform('settings.save',async()=>{state.settings=await api('settings.save',{ai:{...state.settings.ai,enabled:false,note:values.note||''}})||{};},{success:'预备备注已保存，AI 功能仍未启用',reload:false});
    }
    if(action==='choose-path'||action==='reset-path'){
      const method=action==='choose-path'?'settings.choosePath':'settings.resetPath';
      return perform(method,async()=>{const result=await api(method,{kind:target.dataset.kind});if(result?.canceled)return result;state.settings={...state.settings,paths:result};toast(result.message||'位置已保存');return result;},{reload:false});
    }
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('[data-action]');
    if(!target||target.disabled){cloudAuthUi?.dismissContextMenu?.(event.target);return;}
    const keepContextMenu=target.dataset.action==='cloud-tree-menu';
    Promise.resolve(dispatch(target)).catch(showError).finally(()=>{if(!keepContextMenu)cloudAuthUi?.dismissContextMenu?.();});
  });
  document.addEventListener('contextmenu',event=>{
    if(cloudAuthUi?.handleContextMenu?.(event.target,event))event.preventDefault();
  });
  document.addEventListener('submit',event=>{
    const form=event.target.closest?.('[data-cloud-form]');
    if(!form)return;
    event.preventDefault();
    const kind=form.dataset.cloudForm;
    Promise.resolve(cloudAuthUi.dispatch({dataset:{action:`cloud-${kind}`}})).catch(error=>{
      showError(error);
    });
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing||event.altKey||event.ctrlKey||event.metaKey)return;
    const input=event.target;
    if(!input?.matches?.('input'))return;
    if(input.closest?.('.cloud-permission-picker')&&input.closest?.('#dialog')){event.preventDefault();return;}
    const form=input.closest?.('[data-cloud-form]');
    if(!form)return;
    event.preventDefault();
    const kind=form.dataset.cloudForm;
    Promise.resolve(cloudAuthUi.dispatch({dataset:{action:`cloud-${kind}`}})).catch(showError);
  });
  // 违规扫描：拖拽 Excel / CSV 到导入区（桌面程序里把拖入的文件还原成本机路径）。
  document.addEventListener('dragover',event=>{const zone=event.target.closest?.('.compliance-dropzone');if(!zone)return;event.preventDefault();zone.classList.add('dragover');});
  document.addEventListener('dragleave',event=>{const zone=event.target.closest?.('.compliance-dropzone');if(zone)zone.classList.remove('dragover');});
  document.addEventListener('drop',event=>{
    const zone=event.target.closest?.('.compliance-dropzone');if(!zone)return;
    event.preventDefault();zone.classList.remove('dragover');
    const file=event.dataTransfer?.files?.[0];
    if(!file)return;
    const filePath=window.xx?.pathForFile?.(file)||file.path||'';
    if(!filePath){toast('拖拽的文件读不到本机路径，请点击“选择文件”。',true);return;}
    importComplianceFile(filePath).catch(showError);
  });
  // 顶部这一排控件已按用户要求隐藏（元素可能不存在），监听要容错。
  $('#add-store')?.addEventListener('click',()=>storeDialog().catch(showError));
  $('#store-select')?.addEventListener('change',event=>selectStore(event.target.value).catch(showError));
  document.addEventListener('change',event=>{
    const target=event.target;
    if(target?.matches?.('[data-store-cache-all]')){
      document.querySelectorAll('[data-store-cache]').forEach(input=>{input.checked=target.checked===true;});
      return;
    }
    if(target?.matches?.('[data-store-cache]')){
      const boxes=[...document.querySelectorAll('[data-store-cache]')];
      const all=document.querySelector('[data-store-cache-all]');
      if(all)all.checked=boxes.length>0&&boxes.every(input=>input.checked);
      return;
    }
    if(target?.matches?.('[data-profile-avatar], [data-member-status-filter], [data-cloud-move-department], #cloud-department, #cloud-team')){cloudAuthUi.handleChange(event).catch(showError);return;}
    // 上品库编辑器打开时优先处理它的行内输入，避免被其它模块先消费。
    if(selectionPoolUi.handleChange(event))return;
    if(businessUi.handleChange(event))return;
    if(insightUi.handleChange(event))return;
    if(target.id==='date-start'||target.id==='date-end'){state.dates={start:$('#date-start')?.value||'',end:$('#date-end')?.value||''};return;}
    if(target.dataset.complianceFilter){state.complianceFilter={...(state.complianceFilter||{query:'',risk:'all',source:'all',status:'all'}),[target.dataset.complianceFilter]:target.value};render();return;}
    if(target.dataset.complianceJobFilter){state.complianceJobFilter={...(state.complianceJobFilter||{status:'all',risk:'all'}),[target.dataset.complianceJobFilter]:target.value};render();return;}
    if(target.dataset.complianceRuleFilter){state.complianceRuleFilter={...(state.complianceRuleFilter||{category:'all',level:'all',position:'all'}),[target.dataset.complianceRuleFilter]:target.value};render();return;}
    if(target.dataset.complianceRuleToggle){
      const id=target.dataset.complianceRuleToggle,enabled=target.checked;
      const rules=arr(moduleData('compliance').rules).map(rule=>rule.id===id?{...rule,enabled}:rule);
      perform('compliance.saveRules',async()=>{const result=await api('compliance.saveRules',{storeId:state.storeId,rules});setData('compliance',{...moduleData('compliance'),rules:result?.rules||rules});return result;},{success:`已${enabled?'启用':'停用'}这条违规词`,reload:false}).catch(showError);
      return;
    }
    if(target.dataset.complianceExport){
      const filter=target.value,jobId=state.complianceJobId;target.value='';
      if(!filter||!jobId)return;
      perform('compliance.export',async()=>{const result=await api('compliance.export',{storeId:state.storeId,jobId,filter});if(!result?.canceled)toast(result?.path?`报告已导出：${result.path}`:'报告已导出');return result;},{reload:false}).catch(showError);
      return;
    }
    // 处理中心：单条勾选 / 全选（当前筛选）。
    if(target.dataset.complianceIssueSelect!==undefined){
      const id=target.dataset.complianceIssueSelect;
      const set=state.complianceIssueSelection instanceof Set?state.complianceIssueSelection:(state.complianceIssueSelection=new Set());
      target.checked?set.add(id):set.delete(id);
      render();return;
    }
    if(target.dataset.complianceIssueSelectAll!==undefined){
      const set=state.complianceIssueSelection instanceof Set?state.complianceIssueSelection:(state.complianceIssueSelection=new Set());
      if(target.checked){
        for(const issue of filteredIssuesForSelection())set.add(issue.id);
      }else set.clear();
      render();return;
    }
    // 词库分组详情：单条勾选 / 全选本组词。
    if(target.dataset.complianceWordSelect!==undefined){
      const word=target.dataset.complianceWordSelect;
      const set=state.complianceWordSelection instanceof Set?state.complianceWordSelection:(state.complianceWordSelection=new Set());
      target.checked?set.add(word):set.delete(word);
      render();return;
    }
    if(target.dataset.complianceWordSelectAll!==undefined){
      const rule=arr(moduleData('compliance').rules).find(item=>item.id===state.complianceRuleDetailId);
      const set=new Set();
      if(target.checked&&rule)for(const word of arr(rule.keywords))set.add(word);
      state.complianceWordSelection=set;
      render();return;
    }
    if(target.dataset.campaign){target.checked?state.selection.add(target.dataset.campaign):state.selection.delete(target.dataset.campaign);const selected=[...state.selection];render();state.selection=new Set(selected);return;}
    if(target.id==='campaign-select-all'){
      document.querySelectorAll('[data-campaign]').forEach(input=>{target.checked?state.selection.add(input.dataset.campaign):state.selection.delete(input.dataset.campaign);});render();
    }
  });
  let searchTimer;
  let complianceRenderTimer=null;
let complaintRenderTimer=null;
  // 上品库顶部进度的兜底收起：主进程异常中断也不会让提示永远挂在页面上。
  let selectionpoolProgressTimer=null;
  document.addEventListener('input',event=>{
    if(selectionPoolUi.handleInput(event))return;
    if(cloudAuthUi?.handleInput?.(event))return;
    if(businessUi.handleChange(event))return;
    // 内购会：商品 ID 文本框实时统计（已识别 / 无效）。
    if(event.target&&event.target.id==='pf-product-ids'){
      const parsed=parsePurchaseIds(event.target.value);
      const meta=$('.purchase-ids-meta'),ok=meta?meta.querySelector('.ok'):null,bad=meta?meta.querySelector('.bad'):null;
      if(ok)ok.innerHTML=`已识别 <b>${parsed.ids.length}</b> 个商品`;
      if(bad)bad.textContent=`${parsed.invalid.length} 个 ID 无效`;
      return;
    }
    // 托管礼金：商品 ID 实时统计 + 自定义费率。
    if(event.target&&event.target.id==='gift-ids'){
      const g=state.gift||(state.gift={});
      g.idsText=event.target.value;
      const parsed=parseGiftIds(g.idsText);
      const counter=$('.gift-ids-count');
      if(counter)counter.innerHTML=`已输入 <b>${parsed.ids.length}</b> 个${parsed.invalid.length?` · ${parsed.invalid.length} 个无效`:''}`;
      return;
    }
    if(event.target&&event.target.id==='gift-rate-input'){
      const g=state.gift||(state.gift={});
      const value=Number(event.target.value);
      if(Number.isFinite(value)&&value>0&&value<=100){
        g.custom=true;g.rate=value;
        document.querySelectorAll('.gift-rate[data-action="gift-rate"]').forEach(node=>node.classList.remove('active'));
      }
      return;
    }
    // 投诉打标：订单号 / 旺旺昵称 实时计数；投诉描述与间隔只更新状态，不整页重绘。
    if(event.target&&event.target.id==='ct-orders'){
      const s=state.complaint||(state.complaint={});s.orders=event.target.value;
      const parsed=parseComplaintOrders(s.orders);
      const put=(cls,value)=>{const node=$(`.${cls}`);if(node)node.textContent=String(value);};
      put('ct-orders-valid',parsed.valid.length);put('ct-orders-dup',parsed.duplicates.length);put('ct-orders-bad',parsed.invalid.length);
      const previewButton=document.querySelector('[data-action="ct-preview"]');
      if(previewButton&&previewButton.textContent.includes('单'))previewButton.textContent=`解析并预览（${parsed.valid.length} 单）`;
      return;
    }
    if(event.target&&event.target.id==='ct-nicks'){
      const s=state.complaint||(state.complaint={});s.nicks=event.target.value;
      const parsed=parseComplaintNicks(s.nicks);
      const put=(cls,value)=>{const node=$(`.${cls}`);if(node)node.textContent=String(value);};
      put('ct-nicks-valid',parsed.valid.length);put('ct-nicks-dup',parsed.duplicates.length);put('ct-nicks-bad',parsed.invalid.length);
      const previewButton=document.querySelector('[data-action="ct-preview"]');
      if(previewButton&&previewButton.textContent.includes('个'))previewButton.textContent=`解析并预览（${parsed.valid.length} 个）`;
      return;
    }
    if(event.target&&event.target.id==='ct-desc'){
      const s=state.complaint||(state.complaint={});s.desc=event.target.value;return;
    }
    if(event.target&&event.target.dataset&&event.target.dataset.action==='ct-gap'){
      const s=state.complaint||(state.complaint={});const value=Number(event.target.value);
      if(Number.isFinite(value)){
        const clamped=Math.min(60,Math.max(2,Math.round(value)));
        if(event.target.dataset.which==='max')s.gapMax=Math.max(s.gapMin,clamped);
        else{s.gapMin=clamped;if(s.gapMax<s.gapMin)s.gapMax=s.gapMin;}
      }
      return;
    }
    const module=event.target.dataset.search;if(!module)return;
    const value=event.target.value,position=event.target.selectionStart;state.search[module]=value;state.tablePage[module]=1;clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{const complianceSearch=state.page==='compliance'&&String(module).startsWith('compliance');if(state.page!==module&&!complianceSearch)return;render();const input=$(`[data-search="${module}"]`);if(input){input.focus();input.setSelectionRange(position,position);}},170);
  });
  let accountRefreshTimer;
  function scheduleAccountRefresh() {
    clearTimeout(accountRefreshTimer);
    accountRefreshTimer=setTimeout(()=>{if(state.page==='accounts'&&!state.loading&&!state.busy.size&&!$('#dialog').open)loadPage('accounts',false);},400);
  }
  window.addEventListener('focus',scheduleAccountRefresh);
  let browserRefreshTimer;
  function scheduleBrowserRefresh() {
    clearTimeout(browserRefreshTimer);
    browserRefreshTimer=setTimeout(()=>{if(state.page==='browser'&&!state.loading)browserUi.load().catch(showError);},150);
  }
  async function enterAuthenticatedWorkspace() {
    state.loading=true;
    clearError();
    try {
      await refreshStores();
      try{state.cache['accounts:all']=(await api('accounts.load'))||{};}catch{}
      state.loading=false;
      if(!cloudAuthUi.canAccessPage(state.page))state.page=cloudAuthUi.firstAccessiblePage();
      const connection=$('#connection-status');if(connection)connection.textContent='统一账号已连接 · 店铺数据保存在本机';
      await loadPage(state.page,false);
      render();
    } catch(error) {
      state.loading=false;
      showError(error);
      render();
    }
  }
  async function leaveAuthenticatedWorkspace() {
    state.loading=false;
    state.cache={};
    state.stores=[];
    state.storeId='';
    state.page='accounts';
    const accountSlot=$('#cloud-account-slot');
    if(accountSlot)accountSlot.innerHTML='';
    $('#content').innerHTML='';
    $('#navigation').innerHTML='';
    $('#progress-area').innerHTML='';
    $('#error-area').innerHTML='';
  }
  async function init() {
    updateUi?.initialize();
    if(window.xx?.onProgress)window.xx.onProgress(progress=>{
      const p=progress||{},key=`${p.module||'task'}:${p.storeId||''}`;
      if(p.module==='browser-workspace'){
        scheduleAccountRefresh();
        if(p.action==='show'){if(p.storeId)browserUi.setViewStore(p.storeId);if(!hostsBrowser(state.page))navigate('browser').catch(showError);}
        else scheduleBrowserRefresh();
        return;
      }
      if(p.module==='browser'||p.module==='accounts'){scheduleAccountRefresh();return;}
      if(p.module==='business'){
        businessUi.handleProgress(p);
        if(p.done||['completed','success','succeeded','partial','failed','cancelled','canceled'].includes(p.status))delete state.progress[key];else state.progress[key]=p;
        renderProgress();return;
      }
      // 内购会：需要人工处理（登录/安全验证/人工选文件）时提醒，并把任务页刷新出提示卡。
      if(p.module==='purchase-attention'){
        toast(p.message||'内购会需要人工处理后再继续',true);
        if(state.page==='purchase')loadPage('purchase',false).catch(showError);
        return;
      }
      // 违规扫描：记录进度样本，用于“实时扫描进度”里估算剩余时间。
      if(p.module==='compliance'){
        const jobId=String(p.jobId||''),now=Date.now();
        if(!state.complianceRate||state.complianceRate.jobId!==jobId)state.complianceRate={jobId,startedAt:now,startCurrent:Number(p.current||0),lastAt:now,lastCurrent:Number(p.current||0),total:Number(p.total||0)};
        const track=state.complianceRate;
        // 图片阶段和逐行阶段的总数不一样：总量变了就重新起算样本，避免剩余时间算成负数。
        if(Number.isFinite(Number(p.total))&&Number(p.total)>0&&Number(p.total)!==track.total){
          track.total=Number(p.total);
          track.startedAt=now;
          track.startCurrent=Number(p.current||0);
        }
        if(Number.isFinite(Number(p.current))){track.lastCurrent=Number(p.current);track.lastAt=now;}
        if(p.done)track.done=true;
        // 扫描期间限流重绘“实时扫描进度”（事件很密，避免每来一条就整页重绘）。
        if(state.page==='compliance'&&!complianceRenderTimer)complianceRenderTimer=setTimeout(()=>{complianceRenderTimer=null;if(state.page==='compliance'&&!state.loading)render();},700);
      }
      // 投诉打标：执行进度（逐条状态）直接进入页面；结束时刷新“执行记录”。
      if(p.module==='complaint'){
        const s=state.complaint||(state.complaint={});
        if(p.run){
          s.run=p.run;
          if(['completed','stopped','blocked'].includes(p.run.state)&&state.page==='complaint')loadPage('complaint',false).catch(showError);
        }
        if(state.page==='complaint'&&!complaintRenderTimer)complaintRenderTimer=setTimeout(()=>{complaintRenderTimer=null;if(state.page==='complaint'&&!state.loading)render();},500);
      }
      // 上品库：进度不进顶部横条（用户 2026-11-11：上架进度全部在「查看上架进度」弹窗里看）。
      // 这里只处理一次性通知和列表刷新；运行中的队列状态由弹窗自己轮询。
      if(p.module==='selectionpool'){
        if(p.stage==='queue'){try{selectionPoolUi?.applyQueue?.(p);}catch{}return;}
        if(p.stage==='log'){return;}
        if(p.done){
          if(selectionpoolProgressTimer){clearTimeout(selectionpoolProgressTimer);selectionpoolProgressTimer=null;}
          delete state.progress[key];
          // 采集成功不弹提示条：插件页面已经给出「已加入」反馈，这里只静默刷新列表。
          if(p.toast&&p.message)toast(p.message);
          if(p.refresh&&state.page==='selectionpool')loadPage('selectionpool',false).catch(showError);
        }
        renderProgress();return;
      }
      if(p.status==='completed'||p.status==='failed'||p.done){delete state.progress[key];}else state.progress[key]=p;
      renderProgress();
    });
    try {
      state.info=await api('app.info')||{};
      applyTheme(state.info.theme);
      applySidebar(state.info.sidebar !== 'collapsed');
      const version=$('#app-version');if(version)version.textContent=state.info.version?`v${state.info.version}`:'桌面版';
      const connection=$('#connection-status');if(connection)connection.textContent='桌面服务已连接 · 数据保存在本机';
      await cloudAuthUi.initialize();
    } catch(error){
      const connection=$('#connection-status');if(connection)connection.textContent='桌面服务未连接';
      showError(error);
      state.loading=false;
      if(cloudAuthUi?.isAuthenticated())render();
    }
  }
  // 新增店铺：一次填写账户类型、子账户（店铺名:姓名）与密码；店铺名取冒号前内容，添加即时完成。
  const addStoreDialog=()=>modal({title:'新增店铺账号',fields:`<div class="field"><label for="form-account-type">账户类型</label><select id="form-account-type" name="type"><option value="operator" selected>运营</option><option value="owner">主账号</option><option value="support">客服</option></select></div>${inputField('account','子账户','','text','required maxlength="160" placeholder="输入店铺账号"')}<div class="field"><label for="form-password">密码</label><input id="form-password" name="password" type="password" required maxlength="1024" autocomplete="off" placeholder="请输入密码"></div>`,confirm:'识别店铺并保存账号'});
  // 移除店铺：确认后才调用 stores.remove（主进程要求 confirmed:true）。
  const confirmRemoveStore=async store=>!!await modal({title:`移除店铺：${store?.name||''}`,description:'移除后该店铺从工作台消失，本机登录会话一并失效；已保存的经营数据仍保留在本机数据目录，需要时可在店铺登录重新添加并登录。',fields:'',confirm:'确认移除',danger:true});
  let cloudAuthUi=null;
  const navigation=window.XXNavigation.create({esc,svg,canAccess:page=>Boolean(cloudAuthUi?.canAccessPage(page))});
  const insightUi=window.XXInsights.create({state,api,esc,button,heading,panel,notice,empty,table,dateTime,moduleData,perform,toast,loadPage,render});
  const businessUi=window.XXBusiness.create({state,api,esc,button,heading,panel,notice,empty,dateTime,render,toast,showError,selectStore,can:code=>Boolean(cloudAuthUi?.hasPermission(code)),focusStoreBrowser:async({storeId})=>{await navigate('browser');const tabId=await browserUi.focusTab(storeId);if(!tabId)toast('这家店铺还没有打开的官方页面，请先在店铺浏览器里打开千牛工作台。',true);},openBackend:async payload=>{await browserUi.setVisible(false);const result=await api('business.open',payload);if(state.page==='business'&&state.storeId===payload.storeId)await navigate('browser');return result;},showValidationTab:async({storeId,tabId,sourceId,mode})=>{state.browserReturnPage='business';let focused='';if(sourceId){try{const target=await api('business.revealSync',{storeId,sourceId,mode});if(target&&target.tabId)focused=target.tabId;}catch{}}if(!focused&&tabId){if(state.page!=='browser')await navigate('browser');try{focused=await browserUi.focusTabById(tabId);}catch{}}if(!focused&&storeId){if(state.page!=='browser')await navigate('browser');try{await browserUi.focusTab(storeId);}catch{}}toast('平台要求完成滑动验证：请在这个独立窗口里完成滑块，完成后会自动继续同步。',true);},returnFromValidation:async({storeId})=>{if(state.page==='browser'&&state.storeId===storeId){toast('验证已通过，正在从断点继续同步');await navigate('business');}}});
  const accountUi=window.XXAccounts.create({state,api,esc,button,heading,panel,notice,empty,dateTime,moduleData,perform,toast,loadPage,render,storeDialog,confirmRemoveStore,addStoreDialog,selectStore,modal,refreshStores,showError,assignStore,can:code=>Boolean(cloudAuthUi?.hasPermission(code)),setBrowserVisible:visible=>browserUi.setVisible(visible),onAutoLogin:(storeId,result)=>browserUi.setLoginFeedback(storeId,result)});
  const browserUi=window.XXBrowser.create({state,api,esc,svg,toast,showError,navigate,can:code=>Boolean(cloudAuthUi?.hasPermission(code)),returnToPage:()=>navigate(state.browserReturnPage||'accounts')});
  cloudAuthUi=window.XXCloudAuth.create({api,esc,svg,heading,button,panel,notice,empty,badge,modal,toast,render,onAuthenticated:enterAuthenticatedWorkspace,onLoggedOut:leaveAuthenticatedWorkspace,onStoresChanged:refreshStores});
  const updateUi=window.XXUpdate?window.XXUpdate.create({api,esc,toast,state,refresh:()=>render()}):null;
  // 上品库独立功能区（从老软件移植，存储走本机）。注入的 helper 与 accounts 页保持一致。
  const selectionPoolUi=window.XXSelectionPool.create({state,api,esc,button,badge,panel,notice,empty,table,toast,render,loadPage,modal,showError,dateTime,moduleData,svg,navigate,editor:()=>selectionPoolEditor});
  const selectionPoolEditor=window.XXSelectionPoolEditor.create({api,esc,svg,toast,render,showError,modal});
  // 采集信息弹窗里的「商品图片工作台」按钮要能直接打开编辑器：模块本身是冻结的，
  // 这里把实例挂到 window 上给 dialogs.js 用（用户 2026-11-11）。
  window.XXSelectionPoolEditorApi=selectionPoolEditor;
  // AI作图插件 代管：底部「插件」入口。
  const pluginUi=window.XXPluginManager?window.XXPluginManager.create({api,esc,svg,toast}):null;
  init();
})();
