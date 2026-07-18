import { Page, expect } from '@playwright/test';

/* ---- Test user definitions ---- */
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

/**
 * Inject a mock Firebase SDK + user into every page load.
 * This runs before any page scripts via addInitScript.
 */
function buildInitScript(userKey: keyof typeof TEST_USERS): string {
  const user = TEST_USERS[userKey];
  return `
    // Inject current user
    window._currentUser = ${JSON.stringify(user)};
    window._currentPid = 'test-project-1';

    // Mock Firebase SDK — uses Object.assign to merge function + static properties
    function makeDbRef() {
      return {
        once: function () { return Promise.resolve({ val: function () { return null; }, forEach: function () {} }); },
        on: function () {},
        off: function () {},
        update: function () { return Promise.resolve(); },
        set: function () { return Promise.resolve(); },
        push: function () { return { key: 'mock-key-' + Date.now() }; },
        orderByChild: function () { return this; },
        equalTo: function () { return this; },
        limitToLast: function () { return this; },
        limitToFirst: function () { return this; },
        endAt: function () { return this; },
        startAt: function () { return this; },
      };
    }

    window.firebase = {
      auth: function () {
        return {
          onAuthStateChanged: function (cb) {
            cb(Object.assign({}, ${JSON.stringify(user)}, { getIdToken: function() { return Promise.resolve('mock-token'); } }));
            return function () {};
          },
          signInAnonymously: function () { return Promise.resolve({ user: ${JSON.stringify(user)} }); },
          signOut: function () { return Promise.resolve(); },
        };
      },
      database: Object.assign(
        function () { return { ref: function () { return makeDbRef(); } }; },
        { ServerValue: { TIMESTAMP: Date.now() } }
      ),
      storage: Object.assign(
        function () {
          return {
            ref: function () {
              return {
                put: function () { return { on: function () {} }; },
                getDownloadURL: function () { return Promise.resolve('https://mock-storage.url/photo.jpg'); },
                delete: function () { return Promise.resolve(); },
              };
            },
          };
        },
        { TaskEvent: { STATE_CHANGED: 'state_changed' } }
      ),
    };

    // Set PMOS globals
    window.APP_VERSION = '1.0.0';
    window.PMOS_VERSION = '1.0.0';
    window.CACHE_VERSION = 'acpm-pmos-v1';
    window.PMOS_SCHEMA_VERSION = '1.0';
    window.PMOS_CONFIG = {
      faceAttendanceEnabled: false,
      photoProvider: 'firebase-storage',
      maxPhotoSize: 20971520,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    };
  `;
}

/**
 * Setup page with console error tracking.
 * Call this in beforeEach BEFORE any navigation.
 */
export function setupConsoleTracking(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    errors.push(err.message);
  });
  return errors;
}

/**
 * Navigate to the PMOS mobile application
 */
export async function navigateToPmos(page: Page) {
  await page.goto('/pmos.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
}

/**
 * Open the PMOS Office Hub from the ACPM index
 */
export async function openPmosOffice(page: Page) {
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
}

/**
 * Select a project in the PMOS mobile interface
 */
export async function selectProject(page: Page, projectId: string) {
  const select = page.locator('#pmosProjectSelect');
  if (await select.isVisible({ timeout: 5000 }).catch(() => false)) {
    await select.selectOption(projectId).catch(() => {});
    await page.waitForTimeout(500);
  }
}

/**
 * Navigate to a specific PMOS module tab
 */
export async function openPmosModule(page: Page, module: string) {
  const tab = page.locator(`#pmosTab_${module}`);
  if (await tab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Fill a Quick Update form and submit
 */
export async function fillQuickUpdate(page: Page, data: { category: string; note: string; priority?: string }) {
  await openPmosModule(page, 'quick');
  const cat = page.locator('#pmosQuickCategory');
  if (await cat.isVisible({ timeout: 5000 }).catch(() => false)) { await cat.selectOption(data.category); }
  const note = page.locator('#pmosQuickNote');
  if (await note.isVisible().catch(() => false)) { await note.fill(data.note); }
  if (data.priority) {
    const pri = page.locator('#pmosQuickPriority');
    if (await pri.isVisible().catch(() => false)) { await pri.selectOption(data.priority); }
  }
  const save = page.locator('#pmosQuickSave');
  if (await save.isVisible({ timeout: 5000 }).catch(() => false)) { await save.click(); }
  await page.waitForTimeout(500);
}

/**
 * Fill a Site Log form and submit
 */
export async function fillSiteLog(page: Page, data: { weather: string; accomplishment: string }) {
  await openPmosModule(page, 'sitelog');
  const weather = page.locator('#pmosSiteWeather');
  if (await weather.isVisible({ timeout: 5000 }).catch(() => false)) { await weather.fill(data.weather); }
  const acc = page.locator('#pmosSiteAccomplishment');
  if (await acc.isVisible().catch(() => false)) { await acc.fill(data.accomplishment); }
  const save = page.locator('#pmosSiteSave');
  if (await save.isVisible({ timeout: 5000 }).catch(() => false)) { await save.click(); }
  await page.waitForTimeout(500);
}

/**
 * Fill an Issue form and submit
 */
export async function fillIssue(page: Page, data: { location: string; issue: string; priority?: string }) {
  await openPmosModule(page, 'issue');
  const loc = page.locator('#pmosIssueLocation');
  if (await loc.isVisible({ timeout: 5000 }).catch(() => false)) { await loc.fill(data.location); }
  const desc = page.locator('#pmosIssueDescription');
  if (await desc.isVisible().catch(() => false)) { await desc.fill(data.issue); }
  if (data.priority) {
    const pri = page.locator('#pmosIssuePriority');
    if (await pri.isVisible().catch(() => false)) { await pri.selectOption(data.priority); }
  }
  const save = page.locator('#pmosIssueSave');
  if (await save.isVisible({ timeout: 5000 }).catch(() => false)) { await save.click(); }
  await page.waitForTimeout(500);
}

/**
 * Fill a Material Request with multiple items and submit
 */
export async function fillMaterialRequest(page: Page, items: Array<{ item: string; quantity?: string; unit?: string }>) {
  await openPmosModule(page, 'material');
  for (const data of items) {
    const itemField = page.locator('#pmosMaterialItem');
    if (await itemField.isVisible({ timeout: 5000 }).catch(() => false)) { await itemField.fill(data.item); }
    if (data.quantity) {
      const qtyField = page.locator('#pmosMaterialQuantity');
      if (await qtyField.isVisible().catch(() => false)) { await qtyField.fill(data.quantity); }
    }
    if (data.unit) {
      const unitField = page.locator('#pmosMaterialUnit');
      if (await unitField.isVisible().catch(() => false)) { await unitField.selectOption(data.unit); }
    }
    const addBtn = page.locator('#pmosMaterialAdd').or(page.locator('button:text("Add")'));
    if (await addBtn.isVisible().catch(() => false)) { await addBtn.click(); }
    await page.waitForTimeout(300);
  }
  const submitBtn = page.locator('#pmosMaterialSubmit').or(page.locator('button:text("Submit")'));
  if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) { await submitBtn.click(); }
  await page.waitForTimeout(500);
}

/**
 * Fill a Follow-up form and submit
 */
export async function fillFollowUp(page: Page, data: { task: string; person: string; priority?: string }) {
  await openPmosModule(page, 'task');
  const desc = page.locator('#pmosTaskDescription');
  if (await desc.isVisible({ timeout: 5000 }).catch(() => false)) { await desc.fill(data.task); }
  const person = page.locator('#pmosTaskPerson');
  if (await person.isVisible().catch(() => false)) { await person.fill(data.person); }
  if (data.priority) {
    const pri = page.locator('#pmosTaskPriority');
    if (await pri.isVisible().catch(() => false)) { await pri.selectOption(data.priority); }
  }
  const save = page.locator('#pmosTaskSave');
  if (await save.isVisible({ timeout: 5000 }).catch(() => false)) { await save.click(); }
  await page.waitForTimeout(500);
}

/**
 * Fill a Meeting Notes form and submit
 */
export async function fillMeetingNotes(page: Page, data: { title: string; type: string; attendees?: string; actionItems?: string }) {
  await openPmosModule(page, 'meeting');
  const title = page.locator('#pmosMeetingTitle');
  if (await title.isVisible({ timeout: 5000 }).catch(() => false)) { await title.fill(data.title); }
  const type = page.locator('#pmosMeetingType');
  if (await type.isVisible().catch(() => false)) { await type.selectOption(data.type); }
  if (data.attendees) {
    const att = page.locator('#pmosMeetingAttendees');
    if (await att.isVisible().catch(() => false)) { await att.fill(data.attendees); }
  }
  if (data.actionItems) {
    const ai = page.locator('#pmosMeetingActionItems');
    if (await ai.isVisible().catch(() => false)) { await ai.fill(data.actionItems); }
  }
  const save = page.locator('#pmosMeetingSave');
  if (await save.isVisible({ timeout: 5000 }).catch(() => false)) { await save.click(); }
  await page.waitForTimeout(500);
}

/**
 * Simulate going offline
 */
export async function goOffline(page: Page) {
  await page.context().setOffline(true);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); });
}

/**
 * Simulate going online
 */
export async function goOnline(page: Page) {
  await page.context().setOffline(false);
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); });
}
