// ============================================================
//  ACPM MAX-LOAD STRESS SEED — emulator only
// ============================================================
//  Seeds the LOCAL database emulator (port 18300) with a
//  production-scale workload:
//    - 10 active projects
//    - 50 workers per project (10 each x 5 trades:
//      Electrician, Plumbing, Structural, Installer, Paint)
//    - 12 consecutive weekly (Saturday) payroll logs with full
//      50-worker entries each
//    - ~4 weeks of daily materials requests (POs + deliveries +
//      materials lines + movements + inventory)
//    - attendance (current week), advances, tasks, site logs,
//      change orders, billings, collections, suppliers,
//      equipment, compliance, defects
//
//  Run AFTER starting the emulator:
//    npx firebase emulators:start --config dev/firebase.dev.json --project acpm-project-system-qa
//    node dev/seed-stress-data.js
//
//  All data is clearly labeled STRESS and lives only in the
//  local emulator. It is never written to staging/production.
// ============================================================

'use strict';

const EMULATOR = process.env.ACPM_DEV_DB_URL || 'http://127.0.0.1:18300';
// Must match the namespace the SDK derives from the app databaseURL
const NS = 'acpm-project-system-qa-default-rtdb';

const PROJECT_COUNT = 10;
const WORKERS_PER_TRADE = 10;
const TRADES = ['Electrician', 'Plumbing', 'Structural', 'Installer', 'Paint'];
const PAYROLL_WEEKS = 12; // 12 Saturdays
const MATERIAL_DAYS = 20; // ~4 weeks of daily requests
const SEED_PREFIX = 'STRESS';

async function put(path, value) {
  const url = `${EMULATOR}/${path}.json?ns=${NS}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!res.ok) throw new Error(`PUT ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res;
}

function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Date arithmetic helpers (week starts Monday, payroll Saturday)
function addDays(base, days) {
  const d = new Date(base);
  d.setDate(base.getDate() + days);
  return d;
}

function saturdayBefore(base) {
  // Most recent Saturday at/before base
  const d = new Date(base);
  d.setHours(12, 0, 0, 0);
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const back = (dow + 1) % 7; // days to go back to Saturday
  d.setDate(d.getDate() - back);
  return d;
}

const NOW = Date.now();
const BY = 'dev-boss';
const BOSS_NAME = 'DEV Boss';

// Workers: 50 per project, deterministic names/rates per trade
function buildWorkers(pid) {
  const workers = {};
  let n = 0;
  for (const trade of TRADES) {
    const baseRate = { Electrician: 1000, Plumbing: 950, Structural: 900, Installer: 850, Paint: 800 }[trade];
    for (let i = 1; i <= WORKERS_PER_TRADE; i++) {
      n++;
      const wid = `w${String(n).padStart(2, '0')}`;
      workers[wid] = {
        name: `${SEED_PREFIX} ${pid.slice(-2)} ${trade} Worker ${i}`,
        trade,
        dailyRate: baseRate + ((n * 37) % 151), // deterministic variation
        status: 'active',
        addedAt: NOW,
        addedBy: BY
      };
    }
  }
  return workers;
}

function attendanceFor(workers, monday, weekKey) {
  const attendance = {};
  for (const [wid, w] of Object.entries(workers)) {
    const days = {};
    for (let i = 0; i < 5; i++) {
      const d = addDays(monday, i);
      const dayIso = iso(d);
      // deterministic mix: mostly present, some overtime, a couple absences
      const mod = (wid.charCodeAt(1) + i) % 10;
      let status = 'present';
      let ot = 0;
      if (mod === 0) { status = 'absent'; }
      else if (mod === 1) { status = 'half'; }
      else if (mod === 2) { status = 'present'; ot = 2; }
      days[dayIso] = {
        workerId: wid,
        date: dayIso,
        status,
        weekKey,
        regularHours: status === 'present' ? 8 : (status === 'half' ? 4 : 0),
        overtimeHours: ot,
        nightDiffHours: 0,
        paidHours: (status === 'present' ? 8 : status === 'half' ? 4 : 0) + ot,
        multiplier: 1,
        notes: `${SEED_PREFIX} attendance`,
        markedAt: NOW,
        markedBy: BY
      };
    }
    attendance[wid] = days;
  }
  return attendance;
}

function buildPayrollLog(pid, workers, sat, weekIndex) {
  const start = addDays(sat, -5); // Monday
  const end = addDays(sat, 1);    // Sunday
  const weekKey = `${iso(start)}_${iso(end)}`;
  const byTrade = {};
  const tradeTotals = {};
  let grossTotal = 0;
  let advTotal = 0;
  let regularTotal = 0;
  let otTotal = 0;
  for (const [wid, w] of Object.entries(workers)) {
    const mod = (wid.charCodeAt(1) + weekIndex) % 9;
    const days = mod === 0 ? 4 : mod === 1 ? 4.5 : 5; // occasional short week
    const regular = Math.round(w.dailyRate * Math.min(days, 5));
    const ot = mod === 2 ? Math.round(w.dailyRate / 8 * 2) : 0; // 2 OT hrs
    const gross = regular + ot;
    const adv = mod === 3 ? 1000 : mod === 4 ? 500 : 0;
    grossTotal += gross;
    advTotal += adv;
    regularTotal += regular;
    otTotal += ot;
    if (!byTrade[w.trade]) {
      byTrade[w.trade] = {
        trade: w.trade,
        foremanName: `${SEED_PREFIX} ${w.trade} Foreman`,
        paymentMethod: 'Bank',
        notes: `${SEED_PREFIX} weekly log`,
        workers: {},
        total: 0,
        regular: 0,
        ot: 0,
        night: 0,
        cashAdvanceDeductions: 0,
        net: 0
      };
    }
    byTrade[w.trade].workers[wid] = {
      name: w.name, trade: w.trade, foremanName: byTrade[w.trade].foremanName,
      rate: w.dailyRate, days,
      regular, ot, night: 0, gross
    };
    byTrade[w.trade].total += gross;
    byTrade[w.trade].regular += regular;
    byTrade[w.trade].ot += ot;
    byTrade[w.trade].cashAdvanceDeductions += adv;
    byTrade[w.trade].net += gross - adv;
    tradeTotals[w.trade] = (tradeTotals[w.trade] || 0) + gross;
  }
  return {
    weekKey,
    start: iso(start),
    end: iso(end),
    savedAt: sat.getTime(),
    compiledAt: sat.getTime(),
    compiledBy: BOSS_NAME,
    compiledByUid: BY,
    gross: grossTotal,
    regular: regularTotal,
    ot: otTotal,
    night: 0,
    cashAdvanceDeductions: advTotal,
    deductions: advTotal,
    govDeduction: 0,
    net: grossTotal - advTotal,
    byTrade,
    tradeTotals,
    status: 'released',
    isStress: true
  };
}

const PO_ITEMS = [
  { desc: 'Cement 40kg', size: '40kg', unit: 'bag', cost: 245 },
  { desc: 'Rebar 12mm', size: '12mm x 6m', unit: 'len', cost: 380 },
  { desc: 'PVC Pipe 4"', size: '4" x 3m', unit: 'pc', cost: 620 },
  { desc: 'Electrical Wire THHN 3.5mm', size: '3.5mm', unit: 'roll', cost: 1450 },
  { desc: 'Paint Latex White 4L', size: '4L', unit: 'gal', cost: 780 },
  { desc: 'GI Pipe 1"', size: '1" x 6m', unit: 'len', cost: 540 },
  { desc: 'Plywood 3/4"', size: '4x8 ft', unit: 'pc', cost: 1150 },
  { desc: 'Tiles 60x60', size: '60x60', unit: 'box', cost: 920 },
  { desc: 'Aggregate 3/4"', size: '3/4"', unit: 'm3', cost: 1350 },
  { desc: 'Sand', size: 'washed', unit: 'm3', cost: 1150 }
];

function buildSuppliers(pid) {
  const names = ['RRJM Construction Supply', 'North Build Depot', 'Metro Hardware',
    'San Rafael Lumber', 'Prime Cement Trading', 'East Tools & Steel'];
  const suppliers = {};
  names.forEach((name, i) => {
    suppliers[`sup${i + 1}`] = { name, contact: `STRESS-${pid}-${i + 1}`, status: 'active', addedAt: NOW, addedBy: BY };
  });
  return suppliers;
}

function buildPurchaseOrders(pid, suppliers, startMonday) {
  const purchaseOrders = {};
  const statuses = ['approved', 'ordered', 'partially_delivered', 'fully_delivered', 'received', 'approved', 'ordered', 'pending'];
  for (let i = 0; i < MATERIAL_DAYS; i++) {
    const poId = `po${String(i + 1).padStart(2, '0')}`;
    const d = addDays(startMonday, i);
    const itemCount = 2 + (i % 4);
    const items = [];
    for (let j = 0; j < itemCount; j++) {
      const base = PO_ITEMS[(i + j * 3) % PO_ITEMS.length];
      const qty = 5 + ((i * 7 + j * 13) % 40);
      items.push({
        line: j + 1, desc: base.desc, size: base.size, unit: base.unit,
        qty, unitCost: base.cost, total: qty * base.cost
      });
    }
    const status = statuses[i % statuses.length];
    const received = status === 'fully_delivered' ? 100 : status === 'partially_delivered' ? 60 : status === 'received' ? 100 : 0;
    const supplier = suppliers[`sup${(i % 6) + 1}`];
    purchaseOrders[poId] = {
      poNo: `${SEED_PREFIX}-${pid.slice(-2)}-PO-${String(i + 1).padStart(3, '0')}`,
      date: iso(d),
      supplierId: supplier ? `sup${(i % 6) + 1}` : 'sup1',
      supplier: supplier ? supplier.name : 'STRESS Supplier',
      items,
      status,
      urgency: i % 9 === 0 ? 'critical' : 'normal',
      total: items.reduce((s, it) => s + it.total, 0),
      paid: i % 3 === 0,
      createdAt: d.getTime(),
      deliveries: received > 0 ? [{
        date: iso(addDays(d, 2)),
        drNo: `DR-${String(i + 1).padStart(3, '0')}`,
        receiver: 'STRESS APM',
        status: 'received',
        items: items.map(it => ({ ...it, receivedQty: Math.round(it.qty * received / 100) }))
      }] : []
    };
  }
  return purchaseOrders;
}

function buildMaterials(pid, suppliers, startMonday) {
  const materials = [];
  for (let i = 0; i < MATERIAL_DAYS * 2; i++) {
    const base = PO_ITEMS[i % PO_ITEMS.length];
    const d = addDays(startMonday, Math.floor(i / 2));
    const supplier = suppliers[`sup${(i % 6) + 1}`];
    const qty = 5 + (i * 3) % 30;
    materials.push({
      id: `m${String(i + 1).padStart(3, '0')}`,
      date: iso(d),
      supplier: supplier ? supplier.name : 'STRESS Supplier',
      item: base.desc, size: base.size, qty, unit: base.unit,
      unitCost: base.cost, total: qty * base.cost,
      status: i % 4 === 0 ? 'delivered' : 'ordered',
      deliveredQty: i % 4 === 0 ? qty : Math.round(qty * 0.6),
      poNo: `${SEED_PREFIX}-${pid.slice(-2)}-PO-${String((i % MATERIAL_DAYS) + 1).padStart(3, '0')}`,
      addedAt: d.getTime(),
      isStress: true
    });
  }
  return materials;
}

function buildTasks(pid, startMonday) {
  const tasks = {};
  for (let i = 0; i < 25; i++) {
    const d = addDays(startMonday, i % 20);
    tasks[`task${String(i + 1).padStart(2, '0')}`] = {
      title: `${SEED_PREFIX} ${TRADES[i % 5]} task ${i + 1} - phase ${(i % 3) + 1} execution and verification`,
      description: `Long description for stress task ${i + 1}. `.repeat(3),
      status: i % 5 === 0 ? 'completed' : i % 5 === 1 ? 'in_progress' : 'pending',
      priority: ['low', 'normal', 'high', 'critical'][i % 4],
      assignee: `${SEED_PREFIX} ${TRADES[i % 5]} Worker ${(i % 10) + 1}`,
      dueDate: iso(d),
      createdAt: d.getTime(),
      progress: i % 5 === 0 ? 100 : i % 5 === 1 ? 40 : 0,
      isStress: true
    };
  }
  return tasks;
}

function buildSiteLogs(pid, startMonday) {
  const siteLogs = {};
  for (let i = 0; i < 20; i++) {
    const d = addDays(startMonday, i % 20);
    siteLogs[`log${String(i + 1).padStart(2, '0')}`] = {
      date: iso(d),
      notes: `Daily progress notes for ${pid} log ${i + 1}. `.repeat(6),
      work: `${TRADES[i % 5]} works - phase ${(i % 3) + 1}`,
      manpower: '12 workers on site',
      equipment: 'Mixer, Vibrator, Tower crane',
      visitors: 'Owner walkthrough',
      issues: 'Pending inspection clearance',
      delays: 'None',
      safety: 'All clear',
      weather: 'Sunny 32C',
      addedAt: d.getTime(),
      isStress: true
    };
  }
  return siteLogs;
}

function buildChangeOrders(pid, startMonday) {
  const changeOrders = {};
  for (let i = 0; i < 6; i++) {
    changeOrders[`co${String(i + 1).padStart(2, '0')}`] = {
      desc: `Change order ${i + 1} - additional ${TRADES[i % 5]} scope for ${pid}`,
      reqBy: 'Client',
      date: iso(addDays(startMonday, i)),
      laborImpact: 15000 + i * 5000,
      materialsImpact: 8000 + i * 2000,
      status: ['pending', 'approved', 'rejected', 'approved', 'pending', 'approved'][i],
      createdAt: addDays(startMonday, i).getTime(),
      isStress: true
    };
  }
  return changeOrders;
}

function buildBillings(pid, startMonday) {
  const billings = {};
  for (let i = 0; i < 8; i++) {
    billings[`bill${String(i + 1).padStart(2, '0')}`] = {
      billingNo: `${SEED_PREFIX}-${pid.slice(-2)}-BILL-${String(i + 1).padStart(3, '0')}`,
      type: i === 0 ? 'downpayment' : 'progress',
      desc: `Billing tranche ${i + 1} for ${pid}`,
      date: iso(addDays(startMonday, i * 7)),
      amount: 250000 + i * 150000,
      receivable: 250000 + i * 150000,
      retention: 25000,
      deduction: 0,
      status: i < 5 ? 'approved' : 'pending',
      createdAt: addDays(startMonday, i * 7).getTime(),
      isStress: true
    };
  }
  return billings;
}

function buildCollections(pid, startMonday, billings) {
  const collections = {};
  Object.keys(billings).slice(0, 5).forEach((bid, i) => {
    collections[`col${String(i + 1).padStart(2, '0')}`] = {
      date: iso(addDays(startMonday, i * 7 + 2)),
      desc: `Payment received tranche ${i + 1}`,
      billingId: bid,
      amount: 200000 + i * 50000,
      unapplied: 0,
      retentionReleased: 0,
      reference: `${SEED_PREFIX}-REF-${i + 1}`,
      addedAt: addDays(startMonday, i * 7 + 2).getTime(),
      isStress: true
    };
  });
  return collections;
}

function buildAdvances(pid, workers, sat) {
  const advances = {};
  // released advances for a spread of workers (eligible for deduction)
  const ids = Object.keys(workers);
  ids.slice(0, 15).forEach((wid, i) => {
    const w = workers[wid];
    advances[wid] = {
      [`adv${String(i + 1).padStart(2, '0')}`]: {
        date: iso(addDays(sat, -(i % 5) - 1)),
        amount: 500 + i * 100,
        notes: `${SEED_PREFIX} advance`,
        weekKey: 'stress-week',
        workerName: w.name,
        trade: w.trade,
        status: i % 3 === 0 ? 'released' : i % 3 === 1 ? 'pending_approval' : 'closed',
        requestedBy: 'STRESS Boss',
        requestedByUid: BY,
        requestedAt: NOW,
        submittedAt: NOW,
        pendingApprovalAt: NOW,
        recordedBy: 'STRESS Boss',
        recordedByUid: BY,
        deducted: i % 3 === 0,
        deductedAmount: i % 3 === 0 ? 500 + i * 100 : 0,
        addedAt: NOW,
        addedBy: BY,
        isStress: true
      }
    };
  });
  return advances;
}

async function main() {
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  const sat = saturdayBefore(base); // most recent Saturday
  // Attendance must target the CURRENT week (the workspace's default
  // Monday..Sunday range) so payroll compile actually picks it up.
  const startMonday = new Date(base);
  startMonday.setDate(base.getDate() - ((base.getDay() + 6) % 7)); // this week's Monday
  startMonday.setHours(12, 0, 0, 0);

  // 1. Role user profiles (multi-user concurrency testing)
  //    boss + pm see all projects; apm1/apm2 see only assigned projects
  await put('users/dev-boss', {
    uid: 'dev-boss', name: 'DEV Boss', email: 'dev@acpm.local',
    displayName: 'DEV Boss', role: 'boss', status: 'active',
    projects: null, bossOf: null, position: 'Owner',
    createdAt: NOW, createdBy: 'dev-shell-seed', isStress: true
  });
  await put('users/dev-pm', {
    uid: 'dev-pm', name: 'DEV PM', email: 'pm@acpm.local',
    displayName: 'DEV PM', role: 'pm', status: 'active',
    projects: null, bossOf: null, position: 'Project Manager',
    createdAt: NOW, createdBy: 'dev-shell-seed', isStress: true
  });
  await put('users/dev-apm1', {
    uid: 'dev-apm1', name: 'DEV APM 1', email: 'apm1@acpm.local',
    displayName: 'DEV APM 1', role: 'apm', status: 'active',
    projects: { 'stress-p01': true, 'stress-p02': true },
    bossOf: null, position: 'Assoc. Project Manager',
    createdAt: NOW, createdBy: 'dev-shell-seed', isStress: true
  });
  await put('users/dev-apm2', {
    uid: 'dev-apm2', name: 'DEV APM 2', email: 'apm2@acpm.local',
    displayName: 'DEV APM 2', role: 'apm', status: 'active',
    projects: { 'stress-p01': true, 'stress-p02': true },
    bossOf: null, position: 'Assoc. Project Manager',
    createdAt: NOW, createdBy: 'dev-shell-seed', isStress: true
  });
  console.log('[stress] users/dev-boss, dev-pm, dev-apm1, dev-apm2 -> role profiles');

  const projectIds = [];
  for (let p = 1; p <= PROJECT_COUNT; p++) {
    const pid = `stress-p${String(p).padStart(2, '0')}`;
    projectIds.push(pid);

    const workers = buildWorkers(pid);
    const suppliers = buildSuppliers(pid);
    const purchaseOrders = buildPurchaseOrders(pid, suppliers, startMonday);
    const materials = buildMaterials(pid, suppliers, startMonday);
    const tasks = buildTasks(pid, startMonday);
    const siteLogs = buildSiteLogs(pid, startMonday);
    const changeOrders = buildChangeOrders(pid, startMonday);
    const billings = buildBillings(pid, startMonday);
    const collections = buildCollections(pid, startMonday, billings);
    const advances = buildAdvances(pid, workers, sat);

    // 12 weekly payroll logs for the 12 Saturdays BEFORE the current week
    // (the current week stays uncompiled so the compile/race path is real)
    const payrollLogs = {};
    for (let wk = 0; wk < PAYROLL_WEEKS; wk++) {
      const wkSat = addDays(sat, -7 * (wk + 1));
      payrollLogs[`pl${String(PAYROLL_WEEKS - wk).padStart(2, '0')}`] = buildPayrollLog(pid, workers, wkSat, wk);
    }

    // Trades: the real add-worker form populates its select from here
    const trades = {};
    TRADES.forEach((t, i) => {
      trades[`trade${i + 1}`] = {
        name: t,
        foremanName: `${SEED_PREFIX} ${t} Foreman`,
        paymentMethod: 'Bank',
        notes: `${SEED_PREFIX} trade`,
        status: 'active',
        addedAt: NOW,
        addedBy: BY
      };
    });

    // Attendance: current week for all 50 workers
    const currentWeekKey = `${iso(startMonday)}_${iso(addDays(startMonday, 6))}`;
    const attendance = attendanceFor(workers, startMonday, currentWeekKey);

    // Project node (single subtree PUT for speed)
    const project = {
      name: `${SEED_PREFIX} Project ${p} - ${TRADES[p % 5]} Focus Multi-Story Build`,
      status: 'active',
      address: `${SEED_PREFIX} address ${p}, Emulator City`,
      type: 'construction',
      laborBudget: 2000000 + p * 500000,
      materialBudget: 3500000 + p * 800000,
      laborSpent: 300000 + p * 40000,
      materialSpent: 500000 + p * 60000,
      progress: 15 + p * 3,
      startDate: iso(startMonday),
      endDate: iso(addDays(startMonday, 120)),
      createdAt: NOW,
      createdBy: BY,
      isStress: true,
      payrollConfig: {
        type: 'weekly', startDay: 1, overtimeThreshold: 8,
        nightDiffRate: 1.1, govDeductionsEnabled: false,
        sssEmployerPct: 8.5, philhealthPct: 3, pagibigEmployerAmt: 100
      },
      settings: { leader: `${BOSS_NAME} (stress)`, payMethod: 'Bank' },
      assignment: { apm: 'dev-boss', pm: 'dev-boss' },
      members: { 'dev-boss': { name: BOSS_NAME, role: 'boss' } },
      workers,
      trades,
      attendance,
      advances,
      payrollLogs,
      suppliers,
      purchaseOrders,
      materials,
      tasks,
      siteLogs,
      changeOrders,
      billings,
      collections,
      equipment: Array.from({ length: 8 }, (_, i) => ({
        name: `STRESS Mixer ${p}-${i + 1}`, type: i % 2 ? 'power' : 'heavy',
        rate: 1200 + i * 100, rateUnit: 'day', status: 'active',
        lastService: iso(startMonday), isStress: true
      })),
      compliance: Array.from({ length: 6 }, (_, i) => ({
        docType: 'Permit', name: `STRESS Permit ${p}-${i + 1}`, refNo: `SREF-${p}-${i + 1}`,
        expiryDate: iso(addDays(startMonday, 60 + i * 10)), status: 'active',
        link: '', notes: '', isStress: true
      })),
      defects: Array.from({ length: 6 }, (_, i) => ({
        title: `STRESS punch list ${p}-${i + 1} - ${TRADES[i % 5]} rectification`,
        location: `Area ${i + 1}`, severity: ['minor', 'major', 'critical'][i % 3],
        status: 'open', reportedBy: 'STRESS APM', createdAt: NOW, isStress: true
      })),
      sitelogSettings: { default: true }
    };
    await put(`projects/${pid}`, project);
    const workerCount = Object.keys(workers).length;
    const poCount = Object.keys(purchaseOrders).length;
    console.log(`[stress] projects/${pid} -> ${workerCount} workers, ${PAYROLL_WEEKS} payroll logs, ${poCount} POs, ${materials.length} materials, ${Object.keys(tasks).length} tasks, ${Object.keys(siteLogs).length} site logs, ${Object.keys(billings).length} billings`);
  }

  console.log(`\n[stress] SEED COMPLETE: ${PROJECT_COUNT} projects x ${WORKERS_PER_TRADE * TRADES.length} workers = ${PROJECT_COUNT * WORKERS_PER_TRADE * TRADES.length} workers, ${PROJECT_COUNT * PAYROLL_WEEKS} payroll logs, ${PROJECT_COUNT * MATERIAL_DAYS} POs`);
}

main().catch(error => {
  console.error('[stress] SEED FAILED:', error.message);
  process.exit(1);
});
