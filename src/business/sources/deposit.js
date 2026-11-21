'use strict';

const {createHash}=require('node:crypto');
const {isoDate}=require('../domain');
const {FullSyncError}=require('../full-sync');

// Cash guarantee-account flow only. Insurance-backed guarantee policies require
// a separate completeness check; this DTO never claims all guarantee sources.
// Observed cash ledger: CNY minor units; type 1/1 is recharge, 2/3 is deduction.
// The scale and inclusion of cash refund deductions were reconciled against
// the reference daily/month totals on 2026-09-18 (raw 9169 -> 91.69 yuan).
const ORIGIN='https://h5api.m.taobao.com';
const API='mtop.alibaba.jibu.accounting.jour.get';
const PATH=`/h5/${API}/1.0/`;
const PAGE_SIZE=2000,MAX_ROWS=100000;
const SOURCE_KIND='cash-deposit-journal';
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message)=>{throw new FullSyncError(code,message);};

function rangeOf({start,end}={}){
  isoDate(start);isoDate(end);
  if(start>end||(Date.parse(end)-Date.parse(start))/86400000>=31)fail('DEPOSIT_INVALID_RANGE','现金保证金一次仅接受连续31天以内的日期区间');
  return {start,end};
}
function pageOf(page){
  if(!Number.isSafeInteger(page)||page<1||page>MAX_ROWS/PAGE_SIZE)fail('DEPOSIT_INVALID_PAGE','现金保证金页码无效或超出读取上限');
  return page;
}
function buildDepositRequest({start,end,page=1}={}){
  rangeOf({start,end});pageOf(page);
  return {origin:ORIGIN,path:PATH,method:'GET',api:API,version:'1.0',
    query:{jsv:'2.7.0',api:API,v:'1.0',ttid:'11320@taobao_WEB_9.9.99',ecode:'0',type:'originaljson',dataType:'json'},
    data:{pageSize:PAGE_SIZE,pageNum:page,startTime:`${start} 00:00:00`,endTime:`${end} 23:59:59`,paymentChannelType:1,bizCode:'tmall.jibu'},
    headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:'https://jibu.taobao.com/'}};
}
function checkSuccess(body){
  if(!record(body))fail('DEPOSIT_INVALID_RESPONSE','现金保证金后台响应结构无效');
  const ret=body.ret,text=Array.isArray(ret)?ret.filter(value=>typeof value==='string').join(' '):typeof ret==='string'?ret:'';
  if(/USER_VALIDATE|RGV587|CAPTCHA|验证码|安全验证|封禁|访问受限|punish/i.test(text))fail('USER_VALIDATION_REQUIRED','保证金后台要求验证或限制访问，本次读取已停止');
  if(/SESSION_EXPIRED|TOKEN_EXPIRED|TOKEN_EXOIRED|NEED_LOGIN|NOT_LOGIN|FAIL_SYS_LOGIN|请.*登录|登录失效|未登录/i.test(text))fail('LOGIN_EXPIRED','保证金后台登录已失效，本次读取已停止');
  if(/FREQUENCY|THROTTL|RATE_LIMIT|频繁|限流|频率/i.test(text))fail('RATE_LIMITED','保证金后台限制了读取频率，本次读取已停止');
  if(!Array.isArray(ret)||ret.length!==1||!['SUCCESS::Mtop','SUCCESS::调用成功'].includes(ret[0]))fail('DEPOSIT_INVALID_RESPONSE','现金保证金后台未明确返回成功');
  if(body.success===false||body.data?.success===false||body.errors!=null)fail('DEPOSIT_INVALID_RESPONSE','现金保证金后台同时返回失败或错误信息');
  if(body.api!==undefined&&body.api!==API||body.v!==undefined&&body.v!=='1.0')fail('DEPOSIT_SOURCE_MISMATCH','现金保证金响应接口或版本与请求不一致');
}
function minorOf(value){
  if(!Number.isSafeInteger(value)||value<0)fail('DEPOSIT_INVALID_AMOUNT','现金保证金金额或余额必须是明确的非负整数分');
  return value;
}
function timestampOf(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))fail('DEPOSIT_INVALID_DATE','现金保证金流水缺少明确的发生时间');
  const timestamp=Date.parse(value.replace(' ','T')+'Z');
  if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,19)!==value.replace(' ','T'))fail('DEPOSIT_INVALID_DATE','现金保证金流水时间无效');
  return value;
}
function journalHash(value){
  // Preserve a long JSON numeric token as a string in the transport before JSON
  // parsing loses precision. Refuse an already-rounded unsafe Number.
  if(typeof value==='number'&&!Number.isSafeInteger(value))fail('DEPOSIT_INVALID_JOURNAL','保证金流水标识已超出精确整数范围');
  if((typeof value!=='number'&&typeof value!=='string')||!/^[1-9]\d{0,39}$/.test(String(value)))fail('DEPOSIT_INVALID_JOURNAL','保证金流水缺少可核对重复的标识');
  return createHash('sha256').update(`jibu-cash:${String(value)}`).digest('hex');
}
function rowOf(raw,{start,end}){
  if(!record(raw))fail('DEPOSIT_INVALID_ROWS','现金保证金流水不是有效对象');
  if(raw.bizCode!=='tmall.jibu'||raw.paymentChannelType!==1)fail('DEPOSIT_SOURCE_MISMATCH','流水不属于已核实的天猫现金保证金账户');
  if(raw.currency!=='CNY')fail('DEPOSIT_UNSUPPORTED_CURRENCY','保证金流水币种不是已核实的人民币');
  const credit=raw.amountOperationType===1&&raw.operationType===1;
  const debit=raw.amountOperationType===2&&raw.operationType===3;
  if(!credit&&!debit)fail('DEPOSIT_UNKNOWN_OPERATION','保证金出现未核实的操作类型，不能推定收入或扣款');
  const occurredAt=timestampOf(raw.bizDate),createdAt=timestampOf(raw.createTime),date=occurredAt.slice(0,10);
  if(date<start||date>end)fail('DEPOSIT_DATE_MISMATCH','保证金流水发生日期超出所选区间');
  const amountMinor=minorOf(raw.amount),availableMinor=minorOf(raw.totalAvailableAmount),currentMinor=minorOf(raw.totalCurrAmount),frozenMinor=minorOf(raw.totalFreezeAmount);
  if(BigInt((amountMinor/100).toFixed(2).replace('.',''))!==BigInt(amountMinor))fail('DEPOSIT_INVALID_AMOUNT','现金保证金金额超出精确分币转换范围');
  if(BigInt(availableMinor)+BigInt(frozenMinor)!==BigInt(currentMinor))fail('DEPOSIT_BALANCE_MISMATCH','保证金可用、冻结与当前余额关系不一致');
  return {date,occurredAt,createdAt,journalHash:journalHash(raw.jourId),currency:'CNY',paymentChannelType:1,
    amountOperationType:raw.amountOperationType,operationType:raw.operationType,direction:debit?'debit':'credit',amountMinor,amount:amountMinor/100,
    deductionMinor:debit?amountMinor:0,deductionAmount:debit?amountMinor/100:0,balances:{availableMinor,currentMinor,frozenMinor}};
}
function parseDepositPage(body,{start,end,page=1}={}){
  rangeOf({start,end});pageOf(page);checkSuccess(body);
  const model=body.data?.model;
  if(!record(model))fail('DEPOSIT_INVALID_RESPONSE','现金保证金后台缺少明确流水列表');
  if(!Number.isSafeInteger(model.total)||model.total<0||model.total>MAX_ROWS)fail('DEPOSIT_INVALID_TOTAL','现金保证金后台缺少有效总条数或超出上限');
  // The official empty response uses list:null with an explicit numeric total 0.
  // Missing list or null with a nonzero count never proves complete coverage.
  const list=model.list===null&&model.total===0?[]:model.list;
  if(!Array.isArray(list))fail('DEPOSIT_INVALID_RESPONSE','现金保证金后台缺少明确流水列表');
  const total=model.total,pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  if(page>pages||model.pageNum!==undefined&&model.pageNum!==page||model.pageSize!==undefined&&model.pageSize!==PAGE_SIZE)fail('DEPOSIT_PAGE_MISMATCH','现金保证金页码或页大小与请求不一致');
  const hasNext=page<pages,expected=Math.min(PAGE_SIZE,Math.max(0,total-(page-1)*PAGE_SIZE));
  if(model.hasNext!==undefined&&model.hasNext!==hasNext)fail('DEPOSIT_PAGE_MISMATCH','现金保证金分页结束状态与总数不一致');
  if(list.length!==expected)fail('DEPOSIT_INCOMPLETE_ROWS','现金保证金本页条数与明确总数不一致');
  const seen=new Set(),rows=list.map(raw=>{
    const row=rowOf(raw,{start,end});
    if(seen.has(row.journalHash))fail('DEPOSIT_DUPLICATE_JOURNAL','现金保证金本页存在重复流水，不能重复计费');
    seen.add(row.journalHash);return row;
  });
  return {sourceKind:SOURCE_KIND,scope:'cash-deposit-flow',start,end,page,pageEvidence:'request-bound',pageSize:PAGE_SIZE,total,hasNext,
    amountUnit:'CNY-cent',normalizedAmountUnit:'CNY-yuan',includesInsurance:false,rows};
}
function assembleDepositPages(bodies,{start,end}={}){
  rangeOf({start,end});
  if(!Array.isArray(bodies)||!bodies.length||bodies.length>MAX_ROWS/PAGE_SIZE)fail('DEPOSIT_INCOMPLETE_PAGES','现金保证金原始分页集合为空或超出上限');
  const pages=bodies.map((body,index)=>parseDepositPage(body,{start,end,page:index+1}));
  const total=pages[0].total,expected=Math.max(1,Math.ceil(total/PAGE_SIZE));
  if(pages.length!==expected||pages.some(page=>page.total!==total))fail('DEPOSIT_INCOMPLETE_PAGES','现金保证金分页缺失或各页总数发生变化');
  const seen=new Set(),rows=[];
  for(const page of pages)for(const row of page.rows){
    if(seen.has(row.journalHash))fail('DEPOSIT_DUPLICATE_JOURNAL','不同保证金分页出现重复流水，不能重复计费');
    seen.add(row.journalHash);rows.push(row);
  }
  if(rows.length!==total)fail('DEPOSIT_INCOMPLETE_ROWS','现金保证金完整条数与明确总数不一致');
  return {sourceKind:SOURCE_KIND,scope:'cash-deposit-flow',start,end,pageSize:PAGE_SIZE,pages:pages.length,total,complete:true,
    amountUnit:'CNY-cent',normalizedAmountUnit:'CNY-yuan',includesInsurance:false,rows};
}

module.exports={ORIGIN,API,PATH,PAGE_SIZE,MAX_ROWS,buildDepositRequest,parseDepositPage,assembleDepositPages};
