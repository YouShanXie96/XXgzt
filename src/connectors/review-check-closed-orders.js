"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pruneReviewCheckClosedOrders = exports.isReviewCheckClosedOrderStatus = void 0;
const isReviewCheckClosedOrderStatus = (status) => {
    const normalized = String(status ?? '')
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('zh-CN')
        .replace(/[\s_-]+/gu, '');
    return ['交易关闭', 'tradeclosed', 'tradeclosedbytaobao', 'closed', 'orderclosed'].includes(normalized);
};
exports.isReviewCheckClosedOrderStatus = isReviewCheckClosedOrderStatus;
const pruneReviewCheckClosedOrders = (snapshot) => {
    const orders = snapshot.orders.filter((order) => !(0, exports.isReviewCheckClosedOrderStatus)(order.status));
    const orderKeys = new Set(orders.map((order) => order.localOrderKey));
    const matches = snapshot.matches.filter((match) => orderKeys.has(match.orderKey));
    if (orders.length === snapshot.orders.length && matches.length === snapshot.matches.length)
        return snapshot;
    return { ...snapshot, orders, matches, updatedAt: new Date().toISOString() };
};
exports.pruneReviewCheckClosedOrders = pruneReviewCheckClosedOrders;
