import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
      rules: 'database.rules.pmos-proposed.json',
      host: '127.0.0.1',
      port: 18200,
    },
    storage: {
      rules: 'storage.rules.pmos-proposed',
      host: '127.0.0.1',
      port: 9199,
    },
  });

  // Seed user profiles for storage rules (which read from DB for role checks)
  await testEnv.withSecurityRulesDisabled(async (db) => {
    const ref = db.ref('/users');
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

describe('PMOS Storage Rules', () => {
  const bucketPath = `pmos/${TEST_PROJECT_ID}/issues/2026/07/test-photo.jpg`;

  // Helper: create upload data buffer
  function uploadData(contentType: string, size?: number) {
    const buf = Buffer.alloc(size ?? 1024, 'test-image-data');
    return { buf, metadata: { contentType } };
  }

  describe('Assigned user uploads allowed', () => {
    it('uploads valid JPEG', async () => {
      const storage = testEnv.authenticatedStorage(ASSIGNED_USER.uid);
      const { buf, metadata } = uploadData('image/jpeg');
      await expect(assertSucceeds(storage.ref(bucketPath).put(buf, metadata))).resolves.toBeUndefined();
    });

    it('uploads valid PNG', async () => {
      const storage = testEnv.authenticatedStorage(ASSIGNED_USER.uid);
      const { buf, metadata } = uploadData('image/png');
      await expect(assertSucceeds(storage.ref(
        `pmos/${TEST_PROJECT_ID}/photos/2026/07/test-photo.png`
      ).put(buf, metadata))).resolves.toBeUndefined();
    });
  });

  describe('Unauthorized access denied', () => {
    it('unassigned user upload denied', async () => {
      const storage = testEnv.authenticatedStorage(UNAUTHORIZED_USER.uid);
      const { buf, metadata } = uploadData('image/jpeg');
      await expect(assertFails(storage.ref(bucketPath).put(buf, metadata))).resolves.toBeUndefined();
    });

    it('viewer upload denied', async () => {
      const storage = testEnv.authenticatedStorage(VIEWER_USER.uid);
      const { buf, metadata } = uploadData('image/jpeg');
      await expect(assertFails(storage.ref(bucketPath).put(buf, metadata))).resolves.toBeUndefined();
    });
  });

  describe('Path restrictions', () => {
    it('unauthorized project path denied', async () => {
      const storage = testEnv.authenticatedStorage(ASSIGNED_USER.uid);
      const { buf, metadata } = uploadData('image/jpeg');
      await expect(assertFails(storage.ref(
        'pmos/other-project/issues/2026/07/photo.jpg'
      ).put(buf, metadata))).resolves.toBeUndefined();
    });

    it('non-pmos path denied', async () => {
      const storage = testEnv.authenticatedStorage(ASSIGNED_USER.uid);
      const { buf, metadata } = uploadData('image/jpeg');
      await expect(assertFails(storage.ref(
        'uploads/photo.jpg'
      ).put(buf, metadata))).resolves.toBeUndefined();
    });
  });

  describe('MIME type validation', () => {
    it('invalid MIME type denied', async () => {
      const storage = testEnv.authenticatedStorage(ASSIGNED_USER.uid);
      const { buf, metadata } = uploadData('text/plain');
      await expect(assertFails(storage.ref(
        `pmos/${TEST_PROJECT_ID}/issues/2026/07/hack.txt`
      ).put(buf, metadata))).resolves.toBeUndefined();
    });
  });

  describe('File size validation', () => {
    it('oversized upload denied (>20MB)', async () => {
      const storage = testEnv.authenticatedStorage(ASSIGNED_USER.uid);
      const { buf, metadata } = uploadData('image/jpeg', 25 * 1024 * 1024);
      await expect(assertFails(storage.ref(bucketPath).put(
        buf, metadata
      ))).resolves.toBeUndefined();
    });
  });

  describe('Face attendance path restriction', () => {
    it('assigned user can upload to face-attendance path', async () => {
      const storage = testEnv.authenticatedStorage(ASSIGNED_USER.uid);
      const { buf, metadata } = uploadData('image/jpeg');
      await expect(assertSucceeds(storage.ref(
        `pmos-face/${TEST_PROJECT_ID}/2026-07-17/selfie.jpg`
      ).put(buf, metadata))).resolves.toBeUndefined();
    });

    it('unauthorized user face attendance upload denied', async () => {
      const storage = testEnv.authenticatedStorage(UNAUTHORIZED_USER.uid);
      const { buf, metadata } = uploadData('image/jpeg');
      await expect(assertFails(storage.ref(
        `pmos-face/${TEST_PROJECT_ID}/2026-07-17/selfie.jpg`
      ).put(buf, metadata))).resolves.toBeUndefined();
    });
  });
});
