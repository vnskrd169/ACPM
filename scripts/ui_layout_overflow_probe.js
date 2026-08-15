#!/usr/bin/env node
/**
 * ui_layout_overflow_probe.js
 * Identifies which elements overflow the viewport width on Production (mobile).
 * Read-only boss login on Angeles Residence.
 * Usage: node scripts/ui_layout_overflow_probe.js
 */
const { chromium } = require('@playwright/test');

const PROD = 'https://acpm-project-system.web.app';
const PROJECT_ID = '-OzAbkzh7bwNeV-m1TGG';
const BOSS = { email: 'boss@acpm.local', pass: 'Choiraboy169!' };

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

async function findOverflow(page, label) {
  const list = await page.evaluate(() => {
    const iw = window.innerWidth;
    const bad = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;
      const right = Math.round(r.right);
      if (right > iw + 2 || r.left < -2) {
        const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 60);
        const id = el.id ? `#${el.id}` : '';
        bad.push({
          tag: el.tagName.toLowerCase(),
          id,
          cls,
          left: Math.round(r.left),
          right,
          width: Math.round(r.width),
          overflow: getComputedStyle(el).overflow,
          text: (el.textContent || '').trim().slice(0, 40),
        });
      }
    });
    bad.sort((a, b) => (b.right - iw) - (a.right - iw));
    return bad.slice(0, 20);
  });
  console.log(`\n=== Overflow elements (${label}) ===`);
  if (!list.length) console.log('  NONE');
  list.forEach((el) => {
    console.log(`  <${el.tag}>${el.id} .${el.cls} left=${el.left} right=${el.right} w=${el.width} overflow=${el.overflow} text="${el.text}"`);
  });
  return list;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page);
  await page.goto(`${PROD}/workspace.html?projectId=${encodeURIComponent(PROJECT_ID)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(6000);
  await page.click('#tab_labor').catch(() => {});
  await page.waitForTimeout(2500);
  await findOverflow(page, 'Labor tab @390');

  // Also check dashboard tab
  await page.click('#tab_dashboard').catch(() => {});
  await page.waitForTimeout(1500);
  await findOverflow(page, 'Dashboard tab @390');

  await browser.close();
}

main().catch((e) => {
  console.error('PROBE CRASHED:', e?.message || e);
  process.exit(2);
});
