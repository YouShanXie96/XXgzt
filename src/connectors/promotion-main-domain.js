"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURRENT_PROMOTION_DATA_TRUST_VERSION = void 0;
exports.createEmptyPromotionSnapshot = createEmptyPromotionSnapshot;
exports.createDefaultPromotionControlSnapshot = createDefaultPromotionControlSnapshot;
exports.applyPromotionCampaignSync = applyPromotionCampaignSync;
exports.getPromotionDayFinalAfter = getPromotionDayFinalAfter;
exports.isPromotionDailyChannelReady = isPromotionDailyChannelReady;
exports.shouldSyncPromotionDay = shouldSyncPromotionDay;
exports.listPromotionDates = listPromotionDates;
exports.upsertPromotionDailySnapshot = upsertPromotionDailySnapshot;
exports.aggregatePromotionDailyCampaigns = aggregatePromotionDailyCampaigns;
exports.getPromotionCampaignPlanId = getPromotionCampaignPlanId;
exports.getPromotionCampaignMetricIdentity = getPromotionCampaignMetricIdentity;
exports.getPromotionStoreMode = getPromotionStoreMode;
exports.selectPromotionControlDateRange = selectPromotionControlDateRange;
exports.applyPromotionCampaignStatus = applyPromotionCampaignStatus;
exports.applyPromotionPlatformTargetStatus = applyPromotionPlatformTargetStatus;
exports.resolvePromotionDateRange = resolvePromotionDateRange;
exports.evaluatePromotionRules = evaluatePromotionRules;
exports.buildPromotionRecovery = buildPromotionRecovery;
exports.migratePromotionSnapshot = migratePromotionSnapshot;
exports.isPromotionSnapshot = isPromotionSnapshot;
const promotionChannels = ['xiaohongshu', 'douyin', 'wechat', 'taobao', 'tmall', 'other'];
// v18 forces every installed client to quarantine legacy promotion metric shards.
// Besides older multi-store completion-marker corruption, some employee machines
// could reopen on an empty "today" view and keep stale locally trusted metrics.
// The renderer now persists its date range, while this trust bump guarantees that
// promotion facts are rebuilt once from authoritative reports on upgrade.
// Rules, execution logs, recovery queues, shop sessions and account settings are
// deliberately preserved by PromotionLocalStore.resetMetricCache().
exports.CURRENT_PROMOTION_DATA_TRUST_VERSION = 18;
function createEmptyPromotionSnapshot() {
    return {
        schemaVersion: 4,
        projects: [],
        contentItems: [],
        assets: [],
        tasks: [],
        results: [],
        ui: { activeProjectId: null, activeView: 'overview' },
        control: createDefaultPromotionControlSnapshot()
    };
}
function createDefaultPromotionControlSnapshot() {
    return {
        mode: 'observe',
        selectedProfileId: null,
        monitoredProfileIds: [],
        datePreset: 'today',
        includeToday: true,
        customStartDate: '',
        customEndDate: '',
        backfillStartDate: '',
        backfillEndDate: '',
        lastSyncAt: null,
        dataTrustVersion: exports.CURRENT_PROMOTION_DATA_TRUST_VERSION,
        fullSyncReadyProfileIds: [],
        campaigns: [],
        dailySnapshots: [],
        rules: [],
        storeModes: {},
        storeRuleSchedules: {},
        recoveries: [],
        logs: []
    };
}
function applyPromotionCampaignSync(control, input) {
    return {
        ...addMonitoredProfile(control, input.profileId),
        selectedProfileId: input.profileId,
        lastSyncAt: input.observedAt,
        campaigns: input.campaigns.map((campaign) => ({
            ...campaign,
            observedAt: input.observedAt,
            dataStartDate: input.startDate,
            dataEndDate: input.endDate
        }))
    };
}
function getPromotionDayFinalAfter(date) {
    const normalized = normalizeDateText(date);
    if (!normalized)
        throw new Error('推广数据日期无效');
    return `${addDays(normalized, 1)}T06:00:00+08:00`;
}
const PROMOTION_REPORT_STABLE_WINDOW_MS = 30 * 60_000;
function isPromotionDailyChannelReady(snapshot, channel) {
    return snapshot?.channelReadiness?.[channel]?.state === 'ready';
}
function shouldSyncPromotionDay(snapshot, date, now = new Date().toISOString()) {
    const normalized = normalizeDateText(date);
    if (!normalized || snapshot?.state === 'final')
        return false;
    const today = getShanghaiDate(now);
    if (normalized > today)
        return false;
    if (normalized === today)
        return true;
    if (normalized < addDays(today, -1))
        return !snapshot;
    return Date.parse(now) >= Date.parse(getPromotionDayFinalAfter(normalized));
}
function listPromotionDates(startDate, endDate) {
    const start = normalizeDateText(startDate);
    const end = normalizeDateText(endDate);
    if (!start || !end || start > end)
        throw new Error('推广数据日期范围无效');
    const dates = [];
    for (let date = start; date <= end; date = addDays(date, 1)) {
        dates.push(date);
        if (dates.length > 366)
            throw new Error('单次最多补齐 366 天推广数据');
    }
    return dates;
}
function upsertPromotionDailySnapshot(control, input) {
    const date = normalizeDateText(input.date);
    if (!date)
        throw new Error('推广数据日期无效');
    const existing = control.dailySnapshots.find((snapshot) => snapshot.profileId === input.profileId && snapshot.date === date);
    const finalAfter = getPromotionDayFinalAfter(date);
    const today = getShanghaiDate(input.syncedAt);
    const yesterday = addDays(today, -1);
    const selectedChannels = [...new Set((input.channels?.length
            ? input.channels
            : input.campaigns.map((campaign) => campaign.channel))
            .filter((channel) => channel !== 'keyword'))];
    const channelReadiness = { ...(existing?.channelReadiness ?? {}) };
    if (date < yesterday) {
        for (const channel of selectedChannels) {
            const campaigns = input.campaigns.filter((campaign) => campaign.channel === channel);
            const fingerprint = getPromotionDailyChannelFingerprint(campaigns);
            channelReadiness[channel] = {
                state: 'ready',
                fingerprint,
                stableSince: input.syncedAt,
                checkedAt: input.syncedAt
            };
        }
    }
    else if (date === yesterday) {
        for (const channel of selectedChannels) {
            const campaigns = input.campaigns.filter((campaign) => campaign.channel === channel);
            const fingerprint = getPromotionDailyChannelFingerprint(campaigns);
            const previous = existing?.channelReadiness?.[channel];
            // A non-empty plan/item result is an explicit report response even when
            // every business metric is genuinely zero. Requiring a positive metric
            // would leave a real zero day pending forever and prevent it from ever
            // being repaired into NAS. An absent channel remains pending.
            const hasExplicitRows = campaigns.length > 0;
            const firstEligibleCheck = new Date(Math.max(Date.parse(input.syncedAt), Date.parse(finalAfter))).toISOString();
            const stableSince = previous?.fingerprint === fingerprint
                ? previous.stableSince
                : firstEligibleCheck;
            const stableForMs = Date.parse(input.syncedAt) - Date.parse(stableSince);
            channelReadiness[channel] = {
                state: hasExplicitRows && stableForMs >= PROMOTION_REPORT_STABLE_WINDOW_MS
                    ? 'ready'
                    : 'pending',
                fingerprint,
                stableSince,
                checkedAt: input.syncedAt
            };
        }
    }
    const state = date < yesterday
        ? 'final'
        : date === yesterday
            && selectedChannels.length > 0
            && selectedChannels.every((channel) => channelReadiness[channel]?.state === 'ready')
            ? 'final'
            : 'provisional';
    const dailySnapshot = {
        profileId: input.profileId,
        date,
        state,
        finalAfter,
        syncedAt: input.syncedAt,
        ...(Object.keys(channelReadiness).length > 0 ? { channelReadiness } : {}),
        campaigns: input.campaigns.map((campaign) => ({
            ...campaign, observedAt: input.syncedAt, dataStartDate: date, dataEndDate: date
        }))
    };
    return {
        ...addMonitoredProfile(control, input.profileId),
        selectedProfileId: input.profileId,
        lastSyncAt: input.syncedAt,
        dailySnapshots: [
            ...control.dailySnapshots.filter((snapshot) => snapshot.profileId !== input.profileId || snapshot.date !== date),
            dailySnapshot
        ].sort((left, right) => left.date.localeCompare(right.date) || left.profileId.localeCompare(right.profileId))
    };
}
function getPromotionDailyChannelFingerprint(campaigns) {
    return JSON.stringify(campaigns.map((campaign) => ({
        channel: campaign.channel,
        planId: getPromotionCampaignPlanId(campaign),
        itemId: campaign.itemId ?? campaign.id,
        spend: campaign.spend,
        revenue: campaign.revenue,
        netRevenue: campaign.netRevenue ?? null,
        netRoi: campaign.netRoi ?? null,
        orders: campaign.orders,
        netOrders: campaign.netOrders ?? null,
        clicks: campaign.clicks,
        impressions: campaign.impressions,
        cartAdds: campaign.cartAdds ?? null
    })).sort((left, right) => (left.channel.localeCompare(right.channel)
        || left.planId.localeCompare(right.planId)
        || left.itemId.localeCompare(right.itemId))));
}
function aggregatePromotionDailyCampaigns(snapshots, profileId, startDate, endDate) {
    const dates = new Set(listPromotionDates(startDate, endDate));
    const grouped = new Map();
    for (const snapshot of snapshots) {
        if (snapshot.profileId !== profileId || !dates.has(snapshot.date))
            continue;
        for (const campaign of snapshot.campaigns) {
            const key = getPromotionCampaignMetricIdentity(campaign);
            grouped.set(key, [...(grouped.get(key) ?? []), campaign]);
        }
    }
    return [...grouped.values()].map((campaigns) => {
        const ordered = [...campaigns].sort((left, right) => left.dataEndDate.localeCompare(right.dataEndDate) || left.observedAt.localeCompare(right.observedAt));
        const latest = ordered.at(-1);
        const spend = sumMetrics(ordered, 'spend');
        const revenue = sumMetrics(ordered, 'revenue');
        // Do not convert incomplete net-metric coverage into a real zero.  Older
        // official product reports can omit net columns even when the realtime
        // row for today supplies zero values.  Treat that range as unknown so the
        // automation evaluator fails closed instead of pausing a profitable item.
        const netRevenue = sumFullyCoveredOptionalMetrics(ordered, 'netRevenue');
        const directNetRevenue = sumFullyCoveredOptionalMetrics(ordered, 'directNetRevenue');
        const netRoi = calculateFullyCoveredOptionalRatio(ordered, 'netRevenue', 'netRoi');
        const directNetRoi = calculateFullyCoveredOptionalRatio(ordered, 'directNetRevenue', 'directNetRoi');
        const itemId = latest.itemId;
        // Metrics are additive across the requested date range, but plan bindings are
        // current state rather than historical facts. Reusing bindings from every day
        // makes removed plans accumulate in the local cache and can pause an obsolete
        // target for high-volume stores. Always act on the newest observed binding.
        const platformTargets = uniquePromotionPlatformTargets(latest.platformTargets?.length
            ? latest.platformTargets
            : latest.parentCampaignId
                ? [{ campaignId: latest.parentCampaignId, ...(latest.platformUnitId ? { unitId: latest.platformUnitId } : {}) }]
                : []);
        const sourceCampaignIds = uniqueStrings(latest.sourceCampaignIds?.length
            ? latest.sourceCampaignIds
            : latest.parentCampaignId ? [latest.parentCampaignId] : []);
        const groupIds = uniqueStrings(latest.groupIds?.length ? latest.groupIds : latest.groupId ? [latest.groupId] : []);
        const groupNames = uniqueStrings(latest.groupNames?.length ? latest.groupNames : latest.groupName ? [latest.groupName] : []);
        return {
            ...latest,
            id: latest.id,
            ...(platformTargets.length ? { platformTargets } : {}),
            ...(sourceCampaignIds.length ? { sourceCampaignIds } : {}),
            ...(groupIds.length ? { groupIds, groupId: groupIds[0] } : {}),
            ...(groupNames.length ? { groupNames, groupName: groupNames[0] } : {}),
            spend,
            revenue,
            roi: spend > 0 ? revenue / spend : 0,
            netRevenue,
            netRoi,
            directNetRevenue,
            directNetRoi,
            orders: sumMetrics(ordered, 'orders'),
            netOrders: sumFullyCoveredOptionalMetrics(ordered, 'netOrders'),
            directNetOrders: sumFullyCoveredOptionalMetrics(ordered, 'directNetOrders'),
            directOrders: sumFullyCoveredOptionalMetrics(ordered, 'directOrders'),
            impressions: sumMetrics(ordered, 'impressions'),
            clicks: sumMetrics(ordered, 'clicks'),
            cartAdds: sumOptionalMetrics(ordered, 'cartAdds'),
            dataStartDate: startDate,
            dataEndDate: endDate
        };
    }).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}
function getPromotionCampaignPlanId(campaign) {
    return campaign.parentCampaignId
        ?? campaign.sourceCampaignIds?.[0]
        ?? campaign.platformTargets?.[0]?.campaignId
        ?? campaign.id;
}
function getPromotionCampaignMetricIdentity(campaign) {
    return `${campaign.channel}:${getPromotionCampaignPlanId(campaign)}:${campaign.itemId ?? campaign.id}`;
}
function getPromotionStoreMode(control, profileId) {
    return control.storeModes?.[profileId] ?? control.mode;
}
function selectPromotionControlDateRange(control, now = new Date().toISOString()) {
    if (!control.selectedProfileId)
        return { ...control, campaigns: [] };
    const range = resolvePromotionDateRange(control.datePreset, control.includeToday, now, {
        startDate: control.customStartDate, endDate: control.customEndDate
    });
    return {
        ...control,
        campaigns: aggregatePromotionDailyCampaigns(control.dailySnapshots, control.selectedProfileId, range.startDate, range.endDate)
    };
}
function applyPromotionCampaignStatus(control, profileId, campaignId, channel, status, targets = []) {
    const matchesCampaign = (campaign) => (campaign.channel === channel
        && (campaign.id === campaignId || getPromotionCampaignMetricIdentity(campaign) === campaignId));
    const latestMatchingSnapshot = control.dailySnapshots
        .filter((snapshot) => snapshot.profileId === profileId && snapshot.campaigns.some(matchesCampaign))
        .sort((left, right) => (left.date.localeCompare(right.date) || left.syncedAt.localeCompare(right.syncedAt)))
        .at(-1);
    const updateCampaign = (campaign) => matchesCampaign(campaign)
        ? applyPromotionPlatformTargetStatus(campaign, targets, status)
        : campaign;
    return {
        ...control,
        campaigns: control.campaigns.map(updateCampaign),
        // Status is point-in-time state. Updating every historical day forces a
        // large store to rewrite its entire archive after one pause and also makes
        // old reports pretend the plan was paused in the past. Only update the
        // newest matching day; older metric shards remain immutable.
        dailySnapshots: control.dailySnapshots.map((snapshot) => snapshot === latestMatchingSnapshot
            ? { ...snapshot, campaigns: snapshot.campaigns.map(updateCampaign) }
            : snapshot)
    };
}
function applyPromotionPlatformTargetStatus(campaign, targets, status) {
    if (!campaign.platformTargets?.length || targets.length === 0) {
        return { ...campaign, status };
    }
    let updated = false;
    const platformTargets = campaign.platformTargets.map((target) => {
        const matches = targets.some((candidate) => (candidate.campaignId === target.campaignId
            && (campaign.channel === 'product'
                || (candidate.platformUnitId ?? '') === (target.unitId ?? ''))));
        if (!matches)
            return target;
        updated = true;
        return { ...target, status };
    });
    if (!updated)
        return { ...campaign, status };
    const knownStatuses = platformTargets
        .map((target) => target.status)
        .filter((value) => Boolean(value));
    const aggregateStatus = knownStatuses.includes('active')
        ? 'active'
        : knownStatuses.length === platformTargets.length && knownStatuses.every((value) => value === 'paused')
            ? 'paused'
            : status;
    return { ...campaign, platformTargets, status: aggregateStatus };
}
function resolvePromotionDateRange(preset, includeToday, now = new Date().toISOString(), custom) {
    if (preset === 'custom') {
        const startDate = normalizeDateText(custom?.startDate ?? '');
        const endDate = normalizeDateText(custom?.endDate ?? '');
        if (startDate && endDate && startDate <= endDate)
            return { startDate, endDate };
    }
    const today = getShanghaiDate(now);
    if (preset === 'today')
        return { startDate: today, endDate: today };
    if (preset === 'yesterday') {
        const yesterday = addDays(today, -1);
        return { startDate: yesterday, endDate: yesterday };
    }
    const days = preset === 'last3' ? 3 : preset === 'last14' ? 14 : preset === 'last30' ? 30 : 7;
    const endDate = includeToday ? today : addDays(today, -1);
    return { startDate: addDays(endDate, -(days - 1)), endDate };
}
function evaluatePromotionRules(campaigns, rules, profileId) {
    const matches = [];
    for (const rule of rules) {
        if (!rule.enabled)
            continue;
        const action = rule.action ?? 'pause';
        for (const campaign of campaigns) {
            if (action === 'pause' && campaign.status !== 'active')
                continue;
            if (action === 'resume' && campaign.status !== 'paused')
                continue;
            if (!rule.channels.includes(campaign.channel))
                continue;
            if (campaign.targetLevel !== 'item' || !campaign.itemId)
                continue;
            const campaignGroupIds = campaign.groupIds?.length
                ? campaign.groupIds
                : campaign.groupId ? [campaign.groupId] : [];
            if (rule.groupIds.length > 0 && !rule.groupIds.some((id) => campaignGroupIds.includes(id)))
                continue;
            const campaignSourceIds = campaign.sourceCampaignIds?.length
                ? campaign.sourceCampaignIds
                : campaign.parentCampaignId ? [campaign.parentCampaignId] : [];
            if (rule.campaignIds.length > 0
                && !rule.campaignIds.includes(campaign.id)
                && !campaignSourceIds.some((id) => rule.campaignIds.includes(id)))
                continue;
            if (rule.itemIds?.length && (!campaign.itemId || !rule.itemIds.includes(campaign.itemId)))
                continue;
            if (campaign.itemId && rule.excludedItemIds?.includes(campaign.itemId))
                continue;
            const platformCampaignId = getPromotionCampaignPlanId(campaign);
            if (rule.excludedTargets?.some((target) => (!profileId || target.profileId === profileId)
                && target.channel === campaign.channel
                && target.campaignId === platformCampaignId
                && target.itemId === campaign.itemId))
                continue;
            const conditions = rule.conditions?.length ? rule.conditions : [
                { metric: 'spend', operator: 'gte', value: rule.minimumSpend },
                {
                    metric: campaign.channel === 'product' ? 'netRoi' : 'roi',
                    operator: 'lte',
                    value: rule.maximumRoi
                }
            ];
            const conditionResults = conditions.map((condition) => evaluatePromotionCondition(campaign, condition));
            const matched = (rule.conditionLogic ?? 'and') === 'or'
                ? conditionResults.some(Boolean)
                : conditionResults.every(Boolean);
            if (!matched)
                continue;
            matches.push({
                campaignId: campaign.id,
                campaignName: campaign.name,
                itemId: campaign.itemId,
                platformCampaignId,
                channel: campaign.channel,
                ruleId: rule.id,
                ruleName: rule.name,
                action,
                autoRecover: action === 'pause' && (rule.autoRecover ?? true),
                recoveryTime: normalizeRecoveryTime(rule.recoveryTime),
                recoverAfterMinutes: rule.recoverAfterMinutes,
                dataStartDate: campaign.dataStartDate,
                dataEndDate: campaign.dataEndDate,
                reason: `${campaign.dataStartDate} 至 ${campaign.dataEndDate} 汇算：${conditions.map((condition) => formatPromotionConditionReason(campaign, condition)).join((rule.conditionLogic ?? 'and') === 'or' ? ' 或 ' : ' 且 ')}`
            });
        }
    }
    return matches;
}
function evaluatePromotionCondition(campaign, condition) {
    const actual = getPromotionAutomationMetricValue(campaign, condition.metric);
    if (!Number.isFinite(actual) || !Number.isFinite(condition.value))
        return false;
    if (condition.operator === 'gt')
        return actual > condition.value;
    if (condition.operator === 'gte')
        return actual >= condition.value;
    if (condition.operator === 'lt')
        return actual < condition.value;
    if (condition.operator === 'lte')
        return actual <= condition.value;
    return actual === condition.value;
}
function getPromotionAutomationMetricValue(campaign, metric) {
    if (campaign.channel === 'store') {
        if (['netRoi', 'directNetRoi', 'netDealRatio'].includes(metric))
            return campaign.roi;
        if (['netOrders', 'directNetOrders', 'directOrders'].includes(metric))
            return Number.NaN;
    }
    if (metric === 'spend')
        return campaign.spend;
    if (metric === 'clicks')
        return campaign.clicks;
    if (metric === 'avgClickCost')
        return campaign.clicks > 0
            ? campaign.spend / campaign.clicks
            : Number.NaN;
    if (metric === 'impressions')
        return campaign.impressions;
    if (metric === 'cartAdds')
        return campaign.cartAdds ?? 0;
    if (metric === 'netRoi')
        return campaign.netRoi ?? Number.NaN;
    if (metric === 'netOrders')
        return campaign.netOrders ?? Number.NaN;
    if (metric === 'directNetRoi')
        return campaign.directNetRoi ?? 0;
    if (metric === 'directNetOrders')
        return campaign.directNetOrders ?? 0;
    if (metric === 'directOrders')
        return campaign.directOrders ?? 0;
    if (metric === 'netDealRatio')
        return campaign.spend > 0 && campaign.netRevenue !== undefined
            ? campaign.netRevenue / campaign.spend
            : Number.NaN;
    return campaign.roi;
}
function formatPromotionConditionReason(campaign, condition) {
    const labels = {
        clicks: '点击量',
        avgClickCost: '平均点击花费',
        impressions: '展现量',
        cartAdds: '加购量',
        spend: '花费', netRoi: '净实际投产比', netOrders: '净成交笔数', directNetRoi: '直接净投产比',
        directNetOrders: '直接净成交笔数', directOrders: '直接成交笔数', netDealRatio: '净实际投产比', roi: '实际投产比'
    };
    const operators = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };
    return `${labels[condition.metric]} ${getPromotionAutomationMetricValue(campaign, condition.metric).toFixed(2)} ${operators[condition.operator]} ${condition.value.toFixed(2)}`;
}
function buildPromotionRecovery(input) {
    const time = normalizeRecoveryTime(input.recoveryTime);
    const nextDay = addDays(getShanghaiDate(input.pausedAt), 1);
    return {
        id: input.id ?? crypto.randomUUID(),
        campaignId: getPromotionCampaignMetricIdentity(input.campaign),
        campaignName: input.campaign.name,
        channel: input.campaign.channel,
        itemId: input.campaign.itemId ?? input.campaign.id,
        ...(input.campaign.parentCampaignId ? { platformCampaignId: input.campaign.parentCampaignId } : {}),
        ...(input.campaign.platformUnitId ? { platformUnitId: input.campaign.platformUnitId } : {}),
        ...((input.platformTargets ?? input.campaign.platformTargets)?.length
            ? { platformTargets: uniquePromotionPlatformTargets((input.platformTargets ?? input.campaign.platformTargets)) }
            : {}),
        profileId: input.profileId,
        dueAt: Number.isFinite(input.recoverAfterMinutes) && input.recoverAfterMinutes > 0
            ? new Date(Date.parse(input.pausedAt) + input.recoverAfterMinutes * 60_000).toISOString()
            : `${nextDay}T${time}:00+08:00`,
        status: 'pending',
        attempts: 0,
        createdAt: input.pausedAt
    };
}
function migratePromotionSnapshot(value) {
    if (isPromotionSnapshot(value))
        return normalizePromotionStoreRuleMetrics(structuredClone(value));
    if (isPromotionV3Snapshot(value)) {
        const previous = structuredClone(value);
        return normalizePromotionStoreRuleMetrics({
            ...previous,
            schemaVersion: 4,
            control: {
                ...previous.control,
                monitoredProfileIds: collectMonitoredProfileIds(previous.control.selectedProfileId, previous.control.dailySnapshots)
            }
        });
    }
    if (isPreviousPromotionSnapshot(value)) {
        const previous = structuredClone(value);
        return normalizePromotionStoreRuleMetrics({
            ...previous,
            schemaVersion: 4,
            control: {
                ...previous.control,
                monitoredProfileIds: collectMonitoredProfileIds(previous.control.selectedProfileId, []),
                backfillStartDate: '',
                backfillEndDate: '',
                dailySnapshots: []
            }
        });
    }
    if (isLegacyPromotionSnapshot(value)) {
        return {
            ...structuredClone(value),
            schemaVersion: 4,
            control: createDefaultPromotionControlSnapshot()
        };
    }
    return null;
}
function normalizePromotionStoreRuleMetrics(snapshot) {
    return {
        ...snapshot,
        control: {
            ...snapshot.control,
            dataTrustVersion: snapshot.control.dataTrustVersion ?? 1,
            fullSyncReadyProfileIds: snapshot.control.fullSyncReadyProfileIds ?? [],
            storeRuleSchedules: snapshot.control.storeRuleSchedules ?? {},
            storeModes: snapshot.control.storeModes ?? {},
            recoveries: snapshot.control.recoveries.map((recovery) => (recovery.channel === 'keyword' && recovery.status === 'pending'
                ? { ...recovery, status: 'cancelled' }
                : recovery)),
            rules: snapshot.control.rules.map((rule) => {
                if (rule.channels.includes('keyword')) {
                    return rule.enabled ? { ...rule, enabled: false } : rule;
                }
                if (rule.channels.length !== 1 || rule.channels[0] !== 'store' || !rule.conditions?.length)
                    return rule;
                let hasUnsupportedOrderMetric = false;
                const conditions = rule.conditions.flatMap((condition) => {
                    if (['netOrders', 'directNetOrders', 'directOrders'].includes(condition.metric)) {
                        hasUnsupportedOrderMetric = true;
                        return [];
                    }
                    if (['netRoi', 'directNetRoi', 'netDealRatio'].includes(condition.metric)) {
                        return [{ ...condition, metric: 'roi' }];
                    }
                    return [condition];
                });
                return {
                    ...rule,
                    enabled: hasUnsupportedOrderMetric ? false : rule.enabled,
                    conditions
                };
            })
        }
    };
}
function isPromotionSnapshot(value) {
    return isRecord(value)
        && value.schemaVersion === 4
        && isPromotionControlSnapshot(value.control)
        && hasValidPromotionWorkspaceEntities(value);
}
function isPromotionV3Snapshot(value) {
    return isRecord(value)
        && value.schemaVersion === 3
        && isPromotionV3ControlSnapshot(value.control)
        && hasValidPromotionWorkspaceEntities(value);
}
function isPreviousPromotionSnapshot(value) {
    return isRecord(value)
        && value.schemaVersion === 2
        && isPreviousPromotionControlSnapshot(value.control)
        && hasValidPromotionWorkspaceEntities(value);
}
function isLegacyPromotionSnapshot(value) {
    return isRecord(value) && value.schemaVersion === 1 && hasValidPromotionWorkspaceEntities(value);
}
function hasValidPromotionWorkspaceEntities(value) {
    if (!isRecord(value.ui))
        return false;
    if (!Array.isArray(value.projects)
        || !Array.isArray(value.contentItems)
        || !Array.isArray(value.assets)
        || !Array.isArray(value.tasks)
        || !Array.isArray(value.results))
        return false;
    return value.projects.every(isPromotionProject)
        && value.contentItems.every(isPromotionContentItem)
        && value.assets.every(isPromotionAsset)
        && value.tasks.every(isPromotionTask)
        && value.results.every(isPromotionResult)
        && (value.ui.activeProjectId === null || typeof value.ui.activeProjectId === 'string')
        && isPromotionView(value.ui.activeView);
}
function isPromotionControlSnapshot(value) {
    return isRecord(value)
        && ['observe', 'automatic'].includes(String(value.mode))
        && (value.selectedProfileId === null || typeof value.selectedProfileId === 'string')
        && Array.isArray(value.monitoredProfileIds)
        && value.monitoredProfileIds.every((profileId) => typeof profileId === 'string')
        && ['today', 'yesterday', 'last3', 'last7', 'last14', 'last30', 'custom'].includes(String(value.datePreset))
        && typeof value.includeToday === 'boolean'
        && typeof value.customStartDate === 'string'
        && typeof value.customEndDate === 'string'
        && typeof value.backfillStartDate === 'string'
        && typeof value.backfillEndDate === 'string'
        && (value.lastSyncAt === null || typeof value.lastSyncAt === 'string')
        && Array.isArray(value.campaigns) && value.campaigns.every(isPromotionCampaign)
        && Array.isArray(value.dailySnapshots) && value.dailySnapshots.every(isPromotionDailySnapshot)
        && Array.isArray(value.rules) && value.rules.every(isPromotionAutomationRule)
        && (value.storeRuleSchedules === undefined || isPromotionStoreRuleSchedules(value.storeRuleSchedules))
        && (value.storeModes === undefined || isPromotionStoreModes(value.storeModes))
        && (value.modeRevision === undefined || (Number.isSafeInteger(value.modeRevision) && Number(value.modeRevision) >= 0))
        && (value.lastModeChange === undefined || (isRecord(value.lastModeChange)
            && Array.isArray(value.lastModeChange.profileIds) && value.lastModeChange.profileIds.every((id) => typeof id === 'string')
            && ['operator', 'backup-recovery', 'cache-repair'].includes(String(value.lastModeChange.source))
            && typeof value.lastModeChange.at === 'string' && typeof value.lastModeChange.reason === 'string'))
        && Array.isArray(value.recoveries) && value.recoveries.every(isPromotionRecovery)
        && Array.isArray(value.logs) && value.logs.every(isPromotionExecutionLog);
}
function isPromotionStoreModes(value) {
    return isRecord(value) && Object.values(value).every((mode) => ['observe', 'automatic'].includes(String(mode)));
}
function isPromotionStoreRuleSchedules(value) {
    return isRecord(value) && Object.values(value).every((schedule) => (isRecord(schedule)
        && [5, 10, 15, 30, 60].includes(Number(schedule.intervalMinutes))
        && (schedule.lastRunAt === undefined || typeof schedule.lastRunAt === 'string')));
}
function isPromotionV3ControlSnapshot(value) {
    return isRecord(value)
        && ['observe', 'automatic'].includes(String(value.mode))
        && (value.selectedProfileId === null || typeof value.selectedProfileId === 'string')
        && ['today', 'yesterday', 'last3', 'last7', 'last14', 'last30', 'custom'].includes(String(value.datePreset))
        && typeof value.includeToday === 'boolean'
        && typeof value.customStartDate === 'string'
        && typeof value.customEndDate === 'string'
        && typeof value.backfillStartDate === 'string'
        && typeof value.backfillEndDate === 'string'
        && (value.lastSyncAt === null || typeof value.lastSyncAt === 'string')
        && Array.isArray(value.campaigns) && value.campaigns.every(isPromotionCampaign)
        && Array.isArray(value.dailySnapshots) && value.dailySnapshots.every(isPromotionDailySnapshot)
        && Array.isArray(value.rules) && value.rules.every(isPromotionAutomationRule)
        && Array.isArray(value.recoveries) && value.recoveries.every(isPromotionRecovery)
        && Array.isArray(value.logs) && value.logs.every(isPromotionExecutionLog);
}
function addMonitoredProfile(control, profileId) {
    const normalizedProfileId = profileId.trim();
    if (!normalizedProfileId || control.monitoredProfileIds.includes(normalizedProfileId))
        return control;
    return { ...control, monitoredProfileIds: [...control.monitoredProfileIds, normalizedProfileId] };
}
function collectMonitoredProfileIds(selectedProfileId, dailySnapshots) {
    return [...new Set([
            ...(selectedProfileId ? [selectedProfileId] : []),
            ...dailySnapshots.map((snapshot) => snapshot.profileId)
        ].map((profileId) => profileId.trim()).filter(Boolean))];
}
function isPreviousPromotionControlSnapshot(value) {
    return isRecord(value)
        && ['observe', 'automatic'].includes(String(value.mode))
        && (value.selectedProfileId === null || typeof value.selectedProfileId === 'string')
        && ['today', 'yesterday', 'last3', 'last7', 'last14', 'last30', 'custom'].includes(String(value.datePreset))
        && typeof value.includeToday === 'boolean'
        && typeof value.customStartDate === 'string'
        && typeof value.customEndDate === 'string'
        && (value.lastSyncAt === null || typeof value.lastSyncAt === 'string')
        && Array.isArray(value.campaigns) && value.campaigns.every(isPromotionCampaign)
        && Array.isArray(value.rules) && value.rules.every(isPromotionAutomationRule)
        && Array.isArray(value.recoveries) && value.recoveries.every(isPromotionRecovery)
        && Array.isArray(value.logs) && value.logs.every(isPromotionExecutionLog);
}
function isPromotionDailySnapshot(value) {
    return isRecord(value)
        && typeof value.profileId === 'string'
        && Boolean(normalizeDateText(String(value.date)))
        && ['provisional', 'final'].includes(String(value.state))
        && typeof value.finalAfter === 'string'
        && typeof value.syncedAt === 'string'
        && (value.channelReadiness === undefined || (isRecord(value.channelReadiness)
            && Object.entries(value.channelReadiness).every(([channel, readiness]) => (['product', 'store'].includes(channel)
                && isRecord(readiness)
                && ['pending', 'ready'].includes(String(readiness.state))
                && typeof readiness.fingerprint === 'string'
                && typeof readiness.stableSince === 'string'
                && typeof readiness.checkedAt === 'string'))))
        && Array.isArray(value.campaigns)
        && value.campaigns.every(isPromotionCampaign);
}
function isPromotionProject(value) {
    return isRecord(value) && hasEntityFields(value)
        && typeof value.name === 'string' && typeof value.goal === 'string' && typeof value.audience === 'string'
        && Array.isArray(value.channels) && value.channels.every(isPromotionChannel)
        && typeof value.owner === 'string' && typeof value.dueDate === 'string'
        && ['planning', 'active', 'paused', 'completed'].includes(String(value.status));
}
function isPromotionContentItem(value) {
    return isRecord(value) && hasProjectEntityFields(value)
        && typeof value.title === 'string' && isPromotionChannel(value.channel)
        && typeof value.format === 'string'
        && ['idea', 'draft', 'review', 'scheduled', 'published'].includes(String(value.status))
        && (value.scheduledAt === undefined || typeof value.scheduledAt === 'string')
        && typeof value.copy === 'string';
}
function isPromotionAsset(value) {
    return isRecord(value) && hasProjectEntityFields(value)
        && typeof value.name === 'string'
        && ['image', 'video', 'copy', 'landing-page'].includes(String(value.kind))
        && ['brief', 'generating', 'ready'].includes(String(value.status))
        && typeof value.brief === 'string'
        && (value.localUrl === undefined || typeof value.localUrl === 'string');
}
function isPromotionTask(value) {
    return isRecord(value) && hasProjectEntityFields(value)
        && typeof value.title === 'string' && typeof value.owner === 'string'
        && (value.dueDate === undefined || typeof value.dueDate === 'string')
        && ['todo', 'doing', 'done'].includes(String(value.status));
}
function isPromotionResult(value) {
    return isRecord(value) && hasProjectEntityFields(value) && isPromotionChannel(value.channel)
        && typeof value.publishedAt === 'string'
        && isMetric(value.impressions) && isMetric(value.clicks) && isMetric(value.leads)
        && isMetric(value.orders) && isMetric(value.revenue) && typeof value.note === 'string';
}
function isPromotionCampaign(value) {
    const optionalMetrics = [
        'netRoi', 'netOrders', 'directNetRoi', 'directNetRevenue', 'directNetOrders', 'directOrders', 'netRevenue', 'cartAdds'
    ];
    return isRecord(value) && typeof value.id === 'string'
        && (value.parentCampaignId === undefined || typeof value.parentCampaignId === 'string')
        && (value.platformUnitId === undefined || typeof value.platformUnitId === 'string')
        && (value.platformTargets === undefined || (Array.isArray(value.platformTargets)
            && value.platformTargets.every(isPromotionPlatformTarget)))
        && (value.sourceCampaignIds === undefined || (Array.isArray(value.sourceCampaignIds)
            && value.sourceCampaignIds.every((id) => typeof id === 'string')))
        && (value.targetLevel === undefined || ['campaign', 'item'].includes(String(value.targetLevel)))
        && typeof value.name === 'string'
        && (value.itemId === null || typeof value.itemId === 'string') && typeof value.itemName === 'string'
        && (value.itemImageUrl === undefined || typeof value.itemImageUrl === 'string')
        && ['product', 'store', 'keyword'].includes(String(value.channel))
        && (value.groupId === null || typeof value.groupId === 'string') && typeof value.groupName === 'string'
        && (value.groupIds === undefined || (Array.isArray(value.groupIds)
            && value.groupIds.every((id) => typeof id === 'string')))
        && (value.groupNames === undefined || (Array.isArray(value.groupNames)
            && value.groupNames.every((name) => typeof name === 'string')))
        && ['active', 'paused', 'unknown'].includes(String(value.status))
        && (value.dailyBudget === null || isMetric(value.dailyBudget))
        && (value.bidStrategy === undefined || typeof value.bidStrategy === 'string')
        && (value.targetRoi === null || isMetric(value.targetRoi))
        && ['spend', 'roi', 'orders', 'revenue', 'impressions', 'clicks'].every((key) => isMetric(value[key]))
        && optionalMetrics.every((key) => value[key] === undefined || isMetric(value[key]))
        && typeof value.observedAt === 'string' && typeof value.dataStartDate === 'string'
        && typeof value.dataEndDate === 'string';
}
function isPromotionAutomationRule(value) {
    return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
        && typeof value.enabled === 'boolean'
        && Array.isArray(value.channels) && value.channels.every((channel) => ['product', 'store', 'keyword'].includes(String(channel)))
        && Array.isArray(value.groupIds) && value.groupIds.every((id) => typeof id === 'string')
        && Array.isArray(value.campaignIds) && value.campaignIds.every((id) => typeof id === 'string')
        && (value.itemIds === undefined
            || (Array.isArray(value.itemIds) && value.itemIds.every((id) => typeof id === 'string')))
        && (value.excludedItemIds === undefined
            || (Array.isArray(value.excludedItemIds) && value.excludedItemIds.every((id) => typeof id === 'string')))
        && (value.excludedTargets === undefined
            || (Array.isArray(value.excludedTargets) && value.excludedTargets.every((target) => isRecord(target)
                && typeof target.profileId === 'string'
                && ['product', 'store', 'keyword'].includes(String(target.channel))
                && typeof target.campaignId === 'string'
                && typeof target.itemId === 'string')))
        && isMetric(value.minimumSpend) && isMetric(value.maximumRoi)
        && (value.profileIds === undefined || (Array.isArray(value.profileIds) && value.profileIds.every((id) => typeof id === 'string')))
        && (value.datePreset === undefined || ['today', 'yesterday', 'last3', 'last7', 'last14', 'last30', 'custom'].includes(String(value.datePreset)))
        && (value.includeToday === undefined || typeof value.includeToday === 'boolean')
        && (value.customStartDate === undefined || typeof value.customStartDate === 'string')
        && (value.customEndDate === undefined || typeof value.customEndDate === 'string')
        && (value.conditionLogic === undefined || ['and', 'or'].includes(String(value.conditionLogic)))
        && (value.conditions === undefined || (Array.isArray(value.conditions) && value.conditions.every(isPromotionAutomationCondition)))
        && (value.action === undefined || ['pause', 'resume'].includes(String(value.action)))
        && (value.autoRecover === undefined || typeof value.autoRecover === 'boolean')
        && (value.executionIntervalMinutes === undefined
            || [5, 10, 15, 30, 60].includes(Number(value.executionIntervalMinutes)))
        && (value.lastRunAt === undefined || typeof value.lastRunAt === 'string')
        && typeof value.recoveryTime === 'string' && typeof value.createdAt === 'string'
        && typeof value.updatedAt === 'string';
}
function isPromotionAutomationCondition(value) {
    return isRecord(value)
        && ['spend', 'clicks', 'avgClickCost', 'impressions', 'cartAdds', 'netRoi', 'netOrders', 'directNetRoi', 'directNetOrders', 'directOrders', 'netDealRatio', 'roi'].includes(String(value.metric))
        && ['gt', 'gte', 'lt', 'lte', 'eq'].includes(String(value.operator))
        && isMetric(value.value);
}
function isPromotionRecovery(value) {
    return isRecord(value) && typeof value.id === 'string' && typeof value.campaignId === 'string'
        && typeof value.campaignName === 'string'
        && (value.channel === undefined || ['product', 'store', 'keyword'].includes(String(value.channel)))
        && (value.itemId === undefined || typeof value.itemId === 'string')
        && typeof value.profileId === 'string'
        && (value.platformCampaignId === undefined || typeof value.platformCampaignId === 'string')
        && (value.platformUnitId === undefined || typeof value.platformUnitId === 'string')
        && (value.platformTargets === undefined || (Array.isArray(value.platformTargets)
            && value.platformTargets.every(isPromotionPlatformTarget)))
        && typeof value.dueAt === 'string' && ['pending', 'completed', 'failed', 'cancelled'].includes(String(value.status))
        && isMetric(value.attempts) && typeof value.createdAt === 'string'
        && (value.completedAt === undefined || typeof value.completedAt === 'string')
        && (value.cancelledAt === undefined || typeof value.cancelledAt === 'string')
        && (value.lastError === undefined || typeof value.lastError === 'string');
}
function isPromotionPlatformTarget(value) {
    return isRecord(value)
        && typeof value.campaignId === 'string'
        && (value.unitId === undefined || typeof value.unitId === 'string')
        && (value.status === undefined || ['active', 'paused', 'unknown'].includes(String(value.status)));
}
function isPromotionExecutionLog(value) {
    return isRecord(value) && typeof value.id === 'string' && typeof value.campaignId === 'string'
        && typeof value.campaignName === 'string' && typeof value.profileId === 'string'
        && (value.itemId === undefined || typeof value.itemId === 'string')
        && (value.ruleId === null || typeof value.ruleId === 'string') && typeof value.ruleName === 'string'
        && ['pause', 'restore', 'observe', 'scan', 'cancel-recovery'].includes(String(value.action))
        && ['success', 'failed', 'skipped'].includes(String(value.status))
        && (value.spend === undefined || (typeof value.spend === 'number' && Number.isFinite(value.spend)))
        && (value.roi === undefined || (typeof value.roi === 'number' && Number.isFinite(value.roi)))
        && (value.clicks === undefined || (typeof value.clicks === 'number' && Number.isFinite(value.clicks)))
        && (value.recoveryScheduled === undefined || typeof value.recoveryScheduled === 'boolean')
        && typeof value.reason === 'string' && typeof value.createdAt === 'string';
}
function getShanghaiDate(value) {
    const date = new Date(value);
    const valid = Number.isNaN(date.getTime()) ? new Date() : date;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(valid);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}
function addDays(value, amount) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}
function normalizeDateText(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}
function normalizeRecoveryTime(value) {
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '00:00';
}
function hasProjectEntityFields(value) {
    return hasEntityFields(value) && typeof value.projectId === 'string';
}
function hasEntityFields(value) {
    return typeof value.id === 'string' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
}
function isMetric(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function isPromotionChannel(value) {
    return typeof value === 'string' && promotionChannels.includes(value);
}
function isPromotionView(value) {
    return typeof value === 'string' && ['overview', 'content', 'assets', 'tasks', 'results'].includes(value);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function sumMetrics(campaigns, key) {
    return campaigns.reduce((total, campaign) => total + campaign[key], 0);
}
function uniquePromotionPlatformTargets(targets) {
    return [...new Map(targets.map((target) => [`${target.campaignId}:${target.unitId ?? ''}`, target])).values()];
}
function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean))];
}
function sumOptionalMetrics(campaigns, key) {
    if (!campaigns.some((campaign) => campaign[key] !== undefined))
        return undefined;
    return campaigns.reduce((total, campaign) => total + (campaign[key] ?? 0), 0);
}
function sumFullyCoveredOptionalMetrics(campaigns, key) {
    if (!campaigns.length || campaigns.some((campaign) => campaign[key] === undefined))
        return undefined;
    return campaigns.reduce((total, campaign) => total + campaign[key], 0);
}
function calculateFullyCoveredOptionalRatio(campaigns, amountKey, ratioKey) {
    if (!campaigns.length)
        return undefined;
    let coveredAmount = 0;
    let totalSpend = 0;
    for (const campaign of campaigns) {
        totalSpend += campaign.spend;
        const amount = campaign[amountKey];
        if (amount !== undefined) {
            coveredAmount += amount;
            continue;
        }
        const ratio = campaign[ratioKey];
        if (ratio === undefined)
            return undefined;
        coveredAmount += ratio * campaign.spend;
    }
    return totalSpend > 0 ? coveredAmount / totalSpend : 0;
}
