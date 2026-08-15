const API_KEY = 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA';
const DB_URL = 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';

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
  try { body = text ? JSON.parse(text) : null; } catch (error) { body = text; }
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

async function readDb(path, token, extraParams = {}, expectFailure = false) {
  return httpJson(dbUrl(path, token, extraParams), {}, expectFailure);
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

function roleCredentials(role) {
  const upper = role.toUpperCase();
  const email = process.env[`ACPM_${upper}_QA_EMAIL`];
  const password = process.env[`ACPM_${upper}_QA_PASSWORD`];
  if (email && password) return { label: role, email, password };

  if (process.env.ACPM_ROLE_QA_ACCOUNTS) {
    const accounts = JSON.parse(process.env.ACPM_ROLE_QA_ACCOUNTS);
    assert(Array.isArray(accounts), 'ACPM_ROLE_QA_ACCOUNTS must be a JSON array');
    return accounts.find(account => String(account.expectedRole || account.label || '').toLowerCase() === role);
  }

  return null;
}

async function verifyProjectRole(role) {
  const account = roleCredentials(role);
  assert(account?.email && account?.password, `Missing ${role.toUpperCase()} QA credentials`, {
    expectedEnv: [`ACPM_${role.toUpperCase()}_QA_EMAIL`, `ACPM_${role.toUpperCase()}_QA_PASSWORD`]
  });

  const auth = await signIn(account.email, account.password);
  const profile = await readDb(`users/${auth.localId}`, auth.idToken);
  assert(String(profile?.role || '').toLowerCase() === role, `${role.toUpperCase()} QA account has wrong role`, {
    email: redact(account.email),
    actualRole: profile?.role || ''
  });

  const assignedProjects = normalizeAssignedProjects(profile);
  const rootRead = await readDb('projects', auth.idToken, { shallow: 'true' }, true);
  if (role === 'pm') {
    assert(rootRead.ok === true && (rootRead.body === null || typeof rootRead.body === 'object'), 'PM must read the company project index', {
      status: rootRead.status
    });
  } else {
    assert(rootRead.ok === false, 'APM must not read full projects root', {
      status: rootRead.status,
      assignedProjects,
      exposedProjectKeyCount: rootRead.body && typeof rootRead.body === 'object'
        ? Object.keys(rootRead.body).length
        : 0,
      exposedProjectKeys: rootRead.body && typeof rootRead.body === 'object'
        ? Object.keys(rootRead.body).slice(0, 20)
        : []
    });
  }

  if (assignedProjects.length) {
    const assignedRead = await readDb(`projects/${assignedProjects[0]}`, auth.idToken, { shallow: 'true' });
    assert(assignedRead === null || typeof assignedRead === 'object', `${role.toUpperCase()} must read assigned project`, {
      projectId: assignedProjects[0]
    });
  } else if (role === 'apm') {
    throw new Error('APM QA account must have an assigned project');
  }

  return {
    role,
    email: redact(account.email),
    assignedProjectCount: assignedProjects.length,
    checks: [
      'self profile role matches',
      role === 'pm' ? 'projects root allowed' : 'projects root denied',
      assignedProjects.length ? 'assigned project allowed' : 'assigned project not required'
    ]
  };
}

async function main() {
  const results = [];
  for (const role of ['pm', 'apm']) {
    results.push(await verifyProjectRole(role));
  }

  console.log(JSON.stringify({
    result: 'PASS',
    writesAttempted: false,
    checks: [
      'PM projects root allowed',
      'PM company-wide project visibility confirmed',
      'APM projects root denied',
      'APM assigned project allowed'
    ],
    results
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    result: 'FAILED',
    error: error.message,
    details: error.details || {},
    writesAttempted: false
  }, null, 2));
  process.exit(1);
});
