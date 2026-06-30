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
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed ${res.status}: ${text}`);
  }
  return body;
}

async function signIn() {
  return httpJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      returnSecureToken: true
    })
  });
}

function pushKey() {
  return `qa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function encodeDbPath(rawPath) {
  return String(rawPath || '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function makeRestClient(idToken) {
  function url(rawPath) {
    const encoded = encodeDbPath(rawPath);
    return `${DB_URL}/${encoded}.json?auth=${encodeURIComponent(idToken)}`;
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
    exists() {
      return value !== null && value !== undefined;
    },
    val() {
      return value === undefined ? null : value;
    },
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

    child(childPath) {
      return new Ref(`${this.path}/${childPath}`);
    }

    async once(event) {
      if (event !== 'value') throw new Error(`Unsupported event: ${event}`);
      return makeSnapshot(this.key, await rest.get(this.path));
    }

    async set(value) {
      await rest.set(this.path, value);
      return this;
    }

    async update(value) {
      await rest.update(this.path, value);
      return this;
    }

    push(value) {
      const child = new Ref(`${this.path}/${pushKey()}`);
      if (arguments.length) {
        child.set(value);
      }
      return child;
    }

    async transaction(updateFn) {
      const current = await rest.get(this.path);
      const next = updateFn(current);
      await rest.set(this.path, next);
      return { committed: true, snapshot: makeSnapshot(this.key, next) };
    }
  }

  return {
    database() {
      return {
        ref(rawPath = '') {
          return new Ref(rawPath);
        }
      };
    }
  };
}

function loadBillingRuntime(firebaseAdapter, authUser) {
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
    localStorage: {
      getItem() { return null; },
      setItem() {}
    },
    Blob: function Blob() {},
    URL: {
      createObjectURL() { return ''; },
      revokeObjectURL() {}
    }
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
  return context;
}

async function main() {
  let activeStep = 'sign-in';
  let rest = null;
  let auth = null;
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
    name: (profile && profile.name) || EMAIL
  };
  const runtime = loadBillingRuntime(makeFirebaseAdapter(rest), user);
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  activeStep = 'create QA project';
  const projectRef = makeFirebaseAdapter(rest).database().ref('projects').push();
  projectId = projectRef.key;
  const projectName = `QA_RC1_Billing_Phase2_v74_${now}`;

  await projectRef.set({
    name: projectName,
    status: 'active',
    createdAt: now,
    createdDate: new Date().toLocaleDateString('en-PH'),
    laborBudget: 100000,
    materialBudget: 100000,
    laborSpent: 1500,
    materialSpent: 2000,
    laborBudgetDelta: 0,
    materialBudgetDelta: 0,
    materialCommitted: 0,
    qaRun: {
      module: 'billing_phase2',
      version: 'v74',
      createdAt: now,
      createdBy: auth.localId
    }
  });

  runtime.window._currentPid = projectId;

  try {
  activeStep = 'save contract';
  await runtime.saveContract(projectId, {
    amount: 100000,
    client: 'QA Client',
    downPct: 10,
    retention: 10,
    startDate: today,
    endDate: today
  });

  activeStep = 'create billing A';
  const billingA = await runtime.createBilling(projectId, {
    date: today,
    description: 'QA Progress Billing A',
    amount: 10000,
    type: 'progress',
    status: 'submitted',
    retentionPct: 10
  });
  activeStep = 'approve billing A';
  await runtime.approveBilling(projectId, billingA.id);

  activeStep = 'check billing A approval receivable';
  let receivableA = await runtime.calculateBillingReceivable(projectId, billingA.id);
  assertClose(receivableA.currentCollectible, 9000, 'Billing A collectible after approval');
  assertClose(receivableA.retentionReceivable, 1000, 'Billing A retention receivable after approval');

  activeStep = 'record collection A partial';
  const collection1 = await runtime.recordCollection(projectId, {
    date: today,
    description: 'QA Collection A partial',
    amount: 3000,
    billingId: billingA.id,
    billingNo: billingA.billingNo,
    type: 'collection'
  });
  activeStep = 'check billing A partial receivable';
  receivableA = await runtime.calculateBillingReceivable(projectId, billingA.id);
  assertClose(receivableA.currentReceivable, 6000, 'Billing A current receivable after partial collection');
  assertClose(receivableA.totalReceivable, 7000, 'Billing A total receivable after partial collection');

  activeStep = 'record collection A current balance';
  await runtime.recordCollection(projectId, {
    date: today,
    description: 'QA Collection A current balance',
    amount: 6000,
    billingId: billingA.id,
    billingNo: billingA.billingNo,
    type: 'collection'
  });
  activeStep = 'check billing A current balance receivable';
  receivableA = await runtime.calculateBillingReceivable(projectId, billingA.id);
  assertClose(receivableA.currentReceivable, 0, 'Billing A current receivable after current-balance collection');
  assertClose(receivableA.retentionReceivable, 1000, 'Billing A retention still outstanding');

  let overpayBlocked = false;
  activeStep = 'verify overpayment prevention';
  try {
    await runtime.recordCollection(projectId, {
      date: today,
      description: 'QA Overpayment should fail',
      amount: 1,
      billingId: billingA.id,
      billingNo: billingA.billingNo,
      type: 'collection'
    });
  } catch (e) {
    overpayBlocked = /exceeds billing receivable/i.test(e.message);
  }
  assertTruthy(overpayBlocked, 'Overpayment prevention');

  activeStep = 'record retention collection';
  await runtime.recordCollection(projectId, {
    date: today,
    description: 'QA Retention collection',
    amount: 1000,
    billingId: billingA.id,
    billingNo: billingA.billingNo,
    retentionReleased: 1000,
    referenceNo: 'QA-RETENTION',
    type: 'retention_release_collection',
    allocateToOldest: false
  });
  activeStep = 'check billing A settled';
  receivableA = await runtime.calculateBillingReceivable(projectId, billingA.id);
  assertClose(receivableA.totalReceivable, 0, 'Billing A fully settled after retention collection');

  activeStep = 'create downpayment billing';
  const downpayment = await runtime.createDownpaymentBilling(projectId, {
    date: today,
    description: 'QA Downpayment',
    amount: 5000,
    status: 'submitted'
  });
  activeStep = 'approve downpayment billing';
  await runtime.approveBilling(projectId, downpayment.id);

  activeStep = 'create mobilization billing';
  const mobilization = await runtime.createMobilizationBilling(projectId, {
    date: today,
    description: 'QA Mobilization',
    amount: 4000,
    status: 'submitted'
  });
  activeStep = 'approve mobilization billing';
  await runtime.approveBilling(projectId, mobilization.id);

  activeStep = 'create billing B';
  const billingB = await runtime.createBilling(projectId, {
    date: today,
    description: 'QA Progress Billing B',
    amount: 5000,
    type: 'progress',
    status: 'submitted'
  });
  activeStep = 'approve billing B';
  await runtime.approveBilling(projectId, billingB.id);

  activeStep = 'record auto allocated collection';
  const autoCollection = await runtime.recordCollection(projectId, {
    date: today,
    description: 'QA Auto allocated collection',
    amount: 2000,
    type: 'collection'
  });
  activeStep = 'verify auto allocation';
  const autoCollectionSnap = await makeFirebaseAdapter(rest).database().ref(`projects/${projectId}/collections/${autoCollection.id}`).once('value');
  assertClose(autoCollectionSnap.val().unappliedAmount, 0, 'Auto collection unapplied amount');
  const downpaymentReceivable = await runtime.calculateBillingReceivable(projectId, downpayment.id);
  assertClose(downpaymentReceivable.currentReceivable, 3000, 'Downpayment receivable after auto collection');

  activeStep = 'create pending deduction';
  const pendingDeduction = await runtime.createBillingDeduction(projectId, billingB.id, {
    amount: 500,
    reason: 'QA pending deduction',
    status: 'pending'
  });
  activeStep = 'verify pending deduction ignored';
  let billingBReceivable = await runtime.calculateBillingReceivable(projectId, billingB.id);
  assertClose(billingBReceivable.currentReceivable, 5000, 'Pending deduction ignored');

  activeStep = 'approve deduction';
  await runtime.approveBillingDeduction(projectId, billingB.id, pendingDeduction.id);
  activeStep = 'verify approved deduction';
  billingBReceivable = await runtime.calculateBillingReceivable(projectId, billingB.id);
  assertClose(billingBReceivable.currentReceivable, 4500, 'Approved deduction reduces receivable');

  activeStep = 'void approved deduction';
  await runtime.voidBillingDeduction(projectId, billingB.id, pendingDeduction.id, 'QA void approved deduction');
  billingBReceivable = await runtime.calculateBillingReceivable(projectId, billingB.id);
  assertClose(billingBReceivable.currentReceivable, 5000, 'Voided deduction ignored');

  activeStep = 'create final approved deduction';
  const finalDeduction = await runtime.createBillingDeduction(projectId, billingB.id, {
    amount: 500,
    reason: 'QA final approved deduction',
    status: 'pending'
  });
  await runtime.approveBillingDeduction(projectId, billingB.id, finalDeduction.id);
  billingBReceivable = await runtime.calculateBillingReceivable(projectId, billingB.id);
  assertClose(billingBReceivable.currentReceivable, 4500, 'Final approved deduction reduces receivable');

  activeStep = 'create rejected deduction';
  const rejectedDeduction = await runtime.createBillingDeduction(projectId, billingB.id, {
    amount: 700,
    reason: 'QA rejected deduction',
    status: 'pending'
  });
  activeStep = 'reject deduction';
  await runtime.rejectBillingDeduction(projectId, billingB.id, rejectedDeduction.id);
  activeStep = 'verify rejected deduction ignored';
  billingBReceivable = await runtime.calculateBillingReceivable(projectId, billingB.id);
  assertClose(billingBReceivable.currentReceivable, 4500, 'Rejected deduction ignored');

  activeStep = 'generate billing output';
  const output = await runtime.generateBillingOutputSnapshot(projectId, {
    billingId: billingB.id,
    title: 'QA Billing B Output'
  });
  assertTruthy(output.id, 'Billing output id');
  activeStep = 'verify billing output persisted';
  const outputs = await runtime.listBillingOutputs(projectId);
  assertTruthy(outputs.find(row => row.id === output.id), 'Billing output persisted');

  activeStep = 'verify billing output immutability after source edits';
  await runtime.saveContract(projectId, {
    amount: 100000,
    client: 'QA Client Changed',
    downPct: 10,
    retention: 10,
    startDate: today,
    endDate: today
  });
  await rest.update(`projects/${projectId}`, { name: `${projectName}_RENAMED` });
  const outputAfterEdits = await rest.get(`projects/${projectId}/billingOutputs/${output.id}`);
  assertClose(outputAfterEdits.snapshot.totals.gross, 5000, 'Output snapshot gross remains immutable');
  if (outputAfterEdits.snapshot.client.name !== 'QA Client') {
    throw new Error(`Output client snapshot changed: ${outputAfterEdits.snapshot.client.name}`);
  }
  if (outputAfterEdits.snapshot.project.name !== projectName) {
    throw new Error(`Output project snapshot changed: ${outputAfterEdits.snapshot.project.name}`);
  }

  activeStep = 'record excess auto allocated collection';
  const excessCollection = await runtime.recordCollection(projectId, {
    date: today,
    description: 'QA Excess auto allocated collection',
    amount: 12000,
    type: 'collection'
  });
  const excessCollectionSnap = await makeFirebaseAdapter(rest).database().ref(`projects/${projectId}/collections/${excessCollection.id}`).once('value');
  assertClose(excessCollectionSnap.val().unappliedAmount, 500, 'Excess collection unapplied amount');

  activeStep = 'rebuild and verify rollup';
  const rollup = await runtime.rebuildBillingRollups(projectId);
  assertClose(rollup.contractAmount, 100000, 'Rollup contractAmount');
  assertClose(rollup.totalBilled, 24000, 'Rollup totalBilled');
  assertClose(rollup.totalCollected, 24000, 'Rollup totalCollected');
  assertClose(rollup.totalRetentionHeld, 1000, 'Rollup totalRetentionHeld');
  assertClose(rollup.totalRetentionCollected, 1000, 'Rollup totalRetentionCollected');
  assertClose(rollup.retentionReceivable, 0, 'Rollup retentionReceivable');
  assertClose(rollup.totalDeductions, 500, 'Rollup totalDeductions');
  assertClose(rollup.totalAllocatedCollections, 22500, 'Rollup totalAllocatedCollections');
  assertClose(rollup.totalAppliedCollections, 23500, 'Rollup totalAppliedCollections');
  assertClose(rollup.unappliedCollections, 500, 'Rollup unappliedCollections');
  assertClose(rollup.receivable, 0, 'Rollup receivable');
  assertClose(rollup.laborCost, 1500, 'Rollup laborCost');
  assertClose(rollup.materialCost, 2000, 'Rollup materialCost');
  assertClose(rollup.estimatedProfit, 20500, 'Rollup estimatedProfit');

  activeStep = 'verify persisted rollup';
  const persistedRollup = await rest.get(`projects/${projectId}/billingRollups`);
  assertClose(persistedRollup.receivable, 0, 'Persisted rollup receivable');

  activeStep = 'archive QA project';
  await rest.update(`projects/${projectId}`, {
    status: 'archived',
    archivedAt: Date.now(),
    archivedBy: auth.localId,
    qaRunCompletedAt: Date.now(),
    qaRunResult: 'PASS'
  });

  const result = {
    status: 'PASS',
    projectId,
    projectName,
    archived: true,
    createdByRole: role,
    records: {
      billingA: billingA.id,
      downpayment: downpayment.id,
      mobilization: mobilization.id,
      billingB: billingB.id,
      collection1: collection1.id,
      autoCollection: autoCollection.id,
      excessCollection: excessCollection.id,
      billingOutput: output.id
    },
    rollup: {
      contractAmount: rollup.contractAmount,
      totalBilled: rollup.totalBilled,
      totalCollected: rollup.totalCollected,
      totalRetentionHeld: rollup.totalRetentionHeld,
      totalRetentionCollected: rollup.totalRetentionCollected,
      retentionReceivable: rollup.retentionReceivable,
      totalDeductions: rollup.totalDeductions,
      totalAllocatedCollections: rollup.totalAllocatedCollections,
      totalAppliedCollections: rollup.totalAppliedCollections,
      unappliedCollections: rollup.unappliedCollections,
      receivable: rollup.receivable,
      laborCost: rollup.laborCost,
      materialCost: rollup.materialCost,
      estimatedProfit: rollup.estimatedProfit
    }
  };

  console.log(JSON.stringify(result, null, 2));
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
  console.error(JSON.stringify({ status: 'FAILED', step: err.step || '', projectId: err.projectId || '', error: err.message, stack: err.stack }, null, 2));
  process.exit(1);
});
