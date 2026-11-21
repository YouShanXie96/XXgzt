"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQualificationPublishAutomationGate = createQualificationPublishAutomationGate;
function createQualificationPublishAutomationGate(options = {}) {
    const staggerMs = Math.max(0, Math.trunc(options.staggerMs ?? 2_000));
    const now = options.now ?? Date.now;
    const delay = options.delay ?? ((milliseconds) => (new Promise((resolve) => setTimeout(resolve, milliseconds))));
    const startTails = new Map();
    const lastStartedAt = new Map();
    return {
        async run(storeKeyValue, operation) {
            const storeKey = storeKeyValue.trim();
            if (!storeKey)
                return await operation();
            const previousStart = startTails.get(storeKey) ?? Promise.resolve();
            const startTurn = previousStart.catch(() => undefined).then(async () => {
                const previousStartedAt = lastStartedAt.get(storeKey);
                const waitMs = previousStartedAt === undefined
                    ? 0
                    : Math.max(0, previousStartedAt + staggerMs - now());
                if (waitMs > 0)
                    await delay(waitMs);
                lastStartedAt.set(storeKey, now());
            });
            startTails.set(storeKey, startTurn);
            try {
                await startTurn;
            }
            finally {
                if (startTails.get(storeKey) === startTurn)
                    startTails.delete(storeKey);
            }
            return await operation();
        }
    };
}
