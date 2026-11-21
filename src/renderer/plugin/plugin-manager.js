'use strict';

/**
 * AI作图插件（工作台代管）
 *
 * UI 结构与同类软件的扩展管理弹窗保持一致：
 *   标题「AI作图插件」+ 副标题、四行状态、最近检查、
 *   「首次在浏览器启用」三步说明、底部 关闭 / 接管现有插件文件夹 / 安装到默认文件夹
 *   （已代管时主按钮变为「立即检查更新」，并出现「打开插件文件夹」）。
 *
 * 与老软件不同之处（如实展示，不伪装）：
 *   - 最新版本来自「工作台内置快照」，不是远端签名包；
 *   - 校验方式写明「本机快照 · 逐文件 SHA-256」，没有远端签名。
 */
(() => {
  function create(deps) {
    const { api, esc, svg, toast } = deps;
    const state = { open: false, loading: false, busy: false, status: null, feedback: null };

    const host = () => document.getElementById('plugin-overlay');

    function timeText(value) {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
    }

    function disabled(flag) {
      return flag ? ' disabled' : '';
    }

    function feedbackHtml() {
      if (!state.feedback) return '';
      const tone = state.feedback.tone === 'warn' ? 'warn' : 'ok';
      return `<div class="plg-feedback ${tone}" role="${tone === 'warn' ? 'alert' : 'status'}">${esc(state.feedback.text)}</div>`;
    }

    function foldersHtml(status) {
      const rows = Array.isArray(status.folders) ? status.folders : [];
      const others = rows.filter(row => row.dir !== status.installDir);
      if (!others.length) return '';
      return `<div class="plg-found">
        <strong>本机找到的插件文件夹</strong>
        <span>点「更新这个」把最新版本写进该文件夹，再到浏览器扩展页点「重新加载」。</span>
        ${others.map(row => `<div class="plg-found-row">
          <code>${esc(row.dir)}</code>
          <span>${esc(row.version || '未知版本')}${row.managed ? ' · 已代管' : ''}</span>
          <button type="button" class="plg-btn small" data-action="plugin:adopt-dir" data-dir="${esc(row.dir)}"${disabled(state.busy)}>更新这个</button>
        </div>`).join('')}
      </div>`;
    }

    function dialogHtml() {
      const status = state.status;
      if (!status) return '';
      const installed = Boolean(status.installedVersion);
      const managed = Boolean(status.managed);
      return `<div class="plg-mask">
        <div class="plg-backdrop" data-action="plugin:close"></div>
        <section class="plg-dialog" role="dialog" aria-modal="true" aria-label="AI作图插件" aria-busy="${state.busy}">
          <header class="plg-head">
            <span class="plg-icon">${svg('plugin')}</span>
            <div class="plg-head-text">
              <strong>AI作图插件</strong>
              <span>${managed ? '已在浏览器加载后点「重新加载」即可' : '先安装，再到浏览器加载一次'}</span>
            </div>
            <button type="button" class="plg-x" data-action="plugin:close" aria-label="关闭" title="关闭"${disabled(state.busy)}>×</button>
          </header>
          <div class="plg-body">
            <dl class="plg-status">
              <div><dt>插件文件夹</dt><dd><code>${esc(status.installDir || '尚未选择')}</code></dd></div>
              <div><dt>版本</dt><dd>${installed ? esc(status.installedVersion) : '未安装'}${status.latestVersion && status.latestVersion !== status.installedVersion ? `　→　${esc(status.latestVersion)}` : ''}</dd></div>
              <div><dt>自动更新</dt><dd>${managed ? '已开启' : '安装后开启'}</dd></div>
            </dl>
            ${status.lastResult ? `<div class="plg-feedback ok">最近检查：${esc(status.lastResult)}</div>` : ''}
            ${status.pathNotice ? `<div class="plg-warn">${esc(status.pathNotice)}</div>` : ''}
            ${status.snapshotReady ? '' : '<div class="plg-warn">没有找到 AI作图 插件，请点「选择 AI作图 目录」。</div>'}
            ${foldersHtml(status)}
            <div class="plg-help">
              <ol>
                ${managed ? '' : '<li>点「选择文件夹并安装」，选一个固定位置。</li>'}
                <li>打开 <code>edge://extensions</code>，开启「开发人员模式」。</li>
                <li>「加载解压缩的扩展」→ 选上方插件文件夹。</li>
              </ol>
            </div>
            ${feedbackHtml()}
          </div>
          <footer class="plg-foot">
            <button type="button" class="plg-btn link" data-action="plugin:adopt"${disabled(state.busy || !status.snapshotReady)} title="把最新版本更新进当前插件文件夹（浏览器正在加载的那个）">更新现有文件夹</button>
            <span class="grow"></span>
            <button type="button" class="plg-btn" data-action="plugin:close"${disabled(state.busy)}>关闭</button>
            <button type="button" class="plg-btn primary" data-action="plugin:install"${disabled(state.busy || !status.snapshotReady)}>${state.busy ? '正在安装…' : '安装插件'}</button>
          </footer>
        </section>
      </div>`;
    }

    function render() {
      const node = host();
      if (!node) return;
      if (!state.open) { node.innerHTML = ''; return; }
      if (state.loading && !state.status) {
        node.innerHTML = `<div class="plg-mask"><div class="plg-backdrop" data-action="plugin:close"></div>
          <section class="plg-dialog"><div class="plg-loading"><span class="spinner"></span>正在读取插件状态…</div></section></div>`;
        return;
      }
      if (!state.status) { node.innerHTML = ''; return; }
      node.innerHTML = dialogHtml();
    }

    async function open() {
      state.open = true;
      state.loading = true;
      state.feedback = null;
      render();
      try {
        state.status = await api('selectionpool.pluginStatus');
      } catch (error) {
        state.feedback = { tone: 'warn', text: `读取插件状态失败：${String(error?.message || error)}` };
      } finally {
        state.loading = false;
        render();
      }
    }

    function close() {
      state.open = false;
      state.feedback = null;
      render();
    }

    async function run(label, work, success) {
      if (state.busy) return;
      state.busy = true;
      state.feedback = { tone: 'ok', text: label };
      render();
      try {
        const status = await work();
        if (status) state.status = status;
        state.feedback = { tone: 'ok', text: typeof success === 'function' ? success(status) : (success || '完成') };
      } catch (error) {
        state.feedback = { tone: 'warn', text: String(error?.message || error) };
      } finally {
        state.busy = false;
        render();
      }
    }

    async function handleAction(action, target) {
      if (action === 'open-plugin') { await open(); return true; }
      if (!String(action).startsWith('plugin:')) return false;
      const cmd = action.slice('plugin:'.length);
      switch (cmd) {
        case 'close': close(); return true;
        case 'install':
          // 「安装插件」：把最新版本下载/安装到用户指定的文件夹（强制写入最新源码）。
          await run('请选择插件安装文件夹…', () => api('selectionpool.pluginInstall', { chooseFolder: true, force: true }), status =>
            `插件 ${status?.installedVersion || ''} 已安装到 ${status?.installDir || ''}。请在浏览器扩展页「加载已解压的扩展程序」选这个文件夹，或点「重新加载」。`);
          return true;
        case 'adopt':
          // 「更新现有文件夹」：把最新版本强制更新进浏览器正在加载的那个文件夹，不弹选择框。
          await run('正在把最新版本更新进当前插件文件夹…', () => api('selectionpool.pluginInstall', { updateCurrent: true }), status =>
            status?.lastResult || `已更新为 ${status?.installedVersion || ''}；请在浏览器扩展页点「重新加载」。`);
          return true;
        case 'adopt-dir':
          await run('正在把最新版本更新进所选文件夹…', () => api('selectionpool.pluginInstall', { dir: target.dataset.dir, force: true }), status =>
            `已把最新版本更新进 ${status?.installDir || target.dataset.dir}，请在浏览器扩展页点「重新加载」。`);
          return true;
        case 'check':
          await run('正在检查插件更新…', () => api('selectionpool.pluginCheck', {}), status => status?.lastResult || '已检查');
          return true;
        case 'force-sync':
          // 版本号没变时用强制同步把所有副本按真源重写一遍，再让浏览器重新加载。
          await run('正在把插件版本同步到所有副本…', () => api('selectionpool.pluginCheck', { force: true }), status => status?.lastResult || '已同步');
          return true;
        case 'source':
          await run('请选择 AI作图 插件文件夹…', () => api('selectionpool.pluginSetSource', { chooseFolder: true }), status =>
            status?.sourceReady ? `插件来源已设为 ${status.sourceDir}（${status.latestVersion || ''}）` : '这个文件夹里没有找到插件');
          return true;
        case 'open-folder':
          try {
            await api('selectionpool.pluginOpenFolder', {});
            toast('已打开插件文件夹');
          } catch (error) {
            toast(String(error?.message || error), true);
          }
          return true;
        case 'download-zip':
          await run('正在打包最新插件…', async () => {
            const result = await api('selectionpool.pluginDownloadZip', {});
            if (result?.saved) toast(`插件包已保存：${result.path}（v${result.version}，${result.fileCount} 个文件）。解压后在浏览器扩展页「加载已解压的扩展程序」选择解压目录，或覆盖旧目录后点「重新加载」。`);
            else if (result?.canceled) toast('已取消保存');
            else toast(`插件包已就绪（v${result?.version || ''}，${result?.fileCount || 0} 个文件）`);
            return null;
          }, '打包完成');
          return true;
        case 'verify':
          await run('正在校验插件文件…', async () => {
            const result = await api('selectionpool.pluginVerify', {});
            toast(result.changed || result.missing
              ? `校验完成：${result.changed} 个文件被改动、${result.missing} 个缺失`
              : `校验完成：${result.checked} 个文件一致`);
            return null;
          }, '校验完成');
          return true;
        default:
          return false;
      }
    }

    return {
      open,
      close,
      render,
      handleAction,
      isOpen: () => state.open,
    };
  }

  window.XXPluginManager = Object.freeze({ create });
})();
