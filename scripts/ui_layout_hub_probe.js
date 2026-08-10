#!/usr/bin/env node
/**
 * ui_layout_hub_probe.js
 * Probes the Hub (dashboard.html) on Production for mobile horizontal overflow.
 * Read-only boss login.
 * Usage: node scripts/ui_layout_hub_probe.js
 */
const { chromium } = require('@playwright/test');

const PROD = process.env.AUDIT_URL || 'https://acpm-project-system.web.app';
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

async function snapshot(page, label) {
  const data = await page.evaluate(() => {
    const de = document.documentElement;
    const iw = window.innerWidth;
    const bad = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;
      if (Math.round(r.right) > iw + 2 || r.left < -2) {
        bad.push(`<${el.tagName.toLowerCase()}>${el.id ? '#' + el.id : ''}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
      }
    });
    return {
      scrollW: de.scrollWidth,
      innerW: iw,
      offenders: bad.slice(0, 12),
      hubVisible: !!document.querySelector('#hubView') && getComputedStyle(document.querySelector('#hubView')).display !== 'none',
    };
  });
  console.log(`\n[${label}] scrollW=${data.scrollW} innerW=${data.innerW} hubVisible=${data.hubVisible}`);
  if (!data.offenders.length) console.log('  NONE');
  data.offenders.forEach((o) => console.log('  ' + o));
  return data;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page);

  // Fresh mobile load of the hub
  await page.goto(`${PROD}/dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await snapshot(page, 'Hub fresh @390');

  // Resize path: desktop -> mobile
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1200);
  await snapshot(page, 'Hub after resize 1366->390');

  await browser.close();
}

main().catch((e) => {
  console.error('PROBE CRASHED:', e?.message || e);
  process.exit(2);
});
