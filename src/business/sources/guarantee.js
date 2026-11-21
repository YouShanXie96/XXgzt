'use strict';

// Pure composite evidence adapter. Policy identifiers exist only in temporary
// main-process request descriptors; persisted proof contains their hashes.
const {createHash}=require('node:crypto');
const {isoDate,dateList}=require('../domain');
const {FullSyncError}=require('../full-sync');
const deposit=require('./deposit');
const INSURANCE_ORIGIN='https://acs.m.taobao.com';
const POLICY_API='mtop.alibaba.jibu.accounting.insurance.info.list.get';
const POLICY_PATH=`/h5/${POLICY_API}/1.0/`;
const MAX_POLICIES=100,MAX_PAGES=1000;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message)=>{throw new FullSyncError(code,message);};
function policyNumberOf(value){
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>200||/[\u0000-\u001f\u007f]/.test(value))fail('GUARANTEE_INVALID_POLICY','保证金保单标识缺失或格式无效');
  return value;
}
function policyHash(value){return createHash('sha256').update(`jibu-policy:${policyNumberOf(value)}`).digest('hex');}
function hashOf(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail('GUARANTEE_INVALID_PROOF','保证金来源缺少有效脱敏摘要');return value;}
function rangeOf({start,end,mode}={}){
  isoDate(start);isoDate(end);
  if(mode!==undefined&&mode!=='daily'||start>end||(Date.parse(end)-Date.parse(start))/86400000>=31)fail('GUARANTEE_INVALID_RANGE','保证金只支持连续31天以内的店铺日报区间');
  return {start,end};
}
function success(body,api){
  const ret=body?.ret,detail=Array.isArray(ret)?ret.filter(value=>typeof value==='string').join(' '):'';
  if(/USER_VALIDATE|RGV587|CAPTCHA|验证码|安全验证|封禁|访问受限|punish/i.test(detail))fail('USER_VALIDATION_REQUIRED','保证金后台要求验证，读取已停止');
  if(/SESSION_EXPIRED|TOKEN_EXPIRED|TOKEN_EXOIRED|NEED_LOGIN|NOT_LOGIN|FAIL_SYS_LOGIN|登录失效|未登录/i.test(detail))fail('LOGIN_EXPIRED','保证金后台登录失效，读取已停止');
  if(/FREQUENCY|THROTTL|RATE_LIMIT|频繁|限流|频率/i.test(detail))fail('RATE_LIMITED','保证金后台限制读取频率，读取已停止');
  if(!record(body)||!Array.isArray(ret)||ret.length!==1||!['SUCCESS::Mtop','SUCCESS::调用成功'].includes(ret[0])||body.success===false||body.data?.success===false||body.errors!=null)fail('GUARANTEE_INVALID_RESPONSE','保证金后台未明确返回成功');
  if(body.api!==undefined&&body.api!==api||body.v!==undefined&&body.v!=='1.0')fail('GUARANTEE_SOURCE_MISMATCH','保证金后台接口或版本不一致');
}
function parsePolicyList(body){
  success(body,POLICY_API);const model=body.data?.model;
  if(!record(model)||!Number.isSafeInteger(model.total)||model.total<0||model.total>MAX_POLICIES)fail('GUARANTEE_INVALID_POLICIES','保单列表缺少有效完整总数或超过读取上限');
  const list=model.list===null&&model.total===0?[]:model.list;
  if(!Array.isArray(list)||list.length!==model.total||model.hasNext!==undefined&&model.hasNext!==false)fail('GUARANTEE_INCOMPLETE_POLICIES','保单列表未完整返回');
  const policyNumbers=list.map(row=>{if(!record(row))fail('GUARANTEE_INVALID_POLICY','保单记录无效');return policyNumberOf(row.insurancePolicyNo);});
  if(new Set(policyNumbers).size!==policyNumbers.length)fail('GUARANTEE_DUPLICATE_POLICY','保单列表重复，不能重复计算流水');
  return {policyNumbers,policyHashes:policyNumbers.map(policyHash)};
}
function buildInsuranceRequest({start,end,page=1,policyNumber}={}){
  const request=deposit.buildDepositRequest({...rangeOf({start,end}),page});
  return {...request,origin:INSURANCE_ORIGIN,query:{jsv:'2.7.0',api:deposit.API,v:'1.0',ecode:'1',type:'originaljson',timeout:'20000',dataType:'json'},
    data:{pageSize:deposit.PAGE_SIZE,pageNum:page,insurancePolicyNo:policyNumberOf(policyNumber),startTime:`${start} 00:00:00`,endTime:`${end} 23:59:59`,paymentChannelType:2,bizCode:'tmall.jibu'}};
}
function parseInsurancePage(body,{start,end,page=1,policyNumber}={}){
  buildInsuranceRequest({start,end,page,policyNumber});success(body,deposit.API);
  const model=body.data?.model,hash=policyHash(policyNumber);
  if(!record(model))fail('GUARANTEE_INVALID_RESPONSE','保险保证金缺少明确流水模型');
  if(model.insurancePolicyNo!==undefined&&model.insurancePolicyNo!==policyNumber)fail('GUARANTEE_POLICY_MISMATCH','保险保证金响应保单与请求不一致');
  const list=model.list===null&&model.total===0?[]:model.list;
  if(!Array.isArray(list))fail('GUARANTEE_INVALID_RESPONSE','保险保证金缺少完整流水列表');
  const cashCompatible=list.map(row=>{
    if(!record(row)||row.paymentChannelType!==2)fail('GUARANTEE_SOURCE_MISMATCH','流水不是已核实的保险保证金通道');
    if(row.insurancePolicyNo!==undefined&&row.insurancePolicyNo!==policyNumber)fail('GUARANTEE_POLICY_MISMATCH','保险保证金流水属于其他保单');
    return {...row,paymentChannelType:1};
  });
  // Reuse the exact enum, currency, cents, timestamps and balance checks. Channel
  // 2 is proven above before adapting solely for the pure cash row validator.
  const parsed=deposit.parseDepositPage({...body,data:{...body.data,model:{...model,list:cashCompatible}}},{start,end,page});
  return {...parsed,sourceKind:'insurance-deposit-journal',scope:'insurance-deposit-flow',includesInsurance:true,policyHash:hash,
    rows:parsed.rows.map((row,index)=>({...row,paymentChannelType:2,journalHash:createHash('sha256').update(`jibu-insurance:${String(list[index].jourId)}`).digest('hex')}))};
}
function normalizeLedgerPage(input,{start,end,page,insurance=false,policyHash:hash}={}){
  const expected={sourceKind:insurance?'insurance-deposit-journal':'cash-deposit-journal',scope:insurance?'insurance-deposit-flow':'cash-deposit-flow',start,end,page,pageEvidence:'request-bound',pageSize:deposit.PAGE_SIZE,amountUnit:'CNY-cent',normalizedAmountUnit:'CNY-yuan',includesInsurance:insurance};
  if(!record(input)||Object.entries(expected).some(([key,value])=>input[key]!==value)||!Array.isArray(input.rows)||typeof input.hasNext!=='boolean')fail('GUARANTEE_INVALID_PROOF','保证金来源页类型、日期或单位不一致');
  if(insurance&&hashOf(input.policyHash)!==hash)fail('GUARANTEE_POLICY_MISMATCH','保险保证金分页不属于当前保单摘要');
  const seen=new Set(),journalHashes=[];
  const raw=input.rows.map((row,index)=>{
    if(!record(row)||row.currency!=='CNY'||row.paymentChannelType!==(insurance?2:1))fail('GUARANTEE_INVALID_PROOF','保证金流水币种或通道不一致');
    const journal=hashOf(row.journalHash);if(seen.has(journal))fail('GUARANTEE_DUPLICATE_JOURNAL','保证金分页有重复流水');seen.add(journal);journalHashes.push(journal);
    return {bizCode:'tmall.jibu',jourId:String(index+1),paymentChannelType:1,currency:row.currency,bizDate:row.occurredAt,createTime:row.createdAt,
      amount:row.amountMinor,amountOperationType:row.amountOperationType,operationType:row.operationType,
      totalAvailableAmount:row.balances?.availableMinor,totalCurrAmount:row.balances?.currentMinor,totalFreezeAmount:row.balances?.frozenMinor};
  });
  const parsed=deposit.parseDepositPage({ret:['SUCCESS::调用成功'],data:{model:{list:raw,total:input.total,pageNum:input.page,pageSize:input.pageSize,hasNext:input.hasNext}}},{start,end,page});
  const rows=parsed.rows.map((row,index)=>{
    const actual=input.rows[index];
    for(const key of ['date','direction','amount','deductionMinor','deductionAmount'])if(actual[key]!==row[key])fail('GUARANTEE_INVALID_PROOF','保证金展示日期、方向或金额与原始分币不一致');
    return {...row,paymentChannelType:insurance?2:1,journalHash:journalHashes[index]};
  });
  return {...parsed,...expected,...(insurance?{policyHash:hash}:{}),rows};
}
function normalizeGuaranteeSource(input,request=input){
  const {start,end}=rangeOf(request);
  if(!record(input)||input.version!==1||input.key!=='billing'||input.kind!=='guarantee-ledger'||input.start!==start||input.end!==end)fail('GUARANTEE_INVALID_PROOF','保证金完整来源类型或区间不一致');
  if(!Array.isArray(input.policyHashes)||input.policyHashes.length>MAX_POLICIES||new Set(input.policyHashes.map(hashOf)).size!==input.policyHashes.length)fail('GUARANTEE_INVALID_POLICIES','保证金保单摘要重复或无效');
  if(!Array.isArray(input.cashPages)||!input.cashPages.length||!Array.isArray(input.insurancePages)||input.cashPages.length+input.insurancePages.length>MAX_PAGES)fail('GUARANTEE_INCOMPLETE_PAGES','保证金完整分页为空或超过读取上限');
  const seen=new Set();let rowCount=0;
  function segment(pages,offset,insurance=false,hash){
    const first=normalizeLedgerPage(pages[offset],{start,end,page:1,insurance,policyHash:hash}),expectedPages=Math.max(1,Math.ceil(first.total/deposit.PAGE_SIZE)),normalized=[];
    for(let page=1;page<=expectedPages;page++){
      const current=page===1?first:normalizeLedgerPage(pages[offset+page-1],{start,end,page,insurance,policyHash:hash});
      if(current.total!==first.total)fail('GUARANTEE_INCOMPLETE_PAGES','保证金分页总条数变化');
      for(const row of current.rows){if(seen.has(row.journalHash))fail('GUARANTEE_DUPLICATE_JOURNAL','保证金跨页或跨保单出现重复流水');seen.add(row.journalHash);rowCount++;}
      normalized.push(current);
    }
    if(rowCount>deposit.MAX_ROWS)fail('GUARANTEE_ROW_LIMIT','保证金总流水超过完整读取上限');
    return normalized;
  }
  const cashPages=segment(input.cashPages,0);if(cashPages.length!==input.cashPages.length)fail('GUARANTEE_INCOMPLETE_PAGES','现金保证金出现多余或重复分页');
  const insurancePages=[];let offset=0;
  for(const hash of input.policyHashes){const pages=segment(input.insurancePages,offset,true,hash);insurancePages.push(...pages);offset+=pages.length;}
  if(offset!==input.insurancePages.length)fail('GUARANTEE_INCOMPLETE_PAGES','保险保证金存在未声明保单或额外分页');
  return {version:1,key:'billing',kind:'guarantee-ledger',start,end,policyHashes:[...input.policyHashes],cashPages,insurancePages};
}
function guaranteeRows(input){
  const source=normalizeGuaranteeSource(input),amounts=new Map(dateList(source.start,source.end).map(date=>[date,0n]));
  for(const page of [...source.cashPages,...source.insurancePages])for(const row of page.rows)amounts.set(row.date,amounts.get(row.date)+BigInt(row.deductionMinor));
  return [...amounts].map(([date,minor])=>{
    if(minor>BigInt(Number.MAX_SAFE_INTEGER))fail('GUARANTEE_AMOUNT_OVERFLOW','保证金日扣款超过精确分币范围');
    const value=Number(minor)/100;if(BigInt(value.toFixed(2).replace('.',''))!==minor)fail('GUARANTEE_AMOUNT_OVERFLOW','保证金日扣款无法精确换算');
    return {date,depositDeduction:value};
  });
}
function guaranteeExportRows(input){
  const source=normalizeGuaranteeSource(input),rows=[],base={sourceKey:'billing',start:source.start,end:source.end};
  for(const page of [...source.cashPages,...source.insurancePages]){
    const kind=page.includesInsurance?'保险保证金':'现金保证金',common={...base,page:page.page,total:page.total};
    if(!page.rows.length)rows.push({...common,recordType:`完整空${kind}账单`});
    for(const row of page.rows){const {journalHash,balances,...fields}=row;rows.push({...common,recordType:`${kind}流水`,...fields,...balances});}
  }
  return rows;
}
module.exports={INSURANCE_ORIGIN,POLICY_API,POLICY_PATH,MAX_POLICIES,MAX_PAGES,policyHash,parsePolicyList,buildInsuranceRequest,parseInsurancePage,normalizeLedgerPage,normalizeGuaranteeSource,guaranteeRows,guaranteeExportRows};
