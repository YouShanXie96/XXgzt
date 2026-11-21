"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReviewCheckLocalStore = createReviewCheckLocalStore;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const review_check_closed_orders_1 = require("./review-check-closed-orders");
const digest = (value) => (0, node_crypto_1.createHash)('sha256').update(value, 'utf8').digest('hex');
function createReviewCheckLocalStore(input) {
    const rootDir = node_path_1.default.resolve(input.rootDir);
    const cache = new Map();
    const resolveLocation = (accountId, profileId) => {
        const normalizedAccountId = accountId.trim();
        const normalizedProfileId = profileId.trim();
        if (!normalizedAccountId || !normalizedProfileId)
            throw new Error('Invalid review-check storage scope');
        const accountDigest = digest(normalizedAccountId);
        const profileDigest = digest(normalizedProfileId);
        const directory = node_path_1.default.resolve(rootDir, accountDigest, 'stores', profileDigest);
        assertWithinRoot(rootDir, directory);
        return {
            accountDigest,
            profileDigest,
            directory,
            snapshotPath: node_path_1.default.join(directory, 'store.json')
        };
    };
    const cacheKey = (accountId, profileId) => {
        const location = resolveLocation(accountId, profileId);
        return `${location.accountDigest}:${location.profileDigest}`;
    };
    const loadSnapshot = async (accountId, profileId) => {
        const key = cacheKey(accountId, profileId);
        const cached = cache.get(key);
        if (cached)
            return cached;
        const { snapshotPath } = resolveLocation(accountId, profileId);
        try {
            const parsed = JSON.parse(await (0, promises_1.readFile)(snapshotPath, 'utf8'));
            if (!isSnapshot(parsed, profileId))
                throw new Error('Review-check local data is invalid');
            const sanitized = (0, review_check_closed_orders_1.pruneReviewCheckClosedOrders)(parsed);
            if (sanitized !== parsed)
                await saveSnapshot(accountId, profileId, sanitized);
            else
                cache.set(key, sanitized);
            return sanitized;
        }
        catch (error) {
            if (isFileNotFound(error)) {
                const empty = createEmptySnapshot(profileId);
                cache.set(key, empty);
                return empty;
            }
            if (error instanceof Error && error.message === 'Review-check local data is invalid')
                throw error;
            throw new Error('Review-check local data is invalid', { cause: error });
        }
    };
    const saveSnapshot = async (accountId, profileId, snapshot) => {
        if (!isSnapshot(snapshot, profileId))
            throw new Error('Review-check local data is invalid');
        const sanitized = (0, review_check_closed_orders_1.pruneReviewCheckClosedOrders)(snapshot);
        const key = cacheKey(accountId, profileId);
        const { directory, snapshotPath } = resolveLocation(accountId, profileId);
        const temporaryPath = node_path_1.default.join(directory, `store.json.tmp-${(0, node_crypto_1.randomUUID)()}`);
        await (0, promises_1.mkdir)(directory, { recursive: true });
        try {
            await (0, promises_1.writeFile)(temporaryPath, `${JSON.stringify(sanitized)}\n`, { encoding: 'utf8', mode: 0o600 });
            const handle = await (0, promises_1.open)(temporaryPath, 'r+');
            try {
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            await retryAtomicReplace(() => (0, promises_1.rename)(temporaryPath, snapshotPath));
            cache.set(key, sanitized);
        }
        catch (error) {
            await (0, promises_1.unlink)(temporaryPath).catch(() => undefined);
            throw error;
        }
    };
    const clearSnapshot = async (accountId, profileId) => {
        const key = cacheKey(accountId, profileId);
        const { snapshotPath } = resolveLocation(accountId, profileId);
        await (0, promises_1.unlink)(snapshotPath).catch((error) => {
            if (!isFileNotFound(error))
                throw error;
        });
        cache.delete(key);
    };
    return { loadSnapshot, saveSnapshot, clearSnapshot, resolveLocation };
}
function createEmptySnapshot(profileId) {
    const checkpoint = () => ({
        status: 'idle',
        nextPage: 1,
        completedPages: 0,
        recordCount: 0,
        failedPages: [],
        elapsedMs: 0
    });
    return {
        schemaVersion: 1,
        profileId,
        orders: [],
        reviews: [],
        matches: [],
        orderSync: checkpoint(),
        reviewSync: checkpoint(),
        updatedAt: new Date().toISOString()
    };
}
async function retryAtomicReplace(operation) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await operation();
            return;
        }
        catch (error) {
            const transient = Boolean(error && typeof error === 'object' && 'code' in error
                && ['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code)));
            if (!transient || attempt === 4)
                throw error;
            await new Promise((resolve) => setTimeout(resolve, 40 * (2 ** attempt)));
        }
    }
}
function assertWithinRoot(root, candidate) {
    const relative = node_path_1.default.relative(node_path_1.default.resolve(root), node_path_1.default.resolve(candidate));
    if (relative.startsWith('..') || node_path_1.default.isAbsolute(relative)) {
        throw new Error('Resolved path escapes the review-check local store');
    }
}
function isFileNotFound(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
function isSnapshot(value, profileId) {
    if (!value || typeof value !== 'object')
        return false;
    const snapshot = value;
    return snapshot.schemaVersion === 1
        && snapshot.profileId === profileId
        && Array.isArray(snapshot.orders)
        && Array.isArray(snapshot.reviews)
        && Array.isArray(snapshot.matches)
        && Boolean(snapshot.orderSync && typeof snapshot.orderSync === 'object')
        && Boolean(snapshot.reviewSync && typeof snapshot.reviewSync === 'object');
}
