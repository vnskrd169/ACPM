#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['dashboard.html', 'workspace.html', 'login.html', 'pmos.html', 'pmos/index.html'];
const officeFiles = ['dashboard.html', 'workspace.html'];
const failures = [];
const checks = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function gate(condition, message) {
  if (!condition) failures.push(message);
  else checks.push(message);
}

function localAssets(html) {
  const matches = [];
  for (const pattern of [/<script\b[^>]*\bsrc="([^"]+)"/g, /<link\b[^>]*\bhref="([^"]+)"/g]) {
    let match;
    while ((match = pattern.exec(html))) {
      const ref = match[1];
      if (!/^(?:https?:|data:|#)/i.test(ref) && /\.(?:js|css)(?:\?|$)/i.test(ref)) matches.push(ref);
    }
  }
  return matches;
}

function assetPath(htmlFile, reference) {
  return path.resolve(root, path.dirname(htmlFile), reference.split('?')[0]);
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

const pages = Object.fromEntries(htmlFiles.map(file => [file, read(file)]));
const style = read('style.css');
const main = read('main.js');
const pmosOffice = read('pmos-office.js');
const sw = read('sw.js');
const rootJavaScript = fs.readdirSync(root)
  .filter(file => file.endsWith('.js'))
  .map(file => read(file))
  .join('\n');
const interactiveMarkupSources = [pages['dashboard.html'], pages['workspace.html'], pages['pmos/index.html'], rootJavaScript].join('\n');

for (const [file, html] of Object.entries(pages)) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  gate(duplicateIds.length === 0, `${file}: no duplicate ids`);

  const assets = localAssets(html);
  const duplicateAssets = [...new Set(assets.filter((asset, index) => assets.indexOf(asset) !== index))];
  gate(duplicateAssets.length === 0, `${file}: no duplicate local JS/CSS loading`);
  gate(assets.every(asset => fs.existsSync(assetPath(file, asset))), `${file}: every local JS/CSS reference exists`);
  gate(!/href\s*=\s*["']#["']/i.test(html), `${file}: no dead href="#" controls`);
}

for (const file of officeFiles) {
  const html = pages[file];
  gate(occurrences(html, 'pmos-subscription-manager.js?v=1') === 1, `${file}: PMOS subscription manager loads exactly once`);
  gate(occurrences(html, 'pmos-photo-lightbox.js?v=1') === 1, `${file}: PMOS lightbox loads exactly once`);
  gate(html.indexOf('pmos-subscription-manager.js?v=1') < html.indexOf('pmos-office.js?v=5'), `${file}: PMOS lifecycle dependency loads before Office`);
  gate(!/<(?:div|span|article)\b[^>]*\bonclick=/i.test(html), `${file}: visible inline click controls use semantic elements`);
}

const safeInlineCalls = new Set([
  'if', 'getElementById', 'querySelector', 'querySelectorAll', 'closest', 'preventDefault',
  'stopPropagation', 'stopImmediatePropagation', 'focus', 'click', 'reload', 'Date', 'String',
  'Number', 'parseFloat', 'parseInt', 'JSON', 'Object', 'Array', 'Math', 'encodeURIComponent',
  'decodeURIComponent', 'setTimeout', 'clearTimeout', 'alert', 'confirm',
]);
const handlerBodies = [];
for (const pattern of [
  /on(?:click|change|input|keydown|submit)\s*=\s*"([^"]*)"/g,
  /on(?:click|change|input|keydown|submit)\s*=\s*'([^']*)'/g,
]) {
  let match;
  while ((match = pattern.exec(interactiveMarkupSources))) handlerBodies.push(match[1]);
}
const missingHandlers = [];
for (const body of handlerBodies) {
  const firstCall = body.match(/([A-Za-z_$][\w$]*)\s*\(/);
  if (!firstCall || safeInlineCalls.has(firstCall[1])) continue;
  const name = firstCall[1];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declared = new RegExp(`function\\s+${escaped}\\s*\\(|(?:window\\.)?${escaped}\\s*=`).test(interactiveMarkupSources);
  if (!declared) missingHandlers.push(name);
}
gate(missingHandlers.length === 0, `inline handlers resolve to declared behavior${missingHandlers.length ? ` (missing: ${[...new Set(missingHandlers)].join(', ')})` : ''}`);

const nonSemanticClicks = [...interactiveMarkupSources.matchAll(/<(?:div|span|article)\b[^>]*\bonclick="[^"]*"[^>]*>/g)]
  .map(match => match[0])
  .filter(markup => !/(?:backdrop|lightbox-container)/.test(markup))
  .filter(markup => !/\brole="button"/.test(markup) || !/\btabindex="0"/.test(markup) || !/\bonkeydown=/.test(markup));
gate(nonSemanticClicks.length === 0, `card-style click controls include keyboard semantics${nonSemanticClicks.length ? ` (${nonSemanticClicks.length} incomplete)` : ''}`);
for (const file of officeFiles) {
  gate(occurrences(pages[file], 'function toggleTheme()') === 1, `${file}: theme initializer is declared once`);
}

gate(!/(?:html|body|\.main)\s*\{[^}]*overflow-y\s*:\s*hidden/si.test(style), 'critical page containers do not hide vertical overflow');
gate(/html\.overlay-scroll-locked,[\s\S]*body\.overlay-scroll-locked/.test(style), 'overlay scroll lock is explicit and narrowly scoped');
gate(/max-height:\s*90dvh;\s*overflow-y:\s*auto;/.test(style), 'Office modal content is viewport bounded and internally scrollable');
gate(/\.pmos-lightbox-container\s*\{[\s\S]*?max-height:[^}]*overflow-y:\s*auto;/s.test(style), 'PMOS lightbox is viewport bounded and internally scrollable');

const criticalSelectorLimits = {
  // Base, intentional theme polish, and bounded media variants are allowed.
  // These ceilings catch override accretion without flagging those layers.
  '.modal-overlay': 4,
  '.modal-box': 5,
  '.pmos-office-content': 2,
  '.pmos-lightbox-overlay': 2,
};
for (const [selector, limit] of Object.entries(criticalSelectorLimits)) {
  const count = (style.match(new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'g')) || []).length;
  gate(count <= limit, `${selector}: critical selector declarations stay within consolidation limit (${count}/${limit})`);
}

gate(/function deactivatePmosOffice\(/.test(pmosOffice) && /SUB\.unsubscribeGroup/.test(pmosOffice), 'PMOS view teardown owns listener cleanup');
gate(/previousGroup !== newGroup \|\| projectChanged/.test(pmosOffice), 'PMOS project and view switches share listener teardown');
gate(/function pmosSetFilter\(/.test(pmosOffice) && /state\.filters\[prefix\]/.test(pmosOffice), 'PMOS filters persist outside rerendered DOM');
gate(/function closeTopOverlayFromKeyboard\(/.test(main) && /OFFICE_MODAL_CLOSE_HANDLERS/.test(main), 'Escape delegates to modal owner close routines');
gate(/MutationObserver\(syncOverlayScrollLock\)/.test(main), 'dynamic overlays participate in scroll-lock restoration');

gate(/const CACHE_NAME = 'acpm-v151';/.test(sw), 'service worker cache version is current');
for (const asset of [
  './style.css?v=114',
  './main.js?v=112',
  './report.js?v=98',
  './pmos-subscription-manager.js?v=1',
  './pmos-photo-lightbox.js?v=1',
  './pmos-office.js?v=5',
  './ai-attention.js?v=2',
  './ai-command-center-v2.js?v=2',
  './ai-command-center.js?v=9',
]) {
  gate(occurrences(sw, asset) === 1, `service worker caches ${asset} exactly once`);
}

if (failures.length) {
  console.error('UI interaction static QA failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({ result: 'PASS', checks: checks.length, details: checks }, null, 2));
