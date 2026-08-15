// Bootstrap boss profile, then provision all office users
// Run: node scripts/provision_office_users.js

const API_KEY = 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA';
const DB_URL = 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';

const BOSS_UID = 'bI4HiIa6UzRwqLxQQHDK1VY0cpn2';
const BOSS_EMAIL = 'boss@acpm.local';
const BOSS_PASS = 'Choiraboy169!';

const USERS = [
  { email: 'boss@acpm.local',   uid: BOSS_UID, role: 'boss',   name: 'Boss / Owner',       position: 'Company Owner' },
  { email: 'pm@acpm.local',     uid: null,     role: 'pm',     name: 'PM User',            position: 'Project Manager' },
  { email: 'apm@acpm.local',    uid: null,     role: 'apm',    name: 'APM User',           position: 'Assoc. Project Manager' }
];

async function httpJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? tryJson(text) : null, raw: text };
}

function tryJson(text) {
  try { return JSON.parse(text); } catch (e) { return text; }
}

function encodePath(raw) {
  return String(raw || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function dbUrl(path, token) {
  return `${DB_URL}/${encodePath(path)}.json?auth=${token}`;
}

async function main() {
  console.log('=== Provisioning Office Users ===\n');

  // Step 1: Sign in as boss
  console.log('1. Signing in as boss@acpm.local...');
  const authRes = await httpJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', body: JSON.stringify({ email: BOSS_EMAIL, password: BOSS_PASS, returnSecureToken: true }) }
  );
  if (!authRes.ok) {
    console.error('   ❌ Sign-in failed:', authRes.raw.slice(0, 200));
    console.error('\nMake sure boss@acpm.local with password Choiraboy169! exists in Firebase Auth.');
    console.error('Go to: https://console.firebase.google.com/project/acpm-project-system/authentication/users');
    process.exit(1);
  }
  const token = authRes.body.idToken;
  const bossActualUid = authRes.body.localId;
  console.log(`   ✅ Signed in. Token UID: ${bossActualUid.slice(0,8)}...${bossActualUid.slice(-4)}`);

  // Verify UID matches
  if (bossActualUid !== BOSS_UID) {
    console.log(`   ⚠️  UID mismatch! Expected: ${BOSS_UID.slice(0,8)}..., Actual: ${bossActualUid.slice(0,8)}...`);
    console.log('   Using actual UID from sign-in.');
  }
  const uid = bossActualUid;

  // Step 2: Try to write boss profile
  console.log('\n2. Writing boss profile to Realtime Database...');
  const now = Date.now();
  const bossProfile = {
    name: 'Boss / Owner',
    displayName: 'Boss / Owner',
    email: 'boss@acpm.local',
    position: 'Company Owner',
    role: 'boss',
    status: 'active',
    profileComplete: true,
    updatedAt: now,
    lastLoginAt: now
  };

  const writeRes = await httpJson(dbUrl(`users/${uid}`, token), {
    method: 'PUT',
    body: JSON.stringify(bossProfile)
  });

  if (writeRes.ok) {
    console.log('   ✅ Boss profile written successfully!\n');
  } else {
    console.log('   ❌ Database rules blocked the write.');
    console.log(`   Status: ${writeRes.status}`);
    console.log(`   Error: ${writeRes.raw.slice(0, 300)}\n`);
    console.log('   ╔══════════════════════════════════════════════════════════════╗');
    console.log('   ║  ACTION NEEDED: Create boss profile in Firebase Console     ║');
    console.log('   ╠══════════════════════════════════════════════════════════════╣');
    console.log('   ║  1. Open: https://console.firebase.google.com/project/      ║');
    console.log('   ║     acpm-project-system/database/acpm-project-system-       ║');
    console.log('   ║     default-rtdb/data                                       ║');
    console.log('   ║                                                            ║');
    console.log('   ║  2. Click + next to the root node                          ║');
    console.log('   ║  3. Add child node with key: users                         ║');
    console.log('   ║     (if it doesn\'t exist)                                   ║');
    console.log('   ║  4. Click + next to users, add child with key:              ║');
    console.log(`   ║     ${uid}                                      ║`);
    console.log('   ║  5. Add these fields one by one:                           ║');
    console.log('   ║     name:        "Boss / Owner"    (string)                ║');
    console.log('   ║     email:       "boss@acpm.local" (string)                ║');
    console.log('   ║     displayName: "Boss / Owner"    (string)                ║');
    console.log('   ║     role:        "boss"            (string)                ║');
    console.log('   ║     status:      "active"          (string)                ║');
    console.log('   ║     position:    "Company Owner"   (string)                ║');
    console.log('   ║     profileComplete: true          (boolean)               ║');
    console.log('   ║     updatedAt:   1712345678000     (number)                ║');
    console.log('   ║                                                            ║');
    console.log('   ║  OR copy this JSON:                                        ║');
    console.log('   ║  {"bossprofile": ' + JSON.stringify(bossProfile) + '}');
    console.log('   ║                                                            ║');
    console.log('   ║  6. Click Save. Then tell me "done"                        ║');
    console.log('   ╚══════════════════════════════════════════════════════════════╝');
    process.exit(1);
  }

  // Step 3: Check or create a project
  console.log('3. Checking existing projects...');
  const projRes = await httpJson(dbUrl('projects', token));
  let projectId, projectName;

  if (projRes.ok && projRes.body && typeof projRes.body === 'object') {
    const entries = Object.entries(projRes.body);
    const active = entries.find(([, p]) => p?.status === 'active') || entries[0];
    projectId = active[0];
    projectName = active[1]?.name || projectId;
    console.log(`   ✅ Found project: "${projectName}" (${projectId})\n`);
  } else {
    projectId = 'acpm-qa-test-' + now;
    projectName = 'ACPM QA Test';
    console.log(`   Creating project: ${projectName}...`);
    const createRes = await httpJson(dbUrl(`projects/${projectId}`, token), {
      method: 'PUT',
      body: JSON.stringify({
        name: projectName, status: 'active', createdAt: now,
        createdDate: new Date().toISOString().slice(0, 10),
        laborBudget: 500000, materialBudget: 1200000
      })
    });
    if (createRes.ok) console.log(`   ✅ Project created!\n`);
    else { console.error('   ❌ Project creation failed:', createRes.raw.slice(0, 200)); process.exit(1); }
  }

  // Step 4: Provision PM and APM users
  console.log('4. Provisioning PM and APM user profiles...\n');
  const results = [];

  for (const user of USERS) {
    if (user.role === 'boss') {
      results.push({ email: user.email, role: 'boss', status: 'already written', project: 'all' });
      continue;
    }
    try {
      // Sign in to get their UID
      const authRes2 = await httpJson(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
        { method: 'POST', body: JSON.stringify({ email: user.email, password: BOSS_PASS, returnSecureToken: true }) }
      );
      if (!authRes2.ok) {
        results.push({ email: user.email, role: user.role, status: 'auth account not found' });
        continue;
      }
      const userUid = authRes2.body.localId;
      const profile = {
        name: user.name,
        displayName: user.name,
        email: user.email,
        position: user.position,
        role: user.role,
        status: 'active',
        profileComplete: true,
        projects: { [projectId]: true },
        assignedProjects: [projectId],
        updatedAt: now,
        lastLoginAt: now
      };

      await httpJson(dbUrl(`users/${userUid}`, token), {
        method: 'PUT',
        body: JSON.stringify(profile)
      });

      results.push({ email: user.email, role: user.role, uid: `${userUid.slice(0,8)}...`, status: 'active', project: projectId });
      console.log(`   ✅ ${user.email.padEnd(22)} → role: ${user.role.padEnd(6)} UID: ${userUid.slice(0,8)}...`);
    } catch (err) {
      results.push({ email: user.email, role: user.role, status: 'failed', error: err.message });
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Project: ${projectName} (${projectId})`);
  console.table(results);

  const ok = results.filter(r => r.status !== 'failed' && r.status !== 'auth account not found');
  const failed = results.filter(r => r.status === 'failed' || r.status === 'auth account not found');
  console.log(`\n${ok.length}/${USERS.length} users provisioned successfully.`);
  if (failed.length > 0) {
    console.log(`⚠️  ${failed.length} user(s) failed. Check Firebase Console > Authentication > Users`);
  } else {
    console.log('\n✅ ALL DONE! Try logging in:');
    console.log('   https://acpm-project-system.web.app');
    console.log('\n   boss@acpm.local / Choiraboy169!');
    console.log('   pm@acpm.local / Choiraboy169!');
    console.log('   apm@acpm.local / Choiraboy169!');
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
