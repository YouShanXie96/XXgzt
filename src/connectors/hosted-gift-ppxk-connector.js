"use strict";
/**
 * Hosted-gift Phase 1 Magix/ppxk connector.
 *
 * Reuses shop WebContents executeJavaScript + fetch(credentials: 'include')
 * (same style as promotion-alimama / internal-purchase), NOT official open API
 * and NOT DOM click automation for enroll/exit.
 *
 * Live APIs: https://ppxk.taobao.com/new/api/<name>.json
 * Query params (live capture): r, param (JSON string), timeStr, dynamicToken, csrfID, version
 *
 * Token capture: prefer session.webRequest on shop partition (*://ppxk.taobao.com/new/api/*)
 * for csrfID+dynamicToken; also scrape top-level + same-origin iframe performance/storage.
 *
 * signItems POST body confirmed from apply.js (one call per item):
 * {
 *   marketingSolutionId,
 *   signItemParam: {
 *     itemId, settleId,                 // settleId = 单品费率
 *     subMarketingSolutionIds, benefitType,
 *     activityId?, recordId?,           // flow-acceleration only; omit for 超级新品加速 unless present
 *     skuParam?: [{ skuId, settleId: selectedRation, benefitType }],  // ratioType === 'sku'; every settleId required
 *     needQuerySku,
 *     extraMap?: { recSrc }
 *   }
 * }
 * Strip before send: ratioStrategy, isMultiSignTyro, isMultiSignOld.
 *
 * cancelSignedItems: { marketingSolutionId, pmItemSignList: [{ pmId, itemId }] }
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIGN_ITEM_CLIENT_STRIP_KEYS = exports.PPXK_WEBREQUEST_URL_FILTER = exports.HostedGiftPpxkError = exports.HOSTED_GIFT_PHASE1_TAB_LABEL = exports.PPXK_SESSION_WAIT_MS = exports.PPXK_SESSION_WAIT_MAX_ATTEMPTS = exports.PPXK_REQUEST_TIMEOUT_MS = exports.PPXK_DEFAULT_VERSION = exports.PPXK_API_BASE_PATH = exports.PPXK_API_ORIGIN = exports.HOSTED_GIFT_LAOKE_AMOUNT_SOLUTION_ID = exports.HOSTED_GIFT_LAOKE_SOLUTION_ID = exports.HOSTED_GIFT_XINKE_SOLUTION_ID = exports.HOSTED_GIFT_XINPIN_SOLUTION_ID = exports.HOSTED_GIFT_PHASE1_MARKETING_SOLUTION_ID = exports.HOSTED_GIFT_PLATFORM_URL = void 0;
exports.configureHostedGiftDiagnostics = configureHostedGiftDiagnostics;
exports.sanitizePpxkDiagnosticText = sanitizePpxkDiagnosticText;
exports.describePpxkUrlLocation = describePpxkUrlLocation;
exports.recordHostedGiftDiagnostic = recordHostedGiftDiagnostic;
exports.hostedGiftLoginRequiredError = hostedGiftLoginRequiredError;
exports.describeHostedGiftError = describeHostedGiftError;
exports.isHostedGiftPlatformUrl = isHostedGiftPlatformUrl;
exports.isPpxkLoginUrl = isPpxkLoginUrl;
exports.isPpxkSessionExpiredMessage = isPpxkSessionExpiredMessage;
exports.readPpxkSessionValue = readPpxkSessionValue;
exports.findPpxkSessionContextFromValues = findPpxkSessionContextFromValues;
exports.findPpxkSessionContextFromResourceUrls = findPpxkSessionContextFromResourceUrls;
exports.clearPpxkSessionWebRequestCache = clearPpxkSessionWebRequestCache;
exports.hasSeenPpxkWebRequestTokens = hasSeenPpxkWebRequestTokens;
exports.rememberPpxkSessionFromRequestUrl = rememberPpxkSessionFromRequestUrl;
exports.getCachedPpxkSessionContext = getCachedPpxkSessionContext;
exports.resolveLatestPpxkSession = resolveLatestPpxkSession;
exports.attachPpxkSessionWebRequestCapture = attachPpxkSessionWebRequestCapture;
exports.ensurePpxkSessionWebRequestCapture = ensurePpxkSessionWebRequestCapture;
exports.resolvePpxkSessionPartitionKey = resolvePpxkSessionPartitionKey;
exports.buildPpxkRequestId = buildPpxkRequestId;
exports.buildPpxkApiUrl = buildPpxkApiUrl;
exports.withMarketingSolutionId = withMarketingSolutionId;
exports.stripSignItemClientFields = stripSignItemClientFields;
exports.missingSkuSettleIds = missingSkuSettleIds;
exports.buildSignItemParam = buildSignItemParam;
exports.buildSignItemsPostBody = buildSignItemsPostBody;
exports.buildSignItemsParamItemRate = buildSignItemsParamItemRate;
exports.buildSignItemsParamSkuRate = buildSignItemsParamSkuRate;
exports.buildCancelSignedItemsParam = buildCancelSignedItemsParam;
exports.buildQuerySelectItemListParam = buildQuerySelectItemListParam;
exports.buildQuerySelectSkuListParam = buildQuerySelectSkuListParam;
exports.buildQuerySignedItemListParam = buildQuerySignedItemListParam;
exports.getPpxkPlatformMessage = getPpxkPlatformMessage;
exports.getPpxkPlatformCode = getPpxkPlatformCode;
exports.isPpxkPlatformFailure = isPpxkPlatformFailure;
exports.parseSignItemsResult = parseSignItemsResult;
exports.parseJsonResponse = parseJsonResponse;
exports.parseSelectableItems = parseSelectableItems;
exports.parseSelectSkuList = parseSelectSkuList;
exports.parseSignedItems = parseSignedItems;
exports.resolveSettleIdForPercent = resolveSettleIdForPercent;
exports.settleIdFromRatePercent = settleIdFromRatePercent;
exports.resolveSettleId = resolveSettleId;
exports.normalizeItemIds = normalizeItemIds;
exports.normalizeRatePercent = normalizeRatePercent;
exports.readPpxkPageSessionContext = readPpxkPageSessionContext;
exports.activateHostedGiftPhase1Tab = activateHostedGiftPhase1Tab;
exports.diagnoseHostedGiftPhase1Page = diagnoseHostedGiftPhase1Page;
exports.waitForPpxkPageSessionContext = waitForPpxkPageSessionContext;
exports.ensureHostedGiftPlatformPage = ensureHostedGiftPlatformPage;
exports.requestPpxkJson = requestPpxkJson;
exports.listSelectableItems = listSelectableItems;
exports.listSelectSku = listSelectSku;
exports.listSignedItems = listSignedItems;
exports.signItems = signItems;
exports.cancelSignedItems = cancelSignedItems;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const hosted_gift_errors_1 = require("../shared/hosted-gift-errors");
/** Self-contained defaults (avoid value imports from shared for unit-test isolation). */
exports.HOSTED_GIFT_PLATFORM_URL = 'https://myseller.taobao.com/home.htm/qianniu-alimama-ppxx/';
exports.HOSTED_GIFT_PHASE1_MARKETING_SOLUTION_ID = '2'; // alias = xinpin
/** Keep in sync with @workbench/shared (unit-test isolation: local values). */
exports.HOSTED_GIFT_XINPIN_SOLUTION_ID = '2';
exports.HOSTED_GIFT_XINKE_SOLUTION_ID = '1';
exports.HOSTED_GIFT_LAOKE_SOLUTION_ID = '121';
exports.HOSTED_GIFT_LAOKE_AMOUNT_SOLUTION_ID = '479';
exports.PPXK_API_ORIGIN = 'https://ppxk.taobao.com';
exports.PPXK_API_BASE_PATH = '/new/api';
/** Live Magix version prefix captured from ppxk XHR (trailing dot is intentional). */
exports.PPXK_DEFAULT_VERSION = '20260914.';
// Non-exported copies for functions injected via Function#toString into shop pages
// (tsc rewrites exported const refs to `exports.X`, which breaks in the browser).
const PPXK_ORIGIN_FOR_PAGE = 'https://ppxk.taobao.com';
const PPXK_BASE_PATH_FOR_PAGE = '/new/api';
const PPXK_VERSION_FOR_PAGE = '20260914.';
exports.PPXK_REQUEST_TIMEOUT_MS = 45_000;
/** Background WC may need >6s before Magix fires /new/api with tokens. */
exports.PPXK_SESSION_WAIT_MAX_ATTEMPTS = 80;
exports.PPXK_SESSION_WAIT_MS = 250;
exports.HOSTED_GIFT_PHASE1_TAB_LABEL = '超级新品加速';
class HostedGiftPpxkError extends Error {
    code;
    detail;
    constructor(message, code, detail = {}) {
        super(message);
        this.code = code;
        this.detail = detail;
        this.name = 'HostedGiftPpxkError';
    }
}
exports.HostedGiftPpxkError = HostedGiftPpxkError;
// ---------------------------------------------------------------------------
// Diagnostics: 反馈问题 sanitized log lines + optional local debug files
// ---------------------------------------------------------------------------
let hostedGiftDiagnosticSink = null;
let hostedGiftDebugDir = null;
/** Wired from main: sink feeds the feedback-center diagnostics; debugDir lives under userData. */
function configureHostedGiftDiagnostics(input) {
    if (input.sink !== undefined)
        hostedGiftDiagnosticSink = input.sink;
    if (input.debugDir !== undefined)
        hostedGiftDebugDir = input.debugDir;
}
function sanitizePpxkDiagnosticText(value) {
    return (0, hosted_gift_errors_1.sanitizeHostedGiftErrorText)(value, 400);
}
/** hostname + first path segment only — query strings can carry tokens. */
function describePpxkUrlLocation(value) {
    try {
        const url = new URL(value);
        return `${url.hostname}${url.pathname.slice(0, 48)}`;
    }
    catch {
        return value ? 'unparsable-url' : 'empty-url';
    }
}
function recordHostedGiftDiagnostic(event, fields = {}) {
    try {
        const parts = Object.entries(fields)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => `${k}=${sanitizePpxkDiagnosticText(typeof v === 'string' ? v : JSON.stringify(v))}`);
        hostedGiftDiagnosticSink?.(`${event}${parts.length ? ` ${parts.join(' ')}` : ''}`);
    }
    catch {
        // diagnostics never break the live flow
    }
}
function hostedGiftLoginRequiredError(loginReason, extra = {}) {
    const detail = {
        ...extra,
        loginReason,
        platformMessage: extra.platformMessage ? (0, hosted_gift_errors_1.sanitizeHostedGiftErrorText)(extra.platformMessage) : undefined,
        location: extra.location,
        httpStatus: extra.httpStatus
    };
    recordHostedGiftDiagnostic('needs-login', detail);
    const message = detail.platformMessage || ({
        'page-redirect': '打开品牌新享页面时，淘宝跳转到了登录页',
        'api-redirect': '品牌新享接口跳转到了登录页',
        'http-401': '平台未授权本次请求，未返回具体错误原因',
        'platform-message': '平台要求核对登录状态，未返回具体错误原因'
    }[loginReason]);
    return new HostedGiftPpxkError(message, 'needs-login', detail);
}
function describeHostedGiftError(error) {
    if (error instanceof HostedGiftPpxkError)
        return (0, hosted_gift_errors_1.formatHostedGiftFailure)(error.message, error.detail);
    return (0, hosted_gift_errors_1.sanitizeHostedGiftErrorText)(error instanceof Error ? error.message : error) || '平台未返回具体错误原因';
}
exports.PPXK_WEBREQUEST_URL_FILTER = { urls: ['*://ppxk.taobao.com/new/api/*'] };
// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no Electron)
// ---------------------------------------------------------------------------
function isHostedGiftPlatformUrl(value) {
    if (isPpxkLoginUrl(value))
        return false;
    try {
        const url = new URL(value);
        return ((url.hostname === 'myseller.taobao.com' || url.hostname.endsWith('.taobao.com'))
            && /qianniu-alimama-ppxx|ppxk/i.test(url.href));
    }
    catch {
        return /qianniu-alimama-ppxx/i.test(value);
    }
}
const PPXK_LOGIN_HOSTS = /^(?:login|havanalogin|login\.m|passport)\.(?:taobao|tmall)\.com$|^passport\.alibaba\.com$/i;
/** Hostname-based: a myseller URL whose query merely mentions login.taobao.com is not a login page. */
function isPpxkLoginUrl(value) {
    try {
        return PPXK_LOGIN_HOSTS.test(new URL(value).hostname);
    }
    catch {
        return /^(?:https?:\/\/)?(?:login|havanalogin|passport)\.(?:taobao|tmall)\.com/i.test(String(value ?? '').trim());
    }
}
/**
 * Only messages that explicitly say the session is gone count as 登录失效.
 * 「当前登录账号无权限」「请使用主账号登录」 etc. are permission / business errors and
 * surface verbatim instead of being collapsed into 店铺登录已失效.
 */
function isPpxkSessionExpiredMessage(message) {
    const text = String(message ?? '');
    if (!text)
        return false;
    if (/权限|授权|无权|子账号|主账号|签署|协议|大促|降级|暂停|维护/.test(text))
        return false;
    return /未登录|没有登录|请(?:先|重新)?登录|登录(?:已|状态)?(?:失效|过期|超时)|会话(?:已)?(?:失效|过期)|session[\s_-]*(?:expired|timeout|invalid)|not[\s_-]*login|need[\s_-]*login|login[\s_-]*(?:required|expired|timeout)/i.test(text);
}
/** Read csrfID / dynamicToken from a URL, query fragment, or storage blob. */
function readPpxkSessionValue(text, key) {
    try {
        const url = new URL(text);
        const value = url.searchParams.get(key) ?? url.searchParams.get(key.toLowerCase());
        if (value)
            return value;
    }
    catch {
        // Storage values are often JSON or query fragments rather than complete URLs.
    }
    const pattern = new RegExp(`(?:^|[?&=,{\\s"'])${key}(?:["']|%22)?\\s*(?:=|:|%3A)\\s*(?:["']|%22)?([^"'&}\\s,%]+)`, 'i');
    return pattern.exec(text)?.[1] ?? '';
}
/** Decode percent-encoded resource URL / storage candidates for token scraping. */
function expandPpxkSessionCandidates(original) {
    const candidates = [original];
    try {
        const decoded = decodeURIComponent(original);
        if (decoded !== original)
            candidates.push(decoded);
    }
    catch {
        // Ignore malformed percent-encoded values.
    }
    return candidates;
}
function readPpxkTimeStr(text) {
    try {
        const url = new URL(text);
        const value = url.searchParams.get('timeStr') ?? url.searchParams.get('timestr');
        if (value)
            return value;
    }
    catch {
        // Storage blobs may not be URLs.
    }
    return /(?:^|[?&=,{\s"'])timeStr(?:["']|%22)?\s*(?:=|:|%3A)\s*(?:["']|%22)?([^"'&}\s,%]+)/i.exec(text)?.[1] ?? '';
}
function readSessionPairFromText(text) {
    const csrfID = readPpxkSessionValue(text, 'csrfID');
    const dynamicToken = readPpxkSessionValue(text, 'dynamicToken');
    if (!csrfID || !dynamicToken)
        return null;
    const timeStr = readPpxkTimeStr(text);
    return timeStr ? { csrfID, dynamicToken, timeStr } : { csrfID, dynamicToken };
}
function isPpxkApiResourceUrl(value) {
    return /ppxk\.taobao\.com\/new\/api/i.test(value);
}
/**
 * Extract csrfID + dynamicToken from resource URLs / storage strings.
 * Prefer a single ppxk `/new/api` URL that already carries both query params
 * (page Magix has already minted dynamicToken for prior calls).
 */
function findPpxkSessionContextFromValues(values) {
    const normalized = values.map((value) => String(value ?? '')).filter(Boolean);
    // Pass 1: same-string pair on Magix API resources (newest last → scan reverse).
    for (let index = normalized.length - 1; index >= 0; index -= 1) {
        const original = normalized[index];
        if (!isPpxkApiResourceUrl(original))
            continue;
        for (const candidate of expandPpxkSessionCandidates(original)) {
            const pair = readSessionPairFromText(candidate);
            if (pair)
                return pair;
        }
    }
    // Pass 2: any same-string pair.
    for (let index = normalized.length - 1; index >= 0; index -= 1) {
        for (const candidate of expandPpxkSessionCandidates(normalized[index])) {
            const pair = readSessionPairFromText(candidate);
            if (pair)
                return pair;
        }
    }
    // Pass 3: assemble across values (storage blobs may split keys).
    let csrfID = '';
    let dynamicToken = '';
    for (let index = normalized.length - 1; index >= 0; index -= 1) {
        for (const candidate of expandPpxkSessionCandidates(normalized[index])) {
            csrfID ||= readPpxkSessionValue(candidate, 'csrfID');
            dynamicToken ||= readPpxkSessionValue(candidate, 'dynamicToken');
            if (csrfID && dynamicToken)
                return { csrfID, dynamicToken };
        }
    }
    return csrfID && dynamicToken ? { csrfID, dynamicToken } : null;
}
function findPpxkSessionContextFromResourceUrls(resourceUrls) {
    return findPpxkSessionContextFromValues(resourceUrls);
}
const ppxkSessionByPartition = new Map();
const ppxkSessionByElectronSession = new WeakMap();
const ppxkWebRequestAttachedSessions = new WeakSet();
let ppxkWebRequestEverSeen = false;
function clearPpxkSessionWebRequestCache() {
    ppxkSessionByPartition.clear();
    ppxkWebRequestEverSeen = false;
}
function hasSeenPpxkWebRequestTokens() {
    return ppxkWebRequestEverSeen;
}
function rememberPpxkSessionFromRequestUrl(requestUrl, options = {}) {
    const pair = findPpxkSessionContextFromValues([String(requestUrl ?? '')]);
    if (!pair)
        return null;
    const cached = {
        ...pair,
        updatedAt: Date.now(),
        sourceUrl: String(requestUrl)
    };
    ppxkWebRequestEverSeen = true;
    if (options.partitionKey) {
        ppxkSessionByPartition.set(options.partitionKey, cached);
    }
    if (options.electronSession && typeof options.electronSession === 'object') {
        ppxkSessionByElectronSession.set(options.electronSession, cached);
    }
    // Always keep a default slot so callers without partition still benefit.
    if (!options.partitionKey) {
        ppxkSessionByPartition.set('__default__', cached);
    }
    return pair;
}
function getCachedPpxkSessionContext(options = {}) {
    if (options.electronSession && typeof options.electronSession === 'object') {
        const hit = ppxkSessionByElectronSession.get(options.electronSession);
        if (hit?.csrfID && hit?.dynamicToken) {
            const out = { csrfID: hit.csrfID, dynamicToken: hit.dynamicToken };
            if (hit.timeStr)
                out.timeStr = hit.timeStr;
            return out;
        }
    }
    const key = options.partitionKey ?? '__default__';
    const hit = ppxkSessionByPartition.get(key);
    if (hit?.csrfID && hit?.dynamicToken) {
        const out = { csrfID: hit.csrfID, dynamicToken: hit.dynamicToken };
        if (hit.timeStr)
            out.timeStr = hit.timeStr;
        return out;
    }
    return null;
}
/**
 * Prefer the newest webRequest-captured Magix token (csrfID+dynamicToken[+timeStr])
 * over a stale session frozen at page-load / withSession start.
 */
function resolveLatestPpxkSession(fallback, options = {}) {
    const cached = getCachedPpxkSessionContext(options);
    if (cached?.csrfID && cached?.dynamicToken)
        return cached;
    if (fallback?.csrfID && fallback?.dynamicToken)
        return fallback;
    return null;
}
/**
 * Attach session.webRequest listener on the shop partition Session used by
 * hosted-gift background BrowserWindow / getHostedGiftProfileWebContents.
 * Extracts csrfID + dynamicToken from *://ppxk.taobao.com/new/api/* request URLs.
 * Idempotent per Electron Session object.
 */
function attachPpxkSessionWebRequestCapture(electronSession, options = {}) {
    if (!electronSession?.webRequest?.onBeforeRequest)
        return false;
    const sessionObject = electronSession;
    if (ppxkWebRequestAttachedSessions.has(sessionObject))
        return true;
    try {
        electronSession.webRequest.onBeforeRequest(exports.PPXK_WEBREQUEST_URL_FILTER, (details, callback) => {
            try {
                rememberPpxkSessionFromRequestUrl(details?.url ?? '', {
                    partitionKey: options.partitionKey,
                    electronSession: sessionObject
                });
            }
            catch {
                // Never block Magix traffic on parse errors.
            }
            try {
                callback({});
            }
            catch {
                // Some Electron builds invoke without requiring a response.
            }
        });
        ppxkWebRequestAttachedSessions.add(sessionObject);
        return true;
    }
    catch {
        return false;
    }
}
/** Prefer webContents.session (same partition as background BrowserWindow). */
function ensurePpxkSessionWebRequestCapture(webContents, options = {}) {
    return attachPpxkSessionWebRequestCapture(webContents?.session ?? null, options);
}
function resolvePpxkSessionPartitionKey(partitionOrKey) {
    const value = String(partitionOrKey ?? '').trim();
    return value || undefined;
}
function buildPpxkRequestId(now = Date.now()) {
    return `mx_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
function buildPpxkApiUrl(apiName, session, param, options = {}) {
    const origin = options.origin ?? PPXK_ORIGIN_FOR_PAGE;
    const safeName = apiName.replace(/\.json$/i, '').replace(/[^\w.-]/g, '');
    const url = new URL(`${PPXK_BASE_PATH_FOR_PAGE}/${safeName}.json`, origin);
    const timeStr = options.timeStr ?? session.timeStr ?? String(Date.now());
    url.searchParams.set('r', options.r ?? buildPpxkRequestId());
    url.searchParams.set('param', JSON.stringify(param ?? {}));
    url.searchParams.set('timeStr', timeStr);
    url.searchParams.set('dynamicToken', session.dynamicToken);
    url.searchParams.set('csrfID', session.csrfID);
    url.searchParams.set('version', options.version ?? exports.PPXK_DEFAULT_VERSION);
    return url.toString();
}
function withMarketingSolutionId(param, marketingSolutionId = exports.HOSTED_GIFT_PHASE1_MARKETING_SOLUTION_ID) {
    return {
        marketingSolutionId,
        ...param
    };
}
/** Magix apply.js strips these client-only fields before POST. */
exports.SIGN_ITEM_CLIENT_STRIP_KEYS = [
    'ratioStrategy',
    'isMultiSignTyro',
    'isMultiSignOld'
];
function stripSignItemClientFields(value) {
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
        if (exports.SIGN_ITEM_CLIENT_STRIP_KEYS.includes(key))
            continue;
        if (entry === undefined)
            continue;
        next[key] = entry;
    }
    return next;
}
function missingSkuSettleIds(skuParam) {
    return skuParam.filter((row) => !String(row.settleId ?? '').trim()).map((row) => row.skuId);
}
/**
 * Confirmed Magix signItemParam (one item). SKU mode requires every skuParam[].settleId.
 */
function buildSignItemParam(input) {
    const signItemParam = {
        itemId: input.itemId
    };
    if (input.rateMode === 'item') {
        if (!String(input.settleId ?? '').trim()) {
            throw new HostedGiftPpxkError('单品费率缺少 settleId', 'invalid-response');
        }
        signItemParam.settleId = input.settleId;
        signItemParam.needQuerySku = input.needQuerySku ?? false;
    }
    else {
        const skuParam = (input.skuParam ?? []).map((row) => {
            const entry = {
                skuId: row.skuId,
                settleId: row.settleId,
                benefitType: row.benefitType && String(row.benefitType).trim()
                    ? String(row.benefitType)
                    : 'ratio'
            };
            return entry;
        });
        const missing = missingSkuSettleIds(skuParam);
        if (!skuParam.length || missing.length) {
            throw new HostedGiftPpxkError(missing.length
                ? `SKU费率缺少 settleId: ${missing.join(',')}`
                : 'SKU费率缺少 skuParam', 'invalid-response');
        }
        signItemParam.skuParam = skuParam;
        signItemParam.needQuerySku = input.needQuerySku ?? true;
    }
    if (input.subMarketingSolutionIds !== undefined) {
        signItemParam.subMarketingSolutionIds = input.subMarketingSolutionIds;
    }
    if (input.benefitType !== undefined && input.benefitType !== null && input.benefitType !== '') {
        signItemParam.benefitType = input.benefitType;
    }
    // activityId / recordId: flow-acceleration only; include when the selectable row provided them.
    if (input.activityId !== undefined && input.activityId !== null && input.activityId !== '') {
        signItemParam.activityId = input.activityId;
    }
    if (input.recordId !== undefined && input.recordId !== null && input.recordId !== '') {
        signItemParam.recordId = input.recordId;
    }
    if (input.extraMap && typeof input.extraMap === 'object') {
        const recSrc = input.extraMap.recSrc;
        if (recSrc !== undefined)
            signItemParam.extraMap = { recSrc };
    }
    return stripSignItemClientFields(signItemParam);
}
/** One-item POST body: { marketingSolutionId, signItemParam, asyncMultiSignMarketingSolutionId? }.
 * Magix strips isMultiSignOld from signItemParam — pass co-sign id at top level only.
 */
function buildSignItemsPostBody(input) {
    const body = {
        marketingSolutionId: input.marketingSolutionId ?? exports.HOSTED_GIFT_PHASE1_MARKETING_SOLUTION_ID,
        signItemParam: buildSignItemParam(input)
    };
    const asyncId = typeof input.asyncMultiSignMarketingSolutionId === 'string'
        ? input.asyncMultiSignMarketingSolutionId.trim()
        : '';
    if (asyncId) {
        body.asyncMultiSignMarketingSolutionId = asyncId;
    }
    return body;
}
/** Convenience: 单品费率, one POST body per item ( Magix enroll loops these ). */
function buildSignItemsParamItemRate(input) {
    return input.itemIds.map((itemId) => buildSignItemsPostBody({
        itemId,
        settleId: input.settleIdsByItemId[itemId],
        rateMode: 'item',
        marketingSolutionId: input.marketingSolutionId,
        benefitType: input.benefitType,
        subMarketingSolutionIds: input.subMarketingSolutionIds,
        extraMap: input.extraMap
    }));
}
/** Convenience: SKU费率, one POST body per item. Every skuParam.settleId must be set. */
function buildSignItemsParamSkuRate(input) {
    return buildSignItemsPostBody({
        itemId: input.itemId,
        rateMode: 'sku',
        skuParam: input.skuParam,
        marketingSolutionId: input.marketingSolutionId,
        benefitType: input.benefitType,
        subMarketingSolutionIds: input.subMarketingSolutionIds,
        extraMap: input.extraMap
    });
}
function buildCancelSignedItemsParam(input) {
    return {
        marketingSolutionId: input.marketingSolutionId ?? exports.HOSTED_GIFT_PHASE1_MARKETING_SOLUTION_ID,
        pmItemSignList: input.pmItemSignList.map((row) => ({
            pmId: row.pmId,
            itemId: row.itemId
        }))
    };
}
/**
 * Live Magix apply.js getList() body for querySelectItemList.
 * Uses `page` (not pageNo), options:["signRecommend"], filterSolutionIds, etc.
 * Product-ID search: itemIds as comma-separated string (Magix: l.join(",")).
 */
function buildQuerySelectItemListParam(input = {}) {
    const marketingSolutionId = input.marketingSolutionId ?? exports.HOSTED_GIFT_PHASE1_MARKETING_SOLUTION_ID;
    const page = input.page ?? input.pageNo ?? 1;
    const itemIdsText = input.itemIds?.length ? normalizeItemIds(input.itemIds).join(',') : '';
    const param = {
        levels: '',
        itemIds: itemIdsText,
        itemTitle: '',
        subsidyItemLabels: '',
        pocketMoneyTagSet: '',
        pageSize: input.pageSize ?? 20,
        page,
        marketingSolutionId,
        options: ['signRecommend'],
        needQuerySku: input.needQuerySku ?? false,
        filterSolutionIds: [marketingSolutionId],
        withSubsidyItemLabels: true
    };
    // Magix clears needCompleteItemTagCodes to undefined when empty — omit the key.
    if (input.includeSortList !== false) {
        param.sortList = [{ sortKey: 'weight_xx', sortValue: 'desc' }];
    }
    return param;
}
function buildQuerySelectSkuListParam(input) {
    // Magix apply.js getSkuList: { marketingSolutionId, itemIds, orderBySinglePromotionPrice, itemRatioParamList }
    const itemId = String(input.itemId ?? '').trim();
    const activityId = input.activityId == null || input.activityId === ''
        ? undefined
        : String(input.activityId);
    const param = {
        itemIds: itemId,
        orderBySinglePromotionPrice: 'desc',
        itemRatioParamList: itemId
            ? [{ itemId, ...(activityId ? { activityId } : {}) }]
            : []
    };
    return withMarketingSolutionId(param, input.marketingSolutionId);
}
/**
 * Live Magix item-list.js defaults for querySignedItemList (page, not pageNo).
 */
function buildQuerySignedItemListParam(input = {}) {
    const marketingSolutionId = input.marketingSolutionId ?? exports.HOSTED_GIFT_PHASE1_MARKETING_SOLUTION_ID;
    const page = input.page ?? input.pageNo ?? 1;
    const itemIdsText = input.itemIds?.length ? normalizeItemIds(input.itemIds).join(',') : '';
    return {
        status: input.status ?? '',
        levels: '',
        itemIds: itemIdsText,
        itemTitle: '',
        subsidyItemLabels: '',
        itemRate: '',
        pageSize: input.pageSize ?? 10,
        page,
        marketingSolutionId,
        options: ['signRecommend']
    };
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function textValue(value) {
    if (typeof value === 'string')
        return value.trim();
    // Magix often returns itemId/pmId/settleId as numbers.
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    if (typeof value === 'bigint')
        return String(value);
    return '';
}
function numberValue(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
        return Number(value);
    return null;
}
function getPpxkPlatformMessage(value) {
    if (!isRecord(value))
        return '';
    const data = isRecord(value.data) ? value.data : null;
    const info = isRecord(value.info) ? value.info : null;
    const error = isRecord(value.error) ? value.error : null;
    // Magix alerts use v.msg; also surface errorMessage / message.
    return textValue(value.msg)
        || textValue(value.message)
        || textValue(value.errorMessage)
        || textValue(value.errorMsg)
        || textValue(error?.message)
        || textValue(error?.msg)
        || textValue(info?.msg)
        || textValue(info?.message)
        || textValue(data?.msg)
        || textValue(data?.message)
        || textValue(data?.errorMessage)
        || textValue(data?.errorMsg)
        || '';
}
function getPpxkPlatformCode(value) {
    if (!isRecord(value))
        return '';
    const records = [value, value.error, value.info, value.data].filter(isRecord);
    for (const record of records) {
        for (const key of ['code', 'errorCode', 'retCode']) {
            const code = record[key];
            if (typeof code === 'string' && code.trim())
                return code;
            if (typeof code === 'number' && Number.isFinite(code))
                return String(code);
        }
    }
    return '';
}
function isPpxkPlatformFailure(value) {
    if (!isRecord(value))
        return false;
    if (value.success === false || value.ok === false)
        return true;
    const info = isRecord(value.info) ? value.info : null;
    if (info?.ok === false || info?.success === false)
        return true;
    if (isRecord(value.error) && (getPpxkPlatformMessage(value) || getPpxkPlatformCode(value.error)))
        return true;
    const code = getPpxkPlatformCode(value);
    if (code && !['0', '00000', '200', 'OK', 'SUCCESS'].includes(code.toUpperCase())) {
        // Many Magix APIs use numeric/string success codes; treat explicit fail codes only.
        if (/fail|error|deny|login|unauth|forbid|invalid/i.test(code))
            return true;
    }
    return false;
}
/**
 * Magix apply.js: even when the outer request succeeds, inspect
 * data.signSubItemResultDTOList[0].signResult / errorMsg.
 */
function parseSignItemsResult(payload, fallbackItemId) {
    const root = isRecord(payload) ? payload : null;
    const data = root && isRecord(root.data) ? root.data : root;
    const fallback = String(fallbackItemId ?? '');
    if (!data) {
        return {
            ok: !isPpxkPlatformFailure(payload),
            message: getPpxkPlatformMessage(payload) || (isPpxkPlatformFailure(payload) ? '报名失败' : '报名成功'),
            itemId: fallback
        };
    }
    const list = Array.isArray(data.signSubItemResultDTOList) ? data.signSubItemResultDTOList : [];
    if (list.length) {
        const first = isRecord(list[0]) ? list[0] : null;
        if (first) {
            const signResult = first.signResult === true || first.signResult === 'true' || first.signResult === 1;
            const itemId = textValue(first.itemId) || textValue(data.itemId) || fallback;
            if (!signResult) {
                return {
                    ok: false,
                    itemId,
                    message: textValue(first.errorMsg)
                        || textValue(first.msg)
                        || textValue(first.message)
                        || getPpxkPlatformMessage(payload)
                        || '报名失败'
                };
            }
            return {
                ok: true,
                itemId,
                message: textValue(first.errorMsg) || getPpxkPlatformMessage(payload) || '报名成功'
            };
        }
    }
    if (isPpxkPlatformFailure(payload)) {
        return {
            ok: false,
            itemId: textValue(data.itemId) || fallback,
            message: getPpxkPlatformMessage(payload) || '报名失败'
        };
    }
    return {
        ok: true,
        itemId: textValue(data.itemId) || fallback,
        message: getPpxkPlatformMessage(payload) || '报名成功'
    };
}
function parseJsonResponse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
/** Item-level business rejection is also an operation failure, even with HTTP 200. */
function describeSignItemsResult(payload, itemId) {
    const result = parseSignItemsResult(payload, itemId);
    const root = isRecord(payload) ? payload : null;
    const data = root && isRecord(root.data) ? root.data : root;
    const row = Array.isArray(data?.signSubItemResultDTOList) ? data.signSubItemResultDTOList[0] : null;
    return {
        ...result,
        message: result.ok ? (0, hosted_gift_errors_1.sanitizeHostedGiftErrorText)(result.message) : (0, hosted_gift_errors_1.formatHostedGiftFailure)(result.message, {
            apiName: 'signItems',
            platformCode: getPpxkPlatformCode(row) || getPpxkPlatformCode(payload)
        })
    };
}
function collectRecordArrays(value, depth = 0) {
    if (depth > 8 || value == null)
        return [];
    if (Array.isArray(value)) {
        return value.flatMap((row) => (isRecord(row) ? [row] : collectRecordArrays(row, depth + 1)));
    }
    if (!isRecord(value))
        return [];
    const preferredKeys = [
        'list', 'itemList', 'items', 'resultList', 'dataList', 'signedItemList',
        'selectItemList', 'skuList', 'skuParam', 'pmItemSignList', 'rows', 'records', 'data'
    ];
    for (const key of preferredKeys) {
        if (key in value) {
            const nested = collectRecordArrays(value[key], depth + 1);
            if (nested.length)
                return nested;
        }
    }
    return [];
}
function pickItemId(row) {
    return textValue(row.itemId)
        || textValue(row.item_id)
        || textValue(row.numIid)
        || textValue(row.num_iid);
}
function pickPmId(row) {
    return textValue(row.pmId)
        || textValue(row.pm_id)
        || textValue(row.signId)
        || textValue(row.signRecordId)
        || null;
}
function pickSkuId(row) {
    // Magix skuDtoList uses skuId. Do NOT fall back to generic `id` — item/ratio rows also have id.
    return textValue(row.skuId) || textValue(row.sku_id);
}
function pickTitle(row) {
    return textValue(row.title)
        || textValue(row.itemTitle)
        || textValue(row.itemName)
        || textValue(row.name)
        || null;
}
function parseSettleOptions(row) {
    const buckets = [
        row.skuRatios,
        row.settleList,
        row.settleOptions,
        row.ratioList,
        row.rateList,
        row.feeList,
        row.itemSettleList
    ];
    const options = [];
    for (const bucket of buckets) {
        if (!Array.isArray(bucket))
            continue;
        for (const entry of bucket) {
            if (!isRecord(entry))
                continue;
            const settleId = textValue(entry.settleId)
                || textValue(entry.selectedRation)
                || textValue(entry.settle_id)
                || textValue(entry.id)
                || textValue(entry.ratioId);
            if (!settleId)
                continue;
            const ratePercent = numberValue(entry.ratePercent)
                ?? numberValue(entry.ratio)
                ?? numberValue(entry.rate)
                ?? numberValue(entry.feeRate)
                ?? numberValue(entry.percent)
                ?? (() => {
                    const desc = textValue(entry.settleDesc) || textValue(entry.text) || textValue(entry.label);
                    const m = desc.match(/(\d+(?:\.\d+)?)\s*%/);
                    return m ? Number(m[1]) : null;
                })();
            options.push({
                settleId,
                ratePercent,
                label: textValue(entry.label) || textValue(entry.name) || null
            });
        }
    }
    // Some rows expose a single settleId + ratio at the top level.
    const singleSettleId = textValue(row.settleId) || textValue(row.selectedRation) || textValue(row.settle_id);
    if (singleSettleId && !options.some((option) => option.settleId === singleSettleId)) {
        options.push({
            settleId: singleSettleId,
            ratePercent: numberValue(row.ratePercent) ?? numberValue(row.ratio) ?? numberValue(row.rate),
            label: null
        });
    }
    return options;
}
function parseSelectableItems(payload) {
    const rows = collectRecordArrays(payload);
    const items = [];
    const seen = new Set();
    for (const row of rows) {
        const itemId = pickItemId(row);
        if (!itemId || seen.has(itemId))
            continue;
        // Skip obvious SKU-only rows when skuId present without item context lists.
        if (pickSkuId(row) && !textValue(row.itemId) && !textValue(row.numIid))
            continue;
        seen.add(itemId);
        const extraMap = isRecord(row.extraMap) ? row.extraMap : null;
        items.push({
            itemId,
            title: pickTitle(row),
            settleOptions: parseSettleOptions(row),
            benefitType: textValue(row.benefitType) || null,
            subMarketingSolutionIds: row.subMarketingSolutionIds,
            needQuerySku: row.needQuerySku === true || row.needQuerySku === 'true',
            extraMap: extraMap && extraMap.recSrc !== undefined ? { recSrc: extraMap.recSrc } : undefined,
            activityId: textValue(row.activityId) || null,
            recordId: textValue(row.recordId) || null
        });
    }
    return items;
}
function parseSelectSkuList(payload, itemId) {
    const skus = [];
    const seen = new Set();
    const pushRow = (row, fallbackItemId) => {
        const skuId = pickSkuId(row);
        if (!skuId || seen.has(skuId))
            return;
        seen.add(skuId);
        skus.push({
            skuId,
            itemId: pickItemId(row) || fallbackItemId,
            title: pickTitle(row) || textValue(row.skuName) || textValue(row.skuTitle) || null,
            settleOptions: parseSettleOptions(row),
            benefitType: textValue(row.benefitType) || null
        });
    };
    // Magix apply.js: data.list[0].skuDtoList (not a flat skuList)
    const root = isRecord(payload) ? payload : null;
    const data = root && isRecord(root.data) ? root.data : root;
    const list = data && Array.isArray(data.list)
        ? data.list
        : data && Array.isArray(data.resultList)
            ? data.resultList
            : [];
    for (const entry of list) {
        if (!isRecord(entry))
            continue;
        const dto = entry.skuDtoList;
        if (Array.isArray(dto) && dto.length) {
            const parentItemId = pickItemId(entry) || itemId;
            for (const row of dto) {
                if (isRecord(row))
                    pushRow(row, parentItemId);
            }
        }
    }
    if (skus.length)
        return skus;
    // Fallback: older/flat shapes
    const rows = collectRecordArrays(payload);
    for (const row of rows)
        pushRow(row, itemId);
    return skus;
}
function parseSignedItems(payload) {
    const rows = collectRecordArrays(payload);
    const items = [];
    const seen = new Set();
    for (const row of rows) {
        const itemId = pickItemId(row);
        if (!itemId || seen.has(itemId))
            continue;
        seen.add(itemId);
        const ratioType = textValue(row.ratioType).toLowerCase();
        const rateMode = ratioType === 'sku'
            ? 'sku'
            : ratioType === 'item' || ratioType === 'single'
                ? 'item'
                : null;
        items.push({
            itemId,
            pmId: pickPmId(row),
            title: pickTitle(row),
            rateMode,
            ratePercent: numberValue(row.ratePercent) ?? numberValue(row.ratio) ?? numberValue(row.rate),
            status: textValue(row.status) || textValue(row.signStatus) || null
        });
    }
    return items;
}
/** Resolve settleId for a percent from selectable settle options (exact match preferred). */
function resolveSettleIdForPercent(options, ratePercent) {
    const exact = options.find((option) => option.ratePercent === ratePercent);
    if (exact)
        return exact.settleId;
    const near = options.find((option) => option.ratePercent != null
        && Math.abs(option.ratePercent - ratePercent) < 0.01);
    return near?.settleId ?? null;
}
/**
 * Magix 超级新品加速: settleId is rate percent in basis-points style.
 * Live-proven: 15% → "1500", 25% signed rows show pmCost 2500.
 */
function settleIdFromRatePercent(ratePercent) {
    return String(Math.round(ratePercent * 100));
}
/** Prefer list-provided settleId; otherwise derive from percent. */
function resolveSettleId(options, ratePercent) {
    if (ratePercent == null || !Number.isFinite(ratePercent))
        return null;
    return resolveSettleIdForPercent(options, ratePercent) || settleIdFromRatePercent(ratePercent);
}
function normalizeItemIds(values) {
    if (!Array.isArray(values))
        return [];
    const ids = [];
    const seen = new Set();
    for (const value of values) {
        const id = String(value ?? '').trim();
        if (!/^\d{5,20}$/.test(id) || seen.has(id))
            continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}
function normalizeRatePercent(value) {
    const number = numberValue(value);
    if (number == null || number <= 0 || number > 100)
        return null;
    return number;
}
// ---------------------------------------------------------------------------
// WebContents session + request
// ---------------------------------------------------------------------------
async function readPpxkPageSessionContext(webContents) {
    ensurePpxkSessionWebRequestCapture(webContents);
    const cached = getCachedPpxkSessionContext({
        electronSession: webContents.session
    });
    if (cached)
        return cached;
    const values = await webContents.executeJavaScript(`(() => {
    const values = [];
    const append = (value) => {
      if (typeof value !== 'string' || !value || value.length > 12000 || values.length >= 800) return;
      values.push(value);
    };
    const appendStorage = (storage) => {
      try {
        for (let index = 0; index < storage.length && values.length < 300; index += 1) {
          const key = storage.key(index) || '';
          const value = storage.getItem(key) || '';
          if (/csrf|dynamicToken|seedToken|ppxk/i.test(key + value)) append(key + '=' + value);
        }
      } catch {}
    };
    const scrapeWindow = (win) => {
      if (!win) return;
      try {
        appendStorage(win.localStorage);
        appendStorage(win.sessionStorage);
      } catch {}
      try { append(win.location && win.location.href); } catch {}
      try {
        const doc = win.document;
        if (doc) {
          doc.querySelectorAll('script[src]').forEach((script) => append(script.src));
        }
      } catch {}
      try {
        const resources = win.performance.getEntriesByType('resource').map((entry) => entry.name);
        resources.filter((name) => /ppxk\.taobao\.com\/new\/api/i.test(name)).forEach(append);
        resources.forEach(append);
      } catch {}
      // Magix often runs inside same-origin iframes — walk them (cross-origin silently skipped).
      try {
        const doc = win.document;
        if (!doc) return;
        const frames = doc.querySelectorAll('iframe');
        for (let i = 0; i < frames.length && values.length < 800; i += 1) {
          try {
            const child = frames[i].contentWindow;
            if (!child) continue;
            // Touch href to prove same-origin before recursing.
            void child.location.href;
            scrapeWindow(child);
          } catch {}
        }
      } catch {}
    };
    scrapeWindow(window);
    return values;
  })()`).catch(() => []);
    const scraped = Array.isArray(values)
        ? findPpxkSessionContextFromValues(values.filter((value) => typeof value === 'string'))
        : null;
    if (scraped) {
        rememberPpxkSessionFromRequestUrl(`https://ppxk.taobao.com/new/api/queryComponentList.json?csrfID=${encodeURIComponent(scraped.csrfID)}&dynamicToken=${encodeURIComponent(scraped.dynamicToken)}`, { electronSession: webContents.session });
    }
    return scraped;
}
/**
 * Click/activate「超级新品加速」so Magix boots and fires /new/api/*.json with tokens.
 * Safe no-op when the tab is missing (still loading) or already active.
 */
async function activateHostedGiftPhase1Tab(webContents) {
    const label = exports.HOSTED_GIFT_PHASE1_TAB_LABEL;
    const result = await webContents.executeJavaScript(`(() => {
    const label = ${JSON.stringify(label)};
    const matchText = (node) => {
      const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      return text === label || text.startsWith(label);
    };
    const roots = [document];
    try {
      document.querySelectorAll('iframe').forEach((frame) => {
        try {
          const doc = frame.contentDocument;
          if (doc) roots.push(doc);
        } catch {}
      });
    } catch {}
    const clickable = [];
    for (const root of roots) {
      try {
        clickable.push(...root.querySelectorAll('div,span,a,li,button,[role="tab"],[class*="tab"]'));
      } catch {}
    }
    const matched = clickable
      .filter((node) => {
        if (!matchText(node)) return false;
        const rect = node.getBoundingClientRect?.();
        if (rect && (rect.width < 2 || rect.height < 2)) return false;
        return true;
      })
      .sort((a, b) => {
        const ta = (a.innerText || '').trim().length;
        const tb = (b.innerText || '').trim().length;
        return ta - tb;
      });
    const target = matched[0];
    if (!target) return false;
    try {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      if (typeof target.click === 'function') target.click();
      return true;
    } catch {
      return false;
    }
  })()`).catch(() => false);
    return Boolean(result);
}
/** Diagnostics when Phase1 tab activation fails (URL / iframe / ppxk resource presence). */
async function diagnoseHostedGiftPhase1Page(webContents) {
    const pageUrl = (() => {
        try {
            return webContents.getURL?.() ?? '';
        }
        catch {
            return '';
        }
    })();
    const diag = await webContents.executeJavaScript(`(() => {
    let iframeCount = 0;
    let ppxkResourceSeen = false;
    const visit = (win) => {
      if (!win) return;
      try {
        const resources = win.performance.getEntriesByType('resource').map((e) => e.name);
        if (resources.some((name) => /ppxk\.taobao\.com\/new\/api/i.test(name))) {
          ppxkResourceSeen = true;
        }
      } catch {}
      try {
        const frames = win.document ? win.document.querySelectorAll('iframe') : [];
        iframeCount += frames.length || 0;
        for (let i = 0; i < frames.length; i += 1) {
          try {
            const child = frames[i].contentWindow;
            if (!child) continue;
            void child.location.href;
            visit(child);
          } catch {}
        }
      } catch {}
    };
    visit(window);
    return {
      url: location.href || '',
      iframeCount,
      ppxkResourceSeen
    };
  })()`).catch(() => ({ url: pageUrl, iframeCount: 0, ppxkResourceSeen: false }));
    return {
        activated: false,
        url: String(diag?.url || pageUrl || ''),
        iframeCount: Number(diag?.iframeCount || 0),
        ppxkResourceSeen: Boolean(diag?.ppxkResourceSeen)
    };
}
async function waitForPpxkPageSessionContext(webContents, options = {}) {
    ensurePpxkSessionWebRequestCapture(webContents, { partitionKey: options.partitionKey });
    const maxAttempts = Math.max(1, options.maxAttempts ?? exports.PPXK_SESSION_WAIT_MAX_ATTEMPTS);
    const waitMs = options.waitMs ?? exports.PPXK_SESSION_WAIT_MS;
    const activatePhase1Tab = options.activatePhase1Tab !== false;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const cached = getCachedPpxkSessionContext({
            partitionKey: options.partitionKey,
            electronSession: webContents.session
        });
        if (cached)
            return cached;
        // Periodically nudge Magix tab so background WC fires token-bearing XHRs
        // (webRequest captures them even when top-level performance is empty).
        if (activatePhase1Tab && (attempt === 0 || attempt % 4 === 0)) {
            const activated = await activateHostedGiftPhase1Tab(webContents);
            if (!activated) {
                const diag = await diagnoseHostedGiftPhase1Page(webContents);
                console.warn('[hosted-gift-ppxk] activateHostedGiftPhase1Tab failed', {
                    activated,
                    url: diag.url,
                    iframeCount: diag.iframeCount,
                    ppxkResourceSeen: diag.ppxkResourceSeen,
                    webRequestSeen: hasSeenPpxkWebRequestTokens(),
                    attempt
                });
            }
        }
        const context = await readPpxkPageSessionContext(webContents);
        if (context)
            return context;
        if (attempt < maxAttempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }
    return getCachedPpxkSessionContext({
        partitionKey: options.partitionKey,
        electronSession: webContents.session
    });
}
async function ensureHostedGiftPlatformPage(webContents, options = {}) {
    if (webContents.isDestroyed?.()) {
        throw new HostedGiftPpxkError('店铺浏览器不可用', 'session-unready');
    }
    // Attach before any Magix traffic so csrfID/dynamicToken are cached from the partition.
    ensurePpxkSessionWebRequestCapture(webContents, { partitionKey: options.partitionKey });
    const current = webContents.getURL?.() ?? '';
    if (isPpxkLoginUrl(current)) {
        throw hostedGiftLoginRequiredError('page-redirect', { location: describePpxkUrlLocation(current) });
    }
    const settleMs = options.settleMs ?? 1200;
    if (!options.forceReload && isHostedGiftPlatformUrl(current)) {
        const activated = await activateHostedGiftPhase1Tab(webContents);
        if (!activated) {
            const diag = await diagnoseHostedGiftPhase1Page(webContents);
            console.warn('[hosted-gift-ppxk] activateHostedGiftPhase1Tab failed (ensure existing page)', {
                activated,
                url: diag.url,
                iframeCount: diag.iframeCount,
                ppxkResourceSeen: diag.ppxkResourceSeen,
                webRequestSeen: hasSeenPpxkWebRequestTokens()
            });
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
        return;
    }
    await webContents.loadURL(exports.HOSTED_GIFT_PLATFORM_URL);
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    const after = webContents.getURL?.() ?? '';
    if (isPpxkLoginUrl(after)) {
        throw hostedGiftLoginRequiredError('page-redirect', { location: describePpxkUrlLocation(after) });
    }
    const activated = await activateHostedGiftPhase1Tab(webContents);
    if (!activated) {
        const diag = await diagnoseHostedGiftPhase1Page(webContents);
        console.warn('[hosted-gift-ppxk] activateHostedGiftPhase1Tab failed (ensure after load)', {
            activated,
            url: diag.url,
            iframeCount: diag.iframeCount,
            ppxkResourceSeen: diag.ppxkResourceSeen,
            webRequestSeen: hasSeenPpxkWebRequestTokens()
        });
    }
}
function writeHostedGiftLastMagixDebug(info) {
    try {
        const parsedObj = info.parsed && typeof info.parsed === 'object' ? info.parsed : null;
        const payload = {
            at: new Date().toISOString(),
            apiName: sanitizePpxkDiagnosticText(info.apiName),
            method: info.method,
            httpOk: info.httpOk,
            httpStatus: info.httpStatus,
            success: typeof parsedObj?.success === 'boolean' ? parsedObj.success : undefined,
            code: sanitizePpxkDiagnosticText(getPpxkPlatformCode(info.parsed)),
            platformMessage: sanitizePpxkDiagnosticText(info.platformMessage)
        };
        recordHostedGiftDiagnostic('magix', {
            api: info.apiName,
            http: info.httpStatus,
            success: payload.success,
            code: payload.code,
            msg: info.platformMessage
        });
        // Local only, under the client's userData (configured from main); unset in unit tests.
        const dir = hostedGiftDebugDir;
        if (!dir)
            return;
        (0, node_fs_1.mkdirSync)(dir, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(dir, 'hosted-gift-last-magix.json'), JSON.stringify(payload, null, 2), 'utf8');
        const safeName = String(info.apiName || 'unknown').replace(/[^a-zA-Z0-9_-]+/g, '_');
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(dir, `hosted-gift-last-magix-${safeName}.json`), JSON.stringify(payload, null, 2), 'utf8');
    }
    catch {
        // debug only — never break live Magix flow
    }
}
async function requestPpxkJson(webContents, apiName, options = {}) {
    const method = options.method ?? 'GET';
    const param = options.param ?? {};
    // Always prefer the latest webRequest-captured Magix token over a stale withSession snapshot.
    ensurePpxkSessionWebRequestCapture(webContents);
    const freshSession = resolveLatestPpxkSession(options.session ?? null, {
        electronSession: webContents.session
    });
    const cachedSession = freshSession;
    const version = options.version ?? exports.PPXK_DEFAULT_VERSION;
    const boundTimeStr = options.timeStr ?? cachedSession?.timeStr ?? null;
    const injectFn = (fn) => fn
        .toString()
        .replace(/\bexports\.PPXK_API_ORIGIN\b/g, JSON.stringify(exports.PPXK_API_ORIGIN))
        .replace(/\bexports\.PPXK_API_BASE_PATH\b/g, JSON.stringify(exports.PPXK_API_BASE_PATH))
        .replace(/\bexports\.PPXK_DEFAULT_VERSION\b/g, JSON.stringify(exports.PPXK_DEFAULT_VERSION))
        .replace(/\bPPXK_ORIGIN_FOR_PAGE\b/g, JSON.stringify(PPXK_ORIGIN_FOR_PAGE))
        .replace(/\bPPXK_BASE_PATH_FOR_PAGE\b/g, JSON.stringify(PPXK_BASE_PATH_FOR_PAGE))
        .replace(/\bPPXK_VERSION_FOR_PAGE\b/g, JSON.stringify(PPXK_VERSION_FOR_PAGE));
    const script = `(async () => {
    const findSession = ${injectFn(findPpxkSessionContextFromValues)};
    const buildUrl = ${injectFn(buildPpxkApiUrl)};
    const buildPpxkRequestId = ${injectFn(buildPpxkRequestId)};
    const PPXK_API_ORIGIN = ${JSON.stringify(exports.PPXK_API_ORIGIN)};
    const PPXK_API_BASE_PATH = ${JSON.stringify(exports.PPXK_API_BASE_PATH)};
    const PPXK_DEFAULT_VERSION = ${JSON.stringify(exports.PPXK_DEFAULT_VERSION)};
    const resourceUrls = performance.getEntriesByType('resource').map((entry) => entry.name);
    const storageValues = [];
    const appendStorage = (storage) => {
      try {
        for (let i = 0; i < storage.length && storageValues.length < 100; i++) {
          const key = storage.key(i) || '';
          const value = storage.getItem(key) || '';
          if (/csrf|dynamicToken|seedToken|ppxk/i.test(key + value)) storageValues.push(key + '=' + value);
        }
      } catch {}
    };
    appendStorage(localStorage);
    appendStorage(sessionStorage);
    // Prefer injected latest webRequest session; page scrape is fallback only.
    const session = ${JSON.stringify(cachedSession)} || findSession([...resourceUrls, ...storageValues, location.href]);
    if (!session) {
      return { ok: false, status: 0, text: '', sessionContextMissing: true };
    }
    const requestUrl = buildUrl(
      ${JSON.stringify(apiName)},
      session,
      ${JSON.stringify(param)},
      {
        version: ${JSON.stringify(version)},
        // Keep timeStr paired with captured dynamicToken when available.
        timeStr: ${JSON.stringify(boundTimeStr)} || session.timeStr || String(Date.now()),
        r: ${JSON.stringify(options.r ?? null)} || buildPpxkRequestId(),
        origin: location.hostname.includes('ppxk') ? location.origin : PPXK_API_ORIGIN
      }
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ${exports.PPXK_REQUEST_TIMEOUT_MS});
    try {
      const response = await fetch(requestUrl, {
        method: ${JSON.stringify(method)},
        credentials: 'include',
        signal: controller.signal,
        headers: {
          'x-requested-with': 'XMLHttpRequest',
          'accept': 'application/json, text/plain, */*',
          ${method === 'POST' ? `'content-type': 'application/json;charset=UTF-8',` : ''}
        }
        ${method === 'POST' ? `, body: JSON.stringify(${JSON.stringify(param)})` : ''}
      });
      const text = await response.text();
      return { ok: response.ok, status: response.status, text, finalUrl: response.url };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { ok: false, status: 0, text: '', requestTimedOut: true };
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })()`;
    const result = await webContents.executeJavaScript(script).catch((error) => {
        throw new HostedGiftPpxkError(describeHostedGiftError(error), 'request-failed', { apiName });
    });
    if (result.requestTimedOut) {
        throw new HostedGiftPpxkError(`品牌新享接口请求超过 ${Math.ceil(exports.PPXK_REQUEST_TIMEOUT_MS / 1000)} 秒，请稍后重试`, 'request-failed', { apiName });
    }
    if (result.sessionContextMissing) {
        throw new HostedGiftPpxkError('品牌新享页面会话参数尚未就绪（缺少 csrfID/dynamicToken），请打开品牌新享页后重试', 'session-unready', { apiName });
    }
    const parsed = parseJsonResponse(result.text);
    // Some gateways return a short plain-text error instead of JSON. Keep that reason,
    // but never show a complete HTML page or an unrecognized response object.
    const plainText = parsed === null && result.text.length <= 1600 && !/[<>{}]/.test(result.text)
        ? result.text.trim() : '';
    const platformMessage = (0, hosted_gift_errors_1.sanitizeHostedGiftErrorText)(getPpxkPlatformMessage(parsed) || plainText);
    const detail = { apiName, httpStatus: result.status, platformCode: getPpxkPlatformCode(parsed), platformMessage };
    if (result.finalUrl && isPpxkLoginUrl(result.finalUrl)) {
        throw hostedGiftLoginRequiredError('api-redirect', {
            location: describePpxkUrlLocation(result.finalUrl),
            ...detail
        });
    }
    writeHostedGiftLastMagixDebug({
        apiName,
        method,
        httpOk: result.ok,
        httpStatus: result.status,
        parsed,
        platformMessage
    });
    if (!result.ok) {
        if (result.status === 401) {
            if (platformMessage && !isPpxkSessionExpiredMessage(platformMessage)) {
                throw new HostedGiftPpxkError(platformMessage, 'request-failed', detail);
            }
            throw hostedGiftLoginRequiredError('http-401', detail);
        }
        if (isPpxkSessionExpiredMessage(platformMessage)) {
            throw hostedGiftLoginRequiredError('platform-message', detail);
        }
        if (/csrf|token|会话/i.test(platformMessage)) {
            throw new HostedGiftPpxkError(platformMessage, 'session-unready', detail);
        }
        throw new HostedGiftPpxkError(platformMessage || `品牌新享接口返回 HTTP ${result.status}`, 'request-failed', detail);
    }
    if (parsed === null) {
        throw new HostedGiftPpxkError(platformMessage || '品牌新享接口返回了无法识别的数据', 'invalid-response', detail);
    }
    if (isPpxkPlatformFailure(parsed)) {
        if (isPpxkSessionExpiredMessage(platformMessage)) {
            throw hostedGiftLoginRequiredError('platform-message', detail);
        }
        if (/csrf|token|会话/i.test(platformMessage)) {
            throw new HostedGiftPpxkError(platformMessage, 'session-unready', detail);
        }
        throw new HostedGiftPpxkError(platformMessage || '平台未返回具体错误原因', 'request-failed', detail);
    }
    return parsed;
}
async function withSession(webContents, run) {
    ensurePpxkSessionWebRequestCapture(webContents);
    await ensureHostedGiftPlatformPage(webContents);
    // Prefer partition webRequest cache; also poll performance + same-origin iframes.
    // Background WC load alone often finishes before XHRs (~6s was too short).
    const session = await waitForPpxkPageSessionContext(webContents, {
        maxAttempts: exports.PPXK_SESSION_WAIT_MAX_ATTEMPTS,
        waitMs: exports.PPXK_SESSION_WAIT_MS,
        activatePhase1Tab: true
    });
    if (!session) {
        const url = webContents.getURL?.() ?? '';
        if (isPpxkLoginUrl(url)) {
            throw hostedGiftLoginRequiredError('page-redirect', { location: describePpxkUrlLocation(url) });
        }
        recordHostedGiftDiagnostic('session-unready', {
            location: describePpxkUrlLocation(url),
            webRequestSeen: hasSeenPpxkWebRequestTokens()
        });
        if (!hasSeenPpxkWebRequestTokens()) {
            throw new HostedGiftPpxkError('品牌新享会话参数未就绪：尚未捕获到 ppxk /new/api 请求中的 csrfID/dynamicToken。请确认店铺已登录，并打开品牌新享「超级新品加速」页后再试', 'session-unready');
        }
        throw new HostedGiftPpxkError('品牌新享页面会话参数尚未就绪（缺少 csrfID/dynamicToken）。请确认店铺已登录后打开品牌新享「超级新品加速」页再试', 'session-unready');
    }
    return run(session);
}
// ---------------------------------------------------------------------------
// Public API operations
// ---------------------------------------------------------------------------
async function listSelectableItems(webContents, request = {}) {
    return withSession(webContents, async (session) => {
        const filterIds = normalizeItemIds(request.itemIds ?? []);
        const payload = await requestPpxkJson(webContents, 'querySelectItemList', {
            method: 'GET',
            session,
            param: buildQuerySelectItemListParam({
                itemIds: filterIds.length ? filterIds : undefined,
                pageNo: request.pageNo,
                pageSize: request.pageSize ?? (filterIds.length ? Math.max(20, filterIds.length) : 20),
                marketingSolutionId: request.marketingSolutionId,
                needQuerySku: false
            })
        });
        let items = parseSelectableItems(payload);
        const filter = filterIds;
        if (filter.length) {
            const wanted = new Set(filter);
            items = items.filter((item) => wanted.has(item.itemId));
        }
        return {
            ok: true,
            items,
            message: items.length ? `已读取 ${items.length} 个可添加商品` : '未读取到可添加商品'
        };
    });
}
async function listSelectSku(webContents, itemId, marketingSolutionId = exports.HOSTED_GIFT_PHASE1_MARKETING_SOLUTION_ID) {
    return withSession(webContents, async (session) => {
        const payload = await requestPpxkJson(webContents, 'querySelectSkuList', {
            method: 'POST',
            session,
            param: buildQuerySelectSkuListParam({ itemId, marketingSolutionId })
        });
        return parseSelectSkuList(payload, itemId);
    });
}
async function listSignedItems(webContents, request = {}) {
    return withSession(webContents, async (session) => {
        const filterIds = normalizeItemIds(request.itemIds ?? []);
        const payload = await requestPpxkJson(webContents, 'querySignedItemList', {
            method: 'GET',
            session,
            param: buildQuerySignedItemListParam({
                itemIds: filterIds.length ? filterIds : undefined,
                pageNo: request.pageNo,
                pageSize: request.pageSize ?? (filterIds.length ? Math.max(10, filterIds.length) : 10),
                marketingSolutionId: request.marketingSolutionId
            })
        });
        let items = parseSignedItems(payload);
        const filter = filterIds;
        if (filter.length) {
            const wanted = new Set(filter);
            items = items.filter((item) => wanted.has(item.itemId));
        }
        return {
            ok: true,
            items,
            message: items.length ? `已读取 ${items.length} 个已报名商品` : '未读取到已报名商品'
        };
    });
}
async function signItems(webContents, request) {
    const itemIds = normalizeItemIds(request.itemIds);
    const marketingSolutionId = request.marketingSolutionId ?? exports.HOSTED_GIFT_PHASE1_MARKETING_SOLUTION_ID;
    // 新客 + 同时报名老客: Magix top-level asyncMultiSignMarketingSolutionId (not isMultiSignOld in signItemParam)
    const asyncMultiSignMarketingSolutionId = request.withLaoke
        ? (request.asyncMultiSignMarketingSolutionId || exports.HOSTED_GIFT_LAOKE_SOLUTION_ID)
        : (request.asyncMultiSignMarketingSolutionId && request.asyncMultiSignMarketingSolutionId.trim()
            ? request.asyncMultiSignMarketingSolutionId.trim()
            : undefined);
    if (!itemIds.length) {
        return { ok: false, rateMode: request.rateMode, marketingSolutionId, items: [], message: '请填写至少一个商品 ID' };
    }
    return withSession(webContents, async (session) => {
        const results = [];
        if (request.rateMode === 'item') {
            const settleIdsByItemId = { ...(request.settleIdsByItemId ?? {}) };
            const missing = itemIds.filter((id) => !settleIdsByItemId[id]);
            const selectableById = new Map();
            if (missing.length) {
                const ratePercent = normalizeRatePercent(request.itemRatePercent);
                if (ratePercent == null) {
                    return {
                        ok: false,
                        rateMode: 'item',
                        marketingSolutionId,
                        items: itemIds.map((itemId) => ({ itemId, ok: false, message: '缺少单品费率或 settleId' })),
                        message: '单品费率模式需要 itemRatePercent 或 settleIdsByItemId'
                    };
                }
                const selectablePayload = await requestPpxkJson(webContents, 'querySelectItemList', {
                    method: 'GET',
                    session,
                    param: buildQuerySelectItemListParam({
                        itemIds: missing,
                        marketingSolutionId,
                        needQuerySku: false,
                        pageSize: Math.max(20, missing.length)
                    })
                });
                for (const item of parseSelectableItems(selectablePayload)) {
                    selectableById.set(item.itemId, item);
                    const settleId = resolveSettleId(item.settleOptions, ratePercent);
                    if (settleId)
                        settleIdsByItemId[item.itemId] = settleId;
                }
                // Magix list may omit already-signed / filtered IDs — still derive settleId from percent.
                for (const itemId of missing) {
                    if (!settleIdsByItemId[itemId]) {
                        settleIdsByItemId[itemId] = settleIdFromRatePercent(ratePercent);
                    }
                }
            }
            for (const itemId of itemIds) {
                const settleId = settleIdsByItemId[itemId];
                const selectable = selectableById.get(itemId);
                if (!settleId) {
                    results.push({ itemId, ok: false, message: '无法解析单品 settleId' });
                    continue;
                }
                try {
                    const param = buildSignItemsPostBody({
                        itemId,
                        settleId,
                        rateMode: 'item',
                        marketingSolutionId,
                        asyncMultiSignMarketingSolutionId,
                        benefitType: selectable?.benefitType,
                        subMarketingSolutionIds: selectable?.subMarketingSolutionIds,
                        activityId: selectable?.activityId,
                        recordId: selectable?.recordId,
                        needQuerySku: selectable?.needQuerySku,
                        extraMap: selectable?.extraMap
                    });
                    const payload = await requestPpxkJson(webContents, 'signItems', {
                        method: 'POST',
                        session,
                        param
                    });
                    const parsed = describeSignItemsResult(payload, itemId);
                    results.push({
                        itemId,
                        ok: parsed.ok,
                        message: parsed.message
                    });
                }
                catch (error) {
                    results.push({
                        itemId,
                        ok: false,
                        message: describeHostedGiftError(error)
                    });
                }
            }
        }
        else {
            const percent = normalizeRatePercent(request.skuRatePercent ?? request.itemRatePercent);
            const provided = (request.skuRates ?? []).filter((row) => row.itemId && row.skuId);
            if (!provided.length && percent == null) {
                return {
                    ok: false,
                    rateMode: 'sku',
                    marketingSolutionId,
                    items: itemIds.map((itemId) => ({ itemId, ok: false, message: '缺少 SKU 费率' })),
                    message: 'SKU费率模式需要 skuRates 或 skuRatePercent'
                };
            }
            for (const itemId of itemIds) {
                try {
                    let skuParam = provided
                        .filter((row) => row.itemId === itemId && row.settleId)
                        .map((row) => ({ skuId: row.skuId, settleId: String(row.settleId) }));
                    if (!skuParam.length) {
                        const skuPayload = await requestPpxkJson(webContents, 'querySelectSkuList', {
                            method: 'POST',
                            session,
                            param: buildQuerySelectSkuListParam({ itemId, marketingSolutionId })
                        });
                        const skus = parseSelectSkuList(skuPayload, itemId);
                        if (!skus.length) {
                            // Magix often returns empty SKU list for items that still accept item-mode sign.
                            if (percent == null) {
                                results.push({ itemId, ok: false, message: '未查询到 SKU，且未提供费率，无法回退单品报名' });
                                continue;
                            }
                            // If Magix selectable list also omits this ID, don't call signItems (平台常回「系统繁忙」).
                            const selectablePayload = await requestPpxkJson(webContents, 'querySelectItemList', {
                                method: 'GET',
                                session,
                                param: buildQuerySelectItemListParam({
                                    itemIds: [itemId],
                                    marketingSolutionId,
                                    needQuerySku: false,
                                    pageSize: 20
                                })
                            });
                            const selectableItems = parseSelectableItems(selectablePayload);
                            if (!selectableItems.some((row) => row.itemId === itemId)) {
                                results.push({
                                    itemId,
                                    ok: false,
                                    message: '不在可报名列表（品牌新享未返回该商品），请在平台页确认是否可添加'
                                });
                                continue;
                            }
                            const settleId = resolveSettleId(selectableItems[0]?.settleOptions ?? [], percent) ||
                                settleIdFromRatePercent(percent);
                            const selectable = selectableItems[0];
                            const param = buildSignItemsPostBody({
                                itemId,
                                settleId,
                                rateMode: 'item',
                                marketingSolutionId,
                                asyncMultiSignMarketingSolutionId,
                                benefitType: selectable?.benefitType,
                                subMarketingSolutionIds: selectable?.subMarketingSolutionIds,
                                activityId: selectable?.activityId,
                                recordId: selectable?.recordId,
                                needQuerySku: selectable?.needQuerySku,
                                extraMap: selectable?.extraMap
                            });
                            const payload = await requestPpxkJson(webContents, 'signItems', {
                                method: 'POST',
                                session,
                                param
                            });
                            const parsed = describeSignItemsResult(payload, itemId);
                            results.push({
                                itemId,
                                ok: parsed.ok,
                                message: parsed.ok
                                    ? `${parsed.message}（无SKU，已按单品费率报名）`
                                    : parsed.message
                            });
                            continue;
                        }
                        if (percent == null) {
                            results.push({ itemId, ok: false, message: 'SKU 缺少 settleId 或未提供费率' });
                            continue;
                        }
                        skuParam = [];
                        const unresolved = [];
                        for (const sku of skus) {
                            const settleId = resolveSettleId(sku.settleOptions, percent);
                            if (!settleId)
                                unresolved.push(sku.skuId);
                            else {
                                skuParam.push({
                                    skuId: sku.skuId,
                                    settleId,
                                    // Magix apply.js always sends benefitType on skuParam for ratio SKU enroll.
                                    benefitType: sku.benefitType || 'ratio'
                                });
                            }
                        }
                        if (unresolved.length || !skuParam.length) {
                            const settleId = settleIdFromRatePercent(percent);
                            const param = buildSignItemsPostBody({
                                itemId,
                                settleId,
                                rateMode: 'item',
                                marketingSolutionId,
                                asyncMultiSignMarketingSolutionId
                            });
                            const payload = await requestPpxkJson(webContents, 'signItems', {
                                method: 'POST',
                                session,
                                param
                            });
                            const parsed = describeSignItemsResult(payload, itemId);
                            results.push({
                                itemId,
                                ok: parsed.ok,
                                message: parsed.ok
                                    ? `${parsed.message}（SKU费率不全，已按单品费率报名）`
                                    : parsed.message
                            });
                            continue;
                        }
                    }
                    const param = buildSignItemsPostBody({
                        itemId,
                        rateMode: 'sku',
                        skuParam,
                        marketingSolutionId,
                        asyncMultiSignMarketingSolutionId,
                    });
                    const payload = await requestPpxkJson(webContents, 'signItems', {
                        method: 'POST',
                        session,
                        param
                    });
                    const parsed = describeSignItemsResult(payload, itemId);
                    results.push({
                        itemId,
                        ok: parsed.ok,
                        message: parsed.message
                    });
                }
                catch (error) {
                    results.push({
                        itemId,
                        ok: false,
                        message: describeHostedGiftError(error)
                    });
                }
            }
        }
        const ok = results.length > 0 && results.every((row) => row.ok);
        const failed = results.filter((row) => !row.ok).length;
        return {
            ok,
            rateMode: request.rateMode,
            marketingSolutionId,
            items: results,
            message: ok
                ? `报名提交成功（${results.length} 个商品，各 1 次 signItems）`
                : `报名部分失败：成功 ${results.length - failed}，失败 ${failed}`
        };
    });
}
async function cancelSignedItems(webContents, request) {
    const itemIds = normalizeItemIds(request.itemIds);
    const marketingSolutionId = request.marketingSolutionId ?? exports.HOSTED_GIFT_PHASE1_MARKETING_SOLUTION_ID;
    if (!itemIds.length && !request.pmItemSignList?.length) {
        return { ok: false, itemIds: [], message: '请填写至少一个要退出的商品 ID' };
    }
    return withSession(webContents, async (session) => {
        let pmItemSignList = (request.pmItemSignList ?? [])
            .filter((row) => row && row.itemId && row.pmId)
            .map((row) => ({ pmId: String(row.pmId), itemId: String(row.itemId) }));
        const wanted = itemIds.length ? itemIds : pmItemSignList.map((row) => row.itemId);
        if (!pmItemSignList.length || pmItemSignList.length < wanted.length) {
            const signedPayload = await requestPpxkJson(webContents, 'querySignedItemList', {
                method: 'GET',
                session,
                param: buildQuerySignedItemListParam({ itemIds: wanted, marketingSolutionId })
            });
            const signed = parseSignedItems(signedPayload);
            const byItem = new Map(signed.filter((row) => row.pmId).map((row) => [row.itemId, row.pmId]));
            pmItemSignList = wanted
                .map((itemId) => {
                const existing = pmItemSignList.find((row) => row.itemId === itemId);
                const pmId = existing?.pmId || byItem.get(itemId);
                return pmId ? { pmId, itemId } : null;
            })
                .filter((row) => Boolean(row));
        }
        const missing = wanted.filter((id) => !pmItemSignList.some((row) => row.itemId === id));
        if (!pmItemSignList.length) {
            return { ok: false, itemIds: wanted, message: '无法解析已报名 pmId，未提交退出' };
        }
        const payload = await requestPpxkJson(webContents, 'cancelSignedItems', {
            method: 'POST',
            session,
            param: buildCancelSignedItemsParam({ pmItemSignList, marketingSolutionId })
        });
        const suffix = missing.length ? `；未匹配 pmId: ${missing.join(',')}` : '';
        return {
            ok: missing.length === 0,
            itemIds: pmItemSignList.map((row) => row.itemId),
            message: (getPpxkPlatformMessage(payload) || `已提交批量退出 ${pmItemSignList.length} 个商品`) + suffix
        };
    });
}
