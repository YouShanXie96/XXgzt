'use strict';

/**
 * 叶子类目中文路径兜底。
 *
 * 老软件的类目行是「一级 xxx › 二级 xxx › 三级 xxx ID xxx」，三级中文来自
 * 商品表单 SaaS 的 breadcrumb；新软件没有 SaaS，主数据源改为插件采集时从商品页
 * 内嵌 JSON / 面包屑提取的 category_levels，或 getdetail 接口返回的类目链。
 *
 * 这里只作最后兜底，而且是**保守**的：只用本机类目树缓存里已经读到的真实中文名，
 * 不臆造叶子类目名称。查不到就返回空串，由编辑器明确显示「类目 ID」而不是假装知道。
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * 从类目树缓存构建 id → {name,parent} 索引，再按叶子 ID 向上拼完整路径。
 * @param {string} cacheFile category-cache.json 绝对路径
 * @returns {{byId: Map<string,{name:string,parent:string}>, pathOf: (id:string)=>string}}
 */
function buildIndex(cacheFile) {
  const byId = new Map();
  let data = {};
  try { data = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* 缓存不存在 */ }
  for (const [key, entry] of Object.entries(data?.levels || {})) {
    const parent = key.includes('|') ? key.slice(key.lastIndexOf('|') + 1) : '';
    for (const node of (entry && Array.isArray(entry.items) ? entry.items : [])) {
      const id = String(node?.id || '').trim();
      if (!id) continue;
      const prev = byId.get(id);
      // 有父级信息的记录更可信（root 层的重复记录不要覆盖）
      if (!prev || (parent && !prev.parent)) byId.set(id, { name: String(node?.name || ''), parent: parent === 'root' ? '' : parent });
    }
  }
  const pathOf = id => {
    const names = [];
    let cur = String(id || '').trim();
    for (let depth = 0; cur && depth < 8; depth += 1) {
      const node = byId.get(cur);
      if (!node || !node.name) return names.length ? names.join(' > ') : '';
      names.unshift(node.name);
      cur = node.parent;
    }
    return names.length ? names.join(' > ') : '';
  };
  return { byId, pathOf };
}

let cached = null;
/** 返回真实可验证的中文路径；查不到返回空串（不臆造）。 */
function knownCategoryPath(id, cacheFile) {
  const key = String(id || '').trim();
  if (!/^\d{2,16}$/.test(key)) return '';
  const file = cacheFile || path.join(__dirname, '..', '..', '..', '..', '用户数据', 'selectionpool', 'category-cache.json');
  if (!cached || cached.file !== file) cached = { file, index: buildIndex(file) };
  return cached.index.pathOf(key);
}

module.exports = { knownCategoryPath, buildIndex };
