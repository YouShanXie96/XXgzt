'use strict';

// Chrome for the native merchant WebContentsView. Merchant content is never
// inserted into renderer HTML, and every action targets an explicit tab ID.
(() => {
  const kinds = {blank:'新标签页',seller:'千牛工作台',reviews:'评价管理',orders:'订单查询',promotion:'万相台推广',purchase:'内购会',qualification:'标签资质',sycm:'生意参谋',traffic:'流量解析',dmp:'达摩盘'};
  const statuses = {unknown:['待检查','neutral'],'login-required':['需要登录','warn'],'verification-required':['需要验证','warn'],verified:['已登录','good'],error:['页面异常','bad']};
  const routes = {activate:'activateTab',close:'closeTab',back:'back',forward:'forward',reload:'reloadTab',home:'homeTab',check:'checkTab',navigate:'navigateTab'};
  const iconPaths = {back:'<path d="m14 6-6 6 6 6"/>',forward:'<path d="m10 6 6 6-6 6"/>',reload:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',home:'<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18"/>'};
  const array = value => Array.isArray(value) ? value : [];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalizeAddress = value => {
    const text = String(value || '').trim();
    if (!text) throw new Error('请输入要打开的网址。');
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('请输入 https:// 开头的网址（不要包含账号密码）。');
    return url.href;
  };

  function create(host) {
    const esc = host.esc || escape;
    const can = code => typeof host.can !== 'function' || host.can(code);
    let snapshot = {tabs:[],activeId:null,visible:false};
    let visible = false, disposed = false, root = null, viewport = null;
    let observer = null, poll = null, frame = null, bindings = [], requestSequence = 0;
    let viewportSequence = 0, viewportQueue = Promise.resolve(), viewportSignature = '';
    const drafts = new Map(), pending = new Set(), loginFeedback = new Map();
    // 「+」新建的空白标签页：本地草稿，尚未创建原生页面；输入网址后才真正打开。
    const blanks = new Map();
    // viewStoreId：店铺浏览器当前展示哪家店的标签（默认跟随“当前店铺”；
    // 从店铺登录页打开其它店的页面时会临时切换过去）。每个店铺的标签都保持打开。
    let activeBlankId = null, blankSequence = 0, viewStoreId = null;
    const doc = () => typeof document === 'undefined' ? null : document;
    const win = () => typeof window === 'undefined' ? null : window;
    const viewStore = () => viewStoreId || host.state.storeId;
    const viewTabs = () => snapshot.tabs.filter(tab => tab.storeId === viewStore());
    const viewBlanks = () => [...blanks.values()].filter(item => item.storeId === viewStore());
    const active = () => {
      if (activeBlankId && blanks.has(activeBlankId) && blanks.get(activeBlankId).storeId === viewStore()) return blanks.get(activeBlankId);
      const list = viewTabs();
      return list.find(tab => tab.id === snapshot.activeId) || list.find(tab => tab.kind === 'seller') || list[0] || null;
    };
    const allTabs = () => [...viewTabs(), ...viewBlanks()];
    const everyTab = () => [...snapshot.tabs, ...blanks.values()];
    // The toolbar and native web stage are hosted by 店铺浏览器 and by 店铺登录.
    const hostPage = () => host.state.page === 'browser' || host.state.page === 'accounts';
    const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.globe}</svg>`;
    const button = (label,action,{tabId='',disabled=false,className='',title=''}={}) => `<button type="button" class="browser-button ${className}" data-action="browserui:${action}"${tabId ? ` data-tab-id="${esc(tabId)}"` : ''}${disabled ? ' disabled' : ''}${title ? ` title="${esc(title)}" aria-label="${esc(title)}"` : ''}>${label}</button>`;
    const busy = (action,tabId) => pending.has(`${action}:${tabId}`);
    const address = tab => tab ? drafts.get(tab.id)?.value ?? tab.url ?? '' : '';
    const currentStatus = tab => statuses[tab?.status] || statuses.unknown;

    function tabsHtml() {
      const list = allTabs();
      if (!list.length) return '<span class="browser-no-tabs">店铺浏览器</span>';
      return list.map(tab => {
        // 页面还在加载、标题未就绪时给一个明确占位，不让标签看起来是“空的黑框”。
        const name = tab.blank ? '新标签页' : (tab.loading && (!tab.title || tab.title === tab.storeName) ? '正在打开页面…' : (tab.title || kinds[tab.kind] || '店铺后台'));
        const label = `${tab.storeName || '未命名店铺'} · ${name}`;
        const selected = tab.blank ? tab.id === activeBlankId : (!activeBlankId && tab.id === snapshot.activeId);
        // 用户要求：标签已经按店铺分开显示，标签上不再重复写店铺名（左上角圆点仍代表店铺，鼠标悬停可看完整“店铺 · 页面”）。
        return `<div class="browser-tab${selected ? ' active' : ''}"><button type="button" role="tab" aria-selected="${selected}" class="browser-tab-select" data-action="browserui:activate" data-tab-id="${esc(tab.id)}" title="${esc(label)}"><span class="browser-tab-dot${tab.loading ? ' loading' : ''}" aria-hidden="true">${esc(Array.from(String(tab.storeName || '店'))[0])}</span><span class="browser-tab-text"><span>${esc(name)}${tab.popup ? ' · 弹出页' : ''}</span></span></button>${can('workbench.browser.tabs')?`<button type="button" class="browser-tab-close" data-action="browserui:close" data-tab-id="${esc(tab.id)}" aria-label="关闭 ${esc(label)}" title="关闭标签"${busy('close',tab.id) ? ' disabled' : ''}>×</button>`:''}</div>`;
      }).join('');
    }

    function toolsHtml() {
      const tab = active(), id = tab?.id || '';
      if(!can('workbench.browser.navigate'))return '';
      return button(icon('back'),'back',{tabId:id,disabled:!tab?.canGoBack || busy('back',id),title:'后退'}) +
        button(icon('forward'),'forward',{tabId:id,disabled:!tab?.canGoForward || busy('forward',id),title:'前进'}) +
        button(icon('reload'),'reload',{tabId:id,disabled:!tab || busy('reload',id),title:'刷新当前网页'}) +
        button(icon('home'),'home',{tabId:id,disabled:!tab || busy('home',id),title:'返回当前后台首页'});
    }

    function statusHtml() {
      const tab = active(), [label,tone] = currentStatus(tab);
      return `<div class="browser-identity"><span class="browser-identity-label">当前标签店铺</span><strong title="${esc(tab?.storeName || '')}">${esc(tab?.storeName || '尚未打开店铺')}</strong></div><div class="browser-auth"><span class="browser-auth-badge ${tone}" title="${esc(tab?.message || '打开官方页面后检查登录状态。')}"><i aria-hidden="true"></i>${esc(tab ? label : '待打开')}</span>${can('workbench.browser.check')?button(busy('check',tab?.id) ? '检查中…' : '检查登录','check',{tabId:tab?.id || '',disabled:!tab || busy('check',tab?.id)}):''}</div>`;
    }

    function emptyHtml(embedded = false) {
      return `<div class="browser-empty"><div class="browser-empty-symbol">${icon('globe')}</div><h2>${embedded ? '选择店铺后在这里登录后台' : '选择一家店铺，打开后台'}</h2><p>${embedded ? '在下方店铺卡片点击“打开”，官方页面会显示在这里。<br>新增店铺填写本机账号后即可登录并自动识别店名。' : '从店铺登录中心或功能页进入，网页会显示在这里。<br>同店铺共用登录会话，不同店铺相互隔离。'}</p>${embedded ? '' : button('前往店铺登录','accounts',{className:'primary'})}</div>`;
    }
    // 新标签页：空白页，地址栏可直接输入网址后点“打开”。
    function blankHtml(tab) {
      const storeId = tab?.storeId || host.state.storeId || '';
      return `<div class="browser-empty browser-blank"><div class="browser-empty-symbol">${icon('globe')}</div><h2>新标签页</h2><p>在上方地址栏输入官方后台网址后点“打开”。<br>${tab?.storeName ? `将在店铺「${esc(tab.storeName)}」的登录会话中打开。` : '请先在“店铺登录”添加并选择店铺。'}</p>${storeId ? button('打开千牛工作台','newtab-home',{className:'primary'}) : button('前往店铺登录','accounts',{className:'primary'})}</div>`;
    }

    function loginFeedbackHtml() {
      const tab=active(), result=tab&&loginFeedback.get(tab.storeId);
      if(!result)return '';
      const title=result.status==='running'?'正在自动登录':result.status==='verified'?'登录已确认':result.submitted?'已尝试提交登录':'登录提示';
      const tone=result.status==='running'?'pending':result.status==='verified'?'good':result.status==='error'?'bad':'warn';
      return `<div class="browser-login-feedback ${tone}" role="status" aria-live="polite"><strong>${esc(title)}</strong><span>${esc(result.message)}</span>${result.status==='running'?'':button('×','dismiss-login',{title:'关闭登录提示'})}</div>`;
    }
    function setLoginFeedback(storeId,result) {
      if(typeof storeId!=='string'||!storeId)return;
      if(result&&typeof result.message==='string')loginFeedback.set(storeId,{status:String(result.status||'unknown'),message:result.message,submitted:result.submitted===true});
      else loginFeedback.delete(storeId);
      patch();
    }

    function barHtml({embedded = false} = {}) {
      const tab = active();
    return `<div class="browser-toolbar"><div class="browser-tools">${toolsHtml()}</div><div class="browser-address-wrap">${icon('globe')}<input id="browser-address" type="text" spellcheck="false" autocomplete="off" aria-label="当前标签网址" placeholder="${can('workbench.browser.navigate')?'输入官方后台网址后点“打开”':'当前账号没有网址导航权限'}" value="${esc(address(tab))}"${can('workbench.browser.navigate')?'':' disabled'}></div>${can('workbench.browser.navigate')?button('打开','navigate',{tabId:tab?.id || '',className:'primary browser-open-address',disabled:busy('navigate',tab?.id)}):''}</div><div class="browser-tabbar"><div class="browser-tabs" role="tablist" aria-label="已打开的店铺页面">${tabsHtml()}</div>${can('workbench.browser.tabs')?button('+','newtab',{className:'browser-add-tab',title:'新建标签页'}):''}</div><div class="browser-login-feedback-slot">${loginFeedbackHtml()}</div>`;
    }
    function viewportHtml(embedded = false) {
      const tab = active();
      const body = tab ? (tab.blank ? blankHtml(tab) : '') : emptyHtml(embedded);
      return `<div id="browser-viewport" role="region" aria-label="官方店铺网页">${body}</div>`;
    }
    function render() {
      return `<section class="browser-page" aria-label="店铺浏览器">${barHtml()}${viewportHtml()}</section>`;
    }

    function patch() {
      const container = doc()?.querySelector('.browser-page, .accounts-browser');
      if (!container) return;
      const embedded = !!container.closest?.('.accounts-browser');
      const tabs = container.querySelector('.browser-tabs'), left = tabs?.scrollLeft || 0;
      if (tabs) { tabs.innerHTML=tabsHtml();tabs.scrollLeft=left; }
      // 工具行可能被搬到顶栏里，所以按整个文档查找。
      const tools = doc()?.querySelector('.browser-tools');if(tools)tools.innerHTML=toolsHtml();
      const current = container.querySelector('.browser-current');if(current)current.innerHTML=statusHtml();
      const feedback=container.querySelector('.browser-login-feedback-slot');if(feedback)feedback.innerHTML=loginFeedbackHtml();
      const tab = active(), input = doc()?.querySelector('#browser-address');
      if(input) {
        // 没有打开店铺页面时仍可手动输入网址；提交时会先为该店打开页面。
        input.disabled=!can('workbench.browser.navigate');
        // 用户正在输入时不覆盖输入框内容（周期刷新曾把刚输入的网址清掉，
        // 导致“打开”取不到网址、回车也像没反应）。
        if(doc()?.activeElement!==input){const value=address(tab);if(input.value!==value)input.value=value;}
      }
      const open = doc()?.querySelector('.browser-open-address');
      if(open){open.dataset.tabId=tab?.id || '';open.disabled=!can('workbench.browser.navigate')||busy('navigate',tab?.id);}
      const content=container.querySelector('#browser-viewport');
      if(content){
        if(!tab||tab.blank)content.innerHTML=tab?blankHtml(tab):emptyHtml(embedded);
        else if(content.childElementCount)content.replaceChildren();
      }
      scheduleBounds();
    }

    function apply(data) {
      if (!data || !Array.isArray(data.tabs)) return snapshot;
      snapshot={tabs:data.tabs.map(tab=>({...tab})),activeId:data.activeId || null,visible:!!data.visible};
      for(const tab of snapshot.tabs)if(tab.kind==='seller'&&['login-required','verification-required','error'].includes(tab.status)&&loginFeedback.get(tab.storeId)?.status==='verified')loginFeedback.delete(tab.storeId);
      const ids=new Set(snapshot.tabs.map(tab=>tab.id));
      for(const id of drafts.keys())if(!ids.has(id))drafts.delete(id);
      if(activeBlankId&&blanks.get(activeBlankId)&&blanks.get(activeBlankId).storeId!==viewStore())activeBlankId=null;
      patch();return snapshot;
    }
    function update(data) {requestSequence++;return apply(data);}
    async function request(action,payload={}) {
      const sequence=++requestSequence;
      const result=await host.api(`browser.${action}`,payload);
      if(sequence===requestSequence)apply(result);
      return result;
    }
    async function load() {return request('workspace');}

    function showError(error) {if(host.showError)host.showError(error);else host.toast?.(error?.message || String(error),true);}
    function sendViewport(payload) {
      const signature=JSON.stringify({payload,activeId:payload.visible ? snapshot.activeId : null});
      if(signature===viewportSignature)return viewportQueue;
      viewportSignature=signature;
      const sequence=++viewportSequence;
      viewportQueue=viewportQueue.catch(()=>{}).then(async()=>{
        if(sequence!==viewportSequence)return;
        try {await host.api('browser.viewport',payload);}
        catch(error){viewportSignature='';showError(error);}
      });
      return viewportQueue;
    }
    async function syncBounds() {
      const document=doc(), window=win();
      if(!visible || disposed || !hostPage() || !viewport?.isConnected || document?.querySelector('dialog[open]') || !active() || active()?.blank)return sendViewport({visible:false});
      const rect=viewport.getBoundingClientRect();
      // CSS viewport coordinates. The main process converts for its zoom factor.
      const x=Math.max(0,Math.ceil(rect.left)), y=Math.max(0,Math.ceil(rect.top));
      const right=Math.min(window.innerWidth,Math.floor(rect.right)), bottom=Math.min(window.innerHeight,Math.floor(rect.bottom));
      const bounds={x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)};
      return sendViewport(bounds.width>0 && bounds.height>0 ? {visible:true,bounds} : {visible:false});
    }
    function scheduleBounds() {
      if(!visible || disposed || frame!==null || !win()?.requestAnimationFrame)return;
      frame=win().requestAnimationFrame(()=>{frame=null;syncBounds().catch(showError);});
    }
    function bind(element,event,listener,options) {
      element?.addEventListener(event,listener,options);
      bindings.push(()=>element?.removeEventListener(event,listener,options));
    }
    function detach() {
      observer?.disconnect();observer=null;
      bindings.forEach(remove=>remove());bindings=[];
      if(frame!==null){win()?.cancelAnimationFrame?.(frame);frame=null;}
      if(poll!==null){clearInterval(poll);poll=null;}
    }
    function afterRender() {
      detach();root=doc()?.querySelector('.browser-page, .accounts-browser') || null;
      viewport=root?.querySelector('#browser-viewport') || null;
      if(!root || !hostPage()){sendViewport({visible:false});return;}
      // 工具行会被搬到顶栏（店铺浏览器/店铺登录），输入框按整个文档查找，
      // 保证“输入网址、回车打开”都绑定在实际显示的那个输入框上。
      const input=doc()?.querySelector('#browser-address') || root.querySelector('#browser-address');
      if(input){
        bind(input,'input',()=>{const tab=active();drafts.set(tab?tab.id:'new',{value:input.value});});
        bind(input,'keydown',event=>{
          if(event.key!=='Enter')return;
          event.preventDefault();event.stopPropagation();
          handleAction('browserui:navigate',{dataset:{tabId:active()?.id || ''}}).catch(showError);
        });
        bind(input,'blur',()=>patch());
      }
      bind(win(),'resize',scheduleBounds);
      bind(win(),'scroll',scheduleBounds,true);
      bind(win()?.visualViewport,'resize',scheduleBounds);
      bind(win()?.visualViewport,'scroll',scheduleBounds);
      if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(scheduleBounds);observer.observe(root);if(viewport)observer.observe(viewport);}
      if(visible) {
        poll=setInterval(()=>{if(visible && hostPage() && !doc()?.querySelector('dialog[open]'))load().catch(showError);},10000);
        scheduleBounds();
      }
    }
    async function setVisible(value) {
      const next=!!value && !disposed;
      if(next===visible)return next ? syncBounds() : sendViewport({visible:false});
      visible=next;
      if(!visible){detach();return sendViewport({visible:false});}
      afterRender();return syncBounds();
    }

    async function handleAction(action,element) {
      if(!action.startsWith('browserui:'))return false;
      const operation=action.slice('browserui:'.length);
      // 为当前店铺打开真实页面，并使用该店自己的登录会话；空白标签页随之一并清除。
      async function openStorePage(url){
        const storeId=host.state.storeId;
        if(!storeId){host.toast?.('请先在“店铺登录”添加并选择店铺，再打开官方后台。',true);return false;}
        const key='navigate:open';if(pending.has(key))return false;
        pending.add(key);patch();
        try{
          await host.api('browser.open',{storeId,kind:'seller'});
          await load();
          const created=snapshot.tabs.find(item=>item.storeId===storeId)||snapshot.tabs.at(-1);
          if(!created){host.toast?.('店铺页面没有打开成功，请重试或在店铺登录中打开。',true);return false;}
          activeBlankId=null;for(const [id,item]of [...blanks])if(item.storeId===storeId)blanks.delete(id);
          if(url)await request('navigateTab',{tabId:created.id,url});
          return true;
        }catch(error){showError(error);return false;}
        finally{pending.delete(key);patch();await syncBounds();}
      }
      if(operation==='dismiss-login'){loginFeedback.delete(active()?.storeId);patch();return true;}
      // 「+」新建空白标签页；地址栏输入网址后才真正创建店铺页面。
      if(operation==='newtab'){
        const storeId=host.state.storeId;
        if(!storeId){host.toast?.('请先在“店铺登录”添加并选择店铺。',true);return true;}
        const store=array(host.state.stores).find(item=>item.id===storeId);
        const id=`blank-${++blankSequence}`;
        blanks.set(id,{id,blank:true,storeId,storeName:store?.name||'',kind:'blank',title:'新标签页',url:'',status:'unknown',message:'新标签页',canGoBack:false,canGoForward:false,loading:false,popup:false});
        activeBlankId=id;patch();scheduleBounds();
        doc()?.querySelector('#browser-address')?.focus?.();
        return true;
      }
      if(operation==='newtab-home'){await openStorePage('');return true;}
      if(operation==='accounts' || operation==='return') {
        await setVisible(false);
        if(operation==='return' && host.returnToPage)await host.returnToPage();
        else await host.navigate(operation==='accounts' ? 'accounts' : host.state.browserReturnPage || 'accounts');
        return true;
      }
      const route=routes[operation];if(!route)return false;
      const tabId=element?.dataset?.tabId || active()?.id;
      // 动作按显式 tabId 在整个集合里找（界面只列出当前店铺的标签，程序调用不受展示过滤影响）。
      const tab=everyTab().find(item=>item.id===tabId);
      // 新标签页（空白页）或还没有任何标签时，输入网址 -> 先为该店打开页面再跳转。
      if((!tab||tab.blank)&&operation==='navigate'){
        let url;try{url=normalizeAddress(drafts.get(tabId)?.value ?? doc()?.querySelector('#browser-address')?.value ?? '');}
        catch(error){host.toast?.(error.message,true);return true;}
        if(tab?.blank){
          // 新标签页里输入网址：新建一个独立的店铺页面，不影响其它已打开的页面。
          const key='navigate:newtab';if(pending.has(key))return true;pending.add(key);patch();
          try{
            await host.api('browser.newTab',{storeId:tab.storeId||host.state.storeId,kind:'seller',url});
            blanks.delete(tab.id);if(activeBlankId===tab.id)activeBlankId=null;drafts.delete(tab.id);
            await load();
            const input=doc()?.querySelector('#browser-address');
            if(input&&input.value!==address(active()))input.value=address(active());
          }catch(error){showError(error);}
          finally{pending.delete(key);patch();await syncBounds();}
          return true;
        }
        await openStorePage(url);
        return true;
      }
      if(tab?.blank&&operation==='activate'){activeBlankId=tab.id;patch();scheduleBounds();doc()?.querySelector('#browser-address')?.focus?.();return true;}
      if(tab?.blank&&operation==='close'){blanks.delete(tab.id);if(activeBlankId===tab.id)activeBlankId=null;patch();scheduleBounds();return true;}
      if(operation==='activate'){activeBlankId=null;blanks.clear();}
      if(!tab){host.toast?.('当前标签已关闭，请选择其他店铺页面。',true);return true;}
      if(operation==='back' && !tab.canGoBack || operation==='forward' && !tab.canGoForward)return true;
      const key=`${operation}:${tabId}`;if(pending.has(key))return true;
      let payload={tabId};
      if(operation==='navigate') {
        try {payload.url=normalizeAddress(drafts.get(tabId)?.value ?? doc()?.querySelector('#browser-address')?.value ?? tab.url);}
        catch(error){host.toast?.(error.message,true);return true;}
      }
      const submittedDraft=drafts.get(tabId);
      if(['back','forward','home','reload'].includes(operation))drafts.delete(tabId);
      pending.add(key);patch();
      try {
        await request(route,payload);
        if(operation==='navigate'){
          if(drafts.get(tabId)===submittedDraft)drafts.delete(tabId);
          // 提交成功后把地址栏刷成新地址（即使输入框仍处于聚焦状态）。
          const input=doc()?.querySelector('#browser-address');
          if(input)input.value=address(active());
        }
      }
      catch(error){showError(error);}
      finally {pending.delete(key);patch();await syncBounds();}
      return true;
    }
    // 供其它模块调用：把某个店铺的官方页面切为当前标签（例如商品资料出现滑块时跳过去处理）。
    async function focusTab(storeId){
      const data=await load();
      const list=Array.isArray(data?.tabs)?data.tabs:[];
      const tab=list.find(item=>item.storeId===storeId&&item.kind==='seller')||list.find(item=>item.storeId===storeId)||null;
      if(!tab)return null;
      activeBlankId=null;blanks.clear();
      await request('activateTab',{tabId:tab.id});
      return tab.id;
    }
    // 需求2：按标签 ID 激活“正在同步的那个页面”（等待滑块时由经营数据页自动调用）。
    async function focusTabById(tabId){
      if(typeof tabId!=='string'||!tabId)return '';
      const data=await load();
      const list=Array.isArray(data?.tabs)?data.tabs:[];
      if(!list.some(tab=>tab.id===tabId)){
        // 需求8（本轮）：同步页默认是“隐藏标签”，快照里看不到；这里直接请主进程激活
        //（主进程会把它显示出来），不能因为快照没有就当作不存在、跳过去什么都不显示。
        try{await request('activateTab',{tabId});}
        catch{return '';}
        const next=await load();
        if(!(Array.isArray(next?.tabs)?next.tabs:[]).some(tab=>tab.id===tabId))return '';
        activeBlankId=null;blanks.clear();
        return tabId;
      }
      activeBlankId=null;blanks.clear();
      await request('activateTab',{tabId});
      return tabId;
    }
    // 切换“店铺浏览器”里展示的店铺（标签各自保留，仅切换显示）。
    function setViewStore(storeId){
      const next=typeof storeId==='string'&&storeId?storeId:null;
      if(next===viewStoreId)return false;
      viewStoreId=next;
      if(activeBlankId&&blanks.get(activeBlankId)&&blanks.get(activeBlankId).storeId!==viewStore())activeBlankId=null;
      patch();scheduleBounds();
      return true;
    }
    async function dispose() {disposed=true;await setVisible(false);drafts.clear();loginFeedback.clear();}
    return {render,renderBar:(options={})=>barHtml(options),renderViewport:(options={})=>viewportHtml(!!options.embedded),load,update,afterRender,setVisible,setLoginFeedback,handleAction,focusTab,focusTabById,setViewStore,dispose};
  }
  window.XXBrowser=Object.freeze({create});
})();
