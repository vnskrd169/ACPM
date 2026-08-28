import { afterAll, beforeAll, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { get, ref, set } from 'firebase/database';

const PROJECT_ID = 'acpm-ai-security-test';
const AI_SERVICE_UID = 'acpm-ai-service';
const TEST_PROJECT = 'project-ai-context';
const USERS = {
  boss: 'ai-test-boss',
  owner: 'ai-test-owner',
  admin: 'ai-test-admin',
  pm: 'ai-test-pm',
  apm: 'ai-test-apm',
  inactive: 'ai-test-inactive'
};

const AI_OUTPUT_COLLECTIONS = [
  'agents',
  'runtimeStatus',
  'events',
  'runs',
  'findings',
  'recommendations',
  'decisions'
];

const AI_SERVICE_WRITE_COLLECTIONS = [
  'config',
  ...AI_OUTPUT_COLLECTIONS,
  'conditions',
  'idempotency'
];

const CONTEXT_COLLECTIONS = [
  'tasks',
  'purchaseOrders',
  'deliveries',
  'inventory',
  'materialMovements',
  'purchaseRequests',
  'siteLogs',
  'punchList',
  'pmosIssues'
];

let testEnv: RulesTestEnvironment;

function profile(role: string, status = 'active') {
  return {
    displayName: `${role} AI test`,
    email: `${role}.ai@lebuild.test`,
    role,
    status,
    projects: { [TEST_PROJECT]: true },
    profileComplete: true
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {
      rules: readFileSync('database.rules.json', 'utf8'),
      host: '127.0.0.1',
      port: 18200
    }
  });

  await testEnv.clearDatabase();
  await testEnv.withSecurityRulesDisabled(async context => {
    await set(ref(context.database()), {
      users: {
        [USERS.boss]: profile('boss'),
        [USERS.owner]: profile('owner'),
        [USERS.admin]: profile('admin'),
        [USERS.pm]: profile('pm'),
        [USERS.apm]: profile('apm'),
        [USERS.inactive]: profile('pm', 'suspended')
      },
      accessRequests: {
        [AI_SERVICE_UID]: {
          uid: AI_SERVICE_UID,
          email: 'service@internal.invalid',
          fullName: 'Reserved service identity',
          position: 'service',
          requestedAt: 1,
          status: 'pending',
          provider: 'service'
        }
      },
      projects: {
        [TEST_PROJECT]: {
          name: 'AI Context Project',
          status: 'active',
          createdAt: 1785254400000,
          tasks: { task1: { title: 'Inspect slab', status: 'pending' } },
          purchaseOrders: { po1: { poNo: 'PO-1', supplierName: 'Safe Supply' } },
          deliveries: { delivery1: { poId: 'po1', status: 'pending' } },
          inventory: { item1: { description: 'Cement', qtyOnHand: 20 } },
          materialMovements: { movement1: { type: 'receipt', createdAt: 1 } },
          purchaseRequests: { request1: { requestNo: 'PR-1', status: 'approved' } },
          siteLogs: { log1: { date: '2026-08-29', status: 'submitted' } },
          punchList: { punch1: { issue: 'Patch wall', status: 'open' } },
          pmosIssues: { issue1: { issue: 'Local fallback', status: 'open' } },
          siteLogEvents: { secretEvent: { note: 'not V0.1 context' } },
          billings: { billing1: { amount: 500000 } },
          collections: { collection1: { amount: 100000 } },
          payrollLogs: { payroll1: { gross: 10000 } },
          cashAdvanceEvents: { cash1: { amount: 5000 } },
          changeOrders: { change1: { amount: 25000 } }
        }
      },
      pmosIssues: {
        rootIssue: {
          projectId: TEST_PROJECT,
          issue: 'Root issue fallback',
          status: 'Open'
        }
      },
      suppliers: {
        supplier1: {
          name: 'Safe Supply',
          specialty: 'Concrete',
          status: 'active',
          bankName: 'Sensitive Bank',
          accountNumber: '123456789'
        }
      },
      notifications: {
        [AI_SERVICE_UID]: {
          privateNotice: { message: 'not AI context' }
        }
      },
      sessions: {
        [AI_SERVICE_UID]: { refreshToken: 'not-readable' }
      },
      ai: {
        config: { enabled: false },
        agents: { planning: { status: 'disabled' } },
        runtimeStatus: { state: 'disabled' },
        conditions: { internal1: { matched: false } },
        events: { event1: { type: 'task_overdue' } },
        runs: { run1: { status: 'disabled' } },
        findings: { run1: { planning: { summary: 'Sanitized finding' } } },
        recommendations: { recommendation1: { summary: 'Sanitized recommendation' } },
        decisions: { decision1: { status: 'pending' } },
        idempotency: { key1: { runId: 'run1' } }
      }
    });
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('ACPM AI service isolation', () => {
  it('allows the service to write every explicit AI namespace collection', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    for (const collection of AI_SERVICE_WRITE_COLLECTIONS) {
      await assertSucceeds(set(ref(db, `ai/${collection}/phase2-proof`), {
        source: 'emulator',
        createdAt: 1785254400000
      }));
    }
  });

  it('denies the service from unknown AI children and bulk namespace writes', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    await assertFails(set(ref(db, 'ai/unknown/record1'), { value: true }));
    await assertFails(set(ref(db, 'ai'), { events: { event2: { value: true } } }));
  });

  it('allows only the intended V0.1 business context reads', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    for (const collection of CONTEXT_COLLECTIONS) {
      await assertSucceeds(get(ref(db, `projects/${TEST_PROJECT}/${collection}`)));
    }
    await assertSucceeds(get(ref(db, 'pmosIssues')));
  });

  it('denies project metadata, unlisted descendants, and broad project reads', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    await assertFails(get(ref(db, 'projects')));
    await assertFails(get(ref(db, `projects/${TEST_PROJECT}`)));
    await assertFails(get(ref(db, `projects/${TEST_PROJECT}/name`)));
    await assertFails(get(ref(db, `projects/${TEST_PROJECT}/siteLogEvents`)));
  });

  it('denies payroll, cash advance, billing, collection, payment, user, auth, and supplier reads', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    const deniedPaths = [
      `projects/${TEST_PROJECT}/payrollLogs`,
      `projects/${TEST_PROJECT}/cashAdvanceEvents`,
      `projects/${TEST_PROJECT}/billings`,
      `projects/${TEST_PROJECT}/collections`,
      `projects/${TEST_PROJECT}/payments`,
      'users',
      `users/${USERS.boss}`,
      `accessRequests/${AI_SERVICE_UID}`,
      `sessions/${AI_SERVICE_UID}`,
      'suppliers',
      'suppliers/supplier1',
      'suppliers/supplier1/accountNumber',
      `notifications/${AI_SERVICE_UID}`
    ];
    for (const path of deniedPaths) {
      await assertFails(get(ref(db, path)));
    }
  });

  it('denies every tested business, user, notification, and audit write', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    const deniedWrites: Array<[string, unknown]> = [
      [`projects/${TEST_PROJECT}/tasks/blocked`, { title: 'Blocked', status: 'pending', createdAt: 1, createdBy: AI_SERVICE_UID }],
      [`projects/${TEST_PROJECT}/purchaseOrders/blocked`, { poNo: 'PO-BLOCKED' }],
      [`projects/${TEST_PROJECT}/deliveries/blocked`, { poId: 'po1' }],
      [`projects/${TEST_PROJECT}/inventory/blocked`, { qtyOnHand: 999 }],
      [`projects/${TEST_PROJECT}/billings/blocked`, { amount: 1 }],
      [`projects/${TEST_PROJECT}/payrollLogs/blocked`, { gross: 1 }],
      [`projects/${TEST_PROJECT}/cashAdvanceEvents/blocked`, { amount: 1 }],
      [`projects/${TEST_PROJECT}/changeOrders/blocked`, { amount: 1 }],
      ['pmosIssues/blocked', { projectId: TEST_PROJECT, issue: 'Blocked' }],
      ['suppliers/blocked', { name: 'Blocked Supplier' }],
      [`users/${AI_SERVICE_UID}`, profile('boss')],
      [`accessRequests/${AI_SERVICE_UID}`, { uid: AI_SERVICE_UID, status: 'pending' }],
      [`notifications/${AI_SERVICE_UID}/blocked`, { type: 'ai', message: 'blocked', read: false, createdAt: 1, from: AI_SERVICE_UID }],
      ['auditLogs/blocked', { action: 'create', entityType: 'ai', userId: AI_SERVICE_UID, userName: 'AI', timestamp: 1 }],
      ['supplierAuditLogs/supplier1/blocked', { action: 'create', entityType: 'supplier', userId: AI_SERVICE_UID, userName: 'AI', timestamp: 1 }],
      ['pmosAuditLog/blocked', { actorUid: AI_SERVICE_UID, action: 'create', module: 'ai', projectId: TEST_PROJECT, timestamp: 1, safeSummary: 'blocked', source: 'pmos' }]
    ];
    for (const [path, value] of deniedWrites) {
      await assertFails(set(ref(db, path), value));
    }
  });
});

describe('ACPM browser AI permissions', () => {
  it('allows active boss, owner, admin, and PM roles to read sanitized output', async () => {
    for (const uid of [USERS.boss, USERS.owner, USERS.admin, USERS.pm]) {
      const db = testEnv.authenticatedContext(uid).database();
      for (const collection of AI_OUTPUT_COLLECTIONS) {
        await assertSucceeds(get(ref(db, `ai/${collection}`)));
      }
    }
  });

  it('restricts config to active boss, owner, and admin roles', async () => {
    for (const uid of [USERS.boss, USERS.owner, USERS.admin]) {
      await assertSucceeds(get(ref(testEnv.authenticatedContext(uid).database(), 'ai/config')));
    }
    await assertFails(get(ref(testEnv.authenticatedContext(USERS.pm).database(), 'ai/config')));
  });

  it('keeps conditions and idempotency service-only', async () => {
    for (const uid of [USERS.boss, USERS.owner, USERS.admin, USERS.pm]) {
      const db = testEnv.authenticatedContext(uid).database();
      await assertFails(get(ref(db, 'ai/conditions')));
      await assertFails(get(ref(db, 'ai/idempotency')));
    }
  });

  it('denies direct AI writes from every authorized browser role', async () => {
    for (const uid of [USERS.boss, USERS.owner, USERS.admin, USERS.pm]) {
      await assertFails(set(
        ref(testEnv.authenticatedContext(uid).database(), `ai/events/browser-${uid}`),
        { type: 'task_overdue' }
      ));
    }
  });

  it('denies APM, anonymous, and inactive users from AI V0.1', async () => {
    await assertFails(get(ref(testEnv.authenticatedContext(USERS.apm).database(), 'ai/events')));
    await assertFails(get(ref(testEnv.unauthenticatedContext().database(), 'ai/events')));
    await assertFails(get(ref(testEnv.authenticatedContext(USERS.inactive).database(), 'ai/events')));
  });

  it('prevents browser admins from creating a role-bearing service profile', async () => {
    await assertFails(set(
      ref(testEnv.authenticatedContext(USERS.boss).database(), `users/${AI_SERVICE_UID}`),
      profile('boss')
    ));
  });
});
