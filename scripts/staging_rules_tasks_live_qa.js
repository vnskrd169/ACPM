#!/usr/bin/env node
/**
 * staging_rules_tasks_live_qa.js
 *
 * Live behavioral QA of the DEPLOYED Staging database rules for the child-level
 * task transition state machine (projects/{pid}/tasks/{taskId} .validate).
 *
 * Flow:
 *   1. Creates two ephemeral QA accounts in the STAGING Auth project
 *      (pm.rulesqa@acpm.local, apm.rulesqa@acpm.local) via the Identity Toolkit
 *      REST API with the staging API key from environment.js.
 *   2. Seeds their user role records + a test project + APM project assignment
 *      through the console OAuth access token (admin access, same mechanism the
 *      Firebase console uses) — this only seeds, it never tests rules.
 *   3. Signs in as APM and PM, then exercises the LIVE deployed rules:
 *        - APM: create pending task            -> allowed
 *        - APM: pending -> in_progress         -> allowed
 *        - APM: in_progress -> for_verification -> allowed
 *        - APM: for_verification -> completed  -> DENIED (PM completion gate)
 *        - APM: fresh create with completed    -> DENIED (gate applies to create)
 *        - APM: pending -> completed (skip)    -> DENIED (state machine)
 *        - APM: mutate createdBy               -> DENIED (identity freeze)
 *        - PM:  for_verification -> completed  -> allowed
 *        - PM:  fresh create with completed    -> allowed
 *        - PM:  completed -> pending (reverse) -> DENIED (terminal state)
 *   4. Cleans up: deletes test project + user records + auth accounts.
 *
 * Exit code 0 = all assertions pass; 1 = any failure.
 */
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STAGING_API_KEY = 'AIzaSyC4qihU8oA4vbmIPusoURYfkQ8u-J3nF9g'; // environment.js staging
const STAGING_DB = 'https://acpm-project-system-qa-default-rtdb.asia-southeast1.firebasedatabase.app';
const AUTH_HOST = 'identitytoolkit.googleapis.com';

const PM_EMAIL = 'pm.rulesqa@acpm.local';
const APM_EMAIL = 'apm.rulesqa@acpm.local';
const QA_PASSWORD = 'RulesQa!' + Date.now().toString(36); // unique per run
const TEST_PROJECT = 'rulesqa-' + Date.now().toString(36);

let failures = 0;
function check(condition, label, detail) {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures++;
    console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : ''));
  }
}

// RTDB REST returns 401 ("Permission denied") or 403 for rule denials.
function isDenied(res) {
  return res.status === 401 || res.status === 403;
}

function httpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let body = null;
        try { body = data ? JSON.parse(data) : null; } catch (e) { body = data; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function authCall(path, body) {
  return httpJson(`https://${AUTH_HOST}${path}?key=${STAGING_API_KEY}`, { method: 'POST', body });
}

async function signIn(email, password) {
  const res = await authCall('/v1/accounts:signInWithPassword', { email, password, returnSecureToken: true });
  if (res.status !== 200) throw new Error('signIn failed ' + email + ': ' + JSON.stringify(res.body));
  return res.body;
}

async function signUp(email, password) {
  const res = await authCall('/v1/accounts:signUp', { email, password, returnSecureToken: true });
  if (res.status !== 200) throw new Error('signUp failed ' + email + ': ' + JSON.stringify(res.body));
  return res.body;
}

async function deleteAccount(idToken) {
  return authCall('/v1/accounts:delete', { idToken });
}

function getConsoleToken() {
  const f = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!j.tokens || !j.tokens.access_token) throw new Error('No console access token in configstore');
  return j.tokens.access_token;
}

function encodeDbPath(raw) {
  return String(raw || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

async function dbWrite(rawPath, body, token) {
  const url = `${STAGING_DB}/${encodeDbPath(rawPath)}.json?access_token=${token}`;
  return httpJson(url, { method: 'PUT', body });
}

async function dbPatch(rawPath, body, token) {
  const url = `${STAGING_DB}/${encodeDbPath(rawPath)}.json?access_token=${token}`;
  return httpJson(url, { method: 'PATCH', body });
}

async function dbDelete(rawPath, token) {
  const url = `${STAGING_DB}/${encodeDbPath(rawPath)}.json?access_token=${token}`;
  return httpJson(url, { method: 'DELETE' });
}

// App-level write via idToken (this is what the real rules evaluate)
async function appWrite(rawPath, body, idToken) {
  const url = `${STAGING_DB}/${encodeDbPath(rawPath)}.json?auth=${idToken}`;
  return httpJson(url, { method: 'PUT', body });
}

async function appPatch(rawPath, body, idToken) {
  const url = `${STAGING_DB}/${encodeDbPath(rawPath)}.json?auth=${idToken}`;
  return httpJson(url, { method: 'PATCH', body });
}

const TASK_TEMPLATE = (status, by) => ({
  title: 'RulesQA live transition test',
  status,
  createdAt: Date.now(),
  createdBy: by
});

async function main() {
  console.log('=== Staging deployed task-rules live QA ===');
  console.log('Staging DB:', STAGING_DB);
  console.log('Test project:', TEST_PROJECT);
  console.log('');

  // 1) Provision ephemeral accounts
  console.log('[1] Provisioning ephemeral QA accounts in staging Auth...');
  const pmAuth = await signUp(PM_EMAIL, QA_PASSWORD);
  const apmAuth = await signUp(APM_EMAIL, QA_PASSWORD);
  const pmUid = pmAuth.localId;
  const apmUid = apmAuth.localId;
  console.log('  PM uid:', pmUid);
  console.log('  APM uid:', apmUid);

  // 2) Seed roles + project via console admin access
  console.log('[2] Seeding roles + project via console access...');
  const consoleToken = getConsoleToken();
  await dbWrite(`users/${pmUid}`, { role: 'pm', status: 'active', name: 'RulesQA PM', position: 'Project Manager QA' }, consoleToken);
  await dbWrite(`users/${apmUid}`, { role: 'apm', status: 'active', name: 'RulesQA APM', position: 'Assoc. Project Manager QA', projects: { [TEST_PROJECT]: true } }, consoleToken);
  await dbWrite(`projects/${TEST_PROJECT}`, { name: 'RulesQA Transition Test', status: 'active', createdAt: Date.now(), createdBy: pmUid }, consoleToken);
  console.log('  Seeded.');

  // 3) Sign in as each role (real idTokens -> real rules evaluation)
  const pm = await signIn(PM_EMAIL, QA_PASSWORD);
  const apm = await signIn(APM_EMAIL, QA_PASSWORD);

  console.log('[3] Exercising DEPLOYED rules...');
  const taskPath = `projects/${TEST_PROJECT}/tasks/t1`;

  // 3a. APM lifecycle (allowed transitions)
  console.log('  -- APM allowed lifecycle --');
  let res = await appWrite(taskPath, TASK_TEMPLATE('pending', apmUid), apm.idToken);
  check(res.status === 200, 'APM create pending task', res.status);
  res = await appPatch(taskPath, { status: 'in_progress' }, apm.idToken);
  check(res.status === 200, 'APM pending -> in_progress', res.status);
  res = await appPatch(taskPath, { status: 'for_verification' }, apm.idToken);
  check(res.status === 200, 'APM in_progress -> for_verification', res.status);

  // 3b. APM denied paths
  console.log('  -- APM denied paths --');
  res = await appPatch(taskPath, { status: 'completed' }, apm.idToken);
  check(isDenied(res), 'APM for_verification -> completed DENIED (PM gate)', res.status);
  res = await appWrite(`projects/${TEST_PROJECT}/tasks/t2`, TASK_TEMPLATE('completed', apmUid), apm.idToken);
  check(isDenied(res), 'APM fresh create with completed DENIED', res.status);
  res = await appWrite(`projects/${TEST_PROJECT}/tasks/t3`, TASK_TEMPLATE('pending', apmUid), apm.idToken);
  if (res.status === 200) {
    res = await appPatch(`projects/${TEST_PROJECT}/tasks/t3`, { status: 'completed' }, apm.idToken);
    check(isDenied(res), 'APM pending -> completed (skip) DENIED', res.status);
  } else {
    check(false, 'APM pending -> completed (skip) DENIED', 'setup create t3 failed ' + res.status);
  }
  res = await appPatch(taskPath, { createdBy: pmUid }, apm.idToken);
  check(isDenied(res), 'APM mutate createdBy DENIED (identity freeze)', res.status);

  // 3c. PM allowed paths
  console.log('  -- PM allowed paths --');
  res = await appPatch(taskPath, { status: 'completed' }, pm.idToken);
  check(res.status === 200, 'PM for_verification -> completed', res.status);
  res = await appWrite(`projects/${TEST_PROJECT}/tasks/t4`, TASK_TEMPLATE('completed', pmUid), pm.idToken);
  check(res.status === 200, 'PM fresh create with completed', res.status);

  // 3d. PM denied paths
  console.log('  -- PM denied paths --');
  res = await appPatch(taskPath, { status: 'pending' }, pm.idToken);
  check(isDenied(res), 'PM completed -> pending (reverse) DENIED (terminal)', res.status);
  res = await appPatch(`projects/${TEST_PROJECT}/tasks/t4`, { createdAt: Date.now() }, pm.idToken);
  check(isDenied(res), 'PM mutate createdAt DENIED (identity freeze)', res.status);

  // 4) Cleanup
  console.log('[4] Cleanup...');
  await dbDelete(`projects/${TEST_PROJECT}`, consoleToken);
  await dbDelete(`users/${pmUid}`, consoleToken);
  await dbDelete(`users/${apmUid}`, consoleToken);
  await deleteAccount(pm.idToken);
  await deleteAccount(apm.idToken);
  console.log('  Cleaned up test project, user records, and auth accounts.');

  console.log('');
  if (failures === 0) {
    console.log('=== RESULT: PASS — all live transition assertions verified against deployed Staging rules ===');
    process.exit(0);
  } else {
    console.log(`=== RESULT: FAIL — ${failures} assertion(s) failed ===`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
