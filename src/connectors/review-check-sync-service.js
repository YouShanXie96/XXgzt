"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewCheckSyncError = void 0;
exports.runReviewCheckPagedSync = runReviewCheckPagedSync;
class ReviewCheckSyncError extends Error {
    code;
    constructor(code) {
        super(code);
        this.name = 'ReviewCheckSyncError';
        this.code = code;
    }
}
exports.ReviewCheckSyncError = ReviewCheckSyncError;
async function runReviewCheckPagedSync(input) {
    const concurrency = Math.max(1, Math.min(3, input.concurrency ?? 3));
    const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
    const wait = input.wait ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    const now = input.now ?? Date.now;
    const startedAtMs = now();
    const startedAt = new Date(startedAtMs).toISOString();
    const startPage = Math.max(1, input.checkpoint.nextPage || 1);
    const records = new Map();
    const knownRecordKeys = new Set(input.knownRecordKeys ?? []);
    const newlyDiscoveredKeys = new Set();
    const failedPages = [];
    let completedPages = Math.min(input.checkpoint.completedPages, startPage - 1);
    let totalPages;
    let loginExpired = false;
    const emitProgress = () => {
        input.onProgress?.({
            completedPages,
            totalPages,
            recordCount: input.checkpoint.recordCount + newlyDiscoveredKeys.size,
            failedCount: failedPages.length,
            elapsedMs: Math.max(0, now() - startedAtMs)
        });
    };
    const fetchWithRetry = async (page) => {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const result = await input.fetchPage(page);
                if (!result || result.page !== page || !Number.isInteger(result.totalPages) || result.totalPages < page
                    || !Array.isArray(result.records)) {
                    throw new ReviewCheckSyncError('EMPTY_RESPONSE');
                }
                return result;
            }
            catch (error) {
                if (error instanceof ReviewCheckSyncError && error.code === 'LOGIN_EXPIRED') {
                    loginExpired = true;
                    return undefined;
                }
                if (attempt === maxAttempts) {
                    failedPages.push({
                        page,
                        attempts: attempt,
                        message: error instanceof ReviewCheckSyncError ? error.code : 'PAGE_REQUEST_FAILED'
                    });
                    emitProgress();
                    return undefined;
                }
                await wait(200 * (2 ** (attempt - 1)));
            }
        }
        return undefined;
    };
    const acceptPage = (result) => {
        totalPages = Math.max(totalPages ?? 0, result.totalPages);
        for (const record of result.records) {
            const key = input.keyOf(record);
            records.set(key, record);
            if (!knownRecordKeys.has(key))
                newlyDiscoveredKeys.add(key);
        }
        completedPages += 1;
        emitProgress();
    };
    const first = await fetchWithRetry(startPage);
    if (loginExpired)
        return finish('login-expired');
    if (!first)
        return finish(input.checkpoint.completedPages ? 'partial' : 'failed');
    acceptPage(first);
    const remaining = Array.from({ length: Math.max(0, first.totalPages - startPage) }, (_, index) => startPage + index + 1);
    for (let offset = 0; offset < remaining.length && !loginExpired; offset += concurrency) {
        const batch = remaining.slice(offset, offset + concurrency);
        const results = await Promise.all(batch.map((page) => fetchWithRetry(page)));
        for (const result of results) {
            if (result)
                acceptPage(result);
        }
    }
    if (loginExpired)
        return finish('login-expired');
    return finish(failedPages.length ? 'partial' : 'completed');
    function finish(status) {
        const elapsedMs = Math.max(0, now() - startedAtMs);
        const sortedFailures = [...failedPages].sort((left, right) => left.page - right.page);
        const nextPage = status === 'completed'
            ? (totalPages ?? startPage) + 1
            : (sortedFailures[0]?.page ?? startPage);
        const checkpoint = {
            status,
            range: input.checkpoint.range,
            nextPage,
            completedPages,
            totalPages,
            recordCount: input.checkpoint.recordCount + newlyDiscoveredKeys.size,
            failedPages: sortedFailures,
            startedAt,
            finishedAt: new Date(now()).toISOString(),
            elapsedMs
        };
        emitProgress();
        return { records: [...records.values()], checkpoint };
    }
}
