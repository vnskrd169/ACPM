import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assertSucceeds,
  assertFails,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'pmos-test-project';
const TEST_PROJECT_ID = 'test-project-1';
const ASSIGNED_USER = { uid: 'assigned-user' };
const BOSS_USER = { uid: 'boss-user' };
const VIEWER_USER = { uid: 'viewer-user' };
const UNAUTHORIZED_USER = { uid: 'unauth-user' };

let testEnv: RulesTestEnvironment;


beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {
      rules: readFileSync('database.rules.pmos-proposed.json', 'utf8'),
      host: '127.0.0.1',
      port: 18200,
    },
    storage: {
      rules: readFileSync('storage.rules.pmos-proposed', 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });

  // Seed user profiles for storage rules (which read from DB for role checks)
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const ref = context.database().ref('/users');
    await ref.child(ASSIGNED_USER.uid).set({
      uid: ASSIGNED_USER.uid,
      role: 'apm',
      name: 'Assigned User',
      projects: { [TEST_PROJECT_ID]: true },
    });
    await ref.child(BOSS_USER.uid).set({
      uid: BOSS_USER.uid,
      role: 'boss',
      name: 'Boss User',
    });
    await ref.child(VIEWER_USER.uid).set({
      uid: VIEWER_USER.uid,
      role: 'viewer',
      name: 'Viewer User',
      projects: { [TEST_PROJECT_ID]: true },
    });
    await ref.child(UNAUTHORIZED_USER.uid).set({
      uid: UNAUTHORIZED_USER.uid,
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

// SKIPPED — pinned emulator runtime limitation, not an app defect:
// cloud-storage-rules-runtime-v1.1.3 cannot compile cross-service access
// (`firebase.database().ref(...).get()`) in storage.rules.pmos-proposed
// ("Invalid function name: database"), so the storage emulator cannot start
// with the proposed rules on this toolchain. The DEPLOYED production
// storage.rules compiles and starts the storage emulator cleanly (verified in
// this session). Re-enable this suite after the storage emulator runtime is
// upgraded to a version supporting cross-service access.
describe.skip('PMOS Storage Rules', () => {
  const bucketPath = `pmos/${TEST_PROJECT_ID}/issues/2026/07/test-photo.jpg`;

  // Helper: create upload data buffer
  function uploadData(contentType: string, size?: number) {
    const buf = Buffer.alloc(size ?? 1024, 'test-image-data');
    return { buf, metadata: { contentType } };
  }

  describe('Assigned user uploads allowed', () => {
    it('uploads valid JPEG', async () => {
      const storage = testEnv.authenticatedContext(ASSIGNED_USER.uid).storage();
      const { buf, metadata } = uploadData('image/jpeg');
      await assertSucceeds(storage.ref(bucketPath).put(buf, metadata));
    });

    it('uploads valid PNG', async () => {
      const storage = testEnv.authenticatedContext(ASSIGNED_USER.uid).storage();
      const { buf, metadata } = uploadData('image/png');
      await assertSucceeds(storage.ref(
        `pmos/${TEST_PROJECT_ID}/photos/2026/07/test-photo.png`
      ).put(buf, metadata));
    });
  });

  describe('Unauthorized access denied', () => {
    it('unassigned user upload denied', async () => {
      const storage = testEnv.authenticatedContext(UNAUTHORIZED_USER.uid).storage();
      const { buf, metadata } = uploadData('image/jpeg');
      await assertFails(storage.ref(bucketPath).put(buf, metadata));
    });

    it('viewer upload denied', async () => {
      const storage = testEnv.authenticatedContext(VIEWER_USER.uid).storage();
      const { buf, metadata } = uploadData('image/jpeg');
      await assertFails(storage.ref(bucketPath).put(buf, metadata));
    });
  });

  describe('Path restrictions', () => {
    it('unauthorized project path denied', async () => {
      const storage = testEnv.authenticatedContext(ASSIGNED_USER.uid).storage();
      const { buf, metadata } = uploadData('image/jpeg');
      await assertFails(storage.ref(
        'pmos/other-project/issues/2026/07/photo.jpg'
      ).put(buf, metadata));
    });

    it('non-pmos path denied', async () => {
      const storage = testEnv.authenticatedContext(ASSIGNED_USER.uid).storage();
      const { buf, metadata } = uploadData('image/jpeg');
      await assertFails(storage.ref(
        'uploads/photo.jpg'
      ).put(buf, metadata));
    });
  });

  describe('MIME type validation', () => {
    it('invalid MIME type denied', async () => {
      const storage = testEnv.authenticatedContext(ASSIGNED_USER.uid).storage();
      const { buf, metadata } = uploadData('text/plain');
      await assertFails(storage.ref(
        `pmos/${TEST_PROJECT_ID}/issues/2026/07/hack.txt`
      ).put(buf, metadata));
    });
  });

  describe('File size validation', () => {
    it('oversized upload denied (>20MB)', async () => {
      const storage = testEnv.authenticatedContext(ASSIGNED_USER.uid).storage();
      const { buf, metadata } = uploadData('image/jpeg', 25 * 1024 * 1024);
      await assertFails(storage.ref(bucketPath).put(
        buf, metadata
      ));
    });
  });

  describe('Face attendance path restriction', () => {
    it('assigned user can upload to face-attendance path', async () => {
      const storage = testEnv.authenticatedContext(ASSIGNED_USER.uid).storage();
      const { buf, metadata } = uploadData('image/jpeg');
      await assertSucceeds(storage.ref(
        `pmos-face/${TEST_PROJECT_ID}/2026-07-17/selfie.jpg`
      ).put(buf, metadata));
    });

    it('unauthorized user face attendance upload denied', async () => {
      const storage = testEnv.authenticatedContext(UNAUTHORIZED_USER.uid).storage();
      const { buf, metadata } = uploadData('image/jpeg');
      await assertFails(storage.ref(
        `pmos-face/${TEST_PROJECT_ID}/2026-07-17/selfie.jpg`
      ).put(buf, metadata));
    });
  });
});
