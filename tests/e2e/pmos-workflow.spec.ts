import { test, expect } from '@playwright/test';
import {
  buildInitScript,
  setupConsoleTracking,
  navigateToPmos,
  navigateToBlockedPmos,
  waitForPmosServiceWorker,
  selectProject,
  fillQuickUpdate,
  fillSiteLog,
  fillIssue,
  fillMaterialRequest,
  fillFollowUp,
  fillMeetingNotes,
  openPmosOffice,
  goOffline,
  goOnline,
} from './helpers';

test.describe('PMOS Field User Workflow', () => {
  test.beforeEach(async ({ page }) => {
    page.addInitScript(buildInitScript('field'));
  });

  test('should load the PMOS application shell', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
    expect(errors.length).toBe(0);
  });

  test('should create and submit a Quick Update', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    await selectProject(page, 'test-project-1');
    await fillQuickUpdate(page, { category: 'General', note: 'Test quick update from E2E', priority: 'Normal' });
    expect(errors.length).toBe(0);
  });

  test('should create a Site Log', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    await selectProject(page, 'test-project-1');
    await fillSiteLog(page, { weather: 'Sunny', accomplishment: 'Completed formwork inspection' });
    expect(errors.length).toBe(0);
  });

  test('should create an Issue', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    await selectProject(page, 'test-project-1');
    await fillIssue(page, { location: 'Area 42', issue: 'Rebar spacing out of tolerance', priority: 'High' });
    expect(errors.length).toBe(0);
  });

  test('should create a Material Request with multiple items', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    await selectProject(page, 'test-project-1');
    await fillMaterialRequest(page, [
      { item: 'Deformed Bars 16mm' },
      { item: 'Tie Wire #16' },
      { item: 'Plywood 1/4" 4x8' },
    ]);
    expect(errors.length).toBe(0);
  });

  test('should create a Follow-up task', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    await selectProject(page, 'test-project-1');
    await fillFollowUp(page, { task: 'Verify rebar spacing correction by Friday', person: 'John Foreman', priority: 'High' });
    expect(errors.length).toBe(0);
  });

  test('should create Meeting Notes', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    await selectProject(page, 'test-project-1');
    await fillMeetingNotes(page, {
      title: 'Weekly Site Coordination',
      type: 'Site Coordination',
      attendees: 'Engineer A, Foreman B, Safety Officer C',
      actionItems: '1. Complete rebar inspection\n2. Submit material request\n3. Review safety plan',
    });
    expect(errors.length).toBe(0);
  });

  test('should work offline and queue records', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    await selectProject(page, 'test-project-1');

    await fillQuickUpdate(page, { category: 'General', note: 'Online record', priority: 'Normal' });

    await goOffline(page);
    await fillQuickUpdate(page, { category: 'General', note: 'Offline record', priority: 'Normal' });

    // Allow benign offline-related console messages (e.g., ERR_INTERNET_DISCONNECTED from resource fetch)
    const criticalErrors = errors.filter(e =>
      !e.includes('ERR_INTERNET_DISCONNECTED')
    );
    expect(criticalErrors.length).toBe(0);

    await goOnline(page);
    await page.waitForTimeout(500);
  });
});

test.describe('PMOS Reviewer Workflow', () => {
  test.beforeEach(async ({ page }) => {
    page.addInitScript(buildInitScript('reviewer'));
  });

  test('should open PMOS Office and see content', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await openPmosOffice(page);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
    expect(errors.length).toBe(0);
  });

  test('should switch between Office views', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await openPmosOffice(page);
    const views = ['feed', 'issues', 'materials', 'tasks', 'sitelogs', 'photos', 'meetings', 'reports'];
    for (const view of views) {
      const tab = page.locator(`#pmosOfficeTab_${view}`);
      if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(300);
      }
    }
    expect(errors.length).toBe(0);
  });

  test('should open the Issue Board', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await openPmosOffice(page);
    const tab = page.locator('#pmosOfficeTab_issues');
    if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(500);
    }
    expect(errors.length).toBe(0);
  });

  test('should open the Meeting Notes view', async ({ page }) => {
    const errors = setupConsoleTracking(page);
    await openPmosOffice(page);
    const tab = page.locator('#pmosOfficeTab_meetings');
    if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(500);
    }
    expect(errors.length).toBe(0);
  });
});

test.describe('PMOS Viewer Workflow', () => {
  test('should block Viewer access in RC1', async ({ page }) => {
    page.addInitScript(buildInitScript('viewer'));
    const errors = setupConsoleTracking(page);
    await navigateToBlockedPmos(page);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
    expect(bodyText).toContain('not active in RC1');
    expect(errors.length).toBe(0);
  });
});

test.describe('PMOS Boss Workflow', () => {
  test('should have full access as Boss', async ({ page }) => {
    page.addInitScript(buildInitScript('boss'));
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
    expect(errors.length).toBe(0);
  });
});

test.describe('PMOS PWA and Offline', () => {
  test('should load pmos.html without errors', async ({ page }) => {
    page.addInitScript(buildInitScript('field'));
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
    expect(errors.length).toBe(0);
  });

  test('should handle offline state gracefully', async ({ page }) => {
    page.addInitScript(buildInitScript('field', { disableServiceWorker: false }));
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    await waitForPmosServiceWorker(page);
    await goOffline(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });
});

test.describe('PMOS Logout Cleanup', () => {
  test('should handle state after logout', async ({ page }) => {
    page.addInitScript(buildInitScript('field'));
    const errors = setupConsoleTracking(page);
    await navigateToPmos(page);
    // Wait for any redirect to complete before interacting
    await page.waitForURL('**/pmos/', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.evaluate(() => { localStorage.clear(); }).catch(() => {});
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    expect(errors.length).toBe(0);
  });
});
