'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createStorage } = require('../src/lib/storage');
const { createSelectionPoolRepository } = require('../src/selectionpool/repository');
const { createPublicationService } = require('../src/selectionpool/publication');
const { createSelectionPoolService } = require('../src/selectionpool/service');

function makeMemCtx(overrides = {}) {
  const store = new Map();
  return {
    dataDir: overrides.dataDir || os.tmpdir(),
    readJson: async (file, fallback) => (store.has(file) ? JSON.parse(JSON.stringify(store.get(file))) : fallback),
    writeJson: async (file, val) => { store.set(file, JSON.parse(JSON.stringify(val))); },
    listStores: () => overrides.stores || [],
    readAccountState: overrides.readAccountState || (async () => ({ loggedIn: false, label: '未登录' })),
    emit: overrides.emit || (() => {}),
    ...overrides,
  };
}

test('duplicate single-product plugin submissions create new records instead of overwriting', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'xxgzt-ingest-'));
  try {
    const storage = createStorage(tmp);
    const service = createSelectionPoolService({
      dataDir: tmp,
      ...storage,
      listStores: () => [],
      readAccountState: async () => ({ loggedIn: false, label: '未登录' }),
      emit: () => {},
    }, { pluginAutoUpdate: false, autoIngest: false });

    const started = await service.handle('startIngest', { port: 0 });
    assert.equal(started.ok, true);
    const endpoint = `http://127.0.0.1:${started.port}/api/selection-pool/v1/items`;

    const req1 = 'req_first_submit_1234567890';
    const r1 = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: req1,
        capture: {
          productId: '987654321',
          platform: 'taobao',
          title: '测试零食第一版',
          priceFen: 1990,
          categoryId: '50010550',
          categoryPath: '零食 / 酱料',
        },
      }),
    }).then(res => res.json());

    assert.equal(r1.action, 'created');
    assert.equal(r1.replayed, false);

    // Exact same request_id replays idempotently
    const r1Replay = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: req1,
        capture: { productId: '987654321', platform: 'taobao', title: '不应该覆盖' },
      }),
    }).then(res => res.json());
    assert.equal(r1Replay.action, 'unchanged');
    assert.equal(r1Replay.replayed, true);
    assert.equal(r1Replay.item_id, r1.item_id);

    // Second submission of the SAME product_id & platform with a new request_id creates a NEW record
    const r2 = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: 'req_second_submit_123456789',
        capture: {
          productId: '987654321',
          platform: 'taobao',
          title: '测试零食第二版',
          priceFen: 2590,
          categoryId: '50010550',
          categoryPath: '零食 / 酱料',
        },
      }),
    }).then(res => res.json());

    assert.equal(r2.action, 'created');
    assert.equal(r2.replayed, false);
    assert.notEqual(r2.item_id, r1.item_id);

    // Third submission with no request_id also creates a NEW record
    const r3 = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capture: {
          productId: '987654321',
          platform: 'taobao',
          title: '测试零食第三版',
          priceFen: 2990,
        },
      }),
    }).then(res => res.json());

    assert.equal(r3.action, 'created');
    assert.notEqual(r3.item_id, r1.item_id);
    assert.notEqual(r3.item_id, r2.item_id);

    const listed = await service.handle('list', {});
    assert.equal(listed.total, 3);
    assert.equal(listed.items.find(x => x.itemId === r1.item_id).title, '测试零食第一版');
    assert.equal(listed.items.find(x => x.itemId === r2.item_id).title, '测试零食第二版');
    assert.equal(listed.items.find(x => x.itemId === r3.item_id).title, '测试零食第三版');

    await service.dispose();
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

test('queueRemove supports single, multi, and select-all removal while protecting running items', async () => {
  const ctx = makeMemCtx();
  const repo = createSelectionPoolRepository(ctx);
  const pub = createPublicationService({ repo, ctx, emit: () => {} });

  await pub.queuePatch({
    running: true,
    runId: 'run-test-1',
    items: [
      { queueId: 'q-1', itemId: 101, title: '正在上架品', shopId: 's1', shopName: '店铺A', status: 'running' },
      { queueId: 'q-2', itemId: 102, title: '排队品二', shopId: 's1', shopName: '店铺A', status: 'queued' },
      { queueId: 'q-3', itemId: 103, title: '排队品三', shopId: 's1', shopName: '店铺A', status: 'queued' },
      { queueId: 'q-4', itemId: 104, title: '排队品四', shopId: 's1', shopName: '店铺A', status: 'queued' },
    ],
  });

  // Single removal + attempt to remove running item q-1
  const res1 = await pub.queueRemove({ queueIds: ['q-1', 'q-2'] });
  assert.equal(res1.removedCount, 1);
  assert.equal(res1.skippedRunning, 1);
  assert.deepEqual(res1.queue.items.map(i => i.queueId), ['q-1', 'q-3', 'q-4']);
  assert.equal(res1.queue.total, 3);

  // Multi / select-all removal of remaining queued items
  const res2 = await pub.queueRemove({ queueIds: ['q-3', 'q-4'] });
  assert.equal(res2.removedCount, 2);
  assert.deepEqual(res2.queue.items.map(i => i.queueId), ['q-1']);
  assert.equal(res2.queue.total, 1);
});

test('autoShelf supports appending new items into active queue without clobbering progress', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'xxgzt-queue-'));
  try {
    const storage = createStorage(tmp);
    const stores = [{ id: 'store-1', name: '测试旗舰店' }];
    const service = createSelectionPoolService({
      dataDir: tmp,
      ...storage,
      listStores: () => stores,
      readAccountState: async () => ({ loggedIn: true, label: '已登录' }),
      emit: () => {},
    }, { pluginAutoUpdate: false, autoIngest: false });

    const a = await service.repository.ingest({ product_id: 'p1', title: '商品一', snapshot: { category_id: '101', category_path: '类目/一' } });
    const b = await service.repository.ingest({ product_id: 'p2', title: '商品二', snapshot: { category_id: '101', category_path: '类目/一' } });
    const c = await service.repository.ingest({ product_id: 'p3', title: '商品三', snapshot: { category_id: '101', category_path: '类目/一' } });

    let releaseFirst = null;
    const firstStarted = new Promise(resolve => {
      service.setDriver({
        publish: async ({ detail }) => {
          if (detail.itemId === a.itemId) {
            resolve();
            await new Promise(r => { releaseFirst = r; });
          }
          return { warehouseItemId: `wh-${detail.itemId}` };
        },
      });
    });

    const startRes = await service.handle('startAutoShelf', { itemIds: [a.itemId, b.itemId], storeIds: ['store-1'] });
    assert.equal(startRes.ok, true);
    assert.equal(startRes.started, true);
    assert.equal(startRes.total, 2);

    await firstStarted;

    // Append item c while item a is actively running
    const appendRes = await service.handle('queueAppend', { itemIds: [c.itemId], storeIds: ['store-1'] });
    assert.equal(appendRes.ok, true);
    assert.equal(appendRes.appended, true);
    assert.equal(appendRes.runId, startRes.runId);
    assert.equal(appendRes.total, 3);

    // Also remove item b before it starts running
    const midQueue = await service.handle('queueStatus', {});
    const itemBQueue = midQueue.items.find(x => x.itemId === b.itemId);
    assert.equal(itemBQueue.status, 'queued');
    const remRes = await service.handle('queueRemove', { queueIds: [itemBQueue.queueId] });
    assert.equal(remRes.removedCount, 1);

    // Let item a finish; loop should skip removed item b and process appended item c
    releaseFirst();

    for (let i = 0; i < 60; i++) {
      const q = await service.handle('queueStatus', {});
      if (!q.running) break;
      await new Promise(r => setTimeout(r, 25));
    }

    const doneQueue = await service.handle('queueStatus', {});
    assert.equal(doneQueue.running, false);
    assert.equal(doneQueue.ok, 2);
    assert.equal(doneQueue.fail, 0);
    assert.deepEqual(doneQueue.items.map(x => x.itemId), [a.itemId, c.itemId]);
    assert.ok(doneQueue.items.every(x => x.status === 'done'));

    await service.dispose();
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
