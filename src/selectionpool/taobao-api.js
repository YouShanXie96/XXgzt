'use strict';

/**
 * 上品库 · 淘宝开放平台（TOP）适配层 + 待申请 API 清单
 *
 * 设计目的：用户明确「API 凭证后续再给，直接补上即可」。因此本模块：
 *   1. 用 TAOBAO_API_CATALOG 把「需要向淘宝开放平台申请哪些接口」写成机器可读清单；
 *   2. 提供统一调用器 call()，凭证从本地 `用户数据/selectionpool/taobao-api.json` 读取；
 *   3. **未配置凭证时返回 {ok:false, code:'NOT_CONFIGURED'}，绝不发起真实请求、绝不写死密钥**；
 *   4. 每个业务动作（发布/传图/回填）都只依赖 call()，拿到凭证后无需改结构即可启用。
 *
 * 资质前提（见分析报告 §7.4）：个人身份证认证只能调基础读接口；
 * 商品发布 / 图片上传 / 交易类接口需「个体工商户营业执照」或企业资质做企业实名认证。
 *
 * 网关：正式环境 https://eco.taobao.com/router/rest （http 网关 gw.api.taobao.com 亦可）
 * 鉴权：OAuth 2.0 → session（sessionKey）；签名 sign_method=hmac（HMAC-MD5）或 md5。
 *
 * 安全：appSecret / sessionKey 只从本地 JSON 读，不写日志、不回传渲染层明文、不上传云端。
 */

const crypto = require('node:crypto');
const C = require('./contract');

/**
 * 需要申请的 API 全清单。
 * group = 开放平台权限组（申请入口：控制台 → 我的应用 → 功能场景 → 申请权限）
 * auth  = 'session' 必须店铺 OAuth 授权；'appkey' 只需 appkey+签名；'optional' 可选授权
 */
const TAOBAO_API_CATALOG = Object.freeze([
  // ---- A. 商品发布到仓库（第 4 步：提交上架） ----
  { method: 'taobao.item.add', group: '商品 API / 商品发布', auth: 'session', priority: 'P0', use: '集市店铺发布新商品（可用 approve_status=instock 放进仓库）', params: 'num,price,title,cid,props,desc,image,location.city,approve_status' },
  { method: 'tmall.item.add.schema.get', group: '商品 API / 天猫商品发布', auth: 'session', priority: 'P0', use: '天猫：取商品发布规则 schema（动态生成表单）', params: 'category_id,product_id,xml' },
  { method: 'tmall.item.schema.add', group: '商品 API / 天猫商品发布', auth: 'session', priority: 'P0', use: '天猫：按 schema 提交商品上新，放进仓库', params: 'category_id,product_id,xml' },
  { method: 'tmall.product.add.schema.get', group: '商品 API / 天猫产品库', auth: 'session', priority: 'P1', use: '天猫：取产品发布规则（关键属性类目必用）', params: 'category_id,brand_id' },
  { method: 'tmall.product.schema.add', group: '商品 API / 天猫产品库', auth: 'session', priority: 'P1', use: '天猫：发布产品，拿到 product_id 后再发商品', params: 'category_id,brand_id,xml' },
  { method: 'tmall.product.schema.match', group: '商品 API / 天猫产品库', auth: 'session', priority: 'P2', use: '天猫：匹配已有产品，避免重复建档', params: 'category_id,xml' },

  // ---- B. 类目 / 属性（上品库里编辑上架信息 + 缺类目兜底） ----
  { method: 'taobao.itemcats.get', group: '商品 API / 类目属性', auth: 'appkey', priority: 'P0', use: '取类目树，拿 cid（发布必填）', params: 'parent_cid,cids,fields' },
  { method: 'taobao.itemprops.get', group: '商品 API / 类目属性', auth: 'appkey', priority: 'P0', use: '取类目必填/关键属性，生成 props', params: 'cid,fields,pid,parent_pid,is_key_prop,is_sale_prop,is_color_prop' },
  { method: 'taobao.itempropvalues.get', group: '商品 API / 类目属性', auth: 'appkey', priority: 'P1', use: '取属性值 vid/vname，避免属性错填', params: 'cid,pvs,fields' },
  { method: 'tmall.brandcat.control.get', group: '商品 API / 天猫类目品牌管控', auth: 'session', priority: 'P0', use: '**必申请**：查当前店铺允许发布的类目/品牌，规避「商品类目未授权」', params: 'cat_id,brand_id' },
  { method: 'tmall.brandcat.salespro.get', group: '商品 API / 天猫类目品牌管控', auth: 'session', priority: 'P2', use: '取类目销售属性规则', params: 'cat_id' },

  // ---- C. 图片空间上传 + 商品图片（第 5 步回填 / 详情图接口上传） ----
  { method: 'taobao.picture.upload', group: '多媒体平台 API / 图片空间', auth: 'session', priority: 'P0', use: '**核心**：上传单张图到本店图片空间（≤3MB，png/jpg/gif），返回 picture_path', params: 'picture_category_id,img,image_input_title,title,is_https' },
  { method: 'taobao.picture.category.get', group: '多媒体平台 API / 图片空间', auth: 'session', priority: 'P1', use: '取图片空间分类 ID（上传必填，可传 0 用默认分类）', params: 'parent_id,picture_category_id,fields' },
  { method: 'taobao.item.img.upload', group: '商品 API / 商品图片', auth: 'session', priority: 'P0', use: '**核心**：给已入仓商品增/换主图、SKU 图（num_iid + is_major + position）', params: 'num_iid,id,position,image,is_major' },
  { method: 'taobao.item.img.delete', group: '商品 API / 商品图片', auth: 'session', priority: 'P2', use: '删除旧主图（替换前清理）', params: 'num_iid,id' },
  { method: 'taobao.item.joint.img', group: '商品 API / 商品图片', auth: 'session', priority: 'P2', use: '把图片空间已有图片关联到商品（少一次二进制上传）', params: 'num_iid,pic_path,is_major,position' },

  // ---- D. 读取自己店铺商品 / 回读校验（「只信回读」设计） ----
  { method: 'taobao.item.seller.get', group: '商品 API / 商品查询', auth: 'session', priority: 'P0', use: '**核心**：读自己店铺商品，拿 item_imgs 的 id 做替换、做回读一致校验', params: 'num_iid,fields' },
  { method: 'taobao.item.get', group: '商品 API / 商品查询', auth: 'appkey', priority: 'P1', use: '读商品公开详情（标题/价格/SKU/图片）；**只能按 num_iid 读单条，不能按 URL 抓任意竞品页**，采集端仍走插件读公开页面', params: 'num_iid,fields' },
  { method: 'taobao.items.onsale.get', group: '商品 API / 商品查询', auth: 'session', priority: 'P1', use: '列出在售商品，核对是否已上架', params: 'fields,page_no,page_size' },
  { method: 'taobao.items.inventory.get', group: '商品 API / 商品查询', auth: 'session', priority: 'P0', use: '**核心**：列出仓库中商品，核对 auctionStatus / 是否重复入仓', params: 'fields,page_no,page_size,banner' },

  // ---- E. 编辑 / 回填写回 ----
  { method: 'taobao.item.update', group: '商品 API / 商品编辑', auth: 'session', priority: 'P0', use: '改标题、描述、属性、图片（回填文字/详情）', params: 'num_iid,title,desc,props,image,update_fields' },
  { method: 'tmall.item.update.schema.get', group: '商品 API / 天猫商品编辑', auth: 'session', priority: 'P1', use: '天猫：取编辑规则 xml', params: 'item_id' },
  { method: 'tmall.item.schema.update', group: '商品 API / 天猫商品编辑', auth: 'session', priority: 'P1', use: '天猫：按规则提交编辑（回填主数据）', params: 'item_id,xml' },
  { method: 'tmall.item.price.update', group: '商品 API / 商品价格', auth: 'session', priority: 'P1', use: '改商品 / SKU 价格（同行价×倍率−减免落地）', params: 'item_id,price,sku_id' },
  { method: 'taobao.item.quantity.update', group: '商品 API / 商品库存', auth: 'session', priority: 'P1', use: '改商品库存', params: 'num_iid,quantity,type' },
  { method: 'taobao.skus.quantity.update', group: '商品 API / 商品库存', auth: 'session', priority: 'P1', use: '批量改 SKU 库存', params: 'num_iid,skus' },
  { method: 'taobao.item.sku.add', group: '商品 API / SKU', auth: 'session', priority: 'P1', use: '新增 SKU（多规格）', params: 'num_iid,properties,price,quantity,outer_id' },
  { method: 'taobao.item.sku.update', group: '商品 API / SKU', auth: 'session', priority: 'P1', use: '改 SKU 价格/库存/图', params: 'num_iid,properties,price,quantity' },
  { method: 'taobao.item.sku.get', group: '商品 API / SKU', auth: 'session', priority: 'P1', use: '读 SKU 明细，做规格图配对回读', params: 'num_iid,sku_id,fields' },
  { method: 'taobao.item.update.listing', group: '商品 API / 上下架', auth: 'session', priority: 'P2', use: '仓库 → 上架（用户确认开卖后才调）', params: 'num_iid,num' },
  { method: 'taobao.item.update.delisting', group: '商品 API / 上下架', auth: 'session', priority: 'P2', use: '下架', params: 'num_iid' },

  // ---- F. 店铺 / 账号（登录态与归属校验） ----
  { method: 'taobao.shop.get', group: '店铺 API', auth: 'appkey', priority: 'P2', use: '读店铺信息，核对上架目标店铺', params: 'nick,fields' },
  { method: 'taobao.sellercenter.user.info.get', group: '店铺 API', auth: 'session', priority: 'P2', use: '读当前授权商家信息，校验 session 归属', params: 'fields' },
]);

/** 对外清单（渲染层「需要申请哪些接口」面板直接读这个）。 */
function catalogView() {
  return TAOBAO_API_CATALOG.map(row => ({ ...row, configured: false }));
}

/** TOP 签名：参数按 key 升序拼 key+value，hmac 用 secret 作密钥，md5 前后拼 secret。 */
function signTop(params, secret, signMethod = 'hmac') {
  const keys = Object.keys(params).filter(k => k !== 'sign' && params[k] !== undefined && params[k] !== null).sort();
  const raw = keys.map(k => `${k}${params[k]}`).join('');
  if (signMethod === 'md5') {
    return crypto.createHash('md5').update(`${secret}${raw}${secret}`, 'utf8').digest('hex').toUpperCase();
  }
  return crypto.createHmac('md5', secret).update(raw, 'utf8').digest('hex').toUpperCase();
}

function createTaobaoApi(repo, ctx, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const now = options.now || (() => new Date());

  function formatTimestamp(date) {
    // TOP 要求 yyyy-MM-dd HH:mm:ss，GMT+8。
    const shifted = new Date(date.getTime() + (8 * 60 + date.getTimezoneOffset()) * 60000);
    const p = n => String(n).padStart(2, '0');
    return `${shifted.getFullYear()}-${p(shifted.getMonth() + 1)}-${p(shifted.getDate())} ${p(shifted.getHours())}:${p(shifted.getMinutes())}:${p(shifted.getSeconds())}`;
  }

  /** 统一调用。未配置凭证 → NOT_CONFIGURED（不发请求）。 */
  async function call(method, params = {}, { session = true, files = {} } = {}) {
    const entry = TAOBAO_API_CATALOG.find(a => a.method === method);
    if (!entry) return { ok: false, code: 'UNKNOWN_API', message: `接口 ${method} 不在已申请清单中` };
    const cfg = await repo.readApiSecrets();
    const appKey = C.trimmed(cfg?.appKey);
    const appSecret = C.trimmed(cfg?.appSecret);
    const sessionKey = C.trimmed(cfg?.sessionKey);
    if (!appKey || !appSecret) {
      return { ok: false, code: 'NOT_CONFIGURED', message: '尚未填入淘宝开放平台 AppKey / AppSecret。请到「上品库 → 接口配置」填入后即可启用。', api: method };
    }
    if (entry.auth === 'session' && session && !sessionKey) {
      return { ok: false, code: 'SESSION_REQUIRED', message: '该接口需要店铺 OAuth 授权，请先填入 sessionKey。', api: method };
    }
    const publicParams = {
      method, app_key: appKey, timestamp: formatTimestamp(now()),
      format: 'json', v: '2.0', sign_method: 'hmac',
      ...(entry.auth === 'session' && session && sessionKey ? { session: sessionKey } : {}),
    };
    const all = { ...publicParams, ...params };
    const sign = signTop(all, appSecret, 'hmac');
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...all, sign })) if (v !== undefined && v !== null) body.append(k, String(v));
    for (const [k, v] of Object.entries(files)) if (v !== undefined && v !== null) body.append(k, String(v));

    const url = C.trimmed(cfg?.baseUrl) || 'https://eco.taobao.com/router/rest';
    try {
      const response = await fetchImpl(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' } });
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch { return { ok: false, code: 'UNEXPECTED_RESPONSE', message: `接口返回非 JSON（HTTP ${response.status}）` }; }
      if (json.error_response) {
        const e = json.error_response;
        return { ok: false, code: C.str(e.sub_code || e.code) || 'TOP_ERROR', message: C.str(e.sub_msg || e.msg).slice(0, 500), raw: e };
      }
      const key = `${method.replace(/^taobao\.|^tmall\./, '').replace(/\./g, '_')}_response`;
      return { ok: true, data: json[key] ?? json, api: method };
    } catch (error) {
      return { ok: false, code: 'NETWORK_ERROR', message: C.str(error?.message || error).slice(0, 300), api: method };
    }
  }

  /** 检查凭证是否齐备（不发起请求）。 */
  async function readiness() {
    const cfg = await repo.readApiConfig();
    const raw = await repo.readApiSecrets();
    return {
      ...cfg,
      hasSessionKey: Boolean(C.trimmed(raw?.sessionKey)),
      totalApis: TAOBAO_API_CATALOG.length,
      p0Apis: TAOBAO_API_CATALOG.filter(a => a.priority === 'P0').length,
      note: cfg.configured ? '凭证已填入，接口调用已启用' : '凭证未填，所有真实接口调用保持关闭（NOT_CONFIGURED）',
    };
  }

  // ---- 业务动作封装：全部只依赖 call()，拿到凭证后无需改结构 ----
  const uploadPicture = (bytesBase64, title, categoryId = 0) =>
    call('taobao.picture.upload', { picture_category_id: categoryId, image_input_title: title, is_https: true }, { files: { img: bytesBase64 } });
  const uploadItemImage = (numIid, bytesBase64, { isMajor = false, position = 0, imgId } = {}) =>
    call('taobao.item.img.upload', {
      num_iid: numIid, ...(imgId ? { id: imgId } : {}), position, is_major: isMajor,
    }, { files: { image: bytesBase64 } });
  const readItemForReadback = numIid => call('taobao.item.seller.get', { num_iid: numIid, fields: 'num_iid,title,item_imgs,skus,props,desc,pic_url' });
  const listInventory = (pageNo = 1, pageSize = 50) => call('taobao.items.inventory.get', { fields: 'num_iid,title,approve_status,modified', page_no: pageNo, page_size: pageSize });
  const allowedCategories = () => call('tmall.brandcat.control.get', {});
  const publishToWarehouse = (xml, categoryId, productId = 0) =>
    call('tmall.item.schema.add', { category_id: categoryId, product_id: productId, xml });

  // ---- 类目 / 属性 / 发布表单（「后面给 API 直接接上」的预置入口） ----
  // 这些封装全部只依赖 call()：凭证一填就启用，未填统一返回 NOT_CONFIGURED，不发请求、不写死密钥。
  const categoryChildren = (parentCid = 0) =>
    call('taobao.itemcats.get', { parent_cid: parentCid, fields: 'cid,parent_cid,name,is_parent' }, { session: false });
  const categoryProps = cid =>
    call('taobao.itemprops.get', { cid, fields: 'pid,name,is_key_prop,is_sale_prop,is_color_prop,must,multi,prop_values' }, { session: false });
  const categoryPropValues = (cid, pvs = '') =>
    call('taobao.itempropvalues.get', { cid, pvs, fields: 'cid,pid,vid,vname' }, { session: false });
  const publishSchema = (categoryId, productId = 0, xml = '') =>
    call('tmall.item.add.schema.get', { category_id: categoryId, product_id: productId, xml });
  const productSchema = (categoryId, brandId = 0) =>
    call('tmall.product.add.schema.get', { category_id: categoryId, brand_id: brandId });
  const submitProductSchema = (categoryId, brandId, xml) =>
    call('tmall.product.schema.add', { category_id: categoryId, brand_id: brandId, xml });
  const updateItemSchema = (itemId, xml) =>
    call('tmall.item.schema.update', { item_id: itemId, xml });
  /** 店铺分类：平台没有对应开放接口，老软件也是从发布页 __SELL_STATE__.shopcat 读；这里保留统一入口。 */
  const shopCategoryTree = async () => ({ ok: false, code: 'PAGE_ONLY', message: '店铺分类只能从店铺发布页读取（见 category.js / shop-categories 占位）' });

  return {
    catalogView, readiness, call, signTop,
    uploadPicture, uploadItemImage, readItemForReadback, listInventory,
    allowedCategories, publishToWarehouse,
    categoryChildren, categoryProps, categoryPropValues,
    publishSchema, productSchema, submitProductSchema, updateItemSchema, shopCategoryTree,
  };
}

module.exports = { TAOBAO_API_CATALOG, catalogView, signTop, createTaobaoApi };
