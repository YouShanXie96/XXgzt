"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveInternalPurchaseSpecialSkuIndex = resolveInternalPurchaseSpecialSkuIndex;
// Main-process runtime stays self-contained: the packaged app excludes shared.
// Cross-layer regression tests keep this calculation in sync with the shared UI domain.
function resolveInternalPurchaseSpecialSkuIndex(skuCount) {
    return Math.max(0, Math.min(5, skuCount - 1));
}
