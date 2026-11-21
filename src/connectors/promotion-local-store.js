"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPromotionRendererSnapshot = createPromotionRendererSnapshot;
exports.mergePromotionRendererSnapshot = mergePromotionRendererSnapshot;
exports.createPromotionLocalStore = createPromotionLocalStore;
exports.retryPromotionAtomicReplace = retryPromotionAtomicReplace;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const promotion_mode_control_1 = require("./promotion-mode-control");
const promotion_main_domain_1 = require("./promotion-main-domain");
function createPromotionRendererSnapshot(snapshot) {
    const latestDateByProfile = new Map();
    for (const daily of snapshot.control.dailySnapshots) {
        const latest = latestDateByProfile.get(daily.profileId);
        if (!latest || daily.date > latest)
            latestDateByProfile.set(daily.profileId, daily.date);
    }
    return {
        ...snapshot,
        control: {
            ...snapshot.control,
            dailySnapshots: snapshot.control.dailySnapshots.map((daily) => ({
                ...daily,
                campaigns: latestDateByProfile.get(daily.profileId) === daily.date
                    ? daily.campaigns
                    : summarizePromotionDay(daily.campaigns, daily.profileId, daily.date, daily.syncedAt)
            }))
        }
    };
}
function mergePromotionRendererSnapshot(stored, renderer) {
    const mergedControl = (0, promotion_main_domain_1.selectPromotionControlDateRange)({
        ...renderer.control,
        // Platform synchronization owns promotion facts and trust gates. A
        // renderer save may be queued from an older concurrent-store result, so
        // it must never overwrite a newer store sync or remove a profile that has
        // just completed the required full refresh.
        dailySnapshots: stored.control.dailySnapshots,
        lastSyncAt: stored.control.lastSyncAt,
        dataTrustVersion: Math.max(stored.control.dataTrustVersion ?? 1, renderer.control.dataTrustVersion ?? 1),
        fullSyncReadyProfileIds: stored.control.fullSyncReadyProfileIds ?? []
    });
    const merged = {
        ...renderer,
        control: mergedControl
    };
    return (stored.control.modeRevision ?? 0) > (renderer.control.modeRevision ?? 0)
        ? (0, promotion_mode_control_1.preservePromotionMode)(stored, merged) : merged;
}
function summarizePromotionDay(campaigns, profileId, date, syncedAt) {
    return ['product', 'store', 'keyword'].flatMap((channel) => {
        const channelCampaigns = campaigns.filter((campaign) => campaign.channel === channel);
        if (!channelCampaigns.length)
            return [];
        const spend = channelCampaigns.reduce((total, campaign) => total + campaign.spend, 0);
        const revenue = channelCampaigns.reduce((total, campaign) => total + campaign.revenue, 0);
        const sum = (key) => channelCampaigns.reduce((total, campaign) => {
            const value = campaign[key];
            return total + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
        }, 0);
        const sumFullyCovered = (key) => {
            if (channelCampaigns.some((campaign) => campaign[key] === undefined))
                return undefined;
            return sum(key);
        };
        const netRevenue = sumFullyCovered('netRevenue');
        const directNetRevenue = sumFullyCovered('directNetRevenue');
        return [{
                id: `summary:${profileId}:${date}:${channel}`,
                name: '每日汇总',
                itemId: null,
                itemName: '每日汇总',
                channel,
                groupId: null,
                groupName: '',
                status: 'unknown',
                dailyBudget: null,
                targetRoi: null,
                spend,
                roi: spend > 0 ? revenue / spend : 0,
                ...(netRevenue === undefined ? {} : {
                    netRevenue,
                    netRoi: spend > 0 ? netRevenue / spend : 0
                }),
                orders: sum('orders'),
                ...(sumFullyCovered('netOrders') === undefined ? {} : { netOrders: sum('netOrders') }),
                ...(directNetRevenue === undefined ? {} : {
                    directNetRevenue,
                    directNetRoi: spend > 0 ? directNetRevenue / spend : 0
                }),
                ...(sumFullyCovered('directNetOrders') === undefined ? {} : { directNetOrders: sum('directNetOrders') }),
                ...(sumFullyCovered('directOrders') === undefined ? {} : { directOrders: sum('directOrders') }),
                revenue,
                impressions: sum('impressions'),
                clicks: sum('clicks'),
                cartAdds: sum('cartAdds'),
                observedAt: syncedAt,
                dataStartDate: date,
                dataEndDate: date
            }];
    });
}
function mergePromotionStorageSnapshot(stored, incoming) {
    if (!stored)
        return incoming;
    const storedTrustVersion = stored.control.dataTrustVersion ?? 1;
    const incomingTrustVersion = incoming.control.dataTrustVersion ?? 1;
    if (storedTrustVersion !== incomingTrustVersion) {
        const trusted = incomingTrustVersion > storedTrustVersion ? incoming : stored;
        return {
            ...incoming,
            control: (0, promotion_main_domain_1.selectPromotionControlDateRange)({
                ...incoming.control,
                campaigns: trusted.control.campaigns,
                dailySnapshots: trusted.control.dailySnapshots,
                lastSyncAt: trusted.control.lastSyncAt,
                dataTrustVersion: trusted.control.dataTrustVersion,
                fullSyncReadyProfileIds: trusted.control.fullSyncReadyProfileIds ?? []
            })
        };
    }
    let dailySnapshots = incoming.control.dailySnapshots;
    if (stored.control.dailySnapshots !== incoming.control.dailySnapshots) {
        const dailyByKey = new Map(stored.control.dailySnapshots.map((daily) => [
            promotionDayKey(daily.profileId, daily.date),
            daily
        ]));
        for (const daily of incoming.control.dailySnapshots) {
            const key = promotionDayKey(daily.profileId, daily.date);
            const previous = dailyByKey.get(key);
            // A stale renderer/account snapshot must not replace a newer platform
            // read. Equal timestamps intentionally prefer the incoming object so a
            // point-in-time campaign status update can still be persisted.
            if (!previous || daily.syncedAt >= previous.syncedAt) {
                dailyByKey.set(key, daily);
            }
        }
        dailySnapshots = [...dailyByKey.values()].sort((left, right) => (left.profileId.localeCompare(right.profileId)
            || left.date.localeCompare(right.date)));
    }
    const readyProfileIds = [...new Set([
            ...(stored.control.fullSyncReadyProfileIds ?? []),
            ...(incoming.control.fullSyncReadyProfileIds ?? [])
        ])];
    const lastSyncAt = [stored.control.lastSyncAt, incoming.control.lastSyncAt]
        .filter((value) => Boolean(value))
        .sort()
        .at(-1) ?? null;
    return {
        ...incoming,
        control: (0, promotion_main_domain_1.selectPromotionControlDateRange)({
            ...incoming.control,
            dailySnapshots,
            lastSyncAt,
            dataTrustVersion: incomingTrustVersion,
            fullSyncReadyProfileIds: readyProfileIds
        })
    };
}
function hasSamePromotionPlatformState(stored, incoming) {
    const storedReady = stored.control.fullSyncReadyProfileIds ?? [];
    const incomingReady = incoming.control.fullSyncReadyProfileIds ?? [];
    return stored.control.lastSyncAt === incoming.control.lastSyncAt
        && (stored.control.dataTrustVersion ?? 1) === (incoming.control.dataTrustVersion ?? 1)
        && storedReady.length === incomingReady.length
        && storedReady.every((profileId) => incomingReady.includes(profileId));
}
function createPromotionLocalStore(input) {
    const rootDir = node_path_1.default.resolve(input.rootDir);
    const snapshotCache = new Map();
    const shardedAccounts = new Set();
    const accountWriteTails = new Map();
    const diagnosticWriteTails = new Map();
    function resolveDigestLocation(digest) {
        if (!/^[a-f0-9]{64}$/.test(digest)) {
            throw new Error('Invalid promotion account digest');
        }
        const directory = node_path_1.default.resolve(rootDir, digest);
        assertPathWithinRoot(rootDir, directory);
        return {
            digest,
            directory,
            snapshotPath: node_path_1.default.join(directory, 'store.json'),
            viewSnapshotPath: node_path_1.default.join(directory, 'store-view.json'),
            manifestPath: node_path_1.default.join(directory, 'shards-manifest.json'),
            shardsDirectory: node_path_1.default.join(directory, 'shards'),
            backupsDirectory: node_path_1.default.join(directory, 'backups'),
            diagnosticsDirectory: node_path_1.default.join(directory, 'diagnostics'),
            diagnosticsPath: node_path_1.default.join(directory, 'diagnostics', 'promotion-sync.jsonl')
        };
    }
    function resolveAccountLocation(accountId) {
        const normalizedAccountId = accountId.trim();
        if (!normalizedAccountId) {
            throw new Error('Invalid promotion account id');
        }
        const digest = (0, node_crypto_1.createHash)('sha256').update(normalizedAccountId, 'utf8').digest('hex');
        return resolveDigestLocation(digest);
    }
    async function resetMetricCache(location, snapshot) {
        const base = {
            ...snapshot,
            control: (0, promotion_main_domain_1.selectPromotionControlDateRange)({
                ...snapshot.control,
                mode: 'observe',
                storeModes: Object.fromEntries(snapshot.control.monitoredProfileIds.map((profileId) => [profileId, 'observe'])),
                campaigns: [],
                dailySnapshots: [],
                lastSyncAt: null,
                dataTrustVersion: promotion_main_domain_1.CURRENT_PROMOTION_DATA_TRUST_VERSION,
                fullSyncReadyProfileIds: []
            })
        };
        const rebuilt = snapshot.control.monitoredProfileIds.length || snapshot.control.rules.length
            ? (0, promotion_mode_control_1.changePromotionMode)(base, null, 'observe', 'cache-repair') : base;
        await removeMetricArtifacts(rootDir, location);
        await writePromotionJsonAtomic(location.directory, location.snapshotPath, {
            ...rebuilt,
            control: { ...rebuilt.control, campaigns: [], dailySnapshots: [] }
        });
        shardedAccounts.delete(location.digest);
        snapshotCache.delete(location.digest);
        return rebuilt;
    }
    async function initializeMissingStore(location) {
        let recoverable = (0, promotion_main_domain_1.createEmptyPromotionSnapshot)();
        try {
            const viewParsed = JSON.parse(await (0, promises_1.readFile)(location.viewSnapshotPath, 'utf8'));
            const viewSnapshot = (0, promotion_main_domain_1.migratePromotionSnapshot)(viewParsed);
            if (viewSnapshot)
                recoverable = viewSnapshot;
        }
        catch (error) {
            if (!isFileNotFoundError(error)) {
                // A renderer view is only a recovery source. If it is malformed, keep
                // rebuilding the missing control store instead of blocking startup.
            }
        }
        return await resetMetricCache(location, recoverable);
    }
    async function repairAllAccounts() {
        await (0, promises_1.mkdir)(rootDir, { recursive: true });
        const report = {
            scannedAccounts: 0,
            migratedAccounts: 0,
            initializedAccounts: 0,
            invalidAccounts: 0
        };
        const entries = await (0, promises_1.readdir)(rootDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name))
                continue;
            report.scannedAccounts += 1;
            const location = resolveDigestLocation(entry.name);
            let serialized;
            try {
                serialized = await (0, promises_1.readFile)(location.snapshotPath, 'utf8');
            }
            catch (error) {
                if (!isFileNotFoundError(error))
                    throw error;
                await initializeMissingStore(location);
                report.initializedAccounts += 1;
                continue;
            }
            let migrated = null;
            try {
                migrated = (0, promotion_main_domain_1.migratePromotionSnapshot)(JSON.parse(serialized));
            }
            catch {
                // A corrupt control store can contain rules and audit history, so keep
                // it untouched for manual recovery instead of silently replacing it.
                report.invalidAccounts += 1;
                continue;
            }
            if (!migrated) {
                report.invalidAccounts += 1;
                continue;
            }
            if ((migrated.control.dataTrustVersion ?? 1) < promotion_main_domain_1.CURRENT_PROMOTION_DATA_TRUST_VERSION) {
                // Do not hide filesystem failures here. If the repair cannot be
                // persisted, abort startup instead of letting the renderer consume a
                // partially repaired account and report a false successful migration.
                await resetMetricCache(location, migrated);
                report.migratedAccounts += 1;
            }
        }
        return report;
    }
    async function loadSnapshot(accountId) {
        const location = resolveAccountLocation(accountId);
        const { digest, snapshotPath, viewSnapshotPath } = location;
        const cached = snapshotCache.get(digest);
        if (cached)
            return cached;
        let serialized;
        try {
            serialized = await (0, promises_1.readFile)(snapshotPath, 'utf8');
        }
        catch (error) {
            if (isFileNotFoundError(error)) {
                const empty = await initializeMissingStore(location);
                snapshotCache.set(digest, empty);
                return empty;
            }
            throw error;
        }
        try {
            const parsed = JSON.parse(serialized);
            let migrated = (0, promotion_main_domain_1.migratePromotionSnapshot)(parsed);
            if (!migrated) {
                throw new Error('Promotion local data is invalid');
            }
            if ((migrated.control.dataTrustVersion ?? 1) < promotion_main_domain_1.CURRENT_PROMOTION_DATA_TRUST_VERSION) {
                const rebuilt = await resetMetricCache(location, migrated);
                snapshotCache.set(digest, rebuilt);
                return rebuilt;
            }
            const manifest = await readPromotionShardManifest(location.manifestPath);
            if (manifest) {
                const dailySnapshots = await loadPromotionDailyShards(location, manifest);
                migrated = {
                    ...migrated,
                    control: (0, promotion_main_domain_1.selectPromotionControlDateRange)({
                        ...migrated.control,
                        dailySnapshots
                    })
                };
                shardedAccounts.add(digest);
            }
            else {
                // Product facts written before the sharded item-level schema have no
                // provenance. Older builds could attach an entire campaign total to
                // the first product in that campaign, so never promote those values
                // into the trusted cache during migration. A following incremental
                // sync detects the missing product channel and refills it from the
                // official item-level export.
                migrated = {
                    ...migrated,
                    control: (0, promotion_main_domain_1.selectPromotionControlDateRange)({
                        ...migrated.control,
                        campaigns: migrated.control.campaigns.filter((campaign) => campaign.channel !== 'product'),
                        dailySnapshots: migrated.control.dailySnapshots.map((daily) => ({
                            ...daily,
                            campaigns: daily.campaigns.filter((campaign) => campaign.channel !== 'product')
                        }))
                    })
                };
            }
            if (manifest) {
                try {
                    const viewParsed = JSON.parse(await (0, promises_1.readFile)(viewSnapshotPath, 'utf8'));
                    const viewSnapshot = (0, promotion_main_domain_1.migratePromotionSnapshot)(viewParsed);
                    if (viewSnapshot) {
                        const merged = mergePromotionRendererSnapshot(migrated, viewSnapshot);
                        migrated = {
                            ...merged,
                            control: (0, promotion_main_domain_1.selectPromotionControlDateRange)(merged.control)
                        };
                    }
                }
                catch (viewError) {
                    if (!isFileNotFoundError(viewError))
                        throw viewError;
                }
            }
            else {
                // store-view.json is a renderer-only overlay for an existing shard
                // manifest. Without that manifest it is an orphan and must never
                // resurrect stale or all-zero campaign metrics after a repair.
                await (0, promises_1.unlink)(viewSnapshotPath).catch(() => undefined);
            }
            if (!(0, promotion_main_domain_1.isPromotionSnapshot)(migrated)) {
                throw new Error('Promotion local data is invalid');
            }
            snapshotCache.set(digest, migrated);
            return migrated;
        }
        catch (error) {
            if (error instanceof Error && error.message === 'Promotion local data is invalid') {
                throw error;
            }
            throw new Error('Promotion local data is invalid', { cause: error });
        }
    }
    async function saveSnapshotUnlocked(accountId, incoming, explicitModeChange = false) {
        const location = resolveAccountLocation(accountId);
        const { digest, directory, snapshotPath, viewSnapshotPath } = location;
        let cached = snapshotCache.get(digest);
        if (!cached) {
            try {
                await (0, promises_1.readFile)(snapshotPath, 'utf8');
                cached = await loadSnapshot(accountId);
            }
            catch (error) {
                if (!isFileNotFoundError(error))
                    throw error;
            }
        }
        const snapshot = mergePromotionStorageSnapshot(cached, cached && !explicitModeChange ? (0, promotion_mode_control_1.preservePromotionMode)(cached, incoming) : incoming);
        if (!(0, promotion_main_domain_1.isPromotionSnapshot)(snapshot)) {
            throw new Error('Promotion local data is invalid');
        }
        const viewOnly = Boolean(shardedAccounts.has(digest)
            && cached
            && cached.control.dailySnapshots === snapshot.control.dailySnapshots
            && hasSamePromotionPlatformState(cached, snapshot));
        await (0, promises_1.mkdir)(directory, { recursive: true });
        if (viewOnly) {
            const persistedView = {
                ...snapshot,
                control: { ...snapshot.control, campaigns: [], dailySnapshots: [] }
            };
            await writePromotionJsonAtomic(directory, viewSnapshotPath, persistedView);
            snapshotCache.set(digest, snapshot);
            return;
        }
        const previousManifest = await readPromotionShardManifest(location.manifestPath);
        const existingManifest = previousManifest
            ?? { schemaVersion: 1, profiles: {} };
        const previousByDay = new Map((cached?.control.dailySnapshots ?? []).map((daily) => [
            promotionDayKey(daily.profileId, daily.date),
            daily
        ]));
        const forceAll = !shardedAccounts.has(digest);
        const changedDays = snapshot.control.dailySnapshots.filter((daily) => {
            if (forceAll)
                return true;
            const previous = previousByDay.get(promotionDayKey(daily.profileId, daily.date));
            return !previous || previous !== daily || previous.syncedAt !== daily.syncedAt;
        });
        await persistPromotionDailyShards(location, existingManifest, snapshot, changedDays);
        const coreSnapshot = {
            ...snapshot,
            control: { ...snapshot.control, campaigns: [], dailySnapshots: [] }
        };
        // The first sharded commit keeps a complete legacy snapshot readable until
        // the manifest atomically publishes every fact shard. This prevents a crash
        // during migration from exposing an empty or partially migrated data set.
        if (!previousManifest) {
            await writePromotionJsonAtomic(directory, snapshotPath, snapshot);
        }
        await writePromotionJsonAtomic(directory, location.manifestPath, existingManifest);
        await writePromotionJsonAtomic(directory, snapshotPath, coreSnapshot);
        await (0, promises_1.unlink)(viewSnapshotPath).catch(() => undefined);
        shardedAccounts.add(digest);
        snapshotCache.set(digest, snapshot);
    }
    async function saveSnapshot(accountId, snapshot) {
        if (!(0, promotion_main_domain_1.isPromotionSnapshot)(snapshot)) {
            throw new Error('Promotion local data is invalid');
        }
        const digest = resolveAccountLocation(accountId).digest;
        const previous = accountWriteTails.get(digest) ?? Promise.resolve();
        const operation = previous
            .catch(() => undefined)
            .then(() => saveSnapshotUnlocked(accountId, snapshot));
        accountWriteTails.set(digest, operation);
        try {
            await operation;
        }
        finally {
            if (accountWriteTails.get(digest) === operation) {
                accountWriteTails.delete(digest);
            }
        }
    }
    async function updateModeControl(accountId, update) {
        const digest = resolveAccountLocation(accountId).digest;
        const previous = accountWriteTails.get(digest) ?? Promise.resolve();
        let result;
        const operation = previous.catch(() => undefined).then(async () => {
            result = update(await loadSnapshot(accountId));
            await saveSnapshotUnlocked(accountId, result, true);
            result = await loadSnapshot(accountId);
        });
        accountWriteTails.set(digest, operation);
        try {
            await operation;
            return result;
        }
        finally {
            if (accountWriteTails.get(digest) === operation)
                accountWriteTails.delete(digest);
        }
    }
    async function setMode(accountId, profileId, mode) {
        if (mode !== 'observe' && mode !== 'automatic')
            throw new Error('无效的推广运行模式');
        if (profileId !== null && (typeof profileId !== 'string' || !profileId.trim()))
            throw new Error('无效的店铺');
        return updateModeControl(accountId, (latest) => (0, promotion_mode_control_1.changePromotionMode)(latest, profileId === null ? null : [profileId], mode, 'operator'));
    }
    async function restoreControl(accountId, recovered) {
        if (!(0, promotion_main_domain_1.isPromotionSnapshot)(recovered))
            throw new Error('Promotion local data is invalid');
        return updateModeControl(accountId, (latest) => {
            const ruleIds = new Set(latest.control.rules.map((rule) => rule.id));
            const restoredRules = recovered.control.rules.filter((rule) => !ruleIds.has(rule.id));
            const logIds = new Set(latest.control.logs.map((log) => log.id));
            const merged = { ...latest, control: {
                    ...latest.control,
                    monitoredProfileIds: [...new Set([...latest.control.monitoredProfileIds, ...recovered.control.monitoredProfileIds])],
                    rules: [...latest.control.rules, ...restoredRules],
                    storeRuleSchedules: { ...recovered.control.storeRuleSchedules, ...latest.control.storeRuleSchedules },
                    logs: [...latest.control.logs, ...recovered.control.logs.filter((log) => !logIds.has(log.id))]
                        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500)
                } };
            // Re-evaluate against the latest state under the same queue as mode writes.
            // A repeated/stale recovery must not downgrade a mode already confirmed by the operator.
            if (!restoredRules.length)
                return merged;
            const affected = [...new Set(restoredRules.flatMap((rule) => rule.profileIds?.length
                    ? rule.profileIds : merged.control.monitoredProfileIds))];
            return (0, promotion_mode_control_1.changePromotionMode)(merged, affected, 'observe', 'backup-recovery');
        });
    }
    async function resetProfileMetricsUnlocked(accountId, profileId, reason = 'manual-reset') {
        const normalizedProfileId = profileId.trim();
        if (!normalizedProfileId)
            throw new Error('Invalid promotion profile id');
        const location = resolveAccountLocation(accountId);
        const snapshot = await loadSnapshot(accountId);
        const removedDays = snapshot.control.dailySnapshots.filter((daily) => daily.profileId === normalizedProfileId);
        const removedCampaigns = removedDays.reduce((total, daily) => total + daily.campaigns.length, 0);
        const backupId = removedDays.length ? `${Date.now()}-${(0, node_crypto_1.randomUUID)()}` : null;
        if (backupId) {
            const backupPath = node_path_1.default.join(location.backupsDirectory, `${backupId}.json`);
            assertPathWithinRoot(location.backupsDirectory, backupPath);
            await writePromotionJsonAtomic(location.backupsDirectory, backupPath, {
                schemaVersion: 1,
                backupId,
                profileId: normalizedProfileId,
                reason: sanitizePromotionDiagnosticText(reason, 120),
                createdAt: new Date().toISOString(),
                dailySnapshots: removedDays
            });
            await prunePromotionProfileBackups(location.backupsDirectory, 3);
        }
        const remainingDays = snapshot.control.dailySnapshots.filter((daily) => daily.profileId !== normalizedProfileId);
        const lastSyncAt = remainingDays
            .map((daily) => daily.syncedAt)
            .filter(Boolean)
            .sort()
            .at(-1) ?? null;
        const rebuilt = {
            ...snapshot,
            control: (0, promotion_main_domain_1.selectPromotionControlDateRange)({
                ...snapshot.control,
                dailySnapshots: remainingDays,
                campaigns: snapshot.control.selectedProfileId === normalizedProfileId
                    ? []
                    : snapshot.control.campaigns,
                lastSyncAt,
                fullSyncReadyProfileIds: (snapshot.control.fullSyncReadyProfileIds ?? [])
                    .filter((candidate) => candidate !== normalizedProfileId),
                ...(snapshot.control.selectedProfileId === normalizedProfileId ? {
                    backfillStartDate: '',
                    backfillEndDate: ''
                } : {})
            })
        };
        if (!(0, promotion_main_domain_1.isPromotionSnapshot)(rebuilt))
            throw new Error('Promotion local data is invalid');
        await (0, promises_1.mkdir)(location.directory, { recursive: true });
        const manifest = await readPromotionShardManifest(location.manifestPath)
            ?? { schemaVersion: 1, profiles: {} };
        const profile = manifest.profiles[normalizedProfileId];
        if (profile) {
            const profileDirectory = node_path_1.default.join(location.shardsDirectory, profile.digest);
            assertPathWithinRoot(location.shardsDirectory, profileDirectory);
            await (0, promises_1.rm)(profileDirectory, { recursive: true, force: true });
            delete manifest.profiles[normalizedProfileId];
        }
        if (!shardedAccounts.has(location.digest)) {
            await (0, promises_1.rm)(location.shardsDirectory, { recursive: true, force: true });
            for (const key of Object.keys(manifest.profiles))
                delete manifest.profiles[key];
            await persistPromotionDailyShards(location, manifest, rebuilt, remainingDays);
        }
        const coreSnapshot = {
            ...rebuilt,
            control: { ...rebuilt.control, campaigns: [], dailySnapshots: [] }
        };
        await writePromotionJsonAtomic(location.directory, location.manifestPath, manifest);
        await writePromotionJsonAtomic(location.directory, location.snapshotPath, coreSnapshot);
        await (0, promises_1.unlink)(location.viewSnapshotPath).catch(() => undefined);
        shardedAccounts.add(location.digest);
        snapshotCache.set(location.digest, rebuilt);
        return {
            snapshot: rebuilt,
            backupId,
            removedDailySnapshots: removedDays.length,
            removedCampaigns
        };
    }
    async function resetProfileMetrics(accountId, profileId, reason) {
        const digest = resolveAccountLocation(accountId).digest;
        const previous = accountWriteTails.get(digest) ?? Promise.resolve();
        let result;
        const operation = previous
            .catch(() => undefined)
            .then(async () => {
            result = await resetProfileMetricsUnlocked(accountId, profileId, reason);
        });
        accountWriteTails.set(digest, operation);
        try {
            await operation;
            if (!result)
                throw new Error('Promotion profile reset did not complete');
            return result;
        }
        finally {
            if (accountWriteTails.get(digest) === operation)
                accountWriteTails.delete(digest);
        }
    }
    async function appendSyncDiagnostic(accountId, entry) {
        const location = resolveAccountLocation(accountId);
        const sanitized = sanitizePromotionSyncDiagnostic(entry);
        const previous = diagnosticWriteTails.get(location.digest) ?? Promise.resolve();
        const operation = previous.catch(() => undefined).then(async () => {
            const existing = await readPromotionSyncDiagnostics(location.diagnosticsPath);
            const next = [...existing, sanitized].slice(-500);
            await (0, promises_1.mkdir)(location.diagnosticsDirectory, { recursive: true });
            const serialized = next.map((candidate) => JSON.stringify(candidate)).join('\n');
            await (0, promises_1.writeFile)(location.diagnosticsPath, `${serialized}${serialized ? '\n' : ''}`, {
                encoding: 'utf8',
                mode: 0o600
            });
        });
        diagnosticWriteTails.set(location.digest, operation);
        try {
            await operation;
        }
        finally {
            if (diagnosticWriteTails.get(location.digest) === operation)
                diagnosticWriteTails.delete(location.digest);
        }
    }
    async function listSyncDiagnostics(accountId, options = {}) {
        const location = resolveAccountLocation(accountId);
        const profileId = options.profileId?.trim();
        const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 200)));
        const entries = await readPromotionSyncDiagnostics(location.diagnosticsPath);
        return entries
            .filter((entry) => !profileId || entry.profileId === profileId)
            .slice(-limit);
    }
    return {
        repairAllAccounts,
        loadSnapshot,
        saveSnapshot,
        setMode,
        restoreControl,
        resetProfileMetrics,
        appendSyncDiagnostic,
        listSyncDiagnostics,
        resolveAccountLocation
    };
}
async function prunePromotionProfileBackups(directory, keep) {
    let entries = [];
    try {
        entries = (await (0, promises_1.readdir)(directory)).filter((entry) => entry.endsWith('.json')).sort().reverse();
    }
    catch (error) {
        if (!isFileNotFoundError(error))
            throw error;
    }
    await Promise.all(entries.slice(keep).map(async (entry) => {
        const candidate = node_path_1.default.join(directory, entry);
        assertPathWithinRoot(directory, candidate);
        await (0, promises_1.unlink)(candidate).catch(() => undefined);
    }));
}
async function readPromotionSyncDiagnostics(diagnosticsPath) {
    try {
        const serialized = await (0, promises_1.readFile)(diagnosticsPath, 'utf8');
        return serialized.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
            try {
                const parsed = JSON.parse(line);
                return isPromotionSyncDiagnosticEntry(parsed) ? [sanitizePromotionSyncDiagnostic(parsed)] : [];
            }
            catch {
                return [];
            }
        });
    }
    catch (error) {
        if (isFileNotFoundError(error))
            return [];
        throw error;
    }
}
function sanitizePromotionDiagnosticText(value, maxLength) {
    return (value ?? '')
        .replace(/https?:\/\/\S+/giu, '[url]')
        .replace(/(?:cookie|authorization|password|token)\s*[:=]\s*\S+/giu, '[redacted]')
        .replace(/[\r\n\t]+/gu, ' ')
        .slice(0, maxLength);
}
function sanitizePromotionSyncDiagnostic(entry) {
    return {
        ...entry,
        eventId: sanitizePromotionDiagnosticText(entry.eventId, 80),
        at: sanitizePromotionDiagnosticText(entry.at, 40),
        profileId: sanitizePromotionDiagnosticText(entry.profileId, 160),
        ...(entry.result === undefined ? {} : { result: sanitizePromotionDiagnosticText(entry.result, 120) }),
        ...(entry.errorCode === undefined ? {} : { errorCode: sanitizePromotionDiagnosticText(entry.errorCode, 80) }),
        ...(entry.message === undefined ? {} : { message: sanitizePromotionDiagnosticText(entry.message, 300) })
    };
}
function isPromotionSyncDiagnosticEntry(value) {
    if (!value || typeof value !== 'object')
        return false;
    const candidate = value;
    return typeof candidate.eventId === 'string'
        && typeof candidate.at === 'string'
        && typeof candidate.profileId === 'string'
        && ['sync-start', 'cache-reset', 'fetch-day', 'persist-batch', 'persist-verify', 'sync-complete', 'sync-failed']
            .includes(candidate.stage ?? '');
}
async function removeMetricArtifacts(rootDir, location) {
    assertPathWithinRoot(rootDir, location.directory);
    assertPathWithinRoot(rootDir, location.shardsDirectory);
    await (0, promises_1.rm)(location.shardsDirectory, { recursive: true, force: true });
    await (0, promises_1.unlink)(location.manifestPath).catch(() => undefined);
    await (0, promises_1.unlink)(location.viewSnapshotPath).catch(() => undefined);
    let entries = [];
    try {
        entries = await (0, promises_1.readdir)(location.directory);
    }
    catch (error) {
        if (!isFileNotFoundError(error))
            throw error;
    }
    await Promise.all(entries
        .filter((entry) => entry.startsWith('store-view.json.tmp-'))
        .map(async (entry) => {
        const temporaryPath = node_path_1.default.join(location.directory, entry);
        assertPathWithinRoot(rootDir, temporaryPath);
        await (0, promises_1.unlink)(temporaryPath).catch(() => undefined);
    }));
}
async function readPromotionShardManifest(manifestPath) {
    try {
        const parsed = JSON.parse(await (0, promises_1.readFile)(manifestPath, 'utf8'));
        if (!isPromotionShardManifest(parsed))
            throw new Error('Promotion local data is invalid');
        return parsed;
    }
    catch (error) {
        if (isFileNotFoundError(error))
            return null;
        if (error instanceof Error && error.message === 'Promotion local data is invalid')
            throw error;
        throw new Error('Promotion local data is invalid', { cause: error });
    }
}
async function loadPromotionDailyShards(location, manifest) {
    const profileSnapshots = await Promise.all(Object.entries(manifest.profiles).map(async ([profileId, profile]) => {
        const profileDirectory = node_path_1.default.join(location.shardsDirectory, profile.digest);
        assertPathWithinRoot(location.shardsDirectory, profileDirectory);
        const entityFile = await readPromotionEntityFile(node_path_1.default.join(profileDirectory, 'entities.json'), profileId);
        const entities = new Map(entityFile.entities.map((entity) => [entity.key, entity]));
        return await Promise.all(Object.entries(profile.dates).map(async ([date, metadata]) => {
            const channelCampaigns = await Promise.all(metadata.channels.map(async (channel) => {
                const factPath = promotionFactPath(location, profile.digest, date, channel);
                const parsed = JSON.parse(await (0, promises_1.readFile)(factPath, 'utf8'));
                if (!isPromotionFactFile(parsed, profileId, date, channel)) {
                    throw new Error('Promotion local data is invalid');
                }
                // Product shards written before item-export-v1 could contain a whole
                // plan's charge on the first product in that plan. Never let those
                // legacy facts reach the UI or an automation rule. They are restored
                // only after a fresh item-level sync writes schema v2 provenance.
                if (channel === 'product' && !isTrustedPromotionProductFactFile(parsed)) {
                    return [];
                }
                return parsed.rows.map((fact) => {
                    const entity = entities.get(fact.entityKey);
                    if (!entity)
                        throw new Error('Promotion local data is invalid');
                    const { key: _key, ...staticFields } = entity;
                    const { entityKey: _entityKey, ...dailyFields } = fact;
                    return { ...staticFields, ...dailyFields };
                });
            }));
            return {
                profileId,
                date,
                state: metadata.state,
                finalAfter: metadata.finalAfter,
                syncedAt: metadata.syncedAt,
                ...(metadata.channelReadiness ? { channelReadiness: metadata.channelReadiness } : {}),
                campaigns: channelCampaigns.flat()
            };
        }));
    }));
    return profileSnapshots.flat().sort((left, right) => (left.date.localeCompare(right.date) || left.profileId.localeCompare(right.profileId)));
}
async function persistPromotionDailyShards(location, manifest, snapshot, changedDays) {
    const currentDayKeys = new Set(snapshot.control.dailySnapshots.map((daily) => (promotionDayKey(daily.profileId, daily.date))));
    for (const [profileId, profile] of Object.entries(manifest.profiles)) {
        for (const [date, metadata] of Object.entries(profile.dates)) {
            if (currentDayKeys.has(promotionDayKey(profileId, date)))
                continue;
            for (const channel of metadata.channels) {
                await (0, promises_1.unlink)(promotionFactPath(location, profile.digest, date, channel)).catch((error) => {
                    if (!isFileNotFoundError(error))
                        throw error;
                });
            }
            delete profile.dates[date];
        }
    }
    const daysByProfile = new Map();
    for (const daily of changedDays) {
        const days = daysByProfile.get(daily.profileId) ?? [];
        days.push(daily);
        daysByProfile.set(daily.profileId, days);
    }
    for (const [profileId, days] of daysByProfile) {
        const existingProfile = manifest.profiles[profileId];
        const profileDigest = existingProfile?.digest ?? (0, node_crypto_1.createHash)('sha256').update(profileId, 'utf8').digest('hex');
        const profile = existingProfile ?? { digest: profileDigest, dates: {} };
        manifest.profiles[profileId] = profile;
        const profileDirectory = node_path_1.default.join(location.shardsDirectory, profileDigest);
        assertPathWithinRoot(location.shardsDirectory, profileDirectory);
        await (0, promises_1.mkdir)(profileDirectory, { recursive: true });
        const entityPath = node_path_1.default.join(profileDirectory, 'entities.json');
        const entityFile = await readPromotionEntityFile(entityPath, profileId, true);
        const entities = new Map(entityFile.entities.map((entity) => [entity.key, entity]));
        for (const daily of days) {
            const byChannel = new Map();
            for (const campaign of daily.campaigns) {
                const campaigns = byChannel.get(campaign.channel) ?? [];
                campaigns.push(campaign);
                byChannel.set(campaign.channel, campaigns);
            }
            const channels = [...byChannel.keys()].sort();
            const previousChannels = profile.dates[daily.date]?.channels ?? [];
            for (const previousChannel of previousChannels) {
                if (byChannel.has(previousChannel))
                    continue;
                await (0, promises_1.unlink)(promotionFactPath(location, profileDigest, daily.date, previousChannel)).catch((error) => {
                    if (!isFileNotFoundError(error))
                        throw error;
                });
            }
            for (const channel of channels) {
                const campaigns = byChannel.get(channel) ?? [];
                const currentEntities = new Map();
                const rows = campaigns.map((campaign) => {
                    const entity = toPromotionStaticEntity(campaign);
                    const current = currentEntities.get(entity.key);
                    currentEntities.set(entity.key, current ? mergePromotionCurrentStaticEntities(current, entity) : entity);
                    return toPromotionDailyFact(campaign, entity.key);
                });
                for (const entity of currentEntities.values()) {
                    const previous = entities.get(entity.key);
                    entities.set(entity.key, previous ? mergePromotionStaticEntities(previous, entity) : entity);
                }
                const factFile = {
                    schemaVersion: 2,
                    ...(channel === 'product' ? { metricScope: 'item' } : {}),
                    profileId,
                    date: daily.date,
                    channel,
                    rows
                };
                const factPath = promotionFactPath(location, profileDigest, daily.date, channel);
                await writePromotionJsonAtomic(node_path_1.default.dirname(factPath), factPath, factFile);
            }
            profile.dates[daily.date] = {
                state: daily.state,
                finalAfter: daily.finalAfter,
                syncedAt: daily.syncedAt,
                channels,
                ...(daily.channelReadiness ? { channelReadiness: daily.channelReadiness } : {})
            };
        }
        await writePromotionJsonAtomic(profileDirectory, entityPath, {
            schemaVersion: 1,
            profileId,
            entities: [...entities.values()]
        });
    }
}
function toPromotionStaticEntity(campaign) {
    return {
        key: promotionEntityKey(campaign),
        id: campaign.id,
        ...(campaign.parentCampaignId ? { parentCampaignId: campaign.parentCampaignId } : {}),
        ...(campaign.platformUnitId ? { platformUnitId: campaign.platformUnitId } : {}),
        ...(campaign.platformTargets?.length ? { platformTargets: campaign.platformTargets } : {}),
        ...(campaign.sourceCampaignIds?.length ? { sourceCampaignIds: campaign.sourceCampaignIds } : {}),
        ...(campaign.targetLevel ? { targetLevel: campaign.targetLevel } : {}),
        name: campaign.name,
        itemId: campaign.itemId,
        itemName: campaign.itemName,
        ...(campaign.itemImageUrl ? { itemImageUrl: campaign.itemImageUrl } : {}),
        channel: campaign.channel,
        groupId: campaign.groupId,
        groupName: campaign.groupName,
        ...(campaign.groupIds?.length ? { groupIds: campaign.groupIds } : {}),
        ...(campaign.groupNames?.length ? { groupNames: campaign.groupNames } : {}),
        ...(campaign.bidStrategy ? { bidStrategy: campaign.bidStrategy } : {})
    };
}
function toPromotionDailyFact(campaign, entityKey) {
    return {
        entityKey,
        status: campaign.status,
        dailyBudget: campaign.dailyBudget,
        targetRoi: campaign.targetRoi,
        spend: campaign.spend,
        roi: campaign.roi,
        ...(campaign.netRoi === undefined ? {} : { netRoi: campaign.netRoi }),
        orders: campaign.orders,
        ...(campaign.netOrders === undefined ? {} : { netOrders: campaign.netOrders }),
        ...(campaign.directNetRoi === undefined ? {} : { directNetRoi: campaign.directNetRoi }),
        ...(campaign.directNetRevenue === undefined ? {} : { directNetRevenue: campaign.directNetRevenue }),
        ...(campaign.directNetOrders === undefined ? {} : { directNetOrders: campaign.directNetOrders }),
        ...(campaign.directOrders === undefined ? {} : { directOrders: campaign.directOrders }),
        revenue: campaign.revenue,
        ...(campaign.netRevenue === undefined ? {} : { netRevenue: campaign.netRevenue }),
        impressions: campaign.impressions,
        clicks: campaign.clicks,
        ...(campaign.cartAdds === undefined ? {} : { cartAdds: campaign.cartAdds }),
        observedAt: campaign.observedAt,
        dataStartDate: campaign.dataStartDate,
        dataEndDate: campaign.dataEndDate
    };
}
function mergePromotionStaticEntities(previous, incoming) {
    // Product title/image are static, but plan and unit bindings are mutable.
    // Merging those arrays across dates made old plan IDs live forever in the
    // cache. Replace the complete binding with the newest observation instead.
    const merged = { ...previous, ...incoming };
    const optionalMutableKeys = [
        'parentCampaignId',
        'platformUnitId',
        'platformTargets',
        'sourceCampaignIds',
        'targetLevel',
        'groupIds',
        'groupNames',
        'bidStrategy'
    ];
    for (const key of optionalMutableKeys) {
        if (!(key in incoming))
            delete merged[key];
    }
    return merged;
}
function mergePromotionCurrentStaticEntities(previous, incoming) {
    const platformTargets = new Map();
    for (const target of [...(previous.platformTargets ?? []), ...(incoming.platformTargets ?? [])]) {
        platformTargets.set(`${target.campaignId}:${target.unitId ?? ''}`, target);
    }
    const unique = (values) => [...new Set(values.filter((value) => Boolean(value)))];
    const sourceCampaignIds = unique([...(previous.sourceCampaignIds ?? []), ...(incoming.sourceCampaignIds ?? [])]);
    const groupIds = unique([...(previous.groupIds ?? []), ...(incoming.groupIds ?? [])]);
    const groupNames = unique([...(previous.groupNames ?? []), ...(incoming.groupNames ?? [])]);
    return {
        ...previous,
        ...incoming,
        ...(platformTargets.size ? { platformTargets: [...platformTargets.values()] } : {}),
        ...(sourceCampaignIds.length ? { sourceCampaignIds } : {}),
        ...(groupIds.length ? { groupIds } : {}),
        ...(groupNames.length ? { groupNames } : {})
    };
}
async function readPromotionEntityFile(entityPath, profileId, allowMissing = false) {
    try {
        const parsed = JSON.parse(await (0, promises_1.readFile)(entityPath, 'utf8'));
        if (!isPromotionEntityFile(parsed, profileId))
            throw new Error('Promotion local data is invalid');
        return parsed;
    }
    catch (error) {
        if (allowMissing && isFileNotFoundError(error)) {
            return { schemaVersion: 1, profileId, entities: [] };
        }
        if (error instanceof Error && error.message === 'Promotion local data is invalid')
            throw error;
        throw new Error('Promotion local data is invalid', { cause: error });
    }
}
async function writePromotionJsonAtomic(directory, destinationPath, value) {
    await (0, promises_1.mkdir)(directory, { recursive: true });
    const temporaryPath = node_path_1.default.join(directory, `${node_path_1.default.basename(destinationPath)}.tmp-${(0, node_crypto_1.randomUUID)()}`);
    try {
        await (0, promises_1.writeFile)(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
        const handle = await (0, promises_1.open)(temporaryPath, 'r+');
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await retryPromotionAtomicReplace(() => (0, promises_1.rename)(temporaryPath, destinationPath));
    }
    catch (error) {
        await (0, promises_1.unlink)(temporaryPath).catch(() => undefined);
        throw error;
    }
}
function promotionEntityKey(campaign) {
    const planId = campaign.parentCampaignId
        ?? campaign.sourceCampaignIds?.[0]
        ?? campaign.platformTargets?.[0]?.campaignId
        ?? campaign.id;
    return `${campaign.channel}:${planId}:${campaign.itemId || campaign.id}`;
}
function promotionDayKey(profileId, date) {
    return `${profileId}\u0000${date}`;
}
function promotionFactPath(location, profileDigest, date, channel) {
    if (!/^[a-f0-9]{64}$/.test(profileDigest) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Promotion local data is invalid');
    }
    const candidate = node_path_1.default.join(location.shardsDirectory, profileDigest, date, `${channel}.json`);
    assertPathWithinRoot(location.shardsDirectory, candidate);
    return candidate;
}
function isPromotionShardManifest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const record = value;
    if (record.schemaVersion !== 1 || !record.profiles || typeof record.profiles !== 'object' || Array.isArray(record.profiles))
        return false;
    return Object.entries(record.profiles).every(([profileId, profileValue]) => {
        if (!profileId || !profileValue || typeof profileValue !== 'object' || Array.isArray(profileValue))
            return false;
        const profile = profileValue;
        if (typeof profile.digest !== 'string' || !/^[a-f0-9]{64}$/.test(profile.digest))
            return false;
        if (!profile.dates || typeof profile.dates !== 'object' || Array.isArray(profile.dates))
            return false;
        return Object.entries(profile.dates).every(([date, metadataValue]) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !metadataValue || typeof metadataValue !== 'object' || Array.isArray(metadataValue))
                return false;
            const metadata = metadataValue;
            return ['provisional', 'final'].includes(String(metadata.state))
                && typeof metadata.finalAfter === 'string'
                && typeof metadata.syncedAt === 'string'
                && Array.isArray(metadata.channels)
                && metadata.channels.every((channel) => ['product', 'store', 'keyword'].includes(String(channel)))
                && isPromotionShardChannelReadiness(metadata.channelReadiness);
        });
    });
}
function isPromotionShardChannelReadiness(value) {
    if (value === undefined)
        return true;
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    return Object.entries(value).every(([channel, readinessValue]) => {
        if (!['product', 'store'].includes(channel)
            || !readinessValue
            || typeof readinessValue !== 'object'
            || Array.isArray(readinessValue))
            return false;
        const readiness = readinessValue;
        return ['pending', 'ready'].includes(String(readiness.state))
            && typeof readiness.fingerprint === 'string'
            && typeof readiness.stableSince === 'string'
            && typeof readiness.checkedAt === 'string';
    });
}
function isPromotionEntityFile(value, profileId) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const record = value;
    return record.schemaVersion === 1
        && record.profileId === profileId
        && Array.isArray(record.entities)
        && record.entities.every((entity) => {
            if (!entity || typeof entity !== 'object' || Array.isArray(entity))
                return false;
            const candidate = entity;
            return typeof candidate.key === 'string'
                && typeof candidate.id === 'string'
                && ['product', 'store', 'keyword'].includes(String(candidate.channel));
        });
}
function isPromotionFactFile(value, profileId, date, channel) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const record = value;
    return [1, 2].includes(Number(record.schemaVersion))
        && record.profileId === profileId
        && record.date === date
        && record.channel === channel
        && Array.isArray(record.rows)
        && record.rows.every((row) => row && typeof row === 'object' && !Array.isArray(row)
            && typeof row.entityKey === 'string');
}
function isTrustedPromotionProductFactFile(value) {
    return value.schemaVersion === 2 && value.metricScope === 'item';
}
async function retryPromotionAtomicReplace(operation, options = {}) {
    const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    const wait = options.wait ?? ((delayMs) => new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    }));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            await operation();
            return;
        }
        catch (error) {
            if (!isTransientWindowsFileReplaceError(error) || attempt === maxAttempts - 1)
                throw error;
            await wait(40 * (2 ** attempt));
        }
    }
}
function assertPathWithinRoot(root, candidate) {
    const relative = node_path_1.default.relative(node_path_1.default.resolve(root), node_path_1.default.resolve(candidate));
    if (relative.startsWith('..') || node_path_1.default.isAbsolute(relative)) {
        throw new Error('Resolved path escapes the promotion local store');
    }
}
function isFileNotFoundError(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
function isTransientWindowsFileReplaceError(error) {
    return Boolean(error
        && typeof error === 'object'
        && 'code' in error
        && ['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code)));
}
