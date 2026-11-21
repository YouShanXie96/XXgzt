'use strict';

// This screen presents session evidence returned by the account service. It
// never reads browser credentials or infers a login from opening a window.
// The store browser (tabs, address bar and native web stage) is hosted here as
// well, so a store can be added, named and logged in on one page.
(() => {
  const backendDefinitions = [
    ['seller', '千牛工作台', '评价、订单与店铺资料'],
    ['promotion', '万相台推广', '推广管理与流量解析'],
    ['sycm', '生意参谋', '经营数据与店铺表现'],
    ['dmp', '达摩盘', '同行榜单与市场数据'],
  ];
  const statusDefinitions = {
    unknown: ['待检查', 'neutral'],
    'login-required': ['待登录', 'warn'],
    'verification-required': ['需要验证', 'warn'],
    verified: ['已登录', 'good'],
    error: ['检查未完成', 'bad'],
  };
  const array = value => Array.isArray(value) ? value : [];
  // Stores created without a typed name keep a temporary label until the real
  // 千牛 shop name is observed on that store's own seller page.
  const temporaryName = value => /^新店铺\d*$/.test(String(value || '').trim());

  function create(host) {
    let expandedId = '', refreshing = false, adding = false;
    const checkingIds = new Set(), openingIds = new Set(), lastCheckFeedback = new Map();
    const credentials = host.credentials || window.XXCredentials?.create(host);
    const accountManager = () => {if(!credentials)throw new Error('本机账号组件未加载，请重新启动工作台。');return credentials;};
    const esc = host.esc;
    const can = code => typeof host.can === 'function' ? host.can(code) : true;
    const data = () => host.moduleData('accounts') || {};
    const stores = () => array(data().stores);
    const findStore = id => stores().find(store => store.id === id) || array(host.state?.stores).find(store => store.id === id);
    const busy = key => !!host.state.busy?.has(key);
    const operationKey = (action, id, kind = '') => `accounts.${action}:${id}${kind ? `:${kind}` : ''}`;
    const status = record => statusDefinitions[record?.status] || statusDefinitions.unknown;
    const isChecking = store => refreshing || store.checking === true || checkingIds.has(store.id) || busy(operationKey('check', store.id));
    const checked = value => value ? host.dateTime(value) : '尚未检查';
    const button = (label, action, id, options = {}) => host.button(label, `accounts:${action}`, {
      ...options, attrs: `${id ? `data-store-id="${esc(id)}" ` : ''}${options.attrs || ''}`,
    });
    const statusBadge = (record, checking = false) => {
      const [fallback, tone] = checking ? ['检查中…','checking'] : status(record);
      return `<span class="accounts-status ${tone}"${checking ? ' role="status"' : ''}><span aria-hidden="true"></span>${esc(checking ? fallback : record?.label && !record.kind ? record.label : fallback)}</span>`;
    };

    // Adopts the name the official 千牛 page shows for this store's own session.
    // Only a temporary label is replaced; a user-typed name is never overwritten.
    async function adoptDetectedName(storeId, {quiet = false} = {}) {
      const store = findStore(storeId);
      // 只有仍是临时名称（新增后未改名）的店铺才需要识别，已有名称一律不动。
      if (!store || !temporaryName(store.name)) return '';
      let result;
      try { result = await host.api('accounts.detectName', {storeId}); }
      catch (error) { if (!quiet) host.toast(error.message || '店铺名称识别失败', true); return ''; }
      const name = String(result?.name || '').trim();
      if (!name || name === store.name || !temporaryName(store.name)) return '';
      try {
        await host.api('stores.rename', {id: storeId, name});
        if (host.refreshStores) await host.refreshStores();
        host.toast(`已自动识别店铺名称：${name}`);
        return name;
      } catch (error) { if (!quiet) host.toast(error.message || '店铺名称未能保存', true); return ''; }
    }

    function card(store, selectedId) {
      const current = store.id === host.state.storeId;
      const checking = isChecking(store);
      const opening = openingIds.has(`${store.id}:seller`) || busy(operationKey('open', store.id, 'seller'));
      const openLabel = store.status === 'verified' ? '打开' : store.status === 'verification-required' ? '完成验证' : store.status === 'login-required' ? '继续登录' : '打开并登录';
      const avatar = Array.from(String(store.name || '店'))[0];
      return `<article class="accounts-card${selectedId === store.id ? ' expanded' : ''}">
        <details class="accounts-menu"><summary aria-label="${esc(store.name || '店铺')}的操作菜单" title="店铺操作">⋯</summary><div class="accounts-menu-items">${button(current ? '已是当前店' : '设为当前店', 'select', store.id, {small:true,disabled:current})}${can('workbench.accounts.edit') ? button('重命名', 'rename', store.id, {small:true}) : ''}${can('workbench.accounts.login') ? button(checking ? '检查中…' : '检查登录', 'check', store.id, {small:true,disabled:checking}) : ''}${can('manage.stores.assign') ? button('分配店铺', 'assign', store.id, {small:true}) : ''}${can('workbench.accounts.remove') ? button('移除店铺', 'remove', store.id, {small:true,danger:true}) : ''}</div></details>
        <button type="button" class="accounts-card-summary" data-action="accounts:details" data-store-id="${esc(store.id)}" aria-expanded="${selectedId === store.id}" aria-controls="accounts-backends">
          <span class="accounts-avatar" aria-hidden="true">${esc(avatar)}</span>
          <span class="accounts-card-name"><strong title="${esc(store.name || '未命名店铺')}">${esc(store.name || '未命名店铺')}</strong><span class="accounts-card-status">${statusBadge(store, checking)}${current ? '<span class="accounts-current">当前店铺</span>' : ''}</span></span>
        </button>
        <div class="accounts-card-meta"><span>最近检查</span><time>${esc(checked(store.checkedAt))}</time></div>
        <div class="accounts-card-actions">${can('workbench.accounts.login') ? button(opening ? '正在打开…' : openLabel, 'open', store.id, {primary:true,disabled:opening,attrs:'data-kind="seller"'}) : ''}${can('workbench.accounts.credentials') ? button('本机账号', 'local-account', store.id, {attrs:'aria-haspopup="dialog"'}) : ''}</div>
        <div class="accounts-card-footer"><span>千牛工作台</span>${button('常用后台', 'details', store.id, {small:true,attrs:`aria-expanded="${selectedId === store.id}" aria-controls="accounts-backends"`})}</div>
      </article>`;
    }

    function backendPanel(store) {
      const backends = array(store.backends);
      const rows = can('workbench.accounts.login') ? backendDefinitions.map(([kind, label, description]) => {
        const record = backends.find(item => item.kind === kind) || {kind,status:'unknown'};
        const opening = busy(operationKey('open', store.id, kind));
        return `<article class="accounts-backend"><div class="accounts-backend-top"><h3>${esc(label)}</h3>${statusBadge(record)}</div><p>${esc(description)}</p><div class="accounts-backend-bottom"><span>${esc(record.checkedAt ? checked(record.checkedAt) : '尚未检查')}</span>${button(opening ? '正在打开…' : record.open ? '返回后台' : '打开后台', 'open', store.id, {small:true,disabled:opening,attrs:`data-kind="${kind}"`})}</div></article>`;
      }).join('') : '';
      return `<div id="accounts-backends">${host.panel(`${esc(store.name || '未命名店铺')} · 常用后台`, '', `<div class="accounts-backend-grid">${rows}</div>`)}</div>`;
    }

    // 店铺登录页只保留店铺与账号管理；浏览器只在“店铺浏览器”页展示。
    function browserSection() { return ''; }

    function render() {
      const all = stores();
      const selected = findStore(expandedId) || findStore(host.state.storeId) || all[0];
      expandedId = selected?.id || '';
      const actions = button(refreshing ? '检查中…' : '刷新状态', 'refresh', '', {icon:'refresh',disabled:refreshing}) + (can('workbench.accounts.add') ? button(adding ? '正在添加…' : '新增店铺', 'add', '', {primary:true,icon:'store',disabled:adding}) : '');
      const intro = host.heading('店铺登录', '新增店铺直接填写本机账号，登录后在官方页面自动识别店铺名称。', actions);
      // 依据用户要求：店铺登录页不再显示共用登录/改名的说明文字。
      const browser = browserSection();
      if (!all.length) return `<div class="accounts-page">${intro}${browser}${host.panel('我的店铺', '', host.empty(can('workbench.accounts.add') ? '添加你的第一家店铺' : '暂无可查看店铺', can('workbench.accounts.add') ? '点击“新增店铺”后直接填写本机账号；登录千牛后在官方页面自动识别店铺名称。' : '当前账号没有店铺可见范围，请联系公司管理员分配店铺。', can('workbench.accounts.add') ? button(adding ? '正在添加…' : '新增店铺', 'add', '', {primary:true,icon:'store',disabled:adding}) : '', 'store'))}</div>`;
      return `<div class="accounts-page">${intro}${browser}<div class="accounts-section-heading"><h2>我的店铺 <span>${all.length}</span></h2></div><div class="accounts-grid">${all.map(store => card(store, expandedId)).join('')}</div>${selected ? backendPanel(selected) : ''}</div>`;
    }

    function notifyCheck(result) {
      const store = result?.store;
      if (!store || !store.id) return;
      const label = status(store)[0];
      const seller = array(store.backends).find(item => item.kind === 'seller');
      const detail = seller?.message || store.message || '';
      const message = `${store.name || '店铺'}：${label}${detail ? `。${detail}` : ''}`;
      if(lastCheckFeedback.get(store.id) === message)return;
      lastCheckFeedback.set(store.id,message);
      host.toast(message,store.status === 'error');
    }

    async function addStore() {
      if (adding) return true;
      adding = true; host.render();
      try {
        // 新增店铺：一次填写账户类型、子账户（店铺名:姓名）和密码；
        // 店铺名直接取冒号前的部分，不再等待页面识别，所以添加是即时的。
        const values = host.addStoreDialog ? await host.addStoreDialog() : null;
        if (!values) return true;
        const account = String(values.account || '').trim();
        const password = String(values.password || '');
        const type = ['owner','operator','support'].includes(values.type) ? values.type : 'operator';
        const separator = account.indexOf(':');
        const typedName = separator > 0 ? account.slice(0, separator).trim() : '';
        // 账号名保留完整字符串：店铺后台登录表单需要完整的“店铺名:姓名”子账户，
        // 只有工作台的店铺名取冒号前半段。
        const username = account;
        if (!username) { host.toast('请输入店铺账号；格式：店铺名:姓名', true); return true; }
        const list = await host.api('stores.add', typedName ? {name: typedName} : {});
        const created = array(list).at(-1);
        if (host.refreshStores) await host.refreshStores();
        if (created?.id && host.selectStore) await host.selectStore(created.id);
        if (!created?.id) { host.toast('店铺未创建成功，请重试。', true); return true; }
        expandedId = created.id;
        const saved = await host.api('credentials.save', {storeId: created.id, type, username, password});
        const accountRow = array(saved?.accounts).find(row => row.username === username) || array(saved?.accounts).at(-1);
        await host.loadPage('accounts', false);
        if (accountRow?.id) {
          try { await accountManager().login(findStore(created.id) || created, accountRow.id); }
          catch (error) { host.toast(`账号已保存，登录未完成：${error?.message || error}`, true); }
        }
        if (!typedName) await adoptDetectedName(created.id);
        await host.loadPage('accounts', false);
      } catch (error) {
        if (host.showError) host.showError(error); else host.toast(error?.message || String(error), true);
      } finally { adding = false; host.render(); }
      return true;
    }

    async function handleAction(action, element) {
      if (!action.startsWith('accounts:')) return false;
      const operation = action.slice('accounts:'.length);
      if (operation === 'refresh') {
        if(refreshing)return true;
        refreshing=true;host.render();
        try {await host.api('accounts.refresh',{});await host.loadPage('accounts', false);}
        finally {refreshing=false;host.render();}
        return true;
      }
      if (operation === 'add') return addStore();
      const id = element?.dataset?.storeId;
      if (!findStore(id)) { host.toast('这家店铺已不存在，请刷新店铺列表。', true); return true; }
      if (operation === 'details') { expandedId = id; host.render(); }
      else if (operation === 'assign') await host.assignStore(findStore(id));
      else if (operation === 'local-account') { expandedId = id; await accountManager().open(findStore(id)); await adoptDetectedName(id); await host.loadPage('accounts', false); }
      else if (operation === 'select') { expandedId = id; await host.selectStore(id); }
      else if (operation === 'rename') await host.storeDialog(id);
      else if (operation === 'remove') {
        // 店铺管理从“设置”移到店铺卡片菜单：移除前必须二次确认。
        const store = findStore(id);
        const confirmed = await host.confirmRemoveStore(store);
        if (!confirmed) return true;
        await host.perform(`accounts.remove:${id}`, () => host.api('stores.remove', {id, confirmed:true}), {module:'accounts', reload:false, success:`已移除店铺：${store?.name || ''}`});
        await host.loadPage('accounts', false);
      }
      else if (operation === 'open' || operation === 'check') {
        const kind = element?.dataset?.kind || 'seller';
        if (operation === 'open' && !backendDefinitions.some(([name]) => name === kind)) return false;
        const openingKey=`${id}:${kind}`;
        if(operation === 'open' && openingIds.has(openingKey))return true;
        if(operation === 'check' && checkingIds.has(id))return true;
        if(operation === 'open'){openingIds.add(openingKey);host.render();}
        if(operation === 'check')checkingIds.add(id);
        try {
          // Cached card evidence may predate session expiry. Auto-login checks
          // the current official page before it ever reads a saved password.
          if(operation === 'open' && kind === 'seller') {
            const manager = accountManager(), saved = await manager.list(id);
            // 登录结果要在“店铺登录”页也能看到（此前只有“店铺浏览器”里才显示提示，
            // 从浏览器返回后再次点登录会像没反应）。
            const finishLogin = async result => {
              if(result && result.status && result.status!=='verified') host.toast(result.message || '登录未完成，请查看官方页面提示。', true);
              await adoptDetectedName(id);
              await host.loadPage('accounts', false);
            };
            try{
              if(saved.available && saved.accounts.length === 1) {await finishLogin(await manager.login(findStore(id),saved.accounts[0].id));return true;}
              if(saved.available && saved.accounts.length > 1) {await finishLogin(await manager.open(findStore(id),{choose:true,data:saved}));return true;}
            }catch(error){if(!error?.canceled)host.toast(error?.message || String(error), true);await host.loadPage('accounts', false);return true;}
          }
          const result = await host.perform(operationKey(operation,id,operation === 'open' ? kind : ''), () => host.api(`accounts.${operation}`, {storeId:id,...(operation === 'open' ? {kind} : {})}), {module:'accounts',reload:false});
          if(operation === 'check')notifyCheck(result);
          await adoptDetectedName(id,{quiet:operation === 'check'});
          await host.loadPage('accounts', false);
        } finally {
          checkingIds.delete(id);openingIds.delete(openingKey);host.render();
        }
      }
      else return false;
      return true;
    }

    return {render,handleAction,adoptDetectedName};
  }
  window.XXAccounts = Object.freeze({create});
})();
