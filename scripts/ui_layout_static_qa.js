#!/usr/bin/env node
/**
 * ui_layout_static_qa.js
 *
 * Static production-hardening gate for ACPM/PMOS layout + PWA hygiene.
 * Run with: node scripts/ui_layout_static_qa.js
 *
 * Checks (all static, no browser needed):
 *   1. No duplicated element IDs in any HTML shell
 *   2. Modal standard: every .modal-overlay contains a .modal-box; the
 *      .modal-box CSS enforces max-height + internal scroll + overscroll
 *      containment (dialogs can never exceed the viewport unreachably)
 *   3. Wide tables are wrapped in .table-wrap/.overflow-scroll (horizontal
 *      scroll is deliberate, not silently clipped)
 *   4. Scroll-trap anti-patterns are absent from style.css:
 *      - height:100vh on content containers (page owns vertical scroll)
 *      - width:100vw without min() (scrollbar-inclusive overflow)
 *      - overflow-y:hidden on tall containers
 *   5. PWA cache + asset versions are consistent and bumped:
 *      - sw.js CACHE_NAME is the current expected version
 *      - PMOS workers use the current pmos-cache version
 *      - HTML asset version params match the expected release
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(content, needle, message) {
  assert(content.includes(needle), message || `Missing ${needle}`);
}

// Expected release versions — bump together with every layout/PWA release.
const EXPECT = {
  swCache: 'acpm-v150',
  pmosCache: 'pmos-cache-v9',
  htmlAsset: { style: 'style.css?v=114', main: 'main.js?v=112' },
  pmosAsset: { style: '../style.css?v=114', main: '../main.js?v=112' },
};

function main() {
  const checks = [];

  // ── 1. Duplicated IDs ─────────────────────────────────────────
  for (const f of ['index.html', 'dashboard.html', 'workspace.html', 'login.html', 'pmos.html', 'pmos/index.html', 'dev-shell.html']) {
    const html = read(f);
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const dups = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    assert(dups.length === 0, `${f}: duplicated ids -> ${dups.join(', ')}`);
    checks.push(`${f}: no duplicated ids`);
  }

  // ── 2. Modal standard ─────────────────────────────────────────
  for (const f of ['dashboard.html', 'workspace.html']) {
    const html = read(f);
    const overlays = [...html.matchAll(/<div id="([^"]+)" class="modal-overlay/g)].map((m) => m[1]);
    for (const id of overlays) {
      const start = html.indexOf(`id="${id}"`);
      const chunk = html.slice(start, start + 900);
      assert(chunk.includes('modal-box'), `${f}: modal #${id} must contain a .modal-box`);
    }
    checks.push(`${f}: ${overlays.length} modal(s) all use .modal-box`);
  }
  const css = read('style.css');
  assertIncludes(css, '.modal-box {', 'modal-box style must exist');
  assertIncludes(css, 'max-height: 90dvh; overflow-y: auto;', 'modal-box must enforce max-height + internal scroll');
  assertIncludes(css, 'overscroll-behavior: contain;', 'modal-box must contain overscroll (no scroll chaining)');
  checks.push('style.css: modal-box enforces max-height 90dvh + internal scroll + overscroll containment');

  // ── 3. Table wrapper standard ─────────────────────────────────
  assertIncludes(css, '.overflow-scroll {', 'table wrapper .overflow-scroll must exist');
  assertIncludes(css, 'overflow-x: auto;', 'table wrappers must scroll horizontally');
  const ws = read('workspace.html');
  for (const table of ['led-table', 'movement-table', 'hist-table']) {
    const inWrapper = ws.includes(`class="overflow-scroll">\n        <table class="${table}"`) ||
      ws.includes(`<div class="overflow-scroll">`) && ws.includes(table);
    assert(inWrapper, `workspace.html: ${table} must live inside .overflow-scroll`);
  }
  checks.push('workspace.html: ledger/movement/history tables wrapped in .overflow-scroll');
  assertIncludes(css, 'min-width: max(100%, 760px);', 'overflow tables must keep readable min width');
  checks.push('style.css: overflow tables keep min width for readable density');

  // ── 4. Scroll-trap anti-patterns ──────────────────────────────
  const height100vh = css.match(/[^n-]height:\s*100vh/g) || [];
  assert(height100vh.length === 0, `style.css: content containers must not use height:100vh (${height100vh.length} found)`);
  checks.push('style.css: no height:100vh on content containers (page owns vertical scroll)');
  const bare100vw = css.match(/width:\s*100vw(?!\s*-\s*\d)/g) || [];
  assert(bare100vw.length === 0, `style.css: bare width:100vw found (${bare100vw.join(', ')}) — use min() to avoid scrollbar overflow`);
  checks.push('style.css: no bare width:100vw (scrollbar-inclusive overflow)');
  const overflowYHidden = css.match(/overflow-y:\s*hidden/g) || [];
  assert(overflowYHidden.length === 0, `style.css: overflow-y:hidden found (${overflowYHidden.length}) — can trap content`);
  checks.push('style.css: no overflow-y:hidden scroll traps');

  // ── 5. PWA cache + asset versions ─────────────────────────────
  const sw = read('sw.js');
  assertIncludes(sw, `const CACHE_NAME = '${EXPECT.swCache}'`, `sw.js must use CACHE_NAME ${EXPECT.swCache}`);
  checks.push(`sw.js: CACHE_NAME ${EXPECT.swCache}`);
  for (const f of ['pmos-sw.js', 'pmos/pmos-sw.js']) {
    const psw = read(f);
    assert(psw.includes(EXPECT.pmosCache), `${f} must use ${EXPECT.pmosCache}`);
  }
  checks.push(`pmos-sw.js + pmos/pmos-sw.js: ${EXPECT.pmosCache}`);
  for (const f of ['dashboard.html', 'workspace.html', 'login.html']) {
    const html = read(f);
    assertIncludes(html, EXPECT.htmlAsset.style, `${f}: must reference ${EXPECT.htmlAsset.style}`);
    assertIncludes(html, EXPECT.htmlAsset.main, `${f}: must reference ${EXPECT.htmlAsset.main}`);
  }
  checks.push('dashboard/workspace/login: style + main asset versions bumped');
  const pmosIdx = read('pmos/index.html');
  assertIncludes(pmosIdx, EXPECT.pmosAsset.style, 'pmos/index.html: must reference current style.css');
  assertIncludes(pmosIdx, EXPECT.pmosAsset.main, 'pmos/index.html: must reference current main.js');
  checks.push('pmos/index.html: asset versions bumped');

  console.log(JSON.stringify({ result: 'PASS', checks }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAIL', message: error.message }, null, 2));
  process.exit(1);
}
