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
    async update(value) { await rest.update(this.path, value); return this; }
    push(value) {
      const child = new Ref(`${this.path}/${pushKey()}`);
      if (arguments.length) child.set(value);
      return child;
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

function loadReportsRuntime(firebaseAdapter, authUser) {
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
  sandbox.isBoss = role => ['boss', 'owner', 'admin'].includes(String(role || '').toLowerCase());

  const context = vm.createContext(sandbox);
  const root = path.resolve(__dirname, '..');
  vm.runInContext(fs.readFileSync(path.join(root, 'utils.js'), 'utf8'), context, { filename: 'utils.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'report.js'), 'utf8'), context, { filename: 'report.js' });
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
  const runtime = loadReportsRuntime(firebaseAdapter, user);
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  activeStep = 'create QA project';
  const projectRef = firebaseAdapter.database().ref('projects').push();
  projectId = projectRef.key;
  const projectName = `QA_RC1_Reports_v78_${now}`;
  await projectRef.set({
    name: projectName,
    status: 'active',
    createdAt: now,
    createdDate: new Date().toLocaleDateString('en-PH'),
    laborBudget: 10000,
    materialBudget: 20000,
    laborBudgetDelta: 1000,
    materialBudgetDelta: 2000,
    otherSpent: 500,
    contract: {
      amount: 100000,
      originalAmount: 100000,
      startDate: today,
      endDate: today
    },
    billingRollups: {
      contractAmount: 100000,
      approvedChangeOrders: 5000,
      adjustedContractAmount: 105000,
      totalBilled: 50000,
      totalCollected: 30000,
      receivable: 20000,
      retentionReceivable: 3000,
      laborCost: 7000,
      materialCost: 11000
    },
    changeOrderRollups: {
      pendingCount: 1,
      approvedCount: 1,
      rejectedCount: 1,
      voidedCount: 0,
      approvedContractImpact: 5000,
      pendingValue: 2500,
      approvedValue: 5000
    },
    siteLogRollups: {
      totalLogs: 3,
      logsThisWeek: 2,
      logsWithGps: 1,
      logsWithMedia: 1,
      openIssues: 2,
      openDelays: 1,
      safetyIncidents: 0,
      lastLogDate: today
    },
    payrollLogs: {
      payroll_a: {
        status: 'posted',
        weekKey: '2026-W26',
        grossPayroll: 6000,
        netPayroll: 5200,
        cashAdvanceDeductions: 500,
        otherDeductions: 300
      }
    },
    purchaseOrders: {
      po_a: { total: 15000, status: 'submitted', createdAt: now }
    },
    deliveries: {
      dr_a: { totalCost: 8000, status: 'received', receivedAt: now }
    },
    materialIssuances: {
      issue_a: { status: 'posted', createdAt: now }
    },
    materialMovements: {
      move_receive: { type: 'receive', totalCost: 8000, qty: 80, createdAt: now },
      move_issue: { type: 'issue', qty: -12, createdAt: now + 1 }
    },
    qaRun: {
      module: 'reports_v1',
      version: 'v78',
      createdAt: now,
      createdBy: auth.localId
    }
  });
  runtime.window._currentPid = projectId;

  try {
    activeStep = 'rebuild project report rollup';
    const summary = await runtime.rebuildProjectReportRollup(projectId);
    assertClose(summary.contractAmount, 100000, 'contract amount');
    assertClose(summary.approvedChangeOrders, 5000, 'approved change orders');
    assertClose(summary.adjustedContractAmount, 105000, 'adjusted contract amount');
    assertClose(summary.laborBudget, 11000, 'labor budget with delta');
    assertClose(summary.materialBudget, 22000, 'material budget with delta');
    assertClose(summary.totalBudget, 33000, 'total budget');
    assertClose(summary.laborCost, 7000, 'labor cost from billing rollup');
    assertClose(summary.materialCost, 11000, 'material cost from billing rollup');
    assertClose(summary.otherCost, 500, 'other cost');
    assertClose(summary.totalCost, 18500, 'total cost');
    assertClose(summary.totalBilled, 50000, 'total billed');
    assertClose(summary.totalCollected, 30000, 'total collected');
    assertClose(summary.receivable, 20000, 'receivable');
    assertClose(summary.estimatedProfit, 11500, 'estimated profit');
    assertEqual(summary.openIssues, 2, 'open issues from site log rollup');

    activeStep = 'verify persisted report rollup';
    const persisted = await rest.get(`projects/${projectId}/reportRollups/projectSummary`);
    assertClose(persisted.totalCost, 18500, 'persisted total cost');
    assertClose(persisted.estimatedProfit, 11500, 'persisted estimated profit');

    activeStep = 'calculate module summaries';
    const laborSummary = await runtime.calculateLaborSummary(projectId);
    const materialSummary = await runtime.calculateMaterialsSummary(projectId);
    const billingSummary = await runtime.calculateBillingSummary(projectId);
    const coSummary = await runtime.calculateChangeOrderSummary(projectId);
    const siteSummary = await runtime.calculateSiteLogSummary(projectId);
    assertClose(laborSummary.grossPayroll, 6000, 'labor gross payroll');
    assertClose(materialSummary.receivingCost, 8000, 'material receiving cost');
    assertClose(billingSummary.totalCollected, 30000, 'billing collected');
    assertClose(coSummary.approvedValue, 5000, 'change order approved value');
    assertClose(siteSummary.totalLogs, 3, 'site log total logs');

    activeStep = 'cash flow and profit analysis';
    const cashFlow = await runtime.calculateCashFlow(projectId);
    const profit = await runtime.calculateProfitAnalysis(projectId);
    assertClose(cashFlow.cashIn, 30000, 'cash in');
    assertClose(cashFlow.cashOut, 18500, 'cash out');
    assertClose(cashFlow.netCashFlow, 11500, 'net cash flow');
    assertClose(profit.projectedProfit, 86500, 'projected profit');

    activeStep = 'generate immutable report snapshot';
    const snapshot = await runtime.generateReportSnapshot(projectId, 'weekly', {
      periodKey: '2026-W26',
      notes: 'QA reports snapshot'
    });
    assertTruthy(snapshot.id, 'snapshot id');
    assertEqual(snapshot.type, 'weekly', 'snapshot type');
    assertClose(snapshot.snapshot.projectSummary.totalCost, 18500, 'snapshot total cost');
    assertClose(snapshot.snapshot.cashFlow.netCashFlow, 11500, 'snapshot cash flow');
    const persistedSnapshot = await rest.get(`projects/${projectId}/reportSnapshots/${snapshot.id}`);
    assertEqual(persistedSnapshot.periodKey, '2026-W26', 'persisted snapshot period');

    activeStep = 'list rollups for dashboard';
    const rollups = await runtime.listProjectReportRollups({ status: 'active' });
    assertTruthy(rollups.some(row => row.projectId === projectId && row.totalCost === 18500), 'dashboard rollup list includes QA project');

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
      snapshotId: snapshot.id,
      summary: {
        contractAmount: summary.contractAmount,
        totalCost: summary.totalCost,
        totalCollected: summary.totalCollected,
        receivable: summary.receivable,
        estimatedProfit: summary.estimatedProfit,
        projectedProfit: summary.projectedProfit
      }
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
