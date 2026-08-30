import { expect, Page, test } from '@playwright/test';
import { aiScenarios, zeroBudgetScenarios, AiFixtureData } from './ai-command-center-fixtures';
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

async function captureIfRequested(page: Page, path: string) {
  if (process.env.ACPM_CAPTURE_SCREENSHOTS !== '1') return;
  const dismiss = page.locator('.toast-msg .toast-dismiss');
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
    await expect(page.locator('.toast-msg')).toHaveCount(0);
  }
  await page.screenshot({ path, fullPage: true });
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
    await expect(page.locator('#aiWaitingCount')).toHaveText('2');
    await expect(page.locator('#aiRecommendationList .ai-recommendation-card')).toHaveCount(2);
    await expect(page.locator('#aiTodayHeading')).toHaveText('Everything looks on track.');
    await expect(page.locator('#aiAgentStatus')).toContainText('Advanced analysis working');
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
    await expect(page.locator('#aiSystemStatus')).toHaveText('DETERMINISTIC INTELLIGENCE');
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
      agentColumns: getComputedStyle(view.querySelector('.ai-agent-grid')!).gridTemplateColumns.split(' ').length,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.agentColumns).toBe(1);
  });

  test('23. provider-off zero-budget mode remains operational', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z9_PROVIDER_OFF_MONITORING);
    await openCommandCenter(page);
    await expect(page.locator('#aiTodayHeading')).toHaveText('1 thing needs attention');
    await expect(page.locator('#aiCommandNotice')).toContainText('Rule-based operational monitoring remains available');
    await expect(page.locator('#aiRuntimeHealth')).toContainText('Operational monitoring');
    await expect(page.locator('#aiRuntimeHealth')).toContainText('Available');
    await expect(page.locator('#aiRuntimeHealth')).toContainText('Advanced AI analysis');
    await expect(page.locator('#aiRuntimeHealth')).toContainText('Not configured');
    await captureIfRequested(page, 'test-results/ai-zero-budget-desktop.png');
  });

  test('24. overdue and blocked attention counts come from stored tasks', async ({ browser }) => {
    for (const [scenario, title] of [
      [zeroBudgetScenarios().Z2_OVERDUE_TASK, 'Overdue task'],
      [zeroBudgetScenarios().Z3_BLOCKED_TASK, 'Blocked task'],
    ] as const) {
      const page = await browser.newPage();
      await setup(page, 'pm', scenario);
      await openCommandCenter(page);
      await expect(page.locator('#aiNeedsActionCount')).toHaveText('1');
      await expect(page.locator('#aiAttentionList .ai-attention-card')).toHaveCount(1);
      await expect(page.locator('#aiAttentionList')).toContainText(title);
      await page.close();
    }
  });

  test('25. missing attendance is unresolved and never absent', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z4_UNRESOLVED_ATTENDANCE);
    await openCommandCenter(page);
    const card = page.locator('#aiAttentionList .ai-attention-card');
    await expect(card).toContainText('Unresolved attendance');
    await expect(card).toContainText('2 attendance entries are unresolved');
    await expect(card).not.toContainText(/absent/i);
  });

  test('26. partial delivery uses exact quantities and never guesses stock', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z5_PARTIAL_DELIVERY);
    await openCommandCenter(page);
    const list = page.locator('#aiAttentionList');
    await expect(list).toContainText('Received 80 sheets / 100 sheets. Pending 20 sheets.');
    await expect(list).not.toContainText(/out of stock|stock shortage|reorder/i);
    await expect(page.locator('#aiNeedsActionCount')).toHaveText('1');
  });

  test('27. open and aging issue fixtures retain deterministic wording', async ({ browser }) => {
    const cases = [
      [zeroBudgetScenarios().Z6_OPEN_SITE_ISSUE, 'Open site issue', 'low'],
      [zeroBudgetScenarios().Z7_AGING_SITE_ISSUE, 'Aging site issue', 'medium'],
    ] as const;
    for (const [scenario, title, severity] of cases) {
      const page = await browser.newPage();
      await setup(page, 'pm', scenario);
      await openCommandCenter(page);
      await expect(page.locator('#aiAttentionList')).toContainText(title);
      await expect(page.locator('#aiAttentionList .ai-severity')).toHaveText(severity);
      await page.close();
    }
  });

  test('28. project summaries use real counts and no arbitrary score', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z8_MULTIPLE_PROJECTS);
    await openCommandCenter(page);
    const rows = page.locator('#aiProjectSummary .ai-project-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'RCBC Plaza' })).toContainText('1 attention item');
    await expect(rows.filter({ hasText: 'Coffee Bay' })).toContainText('On track');
    await expect(page.locator('#aiProjectSummary')).not.toContainText(/\d+\s*\/\s*100|health score|% health/i);
  });

  test('29. Needs Action and Waiting On You remain distinct', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z10_AI_DECISION_AND_ATTENTION);
    await openCommandCenter(page);
    await expect(page.locator('#aiNeedsActionCount')).toHaveText('1');
    await expect(page.locator('#aiWaitingCount')).toHaveText('2');
    await expect(page.locator('.ai-needs-action-panel')).toContainText('System detected');
    await expect(page.locator('.ai-waiting-panel')).toContainText('Actual AI decisions');
    await captureIfRequested(page, 'test-results/ai-zero-budget-mixed.png');
  });

  test('30. allowlisted action navigates to the actual task screen without mutation', async ({ page }) => {
    const scenario = zeroBudgetScenarios().Z2_OVERDUE_TASK;
    await setup(page, 'pm', scenario, { workspace: true });
    await openCommandCenter(page, true);
    const writesBefore = await page.evaluate(() => window.__mockDbWrites.length);
    await page.locator('#aiAttentionList [data-ai-destination="task"]').click();
    await expect(page.locator('#workspaceView')).toBeVisible();
    await expect(page.locator('#tasksPanel')).toBeVisible();
    expect(await page.evaluate(() => window.__mockDbWrites.length)).toBe(writesBefore);
  });

  test('31. calm empty state stays compact', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z1_NO_ATTENTION);
    await openCommandCenter(page);
    await expect(page.locator('#aiTodayHeading')).toHaveText('Everything looks on track.');
    await expect(page.locator('#aiTodaySummary')).toHaveText('No operational issues currently need your attention.');
    await expect(page.locator('#aiAttentionList .ai-attention-card')).toHaveCount(0);
    await expect(page.locator('#aiProjectSummary .ai-project-row')).toHaveCount(1);
  });

  test('32. provider-off monitor labels never pretend an LLM is working', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z9_PROVIDER_OFF_MONITORING);
    await openCommandCenter(page);
    await expect(page.locator('#aiAgentStatus')).toContainText('PM Agent');
    await expect(page.locator('#aiAgentStatus')).toContainText('Advanced analysis unavailable');
    await expect(page.locator('#aiAgentStatus')).toContainText('Planning Monitor');
    await expect(page.locator('#aiAgentStatus')).toContainText('Materials Monitor');
    await expect(page.locator('#aiAgentStatus').getByText('Rule-based monitoring active', { exact: true })).toHaveCount(2);
    await expect(page.locator('#aiAgentStatus')).not.toContainText(/\bWorking\b/);
  });

  test('33. zero-budget mobile view keeps navigation and document width intact', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, 'pm', zeroBudgetScenarios().Z9_PROVIDER_OFF_MONITORING);
    await openCommandCenter(page);
    const metrics = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      viewport: document.documentElement.clientWidth,
      actionVisible: !!document.querySelector('#aiAttentionList [data-ai-destination]'),
    }));
    expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.actionVisible).toBe(true);
    await expect(page.locator('#aiCommandBackBtn')).toBeVisible();
    await captureIfRequested(page, 'test-results/ai-zero-budget-mobile.png');
  });

  test('34. Daily Brief concisely covers normalized operational attention', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z11_DAILY_BRIEF);
    await openCommandCenter(page);
    const brief = page.locator('.ai-daily-brief');
    const lines = brief.locator('#aiDailyBriefLines p');
    const copy = await lines.allTextContents();

    await expect(brief).toContainText('Deterministic daily brief');
    await expect(brief).toContainText('Rule-based · no AI generation');
    expect(await page.locator('#aiDailyBriefLines').getAttribute('data-detected-by')).toBe('deterministic');
    expect(copy.length).toBeGreaterThanOrEqual(4);
    expect(copy.length).toBeLessThanOrEqual(6);
    expect(copy.join('\n')).toContain('4 items need attention across 1 project.');
    expect(copy.join('\n')).toContain('Priority: RCBC Plaza — Blocked overdue task: Ceiling framing — Drawing pending.');
    expect(copy.join('\n')).toContain('1 attendance record from yesterday remains unresolved.');
    expect(copy.join('\n')).toContain('1 blocked and overdue task needs follow-up.');
    expect(copy.join('\n')).toContain('Gypsum Board delivery is 80 of 100 sheets received.');
    expect(copy.join('\n')).toContain('1 site issue has been open for 4 days.');
    expect(copy.at(-1)).toBe('Everything else currently has no detected attention items.');
    expect(copy.join('\n')).not.toMatch(/schedule impact|cost impact|out of stock|stock shortage|caused|because/i);
  });

  test('35. Daily Brief uses the exact two-line calm state', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z1_NO_ATTENTION);
    await openCommandCenter(page);
    await expect(page.locator('#aiDailyBriefLines p')).toHaveText([
      'Everything looks on track.',
      'No operational issues currently need your attention.',
    ]);
  });

  test('36. Daily Brief omits the calm remainder when it is unsupported', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z2_OVERDUE_TASK);
    await openCommandCenter(page);
    const brief = page.locator('#aiDailyBriefLines');
    await expect(brief).toContainText('1 item needs attention across 1 project.');
    await expect(brief).not.toContainText('Everything else currently has no detected attention items.');
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
