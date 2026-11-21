'use strict';

/**
 * 上品库 · 「商品图片工作台」编辑器数据层
 *
 * 移植来源（老软件 beta.268 静态证据）：
 *   - `dist/main/drawing-bindings-store.js`（211 行）：每件选品的作图绑定
 *     主图编码 / 第5张编码 / SKU 编码、1:1 与 3:4 主图选用、图位顺序与替换、
 *     透明素材图（上架时自动生成 / 现在生成 / 填编码）、白底图、视频、规格图。
 *   - `dist/renderer/assets/index-BAFOuonK.js` 的 `pdw-*` 组件：
 *     8 个图位 tab、规格表（点名称/价格直接改、批量粘贴、批量改价、SKU 模板）、
 *     参数、详情页、恢复采集内容、本机草稿保存。
 *   - `dist/main/main-ipc-product-manage.js:165` `product-manage:edit-images`。
 *
 * 差异：老软件把绑定存 `<userData>/selection-pool/drawing-bindings.v1.json`、草稿存渲染层
 * localStorage 并经 SaaS/NAS 读作图成品；本移植版**全部落新软件本机**
 * `用户数据/selectionpool/editor-drafts.json`（走 ctx.readJson/writeJson 原子写），
 * 不发网络请求、不连 NAS/SaaS。作图成品从采集快照读取；真实回填仍需 driver/API 凭证。
 *
 * 安全：规格名/编码一律做长度与字符白名单；图片来源只认 https、本机 local: 与 drawing:；
 * 换图键与顺序表限长，防目录穿越与注入。
 */

const C = require('./contract');

const FILE = 'selectionpool/editor-drafts.json';

/** 老软件 VIDEO_TYPE_NAMES / ratio 枚举，保持一致。 */
const VIDEO_TYPES = ['宝贝讲解', '真人试吃', '宝贝展示', '制作教程'];
const VIDEO_RATIOS = ['1:1', '3:4', '9:16'];
/**
 * 老软件 SKU_IMAGE_SOURCE：只认 https、本机图片、作图结果三种。
 * 本机图片两种写法都接受：
 *   local:<40位hash>.<ext>      —— 旧格式（素材库按内容哈希命名）
 *   local:<绝对路径>.<ext>      —— 新的「单张图换本机图片」，路径来自主进程文件选择框
 */
const SKU_IMAGE_SOURCE = /^https?:\/\/\S+$|^local:(?:[a-f0-9]{40}\.(?:jpe?g|png|webp)|(?:[A-Za-z]:[\\/]|\/)[^\u0000]{1,400}\.(?:jpe?g|png|webp)(?:\?\S*)?)$|^drawing:[^/\s]{1,200}\/\S{1,300}$/i;

const cleanCode = v => {
  const t = C.trimmed(v).replace(/^#/, '').slice(0, 200);
  return t && !/[\\/\u0000-\u001f]/.test(t) ? t : '';
};
const splitCodes = v => [...new Set(C.str(v).split(/[,，\s、;；]+/).map(cleanCode).filter(Boolean))].slice(0, 20);
const cleanSrc = v => {
  const t = C.str(v).trim().slice(0, 600);
  return SKU_IMAGE_SOURCE.test(t) ? t : '';
};
const cleanKey = v => C.str(v).trim().slice(0, 400);

function cleanVideos(raw) {
  const out = [];
  const seen = new Set();
  for (const row of C.list(raw)) {
    // 采集侧给的是纯 URL 字符串：直接当成「源商品视频」候选，不丢（用户 2026-11-11）。
    if (typeof row === 'string') {
      const url = row.trim();
      if (!/^https:\/\/\S{1,500}$/i.test(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({ kind: 'source', url, type: '宝贝展示' });
      continue;
    }
    const type = VIDEO_TYPES.includes(row?.type) ? row.type : '宝贝展示';
    const ratio = VIDEO_RATIOS.includes(row?.ratio) ? row.ratio : '';
    let video = null;
    // 与老软件 cleanVideos 一致：本机视频只认绝对路径 + mp4/mov/mkv，杜绝任意可执行文件被当视频挂上。
    if (row?.kind === 'local' && /\.(mp4|mov|mkv)$/i.test(C.str(row.file)) && /^([A-Za-z]:[\\/]|\/)/.test(C.str(row.file))) {
      video = { kind: 'local', file: C.str(row.file).slice(0, 1000), name: C.str(row.name).slice(0, 120), type, ratio, duration: Math.max(0, C.int(row.duration)) };
    } else if (row?.kind === 'source' && /^https:\/\/\S{1,500}$/.test(C.str(row.url))) {
      video = { kind: 'source', url: C.str(row.url), type };
    }
    if (!video) continue;
    const key = video.kind === 'local' ? video.file : video.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(video);
  }
  return out.slice(0, 5);
}

function cleanOrders(raw) {
  const out = {};
  for (const key of ['square', 'squareSrc', 'tall']) {
    const list = [...new Set(C.list(raw?.[key]).map(cleanKey).filter(Boolean))].slice(0, 30);
    if (list.length) out[key] = list;
  }
  return out;
}

function cleanReplaced(raw) {
  const out = {};
  for (const group of ['square', 'squareSrc', 'tall', 'sku']) {
    const entries = raw?.[group] && typeof raw[group] === 'object' && !Array.isArray(raw[group]) ? Object.entries(raw[group]) : [];
    const kept = entries.map(([k, v]) => [cleanKey(k), cleanSrc(v)]).filter(([k, v]) => k && v).slice(0, 60);
    if (kept.length) out[group] = Object.fromEntries(kept);
  }
  return out;
}

/**
 * 图位最终图（用户 2026-11-11 第十次要求）：
 *   老软件的商品图片工作台里，1:1 / 3:4 的 5 个图位是「可以拖动换位置、可以单张换成编码的图」的，
 *   之前只存了 order / replaced 两套映射，渲染层又没消费，所以看起来点了没用。
 *   现在直接存「图位上最终是哪张图」：slotImages[group] = [url 或 local:路径, …]。
 *   ★ 按下标保留位置（空位写空字符串），否则「只换第 3 张」会变成「换到第 1 张」。
 */
function cleanSlotImages(raw) {
  const out = {};
  for (const group of ['square', 'squareSrc', 'tall']) {
    const arr = C.list(raw?.[group]).slice(0, 5).map(v => cleanSrc(v) || '');
    while (arr.length && !arr[arr.length - 1]) arr.pop();
    if (arr.length) out[group] = arr;
  }
  return out;
}

function cleanSkuImages(raw) {  const seen = new Set();
  return C.list(raw)
    .map((r, index) => {
      // 采集侧给的是纯 URL：补一个可读名字，别让规格图在 normalize 时被清空（用户 2026-11-11）。
      if (typeof r === 'string') return { name: `采集规格图 ${index + 1}`, src: cleanSrc(r) };
      return { name: C.str(r?.name).trim().slice(0, 128), src: cleanSrc(r?.src) };
    })
    .filter(r => r.name && r.src && !seen.has(r.name) && Boolean(seen.add(r.name)))
    .slice(0, 100);
}

/** 规格表行：与老软件 SKU 行字段一致（key/name/price/stock/image/removed/template/added/facts/outerId）。 */
/** 本机成品图路径：只认 selectionpool/drawing/ 下的相对路径，防目录穿越。 */
function cleanLocalImages(raw) {
  return C.strList(raw).map(p => C.str(p).trim().replace(/\\/g, '/')).filter(t =>
    t.startsWith('selectionpool/drawing/') && !t.includes('..') && /\.(jpg|jpeg|png|webp)$/i.test(t)
  ).slice(0, 40);
}

/** 详情图来源标记：0..39 的下标 -> collect（采集）/ drawing（作图）。 */
function cleanSources(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw).slice(0, 40)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < 40 && ['collect', 'drawing'].includes(String(value))) {
      out[String(index)] = String(value);
    }
  }
  return out;
}

function cleanSkuRows(raw) {
  return C.list(raw).slice(0, 600).map((r, index) => {
    const price = C.str(r?.price).trim();
    const stock = C.str(r?.stock).trim();
    return {
      key: C.str(r?.key).slice(0, 120) || `src-${index + 1}`,
      name: C.str(r?.name).trim().slice(0, 128),
      price: /^\d{1,8}(?:\.\d{1,2})?$/.test(price) ? price : '',
      stock: /^\d{1,6}$/.test(stock) ? stock : '',
      image: cleanSrc(r?.image),
      outerId: C.str(r?.outerId).slice(0, 60),
      starred: r?.starred === true,
      removed: r?.removed === true,
      added: r?.added === true,
      template: r?.template === true,
      sourceSkuId: C.str(r?.sourceSkuId).slice(0, 60),
      origin: C.str(r?.origin).slice(0, 200),
      originalName: C.str(r?.originalName).slice(0, 128),
      originalPrice: C.str(r?.originalPrice).slice(0, 20),
    };
  });
}

/** 参数（商品属性）：keyProp/catProp 等锁定项不可编辑，其余可改。 */
function cleanAttrs(raw) {
  return C.list(raw).slice(0, 200).map(r => ({
    name: C.str(r?.name).slice(0, 120),
    value: C.str(r?.value).slice(0, 500),
    locked: r?.locked === true,
    ui: ['input', 'number', 'select', 'combobox', 'radio', 'checkbox', 'taoSirProp', 'shopCategory', 'textarea'].includes(r?.ui) ? r.ui : 'input',
  }));
}

function emptyDraft(itemId, productId = '') {
  return {
    itemId: C.int(itemId), productId,
    // 编码区（老软件：主图 8 位、第 5 张 6 位、SKU 多个逗号/空格分隔）
    mainCode: '', fifthCode: '', skuCode: '',
    // 主图选用：1:1 用 ai 作图成品 / src 采集原图；3:4 用 ai 作图成品 / keep 不提交
    useSquare: 'ai', useTall: 'ai',
    // 素材图：上架时自动生成 / 现在生成 / 填编码
    transMode: 'auto', transCode: '', transFile: '', transOpaque: false,
    whiteMode: 'auto', whiteCode: '', whiteFile: '', whiteOffWhite: false,
    skuImages: [],    // AI作图 回流到本机的成品图（相对 用户数据/ 的路径）
    squareAiImages: [], tallAiImages: [], tallSrcImages: [],
    materialImages: [],
    orders: {}, replaced: {}, videos: [],
    // 图位最终图（可拖动排序 / 单张换编码图），见 cleanSlotImages 注释
    slotImages: {},
    // 规格表 / 参数 / 详情页 / 手工类目（本机草稿，可「恢复采集内容」）
    skus: [], attrs: [],
    detail: '', detailCode: '', detailImages: [], detailImageSources: {}, detailEdited: false,
    title: '', categoryId: '', categoryPath: '', categoryCustom: false,
    paramEdits: 0, specEdited: false,
    // 素材图来源（auto 自动生成 / local 本机上传 / code 填编码）
    transSource: 'auto', whiteSource: 'auto',
    // 回填目标勾选（仓库商品 warehouseItemId 列表）
    selectedTargets: [],
    // 批量改价规则：同行价 × factor [减/加] amount 元
    reprice: { factor: '1', amount: '3', direction: 'subtract' },
    materialsCustom: false,
    savedAt: '', updatedAt: '',
  };
}

function normalize(raw, itemId, productId = '') {
  const base = emptyDraft(itemId, productId);
  const r = raw && typeof raw === 'object' ? raw : {};
  const reprice = r.reprice && typeof r.reprice === 'object' ? r.reprice : {};
  return {
    ...base,
    mainCode: cleanCode(r.mainCode), fifthCode: cleanCode(r.fifthCode), skuCode: cleanCode(r.skuCode),
    useSquare: r.useSquare === 'src' ? 'src' : 'ai',
    useTall: r.useTall === 'keep' ? 'keep' : 'ai',
    transMode: ['generated', 'code'].includes(r.transMode) ? r.transMode : 'auto',
    transCode: cleanCode(r.transCode), transFile: C.str(r.transFile).slice(0, 1000), transOpaque: r.transOpaque === true,
    whiteMode: r.whiteMode === 'custom' ? 'custom' : 'auto',
    whiteCode: cleanCode(r.whiteCode), whiteFile: C.str(r.whiteFile).slice(0, 1000), whiteOffWhite: r.whiteOffWhite === true,
    skuImages: cleanSkuImages(r.skuImages),
    squareAiImages: cleanLocalImages(r.squareAiImages),
    tallAiImages: cleanLocalImages(r.tallAiImages),
    tallSrcImages: C.strList(r.tallSrcImages).slice(0, 5),
    materialImages: C.strList(r.materialImages).slice(0, 20),
    orders: cleanOrders(r.orders), replaced: cleanReplaced(r.replaced), videos: cleanVideos(r.videos),
    slotImages: cleanSlotImages(r.slotImages),
    skus: cleanSkuRows(r.skus), attrs: cleanAttrs(r.attrs),
    detail: C.str(r.detail).slice(0, 60000),
    detailCode: cleanCode(r.detailCode),
    detailImages: C.strList(r.detailImages).slice(0, 40),
    detailImageSources: cleanSources(r.detailImageSources),
    detailEdited: r.detailEdited === true,
    title: C.str(r.title).slice(0, 500), categoryId: C.str(r.categoryId).slice(0, 60), categoryPath: C.str(r.categoryPath).slice(0, 300),
    categoryCustom: r.categoryCustom === true,
    paramEdits: Math.max(0, C.int(r.paramEdits)), specEdited: r.specEdited === true,
    transSource: ['local', 'code'].includes(r.transSource) ? r.transSource : 'auto',
    whiteSource: ['local', 'code'].includes(r.whiteSource) ? r.whiteSource : 'auto',
    selectedTargets: [...new Set(C.strList(r.selectedTargets).map(v => v.slice(0, 64)))].slice(0, 40),
    reprice: {
      factor: /^\d{1,4}(?:\.\d{1,2})?$/.test(C.str(reprice.factor)) ? C.str(reprice.factor) : '1',
      amount: /^\d{1,8}(?:\.\d{1,2})?$/.test(C.str(reprice.amount)) ? C.str(reprice.amount) : '3',
      direction: reprice.direction === 'add' ? 'add' : 'subtract',
    },
    materialsCustom: r.materialsCustom === true,
    savedAt: C.str(r.savedAt), updatedAt: C.str(r.updatedAt),
  };
}

/** 从采集快照构造「原始内容」（恢复采集内容 / 首次打开时用）。 */
function draftFromDetail(detail) {
  const itemId = C.int(detail?.itemId);
  const product = detail?.product || {};
  const draft = emptyDraft(itemId, C.str(product.id));
  // 规格价采集不到时用商品采集价兜底（老软件同样把商品价顶到每个规格上）：
  // 否则规格表价格全空，批量改价「改 0 条」，上架也没价可用（用户 2026-11-11）。
  const fallbackPrice = product.priceFen != null && Number.isFinite(Number(product.priceFen))
    ? (Number(product.priceFen) / 100).toFixed(2)
    : '';
  const priceOf = s => (s?.priceFen != null ? (Number(s.priceFen) / 100).toFixed(2) : fallbackPrice);
  const skus = C.list(detail?.skus).map((s, index) => ({
    key: C.str(s?.id) || `src-${index + 1}`,
    name: C.list(s?.specs).map(p => C.str(p?.value)).filter(Boolean).join(' / ') || `规格 ${index + 1}`,
    price: priceOf(s),
    // 老软件：采集规格默认库存 1000，用户可在规格表里改（截图里每行都是「库存 1000」）。
    stock: C.str(s?.stockText) || '1000',
    image: C.str(s?.imageUrl),
    sourceSkuId: C.str(s?.id) || `src-${index + 1}`,
    originalName: C.list(s?.specs).map(p => C.str(p?.value)).filter(Boolean).join(' / '),
    originalPrice: priceOf(s),
  }));
  draft.skus = cleanSkuRows(skus);
  draft.attrs = cleanAttrs(C.list(detail?.attributes).map(a => ({ name: a?.name, value: a?.value, locked: false, ui: 'input' })));
  draft.detail = C.str(detail?.description?.text);
  draft.detailImages = C.strList(detail?.description?.images).slice(0, 40);
  // 3:4 主图 / SKU 图 / 视频：采集页带回的原图（用户 2026-11-11 第六次反馈）。
  // 与 AI 作图成品分开存，编辑器左侧「采集原图」与 tab 计数都能直接用。
  draft.tallSrcImages = C.strList(detail?.tallImages).slice(0, 5);
  draft.skuImages = C.strList(detail?.skuImages ?? detail?.sku_images).slice(0, 40);
  // 采集到的商品视频按「源视频」对象存，前面 cleanVideos 认 kind=source，不能让字符串被清掉。
  draft.videos = C.strList(detail?.videos).slice(0, 10).map(url => ({ kind: 'source', url, type: '宝贝展示' }));
  draft.materialImages = C.strList(detail?.materialImages ?? detail?.material_images).slice(0, 20);
  draft.detailImageSources = Object.fromEntries(draft.detailImages.map((_, i) => [String(i), 'collect']));
  draft.title = C.str(product.title);
  draft.categoryId = C.str(detail?.categoryId);
  draft.categoryPath = C.str(detail?.categoryPath);
  return draft;
}

function createEditorStore(ctx) {
  async function readAll() {
    const data = await ctx.readJson(FILE, { schemaVersion: 2, drafts: {} });
    return {
      schemaVersion: 2,
      drafts: data?.drafts && typeof data.drafts === 'object' ? data.drafts : {},
    };
  }
  const writeAll = db => ctx.writeJson(FILE, db);

  async function get(itemId) {
    const db = await readAll();
    const key = String(C.int(itemId));
    return db.drafts[key] ? normalize(db.drafts[key], itemId) : null;
  }

  /**
   * 首次打开编辑器时把「采集基线」落盘。
   * 否则后续 editorPatch / editorCodes 读到的是空草稿，会把规格表、参数、详情图覆盖掉。
   * 不写 savedAt —— 只有用户点「保存」才算正式草稿。
   */
  async function ensure(itemId, detail) {
    const existing = await get(itemId);
    if (existing) return { draft: existing, isFirst: false };
    const fresh = draftFromDetail(detail);
    const db = await readAll();
    db.drafts[String(C.int(itemId))] = fresh;
    await writeAll(db);
    return { draft: fresh, isFirst: true };
  }

  /**
   * 重新采集后同步「采集基线」：用户还没手动改过参数 / 规格 / 类目时，
   * 用新采集包里的属性、规格、类目覆盖草稿，否则新参数会永远显示为空。
   */
  async function syncBaseline(itemId, detail, attrsOnly = false) {
    const db = await readAll();
    const key = String(C.int(itemId));
    if (!db.drafts[key]) return null;
    const current = normalize(db.drafts[key], itemId);
    const untouched = attrsOnly || (!current.paramEdits && !current.specEdited && !current.categoryCustom && !current.savedAt);
    if (!untouched) return current;
    const fresh = draftFromDetail(detail);
    const next = normalize({
      ...current,
      attrs: fresh.attrs,
      categoryId: fresh.categoryId,
      categoryPath: fresh.categoryPath,
      ...(attrsOnly ? {} : {
        skus: fresh.skus,
        detail: fresh.detail,
        detailImages: fresh.detailImages,
        detailImageSources: fresh.detailImageSources,
        tallSrcImages: fresh.tallSrcImages,
        skuImages: fresh.skuImages,
        videos: fresh.videos,
        title: fresh.title,
      }),
    }, itemId);
    db.drafts[key] = next;
    await writeAll(db);
    return next;
  }

  /** 部分更新：patch 里的未知字段一律丢弃。 */
  async function save(itemId, productId, patch = {}) {
    const db = await readAll();
    const key = String(C.int(itemId));
    const current = db.drafts[key] ? normalize(db.drafts[key], itemId) : emptyDraft(itemId, productId);
    const allowed = {};
    const keys = [
      'mainCode', 'fifthCode', 'skuCode', 'useSquare', 'useTall',
      'transMode', 'transCode', 'transFile', 'transOpaque', 'whiteMode', 'whiteCode', 'whiteFile', 'whiteOffWhite',
      'skuImages', 'squareAiImages', 'tallAiImages', 'tallSrcImages', 'orders', 'replaced', 'videos', 'skus', 'attrs',
      'slotImages',
      'detail', 'detailCode', 'detailImages', 'detailImageSources', 'detailEdited',
      'title', 'categoryId', 'categoryPath', 'categoryCustom', 'paramEdits', 'specEdited',
      'transSource', 'whiteSource', 'selectedTargets', 'reprice', 'materialsCustom',
    ];
    for (const k of keys) if (Object.prototype.hasOwnProperty.call(patch, k)) allowed[k] = patch[k];
    const next = normalize({ ...current, ...allowed, productId: productId || current.productId, updatedAt: new Date().toISOString() }, itemId);
    db.drafts[key] = next;
    await writeAll(db);
    return next;
  }

  /** 老软件「本机草稿已保存」：只有点保存才写 savedAt。 */
  async function markSaved(itemId, productId = '') {
    const db = await readAll();
    const key = String(C.int(itemId));
    const current = db.drafts[key] ? normalize(db.drafts[key], itemId) : emptyDraft(itemId, productId);
    const at = new Date().toISOString();
    current.savedAt = at; current.updatedAt = at;
    db.drafts[key] = current;
    await writeAll(db);
    return current;
  }

  /** 老软件「恢复采集内容」：清除本机草稿，回到采集快照。 */
  async function restore(itemId, detail) {
    const db = await readAll();
    const key = String(C.int(itemId));
    const fresh = draftFromDetail(detail);
    fresh.savedAt = ''; fresh.updatedAt = '';
    db.drafts[key] = fresh;
    await writeAll(db);
    return fresh;
  }

  /** 删除选品时清理对应草稿。 */
  async function remove(itemIds) {
    const db = await readAll();
    for (const id of C.list(itemIds)) delete db.drafts[String(C.int(id))];
    await writeAll(db);
  }

  return { get, ensure, syncBaseline, save, markSaved, restore, remove, normalize, draftFromDetail, emptyDraft, FILE };
}

module.exports = {
  createEditorStore, normalize, emptyDraft, draftFromDetail,
  cleanCode, splitCodes, cleanSkuRows, cleanVideos, VIDEO_TYPES, VIDEO_RATIOS,
};
