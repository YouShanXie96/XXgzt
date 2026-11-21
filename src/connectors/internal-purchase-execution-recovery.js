"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recoverInterruptedInternalPurchaseExecutions = recoverInterruptedInternalPurchaseExecutions;
const node_crypto_1 = require("node:crypto");
const defaultRuntime = {
    id: () => (0, node_crypto_1.randomUUID)(),
    now: () => new Date().toISOString()
};
function recoverInterruptedInternalPurchaseExecutions(snapshot, processStartedAt, runtime = defaultRuntime) {
    const processStartedAtMs = Date.parse(processStartedAt);
    if (!Number.isFinite(processStartedAtMs)) {
        throw new Error('Invalid internal purchase process start time');
    }
    const recoveredPlans = [];
    const recoveryLogs = [];
    for (const plan of snapshot.plans) {
        const updatedAtMs = Date.parse(plan.updatedAt);
        if (plan.executionStatus !== 'creating'
            || !Number.isFinite(updatedAtMs)
            || updatedAtMs >= processStartedAtMs) {
            recoveredPlans.push(plan);
            continue;
        }
        const recoveredAt = runtime.now();
        recoveredPlans.push({
            ...plan,
            executionStatus: 'failed',
            updatedAt: recoveredAt
        });
        recoveryLogs.unshift({
            id: `log-${runtime.id()}`,
            planId: plan.id,
            storeProfileId: plan.storeProfileId,
            action: 'create-failed',
            status: 'failed',
            message: '上一次创建因软件退出或异常中断，已恢复为可重试状态',
            createdAt: recoveredAt
        });
    }
    if (recoveryLogs.length === 0) {
        return snapshot;
    }
    return {
        ...snapshot,
        plans: recoveredPlans,
        logs: [...recoveryLogs, ...snapshot.logs]
    };
}
