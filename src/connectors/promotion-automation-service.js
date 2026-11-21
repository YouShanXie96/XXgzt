"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPromotionAutomationService = createPromotionAutomationService;
exports.isPromotionStoreRuleScheduleDue = isPromotionStoreRuleScheduleDue;
const promotion_main_domain_1 = require("./promotion-main-domain");
const PROMOTION_SYNC_DATE_CONCURRENCY = 5;
const PROMOTION_SYNC_LONG_RANGE_CONCURRENCY = 6;
const PROMOTION_SYNC_PERSIST_BATCH_SIZE = 5;
const PROMOTION_AUTOMATION_MASS_PAUSE_MINIMUM = 5;
const PROMOTION_AUTOMATION_MASS_PAUSE_HARD_LIMIT = 20;
const PROMOTION_AUTOMATION_MASS_PAUSE_RATIO = 0.1;
const PROMOTION_MANUAL_STATUS_CONCURRENCY = 3;
const PROMOTION_PLATFORM_STATUS_CONCURRENCY = 3;
function buildPromotionRuleScanLogs(input) {
    const logs = [];
    for (const rule of input.rules) {
        const ruleMatches = input.matches.filter((match) => match.ruleId === rule.id);
        if (!ruleMatches.length) {
            logs.push({
                id: input.id(),
                campaignId: `scan:${rule.id}`,
                campaignName: '规则巡查',
                profileId: input.profileId,
                ruleId: rule.id,
                ruleName: rule.name,
                action: input.observe ? 'observe' : 'scan',
                status: 'success',
                reason: input.observe
                    ? `${input.createdAt} 已完成观察巡查，无符合执行标准的计划；未调用天猫暂停或恢复接口`
                    : `${input.createdAt} 已完成巡查，无符合执行标准的计划`,
                ...(rule.channels.length === 1 ? { channel: rule.channels[0] } : {}),
                createdAt: input.createdAt
            });
            continue;
        }
        const logCountBeforeMatches = logs.length;
        for (const match of ruleMatches) {
            const campaign = input.campaignByMatch.get(promotionRuleMatchKey(match));
            if (!campaign)
                continue;
            logs.push({
                id: input.id(),
                campaignId: campaign.id,
                campaignName: campaign.name,
                itemId: campaign.itemId ?? campaign.id,
                profileId: input.profileId,
                ruleId: match.ruleId,
                ruleName: match.ruleName,
                action: input.observe ? 'observe' : 'scan',
                status: 'success',
                reason: input.observe
                    ? `${match.reason}；观察模式命中，未调用天猫暂停或恢复接口`
                    : `${match.reason}；本轮仅完成巡查`,
                ...promotionExecutionMetrics(campaign),
                ...buildPromotionExecutionAudit(input.snapshot, input.profileId, match, campaign),
                recoveryScheduled: false,
                createdAt: input.createdAt
            });
        }
        if (logs.length === logCountBeforeMatches) {
            logs.push({
                id: input.id(),
                campaignId: `scan:${rule.id}`,
                campaignName: '规则巡查',
                profileId: input.profileId,
                ruleId: rule.id,
                ruleName: rule.name,
                action: input.observe ? 'observe' : 'scan',
                status: 'skipped',
                reason: input.observe
                    ? `${input.createdAt} 观察巡查命中 ${ruleMatches.length} 条，但无法关联计划明细；未调用天猫暂停或恢复接口`
                    : `${input.createdAt} 巡查命中 ${ruleMatches.length} 条，但无法关联计划明细；本轮未执行任何暂停或恢复`,
                ...(rule.channels.length === 1 ? { channel: rule.channels[0] } : {}),
                recoveryScheduled: false,
                createdAt: input.createdAt
            });
        }
    }
    return logs;
}
function buildPromotionRuleFailureLogs(input) {
    return input.rules.map((rule) => ({
        id: input.id(),
        campaignId: `scan:${rule.id}`,
        campaignName: '规则巡查',
        profileId: input.profileId,
        ruleId: rule.id,
        ruleName: rule.name,
        action: input.observe ? 'observe' : 'scan',
        status: 'failed',
        reason: `${input.createdAt} 到达巡查时间，但${input.reason}；本轮未执行任何暂停或恢复`,
        ...(rule.channels.length === 1 ? { channel: rule.channels[0] } : {}),
        createdAt: input.createdAt
    }));
}
function buildPromotionYesterdayPendingLogs(input) {
    return input.rules.map((rule) => ({
        id: input.id(),
        campaignId: `report-pending:${rule.id}:${input.yesterday}`,
        campaignName: '昨日报表就绪复核',
        profileId: input.profileId,
        ruleId: rule.id,
        ruleName: rule.name,
        action: input.observe ? 'observe' : 'scan',
        status: 'skipped',
        reason: `${input.createdAt} 已到达巡查时间，本轮已从天猫刷新昨日 ${input.yesterday} 数据，但报表尚需连续两次、间隔至少 30 分钟的稳定确认；请保持本机运行，后续巡查会继续复核。本轮不会把缺失数据当作 0，也未执行任何暂停或恢复`,
        ...(rule.channels.length === 1 ? { channel: rule.channels[0] } : {}),
        recoveryScheduled: false,
        createdAt: input.createdAt
    }));
}
function mergePromotionCampaignChannels(existing, incoming, selectedChannels, preserveMissingKeyword) {
    const identity = (campaign) => ((0, promotion_main_domain_1.getPromotionCampaignMetricIdentity)(campaign));
    const existingByIdentity = new Map(existing.map((campaign) => [identity(campaign), campaign]));
    const incomingIdentities = new Set(incoming.map(identity));
    const mergedIncoming = incoming.map((campaign) => {
        if (campaign.channel !== 'keyword')
            return campaign;
        const previous = existingByIdentity.get(identity(campaign));
        if (!previous)
            return campaign;
        return {
            ...campaign,
            platformTargets: [...new Map([
                    ...(previous.platformTargets ?? []),
                    ...(campaign.platformTargets ?? [])
                ].map((target) => [`${target.campaignId}:${target.unitId ?? ''}`, target])).values()],
            sourceCampaignIds: [...new Set([
                    ...(previous.sourceCampaignIds ?? []),
                    ...(campaign.sourceCampaignIds ?? [])
                ])],
            groupIds: [...new Set([...(previous.groupIds ?? []), ...(campaign.groupIds ?? [])])],
            groupNames: [...new Set([...(previous.groupNames ?? []), ...(campaign.groupNames ?? [])])]
        };
    });
    return [
        ...mergedIncoming,
        ...existing.filter((campaign) => ((!selectedChannels.includes(campaign.channel)
            || (preserveMissingKeyword && campaign.channel === 'keyword'))
            && !incomingIdentities.has(identity(campaign))))
    ];
}
function assertPromotionSyncResultCanReplaceChannels(existing, incoming, selectedChannels) {
    if (selectedChannels.length === 0)
        return;
    const channelLabels = {
        product: '全站商品',
        store: '全站全店',
        keyword: '关键词推广'
    };
    const hasActivity = (campaigns) => campaigns.some((campaign) => (campaign.spend > 0
        || campaign.revenue > 0
        || (campaign.netRevenue ?? 0) > 0
        || (campaign.directNetRevenue ?? 0) > 0
        || campaign.orders > 0
        || (campaign.netOrders ?? 0) > 0
        || campaign.clicks > 0
        || campaign.impressions > 0
        || (campaign.cartAdds ?? 0) > 0));
    if (incoming.length === 0) {
        throw new Error('天猫推广登录可能已失效：当前店铺会话未返回任何推广计划；为防止空数据覆盖，旧数据已保留，请重新登录该店铺后重试');
    }
    for (const channel of selectedChannels) {
        const previouslyHadChannel = existing.some((campaign) => campaign.channel === channel);
        const responseHasChannel = incoming.some((campaign) => campaign.channel === channel);
        if (previouslyHadChannel && !responseHasChannel) {
            throw new Error(`天猫推广登录可能已失效：${channelLabels[channel]}同步结果为空，但本地已有该渠道数据；为防止空数据覆盖，旧数据已保留，请重新登录该店铺后重试`);
        }
        const existingChannel = existing.filter((campaign) => campaign.channel === channel);
        const incomingChannel = incoming.filter((campaign) => campaign.channel === channel);
        if (existingChannel.length > 0
            && incomingChannel.length > 0
            && hasActivity(existingChannel)
            && !hasActivity(incomingChannel)) {
            throw new Error(`${channelLabels[channel]}同步返回了非空计划清单，但所有指标均为 0；为防止未就绪报表覆盖正确数据，旧数据已保留，请稍后重试`);
        }
    }
}
function getPromotionCampaignItemTargets(campaign, allowedCampaignIds, includeCampaignLevelTargets = false) {
    if (campaign.platformTargets?.length) {
        const allowed = allowedCampaignIds?.length ? new Set(allowedCampaignIds) : null;
        const targets = campaign.platformTargets.filter((target) => ((!allowed || allowed.has(target.campaignId))
            && (campaign.channel === 'product' || Boolean(target.unitId) || includeCampaignLevelTargets || Boolean(allowed))));
        return [...new Map(targets.map((target) => [
                campaign.channel === 'product' ? target.campaignId : `${target.campaignId}:${target.unitId ?? ''}`,
                campaign.channel === 'product'
                    ? { campaignId: target.campaignId }
                    : {
                        campaignId: target.campaignId,
                        ...(target.unitId ? { platformUnitId: target.unitId } : {})
                    }
            ])).values()];
    }
    return campaign.parentCampaignId && (campaign.channel === 'product' || campaign.platformUnitId)
        ? [{
                campaignId: campaign.parentCampaignId,
                ...(campaign.channel === 'store' && campaign.platformUnitId
                    ? { platformUnitId: campaign.platformUnitId }
                    : {})
            }]
        : [];
}
function createPromotionAutomationService(input) {
    const id = input.id ?? (() => crypto.randomUUID());
    let nowProvider = input.now ?? (() => new Date().toISOString());
    const syncTails = new Map();
    const accountWriteTails = new Map();
    async function appendSyncDiagnostic(accountId, entry) {
        await input.store.appendSyncDiagnostic?.(accountId, entry).catch(() => undefined);
    }
    async function updatePromotionTargetsStatus(profileId, targets, status, authorize) {
        let nextIndex = 0;
        const failures = [];
        const worker = async () => {
            while (true) {
                const target = targets[nextIndex];
                nextIndex += 1;
                if (!target)
                    return;
                try {
                    if (authorize && !await authorize())
                        throw new Error('运行模式已变更，本轮停止新增天猫操作，等待下一轮巡查');
                    await input.platform.updateStatus(profileId, target, status);
                }
                catch (error) {
                    failures.push(`${target.campaignId}${target.platformUnitId ? `/${target.platformUnitId}` : ''}: ${error instanceof Error ? error.message : '未知错误'}`);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(PROMOTION_PLATFORM_STATUS_CONCURRENCY, targets.length) }, () => worker()));
        if (failures.length > 0) {
            throw new Error(`${failures.length} 个天猫推广单元更新失败；${failures.slice(0, 3).join('；')}`);
        }
    }
    async function updateAccountSnapshot(accountId, update) {
        const previous = accountWriteTails.get(accountId) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => {
            release = resolve;
        });
        const tail = previous.catch(() => undefined).then(() => current);
        accountWriteTails.set(accountId, tail);
        await previous.catch(() => undefined);
        try {
            const latest = await input.store.loadSnapshot(accountId);
            const next = update(latest);
            await input.store.saveSnapshot(accountId, next);
            return next;
        }
        finally {
            release();
            if (accountWriteTails.get(accountId) === tail)
                accountWriteTails.delete(accountId);
        }
    }
    async function syncUnlocked(accountId, profileId, request, onProgress) {
        let snapshot = await input.store.loadSnapshot(accountId);
        const now = nowProvider();
        if (Boolean(request?.startDate) !== Boolean(request?.endDate)) {
            throw new Error('同步日期范围必须同时包含开始和结束日期');
        }
        const range = request?.startDate && request.endDate
            ? { startDate: request.startDate, endDate: request.endDate }
            : (0, promotion_main_domain_1.resolvePromotionDateRange)(snapshot.control.datePreset, snapshot.control.includeToday, now, { startDate: snapshot.control.customStartDate, endDate: snapshot.control.customEndDate });
        const requestedDates = (0, promotion_main_domain_1.listPromotionDates)(range.startDate, range.endDate);
        const syncMode = request?.mode ?? 'incremental';
        const selectedChannels = [...new Set((request?.channels?.length
                ? request.channels
                : ['product', 'store'])
                .filter((channel) => channel !== 'keyword'))];
        if (selectedChannels.length === 0) {
            throw new Error('关键词推广已暂停使用，当前不会同步或操作关键词计划');
        }
        const readyProfiles = snapshot.control.fullSyncReadyProfileIds ?? [];
        if (syncMode === 'incremental' && !input.loadSharedHistory && !readyProfiles.includes(profileId)) {
            throw new Error('推广数据安全升级后必须先完成一次全量同步；旧缓存已清理，增量数据不会参与规则判断');
        }
        const today = getShanghaiCalendarDate(now);
        const startedAt = nowProvider();
        onProgress?.({
            profileId,
            mode: syncMode,
            stage: 'syncing',
            phase: 'preparing',
            channels: selectedChannels,
            startedAt,
            startDate: range.startDate,
            endDate: range.endDate,
            currentDate: range.startDate,
            completedDays: 0,
            totalDays: requestedDates.length,
            savedDays: 0,
            activeDays: 0,
            queuedDays: requestedDates.length
        });
        let control = {
            ...snapshot.control,
            selectedProfileId: profileId,
            ...(request?.activateRange ? {
                datePreset: 'custom',
                customStartDate: range.startDate,
                customEndDate: range.endDate,
                backfillStartDate: range.startDate,
                backfillEndDate: range.endDate
            } : {})
        };
        const sharedGapDates = new Set();
        let sharedHistoryPrepared = false;
        if (syncMode === 'incremental' && input.loadSharedHistory) {
            const sharedStartDate = [range.startDate, shiftPromotionCalendarDate(today, -30)]
                .sort((left, right) => left.localeCompare(right))[0];
            const sharedResult = await input.loadSharedHistory({
                accountId,
                profileId,
                startDate: sharedStartDate,
                endDate: today,
                localSnapshots: control.dailySnapshots,
                channels: selectedChannels
            });
            const sharedSnapshots = sharedResult.snapshots.filter((daily) => (daily.profileId === profileId
                && daily.date >= sharedStartDate
                && daily.date <= today));
            if (sharedSnapshots.length > 0) {
                const replacementDates = new Set(sharedSnapshots.map((daily) => daily.date));
                snapshot = await updateAccountSnapshot(accountId, (latest) => ({
                    ...latest,
                    control: {
                        ...latest.control,
                        dailySnapshots: [
                            ...latest.control.dailySnapshots.filter((daily) => (daily.profileId !== profileId || !replacementDates.has(daily.date))),
                            ...sharedSnapshots
                        ].sort((left, right) => left.date.localeCompare(right.date) || left.profileId.localeCompare(right.profileId))
                    }
                }));
                control = snapshot.control;
            }
            for (const date of [
                ...sharedResult.coverage.missingDates,
                ...sharedResult.coverage.pendingDates,
                ...sharedResult.coverage.incompatibleDates
            ]) {
                if (date <= today)
                    sharedGapDates.add(date);
            }
            sharedHistoryPrepared = true;
        }
        const syncDates = [];
        let completedDays = 0;
        let savedDays = 0;
        const yesterday = shiftPromotionCalendarDate(today, -1);
        const canRepairYesterday = Date.parse(now) >= Date.parse(`${today}T06:00:00+08:00`);
        const yesterdaySnapshot = control.dailySnapshots.find((daily) => daily.profileId === profileId && daily.date === yesterday);
        const shouldExtendIncrementalToYesterday = syncMode === 'incremental'
            && requestedDates.includes(today)
            && canRepairYesterday
            && !arePromotionDailyChannelsReady(yesterdaySnapshot, selectedChannels)
            && !requestedDates.includes(yesterday);
        const dates = [...new Set([
                ...(shouldExtendIncrementalToYesterday ? [yesterday] : []),
                ...requestedDates,
                ...sharedGapDates
            ])].sort((left, right) => left.localeCompare(right));
        for (const date of dates) {
            const existing = control.dailySnapshots.find((daily) => daily.profileId === profileId && daily.date === date);
            // Product is the only legacy channel intentionally quarantined during
            // cache migration. Repair it automatically, but do not re-request a
            // final historical day merely because that store never used another
            // optional channel.
            const missingSelectedChannel = Boolean(existing)
                && selectedChannels.includes('product')
                && !existing?.campaigns.some((campaign) => campaign.channel === 'product');
            // Wanxiangtai starts returning yesterday's report at an uncertain point
            // after 06:00. Keep re-reading it every scheduler cycle until two reads,
            // at least 30 minutes apart, have an identical non-empty channel
            // fingerprint. A missing/partial overnight response must never become a
            // trusted business zero.
            const shouldRepairYesterdayReadiness = canRepairYesterday
                && date === yesterday
                && !arePromotionDailyChannelsReady(existing, selectedChannels);
            const shouldSync = syncMode === 'full'
                ? date <= today
                : date === today
                    || sharedGapDates.has(date)
                    || missingSelectedChannel
                    || shouldRepairYesterdayReadiness
                    || (!existing && (0, promotion_main_domain_1.shouldSyncPromotionDay)(undefined, date, now));
            if (!shouldSync) {
                completedDays += 1;
                continue;
            }
            syncDates.push({
                date,
                replaceExisting: Boolean(existing)
                    && (syncMode === 'full' || sharedGapDates.has(date) || missingSelectedChannel || shouldRepairYesterdayReadiness)
            });
        }
        const syncProductRange = input.platform.syncProductRange;
        const productReportDates = selectedChannels.includes('product')
            && syncProductRange
            // Finalized historical facts use the exact date + campaignId + itemId
            // report. Today must stay on OneBP's realtime path; the asynchronous
            // report is not authoritative until the day has finalized. The realtime
            // connector reconciles item rows down to the exact current-day channel
            // summary so lifetime management-list metrics cannot inflate today's
            // spend or authorize a false pause.
            ? syncDates.map((task) => task.date).filter((date) => date < today)
            : [];
        const exactProductDates = new Set(productReportDates);
        const exactProductResultPromise = syncProductRange && productReportDates.length > 0
            ? syncProductRange(profileId, {
                startDate: productReportDates[0],
                endDate: productReportDates.at(-1),
                observedAt: now
            }).then((results) => new Map(results.map((result) => [result.startDate, result])))
            : null;
        let nextSyncIndex = 0;
        let startedDays = 0;
        let activeDays = 0;
        let commitTail = Promise.resolve();
        const pendingResults = [];
        const expectedPersistedByDate = new Map();
        const failureState = { first: null };
        const emitProgress = (currentDate, phase = 'fetching') => {
            onProgress?.({
                profileId,
                mode: syncMode,
                stage: 'syncing',
                phase,
                channels: selectedChannels,
                startedAt,
                startDate: range.startDate,
                endDate: range.endDate,
                currentDate,
                completedDays,
                totalDays: dates.length,
                savedDays,
                activeDays,
                queuedDays: Math.max(0, syncDates.length - startedDays)
            });
        };
        const applyPendingResult = (latest, pending) => {
            const { task, result, preserveMissingKeyword } = pending;
            const existingDaily = latest.control.dailySnapshots.find((daily) => (daily.profileId === profileId && daily.date === task.date));
            assertPromotionSyncResultCanReplaceChannels(existingDaily?.campaigns ?? [], result.campaigns, selectedChannels);
            const shouldMergeExisting = Boolean(existingDaily)
                && (selectedChannels.length < 3 || preserveMissingKeyword);
            const campaigns = shouldMergeExisting && existingDaily
                ? mergePromotionCampaignChannels(existingDaily.campaigns, result.campaigns, selectedChannels, preserveMissingKeyword)
                : result.campaigns;
            const rangedControl = request?.activateRange
                ? {
                    ...latest.control,
                    datePreset: 'custom',
                    customStartDate: range.startDate,
                    customEndDate: range.endDate,
                    backfillStartDate: range.startDate,
                    backfillEndDate: range.endDate
                }
                : latest.control;
            // Keep the previous snapshot in place until upsert has compared its
            // channel fingerprint. Removing it here would make every 30-minute read
            // look like a first read and yesterday could never become ready.
            let nextControl = rangedControl;
            nextControl = (0, promotion_main_domain_1.upsertPromotionDailySnapshot)(nextControl, {
                profileId,
                date: task.date,
                syncedAt: nowProvider(),
                campaigns,
                channels: selectedChannels
            });
            nextControl = (0, promotion_main_domain_1.selectPromotionControlDateRange)(nextControl, nowProvider());
            return { ...latest, control: nextControl };
        };
        const flushPendingResults = async () => {
            if (pendingResults.length === 0)
                return;
            const batch = pendingResults.splice(0, pendingResults.length);
            const currentDate = batch.at(-1)?.task.date ?? range.endDate;
            emitProgress(currentDate, 'saving');
            snapshot = await updateAccountSnapshot(accountId, (latest) => (batch.reduce(applyPendingResult, latest)));
            control = snapshot.control;
            savedDays += batch.length;
            completedDays += batch.length;
            await appendSyncDiagnostic(accountId, {
                eventId: id(),
                at: nowProvider(),
                profileId,
                stage: 'persist-batch',
                mode: syncMode,
                channels: selectedChannels,
                startDate: range.startDate,
                endDate: range.endDate,
                date: currentDate,
                persistedDays: batch.length,
                result: `累计已保存 ${savedDays}/${dates.length} 天`
            });
            emitProgress(currentDate, 'fetching');
        };
        const persistResult = (task, result, preserveMissingKeyword) => {
            const commit = commitTail.then(async () => {
                pendingResults.push({ task, result, preserveMissingKeyword });
                if (pendingResults.length >= PROMOTION_SYNC_PERSIST_BATCH_SIZE) {
                    await flushPendingResults();
                }
            });
            commitTail = commit.catch(() => undefined);
            return commit;
        };
        const worker = async () => {
            while (!failureState.first) {
                const task = syncDates[nextSyncIndex];
                nextSyncIndex += 1;
                if (!task)
                    return;
                startedDays += 1;
                activeDays += 1;
                emitProgress(task.date, 'fetching');
                try {
                    let result;
                    const useExactProductRead = Boolean(exactProductResultPromise && exactProductDates.has(task.date));
                    if (useExactProductRead) {
                        const directChannels = selectedChannels.filter((channel) => (!(useExactProductRead && channel === 'product')));
                        const directPromise = directChannels.length > 0
                            ? input.platform.sync(profileId, {
                                startDate: task.date,
                                endDate: task.date,
                                channels: directChannels
                            })
                            : null;
                        try {
                            const [directResult, exactProductResults] = await Promise.all([
                                directPromise,
                                useExactProductRead ? exactProductResultPromise : null
                            ]);
                            const productResult = useExactProductRead ? exactProductResults?.get(task.date) : null;
                            if (useExactProductRead && !productResult) {
                                throw new Error(`全站商品明细报表缺少 ${task.date} 数据`);
                            }
                            result = {
                                campaigns: [
                                    ...(directResult?.campaigns ?? []),
                                    ...(productResult?.campaigns ?? [])
                                ],
                                observedAt: directResult?.observedAt
                                    ?? productResult?.observedAt
                                    ?? now,
                                startDate: task.date,
                                endDate: task.date
                            };
                        }
                        catch (error) {
                            const reason = error instanceof Error ? error.message : '商品明细报表返回未知错误';
                            throw new Error(`全站商品明细同步失败，已禁止规则执行：${reason}`);
                        }
                    }
                    else {
                        result = await input.platform.sync(profileId, {
                            startDate: task.date,
                            endDate: task.date,
                            channels: selectedChannels
                        });
                    }
                    const diagnosticTotals = result.campaigns.reduce((totals, campaign) => ({
                        spend: totals.spend + Number(campaign.spend || 0),
                        revenue: totals.revenue + Number(campaign.revenue || 0),
                        clicks: totals.clicks + Number(campaign.clicks || 0),
                        orders: totals.orders + Number(campaign.orders || 0)
                    }), { spend: 0, revenue: 0, clicks: 0, orders: 0 });
                    expectedPersistedByDate.set(task.date, {
                        campaigns: result.campaigns.length,
                        ...diagnosticTotals
                    });
                    await appendSyncDiagnostic(accountId, {
                        eventId: id(),
                        at: nowProvider(),
                        profileId,
                        stage: 'fetch-day',
                        mode: syncMode,
                        channels: selectedChannels,
                        startDate: range.startDate,
                        endDate: range.endDate,
                        date: task.date,
                        returnedCampaigns: result.campaigns.length,
                        ...diagnosticTotals,
                        result: result.campaigns.length > 0 ? '平台返回数据' : '平台返回空列表'
                    });
                    await persistResult(task, result, false);
                    activeDays -= 1;
                    emitProgress(task.date, 'fetching');
                }
                catch (error) {
                    activeDays -= 1;
                    failureState.first ??= {
                        date: task.date,
                        reason: error instanceof Error ? error.message : '平台返回未知错误'
                    };
                    return;
                }
            }
        };
        emitProgress(syncDates[0]?.date ?? range.startDate, 'preparing');
        const dateConcurrency = syncDates.length >= 14
            ? PROMOTION_SYNC_LONG_RANGE_CONCURRENCY
            : PROMOTION_SYNC_DATE_CONCURRENCY;
        await Promise.all(Array.from({ length: Math.min(dateConcurrency, syncDates.length) }, () => worker()));
        try {
            await commitTail;
            await flushPendingResults();
        }
        catch (error) {
            failureState.first ??= {
                date: pendingResults.at(-1)?.task.date ?? range.endDate,
                reason: error instanceof Error ? error.message : '本地批量保存推广数据失败'
            };
        }
        const failure = failureState.first;
        if (failure) {
            const isLoginRequired = /尚未登录天猫推广|完成登录/.test(failure.reason);
            const failureMessage = isLoginRequired || (dates.length === 1 && savedDays === 0)
                ? failure.reason
                : `补齐 ${failure.date} 推广数据失败；已保存 ${savedDays} 天，可稍后重试继续补齐。${failure.reason}`;
            onProgress?.({
                profileId,
                mode: syncMode,
                stage: 'failed',
                phase: 'failed',
                channels: selectedChannels,
                startedAt,
                finishedAt: nowProvider(),
                error: failureMessage,
                startDate: range.startDate,
                endDate: range.endDate,
                currentDate: failure.date,
                completedDays,
                totalDays: dates.length,
                savedDays,
                activeDays: 0,
                queuedDays: Math.max(0, syncDates.length - startedDays)
            });
            if (dates.length === 1 && savedDays === 0) {
                throw new Error(failureMessage);
            }
            throw new Error(failureMessage);
        }
        if (expectedPersistedByDate.size > 0) {
            const expectedTotals = Array.from(expectedPersistedByDate.values()).reduce((totals, day) => ({
                campaigns: totals.campaigns + day.campaigns,
                spend: totals.spend + day.spend,
                revenue: totals.revenue + day.revenue,
                clicks: totals.clicks + day.clicks,
                orders: totals.orders + day.orders
            }), { campaigns: 0, spend: 0, revenue: 0, clicks: 0, orders: 0 });
            if (syncMode === 'full' && expectedTotals.campaigns === 0) {
                throw new Error('平台本次全量同步返回 0 条推广计划，已拒绝把空结果标记为同步成功；请打开店铺后台核对登录状态、推广权限及是否存在推广计划后重试');
            }
            const persistedSnapshot = await input.store.loadSnapshot(accountId);
            const mismatches = [];
            const nearlyEqual = (left, right) => Math.abs(left - right) <= 0.005;
            for (const [date, expected] of expectedPersistedByDate) {
                const persistedDay = persistedSnapshot.control.dailySnapshots.find((daily) => (daily.profileId === profileId && daily.date === date));
                if (!persistedDay) {
                    mismatches.push(`${date}: 未找到本地分日事实`);
                    continue;
                }
                const persistedCampaigns = persistedDay.campaigns.filter((campaign) => (selectedChannels.includes(campaign.channel)));
                const persisted = persistedCampaigns.reduce((totals, campaign) => ({
                    campaigns: totals.campaigns + 1,
                    spend: totals.spend + Number(campaign.spend || 0),
                    revenue: totals.revenue + Number(campaign.revenue || 0),
                    clicks: totals.clicks + Number(campaign.clicks || 0),
                    orders: totals.orders + Number(campaign.orders || 0)
                }), { campaigns: 0, spend: 0, revenue: 0, clicks: 0, orders: 0 });
                if (persisted.campaigns !== expected.campaigns
                    || !nearlyEqual(persisted.spend, expected.spend)
                    || !nearlyEqual(persisted.revenue, expected.revenue)
                    || persisted.clicks !== expected.clicks
                    || persisted.orders !== expected.orders) {
                    mismatches.push(`${date}: 平台 ${expected.campaigns} 条/花费 ${expected.spend.toFixed(2)}，本地 ${persisted.campaigns} 条/花费 ${persisted.spend.toFixed(2)}`);
                }
            }
            if (mismatches.length > 0) {
                throw new Error(`本地推广数据库写入后回读不一致，已禁止标记同步成功：${mismatches.slice(0, 3).join('；')}。请保留本地数据和诊断记录，修复后再全量同步`);
            }
            snapshot = persistedSnapshot;
            control = snapshot.control;
            await appendSyncDiagnostic(accountId, {
                eventId: id(),
                at: nowProvider(),
                profileId,
                stage: 'persist-verify',
                mode: syncMode,
                channels: selectedChannels,
                startDate: range.startDate,
                endDate: range.endDate,
                returnedCampaigns: expectedTotals.campaigns,
                spend: expectedTotals.spend,
                revenue: expectedTotals.revenue,
                clicks: expectedTotals.clicks,
                orders: expectedTotals.orders,
                persistedDays: expectedPersistedByDate.size,
                result: `本地回读校验通过 ${expectedPersistedByDate.size} 天`
            });
        }
        if (savedDays === 0) {
            snapshot = await updateAccountSnapshot(accountId, (latest) => ({
                ...latest,
                control: request?.activateRange
                    ? (0, promotion_main_domain_1.selectPromotionControlDateRange)({
                        ...latest.control,
                        datePreset: 'custom',
                        customStartDate: range.startDate,
                        customEndDate: range.endDate,
                        backfillStartDate: range.startDate,
                        backfillEndDate: range.endDate
                    }, nowProvider())
                    : latest.control
            }));
            control = snapshot.control;
        }
        if ((syncMode === 'full' || sharedHistoryPrepared)
            && selectedChannels.includes('product')
            && selectedChannels.includes('store')) {
            snapshot = await updateAccountSnapshot(accountId, (latest) => ({
                ...latest,
                control: {
                    ...latest.control,
                    dataTrustVersion: promotion_main_domain_1.CURRENT_PROMOTION_DATA_TRUST_VERSION,
                    fullSyncReadyProfileIds: [...new Set([
                            ...(latest.control.fullSyncReadyProfileIds ?? []),
                            profileId
                        ])]
                }
            }));
        }
        onProgress?.({
            profileId,
            mode: syncMode,
            stage: 'completed',
            phase: 'completed',
            channels: selectedChannels,
            startedAt,
            finishedAt: nowProvider(),
            startDate: range.startDate,
            endDate: range.endDate,
            currentDate: range.endDate,
            completedDays: dates.length,
            totalDays: dates.length,
            savedDays,
            activeDays: 0,
            queuedDays: 0
        });
        return {
            snapshot,
            syncedDates: [...expectedPersistedByDate.keys()].sort((left, right) => left.localeCompare(right))
        };
    }
    async function sync(accountId, profileId, request, onProgress) {
        const key = `${accountId}\u0000${profileId}`;
        const previous = syncTails.get(key) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => {
            release = resolve;
        });
        const tail = previous.catch(() => undefined).then(() => current);
        syncTails.set(key, tail);
        await previous.catch(() => undefined);
        const syncEventId = id();
        const startedAt = nowProvider();
        try {
            await appendSyncDiagnostic(accountId, {
                eventId: syncEventId,
                at: startedAt,
                profileId,
                stage: 'sync-start',
                mode: request?.mode ?? 'incremental',
                channels: request?.channels,
                startDate: request?.startDate,
                endDate: request?.endDate,
                result: request?.rebuildLocalProfile ? '全量同步前重建当前店铺推广缓存' : '开始同步'
            });
            if (request?.rebuildLocalProfile) {
                if (!input.store.resetProfileMetrics) {
                    throw new Error('当前版本不支持重建店铺推广缓存，请升级后重试');
                }
                const resetResult = await input.store.resetProfileMetrics(accountId, profileId, request.mode === 'full' ? 'full-sync-rebuild' : 'manual-rebuild');
                await appendSyncDiagnostic(accountId, {
                    eventId: syncEventId,
                    at: nowProvider(),
                    profileId,
                    stage: 'cache-reset',
                    mode: request?.mode ?? 'incremental',
                    channels: request?.channels,
                    startDate: request?.startDate,
                    endDate: request?.endDate,
                    persistedDays: resetResult.removedDailySnapshots,
                    returnedCampaigns: resetResult.removedCampaigns,
                    result: `已重建当前店铺缓存；移除 ${resetResult.removedDailySnapshots} 天、${resetResult.removedCampaigns} 条事实`
                });
            }
            const syncResult = await syncUnlocked(accountId, profileId, request, onProgress);
            const result = syncResult.snapshot;
            const syncedDateSet = new Set(syncResult.syncedDates);
            const historyArchive = await input.archiveHistory?.({
                accountId,
                profileId,
                // Only send dates fetched and committed by this synchronization. The
                // previous implementation resent every historical shard in the local
                // profile after each small rule patrol. Shared NAS facts could be
                // serialized in a different order with the same syncedAt and trigger a
                // false conflict, while also multiplying network and server work.
                snapshots: result.control.dailySnapshots.filter((daily) => (daily.profileId === profileId && syncedDateSet.has(daily.date)))
            });
            await appendSyncDiagnostic(accountId, {
                eventId: syncEventId,
                at: nowProvider(),
                profileId,
                stage: 'sync-complete',
                mode: request?.mode ?? 'incremental',
                channels: request?.channels,
                startDate: request?.startDate,
                endDate: request?.endDate,
                result: historyArchive
                    ? `同步完成并已写入本地事实表；${historyArchive.message}`
                    : '同步完成并已写入本地事实表'
            });
            return result;
        }
        catch (error) {
            await appendSyncDiagnostic(accountId, {
                eventId: syncEventId,
                at: nowProvider(),
                profileId,
                stage: 'sync-failed',
                mode: request?.mode ?? 'incremental',
                channels: request?.channels,
                startDate: request?.startDate,
                endDate: request?.endDate,
                errorCode: error instanceof Error && /回读不一致/.test(error.message)
                    ? 'PROMOTION_LOCAL_READBACK_MISMATCH'
                    : error instanceof Error && /返回 0 条推广计划|未返回任何推广计划/.test(error.message)
                        ? 'PROMOTION_REMOTE_EMPTY_RESULT'
                        : 'PROMOTION_SYNC_FAILED',
                message: error instanceof Error ? error.message : '推广同步发生未知错误'
            });
            throw error;
        }
        finally {
            release();
            if (syncTails.get(key) === tail)
                syncTails.delete(key);
        }
    }
    async function runRules(accountId, profileId, options = {}) {
        let snapshot = await input.store.loadSnapshot(accountId);
        const evaluationNow = nowProvider();
        if (options.dueOnly && !isPromotionStoreRuleScheduleDue(snapshot, profileId, evaluationNow)) {
            return { snapshot, matches: [], actions: [] };
        }
        const applicableRules = snapshot.control.rules.filter((rule) => rule.enabled
            && !rule.channels.includes('keyword')
            && (!options.ruleIds || options.ruleIds.includes(rule.id))
            && (!rule.profileIds?.length || rule.profileIds.includes(profileId)));
        if (applicableRules.length === 0) {
            return { snapshot, matches: [], actions: [] };
        }
        const observationMode = (0, promotion_main_domain_1.getPromotionStoreMode)(snapshot.control, profileId) === 'observe';
        const startingModeRevision = snapshot.control.modeRevision ?? 0;
        const modeStillAuthorized = async () => {
            const latest = await input.store.loadSnapshot(accountId);
            return (0, promotion_main_domain_1.getPromotionStoreMode)(latest.control, profileId) === 'automatic'
                && (latest.control.modeRevision ?? 0) === startingModeRevision;
        };
        const wasDataReady = (snapshot.control.fullSyncReadyProfileIds ?? []).includes(profileId);
        // Cache migrations deliberately invalidate all promotion facts.  A rule
        // runner must never rebuild that trust flag by itself: the operator must
        // complete an explicit full sync first, so stale/partial local data cannot
        // become eligible for a destructive action during a background scan.
        if (!wasDataReady) {
            const failureLogs = buildPromotionRuleFailureLogs({
                id,
                profileId,
                rules: applicableRules,
                createdAt: evaluationNow,
                reason: '本地数据尚未通过新版全量同步校验',
                observe: observationMode
            });
            snapshot = markPromotionRulesEvaluated({
                ...snapshot,
                control: { ...snapshot.control, logs: [...failureLogs, ...snapshot.control.logs].slice(0, 500) }
            }, profileId, applicableRules.map((rule) => rule.id), evaluationNow);
            await input.store.saveSnapshot(accountId, snapshot);
            return { snapshot, matches: [], actions: failureLogs };
        }
        const ruleEvaluations = applicableRules.map((rule) => {
            // Legacy rules did not persist their own date range. Following the
            // operator's mutable workbench filter can silently turn a same-day rule
            // into a 30-day destructive rule, so fail safe to today.
            const range = (0, promotion_main_domain_1.resolvePromotionDateRange)(rule.datePreset ?? 'today', rule.includeToday ?? true, evaluationNow, { startDate: rule.customStartDate ?? '', endDate: rule.customEndDate ?? '' });
            return { rule, range };
        });
        const syncStartDate = ruleEvaluations.reduce((earliest, item) => item.range.startDate < earliest ? item.range.startDate : earliest, ruleEvaluations[0].range.startDate);
        const syncEndDate = ruleEvaluations.reduce((latest, item) => item.range.endDate > latest ? item.range.endDate : latest, ruleEvaluations[0].range.endDate);
        const ruleChannels = [...new Set(applicableRules
                .flatMap((rule) => rule.channels)
                .filter((channel) => channel !== 'keyword'))];
        try {
            snapshot = await sync(accountId, profileId, {
                startDate: syncStartDate,
                endDate: syncEndDate,
                channels: ruleChannels,
                // Conversion attribution can arrive after the original day was cached.
                // A destructive rule must therefore refresh every day in its own window
                // before evaluating, otherwise a stale zero-ROI snapshot can pause a
                // profitable campaign.
                mode: 'full'
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const failureLogs = buildPromotionRuleFailureLogs({
                id,
                profileId,
                rules: applicableRules,
                createdAt: evaluationNow,
                reason: `巡查前最新数据同步失败（${message}）`,
                observe: observationMode
            });
            snapshot = markPromotionRulesEvaluated({
                ...snapshot,
                control: { ...snapshot.control, logs: [...failureLogs, ...snapshot.control.logs].slice(0, 500) }
            }, profileId, applicableRules.map((rule) => rule.id), evaluationNow);
            await input.store.saveSnapshot(accountId, snapshot);
            return { snapshot, matches: [], actions: failureLogs };
        }
        const yesterday = shiftPromotionCalendarDate(getShanghaiCalendarDate(evaluationNow), -1);
        let evaluationSnapshot = snapshot;
        if (input.prepareRuleSnapshots) {
            try {
                const prepared = await input.prepareRuleSnapshots({
                    accountId,
                    profileId,
                    startDate: syncStartDate,
                    endDate: syncEndDate,
                    localSnapshots: snapshot.control.dailySnapshots,
                    channels: ruleChannels
                });
                if (!prepared.automationSafe) {
                    const problemDates = [...new Set([
                            ...(prepared.missingDates ?? []),
                            ...(prepared.pendingDates ?? []),
                            ...(prepared.incompatibleDates ?? [])
                        ])];
                    const localYesterdaySnapshot = snapshot.control.dailySnapshots.find((daily) => (daily.profileId === profileId && daily.date === yesterday));
                    const isFreshYesterdayWaitingForStability = (prepared.incompatibleDates?.length ?? 0) === 0
                        && problemDates.length === 1
                        && problemDates[0] === yesterday
                        && Boolean(localYesterdaySnapshot)
                        && !arePromotionDailyChannelsReady(localYesterdaySnapshot, ruleChannels);
                    if (isFreshYesterdayWaitingForStability) {
                        // The full refresh above has already repaired the local fact.  It
                        // cannot be archived until the second stable read, so keep the NAS
                        // data for older days, defer only rules that depend on yesterday,
                        // and let the existing 30-minute scheduler resume automatically.
                        evaluationSnapshot = {
                            ...snapshot,
                            control: { ...snapshot.control, dailySnapshots: prepared.snapshots }
                        };
                    }
                    else {
                        const failureLogs = buildPromotionRuleFailureLogs({
                            id,
                            profileId,
                            rules: applicableRules,
                            createdAt: evaluationNow,
                            reason: prepared.message ?? '本地历史数据尚未满足规则执行条件',
                            observe: observationMode
                        });
                        snapshot = markPromotionRulesEvaluated({
                            ...snapshot,
                            control: { ...snapshot.control, logs: [...failureLogs, ...snapshot.control.logs].slice(0, 500) }
                        }, profileId, applicableRules.map((rule) => rule.id), evaluationNow);
                        await input.store.saveSnapshot(accountId, snapshot);
                        return { snapshot, matches: [], actions: failureLogs };
                    }
                }
                else {
                    evaluationSnapshot = {
                        ...snapshot,
                        control: { ...snapshot.control, dailySnapshots: prepared.snapshots }
                    };
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const failureLogs = buildPromotionRuleFailureLogs({
                    id,
                    profileId,
                    rules: applicableRules,
                    createdAt: evaluationNow,
                    reason: `本地历史数据校验失败（${message}）`,
                    observe: observationMode
                });
                snapshot = markPromotionRulesEvaluated({
                    ...snapshot,
                    control: { ...snapshot.control, logs: [...failureLogs, ...snapshot.control.logs].slice(0, 500) }
                }, profileId, applicableRules.map((rule) => rule.id), evaluationNow);
                await input.store.saveSnapshot(accountId, snapshot);
                return { snapshot, matches: [], actions: failureLogs };
            }
        }
        const yesterdaySnapshot = evaluationSnapshot.control.dailySnapshots.find((daily) => (daily.profileId === profileId && daily.date === yesterday));
        const pendingYesterdayEvaluations = ruleEvaluations.filter(({ rule, range }) => (range.startDate <= yesterday
            && range.endDate >= yesterday
            && !arePromotionDailyChannelsReady(yesterdaySnapshot, rule.channels.filter((channel) => channel !== 'keyword'))));
        const pendingRuleIds = new Set(pendingYesterdayEvaluations.map(({ rule }) => rule.id));
        const readyRuleEvaluations = ruleEvaluations.filter(({ rule }) => !pendingRuleIds.has(rule.id));
        const yesterdayPendingLogs = buildPromotionYesterdayPendingLogs({
            id,
            profileId,
            rules: pendingYesterdayEvaluations.map(({ rule }) => rule),
            yesterday,
            createdAt: evaluationNow,
            observe: observationMode
        });
        if (readyRuleEvaluations.length === 0) {
            snapshot = markPromotionRulesEvaluated({
                ...snapshot,
                control: {
                    ...snapshot.control,
                    logs: [...yesterdayPendingLogs, ...snapshot.control.logs].slice(0, 500)
                }
            }, profileId, applicableRules.map((rule) => rule.id), evaluationNow);
            await input.store.saveSnapshot(accountId, snapshot);
            return { snapshot, matches: [], actions: yesterdayPendingLogs };
        }
        const matches = [];
        const campaignByMatch = new Map();
        const readyRules = readyRuleEvaluations.map(({ rule }) => rule);
        const ruleById = new Map(readyRules.map((rule) => [rule.id, rule]));
        for (const { rule, range } of readyRuleEvaluations) {
            const campaigns = (0, promotion_main_domain_1.aggregatePromotionDailyCampaigns)(evaluationSnapshot.control.dailySnapshots, profileId, range.startDate, range.endDate);
            const ruleMatches = (0, promotion_main_domain_1.evaluatePromotionRules)(campaigns, [rule], profileId);
            matches.push(...ruleMatches);
            for (const match of ruleMatches) {
                const campaign = campaigns.find((candidate) => (candidate.channel === match.channel
                    && (candidate.itemId ?? candidate.id) === match.itemId
                    && (0, promotion_main_domain_1.getPromotionCampaignPlanId)(candidate) === match.platformCampaignId));
                if (campaign)
                    campaignByMatch.set(promotionRuleMatchKey(match), campaign);
            }
        }
        if (observationMode) {
            const observationLogs = buildPromotionRuleScanLogs({
                id,
                profileId,
                rules: readyRules,
                matches,
                campaignByMatch,
                createdAt: evaluationNow,
                observe: true,
                snapshot: evaluationSnapshot
            });
            snapshot = markPromotionRulesEvaluated({
                ...snapshot,
                control: {
                    ...snapshot.control,
                    logs: [...yesterdayPendingLogs, ...observationLogs, ...snapshot.control.logs].slice(0, 500)
                }
            }, profileId, applicableRules.map((rule) => rule.id), evaluationNow);
            await input.store.saveSnapshot(accountId, snapshot);
            return { snapshot, matches, actions: [...yesterdayPendingLogs, ...observationLogs] };
        }
        if (!await modeStillAuthorized()) {
            const logs = buildPromotionRuleFailureLogs({ id, profileId, rules: readyRules,
                createdAt: evaluationNow, reason: '巡查过程中运行模式已变更，本轮未执行天猫操作，等待下一轮巡查', observe: false
            }).map((log) => ({ ...log, status: 'skipped' }));
            snapshot = markPromotionRulesEvaluated({ ...snapshot, control: { ...snapshot.control,
                    logs: [...logs, ...snapshot.control.logs].slice(0, 500)
                } }, profileId, applicableRules.map((rule) => rule.id), evaluationNow);
            await input.store.saveSnapshot(accountId, snapshot);
            return { snapshot: await input.store.loadSnapshot(accountId), matches: [], actions: logs };
        }
        const verificationByMatch = await verifyPromotionRuleMatches({
            platform: input.platform,
            profileId,
            snapshot: evaluationSnapshot,
            matches,
            ruleEvaluations: readyRuleEvaluations,
            campaignByMatch,
            checkedAt: nowProvider()
        });
        // A sudden large batch of independently matching pause decisions is more
        // likely to be a report/parser/store-binding anomaly than a real change in
        // dozens of products at once. Stop the whole destructive batch and leave
        // an auditable skipped record; operators can inspect the daily evidence or
        // use the explicit manual batch action after confirming the data.
        for (const channel of ['product', 'store']) {
            const verifiedPauses = matches.filter((match) => (match.action === 'pause'
                && match.channel === channel
                && verificationByMatch.get(promotionRuleMatchKey(match))?.matched));
            const activeCampaignCount = snapshot.control.campaigns.filter((campaign) => (campaign.channel === channel && campaign.status === 'active')).length;
            const shouldTripMassPauseCircuit = verifiedPauses.length >= PROMOTION_AUTOMATION_MASS_PAUSE_MINIMUM
                && (verifiedPauses.length >= PROMOTION_AUTOMATION_MASS_PAUSE_HARD_LIMIT
                    || verifiedPauses.length / Math.max(1, activeCampaignCount) >= PROMOTION_AUTOMATION_MASS_PAUSE_RATIO);
            if (!shouldTripMassPauseCircuit)
                continue;
            const reason = `本轮${channel === 'product' ? '全站商品' : '全站全店'}规则一次命中 ${verifiedPauses.length} 个暂停对象，超过安全阈值；已触发批量误停保护，未修改天猫后台。请先核对执行明细后再人工处理`;
            for (const match of verifiedPauses) {
                const key = promotionRuleMatchKey(match);
                const verification = verificationByMatch.get(key);
                verificationByMatch.set(key, {
                    source: verification?.source ?? (channel === 'product' ? 'item-report' : 'second-read'),
                    checkedAt: verification?.checkedAt ?? nowProvider(),
                    matched: false,
                    reason,
                    dailyMetrics: verification?.dailyMetrics
                });
            }
        }
        const actions = [...yesterdayPendingLogs];
        const pendingActions = [];
        const pendingKeys = new Set();
        for (const match of matches) {
            if (match.action === 'pause' && snapshot.control.recoveries.some((recovery) => recovery.profileId === profileId
                && recovery.channel === match.channel
                && recovery.itemId === match.itemId
                && recovery.platformCampaignId === match.platformCampaignId
                && recovery.status === 'pending')) {
                continue;
            }
            const campaign = campaignByMatch.get(promotionRuleMatchKey(match));
            if (!campaign)
                continue;
            const createdAt = nowProvider();
            const targetStatus = match.action === 'pause' ? 'paused' : 'active';
            const logAction = match.action === 'pause' ? 'pause' : 'restore';
            const audit = buildPromotionExecutionAudit(evaluationSnapshot, profileId, match, campaign);
            const verification = verificationByMatch.get(promotionRuleMatchKey(match));
            if (!verification?.matched) {
                const log = {
                    id: id(),
                    campaignId: campaign.id,
                    campaignName: campaign.name,
                    itemId: campaign.itemId ?? campaign.id,
                    profileId,
                    ruleId: match.ruleId,
                    ruleName: match.ruleName,
                    action: logAction,
                    status: 'skipped',
                    reason: verification?.reason ?? '暂停前数据复核没有返回明确结果，本次已安全跳过',
                    ...promotionExecutionMetrics(campaign),
                    ...audit,
                    metricVerification: verification,
                    recoveryScheduled: logAction === 'pause' ? false : undefined,
                    createdAt
                };
                snapshot = {
                    ...snapshot,
                    control: { ...snapshot.control, logs: [log, ...snapshot.control.logs].slice(0, 500) }
                };
                actions.push(log);
                continue;
            }
            let targets;
            try {
                targets = getPromotionCampaignItemTargets(campaign, ruleById.get(match.ruleId)?.campaignIds);
                if (targets.length === 0) {
                    const channelLabel = campaign.channel === 'product'
                        ? '全站商品'
                        : campaign.channel === 'store' ? '全站全店' : '关键词推广';
                    throw new Error(`商品 ${campaign.itemId ?? campaign.id} 在${channelLabel}未取得可执行的推广单元 ID；巡查前已自动同步最新数据，本次已安全跳过，未操作其他渠道或整条计划`);
                }
            }
            catch (error) {
                const log = {
                    id: id(),
                    campaignId: campaign.id,
                    campaignName: campaign.name,
                    itemId: campaign.itemId ?? campaign.id,
                    profileId,
                    ruleId: match.ruleId,
                    ruleName: match.ruleName,
                    action: logAction,
                    status: 'failed',
                    reason: error instanceof Error ? error.message : match.action === 'pause' ? '暂停计划失败' : '恢复计划失败',
                    ...promotionExecutionMetrics(campaign),
                    ...audit,
                    metricVerification: verification,
                    recoveryScheduled: logAction === 'pause' ? false : undefined,
                    createdAt
                };
                snapshot = {
                    ...snapshot,
                    control: { ...snapshot.control, logs: [log, ...snapshot.control.logs].slice(0, 500) }
                };
                actions.push(log);
                continue;
            }
            const pendingKey = `${match.action}:${campaign.channel}:${targets
                .map((target) => `${target.campaignId}:${target.platformUnitId ?? ''}`)
                .sort()
                .join(',')}`;
            if (pendingKeys.has(pendingKey))
                continue;
            let mutationError;
            if (!await modeStillAuthorized()) {
                const log = {
                    id: id(), campaignId: campaign.id, campaignName: campaign.name,
                    itemId: campaign.itemId ?? campaign.id, profileId, ruleId: match.ruleId, ruleName: match.ruleName,
                    action: logAction, status: 'skipped', reason: '运行模式已变更，本轮未执行天猫操作，等待下一轮巡查',
                    ...promotionExecutionMetrics(campaign), ...audit, metricVerification: verification,
                    recoveryScheduled: false, createdAt
                };
                snapshot = { ...snapshot, control: { ...snapshot.control, logs: [log, ...snapshot.control.logs].slice(0, 500) } };
                actions.push(log);
                continue;
            }
            try {
                await updatePromotionTargetsStatus(profileId, targets, targetStatus, modeStillAuthorized);
            }
            catch (error) {
                // The platform occasionally returns a transport error even though the
                // mutation reached Tmall. Always perform the authoritative read-back
                // before deciding whether the rule action succeeded.
                mutationError = error instanceof Error ? error.message : '天猫推广状态更新接口返回异常';
            }
            pendingActions.push({ match, campaign, targets, targetStatus, logAction, createdAt, mutationError });
            pendingKeys.add(pendingKey);
        }
        if (pendingActions.length > 0) {
            let verificationResults;
            try {
                verificationResults = await input.platform.verifyStatuses(profileId, pendingActions.map(({ campaign, targets, targetStatus }) => ({
                    campaignId: campaign.id,
                    itemId: campaign.itemId ?? campaign.id,
                    channel: campaign.channel,
                    targets,
                    expectedStatus: targetStatus
                })));
            }
            catch (error) {
                const reason = error instanceof Error
                    ? `天猫后台状态确认失败：${error.message}`
                    : '天猫后台状态确认失败';
                verificationResults = pendingActions.map(() => ({ confirmed: false, reason }));
            }
            for (const [index, pending] of pendingActions.entries()) {
                const verification = verificationResults[index] ?? {
                    confirmed: false,
                    reason: '天猫后台没有返回对应商品的状态确认结果'
                };
                const { match, campaign, targetStatus, logAction, createdAt, mutationError } = pending;
                const audit = buildPromotionExecutionAudit(evaluationSnapshot, profileId, match, campaign);
                const metricVerification = verificationByMatch.get(promotionRuleMatchKey(match));
                if (!verification.confirmed) {
                    const log = {
                        id: id(),
                        campaignId: campaign.id,
                        campaignName: campaign.name,
                        itemId: campaign.itemId ?? campaign.id,
                        profileId,
                        ruleId: match.ruleId,
                        ruleName: match.ruleName,
                        action: logAction,
                        status: 'failed',
                        reason: [mutationError, verification.reason || '天猫后台未确认推广状态已修改']
                            .filter(Boolean)
                            .join('；'),
                        ...promotionExecutionMetrics(campaign),
                        ...audit,
                        metricVerification,
                        verification: {
                            source: 'status-readback',
                            checkedAt: nowProvider(),
                            matched: false,
                            reason: verification.reason
                        },
                        recoveryScheduled: logAction === 'pause' ? false : undefined,
                        createdAt
                    };
                    snapshot = {
                        ...snapshot,
                        control: { ...snapshot.control, logs: [log, ...snapshot.control.logs].slice(0, 500) }
                    };
                    actions.push(log);
                    continue;
                }
                const log = {
                    id: id(),
                    campaignId: campaign.id,
                    campaignName: campaign.name,
                    itemId: campaign.itemId ?? campaign.id,
                    profileId,
                    ruleId: match.ruleId,
                    ruleName: match.ruleName,
                    action: logAction,
                    status: 'success',
                    reason: `${match.reason}；${mutationError ? '接口曾返回异常，但已' : '已'}回读天猫后台确认状态`,
                    ...promotionExecutionMetrics(campaign),
                    ...audit,
                    metricVerification,
                    verification: {
                        source: 'status-readback',
                        checkedAt: nowProvider(),
                        matched: true,
                        reason: '天猫后台已回读确认状态'
                    },
                    recoveryScheduled: logAction === 'pause' ? match.autoRecover : undefined,
                    createdAt
                };
                snapshot = {
                    ...snapshot,
                    control: {
                        ...(0, promotion_main_domain_1.applyPromotionCampaignStatus)(snapshot.control, profileId, (0, promotion_main_domain_1.getPromotionCampaignMetricIdentity)(campaign), campaign.channel, targetStatus, pending.targets),
                        recoveries: match.action === 'pause' && match.autoRecover
                            ? [(0, promotion_main_domain_1.buildPromotionRecovery)({
                                    campaign,
                                    platformTargets: (campaign.platformTargets ?? []).filter((target) => (pending.targets.some((candidate) => (candidate.campaignId === target.campaignId
                                        && (!candidate.platformUnitId || candidate.platformUnitId === target.unitId))))),
                                    profileId,
                                    recoveryTime: match.recoveryTime,
                                    recoverAfterMinutes: match.recoverAfterMinutes,
                                    pausedAt: createdAt,
                                    id: id()
                                }), ...snapshot.control.recoveries].slice(0, 500)
                            : match.action === 'resume'
                                ? snapshot.control.recoveries.map((recovery) => recovery.campaignId === (0, promotion_main_domain_1.getPromotionCampaignMetricIdentity)(campaign)
                                    && recovery.channel === campaign.channel
                                    && recovery.profileId === profileId
                                    && recovery.status === 'pending'
                                    ? { ...recovery, status: 'completed', attempts: recovery.attempts + 1, completedAt: createdAt }
                                    : recovery)
                                : snapshot.control.recoveries,
                        logs: [log, ...snapshot.control.logs].slice(0, 500)
                    }
                };
                actions.push(log);
            }
        }
        const noActionRuleIds = readyRules
            .filter((rule) => !actions.some((log) => log.ruleId === rule.id))
            .map((rule) => rule.id);
        const scanLogs = buildPromotionRuleScanLogs({
            id,
            profileId,
            rules: readyRules.filter((rule) => noActionRuleIds.includes(rule.id)),
            matches: [],
            campaignByMatch,
            createdAt: evaluationNow,
            observe: false,
            snapshot: evaluationSnapshot
        });
        if (scanLogs.length) {
            snapshot = { ...snapshot, control: { ...snapshot.control, logs: [...scanLogs, ...snapshot.control.logs].slice(0, 500) } };
            actions.push(...scanLogs);
        }
        snapshot = markPromotionRulesEvaluated(snapshot, profileId, applicableRules.map((rule) => rule.id), evaluationNow);
        await input.store.saveSnapshot(accountId, snapshot);
        return { snapshot, matches, actions };
    }
    async function processRecoveries(accountId, profileId) {
        let snapshot = await input.store.loadSnapshot(accountId);
        const now = nowProvider();
        const pendingRecoveries = [];
        const recordRecoveryFailure = (recovery, message) => {
            const attempts = recovery.attempts + 1;
            const log = {
                id: id(), campaignId: recovery.campaignId, campaignName: recovery.campaignName,
                itemId: recovery.itemId ?? recovery.campaignId,
                profileId: recovery.profileId, ruleId: null, ruleName: '定时恢复', action: 'restore',
                status: 'failed', reason: message,
                ...promotionExecutionMetrics(findPromotionRecoveryCampaign(snapshot, recovery)),
                createdAt: now
            };
            snapshot = {
                ...snapshot,
                control: {
                    ...snapshot.control,
                    recoveries: snapshot.control.recoveries.map((candidate) => candidate.id === recovery.id
                        ? { ...candidate, attempts, status: attempts >= 5 ? 'failed' : 'pending', lastError: message }
                        : candidate),
                    logs: [log, ...snapshot.control.logs].slice(0, 500)
                }
            };
        };
        for (const recovery of snapshot.control.recoveries) {
            if (profileId && recovery.profileId !== profileId)
                continue;
            if (recovery.channel === 'keyword')
                continue;
            if (recovery.status !== 'pending' || Date.parse(recovery.dueAt) > Date.parse(now))
                continue;
            const recoveryModeRevision = snapshot.control.modeRevision ?? 0;
            const recoveryAuthorized = async () => {
                const latest = await input.store.loadSnapshot(accountId);
                return (0, promotion_main_domain_1.getPromotionStoreMode)(latest.control, recovery.profileId) === 'automatic'
                    && (latest.control.modeRevision ?? 0) === recoveryModeRevision;
            };
            // Observation mode also holds scheduled recoveries; never resurrect an ad in the background.
            if (!await recoveryAuthorized())
                continue;
            try {
                const targets = recovery.platformTargets?.length
                    ? recovery.platformTargets.map((target) => recovery.channel === 'product'
                        ? { campaignId: target.campaignId }
                        : {
                            campaignId: target.campaignId,
                            ...(target.unitId ? { platformUnitId: target.unitId } : {})
                        })
                    : recovery.platformCampaignId && (recovery.channel === 'product' || recovery.platformUnitId)
                        ? [{
                                campaignId: recovery.platformCampaignId,
                                ...(recovery.channel === 'store' && recovery.platformUnitId
                                    ? { platformUnitId: recovery.platformUnitId }
                                    : {})
                            }]
                        : [];
                if (targets.length === 0) {
                    throw new Error(`商品 ${recovery.campaignId} 缺少可恢复的推广单元`);
                }
                const storedCampaign = findPromotionRecoveryCampaign(snapshot, recovery);
                const channel = recovery.channel ?? storedCampaign?.channel;
                if (!channel) {
                    throw new Error(`商品 ${recovery.campaignId} 缺少推广类型，无法回读确认恢复状态`);
                }
                let mutationError;
                try {
                    await updatePromotionTargetsStatus(recovery.profileId, targets, 'active', recoveryAuthorized);
                }
                catch (error) {
                    mutationError = error instanceof Error ? error.message : '天猫恢复推广接口返回异常';
                }
                pendingRecoveries.push({
                    recovery,
                    targets,
                    channel,
                    itemId: recovery.itemId ?? storedCampaign?.itemId ?? recovery.campaignId,
                    mutationError
                });
            }
            catch (error) {
                recordRecoveryFailure(recovery, error instanceof Error ? error.message : '恢复计划失败');
            }
        }
        const recoveriesByProfile = new Map();
        for (const pending of pendingRecoveries) {
            recoveriesByProfile.set(pending.recovery.profileId, [...(recoveriesByProfile.get(pending.recovery.profileId) ?? []), pending]);
        }
        for (const [profileId, profileRecoveries] of recoveriesByProfile) {
            let verificationResults;
            try {
                verificationResults = await input.platform.verifyStatuses(profileId, profileRecoveries.map(({ recovery, targets, channel, itemId }) => ({
                    campaignId: recovery.campaignId,
                    itemId,
                    channel,
                    targets,
                    expectedStatus: 'active'
                })));
            }
            catch (error) {
                const reason = error instanceof Error
                    ? `天猫后台状态确认失败：${error.message}`
                    : '天猫后台状态确认失败';
                verificationResults = profileRecoveries.map(() => ({ confirmed: false, reason }));
            }
            for (const [index, pending] of profileRecoveries.entries()) {
                const { recovery, mutationError } = pending;
                const verification = verificationResults[index] ?? {
                    confirmed: false,
                    reason: '天猫后台没有返回对应商品的恢复确认结果'
                };
                if (!verification.confirmed) {
                    recordRecoveryFailure(recovery, [mutationError, verification.reason || '天猫后台未确认商品已恢复推广']
                        .filter(Boolean)
                        .join('；'));
                    continue;
                }
                const log = {
                    id: id(),
                    campaignId: recovery.campaignId,
                    campaignName: recovery.campaignName,
                    itemId: recovery.itemId ?? recovery.campaignId,
                    profileId: recovery.profileId,
                    ruleId: null,
                    ruleName: '定时恢复',
                    action: 'restore',
                    status: 'success',
                    reason: `已按计划在 ${recovery.dueAt.slice(11, 16)} 恢复推广，${mutationError ? '接口曾返回异常，但已' : '并已'}回读天猫后台确认`,
                    ...promotionExecutionMetrics(findPromotionRecoveryCampaign(snapshot, recovery)),
                    createdAt: now
                };
                snapshot = {
                    ...snapshot,
                    control: {
                        ...(0, promotion_main_domain_1.applyPromotionCampaignStatus)(snapshot.control, recovery.profileId, recovery.campaignId, pending.channel, 'active', pending.targets),
                        recoveries: snapshot.control.recoveries.map((candidate) => candidate.id === recovery.id
                            ? { ...candidate, status: 'completed', attempts: candidate.attempts + 1, completedAt: now, lastError: undefined }
                            : candidate),
                        logs: [log, ...snapshot.control.logs].slice(0, 500)
                    }
                };
            }
        }
        await input.store.saveSnapshot(accountId, snapshot);
        return snapshot;
    }
    async function updateCampaignStatuses(accountId, profileId, requests) {
        const deduplicated = [...new Map(requests.map((request) => [
                `${request.campaign.channel}:${request.campaign.itemId ?? request.campaign.id}`,
                request
            ])).values()];
        if (!deduplicated.length)
            throw new Error('请选择至少一个需要暂停的商品');
        const prepared = deduplicated.map((request) => {
            const { campaign, status } = request;
            const itemId = campaign.itemId ?? campaign.id;
            const targets = getPromotionCampaignItemTargets(campaign, undefined, true);
            if (campaign.channel === 'keyword')
                return { request, itemId, targets, error: '关键词推广已暂停使用，当前不会修改关键词计划' };
            if (status !== 'paused')
                return { request, itemId, targets, error: '客户端手动操作当前仅支持暂停推广' };
            if (campaign.status !== 'active')
                return { request, itemId, targets, error: '商品当前不是推广中状态' };
            if (!targets.length)
                return { request, itemId, targets, error: `商品 ${itemId} 缺少可执行的天猫推广单元，请先同步最新数据` };
            return { request, itemId, targets, error: null };
        });
        const executable = prepared.filter((candidate) => candidate.error === null);
        const updateErrors = new Map();
        let cursor = 0;
        const worker = async () => {
            while (cursor < executable.length) {
                const candidate = executable[cursor++];
                const failures = [];
                for (const target of candidate.targets) {
                    try {
                        await input.platform.updateStatus(profileId, target, candidate.request.status);
                    }
                    catch (error) {
                        failures.push(error instanceof Error ? error.message : '天猫暂停请求失败');
                    }
                }
                if (failures.length)
                    updateErrors.set(candidate.itemId, [...new Set(failures)].join('；'));
            }
        };
        await Promise.all(Array.from({ length: Math.min(PROMOTION_MANUAL_STATUS_CONCURRENCY, executable.length) }, () => worker()));
        let verifications = [];
        let verificationError = null;
        if (executable.length) {
            try {
                verifications = await input.platform.verifyStatuses(profileId, executable.map((candidate) => ({
                    campaignId: candidate.request.campaign.id,
                    itemId: candidate.itemId,
                    channel: candidate.request.campaign.channel,
                    targets: candidate.targets,
                    expectedStatus: candidate.request.status
                })));
            }
            catch (error) {
                verificationError = error instanceof Error ? error.message : '天猫后台回读失败';
            }
        }
        const verificationByIdentity = new Map(executable.map((candidate, index) => [
            `${candidate.request.campaign.channel}:${candidate.itemId}`,
            verifications[index]
        ]));
        const results = prepared.map((candidate) => {
            const { campaign } = candidate.request;
            const verification = verificationByIdentity.get(`${campaign.channel}:${candidate.itemId}`);
            const confirmed = candidate.error === null && !verificationError && verification?.confirmed === true;
            const fallbackReason = updateErrors.get(candidate.itemId) ?? verification?.reason ?? verificationError ?? '天猫后台未确认暂停结果';
            return {
                campaignId: campaign.id,
                itemId: candidate.itemId,
                campaignName: campaign.name,
                status: confirmed ? 'success' : 'failed',
                targetCount: candidate.targets.length,
                reason: confirmed
                    ? `已暂停 ${candidate.targets.length} 个天猫推广${campaign.channel === 'product' ? '计划' : '单元'}，并回读天猫后台确认`
                    : candidate.error ?? fallbackReason
            };
        });
        const successfulUpdates = new Map();
        for (const result of results) {
            if (result.status !== 'success')
                continue;
            const candidate = prepared.find((item) => (item.request.campaign.id === result.campaignId
                && item.itemId === result.itemId));
            if (!candidate)
                continue;
            successfulUpdates.set(`${candidate.request.campaign.channel}:${candidate.itemId}`, { targets: candidate.targets, status: candidate.request.status });
        }
        const now = nowProvider();
        let snapshot = await input.store.loadSnapshot(accountId);
        const latestSnapshotByIdentity = new Map();
        for (const daily of snapshot.control.dailySnapshots
            .filter((candidate) => candidate.profileId === profileId)
            .sort((left, right) => left.date.localeCompare(right.date) || left.syncedAt.localeCompare(right.syncedAt))) {
            for (const campaign of daily.campaigns) {
                const identity = `${campaign.channel}:${campaign.itemId ?? campaign.id}`;
                if (successfulUpdates.has(identity))
                    latestSnapshotByIdentity.set(identity, daily);
            }
        }
        const updateMatchingCampaigns = (campaigns, daily) => campaigns.map((candidate) => {
            const identity = `${candidate.channel}:${candidate.itemId ?? candidate.id}`;
            const update = successfulUpdates.get(identity);
            if (!update || (daily && latestSnapshotByIdentity.get(identity) !== daily))
                return candidate;
            return (0, promotion_main_domain_1.applyPromotionPlatformTargetStatus)(candidate, update.targets, update.status);
        });
        const logs = results.flatMap((result) => {
            if (result.status !== 'success')
                return [];
            const campaign = deduplicated.find((request) => (request.campaign.id === result.campaignId
                && (request.campaign.itemId ?? request.campaign.id) === result.itemId))?.campaign;
            if (!campaign)
                return [];
            return [{
                    id: id(),
                    campaignId: campaign.id,
                    campaignName: campaign.name,
                    itemId: result.itemId,
                    profileId,
                    ruleId: 'manual-client-action',
                    ruleName: '客户端手动操作',
                    action: 'pause',
                    status: 'success',
                    reason: result.reason,
                    ...promotionExecutionMetrics(campaign),
                    recoveryScheduled: false,
                    createdAt: now
                }];
        });
        snapshot = {
            ...snapshot,
            control: {
                ...snapshot.control,
                campaigns: updateMatchingCampaigns(snapshot.control.campaigns),
                dailySnapshots: snapshot.control.dailySnapshots.map((daily) => {
                    if (daily.profileId !== profileId)
                        return daily;
                    const campaigns = updateMatchingCampaigns(daily.campaigns, daily);
                    return campaigns.some((campaign, index) => campaign !== daily.campaigns[index])
                        ? { ...daily, campaigns }
                        : daily;
                }),
                logs: [...logs, ...snapshot.control.logs].slice(0, 500)
            }
        };
        await input.store.saveSnapshot(accountId, snapshot);
        return { snapshot, results };
    }
    async function updateCampaignStatus(accountId, profileId, request) {
        const result = await updateCampaignStatuses(accountId, profileId, [request]);
        const [itemResult] = result.results;
        if (!itemResult || itemResult.status === 'failed')
            throw new Error(itemResult?.reason ?? '天猫后台未确认暂停结果');
        return result.snapshot;
    }
    return {
        sync,
        runRules,
        processRecoveries,
        updateCampaignStatus,
        updateCampaignStatuses,
        setNowForTesting(next) {
            nowProvider = next;
        }
    };
}
function promotionExecutionMetrics(campaign) {
    if (!campaign)
        return {};
    return {
        spend: campaign.spend,
        roi: campaign.channel === 'product' ? campaign.netRoi ?? campaign.roi : campaign.roi,
        clicks: campaign.clicks
    };
}
function promotionRuleMatchKey(match) {
    return `${match.ruleId}:${match.channel}:${match.platformCampaignId}:${match.itemId}`;
}
function buildPromotionExecutionAudit(snapshot, profileId, match, campaign) {
    const itemId = campaign.itemId ?? campaign.id;
    const dailyMetrics = snapshot.control.dailySnapshots
        .filter((daily) => daily.profileId === profileId
        && daily.date >= match.dataStartDate
        && daily.date <= match.dataEndDate)
        .map((daily) => (0, promotion_main_domain_1.aggregatePromotionDailyCampaigns)([daily], profileId, daily.date, daily.date)
        .find((candidate) => candidate.channel === match.channel
        && (candidate.itemId ?? candidate.id) === itemId
        && (0, promotion_main_domain_1.getPromotionCampaignPlanId)(candidate) === match.platformCampaignId))
        .filter((candidate) => Boolean(candidate))
        .map((candidate) => promotionCampaignToDailyMetric(candidate.dataStartDate, candidate));
    return {
        channel: match.channel,
        dataStartDate: match.dataStartDate,
        dataEndDate: match.dataEndDate,
        dailyMetrics
    };
}
function promotionCampaignToDailyMetric(date, campaign) {
    return {
        date,
        spend: campaign.spend,
        roi: campaign.roi,
        ...(campaign.netRoi === undefined ? {} : { netRoi: campaign.netRoi }),
        revenue: campaign.revenue,
        ...(campaign.netRevenue === undefined ? {} : { netRevenue: campaign.netRevenue }),
        orders: campaign.orders,
        ...(campaign.netOrders === undefined ? {} : { netOrders: campaign.netOrders }),
        clicks: campaign.clicks,
        impressions: campaign.impressions,
        ...(campaign.cartAdds === undefined ? {} : { cartAdds: campaign.cartAdds }),
        averageClickCost: campaign.clicks > 0 ? campaign.spend / campaign.clicks : 0
    };
}
async function verifyPromotionRuleMatches(input) {
    const output = new Map();
    const rules = new Map(input.ruleEvaluations.map((item) => [item.rule.id, item]));
    const productMatches = input.matches.filter((match) => match.channel === 'product');
    if (productMatches.length) {
        const today = getShanghaiCalendarDate(input.checkedAt);
        const yesterday = shiftPromotionCalendarDate(today, -1);
        const verifyProductRange = input.platform.verifyProductRange ?? input.platform.syncProductRange;
        const historicalMatches = productMatches.filter((match) => match.dataStartDate < today);
        const realtimeMatches = productMatches.filter((match) => match.dataStartDate <= today && match.dataEndDate >= today);
        const byDate = new Map();
        let historicalError;
        let realtimeError;
        if (historicalMatches.length) {
            if (!verifyProductRange) {
                historicalError = '无法取得商品维度历史明细报表';
            }
            else {
                const startDate = historicalMatches.reduce((value, match) => match.dataStartDate < value ? match.dataStartDate : value, historicalMatches[0].dataStartDate);
                const endDate = historicalMatches.reduce((value, match) => {
                    const matchEndDate = match.dataEndDate < today ? match.dataEndDate : yesterday;
                    return matchEndDate > value ? matchEndDate : value;
                }, historicalMatches[0].dataEndDate < today ? historicalMatches[0].dataEndDate : yesterday);
                try {
                    const results = await verifyProductRange(input.profileId, {
                        startDate,
                        endDate,
                        observedAt: input.checkedAt
                    });
                    for (const result of results)
                        byDate.set(result.startDate, result);
                }
                catch (error) {
                    historicalError = error instanceof Error ? error.message : '商品历史明细报表返回未知错误';
                }
            }
        }
        if (realtimeMatches.length) {
            if (!input.platform.verifyProductRealtime) {
                realtimeError = '无法取得商品当天实时数据';
            }
            else {
                try {
                    const result = await input.platform.verifyProductRealtime(input.profileId, {
                        startDate: today,
                        endDate: today
                    });
                    byDate.set(today, result);
                }
                catch (error) {
                    realtimeError = error instanceof Error ? error.message : '商品当天实时数据返回未知错误';
                }
            }
        }
        for (const match of productMatches) {
            const hasHistoricalDates = match.dataStartDate < today;
            const includesToday = match.dataStartDate <= today && match.dataEndDate >= today;
            const verificationError = hasHistoricalDates && historicalError
                ? `暂停前商品历史明细复核失败，本次已安全跳过：${historicalError}`
                : includesToday && realtimeError
                    ? `暂停前商品当天实时复核失败，本次已安全跳过：${realtimeError}`
                    : undefined;
            if (verificationError) {
                output.set(promotionRuleMatchKey(match), {
                    source: 'item-report', checkedAt: input.checkedAt, matched: false,
                    reason: verificationError
                });
                continue;
            }
            const campaign = input.campaignByMatch.get(promotionRuleMatchKey(match));
            const evaluation = rules.get(match.ruleId);
            const dates = (0, promotion_main_domain_1.listPromotionDates)(match.dataStartDate, match.dataEndDate);
            const missingDates = dates.filter((date) => !byDate.has(date));
            const reportCampaigns = dates.flatMap((date) => byDate.get(date)?.campaigns ?? [])
                .filter((candidate) => candidate.channel === 'product'
                && candidate.itemId === match.itemId
                && (0, promotion_main_domain_1.getPromotionCampaignPlanId)(candidate) === match.platformCampaignId);
            if (!campaign || !evaluation || missingDates.length || !reportCampaigns.length) {
                output.set(promotionRuleMatchKey(match), {
                    source: 'item-report', checkedAt: input.checkedAt, matched: false,
                    reason: missingDates.length
                        ? `暂停前商品复核数据缺少 ${missingDates.join('、')}，本次已安全跳过`
                        : '暂停前商品复核数据没有找到该商品，本次已安全跳过'
                });
                continue;
            }
            const verified = (0, promotion_main_domain_1.aggregatePromotionDailyCampaigns)(dates.map((date) => ({
                profileId: input.profileId,
                date,
                state: date === today ? 'provisional' : 'final',
                finalAfter: `${date}T01:00:00.000Z`,
                syncedAt: input.checkedAt,
                campaigns: (byDate.get(date)?.campaigns ?? [])
                    .filter((candidate) => candidate.channel === 'product'
                    && candidate.itemId === match.itemId
                    && (0, promotion_main_domain_1.getPromotionCampaignPlanId)(candidate) === match.platformCampaignId)
                    .map((candidate) => ({
                    ...campaign,
                    ...candidate,
                    status: campaign.status,
                    platformTargets: campaign.platformTargets,
                    sourceCampaignIds: campaign.sourceCampaignIds,
                    groupIds: campaign.groupIds,
                    groupNames: campaign.groupNames
                }))
            })), input.profileId, match.dataStartDate, match.dataEndDate)[0];
            const consistent = Boolean(verified && isPromotionMetricVerificationConsistent(campaign, verified));
            const matched = Boolean(consistent && verified
                && (0, promotion_main_domain_1.evaluatePromotionRules)([verified], [evaluation.rule], input.profileId).length);
            const verifiedDailyMetrics = dates.flatMap((date) => {
                const dailyCampaign = (byDate.get(date)?.campaigns ?? [])
                    .find((candidate) => candidate.channel === 'product'
                    && candidate.itemId === match.itemId
                    && (0, promotion_main_domain_1.getPromotionCampaignPlanId)(candidate) === match.platformCampaignId);
                return dailyCampaign ? [promotionCampaignToDailyMetric(date, dailyCampaign)] : [];
            });
            const verificationSource = hasHistoricalDates && includesToday
                ? '历史明细与当天实时数据'
                : includesToday
                    ? '当天实时数据'
                    : '历史明细数据';
            output.set(promotionRuleMatchKey(match), {
                source: 'item-report', checkedAt: input.checkedAt, matched,
                dailyMetrics: verifiedDailyMetrics,
                reason: matched
                    ? `${verificationSource}独立复核仍满足规则，且两次数据变化在安全范围内`
                    : !consistent
                        ? `${verificationSource}两次读取差异异常，本次已安全跳过`
                        : `${verificationSource}独立复核已不满足规则，本次已安全跳过`
            });
        }
    }
    const storeMatches = input.matches.filter((match) => match.channel === 'store');
    const storeToday = getShanghaiCalendarDate(input.checkedAt);
    const storeYesterday = shiftPromotionCalendarDate(storeToday, -1);
    const buildStoreVerificationSegments = (startDate, endDate) => {
        const segments = [];
        if (startDate < storeToday) {
            const historicalEnd = endDate < storeToday ? endDate : storeYesterday;
            if (historicalEnd >= startDate) {
                segments.push({
                    startDate,
                    endDate: historicalEnd,
                    label: startDate === historicalEnd ? startDate : `${startDate} 至 ${historicalEnd}`,
                    realtime: false
                });
            }
        }
        if (startDate <= storeToday && endDate >= storeToday) {
            segments.push({
                startDate: storeToday,
                endDate: storeToday,
                label: storeToday,
                realtime: true
            });
        }
        // Rule ranges normally never point into the future. Keep a fail-closed
        // fallback so an unexpected custom range is still verified, not silently
        // authorized without an independent read.
        if (!segments.length) {
            segments.push({
                startDate,
                endDate,
                label: startDate === endDate ? startDate : `${startDate} 至 ${endDate}`,
                realtime: false
            });
        }
        return segments;
    };
    const storeReads = new Map();
    for (const match of storeMatches) {
        const rangeKey = `${match.dataStartDate}:${match.dataEndDate}`;
        if (storeReads.has(rangeKey))
            continue;
        const segments = buildStoreVerificationSegments(match.dataStartDate, match.dataEndDate);
        const readSegments = async () => {
            const results = [];
            for (const segment of segments) {
                results.push(await input.platform.sync(input.profileId, {
                    startDate: segment.startDate,
                    endDate: segment.endDate,
                    channels: ['store']
                }));
            }
            return results;
        };
        try {
            // Run two complete passes. Historical dates use the finalized report
            // endpoint while today is requested separately so the connector sets
            // isRt=true. A single mixed range is classified as non-realtime by the
            // platform and can omit today's spend, producing a false safe skip.
            const first = await readSegments();
            const second = await readSegments();
            storeReads.set(rangeKey, { segments, first, second });
        }
        catch (error) {
            storeReads.set(rangeKey, {
                segments,
                error: error instanceof Error ? error.message : '未知错误'
            });
        }
    }
    for (const match of storeMatches) {
        const campaign = input.campaignByMatch.get(promotionRuleMatchKey(match));
        const evaluation = rules.get(match.ruleId);
        const reads = storeReads.get(`${match.dataStartDate}:${match.dataEndDate}`);
        if (reads?.error || !reads?.first || !reads.second) {
            output.set(promotionRuleMatchKey(match), {
                source: 'second-read', checkedAt: input.checkedAt, matched: false,
                reason: `暂停前全站全店数据复核失败，本次已安全跳过：${reads?.error ?? '未取得两次同口径读取结果'}`
            });
            continue;
        }
        const findStoreReadback = (result) => result?.campaigns.find((candidate) => (candidate.channel === 'store'
            && (candidate.itemId ?? candidate.id) === match.itemId
            && (0, promotion_main_domain_1.getPromotionCampaignPlanId)(candidate) === match.platformCampaignId));
        const firstReadbacks = reads.segments.map((segment, index) => ({
            segment,
            campaign: findStoreReadback(reads.first?.[index])
        }));
        const secondReadbacks = reads.segments.map((segment, index) => ({
            segment,
            campaign: findStoreReadback(reads.second?.[index])
        }));
        const hasMissingSegment = firstReadbacks.some((item) => !item.campaign)
            || secondReadbacks.some((item) => !item.campaign);
        if (!campaign || !evaluation || hasMissingSegment) {
            const missingLabels = reads.segments.filter((_segment, index) => (!firstReadbacks[index]?.campaign || !secondReadbacks[index]?.campaign)).map((segment) => segment.label);
            output.set(promotionRuleMatchKey(match), {
                source: 'second-read', checkedAt: input.checkedAt, matched: false,
                reason: missingLabels.length
                    ? `暂停前全站全店复核在 ${missingLabels.join('、')} 没有找到该商品，本次已安全跳过`
                    : '暂停前全站全店同口径复核没有找到该商品，本次已安全跳过'
            });
            continue;
        }
        const buildStoreVerifiedCampaign = (readbacks) => (0, promotion_main_domain_1.aggregatePromotionDailyCampaigns)(readbacks.map(({ segment, campaign: readback }) => ({
            profileId: input.profileId,
            date: segment.endDate,
            state: segment.realtime ? 'provisional' : 'final',
            finalAfter: '',
            syncedAt: input.checkedAt,
            campaigns: [{
                    ...campaign,
                    ...readback,
                    status: campaign.status,
                    platformTargets: campaign.platformTargets,
                    sourceCampaignIds: campaign.sourceCampaignIds,
                    groupIds: campaign.groupIds,
                    groupNames: campaign.groupNames
                }]
        })), input.profileId, match.dataStartDate, match.dataEndDate)[0];
        const firstVerified = buildStoreVerifiedCampaign(firstReadbacks);
        const secondVerified = buildStoreVerifiedCampaign(secondReadbacks);
        const segmentConsistent = firstReadbacks.every((item, index) => {
            const second = secondReadbacks[index]?.campaign;
            return Boolean(item.campaign && second && isPromotionMetricVerificationConsistent({ ...campaign, ...item.campaign, status: campaign.status }, { ...campaign, ...second, status: campaign.status }));
        });
        const consistent = Boolean(firstVerified && secondVerified && segmentConsistent
            && isPromotionMetricVerificationConsistent(firstVerified, secondVerified));
        const firstMatched = (0, promotion_main_domain_1.evaluatePromotionRules)([firstVerified], [evaluation.rule], input.profileId).length > 0;
        const secondMatched = (0, promotion_main_domain_1.evaluatePromotionRules)([secondVerified], [evaluation.rule], input.profileId).length > 0;
        const matched = consistent && firstMatched && secondMatched;
        const verifiedDailyMetrics = secondReadbacks.map(({ segment, campaign: readback }) => (promotionCampaignToDailyMetric(segment.label, readback)));
        const verificationSource = reads.segments.some((segment) => segment.realtime)
            && reads.segments.some((segment) => !segment.realtime)
            ? '历史区间与当天实时数据分段'
            : reads.segments.some((segment) => segment.realtime)
                ? '当天实时数据'
                : '历史数据';
        output.set(promotionRuleMatchKey(match), {
            source: 'second-read', checkedAt: input.checkedAt, matched,
            dailyMetrics: verifiedDailyMetrics,
            reason: matched
                ? `全站全店${verificationSource}两轮同口径独立读取均满足规则`
                : !consistent
                    ? `全站全店${verificationSource}两轮同口径读取差异异常，本次已安全跳过`
                    : `全站全店${verificationSource}同口径独立复核已不满足规则，本次已安全跳过`
        });
    }
    return output;
}
function isPromotionMetricVerificationConsistent(first, second) {
    // The second read happens later, so realtime counters may increase slightly.
    // A material decrease cannot be explained by normal attribution and is a
    // strong sign of stale, cross-product or incomplete report data. Never let
    // such a pair authorize a destructive action.
    const didDropMaterially = (before, after, absoluteTolerance) => (after + Math.max(absoluteTolerance, Math.abs(before) * 0.05) < before);
    return !didDropMaterially(first.spend, second.spend, 1)
        && !didDropMaterially(first.revenue, second.revenue, 1)
        && !didDropMaterially(first.netRevenue ?? first.revenue, second.netRevenue ?? second.revenue, 1)
        && !didDropMaterially(first.clicks, second.clicks, 2)
        && !didDropMaterially(first.orders, second.orders, 1);
}
function findPromotionRecoveryCampaign(snapshot, recovery) {
    const matchesRecovery = (campaign) => (!recovery.channel || campaign.channel === recovery.channel)
        && ((0, promotion_main_domain_1.getPromotionCampaignMetricIdentity)(campaign) === recovery.campaignId
            || (Boolean(recovery.itemId && campaign.itemId === recovery.itemId)
                && (!recovery.platformCampaignId
                    || (0, promotion_main_domain_1.getPromotionCampaignPlanId)(campaign) === recovery.platformCampaignId)));
    const latestDailyCampaign = [...snapshot.control.dailySnapshots]
        .filter((daily) => daily.profileId === recovery.profileId)
        .sort((left, right) => right.date.localeCompare(left.date) || right.syncedAt.localeCompare(left.syncedAt))
        .flatMap((daily) => daily.campaigns)
        .find(matchesRecovery);
    return latestDailyCampaign ?? snapshot.control.campaigns.find(matchesRecovery);
}
function isPromotionStoreRuleScheduleDue(snapshot, profileId, now) {
    const schedule = snapshot.control.storeRuleSchedules?.[profileId];
    const today = getShanghaiCalendarDate(now);
    const yesterday = shiftPromotionCalendarDate(today, -1);
    const yesterdaySnapshot = snapshot.control.dailySnapshots.find((daily) => (daily.profileId === profileId && daily.date === yesterday));
    const waitsForYesterdayReport = snapshot.control.rules.some((rule) => {
        if (!rule.enabled
            || rule.channels.includes('keyword')
            || (rule.profileIds?.length && !rule.profileIds.includes(profileId)))
            return false;
        const range = (0, promotion_main_domain_1.resolvePromotionDateRange)(rule.datePreset ?? 'today', rule.includeToday ?? true, now, { startDate: rule.customStartDate ?? '', endDate: rule.customEndDate ?? '' });
        return range.startDate <= yesterday
            && range.endDate >= yesterday
            && !arePromotionDailyChannelsReady(yesterdaySnapshot, rule.channels.filter((channel) => channel !== 'keyword'));
    });
    if (waitsForYesterdayReport && Date.parse(now) < Date.parse(`${today}T06:00:00+08:00`)) {
        return false;
    }
    if (!schedule?.lastRunAt)
        return true;
    const lastRunAt = Date.parse(schedule.lastRunAt);
    const current = Date.parse(now);
    if (!Number.isFinite(lastRunAt) || !Number.isFinite(current))
        return true;
    const intervalMinutes = waitsForYesterdayReport
        ? 30
        : [5, 10, 15, 30, 60].includes(Number(schedule.intervalMinutes))
            ? Number(schedule.intervalMinutes)
            : 30;
    return current - lastRunAt >= intervalMinutes * 60_000;
}
function markPromotionRulesEvaluated(snapshot, profileId, ruleIds, evaluatedAt) {
    const evaluated = new Set(ruleIds);
    return {
        ...snapshot,
        control: {
            ...snapshot.control,
            storeRuleSchedules: {
                ...(snapshot.control.storeRuleSchedules ?? {}),
                [profileId]: {
                    intervalMinutes: snapshot.control.storeRuleSchedules?.[profileId]?.intervalMinutes ?? 30,
                    lastRunAt: evaluatedAt
                }
            },
            rules: snapshot.control.rules.map((rule) => evaluated.has(rule.id)
                ? { ...rule, lastRunAt: evaluatedAt, updatedAt: rule.updatedAt }
                : rule)
        }
    };
}
function getShanghaiCalendarDate(value) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date(value));
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!year || !month || !day)
        throw new Error('无法解析同步日期');
    return `${year}-${month}-${day}`;
}
function shiftPromotionCalendarDate(date, days) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}
function arePromotionDailyChannelsReady(snapshot, channels) {
    return Boolean(snapshot)
        && channels.length > 0
        && channels.every((channel) => (0, promotion_main_domain_1.isPromotionDailyChannelReady)(snapshot, channel));
}
