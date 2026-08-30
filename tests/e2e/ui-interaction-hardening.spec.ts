import { expect, Page, test } from '@playwright/test';
import { aiScenarios, AiFixtureData } from './ai-command-center-fixtures';
import { buildInitScript, navigateToDashboard, navigateToPmos, navigateToWorkspace } from './helpers';

function projectFixtures(count = 1) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const id = index === 0 ? 'test-project-1' : `test-project-${index + 1}`;
    return [id, {
      id,
      name: `Integrity Project ${index + 1}`,
      status: 'active',
      createdAt: 1780000000000 - index,
      laborBudget: 100000,
      materialBudget: 150000,
    }];
  }));
}

function pmosFixtureData(): Record<string, unknown> {
  const now = Date.now();
  return {
    projects: projectFixtures(2),
    pmosIssues: {
      'issue-open': { id: 'issue-open', projectId: 'test-project-1', issue: 'Open integrity issue', status: 'New', createdAt: now },
      'issue-done': { id: 'issue-done', projectId: 'test-project-1', issue: 'Completed integrity issue', status: 'Done', createdAt: now - 1 },
    },
    pmosPhotoLogs: {
      'photo-1': {
        id: 'photo-1', projectId: 'test-project-1', projectName: 'Integrity Project 1', caption: 'Proof photo',
        photoUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
        thumbnailUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
        storageProvider: 'Google Drive', status: 'New', createdAt: now,
      },
    },
  };
}

async function setupOffice(page: Page, data: Record<string, unknown>) {
  await page.addInitScript(buildInitScript('reviewer', { databaseData: data }));
  await navigateToDashboard(page);
}

async function openAi(page: Page) {
  await page.locator('#openAiCommandCenterBtn').click();
  await expect(page.locator('#aiCommandCenterView')).toBeVisible();
  await page.waitForFunction(() => (window as any).getAiCommandCenterDiagnostics?.().listenerCount === 7);
}

async function scrollPageToBottom(page: Page) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(40);
    const reached = await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2);
    if (reached) return true;
  }
  return false;
}

test.describe('UI integrity and interaction hardening', () => {
  test('dashboard card controls are semantic, keyboard reachable, and navigate', async ({ page }) => {
    await setupOffice(page, { projects: projectFixtures(2) });

    const riskCard = page.locator('#dsCriticalCard');
    await expect(riskCard).toHaveJSProperty('tagName', 'BUTTON');
    await riskCard.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#activeProjectsPane')).toBeVisible();

    const openWorkspace = page.locator('.proj-card .proj-open-btn').first();
    await expect(openWorkspace).toBeVisible();
    const workspaceRequest = page.waitForRequest(request => request.url().includes('/workspace.html?projectId=test-project-1'));
    await openWorkspace.click();
    await workspaceRequest;
    await navigateToWorkspace(page);
    await expect(page.locator('#workspaceView')).toBeVisible();
  });

  test('Office modal repeats safely, scrolls internally, and restores page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await setupOffice(page, { projects: projectFixtures(8) });
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
    const editButton = page.locator('.proj-card .btn-edit-proj').first();
    await expect(editButton).toBeVisible();
    await editButton.evaluate(button => button.scrollIntoView({ block: 'center' }));

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await editButton.click();
      const modal = page.locator('#editProjectModal');
      await expect(modal).toBeVisible();
      await expect(page.locator('body')).toHaveClass(/overlay-scroll-locked/);
      const before = await page.evaluate(() => window.scrollY);

      if (cycle === 0) {
        await modal.locator('.modal-box').evaluate(box => {
          const filler = document.createElement('div');
          filler.dataset.testLongContent = '1';
          filler.style.height = '1400px';
          filler.style.flex = '0 0 1400px';
          box.insertBefore(filler, box.querySelector('.modal-actions'));
          box.scrollTop = box.scrollHeight;
        });
        expect(await modal.locator('.modal-box').evaluate(box => box.scrollTop > 0)).toBe(true);
      }

      await modal.getByRole('button', { name: 'Cancel' }).click();
      await expect(modal).toBeHidden();
      await expect(page.locator('body')).not.toHaveClass(/overlay-scroll-locked/);
      expect(await page.evaluate(() => window.scrollY)).toBe(before);
    }
    await expect(page.locator('[data-test-long-content]')).toHaveCount(1);
  });

  test('PMOS Office listeners, filters, project switching, and close lifecycle are deterministic', async ({ page }) => {
    await setupOffice(page, pmosFixtureData());
    await page.locator('#openPmosOfficeBtn').click();
    await expect(page.locator('#pmosOfficeView')).toBeVisible();
    await page.waitForFunction(() => (window as any).getPmosOfficeDiagnostics?.().listenerCount === 8);

    await page.locator('#pmosOfficeTab_issues').click();
    await page.waitForFunction(() => (window as any).getPmosOfficeDiagnostics?.().listenerCount === 1);
    await page.locator('#pmosIssueFilter').selectOption('done');
    await expect(page.locator('#pmosIssueFilter')).toHaveValue('done');
    await expect(page.locator('.pmos-board-card')).toHaveCount(1);
    await expect(page.locator('.pmos-board-card')).toContainText('Completed integrity issue');

    await page.evaluate(() => (window as any).setPmosOfficeProject('test-project-1'));
    await page.waitForFunction(() => (window as any).getPmosOfficeDiagnostics?.().projectId === 'test-project-1');
    expect(await page.evaluate(() => (window as any).getPmosOfficeDiagnostics().listenerCount)).toBe(1);
    await page.evaluate(() => (window as any).setPmosOfficeProject('test-project-1'));
    expect(await page.evaluate(() => (window as any).getPmosOfficeDiagnostics().listenerCount)).toBe(1);

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('#hubView')).toBeVisible();
    expect(await page.evaluate(() => (window as any).getPmosOfficeDiagnostics().listenerCount)).toBe(0);

    await page.locator('#openPmosOfficeBtn').click();
    await expect(page.locator('#pmosOfficeView')).toBeVisible();
    await page.waitForFunction(() => (window as any).getPmosOfficeDiagnostics?.().listenerCount === 1);
    await expect(page.locator('#pmosIssueFilter')).toHaveValue('done');
  });

  test('PMOS photo preview opens once, traps focus, closes, and leaves no overlay', async ({ page }) => {
    await setupOffice(page, pmosFixtureData());
    await page.locator('#openPmosOfficeBtn').click();
    await page.locator('#pmosOfficeTab_photos').click();
    const preview = page.getByRole('button', { name: 'Preview' });
    await expect(preview).toBeVisible();

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await preview.click();
      await expect(page.locator('#pmosLightbox')).toBeVisible();
      await expect(page.locator('.pmos-lightbox-close')).toBeFocused();
      await expect(page.locator('body')).toHaveClass(/overlay-scroll-locked/);
      expect(await page.evaluate(() => (window as any).getPmosLightboxDiagnostics())).toEqual({ open: true, keyListenerActive: true });
      await page.keyboard.press('Escape');
      await expect(page.locator('#pmosLightbox')).toHaveCount(0);
      await expect(page.locator('body')).not.toHaveClass(/overlay-scroll-locked/);
      await expect(preview).toBeFocused();
    }
  });

  test('PMOS Field action sheet supports repeated mobile click and Escape cleanup', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.addInitScript(buildInitScript('field'));
    await navigateToPmos(page);

    const create = page.locator('#pmosNavTab_create');
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await create.click();
      await expect(page.locator('#pmosActionSheet')).toBeVisible();
      await expect(page.locator('#pmosActionSheet .pmos-action-sheet-btn').first()).toBeFocused();
      await expect(page.locator('body')).toHaveClass(/overlay-scroll-locked/);
      await page.keyboard.press('Escape');
      await expect(page.locator('#pmosActionSheet')).toBeHidden();
      await expect(page.locator('body')).not.toHaveClass(/overlay-scroll-locked/);
      await expect(create).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });

  test('AI decision Escape closes only the modal, restores focus, then closes the view', async ({ page }) => {
    await setupOffice(page, aiScenarios().D_TWO_WAITING_DECISIONS);
    await openAi(page);
    const review = page.locator('#aiDecisionList [data-ai-review]').first();
    await review.click();
    await expect(page.locator('#aiDecisionModal')).toBeVisible();
    await expect(page.locator('#aiDecisionModalClose')).toBeFocused();
    await expect(page.locator('body')).toHaveClass(/overlay-scroll-locked/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#aiDecisionModal')).toBeHidden();
    await expect(page.locator('#aiCommandCenterView')).toBeVisible();
    await expect(review).toBeFocused();
    await expect(page.locator('body')).not.toHaveClass(/overlay-scroll-locked/);
    expect(await page.evaluate(() => (window as any).getAiCommandCenterDiagnostics().listenerCount)).toBe(7);

    await page.keyboard.press('Escape');
    await expect(page.locator('#hubView')).toBeVisible();
    expect(await page.evaluate(() => (window as any).getAiCommandCenterDiagnostics().listenerCount)).toBe(0);
  });

  test('PMOS -> AI -> PMOS transition reinitializes only the active listener set', async ({ page }) => {
    const data = { ...pmosFixtureData(), ...aiScenarios().A_HEALTHY_NO_ISSUES } as AiFixtureData;
    await setupOffice(page, data);
    await page.locator('#openPmosOfficeBtn').click();
    await page.waitForFunction(() => (window as any).getPmosOfficeDiagnostics?.().listenerCount === 8);

    await page.evaluate(() => (window as any).openAiCommandCenter());
    await expect(page.locator('#aiCommandCenterView')).toBeVisible();
    expect(await page.evaluate(() => (window as any).getPmosOfficeDiagnostics().listenerCount)).toBe(0);
    await page.waitForFunction(() => (window as any).getAiCommandCenterDiagnostics?.().listenerCount === 7);

    await page.locator('#aiCommandBackBtn').click();
    await expect(page.locator('#pmosOfficeView')).toBeVisible();
    await page.waitForFunction(() => (window as any).getPmosOfficeDiagnostics?.().listenerCount === 8);
    expect(await page.evaluate(() => (window as any).getAiCommandCenterDiagnostics().listenerCount)).toBe(0);
  });

  test('logout and re-login tear down and reinitialize PMOS listeners once', async ({ page }) => {
    await setupOffice(page, pmosFixtureData());
    await page.locator('#openPmosOfficeBtn').click();
    await page.waitForFunction(() => (window as any).getPmosOfficeDiagnostics?.().listenerCount === 8);

    const loginNavigation = page.waitForURL('**/login', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.evaluate(() => (window as any).firebase.auth().signOut());
    await page.waitForFunction(() => ((window as any).getPmosOfficeDiagnostics?.().listenerCount || 0) === 0);
    await loginNavigation;

    // The mock auth fixture starts each navigation with the same signed-in
    // reviewer, so the login shell performs the fresh-login dashboard redirect.
    await page.waitForURL('**/dashboard', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForFunction(() => {
      const hub = document.querySelector('#hubView');
      return !!hub && !hub.classList.contains('hidden') && document.body.classList.contains('auth-ready');
    });
    await page.locator('#openPmosOfficeBtn').click();
    await page.waitForFunction(() => (window as any).getPmosOfficeDiagnostics?.().listenerCount === 8);
    expect(await page.evaluate(() => (window as any).getPmosOfficeDiagnostics().listenerCount)).toBe(8);
  });

  test('long Office and AI pages reach the bottom without horizontal overflow at four viewports', async ({ page }) => {
    const scenario = aiScenarios().C_ONE_OPEN_RECOMMENDATION;
    const baseRecommendation = Object.values(scenario['ai/recommendations'] as Record<string, any>)[0];
    scenario['ai/recommendations'] = Object.fromEntries(Array.from({ length: 45 }, (_, index) => [
      `rec-${index}`,
      { ...baseRecommendation, title: `Long recommendation ${index + 1}`, createdAt: Date.now() - index },
    ]));
    const data = { ...scenario, projects: projectFixtures(35) };
    await setupOffice(page, data);

    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
      { width: 820, height: 1180 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await scrollPageToBottom(page)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

      await page.evaluate(() => window.scrollTo(0, 0));
      await openAi(page);
      expect(await scrollPageToBottom(page)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      await page.locator('#aiCommandBackBtn').click();
      await expect(page.locator('#hubView')).toBeVisible();
      expect(await page.evaluate(() => (window as any).getAiCommandCenterDiagnostics().listenerCount)).toBe(0);
    }
  });
});
