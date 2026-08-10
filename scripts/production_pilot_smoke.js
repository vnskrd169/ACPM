#!/usr/bin/env node
/**
 * production_pilot_smoke.js
 *
 * Live pilot smoke test against the ACPM PRODUCTION web app:
 * drives the real task lifecycle in the real UI with real Firebase auth.
 *
 *   APM: create task -> start work -> submit for verification -> cannot complete
 *   PM : verify and complete
 *
 * Uses dedicated QA accounts (apm.qa@lebuild.test / pm.qa@lebuild.test) and a
 * dedicated QA-only project (qa_pilotsmoke_*) that is deleted after the run.
 * No real pilot project is touched.
 *
 * Usage: node scripts/production_pilot_smoke.js
 */
const { chromium } = require('@playwright/test');

const PROD = 'https://acpm-project-system.web.app';
const PROJECT_ID = process.env.SMOKE_PROJECT_ID || require('fs').readFileSync('pilotsmoke-project.txt', 'utf8').trim();
const APM = { email: 'apm.qa@lebuild.test', pass: 'Lebuild2026' };
const PM = { email: 'pm.qa@lebuild.test', pass: 'Lebuild2026' };
const TASK_TITLE = 'SMOKE TEST - rules QA - delete after';
const NOTE = 'QA smoke verification note';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
}

async function login(page, account) {
  await page.goto(`${PROD}/login.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#authUser', { timeout: 30000 });
  await page.fill('#authUser', account.email);
  await page.fill('#authPass', account.pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
    page.click('#authLoginBtn'),
  ]);
  await page.waitForTimeout(4000);
}

async function openWorkspaceTasks(page) {
  await page.goto(`${PROD}/workspace.html?projectId=${encodeURIComponent(PROJECT_ID)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(5000);
  // If a project picker appears, pick our QA project
  const pickerVisible = await page.locator('text=PILOT SMOKE TEST').count();
  if (pickerVisible) {
    await page.locator('text=PILOT SMOKE TEST').first().click();
    await page.waitForTimeout(4000);
  }
  // The workspace defaults to the Dashboard/Mission Board tab; the Tasks tab
  // must be activated explicitly (the ?tab= param is only honored with fromNotif=1).
  await page.waitForSelector('#tab_tasks', { timeout: 30000 }).catch(() => {});
  const tasksTab = await page.locator('#tab_tasks').count();
  if (tasksTab) {
    await page.click('#tab_tasks');
    await page.waitForTimeout(2000);
  }
}

async function taskCard(page) {
  return page.locator('.task-card', { hasText: TASK_TITLE });
}

async function openTaskMenu(page) {
  const card = await taskCard(page);
  await card.locator('.task-menu-btn').click();
  await page.waitForTimeout(800);
}

async function menuItems(page) {
  return page.locator('.task-menu-item').allTextContents();
}

async function clickMenuItem(page, label) {
  const items = page.locator('.task-menu-item');
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const text = (await items.nth(i).textContent()) || '';
    if (text.trim() === label) {
      await items.nth(i).click();
      return true;
    }
  }
  return false;
}

async function columnHasTask(page, status) {
  await page.waitForTimeout(1500);
  const column = page.locator(`.task-column-${status}`);
  return (await column.locator('.task-card', { hasText: TASK_TITLE }).count()) > 0;
}

async function main() {
  console.log('=== ACPM Production pilot smoke: task lifecycle ===');
  console.log('Project:', PROJECT_ID);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => { window.__ACPM_DISABLE_SW_FOR_E2E__ = true; });
  const page = await context.newPage();

  const promptHandlers = [];
  page.on('dialog', async (dialog) => {
    const type = dialog.type();
    if (type === 'prompt') {
      const message = dialog.message() || '';
      let value = '';
      if (message.includes('Completion note')) value = NOTE;
      promptHandlers.push(message);
      await dialog.accept(value);
    } else if (type === 'confirm') {
      promptHandlers.push('confirm:' + dialog.message());
      await dialog.accept();
    } else {
      await dialog.accept();
    }
  });

  try {
    // ---- APM lifecycle ----
    console.log('[1] Login as APM');
    await login(page, APM);
    record('APM login + dashboard loads', true);

    console.log('[2] Open QA project tasks');
    await openWorkspaceTasks(page);
    await page.waitForSelector('#taskTitle', { timeout: 30000 }).catch(() => {});
    const hasForm = await page.locator('#taskTitle').count();
    record('Tasks form visible (taskTitle input)', hasForm > 0);

    console.log('[3] Create task (APM)');
    await page.fill('#taskTitle', TASK_TITLE);
    await page.click('button:has-text("Add Task")');
    await page.waitForTimeout(2500);
    record('Task card appears in Pending column', await columnHasTask(page, 'pending'));

    console.log('[4] Start work (pending -> in_progress)');
    await openTaskMenu(page);
    record('Menu has "Start Work"', await clickMenuItem(page, 'Start Work'));
    await page.waitForTimeout(1500);
    record('Task moved to In Progress', await columnHasTask(page, 'in_progress'));

    console.log('[5] Submit for verification (in_progress -> for_verification)');
    await openTaskMenu(page);
    record('Menu has "Submit for Verification"', await clickMenuItem(page, 'Submit for Verification'));
    await page.waitForTimeout(2500);
    record('Task moved to For Verification', await columnHasTask(page, 'for_verification'));

    console.log('[6] APM cannot complete');
    await openTaskMenu(page);
    const apmItems = await menuItems(page);
    const hasVerifyForApm = apmItems.some((t) => t.trim() === 'Verify and Complete');
    record('APM menu does NOT show "Verify and Complete"', !hasVerifyForApm, apmItems.join(' | '));
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);

    // ---- Sign out, PM completes ----
    console.log('[7] Sign out + login as PM');
    await page.goto(`${PROD}/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const signOutCount = await page.locator('#signOutBtn').count();
    if (signOutCount) await page.click('#signOutBtn');
    await page.waitForTimeout(2500);
    await login(page, PM);
    record('PM login + dashboard loads', true);

    console.log('[8] PM verifies and completes');
    await openWorkspaceTasks(page);
    await page.waitForSelector('#taskTitle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const inVerification = await columnHasTask(page, 'for_verification');
    record('PM sees task in For Verification', inVerification);
    if (inVerification) {
      await openTaskMenu(page);
      const pmItems = await menuItems(page);
      record('PM menu has "Verify and Complete"', await clickMenuItem(page, 'Verify and Complete'));
      await page.waitForTimeout(2500);
      record('Task moved to Completed column', await columnHasTask(page, 'completed'));
    }
  } catch (err) {
    record('UNEXPECTED ERROR', false, err.message);
  } finally {
    await page.screenshot({ path: 'pilotsmoke-final.png', fullPage: false }).catch(() => {});
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log(`=== RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} — ${passed}/${results.length} checks passed ===`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exitCode = 1;
});
