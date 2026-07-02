const API_KEY = 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA';
const DB_URL = 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';

const EMAIL = process.env.ACPM_QA_EMAIL || process.env.ACPM_BOSS_QA_EMAIL || '';
const PASSWORD = process.env.ACPM_QA_PASSWORD || process.env.ACPM_BOSS_QA_PASSWORD || '';
const ACTIVE_ROLES = ['boss', 'owner', 'admin', 'pm', 'apm'];
const RC1_REQUIRED_ROLE_QA = ['admin', 'pm', 'apm'];
const DEFERRED_ROLES = ['foreman', 'safety', 'viewer'];

if (!EMAIL || !PASSWORD) {
  console.log(JSON.stringify({
    result: 'PASS_WITH_INVENTORY_SKIPPED',
    skippedReason: 'Set ACPM_QA_EMAIL/ACPM_QA_PASSWORD or ACPM_BOSS_QA_EMAIL/ACPM_BOSS_QA_PASSWORD to run the read-only live user-role inventory.',
    writesAttempted: false
  }, null, 2));
  process.exit(0);
}

function redactEmail(value) {
  return String(value || '').replace(/(^.).*(@.*$)/, '$1***$2');
}

function redactUid(uid) {
  const value = String(uid || '');
  if (value.length <= 8) return value ? '[redacted]' : '';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function httpJson(url, options = {}) {
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
  if (!res.ok) {
    const safeUrl = String(url).replace(/auth=[^&\s]+/g, 'auth=[redacted]');
    throw new Error(`${options.method || 'GET'} ${safeUrl} failed ${res.status}: ${text}`);
  }
  return body;
}

async function signIn() {
  return httpJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true })
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

function summarizeUsers(users = {}) {
  const rows = Object.entries(users || {}).map(([uid, profile]) => {
    const assignedProjects = normalizeAssignedProjects(profile);
    return {
      uid: redactUid(uid),
      name: profile?.name || profile?.displayName || '',
      email: redactEmail(profile?.email || ''),
      role: String(profile?.role || '').trim().toLowerCase() || '(blank)',
      status: profile?.status || '',
      assignedProjectCount: assignedProjects.length
    };
  }).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));

  const roleCounts = rows.reduce((acc, row) => {
    acc[row.role] = (acc[row.role] || 0) + 1;
    return acc;
  }, {});

  return {
    rows,
    roleCounts,
    managementRolesPresent: ACTIVE_ROLES.filter(role => roleCounts[role]),
    managementRolesMissing: ACTIVE_ROLES.filter(role => !roleCounts[role]),
    rc1RequiredRoleQa: RC1_REQUIRED_ROLE_QA,
    rc1RequiredProfilesPresent: RC1_REQUIRED_ROLE_QA.filter(role => roleCounts[role]),
    rc1RequiredProfilesMissing: RC1_REQUIRED_ROLE_QA.filter(role => !roleCounts[role]),
    rc1ProfileInventoryReady: RC1_REQUIRED_ROLE_QA.every(role => roleCounts[role]),
    rc1RoleAccountQaStillRequired: RC1_REQUIRED_ROLE_QA,
    deferredRolesPresent: DEFERRED_ROLES.filter(role => roleCounts[role]),
    deferredRolesMissing: DEFERRED_ROLES.filter(role => !roleCounts[role])
  };
}

async function main() {
  const auth = await signIn();
  const users = await httpJson(dbUrl('users', auth.idToken));
  const summary = summarizeUsers(users || {});
  console.log(JSON.stringify({
    result: 'PASS_READ_ONLY_INVENTORY',
    checkedAt: new Date().toISOString(),
    writesAttempted: false,
    userCount: summary.rows.length,
    ...summary,
    nextRequiredOwnerAction: summary.rc1ProfileInventoryReady
      ? 'Supply dedicated Admin/PM/APM credentials to run scripts/roles_live_account_qa.js.'
      : `Create or identify missing RC1 profiles first: ${summary.rc1RequiredProfilesMissing.join(', ')}. Then supply dedicated Admin/PM/APM credentials.`
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    result: 'FAILED',
    error: error.message,
    writesAttempted: false
  }, null, 2));
  process.exit(1);
});
