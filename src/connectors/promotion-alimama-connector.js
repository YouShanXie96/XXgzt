"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlimamaPromotionError = exports.buildAlimamaKeywordRangeExportRequest = void 0;
exports.buildAlimamaItemRangeExportRequest = buildAlimamaItemRangeExportRequest;
exports.parseAlimamaItemRangeCsv = parseAlimamaItemRangeCsv;
exports.parseAlimamaKeywordRangeCsv = parseAlimamaKeywordRangeCsv;
exports.buildAlimamaChannelSummaryRequest = buildAlimamaChannelSummaryRequest;
exports.buildAlimamaHistoricalProductReportRequest = buildAlimamaHistoricalProductReportRequest;
exports.findAlimamaSessionContextFromValues = findAlimamaSessionContextFromValues;
exports.findAlimamaSessionContextFromResourceUrls = findAlimamaSessionContextFromResourceUrls;
exports.readAlimamaPageSessionContext = readAlimamaPageSessionContext;
exports.waitForAlimamaPageSessionContext = waitForAlimamaPageSessionContext;
exports.applyAlimamaSessionContext = applyAlimamaSessionContext;
exports.promotionCampaignsHaveActivity = promotionCampaignsHaveActivity;
exports.isAlimamaLoginUrl = isAlimamaLoginUrl;
exports.orderAlimamaPageCandidates = orderAlimamaPageCandidates;
exports.ensureAlimamaProfilePage = ensureAlimamaProfilePage;
exports.buildAlimamaReportRequest = buildAlimamaReportRequest;
exports.buildAlimamaKeywordReportRequest = buildAlimamaKeywordReportRequest;
exports.buildAlimamaKeywordItemReportRequest = buildAlimamaKeywordItemReportRequest;
exports.buildAlimamaStoreItemRequest = buildAlimamaStoreItemRequest;
exports.buildAlimamaStoreAdgroupRequest = buildAlimamaStoreAdgroupRequest;
exports.buildAlimamaCampaignStatusRequest = buildAlimamaCampaignStatusRequest;
exports.buildAlimamaCampaignStatusMutation = buildAlimamaCampaignStatusMutation;
exports.parseAlimamaCampaignResponse = parseAlimamaCampaignResponse;
exports.syncAlimamaItemRange = syncAlimamaItemRange;
exports.syncAlimamaKeywordRange = syncAlimamaKeywordRange;
exports.splitAlimamaAsyncReportDateRange = splitAlimamaAsyncReportDateRange;
exports.syncAlimamaProductRange = syncAlimamaProductRange;
exports.parseAlimamaHistoricalProductReportResponse = parseAlimamaHistoricalProductReportResponse;
exports.syncAlimamaCampaigns = syncAlimamaCampaigns;
exports.updateAlimamaCampaignStatus = updateAlimamaCampaignStatus;
exports.evaluateAlimamaStatusVerifications = evaluateAlimamaStatusVerifications;
exports.verifyAlimamaCampaignStatuses = verifyAlimamaCampaignStatuses;
const fflate_1 = require("fflate");
const reportFields = [
    'roi',
    'retainedRoi',
    'charge',
    'alipayInshopNum',
    'alipayDirNum',
    'alipayInshopAmt',
    'retainedAlipayInshopAmt',
    'retainedAlipayInshopNum',
    'alipayDirAmtNet',
    'alipayDirNumNet',
    'dirNetRoi',
    'click',
    'ctr',
    'adPv',
    'ecpc',
    'cartInshopNum',
    'itemColInshopNum'
].join(',');
const storeItemReportFields = [
    'roi',
    'charge',
    'alipayInshopAmt',
    'retainedAlipayInshopAmt',
    'alipayDirAmt',
    'alipayInshopNum',
    'retainedAlipayInshopNum',
    'cartInshopNum',
    'alipayDirNum',
    'cvr',
    'click',
    'ctr',
    'ecpc',
    'ecpm',
    'adPv'
].join(',');
const keywordReportFields = [
    'charge',
    'roi',
    'adPv',
    'click',
    'ctr',
    'alipayInshopAmt',
    'alipayInshopNum',
    'cartInshopNum',
    'ecpc',
    'cvr',
    'itemColInshopNum',
    'shopColDirNum',
    'colNum',
    'itemColInshopCost'
].join(',');
const channelSummaryFields = [
    'roi',
    'retainedRoi',
    'charge',
    'adPv',
    'click',
    'alipayDirAmt',
    'alipayDirNum',
    'alipayDirAmtNet',
    'alipayDirNumNet',
    'dirNetRoi',
    'alipayInshopNum',
    'alipayInshopAmt',
    'retainedAlipayInshopAmt',
    'retainedAlipayInshopNum',
    'cartInshopNum',
    'cvr',
    'ecpc'
];
// Large OneBP campaign exports can stay in the platform queue for more than a
// minute, especially for stores with thousands of plans. Keep each task small
// enough to complete reliably and allow the server time to finish it. This is
// intentionally conservative: correctness matters more than shaving seconds
// off a 30-day full synchronization.
const ALIMAMA_ASYNC_REPORT_MAX_DAYS = 7;
const ALIMAMA_ASYNC_REPORT_POLL_ATTEMPTS = 360;
const ALIMAMA_ASYNC_REPORT_POLL_INTERVAL_MS = 500;
const ALIMAMA_JSON_REQUEST_TIMEOUT_MS = 30_000;
// Historical campaign metrics shown in Alimama's "计划报表". These fields are
// retained only for parsing old diagnostic responses. A campaign row can contain
// multiple products, so campaign-level metrics must never be written to one
// product or used by a destructive rule.
const historicalProductReportFields = [
    'adPv',
    'click',
    'charge',
    'roi',
    'retainedRoi',
    'ctr',
    'ecpc',
    'alipayInshopAmt',
    'retainedAlipayInshopAmt',
    'alipayInshopNum',
    'retainedAlipayInshopNum',
    'alipayDirAmtNet',
    'alipayDirNumNet',
    'dirNetRoi',
    'cvr',
    'cartInshopNum',
    'itemColInshopNum',
    'shopColDirNum',
    'colNum',
    'itemColInshopCost'
];
// A single keyword day can contain tens of thousands of adgroups. Keep the
// page pipeline full without letting multi-day syncs fan out into an
// unbounded number of requests against the signed-in Alimama page.
const ALIMAMA_KEYWORD_PAGE_CONCURRENCY = 20;
const ALIMAMA_KEYWORD_CAMPAIGN_CHUNK_SIZE = 10;
const ALIMAMA_STATIC_INVENTORY_TTL_MS = 2 * 60 * 1000;
let activeAlimamaKeywordPageRequests = 0;
const pendingAlimamaKeywordPageRequests = [];
const alimamaStaticInventoryCache = new WeakMap();
function runAlimamaKeywordPageRequest(task) {
    return new Promise((resolve, reject) => {
        const start = () => {
            activeAlimamaKeywordPageRequests += 1;
            Promise.resolve()
                .then(task)
                .then(resolve, reject)
                .finally(() => {
                activeAlimamaKeywordPageRequests -= 1;
                pendingAlimamaKeywordPageRequests.shift()?.();
            });
        };
        if (activeAlimamaKeywordPageRequests < ALIMAMA_KEYWORD_PAGE_CONCURRENCY) {
            start();
        }
        else {
            pendingAlimamaKeywordPageRequests.push(start);
        }
    });
}
async function mapAlimamaKeywordPageRequests(offsets, requestPage) {
    const results = new Array(offsets.length);
    let nextIndex = 0;
    let stopped = false;
    const worker = async () => {
        while (!stopped) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= offsets.length)
                return;
            try {
                results[index] = await runAlimamaKeywordPageRequest(() => requestPage(offsets[index]));
            }
            catch (error) {
                stopped = true;
                throw error;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(ALIMAMA_KEYWORD_PAGE_CONCURRENCY, offsets.length) }, () => worker()));
    return results;
}
const alimamaItemMetricAliases = [
    ['charge', ['charge', 'cost', 'spend']],
    ['roi', ['roi', 'actualRoi']],
    ['retainedRoi', ['retainedRoi', 'netRoi']],
    ['alipayInshopNum', ['alipayInshopNum', 'orders', 'orderCount']],
    ['retainedAlipayInshopNum', ['retainedAlipayInshopNum', 'netOrders']],
    ['alipayDirNum', ['alipayDirNum', 'directOrders']],
    ['alipayInshopAmt', ['alipayInshopAmt', 'revenue']],
    ['retainedAlipayInshopAmt', ['retainedAlipayInshopAmt', 'netRevenue']],
    ['alipayDirAmtNet', ['alipayDirAmtNet', 'directNetRevenue']],
    ['alipayDirNumNet', ['alipayDirNumNet', 'directNetOrders']],
    ['dirNetRoi', ['dirNetRoi', 'directNetRoi']],
    ['click', ['click', 'clicks']],
    ['adPv', ['adPv', 'impressions', 'pv']],
    ['cartInshopNum', ['cartInshopNum', 'cartAdds']]
];
const ALIMAMA_ITEM_EXPORT_FIELDS = [
    'adPv',
    'click',
    'charge',
    'roi',
    'retainedRoi',
    'alipayInshopAmt',
    'alipayInshopNum',
    'retainedAlipayInshopAmt',
    'retainedAlipayInshopNum',
    'alipayDirAmtNet',
    'alipayDirNumNet',
    'alipayDirNum',
    'dirNetRoi',
    'cartInshopNum'
];
function buildAlimamaItemRangeExportRequest(input) {
    const campaignLevel = input.reportLevel === 'campaign';
    return {
        excelName: input.excelName ?? `三渠道商品明细_${input.startDate}_${input.endDate}`,
        queryFieldIn: [...ALIMAMA_ITEM_EXPORT_FIELDS],
        pageSize: 20,
        offset: 0,
        havingList: [],
        endTime: input.endDate,
        from: 'pcBaseReport',
        unifyType: 'zhai',
        effectEqual: 15,
        startTime: input.startDate,
        splitType: 'day',
        subPromotionTypes: ['ITEM'],
        vsType: 'week',
        vsTime: input.endDate,
        searchValue: '',
        searchKey: 'itemIdOrName',
        queryDomains: campaignLevel
            ? ['campaign', 'date', 'promotion']
            : ['promotion', 'date', 'scene'],
        fieldType: 'all',
        rptType: campaignLevel ? 'campaign' : 'item_promotion',
        parentAdcName: campaignLevel ? 'report_frame_campaign' : 'report_frame_item_promotion',
        byPage: false,
        fromRealTime: false,
        source: 'async_dowdload',
        bizCode: 'universalBP'
    };
}
exports.buildAlimamaKeywordRangeExportRequest = buildAlimamaItemRangeExportRequest;
function parseAlimamaCsvRows(value) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = value.replace(/^\uFEFF/, '');
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (quoted) {
            if (character === '"' && source[index + 1] === '"') {
                cell += '"';
                index += 1;
            }
            else if (character === '"') {
                quoted = false;
            }
            else {
                cell += character;
            }
        }
        else if (character === '"') {
            quoted = true;
        }
        else if (character === ',') {
            row.push(cell);
            cell = '';
        }
        else if (character === '\n') {
            row.push(cell.replace(/\r$/, ''));
            if (row.some((entry) => entry !== ''))
                rows.push(row);
            row = [];
            cell = '';
        }
        else {
            cell += character;
        }
    }
    if (cell !== '' || row.length > 0) {
        row.push(cell.replace(/\r$/, ''));
        if (row.some((entry) => entry !== ''))
            rows.push(row);
    }
    return rows;
}
function alimamaCsvNumber(value) {
    const parsed = Number(String(value ?? '').replace(/[￥¥,%\s]/g, ''));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function readAlimamaCsvMetric(row, indexes, aliases) {
    const header = aliases.find((candidate) => indexes.has(candidate));
    return header ? alimamaCsvNumber(row[indexes.get(header)]?.trim()) : undefined;
}
function alimamaMetricValuesEqual(left, right, tolerance = 0.000_001) {
    if (left === undefined || right === undefined)
        return left === right;
    return Math.abs(left - right) <= tolerance;
}
function assertSameAlimamaItemMetrics(left, right, identity) {
    const comparableMetrics = [
        ['spend', left.spend, right.spend],
        ['revenue', left.revenue, right.revenue],
        ['orders', left.orders, right.orders],
        ['clicks', left.clicks, right.clicks],
        ['impressions', left.impressions, right.impressions],
        ['cartAdds', left.cartAdds, right.cartAdds],
        ['netRevenue', left.netRevenue, right.netRevenue],
        ['netRoi', left.netRoi, right.netRoi],
        ['netOrders', left.netOrders, right.netOrders],
        ['directNetRevenue', left.directNetRevenue, right.directNetRevenue],
        ['directNetRoi', left.directNetRoi, right.directNetRoi],
        ['directNetOrders', left.directNetOrders, right.directNetOrders],
        ['directOrders', left.directOrders, right.directOrders]
    ];
    const mismatch = comparableMetrics.find(([, previous, current]) => (!alimamaMetricValuesEqual(previous, current)));
    if (mismatch) {
        throw new AlimamaPromotionError(`同一计划商品返回了不一致的重复数据（${identity}，${mismatch[0]}）：已拒绝累计，避免误判规则`, 'invalid-response');
    }
}
function parseAlimamaItemRangeCsv(csv, input) {
    const [headers, ...rows] = parseAlimamaCsvRows(csv);
    if (!headers) {
        throw new AlimamaPromotionError('商品维度推广导出报表为空', 'invalid-response');
    }
    const indexes = new Map(headers.map((header, index) => [header.trim(), index]));
    const read = (row, header) => row[indexes.get(header) ?? -1]?.trim() ?? '';
    for (const required of ['日期', '场景ID', '主体ID', '主体名称', '花费']) {
        if (!indexes.has(required)) {
            throw new AlimamaPromotionError(`商品维度推广导出报表缺少“${required}”字段`, 'invalid-response');
        }
    }
    const campaignsByDate = new Map();
    for (const row of rows) {
        const sceneId = read(row, '场景ID');
        const sceneName = read(row, '场景名字');
        const channel = sceneId === '371' || sceneName === '关键词推广'
            ? 'keyword'
            : sceneId === '436' || sceneName === '货品全站推广' || sceneName === '全站商品'
                ? 'product'
                : null;
        if (!channel || !input.channels.includes(channel))
            continue;
        const date = read(row, '日期');
        const itemId = read(row, '主体ID');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !itemId)
            continue;
        const spend = alimamaCsvNumber(read(row, '花费'));
        const reportedRevenue = readAlimamaCsvMetric(row, indexes, ['总成交金额', '成交金额', '总成交金额(元)']);
        const revenue = reportedRevenue ?? 0;
        const reportedNetRevenue = readAlimamaCsvMetric(row, indexes, ['净成交金额', '净成交金额(元)']);
        // OneBP's campaign-by-item export currently omits every retained/net
        // column for some stores. An explicit zero gross amount is still enough
        // to prove the retained amount and ROI are zero: refunds cannot turn a
        // zero gross conversion into positive retained revenue. Preserve unknown
        // only when the gross amount column itself is absent or is non-zero.
        const netRevenue = reportedNetRevenue ?? (reportedRevenue === 0 ? 0 : undefined);
        const reportedNetRoi = readAlimamaCsvMetric(row, indexes, ['净实际投产比', '净投产比']);
        const netRoi = netRevenue === undefined
            ? reportedNetRoi
            : spend > 0 ? netRevenue / spend : reportedNetRoi ?? 0;
        const directNetRevenue = readAlimamaCsvMetric(row, indexes, ['直接净成交金额', '直接净成交金额(元)'])
            ?? (reportedRevenue === 0 ? 0 : undefined);
        const reportedDirectNetRoi = readAlimamaCsvMetric(row, indexes, ['直接净投产比']);
        const directNetRoi = directNetRevenue === undefined
            ? reportedDirectNetRoi
            : spend > 0 ? directNetRevenue / spend : reportedDirectNetRoi ?? 0;
        const reportedOrders = readAlimamaCsvMetric(row, indexes, ['总成交笔数', '成交笔数']);
        const orders = reportedOrders ?? 0;
        const netOrders = readAlimamaCsvMetric(row, indexes, ['净成交笔数'])
            ?? (reportedOrders === 0 ? 0 : undefined);
        const directNetOrders = readAlimamaCsvMetric(row, indexes, ['直接净成交笔数'])
            ?? (reportedOrders === 0 ? 0 : undefined);
        const directOrders = readAlimamaCsvMetric(row, indexes, ['直接成交笔数'])
            ?? (reportedOrders === 0 ? 0 : undefined);
        const dateCampaigns = campaignsByDate.get(date) ?? new Map();
        campaignsByDate.set(date, dateCampaigns);
        const campaignId = read(row, '\u8ba1\u5212ID');
        const campaignName = read(row, '\u8ba1\u5212\u540d\u5b57');
        const identity = campaignId
            ? `${channel}:${campaignId}:${itemId}`
            : `${channel}:${itemId}`;
        const previous = dateCampaigns.get(identity);
        if (previous) {
            // The legacy keyword export intentionally has no plan dimension and can
            // contain several additive rows for one product. Keyword automation is
            // disabled, but keep its read-only report aggregation intact.
            if (!campaignId && channel === 'keyword') {
                previous.spend += spend;
                previous.revenue += revenue;
                previous.orders += orders;
                previous.clicks += alimamaCsvNumber(read(row, '点击量'));
                previous.impressions += alimamaCsvNumber(read(row, '展现量'));
                previous.cartAdds = (previous.cartAdds ?? 0) + alimamaCsvNumber(read(row, '总购物车数'));
                previous.roi = previous.spend > 0 ? previous.revenue / previous.spend : 0;
                continue;
            }
            // A retried/prefetched export can repeat one plan + item row. The row is
            // the same fact, so never add it again. If the repeated values disagree,
            // reject the response instead of allowing a destructive rule to consume
            // an ambiguous total.
            assertSameAlimamaItemMetrics(previous, {
                spend,
                revenue,
                orders,
                clicks: alimamaCsvNumber(read(row, '点击量')),
                impressions: alimamaCsvNumber(read(row, '展现量')),
                cartAdds: alimamaCsvNumber(read(row, '总购物车数')),
                netRevenue,
                netRoi,
                netOrders,
                directNetRevenue,
                directNetRoi,
                directNetOrders,
                directOrders
            }, `${date}:${identity}`);
            continue;
        }
        dateCampaigns.set(identity, {
            id: campaignId ? `bulk:${channel}:${campaignId}:${itemId}` : `bulk:${channel}:${itemId}`,
            targetLevel: 'item',
            name: read(row, '主体名称') || itemId,
            itemId,
            itemName: read(row, '主体名称') || itemId,
            channel,
            ...(campaignId ? {
                parentCampaignId: campaignId,
                sourceCampaignIds: [campaignId],
                ...(campaignName ? { name: campaignName } : {})
            } : {}),
            groupId: null,
            groupName: '',
            status: 'unknown',
            dailyBudget: null,
            targetRoi: null,
            spend,
            roi: spend > 0 ? revenue / spend : alimamaCsvNumber(read(row, '投入产出比')),
            ...(netRevenue === undefined ? {} : { netRevenue }),
            // Some official item exports include retained/net ROI but omit the net
            // amount columns. Preserve the explicit platform ratio instead of
            // silently turning a known value into an unknown automation metric.
            ...(netRoi === undefined ? {} : { netRoi }),
            ...(netOrders === undefined ? {} : { netOrders }),
            ...(directNetRevenue === undefined ? {} : { directNetRevenue }),
            ...(directNetRoi === undefined ? {} : { directNetRoi }),
            ...(directNetOrders === undefined ? {} : { directNetOrders }),
            ...(directOrders === undefined ? {} : { directOrders }),
            orders,
            revenue,
            impressions: alimamaCsvNumber(read(row, '展现量')),
            clicks: alimamaCsvNumber(read(row, '点击量')),
            cartAdds: alimamaCsvNumber(read(row, '总购物车数')),
            observedAt: input.observedAt,
            dataStartDate: date,
            dataEndDate: date
        });
    }
    const results = [];
    const cursor = new Date(`${input.startDate}T00:00:00Z`);
    const end = new Date(`${input.endDate}T00:00:00Z`);
    while (cursor <= end) {
        const date = cursor.toISOString().slice(0, 10);
        results.push({
            campaigns: [...(campaignsByDate.get(date)?.values() ?? [])],
            observedAt: input.observedAt,
            startDate: date,
            endDate: date
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return results;
}
function parseAlimamaKeywordRangeCsv(csv, input) {
    return parseAlimamaItemRangeCsv(csv, { ...input, channels: ['keyword'] });
}
function buildAlimamaChannelSummaryRequest(input) {
    const bizCode = input.channel === 'keyword' ? 'onebpSearch' : 'onebpSite';
    return {
        bizCode,
        mx_bizCode: bizCode,
        ...(input.itemSelectedMode ? { itemSelectedMode: input.itemSelectedMode } : {}),
        startTime: input.startDate,
        endTime: input.endDate,
        ...(input.channel === 'keyword' ? {} : {
            effectEqual: '15',
            unifyType: 'last_click_by_effect_time'
        }),
        sourceList: ['scene'],
        queryFieldIn: [...channelSummaryFields],
        splitType: 'sum',
        queryDomains: []
    };
}
function buildAlimamaHistoricalProductReportRequest(input) {
    return {
        bizCode: 'universalBP',
        fromRealTime: false,
        source: 'baseReport',
        byPage: true,
        totalTag: true,
        needCountAccelerate: true,
        byPageWithoutCount: false,
        rptType: 'campaign',
        pageSize: input.pageSize ?? 100,
        offset: input.offset ?? 0,
        havingList: [],
        endTime: input.endDate,
        unifyType: 'zhai',
        effectEqual: 15,
        startTime: input.startDate,
        splitType: 'day',
        from: 'pcBaseReport',
        queryFieldIn: [...historicalProductReportFields],
        queryDomains: ['campaign'],
        ...(input.itemId && /^\d+$/.test(input.itemId)
            ? { itemIdOrName: Number(input.itemId) }
            : {})
    };
}
function findAlimamaSessionContextFromValues(values) {
    let csrfId = '';
    let loginPointId = '';
    const readValue = (text, key) => {
        try {
            const url = new URL(text);
            const value = url.searchParams.get(key);
            if (value)
                return value;
        }
        catch {
            // Storage values are often JSON or query fragments rather than complete URLs.
        }
        const pattern = new RegExp(`(?:^|[?&,{\\s"'])${key}(?:["']|%22)?\\s*(?:=|:|%3A)\\s*(?:["']|%22)?([^"'&}\\s,%]+)`, 'i');
        return pattern.exec(text)?.[1] ?? '';
    };
    for (let index = values.length - 1; index >= 0; index -= 1) {
        const original = String(values[index] ?? '');
        const candidates = [original];
        try {
            const decoded = decodeURIComponent(original);
            if (decoded !== original)
                candidates.push(decoded);
        }
        catch {
            // Ignore malformed percent-encoded values.
        }
        for (const candidate of candidates) {
            csrfId ||= readValue(candidate, 'csrfId');
            loginPointId ||= readValue(candidate, 'loginPointId');
            if (csrfId && loginPointId)
                return { csrfId, loginPointId };
        }
    }
    return null;
}
function findAlimamaSessionContextFromResourceUrls(resourceUrls) {
    return findAlimamaSessionContextFromValues(resourceUrls);
}
async function readAlimamaPageSessionContext(webContents) {
    const values = await webContents.executeJavaScript(`(() => {
    const values = [];
    const append = (value) => {
      if (typeof value !== 'string' || !value || value.length > 12000 || values.length >= 500) return;
      values.push(value);
    };
    const appendStorage = (storage) => {
      try {
        for (let index = 0; index < storage.length && values.length < 200; index += 1) {
          const key = storage.key(index) || '';
          const value = storage.getItem(key) || '';
          if (/csrf|loginpoint/i.test(key + value)) append(key + '=' + value);
        }
      } catch {}
    };
    appendStorage(localStorage);
    appendStorage(sessionStorage);
    append(location.href);
    document.querySelectorAll('script[src]').forEach((script) => append(script.src));
    performance.getEntriesByType('resource').forEach((entry) => append(entry.name));
    return values;
  })()`).catch(() => []);
    return Array.isArray(values)
        ? findAlimamaSessionContextFromValues(values.filter((value) => typeof value === 'string'))
        : null;
}
async function waitForAlimamaPageSessionContext(getPages, options = {}) {
    const maxAttempts = Math.max(1, options.maxAttempts ?? 80);
    const waitBetweenAttempts = options.waitBetweenAttempts ?? (() => new Promise((resolve) => {
        setTimeout(resolve, 250);
    }));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        for (const page of getPages()) {
            const context = await readAlimamaPageSessionContext(page);
            if (context)
                return context;
        }
        if (attempt < maxAttempts - 1)
            await waitBetweenAttempts();
    }
    return null;
}
function applyAlimamaSessionContext(origin, pathname, body, context) {
    const source = body && typeof body === 'object' && !Array.isArray(body)
        ? body
        : {};
    const bizCode = typeof source.bizCode === 'string' && source.bizCode ? source.bizCode : 'onebpSite';
    const url = new URL(pathname, origin);
    url.searchParams.set('csrfId', context.csrfId);
    url.searchParams.set('bizCode', bizCode);
    return {
        url: url.toString(),
        body: {
            ...source,
            csrfId: context.csrfId,
            loginPointId: context.loginPointId
        }
    };
}
class AlimamaPromotionError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
exports.AlimamaPromotionError = AlimamaPromotionError;
function promotionCampaignsHaveActivity(campaigns) {
    return campaigns.some((campaign) => (campaign.spend > 0
        || campaign.revenue > 0
        || (campaign.netRevenue ?? 0) > 0
        || (campaign.directNetRevenue ?? 0) > 0
        || campaign.orders > 0
        || (campaign.netOrders ?? 0) > 0
        || campaign.clicks > 0
        || campaign.impressions > 0
        || (campaign.cartAdds ?? 0) > 0));
}
function isAlimamaLoginUrl(value) {
    try {
        const url = new URL(value);
        return url.origin === 'https://one.alimama.com'
            && (/^#!\/login(?:\/|$)/i.test(url.hash) || /\/login(?:\/|$)/i.test(url.pathname));
    }
    catch {
        return false;
    }
}
function orderAlimamaPageCandidates(candidates) {
    return [...candidates].sort((left, right) => {
        const loginDifference = Number(isAlimamaLoginUrl(left.url)) - Number(isAlimamaLoginUrl(right.url));
        if (loginDifference !== 0)
            return loginDifference;
        if (left.active !== right.active)
            return left.active ? -1 : 1;
        return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    });
}
async function ensureAlimamaProfilePage(input) {
    const existing = orderAlimamaPageCandidates(input.candidates)[0]?.page;
    const created = existing === undefined;
    const page = existing ?? input.createPage();
    await input.waitUntilReady(page);
    return { page, created };
}
function buildAlimamaReportRequest(input) {
    return {
        offset: input.offset ?? 0,
        pageSize: input.pageSize ?? 100,
        orderField: 'charge',
        orderBy: 'desc',
        queryRuleAuto: 1,
        adgroupRequired: input.channel === 'product' || input.storeItemBreakdown === true,
        adzoneRequired: false,
        mx_bizCode: 'onebpSite',
        bizCode: 'onebpSite',
        ...(input.campaignIds?.length ? {
            campaignIdList: [...new Set(input.campaignIds
                    .filter((campaignId) => /^\d+$/.test(campaignId))
                    .map(Number))]
        } : {}),
        ...(input.itemId && /^\d+$/.test(input.itemId) ? { itemId: Number(input.itemId) } : {}),
        ...(input.channel === 'product'
            ? { itemSelectedModeList: ['user_define'] }
            : input.storeSelectedModes !== null ? {
                itemSelectedModeList: input.storeSelectedModes
                    ?? (input.storeItemBreakdown ? ['group'] : ['shop', 'group'])
            } : {}),
        rptQuery: {
            fields: reportFields,
            conditionList: [{
                    sourceList: ['scene', 'campaign_list'],
                    effectEqual: '15',
                    unifyType: 'last_click_by_effect_time',
                    startTime: input.startDate,
                    endTime: input.endDate,
                    isRt: input.startDate === input.endDate
                        && input.startDate === (input.today ?? getShanghaiCalendarDate())
                }]
        }
    };
}
function buildAlimamaKeywordReportRequest(input) {
    return {
        offset: input.offset ?? 0,
        pageSize: input.pageSize ?? 100,
        orderField: 'charge',
        orderBy: 'desc',
        searchDetentTypeList: ['first_place'],
        queryRuleAuto: '1',
        adgroupRequired: false,
        adzoneRequired: false,
        mx_bizCode: 'onebpSearch',
        bizCode: 'onebpSearch',
        ...(input.itemId && /^\d+$/.test(input.itemId) ? { itemId: Number(input.itemId) } : {}),
        rptQuery: {
            fields: keywordReportFields,
            conditionList: [{
                    sourceList: ['scene', 'campaign_list'],
                    adzonePkgIdList: ['114790550288', '114786650498'],
                    startTime: input.startDate,
                    endTime: input.endDate,
                    isRt: input.startDate === input.endDate
                        && input.startDate === (input.today ?? getShanghaiCalendarDate())
                }]
        }
    };
}
function buildAlimamaKeywordItemReportRequest(input) {
    return {
        offset: input.offset ?? 0,
        pageSize: input.pageSize ?? 500,
        orderField: '',
        orderBy: '',
        mx_bizCode: 'onebpSearch',
        bizCode: 'onebpSearch',
        rptQuery: {
            fields: keywordReportFields,
            conditionList: [{
                    sourceList: ['scene', 'adgroup_list'],
                    adzonePkgIdList: ['114790550288', '114786650498'],
                    startTime: input.startDate,
                    endTime: input.endDate,
                    isRt: input.startDate === input.endDate
                        && input.startDate === (input.today ?? getShanghaiCalendarDate())
                }]
        },
        requestSource: 'adgroupHorizontal',
        ...(input.itemId && /^\d+$/.test(input.itemId) ? { itemId: Number(input.itemId) } : {}),
        ...(input.campaignIds?.length ? {
            campaignIdList: input.campaignIds.map((campaignId) => Number(campaignId))
        } : {})
    };
}
function buildAlimamaStoreItemRequest(input) {
    return {
        offset: input.offset ?? 0,
        pageSize: input.pageSize ?? 40,
        orderField: '',
        orderBy: '',
        mx_bizCode: 'onebpSite',
        bizCode: 'onebpSite',
        itemSelectedMode: input.itemSelectedMode,
        rptQuery: {
            fields: storeItemReportFields,
            conditionList: [{
                    sourceList: ['campaign_detail', 'item_list'],
                    adzonePkgIdList: [],
                    effectEqual: '15',
                    unifyType: 'last_click_by_effect_time',
                    startTime: input.startDate,
                    endTime: input.endDate,
                    isRt: input.startDate === input.endDate
                        && input.startDate === (input.today ?? getShanghaiCalendarDate())
                }]
        },
        campaignIdList: input.campaignIds
    };
}
function buildAlimamaStoreAdgroupRequest(input) {
    const request = buildAlimamaStoreItemRequest(input);
    return {
        ...request,
        campaignIdList: input.campaignIds.map((campaignId) => Number(campaignId)),
        rptQuery: {
            ...request.rptQuery,
            conditionList: request.rptQuery.conditionList.map((condition) => ({
                ...condition,
                sourceList: ['campaign_detail', 'adgroup_list']
            }))
        }
    };
}
function getShanghaiCalendarDate(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);
}
function buildAlimamaCampaignStatusRequest(campaignId, status) {
    const numericCampaignId = Number(campaignId);
    if (!Number.isSafeInteger(numericCampaignId) || numericCampaignId <= 0) {
        throw new Error('Invalid Alimama campaign id');
    }
    return {
        bizCode: 'onebpSite',
        campaignList: [{
                campaignId: numericCampaignId,
                displayStatus: status === 'active' ? 'start' : 'pause'
            }]
    };
}
function buildAlimamaCampaignStatusMutation(campaignId, status, platformUnitId) {
    if (!platformUnitId) {
        return {
            pathname: '/campaign/updatePart.json',
            body: buildAlimamaCampaignStatusRequest(campaignId, status)
        };
    }
    const numericCampaignId = Number(campaignId);
    const numericUnitId = Number(platformUnitId);
    if (!Number.isSafeInteger(numericCampaignId)
        || numericCampaignId <= 0
        || !Number.isSafeInteger(numericUnitId)
        || numericUnitId <= 0) {
        throw new Error('Invalid Alimama item target id');
    }
    return {
        pathname: '/adgroup/updatePart.json',
        body: {
            bizCode: 'onebpSite',
            campaignId: numericCampaignId,
            adgroupList: [{
                    adgroupId: numericUnitId,
                    displayStatus: status === 'active' ? 'start' : 'pause'
                }]
        }
    };
}
function parseAlimamaCampaignResponse(value, context) {
    const campaignRecords = findCampaignRecords(value);
    // Current OneBP responses can wrap both full-site product and full-store item
    // rows in `adgroupList[].material`.  Always expand item-level responses;
    // otherwise product rows without a top-level itemId are silently discarded.
    const shouldExpandItemRecords = context.entityLevel === 'store-item'
        || context.entityLevel === 'item';
    const records = shouldExpandItemRecords
        ? campaignRecords.flatMap(expandAlimamaStoreItemRecords)
        : campaignRecords;
    const byId = new Map();
    for (const record of records) {
        const campaignId = textValue(pickValue(record, ['campaignId', 'campaign_id', 'id']));
        if (!/^\d+$/.test(campaignId))
            continue;
        const platformUnitId = optionalText(pickValue(record, [
            'adgroupId', 'adgroup_id', 'unitId', 'unit_id'
        ]));
        const itemId = optionalText(pickValue(record, ['itemId', 'materialId', 'item_id']));
        const isItem = context.entityLevel === 'store-item' || context.entityLevel === 'item';
        if (isItem && !itemId)
            continue;
        if (context.entityLevel === 'store-item' && !platformUnitId)
            continue;
        const id = context.entityLevel === 'item'
            ? itemId
            : context.entityLevel === 'store-item' ? platformUnitId : campaignId;
        const recordIdentity = context.entityLevel === 'item'
            ? `${campaignId}:${itemId}`
            : id;
        const selectedMode = textValue(pickValue(record, ['itemSelectedMode', 'item_selected_mode']));
        if (selectedMode
            && context.selectedModes?.length
            && !context.selectedModes.includes(selectedMode))
            continue;
        const channel = context.channel
            ?? (context.entityLevel === 'store-item'
                ? 'store'
                : ['shop', 'group'].includes(selectedMode) ? 'store' : 'product');
        const planStatus = normalizeAlimamaStatus(resolveAlimamaPlanStatus(record));
        const unitStatus = isItem && platformUnitId
            ? normalizeAlimamaStatus(resolveAlimamaUnitStatus(record, platformUnitId))
            : 'unknown';
        const status = isItem && channel === 'store' && unitStatus !== 'unknown'
            ? unitStatus
            : planStatus !== 'unknown' ? planStatus : unitStatus;
        const platformTargetStatus = channel === 'product'
            ? planStatus
            : unitStatus !== 'unknown' ? unitStatus : status;
        const campaignName = textValue(pickValue(record, ['campaignName', 'planName', 'name']))
            || `计划 ${campaignId}`;
        const platformGroupId = optionalText(pickValue(record, [
            'campaignGroupId', 'groupId', 'campaign_group_id', 'itemSelectedGroupId', 'selectedGroupId'
        ]));
        const itemImageUrl = normalizeRemoteImageUrl(pickValue(record, [
            'itemImg', 'itemImageUrl', 'itemPic', 'picUrl', 'imageUrl', 'imgUrl'
        ]));
        const platformGroupName = textValue(pickValue(record, [
            'campaignGroupName', 'groupName', 'campaign_group_name', 'itemSelectedGroupName', 'selectedGroupName'
        ])) || '未分组';
        const groupId = channel === 'keyword'
            ? isItem ? campaignId : 'keyword-plans'
            : platformGroupId;
        const groupName = channel === 'keyword'
            ? isItem ? campaignName : '关键词计划'
            : platformGroupName;
        const spend = numberValue(pickValue(record, ['charge', 'cost', 'spend']));
        const netRevenue = optionalMetricNumber(pickValue(record, [
            'retainedAlipayInshopAmt', 'netRevenue'
        ]));
        const netRoi = optionalMetricNumber(pickValue(record, ['retainedRoi', 'netRoi']))
            ?? (spend > 0 && netRevenue !== undefined ? netRevenue / spend : undefined);
        const netOrders = optionalMetricNumber(pickValue(record, [
            'retainedAlipayInshopNum', 'netOrders'
        ]));
        const directNetRevenue = optionalMetricNumber(pickValue(record, [
            'alipayDirAmtNet', 'directNetRevenue'
        ]));
        const directNetRoi = optionalMetricNumber(pickValue(record, ['dirNetRoi', 'directNetRoi']))
            ?? (spend > 0 && directNetRevenue !== undefined ? directNetRevenue / spend : undefined);
        const directNetOrders = optionalMetricNumber(pickValue(record, [
            'alipayDirNumNet', 'directNetOrders'
        ]));
        const directOrders = optionalMetricNumber(pickValue(record, ['alipayDirNum', 'directOrders']));
        const campaign = {
            id,
            ...(isItem ? {
                parentCampaignId: campaignId,
                ...(platformUnitId ? {
                    platformUnitId,
                    platformTargets: [{ campaignId, unitId: platformUnitId, status: platformTargetStatus }]
                } : channel === 'store' && selectedMode === 'shop' ? {
                    platformTargets: [{ campaignId, status: planStatus }]
                } : {}),
                sourceCampaignIds: [campaignId],
                targetLevel: 'item'
            } : { targetLevel: 'campaign' }),
            name: campaignName,
            itemId,
            itemName: textValue(pickValue(record, ['itemTitle', 'itemName', 'materialName', 'title'])),
            ...(itemImageUrl ? { itemImageUrl } : {}),
            channel,
            groupId,
            groupName,
            ...(isItem && groupId ? { groupIds: [groupId], groupNames: [groupName] } : {}),
            status,
            dailyBudget: optionalNumber(pickValue(record, ['dayBudget', 'dailyBudget', 'budget'])),
            bidStrategy: normalizeBidStrategy(pickValue(record, [
                'bidTargetV2Chinese', 'bidUnit', 'bidStrategyName', 'bidTypeV2Chinese', 'bidTypeName', 'bidType'
            ])),
            targetRoi: optionalNumber(pickValue(record, [
                'targetRoi', 'targetROI', 'goalRoi', 'targetValue', 'constraintValue'
            ]))
                ?? findNestedNumber(pickValue(record, ['bidTargetV2', 'bidTarget'])),
            spend,
            roi: numberValue(pickValue(record, ['roi', 'actualRoi'])),
            ...(netRoi === undefined ? {} : { netRoi }),
            orders: numberValue(pickValue(record, ['alipayInshopNum', 'orders', 'orderCount'])),
            ...(netOrders === undefined ? {} : { netOrders }),
            ...(directNetRoi === undefined ? {} : { directNetRoi }),
            ...(directNetRevenue === undefined ? {} : { directNetRevenue }),
            ...(directNetOrders === undefined ? {} : { directNetOrders }),
            ...(directOrders === undefined ? {} : { directOrders }),
            revenue: numberValue(pickValue(record, ['alipayInshopAmt', 'retainedAlipayInshopAmt', 'revenue'])),
            ...(netRevenue === undefined ? {} : { netRevenue }),
            impressions: numberValue(pickValue(record, ['adPv', 'impressions', 'pv'])),
            clicks: numberValue(pickValue(record, ['click', 'clicks'])),
            cartAdds: numberValue(pickValue(record, ['cartInshopNum', 'cartAdds'])),
            observedAt: context.observedAt,
            dataStartDate: context.startDate,
            dataEndDate: context.endDate
        };
        if (channel === 'store' && (selectedMode === 'shop' || selectedMode === 'group')) {
            campaign.alimamaItemSelectedMode = selectedMode;
        }
        const previous = byId.get(recordIdentity);
        byId.set(recordIdentity, context.entityLevel === 'item' && previous
            ? channel === 'product'
                ? mergeOrDeduplicateAlimamaItemCampaigns(previous, campaign)
                : mergeAlimamaItemCampaigns(previous, campaign)
            : campaign);
    }
    return [...byId.values()];
}
function expandAlimamaStoreItemRecords(campaignRecord) {
    // OneBP currently repeats the same adgroup under both `adgroupList` and
    // `lastAdgroup`. Treating those as two products makes the parser believe a
    // plan has multiple items, so it refuses to inherit the plan-level report
    // metrics and writes zero spend/ROI for the real item. De-duplicate by the
    // platform adgroup + material identity before deciding whether the enclosing
    // report row is safe to assign to a single item.
    const unitRecords = [...new Map(findAlimamaItemUnitRecords(campaignRecord).map((record) => {
            const unitId = textValue(readDirectValue(record, [
                'adgroupId', 'adgroup_id', 'unitId', 'unit_id'
            ]));
            const itemId = textValue(pickValue(record, ['itemId', 'materialId', 'item_id']));
            return [`${unitId}:${itemId}`, record];
        })).values()];
    if (unitRecords.length === 0)
        return [campaignRecord];
    if (unitRecords.length === 1 && unitRecords[0] === campaignRecord)
        return [campaignRecord];
    const campaignId = textValue(readDirectValue(campaignRecord, [
        'campaignId', 'campaign_id', 'id'
    ])) || textValue(pickValue(campaignRecord, [
        'campaignId', 'campaign_id', 'id'
    ]));
    const campaignName = textValue(readDirectValue(campaignRecord, [
        'campaignName', 'planName', 'name'
    ]));
    const itemSelectedMode = textValue(readDirectValue(campaignRecord, [
        'itemSelectedMode', 'item_selected_mode'
    ]));
    return unitRecords.map((unitRecord) => {
        const platformUnitId = textValue(readDirectValue(unitRecord, [
            'adgroupId', 'adgroup_id', 'unitId', 'unit_id'
        ]));
        const itemId = textValue(pickValue(unitRecord, ['itemId', 'materialId', 'item_id']));
        const expanded = {
            ...campaignRecord,
            adgroupList: [unitRecord],
            ...unitRecord,
            campaignId,
            campaignName,
            itemSelectedMode,
            __campaignDisplayStatus: resolveAlimamaPlanStatus(campaignRecord),
            adgroupId: platformUnitId,
            itemId
        };
        for (const [targetKey, aliases] of alimamaItemMetricAliases) {
            expanded[targetKey] = pickValue(unitRecord, aliases)
                ?? (unitRecords.length === 1 ? pickValue(campaignRecord, aliases) : undefined)
                ?? 0;
        }
        return expanded;
    });
}
function findAlimamaItemUnitRecords(value, depth = 0) {
    if (depth > 8 || value === null || value === undefined)
        return [];
    if (Array.isArray(value)) {
        return value.flatMap((item) => findAlimamaItemUnitRecords(item, depth + 1));
    }
    if (!isRecord(value))
        return [];
    const platformUnitId = textValue(readDirectValue(value, [
        'adgroupId', 'adgroup_id', 'unitId', 'unit_id'
    ]));
    const itemId = textValue(pickValue(value, ['itemId', 'materialId', 'item_id']));
    if (platformUnitId && itemId)
        return [value];
    return Object.values(value).flatMap((nested) => (findAlimamaItemUnitRecords(nested, depth + 1)));
}
function mergeAlimamaItemCampaignList(campaigns) {
    const byIdentity = new Map();
    for (const campaign of campaigns) {
        const planId = campaign.parentCampaignId
            ?? campaign.sourceCampaignIds?.[0]
            ?? campaign.platformTargets?.[0]?.campaignId
            ?? campaign.id;
        const key = `${campaign.channel}:${planId}:${campaign.itemId || campaign.id}`;
        const previous = byIdentity.get(key);
        byIdentity.set(key, previous
            ? campaign.channel === 'product'
                ? mergeOrDeduplicateAlimamaItemCampaigns(previous, campaign)
                : mergeAlimamaItemCampaigns(previous, campaign)
            : campaign);
    }
    return [...byIdentity.values()];
}
function campaignTargetUnitIds(campaign) {
    const ids = (campaign.platformTargets ?? [])
        .map((target) => target.unitId)
        .filter((unitId) => Boolean(unitId));
    if (campaign.platformUnitId)
        ids.push(campaign.platformUnitId);
    return [...new Set(ids)];
}
function mergeOrDeduplicateAlimamaItemCampaigns(left, right) {
    const leftUnits = campaignTargetUnitIds(left);
    const rightUnits = campaignTargetUnitIds(right);
    const samePlatformTarget = leftUnits.length === 0
        || rightUnits.length === 0
        || leftUnits.some((unitId) => rightUnits.includes(unitId));
    if (!samePlatformTarget)
        return mergeAlimamaItemCampaigns(left, right);
    const planId = right.parentCampaignId
        ?? right.sourceCampaignIds?.[0]
        ?? right.platformTargets?.[0]?.campaignId
        ?? right.id;
    assertSameAlimamaItemMetrics(left, right, `${right.channel}:${planId}:${right.itemId ?? right.id}`);
    const mergedMetadata = mergeAlimamaItemCampaigns(left, right);
    return {
        ...mergedMetadata,
        spend: right.spend,
        revenue: right.revenue,
        roi: right.roi,
        netRevenue: right.netRevenue,
        netRoi: right.netRoi,
        directNetRevenue: right.directNetRevenue,
        directNetRoi: right.directNetRoi,
        orders: right.orders,
        netOrders: right.netOrders,
        directNetOrders: right.directNetOrders,
        directOrders: right.directOrders,
        impressions: right.impressions,
        clicks: right.clicks,
        cartAdds: right.cartAdds
    };
}
function mergeAlimamaItemCampaigns(left, right) {
    const spend = left.spend + right.spend;
    const revenue = left.revenue + right.revenue;
    const netRevenue = left.netRevenue === undefined || right.netRevenue === undefined
        ? undefined
        : left.netRevenue + right.netRevenue;
    const directNetRevenue = left.directNetRevenue === undefined || right.directNetRevenue === undefined
        ? undefined
        : left.directNetRevenue + right.directNetRevenue;
    const platformTargets = [...new Map([
            ...(left.platformTargets ?? []),
            ...(right.platformTargets ?? [])
        ].map((target) => [`${target.campaignId}:${target.unitId ?? ''}`, target])).values()];
    const sourceCampaignIds = [...new Set([
            ...(left.sourceCampaignIds ?? []),
            ...(right.sourceCampaignIds ?? [])
        ])];
    const groupIds = [...new Set([
            ...(left.groupIds ?? (left.groupId ? [left.groupId] : [])),
            ...(right.groupIds ?? (right.groupId ? [right.groupId] : []))
        ])];
    const groupNames = [...new Set([
            ...(left.groupNames ?? (left.groupName ? [left.groupName] : [])),
            ...(right.groupNames ?? (right.groupName ? [right.groupName] : []))
        ])];
    return {
        ...right,
        id: right.id,
        parentCampaignId: sourceCampaignIds[0] ?? right.parentCampaignId,
        platformUnitId: platformTargets[0]?.unitId ?? right.platformUnitId,
        platformTargets,
        sourceCampaignIds,
        groupId: groupIds[0] ?? null,
        groupName: groupNames[0] ?? '未分组',
        groupIds,
        groupNames,
        status: left.status === 'active' || right.status === 'active'
            ? 'active'
            : left.status === 'paused' || right.status === 'paused' ? 'paused' : 'unknown',
        spend,
        revenue,
        roi: spend > 0 ? revenue / spend : 0,
        ...(netRevenue === undefined ? {} : {
            netRevenue,
            netRoi: spend > 0 ? netRevenue / spend : 0
        }),
        ...(directNetRevenue === undefined ? {} : {
            directNetRevenue,
            directNetRoi: spend > 0 ? directNetRevenue / spend : 0
        }),
        orders: left.orders + right.orders,
        ...(left.netOrders === undefined || right.netOrders === undefined
            ? {} : { netOrders: left.netOrders + right.netOrders }),
        ...(left.directNetOrders === undefined || right.directNetOrders === undefined
            ? {} : { directNetOrders: left.directNetOrders + right.directNetOrders }),
        ...(left.directOrders === undefined || right.directOrders === undefined
            ? {} : { directOrders: left.directOrders + right.directOrders }),
        impressions: left.impressions + right.impressions,
        clicks: left.clicks + right.clicks,
        cartAdds: (left.cartAdds ?? 0) + (right.cartAdds ?? 0)
    };
}
async function fetchAlimamaChannelSummaryCampaigns(webContents, input, observedAt, requestedChannels, sessionContext) {
    const fetchSummary = async (channel, itemSelectedMode) => {
        const response = await executeAlimamaJsonRequest(webContents, '/report/query.json', buildAlimamaChannelSummaryRequest({
            channel,
            startDate: input.startDate,
            endDate: input.endDate,
            ...(itemSelectedMode ? { itemSelectedMode } : {})
        }), sessionContext);
        const record = findAlimamaChannelSummaryRecord(response);
        return record
            ? createAlimamaChannelSummaryCampaign(record, channel, input, observedAt)
            : null;
    };
    const tasks = [];
    if (requestedChannels.has('product'))
        tasks.push(fetchSummary('product', 'user_define'));
    if (requestedChannels.has('store')) {
        tasks.push(Promise.all([
            fetchSummary('store', 'shop'),
            fetchSummary('store', 'group')
        ]).then(([shop, group]) => {
            if (!shop)
                return group;
            if (!group)
                return shop;
            return mergeAlimamaItemCampaigns(shop, group);
        }));
    }
    if (requestedChannels.has('keyword'))
        tasks.push(fetchSummary('keyword'));
    return (await Promise.all(tasks)).filter((campaign) => Boolean(campaign));
}
function findAlimamaChannelSummaryRecord(value) {
    if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.list))
        return null;
    const record = value.data.list[0];
    if (!isRecord(record))
        return null;
    if ('campaignId' in record || 'campaign_id' in record)
        return null;
    if (!('memberId' in record) && !('special_campaign_filter' in record))
        return null;
    return record;
}
function createAlimamaChannelSummaryCampaign(record, channel, input, observedAt) {
    const spend = numberValue(pickValue(record, ['charge', 'cost', 'spend']));
    const revenue = numberValue(pickValue(record, ['alipayInshopAmt', 'revenue']));
    const netRevenue = numberValue(pickValue(record, ['retainedAlipayInshopAmt', 'netRevenue']));
    const directNetRevenue = numberValue(pickValue(record, ['alipayDirAmtNet', 'directNetRevenue']));
    return {
        id: `summary:alimama-exact:${channel}`,
        targetLevel: 'campaign',
        name: '天猫渠道汇总',
        itemId: null,
        itemName: '天猫渠道汇总',
        channel,
        groupId: null,
        groupName: '',
        status: 'unknown',
        dailyBudget: null,
        targetRoi: null,
        spend,
        roi: spend > 0 ? revenue / spend : 0,
        netRoi: spend > 0 ? netRevenue / spend : 0,
        orders: numberValue(pickValue(record, ['alipayInshopNum', 'orders'])),
        netOrders: numberValue(pickValue(record, ['retainedAlipayInshopNum', 'netOrders'])),
        directNetRoi: spend > 0 ? directNetRevenue / spend : 0,
        directNetRevenue,
        directNetOrders: numberValue(pickValue(record, ['alipayDirNumNet', 'directNetOrders'])),
        directOrders: numberValue(pickValue(record, ['alipayDirNum', 'directOrders'])),
        revenue,
        netRevenue,
        impressions: numberValue(pickValue(record, ['adPv', 'impressions'])),
        clicks: numberValue(pickValue(record, ['click', 'clicks'])),
        cartAdds: numberValue(pickValue(record, ['cartInshopNum', 'cartAdds'])),
        observedAt,
        dataStartDate: input.startDate,
        dataEndDate: input.endDate
    };
}
function reconcileAlimamaChannelDetails(exact, details) {
    const reconciled = details.map((campaign) => ({ ...campaign }));
    const integerKeys = new Set([
        'orders', 'netOrders', 'directNetOrders', 'directOrders', 'impressions', 'clicks', 'cartAdds'
    ]);
    const metricKeys = [
        'spend', 'revenue', 'netRevenue', 'directNetRevenue',
        'orders', 'netOrders', 'directNetOrders', 'directOrders',
        'impressions', 'clicks', 'cartAdds'
    ];
    for (const key of metricKeys) {
        const exactValue = typeof exact[key] === 'number' ? exact[key] : 0;
        const values = reconciled.map((campaign) => (typeof campaign[key] === 'number' && Number.isFinite(campaign[key]) ? campaign[key] : 0));
        const total = values.reduce((sum, value) => sum + value, 0);
        if (total <= exactValue + 1e-7 || total <= 0)
            continue;
        if (integerKeys.has(key)) {
            const target = Math.max(0, Math.round(exactValue));
            const scaled = values.map((value, index) => {
                const raw = value * target / total;
                return { index, value: Math.floor(raw), remainder: raw - Math.floor(raw) };
            });
            let remaining = target - scaled.reduce((sum, item) => sum + item.value, 0);
            for (const item of [...scaled].sort((left, right) => right.remainder - left.remainder)) {
                if (remaining <= 0)
                    break;
                item.value += 1;
                remaining -= 1;
            }
            for (const item of scaled) {
                reconciled[item.index][key] = item.value;
            }
        }
        else {
            const ratio = Math.max(0, exactValue / total);
            for (let index = 0; index < reconciled.length; index += 1) {
                reconciled[index][key] = values[index] * ratio;
            }
        }
    }
    for (const campaign of reconciled) {
        campaign.roi = campaign.spend > 0 ? campaign.revenue / campaign.spend : 0;
        campaign.netRoi = campaign.spend > 0 ? (campaign.netRevenue ?? 0) / campaign.spend : 0;
        campaign.directNetRoi = campaign.spend > 0
            ? (campaign.directNetRevenue ?? 0) / campaign.spend
            : 0;
    }
    return { details: reconciled };
}
function buildAlimamaChannelSummaryCorrection(exact, details) {
    const sum = (key) => details.reduce((total, campaign) => {
        const value = campaign[key];
        return total + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    }, 0);
    const delta = (exactValue, detailValue) => Math.max(0, exactValue - detailValue);
    const spend = delta(exact.spend, sum('spend'));
    const revenue = delta(exact.revenue, sum('revenue'));
    const netRevenue = delta(exact.netRevenue ?? 0, sum('netRevenue'));
    const directNetRevenue = delta(exact.directNetRevenue ?? 0, sum('directNetRevenue'));
    return {
        ...exact,
        id: `summary:alimama-correction:${exact.channel}`,
        name: '天猫渠道汇总校准',
        itemName: '天猫渠道汇总校准',
        spend,
        revenue,
        roi: spend !== 0 ? revenue / spend : 0,
        netRevenue,
        netRoi: spend !== 0 ? netRevenue / spend : 0,
        directNetRevenue,
        directNetRoi: spend !== 0 ? directNetRevenue / spend : 0,
        orders: delta(exact.orders, sum('orders')),
        netOrders: delta(exact.netOrders ?? 0, sum('netOrders')),
        directNetOrders: delta(exact.directNetOrders ?? 0, sum('directNetOrders')),
        directOrders: delta(exact.directOrders ?? 0, sum('directOrders')),
        impressions: delta(exact.impressions, sum('impressions')),
        clicks: delta(exact.clicks, sum('clicks')),
        cartAdds: delta(exact.cartAdds ?? 0, sum('cartAdds'))
    };
}
function getCachedAlimamaStaticInventory(webContents, key, load) {
    const cache = alimamaStaticInventoryCache.get(webContents) ?? new Map();
    alimamaStaticInventoryCache.set(webContents, cache);
    const now = Date.now();
    const existing = cache.get(key);
    if (existing && existing.expiresAt > now)
        return existing.value;
    let value;
    value = load().catch((error) => {
        if (cache.get(key)?.value === value)
            cache.delete(key);
        throw error;
    });
    cache.set(key, { expiresAt: now + ALIMAMA_STATIC_INVENTORY_TTL_MS, value });
    return value;
}
function toAlimamaStaticCampaign(campaign) {
    return {
        ...campaign,
        spend: 0,
        roi: 0,
        netRoi: 0,
        orders: 0,
        netOrders: 0,
        directNetRoi: 0,
        directNetRevenue: 0,
        directNetOrders: 0,
        directOrders: 0,
        revenue: 0,
        netRevenue: 0,
        impressions: 0,
        clicks: 0,
        cartAdds: 0
    };
}
function readAlimamaKeywordExportTaskId(value) {
    if (!isRecord(value) || !isRecord(value.data))
        return '';
    return textValue(value.data.taskId);
}
function readAlimamaKeywordExportDownloadUrl(value) {
    if (!isRecord(value) || !isRecord(value.data))
        return '';
    const result = isRecord(value.data.result) ? value.data.result : value.data;
    return textValue(result.downloadUrl);
}
async function waitForAlimamaExportDownloadUrl(webContents, taskId, reportName, sessionContext) {
    let lastError;
    for (let attempt = 0; attempt < ALIMAMA_ASYNC_REPORT_POLL_ATTEMPTS; attempt += 1) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, ALIMAMA_ASYNC_REPORT_POLL_INTERVAL_MS));
        }
        try {
            const response = await executeAlimamaJsonRequest(webContents, 'https://bpcommon.alimama.com/commonapi/report/async/getDownloadUrl.json', { taskId, bizCode: 'universalBP' }, sessionContext, { method: 'GET' });
            const downloadUrl = readAlimamaKeywordExportDownloadUrl(response);
            if (downloadUrl)
                return downloadUrl;
        }
        catch (error) {
            if (error instanceof AlimamaPromotionError && error.code === 'needs-login')
                throw error;
            lastError = error;
        }
    }
    throw new AlimamaPromotionError(lastError instanceof Error
        ? `${reportName}分日报表生成超时：${lastError.message}`
        : `${reportName}分日报表生成超时，请稍后重试`, 'request-failed');
}
async function deleteAlimamaKeywordExportTask(webContents, taskId, sessionContext) {
    await executeAlimamaJsonRequest(webContents, 'https://bpcommon.alimama.com/commonapi/report/async/deleteTask.json', { taskId, bizCode: 'universalBP' }, sessionContext, { method: 'GET' });
}
/**
 * Uses Alimama's own asynchronous report engine to fetch every historical
 * keyword-product fact in one range request. This deliberately excludes today:
 * the real-time endpoint remains authoritative until the day is finalized.
 */
async function syncAlimamaItemRange(webContents, input, sessionContext) {
    assertAlimamaPage(webContents);
    const observedAt = input.observedAt ?? new Date().toISOString();
    const reportName = input.channels.includes('product')
        ? '全站商品推广'
        : '关键词推广';
    let taskId = '';
    try {
        const created = await executeAlimamaJsonRequest(webContents, '/report/createDownLoadTask.json', buildAlimamaItemRangeExportRequest(input), sessionContext);
        taskId = readAlimamaKeywordExportTaskId(created);
        if (!taskId) {
            throw new AlimamaPromotionError('天猫没有返回商品维度推广报表任务编号', 'invalid-response');
        }
        const downloadUrl = await waitForAlimamaExportDownloadUrl(webContents, taskId, reportName, sessionContext);
        let parsedDownloadUrl;
        try {
            parsedDownloadUrl = new URL(downloadUrl);
        }
        catch {
            throw new AlimamaPromotionError('商品维度推广报表下载地址无效', 'invalid-response');
        }
        if (parsedDownloadUrl.protocol !== 'https:') {
            throw new AlimamaPromotionError('商品维度推广报表下载地址不安全', 'invalid-response');
        }
        const response = await fetch(parsedDownloadUrl);
        if (!response.ok) {
            throw new AlimamaPromotionError(`商品维度推广报表下载失败（HTTP ${response.status}）`, 'request-failed');
        }
        const archive = (0, fflate_1.unzipSync)(new Uint8Array(await response.arrayBuffer()));
        const csv = Object.entries(archive).find(([name]) => name.toLowerCase().endsWith('.csv'))?.[1];
        if (!csv) {
            throw new AlimamaPromotionError('商品维度推广导出压缩包中没有 CSV 报表', 'invalid-response');
        }
        return parseAlimamaItemRangeCsv(new TextDecoder('gb18030').decode(csv), {
            startDate: input.startDate,
            endDate: input.endDate,
            observedAt,
            channels: input.channels
        });
    }
    finally {
        if (taskId) {
            await deleteAlimamaKeywordExportTask(webContents, taskId, sessionContext).catch(() => undefined);
        }
    }
}
async function syncAlimamaKeywordRange(webContents, input, sessionContext) {
    return syncAlimamaItemRange(webContents, { ...input, channels: ['keyword'] }, sessionContext);
}
function splitAlimamaAsyncReportDateRange(startDate, endDate, maxDays = ALIMAMA_ASYNC_REPORT_MAX_DAYS) {
    if (!Number.isInteger(maxDays) || maxDays < 1) {
        throw new Error('报表分段天数必须是正整数');
    }
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) {
        throw new Error('报表日期范围无效');
    }
    const ranges = [];
    while (cursor <= end) {
        const rangeStart = new Date(cursor);
        const rangeEnd = new Date(cursor);
        rangeEnd.setUTCDate(rangeEnd.getUTCDate() + maxDays - 1);
        if (rangeEnd > end)
            rangeEnd.setTime(end.getTime());
        ranges.push({
            startDate: rangeStart.toISOString().slice(0, 10),
            endDate: rangeEnd.toISOString().slice(0, 10)
        });
        cursor.setTime(rangeEnd.getTime());
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return ranges;
}
async function syncAlimamaProductRange(webContents, input, sessionContext) {
    assertAlimamaPage(webContents);
    const observedAt = input.observedAt ?? new Date().toISOString();
    // The plan report retains deleted plans and also contains full-store group
    // plans under the same scene id. Intersect every historical row with the
    // current user-defined campaign + item inventory before it may enter rules.
    const inventory = await fetchReliableAlimamaProductInventory(webContents, { ...input, channels: ['product'] }, observedAt, sessionContext);
    const inventoryByIdentity = new Map(inventory.flatMap((campaign) => {
        const campaignId = campaign.parentCampaignId ?? campaign.id;
        return /^\d+$/.test(campaignId) && campaign.itemId
            ? [[`${campaignId}:${campaign.itemId}`, campaign]]
            : [];
    }));
    const inventoryByPlan = new Map();
    for (const campaign of inventory) {
        const campaignId = campaign.parentCampaignId ?? campaign.id;
        if (!/^\d+$/.test(campaignId) || !campaign.itemId)
            continue;
        const planCampaigns = inventoryByPlan.get(campaignId) ?? [];
        if (!planCampaigns.some((candidate) => candidate.itemId === campaign.itemId)) {
            planCampaigns.push(campaign);
        }
        inventoryByPlan.set(campaignId, planCampaigns);
    }
    // The official asynchronous campaign report is the only OneBP export that
    // carries date + campaign ID + item ID together for every historical fact.
    // Prefer it for real WebContents. The legacy online parser remains below as
    // a compatibility fallback for unit-test doubles and older hosted contracts.
    if (typeof webContents.isDestroyed === 'function') {
        const reported = [];
        // A single 30-day campaign-by-item export regularly exceeds OneBP's short
        // async-task window for large stores. Sequential seven-day tasks avoid
        // throttling, retain exact plan+item+date identity and never substitute a
        // campaign total for an individual product.
        for (const range of splitAlimamaAsyncReportDateRange(input.startDate, input.endDate)) {
            reported.push(...await syncAlimamaItemRange(webContents, {
                ...range,
                observedAt: input.observedAt,
                channels: ['product'],
                reportLevel: 'campaign'
            }, sessionContext));
        }
        return Promise.all(reported.map(async (result) => {
            const matchedRows = mergeAlimamaItemCampaignList(result.campaigns.flatMap((campaign) => {
                const campaignId = campaign.parentCampaignId ?? campaign.id;
                const inventoryCampaign = campaign.itemId
                    ? inventoryByIdentity.get(`${campaignId}:${campaign.itemId}`)
                    : undefined;
                if (!inventoryCampaign)
                    return [];
                return [{
                        ...campaign,
                        name: inventoryCampaign.name,
                        itemName: inventoryCampaign.itemName,
                        itemImageUrl: inventoryCampaign.itemImageUrl,
                        status: inventoryCampaign.status,
                        dailyBudget: inventoryCampaign.dailyBudget,
                        targetRoi: inventoryCampaign.targetRoi,
                        groupId: inventoryCampaign.groupId,
                        groupName: inventoryCampaign.groupName,
                        groupIds: inventoryCampaign.groupIds,
                        groupNames: inventoryCampaign.groupNames,
                        platformUnitId: inventoryCampaign.platformUnitId,
                        platformTargets: inventoryCampaign.platformTargets
                    }];
            }));
            const matchedIdentities = new Set(matchedRows.flatMap((campaign) => {
                const campaignId = campaign.parentCampaignId ?? campaign.id;
                return campaign.itemId ? [`${campaignId}:${campaign.itemId}`] : [];
            }));
            if (!promotionCampaignsHaveActivity(matchedRows)) {
                if (promotionCampaignsHaveActivity(result.campaigns)) {
                    throw new AlimamaPromotionError(`天猫全站商品 ${result.startDate} 报表有消耗，但报表计划 ID/商品 ID 与当前计划清单无法匹配；本次数据已拒绝写入，请重试同步`, 'invalid-response');
                }
                const exactSummary = (await fetchAlimamaChannelSummaryCampaigns(webContents, {
                    startDate: result.startDate,
                    endDate: result.endDate,
                    channels: ['product'],
                    observedAt
                }, observedAt, new Set(['product']), sessionContext)).filter((campaign) => campaign.channel === 'product');
                if (promotionCampaignsHaveActivity(exactSummary)) {
                    throw new AlimamaPromotionError(`天猫全站商品 ${result.startDate} 渠道汇总已有消耗，但商品明细报表尚未就绪；本次全零结果已拒绝写入，请稍后重试同步`, 'invalid-response');
                }
            }
            const zeroRows = input.includeInventoryZeroRows === false
                ? []
                : [...inventoryByIdentity.entries()].flatMap(([identity, campaign]) => (matchedIdentities.has(identity) ? [] : [{
                        ...campaign,
                        spend: 0,
                        roi: 0,
                        netRoi: 0,
                        orders: 0,
                        netOrders: 0,
                        directNetRoi: 0,
                        directNetRevenue: 0,
                        directNetOrders: 0,
                        directOrders: 0,
                        revenue: 0,
                        netRevenue: 0,
                        impressions: 0,
                        clicks: 0,
                        cartAdds: 0,
                        observedAt,
                        dataStartDate: result.startDate,
                        dataEndDate: result.endDate
                    }]));
            return {
                ...result,
                observedAt,
                campaigns: mergeAlimamaItemCampaignList([...matchedRows, ...zeroRows])
            };
        }));
    }
    const results = [];
    const cursor = new Date(`${input.startDate}T00:00:00Z`);
    const end = new Date(`${input.endDate}T00:00:00Z`);
    while (cursor <= end) {
        const date = cursor.toISOString().slice(0, 10);
        let offset = 0;
        const pageSize = 100;
        let expectedCount = null;
        const rows = [];
        const normalizeHistoricalPageRecords = (pageRecords) => pageRecords.map((record) => {
            if (!isRecord(record))
                return record;
            const sceneId = textValue(pickValue(record, ['originalSceneId', 'sceneId']));
            const sceneName = textValue(pickValue(record, ['originalSceneName', 'scene1Name']));
            const promotions = Array.isArray(record.promotions)
                ? record.promotions.filter(isRecord)
                : [];
            if ((sceneId !== '436' && sceneName !== '货品全站推广') || promotions.length > 0) {
                return record;
            }
            const campaignId = textValue(pickValue(record, ['campaignId', 'campaign_id', 'id']));
            const planCampaigns = inventoryByPlan.get(campaignId) ?? [];
            if (planCampaigns.length !== 1 || !planCampaigns[0].itemId)
                return record;
            const inventoryCampaign = planCampaigns[0];
            return {
                ...record,
                promotions: [{
                        promotionId: inventoryCampaign.itemId,
                        promotionName: inventoryCampaign.itemName,
                        ...(inventoryCampaign.itemImageUrl ? { imgUrl: inventoryCampaign.itemImageUrl } : {})
                    }]
            };
        });
        const parseHistoricalPage = (response, pageRecords) => {
            const exactPageRecords = normalizeHistoricalPageRecords(pageRecords);
            const exactResponse = isRecord(response) && isRecord(response.data)
                ? { ...response, data: { ...response.data, list: exactPageRecords } }
                : response;
            return parseAlimamaHistoricalProductReportResponse(exactResponse, {
                observedAt,
                startDate: date,
                endDate: date
            });
        };
        do {
            const response = await executeAlimamaJsonRequest(webContents, '/report/query.json', buildAlimamaHistoricalProductReportRequest({
                startDate: date,
                endDate: date,
                offset,
                pageSize
            }), sessionContext);
            const pageRecords = isRecord(response) && isRecord(response.data)
                && Array.isArray(response.data.list)
                ? response.data.list
                : [];
            const responseCount = isRecord(response) && isRecord(response.data)
                ? numberValue(response.data.count)
                : 0;
            if (expectedCount === null)
                expectedCount = responseCount;
            rows.push(...parseHistoricalPage(response, pageRecords));
            offset += pageRecords.length;
            if (pageRecords.length === 0 || pageRecords.length < pageSize)
                break;
        } while (expectedCount === null || offset < expectedCount);
        // Alimama's campaign report currently hard-stops traditional offset paging
        // at 1000 rows even when `count` is larger. Never accept that partial set as
        // complete. Instead, use the current exact plan+item inventory as the source
        // of truth and query only the still-missing item IDs through the report's
        // official exact-item filter. This keeps deleted plans out and avoids the
        // destructive mistake of assigning a whole campaign to an unrelated item.
        const bulkIdentities = new Set(rows.flatMap((campaign) => {
            const campaignId = campaign.parentCampaignId ?? campaign.id;
            return campaign.itemId ? [`${campaignId}:${campaign.itemId}`] : [];
        }));
        const bulkWasTruncated = expectedCount !== null && offset < expectedCount;
        const missingItems = bulkWasTruncated
            ? [...new Set([...inventoryByIdentity.entries()]
                    .filter(([identity]) => !bulkIdentities.has(identity))
                    .map(([, campaign]) => campaign.itemId)
                    .filter((itemId) => Boolean(itemId)))]
            : [];
        let missingItemCursor = 0;
        const missingItemWorker = async () => {
            while (missingItemCursor < missingItems.length) {
                const itemId = missingItems[missingItemCursor++];
                let itemOffset = 0;
                let itemExpectedCount = null;
                do {
                    const response = await executeAlimamaJsonRequest(webContents, '/report/query.json', buildAlimamaHistoricalProductReportRequest({
                        startDate: date,
                        endDate: date,
                        offset: itemOffset,
                        pageSize,
                        itemId
                    }), sessionContext);
                    const pageRecords = isRecord(response) && isRecord(response.data)
                        && Array.isArray(response.data.list)
                        ? response.data.list
                        : [];
                    const responseCount = isRecord(response) && isRecord(response.data)
                        ? numberValue(response.data.count)
                        : 0;
                    if (itemExpectedCount === null)
                        itemExpectedCount = responseCount;
                    rows.push(...parseHistoricalPage(response, pageRecords));
                    itemOffset += pageRecords.length;
                    if (pageRecords.length === 0 || pageRecords.length < pageSize)
                        break;
                } while (itemExpectedCount === null || itemOffset < itemExpectedCount);
                if (itemExpectedCount !== null && itemOffset < itemExpectedCount) {
                    throw new AlimamaPromotionError(`天猫计划报表 ${date} 商品 ${itemId} 分页不完整（${itemOffset}/${itemExpectedCount}），本次已拒绝写入`, 'invalid-response');
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(3, missingItems.length) }, () => missingItemWorker()));
        const matchedRows = mergeAlimamaItemCampaignList(rows.flatMap((campaign) => {
            const campaignId = campaign.parentCampaignId ?? campaign.id;
            const inventoryCampaign = campaign.itemId
                ? inventoryByIdentity.get(`${campaignId}:${campaign.itemId}`)
                : undefined;
            if (!inventoryCampaign)
                return [];
            return [{
                    ...campaign,
                    status: inventoryCampaign.status,
                    dailyBudget: inventoryCampaign.dailyBudget,
                    targetRoi: inventoryCampaign.targetRoi,
                    groupId: inventoryCampaign.groupId,
                    groupName: inventoryCampaign.groupName,
                    groupIds: inventoryCampaign.groupIds,
                    groupNames: inventoryCampaign.groupNames,
                    platformUnitId: inventoryCampaign.platformUnitId,
                    platformTargets: inventoryCampaign.platformTargets
                }];
        }));
        const matchedIdentities = new Set(matchedRows.flatMap((campaign) => {
            const campaignId = campaign.parentCampaignId ?? campaign.id;
            return campaign.itemId ? [`${campaignId}:${campaign.itemId}`] : [];
        }));
        const zeroRows = input.includeInventoryZeroRows === false
            ? []
            : [...inventoryByIdentity.entries()].flatMap(([identity, campaign]) => {
                if (matchedIdentities.has(identity))
                    return [];
                // An exact item query succeeded but did not return this current plan for
                // this historical day (for example the plan had not been created yet).
                // Recording an explicit zero is safe and preserves plan+item identity.
                return [{
                        ...campaign,
                        spend: 0,
                        roi: 0,
                        netRoi: 0,
                        orders: 0,
                        netOrders: 0,
                        directNetRoi: 0,
                        directNetRevenue: 0,
                        directNetOrders: 0,
                        directOrders: 0,
                        revenue: 0,
                        netRevenue: 0,
                        impressions: 0,
                        clicks: 0,
                        cartAdds: 0,
                        observedAt,
                        dataStartDate: date,
                        dataEndDate: date
                    }];
            });
        const exactRows = mergeAlimamaItemCampaignList([...matchedRows, ...zeroRows]);
        results.push({ campaigns: exactRows, observedAt, startDate: date, endDate: date });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return results;
}
function findAlimamaHistoricalProductReportRecords(value) {
    if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.list))
        return [];
    return value.data.list.filter((record) => (isRecord(record)
        && Array.isArray(record.promotions)));
}
function parseAlimamaHistoricalProductReportResponse(value, context) {
    const campaigns = [];
    for (const record of findAlimamaHistoricalProductReportRecords(value)) {
        const sceneId = textValue(pickValue(record, ['originalSceneId', 'sceneId']));
        const sceneName = textValue(pickValue(record, ['originalSceneName', 'scene1Name']));
        if (sceneId !== '436' && sceneName !== '货品全站推广')
            continue;
        const promotions = Array.isArray(record.promotions)
            ? record.promotions.filter(isRecord)
            : [];
        const itemPromotions = promotions.filter((candidate) => (/^\d+$/.test(textValue(pickValue(candidate, ['promotionId', 'itemId', 'id'])))));
        // The payload is campaign-grained: charge/ROI belong to the whole plan.
        // Mapping such a row to the first item is destructive when a plan contains
        // more than one product. Keep the legacy parser fail-closed even though live
        // synchronization now uses the item-promotion export instead.
        if (itemPromotions.length !== 1)
            continue;
        const promotion = itemPromotions[0];
        const campaignId = textValue(pickValue(record, ['campaignId', 'campaign_id', 'id']));
        const itemId = promotion
            ? textValue(pickValue(promotion, ['promotionId', 'itemId', 'id']))
            : textValue(pickValue(record, ['promotionId', 'itemId', 'item_id']));
        if (!/^\d+$/.test(campaignId) || !/^\d+$/.test(itemId))
            continue;
        const spend = numberValue(pickValue(record, ['charge', 'cost', 'spend']));
        const revenue = numberValue(pickValue(record, ['alipayInshopAmt', 'revenue']));
        const netRevenue = numberValue(pickValue(record, [
            'retainedAlipayInshopAmt', 'netRevenue'
        ]));
        const directNetRevenue = numberValue(pickValue(record, [
            'alipayDirAmtNet', 'directNetRevenue'
        ]));
        const itemImageUrl = normalizeRemoteImageUrl(promotion
            ? pickValue(promotion, ['imgUrl', 'itemImageUrl', 'picUrl', 'imageUrl'])
            : pickValue(record, ['imgUrl', 'itemImageUrl', 'picUrl', 'imageUrl']));
        campaigns.push({
            id: itemId,
            parentCampaignId: campaignId,
            sourceCampaignIds: [campaignId],
            targetLevel: 'item',
            name: textValue(pickValue(record, ['campaignName', 'planName', 'name']))
                || `计划 ${campaignId}`,
            itemId,
            itemName: promotion
                ? textValue(pickValue(promotion, ['promotionName', 'itemName', 'name', 'title']))
                : textValue(pickValue(record, ['promotionName', 'itemName', 'title'])),
            ...(itemImageUrl ? { itemImageUrl } : {}),
            channel: 'product',
            groupId: null,
            groupName: '',
            status: 'unknown',
            dailyBudget: null,
            targetRoi: null,
            spend,
            roi: spend > 0 ? revenue / spend : numberValue(pickValue(record, ['roi', 'actualRoi'])),
            netRoi: spend > 0
                ? netRevenue / spend
                : numberValue(pickValue(record, ['retainedRoi', 'netRoi'])),
            orders: numberValue(pickValue(record, ['alipayInshopNum', 'orders', 'orderCount'])),
            netOrders: numberValue(pickValue(record, ['retainedAlipayInshopNum', 'netOrders'])),
            directNetRoi: spend > 0
                ? directNetRevenue / spend
                : numberValue(pickValue(record, ['dirNetRoi', 'directNetRoi'])),
            directNetRevenue,
            directNetOrders: numberValue(pickValue(record, ['alipayDirNumNet', 'directNetOrders'])),
            revenue,
            netRevenue,
            impressions: numberValue(pickValue(record, ['adPv', 'impressions', 'pv'])),
            clicks: numberValue(pickValue(record, ['click', 'clicks'])),
            cartAdds: numberValue(pickValue(record, ['cartInshopNum', 'cartAdds'])),
            observedAt: context.observedAt,
            dataStartDate: context.startDate,
            dataEndDate: context.endDate
        });
    }
    return mergeAlimamaItemCampaignList(campaigns);
}
async function syncAlimamaCampaigns(webContents, input, sessionContext) {
    assertAlimamaPage(webContents);
    const authenticated = await webContents.executeJavaScript(`(() => {
    if (/^#!\\/login(?:\\/|$)/i.test(location.hash)) return false;
    const password = document.querySelector('input[type="password"]');
    const loginControl = [...document.querySelectorAll('button, a')].some((element) => {
      const text = (element.textContent || '').replace(/\\s+/g, '').trim();
      return ['登录', '立即登录', '密码登录', '扫码登录'].includes(text);
    });
    const loginFrame = document.querySelector('#alibaba-login-box, iframe[src*="login"], [class*="login-box"]');
    return !(loginFrame || password || loginControl);
  })()`);
    if (!authenticated) {
        throw new AlimamaPromotionError('天猫推广登录已失效，请先在店铺浏览器重新登录', 'needs-login');
    }
    const observedAt = input.observedAt ?? new Date().toISOString();
    const requestedChannels = new Set((input.channels?.length ? input.channels : ['product', 'store'])
        .filter((channel) => channel !== 'keyword'));
    const storeInventoryPromise = requestedChannels.has('store')
        ? getCachedAlimamaStaticInventory(webContents, 'store', async () => {
            const [initialTargets, initialPlans] = await Promise.all([
                fetchAllAlimamaCampaignPages(webContents, 'store', input, observedAt, sessionContext, {
                    itemBreakdown: true,
                    storeSelectedModes: ['shop', 'group'],
                    recordSelectedModes: ['shop', 'group']
                }),
                fetchAllAlimamaCampaignPages(webContents, 'store', input, observedAt, sessionContext, {
                    itemBreakdown: false,
                    storeSelectedModes: ['shop', 'group'],
                    recordSelectedModes: ['shop', 'group']
                })
            ]);
            const [targets, plans] = await Promise.all([
                initialTargets.length > 0 ? Promise.resolve(initialTargets) : fetchAllAlimamaCampaignPages(webContents, 'store', input, observedAt, sessionContext, {
                    itemBreakdown: true,
                    storeSelectedModes: null,
                    recordSelectedModes: ['shop', 'group']
                }),
                initialPlans.length > 0 ? Promise.resolve(initialPlans) : fetchAllAlimamaCampaignPages(webContents, 'store', input, observedAt, sessionContext, {
                    itemBreakdown: false,
                    storeSelectedModes: null,
                    recordSelectedModes: ['shop', 'group']
                })
            ]);
            return {
                targets: targets.map(toAlimamaStaticCampaign),
                plans: plans.map(toAlimamaStaticCampaign)
            };
        })
        : Promise.resolve({ targets: [], plans: [] });
    const productInventoryPromise = requestedChannels.has('product')
        ? fetchReliableAlimamaProductInventory(webContents, input, observedAt, sessionContext)
        : Promise.resolve([]);
    const [productInventory, storeInventory, keywordPlans, exactChannelSummaries] = await Promise.all([
        productInventoryPromise,
        storeInventoryPromise,
        requestedChannels.has('keyword') ? fetchAllAlimamaCampaignPages(webContents, 'keyword', input, observedAt, sessionContext, {}) : Promise.resolve([]),
        fetchAlimamaChannelSummaryCampaigns(webContents, input, observedAt, requestedChannels, sessionContext)
    ]);
    const exactProductSummary = exactChannelSummaries.find((campaign) => campaign.channel === 'product');
    if (requestedChannels.has('product')
        && productInventory.length === 0
        && exactProductSummary
        && (exactProductSummary.spend > 0
            || exactProductSummary.revenue > 0
            || exactProductSummary.clicks > 0
            || exactProductSummary.impressions > 0)) {
        throw new AlimamaPromotionError('天猫全站商品汇总有消耗，但未解析到任何商品明细；本次数据已拒绝写入', 'invalid-response');
    }
    // Product management rows are item-grained and remain the safe fallback for
    // an unavailable bulk export. Never merge campaign-level report totals into
    // these product rows.
    const productCampaigns = productInventory;
    const storeTargetCampaigns = storeInventory.targets;
    const storePlans = storeInventory.plans;
    const [storeCampaigns, keywordCampaigns] = await Promise.all([
        requestedChannels.has('store') ? (async () => {
            const modeCampaigns = await Promise.all(['shop', 'group'].map(async (itemSelectedMode) => {
                const matchingPlans = storePlans.filter((storePlan) => (storePlan.alimamaItemSelectedMode === itemSelectedMode));
                if (matchingPlans.length === 0)
                    return [];
                return fetchAllAlimamaStoreItemPages(webContents, matchingPlans, itemSelectedMode, input, observedAt, sessionContext);
            }));
            return modeCampaigns.flat();
        })() : Promise.resolve([]),
        requestedChannels.has('keyword') ? (async () => {
            const detailedPlans = input.keywordActiveOnly
                ? keywordPlans.filter((campaign) => campaign.status === 'active' || campaign.spend > 0)
                : keywordPlans;
            const planChunks = [];
            for (let index = 0; index < detailedPlans.length; index += ALIMAMA_KEYWORD_CAMPAIGN_CHUNK_SIZE) {
                planChunks.push(detailedPlans.slice(index, index + ALIMAMA_KEYWORD_CAMPAIGN_CHUNK_SIZE));
            }
            const chunkResults = await Promise.all(planChunks.map((plans) => (fetchAllAlimamaKeywordItemPages(webContents, plans, input, observedAt, sessionContext))));
            return mergeAlimamaItemCampaignList(chunkResults.flat());
        })() : Promise.resolve([])
    ]);
    const detailCampaigns = mergeAlimamaItemCampaignList([
        ...productCampaigns,
        ...mergeAlimamaStoreItemMetricsWithTargets(storeTargetCampaigns, storeCampaigns),
        ...keywordCampaigns
    ]);
    let reconciledDetails = detailCampaigns;
    const corrections = [];
    for (const summary of exactChannelSummaries) {
        const channelDetails = reconciledDetails.filter((campaign) => campaign.channel === summary.channel);
        const reconciled = reconcileAlimamaChannelDetails(summary, channelDetails);
        reconciledDetails = [
            ...reconciledDetails.filter((campaign) => campaign.channel !== summary.channel),
            ...reconciled.details
        ];
        corrections.push(buildAlimamaChannelSummaryCorrection(summary, reconciled.details));
    }
    const campaigns = [...reconciledDetails, ...corrections];
    if (requestedChannels.size > 0 && campaigns.length === 0) {
        throw new AlimamaPromotionError('天猫推广登录可能已失效：当前店铺会话未返回任何推广计划；为防止空数据覆盖，旧数据已保留，请重新登录该店铺后重试', 'needs-login');
    }
    return {
        campaigns,
        observedAt,
        startDate: input.startDate,
        endDate: input.endDate
    };
}
async function fetchAllAlimamaKeywordItemPages(webContents, keywordPlans, input, observedAt, sessionContext) {
    if (keywordPlans.length === 0)
        return [];
    const campaignIds = [...new Set(keywordPlans
            .map((campaign) => campaign.id)
            .filter((campaignId) => /^\d+$/.test(campaignId)))];
    const fallbackPageSize = 100;
    let pageSize = 500;
    const requestPage = async (offset, requestedPageSize) => {
        const response = await executeAlimamaJsonRequest(webContents, '/adgroup/horizontal/findPage.json', buildAlimamaKeywordItemReportRequest({
            ...input,
            campaignIds,
            offset,
            pageSize: requestedPageSize
        }), sessionContext);
        return {
            campaigns: parseAlimamaCampaignResponse(response, {
                observedAt,
                startDate: input.startDate,
                endDate: input.endDate,
                entityLevel: 'item',
                channel: 'keyword'
            }),
            rawRecordCount: findCampaignRecords(response).length,
            totalCount: findCampaignTotalCount(response)
        };
    };
    let first;
    try {
        first = await runAlimamaKeywordPageRequest(() => requestPage(0, pageSize));
    }
    catch (error) {
        if (error instanceof AlimamaPromotionError
            && error.code === 'request-failed') {
            pageSize = fallbackPageSize;
            first = await runAlimamaKeywordPageRequest(() => requestPage(0, pageSize));
        }
        else {
            throw error;
        }
    }
    if (first.rawRecordCount === 0)
        return [];
    const campaigns = [...first.campaigns];
    if (first.totalCount !== null) {
        const effectivePageSize = Math.min(pageSize, first.rawRecordCount);
        const offsets = [];
        for (let offset = effectivePageSize; offset < first.totalCount; offset += effectivePageSize) {
            offsets.push(offset);
        }
        const pageResults = await mapAlimamaKeywordPageRequests(offsets, (offset) => requestPage(offset, effectivePageSize));
        for (const result of pageResults)
            campaigns.push(...result.campaigns);
        return mergeAlimamaItemCampaignList(campaigns);
    }
    let offset = first.rawRecordCount;
    for (let page = 1; page < 200; page += 1) {
        const result = await runAlimamaKeywordPageRequest(() => requestPage(offset, pageSize));
        campaigns.push(...result.campaigns);
        if (result.rawRecordCount === 0)
            break;
        offset += result.rawRecordCount;
    }
    return mergeAlimamaItemCampaignList(campaigns);
}
function mergeAlimamaStoreItemMetricsWithTargets(targetCampaigns, metricCampaigns) {
    // The item report endpoint is already scoped to the discovered store-plan IDs.
    // Alimama does not always include adgroup rows in the campaign endpoint, so
    // requiring a matching target here can discard valid products that the item
    // endpoint returned. Keep those product rows for monitoring; when a matching
    // target exists, mergeAlimamaItemCampaignList still adds its actionable unit.
    return mergeAlimamaItemCampaignList([...targetCampaigns, ...metricCampaigns]);
}
async function fetchAllAlimamaStoreItemPages(webContents, storePlans, itemSelectedMode, input, observedAt, sessionContext) {
    const campaignIds = [...new Set(storePlans
            .map((campaign) => campaign.id)
            .filter((campaignId) => /^\d+$/.test(campaignId)))];
    if (campaignIds.length === 0)
        return [];
    const planById = new Map(storePlans.map((campaign) => [campaign.id, campaign]));
    const fallbackPageSize = 100;
    let pageSize = 500;
    const requestPage = async (offset, requestedPageSize, source, requestCampaignIds = campaignIds) => {
        const response = await executeAlimamaJsonRequest(webContents, source === 'item'
            ? '/item/horizontal/findPage.json'
            : '/adgroup/horizontal/findPage.json', (source === 'item' ? buildAlimamaStoreItemRequest : buildAlimamaStoreAdgroupRequest)({
            campaignIds: requestCampaignIds,
            itemSelectedMode,
            startDate: input.startDate,
            endDate: input.endDate,
            offset,
            pageSize: requestedPageSize
        }), sessionContext, { method: source === 'item' ? 'GET' : 'POST' });
        return {
            campaigns: parseAlimamaCampaignResponse(response, {
                observedAt,
                startDate: input.startDate,
                endDate: input.endDate,
                entityLevel: 'item',
                channel: 'store'
            }).map((campaign) => enrichAlimamaStoreItemCampaign(campaign, planById)),
            rawRecordCount: findCampaignRecords(response).length,
            totalCount: findCampaignTotalCount(response)
        };
    };
    let source = itemSelectedMode === 'group' ? 'adgroup' : 'item';
    let first;
    try {
        first = await requestPage(0, pageSize, source);
    }
    catch (error) {
        if (error instanceof AlimamaPromotionError
            && error.code === 'request-failed') {
            pageSize = fallbackPageSize;
            first = await requestPage(0, pageSize, source);
        }
        else {
            throw error;
        }
    }
    if (first.rawRecordCount === 0) {
        source = 'adgroup';
        first = await requestPage(0, pageSize, source);
    }
    const campaigns = [...first.campaigns];
    if (first.rawRecordCount === 0)
        return [];
    if (first.totalCount !== null) {
        const effectivePageSize = Math.min(pageSize, first.rawRecordCount);
        const offsets = [];
        for (let offset = effectivePageSize; offset < first.totalCount; offset += effectivePageSize) {
            offsets.push(offset);
        }
        for (let index = 0; index < offsets.length; index += 5) {
            const pageResults = await Promise.all(offsets.slice(index, index + 5).map((offset) => requestPage(offset, effectivePageSize, source)));
            for (const result of pageResults)
                campaigns.push(...result.campaigns);
        }
    }
    else {
        let offset = first.rawRecordCount;
        for (let page = 1; page < 200; page += 1) {
            const result = await requestPage(offset, pageSize, source);
            campaigns.push(...result.campaigns);
            if (result.rawRecordCount === 0)
                break;
            offset += result.rawRecordCount;
        }
    }
    const mergedCampaigns = mergeAlimamaItemCampaignList(campaigns);
    if (source === 'adgroup')
        return mergedCampaigns;
    const missingTargetCampaignIds = [...new Set(mergedCampaigns
            .filter((campaign) => !campaign.platformTargets?.length)
            .map((campaign) => campaign.parentCampaignId ?? campaign.sourceCampaignIds?.[0] ?? '')
            .filter((campaignId) => /^\d+$/.test(campaignId)))];
    if (missingTargetCampaignIds.length === 0)
        return mergedCampaigns;
    const targetCampaigns = [];
    const firstTargetPage = await requestPage(0, pageSize, 'adgroup', missingTargetCampaignIds);
    targetCampaigns.push(...firstTargetPage.campaigns);
    if (firstTargetPage.rawRecordCount === 0)
        return mergedCampaigns;
    if (firstTargetPage.totalCount !== null) {
        const effectivePageSize = Math.min(pageSize, firstTargetPage.rawRecordCount);
        const offsets = [];
        for (let offset = effectivePageSize; offset < firstTargetPage.totalCount; offset += effectivePageSize) {
            offsets.push(offset);
        }
        for (let index = 0; index < offsets.length; index += 5) {
            const pageResults = await Promise.all(offsets.slice(index, index + 5).map((offset) => (requestPage(offset, effectivePageSize, 'adgroup', missingTargetCampaignIds))));
            for (const result of pageResults)
                targetCampaigns.push(...result.campaigns);
        }
    }
    else {
        let offset = firstTargetPage.rawRecordCount;
        for (let page = 1; page < 200; page += 1) {
            const result = await requestPage(offset, pageSize, 'adgroup', missingTargetCampaignIds);
            targetCampaigns.push(...result.campaigns);
            if (result.rawRecordCount === 0)
                break;
            offset += result.rawRecordCount;
        }
    }
    return mergeAlimamaItemCampaignList([
        ...mergedCampaigns,
        ...targetCampaigns.map(toAlimamaStaticCampaign)
    ]);
}
function enrichAlimamaStoreItemCampaign(campaign, planById) {
    const planId = campaign.parentCampaignId ?? campaign.sourceCampaignIds?.[0] ?? '';
    const plan = planById.get(planId);
    if (!plan)
        return campaign;
    const groupIds = campaign.groupIds?.length
        ? campaign.groupIds
        : campaign.groupId ? [campaign.groupId] : [plan.id];
    const groupNames = groupIds[0] !== plan.id && campaign.groupNames?.length
        ? campaign.groupNames
        : [plan.name];
    const isPlanLevelTarget = plan.alimamaItemSelectedMode === 'shop';
    const planLevelTarget = isPlanLevelTarget
        ? [{ campaignId: plan.id, status: plan.status }]
        : [];
    const platformTargets = [...new Map([
            ...(campaign.platformTargets ?? []).map((target) => ({
                ...target,
                status: target.status === 'unknown' ? plan.status : target.status
            })),
            // A full-store plan is paused and resumed at campaign level. Item-detail
            // responses may continue to expose the old child status for a short time,
            // so the exact parent-plan response must be authoritative.
            ...planLevelTarget
        ].map((target) => [`${target.campaignId}:${target.unitId ?? ''}`, target])).values()];
    return {
        ...campaign,
        name: plan.name,
        parentCampaignId: plan.id,
        sourceCampaignIds: [...new Set([plan.id, ...(campaign.sourceCampaignIds ?? [])])],
        groupId: groupIds[0] ?? plan.id,
        groupName: groupNames[0] ?? plan.name,
        groupIds,
        groupNames,
        status: isPlanLevelTarget ? plan.status : (campaign.status === 'unknown' ? plan.status : campaign.status),
        dailyBudget: campaign.dailyBudget ?? plan.dailyBudget,
        bidStrategy: campaign.bidStrategy || plan.bidStrategy,
        targetRoi: campaign.targetRoi ?? plan.targetRoi,
        ...(platformTargets.length ? { platformTargets } : {})
    };
}
async function fetchAllAlimamaCampaignPages(webContents, channel, input, observedAt, sessionContext, options = {}) {
    const fallbackPageSize = 100;
    let pageSize = 500;
    let offset = 0;
    const campaigns = [];
    const requestPage = async (requestOffset, requestPageSize) => {
        const body = channel === 'keyword'
            ? buildAlimamaKeywordReportRequest({
                ...input,
                offset: requestOffset,
                pageSize: requestPageSize
            })
            : buildAlimamaReportRequest({
                ...input,
                channel,
                offset: requestOffset,
                pageSize: requestPageSize,
                storeItemBreakdown: channel === 'store' && options.itemBreakdown,
                storeSelectedModes: channel === 'store' ? options.storeSelectedModes : undefined
            });
        const response = await executeAlimamaJsonRequest(webContents, '/campaign/horizontal/findPage.json', body, sessionContext);
        const parsedCampaigns = parseAlimamaCampaignResponse(response, {
            observedAt,
            startDate: input.startDate,
            endDate: input.endDate,
            entityLevel: options.itemBreakdown ? 'item' : 'campaign',
            channel,
            selectedModes: options.recordSelectedModes
        });
        const rawRecordCount = findCampaignRecords(response).length;
        return {
            response,
            campaigns: parsedCampaigns,
            rawRecordCount,
            totalCount: findCampaignTotalCount(response)
        };
    };
    if (options.prefetchSecondPage && !options.singlePage) {
        const [first, second] = await Promise.allSettled([
            requestPage(0, pageSize),
            requestPage(pageSize, pageSize)
        ]);
        if (first.status === 'rejected') {
            if (pageSize !== fallbackPageSize
                && first.reason instanceof AlimamaPromotionError
                && first.reason.code === 'request-failed') {
                pageSize = fallbackPageSize;
            }
            else {
                throw first.reason;
            }
        }
        else {
            campaigns.push(...first.value.campaigns);
            if (first.value.rawRecordCount === 0) {
                return [];
            }
            const needsSecondPage = first.value.rawRecordCount === pageSize
                && (first.value.totalCount === null || first.value.totalCount > pageSize);
            if (!needsSecondPage) {
                if (first.value.totalCount !== null
                    && first.value.rawRecordCount >= first.value.totalCount) {
                    return options.itemBreakdown ? mergeAlimamaItemCampaignList(campaigns) : [
                        ...new Map(campaigns.map((campaign) => [campaign.id, campaign])).values()
                    ];
                }
                offset = first.value.rawRecordCount;
            }
            if (needsSecondPage) {
                if (second.status === 'rejected')
                    throw second.reason;
                campaigns.push(...second.value.campaigns);
                if (second.value.rawRecordCount === 0
                    || (second.value.totalCount !== null
                        && pageSize + second.value.rawRecordCount >= second.value.totalCount)) {
                    return options.itemBreakdown ? mergeAlimamaItemCampaignList(campaigns) : [
                        ...new Map(campaigns.map((campaign) => [campaign.id, campaign])).values()
                    ];
                }
                offset = pageSize + second.value.rawRecordCount;
            }
        }
    }
    for (let page = 0; page < 200; page += 1) {
        let result;
        try {
            result = await requestPage(offset, pageSize);
        }
        catch (error) {
            if (offset === 0
                && pageSize !== fallbackPageSize
                && error instanceof AlimamaPromotionError
                && error.code === 'request-failed') {
                pageSize = fallbackPageSize;
                page -= 1;
                continue;
            }
            throw error;
        }
        campaigns.push(...result.campaigns);
        const { rawRecordCount, totalCount } = result;
        if (rawRecordCount === 0)
            break;
        if (options.singlePage)
            break;
        if (totalCount !== null && offset + rawRecordCount >= totalCount)
            break;
        offset += rawRecordCount;
    }
    return options.itemBreakdown ? mergeAlimamaItemCampaignList(campaigns) : [
        ...new Map(campaigns.map((campaign) => [campaign.id, campaign])).values()
    ];
}
async function fetchReliableAlimamaProductInventory(webContents, input, observedAt, sessionContext) {
    const fetchItems = () => fetchAllAlimamaCampaignPages(webContents, 'product', input, observedAt, sessionContext, {
        itemBreakdown: true,
        prefetchSecondPage: true,
        recordSelectedModes: ['user_define']
    });
    const first = await fetchItems();
    if (first.length > 0)
        return first;
    // OneBP sometimes returns an empty item inventory on the first request while
    // the product-plan contract is still warming. Probe the plan level once and
    // then retry the complete item list in the same sync. Never persist a trusted
    // zero when the plan endpoint proves that product campaigns exist.
    const plans = await fetchAllAlimamaCampaignPages(webContents, 'product', input, observedAt, sessionContext, {
        singlePage: true,
        recordSelectedModes: ['user_define']
    });
    const retried = await fetchItems();
    if (retried.length > 0)
        return retried;
    if (plans.length > 0) {
        throw new AlimamaPromotionError(`天猫返回 ${plans.length} 个全站商品计划，但商品明细连续两次为空；本次未保存 0 条数据，请稍后重试`, 'invalid-response');
    }
    return [];
}
async function updateAlimamaCampaignStatus(webContents, campaignId, status, sessionContext, platformUnitId) {
    assertAlimamaPage(webContents);
    const mutation = buildAlimamaCampaignStatusMutation(campaignId, status, platformUnitId);
    const response = await executeAlimamaJsonRequest(webContents, mutation.pathname, mutation.body, sessionContext);
    if (isRecord(response) && response.data === false) {
        throw new AlimamaPromotionError(getAlimamaPlatformMessage(response) || '天猫推广状态没有发生变化', 'request-failed');
    }
    const responseData = isRecord(response) && isRecord(response.data) ? response.data : null;
    const errorCount = responseData ? numberValue(responseData.errorCount) : 0;
    const errorDetails = responseData && Array.isArray(responseData.errorDetails)
        ? responseData.errorDetails
        : [];
    if (errorCount > 0 || errorDetails.length > 0) {
        const detailMessage = errorDetails
            .map((detail) => isRecord(detail)
            ? textValue(pickValue(detail, ['message', 'errorMessage', 'msg', 'reason']))
            : textValue(detail))
            .filter(Boolean)
            .join('；');
        throw new AlimamaPromotionError(detailMessage || getAlimamaPlatformMessage(response) || '天猫推广状态修改失败', 'request-failed');
    }
    // Store-plan inventory is intentionally cached because large stores contain
    // thousands of units. A successful mutation makes that cache stale, so clear
    // it before status verification reads the backend again.
    alimamaStaticInventoryCache.get(webContents)?.clear();
}
function evaluateAlimamaStatusVerifications(campaigns, requests) {
    return requests.map((request) => {
        const channelCampaigns = campaigns.filter((candidate) => candidate.channel === request.channel);
        const expectedLabel = request.expectedStatus === 'paused' ? '已暂停' : '推广中';
        const getTargetStatus = (target) => {
            if (!target.platformUnitId) {
                const parentCampaign = channelCampaigns.find((candidate) => (candidate.id === target.campaignId && candidate.targetLevel === 'campaign'));
                if (parentCampaign)
                    return parentCampaign.status;
            }
            const itemCampaigns = channelCampaigns.filter((candidate) => ((candidate.itemId || candidate.id) === request.itemId));
            for (const campaign of itemCampaigns) {
                const matchedTarget = (campaign.platformTargets ?? []).find((candidate) => (candidate.campaignId === target.campaignId
                    && (target.platformUnitId ? candidate.unitId === target.platformUnitId : true)));
                if (matchedTarget)
                    return matchedTarget.status;
                if (!target.platformUnitId && campaign.parentCampaignId === target.campaignId) {
                    return campaign.status;
                }
            }
            return 'unknown';
        };
        const targetStatuses = request.targets.map((target) => getTargetStatus(target));
        if (targetStatuses.every((status) => status === 'unknown')) {
            return {
                confirmed: false,
                reason: `天猫后台回读时未找到商品 ${request.itemId} 的对应推广计划，不能确认已变为${expectedLabel}`
            };
        }
        const unconfirmedTargets = request.targets.filter((target) => getTargetStatus(target) !== request.expectedStatus);
        if (unconfirmedTargets.length > 0) {
            const actualStatuses = [...new Set(unconfirmedTargets.map((target) => getTargetStatus(target)))];
            const actualLabel = actualStatuses.map((status) => status === 'active' ? '推广中' : status === 'paused' ? '已暂停' : '未知').join('、');
            const targetLabel = request.channel === 'product'
                || unconfirmedTargets.some((target) => !target.platformUnitId)
                ? '推广计划'
                : '推广单元';
            return {
                confirmed: false,
                reason: `天猫后台回读仍为${actualLabel}，${unconfirmedTargets.length} 个${targetLabel}未确认变为${expectedLabel}`
            };
        }
        return { confirmed: true };
    });
}
async function fetchAlimamaTargetedStatusCampaigns(webContents, requests, date, sessionContext) {
    const campaigns = [];
    let cursor = 0;
    const worker = async () => {
        while (cursor < requests.length) {
            const request = requests[cursor++];
            if (!/^\d+$/.test(request.itemId))
                continue;
            const observedAt = new Date().toISOString();
            if (request.channel === 'keyword') {
                const campaignIds = [...new Set(request.targets
                        .map((target) => target.campaignId)
                        .filter((campaignId) => /^\d+$/.test(campaignId)))];
                const response = await executeAlimamaJsonRequest(webContents, '/adgroup/horizontal/findPage.json', buildAlimamaKeywordItemReportRequest({
                    campaignIds,
                    itemId: request.itemId,
                    startDate: date,
                    endDate: date,
                    offset: 0,
                    pageSize: 500
                }), sessionContext);
                campaigns.push(...parseAlimamaCampaignResponse(response, {
                    observedAt,
                    startDate: date,
                    endDate: date,
                    entityLevel: 'item',
                    channel: 'keyword'
                }));
                continue;
            }
            const parentCampaignIds = request.channel === 'store'
                ? [...new Set(request.targets
                        .filter((target) => !target.platformUnitId)
                        .map((target) => target.campaignId)
                        .filter((campaignId) => /^\d+$/.test(campaignId)))]
                : [];
            if (parentCampaignIds.length > 0) {
                const parentResponse = await executeAlimamaJsonRequest(webContents, '/campaign/horizontal/findPage.json', buildAlimamaReportRequest({
                    channel: 'store',
                    campaignIds: parentCampaignIds,
                    startDate: date,
                    endDate: date,
                    offset: 0,
                    pageSize: Math.max(100, parentCampaignIds.length),
                    storeItemBreakdown: false,
                    storeSelectedModes: ['shop', 'group']
                }), sessionContext);
                campaigns.push(...parseAlimamaCampaignResponse(parentResponse, {
                    observedAt,
                    startDate: date,
                    endDate: date,
                    entityLevel: 'campaign',
                    channel: 'store',
                    selectedModes: ['shop', 'group']
                }));
            }
            const needsItemLevelReadback = request.channel !== 'store'
                || request.targets.some((target) => Boolean(target.platformUnitId));
            if (!needsItemLevelReadback)
                continue;
            const response = await executeAlimamaJsonRequest(webContents, '/campaign/horizontal/findPage.json', buildAlimamaReportRequest({
                channel: request.channel,
                itemId: request.itemId,
                startDate: date,
                endDate: date,
                offset: 0,
                pageSize: 500,
                storeItemBreakdown: request.channel === 'store',
                storeSelectedModes: request.channel === 'store' ? ['shop', 'group'] : undefined
            }), sessionContext);
            campaigns.push(...parseAlimamaCampaignResponse(response, {
                observedAt,
                startDate: date,
                endDate: date,
                entityLevel: 'item',
                channel: request.channel,
                selectedModes: request.channel === 'store' ? ['shop', 'group'] : ['user_define']
            }));
        }
    };
    await Promise.all(Array.from({ length: Math.min(3, requests.length) }, () => worker()));
    return mergeAlimamaItemCampaignList(campaigns);
}
async function verifyAlimamaCampaignStatuses(webContents, requests, sessionContext, options = {}) {
    if (requests.length === 0)
        return [];
    const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    const waitBetweenAttempts = options.waitBetweenAttempts ?? (() => new Promise((resolve) => {
        setTimeout(resolve, 800);
    }));
    let results = requests.map(() => ({
        confirmed: false,
        reason: '尚未读取天猫后台状态'
    }));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const date = getShanghaiCalendarDate();
        const campaigns = await fetchAlimamaTargetedStatusCampaigns(webContents, requests, date, sessionContext);
        results = evaluateAlimamaStatusVerifications(campaigns, requests);
        if (results.every((result) => result.confirmed))
            return results;
        if (attempt < maxAttempts - 1)
            await waitBetweenAttempts();
    }
    // The precise item lookup is deliberately the fast path. If Alimama changes
    // one channel's search contract, keep the safety invariant by falling back
    // to one authoritative channel read before reporting failure.
    const channels = [...new Set(requests.map((request) => request.channel))];
    const date = getShanghaiCalendarDate();
    const syncResult = await syncAlimamaCampaigns(webContents, { startDate: date, endDate: date, channels }, sessionContext);
    return evaluateAlimamaStatusVerifications(syncResult.campaigns, requests);
}
function assertAlimamaPage(webContents) {
    let url;
    try {
        url = new URL(webContents.getURL());
    }
    catch {
        throw new AlimamaPromotionError('请先打开天猫推广后台', 'page-unavailable');
    }
    if (url.origin !== 'https://one.alimama.com') {
        throw new AlimamaPromotionError('请先打开天猫推广后台', 'page-unavailable');
    }
    if (isAlimamaLoginUrl(url.href)) {
        throw new AlimamaPromotionError('当前店铺尚未登录天猫推广，请在这个店铺浏览器中完成登录', 'needs-login');
    }
}
async function executeAlimamaJsonRequest(webContents, pathname, body, cachedSessionContext, options = {}) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await executeAlimamaJsonRequestOnce(webContents, pathname, body, cachedSessionContext, options);
        }
        catch (error) {
            lastError = error;
            const retriable = error instanceof AlimamaPromotionError
                && error.code === 'request-failed'
                && /HTTP (?:429|502|503|504)|频繁|限流|繁忙|稍后重试/i.test(error.message);
            if (!retriable || attempt === 2)
                throw error;
            await new Promise((resolve) => {
                setTimeout(resolve, 300 * (2 ** attempt));
            });
        }
    }
    throw lastError;
}
async function executeAlimamaJsonRequestOnce(webContents, pathname, body, cachedSessionContext, options = {}) {
    const method = options.method ?? 'POST';
    const script = `(async () => {
    const findSessionContext = ${findAlimamaSessionContextFromValues.toString()};
    const applySessionContext = ${applyAlimamaSessionContext.toString()};
    const resourceUrls = performance.getEntriesByType('resource').map((entry) => entry.name);
    const sessionContext = ${JSON.stringify(cachedSessionContext ?? null)} || findSessionContext(resourceUrls);
    if (!sessionContext) {
      return { ok: false, status: 0, text: '', sessionContextMissing: true };
    }
    const request = applySessionContext(
      location.origin,
      ${JSON.stringify(pathname)},
      ${JSON.stringify(body)},
      sessionContext
    );
    const method = ${JSON.stringify(method)};
    const requestUrl = new URL(request.url);
    if (method === 'GET') {
      Object.entries(request.body).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        requestUrl.searchParams.set(
          key,
          typeof value === 'object' ? JSON.stringify(value) : String(value)
        );
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ${ALIMAMA_JSON_REQUEST_TIMEOUT_MS});
    try {
      const response = await fetch(requestUrl.toString(), {
        method,
        credentials: 'include',
        signal: controller.signal,
        headers: {
          ...(method === 'POST' ? { 'content-type': 'application/json;charset=UTF-8' } : {}),
          'x-requested-with': 'XMLHttpRequest'
        },
        ...(method === 'POST' ? { body: JSON.stringify(request.body) } : {})
      });
      const text = await response.text();
      return { ok: response.ok, status: response.status, text };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { ok: false, status: 0, text: '', requestTimedOut: true };
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })()`;
    const result = await webContents.executeJavaScript(script);
    if (result.requestTimedOut) {
        throw new AlimamaPromotionError(`天猫推广接口请求超过 ${Math.ceil(ALIMAMA_JSON_REQUEST_TIMEOUT_MS / 1_000)} 秒，请稍后重试`, 'request-failed');
    }
    if (result.sessionContextMissing) {
        throw new AlimamaPromotionError('天猫推广页面会话参数尚未就绪，请刷新推广管理页后重新同步', 'request-failed');
    }
    const parsed = parseJsonResponse(result.text);
    const platformMessage = getAlimamaPlatformMessage(parsed);
    if (!result.ok) {
        if (/csrf|会话校验/i.test(platformMessage)) {
            throw new AlimamaPromotionError('天猫推广页面会话校验未通过，请刷新推广管理页后重新同步', 'request-failed');
        }
        if (result.status === 401 || /login|登录/i.test(platformMessage)) {
            throw new AlimamaPromotionError('天猫推广登录已失效，请重新登录', 'needs-login');
        }
        throw new AlimamaPromotionError(platformMessage || `天猫推广接口返回 HTTP ${result.status}`, 'request-failed');
    }
    if (parsed === null) {
        throw new AlimamaPromotionError('天猫推广接口返回了无法识别的数据', 'invalid-response');
    }
    if (isAlimamaPlatformFailure(parsed)) {
        if (/csrf|会话校验/i.test(platformMessage)) {
            throw new AlimamaPromotionError('天猫推广页面会话校验未通过，请刷新推广管理页后重新同步', 'request-failed');
        }
        if (/login|登录/i.test(platformMessage)) {
            throw new AlimamaPromotionError('天猫推广登录已失效，请重新登录', 'needs-login');
        }
        throw new AlimamaPromotionError(platformMessage || '天猫推广接口请求失败', 'request-failed');
    }
    return parsed;
}
function parseJsonResponse(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function getAlimamaPlatformMessage(value) {
    if (!isRecord(value))
        return '';
    const info = isRecord(value.info) ? value.info : null;
    return textValue(info?.message)
        || textValue(value.message)
        || textValue(value.errorMessage);
}
function isAlimamaPlatformFailure(value) {
    if (!isRecord(value))
        return false;
    const info = isRecord(value.info) ? value.info : null;
    return info?.ok === false || value.success === false;
}
function findCampaignRecords(value) {
    const records = [];
    const visit = (candidate, depth) => {
        if (depth > 8 || candidate === null || candidate === undefined)
            return;
        if (Array.isArray(candidate)) {
            for (const item of candidate) {
                if (isRecord(item) && isAlimamaCampaignRecord(item))
                    records.push(item);
                else
                    visit(item, depth + 1);
            }
            return;
        }
        if (isRecord(candidate)) {
            for (const item of Object.values(candidate))
                visit(item, depth + 1);
        }
    };
    visit(value, 0);
    return records;
}
function isAlimamaCampaignRecord(value) {
    if ('campaignId' in value || 'campaign_id' in value)
        return true;
    return Boolean(textValue(pickValue(value, ['campaignId', 'campaign_id']))
        && textValue(pickValue(value, ['adgroupId', 'adgroup_id', 'unitId', 'unit_id']))
        && textValue(pickValue(value, ['itemId', 'materialId', 'item_id'])));
}
function findCampaignTotalCount(value) {
    const queue = [{ value, depth: 0 }];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!isRecord(current.value) || current.depth > 5)
            continue;
        for (const key of ['totalCount', 'totalSize', 'totalNum', 'total', 'count']) {
            const parsed = Number(current.value[key]);
            if (Number.isSafeInteger(parsed) && parsed >= 0)
                return parsed;
        }
        for (const nested of Object.values(current.value)) {
            if (isRecord(nested))
                queue.push({ value: nested, depth: current.depth + 1 });
        }
    }
    return null;
}
function normalizeAlimamaStatus(value) {
    const status = textValue(value).toLowerCase();
    if (['start', 'active', 'launch', 'online', 'true', '1'].includes(status))
        return 'active';
    if (['pause', 'paused', 'stop', 'offline', 'false', '0'].includes(status))
        return 'paused';
    return 'unknown';
}
function resolveAlimamaPlanStatus(record) {
    return readDirectValue(record, [
        '__campaignDisplayStatus', 'displayStatus', 'status', 'campaignStatus', 'onlineStatus', 'campaignOnlineStatus'
    ]);
}
function resolveAlimamaUnitStatus(record, platformUnitId) {
    const unitRecord = findAlimamaUnitRecord(record, platformUnitId);
    return unitRecord
        ? readDirectValue(unitRecord, [
            'displayStatus', 'status', 'adgroupStatus', 'onlineStatus', 'adgroupOnlineStatus'
        ])
        : undefined;
}
function findAlimamaUnitRecord(value, platformUnitId, depth = 0) {
    if (depth > 8 || value === null || value === undefined)
        return null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findAlimamaUnitRecord(item, platformUnitId, depth + 1);
            if (found)
                return found;
        }
        return null;
    }
    if (!isRecord(value))
        return null;
    const candidateId = textValue(readDirectValue(value, [
        'adgroupId', 'adgroup_id', 'unitId', 'unit_id'
    ]));
    if (candidateId === platformUnitId)
        return value;
    for (const nested of Object.values(value)) {
        const found = findAlimamaUnitRecord(nested, platformUnitId, depth + 1);
        if (found)
            return found;
    }
    return null;
}
function readDirectValue(record, keys) {
    for (const key of keys) {
        if (record[key] !== undefined && record[key] !== null && record[key] !== '')
            return record[key];
    }
    return undefined;
}
function pickValue(record, keys, depth = 0) {
    for (const key of keys) {
        if (record[key] !== undefined && record[key] !== null && record[key] !== '')
            return record[key];
    }
    if (depth >= 3)
        return undefined;
    for (const value of Object.values(record)) {
        if (isRecord(value)) {
            const found = pickValue(value, keys, depth + 1);
            if (found !== undefined)
                return found;
        }
    }
    return undefined;
}
function numberValue(value) {
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function optionalNumber(value) {
    if (value === undefined || value === null || value === '')
        return null;
    return numberValue(value);
}
function optionalMetricNumber(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    return numberValue(value);
}
function findNestedNumber(value, depth = 0) {
    if (depth > 4 || value === undefined || value === null || value === '')
        return null;
    if (typeof value === 'number' || typeof value === 'string') {
        const parsed = Number(String(value).replace(/,/g, ''));
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
    if (!isRecord(value))
        return null;
    for (const key of ['bidTarget', 'targetRoi', 'targetROI', 'targetValue', 'value']) {
        if (key in value) {
            const found = findNestedNumber(value[key], depth + 1);
            if (found !== null)
                return found;
        }
    }
    for (const nested of Object.values(value)) {
        const found = findNestedNumber(nested, depth + 1);
        if (found !== null)
            return found;
    }
    return null;
}
function textValue(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}
function normalizeBidStrategy(value) {
    const normalized = textValue(value)
        .replace(/[:：]?\$\{[^}]+\}/g, '')
        .replace(/[:：]\s*$/, '')
        .trim();
    return normalized || '净目标投产比';
}
function optionalText(value) {
    return textValue(value) || null;
}
function normalizeRemoteImageUrl(value) {
    const source = textValue(value);
    if (!source)
        return undefined;
    const candidate = source.startsWith('//') ? `https:${source}` : source;
    try {
        const url = new URL(candidate);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
    }
    catch {
        return undefined;
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
