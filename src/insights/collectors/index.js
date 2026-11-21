'use strict';

const { createBrowserAdapter } = require('./browser-adapter');
const { createTrafficObserver } = require('./traffic-observer');
const { captureBusiness } = require('./business');
const { captureTrends } = require('./trends');
const { capturePeers } = require('./peers');

function createCollectors(ctx) {
  const adapter = createBrowserAdapter(ctx);
  const observer = createTrafficObserver();
  const captures = {
    business: captureBusiness,
    trends: (page, payload) => captureTrends(page, payload, observer),
    peers: capturePeers,
  };
  return {
    // Call before loadURL on newly created Electron pages to observe initial traffic queries.
    prepare: (webContents, kind) => observer.prepare(webContents, kind),
    capture: (kind, payload = {}) => {
      if (!captures[kind]) return Promise.reject(new Error('不支持的数据采集类型'));
      return adapter.run(kind, payload, page => captures[kind](page, payload));
    },
    cancel: storeId => adapter.cancel(storeId),
    dispose() { adapter.dispose(); observer.dispose(); },
  };
}

module.exports = { createCollectors };
