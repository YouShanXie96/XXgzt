'use strict';

const { createHash } = require('node:crypto');
const { validateDataset, validateKind, summarizeDataset } = require('../domain/datasets');
const { parseRecommendations, recommendationKey } = require('../domain/recommendations');
const { identifier, text } = require('../domain/validation');

const storeDirectory = storeId => `insights/${createHash('sha256').update(storeId).digest('hex').slice(0, 32)}`;

function createInsightRepository(ctx) {
  for (const key of ['getStore', 'readJson', 'writeJson']) {
    if (typeof ctx[key] !== 'function') throw new Error(`数据仓库缺少 ${key}`);
  }
  const queues = new Map();

  async function getStore(storeId) {
    identifier(storeId, '店铺ID');
    const store = await ctx.getStore(storeId);
    if (!store || store.id !== storeId) throw new Error('店铺不存在');
    return store;
  }

  function enqueue(storeId, work) {
    const operation = (queues.get(storeId) || Promise.resolve()).catch(() => {}).then(work);
    queues.set(storeId, operation);
    return operation.finally(() => { if (queues.get(storeId) === operation) queues.delete(storeId); });
  }

  async function waitWrites(storeId) {
    while (queues.has(storeId)) await queues.get(storeId);
  }

  async function readIndex(storeId) {
    const result = await ctx.readJson(`${storeDirectory(storeId)}/index.json`, { schemaVersion: 1, storeId, datasets: [] });
    if (result.schemaVersion !== 1 || result.storeId !== storeId || !Array.isArray(result.datasets)) throw new Error('数据批次索引无效，请从备份恢复');
    const ids = new Set();
    for (const summary of result.datasets) {
      identifier(summary.id);
      validateKind(summary.kind);
      if (summary.storeId !== storeId || ids.has(summary.id) || !Number.isSafeInteger(summary.rowCount) || summary.rowCount < 1) throw new Error('数据批次索引与店铺不一致');
      ids.add(summary.id);
    }
    return result;
  }

  async function listDatasets(storeId, kind) {
    await getStore(storeId);
    if (kind) validateKind(kind);
    await waitWrites(storeId);
    const index = await readIndex(storeId);
    return structuredClone(index.datasets.filter(item => !kind || item.kind === kind).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id)));
  }

  async function saveDatasets(inputs) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 1000) throw new Error('一次最多保存1000个数据批次');
    const store = await getStore(inputs[0]?.storeId);
    if (inputs.some(input => input?.storeId !== store.id)) throw new Error('一个保存批次只能包含同一家店铺的数据');
    const datasets = inputs.map(input => validateDataset({ ...input, storeId: store.id, storeName: store.name,
      context: { ...input.context, accountName: input.context?.accountName || input.storeName || '' } }));
    if (new Set(datasets.map(dataset => dataset.id)).size !== datasets.length) throw new Error('待保存的批次ID重复');
    return enqueue(store.id, async () => {
      const index = await readIndex(store.id);
      const existing = new Set(index.datasets.map(item => item.id));
      if (datasets.some(dataset => existing.has(dataset.id))) throw new Error('批次ID已存在，原始快照不可覆盖，请重新采集生成新批次');
      const paths = datasets.map(dataset => `${storeDirectory(store.id)}/datasets/${dataset.id}.json`);
      const files = await Promise.all(paths.map(name => ctx.readJson(name, null)));
      if (files.some(Boolean)) throw new Error('批次文件已存在，请使用新的批次ID');
      // Snapshot first, index last: a failed index write cannot expose an incomplete batch.
      // An unindexed snapshot can only result from an interrupted/failed write; it is never reused.
      for (let i = 0; i < datasets.length; i++) await ctx.writeJson(paths[i], datasets[i]);
      index.datasets.push(...datasets.map(summarizeDataset));
      await ctx.writeJson(`${storeDirectory(store.id)}/index.json`, index);
      return structuredClone(datasets);
    });
  }

  async function saveDataset(input) {
    return (await saveDatasets([input]))[0];
  }

  async function loadDataset(storeId, id) {
    await getStore(storeId);
    identifier(id);
    await waitWrites(storeId);
    const index = await readIndex(storeId);
    if (!index.datasets.some(item => item.id === id)) throw new Error('当前店铺中不存在该数据批次');
    const raw = await ctx.readJson(`${storeDirectory(storeId)}/datasets/${id}.json`, null);
    if (!raw || raw.storeId !== storeId || raw.id !== id) throw new Error('数据批次文件缺失或店铺不匹配，请从备份恢复');
    return validateDataset(raw);
  }

  async function readRecommendations(storeId) {
    const result = await ctx.readJson(`${storeDirectory(storeId)}/recommendations.json`, { schemaVersion: 1, storeId, rows: [], updatedAt: null });
    if (result.schemaVersion !== 1 || result.storeId !== storeId || !Array.isArray(result.rows)) throw new Error('月份推荐数据无效，请从备份恢复');
    const keys = new Set();
    for (const row of result.rows) {
      if (row.key !== recommendationKey(row) || keys.has(row.key) || !Number.isSafeInteger(row.version) || row.version < 1 || !Array.isArray(row.history)) throw new Error('月份推荐版本数据无效，请从备份恢复');
      keys.add(row.key);
    }
    return result;
  }

  async function loadRecommendations(storeId) {
    await getStore(storeId);
    await waitWrites(storeId);
    const state = await readRecommendations(storeId);
    if (state.rows.length) parseRecommendations(state.rows, (await readIndex(storeId)).datasets);
    return structuredClone(state.rows);
  }

  async function mergeRecommendations(storeId, inputRows, meta = {}) {
    await getStore(storeId);
    return enqueue(storeId, async () => {
      const index = await readIndex(storeId);
      // Revalidate inside the serialization boundary, including for callers that already previewed.
      const validated = parseRecommendations(inputRows, index.datasets);
      const state = await readRecommendations(storeId);
      if (state.rows.length) parseRecommendations(state.rows, index.datasets);
      const rowsByKey = new Map(state.rows.map(row => [row.key, row]));
      const importedAt = new Date().toISOString();
      const sourceName = text(meta.sourceName || meta.fileName || '', '导入文件名称', { max: 500 });
      let added = 0, updated = 0;
      for (const row of validated) {
        const old = rowsByKey.get(row.key);
        const history = old ? [...old.history, Object.fromEntries(Object.entries(old).filter(([key]) => key !== 'history'))] : [];
        rowsByKey.set(row.key, { ...row, version: old ? old.version + 1 : 1, history, importedAt, sourceName });
        if (old) updated++; else added++;
      }
      const rows = [...rowsByKey.values()].sort((a, b) => a.recommendedMonth - b.recommendedMonth || a.keyword.localeCompare(b.keyword, 'zh-CN'));
      // One atomic file replacement commits the complete import plus every previous version.
      await ctx.writeJson(`${storeDirectory(storeId)}/recommendations.json`, { schemaVersion: 1, storeId, updatedAt: importedAt, rows });
      return { added, updated, total: rows.length, rows: structuredClone(rows) };
    });
  }

  return { listDatasets, saveDataset, saveDatasets, loadDataset, loadRecommendations, mergeRecommendations };
}

module.exports = { createInsightRepository, storeDirectory };
