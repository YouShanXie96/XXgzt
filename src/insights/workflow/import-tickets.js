'use strict';
const {randomUUID} = require('node:crypto');

/** A preview owns an immutable batch; committing never rereads a changed file. */
function createImportTickets({now = Date.now, ttl = 15 * 60 * 1000} = {}) {
  const tickets = new Map();
  function prune() { for (const [id, ticket] of tickets) if (ticket.expiresAt <= now()) tickets.delete(id); }
  return {
    issue(storeId, kind, payload) {
      prune();
      for (const [id, ticket] of tickets) if (ticket.storeId === storeId && ticket.kind === kind) tickets.delete(id);
      const token = randomUUID();
      tickets.set(token, {storeId, kind, payload: structuredClone(payload), expiresAt: now() + ttl});
      return token;
    },
    read(token, storeId, kind) {
      prune();
      const ticket = tickets.get(token);
      if (!ticket || ticket.storeId !== storeId || ticket.kind !== kind) throw new Error('导入预览已失效或不属于当前店铺，请重新选择文件。');
      return structuredClone(ticket.payload);
    },
    remove(token) { tickets.delete(token); },
    clearStore(storeId) { for (const [id, ticket] of tickets) if (ticket.storeId === storeId) tickets.delete(id); },
    clear() { tickets.clear(); }
  };
}
module.exports = {createImportTickets};
