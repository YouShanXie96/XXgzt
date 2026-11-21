'use strict';

// One report contract for the renderer and workbook export. This file contains
// no platform requests, calculations, credentials or application state.
(function expose(root,factory){
  const schema=factory();
  if(typeof module==='object'&&module.exports)module.exports=schema;
  else root.XXBusinessReportSchema=schema;
})(typeof window==='object'?window:globalThis,()=>{
  const column=(key,label,type='money',source='unavailable')=>({key,label,type,source});
  const group=(label,columns)=>({label,columns});
  const reports={
    daily:[
      group('日报信息',[column('date','日期','date','identity')]),
      group('销售',[column('payAmount','销售额','money','sycm'),column('buyers','买家数','number','sycm')]),
      group('利润与采购',[column('customProfit','自定义利润','money','manual'),column('procurementRevenue','采收款','money','procurement'),column('procurementCount','采购量','number','procurement'),column('procurementProfit','采利润','money','profit'),column('profitRate','利润率','percent','profit')]),
      group('流量与转化',[column('visitors','访客量','number','sycm'),column('searchVisitors','搜索访客','number','sycm'),column('conversionRate','转化率','percent','sycm'),column('unitPrice','客单价','money','sycm')]),
      group('退款',[column('refundAmount','退款金额','money','sycm'),column('refundScenes','退款场景','text','refund')]),
      group('操作单',[column('operationPayAmount','操作销售额','money','operations'),column('operationBuyers','操作买家数','number','operations'),column('operationExpense','操作费用','money','operations')]),
      group('推广',[column('adSpend','推广总花费','money','promotion'),column('adRevenue','推广总成交','money','promotion'),column('adRoi','推广ROI','decimal','promotion'),column('shopSalesRoi','全店销售ROI','decimal','promotion')]),
      group('费用',[column('affiliateCommission','淘客佣金','money','affiliate'),column('depositDeduction','保证金扣款','money','billing'),column('shippingInsurance','运费险','money','insurance'),column('marketingExpense','营销费用','money','marketing'),column('reimbursementExpense','报销费用','money','manual'),column('technicalFee','技术费','money','billing'),column('warehouseExpense','中转仓','money','manual'),column('customerServiceExpense','客服','money','manual'),column('platformFee','扣点','money','billing'),column('taxFee','税费','money','manual')]),
      group('计算',[column('grossProfit','毛利润','money','profit'),column('grossProfitRate','毛利润占比','percent','profit'),column('promotionShare','推广占比','percent','promotion')]),
    ],
    product:[
      // 商品状态在页面上显示在商品ID下方（出/仓），导出时按用户要求单独成列并放在上架时间前面；
      // 上架天数由商品资料的创建时间在导出当天现算，不写回历史快照。
      group('基本信息',[column('storeName','店铺','text','identity'),column('category','类目','text','sycm'),column('title','商品标题','title','sycm'),column('itemStatus','商品状态','text','seller'),column('createdAt','上架时间','date','sycm'),column('listedDays','上架天数','text','seller'),column('productId','商品ID','text','identity'),column('operator','运营','text','manual'),column('todo','待办','text','manual'),column('todoAt','待办时间','text','manual'),column('blacklist','黑名单','text','manual'),column('blacklistAt','加黑时间','text','manual')]),
      group('减操作单数据',[column('adjustedBuyers','买家数','number','adjusted'),column('adjustedPayAmount','销售额','money','adjusted'),column('adjustedConversionRate','转化率','percent','adjusted')]),
      group('生意参谋',[column('visitors','访客数','number','sycm'),column('buyers','买家数','number','sycm'),column('payAmount','销售额','money','sycm'),column('conversionRate','付转化率','percent','sycm'),column('unitPrice','客单价','money','sycm'),column('cartItems','加购件数','number','sycm'),column('searchVisitors','搜索访客','number','sycm'),column('refundRate','退款率','percent','refund')]),
      group('操作单',[column('operationOrders','单量','number','operations'),column('operationCleaned','清洗','number','operations'),column('operationPrincipal','本金','money','operations'),column('operationCommission','佣金','money','operations')]),
      group('利润来源',[column('receivedAmount','实收款','money','procurement'),column('procurementOrders','采购单量','number','procurement'),column('profit','利润','money','profit'),column('unitProfit','单件利润','money','profit'),column('profitRate','利润率','percent','profit'),column('breakEvenRoi','保本ROI','decimal','profit')]),
      group('广告数据',[column('adSpend','广告费','money','promotion'),column('adRoi','广告ROI','decimal','promotion'),column('shopSalesRoi','销售ROI','decimal','promotion'),column('sitePromotion','推广渠道','text','promotion')]),
      group('费用',[column('platformFee','扣点','money','billing'),column('marketingExpense','品牌新享','money','marketing'),column('depositDeduction','保证金','money','billing'),column('taxFee','税费','money','manual'),column('otherFee','其它','money','manual')]),
      group('维护',[column('reviewCount','评语数','number','reviews'),column('reviewImageCount','晒图数','number','reviews'),column('pendingReviewCount','待评数','number','reviews')]),
      group('计算',[column('grossProfit','毛利润','money','profit'),column('grossProfitRate','毛利率','percent','profit')]),
    ],
  };
  const legacy=[column('pageViews','浏览量','number','sycm'),column('refundAmount','退款金额','money','sycm'),column('adRevenue','推广成交额','money','promotion'),column('siteAdSpend','全站花费','money','promotion'),column('vocRefundCount','客户之声成功退款笔数','number','refund'),column('vocPaidOrderCount','客户之声支付订单笔数','number','refund'),column('vocRefundAmount','客户之声成功退款金额','money','refund')];
  // 'recharge'（推广充值）已在 v0.7.2 从同步弹窗移除，但旧快照的来源覆盖里仍然存在，
  // 保留在来源白名单里只为能继续读取历史数据；界面按能力清单展示，不会再出现这一项。
  const SYNC_SOURCES=['sycm','promotion','billing','insurance','recharge','refund','reviews','seller','marketing','affiliate','channels'];
  const byKey=new Map();
  for(const col of [...Object.values(reports).flatMap(groups=>groups.flatMap(item=>item.columns)),...legacy]){
    const existing=byKey.get(col.key);
    if(existing&&(existing.type!==col.type||existing.source!==col.source))throw new Error('经营报表字段定义不一致');
    byKey.set(col.key,col);
  }
  const definitions=[...byKey.values()];
  // “减操作单数据”由查询层按 生意参谋 − 操作单 计算，不再作为保留空字段。
  // 技术费/中转仓/客服费用已由“扣费设置”的月额按天折算，不再作为保留空字段。
  const reserved=definitions.filter(col=>['procurement','profit','operations'].includes(col.source)||['customProfit','reimbursementExpense'].includes(col.key)).map(col=>col.key);
  const numeric=definitions.filter(col=>['number','money','percent','decimal'].includes(col.type));
  const freeze=value=>{Object.freeze(value);for(const child of Object.values(value))if(child&&typeof child==='object'&&!Object.isFrozen(child))freeze(child);return value;};
  const assertMode=mode=>{if(!Object.hasOwn(reports,mode))throw new Error('经营模式仅支持 daily 或 product');return mode;};
  const groups=mode=>reports[assertMode(mode)];
  const columns=mode=>groups(mode).flatMap(item=>item.columns);
  function exportColumns(mode){
    const counts=new Map();for(const col of columns(mode))counts.set(col.label,(counts.get(col.label)||0)+1);
    return groups(mode).flatMap(item=>item.columns.map(col=>({...col,label:counts.get(col.label)>1?`${item.label}·${col.label}`:col.label})));
  }
  function notes(mode){
    assertMode(mode);
    return [mode==='daily'?'销售额、买家数、转化率和客单价使用生意参谋官方原始口径，尚未剔除操作单，不能与已扣操作的参考日报直接等同。':'“生意参谋”组按所选区间的商品日记录累计；商品创建时间取自商品信息。','自定义利润和报销费用由用户逐日手工录入，保存或剔除都必须填写原因；合计只统计已填写日期，空白日期不按0计算。采购、操作单、客服、技术费、中转仓及其他利润指标仍保持空白。','未取得或未选择同步的指标显示为空，空值不代表零；只有广告报表全量完成且商品当日无广告记录时，该日推广金额按0计。','访客、买家、搜索访客的区间合计为日记录累计，不是区间去重人数；转化率、客单价、全店销售ROI由相应累计值计算。',...(mode==='product'?['广告ROI取商品推广报表的官方ROI；广告来源完整但商品当日无记录时推广花费按0计，ROI因没有花费保持空白；跨日退款率缺少已核实的分母时留空。','本机经营商品数为所选来源与日期中已保存的日记录按商品ID去重，不是店铺商品库总数，也不包含从未出现在经营报表中的商品；页面同时显示官方本次报表的总条数与去重商品数。']:[])];
  }
  return freeze({groups,columns,exportColumns,notes,SYNC_SOURCES,DEFINITIONS:definitions,METRICS:numeric.map(col=>col.key),COUNTS:numeric.filter(col=>col.type==='number').map(col=>col.key),PERCENTAGES:numeric.filter(col=>col.type==='percent').map(col=>col.key),RESERVED_NULL_FIELDS:reserved});
});
