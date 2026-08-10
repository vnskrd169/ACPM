import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

// NOTE ON RTDB SEMANTICS (verified against the emulator):
//  • `data.val() === newData.val()` performs REFERENCE (not deep) equality, so
//    whole-object immutability cannot be expressed with `===`.
//  • A write granted by an ANCESTOR `.write` rule short-circuits child rules,
//    so per-child delete/role restrictions cannot override the project-level
//    write grant without restructuring every project subnode.
// Therefore the deployed rules enforce FINANCIAL PROTECTION via `.validate`
// field-level equality on the money-critical fields (which RTDB evaluates
// reliably), while hard-delete and APM-role restrictions are enforced at the
// application layer (labor.js: no delete functions exist for payroll logs /
// advances / workers; canFinalizePayroll() gates who may persist payroll).
const PROJECT_ID = 'acpm-financial-rules-test';
const ACTIVE_PROJECT = 'project-finance';
const USERS = {
  boss: 'boss-user',
  pm: 'pm-user',
  apm: 'apm-user',
};

let testEnv: RulesTestEnvironment;

function profile(role: string, status = 'active', projects: Record<string, boolean> = {}) {
  return { displayName: `${role} test`, email: `${role}@lebuild.test`, position: role.toUpperCase(), role, status, projects, profileComplete: true };
}

function project(status = 'active') {
  return { name: 'Financial Rules Project', status, createdAt: 1785254400000, createdDate: '2026-07-29', laborBudget: 100000, materialBudget: 100000 };
}

function payrollLog(overrides = {}) {
  return {
    projectId: ACTIVE_PROJECT,
    weekStart: '2026-06-15',
    weekEnd: '2026-06-20',
    weekKey: '2026-06-15_2026-06-20',
    period: '2026-06-15–2026-06-20',
    gross: 5000,
    regular: 5000,
    ot: 0,
    nightDiff: 0,
    cashAdvanceDeductions: 2000,
    otherDeductions: 0,
    deductions: 2000,
    net: 3000,
    byTrade: {},
    workerDetails: {},
    attendance: [],
    cashAdvancesDeducted: {},
    savedAt: 1785254400000,
    savedDate: '2026-07-29',
    savedBy: USERS.pm,
    status: 'finalized',
    ...overrides,
  };
}

function attendanceHistory(overrides = {}) {
  return {
    period: '2026-06-15–2026-06-20',
    projectId: ACTIVE_PROJECT,
    weekStart: '2026-06-15',
    weekEnd: '2026-06-20',
    weekKey: '2026-06-15_2026-06-20',
    savedAt: 1785254400000,
    compiledBy: USERS.pm,
    entries: [],
    ...overrides,
  };
}

function cashAdvanceEvent(overrides = {}) {
  return {
    type: 'cash_advance_released',
    workerId: 'worker-1',
    advanceId: 'adv-1',
    status: 'released',
    amount: 1000,
    createdAt: 1785254400000,
    createdBy: USERS.pm,
    ...overrides,
  };
}

function advance(status: string, overrides = {}) {
  return {
    date: '2026-06-15',
    amount: 2000,
    workerName: 'Worker 1',
    trade: 'Carpenter',
    status,
    deducted: false,
    deductedAmount: 0,
    requestedBy: 'PM Test',
    requestedAt: 1785254400000,
    addedAt: 1785254400000,
    ...overrides,
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {
      rules: readFileSync('database.rules.json', 'utf8'),
      host: '127.0.0.1',
      port: 18200,
    },
  });

  await testEnv.clearDatabase();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.database();
    await db.ref('/users').set({
      [USERS.boss]: profile('boss'),
      [USERS.pm]: profile('pm'),
      [USERS.apm]: profile('apm', 'active', { [ACTIVE_PROJECT]: true }),
    });
    await db.ref(`/projects/${ACTIVE_PROJECT}`).set(project());
    // Seed a finalized payroll record so immutability is proven on an existing record.
    await db.ref(`/projects/${ACTIVE_PROJECT}/payrollLogs/log-1`).set(payrollLog());
    await db.ref(`/projects/${ACTIVE_PROJECT}/attendanceHistory/hist-1`).set(attendanceHistory());
    await db.ref(`/projects/${ACTIVE_PROJECT}/cashAdvanceEvents/evt-1`).set(cashAdvanceEvent());
    await db.ref(`/projects/${ACTIVE_PROJECT}/advances/worker-1/adv-1`).set(advance('released'));
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('Financial record protection (production database.rules.json)', () => {
  describe('payrollLogs — released payroll money fields are frozen', () => {
    it('PM and boss can create a new payroll log', async () => {
      const dbPm = testEnv.authenticatedContext(USERS.pm).database();
      await assertSucceeds(dbPm.ref(`projects/${ACTIVE_PROJECT}/payrollLogs/log-pm`).set(payrollLog({ weekKey: '2026-06-22_2026-06-27' })));
      const dbBoss = testEnv.authenticatedContext(USERS.boss).database();
      await assertSucceeds(dbBoss.ref(`projects/${ACTIVE_PROJECT}/payrollLogs/log-boss`).set(payrollLog({ weekKey: '2026-06-29_2026-07-04' })));
    });
    it('net, gross, deductions, and weekKey of an existing log cannot be modified (no drift)', async () => {
      const db = testEnv.authenticatedContext(USERS.boss).database();
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/payrollLogs/log-1`).update({ net: 9999 }));
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/payrollLogs/log-1`).update({ gross: 9999 }));
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/payrollLogs/log-1`).update({ cashAdvanceDeductions: 0 }));
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/payrollLogs/log-1`).update({ weekKey: 'hacked' }));
    });
    it('non-financial metadata on a log may be corrected without touching money fields', async () => {
      const db = testEnv.authenticatedContext(USERS.boss).database();
      await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/payrollLogs/log-1`).update({ notes: 'audited' }));
    });
  });

  describe('attendanceHistory — period identity is frozen', () => {
    it('weekKey and savedAt cannot be modified', async () => {
      const db = testEnv.authenticatedContext(USERS.pm).database();
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/attendanceHistory/hist-1`).update({ weekKey: 'hacked' }));
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/attendanceHistory/hist-1`).update({ savedAt: 1 }));
    });
  });

  describe('cashAdvanceEvents — event records cannot be tampered with', () => {
    it('any project role can append a new event', async () => {
      const db = testEnv.authenticatedContext(USERS.apm).database();
      await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/cashAdvanceEvents/evt-new`).set(cashAdvanceEvent({ type: 'cash_advance_pending_approval' })));
    });
    it('an existing event cannot change its type, amount, or advance reference', async () => {
      const db = testEnv.authenticatedContext(USERS.boss).database();
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/cashAdvanceEvents/evt-1`).update({ amount: 9999 }));
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/cashAdvanceEvents/evt-1`).update({ type: 'cash_advance_closed' }));
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/cashAdvanceEvents/evt-1`).update({ advanceId: 'other-adv' }));
    });
  });

  describe('advances — financial values validated', () => {
    it('APM can create an advance request', async () => {
      const db = testEnv.authenticatedContext(USERS.apm).database();
      await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/advances/worker-1/adv-new`).set(advance('pending_approval')));
    });
    it('negative amount rejected', async () => {
      const db = testEnv.authenticatedContext(USERS.pm).database();
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/advances/worker-1/adv-bad`).set(advance('pending_approval', { amount: -500 })));
    });
    it('negative deductedAmount rejected', async () => {
      const db = testEnv.authenticatedContext(USERS.pm).database();
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/advances/worker-1/adv-1`).update({ deductedAmount: -1 }));
    });
    it('legitimate deduction update (non-negative) succeeds', async () => {
      const db = testEnv.authenticatedContext(USERS.pm).database();
      await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/advances/worker-1/adv-1`).update({ deductedAmount: 2000, deducted: true, status: 'closed' }));
    });
  });

  describe('ordinary project access preserved', () => {
    it('APM can still write project data (notes, trades, attendance) in an assigned project', async () => {
      const db = testEnv.authenticatedContext(USERS.apm).database();
      await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/notes`).set({ text: 'site note', updatedBy: USERS.apm, updatedAt: 1785254404000 }));
      await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/trades/carpenter`).set({ name: 'Carpenter', createdAt: 1785254400000 }));
      await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/attendance/worker-1/2026-06-15`).set({ workerId: 'worker-1', date: '2026-06-15', status: 'present', weekKey: '2026-06-15_2026-06-20', markedAt: 1785254400000, markedBy: USERS.apm }));
    });
    it('APM still cannot change project lifecycle status', async () => {
      const db = testEnv.authenticatedContext(USERS.apm).database();
      await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/status`).set('completed'));
    });
    it('PM can complete and reopen a project', async () => {
      const db = testEnv.authenticatedContext(USERS.pm).database();
      await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/status`).set('completed'));
      await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/status`).set('active'));
    });
  });
});
