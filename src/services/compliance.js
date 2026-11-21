'use strict';
// 违规排查：参考“同类工作台 / 商品违规检查服务”，在本机复刻四个板块
//（违规扫描、违规处理中心、违规管理库、计费中心）。
//   1. 导入商品表格（xlsx/xlsm/csv）：读出商品ID、标题、各列文字与单元格里的图片链接；
//   2. 扫描：文字按违规词库匹配；图片按 URL 去重后下载并 OCR（Tesseract），OCR 文字再走同一词库；
//   3. 命中问题进入“违规处理中心”人工复核（待处理/已确认/已忽略/已整改）；
//   4. 图片识别按张计费（本地计费：单价、余额、明细），OCR 结果与图片按 URL 缓存，重复扫描不重复下载。
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {createHash,randomUUID}=require('node:crypto');
const {gzipSync,gunzipSync,strToU8,strFromU8}=require('fflate');
const {within}=require('../lib/storage');
const {readTable}=require('../lib/spreadsheet');

const IMAGE_PATTERN=/https?:\/\/[^\s"'<>()]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s"'<>()]*)?/gi;
const IMAGE_URL_PATTERN=/^https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?$/i;
// 表格里也允许直接写本机图片路径（例如导出的表带本地图片），与 https 链接一样参与 OCR。
// 负向后顾避免把 “https://…” 里的 “s://” 当成盘符路径。
const LOCAL_IMAGE_PATTERN=/(?<![A-Za-z0-9:])[A-Za-z]:[\\/][^\s"'<>|?*\r\n]+?\.(?:jpg|jpeg|png|webp|gif)/gi;
const localImage=value=>/^[A-Za-z]:[\\/]/.test(String(value||''))||String(value||'').startsWith('\\\\');
const DEFAULT_UNIT_PRICE=0.01;
const DEFAULT_BALANCE=20;
const MAX_PRODUCTS=200000;
const MAX_CELL_TEXT=4000;
const MAX_IMAGE_BYTES=20*1024*1024;
const OCR_TIMEOUT_MS=60000;
const ISSUE_STATUSES=['pending','confirmed','ignored','fixed'];
const LEVELS=['high','medium','low'];
const RISK_LABELS={high:'高',medium:'中',low:'低'};
const STATUS_LABELS={pending:'待处理',confirmed:'已确认',ignored:'已忽略',fixed:'已整改'};

// 内置违规词库（按常见平台规则整理，可在“违规管理库”里增删改、导入或恢复默认）。
const DEFAULT_RULES=[
  {id:'ad-limit',name:'绝对化用语',category:'广告法',level:'high',keywords:'国家级,最高级,最佳,最好,最优,最强,第一,全网第一,全国第一,销量第一,排名第一,绝对,唯一,独家,首个,顶级,极品,前所未有,史无前例,终极,王牌,NO.1,no.1',exceptions:'第一现场'},
  {id:'ad-guarantee',name:'虚假承诺',category:'广告法',level:'high',keywords:'100%有效,百分之百有效,保证有效,绝对安全,无效退款,永不复发,包治,根治,药到病除,一次见效,立竿见影',exceptions:''},
  {id:'ad-medical',name:'医疗功效',category:'医疗健康',level:'high',keywords:'治疗,治愈,根治,消炎,杀菌,抗炎,降血压,降血糖,降血脂,助眠,安神,壮阳,补肾,丰胸,减肥特效,排毒,祛痘根除,修复受损细胞',exceptions:''},
  {id:'ad-food',name:'食品违规宣称',category:'食品',level:'medium',keywords:'纯天然,无添加,零添加,不升糖,降三高,防癌,抗癌,提高免疫力,增强抵抗力,调理肠胃,养生保健功效',exceptions:''},
  {id:'ad-cosmetic',name:'化妆品违规宣称',category:'美妆',level:'medium',keywords:'快速美白,一秒美白,永久脱毛,去皱,除皱,淡斑根除,医用级,械字号,药妆',exceptions:''},
  {id:'ad-price',name:'价格与促销违规',category:'价格',level:'medium',keywords:'全网最低价,最低价,超低价,亏本清仓,最后一天,仅此一次,假一赔十,史无前例低',exceptions:''},
  {id:'ad-brand',name:'品牌敏感词',category:'品牌',level:'low',keywords:'官方同款,专柜同款,代购正品,高仿,原单,尾单,工厂直供正品',exceptions:''},
  {id:'ad-misc',name:'其它高风险表述',category:'其它',level:'low',keywords:'全网独家,仅此一家,绝无仅有,独一无二,无副作用,包过,免检产品,国家免检',exceptions:''}
];

function normalizeKeywords(value){
  if(Array.isArray(value))value=value.join(',');
  return String(value||'').split(/[,，;；\n\r]+/).map(item=>item.trim()).filter(Boolean).slice(0,2000);
}
function normalizeRules(rules){
  if(!Array.isArray(rules)||rules.length>500||rules.some(rule=>!rule||typeof rule!=='object'||Array.isArray(rule)))throw new Error('规则需为数组且不超过500条');
  const seen=new Set();
  return rules.map((rule,index)=>{
    let id=String(rule.id||`rule-${index+1}`).slice(0,80)||`rule-${index+1}`;
    while(seen.has(id))id=`${id}-x`;
    seen.add(id);
    const next={
      id,
      name:String(rule.name||'自定义规则').slice(0,100),
      category:String(rule.category||'自定义').slice(0,40),
      level:LEVELS.includes(rule.level)?rule.level:'medium',
      keywords:normalizeKeywords(rule.keywords).slice(0,800),
      exceptions:normalizeKeywords(rule.exceptions).slice(0,200),
      enabled:rule.enabled!==false
    };
    // 违规管理库（参考同类工作台）：命中位置 / 整改建议 / 备注为可选的展示字段。
    if(rule.position!==undefined)next.position=String(rule.position||'全部').slice(0,40)||'全部';
    if(rule.suggestion!==undefined)next.suggestion=String(rule.suggestion||'').slice(0,200);
    if(rule.note!==undefined)next.note=String(rule.note||'').slice(0,200);
    return next;
  });
}
// 旧版（只有“重点复核/待复核”）词库升级：级别映射到高/中风险，补上分类。
const LEGACY_DEFAULT_RULES=[
  {id:'r1',name:'绝对化表述',keywords:'国家级,最高级,最佳,全网第一'},
  {id:'r2',name:'功效表述',keywords:'包治,根治,药到病除,永不复发'},
  {id:'r3',name:'承诺表述',keywords:'百分之百有效,100%有效,绝对安全'}
];
function looksLegacy(rules){
  if(!Array.isArray(rules)||rules.length!==LEGACY_DEFAULT_RULES.length)return false;
  return LEGACY_DEFAULT_RULES.every(rule=>rules.some(item=>item&&item.id===rule.id&&String(item.name||'')===rule.name&&String(item.keywords||'')===rule.keywords));
}
function migrateRules(rules){
  if(!Array.isArray(rules)||!rules.length)return DEFAULT_RULES;
  // 旧版从未改过词库：直接换成新的内置词库（含分类与风险等级）。
  if(looksLegacy(rules))return DEFAULT_RULES;
  return rules.map(rule=>{
    if(!rule||typeof rule!=='object')return rule;
    const level=LEVELS.includes(rule.level)?rule.level:(/重点/.test(String(rule.level))?'high':/待核/.test(String(rule.level))?'medium':undefined);
    return {...rule,...(level?{level}:{}),...(rule.category?{}:{category:'历史规则'})};
  });
}
// 文字扫描：逐条规则找关键词；上下文里出现排除词就跳过；同一条规则同一关键词只记一次。
// normalizeRules 对同一份词库只算一次（一次扫描里会被调用几十万次，省掉重复解析）。
const normalizedCache=new WeakMap();
function cachedRules(rules){
  if(!Array.isArray(rules))return normalizeRules(rules);
  let hit=normalizedCache.get(rules);
  if(!hit){hit=normalizeRules(rules);normalizedCache.set(rules,hit);}
  return hit;
}
function findIssues(text,rules){
  const source=String(text||'');
  const found=[];
  if(!source)return found;
  const lowered=source.toLocaleLowerCase();
  for(const rule of cachedRules(rules)){
    if(!rule.enabled)continue;
    // 先长后短：像“全网第一”已经命中时，不再为它内部包含的“第一”重复记一条。
    const covered=[];
    for(const keyword of [...rule.keywords].sort((left,right)=>right.length-left.length)){
      const needle=keyword.toLocaleLowerCase();
      let offset=lowered.indexOf(needle);
      while(offset>=0){
        const range=[offset,offset+keyword.length];
        if(covered.some(entry=>entry[0]<=range[0]&&entry[1]>=range[1]))break;
        const context=source.slice(Math.max(0,offset-24),Math.min(source.length,offset+keyword.length+24)).replace(/\s+/g,' ').trim();
        if(!rule.exceptions.some(exception=>context.includes(exception))){
          // word 是旧版字段名，保留给历史调用；term 是新版字段名。
          found.push({ruleId:rule.id,ruleName:rule.name,category:rule.category,riskLevel:rule.level,term:keyword,word:keyword,evidence:context});
          covered.push(range);
          break;
        }
        offset=lowered.indexOf(needle,offset+needle.length);
      }
    }
  }
  return found;
}
function extractImages(value){
  const text=String(value||'');
  if(!text)return [];
  const matches=text.match(IMAGE_PATTERN)||[];
  if(!matches.length&&IMAGE_URL_PATTERN.test(text.trim()))matches.push(text.trim());
  const locals=text.match(LOCAL_IMAGE_PATTERN)||[];
  matches.push(...locals);
  return [...new Set(matches.map(item=>item.replace(/[),.;，。；]+$/,'')))].filter(Boolean);
}
function productFromRow(row,index,headers){
  const pick=keys=>{for(const key of keys){const value=row[key];if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim();}return '';};
  const id=pick(['商品ID','商品id','productId','itemId','id','宝贝ID']).slice(0,80)||`第${index+1}行`;
  const title=pick(['商品标题','商品名称','标题','title','name','宝贝名称']).slice(0,500);
  const fields=[];
  const images=[];
  let imageCount=0;
  for(const header of headers||Object.keys(row)){
    const value=row[header];
    if(value===undefined||value===null)continue;
    const text=String(value).trim();
    if(!text)continue;
    const found=extractImages(text);
    if(found.length){
      images.push(...found);
      imageCount+=found.length;
      const rest=text.replace(IMAGE_PATTERN,'').replace(/[\s,;，；]+/g,' ').trim();
      if(rest)fields.push({field:String(header||''),text:rest.slice(0,MAX_CELL_TEXT)});
      continue;
    }
    fields.push({field:String(header||''),text:text.slice(0,MAX_CELL_TEXT)});
  }
  // 大表里图片链接加起来上百万条：只留去重后的 URL 与出现条数，省掉一份重复的字段来源清单。
  return {id,title,fields,images:[...new Set(images)],imageCount};
}

// 店铺名从表格里识别：第一列表头是“店铺名/旺旺名称”（找不到再按表头名全局找），取第一个非空值；
// 识别不到就留空，界面显示“无”（用户可点击修改）。
function storeNameFromRows(rows,headers){
  const names=['店铺名','旺旺名称','店铺名称','店铺'];
  const list=(headers||[]).map(item=>String(item||'').trim());
  const first=String(list[0]||'');
  const field=names.includes(first)?first:(names.find(name=>list.includes(name))||null);
  if(!field)return '';
  for(const row of rows||[]){
    const value=String(row?.[field]??'').trim();
    if(value)return value.slice(0,60);
  }
  return '';
}
function summarizeProducts(products,unitPrice){
  // imageCount 是表格里出现的图片链接条数（含重复）；uniqueImageCount 是按 URL 去重后的张数。
  const total=products.reduce((sum,product)=>sum+(Number.isFinite(Number(product.imageCount))?Number(product.imageCount):(product.imageSources?.length??(product.images||[]).length)),0);
  const unique=new Set();
  for(const product of products){
    if(product.imageSources&&product.imageSources.length){for(const item of product.imageSources)unique.add(item.url);}
    else for(const url of product.images||[])unique.add(url);
  }
  return {
    imageCount:total,
    uniqueImageCount:unique.size,
    recognizedImageCount:0,
    skippedImageCount:0,
    estimatedCost:Number((unique.size*unitPrice).toFixed(2)),
    actualCost:0
  };
}
function createComplianceService(ctx,options={}){
  // now/fetch/execFile 允许从 options 或共享 ctx 注入（测试里两条路径都用过）。
  const clock=typeof options.now==='function'?options.now:(typeof ctx.now==='function'?ctx.now:()=>new Date());
  const remote=options.fetch||ctx.fetch||((...args)=>fetch(...args));
  const run=options.execFile||ctx.execFile||execFile;
  let disposed=false,running=false,scanAbort=null,activeChild=null,activeTask=null;
  const indexFile='compliance/state.json';
  const jobFile=id=>`compliance/jobs/${id}.json`;
  // 商品清单单独存：大表（几万行）的产品 JSON 有几百 MB，混在任务文件里会让每次进度保存都写一遍，
  // 程序就会又卡又慢；这里压缩后再存（gzip+base64），任务文件只留进度与问题。
  const productFile=id=>`compliance/jobs/${id}.products.json`;
  async function saveProducts(id,products){
    const packed=gzipSync(strToU8(JSON.stringify(products)),{level:6});
    await ctx.writeJson(productFile(id),{format:'gzip+base64',v:1,data:Buffer.from(packed).toString('base64')});
  }
  async function savePackedProducts(id,packed){
    await ctx.writeJson(productFile(id),{format:'gzip+base64',v:1,data:Buffer.from(packed).toString('base64')});
  }
  async function readProducts(id){
    let snapshot=null;
    try{snapshot=await ctx.readJson(productFile(id),null);}catch{return null;}
    if(!snapshot||typeof snapshot!=='object'||typeof snapshot.data!=='string')return null;
    return JSON.parse(strFromU8(gunzipSync(Buffer.from(snapshot.data,'base64'))));
  }
  // 大表解析放到 worker 线程：解析/整理/压缩都在那边做，主线程只负责落盘。
  // 万一打包环境里线程不可用（极少见），自动退回主线程解析，功能不受影响。
  async function parseWorkbook(filePath,unitPrice){
    try{
      const {Worker}=require('node:worker_threads');
      const worker=new Worker(path.join(__dirname,'compliance-import-worker.js'),{workerData:{path:filePath,unitPrice,maxProducts:MAX_PRODUCTS}});
      const message=await new Promise((resolve,reject)=>{
        let settled=false;
        worker.once('message',value=>{settled=true;resolve(value);});
        worker.once('error',error=>{if(!settled)reject(Object.assign(error,{workerFailed:true}));});
        worker.once('exit',code=>{if(!settled&&code!==0)reject(Object.assign(new Error(`导入线程异常退出（${code}）`),{workerFailed:true}));});
      });
      if(!message||message.ok!==true)throw new Error(message?.error||'导入线程处理失败');
      return {productCount:Number(message.productCount||0),stats:message.stats,packed:message.data,storeName:String(message.storeName||'')};
    }catch(error){
      if(!error?.workerFailed)throw error;
      const rows=readTable(await fs.readFile(filePath),path.extname(filePath));
      if(!rows.length||rows.length>MAX_PRODUCTS)throw new Error('商品表格式无效或超过20万行');
      const headers=[...new Set(rows.flatMap(row=>Object.keys(row||{})))];
      const products=rows.map((row,index)=>productFromRow(row,index,headers));
      return {productCount:products.length,stats:buildJobStats(products,unitPrice),packed:gzipSync(strToU8(JSON.stringify(products)),{level:6}),storeName:storeNameFromRows(rows,headers)};
    }
  }

  const defaultState=()=>({schemaVersion:1,rules:DEFAULT_RULES,billing:{unitPrice:DEFAULT_UNIT_PRICE,balance:DEFAULT_BALANCE,entries:[]},jobs:[],lastScan:null});
  async function readState(){
    const snapshot=await ctx.readJson(indexFile,defaultState());
    if(!snapshot||typeof snapshot!=='object')return defaultState();
    if(!Array.isArray(snapshot.jobs))snapshot.jobs=[];
    snapshot.rules=normalizeRules(migrateRules(snapshot.rules));
    const billing=snapshot.billing&&typeof snapshot.billing==='object'?snapshot.billing:{};
    snapshot.billing={
      unitPrice:Number.isFinite(Number(billing.unitPrice))?Number(billing.unitPrice):DEFAULT_UNIT_PRICE,
      balance:Number.isFinite(Number(billing.balance))?Number(billing.balance):DEFAULT_BALANCE,
      entries:Array.isArray(billing.entries)?billing.entries.slice(0,5000):[]
    };
    return snapshot;
  }
  const saveState=snapshot=>ctx.writeJson(indexFile,snapshot);
  async function readJob(id,{withProducts=true}={}){
    const record=await ctx.readJson(jobFile(id),null);
    if(!record||typeof record!=='object'||record.id!==id)throw new Error('排查任务数据不存在或已损坏');
    if(!Array.isArray(record.issues))record.issues=[];
    let products=null,migrated=false;
    if(withProducts){try{products=await readProducts(id);}catch{products=null;}}
    if(!products&&Array.isArray(record.products)){
      // 旧版把商品清单放在任务文件里：升级时迁移到独立压缩文件，任务文件只留进度与问题。
      products=record.products;
      // 先确保压缩清单写成功，再从任务文件里删掉商品（避免中途失败丢数据）。
      await saveProducts(id,products);
      delete record.products;
      migrated=true;
    }
    // 先把商品行数补进任务摘要，再落盘（否则“总行数”会显示 0）。
    if(!Number.isFinite(Number(record.productCount))){
      let list=Array.isArray(products)?products:null;
      if(!list){try{list=await readProducts(id);}catch{list=null;}}
      record.productCount=Array.isArray(list)?list.length:0;
      await saveJob(record).catch(()=>{});
    }
    if(migrated){
      await saveJob(record).catch(()=>{});
      if(!withProducts)products=null;
    }
    if(withProducts&&!products)throw new Error('排查任务的商品清单缺失或已损坏，请重新导入这份表格');
    if(withProducts)record.products=Array.isArray(products)?products:[];
    return record;
  }
  // 任务文件永远不写商品清单（saveJob 会先剥掉 products）。
  const saveJob=record=>{const {products,...rest}=record;return ctx.writeJson(jobFile(record.id),rest);};
  function jobSummary(record){
    const stats=record.stats||{};
    const issues=Array.isArray(record.issues)?record.issues:[];
    const products=Array.isArray(record.products)?record.products:[];
    return {
      id:record.id,name:record.name,sourceFile:record.sourceFile||'',createdAt:record.createdAt,finishedAt:record.finishedAt||null,
      storeName:record.storeName||'',
      status:record.status,progress:record.progress||{processed:0,total:products.length,message:''},
      productCount:Number(record.productCount??(Array.isArray(record.products)?record.products.length:0)),issueCount:issues.length,
      imageCount:Number(stats.imageCount||0),uniqueImageCount:Number(stats.uniqueImageCount||0),
      recognizedImageCount:Number(stats.recognizedImageCount||0),skippedImageCount:Number(stats.skippedImageCount||0),
      high:issues.filter(item=>item.riskLevel==='high').length,
      medium:issues.filter(item=>item.riskLevel==='medium').length,
      low:issues.filter(item=>item.riskLevel==='low').length,
      pending:issues.filter(item=>item.status==='pending').length,
      estimatedCost:Number(stats.estimatedCost||0),actualCost:Number(stats.actualCost||0)
    };
  }
  function ocrCandidates(){
    const list=[];
    if(options.ocrDir)list.push(options.ocrDir);
    if(ctx.ocrDir)list.push(ctx.ocrDir);
    if(ctx.resourceDir){list.push(path.join(ctx.resourceDir,'ocr'));list.push(path.resolve(ctx.resourceDir,'..','..','..','resources','ocr'));}
    list.push('D:\\软件\\product-compliance-portable-0.1.17\\resources\\ocr\\Tesseract-OCR');
    list.push('D:\\软件\\测试，自动推广\\新\\@workbenchdesktop\\resources\\compliance-ocr');
    return [...new Set(list.map(item=>path.resolve(item)))];
  }
  let ocrRuntime=null;
  async function resolveOcr(){
    if(ocrRuntime)return ocrRuntime;
    for(const directory of ocrCandidates()){
      const binary=path.join(directory,'tesseract.exe');
      const tessdata=path.join(directory,'tessdata');
      try{await fs.access(binary);await fs.access(tessdata);ocrRuntime={binary,tessdata,directory};return ocrRuntime;}catch{}
    }
    return null;
  }
  async function recognizeImage(localPath,signal){
    const runtime=await resolveOcr();
    if(!runtime)throw new Error('OCR 运行时缺失（安装目录 resources/ocr 里没有 tesseract.exe）');
    const execute=args=>new Promise((resolve,reject)=>{
      activeChild=run(runtime.binary,args,{windowsHide:true,timeout:OCR_TIMEOUT_MS,maxBuffer:8*1024*1024,encoding:'utf8',signal},(error,stdout)=>{
        activeChild=null;
        if(error)reject(new Error(signal?.aborted?'扫描已取消':'OCR 识别失败或超时'));
        else resolve(String(stdout||'').trim());
      });
    });
    const base=[localPath,'stdout','--tessdata-dir',runtime.tessdata,'-l','chi_sim+eng'];
    const first=await execute([...base,'--psm','6']);
    if(first)return first;
    return await execute([...base,'--psm','11']);
  }
  async function downloadImage(url,signal){
    // 本机图片路径：直接校验后使用（不联网、不复制缓存）。
    if(localImage(url)){
      const target=path.resolve(String(url));
      const stat=await fs.stat(target).catch(()=>null);
      if(!stat?.isFile())throw new Error('本机图片路径不存在或无法读取');
      if(stat.size>MAX_IMAGE_BYTES)throw new Error('图片超过20MB');
      return target;
    }
    const parsed=new URL(url);
    if(parsed.protocol!=='https:')throw new Error('仅支持 https 图片链接或本机图片路径');
    const hash=createHash('sha1').update(url).digest('hex');
    const extension=['.png','.webp','.gif','.jpeg','.jpg'].includes(path.extname(parsed.pathname).toLowerCase())?path.extname(parsed.pathname).toLowerCase():'.img';
    const cached=within(ctx.dataDir,`compliance/cache/images/${hash}${extension}`);
    try{const stat=await fs.stat(cached);if(stat.size>0)return cached;}catch{}
    const timeout=AbortSignal.timeout?AbortSignal.timeout(15000):undefined;
    const composed=signal&&timeout?AbortSignal.any([signal,timeout]):(signal||timeout);
    const response=await remote(url,{signal:composed,redirect:'error',headers:{accept:'image/*'}});
    if(!response?.ok)throw new Error(`图片读取失败 HTTP ${response?.status||'?'}`);
    const declared=Number(response.headers?.get?.('content-length')||0);
    if(declared>MAX_IMAGE_BYTES)throw new Error('图片超过20MB');
    const buffer=Buffer.from(await response.arrayBuffer());
    if(buffer.length>MAX_IMAGE_BYTES)throw new Error('图片超过20MB');
    await fs.mkdir(path.dirname(cached),{recursive:true});
    await fs.writeFile(cached,buffer);
    return cached;
  }
  async function ocrCached(url,signal){
    const hash=createHash('sha1').update(url).digest('hex');
    const cacheFile=within(ctx.dataDir,`compliance/cache/ocr/${hash}.json`);
    const cacheName=`compliance/cache/ocr/${hash}.json`;
    try{
      const cached=await ctx.readJson(cacheName,null);
      if(cached&&typeof cached.text==='string')return {text:cached.text,cached:true};
    }catch{}
    const local=await downloadImage(url,signal);
    if(signal?.aborted)throw new Error('扫描已取消');
    const text=await recognizeImage(local,signal);
    await fs.mkdir(path.dirname(cacheFile),{recursive:true});
    await ctx.writeJson(cacheName,{url,text,at:clock().toISOString()});
    return {text,cached:false};
  }
  const buildJobStats=summarizeProducts;
  function collectImageMap(products){
    const map=new Map();
    for(const product of products)for(const url of product.images||[]){
      if(!map.has(url))map.set(url,[]);
      if(!map.get(url).includes(product.id))map.get(url).push(product.id);
    }
    return map;
  }
  function issuesForProduct(record,rules,product,recognizedTexts,imageFailures){
    const issues=[];
    const text=[product.title,...(product.fields||[]).map(item=>item.text)].filter(Boolean).join('\n');
    const textFields=product.fields||[];
    for(const hit of findIssues(text,rules)){
      const hitFields=textFields.filter(item=>item.text&&item.text.includes(hit.term)).map(item=>item.field);
      issues.push({...hit,id:randomUUID(),jobId:record.id,productId:product.id,productTitle:product.title,sourceKind:'text',field:hitFields.join('、')||'标题/文字',status:'pending',createdAt:clock().toISOString()});
    }
    for(const url of product.images||[]){
      const ocrText=recognizedTexts.get(url);
      if(typeof ocrText==='string'){
        for(const hit of findIssues(ocrText,rules))issues.push({...hit,id:randomUUID(),jobId:record.id,productId:product.id,productTitle:product.title,sourceKind:'ocr',field:'图片',imageUrl:url,status:'pending',createdAt:clock().toISOString()});
      }else if(imageFailures.has(url)){
        issues.push({id:randomUUID(),jobId:record.id,productId:product.id,productTitle:product.title,sourceKind:'ocr',field:'图片',imageUrl:url,ruleId:'',ruleName:'图片未识别',category:'图片',riskLevel:'medium',term:'',evidence:imageFailures.get(url),status:'pending',createdAt:clock().toISOString(),unrecognized:true});
      }
    }
    return issues;
  }
  async function scanJob(state,record,signal){
    record.status='scanning';
    record.issues=record.issues||[];
    record.stats=buildJobStats(record.products,state.billing.unitPrice);
    record.progress={processed:0,total:record.products.length,message:'准备扫描'};
    await saveJob(record);
    const imageMap=collectImageMap(record.products);
    const recognizedTexts=new Map(),imageFailures=new Map();
    let billable=0,recognized=0;
    // 先识别图片（按 URL 去重）：图片识别是计费项，识别进度单独显示。
    if(imageMap.size){
      let index=0;
      for(const url of imageMap.keys()){
        if(signal.aborted)break;
        index+=1;
        ctx.emit?.({module:'compliance',jobId:record.id,current:index,total:imageMap.size,message:`正在识别图片 ${index}/${imageMap.size}`});
        try{
          const result=await ocrCached(url,signal);
          recognizedTexts.set(url,result.text);
          recognized+=1;
          if(!result.cached)billable+=1;
          record.stats.recognizedImageCount=recognized;
          record.progress={processed:0,total:record.products.length,message:`已识别图片 ${recognized}/${imageMap.size}`};
          await saveJob(record);
        }catch(error){
          if(signal.aborted)break;
          imageFailures.set(url,error.message||String(error));
          record.stats.skippedImageCount=(record.stats.skippedImageCount||0)+1;
        }
      }
    }
    if(signal.aborted){
      record.status='paused';
      record.finishedAt=null;
      record.progress={processed:0,total:record.products.length,message:'已停止：再次点“开始扫描”会重新核对（已识别的图片走缓存，不重复计费）'};
      await saveJob(record);
      return {record,billable,recognized};
    }
    const allIssues=[];
    // 大表逐行核对时不再每 10 行整盘保存一次：限制保存与进度回传的频率，界面才不会被写盘拖卡。
    let lastPersist=0,lastEmit=0;
    for(let index=0;index<record.products.length;index+=1){
      const product=record.products[index];
      const issues=issuesForProduct(record,state.rules,product,recognizedTexts,imageFailures);
      product.issueCount=issues.length;
      product.checkedAt=clock().toISOString();
      allIssues.push(...issues);
      record.issues=allIssues;
      record.progress={processed:index+1,total:record.products.length,message:`已核对 ${index+1}/${record.products.length} 个商品`};
      const last=index===record.products.length-1,now=Date.now();
      if(last||now-lastPersist>=2500){
        await saveJob(record);
        lastPersist=now;
        if(last||now-lastEmit>=400){
          ctx.emit?.({module:'compliance',jobId:record.id,current:index+1,total:record.products.length,message:record.progress.message});
          lastEmit=now;
        }
      }
    }
    record.issues=allIssues;
    record.status='completed';
    record.finishedAt=clock().toISOString();
    record.progress={processed:record.products.length,total:record.products.length,message:'扫描完成'};
    await saveJob(record);
    return {record,billable,recognized};
  }
  async function handle(action,p={}){
    if(disposed)throw new Error('程序正在退出或恢复数据');
    if(action==='load'){
      const state=await readState();
      const view=String(p.view||'scan');
      const jobs=state.jobs;
      // 上次运行被关闭/中断时任务会停在“扫描中”。重启后并没有真的在跑，统一改回“已停止”，
      // 用户点“继续扫描”即可从断点续跑（已识别图片走缓存，不重复计费）。
      if(!running&&jobs.some(job=>job.status==='scanning')){
        for(const job of jobs){
          if(job.status!=='scanning')continue;
          job.status='paused';
          job.progress={...(job.progress||{}),message:'上次扫描被中断，点“继续扫描”会接着上次的进度'};
          const record=await readJob(job.id).catch(()=>null);
          if(record&&record.status==='scanning'){
            record.status='paused';
            record.progress={...(record.progress||{}),message:'上次扫描被中断，点“继续扫描”会接着上次的进度（已识别图片走缓存，不重复计费）'};
            await saveJob(record);
          }
        }
        await saveState(state);
      }
      const selectedJobId=p.jobId&&jobs.some(job=>job.id===p.jobId)?p.jobId:(jobs[0]?.id||null);
      let job=null;
      if(selectedJobId&&['scan','process'].includes(view)){
        // 页面只看任务摘要与问题：不读商品清单（大表几百 MB，读了也没人用）。
        const record=await readJob(selectedJobId,{withProducts:false}).catch(()=>null);
        // 商品清单（几万行）不再随页面数据下发：界面只用任务摘要与命中问题。
        if(record)job={...jobSummary(record),issues:record.issues};
      }
      return {rules:state.rules,billing:state.billing,jobs,lastScan:state.lastScan||null,running,busy:running,selectedJobId,job};
    }
    if(action==='cancel'){
      if(!running)return {message:'当前没有正在扫描的任务'};
      scanAbort?.abort();activeChild?.kill?.();
      return {message:'已请求停止，当前已完成的结果会保留'};
    }
    if(action==='import'||action==='importPath'){
      let imported;
      if(action==='importPath'){
        // 按路径导入（批量脚本/模板重跑用）：不弹文件选择框。
        const source=path.resolve(String(p.path||''));
        const stat=await fs.stat(source).catch(()=>null);
        if(!stat?.isFile())throw new Error('商品表格不存在或无法读取');
        imported={path:source};
      }else{
        // 优先只选路径：解析放到独立线程里，导入大表时界面不会被卡住。
        const picked=typeof ctx.files.pickTablePath==='function'?await ctx.files.pickTablePath():null;
        if(picked?.canceled)return picked;
        imported=picked?.path?picked:await ctx.files.pickImport();
      }
      if(imported.canceled)return imported;
      const state=await readState();
      let productCount=0,stats=null,packed=null,storeName='';
      if(imported.rows){
        // 兼容旧入口（测试或其它调用方直接给 rows）：仍在主线程里整理。
        if(!Array.isArray(imported.rows)||!imported.rows.length||imported.rows.length>MAX_PRODUCTS||imported.rows.some(row=>!row||typeof row!=='object'))throw new Error('商品表格式无效或超过20万行');
        const headers=[...new Set(imported.rows.flatMap(row=>Object.keys(row||{})))];
        const products=imported.rows.map((row,index)=>productFromRow(row,index,headers));
        productCount=products.length;
        stats=buildJobStats(products,state.billing.unitPrice);
        packed=gzipSync(strToU8(JSON.stringify(products)),{level:6});
        storeName=storeNameFromRows(imported.rows,headers);
      }else{
        const parsed=await parseWorkbook(imported.path,state.billing.unitPrice);
        productCount=parsed.productCount;
        stats=parsed.stats;
        packed=parsed.packed;
        storeName=parsed.storeName||'';
      }
      const id=randomUUID();
      const fileName=String(imported.path||'').split(/[\\/]/).pop()||'';
      const name=String(p.name||fileName||`导入任务 ${new Date().toLocaleString('zh-CN')}`).slice(0,120);
      // 店铺名以表格为准（第一列“店铺名/旺旺名称”）；表格里没有就留空，界面显示“无”。
      const record={id,name,sourceFile:fileName,storeName:String(storeName||'').slice(0,60),createdAt:clock().toISOString(),status:'ready',productCount,issues:[],progress:{processed:0,total:productCount,message:'待扫描'},stats};
      await savePackedProducts(id,packed);
      await saveJob(record);
      state.jobs=[jobSummary(record),...state.jobs.filter(job=>job.id!==id)].slice(0,200);
      await saveState(state);
      return {job:jobSummary(record),jobs:state.jobs};
    }
    // 点击任务行里的店铺名可以直接改名（表格里没识别到店铺名时显示“无”，也能在这里补上）。
    if(action==='renameJob'){
      const id=String(p.jobId||'');
      const name=String(p.name??'').trim().slice(0,60);
      const state=await readState();
      const summary=state.jobs.find(item=>item.id===id);
      if(!summary)throw new Error('排查任务不存在');
      summary.storeName=name;
      await saveState(state);
      const record=await readJob(id,{withProducts:false}).catch(()=>null);
      if(record){record.storeName=name;await saveJob(record).catch(()=>{});}
      return {job:summary,jobs:state.jobs};
    }
    if(action==='deleteJob'){
      const state=await readState();
      const id=String(p.jobId||'');
      if(!state.jobs.some(job=>job.id===id))throw new Error('排查任务不存在');
      state.jobs=state.jobs.filter(job=>job.id!==id);
      await saveState(state);
      await fs.rm(within(ctx.dataDir,jobFile(id)),{force:true}).catch(()=>{});
      await fs.rm(within(ctx.dataDir,productFile(id)),{force:true}).catch(()=>{});
      return {deleted:true,jobs:state.jobs};
    }
    if(action==='saveRules'){
      if(running)throw new Error('本机排查任务正在进行，请完成或停止后再修改词库');
      const state=await readState();
      state.rules=normalizeRules(p.rules);
      await saveState(state);
      return {rules:state.rules};
    }
    if(action==='resetRules'){
      if(running)throw new Error('本机排查任务正在进行，请完成或停止后再修改词库');
      const state=await readState();
      state.rules=normalizeRules(DEFAULT_RULES);
      await saveState(state);
      return {rules:state.rules};
    }
    if(action==='importRules'){
      if(running)throw new Error('本机排查任务正在进行，请完成或停止后再修改词库');
      const imported=await ctx.files.pickImport();
      if(imported.canceled)return imported;
      const rows=Array.isArray(imported.rows)?imported.rows:[];
      if(!rows.length)throw new Error('规则文件没有可读取的内容');
      const pick=(row,keys)=>{for(const key of keys){const value=row[key];if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim();}return '';};
      const importedRules=[];
      for(const row of rows.slice(0,500)){
        const name=pick(row,['规则名称','名称','name','规则']);
        const raw=pick(row,['关键词','命中关键词','keywords','违规词','违规关键词']);
        const list=normalizeKeywords(raw).length?normalizeKeywords(raw):(Object.keys(row).length===1?normalizeKeywords(Object.values(row)[0]):normalizeKeywords(Object.values(row).join(',')));
        if(!list.length)continue;
        importedRules.push({
          id:`import-${randomUUID().slice(0,8)}`,
          name:name||list[0],
          category:pick(row,['分类','类别','category'])||'导入词库',
          level:LEVELS.includes(pick(row,['等级','级别','level']))?pick(row,['等级','级别','level']):'medium',
          keywords:list,
          exceptions:pick(row,['排除词','例外词','exceptions']),
          enabled:true
        });
      }
      if(!importedRules.length)throw new Error('没有识别到规则：请提供“关键词”列，或每行一个关键词');
      const state=await readState();
      state.rules=normalizeRules([...state.rules,...importedRules]);
      await saveState(state);
      return {imported:importedRules.length,rules:state.rules};
    }
    if(action==='updateIssue'){
      const jobId=String(p.jobId||''),issueId=String(p.issueId||''),status=String(p.status||'');
      if(!ISSUE_STATUSES.includes(status))throw new Error('不支持的问题状态');
      const record=await readJob(jobId);
      const target=record.issues.find(issue=>issue.id===issueId);
      if(!target)throw new Error('问题记录不存在');
      target.status=status;target.updatedAt=clock().toISOString();
      await saveJob(record);
      return {issue:{...target}};
    }
    if(action==='billingUpdate'){
      const state=await readState();
      if(p.unitPrice!==undefined){
        const unitPrice=Number(p.unitPrice);
        if(!Number.isFinite(unitPrice)||unitPrice<0||unitPrice>100)throw new Error('单价需在 0-100 元之间');
        state.billing.unitPrice=Number(unitPrice.toFixed(4));
      }
      if(p.topUp!==undefined){
        const amount=Number(p.topUp);
        if(!Number.isFinite(amount)||amount===0||Math.abs(amount)>100000)throw new Error('充值金额无效');
        state.billing.balance=Number((state.billing.balance+amount).toFixed(2));
        state.billing.entries=[{id:randomUUID(),at:clock().toISOString(),type:'topup',amount:Number(amount.toFixed(2)),balance:state.billing.balance,note:String(p.note||'手动调整').slice(0,120)},...state.billing.entries].slice(0,5000);
      }
      await saveState(state);
      return {billing:state.billing};
    }
    if(action==='image'){
      const url=String(p.url||'');
      const local=await downloadImage(url,undefined);
      const bytes=await fs.readFile(local);
      const extension=path.extname(local).toLowerCase();
      const mediaType=extension==='.png'?'image/png':extension==='.webp'?'image/webp':extension==='.gif'?'image/gif':'image/jpeg';
      if(bytes.length>MAX_IMAGE_BYTES)throw new Error('图片过大');
      return {dataUrl:`data:${mediaType};base64,${bytes.toString('base64')}`,mediaType,byteLength:bytes.length};
    }
    if(action==='export'){
      const record=await readJob(String(p.jobId||''));
      const filter=String(p.filter||'all');
      const issues=record.issues.filter(issue=>{
        if(filter==='high')return issue.riskLevel==='high';
        if(filter==='pending')return issue.status==='pending';
        if(filter==='text')return issue.sourceKind==='text';
        if(filter==='ocr')return issue.sourceKind==='ocr';
        return true;
      });
      const rows=issues.map(issue=>({
        商品ID:issue.productId,商品标题:issue.productTitle,风险等级:RISK_LABELS[issue.riskLevel]||issue.riskLevel,
        来源:issue.sourceKind==='ocr'?'图片识别':'表格文字',位置:issue.field||'',规则:issue.ruleName||'',命中词:issue.term||'',
        证据:issue.evidence||'',图片链接:issue.imageUrl||'',状态:STATUS_LABELS[issue.status]||issue.status
      }));
      const base=String(record.name||'违规排查').replace(/[\\/:*?"<>|]/g,'_').slice(0,60);
      return ctx.files.exportRows(`${base}-违规排查报告.xlsx`,rows);
    }
    if(action!=='scan')throw new Error('不支持的违规排查操作');
    if(running)throw new Error('已有扫描任务正在进行，请等待完成或先停止');
    const jobId=String(p.jobId||'');
    const state=await readState();
    const record=await readJob(jobId);
    running=true;scanAbort=new AbortController();
    const task=(async()=>{
      try{
        const {billable,recognized}=await scanJob(state,record,scanAbort.signal);
        let cost=0;
        // 已识别的图片照常计费（中途停止也一样，因为 OCR 已经跑过）；缓存命中的不计费。
        if(recognized>0){
          cost=Number((billable*state.billing.unitPrice).toFixed(2));
          state.billing.balance=Number((state.billing.balance-cost).toFixed(2));
          const entry={id:randomUUID(),at:clock().toISOString(),type:'scan',amount:-cost,balance:state.billing.balance,jobId:record.id,jobName:record.name,images:billable,cached:recognized-billable,note:`识别图片 ${billable} 张（缓存命中 ${recognized-billable} 张不计费）${record.status==='completed'?'':' · 扫描已停止，已识别的图片照常计费'}`};
          state.billing.entries=[entry,...state.billing.entries].slice(0,5000);
        }
        record.stats.actualCost=cost;
        state.lastScan={at:clock().toISOString(),status:record.status==='completed'?'完成':'已停止',jobId:record.id,name:record.name,completed:record.progress.processed,total:record.progress.total,issues:record.issues.length};
        state.jobs=state.jobs.map(item=>item.id===record.id?jobSummary(record):item);
        if(!state.jobs.some(item=>item.id===record.id))state.jobs=[jobSummary(record),...state.jobs].slice(0,200);
        await saveJob(record);
        await saveState(state);
        ctx.emit?.({module:'compliance',jobId:record.id,done:true,current:record.progress.processed,total:record.progress.total,message:record.status==='completed'?`扫描完成：${record.issues.length} 个问题`:'扫描已停止，已完成的结果保留'});
        return {job:jobSummary(record),issues:record.issues,billing:state.billing,jobs:state.jobs,lastScan:state.lastScan};
      }finally{
        running=false;scanAbort=null;activeChild=null;
      }
    })();
    activeTask=task;
    try{return await task;}finally{activeTask=null;}
  }
  return {handle,dispose:async()=>{disposed=true;scanAbort?.abort();activeChild?.kill?.();if(activeTask)await Promise.allSettled([activeTask]);}};
}
module.exports={createComplianceService,findIssues,normalizeRules,extractImages,productFromRow,storeNameFromRows,buildJobStats:summarizeProducts,DEFAULT_RULES,IMAGE_PATTERN,RISK_LABELS,STATUS_LABELS};
