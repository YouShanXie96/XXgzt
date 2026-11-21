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

  return { normalizeCaptureCategory, readSource, children, lookup, save, parseChildren, pathOf, indexLevels, API_ENDPOINTS, CATEGORY_PATH_SEP };
}

module.exports = { createCategoryService, parseChildren, CATEGORY_PATH_SEP };
