'use strict';

const { createHash } = require('node:crypto');
const taobao = require('../connectors/review-check-taobao-connector');

const id = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const reliable = value => Boolean(id(value)) && !/^(unknown:|order:|review:)/.test(id(value));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dateOf = value => {
  const time = Date.parse(value);
  return Number.isFinite(time) && time > 0 ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : '';
};
const orderKey = order => reliable(order.subOrderId) ? `sub:${id(order.subOrderId)}`
  : reliable(order.orderAssociationId) ? `association:${id(order.orderAssociationId)}`
    : digest([order.mainOrderId, order.productId, order.skuId, order.orderedAt, order.productTitle]);
const reviewKey = review => reliable(review.reviewId) ? `review:${id(review.reviewId)}:${Boolean(review.isFollowUp)}`
  : digest([review.mainOrderId, review.subOrderId, review.orderAssociationId, review.productId,
    review.isFollowUp, review.evaluatedAt, review.content, review.imageCount, review.thumbnailUrls]);
const dedupe = (records, keyOf) => [...new Map(records.map(record => [keyOf(record), record])).values()];

/** A match is an association of stable identifiers, never a product/name similarity guess. */
function matchReviews(orders, reviews, sync = {}) {
  const uniqueOrders = dedupe(orders, orderKey);
  const uniqueReviews = dedupe(reviews, reviewKey);
  const assigned = new Map(uniqueOrders.map(order => [orderKey(order), []]));
  const bySub = new Map();
  const byMainProduct = new Map();
  const addIndex = (index, key, order) => {
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(order);
  };
  for (const order of uniqueOrders) {
    for (const value of [order.subOrderId, order.orderAssociationId, order.orderLineId].filter(reliable)) addIndex(bySub, id(value), order);
    if (reliable(order.mainOrderId) && reliable(order.productId)) addIndex(byMainProduct, JSON.stringify([id(order.mainOrderId), id(order.productId)]), order);
  }
  const uncertain = new Set();
  const unmatchedReviews = [];
  let unidentifiedReviews = false;
  const compatible = (order, review) => !(
    reliable(order.mainOrderId) && reliable(review.mainOrderId) && id(order.mainOrderId) !== id(review.mainOrderId)
  ) && !(
    reliable(order.productId) && reliable(review.productId) && id(order.productId) !== id(review.productId)
  );
  for (const review of uniqueReviews) {
    const reviewSub = [review.subOrderId, review.orderAssociationId].filter(reliable).map(id);
    let candidates = [...new Set(reviewSub.flatMap(value => [...(bySub.get(value) || [])]))].filter(order => compatible(order, review));
    let method = '子订单ID精确匹配';
    if (!candidates.length && reliable(review.mainOrderId) && reliable(review.productId)) {
      candidates = [...(byMainProduct.get(JSON.stringify([id(review.mainOrderId), id(review.productId)])) || [])].filter(order => compatible(order, review)
        // Conflicting strong IDs must never be overridden by a weaker main-order/product match.
        && !(reviewSub.length && [order.subOrderId, order.orderAssociationId].some(reliable)));
      method = '主订单ID与商品ID唯一匹配';
    }
    if (candidates.length === 1) {
      assigned.get(orderKey(candidates[0])).push({ ...review, matchMethod: method });
    } else {
      unmatchedReviews.push({ ...review, matchStatus: candidates.length > 1 ? '待确认：多笔候选订单' : '待确认：未找到可靠关联' });
      candidates.forEach(order => uncertain.add(orderKey(order)));
      if (!reviewSub.length && !(reliable(review.mainOrderId) && reliable(review.productId))) unidentifiedReviews = true;
    }
  }
  const complete = sync.orders?.status === 'completed' && sync.reviews?.status === 'completed';
  const rows = uniqueOrders.map(order => {
    const matched = assigned.get(orderKey(order));
    const initial = matched.filter(review => !review.isFollowUp);
    const followUps = matched.filter(review => review.isFollowUp);
    const initialImageCount = initial.reduce((sum, review) => sum + Math.max(0, Number(review.imageCount) || 0), 0);
    const followUpImageCount = followUps.reduce((sum, review) => sum + Math.max(0, Number(review.imageCount) || 0), 0);
    const imageCount = initialImageCount + followUpImageCount;
    const images = [...new Set(matched.flatMap(review => review.thumbnailUrls || []).filter(url => /^https?:\/\//i.test(url)))];
    let matchStatus;
    let reviewStatus;
    if (matched.length) {
      matchStatus = [...new Set(matched.map(review => review.matchMethod))].join('；');
      reviewStatus = imageCount ? `${initialImageCount ? '初评已晒图' : ''}${initialImageCount && followUpImageCount ? '；' : ''}${followUpImageCount ? '追评已晒图' : ''}`
        : initial.length ? '已评价，当前记录无晒图' : '已追评，当前记录无晒图';
      if (uncertain.has(orderKey(order))) matchStatus += '；另有评价待确认';
    } else if (uncertain.has(orderKey(order))) {
      matchStatus = '待确认：多笔候选订单'; reviewStatus = '待确认';
    } else if (![order.subOrderId, order.orderAssociationId].some(reliable)
      && !(reliable(order.mainOrderId) && reliable(order.productId))) {
      matchStatus = '待确认：缺少可靠订单ID'; reviewStatus = '待确认';
    } else if (!complete) {
      matchStatus = '待确认：同步未完成'; reviewStatus = '待确认';
    } else if (unidentifiedReviews) {
      matchStatus = '待确认：部分评价缺少关联ID'; reviewStatus = '待确认';
    } else {
      matchStatus = '当前范围无匹配记录'; reviewStatus = '当前范围未查到评价';
    }
    return {
      orderId: id(order.mainOrderId), subOrderId: id(order.subOrderId), productId: id(order.productId),
      title: order.productTitle || '', orderedAt: order.orderedAt || '', reviewStatus, imageCount,
      initialImageCount, followUpImageCount, content: matched.map(review => `${review.isFollowUp ? '追评' : '初评'}：${review.content || ''}`).join('\n'),
      images, matchStatus, reviewIds: matched.map(review => review.reviewId), matchedCount: matched.length,
      orderStatus: order.status || '',
    };
  });
  return { rows, unmatchedReviews, summary: {
    orders: uniqueOrders.length, reviews: uniqueReviews.length,
    matched: rows.filter(row => row.matchedCount > 0).length,
    withImages: rows.filter(row => row.imageCount > 0).length,
    pending: rows.filter(row => row.matchStatus.includes('待确认')).length,
    unmatchedReviews: unmatchedReviews.length,
  } };
}

function validateRange(start, end) {
  for (const value of [start, end]) {
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
      throw new Error('请选择有效的开始和结束日期。');
    }
  }
  if (start > end) throw new Error('开始日期不能晚于结束日期。');
  return { start, end };
}

const stopCodes = new Set(['LOGIN_EXPIRED', 'USER_VALIDATION_REQUIRED', 'RATE_LIMITED', 'CANCELED', 'REQUEST_TIMEOUT']);
// 只有登录失效与取消会整体停止；验证码/限流/超时按“这一页失败”处理并继续其余页。
const REVIEW_FATAL = new Set(['LOGIN_EXPIRED', 'CANCELED']);
// 参考实现的节奏：并发降到 2，两次请求之间留出间隔，失败后指数退避，
// 避免连续整页被平台限流（此前的失败集中在中间一大段页码）。
const REVIEW_CONCURRENCY = 2;
const REVIEW_PAGE_SPACING_MS = 150;
const REVIEW_MAX_PAGES_PER_KIND = 500;
function errorMessage(error) {
  const code = error.code || error.message;
  return ({
    LOGIN_EXPIRED: '店铺登录已失效，请打开店铺页面重新登录后继续。',
    USER_VALIDATION_REQUIRED: '平台要求安全验证，请打开店铺页面手动完成验证后继续。',
    RATE_LIMITED: '平台限制了读取频率，已暂停；请稍后继续。',
    CANCELED: '已取消，已读取数据和分页断点已保存。',
    REQUEST_TIMEOUT: '店铺页面读取超时，断点已保存，请检查页面后继续。',
    DATE_RANGE_MISMATCH: '平台返回的日期不符合所选范围，请在店铺页面设置日期并查询后重试。',
    PAGINATION_CHANGED: '平台分页返回异常，已停止并保留断点，未将缺失结果判为未评价。',
  })[code] || `同步未完成：${String(error.message || error).slice(0, 250)}`;
}
const codedError = code => Object.assign(new Error(code), { code });
function checkCanceled(token) { if (token.canceled) throw codedError('CANCELED'); }
async function guarded(promise, token, timeout = 25000) {
  checkCanceled(token);
  let interval;
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      interval = setInterval(() => { if (token.canceled) reject(codedError('CANCELED')); }, 100);
      timer = setTimeout(() => reject(codedError('REQUEST_TIMEOUT')), timeout);
    })]);
  } finally { clearInterval(interval); clearTimeout(timer); }
}

/** Captures only the two read-only request templates. Cookie/header values are neither read nor saved. */
async function attachCapture(webContents, connector) {
  const debuggerClient = webContents.debugger;
  let ownsDebugger = false;
  let disposed = false;
  let orders = null;
  let reviews = null;
  let scriptIdentifier;
  const onMessage = async (_event, method, params = {}) => {
    if (disposed || method !== 'Network.requestWillBeSent' || !params.request?.url) return;
    const url = params.request.url;
    if (!url.includes('/h5/mtop.rm.sellercenter.list.data.pc/1.0/')
      && !url.startsWith('https://trade.taobao.com/trade/itemlist/asyncSold.htm')) return;
    let postData = params.request.postData;
    if (!postData && params.request.hasPostData) {
      try { postData = (await debuggerClient.sendCommand('Network.getRequestPostData', { requestId: params.requestId })).postData; }
      catch { return; }
    }
    if (disposed) return;
    const orderTemplate = connector.parseReviewCheckOrderRequestTemplate({ url, postData });
    const reviewTemplate = connector.parseReviewCheckListRequestTemplate({ url, postData });
    if (orderTemplate) orders = orderTemplate;
    if (reviewTemplate) reviews = reviewTemplate;
  };
  try {
    if (!debuggerClient.isAttached()) { debuggerClient.attach('1.3'); ownsDebugger = true; }
    debuggerClient.on('message', onMessage);
    await debuggerClient.sendCommand('Network.enable');
    await debuggerClient.sendCommand('Page.enable');
    const result = await debuggerClient.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: connector.buildReviewCheckRequestCaptureScript() });
    scriptIdentifier = result.identifier;
    await webContents.executeJavaScript(connector.buildReviewCheckRequestCaptureScript(), false).catch(() => {});
  } catch (error) {
    debuggerClient.removeListener('message', onMessage);
    if (ownsDebugger && debuggerClient.isAttached()) debuggerClient.detach();
    throw new Error(`无法监听店铺页面，请关闭该页面的开发者工具后重试：${error.message}`);
  }
  return {
    webContents,
    async get(kind) {
      if (kind === 'orders') return orders;
      return reviews || await connector.readReviewCheckListRequestTemplate(webContents).catch(() => null);
    },
    dispose() {
      disposed = true;
      debuggerClient.removeListener('message', onMessage);
      if (debuggerClient.isAttached()) {
        if (ownsDebugger) debuggerClient.detach();
        else if (scriptIdentifier) void debuggerClient.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptIdentifier }).catch(() => {});
      }
    },
  };
}

function createReviewService(ctx, options = {}) {
  const connector = options.connector || taobao;
  const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  // 单次读取页数上限可注入（默认 500），便于测试与按需收紧。
  const maxPagesPerKind = Number.isInteger(options.maxPagesPerKind) && options.maxPagesPerKind > 0 ? options.maxPagesPerKind : REVIEW_MAX_PAGES_PER_KIND;
  const captureFactory = options.captureFactory || attachCapture;
  const active = new Map();
  const captures = new Map();
  // 每个店铺一个独立文件夹；迁移完成前仍可读取旧的 reviews/<摘要>.json。
  const legacyLocation = storeId => `reviews/${digest(id(storeId))}.json`;
  const location = storeId => typeof ctx.storeFolder === 'function' ? `${ctx.storeFolder(id(storeId))}/reviews.json` : legacyLocation(storeId);
  const blank = () => ({ version: 1, orders: [], reviews: [], sync: {
    orders: { status: 'idle', nextPage: 1, completedPages: 0, recordCount: 0 },
    reviews: { status: 'idle', nextPage: 1, completedPages: 0, recordCount: 0 },
  } });
  const loadRaw = async storeId => {
    const snapshot = await ctx.readJson(location(storeId), null) ?? await ctx.readJson(legacyLocation(storeId), blank());
    if (!Array.isArray(snapshot.orders) || !Array.isArray(snapshot.reviews) || !snapshot.sync) throw new Error('评价数据文件格式错误，请从备份恢复。');
    for (const kind of ['orders', 'reviews']) {
      snapshot.sync[kind] ||= blank().sync[kind];
      if (snapshot.sync[kind].status === 'running' && !active.has(storeId)) {
        snapshot.sync[kind].status = 'interrupted';
        snapshot.sync[kind].message = '上次同步中断，可从保存的分页断点继续。';
      }
    }
    return snapshot;
  };
  const view = snapshot => ({ ...snapshot, ...matchReviews(snapshot.orders, snapshot.reviews, snapshot.sync),
    scopeNote: '订单按下单日期，评价按评价日期读取；结果受店铺后台当前筛选、可见范围和账号权限限制。无匹配只表示当前范围未查到，不能据此断言从未评价。',
  });
  const progress = (storeId, kind, checkpoint) => ctx.emit?.({ module: 'reviews', storeId, kind,
    message: checkpoint.message, current: checkpoint.completedPages, total: checkpoint.totalPages, status: checkpoint.status });
  async function preparePage(storeId, kind, token) {
    const webContents = await guarded(ctx.browser.page(storeId, kind, { show: false }), token);
    const key = `${storeId}:${kind}`;
    let capture = captures.get(key);
    if (capture?.webContents !== webContents || webContents.isDestroyed?.()) {
      capture?.dispose(); captures.delete(key); capture = null;
    }
    if (!capture) {
      capture = await guarded(captureFactory(webContents, connector), token);
      captures.set(key, capture);
      // Attach before refreshing this app-owned page, so its first real list request is captured.
      webContents.reload();
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      checkCanceled(token);
      const template = await guarded(capture.get(kind), token, 5000);
      if (template) return { webContents, template };
      await wait(250);
    }
    throw new Error(`尚未捕获${kind === 'orders' ? '订单' : '评价'}列表请求。请打开本店铺的${kind === 'orders' ? '订单' : '评价'}页面，登录后选择“全部”、设置日期并点击查询一次，再点同步。若页面没有访问权限，请使用有权限的店铺账号。`);
  }
  async function syncKind(storeId, kind, range, snapshot, token, restart) {
    const old = snapshot.sync[kind];
    const canResume = !restart && old.status !== 'completed' && old.range?.start === range.start && old.range?.end === range.end && old.nextPage > 1;
    const checkpoint = canResume ? { ...old, status: 'running' } : {
      status: 'running', range, nextPage: 1, completedPages: 0, recordCount: 0, startedAt: new Date().toISOString(), failedPages: [],
    };
    if (!canResume) snapshot[kind] = [];
    snapshot.sync[kind] = checkpoint;
    checkpoint.message = `正在准备${kind === 'orders' ? '订单' : '评价'}页面…`;
    await ctx.writeJson(location(storeId), snapshot);
    progress(storeId, kind, checkpoint);
    try {
      const { webContents, template } = await preparePage(storeId, kind, token);
      let effectiveTemplate = kind === 'orders' ? connector.retargetReviewCheckOrderTemplateRange(template, range) : template;
      if (kind === 'orders' && typeof connector.resolveReviewCheckOrderTemplateForDateRange === 'function') {
        // 以参考实现为准：先用官方页面的日期筛选把页数降下来，再逐页读取；
        // 找不到可用格式时按平台返回的完整分页读取，并在本机按日期过滤。
        try {
          checkpoint.message = '正在核对订单列表的日期筛选格式…';
          progress(storeId, kind, checkpoint);
          const resolved = await guarded(connector.resolveReviewCheckOrderTemplateForDateRange({
            webContents, template: effectiveTemplate, range,
            onAttempt: message => { checkpoint.message = `正在核对订单日期筛选：${message}`; progress(storeId, kind, checkpoint); },
          }), token, 45000);
          if (resolved?.form) effectiveTemplate = resolved;
          else checkpoint.message = '平台未接受日期筛选格式，将按完整分页读取并在本机按日期过滤。';
        } catch (error) {
          if (REVIEW_FATAL.has(error.code || error.message)) throw error;
          checkpoint.message = `日期筛选核对未完成（${errorMessage(error)}），继续按当前分页读取。`;
        }
        progress(storeId, kind, checkpoint);
      }
      const keyOf = kind === 'orders' ? orderKey : reviewKey;
      const fetchPage = async page => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          checkCanceled(token);
          // 每次请求之间留间隔；重试时指数退避，尽量避开平台限流。
          await wait(attempt === 1 ? REVIEW_PAGE_SPACING_MS : Math.min(4000, 600 * 2 ** (attempt - 1)));
          checkCanceled(token);
          try {
            const result = await guarded(kind === 'orders'
              ? connector.fetchTaobaoOrderPage({ webContents, template: effectiveTemplate, page })
              : connector.fetchTaobaoReviewPage({ webContents, template: effectiveTemplate, page,
                range: connector.reviewCheckListTemplateSupportsDateRange(template) ? range : undefined }), token);
            if (!result || result.page !== page || !Number.isInteger(result.totalPages) || result.totalPages < page || result.totalPages > 10000 || !Array.isArray(result.records)) {
              throw codedError('PAGINATION_CHANGED');
            }
            return result;
          } catch (error) {
            const code = error.code || error.message;
            if (REVIEW_FATAL.has(code) || attempt === 3) throw error;
            checkpoint.message = `第 ${page} 页读取失败，正在第 ${attempt + 1} 次尝试…`;
            progress(storeId, kind, checkpoint);
            await wait(500 * attempt);
          }
        }
      };
      let prefetched;
      if (canResume) {
        const first = await fetchPage(1);
        const signature = digest(first.records.map(keyOf));
        if (!old.firstPageSignature || signature !== old.firstPageSignature || first.totalPages !== old.totalPages) {
          snapshot[kind] = []; checkpoint.nextPage = 1; checkpoint.completedPages = 0; checkpoint.recordCount = 0;
          checkpoint.message = '列表在中断后发生变化，重新从第一页读取以避免漏单。';
          prefetched = first;
        }
      }
      let previousSignature = checkpoint.lastPageSignature;
      let processedPages = 0;
      // 单页落库：签名校验、按日期过滤、去重后写入快照并推进检查点。
      const processPage = async (page, result) => {
        const signature = digest(result.records.map(keyOf));
        if (page > 1 && checkpoint.totalPages !== undefined && result.totalPages !== checkpoint.totalPages) throw codedError('PAGINATION_CHANGED');
        if (page > 1 && result.records.length && signature === previousSignature) throw codedError('PAGINATION_CHANGED');
        if (page === 1) checkpoint.firstPageSignature = signature;
        previousSignature = signature;
        // Retain follow-ups with their root review; apply order/evaluation dates locally as well.
        const mainInRange = new Set(result.records.filter(record => !record.isFollowUp &&
          dateOf(record.evaluatedAt) >= range.start && dateOf(record.evaluatedAt) <= range.end).map(record => record.reviewId));
        const filtered = result.records.filter(record => {
          const date = dateOf(kind === 'orders' ? record.orderedAt : record.evaluatedAt);
          // Unknown dates remain visible for manual confirmation; never silently discard them.
          return !date || date >= range.start && date <= range.end || kind === 'reviews' && record.isFollowUp && mainInRange.has(record.rootReviewId);
        });
        checkCanceled(token);
        snapshot[kind] = dedupe([...snapshot[kind], ...filtered], keyOf);
        processedPages += 1;
        Object.assign(checkpoint, { nextPage: page + 1, completedPages: processedPages, totalPages: result.totalPages,
          recordCount: snapshot[kind].length, unknownDateCount: snapshot[kind].filter(record => !dateOf(kind === 'orders' ? record.orderedAt : record.evaluatedAt)).length,
          lastPageSignature: signature, failedPages: checkpoint.failedPages || [],
          message: `${kind === 'orders' ? '订单' : '评价'}已读取 ${page}/${result.totalPages} 页，当前范围 ${snapshot[kind].length} 条。` });
        await ctx.writeJson(location(storeId), snapshot);
        progress(storeId, kind, checkpoint);
      };
      // 与参考实现一致：最多 3 页并发抓取，单页重试后仍失败只记录该页并继续其余页；
      // 只有登录失效或取消才整体停止（不会把一页验证码变成整店同步失败）。
      const startPage = checkpoint.nextPage;
      let first = prefetched;
      prefetched = null;
      if (!first) first = await fetchPage(startPage);
      await processPage(startPage, first);
      const totalPages = checkpoint.totalPages;
      // 单次读取的页数上限：超出时按“部分完成”停下，保留断点，再次同步可继续。
      const pageLimit = Math.min(totalPages, startPage - 1 + maxPagesPerKind);
      const remaining = [];
      for (let page = startPage + 1; page <= Math.min(totalPages, pageLimit); page++) remaining.push(page);
      const collected = new Map(), failures = [];
      let cursor = 0;
      const worker = async () => {
        for (;;) {
          const page = remaining[cursor++];
          if (page === undefined) return;
          try { collected.set(page, await fetchPage(page)); }
          catch (error) {
            checkCanceled(token);
            if (REVIEW_FATAL.has(error.code || error.message)) throw error;
            failures.push({ page, message: errorMessage(error) });
            checkpoint.failedPages = failures.slice();
            checkpoint.message = `第 ${page} 页读取失败，已记录并继续其余页（可再次同步重试）。`;
            progress(storeId, kind, checkpoint);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(REVIEW_CONCURRENCY, remaining.length)) }, worker));
      for (const page of remaining) {
        const result = collected.get(page);
        if (!result) continue;
        await processPage(page, result);
      }
      if (totalPages > pageLimit) {
        checkpoint.status = 'partial';
        checkpoint.failedPages = [...(checkpoint.failedPages || []), { page: pageLimit + 1, message: '超出单次读取页数上限' }];
        checkpoint.nextPage = pageLimit + 1;
        checkpoint.message = `${kind === 'orders' ? '订单' : '评价'}共 ${totalPages} 页，本次已读到第 ${pageLimit} 页；再次点击同步可继续读取剩余页。`;
      } else if (failures.length) {
        checkpoint.status = 'partial';
        checkpoint.failedPages = failures.slice();
        // 续传时从最早失败的页继续，成功页不会重复保存（去重按记录键）。
        checkpoint.nextPage = failures[0].page;
        checkpoint.message = `${kind === 'orders' ? '订单' : '评价'}已读取 ${checkpoint.completedPages}/${checkpoint.totalPages} 页，${failures.length} 页未取到（第 ${failures.slice(0, 5).map(item => item.page).join('、')}${failures.length > 5 ? ' 等' : ''} 页）。再次点击同步可从第 ${checkpoint.nextPage} 页继续。`;
      } else {
        checkpoint.status = 'completed';
        checkpoint.failedPages = [];
        checkpoint.message = `${kind === 'orders' ? '订单' : '评价'}已完整读取 ${checkpoint.totalPages} 页，共 ${checkpoint.recordCount} 条。`;
      }
      checkpoint.finishedAt = new Date().toISOString();
      await ctx.writeJson(location(storeId), snapshot);
      progress(storeId, kind, checkpoint);
    } catch (error) {
      checkpoint.status = (error.code || error.message) === 'CANCELED' ? 'canceled' : 'partial';
      checkpoint.message = errorMessage(error);
      checkpoint.failedPages = [{ page: checkpoint.nextPage, message: checkpoint.message }];
      await ctx.writeJson(location(storeId), snapshot);
      progress(storeId, kind, checkpoint);
      throw error;
    }
  }
  return {
    async handle(action, payload = {}) {
      const store = ctx.getStore(payload.storeId);
      const storeId = store.id;
      if (action === 'cancel') {
        const token = active.get(storeId);
        if (token) token.canceled = true;
        return { canceled: Boolean(token), message: token ? '正在取消，正在读取的页不会写入；已完成分页已保存。' : '当前没有正在同步的任务。' };
      }
      if (action === 'load') return view(await loadRaw(storeId));
      if (action === 'export') {
        const data = view(await loadRaw(storeId));
        const rows = data.rows.map(row => ({ ...row, images: row.images.join('\n'), reviewIds: row.reviewIds.join(',') }));
        return ctx.files.exportRows(`评价晒图_${store.name || '店铺'}`, rows, [
          { key: 'orderId', label: '主订单号' }, { key: 'subOrderId', label: '子订单号' }, { key: 'productId', label: '商品ID' },
          { key: 'title', label: '商品' }, { key: 'orderedAt', label: '下单时间' }, { key: 'reviewStatus', label: '评价状态' },
          { key: 'initialImageCount', label: '初评图片数' }, { key: 'followUpImageCount', label: '追评图片数' },
          { key: 'content', label: '评价内容' }, { key: 'images', label: '图片链接' }, { key: 'matchStatus', label: '匹配结果' },
        ]);
      }
      if (action !== 'sync') throw new Error('不支持的评价操作。');
      if (active.has(storeId)) throw new Error('本店铺正在同步，请等待完成或取消。');
      const kind = payload.kind || 'all';
      if (!['all', 'orders', 'reviews'].includes(kind)) throw new Error('无效的同步类型。');
      const range = validateRange(payload.start, payload.end);
      const token = { canceled: false };
      active.set(storeId, token);
      let snapshot;
      try {
        snapshot = await loadRaw(storeId);
        for (const selected of kind === 'all' ? ['orders', 'reviews'] : [kind]) {
          await syncKind(storeId, selected, range, snapshot, token, payload.restart === true);
        }
      } catch (error) {
        if (!snapshot) throw error;
        // Return the incomplete snapshot so the UI can show actionable diagnostics and saved rows.
        snapshot.message = errorMessage(error);
      } finally { active.delete(storeId); }
      return view(snapshot);
    },
    dispose() {
      for (const token of active.values()) token.canceled = true;
      for (const capture of captures.values()) capture.dispose();
      captures.clear();
    },
  };
}

module.exports = { createReviewService, matchReviews, dedupe, orderKey, reviewKey, validateRange };
