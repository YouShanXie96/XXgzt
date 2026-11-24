'use strict';

/**
 * 上品库 · 类目读取与类目树（复刻老软件「参数 → 类目」面板的全部能力）
 *
 * 老软件的两条来源（REA 证据，来自 beta.268 解包源码）：
 *   1) 采集时：selection/collector.js 用 skuLogic.extractInlineCategory(document.documentElement.innerHTML)
 *      从 SSR 内嵌的 rootCategory / leafCategory 抠类目 ID；抠不到再走一次
 *      mtop.taobao.detail.getdetail，读 data.item.categoryId / rootCategoryId。
 *      main/pool-source-category.js 再用「个人淘宝号」隐藏窗口按商品 ID 兜底重读，结果按 productId 缓存。
 *   2) 类目树：main/tmall-category-tree.js 在店铺后台页面执行
 *      fetch('/router/asyncOpt.htm?optType=categorySelectChildren&fromSmart=true[&catId=父类目]')
 *      逐层读取，7 天本地缓存，按店铺 profileId 分层；按 id 拼路径、按名称搜叶子类目，必须选到叶子才能保存。
 *
 * 新软件不接老软件任何运行时：这里用工作台自己的店铺会话隐藏窗口做**只读**探测，
 * 并把淘宝开放平台 taobao.itemcats.get 作为可插拔的第二来源（凭证到位自动启用）。
 * 所有读不到的情况都返回可读原因，绝不按标题猜类目。
 */

const CATEGORY_PATH_SEP = ' / ';
const CATEGORY_TREE_TTL_MS = 7 * 24 * 3600 * 1000;
const ID_RE = /^\d{2,16}$/;
const FILE = 'selectionpool/category-cache.json';
const SHOP_CATS_FILE = 'selectionpool/shop-categories.json';
const SHOP_CATS_TTL_MS = 7 * 24 * 3600 * 1000;
// 2 = 从「宝贝分类」页按分类名称列读取（v1 误把日期列当分类名，旧缓存直接作废）
const SHOP_CATS_VERSION = 2;

const ID_KEYS = ['id', 'catId', 'categoryId', 'cid', 'value', 'key'];
const NAME_KEYS = ['name', 'catName', 'categoryName', 'text', 'label', 'title'];

/** 商品页只读探测脚本：内嵌 SSR 类目 → 页面自带 lib.mtop → 面包屑路径。 */
function sourceCategoryProbeScript(productId) {
  const id = JSON.stringify(String(productId || ''));
  return `(async () => {
  const href = String(location.href || '');
  if (/login\\.(taobao|tmall)\\.com|havanaone\\/login|login_jump/.test(href)) return { state: 'login' };
  if (/_____tmd_____|\\/punish|x5secdata|captcha/i.test(href) || document.querySelector('#nc_1_n1z,.nc_iconfont.btn_slide,iframe[src*="punish"]')) return { state: 'challenge' };
  const html = document.documentElement ? document.documentElement.innerHTML : '';
  const root = html.match(/\\\\?"rootCategory\\\\?"\\s*:\\s*\\\\?"(\\d{2,16})\\\\?"/);
  const leaf = html.match(/\\\\?"leafCategory\\\\?"\\s*:\\s*\\\\?"(\\d{2,16})\\\\?"/);
  const crumb = (() => {
    const node = document.querySelector('[class*="breadcrumb"],[class*="Breadcrumb"],[class*="crumb"],[class*="CategoryPath"]');
    const text = node ? String(node.innerText || '').replace(/\\s+/g, ' ').trim() : '';
    return text.slice(0, 300);
  })();
  const out = { state: 'page', onPage: html.indexOf(${id}) >= 0, leafId: leaf ? leaf[1] : '', rootId: root ? root[1] : '', breadcrumb: crumb, detail: null, detailError: '' };
  if (out.leafId && out.onPage) return out;
  try {
    if (window.lib && window.lib.mtop && typeof window.lib.mtop.request === 'function') {
      const res = await Promise.race([
        window.lib.mtop.request({ api: 'mtop.taobao.detail.getdetail', v: '6.0', data: { itemNumId: ${id} }, ecode: 0, type: 'GET', dataType: 'json' }),
        new Promise(r => setTimeout(() => r(null), 15000))
      ]);
      const item = res && res.data && res.data.item;
      out.detail = item ? { itemId: String(item.itemId || ''), categoryId: String(item.categoryId || ''), rootCategoryId: String(item.rootCategoryId || '') } : null;
      out.ret = Array.isArray(res && res.ret) ? res.ret.slice(0, 2) : [];
    } else out.detailError = 'no-mtop';
  } catch (e) { out.detailError = String(e && e.message || e).slice(0, 120); }
  return out;
})()`;
}

/** 店铺后台只读探测脚本：逐层读取店铺可发布类目。 */
function categoryChildrenScript(parentId) {
  const query = parentId ? `&catId=${encodeURIComponent(parentId)}` : '';
  return `(async () => {
  const href = String(location.href || '');
  if (/login\\.(taobao|tmall)\\.com|havanalogin/.test(href)) return { reason: 'login' };
  try {
    const res = await fetch('/router/asyncOpt.htm?optType=categorySelectChildren&fromSmart=true${query}', { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/plain, */*' } });
    const body = await res.text();
    if (res.redirected && /login/.test(res.url)) return { reason: 'login' };
    return { status: res.status, body: String(body || '').slice(0, 600000) };
  } catch (e) { return { reason: 'error', message: String(e && e.message || e).slice(0, 160) }; }
})()`;
}

/**
 * 天猫「宝贝分类」管理页（用户 2026-11-21 指定）：
 *   https://siteadmin.tmall.com/category/index.htm?showLayout=false
 *
 * 这里读的是卖家自己建的店铺分类（一级 + 子分类），登录了就能读，不需要先上架过商品。
 * 页面是老的站内管理页，结构不公开，所以用三套互相兜底的识别方式：
 *   A. 管理列表行（tr/li）：行内带「编辑/删除/添加子分类」或复选框 → 取行里的名称；
 *   B. 类目容器（id/class 含 categor/cat-list）里的 li/a → 取短文本，按 li 嵌套算层级；
 *   C. 带 data-cat-id / data-id 的节点短文本。
 * 三套都读不到就返回空 + diag，由调用方退回发布页读法，绝不按标题猜。
 */
function shopCategorySiteScript() {
  return `(async function(){
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function txt(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\\u00a0/g,' ').replace(/[ \\t]+/g,' ').replace(/\\s*\\n\\s*/g,' ').trim();}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  var OUT=[],SEEN={};
  var BAD=/^(?:编辑|删除|添加|添加子分类|添加下级分类|添加下级|上移|下移|批量|全选|确定|取消|保存|返回|首页|上一页|下一页|搜索|宝贝分类|分类管理|新建分类|新建|添加分类|展开|收起|全部|更多|帮助|客服|消息|设置|操作|序号|分类名称|上级分类|排序|显示|隐藏|移入|移出)$/;
  // 日期/时间/纯符号都不是分类名（2026-11-24 现场：把「创建时间」列当成了分类）
  var DATE_LIKE=/^\\d{4}[-/.年]\\d{1,2}[-/.月]\\d{1,2}(?:日)?(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2})?)?$/;
  var TIME_LIKE=/^\\d{1,2}:\\d{2}(?::\\d{2})?$/;
  var SYMBOL_ONLY=/^[\\s\\u25b6\\u25c0\\u25bc\\u25b2\\u25ba\\u25c4\\-\\u2014_=+*\\/\\\\|.,:;!?~^<>()\\[\\]{}#@$%&\\u00d7\\u2715\\u2713\\u2714]+$/;
  function badName(name){
    if(!name||name.length>30)return true;
    if(/^\\d+$/.test(name))return true;
    if(DATE_LIKE.test(name)||TIME_LIKE.test(name))return true;
    if(SYMBOL_ONLY.test(name))return true;
    if(BAD.test(name))return true;
    if(/^(编辑|删除|添加)/.test(name))return true;
    return false;
  }
  function add(name,group,level){
    name=String(name||'').replace(/\\s+/g,' ').trim();
    if(badName(name))return;
    var key=(group||'')+'|'+name;
    if(SEEN[key])return;
    SEEN[key]=1;
    OUT.push({name:name,group:group||'',path:group?group+' / '+name:name,level:level||0});
  }
  function ownText(node){
    var own='';
    try{
      for(var i=0;i<node.childNodes.length;i++){
        var nd=node.childNodes[i];
        if(nd.nodeType===3)own+=nd.nodeValue;
      }
    }catch(e){}
    return String(own||'').replace(/\\s+/g,' ').trim();
  }
  function leftOf(n){
    var r=null;
    try{r=n.getBoundingClientRect();}catch(e){}
    return r?Math.round(r.left):0;
  }
  function nameAndX(row){
    // 分类名一般就在行里的文本框里（截图：分类名称那一列是个 input）
    var inputs=[];
    try{inputs=row.querySelectorAll('input[type="text"],input:not([type]),textarea');}catch(e){}
    for(var q=0;q<inputs.length;q++){
      var v=String(inputs[q].value||'').trim();
      if(v&&!badName(v))return {name:v,x:leftOf(inputs[q])};
    }
    var cands=[];
    try{cands=row.querySelectorAll('a,span,td,label,strong,b,em');}catch(e){}
    for(var i=0;i<cands.length;i++){
      var c=cands[i];
      if(!vis(c))continue;
      var own=ownText(c);
      if(own&&!badName(own))return {name:own,x:leftOf(c)};
    }
    var t=txt(row).replace(/(编辑|删除|添加子分类|添加下级分类|添加下级|上移|下移|批量|确定|取消)/g,' ').replace(/\s+/g,' ').trim();
    return badName(t)?null:{name:t,x:leftOf(row)};
  }

  function depthOf(node){
    var d=0,p=node.parentElement;
    while(p){var tag=String(p.tagName||'').toLowerCase();if(tag==='li'||tag==='tr')d++;p=p.parentElement;if(d>8)break;}
    return d;
  }
  // A. 管理列表行
  var rows=[],all=document.querySelectorAll('tr,li');
  for(var i=0;i<all.length;i++){
    var n=all[i];
    if(!vis(n))continue;
    // 表头行（全选/分类名称/操作）不算分类
    if(n.querySelector&&n.querySelector('th'))continue;
    var t=txt(n);
    if(!t||t.length>120)continue;
    if(!/(编辑|删除|添加子分类|添加下级|上移|下移)/.test(t)&&!n.querySelector('input[type=checkbox]'))continue;
    rows.push(n);
  }
  rows=rows.filter(function(n){return !rows.some(function(m){return m!==n&&n.contains&&n.contains(m);});});
  // 子分类比父分类缩进更深：用名称控件的左坐标算层级（现场截图就是树形缩进）
  var stack=[];
  for(var r=0;r<rows.length;r++){
    var info=nameAndX(rows[r]);
    if(!info)continue;
    while(stack.length&&stack[stack.length-1].x>=info.x-2)stack.pop();
    add(info.name, stack.length?stack[stack.length-1].name:'', stack.length);
    stack.push({x:info.x,name:info.name});
  }
  var diag={rows:rows.length,a:OUT.length};
  // A2. 「宝贝分类」管理表格：只认「分类名称」这一列（用户 2026-11-24 现场：
  //     之前取每行第一个单元格，结果把「创建时间」那些日期当成了分类名）。
  //     名称可能是单元格里的 input.value；子分类比父分类缩进更深，用左坐标算层级。
  if(!OUT.length){
    var tables=document.querySelectorAll('table');
    var picked=0;
    for(var t2=0;t2<tables.length&&picked<3;t2++){
      var table=tables[t2];
      if(!vis(table))continue;
      var allRows=table.querySelectorAll('tr');
      var headRow=null,colIndex=-1;
      for(var h=0;h<allRows.length&&!headRow;h++){
        if(!vis(allRows[h]))continue;
        var hcells=allRows[h].querySelectorAll('th,td');
        for(var c=0;c<hcells.length;c++){
          var ct=String(txt(hcells[c])||'').replace(/\s+/g,'');
          if(/^(?:分类名称|分类名|宝贝分类|店铺分类)$/.test(ct)||/分类名称/.test(ct)){headRow=allRows[h];colIndex=c;break;}
        }
      }
      if(colIndex<0)continue;
      picked++;
      var rows2=[];
      for(var r2=0;r2<allRows.length;r2++){
        var tr=allRows[r2];
        if(tr===headRow||!vis(tr))continue;
        var cells2=tr.querySelectorAll('td');
        if(cells2.length<=colIndex)continue;          // 表头行/跨列行不算
        var cell=cells2[colIndex];
        var val='';
        var inp=null;
        try{inp=cell.querySelector('input[type="text"],input:not([type]),textarea');}catch(e){}
        if(inp)val=String(inp.value||inp.textContent||'').trim();
        if(!val)val=String(txt(cell)||'').replace(/\s+/g,' ').trim();
        // 单元格里常带「添加子分类」这类按钮文字，切掉
        val=val.replace(/(?:添加子分类|添加下级分类|添加分类|编辑|删除)\s*$/,'').trim();
        if(!val||val.length>30)continue;
        if(BAD.test(val))continue;
        var rect=null;try{rect=cell.getBoundingClientRect();}catch(e){}
        rows2.push({name:val,x:rect?Math.round(rect.left):0});
      }
      // 缩进算层级：x 比栈顶小（更靠左）说明回到上一级
      var stack=[];
      for(var k2=0;k2<rows2.length;k2++){
        var row2=rows2[k2];
        while(stack.length&&stack[stack.length-1].x>=row2.x-2)stack.pop();
        add(row2.name, stack.length?stack[stack.length-1].name:'', stack.length);
        stack.push({x:row2.x,name:row2.name});
      }
      diag.tableId=String(table.id||table.className||'').slice(0,40);
      diag.col=colIndex;
    }
    diag.tables=tables.length;
    diag.a2=OUT.length;
  }
  // B. 类目容器里逐层找
  if(!OUT.length){
    var zones=[];
    try{zones=document.querySelectorAll('[id*="categor" i],[class*="categor" i],[id*="cat-list" i],[class*="cat-list" i],[class*="catList"],[id*="catList"]');}catch(e){}
    for(var z=0;z<zones.length&&OUT.length<200;z++){
      var zone=zones[z];
      if(!vis(zone))continue;
      var nodes=[];
      try{nodes=zone.querySelectorAll('li,a,span');}catch(e){continue;}
      for(var q=0;q<nodes.length;q++){
        var node=nodes[q];
        if(!vis(node))continue;
        var own=ownText(node)||(node.tagName==='A'?txt(node):'');
        if(!own||own.length>30)continue;
        var lv2=depthOf(node);
        add(own,'',lv2);
      }
    }
    diag.zones=zones.length;
    diag.b=OUT.length;
  }
  // C. 带分类 id 的节点
  if(!OUT.length){
    var labeled=[];
    try{labeled=document.querySelectorAll('[data-cat-id],[data-category-id],[data-catid]');}catch(e){}
    for(var d=0;d<labeled.length&&OUT.length<200;d++){
      var el=labeled[d];
      if(!vis(el))continue;
      add(txt(el),'',0);
    }
    diag.c=OUT.length;
  }
  diag.total=OUT.length;
  return JSON.stringify({ok:OUT.length>0,items:OUT.slice(0,300),diag:diag,url:String(location.href||'').slice(0,160)});
})()`;
}

function pick(obj, keys) {
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '') return obj[key];
  return undefined;
}

function asNode(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.isBrand === true) return null;
  const id = String(pick(raw, ID_KEYS) ?? '').trim();
  const name = String(pick(raw, NAME_KEYS) ?? '').replace(/\s+/g, ' ').trim();
  if (!/^\d{1,15}$/.test(id) || !name || /^\d+$/.test(name) || name.length > 60) return null;
  let leaf = false;
  for (const key of ['leaf', 'isLeaf', 'isLeafCategory', 'leafCategory']) {
    if (raw[key] !== undefined) { leaf = raw[key] === true || raw[key] === 'true' || raw[key] === 1 || raw[key] === '1'; break; }
  }
  if (!leaf && Array.isArray(raw.children)) leaf = raw.children.length === 0;
  if (!leaf && Array.isArray(raw.dataSource)) leaf = raw.dataSource.length === 0;
  return { id, name, leaf, ...(raw.isAuthorized === false ? { authorized: false } : {}) };
}

/** 从接口返回里找出「每一项都有数字 id + 名称」的数组，兼容任意外层包装。 */
function parseChildren(payload) {
  let value = payload;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  const seen = new Set();
  const queue = [value];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      const objects = current.filter(x => x && typeof x === 'object' && !Array.isArray(x));
      const nodes = objects.map(asNode).filter(Boolean);
      const brands = objects.filter(x => x.isBrand === true).length;
      if (objects.length && objects.length === current.length && nodes.length + brands === objects.length) {
        const unique = new Map();
        for (const node of nodes) if (!unique.has(node.id)) unique.set(node.id, node);
        return [...unique.values()];
      }
      for (const item of current) queue.push(item);
    } else {
      for (const item of Object.values(current)) if (item && typeof item === 'object') queue.push(item);
    }
  }
  return [];
}

const levelKey = (profileId, parentId) => `${String(profileId || '').trim()}|${parentId || 'root'}`;

function indexLevels(levels) {
  const index = new Map();
  for (const [key, entry] of Object.entries(levels || {})) {
    const parent = key.includes('|') ? key.slice(key.lastIndexOf('|') + 1) : 'root';
    for (const node of (entry && Array.isArray(entry.items) ? entry.items : [])) {
      index.set(String(node.id), { name: node.name, parent: parent === 'root' ? '' : String(parent), leaf: Boolean(node.leaf), authorized: node.authorized !== false });
    }
  }
  return index;
}

function pathOf(index, id) {
  const names = [];
  let current = String(id || '');
  const leaf = index.get(current)?.leaf ?? false;
  const authorized = index.get(current)?.authorized ?? true;
  for (let depth = 0; current && depth < 8; depth++) {
    const node = index.get(current);
    if (!node) return null;
    names.unshift(node.name);
    current = node.parent;
  }
  if (current) return null;
  return { id: String(id), names, path: names.join(CATEGORY_PATH_SEP), leaf, authorized };
}

function searchIndex(index, keyword, limit = 40) {
  const words = String(keyword || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const id of index.keys()) {
    if (!index.get(id).leaf) continue;
    const hit = pathOf(index, id);
    if (hit && words.every(w => hit.path.includes(w))) out.push(hit);
  }
  const first = words[0];
  out.sort((a, b) => Number(!a.names.at(-1).includes(first)) - Number(!b.names.at(-1).includes(first)) || a.path.length - b.path.length);
  return out.slice(0, limit);
}

function createCategoryService({ repo, ctx, taobaoApi, editorStore }) {
  const readJson = (file, fallback) => ctx.readJson(file, fallback);
  const writeJson = (file, value) => ctx.writeJson(file, value);

  async function cache() {
    const data = await readJson(FILE, { version: 1, source: {}, levels: {} });
    return {
      version: 1,
      source: data && typeof data.source === 'object' && data.source ? data.source : {},
      levels: data && typeof data.levels === 'object' && data.levels ? data.levels : {},
    };
  }

  /** 采集包里的类目（插件已写入 snapshot.category_id / category_path，这里做兜底归一）。 */
  function normalizeCaptureCategory(capture = {}, snapshot = {}) {
    const raw = capture.category || snapshot.category || {};
    const leafId = C_str(capture.categoryId || capture.category_id || snapshot.category_id || snapshot.categoryId || raw.leaf_id || raw.leafId || raw.categoryId);
    const rootId = C_str(capture.rootCategoryId || capture.root_category_id || snapshot.root_category_id || raw.root_id || raw.rootId || raw.rootCategoryId);
    const categoryPath = C_str(capture.categoryPath || capture.category_path || snapshot.category_path || snapshot.categoryPath || raw.categoryPath || raw.path);
    // 插件把页面上的「类目 50013087」这种标签文字当成路径传过来过（用户 2026-11-11）：
    // 这不是真实路径，留着会让编辑器显示成裸 ID 前缀。判脏直接丢弃，由视图层按 ID 反查中文路径。
    const dirty = !categoryPath || /^类目\s*\d+$/.test(categoryPath) || /^\d+$/.test(categoryPath) || /根类目\s*\d+|叶子类目\s*\d+/.test(categoryPath);
    return {
      categoryId: ID_RE.test(leafId) ? leafId : '',
      rootCategoryId: ID_RE.test(rootId) ? rootId : '',
      categoryPath: dirty ? '' : categoryPath.slice(0, 300),
      source: C_str(capture.categorySource || snapshot.category_source) || (leafId ? 'capture' : ''),
    };
  }

  function C_str(v) { return v === undefined || v === null ? '' : String(v).trim(); }

  function sourceItemUrl(productId, platform) {
    return /taobao/i.test(String(platform)) && !/tmall/i.test(String(platform))
      ? `https://item.taobao.com/item.htm?id=${productId}`
      : `https://detail.tmall.com/item.htm?id=${productId}`;
  }

  /** 老软件 interpretPageProbe 的等价实现：把一次页面探测结果归一成 ok/失败码。 */
  function interpretSourceProbe(probe, productId, probeError) {
    if (!probe) return { ok: false, code: 'UNKNOWN', reason: probeError || '商品页没有响应' };
    if (probe.state === 'login') return { ok: false, code: 'LOGIN', reason: '个人淘宝号未登录或登录已过期' };
    if (probe.state === 'challenge') return { ok: false, code: 'CHALLENGE', reason: '淘宝要求安全验证' };
    const detail = probe.detail;
    const same = !detail?.itemId || !productId || String(detail.itemId) === productId;
    const leafId = ID_RE.test(String(probe.leafId || '')) && probe.onPage ? String(probe.leafId) : '';
    const rootId = ID_RE.test(String(probe.rootId || '')) ? String(probe.rootId) : '';
    if (leafId) return { ok: true, leafId, rootId, via: 'page', breadcrumb: C_str(probe.breadcrumb).slice(0, 300) };
    if (same && detail && ID_RE.test(String(detail.categoryId || ''))) {
      return {
        ok: true, leafId: String(detail.categoryId),
        rootId: ID_RE.test(String(detail.rootCategoryId || '')) ? String(detail.rootCategoryId) : rootId,
        via: 'getdetail', breadcrumb: C_str(probe.breadcrumb).slice(0, 300),
      };
    }
    const ret = (probe.ret || []).join(';');
    if (/FAIL_SYS_USER_VALIDATE|RGV587|x5sec|punish/i.test(ret)) return { ok: false, code: 'CHALLENGE', reason: '淘宝要求安全验证' };
    if (/SESSION_EXPIRED|未登录|login/i.test(ret)) return { ok: false, code: 'LOGIN', reason: '个人淘宝号登录已过期' };
    if (/ITEM_NOT_FOUND|商品不存在|已下架/i.test(ret)) return { ok: false, code: 'NOT_FOUND', reason: '商品已下架或不存在' };
    if (!probe.onPage) return { ok: false, code: 'NOT_FOUND', reason: '商品页打不开（可能已下架或正在跳转）', pending: true };
    return { ok: false, code: 'UNKNOWN', reason: `商品页和详情接口都没给类目${probe.detailError ? `（${C_str(probe.detailError).slice(0, 80)}）` : ''}` };
  }

  /**
   * 按商品 ID 重读真实类目（老软件 pool-source-category.js 的等价实现）。
   * 只读：不点任何东西，不做任何提交。失败返回可读原因，不猜类目。
   *
   * 与老软件一致的两个关键点（REA 证据，pool-source-category.js 注释原文）：
   *   1) 用「个人淘宝号」会话打开商品页——店铺后台账号打开商品页会被要求重新登录（实测）；
   *   2) 登录过期时先出中间页，2–3 秒后才跳登录页，所以最多读五次。
   * 未登录个人号时直接按老软件语义报 LOGIN，引导先登录个人淘宝号。
   */
  async function readSource(input = {}) {
    const productId = C_str(input.productId);
    const itemId = Number(input.itemId) || 0;
    if (!/^\d{6,20}$/.test(productId)) return { ok: false, code: 'BAD_INPUT', message: '商品 ID 不对，读不了类目' };
    const data = await cache();
    const hit = input.refresh ? null : data.source[productId];
    if (hit && ID_RE.test(String(hit.leafId || ''))) {
      return { ok: true, data: { productId, ...hit, source: 'cache' } };
    }
    if (typeof ctx.probePersonalSource !== 'function' && typeof ctx.probePage !== 'function') {
      return { ok: false, code: 'PROBE_UNAVAILABLE', message: '本机类目读取未就绪。请在浏览器插件里打开商品页重新加入上品库，或填好开放平台凭证后由接口读取。' };
    }
    if (typeof ctx.probePersonalSource === 'function') {
      const ready = await ctx.probePersonalSource();
      if (!ready) {
        // 用户 2026-11-10 明确：不在工作台里登录，主链路是插件在浏览器（已登录个人账号）采集时
        // 直接把类目/参数/SKU/详情图带上。按 ID 重读只是兜底，读不到就引导插件重新采集。
        return { ok: false, code: 'LOGIN', message: '本机读不到这件商品的类目。请在安装插件的浏览器里登录个人账号，打开这件商品页点「加入上品库」重新采集——插件会把类目、参数、SKU、详情图一起带上。' };
      }
    }
    let outcome = { ok: false, code: 'UNKNOWN', reason: '还没开始读取' };
    for (let attempt = 0; attempt < 5; attempt++) {
      let probe = null;
      let probeError = '';
      try {
        probe = await ctx.probePage({
          personal: true,
          url: sourceItemUrl(productId, input.platform),
          script: sourceCategoryProbeScript(productId),
          timeoutMs: 25000,
          waitMs: attempt === 0 ? 1500 : 2500,
        });
      } catch (error) { probeError = C_str(error?.message || error); }
      outcome = interpretSourceProbe(probe, productId, probeError);
      if (outcome.ok || outcome.code === 'LOGIN' || outcome.code === 'CHALLENGE' || (outcome.code === 'NOT_FOUND' && !outcome.pending)) break;
    }
    if (!outcome.ok) {
      const reason = C_str(outcome.reason);
      if (outcome.code === 'LOGIN') return { ok: false, code: 'LOGIN', message: '淘宝读不到这件商品的类目（未登录或登录已过期）。请在安装插件的浏览器里登录个人账号，打开商品页重新点「加入上品库」——插件会把类目和参数一起带上。' };
      if (outcome.code === 'CHALLENGE') return { ok: false, code: 'CHALLENGE', needPersonalLogin: true, message: '淘宝要求安全验证，读不到类目。请打开「个人淘宝号」完成验证后重试。' };
      if (outcome.code === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND', message: '商品已下架或不存在，读不到类目。' };
      return { ok: false, code: 'UNKNOWN', message: `按商品 ID 读类目没成功：${reason.slice(0, 140)}` };
    }
    const entry = { leafId: outcome.leafId, rootId: outcome.rootId, via: outcome.via, breadcrumb: outcome.breadcrumb || '', readAt: new Date().toISOString() };
    data.source[productId] = entry;
    await writeJson(FILE, data);
    const result = { ok: true, data: { productId, ...entry, source: 'taobao' } };
    if (itemId) {
      const detail = await repo.detail(itemId).catch(() => null);
      const categoryPath = entry.breadcrumb || C_str(detail?.categoryPath) || C_str(detail?.listing?.categoryPath);
      await repo.applyManualParams(itemId, { categoryId: leafId, categoryPath }).catch(() => undefined);
      if (editorStore) await editorStore.syncBaseline(itemId, await repo.detail(itemId), true).catch(() => undefined);
      result.saved = true;
    }
    return result;
  }

  /** 类目树某一层：缓存 → 店铺后台页面脚本 → 开放平台 API（凭证到位自动启用）。 */
  async function children(input = {}) {
    const parentId = ID_RE.test(String(input.parentId || '')) ? String(input.parentId) : '';
    const profileId = C_str(input.profileId);
    const key = levelKey(profileId, parentId);
    const data = await cache();
    const cached = data.levels[key];
    if (cached && !input.refresh && Date.now() - Date.parse(cached.at || '') < CATEGORY_TREE_TTL_MS && Array.isArray(cached.items) && cached.items.length) {
      return { ok: true, parentId, items: cached.items, source: 'cache', readAt: cached.at };
    }
    let items = [];
    let source = '';
    if (typeof ctx.probePage === 'function') {
      try {
        const res = await ctx.probePage({
          storeId: profileId,
          url: 'https://sell.publish.tmall.com/tmall/ai/category.htm',
          script: categoryChildrenScript(parentId),
          timeoutMs: 22000,
          waitMs: 1200,
        });
        if (res?.reason === 'login') return { ok: false, code: 'LOGIN', message: '店铺登录已失效，读不到淘宝类目列表；请先在首页重新登录这家店铺。', items: cached?.items || [] };
        if (res?.status === 200) { items = parseChildren(res.body); source = 'page'; }
      } catch { /* 落到 API 或缓存 */ }
    }
    if (!items.length && taobaoApi && typeof taobaoApi.call === 'function') {
      const api = await taobaoApi.call('taobao.itemcats.get', { parent_cid: parentId || 0, fields: 'cid,parent_cid,name,is_parent' }, { session: false }).catch(() => null);
      if (api?.ok) {
        const rows = C_list(api.data?.item_cats?.item_cat || api.data?.item_cats || api.data?.item_cats_get_response?.item_cats?.item_cat);
        items = rows.map(r => asNode({ id: r.cid ?? r.category_id, name: r.name, leaf: String(r.is_parent) !== 'true', authorized: true })).filter(Boolean);
        source = 'open-api';
      }
    }
    if (!items.length) {
      if (cached?.items?.length) return { ok: true, parentId, items: cached.items, source: 'cache', readAt: cached.at };
      return { ok: false, code: 'EMPTY', message: parentId ? '这一层没有下一级类目。' : '还没有读到这家店铺可发布的类目；可点「刷新」重试，或填好开放平台凭证后由接口读取，也可以在下面手工填类目 ID。', items: [] };
    }
    const at = new Date().toISOString();
    data.levels[key] = { at, items };
    await writeJson(FILE, data);
    return { ok: true, parentId, items, source, readAt: at };
  }

  function C_list(v) { return Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray(v.item_cat) ? v.item_cat : []; }

  /* ------------------------------------------------------------------
   * 店铺中分类（卖家自定义分类）——用户 2026-11-21 明确：
   *   「店铺分类不是店铺类目，是指发布页这里的『店铺中分类』」
   * 截图上它是一个「选择分类」下拉，选项是店铺自己建的分类（爆单品 / 多金多金→多金T…），可多选。
   * 来源只有发布页：__SELL_STATE__ 或下拉里的复选框。平台没有对应的开放接口
   * （taobao.sellercats.list.get 未开通），所以读不到就如实说，不拿平台类目树冒充。
   * ------------------------------------------------------------------ */
  let shopCatScriptCache = '';
  function shopCatOptionsScript() {
    if (!shopCatScriptCache) {
      try { shopCatScriptCache = require('./driver-v2').readShopCategoryOptionsScript(); } catch { shopCatScriptCache = ''; }
    }
    return shopCatScriptCache;
  }

  async function shopCatCache() {
    const data = await readJson(SHOP_CATS_FILE, { version: SHOP_CATS_VERSION, stores: {} });
    const valid = C.int(data?.version) === SHOP_CATS_VERSION;
    return {
      version: SHOP_CATS_VERSION,
      stores: valid && data && typeof data.stores === 'object' && data.stores ? data.stores : {},
    };
  }

  function normalizeShopCatItems(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const out = [];
    for (const row of list) {
      const name = C_str(row?.name || row?.label || row?.text).replace(/\s+/g, ' ').trim();
      if (!name || name.length > 40 || seen.has(name)) continue;
      seen.add(name);
      const group = C_str(row?.group || '').slice(0, 40);
      out.push({
        id: C_str(row?.id || row?.value || ''),
        name,
        group,
        path: C_str(row?.path || '') || (group ? `${group}${CATEGORY_PATH_SEP}${name}` : name),
      });
    }
    return out.slice(0, 300);
  }

  /** 上架时驱动读到的分类列表回写缓存，下次打开设置页不用再开窗口。 */
  async function rememberShopCategories(storeId, items) {
    const key = C_str(storeId);
    const rows = normalizeShopCatItems(items);
    if (!key || !rows.length) return { ok: false, saved: 0 };
    const data = await shopCatCache();
    const old = normalizeShopCatItems(data.stores[key]?.items);
    // 以本次页面读到的为准（带分组），但折叠起来没读到的旧分类不要丢；
    // 本次名字没带分组时用旧分组补上，设置页仍然按组展示。
    const oldByName = new Map(old.map(row => [row.name, row]));
    const merged = rows.map(row => {
      const prev = oldByName.get(row.name);
      const group = row.group || prev?.group || '';
      return { ...row, group, path: row.path || (group ? `${group}${CATEGORY_PATH_SEP}${row.name}` : row.name) };
    });
    const seen = new Set(merged.map(r => r.name));
    for (const row of old) if (!seen.has(row.name)) { merged.push(row); seen.add(row.name); }
    data.stores[key] = { at: new Date().toISOString(), items: merged.slice(0, 300) };
    await writeJson(SHOP_CATS_FILE, data);
    return { ok: true, saved: merged.length };
  }

  /**
   * 读取某店铺的「店铺中分类」选项（用户 2026-11-21 指定来源）：
   *   主来源：天猫「宝贝分类」管理页 https://siteadmin.tmall.com/category/index.htm?showLayout=false
   *         —— 只要店铺登录了就能读，不需要先上架过商品；
   *   兜底：商品发布页「店铺中分类」下拉（万一宝贝分类页结构变了）。
   * 只读：开隐藏窗口、读列表、关窗口，不点编辑/删除/提交。
   */
  async function shopCategories(input = {}) {
    const storeId = C_str(input.storeId || input.profileId);
    const refresh = input.refresh === true;
    if (!storeId) return { ok: false, code: 'BAD_INPUT', message: '请先选择店铺', items: [] };
    const data = await shopCatCache();
    const hit = data.stores[storeId];
    const cachedItems = normalizeShopCatItems(hit?.items);
    const fresh = hit && Date.now() - Date.parse(hit.at || '') < SHOP_CATS_TTL_MS;
    if (!refresh && cachedItems.length && fresh) {
      return { ok: true, storeId, items: cachedItems, source: 'cache', readAt: hit.at };
    }
    // 打开「上架设置」时只读缓存：不能每开一次弹窗就开一个隐藏窗口
    if (!refresh && input.cachedOnly === true) {
      return cachedItems.length
        ? { ok: true, storeId, items: cachedItems, source: 'cache-stale', readAt: hit?.at || '' }
        : { ok: false, code: 'NO_CACHE', storeId, items: [], message: '还没有读到这家店铺的店铺中分类，点「刷新」读取' };
    }
    if (typeof ctx.probePage !== 'function') {
      return {
        ok: false, code: 'PROBE_UNAVAILABLE', storeId, items: cachedItems,
        message: '本机读取店铺中分类未就绪，请检查店铺登录状态后重试',
      };
    }
    const save = async (items, source) => {
      data.stores[storeId] = { at: new Date().toISOString(), items };
      await writeJson(SHOP_CATS_FILE, data);
      return { ok: true, storeId, items, source, readAt: data.stores[storeId].at };
    };
    // ① 天猫宝贝分类管理页
    let siteDiag = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      let res = null;
      try {
        res = await ctx.probePage({
          storeId,
          url: 'https://siteadmin.tmall.com/category/index.htm?showLayout=false',
          script: shopCategorySiteScript(),
          timeoutMs: 40000,
          waitMs: attempt === 0 ? 2500 : 4500,
        });
      } catch (error) {
        siteDiag = `宝贝分类页读取失败：${C_str(error?.message || error).slice(0, 100)}`;
        continue;
      }
      if (res?.reason === 'login') {
        return { ok: false, code: 'LOGIN', storeId, items: cachedItems, message: '店铺登录已失效，读不到店铺分类；请先在「店铺登录」重新登录这家店铺' };
      }
      let parsed = res;
      if (typeof res === 'string') { try { parsed = JSON.parse(res); } catch { parsed = null; } }
      const items = normalizeShopCatItems(parsed?.items);
      if (items.length) return save(items, 'siteadmin');
      siteDiag = parsed?.diag ? `宝贝分类页识别明细 ${JSON.stringify(parsed.diag)}` : '宝贝分类页没有识别到分类';
    }
    // ② 兜底：商品发布页「店铺中分类」下拉
    let catId = ID_RE.test(C_str(input.catId)) ? C_str(input.catId) : '';
    if (!catId && Number(input.itemId) > 0) {
      const detail = await repo.detail(Number(input.itemId)).catch(() => null);
      const fromDetail = C_str(detail?.listing?.categoryId || detail?.categoryId || detail?.snapshot?.category_id);
      if (ID_RE.test(fromDetail)) catId = fromDetail;
    }
    const script = shopCatOptionsScript();
    const url = `https://sell.publish.tmall.com/tmall/publish.htm${catId ? `?catId=${catId}` : ''}`;
    let last = { ok: false, code: 'EMPTY', storeId, items: cachedItems, message: siteDiag || '没有读到店铺分类' };
    if (!script) return cachedItems.length ? { ...last, items: cachedItems } : last;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res = null;
      try {
        res = await ctx.probePage({ storeId, url, script, timeoutMs: 45000, waitMs: attempt === 0 ? 3000 : 5000 });
      } catch (error) {
        last = { ok: false, code: 'PROBE_FAILED', storeId, items: cachedItems, message: `读取店铺分类失败：${C_str(error?.message || error).slice(0, 100)}` };
        continue;
      }
      if (res?.reason === 'login') {
        return { ok: false, code: 'LOGIN', storeId, items: cachedItems, message: '店铺登录已失效，读不到店铺分类；请先在「店铺登录」重新登录这家店铺' };
      }
      let parsed = res;
      if (typeof res === 'string') { try { parsed = JSON.parse(res); } catch { parsed = null; } }
      const items = normalizeShopCatItems(parsed?.items);
      if (items.length) return save(items, 'publish');
      last = {
        ok: false, code: parsed?.reason || 'EMPTY', storeId, items: cachedItems,
        message: siteDiag
          ? `${siteDiag}；发布页备用读法也没读到（${parsed?.reason || 'empty'}）`
          : `没读到店铺分类（${parsed?.reason || 'empty'}）；请在店铺后台确认「宝贝分类」里有分类后再点「刷新」`,
      };
    }
    return cachedItems.length ? { ...last, items: cachedItems } : last;
  }

  /** 按 ID 拼完整路径 / 按名称搜叶子类目。 */
  async function lookup(input = {}) {
    const data = await cache();
    const index = indexLevels(data.levels);
    return {
      paths: C_list(input.ids).map(id => pathOf(index, String(id))).filter(Boolean),
      hits: input.keyword ? searchIndex(index, input.keyword) : [],
      total: index.size,
    };
  }

  /** 保存手工选中的叶子类目（必须选到叶子）。 */
  async function save(input = {}) {
    const itemId = Number(input.itemId) || 0;
    const categoryId = C_str(input.categoryId);
    if (!itemId) throw new Error('缺少选品编号');
    if (!ID_RE.test(categoryId)) throw new Error('请先选到最后一级（叶子类目）再保存');
    const categoryPath = C_str(input.categoryPath) || (await lookup({ ids: [categoryId] })).paths[0]?.path || '';
    const result = await repo.applyManualParams(itemId, { categoryId, categoryPath });
    if (editorStore) await editorStore.syncBaseline(itemId, await repo.detail(itemId), true).catch(() => undefined);
    return { ok: true, ...result, categoryPath };
  }

  /** 需要外部 API 才能完整工作的接入点（框架已就位，凭证到位即启用）。 */
  const API_ENDPOINTS = Object.freeze([
    { method: 'taobao.itemcats.get', use: '类目树（店铺后台读不到时的第二来源）', status: 'optional' },
    { method: 'taobao.itemprops.get', use: '按类目读必填/关键属性，生成补全表单字段', status: 'placeholder' },
    { method: 'taobao.itempropvalues.get', use: '属性可选值（下拉选项）', status: 'placeholder' },
    { method: 'tmall.brandcat.control.get', use: '校验店铺是否有该类目发布权限', status: 'placeholder' },
  ]);

  return {
    normalizeCaptureCategory, readSource, children, lookup, save, parseChildren, pathOf, indexLevels, API_ENDPOINTS, CATEGORY_PATH_SEP,
    // 店铺中分类（卖家自定义分类）：设置页读选项 + 上架后回写缓存
    shopCategories, rememberShopCategories, normalizeShopCatItems,
  };
}

module.exports = { createCategoryService, parseChildren, CATEGORY_PATH_SEP, shopCategorySiteScript };
