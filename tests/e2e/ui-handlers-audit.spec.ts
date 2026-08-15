import { test, expect } from '@playwright/test';
import { buildInitScript, navigateToPmos, navigateToDashboard, navigateToWorkspace, selectProject } from './helpers';

async function collectBrokenHandlers(page: any): Promise<string[]> {
  return page.evaluate(() => {
    // DOM methods / globals that legitimately appear as the first call inside a handler.
    const safeCalls = new Set([
      'getElementById', 'querySelector', 'querySelectorAll', 'classList', 'toggle', 'add', 'remove',
      'preventDefault', 'stopPropagation', 'focus', 'click', 'reload', 'Date', 'String', 'Number',
      'parseFloat', 'parseInt', 'JSON', 'Object', 'Array', 'Math', 'console', 'encodeURIComponent',
      'decodeURIComponent', 'URL', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'navigator', 'document', 'window', 'localStorage', 'sessionStorage', 'fetch', 'Promise', 'alert', 'confirm',
    ]);
    const broken: string[] = [];
    // Only check the FIRST call token in each onclick — that is the actual handler.
    // Nested DOM calls (document.getElementById(...).classList.toggle(...)) are not globals.
    document.querySelectorAll<HTMLElement>('[onclick]').forEach((el) => {
      const code = el.getAttribute('onclick') || '';
      const firstCall = code.match(/(\w+)\s*\(/);
      if (!firstCall) return;
      const fn = firstCall[1];
      if (typeof (window as any)[fn] !== 'function' && !safeCalls.has(fn)) {
        broken.push(`${fn}() used by <${el.tagName} class="${(el.className || '').toString().slice(0, 40)}">`);
      }
    });
    return broken;
  });
}

test.describe('Inline handler audit', () => {
  test('PMOS field app has no dead onclick handlers', async ({ page }) => {
    await page.addInitScript(buildInitScript('field'));
    await navigateToPmos(page);
    await selectProject(page, 'test-project-1');
    await page.waitForTimeout(500);
    for (const open of [
      async () => {},
      async () => page.evaluate(() => (window as any).pmosOpenModule?.('quick')),
      async () => page.evaluate(() => (window as any).pmosOpenModule?.('photo')),
      async () => page.evaluate(() => (window as any).pmosShowNav?.('tasks')),
      async () => page.evaluate(() => (window as any).pmosShowNav?.('more')),
      async () => page.evaluate(() => (window as any).pmosShowNav?.('create')),
    ]) {
      await open();
      await page.waitForTimeout(350);
      const broken = await collectBrokenHandlers(page);
      expect(broken, 'PMOS dead handlers').toEqual([]);
    }
  });

  test('ACPM dashboard + workspace have no dead onclick handlers', async ({ page }) => {
    await page.addInitScript(buildInitScript('field'));
    await navigateToDashboard(page);
    await page.waitForTimeout(700);
    let broken = await collectBrokenHandlers(page);
    expect(broken, 'dashboard dead handlers').toEqual([]);

    await navigateToWorkspace(page, 'test-project-1');
    await page.waitForTimeout(700);
    for (const tab of ['labor', 'materials', 'billing', 'sitelog']) {
      await page.evaluate((t) => (window as any).switchTab?.(t), tab);
      await page.waitForTimeout(400);
      broken = await collectBrokenHandlers(page);
      expect(broken, `workspace tab "${tab}" dead handlers`).toEqual([]);
    }
  });
});
