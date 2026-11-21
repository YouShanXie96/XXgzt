'use strict';

/**
 * 上品库 · AI作图插件 管理
 *
 * 插件只有一个：AI作图 软件里的 `extension` 目录。
 *   - 它就是 AI作图 启动时 `--load-extension` 加载的那份，也是 `/api/extension/download` 打包的那份；
 *   - 本模块不维护自有副本，只负责装到用户选的文件夹，并在源升级后同步过去；
 *   - 源可以是本机 AI作图，也可以是已配对主机下发的 zip（同事电脑没装 AI作图 时）。
 *
 * 分发与校验（必须如实说明）：
 *   1. 插件包没有远端签名，改用「写入时记录逐文件 sha256」到 `xx-managed.json`，
 *      「立即检查」可发现文件被改动/缺失，并在界面上如实标注来源与校验方式。
 *   2. 一个插件同时服务两个端：AI作图(48180) 与 上品库(49220)，装一次即可。
 *
 * 沿用的关键约束：
 *   - 只升不降；版本相同不覆盖（避免把用户/开发版降级）。
 *   - 写文件用「临时文件 + 改名」，manifest.json 最后写。
 *   - 不删除目标文件夹里的其他文件。
 *   - 记住安装目录；换电脑后原路径不存在时不重建，让用户重新选择。
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { unzip, stripCommonRoot, zipStore } = require('./plugin-zip');

const MANAGED_MARKER = 'xx-managed.json';
const SETTINGS_FILE = 'plugin-manager.json';
/** 插件源目录名：AI作图 软件里的 extension。 */
const SOURCE_SUBDIR = 'extension';
/** 插件名（与 AI作图 的 extension/manifest.json 保持一致）。 */
const PLUGIN_NAME = 'AI作图插件';
/** 改名前用过的名字：视为同一插件，允许覆盖升级，不要当成“别人的插件”。 */
const PREVIOUS_NAMES = ['AI作图'];
const LEGACY_NAMES = ['突破插件助手', '亿突破', '突破生图'];
/**
 * 上一轮实现曾沿用过老软件的标记文件名，现已改为 `xx-managed.json`。
 * 这里列出它们**仅用于清除**（读到就迁移、写入后删除），不构成本插件对老软件的依赖。
 */
const STALE_MARKERS = ['tupo-managed.json'];
/** 只忽略、不删除：老插件的签名文件若被人拷进本目录，不参与校验也不动它。 */
const IGNORED_FILES = ['tupo-signature.json'];
const VERSION_RE = /^\d+(?:\.\d+){1,3}$/;

/** 这些文件不进安装目录：备份、旧标记（标记由本模块重新生成）。 */
function shouldSkip(relative) {
  const name = String(relative || '').split('/').pop();
  return /\.bak(-\d+)?$/i.test(name) || name === MANAGED_MARKER
    || STALE_MARKERS.includes(name) || IGNORED_FILES.includes(name);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function compareVersions(left, right) {
  const a = String(left || '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const b = String(right || '').split('.').map(part => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function createPluginManager(ctx = {}, options = {}) {
  const dataDir = ctx.dataDir || path.join(os.homedir(), '.xx-workbench');
  const settingsFile = path.join(dataDir, SETTINGS_FILE);
  const now = options.now || (() => new Date());
  const log = options.log || (() => undefined);

  const state = { installDir: '', lastCheckedAt: '', lastResult: '' };
  let loaded = null;
  let busy = null;
  let timer = null;
  let pathNotice = '';
  let snapshotCache = null;
  let sourceCache = null;

  /** 安装目录必须由用户选择，不预设默认位置。 */
  function defaultDir() {
    return '';
  }

  /**
   * 插件源，按顺序找：
   *   1. 用户手动指定的目录（换电脑后 AI作图 换了位置时用）
   *   2. 环境变量 XX_DRAWING_DIR
   *   3. 上品库接口配对时记录的 AI作图 config.json 路径
   *   4. C/D/E/F 常见安装位置
   *   5. 都没有就从已配对的 AI作图 主机下载 zip（同事电脑没装 AI作图 的情况）
   */
  async function resolveSource(force = false) {
    if (sourceCache && !force) return sourceCache;

    const candidates = [];
    const push = (value) => {
      const dir = String(value || '').trim();
      if (dir && path.isAbsolute(dir) && !candidates.includes(dir)) candidates.push(dir);
    };

    const saved = await readJson(path.join(dataDir, 'selectionpool', 'plugin-source.json'));
    push(saved?.root);
    push(process.env.XX_DRAWING_DIR);
    const api = await readJson(path.join(dataDir, 'selectionpool', 'taobao-api.json'));
    const configPath = String(api?.drawingConfigPath || '');
    if (configPath) push(path.dirname(configPath));
    for (const drive of ['D', 'E', 'C', 'F']) {
      push(`${drive}:\\软件\\AI软件\\AI作图\\AI作图`);
      push(`${drive}:\\AI软件\\AI作图\\AI作图`);
      push(`${drive}:\\软件\\AI作图\\AI作图`);
      push(`${drive}:\\AI作图\\AI作图`);
    }

    // 多个候选目录时取「版本最高」的那一份，不能碰到第一个就返回：
    // 否则本机残留的旧版插件会被当成真源，工作台反复把新版"同步"回旧版，
    // 浏览器里重新加载后版本号当然一直不变。
    let best = null;
    for (const item of candidates) {
      for (const dir of [path.join(item, 'extension'), item]) {
        const manifest = await readJson(path.join(dir, 'manifest.json')).catch(() => null);
        if (!manifest?.name) continue;
        const name = String(manifest.name);
        if (name !== PLUGIN_NAME && !PREVIOUS_NAMES.includes(name) && !/AI作图|作图插件/.test(name)) continue;
        const candidate = { root: item, dir, name, version: String(manifest.version || ''), kind: 'local' };
        if (!best || compareVersions(candidate.version, best.version) > 0) best = candidate;
      }
    }
    if (best) {
      sourceCache = best;
      return sourceCache;
    }

    const remote = await downloadRemoteSource().catch(() => null);
    sourceCache = remote;
    return remote;
  }

  /** 从已配对的 AI作图 主机下载插件包（按版本缓存，不重复下）。 */
  async function downloadRemoteSource() {
    const api = await readJson(path.join(dataDir, 'selectionpool', 'taobao-api.json'));
    const root = String(api?.drawingApiRoot || '').replace(/\/+$/, '');
    if (!root) return null;
    // 本机地址说明这台就是主机；本地都没找到 extension，就不用绕一圈去下载
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(root)) return null;

    let latest = '';
    try {
      const info = await fetch(`${root}/api/extension/latest`, { signal: AbortSignal.timeout(6000) }).then((r) => r.json());
      latest = String(info?.version || '').trim();
    } catch {
      return null;
    }
    if (!latest || !VERSION_RE.test(latest)) return null;

    const cacheRoot = path.join(dataDir, 'selectionpool', 'plugin-cache');
    const target = path.join(cacheRoot, `v${latest}`);
    const cached = await readJson(path.join(target, 'manifest.json')).catch(() => null);
    if (cached?.name) {
      return { root: target, dir: target, name: String(cached.name), version: latest, kind: 'remote' };
    }

    const response = await fetch(`${root}/api/extension/download`, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) return null;
    const files = stripCommonRoot(unzip(Buffer.from(await response.arrayBuffer())));
    await fsp.mkdir(target, { recursive: true });
    for (const file of files) {
      const dest = path.join(target, ...file.name.split('/'));
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, file.data);
    }
    const manifest = await readJson(path.join(target, 'manifest.json')).catch(() => null);
    if (!manifest?.name) return null;
    log(`已从 ${root} 下载插件 ${latest}`);
    return { root: target, dir: target, name: String(manifest.name), version: latest, kind: 'remote' };
  }


  async function readJson(file) {
    try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; }
  }

  async function readInstalled(dir) {
    if (!dir) return null;
    const manifest = await readJson(path.join(dir, 'manifest.json'));
    if (!manifest || !manifest.name) return null;
    let marker = await readJson(path.join(dir, MANAGED_MARKER)).catch(() => null);
    let staleMarker = false;
    if (!marker) {
      // 兜底读一次上一轮遗留的旧标记，只为平滑迁移；读到就视为已代管，下次写入即换新名。
      for (const name of STALE_MARKERS) {
        marker = await readJson(path.join(dir, name)).catch(() => null);
        if (marker) { staleMarker = true; break; }
      }
    }
    return {
      dir,
      name: String(manifest.name || ''),
      version: String(manifest.version || ''),
      managed: Boolean(marker),
      staleMarker,
      managedBy: String(marker?.managedBy || ''),
      updatedAt: String(marker?.updatedAt || ''),
    };
  }

  async function snapshotInfo() {
    const source = await resolveSource();
    if (!source) return null;
    const manifest = await readJson(path.join(source.dir, 'manifest.json'));
    if (!manifest || !VERSION_RE.test(String(manifest.version || ''))) return null;
    const version = String(manifest.version || '');
    if (snapshotCache && snapshotCache.dir === source.dir && snapshotCache.version === version) return snapshotCache;
    const files = [];
    async function walk(relative) {
      const entries = await fsp.readdir(path.join(source.dir, relative), { withFileTypes: true });
      for (const entry of entries) {
        const next = relative ? `${relative}/${entry.name}` : entry.name;
        if (shouldSkip(next)) continue;
        if (entry.isDirectory()) await walk(next);
        else if (entry.isFile()) files.push(next);
      }
    }
    await walk('');
    snapshotCache = {
      name: String(manifest.name || ''),
      version,
      manifestVersion: Number(manifest.manifest_version) || 3,
      files: files.sort(),
      dir: source.dir,
      root: source.root,
      kind: source.kind,
      size: files.length,
    };
    return snapshotCache;
  }

  async function readSettings() {
    const saved = await readJson(settingsFile);
    const dir = String(saved?.installDir || '');
    if (dir && path.isAbsolute(dir)) {
      const ok = await fsp.stat(dir).then(info => info.isDirectory(), () => false);
      if (ok) {
        const installed = await readInstalled(dir);
        if (installed && LEGACY_NAMES.includes(installed.name)) {
          // 记录里指向的是其他软件的插件目录：立即停止接管，绝不写它。
          pathNotice = `当前记录的文件夹里是别的插件，新工作台不会覆盖它；请重新选择「${PLUGIN_NAME}」所在的文件夹。`;
        } else {
          state.installDir = dir;
        }
      } else {
        // 换电脑后旧路径可能属于上一个 Windows 账号：不重建，让用户重新选。
        pathNotice = '原插件文件夹已不可用（换了电脑或账号），请重新选择文件夹安装。';
      }
    }
    if (!state.installDir) state.installDir = '';
  }

  async function saveSettings() {
    await fsp.mkdir(path.dirname(settingsFile), { recursive: true });
    await fsp.writeFile(settingsFile, JSON.stringify({ installDir: state.installDir }, null, 2), 'utf8');
  }

  /** 候选目录：记住的、默认的、常见位置，以及环境变量覆盖。不扫描任何老软件的目录。 */
  function candidateDirs() {
    const list = [];
    const push = value => {
      const dir = String(value || '').trim();
      if (dir && path.isAbsolute(dir) && !list.includes(dir)) list.push(dir);
    };
    push(process.env.XX_PLUGIN_DIR);
    push(state.installDir);
    push(defaultDir());
    for (const drive of ['D', 'E', 'C', 'F']) {
      push(`${drive}:\\${PLUGIN_NAME}`);
      push(`${drive}:\\谢谢工作台\\${PLUGIN_NAME}`);
      push(`${drive}:\\软件\\${PLUGIN_NAME}`);
      push(`${drive}:\\软件\\AI软件\\${PLUGIN_NAME}`);
    }
    return list;
  }

  async function detectFolders() {
    const found = [];
    for (const dir of candidateDirs()) {
      const info = await readInstalled(dir);
      if (!info || (info.name !== PLUGIN_NAME && !PREVIOUS_NAMES.includes(info.name))) continue;
      if (found.some(row => path.resolve(row.dir) === path.resolve(dir))) continue;
      found.push(info);
      if (found.length >= 8) break;
    }
    return found;
  }

  /** 写入新标记后，清掉上一轮遗留的旧标记文件名（只动本插件目录里的这一个文件）。 */
  async function dropStaleMarkers(targetDir) {
    for (const name of STALE_MARKERS) {
      await fsp.rm(path.join(targetDir, name), { force: true }).catch(() => undefined);
    }
  }

  async function copyInto(targetDir, snapshot) {
    const hashes = {};
    const ordered = snapshot.files.filter(name => name !== 'manifest.json').slice().sort();
    ordered.push('manifest.json');
    for (const relative of ordered) {
      const from = path.join(snapshot.dir, ...relative.split('/'));
      const to = path.join(targetDir, ...relative.split('/'));
      await fsp.mkdir(path.dirname(to), { recursive: true });
      const data = await fsp.readFile(from);
      hashes[relative] = sha256(data);
      const temp = `${to}.xx-tmp`;
      await fsp.writeFile(temp, data);
      await fsp.rename(temp, to);
    }
    const marker = {
      managedBy: '谢谢工作台',
      plugin: snapshot.name,
      version: snapshot.version,
      updatedAt: now().toISOString(),
      files: hashes,
      note: '由谢谢工作台写入；本机快照分发，未做远端签名校验。',
    };
    await fsp.writeFile(path.join(targetDir, MANAGED_MARKER), JSON.stringify(marker, null, 2), 'utf8');
    await dropStaleMarkers(targetDir);
    return hashes;
  }

  /** 校验本机插件文件与代管清单是否一致（发现被改动/缺失的数量）。 */
  async function verifyInstalled(dir) {
    const marker = await readJson(path.join(dir, MANAGED_MARKER)).catch(() => null);
    const files = marker?.files && typeof marker.files === 'object' ? marker.files : null;
    if (!files) return { checked: 0, changed: 0, missing: 0, verified: false };
    let checked = 0, changed = 0, missing = 0;
    for (const [relative, expected] of Object.entries(files)) {
      if (shouldSkip(relative)) continue;
      checked += 1;
      try {
        const data = await fsp.readFile(path.join(dir, ...relative.split('/')));
        if (sha256(data) !== expected) changed += 1;
      } catch { missing += 1; }
    }
    return { checked, changed, missing, verified: true };
  }

  /** 接管已有目录：不改插件文件，只把「当前文件指纹」记为校验基线。 */
  async function writeMarkerFromExisting(targetDir, snapshot, installed) {
    const hashes = {};
    for (const relative of snapshot.files) {
      try {
        hashes[relative] = sha256(await fsp.readFile(path.join(targetDir, ...relative.split('/'))));
      } catch { /* 旧版本可能没有新文件，不阻断接管 */ }
    }
    const marker = {
      managedBy: '谢谢工作台',
      plugin: snapshot.name,
      version: installed?.version || snapshot.version,
      updatedAt: now().toISOString(),
      files: hashes,
      note: '接管已有文件夹：未改动插件文件，仅记录当前文件指纹作为校验基线。',
    };
    await fsp.writeFile(path.join(targetDir, MANAGED_MARKER), JSON.stringify(marker, null, 2), 'utf8');
    await dropStaleMarkers(targetDir);
  }

  function exclusive(work) {
    if (busy) return Promise.reject(new Error('插件正在更新，请稍候'));
    const running = work().finally(() => { busy = null; });
    busy = running;
    return running;
  }

  async function status() {
    await loaded;
    const installed = await readInstalled(state.installDir);
    // 对话框每次打开都读磁盘真源，不显示进程启动时缓存的旧版本号。
    sourceCache = null;
    snapshotCache = null;
    const snapshot = await snapshotInfo();
    const folders = await detectFolders();
    return {
      pluginName: PLUGIN_NAME,
      installDir: state.installDir,
      defaultDir: defaultDir(),
      installedVersion: installed?.version || null,
      installedName: installed?.name || null,
      managed: Boolean(installed?.managed),
      managedBy: installed?.managedBy || '',
      installedAt: installed?.updatedAt || '',
      latestVersion: snapshot?.version || null,
      latestSource: snapshot ? 'AI作图 插件（唯一真源）' : '',
      sourceReady: Boolean(snapshot),
      sourceDir: snapshot?.dir || '',
      sourceRoot: snapshot?.root || '',
      sourceKind: snapshot?.kind || '',
      fileCount: snapshot?.size || 0,
      snapshotReady: Boolean(snapshot),
      snapshotDir: snapshot?.dir || '',
      lastCheckedAt: state.lastCheckedAt,
      lastResult: state.lastResult,
      busy: Boolean(busy),
      signingReady: false,
      verifyNote: '与 AI作图 插件同源：安装时记录逐文件 SHA-256，可检查副本是否与源一致',
      pathNotice,
      folders: folders.map(row => ({ dir: row.dir, name: row.name, version: row.version, managed: row.managed })),
      channels: {
        drawing: 'http://127.0.0.1:48180',
        pool: 'http://127.0.0.1:49220',
        note: '同一个插件同时供 AI作图 提交任务、上品库 采集入库；只需在浏览器加载一次。',
      },
    };
  }

  /** 手动指定 AI作图 目录（换电脑后路径变了、或从别处拷贝过来时用）。传空则清除。 */
  async function setSource(dir) {
    const raw = String(dir || '').trim();
    const file = path.join(dataDir, 'selectionpool', 'plugin-source.json');
    sourceCache = null;
    snapshotCache = null;
    if (!raw) {
      await fsp.rm(file, { force: true }).catch(() => undefined);
      return status();
    }
    const target = path.resolve(raw);
    const found = [path.join(target, 'extension'), target]
      .find((item) => fs.existsSync(path.join(item, 'manifest.json')));
    if (!found) throw new Error('这个文件夹里没有插件（找不到 manifest.json）');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify({ root: target, savedAt: now().toISOString() }, null, 2), 'utf8');
    return status();
  }

  /** 安装到用户选的目录；不传目录直接报错（不再有隐藏默认位置）。
   *  force=true：即使目标目录版本号不低于真源也强制覆盖（「更新现有文件夹」用）。 */
  function install(targetDir, options = {}) {
    return exclusive(async () => {
      await loaded;
      const force = options?.force === true;
      const raw = String(targetDir || '').trim();
      // 每次安装都重读真源磁盘：同版本号内源码可能新增/修改文件（例如 src/sku.mjs），
      // 旧快照缓存会让新文件漏装，浏览器重载后采集逻辑仍是旧的。
      sourceCache = null;
      snapshotCache = null;
      if (!raw) throw new Error('请先选择插件存放文件夹');
      const dir = path.resolve(raw);
      const existing = await readInstalled(dir);
      if (existing && LEGACY_NAMES.includes(existing.name)) {
        throw new Error('这个文件夹里是别的插件，新工作台不会覆盖它。请换一个文件夹');
      }
      if (existing && existing.name !== PLUGIN_NAME && !PREVIOUS_NAMES.includes(existing.name)) {
        throw new Error(`这个文件夹里是别的插件（${existing.name.slice(0, 40)}），请选「${PLUGIN_NAME}」所在的文件夹`);
      }
      const snapshot = await snapshotInfo();
      if (!snapshot) throw new Error('没有找到 AI作图 插件：请确认 AI作图 已安装，或在「上品库 → 接口配置」里配对一次');
      if (!force && existing && VERSION_RE.test(existing.version) && compareVersions(existing.version, snapshot.version) >= 0) {
        state.installDir = dir;
        pathNotice = '';
        await writeMarkerFromExisting(dir, snapshot, existing);
        await saveSettings();
        state.lastCheckedAt = now().toISOString();
        state.lastResult = `已接管 ${existing.version}（本机版本不低于内置 ${snapshot.version}，未覆盖文件）`;
        log(`接管插件目录 ${dir}：${existing.version}`);
        return;
      }
      await fsp.mkdir(dir, { recursive: true });
      await copyInto(dir, snapshot);
      state.installDir = dir;
      pathNotice = '';
      await saveSettings();
      state.lastCheckedAt = now().toISOString();
      state.lastResult = force
        ? `已把最新版本 ${snapshot.version} 更新进 ${dir}；请在浏览器扩展页点「重新加载」`
        : existing ? `已从 ${existing.version} 更新到 ${snapshot.version}` : `已安装 ${snapshot.version}`;
      log(`插件已写入 ${dir}：${snapshot.version}${force ? '（强制覆盖）' : ''}`);
    }).then(status);
  }

  /** 检查一次：重新读磁盘真源，并把新版同步到本机所有插件副本。 */
  function checkNow(input = {}) {
    return exclusive(async () => {
      await loaded;
      try {
        // 每次检查都清缓存。manifest.json 可能在软件运行期间被升级，
        // 旧缓存会让工作台一直拿旧版本比对，浏览器重载后版本号自然不变。
        sourceCache = null;
        snapshotCache = null;
        const snapshot = await snapshotInfo();
        if (!snapshot) throw new Error('没有找到 AI作图 插件：请确认 AI作图 已安装，或在「接口配置」里配对一次');
        state.lastCheckedAt = now().toISOString();
        const force = input?.force === true;

        // 浏览器实际加载的文件夹可能不是工作台记住的那一个。
        // 对所有检测到的副本一起同步，才是「重载后版本号会变」的关键。
        const found = await detectFolders();
        const list = [];
        const push = row => { if (row?.dir && !list.some(x => path.resolve(x.dir) === path.resolve(row.dir))) list.push(row); };
        if (state.installDir) push({ dir: state.installDir });
        for (const row of found) push(row);

        const notes = [];
        for (const target of list.slice(0, 8)) {
          const installed = await readInstalled(target.dir);
          if (!installed) { notes.push(`${target.dir}：未安装`); continue; }
          if (LEGACY_NAMES.includes(installed.name)) continue;
          if (installed.name !== PLUGIN_NAME && !PREVIOUS_NAMES.includes(installed.name)) continue;
          if (path.resolve(target.dir) === path.resolve(snapshot.dir) && !force) {
            notes.push(`真源 ${installed.version}`);
            continue;
          }
          const compare = compareVersions(snapshot.version, installed.version);
          const verify = installed.managed ? await verifyInstalled(target.dir) : { changed: 0, missing: 0 };
          if (compare < 0 && !force) { notes.push(`${installed.version}：本机更高，未覆盖`); continue; }
          if (compare === 0 && !force && !verify.changed && !verify.missing) { notes.push(`${installed.version}：已是最新`); continue; }
          if (!installed.managed && !force && compare === 0) { notes.push(`${installed.version}：非代管，未覆盖`); continue; }
          await copyInto(target.dir, snapshot);
          notes.push(`${installed.version || '未安装'} → ${snapshot.version}`);
          log(`插件已同步 ${target.dir}：${installed.version} → ${snapshot.version}`);
        }
        state.lastResult = notes.length
          ? `${notes.join('；')}。请在浏览器扩展页点「重新加载」；若版本仍是旧的，重启浏览器后重新加载该文件夹。`
          : '没有找到需要同步的插件文件夹，请先「选择文件夹并安装」';
      } catch (error) {
        state.lastCheckedAt = now().toISOString();
        state.lastResult = `检查失败：${String(error?.message || error).slice(0, 160)}`;
        log(`插件更新检查失败：${state.lastResult}`);
      }
    }).then(status);
  }

  async function openFolder() {
    await loaded;
    const installed = await readInstalled(state.installDir);
    if (!installed) throw new Error('插件文件夹还没有安装');
    const shell = options.shell || safeShell();
    if (!shell?.openPath) throw new Error('当前环境无法打开文件夹');
    const message = await shell.openPath(state.installDir);
    if (message) throw new Error(message);
    return { ok: true, dir: state.installDir };
  }

  async function verify() {
    await loaded;
    const installed = await readInstalled(state.installDir);
    if (!installed) throw new Error('插件文件夹还没有安装');
    const result = await verifyInstalled(state.installDir);
    return { ...result, dir: state.installDir, version: installed.version };
  }

  /**
   * 打包「最新插件 zip」给用户手动安装（用户 2026-11-10 要求：从工作台直接下载）。
   * 源 = resolveSource 找到的 AI作图 extension 目录（唯一真源，含全部最新采集修复）。
   * 弹保存对话框让用户选位置（默认插件文件名 AI作图插件-<版本>.zip）。
   */
  async function downloadZip() {
    await loaded;
    const source = await resolveSource();
    if (!source || source.kind !== 'local') throw new Error('本机没有找到 AI作图 的插件源目录；请先在上品库接口配置里配对 AI作图。');
    const { readdir, readFile } = require('node:fs/promises');
    const files = [];
    const walk = async (dir, prefix) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === '.' || entry.name === '..' || entry.name === '.DS_Store') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, `${prefix}${entry.name}/`);
        else files.push({ name: `${prefix}${entry.name}`, data: await readFile(full) });
      }
    };
    await walk(source.dir, 'extension/');
    if (!files.length) throw new Error('插件源目录是空的');
    const bytes = zipStore(files);
    const dialog = options.dialog || (() => { try { return require('electron').dialog; } catch { return null; } })();
    if (!dialog?.showSaveDialog) return { ok: true, saved: false, version: source.version, fileCount: files.length, bytes: bytes.length, note: '当前环境没有保存对话框；插件包已就绪（' + files.length + ' 个文件）。' };
    const result = await dialog.showSaveDialog({
      title: '保存插件安装包',
      defaultPath: `AI作图插件-${source.version || 'latest'}.zip`,
      filters: [{ name: '插件安装包', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, saved: false, canceled: true, version: source.version };
    await require('node:fs/promises').writeFile(result.filePath, bytes);
    log(`插件安装包已保存：${result.filePath}（${files.length} 个文件，v${source.version}）`);
    return { ok: true, saved: true, path: result.filePath, version: source.version, fileCount: files.length, bytes: bytes.length };
  }

  function safeShell() {
    try { return require('electron').shell; } catch { return null; }
  }

  loaded = readSettings().catch(() => undefined);

  return {
    status,
    install,
    setSource,
    checkNow,
    openFolder,
    verify,
    downloadZip,
    defaultDir,
    detectFolders,
    /** 启动 1 分钟后检查一次，之后每 30 分钟一次（与老软件一致）。 */
    start(intervalMs = 30 * 60_000, firstDelayMs = 60_000) {
      if (timer) return;
      setTimeout(() => void checkNow().catch(() => undefined), firstDelayMs).unref?.();
      timer = setInterval(() => void checkNow().catch(() => undefined), intervalMs);
      timer.unref?.();
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = {
  createPluginManager,
  compareVersions,
  PLUGIN_NAME,
  LEGACY_NAMES,
  MANAGED_MARKER,
  STALE_MARKERS,
  IGNORED_FILES,
  SETTINGS_FILE,
  SOURCE_SUBDIR,
};
