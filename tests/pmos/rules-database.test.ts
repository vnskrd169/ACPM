import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assertSucceeds,
  assertFails,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'pmos-test-project';
const DB_PATH = 'pmosUpdates';
const TEST_PROJECT_ID = 'test-project-1';
const ASSIGNED_USER = { uid: 'assigned-user', email: 'field@test.com' };
const BOSS_USER = { uid: 'boss-user', email: 'boss@test.com' };
const VIEWER_USER = { uid: 'viewer-user', email: 'viewer@test.com' };
const UNAUTHORIZED_USER = { uid: 'unauth-user', email: 'other@test.com' };

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: '' },  // not used
    database: {
      rules: readFileSync('database.rules.pmos-proposed.json', 'utf8'),
      host: '127.0.0.1',
      port: 18200,
    },
  });

  // Isolation: rules-unit-testing cleanup() does not clear RTDB data across runs,
  // and the append-only audit rule depends on a clean slate.
  await testEnv.clearDatabase();

  // Seed user profiles for role-based rule checks
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const ref = context.database().ref('/users');
    await ref.child(ASSIGNED_USER.uid).set({
      uid: ASSIGNED_USER.uid,
      email: ASSIGNED_USER.email,
      role: 'apm',
      name: 'Assigned Field User',
      projects: { [TEST_PROJECT_ID]: true },
    });
    await ref.child(BOSS_USER.uid).set({
      uid: BOSS_USER.uid,
      email: BOSS_USER.email,
      role: 'boss',
      name: 'Boss User',
    });
    await ref.child(VIEWER_USER.uid).set({
      uid: VIEWER_USER.uid,
      email: VIEWER_USER.email,
      role: 'viewer',
      name: 'Viewer User',
      projects: { [TEST_PROJECT_ID]: true },
    });
    await ref.child(UNAUTHORIZED_USER.uid).set({
      uid: UNAUTHORIZED_USER.uid,
      email: UNAUTHORIZED_USER.email,
      role: 'apm',
      name: 'Unauthorized User',
      projects: {},
    });
  });
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

function validQuickUpdate(overrides = {}) {
  return {
    projectId: TEST_PROJECT_ID,
    projectName: 'Test Project',
    category: 'General',
    note: 'Test note',
    priority: 'Normal',
    status: 'New',
    dueDate: '2026-08-01',
    createdAt: Date.now(),
    source: 'Line17 PMOS',
    ...overrides,
  };
}

function validSiteLog(overrides = {}) {
  return {
    projectId: TEST_PROJECT_ID,
    date: '2026-07-17',
    weather: 'Sunny',
    manpowerCount: 5,
    accomplishment: 'Completed inspection',
    remarks: 'All good',
    createdAt: Date.now(),
    ...overrides,
  };
}

function validIssue(overrides = {}) {
  return {
    projectId: TEST_PROJECT_ID,
    location: 'Area 42',
    issue: 'Rebar spacing issue',
    assignedTo: 'foreman-1',
    priority: 'High',
    status: 'Open',
    dueDate: '2026-08-01',
    createdAt: Date.now(),
    ...overrides,
  };
}

function validMaterialRequest(overrides = {}) {
  return {
    projectId: TEST_PROJECT_ID,
    item: 'Deformed Bars 16mm',
    quantity: 50,
    unit: 'pcs',
    neededDate: '2026-07-25',
    purpose: 'Column reinforcement',
    status: 'Pending',
    createdAt: Date.now(),
    ...overrides,
  };
}

function validTask(overrides = {}) {
  return {
    projectId: TEST_PROJECT_ID,
    task: 'Verify rebar spacing',
    person: 'John Foreman',
    dueDate: '2026-07-25',
    priority: 'High',
    status: 'New',
    createdAt: Date.now(),
    ...overrides,
  };
}

function validMeetingNotes(overrides = {}) {
  return {
    projectId: TEST_PROJECT_ID,
    meetingTitle: 'Weekly Coordination',
    meetingDate: '2026-07-17',
    attendees: 'Engineer A, Foreman B',
    agenda: 'Discuss rebar schedule',
    discussion: 'Decided to proceed with pour',
    actionItems: '1. Complete rebar check',
    createdAt: Date.now(),
    ...overrides,
  };
}

function validPhotoLog(overrides = {}) {
  return {
    projectId: TEST_PROJECT_ID,
    caption: 'Formwork inspection',
    location: 'Area 42',
    category: 'Progress',
    createdAt: Date.now(),
    ...overrides,
  };
}

function validAttendance(overrides = {}) {
  return {
    attendanceId: 'att-1',
    projectId: TEST_PROJECT_ID,
    attendanceType: 'Time In',
    capturedAt: Date.now(),
    reviewStatus: 'For Review',
    payrollStatus: 'Not Posted',
    source: 'Line17 PMOS Face Attendance Assist',
    ...overrides,
  };
}

function validNotification(overrides = {}) {
  return {
    projectId: TEST_PROJECT_ID,
    type: 'quick_update_submitted',
    payload: { message: 'Test notification', notifyRole: 'pm' },
    createdAt: Date.now(),
    ...overrides,
  };
}

function validAuditLog(overrides = {}) {
  return {
    actorUid: ASSIGNED_USER.uid,
    action: 'create',
    module: 'pmos_quick_updates',
    projectId: TEST_PROJECT_ID,
    timestamp: Date.now(),
    safeSummary: 'Test audit entry',
    source: 'pmos',
    ...overrides,
  };
}

/* ============================================================
   HELPER
   ============================================================ */
async function expectWrite(user: typeof ASSIGNED_USER, path: string, data: any, allowed: boolean) {
  const db = testEnv.authenticatedContext(user.uid).database();
  const ref = db.ref(path);
  if (allowed) {
    await assertSucceeds(ref.set(data));
  } else {
    await assertFails(ref.set(data));
  }
}

describe('PMOS Database Rules', () => {
  describe('Assigned field user creates records', () => {
    it('creates Quick Update', async () => {
      await expectWrite(ASSIGNED_USER, 'pmosUpdates/test-1', validQuickUpdate(), true);
    });
    it('creates Site Log', async () => {
      await expectWrite(ASSIGNED_USER, 'pmosSiteLogs/test-2', validSiteLog(), true);
    });
    it('creates Issue', async () => {
      await expectWrite(ASSIGNED_USER, 'pmosIssues/test-3', validIssue(), true);
    });
    it('creates Material Request', async () => {
      await expectWrite(ASSIGNED_USER, 'pmosMaterialRequests/test-4', validMaterialRequest(), true);
    });
    it('creates Task', async () => {
      await expectWrite(ASSIGNED_USER, 'pmosTasks/test-5', validTask(), true);
    });
    it('creates Meeting Notes', async () => {
      await expectWrite(ASSIGNED_USER, 'pmosMeetingNotes/test-6', validMeetingNotes(), true);
    });
  });

  describe('Access control', () => {
    it('any authenticated user can read pmosUpdates (proposed .read: auth != null)', async () => {
      const db = testEnv.authenticatedContext(UNAUTHORIZED_USER.uid).database();
      const ref = db.ref('pmosUpdates/test-1');
      await assertSucceeds(ref.once('value'));
    });
    it('unauthenticated read denied on global path', async () => {
      const anon = testEnv.unauthenticatedContext().database();
      await assertFails(anon.ref('pmosUpdates/test-1').once('value'));
    });
    it('unassigned user write denied', async () => {
      await expectWrite(UNAUTHORIZED_USER, 'pmosUpdates/test-write', validQuickUpdate(), false);
    });
    it('unauthenticated write denied', async () => {
      const anon = testEnv.unauthenticatedContext().database();
      await assertFails(anon.ref('pmosUpdates/test-anon-write').set(validQuickUpdate()));
    });
  });

  describe('Draft edit ownership', () => {
    it('creator can edit own draft', async () => {
      const db = testEnv.authenticatedContext(ASSIGNED_USER.uid).database();
      // Create a record first
      const createRef = db.ref('pmosUpdates/test-own-draft');
      await assertSucceeds(createRef.set(validQuickUpdate()));
      // Then edit it
      await assertSucceeds(createRef.update({ note: 'Updated note' }));
    });
    it('other user cannot edit creator\'s draft', async () => {
      const otherDb = testEnv.authenticatedContext(UNAUTHORIZED_USER.uid).database();
      const ref = otherDb.ref('pmosUpdates/test-own-draft');
      await assertFails(ref.update({ note: 'Hacked note' }));
    });
  });

  describe('Material request self-approval', () => {
    it('assigned user can approve material request (rules do not restrict self-approval)', async () => {
      const db = testEnv.authenticatedContext(ASSIGNED_USER.uid).database();
      const ref = db.ref('pmosMaterialRequests/test-approve');
      // Create
      await assertSucceeds(ref.set(validMaterialRequest({ createdBy: ASSIGNED_USER.uid })));
      // Try to approve (change status to Approved)
      // Note: The DB rules do NOT explicitly prevent self-approval by creator.
      // Self-approval prevention is implemented at the application layer.
      await assertSucceeds(ref.update({ status: 'Approved' }));
    });
  });

  describe('Admin operations', () => {
    it('boss can archive records', async () => {
      const db = testEnv.authenticatedContext(BOSS_USER.uid).database();
      const ref = db.ref('pmosUpdates/test-archive');
      await assertSucceeds(ref.set(validQuickUpdate()));
      await assertSucceeds(ref.update({ status: 'Archived' }));
    });
    it('boss can restore archived records', async () => {
      const db = testEnv.authenticatedContext(BOSS_USER.uid).database();
      const ref = db.ref('pmosUpdates/test-archive');
      await assertSucceeds(ref.update({ status: 'Reviewed' }));
    });
  });

  describe('Meeting Notes', () => {
    it('valid Meeting Notes write allowed', async () => {
      await expectWrite(ASSIGNED_USER, 'pmosMeetingNotes/test-mtg-1', validMeetingNotes(), true);
    });
    it('malformed Meeting Notes rejected', async () => {
      // Missing required fields
      await expectWrite(ASSIGNED_USER, 'pmosMeetingNotes/test-mtg-bad', { meetingTitle: 'Title' }, false);
    });
  });

  describe('Notification events', () => {
    it('valid notification event created', async () => {
      await expectWrite(ASSIGNED_USER, 'globalNotificationEvents/test-notif', validNotification(), true);
    });
    it('malformed notification rejected by validate', async () => {
      await expectWrite(ASSIGNED_USER, 'globalNotificationEvents/test-notif-bad', { type: 'x' }, false);
    });
  });

  describe('Audit log append-only', () => {
    it('audit record created', async () => {
      await expectWrite(BOSS_USER, 'pmosAuditLog/test-audit', validAuditLog(), true);
    });
    it('audit record overwrite denied', async () => {
      const db = testEnv.authenticatedContext(BOSS_USER.uid).database();
      const ref = db.ref('pmosAuditLog/test-audit');
      // Creating a new record should work but overwriting an existing one should fail
      // (the rule is !data.exists() for write)
      // Attempt to overwrite the same path
      await assertFails(ref.set(validAuditLog({ safeSummary: 'Overwrite attempt' })));
    });
  });

  describe('Malformed data rejection', () => {
    it('Quick Update missing required fields rejected', async () => {
      await expectWrite(ASSIGNED_USER, 'pmosUpdates/test-bad', { note: 'Missing fields' }, false);
    });
    it('client-generated ID accepted', async () => {
      await expectWrite(ASSIGNED_USER, 'pmosUpdates/test-client-id', validQuickUpdate({ clientGeneratedId: 'client-abc-123' }), true);
    });
  });

  describe('Face Attendance restricted access', () => {
    it('unassigned user attendance read denied (project-scoped at $pid level)', async () => {
      const db = testEnv.authenticatedContext(UNAUTHORIZED_USER.uid).database();
      const ref = db.ref('pmosSelfieAttendance/test-project-1/2026-07-17/test-att');
      // Need to seed the attendance record first
      const adminDb = testEnv.authenticatedContext(BOSS_USER.uid).database();
      await adminDb.ref('pmosSelfieAttendance/test-project-1/2026-07-17/test-att').set(validAttendance());
      // Unauthorized user (no project membership) is denied by $pid-level .read rule
      await assertFails(ref.once('value'));
    });
  });
});
