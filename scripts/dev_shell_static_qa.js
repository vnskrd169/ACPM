#!/usr/bin/env node
// ============================================================
//  ACPM Dev Shell — static QA gate
// ============================================================
//  Enforces that the local dev shell can NEVER be deployed to a
//  Firebase Hosting target (production or staging) and that the
//  bypass only activates on localhost with explicit opt-in.
//
//  Run:  node scripts/dev_shell_static_qa.js
//  Exit 0 = PASS, exit 1 = FAIL
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}`);
  }
}
function read(p) {
  return fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
}

console.log('=== ACPM Dev Shell static QA ===');

// 1. firebase.json must ignore dev artifacts
const firebaseJson = read('firebase.json');
const ignoreRaw = (firebaseJson.match(/"ignore"\s*:\s*\[([\s\S]*?)\]/) || [])[1] || '';
assert(/dev/.test(ignoreRaw) && /"dev\/\*\*"/.test(ignoreRaw), 'firebase.json hosting.ignore excludes dev/**');
assert(/"dev-shell\.html"/.test(ignoreRaw), 'firebase.json hosting.ignore excludes dev-shell.html');

// 2. The bypass file must exist and be fail-closed
assert(fs.existsSync(path.join(__dirname, '..', 'dev', 'dev-bypass.js')), 'dev/dev-bypass.js exists');
const bypass = read('dev/dev-bypass.js');
assert(/localhost/.test(bypass) && /127\.0\.0\.1/.test(bypass), 'dev-bypass.js checks local hostname');
assert(/acpm_dev_shell/.test(bypass), 'dev-bypass.js requires explicit opt-in flag');
assert(/isLocalHost\s*&&\s*optedIn/.test(bypass.replace(/\s+/g, ' ')) || /!isLocalHost\s*\|\|\s*!optedIn/.test(bypass.replace(/\s+/g, ' ')), 'dev-bypass.js fails closed when not local/opted-in');
assert(/useEmulator/.test(bypass), 'dev-bypass.js wires the local emulator');

// 3. The HTML hooks must be guarded (localhost + opt-in) and reference dev-bypass.js
for (const page of ['workspace.html', 'dashboard.html', 'login.html']) {
  const html = read(page);
  assert(/isLocal\s*&&\s*optIn/.test(html), `${page} dev hook guarded by localhost + opt-in`);
  assert(/dev\/dev-bypass\.js/.test(html), `${page} dev hook loads dev/dev-bypass.js`);
}

// 4. Dev rules file must exist (open, local-only)
assert(fs.existsSync(path.join(__dirname, '..', 'dev', 'dev-rules.json')), 'dev/dev-rules.json exists');

// 5. Seed script must exist and target the emulator, not real projects
assert(fs.existsSync(path.join(__dirname, '..', 'dev', 'seed-dev-data.js')), 'dev/seed-dev-data.js exists');
const seed = read('dev/seed-dev-data.js');
assert(/18300/.test(seed), 'seed targets emulator port 18300');
assert(/acpm-project-system-qa/.test(seed), 'seed uses a clearly separated dev namespace');

// 6. Production pages must never reference dev/ unconditionally
const indexHtml = read('index.html');
assert(!/dev\/dev-bypass\.js/.test(indexHtml), 'index.html does not reference the dev bypass');

console.log(`\nResult: ${failures === 0 ? 'PASS' : 'FAIL (' + failures + ' assertion(s))'}`);
process.exit(failures === 0 ? 0 : 1);
