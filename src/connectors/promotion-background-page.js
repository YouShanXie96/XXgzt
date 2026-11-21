"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isElectronNavigationAbort = isElectronNavigationAbort;
exports.createPromotionBackgroundPagePool = createPromotionBackgroundPagePool;
function isElectronNavigationAbort(error) {
    if (!error || typeof error !== 'object')
        return false;
    const value = error;
    return value.code === 'ERR_ABORTED'
        || value.errno === -3
        || (typeof value.message === 'string' && /\bERR_ABORTED\b(?:\s*\(-3\))?/i.test(value.message));
}
function createPromotionBackgroundPagePool(input) {
    const pages = new Map();
    const startups = new Map();
    const startupTimeoutMs = Math.max(1, input.startupTimeoutMs ?? 45_000);
    async function runStartupStep(operation) {
        let timeout;
        try {
            return await Promise.race([
                operation,
                new Promise((_resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error(`天猫推广后台页面启动超过 ${Math.ceil(startupTimeoutMs / 1_000)} 秒，请重试同步`)), startupTimeoutMs);
                })
            ]);
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
        }
    }
    async function acquire(key, profileId) {
        const normalizedKey = key.trim();
        const normalizedProfileId = profileId.trim();
        if (!normalizedKey || !normalizedProfileId) {
            throw new Error('Invalid promotion background page key');
        }
        const pending = startups.get(normalizedKey);
        if (pending)
            return pending;
        const existing = pages.get(normalizedKey);
        if (existing && !input.isDestroyed(existing)) {
            try {
                await runStartupStep(input.waitUntilReady(existing));
                return existing;
            }
            catch (error) {
                if (pages.get(normalizedKey) === existing)
                    pages.delete(normalizedKey);
                if (!input.isDestroyed(existing))
                    input.closePage(existing);
                throw error;
            }
        }
        if (existing)
            pages.delete(normalizedKey);
        const startup = (async () => {
            const page = input.createPage(normalizedProfileId);
            pages.set(normalizedKey, page);
            input.onClosed(page, () => {
                if (pages.get(normalizedKey) === page)
                    pages.delete(normalizedKey);
            });
            try {
                try {
                    await runStartupStep(input.loadPage(page));
                }
                catch (error) {
                    if (!input.ignoreLoadError?.(page, error))
                        throw error;
                }
                await runStartupStep(input.waitUntilReady(page));
                return page;
            }
            catch (error) {
                if (pages.get(normalizedKey) === page)
                    pages.delete(normalizedKey);
                if (!input.isDestroyed(page))
                    input.closePage(page);
                throw error;
            }
            finally {
                startups.delete(normalizedKey);
            }
        })();
        startups.set(normalizedKey, startup);
        return startup;
    }
    function release(key) {
        const normalizedKey = key.trim();
        const page = pages.get(normalizedKey);
        pages.delete(normalizedKey);
        startups.delete(normalizedKey);
        if (page && !input.isDestroyed(page))
            input.closePage(page);
    }
    function dispose() {
        const activePages = [...pages.values()];
        pages.clear();
        startups.clear();
        for (const page of activePages) {
            if (!input.isDestroyed(page))
                input.closePage(page);
        }
    }
    return { acquire, release, dispose };
}
