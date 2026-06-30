const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API_KEY = 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA';
const DB_URL = 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';
const EMAIL = process.env.ACPM_QA_EMAIL || '';
const PASSWORD = process.env.ACPM_QA_PASSWORD || '';

if (!EMAIL || !PASSWORD) {
  console.error('Set ACPM_QA_EMAIL and ACPM_QA_PASSWORD before running this QA script.');
  process.exit(2);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy value`);
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
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} failed ${res.status}: ${text}`);
  return body;
}

async function signIn() {
  return httpJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true })
  });
}

function pushKey() {
  return `qa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function encodeDbPath(rawPath) {
  return String(rawPath || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function makeRestClient(idToken) {
  function url(rawPath) {
    return `${DB_URL}/${encodeDbPath(rawPath)}.json?auth=${encodeURIComponent(idToken)}`;
  }
  return {
    get: rawPath => httpJson(url(rawPath)),
    set: (rawPath, value) => httpJson(url(rawPath), { method: 'PUT', body: JSON.stringify(value) }),
    update: (rawPath, value) => httpJson(url(rawPath), { method: 'PATCH', body: JSON.stringify(value) })
  };
}

function makeSnapshot(key, value) {
  return {
    key,
    exists() { return value !== null && value !== undefined; },
    val() { return value === undefined ? null : value; },
    forEach(callback) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      for (const childKey of Object.keys(value)) {
        const stop = callback(makeSnapshot(childKey, value[childKey]));
        if (stop === true) return true;
      }
      return false;
    }
  };
}

function makeFirebaseAdapter(rest, authUser) {
  class Ref {
    constructor(rawPath) {
      this.path = String(rawPath || '').replace(/^\/+|\/+$/g, '');
      const parts = this.path.split('/').filter(Boolean);
      this.key = parts.length ? parts[parts.length - 1] : null;
    }
    child(childPath) { return new Ref(`${this.path}/${childPath}`); }
    async once(event) {
      if (event !== 'value') throw new Error(`Unsupported event: ${event}`);
      return makeSnapshot(this.key, await rest.get(this.path));
    }
    async set(value) { await rest.set(this.path, value); return this; }
    async update(value) { await rest.update(this.path, value); return this; }
    push(value) {
      const child = new Ref(`${this.path}/${pushKey()}`);
      if (arguments.length) child.set(value);
      return child;
    }
    async transaction(updateFn) {
      const current = await rest.get(this.path);
      const next = updateFn(current);
      await rest.set(this.path, next);
      return { committed: true, snapshot: makeSnapshot(this.key, next) };
    }
    on() {}
    off() {}
  }
  return {
    auth() {
      return { currentUser: authUser };
    },
    database() {
      return {
        ref(rawPath = '') { return new Ref(rawPath); }
      };
    }
  };
}

function loadSiteLogRuntime(firebaseAdapter, authUser) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    parseFloat,
    firebase: firebaseAdapter,
    window: null,
    document: {
      body: { appendChild() {} },
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement() {
        return {
          textContent: '',
          innerHTML: '',
          style: {},
          classList: { add() {}, remove() {}, toggle() {} },
          appendChild() {},
          remove() {}
        };
      }
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    navigator: {},
    Blob: function Blob() {},
    URL: { createObjectURL() { return ''; }, revokeObjectURL() {} }
  };
  sandbox.window = sandbox;
  sandbox.window._currentUser = authUser;
  sandbox.window._currentPid = null;
  sandbox.requireEdit = () => true;
  sandbox.canEditProject = () => true;
  sandbox.canWriteFieldLog = () => true;

  const context = vm.createContext(sandbox);
  const root = path.resolve(__dirname, '..');
  vm.runInContext(fs.readFileSync(path.join(root, 'utils.js'), 'utf8'), context, { filename: 'utils.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'sitelog.js'), 'utf8'), context, { filename: 'sitelog.js' });
  return context;
}

async function main() {
  let activeStep = 'sign-in';
  let projectId = '';
  const auth = await signIn();
  const rest = makeRestClient(auth.idToken);
  const profile = await rest.get(`users/${auth.localId}`);
  const role = String((profile && profile.role) || '').toLowerCase();
  if (!['boss', 'owner', 'admin'].includes(role)) {
    throw new Error(`QA requires Boss/Admin auth. Signed in role: ${role || 'missing'}`);
  }

  const user = {
    uid: auth.localId,
    email: EMAIL,
    role,
    name: (profile && profile.name) || EMAIL,
    displayName: (profile && profile.name) || EMAIL
  };
  const firebaseAdapter = makeFirebaseAdapter(rest, user);
  const runtime = loadSiteLogRuntime(firebaseAdapter, user);
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  activeStep = 'create QA project';
  const projectRef = firebaseAdapter.database().ref('projects').push();
  projectId = projectRef.key;
  const projectName = `QA_RC1_SiteLogs_v76_${now}`;
  await projectRef.set({
    name: projectName,
    status: 'active',
    createdAt: now,
    createdDate: new Date().toLocaleDateString('en-PH'),
    laborBudget: 10000,
    materialBudget: 10000,
    qaRun: {
      module: 'sitelogs_v1',
      version: 'v76',
      createdAt: now,
      createdBy: auth.localId
    }
  });
  runtime.window._currentPid = projectId;

  try {
    activeStep = 'create structured site log';
    const log = await runtime.createSiteLog(projectId, {
      date: today,
      time: '08:30 AM',
      notes: 'QA site notes',
      weather: { summary: 'Sunny 32C' },
      workAccomplished: 'Installed formworks',
      manpowerNotes: 'Carpenter - Foreman A - 5 workers',
      equipmentNotes: 'Mixer - 1 unit',
      visitorNotes: 'Owner representative inspection',
      issueNotes: 'Pending delivery of tie wire',
      delayNotes: 'Short rain delay',
      safetyNotes: 'Toolbox meeting completed',
      safetyIncidents: 'No lost time incident',
      photoUrls: 'https://example.com/site-photo.jpg',
      gps: { latitude: 14.5995, longitude: 120.9842, accuracy: 12, capturedAt: now },
      location: '14.5995,120.9842'
    });
    assertTruthy(log.id, 'created log id');
    assertEqual(log.status, 'posted', 'created log status');
    assertTruthy(log.media && Object.keys(log.media).length === 1, 'media metadata saved');

    activeStep = 'list active logs';
    const activeLogs = await runtime.listSiteLogs(projectId);
    assertEqual(activeLogs.length, 1, 'active log count');
    assertEqual(activeLogs[0].workAccomplished, 'Installed formworks', 'structured work reload');
    assertTruthy(activeLogs[0].gps && activeLogs[0].gps.latitude, 'GPS reload');
    assertTruthy(Object.keys(activeLogs[0].issues || {}).length === 1, 'issue reload');
    assertTruthy(Object.keys(activeLogs[0].delays || {}).length === 1, 'delay reload');

    activeStep = 'revise site log';
    await runtime.updateSiteLog(projectId, log.id, {
      notes: 'QA site notes revised',
      workAccomplished: 'Installed formworks and layout strings'
    });
    const revisedSnap = await rest.get(`projects/${projectId}/siteLogs/${log.id}`);
    assertEqual(revisedSnap.status, 'revised', 'revised status');
    assertTruthy(revisedSnap.statusHistory && Object.keys(revisedSnap.statusHistory).length >= 2, 'revision status history');

    activeStep = 'void site log';
    await runtime.voidSiteLog(projectId, log.id, 'QA void test');
    const afterVoidActive = await runtime.listSiteLogs(projectId);
    assertEqual(afterVoidActive.length, 0, 'active list hides voided logs');
    const withVoided = await runtime.listSiteLogs(projectId, { includeVoided: true });
    assertEqual(withVoided.length, 1, 'includeVoided returns history');
    assertEqual(withVoided[0].status, 'voided', 'voided history status');
    assertEqual(withVoided[0].voidReason, 'QA void test', 'void reason preserved');

    activeStep = 'verify rollups/events/notifications';
    const rollup = await runtime.rebuildSiteLogRollups(projectId);
    assertEqual(rollup.totalLogs, 0, 'active rollup excludes voided');
    assertEqual(rollup.voidedLogs, 1, 'voided rollup count');
    const events = await rest.get(`projects/${projectId}/siteLogEvents`);
    const eventTypes = Object.values(events || {}).map(e => e.type).sort();
    assertTruthy(eventTypes.includes('posted'), 'posted event exists');
    assertTruthy(eventTypes.includes('revised'), 'revised event exists');
    assertTruthy(eventTypes.includes('voided'), 'voided event exists');
    const notifications = await rest.get(`projects/${projectId}/notificationEvents`);
    const notificationTypes = Object.values(notifications || {}).map(e => e.type);
    assertTruthy(notificationTypes.includes('site_log_submitted'), 'submitted notification event exists');
    assertTruthy(notificationTypes.includes('site_log_revised'), 'revised notification event exists');
    assertTruthy(notificationTypes.includes('site_log_voided'), 'voided notification event exists');

    activeStep = 'archive QA project';
    await rest.update(`projects/${projectId}`, {
      status: 'archived',
      archivedAt: Date.now(),
      previousStatus: 'active',
      qaRunResult: 'PASS',
      qaCompletedAt: Date.now()
    });

    console.log(JSON.stringify({
      result: 'PASS',
      projectId,
      projectName,
      logId: log.id,
      rollup,
      eventTypes,
      notificationTypes
    }, null, 2));
  } catch (e) {
    if (projectId) {
      await rest.update(`projects/${projectId}`, {
        status: 'archived',
        archivedAt: Date.now(),
        previousStatus: 'active',
        qaRunResult: 'FAILED',
        qaFailedAt: Date.now(),
        qaFailedStep: activeStep,
        qaError: e.message
      }).catch(() => {});
    }
    e.message = `${activeStep}: ${e.message}`;
    throw e;
  }
}

main().catch(e => {
  console.error(e.stack || e.message || e);
  process.exit(1);
});
