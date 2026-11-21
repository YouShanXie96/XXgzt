'use strict';

// Navigation hierarchy is separate from page modules and their data/cache IDs.
(() => {
  const selectionPages=[
    {id:'trends',label:'趋势关键词',icon:'promotion'},
    {id:'peers',label:'同行榜单',icon:'store'},
    {id:'recommendations',label:'月份推荐',icon:'clock'},
  ];
  // “营销创建”的子功能：内购会 / 托管礼金。它们不单独出现在侧边栏，只在顶栏切换。
  const modulePages=[
    {id:'purchase',label:'内购会',icon:'purchase'},
    {id:'hostedgift',label:'托管礼金',icon:'gift'},
    {id:'complaint',label:'投诉打标',icon:'complaint'},
  ];
  const items=[
    {id:'accounts',label:'店铺登录',icon:'store'},
    {id:'browser',label:'店铺浏览器',icon:'home'},
    {id:'business',label:'经营数据',icon:'home'},
    {id:'selection',label:'选品',icon:'folder',children:selectionPages},
    // 上品库：独立顶级功能区（从老软件移植）。刻意不放进 selectionPages ——
    // 否则 wrap() 会套「选品」二级 tab、breadcrumb() 会多插一层，用户明确要求不带面包屑。
    {id:'selectionpool',label:'上品库',icon:'folder'},
    {id:'reviews',label:'评价晒图',icon:'review'},
    {id:'promotion',label:'自动推广',icon:'promotion'},
    {id:'marketing',label:'营销创建',icon:'purchase'},
    {id:'compliance',label:'违规排查',icon:'compliance'},
    {id:'ai',label:'AI 助手',icon:'ai',reserved:true},
  ];
  // 底部图标区：插件、更新与设置不占主导航列表，固定放在账号头像上方。
  const utilityPages=[
    {id:'plugin',label:'AI作图插件',icon:'plugin'},
    {id:'update',label:'软件更新',icon:'update'},
    {id:'settings',label:'设置',icon:'settings'},
  ];
  const pages=new Map([...items.flatMap(item=>item.children||[item]),...modulePages,...utilityPages,{id:'cloudaccount',label:'账号与安全',icon:'users'}].map(item=>[item.id,item]));
  const isSelection=page=>selectionPages.some(item=>item.id===page);
  const isMarketing=page=>page==='purchase'||page==='hostedgift'||page==='complaint';
  const label=(page,fallback='工作空间')=>pages.get(page)?.label||(page==='selection'?'选品':fallback);
  const resolve=(requested,lastSelectionPage,marketingView)=>requested==='selection'
    ?(isSelection(lastSelectionPage)?lastSelectionPage:'trends')
    :requested==='marketing'
      ?(['hostedgift','complaint'].includes(marketingView)?marketingView:'purchase')
      :(pages.has(requested)?requested:null);

  function create({esc,svg,canAccess}){
    const allowed=page=>typeof canAccess!=='function'||canAccess(page);
    const firstAllowed=(items,fallback)=>items.find(item=>allowed(item.id))?.id||fallback;
    const resolveAuthorized=(requested,lastSelectionPage,marketingView)=>{
      if(requested==='selection')return firstAllowed(selectionPages,isSelection(lastSelectionPage)&&allowed(lastSelectionPage)?lastSelectionPage:null);
      if(requested==='marketing')return firstAllowed(modulePages,['hostedgift','complaint'].includes(marketingView)&&allowed(marketingView)?marketingView:'purchase');
      const page=resolve(requested,lastSelectionPage,marketingView);
      return page&&allowed(page)?page:null;
    };
    function sidebar(page){
      return items.filter(item=>allowed(item.id)).map(item=>{
        const active=item.children?isSelection(page):(item.id==='marketing'?isMarketing(page):page===item.id);
        return `${item.reserved?'<div class="nav-separator"></div>':''}<button type="button" class="nav-item${active?' active':''}" data-action="navigate" data-page="${item.id}" aria-current="${active?'page':'false'}" title="${esc(item.label)}">${svg(item.icon)}<span>${esc(item.label)}</span>${item.reserved?'<span class="soon">预留</span>':''}</button>`;
      }).join('');
    }
    function breadcrumb(page){
      return `工作空间 <span aria-hidden="true">/</span> ${isSelection(page)?'<button type="button" class="breadcrumb-group" data-action="navigate" data-page="selection">选品</button><span aria-hidden="true">/</span> ':''}<strong id="breadcrumb-current">${esc(label(page))}</strong>`;
    }
    function wrap(page,content){
      if(!isSelection(page))return content;
      return `<div class="selection-page" data-selection-page="${page}"><nav class="selection-navigation" aria-label="选品功能"><span class="selection-navigation-label">选品</span><div class="selection-tabs">${selectionPages.filter(item=>allowed(item.id)).map(item=>`<button type="button" class="selection-tab${page===item.id?' active':''}" data-action="navigate" data-page="${item.id}" aria-current="${page===item.id?'page':'false'}">${svg(item.icon)}<span>${esc(item.label)}</span></button>`).join('')}</div></nav><div class="selection-content">${content}</div></div>`;
    }
    // 账号头像上方的图标区：更新 + 设置。更新不受权限限制，所有账号都能看到；
    // 更新是弹出小浮窗（data-action="open-update"），不进入整页。
    function rail(page){
      return utilityPages.map(item=>{
        // 插件与更新是面板型入口（弹窗），不参与页面权限判定。
        const enabled=['update','plugin'].includes(item.id)?true:allowed(item.id);
        if(!enabled)return '';
        const action=item.id==='update'?'open-update':item.id==='plugin'?'open-plugin':'navigate';
        return `<button type="button" class="rail-item" data-action="${action}" ${item.id==='settings'?`data-page="${item.id}"`:''} title="${esc(item.label)}" aria-label="${esc(item.label)}">${svg(item.icon)}</button>`;
      }).join('');
    }

    return {sidebar,rail,breadcrumb,wrap,label,resolve:resolveAuthorized,isSelection};
  }
  window.XXNavigation=Object.freeze({create});
})();
