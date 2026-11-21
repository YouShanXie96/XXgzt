'use strict';

// 后台保活：对“已登录”的店铺每 5–10 分钟随机间隔做一次隐藏窗口复核，
// 让用户点进店铺登录页或开始同步时，状态已经是现成的。
// 定时器 unref，不阻止进程退出；回调内部自行去重、暂停与取消。
const MIN_MS = 5 * 60_000;
const MAX_MS = 10 * 60_000;
function randomDelay(random = Math.random, minMs = MIN_MS, maxMs = MAX_MS) {
  const value = Math.min(1, Math.max(0, Number(random()) || 0));
  return Math.round(minMs + (maxMs - minMs) * value);
}
function createStoreSessionKeepAlive({ run, minMs = MIN_MS, maxMs = MAX_MS, random = Math.random, schedule, clear, onError } = {}) {
  if (typeof run !== 'function') throw new TypeError('保活需要复核函数');
  const timers = new Map();
  let running = false;
  const stopTimer = clear || ((timer) => clearTimeout(timer));
  const arm = (storeId) => {
    if (!running || timers.has(storeId)) return;
    const timer = (schedule || ((callback, delay) => { const value = setTimeout(callback, delay); value.unref?.(); return value; }))(() => {
      timers.delete(storeId);
      Promise.resolve().then(() => run(storeId))
        .catch(error => { try { onError?.(storeId, error); } catch {} })
        .finally(() => { if (running) arm(storeId); });
    }, randomDelay(random, minMs, maxMs));
    timers.set(storeId, timer);
  };
  return {
    start() { running = true; },
    stop() { running = false; for (const timer of timers.values()) stopTimer(timer); timers.clear(); },
    update(storeId, eligible) {
      if (!running) return;
      if (eligible) { arm(storeId); return; }
      const timer = timers.get(storeId);
      if (timer) { stopTimer(timer); timers.delete(storeId); }
    },
    get size() { return timers.size; }
  };
}
module.exports = { createStoreSessionKeepAlive, randomDelay, MIN_MS, MAX_MS };
