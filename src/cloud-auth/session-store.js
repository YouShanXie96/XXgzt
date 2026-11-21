'use strict';

const { atomicWrite } = require('../lib/storage');

const SESSION_FILE = 'cloud-auth/session.json';
const FORMAT = 'xx-cloud-auth-session-v1';
// 兼容改名前的历史登录态文件（xh- 前缀）。
const LEGACY_FORMAT = 'xh-cloud-auth-session-v1';

function createCloudAuthSessionStore({ dataDir, storage, safeStorage }) {
  if (!dataDir) throw new Error('缺少本地数据目录');
  if (!storage) throw new Error('缺少本地存储服务');
  async function read() {
    const record = await storage.readJson(SESSION_FILE, null);
    if (!record || (record.format !== FORMAT && record.format !== LEGACY_FORMAT) || !record.payload) return null;
    if (!safeStorage?.isEncryptionAvailable?.()) throw new Error('Windows 安全存储当前不可用，请重新登录');
    let plain;
    try {
      plain = safeStorage.decryptString(Buffer.from(String(record.payload), 'base64'));
      const session = JSON.parse(plain);
      if (!session || typeof session !== 'object') return null;
      return session;
    } catch {
      throw new Error('保存的登录凭据无法读取，请重新登录');
    }
  }
  async function write(session) {
    if (!session || typeof session !== 'object') return false;
    if (!safeStorage?.isEncryptionAvailable?.()) return false;
    const payload = safeStorage.encryptString(JSON.stringify(session)).toString('base64');
    await atomicWrite(dataDir, SESSION_FILE, JSON.stringify({ format: FORMAT, payload }, null, 2));
    return true;
  }
  async function clear() {
    await atomicWrite(dataDir, SESSION_FILE, JSON.stringify({ format: FORMAT, empty: true }, null, 2));
  }
  return Object.freeze({ read, write, clear });
}

module.exports = { createCloudAuthSessionStore, SESSION_FILE, FORMAT };
