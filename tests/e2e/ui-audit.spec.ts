import { test, expect } from '@playwright/test';
import { buildInitScript, navigateToPmos, navigateToDashboard, navigateToWorkspace, selectProject } from './helpers';

async function auditPage(page: any, label: string): Promise<string[]> {
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
    return issues;
  });
}

test.describe('UI regression audit', () => {
  test('PMOS field app screens are free of layout/accessibility defects', async ({ page }) => {
    await page.addInitScript(buildInitScript('field'));
    await navigateToPmos(page);
    await selectProject(page, 'test-project-1');
    await page.waitForTimeout(600);
    const screens: Array<[string, () => Promise<any>]> = [
      ['home', async () => {}],
      ['quick form', async () => page.evaluate(() => (window as any).pmosOpenModule?.('quick'))],
      ['sitelog form', async () => page.evaluate(() => (window as any).pmosOpenModule?.('sitelog'))],
      ['tasks', async () => page.evaluate(() => (window as any).pmosShowNav?.('tasks'))],
      ['more', async () => page.evaluate(() => (window as any).pmosShowNav?.('more'))],
    ];
    for (const [label, open] of screens) {
      await open();
      await page.waitForTimeout(400);
      const issues = await auditPage(page, label);
      expect(issues, `PMOS screen "${label}"`).toEqual([]);
    }
  });

  test('ACPM dashboard hub is free of layout defects', async ({ page }) => {
    await page.addInitScript(buildInitScript('reviewer'));
    await navigateToDashboard(page);
    await page.waitForTimeout(800);
    const issues = await auditPage(page, 'dashboard hub');
    expect(issues, 'dashboard hub').toEqual([]);
  });

  test('ACPM workspace is free of layout defects', async ({ page }) => {
    await page.addInitScript(buildInitScript('field'));
    await navigateToWorkspace(page, 'test-project-1');
    await page.waitForTimeout(800);
    const issues = await auditPage(page, 'workspace');
    expect(issues, 'workspace').toEqual([]);
  });
});
