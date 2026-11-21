'use strict';

/**
 * 上品库 · SKU 规格名整理 / 对齐（老软件 sku-match-ai 的确定性版）
 *
 * 老软件用 AI 把「上游规格名」对齐到「本店已有规格名」。这里先做不联网的两步：
 *   1) normalize：去掉营销词、emoji、括号修饰、重复的量词后缀，留下真正的规格差异；
 *   2) match：把源规格名按「字二元组重合度」对齐到目标模板名，返回分数，低于阈值就不硬对。
 * 需要 AI 的语义对齐（比如「大果」↔「特大号」）仍可后续接网关，这里保底不误改。
 */

const NOISE = /(?:【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)|✅|️|🔥|❤|★|●|◆|▲|▶|·)/g;
const MARKETING = /(?:包邮|顺丰|现货|秒发|买一送一|限时|特价|爆款|热销|正品|官方|旗舰|专柜|厂家直销|一件代发|新品尝鲜|加量不加价)/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu;

function normalizeSkuName(raw) {
  let text = String(raw == null ? '' : raw);
  text = text.replace(EMOJI, ' ').replace(NOISE, ' ').replace(MARKETING, ' ');
  text = text.replace(/[，,、;；]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // 「1000克*1袋」「1000g×2包」这类量词保留（是真正的规格差异），只压缩写法
  text = text.replace(/(\d)\s*(?:克|g)\s*[*×xX]\s*(\d)/g, '$1g*$2');
  text = text.slice(0, 60);
  return text || String(raw == null ? '' : raw).trim().slice(0, 60);
}

/** 字二元组 + 数字/字母词元的集合（中文按双字切，英文数字按词切）。 */
function tokens(text) {
  const value = String(text || '').toLowerCase();
  const out = new Set();
  for (const word of value.match(/[a-z]+|\d+(?:\.\d+)?/g) || []) out.add(`w:${word}`);
  const han = value.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i < han.length - 1; i += 1) out.add(`h:${han.slice(i, i + 2)}`);
  if (han.length === 1) out.add(`h:${han}`);
  return out;
}

function similarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const token of ta) if (tb.has(token)) hit += 1;
  return hit / Math.max(ta.size, tb.size);
}

/**
 * 把源规格名对齐到目标模板名。
 * @returns {{mapping: Array<{source:string,target:string,score:number}>, unmatched: string[]}}
 */
function matchToTemplate(sourceNames, templateNames, { threshold = 0.5 } = {}) {
  const targets = [...new Set((Array.isArray(templateNames) ? templateNames : []).map(normalizeSkuName).filter(Boolean))];
  const mapping = [];
  const unmatched = [];
  for (const raw of Array.isArray(sourceNames) ? sourceNames : []) {
    const source = normalizeSkuName(raw);
    if (!source) continue;
    let best = null;
    for (const target of targets) {
      const score = similarity(source, target);
      if (!best || score > best.score) best = { target, score };
    }
    if (best && best.score >= threshold) mapping.push({ source, target: best.target, score: Number(best.score.toFixed(2)) });
    else unmatched.push(source);
  }
  return { mapping, unmatched };
}

/** 批量整理规格名（保留顺序、去重同名；重名的按老软件规则加「（规格N）」）。 */
function cleanSkuNames(names) {
  const out = [];
  const seen = new Map();
  for (const raw of Array.isArray(names) ? names : []) {
    let name = normalizeSkuName(raw);
    if (!name) continue;
    const count = seen.get(name) || 0;
    seen.set(name, count + 1);
    if (count) name = `${name}（规格${count + 1}）`;
    out.push(name);
  }
  return out;
}

module.exports = { normalizeSkuName, similarity, matchToTemplate, cleanSkuNames };
