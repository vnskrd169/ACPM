const API_KEY = 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA';
const DB_URL = 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';

const targetEmail = process.env.ACPM_OWNER_EMAIL || '';
const targetPassword = process.env.ACPM_OWNER_PASSWORD || '';
const bootstrapEmail = process.env.ACPM_BOOTSTRAP_BOSS_EMAIL || '';
const bootstrapPassword = process.env.ACPM_BOOTSTRAP_BOSS_PASSWORD || '';
const displayName = process.env.ACPM_OWNER_DISPLAY_NAME || 'Boss / Owner';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function httpJson(url, options = {}, allowFailure = false) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (error) { body = text; }
  if (allowFailure) return { ok: response.ok, status: response.status, body };
  if (!response.ok) throw new Error(`Firebase request failed (${response.status}).`);
  return body;
}

async function signIn(email, password) {
  return httpJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
}

function dbUrl(path, token) {
  const encoded = String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `${DB_URL}/${encoded}.json?auth=${encodeURIComponent(token)}`;
}

async function main() {
  assert(targetEmail && targetPassword, 'ACPM_OWNER_EMAIL and ACPM_OWNER_PASSWORD are required.');
  assert(bootstrapEmail && bootstrapPassword, 'Bootstrap Boss credentials are required.');

  const [targetAuth, bootstrapAuth] = await Promise.all([
    signIn(targetEmail, targetPassword),
    signIn(bootstrapEmail, bootstrapPassword)
  ]);

  const existing = await httpJson(dbUrl(`users/${targetAuth.localId}`, bootstrapAuth.idToken));
  if (existing) {
    console.log(JSON.stringify({
      result: 'NO_CHANGE',
      reason: 'Owner profile already exists.',
      role: existing.role || '',
      status: existing.status || ''
    }, null, 2));
    return;
  }

  const now = Date.now();
  const profile = {
    uid: targetAuth.localId,
    displayName,
    name: displayName,
    email: targetEmail,
    position: 'Boss / Owner',
    role: 'boss',
    status: 'active',
    projects: {},
    assignedProjects: {},
    bossOf: {},
    profileComplete: true,
    restoredAt: now,
    restoredBy: bootstrapAuth.localId,
    createdAt: now,
    updatedAt: now
  };

  await httpJson(dbUrl(`users/${targetAuth.localId}`, bootstrapAuth.idToken), {
    method: 'PUT',
    body: JSON.stringify(profile)
  });

  await httpJson(dbUrl('auditLogs', bootstrapAuth.idToken), {
    method: 'POST',
    body: JSON.stringify({
      action: 'restore_owner_profile',
      module: 'accounts',
      recordId: targetAuth.localId,
      userId: bootstrapAuth.localId,
      userName: 'Bootstrap Boss',
      timestamp: now,
      createdAt: now,
      notes: 'Restored missing owner database profile for an existing Firebase Auth account.'
    })
  }, true);

  console.log(JSON.stringify({
    result: 'PASS',
    profileCreated: true,
    role: profile.role,
    status: profile.status,
    auditAttempted: true
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
});
