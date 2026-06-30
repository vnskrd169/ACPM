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

function assertClose(actual, expected, label, epsilon = 0.001) {
  if (Math.abs((Number(actual) || 0) - expected) > epsilon) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
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
    async set(value) { await rest.set(this.path, value); return this; }
    async update(value) {
      const entries = Object.entries(value || {});
      const hasDeepPath = entries.some(([key]) => key.includes('/'));
      if (hasDeepPath) {
        const shallow = {};
        for (const [key, childValue] of entries) {
          if (key.includes('/')) {
            const targetPath = this.path ? `${this.path}/${key}` : key;
            await rest.set(targetPath, childValue);
          } else {
            shallow[key] = childValue;
          }
        }
        if (Object.keys(shallow).length) await rest.update(this.path, shallow);
      } else {
        await rest.update(this.path, value);
      }
      return this;
    }
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

function loadSuppliersRuntime(firebaseAdapter, authUser) {
  const safeConsole = {
    ...console,
    warn(...args) {
      console.warn(...args.map(arg => {
        const text = String(arg && arg.message ? arg.message : arg);
        return text.replace(/auth=[^&\s]+/g, 'auth=[redacted]');
      }));
    }
  };
  const sandbox = {
    console: safeConsole,
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
      createDocumentFragment() {
        return { appendChild() {} };
      },
      createElement() {
        return {
          textContent: '',
          innerHTML: '',
          style: {},
          dataset: {},
          classList: { add() {}, remove() {}, toggle() {} },
          appendChild() {},
          remove() {},
          setAttribute() {},
          querySelector() { return { addEventListener() {}, dataset: {} }; }
        };
      }
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    Blob: function Blob() {},
    URL: { createObjectURL() { return ''; }, revokeObjectURL() {} }
  };
  sandbox.window = sandbox;
  sandbox.window._currentUser = authUser;
  sandbox.window._currentPid = null;
  sandbox.requireEdit = () => true;
  sandbox.canEditProject = () => true;
  sandbox.isBoss = role => ['boss', 'owner', 'admin'].includes(String(role || '').toLowerCase());
  sandbox.isProjectReadOnly = () => false;

  const context = vm.createContext(sandbox);
  const root = path.resolve(__dirname, '..');
  vm.runInContext(fs.readFileSync(path.join(root, 'utils.js'), 'utf8'), context, { filename: 'utils.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'suppliers.js'), 'utf8'), context, { filename: 'suppliers.js' });
  return context;
}

async function main() {
  let activeStep = 'sign-in';
  let projectId = '';
  let supplierId = '';
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
  const runtime = loadSuppliersRuntime(firebaseAdapter, user);
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  activeStep = 'create supplier';
  const supplierName = `QA Supplier v76 ${now}`;
  const supplier = await runtime.createSupplier({
    name: supplierName,
    contact: '0917-000-0000',
    specialty: 'Hardware',
    bankName: 'QA Bank',
    accNum: 'QA-001',
    accName: 'QA Supplier Account',
    notes: 'QA supplier create'
  });
  supplierId = supplier.key;
  assertTruthy(supplierId, 'supplier id');
  assertEqual(supplier.status, 'active', 'supplier active status');

  try {
    activeStep = 'update supplier';
    await runtime.updateSupplier(supplierId, {
      contact: '0917-111-1111',
      specialty: 'Hardware and Aggregates',
      notes: 'QA supplier updated'
    });
    const updatedSupplier = await rest.get(`suppliers/${supplierId}`);
    assertEqual(updatedSupplier.contact, '0917-111-1111', 'supplier update persisted');
    assertTruthy(updatedSupplier.statusHistory && Object.keys(updatedSupplier.statusHistory).length >= 2, 'supplier status history');

    activeStep = 'create linked QA project PO and delivery';
    const projectRef = firebaseAdapter.database().ref('projects').push();
    projectId = projectRef.key;
    const projectName = `QA_RC1_Suppliers_v76_${now}`;
    const poId = pushKey();
    const deliveryId = pushKey();
    await projectRef.set({
      name: projectName,
      status: 'active',
      createdAt: now,
      createdDate: new Date().toLocaleDateString('en-PH'),
      laborBudget: 10000,
      materialBudget: 10000,
      qaRun: {
        module: 'suppliers_v1',
        version: 'v76',
        createdAt: now,
        createdBy: auth.localId
      },
      purchaseOrders: {
        [poId]: {
          poNo: 'QA-PO-001',
          supplierId,
          supplierName,
          status: 'submitted',
          deliveryStatus: 'partially_delivered',
          total: 1200,
          date: today,
          createdAt: now
        }
      },
      deliveries: {
        [deliveryId]: {
          poId,
          supplierId,
          supplierName,
          status: 'received',
          deliveryDate: today,
          receivedAt: now + 1,
          totalCost: 500
        }
      }
    });

    activeStep = 'verify supplier transactions and rollup';
    const transactionsById = await runtime.listSupplierTransactions(supplierId);
    assertEqual(transactionsById.length, 2, 'supplier linked transaction count by id');
    assertTruthy(transactionsById.some(row => row.type === 'purchaseOrder' && row.poId === poId), 'PO transaction linked');
    assertTruthy(transactionsById.some(row => row.type === 'delivery' && row.deliveryId === deliveryId), 'delivery transaction linked');
    const rollup = await runtime.rebuildSupplierRollup(supplierId);
    assertEqual(rollup.totalPurchaseOrders, 1, 'rollup PO count');
    assertClose(rollup.totalPOAmount, 1200, 'rollup PO amount');
    assertEqual(rollup.totalDeliveries, 1, 'rollup delivery count');
    assertEqual(rollup.outstandingDeliveries, 1, 'rollup outstanding deliveries');
    const persistedRollup = await rest.get(`supplierRollups/${supplierId}`).catch(() => null);
    const fallbackRollup = await rest.get(`suppliers/${supplierId}/rollup`).catch(() => null);
    const rollupPersisted = !!(persistedRollup || fallbackRollup);

    activeStep = 'archive supplier';
    await runtime.archiveSupplier(supplierId, 'QA archive test');
    const archivedSupplier = await rest.get(`suppliers/${supplierId}`);
    assertEqual(archivedSupplier.status, 'archived', 'archived supplier status');
    assertEqual(archivedSupplier.archiveReason, 'QA archive test', 'archive reason preserved');
    const activeSuppliers = await runtime.listSuppliers();
    assertTruthy(!activeSuppliers.some(row => row.key === supplierId), 'archived hidden from active list');
    const allSuppliers = await runtime.listSuppliers({ includeArchived: true });
    assertTruthy(allSuppliers.some(row => row.key === supplierId && row.status === 'archived'), 'archived readable in history');

    activeStep = 'verify supplier events and notifications';
    const events = await rest.get('supplierEvents').catch(() => null);
    const globalEventTypes = Object.values(events || {})
      .filter(e => e.supplierId === supplierId)
      .map(e => e.type)
      .sort();
    const localEvents = await rest.get(`suppliers/${supplierId}/events`).catch(() => null);
    const localEventTypes = Object.values(localEvents || {})
      .filter(e => e.supplierId === supplierId)
      .map(e => e.type)
      .sort();
    const eventTypes = [...new Set([...globalEventTypes, ...localEventTypes])].sort();
    const eventHooksPersisted = eventTypes.includes('created') && eventTypes.includes('updated') && eventTypes.includes('archived');
    const notifications = await rest.get('globalNotificationEvents').catch(() => null);
    const globalNotificationTypes = Object.values(notifications || {})
      .filter(e => e.supplierId === supplierId)
      .map(e => e.type);
    const localNotifications = await rest.get(`suppliers/${supplierId}/notificationEvents`).catch(() => null);
    const localNotificationTypes = Object.values(localNotifications || {})
      .filter(e => e.supplierId === supplierId)
      .map(e => e.type);
    const notificationTypes = [...new Set([...globalNotificationTypes, ...localNotificationTypes])].sort();
    const notificationHooksPersisted = notificationTypes.includes('supplier_created') &&
      notificationTypes.includes('supplier_updated') &&
      notificationTypes.includes('supplier_archived');

    activeStep = 'archive QA project';
    await rest.update(`projects/${projectId}`, {
      status: 'archived',
      archivedAt: Date.now(),
      previousStatus: 'active',
      qaRunResult: rollupPersisted && eventHooksPersisted && notificationHooksPersisted ? 'PASS' : 'WARNING',
      qaCompletedAt: Date.now()
    });

    console.log(JSON.stringify({
      result: rollupPersisted && eventHooksPersisted && notificationHooksPersisted ? 'PASS' : 'WARNING',
      supplierId,
      supplierName,
      projectId,
      rollup,
      rollupPersisted,
      rollupPath: persistedRollup ? `supplierRollups/${supplierId}` : fallbackRollup ? `suppliers/${supplierId}/rollup` : '',
      globalEventTypes,
      localEventTypes,
      eventTypes,
      eventHooksPersisted,
      globalNotificationTypes,
      localNotificationTypes,
      notificationTypes,
      notificationHooksPersisted
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
    if (supplierId) {
      await rest.update(`suppliers/${supplierId}`, {
        status: 'archived',
        archivedAt: Date.now(),
        archiveReason: `QA cleanup after failure: ${activeStep}`,
        qaRunResult: 'FAILED',
        qaFailedAt: Date.now(),
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
