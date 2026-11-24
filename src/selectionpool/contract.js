'use strict';

/**
 * 上品库 · 本地契约（schema_version 2）
 *
 * 移植来源：老软件 `dist/main/selection-pool-contract.js`（247 行）、
 * `selection-pool-service.js` 的 toRow / buildDetailView（99–273 行）、
 * `selection-pool-export.js`（40 行）、`shared/pool-publish-outcomes.js`。
 * 差异：原契约绑定 SaaS `https://spgl.zgytp.com/api/selection-pool/v1/`，
 * 本移植版**不发出任何网络请求**，字段与枚举保持一一对应，数据落新软件本地仓库。
 *
 * 本模块为纯逻辑：不 require electron / node:fs，可直接被主进程与单测引用。
 */

const SCHEMA_VERSION = 2;

/** 与老软件一致，另补 1688（插件侧支持四端）。 */
const PLATFORMS = ['taobao', 'tmall', '1688'];
const PLATFORM_LABELS = { taobao: '淘宝', tmall: '天猫', '1688': '1688' };

/** 只影响展示，不裁剪原始采集包（老软件设计约束，勿改）。 */
const DISPLAY_LIMITS = Object.freeze({
  images: 30,
  descriptionImages: 200,
  skus: 1000,
  attributes: 200,
  reviews: 50,
  reviewImages: 20,
  skuPropertyDimensions: 12,
  skuPropertyValues: 200,
});

/** 老软件 `selection-pool-export.js` 的 12 列表头，保持一模一样。 */
const CSV_HEADERS = [
  '选品ID', '商品ID', '平台', '标题', '店铺', '采集价',
  '分组', '标签', '归属人', '团队', '加入时间', '商品链接',
];

/**
 * 流程状态机（老软件渲染层 + 报告 §6.2）：
 *   todraw 待作图 → drawing 作图中 → tolist 待上架 → landed 已入仓
 *   → tofill 待回填 → done 已完成；publishFailed 为上架失败分支。
 * 截图「流程」列三步圆点：① 作图 ② 已入仓／上架失败 ③ 已回填。
 */
const FLOW_STATES = Object.freeze({
  TODRAW: 'todraw',
  DRAWING: 'drawing',
  TOLIST: 'tolist',
  LANDED: 'landed',
  TOFILL: 'tofill',
  DONE: 'done',
  PUBLISH_FAILED: 'publishFailed',
});

const FLOW_LABELS = Object.freeze({
  todraw: '待作图', drawing: '作图中', tolist: '待上架',
  landed: '已入仓', tofill: '待回填', done: '已完成',
  publishFailed: '上架失败',
});

/** 流程列三段（与截图一致）。 */
const PIPELINE_STEPS = Object.freeze([
  { id: 'draw', label: '作图' },
  { id: 'publish', label: '已入仓' },
  { id: 'backfill', label: '已回填' },
]);

/**
 * 图位级回填状态（老软件 §6.2：状态机是图位级不是整单级）。
 * 「选图已变化待重新回填」是防错发的关键状态，务必保留。
 */
const SLOT_STATES = Object.freeze({
  TOFILL: 'tofill',
  FILLING: 'filling',
  FILLED: 'filled',          // 已回填 · 回读一致
  CHANGED: 'changed',        // 选图已变化，待重新回填
  FAILED: 'failed',
});

const SORT_VALUES = new Set(['newest', 'oldest', 'price_asc', 'price_desc']);
const PAGE_SIZES = new Set([50, 100, 200]);

/** 上架/回填失败原因归类（老软件 pool-publish-outcomes.js）。 */
const FAILURE_PATTERNS = Object.freeze([
  [/没有这个类目授权|商品类目未授权/, '没有这个类目授权', 'CATEGORY_NOT_AUTHORIZED'],
  [/CATEGORY_MAPPING_MISMATCH|类目.*不一致|类目.*不匹配/, '发布类目与商品类目不一致', 'CATEGORY_MAPPING_MISMATCH'],
  [/包含产品缺少源参数/, 'SKU「包含产品」资料未填完整', 'MISSING_SOURCE_PRODUCT_FACTS'],
  [/生产日期.*必填|生产日期.*未填|生产日期.*为空/, '生产日期未填写', 'PRODUCTION_DATE_REQUIRED'],
  [/口味不能为空|口味.*未填/, 'SKU口味未填写', 'FLAVOR_REQUIRED'],
  [/滑动|验证码|访问过快|频繁|punish|slider|captcha|rate-limited/i, '需要人工验证，队列已停止', 'NEEDS_MANUAL_VERIFICATION'],
]);

function classifyFailure(message = '') {
  const text = String(message || '');
  for (const [pattern, summary, code] of FAILURE_PATTERNS) {
    if (pattern.test(text)) return { code, summary };
  }
  return { code: 'PUBLISH_FAILED', summary: String(text).replace(/^\s*(?:失败|上架填充失败|上传失败|Error)\s*[:：]\s*/, '').slice(0, 200) || '上架失败' };
}

/** 继续入仓时这些结果不算上品失败（老软件 RESUME_NOT_A_FAILURE）。 */
const RESUME_NOT_A_FAILURE = /^(?:PAGE_MISMATCH|NOT_FOUND|NO_SHOP_SESSION|PUBLISH_BUSY)$/;

const str = v => (typeof v === 'string' ? v : '');
const trimmed = v => str(v).trim();
const int = v => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const numOrNull = v => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const list = v => (Array.isArray(v) ? v : []);
const strList = v => list(v).filter(x => typeof x === 'string');
const splitTags = v => {
  if (Array.isArray(v)) return v.map(x => trimmed(x)).filter(Boolean).slice(0, 40);
  return trimmed(v).split(/[,，;；\s]+/).filter(Boolean).slice(0, 40);
};
const asMap = v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
    .map(([key, value]) => [String(key).slice(0, 80), String(value).slice(0, 500)]));
};

/**
 * 列表行（与老软件 toRow 字段一一对应，新增 flow / slots / listing 三个本地扩展）。
 * 保持 snake_case 入参兼容老插件的采集包（schema_version 2）。
 */
function toRow(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    itemId: int(r.id || r.itemId),
    productId: str(r.product_id || r.productId),
    sku: str(r.sku || r.sku_id || r.skuId),
    platform: str(r.platform) || 'taobao',
    title: str(r.title),
    imageUrl: str(r.image_url || r.imageUrl),
    productUrl: str(r.product_url || r.productUrl),
    shopName: str(r.shop_name || r.shopName),
    priceFen: numOrNull(r.price_fen ?? r.priceFen),
    priceLabel: str(r.price_label || r.priceLabel),
    collectedAt: str(r.collected_at || r.collectedAt),
    addedAt: str(r.added_at || r.addedAt),
    groupName: str(r.group_name || r.groupName),
    tags: splitTags(r.tags),
    note: str(r.note),
    version: int(r.version) || 1,
    ownerUserId: str(r.owner_user_id || r.ownerUserId),
    ownerName: str(r.owner_name || r.ownerName),
    teamName: str(r.team_name || r.teamName),
    aiTitle: str(r.ai_title || r.aiTitle),
    aiDescription: str(r.ai_description || r.aiDescription),
    aiMainImages: strList(r.ai_main_images || r.aiMainImages),
    aiSkuImages: strList(r.ai_sku_images || r.aiSkuImages),
    // ---- 本地扩展：流程与上架信息 ----
    flow: normalizeFlow(r.flow || r.flow_state),
    slots: list(r.slots).slice(0, DISPLAY_LIMITS.images).map(normalizeSlot),
    listing: normalizeListing(r.listing),
    warehouseItemId: str(r.warehouse_item_id || r.warehouseItemId),
    shopProfileId: str(r.shop_profile_id || r.shopProfileId),
    shopId: str(r.shop_id || r.shopId),
  };
}

function normalizeFlow(value) {
  const v = str(value);
  return Object.prototype.hasOwnProperty.call(FLOW_LABELS, v) ? v : FLOW_STATES.TODRAW;
}

function normalizeSlot(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const state = str(s.state);
  return {
    id: str(s.id).slice(0, 80),
    kind: ['main', 'sku', 'white', 'detail'].includes(s.kind) ? s.kind : 'main',
    label: str(s.label).slice(0, 120),
    imageUrl: str(s.imageUrl || s.image_url),
    state: Object.values(SLOT_STATES).includes(state) ? state : SLOT_STATES.TOFILL,
    readbackCount: int(s.readbackCount) || 0,
    expectedCount: int(s.expectedCount) || 0,
    updatedAt: str(s.updatedAt),
  };
}

/** 上架信息（上品库内可编辑的部分，老软件快照 + 表单编辑字段）。 */
function normalizeListing(raw) {
  const l = raw && typeof raw === 'object' ? raw : {};
  return {
    categoryPath: str(l.categoryPath || l.category_path),
    categoryId: str(l.categoryId || l.category_id),
    brand: str(l.brand),
    subtitle: str(l.subtitle),
    title: str(l.title),
    priceFen: numOrNull(l.priceFen ?? l.price_fen),
    priceMultiplier: numOrNull(l.priceMultiplier) ?? 1,
    priceReductionFen: numOrNull(l.priceReductionFen) ?? 300, // 截图默认「同行价 ×1 减 3 元」
    stock: int(l.stock),
    attributes: list(l.attributes).slice(0, DISPLAY_LIMITS.attributes)
      .map(a => ({ name: str(a?.name).slice(0, 120), value: str(a?.value).slice(0, 500) })),
    skus: list(l.skus).slice(0, DISPLAY_LIMITS.skus).map(s => ({
      id: str(s?.id),
      imageUrl: str(s?.imageUrl || s?.image_url),
      specs: list(s?.specs || s?.properties).map(p => ({ name: str(p?.name), value: str(p?.value) })),
      priceFen: numOrNull(s?.priceFen ?? s?.price_fen),
      stock: int(s?.stock),
    })),
    images: strList(l.images).slice(0, DISPLAY_LIMITS.images),
    detailImages: strList(l.detailImages || l.detail_images).slice(0, DISPLAY_LIMITS.descriptionImages),
    videoUrl: str(l.videoUrl || l.video_url),
    description: str(l.description).slice(0, 60000),
  };
}

/**
 * 详情视图（与老软件 buildDetailView 字段一致）。
 * 兼容老插件采集包 `snapshot` 结构与本地扁平结构。
 */
function buildDetailView(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const snap = item.snapshot && typeof item.snapshot === 'object' ? item.snapshot : {};
  const desc = snap.description && typeof snap.description === 'object' ? snap.description : {};
  const price = snap.price && typeof snap.price === 'object' ? snap.price : {};
  const source = snap.source && typeof snap.source === 'object' ? snap.source : {};
  const attributes = list(snap.attributes).map(a => ({ name: str(a?.name), value: str(a?.value) }));

  // 老软件 P5-saas-chinese-category：合成类目路径（纯数字 / 根类目N / 叶子类目M）视为无效，
  // 回退到「商品参数」里的类目路径 / 类目 ID。
  let categoryPath = str(snap.category_path);
  let categoryId = str(snap.category_id);
  const synthetic = t => !t || /旗舰店|专营店|专卖店|企业店|好评|评分|进店|客服/.test(t) || /^\d+$/.test(t.trim()) || /^类目\s*\d+$/.test(t.trim()) || /根类目\s*\d+|叶子类目\s*\d+/.test(t) || !/[\u4e00-\u9fa5]/.test(t);
  if (!categoryPath || !categoryId) {
    for (const a of attributes) {
      if (!categoryPath && ['类目路径', '类目', 'category_path', 'breadcrumb'].includes(a.name)) categoryPath = a.value;
      if (!categoryId && (/类目\s*ID/i.test(a.name) || /category_?id/i.test(a.name) || ['叶子类目ID', 'leaf_id', 'leafId'].includes(a.name))) categoryId = a.value;
    }
  }
  if (synthetic(categoryPath)) categoryPath = '';

  const row = toRow(item);
  return {
    itemId: row.itemId,
    version: row.version,
    ownerName: row.ownerName,
    teamName: row.teamName,
    addedAt: row.addedAt,
    product: {
      id: row.productId, platform: row.platform, title: row.title,
      shopName: row.shopName, priceFen: row.priceFen, priceLabel: row.priceLabel,
      imageUrl: row.imageUrl, productUrl: row.productUrl, collectedAt: row.collectedAt,
    },
    images: strList(snap.images),
    // 3:4 主图 / SKU 图 / 视频（用户 2026-11-11 第六次反馈：这三类一直为 0）
    tallImages: strList(snap.tall_images || snap.tallImages).slice(0, DISPLAY_LIMITS.descriptionImages),
    skuImages: strList(snap.sku_images || snap.skuImages).slice(0, DISPLAY_LIMITS.descriptionImages),
    videos: strList(snap.videos).slice(0, 10),
    materialImages: strList(snap.material_images || snap.materialImages).slice(0, 20),
    videoUrl: str(snap.video_url || (strList(snap.videos)[0])),
    videoPoster: str(snap.video_poster || snap.videoPoster),
    categoryPath, categoryId,
    categoryLevels: strList(snap.category_levels || snap.categoryLevels).slice(0, 6),
    brand: str(snap.brand),
    subtitle: str(snap.subtitle),
    price: {
      originalFen: numOrNull(price.original_fen), promotionFen: numOrNull(price.promotion_fen),
      promotionLabel: str(price.promotion_label), conditions: str(price.conditions),
    },
    shop: {
      ...asMap(snap.shop),
      // 店铺评分是数组（综合 / 宝贝质量 / 物流速度 / 服务保障），asMap 只留标量，这里单独补上。
      scores: list(snap.shop?.scores).map(s => ({ name: str(s?.name).slice(0, 20), value: str(s?.value).slice(0, 12) })).slice(0, 6),
    },
    shipping: asMap(snap.shipping),
    services: strList(snap.services), sales: asMap(snap.sales),
    skus: list(snap.skus).map(s => ({
      id: str(s?.id), imageUrl: str(s?.image_url),
      specs: list(s?.properties).map(p => ({ name: str(p?.name), value: str(p?.value) })),
      priceFen: numOrNull(s?.price_fen), promotionFen: numOrNull(s?.promotion_fen),
      stockText: str(s?.stock_text), availability: str(s?.availability),
    })),
    skuProperties: list(snap.sku_properties).map(p => ({
      pid: str(p?.pid), pname: str(p?.pname),
      values: list(p?.values).map(v => ({ vid: str(v?.vid), vname: str(v?.vname), image: str(v?.image) })),
    })),
    attributes,
    description: { text: str(desc.text), images: strList(desc.images) },
    reviews: list(snap.reviews).map(r => ({ content: str(r?.content), images: strList(r?.images) })),
    source: Object.fromEntries(Object.entries(source)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || v === null)
      .map(([k, v]) => [k, v])),
    history: list(item.capture_history).map(h => ({
      id: int(h?.id), collectedAt: str(h?.collected_at), receivedAt: str(h?.received_at),
    })),
    organization: { group: row.groupName, tags: row.tags, note: row.note },
    ai: { title: row.aiTitle, description: row.aiDescription, mainImages: row.aiMainImages, skuImages: row.aiSkuImages },
    // 本地扩展
    listing: row.listing, flow: row.flow, slots: row.slots,
    warehouseItemId: row.warehouseItemId,
    snapshotError: item.snapshot_error === true,
  };
}

/** 定价：截图「上架价格 = 同行价 × 倍率 − 固定减免」。 */
function computeListingPrice(peerPriceFen, listing) {
  const base = numOrNull(peerPriceFen);
  if (base === null) return null;
  const multiplier = numOrNull(listing?.priceMultiplier) ?? 1;
  const reduction = numOrNull(listing?.priceReductionFen) ?? 0;
  const result = Math.round(base * multiplier - reduction);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

/**
 * CSV 行构造（老软件防公式注入 + BOM + 双引号转义，一模一样）。
 * 返回 Buffer；若字段非法抛错。
 */
function buildCsvBuffer(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 200) throw new Error('请导出当前页的 1–200 条选品');
  const csvRows = [CSV_HEADERS, ...rows.map(row => {
    if (!Array.isArray(row) || row.length !== CSV_HEADERS.length) throw new Error('选品导出列数不正确');
    return row.map(value => {
      if (value == null) return '';
      if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('选品导出内容不正确');
      const text = String(value);
      if (text.length > 32767) throw new Error('选品导出内容过长');
      return typeof value === 'string' && /^\s*[=+@-]/.test(text) ? `'${text}` : text;
    });
  })];
  const contents = Buffer.from('\uFEFF' + csvRows
    .map(row => row.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'utf8');
  if (contents.length > 16 * 1024 * 1024) throw new Error('当前页导出文件过大');
  return contents;
}

function rowToCsv(row) {
  return [
    row.itemId, row.productId, PLATFORM_LABELS[row.platform] || row.platform,
    row.title, row.shopName, row.priceLabel || (row.priceFen != null ? (row.priceFen / 100).toFixed(2) : ''),
    row.groupName, row.tags.join('、'), row.ownerName, row.teamName, row.addedAt, row.productUrl,
  ];
}

/* ==========================================================================
 * 「商品图片工作台」编辑器辅助逻辑（移植自老软件渲染层 pdw-* 组件）
 * ========================================================================== */

/**
 * 批量改价：同行价 × factor [减/加] amount 元。
 * 老软件 Oz() 的语义：只改「价格仍等于采集原价」的行，
 * 用户在商品工作台单独改过价的行保留（kept）；改完价 ≤0 的保留同行价（invalid）。
 */
function repriceSkus(skus, rule = {}, originals = null) {
  const factor = Number(rule.factor);
  const amount = Number(rule.amount);
  const direction = rule.direction === 'add' ? 1 : -1;
  if (!Number.isFinite(factor) || !Number.isFinite(amount)) {
    return { skus, summary: { changed: 0, kept: 0, invalid: 0 }, formula: '' };
  }
  const summary = { changed: 0, kept: 0, invalid: 0 };
  const out = list(skus).map((row, index) => {
    const peer = Number(row.price);
    const original = originals?.[index] != null ? Number(originals[index]) : Number(row.originalPrice);
    // 用户单独改过价的保留
    if (Number.isFinite(original) && Number.isFinite(peer) && Math.abs(peer - original) > 0.001) {
      summary.kept += 1; return row;
    }
    if (!Number.isFinite(peer) || peer <= 0) { summary.kept += 1; return row; }
    const next = Math.round((peer * factor + direction * amount) * 100) / 100;
    if (!Number.isFinite(next) || next <= 0) { summary.invalid += 1; return row; }
    summary.changed += 1;
    return { ...row, price: next.toFixed(2) };
  });
  const formula = `同行价 × ${factor}${amount ? ` ${direction < 0 ? '减' : '加'} ${amount} 元` : ''}`;
  return { skus: out, summary, formula };
}

function describeReprice(formula, summary) {
  return [
    `${formula}，改 ${summary.changed} 条规格的价格`,
    summary.kept ? `${summary.kept} 条按商品工作台保存的价格` : '',
    summary.invalid ? `${summary.invalid} 条改价后不大于 0，保留同行价` : '',
  ].filter(Boolean).join('；');
}

/**
 * 批量粘贴：从 Excel / 聊天里复制「规格名 价格」，一行一个，自动识别。
 * 支持 Tab、多个空格、中文逗号、全角空格分隔；末尾数字（可带 ¥）当价格。
 */
function parsePastedSkus(text) {
  const rows = [];
  for (const raw of String(text || '').split(/[\r\n]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(.*?)[\t,，、\s]+[¥￥]?(\d{1,8}(?:\.\d{1,2})?)\s*$/);
    if (match && match[1].trim()) {
      rows.push({ name: match[1].trim().slice(0, 128), price: match[2], added: true });
    } else {
      rows.push({ name: line.slice(0, 128), price: '', added: true });
    }
    if (rows.length >= 600) break;
  }
  return rows;
}

/** SKU 模板：宣传规格插到最上面，价格与包含产品跟第一条真实规格，默认库存 1000。 */
function buildTemplateRows(preset, firstRealSku) {
  const names = list(preset).map(v => str(v).trim()).filter(Boolean).slice(0, 20);
  const price = str(firstRealSku?.price || firstRealSku?.originalPrice || '');
  return names.map((name, index) => ({
    key: `tpl-${Date.now()}-${index}`,
    name: name.slice(0, 128),
    price,
    stock: '1000',
    image: '',
    template: true,
    added: true,
    sourceSkuId: str(firstRealSku?.sourceSkuId || firstRealSku?.key || ''),
    originalName: '',
    originalPrice: price,
  }));
}

/** 规格名重复检测（老软件：上架时后面那条自动加「（规格N）」区分，不用改名）。 */
function duplicateSkuNames(skus) {
  const seen = new Map();
  const duplicates = new Set();
  for (const row of list(skus)) {
    if (row.removed) continue;
    const name = str(row.name).trim();
    if (!name) continue;
    if (seen.has(name)) duplicates.add(name);
    else seen.set(name, true);
  }
  return [...duplicates];
}

/** 图位 tab 计数（与截图 8 个 tab 顺序一致）。 */
function editorTabs(detail, draft) {
  const d = draft || {};
  const squareAi = strList(d.squareAiImages);
  const squareSrc = strList(detail?.images);
  // 3:4：AI 作图成品 + 采集页拿到的 3:4 竖版主图都算（第六次反馈：采集有图时 tab 仍是 0）
  const tall = [...strList(d.tallAiImages), ...strList(detail?.tallImages)];
  const skuDraftImages = list(d.skus).map(s => str(s?.image)).filter(Boolean);
  const skuImages = [...new Set([...strList(d.skuImages ?? detail?.skuImages), ...skuDraftImages])];
  // 采集视频（字符串）与草稿视频（对象）按 URL 去重后再计数，避免「视频 2」但列表只有 1 条。
  const videoKeys = [...list(d.videos).map(v => (typeof v === 'string' ? v : (v?.url || v?.file || ''))), ...strList(detail?.videos)].filter(Boolean);
  const videos = [...new Set(videoKeys)];
  return [
    { id: 'all', label: '全部图位', count: null },
    { id: 'sq', label: '1:1 主图', count: (d.useSquare === 'src' ? squareSrc : squareAi).length || squareSrc.length },
    { id: 'tl', label: '3:4 主图', count: tall.length },
    { id: 'sku', label: 'SKU 图', count: skuImages.length || skuDraftImages.length },
    { id: 'detail', label: '详情图', count: strList(detail?.description?.images).length },
    { id: 'trans', label: '素材图', count: (d.transMode !== 'auto' ? 1 : 0) + (d.whiteMode === 'custom' ? 1 : 0) },
    { id: 'video', label: '视频', count: videos.length },
    { id: 'params', label: '参数', count: list(detail?.attributes).length },
  ];
}

module.exports = {
  SCHEMA_VERSION, PLATFORMS, PLATFORM_LABELS, DISPLAY_LIMITS, CSV_HEADERS,
  FLOW_STATES, FLOW_LABELS, PIPELINE_STEPS, SLOT_STATES,
  SORT_VALUES, PAGE_SIZES, RESUME_NOT_A_FAILURE,
  classifyFailure, toRow, buildDetailView, computeListingPrice,
  buildCsvBuffer, rowToCsv, normalizeFlow, normalizeSlot, normalizeListing,
  repriceSkus, describeReprice, parsePastedSkus, buildTemplateRows, duplicateSkuNames, editorTabs,
  str, trimmed, int, numOrNull, list, strList, splitTags,
};
