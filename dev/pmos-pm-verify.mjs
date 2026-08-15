// ============================================================
//  PMOS PM-VISIBILITY VERIFY — dev shell, real app, real code
// ============================================================
//  Verifies the pmos.js fix: a PM (company-wide visibility,
//  no explicit assignments) must see ALL projects in the PMOS
//  mobile project selector, while an APM still sees only
//  assigned projects.
//
//  Run: node dev/pmos-pm-verify.mjs
// ============================================================

import { spawn } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const SERVER_PORT = 5556;
const DEV_DB_PORT = 18300;
const BASE = `http://localhost:${SERVER_PORT}`;
const EXPECTED_TOTAL = 10; // stress projects seeded
const APM_ASSIGNED = 2;    // apm1/apm2 assigned projects

let failures = 0;
let checks = 0;
function check(label, cond, extra = '') {
  checks++;
  if (cond) console.log(`  PASS  ${label}${extra ? '  (' + extra + ')' : ''}`);
  else { failures++; console.error(`  FAIL  ${label}${extra ? '  (' + extra + ')' : ''}`); }
}

function probe(url, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tryOnce = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(true); });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(tryOnce, 500);
      });
      req.setTimeout(3000, () => { req.destroy(); setTimeout(tryOnce, 500); });
    };
    tryOnce();
  });
}

async function waitFor(fn, timeoutMs = 30000, interval = 300) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise(r => setTimeout(r, interval));
  }
}

function startStaticServer() {
  return new Promise((resolve) => {
    const p = http.get(`${BASE}/index.html`, (res) => { res.resume(); resolve(null); });
    p.on('error', () => {
      const child = spawn('npx', ['serve', '-l', String(SERVER_PORT), '.'], {
        cwd: process.cwd(), stdio: 'ignore', detached: true, shell: process.platform === 'win32'
      });
      child.unref();
      let tries = 0;
      const wait = setInterval(() => {
        tries++;
        http.get(`${BASE}/index.html`, (res) => {
          res.resume(); clearInterval(wait); resolve(child);
        }).on('error', () => {
          if (tries > 80) { clearInterval(wait); resolve(child); }
        });
      }, 250);
    });
  });
}

async function seed() {
  console.log('[verify] seeding stress dataset (incl. role users)...');
  const out = execFileSync('node', ['dev/seed-stress-data.js'], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DEV_DB_PORT: String(DEV_DB_PORT) },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  return out;
}

async function sessionProjectCount(userKey) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));

  // Prime the dev-shell flags on the origin, then open PMOS
  // (dev bypass requires acpm_dev_shell=1; user via acpm_dev_user)
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((u) => {
    sessionStorage.setItem('acpm_dev_shell', '1');
    sessionStorage.setItem('acpm_dev_user', u);
  }, userKey);

  // Navigate to the PMOS entry (redirects /pmos.html -> /pmos/)
  await page.goto(`${BASE}/pmos.html`, { waitUntil: 'domcontentloaded' });
  // Give the redirect a moment to settle (pmos.html -> pmos/)
  await page.waitForTimeout(1500);

  // Wait for the project selector to be populated (resilient across redirect navigation)
  let count = -1;
  let sample = [];
  const populated = await waitFor(async () => {
    try {
      if (page.isClosed()) return false;
      const opts = await page.$$eval('#pmosProjectSelect option', els => els.map(e => e.value).filter(v => v));
      if (opts.length > 0) {
        count = opts.length;
        sample = await page.$$eval('#pmosProjectSelect option', els => els.map(e => e.textContent.trim()).filter(t => t).slice(0, 3));
        return true;
      }
      return false;
    } catch { return false; }
  }, 30000);
  if (!populated) {
    console.error(`[verify] ${userKey}: project select never populated (page closed: ${page.isClosed()})`);
    await browser.close();
    return { count: -1, errorCount: consoleErrors.length, errors: consoleErrors };
  }
  await browser.close();
  return { count, errorCount: consoleErrors.length, errors: consoleErrors, sample };
}

async function main() {
  console.log('[verify] booting static server on port', SERVER_PORT, '...');
  await startStaticServer();
  // Emulator: assume running from the stress suites; if not, boot it
  await probe(`http://127.0.0.1:${DEV_DB_PORT}/.json?ns=acpm-project-system-qa-default-rtdb`, 5000);
  await seed();

  console.log('\n=== PMOS mobile project visibility (dev shell, real app) ===\n');

  // PM — company-wide, no explicit assignments. Must see all 10.
  const pm = await sessionProjectCount('pm');
  check('PM sees all projects in PMOS selector', pm.count === EXPECTED_TOTAL,
    `count=${pm.count}, expected=${EXPECTED_TOTAL}`);
  check('PM session has zero console errors', pm.errorCount === 0,
    `errors=${pm.errorCount}${pm.errors.length ? ' -> ' + pm.errors.slice(0, 2).join(' | ') : ''}`);
  if (pm.sample && pm.sample.length) {
    check('PM selector shows real project names', /stress/i.test(pm.sample[0]),
      `sample="${pm.sample.join('", "')}"`);
  }

  console.log('');

  // APM — assigned only. Must see exactly 2.
  const apm = await sessionProjectCount('apm1');
  check('APM sees only assigned projects', apm.count === APM_ASSIGNED,
    `count=${apm.count}, expected=${APM_ASSIGNED}`);
  check('APM session has zero console errors', apm.errorCount === 0,
    `errors=${apm.errorCount}${apm.errors.length ? ' -> ' + apm.errors.slice(0, 2).join(' | ') : ''}`);

  console.log('\n=== RESULT:', failures === 0 ? `ALL ${checks}/${checks} PASS` : `${checks - failures}/${checks} PASS, ${failures} FAIL`, '===\n');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error('[verify] fatal:', err); process.exit(1); });
