"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTERNAL_PURCHASE_SKU_CENTER_URL = exports.INTERNAL_PURCHASE_ACTIVITY_LIST_URL = exports.INTERNAL_PURCHASE_CREATE_URL = void 0;
exports.normalizeInternalPurchaseAutomationError = normalizeInternalPurchaseAutomationError;
exports.isInternalPurchaseSecurityChallengeError = isInternalPurchaseSecurityChallengeError;
exports.isInternalPurchaseLoginRequiredError = isInternalPurchaseLoginRequiredError;
exports.shouldUseInternalPurchaseLegacyFallback = shouldUseInternalPurchaseLegacyFallback;
exports.buildInternalPurchaseSecurityChallengeProbeExpression = buildInternalPurchaseSecurityChallengeProbeExpression;
exports.resolveInternalPurchaseMtopProductAvailability = resolveInternalPurchaseMtopProductAvailability;
exports.buildInternalPurchaseMtopRiskCalcItems = buildInternalPurchaseMtopRiskCalcItems;
exports.buildInternalPurchaseBulkDiscountFormValue = buildInternalPurchaseBulkDiscountFormValue;
exports.buildInternalPurchaseMtopProductQueryExpression = buildInternalPurchaseMtopProductQueryExpression;
exports.buildInternalPurchaseMtopPagedProductQueryExpression = buildInternalPurchaseMtopPagedProductQueryExpression;
exports.buildInternalPurchaseBatchWorkbook = buildInternalPurchaseBatchWorkbook;
exports.buildInternalPurchaseProductSeedWorkbook = buildInternalPurchaseProductSeedWorkbook;
exports.buildInternalPurchaseBatchTemplateDownloadExpression = buildInternalPurchaseBatchTemplateDownloadExpression;
exports.buildInternalPurchaseBatchUploadExpression = buildInternalPurchaseBatchUploadExpression;
exports.buildInternalPurchaseBatchTaskQueryExpression = buildInternalPurchaseBatchTaskQueryExpression;
exports.buildInternalPurchaseBatchUploadFormValue = buildInternalPurchaseBatchUploadFormValue;
exports.buildInternalPurchaseMtopRiskCalcExpression = buildInternalPurchaseMtopRiskCalcExpression;
exports.buildInternalPurchaseGoodsFormInjectionExpression = buildInternalPurchaseGoodsFormInjectionExpression;
exports.classifyInternalPurchaseSubmitFeedback = classifyInternalPurchaseSubmitFeedback;
exports.classifyInternalPurchaseVisibleDateRange = classifyInternalPurchaseVisibleDateRange;
exports.hasInternalPurchaseVisibleDateRangeDates = hasInternalPurchaseVisibleDateRangeDates;
exports.formatInternalPurchaseSkuSelectionFailure = formatInternalPurchaseSkuSelectionFailure;
exports.buildInternalPurchaseActivityShareDetailsExpression = buildInternalPurchaseActivityShareDetailsExpression;
exports.buildInternalPurchaseDeliveryUrl = buildInternalPurchaseDeliveryUrl;
exports.buildInternalPurchaseQrDataUrlExpression = buildInternalPurchaseQrDataUrlExpression;
exports.buildInternalPurchaseExposureStateExpression = buildInternalPurchaseExposureStateExpression;
exports.buildInternalPurchaseExposureSwitchResolver = buildInternalPurchaseExposureSwitchResolver;
exports.buildInternalPurchaseExposureCloseConfirmationResolver = buildInternalPurchaseExposureCloseConfirmationResolver;
exports.resolveInternalPurchaseProductAvailability = resolveInternalPurchaseProductAvailability;
exports.resolveInternalPurchasePlatformSchedule = resolveInternalPurchasePlatformSchedule;
exports.resolveInternalPurchaseFinalSubmitSchedule = resolveInternalPurchaseFinalSubmitSchedule;
exports.shiftInternalPurchaseScheduleToCalendarDate = shiftInternalPurchaseScheduleToCalendarDate;
exports.buildInternalPurchaseEarliestAvailableCalendarDateExpression = buildInternalPurchaseEarliestAvailableCalendarDateExpression;
exports.buildInternalPurchaseVisibleCalendarReadyExpression = buildInternalPurchaseVisibleCalendarReadyExpression;
exports.buildInternalPurchaseCalendarDateStateExpression = buildInternalPurchaseCalendarDateStateExpression;
exports.buildInternalPurchaseProductCheckboxResolver = buildInternalPurchaseProductCheckboxResolver;
exports.buildInternalPurchaseProductResultStateExpression = buildInternalPurchaseProductResultStateExpression;
exports.buildInternalPurchaseSkuCenterSearchPanelResolver = buildInternalPurchaseSkuCenterSearchPanelResolver;
exports.buildInternalPurchaseSkuCenterBatchQueryExpression = buildInternalPurchaseSkuCenterBatchQueryExpression;
exports.buildInternalPurchaseSkuCenterSearchInputResolver = buildInternalPurchaseSkuCenterSearchInputResolver;
exports.buildInternalPurchaseSkuCenterSearchButtonResolver = buildInternalPurchaseSkuCenterSearchButtonResolver;
exports.buildInternalPurchaseSkuCenterProductExpandResolver = buildInternalPurchaseSkuCenterProductExpandResolver;
exports.buildInternalPurchaseSkuCenterScrollableResolver = buildInternalPurchaseSkuCenterScrollableResolver;
exports.buildInternalPurchaseSkuCenterResultStateExpression = buildInternalPurchaseSkuCenterResultStateExpression;
exports.buildInternalPurchaseSkuCenterVisibleSkuStateExpression = buildInternalPurchaseSkuCenterVisibleSkuStateExpression;
exports.buildInternalPurchaseLoginPageProbeExpression = buildInternalPurchaseLoginPageProbeExpression;
exports.buildInternalPurchaseProductProbeExpression = buildInternalPurchaseProductProbeExpression;
exports.buildInternalPurchaseSelectedSkuProductsExpression = buildInternalPurchaseSelectedSkuProductsExpression;
exports.buildInternalPurchaseSkuIdListExpression = buildInternalPurchaseSkuIdListExpression;
exports.buildInternalPurchaseSkuVirtualListStateExpression = buildInternalPurchaseSkuVirtualListStateExpression;
exports.buildInternalPurchaseSkuProductCardResolver = buildInternalPurchaseSkuProductCardResolver;
exports.buildInternalPurchaseSkuProductTriggerResolver = buildInternalPurchaseSkuProductTriggerResolver;
exports.buildInternalPurchaseSkuProductClickableResolver = buildInternalPurchaseSkuProductClickableResolver;
exports.buildInternalPurchaseSkuProductActivationExpression = buildInternalPurchaseSkuProductActivationExpression;
exports.buildInternalPurchaseSkuProductOrderExpression = buildInternalPurchaseSkuProductOrderExpression;
exports.buildInternalPurchaseSkuProductSelectionExpression = buildInternalPurchaseSkuProductSelectionExpression;
exports.buildInternalPurchaseSkuProductSelectionDiagnosticExpression = buildInternalPurchaseSkuProductSelectionDiagnosticExpression;
exports.buildInternalPurchaseSkuDiscountInputResolver = buildInternalPurchaseSkuDiscountInputResolver;
exports.buildInternalPurchaseSkuDiscountCommitExpression = buildInternalPurchaseSkuDiscountCommitExpression;
exports.buildInternalPurchaseSkuStageExpression = buildInternalPurchaseSkuStageExpression;
exports.buildInternalPurchaseSkuEditorDialogExpression = buildInternalPurchaseSkuEditorDialogExpression;
exports.buildInternalPurchaseSkuEditorCloseResolver = buildInternalPurchaseSkuEditorCloseResolver;
exports.buildInternalPurchaseSkuEditorCompletedExpression = buildInternalPurchaseSkuEditorCompletedExpression;
exports.buildInternalPurchaseVisibleBatchUploadStateExpression = buildInternalPurchaseVisibleBatchUploadStateExpression;
exports.buildInternalPurchaseSkuFinishReadyExpression = buildInternalPurchaseSkuFinishReadyExpression;
exports.buildInternalPurchaseSkuRiskConfirmationResolver = buildInternalPurchaseSkuRiskConfirmationResolver;
exports.buildInternalPurchaseSkuEditorSnapshotExpression = buildInternalPurchaseSkuEditorSnapshotExpression;
exports.buildInternalPurchaseNextStepResolver = buildInternalPurchaseNextStepResolver;
exports.buildInternalPurchaseDateRangeTriggerExpression = buildInternalPurchaseDateRangeTriggerExpression;
exports.buildInternalPurchasePickerInputResolver = buildInternalPurchasePickerInputResolver;
exports.buildInternalPurchaseDateRangeAppliedExpression = buildInternalPurchaseDateRangeAppliedExpression;
exports.buildInternalPurchaseVisibleDateRangeExpression = buildInternalPurchaseVisibleDateRangeExpression;
exports.buildInternalPurchaseDateRangeConfirmResolver = buildInternalPurchaseDateRangeConfirmResolver;
exports.buildInternalPurchaseFailureDiagnosticExpression = buildInternalPurchaseFailureDiagnosticExpression;
exports.collectInternalPurchaseVisibleFailureDiagnostic = collectInternalPurchaseVisibleFailureDiagnostic;
exports.parseInternalPurchaseActivityCards = parseInternalPurchaseActivityCards;
exports.listInternalPurchaseActivities = listInternalPurchaseActivities;
exports.prepareInternalPurchaseActivity = prepareInternalPurchaseActivity;
exports.closeInternalPurchaseActivity = closeInternalPurchaseActivity;
exports.buildInternalPurchaseProductConfigurationStateExpression = buildInternalPurchaseProductConfigurationStateExpression;
exports.waitForInternalPurchaseProductConfigurationReady = waitForInternalPurchaseProductConfigurationReady;
exports.createInternalPurchaseActivity = createInternalPurchaseActivity;
exports.buildInternalPurchaseInlineValidationExpression = buildInternalPurchaseInlineValidationExpression;
exports.waitForSopSubmit = waitForSopSubmit;
exports.loadInternalPurchaseUrl = loadInternalPurchaseUrl;
exports.shouldRetryInternalPurchaseDeepLink = shouldRetryInternalPurchaseDeepLink;
exports.isTaobaoLoginUrl = isTaobaoLoginUrl;
exports.closeConfirmationForActivity = closeConfirmationForActivity;
const internal_purchase_background_input_1 = require("./internal-purchase-background-input");
const internal_purchase_sku_rule_1 = require("./internal-purchase-sku-rule");
const internal_purchase_create_readiness_1 = require("./internal-purchase-create-readiness");
const fflate_1 = require("fflate");
const promotion_background_page_1 = require("./promotion-background-page");
exports.INTERNAL_PURCHASE_CREATE_URL = 'https://myseller.taobao.com/home.htm/CRM-Workbench/ecrm-sop-form/Shop-Activities';
exports.INTERNAL_PURCHASE_ACTIVITY_LIST_URL = 'https://myseller.taobao.com/home.htm/private-domain-workbench/activityList';
exports.INTERNAL_PURCHASE_SKU_CENTER_URL = 'https://myseller.taobao.com/home.htm/SellManage/on_sale_skucenter?from=qn_entry&curren';
const preparedInternalPurchaseBatchFiles = new WeakMap();
const INTERNAL_PURCHASE_LEGACY_FALLBACK_PRODUCT_LIMIT = 20;
function normalizeInternalPurchaseAutomationError(error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    return rawMessage
        .replace(/^Error:\s*/u, '')
        .split(/\n\s*at\s/u, 1)[0]
        .trim();
}
function isInternalPurchaseSecurityChallengeError(error) {
    return /淘宝触发安全验证|淘宝安全验证|访问拒绝|访问被拒绝|FAIL_SYS_USER_VALIDATE|RGV587_ERROR|bixi\.alicdn\.com\/punish|\/punish/iu
        .test(normalizeInternalPurchaseAutomationError(error));
}
function isInternalPurchaseLoginRequiredError(error) {
    return /店铺登录已失效|请重新登录后执行任务/iu
        .test(normalizeInternalPurchaseAutomationError(error));
}
function shouldUseInternalPurchaseLegacyFallback(productCount, error) {
    return productCount <= INTERNAL_PURCHASE_LEGACY_FALLBACK_PRODUCT_LIMIT
        && !isInternalPurchaseSecurityChallengeError(error);
}
function buildInternalPurchaseSecurityChallengeProbeExpression() {
    return `(() => {
    const bodyText = (document.body?.innerText || '').replace(/\\s+/gu, ' ');
    const hasPunishFrame = Array.from(document.querySelectorAll('iframe')).some((frame) => {
      const source = frame.getAttribute('src') || '';
      const rect = frame.getBoundingClientRect();
      return (source.includes('bixi.alicdn.com/punish') || source.includes('/punish'))
        && rect.width > 0
        && rect.height > 0;
    });
    return location.href.includes('/punish')
      || hasPunishFrame
      || /访问拒绝|访问被拒绝|请完成安全验证|拖动[^。]{0,12}滑块/u.test(bodyText);
  })()`;
}
function resolveInternalPurchaseMtopProductAvailability(product) {
    if (!product)
        return { status: 'not-found' };
    const optional = product.isOptional === true || product.isOptional === 'true';
    const participated = (product.isParticipatedItem === true
        || product.isParticipatedItem === 'true');
    if (!optional || participated) {
        return { status: 'occupied', reason: '已在其他活动中使用' };
    }
    return { status: 'selectable' };
}
function buildInternalPurchaseMtopRiskCalcItems(products, rule) {
    return products.map((product) => ({
        itemId: Number(product.itemId),
        skuList: product.skuVOS.map((sku, index) => ({
            skuId: Number(sku.skuId),
            discountDisplay: Math.round(100 * (index === (0, internal_purchase_sku_rule_1.resolveInternalPurchaseSpecialSkuIndex)(product.skuVOS.length) ? rule.lastSku : rule.otherSkus)),
            discountType: 2,
            isDiscardFen: false,
            isMathFloor: false
        }))
    }));
}
function buildInternalPurchaseBulkDiscountFormValue(products, rule) {
    const addedGoodsList = buildInternalPurchaseMtopRiskCalcItems(products, rule)
        .flatMap((product) => product.skuList.map((sku) => ({
        itemId: product.itemId,
        skuId: sku.skuId,
        discountDisplay: sku.discountDisplay,
        isDiscardFen: false,
        isMathFloor: false
    })));
    return {
        data: {
            addedGoodsList,
            updateGoodsList: [],
            deleteGoodsList: [],
            discountType: 2,
            promotionLevel: 3,
            topGoodsList: []
        },
        isComplete: true,
        locked: false
    };
}
function buildInternalPurchaseMtopProductQueryExpression(productIds, startsAt, endsAt) {
    return `(async () => {
    const productIds = ${JSON.stringify(productIds)};
    const request = window.lib?.mtop?.request;
    if (typeof request !== 'function') {
      throw new Error('淘宝页面批量商品接口尚未加载');
    }
    return Promise.all(productIds.map(async (id) => {
      try {
        const response = await Promise.race([
          request({
            api: 'mtop.taobao.passportweb.benefit.itemselector.itemlist.query',
            v: '1.0',
            data: {
              source: 'single_treasure',
              cur_page: 1,
              page_size: 25,
              start_time: ${JSON.stringify(startsAt)},
              end_time: ${JSON.stringify(endsAt)},
              item_id: id
            }
          }),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error('商品接口响应超时')),
            8_000
          ))
        ]);
        const envelope = response?.data;
        if (String(envelope?.code || '') !== '200') {
          return {
            id,
            product: null,
            error: String(envelope?.message || response?.ret?.[0] || '商品查询失败')
          };
        }
        const product = Array.isArray(envelope?.data)
          ? envelope.data.find((candidate) => String(candidate?.itemId || '') === id) || null
          : null;
        return { id, product };
      } catch (error) {
        return {
          id,
          product: null,
          error: String(error?.data?.message || error?.ret?.[0] || error?.message || error)
        };
      }
    }));
  })()`;
}
function buildInternalPurchaseMtopPagedProductQueryExpression(productIds, startsAt, endsAt) {
    return `(async () => {
    const requestedIds = ${JSON.stringify(productIds)};
    const requestedIdSet = new Set(requestedIds);
    const matched = new Map();
    const request = window.lib?.mtop?.request;
    if (typeof request !== 'function') {
      throw new Error('淘宝页面批量商品接口尚未加载');
    }
    const hasVisibleChallenge = () => {
      const bodyText = (document.body?.innerText || '').replace(/\\s+/gu, ' ');
      const visiblePunishFrame = Array.from(document.querySelectorAll('iframe')).some((frame) => {
        const source = frame.getAttribute('src') || '';
        const rect = frame.getBoundingClientRect();
        const style = getComputedStyle(frame);
        return (source.includes('bixi.alicdn.com/punish') || source.includes('/punish'))
          && rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      });
      return location.href.includes('/punish')
        || visiblePunishFrame
        || /访问拒绝|访问被拒绝|请完成安全验证|拖动[^。]{0,12}滑块/u.test(bodyText);
    };
    const assertNoChallenge = () => {
      if (hasVisibleChallenge()) {
        throw new Error('淘宝触发安全验证，请点击“处理”并完成验证后继续');
      }
    };

    let total = 0;
    let pagesFetched = 0;
    let expectedPages = 1;
    for (let page = 1; page <= Math.min(200, expectedPages); page += 1) {
      assertNoChallenge();
      const response = await Promise.race([
        request({
          api: 'mtop.taobao.passportweb.benefit.itemselector.itemlist.query',
          v: '1.0',
          data: {
            source: 'single_treasure',
            cur_page: page,
            page_size: 100,
            start_time: ${JSON.stringify(startsAt)},
            end_time: ${JSON.stringify(endsAt)}
          }
        }),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('店铺商品分页接口响应超时')),
          12_000
        ))
      ]);
      assertNoChallenge();
      const envelope = response?.data?.code != null ? response.data : response;
      if (String(envelope?.code || '') !== '200') {
        const failure = String(
          envelope?.message
          || response?.ret?.[0]
          || '店铺商品分页查询失败'
        );
        if (/访问拒绝|访问被拒绝|安全验证|FAIL_SYS_USER_VALIDATE|RGV587_ERROR/iu.test(failure)) {
          throw new Error(\`淘宝触发安全验证：\${failure}\`);
        }
        throw new Error(failure);
      }
      const pageProducts = Array.isArray(envelope?.data) ? envelope.data : [];
      total = Math.max(0, Number(envelope?.total || pageProducts.length || 0));
      pagesFetched = page;
      for (const product of pageProducts) {
        const id = String(product?.itemId || '');
        if (requestedIdSet.has(id)) matched.set(id, product);
      }
      if (matched.size >= requestedIdSet.size || pageProducts.length === 0) break;
      expectedPages = total > 0
        ? Math.max(page, Math.ceil(total / Math.max(1, pageProducts.length)))
        : page + 1;
      if (page >= expectedPages) break;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    return {
      products: requestedIds.map((id) => matched.get(id)).filter(Boolean),
      total,
      pagesFetched,
      missingIds: requestedIds.filter((id) => !matched.has(id))
    };
  })()`;
}
function escapeInternalPurchaseWorkbookXml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
function buildInternalPurchaseBatchWorkbook(template, products, rule) {
    const files = (0, fflate_1.unzipSync)(template);
    const worksheetPath = 'xl/worksheets/sheet1.xml';
    const worksheetBytes = files[worksheetPath];
    if (!worksheetBytes)
        throw new Error('淘宝批量导入模板缺少工作表');
    const worksheet = (0, fflate_1.strFromU8)(worksheetBytes);
    const header = worksheet.match(/<row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/row>/u)?.[0];
    if (!header)
        throw new Error('淘宝批量导入模板表头无法识别');
    const rows = [header];
    let rowNumber = 2;
    for (const product of products) {
        for (const [skuIndex, sku] of product.skuVOS.entries()) {
            const discount = skuIndex === (0, internal_purchase_sku_rule_1.resolveInternalPurchaseSpecialSkuIndex)(product.skuVOS.length)
                ? rule.lastSku
                : rule.otherSkus;
            rows.push(`<row r="${rowNumber}">`
                + `<c r="A${rowNumber}" s="1" t="inlineStr"><is><t>${escapeInternalPurchaseWorkbookXml(product.itemId)}</t></is></c>`
                + `<c r="B${rowNumber}" s="2"><v>2</v></c>`
                + `<c r="C${rowNumber}" s="2"><v>${escapeInternalPurchaseWorkbookXml(discount)}</v></c>`
                + `<c r="D${rowNumber}" s="1" t="inlineStr"><is><t>${escapeInternalPurchaseWorkbookXml(sku.skuId)}</t></is></c>`
                + `<c r="E${rowNumber}" s="2"><v>0</v></c>`
                + '</row>');
            rowNumber += 1;
        }
    }
    const lastRow = Math.max(1, rowNumber - 1);
    const updatedWorksheet = worksheet
        .replace(/<dimension\b[^>]*\bref="[^"]*"[^>]*\/>/u, `<dimension ref="A1:E${lastRow}"/>`)
        .replace(/<sheetData>[\s\S]*?<\/sheetData>/u, `<sheetData>${rows.join('')}</sheetData>`);
    files[worksheetPath] = (0, fflate_1.strToU8)(updatedWorksheet);
    return (0, fflate_1.zipSync)(files, { level: 6 });
}
function buildInternalPurchaseProductSeedWorkbook(template, productIds, discount) {
    const files = (0, fflate_1.unzipSync)(template);
    const worksheetPath = 'xl/worksheets/sheet1.xml';
    const worksheetBytes = files[worksheetPath];
    if (!worksheetBytes)
        throw new Error('淘宝批量导入模板缺少工作表');
    const worksheet = (0, fflate_1.strFromU8)(worksheetBytes);
    const header = worksheet.match(/<row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/row>/u)?.[0];
    if (!header)
        throw new Error('淘宝批量导入模板表头无法识别');
    const rows = [header];
    for (const [index, productId] of productIds.entries()) {
        const rowNumber = index + 2;
        rows.push(`<row r="${rowNumber}">`
            + `<c r="A${rowNumber}" s="1" t="inlineStr"><is><t>${escapeInternalPurchaseWorkbookXml(productId)}</t></is></c>`
            + `<c r="B${rowNumber}" s="2"><v>2</v></c>`
            + `<c r="C${rowNumber}" s="2"><v>${escapeInternalPurchaseWorkbookXml(discount)}</v></c>`
            + `<c r="E${rowNumber}" s="2"><v>0</v></c>`
            + '</row>');
    }
    const lastRow = Math.max(1, productIds.length + 1);
    const updatedWorksheet = worksheet
        .replace(/<dimension\b[^>]*\bref="[^"]*"[^>]*\/>/u, `<dimension ref="A1:E${lastRow}"/>`)
        .replace(/<sheetData>[\s\S]*?<\/sheetData>/u, `<sheetData>${rows.join('')}</sheetData>`);
    files[worksheetPath] = (0, fflate_1.strToU8)(updatedWorksheet);
    return (0, fflate_1.zipSync)(files, { level: 6 });
}
function buildInternalPurchaseBatchTemplateDownloadExpression() {
    return `(async () => {
    const token = (document.cookie.match(/(?:^|;\\s*)_tb_token_=([^;]+)/) || [])[1] || '';
    if (!token) throw new Error('淘宝批量模板下载缺少登录令牌');
    const response = await fetch(
      'https://tbpassport.taobao.com/batch/import/downloadImportTemplated?_csrf='
        + encodeURIComponent(token)
        + '&activityType=SINGLE_TREASURE',
      { credentials: 'include' }
    );
    if (!response.ok) throw new Error('淘宝批量模板下载失败：' + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.slice(offset, offset + 8192));
    }
    return btoa(binary);
  })()`;
}
function buildInternalPurchaseBatchUploadExpression(workbookBase64, taskId, startsAt, endsAt) {
    return `(async () => {
    const token = (document.cookie.match(/(?:^|;\\s*)_tb_token_=([^;]+)/) || [])[1] || '';
    if (!token) throw new Error('淘宝批量上传缺少登录令牌');
    const binary = atob(${JSON.stringify(workbookBase64)});
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const form = new FormData();
    form.append(
      'file',
      new File(
        [bytes],
        '内购会批量导入.xlsx',
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      )
    );
    form.set('taskId', ${JSON.stringify(String(taskId))});
    form.set('activityType', 'SINGLE_TREASURE');
    form.set('startTime', ${JSON.stringify(String(startsAt))});
    form.set('endTime', ${JSON.stringify(String(endsAt))});
    const response = await fetch(
      'https://tbpassport.taobao.com/batch/import/upload?_csrf=' + encodeURIComponent(token),
      { method: 'POST', credentials: 'include', body: form }
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.data) {
      throw new Error(String(body?.message || body?.msg || '淘宝批量文件上传失败'));
    }
    return { importTaskId: String(body.data) };
  })()`;
}
function buildInternalPurchaseBatchTaskQueryExpression(importTaskId) {
    return `(async () => {
    const request = window.lib?.mtop?.request;
    if (typeof request !== 'function') {
      throw new Error('淘宝批量任务查询接口尚未加载');
    }
    const response = await Promise.race([
      request({
        api: 'mtop.taobao.passportweb.benefit.batch.task.query',
        v: '1.0',
        type: 'POST',
        data: { importTaskId: ${JSON.stringify(importTaskId)} }
      }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('淘宝批量任务查询超时')),
        12_000
      ))
    ]);
    const envelope = response?.data?.code != null ? response.data : response;
    if (String(envelope?.code || '') !== '200') {
      throw new Error(String(
        envelope?.message
        || response?.ret?.[0]
        || '淘宝批量任务查询失败'
      ));
    }
    return envelope?.data || {};
  })()`;
}
function buildInternalPurchaseBatchUploadFormValue(taskId, report) {
    return {
        data: {
            addedGoodsList: [],
            updateGoodsList: [],
            deleteGoodsList: [],
            taskId,
            promotionLevel: Number(report.promotionLevel || 3),
            discountType: Number(report.discountType || 2)
        },
        isComplete: true,
        locked: false
    };
}
function buildInternalPurchaseMtopRiskCalcExpression(items, startsAt, endsAt) {
    return `(async () => {
    const items = ${JSON.stringify(items)};
    const request = window.lib?.mtop?.request;
    if (typeof request !== 'function') {
      throw new Error('淘宝页面 SKU 校验接口尚未加载');
    }
    try {
      const response = await Promise.race([
        request({
          api: 'mtop.taobao.passportweb.benefit.itemselector.promotion.riskcalc',
          v: '1.0',
          type: 'POST',
          data: {
            source: 'single_treasure',
            start_time: ${JSON.stringify(startsAt)},
            end_time: ${JSON.stringify(endsAt)},
            promotion_level: 3,
            items: JSON.stringify(items)
          }
        }),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('SKU 校验接口响应超时')),
          8_000
        ))
      ]);
      const envelope = response?.data;
      if (String(envelope?.code || '') !== '200') {
        throw new Error(String(envelope?.message || response?.ret?.[0] || 'SKU 校验失败'));
      }
      return Array.isArray(envelope?.data) ? envelope.data : [];
    } catch (error) {
      throw new Error(String(
        error?.data?.message
        || error?.ret?.[0]
        || error?.message
        || error
      ));
    }
  })()`;
}
function buildInternalPurchaseGoodsFormInjectionExpression(value) {
    return `(() => {
    const value = ${JSON.stringify(value)};
    const root = document.querySelector('[class*="GoodsSwitchPicker--goodsPickerNew"]')
      || document.querySelector('[class*="GoodsPickerNew--goodsPickerNew"]')
      || document.querySelector('[class*="skuGoodsDialog"]');
    if (!root) return { ok: false, reason: '商品优惠表单尚未加载' };
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? root[fiberKey] : null;
    const callbacks = [];
    const seenCallbacks = new Set();
    let selectedSkuCount = 0;
    const isCurrentFiber = (candidate) => {
      let candidateRoot = candidate;
      while (candidateRoot?.return) candidateRoot = candidateRoot.return;
      return candidateRoot?.stateNode?.current === candidateRoot;
    };
    while (fiber) {
      for (const candidate of [fiber, fiber.alternate].filter(Boolean)) {
        const candidateProps = candidate.memoizedProps || candidate.pendingProps || {};
        if (
          typeof candidateProps.onChange === 'function'
          && Array.isArray(candidateProps.value?.data?.addedGoodsList)
        ) {
          selectedSkuCount = Math.max(
            selectedSkuCount,
            candidateProps.value.data.addedGoodsList.length
          );
          if (!seenCallbacks.has(candidateProps.onChange)) {
            seenCallbacks.add(candidateProps.onChange);
            callbacks.push({
              callback: candidateProps.onChange,
              current: isCurrentFiber(candidate)
            });
          }
        }
      }
      fiber = fiber.return;
    }
    if (callbacks.length === 0) {
      return { ok: false, reason: '未找到淘宝商品优惠表单回调' };
    }
    callbacks
      .sort((left, right) => Number(left.current) - Number(right.current))
      .forEach(({ callback }) => callback(value));
    return {
      ok: true,
      skuCount: value.data.addedGoodsList?.length || 0,
      selectedSkuCount,
      invokedCallbacks: callbacks.length
    };
  })()`;
}
function classifyInternalPurchaseSubmitFeedback(feedback) {
    const normalized = feedback.trim();
    if (!normalized)
        return 'none';
    if (/操作太快|请求太频繁|操作频繁|提交频繁|访问频繁/u.test(normalized)) {
        return 'rate-limited';
    }
    if (/活动创建成功|可去投放活动/u.test(normalized)) {
        return 'success';
    }
    return 'feedback';
}
function classifyInternalPurchaseVisibleDateRange(visibleRange, expectedStart, expectedEnd) {
    const normalizeToMinute = (value) => (String(value || '').trim().replace('T', ' ').match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/u)?.[0] || '');
    const actualStart = normalizeToMinute(visibleRange.startsAt);
    const actualEnd = normalizeToMinute(visibleRange.endsAt);
    if (!actualStart || !actualEnd)
        return 'missing';
    if (actualEnd <= actualStart)
        return 'invalid';
    const expectedStartParts = localParts(expectedStart);
    const expectedEndParts = localParts(expectedEnd);
    const expectedStartMinute = `${expectedStartParts.date} ${expectedStartParts.hour}:${expectedStartParts.minute}`;
    const expectedEndMinute = `${expectedEndParts.date} ${expectedEndParts.hour}:${expectedEndParts.minute}`;
    return actualStart === expectedStartMinute && actualEnd === expectedEndMinute
        ? 'match'
        : 'mismatch';
}
function hasInternalPurchaseVisibleDateRangeDates(visibleRange, expectedStart, expectedEnd) {
    const visibleDate = (value) => (String(value || '').trim().match(/^\d{4}-\d{2}-\d{2}/u)?.[0] || '');
    return visibleDate(visibleRange.startsAt) === localParts(expectedStart).date
        && visibleDate(visibleRange.endsAt) === localParts(expectedEnd).date;
}
function formatInternalPurchaseSkuSelectionFailure(productId, diagnostic, _editorSnapshot) {
    const record = diagnostic && typeof diagnostic === 'object'
        ? diagnostic
        : {};
    const cards = Array.isArray(record.cards)
        ? record.cards.filter((card) => (Boolean(card) && typeof card === 'object'))
        : [];
    const activeCard = cards.find((card) => String(card.text || '').includes('设置中'));
    const activeProductId = String(activeCard?.id || '').match(/\d{6,}/u)?.[0] || '';
    const requestedCard = cards.find((card) => String(card.id || '').includes(productId));
    const requestedStatus = String(requestedCard?.text || '').includes('已设置')
        ? '已设置'
        : String(requestedCard?.text || '').includes('未设置')
            ? '未设置'
            : '';
    const detail = activeProductId && activeProductId !== productId
        ? `页面仍停留在商品 ${activeProductId} 的“设置中”状态`
        : requestedStatus
            ? `该商品当前仍为“${requestedStatus}”状态`
            : '页面未返回该商品的选中状态';
    return `商品 ${productId} 未能打开 SKU 设置；${detail}。软件已自动重试且尚未提交活动，请重新执行任务。`
        .slice(0, 240);
}
function buildInternalPurchaseActivityShareDetailsExpression(activityName) {
    return `(() => {
    const activityName = ${JSON.stringify(activityName)};
    const title = Array.from(document.querySelectorAll('[class*="ActivityItem_title"]'))
      .find((element) => (element.textContent || '').trim() === activityName);
    const row = title?.closest('[class*="ActivityItem_activityItemContainer"]');
    if (!row) return null;
    const fiberKey = Object.keys(row).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? row[fiberKey] : null;
    while (fiber) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props?.title === activityName && props?.activityId) {
        return {
          activityId: String(props.activityId),
          activityTypeCode: String(props.activityTypeCode || 'SINGLE_TREASURE'),
          channelCode: String(props.channelCode || 'COMMON'),
          link: String(props.link || '')
        };
      }
      fiber = fiber.return;
    }
    return null;
  })()`;
}
function buildInternalPurchaseDeliveryUrl(details) {
    const activityId = details.activityId.trim();
    if (!/^\d+$/u.test(activityId))
        throw new Error('淘宝活动推广标识无效');
    const activityTypeCode = details.activityTypeCode.trim() || 'SINGLE_TREASURE';
    const channelCode = details.channelCode.trim() || 'COMMON';
    return `https://qn.taobao.com/home.html/private-domain-workbench/deliver/${encodeURIComponent(activityId)}`
        + `?benefitType=${encodeURIComponent(activityTypeCode)}&channelCode=${encodeURIComponent(channelCode)}`;
}
function buildInternalPurchaseQrDataUrlExpression() {
    return `(() => {
    const canvas = Array.from(document.querySelectorAll('canvas')).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      let card = candidate.parentElement;
      while (card && card !== document.body) {
        const cardText = (card.innerText || '').trim();
        if (
          cardText.includes('淘短链')
          && cardText.includes('获取分享链接/二维码')
          && rect.width >= 64
          && rect.height >= 64
          && rect.width <= 520
          && rect.height <= 520
          && Math.abs(rect.width - rect.height) <= 8
        ) {
          return true;
        }
        card = card.parentElement;
      }
      return false;
    });
    if (!canvas) return null;
    const dataUrl = canvas.toDataURL('image/png');
    return /^data:image\\/png;base64,/u.test(dataUrl) && dataUrl.length >= 500
      ? dataUrl
      : null;
  })()`;
}
function buildInternalPurchaseExposureStateExpression() {
    return `(() => {
    const labels = ['搜索透出', '首页关注频道'];
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const controlsIn = (root) => Array.from(root.querySelectorAll(
      'button[role="switch"], [role="switch"], button.next-switch, .next-switch, button[class*="switch"], button[class*="Switch"], input[type="checkbox"]'
    )).filter(visible);
    const findCard = (label) => {
      const heading = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, strong, div, span'))
        .filter(visible)
        .find((element) => (element.textContent || '').trim() === label);
      if (!heading) return null;
      let card = heading.parentElement;
      while (card && card !== document.body) {
        const cardText = (card.innerText || '').trim();
        const controls = controlsIn(card);
        if (cardText.includes(label) && controls.length > 0) {
          return { card, cardText, control: controls[0] };
        }
        card = card.parentElement;
      }
      return null;
    };
    return labels.map((label) => {
      const match = findCard(label);
      if (!match) {
        return { label, found: false, controlFound: false, disabled: false, closed: false };
      }
      const { cardText, control } = match;
      const ariaChecked = control.getAttribute('aria-checked');
      const input = control.matches('input[type="checkbox"]')
        ? control
        : control.querySelector('input[type="checkbox"]');
      const className = typeof control.className === 'string' ? control.className : '';
      const checked = ariaChecked === 'true'
        ? true
        : ariaChecked === 'false'
          ? false
          : input
            ? Boolean(input.checked)
            : /(?:^|[-_\\s])(checked|active|on)(?:$|[-_\\s])/iu.test(className)
              ? true
              : null;
      const closedByText = /已关闭推广|未推广/u.test(cardText);
      const openByText = /已开启推广|推广中|已开启投放/u.test(cardText);
      return {
        label,
        found: true,
        controlFound: true,
        disabled: Boolean(control.disabled || control.getAttribute('aria-disabled') === 'true'),
        closed: closedByText || (!openByText && checked === false)
      };
    });
  })()`;
}
function buildInternalPurchaseExposureSwitchResolver(label) {
    return `(() => {
    const label = ${JSON.stringify(label)};
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const controlsIn = (root) => Array.from(root.querySelectorAll(
      'button[role="switch"], [role="switch"], button.next-switch, .next-switch, button[class*="switch"], button[class*="Switch"], input[type="checkbox"]'
    )).filter(visible);
    const heading = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, strong, div, span'))
      .filter(visible)
      .find((element) => (element.textContent || '').trim() === label);
    if (!heading) return null;
    let card = heading.parentElement;
    while (card && card !== document.body) {
      const cardText = (card.innerText || '').trim();
      const controls = controlsIn(card);
      if (cardText.includes(label) && controls.length > 0) return controls[0];
      card = card.parentElement;
    }
    return null;
  })()`;
}
function buildInternalPurchaseExposureCloseConfirmationResolver() {
    return `Array.from(document.querySelectorAll('button')).find((element) => {
    const rect = element.getBoundingClientRect();
    const dialog = element.closest('[role="dialog"], [role="alertdialog"], .next-dialog');
    return element.innerText.trim() === '确定'
      && Boolean(dialog)
      && (dialog.innerText || '').includes('你是否确定关闭')
      && !element.disabled
      && rect.width > 0
      && rect.height > 0;
  })`;
}
function resolveInternalPurchaseProductAvailability(probe) {
    if (!probe)
        return { status: 'not-found' };
    if (!probe.disabled)
        return { status: 'selectable' };
    return { status: 'occupied', reason: probe.reason.trim() || '平台当前不支持选择' };
}
function resolveInternalPurchasePlatformSchedule(startsAt, endsAt, now = new Date()) {
    const requestedStart = new Date(startsAt);
    const requestedEnd = new Date(endsAt);
    if (!Number.isFinite(requestedStart.getTime())
        || !Number.isFinite(requestedEnd.getTime())
        || requestedEnd <= requestedStart) {
        throw new Error('结束时间必须晚于开始时间');
    }
    const minimumStart = resolveInternalPurchaseMinimumStart(now);
    if (requestedStart >= minimumStart) {
        return { adjusted: false, startsAt: requestedStart, endsAt: requestedEnd };
    }
    const duration = requestedEnd.getTime() - requestedStart.getTime();
    return {
        adjusted: true,
        startsAt: minimumStart,
        endsAt: new Date(minimumStart.getTime() + duration)
    };
}
function resolveInternalPurchaseFinalSubmitSchedule(startsAt, endsAt, now = new Date()) {
    const requestedStart = new Date(startsAt);
    const requestedEnd = new Date(endsAt);
    if (!Number.isFinite(requestedStart.getTime())
        || !Number.isFinite(requestedEnd.getTime())
        || requestedEnd <= requestedStart) {
        throw new Error('结束时间必须晚于开始时间');
    }
    const submitStart = resolveInternalPurchaseMinimumStart(now);
    const duration = requestedEnd.getTime() - requestedStart.getTime();
    return {
        adjusted: requestedStart.getTime() !== submitStart.getTime(),
        startsAt: submitStart,
        endsAt: new Date(submitStart.getTime() + duration)
    };
}
// 用户 2026-10-11：最终提交的开始时间由「当前 + 3 分钟」改为「当前 + 1 分钟」（向上取整到整分钟）。
function resolveInternalPurchaseMinimumStart(now) {
    const earliestStart = now.getTime() + 1 * 60_000;
    return new Date(Math.ceil(earliestStart / 60_000) * 60_000);
}
function shiftInternalPurchaseScheduleToCalendarDate(start, end, calendarDate) {
    const [year, month, day] = calendarDate.split('-').map(Number);
    if (!Number.isFinite(start.getTime())
        || !Number.isFinite(end.getTime())
        || end <= start
        || !Number.isInteger(year)
        || !Number.isInteger(month)
        || !Number.isInteger(day)) {
        throw new Error('无法按淘宝可选日期顺延活动时间');
    }
    const startsAt = new Date(start);
    startsAt.setFullYear(year, month - 1, day);
    if (startsAt.getFullYear() !== year
        || startsAt.getMonth() !== month - 1
        || startsAt.getDate() !== day) {
        throw new Error('淘宝返回的可选活动日期无效');
    }
    return {
        startsAt,
        endsAt: new Date(startsAt.getTime() + (end.getTime() - start.getTime()))
    };
}
function buildInternalPurchaseEarliestAvailableCalendarDateExpression(requestedDate) {
    return `(() => {
    const requestedDate = ${JSON.stringify(requestedDate)};
    const visibleCells = Array.from(document.querySelectorAll('td[title]'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return /^\\d{4}-\\d{2}-\\d{2}$/u.test(element.title || '')
          && rect.width > 0
          && rect.height > 0;
      });
    const requestedCell = visibleCells.find((element) => element.title === requestedDate);
    const isAvailable = (element) =>
      !element.classList.contains('next-disabled')
      && element.getAttribute('aria-disabled') !== 'true';
    if (visibleCells.some((element) => element.title === requestedDate && isAvailable(element))) {
      return requestedDate;
    }
    return visibleCells
      .filter((element) => isAvailable(element) && element.title > requestedDate)
      .map((element) => element.title)
      .sort()[0] || null;
  })()`;
}
function buildInternalPurchaseVisibleCalendarReadyExpression() {
    return `Array.from(document.querySelectorAll('td[title]'))
    .some((element) => {
      const rect = element.getBoundingClientRect();
      return /^\\d{4}-\\d{2}-\\d{2}$/u.test(element.title || '')
        && rect.width > 0
        && rect.height > 0;
    })`;
}
function buildInternalPurchaseCalendarDateStateExpression(date) {
    return `(() => {
    const cells = Array.from(document.querySelectorAll('td[title=${JSON.stringify(date)}]'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    if (cells.length === 0) return 'missing';
    return cells.some((element) =>
      !element.classList.contains('next-disabled')
      && element.getAttribute('aria-disabled') !== 'true'
    ) ? 'available' : 'disabled';
  })()`;
}
function buildInternalPurchaseProductCheckboxResolver(productId) {
    return `Array.from(document.querySelectorAll('input.next-checkbox-input'))
    .find((element) => element.value === ${JSON.stringify(productId)})`;
}
function buildInternalPurchaseProductResultStateExpression(productId) {
    return `(() => {
    const productId = ${JSON.stringify(productId)};
    const searchInput = document.querySelector('input[placeholder="搜索商品ID"]');
    if (!searchInput || searchInput.value.trim() !== productId) return 'pending';
    const checkbox = ${buildInternalPurchaseProductCheckboxResolver(productId)};
    if (checkbox) return 'found';
    const visibleChallenge = Array.from(document.querySelectorAll('iframe[src*="/punish"]'))
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    if (visibleChallenge) return 'challenge';
    const loadingResult = Array.from(document.querySelectorAll('div, span, p'))
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return (element.innerText || '').trim() === '加载中...'
          && rect.width > 0
          && rect.height > 0;
      });
    if (loadingResult) return 'loading';
    const emptyResult = Array.from(document.querySelectorAll('div, span, p'))
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return (element.innerText || '').trim() === '暂无宝贝，请去千牛发布商品'
          && rect.width > 0
          && rect.height > 0;
      });
    return emptyResult ? 'empty' : 'pending';
  })()`;
}
function buildInternalPurchaseSkuCenterSearchPanelResolver() {
    return `Array.from(document.querySelectorAll('button, [role="button"], a'))
    .find((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = (element.innerText || '').replace(/\\s+/gu, '');
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && /^(展开显示|展开搜索|展开筛选|更多筛选|展开)$/u.test(text);
    })`;
}
function buildInternalPurchaseSkuCenterBatchQueryExpression(productIds) {
    return `(async () => {
    const marker = 'SKU_CENTER_BATCH_QUERY';
    void marker;
    const requestedIds = ${JSON.stringify(productIds)};
    const batchSize = 20;
    const concurrency = 2;
    const request = window.lib?.mtop?.request;
    if (typeof request !== 'function') {
      throw new Error('SKU 管理页批量查询接口尚未加载');
    }
    const hasSecurityChallenge = () => Boolean(
      ${buildInternalPurchaseSecurityChallengeProbeExpression()}
    );
    const batches = [];
    for (let offset = 0; offset < requestedIds.length; offset += batchSize) {
      batches.push(requestedIds.slice(offset, offset + batchSize));
    }
    let queryStopped = false;
    const requestBatchOnce = async (batch) => {
      if (hasSecurityChallenge()) {
        throw new Error('淘宝返回访问被拒绝或安全验证，已停止所有批量查询');
      }
      let timeout;
      const response = await Promise.race([
        request({
          api: 'mtop.tmall.sell.pc.manage.async',
          v: '1.0',
          data: {
            url: '/tmall/manager/table.htm',
            jsonBody: JSON.stringify({
              tab: 'on_sale_skucenter',
              pagination: { current: 1, pageSize: batchSize },
              filtertab: '',
              filter: {
                from: 'qn_entry',
                curren: '',
                queryItemId: batch.join(',')
              },
              table: {}
            })
          }
        }),
        new Promise((_, reject) => { timeout = setTimeout(
          () => reject(new Error('SKU 管理页批量查询响应超时')),
          20_000
        ); })
      ]).finally(() => clearTimeout(timeout));
      if (hasSecurityChallenge()) {
        throw new Error('淘宝返回访问被拒绝或安全验证，已停止所有批量查询');
      }
      const retMessage = String(response?.ret?.[0] || '');
      if (retMessage && !/SUCCESS/iu.test(retMessage)) {
        throw new Error(retMessage);
      }
      const rawResult = response?.data?.result ?? response?.result;
      let result;
      try {
        result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
      } catch {
        throw new Error('SKU 管理页批量查询返回无法解析');
      }
      if (!result || result.success !== true) {
        const message = result?.msg?.globalMessage?.content
          || result?.msg?.globalMessage?.message
          || result?.msg?.globalMessage?.type
          || 'SKU 管理页批量查询失败';
        throw new Error(String(message));
      }
      const rows = Array.isArray(result?.data?.table?.dataSource)
        ? result.data.table.dataSource
        : [];
      return rows.map((row) => ({
        itemId: String(row?.itemId || ''),
        isOptional: true,
        isParticipatedItem: false,
        skuVOS: (Array.isArray(row?.skuList) ? row.skuList : [])
          .map((sku) => ({
            skuId: String(sku?.skuId || ''),
            price: sku?.price,
            props: sku?.props,
            quantity: sku?.quantity,
            status: sku?.status
          }))
          .filter((sku) => (
            /^\\d{6,30}$/u.test(sku.skuId)
            && sku.status === '上架'
          ))
      })).filter((product) => product.itemId && product.skuVOS.length > 0);
    };

    const requestBatch = async (batch) => {
      const retryDelays = [1_000, 2_500];
      for (let attempt = 0; ; attempt += 1) {
        if (queryStopped || hasSecurityChallenge()) {
          throw new Error('SKU 查询已停止，请检查登录或安全验证');
        }
        try {
          return await requestBatchOnce(batch);
        } catch (error) {
          const message = String(error?.data?.message || error?.ret?.[0] || error?.message || error);
          const blocked = /安全验证|访问拒绝|访问被拒绝|FAIL_SYS_USER_VALIDATE|RGV587_ERROR|登录|SESSION|TOKEN|ILLEGAL_ACCESS|限流|频繁|太快/iu.test(message);
          const transient = /超时|timeout|network|网络|ERR_CONNECTION|FAIL_SYS_SERVICE_FAULT|FAIL_SYS_SYSTEM_BUSY|系统繁忙|服务暂时不可用/iu.test(message);
          if (blocked || !transient || attempt >= retryDelays.length) {
            queryStopped = true;
            throw new Error(message);
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
        }
      }
    };
    const collected = [];
    for (let waveStart = 0; waveStart < batches.length; waveStart += concurrency) {
      const wave = batches.slice(waveStart, waveStart + concurrency);
      const waveResults = await Promise.all(wave.map((batch) => requestBatch(batch)));
      collected.push(...waveResults.flat());
      if (hasSecurityChallenge()) {
        throw new Error('淘宝返回访问被拒绝或安全验证，已停止所有批量查询');
      }
    }
    const byId = new Map(collected.map((product) => [product.itemId, product]));
    let missingIds = requestedIds.filter((id) => !byId.has(id));
    for (let retryAttempt = 0; retryAttempt < 2 && missingIds.length > 0; retryAttempt += 1) {
      for (let waveStart = 0; waveStart < missingIds.length; waveStart += concurrency) {
        const wave = missingIds.slice(waveStart, waveStart + concurrency);
        const waveResults = await Promise.all(wave.map((id) => requestBatch([id])));
        for (const product of waveResults.flat()) {
          byId.set(product.itemId, product);
        }
        if (hasSecurityChallenge()) {
          throw new Error('淘宝返回访问被拒绝或安全验证，已停止所有批量查询');
        }
      }
      missingIds = requestedIds.filter((id) => !byId.has(id));
    }
    return requestedIds.map((id) => byId.get(id)).filter(Boolean);
  })()`;
}
function buildInternalPurchaseSkuCenterSearchInputResolver() {
    return `(() => {
    const fieldLabel = '商品ID';
    void fieldLabel;
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < innerHeight
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };
    const inputs = Array.from(document.querySelectorAll('input'))
      .filter((element) => visible(element) && element.type !== 'hidden');
    return inputs.find((element) => {
      const hint = [
        element.placeholder || '',
        element.getAttribute('aria-label') || '',
        element.getAttribute('name') || ''
      ].join(' ');
      return /多个\\s*ID|商品\\s*(?:ID|Id|id)|宝贝\\s*(?:ID|Id|id)|queryItemId/iu.test(hint);
    }) || null;
  })()`;
}
function buildInternalPurchaseSkuCenterSearchButtonResolver() {
    return `(() => {
    const input = ${buildInternalPurchaseSkuCenterSearchInputResolver()};
    if (!input) return null;
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < innerHeight
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };
    const scope = input.closest('form, [role="form"], section, [class*="search"], [class*="filter"]')
      || document;
    return Array.from(scope.querySelectorAll('button, [role="button"], a'))
      .find((element) => (
        visible(element)
        && /^(搜索|查询)$/u.test((element.innerText || '').trim())
      )) || null;
  })()`;
}
function buildInternalPurchaseSkuCenterProductExpandResolver(productId) {
    return `(() => {
    const productId = ${JSON.stringify(productId)};
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < innerHeight
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };
    const candidates = Array.from(document.querySelectorAll('tr, [role="row"], article, li, section, div'))
      .filter((element) => {
        if (!visible(element)) return false;
        const text = (element.innerText || '').replace(/\\s+/gu, ' ');
        return text.includes(productId) && text.length < 4_000;
      })
      .sort((left, right) => (
        (left.innerText || '').length - (right.innerText || '').length
      ));
    for (const scope of candidates) {
      const control = Array.from(scope.querySelectorAll('button, [role="button"], a'))
        .find((element) => (
          visible(element)
          && /^(展开显示|展开|查看SKU|SKU详情)$/iu.test(
            (element.innerText || '').replace(/\\s+/gu, '')
          )
        ));
      if (control) return control;
    }
    return null;
  })()`;
}
function buildInternalPurchaseSkuCenterScrollableResolver(productId) {
    return `(() => {
    const productId = ${JSON.stringify(productId)};
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < innerHeight
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };
    const findScrollableAncestor = (anchor) => {
      let current = anchor;
      while (current && current !== document.body) {
        if (visible(current)) {
          const style = getComputedStyle(current);
          if (
            /(auto|scroll)/u.test(style.overflowY)
            && current.scrollHeight > current.clientHeight + 2
          ) {
            return current;
          }
        }
        current = current.parentElement;
      }
      return null;
    };
    const skuAnchor = Array.from(document.querySelectorAll(
      'th, td, [role="columnheader"], [role="cell"], [role="gridcell"], p, span, div'
    ))
      .filter((element) => {
        if (!visible(element)) return false;
        const text = (element.innerText || '').replace(/\\s+/gu, ' ').trim();
        return text === 'SKU信息'
          || (text.length < 300 && /(?:^|\\s)ID\\s*[:：]\\s*\\d{6,30}/u.test(text));
      })
      .sort((left, right) => (
        (left.innerText || '').length - (right.innerText || '').length
      ))[0];
    const skuScrollable = findScrollableAncestor(skuAnchor);
    if (skuScrollable) return skuScrollable;
    const productNode = Array.from(document.querySelectorAll('td, [role="cell"], p, span, div'))
      .filter((element) => (
        visible(element)
        && (element.innerText || '').trim().includes(productId)
      ))
      .sort((left, right) => (
        (left.innerText || '').length - (right.innerText || '').length
      ))[0];
    return findScrollableAncestor(productNode)
      || document.scrollingElement
      || document.documentElement;
  })()`;
}
function buildInternalPurchaseSkuCenterResultStateExpression(productId) {
    return `(() => {
    const marker = 'SKU_CENTER_RESULT';
    void marker;
    const productId = ${JSON.stringify(productId)};
    const challenge = ${buildInternalPurchaseSecurityChallengeProbeExpression()};
    if (challenge) return 'challenge';
    const input = ${buildInternalPurchaseSkuCenterSearchInputResolver()};
    if (!input || input.value.trim() !== productId) return 'pending';
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < innerHeight
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };
    const fragments = Array.from(document.querySelectorAll(
      'div, td, th, [role="cell"], [role="gridcell"], p, span, button, a'
    ))
      .filter(visible)
      .map((element) => (element.innerText || '').replace(/\\s+/gu, ' ').trim())
      .filter(Boolean);
    if (fragments.some((text) => text.includes(productId))) return 'found';
    if (fragments.some((text) => /加载中|正在加载|查询中/u.test(text))) return 'loading';
    if (fragments.some((text) => /暂无数据|暂无商品|没有找到|未查询到|搜索无结果/u.test(text))) {
      return 'empty';
    }
    return 'pending';
  })()`;
}
function buildInternalPurchaseSkuCenterVisibleSkuStateExpression(productId) {
    return `(() => {
    const marker = 'SKU_CENTER_VISIBLE_SKUS';
    void marker;
    const productId = ${JSON.stringify(productId)};
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < innerHeight
        && rect.right > 0
        && rect.left < innerWidth
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && style.opacity !== '0';
    };
    const scrollTarget = ${buildInternalPurchaseSkuCenterScrollableResolver(productId)};
    const visibleSkuIds = [];
    const seen = new Set();
    const addSku = (value) => {
      const normalized = String(value || '').trim();
      if (!/^\\d{6,30}$/u.test(normalized) || normalized === productId || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      visibleSkuIds.push(normalized);
    };
    const visibleElements = Array.from(document.querySelectorAll(
      'tr, [role="row"], td, th, [role="cell"], [role="gridcell"], p, span'
    )).filter(visible);
    const visibleFragments = visibleElements
      .filter((element) => (
        element.children.length === 0
        || /^(TD|TH|TR)$/u.test(element.tagName)
        || element.getAttribute('role') === 'row'
        || element.getAttribute('role') === 'cell'
        || element.getAttribute('role') === 'gridcell'
      ))
      .map((element) => (element.innerText || '').replace(/\\s+/gu, ' ').trim())
      .filter(Boolean);

    for (const text of visibleFragments) {
      for (const match of text.matchAll(/SKU\\s*(?:_?ID|编号)?\\s*[:：]?\\s*(\\d{6,30})/giu)) {
        addSku(match[1]);
      }
      for (const match of text.matchAll(/(?:^|\\s)ID\\s*[:：]\\s*(\\d{6,30})/giu)) {
        addSku(match[1]);
      }
      if (/^\\d{14,30}$/u.test(text)) addSku(text);
    }
    for (const table of Array.from(document.querySelectorAll('table, [role="table"], [role="grid"]'))) {
      if (!visible(table)) continue;
      const rows = Array.from(table.querySelectorAll('tr, [role="row"]')).filter(visible);
      const header = rows.find((row) => (
        /SKU\\s*(?:_?ID|编号)?/iu.test((row.innerText || '').replace(/\\s+/gu, ' '))
      ));
      if (!header) continue;
      const headerCells = Array.from(header.querySelectorAll(
        'th, td, [role="columnheader"], [role="cell"], [role="gridcell"]'
      )).filter(visible);
      const skuColumn = headerCells.findIndex((cell) => (
        /SKU\\s*(?:_?ID|编号)?/iu.test((cell.innerText || '').replace(/\\s+/gu, ' '))
      ));
      if (skuColumn < 0) continue;
      for (const row of rows) {
        if (row === header) continue;
        const cells = Array.from(row.querySelectorAll(
          'td, [role="cell"], [role="gridcell"]'
        )).filter(visible);
        addSku(cells[skuColumn]?.innerText || '');
      }
    }
    let expectedSkuCount = 0;
    for (const text of visibleFragments) {
      const count = text.match(
        /(?:共\\s*(\\d{1,4})\\s*(?:个|条)\\s*SKU|SKU\\s*(?:数|数量|总数)\\s*[:：]\\s*(\\d{1,4}))/iu
      );
      if (count) expectedSkuCount = Math.max(expectedSkuCount, Number(count[1] || count[2] || 0));
    }
    const scrollTop = Number(scrollTarget?.scrollTop || 0);
    const scrollHeight = Number(scrollTarget?.scrollHeight || 0);
    const clientHeight = Number(scrollTarget?.clientHeight || innerHeight || 0);
    return {
      visibleSkuIds,
      expectedSkuCount,
      scrollTop,
      scrollHeight,
      clientHeight,
      atBottom: scrollHeight <= clientHeight + 2
        || scrollTop + clientHeight >= scrollHeight - 2
    };
  })()`;
}
function buildInternalPurchaseLoginPageProbeExpression() {
    return `(() => {
    const selectors = [
      '#alibaba-login-box',
      '#fm-login-id',
      '#fm-login-password',
      'form[action*="login"]'
    ];
    const containsLoginForm = (root) => selectors.some((selector) => Boolean(root.querySelector(selector)));
    if (containsLoginForm(document)) return true;
    return Array.from(document.querySelectorAll('iframe')).some((frame) => {
      try {
        return Boolean(frame.contentDocument) && containsLoginForm(frame.contentDocument);
      } catch {
        return false;
      }
    });
  })()`;
}
function buildInternalPurchaseProductProbeExpression(productId) {
    return `(() => {
    const id = ${JSON.stringify(productId)};
    const checkbox = ${buildInternalPurchaseProductCheckboxResolver(productId)};
    if (!checkbox) return null;
    const label = checkbox.closest('label');
    const text = (label?.innerText || '').trim();
    const skuMatch = text.match(/SKU\\s+(\\d+)/u);
    const title = text.split('\\n').find((line) => line && !/^SKU\\s/u.test(line) && line !== '不支持选择' && !line.startsWith('ID ')) || id;
    return { disabled: checkbox.disabled, reason: text.includes('不支持选择') ? '已在其他活动中使用' : '', title, skuCount: Number(skuMatch?.[1] || 0) };
  })()`;
}
function buildInternalPurchaseSelectedSkuProductsExpression(productIds) {
    return `(() => {
    const orderedIds = ${JSON.stringify(productIds)};
    const expectedIds = new Set(orderedIds);
    const products = new Map();
    const visitedValues = new WeakSet();
    let visitedCount = 0;

    const normalizeSku = (sku) => {
      const skuId = sku?.skuId ?? sku?.id ?? sku?.skuID;
      if (skuId == null || !/^\\d+$/u.test(String(skuId))) return null;
      return {
        skuId: String(skuId),
        ...(sku?.price != null ? { price: sku.price } : {}),
        ...(sku?.props != null ? { props: String(sku.props) } : {}),
        ...(sku?.quantity != null ? { quantity: sku.quantity } : {})
      };
    };
    const collectProduct = (value) => {
      if (!value || typeof value !== 'object') return;
      const itemId = value.itemId ?? value.itemID ?? value.id;
      const id = itemId == null ? '' : String(itemId);
      if (!expectedIds.has(id)) return;
      const rawSkus = value.skuVOS
        ?? value.skusVOs
        ?? value.skuVOs
        ?? value.skuList
        ?? value.skuListVO;
      if (!Array.isArray(rawSkus)) return;
      const skuVOS = rawSkus.map(normalizeSku).filter(Boolean);
      if (skuVOS.length === 0) return;
      const current = products.get(id);
      if (!current || current.skuVOS.length < skuVOS.length) {
        products.set(id, {
          itemId: id,
          title: String(value.title ?? value.itemTitle ?? value.shortTitle ?? id),
          shortTitle: String(value.shortTitle ?? ''),
          isOptional: true,
          isParticipatedItem: false,
          skuVOS
        });
      }
    };
    const scanValue = (rootValue) => {
      const queue = [{ value: rootValue, depth: 0 }];
      while (queue.length > 0 && visitedCount < 30_000) {
        const current = queue.shift();
        const value = current?.value;
        const depth = current?.depth ?? 0;
        if (!value || typeof value !== 'object') continue;
        if (value.nodeType || value === window || value === document) continue;
        if (visitedValues.has(value)) continue;
        visitedValues.add(value);
        visitedCount += 1;
        collectProduct(value);
        collectProduct(value.goodsItemData);
        if (depth >= 6) continue;
        if (Array.isArray(value)) {
          value.forEach((entry) => queue.push({ value: entry, depth: depth + 1 }));
          continue;
        }
        if (value instanceof Map || value instanceof Set) {
          Array.from(value.values()).forEach((entry) => queue.push({ value: entry, depth: depth + 1 }));
          continue;
        }
        for (const [key, entry] of Object.entries(value)) {
          if (
            ['return', 'child', 'sibling', 'stateNode', '_owner'].includes(key)
            || typeof entry === 'function'
          ) continue;
          queue.push({ value: entry, depth: depth + 1 });
        }
      }
    };

    const roots = Array.from(document.querySelectorAll(
      '[class*="GoodsSwitchPicker--goodsPickerNew"], '
        + '[class*="GoodsPickerNew--goodsPickerNew"], '
        + '[class*="GoodsCardList--skuGoodsId"], '
        + '[class*="skuGoodsDialog"]'
    ));
    for (const root of roots) {
      const fiberKey = Object.getOwnPropertyNames(root)
        .find((key) => key.startsWith('__reactFiber$'));
      let fiber = fiberKey ? root[fiberKey] : null;
      const visitedFibers = new Set();
      while (fiber && !visitedFibers.has(fiber)) {
        visitedFibers.add(fiber);
        for (const candidate of [fiber, fiber.alternate].filter(Boolean)) {
          const props = candidate.memoizedProps || candidate.pendingProps;
          scanValue(props);
          let hook = candidate.memoizedState;
          let hookCount = 0;
          while (hook && hookCount < 40) {
            scanValue(hook.memoizedState);
            hook = hook.next;
            hookCount += 1;
          }
        }
        fiber = fiber.return;
      }
    }
    return orderedIds.map((id) => products.get(id)).filter(Boolean);
  })()`;
}
function buildInternalPurchaseSkuIdListExpression() {
    return `Array.from(document.querySelectorAll('[class*="SKUTable--skuGoodsId"]'))
    .map((element) => (element.innerText || '').replace(/^ID\\s+/u, '').trim())
    .filter(Boolean)`;
}
function buildInternalPurchaseSkuVirtualListStateExpression(action = 'read') {
    return `(() => {
    const action = ${JSON.stringify(action)};
    const readSkuIds = () => Array.from(
      document.querySelectorAll('[class*="SKUTable--skuGoodsId"]')
    )
      .map((element) => (element.innerText || '').replace(/^ID\\s+/u, '').trim())
      .filter(Boolean);
    const skuIdElement = document.querySelector('[class*="SKUTable--skuGoodsId"]');
    const tableBodies = Array.from(document.querySelectorAll('.next-table-body'));
    let scrollContainer = tableBodies.find((element) => (
      element.querySelector('[class*="SKUTable--skuGoodsId"]')
      && element.scrollHeight > element.clientHeight + 2
    ));
    let ancestor = skuIdElement?.parentElement;
    while (!scrollContainer && ancestor && ancestor !== document.body) {
      if (ancestor.scrollHeight > ancestor.clientHeight + 2) {
        scrollContainer = ancestor;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    const dialog = Array.from(document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], .next-dialog'
    )).find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && /全选SKU[（(]\\d+[）)]/u.test(element.innerText || '');
    });
    const totalMatch = (dialog?.innerText || document.body.innerText || '')
      .match(/全选SKU[（(](\\d+)[）)]/u);
    const totalSkuCount = Number(totalMatch?.[1] || 0);
    if (scrollContainer && action !== 'read') {
      const maxScrollTop = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight
      );
      scrollContainer.scrollTop = action === 'top'
        ? 0
        : Math.min(
          maxScrollTop,
          scrollContainer.scrollTop + Math.max(scrollContainer.clientHeight * 0.7, 120)
        );
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    const scrollTop = Number(scrollContainer?.scrollTop || 0);
    const scrollHeight = Number(scrollContainer?.scrollHeight || 0);
    const clientHeight = Number(scrollContainer?.clientHeight || 0);
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    return {
      visibleSkuIds: readSkuIds(),
      totalSkuCount,
      scrollTop,
      scrollHeight,
      clientHeight,
      atBottom: !scrollContainer || scrollTop >= maxScrollTop - 2
    };
  })()`;
}
function buildInternalPurchaseSkuProductCardResolver(productId) {
    return `(() => {
    const id = Array.from(document.querySelectorAll('[class*="GoodsCardList--skuGoodsId"]'))
      .find((element) => element.textContent.trim() === ${JSON.stringify(`ID ${productId}`)});
    let card = id;
    while (card && card !== document.body) {
      if (
        card.querySelectorAll('[class*="GoodsCardList--skuGoodsId"]').length === 1
        && (
          card.innerText.includes('已设置')
          || card.innerText.includes('未设置')
          || card.innerText.includes('设置中')
        )
      ) {
        return card;
      }
      card = card.parentElement;
    }
    return id || null;
  })()`;
}
function buildInternalPurchaseSkuProductTriggerResolver(productId) {
    return `Array.from(document.querySelectorAll('[class*="GoodsCardList--skuGoodsId"]'))
    .find((element) => element.textContent.trim() === ${JSON.stringify(`ID ${productId}`)})`;
}
function buildInternalPurchaseSkuProductClickableResolver(productId) {
    return `(() => {
    const card = ${buildInternalPurchaseSkuProductCardResolver(productId)};
    let target = card;
    while (target && target !== document.body) {
      const propsKey = Object.getOwnPropertyNames(target)
        .find((key) => key.startsWith('__reactProps$'));
      const props = propsKey ? target[propsKey] : null;
      if (typeof props?.onClick === 'function') return target;
      target = target.parentElement;
    }
    return card || null;
  })()`;
}
function buildInternalPurchaseSkuProductActivationExpression(productId) {
    return `(() => {
    const id = ${buildInternalPurchaseSkuProductTriggerResolver(productId)};
    const card = ${buildInternalPurchaseSkuProductCardResolver(productId)};
    const createClickEvent = (target) => {
      const rect = target.getBoundingClientRect();
      const nativeEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0
      });
      let defaultPrevented = false;
      let propagationStopped = false;
      return {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: nativeEvent.clientX,
        clientY: nativeEvent.clientY,
        currentTarget: target,
        target,
        nativeEvent,
        type: 'click',
        get defaultPrevented() {
          return defaultPrevented;
        },
        isDefaultPrevented: () => defaultPrevented,
        isPropagationStopped: () => propagationStopped,
        persist: () => undefined,
        preventDefault: () => {
          defaultPrevented = true;
          nativeEvent.preventDefault();
        },
        stopPropagation: () => {
          propagationStopped = true;
          nativeEvent.stopPropagation();
        }
      };
    };
    let target = card;
    while (target && target !== document.body) {
      const propsKey = Object.getOwnPropertyNames(target)
        .find((key) => key.startsWith('__reactProps$'));
      const currentProps = propsKey ? target[propsKey] : null;
      if (typeof currentProps?.onClick === 'function') {
        try {
          const clickEvent = createClickEvent(target);
          currentProps.onClick(clickEvent);
          return true;
        } catch {
          break;
        }
      }
      target = target.parentElement;
    }
    const fiberKey = Object.getOwnPropertyNames(card || id || {})
      .find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (card || id)[fiberKey] : null;
    const isCurrentFiber = (candidate) => {
      let root = candidate;
      while (root?.return) root = root.return;
      return root.stateNode?.current === root;
    };
    while (fiber) {
      const candidates = [fiber, fiber.alternate].filter(Boolean);
      let invoked = false;
      const rowClickCandidates = candidates
        .map((candidate) => ({ candidate, props: candidate.memoizedProps || {} }))
        .filter(({ props }) => (
          typeof props.handleRowClick === 'function'
          && Number(props.goodsItemData?.itemId) === Number(${JSON.stringify(productId)})
        ))
        .map(({ candidate, props }) => ({
          props,
          isCurrent: isCurrentFiber(candidate),
          configuredCount: Array.from(props.goodsMapState?.values?.() || [])
            .filter((state) => state === '已设置').length
        }))
        .sort((left, right) => (
          Number(right.isCurrent) - Number(left.isCurrent)
          || right.configuredCount - left.configuredCount
        ));
      const rowClick = rowClickCandidates[0]?.props;
      if (rowClick) {
        rowClick.handleRowClick(
          rowClick.goodsItemData.itemId,
          rowClick.goodsMapState,
          rowClick.isSelected
        );
        invoked = true;
      }
      if (invoked) return true;
      for (const candidate of candidates) {
        const props = candidate.memoizedProps || {};
        if (
          typeof props.onClick === 'function'
          && String(props.className || '').includes('GoodsCardList--skuGoods--')
        ) {
          props.onClick();
          invoked = true;
          break;
        }
      }
      if (invoked) return true;
      fiber = fiber.return;
    }
    return false;
  })()`;
}
function buildInternalPurchaseSkuProductOrderExpression(productIds) {
    return `(() => {
    const expectedIds = new Set(${JSON.stringify(productIds)});
    return Array.from(document.querySelectorAll('[class*="GoodsCardList--skuGoodsId"]'))
      .map((element) => element.textContent.trim().replace(/^ID\\s+/u, ''))
      .filter((id, index, ids) => expectedIds.has(id) && ids.indexOf(id) === index);
  })()`;
}
function buildInternalPurchaseSkuProductSelectionExpression(productId) {
    return `(() => {
    const card = ${buildInternalPurchaseSkuProductCardResolver(productId)};
    if (!card) return false;
    const text = (card.innerText || '').trim();
    if (text.includes('设置中')) return true;
    const fiberKey = Object.getOwnPropertyNames(card)
      .find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? card[fiberKey] : null;
    while (fiber) {
      const candidates = [fiber, fiber.alternate].filter(Boolean);
      for (const candidate of candidates) {
        const props = candidate.memoizedProps || {};
        if (props.isSelected === true) return true;
        if (Number(props.selectedGoodsId) === Number(${JSON.stringify(productId)})) return true;
      }
      fiber = fiber.return;
    }
    const selectedElement = card.matches(
      '[aria-current="true"], [aria-selected="true"], [data-active="true"], [data-selected="true"]'
    )
      ? card
      : card.querySelector(
        '[aria-current="true"], [aria-selected="true"], [data-active="true"], [data-selected="true"]'
      );
    if (selectedElement) return true;
    const className = String(card.className || '');
    return /(?:^|\\s)(?:active|selected)(?:\\s|$)/iu.test(className);
  })()`;
}
function buildInternalPurchaseSkuProductSelectionDiagnosticExpression(productId) {
    return `(() => {
    const id = ${buildInternalPurchaseSkuProductTriggerResolver(productId)};
    const card = ${buildInternalPurchaseSkuProductCardResolver(productId)};
    const cards = Array.from(document.querySelectorAll('[class*="GoodsCardList--skuGoodsId"]'))
      .map((element) => {
        const resolvedCard = (() => {
          let candidate = element;
          while (candidate && candidate !== document.body) {
            if (
              candidate.querySelectorAll('[class*="GoodsCardList--skuGoodsId"]').length === 1
              && /已设置|未设置|设置中/u.test(candidate.innerText || '')
            ) return candidate;
            candidate = candidate.parentElement;
          }
          return element;
        })();
        return {
          id: element.textContent.trim(),
          className: String(resolvedCard.className || ''),
          text: (resolvedCard.innerText || '').trim().slice(0, 300)
        };
      });
    const ancestors = [];
    let target = card || id;
    while (target && target !== document.body && ancestors.length < 10) {
      const propsKeys = Object.getOwnPropertyNames(target)
        .filter((key) => key.startsWith('__reactProps$'));
      const handlerKeys = propsKeys.flatMap((key) => Object.keys(target[key] || {})
        .filter((propKey) => /^on[A-Z]/u.test(propKey) && typeof target[key]?.[propKey] === 'function'));
      const handlerSources = Object.fromEntries(propsKeys.flatMap((key) =>
        Object.entries(target[key] || {})
          .filter(([propKey, value]) => /^on[A-Z]/u.test(propKey) && typeof value === 'function')
          .map(([propKey, value]) => [propKey, String(value).slice(0, 1_000)])
      ));
      ancestors.push({
        tagName: target.tagName,
        className: String(target.className || ''),
        role: target.getAttribute?.('role') || '',
        ariaCurrent: target.getAttribute?.('aria-current') || '',
        ariaSelected: target.getAttribute?.('aria-selected') || '',
        handlerKeys,
        handlerSources
      });
      target = target.parentElement;
    }
    const summarize = (value, depth = 0) => {
      if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
      if (typeof value === 'function') return '[function]';
      if (value instanceof Map) {
        return { map: Array.from(value.entries()).slice(0, 20)
          .map(([key, entry]) => [summarize(key, depth + 1), summarize(entry, depth + 1)]) };
      }
      if (value instanceof Set) {
        return { set: Array.from(value.values()).slice(0, 20)
          .map((entry) => summarize(entry, depth + 1)) };
      }
      if (Array.isArray(value)) {
        return value.slice(0, 20).map((entry) => summarize(entry, depth + 1));
      }
      if (depth >= 2) return Object.prototype.toString.call(value);
      const result = {};
      for (const [key, entry] of Object.entries(value).slice(0, 30)) {
        if (key === 'return' || key === 'child' || key === 'sibling' || key === 'stateNode') continue;
        result[key] = summarize(entry, depth + 1);
      }
      return result;
    };
    const fiberState = [];
    const fiberKey = Object.getOwnPropertyNames(card || id || {})
      .find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (card || id)[fiberKey] : null;
    while (fiber && fiberState.length < 16) {
      const hooks = [];
      let hook = fiber.memoizedState;
      while (hook && hooks.length < 24) {
        hooks.push(summarize(hook.memoizedState));
        hook = hook.next;
      }
      const component = fiber.elementType?.displayName
        || fiber.elementType?.name
        || fiber.type?.displayName
        || fiber.type?.name
        || String(fiber.elementType || fiber.type || '');
      if (hooks.length > 0 || component) {
        fiberState.push({
          component,
          hooks,
          props: summarize(fiber.memoizedProps)
        });
      }
      fiber = fiber.return;
    }
    return {
      requestedProductId: ${JSON.stringify(productId)},
      cards,
      ancestors,
      fiberState,
      visibleSkuIds: Array.from(document.querySelectorAll('[class*="SKUTable--skuGoodsId"]'))
        .map((element) => element.textContent.trim())
    };
  })()`;
}
function buildInternalPurchaseSkuDiscountInputResolver(skuId) {
    return `(() => {
    const skuIdElement = Array.from(document.querySelectorAll('[class*="SKUTable--skuGoodsId"]'))
      .find((element) => element.textContent.trim() === ${JSON.stringify(`ID ${skuId}`)});
    const visibleDiscountInputs = (container) => Array.from(container.querySelectorAll('input'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return !element.disabled &&
          ['text', 'number'].includes(element.type) &&
          rect.width > 0 &&
          rect.height > 0;
      });
    let container = skuIdElement?.parentElement;
    while (container && container !== document.body) {
      const inputs = visibleDiscountInputs(container);
      if (inputs.length > 0) return inputs[inputs.length - 1];
      container = container.parentElement;
    }
    return null;
  })()`;
}
function buildInternalPurchaseSkuDiscountCommitExpression(skuId, discount) {
    return `(() => {
    const element = ${buildInternalPurchaseSkuDiscountInputResolver(skuId)};
    if (!element) return false;
    const fiberKey = Object.getOwnPropertyNames(element)
      .find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? element[fiberKey] : null;
    while (fiber) {
      const component = fiber.elementType?.displayName
        || fiber.elementType?.name
        || fiber.type?.displayName
        || fiber.type?.name
        || '';
      const props = fiber.memoizedProps || {};
      if (String(component) === 'NumberPicker' && typeof props.onChange === 'function') {
        props.onChange(${JSON.stringify(discount)});
        return true;
      }
      fiber = fiber.return;
    }
    return false;
  })()`;
}
function buildInternalPurchaseSkuStageExpression() {
    return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const productRows = Array.from(document.querySelectorAll(
      '[class*="GoodsCardList--skuGoodsId"], [class*="SKUTable--skuGoodsId"]'
    ));
    const batchButton = Array.from(document.querySelectorAll('button'))
      .find((element) => ['批量操作', '批量设置'].includes(element.innerText.trim()) && isVisible(element));
    const discountInput = Array.from(document.querySelectorAll('input'))
      .find((element) => {
        const hint = [element.placeholder, element.getAttribute('aria-label')]
          .filter(Boolean)
          .join(' ');
        return hint.includes('折扣') && isVisible(element);
      });
    return productRows.some(isVisible) || Boolean(batchButton) || Boolean(discountInput);
  })()`;
}
function buildInternalPurchaseSkuEditorDialogExpression() {
    return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    return Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((element) => (
        isVisible(element)
        && (element.innerText || '').includes('设置优惠方式')
      )) || null;
  })()`;
}
function buildInternalPurchaseSkuEditorCloseResolver() {
    return `(() => {
    const dialog = ${buildInternalPurchaseSkuEditorDialogExpression()};
    if (!dialog) return null;
    const dialogRect = dialog.getBoundingClientRect();
    const buttons = Array.from(dialog.querySelectorAll('button'));
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const namedCloseButton = buttons.find((element) => {
      const label = [
        element.innerText,
        element.getAttribute('aria-label'),
        element.getAttribute('title')
      ].filter(Boolean).join(' ').trim();
      return !element.disabled && isVisible(element) && label.includes('关闭');
    });
    if (namedCloseButton) return namedCloseButton;
    return buttons.find((element) => {
      const rect = element.getBoundingClientRect();
      const text = (element.innerText || '').trim();
      return !element.disabled
        && isVisible(element)
        && rect.top <= dialogRect.top + 84
        && rect.right >= dialogRect.right - 96
        && text.length <= 2;
    }) || null;
  })()`;
}
function buildInternalPurchaseSkuEditorCompletedExpression() {
    return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const buttons = Array.from(document.querySelectorAll('button'));
    const finishButton = buttons
      .find((element) => element.innerText.trim() === '完成' && isVisible(element));
    const createButton = buttons
      .find((element) => element.innerText.trim() === '创建' && !element.disabled && isVisible(element));
    return !finishButton && Boolean(createButton);
  })()`;
}
function buildInternalPurchaseVisibleBatchUploadStateExpression(expectedSkuCount) {
    return `(() => {
    const expectedSkuCount = ${Math.max(0, Math.floor(expectedSkuCount))};
    const bodyText = (document.body?.innerText || '').replace(/\\s+/gu, ' ');
    const challenge = ${buildInternalPurchaseSecurityChallengeProbeExpression()};
    if (challenge) {
      return {
        status: 'challenge',
        successfulSkuCount: 0,
        failedSkuCount: 0,
        detail: '淘宝返回访问被拒绝或安全验证'
      };
    }
    const matchCount = (patterns) => {
      for (const pattern of patterns) {
        const match = bodyText.match(pattern);
        if (match) return Number(match[1] || 0);
      }
      return null;
    };
    const successfulSkuCount = matchCount([
      /(\\d+)\\s*条\\s*(?:导入)?成功/u,
      /(?:导入成功|成功导入|成功)\\s*[:：]?\\s*(\\d+)\\s*条/u,
      /全部导入成功[^\\d]{0,12}(\\d+)\\s*条/u
    ]);
    const failedSkuCount = matchCount([
      /(\\d+)\\s*条\\s*(?:导入)?失败/u,
      /(?:导入失败|失败导入|失败)\\s*[:：]?\\s*(\\d+)\\s*条/u
    ]);
    if (successfulSkuCount !== null || failedSkuCount !== null) {
      const succeeded = successfulSkuCount || 0;
      const failed = failedSkuCount || 0;
      if (failed > 0) {
        return {
          status: 'failed',
          successfulSkuCount: succeeded,
          failedSkuCount: failed,
          detail: succeeded + ' 条导入成功，'
            + failed + ' 条导入失败'
        };
      }
      if (succeeded === expectedSkuCount) {
        return {
          status: 'completed',
          successfulSkuCount: succeeded,
          failedSkuCount: 0,
          detail: succeeded + ' 条 SKU 已通过淘宝页面校验'
        };
      }
      return {
        status: 'validating',
        successfulSkuCount: succeeded,
        failedSkuCount: 0,
        detail: '淘宝已校验 ' + succeeded + '/' + expectedSkuCount + ' 条 SKU'
      };
    }
    const visibleError = Array.from(document.querySelectorAll(
      '[role="alert"], [role="alertdialog"], .next-message-error, [class*="error"], [class*="Error"]'
    )).find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && /导入失败|校验失败|上传失败|文件格式错误|sku不存在/iu.test(
          element.innerText || ''
        );
    });
    if (visibleError) {
      return {
        status: 'failed',
        successfulSkuCount: 0,
        failedSkuCount: 0,
        detail: (visibleError.innerText || '').trim()
      };
    }
    const fileInput = document.querySelector('input[type="file"]');
    const hasSelectedFile = Boolean(fileInput?.files?.length)
      || /\\.xlsx\\s*\\([\\d.]+\\s*[KMG]?\\)/iu.test(bodyText);
    return {
      status: hasSelectedFile ? 'validating' : 'waiting',
      successfulSkuCount: 0,
      failedSkuCount: 0,
      detail: hasSelectedFile
        ? '淘宝页面正在上传并校验 SKU 表格'
        : '等待把本地 SKU 表格放入页面文件输入框'
    };
  })()`;
}
function buildInternalPurchaseSkuFinishReadyExpression() {
    return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const finishButton = Array.from(document.querySelectorAll('button'))
      .find((element) => (
        element.innerText.trim() === '完成'
        && !element.disabled
        && isVisible(element)
      ));
    if (!finishButton) return false;
    const cards = Array.from(
      document.querySelectorAll('[class*="GoodsCardList--skuGoodsId"]')
    ).map((idElement) => {
      let card = idElement;
      while (card && card !== document.body) {
        if (
          card.querySelectorAll('[class*="GoodsCardList--skuGoodsId"]').length === 1
          && /已设置|未设置|设置中/u.test(card.innerText || '')
        ) {
          return card;
        }
        card = card.parentElement;
      }
      return idElement;
    });
    return cards.length > 0 && cards.every((card) => (
      !card.innerText.includes('未设置')
      && !card.innerText.includes('设置中')
    ));
  })()`;
}
function buildInternalPurchaseSkuRiskConfirmationResolver() {
    return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return !element.disabled && rect.width > 0 && rect.height > 0;
    };
    const dialog = Array.from(document.querySelectorAll(
      '[role="alertdialog"], [role="dialog"], .next-dialog'
    )).find((element) => isVisible(element) && /折扣|风险|低价|优惠|0\\.1/u.test(element.innerText || ''));
    if (!dialog) return null;
    const buttons = Array.from(dialog.querySelectorAll('button')).filter(isVisible);
    return buttons.find((element) =>
      ['确定', '确认', '我已知晓', '知道了', '继续'].includes(element.innerText.trim())
    ) || null;
  })()`;
}
function buildInternalPurchaseSkuEditorSnapshotExpression() {
    return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const visibleButtons = Array.from(document.querySelectorAll('button'))
      .filter(isVisible)
      .map((element) => element.innerText.trim())
      .filter(Boolean);
    const visibleDialogs = Array.from(document.querySelectorAll(
      '[role="alertdialog"], [role="dialog"], .next-dialog, .next-overlay-wrapper'
    ))
      .filter(isVisible)
      .map((element) => (element.innerText || '').trim().slice(0, 800))
      .filter(Boolean);
    const visibleInputs = Array.from(document.querySelectorAll('input'))
      .filter(isVisible)
      .map((element) => {
        const handlerSources = [];
        const fiberSources = [];
        let target = element;
        while (target && target !== document.body && handlerSources.length < 3) {
          const propsKeys = Object.getOwnPropertyNames(target)
            .filter((key) => key.startsWith('__reactProps$'));
          for (const propsKey of propsKeys) {
            const handlers = Object.fromEntries(
              Object.entries(target[propsKey] || {})
                .filter(([key, value]) => /^on[A-Z]/u.test(key) && typeof value === 'function')
                .map(([key, value]) => [key, String(value).slice(0, 600)])
            );
            if (Object.keys(handlers).length > 0) {
              handlerSources.push({
                tagName: target.tagName,
                className: String(target.className || ''),
                handlers
              });
            }
          }
          target = target.parentElement;
        }
        if (element.value === '0.1') {
          const fiberKey = Object.getOwnPropertyNames(element)
            .find((key) => key.startsWith('__reactFiber$'));
          let fiber = fiberKey ? element[fiberKey] : null;
          while (fiber && fiberSources.length < 12) {
            const props = fiber.memoizedProps || {};
            const handlers = Object.fromEntries(
              Object.entries(props)
                .filter(([key, value]) => /^on[A-Z]/u.test(key) && typeof value === 'function')
                .map(([key, value]) => [key, String(value).slice(0, 1_000)])
            );
            if (Object.keys(handlers).length > 0) {
              fiberSources.push({
                component: fiber.elementType?.displayName
                  || fiber.elementType?.name
                  || fiber.type?.displayName
                  || fiber.type?.name
                  || String(fiber.elementType || fiber.type || ''),
                handlers
              });
            }
            fiber = fiber.return;
          }
        }
        return {
          type: element.type,
          value: element.value,
          placeholder: element.placeholder,
          ariaLabel: element.getAttribute('aria-label'),
          className: element.className,
          handlerSources,
          fiberSources
        };
      });
    return { visibleButtons, visibleDialogs, visibleInputs };
  })()`;
}
function buildInternalPurchaseNextStepResolver() {
    return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return !element.disabled && rect.width > 0 && rect.height > 0;
    };
    const candidates = Array.from(document.querySelectorAll('button'))
      .filter((element) => element.innerText.trim() === '下一步' && isVisible(element));
    const productPicker = Array.from(document.querySelectorAll('[role="dialog"], .next-overlay-wrapper'))
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 &&
          rect.height > 0 &&
          Boolean(element.querySelector('input[placeholder="搜索商品ID"]'));
      });
    return candidates.find((element) => productPicker?.contains(element))
      || candidates[candidates.length - 1]
      || null;
  })()`;
}
function buildInternalPurchaseDateRangeTriggerExpression() {
    return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const directTrigger = Array.from(document.querySelectorAll('.next-range-picker-trigger'))
      .find(isVisible);
    if (directTrigger) return directTrigger;
    const startInput = Array.from(document.querySelectorAll('input[placeholder="起始日期"]'))
      .find(isVisible);
    return startInput?.closest('[class*="range-picker"], [class*="RangePicker"]') || startInput || null;
  })()`;
}
function buildInternalPurchasePickerInputResolver(selector) {
    return `Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
    .find((element) => {
      const rect = element.getBoundingClientRect();
      return !element.disabled && rect.width > 0 && rect.height > 0;
    })`;
}
function buildInternalPurchaseDateRangeAppliedExpression(expectedStart, expectedEnd) {
    return `(() => {
    const normalizeToMinute = (value) =>
      String(value || '').trim().replace('T', ' ').slice(0, 16);
    const compactMinute = (value) =>
      normalizeToMinute(value).replace(/\\D/gu, '').slice(0, 12);
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const visibleInputs = Array.from(document.querySelectorAll(
      '.next-range-picker-trigger input, input[placeholder="起始日期"], input[placeholder="结束日期"]'
    )).filter(isVisible);
    const visibleTriggers = Array.from(document.querySelectorAll('.next-range-picker-trigger'))
      .filter(isVisible);
    const visibleText = [
      ...visibleInputs.map((element) => element.value || ''),
      ...visibleTriggers.map((element) => element.innerText || '')
    ].join(' ');
    const compactVisibleText = visibleText.replace(/\\D/gu, '').slice(0, 240);
    const expectedStartMinute = ${JSON.stringify(expectedStart)};
    const expectedEndMinute = ${JSON.stringify(expectedEnd)};
    const hasMinute = (expected) => visibleInputs.some(
      (element) => normalizeToMinute(element.value) === expected
    ) || compactVisibleText.includes(compactMinute(expected));
    return hasMinute(expectedStartMinute) && hasMinute(expectedEndMinute);
  })()`;
}
function buildInternalPurchaseVisibleDateRangeExpression() {
    return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const inputs = Array.from(document.querySelectorAll(
      '.next-range-picker-trigger input, input[placeholder="起始日期"], input[placeholder="结束日期"]'
    )).filter(isVisible);
    const startInput = inputs.find((element) => element.placeholder === '起始日期')
      || inputs[0]
      || null;
    const endInput = inputs.find((element) => element.placeholder === '结束日期')
      || inputs.find((element) => element !== startInput)
      || null;
    return {
      startsAt: String(startInput?.value || '').trim(),
      endsAt: String(endInput?.value || '').trim()
    };
  })()`;
}
function buildInternalPurchaseDateRangeConfirmResolver() {
    return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return !element.disabled && rect.width > 0 && rect.height > 0;
    };
    const startInputs = Array.from(document.querySelectorAll(
      '.next-range-picker-panel-input-start-date input'
    )).filter(isVisible);
    for (const startInput of startInputs) {
      const panel = startInput.closest(
        '.next-range-picker-panel, .next-overlay-wrapper, [role="dialog"]'
      );
      if (!panel) continue;
      const endInput = panel.querySelector(
        '.next-range-picker-panel-input-end-date input'
      );
      if (!endInput || !isVisible(endInput)) continue;
      const confirmButton = Array.from(panel.querySelectorAll('button'))
        .find((element) => (
          element.innerText.trim() === '确定'
          && isVisible(element)
        ));
      if (confirmButton) return confirmButton;
    }
    return null;
  })()`;
}
function buildInternalPurchaseFailureDiagnosticExpression() {
    return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const visibleInputs = Array.from(document.querySelectorAll(
      '.next-range-picker-trigger input, '
      + '.next-range-picker-panel input, '
      + 'input[placeholder="起始日期"], input[placeholder="结束日期"]'
    ))
      .filter(isVisible)
      .slice(0, 12)
      .map((element) => ({
        placeholder: String(element.getAttribute('placeholder') || '').slice(0, 30),
        value: String(element.value || '').slice(0, 40),
        disabled: Boolean(element.disabled),
        readOnly: Boolean(element.readOnly),
        focused: document.activeElement === element,
        selectionStart: element.selectionStart,
        selectionEnd: element.selectionEnd
      }));
    const confirmButtons = Array.from(document.querySelectorAll('button'))
      .filter((element) => {
        const text = String(element.innerText || '').trim();
        return isVisible(element) && /^(确定|确认|完成)$/u.test(text);
      })
      .slice(0, 8)
      .map((element) => ({
        text: String(element.innerText || '').trim().slice(0, 10),
        disabled: Boolean(element.disabled)
      }));
    const visibleOverlays = Array.from(document.querySelectorAll(
      '.next-overlay-wrapper, [role="dialog"]'
    )).filter(isVisible);
    const bodyText = String(document.body?.innerText || '');
    const batchMessages = Array.from(document.querySelectorAll(
      '[role="alert"], [role="status"], .next-message, p, span, div'
    ))
      .filter((element) => {
        const text = String(element.innerText || '').replace(/\\s+/gu, ' ').trim();
        return isVisible(element)
          && text.length > 0
          && text.length <= 240
          && /(批量导入|导入成功|导入失败|成功导入|上传文件|表格校验|校验失败)/u.test(text);
      })
      .slice(0, 8)
      .map((element) => String(element.innerText || '')
        .replace(/\\s+/gu, ' ')
        .replace(/\\b\\d{6,20}\\b/gu, '[商品ID已隐藏]')
        .trim()
        .slice(0, 240));
    return {
      url: location.origin + location.pathname,
      readyState: document.readyState,
      visibleInputs,
      rangeTriggerCount: Array.from(document.querySelectorAll('.next-range-picker-trigger'))
        .filter(isVisible).length,
      visibleOverlayCount: visibleOverlays.length,
      confirmButtons,
      batchMessages,
      selectedFileInputCount: Array.from(document.querySelectorAll('input[type="file"]'))
        .filter((element) => Boolean(element.files?.length)).length,
      securityChallenge: /(验证码|安全验证|访问被拒绝|登录验证|滑块)/u.test(bodyText),
      viewport: {
        width: Math.max(0, Math.round(window.innerWidth || 0)),
        height: Math.max(0, Math.round(window.innerHeight || 0))
      }
    };
  })()`;
}
async function collectInternalPurchaseVisibleFailureDiagnostic(webContents) {
    const diagnostic = await evaluate(webContents, buildInternalPurchaseFailureDiagnosticExpression());
    return JSON.stringify(diagnostic).slice(0, 4_000);
}
function parseInternalPurchaseActivityCards(cards) {
    const result = [];
    for (const text of cards) {
        const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
        const range = lines.find((line) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?\s*(?:-|至|~)\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/u
            .test(line)));
        const statusText = lines.find((line) => line === '待运行' || line === '运行中' || line === '进行中' || line === '已结束');
        const name = lines.find((line) => line !== '内购会' && line !== '复制链接' && line !== range && line !== statusText);
        if (!name || !range || !statusText)
            continue;
        const [startsAt, endsAt] = range.split(/\s+-\s+|\s*至\s*|\s*~\s*/u);
        result.push({ name, startsAt, endsAt, status: statusText === '已结束' ? 'ended' : 'running' });
    }
    return result;
}
async function listInternalPurchaseActivities(webContents) {
    await navigateAndWait(webContents, exports.INTERNAL_PURCHASE_ACTIVITY_LIST_URL, '活动列表', true);
    if (isTaobaoLoginUrl(webContents.getURL())
        || await waitForResult(webContents, buildInternalPurchaseLoginPageProbeExpression(), 800)) {
        throw new Error('店铺登录已失效，请重新登录后执行任务');
    }
    if (await evaluate(webContents, buildInternalPurchaseSecurityChallengeProbeExpression())) {
        throw new Error('淘宝触发安全验证或访问拒绝，已停止所有自动操作；请点击“处理”完成验证后重试');
    }
    const activityListReady = await waitForResult(webContents, `Boolean(document.querySelector('[class*="ActivityItem_activityItemContainer"]'))
      || /暂无(?:活动|数据)/u.test(document.body.innerText || '')`, 15_000);
    if (!activityListReady) {
        throw new Error('等待淘宝活动列表展示可见活动卡片超时，请稍后重试');
    }
    const cards = await evaluate(webContents, `
    Array.from(document.querySelectorAll('[class*="ActivityItem_activityItemContainer"]'))
      .map((element) => (element.innerText || '').trim())
  `);
    return parseInternalPurchaseActivityCards(cards);
}
async function prepareInternalPurchaseActivity(webContents, plan, storeName, reportProgress, onSecurityChallengeVisibilityChange, onManualProductSelectionVisibilityChange, writeManualBatchWorkbook, onManualBatchUploadVisibilityChange) {
    if (plan.scope.kind !== 'selected-products' || plan.audience !== 'fans' || !plan.skuDiscountRule) {
        throw new Error('当前方案不是淘宝粉丝内购会方案');
    }
    const skuDiscountRule = plan.skuDiscountRule;
    const requestedProducts = plan.scope.products;
    let currentStep = '打开淘宝内购会页面';
    try {
        reportProgress?.({
            phase: 'prepare',
            stage: 'session',
            title: '检查店铺登录状态',
            detail: `正在使用${storeName}的本机会话打开淘宝内购会`,
            status: 'running'
        });
        currentStep = '检查进行中的内购会';
        const existingActivities = await listInternalPurchaseActivities(webContents);
        if (isTaobaoLoginUrl(webContents.getURL())
            || await waitForResult(webContents, buildInternalPurchaseLoginPageProbeExpression(), 2_500)) {
            reportProgress?.({
                phase: 'prepare',
                stage: 'session',
                title: '店铺需要重新登录',
                detail: '已打开淘宝官方登录流程，登录后会自动继续',
                status: 'warning'
            });
            return buildPreparation(plan, 'login-required', [], [], '店铺登录已失效，请先重新登录店铺');
        }
        const runningActivities = existingActivities.filter((activity) => activity.status === 'running');
        if (runningActivities.length > 0) {
            const activityNames = runningActivities.map((activity) => `“${activity.name}”`).join('、');
            reportProgress?.({
                phase: 'prepare',
                stage: 'activity',
                title: '检测到进行中的内购会',
                detail: `${activityNames}仍在运行，已在进入创建页前停止本次任务`,
                status: 'warning'
            });
            const occupiedProducts = plan.scope.products.map((product) => ({
                id: product.id,
                title: product.title || product.id,
                skuCount: 0,
                status: 'occupied',
                reason: `当前店铺已有进行中的内购会${activityNames}`
            }));
            return buildPreparation(plan, 'blocked', occupiedProducts, runningActivities, `当前店铺已有进行中的内购会${activityNames}，请先确认是否结束原活动`);
        }
        currentStep = '打开天猫 SKU 管理页';
        reportProgress?.({
            phase: 'prepare',
            stage: 'discounts',
            title: '打开店铺 SKU 管理页',
            detail: `将使用当前店铺会话按每批 20 个、2 路并发读取 ${requestedProducts.length} 个商品的 SKU`,
            status: 'running'
        });
        onManualProductSelectionVisibilityChange?.(false);
        await navigateAndWait(webContents, exports.INTERNAL_PURCHASE_SKU_CENTER_URL, 'SKU管理');
        if (isTaobaoLoginUrl(webContents.getURL())
            || await waitForResult(webContents, buildInternalPurchaseLoginPageProbeExpression(), 2_500)) {
            reportProgress?.({
                phase: 'prepare',
                stage: 'session',
                title: '店铺需要重新登录',
                detail: '已打开淘宝官方登录流程，登录后重新执行任务即可继续',
                status: 'warning'
            });
            return buildPreparation(plan, 'login-required', [], [], '店铺登录已失效，请先重新登录店铺');
        }
        currentStep = '在 SKU 管理页批量读取商品';
        const skuCenterProducts = await collectInternalPurchaseSkuCenterProductsViaWebApi(webContents, requestedProducts, reportProgress, onSecurityChallengeVisibilityChange);
        currentStep = '打开淘宝内购会创建页';
        await resetInternalPurchaseCreatePage(webContents);
        await navigateAndWait(webContents, exports.INTERNAL_PURCHASE_CREATE_URL, '创建内购会');
        if (isTaobaoLoginUrl(webContents.getURL())
            || await waitForResult(webContents, buildInternalPurchaseLoginPageProbeExpression(), 2_500)) {
            reportProgress?.({
                phase: 'prepare',
                stage: 'session',
                title: '店铺需要重新登录',
                detail: '已打开淘宝官方登录流程，登录后会自动继续',
                status: 'warning'
            });
            return buildPreparation(plan, 'login-required', [], [], '店铺登录已失效，请先重新登录店铺');
        }
        reportProgress?.({
            phase: 'prepare',
            stage: 'session',
            title: '店铺登录有效',
            detail: `${storeName}已在线，开始填写活动`,
            status: 'success'
        });
        const schedule = resolveInternalPurchasePlatformSchedule(plan.startsAt, plan.endsAt);
        let effectivePlan = {
            ...plan,
            name: buildInternalPurchaseActivityName(storeName, schedule.startsAt),
            startsAt: localDateTime(schedule.startsAt),
            endsAt: localDateTime(schedule.endsAt)
        };
        if (schedule.adjusted) {
            reportProgress?.({
                phase: 'prepare',
                stage: 'activity',
                title: '开始时间已自动校准',
                detail: `已调整为 ${effectivePlan.startsAt}，结束时间顺延以保持原活动时长`,
                status: 'success'
            });
        }
        currentStep = '填写活动时间';
        reportProgress?.({
            phase: 'prepare',
            stage: 'activity',
            title: '填写活动信息',
            detail: `正在设置活动名称和 ${effectivePlan.startsAt} 至 ${effectivePlan.endsAt}`,
            status: 'running'
        });
        const filledSchedule = await fillDateRange(webContents, schedule.startsAt, schedule.endsAt);
        const platformDateAdjusted = filledSchedule.startsAt.getTime() !== schedule.startsAt.getTime()
            || filledSchedule.endsAt.getTime() !== schedule.endsAt.getTime();
        const scheduleAdjustment = platformDateAdjusted
            ? {
                reason: 'platform-earliest-date',
                requestedStartsAt: localDateTime(schedule.startsAt),
                requestedEndsAt: localDateTime(schedule.endsAt),
                startsAt: localDateTime(filledSchedule.startsAt),
                endsAt: localDateTime(filledSchedule.endsAt)
            }
            : undefined;
        if (platformDateAdjusted) {
            effectivePlan = {
                ...effectivePlan,
                name: buildInternalPurchaseActivityName(storeName, filledSchedule.startsAt),
                startsAt: localDateTime(filledSchedule.startsAt),
                endsAt: localDateTime(filledSchedule.endsAt)
            };
            reportProgress?.({
                phase: 'prepare',
                stage: 'activity',
                title: '淘宝页面已顺延活动日期',
                detail: `原时间 ${scheduleAdjustment?.requestedStartsAt} 至 ${scheduleAdjustment?.requestedEndsAt} 所在日期不可选；已顺延为 ${effectivePlan.startsAt} 至 ${effectivePlan.endsAt}，活动时长保持不变`,
                status: 'warning'
            });
        }
        currentStep = '填写活动名称和粉丝人群';
        await replaceVisibleTextSlowly(webContents, `document.querySelector('input[placeholder="请输入活动名称"]')`, effectivePlan.name);
        await trustedClick(webContents, `
    Array.from(document.querySelectorAll('[class*="CrowdCard--crowdCard--"]'))
      .find((element) => element.innerText.trim().startsWith('粉丝人群'))
  `);
        const skuCenterProductsById = new Map(skuCenterProducts.map((product) => [String(product.itemId), product]));
        const selectedMtopProducts = requestedProducts.flatMap((product) => {
            const skuCenterProduct = skuCenterProductsById.get(product.id);
            return skuCenterProduct && skuCenterProduct.skuVOS.length > 0
                ? [skuCenterProduct]
                : [];
        });
        const products = requestedProducts.map((product) => {
            const skuCenterProduct = skuCenterProductsById.get(product.id);
            return {
                id: product.id,
                title: product.title || skuCenterProduct?.title || product.id,
                skuCount: skuCenterProduct?.skuVOS.length || 0,
                status: skuCenterProduct?.skuVOS.length ? 'selected' : 'not-found',
                ...(!skuCenterProduct?.skuVOS.length
                    ? { reason: 'SKU 管理页批量接口未返回该商品，未写入本次官方导入表' }
                    : {})
            };
        });
        const missingProducts = products.filter((product) => product.status === 'not-found');
        if (selectedMtopProducts.length < 3) {
            const sample = missingProducts.slice(0, 8).map((product) => product.id).join('、');
            return buildPreparation(effectivePlan, 'blocked', products, [], `SKU 管理页仅返回 ${selectedMtopProducts.length} 个可导入商品，淘宝内购会至少需要 3 个商品`
                + (sample ? `；未返回：${sample}` : ''));
        }
        reportProgress?.({
            phase: 'prepare',
            stage: 'products',
            title: `官方表将导入 ${selectedMtopProducts.length}/${products.length} 个商品`,
            detail: missingProducts.length > 0
                ? `${missingProducts.length} 个商品未由在售 SKU 管理页返回，已从本次导入表中排除`
                : '全部商品及 SKU 将直接写入官方导入表，无需逐个选择商品',
            status: missingProducts.length > 0 ? 'warning' : 'success'
        });
        const totalSkuCount = selectedMtopProducts.reduce((total, product) => total + product.skuVOS.length, 0);
        if (totalSkuCount === 0) {
            throw new Error('淘宝当前表单没有可批量配置的 SKU');
        }
        if (!writeManualBatchWorkbook) {
            throw new Error('本机尚未配置淘宝官方 SKU 批量导入模板');
        }
        currentStep = '生成 SKU 官方批量导入文件';
        const batchFilePath = await writeManualBatchWorkbook(selectedMtopProducts, skuDiscountRule);
        reportProgress?.({
            phase: 'prepare',
            stage: 'discounts',
            title: '生成 SKU 官方批量导入表',
            detail: `已在本机生成 ${totalSkuCount} 行可修改的 SKU 优惠；其他 SKU ${skuDiscountRule.otherSkus} 折，每个商品第 6 个 SKU（不足 6 个取最后一个） ${skuDiscountRule.lastSku} 折`,
            status: 'success'
        });
        currentStep = '在创建页选择批量导入和 SKU';
        await prepareInternalPurchaseVisibleBatchImport(webContents);
        reportProgress?.({
            phase: 'prepare',
            stage: 'discounts',
            title: `上传 SKU 官方批量导入表 ${totalSkuCount} 行`,
            detail: `页面已选择“SKU”和“批量导入”，正在把 ${batchFilePath} 放入可见文件上传入口`,
            status: 'running'
        });
        currentStep = '上传并校验 SKU 官方批量导入文件';
        let requiresManualUpload = false;
        try {
            await uploadInternalPurchaseVisibleBatchFile(webContents, batchFilePath);
        }
        catch (error) {
            requiresManualUpload = true;
            const message = normalizeInternalPurchaseAutomationError(error);
            reportProgress?.({
                phase: 'prepare',
                stage: 'discounts',
                title: '需要人工选择本地 SKU 文件',
                detail: `${message}；请选择 ${batchFilePath}，页面校验通过后软件会继续`,
                status: 'warning'
            });
            onManualBatchUploadVisibilityChange?.(true, batchFilePath, totalSkuCount);
        }
        try {
            await waitForManualInternalPurchaseBatchUpload(webContents, batchFilePath, totalSkuCount, reportProgress);
        }
        finally {
            if (requiresManualUpload) {
                onManualBatchUploadVisibilityChange?.(false);
            }
        }
        preparedInternalPurchaseBatchFiles.set(webContents, {
            planId: plan.id,
            filePath: batchFilePath,
            totalSkuCount
        });
        reportProgress?.({
            phase: 'prepare',
            stage: 'discounts',
            title: '商品折扣批量配置完成',
            detail: `淘宝页面已确认 ${selectedMtopProducts.length} 个商品、${totalSkuCount} 个在售 SKU 全部导入成功`,
            status: 'success'
        });
        reportProgress?.({
            phase: 'prepare',
            stage: 'activity',
            title: '淘宝页面填写完成',
            detail: '商品和 SKU 均由官方模板批量导入；等待你确认创建并立即生效',
            status: 'success'
        });
        return buildPreparation(effectivePlan, 'prepared', products, [], `已填写${storeName}的淘宝内购会页面并完成官方 SKU 表格上传校验，尚未点击创建`, scheduleAdjustment);
    }
    catch (error) {
        const message = normalizeInternalPurchaseAutomationError(error);
        if (isInternalPurchaseLoginRequiredError(error)) {
            reportProgress?.({
                phase: 'prepare',
                stage: 'session',
                title: '店铺需要重新登录',
                detail: '活动列表已跳转到淘宝登录页，登录后重新执行任务即可继续',
                status: 'warning'
            });
            return buildPreparation(plan, 'login-required', [], [], '店铺登录已失效，请先重新登录店铺');
        }
        if (isInternalPurchaseSecurityChallengeError(error)) {
            reportProgress?.({
                phase: 'prepare',
                stage: 'session',
                title: '淘宝访问已被安全验证拦截',
                detail: '已停止所有自动操作，不会自动刷新、重试或绕过验证；请点击“处理”后再重新执行任务',
                status: 'warning'
            });
            onSecurityChallengeVisibilityChange?.(true);
            throw new Error(message);
        }
        if (currentStep.includes('SKU 管理页')) {
            reportProgress?.({
                phase: 'prepare',
                stage: 'discounts',
                title: `${plan.name}任务需要人工检查 SKU 管理页`,
                detail: `${message}；点击“处理”可直接回到当前店铺的 SKU 管理页`,
                status: 'warning'
            });
            onManualProductSelectionVisibilityChange?.(true);
        }
        throw new Error(`${currentStep}失败：${message}`);
    }
}
async function collectInternalPurchaseSkuCenterProductsViaWebApi(webContents, products, reportProgress, onSecurityChallengeVisibilityChange) {
    reportProgress?.({
        phase: 'prepare',
        stage: 'discounts',
        title: `批量读取 SKU 0/${products.length}`,
        detail: `正在通过 SKU 管理页接口按每批 20 个、2 路并发查询，共 ${Math.ceil(products.length / 20)} 批`,
        status: 'running'
    });
    let queriedProducts;
    try {
        await waitFor(webContents, "typeof window.lib?.mtop?.request === 'function'", 15_000);
        queriedProducts = await evaluate(webContents, buildInternalPurchaseSkuCenterBatchQueryExpression(products.map((product) => product.id)));
    }
    catch (error) {
        if (isInternalPurchaseSecurityChallengeError(error)) {
            reportProgress?.({
                phase: 'prepare',
                stage: 'discounts',
                title: 'SKU 管理页需要安全验证',
                detail: '已停止所有批量查询，不会自动刷新、重试或绕过平台限制；点击“处理”查看当前淘宝页面',
                status: 'warning'
            });
            onSecurityChallengeVisibilityChange?.(true);
        }
        throw error;
    }
    const queriedById = new Map(queriedProducts.map((product) => [String(product.itemId), product]));
    const orderedProducts = products.flatMap((product) => {
        const queried = queriedById.get(product.id);
        if (!queried || queried.skuVOS.length === 0)
            return [];
        return [{
                ...queried,
                itemId: product.id,
                title: product.title || queried.title || product.id,
                isOptional: true,
                isParticipatedItem: false
            }];
    });
    const totalSkuCount = orderedProducts.reduce((total, product) => total + product.skuVOS.length, 0);
    reportProgress?.({
        phase: 'prepare',
        stage: 'discounts',
        title: `已批量读取 ${orderedProducts.length}/${products.length} 个商品`,
        detail: `共返回 ${totalSkuCount} 个 SKU；未回传的商品不会写入本次官方导入表`,
        status: orderedProducts.length === products.length ? 'success' : 'warning'
    });
    if (orderedProducts.length === 0) {
        throw new Error('SKU 管理页批量查询未返回任何商品');
    }
    return orderedProducts;
}
async function prepareInternalPurchaseVisibleBatchImport(webContents) {
    const skuDialogVisible = await evaluate(webContents, buildInternalPurchaseSkuEditorDialogExpression()).catch(() => false);
    if (skuDialogVisible) {
        await trustedClick(webContents, buildInternalPurchaseSkuEditorCloseResolver());
        await waitForResult(webContents, `!(${buildInternalPurchaseSkuEditorDialogExpression()})`, 4_000);
    }
    const skuLevelResolver = `Array.from(document.querySelectorAll(
    'label, button, [role="radio"], [role="button"]'
  )).find((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.visibility !== 'hidden'
      && style.display !== 'none'
      && (element.innerText || '').trim().toUpperCase() === 'SKU';
  })`;
    if (!await waitForResult(webContents, skuLevelResolver, 4_000)) {
        throw new Error('淘宝创建页未显示“SKU”选项');
    }
    await trustedClick(webContents, skuLevelResolver);
    const skuLevelCheckedResolver = `(() => {
    const element = ${skuLevelResolver};
    const input = element?.querySelector('input[type="radio"]');
    return Boolean(
      input?.checked
      || input?.getAttribute('aria-checked') === 'true'
      || element?.getAttribute('aria-checked') === 'true'
    );
  })()`;
    if (!await waitForResult(webContents, skuLevelCheckedResolver, 3_000)) {
        throw new Error('淘宝创建页未能选中“SKU”');
    }
    const batchImportResolver = `Array.from(document.querySelectorAll(
    'label, button, [role="radio"], [role="button"]'
  )).find((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.visibility !== 'hidden'
      && style.display !== 'none'
      && (element.innerText || '').replace(/\\s+/gu, '') === '批量导入';
  })`;
    if (!await waitForResult(webContents, batchImportResolver, 4_000)) {
        throw new Error('淘宝创建页未显示“批量导入”选项');
    }
    await trustedClick(webContents, batchImportResolver);
    const batchImportCheckedResolver = `(() => {
    const element = ${batchImportResolver};
    const input = element?.querySelector('input[type="radio"]');
    return Boolean(
      input?.checked
      || input?.getAttribute('aria-checked') === 'true'
      || element?.getAttribute('aria-checked') === 'true'
    );
  })()`;
    if (!await waitForResult(webContents, batchImportCheckedResolver, 3_000)) {
        throw new Error('淘宝创建页未能选中“批量导入”');
    }
    const uploadReady = await waitForResult(webContents, `(() => {
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) return true;
    const visibleText = Array.from(document.querySelectorAll(
      'button, label, p, span, [role="button"]'
    )).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    }).map((element) => (element.innerText || '').replace(/\\s+/gu, ' ')).join(' ');
    return /上传文件|点击上传|选择文件|导入文件|拖动文件/u.test(visibleText);
  })()`, 8_000);
    if (!uploadReady) {
        throw new Error('淘宝批量导入页尚未显示文件上传入口');
    }
}
async function uploadInternalPurchaseVisibleBatchFile(webContents, filePath) {
    const fileInputProtocol = webContents.debugger;
    const shouldDetach = !fileInputProtocol.isAttached();
    try {
        if (shouldDetach) {
            fileInputProtocol.attach('1.3');
        }
        const documentResult = await fileInputProtocol.sendCommand('DOM.getDocument', { depth: 0, pierce: true });
        const rootNodeId = Number(documentResult.root?.nodeId || 0);
        if (!rootNodeId) {
            throw new Error('无法读取淘宝批量导入页的可见文件输入框');
        }
        const inputResult = await fileInputProtocol.sendCommand('DOM.querySelector', {
            nodeId: rootNodeId,
            selector: 'input[type="file"]'
        });
        const fileInputNodeId = Number(inputResult.nodeId || 0);
        if (!fileInputNodeId) {
            throw new Error('淘宝批量导入页未显示文件输入框');
        }
        await fileInputProtocol.sendCommand('DOM.setFileInputFiles', {
            files: [filePath],
            nodeId: fileInputNodeId
        });
    }
    finally {
        if (shouldDetach && fileInputProtocol.isAttached()) {
            fileInputProtocol.detach();
        }
    }
}
async function waitForManualInternalPurchaseBatchUpload(webContents, filePath, totalSkuCount, reportProgress) {
    const deadline = Date.now() + 10 * 60_000;
    let lastProgressAt = 0;
    while (Date.now() < deadline) {
        if (webContents.isDestroyed())
            throw new Error('淘宝页面已关闭');
        if (isTaobaoLoginUrl(webContents.getURL())) {
            throw new Error('店铺登录已失效，请重新登录后执行任务');
        }
        const state = await evaluate(webContents, buildInternalPurchaseVisibleBatchUploadStateExpression(totalSkuCount));
        if (state.status === 'challenge') {
            throw new Error('淘宝返回访问被拒绝或安全验证，已停止所有自动操作；请人工处理后重新执行任务');
        }
        if (state.status === 'failed') {
            throw new Error(`淘宝 SKU 表格校验未通过：${state.detail}；请查看页面的“下载错误明细”，活动尚未提交`);
        }
        if (state.status === 'completed') {
            reportProgress?.({
                phase: 'prepare',
                stage: 'discounts',
                title: `SKU 表格校验完成 ${state.successfulSkuCount}/${totalSkuCount}`,
                detail: '全部 SKU 已由淘宝页面确认导入成功',
                status: 'success'
            });
            return 'completed';
        }
        if (Date.now() - lastProgressAt >= 10_000) {
            lastProgressAt = Date.now();
            reportProgress?.({
                phase: 'prepare',
                stage: 'discounts',
                title: state.status === 'waiting'
                    ? '正在把 SKU 官方表格放入页面'
                    : '淘宝正在校验 SKU 官方表格',
                detail: state.detail || `${filePath} · ${totalSkuCount} 行`,
                status: 'running'
            });
        }
        await delay(1_000);
    }
    throw new Error('等待淘宝页面校验 SKU 官方表格超时；活动尚未创建，可重新执行任务');
}
async function closeInternalPurchaseActivity(webContents, activityName) {
    const activities = await listInternalPurchaseActivities(webContents);
    const target = activities.find((activity) => activity.name === activityName && activity.status === 'running');
    if (!target)
        throw new Error(`未找到运行中的活动 ${activityName}`);
    await trustedHover(webContents, `(() => {
    const title = Array.from(document.querySelectorAll('[class*="ActivityItem_title"]'))
      .find((element) => element.textContent.trim() === ${JSON.stringify(activityName)});
    const row = title?.closest('[class*="ActivityItem_activityItemContainer"]');
    return row?.querySelector('[class*="ActivityItem_example"]');
  })()`);
    await waitFor(webContents, `document.body.innerText.includes('修改\\n删除\\n结束')`);
    await clickElement(webContents, `
    Array.from(document.querySelectorAll('[class*="ActivityItem_del"]'))
      .find((element) => element.textContent.trim() === '结束')
  `);
    await waitFor(webContents, `document.body.innerText.includes('是否确认结束活动？')`);
    await clickElement(webContents, `
    Array.from(document.querySelectorAll('[role="alertdialog"] button'))
      .find((element) => element.innerText.trim() === '确定')
  `);
    await waitFor(webContents, `(() => {
    const title = Array.from(document.querySelectorAll('[class*="ActivityItem_title"]'))
      .find((element) => element.textContent.trim() === ${JSON.stringify(activityName)});
    const row = title?.closest('[class*="ActivityItem_activityItemContainer"]');
    return Boolean(row && row.innerText.includes('已结束'));
  })()`);
    const refreshedActivities = await listInternalPurchaseActivities(webContents);
    if (refreshedActivities.some((activity) => (activity.name === activityName && activity.status === 'running'))) {
        throw new Error(`淘宝活动列表刷新后，活动仍显示为运行中：${activityName}`);
    }
    return { activity: { ...target, status: 'ended' }, closedAt: new Date().toISOString(), status: 'ended' };
}
function isInternalPurchaseProductConfigurationReady(state) {
    return state.createButtonEnabled
        && state.batchVerified !== false
        && !state.bodyText.includes('请选择活动商品')
        && !state.bodyText.includes('请先选择活动商品')
        && !state.bodyText.includes('请选择商品，并设置优惠信息');
}
async function readInternalPurchaseProductConfigurationState(webContents) {
    const expectedSkuCount = preparedInternalPurchaseBatchFiles.get(webContents)?.totalSkuCount;
    return await evaluate(webContents, buildInternalPurchaseProductConfigurationStateExpression(expectedSkuCount));
}
function buildInternalPurchaseProductConfigurationStateExpression(expectedSkuCount) {
    return `(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    };
    const bodyText = ((document.body?.innerText || '')
      .match(/请(?:先)?选择(?:活动)?商品[^\\n]{0,100}/u) || [''])[0];
    const createButton = Array.from(document.querySelectorAll('button'))
      .find((element) => (
        element.innerText.trim() === '创建'
        && visible(element)
      ));
    return {
      bodyText,
      createButtonEnabled: Boolean(createButton && !createButton.disabled),
      // Taobao keeps Create enabled even after changing dates clears every SKU.
      // Require the official import receipt, including the expected row count.
      batchVerified: ${expectedSkuCount === undefined ? 'null' : `(${buildInternalPurchaseVisibleBatchUploadStateExpression(expectedSkuCount)}).status === 'completed'`}
    };
  })()`;
}
async function ensureInternalPurchaseProductConfigurationBeforeSubmit(webContents, plan, reportProgress) {
    const initialState = await readInternalPurchaseProductConfigurationState(webContents);
    if (isInternalPurchaseProductConfigurationReady(initialState))
        return;
    const preparedBatch = preparedInternalPurchaseBatchFiles.get(webContents);
    if (preparedBatch?.planId !== plan.id) {
        throw new Error('淘宝商品优惠配置在确认期间已失效；已停止正式提交，请重新执行任务');
    }
    reportProgress?.({
        phase: 'create',
        stage: 'discounts',
        title: '恢复商品与 SKU 配置',
        detail: '检测到淘宝页面在确认期间清空了商品设置，正在重新上传已校验的本地官方表格',
        status: 'running'
    });
    await prepareInternalPurchaseVisibleBatchImport(webContents);
    await uploadInternalPurchaseVisibleBatchFile(webContents, preparedBatch.filePath);
    await waitForManualInternalPurchaseBatchUpload(webContents, preparedBatch.filePath, preparedBatch.totalSkuCount, reportProgress);
    if (!await waitForInternalPurchaseProductConfigurationReady(webContents)) {
        throw new Error('淘宝商品优惠配置自动恢复后仍不完整；已停止正式提交，请重新执行任务');
    }
    reportProgress?.({
        phase: 'create',
        stage: 'discounts',
        title: '商品与 SKU 配置已恢复',
        detail: `淘宝已重新确认 ${preparedBatch.totalSkuCount} 行 SKU，继续等待最终提交`,
        status: 'success'
    });
}
async function waitForInternalPurchaseProductConfigurationReady(webContents) {
    const deadline = Date.now() + 12_000;
    do {
        if (webContents.isDestroyed())
            throw new Error('淘宝页面已关闭');
        if (isInternalPurchaseProductConfigurationReady(await readInternalPurchaseProductConfigurationState(webContents)))
            return true;
        await delay(250);
    } while (Date.now() < deadline);
    return false;
}
/**
 * This is deliberately separate from preparation.  The caller must first create
 * a one-time confirmation token, so filling a page can never publish an offer.
 */
async function createInternalPurchaseActivity(webContents, plan, reportProgress) {
    // 2026-10-14 用户实测修复：
    // 之前这里用 resolveInternalPurchaseFinalSubmitSchedule，每次确认创建都会把开始时间改写成
    // “当前 + 1 分钟”，导致 ①活动名后缀变化、服务层核对“创建结果”时报不一致；②时间被改后淘宝清空
    // 商品/SKU 配置，页面重新填一遍表格，创建变慢。改为平台最小时限校验：预检时间仍有效就不改动，
    // 只有确实早于“当前 + 1 分钟”时才顺延（此时才重建名称、重新填表）。
    reportProgress?.({
        phase: 'create',
        stage: 'submit',
        title: '准备正式提交',
        detail: '正在读取淘宝页面状态并核对活动时间',
        status: 'running'
    });
    let schedule = resolveInternalPurchasePlatformSchedule(plan.startsAt, plan.endsAt);
    let effectivePlan = schedule.adjusted
        ? {
            ...plan,
            name: buildInternalPurchaseActivityNameFromExisting(plan.name, schedule.startsAt),
            startsAt: localDateTime(schedule.startsAt),
            endsAt: localDateTime(schedule.endsAt)
        }
        : plan;
    const createButtonResolver = `(() => (
    Array.from(document.querySelectorAll('button'))
      .filter((element) => (
        element.innerText.trim() === '创建'
        && !element.disabled
        && element.getBoundingClientRect().width > 0
        && element.getBoundingClientRect().height > 0
      ))
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.bottom - leftRect.bottom) || (rightRect.right - leftRect.right);
      })[0] || null
  ))()`;
    if (effectivePlan.name !== plan.name) {
        await replaceVisibleTextSlowly(webContents, `document.querySelector('input[placeholder="请输入活动名称"]')`, effectivePlan.name);
    }
    reportProgress?.({
        phase: 'create',
        stage: 'submit',
        title: '提交淘宝创建',
        detail: `正在正式创建活动「${effectivePlan.name}」`,
        status: 'running'
    });
    await submitInternalPurchaseWithRetry(webContents, createButtonResolver, async () => {
        await (0, internal_purchase_create_readiness_1.stabilizeInternalPurchaseCreateForm)({
            ensureDateRange: async () => {
                // A slow upload or rate-limit wait can consume the original lead time.
                // Move the name and both dates together before restoring products.
                if (schedule.startsAt.getTime() <= Date.now() + 30_000) {
                    schedule = resolveInternalPurchasePlatformSchedule(effectivePlan.startsAt, effectivePlan.endsAt);
                    effectivePlan = {
                        ...effectivePlan,
                        name: buildInternalPurchaseActivityNameFromExisting(effectivePlan.name, schedule.startsAt),
                        startsAt: localDateTime(schedule.startsAt),
                        endsAt: localDateTime(schedule.endsAt)
                    };
                    await replaceVisibleTextSlowly(webContents, `document.querySelector('input[placeholder="请输入活动名称"]')`, effectivePlan.name);
                }
                await ensureInternalPurchaseDateRangeBeforeSubmit(webContents, effectivePlan, reportProgress);
            },
            ensureProducts: () => ensureInternalPurchaseProductConfigurationBeforeSubmit(webContents, effectivePlan, reportProgress),
            settle: () => delay(1_200),
            isReady: async () => {
                const range = await evaluate(webContents, buildInternalPurchaseVisibleDateRangeExpression());
                const products = await readInternalPurchaseProductConfigurationState(webContents);
                return schedule.startsAt.getTime() > Date.now() + 30_000
                    && classifyInternalPurchaseVisibleDateRange(range, schedule.startsAt, schedule.endsAt) === 'match'
                    && isInternalPurchaseProductConfigurationReady(products);
            }
        });
    });
    reportProgress?.({
        phase: 'create',
        stage: 'submit',
        title: '确认线上活动',
        detail: '淘宝已接收请求，正在活动列表核对创建结果',
        status: 'running'
    });
    await waitForCreatedInternalPurchaseActivity(webContents, effectivePlan.name);
    preparedInternalPurchaseBatchFiles.delete(webContents);
    reportProgress?.({
        phase: 'create',
        stage: 'submit',
        title: '活动创建成功',
        detail: `已在淘宝活动列表找到「${effectivePlan.name}」`,
        status: 'success'
    });
    reportProgress?.({
        phase: 'create',
        stage: 'qr',
        title: '获取活动二维码',
        detail: '正在打开活动推广页并读取淘短链二维码',
        status: 'running'
    });
    let qrFailureMessage = '';
    const qrCodeDataUrl = await captureCreatedInternalPurchaseQrCode(webContents, effectivePlan.name, reportProgress).catch((error) => {
        qrFailureMessage = error instanceof Error ? error.message : String(error);
        return undefined;
    });
    reportProgress?.({
        phase: 'create',
        stage: 'qr',
        title: qrCodeDataUrl ? '二维码已保存' : '活动已创建，二维码暂未获取',
        detail: qrCodeDataUrl
            ? '两个活动透出均已关闭，真实二维码已保存到当前电脑'
            : (qrFailureMessage || '可稍后从活动记录重新获取二维码'),
        status: qrCodeDataUrl ? 'success' : 'warning'
    });
    return {
        activityName: effectivePlan.name,
        createdAt: new Date().toISOString(),
        message: qrCodeDataUrl
            ? '内购会已创建，搜索透出和首页关注频道已关闭，二维码已保存到本机记录。'
            : `内购会已创建；${qrFailureMessage || '淘宝页面未返回可截图的二维码。'}`,
        ...(qrCodeDataUrl ? { qrCodeDataUrl } : {})
    };
}
function isInternalPurchaseSopRequest(url) {
    return /mtop\.taobao\.passport(?:\.web|web).*?(?:dispatch|sop)/iu.test(url);
}
async function countSopDispatchRequests(webContents) {
    return await evaluate(webContents, `
    (() => {
      const isInternalPurchaseSopRequest = ${isInternalPurchaseSopRequest.toString()};
      return performance.getEntriesByType('resource')
        .filter((entry) => isInternalPurchaseSopRequest(entry.name))
        .length;
    })()
  `);
}
async function submitInternalPurchaseWithRetry(webContents, createButtonResolver, beforeAttempt) {
    const submitRetryDelaysMs = [20_000, 40_000];
    const notTriggeredRetryDelaysMs = [800, 1_600];
    let rateLimitAttempt = 0;
    let notTriggeredAttempt = 0;
    while (true) {
        await delay(120);
        await beforeAttempt?.();
        const dispatchCountBefore = await countSopDispatchRequests(webContents);
        await dismissVisibleCreateButtonOcclusion(webContents, createButtonResolver);
        if (notTriggeredAttempt === 0) {
            await trustedClick(webContents, createButtonResolver);
        }
        else {
            await trustedActivateElementWithKeyboard(webContents, createButtonResolver, notTriggeredAttempt === 1 ? 'ENTER' : 'SPACE');
        }
        const submitStatus = await waitForSopSubmit(webContents, dispatchCountBefore);
        if (submitStatus === 'submitted')
            return;
        if (submitStatus === 'not-triggered') {
            if (notTriggeredAttempt >= notTriggeredRetryDelaysMs.length) {
                throw new Error('淘宝未发起完整的正式提交请求，请检查页面提示后重试');
            }
            const createButtonStillReady = await waitForResult(webContents, `Boolean(${createButtonResolver})`, 2_000);
            if (!createButtonStillReady) {
                throw new Error('淘宝创建按钮状态已发生变化，为避免重复提交，已停止自动重试');
            }
            await delay(notTriggeredRetryDelaysMs[notTriggeredAttempt]);
            notTriggeredAttempt += 1;
            continue;
        }
        if (rateLimitAttempt >= submitRetryDelaysMs.length) {
            throw new Error('淘宝连续提示操作太快，已停止自动重试，请稍后重新创建');
        }
        await dismissInternalPurchaseRateLimitDialog(webContents);
        await delay(submitRetryDelaysMs[rateLimitAttempt]);
        rateLimitAttempt += 1;
    }
}
async function dismissInternalPurchaseRateLimitDialog(webContents) {
    const modifyButtonResolver = `
    Array.from(document.querySelectorAll('button'))
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return element.innerText.trim() === '去修改'
          && !element.disabled
          && rect.width > 0
          && rect.height > 0;
      })
  `;
    if (!await waitForResult(webContents, `Boolean(${modifyButtonResolver})`, 2_000)) {
        throw new Error('淘宝提示操作太快，但未找到可继续重试的“去修改”按钮');
    }
    await clickElement(webContents, modifyButtonResolver);
    await waitForResult(webContents, `!document.body.innerText.includes('操作太快了，请稍后重试')`, 3_000);
}
async function dismissVisibleCreateButtonOcclusion(webContents, createButtonResolver) {
    const occlusion = await evaluate(webContents, `(() => {
    const target = ${createButtonResolver};
    if (!target) {
      return { blocked: true, blockerText: '', closePoint: null };
    }
    target.scrollIntoView({ block: 'center' });
    const targetRect = target.getBoundingClientRect();
    if (!targetRect.width || !targetRect.height) {
      return { blocked: true, blockerText: '', closePoint: null };
    }
    const x = Math.round(targetRect.left + targetRect.width / 2);
    const y = Math.round(targetRect.top + targetRect.height / 2);
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === target || target.contains(hit))) {
      return { blocked: false, blockerText: '', closePoint: null };
    }
    const blockerChain = [];
    for (let current = hit; current && current !== document.body; current = current.parentElement) {
      blockerChain.push(current);
    }
    const blockerText = blockerChain
      .map((element) => (element.innerText || '').trim())
      .find(Boolean) || '';
    const closeSelector = [
      '[class*="next-icon-close"]',
      '[class*="next-dialog-close"]',
      '[class*="next-message-close"]',
      '[class*="next-notice-close"]',
      '[aria-label*="关闭"]',
      '[title*="关闭"]',
      '[aria-label="Close"]',
      '[title="Close"]'
    ].join(', ');
    const closeableBlocker = blockerChain.find((element) => (
      Boolean(element.querySelector(closeSelector))
    ));
    const close = closeableBlocker?.querySelector(
      closeSelector
    );
    if (!close) {
      return { blocked: true, blockerText, closePoint: null };
    }
    const closeRect = close.getBoundingClientRect();
    const closeStyle = getComputedStyle(close);
    if (
      !closeRect.width
      || !closeRect.height
      || closeStyle.display === 'none'
      || closeStyle.visibility === 'hidden'
    ) {
      return { blocked: true, blockerText, closePoint: null };
    }
    return {
      blocked: true,
      blockerText,
      closePoint: {
        x: Math.round(closeRect.left + closeRect.width / 2),
        y: Math.round(closeRect.top + closeRect.height / 2)
      }
    };
  })()`);
    if (!occlusion.blocked)
        return;
    if (/验证码|安全验证|访问拒绝|登录|滑块/u.test(occlusion.blockerText)) {
        throw new Error('淘宝创建按钮被页面浮层遮挡，请点击“处理”关闭遮挡后重试');
    }
    if (occlusion.closePoint) {
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, {
            type: 'mouseMove',
            x: occlusion.closePoint.x,
            y: occlusion.closePoint.y
        });
        await delay(100);
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, {
            type: 'mouseDown',
            x: occlusion.closePoint.x,
            y: occlusion.closePoint.y,
            button: 'left',
            clickCount: 1
        });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, {
            type: 'mouseUp',
            x: occlusion.closePoint.x,
            y: occlusion.closePoint.y,
            button: 'left',
            clickCount: 1
        });
    }
    else {
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'ESCAPE' });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'ESCAPE' });
    }
    await delay(180);
    const uncovered = await waitForResult(webContents, `(() => {
      const target = ${createButtonResolver};
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const hit = document.elementFromPoint(
        Math.round(rect.left + rect.width / 2),
        Math.round(rect.top + rect.height / 2)
      );
      return Boolean(hit && (hit === target || target.contains(hit)));
    })()`, 2_000);
    if (!uncovered) {
        throw new Error('淘宝创建按钮被页面浮层遮挡，请点击“处理”关闭遮挡后重试');
    }
}
function buildInternalPurchaseInlineValidationExpression() {
    return `(() => {
    const messages = Array.from(document.querySelectorAll(
      '.next-form-item-error .next-form-item-help, .next-form-item-error .next-form-item-explain, '
      + '[class*="errorHint"], [class*="errorMessage"], [class*="ErrorMessage"], .next-message-error'
    )).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
    }).map((element) => (element.innerText || '').trim()).filter(Boolean);
    return Array.from(new Set(messages)).join('；').slice(0, 1_000);
  })()`;
}
async function waitForSopSubmit(webContents, dispatchCountBefore) {
    const deadline = Date.now() + 15_000;
    let lastFeedback = '';
    let requestObserved = false;
    while (Date.now() < deadline) {
        if (webContents.isDestroyed())
            throw new Error('淘宝页面已关闭');
        const snapshot = await evaluate(webContents, `(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const feedbackTexts = Array.from(document.querySelectorAll(
        '.next-message, [role="alertdialog"], [role="dialog"], [class*="Message--"], [class*="message--"]'
      ))
        .filter(visible)
        .map((element) => (element.innerText || '').trim())
        .filter(Boolean);
      const priorityFeedback = feedbackTexts.find((text) => (
        /操作太快|请求太频繁|操作频繁|提交频繁|访问频繁|活动创建成功|可去投放活动/u.test(text)
      ));
      const feedback = (priorityFeedback || feedbackTexts.join('；')).slice(0, 1_000);
      const isInternalPurchaseSopRequest = ${isInternalPurchaseSopRequest.toString()};
      return {
        dispatchCount: performance.getEntriesByType('resource')
          .filter((entry) => isInternalPurchaseSopRequest(entry.name))
          .length,
        feedback,
        validationFeedback: ${buildInternalPurchaseInlineValidationExpression()},
        isActivityList: location.href.includes('activityList')
      };
    })()`).catch(() => ({
            dispatchCount: dispatchCountBefore,
            feedback: '',
            validationFeedback: '',
            isActivityList: false
        }));
        const feedbackClassification = classifyInternalPurchaseSubmitFeedback(snapshot.feedback);
        if (feedbackClassification === 'rate-limited') {
            return 'rate-limited';
        }
        if (feedbackClassification === 'success') {
            return 'submitted';
        }
        if (snapshot.validationFeedback) {
            throw new Error(`淘宝未完成正式提交：${snapshot.validationFeedback}`);
        }
        if (feedbackClassification === 'feedback'
            && /创建失败|提交失败|校验失败|不能为空|请填写|请选择|格式错误|已被占用/u
                .test(snapshot.feedback)) {
            lastFeedback = snapshot.feedback;
        }
        // A completed resource is not a successful activity creation. Leave the form
        // mounted long enough for its response handler and validation dialog to run.
        requestObserved ||= snapshot.dispatchCount >= dispatchCountBefore + 1;
        if (snapshot.isActivityList)
            return 'submitted';
        await delay(160);
    }
    if (lastFeedback)
        throw new Error(`淘宝未完成正式提交：${lastFeedback}`);
    if (requestObserved)
        return 'submitted';
    return 'not-triggered';
}
async function waitForCreatedInternalPurchaseActivity(webContents, activityName) {
    const deadline = Date.now() + 180_000;
    let activities = [];
    while (Date.now() < deadline) {
        activities = await listInternalPurchaseActivities(webContents);
        const created = activities.find((activity) => activity.name === activityName);
        if (created)
            return created;
        await delay(3_000);
    }
    throw new Error(`淘宝没有在活动列表中返回「${activityName}」，不能标记为创建成功`);
}
async function captureCreatedInternalPurchaseQrCode(webContents, activityName, reportProgress) {
    const details = await evaluate(webContents, buildInternalPurchaseActivityShareDetailsExpression(activityName));
    if (!details)
        throw new Error(`未找到「${activityName}」的淘宝推广信息`);
    const deliveryUrl = buildInternalPurchaseDeliveryUrl(details);
    const qrExpression = buildInternalPurchaseQrDataUrlExpression();
    try {
        await navigateAndWait(webContents, deliveryUrl, '活动推广');
        await ensureInternalPurchaseActivityExposuresDisabled(webContents, reportProgress);
        await waitFor(webContents, `Boolean(${qrExpression})`, 20_000);
        const dataUrl = await evaluate(webContents, qrExpression);
        if (!dataUrl)
            throw new Error('淘宝活动推广页未返回真实二维码');
        return dataUrl;
    }
    finally {
        await navigateAndWait(webContents, exports.INTERNAL_PURCHASE_ACTIVITY_LIST_URL, '活动列表').catch(() => undefined);
    }
}
async function ensureInternalPurchaseActivityExposuresDisabled(webContents, reportProgress) {
    const labels = ['搜索透出', '首页关注频道'];
    const stateExpression = buildInternalPurchaseExposureStateExpression();
    reportProgress?.({
        phase: 'create',
        stage: 'qr',
        title: '关闭活动透出',
        detail: '正在检查搜索透出和首页关注频道',
        status: 'running'
    });
    await waitFor(webContents, `(${stateExpression}).every((state) => state.found && state.controlFound)`, 20_000);
    for (const label of labels) {
        const states = await evaluate(webContents, stateExpression);
        const state = states.find((candidate) => candidate.label === label);
        if (!state?.found || !state.controlFound) {
            throw new Error(`淘宝活动推广页未找到“${label}”开关`);
        }
        if (state.closed)
            continue;
        if (state.disabled) {
            throw new Error(`淘宝活动推广页的“${label}”开关不可操作`);
        }
        reportProgress?.({
            phase: 'create',
            stage: 'qr',
            title: '关闭活动透出',
            detail: `正在关闭${label}`,
            status: 'running'
        });
        await trustedClick(webContents, buildInternalPurchaseExposureSwitchResolver(label));
        const closeConfirmationResolver = buildInternalPurchaseExposureCloseConfirmationResolver();
        if (await waitForResult(webContents, `Boolean(${closeConfirmationResolver})`, 2_000)) {
            reportProgress?.({
                phase: 'create',
                stage: 'qr',
                title: '关闭活动透出',
                detail: `正在确认关闭${label}`,
                status: 'running'
            });
            await trustedClick(webContents, closeConfirmationResolver);
        }
        await waitFor(webContents, `(${stateExpression}).find((state) => state.label === ${JSON.stringify(label)})?.closed`, 12_000);
    }
    const finalStates = await evaluate(webContents, stateExpression);
    if (!labels.every((label) => finalStates.find((state) => state.label === label)?.closed)) {
        throw new Error('淘宝活动推广页未能确认两个活动透出均已关闭');
    }
    reportProgress?.({
        phase: 'create',
        stage: 'qr',
        title: '活动透出已关闭',
        detail: '搜索透出、首页关注频道均已关闭',
        status: 'success'
    });
}
function buildPreparation(plan, status, products, runningActivities, message, scheduleAdjustment) {
    return {
        status,
        activityUrl: exports.INTERNAL_PURCHASE_CREATE_URL,
        activityName: plan.name,
        audience: 'fans',
        startsAt: plan.startsAt,
        endsAt: plan.endsAt,
        ...(scheduleAdjustment ? { scheduleAdjustment } : {}),
        products,
        runningActivities,
        checkedAt: new Date().toISOString(),
        message
    };
}
async function ensureInternalPurchaseDateRangeBeforeSubmit(webContents, plan, reportProgress) {
    // The caller freezes the final schedule once. Recomputing it on every retry
    // can change the date range without changing the confirmed activity name.
    const schedule = { startsAt: new Date(plan.startsAt), endsAt: new Date(plan.endsAt), adjusted: false };
    const readVisibleRange = async () => await evaluate(webContents, buildInternalPurchaseVisibleDateRangeExpression());
    const initialRange = await readVisibleRange();
    await delay(900);
    const stableRange = await readVisibleRange();
    if (classifyInternalPurchaseVisibleDateRange(initialRange, schedule.startsAt, schedule.endsAt) === 'match'
        && classifyInternalPurchaseVisibleDateRange(stableRange, schedule.startsAt, schedule.endsAt) === 'match') {
        return;
    }
    reportProgress?.({
        phase: 'create',
        stage: 'submit',
        title: '提交前校准活动时间',
        detail: schedule.adjusted
            ? '确认创建时原开始时间已过期，正在保持原活动时长并重新填写'
            : '正在更新并核对活动时间，随后重新校验商品与 SKU 配置',
        status: 'running'
    });
    const updatedTimesOnly = hasInternalPurchaseVisibleDateRangeDates(stableRange, schedule.startsAt, schedule.endsAt) && await fillInternalPurchaseDateRangeTimesOnly(webContents, schedule.startsAt, schedule.endsAt);
    if (!updatedTimesOnly) {
        await fillDateRange(webContents, schedule.startsAt, schedule.endsAt, { allowCalendarDateShift: false });
    }
    await delay(1_500);
    const correctedRange = await readVisibleRange();
    const classification = classifyInternalPurchaseVisibleDateRange(correctedRange, schedule.startsAt, schedule.endsAt);
    if (classification !== 'match') {
        const reason = classification === 'invalid'
            ? '结束时间不晚于开始时间'
            : classification === 'missing'
                ? '页面未返回完整的开始和结束时间'
                : '页面时间与任务时间不一致';
        throw new Error(`淘宝活动时间校验失败：${reason}；活动尚未提交，请重新执行任务`);
    }
}
async function fillInternalPurchaseDateRangeTimesOnly(webContents, start, end) {
    const startParts = localParts(start);
    const endParts = localParts(end);
    const triggerExpression = buildInternalPurchaseDateRangeTriggerExpression();
    const confirmResolver = buildInternalPurchaseDateRangeConfirmResolver();
    const visibleStartDateResolver = buildInternalPurchasePickerInputResolver('.next-range-picker-panel-input-start-date input');
    const visibleEndDateResolver = buildInternalPurchasePickerInputResolver('.next-range-picker-panel-input-end-date input');
    const appliedExpression = buildInternalPurchaseDateRangeAppliedExpression(`${startParts.date} ${startParts.hour}:${startParts.minute}`, `${endParts.date} ${endParts.hour}:${endParts.minute}`);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await trustedClick(webContents, triggerExpression);
        const pickerReady = await waitForResult(webContents, `Boolean(${visibleStartDateResolver}) && Boolean(${visibleEndDateResolver})`, 5_000);
        if (!pickerReady)
            continue;
        const datesStillMatch = await waitForResult(webContents, `(${visibleStartDateResolver})?.value === ${JSON.stringify(startParts.date)}
        && (${visibleEndDateResolver})?.value === ${JSON.stringify(endParts.date)}`, 1_500);
        if (!datesStillMatch) {
            await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'ESCAPE' });
            await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'ESCAPE' });
            await delay(300);
            return false;
        }
        try {
            await fillVisiblePickerTimeInput(webContents, '.next-range-picker-panel-input-start-time input', startParts.hour, startParts.minute);
            await fillVisiblePickerTimeInput(webContents, '.next-range-picker-panel-input-end-time input', endParts.hour, endParts.minute);
            await fillVisiblePickerTimeInput(webContents, '.next-range-picker-panel-input-start-time input', startParts.hour, startParts.minute);
        }
        catch {
            await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'ESCAPE' });
            await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'ESCAPE' });
            await delay(500);
            continue;
        }
        await trustedClick(webContents, confirmResolver);
        if (await waitForResult(webContents, appliedExpression, 5_000)) {
            await delay(1_500);
            if (await waitForResult(webContents, appliedExpression, 1_500))
                return true;
        }
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'ESCAPE' });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'ESCAPE' });
        await delay(400);
    }
    return false;
}
async function fillDateRange(webContents, start, end, options = {}) {
    let appliedStart = new Date(start);
    let appliedEnd = new Date(end);
    let startParts = localParts(appliedStart);
    let endParts = localParts(appliedEnd);
    const triggerExpression = buildInternalPurchaseDateRangeTriggerExpression();
    const confirmResolver = buildInternalPurchaseDateRangeConfirmResolver();
    const visibleStartDateResolver = buildInternalPurchasePickerInputResolver('.next-range-picker-panel-input-start-date input');
    const visibleEndDateResolver = buildInternalPurchasePickerInputResolver('.next-range-picker-panel-input-end-date input');
    let appliedExpression = buildInternalPurchaseDateRangeAppliedExpression(`${startParts.date} ${startParts.hour}:${startParts.minute}`, `${endParts.date} ${endParts.hour}:${endParts.minute}`);
    await waitFor(webContents, `Boolean(${triggerExpression})`, 30_000);
    let calendarDateResolved = false;
    let lastTimeInputError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await trustedClick(webContents, triggerExpression);
        const pickerReady = await waitForResult(webContents, `Boolean(${visibleStartDateResolver}) && Boolean(${visibleEndDateResolver})`, 30_000);
        if (!pickerReady) {
            await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'ESCAPE' });
            await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'ESCAPE' });
            await delay(500);
            continue;
        }
        if (!calendarDateResolved && options.allowCalendarDateShift !== false) {
            calendarDateResolved = true;
            const calendarReady = await openVisibleCalendarDatePanel(webContents, visibleStartDateResolver, visibleEndDateResolver);
            if (calendarReady) {
                const availableCalendarDate = await evaluate(webContents, buildInternalPurchaseEarliestAvailableCalendarDateExpression(startParts.date));
                if (availableCalendarDate && availableCalendarDate !== startParts.date) {
                    const shifted = shiftInternalPurchaseScheduleToCalendarDate(appliedStart, appliedEnd, availableCalendarDate);
                    appliedStart = shifted.startsAt;
                    appliedEnd = shifted.endsAt;
                    startParts = localParts(appliedStart);
                    endParts = localParts(appliedEnd);
                    appliedExpression = buildInternalPurchaseDateRangeAppliedExpression(`${startParts.date} ${startParts.hour}:${startParts.minute}`, `${endParts.date} ${endParts.hour}:${endParts.minute}`);
                }
            }
        }
        await selectCalendarDate(webContents, visibleStartDateResolver, visibleEndDateResolver, startParts.date);
        await selectCalendarDate(webContents, visibleEndDateResolver, visibleStartDateResolver, endParts.date);
        try {
            await fillVisiblePickerTimeInput(webContents, '.next-range-picker-panel-input-start-time input', startParts.hour, startParts.minute);
            await fillVisiblePickerTimeInput(webContents, '.next-range-picker-panel-input-end-time input', endParts.hour, endParts.minute);
            await fillVisiblePickerTimeInput(webContents, '.next-range-picker-panel-input-start-time input', startParts.hour, startParts.minute);
        }
        catch (error) {
            lastTimeInputError = error instanceof Error
                ? error
                : new Error('淘宝时间输入框暂时不可用');
            await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'ESCAPE' });
            await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'ESCAPE' });
            await delay(700);
            continue;
        }
        await trustedClick(webContents, confirmResolver);
        if (await waitForResult(webContents, appliedExpression, 12_000)) {
            await delay(1_500);
            if (await waitForResult(webContents, appliedExpression, 1_500)) {
                return { startsAt: appliedStart, endsAt: appliedEnd };
            }
        }
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'ESCAPE' });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'ESCAPE' });
        await delay(600);
    }
    if (lastTimeInputError) {
        throw new Error(`${lastTimeInputError.message}；已自动重新打开日期面板重试 3 次，活动尚未提交`);
    }
    throw new Error('淘宝活动时间未保存，已自动重试；请检查页面日期控件后再执行');
}
async function selectCalendarDate(webContents, inputResolver, alternateInputResolver, date) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const calendarReady = await openVisibleCalendarDatePanel(webContents, inputResolver, alternateInputResolver);
        if (!calendarReady) {
            if (attempt < 2)
                continue;
            throw new Error('淘宝页面日期面板尚未完成显示，已自动重试；请保留页面后再次执行');
        }
        const dateState = await evaluate(webContents, buildInternalPurchaseCalendarDateStateExpression(date));
        if (dateState === 'disabled') {
            throw new Error(`淘宝页面当前不允许选择 ${date}；请把活动时间改为日历中可选择的日期后重试`);
        }
        if (dateState === 'missing') {
            throw new Error(`淘宝页面日历中暂未显示 ${date}；请检查活动日期后重试`);
        }
        const targetFocused = await waitForResult(webContents, `document.activeElement === (${inputResolver})`, 1_500);
        if (!targetFocused)
            continue;
        await delay(300);
        await trustedClick(webContents, `
      Array.from(document.querySelectorAll('td[title=${JSON.stringify(date)}]'))
        .find((element) => {
          const rect = element.getBoundingClientRect();
          return !element.classList.contains('next-disabled')
            && rect.width > 0
            && rect.height > 0;
        })
    `);
        if (await waitForResult(webContents, `(${inputResolver})?.value === ${JSON.stringify(date)}`, 2_500)) {
            await delay(500);
            return;
        }
    }
    throw new Error(`淘宝日期输入框没有接收 ${date}，已自动重试；活动尚未提交`);
}
async function openVisibleCalendarDatePanel(webContents, inputResolver, alternateInputResolver) {
    const calendarReadyExpression = buildInternalPurchaseVisibleCalendarReadyExpression();
    const triggerExpression = buildInternalPurchaseDateRangeTriggerExpression();
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await trustedClick(webContents, inputResolver);
        const targetFocused = await waitForResult(webContents, `document.activeElement === (${inputResolver})`, 1_500);
        if (targetFocused
            && await waitForResult(webContents, calendarReadyExpression, 1_500))
            return true;
        // Taobao can leave a focused date input attached to the time panel. Moving
        // focus to the other date field first forces the visible calendar grid to mount.
        await trustedClick(webContents, alternateInputResolver);
        const alternateFocused = await waitForResult(webContents, `document.activeElement === (${alternateInputResolver})`, 1_500);
        if (alternateFocused
            && await waitForResult(webContents, calendarReadyExpression, 1_500)) {
            await trustedClick(webContents, inputResolver);
            const recoveredTargetFocused = await waitForResult(webContents, `document.activeElement === (${inputResolver})`, 1_500);
            if (recoveredTargetFocused
                && await waitForResult(webContents, calendarReadyExpression, 1_500))
                return true;
        }
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'ESCAPE' });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'ESCAPE' });
        await delay(300);
        await trustedClick(webContents, triggerExpression);
        await waitForResult(webContents, `Boolean(${inputResolver})`, 2_000);
    }
    return false;
}
async function fillVisiblePickerTimeInput(webContents, inputSelector, hour, minute) {
    const resolver = buildInternalPurchasePickerInputResolver(inputSelector);
    const value = `${hour}:${minute}`;
    let inputSeen = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const inputReady = await waitForResult(webContents, `(() => {
        const element = ${resolver};
        return Boolean(element)
          && !element.disabled
          && !element.readOnly;
      })()`, 2_500);
        if (!inputReady) {
            await delay(300 + (attempt * 200));
            continue;
        }
        inputSeen = true;
        try {
            await trustedClick(webContents, resolver);
        }
        catch {
            await delay(300 + (attempt * 200));
            continue;
        }
        const focused = await waitForResult(webContents, `(() => {
        const element = ${resolver};
        return Boolean(element)
          && !element.disabled
          && !element.readOnly
          && document.activeElement === element;
      })()`, 1_500);
        if (!focused) {
            await delay(300 + (attempt * 200));
            continue;
        }
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
        await delay(120);
        const selected = await waitForResult(webContents, `(() => {
        const element = ${resolver};
        return element?.selectionStart === 0
          && element?.selectionEnd === element?.value.length;
      })()`, 600);
        if (!selected) {
            await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
            await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
            await delay(120);
        }
        await insertVisibleTextThroughDebugger(webContents, value).catch(() => undefined);
        if (await waitForResult(webContents, `(${resolver})?.value === ${JSON.stringify(value)}`, 1_500)) {
            await delay(300);
            return;
        }
        try {
            await replaceVisibleTextSlowly(webContents, resolver, value);
        }
        catch {
            await delay(300 + (attempt * 200));
            continue;
        }
        if (await waitForResult(webContents, `(${resolver})?.value === ${JSON.stringify(value)}`, 1_500)) {
            await delay(300);
            return;
        }
    }
    if (!inputSeen) {
        throw new Error(`淘宝时间输入框 ${value} 尚未启用，活动尚未提交`);
    }
    throw new Error(`淘宝时间输入框连续重试仍未接收 ${value}，活动尚未提交`);
}
async function insertVisibleTextThroughDebugger(webContents, value) {
    await (0, internal_purchase_background_input_1.insertInternalPurchaseText)(webContents, value);
}
function localParts(value) {
    const pad = (part) => String(part).padStart(2, '0');
    return {
        date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
        hour: pad(value.getHours()),
        minute: pad(value.getMinutes())
    };
}
function buildInternalPurchaseActivityName(storeName, now) {
    const timestamp = [
        now.getMonth() + 1,
        now.getDate(),
        now.getHours(),
        now.getMinutes()
    ].map((part) => String(part).padStart(2, '0')).join('');
    const normalizedStore = storeName
        .trim()
        .replace(/(?:旗舰店|专营店|企业店|官方店|店铺)$/u, '')
        .replace(/\s+/g, '') || '店铺';
    return `${normalizedStore.slice(0, Math.max(1, 12 - timestamp.length))}${timestamp}`.slice(0, 12);
}
function buildInternalPurchaseActivityNameFromExisting(activityName, now) {
    const storeName = activityName.trim().replace(/\d{8}$/u, '') || '店铺';
    return buildInternalPurchaseActivityName(storeName, now);
}
function localDateTime(value) {
    const parts = localParts(value);
    return `${parts.date}T${parts.hour}:${parts.minute}`;
}
async function navigateAndWait(webContents, url, expectedText, forceReload = false) {
    const stateExpression = `(() => {
    if (document.readyState !== 'complete') return 'loading';
    if (document.body.innerText.includes(${JSON.stringify(expectedText)})) return 'expected';
    if (/login(?:myseller)?\\.taobao\\.com|login\\.tmall\\.com/iu.test(location.href)) return 'login';
    if (/^https:\\/\\/myseller\\.taobao\\.com\\/home\\.htm\\/QnworkbenchHome\\/?(?:[?#].*)?$/iu.test(location.href)) {
      return 'seller-home';
    }
    return 'other';
  })()`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        if (forceReload || webContents.getURL() !== url) {
            await loadInternalPurchaseUrl(webContents, url);
        }
        const settled = await waitForResult(webContents, `['expected', 'login', 'seller-home'].includes(${stateExpression})`, 30_000);
        if (!settled)
            throw new Error('等待淘宝页面响应超时');
        const state = await evaluate(webContents, stateExpression);
        if (state === 'expected' || state === 'login')
            return;
        if (!shouldRetryInternalPurchaseDeepLink(webContents.getURL(), url, attempt)) {
            break;
        }
        await delay(600);
    }
    throw new Error('等待淘宝页面响应超时');
}
async function resetInternalPurchaseCreatePage(webContents) {
    if (webContents.getURL() !== exports.INTERNAL_PURCHASE_CREATE_URL)
        return;
    const hasStaleDialog = await evaluate(webContents, `Boolean(
    document.querySelector('input[placeholder="搜索商品ID"]') ||
    (${buildInternalPurchaseSkuStageExpression()})
  )`).catch(() => false);
    if (!hasStaleDialog)
        return;
    await loadInternalPurchaseUrl(webContents, exports.INTERNAL_PURCHASE_CREATE_URL);
}
async function loadInternalPurchaseUrl(webContents, url) {
    try {
        await webContents.loadURL(url);
    }
    catch (error) {
        if (!(0, promotion_background_page_1.isElectronNavigationAbort)(error)) {
            throw error;
        }
    }
}
function shouldRetryInternalPurchaseDeepLink(currentUrl, requestedUrl, attempt) {
    return attempt === 0
        && requestedUrl.startsWith('https://myseller.taobao.com/home.htm/')
        && !currentUrl.startsWith(requestedUrl)
        && /^https:\/\/myseller\.taobao\.com\/home\.htm\/QnworkbenchHome\/?(?:[?#].*)?$/iu.test(currentUrl);
}
function isTaobaoLoginUrl(url) {
    return /login(?:myseller)?\.taobao\.com|login\.tmall\.com/iu.test(url);
}
async function replaceVisibleTextSlowly(webContents, resolver, value) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            // Resolve and click again on every attempt. Taobao can replace an input
            // node while its responsive layout or overlay is settling.
            await trustedClick(webContents, resolver);
        }
        catch {
            await delay(320 + (attempt * 180));
            continue;
        }
        const focused = await waitForResult(webContents, `(() => {
        const element = ${resolver};
        if (!element || element.disabled || element.readOnly) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0
          && rect.height > 0
          && document.activeElement === element;
      })()`, 1_800);
        if (!focused) {
            await delay(320 + (attempt * 180));
            continue;
        }
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
        await delay(90);
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'Backspace' });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'Backspace' });
        await delay(90);
        // Some Taobao inputs occasionally ignore Ctrl+A while their visible
        // responsive layout or overlay is still settling. Home + Shift+End is a
        // second, fully visible keyboard selection path before replacement.
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'HOME' });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'HOME' });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'END', modifiers: ['shift'] });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'END', modifiers: ['shift'] });
        await delay(90);
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: 'Backspace' });
        await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: 'Backspace' });
        await delay(120);
        for (const [index, character] of Array.from(value).entries()) {
            if (/^[\x20-\x7e]$/u.test(character)) {
                await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode: character });
            }
            await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'char', keyCode: character });
            if (/^[\x20-\x7e]$/u.test(character)) {
                await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode: character });
            }
            await delay(85 + ((index % 3) * 20));
        }
        const entered = await waitForResult(webContents, `(${resolver})?.value === ${JSON.stringify(value)}`, 2_500);
        if (entered)
            return;
        await delay(320 + (attempt * 180));
    }
    throw new Error('淘宝页面输入框连续重试仍未获得焦点或完整接收输入内容');
}
async function clickElement(webContents, resolver) {
    const clicked = await evaluate(webContents, `(() => { const element = ${resolver}; if (!element) return false; element.click(); return true; })()`);
    if (!clicked)
        throw new Error('淘宝页面操作控件暂时不可用');
    await delay(120);
}
async function trustedClick(webContents, resolver) {
    const point = await elementPoint(webContents, resolver);
    await delay(80);
    await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'mouseMove', x: point.x, y: point.y });
    await delay(120);
    await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await delay(180);
}
async function trustedActivateElementWithKeyboard(webContents, resolver, keyCode) {
    const focused = await evaluate(webContents, `(() => {
    const element = ${resolver};
    if (!element) return false;
    element.scrollIntoView({ block: 'center' });
    element.focus({ preventScroll: true });
    return document.activeElement === element;
  })()`);
    if (!focused) {
        throw new Error('淘宝创建按钮暂时无法获得键盘焦点，请检查页面后重试');
    }
    await delay(100);
    await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyDown', keyCode });
    await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'keyUp', keyCode });
    await delay(180);
}
async function trustedHover(webContents, resolver) {
    const point = await elementPoint(webContents, resolver);
    await delay(80);
    await (0, internal_purchase_background_input_1.sendInternalPurchaseInput)(webContents, { type: 'mouseMove', x: point.x, y: point.y });
    await delay(350);
}
async function elementPoint(webContents, resolver) {
    const point = await evaluate(webContents, `(() => { const element = ${resolver}; if (!element) return null; element.scrollIntoView({ block: 'center' }); const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return null; return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }; })()`);
    if (!point)
        throw new Error('淘宝页面操作控件不可见');
    return point;
}
async function waitFor(webContents, expression, timeoutMs = 12_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (webContents.isDestroyed())
            throw new Error('淘宝页面已关闭');
        const ready = await evaluate(webContents, `Boolean(${expression})`).catch(() => false);
        if (ready)
            return;
        await delay(200);
    }
    throw new Error('等待淘宝页面响应超时');
}
async function waitForResult(webContents, expression, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (webContents.isDestroyed())
            return false;
        const ready = await evaluate(webContents, `Boolean(${expression})`).catch(() => false);
        if (ready)
            return true;
        await delay(120);
    }
    return false;
}
async function evaluate(webContents, expression) {
    return await webContents.executeJavaScript(expression, true);
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function closeConfirmationForActivity(activityName) {
    return `确认结束活动 ${activityName.trim()}`;
}
