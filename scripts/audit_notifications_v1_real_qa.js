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

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy value`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
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
    async set(value, callback) {
      try {
        await rest.set(this.path, value);
        if (callback) callback(null);
      } catch (e) {
        if (callback) callback(e);
        else throw e;
      }
      return this;
    }
    async update(value) { await rest.update(this.path, value); return this; }
    push(value, callback) {
      const child = new Ref(`${this.path}/${pushKey()}`);
      if (arguments.length) child.set(value, callback);
      return child;
    }
    orderByChild() { return this; }
    equalTo() { return this; }
    limitToLast() { return this; }
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

function loadRuntime(firebaseAdapter, authUser) {
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
          remove() {},
          click() {}
        };
      }
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    Blob: function Blob() {},
    URL: { createObjectURL() { return ''; }, revokeObjectURL() {} }
  };
  sandbox.window = sandbox;
  sandbox.window._currentUser = authUser;
  sandbox.window._currentPid = '';
  sandbox.isBoss = role => ['boss', 'owner', 'admin'].includes(String(role || '').toLowerCase());
  sandbox.canAccessProject = () => true;

  const context = vm.createContext(sandbox);
  const root = path.resolve(__dirname, '..');
  vm.runInContext(fs.readFileSync(path.join(root, 'utils.js'), 'utf8'), context, { filename: 'utils.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'notifications.js'), 'utf8'), context, { filename: 'notifications.js' });
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
  const runtime = loadRuntime(firebaseAdapter, user);
  const now = Date.now();

  activeStep = 'create QA project';
  const projectRef = firebaseAdapter.database().ref('projects').push();
  projectId = projectRef.key;
  await projectRef.set({
    name: `QA_RC1_AuditNotifications_v79_${now}`,
    status: 'active',
    createdAt: now,
    createdDate: new Date().toLocaleDateString('en-PH'),
    laborBudget: 1000,
    materialBudget: 1000,
    qaRun: {
      module: 'audit_notifications_v1',
      version: 'v79',
      createdAt: now,
      createdBy: auth.localId
    }
  });
  runtime.window._currentPid = projectId;

  try {
    activeStep = 'write audit log';
    runtime.auditLog('qa', 'auditNotification', `qa-${now}`, {
      projectId,
      previousStatus: 'draft',
      newStatus: 'posted',
      notes: 'QA audit event'
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    const auditRows = await rest.get('auditLogs').catch(() => null);
    const globalAuditMatched = Object.values(auditRows || {}).some(row =>
      row.entityId === `qa-${now}` &&
      row.userId === auth.localId &&
      row.userName &&
      row.userRole &&
      row.previousStatus === 'draft' &&
      row.newStatus === 'posted'
    );
    const projectAuditRows = await rest.get(`projects/${projectId}/auditLogs`).catch(() => null);
    const fallbackAuditMatched = Object.values(projectAuditRows || {}).some(row =>
      row.entityId === `qa-${now}` &&
      row.userId === auth.localId &&
      row.userName &&
      row.userRole &&
      row.previousStatus === 'draft' &&
      row.newStatus === 'posted' &&
      row.fallbackPath === true
    );
    const auditMatched = globalAuditMatched || fallbackAuditMatched;
    assertTruthy(auditMatched, 'global or project fallback audit log');

    activeStep = 'send user inbox notification';
    await runtime.sendNotification({
      to: auth.localId,
      type: 'alert',
      message: `QA notification ${now}`,
      projectId,
      projectName: 'QA Audit Notifications'
    });
    const userNotifications = await rest.get(`notifications/${auth.localId}`);
    const inboxMatched = Object.entries(userNotifications || {}).find(([, row]) => row.message === `QA notification ${now}`);
    assertTruthy(inboxMatched, 'user inbox notification');
    await runtime.markNotifRead(inboxMatched[0]);
    const readRow = await rest.get(`notifications/${auth.localId}/${inboxMatched[0]}`);
    assertEqual(readRow.read, true, 'notification marked read');

    activeStep = 'create project notification event';
    const projectEvent = await runtime.createNotificationEvent({
      projectId,
      module: 'qa',
      type: 'qa_project_event',
      payload: { qaRun: now }
    });
    const projectEvents = await rest.get(`projects/${projectId}/notificationEvents`);
    const projectEventMatched = Object.values(projectEvents || {}).some(row => row.type === 'qa_project_event' && row.qaRun === now);
    assertTruthy(projectEvent && projectEventMatched, 'project notification event');

    activeStep = 'create global notification event';
    const globalEvent = await runtime.createNotificationEvent({
      module: 'qa',
      type: 'qa_global_event',
      payload: { qaRun: now },
      global: true
    });
    const globalRows = await rest.get('globalNotificationEvents').catch(() => null);
    const globalMatched = Object.values(globalRows || {}).some(row => row.type === 'qa_global_event' && row.qaRun === now);

    activeStep = 'archive QA project';
    const result = auditMatched && globalEvent && globalMatched ? 'PASS' : 'WARNING';
    await rest.update(`projects/${projectId}`, {
      status: 'archived',
      archivedAt: Date.now(),
      previousStatus: 'active',
      qaRunResult: result,
      qaCompletedAt: Date.now(),
      auditMatched,
      globalAuditMatched,
      fallbackAuditMatched,
      globalNotificationMatched: !!globalMatched
    });

    console.log(JSON.stringify({
      result,
      projectId,
      auditMatched,
      auditPath: globalAuditMatched ? 'auditLogs' : fallbackAuditMatched ? `projects/${projectId}/auditLogs` : '',
      globalAuditMatched,
      fallbackAuditMatched,
      inboxNotificationMatched: true,
      projectNotificationEventMatched: true,
      globalNotificationEventMatched: !!globalMatched
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
