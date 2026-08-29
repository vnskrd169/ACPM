import { Page, expect } from '@playwright/test';

const TEST_PROJECT = {
  id: 'test-project-1',
  name: 'E2E Test Project',
  status: 'active',
  createdAt: 1780000000000,
};

const TEST_USERS = {
  field: {
    uid: 'test-field-user-uid',
    name: 'Test Field User',
    email: 'field@test.com',
    role: 'apm',
    projects: { 'test-project-1': true },
  },
  reviewer: {
    uid: 'test-reviewer-uid',
    name: 'Test Reviewer',
    email: 'reviewer@test.com',
    role: 'admin',
    projects: { 'test-project-1': true },
    bossOf: { 'test-project-1': true },
  },
  pm: {
    uid: 'test-pm-user-uid',
    name: 'Test Project Manager',
    email: 'pm@test.com',
    role: 'pm',
    projects: {},
  },
  viewer: {
    uid: 'test-viewer-uid',
    name: 'Test Viewer',
    email: 'viewer@test.com',
    role: 'viewer',
    projects: { 'test-project-1': true },
  },
  boss: {
    uid: 'test-boss-uid',
    name: 'Test Boss',
    email: 'boss@test.com',
    role: 'boss',
    projects: {},
    bossOf: {},
  },
};

type InitScriptOptions = {
  disableServiceWorker?: boolean;
  databaseData?: Record<string, unknown>;
  failReadPaths?: string[];
};

export function buildInitScript(userKey: keyof typeof TEST_USERS, options: InitScriptOptions = {}): string {
  const user = TEST_USERS[userKey];
  const disableServiceWorker = options.disableServiceWorker !== false;
  const databaseData = options.databaseData || {};
  const failReadPaths = options.failReadPaths || [];
  return `
    window._currentUser = ${JSON.stringify(user)};
    window._currentPid = 'test-project-1';
    window.__ACPM_DISABLE_SW_FOR_E2E__ = ${disableServiceWorker ? 'true' : 'false'};

    const __pmosTestUser = ${JSON.stringify(user)};
    const __pmosTestProject = ${JSON.stringify(TEST_PROJECT)};
    const __extraDbData = ${JSON.stringify(databaseData)};
    const __failReadPaths = ${JSON.stringify(failReadPaths)};
    window.__mockDbPaths = [];
    window.__mockDbOnPaths = [];
    window.__mockDbOffPaths = [];
    window.__mockDbWrites = [];
    window.__mockAuthObservers = [];

    function makeSnapshot(value, key) {
      return {
        key: key || '',
        val: function () { return value; },
        exists: function () { return value !== null && value !== undefined; },
        forEach: function (cb) {
          if (!value || typeof value !== 'object') return false;
          Object.keys(value).forEach(function (childKey) {
            cb(makeSnapshot(value[childKey], childKey));
          });
          return false;
        },
      };
    }

    function dataForPath(path) {
      window.__mockDbPaths.push(path);
      if (Object.prototype.hasOwnProperty.call(__extraDbData, path)) return __extraDbData[path];
      if (path === 'users/' + __pmosTestUser.uid) {
        return Object.assign({}, __pmosTestUser, {
          status: 'active',
          displayName: __pmosTestUser.name,
          assignedProjects: __pmosTestUser.projects || {},
          profileComplete: true,
        });
      }
      if (path === 'accessRequests/' + __pmosTestUser.uid) return null;
      if (path === 'users') {
        return {
          [__pmosTestUser.uid]: Object.assign({}, __pmosTestUser, {
            status: 'active',
            displayName: __pmosTestUser.name,
            assignedProjects: __pmosTestUser.projects || {},
            profileComplete: true,
          }),
          'test-field-user-uid': {
            uid: 'test-field-user-uid',
            name: 'Test Field User',
            displayName: 'Test Field User',
            email: 'field@test.com',
            role: 'apm',
            status: 'active',
            projects: { 'test-project-1': true },
            assignedProjects: { 'test-project-1': true },
            profileComplete: true,
          },
        };
      }
      if (path === 'projects') return { 'test-project-1': __pmosTestProject };
      if (path === 'projects/test-project-1') return __pmosTestProject;
      return null;
    }

    function makeDbRef(path) {
      return {
        key: String(path || '').split('/').pop() || 'mock-key',
        once: function () {
          if (__failReadPaths.indexOf(path) !== -1) return Promise.reject({ code: 'PERMISSION_DENIED' });
          return Promise.resolve(makeSnapshot(dataForPath(path), String(path || '').split('/').pop()));
        },
        on: function (event, cb, errorCb) {
          window.__mockDbOnPaths.push(path);
          if (__failReadPaths.indexOf(path) !== -1) {
            if (typeof errorCb === 'function') setTimeout(function () { errorCb({ code: 'PERMISSION_DENIED' }); }, 0);
            return cb;
          }
          if (typeof cb === 'function') setTimeout(function () { cb(makeSnapshot(dataForPath(path), String(path || '').split('/').pop())); }, 0);
          return cb;
        },
        off: function () { window.__mockDbOffPaths.push(path); },
        update: function () { window.__mockDbWrites.push({ method: 'update', path: path }); return Promise.resolve(); },
        set: function () { window.__mockDbWrites.push({ method: 'set', path: path }); return Promise.resolve(); },
        push: function () {
          window.__mockDbWrites.push({ method: 'push', path: path });
          const key = 'mock-key-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
          return makeDbRef((path || '') + '/' + key);
        },
        orderByChild: function () { return this; },
        equalTo: function () { return this; },
        limitToLast: function () { return this; },
        limitToFirst: function () { return this; },
        endAt: function () { return this; },
        startAt: function () { return this; },
      };
    }

    window.firebase = {
      initializeApp: function () { return {}; },
      app: function () { return {}; },
      apps: [],
      auth: function () {
        return {
          currentUser: Object.assign({}, __pmosTestUser, { getIdToken: function() { return Promise.resolve('mock-token'); } }),
          Auth: { Persistence: { LOCAL: 'local' } },
          setPersistence: function () { return Promise.resolve(); },
          onAuthStateChanged: function (cb) {
            window.__mockAuthObservers.push(cb);
            cb(Object.assign({}, __pmosTestUser, { getIdToken: function() { return Promise.resolve('mock-token'); } }));
            return function () {
              const index = window.__mockAuthObservers.indexOf(cb);
              if (index !== -1) window.__mockAuthObservers.splice(index, 1);
            };
          },
          signInAnonymously: function () { return Promise.resolve({ user: __pmosTestUser }); },
          signOut: function () {
            window.__mockAuthObservers.slice().forEach(function (observer) { observer(null); });
            return Promise.resolve();
          },
        };
      },
      database: Object.assign(
        function () { return { ref: function (path) { return makeDbRef(path || ''); } }; },
        { ServerValue: { TIMESTAMP: Date.now() } }
      ),
    };
    window.firebase.auth.Auth = { Persistence: { LOCAL: 'local' } };

    window.APP_VERSION = '1.0.0';
    window.PMOS_VERSION = '1.0.0';
    window.CACHE_VERSION = 'acpm-pmos-v3';
    window.PMOS_SCHEMA_VERSION = '1.0';
    window.PMOS_CONFIG = {
      faceAttendanceEnabled: false,
      photoStorageProvider: 'googleDrive',
      useFirebaseStoragePhotos: false,
      useGoogleDrivePhotos: true,
      driveUploadUrl: 'https://script.google.com/macros/s/test/exec',
      maxPhotoSize: 20971520,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    };
  `;
}

async function blockFirebaseCdnForMockedAuth(page: Page) {
  const pageWithFlag = page as Page & { __pmosFirebaseCdnBlocked?: boolean };
  if (pageWithFlag.__pmosFirebaseCdnBlocked) return;
  pageWithFlag.__pmosFirebaseCdnBlocked = true;
  await page.route('**/www.gstatic.com/firebasejs/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '',
  }));
}

export function setupConsoleTracking(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

export async function navigateToPmos(page: Page) {
  await blockFirebaseCdnForMockedAuth(page);
  await page.context().setOffline(false);
  await page.goto('/pmos.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForURL('**/pmos/**', { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => {
    return !!document.querySelector('#pmosContent') &&
      !document.body.classList.contains('auth-checking') &&
      !document.querySelector('#authOverlay');
  }, null, { timeout: 15000 });
}

export async function navigateToBlockedPmos(page: Page) {
  await blockFirebaseCdnForMockedAuth(page);
  await page.context().setOffline(false);
  await page.goto('/pmos.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForURL('**/pmos/**', { timeout: 10000 }).catch(() => {});
  await expect(page.locator('#authOverlay')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#authOverlay')).toContainText(/not active in RC1|Admin approval needed/i);
}

export async function navigateToDashboard(page: Page) {
  await blockFirebaseCdnForMockedAuth(page);
  await page.context().setOffline(false);
  await page.goto('/dashboard.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => {
    const hub = document.querySelector('#hubView');
    return !!hub &&
      !hub.classList.contains('hidden') &&
      document.body.classList.contains('auth-ready') &&
      !document.querySelector('#authOverlay');
  }, null, { timeout: 15000 });
}

export async function navigateToWorkspace(page: Page, projectId = 'test-project-1') {
  await blockFirebaseCdnForMockedAuth(page);
  await page.context().setOffline(false);
  // `serve` canonicalizes .html URLs and drops their query string. Use its
  // clean local route so the workspace projectId reaches the application.
  await page.goto(`/workspace?projectId=${encodeURIComponent(projectId)}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => {
    const workspace = document.querySelector('#workspaceView');
    return !!workspace &&
      !workspace.classList.contains('hidden') &&
      document.body.classList.contains('auth-ready') &&
      !document.querySelector('#authOverlay');
  }, null, { timeout: 15000 });
}

export async function navigateLegacyIndex(page: Page) {
  await blockFirebaseCdnForMockedAuth(page);
  await page.context().setOffline(false);
  await page.goto('/index.html');
}

export async function waitForPmosServiceWorker(page: Page) {
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    try {
      await navigator.serviceWorker.ready;
      return !!navigator.serviceWorker.controller;
    } catch (e) {
      return false;
    }
  }, null, { timeout: 15000 });
}

export async function openPmosOffice(page: Page) {
  await blockFirebaseCdnForMockedAuth(page);
  await page.goto('/dashboard.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
}

export async function selectProject(page: Page, projectId: string) {
  const select = page.locator('#pmosProjectSelect');
  await expect(select).toBeVisible({ timeout: 10000 });
  await select.selectOption(projectId);
}

export async function openPmosModule(page: Page, module: string) {
  await page.evaluate((key) => (window as any).pmosOpenModule?.(key), module);
  await page.locator(`[data-pmos-form="${module}"]`).waitFor({ state: 'visible', timeout: 10000 });
}

async function submitCurrentPmosForm(page: Page, module: string) {
  const form = page.locator(`[data-pmos-form="${module}"]`);
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('#pmosSyncStatus')).toContainText(/Saved|offline|project|Firebase/i, { timeout: 10000 });
}

export async function fillQuickUpdate(page: Page, data: { category: string; note: string; priority?: string }) {
  await openPmosModule(page, 'quick');
  await page.locator('#pmos_quick_category').selectOption(data.category);
  await page.locator('#pmos_quick_note').fill(data.note);
  if (data.priority) await page.locator('#pmos_quick_priority').selectOption(data.priority);
  await submitCurrentPmosForm(page, 'quick');
}

export async function fillSiteLog(page: Page, data: { weather: string; accomplishment: string }) {
  await openPmosModule(page, 'sitelog');
  await page.locator('#pmos_sitelog_date').fill(new Date().toISOString().slice(0, 10));
  await page.locator('#pmos_sitelog_weather').fill(data.weather);
  await page.locator('#pmos_sitelog_manpowerCount').fill('6');
  await page.locator('#pmos_sitelog_accomplishment').fill(data.accomplishment);
  await page.locator('#pmos_sitelog_remarks').fill('E2E site log');
  await submitCurrentPmosForm(page, 'sitelog');
}

export async function fillIssue(page: Page, data: { location: string; issue: string; priority?: string }) {
  await openPmosModule(page, 'issue');
  await page.locator('#pmos_issue_location').fill(data.location);
  await page.locator('#pmos_issue_issue').fill(data.issue);
  await page.locator('#pmos_issue_assignedTo').fill('QA Foreman');
  await page.locator('#pmos_issue_dueDate').fill(new Date().toISOString().slice(0, 10));
  if (data.priority) await page.locator('#pmos_issue_priority').selectOption(data.priority);
  await submitCurrentPmosForm(page, 'issue');
}

export async function fillMaterialRequest(page: Page, items: Array<{ item: string; quantity?: string; unit?: string }>) {
  await openPmosModule(page, 'material');
  const first = items[0] || { item: 'Material' };
  await page.locator('#pmos_material_item').fill(first.item);
  await page.locator('#pmos_material_quantity').fill(first.quantity || '1');
  await page.locator('#pmos_material_unit').fill(first.unit || 'pcs');
  await page.locator('#pmos_material_neededDate').fill(new Date().toISOString().slice(0, 10));
  await page.locator('#pmos_material_purpose').fill('E2E material request');
  await submitCurrentPmosForm(page, 'material');
}

export async function fillFollowUp(page: Page, data: { task: string; person: string; priority?: string }) {
  await openPmosModule(page, 'task');
  await page.locator('#pmos_task_title').fill(data.task);
  await page.locator('#pmos_task_assignedToName').fill(data.person);
  await page.locator('#pmos_task_dueDate').fill(new Date().toISOString().slice(0, 10));
  if (data.priority) await page.locator('#pmos_task_priority').selectOption(data.priority);
  await submitCurrentPmosForm(page, 'task');
}

export async function fillMeetingNotes(page: Page, data: { title: string; type: string; attendees?: string; actionItems?: string }) {
  await openPmosModule(page, 'meeting');
  await page.locator('#pmos_meeting_meetingTitle').fill(data.title);
  await page.locator('#pmos_meeting_meetingDate').fill(new Date().toISOString().slice(0, 10));
  await page.locator('#pmos_meeting_meetingType').selectOption(data.type);
  if (data.attendees) await page.locator('#pmos_meeting_attendees').fill(data.attendees);
  if (data.actionItems) await page.locator('#pmos_meeting_actionItems').fill(data.actionItems);
  await submitCurrentPmosForm(page, 'meeting');
}

export async function goOffline(page: Page) {
  await page.context().setOffline(true);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); });
}

export async function goOnline(page: Page) {
  await page.context().setOffline(false);
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); });
}
