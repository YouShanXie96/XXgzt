"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReviewCheckManagementUrl = buildReviewCheckManagementUrl;
exports.buildReviewCheckOrderManagementUrl = buildReviewCheckOrderManagementUrl;
exports.isReviewCheckManagementUrl = isReviewCheckManagementUrl;
exports.isReviewCheckOrderManagementUrl = isReviewCheckOrderManagementUrl;
exports.buildReviewCheckRequestCaptureScript = buildReviewCheckRequestCaptureScript;
exports.readReviewCheckListRequestTemplate = readReviewCheckListRequestTemplate;
exports.waitForReviewCheckListRequestTemplate = waitForReviewCheckListRequestTemplate;
exports.readReviewCheckPageControlSchema = readReviewCheckPageControlSchema;
exports.sanitizeReviewCheckNetworkRequest = sanitizeReviewCheckNetworkRequest;
exports.extractReviewCheckJsonSchema = extractReviewCheckJsonSchema;
exports.extractReviewCheckFilterFieldSchema = extractReviewCheckFilterFieldSchema;
exports.parseReviewCheckJsonPayload = parseReviewCheckJsonPayload;
exports.parseReviewCheckListRequestTemplate = parseReviewCheckListRequestTemplate;
exports.parseReviewCheckOrderRequestTemplate = parseReviewCheckOrderRequestTemplate;
exports.buildReviewCheckOrderRequestData = buildReviewCheckOrderRequestData;
exports.retargetReviewCheckOrderTemplateRange = retargetReviewCheckOrderTemplateRange;
exports.parseTaobaoOrderPagePayload = parseTaobaoOrderPagePayload;
exports.describeTaobaoOrderPayloadShape = describeTaobaoOrderPayloadShape;
exports.fetchTaobaoOrderPage = fetchTaobaoOrderPage;
exports.resolveReviewCheckOrderTemplateForDateRange = resolveReviewCheckOrderTemplateForDateRange;
exports.buildReviewCheckListRequestData = buildReviewCheckListRequestData;
exports.reviewCheckListTemplateSupportsDateRange = reviewCheckListTemplateSupportsDateRange;
exports.resolveReviewCheckListTemplateForDateRange = resolveReviewCheckListTemplateForDateRange;
exports.parseTaobaoReviewPagePayload = parseTaobaoReviewPagePayload;
exports.fetchTaobaoReviewPage = fetchTaobaoReviewPage;
exports.attachReviewCheckContractProbe = attachReviewCheckContractProbe;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const review_check_sync_service_1 = require("./review-check-sync-service");
const reviewCheckManagementBaseUrl = 'https://myseller.taobao.com/home.htm/comment-manage/';
const reviewCheckOrderManagementBaseUrl = 'https://myseller.taobao.com/home.htm/trade-platform/tp/sold';
const reviewCheckListApi = 'mtop.rm.sellercenter.list.data.pc';
const reviewCheckListPathname = '/h5/mtop.rm.sellercenter.list.data.pc/1.0/';
const reviewCheckOrderOrigin = 'https://trade.taobao.com';
const reviewCheckOrderPathname = '/trade/itemlist/asyncSold.htm';
const reviewCheckOrderAllowedFormKeys = new Set([
    'action', 'close', 'dateBegin', 'dateEnd', 'isHideNick', 'isQnNew', 'orderStatus',
    'pageNum', 'prePageNo', 'queryMore', 'rateStatus', 'sifg'
]);
const reviewCheckProbeWriteQueues = new Map();
async function writeReviewCheckProbeSnapshotAtomic(input) {
    const previous = reviewCheckProbeWriteQueues.get(input.outputPath) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
        await node_fs_1.default.promises.writeFile(input.temporaryPath, input.source, 'utf8');
        await node_fs_1.default.promises.rename(input.temporaryPath, input.outputPath);
    });
    reviewCheckProbeWriteQueues.set(input.outputPath, next);
    try {
        await next;
    }
    finally {
        if (reviewCheckProbeWriteQueues.get(input.outputPath) === next) {
            reviewCheckProbeWriteQueues.delete(input.outputPath);
        }
    }
}
function buildReviewCheckManagementUrl() {
    return reviewCheckManagementBaseUrl;
}
function buildReviewCheckOrderManagementUrl() {
    return reviewCheckOrderManagementBaseUrl;
}
function isReviewCheckManagementUrl(value) {
    try {
        const url = new URL(value);
        const pathname = url.pathname.replace(/\/+$/u, '');
        return url.protocol === 'https:'
            && url.hostname.toLowerCase() === 'myseller.taobao.com'
            && (pathname === '/home.htm/comment-manage'
                || pathname.startsWith('/home.htm/comment-manage/'));
    }
    catch {
        return false;
    }
}
function isReviewCheckOrderManagementUrl(value) {
    try {
        const url = new URL(value);
        const pathname = url.pathname.replace(/\/+$/u, '');
        return url.protocol === 'https:'
            && url.hostname.toLowerCase() === 'myseller.taobao.com'
            && (pathname === '/home.htm/trade-platform/tp/sold'
                || pathname.startsWith('/home.htm/trade-platform/tp/sold/'));
    }
    catch {
        return false;
    }
}
function buildReviewCheckRequestCaptureScript() {
    return `(() => {
    if (globalThis.__workbenchReviewListCaptureInstalled) return;
    globalThis.__workbenchReviewListCaptureInstalled = true;
    const targetPath = ${JSON.stringify(reviewCheckListPathname)};
    const targetApi = ${JSON.stringify(reviewCheckListApi)};
    const decodeData = (value) => {
      let current = typeof value === 'string' ? value.trim() : '';
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (current.startsWith('{') || current.startsWith('[') || current.startsWith('"')) {
          try {
            const parsed = JSON.parse(current);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            current = typeof parsed === 'string' ? parsed.trim() : '';
            continue;
          } catch {}
        }
        try {
          const decoded = decodeURIComponent(current);
          if (decoded === current) return null;
          current = decoded.trim();
        } catch {
          return null;
        }
      }
      return null;
    };
    const remember = (rawUrl, body) => {
      try {
        const url = new URL(String(rawUrl), location.href);
        if (url.pathname !== targetPath) return;
        let rawData = null;
        if (body instanceof FormData || body instanceof URLSearchParams) {
          rawData = body.get('data');
        } else if (typeof body === 'string') {
          rawData = new URLSearchParams(body).get('data');
        }
        const data = decodeData(rawData);
        if (!data) return;
        globalThis.__workbenchReviewListTemplate = {
          api: targetApi,
          version: url.searchParams.get('v') || '1.0',
          data
        };
      } catch {}
    };
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__workbenchReviewListUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(body) {
      remember(this.__workbenchReviewListUrl, body);
      return originalSend.call(this, body);
    };
    const originalFetch = globalThis.fetch;
    if (typeof originalFetch === 'function') {
      globalThis.fetch = function(input, init) {
        const rawUrl = typeof input === 'string' ? input : input?.url;
        if (init?.body !== undefined) {
          remember(rawUrl, init.body);
        } else if (input instanceof Request) {
          input.clone().text().then((body) => remember(rawUrl, body)).catch(() => undefined);
        }
        return originalFetch.call(this, input, init);
      };
    }
  })()`;
}
async function readReviewCheckListRequestTemplate(webContents) {
    const value = await webContents.executeJavaScript(`(() => {
    const value = globalThis.__workbenchReviewListTemplate;
    return value ? JSON.parse(JSON.stringify(value)) : null;
  })()`, false);
    return normalizeReviewCheckListTemplate(value);
}
async function waitForReviewCheckListRequestTemplate(input) {
    const maxAttempts = Math.max(1, Math.min(60, Math.trunc(input.maxAttempts ?? 30)));
    const intervalMs = Math.max(0, Math.min(2_000, Math.trunc(input.intervalMs ?? 250)));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const template = await input.read().catch(() => null);
        if (template)
            return template;
        if (attempt < maxAttempts && intervalMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }
    return null;
}
async function readReviewCheckPageControlSchema(webContents) {
    const script = `(() => {
    const rows = [];
    const roots = [document];
    const seenRoots = new Set();
    while (roots.length > 0) {
      const root = roots.shift();
      if (!root || seenRoots.has(root)) continue;
      seenRoots.add(root);
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
        if (element.tagName === 'IFRAME') {
          try { if (element.contentDocument) roots.push(element.contentDocument); } catch {}
        }
        if (element.tagName === 'INPUT') {
          const parts = ['input'];
          for (const attribute of ['type', 'name', 'id', 'placeholder', 'aria-label']) {
            const text = element.getAttribute(attribute);
            if (text && text.length <= 120) parts.push(attribute + '=' + text);
          }
          rows.push(parts.join('|'));
        }
        const text = (element.textContent || '').trim().replace(/\\s+/g, ' ');
        if (text.length > 0 && text.length <= 80
          && /(\\u65e5\\u671f|\\u65f6\\u95f4|\\u67e5\\u8be2|\\u641c\\u7d22|\\u7b5b\\u9009|\\u91cd\\u7f6e)/u.test(text)) {
          const parts = [element.tagName.toLowerCase(), 'text=' + text];
          const role = element.getAttribute('role');
          if (role && role.length <= 40) parts.push('role=' + role);
          const className = typeof element.className === 'string' ? element.className.trim() : '';
          if (className && className.length <= 160) parts.push('class=' + className);
          rows.push(parts.join('|'));
        }
      }
    }
    return Array.from(new Set(rows)).sort();
  })()`;
    const executors = webContents.mainFrame?.framesInSubtree?.length
        ? webContents.mainFrame.framesInSubtree
        : [webContents];
    const results = await Promise.allSettled(executors.map((frame) => frame.executeJavaScript(script, false)));
    const rows = results.flatMap((result) => (result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []));
    return Array.from(new Set(rows.filter((item) => (typeof item === 'string' && item.length <= 500)))).sort().slice(0, 100);
}
function sanitizeReviewCheckNetworkRequest(input) {
    const url = new URL(input.url);
    return {
        method: input.method.trim().toUpperCase() || 'GET',
        origin: url.origin,
        pathname: url.pathname,
        queryKeys: Array.from(new Set(url.searchParams.keys())).sort(),
        bodyKeys: extractBodyKeys(input.postData)
    };
}
function extractReviewCheckJsonSchema(value, maxEntries = 500) {
    const entries = new Set();
    const visit = (candidate, path, depth) => {
        if (!path || depth > 8 || entries.size >= maxEntries)
            return;
        if (candidate === null) {
            entries.add(`${path}:null`);
            return;
        }
        if (Array.isArray(candidate)) {
            entries.add(`${path}:array`);
            for (const sample of candidate
                .filter((item) => item !== null && item !== undefined)
                .slice(0, 20)) {
                if (entries.size >= maxEntries)
                    break;
                visit(sample, `${path}[]`, depth + 1);
            }
            return;
        }
        if (typeof candidate === 'object') {
            entries.add(`${path}:object`);
            for (const [key, child] of Object.entries(candidate)) {
                if (entries.size >= maxEntries)
                    break;
                visit(child, `${path}.${key}`, depth + 1);
            }
            return;
        }
        if (typeof candidate === 'string') {
            entries.add(`${path}:string`);
            const parsed = parseNestedJsonValue(candidate);
            if (parsed !== undefined)
                visit(parsed, path, depth + 1);
            return;
        }
        entries.add(`${path}:${typeof candidate}`);
    };
    if (Array.isArray(value)) {
        visit(value, 'root', 0);
    }
    else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            visit(child, key, 0);
        }
    }
    else {
        visit(value, 'root', 0);
    }
    return Array.from(entries).sort();
}
function extractReviewCheckFilterFieldSchema(value) {
    const fields = new Set();
    const collectFilterItems = (candidate, depth) => {
        if (depth > 8 || fields.size >= 100)
            return;
        if (Array.isArray(candidate)) {
            candidate.slice(0, 100).forEach((item) => collectFilterItems(item, depth + 1));
            return;
        }
        if (!candidate || typeof candidate !== 'object')
            return;
        const object = candidate;
        if (typeof object.name === 'string' && typeof object.uiType === 'string') {
            fields.add(`${object.name}:${object.uiType}`);
        }
        Object.values(object).forEach((child) => collectFilterItems(child, depth + 1));
    };
    const visit = (candidate, depth) => {
        if (depth > 10 || !candidate || typeof candidate !== 'object')
            return;
        if (Array.isArray(candidate)) {
            candidate.slice(0, 100).forEach((item) => visit(item, depth + 1));
            return;
        }
        for (const [key, child] of Object.entries(candidate)) {
            if (key === 'filter')
                collectFilterItems(child, 0);
            visit(child, depth + 1);
        }
    };
    visit(value, 0);
    return Array.from(fields).sort();
}
function parseReviewCheckJsonPayload(source) {
    const trimmed = source.trim();
    if (!trimmed)
        return undefined;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        const open = trimmed.indexOf('(');
        const close = trimmed.lastIndexOf(')');
        if (open <= 0 || close <= open)
            return undefined;
        const callback = trimmed.slice(0, open).trim();
        if (!/^[A-Za-z_$][\w$]*$/u.test(callback))
            return undefined;
        try {
            return JSON.parse(trimmed.slice(open + 1, close));
        }
        catch {
            return undefined;
        }
    }
}
function parseReviewCheckListRequestTemplate(input) {
    try {
        const url = new URL(input.url);
        const api = url.searchParams.get('api')?.trim().toLowerCase();
        if (url.pathname !== reviewCheckListPathname || api !== reviewCheckListApi)
            return null;
        const rawData = new URLSearchParams(input.postData ?? '').get('data');
        if (!rawData)
            return null;
        const data = parseNestedJsonValue(rawData);
        if (!data || typeof data !== 'object' || Array.isArray(data))
            return null;
        return {
            api: reviewCheckListApi,
            version: url.searchParams.get('v')?.trim() || '1.0',
            data: cloneJsonObject(data)
        };
    }
    catch {
        return null;
    }
}
function normalizeReviewCheckListTemplate(value) {
    const template = asObject(value);
    const data = asObject(template?.data);
    if (template?.api !== reviewCheckListApi || !data)
        return null;
    return {
        api: reviewCheckListApi,
        version: optionalString(template.version) ?? '1.0',
        data: cloneJsonObject(data)
    };
}
function parseReviewCheckOrderRequestTemplate(input) {
    try {
        const url = new URL(input.url);
        if (url.origin !== reviewCheckOrderOrigin || url.pathname !== reviewCheckOrderPathname)
            return null;
        const source = new URLSearchParams(input.postData ?? '');
        const form = {};
        for (const [key, value] of source) {
            if (reviewCheckOrderAllowedFormKeys.has(key))
                form[key] = value;
        }
        return Object.keys(form).length ? { form } : null;
    }
    catch {
        return null;
    }
}
function buildReviewCheckOrderRequestData(template, page, range) {
    const current = Math.max(1, Math.trunc(page));
    const form = Object.fromEntries(Object.entries(template.form).filter(([key]) => reviewCheckOrderAllowedFormKeys.has(key)));
    form.pageNum = String(current);
    form.prePageNo = String(Math.max(1, current - 1));
    if (range) {
        form.dateBegin = range.start;
        form.dateEnd = range.end;
    }
    return form;
}
function retargetReviewCheckOrderTemplateRange(template, range) {
    const currentBegin = template.form.dateBegin ?? '';
    const startMs = Date.parse(`${range.start}T00:00:00+08:00`);
    const endMs = Date.parse(`${range.end}T23:59:59.999+08:00`);
    let dateBegin = range.start;
    let dateEnd = range.end;
    if (/^\d{13}$/u.test(currentBegin)) {
        dateBegin = String(startMs);
        dateEnd = String(endMs);
    }
    else if (/^\d{10}$/u.test(currentBegin)) {
        dateBegin = String(Math.floor(startMs / 1_000));
        dateEnd = String(Math.floor(endMs / 1_000));
    }
    else if (/^\d{8}$/u.test(currentBegin)) {
        dateBegin = range.start.replaceAll('-', '');
        dateEnd = range.end.replaceAll('-', '');
    }
    else if (/\d{2}:\d{2}:\d{2}/u.test(currentBegin)) {
        dateBegin = `${range.start} 00:00:00`;
        dateEnd = `${range.end} 23:59:59`;
    }
    return {
        form: {
            ...buildReviewCheckOrderRequestData(template, 1),
            dateBegin,
            dateEnd
        }
    };
}
function parseTaobaoOrderPagePayload(payload, requestedPage) {
    const envelope = asObject(payload);
    const pageInfo = asObject(envelope?.page);
    const page = positiveInteger(pageInfo?.currentPage) ?? Math.max(1, Math.trunc(requestedPage));
    const pageSize = positiveInteger(pageInfo?.pageSize) ?? 15;
    const total = nonNegativeInteger(pageInfo?.totalNumber) ?? 0;
    const mainOrders = Array.isArray(envelope?.mainOrders) ? envelope.mainOrders : [];
    return {
        page,
        totalPages: Math.max(page, Math.ceil(total / pageSize), 1),
        records: mainOrders.flatMap((mainOrder, mainIndex) => parseTaobaoMainOrder(mainOrder, page, mainIndex))
    };
}
function assertTaobaoOrderPageNumber(page, requestedPage) {
    if (page.page !== Math.max(1, Math.trunc(requestedPage))) {
        throw new review_check_sync_service_1.ReviewCheckSyncError('EMPTY_RESPONSE');
    }
    return page;
}
function describeTaobaoOrderPayloadShape(payload) {
    if (Array.isArray(payload))
        return 'root:array';
    const envelope = asObject(payload);
    if (!envelope)
        return `root:${payload === null ? 'null' : typeof payload}`;
    const describe = (value) => {
        if (Array.isArray(value))
            return 'array';
        if (value === null)
            return 'null';
        return typeof value === 'object' ? 'object' : typeof value;
    };
    const root = Object.keys(envelope)
        .sort()
        .slice(0, 24)
        .map((key) => `${key}:${describe(envelope[key])}`)
        .join(',') || 'root:empty-object';
    const data = asObject(envelope.data);
    if (!data)
        return root;
    const nested = Object.keys(data)
        .sort()
        .slice(0, 24)
        .map((key) => `${key}:${describe(data[key])}`)
        .join(',') || 'empty-object';
    const diagnostics = [`${root};data{${nested}}`];
    const retCodes = Array.isArray(envelope.ret)
        ? envelope.ret
            .map((value) => optionalString(value)?.split('::', 1)[0] ?? '')
            .filter((value) => /^[A-Z0-9_-]{1,80}$/u.test(value))
            .slice(0, 4)
        : [];
    if (retCodes.length)
        diagnostics.push(`ret{${retCodes.join(',')}}`);
    const redirect = optionalString(data.url);
    if (redirect) {
        try {
            const url = new URL(redirect);
            diagnostics.push(`redirect{${url.hostname.toLowerCase()}${url.pathname}}`);
        }
        catch {
            diagnostics.push('redirect{invalid-url}');
        }
    }
    return diagnostics.join(';');
}
function assertTaobaoOrderPayloadEnvelope(payload) {
    const envelope = asObject(payload);
    const candidates = [envelope, asObject(envelope?.data)];
    for (const candidate of candidates) {
        if (candidate && !optionalString(candidate.error) && asObject(candidate.page)
            && Array.isArray(candidate.mainOrders)) {
            return candidate;
        }
    }
    const retCodes = Array.isArray(envelope?.ret)
        ? envelope.ret.map((value) => optionalString(value)?.split('::', 1)[0]?.toUpperCase() ?? '')
        : [];
    const redirect = optionalString(asObject(envelope?.data)?.url);
    if (retCodes.some((code) => code === 'FAIL_SYS_USER_VALIDATE' || code === 'RGV587_ERROR')
        || (redirect ? /\/punish(?:[/?#]|$)/iu.test(redirect) : false)) {
        throw new review_check_sync_service_1.ReviewCheckSyncError('USER_VALIDATION_REQUIRED');
    }
    throw new Error(`ORDER_RESPONSE_INVALID:${describeTaobaoOrderPayloadShape(payload)}`);
}
async function fetchTaobaoOrderPageThroughSession(input) {
    let response;
    try {
        response = await input.webContents.session.fetch(input.requestInput.url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                accept: 'application/json, text/plain, */*',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                origin: reviewCheckOrderOrigin,
                referer: `${reviewCheckOrderOrigin}/trade/itemlist/list_sold_items.htm`,
                'x-requested-with': 'XMLHttpRequest'
            },
            body: new URLSearchParams(input.requestInput.form).toString()
        });
    }
    catch {
        throw new Error('ORDER_REQUEST_FAILED');
    }
    if (/login/iu.test(response.url))
        throw new review_check_sync_service_1.ReviewCheckSyncError('LOGIN_EXPIRED');
    if (response.status === 429)
        throw new review_check_sync_service_1.ReviewCheckSyncError('RATE_LIMITED');
    if (!response.ok)
        throw new Error('ORDER_REQUEST_FAILED');
    let source = '';
    try {
        const contentType = response.headers.get('content-type') ?? '';
        const encoding = /charset\s*=\s*(?:gbk|gb2312|gb18030)/iu.test(contentType)
            ? 'gb18030'
            : 'utf-8';
        source = new TextDecoder(encoding).decode(await response.arrayBuffer());
    }
    catch {
        throw new Error('ORDER_RESPONSE_INVALID');
    }
    const payload = parseReviewCheckJsonPayload(source);
    if (payload === undefined) {
        throw new Error(/^\s*</u.test(source) ? 'ORDER_RESPONSE_HTML' : 'ORDER_RESPONSE_INVALID');
    }
    return assertTaobaoOrderPageNumber(parseTaobaoOrderPagePayload(assertTaobaoOrderPayloadEnvelope(payload), input.page), input.page);
}
async function fetchTaobaoOrderPage(input) {
    const requestInput = {
        form: buildReviewCheckOrderRequestData(input.template, input.page, input.range),
        url: `${reviewCheckOrderOrigin}${reviewCheckOrderPathname}?_input_charset=utf8&event_submit_do_query=1`
    };
    const frame = input.webContents.mainFrame.framesInSubtree.find((candidate) => {
        try {
            return new URL(candidate.url).hostname.toLowerCase() === 'trade.taobao.com';
        }
        catch {
            return false;
        }
    });
    if (!frame) {
        let lastError = new Error('ORDER_FRAME_MISSING');
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                return await fetchTaobaoOrderPageThroughSession({
                    page: input.page,
                    requestInput,
                    webContents: input.webContents
                });
            }
            catch (error) {
                if (error instanceof review_check_sync_service_1.ReviewCheckSyncError)
                    throw error;
                lastError = error;
                if (attempt < 3)
                    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
            }
        }
        throw lastError;
    }
    const script = `(() => {
    const input = ${JSON.stringify(requestInput)};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    return fetch(input.url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams(input.form).toString(),
      signal: controller.signal
    }).then(async (response) => {
      if (/login/iu.test(response.url)) return { ok: false, errorCode: 'LOGIN_EXPIRED' };
      if (!response.ok) return { ok: false, errorCode: response.status === 429 ? 'RATE_LIMITED' : 'REQUEST_FAILED' };
      const source = await response.text();
      try { return { ok: true, response: JSON.parse(source) }; }
      catch { return { ok: false, errorCode: 'EMPTY_RESPONSE' }; }
    }).catch(() => ({ ok: false, errorCode: 'REQUEST_FAILED' }))
      .finally(() => clearTimeout(timeout));
  })()`;
    const result = await frame.executeJavaScript(script, false);
    if (result?.ok !== true) {
        if (result?.errorCode === 'LOGIN_EXPIRED')
            throw new review_check_sync_service_1.ReviewCheckSyncError('LOGIN_EXPIRED');
        if (result?.errorCode === 'RATE_LIMITED')
            throw new review_check_sync_service_1.ReviewCheckSyncError('RATE_LIMITED');
        let lastError = new Error(result?.errorCode === 'REQUEST_FAILED' ? 'ORDER_REQUEST_FAILED' : 'ORDER_RESPONSE_INVALID');
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                return await fetchTaobaoOrderPageThroughSession({
                    page: input.page,
                    requestInput,
                    webContents: input.webContents
                });
            }
            catch (error) {
                if (error instanceof review_check_sync_service_1.ReviewCheckSyncError)
                    throw error;
                lastError = error;
                if (attempt < 3)
                    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
            }
        }
        throw lastError;
    }
    return assertTaobaoOrderPageNumber(parseTaobaoOrderPagePayload(assertTaobaoOrderPayloadEnvelope(result.response), input.page), input.page);
}
async function resolveReviewCheckOrderTemplateForDateRange(input) {
    const baseline = await fetchTaobaoOrderPage({
        webContents: input.webContents,
        template: input.template,
        page: 1
    });
    input.onAttempt?.(`baseline:pages=${baseline.totalPages}:records=${baseline.records.length}`);
    const baselineHasRecordsInRange = baseline.records.some((order) => (toShanghaiDateString(order.orderedAt) >= input.range.start
        && toShanghaiDateString(order.orderedAt) <= input.range.end));
    const startMs = Date.parse(`${input.range.start}T00:00:00+08:00`);
    const endMs = Date.parse(`${input.range.end}T23:59:59.999+08:00`);
    const compactStart = input.range.start.replaceAll('-', '');
    const compactEnd = input.range.end.replaceAll('-', '');
    const candidates = [
        { name: 'epoch-ms', start: String(startMs), end: String(endMs) },
        { name: 'epoch-s', start: String(Math.floor(startMs / 1_000)), end: String(Math.floor(endMs / 1_000)) },
        { name: 'compact', start: compactStart, end: compactEnd },
        {
            name: 'datetime',
            start: `${input.range.start} 00:00:00`,
            end: `${input.range.end} 23:59:59`
        }
    ];
    for (const encoding of candidates) {
        const candidate = {
            form: {
                ...buildReviewCheckOrderRequestData(input.template, 1),
                dateBegin: encoding.start,
                dateEnd: encoding.end
            }
        };
        const filtered = await fetchTaobaoOrderPage({
            webContents: input.webContents,
            template: candidate,
            page: 1
        });
        const allWithinRange = filtered.records.every((order) => {
            const date = toShanghaiDateString(order.orderedAt);
            return date >= input.range.start && date <= input.range.end;
        });
        const hasRequiredRecords = !baselineHasRecordsInRange || filtered.records.length > 0;
        input.onAttempt?.(`${encoding.name}:pages=${filtered.totalPages}:within=${allWithinRange}:records=${filtered.records.length}`);
        if (filtered.totalPages < baseline.totalPages && allWithinRange && hasRequiredRecords) {
            return candidate;
        }
    }
    return null;
}
function buildReviewCheckListRequestData(template, page, range) {
    const data = cloneJsonObject(template.data);
    mutateReviewListParameters(data, Math.max(1, Math.trunc(page)), range, 0);
    return data;
}
function reviewCheckListTemplateSupportsDateRange(template) {
    return containsReviewDateParameter(template.data, 0);
}
async function resolveReviewCheckListTemplateForDateRange(input) {
    if (reviewCheckListTemplateSupportsDateRange(input.template))
        return input.template;
    const baseline = await fetchTaobaoReviewPage({
        ...input,
        page: 1
    });
    const baselineHasRecordsInRange = baseline.records.some((review) => {
        if (review.isFollowUp || !review.evaluatedAt)
            return false;
        const date = toShanghaiDateString(review.evaluatedAt);
        return date >= input.range.start && date <= input.range.end;
    });
    input.onAttempt?.(`baseline:pages=${baseline.totalPages}`);
    for (const candidate of buildReviewCheckDateRangeCandidates(input.template, input.range)) {
        try {
            const page = await fetchTaobaoReviewPage({
                webContents: input.webContents,
                template: candidate.template,
                page: 1,
                range: input.range
            });
            const mainReviews = page.records.filter((review) => !review.isFollowUp && review.evaluatedAt);
            const allWithinRange = mainReviews.every((review) => {
                const date = toShanghaiDateString(review.evaluatedAt ?? '');
                return date >= input.range.start && date <= input.range.end;
            });
            const hasRequiredRecords = !baselineHasRecordsInRange || mainReviews.length > 0;
            input.onAttempt?.(`${candidate.label}:pages=${page.totalPages}:within=${allWithinRange}:records=${mainReviews.length}`);
            if (page.totalPages < baseline.totalPages && allWithinRange && hasRequiredRecords) {
                return candidate.template;
            }
        }
        catch {
            input.onAttempt?.(`${candidate.label}:error`);
            // Unsupported encodings are ignored; requests remain read only and bounded.
        }
    }
    return null;
}
function buildReviewCheckDateRangeCandidates(template, range) {
    const values = [
        {
            label: 'array-compact',
            value: [range.start.replaceAll('-', ''), range.end.replaceAll('-', '')]
        }
    ];
    return values.flatMap(({ label, value }) => {
        const data = cloneJsonObject(template.data);
        return injectReviewCheckDateRange(data, value, 0)
            ? [{ label, template: { ...template, data } }]
            : [];
    });
}
function injectReviewCheckDateRange(value, dateRange, depth) {
    if (depth > 10 || value === null || value === undefined)
        return false;
    if (typeof value === 'string' && /^[\s]*[\[{]/u.test(value)) {
        try {
            const parsed = JSON.parse(value);
            if (!injectReviewCheckDateRange(parsed, dateRange, depth + 1))
                return false;
            return false;
        }
        catch {
            return false;
        }
    }
    if (Array.isArray(value)) {
        return value.some((item) => injectReviewCheckDateRange(item, dateRange, depth + 1));
    }
    if (typeof value !== 'object')
        return false;
    const object = value;
    const pagination = asObject(object.pagination);
    if (pagination && ('current' in pagination || 'pageSize' in pagination)) {
        object.dateRange = dateRange;
        return true;
    }
    for (const [key, child] of Object.entries(object)) {
        if (typeof child === 'string' && /^[\s]*[\[{]/u.test(child)) {
            try {
                const parsed = JSON.parse(child);
                if (injectReviewCheckDateRange(parsed, dateRange, depth + 1)) {
                    object[key] = JSON.stringify(parsed);
                    return true;
                }
            }
            catch {
                // Continue with other fields.
            }
        }
        else if (injectReviewCheckDateRange(child, dateRange, depth + 1)) {
            return true;
        }
    }
    return false;
}
function parseTaobaoReviewPagePayload(payload, requestedPage) {
    const envelope = asObject(payload);
    const responseData = asObject(envelope?.data);
    const listData = asObject(responseData?.data);
    const pagination = asObject(listData?.pagination);
    const page = positiveInteger(pagination?.current) ?? Math.max(1, Math.trunc(requestedPage));
    const pageSize = positiveInteger(pagination?.pageSize) ?? 20;
    const total = nonNegativeInteger(pagination?.total) ?? 0;
    const rows = Array.isArray(listData?.dataSource) ? listData.dataSource : [];
    const records = rows.flatMap((row, index) => parseTaobaoReviewRow(row, page, index));
    return {
        page,
        totalPages: Math.max(page, Math.ceil(total / pageSize), 1),
        records
    };
}
async function fetchTaobaoReviewPage(input) {
    const requestInput = {
        api: input.template.api,
        data: buildReviewCheckListRequestData(input.template, input.page, input.range),
        version: input.template.version
    };
    const script = `(() => {
    const input = ${JSON.stringify(requestInput)};
    return (async () => {
      const runtime = globalThis.lib?.mtop ?? globalThis.mtop ?? globalThis.Mtop;
      if (!runtime || typeof runtime.request !== 'function') {
        return { ok: false, errorCode: 'RUNTIME_UNAVAILABLE' };
      }
      try {
        const response = await runtime.request({
          api: input.api,
          v: input.version,
          data: input.data,
          type: 'POST',
          dataType: 'json'
        });
        return { ok: true, response };
      } catch (error) {
        const ret = Array.isArray(error?.ret) ? error.ret.join('|').toUpperCase() : String(error?.code || '').toUpperCase();
        const errorCode = /(USER_VALIDATE|RGV587|CAPTCHA|VERIFY)/u.test(ret) ? 'USER_VALIDATION_REQUIRED'
          : /(SESSION|TOKEN).*EXPIRED|NEED_LOGIN/u.test(ret) ? 'LOGIN_EXPIRED'
          : /(LIMIT|TRAFFIC|FREQUENCY|THROTTLE)/u.test(ret) ? 'RATE_LIMITED' : 'REQUEST_FAILED';
        return { ok: false, errorCode };
      }
    })();
  })()`;
    const result = await input.webContents.executeJavaScript(script, false);
    if (result?.ok !== true)
        throw new review_check_sync_service_1.ReviewCheckSyncError(['USER_VALIDATION_REQUIRED', 'LOGIN_EXPIRED', 'RATE_LIMITED'].includes(result?.errorCode)
            ? result.errorCode : 'EMPTY_RESPONSE');
    const response = asObject(result.response);
    const ret = Array.isArray(response?.ret)
        ? response.ret.filter((value) => typeof value === 'string').join('|').toUpperCase()
        : '';
    if (/(USER_VALIDATE|RGV587|CAPTCHA|VERIFY)/u.test(ret)) {
        throw new review_check_sync_service_1.ReviewCheckSyncError('USER_VALIDATION_REQUIRED');
    }
    if (/(SESSION|TOKEN).*EXPIRED|ILLEGAL_ACCESS|NEED_LOGIN/u.test(ret)) {
        throw new review_check_sync_service_1.ReviewCheckSyncError('LOGIN_EXPIRED');
    }
    if (/(LIMIT|TRAFFIC|FREQUENCY|THROTTLE)/u.test(ret)) {
        throw new review_check_sync_service_1.ReviewCheckSyncError('RATE_LIMITED');
    }
    const responseData = asObject(response?.data);
    const listData = asObject(responseData?.data);
    if (!response || !listData || !Array.isArray(listData.dataSource)) {
        throw new review_check_sync_service_1.ReviewCheckSyncError('EMPTY_RESPONSE');
    }
    const page = parseTaobaoReviewPagePayload(response, input.page);
    const hasOutOfRangeInitialReview = page.records.some((review) => {
        if (review.isFollowUp || !review.evaluatedAt)
            return false;
        const date = toShanghaiDateString(review.evaluatedAt);
        return Boolean(input.range) && (!date || date < input.range.start || date > input.range.end);
    });
    if (hasOutOfRangeInitialReview) {
        throw new review_check_sync_service_1.ReviewCheckSyncError('DATE_RANGE_MISMATCH');
    }
    return page;
}
function mutateReviewListParameters(value, page, range, depth) {
    if (depth > 10)
        return value;
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            value[index] = mutateReviewListParameters(item, page, range, depth + 1);
        });
        return value;
    }
    if (!value || typeof value !== 'object')
        return value;
    for (const [key, child] of Object.entries(value)) {
        const normalizedKey = key.toLowerCase().replace(/[_-]/gu, '');
        if (['current', 'currentpage', 'page', 'pageno', 'pagenum', 'pagenumber'].includes(normalizedKey)) {
            value[key] = page;
            continue;
        }
        if (range && normalizedKey === 'daterange') {
            value[key] = formatReviewDateRange(range, child);
            continue;
        }
        if (range && isStartDateKey(normalizedKey)) {
            value[key] = formatRangeBoundary(range.start, child, false);
            continue;
        }
        if (range && isEndDateKey(normalizedKey)) {
            value[key] = formatRangeBoundary(range.end, child, true);
            continue;
        }
        if (typeof child === 'string' && /^[\s]*[\[{]/u.test(child)) {
            try {
                const parsed = JSON.parse(child);
                value[key] = JSON.stringify(mutateReviewListParameters(parsed, page, range, depth + 1));
                continue;
            }
            catch {
                // Plain strings are intentionally preserved.
            }
        }
        value[key] = mutateReviewListParameters(child, page, range, depth + 1);
    }
    return value;
}
function containsReviewDateParameter(value, depth) {
    if (depth > 10 || value === null || value === undefined)
        return false;
    if (Array.isArray(value))
        return value.some((item) => containsReviewDateParameter(item, depth + 1));
    if (typeof value === 'string' && /^[\s]*[\[{]/u.test(value)) {
        try {
            return containsReviewDateParameter(JSON.parse(value), depth + 1);
        }
        catch {
            return false;
        }
    }
    if (typeof value !== 'object')
        return false;
    return Object.entries(value).some(([key, child]) => {
        const normalizedKey = key.toLowerCase().replace(/[_-]/gu, '');
        return normalizedKey === 'daterange'
            || isStartDateKey(normalizedKey)
            || isEndDateKey(normalizedKey)
            || containsReviewDateParameter(child, depth + 1);
    });
}
function isStartDateKey(key) {
    return ['startdate', 'begindate', 'starttime', 'begintime', 'ratestarttime', 'ratebegintime']
        .includes(key);
}
function isEndDateKey(key) {
    return ['enddate', 'stoptime', 'endtime', 'rateendtime'].includes(key);
}
function formatReviewDateRange(range, sample) {
    if (Array.isArray(sample)) {
        const startSample = sample[0];
        const endSample = sample[1] ?? startSample;
        return [
            formatRangeBoundary(range.start, startSample, false),
            formatRangeBoundary(range.end, endSample, true)
        ];
    }
    if (typeof sample === 'string' && /^[\s]*\[/u.test(sample)) {
        try {
            return JSON.stringify(formatReviewDateRange(range, JSON.parse(sample)));
        }
        catch {
            // Fall back to the compact encoding used by the verified seller-center contract.
        }
    }
    return [range.start.replaceAll('-', ''), range.end.replaceAll('-', '')];
}
function formatRangeBoundary(date, sample, endOfDay) {
    const suffix = endOfDay ? '23:59:59' : '00:00:00';
    const milliseconds = Date.parse(`${date}T${suffix}+08:00`);
    if (typeof sample === 'number') {
        if (sample >= 1_000_000_000_000)
            return milliseconds;
        if (sample >= 1_000_000_000)
            return Math.floor(milliseconds / 1000);
        if (sample >= 10_000_000)
            return Number(date.replaceAll('-', ''));
    }
    if (typeof sample === 'string') {
        if (/^\d{13}$/u.test(sample))
            return String(milliseconds);
        if (/^\d{10}$/u.test(sample))
            return String(Math.floor(milliseconds / 1000));
        if (/^\d{8}$/u.test(sample))
            return date.replaceAll('-', '');
        if (/\d{2}:\d{2}:\d{2}/u.test(sample))
            return `${date} ${suffix}`;
    }
    return date;
}
function parseTaobaoReviewRow(rowValue, page, index) {
    const row = asObject(rowValue);
    if (!row)
        return [];
    const itemInfo = asObject(row.itemInfo);
    const orderInfo = asObject(row.orderInfo);
    const userInfo = asObject(row.userInfo);
    const rateContent = asObject(row.rateContent);
    const mainRate = asObject(rateContent?.mainRate);
    if (!mainRate)
        return [];
    const identifiers = {
        mainOrderId: optionalString(orderInfo?.mainOrderId),
        subOrderId: optionalString(orderInfo?.orderId),
        orderAssociationId: optionalString(itemInfo?.orderId),
        productId: optionalString(itemInfo?.itemId),
        buyerMaskedId: optionalString(userInfo?.securityuid) ?? optionalString(userInfo?.userName)
    };
    const mainReview = createReviewRecord(mainRate, identifiers, {
        fallbackId: `review:${page}:${index}`,
        isFollowUp: false
    });
    const followUps = collectFollowUpRates(rateContent ?? {}, mainRate).map((followUp, followUpIndex) => (createReviewRecord(followUp, identifiers, {
        fallbackId: `${mainReview.reviewId}:follow-up:${followUpIndex + 1}`,
        fallbackEvaluatedAt: addDaysToIsoTimestamp(mainReview.evaluatedAt, numericValue(followUp.days)),
        isFollowUp: true,
        rootReviewId: mainReview.reviewId
    })));
    return [mainReview, ...followUps];
}
function createReviewRecord(rate, identifiers, input) {
    const imageUrls = collectImageUrls(rate, true);
    const timestamp = numericValue(rate.date) ?? numericValue(rate.createdAt) ?? numericValue(rate.rateTime);
    const score = numericValue(rate.score) ?? numericValue(rate.rateScore) ?? numericValue(rate.star);
    return {
        reviewId: optionalString(rate.feedId) ?? optionalString(rate.id) ?? input.fallbackId,
        rootReviewId: input.rootReviewId,
        ...identifiers,
        evaluatedAt: timestamp === undefined
            ? input.fallbackEvaluatedAt ?? toIsoTimestamp(undefined)
            : toIsoTimestamp(timestamp),
        content: optionalString(rate.content),
        score,
        imageCount: Math.max(imageUrls.length, nonNegativeInteger(rate.imageCount) ?? 0),
        thumbnailUrls: imageUrls.slice(0, 8),
        isFollowUp: input.isFollowUp,
        visibility: 'active',
        syncStatus: 'synced'
    };
}
function collectFollowUpRates(rateContent, mainRate) {
    const rates = [];
    for (const source of [rateContent, mainRate]) {
        for (const [key, value] of Object.entries(source)) {
            if (!/(append|follow|additional)/iu.test(key))
                continue;
            if (Array.isArray(value)) {
                rates.push(...value.map(asObject).filter((item) => Boolean(item)));
            }
            else {
                const rate = asObject(value);
                if (rate)
                    rates.push(rate);
            }
        }
    }
    return rates.filter((rate, index) => rates.indexOf(rate) === index);
}
function collectImageUrls(value, skipFollowUps, depth = 0) {
    if (depth > 8 || !value)
        return [];
    if (Array.isArray(value)) {
        return unique(value.flatMap((item) => collectImageUrls(item, skipFollowUps, depth + 1)));
    }
    if (typeof value === 'string') {
        const normalized = normalizeImageUrl(value);
        return normalized ? [normalized] : [];
    }
    if (typeof value !== 'object')
        return [];
    const object = value;
    const mediaType = optionalString(object.uiType)?.toLowerCase() ?? '';
    if (/video/u.test(mediaType) || optionalString(object.mp4Url) || optionalString(object.flashUrl)) {
        return [];
    }
    const urls = [];
    for (const [key, child] of Object.entries(object)) {
        if (skipFollowUps && /(append|follow|additional)/iu.test(key))
            continue;
        if (/^(url|src|thumbnail)$/iu.test(key) && typeof child === 'string') {
            const normalized = normalizeImageUrl(child);
            if (normalized)
                urls.push(normalized);
            continue;
        }
        if (/(image|img|pic|photo|media|thumbnail)/iu.test(key)) {
            urls.push(...collectImageUrls(child, skipFollowUps, depth + 1));
            continue;
        }
        if (depth < 4 && typeof child === 'object') {
            urls.push(...collectImageUrls(child, skipFollowUps, depth + 1));
        }
    }
    return unique(urls);
}
function normalizeImageUrl(value) {
    const trimmed = value.trim();
    if (/^https?:\/\//iu.test(trimmed))
        return trimmed;
    if (/^\/\//u.test(trimmed))
        return `https:${trimmed}`;
    return undefined;
}
function addDaysToIsoTimestamp(value, days) {
    if (days === undefined)
        return undefined;
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds))
        return undefined;
    return new Date(milliseconds + days * 86_400_000).toISOString();
}
function parseTaobaoMainOrder(value, page, mainIndex) {
    const mainOrder = asObject(value);
    if (!mainOrder)
        return [];
    const orderInfo = asObject(mainOrder.orderInfo);
    const statusInfo = asObject(mainOrder.statusInfo);
    const mainOrderId = optionalString(mainOrder.id) ?? optionalString(orderInfo?.id);
    const orderedAt = parseChinaTimestamp(optionalString(orderInfo?.createTime));
    const status = optionalString(statusInfo?.type) ?? optionalString(statusInfo?.text) ?? 'unknown';
    const subOrders = Array.isArray(mainOrder.subOrders) ? mainOrder.subOrders : [];
    return subOrders.map((subOrderValue, subIndex) => {
        const subOrder = asObject(subOrderValue) ?? {};
        const itemInfo = asObject(subOrder.itemInfo) ?? {};
        const subOrderId = optionalString(subOrder.idStr) ?? optionalString(subOrder.id);
        const skuId = positiveIdentifier(itemInfo.skuId);
        const productId = parseItemIdFromUrl(optionalString(itemInfo.itemUrl))
            ?? optionalString(itemInfo.itemId)
            ?? `unknown:${subOrderId ?? `${page}:${mainIndex}:${subIndex}`}`;
        const skuText = Array.isArray(itemInfo.skuText)
            ? itemInfo.skuText.map((entry) => {
                const object = asObject(entry);
                const name = optionalString(object?.name);
                const itemValue = optionalString(object?.value);
                return name && itemValue ? `${name}:${itemValue}` : itemValue ?? name;
            }).filter((entry) => Boolean(entry)).join(' / ')
            : '';
        const title = optionalString(itemInfo.title) ?? '';
        const localOrderKey = [mainOrderId, subOrderId, productId, skuId]
            .filter(Boolean)
            .join(':') || `order:${page}:${mainIndex}:${subIndex}`;
        return {
            localOrderKey,
            mainOrderId,
            subOrderId,
            orderLineId: subOrderId,
            orderAssociationId: subOrderId,
            productId,
            skuId,
            productTitle: skuText ? `${title} (${skuText})` : title,
            quantity: positiveInteger(subOrder.quantity) ?? 1,
            orderedAt,
            status,
            syncStatus: 'synced'
        };
    });
}
function parseItemIdFromUrl(value) {
    if (!value)
        return undefined;
    try {
        const url = new URL(value, 'https://item.taobao.com');
        return positiveIdentifier(url.searchParams.get('id'));
    }
    catch {
        return positiveIdentifier(/(?:[?&])id=(\d+)/u.exec(value)?.[1]);
    }
}
function parseChinaTimestamp(value) {
    if (!value)
        return new Date(0).toISOString();
    const source = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)
        ? `${value.replace(' ', 'T')}+08:00`
        : value;
    const milliseconds = Date.parse(source);
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : new Date(0).toISOString();
}
function toShanghaiDateString(value) {
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds))
        return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'Asia/Shanghai',
        year: 'numeric'
    }).formatToParts(new Date(milliseconds));
    const read = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return `${read('year')}-${read('month')}-${read('day')}`;
}
function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function optionalString(value) {
    if (typeof value === 'string' && value.trim())
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return undefined;
}
function positiveIdentifier(value) {
    const text = optionalString(value);
    return text && /^(?:[1-9]\d*)$/u.test(text) ? text : undefined;
}
function numericValue(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? number : undefined;
}
function positiveInteger(value) {
    const number = numericValue(value);
    return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined;
}
function nonNegativeInteger(value) {
    const number = numericValue(value);
    return number !== undefined && Number.isInteger(number) && number >= 0 ? number : undefined;
}
function toIsoTimestamp(value) {
    if (value === undefined)
        return new Date(0).toISOString();
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
function unique(values) {
    return Array.from(new Set(values));
}
function cloneJsonObject(value) {
    return JSON.parse(JSON.stringify(value));
}
async function attachReviewCheckContractProbe(input) {
    const debuggerClient = input.webContents.debugger;
    const pending = new Map();
    const entries = new Map();
    let disposed = false;
    let latestListRequestTemplate = null;
    let latestOrderRequestTemplate = null;
    let listRequestTemplateSchema = [];
    let orderRequestTemplateSchema = [];
    let orderPreflightSchema = [];
    let filterFieldSchema = [];
    let pageControlSchema = [];
    let dateRangePreflightSchema = [];
    let probeStatus = 'starting';
    let writeTimer = null;
    let writeChain = Promise.resolve();
    const snapshot = () => ({
        capturedAt: new Date().toISOString(),
        dateRangePreflightSchema,
        entries: Array.from(entries.values())
            .sort((left, right) => `${left.origin}${left.pathname}${left.method}`
            .localeCompare(`${right.origin}${right.pathname}${right.method}`)),
        filterFieldSchema,
        listRequestTemplateSchema,
        orderRequestTemplateSchema,
        orderPreflightSchema,
        pageControlSchema,
        probeStatus
    });
    const writeSnapshot = async () => {
        const directory = node_path_1.default.dirname(input.outputPath);
        const temporaryPath = `${input.outputPath}.${input.webContents.id}.tmp`;
        await node_fs_1.default.promises.mkdir(directory, { recursive: true });
        await writeReviewCheckProbeSnapshotAtomic({
            outputPath: input.outputPath,
            temporaryPath,
            source: JSON.stringify(snapshot(), null, 2)
        });
    };
    const scheduleWrite = () => {
        if (disposed || writeTimer)
            return;
        writeTimer = setTimeout(() => {
            writeTimer = null;
            writeChain = writeChain.then(writeSnapshot).catch(() => undefined);
        }, 100);
        writeTimer.unref?.();
    };
    const mergeEntry = (key, request, update = {}) => {
        const previous = entries.get(key);
        entries.set(key, {
            ...request,
            ...previous,
            ...update,
            responseSchema: Array.from(new Set([
                ...(previous?.responseSchema ?? []),
                ...(update.responseSchema ?? [])
            ])).sort()
        });
        scheduleWrite();
    };
    const captureResponseSchema = async (requestId, encodedDataLength) => {
        const tracked = pending.get(requestId);
        pending.delete(requestId);
        if (!tracked || encodedDataLength > 8 * 1024 * 1024 || disposed)
            return;
        try {
            const result = await debuggerClient.sendCommand('Network.getResponseBody', { requestId });
            if (typeof result.body !== 'string')
                return;
            const source = result.base64Encoded
                ? Buffer.from(result.body, 'base64').toString('utf8')
                : result.body;
            const parsed = parseReviewCheckJsonPayload(source);
            if (parsed === undefined)
                return;
            filterFieldSchema = Array.from(new Set([
                ...filterFieldSchema,
                ...extractReviewCheckFilterFieldSchema(parsed)
            ])).sort();
            mergeEntry(tracked.entryKey, tracked.request, {
                responseSchema: extractReviewCheckJsonSchema(parsed)
            });
        }
        catch {
            // The endpoint descriptor remains useful when Chromium does not retain the body.
        }
    };
    const captureListRequestTemplate = async (requestId, url, initialPostData, initialEntryKey, initialRequest) => {
        let postData = initialPostData;
        let template = parseReviewCheckListRequestTemplate({ postData, url });
        if (!template) {
            try {
                const result = await debuggerClient.sendCommand('Network.getRequestPostData', { requestId });
                postData = typeof result.postData === 'string' ? result.postData : postData;
                template = parseReviewCheckListRequestTemplate({ postData, url });
            }
            catch {
                // The request remains usable for schema discovery when Chromium discards its body.
            }
        }
        if (!template || disposed)
            return;
        latestListRequestTemplate = template;
        listRequestTemplateSchema = extractReviewCheckJsonSchema(template.data);
        const hydratedRequest = sanitizeReviewCheckNetworkRequest({
            method: initialRequest.method,
            postData,
            url
        });
        const hydratedEntryKey = JSON.stringify(hydratedRequest);
        const previousEntry = entries.get(initialEntryKey);
        if (hydratedEntryKey !== initialEntryKey)
            entries.delete(initialEntryKey);
        pending.set(requestId, { entryKey: hydratedEntryKey, request: hydratedRequest });
        mergeEntry(hydratedEntryKey, hydratedRequest, previousEntry);
    };
    const captureOrderRequestTemplate = async (requestId, url, initialPostData) => {
        let postData = initialPostData;
        let template = parseReviewCheckOrderRequestTemplate({ postData, url });
        if (!template) {
            try {
                const result = await debuggerClient.sendCommand('Network.getRequestPostData', { requestId });
                postData = typeof result.postData === 'string' ? result.postData : postData;
                template = parseReviewCheckOrderRequestTemplate({ postData, url });
            }
            catch {
                // The endpoint schema remains available when Chromium discards the request body.
            }
        }
        if (!template || disposed)
            return;
        latestOrderRequestTemplate = { form: { ...template.form } };
        orderRequestTemplateSchema = Object.keys(template.form).sort().map((key) => `form.${key}:string`);
        scheduleWrite();
    };
    const onMessage = (_event, method, params) => {
        const requestId = typeof params.requestId === 'string' ? params.requestId : null;
        if (method === 'Network.requestWillBeSent' && requestId) {
            const resourceType = typeof params.type === 'string' ? params.type : '';
            if (!['Document', 'Fetch', 'XHR'].includes(resourceType))
                return;
            const request = params.request;
            if (typeof request?.url !== 'string' || typeof request.method !== 'string')
                return;
            try {
                const sanitized = sanitizeReviewCheckNetworkRequest({
                    method: request.method,
                    postData: typeof request.postData === 'string' ? request.postData : undefined,
                    url: request.url
                });
                if (!isReviewCheckPlatformOrigin(sanitized.origin))
                    return;
                const entryKey = JSON.stringify(sanitized);
                pending.set(requestId, { entryKey, request: sanitized });
                mergeEntry(entryKey, sanitized);
                if (sanitized.pathname === reviewCheckListPathname) {
                    void captureListRequestTemplate(requestId, request.url, typeof request.postData === 'string' ? request.postData : undefined, entryKey, sanitized);
                }
                else if (sanitized.origin === reviewCheckOrderOrigin
                    && sanitized.pathname === reviewCheckOrderPathname) {
                    void captureOrderRequestTemplate(requestId, request.url, typeof request.postData === 'string' ? request.postData : undefined);
                }
            }
            catch {
                // Ignore malformed or non-HTTP requests without logging their values.
            }
            return;
        }
        if (method === 'Network.responseReceived' && requestId) {
            const tracked = pending.get(requestId);
            const response = params.response;
            if (!tracked || !response)
                return;
            mergeEntry(tracked.entryKey, tracked.request, {
                mimeType: typeof response.mimeType === 'string' ? response.mimeType : undefined,
                status: typeof response.status === 'number' ? response.status : undefined
            });
            return;
        }
        if (method === 'Network.loadingFinished' && requestId) {
            const encodedDataLength = typeof params.encodedDataLength === 'number'
                ? params.encodedDataLength
                : 0;
            void captureResponseSchema(requestId, encodedDataLength);
        }
    };
    await writeSnapshot();
    if (!debuggerClient.isAttached())
        debuggerClient.attach('1.3');
    debuggerClient.on('message', onMessage);
    await debuggerClient.sendCommand('Network.enable');
    await debuggerClient.sendCommand('Page.enable');
    await debuggerClient.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: buildReviewCheckRequestCaptureScript()
    });
    probeStatus = 'ready';
    await writeSnapshot();
    return {
        captureDateRangePreflightSchema(schema) {
            dateRangePreflightSchema = Array.from(new Set(schema)).sort().slice(0, 30);
            scheduleWrite();
        },
        captureOrderPreflightSchema(schema) {
            orderPreflightSchema = Array.from(new Set(schema)).sort().slice(0, 20);
            scheduleWrite();
        },
        capturePageControlSchema(schema) {
            pageControlSchema = Array.from(new Set(schema)).sort().slice(0, 100);
            scheduleWrite();
        },
        captureListRequestTemplate(template) {
            latestListRequestTemplate = {
                ...template,
                data: cloneJsonObject(template.data)
            };
            listRequestTemplateSchema = extractReviewCheckJsonSchema(template.data);
            scheduleWrite();
        },
        getListRequestTemplate() {
            return latestListRequestTemplate
                ? {
                    ...latestListRequestTemplate,
                    data: cloneJsonObject(latestListRequestTemplate.data)
                }
                : null;
        },
        getOrderRequestTemplate() {
            return latestOrderRequestTemplate ? { form: { ...latestOrderRequestTemplate.form } } : null;
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            latestListRequestTemplate = null;
            latestOrderRequestTemplate = null;
            listRequestTemplateSchema = [];
            orderRequestTemplateSchema = [];
            if (writeTimer) {
                clearTimeout(writeTimer);
                writeTimer = null;
                writeChain = writeChain.then(writeSnapshot).catch(() => undefined);
            }
            debuggerClient.removeListener('message', onMessage);
            if (debuggerClient.isAttached())
                debuggerClient.detach();
        }
    };
}
function extractBodyKeys(postData) {
    if (!postData?.trim())
        return [];
    try {
        const parsed = JSON.parse(postData);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return Object.keys(parsed).sort();
        }
    }
    catch {
        // Form bodies are handled below without retaining their values.
    }
    try {
        const keys = new Set();
        for (const [key, value] of new URLSearchParams(postData)) {
            keys.add(key);
            collectNestedBodyKeys(value, key, keys, 0);
        }
        return Array.from(keys).sort();
    }
    catch {
        return [];
    }
}
function collectNestedBodyKeys(value, path, keys, depth) {
    if (depth > 8 || keys.size >= 500)
        return;
    if (typeof value === 'string') {
        const parsed = parseNestedJsonValue(value);
        if (parsed !== undefined)
            collectNestedBodyKeys(parsed, path, keys, depth + 1);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value.slice(0, 20)) {
            collectNestedBodyKeys(item, `${path}[]`, keys, depth + 1);
        }
        return;
    }
    if (!value || typeof value !== 'object')
        return;
    for (const [key, child] of Object.entries(value)) {
        const childPath = `${path}.${key}`;
        keys.add(childPath);
        collectNestedBodyKeys(child, childPath, keys, depth + 1);
    }
}
function parseNestedJsonValue(value) {
    let current = value.trim();
    for (let attempt = 0; attempt < 4; attempt += 1) {
        if (current.startsWith('{') || current.startsWith('[') || current.startsWith('"')) {
            try {
                const parsed = JSON.parse(current);
                if (typeof parsed !== 'string')
                    return parsed;
                current = parsed.trim();
                continue;
            }
            catch {
                // Percent decoding is attempted below.
            }
        }
        try {
            const decoded = decodeURIComponent(current);
            if (decoded === current)
                return undefined;
            current = decoded.trim();
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
function isReviewCheckPlatformOrigin(origin) {
    try {
        const hostname = new URL(origin).hostname.toLowerCase();
        return ['taobao.com', 'tmall.com', 'alibaba.com'].some((suffix) => (hostname === suffix || hostname.endsWith(`.${suffix}`)));
    }
    catch {
        return false;
    }
}
