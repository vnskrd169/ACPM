import { expect, Page, test } from '@playwright/test';
import { aiScenarios, AiFixtureData } from './ai-command-center-fixtures';
import { buildInitScript, navigateToDashboard, navigateToWorkspace } from './helpers';

const OUTPUT_PATHS = [
  'ai/runtimeStatus',
  'ai/runs',
  'ai/events',
  'ai/findings',
  'ai/recommendations',
  'ai/decisions',
];

type TestUser = 'field' | 'reviewer' | 'pm' | 'boss';

async function setup(
  page: Page,
  user: TestUser,
  databaseData: AiFixtureData,
  options: { workspace?: boolean; failReadPaths?: string[] } = {},
) {
  await page.addInitScript(buildInitScript(user, {
    databaseData,
    failReadPaths: options.failReadPaths,
  }));
  if (options.workspace) await navigateToWorkspace(page);
  else await navigateToDashboard(page);
}

async function openCommandCenter(page: Page, workspace = false) {
  const button = page.locator(workspace ? '#openAiCommandCenterWorkspaceBtn' : '#openAiCommandCenterBtn');
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('#aiCommandCenterView')).toBeVisible();
  await page.waitForFunction(() => window.getAiCommandCenterDiagnostics?.().listenerCount === 6);
}

function summaryCard(page: Page, label: string) {
  return page.locator('.ai-summary-card').filter({ hasText: label });
}

test.describe('AI Command Center read-only Office UI', () => {
  test('1. hidden when uiEnabled=false', async ({ page }) => {
    const scenario = aiScenarios().H_AI_DISABLED;
    await setup(page, 'pm', scenario);
    await expect(page.locator('#openAiCommandCenterBtn')).toHaveCount(0);
    await expect(page.locator('#aiCommandCenterView')).toHaveCount(0);
    expect(await page.evaluate(() => window.__mockDbOnPaths.filter((path: string) => path.startsWith('ai/')))).toEqual([]);
  });

  test('2. visible for PM when enabled', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().A_HEALTHY_NO_ISSUES);
    await expect(page.locator('#openAiCommandCenterBtn')).toBeVisible();
    await openCommandCenter(page);
    await expect(page.locator('#aiCommandTitle')).toHaveText('AI Command Center');
  });

  test('3. boss/admin allowed', async ({ browser }) => {
    for (const user of ['boss', 'reviewer'] as const) {
      const page = await browser.newPage();
      await setup(page, user, aiScenarios().A_HEALTHY_NO_ISSUES);
      await expect(page.locator('#openAiCommandCenterBtn')).toBeVisible();
      await page.close();
    }
  });

  test('4. APM denied', async ({ page }) => {
    await setup(page, 'field', aiScenarios().A_HEALTHY_NO_ISSUES);
    await expect(page.locator('#openAiCommandCenterBtn')).toHaveCount(0);
    const paths = await page.evaluate(() => window.__mockDbPaths.slice());
    expect(paths).not.toContain('ai/uiStatus');
    expect(paths.some((path: string) => path.startsWith('ai/'))).toBe(false);
  });

  test('5. summary counts correct', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().D_TWO_WAITING_DECISIONS);
    await openCommandCenter(page);
    await expect(summaryCard(page, 'Agents Active').locator('strong')).toHaveText('3');
    await expect(summaryCard(page, 'Open Recommendations').locator('strong')).toHaveText('2');
    await expect(summaryCard(page, 'Waiting On You').locator('strong')).toHaveText('2');
    await expect(summaryCard(page, 'Runs Today').locator('strong')).toHaveText('2');
  });

  test('6. open decisions populate Waiting On You', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().D_TWO_WAITING_DECISIONS);
    await openCommandCenter(page);
    await expect(page.locator('#aiDecisionList .ai-review-card')).toHaveCount(2);
    await expect(page.locator('#aiWaitingCount')).toHaveText('2');
    await expect(page.locator('#aiDecisionList .ai-review-card').first()).toContainText('Critical material delivery conflict');
  });

  test('7. no-decisions empty state', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().A_HEALTHY_NO_ISSUES);
    await openCommandCenter(page);
    await expect(page.locator('#aiDecisionList')).toContainText('No decisions are waiting');
  });

  test('8. recommendations render', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().C_ONE_OPEN_RECOMMENDATION);
    await openCommandCenter(page);
    await expect(page.locator('#aiRecommendationList .ai-recommendation-card')).toHaveCount(1);
    await expect(page.locator('#aiRecommendationList')).toContainText('Review delivery risk');
    await expect(page.locator('#aiRecommendationList')).toContainText('E2E Test Project');
  });

  test('9. Unknown stays Unknown', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().E_UNKNOWN_IMPACTS);
    await openCommandCenter(page);
    const card = page.locator('#aiRecommendationList .ai-recommendation-card');
    await expect(card.getByText('Unknown', { exact: true })).toHaveCount(2);
    await expect(card).not.toContainText('0 days');
    await expect(card).not.toContainText(/₱\s*0/);
  });

  test('10. confirmed numeric values render only when present', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().F_CRITICAL_GROUNDED);
    await openCommandCenter(page);
    const card = page.locator('#aiRecommendationList .ai-recommendation-card');
    await expect(card).toContainText('4 days');
    await expect(card).toContainText(/₱\s*12,500/);
    await expect(card.getByText('Confirmed', { exact: true })).toHaveCount(2);
  });

  test('11. degraded runtime banner', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().G_PROVIDER_DEGRADED);
    await openCommandCenter(page);
    await expect(page.locator('#aiSystemStatus')).toHaveText('DEGRADED');
    await expect(page.locator('#aiCommandNotice')).toContainText('runtime health is degraded');
    await expect(page.locator('#aiRuntimeHealth')).toContainText('Degraded');
  });

  test('12. recent runs render', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().B_ACTIVE_RUNS);
    await openCommandCenter(page);
    await expect(page.locator('#aiRunActivity .ai-activity-item')).toHaveCount(2);
    await expect(page.locator('#aiRunActivity')).toContainText('Material Delivery Delayed');
    await expect(page.locator('#aiRunActivity')).toContainText('Task Overdue');
  });

  test('13. evidence refs render safely', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().F_CRITICAL_GROUNDED);
    await openCommandCenter(page);
    await page.locator('#aiDecisionList [data-ai-review]').click();
    const evidence = page.locator('#aiDecisionModalBody .ai-evidence-list');
    await expect(evidence).toContainText('projects/test-project-1/materials/mat-42');
    await expect(evidence).toContainText('deliveryDate');
    const paths = await page.evaluate(() => window.__mockDbPaths.slice());
    expect(paths).not.toContain('projects/test-project-1/materials/mat-42');
  });

  test('14. Review opens read-only detail', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().D_TWO_WAITING_DECISIONS);
    await openCommandCenter(page);
    await page.locator('#aiDecisionList [data-ai-review]').first().click();
    await expect(page.locator('#aiDecisionModal')).toBeVisible();
    await expect(page.locator('#aiDecisionModalBody')).toContainText('Human Decision Question');
    await expect(page.locator('#aiDecisionModalBody')).toContainText('Decision actions are not yet enabled.');
  });

  test('15. no approve/reject/resolve action exists', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().D_TWO_WAITING_DECISIONS);
    await openCommandCenter(page);
    await page.locator('#aiDecisionList [data-ai-review]').first().click();
    await expect(page.locator('#aiDecisionModal').getByRole('button', { name: /approve|reject|resolve|acknowledge|dismiss/i })).toHaveCount(0);
    expect(await page.evaluate(() => window.__mockDbWrites.filter((write: { path: string }) => write.path.startsWith('ai/')))).toEqual([]);
  });

  test('16. leaving Command Center detaches listeners', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().B_ACTIVE_RUNS);
    await openCommandCenter(page);
    await page.locator('#aiCommandBackBtn').click();
    await expect(page.locator('#hubView')).toBeVisible();
    expect(await page.evaluate(() => window.getAiCommandCenterDiagnostics().listenerCount)).toBe(0);
    const detached = await page.evaluate(() => window.__mockDbOffPaths.slice());
    for (const path of OUTPUT_PATHS) expect(detached).toContain(path);
  });

  test('17. logout cleanup', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().B_ACTIVE_RUNS);
    await openCommandCenter(page);
    await page.evaluate(() => window.firebase.auth().signOut());
    await page.waitForFunction(() => !document.querySelector('#openAiCommandCenterBtn'));
    await expect(page.locator('#aiCommandCenterView')).toHaveCount(0);
    const activeOutput = await page.evaluate(() => window.getAiCommandCenterDiagnostics?.().listenerCount || 0);
    expect(activeOutput).toBe(0);
  });

  test('18. dashboard -> Command Center -> dashboard', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().A_HEALTHY_NO_ISSUES);
    await expect(page.locator('#hubView')).toBeVisible();
    await openCommandCenter(page);
    await expect(page.locator('#hubView')).toBeHidden();
    await page.locator('#aiCommandBackBtn').click();
    await expect(page.locator('#hubView')).toBeVisible();
    await expect(page.locator('#openAiCommandCenterBtn')).toBeVisible();
  });

  test('19. workspace -> Command Center navigation', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().A_HEALTHY_NO_ISSUES, { workspace: true });
    await expect(page.locator('#workspaceView')).toBeVisible();
    await openCommandCenter(page, true);
    await expect(page.locator('#workspaceView')).toBeHidden();
    await page.locator('#aiCommandBackBtn').click();
    await expect(page.locator('#workspaceView')).toBeVisible();
  });

  test('20. mobile layout', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, 'pm', aiScenarios().D_TWO_WAITING_DECISIONS);
    await openCommandCenter(page);
    const layout = await page.locator('#aiCommandCenterView').evaluate((view) => ({
      scrollWidth: view.scrollWidth,
      clientWidth: view.clientWidth,
      summaryColumns: getComputedStyle(view.querySelector('.ai-summary-grid')!).gridTemplateColumns.split(' ').length,
      agentColumns: getComputedStyle(view.querySelector('.ai-agent-grid')!).gridTemplateColumns.split(' ').length,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.summaryColumns).toBe(1);
    expect(layout.agentColumns).toBe(1);
  });

  test('21. listener/data failure does not break Office', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().B_ACTIVE_RUNS, { failReadPaths: ['ai/runs'] });
    await openCommandCenter(page);
    await expect(page.locator('#aiCommandNotice')).toContainText('could not be read');
    await page.locator('#aiCommandBackBtn').click();
    await expect(page.locator('#hubView')).toBeVisible();
    await expect(page.locator('#openPmosOfficeBtn')).toBeVisible();
  });

  test('22. PM browser never attempts /ai/config read', async ({ page }) => {
    await setup(page, 'pm', aiScenarios().D_TWO_WAITING_DECISIONS);
    await openCommandCenter(page);
    await page.locator('#aiRefreshBtn').click();
    await page.locator('#aiDecisionList [data-ai-review]').first().click();
    const paths = await page.evaluate(() => window.__mockDbPaths.concat(window.__mockDbOnPaths));
    expect(paths).not.toContain('ai/config');
    expect(paths.some((path: string) => path.startsWith('ai/config/'))).toBe(false);
  });
});
