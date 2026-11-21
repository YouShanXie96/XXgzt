'use strict';

/**
 * 上品库 · 店铺登录态读取（替代老软件 main-store-session.js）
 *
 * 老软件做法：每个店铺一个 Electron 分区 `shop-<profileId>` + 加密 Cookie vault + 保活。
 * 新软件**已经原生具备同等的、更完整的能力**，本模块只做适配，绝不重复造轮子：
 *   - 分区：`src/lib/browser.js` `persist:xx-<sha256(storeId)[:24]>`
 *   - 登录态：`src/accounts/service.js` readState / STATUS_LABELS / 强 Cookie 白名单
 *   - 保活：`src/accounts/session-keepalive.js`（5–10 分钟随机）
 *   - Cookie 加密落盘：`src/accounts/session-persistence.js`（DPAPI）
 *
 * 安全边界：
 *   - 只读取**状态**（status / label / checkedAt / backends），**不读取、不导出、不落盘任何 Cookie 值**；
 *   - 不新建分区、不改动既有会话、不触发自动登录；
 *   - 需要打开已登录后台页时通过 `ctx.browser.page(storeId, kind)` 复用现成会话，由新软件统一管理。
 */

const C = require('./contract');

/** 老软件 STATUS_LABELS 的等价归一：把新软件状态映射成上品库用的三态。 */
function normalize(status, label) {
  const raw = C.str(status);
  const text = C.str(label);
  if (raw === 'verified' || /已登录/.test(text)) return { state: 'logged-in', label: text || '已登录' };
  if (raw === 'login-required' || raw === 'expired' || /失效|过期|重新登录|未登录/.test(text)) return { state: 'expired', label: text || '授权已过期' };
  if (raw === 'checking' || /检测|检查/.test(text)) return { state: 'checking', label: text || '正在检查' };
  if (raw === 'error') return { state: 'error', label: text || '检查失败' };
  return { state: 'unknown', label: text || '未知' };
}

function createShopSession(ctx) {
  /**
   * 读取全部已登记店铺的登录状态。
   * 注意：ctx.readAccountState 在 main.js 中于 services 构造之后才赋值，
   * 因此这里必须在**调用时**通过 ctx 动态取，不能在构造时解构。
   */
  async function listShopStates() {
    const stores = typeof ctx.listStores === 'function' ? ctx.listStores() : [];
    const readState = typeof ctx.readAccountState === 'function' ? ctx.readAccountState : null;
    const rows = await Promise.all(C.list(stores).map(async store => {
      const id = C.str(store?.id);
      const name = C.str(store?.name);
      let state = { state: 'unknown', label: '未知' };
      let backends = [];
      let checkedAt = '';
      if (readState && id) {
        try {
          const card = await readState(id);
          state = normalize(card?.status, card?.label);
          backends = C.list(card?.backends).map(b => ({
            kind: C.str(b?.kind), label: C.str(b?.label), status: C.str(b?.status),
            open: b?.open === true, visible: b?.visible === true,
          }));
          checkedAt = C.str(card?.checkedAt);
        } catch (error) {
          state = { state: 'error', label: C.str(error?.message || '读取登录状态失败').slice(0, 120) };
        }
      }
      return { storeId: id, name, ...state, backends, checkedAt };
    }));
    return {
      stores: rows,
      loggedIn: rows.filter(r => r.state === 'logged-in'),
      total: rows.length,
      // 与截图「授权已过期」提示对应
      expired: rows.filter(r => r.state === 'expired' || r.state === 'error'),
    };
  }

  /** 单个店铺：给上架/回填前置校验用。 */
  async function getShopState(storeId) {
    const all = await listShopStates();
    return all.stores.find(s => s.storeId === C.str(storeId)) || null;
  }

  /** 上架前置校验：店铺必须已登录，否则明确报错而不是静默失败。 */
  async function assertShopLoggedIn(storeId) {
    const row = await getShopState(storeId);
    if (!row) throw Object.assign(new Error('店铺不存在，请先在「店铺登录」中添加该店铺'), { code: 'NO_SHOP' });
    if (row.state !== 'logged-in') {
      throw Object.assign(new Error(`${row.name}：${row.label}。请先在「店铺登录」完成登录后再上架。`), { code: 'NO_SHOP_SESSION' });
    }
    return row;
  }

  /**
   * 打开该店铺已登录的商家后台页面（复用新软件现成分区，不新建会话）。
   * 返回 {kind, url, opened}；是否真实打开由调用方的 driver 决定，此处只给入口。
   */
  async function openBackend(storeId, kind = 'seller') {
    await assertShopLoggedIn(storeId);
    if (typeof ctx.browser?.page !== 'function') {
      throw Object.assign(new Error('店铺浏览器尚未就绪'), { code: 'BROWSER_UNAVAILABLE' });
    }
    const page = await ctx.browser.page(storeId, kind);
    return { storeId, kind, url: C.str(page?.url), opened: Boolean(page) };
  }

  return { listShopStates, getShopState, assertShopLoggedIn, openBackend, normalize };
}

module.exports = { createShopSession, normalize };
