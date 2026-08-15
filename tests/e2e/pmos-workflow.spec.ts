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
  navigateToDashboard,
  navigateToWorkspace,
  navigateLegacyIndex,
} from './helpers';

test.describe('ACPM PM and APM Operations', () => {
  test('PM sees project creation, assignments, and all project cards', async ({ page }) => {
    page.addInitScript(buildInitScript('pm'));
    const errors = setupConsoleTracking(page);
    await navigateToDashboard(page);

    await expect(page.locator('.hub-create-card')).toBeVisible();
    await expect(page.locator('#teamAdminBtn')).toBeVisible();
    await expect(page.locator('#teamAdminBtn')).toContainText('Project Assignments');
    await expect(page.locator('#projectGrid .proj-card')).toHaveCount(1);
    await expect(page.locator('#dashAttnInfoList .dash-attn-item')).toHaveCount(1);
    await expect(page.locator('#dashAttnInfoList')).not.toContainText('<div');
    await expect(page.locator('#dashAttnWarningList')).not.toContainText('<span');
    expect(errors.length).toBe(0);
  });

  test('APM sees assigned projects without management controls', async ({ page }) => {
    page.addInitScript(buildInitScript('field'));
    const errors = setupConsoleTracking(page);
    await navigateToDashboard(page);

    await expect(page.locator('.hub-create-card')).toBeHidden();
    await expect(page.locator('#teamAdminBtn')).toBeHidden();
    await expect(page.locator('#projectGrid .proj-card')).toHaveCount(1);
    expect(errors.length).toBe(0);
  });

  test('PM opens Project Assignments without exposing project modules or boss-only admin tabs', async ({ page }) => {
    page.addInitScript(buildInitScript('pm'));
    const errors = setupConsoleTracking(page);
    await navigateToDashboard(page);

    await page.locator('#teamAdminBtn').click();
    await expect(page.locator('#workspaceView')).toBeVisible();
    await expect(page.locator('#adminPanel')).toBeVisible();
    await expect(page.locator('#adminTab_team')).toBeVisible();
    await expect(page.locator('#adminSection_team')).toBeVisible();
    await expect(page.locator('#adminTab_requests')).toBeHidden();
    await expect(page.locator('#adminTab_audit')).toBeHidden();
    await expect(page.locator('#adminTab_system')).toBeHidden();
    await expect(page.locator('[data-project-tab]:visible')).toHaveCount(0);
    await expect(page.locator('[data-team-user-row]')).toHaveCount(2);
    expect(errors.length).toBe(0);
  });

  test('PM workspace refresh preserves project and exposes Mission Board and Tasks', async ({ page }) => {
    page.addInitScript(buildInitScript('pm'));
    const errors = setupConsoleTracking(page);
    const navigations: string[] = [];
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    try {
      await navigateToWorkspace(page);
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        appPage: (window as any).getAppPage?.(),
        routeProjectId: (window as any).getRouteProjectId?.(),
        currentUser: (window as any)._currentUser,
        authUser: (window as any).getCurrentUser?.(),
        canAccessTestProject: (window as any).canAccessProject?.('test-project-1'),
        canReadTestProject: (window as any).canReadFullProject?.('test-project-1'),
        mockDbPaths: (window as any).__mockDbPaths,
      })).catch(() => ({}));
      console.log(JSON.stringify({ url: page.url(), navigations, browserErrors: errors, diagnostics }, null, 2));
      throw error;
    }

    await expect(page.locator('#tab_dashboard')).toBeVisible();
    await page.locator('#tab_dashboard').click();
    await expect(page.locator('#dashboardPanel')).toBeVisible();
    await expect(page.locator('#pdMissionList')).toBeVisible();
    await expect(page.locator('#tab_tasks')).toBeVisible();

    await page.reload();
    await page.waitForFunction(() => {
      const workspace = document.querySelector('#workspaceView');
      return !!workspace && !workspace.classList.contains('hidden') && document.body.classList.contains('auth-ready');
    }, null, { timeout: 15000 });
    expect(page.url()).toContain('projectId=test-project-1');
    expect(errors.length).toBe(0);
  });

  test('legacy index route leaves no old application shell', async ({ page }) => {
    page.addInitScript(buildInitScript('pm'));
    const errors = setupConsoleTracking(page);
    await navigateLegacyIndex(page);
    await page.waitForURL(/\/dashboard(?:\.html)?(?:[?#].*)?$/, { timeout: 15000 });
    await expect(page.locator('#hubView')).toBeVisible();
    expect(errors.length).toBe(0);
  });

  test('System Reports keeps a readable light-theme hover surface', async ({ page }) => {
    page.addInitScript(buildInitScript('boss'));
    const errors = setupConsoleTracking(page);
    await navigateToDashboard(page);

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      (window as any).openSystemReports();
    });
    await expect(page.locator('#systemReportsView')).toBeVisible();
    await page.locator('#executiveDashboard').hover();
    await page.waitForTimeout(300);

    const colors = await page.evaluate(() => {
      const panel = document.querySelector('#executiveDashboard');
      const healthName = document.querySelector('#systemReportsView .health-name');
      return {
        hoverToken: getComputedStyle(document.documentElement).getPropertyValue('--surface-hover').trim(),
        panelBackground: panel ? getComputedStyle(panel).backgroundColor : '',
        healthNameColor: healthName ? getComputedStyle(healthName).color : '',
      };
    });
    expect(colors.hoverToken.toLowerCase()).toBe('#f7f5ff');
    expect(colors.panelBackground).not.toBe('rgb(34, 38, 46)');
    expect(colors.healthNameColor).not.toBe('rgb(255, 255, 255)');
    expect(errors.length).toBe(0);
  });

  test('PMOS fits a field phone viewport without horizontal overflow', async ({ page }) => {
    page.addInitScript(buildInitScript('field'));
    await page.setViewportSize({ width: 390, height: 780 });
    await navigateToPmos(page);
    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport + 4);
  });
});

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
