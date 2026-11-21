'use strict';

const {dateRange,isoDate,cleanText}=require('../insights/collectors/common');
const {METRICS,shopNamesMatch}=require('./domain');
const {readSycmSelectedShop}=require('./store-identity');

// This function only reads the already rendered DOM. It must not click, scroll,
// navigate, refresh, fetch, inspect network traffic, or access authentication state.
function readVisiblePage(){
  const visible=n=>!!n&&!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'&&getComputedStyle(n).display!=='none';
  const text=n=>String(n?.innerText||'').replace(/\u00a0/g,' ').trim();
  const body=text(document.body).slice(0,100000),header=document.querySelector('header,.sycm-header,#header,.ebase-FusionHeader,.ebase-Header');
  const identitySelectors='[data-shop-name],.shop-name,.shopName,.user-name,.userName,.user-nick,.userNick';
  const inHeader=n=>header?header.contains(n):!n.closest('table,[role="table"]')&&n.getBoundingClientRect().top>=0&&n.getBoundingClientRect().top<240;
  const identities=[...document.querySelectorAll(identitySelectors)].filter(visible).filter(inHeader).map(n=>({name:text(n),id:n.getAttribute('data-shop-id')||''})).filter(x=>x.name&&x.name.length<=160);
  for(const anchor of [...(header||document).querySelectorAll('a[href]')].filter(visible)){
    if(!inHeader(anchor))continue;
    try{const url=new URL(anchor.href);if(!/(^|\.)(taobao|tmall)\.com$/.test(url.hostname))continue;const id=url.searchParams.get('shopId')||url.searchParams.get('shop_id');if(id&&/^\d+$/.test(id)){const name=text(anchor);if(name&&name.length<160)identities.push({name,id});}}catch{}
  }
  const dateTexts=[...document.querySelectorAll('input')].filter(visible).map(n=>String(n.value||'')).filter(s=>/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(s)).slice(0,6);
  const statistics=[...document.querySelectorAll('span,p,div')].filter(visible).map(text).filter(s=>s.length<140&&/统计(?:日期|时间)|数据日期/.test(s)&&/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(s)).slice(0,6);
  const selected=[...document.querySelectorAll('[aria-selected="true"],.ant-radio-button-wrapper-checked,.ant-tabs-tab-active,.next-tabs-tab.active')].filter(visible).map(text).filter(x=>x.length<80).slice(0,30);
  const tables=[];
  for(const table of document.querySelectorAll('table,[role="table"]')){
    if(!visible(table))continue;const container=table.closest('.next-table,.ant-table,[class*="table-wrapper"]')||table;
    let heads=[...table.querySelectorAll('thead tr:last-child th,thead tr:last-child td,[role="columnheader"]')].filter(visible).map(text);
    if(!heads.length)heads=[...container.querySelectorAll('thead tr:last-child th,[role="columnheader"]')].filter(visible).map(text);
    if(!heads.some(h=>/商品|宝贝/.test(h))||!heads.some(h=>/访客|支付|买家/.test(h)))continue;
    const rows=[...table.querySelectorAll('tbody tr,[role="row"]')].filter(n=>visible(n)&&!n.querySelector('th')).slice(0,500).map(row=>({cells:[...row.querySelectorAll('td,[role="cell"]')].map(cell=>({text:visible(cell)?text(cell).slice(0,1600):'',links:[...cell.querySelectorAll('a[href]')].filter(visible).map(a=>{try{const u=new URL(a.href);const id=/(^|\.)(taobao|tmall)\.com$/.test(u.hostname)?u.searchParams.get('id')||u.searchParams.get('itemId'):null;return {text:text(a).slice(0,600),productId:/^\d{5,30}$/.test(id||'')?id:''};}catch{return {text:'',productId:''};}}).slice(0,4)}))})).filter(r=>r.cells.length);
    if(rows.length)tables.push({headers:heads,rows});
  }
  const pagination=[...document.querySelectorAll('.ant-pagination,.next-pagination,[class*="pagination"]')].filter(visible).map(text).join(' ').slice(0,500);
  const blocked=/请完成(?:安全)?验证|滑动验证|访问受限|访问过于频繁|账号(?:已)?(?:封禁|冻结)|账号存在风险|网络崩溃/.test(body)||[...document.querySelectorAll('input[type="password"],#login-form,.nc-container,[role="dialog"]')].filter(visible).some(n=>n.matches('input[type="password"]')||/登录|安全验证|访问受限/.test(text(n)));
  return {url:location.origin+location.pathname,identities:[...identities,...readSycmSelectedShop()],dateTexts,statistics,selected,tables,pagination,blocked,loading:!![...document.querySelectorAll('[aria-busy="true"],.ant-spin-spinning,.next-loading-tip')].find(visible)};
}

const buildVisibleReadScript=()=>`(()=>{${readSycmSelectedShop.toString()};return (${readVisiblePage.toString()})();})()`;
const normalizedName=value=>String(value||'').replace(/\s/g,'').trim();
function sourceIdentity(snapshot,store){
  if(snapshot?.blocked)throw new Error('页面出现登录、验证或访问限制；已停止读取，请手动处理后再试');
  const matches=(snapshot.identities||[]).filter(x=>shopNamesMatch(x.name,store.name));
  if(!matches.length)throw new Error('未在页面顶部确认当前店铺名称；请核对后台店铺与工作台所选店铺一致，本次未保存');
  const ids=[...new Set(matches.map(x=>x.id).filter(x=>/^\d{1,30}$/.test(x)))];
  if(ids.length>1)throw new Error('页面店铺身份有冲突，本次未保存');
  return {platformShopId:ids[0]||'',shopName:cleanText(matches[0].name,160),...(ids.length?{}:{identityType:'visible-name'})};
}
function exactNumber(value){
  const raw=String(value??'').trim().replace(/[,，\s￥¥]/g,'');
  if(!/^\d+(?:\.\d+)?(?:%|％|元|人|次|件)?$/.test(raw))return null;
  const n=Number(raw.replace(/[%％元人次件]$/,''));return Number.isFinite(n)?n:null;
}
function headerKey(value){return String(value||'').replace(/\s|[（(][^）)]*[）)]|[\uE000-\uF8FF]/g,'');}
const labels={visitors:['访客数','商品访客数'],pageViews:['浏览量','商品浏览量'],buyers:['支付买家数','支付买家'],payAmount:['支付金额'],conversionRate:['支付转化率'],unitPrice:['客单价'],cartItems:['加购件数','商品加购件数'],searchVisitors:['搜索访客数','搜索访客','淘宝搜索访客数'],refundAmount:['退款金额','成功退款金额'],refundRate:['退款率','金额退款率']};
const units={visitors:['人'],pageViews:['次'],buyers:['人'],payAmount:['元'],conversionRate:['%','％'],unitPrice:['元'],cartItems:['件'],searchVisitors:['人'],refundAmount:['元'],refundRate:['%','％']};
function metricHeader(value,key,names){
  const label=String(value||'').replace(/\s|[\uE000-\uF8FF]/g,''),suffix=label.match(/^(.*?)[（(]([^）)]*)[）)]$/);
  // Never discard a scale or percent unit: 万元 and ‰ are not 元 and %.
  return suffix?units[key].includes(suffix[2])&&names.includes(suffix[1]):names.includes(label);
}
function productPageRows(snapshot,{start,end}){
  if(start!==end)throw new Error('当前页面保存按单日核对，请将开始和结束日期设为后台当前统计日期');
  if(snapshot.loading)throw new Error('页面数据仍在加载，请显示完成后再同步当前页面');
  const evidence=[...(snapshot.dateTexts||[]),...(snapshot.statistics||[])];
  const range=dateRange(evidence||[]);
  if(range.startDate!==start||range.endDate!==end)throw new Error('页面显示的统计日期与工作台所选日期不一致，本次未保存');
  const everyDate=(evidence||[]).flatMap(s=>String(s).match(/\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}日?/g)||[]).map(isoDate);
  if(everyDate.some(date=>date!==start))throw new Error('页面存在不同统计日期，无法确认当前商品数据所属日期，本次未保存');
  if((snapshot.selected||[]).some(s=>/^(实时|周|月|近7天|近30天)$/.test(s)))throw new Error('请在后台选择单日统计，不能将实时或区间数据作为日报');
  const found=new Map();let skipped=0;
  for(const table of snapshot.tables||[]){
    const headers=table.headers.map(headerKey),at=names=>headers.findIndex(h=>names.includes(h));
    const titleIndex=at(['商品','商品信息','商品名称','商品标题','宝贝','宝贝名称']),idIndex=at(['商品ID','宝贝ID']);
    if(titleIndex<0&&idIndex<0)continue;
    const indices=Object.fromEntries(Object.entries(labels).map(([key,names])=>[key,table.headers.findIndex(label=>metricHeader(label,key,names))]));
    if(indices.visitors<0&&indices.payAmount<0)continue;
    for(const item of table.rows){
      if(item.cells.length!==headers.length){skipped++;continue;}
      const titleCell=item.cells[titleIndex],idText=item.cells[idIndex]?.text||'';
      const linked=item.cells.flatMap(c=>c.links||[]).find(l=>l.productId);
      const textual=item.cells.map(c=>c.text).join(' ').match(/(?:商品|宝贝)?\s*ID\s*[:：]?\s*(\d{5,30})/i);
      const productId=/^\d{5,30}$/.test(idText.trim())?idText.trim():linked?.productId||textual?.[1]||'';
      if(!productId){skipped++;continue;}
      const row={date:start,productId,title:cleanText(titleCell?.links?.find(l=>l.text)?.text||titleCell?.text||'',600),category:cleanText(item.cells[at(['类目','商品类目'])]?.text||'',300)};
      for(const metric of METRICS)row[metric]=null;
      for(const [key,index]of Object.entries(indices)){if(index>=0)row[key]=exactNumber(item.cells[index].text);}
      if(METRICS.every(k=>row[k]===null)){skipped++;continue;}
      const previous=found.get(productId);
      if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw new Error('当前页面出现同一商品的冲突数据，请核对表格后再保存');
      found.set(productId,row);
    }
  }
  if(!found.size)throw new Error('当前页面未识别到可确认商品ID和指标的商品表格；未自动查询或翻页');
  return {rows:[...found.values()],warnings:[...(skipped?[`${skipped} 行缺少明确商品ID、列对应或数值，未混入本批。`]:[]),'仅保存当前页面已加载的商品行，不代表店铺全部商品；未自动翻页。','缩略数、区间或无法确认的指标保留为空，未按零计算。'],coverage:{scope:'visible-page',complete:false,dates:[start],visibleRows:found.size}};
}

module.exports={buildVisibleReadScript,sourceIdentity,exactNumber,productPageRows,normalizedName};
