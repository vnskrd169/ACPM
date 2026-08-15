import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

// Child-level task transition rules (database.rules.json):
//   - Status must be a canonical (or known legacy) value.
//   - Updates must follow the canonical lifecycle state machine:
//       pending -> in_progress | cancelled
//       in_progress -> blocked | for_verification | cancelled
//       blocked -> in_progress | cancelled
//       for_verification -> completed | in_progress | blocked | cancelled
//   - Only boss/owner/admin/pm may write a completion alias (completed/done/closed).
//   - createdBy and createdAt are immutable after creation.
//   - completed/cancelled (terminal) tasks cannot transition anywhere.
const PROJECT_ID = 'acpm-task-rules-test';
const ACTIVE_PROJECT = 'project-tasks';
const USERS = {
  boss: 'boss-user',
  pm: 'pm-user',
  apm: 'apm-user',
  unassignedApm: 'unassigned-apm',
};

let testEnv: RulesTestEnvironment;

function profile(role: string, status = 'active', projects: Record<string, boolean> = {}) {
  return {
    displayName: `${role} test`,
    email: `${role}@lebuild.test`,
    position: role.toUpperCase(),
    role,
    status,
    projects,
    assignedProjects: projects,
    profileComplete: true,
  };
}

function project(status = 'active') {
  return {
    name: 'Task Rules Project',
    status,
    createdAt: 1785254400000,
    createdDate: '2026-07-29',
    laborBudget: 100000,
    materialBudget: 100000,
  };
}

function task(status: string, overrides: Record<string, unknown> = {}) {
  return {
    title: 'Install formwork',
    status,
    createdAt: 1785254400000,
    createdBy: USERS.apm,
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

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.database();
    await db.ref('/users').set({
      [USERS.boss]: profile('boss'),
      [USERS.pm]: profile('pm'),
      [USERS.apm]: profile('apm', 'active', { [ACTIVE_PROJECT]: true }),
      [USERS.unassignedApm]: profile('apm'),
    });
    await db.ref(`/projects/${ACTIVE_PROJECT}`).set(project());
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('Child-level task transition rules (database.rules.json)', () => {
  it('APM can create a task in pending state in an assigned project', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create`).set(task('pending')));
  });

  it('unassigned APM cannot create a task', async () => {
    const db = testEnv.authenticatedContext(USERS.unassignedApm).database();
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-unassigned`).set(task('pending')));
  });

  it('invalid status value is rejected', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-mystery`).set(task('mystery')));
  });

  it('pending -> in_progress is a valid APM transition', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create`).set(task('in_progress', { startedAt: 1785254401000 })));
  });

  it('in_progress -> for_verification is a valid APM transition', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create`).set(task('for_verification', { progress: 100, submittedForVerificationAt: 1785254402000 })));
  });

  it('for_verification -> in_progress (return) is a valid APM transition', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create`).set(task('in_progress', { progress: 60 })));
  });

  it('in_progress -> blocked and blocked -> in_progress resume cycle is valid', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-block-cycle`).set(task('in_progress')));
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-block-cycle`).update({ status: 'blocked', blockedReason: 'Waiting on rebar' }));
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-block-cycle`).update({ status: 'in_progress' }));
  });

  it('APM cannot create a task directly as completed (PM gate on create)', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create-completed`).set(task('completed')));
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create-completed`).set(task('done')));
  });

  it('APM cannot complete a task directly (PM verification gate)', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create`).set(task('completed', { completedAt: 1785254403000 })));
  });

  it('APM cannot skip lifecycle by writing a completion alias', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create`).set(task('done')));
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create`).set(task('closed')));
  });

  it('APM cannot jump pending -> blocked (invalid transition)', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-skip`).set(task('pending')));
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-skip`).update({ status: 'blocked' }));
  });

  it('PM can verify and complete a for_verification task', async () => {
    const db = testEnv.authenticatedContext(USERS.pm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-pm-complete`).set(task('for_verification')));
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-pm-complete`).update({
      status: 'completed',
      completedAt: 1785254404000,
      verifiedBy: USERS.pm,
    }));
  });

  it('boss can verify and complete a for_verification task', async () => {
    const db = testEnv.authenticatedContext(USERS.boss).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-boss-complete`).set(task('for_verification')));
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-boss-complete`).update({
      status: 'completed',
      completedAt: 1785254405000,
      verifiedBy: USERS.boss,
    }));
  });

  it('completed tasks are terminal: PM cannot reopen them', async () => {
    const db = testEnv.authenticatedContext(USERS.pm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-terminal`).set(task('completed', { completedAt: 1785254406000 })));
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-terminal`).update({ status: 'in_progress' }));
  });

  it('cancelled tasks are terminal: APM cannot reopen them', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-cancelled`).set(task('cancelled', { cancelledAt: 1785254407000 })));
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-cancelled`).update({ status: 'pending' }));
  });

  it('APM can cancel a pending task', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-cancel`).set(task('pending')));
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-cancel`).update({
      status: 'cancelled',
      cancelledAt: 1785254408000,
    }));
  });

  it('APM can update task metadata without changing status', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create`).update({
      title: 'Install formwork - revised',
      updatedAt: 1785254409000,
    }));
  });

  it('createdBy is immutable after creation', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create`).update({ createdBy: USERS.pm }));
  });

  it('createdAt is immutable after creation', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertFails(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-create`).update({ createdAt: 1 }));
  });

  it('legacy pending alias can still start work (todo -> in_progress)', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-legacy-todo`).set(task('todo')));
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-legacy-todo`).update({ status: 'in_progress' }));
  });

  it('legacy open alias can still start work (open -> in_progress)', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-legacy-open`).set(task('open')));
    await assertSucceeds(db.ref(`projects/${ACTIVE_PROJECT}/tasks/t-legacy-open`).update({ status: 'in_progress' }));
  });

  it('legacy review alias can be completed only by a verifier role', async () => {
    const apmDb = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(apmDb.ref(`projects/${ACTIVE_PROJECT}/tasks/t-legacy-review`).set(task('review')));
    // APM cannot write a completion alias (raw 'done' or canonical 'completed').
    await assertFails(apmDb.ref(`projects/${ACTIVE_PROJECT}/tasks/t-legacy-review`).update({ status: 'done' }));
    await assertFails(apmDb.ref(`projects/${ACTIVE_PROJECT}/tasks/t-legacy-review`).update({ status: 'completed' }));

    // PM writes the canonical completed status (the adapter normalizes 'done' -> 'completed').
    const pmDb = testEnv.authenticatedContext(USERS.pm).database();
    await assertSucceeds(pmDb.ref(`projects/${ACTIVE_PROJECT}/tasks/t-legacy-review`).update({ status: 'completed' }));
  });
});
