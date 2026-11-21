"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeHostedGiftErrorText = sanitizeHostedGiftErrorText;
exports.formatHostedGiftFailure = formatHostedGiftFailure;
/** Keep the platform's reason, but never surface credentials or signed URL parameters. */
function sanitizeHostedGiftErrorText(value, maxLength = 1600) {
    return String(value ?? '')
        .replace(/((?:["']?)(?:csrfID|dynamicToken|seedToken|access[_-]?token|refresh[_-]?token|api[_-]?key|password|authorization|token|_tb_token_|sgcookie|cookie2?|set-cookie)(?:["']?)\s*[:=]\s*)(?:Bearer\s+[^\s&,;，；}]+|"[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;，；}]+)/gi, '$1***')
        .replace(/(\bcookie2?\s*[:=]\s*)[^\r\n]+/gi, '$1***')
        .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer ***')
        .replace(/https?:\/\/[^\s<>"']+/gi, url => url.split(/[?#]/, 1)[0])
        .trim()
        .slice(0, maxLength);
}
const operationLabels = {
    querySelectItemList: '查询可添加商品',
    querySelectSkuList: '查询商品 SKU',
    querySignedItemList: '查询已报名商品',
    signItems: '提交报名',
    cancelSignedItems: '批量退出'
};
function formatHostedGiftFailure(message, detail = {}) {
    const reason = sanitizeHostedGiftErrorText(message) || '平台未返回具体错误原因';
    const api = sanitizeHostedGiftErrorText(detail.apiName, 100);
    const context = [api];
    if (detail.httpStatus)
        context.push(`HTTP ${detail.httpStatus}`);
    if (detail.platformCode)
        context.push(`返回码 ${sanitizeHostedGiftErrorText(detail.platformCode, 100)}`);
    const suffix = context.filter(Boolean).join('；');
    return `${api ? `${operationLabels[api] || '品牌新享接口请求'}失败` : ''}${suffix ? `（${suffix}）：` : ''}${reason}`;
}
