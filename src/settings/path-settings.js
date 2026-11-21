'use strict';
// Machine-local locations. Never move sessionData, Cookie databases or business data.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');

const SETTINGS_FILE = 'path-settings.json';
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const folded = value => path.resolve(value).toLowerCase();
const contains = (parent, target) => {
  const relative = path.relative(folded(parent), folded(target));
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const overlaps = (first, second) => contains(first, second) || contains(second, first);

function normalizedDirectory(value) {
  if (typeof value !== 'string' || !value || value.length > 220 || value !== value.trim()
    || /[\x00-\x1f]/.test(value) || !path.isAbsolute(value) || /^[/\\]{2}/.test(value)
    || process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(value)) throw new Error('请选择本机磁盘上的完整文件夹路径。');
  const result = path.resolve(value);
  const root = path.parse(result).root;
  const parts = result.slice(root.length).split(path.sep);
  if (result === root || parts.some(part => !part || /[ .]$/.test(part) || /[<>:"|?*]/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('不能使用磁盘根目录或特殊目录名称，请选择专用文件夹。');
  return result;
}

async function assertOrdinaryDirectory(directory, {create = false} = {}) {
  const root = path.parse(directory).root;
  let current = root;
  for (const piece of directory.slice(root.length).split(path.sep)) {
    current = path.join(current, piece);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw new Error('文件夹不存在或无法访问，请重新选择。');
      await fs.mkdir(current);
      stat = await fs.lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('文件夹不能包含链接、目录联接或普通文件。');
  }
  return directory;
}

async function checkWritable(directory) {
  const probe = path.join(directory, `.xx-write-check-${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await fs.open(probe, 'wx', 0o600); created = true;
    try { await handle.writeFile('XX'); await handle.sync(); } finally { await handle.close(); }
  } catch { throw new Error('所选文件夹不可写，请选择有写入权限的本机文件夹。'); }
  finally { if (created) await fs.unlink(probe); }
}

function createPathSettings({dataDir, appDir, sourceDir, readJson, writeJson, dialog, getWindow, defaultExportDir, protectedDirs = []}) {
  const protectedPaths = [dataDir, appDir, sourceDir, ...protectedDirs].filter(Boolean).map(value => path.resolve(value));
  let settings = {cacheDir: '', exportDir: ''};
  let activeCacheDir = '', activeExportDir = '', startupWarning = '', sessionWarning = '', exportWarning = '', queue = Promise.resolve();
  const instanceId = digest(folded(dataDir));
  const defaultCacheLabel = path.join(dataDir, 'browser');

  async function validate(value, kind, other = settings) {
    const target = normalizedDirectory(value);
    if (protectedPaths.some(location => overlaps(location, target))) throw new Error('不能使用程序、源码、登录或业务数据所在目录及其上级目录，请另选专用文件夹。');
    const otherPath = kind === 'cache' ? other.exportDir || defaultExportDir : other.cacheDir;
    if (otherPath && overlaps(target, otherPath)) throw new Error('缓存文件夹与导出文件夹不能相同或互相包含。');
    await assertOrdinaryDirectory(target);
    // Windows 8.3 names and mapped drive aliases may not be symlinks. Compare
    // real locations before writing even the permission probe.
    const canonical = normalizedDirectory(await fs.realpath(target));
    for (const location of protectedPaths) {
      const real = await fs.realpath(location).catch(error => {if (error.code === 'ENOENT') return location; throw error;});
      if (overlaps(real, canonical)) throw new Error('所选目录实际位于程序、源码、登录或业务数据目录中，请另选专用文件夹。');
    }
    if (otherPath) {
      const realOther = await fs.realpath(otherPath).catch(error => {if (error.code === 'ENOENT') return otherPath; throw error;});
      if (overlaps(realOther, canonical)) throw new Error('缓存文件夹与导出文件夹不能相同或互相包含。');
    }
    await assertOrdinaryDirectory(canonical);
    await checkWritable(canonical);
    return canonical;
  }
  function view() {
    return {
      cacheDir: settings.cacheDir, exportDir: settings.exportDir,
      activeCacheDir: activeCacheDir || defaultCacheLabel,
      defaultCacheDir: defaultCacheLabel,
      effectiveExportDir: activeExportDir || defaultExportDir || '',
      cacheRequiresRestart: folded(settings.cacheDir || defaultCacheLabel) !== folded(activeCacheDir || defaultCacheLabel),
      cacheScope: '页面脚本缓存', warning: [startupWarning, sessionWarning, exportWarning].filter(Boolean).join(' ')
    };
  }
  async function initialize() {
    try {
      const saved = await readJson(SETTINGS_FILE, {});
      settings = {cacheDir: typeof saved?.cacheDir === 'string' ? saved.cacheDir : '', exportDir: typeof saved?.exportDir === 'string' ? saved.exportDir : ''};
    } catch (error) {
      startupWarning = `本机文件位置配置无法读取，当前使用默认位置：${error.message}`;
    }
    if (settings.cacheDir) {
      try {activeCacheDir = await validate(settings.cacheDir, 'cache');}
      catch (error) {activeCacheDir = ''; startupWarning = `缓存位置未启用，当前使用原位置：${error.message}`;}
    }
    await resolveExportDirectory();
    return view();
  }
  async function resolveExportDirectory() {
    activeExportDir = ''; exportWarning = '';
    if (!settings.exportDir) return defaultExportDir || '';
    try {activeExportDir = await validate(settings.exportDir, 'export');}
    catch (error) {exportWarning = `原导出位置不可用，已改用系统文档目录；可在设置中重新选择。${error.message}`;}
    return activeExportDir || defaultExportDir || '';
  }
  // Electron 44 keeps HTTP cache next to each session. Only this documented API
  // can relocate generated code cache without redirecting the login profile.
  // https://www.electronjs.org/docs/latest/api/session#sessetcodecachepathpath
  function configureSession(ses) {
    if (!activeCacheDir || !ses?.storagePath || typeof ses.setCodeCachePath !== 'function') return;
    try {
      const target = path.join(activeCacheDir, '谢谢工作台脚本缓存', instanceId, digest(folded(ses.storagePath)));
      let current = path.parse(target).root;
      for (const piece of target.slice(current.length).split(path.sep)) {
        current = path.join(current, piece);
        let stat;
        try { stat = fsSync.lstatSync(current); }
        catch (error) { if (error.code !== 'ENOENT') throw error; fsSync.mkdirSync(current); stat = fsSync.lstatSync(current); }
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('缓存路径包含链接或非文件夹');
      }
      ses.setCodeCachePath(target);
    } catch { sessionWarning = '部分页面脚本缓存位置未能启用，仍使用原会话中的缓存；店铺登录位置保持不变。'; }
  }
  function serialize(work) {
    const result = queue.catch(() => {}).then(work); queue = result;
    return result;
  }
  async function change(kind, value) {
    if (!['cache', 'export'].includes(kind)) throw new Error('未知的位置设置。');
    const field = kind === 'cache' ? 'cacheDir' : 'exportDir';
    const target = value ? await validate(value, kind) : '';
    const next = {...settings, [field]: target};
    await writeJson(SETTINGS_FILE, next);
    settings = next;
    if (kind === 'cache') startupWarning = '';
    else {activeExportDir = target; exportWarning = '';}
    return {...view(), message: kind === 'cache' ? '缓存位置已保存，正常退出并重新打开软件后生效。' : '导出默认位置已保存，下次导出时生效。'};
  }
  async function handle(action, payload = {}) {
    if (action === 'load') return view();
    if (action === 'reset') return serialize(() => change(payload.kind, ''));
    if (action === 'choose') return serialize(async () => {
      if (!['cache', 'export'].includes(payload.kind)) throw new Error('未知的位置设置。');
      const selected = await dialog.showOpenDialog(getWindow(), {title: payload.kind === 'cache' ? '选择页面脚本缓存文件夹' : '选择默认导出文件夹',
        defaultPath: (payload.kind === 'cache' ? settings.cacheDir : settings.exportDir) || defaultExportDir || undefined,
        properties: ['openDirectory', 'createDirectory']});
      if (selected.canceled || !selected.filePaths?.length) return {canceled: true};
      return change(payload.kind, selected.filePaths[0]);
    });
    throw new Error('不支持的位置设置操作。');
  }
  async function exportPath(filename) {
    if (typeof filename !== 'string' || !filename || path.basename(filename) !== filename || /[:\\/\x00-\x1f]/.test(filename)) throw new Error('无效的导出文件名。');
    const folder = await resolveExportDirectory();
    return folder ? path.join(folder, filename) : filename;
  }
  return {initialize, configureSession, handle, exportPath, view};
}

module.exports = {SETTINGS_FILE, normalizedDirectory, assertOrdinaryDirectory, createPathSettings};
