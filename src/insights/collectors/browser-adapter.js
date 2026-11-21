'use strict';

const { SOURCES, assertSourceUrl } = require('./common');

function canceledError() {
  const error = new Error('数据采集已取消');
  error.code = 'CAPTURE_CANCELED';
  return error;
}

function createBrowserAdapter(ctx, { timeoutMs = 20000 } = {}) {
  const jobs = new Map();
  let disposed = false;

  function cancel(storeId) {
    const job = jobs.get(storeId);
    if (job) job.abort.abort();
    return { canceled: !!job };
  }

  function checkpoint(job) {
    if (disposed || job.abort.signal.aborted) throw canceledError();
  }

  async function wait(job, operation, message) {
    checkpoint(job);
    let timer, onAbort;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          onAbort = () => reject(canceledError());
          job.abort.signal.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      job.abort.signal.removeEventListener('abort', onAbort);
    }
  }

  async function run(kind, payload, worker) {
    if (disposed) throw new Error('数据采集服务已关闭');
    if (!SOURCES[kind]) throw new Error('不支持的数据采集类型');
    const store = ctx.getStore(payload.storeId);
    if (jobs.has(store.id)) throw new Error('该店铺已有数据采集进行中，请等待或取消后重试');
    const job = { abort: new AbortController() };
    jobs.set(store.id, job);
    try {
      ctx.emit?.({ module: 'insights', storeId: store.id, kind, message: `正在读取 ${SOURCES[kind].label} 当前查询结果…` });
      const wc = await wait(job, () => ctx.browser.page(store.id, SOURCES[kind].browserKind, { show: false }), '后台页面加载超时，请打开来源页面检查登录状态');
      checkpoint(job);
      if (wc.isDestroyed?.()) throw new Error('后台页面已关闭，请重新打开');
      const initialUrl = assertSourceUrl(kind, wc.getURL());
      const read = async script => {
        checkpoint(job);
        assertSourceUrl(kind, wc.getURL());
        const result = await wait(job, () => wc.executeJavaScript(script, false), '读取后台数据超时，请确认页面已经加载完成后重试');
        checkpoint(job);
        if (wc.isDestroyed?.()) throw new Error('采集过程中后台页面已关闭');
        assertSourceUrl(kind, wc.getURL());
        if (result?.url) assertSourceUrl(kind, result.url);
        return result;
      };
      const draft = await worker({ read, store, webContents: wc, sourceUrl: initialUrl, checkpoint: () => checkpoint(job) });
      checkpoint(job);
      if (!draft?.rows?.length) throw new Error('未读取到有效数据，本次未保存，请检查查询范围和页面加载状态');
      ctx.emit?.({ module: 'insights', storeId: store.id, kind, message: `已读取 ${draft.rows.length} 行，正在保存…`, current: draft.rows.length, total: draft.rows.length });
      return { ...draft, kind, source: SOURCES[kind].browserKind, storeId: store.id, storeName: store.name,
        capturedAt: new Date().toISOString(), context: { ...draft.context, sourceUrl: initialUrl } };
    } finally {
      if (jobs.get(store.id) === job) jobs.delete(store.id);
    }
  }

  function dispose() {
    disposed = true;
    for (const job of jobs.values()) job.abort.abort();
    jobs.clear();
  }
  return { run, cancel, dispose };
}

module.exports = { createBrowserAdapter, canceledError };
