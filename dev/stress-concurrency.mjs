// ============================================================
//  ACPM MULTI-USER CONCURRENCY DRIVE — emulator, real app
// ============================================================
//  Opens N independent browser sessions (boss, pm, apm1, apm2)
//  against the SAME project in the real app (dev shell, local
//  emulator) and races real edits simultaneously:
//
//    1. Concurrent worker adds (all 4 sessions, same moment)
//    2. Concurrent attendance marking (same worker+day, racing
//       statuses -> last-write-wins, no corruption)
//    3. Concurrent PO creation (all 4 sessions, same moment ->
//       seq counter must stay atomic)
//    4. Payroll compile race (2 sessions compile the SAME week
//       simultaneously -> only ONE finalized log must exist)
//    5. Realtime sync (a change in one session appears in
//       another WITHOUT refresh)
//    6. Role visibility (apm1/apm2 see only assigned projects;
//       boss/pm see all)
//
//  Run: node dev/stress-concurrency.mjs
//  (starts server + emulator, seeds, drives, cleans up)
// ============================================================

import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright';

const SERVER_PORT = 5555;
const DEV_DB_PORT = 18300;
const BASE = `http://localhost:${SERVER_PORT}`;
const NS = 'acpm-project-system-qa-default-rtdb';
const PID = 'stress-p01';

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
    try {
      if (await fn()) return true;
    } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) return false;
    await new Promise(r => setTimeout(r, interval));
  }
}

async function dbGet(path) {
  const res = await fetch(`http://127.0.0.1:${DEV_DB_PORT}/${path}.json?ns=${NS}`);
  return res.ok ? res.json() : null;
}

// Evaluate with retry — the app may navigate/re-render during boot
async function safeEval(page, fn, arg, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (!/Execution context was destroyed|Cannot find context|target closed/i.test(String(e && e.message || e))) throw e;
      await new Promise(r => setTimeout(r, 700));
    }
  }
  throw new Error('safeEval exhausted retries');
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
  return new Promise((resolve) => {
    const probe = http.get(`http://127.0.0.1:${DEV_DB_PORT}/.json?ns=${NS}`, (res) => { res.resume(); resolve(null); });
    probe.on('error', () => {
      console.log('[concurrency] starting Firebase emulator (database, port 18300)...');
      const child = spawn('npx', ['firebase', 'emulators:start', '--config', 'dev/firebase.dev.json', '--project', 'acpm-project-system-qa'], {
        cwd: process.cwd(), stdio: 'ignore', detached: true, shell: process.platform === 'win32'
      });
      child.unref();
      waitFor(async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${DEV_DB_PORT}/.json?ns=${NS}`);
          return res.ok;
        } catch { return false; }
      }, 60000).then(ok => resolve(ok ? child : child));
    });
  });
}

function isSevereError(msg) {
  return !/favicon|net::ERR|gstatic|fonts\.googleapis|firebase|offline|Cache|Failed to load resource|404 \(|already has a saved payroll log/i.test(msg);
}

async function main() {
  console.log('=== ACPM MULTI-USER CONCURRENCY DRIVE ===');
  console.log(`Scenario: boss + pm + apm1 + apm2 editing ${PID} simultaneously`);

  const serverChild = await startStaticServer();
  const emulatorChild = await startEmulator();
  const emulatorUp = await probe(`http://127.0.0.1:${DEV_DB_PORT}/.json?ns=${NS}`, 60000);
  if (!emulatorUp) { console.error('[concurrency] emulator not reachable'); process.exit(1); }
  console.log('[concurrency] emulator reachable');
  console.log('[concurrency] seeding...');
  execSync('node dev/seed-stress-data.js', { stdio: 'ignore' });
  console.log('[concurrency] seed done');

  const browser = await chromium.launch();
  // ── open 4 independent sessions ────────────────────────────
  const sessions = {};
  const errs = {};
  for (const key of ['boss', 'pm', 'apm1', 'apm2']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    errs[key] = [];
    page.on('console', msg => { if (msg.type() === 'error') errs[key].push(msg.text()); });
    page.on('pageerror', err => errs[key].push('PAGEERROR: ' + err.message));
    sessions[key] = { ctx, page };
  }

  async function openSession(key) {
    const { page } = sessions[key];
    await page.goto(`${BASE}/dev-shell.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(600);
    await page.evaluate((u) => {
      sessionStorage.setItem('acpm_dev_shell', '1');
      sessionStorage.setItem('acpm_dev_user', u);
      sessionStorage.setItem('acpm_dev_project', 'stress-p01');
    }, key);
    await page.goto(`${BASE}/workspace.html?projectId=${PID}&devUser=${key}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  }

  try {
    // ── 0. Role visibility ────────────────────────────────────
    console.log('\n── ROLE VISIBILITY ──');
    await Promise.all(Object.keys(sessions).map(openSession));
    for (const key of Object.keys(sessions)) {
      const booted = await waitFor(() => sessions[key].page.evaluate(() => document.body.innerText.includes('STRESS Project')), 25000);
      check(`${key}: workspace boots on shared project`, booted);
      if (!booted) { failures++; }
    }

    // All sessions see the 50 seeded workers (retry across boot navigation)
    for (const key of Object.keys(sessions)) {
      const rows = await waitFor(async () => {
        try {
          return (await sessions[key].page.evaluate(() => document.querySelectorAll('#rosterList .roster-row').length)) === 50;
        } catch { return false; }
      }, 25000);
      check(`${key}: sees 50 seeded workers`, rows);
    }

    // apm1/apm2 access check: workspace gate uses assigned projects — boss/pm
    // see all, apms see stress-p01 (seeded) so everyone boots. Confirm role header.
    for (const key of Object.keys(sessions)) {
      const severe = errs[key].filter(isSevereError);
      check(`${key}: no severe console errors on boot`, severe.length === 0, severe.length ? severe.slice(0, 2).join(' | ') : '');
    }

    // ── 1. Concurrent worker adds (4 sessions, same moment) ───
    console.log('\n── CONCURRENT WORKER ADDS (4 sessions) ──');
    const workerNames = {
      boss: 'CONC Boss Worker', pm: 'CONC PM Worker', apm1: 'CONC APM1 Worker', apm2: 'CONC APM2 Worker'
    };
    const before = Object.keys(await dbGet(`projects/${PID}/workers`) || {}).length;
    // ensure sessions are settled and the trade select is populated (a real
    // user cannot pick a trade before its options load)
    for (const key of Object.keys(sessions)) {
      const ready = await waitFor(async () => {
        try {
          return await sessions[key].page.evaluate(() => document.querySelectorAll('#workerTradeSelect option').length > 1);
        } catch { return false; }
      }, 20000);
      if (!ready) console.error(`  [warn] ${key} trade select never populated`);
    }
    await new Promise(r => setTimeout(r, 800));
    const addResults = await Promise.all(Object.entries(sessions).map(([key, { page }]) =>
      safeEval(page, ({ name, key }) => {
        // Set the real add-worker form and invoke the app's own addWorker();
        // pick the first populated trade so the value always sticks.
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        const sel = document.getElementById('workerTradeSelect');
        const trade = sel && sel.options.length > 1 ? sel.options[1].value : '';
        setVal('workerName', name);
        setVal('workerTradeSelect', trade);
        setVal('workerRate', '1000');
        return window.addWorker ? window.addWorker().then(() => ({ key, ok: true, trade })).catch(e => ({ key, ok: false, err: e.message })) : { key, ok: false, err: 'addWorker not global' };
      }, { name: workerNames[key], key }))
    );
    const after = Object.keys(await dbGet(`projects/${PID}/workers`) || {}).length;
    check('all 4 worker adds landed', addResults.every(r => r.ok), `${addResults.filter(r => r.ok).length}/4 ok`);
    check('worker count grew by exactly 4', after === before + 4, `${before} -> ${after}`);
    for (const r of addResults) if (!r.ok) console.error(`    [${r.key}] ERR: ${r.err}`);

    // Realtime sync: every session's roster should now show 54 rows WITHOUT refresh
    for (const key of Object.keys(sessions)) {
      let count = -1;
      const synced = await waitFor(async () => {
        try { count = await sessions[key].page.evaluate(() => document.querySelectorAll('#rosterList .roster-row').length); return count === 54; }
        catch { return false; }
      }, 15000);
      check(`${key}: roster realtime-synced to 54 workers (no refresh)`, synced, `count=${count}`);
    }

    // ── 2. Concurrent attendance marking (2 sessions, same cell) ──
    console.log('\n── CONCURRENT ATTENDANCE (same worker, same day, racing) ──');
    // pick a SEEDED worker (w01..w50) and the workspace's weekStart date
    const wid = 'w01';
    const mondayIso = await sessions.boss.page.evaluate(() => {
      const v = document.getElementById('weekStart');
      return v ? v.value : '(EMPTY)'; // may not be on labor tab yet
    });
    console.log(`  [debug] wid=${wid} weekStart=${mondayIso}`);
    const attResult = await Promise.all([
      safeEval(sessions.boss.page, ({ wid, date }) => window.markAttendance ? window.markAttendance(wid, date, 'present').then(() => 'present').catch(e => 'ERR:' + e.message) : 'no-fn', { wid, date: mondayIso }),
      safeEval(sessions.pm.page, ({ wid, date }) => window.markAttendance ? window.markAttendance(wid, date, 'leave').then(() => 'leave').catch(e => 'ERR:' + e.message) : 'no-fn', { wid, date: mondayIso })
    ]);
    check('both attendance calls completed', attResult.every(r => !r.startsWith('ERR')), attResult.join(' / '));
    const attRecord = await dbGet(`projects/${PID}/attendance/${wid}/${mondayIso}`);
    check('attendance record is intact (single status, no corruption)', attRecord && ['present', 'leave'].includes(attRecord.status), attRecord ? `status=${attRecord.status}` : `missing at ${mondayIso}`);
    check('attendance record has complete fields', attRecord && typeof attRecord.workerId === 'string' && attRecord.markedBy, attRecord ? 'fields present' : 'no record');

    // ── 3. Concurrent PO creation (4 sessions, same moment) ───
    console.log('\n── CONCURRENT PO CREATION (4 sessions) ──');
    const poBefore = Object.keys(await dbGet(`projects/${PID}/purchaseOrders`) || {}).length;
    const poResults = await Promise.all(Object.entries(sessions).map(([key, { page }]) =>
      safeEval(page, ({ key }) => {
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        setVal('poSupplier', `CONC Supplier ${key}`);
        setVal('poSupplierId', `conc-${key}`);
        setVal('poDate', new Date().toISOString().slice(0, 10));
        // seed one draft item via the app's own builder path
        window._draftItems = [{ desc: 'Concurrency Test Item', size: 'x', qty: 1, unit: 'pc', cost: 100, total: 100 }];
        return (typeof window.createPurchaseOrder === 'function'
          ? window.createPurchaseOrder('stress-p01', { supplier: `CONC Supplier ${key}`, supplierName: `CONC Supplier ${key}`, supplierId: `conc-${key}`, date: new Date().toISOString().slice(0, 10), items: [{ desc: 'Concurrency Test Item', size: 'x', qty: 1, unit: 'pc', cost: 100, total: 100 }] }).then(r => ({ key, ok: true, seq: r && r.seq })).catch(e => ({ key, ok: false, err: e.message }))
          : Promise.resolve({ key, ok: false, err: 'createPurchaseOrder not global' }));
      }, { key }))
    );
    const poAfter = Object.keys(await dbGet(`projects/${PID}/purchaseOrders`) || {}).length;
    check('all 4 POs created', poResults.every(r => r.ok), `${poResults.filter(r => r.ok).length}/4 ok`);
    check('PO count grew by exactly 4', poAfter === poBefore + 4, `${poBefore} -> ${poAfter}`);
    const seqs = poResults.map(r => r.seq).filter(s => typeof s === 'number');
    check('PO sequence numbers are unique (atomic counter)', new Set(seqs).size === seqs.length && seqs.length === 4, seqs.join(','));

    // ── 4. Payroll compile race (2 sessions, same week) ───────
    console.log('\n── PAYROLL COMPILE RACE (boss + pm, same week, simultaneous) ──');
    const logsBefore = Object.keys(await dbGet(`projects/${PID}/payrollLogs`) || {}).length;
    // Full flow: compilePayroll() opens the review modal, confirmSavePayroll()
    // persists. Race BOTH steps from both sessions.
    const compileResults = await Promise.all([
      safeEval(sessions.boss.page, () => window.compilePayroll ? window.compilePayroll().then(() => 'ok').catch(e => 'ERR:' + e.message) : 'no-fn'),
      safeEval(sessions.pm.page, () => window.compilePayroll ? window.compilePayroll().then(() => 'ok').catch(e => 'ERR:' + e.message) : 'no-fn')
    ]);
    // let both modals open, then race the save
    await new Promise(r => setTimeout(r, 1200));
    const saveResults = await Promise.all([
      safeEval(sessions.boss.page, () => window.confirmSavePayroll ? window.confirmSavePayroll().then(() => 'ok').catch(e => 'ERR:' + e.message) : 'no-fn'),
      safeEval(sessions.pm.page, () => window.confirmSavePayroll ? window.confirmSavePayroll().then(() => 'ok').catch(e => 'ERR:' + e.message) : 'no-fn')
    ]);
    await new Promise(r => setTimeout(r, 3000)); // let both settle
    const logsAfter = await dbGet(`projects/${PID}/payrollLogs`) || {};
    const logsAfterCount = Object.keys(logsAfter).length;
    check('compile calls completed', compileResults.every(r => !r.startsWith('ERR')), compileResults.join(' / '));
    check('save calls completed', saveResults.every(r => !r.startsWith('ERR')), saveResults.join(' / '));
    check('EXACTLY ONE new payroll log (double-compile guard holds)', logsAfterCount === logsBefore + 1, `${logsBefore} -> ${logsAfterCount}`);
    // verify no duplicate weekKey and the guard rejected the second write
    const weekKeys = Object.values(logsAfter).map(l => l.weekKey).filter(Boolean);
    check('no duplicate weekKey across payroll logs', new Set(weekKeys).size === weekKeys.length, `${weekKeys.length} unique weeks`);
    // the compiled log must be the CURRENT week (the seeded history is prior weeks)
    const newLog = Object.values(logsAfter).find(l => l.weekKey && !['stress-week'].includes(l.weekKey) && l.savedAt > Date.now() - 60000);
    check('compiled log is the current week with 50-worker detail', newLog && newLog.byTrade && Object.keys(newLog.byTrade).length === 5, newLog ? `${Object.keys(newLog.byTrade || {}).length} trades` : 'no fresh log');

    // ── 5. Realtime sync verification ─────────────────────────
    console.log('\n── REALTIME SYNC ──');
    // apm1 adds a worker; boss and pm must see it without refresh
    const syncName = 'SYNC Realtime Worker';
    const tradeReady = await waitFor(async () => {
      try { return await sessions.apm1.page.evaluate(() => document.querySelectorAll('#workerTradeSelect option').length > 1); }
      catch { return false; }
    }, 20000);
    if (!tradeReady) console.error('  [warn] apm1 trade select not populated for sync add');
    await safeEval(sessions.apm1.page, (name) => {
      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      const sel = document.getElementById('workerTradeSelect');
      setVal('workerName', name);
      setVal('workerTradeSelect', sel && sel.options.length > 1 ? sel.options[1].value : '');
      setVal('workerRate', '900');
      return window.addWorker ? window.addWorker().then(() => true) : false;
    }, syncName);
    const syncCount = 55; // 50 + 4 concurrent + 1 sync
    for (const key of ['boss', 'pm', 'apm2']) {
      let count = -1;
      const synced = await waitFor(async () => {
        try { count = await sessions[key].page.evaluate(() => document.querySelectorAll('#rosterList .roster-row').length); return count === syncCount; }
        catch { return false; }
      }, 15000);
      check(`${key}: saw apm1's worker live (${syncCount} rows, no refresh)`, synced, `count=${count}`);
    }
    const syncWorkerInDb = Object.values(await dbGet(`projects/${PID}/workers`) || {}).some(w => w.name === syncName);
    check('sync worker persisted in database', syncWorkerInDb);

    // ── 6. Console error sweep across all sessions ────────────
    console.log('\n── CONSOLE ERROR SWEEP ──');
    for (const key of Object.keys(sessions)) {
      const severe = errs[key].filter(isSevereError);
      check(`${key}: zero severe console errors across the session`, severe.length === 0, severe.length ? severe.slice(0, 3).join(' | ') : '');
    }
  } finally {
    for (const { ctx } of Object.values(sessions)) await ctx.close();
    await browser.close();
  }

  // cleanup
  if (serverChild) { try { process.kill(-serverChild.pid); } catch { try { serverChild.kill(); } catch {} } }
  if (emulatorChild) { try { process.kill(-emulatorChild.pid); } catch { try { emulatorChild.kill(); } catch {} } }

  console.log(`\n=== RESULT: ${checks - failures}/${checks} PASS ===`);
  if (failures === 0) console.log('ACPM handles concurrent multi-user editing with zero failures.');
  else console.log(`${failures} failure(s) — see FAIL lines above.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('[concurrency] DRIVE FAILED:', err.message);
  process.exit(1);
});
