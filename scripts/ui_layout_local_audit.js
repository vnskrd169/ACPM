#!/usr/bin/env node
/**
 * ui_layout_local_audit.js
 *
 * Reusable local layout audit — NO Firebase credentials required.
 *
 * Boots a static server, seeds a stress dataset through a mocked Firebase
 * (same technique as tests/e2e/helpers.ts), and probes ACPM + PMOS at the
 * full viewport matrix for the bug classes seen in production hardening:
 *
 *   - page scroll traps / missing scroll path
 *   - horizontal overflow (offenders listed, scroll wrappers tolerated)
 *   - unreachable primary actions
 *   - modal viewport fit + reachable footer actions
 *   - duplicated DOM ids
 *   - runtime console errors / pageerrors
 *   - tab switching on workspace panels
 *   - PMOS field shell on phones
 *
 * Usage:
 *   node scripts/ui_layout_local_audit.js
 *
 * Exit code 0 = all checks pass, 1 = at least one failure.
 */

const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const PROJECT = 'test-project-1';

const VIEWPORTS = [
  { name: 'desktop-1920',  width: 1920, height: 1080 },
  { name: 'desktop-1440',  width: 1440, height: 900 },
  { name: 'laptop-1366',   width: 1366, height: 768 },
  { name: 'laptop-1280',   width: 1280, height: 720 },
  { name: 'tablet-1024',   width: 1024, height: 768 },
  { name: 'tablet-768',    width: 768,  height: 1024 },
  { name: 'mobile-390',    width: 390,  height: 844 },
  { name: 'mobile-375',    width: 375,  height: 667 },
];

const results = [];
let failures = 0;

function record(viewport, check, ok, detail = '') {
  results.push({ viewport, check, ok, detail: String(detail).slice(0, 220) });
  if (!ok) failures++;
}

/* ── static server ─────────────────────────────────────────────── */
function startServer() {
  return new Promise((resolve) => {
    const probe = http.get(`http://localhost:${PORT}/index.html`, (res) => {
      res.resume();
      resolve(null); // already running
    });
    probe.on('error', () => {
      const child = spawn('npx', ['serve', '-l', String(PORT), '.'], {
        cwd: process.cwd(),
        stdio: 'ignore',
        detached: true,
        shell: process.platform === 'win32',
      });
      child.unref();
      let tries = 0;
      const wait = setInterval(() => {
        tries++;
        http.get(`http://localhost:${PORT}/index.html`, (res) => {
          res.resume();
          clearInterval(wait);
          resolve(child);
        }).on('error', () => {
          if (tries > 60) { clearInterval(wait); resolve(child); }
        });
      }, 250);
    });
  });
}

/* ── stress dataset + mocked Firebase init script ──────────────── */
function buildInitScript() {
  return `
    window._currentUser = {
      uid: 'test-boss-uid', name: 'Test Boss', email: 'boss@test.com',
      role: 'boss', projects: {}, bossOf: { '${PROJECT}': true }
    };
    // main.js overwrites _currentUser with an anonymous placeholder before
    // auth resolves — capture the real user eagerly so the mock auth layer
    // never serves the placeholder.
    const __authUser = Object.assign({}, window._currentUser, {
      email: 'boss@test.com',
      getIdToken: function () { return Promise.resolve('mock-token'); },
      updateProfile: function () { return Promise.resolve(); },
      delete: function () { return Promise.resolve(); }
    });
    window._currentPid = '${PROJECT}';
    window.__ACPM_DISABLE_SW_FOR_E2E__ = true;
  try {

    /* ---------- stress dataset ---------- */
    const iso = d => d.toISOString().slice(0, 10);
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const week = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      week.push(iso(d));
    }

    const trades = {};
    ['Carpentry', 'Masonry', 'Electrical', 'Plumbing', 'Steel Works', 'Painting'].forEach((t, i) => {
      trades['t' + i] = {
        name: t, foremanName: 'Foreman ' + t, paymentMethod: 'Bank',
        notes: '', createdAt: 1780000000000
      };
    });

    const longNames = [
      'MARIANITO SANTOS DELA CRUZ', 'EMMANUEL JOSEPH Q. VILLANUEVA JR.',
      'RODRIGO F. MACAPAGAL-BERNARDEZ', 'CONSTANTINO M. AGUINALDO IV',
      'FELICIANO RODRIGUEZ DE LOS SANTOS', 'ALBERTO SANTIAGO MERCEDES-ORTEGA'
    ];
    const workers = {};
    const workerIds = [];
    const statuses = ['present', 'half', 'present', 'holiday', 'present', 'absent', 'present'];
    for (let i = 0; i < 30; i++) {
      const wid = 'w' + i;
      workerIds.push(wid);
      const trade = Object.keys(trades)[i % 6];
      workers[wid] = {
        name: (i < 6 ? longNames[i] : 'Worker ' + (i + 1) + ' ' + longNames[i % 6].split(' ')[1]),
        trade: trades[trade].name, dailyRate: 450 + (i % 7) * 85,
        active: true, status: 'active', addedAt: 1780000000000
      };
    }
    // 2 inactive workers with history preserved
    workers['wIn1'] = { name: 'Inactive Mateo P. Santos', trade: 'Carpentry', dailyRate: 500, active: false, status: 'inactive', inactiveReason: 'End of contract', inactiveAt: 1780000000000 };
    workers['wIn2'] = { name: 'Retired Renato G. Bautista', trade: 'Masonry', dailyRate: 520, active: false, status: 'inactive', inactiveReason: 'Retired', inactiveAt: 1780000000000 };

    const attendance = {};
    workerIds.forEach(wid => {
      attendance[wid] = {};
      week.forEach((d, di) => {
        const st = statuses[di % statuses.length];
        attendance[wid][d] = {
          workerId: wid, date: d, status: st, weekKey: week[0] + '_' + week[6],
          regularHours: st === 'half' ? 4 : 8, overtimeHours: (di % 3 === 0 && st === 'present') ? 2 : 0,
          nightDiffHours: 0, paidHours: 8, multiplier: 1, markedAt: 1780000000000
        };
      });
    });

    const advances = {};
    workerIds.slice(0, 12).forEach((wid, i) => {
      advances[wid] = {};
      advances[wid]['adv' + i] = {
        date: week[0], amount: 1000 + i * 500, notes: 'Stress advance ' + i,
        status: i % 3 === 0 ? 'released' : (i % 3 === 1 ? 'pending_approval' : 'approved'),
        workerName: workers[wid].name, trade: workers[wid].trade,
        weekKey: week[0] + '_' + week[6], requestedBy: 'Test Boss',
        deducted: i % 3 === 0, deductedAmount: i % 3 === 0 ? 1000 + i * 500 : 0,
        addedAt: 1780000000000 + i
      };
    });

    const suppliers = {};
    ['Mega Hardware Depot', 'RS Construction Supply', 'Homefix Trading', 'PhilCement Distributors', 'Acme Steel Center', 'Luzon Lumber Corp.'].forEach((s, i) => {
      suppliers['sup' + i] = {
        name: s, contact: '0917 000 ' + (1000 + i), specialty: 'Hardware',
        bankName: 'BPI', accountNumber: '1234-5678-90' + i, accountName: s, addedAt: 1780000000000
      };
    });

    const poItems = [
      { desc: 'Deformed Bars 16mm', size: '16mm', qty: 100, unit: 'pcs', cost: 285, total: 28500 },
      { desc: 'Portland Cement Type 1', size: '40kg', qty: 200, unit: 'bags', cost: 250, total: 50000 },
      { desc: 'G.I. Wire #16', size: '16', qty: 50, unit: 'kg', cost: 95, total: 4750 },
      { desc: 'Plywood Marine 3/4"', size: '4x8', qty: 40, unit: 'pcs', cost: 1350, total: 54000 },
      { desc: 'PVC Pipe 4"', size: '4"', qty: 60, unit: 'len', cost: 780, total: 46800 },
      { desc: 'Coco Lumber 2x3', size: '2x3x10', qty: 300, unit: 'bdft', cost: 42, total: 12600 }
    ];

    const purchaseOrders = {};
    for (let i = 0; i < 6; i++) {
      const poId = 'po' + i;
      const items = poItems.slice(0, 3 + (i % 4)).map((it, j) => ({ ...it, line: j + 1 }));
      const statusesPO = ['approved', 'ordered', 'partially_delivered', 'fully_delivered', 'received', 'approved'];
      const received = i === 2 ? 60 : (i >= 3 ? 100 : 0);
      purchaseOrders[poId] = {
        poNo: 'PO-00' + (i + 1), date: week[0], supplierId: 'sup' + (i % 6),
        supplier: suppliers['sup' + (i % 6)].name,
        items, status: statusesPO[i], urgency: i === 5 ? 'critical' : 'normal',
        total: items.reduce((s, it) => s + it.total, 0),
        paid: i % 2 === 0, createdAt: 1780000000000 + i,
        deliveries: (i === 2 || i === 3) ? [{
          date: week[2], drNo: 'DR-' + (i + 1), receiver: 'Test APM', status: 'received',
          items: items.map(it => ({ ...it, receivedQty: i === 2 ? Math.round(it.qty * 0.6) : it.qty }))
        }] : []
      };
    }

    const materials = [];
    for (let i = 0; i < 25; i++) {
      const it = poItems[i % poItems.length];
      materials.push({
        id: 'm' + i, date: week[i % 7], supplier: suppliers['sup' + (i % 6)].name,
        item: it.desc, size: it.size, qty: it.qty, unit: it.unit,
        unitCost: it.cost, total: it.total, status: i % 4 === 0 ? 'delivered' : 'ordered',
        deliveredQty: i % 4 === 0 ? it.qty : Math.round(it.qty * 0.6), poNo: 'PO-00' + ((i % 6) + 1),
        addedAt: 1780000000000 + i
      });
    }

    const tasks = {};
    for (let i = 0; i < 20; i++) {
      tasks['task' + i] = {
        title: 'Stress task number ' + (i + 1) + ' - formwork layout verification for structural integrity review',
        description: 'Long description that should wrap nicely and never clip on any viewport. '.repeat(3),
        status: i % 5 === 0 ? 'completed' : (i % 5 === 1 ? 'in_progress' : 'pending'),
        priority: ['low', 'normal', 'high', 'critical'][i % 4],
        assignee: 'Worker ' + (i + 1), dueDate: week[0], createdAt: 1780000000000 + i,
        progress: i % 5 === 0 ? 100 : (i % 5 === 1 ? 40 : 0)
      };
    }

    const billings = {};
    for (let i = 0; i < 4; i++) {
      billings['bill' + i] = {
        billingNo: 'BILL-00' + (i + 1), type: i === 0 ? 'downpayment' : 'progress',
        desc: 'Stress billing tranche ' + (i + 1), date: week[0], amount: 250000 + i * 150000,
        receivable: 250000 + i * 150000, retention: 25000, deduction: 0,
        status: i < 2 ? 'approved' : 'pending', createdAt: 1780000000000 + i
      };
    }
    const collections = {};
    for (let i = 0; i < 3; i++) {
      collections['col' + i] = {
        date: week[1 + i], desc: 'Payment received tranche ' + (i + 1), billingId: 'bill' + i,
        amount: 200000 + i * 50000, unapplied: 0, retentionReleased: 0, reference: 'REF-' + i,
        addedAt: 1780000000000 + i
      };
    }

    const siteLogs = {};
    for (let i = 0; i < 8; i++) {
      siteLogs['log' + i] = {
        date: week[i % 7], notes: 'Daily progress notes '.repeat(8),
        work: 'Formworks + rebar installing', manpower: '12 workers',
        equipment: 'Mixer, Vibrator', visitors: 'Owner walkthrough',
        issues: 'Pending rebar splice inspection', delays: 'None',
        safety: 'All clear', weather: 'Sunny 32C', addedAt: 1780000000000 + i
      };
    }

    const changeOrders = {};
    for (let i = 0; i < 4; i++) {
      changeOrders['co' + i] = {
        desc: 'Change order for additional scope ' + (i + 1), reqBy: 'Client',
        date: week[0], laborImpact: 15000 + i * 5000, materialsImpact: 8000 + i * 2000,
        status: ['pending', 'approved', 'rejected', 'approved'][i], createdAt: 1780000000000 + i
      };
    }

    const payrollLogs = {};
    for (let i = 0; i < 3; i++) {
      const entries = workerIds.slice(0, 15).map(wid => ({
        workerId: wid, workerName: workers[wid].name, trade: workers[wid].trade,
        dailyRate: workers[wid].dailyRate, status: 'present', date: week[0],
        gross: workers[wid].dailyRate * 5, cashAdvanceDeduction: 0, net: workers[wid].dailyRate * 5
      }));
      payrollLogs['pl' + i] = {
        weekKey: week[0] + '_' + week[6], start: week[0], end: week[6],
        compiledAt: 1780000000000 + i, compiledBy: 'Test Boss',
        gross: entries.reduce((s, e) => s + e.gross, 0),
        cashAdvanceDeduction: 0, govDeduction: 0, net: entries.reduce((s, e) => s + e.gross, 0),
        entries, tradeTotals: { Carpentry: 10000, Masonry: 12000 }, status: 'released'
      };
    }

    const activity = [];
    for (let i = 0; i < 15; i++) {
      activity.push({ type: 'task.update', message: 'Stress activity event ' + (i + 1), createdAt: 1780000000000 + i, by: 'Test APM' });
    }

    const notificationEvents = [];
    for (let i = 0; i < 10; i++) {
      notificationEvents.push({ module: 'labor', type: 'payroll.compiled', status: 'pending', consumed: false, createdAt: 1780000000000 + i, createdBy: 'test-boss-uid' });
    }

    const projects = {};
    for (let i = 0; i < 20; i++) {
      const pid = 'proj' + i;
      projects[pid] = {
        name: (i === 0 ? 'Angeles Residence Extension and Renovation Project' : 'Stress Project Site Number ' + (i + 1) + ' Phase ' + (i % 3 + 1)),
        status: i < 15 ? 'active' : 'completed', laborBudget: 500000 + i * 100000,
        materialBudget: 800000 + i * 200000, laborSpent: 200000 + i * 30000,
        materialSpent: 300000 + i * 50000, progress: 10 + i * 4,
        createdAt: 1780000000000 + i, assignedTo: { 'test-boss-uid': true }
      };
    }
    projects['${PROJECT}'] = {
      name: 'Stress Test Main Project', status: 'active',
      laborBudget: 2000000, materialBudget: 3500000,
      laborSpent: 400000, materialSpent: 900000,
      laborSpentCommitted: 50000, materialSpentCommitted: 150000,
      progress: 34, createdAt: 1780000000000,
      settings: { leader: 'Engr. Test Boss', payMethod: 'Bank' },
      payrollConfig: { type: 'weekly', startDay: 1, overtimeThreshold: 8, nightDiffRate: 1.1, govDeductionsEnabled: false },
      assignment: { apm: 'test-field-user-uid', pm: 'test-boss-uid' },
      members: { 'test-boss-uid': { name: 'Test Boss', role: 'boss' }, 'test-field-user-uid': { name: 'Test APM', role: 'apm' } }
    };

    /* ---------- mocked firebase ---------- */
    const MOCK_DATA = {
      users: {
        'test-boss-uid': {
          uid: 'test-boss-uid', name: 'Test Boss', displayName: 'Test Boss', email: 'boss@test.com',
          role: 'boss', status: 'active', assignedProjects: {}, bossOf: { '${PROJECT}': true },
          profileComplete: true
        },
        'test-field-user-uid': {
          uid: 'test-field-user-uid', name: 'Test APM', displayName: 'Test APM', email: 'apm@test.com',
          role: 'apm', status: 'active', assignedProjects: { '${PROJECT}': true }, profileComplete: true
        }
      },
      accessRequests: null,
      projects
    };
    MOCK_DATA.projects['${PROJECT}'] = Object.assign({}, MOCK_DATA.projects['${PROJECT}'], {
      trades, workers, attendance, advances, suppliers, purchaseOrders,
      materials, materialMovement: Array.from({ length: 12 }, (_, i) => ({
        date: week[0], time: '08:30', action: i % 2 ? 'received' : 'issued',
        item: poItems[i % 6].desc, qty: 10 + i, cost: poItems[i % 6].total,
        source: 'PO-00' + ((i % 6) + 1), user: 'Test APM'
      })),
      inventory: poItems.slice(0, 8).map((it, i) => ({ ...it, onHand: 100 - i * 10 })),
      materialIssuances: Array.from({ length: 5 }, (_, i) => ({ date: week[0], item: poItems[i].desc, qty: 5 + i, issuedTo: 'Trade ' + i, scope: 'General', purpose: 'Site works' })),
      tasks, billings, collections,
      billingOutputs: Array.from({ length: 2 }, (_, i) => ({ outputNo: 'OUT-0' + (i + 1), date: week[0], title: 'Billing output ' + (i + 1), billingId: 'bill' + i, net: 100000 + i * 50000, status: 'archived' })),
      contract: { client: 'Angeles Family', amount: 5000000, downPct: 20, retentionPct: 10, start: week[0], end: week[6], createdAt: 1780000000000 },
      siteLogs, changeOrders, payrollLogs,
      attendanceHistory: payrollLogs,
      notificationEvents, activity,
      equipment: Array.from({ length: 6 }, (_, i) => ({ name: 'Mixer Machine ' + (i + 1), type: i % 2 ? 'power' : 'heavy', rate: 1500, rateUnit: 'day', status: 'active', lastService: week[0] })),
      compliance: Array.from({ length: 5 }, (_, i) => ({ docType: 'Permit', name: 'Permit ' + (i + 1), refNo: 'REF' + i, expiryDate: week[0], status: 'active', link: '', notes: '' })),
      defects: Array.from({ length: 4 }, (_, i) => ({ title: 'Punch list item ' + (i + 1), location: 'Area ' + i, severity: 'minor', status: 'open', reportedBy: 'Test APM', createdAt: 1780000000000 + i })),
      sitelogSettings: { default: true }
    });

    function makeSnapshot(value, key) {
      return {
        key: key || '',
        val: function () { return value; },
        exists: function () { return value !== null && value !== undefined; },
        child: function (childKey) {
          const v = value && typeof value === 'object' ? value[childKey] : undefined;
          return makeSnapshot(v === undefined ? null : v, childKey);
        },
        numChildren: function () { return value && typeof value === 'object' ? Object.keys(value).length : 0; },
        forEach: function (cb) {
          if (!value || typeof value !== 'object') return false;
          Object.keys(value).forEach(function (childKey) {
            cb(makeSnapshot(value[childKey], childKey));
          });
          return false;
        }
      };
    }

    function resolvePath(path) {
      const parts = String(path || '').split('/').filter(Boolean);
      let cur = MOCK_DATA;
      for (const p of parts) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return null;
        cur = cur[p];
      }
      return cur === undefined ? null : cur;
    }

    function makeDbRef(path) {
      const base = {
        key: String(path || '').split('/').pop() || 'mock-key',
        once: function () { return Promise.resolve(makeSnapshot(resolvePath(path), String(path || '').split('/').pop())); },
        on: function (event, cb) {
          if (typeof cb === 'function') setTimeout(function () { cb(makeSnapshot(resolvePath(path), String(path || '').split('/').pop())); }, 0);
        },
        off: function () {},
        update: function () { return Promise.resolve(); },
        set: function () { return Promise.resolve(); },
        remove: function () { return Promise.resolve(); },
        push: function () {
          const key = 'mock-key-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
          const child = makeDbRef((path || '') + '/' + key);
          child.set = function () { return Promise.resolve(); };
          return child;
        },
        orderByChild: function () { return this; },
        equalTo: function () { return this; },
        limitToLast: function () { return this; },
        limitToFirst: function () { return this; },
        endAt: function () { return this; },
        startAt: function () { return this; }
      };
      return base;
    }

    window.firebase = {
      initializeApp: function () { return {}; },
      app: function () { return {}; },
      apps: [],
      database: Object.assign(
        function () { return { ref: function (p) { return makeDbRef(p || ''); } }; },
        { ServerValue: { TIMESTAMP: Date.now() } }
      ),
      auth: function () {
        return {
          currentUser: __authUser,
          Auth: { Persistence: { LOCAL: 'local' } },
          setPersistence: function () { return Promise.resolve(); },
          onAuthStateChanged: function (cb) {
            setTimeout(function () { cb(__authUser); }, 0);
            return function () {};
          },
          signInAnonymously: function () { return Promise.resolve({ user: __authUser }); },
          signInWithEmailAndPassword: function () { return Promise.resolve({ user: __authUser }); },
          signOut: function () { return Promise.resolve(); }
        };
      },
      storage: function () { return { ref: function () { return { putString: function () { return Promise.resolve({}); }, getDownloadURL: function () { return Promise.resolve(''); } }; } }; }
    };
    window.firebase.auth.Auth = { Persistence: { LOCAL: 'local' } };
    window.APP_VERSION = '1.0.0';
    window.PMOS_VERSION = '1.0.0';
    window.CACHE_VERSION = 'acpm-pmos-v3';
    window.PMOS_SCHEMA_VERSION = '1.0';
    window.PMOS_CONFIG = {
      faceAttendanceEnabled: false, photoStorageProvider: 'googleDrive',
      useFirebaseStoragePhotos: false, useGoogleDrivePhotos: true,
      driveUploadUrl: 'https://script.google.com/macros/s/test/exec',
      maxPhotoSize: 20971520, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
    };
    window.__resolvePath = resolvePath;
    window.__dbgSnap = function (path) {
      const v = resolvePath(path);
      return v === null ? 'NULL' : (typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v));
    };
  } catch (e) {
    console.error('INIT_SCRIPT_ERROR', e && e.stack ? e.stack : String(e));
    throw e;
  }
  `;
}

/* ── in-page audit helpers ─────────────────────────────────────── */
const IN_PAGE = `
  window.__audit = {
    metrics() {
      const doc = document.documentElement;
      return {
        viewportW: doc.clientWidth,
        viewportH: window.innerHeight,
        docScrollW: doc.scrollWidth,
        docScrollH: doc.scrollHeight,
        bodyOverflow: getComputedStyle(document.body).overflow,
        mainOverflow: (() => { const m = document.querySelector('.main'); return m ? getComputedStyle(m).overflow : ''; })(),
        htmlOverflow: getComputedStyle(document.documentElement).overflow
      };
    },
    inScrollWrapper(el) {
      // Any overflow-clipping ancestor (other than html/body, which guard the
      // page itself) means the element's wide box is contained and scrollable
      // or clipped inside a container — not a page-level overflow.
      let node = el.parentElement;
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden') return true;
        node = node.parentElement;
      }
      return false;
    },
    offenders(container) {
      const vw = document.documentElement.clientWidth;
      const out = [];
      const root = container ? document.querySelector(container) : document.body;
      if (!root) return [];
      root.querySelectorAll('*').forEach(el => {
        if (!el.getClientRects || !el.getClientRects().length) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.right > vw + 2) {
          if (this.inScrollWrapper(el)) return;
          if (el.classList && el.classList.contains('modal-overlay')) return;
          out.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            cls: String(el.className || '').slice(0, 70),
            right: Math.round(r.right), w: Math.round(r.width)
          });
        }
      });
      return out.slice(0, 10);
    },
    async actionReachable(selector, tries = 0) {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, reason: 'missing' };
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return { ok: false, reason: 'hidden(display=' + cs.display + ')' };
      if (el.offsetParent === null && !['fixed', 'absolute', 'sticky'].includes(cs.position)) return { ok: false, reason: 'no-layout' };
      // The app uses smooth scrolling — disable it for the measurement,
      // center the element (guarantees full visibility), then wait a beat.
      const html = document.documentElement;
      const prevBehavior = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      html.style.scrollBehavior = prevBehavior;
      await new Promise(resolve => setTimeout(resolve, 300));
      // The app re-renders panels/tabs asynchronously — re-query the fresh
      // element so a detached node never produces a 0x0 false negative.
      const fresh = document.querySelector(selector);
      const target = fresh || el;
      const r = target.getBoundingClientRect();
      const vh = window.innerHeight;
      const visible = r.top < vh - 4 && r.bottom > 4 && r.width > 0 && r.height > 0;
      if (!visible && r.width === 0 && r.height === 0 && tries < 2) {
        // Detached mid-re-render (async Firebase callbacks rebuild the grid).
        // Wait for the fresh grid to settle, then measure once more.
        await new Promise(resolve => setTimeout(resolve, 350));
        return window.__audit.actionReachable(selector, tries + 1);
      }
      return { ok: visible, reason: visible ? '' : 'off-viewport:' + Math.round(r.top) + '..' + Math.round(r.bottom) + '/vh' + vh, rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) } };
    },
    duplicateIds() {
      const seen = {}; const dups = [];
      document.querySelectorAll('[id]').forEach(el => {
        if (seen[el.id]) { if (!dups.includes(el.id)) dups.push(el.id); }
        seen[el.id] = true;
      });
      return dups.slice(0, 10);
    },
    modalFit(modalSel) {
      const box = document.querySelector(modalSel + ' .modal-box');
      if (!box) return { ok: false, reason: 'no .modal-box' };
      const r = box.getBoundingClientRect();
      const vh = window.innerHeight;
      const fits = r.top >= -2 && r.bottom <= vh + 2;
      const cs = getComputedStyle(box);
      const scrollable = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
      return { ok: fits, reason: fits ? '' : 'box ' + Math.round(r.top) + '..' + Math.round(r.bottom) + ' vh=' + vh, rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }, overflowY: cs.overflowY, maxHeight: cs.maxHeight };
    },
    // Delivery receipt modal: with many line items the modal must never exceed
    // the viewport, the item list must own the vertical scroll (not clip rows),
    // and every row + the footer action must stay reachable. 30 rows are
    // injected into the live list container so the check is deterministic.
    deliveryScrollBody(modalSel, rowCount) {
      const modal = document.querySelector(modalSel);
      const box = modal && modal.querySelector('.modal-box');
      const list = modal && modal.querySelector('#deliveryItemsList');
      if (!modal || !box || !list) return { ok: false, reason: 'delivery modal/list not found' };
      const header = modal.querySelector('.modal-title');
      const footer = modal.querySelector('.modal-actions');
      const listStyle = getComputedStyle(list);
      const boxStyle = getComputedStyle(box);
      const vh = window.innerHeight;
      // Seed rows so the list content always exceeds the smallest tested viewport.
      const rows = rowCount || 30;
      let html = '';
      for (let i = 0; i < rows; i++) {
        html += '<div class="delivery-item-row">' +
          '<span class="delivery-item-name">QA Delivery Item ' + (i + 1) +
          ' - Extra long material description that wraps nicely and must never clip on any viewport</span>' +
          '<span class="delivery-item-ordered">Ordered: 100 pcs · Remaining: 100 pcs</span>' +
          '<input type="number" class="delivery-qty-received" value="">' +
          '<select><option>Good</option></select></div>';
      }
      list.innerHTML = html;
      // Force the layout to settle, then measure the real scroll geometry.
      const br = box.getBoundingClientRect();
      const fits = br.top >= -2 && br.bottom <= vh + 2;
      const listH = list.clientHeight;
      const scrollH = list.scrollHeight;
      const canScroll = listStyle.overflowY === 'auto' || listStyle.overflowY === 'scroll';
      const boxOwnsScroll = (boxStyle.overflowY === 'auto' || boxStyle.overflowY === 'scroll');
      // The list must actually be the scroll container: it clips only when it
      // has content larger than itself AND is scrollable (not overflow:hidden).
      const listScrolls = canScroll && scrollH > listH + 1;
      // Scroll the list to the bottom and confirm the LAST row is fully visible.
      list.scrollTop = list.scrollHeight;
      const rowsEls = Array.from(list.querySelectorAll('.delivery-item-row'));
      const lastRow = rowsEls[rowsEls.length - 1];
      const lr = lastRow ? lastRow.getBoundingClientRect() : null;
      const lastReachable = !!lr && lr.bottom <= br.bottom + 2 && lr.bottom > br.top - 2;
      const lastRowId = lastRow && lastRow.querySelector('.delivery-item-name') && lastRow.querySelector('.delivery-item-name').textContent.trim();
      // Footer actions must stay visible (never pushed below the viewport).
      const fr = footer ? footer.getBoundingClientRect() : null;
      const footerVisible = !!fr && fr.top >= -2 && fr.bottom <= vh + 2 && fr.bottom > 0;
      // Header must stay visible too.
      const hdr = header ? header.getBoundingClientRect() : null;
      const headerVisible = !!hdr && hdr.top >= -2 && hdr.bottom <= vh + 2;
      const result = {
        ok: fits && listScrolls && lastReachable && footerVisible && headerVisible && !boxOwnsScroll,
        reason: [
          fits ? '' : 'box ' + Math.round(br.top) + '..' + Math.round(br.bottom) + ' vh=' + vh,
          listScrolls ? '' : 'list not scrollable overflowY=' + listStyle.overflowY + ' scrollH=' + scrollH + ' clientH=' + listH,
          lastReachable ? '' : 'last row unreachable',
          footerVisible ? '' : 'footer off-viewport',
          headerVisible ? '' : 'header off-viewport',
          boxOwnsScroll ? 'box still scrolls (overflowY=' + boxStyle.overflowY + ')' : ''
        ].filter(Boolean).join('; ') || 'all rows + footer + header reachable',
        metrics: { boxTop: Math.round(br.top), boxBottom: Math.round(br.bottom), listH, scrollH, rows: rowsEls.length, lastRow: lastRowId, listOverflowY: listStyle.overflowY }
      };
      list.innerHTML = '';
      return result;
    },
    panelVisible(panelId) {
      const el = document.getElementById(panelId);
      if (!el) return false;
      return el.classList.contains('hidden') === false && getComputedStyle(el).display !== 'none';
    },
    criticalAssetsLoaded(required) {
      // 404/network errors are filtered as noise in the console check — this
      // guard makes sure the assets that actually define the layout arrived.
      // If a required local asset failed, an unstyled page would pass the
      // overflow/scroll checks, which is exactly what we must catch.
      const resources = new Set(
        (performance.getEntriesByType('resource') || []).map(r => {
          const u = new URL(r.name, location.href);
          return u.pathname.split('/').pop();
        })
      );
      const missing = required.filter(name => !resources.has(name));
      return { ok: missing.length === 0, missing };
    }
  };
`;

/* ── console noise filter ──────────────────────────────────────── */
function isNoise(text) {
  const lower = String(text).toLowerCase();
  return (
    lower.includes('favicon') ||
    lower.includes('manifest') ||
    lower.includes('gstatic.com/firebasejs') && lower.includes('failed to load') ||
    lower.includes('net::err_') ||
    lower.includes('404') ||
    lower.includes('service worker') ||
    lower.includes('failed to load resource: the server responded with a status of 404')
  );
}

async function waitForWorkspace(page) {
  await page.waitForFunction(() => {
    const ws = document.querySelector('#workspaceView');
    return !!ws && !ws.classList.contains('hidden') &&
      document.body.classList.contains('auth-ready') &&
      !document.querySelector('#authOverlay') &&
      document.querySelector('#rosterList .roster-row');
  }, null, { timeout: 20000 });
  await page.waitForFunction(() => {
    const grid = document.querySelector('#timecardGrid');
    return grid && grid.querySelector('.trade-block');
  }, null, { timeout: 20000 });
}

async function auditWorkspaceViewport(browser, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await page.addInitScript(buildInitScript());
  await page.addInitScript(IN_PAGE);
  await page.route('**/www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('[console] ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('[pageerror] ' + String(e.message).slice(0, 300)));

  const name = vp.name;
  try {
    await page.goto(`${BASE}/workspace?projectId=${PROJECT}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForWorkspace(page);

    // The boss role auto-lands on the Reports tab — an office user clicks the
    // Labor tab explicitly. Mirror that before auditing the payroll area.
    await page.evaluate(() => window.switchTab && window.switchTab('labor'));
    await page.waitForFunction(() => {
      const p = document.querySelector('#laborPanel');
      return p && !p.classList.contains('hidden') && getComputedStyle(p).display !== 'none';
    }, null, { timeout: 10000 });
    await page.waitForTimeout(400);

    /* labor tab */
    const m = await page.evaluate(() => window.__audit.metrics());
    record(name, 'page scrollable (labor, 30 workers)', m.docScrollH > m.viewportH,
      `scrollH=${m.docScrollH} vh=${m.viewportH} bodyOv=${m.bodyOverflow}`);
    record(name, 'no horizontal overflow (labor)', m.docScrollW <= m.viewportW + 2,
      `docW=${m.docScrollW} vw=${m.viewportW}`);

    const offenders = await page.evaluate(() => window.__audit.offenders('#laborPanel'));
    record(name, 'labor offenders list empty', offenders.length === 0,
      offenders.map(o => `<${o.tag}${o.id ? '#' + o.id : ''} ${o.cls}> right=${o.right} w=${o.w}`).join(' | '));

    const actions = {
      'Compile Payroll': '#laborPanel .btn-compile',
      'RFP button': '#laborPanel .btn-rfp',
      'Roster add worker': '#laborPanel .btn-add-worker',
      'Week Apply': '#laborPanel .btn-apply',
    };
    for (const [label, sel] of Object.entries(actions)) {
      const r = await page.evaluate(s => window.__audit.actionReachable(s), sel);
      record(name, `action reachable: ${label}`, r.ok, r.reason || r.rect && JSON.stringify(r.rect));
    }

    // Verify the page really owns vertical scrolling (no scroll trap):
    // hard-scroll the window and confirm the document moved.
    const scrollOk = await page.evaluate(async () => {
      const before = window.scrollY;
      window.scrollTo(0, 600);
      await new Promise(r => setTimeout(r, 450));
      const after = window.scrollY;
      window.scrollTo(0, before);
      return { ok: after > 0, before, after };
    });
    record(name, 'window hard-scroll works (no trap)', scrollOk.ok, `scrollY ${scrollOk.before} -> ${scrollOk.after}`);

    const dups = await page.evaluate(() => window.__audit.duplicateIds());
    record(name, 'no duplicated ids (labor)', dups.length === 0, dups.join(','));

    /* tabs */
    const tabs = [
      ['materials', 'materialsPanel'], ['billing', 'billingPanel'], ['sitelog', 'sitelogPanel'],
      ['tasks', 'tasksPanel'], ['changeorders', 'changeordersPanel'], ['suppliers', 'suppliersPanel'],
      ['equipment', 'equipmentPanel'], ['compliance', 'compliancePanel'], ['defects', 'defectsPanel'],
      ['reports', 'reportsPanel']
    ];
    for (const [tab, panel] of tabs) {
      const tabVisible = await page.locator(`#tab_${tab}`).isVisible().catch(() => false);
      if (!tabVisible) continue;
      await page.evaluate(t => { window.switchTab && window.switchTab(t); }, tab);
      await page.waitForTimeout(500);
      const tm = await page.evaluate(() => window.__audit.metrics());
      const off = await page.evaluate(() => window.__audit.offenders());
      record(name, `tab ${tab}: no horizontal overflow`, off.length === 0 && tm.docScrollW <= tm.viewportW + 2,
        off.slice(0, 3).map(o => `${o.tag}#${o.id} ${o.cls}`).join(' | ') || `docW=${tm.docScrollW}`);
      const pv = await page.evaluate(p => window.__audit.panelVisible(p), panel);
      record(name, `tab ${tab}: panel shown`, pv, '');
    }
    await page.evaluate(() => window.switchTab && window.switchTab('labor'));
    await page.waitForTimeout(400);

    /* modals */
    await page.locator('#rosterList .btn-edit-worker').first().click();
    await page.waitForTimeout(200);
    const editFit = await page.evaluate(() => window.__audit.modalFit('#workerEditModal'));
    record(name, 'worker edit modal fits viewport', editFit.ok, editFit.reason + ' overflowY=' + editFit.overflowY);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // Escape must close the modal, NOT exit the workspace to the hub.
    const escapeState = await page.evaluate(() => ({
      modalHidden: document.querySelector('#workerEditModal')?.classList.contains('hidden'),
      modalStillInDom: !!document.querySelector('#workerEditModal'),
      workspaceHidden: document.querySelector('#workspaceView')?.classList.contains('hidden')
    }));
    record(name, 'Escape closes modal without exiting workspace',
      escapeState.modalHidden === true && escapeState.modalStillInDom === true && escapeState.workspaceHidden === false,
      JSON.stringify(escapeState));

    await page.locator('#rosterList .btn-advance').first().click();
    await page.waitForTimeout(300);
    const advFit = await page.evaluate(() => window.__audit.modalFit('#advanceModal'));
    record(name, 'cash advance modal fits viewport', advFit.ok, advFit.reason + ' overflowY=' + advFit.overflowY);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    /* payroll review modal via Compile Payroll (boss role, fresh week) */
    await page.evaluate(() => window.compilePayroll && window.compilePayroll());
    await page.waitForTimeout(600);
    const reviewBox = await page.evaluate(() => {
      const box = document.querySelector('.modal-box');
      if (!box) return null;
      const r = box.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight, overflowY: getComputedStyle(box).overflowY };
    });
    record(name, 'payroll compile dialog present', !!reviewBox, reviewBox ? JSON.stringify(reviewBox) : 'no .modal-box found');
    if (reviewBox) {
      record(name, 'payroll compile dialog fits viewport', reviewBox.top >= -2 && reviewBox.bottom <= reviewBox.vh + 2,
        `top=${reviewBox.top} bottom=${reviewBox.bottom} h=${reviewBox.h} vh=${reviewBox.vh}`);
      const saveBtn = await page.evaluate(() => {
        const btn = document.querySelector('.modal-box button');
        if (!btn) return null;
        btn.scrollIntoView({ block: 'nearest' });
        const r = btn.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
      });
      record(name, 'payroll dialog primary action reachable', !!saveBtn && saveBtn.top >= -2 && saveBtn.bottom <= saveBtn.vh + 2,
        saveBtn ? JSON.stringify(saveBtn) : 'no button');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    /* RFP modal (archived payroll data exists in the stress dataset) */
    await page.evaluate(() => window.generateRFP && window.generateRFP());
    await page.waitForTimeout(600);
    const rfpFit = await page.evaluate(() => window.__audit.modalFit('#rfpModal'));
    record(name, 'RFP modal fits viewport', rfpFit.ok, rfpFit.reason + ' overflowY=' + rfpFit.overflowY);
    const rfpActions = await page.evaluate(() => {
      const box = document.querySelector('#rfpModal .modal-box');
      if (!box) return null;
      const btns = Array.from(box.querySelectorAll('button'));
      const last = btns[btns.length - 1];
      if (!last) return null;
      last.scrollIntoView({ block: 'center' });
      const r = last.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
    });
    record(name, 'RFP modal actions reachable', !!rfpActions && rfpActions.top >= -2 && rfpActions.bottom <= rfpActions.vh + 2,
      rfpActions ? JSON.stringify(rfpActions) : 'no buttons');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    /* materials: stress the PO builder with 30 draft line items */
    await page.evaluate(() => window.switchTab && window.switchTab('materials'));
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      for (let i = 0; i < 30; i++) {
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        set('poItemDesc', 'Stress material line item number ' + (i + 1) + ' with a very long description that wraps and tests the layout');
        set('poItemSize', (i % 3 + 1) + 'x' + (i % 2 + 1) + 'm');
        set('poItemQty', (i + 1) * 10);
        set('poItemUnit', i % 2 ? 'pcs' : 'bags');
        set('poItemCost', 100 + i * 37);
        if (window.addDraftItem) window.addDraftItem();
      }
    });
    await page.waitForTimeout(400);
    const draftRows = await page.locator('#draftList .draft-row').count().catch(() => 0);
    record(name, 'materials: 30 draft items rendered', draftRows >= 30, 'rows=' + draftRows);
    const draftOff = await page.evaluate(() => window.__audit.offenders('#materialsPanel'));
    const draftMetrics = await page.evaluate(() => window.__audit.metrics());
    record(name, 'materials: 30-item draft no overflow', draftOff.length === 0 && draftMetrics.docScrollW <= draftMetrics.viewportW + 2,
      draftOff.slice(0, 3).map(o => `${o.tag}#${o.id}`).join(' | ') || '');
    const submitBtn = await page.evaluate(() => window.__audit.actionReachable('#materialsPanel .btn-submit-po'));
    record(name, 'materials: Submit PO reachable with 30 items', submitBtn.ok, submitBtn.reason);

    /* delivery modal with many line items (30-item regression: every row must
       remain reachable, the list owns the scroll, footer+header stay visible) */
    const openedAny = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('#materialsPanel button'));
      const del = btns.find(b => /deliver|receive/i.test(b.textContent || ''));
      if (del) { del.click(); return 'delivery'; }
      return null;
    });
    if (openedAny) {
      await page.waitForTimeout(400);
      const fit = await page.evaluate(() => window.__audit.modalFit('#deliveryModal'));
      record(name, 'delivery modal fits viewport', fit.ok, fit.reason);
      const scrollBody = await page.evaluate(() => window.__audit.deliveryScrollBody('#deliveryModal', 30));
      record(name, 'delivery modal: 30 items all reachable, list scrolls, header+footer visible', scrollBody.ok, scrollBody.reason + (scrollBody.metrics ? ' [' + JSON.stringify(scrollBody.metrics).slice(0, 140) + ']' : ''));
      await page.keyboard.press('Escape');
    } else {
      record(name, 'delivery modal opened', false, 'no deliver/receive button found in materials panel');
    }

    /* critical assets loaded (404 noise could otherwise mask a failed CSS/JS) */
    const assetOk = await page.evaluate(() => window.__audit.criticalAssetsLoaded([
      'style.css', 'utils.js', 'auth.js', 'main.js', 'labor.js', 'materials.js', 'billing.js', 'report.js'
    ]));
    record(name, 'critical assets loaded (workspace)', assetOk.ok, 'missing: ' + assetOk.missing.join(', '));

    // Modal open/Escape cycles must never accumulate duplicate IDs (dynamic
    // modals hidden instead of removed would regress here).
    const dupsAfterModals = await page.evaluate(() => window.__audit.duplicateIds());
    record(name, 'no duplicated ids after modal cycles', dupsAfterModals.length === 0, dupsAfterModals.join(','));

    record(name, 'no console errors (session)', errors.length === 0, errors.slice(0, 6).join(' || '));
  } catch (e) {
    record(name, 'workspace loaded without exception', false, String(e.message).slice(0, 200));
    record(name, 'no console errors (session)', errors.length === 0, errors.slice(0, 6).join(' || '));
  }
  await ctx.close();
}

async function auditHubViewport(browser, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await page.addInitScript(buildInitScript());
  await page.addInitScript(IN_PAGE);
  await page.route('**/www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('[console] ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('[pageerror] ' + String(e.message).slice(0, 300)));
  const name = vp.name + '-hub';
  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => {
      const hub = document.querySelector('#hubView');
      return !!hub && !hub.classList.contains('hidden') &&
        document.body.classList.contains('auth-ready') &&
        document.querySelectorAll('#projectGrid .proj-card').length >= 15;
    }, null, { timeout: 20000 });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => window.__audit.metrics());
    record(name, 'hub: page scrollable (20 projects)', m.docScrollH > m.viewportH, `scrollH=${m.docScrollH} vh=${m.viewportH}`);
    record(name, 'hub: no horizontal overflow', m.docScrollW <= m.viewportW + 2, `docW=${m.docScrollW} vw=${m.viewportW}`);
    const off = await page.evaluate(() => window.__audit.offenders('#hubView'));
    record(name, 'hub: offenders empty', off.length === 0, off.slice(0, 4).map(o => `${o.tag}#${o.id} ${o.cls}`).join(' | '));
    const dups = await page.evaluate(() => window.__audit.duplicateIds());
    record(name, 'hub: no duplicated ids', dups.length === 0, dups.join(','));
    const openBtn = await page.evaluate(() => window.__audit.actionReachable('#projectGrid .proj-open-btn'));
    record(name, 'hub: project Open button reachable', openBtn.ok, openBtn.reason);
    // Hub tabs: switch to All + Completed and re-check
    for (const tab of ['all', 'completed']) {
      await page.evaluate(t => window.showHubTab && window.showHubTab(t), tab);
      await page.waitForTimeout(500);
      const tm = await page.evaluate(() => window.__audit.metrics());
      const off2 = await page.evaluate(() => window.__audit.offenders('#hubView'));
      record(name, `hub tab ${tab}: no overflow`, off2.length === 0 && tm.docScrollW <= tm.viewportW + 2,
        off2.slice(0, 3).map(o => `${o.tag}#${o.id}`).join(' | '));
    }
    await page.evaluate(() => window.showHubTab && window.showHubTab('active'));
    const hubAssets = await page.evaluate(() => window.__audit.criticalAssetsLoaded([
      'style.css', 'utils.js', 'auth.js', 'main.js', 'report.js'
    ]));
    record(name, 'hub: critical assets loaded', hubAssets.ok, 'missing: ' + hubAssets.missing.join(', '));
    record(name, 'hub: no console errors', errors.length === 0, errors.slice(0, 6).join(' || '));
  } catch (e) {
    record(name, 'hub: loaded without exception', false, String(e.message).slice(0, 200));
    record(name, 'hub: no console errors', errors.length === 0, errors.slice(0, 6).join(' || '));
  }
  await ctx.close();
}

async function auditPmosViewport(browser, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await page.addInitScript(buildInitScript());
  await page.addInitScript(IN_PAGE);
  await page.route('**/www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('[console] ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('[pageerror] ' + String(e.message).slice(0, 300)));
  const name = vp.name + '-pmos';
  try {
    await page.goto(`${BASE}/pmos.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => {
      return !!document.querySelector('#pmosContent') && !document.body.classList.contains('auth-checking');
    }, null, { timeout: 15000 });
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => window.__audit.metrics());
    record(name, 'pmos: no horizontal overflow', m.docScrollW <= m.viewportW + 2, `docW=${m.docScrollW} vw=${m.viewportW}`);
    const off = await page.evaluate(() => window.__audit.offenders('#pmosContent'));
    record(name, 'pmos: offenders empty (home)', off.length === 0, off.slice(0, 5).map(o => `${o.tag}#${o.id}`).join(' | '));
    // The bottom nav must be visible at every viewport (actions reachable)
    const navVisible = await page.evaluate(() => {
      const nav = document.querySelector('.pmos-nav, .pmos-bottom-nav, [class*="nav"]');
      if (!nav) return false;
      const r = nav.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom <= window.innerHeight + 2;
    });
    record(name, 'pmos: bottom nav visible & on-screen', navVisible, '');
    // Switch through every nav view — overflow + errors must stay clean
    const views = ['updates', 'tasks', 'more'];
    for (const v of views) {
      const switched = await page.evaluate(vi => {
        if (typeof window.pmosShowNav === 'function') { window.pmosShowNav(vi); return true; }
        return false;
      }, v);
      if (!switched) break;
      await page.waitForTimeout(350);
      const vo = await page.evaluate(() => window.__audit.offenders('#pmosContent'));
      const vm = await page.evaluate(() => window.__audit.metrics());
      record(name, `pmos: no overflow (view ${v})`, vo.length === 0 && vm.docScrollW <= vm.viewportW + 2,
        vo.slice(0, 3).map(o => `${o.tag}#${o.id}`).join(' | '));
    }
    // Create sheet (bottom sheet dialog) must fit and stay scrollable
    const sheetOpened = await page.evaluate(() => {
      if (typeof window.pmosShowCreateSheet === 'function') { window.pmosShowCreateSheet(); return true; }
      return false;
    });
    if (sheetOpened) {
      await page.waitForTimeout(350);
      const sheetFit = await page.evaluate(() => {
        const sheet = document.querySelector('#pmosActionSheet');
        if (!sheet || sheet.classList.contains('hidden')) return { ok: false, reason: 'hidden' };
        const r = sheet.getBoundingClientRect();
        return {
          ok: r.top >= -2 && r.bottom <= window.innerHeight + 2,
          reason: `top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} vh=${window.innerHeight}`,
          overflowY: getComputedStyle(sheet).overflowY
        };
      });
      record(name, 'pmos: create sheet fits viewport', sheetFit.ok, sheetFit.reason + ' overflowY=' + sheetFit.overflowY);
      await page.keyboard.press('Escape');
    }
    // Back to home so the shell ends in a stable state
    await page.evaluate(() => { if (typeof window.pmosShowNav === 'function') window.pmosShowNav('home'); });
    await page.waitForTimeout(250);
    const pmosAssets = await page.evaluate(() => window.__audit.criticalAssetsLoaded([
      'style.css', 'pmos-app.css', 'acpm-brand.css', 'utils.js', 'auth.js', 'main.js', 'pmos.js', 'acpm-shell.js'
    ]));
    record(name, 'pmos: critical assets loaded', pmosAssets.ok, 'missing: ' + pmosAssets.missing.join(', '));
    record(name, 'pmos: no console errors', errors.length === 0, errors.slice(0, 6).join(' || '));
  } catch (e) {
    record(name, 'pmos: loaded without exception', false, String(e.message).slice(0, 200));
    record(name, 'pmos: no console errors', errors.length === 0, errors.slice(0, 6).join(' || '));
  }
  await ctx.close();
}

/* ── exports (for debug/CI reuse) ─────────────────────────────── */
module.exports = { buildInitScript, IN_PAGE, isNoise, waitForWorkspace, VIEWPORTS, record, results };

/* ── runner ────────────────────────────────────────────────────── */
if (require.main !== module) return;

(async () => {
  await startServer();
  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    console.log(`\n── ${vp.name} (${vp.width}×${vp.height}) ──`);
    await auditWorkspaceViewport(browser, vp);
    await auditHubViewport(browser, vp);
    await auditPmosViewport(browser, vp);
  }
  await browser.close();

  const byViewport = {};
  for (const r of results) {
    (byViewport[r.viewport] = byViewport[r.viewport] || []).push(r);
  }
  console.log('\n\n══════════ SUMMARY ══════════');
  for (const [vp, rows] of Object.entries(byViewport)) {
    const fails = rows.filter(r => !r.ok);
    console.log(`\n[${vp}] ${rows.length - fails.length}/${rows.length} PASS`);
    for (const f of fails) console.log(`  ✗ ${f.check}${f.detail ? ' — ' + f.detail : ''}`);
  }
  console.log(`\nTOTAL: ${results.length - failures}/${results.length} PASS, ${failures} FAIL`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
