'use strict';
// 启动引导：在加载主程序之前，把上一次下载好的更新真正应用上去。
// 这里必须尽量“不依赖业务代码”，任何异常都要吞掉，保证软件能起来。
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = __dirname;

function logLine(message) {
  try {
    const target = path.join(path.dirname(process.execPath), '用户数据', 'updates', 'boot.log');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

function resolveDataDir(electronApp) {
  if (process.env.XX_DATA_DIR) return path.resolve(process.env.XX_DATA_DIR);
  if (!electronApp?.isPackaged) return path.resolve(APP_DIR, '..', '.dev-data');
  try {
    const { selectPackagedDataDir } = require('./src/lib/data-paths');
    return selectPackagedDataDir(path.dirname(process.execPath));
  } catch {
    return path.join(path.dirname(process.execPath), '用户数据');
  }
}

function isStandalone() {
  if (process.env.XX_STANDALONE === '1') return true;
  try {
    return fs.existsSync(path.join(path.dirname(process.execPath), 'standalone.mode'))
      || fs.existsSync(path.join(APP_DIR, '..', 'standalone.mode'));
  } catch {
    return false;
  }
}

let bootResult = { status: 'skipped' };
try {
  const { app } = require('electron');
  if (app?.isPackaged && !isStandalone()) {
    const dataDir = resolveDataDir(app);
    const { applyPending } = require('./src/update/apply');
    bootResult = applyPending({ appDir: APP_DIR, dataDir });
    if (bootResult.status !== 'none') logLine(`更新引导结果：${JSON.stringify(bootResult)}`);
  }
} catch (error) {
  bootResult = { status: 'failed', error: String(error?.message || error) };
  logLine(`更新引导失败：${bootResult.error}`);
}

// 主进程启动后可以直接读这个值，决定要不要提示“已更新到 vX”。
globalThis.__xxUpdateBoot = bootResult;

require('./src/main.js');
