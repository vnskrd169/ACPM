// ACPM Dev Shell — Playwright smoke
// Verifies:
//   1. dev-shell.html renders (localhost guard + emulator status)
//   2. workspace.html?dev=1&projectId=dev-pilot boots WITHOUT the login wall
//   3. The DEV SHELL badge appears and the emulator data is loaded
// Run: node dev/dev-shell-smoke.mjs
import { chromium } from 'playwright';

const BASE = 'http://localhost:5555';
let failures = 0;
function check(label, cond, extra = '') {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.error(`  FAIL  ${label} ${extra}`); }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  // 1. Launcher
  await page.goto(`${BASE}/dev-shell.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1500);
  const launcherText = await page.evaluate(() => document.body.innerText);
  check('launcher renders', launcherText.includes('ACPM Local Dev Shell'));
  check('launcher host guard OK', launcherText.includes('Local host detected'));
  check('emulator status shown', /Emulator (reachable|not reachable)/.test(launcherText));

  // 2. Workspace with dev bypass — click the launcher's workspace link
  //    (sets sessionStorage.acpm_dev_project, then navigates).
  await page.click('a[href*="projectId=dev-pilot"]', { timeout: 10000 });
  await page.waitForTimeout(11000);

  const badge = await page.$('#acpmDevShellBadge');
  check('DEV SHELL badge mounted', !!badge);

  const wsText = await page.evaluate(() => document.body.innerText || '');
  const noLoginWall = !/sign in|log in|email address|password/i.test(wsText.slice(0, 400));
  check('no login wall', noLoginWall);

  // 3. Emulator data reached the page
  check('project name rendered', wsText.includes('DEV Pilot Site') || wsText.includes('DEV Pilot'));
  check('workers rendered', wsText.includes('DEV Juan Dela Cruz') || wsText.includes('Juan Dela Cruz'));

  // 4. Console errors (allow the known offline/CDN noise, flag anything severe)
  const severe = consoleErrors.filter(e => !/favicon|net::ERR|gstatic|fonts|firebase|offline|Cache|Failed to load resource/i.test(e));
  check('no severe console errors', severe.length === 0, JSON.stringify(severe.slice(0, 3)));

  // 5. Confirm bypass wired the emulator (badge text)
  if (badge) {
    const badgeText = await badge.innerText();
    check('badge says local emulator', /local emulator/i.test(badgeText));
  }
} finally {
  await browser.close();
}

console.log(`\nDev shell smoke: ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} failure(s))`);
process.exit(failures === 0 ? 0 : 1);
