'use strict';
// 投诉打标（营商保 ss.taobao.com）：异常订单投诉 + 账号打标 的公共规则。
// 场景码、接口名、提交报文与同类工作台保持一致（其 2026-10-08 只读探查的同一套平台字段）。

const YSB_COMPLAINT_LIST_URL='https://ss.taobao.com/app#/complaint-center/list';
const YSB_CLOUDTAG_LIST_URL='https://ss.taobao.com/app#/cloudtag/list';

const YSB_API={
  complaintQuota:'mtop.alibaba.ksr.seller.complaint.quota.query',
  complaintOrderSearch:'mtop.alibaba.ksr.seller.complaint.subject.order.search',
  complaintSubmit:'mtop.alibaba.ksr.seller.complaint.submit',
  complaintRecords:'mtop.alibaba.ksr.seller.complaint.record.pagequery',
  tagCheck:'mtop.alibaba.ksr.cloudtag.check',
  tagOrderQuery:'mtop.alibaba.ksr.cloudtag.tag.order.query',
  tagSubmit:'mtop.alibaba.ksr.cloudtag.tag.submit',
  tagRecords:'mtop.alibaba.ksr.cloudtag.tag.record.query'
};

const COMPLAINT_SOURCE='YSB_MAIN';
/** 营商保单张投诉单最多 20 个订单。 */
const COMPLAINT_MAX_ORDERS_PER_SUBMIT=20;
/** 账号打标一次最多关联 10 个订单；批量时只关联 1 个。 */
const TAG_MAX_ORDERS_PER_SUBMIT=10;
const COMPLAINT_MAX_ORDERS_PER_BATCH=400;
const TAG_MAX_NICKS_PER_BATCH=200;
const COMPLAINT_MAX_DESCRIPTION=500;

/** 异常订单 → 异常无法发货 下的三级场景（营商保 config.queryAll）。 */
const COMPLAINT_ORDER_SCENES=[
  {code:'mjsxrljyzxxd_ycwffh_abnormal_order',name:'买家涉嫌扰乱经营秩序下单'},
  {code:'jfbfxxd_ycwffh_abnormal_order',name:'纠纷报复性下单'},
  {code:'txgj/yxdd_ycwffh_abnormal_order',name:'同行攻击/要挟订单'}
];

const COMPLAINT_DESCRIPTION_TEMPLATES=[
  '买家多次恶意下单并申请退款，影响链接成交'
];

const TAG_SCENARIOS=[
  {code:'abnormal_refund',name:'异常退货',scenes:[
    {code:'cshqyqth_abnormal_refund',name:'超售后期要求退货'},
    {code:'yxecxsth_abnormal_refund',name:'影响二次销售退货'},
    {code:'gyshspth_abnormal_refund',name:'故意损坏商品退货'},
    {code:'qtcj_abnormal_refund',name:'其他场景'},
    {code:'thkbsjdb_abnormal_refund',name:'退货空包少件调包'},
    {code:'xjwlth_abnormal_refund',name:'虚假物流退货'},
    {code:'thyybzs_abnormal_refund',name:'退货原因不真实'},
    {code:'txdpjf_abnormal_refund',name:'套现店铺积分'}
  ]},
  {code:'abnormal_complaint',name:'异常投诉',scenes:[
    {code:'wazzdkdfh_abnormal_complaint',name:'因商家未按照消费者指定快递发货而投诉'},
    {code:'djwwl_abnormal_complaint',name:'因大件无物流跟踪记录而投诉发货问题'},
    {code:'qtcj_abnormal_complaint',name:'其他场景'}
  ]},
  {code:'abnormal_rate',name:'异常评价',scenes:[
    {code:'wrrm_abnormal_rate',name:'评价侮辱辱骂'},
    {code:'yxpc_abnormal_rate',name:'评价要挟赔偿'},
    {code:'cps_abnormal_rate',name:'差评师'},
    {code:'qtcj_abnormal_rate',name:'其他场景'}
  ]},
  {code:'abnormal_order',name:'异常拍下',scenes:[
    {code:'hnd_abnormal_order',name:'黄牛党'},
    {code:'zytsr_abnormal_order',name:'职业投诉人'},
    {code:'qtcj_abnormal_order',name:'其他场景'},
    {code:'ycdm_abnormal_order',name:'异常代买'}
  ]},
  {code:'net_fraud',name:'网络诈骗',scenes:[
    {code:'mcqtxfz_net_fraud',name:'冒充其他消费者身份诈骗'},
    {code:'sydywzzp_net_fraud',name:'使用钓鱼网站诈骗'},
    {code:'qtcj_net_fraud',name:'其他场景'}
  ]}
];

function findComplaintScene(code){
  return COMPLAINT_ORDER_SCENES.find(scene=>scene.code===code)||null;
}

function findTagScene(code){
  for(const type of TAG_SCENARIOS){
    const scene=type.scenes.find(candidate=>candidate.code===code);
    if(scene)return {type:type.name,typeCode:type.code,name:scene.name,code:scene.code};
  }
  return null;
}

function parseOrderIds(raw){
  const tokens=String(raw||'').split(/[\s,，;；、]+/u).map(token=>token.trim()).filter(Boolean);
  const seen=new Set();
  const result={valid:[],invalid:[],duplicates:[]};
  for(const token of tokens){
    if(!/^\d{12,20}$/u.test(token))result.invalid.push(token);
    else if(seen.has(token))result.duplicates.push(token);
    else{seen.add(token);result.valid.push(token);}
  }
  return result;
}

/** 旺旺昵称可以含空格，因此只按换行 / 逗号 / 分号拆分。 */
function parseBuyerNicks(raw){
  const tokens=String(raw||'').split(/[\r\n,，;；]+/u).map(token=>token.trim()).filter(Boolean);
  const seen=new Set();
  const result={valid:[],invalid:[],duplicates:[]};
  for(const token of tokens){
    if(token.length>64||/\*\*/u.test(token))result.invalid.push(token);
    else if(seen.has(token))result.duplicates.push(token);
    else{seen.add(token);result.valid.push(token);}
  }
  return result;
}

const NOT_ALLOW_LABELS={
  COMPLAINTED:'已投诉过',
  COMPLAINED:'已投诉过',
  OVERTIME:'超过可投诉时间（近 90 天）',
  OVER_TIME:'超过可投诉时间（近 90 天）',
  TIME_OUT:'超过可投诉时间（近 90 天）'
};

function describeNotAllowReason(reason){
  if(!reason)return '平台不允许投诉';
  return NOT_ALLOW_LABELS[reason]||`平台不允许投诉（${reason}）`;
}

/**
 * 订单 → 买家分组键。
 * 我们不用同类工作台的 SaaS 买家库：昵称未打码（不含 *）且存在时按 `nick:<昵称>` 合并；
 * 打码昵称（t**6）会撞码，绝不合并，按 `order:<订单号>` 单独成单。
 */
function buyerKeyForOrder(order){
  const nick=String(order?.buyerNick||'').trim();
  if(nick&&!/\*/.test(nick))return `nick:${nick}`;
  return `order:${String(order?.orderId||'')}`;
}

/** 按真实买家分组（buyerKey）；同一买家超过 20 单时拆成多张投诉单。多单的买家排在前面。 */
function groupComplaintOrders(orders,maxPerSubmit=COMPLAINT_MAX_ORDERS_PER_SUBMIT){
  const byBuyer=new Map();
  for(const order of orders){
    if(!order.allowComplaint)continue;
    const buyerKey=order.buyerKey||`order:${order.orderId}`;
    const entry=byBuyer.get(buyerKey)||{buyerNick:order.buyerNick||'未知买家',buyerResolved:order.buyerResolved,buyerKey,orderIds:[]};
    entry.orderIds.push(order.orderId);
    byBuyer.set(buyerKey,entry);
  }
  const groups=[];
  const entries=[...byBuyer.entries()].sort((a,b)=>b[1].orderIds.length-a[1].orderIds.length);
  for(const [buyerKey,entry] of entries){
    for(let index=0;index<entry.orderIds.length;index+=maxPerSubmit){
      groups.push({
        key:`${buyerKey}#${index/maxPerSubmit+1}`,
        buyerKey,
        buyerNick:entry.buyerNick,
        buyerResolved:entry.buyerResolved,
        orderIds:entry.orderIds.slice(index,index+maxPerSubmit)
      });
    }
  }
  return groups;
}

function buildComplaintSubmitData(input){
  if(!findComplaintScene(input.sceneCode))throw new Error('COMPLAINT_SCENE_UNSUPPORTED');
  if(!input.orderIds.length||input.orderIds.length>COMPLAINT_MAX_ORDERS_PER_SUBMIT)throw new Error('COMPLAINT_ORDER_COUNT_INVALID');
  const description=String(input.description||'').trim();
  if(!description)throw new Error('COMPLAINT_DESCRIPTION_REQUIRED');
  return {
    complaintSource:COMPLAINT_SOURCE,
    complaintTypeCodeLev3:input.sceneCode,
    subjectList:JSON.stringify([{subjectType:'ORDER',subjectId:input.orderIds.join(',')}]),
    // 该场景旺旺举证（授权小二查看近 90 天聊天）为必填项，必须为 true。
    complaintContent:JSON.stringify([
      {type:'WANGWANG_CHAT',selected1:true},
      {type:'TEXT_DESC',text1:description}
    ])
  };
}

function pickTagOrder(candidates){
  if(!candidates.length)return {status:'no-order',orderId:'',orderTime:''};
  const open=candidates.filter(candidate=>!candidate.alreadyTag);
  if(!open.length)return {status:'already-tagged',orderId:'',orderTime:''};
  const latest=[...open].sort((a,b)=>b.orderTime.localeCompare(a.orderTime))[0];
  return {status:'ready',orderId:latest.orderId,orderTime:latest.orderTime};
}

function buildTagSubmitData(input){
  if(!findTagScene(input.sceneCode))throw new Error('TAG_SCENE_UNSUPPORTED');
  const buyerNick=String(input.buyerNick||'').trim();
  if(!buyerNick)throw new Error('TAG_BUYER_REQUIRED');
  if(!input.orderIds.length||input.orderIds.length>TAG_MAX_ORDERS_PER_SUBMIT)throw new Error('TAG_ORDER_COUNT_INVALID');
  return {
    buyerNick,
    orderIdList:input.orderIds.join(','),
    scenarioCode:input.sceneCode,
    submitEntrance:COMPLAINT_SOURCE
  };
}

/** 与内购会 / 评价检查同一套风控识别。 */
function classifyMtopFailure(ret){
  const text=Array.isArray(ret)?ret.join(' '):String(ret??'');
  if(/FAIL_SYS_USER_VALIDATE|RGV587_ERROR|FAIL_SYS_ILLEGAL_ACCESS.*(验证|滑块)|punish|x5sec/iu.test(text))return 'security-challenge';
  if(/FAIL_SYS_SESSION_EXPIRED|FAIL_SYS_TOKEN_EXOIRED|FAIL_SYS_TOKEN_EXPIRED|SESSION_EXPIRED|未登录/iu.test(text))return 'login-required';
  return 'business';
}

/** 把 mtop ret 里的“CODE::说明”变成给人看的说明。 */
function describeMtopRet(ret){
  const first=Array.isArray(ret)?ret[0]:ret;
  if(!first)return '平台未返回结果';
  const [code,message]=String(first).split('::');
  return (message&&message.trim())||code.trim();
}

module.exports={
  YSB_COMPLAINT_LIST_URL,YSB_CLOUDTAG_LIST_URL,YSB_API,COMPLAINT_SOURCE,
  COMPLAINT_MAX_ORDERS_PER_SUBMIT,TAG_MAX_ORDERS_PER_SUBMIT,
  COMPLAINT_MAX_ORDERS_PER_BATCH,TAG_MAX_NICKS_PER_BATCH,COMPLAINT_MAX_DESCRIPTION,
  COMPLAINT_ORDER_SCENES,COMPLAINT_DESCRIPTION_TEMPLATES,TAG_SCENARIOS,
  findComplaintScene,findTagScene,parseOrderIds,parseBuyerNicks,
  describeNotAllowReason,buyerKeyForOrder,groupComplaintOrders,
  buildComplaintSubmitData,pickTagOrder,buildTagSubmitData,
  classifyMtopFailure,describeMtopRet
};
