'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { createCategoryService, shopCategorySiteScript } = require('../src/selectionpool/category');
const { createSuggestionEngine } = require('../src/selectionpool/required-suggest');
const driverV2 = require('../src/selectionpool/driver-v2');

function makeMemCtx(overrides = {}) {
  const store = new Map();
  return {
    store,
    readJson: async (file, fallback) => (store.has(file) ? JSON.parse(JSON.stringify(store.get(file))) : fallback),
    writeJson: async (file, val) => { store.set(file, JSON.parse(JSON.stringify(val))); },
    ...overrides,
  };
}

/**
 * 极简 DOM 模拟器：支持 querySelector/All、children、closest、value、textContent、
 * innerText、style、getBoundingClientRect、事件派发（含 Input/PointerEvent/MouseEvent/KeyboardEvent）。
 * 专用于验证注入页面脚本的真实逻辑路径。
 */
function makeMiniDom({ href = 'https://siteadmin.tmall.com/category/index.htm?showLayout=false', root = null } = {}) {
  class MiniEl {
    constructor(tag, attrs = {}, children = [], text = '') {
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this.attrs = { ...attrs };
      this.id = attrs.id || '';
      this.className = attrs.class || '';
      this.type = attrs.type || '';
      this.name = attrs.name || '';
      this.value = attrs.value !== undefined ? attrs.value : '';
      this.style = { ...(attrs.styleObj || {}), setProperty(k, v) { this[k] = v; } };
      this.rect = attrs.rect || { left: 100, top: 10, width: 120, height: 28 };
      this.visible = attrs.visible !== false;
      this.disabled = Boolean(attrs.disabled);
      this.readOnly = Boolean(attrs.readOnly);
      this.children = [];
      this.childNodes = [];
      this.parentElement = null;
      this.listeners = new Map();
      if (attrs.style) {
        for (const part of String(attrs.style).split(';')) {
          const [k, v] = part.split(':').map(s => s && s.trim());
          if (!k || !v) continue;
          const camel = k.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
          this.style[camel] = v;
        }
      }
      if (text) {
        this.childNodes.push({ nodeType: 3, nodeValue: text });
      }
      for (const ch of children) this.appendChild(ch);
      if (this.tagName === 'SELECT') {
        this.options = this.children.filter(c => c.tagName === 'OPTION');
        this.selectedIndex = Math.max(0, this.options.findIndex(o => o.value === this.value));
      }
    }
    get offsetWidth() { return this.visible ? this.rect.width : 0; }
    get offsetHeight() { return this.visible ? this.rect.height : 0; }
    getClientRects() { return this.visible ? [this.rect] : []; }
    getBoundingClientRect() { return this.rect; }
    getAttribute(k) {
      if (k === 'style') return this.attrs.style || '';
      if (k === 'class') return this.className;
      if (k === 'type') return this.attrs.type;
      return this.attrs[k] ?? null;
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      this.childNodes.push(child);
      return child;
    }
    get textContent() {
      let s = '';
      for (const n of this.childNodes) {
        s += n.nodeType === 3 ? n.nodeValue : n.textContent;
      }
      return s;
    }
    set textContent(v) {
      this.children = [];
      this.childNodes = v ? [{ nodeType: 3, nodeValue: String(v) }] : [];
    }
    get innerText() { return this.textContent; }
    get nextElementSibling() {
      if (!this.parentElement) return null;
      const sibs = this.parentElement.children;
      const idx = sibs.indexOf(this);
      return idx >= 0 && idx + 1 < sibs.length ? sibs[idx + 1] : null;
    }
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentElement;
      }
      return false;
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatchEvent(ev) {
      const fns = this.listeners.get(ev?.type) || [];
      for (const fn of fns) fn.call(this, ev);
      if (ev?.bubbles && this.parentElement) this.parentElement.dispatchEvent(ev);
      return true;
    }
    click() {
      this.dispatchEvent({ type: 'click', bubbles: true });
    }
    matches(selectorList) {
      return String(selectorList).split(',').some(sel => matchSimpleSelector(this, sel.trim()));
    }
    closest(selectorList) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (cur.matches(selectorList)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelectorAll(selectorList) {
      const out = [];
      const walk = node => {
        for (const ch of node.children) {
          if (ch.matches(selectorList)) out.push(ch);
          walk(ch);
        }
      };
      walk(this);
      return out;
    }
    querySelector(selectorList) {
      return this.querySelectorAll(selectorList)[0] || null;
    }
  }

  function matchAtom(el, atom) {
    if (!atom || !el || el.nodeType !== 1) return false;
    let rest = atom;
    // tag
    const tagM = rest.match(/^[a-zA-Z0-9_-]+/);
    if (tagM) {
      if (el.tagName !== tagM[0].toUpperCase()) return false;
      rest = rest.slice(tagM[0].length);
    }
    while (rest) {
      if (rest.startsWith('#')) {
        const m = rest.match(/^#([^\s.[:]+)/);
        if (!m || el.id !== m[1]) return false;
        rest = rest.slice(m[0].length);
      } else if (rest.startsWith('.')) {
        const m = rest.match(/^\.([^\s.[:]+)/);
        if (!m) return false;
        const classes = String(el.className || '').split(/\s+/);
        if (!classes.includes(m[1])) return false;
        rest = rest.slice(m[0].length);
      } else if (rest.startsWith(':not(')) {
        const end = rest.indexOf(')');
        const inner = rest.slice(5, end);
        if (matchAtom(el, inner)) return false;
        rest = rest.slice(end + 1);
      } else if (rest.startsWith('[')) {
        const end = rest.indexOf(']');
        const expr = rest.slice(1, end).trim();
        rest = rest.slice(end + 1);
        const m = expr.match(/^([a-zA-Z0-9_-]+)(?:\s*([*^$]?=)\s*"([^"]*)"\s*(i)?)?$/);
        if (!m) {
          const valOnly = expr.match(/^([a-zA-Z0-9_-]+)=([^\s\]]+)$/);
          if (valOnly) {
            if (String(el.getAttribute(valOnly[1]) ?? '') !== valOnly[2]) return false;
            continue;
          }
          return false;
        }
        const [, attr, op, val, ci] = m;
        const rawAttr = attr === 'type' ? el.attrs.type : (attr === 'class' ? el.className : el.getAttribute(attr));
        if (!op) {
          if (rawAttr === undefined || rawAttr === null) return false;
        } else {
          const a = ci ? String(rawAttr || '').toLowerCase() : String(rawAttr || '');
          const b = ci ? String(val).toLowerCase() : String(val);
          if (op === '=' && a !== b) return false;
          if (op === '*=' && !a.includes(b)) return false;
          if (op === '^=' && !a.startsWith(b)) return false;
          if (op === '$=' && !a.endsWith(b)) return false;
        }
      } else {
        return false;
      }
    }
    return true;
  }

  function matchSimpleSelector(el, selector) {
    if (!selector) return false;
    if (selector.includes('>')) {
      const parts = selector.split('>').map(s => s.trim()).filter(Boolean);
      if (parts[0] === ':scope' && parts.length === 2) return matchAtom(el, parts[1]);
    }
    const chain = selector.match(/(?:\[[^\]]*\]|\([^)]*\)|[^\s])+/g) || [];
    if (!chain.length) return false;
    if (!matchAtom(el, chain[chain.length - 1])) return false;
    let cur = el.parentElement;
    for (let i = chain.length - 2; i >= 0; i--) {
      while (cur && !matchAtom(cur, chain[i])) cur = cur.parentElement;
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }

  const h = (tag, attrs, children, text) => new MiniEl(tag, attrs, children, text);
  const body = root || h('body');
  const doc = {
    documentElement: body,
    body,
    querySelectorAll: sel => body.querySelectorAll(sel),
    querySelector: sel => body.querySelector(sel),
    dispatchEvent: ev => body.dispatchEvent(ev),
    execCommand: () => false,
  };
  const win = {
    document: doc,
    location: { href },
    HTMLInputElement: { prototype: Object.getOwnPropertyDescriptor(MiniEl.prototype, 'value') ? MiniEl.prototype : { value: '' } },
    HTMLTextAreaElement: { prototype: {} },
    Event: class Event { constructor(type, opts = {}) { this.type = type; this.bubbles = Boolean(opts.bubbles); } },
    MouseEvent: class MouseEvent { constructor(type, opts = {}) { this.type = type; this.bubbles = Boolean(opts.bubbles); } },
    PointerEvent: class PointerEvent { constructor(type, opts = {}) { this.type = type; this.bubbles = Boolean(opts.bubbles); } },
    KeyboardEvent: class KeyboardEvent { constructor(type, opts = {}) { this.type = type; this.key = opts.key || ''; this.bubbles = Boolean(opts.bubbles); } },
    getComputedStyle: el => el.style || {},
    setTimeout,
    clearTimeout,
  };
  win.window = win;
  return { h, doc, win, MiniEl };
}

test('category.shopCategories avoids ReferenceError (C is not defined), invalidates v1 cache, and handles JSON login/challenge', async () => {
  const ctx = makeMemCtx();
  // Seed stale v1 cache containing bogus date values
  await ctx.writeJson('selectionpool/shop-categories.json', {
    version: 1,
    stores: {
      'store-1': { at: new Date().toISOString(), items: [{ name: '2026-06-02' }] },
    },
  });

  let probeCalls = 0;
  ctx.probePage = async ({ url }) => {
    probeCalls += 1;
    assert.match(url, /siteadmin\.tmall\.com\/category\/index\.htm/);
    return JSON.stringify({
      ok: true,
      items: [
        { name: '爆单品', group: '' },
        { name: '多金多金', group: '' },
        { name: '多金T', group: '多金多金' },
        { name: '多金Q', group: '多金多金' },
      ],
    });
  };

  const svc = createCategoryService({
    repo: { detail: async () => null },
    ctx,
  });

  // 1) cachedOnly must NOT return stale v1 cache and must NOT throw "C is not defined"
  const staleRes = await svc.shopCategories({ storeId: 'store-1', cachedOnly: true });
  assert.equal(staleRes.ok, false);
  assert.equal(staleRes.code, 'NO_CACHE');
  assert.deepEqual(staleRes.items, []);

  // 2) refresh fetches from siteadmin and persists v2 cache
  const freshRes = await svc.shopCategories({ storeId: 'store-1', refresh: true });
  assert.equal(freshRes.ok, true);
  assert.equal(freshRes.source, 'siteadmin');
  assert.equal(freshRes.items.length, 4);
  assert.equal(freshRes.items.find(x => x.name === '多金T').group, '多金多金');
  assert.equal(probeCalls, 1);

  // 3) subsequent cachedOnly reads from v2 cache cleanly
  const cachedRes = await svc.shopCategories({ storeId: 'store-1', cachedOnly: true });
  assert.equal(cachedRes.ok, true);
  assert.equal(cachedRes.source, 'cache');
  assert.equal(cachedRes.items.length, 4);

  // 4) rememberShopCategories works without throwing and merges groups
  const remRes = await svc.rememberShopCategories('store-1', [{ name: '多金T' }, { name: '新爆款' }]);
  assert.equal(remRes.ok, true);
  const afterMerge = await svc.shopCategories({ storeId: 'store-1', cachedOnly: true });
  assert.equal(afterMerge.items.find(x => x.name === '多金T').group, '多金多金');
  assert.ok(afterMerge.items.some(x => x.name === '新爆款'));

  // 5) JSON login response from siteadmin is recognized as LOGIN
  ctx.probePage = async () => JSON.stringify({ ok: false, reason: 'login', items: [] });
  const loginRes = await svc.shopCategories({ storeId: 'store-1', refresh: true });
  assert.equal(loginRes.ok, false);
  assert.equal(loginRes.code, 'LOGIN');
});

test('shopCategorySiteScript prioritizes 分类名称 column over dates/actions and extracts indented subcategories', async () => {
  const { h, win } = makeMiniDom();
  const makeRow = (date, nameText, { indentPx = 0, useInput = true, spanStatus = '自动分类' } = {}) =>
    h('tr', {}, [
      h('td', {}, [h('input', { type: 'checkbox' })]),
      h('td', {}, [], date),
      h('td', {}, [h('span', {}, [], spanStatus)]),
      h('td', { style: indentPx ? `padding-left: ${indentPx}px` : '' }, [
        useInput
          ? h('input', { type: 'text', value: nameText, rect: { left: 200 + indentPx, top: 20, width: 100, height: 24 } })
          : h('span', { rect: { left: 200 + indentPx, top: 20, width: 100, height: 24 } }, [], nameText),
      ]),
      h('td', {}, [h('a', {}, [], '添加子分类'), h('a', {}, [], '编辑'), h('a', {}, [], '删除')]),
    ]);

  win.document.body.appendChild(
    h('table', { id: 'J_CatTable' }, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', {}, [], '全选'),
          h('th', {}, [], '创建时间'),
          h('th', {}, [], '分类类型'),
          h('th', {}, [], '分类名称'),
          h('th', {}, [], '操作'),
        ]),
      ]),
      h('tbody', {}, [
        makeRow('2026-06-02', '爆单品', { useInput: false }),
        makeRow('2025-07-14', '多金多金', { useInput: true }),
        makeRow('2025-07-15', '多金T', { indentPx: 24, useInput: false }),
        makeRow('2025-07-16', '多金Q', { indentPx: 24, useInput: true }),
        makeRow('2025-08-01', '好运连连', { useInput: false }),
      ]),
    ]),
  );

  const raw = await vm.runInNewContext(shopCategorySiteScript(), win);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.ok, true);
  assert.deepEqual(
    parsed.items.map(x => ({ name: x.name, group: x.group })),
    [
      { name: '爆单品', group: '' },
      { name: '多金多金', group: '' },
      { name: '多金T', group: '多金多金' },
      { name: '多金Q', group: '多金多金' },
      { name: '好运连连', group: '' },
    ],
  );
  assert.equal(parsed.diag.a2, 5);
});

test('shopCategorySiteScript detects login redirect page', async () => {
  const { win } = makeMiniDom({ href: 'https://login.tmall.com/?redirectURL=https%3A%2F%2Fsiteadmin.tmall.com' });
  const raw = await vm.runInNewContext(shopCategorySiteScript(), win);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reason, 'login');
});

test('required-suggest extracts clean province from multi-part origin and skips 中国大陆', async () => {
  const eng = createSuggestionEngine();

  const hintsMainland = await eng.hintsFor({}, {
    attributes: [{ name: '产地', value: '中国大陆' }],
  });
  assert.equal(hintsMainland.find(h => h.name === '省份'), undefined);

  const hintsFujian = await eng.hintsFor({}, {
    attributes: [{ name: '产地', value: '中国大陆/福建省/泉州市' }],
  });
  assert.equal(hintsFujian.find(h => h.name === '省份')?.value, '福建省');
});

function makeProvinceSelectDom({ initialText = '请选择', options = ['其他', '北京', '重庆', '上海', '天津', '黑龙江省', '广东省', '福建省'], withSearch = true } = {}) {
  const dom = makeMiniDom({ href: 'https://sell.publish.tmall.com/tmall/publish.htm' });
  const { h, win } = dom;
  const valSpan = h('span', { class: 'next-select-value' }, [], initialText);
  const selectTrigger = h('span', { class: 'next-select-trigger' }, [
    h('span', { class: 'next-select-values' }, [valSpan]),
  ]);
  const selectRoot = h('div', { class: 'next-select' }, [selectTrigger]);
  const compWrap = h('div', { class: 'sell-component-info-wrapper-component-wrap' }, [selectRoot]);
  const row = h('div', { class: 'sell-component-info-wrapper-wrap' }, [
    h('div', { class: 'sell-component-info-wrapper-label-container' }, [
      h('label', { class: 'sell-component-info-wrapper-label' }, [], '* 省份'),
    ]),
    compWrap,
  ]);
  win.document.body.appendChild(row);

  let popup = null;
  const buildPopup = filter => {
    if (popup) {
      const idx = win.document.body.children.indexOf(popup);
      if (idx >= 0) win.document.body.children.splice(idx, 1);
    }
    const q = String(filter || '').trim();
    const listItems = options
      .filter(o => !q || o.includes(q))
      .map(optText => {
        const li = h('li', { class: 'next-menu-item', role: 'option' }, [], optText);
        li.addEventListener('click', () => {
          valSpan.textContent = optText;
          if (popup) popup.visible = false;
        });
        return li;
      });
    const searchInput = withSearch ? h('input', { type: 'text', value: q }) : null;
    if (searchInput) {
      searchInput.addEventListener('input', () => buildPopup(searchInput.value));
    }
    const ul = h('ul', { class: 'next-menu', role: 'listbox' }, [
      ...(searchInput ? [h('li', { class: 'search-box' }, [searchInput])] : []),
      ...listItems,
    ]);
    popup = h('div', { class: 'next-overlay-wrapper opened' }, [
      h('div', { class: 'next-overlay-inner' }, [ul]),
    ]);
    win.document.body.appendChild(popup);
  };

  selectTrigger.addEventListener('click', () => buildPopup(''));
  return { ...dom, valSpan };
}

test('buildEnsureProvinceScript selects "其他" when no province is available (产地=中国大陆)', async () => {
  const { win, valSpan } = makeProvinceSelectDom({ initialText: '请选择' });
  const script = driverV2.__scripts.buildEnsureProvinceScript([]);
  const res = JSON.parse(await vm.runInNewContext(script, win));
  assert.equal(res.ok, true);
  assert.equal(res.usedFallback, true);
  assert.equal(res.picked, '其他');
  assert.equal(valSpan.textContent, '其他');
});

test('buildEnsureProvinceScript falls back to "其他" when candidate province does not exist in dropdown', async () => {
  const { win, valSpan } = makeProvinceSelectDom({
    initialText: '请选择',
    options: ['其他', '北京', '上海', '广东省', '福建省'],
  });
  const script = driverV2.__scripts.buildEnsureProvinceScript(['香港特别行政区']);
  const res = JSON.parse(await vm.runInNewContext(script, win));
  assert.equal(res.ok, true);
  assert.equal(res.usedFallback, true);
  assert.equal(res.picked, '其他');
  assert.equal(valSpan.textContent, '其他');
});

test('buildEnsureProvinceScript selects matching province when present in dropdown', async () => {
  const { win, valSpan } = makeProvinceSelectDom({ initialText: '请选择' });
  const script = driverV2.__scripts.buildEnsureProvinceScript(['福建']);
  const res = JSON.parse(await vm.runInNewContext(script, win));
  assert.equal(res.ok, true);
  assert.equal(res.usedFallback, false);
  assert.equal(res.picked, '福建省');
  assert.equal(valSpan.textContent, '福建省');
});

test('buildEnsureProvinceScript preserves already-selected province and skips when field is absent', async () => {
  const alreadyDom = makeProvinceSelectDom({ initialText: '广东省' });
  const resAlready = JSON.parse(await vm.runInNewContext(driverV2.__scripts.buildEnsureProvinceScript([]), alreadyDom.win));
  assert.equal(resAlready.ok, true);
  assert.equal(resAlready.already, true);
  assert.equal(resAlready.picked, '广东省');

  const emptyDom = makeMiniDom({ href: 'https://sell.publish.tmall.com/tmall/publish.htm' });
  const resSkip = JSON.parse(await vm.runInNewContext(driverV2.__scripts.buildEnsureProvinceScript([]), emptyDom.win));
  assert.equal(resSkip.ok, true);
  assert.equal(resSkip.skipped, true);
  assert.equal(resSkip.reason, 'no-field');
});

test('shopCategorySiteScript Strategy B extracts nested ul/li tree when no table exists', async () => {
  const { h, win } = makeMiniDom();
  win.document.body.appendChild(
    h('div', { class: 'shop-cat-list' }, [
      h('ul', {}, [
        h('li', {}, [
          h('span', {}, [], '热销系列'),
          h('ul', {}, [
            h('li', {}, [h('a', {}, [], '海盐零食')]),
            h('li', {}, [h('a', {}, [], '坚果礼盒')]),
          ]),
        ]),
        h('li', {}, [h('a', {}, [], '新品上架')]),
      ]),
    ]),
  );
  const raw = await vm.runInNewContext(shopCategorySiteScript(), win);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.diag.b > 0);
  assert.deepEqual(
    parsed.items.map(x => ({ name: x.name, group: x.group })),
    [
      { name: '热销系列', group: '' },
      { name: '海盐零食', group: '热销系列' },
      { name: '坚果礼盒', group: '热销系列' },
      { name: '新品上架', group: '' },
    ],
  );
});

test('buildEnsureProvinceScript handles native <select> fallback to "其他" and matching', async () => {
  const dom1 = makeMiniDom({ href: 'https://sell.publish.tmall.com/tmall/publish.htm' });
  const sel1 = dom1.h('select', {}, [
    dom1.h('option', { value: '' }, [], '请选择'),
    dom1.h('option', { value: 'other' }, [], '其他'),
    dom1.h('option', { value: '350000' }, [], '福建省'),
  ]);
  dom1.win.document.body.appendChild(
    dom1.h('div', { class: 'sell-component-info-wrapper-wrap' }, [
      dom1.h('div', { class: 'sell-component-info-wrapper-label-container' }, [
        dom1.h('label', { class: 'sell-component-info-wrapper-label' }, [], '* 省份'),
      ]),
      dom1.h('div', { class: 'sell-component-info-wrapper-component-wrap' }, [sel1]),
    ]),
  );
  const resFallback = JSON.parse(await vm.runInNewContext(driverV2.__scripts.buildEnsureProvinceScript([]), dom1.win));
  assert.equal(resFallback.ok, true);
  assert.equal(resFallback.usedFallback, true);
  assert.equal(resFallback.picked, '其他');
  assert.equal(sel1.value, 'other');

  const dom2 = makeMiniDom({ href: 'https://sell.publish.tmall.com/tmall/publish.htm' });
  const sel2 = dom2.h('select', {}, [
    dom2.h('option', { value: '' }, [], '请选择'),
    dom2.h('option', { value: 'other' }, [], '其他'),
    dom2.h('option', { value: '350000' }, [], '福建省'),
  ]);
  dom2.win.document.body.appendChild(
    dom2.h('div', { class: 'sell-component-info-wrapper-wrap' }, [
      dom2.h('div', { class: 'sell-component-info-wrapper-label-container' }, [
        dom2.h('label', { class: 'sell-component-info-wrapper-label' }, [], '* 省份'),
      ]),
      dom2.h('div', { class: 'sell-component-info-wrapper-component-wrap' }, [sel2]),
    ]),
  );
  const resMatch = JSON.parse(await vm.runInNewContext(driverV2.__scripts.buildEnsureProvinceScript(['福建']), dom2.win));
  assert.equal(resMatch.ok, true);
  assert.equal(resMatch.usedFallback, false);
  assert.equal(resMatch.picked, '福建省');
  assert.equal(sel2.value, '350000');
});

test('readShopCategoryOptionsScript expands collapsed parent group and collects checkbox categories', async () => {
  const { h, win } = makeMiniDom({ href: 'https://sell.publish.tmall.com/tmall/publish.htm' });
  const trigger = h('div', { class: 'next-select' }, [h('span', { class: 'next-select-value' }, [], '选择分类')]);
  win.document.body.appendChild(
    h('div', { class: 'sell-component-info-wrapper-wrap' }, [
      h('label', {}, [], '店铺中分类'),
      trigger,
    ]),
  );
  let expanded = false;
  let popup = null;
  const renderPopup = () => {
    if (popup) {
      const idx = win.document.body.children.indexOf(popup);
      if (idx >= 0) win.document.body.children.splice(idx, 1);
    }
    const groupHdr = h('li', { class: 'next-menu-item' }, [], '多金多金');
    groupHdr.addEventListener('click', () => {
      expanded = true;
      renderPopup();
    });
    const list = [
      h('li', { class: 'next-menu-item' }, [h('input', { type: 'checkbox' }), h('span', {}, [], '爆单品')]),
      groupHdr,
      ...(expanded
        ? [
          h('li', { class: 'next-menu-item' }, [h('input', { type: 'checkbox' }), h('span', {}, [], '多金T')]),
          h('li', { class: 'next-menu-item' }, [h('input', { type: 'checkbox' }), h('span', {}, [], '多金Q')]),
        ]
        : []),
    ];
    popup = h('div', { class: 'next-overlay-wrapper opened' }, [h('ul', { class: 'next-menu' }, list)]);
    win.document.body.appendChild(popup);
  };
  trigger.addEventListener('click', renderPopup);

  const res = JSON.parse(await vm.runInNewContext(driverV2.readShopCategoryOptionsScript(), win));
  assert.equal(res.ok, true);
  assert.deepEqual(
    res.items.map(x => ({ name: x.name, group: x.group })),
    [
      { name: '爆单品', group: '' },
      { name: '多金T', group: '多金多金' },
      { name: '多金Q', group: '多金多金' },
    ],
  );
});

test('shopCategorySiteScript clicks expand-all and extracts nested sub-table subcategories under parent group', async () => {
  const { h, win } = makeMiniDom();
  let expandedAll = false;
  const tbody = h('tbody', {});
  const renderRows = () => {
    tbody.children = [];
    tbody.childNodes = [];
    tbody.appendChild(
      h('tr', { class: 'next-table-row' }, [
        h('td', {}, [], '多金多金'),
        h('td', {}, [], '2026-06-01'),
      ]),
    );
    if (expandedAll) {
      tbody.appendChild(
        h('tr', { class: 'next-table-expanded-row' }, [
          h('td', { colspan: '2' }, [
            h('table', {}, [
              h('tbody', {}, [
                h('tr', {}, [h('td', {}, [], '热销款A'), h('td', {}, [], '2026-06-02')]),
                h('tr', {}, [h('td', {}, [], '热销款B'), h('td', {}, [], '2026-06-03')]),
              ]),
            ]),
          ]),
        ]),
      );
    }
  };
  renderRows();
  const expandBtn = h('button', {}, [], '全部展开');
  expandBtn.addEventListener('click', () => {
    expandedAll = true;
    renderRows();
  });
  win.document.body.appendChild(expandBtn);
  win.document.body.appendChild(
    h('table', { id: 'J_CatTable' }, [
      h('thead', {}, [h('tr', {}, [h('th', {}, [], '分类名称'), h('th', {}, [], '创建时间')])]),
      tbody,
    ]),
  );

  const parsed = JSON.parse(await vm.runInNewContext(shopCategorySiteScript(), win));
  assert.equal(parsed.ok, true);
  assert.deepEqual(
    parsed.items.map(x => ({ name: x.name, group: x.group })),
    [
      { name: '多金多金', group: '' },
      { name: '热销款A', group: '多金多金' },
      { name: '热销款B', group: '多金多金' },
    ],
  );
});

test('pickShopCategoryScript expands parent node without prefix match and readShopCategoryOptionsScript keeps checkboxed parent nodes', async () => {
  const { h, win } = makeMiniDom({ href: 'https://sell.publish.tmall.com/tmall/publish.htm' });
  const trigger = h('div', { class: 'next-select' }, [h('span', { class: 'next-select-value' }, [], '选择分类')]);
  win.document.body.appendChild(
    h('div', { class: 'sell-component-info-wrapper-wrap' }, [
      h('label', {}, [], '店铺中分类'),
      trigger,
    ]),
  );
  let subVisible = false;
  const switcher = h('span', { class: 'next-tree-node-switcher', 'aria-expanded': 'false' }, []);
  const parentBox = h('input', { type: 'checkbox' });
  const childBox = h('input', { type: 'checkbox' });
  const childNode = h('li', { class: 'next-tree-node', 'aria-level': '2', visible: false }, [
    childBox,
    h('span', { class: 'next-tree-node-label' }, [], '热销款'),
  ]);
  switcher.addEventListener('click', () => {
    subVisible = true;
    switcher.setAttribute('aria-expanded', 'true');
    childNode.visible = true;
  });
  const treePopup = h('div', { class: 'next-overlay-wrapper opened' }, [
    h('ul', { class: 'next-tree' }, [
      h('li', { class: 'next-tree-node', 'aria-level': '1' }, [
        switcher,
        parentBox,
        h('span', { class: 'next-tree-node-label' }, [], '多金多金'),
        h('ul', { class: 'next-tree-child-tree' }, [childNode]),
      ]),
    ]),
  ]);
  win.document.body.appendChild(treePopup);

  // readShopCategoryOptionsScript should preserve parent '多金多金' AND expand + record child '热销款' under '多金多金'
  const readRes = JSON.parse(await vm.runInNewContext(driverV2.readShopCategoryOptionsScript(), win));
  assert.equal(readRes.ok, true);
  assert.equal(subVisible, true);
  assert.deepEqual(
    readRes.items.map(x => ({ name: x.name, group: x.group })),
    [
      { name: '多金多金', group: '' },
      { name: '热销款', group: '多金多金' },
    ],
  );

  // Reset collapse state and verify pickShopCategoryScript expands switcher to reveal non-prefixed child '热销款'
  subVisible = false;
  childNode.visible = false;
  switcher.setAttribute('aria-expanded', 'false');
  switcher.attrs['data-xx-cat-expanded'] = '';

  const pickPass1 = JSON.parse(await vm.runInNewContext(driverV2.__scripts.pickShopCategoryScript(['热销款']), win));
  assert.equal(pickPass1.ok, false);
  assert.ok(pickPass1.expanded >= 1);
  assert.equal(subVisible, true);

  const pickPass2 = JSON.parse(await vm.runInNewContext(driverV2.__scripts.pickShopCategoryScript(['热销款']), win));
  assert.equal(pickPass2.ok, true);
  assert.deepEqual(pickPass2.picked, ['热销款']);
});

test('buildEnsureProvinceScript leaves overlay open with optionPoint and searchPoint when readback remains placeholder', async () => {
  const { h, win } = makeMiniDom({ href: 'https://sell.publish.tmall.com/tmall/publish.htm' });
  const valSpan = h('span', { class: 'next-select-value' }, [], '请选择');
  const trigger = h('span', { class: 'next-select-trigger' }, [
    h('span', { class: 'next-select-values' }, [valSpan]),
  ]);
  win.document.body.appendChild(
    h('div', { class: 'sell-component-info-wrapper-wrap' }, [
      h('div', { class: 'sell-component-info-wrapper-label-container' }, [
        h('label', { class: 'sell-component-info-wrapper-label' }, [], '* 省份'),
      ]),
      h('div', { class: 'sell-component-info-wrapper-component-wrap' }, [
        h('div', { class: 'next-select' }, [trigger]),
      ]),
    ]),
  );

  const searchInput = h('input', { type: 'text', value: '', rect: { left: 220, top: 80, width: 140, height: 26 } });
  const otherLi = h('li', { class: 'next-menu-item', role: 'option', rect: { left: 220, top: 120, width: 140, height: 28 } }, [], '其他');
  // Intentionally do NOT update valSpan on synthetic DOM click to simulate React/Fusion ignoring synthetic click
  const popup = h('div', { class: 'next-overlay-wrapper opened' }, [
    h('div', { class: 'next-overlay-inner' }, [
      h('ul', { class: 'next-menu', role: 'listbox' }, [
        h('li', { class: 'search-box' }, [searchInput]),
        otherLi,
      ]),
    ]),
  ]);
  win.document.body.appendChild(popup);

  const res = JSON.parse(await vm.runInNewContext(driverV2.__scripts.buildEnsureProvinceScript([]), win));
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'readback-empty');
  assert.equal(res.picked, '');
  assert.equal(res.target, '其他');
  assert.equal(res.usedFallback, true);
  assert.equal(popup.visible, true);
  assert.deepEqual(res.optionPoint, { x: 290, y: 134 });
  assert.deepEqual(res.searchPoint, { x: 290, y: 93 });
});


