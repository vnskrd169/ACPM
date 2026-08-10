#!/usr/bin/env node
/**
 * ui_layout_modal_fit_check.js
 * Opens the real PO RFP modal on Production (Angeles PO-001) at mobile and
 * laptop sizes and verifies the modal fits the viewport and scrolls internally.
 * Read-only. Usage: node scripts/ui_layout_modal_fit_check.js
 */
const { chromium } = require('@playwright/test');

const PROD = process.env.AUDIT_URL || 'https://acpm-project-system.web.app';
const PROJECT_ID = '-OzAbkzh7bwNeV-m1TGG';
const BOSS = { email: 'boss@acpm.local', pass: 'Choiraboy169!' };

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

async function login(page) {
  await page.goto(`${PROD}/login.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#authUser', { timeout: 30000 });
  await page.fill('#authUser', BOSS.email);
  await page.fill('#authPass', BOSS.pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
    page.click('#authLoginBtn'),
  ]);
  await page.waitForTimeout(4000);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => { window.__ACPM_DISABLE_SW_FOR_E2E__ = true; });
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  await login(page);
  await page.goto(`${PROD}/workspace.html?projectId=${encodeURIComponent(PROJECT_ID)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(5000);
  if (!page.url().includes('workspace.html')) {
    await login(page);
    await page.goto(`${PROD}/workspace.html?projectId=${encodeURIComponent(PROJECT_ID)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(5000);
  }

  for (const vp of [{ n: 'mobile-390x844', w: 390, h: 844 }, { n: 'laptop-1366x768', w: 1366, h: 768 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(600);
    await page.click('#tab_materials').catch(() => {});
    await page.waitForSelector('.po-card [data-action="rfp"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const rfpBtn = page.locator('.po-card [data-action="rfp"]').first();
    if (!(await rfpBtn.count())) {
      record(`${vp.n}: PO RFP button found`, false, 'not found on this project');
      continue;
    }
    await rfpBtn.click();
    await page.waitForTimeout(1200);
    const fit = await page.evaluate(() => {
      const box = document.querySelector('#rfpModal .modal-box');
      if (!box) return null;
      const r = box.getBoundingClientRect();
      const cs = getComputedStyle(box);
      return {
        fits: r.height <= window.innerHeight + 1 && r.width <= window.innerWidth + 1,
        h: Math.round(r.height), w: Math.round(r.width),
        innerH: window.innerHeight, innerW: window.innerWidth,
        overflowY: cs.overflowY, maxHeight: cs.maxHeight,
        footerVisible: (() => {
          const actions = box.querySelector('.modal-actions');
          if (!actions) return 'n/a';
          const a = actions.getBoundingClientRect();
          return a.top < window.innerHeight && a.bottom > 0;
        })(),
      };
    });
    if (fit) {
      record(`${vp.n}: RFP modal fits viewport`, fit.fits, `box=${fit.w}x${fit.h} vs ${fit.innerW}x${fit.innerH}`);
      record(`${vp.n}: RFP modal scrolls internally`, fit.overflowY === 'auto' || fit.overflowY === 'scroll', `overflowY=${fit.overflowY} maxH=${fit.maxHeight}`);
      record(`${vp.n}: modal footer actions visible/reachable`, fit.footerVisible !== false, `footerVisible=${fit.footerVisible}`);
    } else {
      record(`${vp.n}: RFP modal opened`, false, 'modal-box not found');
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== MODAL FIT CHECK: ${results.length - failed.length}/${results.length} PASS ===`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('MODAL CHECK CRASHED:', e?.message || e);
  process.exit(2);
});
