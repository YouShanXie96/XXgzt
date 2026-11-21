'use strict';

const {FullSyncError}=require('../full-sync');
const {identifier,normalizeSource,dateList}=require('../domain');
const {KINDS,METRICS,financeRange,monthRanges,billingPageDto,depositPageDto,refundPageDto,normalizeFinanceSource,financeSourceRows}=require('../finance-details');
const fail=(code,message)=>{throw new FullSyncError(code,message);};
function check(signal){if(signal?.aborted)fail('CANCELED','财务同步已取消，原已保存数据保持不变');}
function createFinanceRangeReader(transport){
  if(typeof transport?.prepare!=='function')throw new TypeError('财务读取需要同店只读传输服务');
  const active=new Set();
  const guarantee=typeof transport.guaranteePolicies==='function'?require('./guarantee-range').createGuaranteeRangeReader(transport):null;
  async function readRange({storeId,mode,start,end,sourceKey,signal,onProgress}={}){
    if(sourceKey==='billing'&&guarantee)return guarantee.readRange({storeId,mode,start,end,signal,onProgress});
    storeId=identifier(storeId);const range=financeRange({mode,start,end});if(!Object.hasOwn(KINDS,sourceKey))fail('FINANCE_INVALID_SOURCE','此财务来源尚未接入');check(signal);
    if(active.has(storeId))fail('SYNC_BUSY','当前店铺已有财务来源同步任务');active.add(storeId);
    let source;const pages=[],seen=new Set();
    const addPage=page=>{for(const row of page.rows){const key=sourceKey==='billing'?row.journalHash:JSON.stringify([row.date,row.subjectId,row.subjectCode,row.accountCode]);if(seen.has(key))fail('FINANCE_DUPLICATE_RECORD','财务分页出现重复记录，已停止后续读取');seen.add(key);}pages.push(page);};
    const progress=(current,total,message)=>{check(signal);onProgress?.({current,total,message,sourceId:sourceKey});check(signal);};
    const accept=result=>{check(signal);const returned=normalizeSource(result?.source);if(returned.shopName!==source.shopName||returned.platformShopId!==source.platformShopId||returned.identityType!==source.identityType)fail('SOURCE_MISMATCH','财务分页读取期间店铺身份发生变化');return result;};
    try{
      progress(0,1,'正在核对本店财务登录会话');const prepared=await transport.prepare(storeId,signal);check(signal);source=normalizeSource(prepared?.source);let policyCheck;
      if(sourceKey==='billing'){
        const proof=accept(await transport.depositPolicies(storeId,{},signal));if(proof.empty!==true)fail('FINANCE_INCOMPLETE_POLICIES','尚未确认本店保险保证金保单范围，已停止');policyCheck={empty:true};
        let page=1,totalPages=1;
        do{progress(page-1,totalPages,`正在读取现金保证金第 ${page} 页`);const result=accept(await transport.depositPage(storeId,{start,end,page},signal));const parsed=depositPageDto(result.page,{start,end,page});addPage(parsed);totalPages=Math.max(1,Math.ceil(parsed.total/parsed.pageSize));if(pages[0].total!==parsed.total)fail('FINANCE_INCOMPLETE_PAGES','保证金分页期间总条数变化');progress(page,totalPages,`已读取现金保证金第 ${page} 页`);page++;}while(page<=totalPages);
      }else if(sourceKey==='marketing'){
        for(const segment of monthRanges(range)){let page=1,totalPages=1;
          do{progress(page-1,totalPages,`正在读取 ${segment.start} 至 ${segment.end} 费用账单第 ${page} 页`);const result=accept(await transport.billingPage(storeId,{...segment,page},signal));const parsed=billingPageDto(result.page,{...segment,page});if(page>1&&pages.at(-1).total!==parsed.total)fail('FINANCE_INCOMPLETE_PAGES','费用账单分页期间总条数变化');
            // Validate classifications immediately; this temporary calculation
            // never publishes coverage or a partial result to the caller.
            financeSourceRows({key:'marketing',start:segment.start,end:segment.end,pages:[parsed]});addPage(parsed);totalPages=Math.max(1,Math.ceil(parsed.total/parsed.pageSize));progress(page,totalPages,`已读取费用账单第 ${page} 页`);page++;}while(page<=totalPages);
        }
      }else{
        const dates=dateList(start,end);for(const [index,date]of dates.entries()){progress(index,dates.length,`正在读取 ${date} 退款场景`);const result=accept(await transport.refundPage(storeId,{date,page:1},signal));pages.push(refundPageDto(result.page,date));progress(index+1,dates.length,`已读取 ${date} 退款场景`);}
      }
      check(signal);const financeSource=normalizeFinanceSource({version:1,key:sourceKey,kind:KINDS[sourceKey],start,end,...(policyCheck?{policyCheck}:{}),pages},range),rows=financeSourceRows(financeSource).map(row=>({...row,storeName:source.shopName})),dates=dateList(start,end);
      const warnings=sourceKey==='billing'?['保证金按完整现金流水计算扣款；已确认当前无保险保证金保单，充值不计入扣款。']:sourceKey==='marketing'?['营销费用当前仅含已核实的账单品牌首单拉新与新品孵化费用，未计入营销托管；其他账单科目保留原始附表，扣点未映射。']:['退款场景保留官方各场景成功退款率及原始金额笔数；未覆盖或改写生意参谋退款金额，日支付分母只保存一份。'];
      return {source,rows,coverage:{scope:'full',complete:true,dates,expectedDays:dates.length,rowCount:rows.length},financeSource,warnings,metrics:[...METRICS[sourceKey]]};
    }catch(error){check(signal);if(error instanceof FullSyncError)throw error;fail('FINANCE_READ_FAILED','财务来源未完整读取，原已保存数据保持不变');}
    finally{active.delete(storeId);}
  }
  return {readRange};
}
module.exports={createFinanceRangeReader};
