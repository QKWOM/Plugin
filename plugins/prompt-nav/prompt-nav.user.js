// ==UserScript==
// @name         Claude Prompt Nav
// @namespace    https://github.com/qkwom/plugin
// @version      0.1.0
// @description  ChatGPT-style prompt rail for Claude: hover to preview, click to jump back to any earlier prompt.
// @match        https://claude.ai/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

// The same file is injected into Claude Desktop by bin/claude-nav.mjs and can be
// installed as a userscript for claude.ai in a browser. It must stay a single,
// dependency-free script that is safe to evaluate more than once.

(() => {
  'use strict';

  const VERSION = '0.1.0';
  const STORE_KEY = 'claudePromptNav:v1';
  const RAIL_WIDTH = 28;
  const JUMP_OFFSET = 20;

  // Tried in order until one matches; a selector picked with Ctrl+Alt+P wins over all of them.
  const BUILTIN_SELECTORS = [
    '[data-testid="user-message"]',
    '[data-testid="user-prompt"]',
    '[data-testid="human-message"]',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '[data-author="user"]',
  ];

  const existing = window.claudePromptNav;
  if (existing) {
    if (existing.version === VERSION) {
      existing.refresh();
      return;
    }
    try { existing.destroy(); } catch { /* an older copy that cannot clean up */ }
  }

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const KEYS = isMac ? '⌃⌥↑ / ⌃⌥↓' : 'Ctrl+Alt+↑ / ↓';
  const PICK_KEY = isMac ? '⌃⌥P' : 'Ctrl+Alt+P';

  const STYLES = `
:host { all: initial; }
:host {
  --fg: #1f1e1d; --muted: #8a8680; --bg: #ffffff;
  --tick: rgba(31, 30, 29, 0.25); --tick-hover: rgba(31, 30, 29, 0.65);
  --border: rgba(31, 30, 29, 0.12); --hover: rgba(31, 30, 29, 0.06);
  --shadow: 0 10px 30px rgba(0, 0, 0, 0.14);
  --accent: #d97757; --accent-soft: rgba(217, 119, 87, 0.1);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
:host([data-theme="dark"]) {
  --fg: #ece9e2; --muted: #9b978f; --bg: #2b2a27;
  --tick: rgba(236, 233, 226, 0.25); --tick-hover: rgba(236, 233, 226, 0.75);
  --border: rgba(236, 233, 226, 0.12); --hover: rgba(236, 233, 226, 0.08);
  --shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
* { box-sizing: border-box; }
.rail {
  position: fixed; z-index: 2147483000; width: ${RAIL_WIDTH}px; padding: 4px 0;
  display: none; flex-direction: column; overflow-y: auto; scrollbar-width: none;
}
.rail::-webkit-scrollbar { display: none; }
.rail.show { display: flex; }
.tick {
  flex: none; position: relative; width: 100%; height: var(--gap, 12px);
  margin: 0; padding: 0; border: 0; background: transparent; cursor: pointer; outline: none;
}
.tick::after {
  content: ""; position: absolute; top: 50%; right: 6px; width: 10px; height: 2px; margin-top: -1px;
  border-radius: 2px; background: var(--tick); transition: width 0.12s ease, background-color 0.12s ease;
}
.rail.left .tick::after { right: auto; left: 6px; }
.tick:hover::after, .tick.hl::after, .tick:focus-visible::after { width: 16px; background: var(--tick-hover); }
.tick.active::after { width: 16px; background: var(--accent); }
.panel {
  position: fixed; z-index: 2147483001; width: 300px; max-width: calc(100vw - 32px); max-height: min(62vh, 520px);
  display: none; flex-direction: column; overflow: hidden;
  background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--shadow); font: 13px/1.45 var(--font);
}
.panel.show { display: flex; }
.list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; }
.item {
  display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 6px 8px; margin: 0;
  border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.item:hover, .item.hl { background: var(--hover); }
.item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.num { flex: none; min-width: 1.8em; text-align: right; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item.active { background: var(--accent-soft); }
.item.active .num, .item.active .txt { color: var(--accent); }
.foot {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px;
}
.link {
  border: 0; background: none; padding: 0; margin: 0; color: var(--muted); font: inherit; cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px;
}
.link:hover { color: var(--fg); }
.banner, .toast {
  position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 2147483002;
  max-width: calc(100vw - 32px); padding: 8px 14px; border-radius: 10px;
  background: var(--bg); color: var(--fg); border: 1px solid var(--border); box-shadow: var(--shadow);
  font: 13px/1.45 var(--font);
}
.banner { display: none; align-items: center; gap: 14px; }
.banner.show { display: flex; }
.toast { pointer-events: none; opacity: 0; transition: opacity 0.2s ease; }
.toast.show { opacity: 1; }
.banner.show ~ .toast { top: 60px; }
.box {
  position: fixed; z-index: 2147483001; display: none; pointer-events: none;
  border: 2px solid var(--accent); border-radius: 6px; background: var(--accent-soft);
}
.box.chosen { border-style: dashed; }
`;

  // ---------------------------------------------------------------- state

  let config = loadConfig();
  let items = []; // [{ el, text }] in document order
  let ticks = [];
  let rows = [];
  let selectorInUse = null;
  let source = 'none';
  let scroller = null; // scrollable ancestor of the prompts; null means the document scrolls
  let activeIndex = -1;
  let pinnedIndex = -1; // set by a jump, cleared by the next manual scroll
  let picking = null;
  let refreshTimer = 0;
  let intervalTimer = 0;
  let rafId = 0;
  let showTimer = 0;
  let hideTimer = 0;
  let toastTimer = 0;
  const cleanups = [];

  // ---------------------------------------------------------------- DOM

  const host = document.createElement('claude-prompt-nav');
  const root = host.attachShadow({ mode: 'open' });
  adoptStyles(root, STYLES);

  const rail = h('nav', { class: 'rail', 'aria-label': 'Prompt navigation' });
  const list = h('div', { class: 'list' });
  const repick = h('button', { class: 'link', type: 'button' }, '识别不准？重新选择');
  const panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Prompts' },
    list,
    h('div', { class: 'foot' }, h('span', null, KEYS), repick));
  const cancelPick = h('button', { class: 'link', type: 'button' }, '取消 (Esc)');
  const bannerText = h('span');
  const banner = h('div', { class: 'banner', role: 'status' }, bannerText, cancelPick);
  const toastEl = h('div', { class: 'toast', role: 'status' });
  const hoverBox = h('div', { class: 'box' });
  const chosenBox = h('div', { class: 'box chosen' });
  root.append(rail, panel, hoverBox, chosenBox, banner, toastEl);

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    el.append(...children);
    return el;
  }

  function adoptStyles(shadow, css) {
    // Constructable stylesheets are not subject to the page's style-src CSP.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      shadow.append(h('style', null, css));
    }
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  // ---------------------------------------------------------------- config

  function loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveConfig() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(config));
    } catch { /* storage unavailable: keep the setting for this page only */ }
  }

  // ---------------------------------------------------------------- finding prompts

  function query(selector) {
    let found;
    try {
      found = document.querySelectorAll(selector);
    } catch {
      return null;
    }
    const out = [];
    let last = null;
    for (const el of found) {
      if (last && last.contains(el)) continue; // keep the outermost of nested matches
      if (el.getClientRects().length === 0) continue; // hidden
      out.push(el);
      last = el;
    }
    return out;
  }

  function findPrompts() {
    if (config.selector) {
      selectorInUse = config.selector;
      source = 'custom';
      return query(config.selector) || [];
    }
    for (const sel of BUILTIN_SELECTORS) {
      const els = query(sel);
      if (els && els.length) {
        selectorInUse = sel;
        source = 'auto';
        return els;
      }
    }
    selectorInUse = null;
    source = 'none';
    return [];
  }

  function textOf(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  function isScrollable(el) {
    const oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  }

  function scrollParentOf(el) {
    let fallback = null;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (!isScrollable(p)) continue;
      if (p.scrollHeight > p.clientHeight + 1) return p;
      fallback = fallback || p;
    }
    return fallback;
  }

  // ---------------------------------------------------------------- theme

  function isDark() {
    for (let el = scroller || document.body; el; el = el.parentElement) {
      const lum = luminance(getComputedStyle(el).backgroundColor);
      if (lum !== null) return lum < 0.5;
    }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Returns 0..1 for an opaque-enough computed color, or null if transparent / unparsable.
  function luminance(color) {
    const nums = (color.match(/-?[\d.]+%?/g) || []).map((n) => (n.endsWith('%') ? parseFloat(n) / 100 : parseFloat(n)));
    const alphaOk = (a) => a === undefined || a > 0.5;
    if (/^rgba?\(/.test(color)) {
      const [r, g, b, a] = nums;
      return alphaOk(a) ? (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 : null;
    }
    if (/^color\(srgb/.test(color)) {
      const [r, g, b, a] = nums;
      return alphaOk(a) ? 0.2126 * r + 0.7152 * g + 0.0722 * b : null;
    }
    const lightness = color.match(/^(ok)?l(?:ab|ch)\(\s*(-?[\d.]+)(%?)/);
    if (lightness) {
      const [, ok, value, pct] = lightness;
      // oklab/oklch lightness is 0..1 (or %); lab/lch lightness is 0..100 with or without %.
      const light = ok && !pct ? parseFloat(value) : parseFloat(value) / 100;
      return alphaOk(nums[3]) ? light : null;
    }
    return null;
  }

  // ---------------------------------------------------------------- render

  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = 0;
    if (!host.isConnected) document.documentElement.appendChild(host);
    const found = findPrompts();
    const changed = found.length !== items.length || found.some((el, i) => el !== items[i].el);
    if (changed) {
      items = found.map((el) => ({ el, text: textOf(el) }));
      pinnedIndex = -1;
      render();
    }
    scroller = items.length ? scrollParentOf(items[0].el) : null;
    host.setAttribute('data-theme', isDark() ? 'dark' : 'light');
    update();
  }

  function scheduleRefresh() {
    if (!refreshTimer) refreshTimer = setTimeout(refresh, 250);
  }

  function render() {
    ticks = items.map((it, i) => h('button', {
      class: 'tick', type: 'button', 'data-i': String(i), 'aria-label': `${i + 1}. ${it.text}`,
    }));
    rows = items.map((it, i) => h('button', { class: 'item', type: 'button', 'data-i': String(i), title: it.text },
      h('span', { class: 'num' }, String(i + 1)),
      h('span', { class: 'txt' }, it.text || '(无文字)')));
    rail.replaceChildren(...ticks);
    list.replaceChildren(...rows);
    activeIndex = -1;
    if (!items.length) hidePanel();
  }

  function viewRect() {
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = innerHeight;
    if (scroller && scroller.isConnected) {
      const r = scroller.getBoundingClientRect();
      const scrollbar = Math.max(0, scroller.offsetWidth - scroller.clientWidth);
      return {
        top: Math.max(0, r.top),
        bottom: Math.min(vh, r.bottom),
        left: Math.max(0, r.left),
        right: Math.min(vw, r.right - scrollbar),
      };
    }
    return { top: 0, bottom: vh, left: 0, right: vw };
  }

  function layout() {
    const r = viewRect();
    const height = r.bottom - r.top;
    if (!items.length || picking || height < 120 || r.right - r.left < 240) {
      rail.classList.remove('show');
      return;
    }
    const maxHeight = Math.max(60, height * 0.6);
    const gap = Math.max(4, Math.min(12, Math.floor(maxHeight / items.length)));
    const railHeight = Math.min(maxHeight, gap * items.length + 8);
    const left = config.side === 'left' ? r.left + 4 : r.right - RAIL_WIDTH - 4;
    rail.style.setProperty('--gap', `${gap}px`);
    rail.style.height = `${Math.round(railHeight)}px`;
    rail.style.top = `${Math.round(r.top + (height - railHeight) / 2)}px`;
    rail.style.left = `${Math.round(left)}px`;
    rail.classList.toggle('left', config.side === 'left');
    rail.classList.add('show');
  }

  function computeActive() {
    if (pinnedIndex >= 0 && pinnedIndex < items.length) return pinnedIndex;
    const r = viewRect();
    const line = r.top + Math.min(140, (r.bottom - r.top) * 0.3);
    let idx = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i].el.getBoundingClientRect().top <= line) idx = i;
      else break;
    }
    return idx;
  }

  function setActive(i) {
    if (i === activeIndex) return;
    ticks[activeIndex]?.classList.remove('active');
    rows[activeIndex]?.classList.remove('active');
    activeIndex = i;
    const tick = ticks[i];
    if (!tick) return;
    tick.classList.add('active');
    rows[i].classList.add('active');
    if (rail.scrollHeight > rail.clientHeight) {
      const top = tick.offsetTop;
      if (top < rail.scrollTop || top + tick.offsetHeight > rail.scrollTop + rail.clientHeight) {
        rail.scrollTop = top - rail.clientHeight / 2;
      }
    }
  }

  function update() {
    rafId = 0;
    layout();
    setActive(computeActive());
  }

  function scheduleUpdate() {
    if (!rafId) rafId = requestAnimationFrame(update);
  }

  // ---------------------------------------------------------------- panel

  function highlight(i, onOff) {
    ticks[i]?.classList.toggle('hl', onOff);
    const row = rows[i];
    if (!row) return;
    row.classList.toggle('hl', onOff);
    if (onOff && panel.classList.contains('show')) row.scrollIntoView({ block: 'nearest' });
  }

  function showPanel() {
    clearTimeout(hideTimer);
    if (!items.length || picking || panel.classList.contains('show')) return;
    host.setAttribute('data-theme', isDark() ? 'dark' : 'light');
    panel.classList.add('show');
    const rr = rail.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const left = config.side === 'left' ? rr.right + 6 : rr.left - pw - 6;
    const top = rr.top + rr.height / 2 - ph / 2;
    panel.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - pw - 8, left)))}px`;
    panel.style.top = `${Math.round(Math.max(8, Math.min(innerHeight - ph - 8, top)))}px`;
    const row = rows[activeIndex];
    if (row) list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
  }

  function hidePanel() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    panel.classList.remove('show');
  }

  function scheduleShow() {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(showPanel, 120);
  }

  function scheduleHide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePanel, 220);
  }

  function indexFromEvent(e) {
    const btn = e.target.closest && e.target.closest('[data-i]');
    return btn ? Number(btn.getAttribute('data-i')) : -1;
  }

  // ---------------------------------------------------------------- jumping

  function jumpTo(i) {
    const it = items[i];
    if (!it || !it.el.isConnected) return;
    pinnedIndex = i;
    setActive(i);
    const el = it.el;
    const sc = scroller && scroller.contains(el) ? scroller : scrollParentOf(el);
    if (sc) {
      const top = sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - JUMP_OFFSET;
      sc.scrollTo({ top, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - JUMP_OFFSET, behavior: 'smooth' });
    }
    flash(el);
  }

  function flash(el) {
    try {
      el.animate([
        { outline: '2px solid rgba(217, 119, 87, 0.9)', outlineOffset: '4px' },
        { outline: '2px solid rgba(217, 119, 87, 0)', outlineOffset: '4px' },
      ], { duration: 1600, delay: 200, easing: 'ease-out' });
    } catch { /* Web Animations unavailable */ }
  }

  function step(dir) {
    if (!items.length) return;
    const cur = pinnedIndex >= 0 ? pinnedIndex : computeActive();
    let target;
    if (dir > 0) {
      target = cur + 1;
    } else if (cur < 0) {
      target = 0;
    } else {
      // Reading the answer below the current prompt: go back to that prompt first.
      const above = pinnedIndex < 0 && items[cur].el.getBoundingClientRect().top < viewRect().top - 4;
      target = above ? cur : cur - 1;
    }
    jumpTo(Math.max(0, Math.min(items.length - 1, target)));
  }

  function unpin() {
    if (pinnedIndex < 0) return;
    pinnedIndex = -1;
    scheduleUpdate();
  }

  function onKeyDown(e) {
    if (picking) return;
    if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!items.length) return;
        e.preventDefault();
        e.stopPropagation();
        step(e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (e.code === 'KeyP') {
        e.preventDefault();
        e.stopPropagation();
        startPicker();
        return;
      }
    }
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) unpin();
  }

  // ---------------------------------------------------------------- picker
  //
  // When no built-in selector matches (the desktop UI can change at any time), the
  // user clicks one of their own prompts and then one of Claude's replies. The
  // outermost element around the prompt that has a selector matching it but
  // nothing inside the reply's branch becomes the saved selector.

  const PICK_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick'];

  function startPicker() {
    if (picking) return;
    hidePanel();
    picking = { prompt: null };
    host.setAttribute('data-theme', isDark() ? 'dark' : 'light');
    bannerText.textContent = '① 点击你自己发的任意一条提问';
    banner.classList.add('show');
    rail.classList.remove('show');
    for (const t of PICK_EVENTS) window.addEventListener(t, onPickEvent, true);
    window.addEventListener('mousemove', onPickMove, true);
    window.addEventListener('keydown', onPickKey, true);
  }

  function stopPicker() {
    if (!picking) return;
    picking = null;
    for (const t of PICK_EVENTS) window.removeEventListener(t, onPickEvent, true);
    window.removeEventListener('mousemove', onPickMove, true);
    window.removeEventListener('keydown', onPickKey, true);
    banner.classList.remove('show');
    hoverBox.style.display = 'none';
    chosenBox.style.display = 'none';
    scheduleUpdate();
  }

  function outline(box, el) {
    if (!el) {
      box.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block', left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px`,
    });
  }

  function pickTarget(e) {
    if (e.composedPath().includes(host)) return null;
    return e.target instanceof Element ? e.target : null;
  }

  function onPickMove(e) {
    outline(hoverBox, pickTarget(e));
  }

  function onPickKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    stopPicker();
    toast('已取消');
  }

  function onPickEvent(e) {
    const target = pickTarget(e);
    if (!target) return; // our own banner, e.g. the cancel button
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type !== 'click') return;
    if (!picking.prompt) {
      picking.prompt = target;
      outline(chosenBox, target);
      bannerText.textContent = '② 再点击 Claude 的任意一条回复';
      return;
    }
    const prompt = picking.prompt;
    if (prompt === target || prompt.contains(target) || target.contains(prompt)) {
      toast('请点击另一条消息：Claude 的回复');
      return;
    }
    const selector = deriveSelector(prompt, target);
    stopPicker();
    if (!selector) {
      toast(`没能识别出提问的结构，换一条提问再试试（${PICK_KEY}）`, 4000);
      return;
    }
    config.selector = selector;
    saveConfig();
    refresh();
    toast(`已识别 ${items.length} 条提问`);
  }

  function commonAncestor(a, b) {
    for (let p = a; p; p = p.parentElement) if (p.contains(b)) return p;
    return null;
  }

  function childTowards(ancestor, el) {
    let c = el;
    while (c && c.parentElement !== ancestor) c = c.parentElement;
    return c;
  }

  function deriveSelector(prompt, reply) {
    const lca = commonAncestor(prompt, reply);
    if (!lca) return null;
    const promptBranch = childTowards(lca, prompt);
    const replyBranch = childTowards(lca, reply);
    const path = [];
    for (let el = prompt; el && el !== lca; el = el.parentElement) path.unshift(el);

    const valid = (sel, el) => {
      let matches;
      try {
        matches = Array.from(document.querySelectorAll(sel));
      } catch {
        return null;
      }
      if (!matches.includes(el) || matches.length > 2000) return null;
      let inPromptBranch = 0;
      for (const m of matches) {
        if (replyBranch.contains(m) || m.contains(replyBranch)) return null;
        if (m !== el && m.contains(el)) return null;
        if (promptBranch.contains(m)) inPromptBranch++;
      }
      return inPromptBranch === 1 ? matches : null;
    };

    for (const el of path) {
      for (const sel of attributeSelectors(el)) {
        if (valid(sel, el)) return sel;
      }
      const classes = Array.from(el.classList).filter((c) => c.length <= 60);
      if (!classes.length) continue;
      const build = (cls) => el.localName + cls.map((c) => `.${CSS.escape(c)}`).join('');
      const full = valid(build(classes), el);
      if (!full) continue;
      // Drop classes that are not needed to tell prompts apart, so the selector survives cosmetic changes.
      let kept = classes;
      for (const c of classes) {
        const fewer = kept.filter((k) => k !== c);
        if (!fewer.length) continue;
        const m = valid(build(fewer), el);
        if (m && m.length === full.length) kept = fewer;
      }
      return build(kept);
    }
    return null;
  }

  function attributeSelectors(el) {
    const out = [];
    const testId = el.getAttribute('data-testid');
    if (testId) out.push(`[data-testid="${CSS.escape(testId)}"]`);
    for (const { name, value } of Array.from(el.attributes)) {
      if (!name.startsWith('data-') || name === 'data-testid') continue;
      if (value === '') out.push(`[${CSS.escape(name)}]`);
      else if (value.length <= 40 && !/\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}/i.test(value)) out.push(`[${CSS.escape(name)}="${CSS.escape(value)}"]`);
    }
    return out;
  }

  function toast(text, ms = 2600) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------------- wiring

  rail.addEventListener('click', (e) => {
    const i = indexFromEvent(e);
    if (i >= 0) jumpTo(i);
  });
  list.addEventListener('click', (e) => {
    const i = indexFromEvent(e);
    if (i < 0) return;
    hidePanel();
    jumpTo(i);
  });
  for (const el of [rail, list]) {
    el.addEventListener('mouseover', (e) => {
      const i = indexFromEvent(e);
      if (i >= 0) highlight(i, true);
    });
    el.addEventListener('mouseout', (e) => {
      const i = indexFromEvent(e);
      if (i >= 0) highlight(i, false);
    });
  }
  rail.addEventListener('mouseenter', scheduleShow);
  rail.addEventListener('mouseleave', scheduleHide);
  panel.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  panel.addEventListener('mouseleave', scheduleHide);
  repick.addEventListener('click', startPicker);
  cancelPick.addEventListener('click', () => stopPicker());

  const observer = new MutationObserver(scheduleRefresh);

  function boot() {
    document.documentElement.appendChild(host);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    on(document, 'scroll', scheduleUpdate, { capture: true, passive: true });
    on(window, 'resize', scheduleUpdate, { passive: true });
    on(window, 'wheel', unpin, { capture: true, passive: true });
    on(window, 'touchstart', unpin, { capture: true, passive: true });
    on(window, 'keydown', onKeyDown, true);
    intervalTimer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 2000);
    refresh();
  }

  function destroy() {
    stopPicker();
    observer.disconnect();
    clearInterval(intervalTimer);
    clearTimeout(refreshTimer);
    clearTimeout(toastTimer);
    cancelAnimationFrame(rafId);
    hidePanel();
    while (cleanups.length) cleanups.pop()();
    host.remove();
    if (window.claudePromptNav === api) delete window.claudePromptNav;
  }

  const api = {
    version: VERSION,
    refresh,
    pick: startPicker,
    next: () => step(1),
    prev: () => step(-1),
    setSelector(selector) {
      if (selector) config.selector = selector;
      else delete config.selector;
      saveConfig();
      refresh();
      return api.status();
    },
    resetSelector() {
      return api.setSelector(null);
    },
    setSide(side) {
      config.side = side === 'left' ? 'left' : 'right';
      saveConfig();
      hidePanel();
      scheduleUpdate();
    },
    status() {
      return { version: VERSION, source, selector: selectorInUse, count: items.length, url: location.href };
    },
    destroy,
  };
  window.claudePromptNav = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
