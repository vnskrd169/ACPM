// Assign PM/APM to both existing and new projects
// Run: node scripts/fix_pm_apm_projects.js

const API_KEY = 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA';
const DB_URL = 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';
const BOSS_EMAIL = 'boss@acpm.local';
const BOSS_PASS = 'Choiraboy169!';

async function httpJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? (() => { try { return JSON.parse(text); } catch(e) { return text; } })() : null, raw: text };
}

function encodePath(raw) {
  return String(raw || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function dbUrl(path, token) {
  return `${DB_URL}/${encodePath(path)}.json?auth=${token}`;
}

async function main() {
  console.log('=== Fixing PM/APM Project Assignments ===\n');

  // Sign in as boss
  const authRes = await httpJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', body: JSON.stringify({ email: BOSS_EMAIL, password: BOSS_PASS, returnSecureToken: true }) }
  );
  if (!authRes.ok) { console.error('❌ Boss sign-in failed'); process.exit(1); }
  const token = authRes.body.idToken;
  console.log('✅ Signed in as boss\n');

  // List all projects
  const projRes = await httpJson(dbUrl('projects', token));
  const projects = projRes.ok && projRes.body ? Object.entries(projRes.body).map(([id, p]) => ({ id, name: p?.name || id, status: p?.status || '' })) : [];
  console.log(`Found ${projects.length} project(s):`);
  projects.forEach(p => console.log(`   ${p.id} → "${p.name}" (${p.status})`));
  console.log();

  // Get PM UID by signing in
  const pmAuth = await httpJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', body: JSON.stringify({ email: 'pm@acpm.local', password: BOSS_PASS, returnSecureToken: true }) }
  );
  const apmAuth = await httpJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', body: JSON.stringify({ email: 'apm@acpm.local', password: BOSS_PASS, returnSecureToken: true }) }
  );

  const pmUid = pmAuth.body?.localId;
  const apmUid = apmAuth.body?.localId;
  console.log(`PM UID: ${(pmUid || 'NOT FOUND').slice(0,8)}...`);
  console.log(`APM UID: ${(apmUid || 'NOT FOUND').slice(0,8)}...\n`);

  // Build project maps and arrays from ALL projects
  const allProjectIds = projects.map(p => p.id);
  const projectsMap = {};
  allProjectIds.forEach(id => { projectsMap[id] = true; });

  // Update PM
  if (pmUid) {
    const pmUpdate = {
      projects: projectsMap,
      assignedProjects: allProjectIds,
      updatedAt: Date.now()
    };
    const pmRes = await httpJson(dbUrl(`users/${pmUid}`, token), {
      method: 'PATCH',
      body: JSON.stringify(pmUpdate)
    });
    console.log(`PM updated: ${pmRes.ok ? '✅' : '❌'} — assigned to ${allProjectIds.length} project(s)`);
  }

  // Update APM
  if (apmUid) {
    const apmUpdate = {
      projects: projectsMap,
      assignedProjects: allProjectIds,
      updatedAt: Date.now()
    };
    const apmRes = await httpJson(dbUrl(`users/${apmUid}`, token), {
      method: 'PATCH',
      body: JSON.stringify(apmUpdate)
    });
    console.log(`APM updated: ${apmRes.ok ? '✅' : '❌'} — assigned to ${allProjectIds.length} project(s)`);
  }

  console.log('\n✅ Done! PM and APM can now access all projects.');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
