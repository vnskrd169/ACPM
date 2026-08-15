import { test, expect } from '@playwright/test';
import { buildInitScript, navigateToWorkspace, navigateToDashboard, navigateToPmos, selectProject } from './helpers';

async function auditPage(page: any): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 2) {
      issues.push(`HORIZONTAL OVERFLOW: scrollWidth=${document.documentElement.scrollWidth} vw=${vw}`);
    }
    document.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const text = (b.textContent || '').trim();
      const aria = b.getAttribute('aria-label');
      const title = b.getAttribute('title');
      if (!text && !aria && !title) {
        issues.push(`UNLABELED BUTTON: ${(b.className || '').toString().slice(0, 60)}`);
      }
    });
    document.querySelectorAll<HTMLElement>('button, a, [role="button"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.width < 24 && r.height < 24 && getComputedStyle(el).position !== 'absolute') {
        issues.push(`SMALL TARGET (${Math.round(r.width)}x${Math.round(r.height)}): ${(el.className || '').toString().slice(0, 60)}`);
      }
    });
    document.querySelectorAll('img').forEach((img: HTMLImageElement) => {
      if (img.complete && img.naturalWidth === 0 && img.src && !img.src.startsWith('data:')) {
        issues.push(`BROKEN IMG: ${img.src.slice(0, 80)}`);
      }
    });
    // A .hidden element must not occupy visible space
    document.querySelectorAll('.hidden').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 100 && r.height > 50 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden') {
        issues.push(`VISIBLE .hidden ELEMENT: ${(el.className || '').toString().slice(0, 60)}`);
      }
    });
    return issues;
  });
}

async function switchTab(page: any, tab: string) {
  await page.evaluate((t) => (window as any).switchTab?.(t), tab);
  await page.waitForTimeout(500);
}

test.describe('Deep UI regression audit', () => {
  test('all workspace tabs are free of layout defects', async ({ page }) => {
    await page.addInitScript(buildInitScript('field'));
    await navigateToWorkspace(page, 'test-project-1');
    await page.waitForTimeout(700);
    for (const tab of ['labor', 'materials', 'billing', 'sitelog', 'changeorders', 'suppliers', 'tasks', 'equipment', 'compliance', 'defects']) {
      await switchTab(page, tab);
      const issues = await auditPage(page);
      expect(issues, `workspace tab "${tab}"`).toEqual([]);
    }
  });

  test('PMOS office view is free of layout defects', async ({ page }) => {
    await page.addInitScript(buildInitScript('reviewer'));
    await navigateToDashboard(page);
    await page.waitForTimeout(700);
    await page.evaluate(() => (window as any).pmosOpenOffice?.());
    await page.waitForTimeout(900);
    const issues = await auditPage(page);
    expect(issues, 'PMOS office').toEqual([]);
  });

  test('PMOS field app fits a phone viewport without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(buildInitScript('field'));
    await navigateToPmos(page);
    await selectProject(page, 'test-project-1');
    await page.waitForTimeout(500);
    for (const open of [
      async () => {},
      async () => page.evaluate(() => (window as any).pmosOpenModule?.('sitelog')),
      async () => page.evaluate(() => (window as any).pmosShowNav?.('create')),
    ]) {
      await open();
      await page.waitForTimeout(400);
      const issues = await auditPage(page);
      expect(issues, `phone screen`).toEqual([]);
    }
  });
});
