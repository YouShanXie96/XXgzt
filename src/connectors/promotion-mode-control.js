"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preservePromotionMode = preservePromotionMode;
exports.changePromotionMode = changePromotionMode;
function preservePromotionMode(stored, incoming) {
    const incomingIds = new Set(incoming.control.logs.map((log) => log.id));
    const missingAudit = stored.control.logs.filter((log) => log.campaignId.startsWith('mode-change:') && !incomingIds.has(log.id));
    return {
        ...incoming,
        control: {
            ...incoming.control,
            mode: stored.control.mode,
            storeModes: stored.control.storeModes,
            modeRevision: stored.control.modeRevision,
            lastModeChange: stored.control.lastModeChange,
            logs: missingAudit.length
                ? [...missingAudit, ...incoming.control.logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500)
                : incoming.control.logs
        }
    };
}
function changePromotionMode(snapshot, profileIds, mode, source, at = new Date().toISOString()) {
    const ids = [...new Set(profileIds ?? [
            ...snapshot.control.monitoredProfileIds,
            ...Object.keys(snapshot.control.storeModes ?? {}),
            ...(snapshot.control.selectedProfileId ? [snapshot.control.selectedProfileId] : [])
        ])];
    const label = mode === 'automatic' ? '正式模式' : '观察模式';
    const reason = source === 'operator' ? `运营手动切换为${label}`
        : source === 'backup-recovery' ? '公司备份恢复了推广规则，为避免未经核对的自动操作，已切换为观察模式；请核对规则后手动启用正式模式'
            : '本机推广数据修复导致数据校验失效，已切换为观察模式；请全量同步并核对后手动启用正式模式';
    const revision = (snapshot.control.modeRevision ?? 0) + 1;
    return {
        ...snapshot,
        control: {
            ...snapshot.control,
            ...(profileIds === null ? { mode } : {}),
            storeModes: { ...snapshot.control.storeModes, ...Object.fromEntries(ids.map((id) => [id, mode])) },
            modeRevision: revision,
            lastModeChange: { profileIds: ids, source, at, reason },
            logs: [...ids.map((profileId) => ({
                    id: `mode-change:${revision}:${profileId}`, campaignId: `mode-change:${profileId}`,
                    campaignName: '运行模式设置', profileId, ruleId: null, ruleName: '运行模式变更',
                    action: 'scan', status: 'success', reason, createdAt: at
                })), ...snapshot.control.logs].slice(0, 500)
        }
    };
}
