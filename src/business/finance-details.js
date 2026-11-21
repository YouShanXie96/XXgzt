'use strict';

// Independent persisted proof validation. Financial source rows cannot become
// displayed metrics unless complete, sanitized pages reconstruct those values.
const {isoDate,dateList}=require('./domain');
const {FullSyncError}=require('./full-sync');
const billing=require('./sources/billing');
const deposit=require('./sources/deposit');
const refund=require('./sources/refund');
const fail=(code,message)=>{throw new FullSyncError(code,message);};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const KINDS={billing:'cash-deposit',marketing:'brand-billing',refund:'refund-scenes'};
const METRICS={billing:['depositDeduction'],marketing:['marketingExpense'],refund:['refundScenes']};
const BRANDS=Object.freeze([
  {subjectCode:'BILL_tmall_standard_tradeSettle_LOCAL',accountCode:'BILL_NEW_CATEGORY_1',subjectName:'品牌新享-首单拉新计划(KY_ITEM)',accountName:'品牌新享-首单拉新计划账户科目'},
  {subjectCode:'BILL_sxlDynamic_tradeSettle_LOCAL',accountCode:'BILL_YXPT_XPLJ_1',subjectName:'品牌新享新品孵化软件服务费(KY_ITEM)',accountName:'品牌新享新品直降礼金软件服务费账户科目'},
]);
function financeRange(input){
  if(input?.mode!=='daily')fail('FINANCE_INVALID_MODE','当前财务来源仅支持店铺日报');
  const start=isoDate(input.start),end=isoDate(input.end);
  if(start>end||(Date.parse(end)-Date.parse(start))/86400000>=31)fail('FINANCE_INVALID_RANGE','财务来源一次只支持连续31天以内的日期区间');
  return {start,end,mode:'daily'};
}
function monthRanges({start,end}){
  const ranges=[];let date=start;
  while(date<=end){const [year,month]=date.split('-').map(Number),last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10),stop=last<end?last:end;ranges.push({start:date,end:stop});date=new Date(Date.parse(stop)+86400000).toISOString().slice(0,10);}
  return ranges;
}
function metadata(actual,expected){if(!record(actual)||Object.entries(expected).some(([key,value])=>actual[key]!==value))fail('FINANCE_INVALID_PROOF','财务来源类型、日期或分页证明不一致');}
function billingPageDto(input,request){
  metadata(input,{sourceKind:'expense-day-bill',scope:'accounting-subject-day',start:request.start,end:request.end,page:request.page,pageSize:billing.PAGE_SIZE,amountUnit:'unconfirmed',mappingStatus:'raw-unclassified'});
  if(!Array.isArray(input.rows))fail('FINANCE_INVALID_PROOF','费用账单缺少原始科目');
  const raw=input.rows.map(row=>({billCycle:String(row?.date||'').replaceAll('-',''),itemId:row?.subjectId,itemCode:row?.subjectCode,itemName:row?.subjectName,accountCode:row?.accountCode,accountName:row?.accountName,curTotalPayable:row?.payable,curTotalAmount:row?.amount}));
  return billing.parseBillingPage({success:true,content:{data:raw,count:input.total,pageSize:input.pageSize,curPage:input.page,hasNext:input.hasNext},errors:null},request);
}
function safeMinor(value){if(!Number.isSafeInteger(value)||value<0)fail('FINANCE_INVALID_PROOF','保证金金额及余额必须是明确的非负整数分');return value;}
function timestamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))fail('FINANCE_INVALID_PROOF','保证金流水时间缺失');
  const parsed=Date.parse(value.replace(' ','T')+'Z');if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,19)!==value.replace(' ','T'))fail('FINANCE_INVALID_PROOF','保证金流水时间无效');return value;
}
function depositPageDto(input,request){
  metadata(input,{sourceKind:'cash-deposit-journal',scope:'cash-deposit-flow',start:request.start,end:request.end,page:request.page,pageEvidence:'request-bound',pageSize:deposit.PAGE_SIZE,amountUnit:'CNY-cent',normalizedAmountUnit:'CNY-yuan',includesInsurance:false});
  const total=input.total;
  if(!Number.isSafeInteger(total)||total<0||total>deposit.MAX_ROWS||!Array.isArray(input.rows))fail('FINANCE_INVALID_PROOF','保证金总条数或流水列表无效');
  const pages=Math.max(1,Math.ceil(total/deposit.PAGE_SIZE)),expected=Math.min(deposit.PAGE_SIZE,Math.max(0,total-(request.page-1)*deposit.PAGE_SIZE));
  if(request.page>pages||input.hasNext!==(request.page<pages)||input.rows.length!==expected)fail('FINANCE_INCOMPLETE_PAGES','保证金分页结束状态、实际条数与总数不一致');
  const seen=new Set(),rows=input.rows.map(row=>{
    if(!record(row)||!['credit','debit'].includes(row.direction)||!/^[a-f0-9]{64}$/.test(row.journalHash||''))fail('FINANCE_INVALID_PROOF','保证金流水缺少有效的去重摘要');
    const credit=row.amountOperationType===1&&row.operationType===1,debit=row.amountOperationType===2&&row.operationType===3;
    if(!credit&&!debit||row.direction!==(debit?'debit':'credit')||row.currency!=='CNY'||row.paymentChannelType!==1)fail('FINANCE_INVALID_PROOF','保证金操作方向、币种或通道未核实');
    const occurredAt=timestamp(row.occurredAt),createdAt=timestamp(row.createdAt),date=isoDate(row.date);
    if(date!==occurredAt.slice(0,10)||date<request.start||date>request.end)fail('FINANCE_INVALID_PROOF','保证金发生日期与所选区间不一致');
    const amountMinor=safeMinor(row.amountMinor),deductionMinor=debit?amountMinor:0,balances={availableMinor:safeMinor(row.balances?.availableMinor),currentMinor:safeMinor(row.balances?.currentMinor),frozenMinor:safeMinor(row.balances?.frozenMinor)};
    if(row.amount!==amountMinor/100||row.deductionMinor!==deductionMinor||row.deductionAmount!==deductionMinor/100||BigInt(balances.availableMinor)+BigInt(balances.frozenMinor)!==BigInt(balances.currentMinor))fail('FINANCE_INVALID_PROOF','保证金金额换算、扣款或余额校验不一致');
    if(seen.has(row.journalHash))fail('FINANCE_DUPLICATE_RECORD','保证金流水重复');seen.add(row.journalHash);
    return {date,occurredAt,createdAt,journalHash:row.journalHash,currency:'CNY',paymentChannelType:1,amountOperationType:row.amountOperationType,operationType:row.operationType,direction:row.direction,amountMinor,amount:amountMinor/100,deductionMinor,deductionAmount:deductionMinor/100,balances};
  });
  return {sourceKind:'cash-deposit-journal',scope:'cash-deposit-flow',start:request.start,end:request.end,page:request.page,pageEvidence:'request-bound',pageSize:deposit.PAGE_SIZE,total,hasNext:request.page<pages,amountUnit:'CNY-cent',normalizedAmountUnit:'CNY-yuan',includesInsurance:false,rows};
}
function refundPageDto(input,date){
  metadata(input,{sourceKind:'voc-refund-scenes',scope:'shop-scene-day',date,dateEvidence:'request-bound',page:1,pageSize:refund.PAGE_SIZE,hasNext:false,complete:true,amountUnit:'source-decimal',rateUnit:'percent'});
  if(!Array.isArray(input.rows))fail('FINANCE_INVALID_PROOF','退款场景原始明细缺失');
  const rows=input.rows.map(row=>({refundSceneName:row?.scene,successRefundCount:row?.successRefundCount,successRefundAmount:row?.successRefundAmount,refundInitiationCount:row?.refundInitiationCount,refundInitiationAmount:row?.refundInitiationAmount,refundRate:row?.refundRate,refundInitiationRate:row?.refundInitiationRate,paidAmount:input.paidAmount,paidOrderCount:input.paidOrderCount}));
  const parsed=refund.parseRefundScenePage({ret:['SUCCESS::Mtop'],data:{dataSource:{total:input.total,data:rows}}},{date,page:1});
  if(parsed.paidAmount!==input.paidAmount||parsed.paidOrderCount!==input.paidOrderCount)fail('FINANCE_INVALID_PROOF','退款场景日分母与原始明细不一致');return parsed;
}
function checkedPages(inputs,range,kind){
  const maximum=kind==='billing'?deposit.MAX_ROWS/deposit.PAGE_SIZE:billing.MAX_ROWS/billing.PAGE_SIZE;
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>maximum)fail('FINANCE_INCOMPLETE_PAGES','财务来源分页为空或超出限制');
  const parser=kind==='billing'?depositPageDto:billingPageDto,pages=inputs.map((input,index)=>parser(input,{...range,page:index+1})),first=pages[0],expected=Math.max(1,Math.ceil(first.total/first.pageSize));
  if(pages.length!==expected||pages.some(page=>page.total!==first.total))fail('FINANCE_INCOMPLETE_PAGES','财务来源分页缺失或总条数变化');
  const keys=new Set();let count=0;
  for(const page of pages)for(const row of page.rows){const key=kind==='billing'?row.journalHash:JSON.stringify([row.date,row.subjectId,row.subjectCode,row.accountCode]);if(keys.has(key))fail('FINANCE_DUPLICATE_RECORD','财务来源跨页明细重复');keys.add(key);count++;}
  if(count!==first.total)fail('FINANCE_INCOMPLETE_PAGES','财务来源条数与原始总数不一致');return pages;
}
function normalizeFinanceSource(input,request){
  if(request?.mode==='product')return normalizeProductRefundSource(input,request);
  const range=financeRange(request),key=input?.key;
  if(key==='billing'&&input.kind==='guarantee-ledger')return require('./sources/guarantee').normalizeGuaranteeSource(input,range);
  if(!Object.hasOwn(KINDS,key))fail('FINANCE_INVALID_SOURCE','尚未支持此财务来源');metadata(input,{version:1,key,kind:KINDS[key],start:range.start,end:range.end});
  let pages,policyCheck;
  if(key==='billing'){
    if(input.policyCheck?.empty!==true)fail('FINANCE_INCOMPLETE_POLICIES','保证金缺少明确的无保险保单证明，不能仅以现金作为完整来源');
    pages=checkedPages(input.pages,range,key);policyCheck={empty:true};
  }else if(key==='marketing'){
    if(!Array.isArray(input.pages)||input.pages.length>1000)fail('FINANCE_INCOMPLETE_PAGES','费用账单分页无效');
    const segments=monthRanges(range);pages=[];let offset=0;
    for(const segment of segments){const first=input.pages[offset];if(!first)fail('FINANCE_INCOMPLETE_PAGES','费用账单缺少自然月分段');const totalPages=Math.max(1,Math.ceil(first.total/billing.PAGE_SIZE));if(!Number.isSafeInteger(totalPages)||totalPages>500)fail('FINANCE_INCOMPLETE_PAGES','费用账单分页总数无效');const part=checkedPages(input.pages.slice(offset,offset+totalPages),segment,key);pages.push(...part);offset+=part.length;}
    if(offset!==input.pages.length)fail('FINANCE_INCOMPLETE_PAGES','费用账单存在重复或额外自然月分段');
  }else{
    const dates=dateList(range.start,range.end);if(!Array.isArray(input.pages)||input.pages.length!==dates.length)fail('FINANCE_INCOMPLETE_PAGES','退款场景未覆盖所选全部日期');pages=dates.map((date,index)=>refundPageDto(input.pages[index],date));
  }
  const result={version:1,key,kind:KINDS[key],start:range.start,end:range.end,...(policyCheck?{policyCheck}:{}),pages};
  // Classification validation is required even when callers only ask to retain
  // proof; an unknown brand or altered amount must never be silently ignored.
  financeSourceRows(result);return result;
}
function normalizeProductRefundSource(input,request){
  const start=isoDate(request.start),end=isoDate(request.end),dates=dateList(start,end);
  if(start>end||dates.length>31)fail('FINANCE_INVALID_RANGE','商品退款来源区间无效');
  metadata(input,{version:1,key:'refund',kind:'product-refund',start,end});
  if(!Array.isArray(input.pages)||!input.pages.length||input.pages.length>1000)fail('FINANCE_INCOMPLETE_PAGES','商品退款来源分页缺失或过多');
  const {validateProductRefundPage}=require('./sources/product-refund-range');
  const pages=[];let offset=0,count=0;
  for(const date of dates){
    const first=validateProductRefundPage(input.pages[offset],{date,page:1}),totalPages=Math.max(1,Math.ceil(first.total/first.pageSize)),ids=new Set();
    for(let page=1;page<=totalPages;page++){
      const current=page===1?first:validateProductRefundPage(input.pages[offset+page-1],{date,page});
      if(current.total!==first.total)fail('FINANCE_INCOMPLETE_PAGES','商品退款各页总条数不一致');
      for(const row of current.rows){if(ids.has(row.productId))fail('FINANCE_DUPLICATE_RECORD','商品退款分页出现重复商品');ids.add(row.productId);}
      pages.push(current);
    }
    if(ids.size!==first.total)fail('FINANCE_INCOMPLETE_PAGES','商品退款未取得全部明细');
    count+=ids.size;offset+=totalPages;
  }
  if(offset!==input.pages.length||count>100000)fail('FINANCE_INCOMPLETE_PAGES','商品退款存在额外分页或记录超过上限');
  return {version:1,key:'refund',kind:'product-refund',start,end,pages};
}
const metricsFor=(key,mode)=>mode==='product'&&key==='refund'?require('./sources/product-refund-range').METRICS:METRICS[key];
function exactDecimal(value){
  if(typeof value!=='string'||!/^\d+(?:\.\d{1,8})?$/.test(value))fail('FINANCE_UNCONFIRMED_AMOUNT','账单出现负数或未核实的金额口径，已停止');
  const [whole,fraction='']=value.split('.');return BigInt(whole)*100000000n+BigInt((fraction+'00000000').slice(0,8));
}
function brandMinor(row){
  if(exactDecimal(row.payable)!==exactDecimal(row.amount))fail('FINANCE_UNCONFIRMED_AMOUNT','账单应付与实付金额不同，需核对冲减口径后再同步');
  const brand=BRANDS.find(known=>known.subjectCode===row.subjectCode&&known.accountCode===row.accountCode);
  if(brand){if(Object.entries(brand).some(([key,value])=>row[key]!==value))fail('FINANCE_UNKNOWN_BRAND','已核实的品牌账单名称发生变化，已停止');if(!/^\d+(?:\.\d{1,2})?$/.test(row.amount))fail('FINANCE_UNCONFIRMED_AMOUNT','品牌费用不是可精确换算为分的金额');const [whole,fraction='']=row.amount.split('.');return BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2));}
  if(BRANDS.some(known=>known.subjectCode===row.subjectCode||known.accountCode===row.accountCode)||/品牌新享|首单拉新|新品孵化|新品直降|BILL_NEW_CATEGORY|BILL_YXPT_XPLJ/i.test([row.subjectCode,row.accountCode,row.subjectName,row.accountName].join(' ')))fail('FINANCE_UNKNOWN_BRAND','发现尚未核实的新品牌费用分类，已停止');
  return 0n;
}
function financeSourceRows(source){
  if(source.kind==='guarantee-ledger')return require('./sources/guarantee').guaranteeRows(source);
  if(source.kind==='product-refund')return require('./sources/product-refund-range').displayRows(source.pages);
  const dates=dateList(source.start,source.end),values=new Map(dates.map(date=>[date,0n]));
  if(source.key==='refund')return source.pages.map(page=>({date:page.date,refundScenes:page.rows.length?page.rows.map(row=>`${row.scene}：${row.refundRate}`).join('；'):'无退款场景记录'}));
  for(const page of source.pages)for(const row of page.rows){const value=source.key==='billing'?BigInt(row.deductionMinor):brandMinor(row);values.set(row.date,values.get(row.date)+value);}
  return dates.map(date=>{const minor=values.get(date);if(minor>BigInt(Number.MAX_SAFE_INTEGER))fail('FINANCE_AMOUNT_OVERFLOW','财务来源日合计超出精确金额范围');return {date,[METRICS[source.key][0]]:Number(minor)/100};});
}
function normalizeFinanceSources(input,request,rows,{completed=[]}={}){
  if(!Array.isArray(completed)||completed.some(key=>!Object.hasOwn(KINDS,key))||new Set(completed).size!==completed.length)fail('FINANCE_INVALID_SOURCE','财务已完成来源声明无效');
  if(input===undefined){if(completed.length)fail('FINANCE_MISSING_PROOF','已完成财务来源必须保留原始明细和覆盖证明');return [];}
  if(!Array.isArray(input)||input.length!==completed.length)fail('FINANCE_MISSING_PROOF','财务来源证明与完成声明不一致');
  if(!input.length)return [];
  const normalized=[],seen=new Set();
  if(!Array.isArray(rows))fail('FINANCE_INVALID_PROOF','财务展示记录无效');
  const rowKey=row=>request.mode==='product'?`${row.date}:${row.productId}`:row.date;
  const display=new Map();for(const row of rows){const key=rowKey(row);if(display.has(key))fail('FINANCE_INVALID_PROOF','展示日期或商品重复');display.set(key,row);}
  for(const entry of input){if(!completed.includes(entry?.key)||seen.has(entry.key))fail('FINANCE_INVALID_SOURCE','财务来源重复或未完成');seen.add(entry.key);const source=normalizeFinanceSource(entry,request);
    const expectedRows=financeSourceRows(source),metrics=metricsFor(source.key,request.mode);
    for(const expected of expectedRows){const actual=display.get(rowKey(expected));if(!actual||metrics.some(metric=>actual[metric]!==expected[metric]))fail('FINANCE_DISPLAY_MISMATCH','财务展示指标与原始来源及完整日期证明不一致');}
    if(request.mode==='product'){
      const expectedKeys=new Set(expectedRows.map(rowKey));
      if(rows.some(row=>!expectedKeys.has(rowKey(row))&&metrics.some(key=>row[key]!==null&&row[key]!==undefined)))fail('FINANCE_DISPLAY_MISMATCH','未返回的商品不能补造退款指标或支付分母');
    }
    normalized.push(source);
  }
  return normalized;
}
const FINANCE_EXPORT_COLUMNS=[['sourceKey','来源'],['recordType','记录类型'],['start','起始日期'],['end','结束日期'],['date','归属日期'],['page','原始页码'],['total','来源总条数'],['subjectId','账务科目标识'],['subjectCode','费用科目代码'],['subjectName','费用科目'],['accountCode','账户科目代码'],['accountName','账户科目'],['payable','原始应付金额'],['amount','原始金额'],['direction','保证金方向'],['amountMinor','保证金金额（分）'],['deductionMinor','保证金扣款（分）'],['deductionAmount','保证金扣款（元）'],['occurredAt','保证金发生时间'],['createdAt','保证金创建时间'],['amountOperationType','金额操作类型'],['operationType','操作类型'],['availableMinor','可用余额（分）'],['currentMinor','当前余额（分）'],['frozenMinor','冻结余额（分）'],['scene','退款场景'],['successRefundCount','成功退款笔数'],['successRefundAmount','成功退款金额'],['refundInitiationCount','申请退款笔数'],['refundInitiationAmount','申请退款金额'],['refundRate','成功退款率'],['refundInitiationRate','申请退款率'],['paidAmount','日支付金额（单份分母）'],['paidOrderCount','日支付订单数（单份分母）']].map(([key,label])=>({key,label}));
function financeExportRows(sources){
  const output=[];
  for(const raw of sources||[]){const source=normalizeFinanceSource(raw,{mode:raw.kind==='product-refund'?'product':'daily',start:raw.start,end:raw.end});
    if(source.kind==='guarantee-ledger'){output.push(...require('./sources/guarantee').guaranteeExportRows(source));continue;}
    const base={sourceKey:source.key,start:source.start,end:source.end};if(source.key==='billing')output.push({...base,recordType:'已核实无保险保证金保单'});
    for(const page of source.pages){const common={...base,page:page.page,total:page.total};
      if(source.kind==='product-refund'){
        if(!page.rows.length)output.push({...common,date:page.date,recordType:'完整空商品退款列表'});
        for(const row of page.rows)output.push({...common,recordType:'商品退款原始指标',...row});
        continue;
      }
      if(source.key==='refund')output.push({...common,date:page.date,recordType:page.rows.length?'退款日分母（仅此行）':'完整空退款场景',paidAmount:page.paidAmount,paidOrderCount:page.paidOrderCount});
      else if(!page.rows.length)output.push({...common,recordType:source.key==='billing'?'完整空现金保证金账单':'完整空费用账单'});
      for(const row of page.rows){if(source.key==='marketing')output.push({...common,recordType:'费用账单原始科目',...row});else if(source.key==='billing'){const {journalHash,balances,...fields}=row;output.push({...common,recordType:'现金保证金流水',...fields,...balances});}else output.push({...common,date:page.date,recordType:'退款场景原始指标',...row});}
    }
  }
  return output;
}
FINANCE_EXPORT_COLUMNS.splice(5,0,{key:'productId',label:'商品ID'});
module.exports={KINDS,METRICS,metricsFor,BRANDS,financeRange,monthRanges,billingPageDto,depositPageDto,refundPageDto,normalizeFinanceSource,financeSourceRows,normalizeFinanceSources,financeExportRows,FINANCE_EXPORT_COLUMNS};
