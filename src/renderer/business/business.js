'use strict';

(() => {
  const modes = {daily:'店铺日报',product:'精细化'};
  const running = value => ['running','syncing','pending','cancelling','committing'].includes(value?.status);
  const finished = value => value?.done || ['completed','success','succeeded','partial','failed','cancelled','canceled'].includes(value?.status);
  const statusLabels = {idle:'尚未同步',running:'同步中',syncing:'同步中',pending:'等待同步',waiting:'等待滑块验证',cancelling:'正在取消',committing:'正在保存',completed:'同步完成',success:'同步完成',succeeded:'同步完成',partial:'部分完成',failed:'同步失败',cancelled:'已取消',canceled:'已取消'};
  const arr = value => Array.isArray(value)?value:[];
  // 工作台只显示日期（上架时间/待办时间/加黑时间）；导出仍保留原始字段。
  const dateOnly = value => { const text=String(value??'').trim(); const match=/^\d{4}-\d{2}-\d{2}/.exec(text); return match?match[0]:'—'; };
  const DAY_MS = 86400000;
  // 平台要求滑动验证/安全验证时，给用户一个“去店铺浏览器完成滑块”的入口。
  const needsValidation = message => /滑动验证|被挤爆|安全验证|需要验证|滑块/.test(String(message||''));
  // 上架天数：按创建时间到今天的自然日差（含时间时按实际时刻折算，与参考软件一致）。
  function listedDays(value,now=new Date()){
    if(!value)return null;
    const timestamp=Date.parse(String(value).replace(' ','T'));
    if(!Number.isFinite(timestamp))return null;
    return Math.max(0,Math.floor((now.getTime()-timestamp)/DAY_MS));
  }

  // 工作台列宽（像素）。列宽写进 colgroup：table-layout:fixed 会把表格多余宽度
  // 摊到各列（勾选列曾被撑到 100px 以上），写死列宽后各列宽度与设置一致，
  // 同时把列宽按表头和内容收紧，一屏能看到更多列。
  // 精细化默认隐藏的列（合并显示在其它列里，仍可在“列设置”里单独打开）。
  const PRODUCT_DEFAULT_HIDDEN = ['itemStatus','listedDays','todoAt','blacklistAt'];
  const SELECT_COLUMN_WIDTH = 30;
  const DEFAULT_COLUMN_WIDTH = 72;
  const COLUMN_WIDTHS = {
    daily: {
      date:88, payAmount:84, buyers:62, customProfit:88, procurementRevenue:68, procurementCount:68,
      procurementProfit:68, profitRate:66, visitors:62, searchVisitors:78, conversionRate:66, unitPrice:68,
      refundAmount:84, refundScenes:132, operationPayAmount:88, operationBuyers:86, operationExpense:84,
      adSpend:88, adRevenue:88, adRoi:70, shopSalesRoi:86, affiliateCommission:78, depositDeduction:86,
      shippingInsurance:66, marketingExpense:78, reimbursementExpense:78, technicalFee:66, warehouseExpense:66,
      customerServiceExpense:66, platformFee:66, taxFee:66, grossProfit:76, grossProfitRate:86, promotionShare:78,
    },
    product: {
      storeName:96, category:66, title:168, itemStatus:78, createdAt:84, listedDays:80, productId:112,
      operator:62, todo:56, todoAt:78, blacklist:66, blacklistAt:78,
      adjustedBuyers:62, adjustedPayAmount:68, adjustedConversionRate:66,
      visitors:62, buyers:62, payAmount:68, conversionRate:78, unitPrice:66, cartItems:78, searchVisitors:78, refundRate:66,
      operationOrders:56, operationCleaned:56, operationPrincipal:70, operationCommission:66,
      receivedAmount:68, procurementOrders:78, profit:68, unitProfit:78, profitRate:66, breakEvenRoi:70,
      adSpend:66, adRoi:66, shopSalesRoi:70, sitePromotion:70,
      platformFee:66, marketingExpense:78, depositDeduction:66, taxFee:66, otherFee:66,
      reviewCount:66, reviewImageCount:70, pendingReviewCount:70,
      grossProfit:70, grossProfitRate:70,
    },
  };
  const columnWidth = (mode,key) => key==='__select' ? SELECT_COLUMN_WIDTH : ((COLUMN_WIDTHS[mode]||{})[key] || DEFAULT_COLUMN_WIDTH);
  function columnKeys(mode,groups,selectable){
    return [...(selectable?['__select']:[]),...groups.flatMap(group=>group.columns.map(([key])=>key))];
  }

  function create(host) {
    const {state,api,esc} = host, definitions = window.XXBusinessColumns, dates=window.XXBusinessDates, filters=window.XXBusinessFilters;
    const can = code => typeof host.can!=='function'||host.can(code);
    const modeCode=(mode,action)=>`workbench.business.${mode}.${action}`;
    const allowedModes=()=>Object.keys(modes).filter(mode=>can(modeCode(mode,'view')));
    const defaultMode=()=>allowedModes()[0]||'daily';
    const canView=mode=>can(modeCode(mode,'view'));
    const canSync=mode=>can(modeCode(mode,'sync'));
    const canExport=mode=>can(modeCode(mode,'export'));
    const stores = new Map();
    function workspace(storeId = state.storeId) {
      // storeId：这个店铺工作区里"经营数据"选中的店铺（日报与精细化共用）。
      if (!stores.has(storeId)) stores.set(storeId,{storeId,mode:defaultMode(),views:new Map(),feeDialog:null,manualDialog:null,markDialog:null,columnTemplate:null,feeSequence:0,uiState:null,uiStateLoading:false,uiStateTimer:null,batchStores:new Set(),syncPanel:false,trendDialog:null,batchBusy:new Set()});
      const owner=stores.get(storeId);
      if(!canView(owner.mode))owner.mode=defaultMode();
      return owner;
    }
    function view(storeId = state.storeId, mode = workspace(storeId).mode) {
      const owner = workspace(storeId);
      if (!owner.views.has(mode)) {
        const draft={...dates.initial(mode),...filters.defaults(mode)},applied={...dates.range(draft,mode),...filters.payload(draft,mode)};
        // 精细化默认隐藏“商品状态”“上架天数”“待办时间”“加黑时间”列：
        // 状态显示在商品ID下方，天数/时间跟在对应内容下面（同一列），导出仍包含这些列。
        // storeId：这个页签（日报/精细化）自己选中的店铺。用户要求两个页签互不影响：
        // 在日报里换店铺不会改到精细化，切换页签时各自保留上次选择。
        owner.views.set(mode,{storeId:owner.storeId||storeId,draft,applied,data:null,sequence:0,loading:false,syncing:false,cancelling:false,exporting:false,progress:null,error:'',hiddenColumns:new Set(mode==='product'?PRODUCT_DEFAULT_HIDDEN:[]),syncDialog:null,selectedIds:new Set(),templateName:'',validationPrompt:false,storeIds:null});
      }
      return owner.views.get(mode);
    }
    const current = (storeId,mode) => state.page === 'business' && state.storeId === storeId && workspace(storeId).mode === mode;
    function redraw(storeId,mode) {if (current(storeId,mode)) host.render();}
    const button = (label,action,options = {}) => host.button(label,`business:${action}`,options);
    // 页签当前显示的店铺（没单独选过时就是所属店铺）。日报/精细化各用各的。
    const displayStoreId = selected => selected?.storeId || state.storeId;
    // 日报支持“全部店铺 / 勾选多家店铺合并统计”：只有确实勾选了多家时才带上 storeIds，
    // 单店（默认）请求与旧版本完全一致。
    const payload = (storeId,mode,selected) => ({storeId:displayStoreId(selected),mode,...selected.applied,...(Array.isArray(selected.storeIds)&&selected.storeIds.length>1?{storeIds:[...selected.storeIds]}:{})});
    function queryDraft(selected,mode) {
      return {...dates.range(selected.draft,mode),...filters.payload(selected.draft,mode)};
    }
    function dirtyFilters(selected,mode) {
      try {
        const draft=queryDraft(selected,mode);
        return ['start','end','query','title','productIds','category','itemStatus','creationStart','creationEnd'].some(key=>(draft[key]??'')!==(selected.applied[key]??''));
      } catch {return true;}
    }
    function exportUnavailable(selected,mode) {
      return selected.exporting||selected.loading||!selected.data||!(Number(selected.data.total)>0||arr(selected.data.rows).length)||dirtyFilters(selected,mode);
    }
    function patchDraftState(selected,mode) {
      if(typeof document==='undefined')return;
      const warning=document.querySelector('.business-page [data-business-draft-warning]');
      if(warning)warning.hidden=!dirtyFilters(selected,mode);
      const exportButton=document.querySelector('.business-page [data-action="business:export"]');
      if(exportButton)exportButton.disabled=exportUnavailable(selected,mode);
    }
    function fail(selected,error,storeId,mode) {selected.error=error?.message || String(error);if(selected.syncDialog)selected.syncDialog.error=selected.error;redraw(storeId,mode);}

    // —— 日报多店铺合并（全部店铺 / 勾选多家店铺）——
    const storeScopeIds=selected=>Array.isArray(selected.storeIds)?selected.storeIds.filter(Boolean):[];
    const isMergedScope=selected=>storeScopeIds(selected).length>1;
    // 某家店在当前视图里是否处于“选中”状态（快捷按钮的高亮与下拉框勾选共用这一套判断）。
    const storeInScope=(selected,id)=>{const ids=storeScopeIds(selected);return ids.length?ids.includes(id):id===displayStoreId(selected);};
    const allStoresInScope=selected=>{const ids=storeScopeIds(selected);return ids.length>0&&ids.length>=arr(state.stores).length;};
    function storeScopeText(selected){
      const options=arr(state.stores),ids=storeScopeIds(selected);
      if(ids.length<=1)return options.find(store=>store.id===displayStoreId(selected))?.name||'当前店铺';
      if(ids.length>=options.length)return '全部店铺（'+options.length+' 家）';
      return '已选 '+ids.length+' 家：'+ids.map(id=>options.find(store=>store.id===id)?.name||'').filter(Boolean).join('、');
    }
    async function applyStoreScope(storeId,mode,ids){
      const selected=view(storeId,mode);
      const next=[...new Set(arr(ids).filter(Boolean))];
      selected.storeIds=next.length>1?next:null;
      selected.applied={...selected.applied,page:1};
      selected.data=null;
      await load({storeId,mode});
      if(current(storeId,mode))host.render();
    }
    // 选中某个店铺：日报与精细化共用同一个店铺——在这边换，另一个页签也跟着换，
    // 这样看完这家店的日报可以直接切到同一家店的精细化。
    // 只改经营数据页自己的选择，不切换工作台的“当前店铺”（店铺浏览器、其它模块保持原样）。
    async function selectViewStore(appStoreId,mode,storeId){
      if(!arr(state.stores).some(store=>store.id===storeId))return;
      const owner=workspace(appStoreId);
      owner.storeId=storeId;
      for(const item of owner.views.values()){item.storeId=storeId;item.storeIds=null;}
      const selected=view(appStoreId,mode);
      selected.applied={...selected.applied,page:1};
      selected.data=null;
      await load({storeId:appStoreId,mode});
      if(current(appStoreId,mode))host.render();
    }
    // 需求6（本轮）：点“查看日报同步/同步日报”这类按钮要像“一键同步”一样立即弹出窗口。
    // 切换页签/店铺与读取数据放到后台（先把窗口渲染出来，内容随后补齐）。
    function focusSyncTarget(appStoreId,storeId,mode){
      if(!arr(state.stores).some(store=>store.id===storeId))return null;
      const owner=workspace(appStoreId);
      owner.storeId=storeId;
      for(const item of owner.views.values()){item.storeId=storeId;item.storeIds=null;}
      owner.mode=mode;
      const selected=view(appStoreId,mode);
      selected.applied={...selected.applied,page:1};
      return selected;
    }
    function openSyncDialog(appStoreId,mode){
      const owner=workspace(appStoreId),selected=view(appStoreId,mode);
      owner.feeDialog=null;owner.feeSequence++;
      if(!selected.syncDialog){
        const active=selected.progress||selected.data?.sync;
        const prior=selected.syncing||running(active)?selected.lastSyncDraft||{...selected.draft,start:active?.start||selected.draft.start,end:active?.end||selected.draft.end,sources:arr(active?.selectedSources).length?active.selectedSources:arr(active?.sources).map(item=>item.id).filter(Boolean)}:null;
        // 精细化默认“近7天”：页面草稿就是近7天时，同步弹窗也选中“近7天”，不再显示成“自定义”。
        const week=mode==='product'?dates.preset('week'):null;
        const fresh=week&&selected.draft.start===week.start&&selected.draft.end===week.end?{...selected.draft,preset:'week'}:{...selected.draft,preset:'custom'};
        const base=prior?{...prior,preset:prior.preset||'custom'}:fresh;
        selected.syncDialog={...base,dateMode:'custom',sources:new Set(arr(base.sources).length?base.sources:syncSources(selected).filter(item=>item.sync).map(item=>item.id)),error:''};
      }
      host.render();
      if(typeof document!=='undefined')document.querySelector('.business-sync-dialog')?.focus();
    }
    // 窗口先弹出，再在后台读取该店铺/页签的数据并刷新（弹窗保持打开）。
    function refreshSyncViewLater(appStoreId,mode){
      void Promise.resolve().then(()=>load({storeId:appStoreId,mode})).catch(()=>{}).finally(()=>{if(current(appStoreId,mode))host.render();});
    }

    // 每店的界面状态（列显示 + 已保存模板）保存在该店铺自己的数据文件夹里。
    async function ensureUiState(storeId) {
      const owner=workspace(storeId);
      if(owner.uiState||owner.uiStateLoading)return owner.uiState;
      owner.uiStateLoading=true;
      try{owner.uiState=await api('business.uiStateLoad',{storeId})||{};}catch{owner.uiState={};}
      finally{owner.uiStateLoading=false;}
      return owner.uiState;
    }
    function applyUiState(storeId,mode) {
      const owner=workspace(storeId),selected=view(storeId,mode),saved=owner.uiState?.columns?.[mode];
      const defaults=mode==='product'?PRODUCT_DEFAULT_HIDDEN:[];
      selected.hiddenColumns=new Set(Array.isArray(saved)?saved:defaults);
    }
    function rememberColumns(storeId,mode,selected) {
      const owner=workspace(storeId);owner.uiState=owner.uiState||{};
      owner.uiState.columns=owner.uiState.columns||{};
      owner.uiState.columns[mode]=Array.from(selected.hiddenColumns);
      if(typeof clearTimeout==='function')clearTimeout(owner.uiStateTimer);
      const flush=function(){api('business.uiStateSave',{storeId:storeId,state:owner.uiState||{}}).catch(function(){});};
      // 测试环境没有 setTimeout 时立即保存；真实运行时合并 400ms 内的连续改动。
      if(typeof setTimeout==='function')owner.uiStateTimer=setTimeout(flush,400);else flush();
    }
    async function load({storeId = state.storeId,mode = workspace(storeId).mode} = {}) {
      if (!storeId || !modes[mode]) return;
      // 界面状态与数据并行读取：数据请求先发出（保持原有的加载节奏），拿到后再应用列显示。
      const uiState=ensureUiState(storeId);
      const selected = view(storeId,mode), sequence = ++selected.sequence;
      selected.loading=true;selected.error='';redraw(storeId,mode);
      try {
        const data = await api('business.load',payload(storeId,mode,selected));
        await uiState;
        applyUiState(storeId,mode);
        if (sequence !== selected.sequence) return;
        selected.data=data || {};selected.loading=false;
        if (Number.isInteger(data?.page) && data.page > 0) selected.applied.page=data.page;
        if (data?.sync && !selected.syncing) selected.progress=data.sync;
      } catch (error) {if (sequence === selected.sequence) {selected.error=error.message || String(error);selected.loading=false;}}
      finally {if (sequence === selected.sequence) redraw(storeId,mode);}
    }

    function progressHtml(selected) {
      const sync = selected.progress || selected.data?.sync || {};
      const busy = selected.syncing || running(sync), status = selected.cancelling?'cancelling':(sync.waitingValidation?'waiting':sync.status || (selected.syncing?'running':'idle'));
      const total=Number(sync.total), number=Number(sync.current);
      const hasTotal=Number.isFinite(total)&&total>0&&Number.isFinite(number)&&number>=0;
      return `<div class="business-sync-line" role="status" aria-live="polite">${busy?'<span class="spinner" aria-hidden="true"></span>':''}<strong>${esc(statusLabels[status] || '同步状态待确认')}</strong><span>${esc(sync.message || (selected.syncing?'正在按店铺和日期同步，请保持登录状态…':'搜索和刷新只查询本机数据；在同步设置中点击“开始同步”后才读取后台。'))}</span>${hasTotal?`<span class="business-progress-count">${esc(number)} / ${esc(total)}</span>`:''}</div>${busy&&hasTotal?`<progress class="business-progress" max="${esc(total)}" value="${esc(Math.min(number,total))}" aria-label="经营数据同步进度"></progress>`:''}`;
    }
    function patchProgress(storeId,mode) {
      if (typeof document === 'undefined') return;
      // 面板列出所有店铺，进度/按钮要跟着进度事件实时更新（不取决于当前页显示哪家店）。
      patchSyncPanel(mode);
      if (!current(storeId,mode)) return;
      const slot=document.querySelector('.business-page [data-business-progress]');
      if (slot) slot.innerHTML=progressHtml(view(storeId,mode));
      const dialogProgress=document.querySelector('.business-page [data-business-dialog-progress]');
      if(dialogProgress)dialogProgress.innerHTML=progressHtml(view(storeId,mode));
      const sources=document.querySelector('.business-page [data-business-source-progress]');
      if(sources)sources.innerHTML=sourceProgressHtml(view(storeId,mode));
    }
    function handleProgress(progress) {
      if (progress?.module !== 'business' || !progress.storeId || !modes[progress.mode]) return false;
      // 需求（2026-10-13）：这轮同步结束后把结果记下来，对应店铺卡片要显示“成功/失败/取消”。
      if(finished(progress)){
        state.syncResults=state.syncResults||{};
        state.syncResults[progress.storeId]={...(state.syncResults[progress.storeId]||{}),[progress.mode]:{status:progress.status,message:String(progress.message||'').slice(0,600),finishedAt:progress.finishedAt||progress.at||new Date().toISOString()}};
      }
      // 新一轮同步开始时先隐去上一次的结果（避免“正在同步”旁边还挂着上次的成功/失败）。
      if(running(progress)&&state.syncResults&&state.syncResults[progress.storeId]&&state.syncResults[progress.storeId][progress.mode]){
        state.syncResults[progress.storeId]={...state.syncResults[progress.storeId],[progress.mode]:null};
      }
      // 同步可能是从“显示另一家店”的页签发起的（日报/精细化各选各的店铺），
      // 所以按“页签当前显示的店铺”把进度派发给对应的视图。
      const matching=[];
      for(const [appStore,owner] of stores){
        const candidate=owner.views.get(progress.mode);
        if(candidate&&displayStoreId(candidate)===progress.storeId)matching.push({appStore,selected:candidate});
      }
      if(!matching.length)matching.push({appStore:progress.storeId,selected:view(progress.storeId,progress.mode)});
      for(const item of matching){
      const selected=item.selected;
      selected.progress={...progress};
      // 需求2：平台要求滑动验证时“暂停而不是中止”——自动把正在同步的页面弹出来，
      // 用户划完后自动检测通过并从断点继续。
      if(progress.waitingValidation===true){
        selected.validationPrompt=true;
        selected.validationTabId=typeof progress.tabId==='string'?progress.tabId:'';
        if(typeof progress.sourceId==='string'&&progress.sourceId)selected.validationSource=progress.sourceId;
        // 需求8（本轮）：把来源一起传过去——tabId 可能是隐藏页或过期，界面会再按来源兜底定位。
        if(host.showValidationTab)void host.showValidationTab({storeId:progress.storeId,tabId:typeof progress.tabId==='string'?progress.tabId:'',sourceId:typeof progress.sourceId==='string'?progress.sourceId:'',mode:progress.mode});
      }else if(progress.waitingValidation===false){
        selected.validationPrompt=false;selected.validationTabId='';selected.validationSource='';
        // 用户要求（参考亿满分）：滑块/验证结束后把同步页面收回去，同步继续在后台跑。
        if(typeof progress.sourceId==='string'&&progress.sourceId)void api('business.hideSyncPage',{storeId:progress.storeId,sourceId:progress.sourceId,mode:progress.mode}).catch(function(){});
        if(host.returnFromValidation)void host.returnFromValidation({storeId:progress.storeId});
      }
      if(progress.status==='failed'){
        selected.validationPrompt=needsValidation(progress.message);
        if(selected.validationPrompt&&typeof progress.sourceId==='string'&&progress.sourceId)selected.validationSource=progress.sourceId;
      }
      if(finished(progress))selected.cancelling=false;
      patchProgress(item.appStore,progress.mode);
      // Most sync calls resolve when done. This branch also supports a service
      // which returns a task immediately and emits completion afterwards.
      if (finished(progress) && !selected.syncing) void load({storeId:item.appStore,mode:progress.mode});
      }
      return true;
    }

    function visibleGroups(selected,mode){return definitions.groups(mode).map(group=>({...group,columns:group.columns.filter(([key])=>key===(mode==='daily'?'date':'storeName')||!selected.hiddenColumns.has(key))})).filter(group=>group.columns.length);}
    // 待办：列表（时间/账号/内容/删除）+ 新增内容；黑名单：加入或移出所选商品。
    function markDialogHtml(owner,mode){
      const dialog=owner.markDialog;if(!dialog)return '';
      const store=arr(state.stores).find(item=>item.id===displayStoreId(view()));
      const rows=(dialog.entries||[]).map(item=>`<tr><td>${esc(host.dateTime(item.at))}</td><td>${esc(item.account||'—')}</td><td>${esc(item.content)}</td><td><button type="button" class="button small danger" data-action="business:mark-delete-todo" data-todo-id="${esc(item.id)}">删除</button></td></tr>`).join('');
      const body=dialog.kind==='todo'
        ?`${rows?`<div class="business-mark-table-wrap"><table class="business-mark-table"><thead><tr><th>时间</th><th>账号</th><th>待办内容</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="inline-note">当前没有待办记录。</p>'}<div class="field"><label for="business-mark-content">待办内容</label><textarea id="business-mark-content" data-business-mark="content" rows="2" maxlength="500" placeholder="例如：0309亏损-暂停所有推广">${esc(dialog.content||'')}</textarea></div>`
        :`<div class="field"><label>黑名单操作</label><div class="business-mark-choice"><label class="checkline"><input type="radio" name="business-mark-remove" value="no"${dialog.remove?'':' checked'}> 加入黑名单</label><label class="checkline"><input type="radio" name="business-mark-remove" value="yes"${dialog.remove?' checked':''}> 移出黑名单</label></div></div><p class="inline-note">加入后会记录时间与操作账号；黑名单商品在表格里以底色标出，导出带“黑名单/加黑时间”列。</p>`;
      return `<div class="business-modal-shade"><section class="business-sync-dialog business-mark-dialog" role="dialog" aria-modal="true" aria-labelledby="business-mark-title" tabindex="-1"><header><div><h2 id="business-mark-title">${dialog.kind==='todo'?'待办事项':'调整黑名单'}</h2><p>${esc(store?.name||'')} · 已选 ${esc(dialog.productIds.length)} 个商品</p></div><button type="button" class="button small" data-action="business:mark-close"${dialog.saving?' disabled':''}>关闭</button></header><div class="business-sync-dialog-body">${body}${dialog.error?`<div class="business-error" role="alert">${esc(dialog.error)}</div>`:''}</div><footer><button type="button" class="button" data-action="business:mark-close"${dialog.saving?' disabled':''}>取消</button><button type="button" class="button primary" data-action="business:mark-save"${dialog.saving?' disabled':''}>${dialog.saving?'正在保存…':(dialog.kind==='todo'?'添加/保存':'保存')}</button></footer></section></div>`;
    }
    // 列模板保存弹窗：覆盖已有模板 / 另存为新模板（参考用户给的“保存模板”截图）。
    function columnTemplateDialogHtml(owner,mode){
      const dialog=owner.columnTemplate;if(!dialog)return '';
      const templates=Object.keys(owner.uiState?.templates?.[mode]||{});
      const rename=dialog.kind==='rename';
      const overwrite=rename?false:(dialog.choice||'overwrite')!=='new';
      const options=templates.length?templates.map(name=>`<option value="${esc(name)}"${name===dialog.target?' selected':''}>${esc(name)}</option>`).join(''):'<option value="">（还没有模板）</option>';
      return `<div class="business-modal-shade"><section class="business-sync-dialog business-template-dialog" role="dialog" aria-modal="true" aria-labelledby="business-template-title" tabindex="-1"><header><div><h2 id="business-template-title">${rename?'重命名模板':'保存模板'}</h2><p>把当前列设置保存到这台店铺（每台店铺单独保存）</p></div><button type="button" class="button small" data-action="business:column-template-close">关闭</button></header><div class="business-sync-dialog-body"><div class="business-template-choice"><label class="checkline"><input type="radio" name="business-template-choice" value="overwrite" data-business-template-choice${overwrite?' checked':''}${templates.length?'':' disabled'}> 覆盖已有模板</label><select data-business-template-target${overwrite?'':' disabled'}>${options}</select></div><div class="business-template-choice"><label class="checkline"><input type="radio" name="business-template-choice" value="new" data-business-template-choice${overwrite?'':' checked'}${rename?' checked':''}> 另存为新模板</label><input type="text" data-business-template-name maxlength="20" placeholder="请输入模板名称" value="${esc(dialog.name||'')}"${(!rename&&overwrite)?' disabled':''}></div></div>${dialog.error?`<div class="business-error" role="alert">${esc(dialog.error)}</div>`:''}<footer><button type="button" class="button primary" data-action="business:column-template-confirm">确定</button><button type="button" class="button" data-action="business:column-template-close">取消</button></footer></section></div>`;
    }
    function tableHtml(selected,mode) {
      const data=selected.data || {}, groups=visibleGroups(selected,mode), rows=arr(data.rows);
      const updated=data.lastUpdated||arr(data.history)[0]?.finishedAt||data.sync?.finishedAt;
      // 精细化带勾选列：批量添加/移除待办与黑名单都基于当前页勾选。
      const selectable=mode==='product'&&can('workbench.business.product.marks');
      const allSelected=rows.length>0&&rows.every(row=>selected.selectedIds.has(row.productId));
      // 列宽写死：勾选列固定 30px，其余按设置宽度，避免 fixed 布局把多余宽度摊给各列。
      // CSP(style-src 'self') 会丢弃 HTML 内联 style，列宽值随表格渲染，
      // 渲染完成后由 applyColumnWidths() 用 CSSOM 写回（先写列宽，再写表格总宽）。
      const keys=columnKeys(mode,groups,selectable);
      const widths=keys.map(key=>columnWidth(mode,key));
      const colgroup=`<colgroup>${widths.map(width=>`<col data-width="${width}">`).join('')}</colgroup>`;
      const head=`<thead><tr>${selectable?'<th scope="colgroup" class="business-select-col">选择</th>':''}${groups.map(group=>`<th scope="colgroup" colspan="${group.columns.length}">${esc(group.label)}</th>`).join('')}</tr><tr>${selectable?`<th scope="col" class="business-select-col"><input type="checkbox" data-business-select-all${allSelected?' checked':''} aria-label="全选本页商品"></th>`:''}${groups.flatMap(group=>group.columns).map(([key,label])=>{const active=selected.applied.sortBy===key,ascending=selected.applied.sortDirection==='asc';const tip=key==='sitePromotion'?' title="推广渠道：1 = 全站标准模式下的商品；2 = 关键词；3 = 全站标准模式下的全店；4 = 全站费比模式；空白 = 没有推广中单元"':'';return `<th scope="col" data-column="${key}"${tip} aria-sort="${active?(ascending?'ascending':'descending'):'none'}"><button type="button" class="business-sort" data-action="business:sort" data-column="${key}" title="按${esc(label)}排序">${esc(label)}<span aria-hidden="true">${active?(ascending?'↑':'↓'):'↕'}</span></button></th>`;}).join('')}</tr></thead>`;
      const body=rows.map(row=>`<tr class="${row.blacklisted?'business-row-blacklisted':''}">${selectable?`<td class="business-select-col"><input type="checkbox" data-business-select="${esc(row.productId)}"${selected.selectedIds.has(row.productId)?' checked':''} aria-label="选择商品 ${esc(row.productId)}"></td>`:''}${groups.flatMap(group=>group.columns).map(([key,label,type])=>{
        if(mode==='daily'&&['customProfit','reimbursementExpense'].includes(key)){
          const reason=row[`${key}Reason`]||'',hasValue=typeof row[key]==='number',action=hasValue?'修改':'录入';
          const detail=hasValue?`${definitions.display(row[key],type)}${reason?` · ${reason}`:''}`:'点击此处录入金额和原因';
          if(!can('workbench.business.daily.manual'))return `<td class="business-number" data-column="${key}" title="${esc(detail)}">${esc(definitions.display(row[key],type))}</td>`;
          // 与精细化“待办”一致：整格可点，不加“录/改”小标签。
          return `<td class="business-number business-manual-cell" data-column="${key}" title="${esc(detail)}"><button type="button" class="business-manual-edit" data-action="business:manual-open" data-date="${esc(row.date)}" data-field="${esc(key)}" aria-label="${action}${esc(label)}，${esc(row.date)}">${esc(definitions.display(row[key],type))}</button></td>`;
        }
        if(mode==='product'&&key==='productId'){
          // 商品ID下方显示“出/仓”，对应商品资料里的出售中/仓库中。
          const status=String(row.itemStatus||''),short=status==='出售中'?'出':status==='仓库中'?'仓':'';
          const title=status?`${row.productId}\n商品状态：${status}`:String(row.productId||'');
          return `<td class="business-text business-id-cell" data-column="${key}" title="${esc(title)}"><span class="business-id-value">${esc(row.productId)}</span>${short?`<em class="business-status-chip" title="${esc(status)}">${esc(short)}</em>`:''}</td>`;
        }
        if(mode==='product'&&key==='todo'){
          // 待办与待办时间放在同一列（时间在条数下面）；导出仍是两列。
          const count=Number(row.todoCount)||0,list=(row.todoList||[]).map(item=>`${item.at} ${item.account} ${item.content}`).join('\n'),detail=list||String(row.todo||'')||'点击添加待办';
          const when=row.todoAt?dateOnly(row.todoAt):'';
          return `<td class="business-text business-todo-cell" data-column="${key}" title="${esc(detail||'点击添加待办')}">${can('workbench.business.product.marks')?`<button type="button" class="business-todo-open" data-action="business:todo-open" data-product-id="${esc(row.productId)}" aria-label="待办，商品 ${esc(row.productId)}">${count?esc(count):'—'}</button>`:`<span>${count?esc(count):'—'}</span>`}${when?`<span class="business-cell-sub" title="待办时间 ${esc(String(row.todoAt||''))}">${esc(when)}</span>`:''}</td>`;
        }
        if(key==='createdAt'&&mode==='product'){
          // 上架时间与上架天数放在同一列（参考亿满分：日期 + 天数小标）；导出仍是两列。
          const label=row.createdAt?dateOnly(row.createdAt):'—';
          const days=row.listedDays===null||row.listedDays===undefined?'':String(row.listedDays);
          const title=row.createdAt?`上架时间：${row.createdAt}\n上架天数：${days||'—'}\n更新时间：${updated?host.dateTime(updated):'尚未同步'}`:(row.createdAtReason||'后台未返回上架时间');
          return `<td class="business-text business-created-cell" data-column="${key}" title="${esc(title)}"><span>${esc(label)}</span>${days?`<em class="business-days-chip" title="上架天数 ${esc(days)} 天">${esc(days)}</em>`:''}</td>`;
        }
        if(mode==='product'&&key==='blacklist'){
          // 黑名单与加黑时间放在同一列（时间在状态下面）；导出仍是两列。
          const marked=row.blacklisted==='是'||row.blacklisted===true;
          const when=row.blacklistAt?dateOnly(row.blacklistAt):'';
          const title=marked?`已加入黑名单${row.blacklistAt?`\n加黑时间：${row.blacklistAt}`:''}`:'未加入黑名单';
          return `<td class="business-text business-blacklist-cell" data-column="${key}" title="${esc(title)}"><span>${marked?'是':'—'}</span>${marked&&when?`<span class="business-cell-sub" title="${esc(String(row.blacklistAt||''))}">${esc(when)}</span>`:''}</td>`;
        }
        if(mode==='product'&&['todoAt','blacklistAt'].includes(key)){
          // 待办时间/加黑时间在工作台只显示日期（导出仍保留原值）。
          return `<td class="business-text" data-column="${key}" title="${esc(row[key]||'')}">${esc(dateOnly(row[key]))}</td>`;
        }
        const title=key==='taxFee'&&row.taxNote?row.taxNote:definitions.display(row[key],type);
        // 需求9：数值单元格可点击，弹出该指标的每日趋势图（只读本机已保存数据）。
        const numeric=['money','number','percent','decimal'].includes(type)&&row[key]!==null&&row[key]!==undefined;
        const trendAttrs=numeric&&can('workbench.business.product.trend')?` data-action="business:trend" data-product="${esc(row.productId||'')}" data-date="${esc(row.date||'')}" role="button" tabindex="0"`:'';
        return `<td class="${type === 'title'?'business-title':type === 'text'?'business-text':'business-number'}${numeric?' business-trend-cell':''}" data-column="${key}"${trendAttrs} title="${esc(numeric?`${title}\n点击查看每日趋势`:title)}">${esc(definitions.display(row[key],type,{zero:mode==='product'}))}</td>`;
      }).join('')}</tr>`).join('');
      const empty=selected.loading?'正在查询本机数据…':selected.error?'本次查询未完成，请根据提示重试。':'所选范围暂无已保存数据。可先同步，或调整日期后查询。';
      const coverage=data.summary?.coverage || data.coverage || {}, complete=coverage.complete!==false&&data.scope!=='visible-page'&&coverage.scope!=='visible-page';
      // 合计只汇总已同步日期；缺失的整天不按 0 计算，并在合计标题里写明。
      const mergedNames=arr(data.storeNames),mergedTag=mergedNames.length>1?`（${mergedNames.length}家店铺合并）`:'';
      const totals=groups.flatMap(group=>group.columns).map(([key,,type],index)=>`<td data-column="${key}" class="${type==='text'||type==='title'?'business-text':'business-number'}">${index===0?esc(`合计${mergedTag}${complete?'':'（仅含已同步日期）'}`):esc(definitions.display(data.summary?.[key],type))}</td>`).join('');
      // 合计行要和表头对齐：精细化有勾选列，先补一个空的勾选格，否则整行会左移一格。
      const totalRow=`<tr class="business-total">${selectable?'<td class="business-select-col" aria-hidden="true"></td>':''}${totals}</tr>`;
      return `<div class="business-table-wrap" tabindex="0" role="region" aria-label="${modes[mode]}数据表，可横向滚动"><table class="business-table" data-column-widths="${widths.join(',')}">${colgroup}${head}<tbody>${body}${rows.length?totalRow:''}</tbody></table></div>${rows.length?'':`<div class="business-empty-message">${empty}</div>`}`;
    }
    function columnsHtml(selected,mode){
      const owner=workspace();
      const templates=Object.keys(owner.uiState?.templates?.[mode]||{});
      // 顶部工具条（参考用户截图）：恢复默认 | 模板下拉框（没有模板时是空白框） | 保存模板。
      const templateRows=templates.length?templates.map(name=>`<div class="business-template-row"><button type="button" class="business-template-apply" data-action="business:column-template-apply" data-name="${esc(name)}" title="应用模板 ${esc(name)}">${esc(name)}</button><button type="button" class="business-template-icon" data-action="business:column-template-rename" data-name="${esc(name)}" title="重命名模板" aria-label="重命名模板 ${esc(name)}">✎</button><button type="button" class="business-template-icon danger" data-action="business:column-template-delete" data-name="${esc(name)}" title="删除模板" aria-label="删除模板 ${esc(name)}">🗑</button></div>`).join(''):'<p class="inline-note">还没有模板。选好要显示的列之后点“保存模板”。</p>';
      const tools=`<div class="business-column-tools">${button('恢复默认','columns-reset',{small:true})}<details class="business-template-picker"><summary title="选择模板" aria-label="选择模板"><span>${esc(selected.templateName||'')}</span><i aria-hidden="true">▾</i></summary><div class="business-template-list">${templateRows}</div></details>${button('保存模板','column-template-open',{small:true})}</div>`;
      const fields=definitions.groups(mode).map(group=>`<fieldset><legend>${esc(group.label)}</legend>${group.columns.map(([key,label])=>`<label><input type="checkbox" data-business-column="${esc(key)}"${selected.hiddenColumns.has(key)?'':' checked'}${key===(mode==='daily'?'date':'storeName')?' disabled':''}>${esc(label)}</label>`).join('')}</fieldset>`).join('');
      return `<details class="business-column-picker"><summary>列设置</summary><div class="business-column-menu"><div class="business-column-head"><p>仅调整表格显示；导出保留全部指标。${mode==='daily'?'日期':'店铺'}始终显示。选择会自动记住，下次打开保持。</p>${tools}</div>${fields}</div></details>`;
    }
    function syncSources(selected){
      const sources=arr(selected.data?.capabilities?.sources);
      return sources.length?sources.map(item=>({...item,sync:item.sync===true&&item.verified===true})):[{id:'sycm',label:'生意参谋',sync:selected.data?.capabilities?.sync===true&&selected.data?.capabilities?.verified===true,verified:selected.data?.capabilities?.verified===true,message:selected.data?.capabilities?.message||'正在确认可用来源，请先刷新。'}];
    }
    function sourceProgressHtml(selected){
      const progress=selected.progress||{}, sourceStates=progress.sources||{}, dialog=selected.syncDialog;
      return syncSources(selected).map(source=>{
        const enabled=dialog?.sources.has(source.id),item=Array.isArray(sourceStates)?sourceStates.find(row=>row.id===source.id):sourceStates[source.id];
        // Global completion must not imply every checked source independently succeeded.
        const label=!source.sync?'未接入':item?.status?(statusLabels[item.status]||item.status):progress.sourceId===source.id?(statusLabels[progress.status]||'同步中'):enabled?'已选择':'未选择';
        // 每个渠道一行：名称 + 进度条 + 百分比 + 说明（参考用户给的同步界面截图）。
        const total=Number(item?.total),current=Number(item?.current);
        const percent=Number.isFinite(total)&&total>0&&Number.isFinite(current)?Math.max(0,Math.min(100,Math.round(current/total*100))):null;
        const message=String(item?.message||label);
        return `<div class="business-source-progress"><span class="business-source-name">${esc(source.label)}</span>${percent===null?'<span class="business-source-meter-slot"></span>':`<progress class="business-source-meter" max="${esc(total)}" value="${esc(Math.max(0,Math.min(current,total)))}" aria-label="${esc(source.label)}同步进度"></progress><span class="business-source-percent">${esc(percent)}%</span>`}<span class="business-source-message" title="${esc(message)}">${esc(message)}</span></div>`;
      }).join('');
    }
    function syncDialogHtml(selected,mode){
      const dialog=selected.syncDialog;if(!dialog)return '';
      const busy=selected.syncing||running(selected.progress||selected.data?.sync),store=arr(state.stores).find(item=>item.id===displayStoreId(selected));
      // 用户要求：日报不展示“商品资料”（它是整店清单，只在精细化同步里读取）。
      const sources=syncSources(selected).filter(item=>!(mode==='daily'&&item.id==='seller'));
      const presets=[['yesterday','昨天'],['week','近7天'],['recent30','近30天'],['month','本月'],['last-month','上个月']];
      const presetsHtml=mode==='product'?`<div class="business-sync-presets">${presets.map(([id,label])=>button(label,'sync-preset',{small:true,primary:dialog.preset===id,disabled:busy,attrs:`data-value="${id}"`})).join('')}${button('自定义','sync-preset',{small:true,primary:dialog.preset==='custom',disabled:busy,attrs:'data-value="custom"'})}</div>`:'';
      const month=mode==='daily'?`<div class="field"><label for="business-sync-month">同步月份</label><input id="business-sync-month" type="month" data-business-sync-field="month" value="${esc(dialog.month)}" max="${dates.today(-1).slice(0,7)}"${busy?' disabled':''}></div>`:'';
      return `<div class="business-modal-shade"><button type="button" class="business-modal-close" data-action="business:sync-close" aria-label="关闭同步窗口" title="关闭">×</button><section class="business-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="business-sync-title" tabindex="-1"><header><div><h2 id="business-sync-title">同步${modes[mode]}</h2><p>${esc(store?.name||'当前店铺')} · 复用该店铺的登录会话</p></div>${button(busy?'收起窗口，继续同步':'关闭','sync-close',{small:true,attrs:'aria-label="收起同步窗口"'})}</header><div class="business-sync-dialog-body">${presetsHtml}<div class="business-sync-dates">${month}<div class="field"><label for="business-sync-start">开始日期</label><input id="business-sync-start" type="date" data-business-sync-field="start" value="${esc(dialog.start)}" max="${dates.today(-1)}"${busy?' disabled':''}></div><div class="field"><label for="business-sync-end">结束日期</label><input id="business-sync-end" type="date" data-business-sync-field="end" value="${esc(dialog.end)}" max="${dates.today(-1)}"${busy?' disabled':''}></div></div><fieldset class="business-sync-sources"><legend>勾选同步内容</legend>${sources.map(source=>`<label title="${esc(source.message||'')}"><input type="checkbox" data-business-source="${esc(source.id)}"${dialog.sources.has(source.id)?' checked':''}${!source.sync||busy?' disabled':''}><span>${esc(source.label)}</span></label>`).join('')}</fieldset><div data-business-dialog-progress>${progressHtml(selected)}</div><div data-business-source-progress>${sourceProgressHtml(selected)}</div>${dialog.error?`<div class="business-error" role="alert">${esc(dialog.error)}</div>`:''}</div><footer>${button(busy?'正在同步…':'开始同步','sync-start',{primary:true,icon:'refresh',disabled:busy||!sources.some(item=>item.sync&&dialog.sources.has(item.id))})}${button(selected.cancelling?'正在取消…':'取消同步','cancel',{disabled:!busy||selected.cancelling})}</footer></section></div>`;
    }
    function historyHtml(data) {
      const history=arr(data.history).slice(0,8);
      if (!history.length) return '';
      return `<details class="business-history"><summary>最近同步记录</summary><div>${history.map(item=>`<div class="business-history-row"><time>${esc(host.dateTime(item.at || item.finishedAt || item.completedAt || item.startedAt || item.capturedAt))}</time><span>${esc(modes[item.mode] || '')} ${esc([item.start,item.end].filter(Boolean).join(' 至 '))}</span><span>${esc(statusLabels[item.status] || item.status || '记录')}</span><span>${esc(item.message || '')}</span></div>`).join('')}</div></details>`;
    }
    // 列宽用 CSSOM 写回：table-layout:fixed 会把表格多余宽度摊到各列，
    // 必须同时写列宽和表格总宽，勾选列才会保持 30px。
    function applyColumnWidths(){
      if(typeof document==='undefined'||typeof document.querySelectorAll!=='function')return;
      for(const table of document.querySelectorAll('.business-table[data-column-widths]')){
        const widths=String(table.dataset.columnWidths||'').split(',').map(value=>Number(value)||0);
        const columns=[...table.querySelectorAll('colgroup col')];
        let total=0;
        columns.forEach((column,index)=>{const width=widths[index]>0?widths[index]:DEFAULT_COLUMN_WIDTH;column.style.width=width+'px';total+=width;});
        if(total>0)table.style.width=total+'px';
      }
    }
    // 需求5：顶部“数据同步”面板——店铺卡片（可勾选）+ 单店同步 + 一键批量同步 + 取消同步。
    function runningSyncFor(id,mode){
      const entries=Object.values(state.progress||{});
      return entries.find(item=>item&&item.module==='business'&&item.storeId===id&&(!mode||item.mode===mode))||null;
    }
    // 上次同步结果（成功/失败/取消）：来自进度事件或面板打开时从主进程读取的落盘状态。
    function syncResultFor(id,mode){
      const entry=state.syncResults&&state.syncResults[id];
      const result=entry&&entry[mode];
      return result&&result.status?result:null;
    }
    // 打开“数据同步”面板时向主进程要一次各店铺两页签的上次结果（重启后也能显示）。
    async function refreshSyncResults(){
      if(typeof api!=='function')return;
      try{
        const data=await api('business.syncResults',{storeIds:arr(state.stores).map(store=>store.id)});
        const results=data&&data.results;if(!results)return;
        const merged={...(state.syncResults||{})};
        for(const [id,entry] of Object.entries(results)){
          const current=merged[id]||{},next={...current};
          for(const mode of ['daily','product']){
            const incoming=entry&&entry[mode],existing=current[mode];
            if(incoming&&(!existing||new Date(incoming.finishedAt||0).getTime()>=new Date(existing.finishedAt||0).getTime()))next[mode]=incoming;
          }
          merged[id]=next;
        }
        state.syncResults=merged;
        host.render();
      }catch{}
    }
    // 需求2：面板按截图调整——一键同步按钮放到顶部（原说明文字位置，说明已删），
    // 店铺卡片里“同步日报/同步精细化”放在店名下面（原卡片右侧位置腾出来给进度与查看按钮）。
    function syncPanelHtml(owner){
      if(!owner.syncPanel)return '';
      const list=arr(state.stores);
      const accounts=arr(state.cache&&state.cache['accounts:all']?state.cache['accounts:all'].stores:[]);
      const picked=owner.batchStores.size;
      // 需求3（本轮）：全选/清空选择放到“一键同步日报”前面。
      const batch=(label,m)=>can('workbench.business.sync.manage')&&canSync(m)?button(owner.batchBusy&&owner.batchBusy.has(m)?'正在同步…':`${label}${picked?`（${picked} 家）`:''}`,'batch-open',{primary:true,icon:'refresh',disabled:owner.batchBusy&&owner.batchBusy.has(m),attrs:`data-mode="${m}"`}):'';
      const top=`<header><div class="business-sync-panel-top"><h3>数据同步</h3>${button('全选','batch-all',{small:true})}${button('清空选择','batch-none',{small:true,disabled:!picked})}${batch('一键同步日报','daily')}${batch('一键同步精细化','product')}</div></header>`;
      if(!list.length)return `<section class="business-sync-panel">${top}<p class="inline-note">还没有店铺，请先到“店铺登录”添加。</p></section>`;
      const cards=list.map(store=>syncStoreCardHtml(owner,store,accounts.find(item=>item&&item.id===store.id)||{},owner.mode)).join('');
      return `<section class="business-sync-panel">${top}<div class="business-sync-store-grid">${cards}</div></section>`;
    }
    // 单张店铺卡片：只显示“当前页签这个模式”的进度与取消/查看（用户要求：在日报页看到的就是日报的，
    // 选择精细化时看到的就是精细化的）；空闲时显示两个同步按钮。一键同步会自动切到对应页签。
    function syncStoreCardHtml(owner,store,card,focusMode){
      const mode=focusMode||owner.mode;
      const running=runningSyncFor(store.id,mode);
      const progress=running?`<p class="business-sync-store-progress" title="${esc(running.message||'')}">${esc(running.message||'同步中')}${running.total?` · ${esc(String(running.current||0))}/${esc(String(running.total))}`:''}</p>`:'';
      // 需求（2026-10-13）：同步成功/失败/取消都要在这家店的卡片上显示结果（关掉软件再打开也看得到）。
      const result=running?null:syncResultFor(store.id,mode);
      const resultText=result?`${result.status==='completed'?'上次同步成功':result.status==='canceled'?'上次同步已取消':'上次同步失败'}：${result.message||''}${result.finishedAt?`（${esc(host.dateTime(result.finishedAt))}）`:''}`:'';
      const resultHtml=result?`<p class="business-sync-store-result ${result.status==='completed'?'ok':result.status==='canceled'?'warn':'bad'}" title="${esc(result.message||'')}">${esc(resultText)}</p>`:'';
      const actions=running
        ? button('取消同步','sync-cancel-one',{small:true,attrs:`data-id="${esc(store.id)}" data-mode="${mode}"`})
          +button(mode==='daily'?'查看日报同步':'查看精细化同步','sync-view',{small:true,attrs:`data-id="${esc(store.id)}" data-mode="${mode}"`})
        : (canSync('daily')?button('同步日报','sync-one',{small:true,attrs:`data-id="${esc(store.id)}" data-mode="daily"`}):'')+(canSync('product')?button('同步精细化','sync-one',{small:true,attrs:`data-id="${esc(store.id)}" data-mode="product"`}):'');
      return `<article class="business-sync-store${owner.batchStores.has(store.id)?' picked':''}"><div class="business-sync-store-head"><label class="business-sync-store-check" title="勾选后可批量同步"><input type="checkbox" data-business-batch-store="${esc(store.id)}"${owner.batchStores.has(store.id)?' checked':''} aria-label="选择店铺 ${esc(store.name)}"></label><span class="store-avatar">${esc(String(store.name||'店').slice(0,1))}</span><div class="business-sync-store-info"><strong>${esc(store.name)}</strong><p>${esc(card.label||'待检查')}${store.id===displayStoreId(view())?' · 当前店铺':''}</p>${progress}${resultHtml}</div></div><div class="business-sync-store-actions">${actions}</div></article>`;
    }
    // 同步开始时“查看…同步/取消同步”按钮要及时出现：进度事件里就地重建这张店铺卡片
    //（用户反馈“收起窗口后再点查看没反应”，实际是面板没刷新、按钮根本还没出现）。
    function patchSyncPanel(mode){
      if(typeof document==='undefined')return;
      const panel=document.querySelector('.business-sync-panel');if(!panel)return;
      const owner=workspace();
      // 需求3（本轮）：面板只按当前页签的模式刷新（在日报页不会冒出精细化的进度/按钮）。
      if(mode&&owner.mode!==mode)return;
      const accounts=arr(state.cache&&state.cache['accounts:all']?state.cache['accounts:all'].stores:[]);
      const nodes=[...(panel.querySelectorAll?panel.querySelectorAll('.business-sync-store'):[])]||[];
      for(const store of arr(state.stores)){
        const node=nodes.find(item=>{
          const marker=item.querySelector&&item.querySelector('[data-action="business:sync-one"],[data-action="business:sync-view"],[data-action="business:sync-cancel-one"]');
          return String(marker?.dataset?.id||'')===store.id;
        });
        if(!node)continue;
        node.outerHTML=syncStoreCardHtml(owner,store,accounts.find(item=>item&&item.id===store.id)||{},owner.mode);
      }
    }
    // 需求2：一键同步先弹窗选“同步时间 + 同步内容”，所有店铺按同一份选择并行同步。
    function batchDialogHtml(owner){
      const dialog=owner.batchDialog;if(!dialog)return '';
      const mode=dialog.mode,busy=owner.batchBusy.has(dialog.mode),targets=owner.batchTargets||[];
      const presets=[['yesterday','昨天'],['week','近7天'],['recent30','近30天'],['month','本月'],['last-month','上个月']];
      // 需求（2026-10-13）：日报与精细化的快捷日期选择一致（日报默认“本月”）。
      const presetHtml=`<div class="business-sync-presets">${presets.map(([id,label])=>button(label,'batch-preset',{small:true,primary:dialog.preset===id,disabled:busy,attrs:`data-value="${id}"`})).join('')}</div>`;
      const month=mode==='daily'?`<div class="field"><label for="business-batch-month">同步月份</label><input id="business-batch-month" type="month" data-business-batch-field="month" value="${esc(dialog.month)}" max="${dates.today(-1).slice(0,7)}"${busy?' disabled':''}></div>`:'';
      const sources=syncSources(view()).filter(item=>!(mode==='daily'&&item.id==='seller'));
      return `<div class="business-modal-shade"><button type="button" class="business-modal-close" data-action="business:batch-close" aria-label="关闭" title="关闭">×</button><section class="business-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="business-batch-title" tabindex="-1"><header><div><h2 id="business-batch-title">一键同步${modes[mode]}</h2><p>${esc(`${targets.length} 家店铺`)} · 按下面选择的日期与内容同时同步</p></div>${button(busy?'正在提交…':'关闭','batch-close',{small:true,attrs:'aria-label="关闭一键同步窗口"'})}</header><div class="business-sync-dialog-body">${presetHtml}<div class="business-sync-dates">${month}<div class="field"><label for="business-batch-start">开始日期</label><input id="business-batch-start" type="date" data-business-batch-field="start" value="${esc(dialog.start)}" max="${dates.today(-1)}"${busy?' disabled':''}></div><div class="field"><label for="business-batch-end">结束日期</label><input id="business-batch-end" type="date" data-business-batch-field="end" value="${esc(dialog.end)}" max="${dates.today(-1)}"${busy?' disabled':''}></div></div><fieldset class="business-sync-sources"><legend>勾选同步内容</legend>${sources.map(source=>`<label><input type="checkbox" data-business-batch-source="${esc(source.id)}"${dialog.sources.has(source.id)?' checked':''}${!source.sync||busy?' disabled':''}><span>${esc(source.label)}</span></label>`).join('')}</fieldset>${dialog.error?`<div class="business-error" role="alert">${esc(dialog.error)}</div>`:''}</div><footer>${button(busy?'正在提交…':'开始同步','batch-start',{primary:true,disabled:busy||!sources.some(item=>item.sync&&dialog.sources.has(item.id))})}</footer></section></div>`;
    }
    // 需求9/需求5：趋势图实现在独立模块 business/trend.js（可单测），这里只做桥接。
    function trendDialogHtml(owner){return window.XXBusinessTrend?window.XXBusinessTrend.dialog(owner.trendDialog,{esc,button,display:definitions.display}):'';}

    // 由外层在写入页面 HTML 之后同步调用（rAF 在窗口被遮挡时会停摆）。
    function render() {
      const owner=workspace(),mode=owner.mode,selected=view(),data=selected.data||{},summary=data.summary||{};
      const coverage=summary.coverage||data.coverage||{};
      const syncing=selected.syncing||running(selected.progress||data.sync),anotherSync=[...owner.views.values()].some(item=>item.syncing||running(item.progress||item.data?.sync));
      const total=Number.isInteger(data.total)&&data.total>=0?data.total:arr(data.rows).length,size=Number(data.pageSize)||selected.applied.pageSize,page=Number(data.page)||selected.applied.page,pages=Math.max(1,Math.ceil(total/size));
      const tabs='<nav class="business-tabs" aria-label="经营数据视图">'+Object.entries(modes).filter(([id])=>canView(id)).map(([id,label])=>button(label,'mode',{attrs:'data-mode="'+id+'" aria-current="'+(mode===id?'page':'false')+'"',primary:mode===id})).join('')+'</nav>';
      const storeOptions=arr(state.stores);
      const mergedScope=isMergedScope(selected),allScope=allStoresInScope(selected);
      const viewStore=displayStoreId(selected);
      const singlePicker='<div class="field business-store-field"><label for="business-store">选择店铺</label><select id="business-store" data-business-field="storeId">'+storeOptions.map(store=>'<option value="'+esc(store.id)+'"'+(store.id===viewStore?' selected':'')+'>'+esc(store.name)+'</option>').join('')+'</select></div>';
      // 日报：店铺选择改成多选（第一个选项是全部店铺），勾选多家后按日期合并统计。
      const mergedPicker=storeOptions.length?'<div class="field business-store-field"><label>选择店铺</label><details class="business-store-picker"><summary title="勾选要一起统计的店铺"><span>'+esc(storeScopeText(selected))+'</span><i aria-hidden="true">▾</i></summary><div class="business-store-menu"><label><input type="checkbox" data-business-store-scope="*"'+(allScope?' checked':'')+'><span>'+esc('全部店铺（'+storeOptions.length+' 家）')+'</span></label>'+storeOptions.map(store=>'<label><input type="checkbox" data-business-store-scope="'+esc(store.id)+'"'+(storeInScope(selected,store.id)?' checked':'')+'><span>'+esc(store.name)+'</span></label>').join('')+'<p class="inline-note">勾选多家店铺后，表格按日期合并展示这些店铺的合计；只勾一家会切到这家店的单店日报。店铺选择在日报和精细化之间共用，切页签保持同一家店，同步也按所选店铺进行。</p></div></details></div>':'';
      const storePicker=mode==='daily'?mergedPicker:singlePicker;
      // 下方下拉框与上方店名按钮共用同一套“选中”状态：点店名只看这家店，点“全部店铺”看合并统计。
      // 上方店名按钮与下方下拉框是一套：只改这个页签显示的店铺（日报/精细化互不影响）。
      const shortcuts=storeOptions.length?'<nav class="business-stores" aria-label="店铺快捷切换">'+(mode==='daily'&&storeOptions.length>1?button('全部店铺','store-scope-all',{small:true,primary:allScope,attrs:'aria-pressed="'+(allScope?'true':'false')+'" title="合并展示全部店铺的日报"'})+'':'' )+storeOptions.map(store=>button(esc(store.name),'store-single',{small:true,primary:storeInScope(selected,store.id),attrs:'data-id="'+esc(store.id)+'" aria-current="'+(storeInScope(selected,store.id)?'true':'false')+'" title="只看这家店"'})).join('')+'</nav>':'';
      const datePicker='<div class="field business-range-field"><label>数据日期</label><div class="business-range-inputs"><input type="date" id="business-start" data-business-field="start" aria-label="开始日期" value="'+esc(selected.draft.start)+'" max="'+dates.today()+'"><span>至</span><input type="date" id="business-end" data-business-field="end" aria-label="结束日期" value="'+esc(selected.draft.end)+'" max="'+dates.today()+'"></div></div>';
      const controls=mode==='daily'?'<div class="business-controls">'+storePicker+filters.unavailable('运营组')+dates.render(selected.draft,mode,{esc,button})+'</div>':filters.render(selected.draft,{esc,storePicker,datePicker});
      const queryPresets='<div class="business-sync-presets" aria-label="查询日期快捷选择">'+[['yesterday','昨天'],['week','近7天'],['recent30','近30天'],['month','本月'],['last-month','上个月']].map(([id,label])=>button(label,'query-preset',{small:true,disabled:selected.loading,attrs:'data-value="'+id+'"'})).join('')+'</div>';
      const syncActions=canExport(mode)?'<div class="business-sync-actions">'+button(selected.exporting?'正在导出…':'导出数据','export',{icon:'export',disabled:exportUnavailable(selected,mode)})+'</div>':'';
      const queryActions='<div class="business-query-row">'+queryPresets+'<div class="business-control-actions">'+button('搜索','query',{primary:true,icon:'search',disabled:selected.loading})+button('重置','reset',{disabled:selected.loading})+'</div>'+syncActions+'</div>';
      const draftWarning='<div data-business-draft-warning'+(dirtyFilters(selected,mode)?'':' hidden')+'>'+host.notice('筛选条件已修改，请先点击“搜索”再导出。当前表格仍显示上次搜索结果。','warning')+'</div>';
      // 依据用户要求：页面不再显示口径说明与完整性提示（导出文件仍保留全部说明文字）。
      const updated=data.lastUpdated||arr(data.history)[0]?.finishedAt||data.sync?.finishedAt;
      // 依据用户要求：精细化不再显示快捷搜索框（标题/ID/类目仍可在筛选区输入）。
      const keyword='';
      const selectionCount=selected.selectedIds?selected.selectedIds.size:0;
      const feeButton=can('workbench.business.fees')?(window.XXBusinessFeeSettings?.button()||''):'';
      const markButtons=mode==='product'&&can('workbench.business.product.marks')?button(selectionCount?`添加待办（${selectionCount}）`:'添加待办','todo-batch',{small:true,disabled:!selectionCount})+button(selectionCount?`调整黑名单（${selectionCount}）`:'调整黑名单','blacklist-batch',{small:true,disabled:!selectionCount}):'';
      const toolbar='<div class="business-report-toolbar"><div>'+feeButton+button('刷新','refresh',{small:true,icon:'refresh',disabled:selected.loading})+markButtons+(syncing&&canSync(mode)?button('取消同步','cancel',{disabled:selected.cancelling}):'')+'</div><div>'+keyword+columnsHtml(selected,mode)+'</div></div>';
      // 本机经营商品数和官方本次报表数必须分开显示：前者只是本机已保存的
      // 经营商品记录，不是店铺商品库总数，也不等于官方报表条数。
      const counts=data.counts||{},officialSummary=arr(counts.official).map(item=>`${item.label} ${item.totalRows} 条 / 去重 ${item.uniqueProducts} 个`).join('；');
      const catalog=counts.catalog||null;
      let footerText;
      if(mode==='product'){
        const localCount=Number(counts.local?.products??data.total)||0,matchedCount=Number(data.total)||0;
        footerText='本机经营商品数 '+esc(localCount)+' 个'+(matchedCount!==localCount?'（当前筛选后 '+esc(matchedCount)+' 个）':'')+(officialSummary?' · 官方本次报表 '+esc(officialSummary):'')+(catalog?` · 商品库 ${esc(catalog.totalCount)} 件（我的商品${catalog.capturedAt?`，${esc(host.dateTime(catalog.capturedAt))} 更新`:''}）`:'');
      }else{const mergedNames=arr(data.storeNames);footerText=(mergedNames.length>1?esc(`合并 ${mergedNames.length} 家店铺（${mergedNames.join('、')}） · `):'')+'本机已保存 '+esc(total)+' 条';}
      const pageJump='<div class="business-page-jump"><label for="business-goto">跳至</label><input id="business-goto" type="number" min="1" max="'+esc(pages)+'" step="1" value="'+esc(page)+'" aria-label="跳转到指定页" data-business-field="goto"><span>页</span>'+button('跳转','goto',{small:true,disabled:selected.loading||pages<=1})+'</div>';
      const footer='<div class="table-footer"><span title="'+esc(mode==='product'?'本机经营商品数=所选来源与日期中已保存的日记录按商品ID去重，不含从未出现在报表中的商品；商品库=天猫“我的商品”清单总数；官方本次报表=本次已完整读取的官方报表总条数与去重商品数。':'本机已保存的日报天数')+'">'+footerText+' · 第 '+esc(page)+' / '+esc(pages)+' 页</span><div class="business-pagination">'+pageJump+'<label for="business-page-size">每页</label><select id="business-page-size" data-business-field="pageSize" aria-label="每页条数">'+[20,50,100].map(value=>'<option value="'+value+'"'+(Number(selected.draft.pageSize)===value?' selected':'')+'>'+value+' 条</option>').join('')+'</select>'+button('上一页','previous',{small:true,disabled:selected.loading||page<=1})+button('下一页','next',{small:true,disabled:selected.loading||page>=pages})+'</div></div>';
      const syncEntry=canSync('daily')||canSync('product')?button('数据同步','sync-panel',{icon:'refresh',primary:true}):'';
      return '<div class="business-page" data-business-mode="'+mode+'"><div class="business-content"'+(selected.syncDialog||owner.feeDialog||owner.manualDialog||owner.markDialog||owner.columnTemplate||owner.trendDialog||owner.batchDialog?' inert':'')+'>'+host.heading('经营数据','店铺日报 / 精细化 · 本机独立数据',syncEntry)+tabs+syncPanelHtml(owner)+'<div class="business-report">'+shortcuts+'<section class="business-filter-panel">'+controls+queryActions+draftWarning+'</section>'+toolbar+'<div data-business-progress>'+progressHtml(selected)+'</div>'+(selected.validationPrompt&&!syncing?'<div class="business-validation-prompt" role="alert"><span>平台要求完成滑动验证：正在同步时请完成页面上的滑块，完成后会自动从断点继续（超过 8 分钟未完成会自动停下）；如果同步已经停止，点“我已划完，立即继续”会从断点重新续传。</span><button type="button" class="button primary" data-action="business:open-validation">去店铺浏览器完成滑块</button><button type="button" class="button" data-action="business:validation-retry">我已划完，立即继续</button><button type="button" class="button" data-action="business:dismiss-validation">知道了</button></div>':'')+(selected.error?'<div class="business-error" role="alert">'+esc(selected.error)+'</div>':'')+tableHtml(selected,mode)+footer+historyHtml(data)+'</div></div>'+syncDialogHtml(selected,mode)+(owner.feeDialog?window.XXBusinessFeeSettings.markup({storeName:arr(state.stores).find(s=>s.id===viewStore)?.name||'',...owner.feeDialog,esc}):'')+(owner.manualDialog?window.XXBusinessManual.markup(owner.manualDialog,esc,button):'')+markDialogHtml(owner,mode)+columnTemplateDialogHtml(owner,mode)+trendDialogHtml(owner)+batchDialogHtml(owner)+'</div>';
    }

    function handleChange(event) {
      const target=event.target,field=target?.dataset?.businessField;
      const selected=view(),mode=workspace().mode;
      // 日报多店铺勾选：勾选/取消后立即按新的店铺集合重新统计。
      if(target?.dataset?.businessStoreScope!==undefined){
        if(event.type!=='change'||mode!=='daily')return true;
        const key=target.dataset.businessStoreScope,allIds=arr(state.stores).map(store=>store.id);
        let ids=isMergedScope(selected)?[...storeScopeIds(selected)]:[displayStoreId(selected)];
        if(key==='*')ids=target.checked?allIds:[displayStoreId(selected)];
        else if(target.checked){if(!ids.includes(key))ids.push(key);}
        else ids=ids.filter(id=>id!==key);
        // 只勾一家店 → 与点击上方店名一致，直接切到这家的单店日报。
        if(ids.length===1){void selectViewStore(state.storeId,'daily',ids[0]);return true;}
        if(!ids.length)ids=[displayStoreId(selected)];
        void applyStoreScope(state.storeId,'daily',ids);
        return true;
      }
      if(target?.dataset?.businessTrendValues!==undefined){
        const trend=workspace().trendDialog;
        if(trend&&event.type==='change'){trend.showValues=target.checked===true;host.render();}
        return true;
      }
      if(target?.dataset?.businessBatchField!==undefined){
        const dialog=workspace().batchDialog,key=target.dataset.businessBatchField;
        if(dialog&&!workspace().batchBusy.has(dialog.mode)&&['month','start','end'].includes(key)){
          dialog[key]=target.value;dialog.error='';
            if(key==='month'&&event.type==='change'){try{Object.assign(dialog,dates.monthRange(target.value),{preset:'month',dateMode:'month'});}catch(error){dialog.error=error.message;}}
            else if(key!=='month'){dialog.preset='custom';dialog.dateMode='custom';}
          host.render();
        }
        return true;
      }
      if(target?.dataset?.businessBatchSource!==undefined){
        const dialog=workspace().batchDialog;
        if(dialog&&!workspace().batchBusy.has(dialog.mode)&&event.type==='change'){
          if(target.checked)dialog.sources.add(target.dataset.businessBatchSource);
          else dialog.sources.delete(target.dataset.businessBatchSource);
          dialog.error='';host.render();
        }
        return true;
      }
      if(target?.dataset?.businessBatchStore!==undefined){
        if(event.type==='change'){
          const key=target.dataset.businessBatchStore,owner=workspace();
          if(target.checked)owner.batchStores.add(key);else owner.batchStores.delete(key);
          host.render();
        }
        return true;
      }
      if(target?.dataset?.businessManualField){
        const owner=workspace(),key=target.dataset.businessManualField;
        if(owner.manualDialog&&!owner.manualDialog.saving&&['amount','reason'].includes(key))owner.manualDialog[key]=target.value;
        return true;
      }
      if(target?.dataset?.businessFee){
        const owner=workspace(),key=target.dataset.businessFee;
        if(owner.feeDialog&&!owner.feeDialog.saving&&window.XXBusinessFeeSettings.KEYS.includes(key))owner.feeDialog.value[key]=target.value;
        return true;
      }
      // 精细化勾选：本页全选与单个商品勾选，用于批量加待办/调黑名单。
      if(target?.dataset?.businessSelectAll!==undefined){
        if(event.type==='change'){const rows=arr(selected.data?.rows);for(const row of rows){if(target.checked)selected.selectedIds.add(row.productId);else selected.selectedIds.delete(row.productId);}host.render();}
        return true;
      }
      if(target?.dataset?.businessSelect!==undefined){
        if(event.type==='change'){const id=target.dataset.businessSelect;if(target.checked)selected.selectedIds.add(id);else selected.selectedIds.delete(id);host.render();}
        return true;
      }
      if(target?.dataset?.businessMark==='content'){
        const owner=workspace();if(owner.markDialog&&!owner.markDialog.saving)owner.markDialog.content=target.value;
        return true;
      }
      if(target?.dataset?.businessTemplateChoice){
        const dialog=workspace().columnTemplate;
        if(dialog&&!dialog.saving){dialog.choice=target.value;dialog.error='';host.render();}
        return true;
      }
      if(target?.dataset?.businessTemplateName){
        const dialog=workspace().columnTemplate;if(dialog&&!dialog.saving)dialog.name=target.value;
        return true;
      }
      if(target?.dataset?.businessTemplateTarget){
        const dialog=workspace().columnTemplate;if(dialog&&!dialog.saving)dialog.target=target.value;
        return true;
      }
      if(target?.name==='business-mark-remove'){
        const owner=workspace();if(owner.markDialog&&!owner.markDialog.saving)owner.markDialog.remove=target.value==='yes';
        return true;
      }
      if(target?.dataset?.businessColumn){
        const key=target.dataset.businessColumn;
        if(event.type==='change'&&key!==(mode==='daily'?'date':'storeName')&&definitions.groups(mode).some(group=>group.columns.some(([name])=>name===key))){
          if(target.checked)selected.hiddenColumns.delete(key);else selected.hiddenColumns.add(key);
          rememberColumns(state.storeId,mode,selected);
          host.render();
          if(typeof document!=='undefined'){
            document.querySelector('.business-column-picker')?.setAttribute('open','');
            document.querySelector(`[data-business-column="${key}"]`)?.focus();
          }
        }
        return true;
      }
      if(target?.dataset?.businessSource){
        const id=target.dataset.businessSource,dialog=selected.syncDialog;
        if(dialog&&!selected.syncing&&syncSources(selected).some(item=>item.id===id&&item.sync)){
          if(target.checked)dialog.sources.add(id);else dialog.sources.delete(id);
          if(event.type==='change')host.render();
        }
        return true;
      }
      if(target?.dataset?.businessSyncField){
        const key=target.dataset.businessSyncField,dialog=selected.syncDialog;
        if(!dialog||selected.syncing||!['month','start','end'].includes(key))return true;
        dialog[key]=target.value;dialog.error='';
        try{
          if(key==='month'&&event.type==='change')Object.assign(dialog,dates.monthRange(target.value),{dateMode:'month',preset:'month'});
          else if(key!=='month'){dialog.dateMode='custom';dialog.preset='custom';}
        }catch(error){dialog.error=error.message;}
        if(event.type==='change')host.render();return true;
      }
      if(field==='storeId'){
        // 精细化页签的“选择店铺”：只切这个页签显示的店铺，不影响日报，也不切换工作台的当前店铺。
        if(event.type==='change'&&arr(state.stores).some(store=>store.id===target.value))void selectViewStore(state.storeId,workspace().mode,target.value);
        return true;
      }
      if (!['start','end','month',...filters.fields].includes(field)) return false;
      selected.draft[field]=target.value;
      if(field==='start'||field==='end')selected.draft.dateMode='custom';
      if(field==='month'&&event.type==='change'){
        try{Object.assign(selected.draft,dates.monthRange(target.value),{dateMode:'month'});selected.error='';host.render();}
        catch(error){fail(selected,error,state.storeId,workspace().mode);}
      }
      if (field === 'pageSize' && event.type === 'change' && [20,50,100].includes(Number(target.value))) {
        selected.applied={...selected.applied,pageSize:Number(target.value),page:1};selected.data=null;
        void load();
      }
      patchDraftState(selected,workspace().mode);
      return true;
    }
    async function handleAction(action,element) {
      if (!action.startsWith('business:')) return false;
      const storeId=state.storeId, owner=workspace(storeId), mode=owner.mode, selected=view(storeId,mode), operation=action.slice(9);
      if (!storeId) {host.toast('请先添加并选择店铺。',true);return true;}
      // 这个页签当前显示的店铺：同步、扣费、待办、手工金额都以它为准（日报/精细化各用各的）。
      const viewStore=displayStoreId(selected);
      if (operation === 'mode') {
        const next=element?.dataset?.mode;if (!modes[next]) return true;
        if(!canView(next)){host.toast('当前账号没有查看该经营数据页签的权限',true);return true;}
        selected.syncDialog=null;owner.feeDialog=null;owner.manualDialog=null;owner.feeSequence++;owner.mode=next;host.render();await load({storeId,mode:next});return true;
      }
      if (operation === 'store-scope-all') {
        // “全部店铺”按钮：再点一次回到只看当前页签选中的店铺。
        const allIds=arr(state.stores).map(store=>store.id);
        if(allIds.length<2){host.toast('只有一家店铺，无需合并统计。');return true;}
        const merged=isMergedScope(selected)&&storeScopeIds(selected).length>=allIds.length;
        await applyStoreScope(storeId,'daily',merged?[displayStoreId(selected)]:allIds);
        return true;
      }
      if (operation === 'store-scope-current') {await applyStoreScope(storeId,'daily',[displayStoreId(selected)]);return true;}
      if (operation === 'store-single') {
        // 点击上方店名：这个页签只看这家店（不改动另一个页签，也不切换工作台当前店铺）。
        await selectViewStore(storeId,mode,element?.dataset?.id||'');
        return true;
      }
      try {
        if(operation==='todo-open'){
          const id=element?.dataset?.productId,row=arr(selected.data?.rows).find(item=>item.productId===id);
          owner.feeDialog=null;owner.manualDialog=null;
          owner.markDialog={kind:'todo',productIds:[id],content:'',entries:(row?.todoList||[]).slice(),error:'',saving:false};
          host.render();
        }else if(operation==='todo-batch'||operation==='blacklist-batch'){
          const ids=[...selected.selectedIds];
          if(!ids.length){host.toast('请先勾选商品，再批量添加待办或调整黑名单。',true);return true;}
          owner.markDialog={kind:operation==='todo-batch'?'todo':'blacklist',productIds:ids,content:'',entries:[],remove:false,error:'',saving:false};
          host.render();
        }else if(operation==='mark-close'){
          if(!owner.markDialog?.saving){owner.markDialog=null;host.render();}
        }else if(operation==='mark-delete-todo'){
          const dialog=owner.markDialog,todoId=element?.dataset?.todoId;
          if(!dialog||!todoId)return true;
          try{
            await api('business.unmarkTodo',{storeId:viewStore,productId:dialog.productIds[0],todoId});
            dialog.entries=(dialog.entries||[]).filter(item=>item.id!==todoId);
            await load({storeId,mode});
          }catch(error){dialog.error=error?.message||String(error);}
          host.render();
        }else if(operation==='mark-save'){
          const dialog=owner.markDialog;if(!dialog||dialog.saving)return true;
          try{
            dialog.saving=true;dialog.error='';host.render();
            if(dialog.kind==='todo'){
              const content=String(dialog.content||'').trim();
              if(!content)throw new Error('请填写待办内容');
              await api('business.markTodo',{storeId:viewStore,productIds:dialog.productIds,content});
            }else await api('business.markBlacklist',{storeId:viewStore,productIds:dialog.productIds,remove:dialog.remove===true});
            owner.markDialog=null;selected.selectedIds.clear();
            host.toast(dialog.kind==='todo'?'待办已保存。':'黑名单已更新。');
            await load({storeId,mode});
          }catch(error){dialog.error=error?.message||String(error);}
          finally{if(owner.markDialog===dialog)dialog.saving=false;redraw(storeId,mode);}
        }else
        if(operation==='manual-open'){
          const field=element?.dataset?.field,date=element?.dataset?.date;
          if(mode!=='daily'||!window.XXBusinessManual.labels[field]||typeof date!=='string')return true;
          const row=arr(selected.data?.rows).find(item=>item.date===date);if(!row)return true;
          const hasValue=typeof row[field]==='number';owner.feeDialog=null;selected.syncDialog=null;
          owner.manualDialog={date,field,amount:hasValue?String(row[field]):'',reason:'',entry:hasValue?{amount:row[field],reason:row[`${field}Reason`]||''}:null,saving:false,error:''};
          host.render();if(typeof document!=='undefined')document.querySelector('.business-manual-dialog')?.focus();
        }else if(operation==='manual-close'){
          if(!owner.manualDialog?.saving){owner.manualDialog=null;host.render();}
        }else if(operation==='manual-save'||operation==='manual-exclude'){
          const dialog=owner.manualDialog;if(!dialog||dialog.saving)return true;
          try{
            const values=window.XXBusinessManual.payload(dialog);if(!values.reason.trim())throw new Error('请填写本次原因');
            if(operation==='manual-save'&&values.amount==='')throw new Error('请填写金额');
            dialog.saving=true;dialog.error='';host.render();
            await api(operation==='manual-save'?'business.manualSave':'business.manualExclude',{storeId:viewStore,date:dialog.date,field:dialog.field,...values});
            if(owner.manualDialog===dialog){owner.manualDialog=null;selected.data=null;host.toast(operation==='manual-save'?'已保存当日手工金额。':'已剔除当日手工金额，原因已留档。');await load({storeId,mode});}
          }catch(error){dialog.error=error?.message||'手工金额未保存';}finally{dialog.saving=false;redraw(storeId,mode);}
        }else if(operation==='fees'){
          const sequence=++owner.feeSequence,value=await api('business.feesLoad',{storeId:viewStore});
          if(sequence===owner.feeSequence&&current(storeId,mode)){selected.syncDialog=null;owner.feeDialog={value,error:'',saving:false};host.render();document.querySelector('.business-fee-dialog')?.focus();}
        }else if(operation==='fees-close'){
          if(!owner.feeDialog?.saving){owner.feeDialog=null;owner.feeSequence++;host.render();}
        }else if(operation==='fees-save'){
          const dialog=owner.feeDialog;if(!dialog||dialog.saving)return true;
          try{
            const rates=window.XXBusinessFeeSettings.payload(document.querySelector('.business-fee-dialog'));
            dialog.value={...dialog.value,...rates};dialog.saving=true;dialog.error='';host.render();
            await api('business.feesSave',{storeId:viewStore,rates});
            if(owner.feeDialog===dialog){owner.feeDialog=null;host.toast('已保存扣费设置；日报与精细化按已确认公式计算。');}
          }catch(error){dialog.error=error?.message||'费率未保存';}finally{dialog.saving=false;redraw(storeId,mode);}
        }else if (operation === 'query') {selected.applied=queryDraft(selected,mode);selected.data=null;await load({storeId,mode});}
        else if(operation==='query-preset'){
          Object.assign(selected.draft,dates.preset(element?.dataset?.value));selected.applied=queryDraft(selected,mode);selected.data=null;await load({storeId,mode});
        }else if(operation==='refresh'){await load({storeId,mode});}
        else if(operation==='catalog-sync'){
          if(selected.syncing)return true;
          selected.syncing=true;selected.error='';selected.progress={status:'running',message:'正在读取天猫“我的商品”列表…'};redraw(storeId,mode);
          try {
            const result=await api('business.catalogSync',{storeId:viewStore,mode});
            if(current(storeId,mode)&&result)host.toast(`商品资料已更新：共 ${result.totalCount} 件商品${result.statuses?`（已登录 ${result.statuses['出售中']||0} / 仓库中 ${result.statuses['仓库中']||0}）`:''}`);
          } catch(error) {selected.error=error.message || String(error);selected.progress={status:'failed',message:selected.error};}
          finally {selected.syncing=false;const error=selected.error;await load({storeId,mode});if(error)selected.error=error;redraw(storeId,mode);}
        }
        else if(operation==='columns-reset'){selected.hiddenColumns.clear();rememberColumns(storeId,mode,selected);host.render();}
        else if(operation==='column-template-open'){
          const templates=Object.keys(workspace(storeId).uiState?.templates?.[mode]||{});
          owner.columnTemplate={kind:'save',choice:templates.length?'overwrite':'new',target:templates[0]||'',name:'',error:'',saving:false};
          host.render();
        }
        else if(operation==='column-template-rename'){
          const name=String(element?.dataset?.name||'').trim();
          if(!name)return true;
          owner.columnTemplate={kind:'rename',choice:'new',target:name,name,error:'',saving:false};
          host.render();
        }
        else if(operation==='column-template-close'){
          owner.columnTemplate=null;host.render();
        }
        else if(operation==='column-template-confirm'){
          const dialog=owner.columnTemplate;if(!dialog)return true;
          const owner2=workspace(storeId);owner2.uiState=owner2.uiState||{};owner2.uiState.templates=owner2.uiState.templates||{};
          const templates=owner2.uiState.templates[mode]=owner2.uiState.templates[mode]||{};
          const read=selector=>typeof document!=='undefined'?document.querySelector(selector):null;
          const rename=dialog.kind==='rename';
          const choice=rename?'new':String(read('[data-business-template-choice]:checked')?.value||dialog.choice||'overwrite');
          const typed=String(read('[data-business-template-name]')?.value||dialog.name||'').trim();
          const target=String(read('[data-business-template-target]')?.value||dialog.target||'').trim();
          const key=rename||choice==='new'?typed:target;
          if(!key){dialog.error=rename||choice==='new'?'请填写模板名称。':'请选择要覆盖的模板。';host.render();return true;}
          if((rename||choice==='new')&&key.length>20){dialog.error='模板名称最多 20 个字。';host.render();return true;}
          if((rename||choice==='new')&&key!==dialog.target&&Object.hasOwn(templates,key)){dialog.error='已经有同名模板，请换一个名字。';host.render();return true;}
          const values=rename&&dialog.target&&Array.isArray(templates[dialog.target])?templates[dialog.target]:Array.from(selected.hiddenColumns);
          if(rename&&dialog.target&&dialog.target!==key)delete templates[dialog.target];
          templates[key]=values;owner.columnTemplate=null;selected.templateName=key;
          rememberColumns(storeId,mode,selected);
          host.toast((rename?'已重命名列模板“':'已保存列模板“')+key+'”');host.render();
        }
        else if(operation==='column-template-apply'){
          const name=String(element?.dataset?.name||'').trim();
          const saved=workspace(storeId).uiState?.templates?.[mode]?.[name];
          if(!name||!Array.isArray(saved)){host.toast('模板不存在或已删除。',true);return true;}
          selected.hiddenColumns=new Set(saved);selected.templateName=name;rememberColumns(storeId,mode,selected);
          host.toast('已应用列模板“'+name+'”');host.render();
        }
        else if(operation==='column-template-delete'){
          const name=String(element?.dataset?.name||'').trim();
          const owner2=workspace(storeId),saved=owner2.uiState?.templates?.[mode];
          if(!name||!saved||!Object.hasOwn(saved,name)){host.toast('模板不存在或已删除。',true);return true;}
          delete saved[name];if(selected.templateName===name)selected.templateName='';rememberColumns(storeId,mode,selected);host.toast('已删除列模板“'+name+'”');host.render();
        }
        else if(operation==='reset'){
          selected.draft={...dates.initial(mode),...filters.defaults(mode)};selected.applied=queryDraft(selected,mode);selected.data=null;await load({storeId,mode});
        }else if(operation==='date-mode'){
          if(mode!=='daily'||!['month','custom'].includes(element?.dataset?.value))return true;
          selected.draft.dateMode=element.dataset.value;
          if(selected.draft.dateMode==='month')Object.assign(selected.draft,dates.monthRange(selected.draft.month));
          host.render();
        }else if(operation==='month-previous'||operation==='month-next'){
          if(mode!=='daily')return true;
          const month=dates.shiftMonth(selected.draft.month,operation==='month-next'?1:-1),range=dates.monthRange(month);
          Object.assign(selected.draft,range,{month,dateMode:'month'});selected.applied=queryDraft(selected,mode);selected.data=null;await load({storeId,mode});
        }else if(operation==='sort'){
          const column=element?.dataset?.column;if(!definitions.groups(mode).some(group=>group.columns.some(([key])=>key===column)))return true;
          const direction=selected.applied.sortBy===column&&selected.applied.sortDirection==='asc'?'desc':'asc';
          Object.assign(selected.draft,{sortBy:column,sortDirection:direction});selected.applied={...selected.applied,sortBy:column,sortDirection:direction,page:1};selected.data=null;await load({storeId,mode});
        }
        else if (operation === 'goto') {
          if (selected.loading) return true;
          const total=Number(selected.data?.total) || 0,size=Number(selected.data?.pageSize) || selected.applied.pageSize;
          const pages=Math.max(1,Math.ceil(total/size));
          const input=typeof document==='undefined'?null:document.querySelector('#business-goto');
          const target=Math.trunc(Number(input?.value ?? element?.dataset?.page));
          if(!Number.isFinite(target)||target<1||target>pages){host.toast(`请输入 1 到 ${pages} 之间的页码。`,true);if(input)input.value=String(Number(selected.data?.page)||1);return true;}
          selected.applied.page=target;selected.data=null;await load({storeId,mode});
        } else if (operation === 'previous' || operation === 'next') {
          if (selected.loading) return true;
          const total=Number(selected.data?.total) || 0,size=Number(selected.data?.pageSize) || selected.applied.pageSize;
          const page=Number(selected.data?.page) || selected.applied.page;
          selected.applied.page=Math.min(Math.max(1,Math.ceil(total/size)),Math.max(1,page+(operation==='next'?1:-1)));
          selected.data=null;await load({storeId,mode});
        } else if (operation === 'open') {
          const backend=element?.dataset?.backend;if (!['sycm','promotion'].includes(backend)) return true;
          await (host.openBackend || (payload=>api('business.open',payload)))({storeId:viewStore,mode,backend});
        } else if(operation==='sync-close'){
          selected.syncDialog=null;host.render();
        } else if(operation==='sync-preset'){
          if(!selected.syncDialog||selected.syncing)return true;
          const value=element?.dataset?.value;
          if(value==='custom')Object.assign(selected.syncDialog,{dateMode:'custom',preset:'custom',error:''});
          else Object.assign(selected.syncDialog,dates.preset(value),{error:''});
          host.render();
        } else if (operation === 'sync') {
          openSyncDialog(storeId,mode);
        } else if(operation==='sync-start'){
          const dialog=selected.syncDialog;if(!dialog)return true;
          // 需求5（本轮）：只拦“同一家店、同一个页签”的重复同步；日报和精细化可以同时跑。
          if (selected.syncing||running(selected.progress||selected.data?.sync)) return true;
          const sources=syncSources(selected).filter(item=>item.sync&&dialog.sources.has(item.id)).map(item=>item.id);
          if(!sources.length){dialog.error='请选择至少一个已接入的同步来源。';host.render();return true;}
          let syncRange;
          try{syncRange=dates.syncRange(dialog,mode);dialog.error='';}
          catch(error){dialog.error=error.message;host.render();return true;}
          selected.lastSyncDraft={...dialog,sources:[...sources]};
          selected.syncDialog=null;
          // Sync takes only dates. Unsubmitted title/ID/category drafts never
          // become a remote filter or silently replace the applied local query.
          selected.applied={...selected.applied,...syncRange,page:1};Object.assign(selected.draft,syncRange,{dateMode:'custom'});selected.syncing=true;selected.error='';selected.validationPrompt=false;selected.validationSource='';selected.progress={status:'running',message:'正在准备整店同步…'};redraw(storeId,mode);
          try {
            const result=await api('business.sync',{storeId:viewStore,mode,...syncRange,sources});
            if (result?.sync) selected.progress=result.sync;
          } catch(error) {selected.error=error.message || String(error);dialog.error=selected.error;selected.progress={status:'failed',message:selected.error};selected.validationPrompt=needsValidation(selected.error);}
          finally {selected.syncing=false;selected.cancelling=false;const error=selected.error;await load({storeId,mode});if (error) {selected.error=error;redraw(storeId,mode);}}
        } else if (operation === 'cancel') {
          if (selected.cancelling || !(selected.syncing || running(selected.progress || selected.data?.sync))) return true;
          selected.cancelling=true;redraw(storeId,mode);
          let result=null;
          try {result=await api('business.cancel',{storeId:viewStore,mode});}
          catch(error){selected.cancelling=false;host.toast(String(error?.message||error),true);redraw(storeId,mode);return true;}
          if(result?.tooLate){selected.cancelling=false;host.toast(result.message||'数据已进入保存阶段，完成后生效。');redraw(storeId,mode);return true;}
          if(result&&result.canceled===false){
            // 后台已经没有这次任务时，界面不能一直停在“同步中/正在取消”。
            selected.cancelling=false;selected.syncing=false;
            selected.progress={status:'canceled',message:result.message||'当前没有正在执行的同步任务，已结束等待',done:true};
            host.toast(selected.progress.message);
            await load({storeId,mode});
            return true;
          }
          // 取消已受理：保持“正在取消…”，等后台结束事件把界面解锁（后台另有兜底超时）。
        } else if (operation === 'open-validation') {
          redraw(storeId,mode);
          let tabId=selected.validationTabId||'';
          if(!tabId&&selected.validationSource){
            try{const target=await api('business.revealSync',{storeId:viewStore,sourceId:selected.validationSource,mode});tabId=target&&target.tabId||'';}catch{}
          }
          if(host.showValidationTab)await host.showValidationTab({storeId:viewStore,tabId,sourceId:selected.validationSource||''});
          else if(host.focusStoreBrowser)await host.focusStoreBrowser({storeId:viewStore,mode});
          else host.toast('请到“店铺浏览器”里完成滑块后回到本页继续。',true);
          selected.validationPrompt=false;
        } else if (operation === 'validation-retry') {
          const stillRunning=selected.syncing||running(selected.progress||selected.data?.sync);
          if(stillRunning){
            try{await api('business.validationRetry',{storeId:viewStore});host.toast('已请求立即继续；如果平台仍要求验证，会继续等待。');}
            catch(error){host.toast(String(error?.message||error),true);}
          }else{
            const draft=selected.lastSyncDraft;
            // 点“我已划完，立即继续”：先把显示出来的同步页面收回去，再从断点续传。
            if(selected.validationSource)void api('business.hideSyncPage',{storeId:viewStore,sourceId:selected.validationSource,mode}).catch(function(){});
            if(!draft||!draft.start||!draft.end||!arr(draft.sources).length){host.toast('没有可续传的同步记录，请点“同步整店数据”。',true);}
            else{
              selected.validationPrompt=false;selected.validationSource='';selected.syncing=true;selected.error='';selected.progress={status:'running',message:'正在从断点继续同步…'};
              selected.applied={...selected.applied,start:draft.start,end:draft.end,page:1};
              redraw(storeId,mode);
              try{const result=await api('business.sync',{storeId:viewStore,mode,start:draft.start,end:draft.end,sources:[...draft.sources]});if(result?.sync)selected.progress=result.sync;}
              catch(error){selected.error=error.message||String(error);selected.progress={status:'failed',message:selected.error};selected.validationPrompt=needsValidation(selected.error);}
              finally{selected.syncing=false;selected.cancelling=false;const error=selected.error;await load({storeId,mode});if(error){selected.error=error;redraw(storeId,mode);}}
            }
          }
        } else if (operation === 'sync-panel') {
          owner.syncPanel=!owner.syncPanel;host.render();
          // 打开面板时拉一次“上次同步结果”（成功/失败/取消），让每张店铺卡片都显示结果。
          if(owner.syncPanel)void refreshSyncResults();
        } else if (operation === 'batch-all') {
          for(const store of arr(state.stores))owner.batchStores.add(store.id);
          host.render();
        } else if (operation === 'batch-none') {
          owner.batchStores.clear();host.render();
        } else if (operation === 'sync-one') {
          // 点某家店的“同步日报/同步精细化”：立即切页签并弹出同步窗口，数据在后台补齐（需求6）。
          const id=String(element?.dataset?.id||''),want=String(element?.dataset?.mode||'daily');
          if(!['daily','product'].includes(want)||!arr(state.stores).some(store=>store.id===id))return true;
          if(!focusSyncTarget(storeId,id,want))return true;
          openSyncDialog(storeId,want);
          refreshSyncViewLater(storeId,want);
        } else if (operation === 'batch-open') {
          // 一键同步：先弹出“同步时间 + 同步内容”，确认后所有店铺按同一份选择并行同步。
          const want=String(element?.dataset?.mode||'daily');
          if(!['daily','product'].includes(want))return true;
          const picked=arr([...owner.batchStores]),targets=picked.length?picked:arr(state.stores).map(store=>store.id);
          if(!targets.length){host.toast('请先添加店铺。',true);return true;}
          owner.batchTargets=targets;
          // 需求（2026-10-13）：日报的一键同步也提供和精细化一样的日期快捷选择；默认同步“本月”。
          let range;
          try{range=want==='daily'?dates.preset('month'):dates.preset('week');}
          catch{range=want==='daily'?dates.preset('yesterday'):dates.preset('week');}
          owner.batchDialog={mode:want,start:range.start,end:range.end,month:range.month||range.start.slice(0,7),dateMode:range.dateMode||'custom',preset:range.preset||'custom',sources:new Set(syncSources(view()).filter(item=>item.sync&&!(want==='daily'&&item.id==='seller')).map(item=>item.id)),error:''};
          host.render();if(typeof document!=='undefined')document.querySelector('.business-sync-dialog')?.focus();
        } else if (operation === 'batch-close') {
          // 提交中也可以先收起窗口（同步在后台继续）。
          owner.batchDialog=null;host.render();
        } else if (operation === 'batch-preset') {
          const dialog=owner.batchDialog,value=element?.dataset?.value;
          if(!dialog||dialog.sources.size===0&&false)return true;
          if(dialog&&value==='custom')Object.assign(dialog,{preset:'custom'});
          else if(dialog){Object.assign(dialog,dates.preset(value),{preset:value});}
          host.render();
        } else if (operation === 'batch-start') {
          // 日报与精细化的“一键同步”可以各自提交、互不阻塞（用户要求两者能同时进行）。
          const dialog=owner.batchDialog;if(!dialog||owner.batchBusy.has(dialog.mode))return true;
          const want=dialog.mode,targets=arr(owner.batchTargets);
          const sources=[...dialog.sources].filter(id=>syncSources(view()).some(item=>item.id===id&&item.sync));
          if(!sources.length){dialog.error='请选择至少一个已接入的同步来源。';host.render();return true;}
          let range;
          try{range=dates.syncRange({dateMode:dialog.dateMode||'custom',start:dialog.start,end:dialog.end,...(want==='daily'?{month:dialog.month}:{})},want);dialog.error='';}
          catch(error){dialog.error=error.message;host.render();return true;}
          // 先收起选择窗口再提交：避免出现“正在提交…”又关不掉的窗口；进度统一在“数据同步”面板看。
          // 需求3（本轮）：同时切到这次一键同步的页签，卡片上的进度和“取消/查看”就出现在对应页签里。
          owner.mode=want;
          owner.batchBusy.add(want);owner.batchDialog=null;host.render();
          const results=await Promise.allSettled(targets.map(id=>api('business.sync',{storeId:id,mode:want,start:range.start,end:range.end,sources})));
          owner.batchBusy.delete(want);host.render();
          const failed=results.filter(item=>item.status==='rejected').length;
          // business.sync 会等到整轮同步结束才返回：这里的 rejected 是“同步失败”，不是“提交失败”。
          host.toast(failed
            ?`已同时提交 ${targets.length} 家店铺的${modes[want]}同步：完成 ${targets.length-failed} 家、失败 ${failed} 家，失败原因见店铺卡片与进度`
            :`已同时提交 ${targets.length} 家店铺的${modes[want]}同步，进度显示在“数据同步”面板`);
          await load({storeId,mode:workspace(storeId).mode});
        } else if (operation === 'sync-view') {
          // 一键同步开始后：查看某家店的日报/精细化同步进度——立即切页签并打开同步窗口（收起后还能再次打开）。
          const id=String(element?.dataset?.id||''),want=String(element?.dataset?.mode||'daily');
          if(!['daily','product'].includes(want)||!arr(state.stores).some(store=>store.id===id))return true;
          const target=focusSyncTarget(storeId,id,want);if(!target)return true;
          const active=runningSyncFor(id,want);if(active)target.progress={...active};
          openSyncDialog(storeId,want);
          refreshSyncViewLater(storeId,want);
          return true;
        } else if (operation === 'sync-cancel-one') {
          const id=String(element?.dataset?.id||''),want=String(element?.dataset?.mode||'daily');
          try{const result=await api('business.cancel',{storeId:id,mode:want});host.toast(result?.message||'已请求取消同步');}
          catch(error){host.toast(String(error?.message||error),true);}
          await load({storeId,mode:workspace(storeId).mode});
        } else if (operation === 'trend') {
          // 需求9：点击某个指标单元格 → 读本机已保存数据画每日趋势。
          const key=String(element?.dataset?.column||''),product=String(element?.dataset?.product||'');
          if(!key)return true;
          owner.trendDialog={key,product,label:key,type:'number',points:[],sum:null,count:0,totalDays:0,loading:true,error:'',granularity:'day',showValues:false};
          host.render();
          try{
            const data=await api('business.trend',{storeId:viewStore,mode,start:selected.applied.start,end:selected.applied.end,productId:product,key});
            if(owner.trendDialog===undefined||!owner.trendDialog)return true;
            owner.trendDialog={...owner.trendDialog,...(data||{}),loading:false,error:''};
          }catch(error){if(owner.trendDialog){owner.trendDialog.loading=false;owner.trendDialog.error=error?.message||String(error);}}
          redraw(storeId,mode);
        } else if (operation === 'trend-unit') {
          const trend=owner.trendDialog,value=String(element?.dataset?.value||'day');
          if(trend&&['day','week','month'].includes(value)){trend.granularity=value;host.render();}
        } else if (operation === 'trend-close') {
          owner.trendDialog=null;host.render();
        } else if (operation === 'dismiss-validation') {
          selected.validationPrompt=false;host.render();
        } else if (operation === 'export') {
          if(dirtyFilters(selected,mode)){host.toast('筛选条件已修改，请先点击“搜索”再导出。',true);patchDraftState(selected,mode);return true;}
          if (selected.exporting || selected.loading || !selected.data || !(Number(selected.data.total)>0 || arr(selected.data.rows).length)) return true;
          selected.exporting=true;redraw(storeId,mode);
          try {const result=await api('business.export',payload(storeId,mode,selected));if (!result?.canceled && current(storeId,mode)) host.toast('经营数据已导出。');}
          finally {selected.exporting=false;redraw(storeId,mode);}
        } else return false;
      } catch(error) {fail(selected,error,storeId,mode);}
      return true;
    }
    if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('keydown',event=>{
      if(state.page!=='business')return;
      if(event.key==='Enter'&&event.target?.id==='business-goto'){event.preventDefault();void handleAction('business:goto',{dataset:{}});return;}
      const owner=workspace(),manualDialog=owner.manualDialog,feeDialog=owner.feeDialog,syncDialog=view().syncDialog;
      if(!manualDialog&&!feeDialog&&!syncDialog)return;
      if(event.key==='Escape'){
        if(manualDialog&&!manualDialog.saving){event.preventDefault();owner.manualDialog=null;host.render();return;}
        if(feeDialog&&!feeDialog.saving){event.preventDefault();owner.feeDialog=null;host.render();return;}
        if(syncDialog){event.preventDefault();view().syncDialog=null;host.render();return;}
      }
      if(event.key!=='Tab')return;
      const dialog=document.querySelector(manualDialog?'.business-manual-dialog':feeDialog?'.business-fee-dialog':'.business-sync-dialog'),nodes=dialog?[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')]:[];
      if(!nodes.length)return;
      const first=nodes[0],last=nodes.at(-1);
      if(!dialog.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();}
      else if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    });
    function leave(){for(const owner of stores.values()){owner.feeDialog=null;owner.manualDialog=null;owner.feeSequence++;for(const selected of owner.views.values())selected.syncDialog=null;}}
    async function showProgress(mode){if(!modes[mode])return;leave();workspace().mode=mode;await load({mode});await handleAction('business:sync',{});}
    // 顶部“当前店铺”切换时调用：这家店工作区里的两个页签都回到这家店，
    // 免得出现“顶部是甲店、页签还在看乙店”的错位。
    function followStore(storeId){
      if(!storeId)return;
      const owner=workspace(storeId);
      owner.storeId=storeId;
      for(const selected of owner.views.values()){selected.storeId=storeId;selected.storeIds=null;}
    }
    return {render,load,handleAction,handleChange,handleProgress,leave,showProgress,afterRender:applyColumnWidths,followStore};
  }
  window.XXBusiness=Object.freeze({create});
})();
