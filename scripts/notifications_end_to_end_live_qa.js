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

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function pushKey() {
  return `qa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function makeFirebaseAdapter(rest) {
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
    on(event, callback, errorCallback) {
      this.once(event).then(callback).catch(errorCallback || (() => {}));
    }
    off() {}
  }
  return {
    database() {
      return { ref(rawPath = '') { return new Ref(rawPath); } };
    }
  };
}

function createElementStore() {
  const elements = {};
  function makeClassList() {
    const values = new Set();
    return {
      add(name) { values.add(name); },
      remove(name) { values.delete(name); },
      toggle(name, force) {
        if (force === undefined ? !values.has(name) : force) values.add(name);
        else values.delete(name);
      },
      contains(name) { return values.has(name); },
      toString() { return Array.from(values).join(' '); }
    };
  }
  function makeEl(id = '') {
    const el = {
      id,
      _text: '',
      innerHTML: '',
      style: {},
      classList: makeClassList(),
      set textContent(value) {
        this._text = String(value ?? '');
        this.innerHTML = escapeHtml(this._text);
      },
      get textContent() { return this._text; },
      appendChild() {},
      remove() {}
    };
    return el;
  }
  ['notifBadge', 'notificationFeed'].forEach(id => {
    elements[id] = makeEl(id);
    if (id === 'notifBadge') elements[id].classList.add('hidden');
  });
  return { elements, makeEl };
}

function loadNotificationRuntime(rest, user, canReadProject) {
  const { elements, makeEl } = createElementStore();
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
    firebase: makeFirebaseAdapter(rest),
    window: null,
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement() { return makeEl(); },
      body: { appendChild() {} }
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    Blob: function Blob() {},
    URL: { createObjectURL() { return ''; }, revokeObjectURL() {} }
  };
  sandbox.window = sandbox;
  sandbox.window._currentUser = user;
  sandbox.window._currentPid = '';
  sandbox.window.location = { href: '' };
  sandbox.normalizeRole = role => String(role || '').trim().toLowerCase();
  sandbox.isBoss = role => ['boss', 'owner', 'admin'].includes(String(role || '').toLowerCase());
  sandbox.canReadFullProject = canReadProject;
  sandbox.canAccessProject = canReadProject;

  const context = vm.createContext(sandbox);
  const root = path.resolve(__dirname, '..');
  vm.runInContext(fs.readFileSync(path.join(root, 'utils.js'), 'utf8'), context, { filename: 'utils.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'notifications.js'), 'utf8'), context, { filename: 'notifications.js' });
  return { context, elements };
}

async function waitForAsyncListeners() {
  await new Promise(resolve => setTimeout(resolve, 1200));
}

async function main() {
  const auth = await signIn();
  const rest = makeRestClient(auth.idToken);
  const profile = await rest.get(`users/${auth.localId}`);
  const role = String((profile && profile.role) || '').toLowerCase();
  assert(['boss', 'owner', 'admin'].includes(role), `QA requires Boss/Admin auth. Signed in role: ${role || 'missing'}`);

  const now = Date.now();
  const projectId = `notif_smoke_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const eventId = pushKey();
  const eventType = `system_notice_${now}`;
  const user = {
    uid: auth.localId,
    email: EMAIL,
    role,
    name: (profile && profile.name) || EMAIL,
    projects: [],
    bossOf: []
  };

  await rest.set(`projects/${projectId}`, {
    name: `Notification Smoke ${now}`,
    status: 'active',
    createdAt: now,
    createdDate: new Date(now).toLocaleDateString('en-PH'),
    laborBudget: 1,
    materialBudget: 1,
    qaRun: {
      module: 'notifications_end_to_end',
      createdAt: now,
      createdBy: auth.localId
    },
    notificationEvents: {
      [eventId]: {
        module: 'system',
        type: eventType,
        message: `Notification smoke event ${now}`,
        status: 'pending',
        consumed: false,
        projectId,
        createdAt: now,
        createdBy: auth.localId,
        createdByName: user.name
      }
    }
  });

  const createdEvent = await rest.get(`projects/${projectId}/notificationEvents/${eventId}`);
  assert(createdEvent && createdEvent.type === eventType, 'safe QA event exists in Firebase');

  const bossRuntime = loadNotificationRuntime(rest, user, pid => pid === projectId);
  bossRuntime.context.window._currentPid = projectId;
  bossRuntime.context.initNotifications();
  await waitForAsyncListeners();
  const unreadHtml = bossRuntime.elements.notificationFeed.innerHTML;
  assert(unreadHtml.includes(eventType.replace(/_/g, ' ')) || unreadHtml.includes(`Notification smoke event ${now}`), 'listener rendered QA event');
  assert(unreadHtml.includes('notif-unread'), 'QA event rendered unread');
  assert(!bossRuntime.elements.notifBadge.classList.contains('hidden'), 'badge became visible');

  const readKey = `projectEvent:${projectId}:${eventId}`;
  await bossRuntime.context.openNotification(readKey);
  assert(bossRuntime.context.window.location.href.includes(`projectId=${encodeURIComponent(projectId)}`), 'clicking notification routes to project workspace');
  const readBy = await rest.get(`projects/${projectId}/notificationEvents/${eventId}/readBy/${auth.localId}`);
  assert(typeof readBy === 'number', 'mark read wrote readBy timestamp');

  const refreshRuntime = loadNotificationRuntime(rest, user, pid => pid === projectId);
  refreshRuntime.context.window._currentPid = projectId;
  refreshRuntime.context.initNotifications();
  await waitForAsyncListeners();
  const readHtml = refreshRuntime.elements.notificationFeed.innerHTML;
  assert(readHtml.includes('notif-read'), 'refresh preserved read state');

  const deniedUser = { uid: 'qa_denied_user', role: 'apm', name: 'QA Denied', projects: [], bossOf: [] };
  const deniedRuntime = loadNotificationRuntime(rest, deniedUser, () => false);
  deniedRuntime.context.window._currentPid = '';
  deniedRuntime.context.initNotifications();
  await waitForAsyncListeners();
  assert(!deniedRuntime.elements.notificationFeed.innerHTML.includes(`Notification smoke event ${now}`), 'unassigned role did not render QA event in client filter');

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
    eventId,
    eventPath: `projects/${projectId}/notificationEvents/${eventId}`,
    readPath: `projects/${projectId}/notificationEvents/${eventId}/readBy/${auth.localId}`,
    badgeVisible: true,
    renderedUnread: true,
    clickOpenedProjectWorkspace: true,
    markReadPersisted: true,
    refreshPreservedReadState: true,
    unassignedClientFilter: 'PASS',
    qaProjectArchived: true
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
});
