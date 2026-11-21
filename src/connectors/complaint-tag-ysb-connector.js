'use strict';
// 营商保（ss.taobao.com）连接器：投诉 / 打标 的 mtop 查询与提交。
// 与同类工作台同一套平台字段：接口由页面自带的 window.lib.mtop.request 签名（账号维度风控参数由页面注入）。
const ysb=require('../shared/complaint-tag');

const MTOP_READY_TIMEOUT_MS=45_000;
const MTOP_CALL_TIMEOUT_MS=30_000;

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

function isLoginUrl(url){
  return /login\.taobao\.com|login\.tmall\.com|passport\.(?:taobao|tmall)\.com|\/login/iu.test(String(url||''));
}

/** 页面必须已经加载出营商保自己的 lib.mtop（签名由页面负责）。 */
async function waitForMtopReady(webContents,{timeoutMs=MTOP_READY_TIMEOUT_MS}={}){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(webContents.isDestroyed())throw Object.assign(new Error('营商保页面已关闭'),{code:'page-closed'});
    const url=webContents.getURL?.()||'';
    if(isLoginUrl(url))throw Object.assign(new Error('营商保需要登录：请先在店铺浏览器登录该店铺'),{code:'needs-login'});
    const ready=await webContents.executeJavaScript('!!(window.lib && window.lib.mtop && typeof window.lib.mtop.request === "function")',true).catch(()=>false);
    if(ready)return true;
    await sleep(500);
  }
  throw Object.assign(new Error('营商保页面加载超时，请稍后重试'),{code:'page-not-ready'});
}

/** 调用营商保 mtop（与页面自身参数一致）。返回 {ok,ret,data,timedOut}。 */
async function callMtop(webContents,api,data,method){
  const options={
    api,
    v:'1.0',
    data:data||{},
    type:method,
    dataType:'json',
    valueType:'original',
    AntiCreep:true,
    AntiFlood:true
  };
  const script=`(() => {
    const lib = window.lib;
    if (!lib || !lib.mtop || typeof lib.mtop.request !== 'function') return { ok: false, ret: ['MTOP_UNAVAILABLE'] };
    return lib.mtop.request(${JSON.stringify(options)}).then(
      (response) => {
        const ret = (response && response.ret) || [];
        const success = !ret.length || String(ret[0]).indexOf('SUCCESS') === 0;
        return success ? { ok: true, data: (response && response.data) || null } : { ok: false, ret: ret.map(String) };
      },
      (error) => ({ ok: false, ret: ((error && error.ret) || [String((error && error.message) || error)]).map(String) })
    );
  })()`;
  let timer;
  const timeout=new Promise(resolve=>{
    timer=setTimeout(()=>resolve({ok:false,ret:['COMPLAINT_TAG_TIMEOUT'],timedOut:true}),MTOP_CALL_TIMEOUT_MS);
  });
  try{
    return await Promise.race([
      webContents.executeJavaScript(script,true).then(
        value=>(value&&typeof value==='object'?value:{ok:false,ret:['EMPTY_RESPONSE']}),
        error=>({ok:false,ret:[error instanceof Error?error.message:String(error)]})
      ),
      timeout
    ]);
  }finally{
    if(timer)clearTimeout(timer);
  }
}

/** 查询失败统一抛错：把风控/登录/业务失败翻译成带 code 的错误。 */
function throwForFailure(result){
  if(result.timedOut)throw Object.assign(new Error('营商环境请求超时（可能出现安全验证）'),{code:'security-challenge'});
  const failure=ysb.classifyMtopFailure(result.ret);
  if(failure==='security-challenge')throw Object.assign(new Error('营商保出现安全验证（滑块），已暂停'),{code:'security-challenge'});
  if(failure==='login-required')throw Object.assign(new Error('店铺登录已失效，请重新登录后再试'),{code:'needs-login'});
  throw Object.assign(new Error(`营商保返回：${ysb.describeMtopRet(result.ret)}`),{code:'platform-error',ret:result.ret});
}

const asRecord=value=>(value&&typeof value==='object'?value:{});
const asString=value=>(typeof value==='string'||typeof value==='number'?String(value):'');

/** 剩余投诉额度。 */
async function queryComplaintQuota(webContents){
  const result=await callMtop(webContents,ysb.YSB_API.complaintQuota,{},'GET');
  if(!result.ok)throwForFailure(result);
  const quota=Number(asRecord(asRecord(result.data).model).availableQuota);
  return Number.isFinite(quota)?quota:null;
}

/** 按订单号查询可投诉订单（近 90 天）。 */
async function searchComplaintOrders(webContents,{orderIds,sceneCode}){
  const result=await callMtop(webContents,ysb.YSB_API.complaintOrderSearch,{
    orderIdList:orderIds.join(','),
    complaintTypeCodeLev3:sceneCode,
    page:1,
    pageSize:orderIds.length
  },'GET');
  if(!result.ok)throwForFailure(result);
  const model=asRecord(result.data).model;
  const orders=[];
  for(const entry of Array.isArray(model)?model:[]){
    const row=asRecord(entry);
    const subject=asRecord(row.subject);
    const orderId=asString(subject.actualId)||asString(subject.orderId)||asString(subject.id);
    if(!orderId||!orderIds.includes(orderId))continue;
    const allowComplaint=row.allowComplaint===true;
    const reason=asString(row.notAllowReason);
    const fee=Number(subject.actualTotalFee);
    orders.push({
      orderId,
      buyerNick:asString(subject.buyerNick),
      itemTitle:asString(subject.itemTitle),
      itemImageUrl:asString(subject.itemMainUrl),
      totalFeeFen:Number.isFinite(fee)?fee:null,
      orderTime:asString(subject.orderTime)||asString(subject.createTime),
      allowComplaint,
      notAllowReason:reason,
      notAllowLabel:allowComplaint?'':ysb.describeNotAllowReason(reason)
    });
  }
  return orders;
}

/** 账号打标是否已通过营商保测评。 */
async function checkTagExam(webContents){
  const result=await callMtop(webContents,ysb.YSB_API.tagCheck,{},'GET');
  if(!result.ok)throwForFailure(result);
  return asRecord(asRecord(result.data).model).pass===true;
}

/** 查询某买家的订单（用于自动关联最近一笔未打标订单）。 */
async function queryTagOrders(webContents,{buyerNick,sceneCode}){
  const result=await callMtop(webContents,ysb.YSB_API.tagOrderQuery,{
    buyerNick,
    scenarioCodeLev2:sceneCode,
    page:1,
    pageSize:100
  },'GET');
  if(!result.ok)throwForFailure(result);
  const model=asRecord(result.data).model;
  return (Array.isArray(model)?model:[]).map(entry=>{
    const row=asRecord(entry);
    return {
      orderId:asString(row.orderId)||asString(row.bizOrderId)||asString(row.id),
      orderTime:asString(row.orderTime)||asString(row.createTime)||asString(row.gmtCreate)||asString(row.payTime),
      alreadyTag:row.alreadyTag===true
    };
  }).filter(candidate=>candidate.orderId);
}

/** 提交一张投诉单；返回 {ok,model,ret,timedOut}。 */
async function submitComplaint(webContents,data){
  return await callMtop(webContents,ysb.YSB_API.complaintSubmit,data,'POST');
}

/** 提交一个账号打标；返回 {ok,model,ret,timedOut}。 */
async function submitTag(webContents,data){
  return await callMtop(webContents,ysb.YSB_API.tagSubmit,data,'POST');
}

module.exports={
  MTOP_READY_TIMEOUT_MS,
  waitForMtopReady,
  callMtop,
  throwForFailure,
  queryComplaintQuota,
  searchComplaintOrders,
  checkTagExam,
  queryTagOrders,
  submitComplaint,
  submitTag,
  isLoginUrl
};
