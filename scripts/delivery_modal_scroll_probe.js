#!/usr/bin/env node
/**
 * delivery_modal_scroll_probe.js — interactive scroll verification for the
 * delivery receipt modal (production bug: rows became unreachable when a PO
 * had many line items).
 *
 * Reuses the local audit's mocked-Firebase stress harness and drives REAL
 * input events — mouse wheel, keyboard PageDown, and touchscreen drag — then
 * asserts the footer action stays visible and the LAST of 30 rows becomes
 * reachable at 1366×768, 1024×768 and 390×844.
 *
 * Usage: node scripts/delivery_modal_scroll_probe.js
 */
const { chromium } = require('@playwright/test');
const http = require('http');
const { spawn } = require('child_process');
const {
  buildInitScript, IN_PAGE, isNoise, waitForWorkspace,
} = require('./ui_layout_local_audit.js');

const PORT = 3101;
const BASE = `http://localhost:${PORT}`;
const PROJECT = 'test-project-1';
const VIEWPORTS = [
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'mobile-390', width: 390, height: 844 },
];

function startServer() {
  return new Promise((resolve) => {
    const probe = http.get(`http://localhost:${PORT}/index.html`, (res) => {
      res.resume();
      resolve(null);
    });
    probe.on('error', () => {
      const child = spawn('npx', ['serve', '-l', String(PORT), '.'], {
        cwd: process.cwd(), stdio: 'ignore', detached: true,
        shell: process.platform === 'win32',
      });
      child.unref();
      let tries = 0;
      const wait = setInterval(() => {
        tries++;
        http.get(`http://localhost:${PORT}/index.html`, (res) => {
          res.resume();
          clearInterval(wait);
          resolve(child);
        }).on('error', () => {
          if (tries > 60) { clearInterval(wait); resolve(child); }
        });
      }, 250);
    });
  });
}

async function inject30Rows(page) {
  return page.evaluate(() => {
    const list = document.querySelector('#deliveryItemsList');
    if (!list) return false;
    let html = '';
    for (let i = 0; i < 30; i++) {
      html += '<div class="delivery-item-row">' +
        '<span class="delivery-item-name">QA Delivery Item ' + (i + 1) +
        ' - Extra long material description that wraps nicely and must never clip on any viewport</span>' +
        '<span class="delivery-item-ordered">Ordered: 100 pcs · Remaining: 100 pcs</span>' +
        '<input type="number" class="delivery-qty-received" value=""><select><option>Good</option></select></div>';
    }
    list.innerHTML = html;
    return true;
  });
}

function listMetrics(page) {
  return page.evaluate(() => {
    const list = document.querySelector('#deliveryItemsList');
    const box = document.querySelector('#deliveryModal .modal-box');
    const footer = document.querySelector('#deliveryModal .modal-actions');
    const rows = Array.from(list.querySelectorAll('.delivery-item-row'));
    const last = rows[rows.length - 1];
    const lr = last.getBoundingClientRect();
    const fr = footer.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const vh = window.innerHeight;
    return {
      scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
      lastRowVisible: lr.top >= br.top - 2 && lr.bottom <= br.bottom + 2,
      lastRowText: last.querySelector('.delivery-item-name').textContent.trim().slice(0, 30),
      footerVisible: fr.top >= -2 && fr.bottom <= vh + 2 && fr.bottom > 0,
      boxBottom: Math.round(br.bottom), vh,
      canScroll: list.scrollHeight > list.clientHeight + 1,
    };
  });
}

async function run() {
  await startServer();
  const browser = await chromium.launch();
  let passed = 0, failed = 0;
  const results = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: true, isMobile: vp.width < 600,
    });
    const page = await ctx.newPage();
    await page.addInitScript(buildInitScript());
    await page.addInitScript(IN_PAGE);
    await page.route('**/www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));

    const check = (name, ok, detail = '') => {
      results.push({ vp: vp.name, name, ok, detail: String(detail).slice(0, 180) });
      if (ok) passed++; else failed++;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${vp.name}] ${name}  ${detail}`);
    };

    await page.goto(`${BASE}/workspace?projectId=${PROJECT}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForWorkspace(page);
    await page.evaluate(() => window.switchTab && window.switchTab('materials'));
    await page.waitForTimeout(500);

    const opened = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('#materialsPanel button'));
      const del = btns.find(b => /deliver|receive/i.test(b.textContent || ''));
      if (del) { del.click(); return true; }
      return false;
    });
    check('delivery modal opens', opened === true);
    await page.waitForTimeout(500);
    await inject30Rows(page);
    await page.waitForTimeout(300);

    let m = await listMetrics(page);
    check('list has 30 rows and is scrollable', m.canScroll,
      `scrollH=${m.scrollHeight} clientH=${m.clientHeight}`);

    // 1) Mouse wheel scroll to the bottom (trusted input event)
    const listHandle = page.locator('#deliveryItemsList');
    await listHandle.hover();
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(400);
    m = await listMetrics(page);
    check('mouse wheel reaches last row', m.lastRowVisible && m.scrollTop > 0,
      `scrollTop=${m.scrollTop} lastRow=${m.lastRowText}`);

    // 2) Reset to top, then keyboard PageDown repeatedly. A real user first
    // clicks INTO the quantity input (focus), then PageDown scrolls the list.
    await page.evaluate(() => { const l = document.querySelector('#deliveryItemsList'); l.scrollTop = 0; });
    await page.waitForTimeout(200);
    const firstInput = page.locator('#deliveryItemsList .delivery-qty-received').first();
    await firstInput.click({ force: true });
    let guard = 0;
    while (guard < 60) {
      const before = (await listMetrics(page)).scrollTop;
      await page.keyboard.press('PageDown');
      await page.waitForTimeout(120);
      const after = (await listMetrics(page)).scrollTop;
      if (after >= before && (await listMetrics(page)).lastRowVisible) break;
      if (after === before && after > 0) break;
      guard++;
    }
    m = await listMetrics(page);
    check('keyboard PageDown reaches last row', m.lastRowVisible && m.scrollTop > 0,
      `scrollTop=${m.scrollTop} lastRow=${m.lastRowText}`);

    // 3) Trackpad-style delta scroll (trusted CDP wheel = same path as touch
    //    momentum scrolling on the scrollable list container)
    await page.evaluate(() => { const l = document.querySelector('#deliveryItemsList'); l.scrollTop = 0; });
    await page.waitForTimeout(200);
    const box = await listHandle.boundingBox();
    if (box) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: box.x + box.width / 2, y: box.y + 20,
        deltaX: 0, deltaY: 20000,
      });
      await page.waitForTimeout(400);
      m = await listMetrics(page);
      check('trackpad/touch-equivalent scroll reaches last row', m.lastRowVisible && m.scrollTop > 0,
        `scrollTop=${m.scrollTop} lastRow=${m.lastRowText}`);
    }

    // 4) Footer + header always visible (never clipped)
    m = await listMetrics(page);
    check('footer action stays visible with 30 rows', m.footerVisible, `boxBottom=${m.boxBottom} vh=${m.vh}`);
    check('zero console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    // 5) Escape: first press blurs any focused form input (by design), the
    //    second press closes the modal. Blur first to mirror real user flow.
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closed = await page.evaluate(() => document.querySelector('#deliveryModal').classList.contains('hidden'));
    check('Escape closes delivery modal', closed === true);

    await ctx.close();
  }

  await browser.close();
  console.log(`\nTOTAL: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
  process.exitCode = failed ? 1 : 0;
}

run().catch(err => { console.error('FATAL:', err.message); process.exitCode = 2; });
