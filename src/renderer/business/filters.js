'use strict';

(() => {
  // 精细化首次打开固定按“支付买家数”降序；排序、搜索、筛选都先作用于全部符合
  // 条件的数据，再由服务端分页。日报保持按日期升序。
  // 精细化默认只看“出售中”（用户要求），需要时可在下拉里切回全部或仓库中。
  const defaults=mode=>({query:'',title:'',productIds:'',category:'',itemStatus:mode==='product'?'出售中':'',blacklist:'',todoStatus:'',creationStart:'',creationEnd:'',sortBy:mode==='product'?'buyers':'date',sortDirection:mode==='product'?'desc':'asc',page:1,pageSize:20});
  function payload(draft,mode){
    const common={query:mode==='product'?String(draft.query||'').trim().slice(0,300):'',sortBy:draft.sortBy||defaults(mode).sortBy,sortDirection:draft.sortDirection||defaults(mode).sortDirection,page:1,pageSize:[20,50,100].includes(Number(draft.pageSize))?Number(draft.pageSize):20};
    if(mode==='product'){
      Object.assign(common,{title:String(draft.title||'').trim().slice(0,600),productIds:String(draft.productIds||'').trim(),category:String(draft.category||'').trim().slice(0,300),itemStatus:String(draft.itemStatus||'').trim().slice(0,40),blacklist:['yes','no'].includes(draft.blacklist)?draft.blacklist:'',todoStatus:['has','none'].includes(draft.todoStatus)?draft.todoStatus:''});
      if(draft.creationStart)common.creationStart=String(draft.creationStart);
      if(draft.creationEnd)common.creationEnd=String(draft.creationEnd);
    }
    return common;
  }
  function unavailable(label,extra='未配置'){
    return `<div class="field business-unavailable"><label>${label}</label><select disabled aria-label="${label}（${extra}）" title="${extra}，暂不参与筛选"><option>${extra}</option></select></div>`;
  }
  function render(draft,{esc,storePicker='',datePicker=''}){
    return `<div class="business-product-filters">${datePicker}${storePicker}${unavailable('选择团队')}${unavailable('选择人员')}<div class="field"><label for="business-item-status">商品状态</label><select id="business-item-status" data-business-field="itemStatus"><option value=""${draft.itemStatus?'':' selected'}>全部状态</option><option value="出售中"${draft.itemStatus==='出售中'?' selected':''}>出售中</option><option value="仓库中"${draft.itemStatus==='仓库中'?' selected':''}>仓库中</option></select></div><div class="field"><label for="business-blacklist">黑名单</label><select id="business-blacklist" data-business-field="blacklist"><option value=""${draft.blacklist?'':' selected'}>全部</option><option value="yes"${draft.blacklist==='yes'?' selected':''}>仅黑名单</option><option value="no"${draft.blacklist==='no'?' selected':''}>排除黑名单</option></select></div>${unavailable('标记来源')}<div class="field"><label for="business-todo-status">待办状态</label><select id="business-todo-status" data-business-field="todoStatus"><option value=""${draft.todoStatus?'':' selected'}>全部</option><option value="has"${draft.todoStatus==='has'?' selected':''}>有待办</option><option value="none"${draft.todoStatus==='none'?' selected':''}>无待办</option></select></div><div class="field business-created-range"><label>上架时间</label><div class="business-range-inputs"><input type="date" data-business-field="creationStart" aria-label="商品上架开始日期" value="${esc(draft.creationStart||'')}"><span>至</span><input type="date" data-business-field="creationEnd" aria-label="商品上架结束日期" value="${esc(draft.creationEnd||'')}"></div></div><div class="field business-id-filter"><label for="business-ids">商品 ID</label><textarea id="business-ids" data-business-field="productIds" rows="1" maxlength="260000" placeholder="商品 ID，换行分隔">${esc(draft.productIds||'')}</textarea></div><div class="field"><label for="business-title">商品标题</label><input type="search" id="business-title" data-business-field="title" value="${esc(draft.title||'')}" maxlength="600" placeholder="模糊查询"></div><div class="field"><label for="business-category">类目</label><input type="search" id="business-category" data-business-field="category" value="${esc(draft.category||'')}" maxlength="300" placeholder="按已有类目筛选"></div></div>`;
  }
  const fields=new Set(['query','title','productIds','category','itemStatus','blacklist','todoStatus','creationStart','creationEnd','pageSize']);
  window.XXBusinessFilters=Object.freeze({defaults,payload,render,unavailable,fields});
})();
