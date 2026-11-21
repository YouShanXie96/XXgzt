"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TmallQualificationPublishError = exports.TMALL_QUALIFICATION_PUBLISH_URL = void 0;
exports.isTmallQualificationTargetLabel = isTmallQualificationTargetLabel;
exports.classifyTmallPackagingEvidence = classifyTmallPackagingEvidence;
exports.extractTmallPackagingValueFromFieldText = extractTmallPackagingValueFromFieldText;
exports.buildTmallQualificationPublishUrl = buildTmallQualificationPublishUrl;
exports.isTmallSubmitRequestUrl = isTmallSubmitRequestUrl;
exports.parseTmallSubmitResponse = parseTmallSubmitResponse;
exports.inspectTmallQualificationProduct = inspectTmallQualificationProduct;
exports.uploadTmallQualificationLabel = uploadTmallQualificationLabel;
exports.buildTmallQualificationSubmitResultExpression = buildSubmitResultExpression;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
exports.TMALL_QUALIFICATION_PUBLISH_URL = 'https://sell.publish.tmall.com/tmall/publish.htm?id=';
const TARGET_LABEL = '预包装标签图1';
const TARGET_MARKER = 'qualification-upload-target';
const MATERIAL_SELECTOR_PATH = '/app/crs-qn/sucai-selector-ng/';
const PROTOCOL_COMMAND_TIMEOUT_MS = 2_000;
function isTmallQualificationTargetLabel(value) {
    const targetLabel = '预包装标签图1';
    const normalized = String(value || '')
        .replace(/\s+/gu, '')
        .replace(/[：:*＊]/gu, '')
        .trim();
    if (!normalized.startsWith(targetLabel))
        return false;
    const suffix = normalized.slice(targetLabel.length);
    return suffix === '' || /^[（(][^）)]{0,80}[）)]$/u.test(suffix);
}
function classifyTmallPackagingEvidence(input) {
    if (input.qualificationFieldPresent)
        return 'qualification-required';
    const normalize = (value) => String(value || '').replace(/\s+/gu, ' ').trim();
    const selectedValues = input.selectedValues.map(normalize).filter(Boolean);
    const isPackagedValue = (value) => /^(?:包装|箱装|盒装|袋装|瓶装|罐装|桶装|杯装|听装|礼盒装)(?:$|[（(\s])/u.test(value);
    const selectedPackaged = selectedValues.some(isPackagedValue);
    const selectedBulk = selectedValues.some((value) => /^散装(?:$|[（(\s])/u.test(value));
    if (selectedPackaged !== selectedBulk)
        return selectedPackaged ? 'packaged' : 'bulk';
    if (selectedValues.length > 0)
        return 'unknown';
    // The page can render every dropdown option into nearby text. That text may
    // support a packaged result, but is never strong enough evidence to skip as bulk.
    const nearbyValues = input.nearbyValues.map(normalize).filter(Boolean);
    const nearbyPackaged = nearbyValues.some(isPackagedValue);
    const nearbyBulk = nearbyValues.some((value) => /^散装(?:$|[（(\s])/u.test(value));
    return nearbyPackaged && !nearbyBulk ? 'packaged' : 'unknown';
}
function extractTmallPackagingValueFromFieldText(value) {
    const normalized = String(value || '').replace(/\s+/gu, ' ').trim();
    const label = /(?:^|[\s*＊])包装(?:方式|类型)[：:]?\s*/u.exec(normalized);
    if (!label || label.index === undefined)
        return '';
    // Tmall inserts badges such as “重要” between the property label and the
    // selected value. They are field metadata, not part of the option value.
    const suffix = normalized
        .slice(label.index + label[0].length)
        .trim()
        .replace(/^(?:(?:重要|必填|推荐)\s*)+/u, '')
        .trim();
    const selected = /^(包装|箱装|盒装|袋装|瓶装|罐装|桶装|杯装|听装|礼盒装|散装)(?=$|\s|[（(])/u.exec(suffix)?.[1];
    if (!selected)
        return '';
    const selectedIsBulk = selected === '散装';
    const hasBulk = /(?:^|\s)散装(?=$|\s|[（(])/u.test(suffix);
    const hasPackaged = /(?:^|\s)(?:包装|箱装|盒装|袋装|瓶装|罐装|桶装|杯装|听装|礼盒装)(?=$|\s|[（(])/u.test(suffix);
    if ((selectedIsBulk && hasPackaged) || (!selectedIsBulk && hasBulk))
        return '';
    return selectedIsBulk ? '散装' : '包装';
}
class TmallQualificationPublishError extends Error {
    code;
    platformResponse;
    constructor(code, message) {
        super(code);
        this.code = code;
        this.name = 'TmallQualificationPublishError';
        this.platformResponse = {
            message: sanitizePlatformDetail(message),
            channel: 'tmall-product-publish'
        };
    }
}
exports.TmallQualificationPublishError = TmallQualificationPublishError;
function buildTmallQualificationPublishUrl(itemId) {
    const normalized = itemId.trim();
    if (!/^\d{5,32}$/u.test(normalized)) {
        throw new TmallQualificationPublishError('PRODUCT_ID_INVALID', '商品ID格式无效');
    }
    return `${exports.TMALL_QUALIFICATION_PUBLISH_URL}${encodeURIComponent(normalized)}`;
}
function isTmallSubmitRequestUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && url.hostname === 'sell.publish.tmall.com'
            && /\/(?:submit|publish)(?:\.htm)?$/iu.test(url.pathname);
    }
    catch {
        return false;
    }
}
function parseTmallSubmitResponse(body) {
    const raw = String(body || '').trim();
    const decoded = (() => {
        try {
            return decodeURIComponent(raw);
        }
        catch {
            return raw;
        }
    })();
    const combined = `${raw}\n${decoded}`;
    if (/CHK_FOOD_PRD_LICENSE_EXPIRED_INFO|生产许可证[^\n]{0,120}(?:过期|失效)|许可证已过期/iu.test(combined)) {
        return { status: 'failed', detail: '许可证已过期，未上传，已跳过当前商品' };
    }
    const messages = [];
    try {
        const parsed = JSON.parse(raw);
        const stack = [parsed];
        while (stack.length && messages.length < 80) {
            const value = stack.pop();
            if (typeof value === 'string') {
                const normalized = value.replace(/\s+/gu, ' ').trim();
                if (normalized && normalized.length <= 500)
                    messages.push(normalized);
            }
            else if (Array.isArray(value)) {
                stack.push(...value);
            }
            else if (value && typeof value === 'object') {
                stack.push(...Object.values(value));
            }
        }
    }
    catch {
        // Some Tmall responses are HTML or URL-encoded. Regex checks below cover them.
    }
    const readableMessage = messages.find((message) => /提交|保存|发布|失败|错误|过期|成功/u.test(message))
        || messages[0]
        || '';
    const explicitFailure = /["'](?:success|succeeded)["']\s*:\s*false/iu.test(raw)
        || /["'](?:errorCode|errorMsg|errorMessage)["']\s*:/iu.test(raw)
        || /提交失败|保存失败|发布失败|校验失败|必填项未填|不能为空/iu.test(combined);
    if (explicitFailure) {
        return {
            status: 'failed',
            detail: sanitizePlatformDetail(readableMessage || '天猫提交接口拒绝了本次更新')
        };
    }
    const explicitSuccess = /["'](?:success|succeeded)["']\s*:\s*true/iu.test(raw)
        || /提交成功|保存成功|编辑成功|发布成功|修改成功/iu.test(combined);
    if (explicitSuccess) {
        return {
            status: 'succeeded',
            detail: sanitizePlatformDetail(readableMessage || '天猫提交接口已确认成功')
        };
    }
    return { status: 'waiting', detail: '天猫提交接口已响应，等待页面确认结果' };
}
async function inspectTmallQualificationProduct(webContents, input, options) {
    const itemId = input.itemId.trim();
    const targetUrl = buildTmallQualificationPublishUrl(itemId);
    const requestId = (0, node_crypto_1.randomUUID)();
    const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 150);
    const readyTimeoutMs = options.readyTimeoutMs ?? 45_000;
    options.onProgress?.({ stage: 'opening-page', message: '正在后台打开商品编辑页预检包装类型' });
    const navigation = Promise.resolve(options.navigate(targetUrl));
    void navigation.catch(() => undefined);
    await waitForPublishPage(webContents, itemId, readyTimeoutMs, pollIntervalMs);
    options.onProgress?.({ stage: 'checking-page', message: '商品编辑页已加载，正在只读检查包装类型' });
    await ensurePackagingType(webContents, Math.min(8_000, readyTimeoutMs), pollIntervalMs, Math.max(1, options.domEvaluationTimeoutMs ?? 3_000));
    options.onProgress?.({ stage: 'checking-existing', message: '包装类型已确认，正在检查预包装标签图1' });
    const target = await (async () => {
        try {
            return await waitForState(webContents, buildTargetInputExpression(TARGET_MARKER), readyTimeoutMs, pollIntervalMs, 'QUALIFICATION_FILE_INPUT_NOT_FOUND', '天猫商品编辑页没有找到“预包装标签图1”的上传框');
        }
        catch (error) {
            if (error instanceof TmallQualificationPublishError)
                throw error;
            const detail = error instanceof Error ? error.message : String(error || '页面状态读取失败');
            throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', `读取“预包装标签图1”状态失败：${detail}`);
        }
    })();
    const qualificationExists = target.status === 'ready' && target.marker === 'qualification-existing';
    const qualificationRequired = target.status === 'ready' && target.marker !== 'qualification-not-required';
    if (!qualificationExists && qualificationRequired
        && (target.status !== 'ready' || target.marker !== TARGET_MARKER)) {
        throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', target.detail || '天猫商品编辑页没有找到“预包装标签图1”的上传框');
    }
    return {
        requestId,
        payload: {
            code: 200,
            channel: 'tmall-product-publish',
            itemId,
            field: TARGET_LABEL,
            qualificationExists,
            qualificationRequired,
            detail: sanitizePlatformDetail(target.detail || (qualificationExists
                ? '预包装标签图1已存在'
                : qualificationRequired
                    ? '包装商品尚未上传预包装标签图1'
                    : '当前商品类目未提供预包装标签图1，无需上传资质图'))
        }
    };
}
async function uploadTmallQualificationLabel(webContents, input, options) {
    const itemId = input.itemId.trim();
    const targetUrl = buildTmallQualificationPublishUrl(itemId);
    const requestId = (0, node_crypto_1.randomUUID)();
    const temporaryDirectory = await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'workbench-qualification-'));
    const extension = input.mediaType === 'image/png'
        ? 'png'
        : input.mediaType === 'image/webp' ? 'webp' : 'jpg';
    const imageContentHash = (0, node_crypto_1.createHash)('sha256').update(input.bytes).digest('hex').slice(0, 12);
    const imagePath = node_path_1.default.join(temporaryDirectory, `qualification-${itemId}-${imageContentHash}.${extension}`);
    const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 150);
    let activeStep;
    const stepTimings = [];
    const finishStepTimings = () => {
        if (activeStep) {
            const finishedAtMs = Date.now();
            stepTimings.push({
                stage: activeStep.stage,
                startedAt: new Date(activeStep.startedAtMs).toISOString(),
                finishedAt: new Date(finishedAtMs).toISOString(),
                durationMs: Math.max(0, finishedAtMs - activeStep.startedAtMs)
            });
            activeStep = undefined;
        }
        return stepTimings.map((timing) => ({ ...timing }));
    };
    const progress = (stage, message) => {
        if (!activeStep || activeStep.stage !== stage) {
            finishStepTimings();
            activeStep = { stage, startedAtMs: Date.now() };
        }
        options.onProgress?.({ stage, message });
    };
    try {
        await node_fs_1.promises.writeFile(imagePath, input.bytes);
        progress('opening-page', '正在后台打开商品编辑页');
        // Tmall can leave Electron's loadURL promise pending while its edit page
        // is already usable. Start navigation, then rely on the bounded main-frame
        // state check below instead of blocking the whole workflow on loadURL.
        const navigation = Promise.resolve(options.navigate(targetUrl));
        void navigation.catch(() => undefined);
        await waitForPublishPage(webContents, itemId, options.readyTimeoutMs ?? 45_000, pollIntervalMs);
        progress('checking-page', '商品编辑页已加载，正在检查包装类型和资质字段');
        await ensurePackagingType(webContents, Math.min(8_000, options.readyTimeoutMs ?? 45_000), pollIntervalMs, 3_000);
        progress('checking-existing', '正在检查预包装标签图1是否已经存在');
        const target = await waitForState(webContents, buildTargetInputExpression(TARGET_MARKER), options.readyTimeoutMs ?? 45_000, pollIntervalMs, 'QUALIFICATION_FILE_INPUT_NOT_FOUND', '天猫商品编辑页没有找到“预包装标签图1”的上传框');
        if (target.status === 'ready' && target.marker === 'qualification-existing') {
            progress('skipped', '检测到预包装标签图1已存在，已更新客户端状态');
            return {
                requestId,
                payload: {
                    code: 200,
                    channel: 'tmall-product-publish',
                    itemId,
                    field: TARGET_LABEL,
                    confirmed: true,
                    skippedExisting: true,
                    detail: sanitizePlatformDetail(target.detail || '预包装标签图1已存在，未重复上传'),
                    stepTimings: finishStepTimings()
                }
            };
        }
        if (target.status === 'ready' && target.marker === 'qualification-not-required') {
            throw new TmallQualificationPublishError('CATEGORY_NO_QUALIFICATION_REQUIRED', target.detail || '当前商品类目未提供预包装标签图1，无需上传资质图');
        }
        if (target.status !== 'ready' || target.marker !== TARGET_MARKER) {
            throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', target.detail || '天猫商品编辑页没有找到“预包装标签图1”的上传框');
        }
        progress('uploading-image', '已找到预包装标签图1，正在后台上传本地资质图');
        await setTargetFileInput(webContents, imagePath, TARGET_MARKER);
        const uploadTimeoutMs = Math.max(1, options.uploadTimeoutMs ?? 45_000);
        // Selecting a material card makes Tmall re-render this field and discard
        // our temporary DOM markers. Re-scan the exact field before waiting. If
        // the selected image is already visible, the page has acknowledged the
        // upload and there is no reason to spend another full timeout polling it.
        const selectedTarget = await waitForState(webContents, buildTargetInputExpression(TARGET_MARKER), Math.min(10_000, uploadTimeoutMs), pollIntervalMs, 'QUALIFICATION_UPLOAD_REJECTED', '天猫商品编辑页没有确认预包装标签图1已回填');
        if (!(selectedTarget.status === 'ready'
            && selectedTarget.marker === 'qualification-existing')) {
            if (selectedTarget.status !== 'ready' || selectedTarget.marker !== TARGET_MARKER) {
                throw new TmallQualificationPublishError('QUALIFICATION_UPLOAD_REJECTED', selectedTarget.detail || '天猫商品编辑页没有确认预包装标签图1已回填');
            }
            const uploadStarted = await evaluateState(webContents, buildUploadStartedExpression(TARGET_MARKER, uploadTimeoutMs));
            if (uploadStarted.status !== 'ready') {
                throw new TmallQualificationPublishError('QUALIFICATION_UPLOAD_REJECTED', uploadStarted.detail || '预包装标签图1上传状态初始化失败');
            }
            await waitForState(webContents, buildUploadStateExpression(TARGET_MARKER, uploadTimeoutMs), uploadTimeoutMs, pollIntervalMs, 'QUALIFICATION_UPLOAD_REJECTED', '预包装标签图1没有在规定时间内完成上传');
        }
        const submitObserver = await createTmallSubmitObserver(webContents);
        try {
            progress('submitting', '图片上传完成，正在提交商品发布');
            const submit = await evaluateState(webContents, buildSubmitExpression());
            if (submit.status !== 'clicked') {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_NOT_FOUND', submit.detail || '天猫商品编辑页没有找到可用的提交按钮');
            }
            const confirmationDeadline = Date.now() + (options.confirmationTimeoutMs ?? 60_000);
            let finalDetail = '';
            const requiredFieldRepairAttempts = new Map();
            let totalRequiredFieldRepairAttempts = 0;
            let lastConfirmationDetail = '等待天猫确认提交结果';
            progress('waiting-result', '已提交，正在等待天猫确认发布结果');
            while (Date.now() < confirmationDeadline) {
                assertUsablePage(webContents);
                const currentUrl = webContents.getURL();
                if (isLoginUrl(currentUrl)) {
                    throw new TmallQualificationPublishError('PUBLISH_PAGE_LOGIN_REQUIRED', '当前店铺登录已失效，请重新登录后再上传');
                }
                const observedResult = submitObserver?.getState();
                const result = observedResult?.status === 'succeeded' || observedResult?.status === 'failed'
                    ? observedResult
                    : await evaluateState(webContents, buildSubmitResultExpression(targetUrl));
                lastConfirmationDetail = sanitizePlatformDetail(result.detail || lastConfirmationDetail);
                if (result.status === 'succeeded') {
                    finalDetail = result.detail || '天猫商品编辑页已确认提交成功';
                    progress('completed', '天猫已确认发布成功，客户端状态已更新为已有资质');
                    return {
                        requestId,
                        payload: {
                            code: 200,
                            channel: 'tmall-product-publish',
                            itemId,
                            field: TARGET_LABEL,
                            confirmed: true,
                            detail: sanitizePlatformDetail(finalDetail),
                            stepTimings: finishStepTimings()
                        }
                    };
                }
                if (result.status === 'failed') {
                    const blockingDetail = result.detail || '';
                    if (/许可证.*(?:过期|失效)/u.test(blockingDetail)) {
                        throw new TmallQualificationPublishError('LICENSE_EXPIRED', '许可证过期，未上传，已跳过当前商品');
                    }
                    const repairKey = [
                        /包含产品|销售规格必填项未填/u.test(blockingDetail) ? 'sku-products' : '',
                        /条形码|条码/u.test(blockingDetail) ? 'barcode' : '',
                        /净含量|克重|销售规格必填项未填/u.test(blockingDetail) ? 'sku-weight' : '',
                        /多件优惠/u.test(blockingDetail) ? 'multi-discount' : ''
                    ].filter(Boolean).join('|') || blockingDetail.slice(0, 160);
                    const repairAttempts = requiredFieldRepairAttempts.get(repairKey) ?? 0;
                    // XX: uploading a label must never invent barcodes, weights or discounts.
                    // Required-field errors are returned for the merchant to resolve manually.
                    if (options.allowRequiredFieldRepair === true && repairAttempts < 2 && totalRequiredFieldRepairAttempts < 12) {
                        progress('repairing-required-fields', `发布校验未通过，正在补齐必填项：${sanitizePlatformDetail(blockingDetail)}`);
                        const repaired = await prepareRequiredFields(webContents, result.detail || '');
                        if (repaired) {
                            requiredFieldRepairAttempts.set(repairKey, repairAttempts + 1);
                            totalRequiredFieldRepairAttempts += 1;
                            await delay(800);
                            submitObserver?.reset();
                            const retrySubmit = await evaluateState(webContents, buildSubmitExpression());
                            if (retrySubmit.status !== 'clicked') {
                                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_NOT_FOUND', retrySubmit.detail || '补齐平台明确阻止的必填项后，没有找到可用的提交按钮');
                            }
                            await delay(800);
                            continue;
                        }
                    }
                    throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', /净含量|克重|包含产品/u.test(result.detail || '')
                        ? `${result.detail}；此类商品字段不自动修改，已跳过当前商品`
                        : result.detail || '天猫商品编辑页拒绝了本次提交');
                }
                const confirmation = await evaluateState(webContents, buildConfirmExpression())
                    .catch(() => ({ status: 'waiting' }));
                if (confirmation.status === 'clicked') {
                    await delay(Math.max(pollIntervalMs, 300));
                    continue;
                }
                if (observedResult?.marker === 'submit-response-finished')
                    break;
                await delay(pollIntervalMs);
            }
            progress('checking-existing', '提交响应不明确，正在重新打开同一商品核对资质状态');
            let readbackDetail = '';
            try {
                const readbackNavigation = Promise.resolve(options.navigate(targetUrl));
                void readbackNavigation.catch(() => undefined);
                const readbackTimeoutMs = Math.min(options.readyTimeoutMs ?? 45_000, 15_000);
                await waitForPublishPage(webContents, itemId, readbackTimeoutMs, pollIntervalMs);
                const readback = await waitForState(webContents, buildTargetInputExpression(TARGET_MARKER), readbackTimeoutMs, pollIntervalMs, 'QUALIFICATION_FILE_INPUT_NOT_FOUND', '重新加载后未确认预包装标签图1存在');
                if (readback.status === 'ready' && readback.marker === 'qualification-existing') {
                    progress('completed', '重新加载后已确认预包装标签图1存在，客户端状态已更新');
                    return {
                        requestId,
                        payload: {
                            code: 200,
                            channel: 'tmall-product-publish',
                            itemId,
                            field: TARGET_LABEL,
                            confirmed: true,
                            detail: sanitizePlatformDetail('重新加载后已确认预包装标签图1存在'),
                            stepTimings: finishStepTimings()
                        }
                    };
                }
                readbackDetail = sanitizePlatformDetail(readback.detail || '重新加载后未确认资质存在');
            }
            catch (error) {
                if (error instanceof TmallQualificationPublishError
                    && (error.code === 'PUBLISH_PAGE_LOGIN_REQUIRED'
                        || error.code === 'PUBLISH_PAGE_SECURITY_CHALLENGE')) {
                    throw error;
                }
                readbackDetail = error instanceof TmallQualificationPublishError
                    ? error.platformResponse.message
                    : '重新加载核对资质失败';
            }
            const observerDetail = sanitizePlatformDetail(submitObserver?.getState().detail || '');
            const timeoutDetails = Array.from(new Set([
                observerDetail,
                lastConfirmationDetail,
                readbackDetail
            ].filter(Boolean))).join('；').slice(0, 360);
            throw new TmallQualificationPublishError('PUBLISH_CONFIRMATION_TIMEOUT', `已点击提交，但天猫未返回明确成功结果${timeoutDetails ? `；最后状态：${timeoutDetails}` : ''}`);
        }
        finally {
            await submitObserver?.close();
        }
    }
    catch (error) {
        if (error instanceof TmallQualificationPublishError) {
            progress('failed', error.platformResponse.message || error.code);
            error.platformResponse.stepTimings = finishStepTimings();
            throw error;
        }
        const detail = error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error || 'unknown error');
        progress('failed', `后台执行失败：${sanitizePlatformDetail(detail)}`);
        const publishError = new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', `天猫页面自动化异常：${detail}`);
        publishError.platformResponse.stepTimings = finishStepTimings();
        throw publishError;
    }
    finally {
        await node_fs_1.promises.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
}
async function createTmallSubmitObserver(webContents) {
    const protocol = webContents.debugger;
    if (typeof protocol.on !== 'function' || typeof protocol.off !== 'function')
        return null;
    const shouldDetach = !protocol.isAttached();
    let state = { status: 'waiting', detail: '等待天猫提交接口响应' };
    let submitRequestId = '';
    let closed = false;
    const listener = async (_event, method, params) => {
        if (closed)
            return;
        if (method === 'Network.requestWillBeSent') {
            const request = params.request;
            if (isTmallSubmitRequestUrl(String(request?.url || ''))
                && request?.method === 'POST') {
                submitRequestId = String(params.requestId || '');
                state = { status: 'waiting', detail: '天猫正在校验并提交商品' };
            }
            return;
        }
        const requestId = String(params.requestId || '');
        if (!submitRequestId || requestId !== submitRequestId)
            return;
        if (method === 'Network.loadingFailed') {
            const detail = String(params.errorText || '').trim();
            state = { status: 'waiting', detail: detail || '天猫提交请求暂未完成' };
            return;
        }
        if (method !== 'Network.loadingFinished')
            return;
        try {
            const result = await protocol.sendCommand('Network.getResponseBody', { requestId });
            const body = result.base64Encoded
                ? Buffer.from(String(result.body || ''), 'base64').toString('utf8')
                : String(result.body || '');
            const parsed = parseTmallSubmitResponse(body);
            state = parsed.status === 'waiting'
                ? { ...parsed, marker: 'submit-response-finished' }
                : parsed;
        }
        catch {
            state = { status: 'waiting', detail: '天猫已返回提交结果，正在读取页面状态' };
        }
    };
    try {
        if (shouldDetach)
            protocol.attach('1.3');
        protocol.on('message', listener);
        await protocol.sendCommand('Network.enable', { maxPostDataSize: 0 });
        return {
            getState: () => state,
            reset: () => {
                submitRequestId = '';
                state = { status: 'waiting', detail: '等待新一轮天猫提交接口响应' };
            },
            close: async () => {
                if (closed)
                    return;
                closed = true;
                protocol.off('message', listener);
                if (shouldDetach && protocol.isAttached())
                    protocol.detach();
            }
        };
    }
    catch {
        protocol.off('message', listener);
        if (shouldDetach && protocol.isAttached())
            protocol.detach();
        return null;
    }
}
async function waitForPublishPage(webContents, expectedItemId, timeoutMs, pollIntervalMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        assertUsablePage(webContents);
        const currentUrl = webContents.getURL();
        if (isLoginUrl(currentUrl)) {
            throw new TmallQualificationPublishError('PUBLISH_PAGE_LOGIN_REQUIRED', '当前店铺登录已失效，请重新登录后再上传');
        }
        if (isSecurityChallengeUrl(currentUrl)) {
            throw new TmallQualificationPublishError('PUBLISH_PAGE_SECURITY_CHALLENGE', '天猫触发了安全验证，请先在当前店铺窗口完成人工验证');
        }
        if (isTmallPublishItemUrl(currentUrl, expectedItemId)) {
            if (!webContents.isLoadingMainFrame())
                return;
            try {
                const remainingMs = Math.max(1, deadline - Date.now());
                const debuggerState = await evaluatePublishPageReadyViaDebugger(webContents, Math.min(1_000, remainingMs));
                if (debuggerState.status === 'ready'
                    && debuggerState.marker === 'editor-dom-ready')
                    return;
                const domState = await evaluateState(webContents, buildPublishPageReadyExpression(), Math.min(1_000, remainingMs));
                if (domState.status === 'ready' && domState.marker === 'editor-dom-ready')
                    return;
            }
            catch {
                // Some Tmall resources keep the main frame marked as loading long after
                // the editor is interactive. A failed lightweight DOM probe is not a
                // terminal result; keep observing URL, login and security state until
                // the bounded deadline.
            }
        }
        await delay(pollIntervalMs);
    }
    throw new TmallQualificationPublishError('PUBLISH_PAGE_LOAD_TIMEOUT', '天猫商品编辑页加载超时，请检查当前店铺网络和登录状态');
}
async function evaluatePublishPageReadyViaDebugger(webContents, timeoutMs) {
    try {
        const value = await executePageExpressionViaDebugger(webContents, buildPublishPageReadyExpression(), timeoutMs);
        return value && typeof value.status === 'string'
            ? value
            : { status: 'waiting', detail: '调试协议尚未返回编辑器状态' };
    }
    catch {
        return { status: 'waiting', detail: '调试协议暂时无法读取编辑器状态' };
    }
}
async function executePageExpressionViaDebugger(webContents, expression, timeoutMs) {
    const protocol = webContents.debugger;
    let attachedHere = false;
    let timeout;
    try {
        if (!protocol.isAttached()) {
            protocol.attach('1.3');
            attachedHere = true;
        }
        const response = await Promise.race([
            protocol.sendCommand('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: false
            }),
            new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('DOM_EVALUATION_TIMEOUT')), Math.max(1, timeoutMs));
            })
        ]);
        if (response?.exceptionDetails) {
            throw new Error(response.result?.description
                || response.exceptionDetails.text
                || 'DOM_DEBUGGER_EVALUATION_FAILED');
        }
        return response?.result?.value;
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
        if (attachedHere && protocol.isAttached())
            protocol.detach();
    }
}
function buildPublishPageReadyExpression() {
    return `(() => { // QUALIFICATION_PUBLISH_PAGE_READY
    const text = String(document.body?.innerText || '').replace(/\\s+/gu, ' ').trim();
    const hasEditorIdentity = text.includes('商品发布')
      && text.includes('商品标题')
      && (text.includes('商品属性') || text.includes('基础信息'));
    const hasInteractiveFields = document.querySelectorAll(
      'input, textarea, [role="combobox"], [contenteditable="true"]'
    ).length >= 2;
    if (hasEditorIdentity && hasInteractiveFields) {
      return {
        status: 'ready',
        marker: 'editor-dom-ready',
        detail: '天猫编辑器主体已可交互'
      };
    }
    return {
      status: 'waiting',
      detail: '天猫编辑器主体仍在加载'
    };
  })()`;
}
async function waitForState(webContents, expression, timeoutMs, pollIntervalMs, timeoutCode, timeoutMessage) {
    const deadline = Date.now() + timeoutMs;
    let lastState = { status: 'waiting' };
    while (Date.now() < deadline) {
        assertUsablePage(webContents);
        try {
            lastState = await evaluateState(webContents, expression, Math.min(3_000, Math.max(1, deadline - Date.now())));
        }
        catch (error) {
            if (!isRetryableDomEvaluationTimeout(error))
                throw error;
            lastState = { status: 'waiting', detail: '天猫页面正在响应，继续读取页面状态' };
            await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
            continue;
        }
        if (lastState.status === 'ready')
            return lastState;
        if (lastState.status === 'failed') {
            throw new TmallQualificationPublishError(timeoutCode === 'QUALIFICATION_UPLOAD_REJECTED'
                ? 'QUALIFICATION_UPLOAD_REJECTED'
                : timeoutCode, lastState.detail || timeoutMessage);
        }
        if (lastState.status === 'login') {
            throw new TmallQualificationPublishError('PUBLISH_PAGE_LOGIN_REQUIRED', lastState.detail || '当前店铺登录已失效，请重新登录后再上传');
        }
        if (lastState.status === 'challenge') {
            throw new TmallQualificationPublishError('PUBLISH_PAGE_SECURITY_CHALLENGE', lastState.detail || '天猫触发了安全验证，请先完成人工验证');
        }
        if (lastState.status === 'ambiguous') {
            throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', lastState.detail || '页面存在多个无法区分的资质上传框，已停止操作');
        }
        await delay(pollIntervalMs);
    }
    const lastDetail = sanitizePlatformDetail(lastState.detail || '');
    const message = lastDetail && lastDetail !== timeoutMessage
        ? `${timeoutMessage}；页面最后状态：${lastDetail}`
        : timeoutMessage;
    throw new TmallQualificationPublishError(timeoutCode, message);
}
async function setTargetFileInput(webContents, filePath, marker) {
    if (!webContents.mainFrame) {
        await setTargetFileInputDirect(webContents, filePath, marker);
        return;
    }
    const protocol = webContents.debugger;
    const shouldDetach = !protocol.isAttached();
    let materialSessionId = '';
    let fileChooserBackendNodeId = 0;
    let fileChooserListener;
    let targetAttachmentListener;
    let autoAttachEnabled = false;
    const autoAttachedMaterialSessions = [];
    const materialSessionTrail = [];
    const recordMaterialSession = (event, detail = '') => {
        if (materialSessionTrail.length >= 48)
            return;
        materialSessionTrail.push(detail ? `${event}:${detail}` : event);
    };
    try {
        if (shouldDetach)
            protocol.attach('1.3');
        targetAttachmentListener = (_event, method, params) => {
            if (method === 'Target.attachedToTarget') {
                const targetInfo = params.targetInfo;
                const sessionId = String(params.sessionId || '');
                const targetId = String(targetInfo?.targetId || '');
                if (!sessionId || !targetId)
                    return;
                const url = String(targetInfo?.url || '');
                const attachmentKind = url.includes(MATERIAL_SELECTOR_PATH)
                    ? 'material'
                    : url ? 'other' : 'empty';
                if (attachmentKind !== 'other')
                    recordMaterialSession('attach', attachmentKind);
                const existing = autoAttachedMaterialSessions.find((candidate) => (candidate.sessionId === sessionId || candidate.targetId === targetId));
                const nextTarget = {
                    sessionId,
                    targetId,
                    type: String(targetInfo?.type || ''),
                    url
                };
                if (existing)
                    Object.assign(existing, nextTarget);
                else
                    autoAttachedMaterialSessions.push(nextTarget);
                return;
            }
            if (method === 'Target.targetInfoChanged') {
                const targetInfo = params.targetInfo;
                const targetId = String(targetInfo?.targetId || '');
                const existing = autoAttachedMaterialSessions.find((candidate) => (candidate.targetId === targetId));
                if (existing) {
                    existing.type = String(targetInfo?.type || existing.type);
                    existing.url = String(targetInfo?.url || existing.url);
                    recordMaterialSession('change', existing.url.includes(MATERIAL_SELECTOR_PATH)
                        ? 'material'
                        : existing.url ? 'other' : 'empty');
                }
                return;
            }
            if (method === 'Target.detachedFromTarget') {
                const sessionId = String(params.sessionId || '');
                const index = autoAttachedMaterialSessions.findIndex((candidate) => (candidate.sessionId === sessionId));
                const detachedTarget = index >= 0 ? autoAttachedMaterialSessions[index] : undefined;
                if (detachedTarget && (!detachedTarget.url
                    || detachedTarget.url.includes(MATERIAL_SELECTOR_PATH))) {
                    recordMaterialSession('detach', detachedTarget.url.includes(MATERIAL_SELECTOR_PATH)
                        ? 'material'
                        : 'transient');
                }
                if (index >= 0)
                    autoAttachedMaterialSessions.splice(index, 1);
            }
        };
        protocol.on('message', targetAttachmentListener);
        autoAttachEnabled = true;
        try {
            await sendProtocolCommandBounded(protocol, 'Target.setAutoAttach', {
                autoAttach: true,
                waitForDebuggerOnStart: false,
                flatten: true
            });
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error || '');
            if (!detail.startsWith('PROTOCOL_COMMAND_TIMEOUT:Target.setAutoAttach'))
                throw error;
            // Target discovery and manual attachment below remain authoritative. On
            // a busy renderer Chromium can apply auto-attach after Electron's short
            // command promise times out, so this optional optimization must not fail
            // an otherwise usable product editor.
            recordMaterialSession('auto-attach-timeout');
        }
        const selectorPoint = await waitForPagePoint(webContents, buildOpenMaterialSelectorExpression(marker), 10_000);
        if (selectorPoint.status !== 'ready' || !isFinitePagePoint(selectorPoint)) {
            throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', selectorPoint.detail || '预包装标签图1上传入口不可用');
        }
        if (selectorPoint.marker !== 'clicked') {
            await dispatchPageClick(webContents, selectorPoint.x, selectorPoint.y);
        }
        let materialFrame = await waitForMaterialSelectorFrame(webContents, 15_000);
        let materialFrameUrl = '';
        let materialHandleId = '';
        const captureMaterialFrameIdentity = () => {
            materialFrameUrl = '';
            materialHandleId = '';
            try {
                materialFrameUrl = materialFrame.url;
            }
            catch {
                return false;
            }
            if (!materialFrameUrl)
                return false;
            try {
                materialHandleId = new URL(materialFrameUrl).searchParams.get('handleId') || '';
            }
            catch {
                materialHandleId = '';
            }
            return true;
        };
        if (!captureMaterialFrameIdentity()) {
            throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', '天猫图片选择窗口在连接前已刷新');
        }
        const matchesMaterialTarget = (target) => {
            if (typeof target.url !== 'string' || !target.url.includes(MATERIAL_SELECTOR_PATH)) {
                return false;
            }
            if (target.url === materialFrameUrl)
                return true;
            if (!materialHandleId)
                return false;
            try {
                return new URL(target.url).searchParams.get('handleId') === materialHandleId;
            }
            catch {
                return false;
            }
        };
        const targetResult = await protocol.sendCommand('Target.getTargets');
        const materialTarget = targetResult.targetInfos?.find(matchesMaterialTarget);
        const isMaterialSessionUnavailable = (error) => (/Session with given id not found|No target with given id|Target closed|target navigated or closed/iu.test(error instanceof Error ? error.message : String(error || '')));
        let materialTargetId = String(materialTarget?.targetId || '');
        const establishMaterialSession = async () => {
            let lastError;
            const failedTargetIds = new Set();
            const failedSessionIds = new Set();
            const waitForAutoAttachedMaterialSession = async (timeoutMs) => {
                const deadline = Date.now() + timeoutMs;
                while (Date.now() < deadline) {
                    // Auto-attached sessions are descendants of this editor's debugger.
                    // Tmall may replace the selector OOPIF with a new handleId while the
                    // local-upload flow is opening, so the material path is authoritative
                    // here even when the old target/handle identity no longer matches.
                    const attachedSession = autoAttachedMaterialSessions.find((candidate) => ((candidate.targetId === materialTargetId
                        || matchesMaterialTarget(candidate)
                        || candidate.url.includes(MATERIAL_SELECTOR_PATH))
                        && !failedSessionIds.has(candidate.sessionId)));
                    if (attachedSession)
                        return attachedSession;
                    await delay(50);
                }
                return undefined;
            };
            const waitForMatchingMaterialTarget = async (timeoutMs) => {
                const deadline = Date.now() + timeoutMs;
                while (Date.now() < deadline) {
                    const refreshedTargets = await protocol.sendCommand('Target.getTargets');
                    const refreshedTarget = refreshedTargets.targetInfos?.find((target) => (matchesMaterialTarget(target)
                        && Boolean(target.targetId)
                        && !failedTargetIds.has(String(target.targetId))));
                    if (refreshedTarget?.targetId)
                        return refreshedTarget;
                    await delay(100);
                }
                return undefined;
            };
            const materialConnectionDeadline = Date.now() + 5_000;
            for (let attempt = 0; attempt < 6 && Date.now() < materialConnectionDeadline; attempt += 1) {
                const autoAttachedSession = await waitForAutoAttachedMaterialSession(Math.min(300, Math.max(1, materialConnectionDeadline - Date.now())));
                if (autoAttachedSession) {
                    recordMaterialSession('use-auto', autoAttachedSession.url.includes(MATERIAL_SELECTOR_PATH)
                        ? 'material'
                        : 'target');
                    try {
                        const materialFrameTree = await protocol.sendCommand('Page.getFrameTree', {}, autoAttachedSession.sessionId);
                        materialTargetId = autoAttachedSession.targetId || materialTargetId;
                        recordMaterialSession('auto-ready');
                        return {
                            sessionId: autoAttachedSession.sessionId,
                            frameId: String(materialFrameTree.frameTree?.frame?.id
                                || autoAttachedSession.targetId
                                || materialTargetId)
                        };
                    }
                    catch (error) {
                        lastError = error;
                        recordMaterialSession('auto-error', isMaterialSessionUnavailable(error)
                            ? 'unavailable'
                            : 'other');
                        if (!isMaterialSessionUnavailable(error))
                            throw error;
                        failedSessionIds.add(autoAttachedSession.sessionId);
                    }
                }
                if (attempt > 0 || !materialTargetId) {
                    // The material picker is an OOPIF and Tmall can replace it between
                    // discovery and attachment. Chromium can expose the replacement CDP
                    // target before Electron publishes a new WebFrameMain, so recover the
                    // exact handle continuously without depending on Electron's frame list.
                    // QUALIFICATION_REFRESH_TARGET_BEFORE_FRAME
                    const refreshedTarget = await waitForMatchingMaterialTarget(Math.max(1, materialConnectionDeadline - Date.now()));
                    if (!refreshedTarget?.targetId)
                        break;
                    materialTargetId = refreshedTarget.targetId;
                    recordMaterialSession('refresh-target');
                }
                if (!materialTargetId)
                    break;
                try {
                    const attached = await protocol.sendCommand('Target.attachToTarget', {
                        targetId: materialTargetId,
                        flatten: true
                    });
                    const sessionId = String(attached.sessionId || '');
                    if (!sessionId)
                        throw new Error('MATERIAL_SESSION_MISSING');
                    recordMaterialSession('manual-attached');
                    // Target.targetId identifies the OOPIF target, but DOM.getFrameOwner
                    // prefers the renderer frame id returned by Page.getFrameTree. That
                    // optional read can race a freshly navigated OOPIF even though the
                    // attached session is already usable for Runtime/DOM commands.
                    let manualFrameId = materialTargetId;
                    try {
                        const materialFrameTree = await protocol.sendCommand('Page.getFrameTree', {}, sessionId);
                        manualFrameId = String(materialFrameTree.frameTree?.frame?.id || materialTargetId);
                    }
                    catch (frameTreeError) {
                        if (!isMaterialSessionUnavailable(frameTreeError))
                            throw frameTreeError;
                        recordMaterialSession('manual-frame-tree-unavailable');
                    }
                    return {
                        sessionId,
                        frameId: manualFrameId
                    };
                }
                catch (error) {
                    lastError = error;
                    recordMaterialSession('manual-error', isMaterialSessionUnavailable(error)
                        ? 'unavailable'
                        : 'other');
                    if (!isMaterialSessionUnavailable(error))
                        throw error;
                    failedTargetIds.add(materialTargetId);
                }
            }
            throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', `天猫图片选择窗口连接失效：${sanitizePlatformDetail(lastError instanceof Error ? lastError.message : String(lastError || ''))}${materialSessionTrail.length > 0
                ? `；会话轨迹：${materialSessionTrail.join('>')}`
                : ''}`);
        };
        const establishedMaterialSession = await establishMaterialSession();
        materialSessionId = establishedMaterialSession.sessionId;
        let materialFrameId = establishedMaterialSession.frameId;
        const uploadedFileName = node_path_1.default.basename(filePath);
        const itemFileMatch = /^qualification-(\d+)-/u.exec(uploadedFileName);
        const reusableFilePrefix = itemFileMatch ? `qualification-${itemFileMatch[1]}-` : '';
        let baselineMaterialCardSignatures = [];
        let baselineMaterialCardSnapshotCaptured = false;
        let materialCardEmptyStateConfirmed = false;
        let reconnectMaterialSession;
        let materialSelectionReconnectAttempted = false;
        const isMaterialSessionUnavailableDetail = (detail) => (/Session with given id not found|No target with given id|Target closed|target navigated or closed/iu.test(String(detail || '')));
        const captureMaterialCardSnapshot = async () => {
            baselineMaterialCardSnapshotCaptured = false;
            materialCardEmptyStateConfirmed = false;
            const expression = buildMaterialCardSnapshotExpression();
            const currentMaterialFrame = findMaterialSelectorFrame(webContents);
            const state = currentMaterialFrame
                ? await evaluateFrameState(currentMaterialFrame, expression)
                : await evaluateProtocolPointState(protocol, materialSessionId, expression);
            if (state.status !== 'ready' || !state.detail)
                return [];
            try {
                const parsed = JSON.parse(state.detail);
                if (!Array.isArray(parsed))
                    return [];
                baselineMaterialCardSnapshotCaptured = true;
                materialCardEmptyStateConfirmed = state.marker === 'material-card-empty';
                return parsed.filter((value) => typeof value === 'string').slice(0, 500);
            }
            catch {
                return [];
            }
        };
        const captureStableMaterialCardBaseline = async () => {
            const deadline = Date.now() + 15_000;
            let previousKey = '';
            let materialBaselineStableSince = 0;
            let lastSnapshot = [];
            let capturedAtLeastOnce = false;
            while (Date.now() < deadline) {
                const snapshot = await captureMaterialCardSnapshot();
                if (!baselineMaterialCardSnapshotCaptured) {
                    await delay(150);
                    continue;
                }
                capturedAtLeastOnce = true;
                lastSnapshot = snapshot;
                if (snapshot.length === 0) {
                    if (!materialCardEmptyStateConfirmed) {
                        previousKey = '';
                        materialBaselineStableSince = 0;
                        await delay(150);
                        continue;
                    }
                    if (previousKey !== '__confirmed-empty__') {
                        previousKey = '__confirmed-empty__';
                        materialBaselineStableSince = Date.now();
                    }
                    else if (materialBaselineStableSince > 0
                        && Date.now() - materialBaselineStableSince >= 750) {
                        return [];
                    }
                    await delay(150);
                    continue;
                }
                const key = JSON.stringify([...snapshot].sort());
                if (key !== previousKey) {
                    previousKey = key;
                    materialBaselineStableSince = Date.now();
                }
                else if (materialBaselineStableSince > 0
                    && Date.now() - materialBaselineStableSince >= 1_500) {
                    return snapshot;
                }
                await delay(150);
            }
            baselineMaterialCardSnapshotCaptured = capturedAtLeastOnce;
            return lastSnapshot;
        };
        const evaluateUploadedMaterialState = async () => {
            const expression = buildMaterialSelectUploadedExpression(uploadedFileName, reusableFilePrefix, baselineMaterialCardSignatures, baselineMaterialCardSnapshotCaptured);
            // protocol-material-authoritative: Tmall replaces this realtime OOPIF
            // after a local upload. Electron can retain the previous WebFrameMain,
            // whose otherwise valid DOM keeps reporting the pre-upload stale list.
            // Always read the current CDP target first and use the retained frame only
            // as a fallback when the protocol target itself cannot be evaluated.
            let protocolState = await evaluateProtocolPointState(protocol, materialSessionId, expression);
            if (isMaterialSessionUnavailableDetail(protocolState.detail) && reconnectMaterialSession) {
                if (materialSelectionReconnectAttempted) {
                    return {
                        status: 'waiting',
                        marker: 'material-session-unavailable',
                        detail: protocolState.detail
                    };
                }
                materialSelectionReconnectAttempted = true;
                recordMaterialSession('selection-reconnect');
                try {
                    await reconnectMaterialSession();
                    recordMaterialSession('selection-reconnected');
                    protocolState = await evaluateProtocolPointState(protocol, materialSessionId, expression);
                }
                catch (error) {
                    return {
                        status: 'waiting',
                        marker: 'material-session-reconnecting',
                        detail: `天猫图片窗口会话正在重连：${sanitizePlatformDetail(error instanceof Error ? error.message : String(error || '等待新窗口'))}`
                    };
                }
            }
            if (!isMaterialSessionUnavailableDetail(protocolState.detail)
                && (protocolState.status !== 'waiting'
                    || !protocolState.detail?.includes('天猫图片窗口DOM脚本错误'))) {
                return protocolState;
            }
            const currentMaterialFrame = findMaterialSelectorFrame(webContents);
            if (!currentMaterialFrame)
                return protocolState;
            const frameState = await evaluateFrameState(currentMaterialFrame, expression);
            return isMaterialSessionUnavailableDetail(frameState.detail)
                ? protocolState
                : frameState;
        };
        const confirmMaterialSelection = async (timeoutMs = 2_000) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const state = await evaluateState(webContents, buildTargetInputExpression(marker));
                if (state.status === 'ready' && state.marker === 'qualification-existing') {
                    return true;
                }
                await delay(100);
            }
            return false;
        };
        const requireMaterialSelection = async () => {
            if (await confirmMaterialSelection(5_000))
                return;
            throw new TmallQualificationPublishError('QUALIFICATION_UPLOAD_REJECTED', '商品编辑页未识别已选择的预包装标签图1');
        };
        const attemptExistingMaterialReuse = async (timeoutMs) => {
            if (!reusableFilePrefix)
                return false;
            const reuseDeadline = Date.now() + timeoutMs;
            while (Date.now() < reuseDeadline) {
                // The selector destroys its OOPIF immediately after the checkbox
                // callback backfills the parent editor. Verify that authoritative
                // parent field before reading from the transient child again.
                if (await confirmMaterialSelection(1))
                    return true;
                let state;
                try {
                    state = await evaluateUploadedMaterialState();
                }
                catch (error) {
                    if (!isMaterialSessionUnavailable(error))
                        throw error;
                    // Selecting a material runs inside the transient OOPIF. Tmall can
                    // destroy that target before executeJavaScript resolves even though
                    // its checkbox callback has already backfilled the parent editor.
                    // Treat the parent field as authoritative before surfacing No target.
                    if (await confirmMaterialSelection(2_000))
                        return true;
                    throw error;
                }
                if (state.status === 'clicked') {
                    await requireMaterialSelection();
                    return true;
                }
                if (state.status === 'failed') {
                    throw new TmallQualificationPublishError('QUALIFICATION_UPLOAD_REJECTED', state.detail || '天猫图片空间中的同商品资质图不可选择');
                }
                await delay(150);
            }
            return false;
        };
        // Tmall can hide or rewrite the local filename after accepting an upload.
        // Record the material-card identities before opening the local uploader so
        // the one newly added card can still be selected without guessing among
        // the user's existing materials. The per-store publish gate guarantees
        // that only one qualification upload mutates this picker at a time.
        baselineMaterialCardSignatures = await captureStableMaterialCardBaseline();
        // The first reuse probe can run while Tmall is still lazy-loading the
        // material grid. Once the baseline is stable, check again so an existing
        // content-stable same-item image is selected instead of uploaded twice.
        if (await attemptExistingMaterialReuse(1_500))
            return;
        // Tmall sometimes removes its transient file input immediately after the
        // local-upload button is activated. Intercept the chooser event itself so
        // CDP can write the authorized file through its stable backend node without
        // ever showing a native file dialog.
        fileChooserListener = (_event, method, params, receivedSessionId) => {
            const receivedFrameId = String(params.frameId || '');
            if (method === 'Page.fileChooserOpened'
                && (!receivedSessionId
                    || receivedSessionId === materialSessionId
                    || receivedFrameId === materialFrameId)) {
                fileChooserBackendNodeId = Number(params.backendNodeId || 0);
            }
        };
        protocol.on('message', fileChooserListener);
        const cancel = false;
        let materialLocalUploadRequested = false;
        let materialFileAssignmentCompleted = false;
        let materialFileAssignmentIssued = false;
        const activateMaterialLocalUpload = async () => {
            materialLocalUploadRequested = true;
            const localUploadPoint = await waitForFramePointState(materialFrame, buildMaterialLocalUploadExpression(), 10_000);
            if (localUploadPoint.status !== 'ready' || !isFinitePagePoint(localUploadPoint)) {
                throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', localUploadPoint.detail || '天猫图片选择窗口没有打开本地文件上传框');
            }
            // Runtime.evaluate with userGesture runs inside the already intercepted
            // material OOPIF. It avoids a native chooser and does not depend on
            // display scaling or a potentially stale mouse-event route.
            let activationTimeout;
            try {
                const activation = await Promise.race([
                    protocol.sendCommand('Runtime.evaluate', {
                        expression: buildActivateMaterialLocalUploadExpression(),
                        returnByValue: true,
                        awaitPromise: false,
                        userGesture: true
                    }, materialSessionId),
                    new Promise((_resolve, reject) => {
                        activationTimeout = setTimeout(() => reject(new Error('PROTOCOL_COMMAND_TIMEOUT:Runtime.evaluate:local-upload-user-gesture')), PROTOCOL_COMMAND_TIMEOUT_MS);
                    })
                ]);
                if (!activation.exceptionDetails && activation.result?.value?.status === 'clicked')
                    return;
                recordMaterialSession('local-upload-user-gesture-fallback');
            }
            catch (error) {
                if (isMaterialSessionUnavailable(error))
                    throw error;
                const detail = error instanceof Error ? error.message : String(error || '');
                recordMaterialSession(detail.startsWith('PROTOCOL_COMMAND_TIMEOUT:')
                    ? 'local-upload-user-gesture-timeout'
                    : 'local-upload-user-gesture-error');
            }
            finally {
                if (activationTimeout)
                    clearTimeout(activationTimeout);
            }
            // Keep this click inside the OOPIF session where file chooser interception
            // is enabled. Translating it into a parent-page click can bypass the child
            // interception and open a native Windows dialog that blocks the task.
            await dispatchProtocolClick(protocol, materialSessionId, localUploadPoint.x, localUploadPoint.y);
        };
        const renewMaterialSession = async () => {
            const renewedMaterialSession = await establishMaterialSession();
            materialSessionId = renewedMaterialSession.sessionId;
            materialFrameId = renewedMaterialSession.frameId;
            await enableFileChooserInterception(protocol, materialSessionId, cancel);
        };
        const reopenMaterialSelectorSession = async () => {
            recordMaterialSession('selection-reopen');
            let reopenPoint = { status: 'waiting' };
            const reopenDeadline = Date.now() + 3_000;
            while (Date.now() < reopenDeadline) {
                reopenPoint = await evaluatePointState(webContents, buildOpenMaterialSelectorExpression(marker));
                if (reopenPoint.status !== 'waiting')
                    break;
                await delay(100);
            }
            if (reopenPoint.status !== 'ready') {
                throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', reopenPoint.detail || '天猫图片选择窗口无法重新打开');
            }
            materialFrame = await waitForMaterialSelectorFrame(webContents, 15_000);
            if (!captureMaterialFrameIdentity()) {
                throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', '天猫图片选择窗口重新打开后仍在刷新');
            }
            const reopenedTargets = await protocol.sendCommand('Target.getTargets');
            const reopenedTarget = reopenedTargets.targetInfos?.find(matchesMaterialTarget);
            materialTargetId = String(reopenedTarget?.targetId || '');
            await renewMaterialSession();
            fileChooserBackendNodeId = 0;
            if (materialLocalUploadRequested && !materialFileAssignmentCompleted) {
                if (!materialFileAssignmentIssued)
                    await activateMaterialLocalUpload();
            }
            recordMaterialSession('selection-reopened');
        };
        const recoverMaterialSession = async () => {
            try {
                await renewMaterialSession();
            }
            catch {
                await reopenMaterialSelectorSession();
            }
        };
        reconnectMaterialSession = recoverMaterialSession;
        const finishMaterialLocalUpload = async () => {
            const deadline = Date.now() + 15_000;
            let lastState = {
                status: 'waiting',
                detail: '正在等待天猫确认本地文件上传结果'
            };
            while (Date.now() < deadline) {
                const expression = buildFinishMaterialLocalUploadExpression(uploadedFileName);
                try {
                    // Read the exact CDP session that accepted DOM.setFileInputFiles.
                    // Electron can retain an older WebFrameMain for the replaced OOPIF;
                    // that stale frame has no upload panel and would falsely look closed.
                    lastState = await evaluateProtocolPointState(protocol, materialSessionId, expression, Math.min(2_000, Math.max(1, deadline - Date.now())));
                }
                catch (error) {
                    if (!isMaterialSessionUnavailable(error))
                        throw error;
                    await recoverMaterialSession();
                    await delay(100);
                    continue;
                }
                if (lastState.status === 'failed') {
                    throw new TmallQualificationPublishError('QUALIFICATION_UPLOAD_REJECTED', lastState.detail || '天猫图片空间拒绝了本地资质图');
                }
                if (lastState.status === 'clicked'
                    || (lastState.status === 'ready'
                        && lastState.marker === 'material-upload-panel-closed')) {
                    return;
                }
                await delay(150);
            }
            throw new TmallQualificationPublishError('QUALIFICATION_UPLOAD_REJECTED', lastState.detail || '天猫本地上传完成后未返回素材列表');
        };
        try {
            await enableFileChooserInterception(protocol, materialSessionId, cancel);
        }
        catch (error) {
            if (!isMaterialSessionUnavailable(error))
                throw error;
            await recoverMaterialSession();
        }
        // The picker keeps a reusable hidden file input in its DOM. Writing into
        // that node before activating “本地上传” makes CDP report success without
        // starting Tmall's upload pipeline. Open the local-upload control first so
        // Page.fileChooserOpened identifies the input created for this operation.
        await activateMaterialLocalUpload();
        const isStaleDomNodeError = (error) => (/Could not find node|No node with given id|Node.*does not exist/iu.test(error instanceof Error ? error.message : String(error || '')));
        const findInputNodeId = async (allowReconnect = true) => {
            try {
                const documentResult = await protocol.sendCommand('DOM.getDocument', {
                    depth: 0,
                    pierce: true
                }, materialSessionId);
                const rootNodeId = Number(documentResult.root?.nodeId || 0);
                if (rootNodeId <= 0)
                    return 0;
                const inputResult = await protocol.sendCommand('DOM.querySelector', {
                    nodeId: rootNodeId,
                    selector: 'input[type="file"]'
                }, materialSessionId);
                return Number(inputResult.nodeId || 0);
            }
            catch (error) {
                if (allowReconnect && isMaterialSessionUnavailable(error)) {
                    await recoverMaterialSession();
                    return findInputNodeId(false);
                }
                if (isStaleDomNodeError(error))
                    return 0;
                throw error;
            }
        };
        let inputNodeId = await findInputNodeId();
        const assignFiles = async () => {
            if (!inputNodeId && !fileChooserBackendNodeId)
                return false;
            materialFileAssignmentIssued = true;
            try {
                await protocol.sendCommand('DOM.setFileInputFiles', {
                    files: [filePath],
                    ...(fileChooserBackendNodeId > 0
                        ? { backendNodeId: fileChooserBackendNodeId }
                        : { nodeId: inputNodeId })
                }, materialSessionId);
                materialFileAssignmentCompleted = true;
                return true;
            }
            catch (error) {
                if (isMaterialSessionUnavailable(error)) {
                    // The selector commonly destroys its target after accepting the
                    // change event but before Electron resolves the command. Reissuing
                    // DOM.setFileInputFiles here uploads the same image twice. Treat this
                    // attempt as pending and let the authoritative material list prove
                    // whether the upload was accepted.
                    await recoverMaterialSession();
                    inputNodeId = await findInputNodeId(false);
                    fileChooserBackendNodeId = 0;
                    return true;
                }
                if (!isStaleDomNodeError(error))
                    throw error;
                materialFileAssignmentIssued = false;
                inputNodeId = 0;
                fileChooserBackendNodeId = 0;
                return false;
            }
        };
        let filesAssigned = await assignFiles();
        let lastMaterialSelectionState = {
            status: 'waiting',
            marker: 'file-input-assigned',
            detail: '等待天猫素材列表返回上传结果'
        };
        const inputDeadline = Date.now() + 5_000;
        while (Date.now() < inputDeadline && !filesAssigned) {
            if (!inputNodeId && !fileChooserBackendNodeId) {
                inputNodeId = await findInputNodeId();
            }
            filesAssigned = await assignFiles();
            if (!filesAssigned)
                await delay(100);
        }
        if (!filesAssigned) {
            // A realtime chooser can invalidate its transient input while Chromium
            // is still accepting the file. Confirm the unique uploaded filename in
            // the material list before treating that stale-node race as a failure.
            const uploadedStateAfterInput = await evaluateUploadedMaterialState();
            lastMaterialSelectionState = uploadedStateAfterInput;
            if (uploadedStateAfterInput.status === 'clicked') {
                await requireMaterialSelection();
                return;
            }
            if (uploadedStateAfterInput.status === 'failed') {
                throw new TmallQualificationPublishError('QUALIFICATION_UPLOAD_REJECTED', uploadedStateAfterInput.detail || '天猫图片空间拒绝了本地资质图');
            }
        }
        if (filesAssigned)
            await finishMaterialLocalUpload();
        if (fileChooserListener) {
            protocol.off('message', fileChooserListener);
            fileChooserListener = undefined;
        }
        await disableFileChooserInterception(protocol, materialSessionId);
        const selectionDeadline = Date.now() + 45_000;
        while (Date.now() < selectionDeadline) {
            // The realtime material OOPIF can be replaced or destroyed after its
            // checkbox callback has already updated the parent editor. Observe the
            // authoritative parent field before querying the transient child again.
            if (await confirmMaterialSelection(1))
                return;
            const state = await evaluateUploadedMaterialState();
            lastMaterialSelectionState = state;
            if (state.status === 'clicked') {
                await requireMaterialSelection();
                return;
            }
            if (state.status === 'ready' && isFinitePagePoint(state)) {
                await dispatchMaterialFrameClick(webContents, materialFrameUrl, materialFrameId, materialSessionId, state.x, state.y);
                await requireMaterialSelection();
                return;
            }
            if (state.status === 'failed') {
                throw new TmallQualificationPublishError('QUALIFICATION_UPLOAD_REJECTED', state.detail || '天猫图片空间拒绝了本地资质图');
            }
            await delay(250);
        }
        throw new TmallQualificationPublishError('QUALIFICATION_UPLOAD_REJECTED', `本地资质图已上传，但未能在天猫图片窗口中完成选择；素材窗口最后状态：${lastMaterialSelectionState.marker || lastMaterialSelectionState.status}，${lastMaterialSelectionState.detail || '未返回详情'}；上传前素材${baselineMaterialCardSignatures.length}项；文件输入${filesAssigned ? '已写入' : '未确认'}；会话轨迹：${materialSessionTrail.slice(-8).join(',') || '无'}`);
    }
    finally {
        if (fileChooserListener) {
            protocol.off('message', fileChooserListener);
        }
        if (targetAttachmentListener) {
            protocol.off('message', targetAttachmentListener);
        }
        if (autoAttachEnabled && protocol.isAttached()) {
            await sendProtocolCommandBounded(protocol, 'Target.setAutoAttach', {
                autoAttach: false,
                waitForDebuggerOnStart: false,
                flatten: true
            }).catch(() => undefined);
        }
        if (materialSessionId && protocol.isAttached()) {
            await disableFileChooserInterception(protocol, materialSessionId);
            await sendProtocolCommandBounded(protocol, 'Target.detachFromTarget', {
                sessionId: materialSessionId
            }).catch(() => undefined);
        }
        if (shouldDetach && protocol.isAttached())
            protocol.detach();
    }
}
async function setTargetFileInputDirect(webContents, filePath, marker) {
    const protocol = webContents.debugger;
    const shouldDetach = !protocol.isAttached();
    try {
        if (shouldDetach)
            protocol.attach('1.3');
        await enableFileChooserInterception(protocol);
        const documentResult = await protocol.sendCommand('DOM.getDocument', {
            depth: 0,
            pierce: true
        });
        const rootNodeId = Number(documentResult.root?.nodeId || 0);
        const inputResult = rootNodeId > 0
            ? await protocol.sendCommand('DOM.querySelector', {
                nodeId: rootNodeId,
                selector: `[data-workbench-qualification-upload="${marker}"]`
            })
            : {};
        const inputNodeId = Number(inputResult.nodeId || 0);
        if (!inputNodeId) {
            throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', '预包装标签图1文件输入框已失效，请重试');
        }
        await protocol.sendCommand('DOM.setFileInputFiles', {
            files: [filePath],
            nodeId: inputNodeId
        });
    }
    finally {
        if (protocol.isAttached())
            await disableFileChooserInterception(protocol);
        if (shouldDetach && protocol.isAttached())
            protocol.detach();
    }
}
function findMaterialSelectorFrame(webContents) {
    try {
        return webContents.mainFrame?.framesInSubtree.find((frame) => {
            try {
                return !frame.isDestroyed() && frame.url.includes(MATERIAL_SELECTOR_PATH);
            }
            catch {
                return false;
            }
        });
    }
    catch {
        return undefined;
    }
}
async function waitForMaterialSelectorFrame(webContents, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const frame = findMaterialSelectorFrame(webContents);
        if (frame)
            return frame;
        await delay(150);
    }
    throw new TmallQualificationPublishError('QUALIFICATION_FILE_INPUT_NOT_FOUND', '预包装标签图1没有打开天猫图片选择窗口');
}
async function evaluateFrameState(frame, expression, timeoutMs = 3_000) {
    let timeout;
    try {
        const value = await Promise.race([
            frame.executeJavaScript(expression, true),
            new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('DOM_EVALUATION_TIMEOUT')), Math.max(1, timeoutMs));
            })
        ]);
        return value && typeof value.status === 'string'
            ? value
            : { status: 'waiting', detail: '天猫图片窗口暂未返回状态' };
    }
    catch (error) {
        return {
            status: 'waiting',
            detail: `天猫图片窗口DOM脚本错误：${sanitizePlatformDetail(error instanceof Error ? error.message : String(error || '未知错误'))}`
        };
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
async function evaluateFramePointState(frame, expression) {
    const state = await evaluateFrameState(frame, expression);
    return state;
}
async function waitForFramePointState(frame, expression, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastState = { status: 'waiting' };
    while (Date.now() < deadline) {
        lastState = await evaluateFramePointState(frame, expression);
        if (lastState.status === 'failed'
            || (lastState.status === 'ready' && isFinitePagePoint(lastState))) {
            return lastState;
        }
        await delay(150);
    }
    return lastState;
}
async function dispatchProtocolClick(protocol, sessionId, x, y) {
    const sendMouseEvent = async (params) => {
        let timeout;
        try {
            await Promise.race([
                protocol.sendCommand('Input.dispatchMouseEvent', params, sessionId),
                new Promise((_resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error(`PROTOCOL_COMMAND_TIMEOUT:Input.dispatchMouseEvent:${String(params.type || 'unknown')}`)), PROTOCOL_COMMAND_TIMEOUT_MS);
                })
            ]);
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
        }
    };
    await sendMouseEvent({
        type: 'mouseMoved', x, y, button: 'none'
    });
    await sendMouseEvent({
        type: 'mousePressed', x, y, button: 'left', clickCount: 1
    });
    try {
        await sendMouseEvent({
            type: 'mouseReleased', x, y, button: 'left', clickCount: 1
        });
    }
    catch (error) {
        if (!(error instanceof Error)
            || !error.message.startsWith('PROTOCOL_COMMAND_TIMEOUT:Input.dispatchMouseEvent:mouseReleased')) {
            throw error;
        }
        // A realtime material picker can destroy its iframe immediately after the
        // press event selects the image. In that successful path the release event
        // has no target, so its bounded timeout must not strand the product task.
    }
}
async function dispatchMaterialFrameClick(webContents, materialFrameUrl, materialFrameId, materialSessionId, x, y) {
    const sendRootCommand = async (method, params) => {
        let timeout;
        try {
            return await Promise.race([
                webContents.debugger.sendCommand(method, params),
                new Promise((_resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error(`PROTOCOL_COMMAND_TIMEOUT:${method}`)), PROTOCOL_COMMAND_TIMEOUT_MS);
                })
            ]);
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
        }
    };
    try {
        const owner = await sendRootCommand('DOM.getFrameOwner', {
            frameId: materialFrameId
        });
        const box = await sendRootCommand('DOM.getBoxModel', {
            ...(Number(owner.backendNodeId || 0) > 0
                ? { backendNodeId: Number(owner.backendNodeId) }
                : { nodeId: Number(owner.nodeId || 0) })
        });
        const quad = box.model?.content || [];
        if (quad.length >= 8 && quad.every(Number.isFinite)) {
            const left = Math.min(quad[0], quad[2], quad[4], quad[6]);
            const top = Math.min(quad[1], quad[3], quad[5], quad[7]);
            await dispatchPageClick(webContents, left + x, top + y);
            return;
        }
    }
    catch {
        // Fall through to the DOM offset probe for Chromium builds that do not
        // expose the OOPIF owner through DOM.getFrameOwner.
    }
    const offset = await evaluatePointState(webContents, buildMaterialFrameOffsetExpression(materialFrameUrl), 2_000);
    if (offset.status === 'ready' && isFinitePagePoint(offset)) {
        await dispatchPageClick(webContents, offset.x + x, offset.y + y);
        return;
    }
    await dispatchProtocolClick(webContents.debugger, materialSessionId, x, y);
}
async function evaluateProtocolPointState(protocol, sessionId, expression, timeoutMs = 3_000) {
    let timeout;
    try {
        const response = await Promise.race([
            protocol.sendCommand('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: false
            }, sessionId),
            new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('DOM_EVALUATION_TIMEOUT')), Math.max(1, timeoutMs));
            })
        ]);
        if (response?.exceptionDetails) {
            return {
                status: 'waiting',
                detail: response.result?.description
                    || response.exceptionDetails.text
                    || '天猫图片窗口正在刷新'
            };
        }
        const value = response?.result?.value;
        return value && typeof value.status === 'string'
            ? value
            : { status: 'waiting', detail: '天猫图片窗口暂未返回状态' };
    }
    catch (error) {
        return {
            status: 'waiting',
            detail: `天猫图片窗口DOM脚本错误：${sanitizePlatformDetail(error instanceof Error ? error.message : String(error || '未知错误'))}`
        };
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
async function enableFileChooserInterception(protocol, sessionId, cancel = true) {
    try {
        await protocol.sendCommand('Page.setInterceptFileChooserDialog', {
            enabled: true,
            cancel
        }, sessionId);
    }
    catch {
        // Older Chromium builds do not expose the `cancel` flag. Enabling the
        // interception still suppresses the native chooser while CDP sets files.
        await protocol.sendCommand('Page.setInterceptFileChooserDialog', {
            enabled: true
        }, sessionId);
    }
}
async function disableFileChooserInterception(protocol, sessionId) {
    let timeout;
    try {
        await Promise.race([
            protocol.sendCommand('Page.setInterceptFileChooserDialog', {
                enabled: false
            }, sessionId),
            new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('PROTOCOL_COMMAND_TIMEOUT')), PROTOCOL_COMMAND_TIMEOUT_MS);
            })
        ]);
    }
    catch {
        // Realtime material selection destroys its OOPIF immediately. Cleanup is
        // best effort and must never keep a completed product task running.
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
async function sendProtocolCommandBounded(protocol, method, params, sessionId) {
    let timeout;
    try {
        await Promise.race([
            protocol.sendCommand(method, params, sessionId),
            new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error(`PROTOCOL_COMMAND_TIMEOUT:${method}`)), PROTOCOL_COMMAND_TIMEOUT_MS);
            })
        ]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
async function ensurePackagingType(webContents, timeoutMs, pollIntervalMs, domEvaluationTimeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let state = { status: 'waiting', detail: '正在检查包装类型' };
    let retryScheduled = false;
    let lateDomRetryUsed = false;
    while (Date.now() < deadline || retryScheduled) {
        const isLateRetry = Date.now() >= deadline;
        retryScheduled = false;
        if (isLateRetry)
            lateDomRetryUsed = true;
        try {
            state = await evaluatePointState(webContents, buildPackagingControlExpression(), Math.min(domEvaluationTimeoutMs, Math.max(1, deadline - Date.now())));
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error || 'unknown error');
            const timedOut = isRetryableDomEvaluationTimeout(error);
            if (timedOut && (Date.now() < deadline || !lateDomRetryUsed)) {
                retryScheduled = true;
                state = {
                    status: 'waiting',
                    detail: '天猫编辑器仍在加载包装类型，正在继续读取'
                };
                await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
                continue;
            }
            throw new TmallQualificationPublishError('PACKAGING_TYPE_CHECK_FAILED', timedOut
                ? '天猫商品编辑页读取包装类型超时，已停止且未修改商品'
                : `包装类型检查执行失败：${detail}`);
        }
        if (state.status === 'missing')
            return;
        if (state.status === 'failed') {
            throw new TmallQualificationPublishError('PACKAGING_TYPE_CHECK_FAILED', state.detail || '天猫商品编辑页无法读取包装类型');
        }
        if (state.status === 'ready' && state.marker === 'bulk') {
            throw new TmallQualificationPublishError('BULK_PRODUCT_NO_QUALIFICATION_REQUIRED', '包装类型为“散装”，无需上传资质图');
        }
        if (state.status === 'ready' && state.marker === 'packaged')
            return;
        if (state.status === 'ready') {
            throw new TmallQualificationPublishError('PACKAGING_TYPE_CHECK_FAILED', state.detail || '包装类型无法安全识别，未修改商品');
        }
        await delay(pollIntervalMs);
    }
    throw new TmallQualificationPublishError('PACKAGING_TYPE_CHECK_FAILED', state.detail || '等待包装类型加载超时');
}
async function prepareRequiredFields(webContents, blockingDetail) {
    // The generic sales-spec error may represent several required SKU columns.
    // Product repair still changes only starred, empty “包含产品” cells.
    const shouldFillSkuProducts = /包含产品|销售规格必填项未填/u.test(blockingDetail);
    const shouldFillBarcode = /条形码|条码/u.test(blockingDetail);
    // Tmall sometimes collapses a missing required 总净含量 cell into the
    // generic “销售规格必填项未填” response. Enter the SKU-weight repair path for
    // that response, while the DOM selector below still requires a starred
    // 净含量/总净含量/克重 column and an empty cell before changing anything.
    const shouldFillSkuWeight = /净含量|克重|销售规格必填项未填/u.test(blockingDetail);
    const shouldFillMultiDiscount = /多件优惠/u.test(blockingDetail);
    if (!shouldFillSkuProducts && !shouldFillBarcode && !shouldFillSkuWeight && !shouldFillMultiDiscount)
        return false;
    const protocol = webContents.debugger;
    const shouldDetach = !protocol.isAttached();
    try {
        if (shouldDetach)
            protocol.attach('1.3');
        if (shouldFillMultiDiscount) {
            await prepareMultiItemDiscount(webContents);
        }
        if (shouldFillBarcode) {
            const barcodeState = await evaluateState(webContents, buildPrepareRequiredFieldsExpression());
            if (barcodeState.status !== 'ready') {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', barcodeState.detail || '无法填写必填条形码');
            }
        }
        if (shouldFillSkuProducts) {
            await prepareRequiredSkuProducts(webContents);
        }
        // SKU净含量/克重编辑器的结构差异较大。如果它与条形码或包含产品
        // 同时报错，先修复这些字段，再逐个处理带星号的空净含量单元格。
        const shouldAttemptSkuWeight = shouldFillSkuWeight && isSkuWeightAutoRepairEnabled();
        if (!shouldAttemptSkuWeight)
            return true;
        await evaluateState(webContents, buildResetSkuWeightProgressExpression());
        // Tmall's SKU net-weight cell is a read-only trigger. HTMLElement.click() is
        // not enough for the React popover on the real publish page, so finish any
        // still-empty cells with genuine Chromium input events via CDP.
        for (let index = 0; index < 64; index += 1) {
            let trigger = await evaluatePointState(webContents, buildNextSkuWeightTriggerExpression());
            if (trigger.status === 'missing')
                break;
            if (trigger.status !== 'ready' || !isFinitePagePoint(trigger)) {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', trigger.detail || '无法定位待填写的SKU克重输入框');
            }
            let popover = { status: 'missing', detail: 'SKU克重弹窗尚未打开' };
            let compositeEditor = {
                status: 'missing',
                detail: 'SKU复合净含量编辑器尚未打开'
            };
            // The real Tmall SKU measurement field has an extra React overlay. On some
            // pages Chromium mouse events reach that overlay without triggering its
            // delegated React handler, leaving the editor closed. Invoke the existing
            // page handler first, then keep genuine clicks as a compatibility fallback.
            const directOpen = await evaluateState(webContents, buildOpenCurrentSkuWeightEditorExpression());
            if (directOpen.status === 'ready')
                await delay(350);
            for (let openAttempt = 0; openAttempt < 3; openAttempt += 1) {
                if (openAttempt > 0 || directOpen.status !== 'ready') {
                    await dispatchPageClick(webContents, trigger.x, trigger.y);
                    await delay(350);
                }
                popover = await evaluatePointState(webContents, buildFillSkuWeightQuantityExpression());
                if (popover.status === 'ready' && isFinitePagePoint(popover))
                    break;
                compositeEditor = await evaluatePointState(webContents, buildCompositeSkuWeightEditorExpression());
                if (compositeEditor.status === 'ready'
                    && isFinitePagePoint(compositeEditor)
                    && Number.isFinite(compositeEditor.unitX)
                    && Number.isFinite(compositeEditor.unitY))
                    break;
                trigger = await evaluatePointState(webContents, buildCurrentSkuWeightTriggerPointExpression());
                if (trigger.status !== 'ready' || !isFinitePagePoint(trigger))
                    break;
            }
            if (compositeEditor.status === 'ready'
                && isFinitePagePoint(compositeEditor)
                && Number.isFinite(compositeEditor.unitX)
                && Number.isFinite(compositeEditor.unitY)) {
                await delay(180);
                await dispatchPageClick(webContents, compositeEditor.unitX, compositeEditor.unitY);
                await delay(250);
                const weightUnitOption = await evaluateState(webContents, buildSkuWeightUnitOptionExpression());
                if (weightUnitOption.status !== 'clicked') {
                    throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', weightUnitOption.detail || 'SKU净含量单位列表没有提供g');
                }
                await delay(200);
                const countEditor = await evaluatePointState(webContents, buildCompositeSkuCountExpression());
                if (countEditor.status !== 'ready'
                    || !isFinitePagePoint(countEditor)
                    || !Number.isFinite(countEditor.unitX)
                    || !Number.isFinite(countEditor.unitY)) {
                    throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', countEditor.detail || '无法定位SKU包装数量输入框');
                }
                await delay(180);
                await dispatchPageClick(webContents, countEditor.unitX, countEditor.unitY);
                await delay(250);
                const packageUnitOption = await evaluatePointState(webContents, buildSkuPackageUnitOptionExpression());
                if (packageUnitOption.status !== 'ready' || !isFinitePagePoint(packageUnitOption)) {
                    throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', packageUnitOption.detail || 'SKU包装单位列表没有提供“包”');
                }
                await dispatchPageClick(webContents, packageUnitOption.x, packageUnitOption.y);
                await delay(200);
                const commitPoint = await evaluatePointState(webContents, buildCurrentSkuWeightTriggerPointExpression());
                if (commitPoint.status !== 'ready' || !isFinitePagePoint(commitPoint)) {
                    throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', commitPoint.detail || '无法重新定位当前SKU净含量单元格');
                }
                await dispatchPageClick(webContents, commitPoint.x, commitPoint.y);
                await delay(350);
                const committed = await evaluateState(webContents, buildVerifySkuWeightCommitExpression());
                if (committed.status !== 'ready') {
                    throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', committed.detail || 'SKU净含量5g*1包未保存');
                }
                continue;
            }
            if (popover.marker === 'direct-quantity-complete') {
                await delay(600);
                const directUnit = await evaluateState(webContents, buildFillSkuWeightUnitExpression());
                if (directUnit.status !== 'ready' || directUnit.marker !== 'direct-unit-complete') {
                    throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', directUnit.detail || 'SKU净含量单位没有保存为g');
                }
                // The real SellMeasurementSalePropsItem keeps the table cell empty until
                // its popover closes. Verify only after closing so the committed 5g value
                // has been rendered back into the SKU grid.
                await evaluateState(webContents, buildCloseSkuWeightEditorExpression());
                await delay(800);
                const committed = await evaluateState(webContents, buildVerifySkuWeightCommitExpression());
                if (committed.status !== 'ready') {
                    throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', committed.detail || 'SKU克重5g未保存');
                }
                await delay(250);
                continue;
            }
            if (popover.status !== 'ready'
                || !isFinitePagePoint(popover)
                || !Number.isFinite(popover.unitX)
                || !Number.isFinite(popover.unitY)) {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', popover.detail || 'SKU克重数量输入框没有正常打开');
            }
            if (popover.marker === 'quantity-input-focused') {
                await dispatchPageClick(webContents, popover.x, popover.y);
                await delay(80);
                await insertPageText(webContents, '5');
            }
            await delay(120);
            const quantity = await evaluateState(webContents, buildVerifySkuWeightQuantityExpression());
            if (quantity.status !== 'ready') {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', quantity.detail || 'SKU克重数量没有稳定填写为5');
            }
            await delay(180);
            let unitControl = await evaluatePointState(webContents, buildCurrentSkuWeightUnitControlExpression());
            if (unitControl.status !== 'ready' && Number.isFinite(popover.unitX) && Number.isFinite(popover.unitY)) {
                unitControl = {
                    status: 'ready',
                    detail: '已复用同一SKU净含量弹窗的单位坐标',
                    x: popover.unitX,
                    y: popover.unitY
                };
            }
            if (unitControl.status !== 'ready'
                || (unitControl.marker !== 'complete' && !isFinitePagePoint(unitControl))) {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', unitControl.detail || '无法定位SKU克重单位选择框');
            }
            if (unitControl.marker !== 'complete') {
                await dispatchPageClick(webContents, unitControl.x, unitControl.y);
                await delay(250);
                const unitOption = await evaluateState(webContents, buildSkuWeightUnitOptionExpression());
                if (unitOption.status !== 'clicked') {
                    throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', unitOption.detail || 'SKU克重单位列表没有提供g');
                }
                await delay(200);
            }
            const quantityAfterUnit = await evaluateState(webContents, buildReassertSkuWeightQuantityExpression());
            if (quantityAfterUnit.status !== 'ready') {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', quantityAfterUnit.detail || '选择g后无法重新确认SKU克重数量5');
            }
            await delay(120);
            const verifiedQuantityAfterUnit = await evaluateState(webContents, buildVerifySkuWeightQuantityExpression());
            if (verifiedQuantityAfterUnit.status !== 'ready') {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', verifiedQuantityAfterUnit.detail || '选择g后SKU克重数量没有稳定填写为5');
            }
            const commitPoint = await evaluatePointState(webContents, buildCurrentSkuWeightCommitPointExpression());
            if (commitPoint.status !== 'ready' || !isFinitePagePoint(commitPoint)) {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', commitPoint.detail || '无法重新定位当前SKU克重单元格');
            }
            await dispatchPageClick(webContents, commitPoint.x, commitPoint.y);
            await delay(350);
            const committed = await evaluateState(webContents, buildVerifySkuWeightCommitExpression());
            if (committed.status !== 'ready') {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', committed.detail || 'SKU克重5g未保存');
            }
        }
        const remaining = await evaluatePointState(webContents, buildNextSkuWeightTriggerExpression());
        if (remaining.status === 'ready') {
            throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', 'SKU克重条目超过64个，已停止自动提交');
        }
        return true;
    }
    finally {
        if (shouldDetach && protocol.isAttached())
            protocol.detach();
    }
}
async function prepareMultiItemDiscount(webContents) {
    let control = { status: 'waiting', detail: '正在检查多件优惠' };
    for (let attempt = 0; attempt < 4; attempt += 1) {
        control = await evaluatePointState(webContents, buildMultiItemDiscountControlExpression());
        if (control.status === 'failed') {
            throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', control.detail || '无法定位多件优惠必填项');
        }
        if (control.marker === 'complete' || control.marker === 'needs-discount')
            break;
        if (control.marker !== 'needs-enable' && control.marker !== 'needs-quantity') {
            await delay(300);
            continue;
        }
        // The publish page scrolls the field into view with animation. Read the
        // point again after the scroll settles so the real Chromium click does not
        // land on the previous screen position.
        await delay(400);
        const refreshed = await evaluatePointState(webContents, buildMultiItemDiscountControlExpression());
        if (refreshed.marker === 'complete' || refreshed.marker === 'needs-discount') {
            control = refreshed;
            break;
        }
        if (refreshed.marker === control.marker && isFinitePagePoint(refreshed)) {
            control = refreshed;
        }
        if (!isFinitePagePoint(control)) {
            throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', control.detail || '无法定位多件优惠控件');
        }
        await dispatchPageClick(webContents, control.x, control.y);
        if (control.marker === 'needs-quantity') {
            let option = { status: 'waiting', detail: '正在等待“满2件打折”选项' };
            const optionDeadline = Date.now() + 4_000;
            while (Date.now() < optionDeadline) {
                await delay(180);
                option = await evaluatePointState(webContents, buildMultiItemDiscountOptionExpression());
                if (option.status === 'ready' || option.status === 'failed')
                    break;
            }
            if (option.status !== 'ready' || !isFinitePagePoint(option)) {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', option.detail || '多件优惠没有“满2件打折”选项');
            }
            await dispatchPageClick(webContents, option.x, option.y);
        }
        await delay(500);
    }
    control = await evaluatePointState(webContents, buildMultiItemDiscountControlExpression());
    if (control.marker === 'needs-enable' || control.marker === 'needs-quantity') {
        throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', control.detail || '多件优惠的件数设置尚未完成');
    }
    const filled = await evaluateState(webContents, buildMultiItemDiscountFillExpression());
    if (filled.status !== 'ready') {
        throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', filled.detail || '多件优惠没有保存为2件9.5折');
    }
    await delay(300);
    const verified = await evaluatePointState(webContents, buildMultiItemDiscountControlExpression());
    if (verified.status !== 'ready' || verified.marker !== 'complete') {
        throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', verified.detail || '多件优惠没有保存为2件9.5折');
    }
}
function isSkuWeightAutoRepairEnabled() {
    // Only entered when Tmall explicitly reports SKU net weight as blocking.
    // The editor implementation below writes the agreed safe value (5g) and
    // verifies the committed cell before submission is retried.
    return true;
}
async function prepareRequiredSkuProducts(webContents) {
    await evaluateState(webContents, buildResetSkuProductProgressExpression());
    for (let index = 0; index < 64; index += 1) {
        const trigger = await evaluatePointState(webContents, buildNextRequiredSkuProductTriggerExpression());
        if (trigger.status === 'missing')
            break;
        if (trigger.status !== 'ready') {
            throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', trigger.detail || '无法定位必填的SKU包含产品入口');
        }
        let detailState = await waitForPagePoint(webContents, buildRequiredSkuProductDetailTriggerExpression(), 5_000);
        if (detailState.status !== 'ready') {
            throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', detailState.detail || 'SKU包含产品编辑抽屉没有正常打开');
        }
        if (detailState.marker === 'complete') {
            const cancel = await waitForPagePoint(webContents, buildSkuProductDetailCancelExpression(), 3_000);
            if (cancel.status !== 'ready' || !isFinitePagePoint(cancel)) {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', cancel.detail || '无法关闭已完整的SKU明细');
            }
            await dispatchPageClick(webContents, cancel.x, cancel.y);
            await evaluateState(webContents, buildMarkSkuProductProcessedExpression());
            continue;
        }
        if (!isFinitePagePoint(detailState)) {
            throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', detailState.detail || '无法定位SKU包含产品必填项');
        }
        if (detailState.marker === 'needs-count') {
            await dispatchPageClick(webContents, detailState.x, detailState.y);
            await insertPageText(webContents, '1');
        }
        else {
            if (detailState.marker === 'needs-add') {
                const addResult = await evaluateState(webContents, buildSkuProductDetailAddExpression());
                if (addResult.status !== 'ready') {
                    throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', addResult.detail || 'SKU包含产品“添加”按钮点击失败');
                }
                const addDeadline = Date.now() + 3_000;
                do {
                    await delay(150);
                    detailState = await evaluatePointState(webContents, buildRequiredSkuProductDetailTriggerExpression());
                } while (Date.now() < addDeadline
                    && (detailState.status === 'waiting' || detailState.marker === 'needs-add'));
            }
            if (detailState.marker !== 'needs-search') {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', detailState.detail || '无法定位SKU包含产品搜索框');
            }
            const openSearch = await evaluateState(webContents, buildSkuProductSearchOpenExpression());
            if (openSearch.status !== 'ready') {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', openSearch.detail || 'SKU包含产品选择框点击失败');
            }
            const defaultOption = await waitForPageState(webContents, buildSkuProductDefaultOptionExpression(), 8_000);
            if (defaultOption.status !== 'ready') {
                throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', defaultOption.detail || '当前店铺没有可选择的默认包含产品');
            }
        }
        const detailComplete = await waitForPageState(webContents, buildVerifySkuProductDetailCompleteExpression(), 4_000);
        if (detailComplete.status !== 'ready') {
            throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', detailComplete.detail || 'SKU包含产品内容仍未填写完整');
        }
        const detailConfirm = await waitForPageState(webContents, buildSkuProductDetailConfirmExpression(), 5_000);
        if (detailConfirm.status !== 'ready') {
            throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', detailConfirm.detail || 'SKU明细面板没有提供“确定”按钮');
        }
        await evaluateState(webContents, buildMarkSkuProductProcessedExpression());
    }
    const remaining = await evaluatePointState(webContents, buildNextRequiredSkuProductTriggerExpression());
    if (remaining.status === 'ready') {
        throw new TmallQualificationPublishError('PUBLISH_SUBMIT_FAILED', 'SKU包含产品条目超过64个，已停止自动提交');
    }
}
async function waitForPagePoint(webContents, expression, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let state = { status: 'waiting' };
    while (Date.now() < deadline) {
        try {
            state = await evaluatePointState(webContents, expression, Math.min(3_000, Math.max(1, deadline - Date.now())));
        }
        catch (error) {
            if (!isRetryableDomEvaluationTimeout(error))
                throw error;
            state = { status: 'waiting', detail: '天猫页面正在响应，继续定位页面控件' };
            await delay(Math.min(150, Math.max(1, deadline - Date.now())));
            continue;
        }
        if (state.status === 'ready' || state.status === 'failed' || state.status === 'ambiguous') {
            return state;
        }
        await delay(150);
    }
    return state;
}
async function waitForPageState(webContents, expression, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let state = { status: 'waiting' };
    while (Date.now() < deadline) {
        try {
            state = await evaluateState(webContents, expression, Math.min(3_000, Math.max(1, deadline - Date.now())));
        }
        catch (error) {
            if (!isRetryableDomEvaluationTimeout(error))
                throw error;
            state = { status: 'waiting', detail: '天猫页面正在响应，继续读取页面状态' };
            await delay(Math.min(150, Math.max(1, deadline - Date.now())));
            continue;
        }
        if (state.status === 'ready' || state.status === 'failed')
            return state;
        await delay(150);
    }
    return state;
}
function isFinitePagePoint(value) {
    return Number.isFinite(value.x) && Number.isFinite(value.y);
}
function isRetryableDomEvaluationTimeout(error) {
    return /DOM_EVALUATION_TIMEOUT/u.test(error instanceof Error ? error.message : String(error || ''));
}
async function evaluatePointState(webContents, expression, timeoutMs = 3_000) {
    const value = await executePageExpression(webContents, expression, timeoutMs);
    return value && typeof value.status === 'string'
        ? value
        : { status: 'waiting', detail: '页面暂未返回可识别坐标' };
}
async function dispatchPageClick(webContents, x, y) {
    const protocol = webContents.debugger;
    const shouldDetach = !protocol.isAttached();
    try {
        if (shouldDetach)
            protocol.attach('1.3');
        await sendProtocolCommandBounded(protocol, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved', x, y, button: 'none'
        });
        await sendProtocolCommandBounded(protocol, 'Input.dispatchMouseEvent', {
            type: 'mousePressed', x, y, button: 'left', clickCount: 1
        });
        await sendProtocolCommandBounded(protocol, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased', x, y, button: 'left', clickCount: 1
        });
    }
    finally {
        if (shouldDetach && protocol.isAttached())
            protocol.detach();
    }
}
async function insertPageText(webContents, value) {
    const protocol = webContents.debugger;
    const shouldDetach = !protocol.isAttached();
    try {
        if (shouldDetach)
            protocol.attach('1.3');
        // The caller focuses the controlled Tmall input immediately before this
        // method. Bringing the page to front again can reset that focus to <body>
        // in Electron, so insert text into the already focused editor directly.
        await protocol.sendCommand('Input.insertText', { text: value });
    }
    finally {
        if (shouldDetach && protocol.isAttached())
            protocol.detach();
    }
}
async function evaluateState(webContents, expression, timeoutMs = 3_000) {
    const value = await executePageExpression(webContents, expression, timeoutMs);
    return value && typeof value.status === 'string'
        ? value
        : { status: 'waiting', detail: '页面暂未返回可识别状态' };
}
async function executePageExpression(webContents, expression, timeoutMs = 3_000) {
    const marker = pageExpressionMarker(expression);
    const guardedExpression = guardPageExpression(expression);
    let timeout;
    try {
        if (webContents.isLoadingMainFrame()) {
            return await executePageExpressionViaDebugger(webContents, guardedExpression, timeoutMs);
        }
        return await Promise.race([
            webContents.executeJavaScript(guardedExpression),
            new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('DOM_EVALUATION_TIMEOUT')), Math.max(1, timeoutMs));
            })
        ]);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error || 'unknown error');
        throw new Error(`${marker}: ${detail}`);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
function pageExpressionMarker(expression) {
    return expression.match(/QUALIFICATION_[A-Z_]+/u)?.[0]
        || 'QUALIFICATION_UNKNOWN_PAGE_SCRIPT';
}
function guardPageExpression(expression) {
    const marker = pageExpressionMarker(expression);
    return `(() => { // QUALIFICATION_PAGE_SCRIPT_GUARD
    try {
      return ${expression};
    } catch (error) {
      return {
        status: 'failed',
        detail: ${JSON.stringify(`${marker}：`)}
          + String(error && (error.stack || error.message) || error || 'unknown error')
      };
    }
  })()`;
}
function buildPackagingControlExpression() {
    return `(() => { // QUALIFICATION_PACKAGING_CONTROL
    const targetLabel = ${JSON.stringify(TARGET_LABEL)};
    const classifyPackagingEvidence = ${classifyTmallPackagingEvidence.toString()};
    const extractPackagingValueFromFieldText = ${extractTmallPackagingValueFromFieldText.toString()};
    const packagingLabels = ['包装方式', '包装类型'];
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const bodyText = normalize(document.body?.innerText);
    if (bodyText.includes(targetLabel)) {
      return { status: 'missing', detail: '已发现预包装标签图1，按需上传资质图' };
    }
    const bodyLines = String(document.body?.innerText || '').split(/\\r?\\n/gu).map(normalize).filter(Boolean);
    const nearbyValues = [];
    for (let index = 0; index < bodyLines.length; index += 1) {
      const line = bodyLines[index];
      const label = packagingLabels.find((candidate) => line === candidate || line.startsWith(candidate + ' '));
      if (!label) continue;
      const inlineValue = normalize(line.slice(label.length));
      if (inlineValue) nearbyValues.push(inlineValue);
    }
    const labels = Array.from(document.querySelectorAll('body *'))
      .filter((element) => packagingLabels.includes(normalize(element.textContent)) && visible(element));
    if (!labels.length) {
      if (bodyText.includes(targetLabel)) {
        return { status: 'missing', detail: '资质上传字段已存在，无需修改包装类型' };
      }
      const startedAt = Number(document.body.getAttribute('data-workbench-packaging-search-started-at') || '0');
      if (!startedAt) document.body.setAttribute('data-workbench-packaging-search-started-at', String(Date.now()));
      else if (Date.now() - startedAt >= 12_000) {
        return { status: 'missing', detail: '当前类目没有包装类型字段，继续检查资质上传区域' };
      }
      const basicTab = Array.from(document.querySelectorAll('button, [role="tab"], [role="button"], a, div, span'))
        .find((element) => normalize(element.textContent) === '基础信息' && visible(element));
      if (basicTab instanceof HTMLElement && !document.body.hasAttribute('data-workbench-packaging-basic-opened')) {
        document.body.setAttribute('data-workbench-packaging-basic-opened', '1');
        basicTab.click();
      }
      return { status: 'waiting', detail: '正在加载包装类型' };
    }
    document.body.removeAttribute('data-workbench-packaging-search-started-at');
    const fieldRootSelector = '.sell-component-info-wrapper-wrap, [class*="info-wrapper-wrap"], [class*="prop-item"], .next-form-item, [class*="form-item"]';
    const controlSelector = 'input[role="combobox"], [role="combobox"] input, .next-select input, [aria-haspopup="listbox"], select';
    const findLocalFieldRoot = (label) => {
      let node = label.parentElement;
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        const localControls = Array.from(node.querySelectorAll(controlSelector)).filter(visible);
        if (localControls.length > 0 && localControls.length <= 4) return node;
      }
      return label.closest(fieldRootSelector);
    };
    const fieldRoots = Array.from(new Set(labels.map(findLocalFieldRoot).filter(Boolean)));
    const controls = Array.from(new Set(fieldRoots.flatMap((root) => Array.from(root.querySelectorAll(controlSelector)))))
      .filter(visible);
    if (!controls.length) {
      if (bodyText.includes(targetLabel)) {
        return { status: 'missing', detail: '资质上传字段已存在，无需修改包装类型' };
      }
      return { status: 'waiting', detail: '包装类型选择框尚未加载' };
    }
    const readSelectedValue = (input) => {
      const direct = normalize(input.value || input.getAttribute('value') || input.getAttribute('title'));
      if (direct) return direct;
      if (input instanceof HTMLSelectElement) {
        return normalize(input.selectedOptions?.[0]?.textContent);
      }
      // The input itself carries role="combobox" but its value is empty. Do
      // not let closest() stop on that input; the selected option is rendered
      // by Fusion in the surrounding .next-select as <em title="…">.
      const selectRoot = input.closest('.next-select')
        || input.parentElement?.closest('[aria-haspopup="true"], [role="combobox"]')
        || input.parentElement;
      const selectedLabel = selectRoot?.querySelector(
        'em[title], .next-select-inner, .next-select-value, [data-value][aria-selected="true"], [role="option"][aria-selected="true"]'
      );
      return normalize(selectedLabel?.getAttribute('title')
        || selectedLabel?.getAttribute('data-value')
        || selectedLabel?.textContent);
    };
    const selectedValues = [
      ...controls.map(readSelectedValue),
      ...fieldRoots.map((root) => extractPackagingValueFromFieldText(root.innerText))
    ].filter(Boolean);
    const classification = classifyPackagingEvidence({
      qualificationFieldPresent: bodyText.includes(targetLabel),
      selectedValues,
      nearbyValues
    });
    if (classification === 'qualification-required') {
      return { status: 'missing', detail: '已发现预包装标签图1，按需上传资质图' };
    }
    if (classification === 'bulk') {
      return { status: 'ready', marker: 'bulk', detail: '包装类型为“散装”' };
    }
    if (classification === 'packaged') {
      return { status: 'ready', marker: 'packaged', detail: '包装类型已经是“包装”' };
    }
    const values = Array.from(new Set([...selectedValues, ...nearbyValues]));
    return {
      status: values.length ? 'failed' : 'waiting',
      detail: values.length
        ? '包装类型无法安全识别，当前值：' + values.join(' / ') + '；未修改商品'
        : '包装类型尚未显示已选值'
    };
  })()`;
}
function buildTargetInputExpression(marker) {
    return `(() => { // QUALIFICATION_TARGET_INPUT
    const targetLabel = ${JSON.stringify(TARGET_LABEL)};
    const marker = ${JSON.stringify(marker)};
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const matchesTargetLabel = ${isTmallQualificationTargetLabel.toString()};
    const fieldRootSelector = '.sell-component-info-wrapper-wrap, [class*="info-wrapper-wrap"], [class*="prop-item"], .next-form-item, [class*="form-item"]';
    const triggerSelector = '.image-empty, [class*="image-empty"], .empty-container, .sell-component-image-v2, .sell-component-material-item-view, .main-content, [data-role*="upload"], button, [role="button"]';
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const bodyText = normalize(document.body?.innerText);
    if (/请登录|重新登录|账号登录/u.test(bodyText) && /login|passport/iu.test(location.href)) {
      return { status: 'login', detail: '当前店铺登录已失效' };
    }
    if (/访问拒绝|安全验证|滑块验证/u.test(bodyText) || /\\/punish/iu.test(location.href)) {
      return { status: 'challenge', detail: '天猫触发了安全验证' };
    }
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .next-dialog, .ant-modal, .tm-dialog'))
      .filter(visible);
    const attributeDialog = dialogs.find((dialog) => normalize(dialog.textContent).includes('商品属性信息更新确定'));
    if (attributeDialog instanceof HTMLElement) {
      const adoptRecommendation = Array.from(attributeDialog.querySelectorAll('label, span, div'))
        .find((element) => /^(?:采纳|确认采纳)$/u.test(normalize(element.textContent)));
      const adoptControl = adoptRecommendation?.closest('label') || adoptRecommendation;
      if (adoptControl instanceof HTMLElement) adoptControl.click();
      const confirm = Array.from(attributeDialog.querySelectorAll('button, [role="button"]'))
        .find((element) => /^(?:采纳|确认采纳|确定|确认)$/u.test(normalize(element.textContent)) && visible(element));
      if (confirm instanceof HTMLElement) confirm.click();
      return { status: 'waiting', detail: '已采纳商品属性更新，继续加载资质区域' };
    }
    document.querySelectorAll('[data-workbench-qualification-upload]').forEach((element) => {
      element.removeAttribute('data-workbench-qualification-upload');
    });
    const labelCandidates = new Set(Array.from(document.querySelectorAll(
      '.sell-component-info-wrapper-label, [class*="info-wrapper-label"], label, dt, th, [title], [aria-label]'
    )));
    const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode = textWalker.nextNode();
    while (textNode) {
      if (matchesTargetLabel(textNode.nodeValue)) labelCandidates.add(textNode.parentElement);
      textNode = textWalker.nextNode();
    }
    const labelElements = Array.from(labelCandidates)
      .filter((element) => element instanceof HTMLElement
        && matchesTargetLabel(element.textContent || element.getAttribute('title') || element.getAttribute('aria-label'))
        && visible(element));
    if (!labelElements.length) {
      const basicTab = Array.from(document.querySelectorAll('button, [role="tab"], [role="button"], a, div, span'))
        .find((element) => normalize(element.textContent) === '基础信息' && visible(element));
      if (basicTab instanceof HTMLElement && !document.body.hasAttribute('data-workbench-qualification-basic-opened')) {
        document.body.setAttribute('data-workbench-qualification-basic-opened', '1');
        basicTab.click();
        return { status: 'waiting', detail: '正在打开基础信息' };
      }
      const section = Array.from(document.querySelectorAll('body *'))
        .find((element) => normalize(element.textContent) === '商品资质' && visible(element));
      const scanStep = Number(document.body.getAttribute('data-workbench-qualification-scan-step') || '0') + 1;
      document.body.setAttribute('data-workbench-qualification-scan-step', String(scanStep));
      if (section instanceof HTMLElement) {
        const collapsed = section.closest('[aria-expanded="false"]')
          || section.querySelector('[aria-expanded="false"]');
        if (collapsed instanceof HTMLElement) collapsed.click();
        const details = section.closest('details');
        if (details instanceof HTMLDetailsElement && !details.open) details.open = true;
        if (scanStep === 1) section.scrollIntoView({ block: 'start', inline: 'nearest' });
      }
      window.scrollBy({ top: Math.max(480, window.innerHeight * 0.65), behavior: 'instant' });
      Array.from(document.querySelectorAll('body *')).filter((element) => element instanceof HTMLElement
        && element.scrollHeight > element.clientHeight + 100).forEach((element) => {
          element.scrollTop = Math.min(element.scrollHeight, element.scrollTop + Math.max(480, element.clientHeight * 0.65));
        });
      const loadingVisible = Array.from(document.querySelectorAll(
        '[aria-busy="true"], .next-loading, .next-loading-tip, [class*="skeleton"]'
      )).some(visible);
      const scrollContainers = Array.from(document.querySelectorAll('body *')).filter((element) => (
        element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 100
      ));
      const viewportAtBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24;
      const containersAtBottom = scrollContainers.every((element) => (
        element.scrollTop + element.clientHeight >= element.scrollHeight - 24
      ));
      const scanSignature = [
        bodyText.length,
        document.documentElement.scrollHeight,
        ...scrollContainers.slice(0, 12).map((element) => element.scrollHeight)
      ].join(':');
      const previousSignature = document.body.getAttribute('data-workbench-qualification-scan-signature');
      const stableScan = previousSignature === scanSignature
        ? Number(document.body.getAttribute('data-workbench-qualification-stable-scan') || '0') + 1
        : 0;
      document.body.setAttribute('data-workbench-qualification-scan-signature', scanSignature);
      document.body.setAttribute('data-workbench-qualification-stable-scan', String(stableScan));
      if (document.readyState === 'complete' && !loadingVisible && scanStep >= 3 && stableScan >= 2
        && viewportAtBottom && containersAtBottom) {
        return {
          status: 'ready',
          marker: 'qualification-not-required',
          detail: '当前商品类目未提供' + targetLabel + '，无需上传资质图'
        };
      }
      return { status: 'waiting', detail: '正在加载' + targetLabel };
    }
    document.body.removeAttribute('data-workbench-qualification-scan-step');
    document.body.removeAttribute('data-workbench-qualification-scan-signature');
    document.body.removeAttribute('data-workbench-qualification-stable-scan');
    const fieldCandidates = labelElements.map((label) => label.closest(fieldRootSelector))
      .filter((field, index, fields) => field instanceof HTMLElement && fields.indexOf(field) === index);
    const selected = fieldCandidates.map((fieldRoot) => {
      const triggers = Array.from(fieldRoot.querySelectorAll(triggerSelector));
      const trigger = triggers.find((candidate) => {
        if (!(candidate instanceof HTMLElement) || !visible(candidate)) return false;
        if (candidate.matches('.image-empty, [class*="image-empty"], .empty-container, .sell-component-image-v2, .sell-component-material-item-view, .main-content, [data-role*="upload"]')) return true;
        const controlText = normalize(candidate.textContent || candidate.getAttribute('aria-label') || candidate.getAttribute('title'));
        return /上传|添加图片|选择图片/u.test(controlText);
      });
      return { fieldRoot, trigger };
    }).find((candidate) => candidate.trigger instanceof HTMLElement);
    const fieldRoot = selected?.fieldRoot;
    const trigger = selected?.trigger;
    const selectedLabel = labelElements.find((label) => label.closest(fieldRootSelector) === fieldRoot);
    if (!(selectedLabel instanceof HTMLElement) || !(fieldRoot instanceof HTMLElement) || !(trigger instanceof HTMLElement)) {
      return { status: 'missing', detail: targetLabel + '尚未加载正确的图片上传入口' };
    }
    const existingRemotePreviews = Array.from(fieldRoot.querySelectorAll('img[src]'))
      .filter((image) => {
        const source = image.currentSrc || image.src || '';
        const rect = image.getBoundingClientRect();
        return (source.startsWith('https://') || source.startsWith('http://'))
          && rect.width >= 24 && rect.height >= 24;
      });
    if (existingRemotePreviews.length > 0) {
      selectedLabel.scrollIntoView({ block: 'center', inline: 'nearest' });
      return {
        status: 'ready',
        marker: 'qualification-existing',
        detail: targetLabel + '已存在，跳过重复上传和提交'
      };
    }
    const previewSources = Array.from(fieldRoot.querySelectorAll('img'))
      .map((image) => image.currentSrc || image.src || '')
      .filter(Boolean);
    trigger.setAttribute('data-workbench-qualification-upload', marker);
    fieldRoot.setAttribute('data-workbench-qualification-field', marker);
    fieldRoot.setAttribute('data-workbench-qualification-baseline-previews', JSON.stringify(previewSources));
    selectedLabel.scrollIntoView({ block: 'center', inline: 'nearest' });
    return { status: 'ready', marker };
  })()`;
}
function buildOpenMaterialSelectorExpression(marker) {
    return `(() => { // QUALIFICATION_OPEN_MATERIAL_SELECTOR
    const marker = ${JSON.stringify(marker)};
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const matchesTargetLabel = ${isTmallQualificationTargetLabel.toString()};
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    let trigger = document.querySelector('[data-workbench-qualification-upload="${marker}"]');
    if (!(trigger instanceof HTMLElement)) { // QUALIFICATION_REACQUIRE_UPLOAD_TRIGGER
      const fieldRootSelector = '.sell-component-info-wrapper-wrap, [class*="info-wrapper-wrap"], [class*="prop-item"], .next-form-item, [class*="form-item"]';
      const triggerSelector = '.image-empty, [class*="image-empty"], .empty-container, .sell-component-image-v2, .sell-component-material-item-view, .main-content, [data-role*="upload"], button, [role="button"]';
      const labelCandidates = new Set(Array.from(document.querySelectorAll(
        '.sell-component-info-wrapper-label, [class*="info-wrapper-label"], label, dt, th, [title], [aria-label]'
      )));
      const documentBody = document.body;
      if (!documentBody || typeof documentBody.nodeType !== 'number') {
        return { status: 'waiting', detail: '天猫资质区域正在重新渲染' };
      }
      let textWalker;
      try {
        textWalker = document.createTreeWalker(documentBody, NodeFilter.SHOW_TEXT);
      } catch {
        return { status: 'waiting', detail: '天猫资质区域正在重新渲染' };
      }
      let textNode = textWalker.nextNode();
      while (textNode) {
        if (matchesTargetLabel(textNode.nodeValue)) labelCandidates.add(textNode.parentElement);
        textNode = textWalker.nextNode();
      }
      const labelElements = Array.from(labelCandidates).filter((element) => (
        element instanceof HTMLElement
          && matchesTargetLabel(element.textContent || element.getAttribute('title') || element.getAttribute('aria-label'))
          && visible(element)
      ));
      const fieldRoots = labelElements.map((label) => label.closest(fieldRootSelector))
        .filter((field, index, fields) => field instanceof HTMLElement && fields.indexOf(field) === index);
      for (const fieldRoot of fieldRoots) {
        const candidate = Array.from(fieldRoot.querySelectorAll(triggerSelector)).find((element) => {
          if (!(element instanceof HTMLElement) || !visible(element)) return false;
          if (element.matches('.image-empty, [class*="image-empty"], .empty-container, .sell-component-image-v2, .sell-component-material-item-view, .main-content, [data-role*="upload"]')) return true;
          return /上传|添加图片|选择图片/u.test(normalize(
            element.textContent || element.getAttribute('aria-label') || element.getAttribute('title')
          ));
        });
        if (candidate instanceof HTMLElement) {
          trigger = candidate;
          trigger.setAttribute('data-workbench-qualification-upload', marker);
          fieldRoot.setAttribute('data-workbench-qualification-field', marker);
          break;
        }
      }
    }
    if (!(trigger instanceof HTMLElement)) {
      return { status: 'waiting', detail: '预包装标签图1上传入口正在重新加载' };
    }
    const clickTarget = trigger.matches('.image-empty')
      ? trigger
      : trigger.querySelector('.image-empty') || trigger;
    if (!(clickTarget instanceof HTMLElement)) {
      return { status: 'waiting', detail: '预包装标签图1上传按钮正在重新加载' };
    }
    clickTarget.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = clickTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { status: 'waiting', detail: '预包装标签图1上传入口正在变为可见' };
    }
    clickTarget.click();
    return {
      status: 'ready',
      marker: 'clicked',
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  })()`;
}
function buildMaterialLocalUploadExpression() {
    return `(() => { // QUALIFICATION_MATERIAL_LOCAL_UPLOAD
    const normalize = (value) => String(value || '').replace(/\\s+/gu, '').trim();
    const button = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find((element) => normalize(element.textContent) === '本地上传');
    if (!(button instanceof HTMLElement)) {
      return { status: 'waiting', detail: '正在加载天猫本地上传入口' };
    }
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { status: 'waiting', detail: '天猫本地上传入口尚不可见' };
    }
    return {
      status: 'ready',
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  })()`;
}
function buildActivateMaterialLocalUploadExpression() {
    return `(() => { // QUALIFICATION_ACTIVATE_MATERIAL_LOCAL_UPLOAD
    const normalize = (value) => String(value || '').replace(/\\s+/gu, '').trim();
    const button = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find((element) => normalize(element.textContent) === '本地上传');
    if (!(button instanceof HTMLElement)) {
      return { status: 'waiting', detail: '天猫本地上传入口已刷新' };
    }
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') {
      return { status: 'waiting', detail: '天猫本地上传入口尚不可操作' };
    }
    button.click();
    return { status: 'clicked', detail: '已在天猫图片窗口打开本地上传' };
  })()`;
}
function buildFinishMaterialLocalUploadExpression(fileName) {
    return `(() => { // QUALIFICATION_FINISH_MATERIAL_LOCAL_UPLOAD
    const fileName = ${JSON.stringify(fileName)};
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const panels = Array.from(document.querySelectorAll('[class*="UploadPanel_uploadPanel"], [class*="uploadListPanel"]'));
    const panel = panels.find((element) => {
      const text = normalize(element.textContent);
      return text.includes(fileName) || /文件上传成功|上传文件/u.test(text);
    });
    if (!(panel instanceof HTMLElement)) {
      return {
        status: 'ready',
        marker: 'material-upload-panel-closed',
        detail: '天猫本地上传面板已关闭'
      };
    }
    const text = normalize(panel.innerText);
    if (/上传失败|图片格式错误|文件过大|上传异常/u.test(text)) {
      return { status: 'failed', detail: text.slice(0, 240) };
    }
    if (!text.includes(fileName) || !/文件上传成功/u.test(text)) {
      return {
        status: 'waiting',
        marker: 'material-local-upload-processing',
        detail: '天猫正在上传本地资质图'
      };
    }
    const button = Array.from(panel.querySelectorAll('button, [role="button"]'))
      .find((candidate) => normalize(candidate.textContent) === '完成');
    if (!(button instanceof HTMLElement)) {
      return {
        status: 'waiting',
        marker: 'material-upload-finish-control-loading',
        detail: '本地资质图已上传，正在等待天猫完成按钮'
      };
    }
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') {
      return {
        status: 'waiting',
        marker: 'material-upload-finish-control-hidden',
        detail: '本地资质图已上传，天猫完成按钮尚不可操作'
      };
    }
    button.click();
    return {
      status: 'clicked',
      marker: 'material-upload-finished',
      detail: '本地资质图上传成功，已返回天猫素材列表'
    };
  })()`;
}
function buildMaterialFrameOffsetExpression(frameUrl) {
    return `(() => { // QUALIFICATION_MATERIAL_FRAME_OFFSET
    const frameUrl = ${JSON.stringify(frameUrl)};
    const frame = Array.from(document.querySelectorAll('iframe'))
      .find((candidate) => candidate.src === frameUrl);
    if (!(frame instanceof HTMLIFrameElement)) {
      return { status: 'waiting', detail: '正在定位天猫图片窗口' };
    }
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { status: 'waiting', detail: '天猫图片窗口尚不可见' };
    }
    return {
      status: 'ready',
      marker: 'material-frame-offset',
      x: rect.left + frame.clientLeft,
      y: rect.top + frame.clientTop
    };
  })()`;
}
function buildMaterialCardSnapshotExpression() {
    return `(() => { // QUALIFICATION_MATERIAL_CARD_SNAPSHOT
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const stableImageSource = (image) => {
      const source = String(image?.currentSrc || image?.src || '');
      if (!source) return '';
      try {
        const url = new URL(source, location.href);
        return url.protocol === 'blob:' || url.protocol === 'data:'
          ? source.slice(0, 180)
          : url.origin + url.pathname;
      } catch {
        return source.split('?')[0].slice(0, 300);
      }
    };
    const cardForCheckbox = (checkbox) => {
      let current = checkbox;
      let matchedCard = null;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        const checkboxes = current.querySelectorAll?.('input[type="checkbox"]') || [];
        const images = current.querySelectorAll?.('img[src]') || [];
        const image = images[0];
        if (checkboxes.length === 1 && images.length === 1 && image instanceof HTMLImageElement) {
          matchedCard = { root: current, image };
          continue;
        }
        if (matchedCard && (checkboxes.length > 1 || images.length > 1)) break;
      }
      return matchedCard;
    };
    const cardIdentity = (checkbox, root, image) => {
      const checkboxValue = normalize(checkbox.value);
      if (checkboxValue && !/^(?:on|true|false|0|1)$/iu.test(checkboxValue)) {
        return 'checkbox:' + checkboxValue;
      }
      let current = root;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const dataIdentity = ['data-id', 'data-key', 'data-asset-id', 'data-material-id', 'data-item-id']
          .map((name) => normalize(current.getAttribute?.(name)))
          .find(Boolean) || '';
        if (dataIdentity) return 'data:' + dataIdentity;
      }
      const imageIdentity = stableImageSource(image);
      if (imageIdentity) return 'image:' + imageIdentity;
      return 'text:' + normalize(root.textContent).slice(0, 120);
    };
    const signatures = Array.from(document.querySelectorAll('input[type="checkbox"]'))
      .map((checkbox) => {
        const card = cardForCheckbox(checkbox);
        if (!(checkbox instanceof HTMLInputElement) || !card) return '';
        return cardIdentity(checkbox, card.root, card.image);
      })
      .filter(Boolean);
    const uniqueSignatures = Array.from(new Set(signatures)).slice(0, 500);
    if (uniqueSignatures.length === 0) {
      const loadingVisible = Array.from(document.querySelectorAll(
        '.next-loading, [class*="loading" i], [aria-busy="true"]'
      )).some(visible);
      const emptyStateVisible = Array.from(document.querySelectorAll(
        '.next-empty, [class*="empty" i], [class*="no-data" i]'
      )).some((element) => visible(element)
        && /暂无(?:图片|素材|数据)|还没有(?:图片|素材)|未上传任何/u.test(normalize(element.textContent)));
      if (!loadingVisible && emptyStateVisible) {
        return {
          status: 'ready',
          marker: 'material-card-empty',
          detail: '[]'
        };
      }
      return {
        status: 'waiting',
        marker: 'material-list-loading',
        detail: loadingVisible ? '天猫素材列表正在加载' : '正在等待天猫素材卡片出现'
      };
    }
    return {
      status: 'ready',
      marker: 'material-card-snapshot',
      detail: JSON.stringify(uniqueSignatures)
    };
  })()`;
}
function buildMaterialSelectUploadedExpression(fileName, reusableFilePrefix = '', baselineSignatures = [], baselineSnapshotCaptured = false) {
    return `(() => { // QUALIFICATION_MATERIAL_SELECT_UPLOADED
    const fileName = ${JSON.stringify(fileName)};
    const reusableFilePrefix = ${JSON.stringify(reusableFilePrefix)};
    const baselineSignatures = new Set(${JSON.stringify(baselineSignatures)});
    const baselineSnapshotCaptured = ${JSON.stringify(baselineSnapshotCaptured)};
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const text = normalize(document.body?.innerText);
    if (/上传失败|图片格式错误|文件过大|上传异常/u.test(text)) {
      return { status: 'failed', detail: text.slice(0, 300) };
    }
    const stableImageSource = (image) => {
      const source = String(image?.currentSrc || image?.src || '');
      if (!source) return '';
      try {
        const url = new URL(source, location.href);
        return url.protocol === 'blob:' || url.protocol === 'data:'
          ? source.slice(0, 180)
          : url.origin + url.pathname;
      } catch {
        return source.split('?')[0].slice(0, 300);
      }
    };
    const cardForCheckbox = (checkbox) => {
      let current = checkbox;
      let matchedCard = null;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        const checkboxes = current.querySelectorAll?.('input[type="checkbox"]') || [];
        const images = current.querySelectorAll?.('img[src]') || [];
        const image = images[0];
        if (checkboxes.length === 1 && images.length === 1 && image instanceof HTMLImageElement) {
          matchedCard = { root: current, image };
          continue;
        }
        if (matchedCard && (checkboxes.length > 1 || images.length > 1)) break;
      }
      return matchedCard;
    };
    const cardIdentity = (checkbox, root, image) => {
      const checkboxValue = normalize(checkbox.value);
      if (checkboxValue && !/^(?:on|true|false|0|1)$/iu.test(checkboxValue)) {
        return 'checkbox:' + checkboxValue;
      }
      let current = root;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const dataIdentity = ['data-id', 'data-key', 'data-asset-id', 'data-material-id', 'data-item-id']
          .map((name) => normalize(current.getAttribute?.(name)))
          .find(Boolean) || '';
        if (dataIdentity) return 'data:' + dataIdentity;
      }
      const imageIdentity = stableImageSource(image);
      if (imageIdentity) return 'image:' + imageIdentity;
      return 'text:' + normalize(root.textContent).slice(0, 120);
    };
    const cards = Array.from(document.querySelectorAll('input[type="checkbox"]'))
      .map((checkbox) => {
        if (!(checkbox instanceof HTMLInputElement)) return null;
        const card = cardForCheckbox(checkbox);
        if (!card) return null;
        const names = Array.from(card.root.querySelectorAll('*'))
          .flatMap((element) => [
            normalize(element.textContent),
            normalize(element.getAttribute('title'))
          ])
          .filter(Boolean);
        const selectedFileName = names.find((candidate) => candidate === fileName
          || Boolean(reusableFilePrefix && candidate.startsWith(reusableFilePrefix))) || '';
        const signature = cardIdentity(checkbox, card.root, card.image);
        return { checkbox, image: card.image, selectedFileName, signature };
      })
      .filter(Boolean);
    const namedCandidates = cards
      .filter((card) => Boolean(card.selectedFileName))
      .sort((left, right) => Number(right.selectedFileName === fileName)
        - Number(left.selectedFileName === fileName));
    const newCandidates = cards.filter((card) => (
      baselineSnapshotCaptured && !baselineSignatures.has(card.signature)
    ));
    const uniqueNewCandidates = Array.from(new Map(newCandidates.map((candidate) => (
      [candidate.signature, candidate]
    ))).values());
    const candidates = namedCandidates.length > 0
      ? namedCandidates
      : uniqueNewCandidates.length === 1 ? uniqueNewCandidates : [];
    for (const candidate of candidates) {
        const { checkbox, image, selectedFileName } = candidate;
        const rect = image.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (checkbox.disabled) {
          return { status: 'failed', detail: '天猫图片空间中的资质图不可选择' };
        }
        const readinessKey = '__workbenchQualificationMaterialReady';
        const readinessSignature = [selectedFileName, checkbox.value, image.currentSrc || image.src].join('|');
        const previousReadiness = window[readinessKey];
        const materialReadySince = previousReadiness?.signature === readinessSignature
          ? Number(previousReadiness.at || 0)
          : 0;
        if (!image.complete || image.naturalWidth <= 0) {
          window[readinessKey] = { signature: readinessSignature, at: 0 };
          return {
            status: 'waiting',
            marker: 'material-thumbnail-loading',
            detail: '正在等待天猫资质图缩略图加载完成'
          };
        }
        if (materialReadySince <= 0) {
          window[readinessKey] = { signature: readinessSignature, at: Date.now() };
          return {
            status: 'waiting',
            marker: 'material-card-stabilizing',
            detail: '天猫资质图已出现，正在等待选择控件稳定'
          };
        }
        if (Date.now() - materialReadySince < 750) {
          return {
            status: 'waiting',
            marker: 'material-card-stabilizing',
            detail: '天猫资质图选择控件正在稳定'
          };
        }
        // The realtime selector's checkbox owns the callback that writes the
        // chosen material back to the editor. A coordinate click can land on
        // the iframe backdrop under display scaling, so invoke that exact DOM
        // control synchronously so its parent callback runs before the
        // realtime iframe destroys itself. The parent editor still verifies
        // the image preview before it can report success.
        const wasChecked = checkbox.checked;
        delete window[readinessKey];
        checkbox.click();
        if (wasChecked) {
          return {
            status: 'waiting',
            marker: 'resetting-material-selection',
            detail: '正在重新确认天猫资质图选择状态'
          };
        }
        return {
          status: 'clicked',
          marker: selectedFileName
            ? selectedFileName === fileName ? 'uploaded-material-card' : 'reused-material-card'
            : 'new-uploaded-material-card',
          detail: selectedFileName
            ? selectedFileName === fileName
              ? '已选择本地上传的资质图'
              : '已复用天猫图片空间中同一商品的资质图'
            : '已选择本次新增的天猫资质图',
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
    }
    const materialCardsReady = Array.from(document.querySelectorAll('input[type="checkbox"]'))
      .some((checkbox) => Boolean(checkbox.closest('div')?.querySelector('img[src]')));
    const newIdentityKinds = Array.from(new Set(uniqueNewCandidates.map((candidate) => (
      String(candidate.signature || '').split(':')[0] || 'unknown'
    )))).join('/');
    return {
      status: 'waiting',
      marker: uniqueNewCandidates.length > 1
        ? 'ambiguous-new-materials'
        : materialCardsReady ? 'stale-list' : 'material-list-loading',
      detail: uniqueNewCandidates.length > 1
        ? '检测到多个新增素材（当前' + cards.length
          + '，基线' + baselineSignatures.size
          + '，新增控件' + newCandidates.length
          + '，唯一素材' + uniqueNewCandidates.length
          + '，标识' + (newIdentityKinds || 'unknown')
          + '），正在等待列表稳定以避免误选'
        : text.includes(fileName) ? '资质图正在写入天猫图片列表' : '等待本地资质图上传完成'
    };
  })()`;
}
function buildUploadStartedExpression(marker, uploadTimeoutMs) {
    return `(() => { // QUALIFICATION_UPLOAD_STARTED
    const input = document.querySelector('[data-workbench-qualification-upload="${marker}"]');
    const fieldRoot = document.querySelector('[data-workbench-qualification-field="${marker}"]');
    const container = fieldRoot instanceof HTMLElement
      ? fieldRoot
      : input instanceof HTMLInputElement ? input.parentElement : null;
    if (!(container instanceof HTMLElement)) {
      return { status: 'failed', detail: '预包装标签图1区域已失效' };
    }
    container.setAttribute('data-workbench-qualification-file-set-at', String(Date.now()));
    container.setAttribute('data-workbench-qualification-upload-timeout-ms', ${JSON.stringify(uploadTimeoutMs)});
    return { status: 'ready', detail: '已开始等待预包装标签图1回填' };
  })()`;
}
function buildUploadStateExpression(marker, configuredUploadTimeoutMs) {
    return `(() => { // QUALIFICATION_UPLOAD_STATE
    const uploadTimeoutMs = ${JSON.stringify(configuredUploadTimeoutMs)};
    const input = document.querySelector('[data-workbench-qualification-upload="${marker}"]');
    const fieldRoot = document.querySelector('[data-workbench-qualification-field="${marker}"]');
    const container = fieldRoot instanceof HTMLElement
      ? fieldRoot
      : input instanceof HTMLInputElement ? input.parentElement : null;
    if (!container) return { status: 'failed', detail: '预包装标签图1区域已失效' };
    const text = String(container.innerText || '').replace(/\\s+/gu, ' ').trim();
    if (/上传失败|格式错误|图片错误|超过.*(?:MB|M)|尺寸不符|安全审核失败/u.test(text)) {
      return { status: 'failed', detail: text.slice(0, 200) };
    }
    let baseline = [];
    try { baseline = JSON.parse(container.getAttribute('data-workbench-qualification-baseline-previews') || '[]'); } catch {}
    const currentSources = Array.from(container.querySelectorAll('img'))
      .map((image) => image.currentSrc || image.src || '')
      .filter(Boolean);
    const newPreview = currentSources.some((source) => !baseline.includes(source));
    const uploadedPreview = currentSources.some((source) => (
      !baseline.includes(source) && /^https?:\/\//iu.test(source)
    ));
    if (uploadedPreview || /上传成功|上传完成/u.test(text)) {
      return { status: 'ready', detail: '预包装标签图1上传完成' };
    }
    const fileSetAt = Number(
      container.getAttribute('data-workbench-qualification-file-set-at')
      || (input instanceof HTMLInputElement ? input.getAttribute('data-workbench-qualification-file-set-at') : '0')
      || '0'
    );
    if (fileSetAt > 0 && Date.now() - fileSetAt >= uploadTimeoutMs && !newPreview) {
      return {
        status: 'failed',
        detail: '资质图未在' + Math.ceil(uploadTimeoutMs / 1000) + '秒内完成网页上传，已停止提交'
      };
    }
    if (/上传中|处理中/u.test(text) || (input instanceof HTMLInputElement && input.files?.length)) {
      return { status: 'uploading', detail: '正在上传预包装标签图1' };
    }
    return { status: 'uploading', detail: '等待预包装标签图1上传结果' };
  })()`;
}
function buildMultiItemDiscountControlExpression() {
    return `(() => { // QUALIFICATION_MULTI_DISCOUNT_CONTROL
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const label = Array.from(document.querySelectorAll(
      '.sell-component-info-wrapper-label, label, dt, th, body span'
    )).find((element) => (
      normalize(element.textContent).replace(/[\\s：:*＊]/gu, '') === '多件优惠'
      && visible(element)
    ));
    const root = label?.closest('.sell-component-info-wrapper-wrap');
    if (!(root instanceof HTMLElement)) {
      return { status: 'failed', detail: '没有找到多件优惠设置区域' };
    }
    root.scrollIntoView({ block: 'center', inline: 'nearest' });
    const checkbox = root.querySelector('input[type="checkbox"]');
    const quantity = root.querySelector('input[role="combobox"]');
    const discount = Array.from(root.querySelectorAll('input')).find((input) => (
      input !== checkbox && input !== quantity && input.type !== 'hidden'
    ));
    if (!(checkbox instanceof HTMLInputElement)
      || !(quantity instanceof HTMLInputElement)
      || !(discount instanceof HTMLInputElement)) {
      return { status: 'failed', detail: '多件优惠控件尚未完整加载' };
    }
    if (!checkbox.checked) {
      const rect = checkbox.getBoundingClientRect();
      return {
        status: 'ready', marker: 'needs-enable',
        detail: '正在启用多件优惠',
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }
    const selectedText = normalize(quantity.closest('.next-select')?.textContent);
    if (!selectedText.includes('满2件打折')) {
      const rect = quantity.getBoundingClientRect();
      return {
        status: 'ready', marker: 'needs-quantity',
        detail: '正在设置满2件打折',
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }
    if (normalize(discount.value) !== '9.5') {
      return { status: 'ready', marker: 'needs-discount', detail: '正在设置9.5折' };
    }
    return { status: 'ready', marker: 'complete', detail: '多件优惠已设置为2件9.5折' };
  })()`;
}
function buildMultiItemDiscountOptionExpression() {
    return `(() => { // QUALIFICATION_MULTI_DISCOUNT_OPTION
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < innerHeight
        && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const option = Array.from(document.querySelectorAll(
      '.next-select-menu-item, [role="option"], .options-item'
    )).find((element) => visible(element) && (
      normalize(element.textContent) === '满2件打折'
      || normalize(element.getAttribute('title')) === '满2件打折'
    ));
    if (!(option instanceof HTMLElement)) {
      return { status: 'waiting', detail: '正在加载“满2件打折”选项' };
    }
    const rect = option.getBoundingClientRect();
    return {
      status: 'ready', marker: 'two-items',
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  })()`;
}
function buildMultiItemDiscountFillExpression() {
    return `(() => { // QUALIFICATION_MULTI_DISCOUNT_FILL
    const discountValue = '9.5';
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const label = Array.from(document.querySelectorAll(
      '.sell-component-info-wrapper-label, label, dt, th, body span'
    )).find((element) => (
      normalize(element.textContent).replace(/[\\s：:*＊]/gu, '') === '多件优惠'
    ));
    const root = label?.closest('.sell-component-info-wrapper-wrap');
    const checkbox = root?.querySelector('input[type="checkbox"]');
    const quantity = root?.querySelector('input[role="combobox"]');
    const discount = Array.from(root?.querySelectorAll('input') || []).find((input) => (
      input !== checkbox && input !== quantity && input.type !== 'hidden'
    ));
    const selectedText = normalize(quantity?.closest('.next-select')?.textContent);
    if (!(checkbox instanceof HTMLInputElement) || !checkbox.checked
      || !(quantity instanceof HTMLInputElement) || !selectedText.includes('满2件打折')
      || !(discount instanceof HTMLInputElement)) {
      return { status: 'failed', detail: '多件优惠的件数设置尚未完成' };
    }
    discount.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(discount, discountValue);
    else discount.value = discountValue;
    discount.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: discountValue
    }));
    discount.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    discount.blur();
    return { status: 'ready', marker: 'complete', detail: '多件优惠已填写为2件9.5折' };
  })()`;
}
function buildPrepareRequiredFieldsExpression() {
    return `(async () => { // QUALIFICATION_PREPARE_REQUIRED_FIELDS
    const barcodeFallback = '0000000000000';
    const skuWeightNumber = '5';
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const ancestorDistance = (from, candidate) => {
      const distances = new Map();
      let node = from;
      let distance = 0;
      while (node) { distances.set(node, distance); node = node.parentElement; distance += 1; }
      node = candidate;
      distance = 0;
      while (node) {
        if (distances.has(node)) return distance + distances.get(node);
        node = node.parentElement;
        distance += 1;
      }
      return Number.MAX_SAFE_INTEGER;
    };
    const isRequiredLabel = (element) => {
      let required = /[*＊]/u.test(String(element.textContent || ''));
      let current = element;
      for (let depth = 0; current instanceof HTMLElement && depth < 6; depth += 1) {
        if (/[*＊]/u.test(String(current.textContent || ''))
          || current.classList.contains('required')
          || current.getAttribute('aria-required') === 'true'
          || current.getAttribute('data-required') === 'true') {
          required = true;
          break;
        }
        current = current.parentElement;
      }
      return required;
    };
    const labels = Array.from(document.querySelectorAll('label, dt, th, [class*="label"], [class*="Label"], body span, body div'))
      .filter((element) => {
        const text = normalize(element.textContent).replace(/[\\s：:*＊]/gu, '');
        return text.includes('条形码') && text.length <= 40
          && visible(element) && isRequiredLabel(element);
      });
    const allInputs = Array.from(document.querySelectorAll('input:not([type]), input[type="text"], input[type="number"], input[type="tel"]'))
      .filter((input) => input instanceof HTMLInputElement && visible(input) && !input.disabled);
    const inputs = allInputs.filter((input) => !input.readOnly);
    const isBarcodeInput = (input) => {
      const descriptor = normalize([
        input.name,
        input.id,
        input.placeholder,
        input.getAttribute('aria-label'),
        input.getAttribute('data-field'),
        input.getAttribute('data-name')
      ].filter(Boolean).join(' '));
      return /(?:条形码|条码|barcode)/iu.test(descriptor)
        && !/(?:关键词|搜索)/u.test(descriptor);
    };
    const selected = inputs.filter((input) => !normalize(input.value) && isBarcodeInput(input));
    for (const label of labels) {
      const linkedInput = label instanceof HTMLLabelElement && label.htmlFor
        ? document.getElementById(label.htmlFor)
        : null;
      const fieldInput = label.closest('.sell-component-info-wrapper-wrap')?.querySelector(
        'input:not([type]), input[type="text"], input[type="number"], input[type="tel"]'
      );
      const ranked = inputs
        .filter((candidate) => !normalize(candidate.value))
        .map((candidate) => ({ candidate, score: ancestorDistance(label, candidate) }))
        .sort((left, right) => left.score - right.score)[0];
      const input = fieldInput instanceof HTMLInputElement && !fieldInput.disabled && !fieldInput.readOnly
        && !normalize(fieldInput.value)
        ? fieldInput
        : linkedInput instanceof HTMLInputElement && !normalize(linkedInput.value)
        ? linkedInput
        : ranked && ranked.score <= 8 ? ranked.candidate : null;
      if (input instanceof HTMLInputElement && !selected.includes(input)) selected.push(input);
    }
    const errorContainers = Array.from(document.querySelectorAll(
      '.sell-component-info-wrapper-wrap, .next-form-item, [class*="form-item" i], [class*="field" i]'
    )).filter((element) => {
      const text = normalize(element.textContent);
      return visible(element) && /条形码/u.test(text)
        && /(?:必填|不能为空|未填|错误)/u.test(text);
    });
    for (const container of errorContainers) {
      const input = Array.from(container.querySelectorAll(
        'input:not([type]), input[type="text"], input[type="number"], input[type="tel"]'
      )).find((candidate) => candidate instanceof HTMLInputElement
        && visible(candidate) && !candidate.disabled && !candidate.readOnly
        && !normalize(candidate.value)
        && !/(?:关键词|搜索)/u.test(candidate.placeholder || ''));
      if (input instanceof HTMLInputElement && !selected.includes(input)) selected.push(input);
    }
    const skuWeightHeaders = Array.from(document.querySelectorAll('th, [role="columnheader"], body span, body div'))
      .filter((element) => {
        const text = normalize(element.textContent).replace(/[\\s：:*＊]/gu, '');
        return /^(?:总净含量|净含量|克重)(?:重要)?$/u.test(text) && visible(element);
      });
    const skuWeightInputs = [];
    for (const header of skuWeightHeaders) {
      const headerRect = header.getBoundingClientRect();
      const headerCenter = headerRect.left + headerRect.width / 2;
      let gridRoot = header.closest('table, [role="table"], [class*="table" i], [class*="sku" i]');
      while (gridRoot && !gridRoot.querySelector('input')) gridRoot = gridRoot.parentElement;
      if (!gridRoot) {
        let candidateRoot = header.parentElement;
        while (candidateRoot && candidateRoot !== document.body) {
          const candidateText = normalize(candidateRoot.textContent);
          const candidateInputCount = candidateRoot.querySelectorAll('input').length;
          if (candidateInputCount >= 2 && /SKU|销售规格/u.test(candidateText)) {
            gridRoot = candidateRoot;
            break;
          }
          candidateRoot = candidateRoot.parentElement;
        }
      }
      const gridInputs = gridRoot
        ? allInputs.filter((input) => gridRoot.contains(input))
        : [];
      const candidates = gridInputs.filter((input) => {
        if (normalize(input.value)) return false;
        const rect = input.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        return rect.top >= headerRect.bottom - 8 && Math.abs(center - headerCenter) <= Math.max(120, rect.width * 0.75);
      });
      for (const input of candidates) {
        if (!skuWeightInputs.includes(input)) skuWeightInputs.push(input);
      }
    }
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const fill = (input, value) => {
      input.focus();
      if (nativeSetter) nativeSetter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: value
      }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      input.blur();
    };
    for (const input of selected) fill(input, barcodeFallback);
    await wait(120);
    const persistedBarcodes = selected.filter((input) => normalize(input.value) === barcodeFallback);
    if (!selected.length) {
      return { status: 'failed', detail: '没有找到可填写的必填条形码输入框' };
    }
    if (!persistedBarcodes.length) {
      return { status: 'failed', detail: '已定位条形码输入框，但页面未保留填入的13个0' };
    }
    return {
      status: 'ready',
      detail: '已填写条形码' + persistedBarcodes.length + '项，SKU净含量改由真实鼠标键盘事件填写'
    };
    let completedSkuWeights = 0;
    for (const trigger of skuWeightInputs) {
      trigger.click();
      await wait(120);
      const quantityInput = Array.from(document.querySelectorAll('input'))
        .find((input) => input instanceof HTMLInputElement && visible(input) && !input.disabled
          && /请输入数量/u.test(input.placeholder || '') && !normalize(input.value));
      if (!(quantityInput instanceof HTMLInputElement)) continue;
      fill(quantityInput, skuWeightNumber);
      await wait(60);
      const unitControl = Array.from(document.querySelectorAll('select, [role="combobox"], input, button, [role="button"], span, div'))
        .filter(visible)
        .find((element) => {
          const placeholder = element instanceof HTMLInputElement ? element.placeholder : '';
          return /请选择单位/u.test(placeholder) || normalize(element.textContent) === '请选择单位';
        });
      if (!(unitControl instanceof HTMLElement)) continue;
      if (unitControl instanceof HTMLSelectElement) {
        const option = Array.from(unitControl.options).find((candidate) => /^(?:g|克)$/u.test(normalize(candidate.textContent)));
        if (!option) continue;
        unitControl.value = option.value;
        unitControl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        unitControl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      } else {
        unitControl.click();
        await wait(120);
        const unitOption = Array.from(document.querySelectorAll('[role="option"], li, button, [role="button"], span, div'))
          .filter((element) => visible(element) && /^(?:g|克)$/u.test(normalize(element.textContent)))
          .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
          })[0];
        if (!(unitOption instanceof HTMLElement)) continue;
        unitOption.click();
      }
      await wait(100);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      await wait(100);
      completedSkuWeights += 1;
    }
    return {
      status: 'ready',
      detail: '已填写条形码' + selected.length + '项，SKU净含量' + completedSkuWeights + '项'
    };
  })()`;
}
function buildNextSkuWeightTriggerExpression() {
    return `(() => { // QUALIFICATION_NEXT_SKU_WEIGHT_TRIGGER
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const headers = Array.from(document.querySelectorAll('th, [role="columnheader"], body span, body div'))
      .filter((element) => {
        const rawText = normalize(element.textContent);
        const text = rawText.replace(/[\\s：:*＊]/gu, '');
        if (!/^(?:总净含量|净含量|克重)(?:重要)?$/u.test(text) || !visible(element)) return false;
        let required = /[*＊]/u.test(rawText);
        let current = element;
        for (let depth = 0; current instanceof HTMLElement && depth < 6; depth += 1) {
          if (
            current.classList.contains('required')
            || current.getAttribute('aria-required') === 'true'
            || current.getAttribute('data-required') === 'true'
          ) {
            required = true;
            break;
          }
          if (current.classList.contains('sell-sku-head-cell')) break;
          current = current.parentElement;
        }
        return required;
      })
      .sort((left, right) => left.getBoundingClientRect().width - right.getBoundingClientRect().width);
    const headerCells = [];
    for (const header of headers) {
      const cell = header.closest('.sell-sku-head-cell, th, [role="columnheader"]') || header;
      if (!headerCells.includes(cell)) headerCells.push(cell);
    }
    const inputs = Array.from(document.querySelectorAll('input'))
      .filter((input) => input instanceof HTMLInputElement && visible(input) && !input.disabled
        && !normalize(input.value) && normalize(input.placeholder) === '规格'
        && input.dataset.workbenchSkuWeightAttempted !== '1');
    const targets = [];
    for (const header of headerCells) {
      const headerRect = header.getBoundingClientRect();
      const headerCenter = headerRect.left + headerRect.width / 2;
      const matches = inputs
        .filter((input) => {
          const rect = input.getBoundingClientRect();
          const center = rect.left + rect.width / 2;
          return rect.top >= headerRect.bottom - 8
            && Math.abs(center - headerCenter) <= Math.max(48, headerRect.width / 2);
        });
      for (const input of matches) if (!targets.includes(input)) targets.push(input);
    }
    targets.sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
    const target = targets[0];
    if (target instanceof HTMLInputElement) {
      document.querySelectorAll('[data-workbench-sku-weight-current]').forEach((element) => {
        delete element.dataset.workbenchSkuWeightCurrent;
      });
      target.dataset.workbenchSkuWeightAttempted = '1';
      target.dataset.workbenchSkuWeightCurrent = '1';
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = target.getBoundingClientRect();
      return {
        status: 'ready',
        detail: '找到待填写的SKU克重，剩余' + targets.length + '项',
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        remaining: Math.max(0, targets.length - 1)
      };
    }
    return { status: 'missing', detail: '没有待填写的SKU克重' };
  })()`;
}
function buildResetSkuWeightProgressExpression() {
    return `(() => { // QUALIFICATION_RESET_SKU_WEIGHT_PROGRESS
    delete document.body.dataset.workbenchSkuWeightProcessedIndexes;
    document.querySelectorAll('[data-workbench-sku-weight-attempted]').forEach((element) => {
      delete element.dataset.workbenchSkuWeightAttempted;
      delete element.dataset.workbenchSkuWeightCurrent;
      delete element.dataset.workbenchSkuWeightCommitted;
    });
    return { status: 'ready', detail: '已重置SKU克重填写进度' };
  })()`;
}
function buildResetSkuProductProgressExpression() {
    return `(() => { // QUALIFICATION_RESET_SKU_PRODUCT_PROGRESS
    delete document.body.dataset.workbenchSkuProductMissingBefore;
    delete document.body.dataset.workbenchSkuProductCurrentCellId;
    delete document.body.dataset.workbenchSkuProductFallbackSearchTerm;
    document.querySelectorAll('[data-workbench-sku-product-attempted]').forEach((element) => {
      delete element.dataset.workbenchSkuProductAttempted;
      delete element.dataset.workbenchSkuProductCurrent;
    });
    return { status: 'ready', detail: '已重置SKU包含产品填写进度' };
  })()`;
}
function buildNextRequiredSkuProductTriggerExpression() {
    return `(() => { // QUALIFICATION_NEXT_REQUIRED_SKU_PRODUCT
    const normalize = (value) => String(value || '').replace(/\\s+/gu, '').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const productHeader = Array.from(document.querySelectorAll('.sell-sku-head-cell, th, [role="columnheader"]'))
      .find((element) => normalize(element.textContent).replace(/[：:*＊]/gu, '') === '包含产品'
        && visible(element));
    if (!(productHeader instanceof HTMLElement)) {
      return { status: 'missing', detail: '当前SKU没有“包含产品”列' };
    }
    let table = productHeader.parentElement;
    while (table && !table.querySelector('td.sell-sku-cell-skuCombineContent')) {
      table = table.parentElement;
    }
    const gridRoot = table || document;
    const cells = Array.from(gridRoot.querySelectorAll('td.sell-sku-cell-skuCombineContent'))
      .filter((cell) => cell instanceof HTMLElement
        && cell.dataset.workbenchSkuProductAttempted !== '1'
        && Array.from(cell.querySelectorAll('button, [role="button"]')).some((button) => {
          const text = normalize(button.textContent);
          return !button.disabled && button.getAttribute('aria-disabled') !== 'true'
            && (!text || /去填写|添加|设置/u.test(text));
        }));
    const targets = cells;
    if (!targets.length) {
      return { status: 'missing', detail: '没有需要填写的SKU包含产品' };
    }
    const target = targets[0];
    const row = target.closest('tr, [role="row"]');
    if (!(row instanceof HTMLElement)) {
      return { status: 'failed', detail: '无法定位必填SKU包含产品所在行' };
    }
    const detailCell = row.querySelector('td.sell-sku-cell-title');
    const trigger = Array.from(target.querySelectorAll('button, [role="button"]'))
      .find((button) => !button.disabled && button.getAttribute('aria-disabled') !== 'true')
      || (detailCell instanceof HTMLElement
      ? Array.from(detailCell.querySelectorAll('button, [role="button"]')).find((button) =>
        /去填写/u.test(normalize(button.textContent))
        && !button.disabled && button.getAttribute('aria-disabled') !== 'true')
      : null);
    if (!(trigger instanceof HTMLElement)) {
      return { status: 'failed', detail: '必填SKU包含产品入口不可用' };
    }
    document.querySelectorAll('[data-workbench-sku-product-current]').forEach((element) => {
      delete element.dataset.workbenchSkuProductCurrent;
    });
    target.dataset.workbenchSkuProductAttempted = '1';
    target.dataset.workbenchSkuProductCurrent = '1';
    document.body.dataset.workbenchSkuProductMissingBefore = String(targets.length);
    document.body.dataset.workbenchSkuProductCurrentCellId = target.id || '';
    trigger.scrollIntoView({ block: 'center', inline: 'nearest' });
    trigger.click();
    return {
      status: 'ready',
      detail: '找到待填写的必填SKU包含产品，准备选择店铺默认产品',
      remaining: Math.max(0, targets.length - 1)
    };
  })()`;
}
function buildRequiredSkuProductDetailTriggerExpression() {
    return `(() => { // QUALIFICATION_REQUIRED_SKU_PRODUCT_DETAIL_TRIGGER
    const normalize = (value) => String(value || '').replace(/\\s+/gu, '').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        && element.getAttribute('aria-hidden') !== 'true'
        && !element.classList.contains('slideOutRight');
    };
    const drawers = Array.from(document.querySelectorAll(
      '.sku-component-sku-detail-drawer, .sell-component-sku-combine-panel-drawer'
    )).filter(visible);
    const drawer = drawers[drawers.length - 1];
    if (!(drawer instanceof HTMLElement)) {
      return { status: 'waiting', detail: '正在等待SKU明细抽屉' };
    }
    const rows = Array.from(drawer.querySelectorAll('.sell-component-o-sku-combine-table tbody tr'));
    for (const row of rows) {
      const productInput = row.querySelector('input[role="combobox"]');
      const rawProductTitle = productInput instanceof HTMLInputElement
        ? String(productInput.getAttribute('aria-valuetext') || '').trim()
        : String(row.querySelector('em[title]')?.getAttribute('title') || '').trim();
      const productTitle = normalize(rawProductTitle);
      const countInput = Array.from(row.querySelectorAll('input')).find((input) =>
        input instanceof HTMLInputElement && input.placeholder === '请输入');
      if (productTitle && countInput instanceof HTMLInputElement) {
        if (Number(countInput.value) > 0) {
          const measurement = rawProductTitle.match(/(\\d+(?:\\.\\d+)?(?:kg|g|克|千克)(?:\\*\\d+包)?)/iu)?.[1] || '';
          if (measurement) document.body.dataset.workbenchSkuProductFallbackSearchTerm = measurement;
          return { status: 'ready', marker: 'complete', detail: 'SKU包含产品已经完整，无需重复添加' };
        }
        const rect = countInput.getBoundingClientRect();
        return { status: 'ready', marker: 'needs-count', detail: 'SKU包含产品缺少组合数，准备填写1', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      const searchInput = row.querySelector('input[placeholder="请输入条形码或关键词"]');
      if (searchInput instanceof HTMLInputElement && !searchInput.disabled) {
        const rect = searchInput.getBoundingClientRect();
        return { status: 'ready', marker: 'needs-search', detail: 'SKU包含产品需要选择产品', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    const add = Array.from(drawer.querySelectorAll('button, [role="button"]')).find((candidate) =>
      normalize(candidate.textContent) === '添加' && visible(candidate)
      && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true');
    if (!(add instanceof HTMLElement)) {
      return { status: 'failed', detail: 'SKU包含产品没有完整内容，也没有可用的“添加”按钮' };
    }
    const rect = add.getBoundingClientRect();
    return { status: 'ready', marker: 'needs-add', detail: 'SKU包含产品为空，准备添加', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
}
function buildSkuProductDetailAddExpression() {
    return `(() => { // QUALIFICATION_SKU_PRODUCT_DETAIL_ADD
    const visible = (element) => element instanceof HTMLElement
      && element.getBoundingClientRect().width > 0
      && element.getAttribute('aria-hidden') !== 'true';
    const drawers = Array.from(document.querySelectorAll(
      '.sku-component-sku-detail-drawer, .sell-component-sku-combine-panel-drawer'
    )).filter(visible);
    const drawer = drawers[drawers.length - 1];
    const button = drawer instanceof HTMLElement
      ? Array.from(drawer.querySelectorAll('button, [role="button"]')).find((candidate) =>
        String(candidate.textContent || '').replace(/\\s+/gu, '').trim() === '添加'
        && visible(candidate) && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true')
      : null;
    if (!(button instanceof HTMLElement)) {
      return { status: 'failed', detail: 'SKU包含产品面板没有可用的“添加”按钮' };
    }
    button.click();
    return { status: 'ready', detail: '已点击SKU包含产品“添加”按钮' };
  })()`;
}
function buildSkuProductSearchOpenExpression() {
    return `(() => { // QUALIFICATION_SKU_PRODUCT_SEARCH_OPEN
    const drawers = Array.from(document.querySelectorAll(
      '.sku-component-sku-detail-drawer, .sell-component-sku-combine-panel-drawer'
    )).filter((element) => element instanceof HTMLElement && element.getBoundingClientRect().width > 0);
    const drawer = drawers[drawers.length - 1];
    const input = drawer instanceof HTMLElement
      ? drawer.querySelector('input[placeholder="请输入条形码或关键词"]')
      : null;
    if (!(input instanceof HTMLInputElement) || input.disabled) {
      return { status: 'failed', detail: 'SKU包含产品面板没有可用的选择框' };
    }
    input.click();
    return { status: 'ready', detail: '已打开SKU包含产品选择框' };
  })()`;
}
function buildSkuProductDefaultOptionExpression() {
    return `(() => { // QUALIFICATION_SKU_PRODUCT_DEFAULT_OPTION
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const options = Array.from(document.querySelectorAll(
      '.sell-component-o-sku-combine-table-select-popup .item-block, .sell-component-o-sku-combine-table-select-popup .item-block-wap > *'
    )).filter(visible);
    const unique = options.filter((element, index) => !options.some((candidate, candidateIndex) =>
      candidateIndex < index && candidate.contains(element)));
    const option = unique[0];
    if (!(option instanceof HTMLElement)) {
      return { status: 'waiting', detail: '正在等待店铺默认包含产品' };
    }
    option.click();
    return { status: 'ready', detail: '已选择店铺默认包含产品' };
  })()`;
}
function buildSkuProductDetailConfirmExpression() {
    return `(() => { // QUALIFICATION_SKU_PRODUCT_DETAIL_CONFIRM
    const visible = (element) => element instanceof HTMLElement
      && element.getBoundingClientRect().width > 0
      && element.getAttribute('aria-hidden') !== 'true'
      && !element.classList.contains('slideOutRight');
    const drawers = Array.from(document.querySelectorAll(
      '.sku-component-sku-detail-drawer, .sell-component-sku-combine-panel-drawer'
    )).filter(visible);
    const drawer = drawers[drawers.length - 1];
    const button = drawer instanceof HTMLElement
      ? Array.from(drawer.querySelectorAll('button, [role="button"]')).find((candidate) =>
        String(candidate.textContent || '').replace(/\\s+/gu, '').trim() === '确定'
        && visible(candidate) && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true')
      : null;
    if (button instanceof HTMLElement) {
      button.click();
      return { status: 'ready', detail: '已点击SKU明细确定按钮' };
    }
    return { status: 'waiting', detail: '正在等待SKU明细确定按钮' };
  })()`;
}
function buildSkuProductDetailCancelExpression() {
    return `(() => { // QUALIFICATION_SKU_PRODUCT_DETAIL_CANCEL
    const drawers = Array.from(document.querySelectorAll(
      '.sku-component-sku-detail-drawer, .sell-component-sku-combine-panel-drawer'
    ))
      .filter((element) => element instanceof HTMLElement && element.getBoundingClientRect().width > 0
        && element.getAttribute('aria-hidden') !== 'true' && !element.classList.contains('slideOutRight'));
    const drawer = drawers[drawers.length - 1];
    const button = drawer instanceof HTMLElement
      ? Array.from(drawer.querySelectorAll('button, [role="button"]')).find((candidate) =>
        String(candidate.textContent || '').replace(/\\s+/gu, '').trim() === '取消'
        && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true')
      : null;
    if (!(button instanceof HTMLElement)) return { status: 'waiting', detail: '正在等待SKU明细取消按钮' };
    const rect = button.getBoundingClientRect();
    return { status: 'ready', detail: '已定位SKU明细取消按钮', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
}
function buildVerifySkuProductDetailCompleteExpression() {
    return `(() => { // QUALIFICATION_VERIFY_SKU_PRODUCT_DETAIL_COMPLETE
    const normalize = (value) => String(value || '').replace(/\\s+/gu, '').trim();
    const drawers = Array.from(document.querySelectorAll(
      '.sku-component-sku-detail-drawer, .sell-component-sku-combine-panel-drawer'
    ))
      .filter((element) => element instanceof HTMLElement && element.getBoundingClientRect().width > 0
        && element.getAttribute('aria-hidden') !== 'true' && !element.classList.contains('slideOutRight'));
    const drawer = drawers[drawers.length - 1];
    if (!(drawer instanceof HTMLElement)) return { status: 'waiting', detail: 'SKU明细抽屉尚未打开' };
    const rows = Array.from(drawer.querySelectorAll('.sell-component-o-sku-combine-table tbody tr'));
    const complete = rows.some((row) => {
      const productInput = row.querySelector('input[role="combobox"]');
      const productTitle = productInput instanceof HTMLInputElement
        ? normalize(productInput.getAttribute('aria-valuetext'))
        : normalize(row.querySelector('em[title]')?.getAttribute('title'));
      const countInput = Array.from(row.querySelectorAll('input')).find((input) =>
        input instanceof HTMLInputElement && input.placeholder === '请输入');
      return Boolean(productTitle) && countInput instanceof HTMLInputElement && Number(countInput.value) > 0;
    });
    if (complete) {
      return { status: 'ready', detail: 'SKU包含产品内容已完整' };
    }
    return { status: 'waiting', detail: 'SKU包含产品内容仍未填写完整' };
  })()`;
}
function buildMarkSkuProductProcessedExpression() {
    return `(() => { // QUALIFICATION_MARK_SKU_PRODUCT_PROCESSED
    document.querySelectorAll('[data-workbench-sku-product-current]').forEach((element) => {
      delete element.dataset.workbenchSkuProductCurrent;
    });
    delete document.body.dataset.workbenchSkuProductCurrentCellId;
    return { status: 'ready', detail: '已记录SKU包含产品检查结果' };
  })()`;
}
function buildCurrentSkuWeightTriggerPointExpression() {
    return `(() => { // QUALIFICATION_CURRENT_SKU_WEIGHT_TRIGGER_POINT
    const target = document.querySelector('input[data-workbench-sku-weight-current="1"]');
    if (!(target instanceof HTMLInputElement)) {
      return { status: 'missing', detail: '无法重新定位当前SKU克重单元格' };
    }
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    return {
      status: 'ready',
      detail: '已重新定位当前SKU克重单元格',
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  })()`;
}
function buildFillSkuWeightQuantityExpression() {
    return `(() => { // QUALIFICATION_FILL_SKU_WEIGHT_QUANTITY
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const quantityInput = Array.from(document.querySelectorAll('input'))
      .find((input) => input instanceof HTMLInputElement && visible(input) && !input.disabled
        && /请输入数量/u.test(input.placeholder || ''));
    if (!(quantityInput instanceof HTMLInputElement)) {
      return { status: 'missing', detail: '没有找到SKU克重数量输入框' };
    }

    const popover = Array.from(document.querySelectorAll('body *'))
      .filter((element) => visible(element) && element.contains(quantityInput)
        && /请选择单位/u.test(normalize(element.textContent)))
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
      })[0];
    const searchRoot = popover instanceof HTMLElement ? popover : document.body;
    const unitControl = Array.from(searchRoot.querySelectorAll('select, [role="combobox"], input, button, [role="button"], span, div'))
      .filter(visible)
      .find((element) => {
        const placeholder = element instanceof HTMLInputElement ? element.placeholder : '';
        return /请选择单位/u.test(placeholder) || normalize(element.textContent) === '请选择单位';
      });
    if (!(unitControl instanceof HTMLElement)) {
      return { status: 'missing', detail: '没有找到SKU克重单位选择框' };
    }
    // Tmall's quantity field is React-controlled. Use the native prototype
    // setter so React's value tracker still observes a change, then dispatch
    // the same input/change events as a real edit. Private component methods
    // only changed the visible editor and did not persist the SKU value.
    quantityInput.focus({ preventScroll: true });
    quantityInput.select();
    const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (typeof nativeValueSetter !== 'function') {
      return { status: 'failed', detail: 'SKU净含量数量输入框不支持原生赋值' };
    }
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: '5',
      inputType: 'insertText'
    });
    quantityInput.dispatchEvent(beforeInput);
    nativeValueSetter.call(quantityInput, '5');
    const valueTracker = quantityInput._valueTracker;
    if (valueTracker && typeof valueTracker.setValue === 'function') {
      valueTracker.setValue('');
    }
    quantityInput.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: '5',
      inputType: 'insertText'
    }));
    quantityInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    const quantityRect = quantityInput.getBoundingClientRect();
    const unitRect = unitControl.getBoundingClientRect();
    return {
      status: 'ready',
      marker: 'quantity-state-dispatched',
      detail: '已提交SKU净含量数量5并定位单位选择框',
      x: quantityRect.left + quantityRect.width / 2,
      y: quantityRect.top + quantityRect.height / 2,
      unitX: unitRect.left + unitRect.width / 2,
      unitY: unitRect.top + unitRect.height / 2
    };
  })()`;
}
function buildFillSkuWeightUnitExpression() {
    return `(() => { // QUALIFICATION_FILL_SKU_WEIGHT_UNIT
    const quantityInput = Array.from(document.querySelectorAll('input'))
      .find((input) => input instanceof HTMLInputElement
        && input.placeholder === '\\u8bf7\\u8f93\\u5165\\u6570\\u91cf');
    if (!(quantityInput instanceof HTMLInputElement)) {
      return { status: 'failed', detail: 'SKU净含量数量编辑器已意外关闭' };
    }
    const internalKey = Object.getOwnPropertyNames(quantityInput)
      .find((key) => key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$'));
    let fiber = internalKey ? quantityInput[internalKey] : null;
    while (fiber) {
      const component = fiber.stateNode;
      const componentName = fiber.type && (fiber.type.displayName || fiber.type.name);
      if (componentName === 'SellMeasurementSalePropsItem'
        && component && typeof component.handleChange === 'function') {
        const structItems = Array.isArray(component.props && component.props.structItems)
          ? component.props.structItems
          : [];
        const unitIndex = structItems.findIndex((item) => item && item.isUnit);
        const unitItem = structItems[unitIndex];
        const gramOption = unitItem && Array.isArray(unitItem.dataSource)
          ? unitItem.dataSource.find((option) => String(option && option.text || '').trim().toLowerCase() === 'g')
          : null;
        if (!unitItem || !gramOption) {
          return { status: 'failed', detail: 'SKU净含量单位列表没有g选项' };
        }
        try {
          component.handleChange(unitItem.name, gramOption, unitIndex);
        } catch (error) {
          return {
            status: 'failed',
            detail: 'SKU净含量单位填写失败：' + String(error && error.message || error || 'unknown')
          };
        }
        return {
          status: 'ready',
          marker: 'direct-unit-complete',
          detail: 'SKU净含量单位已选择g'
        };
      }
      fiber = fiber.return;
    }
    return { status: 'failed', detail: 'SKU净含量单位编辑组件不存在' };
  })()`;
}
function buildReassertSkuWeightQuantityExpression() {
    return `(() => { // QUALIFICATION_REASSERT_SKU_WEIGHT_QUANTITY
    const quantityInput = Array.from(document.querySelectorAll('input')).find((input) => {
      if (!(input instanceof HTMLInputElement) || input.disabled) return false;
      const rect = input.getBoundingClientRect();
      const style = getComputedStyle(input);
      return /请输入数量/u.test(input.placeholder || '')
        && rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
    });
    if (!(quantityInput instanceof HTMLInputElement)) {
      return { status: 'missing', detail: '选择g后没有找到SKU克重数量输入框' };
    }
    const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (typeof nativeValueSetter !== 'function') {
      return { status: 'failed', detail: 'SKU净含量数量输入框不支持原生赋值' };
    }
    quantityInput.focus({ preventScroll: true });
    quantityInput.select();
    nativeValueSetter.call(quantityInput, '5');
    const valueTracker = quantityInput._valueTracker;
    if (valueTracker && typeof valueTracker.setValue === 'function') valueTracker.setValue('');
    quantityInput.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: '5',
      inputType: 'insertText'
    }));
    quantityInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return { status: 'ready', detail: '选择g后已重新确认SKU净含量数量5' };
  })()`;
}
function buildVerifySkuWeightQuantityExpression() {
    return `(() => { // QUALIFICATION_VERIFY_SKU_WEIGHT_QUANTITY
    const quantityInput = Array.from(document.querySelectorAll('input'))
      .find((input) => input instanceof HTMLInputElement
        && input.placeholder === '\\u8bf7\\u8f93\\u5165\\u6570\\u91cf');
    if (!(quantityInput instanceof HTMLInputElement)) {
      return { status: 'failed', detail: 'SKU净含量数量编辑器已意外关闭' };
    }
    if (String(quantityInput.value || '').trim() !== '5') {
      return {
        status: 'failed',
        detail: 'SKU净含量数量没有稳定填写为5，当前值：'
          + (String(quantityInput.value || '').trim() || '空')
      };
    }
    return { status: 'ready', detail: 'SKU净含量数量已填写为5' };
  })()`;
}
function buildCloseSkuWeightEditorExpression() {
    return `(() => { // QUALIFICATION_CLOSE_SKU_WEIGHT_EDITOR
    const quantityInput = Array.from(document.querySelectorAll('input'))
      .find((input) => input instanceof HTMLInputElement
        && input.placeholder === '\\u8bf7\\u8f93\\u5165\\u6570\\u91cf');
    if (!(quantityInput instanceof HTMLInputElement)) {
      return { status: 'ready', detail: 'SKU净含量编辑器已经关闭' };
    }
    const internalKey = Object.getOwnPropertyNames(quantityInput)
      .find((key) => key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$'));
    let fiber = internalKey ? quantityInput[internalKey] : null;
    while (fiber) {
      const component = fiber.stateNode;
      const componentName = fiber.type && (fiber.type.displayName || fiber.type.name);
      if (componentName === 'SellMeasurementSalePropsItem'
        && component && typeof component.setState === 'function') {
        try {
          component.setState({ overlayVisible: false });
        } catch {
          // The value has already been committed; verification below is authoritative.
        }
        return { status: 'ready', detail: 'SKU净含量编辑器已关闭' };
      }
      fiber = fiber.return;
    }
    return { status: 'ready', detail: 'SKU净含量编辑器无需额外关闭' };
  })()`;
}
function buildOpenCurrentSkuWeightEditorExpression() {
    return `(() => { // QUALIFICATION_OPEN_CURRENT_SKU_WEIGHT_EDITOR
    const target = document.querySelector('input[data-workbench-sku-weight-current="1"]');
    if (!(target instanceof HTMLInputElement)) {
      return { status: 'missing', detail: '无法重新定位当前SKU克重单元格' };
    }
    const wrapper = target.closest('.fake-input-wrapper');
    if (!(wrapper instanceof HTMLElement)) {
      return { status: 'missing', detail: '当前SKU克重单元格没有编辑遮罩' };
    }
    const overlays = Array.from(wrapper.querySelectorAll('.overlay'));
    for (const overlay of overlays) {
      if (!(overlay instanceof HTMLElement)) continue;
      const handlerKey = Object.getOwnPropertyNames(overlay)
        .find((key) => key.startsWith('__reactEventHandlers$') || key.startsWith('__reactProps$'));
      const handlers = handlerKey ? overlay[handlerKey] : null;
      if (!handlers || typeof handlers.onClick !== 'function') continue;
      handlers.onClick({
        currentTarget: overlay,
        target: overlay,
        nativeEvent: {},
        preventDefault() {},
        stopPropagation() {}
      });
      return { status: 'ready', detail: '已打开SKU克重编辑器' };
    }
    return { status: 'missing', detail: '当前SKU克重遮罩没有可调用的编辑事件' };
  })()`;
}
function buildCompositeSkuWeightEditorExpression() {
    return `(() => { // QUALIFICATION_COMPOSITE_SKU_WEIGHT_EDITOR
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
        && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const quantityInput = Array.from(document.querySelectorAll('input[placeholder="单件净含量"]'))
      .find((input) => input instanceof HTMLInputElement && visible(input) && !input.disabled);
    if (!(quantityInput instanceof HTMLInputElement)) {
      return { status: 'missing', detail: '没有找到新版SKU单件净含量输入框' };
    }
    const editorRoot = quantityInput.closest('.item-container, [class*="item-container"], [class*="measurement" i]')
      || quantityInput.parentElement?.parentElement?.parentElement;
    const unitControl = editorRoot instanceof HTMLElement
      ? Array.from(editorRoot.querySelectorAll('input[placeholder="单位"]'))
        .find((input) => input instanceof HTMLInputElement && visible(input) && !input.disabled)
      : null;
    if (!(unitControl instanceof HTMLInputElement)) {
      return { status: 'missing', detail: '没有找到新版SKU净含量单位选择框' };
    }
    quantityInput.focus({ preventScroll: true });
    quantityInput.select();
    const inserted = document.execCommand('insertText', false, '5');
    if (!inserted || quantityInput.value !== '5') {
      return { status: 'missing', detail: '新版SKU单件净含量没有稳定填写为5' };
    }
    const quantityRect = quantityInput.getBoundingClientRect();
    const unitRect = unitControl.getBoundingClientRect();
    return {
      status: 'ready',
      detail: '已定位新版SKU单件净含量和单位输入框',
      x: quantityRect.left + quantityRect.width / 2,
      y: quantityRect.top + quantityRect.height / 2,
      unitX: unitRect.left + unitRect.width / 2,
      unitY: unitRect.top + unitRect.height / 2
    };
  })()`;
}
function buildCompositeSkuCountExpression() {
    return `(() => { // QUALIFICATION_COMPOSITE_SKU_COUNT
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
        && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const quantityInput = Array.from(document.querySelectorAll('input[placeholder="单件净含量"]'))
      .find((input) => input instanceof HTMLInputElement && visible(input) && !input.disabled);
    const editorRoot = quantityInput instanceof HTMLInputElement
      ? quantityInput.closest('.item-container, [class*="item-container"], [class*="measurement" i]')
        || quantityInput.parentElement?.parentElement?.parentElement
      : null;
    const countInput = editorRoot instanceof HTMLElement
      ? Array.from(editorRoot.querySelectorAll('input[placeholder="数量"]'))
        .find((input) => input instanceof HTMLInputElement && visible(input) && !input.disabled)
      : null;
    if (!(countInput instanceof HTMLInputElement)) {
      return { status: 'missing', detail: '没有找到新版SKU包装数量输入框' };
    }
    const unitControls = Array.from(editorRoot.querySelectorAll('input[placeholder="单位"]'))
      .filter((input) => input instanceof HTMLInputElement && visible(input) && !input.disabled);
    const unitControl = unitControls[unitControls.length - 1];
    if (!(unitControl instanceof HTMLInputElement)) {
      return { status: 'missing', detail: '没有找到新版SKU包装单位选择框' };
    }
    countInput.focus({ preventScroll: true });
    countInput.select();
    const inserted = document.execCommand('insertText', false, '1');
    if (!inserted || countInput.value !== '1') {
      return { status: 'missing', detail: '新版SKU包装数量没有稳定填写为1' };
    }
    const countRect = countInput.getBoundingClientRect();
    const unitRect = unitControl.getBoundingClientRect();
    return {
      status: 'ready',
      detail: '已定位新版SKU包装数量和单位输入框',
      x: countRect.left + countRect.width / 2,
      y: countRect.top + countRect.height / 2,
      unitX: unitRect.left + unitRect.width / 2,
      unitY: unitRect.top + unitRect.height / 2
    };
  })()`;
}
function buildSkuPackageUnitOptionExpression() {
    return `(() => { // QUALIFICATION_SKU_PACKAGE_UNIT_OPTION
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
        && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const candidates = Array.from(document.querySelectorAll('.options-item, [role="option"], li'))
      .filter((element) => visible(element)
        && String(element.getAttribute('title') || element.textContent || '').replace(/\\s+/gu, '').trim() === '包')
      .sort((left, right) => {
        const leftPriority = left.classList.contains('options-item') ? 0 : 1;
        const rightPriority = right.classList.contains('options-item') ? 0 : 1;
        return leftPriority - rightPriority;
      });
    const option = candidates[0];
    if (!(option instanceof HTMLElement)) {
      return { status: 'missing', detail: 'SKU包装单位列表没有“包”选项' };
    }
    const rect = option.getBoundingClientRect();
    return {
      status: 'ready',
      detail: '已定位SKU包装单位“包”',
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  })()`;
}
function buildCurrentSkuWeightCommitPointExpression() {
    return `(() => { // QUALIFICATION_CURRENT_SKU_WEIGHT_COMMIT_POINT
    const target = document.querySelector('input[data-workbench-sku-weight-current="1"]');
    if (!(target instanceof HTMLInputElement)) {
      return { status: 'missing', detail: '无法定位当前SKU克重单元格' };
    }
    const quantityInput = Array.from(document.querySelectorAll('input')).find((input) => {
      if (!(input instanceof HTMLInputElement)) return false;
      const rect = input.getBoundingClientRect();
      return input.placeholder === '请输入数量' && input.value === '5'
        && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
    if (!(quantityInput instanceof HTMLInputElement)) {
      return { status: 'missing', detail: 'SKU克重数量没有稳定填写为5' };
    }
    const hasGramUnit = Array.from(document.querySelectorAll('input, select, button, span, div')).some((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const rawValue = element instanceof HTMLInputElement ? element.value
        : element instanceof HTMLSelectElement ? element.value
          : element.textContent;
      return String(rawValue || '').trim().toLowerCase() === 'g'
        && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
    if (!hasGramUnit) {
      return { status: 'missing', detail: 'SKU克重单位没有自动带出g' };
    }
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight) {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    const currentRect = target.getBoundingClientRect();
    return {
      status: 'ready',
      detail: '已重新定位当前SKU克重单元格',
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2
    };
  })()`;
}
function buildCurrentSkuWeightUnitControlExpression() {
    return `(() => { // QUALIFICATION_CURRENT_SKU_WEIGHT_UNIT_CONTROL
    const unitControl = Array.from(document.querySelectorAll('input')).find((input) => {
      if (!(input instanceof HTMLInputElement)) return false;
      const rect = input.getBoundingClientRect();
      return (input.placeholder === '请选择单位'
          || String(input.value || '').trim().toLowerCase() === 'g')
        && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
    if (!(unitControl instanceof HTMLInputElement)) {
      return { status: 'missing', detail: '没有找到当前SKU克重单位选择框' };
    }
    const rect = unitControl.getBoundingClientRect();
    return {
      status: 'ready',
      marker: String(unitControl.value || '').trim().toLowerCase() === 'g' ? 'complete' : undefined,
      detail: '已定位当前SKU克重单位选择框',
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  })()`;
}
function buildSkuWeightUnitOptionExpression() {
    return `(() => { // QUALIFICATION_SKU_WEIGHT_UNIT_OPTION
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
        && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const candidates = Array.from(document.querySelectorAll('.options-item, [role="option"], li'))
      .filter((element) => visible(element)
        && String(element.textContent || '').replace(/\\s+/gu, '').trim().toLowerCase() === 'g')
      .sort((left, right) => {
        const leftPriority = left.classList.contains('options-item') ? 0 : 1;
        const rightPriority = right.classList.contains('options-item') ? 0 : 1;
        return leftPriority - rightPriority;
      });
    const option = candidates[0];
    if (!(option instanceof HTMLElement)) {
      return { status: 'missing', detail: 'SKU克重单位列表没有g选项' };
    }
    option.click();
    return {
      status: 'clicked',
      detail: '已选择SKU克重单位g'
    };
  })()`;
}
function buildVerifySkuWeightCommitExpression() {
    return `(() => { // QUALIFICATION_VERIFY_SKU_WEIGHT_COMMIT
    const target = document.querySelector('input[data-workbench-sku-weight-current="1"]');
    if (!(target instanceof HTMLInputElement)) {
      return { status: 'missing', detail: '无法定位刚填写的SKU克重' };
    }
    const value = String(target.value || '').replace(/\\s+/gu, '').toLowerCase();
    if (!/^5(?:g|克)(?:\\*1包)?$/u.test(value)) {
      return { status: 'failed', detail: 'SKU克重未保存为5g，当前值：' + (value || '空') };
    }
    target.dataset.workbenchSkuWeightCommitted = '1';
    delete target.dataset.workbenchSkuWeightCurrent;
    return { status: 'ready', detail: 'SKU克重已保存为5g' };
  })()`;
}
function buildSubmitExpression() {
    return `(() => { // QUALIFICATION_SUBMIT
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const buttons = Array.from(document.querySelectorAll(
      '#struct-buttons button, .sell-float-bottom button, button, [role="button"]'
    ));
    const submit = buttons.find((button) => {
      const text = String(button.textContent || '').replace(/\\s+/gu, '').trim();
      const inMainSubmitBar = Boolean(button.closest('#struct-buttons, .sell-float-bottom'));
      const inDialog = Boolean(button.closest('[role="dialog"], .next-dialog, .ant-modal, .tm-dialog'));
      return text === '提交' && inMainSubmitBar && !inDialog
        && visible(button) && !button.classList.contains('hidden')
        && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    });
    if (!submit) return { status: 'missing', detail: '没有找到可用的提交按钮' };
    submit.click();
    return { status: 'clicked', detail: '已点击提交' };
  })()`;
}
function buildConfirmExpression() {
    return `(() => { // QUALIFICATION_CONFIRM
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .next-dialog, .ant-modal, .tm-dialog')).filter(visible);
    for (const dialog of dialogs) {
      const dialogText = String(dialog.textContent || '').replace(/\\s+/gu, '').trim();
      if (/确认退出|必填项.*未填写完整/u.test(dialogText)) continue;
      if (!/提交|发布|保存|商品属性信息更新|采纳/u.test(dialogText)) continue;
      const button = Array.from(dialog.querySelectorAll('button, [role="button"]')).find((candidate) => {
        const text = String(candidate.textContent || '').replace(/\\s+/gu, '').trim();
        return /^(确认|确定|继续提交|采纳|确认采纳)$/u.test(text) && visible(candidate)
          && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true';
      });
      if (button) { button.click(); return { status: 'clicked', detail: '已确认提交' }; }
    }
    return { status: 'waiting', detail: '当前没有待确认弹窗' };
  })()`;
}
function buildSubmitResultExpression(targetUrl) {
    return `(() => { // QUALIFICATION_SUBMIT_RESULT
    const targetUrl = ${JSON.stringify(targetUrl)};
    const text = String(document.body?.innerText || '').replace(/\\s+/gu, ' ').trim();
    const visibleMessages = Array.from(document.querySelectorAll(
      '[role="alert"], [class*="message"], [class*="Message"], [class*="toast"], [class*="Toast"], [class*="feedback"], [class*="Feedback"]'
    )).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map((element) => String(element.textContent || '').replace(/\\s+/gu, ' ').trim())
      .filter((value) => value.length > 0 && value.length <= 220);
    const feedback = visibleMessages.join(' | ').slice(0, 500);
    if (/CHK_FOOD_PRD_LICENSE_EXPIRED_INFO|生产许可证[^\\n]{0,120}(?:过期|失效)|许可证已过期/iu.test(text + ' ' + feedback)) {
      return { status: 'failed', detail: '许可证已过期，未上传，已跳过当前商品' };
    }
    const validationMessages = Array.from(document.querySelectorAll(
      '[role="alert"], [aria-invalid="true"], [class*="error-message" i], [class*="errorMessage"], [class*="form-item-help" i], [class*="feedback-content" i]'
    )).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map((element) => String(element.textContent || '').replace(/\\s+/gu, ' ').trim())
      .filter((value) => value.length <= 220 && /必填项未填|不能为空|请填写|校验失败/u.test(value));
    const validationDetail = Array.from(new Set(validationMessages)).join(' | ').slice(0, 500);
    const assistantRequiredMessages = Array.from(document.querySelectorAll(
      '.sell-component-assistant-error-v2-sub-content, .sell-component-assistant-error-v2-error-content, .error-content-title'
    )).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map((element) => String(element.textContent || '').replace(/\\s+/gu, ' ').trim())
      .filter((value) => value.length <= 220 && /必填项未填|不能为空|请填写|未填写完整/u.test(value));
    const assistantRequiredDetail = Array.from(new Set(assistantRequiredMessages)).join(' | ').slice(0, 500);
    const requiredSkuMessage = text.match(/SKU明细中[^。；]{0,120}(?:未填写完整|必填项未填)[^。；]{0,120}/u)?.[0]
      || text.match(/您以下必填项:[^，。；]{1,120}未填写完整/u)?.[0]
      || '';
    if (requiredSkuMessage) {
      return { status: 'failed', detail: requiredSkuMessage };
    }
    if (assistantRequiredDetail) {
      return { status: 'failed', detail: assistantRequiredDetail };
    }
    if (/提交失败|保存失败|发布失败|上传失败|请完善必填|校验失败|必填项未填|不能为空/u.test(feedback)
      || validationDetail) {
      return { status: 'failed', detail: validationDetail || feedback || '天猫页面存在未完成的必填项' };
    }
    if (/login|passport/iu.test(location.href)) return { status: 'login', detail: '当前店铺登录已失效' };
    if (/\\/punish/iu.test(location.href) || /访问拒绝|安全验证|滑块验证/u.test(text)) {
      return { status: 'challenge', detail: '天猫触发安全验证' };
    }
    if (/提交成功|保存成功|编辑成功|发布成功|修改成功/u.test(feedback)) {
      return { status: 'succeeded', detail: feedback };
    }
    if (location.href !== targetUrl && !location.href.startsWith('https://sell.publish.tmall.com/tmall/publish.htm')) {
      return { status: 'waiting', detail: '页面已离开商品编辑页，仍需明确响应或重新加载商品回读确认' };
    }
    return { status: 'waiting', detail: feedback || '等待天猫确认提交结果' };
  })()`;
}
function assertUsablePage(webContents) {
    if (webContents.isDestroyed()) {
        throw new TmallQualificationPublishError('PUBLISH_PAGE_CLOSED', '天猫商品编辑页已关闭');
    }
}
function isTmallPublishUrl(value) {
    try {
        const url = new URL(value);
        return url.origin === 'https://sell.publish.tmall.com'
            && url.pathname === '/tmall/publish.htm';
    }
    catch {
        return false;
    }
}
function isTmallPublishItemUrl(value, itemId) {
    try {
        const url = new URL(value);
        return isTmallPublishUrl(value) && url.searchParams.get('id') === itemId;
    }
    catch {
        return false;
    }
}
function isLoginUrl(value) {
    return /(?:login|passport)\.(?:taobao|tmall)\.com|\/member\/login/iu.test(value);
}
function isSecurityChallengeUrl(value) {
    return /\/punish|bixi\.alicdn\.com/iu.test(value);
}
function sanitizePlatformDetail(value) {
    return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 300);
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
