import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { get, ref, set, update } from 'firebase/database';

const PROJECT_ID = 'acpm-production-rules-test';
const ACTIVE_PROJECT = 'project-active';
const OTHER_PROJECT = 'project-other';
const ASSIGNMENT_PROJECT = 'project-assignment';
const USERS = {
  boss: 'boss-user',
  pm: 'pm-user',
  apm: 'apm-user',
  unassignedApm: 'unassigned-apm',
  suspendedPm: 'suspended-pm',
  pending: 'pending-user',
  viewer: 'viewer-user',
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

function project(name: string, status = 'active') {
  return {
    name,
    status,
    createdAt: 1785254400000,
    createdDate: '2026-07-29',
    laborBudget: 100000,
    materialBudget: 100000,
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

  await testEnv.withSecurityRulesDisabled(async context => {
    await set(ref(context.database()), {
      users: {
        [USERS.boss]: profile('boss'),
        [USERS.pm]: profile('pm'),
        [USERS.apm]: profile('apm', 'active', { [ACTIVE_PROJECT]: true }),
        [USERS.unassignedApm]: profile('apm'),
        [USERS.suspendedPm]: profile('pm', 'suspended'),
        [USERS.pending]: profile('apm', 'pending'),
        [USERS.viewer]: profile('viewer'),
      },
      projects: {
        [ACTIVE_PROJECT]: project('Active Project'),
        [OTHER_PROJECT]: project('Other Project'),
        [ASSIGNMENT_PROJECT]: project('Assignment Project'),
      },
      pmosUpdates: {
        assignedUpdate: {
          projectId: ACTIVE_PROJECT,
          projectName: 'Active Project',
          category: 'General',
          note: 'Assigned project update',
          priority: 'Normal',
          status: 'New',
          dueDate: '2026-08-01',
          createdAt: 1785254400000,
          source: 'Line17 PMOS',
        },
        otherUpdate: {
          projectId: OTHER_PROJECT,
          projectName: 'Other Project',
          category: 'General',
          note: 'Other project update',
          priority: 'Normal',
          status: 'New',
          dueDate: '2026-08-01',
          createdAt: 1785254400000,
          source: 'Line17 PMOS',
        },
      },
    });
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('ACPM production role rules', () => {
  it('Boss and PM can list all company projects', async () => {
    await assertSucceeds(get(ref(testEnv.authenticatedContext(USERS.boss).database(), 'projects')));
    await assertSucceeds(get(ref(testEnv.authenticatedContext(USERS.pm).database(), 'projects')));
  });

  it('PM can create a new project', async () => {
    await assertSucceeds(
      set(
        ref(testEnv.authenticatedContext(USERS.pm).database(), 'projects/pm-created'),
        project('PM Created Project'),
      ),
    );
  });

  it('PM can complete and reopen but cannot archive a project', async () => {
    const projectRef = ref(testEnv.authenticatedContext(USERS.pm).database(), `projects/${OTHER_PROJECT}`);
    await assertSucceeds(update(projectRef, {
      status: 'completed',
      completedAt: 1785254401000,
      completedBy: USERS.pm,
      completedByName: 'PM test',
    }));
    await assertSucceeds(update(projectRef, {
      status: 'active',
      reopenedAt: 1785254402000,
      reopenedBy: USERS.pm,
      reopenedByName: 'PM test',
    }));
    await assertFails(set(ref(testEnv.authenticatedContext(USERS.pm).database(), `projects/${OTHER_PROJECT}/status`), 'archived'));
  });

  it('PM can assign projects to an APM without changing protected role fields', async () => {
    const userRef = ref(testEnv.authenticatedContext(USERS.pm).database(), `users/${USERS.apm}`);
    await assertSucceeds(update(userRef, {
      [`projects/${ASSIGNMENT_PROJECT}`]: true,
      [`assignedProjects/${ASSIGNMENT_PROJECT}`]: true,
      updatedBy: USERS.pm,
      updatedAt: 1785254403000,
    }));
    await assertFails(set(ref(testEnv.authenticatedContext(USERS.pm).database(), `users/${USERS.apm}/role`), 'pm'));
  });

  it('PM cannot alter another PM project assignments', async () => {
    await assertFails(
      set(
        ref(
          testEnv.authenticatedContext(USERS.pm).database(),
          `users/${USERS.suspendedPm}/projects/${ACTIVE_PROJECT}`,
        ),
        true,
      ),
    );
  });

  it('APM can read assigned projects but cannot list or read unassigned projects', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(get(ref(db, `projects/${ACTIVE_PROJECT}`)));
    await assertFails(get(ref(db, 'projects')));
    await assertFails(get(ref(db, `projects/${OTHER_PROJECT}`)));
  });

  it('APM can update assigned active project data but cannot change lifecycle status', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertSucceeds(set(ref(db, `projects/${ACTIVE_PROJECT}/notes`), {
      text: 'Assigned APM site note',
      updatedAt: 1785254404000,
      updatedBy: USERS.apm,
    }));
    await assertFails(set(ref(db, `projects/${ACTIVE_PROJECT}/status`), 'completed'));
  });

  it('APM can create canonical task, task event, and activity records in an assigned project', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    const taskId = 'task-apm-created';
    await assertSucceeds(update(ref(db, `projects/${ACTIVE_PROJECT}`), {
      [`tasks/${taskId}`]: {
        title: 'Install formwork',
        status: 'pending',
        createdAt: 1785254405000,
        createdBy: USERS.apm,
      },
      'taskEvents/event-created': {
        type: 'task_created',
        taskId,
        projectId: ACTIVE_PROJECT,
        createdAt: 1785254405000,
        createdBy: USERS.apm,
      },
      'activity/event-created': {
        type: 'task_created',
        module: 'tasks',
        recordId: taskId,
        projectId: ACTIVE_PROJECT,
        createdAt: 1785254405000,
        createdBy: USERS.apm,
      },
    }));
  });

  it('invalid task statuses are rejected', async () => {
    const db = testEnv.authenticatedContext(USERS.apm).database();
    await assertFails(
      set(ref(db, `projects/${ACTIVE_PROJECT}/tasks/task-invalid`), {
          title: 'Invalid workflow',
          status: 'mystery',
          createdAt: 1785254406000,
          createdBy: USERS.apm,
      }),
    );
  });

  it('PM can read all legacy PMOS records while APM reads only assigned records', async () => {
    await assertSucceeds(get(ref(testEnv.authenticatedContext(USERS.pm).database(), 'pmosUpdates')));

    const apmDb = testEnv.authenticatedContext(USERS.apm).database();
    await assertFails(get(ref(apmDb, 'pmosUpdates')));
    await assertSucceeds(get(ref(apmDb, 'pmosUpdates/assignedUpdate')));
    await assertFails(get(ref(apmDb, 'pmosUpdates/otherUpdate')));
  });

  it('PM can write a legacy PMOS record for any company project', async () => {
    await assertSucceeds(
      set(ref(testEnv.authenticatedContext(USERS.pm).database(), 'pmosUpdates/pm-update'), {
        projectId: OTHER_PROJECT,
        projectName: 'Other Project',
        category: 'General',
        note: 'PM coordination update',
        priority: 'Normal',
        status: 'New',
        dueDate: '2026-08-02',
        createdAt: 1785254407000,
        source: 'Line17 PMOS',
      }),
    );
  });

  it('pending, suspended, viewer, and unauthenticated users cannot read project operations', async () => {
    const denied = [
      testEnv.authenticatedContext(USERS.pending).database(),
      testEnv.authenticatedContext(USERS.suspendedPm).database(),
      testEnv.authenticatedContext(USERS.viewer).database(),
      testEnv.unauthenticatedContext().database(),
    ];

    for (const db of denied) {
      await assertFails(get(ref(db, 'projects')));
      await assertFails(get(ref(db, 'pmosUpdates')));
    }
  });

  it('a pending account can still read only its own profile and access request', async () => {
    const db = testEnv.authenticatedContext(USERS.pending).database();
    await assertSucceeds(get(ref(db, `users/${USERS.pending}`)));
    await assertFails(get(ref(db, 'users')));
  });
});
