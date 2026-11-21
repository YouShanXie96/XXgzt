'use strict';
// 软件更新：左下角图标点击后弹出小浮窗，显示状态、进度与更新日志；
// 启动检查发现新版本时同样用这个浮窗提示，并倒计时自动更新。
(function () {
  function create({ api, esc, toast, state }) {
    let info = null;        // update.status 的结果
    let latest = null;      // 可用的新版本
    let phase = 'idle';     // idle | checking | available | downloading | extracting | applying | error
    let percent = 0;
    let errorText = '';
    let busy = false;
    let logs = [];
    let panel = null;
    let autoTimer = null;
    let autoStarted = false;

    function now() {
      const d = new Date();
      const pad = value => String(value).padStart(2, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function log(title, detail, tone = '') {
      logs.unshift({ at: now(), title, detail, tone });
      logs = logs.slice(0, 20);
    }

    function versionText(value) {
      return `v${String(value || '').replace(/^v/i, '')}`;
    }

    function hostOf(url) {
      try {
        return new URL(url).host;
      } catch {
        return '';
      }
    }

    function statusText() {
      if (phase === 'checking') return '正在检查更新';
      if (phase === 'downloading') return `正在下载 ${versionText(latest?.version)}`;
      if (phase === 'extracting') return '正在解压并校验';
      if (phase === 'applying') return '正在安装，即将自动重启';
      if (phase === 'error') return '更新未完成';
      if (latest) return `发现新版本 ${versionText(latest.version)}`;
      return '当前已经是最新版本';
    }

    function subText() {
      const current = versionText(info?.currentVersion || state.info?.version || '未知');
      if (phase === 'error' && errorText) return errorText;
      if (latest) return `当前 ${current} · ${latest.sizeText || ''} · 来自 ${hostOf(latest.source) || '更新服务'}`;
      return `当前版本 ${current} · 上次检查 ${info?.lastCheckAt ? new Date(info.lastCheckAt).toLocaleTimeString('zh-CN') : '尚未检查'}`;
    }

    function actions() {
      if (busy) return '<button type="button" class="button" disabled>更新进行中…</button>';
      const parts = ['<button type="button" class="button small" data-update="check">检查更新</button>'];
      if (latest) {
        parts.push('<button type="button" class="button small" data-update="skip">跳过此版本</button>');
        parts.push('<button type="button" class="button primary" data-update="download">立即更新</button>');
      }
      return parts.join('');
    }

    function logHtml() {
      if (!logs.length) return '<p class="update-log-empty">还没有记录，点“检查更新”开始。</p>';
      return `<ul>${logs.slice(0, 4).map(item => `<li class="${item.tone}"><time>${esc(item.at)}</time><div><strong>${esc(item.title)}</strong>${item.detail ? `<p>${esc(item.detail)}</p>` : ''}</div></li>`).join('')}</ul>`;
    }

    function panelHtml() {
      const tone = phase === 'error' ? 'bad' : latest ? 'new' : 'ok';
      const badge = phase === 'error' ? '!' : latest ? '↓' : '✓';
      const showBar = ['downloading', 'extracting', 'applying'].includes(phase);
      const percentText = showBar ? `${percent}%` : '—';
      const barWidth = showBar ? Math.max(2, percent) : 0;
      return `
        <div class="update-pop-head">
          <div class="update-pop-badge ${tone}">${badge}</div>
          <div class="update-pop-title"><strong>软件更新</strong><span id="up-status">${esc(statusText())}</span><small id="up-sub">${esc(subText())}</small></div>
          <div class="update-pop-percent" id="up-percent">${esc(percentText)}</div>
          <button type="button" class="update-pop-close" data-update="close" aria-label="关闭">×</button>
        </div>
        <div class="update-track"><i id="up-bar" style="width:${barWidth}%"></i></div>
        <div class="update-pop-log" id="up-log">${logHtml()}</div>
        <div class="update-actions" id="up-actions">${actions()}</div>`;
    }

    function ensurePanel() {
      if (panel) return panel;
      panel = document.createElement('dialog');
      panel.className = 'update-pop';
      panel.id = 'update-pop';
      panel.innerHTML = panelHtml();
      document.body.appendChild(panel);
      panel.addEventListener('click', event => {
        // 点在小卡片之外的空白（::backdrop 区域，target 就是 dialog 本身）直接关闭。
        if (event.target === panel) { close(); return; }
        const button = event.target.closest('[data-update]');
        if (!button) return;
        const action = button.dataset.update;
        if (action === 'close') return close();
        if (action === 'check') return void check();
        if (action === 'download') return void startDownload();
        if (action === 'skip') return void skip();
      });
      panel.addEventListener('cancel', event => {
        event.preventDefault();
        close();
      });
      // 小卡片是 showModal() 模态框，浮层外的元素默认 inert；用捕获阶段的
      // pointerdown 兜底，保证点侧栏/内容区任意空白都能收起卡片。
      const outside = event => {
        if (!panel.open) return;
        const node = event.target instanceof Element ? event.target : null;
        if (node?.closest('#update-pop')) return;
        // 触发「打开更新」的那个按钮本次不重复处理，交给它自己的 click。
        if (node?.closest('[data-action="open-update"]')) return;
        close();
      };
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('click', outside);
      return panel;
    }

    function paint() {
      if (panel?.open) panel.innerHTML = panelHtml();
    }

    function open({ auto = false } = {}) {
      const node = ensurePanel();
      paint();
      try {
        if (!node.open) node.showModal();
      } catch {}
      if (auto && latest && !autoStarted && !busy) {
        autoStarted = true;
        let left = 2;
        autoTimer = setInterval(() => {
          left -= 1;
          const status = panel?.querySelector('#up-status');
          if (status) status.textContent = `${statusText()}（${Math.max(0, left)} 秒后自动更新）`;
          if (left <= 0) {
            clearInterval(autoTimer);
            if (panel?.open) void startDownload();
          }
        }, 1000);
      }
    }

    function close() {
      if (autoTimer) clearInterval(autoTimer);
      if (panel?.open) panel.close();
    }

    async function load() {
      try {
        info = await api('update.status');
        if (info?.ready) {
          phase = 'extracting';
          log('已下载更新', `${versionText(info.ready.version)} 等待重启应用`, 'run');
        } else if (info?.available && info.latest) {
          latest = info.latest;
          phase = 'available';
        } else if (info?.error) {
          errorText = info.error;
        }
      } catch (error) {
        errorText = error.message;
      }
    }

    async function check() {
      if (busy) return;
      busy = true;
      phase = 'checking';
      percent = 0;
      errorText = '';
      log('正在检查更新', '同时询问两个更新源，取最新版本。', 'run');
      paint();
      try {
        const status = await api('update.check');
        info = status;
        if (status.available && status.latest) {
          latest = status.latest;
          phase = 'available';
          log('发现新版本', `${versionText(status.latest.version)} · ${status.latest.sizeText}`, 'new');
        } else if (status.error) {
          phase = 'error';
          errorText = status.error;
          latest = null;
          log('检查失败', status.error, 'bad');
        } else {
          phase = 'idle';
          latest = null;
          log('当前已经是最新版本', `当前版本 ${versionText(status.currentVersion)}，无需更新。`);
        }
      } catch (error) {
        phase = 'error';
        errorText = error.message;
        log('检查失败', error.message, 'bad');
      } finally {
        busy = false;
        paint();
      }
    }

    async function startDownload() {
      if (busy || !latest) return;
      busy = true;
      phase = 'downloading';
      percent = 0;
      errorText = '';
      log('开始下载', `${versionText(latest.version)} · ${latest.sizeText}`, 'run');
      paint();
      try {
        const result = await api('update.download');
        if (!result || result.ok === false) throw new Error(result?.error || '下载失败');
        percent = 100;
        phase = 'extracting';
        log('下载完成', '正在解压并校验文件。', 'run');
        paint();
        await new Promise(resolve => setTimeout(resolve, 400));
        phase = 'applying';
        log('安装完成', '正在重启软件完成更新。', 'new');
        paint();
        await new Promise(resolve => setTimeout(resolve, 600));
        const applied = await api('update.apply');
        if (!applied || applied.ok === false) throw new Error(applied?.error || '无法自动重启，请手动重新打开软件完成更新');
      } catch (error) {
        phase = 'error';
        errorText = error.message || '更新失败';
        log('更新失败', errorText, 'bad');
        busy = false;
        paint();
      }
    }

    async function skip() {
      try {
        await api('update.skip', { version: latest?.version });
        latest = null;
        phase = 'idle';
        log('已跳过此版本', '下个新版本会再提醒。');
      } catch (error) {
        toast(error.message, true);
      }
      paint();
    }

    function onProgress(payload) {
      if (phase !== 'downloading') return;
      percent = Number.isFinite(payload.percent) ? payload.percent : percent;
      paint();
    }

    return Object.freeze({
      initialize() {
        if (window.xx?.onUpdate) {
          window.xx.onUpdate(payload => {
            if (!payload) return;
            if (payload.type === 'available') {
              // 启动自动检查只会推事件、不会走 check()，必须把事件里的版本信息写进本地状态，
              // 否则浮窗会误显示“当前已经是最新版本”，2 秒倒计时也不会启动。
              if (payload.latest) {
                latest = payload.latest;
                phase = 'available';
                info = {
                  ...(info || {}),
                  currentVersion: payload.currentVersion || info?.currentVersion,
                  lastCheckAt: payload.lastCheckAt || info?.lastCheckAt,
                  ready: null,
                };
                log('发现新版本', `${versionText(payload.latest.version)} 可用`, 'new');
                open({ auto: true });
              }
            } else if (payload.type === 'progress') onProgress(payload);
            else if (payload.type === 'error') {
              errorText = payload.message || '更新失败';
              log('更新失败', errorText, 'bad');
              if (phase === 'downloading') { phase = 'error'; busy = false; }
              paint();
            }
          });
        }
        void (async () => {
          try {
            const result = await api('update.consume');
            if (result?.applied?.version) toast(`已更新到 ${versionText(result.applied.version)}`);
            if (result?.failed?.message) toast(`上次更新未完成，已恢复原版本：${result.failed.message}`, true);
            if (result?.rolledBack) toast('上次更新中断，已自动恢复到原版本', true);
          } catch {}
          await load();
          paint();
        })();
      },
      load,
      open,
      handleAction(action) {
        if (action !== 'open-update') return false;
        open();
        return true;
      },
      hasNewVersion: () => Boolean(latest),
      settingsRow() {
        const checkedAt = info?.lastCheckAt ? new Date(info.lastCheckAt).toLocaleString('zh-CN') : '';
        const pending = info?.ready ? ` · 已下载 ${versionText(info.ready.version)}，重启后生效` : '';
        return `<div class="settings-row"><div><strong>软件更新</strong><p>当前 ${versionText(info?.currentVersion || state.info?.version)}${checkedAt ? ` · 上次检查 ${esc(checkedAt)}` : ' · 尚未检查'}${pending}</p></div><div class="actions"><button type="button" class="button small" data-action="open-update">检查更新</button></div></div>`;
      },
    });
  }

  window.XXUpdate = { create };
})();
