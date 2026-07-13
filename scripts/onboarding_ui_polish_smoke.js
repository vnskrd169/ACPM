const APP_URL = process.env.ACPM_APP_URL || 'https://acpm-project-system.web.app';
const EMAIL = process.env.ACPM_QA_EMAIL || '';
const PASSWORD = process.env.ACPM_QA_PASSWORD || '';

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function requireChromium() {
  try {
    return require('playwright-core').chromium;
  } catch (coreError) {
    try {
      return require('playwright').chromium;
    } catch (playwrightError) {
      throw new Error(`Playwright is required for UI smoke QA. ${coreError.message}`);
    }
  }
}

async function pageMetrics(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    const doc = document.documentElement;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: doc.scrollWidth,
      bodyText: document.body.innerText.slice(0, 2000)
    };
  }, selector);
}

function rectInsideViewport(metrics, allowance = 2) {
  return metrics &&
    metrics.left >= -allowance &&
    metrics.top >= -allowance &&
    metrics.right <= metrics.viewportWidth + allowance &&
    metrics.bottom <= metrics.viewportHeight + allowance;
}

async function assertNoHorizontalOverflow(page, label, allowance = 6) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));
  assert(metrics.scrollWidth <= metrics.viewportWidth + allowance, `${label} must not horizontally overflow`, metrics);
}

async function main() {
  assert(EMAIL && PASSWORD, 'Set ACPM_QA_EMAIL and ACPM_QA_PASSWORD before running UI smoke.');
  const chromium = requireChromium();
  const browser = await chromium.launch({ headless: true });
  const consoleIssues = [];

  try {
    const loginContext = await browser.newContext({
      viewport: { width: 390, height: 780 },
      serviceWorkers: 'block'
    });
    const loginPage = await loginContext.newPage();
    loginPage.on('console', msg => {
      if (['error', 'warning'].includes(msg.type())) consoleIssues.push(`login ${msg.type()}: ${msg.text()}`);
    });
    await loginPage.goto(`${APP_URL}/login.html?qa=ui-polish-login-${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await loginPage.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      if (window.firebase && firebase.auth) return firebase.auth().signOut().catch(() => {});
      return null;
    }).catch(() => {});
    await loginPage.goto(`${APP_URL}/login.html?qa=ui-polish-login-fresh-${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await loginPage.waitForSelector('#authOverlay', { timeout: 15000 });
    await loginPage.waitForSelector('#requestName', { timeout: 15000 });
    await assertNoHorizontalOverflow(loginPage, 'mobile login/request form');
    const authCard = await pageMetrics(loginPage, '.auth-box');
    assert(rectInsideViewport(authCard, 8), 'mobile login card must fit viewport', authCard);
    const pendingType = await loginPage.evaluate(() => typeof showPendingAccessScreen);
    assert(pendingType === 'function', 'pending screen renderer must be available');
    await loginPage.evaluate(() => showPendingAccessScreen({
      name: 'QA Pending User',
      displayName: 'QA Pending User',
      email: 'qa.pending@example.com',
      position: 'QA APM',
      status: 'pending',
      pendingReason: 'QA pending screen preview.'
    }));
    await loginPage.waitForSelector('.auth-pending', { timeout: 10000 });
    await assertNoHorizontalOverflow(loginPage, 'mobile pending screen');
    const pendingCard = await pageMetrics(loginPage, '.auth-box');
    assert(rectInsideViewport(pendingCard, 8), 'mobile pending card must fit viewport', pendingCard);
    await loginContext.close();

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block'
    });
    const page = await context.newPage();
    page.on('console', msg => {
      if (['error', 'warning'].includes(msg.type())) consoleIssues.push(`app ${msg.type()}: ${msg.text()}`);
    });
    await page.goto(`${APP_URL}/login.html?qa=ui-polish-app-${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#authUser', { timeout: 15000 });
    await page.fill('#authUser', EMAIL);
    await page.fill('#authPass', PASSWORD);
    await page.click('#authLoginBtn');
    await page.waitForFunction(() => !!document.body && document.body.classList.contains('auth-ready'), null, { timeout: 30000 });
    await assertNoHorizontalOverflow(page, 'desktop dashboard');

    await page.click('#notifBellBtn');
    await page.waitForSelector('.notif-dropdown:not(.hidden)', { timeout: 10000 });
    const dropdown = await pageMetrics(page, '.notif-dropdown');
    assert(rectInsideViewport(dropdown, 4), 'notification dropdown must fit viewport', dropdown);
    const notifText = await page.textContent('.notif-dropdown');
    assert(/Notifications/i.test(notifText || ''), 'notification panel must have a clear title');
    assert(!/[�]/.test(notifText || ''), 'notification panel must not show mojibake');

    await page.evaluate(() => openTeamAdmin());
    await page.waitForSelector('#adminPanel:not(.hidden)', { timeout: 15000 });
    await page.waitForSelector('#adminTab_team', { state: 'visible', timeout: 10000 });
    const adminNavInfo = await page.evaluate(() => ({
      visibleAdminTabs: Array.from(document.querySelectorAll('#adminPanel > .tab-scroll .tab-btn'))
        .filter(el => el.offsetParent !== null)
        .map(el => el.textContent.trim()),
      activeAdminTab: document.querySelector('#adminPanel > .tab-scroll .tab-active')?.textContent?.trim() || '',
      activeTeamSection: !document.querySelector('#adminSection_team')?.classList.contains('hidden')
    }));
    assert(adminNavInfo.visibleAdminTabs.some(label => /Team/i.test(label)), 'Team Admin must show the Team sub-tab', adminNavInfo);
    assert(adminNavInfo.visibleAdminTabs.some(label => /Requests/i.test(label)), 'Team Admin must show the Requests sub-tab', adminNavInfo);
    assert(adminNavInfo.visibleAdminTabs.some(label => /Audit Log/i.test(label)), 'Team Admin must show the Audit Log sub-tab', adminNavInfo);
    assert(adminNavInfo.visibleAdminTabs.some(label => /System/i.test(label)), 'Team Admin must show the System sub-tab', adminNavInfo);
    assert(/Team/i.test(adminNavInfo.activeAdminTab) && adminNavInfo.activeTeamSection, 'Team Admin should default to Team assignment view', adminNavInfo);
    await page.waitForSelector('[data-team-user-row]', { timeout: 20000 });
    const teamMetrics = await pageMetrics(page, '#adminPanel');
    assert(teamMetrics.width > 400, 'Team Admin panel must render at desktop width', teamMetrics);
    const teamInfo = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-team-user-row]').length,
      avatars: document.querySelectorAll('#adminPanel .team-avatar').length,
      actionStacks: document.querySelectorAll('#adminPanel .team-action-stack').length,
      visibleProjectTabs: Array.from(document.querySelectorAll('[data-project-tab]'))
        .filter(el => el.offsetParent !== null)
        .map(el => el.textContent.trim())
    }));
    assert(teamInfo.rows > 0, 'Team Admin must render users', teamInfo);
    assert(teamInfo.avatars >= teamInfo.rows, 'Team Admin must render avatars/initials', teamInfo);
    assert(teamInfo.actionStacks >= teamInfo.rows, 'Team Admin must render status action stacks', teamInfo);
    assert(!teamInfo.visibleProjectTabs.some(label => /Labor|Materials|Billing|Site Log|Extras|PMOS/i.test(label)), 'Team Admin must hide project module tabs', teamInfo);

    await page.evaluate(() => showMyProfileSetup(window._currentUser || {}));
    await page.waitForSelector('#myProfileSetupModal', { timeout: 10000 });
    const profileMetrics = await pageMetrics(page, '.profile-setup-box');
    assert(rectInsideViewport(profileMetrics, 10), 'profile setup modal must fit viewport', profileMetrics);
    const profileText = await page.textContent('#myProfileSetupModal');
    assert(/Role and project assignments stay admin-only/i.test(profileText || ''), 'profile modal must explain admin-only fields');

    const severeIssues = consoleIssues.filter(line =>
      !/Service Worker registration blocked|Service Worker registration unavailable|Assigned project skipped|Notification listener skipped/i.test(line)
    );
    assert(!severeIssues.length, 'UI smoke must not have severe console issues', { severeIssues });

    console.log(JSON.stringify({
      result: 'PASS',
      loginMobile: 'PASS',
      pendingMobile: 'PASS',
      notificationsPanel: 'PASS',
      teamAdmin: teamInfo,
      profileModal: 'PASS',
      adminNav: 'PASS',
      consoleWarningsIgnored: consoleIssues.length - severeIssues.length
    }, null, 2));
    await context.close();
  } catch (error) {
    console.error(JSON.stringify({
      result: 'FAILED',
      error: error.message,
      details: error.details || {},
      consoleIssues
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
});
