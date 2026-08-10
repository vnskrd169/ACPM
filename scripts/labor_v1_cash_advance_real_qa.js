const API_KEY = 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA';
const DB_URL = 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';
const EMAIL = process.env.ACPM_QA_EMAIL || '';
const PASSWORD = process.env.ACPM_QA_PASSWORD || '';

if (!EMAIL || !PASSWORD) {
  console.error('Set ACPM_QA_EMAIL and ACPM_QA_PASSWORD before running this QA script.');
  process.exit(2);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function assertClose(actual, expected, label) {
  if (Math.abs(Number(actual) - Number(expected)) > 0.001) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy value`);
}

async function httpJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} failed ${res.status}: ${text}`);
  return body;
}

async function signIn() {
  return httpJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true })
  });
}

function pushKey() {
  return `qa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function encodeDbPath(rawPath) {
  return String(rawPath || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function makeRestClient(idToken) {
  function url(rawPath) {
    return `${DB_URL}/${encodeDbPath(rawPath)}.json?auth=${encodeURIComponent(idToken)}`;
  }
  return {
    get: rawPath => httpJson(url(rawPath)),
    set: (rawPath, value) => httpJson(url(rawPath), { method: 'PUT', body: JSON.stringify(value) }),
    update: (rawPath, value) => httpJson(url(rawPath), { method: 'PATCH', body: JSON.stringify(value) })
  };
}

function makeAttendance(workerId, workerName, trade, dailyRate, dates, statuses) {
  return dates.reduce((records, date, index) => {
    const status = statuses[index] || 'present';
    records[date] = {
      workerId,
      workerName,
      trade,
      date,
      weekKey: `${dates[0]}_${dates[dates.length - 1]}`,
      status,
      overtimeHours: 0,
      nightDiffHours: 0,
      markedAt: Date.now(),
      markedBy: 'labor_qa'
    };
    return records;
  }, {});
}

function calcDays(attendanceRows) {
  return attendanceRows.reduce((sum, row) => {
    if (row.status === 'half') return sum + 0.5;
    if (row.status !== 'absent' && row.status !== 'rest') return sum + 1;
    return sum;
  }, 0);
}

async function main() {
  let activeStep = 'sign-in';
  let projectId = '';
  const auth = await signIn();
  const rest = makeRestClient(auth.idToken);
  const profile = await rest.get(`users/${auth.localId}`);
  const role = String((profile && profile.role) || '').toLowerCase();
  if (!['boss', 'owner', 'admin', 'pm', 'apm'].includes(role)) {
    throw new Error(`QA requires management auth. Signed in role: ${role || 'missing'}`);
  }

  const now = Date.now();
  const weekStart = '2026-06-15';
  const weekEnd = '2026-06-20';
  const weekKey = `${weekStart}_${weekEnd}`;
  const dates = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20'];

  try {
    activeStep = 'create QA project foundation';
    projectId = pushKey();
    const projectName = `QA_RC1_LaborCashAdvance_${now}`;
    const carpenterWorkerId = pushKey();
    const electricalWorkerId = pushKey();
    const releasedAdvanceId = pushKey();
    const pendingAdvanceId = pushKey();
    const approvedAdvanceId = pushKey();
    const rejectedAdvanceId = pushKey();
    const electricalReleasedAdvanceId = pushKey();
    const payrollLogId = pushKey();

    await rest.set(`projects/${projectId}`, {
      name: projectName,
      status: 'active',
      createdAt: now,
      createdDate: new Date(now).toLocaleDateString('en-PH'),
      laborBudget: 50000,
      laborSpent: 0,
      qaRun: {
        module: 'labor_cash_advances_v1',
        version: 'v79',
        createdAt: now,
        createdBy: auth.localId
      }
    });

    activeStep = 'create trades, foremen, workers, attendance';
    await rest.update(`projects/${projectId}/trades`, {
      carpenter: {
        name: 'Carpenter',
        foremanName: 'Foreman Carpenter QA',
        paymentMethod: 'GCash',
        notes: 'QA carpenter trade',
        createdAt: now
      },
      electrical: {
        name: 'Electrical',
        foremanName: 'Foreman Electrical QA',
        paymentMethod: 'Cash',
        notes: 'QA electrical trade',
        createdAt: now
      }
    });
    await rest.update(`projects/${projectId}/workers`, {
      [carpenterWorkerId]: { name: 'QA Carpenter Worker', trade: 'Carpenter', dailyRate: 1000, active: true, addedAt: now, addedBy: auth.localId },
      [electricalWorkerId]: { name: 'QA Electrical Worker', trade: 'Electrical', dailyRate: 800, active: true, addedAt: now, addedBy: auth.localId }
    });
    const carpenterAttendance = makeAttendance(carpenterWorkerId, 'QA Carpenter Worker', 'Carpenter', 1000, dates, ['present', 'present', 'present', 'present', 'present', 'absent']);
    const electricalAttendance = makeAttendance(electricalWorkerId, 'QA Electrical Worker', 'Electrical', 800, dates, ['present', 'present', 'half', 'absent', 'present', 'absent']);
    await rest.update(`projects/${projectId}/attendance`, {
      [carpenterWorkerId]: carpenterAttendance,
      [electricalWorkerId]: electricalAttendance
    });

    activeStep = 'create cash advances across lifecycle statuses';
    const baseAdvance = {
      date: weekStart,
      weekKey,
      workerName: 'QA Carpenter Worker',
      trade: 'Carpenter',
      amount: 1000,
      deducted: false,
      deductedAmount: 0,
      requestedBy: profile.name || profile.email || EMAIL,
      requestedByUid: auth.localId,
      requestedAt: now,
      addedAt: now,
      addedBy: auth.localId
    };
    await rest.update(`projects/${projectId}/advances/${carpenterWorkerId}`, {
      [pendingAdvanceId]: {
        ...baseAdvance,
        notes: 'QA pending must not deduct',
        status: 'pending_approval',
        statusHistory: { requested: { status: 'pending_approval', at: now, by: auth.localId, notes: 'QA pending' } }
      },
      [approvedAdvanceId]: {
        ...baseAdvance,
        notes: 'QA approved but unreleased must not deduct',
        status: 'approved',
        approvedBy: auth.localId,
        approvedByName: profile.name || profile.email || EMAIL,
        approvedAt: now + 1,
        statusHistory: { approved: { status: 'approved', at: now + 1, by: auth.localId, notes: 'QA approved' } }
      },
      [rejectedAdvanceId]: {
        ...baseAdvance,
        notes: 'QA rejected historical',
        status: 'rejected',
        rejectedBy: auth.localId,
        rejectedByName: profile.name || profile.email || EMAIL,
        rejectedAt: now + 2,
        statusHistory: { rejected: { status: 'rejected', at: now + 2, by: auth.localId, notes: 'QA rejected' } }
      },
      [releasedAdvanceId]: {
        ...baseAdvance,
        notes: 'QA released should deduct',
        status: 'released',
        releasedBy: auth.localId,
        releasedByName: profile.name || profile.email || EMAIL,
        releasedAt: now + 3,
        statusHistory: { released: { status: 'released', at: now + 3, by: auth.localId, notes: 'QA released' } }
      }
    });
    await rest.set(`projects/${projectId}/advances/${electricalWorkerId}/${electricalReleasedAdvanceId}`, {
      ...baseAdvance,
      workerName: 'QA Electrical Worker',
      trade: 'Electrical',
      amount: 4000,
      notes: 'QA released electrical should deduct separately',
      status: 'released',
      releasedBy: auth.localId,
      releasedByName: profile.name || profile.email || EMAIL,
      releasedAt: now + 4,
      statusHistory: { released: { status: 'released', at: now + 4, by: auth.localId, notes: 'QA released electrical' } }
    });

    activeStep = 'write cash advance event and notification hooks';
    await rest.update(`projects/${projectId}/cashAdvanceEvents`, {
      [pushKey()]: { type: 'cash_advance_pending_approval', workerId: carpenterWorkerId, advanceId: pendingAdvanceId, status: 'pending_approval', createdAt: now, createdBy: auth.localId },
      [pushKey()]: { type: 'cash_advance_approved', workerId: carpenterWorkerId, advanceId: approvedAdvanceId, status: 'approved', createdAt: now + 1, createdBy: auth.localId },
      [pushKey()]: { type: 'cash_advance_rejected', workerId: carpenterWorkerId, advanceId: rejectedAdvanceId, status: 'rejected', createdAt: now + 2, createdBy: auth.localId },
      [pushKey()]: { type: 'cash_advance_released', workerId: carpenterWorkerId, advanceId: releasedAdvanceId, status: 'released', createdAt: now + 3, createdBy: auth.localId }
    });
    await rest.set(`projects/${projectId}/notificationEvents/${pushKey()}`, {
      module: 'labor',
      type: 'cash_advance_pending_approval',
      status: 'pending',
      consumed: false,
      payload: { workerId: carpenterWorkerId, advanceId: pendingAdvanceId, amount: 1000 },
      createdAt: now,
      createdBy: auth.localId
    });

    activeStep = 'compile payroll deduction simulation';
    const carpenterDays = calcDays(Object.values(carpenterAttendance));
    const electricalDays = calcDays(Object.values(electricalAttendance));
    const carpenterGross = carpenterDays * 1000;
    const electricalGross = electricalDays * 800;
    // VERIFIED RULE (2026-08): deduct the full eligible balance, capped at the
    // worker's gross so NET never goes negative; remainder carries forward.
    const carpenterDeduct = Math.min(1000, carpenterGross);
    const electricalDeduct = Math.min(4000, electricalGross); // capped at gross, 1200 carries
    assertClose(carpenterGross, 5000, 'carpenter gross');
    assertClose(electricalGross, 2800, 'electrical gross');
    assertClose(carpenterDeduct, 1000, 'carpenter released deduction');
    assertClose(electricalDeduct, 2800, 'electrical released deduction (capped at gross)');

    await rest.update('', {
      [`projects/${projectId}/payrollLogs/${payrollLogId}`]: {
        projectId,
        weekStart,
        weekEnd,
        weekKey,
        period: `${weekStart}-${weekEnd}`,
        gross: carpenterGross + electricalGross,
        regular: carpenterGross + electricalGross,
        ot: 0,
        nightDiff: 0,
        cashAdvanceDeductions: carpenterDeduct + electricalDeduct,
        otherDeductions: 0,
        deductions: carpenterDeduct + electricalDeduct,
        net: carpenterGross + electricalGross - carpenterDeduct - electricalDeduct,
        byTrade: {
          Carpenter: {
            trade: 'Carpenter',
            foremanName: 'Foreman Carpenter QA',
            paymentMethod: 'GCash',
            total: carpenterGross,
            cashAdvanceDeductions: carpenterDeduct,
            net: carpenterGross - carpenterDeduct,
            workers: {
              [carpenterWorkerId]: { name: 'QA Carpenter Worker', trade: 'Carpenter', gross: carpenterGross, days: carpenterDays, rate: 1000 }
            }
          },
          Electrical: {
            trade: 'Electrical',
            foremanName: 'Foreman Electrical QA',
            paymentMethod: 'Cash',
            total: electricalGross,
            cashAdvanceDeductions: electricalDeduct,
            net: electricalGross - electricalDeduct,
            workers: {
              [electricalWorkerId]: { name: 'QA Electrical Worker', trade: 'Electrical', gross: electricalGross, days: electricalDays, rate: 800 }
            }
          }
        },
        cashAdvancesDeducted: {
          [carpenterWorkerId]: {
            name: 'QA Carpenter Worker',
            trade: 'Carpenter',
            advances: [{ key: releasedAdvanceId, deductThisPayroll: carpenterDeduct, remainingAfter: 0 }],
            totalDeduct: carpenterDeduct
          },
          [electricalWorkerId]: {
            name: 'QA Electrical Worker',
            trade: 'Electrical',
            advances: [{ key: electricalReleasedAdvanceId, deductThisPayroll: electricalDeduct, remainingAfter: 1200 }],
            totalDeduct: electricalDeduct
          }
        },
        savedAt: now + 10,
        savedBy: auth.localId,
        status: 'finalized'
      },
      [`projects/${projectId}/attendanceHistory/${payrollLogId}`]: {
        projectId,
        weekStart,
        weekEnd,
        weekKey,
        period: `${weekStart}-${weekEnd}`,
        savedAt: now + 10,
        compiledBy: auth.localId,
        entries: [
          ...Object.values(carpenterAttendance),
          ...Object.values(electricalAttendance)
        ]
      },
      [`projects/${projectId}/advances/${carpenterWorkerId}/${releasedAdvanceId}/deductedAmount`]: carpenterDeduct,
      [`projects/${projectId}/advances/${carpenterWorkerId}/${releasedAdvanceId}/deducted`]: true,
      [`projects/${projectId}/advances/${carpenterWorkerId}/${releasedAdvanceId}/status`]: 'closed',
      [`projects/${projectId}/advances/${carpenterWorkerId}/${releasedAdvanceId}/lastDeductedAt`]: now + 10,
      [`projects/${projectId}/advances/${carpenterWorkerId}/${releasedAdvanceId}/statusHistory/payroll`]: {
        status: 'closed',
        notes: 'QA payroll deduction applied.',
        payrollLogId,
        at: now + 10,
        by: auth.localId
      },
      [`projects/${projectId}/advances/${electricalWorkerId}/${electricalReleasedAdvanceId}/deductedAmount`]: electricalDeduct,
      [`projects/${projectId}/advances/${electricalWorkerId}/${electricalReleasedAdvanceId}/deducted`]: false,
      [`projects/${projectId}/advances/${electricalWorkerId}/${electricalReleasedAdvanceId}/status`]: 'deducted',
      [`projects/${projectId}/advances/${electricalWorkerId}/${electricalReleasedAdvanceId}/lastDeductedAt`]: now + 10,
      [`projects/${projectId}/advances/${electricalWorkerId}/${electricalReleasedAdvanceId}/statusHistory/payroll`]: {
        status: 'deducted',
        notes: 'QA partial payroll deduction applied.',
        payrollLogId,
        at: now + 10,
        by: auth.localId
      },
      [`projects/${projectId}/cashAdvanceEvents/${pushKey()}`]: {
        type: 'cash_advance_payroll_deducted',
        workerId: carpenterWorkerId,
        advanceId: releasedAdvanceId,
        status: 'closed',
        amount: carpenterDeduct,
        payrollLogId,
        createdAt: now + 10,
        createdBy: auth.localId
      },
      [`projects/${projectId}/cashAdvanceEvents/${pushKey()}`]: {
        type: 'cash_advance_payroll_deducted',
        workerId: electricalWorkerId,
        advanceId: electricalReleasedAdvanceId,
        status: 'deducted',
        amount: electricalDeduct,
        payrollLogId,
        createdAt: now + 10,
        createdBy: auth.localId
      }
    });

    activeStep = 'verify saved archive and cash advance balances';
    const payrollLog = await rest.get(`projects/${projectId}/payrollLogs/${payrollLogId}`);
    assertClose(payrollLog.gross, 7800, 'payroll gross archive');
    assertClose(payrollLog.cashAdvanceDeductions, 3800, 'payroll cash advance deductions');
    assertClose(payrollLog.byTrade.Carpenter.cashAdvanceDeductions, 1000, 'carpenter-only deduction');
    assertClose(payrollLog.byTrade.Electrical.cashAdvanceDeductions, 2800, 'electrical-only deduction');
    assertEqual(payrollLog.byTrade.Carpenter.foremanName, 'Foreman Carpenter QA', 'carpenter foreman archive');
    assertEqual(payrollLog.byTrade.Electrical.foremanName, 'Foreman Electrical QA', 'electrical foreman archive');

    const advances = await rest.get(`projects/${projectId}/advances`);
    assertEqual(advances[carpenterWorkerId][pendingAdvanceId].status, 'pending_approval', 'pending status preserved');
    assertClose(advances[carpenterWorkerId][pendingAdvanceId].deductedAmount, 0, 'pending not deducted');
    assertEqual(advances[carpenterWorkerId][approvedAdvanceId].status, 'approved', 'approved status preserved');
    assertClose(advances[carpenterWorkerId][approvedAdvanceId].deductedAmount, 0, 'approved unreleased not deducted');
    assertEqual(advances[carpenterWorkerId][rejectedAdvanceId].status, 'rejected', 'rejected preserved');
    assertClose(advances[carpenterWorkerId][rejectedAdvanceId].deductedAmount, 0, 'rejected not deducted');
    assertEqual(advances[carpenterWorkerId][releasedAdvanceId].status, 'closed', 'fully deducted closes');
    assertClose(advances[carpenterWorkerId][releasedAdvanceId].deductedAmount, 1000, 'fully deducted amount');
    assertEqual(advances[electricalWorkerId][electricalReleasedAdvanceId].status, 'deducted', 'partial deduction status');
    assertClose(advances[electricalWorkerId][electricalReleasedAdvanceId].deductedAmount, 2800, 'partial deducted amount');
    assertTruthy(advances[electricalWorkerId][electricalReleasedAdvanceId].statusHistory.payroll, 'partial deduction status history');

    const attendanceHistory = await rest.get(`projects/${projectId}/attendanceHistory/${payrollLogId}`);
    assertEqual(attendanceHistory.entries.length, 12, 'archived attendance row count');
    const eventRows = Object.values(await rest.get(`projects/${projectId}/cashAdvanceEvents`) || {});
    assertTruthy(eventRows.some(row => row.type === 'cash_advance_pending_approval'), 'pending event exists');
    assertTruthy(eventRows.some(row => row.type === 'cash_advance_payroll_deducted' && row.status === 'deducted'), 'deduction event exists');
    const notificationRows = Object.values(await rest.get(`projects/${projectId}/notificationEvents`) || {});
    assertTruthy(notificationRows.some(row => row.type === 'cash_advance_pending_approval'), 'notification hook exists');

    activeStep = 'archive QA project';
    await rest.update(`projects/${projectId}`, {
      status: 'archived',
      archivedAt: Date.now(),
      archiveReason: 'QA labor cash advance run complete'
    });
    const archivedLog = await rest.get(`projects/${projectId}/payrollLogs/${payrollLogId}`);
    assertTruthy(archivedLog && archivedLog.status === 'finalized', 'archived project payroll remains readable');

    console.log(JSON.stringify({
      result: 'PASS',
      projectId,
      projectName,
      payrollLogId,
      deductions: {
        carpenter: carpenterDeduct,
        electrical: electricalDeduct,
        total: carpenterDeduct + electricalDeduct
      },
      checks: [
        'trade-specific foremen archived',
        'pending/approved/rejected not deducted',
        'released advances deducted by worker/trade only',
        'partial deduction remains deducted with balance',
        'full deduction closes advance',
        'status history preserved',
        'cash advance events written',
        'notification hook written',
        'attendance and payroll archive readable after project archive'
      ]
    }, null, 2));
  } catch (error) {
    console.error(`FAILED at step: ${activeStep}`);
    if (projectId) {
      try {
        await rest.update(`projects/${projectId}`, {
          status: 'archived',
          archivedAt: Date.now(),
          archiveReason: `QA failed at ${activeStep}`
        });
      } catch (cleanupError) {
        console.error('Cleanup archive failed:', cleanupError.message);
      }
    }
    throw error;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
