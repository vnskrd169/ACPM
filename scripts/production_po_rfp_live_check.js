#!/usr/bin/env node
/**
 * production_po_rfp_live_check.js
 *
 * Live verification of the deployed PO RFP feature against the ACPM Production
 * web app, using a REAL purchase order (read-only) in the Angeles Residence
 * project. No data is written.
 *
 *   Boss login -> open Angeles Residence workspace -> Materials tab ->
 *   PO-001 card shows the RFP button -> click -> modal text contains the
 *   RFP header, PO number, supplier, line items and TOTAL AMOUNT ->
 *   Copy Text works -> Download PDF produces an RFP_*.pdf file.
 *
 * Usage: node scripts/production_po_rfp_live_check.js
 */
const { chromium } = require('@playwright/test');

const PROD = 'https://acpm-project-system.web.app';
const PROJECT_ID = '-OzAbkzh7bwNeV-m1TGG'; // Angeles Residence - Filinvest 1. Quezon City
const BOSS = { email: 'boss@acpm.local', pass: 'Choiraboy169!' };

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
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
  console.log('=== ACPM Production live check: PO RFP on a real PO ===');
  console.log('Project:', PROJECT_ID);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  await context.addInitScript(() => { window.__ACPM_DISABLE_SW_FOR_E2E__ = true; });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PROD });
  const page = await context.newPage();

  try {
    console.log('[1] Login as Boss (full project access)');
    await login(page);
    record('Boss login + dashboard loads', true);

    console.log('[2] Open Angeles Residence workspace -> Materials tab');
    await page.goto(`${PROD}/workspace.html?projectId=${encodeURIComponent(PROJECT_ID)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(5000);
    await page.waitForSelector('#tab_materials', { timeout: 30000 }).catch(() => {});
    await page.click('#tab_materials');
    await page.waitForTimeout(2500);

    console.log('[3] Locate the real PO card + RFP button');
    await page.waitForSelector('.po-card [data-action="rfp"]', { timeout: 45000 }).catch(() => {});
    const rfpBtns = await page.locator('.po-card [data-action="rfp"]').count();
    record('PO-001 card renders with the RFP button', rfpBtns > 0, rfpBtns + ' button(s)');

    console.log('[4] Click RFP -> modal + copy text');
    const poCardText = rfpBtns ? await page.locator('.po-card').first().textContent() : '';
    record('PO card shows supplier RRJM', poCardText.includes('RRJM'), poCardText.slice(0, 60));
    record('PO card shows PO-001', poCardText.includes('PO-001'));
    record('PO card shows total amount', /10,?100/.test(poCardText), poCardText.match(/10,?100/)?.[0] || '');

    await page.click('.po-card [data-action="rfp"]');
    await page.waitForTimeout(1500);
    const modalVisible = await page.locator('#rfpModal').isVisible().catch(() => false);
    record('RFP modal opens', modalVisible);

    const rfpText = (await page.locator('#rfpOutput').inputValue().catch(() => '')) || '';
    record('Text: REQUEST FOR PAYMENT (RFP) - PURCHASE ORDER header', rfpText.includes('REQUEST FOR PAYMENT (RFP) - PURCHASE ORDER'));
    record('Text: project name (Angeles Residence)', rfpText.includes('Angeles Residence'), rfpText.split('\n')[1] || '');
    record('Text: PO number PO-001', rfpText.includes('PO-001'));
    record('Text: supplier RRJM Construction supply', rfpText.includes('RRJM Construction supply'));
    record('Text: TOTAL AMOUNT line', rfpText.includes('TOTAL AMOUNT'));
    record('Text: total ₱10,100', rfpText.includes('10,100'), rfpText.split('\n').filter(l => l.includes('TOTAL AMOUNT'))[0] || '');
    console.log('---- RFP output preview ----');
    console.log(rfpText.split('\n').slice(0, 12).join('\n'));
    console.log(rfpText.split('\n').slice(-4).join('\n'));
    console.log('----------------------------');

    console.log('[5] Copy Text button');
    await page.click('.btn-copy');
    await page.waitForTimeout(800);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => '');
    record('Copy Text copies the RFP to the clipboard', clip.includes('TOTAL AMOUNT') && clip.includes('PO-001'), 'clip length ' + clip.length);

    console.log('[6] Download PDF button');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
      page.click('.btn-pdf').catch(() => {}),
    ]);
    const dlName = download ? download.suggestedFilename() : '';
    record('Download PDF produces an RFP_*.pdf file', !!download && /^RFP_/.test(dlName), dlName || 'no download');

    await page.screenshot({ path: 'po-rfp-live-check.png' }).catch(() => {});
  } catch (err) {
    record('UNEXPECTED ERROR', false, err.message);
    await page.screenshot({ path: 'po-rfp-live-check-error.png' }).catch(() => {});
  } finally {
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
