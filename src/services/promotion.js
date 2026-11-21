'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const connector = require('../connectors/promotion-alimama-connector');
const { createPromotionLocalStore } = require('../connectors/promotion-local-store');
const { createPromotionAutomationService } = require('../connectors/promotion-automation-service');
const domain = require('../connectors/promotion-main-domain');

const ACCOUNT = 'local';
const CHANNELS = ['product', 'store'];
const INTERVALS = [5, 10, 15, 30, 60];
const NOTICE = '单机本地存储。关键词推广暂不支持。重启、恢复备份或修改规则后需重新确认正式运行。';

function shanghaiDate(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
function minuteOfDay(value) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  return Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value);
}
function clockMinutes(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('推广运行时段应为 HH:mm');
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
function isRuleInWindow(rule, now) {
  const start = clockMinutes(rule.startTime || '00:00');
  const end = clockMinutes(rule.endTime || '23:59');
  const current = minuteOfDay(now);
  return start <= end ? current >= start && current <= end : current >= start || current <= end;
}
function finite(value, label, maximum = 1e9) {
  if (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > maximum) throw new Error(`${label}必须是 0 至 ${maximum} 的数字`);
  return Number(value);
}
function strings(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim())) throw new Error('商品或计划范围必须是编号数组');
  return [...new Set(value.map(v => v.trim()))];
}
function normalizeRule(input, storeId, previous, now) {
  if (!input || typeof input !== 'object') throw new Error('缺少推广规则');
  const channel = input.channel === 'sitewide' ? 'product' : (input.channel || 'product');
  if (channel === 'keyword') throw new Error('关键词推广暂不支持，不能保存或执行关键词规则');
  if (!CHANNELS.includes(channel)) throw new Error('不支持的推广渠道');
  const name = String(input.name || '').trim();
  if (!name || name.length > 100) throw new Error('规则名称必须为 1 至 100 个字符');
  const interval = Number(input.intervalMinutes ?? 30);
  if (!INTERVALS.includes(interval)) throw new Error('巡查间隔仅支持 5、10、15、30、60 分钟');
  const datePreset = input.datePreset || 'today';
  if (!['today', 'yesterday', 'last3', 'last7', 'last14', 'last30'].includes(datePreset)) throw new Error('不支持的规则统计日期');
  const startTime = input.startTime || '00:00';
  const endTime = input.endTime || '23:59';
  clockMinutes(startTime); clockMinutes(endTime);
  const spend = finite(input.spendThreshold, '花费阈值');
  const roi = finite(input.roiThreshold, '投产比阈值', 1e6);
  const recoverAfterMinutes = finite(input.recoverAfterMinutes ?? 0, '暂停后恢复分钟数', 43200);
  return {
    id: previous?.id || randomUUID(), name, enabled: input.enabled !== false,
    channel, channels: [channel], profileIds: [storeId],
    groupIds: strings(input.groupIds), campaignIds: strings(input.campaignIds),
    itemIds: strings(input.itemIds), excludedItemIds: strings(input.excludedItemIds),
    minimumSpend: spend, maximumRoi: roi, spendThreshold: spend, roiThreshold: roi,
    conditions: [{ metric: 'spend', operator: 'gte', value: spend }, { metric: channel === 'product' ? 'netRoi' : 'roi', operator: 'lte', value: roi }],
    conditionLogic: 'and', action: 'pause', autoRecover: recoverAfterMinutes > 0,
    recoverAfterMinutes, recoveryTime: '09:00', intervalMinutes: interval,
    executionIntervalMinutes: interval, startTime, endTime, datePreset, includeToday: true,
    createdAt: previous?.createdAt || now, updatedAt: now
  };
}
function validateRange(start, end, now) {
  const today = shanghaiDate(now);
  start = start || today; end = end || today;
  for (const date of [start, end]) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('推广同步日期无效');
  }
  if (start > end || end > today) throw new Error('推广同步日期顺序错误或超过今天');
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 365) throw new Error('单次推广同步范围最多 366 天，请分段同步');
  return { startDate: start, endDate: end };
}
function campaignKey(c) { return `${c.channel}:${c.id}`; }
function targetKey(t) { return `${t.campaignId}:${t.platformUnitId || ''}`; }

// Dependencies are injected only by isolated tests; IPC payloads never select a platform.
function createPromotionService(ctx, dependencies = {}) {
  const now = dependencies.now || (() => new Date().toISOString());
  const store = dependencies.store || createPromotionLocalStore({ rootDir: path.join(ctx.dataDir, 'promotion') });
  const liveStores = new Set();
  const observedStores = new Set();
  const freshStores = new Set();
  const manualTargets = new Map();
  const authorizationEpochs = new Map();
  const lastRuns = new Map();
  const controlWrites = new Set();
  let initialized;
  let operationTail = Promise.resolve();
  let disposed = false;
  let ticking = false;
  const emit = (storeId, message, extra = {}) => ctx.emit?.({ module: 'promotion', storeId, message, ...extra });
  function ready() {
    initialized ||= (async () => {
      await store.loadSnapshot(ACCOUNT);
      // Deliberately resets persisted writes on every launch, including power loss.
      await store.setMode(ACCOUNT, null, 'observe');
    })();
    return initialized;
  }
  function serial(fn) {
    const result = operationTail.catch(() => {}).then(async () => { await ready(); if (disposed) throw new Error('推广服务已停止'); return fn(); });
    operationTail = result;
    return result;
  }
  function writeAuthorized(id, target, status) {
    return !disposed && (liveStores.has(id) || (status === 'paused' && manualTargets.get(id)?.has(targetKey(target))));
  }
  async function stopForAuthentication(storeId) {
    liveStores.delete(storeId); manualTargets.delete(storeId);
    authorizationEpochs.set(storeId, (authorizationEpochs.get(storeId) || 0) + 1);
    await store.setMode(ACCOUNT, storeId, 'observe');
  }
  async function pageContext(storeId) {
    ctx.getStore(storeId);
    const page = await ctx.browser.page(storeId, 'promotion', { show: false });
    const barrier = await page.executeJavaScript(`(() => {
      const text = (document.body?.innerText || '').slice(0, 18000);
      if (/验证码|安全验证|拖动滑块|访问受限|操作过于频繁/.test(text)) return 'verification';
      if (document.querySelector('input[type="password"], #alibaba-login-box, iframe[src*="login"]') || /^#!\\/login/.test(location.hash)) return 'login';
      return '';
    })()`);
    if (barrier) {
      await stopForAuthentication(storeId);
      throw new Error(barrier === 'verification' ? '天猫要求安全验证，已停止推广自动操作；请打开店铺后台手动验证，再重新启用正式运行' : '店铺推广登录已失效，请打开店铺后台登录后重新启用正式运行');
    }
    const session = await connector.waitForAlimamaPageSessionContext(() => [page], { maxAttempts: 20 });
    if (!session) { await stopForAuthentication(storeId); throw new Error('尚未取得天猫推广登录会话，已停止自动操作；请打开推广后台完成登录并等待加载后重试'); }
    return { page, session };
  }
  async function onPage(id, operation) {
    try { const { page, session } = await pageContext(id); return await operation(page, session); }
    catch (error) {
      if (error.code === 'needs-login' || /安全验证|验证码|拖动滑块|登录.*失效|访问受限|captcha/i.test(error.message)) await stopForAuthentication(id);
      throw error;
    }
  }
  const realPlatform = {
    async sync(id, range) { return onPage(id, (page, session) => connector.syncAlimamaCampaigns(page, range, session)); },
    async syncProductRange(id, range) { return onPage(id, (page, session) => connector.syncAlimamaProductRange(page, range, session)); },
    async verifyProductRange(id, range) { return onPage(id, (page, session) => connector.syncAlimamaProductRange(page, range, session)); },
    async verifyProductRealtime(id, range) { return onPage(id, (page, session) => connector.syncAlimamaCampaigns(page, { ...range, channels: ['product'] }, session)); },
    async updateStatus(id, target, status) { return onPage(id, (page, session) => {
      if (!writeAuthorized(id, target, status)) throw new Error('推广执行已停止，未发送状态修改请求');
      return connector.updateAlimamaCampaignStatus(page, target.campaignId, status, session, target.platformUnitId);
    }); },
    async verifyStatuses(id, requests) { return onPage(id, (page, session) => connector.verifyAlimamaCampaignStatuses(page, requests, session)); }
  };
  const platform = dependencies.platform || realPlatform;
  const guardedPlatform = { ...platform,
    async updateStatus(id, target, status) {
      ctx.getStore(id);
      if (!writeAuthorized(id, target, status)) throw new Error('本次会话尚未确认正式执行，已阻止推广状态修改');
      // A missing unit ID must never broaden an item action to an entire shop plan.
      if (!target.platformUnitId) {
        const snapshot = await store.loadSnapshot(ACCOUNT);
        const latestDay = snapshot.control.dailySnapshots.filter(d => d.profileId === id).sort((a, b) => b.date.localeCompare(a.date))[0];
        const associated = (latestDay?.campaigns || []).filter(c => (c.platformTargets || []).some(t => t.campaignId === target.campaignId) || c.parentCampaignId === target.campaignId);
        if (!associated.length || associated.some(c => c.channel !== 'product') || new Set(associated.map(c => c.itemId)).size !== 1) throw new Error('无法确认推广计划只对应当前商品，已阻止整计划操作；请在天猫后台核对');
      }
      if (!writeAuthorized(id, target, status)) throw new Error('推广执行已停止，未发送状态修改请求');
      return platform.updateStatus(id, target, status);
    }
  };
  const automation = createPromotionAutomationService({ store, platform: guardedPlatform, now, id: randomUUID });
  async function load(storeId) {
    const snapshot = await store.loadSnapshot(ACCOUNT);
    const control = snapshot.control;
    const range = domain.resolvePromotionDateRange(control.datePreset, control.includeToday, now(), { startDate: control.customStartDate, endDate: control.customEndDate });
    const campaigns = domain.aggregatePromotionDailyCampaigns(control.dailySnapshots, storeId, range.startDate, range.endDate).filter(c => CHANNELS.includes(c.channel));
    const logs = control.logs.filter(l => l.profileId === storeId);
    const spend = campaigns.reduce((sum, c) => sum + c.spend, 0);
    const revenue = campaigns.reduce((sum, c) => sum + c.revenue, 0);
    const latest = control.dailySnapshots.filter(d => d.profileId === storeId).map(d => d.syncedAt).sort().at(-1) || null;
    return {
      campaigns, rules: control.rules.filter(r => r.profileIds?.includes(storeId)), logs,
      mode: liveStores.has(storeId) && domain.getPromotionStoreMode(control, storeId) === 'automatic' ? 'live' : 'observe',
      lastSync: latest, lastRun: lastRuns.get(storeId) || null, start: range.startDate, end: range.endDate,
      recoveries: control.recoveries.filter(r => r.profileId === storeId),
      summary: { count: campaigns.length, active: campaigns.filter(c => c.status === 'active').length, spend, revenue, roi: spend > 0 ? revenue / spend : 0 },
      fullSyncReady: freshStores.has(storeId) && control.fullSyncReadyProfileIds.includes(storeId), notice: NOTICE
    };
  }
  async function sync(storeId, payload = {}) {
    if (payload.channel === 'keyword' || payload.channels?.includes('keyword')) throw new Error('关键词推广暂不支持同步或自动执行');
    const range = validateRange(payload.start, payload.end, now());
    emit(storeId, '正在读取天猫全站商品与全站全店数据');
    await automation.sync(ACCOUNT, storeId, { ...range, mode: 'full', activateRange: true, channels: CHANNELS }, progress => emit(storeId, `${progress.currentDate || ''} ${progress.message || '同步中'}`, { current: progress.completedDays, total: progress.totalDays }));
    freshStores.add(storeId);
    observedStores.add(storeId);
    emit(storeId, '推广同步完成，本地保存与回读校验通过');
    return load(storeId);
  }
  async function run(storeId, dueOnly = false) {
    const snapshot = await store.loadSnapshot(ACCOUNT);
    const at = now();
    const rules = snapshot.control.rules.filter(r => r.enabled && r.profileIds?.includes(storeId) && isRuleInWindow(r, at) && (!dueOnly || !r.lastRunAt || Date.parse(at) - Date.parse(r.lastRunAt) >= (r.intervalMinutes || 30) * 60000));
    if (!rules.length) {
      lastRuns.set(storeId, { at, status: 'skipped', message: '当前没有已启用且处于运行时段内的到期规则' });
      return load(storeId);
    }
    if (!freshStores.has(storeId)) throw new Error('本次启动后尚未完成全量同步，请先同步推广数据');
    const result = await automation.runRules(ACCOUNT, storeId, { ruleIds: rules.map(r => r.id) });
    const problems = result.actions.filter(l => l.status === 'failed' || l.status === 'skipped');
    const message = problems.length ? problems.map(l => l.reason).join('；') : `巡查完成，命中 ${result.matches.length} 个对象；${liveStores.has(storeId) ? '已按后台回读记录结果' : '观察模式未修改后台'}`;
    lastRuns.set(storeId, { at, status: problems.length ? 'blocked' : 'completed', message });
    emit(storeId, message, { status: problems.length ? 'blocked' : 'completed' });
    if (problems.length) throw new Error(message);
    return load(storeId);
  }
  async function pause(storeId, payload, epoch) {
    if (payload.confirmed !== true) throw new Error('请确认所选店铺和商品后再暂停推广');
    if (!Array.isArray(payload.campaigns) || !payload.campaigns.length || payload.campaigns.length > 100) throw new Error('请选定 1 至 100 个推广对象');
    const before = await load(storeId);
    const selected = payload.campaigns.map(choice => {
      const matches = before.campaigns.filter(c => typeof choice === 'string' ? c.id === choice : c.id === choice?.id && (!choice.channel || c.channel === choice.channel));
      if (matches.length !== 1) throw new Error('选中的推广对象不存在或有歧义，请刷新后重新选择');
      return campaignKey(matches[0]);
    });
    // Fresh authenticated data supplies every executable ID; UI objects are never trusted.
    const today = shanghaiDate(now());
    await automation.sync(ACCOUNT, storeId, { startDate: today, endDate: today, channels: CHANNELS, mode: 'full' });
    const snapshot = await store.loadSnapshot(ACCOUNT);
    const current = domain.aggregatePromotionDailyCampaigns(snapshot.control.dailySnapshots, storeId, today, today);
    const chosen = [...new Set(selected)].map(key => {
      const campaign = current.find(c => campaignKey(c) === key);
      if (!campaign || campaign.status !== 'active') throw new Error('所选商品当前不在推广中，未执行本批暂停，请刷新后核对');
      return campaign;
    });
    if ((authorizationEpochs.get(storeId) || 0) !== epoch) throw new Error('推广执行已被停止，本批暂停已取消');
    if (chosen.some(c => c.channel === 'store' && ((c.platformTargets?.length && c.platformTargets.some(t => !t.unitId)) || (!c.platformTargets?.length && !c.platformUnitId)))) throw new Error('选定的全店推广商品缺少推广单元，不能退化为整计划暂停');
    const targets = new Set(chosen.flatMap(c => (c.platformTargets || []).map(t => targetKey({ campaignId: t.campaignId, platformUnitId: c.channel === 'product' ? undefined : t.unitId }))));
    for (const c of chosen) targets.add(targetKey({ campaignId: c.parentCampaignId || c.id, platformUnitId: c.channel === 'product' ? undefined : c.platformUnitId }));
    manualTargets.set(storeId, targets);
    try {
      const result = await automation.updateCampaignStatuses(ACCOUNT, storeId, chosen.map(campaign => ({ campaign, status: 'paused' })));
      const failed = result.results.filter(r => r.status !== 'success');
      if (failed.length) throw new Error(`有 ${failed.length} 个对象未确认暂停：${failed.map(r => r.reason).join('；')}。请查看执行记录`);
      return { ...(await load(storeId)), results: result.results };
    } finally { manualTargets.delete(storeId); }
  }
  async function tick() {
    if (disposed || ticking || !initialized) return;
    ticking = true;
    try {
      await serial(async () => {
        for (const storeId of observedStores) {
          try {
            ctx.getStore(storeId);
            if (liveStores.has(storeId)) {
              const before = await store.loadSnapshot(ACCOUNT);
              const pendingDue = before.control.recoveries.filter(r => r.profileId === storeId && r.status === 'pending' && Date.parse(r.dueAt) <= Date.parse(now()));
              if (pendingDue.length) {
                const result = await automation.processRecoveries(ACCOUNT, storeId);
                const failed = result.control.logs.filter(l => l.profileId === storeId && l.status === 'failed' && !before.control.logs.some(old => old.id === l.id));
                if (failed.length) emit(storeId, failed.map(l => l.reason).join('；'), { status: 'failed' });
              }
            }
            await run(storeId, true);
          } catch (error) { emit(storeId, error.message, { status: 'failed' }); }
        }
      });
    } finally { ticking = false; }
  }
  const timer = dependencies.schedule === false ? null : setInterval(() => { tick().catch(error => emit('', error.message, { status: 'failed' })); }, 30000);
  timer?.unref?.();
  return {
    async handle(action, payload = {}) {
      if (disposed) throw new Error('推广服务已停止');
      const storeId = String(payload.storeId || '');
      ctx.getStore(storeId);
      if (action === 'setMode' && payload.mode === 'observe') {
        liveStores.delete(storeId); manualTargets.delete(storeId);
        authorizationEpochs.set(storeId, (authorizationEpochs.get(storeId) || 0) + 1);
        const pending = (async () => { await ready(); await store.setMode(ACCOUNT, storeId, 'observe'); return load(storeId); })();
        controlWrites.add(pending);
        try { return await pending; } finally { controlWrites.delete(pending); }
      }
      const epoch = authorizationEpochs.get(storeId) || 0;
      return serial(async () => {
        if (action === 'load') return load(storeId);
        if (action === 'sync') return sync(storeId, payload);
        if (action === 'run') return run(storeId);
        if (action === 'pause') return pause(storeId, payload, epoch);
        if (action === 'setMode') {
          if (payload.mode !== 'live') throw new Error('不支持的推广运行模式');
          if (payload.confirmed !== true) throw new Error('请核对当前店铺规则与暂停/恢复范围，并确认启用正式运行');
          const state = await load(storeId);
          if (!state.fullSyncReady) throw new Error('本次启动后必须先完成全量同步，再启用正式运行');
          if (!state.rules.some(r => r.enabled)) throw new Error('请先保存并启用至少一条推广规则');
          if ((authorizationEpochs.get(storeId) || 0) !== epoch) throw new Error('启用请求已被后续停止操作取消');
          await store.setMode(ACCOUNT, storeId, 'automatic');
          if ((authorizationEpochs.get(storeId) || 0) !== epoch) { await store.setMode(ACCOUNT, storeId, 'observe'); throw new Error('启用请求已被后续停止操作取消'); }
          liveStores.add(storeId); observedStores.add(storeId);
          return load(storeId);
        }
        if (action === 'saveRule' || action === 'deleteRule') {
          const snapshot = await store.loadSnapshot(ACCOUNT);
          const id = action === 'deleteRule' ? payload.id : payload.rule?.id;
          const previous = id ? snapshot.control.rules.find(r => r.id === id && r.profileIds?.includes(storeId)) : null;
          if (id && !previous) throw new Error('该推广规则不属于当前店铺或已删除');
          const rule = action === 'saveRule' ? normalizeRule(payload.rule, storeId, previous, now()) : null;
          const rules = snapshot.control.rules.filter(r => !previous || r.id !== previous.id);
          if (rule) rules.push(rule);
          liveStores.delete(storeId);
          await store.setMode(ACCOUNT, storeId, 'observe');
          const current = await store.loadSnapshot(ACCOUNT);
          await store.saveSnapshot(ACCOUNT, { ...current, control: { ...current.control, rules,
            monitoredProfileIds: [...new Set([...current.control.monitoredProfileIds, storeId])],
            recoveries: current.control.recoveries.map(r => r.profileId === storeId && r.status === 'pending' ? { ...r, status: 'cancelled', lastError: '规则已修改，旧的恢复任务已取消' } : r)
          } });
          observedStores.add(storeId);
          return load(storeId);
        }
        if (action === 'export') {
          const state = await load(storeId);
          return ctx.files.exportWorkbook(`推广数据_${ctx.getStore(storeId).name}_${shanghaiDate(now())}.xlsx`, [
            { name: '商品数据', rows: state.campaigns, columns: [{ key: 'itemId', label: '商品ID' }, { key: 'name', label: '名称' }, { key: 'channel', label: '渠道' }, { key: 'status', label: '状态' }, { key: 'spend', label: '花费' }, { key: 'revenue', label: '成交额' }, { key: 'roi', label: '投产比' }, { key: 'netRoi', label: '净投产比' }, { key: 'clicks', label: '点击' }] },
            { name: '执行记录', rows: state.logs, columns: [{ key: 'createdAt', label: '时间' }, { key: 'campaignName', label: '推广对象' }, { key: 'itemId', label: '商品ID' }, { key: 'ruleName', label: '规则' }, { key: 'action', label: '动作' }, { key: 'status', label: '结果' }, { key: 'reason', label: '原因' }] }
          ]);
        }
        throw new Error(`不支持的推广操作：${action}`);
      });
    },
    tick,
    async dispose() {
      disposed = true; liveStores.clear(); manualTargets.clear();
      if (timer) clearInterval(timer);
      // Import/shutdown waits until every already-started readback and local write
      // has settled. No new platform writes can pass the in-memory guard above.
      await Promise.allSettled([operationTail, initialized, ...controlWrites].filter(Boolean));
    }
  };
}

module.exports = { createPromotionService, normalizeRule, isRuleInWindow, validateRange };
