const API_KEY = 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA';
const DB_URL = 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';

const BOSS_EMAIL = process.env.ACPM_QA_EMAIL || process.env.ACPM_BOSS_QA_EMAIL || '';
const BOSS_PASSWORD = process.env.ACPM_QA_PASSWORD || process.env.ACPM_BOSS_QA_PASSWORD || '';
const QA_PASSWORD = process.env.ACPM_RC1_QA_PASSWORD || 'Lebuild2026';
const PROJECT_ID_OVERRIDE = process.env.ACPM_RC1_QA_PROJECT_ID || '';

const DEFAULT_ACCOUNTS = [
  { label: 'admin', email: process.env.ACPM_RC1_ADMIN_EMAIL || 'admin.qa@lebuild.test', role: 'admin', name: 'RC1 QA Admin', position: 'Admin QA' },
  { label: 'pm', email: process.env.ACPM_RC1_PM_EMAIL || 'pm.qa@lebuild.test', role: 'pm', name: 'RC1 QA PM', position: 'Project Manager QA' },
  { label: 'apm', email: process.env.ACPM_RC1_APM_EMAIL || 'apm.qa@lebuild.test', role: 'apm', name: 'RC1 QA APM', position: 'Assoc. Project Manager QA' }
];

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

async function signUpOrSignIn(email, password) {
  const signUp = await httpJson(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST',
    body: JSON.stringify({ email, password, returnSecureToken: true })
  }, true);

  if (signUp.ok) {
    return { auth: signUp.body, authAction: 'created' };
  }

  const message = signUp.body?.error?.message || '';
  if (message !== 'EMAIL_EXISTS') {
    throw new Error(`Could not create ${redactEmail(email)}: ${message || signUp.status}`);
  }

  const existing = await signIn(email, password);
  return { auth: existing, authAction: 'reused' };
}

function encodeDbPath(rawPath) {
  return String(rawPath || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function dbUrl(rawPath, token, extraParams = {}) {
  const params = new URLSearchParams({ auth: token, ...extraParams });
  return `${DB_URL}/${encodeDbPath(rawPath)}.json?${params.toString()}`;
}

async function readDb(path, token, extraParams = {}) {
  return httpJson(dbUrl(path, token, extraParams));
}

async function patchDb(path, token, payload) {
  return httpJson(dbUrl(path, token), {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

async function selectAssignmentProject(token) {
  if (PROJECT_ID_OVERRIDE) {
    const project = await readDb(`projects/${PROJECT_ID_OVERRIDE}`, token);
    assert(project && typeof project === 'object', 'ACPM_RC1_QA_PROJECT_ID does not exist', { projectId: PROJECT_ID_OVERRIDE });
    return { projectId: PROJECT_ID_OVERRIDE, projectName: project.name || PROJECT_ID_OVERRIDE, source: 'env' };
  }

  const projects = await readDb('projects', token);
  const rows = Object.entries(projects || {}).map(([projectId, project]) => ({
    projectId,
    projectName: project?.name || projectId,
    status: project?.status || ''
  }));
  assert(rows.length, 'No projects found for PM/APM QA assignment');

  const selected = rows.find(row => row.status === 'active') || rows[0];
  return { ...selected, source: selected.status === 'active' ? 'first-active' : 'first-available' };
}

function profilePatchFor(account, assignment) {
  const now = Date.now();
  const patch = {
    name: account.name,
    email: account.email,
    position: account.position,
    role: account.role,
    status: 'active',
    qaAccount: true,
    qaPurpose: 'RC1 role-account QA',
    updatedAt: now
  };

  if (account.role === 'pm' || account.role === 'apm') {
    patch.projects = { [assignment.projectId]: true };
  }

  return patch;
}

async function main() {
  assert(BOSS_EMAIL && BOSS_PASSWORD, 'Boss credential is required via ACPM_QA_EMAIL/ACPM_QA_PASSWORD or ACPM_BOSS_QA_EMAIL/ACPM_BOSS_QA_PASSWORD');

  const bossAuth = await signIn(BOSS_EMAIL, BOSS_PASSWORD);
  const assignment = await selectAssignmentProject(bossAuth.idToken);
  const accountResults = [];

  for (const account of DEFAULT_ACCOUNTS) {
    const { auth, authAction } = await signUpOrSignIn(account.email, QA_PASSWORD);
    const existingProfile = await readDb(`users/${auth.localId}`, bossAuth.idToken).catch(() => null);
    await patchDb(`users/${auth.localId}`, bossAuth.idToken, profilePatchFor(account, assignment));

    accountResults.push({
      label: account.label,
      role: account.role,
      email: redactEmail(account.email),
      uid: redactUid(auth.localId),
      authAction,
      profileAction: existingProfile ? 'updated' : 'created',
      assignedProjectCount: account.role === 'pm' || account.role === 'apm' ? 1 : 0
    });
  }

  console.log(JSON.stringify({
    result: 'PASS',
    writesAttempted: true,
    passwordPrinted: false,
    assignmentProject: {
      projectId: assignment.projectId,
      projectName: assignment.projectName,
      source: assignment.source
    },
    accountResults,
    nextStep: 'Run scripts/roles_live_account_qa.js with the QA account credentials, then scripts/rc1_final_readiness_gate.js.'
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
