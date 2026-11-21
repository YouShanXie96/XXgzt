"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTERNAL_PURCHASE_BATCH_TEMPLATE_FILE_NAME = void 0;
exports.resolveInternalPurchaseBatchTemplatePaths = resolveInternalPurchaseBatchTemplatePaths;
exports.resolveInternalPurchaseBatchTemplatePath = resolveInternalPurchaseBatchTemplatePath;
const node_path_1 = __importDefault(require("node:path"));
exports.INTERNAL_PURCHASE_BATCH_TEMPLATE_FILE_NAME = 'internal-purchase-batch-template.xlsx';
function resolveInternalPurchaseBatchTemplatePaths(input) {
    const developmentPath = node_path_1.default.resolve(input.currentDir, '../../build', exports.INTERNAL_PURCHASE_BATCH_TEMPLATE_FILE_NAME);
    if (!input.isPackaged)
        return [developmentPath];
    return [...new Set([
            node_path_1.default.join(input.resourcesPath, exports.INTERNAL_PURCHASE_BATCH_TEMPLATE_FILE_NAME),
            ...(input.appPath
                ? [node_path_1.default.join(input.appPath, 'build', exports.INTERNAL_PURCHASE_BATCH_TEMPLATE_FILE_NAME)]
                : [developmentPath])
        ])];
}
function resolveInternalPurchaseBatchTemplatePath(input) {
    return resolveInternalPurchaseBatchTemplatePaths(input)[0];
}
