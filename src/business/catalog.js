'use strict';

// 商品资料（天猫商家中心 → 商品管理 / 我的商品）来源。
//
// 2026-10-08 在真实页面核对过的读取路径：
//   https://wb.tmall.com/tmall/manager/render.htm?pagination.current=N&pagination.pageSize=20
// - 页面上方显示“共 1421 件商品”，底部显示“当前页 / 总页数”（本店 1/72，每页固定 20 条）；
// - 每行包含商品标题、`ID：1065707291746 编码：Q`、价格、库存、总销量和`创建时间 + 出售中/仓库中`；
// - 官方页面只提供标题、价格、库存、销量、创建时间和状态，没有类目列；
//   商品类目继续取生意参谋商品报表的类目ID/名称，不在这里猜测；
// - pageSize 参数被平台忽略，固定 20 条/页，因此必须逐页取回。
//
// 2026-10-09 起默认用**页面内 fetch 读取分页 HTML**（同一会话、同一来源），
// 不再整页跳转 72 次：整页快速连跳很容易触发滑块验证。fetch 被拒绝时才退回逐页打开。
// 无论哪种方式，商品ID 不重复、条数与页面总数一致才保存，否则整批丢弃。
const {FullSyncError}=require('./full-sync');
const {identifier,safeMessage}=require('./domain');
const {storeDirectory}=require('./repository');

const CATALOG_ORIGIN='https://wb.tmall.com';
const CATALOG_PATH='/tmall/manager/render.htm';
const CATALOG_PAGE_SIZE=20;
const SELLER_HOME='https://myseller.taobao.com/home.htm';
const CATALOG_URL=`${CATALOG_ORIGIN}${CATALOG_PATH}?pagination.current=1&pagination.pageSize=${CATALOG_PAGE_SIZE}`;
const MAX_PAGES=400,MAX_ITEMS=200000,PAGE_TIMEOUT_MS=30000,READ_TIMEOUT_MS=45000,FETCH_TIMEOUT_MS=15000;
// 列表接口每次只发一个很小的 POST；逐页打开的兜底路径慢一些，避免连续整页跳转触发风控。
// 按用户要求用回快速分页（0.2 秒/页，72 页约 15 秒）。遇到平台滑块时会停下并提示：
// 到店铺浏览器完成滑块后再点一次同步，会从断点继续（滑完页面可能跳到天猫后台首页，下一次会自动重开商品管理页）。
// 需求（本轮）：列表接口每页间隔从 0.2 秒放宽到 0.35 秒——连续 72 页的 0.2 秒节奏很容易触发平台的
// 读取限制（限流后要等 10-30 分钟），略放慢能显著降低被限流的概率，整体仍只要约 25 秒。
const FETCH_SPACING_MS=350,NAVIGATION_SPACING_MS=1500;
// 页面脚本（executeJavaScript）在页面正在验证/导航时可能一直不返回；每次调用都要有上限。
// 用户实测：页面停在验证页时每个脚本要等满 20 秒，整段同步看起来像卡死；这里收紧到 12 秒，
// 并且每次执行脚本前先用页面地址判断是不是已经停在登录/验证页（地址判断不走页面脚本，立刻返回）。
const PAGE_SCRIPT_TIMEOUT_MS=12000;
const fail=(code,message)=>{throw new FullSyncError(code,message);};
const LOGIN_HOST_PATTERN=/(?:^|\.)(?:login|passport|havanalogin|reg)\.(?:taobao|tmall|alibaba)\.com$/i;
const BLOCKED_PATH_PATTERN=/(?:^|\/)(?:login|passport|captcha|punish|verify|verification|security|validate|risk|error)(?:\/|\.|$|\?)/i;
// 页面地址是主进程直接给的，不需要页面脚本；用它先判断“是不是已经停在登录/验证页”。
function pageUrlProblem(webContents){
  let url;try{url=new URL(webContents.getURL?.()||'');}catch{return '';}
  if(LOGIN_HOST_PATTERN.test(url.hostname))return `${url.hostname}${url.pathname}`.slice(0,120);
  if(BLOCKED_PATH_PATTERN.test(url.pathname))return `${url.hostname}${url.pathname}`.slice(0,120);
  return '';
}
function assertCatalogPageUrl(webContents){
  const problem=pageUrlProblem(webContents);
  if(problem)fail('LOGIN_EXPIRED',`“商品管理”页面停在登录/验证页（${problem}）：请先在店铺浏览器里打开这家店完成登录或验证，再点“同步整店数据”`);
}
const delay=(ms,signal)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();resolve();},ms);
  const abort=()=>{cleanup();reject(new FullSyncError('CANCELED','商品资料读取已取消，原数据保持不变'));};
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
});
// 给页面脚本调用加超时：超时按“没有取到数据”处理，绝不让同步任务挂死。
function runPageScript(webContents,script,timeoutMs=PAGE_SCRIPT_TIMEOUT_MS){
  let timer=null;
  const call=Promise.resolve()
    .then(()=>webContents.executeJavaScript(script,false))
    .then(value=>({value}),error=>({error:String(error&&error.message||error)}));
  const limit=new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),timeoutMs);});
  return Promise.race([call,limit]).then(result=>{clearTimeout(timer);return result;},error=>{clearTimeout(timer);throw error;});
}
function normalizedStatus(value){
  const text=String(value||'').trim();
  if(!text)return '';
  if(/出售中|当前在线|在线/.test(text))return '出售中';
  if(/仓库中|已下架|下架/.test(text))return '仓库中';
  return text.slice(0,40);
}
function normalizedCreatedAt(value){
  const text=String(value||'').trim();
  if(!text)return '';
  const match=/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(text.replace(/\s+/g,' '));
  if(!match)return '';
  const day=match[1],parsed=Date.parse(`${day}T00:00:00Z`);
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==day)return '';
  return match[2]?`${day} ${match[2]}`:day;
}

// 页面侧脚本：解析一份“商品管理”文档（当前页面或 fetch 回来的 HTML 共用同一套规则）。
function parseCatalogDocument(root,currentUrl){
  const clean=value=>String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  // 注意：DOMParser 解析出来的文档没有 innerText，只有 textContent，两条路径都要能读。
  const textOf=node=>String(node?(node.innerText??node.textContent??''):'');
  const body=textOf(root.body);
  const totalMatch=/共\s*([\d,]+)\s*件商品/.exec(body);
  let page=null,pages=null;
  for(const node of root.querySelectorAll('div,span,p,strong')){
    if(node.children&&node.children.length>2)continue;
    const match=/^(\d{1,5})\s*\/\s*(\d{1,5})$/.exec(clean(textOf(node)));
    if(match){page=Number(match[1]);pages=Number(match[2]);break;}
  }
  const rows=[];
  for(const tableRow of root.querySelectorAll('tbody tr')){
    const text=clean(textOf(tableRow));
    const idMatch=/ID[：:]\s*(\d{6,30})/.exec(text);
    if(!idMatch)continue;
    const link=tableRow.querySelector('a[href*="detail."]')||tableRow.querySelector('a[href*="item.htm"]');
    const created=/(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)/.exec(text);
    const status=/(出售中|仓库中|已下架|下架|违规|预售|待上架|已售空)/.exec(text);
    const price=/¥\s*([\d.]+)/.exec(text);
    rows.push({
      itemId:idMatch[1],
      title:clean(link&&(link.innerText||link.textContent)||'').slice(0,200),
      itemStatus:status?status[1]:'',
      createdAt:created?created[1]:'',
      price:price?price[1]:'',
    });
  }
  return {
    url:String(currentUrl||''),
    blocked:/请完成(?:安全)?验证|滑动验证|访问受限|访问过于频繁|请拖动滑块|异常流量|x5sec/.test(body),
    loginRequired:root.querySelectorAll('input[type="password"]').length>0||/请先登录|登录已失效|登录状态已失效/.test(body),
    total:totalMatch?Number(totalMatch[1].replace(/,/g,'')):null,
    page,pages,rows,
    hasNext:page!==null&&pages!==null?page<pages:true,
  };
}

// 页面侧脚本：只读取当前渲染的“商品管理”表格与分页状态，不点击任何按钮。
function readCatalogDom(){
  return parseCatalogDocument(document,String(location.href||''));
}

// 页面侧脚本：商品列表真正的数据接口。
// “商品管理”页面本身只是一层外壳（服务端 HTML 里没有商品行），表格由
//   POST https://wb.tmall.com/tmall/manager/table.htm
//   body: jsonBody={"filter":{},"pagination":{current,pageSize},"table":{"sort":{}},"tab":"ALL"}
// 返回后前端再渲染。直接调用这个接口就不会整页跳转，也不用逐页渲染 72 次。
// 不发送任何 Cookie 之外的信息，也不改动店铺数据；遇到平台风控立即如实上报。
// 页面侧脚本：商品列表真正的数据接口（2026-10-09 用真实会话核对）。
//   POST /tmall/manager/table.htm
//   headers: content-type + X-Requested-With + X-XSRF-TOKEN（页面里的 window.csrfToken.tokenValue）
//   body:    jsonBody={"filter":{},"pagination":{current,pageSize},"table":{"sort":{}},"tab":"ALL"}
//   返回:    {success:true,data:{table:{dataSource:[{itemId,catId,itemDesc,managerPrice,quantity_m,soldQuantity_m,
//             upShelfDate_m:{value,status:{text}}}]},pagination:{current,total,pageSize}}}
// 每页 20 条（服务端固定），一次请求约 0.2 秒，且不整页跳转，比逐页打开安全得多。
function fetchCatalogTable(request){
  const page=Number(request&&request.page)||1;
  const token=String((window.csrfToken&&window.csrfToken.tokenValue)||'');
  const body='jsonBody='+encodeURIComponent(JSON.stringify({filter:{},pagination:{current:page,pageSize:20},table:{sort:{}},tab:'ALL'}));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  return fetch('/tmall/manager/table.htm',{method:'POST',credentials:'include',cache:'no-store',signal:controller.signal,
    headers:{'content-type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest','Accept':'application/json, text/plain, */*','X-XSRF-TOKEN':token},body})
    .then(async response=>{
      const text=await response.text();
      if(/FAIL_SYS_USER_VALIDATE|RGV587|x5secdata|bxpunish|\/punish\b|哎哟喂|滑动验证|请拖动滑块|访问过于频繁/.test(text)){
        return {ok:false,punished:true,status:response.status,page};
      }
      let payload=null;
      try{payload=JSON.parse(text);}catch{}
      if(!payload||typeof payload!=='object')return {ok:false,noRows:true,status:response.status,page};
      if(payload.success!==true)return {ok:false,backendRet:String(payload.message||payload.msg||'').slice(0,80),status:response.status,page};
      const data=payload.data&&typeof payload.data==='object'?payload.data:{};
      const table=data.table&&typeof data.table==='object'?data.table:{};
      const source=Array.isArray(table.dataSource)?table.dataSource:[];
      const rows=source.map(item=>{
        if(!item||typeof item!=='object')return null;
        const desc=item.itemDesc&&Array.isArray(item.itemDesc.desc)?item.itemDesc.desc:[];
        const title=String((desc.find(part=>part&&part.uiType==='link'&&part.text)||{}).text||'').slice(0,200);
        const date=item.upShelfDate_m&&typeof item.upShelfDate_m==='object'?item.upShelfDate_m:{};
        const status=date.status&&typeof date.status==='object'?date.status:{};
        return {
          itemId:String(item.itemId||''),
          title,
          itemStatus:String(status.text||''),
          createdAt:String(date.value||''),
          categoryId:String(item.catId||''),
        };
      }).filter(Boolean);
      const pagination=data.pagination&&typeof data.pagination==='object'?data.pagination:{};
      const total=Number(pagination.total);
      return {ok:true,status:response.status,fromTable:true,page,
        total:Number.isFinite(total)&&total>0?total:null,
        rows};
    })
    .catch(error=>({ok:false,fromTable:true,error:String(error&&error.message||error).slice(0,200)}))
    .finally(()=>clearTimeout(timer));
}

function catalogPageUrl(page){
  const url=new URL(CATALOG_PATH,CATALOG_ORIGIN);
  url.searchParams.set('pagination.current',String(page));
  url.searchParams.set('pagination.pageSize',String(CATALOG_PAGE_SIZE));
  return url.href;
}

// 页面里没有本文件的其它函数，所以把解析函数和读取函数拼成一段自包含脚本。
function catalogDomScript(){
  return `(()=>{${parseCatalogDocument.toString()};return (${readCatalogDom.toString()})();})()`;
}
function catalogTableScript(request){
  return `(()=>{${parseCatalogDocument.toString()};return (${fetchCatalogTable.toString()})(${JSON.stringify(request)});})()`;
}

function createCatalogReader(ctx,{now=()=>new Date(),timeoutMs=READ_TIMEOUT_MS,fetchSpacingMs=FETCH_SPACING_MS}={}){
  // 值是该次读取的令牌：取消后旧任务不会再把新任务的读取标记清掉。
  const active=new Map();
  // 逐页“打开页面”的兜底路径（fetch 被平台拒绝时使用）。
  async function readPageByNavigation(webContents,page,signal){
    const currentUrl=()=>{try{return String(webContents.getURL?.()||'');}catch{return '';}};
    // 页面是否“漂到别的后台地址”（例如滑完滑块跳回商家中心首页）。读不到地址时按“没漂”处理，
    // 继续用页面 DOM 判断（登录/验证页由 assertCatalogPageUrl 负责）。
    const drifted=()=>{
      try{
        const url=new URL(currentUrl());
        if(!/^https?:$/.test(url.protocol))return false;
        return !(url.origin===CATALOG_ORIGIN&&url.pathname.startsWith(CATALOG_PATH));
      }catch{return false;}
    };
    // 跳转本身也可能长时间不返回，最多等 15 秒后继续用轮询判断。
    const navigate=async()=>{
      await Promise.race([
        webContents.loadURL(catalogPageUrl(page)).catch(()=>null),
        new Promise(resolve=>setTimeout(resolve,15000)),
      ]).catch(()=>null);
      assertCatalogPageUrl(webContents);
    };
    // 需求7（本轮）：列表加载超时不再直接失败——先看页面是不是漂到别的后台地址（滑完滑块
    // 有时会跳回商家中心首页），是就重新打开“商品管理”；再整体重试；仍不行才失败，
    // 并把当时页面状态写进提示，同时由服务层把该页面显示出来（用户要求“页面要弹出来”）。
    // opens：整页打开的“次数上限”（第一次必须打开一次：确认登录并让 csrfToken 就绪；
    // 之后页面漂走或列表超时最多再补开两次）。
    let opens=0,diagnosis='';
    for(;;){
      if(signal?.aborted)fail('CANCELED','商品资料读取已取消，原数据保持不变');
      assertCatalogPageUrl(webContents);
      if(opens===0||drifted()){
        if(opens>=3)fail('CATALOG_NAVIGATION_FAILED',`“商品管理”页面没有打开成功（当前地址：${currentUrl().slice(0,120)}），商品资料未保存；请在工作台里确认这家店能打开“商品管理”后再重试`);
        opens++;await navigate();continue;
      }
      const deadline=now().getTime()+timeoutMs;
      for(;;){
        if(signal?.aborted)fail('CANCELED','商品资料读取已取消，原数据保持不变');
        assertCatalogPageUrl(webContents);
        const scripted=await runPageScript(webContents,catalogDomScript());
        if(scripted.timeout)fail('CATALOG_PAGE_TIMEOUT',`页面脚本 ${Math.round(PAGE_SCRIPT_TIMEOUT_MS/1000)} 秒内没有返回（页面可能停在验证页或一直加载中），商品资料未保存；请在店铺浏览器里确认这家店的“商品管理”页能正常显示后再重试`);
        const snapshot=scripted.error?null:scripted.value;
        if(snapshot?.blocked)fail('USER_VALIDATION_REQUIRED','平台要求完成滑动验证：请点“去店铺浏览器完成滑块”，在该店的“商品管理”页把滑块划完；完成后回来再点一次“同步整店数据”，会自动重新打开商品管理页并从断点继续');
        if(snapshot?.loginRequired)fail('LOGIN_EXPIRED','店铺登录已失效，请重新登录后再同步商品资料');
        if(snapshot&&Array.isArray(snapshot.rows)&&snapshot.rows.length&&snapshot.page===page)return snapshot;
        if(now().getTime()>deadline){
          diagnosis=snapshot?`当时页面：${String(snapshot.url||currentUrl()).slice(0,110)}，分页 ${snapshot.page||'?'}/${snapshot.pages||'?'}、${snapshot.rows.length} 行`:'当时没有取到页面列表状态';
          break;
        }
        await delay(600,signal);
      }
      if(opens>=3)fail('CATALOG_PAGE_TIMEOUT',`等待“商品管理”列表加载超时（${diagnosis}）。商品资料未保存；页面已显示这家店的“商品管理”，请确认能正常看到商品列表后，再点一次“同步整店数据”（会从断点继续）。`);
      opens++;await navigate();
    }
  }
  // 快速路径：直接 POST 列表接口（同一会话、同一来源、不整页跳转、不渲染）。
  // 平台风控时立即停止并如实上报，不继续加重限流。
  async function readPageByTable(webContents,page,pageSize,signal){
    if(signal?.aborted)fail('CANCELED','商品资料读取已取消，原数据保持不变');
    assertCatalogPageUrl(webContents);
    let scripted=await runPageScript(webContents,catalogTableScript({page}));
    // 需求（本轮）：列表接口偶尔会因为平台瞬时限流卡住；先看页面状态判定是不是滑块，否则
    // 隔 8 秒再试一次，再不行才按“被平台限流”停止（保留断点，稍后可从断点继续）。
    if(scripted.timeout){
      let blocked=false;
      for(let attempt=0;attempt<2&&!blocked;attempt++){
        assertCatalogPageUrl(webContents);
        const dom=await runPageScript(webContents,catalogDomScript(),5000).catch(()=>null);
        if(dom&&!dom.error&&!dom.timeout&&dom.value?.blocked)blocked=true;
        if(!blocked&&attempt===0)await delay(8000,signal);
      }
      if(blocked)fail('USER_VALIDATION_REQUIRED','平台要求完成滑动验证：已保存断点，请完成滑块后会自动从断点继续');
      assertCatalogPageUrl(webContents);
      scripted=await runPageScript(webContents,catalogTableScript({page}));
    }
    if(scripted.timeout){
      // 超时通常是平台限流或弹出了滑块：连续看几次页面状态（滑块浮层可能要等一会才出现），
      // 判定为验证就交给“暂停等待用户滑块、完成后自动断点续读”的流程；否则按限流停止并保留断点。
      for(let attempt=0;attempt<2;attempt++){
        assertCatalogPageUrl(webContents);
        const dom=await runPageScript(webContents,catalogDomScript(),5000).catch(()=>null);
        if(dom&&!dom.error&&!dom.timeout&&dom.value?.blocked)fail('USER_VALIDATION_REQUIRED','平台要求完成滑动验证：已保存断点，请完成滑块后会自动从断点继续');
        if(attempt<1)await delay(1200,signal);
      }
      fail('CATALOG_RATE_LIMITED',`平台短时间内限制了商品资料读取（列表接口超过 ${Math.round(PAGE_SCRIPT_TIMEOUT_MS/1000)} 秒没有返回）。已读到的商品已保存为断点：稍后点“同步整店数据”会从断点继续；如果完成了页面上的滑块仍然失败，请等 10-30 分钟再试`);
    }
    if(scripted.error)return {ok:false,reason:'页面脚本执行失败：'+safeMessage(scripted.error)};
    const result=scripted.value;
    if(!result||typeof result!=='object')return {ok:false,reason:'页面脚本没有返回结果'};
    if(result.punished)fail('USER_VALIDATION_REQUIRED','平台提示“被挤爆啦/需要滑动验证”：已保存断点，请完成页面上的滑块后会自动从断点继续');
    if(result.ok!==true)return {ok:false,reason:String(result.backendRet||result.error||(result.noRows?'返回里没有商品行':'接口未成功')).slice(0,120)};
    if(!Array.isArray(result.rows)||!result.rows.length)return {ok:false,reason:'返回里没有商品行'};
    return result;
  }
  async function readInner({storeId,signal,onProgress,_token}={}){
    const id=identifier(storeId),token=_token||{};
    if(typeof ctx.browser?.page!=='function')fail('PAGE_REQUIRED','当前环境不能打开店铺页面，无法读取商品资料');
    const items=new Map();let total=null,totalPages=null,page=1,webContents=null,fastMode=true,usedFallback=false,pageSize=CATALOG_PAGE_SIZE,resumePage=1;
    const warnings=['商品资料取自天猫商家中心“商品管理”全部宝贝列表，包含出售中与仓库中的商品，不含已删除商品。',
      '该页面只提供商品ID、标题、价格、库存、销量、创建时间与状态，没有类目列；类目仍取生意参谋商品报表。'];
    const progress=(message,current,totalCount)=>onProgress?.({current,total:totalCount??0,message,sourceId:'seller'});
    const progressPath=`${storeDirectory(id,typeof ctx.storeFolder==='function'?ctx.storeFolder(id):null)}/catalog-progress.json`;
    const readProgress=async()=>{try{const saved=await ctx.readJson(progressPath,null);return saved&&typeof saved==='object'&&saved.storeId===id?saved:null;}catch{return null;}};
    const saveProgress=async(done=false)=>{try{await ctx.writeJson(progressPath,{schemaVersion:1,storeId:id,total,totalPages,pageSize,page:done?Math.min(page,totalPages||page):page,firstIds:firstIds,items:[...items.values()],capturedAt:now().toISOString(),readComplete:done===true});}catch{}};
    let firstIds=[];
    try{
      webContents=await ctx.browser.page(id,'seller',{show:false,purpose:'business-catalog',background:true});
      if(!webContents||webContents.isDestroyed?.())fail('PAGE_REQUIRED','无法打开该店的千牛页面，请先在店铺登录中完成登录');
      // 先整页打开一次：确认登录，并让页面里的 window.csrfToken 就绪（接口要用它做 X-XSRF-TOKEN）。
      const shell=await readPageByNavigation(webContents,1,signal);
      // 第 1 页之后都走列表接口（含第 1 页）：一次 POST 约 0.2 秒，不整页跳转。
      const firstResult=await readPageByTable(webContents,1,signal);
      if(firstResult&&firstResult.ok!==true)warnings.push(`第 1 页列表接口未取到数据（${firstResult.reason||'未返回原因'}），本次改用逐页打开读取。`);
      const first=firstResult&&firstResult.ok?firstResult:shell;
      total=first.total;totalPages=first.pages||Math.max(1,Math.ceil(total/CATALOG_PAGE_SIZE));
      if(!Number.isSafeInteger(total)||total<=0||total>MAX_ITEMS)fail('CATALOG_TOTAL_UNCONFIRMED','未取得明确的“共 N 件商品”总数，商品资料未保存');
      if(!Number.isSafeInteger(totalPages)||totalPages<1||totalPages>MAX_PAGES)fail('CATALOG_TOTAL_UNCONFIRMED','未取得明确的总页数，商品资料未保存');
      firstIds=first.rows.map(row=>String(row.itemId||'')).filter(Boolean).sort();
      for(const row of first.rows){
        const itemId=String(row.itemId||'');
        if(!/^\d{6,30}$/.test(itemId)||items.has(itemId))fail('CATALOG_INVALID_ITEM','商品列表出现无效或重复商品ID，商品资料未保存');
        items.set(itemId,{itemId,title:String(row.title||'').slice(0,200),itemStatus:normalizedStatus(row.itemStatus),createdAt:normalizedCreatedAt(row.createdAt),categoryId:/^\d{1,20}$/.test(String(row.categoryId||''))?String(row.categoryId):''});
      }
      progress(`正在读取商品资料第 1/${totalPages} 页，已读取 ${items.size} 个商品`,items.size,total);
      // 上次没读完的批次：第一页完全一致就接着读，避免每次都从第 1 页重来（频繁翻页最容易触发风控）。
      const saved=await readProgress();
      if(saved&&!saved.complete&&saved.total===total&&saved.totalPages===totalPages&&Array.isArray(saved.items)&&Array.isArray(saved.firstIds)
        &&saved.firstIds.length===firstIds.length&&saved.firstIds.every((value,index)=>value===firstIds[index])&&Number.isSafeInteger(saved.page)&&saved.page>1){
        for(const item of saved.items){if(item&&typeof item.itemId==='string'&&/^\d{6,30}$/.test(item.itemId))items.set(item.itemId,{itemId:item.itemId,title:String(item.title||'').slice(0,200),itemStatus:normalizedStatus(item.itemStatus),createdAt:normalizedCreatedAt(item.createdAt),categoryId:/^\d{1,20}$/.test(String(item.categoryId||''))?String(item.categoryId):''});}
        resumePage=Math.min(saved.page+1,totalPages);
        pageSize=[20,50,100,200].includes(saved.pageSize)?saved.pageSize:CATALOG_PAGE_SIZE;
        usedFallback=true;
        if(saved.readComplete===true&&items.size===total){
          // 上次已经把全部商品读完、只是整批没落盘：直接用断点里的清单，不再请求平台。
          page=totalPages;resumePage=totalPages+1;
          warnings.push(`上次同步已读完全部商品但未保存，本次直接使用断点里的 ${total} 个商品。`);
          progress(`使用上次读到的 ${items.size} 个商品（已完整）`,items.size,total);
        }else{
          warnings.push(`上次同步读到第 ${saved.page} 页未完成，本次从第 ${resumePage} 页继续（商品ID、总数、页数都与上次一致才续读）。`);
          progress(`继续上次进度：从第 ${resumePage}/${totalPages} 页开始`,items.size,total);
        }
      }
      await saveProgress();
      // 第 1 页已经读过，循环从第 2 页（或上次断点的下一页）开始。
      for(page=Math.max(2,resumePage);page<=totalPages;page++){
        if(signal?.aborted)fail('CANCELED','商品资料读取已取消，原数据保持不变');
        let snapshot=null;
        if(!fastMode){
          snapshot=await readPageByNavigation(webContents,page,signal);
          await delay(NAVIGATION_SPACING_MS,signal);
        }else{
          snapshot=await readPageByTable(webContents,page,signal);
          if(!snapshot||snapshot.ok!==true){
            // 列表接口不可用时退回逐页打开（较慢，且页与页之间留足间隔）。
            fastMode=false;usedFallback=true;
            const why=snapshot&&snapshot.reason?snapshot.reason:'原因未返回';
            warnings.push(`列表接口没有取到完整数据（${why}），已改为逐页打开读取（每页之间留出间隔）；连续读取时请勿同时操作店铺后台。`);
            progress(`列表接口未取到数据（${why}），正在改为逐页打开…`,items.size,total??0);
            snapshot=await readPageByNavigation(webContents,page,signal);
          }else{
            await delay(fetchSpacingMs,signal);
          }
        }
        if(snapshot.total!==null&&snapshot.total!==undefined&&snapshot.total!==total)fail('CATALOG_TOTAL_CHANGED','读取过程中商品总数发生变化，本次未保存');
        if(!snapshot.rows.length)fail('CATALOG_EMPTY_PAGE',`第 ${page} 页没有读到商品记录，商品资料未保存`);
        for(const row of snapshot.rows){
          const itemId=String(row.itemId||'');
          if(!/^\d{6,30}$/.test(itemId)||items.has(itemId))fail('CATALOG_INVALID_ITEM','商品列表出现无效或重复商品ID，商品资料未保存');
          items.set(itemId,{itemId,title:String(row.title||'').slice(0,200),itemStatus:normalizedStatus(row.itemStatus),createdAt:normalizedCreatedAt(row.createdAt),categoryId:/^\d{1,20}$/.test(String(row.categoryId||''))?String(row.categoryId):''});
        }
        await saveProgress();
        progress(`正在读取商品资料第 ${page}/${totalPages} 页，已读取 ${items.size} 个商品`,items.size,total);
      }
      if(signal?.aborted)fail('CANCELED','商品资料读取已取消，原数据保持不变');
      if(total!==null&&items.size!==total)fail('CATALOG_INCOMPLETE',`已读取 ${items.size} 个商品与页面总数 ${total} 不一致，商品资料未保存`);
      const list=[...items.values()];
      if(!list.length)fail('CATALOG_EMPTY','商品列表没有可保存的记录');
      const statuses={};
      for(const item of list)statuses[item.itemStatus||'未标注']=(statuses[item.itemStatus||'未标注']||0)+1;
      const missingCreated=list.filter(item=>!item.createdAt).length;
      const mode=usedFallback?'逐页打开（列表接口不可用或续读）':'列表接口快速读取';
      // 注意：这里**不清空**断点文件。商品资料真正写入是在整批同步成功之后，
      // 如果读完后整批因为其它来源失败，断点还在，下次会从最后一页继续，不必从头再翻 72 页。
      await saveProgress(true);
      return {schemaVersion:1,storeId:id,capturedAt:now().toISOString(),readMode:mode,
        source:{origin:CATALOG_ORIGIN,route:CATALOG_PATH},
        totalCount:total,pages:totalPages,items:list,statuses,
        warnings:[...warnings,
          `本次读取方式：${mode}。`,
          missingCreated?`${missingCreated} 个商品未在列表显示创建时间，创建时间保持空白。`:''].filter(Boolean)};
    }finally{
      // 只有仍然持有该店读取标记时才归还页面，避免被取消后新开的任务被旧任务打断。
      const owned=active.get(id)===token;
      if(owned)active.delete(id);
      // 读取会临时占用该店的千牛页面；结束（成功、失败或取消）后尽量送回千牛首页，
      // 免得后续账单/推广/品牌新享来源看到的是商品管理页。
      // 注意：个别跳转（重定向/风控页）可能永远不返回，这里最多等 8 秒，绝不把同步任务挂死。
      if(owned&&webContents&&!webContents.isDestroyed?.()){
        await Promise.race([
          webContents.loadURL(SELLER_HOME).catch(()=>null),
          new Promise(resolve=>setTimeout(resolve,8000)),
        ]).catch(()=>null);
      }
    }
  }
  // 取消要立刻生效：即使内部某一步（例如页面脚本）卡住不返回，外层也会在收到取消信号时
  // 立即结束，并释放该店的读取标记，界面上的“取消同步”不会再一直等下去。
  async function read(options={}){
    const id=identifier(options.storeId),signal=options.signal;
    if(active.has(id))fail('SYNC_BUSY','当前店铺已有商品资料读取任务');
    const token={};
    active.set(id,token);
    const work=readInner({...options,_token:token});
    work.catch(()=>{});
    if(!signal)return work;
    let onAbort=null;
    const canceled=new Promise((resolve,reject)=>{
      const abort=()=>{if(active.get(id)===token)active.delete(id);reject(new FullSyncError('CANCELED','商品资料读取已取消，原数据保持不变'));};
      if(signal.aborted){abort();return;}
      onAbort=abort;
      signal.addEventListener('abort',abort,{once:true});
    });
    try{return await Promise.race([work,canceled]);}
    finally{if(onAbort)signal.removeEventListener('abort',onAbort);}
  }
  return {read};
}

function createCatalogStore(ctx){
  const path=storeId=>`${storeDirectory(identifier(storeId),typeof ctx.storeFolder==='function'?ctx.storeFolder(identifier(storeId)):null)}/catalog.json`;
  async function load(storeId){
    const raw=await ctx.readJson(path(identifier(storeId)),null);
    if(!raw||typeof raw!=='object'||raw.storeId!==storeId||!Array.isArray(raw.items)||!Number.isSafeInteger(raw.totalCount))return null;
    return raw;
  }
  async function save(value){
    const storeId=identifier(value?.storeId);
    const record={...value,storeId,capturedAt:new Date(value.capturedAt).toISOString()};
    await ctx.writeJson(path(storeId),record);
    return record;
  }
  return {load,save};
}

module.exports={CATALOG_URL,CATALOG_ORIGIN,CATALOG_PATH,CATALOG_PAGE_SIZE,SELLER_HOME,catalogPageUrl,MAX_ITEMS,normalizedStatus,normalizedCreatedAt,readCatalogDom,fetchCatalogTable,parseCatalogDocument,catalogDomScript,catalogTableScript,createCatalogReader,createCatalogStore,safeMessage};
