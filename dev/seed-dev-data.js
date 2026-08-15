// ============================================================
//  ACPM LOCAL DEV SHELL — emulator seed
// ============================================================
//  Seeds the LOCAL database emulator (port 18300) with:
//    - users/dev-boss        -> boss profile (role boss, active)
//    - projects/dev-pilot    -> demo project with payroll config
//    - workers               -> 3 workers (rates 1000 / 850 / 1200)
//    - attendance            -> current Mon-Fri attendance, status present
//    - advances              -> released (eligible), pending_approval,
//                               rejected, closed (not eligible) records
//    - payrollLogs           -> a finalized prior-week log (snapshot rates)
//                               so RFP / archive snapshot can be exercised
//
//  Run AFTER starting the emulator:
//    npx firebase emulators:start --config dev/firebase.dev.json --project acpm-project-system-qa
//    node dev/seed-dev-data.js
//
//  All data is clearly labeled DEV and lives only in the local emulator.
//  It is never written to the real staging/production project.
// ============================================================

'use strict';

const EMULATOR = process.env.ACPM_DEV_DB_URL || 'http://127.0.0.1:18300';
// Must match the namespace the SDK derives from the app databaseURL
// (https://acpm-project-system-qa-default-rtdb.asia-southeast1.firebasedatabase.app)
const NS = 'acpm-project-system-qa-default-rtdb';

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

// Current Monday (week start) and week end (Sunday)
const today = new Date();
today.setHours(12, 0, 0, 0);
const dayOfWeek = today.getDay(); // 0 = Sunday
const monday = new Date(today);
monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
const sunday = new Date(monday);
sunday.setDate(monday.getDate() + 6);
const weekStart = iso(monday);
const weekEnd = iso(sunday);
const weekKey = `${weekStart}_${weekEnd}`;

// Prior week (for archived payroll log)
const prevStart = new Date(monday);
prevStart.setDate(monday.getDate() - 7);
const prevEnd = new Date(prevStart);
prevEnd.setDate(prevStart.getDate() + 6);
const prevWeekKey = `${iso(prevStart)}_${iso(prevEnd)}`;

const NOW = Date.now();
const BY = 'dev-boss';

function attendanceFor(workerId, startDate, status = 'present') {
  const out = {};
  for (let i = 0; i < 5; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const dayIso = iso(d);
    out[dayIso] = {
      workerId,
      date: dayIso,
      status,
      weekKey,
      regularHours: 8,
      overtimeHours: 0,
      nightDiffHours: 0,
      paidHours: 8,
      multiplier: 1,
      notes: 'DEV seed data',
      markedAt: NOW,
      markedBy: BY
    };
  }
  return out;
}

function advance(key, wid, name, trade, amount, date, status, extra = {}) {
  return {
    [key]: {
      date,
      amount,
      notes: 'DEV seed advance',
      weekKey,
      workerName: name,
      trade,
      status,
      requestedBy: 'DEV Boss',
      requestedByUid: BY,
      requestedAt: NOW,
      submittedAt: NOW,
      pendingApprovalAt: NOW,
      statusHistory: {
        seeded: { status, notes: 'Seeded by dev shell', at: NOW, by: BY, byName: 'DEV Boss' }
      },
      recordedBy: 'DEV Boss',
      recordedByUid: BY,
      deducted: !!extra.deducted,
      deductedAmount: extra.deductedAmount || 0,
      addedAt: NOW,
      addedBy: BY,
      ...extra
    }
  };
}

async function main() {
  console.log(`[seed] target ${EMULATOR} ns=${NS}`);
  console.log(`[seed] current week ${weekKey} | prior ${prevWeekKey}`);

  // 1. Boss user profile
  await put('users/dev-boss', {
    uid: 'dev-boss',
    name: 'DEV Boss',
    email: 'dev@acpm.local',
    role: 'boss',
    status: 'active',
    projects: null,
    bossOf: null,
    createdAt: NOW,
    createdBy: 'dev-shell-seed'
  });
  console.log('[seed] users/dev-boss -> boss profile');

  // 2. Demo project + payroll config
  await put('projects/dev-pilot', {
    name: 'DEV Pilot Site (emulator only)',
    status: 'active',
    address: 'Local Emulator — dev data',
    type: 'construction',
    startDate: weekStart,
    endDate: weekEnd,
    createdAt: NOW,
    createdBy: BY
  });
  await put('projects/dev-pilot/payrollConfig', {
    type: 'weekly',
    startDay: 1,
    overtimeThreshold: 8,
    nightDiffRate: 1.1,
    govDeductionsEnabled: false,
    sssEmployerPct: 8.5,
    philhealthPct: 3,
    pagibigEmployerAmt: 100
  });
  console.log('[seed] projects/dev-pilot + payrollConfig');

  // 3. Workers
  const workers = {
    w1: { name: 'DEV Juan Dela Cruz', trade: 'Carpentry', dailyRate: 1000, status: 'active', addedAt: NOW, addedBy: BY },
    w2: { name: 'DEV Maria Santos', trade: 'Masonry', dailyRate: 850, status: 'active', addedAt: NOW, addedBy: BY },
    w3: { name: 'DEV Pedro Reyes', trade: 'Electrical', dailyRate: 1200, status: 'active', addedAt: NOW, addedBy: BY }
  };
  await put('projects/dev-pilot/workers', workers);
  console.log('[seed] workers w1(1000) w2(850) w3(1200)');

  // 4. Attendance for current week (Mon-Fri present)
  await put('projects/dev-pilot/attendance/w1', attendanceFor('w1', monday));
  await put('projects/dev-pilot/attendance/w2', attendanceFor('w2', monday));
  await put('projects/dev-pilot/attendance/w3', attendanceFor('w3', monday));
  console.log('[seed] attendance Mon-Fri present for all workers');

  // 5. Advances — exercise every lifecycle branch:
  //    w1: released 1500 (older) + released 2000 (newer) -> oldest-first test
  //    w1: closed 500  (never deducted again)
  //    w2: pending_approval 3000 (NOT eligible)
  //    w2: rejected 1000 (NOT eligible)
  //    w3: released 5000 (eligible; gross cap 5x1200=6000 -> deducts 5000)
  const dayOffset = (i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return iso(d);
  };
  const w1Advances = {
    ...advance('a-old', 'w1', workers.w1.name, workers.w1.trade, 1500, dayOffset(0), 'released', { releasedAt: NOW, releasedBy: BY, releasedByName: 'DEV Boss' }),
    ...advance('a-new', 'w1', workers.w1.name, workers.w1.trade, 2000, dayOffset(2), 'released', { releasedAt: NOW, releasedBy: BY, releasedByName: 'DEV Boss' }),
    ...advance('a-closed', 'w1', workers.w1.name, workers.w1.trade, 500, dayOffset(1), 'closed', { deducted: true, deductedAmount: 500, closedAt: NOW, closedBy: BY })
  };
  const w2Advances = {
    ...advance('a-pending', 'w2', workers.w2.name, workers.w2.trade, 3000, dayOffset(3), 'pending_approval', { pendingApprovalAt: NOW }),
    ...advance('a-rejected', 'w2', workers.w2.name, workers.w2.trade, 1000, dayOffset(4), 'rejected', { rejectedAt: NOW, rejectedBy: BY, rejectionNotes: 'DEV seed' })
  };
  const w3Advances = {
    ...advance('a-big', 'w3', workers.w3.name, workers.w3.trade, 5000, dayOffset(5), 'released', { releasedAt: NOW, releasedBy: BY, releasedByName: 'DEV Boss' })
  };
  await put('projects/dev-pilot/advances/w1', w1Advances);
  await put('projects/dev-pilot/advances/w2', w2Advances);
  await put('projects/dev-pilot/advances/w3', w3Advances);
  console.log('[seed] advances: w1 released 1500+2000 & closed 500; w2 pending 3000 & rejected 1000; w3 released 5000');

  // 6. Finalized prior-week payroll log with SNAPSHOT rate 850 for w1
  //    (current rate is 1000 — proves archived payroll/RFP never drift)
  const byTrade = {
    Carpentry: {
      trade: 'Carpentry',
      foremanName: 'DEV Foreman A',
      paymentMethod: 'Bank',
      notes: 'DEV archived log',
      cashAdvanceDeductions: 500,
      total: 4250,
      net: 3750,
      workers: {
        w1: { name: workers.w1.name, rate: 850, days: 5, gross: 4250 }
      }
    }
  };
  const cashAdvancesDeducted = {
    w1: { totalDeduct: 500 }
  };
  await put('projects/dev-pilot/payrollLogs/prior-week-finalized', {
    projectId: 'dev-pilot',
    weekStart: iso(prevStart),
    weekEnd: iso(prevEnd),
    weekKey: prevWeekKey,
    period: `${iso(prevStart)}–${iso(prevEnd)}`,
    gross: 4250,
    regular: 4250,
    ot: 0,
    nightDiff: 0,
    cashAdvanceDeductions: 500,
    otherDeductions: 0,
    deductions: 500,
    net: 3750,
    byTrade,
    workerDetails: { w1: { name: workers.w1.name, rate: 850, days: 5, gross: 4250 } },
    attendance: attendanceFor('w1', prevStart),
    cashAdvancesDeducted,
    savedAt: NOW - 86400000,
    savedDate: new Date(NOW - 86400000).toLocaleDateString('en-PH'),
    savedBy: BY,
    status: 'finalized'
  });
  console.log('[seed] payrollLogs/prior-week-finalized (snapshot rate 850, NET 3750)');

  // 7. Cash advance events log
  await put('projects/dev-pilot/cashAdvanceEvents/seeded-event', {
    type: 'cash_advance_released',
    workerId: 'w1',
    advanceId: 'a-new',
    status: 'released',
    notes: 'DEV seed event',
    amount: 2000,
    createdAt: NOW,
    createdBy: BY,
    createdByName: 'DEV Boss'
  });
  console.log('[seed] cashAdvanceEvents/seeded-event');

  console.log('\n[seed] DONE. Open dev-shell.html (or any page via the launcher session flag) and open project "dev-pilot".');
  console.log(`[seed] Expected current-week: w1 gross 5000 - CA 3500 = 1500 net; w2 gross 4250 - CA 0 (pending/rejected) = 4250 net; w3 gross 6000 - CA 5000 = 1000 net.`);
}

main().catch((e) => {
  console.error('[seed] FAILED:', e && e.message || e);
  process.exit(1);
});
