"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stabilizeInternalPurchaseCreateForm = stabilizeInternalPurchaseCreateForm;
/** Recheck both dependent form sections after the seller page has settled. */
async function stabilizeInternalPurchaseCreateForm(input) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        // Changing dates invalidates Taobao's existing product/SKU configuration.
        await input.ensureDateRange();
        await input.ensureProducts();
        await input.settle();
        if (await input.isReady())
            return;
    }
    throw new Error('淘宝活动时间或商品配置仍在变化，已停止正式提交；请保留页面后重试');
}
