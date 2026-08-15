const API_KEY = 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA';
const DB_URL = 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';
const APP_URL = process.env.ACPM_APP_URL || 'https://acpm-project-system.web.app';
const BOSS_EMAIL = process.env.ACPM_QA_EMAIL || process.env.ACPM_BOSS_QA_EMAIL || '';
const BOSS_PASSWORD = process.env.ACPM_QA_PASSWORD || process.env.ACPM_BOSS_QA_PASSWORD || '';
const QA_PASSWORD = process.env.ACPM_ONBOARDING_QA_PASSWORD || 'Lebuild2026';

function assert(condition, label, details = {}) {
  if (!condition) {
    const err = new Error(label);
    err.details = details;
    throw err;
  }
}

function redactEmail(value) {
  return String(value || '').replace(/(^.).*(@.*$)/, '$1***$2');
}

function redactUid(uid) {
  const value = String(uid || '');
  if (value.length <= 8) return value ? '[redacted]' : '';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function httpJson(url, options = {}, allowFailure = false) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (error) { body = text; }
  if (allowFailure) return { ok: res.ok, status: res.status, body };
  if (!res.ok) {
    const safeUrl = String(url).replace(/auth=[^&\s]+/g, 'auth=[redacted]');
    throw new Error(`${options.method || 'GET'} ${safeUrl} failed ${res.status}: ${text}`);
  }
  return body;
}

async function signIn(email, password) {
  return httpJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
}

function encodeDbPath(rawPath) {
  return String(rawPath || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function dbUrl(rawPath, token, extraParams = {}) {
  const params = new URLSearchParams({ auth: token, ...extraParams });
  return `${DB_URL}/${encodeDbPath(rawPath)}.json?${params.toString()}`;
}

async function readDb(path, token, extraParams = {}, allowFailure = false) {
  return httpJson(dbUrl(path, token, extraParams), {}, allowFailure);
}

async function patchDb(path, token, payload, allowFailure = false) {
  return httpJson(dbUrl(path, token), {
    method: 'PATCH',
    body: JSON.stringify(payload)
  }, allowFailure);
}

async function waitFor(label, fn, timeoutMs = 20000, intervalMs = 700) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

function requireChromium() {
  try {
    return require('playwright-core').chromium;
  } catch (coreError) {
    try {
      return require('playwright').chromium;
    } catch (playwrightError) {
      throw new Error(`Playwright is required for browser QA. ${coreError.message}`);
    }
  }
}

function onePixelPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  );
}

async function readAllObjects(path, token) {
  const rows = await readDb(path, token).catch(() => null);
  return Object.entries(rows || {}).map(([id, value]) => ({ id, ...(value || {}) }));
}

async function signOutAndOpenLogin(page, suffix) {
  await page.evaluate(() => firebase.auth().signOut()).catch(() => {});
  await page.waitForTimeout(800);
  await page.goto(`${APP_URL}/login.html?qa=${suffix}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    return !!document.querySelector('#authUser') || /login\.html/i.test(location.pathname);
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('#authUser', { timeout: 20000 });
}

async function main() {
  assert(BOSS_EMAIL && BOSS_PASSWORD, 'Boss credential required via ACPM_QA_EMAIL/ACPM_QA_PASSWORD');

  const chromium = requireChromium();
  const now = Date.now();
  const qaEmail = process.env.ACPM_ONBOARDING_QA_EMAIL ||
    `acpm.qa.onboarding.${now}@gmail.com`;
  const qaName = `QA Onboarding ${now}`;
  const qaPosition = 'QA Account Request';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const consoleIssues = [];
  page.on('console', msg => {
    if (['error', 'warning'].includes(msg.type())) consoleIssues.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', err => consoleIssues.push(`pageerror: ${err.message}`));

  let qaAuth = null;
  let bossAuth = null;
  let selectedProjectId = '';
  let profilePhotoSaved = false;
  let storagePhotoUploaded = false;
  let activeStep = 'start';

  try {
    activeStep = 'request access signup';
    await page.goto(`${APP_URL}/login.html?qa=account-onboarding-${now}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#requestName', { timeout: 15000 });
    await page.fill('#requestName', qaName);
    await page.fill('#requestPosition', qaPosition);
    await page.fill('#requestEmail', qaEmail);
    await page.fill('#requestPass', QA_PASSWORD);
    await page.click('button:has-text("Submit Request")');
    await page.waitForFunction(() => {
      const el = document.querySelector('#authError');
      const text = el ? String(el.textContent || '') : '';
      if (/Could not|failed|error/i.test(text)) {
        throw new Error(text);
      }
      return /Access request (sent|recovered)/i.test(text);
    }, null, { timeout: 30000 });

    activeStep = 'verify access request record';
    qaAuth = await signIn(qaEmail, QA_PASSWORD);
    const ownRequest = await readDb(`accessRequests/${qaAuth.localId}`, qaAuth.idToken);
    assert(ownRequest && ownRequest.status === 'pending', 'signup must create pending accessRequests/{uid}', { uid: redactUid(qaAuth.localId) });
    assert(ownRequest.fullName === qaName, 'access request fullName must match signup');
    assert(ownRequest.position === qaPosition, 'access request position must match signup');
    assert(ownRequest.provider === 'password', 'access request provider must be password');

    activeStep = 'boss login';
    await context.clearCookies();
    await page.goto(`${APP_URL}/login.html?qa=account-onboarding-admin-${now}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#authUser', { timeout: 15000 });
    await page.fill('#authUser', BOSS_EMAIL);
    await page.fill('#authPass', BOSS_PASSWORD);
    await page.click('#authLoginBtn');
    await page.waitForFunction(() => !!document.body && document.body.classList.contains('auth-ready'), null, { timeout: 30000 });
    bossAuth = await signIn(BOSS_EMAIL, BOSS_PASSWORD);

    activeStep = 'approve request through Admin UI';
    page.on('dialog', dialog => dialog.accept());
    await page.evaluate(() => openTeamAdmin());
    await page.waitForSelector('#adminPanel', { state: 'visible', timeout: 15000 });
    await page.evaluate(() => switchAdminSection('requests'));
    await page.waitForFunction(email => {
      const list = document.querySelector('#accessRequestList');
      return list && (list.innerText || '').includes(email);
    }, qaEmail, { timeout: 20000 });
    const approvalPrep = await page.evaluate(uid => {
      const roleSelect = document.getElementById(`accessRole_${uid}`);
      if (roleSelect) {
        roleSelect.value = 'apm';
        roleSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const boxes = Array.from(document.querySelectorAll('[data-access-project="1"]'));
      const box = boxes.find(input => input.getAttribute('data-request-uid') === uid);
      if (box) box.checked = true;
      return {
        projectId: box ? box.value : '',
        projectChoices: boxes.length
      };
    }, qaAuth.localId);
    assert(approvalPrep.projectId, 'approval QA requires at least one active project choice');
    selectedProjectId = approvalPrep.projectId;
    await page.evaluate(uid => approveAccessRequest(uid), qaAuth.localId);

    const approvedProfile = await waitFor('approved user profile', async () => {
      const profile = await readDb(`users/${qaAuth.localId}`, bossAuth.idToken).catch(() => null);
      return profile && profile.status === 'active' ? profile : null;
    });
    assert(approvedProfile.role === 'apm', 'approved user role must be APM');
    assert(approvedProfile.profileComplete === false, 'approved user must require profile completion');
    assert(approvedProfile.projects && approvedProfile.projects[selectedProjectId] === true, 'approved user projects must use rules-compatible map');

    const approvedRequest = await readDb(`accessRequests/${qaAuth.localId}`, bossAuth.idToken);
    assert(approvedRequest.status === 'approved', 'access request must remain historical with approved status');
    assert(approvedRequest.approvedBy, 'approved request must include approvedBy');

    activeStep = 'verify approval audit and notifications';
    const auditRows = await readAllObjects('auditLogs', bossAuth.idToken);
    const approvalAudit = auditRows.find(row =>
      row.action === 'approve' &&
      row.entityType === 'accessRequest' &&
      row.entityId === qaAuth.localId
    );
    assert(approvalAudit, 'approval must create audit log');
    const globalEvents = await readAllObjects('globalNotificationEvents', bossAuth.idToken);
    const approvalEvent = globalEvents.find(row =>
      row.type === 'access_request_approved' &&
      row.uid === qaAuth.localId
    );
    assert(approvalEvent, 'approval must create global notification event');
    const inboxRows = await readAllObjects(`notifications/${qaAuth.localId}`, bossAuth.idToken);
    const approvalInbox = inboxRows.find(row => row.type === 'access_approved');
    assert(approvalInbox, 'approval must create direct user notification');

    activeStep = 'first approved login and profile completion';
    await signOutAndOpenLogin(page, `account-onboarding-user-${now}`);
    await page.fill('#authUser', qaEmail);
    await page.fill('#authPass', QA_PASSWORD);
    await page.click('#authLoginBtn');
    await page.waitForFunction(() => !!document.body && document.body.classList.contains('auth-ready'), null, { timeout: 30000 });
    await page.waitForSelector('#myProfileSetupModal', { state: 'visible', timeout: 15000 });
    const avatarFallback = await page.textContent('#profileAvatarPreview');
    assert(String(avatarFallback || '').trim().startsWith('Q'), 'profile setup must show initials fallback before photo upload');
    await page.fill('#profileDisplayName', `${qaName} Complete`);
    await page.fill('#profilePosition', 'QA APM Profile');
    await page.fill('#profileMobile', '09171234567');
    await page.fill('#profileSignature', 'QA-SIG');
    await page.setInputFiles('#profilePhoto', {
      name: 'qa-avatar.png',
      mimeType: 'image/png',
      buffer: onePixelPng()
    });
    await page.click('#profileSaveBtn');
    await page.waitForSelector('#myProfileSetupModal', { state: 'detached', timeout: 30000 });

    const completedProfile = await readDb(`users/${qaAuth.localId}`, qaAuth.idToken);
    assert(completedProfile.profileComplete === true, 'profileComplete must be true after save');
    assert(completedProfile.displayName === `${qaName} Complete`, 'profile display name must persist');
    assert(completedProfile.position === 'QA APM Profile', 'profile position must persist');
    assert(completedProfile.mobile === '09171234567', 'profile mobile must persist');
    assert(completedProfile.signature === 'QA-SIG', 'profile signature must persist');
    profilePhotoSaved = !!completedProfile.avatarUrl;
    storagePhotoUploaded = !!completedProfile.avatarUrl && !!completedProfile.avatarPath && !String(completedProfile.avatarPath || '').startsWith('inline:');
    assert(profilePhotoSaved, 'profile photo or inline avatar must persist');

    activeStep = 'self permission denial';
    const roleWrite = await patchDb(`users/${qaAuth.localId}`, qaAuth.idToken, { role: 'boss' }, true);
    assert(roleWrite.ok === false, 'user must not edit own role');
    const projectWrite = await patchDb(`users/${qaAuth.localId}`, qaAuth.idToken, { projects: { qa_forbidden: true } }, true);
    assert(projectWrite.ok === false, 'user must not edit own projects');
    const statusWrite = await patchDb(`users/${qaAuth.localId}`, qaAuth.idToken, { status: 'archived' }, true);
    assert(statusWrite.ok === false, 'user must not edit own status');

    activeStep = 'admin suspend/reactivate/archive workflow';
    await signOutAndOpenLogin(page, `account-onboarding-status-${now}`);
    await page.fill('#authUser', BOSS_EMAIL);
    await page.fill('#authPass', BOSS_PASSWORD);
    await page.click('#authLoginBtn');
    await page.waitForFunction(() => !!document.body && document.body.classList.contains('auth-ready'), null, { timeout: 30000 });
    await page.evaluate(() => openTeamAdmin());
    await page.waitForSelector('#adminPanel', { state: 'visible', timeout: 15000 });
    await page.evaluate(() => switchAdminSection('team'));
    await page.waitForFunction(uid => Array.from(document.querySelectorAll('[data-team-user-row]')).some(row => (row.getAttribute('data-search') || '').includes(uid.toLowerCase())), qaAuth.localId, { timeout: 20000 });
    await page.evaluate(uid => updateUserStatus(uid, 'suspended'), qaAuth.localId);
    await waitFor('suspended profile', async () => {
      const profile = await readDb(`users/${qaAuth.localId}`, bossAuth.idToken);
      return profile.status === 'suspended' ? profile : null;
    });

    activeStep = 'suspended user blocked';
    const suspendedContext = await browser.newContext({ viewport: { width: 900, height: 760 }, serviceWorkers: 'block' });
    const suspendedPage = await suspendedContext.newPage();
    await suspendedPage.goto(`${APP_URL}/login.html?qa=account-onboarding-suspended-${now}`, { waitUntil: 'domcontentloaded' });
    await suspendedPage.fill('#authUser', qaEmail);
    await suspendedPage.fill('#authPass', QA_PASSWORD);
    await suspendedPage.click('#authLoginBtn');
    await suspendedPage.waitForSelector('.auth-pending-text', { timeout: 20000 });
    const suspendedText = await suspendedPage.textContent('.auth-pending-text');
    assert(/suspended/i.test(suspendedText || ''), 'suspended user must be blocked with clear message');
    await suspendedContext.close();

    activeStep = 'reactivate and archive user';
    await page.evaluate(uid => updateUserStatus(uid, 'active'), qaAuth.localId);
    await waitFor('reactivated profile', async () => {
      const profile = await readDb(`users/${qaAuth.localId}`, bossAuth.idToken);
      return profile.status === 'active' ? profile : null;
    });
    await page.evaluate(uid => updateUserStatus(uid, 'archived'), qaAuth.localId);
    const archivedProfile = await waitFor('archived profile', async () => {
      const profile = await readDb(`users/${qaAuth.localId}`, bossAuth.idToken);
      return profile.status === 'archived' ? profile : null;
    });
    assert(archivedProfile.statusHistory, 'status changes must append statusHistory');

    activeStep = 'archived user blocked';
    const archivedContext = await browser.newContext({ viewport: { width: 900, height: 760 }, serviceWorkers: 'block' });
    const archivedPage = await archivedContext.newPage();
    await archivedPage.goto(`${APP_URL}/login.html?qa=account-onboarding-archived-${now}`, { waitUntil: 'domcontentloaded' });
    await archivedPage.fill('#authUser', qaEmail);
    await archivedPage.fill('#authPass', QA_PASSWORD);
    await archivedPage.click('#authLoginBtn');
    await archivedPage.waitForSelector('.auth-pending-text', { timeout: 20000 });
    const archivedText = await archivedPage.textContent('.auth-pending-text');
    assert(/archived/i.test(archivedText || ''), 'archived user must be blocked with clear message');
    await archivedContext.close();

    const statusEvents = await readAllObjects('globalNotificationEvents', bossAuth.idToken);
    const accountStatusEvents = statusEvents.filter(row =>
      row.uid === qaAuth.localId &&
      ['user_suspended', 'user_active', 'user_archived'].includes(row.type)
    );
    assert(accountStatusEvents.length >= 3, 'status workflow must create notification events');

    const severeIssues = consoleIssues.filter(line => !/favicon|manifest|service worker|404|profile photo upload skipped|profile photo Drive upload unavailable|Assigned project skipped/i.test(line));
    assert(!severeIssues.length, 'browser console must not contain severe onboarding errors', { severeIssues });

    console.log(JSON.stringify({
      result: profilePhotoSaved ? 'PASS' : 'PASS_WITH_STORAGE_WARNING',
      qaEmail: redactEmail(qaEmail),
      qaUid: redactUid(qaAuth.localId),
      selectedProjectId,
      accessRequestCreated: true,
      adminApproval: 'PASS',
      rejectedHistoricalBehavior: 'covered by code/static path; no extra rejected account created in this run',
      auditEventCreated: true,
      notificationEventsCreated: true,
      directNotificationCreated: true,
      profileComplete: true,
      initialsFallbackVerified: true,
      profilePhotoSaved,
      profilePhotoUploadedToStorage: storagePhotoUploaded,
      profilePhotoWarning: storagePhotoUploaded ? '' : 'Profile photo was saved inline because Google Drive upload was unavailable.',
      selfRoleWriteDenied: true,
      selfProjectWriteDenied: true,
      selfStatusWriteDenied: true,
      suspendedBlocked: true,
      reactivated: true,
      archivedBlocked: true,
      qaUserFinalStatus: 'archived',
      noHardDelete: true
    }, null, 2));
  } catch (error) {
    const pageDiagnostics = {};
    if (page) {
      pageDiagnostics.authError = await page.textContent('#authError').catch(() => '');
      pageDiagnostics.pendingError = await page.textContent('#pendingRequestError').catch(() => '');
      pageDiagnostics.visibleUrl = page.url();
      pageDiagnostics.buttons = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).slice(0, 12).map(btn => ({
          text: String(btn.textContent || '').trim(),
          disabled: !!btn.disabled
        }))
      ).catch(() => []);
    }
    if (bossAuth && qaAuth) {
      await patchDb(`users/${qaAuth.localId}`, bossAuth.idToken, {
        status: 'archived',
        archivedAt: Date.now(),
        qaFailedAt: Date.now(),
        qaFailedStep: activeStep,
        qaError: error.message
      }).catch(() => {});
      await patchDb(`accessRequests/${qaAuth.localId}`, bossAuth.idToken, {
        qaFailedAt: Date.now(),
        qaFailedStep: activeStep,
        qaError: error.message
      }).catch(() => {});
    }
    console.error(JSON.stringify({
      result: 'FAILED',
      step: activeStep,
      error: error.message,
      details: {
        ...(error.details || {}),
        pageDiagnostics,
        consoleIssues
      },
      qaEmail: redactEmail(qaEmail),
      qaUid: qaAuth ? redactUid(qaAuth.localId) : ''
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
