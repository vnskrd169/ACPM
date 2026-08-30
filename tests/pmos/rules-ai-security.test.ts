import { afterAll, beforeAll, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { get, ref, runTransaction, set } from 'firebase/database';

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
  'projectTargets',
  'agents',
  'runtimeStatus',
  'uiStatus',
  'events',
  'runs',
  'findings',
  'recommendations',
  'decisions',
  'actionDrafts',
  'actionDraftEvents'
];

const AI_SERVICE_WRITE_COLLECTIONS = [
  'config',
  'agents',
  'runtimeStatus',
  'uiStatus',
  'events',
  'runs',
  'findings',
  'recommendations',
  'decisions',
  'actionDrafts',
  'actionDraftEvents',
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

function actionDraft(status: 'draft' | 'reviewed' | 'cancelled' = 'draft') {
  const base = {
    schemaVersion: '0.1',
    decisionId: 'decision1',
    recommendationId: 'recommendation1',
    eventId: 'event1',
    projectId: TEST_PROJECT,
    actionType: 'prepare_material_request',
    title: 'Prepare reviewed material request',
    summary: 'Draft intent only.',
    status,
    createdAt: 1785254401000,
    createdBy: USERS.pm,
    sourceDecisionOptionId: 'prepare-material',
    payload: {
      schemaVersion: '0.1',
      materialReference: 'material-1',
      reason: 'Validated material follow-up.',
      sourceEvidenceRefs: [{ path: `projects/${TEST_PROJECT}/purchaseRequests`, recordId: 'request1', field: 'status' }]
    },
    lastEventId: status === 'draft' ? 'draft-created-event' : `draft-${status}-event`
  };
  if (status === 'reviewed') {
    return { ...base, reviewedAt: 1785254402000, reviewedBy: USERS.pm, reviewedByRole: 'pm' };
  }
  if (status === 'cancelled') {
    return { ...base, cancelledAt: 1785254402000, cancelledBy: USERS.pm, cancelledByRole: 'pm' };
  }
  return base;
}

function actionDraftEvent(action: 'created' | 'reviewed' | 'cancelled' = 'created') {
  return {
    draftId: 'draft1',
    decisionId: 'decision1',
    projectId: TEST_PROJECT,
    action,
    actorUid: USERS.pm,
    actorRole: 'pm',
    timestamp: 1785254401000
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
        projectTargets: {
          [TEST_PROJECT]: {
            schemaVersion: '0.1',
            enabled: false,
            scanTasks: false,
            scanMaterials: false,
            scanIssues: false
          }
        },
        agents: { planning: { status: 'disabled' } },
        runtimeStatus: { state: 'disabled' },
        uiStatus: {
          schemaVersion: '0.1',
          uiEnabled: false,
          systemStatus: 'disabled',
          updatedAt: 1785254400000
        },
        conditions: { internal1: { matched: false } },
        events: { event1: { type: 'task_overdue' } },
        runs: { run1: { status: 'disabled' } },
        findings: { run1: { planning: { summary: 'Sanitized finding' } } },
        recommendations: { recommendation1: { summary: 'Sanitized recommendation' } },
        decisions: {
          decision1: {
            schemaVersion: '0.1',
            projectId: TEST_PROJECT,
            eventId: 'event1',
            runId: 'run1',
            recommendationId: 'recommendation1',
            question: 'Which reviewed option should be recorded?',
            options: ['Continue monitoring', 'Proceed with review'],
            status: 'open',
            createdAt: 1785254400000
          }
        },
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
      const path = collection === 'uiStatus' ? 'ai/uiStatus' : `ai/${collection}/phase2-proof`;
      const value = collection === 'uiStatus'
        ? { schemaVersion: '0.1', uiEnabled: true, systemStatus: 'ready', updatedAt: 1785254400000 }
        : collection === 'decisions'
          ? {
              schemaVersion: '0.1', projectId: TEST_PROJECT, eventId: 'event1', runId: 'run1',
              recommendationId: 'recommendation1', question: 'Record a reviewed option?',
              options: ['Continue monitoring'], status: 'open', createdAt: 1785254400000
            }
        : collection === 'actionDrafts'
          ? actionDraft()
        : collection === 'actionDraftEvents'
          ? actionDraftEvent()
        : { source: 'emulator', createdAt: 1785254400000 };
      await assertSucceeds(set(ref(db, path), value));
    }
  });

  it('allows the service to read uiStatus and rejects unsanitized projection fields', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    await assertSucceeds(get(ref(db, 'ai/uiStatus')));
    await assertFails(set(ref(db, 'ai/uiStatus'), {
      schemaVersion: '0.1',
      uiEnabled: true,
      systemStatus: 'ready',
      updatedAt: 1785254400000,
      generationEnabled: true
    }));
    await assertFails(set(ref(db, 'ai/uiStatus'), {
      schemaVersion: '0.1',
      uiEnabled: true,
      systemStatus: 'ready',
      updatedAt: 1.5
    }));
  });

  it('allows only schema-valid service writes to the explicit project target registry', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    await assertSucceeds(set(ref(db, `ai/projectTargets/${TEST_PROJECT}`), {
      schemaVersion: '0.1',
      enabled: true,
      activationAt: 1785254400000,
      scanTasks: true,
      scanMaterials: true,
      scanIssues: true,
      lastScanAt: 1785254401000
    }));
    await assertFails(set(ref(db, 'ai/projectTargets/copied-project'), {
      schemaVersion: '0.1',
      enabled: true,
      activationAt: 1785254400000,
      scanTasks: true,
      scanMaterials: true,
      scanIssues: true,
      projectName: 'Copied business metadata is forbidden'
    }));
    await assertFails(set(ref(db, 'ai/projectTargets/missing-activation'), {
      schemaVersion: '0.1',
      enabled: true,
      scanTasks: true,
      scanMaterials: true,
      scanIssues: true
    }));
  });

  it('supports an atomic service-only idempotency claim', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    const claimRef = ref(db, 'ai/idempotency/concurrentClaims/claim-1');
    const [left, right] = await Promise.all([
      runTransaction(claimRef, current => current ?? { owner: 'left' }),
      runTransaction(claimRef, current => current ?? { owner: 'right' })
    ]);
    expect(left.snapshot.val()).toEqual(right.snapshot.val());
    expect(['left', 'right']).toContain(left.snapshot.child('owner').val());
  });

  it('allows the service to atomically resolve only schema-valid decision fields', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    const decisionRef = ref(db, 'ai/decisions/decision1');
    await assertSucceeds(runTransaction(decisionRef, current => ({
      ...current,
      status: 'resolved',
      resolvedAt: 1785254401000,
      resolvedBy: USERS.pm,
      resolvedByRole: 'pm',
      resolution: 'Continue monitoring',
      resolutionNotes: 'Reviewed.',
      history: {
        'submission-0001': {
          decisionId: 'decision1', projectId: TEST_PROJECT, action: 'choose',
          selectedOptionId: 'Continue monitoring', actorUid: USERS.pm, actorRole: 'pm',
          timestamp: 1785254401000, notes: 'Reviewed.'
        }
      }
    })));
    await assertFails(set(ref(db, 'ai/decisions/decision1/status'), 'open'));
    await assertFails(set(ref(db, 'ai/decisions/invalid-resolution'), {
      schemaVersion: '0.1', projectId: TEST_PROJECT, eventId: 'event1', runId: 'run1',
      recommendationId: 'recommendation1', question: 'Invalid?', options: ['Valid'],
      status: 'resolved', createdAt: 1785254400000, resolvedAt: 1785254401000,
      resolvedBy: USERS.pm, resolvedByRole: 'apm', resolution: 'Not stored'
    }));
  });

  it('allows the service to create and finalize only allowlisted action drafts', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    const draftRef = ref(db, 'ai/actionDrafts/draft-review-proof');
    await assertSucceeds(set(draftRef, actionDraft()));
    await assertSucceeds(runTransaction(draftRef, current => ({
      ...current,
      status: 'reviewed',
      reviewedAt: 1785254402000,
      reviewedBy: USERS.pm,
      reviewedByRole: 'pm',
      lastEventId: 'submission-review-proof'
    })));
    await assertFails(set(ref(db, 'ai/actionDrafts/draft-review-proof/status'), 'cancelled'));
    await assertFails(set(ref(db, 'ai/actionDrafts/disallowed-type'), {
      ...actionDraft(), actionType: 'approve_purchase'
    }));
  });

  it('keeps action-draft events append-only and schema-limited', async () => {
    const db = testEnv.authenticatedContext(AI_SERVICE_UID).database();
    const eventRef = ref(db, 'ai/actionDraftEvents/draft-review-event');
    await assertSucceeds(set(eventRef, actionDraftEvent('reviewed')));
    await assertFails(set(eventRef, actionDraftEvent('cancelled')));
    await assertFails(set(ref(db, 'ai/actionDraftEvents/unsafe-event'), {
      ...actionDraftEvent(), prompt: 'raw provider data must be rejected'
    }));
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

  it('allows management roles to read only the sanitized UI availability projection', async () => {
    for (const uid of [USERS.boss, USERS.owner, USERS.admin, USERS.pm]) {
      await assertSucceeds(get(ref(testEnv.authenticatedContext(uid).database(), 'ai/uiStatus')));
      await assertFails(set(
        ref(testEnv.authenticatedContext(uid).database(), 'ai/uiStatus'),
        { schemaVersion: '0.1', uiEnabled: true, systemStatus: 'ready', updatedAt: 1785254400000 }
      ));
    }
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
      await assertFails(set(
        ref(testEnv.authenticatedContext(uid).database(), `ai/projectTargets/browser-${uid}`),
        { schemaVersion: '0.1', enabled: false, scanTasks: false, scanMaterials: false, scanIssues: false }
      ));
      await assertFails(set(
        ref(testEnv.authenticatedContext(uid).database(), 'ai/decisions/decision1/status'),
        'resolved'
      ));
      await assertFails(set(
        ref(testEnv.authenticatedContext(uid).database(), `ai/actionDrafts/browser-${uid}`),
        actionDraft()
      ));
    }
  });

  it('denies PM browser draft creation while allowing management draft reads', async () => {
    const pmDb = testEnv.authenticatedContext(USERS.pm).database();
    await assertSucceeds(get(ref(pmDb, 'ai/actionDrafts')));
    await assertFails(set(ref(pmDb, 'ai/actionDrafts/pm-direct'), actionDraft()));
  });

  it('denies APM and anonymous decision submissions at the database boundary', async () => {
    await assertFails(set(ref(testEnv.authenticatedContext(USERS.apm).database(), 'ai/decisions/decision1/status'), 'dismissed'));
    await assertFails(set(ref(testEnv.unauthenticatedContext().database(), 'ai/decisions/decision1/status'), 'dismissed'));
  });

  it('denies APM and anonymous action-draft access at the database boundary', async () => {
    for (const db of [
      testEnv.authenticatedContext(USERS.apm).database(),
      testEnv.unauthenticatedContext().database()
    ]) {
      await assertFails(get(ref(db, 'ai/actionDrafts')));
      await assertFails(set(ref(db, 'ai/actionDrafts/blocked'), actionDraft()));
    }
  });

  it('denies APM, anonymous, and inactive users from AI V0.1', async () => {
    await assertFails(get(ref(testEnv.authenticatedContext(USERS.apm).database(), 'ai/events')));
    await assertFails(get(ref(testEnv.unauthenticatedContext().database(), 'ai/events')));
    await assertFails(get(ref(testEnv.authenticatedContext(USERS.inactive).database(), 'ai/events')));
    await assertFails(get(ref(testEnv.authenticatedContext(USERS.apm).database(), 'ai/uiStatus')));
    await assertFails(get(ref(testEnv.unauthenticatedContext().database(), 'ai/uiStatus')));
    await assertFails(get(ref(testEnv.authenticatedContext(USERS.inactive).database(), 'ai/uiStatus')));
  });

  it('prevents browser admins from creating a role-bearing service profile', async () => {
    await assertFails(set(
      ref(testEnv.authenticatedContext(USERS.boss).database(), `users/${AI_SERVICE_UID}`),
      profile('boss')
    ));
  });
});
