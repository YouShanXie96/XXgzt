'use strict';
// Observed in the 2026-09-17 SYCM header. Read only the visible selected shop;
// the adjacent 主店 badge is metadata, not part of its business name.
function readSycmSelectedShop(){
 if(location.origin!=='https://sycm.taobao.com')return [];
 const visible=node=>{
  if(!node?.getClientRects().length)return false;
  for(let current=node;current&&current.nodeType===1;current=current.parentElement){const style=getComputedStyle(current);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.opacity==='0')return false;}
  return true;
 };
 return [...document.querySelectorAll('.ebase-frame-header-headerShopSelect')].filter(visible).filter(node=>{const top=node.getBoundingClientRect().top;return top>=0&&top<180&&!node.closest('table,[role="table"],[role="listbox"]');}).map(node=>{
  const copy=node.cloneNode(true);for(const badge of copy.querySelectorAll('[class*="-shopTextIcon-"],svg'))badge.remove();
  return {name:String(copy.textContent||'').trim().replace(/\s+/g,' '),id:''};
 }).filter(item=>item.name.length>=2&&item.name.length<=160);
}
module.exports={readSycmSelectedShop};
