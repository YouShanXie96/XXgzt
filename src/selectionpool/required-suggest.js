'use strict';

/**
 * 上品库 · 必填项「提议」引擎（老软件 form-capture-magix-ai + required-gaps 的确定性替代）
 *
 * 老软件把「模板与源参数都没覆盖到的必填项」交给公司 AI 提议。我们这里先做**完全不联网**的
 * 确定性提议：从草稿参数、标题、规格名、店铺类目里推，优先级
 *   参数证据 > 标题/规格推算 > 类目默认 > 上次成功记忆（营养成分表等）
 * 每个提议都带来源，写进日志，用户能一眼看出这个值是哪来的、要不要改。
 *
 * 另外记忆（老软件 product-nutrient-memory）：
 *   同一个 品牌|品名 上架成功后，把这次填对的「配料表 / 营养成分 / 保质期 / 生产许可证」等记下来，
 *   下次同款直接复用。
 */

const C = require('./contract');

const MEMORY_FILE = 'selectionpool/required-memory.json';
const FOOD_WORDS = /(?:食品|零食|饼干|糖果|糖$|糕点|面包|坚果|果干|肉|奶|茶|咖啡|调味|酱|面|粉丝|罐头|饮料|冲饮|乳|巧克力|果冻|蜜饯|蜜饯|膨化|麦片|杂粮|米|油)/;

/** 从「250g*5袋」「500克×2」这类文案里抽净含量与件数。 */
function parseWeight(text) {
  const raw = String(text || '');
  const match = raw.match(/(\d{1,4}(?:\.\d{1,2})?)\s*(kg|千克|g|克|ml|毫升|l|升)\s*(?:[*×xX]\s*(\d{1,3})\s*(?:袋|盒|包|瓶|罐|件|支|条|个))?/i);
  if (!match) return null;
  const unitRaw = match[2].toLowerCase();
  const unit = /^(kg|千克)$/.test(unitRaw) ? 'kg' : /^(ml|毫升)$/.test(unitRaw) ? 'ml' : /^(l|升)$/.test(unitRaw) ? 'L' : 'g';
  const amount = Number(match[1]);
  const packs = Number(match[3]) || 1;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const total = unit === 'kg' || unit === 'L' ? amount * 1000 * packs : amount * packs;
  const unitOut = unit === 'kg' || unit === 'L' ? 'g' : unit;
  return {
    single: `${amount}${unit === 'kg' ? 'kg' : unit === 'L' ? 'L' : unit === 'ml' ? 'ml' : 'g'}`,
    total: unitOut === 'ml' ? `${total}ml` : `${total}g`,
    packs,
  };
}

function createSuggestionEngine({ ctx } = {}) {
  const readJson = (file, fallback) => (ctx?.readJson ? ctx.readJson(file, fallback) : Promise.resolve(fallback));
  const writeJson = (file, value) => (ctx?.writeJson ? ctx.writeJson(file, value) : Promise.resolve(false));

  const keyOf = (draft, detail) => {
    const brand = C.str(draft?.brand || '').trim();
    const name = C.str(detail?.attributes?.find?.(a => /^(?:品名|商品名称|产品名称)$/.test(C.str(a?.name)))?.value
      || detail?.product?.title || draft?.title || '').trim();
    if (!name) return '';
    return `${brand}|${name}`.slice(0, 120);
  };

  async function memories() {
    const data = await readJson(MEMORY_FILE, { version: 1, rows: {} });
    return (data && data.rows && typeof data.rows === 'object') ? data.rows : {};
  }

  /**
   * 生成必填提议：返回 [{name, value, source}]。
   * source: '参数' / '标题推算' / '类目默认' / '记忆' —— 日志里直接展示。
   */
  async function hintsFor(draft = {}, detail = {}) {
    const out = [];
    const seen = new Set();
    const push = (name, value, source) => {
      const n = C.str(name).trim();
      const v = C.str(value == null ? '' : value).trim();
      if (!n || !v || seen.has(n)) return;
      seen.add(n);
      out.push({ name: n, value: v.slice(0, 200), source });
    };

    const attrs = [
      ...C.list(draft?.attrs),
      ...C.list(detail?.attributes),
    ].filter(a => a && a.name);
    const byName = new Map(attrs.map(a => [C.str(a.name).trim(), C.str(a.value).trim()]));
    const get = (...names) => {
      for (const name of names) {
        if (byName.has(name) && byName.get(name)) return byName.get(name);
      }
      return '';
    };
    const name = get('品名', '商品名称', '产品名称') || C.str(detail?.product?.title || draft?.title).trim();
    const categoryText = `${C.str(draft?.categoryPath || detail?.categoryPath)} ${name}`;
    const isFood = FOOD_WORDS.test(categoryText);

    // 1) 参数本身就是证据
    for (const [key, value] of byName) push(key, value, '参数');

    // 2) 净含量：参数 → 标题/规格推算
    const weight = parseWeight(get('净含量', '单件净含量', '规格', '总净含量'))
      || parseWeight(name)
      || parseWeight(C.list(draft?.skus).map(s => s?.name).join(' '));
    if (weight) {
      push('净含量', weight.single, '标题推算');
      push('单件净含量', weight.single, '标题推算');
      push('总净含量', weight.total, '标题推算');
      push('包装数量', `${weight.packs}`, '标题推算');
    }

    // 3) 产地 / 省份 / 城市
    const origin = get('产地', '原料产地', '原产地');
    if (origin) {
      push('产地', origin, '参数');
      const province = get('省份') || (/(省|自治区|市)/.test(origin) ? origin : '');
      if (province) push('省份', province, '参数');
    }
    if (get('城市')) push('城市', get('城市'), '参数');

    // 4) 包装方式 / 是否进口
    const pack = get('包装方式', '包装') || (/(袋装|盒装|瓶装|罐装|散装|独立包装|礼盒)/.exec(name) || [])[1] || (isFood ? '袋装' : '');
    if (pack) push('包装方式', pack, get('包装方式') ? '参数' : (/(袋装|盒装|瓶装|罐装|散装|独立包装|礼盒)/.test(name) ? '标题推算' : '类目默认'));
    push('是否进口', get('是否进口', '国产/进口') || (isFood ? '国产' : ''), get('是否进口', '国产/进口') ? '参数' : '类目默认');

    // 5) 保质期（食品类目必填；参数没有时按类目默认 12 个月）
    const shelf = get('保质期', '保质期（天）', '保质天数');
    if (shelf) push('保质期', shelf, '参数');
    else if (isFood) push('保质期', '12个月', '类目默认');

    // 6) 食品安全常用项（参数里有就带上，没有交给用户）
    for (const key of ['生产许可证编号', '食品生产许可证编号', '产品标准号', '执行标准', '厂名', '厂址', '配料表', '储存方法', '食用方式', '品牌']) {
      const value = get(key);
      if (value) push(key, value, '参数');
    }

    // 7) 记忆：同款上次填对的值优先补空缺
    const key = keyOf(draft, detail);
    if (key) {
      const all = await memories();
      const memory = all[key];
      if (memory && typeof memory === 'object') {
        for (const [name2, value] of Object.entries(memory)) {
          if (!value) continue;
          if (seen.has(name2)) continue;
          push(name2, value, '记忆');
        }
      }
    }
    return out;
  }

  /** 记住这次上架用到的「非采集来源」值（下次同款直接复用）。 */
  async function remember(draft = {}, detail = {}, filled = []) {
    const key = keyOf(draft, detail);
    if (!key || !Array.isArray(filled) || !filled.length) return { ok: false };
    const all = await memories();
    const prev = (all[key] && typeof all[key] === 'object') ? all[key] : {};
    const next = { ...prev };
    for (const row of filled) {
      const name = C.str(row?.name).trim();
      const value = C.str(row?.value).trim();
      if (name && value) next[name] = value;
    }
    all[key] = Object.fromEntries(Object.entries(next).slice(0, 40));
    // 记忆表最多 500 个商品，超出丢最旧的（按插入顺序）
    const keys = Object.keys(all);
    if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete all[k];
    await writeJson(MEMORY_FILE, { version: 1, rows: all });
    return { ok: true, key, count: Object.keys(next).length };
  }

  return { hintsFor, remember, keyOf, parseWeight };
}

module.exports = { createSuggestionEngine, parseWeight, MEMORY_FILE };
