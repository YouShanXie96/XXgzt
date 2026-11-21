'use strict';
// 违规排查的大表导入线程：解析 xlsx/csv、整理商品、压缩商品清单都在这里做，
// 主进程只负责落盘，这样导入几万行的大表时界面不会被卡住。
const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs');
const path=require('node:path');
const {readTable}=require('../lib/spreadsheet');
const {productFromRow,buildJobStats,storeNameFromRows}=require('./compliance');
const {gzipSync,strToU8}=require('fflate');
try{
  const rows=readTable(fs.readFileSync(workerData.path),path.extname(workerData.path));
  if(!rows.length||rows.length>Number(workerData.maxProducts||200000))throw new Error('商品表格式无效或超过20万行');
  const headers=[...new Set(rows.flatMap(row=>Object.keys(row||{})))];
  const products=rows.map((row,index)=>productFromRow(row,index,headers));
  const stats=buildJobStats(products,Number(workerData.unitPrice)||0.01);
  const packed=gzipSync(strToU8(JSON.stringify(products)),{level:6});
  parentPort.postMessage({ok:true,productCount:products.length,stats,data:packed,storeName:storeNameFromRows(rows,headers)});
}catch(error){
  parentPort.postMessage({ok:false,error:error?.message||String(error)});
}
