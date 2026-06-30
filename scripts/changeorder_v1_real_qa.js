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

function assertClose(actual, expected, label, epsilon = 0.001) {
  if (Math.abs((Number(actual) || 0) - expected) > epsilon) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
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
          remove() {}
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

  const context = vm.createContext(sandbox);
  const root = path.resolve(__dirname, '..');
  vm.runInContext(fs.readFileSync(path.join(root, 'utils.js'), 'utf8'), context, { filename: 'utils.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'billing.js'), 'utf8'), context, { filename: 'billing.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'changeorders.js'), 'utf8'), context, { filename: 'changeorders.js' });
  return context;
}

async function main() {
  let activeStep = 'sign-in';
  let auth = null;
  let rest = null;
  let projectId = '';
  auth = await signIn();
  rest = makeRestClient(auth.idToken);
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
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  activeStep = 'create QA project';
  const projectRef = firebaseAdapter.database().ref('projects').push();
  projectId = projectRef.key;
  const projectName = `QA_RC1_ChangeOrders_v75_${now}`;

  await projectRef.set({
    name: projectName,
    status: 'active',
    createdAt: now,
    createdDate: new Date().toLocaleDateString('en-PH'),
    laborBudget: 100000,
    materialBudget: 150000,
    laborSpent: 3000,
    materialSpent: 4000,
    laborBudgetDelta: 0,
    materialBudgetDelta: 0,
    qaRun: {
      module: 'changeorders_v1',
      version: 'v75',
      createdAt: now,
      createdBy: auth.localId
    }
  });
  runtime.window._currentPid = projectId;

  try {
    activeStep = 'save contract';
    await runtime.saveContract(projectId, {
      amount: 500000,
      client: 'QA Change Order Client',
      downPct: 0,
      retention: 0,
      startDate: today,
      endDate: today
    });

    activeStep = 'create and review approved CO';
    const approvedCo = await runtime.createChangeOrder(projectId, {
      description: 'QA approved additional scope',
      requestedBy: 'QA Client',
      requestedByRole: 'Owner',
      date: today,
      laborImpact: 12000,
      materialsImpact: 8000,
      otherImpact: 500,
      notes: 'QA approval path'
    });
    await runtime.reviewChangeOrder(projectId, approvedCo.id, 'Reviewed for QA');
    await runtime.approveChangeOrder(projectId, approvedCo.id);

    activeStep = 'verify approved CO financial impact';
    let project = await rest.get(`projects/${projectId}`);
    assertClose(project.laborBudgetDelta, 12000, 'Approved CO laborBudgetDelta');
    assertClose(project.materialBudgetDelta, 8000, 'Approved CO materialBudgetDelta');
    assertClose(project.changeOrderRollups.approvedContractImpact, 20500, 'Approved CO contract impact');
    assertClose(project.billingRollups.approvedChangeOrders, 20500, 'Billing rollup approved change orders');
    assertClose(project.billingRollups.adjustedContractAmount, 520500, 'Adjusted contract amount after approved CO');

    activeStep = 'reject separate CO';
    const rejectedCo = await runtime.createChangeOrder(projectId, {
      description: 'QA rejected scope',
      requestedBy: 'QA Client',
      date: today,
      laborImpact: 3000,
      materialsImpact: 2000,
      notes: 'QA reject path'
    });
    await runtime.rejectChangeOrder(projectId, rejectedCo.id, 'Rejected for QA');
    project = await rest.get(`projects/${projectId}`);
    assertClose(project.changeOrderRollups.rejectedCount, 1, 'Rejected CO count');
    assertClose(project.changeOrderRollups.approvedContractImpact, 20500, 'Rejected CO ignored from approved contract impact');
    assertClose(project.laborBudgetDelta, 12000, 'Rejected CO ignored from labor delta');

    activeStep = 'void approved CO and verify removal from rollups';
    const voidedCo = await runtime.createChangeOrder(projectId, {
      description: 'QA voided approved scope',
      requestedBy: 'QA Client',
      date: today,
      laborImpact: 4000,
      materialsImpact: 1000,
      notes: 'QA void path'
    });
    await runtime.approveChangeOrder(projectId, voidedCo.id);
    await runtime.voidChangeOrder(projectId, voidedCo.id, 'Voided during QA');
    project = await rest.get(`projects/${projectId}`);
    assertEqual(project.changeOrders[voidedCo.id].status, 'voided', 'Voided CO status');
    assertTruthy(project.changeOrders[voidedCo.id].voidedAt, 'Voided CO voidedAt');
    assertClose(project.changeOrderRollups.voidedCount, 1, 'Voided CO count');
    assertClose(project.changeOrderRollups.approvedContractImpact, 20500, 'Voided CO ignored from approved impact');
    assertClose(project.laborBudgetDelta, 12000, 'Voided CO removed from labor delta');
    assertClose(project.materialBudgetDelta, 8000, 'Voided CO removed from material delta');

    activeStep = 'create change order billing and link';
    const changeOrderBilling = await runtime.createBilling(projectId, {
      date: today,
      description: 'QA Change Order Billing',
      amount: 20500,
      type: 'change_order',
      status: 'submitted'
    });
    await runtime.approveBilling(projectId, changeOrderBilling.id);
    await runtime.linkChangeOrderBilling(projectId, approvedCo.id, changeOrderBilling.id);
    project = await rest.get(`projects/${projectId}`);
    assertEqual(project.changeOrders[approvedCo.id].billingId, changeOrderBilling.id, 'CO linked billingId');
    assertEqual(project.changeOrders[approvedCo.id].billingStatus, 'linked', 'CO billingStatus linked');
    assertTruthy(project.billings[changeOrderBilling.id].changeOrderIds[approvedCo.id], 'Billing mirrored changeOrderIds');
    assertClose(project.billingRollups.totalBilled, 20500, 'CO billing total billed');
    assertClose(project.billingRollups.receivable, 20500, 'CO billing receivable before collection');

    activeStep = 'collect change order billing';
    const collection = await runtime.recordCollection(projectId, {
      date: today,
      description: 'QA Change Order Collection',
      amount: 20500,
      billingId: changeOrderBilling.id,
      billingNo: changeOrderBilling.billingNo,
      type: 'collection'
    });
    project = await rest.get(`projects/${projectId}`);
    assertClose(project.billingRollups.totalCollected, 20500, 'CO billing collected revenue');
    assertClose(project.billingRollups.receivable, 0, 'CO billing receivable after collection');
    assertClose(project.billingRollups.estimatedProfit, 13500, 'Revenue vs cost after CO collection');

    activeStep = 'verify history and events';
    const eventRows = Object.values(project.changeOrderEvents || {});
    const notificationRows = Object.values(project.notificationEvents || {});
    assertTruthy(eventRows.find(e => e.changeOrderId === approvedCo.id && e.type === 'approved'), 'Approved event row');
    assertTruthy(eventRows.find(e => e.changeOrderId === rejectedCo.id && e.type === 'rejected'), 'Rejected event row');
    assertTruthy(eventRows.find(e => e.changeOrderId === voidedCo.id && e.type === 'voided'), 'Voided event row');
    assertTruthy(eventRows.find(e => e.changeOrderId === approvedCo.id && e.type === 'billing_linked'), 'Billing linked event row');
    assertTruthy(notificationRows.find(e => e.type === 'change_order_approved'), 'Approved notification event');
    assertTruthy(notificationRows.find(e => e.type === 'change_order_billing_linked'), 'Billing linked notification event');

    activeStep = 'rebuild rollups after simulated refresh';
    await runtime.rebuildChangeOrderRollups(projectId);
    await runtime.syncProjectBudgetDeltasFromChangeOrders(projectId);
    await runtime.rebuildBillingRollups(projectId);
    project = await rest.get(`projects/${projectId}`);
    assertClose(project.changeOrderRollups.approvedContractImpact, 20500, 'Rebuilt approved contract impact');
    assertClose(project.billingRollups.approvedChangeOrders, 20500, 'Rebuilt billing approved CO impact');
    assertClose(project.laborBudgetDelta, 12000, 'Rebuilt laborBudgetDelta');
    assertClose(project.materialBudgetDelta, 8000, 'Rebuilt materialBudgetDelta');

    activeStep = 'archive QA project';
    await rest.update(`projects/${projectId}`, {
      status: 'archived',
      archivedAt: Date.now(),
      archivedBy: auth.localId,
      qaRunCompletedAt: Date.now(),
      qaRunResult: 'PASS'
    });

    console.log(JSON.stringify({
      status: 'PASS',
      projectId,
      projectName,
      archived: true,
      createdByRole: role,
      records: {
        approvedCo: approvedCo.id,
        rejectedCo: rejectedCo.id,
        voidedCo: voidedCo.id,
        changeOrderBilling: changeOrderBilling.id,
        collection: collection.id
      },
      rollup: {
        approvedContractImpact: project.changeOrderRollups.approvedContractImpact,
        approvedLaborImpact: project.changeOrderRollups.approvedLaborImpact,
        approvedMaterialsImpact: project.changeOrderRollups.approvedMaterialsImpact,
        laborBudgetDelta: project.laborBudgetDelta,
        materialBudgetDelta: project.materialBudgetDelta,
        approvedChangeOrders: project.billingRollups.approvedChangeOrders,
        adjustedContractAmount: project.billingRollups.adjustedContractAmount,
        totalBilled: project.billingRollups.totalBilled,
        totalCollected: project.billingRollups.totalCollected,
        receivable: project.billingRollups.receivable,
        estimatedProfit: project.billingRollups.estimatedProfit
      }
    }, null, 2));
  } catch (err) {
    if (rest && projectId) {
      try {
        await rest.update(`projects/${projectId}`, {
          status: 'archived',
          archivedAt: Date.now(),
          archivedBy: auth.localId,
          qaRunCompletedAt: Date.now(),
          qaRunResult: 'FAILED',
          qaRunFailedStep: activeStep,
          qaRunError: err.message
        });
      } catch (cleanupErr) {
        console.error(`QA cleanup failed for ${projectId}: ${cleanupErr.message}`);
      }
    }
    err.step = activeStep;
    err.projectId = projectId;
    throw err;
  }
}

main().catch(err => {
  console.error(JSON.stringify({
    status: 'FAILED',
    step: err.step || '',
    projectId: err.projectId || '',
    error: err.message,
    stack: err.stack
  }, null, 2));
  process.exit(1);
});
