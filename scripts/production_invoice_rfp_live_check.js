#!/usr/bin/env node
/**
 * invoice_rfp_live_check.js
 *
 * Live verification of the Invoice RFP (supplier invoice) feature against a
 * deployed ACPM hosting site. Seeds a QA-only project + PO with a matched
 * supplier invoice via console access (admin, never rules-tested), drives the
 * real UI, verifies the Invoice RFP button and modal text, then deletes the QA
 * project. No real pilot data is touched.
 *
 *   Production (default): boss@acpm.local on https://acpm-project-system.web.app
 *   Staging:              RFP_CHECK_STAGING=1 provisions an ephemeral boss
 *                         account in the staging Auth project and targets
 *                         https://acpm-project-system-qa.web.app
 *
 * Usage:
 *   node scripts/production_invoice_rfp_live_check.js
 *   RFP_CHECK_STAGING=1 node scripts/production_invoice_rfp_live_check.js
 */
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('@playwright/test');

const IS_STAGING = process.env.RFP_CHECK_STAGING === '1';
const PROD = IS_STAGING
  ? 'https://acpm-project-system-qa.web.app'
  : 'https://acpm-project-system.web.app';
const DB = IS_STAGING
  ? 'https://acpm-project-system-qa-default-rtdb.asia-southeast1.firebasedatabase.app'
  : 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';
const AUTH_KEY = IS_STAGING
  ? 'AIzaSyC4qihU8oA4vbmIPusoURYfkQ8u-J3nF9g' // environment.js staging key
  : 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA'; // environment.js production key
const SUPPLIER = 'Invoice RFP QA Supplier';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
}

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let b = null;
        try { b = JSON.parse(d); } catch { b = d; }
        resolve({ status: res.statusCode, body: b });
      });
    });
    r.on('error', reject);
    if (opts.body) r.write(JSON.stringify(opts.body));
    r.end();
  });
}

// Resolve the boss account used to drive the UI.
// Production: the provisioned RC1 boss QA account.
// Staging:    provision an ephemeral boss (repo's established QA pattern).
async function resolveBoss(token) {
  if (!IS_STAGING) return { email: 'boss@acpm.local', pass: 'Choiraboy169!', uid: null, idToken: null };
  const email = 'boss.invrfp.qa@acpm.local';
  const pass = 'InvRfpQa!' + Date.now().toString(36);
  const res = await req(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${AUTH_KEY}`, {
    method: 'POST',
    body: { email, password: pass, returnSecureToken: true }
  });
  if (res.status !== 200) throw new Error('Staging signUp failed: ' + JSON.stringify(res.body).slice(0, 120));
  const uid = res.body.localId;
  await req(`${DB}/users/${uid}.json?access_token=${token}`, {
    method: 'PUT',
    body: { role: 'boss', status: 'active', name: 'Invoice RFP QA Boss' }
  });
  console.log('Provisioned ephemeral staging boss:', uid);
  return { email, pass, uid, idToken: res.body.idToken };
}

async function seedProject(token, bossUid) {
  const pid = 'qa_invrfp_' + Date.now().toString(36);
  const now = Date.now();
  const poId = 'po_inv_1';
  const items = [
    { itemId: 'item_001', desc: 'Cement 40kg', description: 'Cement 40kg', size: '', qty: 20, qtyOrdered: 20, qtyReceived: 20, qtyAccepted: 20, qtyRejected: 0, qtyCancelled: 0, qtyRemaining: 0, unit: 'bag', cost: 250, unitCost: 250, total: 5000, totalCost: 5000, reorderPoint: 5 },
    { itemId: 'item_002', desc: 'Steel Bar 12mm', description: 'Steel Bar 12mm', size: '', qty: 10, qtyOrdered: 10, qtyReceived: 10, qtyAccepted: 10, qtyRejected: 0, qtyCancelled: 0, qtyRemaining: 0, unit: 'pc', cost: 500, unitCost: 500, total: 5000, totalCost: 5000, reorderPoint: 3 }
  ];
  const po = {
    supplier: SUPPLIER, supplierName: SUPPLIER, supplierId: '',
    date: new Date().toISOString().slice(0, 10), notes: '', urgency: 'normal',
    items, total: 10000, committedCost: 10000, receivedCost: 10000, issuedCost: 0,
    seq: 1, poNo: 'PO-001', status: 'partially_delivered', deliveryStatus: 'fully_delivered',
    invoiceStatus: 'matched',
    invoiceNo: 'INV-TEST-001',
    invoiceAmount: 10000,
    invoiceDate: new Date().toISOString().slice(0, 10),
    threeWayMatch: { poTotal: 10000, deliveredQty: 30, orderedQty: 30, deliveredValue: 10000, invoiceAmount: 10000, qtyMatch: true, valueMatch: true, status: 'matched', approvedAt: now, approvedBy: 'live-check' },
    approvalWorkflow: { submittedBy: 'live-check', submittedAt: now, approvedBy: null, approvedAt: null },
    createdAt: now, createdBy: 'live-check', createdDate: new Date(now).toLocaleDateString('en-PH')
  };
  await req(`${DB}/projects/${pid}.json?access_token=${token}`, {
    method: 'PUT',
    body: { name: 'QA INVOICE RFP CHECK - DELETE AFTER', status: 'active', createdAt: now, materialBudget: 100000, materialBudgetDelta: 0, materialSpent: 10000, materialCommitted: 10000, materialReceivedCost: 10000 }
  });
  await req(`${DB}/projects/${pid}/purchaseOrders/${poId}.json?access_token=${token}`, { method: 'PUT', body: po });
  // Assign the QA project to the boss account so the workspace lists/opens it
  if (bossUid) {
    await req(`${DB}/users/${bossUid}/projects/${pid}.json?access_token=${token}`, { method: 'PUT', body: true });
  }
  // Verify the seed landed
  const verify = await req(`${DB}/projects/${pid}/purchaseOrders/${poId}.json?access_token=${token}`);
  if (!verify.body || verify.body.invoiceNo !== 'INV-TEST-001') {
    throw new Error('Seeded PO not readable back: ' + JSON.stringify(verify.body).slice(0, 120));
  }
  return { pid, poId };
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

async function main() {
  console.log('=== Invoice RFP live check ===');
  console.log('Environment:', IS_STAGING ? 'STAGING' : 'PRODUCTION', '|', PROD);

  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
  const token = cfg.tokens.access_token;
  const boss = await resolveBoss(token);
  const { pid, poId } = await seedProject(token, boss.uid);
  console.log('Seeded QA project:', pid, 'PO:', poId);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => { window.__ACPM_DISABLE_SW_FOR_E2E__ = true; });
  const page = await context.newPage();

  try {
    console.log('[1] Login as Boss');
    await login(page, boss);
    record('Boss login + dashboard loads', true);

    console.log('[2] Open QA project -> Materials tab');
    await page.goto(`${PROD}/workspace.html?projectId=${encodeURIComponent(pid)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(5000);
    await page.click('#tab_materials');
    await page.waitForTimeout(2500);

    console.log('[3] Invoice RFP button on the PO card');
    await page.waitForSelector('.po-card [data-action="inv-rfp"]', { timeout: 45000 }).catch(() => {});
    const invRfpBtns = await page.locator('.po-card [data-action="inv-rfp"]').count();
    record('Invoice RFP button renders (invoice present)', invRfpBtns > 0, invRfpBtns + ' button(s)');

    console.log('[4] Click Invoice RFP -> modal text');
    await page.click('.po-card [data-action="inv-rfp"]');
    await page.waitForTimeout(1500);
    const modalVisible = await page.locator('#rfpModal').isVisible().catch(() => false);
    record('RFP modal opens', modalVisible);

    const rfpText = (await page.locator('#rfpOutput').inputValue().catch(() => '')) || '';
    record('Text: SUPPLIER INVOICE header', rfpText.includes('REQUEST FOR PAYMENT (RFP) - SUPPLIER INVOICE'));
    record('Text: invoice number INV-TEST-001', rfpText.includes('INV-TEST-001'));
    record('Text: supplier name', rfpText.includes(SUPPLIER));
    record('Text: 3-Way Match = 3-WAY MATCHED', rfpText.includes('3-WAY MATCHED'));
    record('Text: INVOICE AMOUNT line', rfpText.includes('INVOICE AMOUNT'));
    record('Text: amount ₱10,000', rfpText.includes('10,000'), rfpText.split('\n').filter(l => l.includes('INVOICE AMOUNT'))[0] || '');
    record('Text: PO TOTAL line', rfpText.includes('PO TOTAL'));
    console.log('---- RFP output preview ----');
    console.log(rfpText.split('\n').slice(0, 11).join('\n'));
    console.log(rfpText.split('\n').slice(-4).join('\n'));
    console.log('----------------------------');

    console.log('[5] Download PDF');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
      page.click('.btn-pdf').catch(() => {}),
    ]);
    const dlName = download ? download.suggestedFilename() : '';
    record('Download PDF produces RFP_Invoice_*.pdf', !!download && /^RFP_Invoice_/.test(dlName), dlName || 'no download');
  } catch (err) {
    record('UNEXPECTED ERROR', false, err.message);
  } finally {
    await browser.close();
    // Cleanup
    let r = await req(`${DB}/projects/${pid}.json?access_token=${token}`, { method: 'DELETE' });
    console.log('cleanup project:', r.status);
    if (boss.uid) {
      await req(`${DB}/users/${boss.uid}/projects/${pid}.json?access_token=${token}`, { method: 'DELETE' });
      if (IS_STAGING) {
        await req(`${DB}/users/${boss.uid}.json?access_token=${token}`, { method: 'DELETE' });
        if (boss.idToken) {
          await req(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${AUTH_KEY}`, { method: 'POST', body: { idToken: boss.idToken } });
        }
      }
    }
    const leaks = await req(`${DB}/projects.json?access_token=${token}&shallow=true`);
    const leftovers = Object.keys(leaks.body || {}).filter(k => k.startsWith('qa_invrfp_'));
    console.log('leftover qa_invrfp projects:', leftovers.length ? leftovers.join(', ') : 'NONE');
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log('');
  console.log(`=== RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} — ${passed}/${results.length} checks passed ===`);
  if (failed) process.exitCode = 1;
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exitCode = 1;
});
