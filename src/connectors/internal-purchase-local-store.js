"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInternalPurchaseLocalStore = createInternalPurchaseLocalStore;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
function createInternalPurchaseLocalStore(input) {
    const rootDir = node_path_1.default.resolve(input.rootDir);
    const saveQueues = new Map();
    function resolveAccountLocation(accountId) {
        const normalizedAccountId = accountId.trim();
        if (!normalizedAccountId)
            throw new Error('Invalid internal purchase account id');
        const digest = (0, node_crypto_1.createHash)('sha256').update(normalizedAccountId, 'utf8').digest('hex');
        const directory = node_path_1.default.resolve(rootDir, digest);
        assertPathWithinRoot(rootDir, directory);
        return { digest, directory, snapshotPath: node_path_1.default.join(directory, 'store.json') };
    }
    async function loadSnapshot(accountId) {
        const { snapshotPath } = resolveAccountLocation(accountId);
        let serialized;
        try {
            serialized = await (0, promises_1.readFile)(snapshotPath, 'utf8');
        }
        catch (error) {
            if (isFileNotFoundError(error))
                return createEmptySnapshot();
            throw error;
        }
        try {
            const parsed = JSON.parse(serialized);
            if (!isSnapshot(parsed))
                throw new Error('Internal purchase local data is invalid');
            return parsed;
        }
        catch (error) {
            if (error instanceof Error && error.message === 'Internal purchase local data is invalid')
                throw error;
            throw new Error('Internal purchase local data is invalid', { cause: error });
        }
    }
    async function saveSnapshot(accountId, snapshot) {
        if (!isSnapshot(snapshot))
            throw new Error('Internal purchase local data is invalid');
        const { digest, directory, snapshotPath } = resolveAccountLocation(accountId);
        const previousSave = saveQueues.get(digest) ?? Promise.resolve();
        const queuedSave = previousSave
            .catch(() => undefined)
            .then(async () => {
            const temporaryPath = node_path_1.default.join(directory, `store.json.tmp-${(0, node_crypto_1.randomUUID)()}`);
            await (0, promises_1.mkdir)(directory, { recursive: true });
            try {
                await (0, promises_1.writeFile)(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
                    encoding: 'utf8',
                    mode: 0o600
                });
                const handle = await (0, promises_1.open)(temporaryPath, 'r+');
                try {
                    await handle.sync();
                }
                finally {
                    await handle.close();
                }
                await (0, promises_1.rename)(temporaryPath, snapshotPath);
            }
            catch (error) {
                await (0, promises_1.unlink)(temporaryPath).catch(() => undefined);
                throw error;
            }
        });
        saveQueues.set(digest, queuedSave);
        try {
            await queuedSave;
        }
        finally {
            if (saveQueues.get(digest) === queuedSave) {
                saveQueues.delete(digest);
            }
        }
    }
    return { loadSnapshot, saveSnapshot, resolveAccountLocation };
}
function createEmptySnapshot() {
    return {
        schemaVersion: 1,
        selectedStoreProfileId: null,
        selectedPlanId: null,
        plans: [],
        logs: []
    };
}
function isSnapshot(value) {
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.plans) || !Array.isArray(value.logs)) {
        return false;
    }
    if (!isNullableString(value.selectedStoreProfileId) || !isNullableString(value.selectedPlanId))
        return false;
    return value.plans.every((plan) => {
        if (!isRecord(plan))
            return false;
        return typeof plan.id === 'string' && typeof plan.storeProfileId === 'string' &&
            typeof plan.name === 'string' && typeof plan.description === 'string' &&
            typeof plan.startsAt === 'string' && typeof plan.endsAt === 'string' &&
            isScope(plan.scope) && isNumericKind(plan.threshold, ['none', 'amount', 'quantity']) &&
            isNumericKind(plan.discount, ['percentage', 'amount-off', 'fixed-price']) &&
            isRecord(plan.stacking) && typeof plan.stacking.storeCoupon === 'boolean' &&
            typeof plan.stacking.platformCoupon === 'boolean' && typeof plan.stacking.memberDiscount === 'boolean' &&
            (plan.audience === undefined || plan.audience === 'fans') &&
            (plan.skuDiscountRule === undefined || (isRecord(plan.skuDiscountRule) && typeof plan.skuDiscountRule.otherSkus === 'number' &&
                typeof plan.skuDiscountRule.lastSku === 'number')) &&
            ['draft', 'enabled', 'disabled'].includes(String(plan.status)) &&
            ['not-previewed', 'previewed', 'ready', 'creating', 'blocked', 'created', 'failed'].includes(String(plan.executionStatus)) &&
            isOptionalString(plan.lastPreviewedAt) && isOptionalString(plan.confirmedAt) &&
            isOptionalString(plan.platformActivityName) && isOptionalString(plan.platformCreatedAt) &&
            isOptionalString(plan.qrCodeDataUrl) &&
            typeof plan.createdAt === 'string' && typeof plan.updatedAt === 'string';
    }) && value.logs.every((log) => (isRecord(log) && typeof log.id === 'string' && typeof log.planId === 'string' &&
        typeof log.storeProfileId === 'string' &&
        ['created', 'saved-draft', 'previewed', 'confirmed-ready', 'enabled', 'disabled', 'create-started', 'create-blocked', 'created-online', 'create-failed'].includes(String(log.action)) &&
        ['pending', 'success', 'blocked', 'failed'].includes(String(log.status)) &&
        typeof log.message === 'string' && typeof log.createdAt === 'string'));
}
function isScope(value) {
    if (!isRecord(value))
        return false;
    if (value.kind === 'all-products')
        return true;
    if (value.kind === 'category')
        return typeof value.categoryName === 'string';
    return value.kind === 'selected-products' && Array.isArray(value.products) && value.products.every((product) => (isRecord(product) && typeof product.id === 'string' && typeof product.title === 'string' && isOptionalString(product.sku)));
}
function isNumericKind(value, kinds) {
    return isRecord(value) && kinds.includes(String(value.kind)) && typeof value.value === 'number';
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isNullableString(value) {
    return value === null || typeof value === 'string';
}
function isOptionalString(value) {
    return value === undefined || typeof value === 'string';
}
function assertPathWithinRoot(root, candidate) {
    const relative = node_path_1.default.relative(node_path_1.default.resolve(root), node_path_1.default.resolve(candidate));
    if (relative.startsWith('..') || node_path_1.default.isAbsolute(relative)) {
        throw new Error('Resolved path escapes the internal purchase local store');
    }
}
function isFileNotFoundError(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
