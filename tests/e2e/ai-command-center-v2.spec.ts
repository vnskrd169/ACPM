import { expect, Page, test } from '@playwright/test';
import { aiScenarios, zeroBudgetScenarios, AiFixtureData } from './ai-command-center-fixtures';
import { buildInitScript, navigateToDashboard, navigateToWorkspace } from './helpers';

type TestUser = 'field' | 'pm';

function v2Scenario(now = Date.now()): AiFixtureData {
  const operational = zeroBudgetScenarios(now).Z11_DAILY_BRIEF;
  const intelligence = aiScenarios(now).D_TWO_WAITING_DECISIONS;
  const drafts = zeroBudgetScenarios(now).Z13_ACTION_DRAFTS;
  return {
    ...operational,
    'ai/runtimeStatus': intelligence['ai/runtimeStatus'],
    'ai/runs': intelligence['ai/runs'],
    'ai/events': intelligence['ai/events'],
    'ai/findings': intelligence['ai/findings'],
    'ai/recommendations': intelligence['ai/recommendations'],
    'ai/decisions': intelligence['ai/decisions'],
    'ai/actionDrafts': drafts['ai/actionDrafts'],
    'ai/actionDraftEvents': {
      'draft-event-1': {
        id: 'draft-event-1', draftId: 'action-draft-1', decisionId: 'decision-draft-source',
        projectId: 'test-project-1', action: 'created', timestamp: now - 50_000,
      },
    },
  };
}

async function setup(page: Page, user: TestUser, databaseData: AiFixtureData, workspace = false) {
  await page.addInitScript(buildInitScript(user, { databaseData }));
  if (workspace) await navigateToWorkspace(page);
  else await navigateToDashboard(page);
}

async function openCommandCenter(page: Page, workspace = false) {
  const button = page.locator(workspace ? '#openAiCommandCenterWorkspaceBtn' : '#openAiCommandCenterBtn');
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('#aiCommandCenterView')).toBeVisible();
  await page.waitForFunction(() => window.getAiCommandCenterDiagnostics?.().listenerCount === 8);
}

async function capture(page: Page, name: string) {
  if (process.env.ACPM_CAPTURE_SCREENSHOTS !== '1') return;
  const dismiss = page.locator('.toast-msg .toast-dismiss');
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
    await expect(page.locator('.toast-msg')).toHaveCount(0);
  }
  await page.addStyleTag({ content: '.acpm-staging-marker { position: absolute !important; }' });
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
}

test.describe('AI Command Center V2 vision alignment', () => {
  test('1. Overview loads as the default operations view', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    await expect(page.locator('[data-ai-v2-panel="overview"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Company Pulse' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ask Command Center' })).toBeVisible();
    await capture(page, 'ai-v2-desktop-overview');
  });

  test('2. Company Pulse renders canonical counts and no fake percentages', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    const pulse = page.locator('#aiCompanyPulseMetrics');
    await expect(pulse).toContainText('Active projects');
    await expect(pulse).toContainText('Need attention');
    await expect(pulse).toContainText('Waiting on you');
    await expect(page.locator('#aiCompanyPriority')).toContainText('RCBC Plaza');
    await expect(page.locator('.ai-company-pulse')).not.toContainText(/health|risk %|confidence|financial exposure|completion score/i);
  });

  test('3. AI Team renders four specialized truthful agents', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    await page.getByRole('button', { name: 'AI Team', exact: true }).click();
    await expect(page.locator('#aiV2TeamPanel')).toBeVisible();
    await expect(page.locator('#aiAgentStatus .ai-agent-card')).toHaveCount(4);
    for (const name of ['PM Agent', 'Planning Monitor', 'Materials Monitor', 'Site / QA Monitor']) {
      await expect(page.locator('#aiAgentStatus')).toContainText(name);
    }
    await capture(page, 'ai-v2-ai-team');
  });

  test('4. provider-off states never claim unrecorded work', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z9_PROVIDER_OFF_MONITORING);
    await openCommandCenter(page);
    await page.getByRole('button', { name: 'AI Team', exact: true }).click();
    await expect(page.locator('[data-ai-agent="pm"]')).toHaveAttribute('data-ai-agent-status', 'NOT_CONFIGURED');
    await expect(page.locator('[data-ai-agent="planning"]')).toHaveAttribute('data-ai-agent-status', 'MONITORING');
    await expect(page.locator('[data-ai-agent="materials"]')).toHaveAttribute('data-ai-agent-status', 'MONITORING');
    await expect(page.locator('[data-ai-agent="site"]')).toHaveAttribute('data-ai-agent-status', 'MONITORING');
    await expect(page.locator('#aiAgentStatus')).not.toContainText(/working/i);
  });

  test('5. intelligence timeline distinguishes recorded provenance', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    const timeline = page.locator('#aiIntelligenceTimeline');
    await expect(timeline).toBeVisible();
    await expect(timeline).toContainText('System detected');
    await expect(timeline).toContainText('Rule-based monitor');
    await expect(timeline).toContainText('AI analysis');
    await expect(timeline).toContainText('Human decision');
    await expect(timeline).toContainText('Action draft');
    await capture(page, 'ai-v2-activity');
  });

  test('6. project drill-down groups planning, materials, site, and management', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.locator('[data-ai-intelligence-project="test-project-1"]').click();
    const detail = page.locator('#aiProjectIntelligence');
    await expect(detail).toContainText('RCBC Plaza');
    for (const section of ['Planning', 'Materials', 'Site / QA', 'Management']) await expect(detail).toContainText(section);
    await expect(detail).toContainText('Gypsum Board');
    await expect(detail).not.toContainText(/health score|% health|risk %/i);
    await capture(page, 'ai-v2-project-intelligence');
  });

  test('7. Ask answers a known company question deterministically', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    await page.locator('#aiAskInput').fill('Which project needs the most attention?');
    await page.locator('#aiAskForm').getByRole('button', { name: 'Ask' }).click();
    const answer = page.locator('#aiAskAnswer');
    await expect(answer).toHaveAttribute('data-generated-by', 'deterministic');
    await expect(answer).toContainText('Current company priority');
    await expect(answer).toContainText('RCBC Plaza');
    await capture(page, 'ai-v2-ask-command-center');
  });

  test('8. Ask supports a project-specific Tagalog question', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    await page.locator('#aiAskInput').fill('Ano ang issues sa RCBC?');
    await page.locator('#aiAskForm').getByRole('button', { name: 'Ask' }).click();
    await expect(page.locator('#aiAskAnswer')).toContainText('RCBC Plaza attention');
    await expect(page.locator('#aiAskAnswer')).toContainText('Ceiling framing');
    expect(await page.evaluate(() => window.__mockDbPaths.some((path: string) => path.includes('Ano ang issues')))).toBe(false);
  });

  test('9. unsupported question returns the advanced-analysis fallback', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    await page.locator('#aiAskInput').fill('Predict next quarter cost impact and explain why.');
    await page.locator('#aiAskForm').getByRole('button', { name: 'Ask' }).click();
    await expect(page.locator('#aiAskAnswer')).toContainText('That question requires advanced AI analysis, which is not configured in the current pilot.');
    await expect(page.locator('#aiAskAnswer')).not.toContainText(/₱|delay days|supplier blame/i);
  });

  test('10. Operations Attention still navigates to the real task screen', async ({ page }) => {
    await setup(page, 'pm', zeroBudgetScenarios().Z2_OVERDUE_TASK, true);
    await openCommandCenter(page, true);
    const writesBefore = await page.evaluate(() => window.__mockDbWrites.length);
    await page.locator('#aiAttentionList [data-ai-destination="task"]').click();
    await expect(page.locator('#tasksPanel')).toBeVisible();
    expect(await page.evaluate(() => window.__mockDbWrites.length)).toBe(writesBefore);
  });

  test('11. Waiting On You remains separate from deterministic findings', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    await expect(page.locator('#aiNeedsActionCount')).toHaveText('4');
    await expect(page.locator('#aiWaitingCount')).toHaveText('2');
    await expect(page.locator('.ai-needs-action-panel')).toContainText('System detected');
    await expect(page.locator('.ai-waiting-panel')).toContainText('Actual AI decisions');
  });

  test('12. Action Drafts remain a separate controlled queue', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    await expect(page.locator('#aiActionDraftCount')).toHaveText('1');
    await expect(page.locator('#aiActionDraftList')).toContainText('No execution');
    await expect(page.locator('#aiDecisionList')).not.toContainText('Prepare alternate material request');
  });

  test('13. V2 exposes no business execution controls', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    for (const name of ['Send', 'Apply', 'Create PO', 'Pay', 'Change Schedule', 'Execute']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
  });

  test('14. APM access remains denied before any AI read', async ({ page }) => {
    await setup(page, 'field', v2Scenario());
    await expect(page.locator('#openAiCommandCenterBtn')).toHaveCount(0);
    await expect(page.locator('#aiCommandCenterView')).toHaveCount(0);
    expect(await page.evaluate(() => window.__mockDbPaths.filter((path: string) => path.startsWith('ai/')))).toEqual([]);
  });

  test('15. mobile layout keeps Overview and Ask usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    await expect(page.locator('#aiAskInput')).toBeVisible();
    await expect(page.locator('#aiCommandSections')).toBeVisible();
    const width = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(width.body).toBeLessThanOrEqual(width.viewport + 1);
    await capture(page, 'ai-v2-mobile');
  });

  test('16. section switching creates no blocking overlay or document overflow', async ({ page }) => {
    await setup(page, 'pm', v2Scenario());
    await openCommandCenter(page);
    for (const section of ['Projects', 'AI Team', 'Activity', 'Overview']) {
      await page.getByRole('button', { name: section, exact: true }).click();
      await expect(page.locator('.modal-overlay:not(.hidden)')).toHaveCount(0);
    }
    const metrics = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);
  });
});
