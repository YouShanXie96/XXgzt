'use strict';

(() => {
  const progressListeners = new Set();
  const updateListeners = new Set();
  let eventSource = null;

  function ensureEventSource() {
    if (eventSource || typeof EventSource !== 'function') return;
    eventSource = new EventSource('/api/events');
    eventSource.addEventListener('progress', (event) => {
      let data = {};
      try { data = JSON.parse(event.data || '{}'); } catch { return; }
      for (const fn of progressListeners) {
        try { fn(data); } catch {}
      }
    });
    eventSource.addEventListener('update', (event) => {
      let data = {};
      try { data = JSON.parse(event.data || '{}'); } catch { return; }
      for (const fn of updateListeners) {
        try { fn(data); } catch {}
      }
    });
    eventSource.onerror = () => {
      // EventSource automatically reconnects.
    };
  }

  const FILE_PICK_ACTIONS = {
    'compliance.import': '.xlsx,.xlsm,.csv',
    'compliance.importRules': '.xlsx,.xlsm,.csv',
    'recommendations.importPreview': '.xlsx,.xlsm,.csv',
    'recommendations.importRaw': '.xlsx,.xlsm,.csv',
    'purchase.import': '.xlsx,.xlsm,.csv',
    'qualification.import': '.xlsx,.xlsm,.csv',
    'qualification.pickImage': '.png,.jpg,.jpeg,.webp',
    'data.importBackup': '.zip',
    'selectionpool.editorPickImage': '.png,.jpg,.jpeg,.webp',
  };

  function pickBrowserFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.style.display = 'none';
      let settled = false;
      const finish = (file) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(file || null);
      };
      input.addEventListener('change', () => finish(input.files?.[0] || null), { once: true });
      input.addEventListener('cancel', () => finish(null), { once: true });
      window.addEventListener('focus', () => {
        setTimeout(() => { if (!settled && !input.files?.length) finish(null); }, 400);
      }, { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function uploadFile(file) {
    const resp = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name || 'upload.bin'),
      },
      body: file,
    });
    const json = await resp.json();
    if (!resp.ok || !json?.ok) {
      throw new Error(json?.error || '文件上传失败');
    }
    return json;
  }

  function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
  }

  window.xx = {
    async call(action, payload = {}) {
      let uploadPath = null;
      const accept = FILE_PICK_ACTIONS[action];
      if (accept && !payload?.filePath && !payload?.path) {
        const file = await pickBrowserFile(accept);
        if (!file) return { ok: true, data: { canceled: true } };
        const uploaded = await uploadFile(file);
        uploadPath = uploaded.path;
      }

      const resp = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload, uploadPath }),
      });
      const result = await resp.json();
      if (result?.ok && result?.data?.downloadUrl) {
        triggerDownload(result.data.downloadUrl, result.data.filename);
      }
      if (result?.ok && result?.data?.openUrl && /^https?:\/\//i.test(result.data.openUrl)) {
        // Show notice instead of blocked popup
        console.info('[谢谢工作台] 外部链接:', result.data.openUrl);
      }
      return result;
    },
    pathForFile(file) {
      try {
        return String(file?.path || '');
      } catch {
        return '';
      }
    },
    uploadFile,
    onProgress(fn) {
      if (typeof fn !== 'function') return () => {};
      ensureEventSource();
      progressListeners.add(fn);
      return () => progressListeners.delete(fn);
    },
    onUpdate(fn) {
      if (typeof fn !== 'function') return () => {};
      ensureEventSource();
      updateListeners.add(fn);
      return () => updateListeners.delete(fn);
    },
  };
})();
