'use strict';

const {isoDate}=require('../domain');
const {FullSyncError}=require('../full-sync');

// Prepared raw accounting adapter only. It has no transport, credentials,
// persistence, capabilities registration, fee classification or product mapping.
// Evidence: ymf-soft 1.0.14 queryDayBill + the redacted 2026-09-17 XX response.
// That response proves field names/pagination, not the monetary unit or the
// meaning of payable versus amount. Keep exact strings and unit unconfirmed.
const ORIGIN='https://fundtax.taobao.com';
const PATH='/api/hjbill/month/queryDayBill';
const PAGE_SIZE=200,MAX_ROWS=100000;
const SOURCE_KIND='expense-day-bill';
const fail=(code,message)=>{throw new FullSyncError(code,message);};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function rangeOf({start,end}={}){
  isoDate(start);isoDate(end);
  if(start>end)fail('BILLING_INVALID_RANGE','账单起始日期不能晚于结束日期');
  // The reference reads one selected month at a time. A caller wanting a range
  // across months must split it explicitly; no hidden change to requested dates.
  if(start.slice(0,7)!==end.slice(0,7))fail('BILLING_INVALID_RANGE','原始账单应按自然月拆分读取');
  return {start,end};
}
function pageOf(page){
  if(!Number.isSafeInteger(page)||page<1||page>MAX_ROWS/PAGE_SIZE)fail('BILLING_INVALID_PAGE','账单页码无效或超出读取上限');
  return page;
}
function buildBillingRequest({start,end,page=1}={}){
  rangeOf({start,end});pageOf(page);
  return {origin:ORIGIN,path:PATH,method:'GET',
    query:{_input_charset:'utf-8',pageNo:page,pageSize:PAGE_SIZE,billCycleBegin:start,billCycleEnd:end,itemCode:''},
    headers:{Referer:'https://myseller.taobao.com/'}};
}
function responseProblem(body){
  const parts=[body,body?.errors,body?.info].filter(record);
  const text=parts.flatMap(part=>['code','errorCode','message','msg','ret'].flatMap(key=>
    Array.isArray(part[key])?part[key].filter(value=>typeof value==='string'):typeof part[key]==='string'?[part[key]]:[])).join(' ');
  if(/USER_VALIDATE|RGV587|CAPTCHA|验证码|安全验证|封禁|冻结|访问受限|punish/i.test(text))fail('USER_VALIDATION_REQUIRED','账单后台要求验证或限制了访问，本次读取已停止');
  if(/SESSION_EXPIRED|TOKEN_EXPIRED|TOKEN_EXOIRED|NEED_LOGIN|NOT_LOGIN|请.*登录|登录失效|未登录/i.test(text))fail('LOGIN_EXPIRED','账单后台登录已失效，本次读取已停止');
  if(/FREQUENCY|THROTTL|RATE_LIMIT|频繁|限流|频率/i.test(text))fail('RATE_LIMITED','账单后台限制了读取频率，本次读取已停止');
}
function subjectIdOf(value){
  if(typeof value==='number'&&!Number.isSafeInteger(value))fail('BILLING_INVALID_SUBJECT','账务科目标识超出精确整数范围');
  if((typeof value!=='string'&&typeof value!=='number')||!/^\d{1,40}$/.test(String(value))||/^0+$/.test(String(value)))fail('BILLING_INVALID_SUBJECT','账单缺少有效账务科目标识');
  return String(value);
}
function textOf(value,label,{code=false}={}){
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>240||/[\u0000-\u001f\u007f]/.test(value))fail('BILLING_INVALID_SUBJECT',`账单${label}无效或缺失`);
  if(code&&!/^[A-Za-z0-9_.-]{1,160}$/.test(value))fail('BILLING_INVALID_SUBJECT',`账单${label}不是已确认的科目代码`);
  return value;
}
function decimalOf(value){
  if(typeof value!=='string'&&typeof value!=='number')fail('BILLING_INVALID_AMOUNT','原始账单金额缺失或不是精确数值');
  if(typeof value==='number'&&!Number.isFinite(value))fail('BILLING_INVALID_AMOUNT','原始账单数值不是有限金额');
  const text=String(value);
  // Do not guess units, turn missing values into zero, strip currency suffixes,
  // parse ranges, round cents, or convert unsigned expense into a deduction.
  if(!/^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,8})?$/.test(text)||!Number.isFinite(Number(text)))fail('BILLING_INVALID_AMOUNT','原始账单金额必须为有限十进制数，不能含单位、缩写或区间');
  if(typeof value==='number'){
    const [whole,fraction='']=text.replace(/^-/,'').split('.');
    if(fraction.length>2||BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2))>BigInt(Number.MAX_SAFE_INTEGER))fail('BILLING_INVALID_AMOUNT','原始账单数值超出已确认的精确金额范围');
  }
  return text;
}
function rowOf(raw,{start,end}){
  if(!record(raw))fail('BILLING_INVALID_ROWS','账单明细不是有效对象');
  if(typeof raw.billCycle!=='string'||!/^\d{8}$/.test(raw.billCycle))fail('BILLING_DATE_MISMATCH','账单缺少明确的归属日期');
  const date=`${raw.billCycle.slice(0,4)}-${raw.billCycle.slice(4,6)}-${raw.billCycle.slice(6,8)}`;
  isoDate(date);
  if(date<start||date>end)fail('BILLING_DATE_MISMATCH','账单日期超出所选读取区间');
  return {date,subjectId:subjectIdOf(raw.itemId),subjectCode:textOf(raw.itemCode,'费用科目',{code:true}),
    subjectName:textOf(raw.itemName,'费用科目名称'),accountCode:textOf(raw.accountCode,'账户科目',{code:true}),
    accountName:textOf(raw.accountName,'账户科目名称'),payable:decimalOf(raw.curTotalPayable),amount:decimalOf(raw.curTotalAmount)};
}
function rowKey(row){return JSON.stringify([row.date,row.subjectId,row.subjectCode,row.accountCode]);}
function parseBillingPage(body,{start,end,page=1}={}){
  rangeOf({start,end});pageOf(page);
  if(!record(body))fail('BILLING_INVALID_RESPONSE','账单后台响应结构无效');
  responseProblem(body);
  if(body.success!==true)fail('BILLING_INVALID_RESPONSE','账单后台未明确返回成功');
  if(body.errors!==undefined&&body.errors!==null)fail('BILLING_INVALID_RESPONSE','账单后台同时返回错误信息，不能确认完整结果');
  const content=body.content;
  if(!record(content)||!Array.isArray(content.data))fail('BILLING_INVALID_RESPONSE','账单后台缺少明确明细列表');
  if(!Number.isSafeInteger(content.count)||content.count<0||content.count>MAX_ROWS)fail('BILLING_INVALID_TOTAL','账单后台缺少明确总条数或超出读取上限');
  if(content.pageSize!==PAGE_SIZE||content.curPage!==page)fail('BILLING_PAGE_MISMATCH','账单后台页码或页大小与请求不一致');
  if(typeof content.hasNext!=='boolean')fail('BILLING_PAGE_MISMATCH','账单后台缺少明确的后续页状态');
  const total=content.count,pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  if(page>pages||content.hasNext!==(page<pages))fail('BILLING_PAGE_MISMATCH','账单总数、页码和后续页状态相互矛盾');
  const expected=Math.min(PAGE_SIZE,Math.max(0,total-(page-1)*PAGE_SIZE));
  if(content.data.length!==expected)fail('BILLING_ROW_COUNT_MISMATCH','账单本页条数与总数不一致，不能确认完整读取');
  const seen=new Set();
  const rows=content.data.map(raw=>{
    const row=rowOf(raw,{start,end}),key=rowKey(row);
    if(seen.has(key))fail('BILLING_DUPLICATE_ROW','同一日账务科目重复，需核对账单粒度后再读取');
    seen.add(key);return row;
  });
  return {sourceKind:SOURCE_KIND,scope:'accounting-subject-day',start,end,page,pageSize:PAGE_SIZE,total,hasNext:content.hasNext,
    amountUnit:'unconfirmed',mappingStatus:'raw-unclassified',rows};
}
function assembleBillingPages(bodies,{start,end}={}){
  rangeOf({start,end});
  if(!Array.isArray(bodies)||bodies.length<1||bodies.length>MAX_ROWS/PAGE_SIZE)fail('BILLING_INCOMPLETE_PAGES','账单原始分页集合为空或超出上限');
  const pages=bodies.map((body,index)=>parseBillingPage(body,{start,end,page:index+1}));
  const total=pages[0].total,expectedPages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  if(pages.length!==expectedPages||pages.some(page=>page.total!==total))fail('BILLING_INCOMPLETE_PAGES','账单分页缺失或各页总数变化，不能确认完整读取');
  const rows=[],seen=new Set();
  for(const page of pages)for(const row of page.rows){
    const key=rowKey(row);
    if(seen.has(key))fail('BILLING_DUPLICATE_ROW','不同分页出现重复账务科目，不能重复计入账单');
    seen.add(key);rows.push(row);
  }
  if(rows.length!==total)fail('BILLING_ROW_COUNT_MISMATCH','账单最终条数与明确总数不一致');
  return {sourceKind:SOURCE_KIND,scope:'accounting-subject-day',start,end,pageSize:PAGE_SIZE,pages:pages.length,total,
    amountUnit:'unconfirmed',mappingStatus:'raw-unclassified',rows};
}

module.exports={ORIGIN,PATH,PAGE_SIZE,MAX_ROWS,buildBillingRequest,parseBillingPage,assembleBillingPages};
