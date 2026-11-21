'use strict';

/**
 * 上品库 · 店铺会话上架驱动 v1（复刻老软件 form-capture-publish 系列，REA 证据 beta.268）
 *
 * 老软件探明的实测规则（form-capture-publish-core.js 注释原文）：
 *   - 发布入口禁止裸 publish.htm?catId=（itemProp 为空）；必须走 ai/category.htm 或
 *     「fromAICategory=true&fromAIPublish=true&newRouter=1」直达链路（类目决议缓存命中时老软件自己就走这条）。
 *   - 提交按钮 button[name="button-submit"]；「放入仓库」radio 勾选后提交（auctionStatus=-5），严禁立即上架。
 *   - 页面活状态在 React 组件树内（window.__SELL_STATE__），models.formValues 只是快照，填充必须组件 + DOM 双写。
 *   - 成功回执 = success.htm?auctionStatus=-5&isSuccess=true&primaryId=<数字>（warehouseReceipt）。
 *
 * v1 范围（本轮）：打开正确类目的发布页 + 组件级填标题 + 把窗口显示给用户补全
 *   （价格 / 规格 / 图片 / 属性的自动填充与自动提交在后续版本接入；老软件同样在这些字段
 *   校验不过时把发布页留给用户手动补，manualFix「接着处理」链路一致）。
 *   抛 NEEDS_MANUAL_VERIFICATION 让自动上架队列停下，等人工补完再继续 —— 与老软件队列行为一致。
 */

const PUBLISH_HOST = 'https://sell.publish.tmall.com';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 发布页就绪探测：__SELL_STATE__ 组件树 + title 组件 + itemProp 数据源 + 登录/授权状态。 */
function pageProbeScript() {
  return `(function(){
  var st=null;try{st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();}catch(e){}
  if(!st||!st.engine||!st.getComponentProps)return {ready:false,pathname:location.pathname};
  var ds=0;['itemProp','bindProp','keyProp'].forEach(function(k){var p=st.getComponentProps(k)||{};if(Array.isArray(p.dataSource))ds+=p.dataSource.length;});
  var text=(document.body&&document.body.innerText)||'';
  return {ready:true,pathname:location.pathname,propSources:ds,hasTitle:Boolean(st.getComponentProps('title')),
    login:/^login\\.(taobao|tmall)\\.com$/.test(location.hostname),
    denied:/商品类目未授权/.test(text),
    blocked:/_____tmd_____|\\/punish/.test(location.href)||Array.from(document.querySelectorAll('iframe')).some(function(f){return /_____tmd_____|\\/punish/.test(f.src||'');})};
})()`;
}

/** 组件级填标题（复刻老软件 buildNativeTitleScript：组件 setProps + 真实输入事件双写，回读断言）。 */
function fillTitleScript(title) {
  return `(async function(){var want=${JSON.stringify(String(title || ''))},st=window.__SELL_STATE__?.getState(),eng=st?.engine;if(!eng)throw new Error('商品标题组件未就绪');var props=st.getComponentProps('title')||{},current=st.getComponentValue('title'),value=want;
    if(props.uiType==='tmTitle'){value={};if(current&&typeof current==='object'&&!Array.isArray(current))Object.keys(current).forEach(k=>{if(!/^\\d+$/.test(k)&&k!=='title')value[k]=current[k];});value.title=[want];}
    var fv=Object.assign({},eng.getModels().formValues,{title:value}),comp=eng.getComponent('title');if(comp?.setProps)comp.setProps(Object.assign({},props,{value}));eng.updateModels({formValues:fv});
    var input=document.querySelector('[id="struct-title"] input');if(input){input.focus();var desc=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');if(input._valueTracker)input._valueTracker.setValue('');desc.set.call(input,want);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();}
    await new Promise(r=>setTimeout(r,200));var actual=st.getComponentValue('title'),text=typeof actual==='string'?actual:String(actual?.title?.[0]||'');return JSON.stringify({filled:text===want,detail:text===want?'native:'+text:'标题回读不一致:'+text.slice(0,40)});})()`;
}

/** 老软件 allowNavigationAwayFromPublishPage：填充期间一律允许离开发布页（beforeunload 拦截放行）。 */
function allowNavigationAway(webContents) {
  const flagged = webContents;
  if (flagged.__xxPublishAllowLeave) return;
  flagged.__xxPublishAllowLeave = true;
  webContents.on('will-prevent-unload', event => { event.preventDefault(); });
}

function revealWindow(win) {
  try { if (win.isMinimized()) win.restore(); } catch { /* */ }
  try { win.setSkipTaskbar(false); } catch { /* */ }
  try { win.setBounds({ x: 120, y: 60, width: 1500, height: 1000 }); } catch { /* */ }
  try { win.show(); win.focus(); } catch { /* */ }
}

function createPublishDriver({ electron, partitionForStore, log } = {}) {
  const { BrowserWindow } = electron || {};
  if (!BrowserWindow) throw new Error('上架驱动需要 electron 引用');
  let activeLog = null;
  const debug = message => { try { const fn = activeLog || log; if (typeof fn === 'function') fn(message); } catch { /* */ } };

  /**
   * 打开发布页（正确类目）→ 组件级填标题 → 显示窗口转人工。
   * 成功入仓的自动提交在后续版本接入；当前版本把发布页准备好并明确告知人工步骤。
   */
  async function publish(input = {}) {
    activeLog = typeof input.log === 'function' ? input.log : null;
    const storeId = String(input.storeId || '');
    if (!storeId) throw Object.assign(new Error('缺少上架目标店铺'), { code: 'NO_SHOP' });
    const categoryId = String(input.categoryId || '').trim();
    if (!/^\d+$/.test(categoryId)) throw Object.assign(new Error('缺少上架类目 ID，请先在上品库采集或选择叶子类目'), { code: 'MISSING_CATEGORY' });
    const title = String(input.detail?.product?.title || '').trim().slice(0, 60);
    if (!title) throw Object.assign(new Error('该选品缺少标题'), { code: 'INVALID_ITEM' });

    const url = new URL(`${PUBLISH_HOST}/tmall/publish.htm`);
    url.searchParams.set('catId', categoryId);
    url.searchParams.set('fromAICategory', 'true');
    url.searchParams.set('fromAIPublish', 'true');
    url.searchParams.set('newRouter', '1');

    let win = null;
    let revealed = false;
    try {
      debug(`打开发布页（类目 ${categoryId}，店铺会话）`);
      win = new BrowserWindow({
        show: false, width: 1500, height: 1000,
        webPreferences: {
          partition: partitionForStore(storeId), contextIsolation: true,
          nodeIntegration: false, sandbox: true, backgroundThrottling: false,
        },
      });
      try { win.webContents.setAudioMuted(true); } catch { /* */ }
      allowNavigationAway(win.webContents);
      await Promise.race([
        win.loadURL(url.toString()),
        sleep(40000).then(() => { throw new Error('发布页打开超时'); }),
      ]);

      // 等待发布页就绪（老软件：登录页 / 授权页 / 验证页都先识别，绝不盲目填）。
      let probe = null;
      const start = Date.now();
      while (Date.now() - start < 45000) {
        await sleep(1500);
        probe = await win.webContents.executeJavaScript(pageProbeScript(), true).catch(() => null);
        if (probe && (probe.login || probe.denied || probe.blocked)) break;
        if (probe && probe.ready && probe.hasTitle && probe.propSources > 0) break;
      }
      if (!probe) throw Object.assign(new Error('发布页没有响应'), { code: 'PAGE_MISMATCH' });
      if (probe.login) throw Object.assign(new Error('店铺登录已失效，发布页要求重新登录；请先在店铺浏览器重新登录'), { code: 'LOGIN' });
      if (probe.blocked) throw Object.assign(new Error('平台弹出安全验证，请在店铺窗口完成验证后重试'), { code: 'NEEDS_MANUAL_VERIFICATION' });
      if (probe.denied) throw Object.assign(new Error('这家店铺没有这个类目的发布权限，请换类目或换店铺'), { code: 'CATEGORY_NOT_AUTHORIZED' });
      if (!(probe.ready && probe.hasTitle && probe.propSources > 0)) {
        throw Object.assign(new Error('发布页属性未就绪（itemProp 为空）；请在店铺窗口打开发布页后人工处理'), { code: 'PAGE_MISMATCH' });
      }

      // 组件级填标题 + 回读断言（复刻老软件 TITLE_NONEMPTY_ASSERT）。
      const filled = await win.webContents.executeJavaScript(fillTitleScript(title), true).catch(() => null);
      const parsed = (() => { try { return JSON.parse(filled); } catch { return null; } })();
      if (!parsed?.filled) {
        debug(`标题填充未确认：${parsed?.detail || '页面无响应'}；窗口交人工补全`);
      } else {
        debug(`标题已填好：${title}`);
      }

      // 价格自动填（v1.1）：单价格框直接写（「放入仓库」模式下库存非必填的场景同样交给人工）。
      if (input.price && Number(input.price.after) > 0) {
        const yuan = (Number(input.price.after) / 100).toFixed(2);
        const priceResult = await win.webContents.executeJavaScript(fillPriceScript(yuan), true).catch(() => null);
        debug(priceResult === 'filled' ? `销售价已填：¥${yuan}` : `销售价未自动填（多规格发布页需先建规格）；¥${yuan} 请人工填`);
      }

      // 老软件 safeReveal(forceVisible=true)：入仓未确认 = 需人工检查，把发布窗移回屏上。
      revealWindow(win);
      revealed = true;
      throw Object.assign(
        new Error(`发布页已打开并填好标题${input.price && Number(input.price.after) > 0 ? '与销售价' : ''}（类目 ${categoryId}）。请在窗口里补全图片/规格/属性后勾「放入仓库」点提交；本条已登记为「没入仓、可以接着处理的任务」，队列暂停等这条处理完。`),
        { code: 'NEEDS_MANUAL_VERIFICATION', publishUrl: url.toString(), revealed: true },
      );
    } catch (error) {
      // 交人工的窗口留给用户操作；其余失败（登录失效/类目未授权/页面异常）回收隐藏窗口。
      if (!revealed && win && !win.isDestroyed()) { try { win.destroy(); } catch { /* */ } }
      throw error;
    }
  }

  /** v1.1 价格填充：单价格输入框（无规格发布页）直接组件+DOM 双写；多规格页跳过（返回 skipped）。 */
  function fillPriceScript(yuan) {
    return `(async function(){var want=${JSON.stringify(String(yuan))},st=window.__SELL_STATE__?.getState(),eng=st?.engine;if(!eng)return 'no-state';
    var comp=st.getComponentProps('sku')||{};var rows=st.getComponentValue('sku');
    var single=!Array.isArray(rows)||rows.length<=1;
    var input=document.querySelector('[id="struct-sku"] input[id$="skuPrice"],[id="struct-sku"] input[id*="skuPrice"],[id="struct-sku"] .next-input input');
    if(!input)return single?'no-input':'multi-sku';
    try{input.focus();var desc=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');if(input._valueTracker)input._valueTracker.setValue('');desc.set.call(input,want);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();await new Promise(r=>setTimeout(r,150));return String(input.value)===want?'filled':'mismatch';}catch(e){return 'error:'+String(e&&e.message||e).slice(0,40);}})()`;
  }

  /** 回填（读回仓库商品确认图位）：后续版本接入官方 API / 仓库页读回。 */
  async function backfill(input = {}) {
    return { ok: false, code: 'DRIVER_NOT_READY', message: '回填驱动未接入（需店铺会话驱动或官方 API 凭证）', itemId: input?.itemId };
  }

  return { publish, backfill };
}

module.exports = { createPublishDriver, PUBLISH_HOST };
