const API_KEY = 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA';
const DB_URL = 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';

const ACTIVE_ROLES = new Set(['boss', 'owner', 'admin', 'pm', 'apm']);
const ADMIN_ROLES = new Set(['boss', 'owner', 'admin']);
const COMPANY_PROJECT_ROLES = new Set(['boss', 'owner', 'admin', 'pm']);
const ASSIGNED_ROLES = new Set(['apm']);
const DEFERRED_ROLES = new Set(['foreman', 'safety', 'viewer']);
const RC1_REQUIRED_ROLE_QA = ['admin', 'pm', 'apm'];

function assert(condition, label, details = {}) {
  if (!condition) {
    const err = new Error(label);
    err.details = details;
    throw err;
  }
}

function redact(value) {
  return String(value || '').replace(/(^.).*(@.*$)/, '$1***$2');
}

async function httpJson(url, options = {}, expectFailure = false) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (expectFailure) return { ok: res.ok, status: res.status, body };
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

function normalizeAssignedProjects(profile = {}) {
  const values = [];
  for (const key of ['projects', 'bossOf']) {
    const raw = profile[key];
    if (Array.isArray(raw)) values.push(...raw.filter(Boolean));
    else if (raw && typeof raw === 'object') values.push(...Object.keys(raw).filter(Boolean));
  }
  return [...new Set(values)];
}

function readAccountsFromEnv() {
  const accounts = [];
  if (process.env.ACPM_ROLE_QA_ACCOUNTS) {
    const parsed = JSON.parse(process.env.ACPM_ROLE_QA_ACCOUNTS);
    assert(Array.isArray(parsed), 'ACPM_ROLE_QA_ACCOUNTS must be a JSON array');
    accounts.push(...parsed);
  }

  for (const role of ['BOSS', 'ADMIN', 'PM', 'APM', 'FOREMAN', 'SAFETY', 'VIEWER']) {
    const email = process.env[`ACPM_${role}_QA_EMAIL`];
    const password = process.env[`ACPM_${role}_QA_PASSWORD`];
    if (email && password) {
      accounts.push({
        label: role,
        email,
        password,
        expectedRole: role.toLowerCase() === 'boss' ? 'boss' : role.toLowerCase()
      });
    }
  }

  if (!accounts.length && process.env.ACPM_QA_EMAIL && process.env.ACPM_QA_PASSWORD) {
    accounts.push({
      label: 'default-qa',
      email: process.env.ACPM_QA_EMAIL,
      password: process.env.ACPM_QA_PASSWORD,
      expectedRole: process.env.ACPM_QA_EXPECTED_ROLE || ''
    });
  }

  return accounts.filter(account => account && account.email && account.password);
}

async function readDb(path, token, extraParams = {}, expectFailure = false) {
  return httpJson(dbUrl(path, token, extraParams), {}, expectFailure);
}

async function verifyManagementAccount(account, auth, profile, role) {
  const assignedProjects = normalizeAssignedProjects(profile);
  const checks = [];

  assert(ACTIVE_ROLES.has(role), 'Management QA account must have an active RC1 role', { label: account.label, role });
  assert(profile.status === 'active' || ADMIN_ROLES.has(role), 'Management QA account must be active unless admin-capable', {
    label: account.label,
    status: profile.status || ''
  });

  const selfProfile = await readDb(`users/${auth.localId}`, auth.idToken);
  assert(selfProfile && selfProfile.role === role, 'Account must read its own profile', { label: account.label, role });
  checks.push('self profile read');

  if (COMPANY_PROJECT_ROLES.has(role)) {
    const rootProjects = await readDb('projects', auth.idToken, { shallow: 'true' });
    assert(rootProjects === null || typeof rootProjects === 'object', 'Company management account must read project index', { label: account.label });
    checks.push('project root read allowed');
  } else if (ASSIGNED_ROLES.has(role)) {
    const rootDenied = await readDb('projects', auth.idToken, { shallow: 'true' }, true);
    assert(rootDenied.ok === false, 'APM must not read full projects root directly', {
      label: account.label,
      status: rootDenied.status,
      assignedProjects,
      exposedProjectKeys: rootDenied.body && typeof rootDenied.body === 'object'
        ? Object.keys(rootDenied.body).slice(0, 20)
        : [],
      exposedProjectKeyCount: rootDenied.body && typeof rootDenied.body === 'object'
        ? Object.keys(rootDenied.body).length
        : 0,
      securityImpact: 'Deployed Firebase rules expose the projects index to an assigned APM account.'
    });
    checks.push('project root read denied');

    if (assignedProjects.length) {
      const projectShell = await readDb(`projects/${assignedProjects[0]}`, auth.idToken, { shallow: 'true' });
      assert(projectShell === null || typeof projectShell === 'object', 'APM must read assigned project', {
        label: account.label,
        projectId: assignedProjects[0]
      });
      checks.push('assigned project read allowed');
    } else {
      checks.push('assigned project read skipped - no assigned project');
    }
  }

  return {
    label: account.label || role,
    expectedRole: account.expectedRole || '',
    actualRole: role,
    email: redact(account.email),
    assignedProjectCount: assignedProjects.length,
    result: 'PASS',
    checks
  };
}

async function verifyDeferredAccount(account, auth, profile, role) {
  const assignedProjects = normalizeAssignedProjects(profile);
  const checks = [];

  assert(DEFERRED_ROLES.has(role), 'Deferred QA account must have Foreman/Safety/Viewer role', {
    label: account.label,
    role
  });

  const rootDenied = await readDb('projects', auth.idToken, { shallow: 'true' }, true);
  assert(rootDenied.ok === false, 'Deferred role must not read projects root', { label: account.label, status: rootDenied.status });
  checks.push('project root read denied');

  if (assignedProjects.length) {
    const assignedDenied = await readDb(`projects/${assignedProjects[0]}`, auth.idToken, { shallow: 'true' }, true);
    assert(assignedDenied.ok === false, 'Deferred role must not read assigned project object in RC1', {
      label: account.label,
      projectId: assignedProjects[0],
      status: assignedDenied.status
    });
    checks.push('assigned project object read denied');
  } else {
    checks.push('assigned project deny skipped - no assigned project');
  }

  return {
    label: account.label || role,
    expectedRole: account.expectedRole || '',
    actualRole: role,
    email: redact(account.email),
    assignedProjectCount: assignedProjects.length,
    result: 'PASS',
    checks
  };
}

async function verifyAccount(account) {
  assert(account.email && account.password, 'Role QA account requires email and password', { label: account.label || '' });
  const auth = await signIn(account.email, account.password);
  const profile = await readDb(`users/${auth.localId}`, auth.idToken);
  assert(profile && typeof profile === 'object', 'Signed-in account must have user profile', { label: account.label || '' });
  const role = String(profile.role || '').trim().toLowerCase();
  if (account.expectedRole) {
    assert(role === String(account.expectedRole).trim().toLowerCase(), 'Signed-in role must match expected role', {
      label: account.label || '',
      expectedRole: account.expectedRole,
      actualRole: role
    });
  }

  if (DEFERRED_ROLES.has(role)) {
    return verifyDeferredAccount(account, auth, profile, role);
  }
  return verifyManagementAccount(account, auth, profile, role);
}

async function main() {
  const accounts = readAccountsFromEnv();
  if (!accounts.length) {
    console.log(JSON.stringify({
      result: 'PASS_WITH_ROLE_ACCOUNTS_SKIPPED',
      skippedReason: 'No role-account credentials supplied. Set ACPM_ROLE_QA_ACCOUNTS JSON or ACPM_ADMIN_QA_EMAIL/PASSWORD, ACPM_PM_QA_EMAIL/PASSWORD, ACPM_APM_QA_EMAIL/PASSWORD, and future-role credentials when available.',
      rc1RequiredRoleQa: RC1_REQUIRED_ROLE_QA,
      rc1CoveredRoles: [],
      rc1MissingRoleQa: RC1_REQUIRED_ROLE_QA,
      rc1RoleAccountQaComplete: false,
      nextRequiredOwnerAction: 'Supply dedicated Admin/PM/APM credentials for read-only role-account QA.',
      checks: [
        'script syntax/loadable',
        'no Firebase writes attempted',
        'credential-driven role QA ready'
      ]
    }, null, 2));
    return;
  }

  const results = [];
  for (const account of accounts) {
    results.push(await verifyAccount(account));
  }

  const coveredRoles = [...new Set(results.map(r => r.actualRole))].sort();
  const rc1MissingRoleQa = RC1_REQUIRED_ROLE_QA.filter(role => !coveredRoles.includes(role));
  console.log(JSON.stringify({
    result: 'PASS',
    coveredRoles,
    rc1RequiredRoleQa: RC1_REQUIRED_ROLE_QA,
    rc1CoveredRoles: RC1_REQUIRED_ROLE_QA.filter(role => coveredRoles.includes(role)),
    rc1MissingRoleQa,
    rc1RoleAccountQaComplete: rc1MissingRoleQa.length === 0,
    nextRequiredOwnerAction: rc1MissingRoleQa.length
      ? `Supply dedicated credentials for missing RC1 role QA: ${rc1MissingRoleQa.join(', ')}.`
      : 'RC1 required role-account QA is complete.',
    accountsChecked: results.length,
    accountResults: results
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    result: 'FAILED',
    error: error.message,
    details: error.details || {}
  }, null, 2));
  process.exit(1);
});
