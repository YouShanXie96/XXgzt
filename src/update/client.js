'use strict';
// 更新源访问：拉索引、下载更新包。只做网络与校验，不碰文件系统。
const { normalizeBaseUrl, resolveUrl, sha256, validateIndex, HEX64 } = require('./manifest');

const DEFAULT_TIMEOUT_MS = 15000;
const PACKAGE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_INDEX_BYTES = 512 * 1024;
const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;

function createUpdateClient({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const base = normalizeBaseUrl(baseUrl);

  async function request(url, { timeout, limit, accept }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: accept, 'User-Agent': 'XXWorkbench-Updater/1.0' },
        signal: controller.signal,
        redirect: 'follow',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('连接更新服务超时，请稍后再试');
      throw new Error('无法连接更新服务，请检查网络');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 404) {
      const error = new Error('该更新源还没有发布任何版本');
      error.code = 'NOT_PUBLISHED';
      throw error;
    }
    if (!response.ok) throw new Error(`更新服务返回 HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > limit) throw new Error('更新内容体积异常');
    return response;
  }

  async function readIndex() {
    const response = await request(resolveUrl(base, 'latest.json'), {
      timeout: timeoutMs,
      limit: MAX_INDEX_BYTES,
      accept: 'application/json',
    });
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_INDEX_BYTES) throw new Error('更新索引过大');
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('更新索引不是有效的 JSON');
    }
    const index = validateIndex(payload);
    return { index, base };
  }

  async function download(packageRecord, { onProgress } = {}) {
    const url = resolveUrl(base, packageRecord.url);
    const response = await request(url, {
      timeout: PACKAGE_TIMEOUT_MS,
      limit: MAX_PACKAGE_BYTES,
      accept: 'application/octet-stream',
    });
    const total = Number(response.headers.get('content-length') || packageRecord.size || 0);
    const chunks = [];
    let received = 0;
    let lastEmit = 0;
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > MAX_PACKAGE_BYTES) throw new Error('更新包体积异常');
        chunks.push(Buffer.from(value));
        const now = Date.now();
        if (typeof onProgress === 'function' && (now - lastEmit > 120 || received === total)) {
          lastEmit = now;
          onProgress({ received, total });
        }
      }
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      received = buffer.length;
      chunks.push(buffer);
      if (typeof onProgress === 'function') onProgress({ received, total: received });
    }
    const bytes = Buffer.concat(chunks);
    if (packageRecord.size && bytes.length !== packageRecord.size) {
      throw new Error(`更新包大小不符（应为 ${packageRecord.size} 字节，实际 ${bytes.length}）`);
    }
    if (!HEX64.test(packageRecord.sha256) || sha256(bytes) !== packageRecord.sha256) {
      throw new Error('更新包校验失败，已丢弃');
    }
    return { bytes, url, total };
  }

  return Object.freeze({ base, readIndex, download });
}

module.exports = { createUpdateClient, DEFAULT_TIMEOUT_MS, PACKAGE_TIMEOUT_MS };
