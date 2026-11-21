'use strict';

const { assertSourceUrl } = require('./common');
const { parseRequestIdentity, parseTrendPayload } = require('./trend-data');

function allowedResponseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'alimama.com' || url.hostname.endsWith('.alimama.com') || url.hostname === 'simba.taobao.com' || url.hostname.endsWith('.simba.taobao.com')) &&
      !/login|passport|token|auth|account|password|userinfo/i.test(url.pathname);
  } catch { return false; }
}

function parseJsonBody(body) {
  const text = String(body || '').trim();
  if (!text || text.length > 4 * 1024 * 1024) return null;
  try { return JSON.parse(text); }
  catch {
    // JSONP: unwrap a callback identifier; never evaluate response JavaScript.
    const match = text.match(/^[\w.$]+\s*\(([\s\S]*)\)\s*;?$/);
    if (match) { try { return JSON.parse(match[1]); } catch {} }
    return null;
  }
}

async function withinDeadline(operation, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

function createTrafficObserver({ commandTimeoutMs = 5000, bootstrapTimeoutMs = 5000 } = {}) {
  const states = new Map();
  let disposed = false;
  async function prepare(wc, kind) {
    if (disposed || !['traffic', 'trends'].includes(kind)) return;
    const previous = states.get(wc);
    if (previous?.attached && wc.debugger?.isAttached()) return;
    // Browser windows are hidden/reused, so a detached observer must be reconnectable.
    previous?.stop?.();
    states.delete(wc);
    const state = { pending: new Map(), batches: [], attached: false, error: '', lastBodyAt: '', closed: false };
    states.set(wc, state);
    if (!wc.debugger) { state.error = '当前浏览器不支持被动数据读取'; return; }
    if (wc.debugger.isAttached()) { state.error = '页面调试连接被占用，请关闭开发者工具后重新打开该后台'; return; }
    const stop = () => {
      state.closed = true;
      wc.debugger.removeListener('message', onMessage);
      wc.debugger.removeListener('detach', onDetach);
      wc.removeListener?.('destroyed', stop);
      if (state.attached && wc.debugger.isAttached()) { try { wc.debugger.detach(); } catch {} }
      state.pending.clear(); state.batches.length = 0;
      states.delete(wc);
    };
    const onDetach = () => { state.attached = false; state.error = '数据观察已断开，请再次点击采集恢复观察，然后在后台重新查询'; state.pending.clear(); state.batches.length = 0; };
    const onMessage = async (_event, method, params) => {
      if (disposed || state.closed) return;
      try {
        assertSourceUrl('trends', wc.getURL());
        if (method === 'Network.requestWillBeSent') {
          if (!['XHR', 'Fetch'].includes(params.type) || !allowedResponseUrl(params.request?.url)) return;
          // Raw requests/headers never enter retained state. Keep only a small identity whitelist.
          const pageIdentity = parseRequestIdentity(wc.getURL());
          const identity = parseRequestIdentity(params.request.url, params.request.postData, pageIdentity);
          state.pending.set(params.requestId, { identity, requestedAt: new Date().toISOString(), eligible: false });
          if (state.pending.size > 100) state.pending.delete(state.pending.keys().next().value);
        } else if (method === 'Network.responseReceived') {
          const request = state.pending.get(params.requestId);
          if (!request) return;
          request.eligible = allowedResponseUrl(params.response?.url) && Number(params.response?.status) === 200 &&
            /json|javascript|text\/plain/i.test(params.response?.mimeType || '') && Number(params.response?.encodedDataLength || 0) < 4 * 1024 * 1024;
        } else if (method === 'Network.loadingFailed') {
          state.pending.delete(params.requestId);
        } else if (method === 'Network.loadingFinished') {
          const request = state.pending.get(params.requestId);
          state.pending.delete(params.requestId);
          if (!request?.eligible || Number(params.encodedDataLength || 0) > 4 * 1024 * 1024) return;
          const result = await wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId });
          if (state.closed || disposed) return;
          const json = parseJsonBody(result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body);
          if (!json) return;
          const receivedAt = new Date().toISOString();
          const batches = parseTrendPayload(json, request.identity).filter(batch => batch.identity.keyword);
          for (const batch of batches) state.batches.push({ ...batch, requestedAt: request.requestedAt, receivedAt });
          if (batches.length) state.lastBodyAt = receivedAt;
          state.batches = state.batches.slice(-40);
        }
      } catch { /* An unrelated response, navigation, or unavailable body cannot become a successful capture. */ }
    };
    state.stop = stop;
    try {
      wc.once?.('destroyed', stop);
      // Electron 44 can leave CDP commands pending until the first renderer has
      // started. Bootstrap only a never-loaded window, before observing its real
      // platform navigation; an existing merchant page must remain untouched.
      if (!wc.getURL()) {
        await withinDeadline(() => wc.loadURL('about:blank'), bootstrapTimeoutMs, '初始化数据页面超时');
      }
      if (disposed || state.closed || wc.isDestroyed?.()) return;
      wc.debugger.attach('1.3');
      state.attached = true;
      wc.debugger.on('message', onMessage);
      wc.debugger.on('detach', onDetach);
      await withinDeadline(() => wc.debugger.sendCommand('Network.enable', { maxResourceBufferSize: 4 * 1024 * 1024, maxTotalBufferSize: 12 * 1024 * 1024 }), commandTimeoutMs, '启动网络数据观察超时');
    } catch (error) {
      wc.debugger.removeListener('message', onMessage);
      wc.debugger.removeListener('detach', onDetach);
      state.error = '无法启动只读数据观察：' + error.message;
      if (state.attached) { try { wc.debugger.detach(); } catch {} state.attached = false; }
    }
  }
  function read(wc) {
    const state = states.get(wc);
    return { batches: state?.batches || [], observing: !!state?.attached, error: state?.error || '', lastBodyAt: state?.lastBodyAt || '' };
  }
  function dispose() { disposed = true; for (const state of [...states.values()]) state.stop?.(); states.clear(); }
  return { prepare, read, dispose };
}

module.exports = { createTrafficObserver, allowedResponseUrl, parseJsonBody };
