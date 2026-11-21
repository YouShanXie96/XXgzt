'use strict';
// Complete cash + every current guarantee policy; no raw policy identifier is
// accepted from the renderer, persisted, or exported by this reader.
const {FullSyncError}=require('../full-sync');
const {identifier,normalizeSource,dateList}=require('../domain');
const {financeRange}=require('../finance-details');
const fail=(code,message)=>{throw new FullSyncError(code,message);};
function createGuaranteeRangeReader(transport){
 const active=new Set();
 async function readRange({storeId,mode,start,end,signal,onProgress}={}){
  const adapter=require('./guarantee'),range=financeRange({mode,start,end});storeId=identifier(storeId);
  const check=()=>{if(signal?.aborted)fail('CANCELED','保证金同步已取消，原已保存数据保持不变');};
  check();if(active.has(storeId))fail('SYNC_BUSY','当前店铺已有保证金同步');active.add(storeId);
  try{
   const prepared=await transport.prepare(storeId,signal);check();const source=normalizeSource(prepared.source);
   const accept=result=>{check();const next=normalizeSource(result?.source);if(JSON.stringify(next)!==JSON.stringify(source))fail('SOURCE_MISMATCH','保证金读取期间店铺身份变化');return result;};
   const policies=accept(await transport.guaranteePolicies(storeId,{},signal)).policyHashes;
   if(!Array.isArray(policies)||policies.length>100||new Set(policies).size!==policies.length||policies.some(hash=>!/^[a-f0-9]{64}$/.test(hash)))fail('GUARANTEE_INVALID_POLICIES','未取得完整的本店保证金保单范围');
   const cashPages=[],insurancePages=[],seen=new Set();let expectedRows=0,expectedPages=0;
   async function pages(policyHash){
    let page=1,totalPages=1,total;const target=policyHash?insurancePages:cashPages;
    do{
     check();onProgress?.({sourceId:'billing',message:`正在读取${policyHash?'保险':'现金'}保证金第 ${page} 页`,current:page-1,total:totalPages});check();
     const result=accept(await (policyHash?transport.insurancePage(storeId,{start,end,page,policyHash},signal):transport.depositPage(storeId,{start,end,page},signal))),dto=adapter.normalizeLedgerPage(result.page,{start,end,page,insurance:!!policyHash,policyHash});
     if(!Number.isSafeInteger(dto?.total)||dto.total<0||dto.total>100000||dto.page!==page||dto.pageSize!==2000||!Array.isArray(dto.rows))fail('GUARANTEE_INVALID_PAGE','保证金分页返回无效');
     if(total!==undefined&&total!==dto.total)fail('GUARANTEE_INCOMPLETE_PAGES','保证金分页期间总数变化');total=dto.total;totalPages=Math.max(1,Math.ceil(total/2000));
     if(page===1){expectedRows+=total;expectedPages+=totalPages;if(expectedRows>100000||expectedPages>adapter.MAX_PAGES)fail('GUARANTEE_ROW_LIMIT','保证金全部来源超出完整读取上限，本次已停止');}
     if(dto.hasNext!==(page<totalPages)||dto.rows.length!==Math.min(2000,Math.max(0,total-(page-1)*2000))||policyHash&&dto.policyHash!==policyHash)fail('GUARANTEE_INCOMPLETE_PAGES','保证金分页条数或保单归属不一致');
     for(const row of dto.rows){if(seen.has(row.journalHash))fail('GUARANTEE_DUPLICATE_JOURNAL','保证金跨页或跨保单重复，本次已停止');seen.add(row.journalHash);}
     target.push(dto);page++;
    }while(page<=totalPages);
   }
   await pages(null);for(const hash of policies)await pages(hash);
   const after=accept(await transport.guaranteePolicies(storeId,{},signal)).policyHashes;
   if(!Array.isArray(after)||JSON.stringify([...after].sort())!==JSON.stringify([...policies].sort()))fail('SOURCE_MISMATCH','读取期间保证金保单范围变化，本次未保存');
   const financeSource=adapter.normalizeGuaranteeSource({version:1,key:'billing',kind:'guarantee-ledger',start,end,policyHashes:policies,cashPages,insurancePages});
   const rows=adapter.guaranteeRows(financeSource).map(row=>({...row,storeName:source.shopName})),dates=dateList(start,end);check();
   return {source,rows,financeSource,coverage:{scope:'full',complete:true,dates,expectedDays:dates.length,rowCount:rows.length},metrics:['depositDeduction'],warnings:['保证金扣款包含完整现金与各保险保单流水中的支出，充值不计入扣款；无商品归属，不摊入单品。']};
  }catch(error){check();if(error instanceof FullSyncError)throw error;fail('GUARANTEE_READ_FAILED','保证金未完整读取，原已保存数据保持不变');}
  finally{active.delete(storeId);}
 }
 return {readRange};
}
module.exports={createGuaranteeRangeReader};
