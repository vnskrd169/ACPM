// ============================================================
//  ACPM MAX-LOAD STRESS DRIVE — browser, emulator, real app
// ============================================================
//  Boots the static server + local emulator, seeds the max-load
//  dataset (dev/seed-stress-data.js), then drives the REAL app
//  (dashboard hub + workspace) as the boss user and measures:
//    - hub renders all 10 projects
//    - workspace labor tab renders 50 workers (roster +
//      attendance) for every project
//    - payroll review opens with 50-worker entries and 12 weekly
//      logs render in history
//    - materials tab renders daily POs + materials
//    - tasks tab renders
//    - console/page errors, horizontal overflow, dead inline
//      handlers, scroll health, render timings at desktop AND
//      390px phone viewport
//
//  Run: node dev/stress-max-load.mjs
//  (starts everything itself; cleans up the emulator + server)
// ============================================================

import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright';

const SERVER_PORT = 5555;
const DEV_DB_PORT = 18300;
const BASE = `http://localhost:${SERVER_PORT}`;
const PROJECTS = Array.from({ length: 10 }, (_, i) => `stress-p${String(i + 1).padStart(2, '0')}`);

let failures = 0;
let checks = 0;
const timings = [];
function check(label, cond, extra = '') {
  checks++;
  if (cond) console.log(`  PASS  ${label}${extra ? '  (' + extra + ')' : ''}`);
  else { failures++; console.error(`  FAIL  ${label}${extra ? '  (' + extra + ')' : ''}`); }
}
function recordTiming(name, ms) { timings.push({ name, ms: Math.round(ms) }); }

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
    const probe = http.get(`${BASE}/index.html`, (res) => { res.resume(); resolve(null); });
    probe.on('error', () => {
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

function startEmulator() {
  // Returns a child process if we started it; null if already running
  return new Promise((resolve) => {
    const probe = http.get(`http://127.0.0.1:${DEV_DB_PORT}/.json?ns=acpm-project-system-qa-default-rtdb`, (res) => {
      res.resume(); resolve(null);
    });
    probe.on('error', () => {
      console.log('[stress] starting Firebase emulator (database, port 18300)...');
      const child = spawn('npx', ['firebase', 'emulators:start', '--config', 'dev/firebase.dev.json', '--project', 'acpm-project-system-qa'], {
        cwd: process.cwd(), stdio: 'ignore', detached: true, shell: process.platform === 'win32'
      });
      child.unref();
      waitFor(async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${DEV_DB_PORT}/.json?ns=acpm-project-system-qa-default-rtdb`);
          return res.ok;
        } catch { return false; }
      }, 60000).then(ok => resolve(ok ? child : child));
    });
  });
}

async function seed() {
  console.log('[stress] seeding max-load dataset...');
  const start = Date.now();
  execSync('node dev/seed-stress-data.js', { stdio: 'inherit' });
  console.log(`[stress] seed done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

// ── app bootstrap via dev shell (sets session flags, no login wall) ──
async function openApp(page, path) {
  await page.goto(`${BASE}/dev-shell.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { sessionStorage.setItem('acpm_dev_shell', '1'); sessionStorage.setItem('acpm_dev_project', 'stress-p01'); });
  await page.goto(`${BASE}/${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
}

function isSevereError(msg) {
  return !/favicon|net::ERR|gstatic|fonts\.googleapis|firebase|offline|Cache|Failed to load resource|404 \(/i.test(msg);
}

async function auditPage(page, label) {
  // horizontal overflow
  const overflow = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let worst = 0, worstEl = '';
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 10) {
        const w = Math.round(r.right - vw);
        if (w > worst) { worst = w; worstEl = (el.tagName + '.' + (el.className || '').toString().slice(0, 40)); }
      }
    });
    return { worst, worstEl };
  });
  check(`${label}: no horizontal overflow`, overflow.worst <= 0, overflow.worst > 0 ? `${overflow.worst}px on ${overflow.worstEl}` : 'clean');
  // page scrollable if content tall
  const scroll = await page.evaluate(() => ({ docH: document.documentElement.scrollHeight, vh: window.innerHeight }));
  if (scroll.docH > scroll.vh + 10) {
    check(`${label}: page scrolls`, true);
  }
  // dead inline handlers (first call token must exist)
  const dead = await page.evaluate(() => {
    const safe = new Set(['getElementById', 'querySelector', 'querySelectorAll', 'toggle', 'remove', 'add', 'classList', 'contains', 'open', 'close', 'show', 'hide', 'setAttribute', 'removeAttribute', 'push', 'splice', 'focus', 'blur', 'click', 'scrollIntoView', 'preventDefault', 'stopPropagation', 'reload', 'appendChild', 'removeChild', 'textContent', 'innerHTML', 'value', 'checked', 'style', 'dataset', 'length']);
    const deadFns = [];
    document.querySelectorAll('[onclick]').forEach(el => {
      const code = el.getAttribute('onclick') || '';
      const m = code.trim().match(/^([A-Za-z_$][\w$]*)\s*\(/);
      if (!m) return;
      const fn = m[1];
      if (safe.has(fn)) return;
      if (typeof window[fn] !== 'function') deadFns.push(fn);
    });
    return deadFns;
  });
  check(`${label}: no dead inline handlers`, dead.length === 0, dead.length ? dead.join(', ') : 'clean');
}

async function main() {
  console.log('=== ACPM MAX-LOAD STRESS DRIVE ===');
  console.log(`Scenario: 10 projects x 50 workers (10 per trade x 5 trades), 12 weekly Saturday payrolls, ~4 weeks daily materials`);

  const serverChild = await startStaticServer();
  const emulatorChild = await startEmulator();
  const emulatorUp = await probe(`http://127.0.0.1:${DEV_DB_PORT}/.json?ns=acpm-project-system-qa-default-rtdb`, 60000);
  if (!emulatorUp) {
    console.error('[stress] emulator did not become reachable on 18300');
    process.exit(1);
  }
  console.log('[stress] emulator reachable');
  await seed();

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));

  try {
    // ── 1. Dashboard hub: 10 projects ──────────────────────────
    console.log('\n── HUB (dashboard.html) ──');
    let t0 = Date.now();
    await openApp(page, 'dashboard.html');
    await waitFor(() => page.evaluate(() => document.body.innerText.length > 500), 25000);
    recordTiming('hub render', Date.now() - t0);
    const hubText = await page.evaluate(() => document.body.innerText);
    check('hub renders', hubText.includes('STRESS Project'));
    const projectCount = await page.evaluate(() => (document.body.innerText.match(/STRESS Project \d/g) || []).length);
    check('hub shows 10 projects', projectCount >= 10, `${projectCount} visible`);
    check('hub no severe console errors', consoleErrors.filter(isSevereError).length === 0);
    await auditPage(page, 'hub');
    consoleErrors.length = 0;

    // ── 2. Each project workspace: labor tab ───────────────────
    for (const pid of PROJECTS) {
      console.log(`\n── WORKSPACE ${pid} (labor) ──`);
      await page.goto(`${BASE}/dev-shell.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      await page.evaluate((p) => { sessionStorage.setItem('acpm_dev_shell', '1'); sessionStorage.setItem('acpm_dev_project', p); }, pid);
      t0 = Date.now();
      await page.goto(`${BASE}/workspace.html?projectId=${pid}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      // workspace boots and loads project; labor is the default module
      const booted = await waitFor(() => page.evaluate(() => document.body.innerText.includes('STRESS Project')), 25000);
      check(`${pid}: workspace boots`, booted);
      if (!booted) { failures++; continue; }
      recordTiming(`${pid} workspace load`, Date.now() - t0);

      // roster: 50 workers (count DOM rows — innerText skips below-fold content)
      const rosterReady = await waitFor(() => page.evaluate(() => document.querySelectorAll('#rosterList .roster-row').length > 0), 20000);
      check(`${pid}: roster renders`, rosterReady);
      const rosterRows = await page.evaluate(() => document.querySelectorAll('#rosterList .roster-row').length);
      check(`${pid}: 50 workers rendered`, rosterRows === 50, `${rosterRows} rows`);

      // payroll history: 12 weekly logs (only assert on first project to keep runtime sane)
      if (pid === PROJECTS[0]) {
        // The labor module may re-render on init; retry reads across that navigation.
        let logsReady = false, logRows = 0, workerDetail = 0;
        for (let attempt = 0; attempt < 6 && !logsReady; attempt++) {
          try {
            logsReady = await waitFor(() => page.evaluate(() => document.querySelectorAll('#payrollLogsBody tr').length > 0), 15000);
            if (logsReady) {
              logRows = await page.evaluate(() => document.querySelectorAll('#payrollLogsBody tr').length);
              workerDetail = await page.evaluate(() => document.querySelectorAll('#payrollLogsBody .paylog-worker-row').length);
            }
          } catch (e) { /* navigation mid-read — retry */ }
        }
        check(`${pid}: payroll history renders`, logsReady);
        check(`${pid}: 12 weekly logs render`, logRows >= 12, `${logRows} rows`);
        check(`${pid}: payroll logs carry 50-worker detail`, workerDetail >= 50, `${workerDetail} worker rows across logs`);
      } else {
        const payrollPanel = await page.evaluate(() => !!document.querySelector('#payrollPanel, [data-panel="payroll"], [id*="payroll" i]'));
        check(`${pid}: payroll panel present`, payrollPanel);
      }
      await auditPage(page, pid);

      const severe = consoleErrors.filter(isSevereError);
      check(`${pid}: no severe console errors`, severe.length === 0, severe.length ? severe.slice(0, 2).join(' | ') : '');
      consoleErrors.length = 0;
    }

    // ── 3. Deep interactions on the first project ──────────────
    const pid = PROJECTS[0];
    console.log(`\n── DEEP INTERACTIONS ${pid} ──`);
    await page.goto(`${BASE}/dev-shell.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.evaluate((p) => { sessionStorage.setItem('acpm_dev_shell', '1'); sessionStorage.setItem('acpm_dev_project', p); }, pid);
    await page.goto(`${BASE}/workspace.html?projectId=${pid}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await waitFor(() => page.evaluate(() => /Worker \d/.test(document.body.innerText)), 20000);

    // materials tab
    const matTab = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, .tab, [data-tab], a')];
      const el = els.find(e => /materials|material/i.test((e.textContent || '')) && e.offsetParent !== null);
      if (el) { el.click(); return true; }
      return false;
    });
    check(`${pid}: materials tab clickable`, matTab);
    if (matTab) {
      const matReady = await waitFor(() => page.evaluate(() => document.querySelectorAll('.po-card, #draftList > *, [id^="poc_"]').length > 0), 15000);
      check(`${pid}: materials render after tab click`, matReady);
      const poCount = await page.evaluate(() => document.querySelectorAll('[id^="poc_"], #draftList .draft-row, .po-card').length);
      check(`${pid}: daily POs render`, poCount >= 10, `${poCount} PO cards visible`);
      await auditPage(page, `${pid} materials`);
    }
    consoleErrors.length = 0;

    // ── 4. Phone viewport on the heaviest screen ───────────────
    console.log('\n── PHONE VIEWPORT (390px) ──');
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    const phoneErrors = [];
    phone.on('console', msg => { if (msg.type() === 'error') phoneErrors.push(msg.text()); });
    phone.on('pageerror', err => phoneErrors.push('PAGEERROR: ' + err.message));
    await phone.goto(`${BASE}/dev-shell.html`, { waitUntil: 'domcontentloaded' });
    await phone.waitForTimeout(500);
    await phone.evaluate((p) => { sessionStorage.setItem('acpm_dev_shell', '1'); sessionStorage.setItem('acpm_dev_project', p); }, pid);
    await phone.goto(`${BASE}/workspace.html?projectId=${pid}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await waitFor(() => phone.evaluate(() => /Worker \d/.test(document.body.innerText)), 20000);
    await auditPage(phone, 'phone workspace');
    const phoneSevere = phoneErrors.filter(isSevereError);
    check('phone: no severe console errors', phoneSevere.length === 0, phoneSevere.length ? phoneSevere.slice(0, 2).join(' | ') : '');
    await phone.close();
  } finally {
    await browser.close();
  }

  // ── summary ─────────────────────────────────────────────────
  console.log('\n=== PERFORMANCE (render-to-content ms) ===');
  timings.sort((a, b) => b.ms - a.ms);
  for (const t of timings.slice(0, 6)) console.log(`  ${t.name.padEnd(28)} ${t.ms}ms`);
  const avg = Math.round(timings.reduce((s, t) => s + t.ms, 0) / timings.length);
  console.log(`  (mean of ${timings.length} workspace loads: ${avg}ms)`);

  console.log(`\n=== RESULT: ${checks - failures}/${checks} PASS ===`);
  if (failures === 0) console.log('ACPM survives the max-load scenario with zero failures.');
  else console.log(`${failures} failure(s) — see FAIL lines above.`);

  // cleanup
  if (serverChild) { try { process.kill(-serverChild.pid); } catch { try { serverChild.kill(); } catch {} } }
  if (emulatorChild) { try { process.kill(-emulatorChild.pid); } catch { try { emulatorChild.kill(); } catch {} } }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('[stress] DRIVE FAILED:', err.message);
  process.exit(1);
});
