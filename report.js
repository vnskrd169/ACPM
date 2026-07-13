//  ACPM - report.js
//  Executive dashboard, project health scores, variance analysis
//  Cross-project visibility for bosses, team performance metrics

let _reportsListeners = [];
let _teamAdminListener = null;
let _teamUsersCache = [];
let _auditListener = null;
let _auditRowsCache = [];
let _auditGlobalRowsCache = [];
let _auditFallbackRowsCache = [];
let _auditFallbackListeners = [];
let _auditUsersCache = {};
let _projectCache = [];
let _systemReportsProjectsCache = [];
let _lifecycleRequestListener = null;
let _lifecycleRequestsCache = [];
let _accessRequestListener = null;
let _accessRequestsCache = [];

function initReports() {
  detachReportsListeners();
  if (window._currentPid) {
    renderProjectReports(window._currentPid);
    return;
  }
  if (window._adminWorkspaceMode) {
    openSystemReports();
    return;
  }
  ensureSystemReportsView();
  $('systemReportsView')?.classList.add('hidden');
  $('workspaceView')?.classList.add('hidden');
  $('pmosOfficeView')?.classList.add('hidden');
  $('hubView')?.classList.remove('hidden');
}

function renderProjectReports(projectId) {
  const panel = $('reportsPanel');
  if (!panel) return;
  $('systemReportsView')?.classList.add('hidden');
  $('pmosOfficeView')?.classList.add('hidden');
  $('workspaceView')?.classList.remove('hidden');
  panel.dataset.reportMode = 'project';
  panel.innerHTML = `
    <div class="panel-card">
      <div class="panel-title">Project Reports</div>
      <div id="projectReportHeader"><p class="empty-hint">Loading project report...</p></div>
      <div class="exec-summary-grid">
        <div class="exec-stat"><div class="exec-stat-label">Total Budget</div><div class="exec-stat-val" id="prTotalBudget">0</div></div>
        <div class="exec-stat"><div class="exec-stat-label">Total Cost</div><div class="exec-stat-val" id="prTotalCost">0</div></div>
        <div class="exec-stat"><div class="exec-stat-label">Budget Used</div><div class="exec-stat-val" id="prBudgetUsed">0%</div></div>
        <div class="exec-stat"><div class="exec-stat-label">Health</div><div class="exec-stat-val" id="prHealth">0</div></div>
      </div>
      <div class="task-form-row">
        <button class="btn-ws-secondary" onclick="exportCurrentProjectReport('project_summary')">Project Summary JSON</button>
        <button class="btn-ws-secondary" onclick="exportCurrentProjectReport('weekly')">Weekly Project JSON</button>
        <button class="btn-ws-secondary" onclick="printCurrentProjectReport()">Printable Summary</button>
      </div>
    </div>
    <div class="panel-card">
      <div class="panel-title">Cost and Billing</div>
      <div id="projectReportCost"><p class="empty-hint">Loading...</p></div>
    </div>
    <div class="panel-card">
      <div class="panel-title">Operations</div>
      <div id="projectReportOps"><p class="empty-hint">Loading...</p></div>
    </div>
    <div class="panel-card">
      <div class="panel-title">Report Snapshots</div>
      <div id="projectReportSnapshots"><p class="empty-hint">Loading...</p></div>
    </div>`;

  const ref = firebase.database().ref(`projects/${projectId}`);
  _reportsListeners.push(ref);
  ref.on('value', snap => {
    if (!snap.exists()) {
      setHTML('projectReportHeader', '<p class="empty-hint">Project not found.</p>');
      return;
    }
    const project = { id: projectId, ...(snap.val() || {}) };
    const summary = projectReportSummary(projectId, project);
    const labor = calculateLaborSummaryFromProject(project);
    const materials = calculateMaterialsSummaryFromProject(project);
    const billing = calculateBillingSummaryFromProject(project);
    const changeOrders = calculateChangeOrderSummaryFromProject(project);
    const siteLog = calculateSiteLogSummaryFromProject(project);
    const health = calculateProjectHealth(project);

    setHTML('projectReportHeader', `
      <div class="health-card">
        <div class="health-hdr">
          <span class="health-name">${escapeHtml(project.name || projectId)}</span>
          <span class="badge badge-purple">${escapeHtml(project.status || 'active')}</span>
        </div>
        <div class="pmos-row-detail">Project-only report for the active workspace. System-wide reporting is in Hub > System Reports.</div>
      </div>`);
    setText('prTotalBudget', peso(summary.totalBudget));
    setText('prTotalCost', peso(summary.totalCost));
    setText('prBudgetUsed', `${summary.budgetUsedPct}%`);
    setText('prHealth', health.score);
    const healthEl = $('prHealth');
    if (healthEl) healthEl.style.color = health.score >= 80 ? 'var(--green)' : health.score >= 60 ? 'var(--amber)' : 'var(--red)';

    setHTML('projectReportCost', reportMetricTable([
      ['Labor Budget', peso(summary.laborBudget)],
      ['Labor Cost', peso(summary.laborCost)],
      ['Material Budget', peso(summary.materialBudget)],
      ['Material Cost', peso(summary.materialCost)],
      ['Total Billed', peso(billing.totalBilled)],
      ['Total Collected', peso(billing.totalCollected)],
      ['Receivable', peso(billing.receivable)],
      ['Projected Profit', peso(summary.projectedProfit)]
    ]));

    setHTML('projectReportOps', reportMetricTable([
      ['Payroll Weeks', labor.payrollWeeks],
      ['Purchase Orders', materials.purchaseOrders],
      ['Deliveries', materials.deliveries],
      ['Material Issuances', materials.issuances],
      ['Pending Change Orders', changeOrders.pendingCount],
      ['Approved Change Orders', changeOrders.approvedCount],
      ['Site Logs', siteLog.totalLogs],
      ['Open Site Issues', siteLog.openIssues],
      ['Open Delays', siteLog.openDelays],
      ['Last Site Log', siteLog.lastLogDate || '-']
    ]));

    renderProjectReportSnapshots(project);
  });
}

function reportMetricTable(rows) {
  return `<div class="summary-table-wrap"><table class="summary-table"><tbody>
    ${rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function renderProjectReportSnapshots(project = {}) {
  const el = $('projectReportSnapshots');
  if (!el) return;
  const rows = reportObjectRows(project.reportSnapshots)
    .sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0))
    .slice(0, 12);
  if (!rows.length) {
    el.innerHTML = '<p class="empty-hint">No saved report snapshots yet.</p>';
    return;
  }
  el.innerHTML = `<div class="summary-table-wrap"><table class="summary-table">
    <thead><tr><th>Type</th><th>Period</th><th>Generated</th><th>By</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td>${escapeHtml(r.type || '-')}</td>
      <td>${escapeHtml(r.periodKey || '-')}</td>
      <td>${escapeHtml(r.generatedAt ? new Date(r.generatedAt).toLocaleString('en-PH') : '-')}</td>
      <td>${escapeHtml(r.generatedByName || r.generatedBy || '-')}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function exportCurrentProjectReport(type = 'project_summary') {
  if (!window._currentPid) {
    showToast('Open a project first.', 'error');
    return;
  }
  try {
    await exportReport(window._currentPid, type);
    showToast('Project report exported.');
  } catch (e) {
    console.error('Project report export failed:', e);
    showToast('Could not export project report.', 'error');
  }
}

async function printCurrentProjectReport() {
  if (!window._currentPid) {
    showToast('Open a project first.', 'error');
    return;
  }
  try {
    const project = await getProjectReportSource(window._currentPid);
    const summary = projectReportSummary(window._currentPid, project);
    const win = window.open('', '_blank');
    if (!win) {
      showToast('Popup blocked. Allow popups to print reports.', 'warn');
      return;
    }
    win.document.write(`<!doctype html><html><head><title>${escapeHtml(project.name || 'Project Report')}</title><style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111} h1{font-size:22px} table{width:100%;border-collapse:collapse;font-size:12px} td,th{border:1px solid #ccc;padding:8px;text-align:left} th{background:#f3f4f6}
    </style></head><body>
      <h1>${escapeHtml(project.name || 'Project Report')}</h1>
      <p>Generated ${escapeHtml(new Date().toLocaleString('en-PH'))}</p>
      ${reportMetricTable([
        ['Total Budget', peso(summary.totalBudget)],
        ['Total Cost', peso(summary.totalCost)],
        ['Budget Used', `${summary.budgetUsedPct}%`],
        ['Total Billed', peso(summary.totalBilled)],
        ['Total Collected', peso(summary.totalCollected)],
        ['Receivable', peso(summary.receivable)],
        ['Open Issues', summary.openIssues],
        ['Open Delays', summary.openDelays]
      ])}
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  } catch (e) {
    console.error('Project report print failed:', e);
    showToast('Could not print project report.', 'error');
  }
}

function systemReportsMarkup() {
  return `
    <section id="systemReportsView" class="view-workspace hidden">
      <div class="workspace-head">
        <div>
          <div class="ws-kicker">Whole System</div>
          <h2>System Reports</h2>
          <p>Cross-project executive reporting for the Hub. Project-specific reports stay inside each project workspace.</p>
        </div>
        <div class="ws-actions">
          <button class="btn-ws-back" type="button" onclick="closeSystemReports()">Back</button>
        </div>
      </div>
      <div class="panel-card" id="executiveDashboard">
        <div class="panel-title">Executive Dashboard</div>
        <div class="system-report-filters">
          <label>
            <span>Status</span>
            <select id="systemReportStatusFilter" onchange="renderSystemReportsFromCache()">
              <option value="active">Current Active</option>
              <option value="all">All History</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label>
            <span>Period</span>
            <select id="systemReportPeriodFilter" onchange="renderSystemReportsFromCache()">
              <option value="all">All Periods</option>
            </select>
          </label>
          <div id="systemReportFilterNote" class="system-report-filter-note">Showing active project operations.</div>
        </div>
        <div class="exec-summary-grid">
          <div class="exec-stat"><div class="exec-stat-label" id="execProjectCountLabel">Projects in View</div><div class="exec-stat-val" id="execActiveProjects">0</div></div>
          <div class="exec-stat"><div class="exec-stat-label">Total Budget</div><div class="exec-stat-val" id="execTotalBudget">0</div></div>
          <div class="exec-stat"><div class="exec-stat-label">Total Spent</div><div class="exec-stat-val" id="execTotalSpent">0</div></div>
          <div class="exec-stat"><div class="exec-stat-label">Avg Health</div><div class="exec-stat-val" id="execAvgHealth">0%</div></div>
          <button class="btn-ws-secondary" onclick="generateWeeklyReport()">Weekly Report</button>
        </div>
        <div class="exec-overview">
          <div class="exec-chart-card">
            <div class="panel-subtitle">Budget Mix</div>
            <div id="execBudgetChart" class="exec-budget-chart"></div>
            <div id="execBudgetLegend" class="exec-budget-legend"></div>
          </div>
          <div class="exec-health-card">
            <div class="panel-subtitle">Project Health</div>
            <div id="execProjectHealth" class="exec-health-grid"></div>
          </div>
        </div>
      </div>
      <div class="panel-card">
        <div class="panel-title">Team Performance</div>
        <div id="teamPerformance"><p class="empty-hint">Loading...</p></div>
      </div>
      <div class="panel-card">
        <div class="panel-title">Budget Variance</div>
        <div id="budgetVariance"><p class="empty-hint">Loading...</p></div>
      </div>
    </section>`;
}

function ensureSystemReportsView() {
  const workspaceReports = $('reportsPanel');
  if (workspaceReports && workspaceReports.dataset.reportMode !== 'project') {
    workspaceReports.dataset.reportMode = 'placeholder';
    workspaceReports.innerHTML = '<div class="panel-card"><div class="panel-title">Project Reports</div><p class="empty-hint">Open this tab inside a project for project-only reports.</p></div>';
  }
  if (!$('systemReportsView')) {
    document.querySelector('.main')?.insertAdjacentHTML('beforeend', systemReportsMarkup());
  }
}

function openSystemReports() {
  ensureSystemReportsView();
  detachReportsListeners();
  window._systemReportsReturnMode = window._adminWorkspaceMode
    ? 'admin'
    : window._currentPid
      ? 'project'
      : 'hub';
  if (!reportCurrentUserIsBoss()) {
    ['executiveDashboard', 'teamPerformance', 'budgetVariance'].forEach(id => {
      const el = $(id);
      if (el) el.innerHTML = '<p class="empty-hint">Reports available for admins only.</p>';
    });
    return;
  }
  $('hubView')?.classList.add('hidden');
  $('workspaceView')?.classList.add('hidden');
  $('pmosOfficeView')?.classList.add('hidden');
  $('systemReportsView')?.classList.remove('hidden');
  renderExecutiveDashboard();
  renderTeamPerformance();
  renderBudgetVariance();
}

function closeSystemReports() {
  detachReportsListeners();
  $('systemReportsView')?.classList.add('hidden');
  if (window._systemReportsReturnMode === 'admin' && typeof openTeamAdmin === 'function') {
    openTeamAdmin();
  } else if (window._currentPid) {
    $('workspaceView')?.classList.remove('hidden');
  } else {
    $('hubView')?.classList.remove('hidden');
  }
  window._systemReportsReturnMode = null;
}

document.addEventListener('DOMContentLoaded', ensureSystemReportsView);

function reportCurrentUserIsBoss() {
  const user = window._currentUser || {};
  return typeof isBoss === 'function'
    ? isBoss(user.role)
    : String(user.role || '').trim().toLowerCase() === 'boss';
}

function reportRoleLabel(role) {
  if (typeof window !== 'undefined' && typeof window.roleLabel === 'function') {
    return window.roleLabel(role);
  }
  return String(role || '').trim().toLowerCase() === 'boss'
    ? 'Admin / Boss / Project Manager'
    : 'Assoc. Project Manager';
}

function reportAmount(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function reportObjectRows(obj = {}) {
  return Object.entries(obj || {}).map(([id, value]) => ({ id, ...(value || {}) }));
}

function reportUserId() {
  return window._currentUser?.uid || firebase.auth().currentUser?.uid || 'system';
}

function reportUserName() {
  const authUser = firebase.auth().currentUser;
  return window._currentUser?.name || window._currentUser?.displayName || authUser?.displayName || authUser?.email || 'System';
}

function reportEffectiveBudget(project = {}) {
  const laborBudget = reportAmount(project.laborBudget) + reportAmount(project.laborBudgetDelta);
  const materialBudget = reportAmount(project.materialBudget) + reportAmount(project.materialBudgetDelta);
  const otherBudget = Math.max(0, reportAmount(project.totalBudget || project.budget) - laborBudget - materialBudget);
  return {
    laborBudget,
    materialBudget,
    otherBudget,
    totalBudget: laborBudget + materialBudget + otherBudget
  };
}

function projectReportSummary(projectId, project = {}) {
  const billing = project.billingRollups || {};
  const coRollup = project.changeOrderRollups || {};
  const siteLogRollup = project.siteLogRollups || {};
  const budgets = reportEffectiveBudget(project);
  const laborCost = reportAmount(billing.laborCost || project.laborSpent);
  const materialCost = reportAmount(billing.materialCost || project.materialSpent);
  const otherCost = reportAmount(project.otherSpent);
  const totalCost = laborCost + materialCost + otherCost;
  const contractAmount = reportAmount(billing.contractAmount || project.contractAmount || project.contract?.amount || project.contract?.originalAmount);
  const approvedChangeOrders = reportAmount(billing.approvedChangeOrders || coRollup.approvedContractImpact);
  const adjustedContractAmount = reportAmount(billing.adjustedContractAmount || (contractAmount + approvedChangeOrders));
  const totalBilled = reportAmount(billing.totalBilled || billing.totalBilledGross);
  const totalCollected = reportAmount(billing.totalCollected || billing.totalRevenueCollected);
  const receivable = reportAmount(billing.receivable || billing.totalReceivable);
  const retentionReceivable = reportAmount(billing.retentionReceivable);
  const estimatedProfit = totalCollected - totalCost;
  const projectedProfit = adjustedContractAmount - totalCost;
  const margin = totalCollected > 0 ? estimatedProfit / totalCollected : 0;
  const budgetUsedPct = budgets.totalBudget > 0 ? Math.round((totalCost / budgets.totalBudget) * 100) : 0;
  const budgetStatus = budgetUsedPct >= 100 ? 'over_budget' : budgetUsedPct >= 85 ? 'warning' : 'healthy';
  return {
    projectId,
    projectName: project.name || projectId,
    status: project.status || 'active',
    contractAmount,
    approvedChangeOrders,
    adjustedContractAmount,
    laborBudget: budgets.laborBudget,
    materialBudget: budgets.materialBudget,
    otherBudget: budgets.otherBudget,
    totalBudget: budgets.totalBudget,
    laborCost,
    materialCost,
    otherCost,
    totalCost,
    totalBilled,
    totalCollected,
    receivable,
    retentionReceivable,
    estimatedProfit,
    projectedProfit,
    margin,
    budgetUsedPct,
    budgetStatus,
    siteLogsTotal: reportAmount(siteLogRollup.totalLogs),
    openIssues: reportAmount(siteLogRollup.openIssues),
    openDelays: reportAmount(siteLogRollup.openDelays),
    lastUpdatedAt: Date.now()
  };
}

function reportSummaryForProject(project = {}) {
  return project.reportRollups?.projectSummary || projectReportSummary(project.id || project.projectId || '', project);
}

async function rebuildProjectReportRollup(projectId) {
  if (!projectId) throw new Error('Project ID is required.');
  const snap = await firebase.database().ref(`projects/${projectId}`).once('value');
  if (!snap.exists()) throw new Error('Project not found.');
  const summary = projectReportSummary(projectId, snap.val() || {});
  await firebase.database().ref(`projects/${projectId}/reportRollups/projectSummary`).set({
    ...summary,
    updatedBy: reportUserId()
  });
  return summary;
}

async function getProjectReportSource(projectId) {
  if (!projectId) throw new Error('Project ID is required.');
  const snap = await firebase.database().ref(`projects/${projectId}`).once('value');
  if (!snap.exists()) throw new Error('Project not found.');
  return { id: projectId, ...(snap.val() || {}) };
}

function calculateLaborSummaryFromProject(project = {}) {
  const payrollLogs = reportObjectRows(project.payrollLogs);
  const activeLogs = payrollLogs.filter(log => !['voided', 'cancelled', 'rejected'].includes(String(log.status || '').toLowerCase()));
  const grossPayroll = activeLogs.reduce((sum, log) => sum + reportAmount(log.grossPayroll ?? log.gross ?? log.totalGross), 0);
  const netPayroll = activeLogs.reduce((sum, log) => sum + reportAmount(log.netPayroll ?? log.net ?? log.totalNet), 0);
  const deductions = activeLogs.reduce((sum, log) => {
    const cashAdvances = reportAmount(log.cashAdvanceDeductions ?? log.cashAdvancesDeductedTotal);
    const other = reportAmount(log.otherDeductions ?? log.additionalDeductions);
    return sum + cashAdvances + other;
  }, 0);
  return {
    payrollWeeks: activeLogs.length,
    grossPayroll,
    netPayroll,
    deductions,
    laborCost: reportAmount(project.billingRollups?.laborCost ?? project.laborSpent ?? grossPayroll),
    lastPayrollWeek: activeLogs.map(log => log.weekKey || log.weekStart || '').filter(Boolean).sort().pop() || ''
  };
}

function calculateMaterialsSummaryFromProject(project = {}) {
  const movements = reportObjectRows(project.materialMovements).filter(m => String(m.status || 'posted').toLowerCase() !== 'voided');
  const purchaseOrders = reportObjectRows(project.purchaseOrders);
  const deliveries = reportObjectRows(project.deliveries);
  const issuances = reportObjectRows(project.materialIssuances).filter(i => String(i.status || 'posted').toLowerCase() !== 'voided');
  const receivingCost = movements
    .filter(m => ['receive', 'receiving', 'delivery_receive'].includes(String(m.type || '').toLowerCase()))
    .reduce((sum, m) => sum + reportAmount(m.totalCost ?? m.amount ?? m.total), 0);
  const issuedQty = movements
    .filter(m => ['issue', 'issuance'].includes(String(m.type || '').toLowerCase()))
    .reduce((sum, m) => sum + reportAmount(Math.abs(reportAmount(m.qty ?? m.quantity))), 0);
  return {
    purchaseOrders: purchaseOrders.length,
    deliveries: deliveries.length,
    issuances: issuances.length,
    movementRows: movements.length,
    receivingCost,
    materialCost: reportAmount(project.billingRollups?.materialCost ?? project.materialSpent ?? receivingCost),
    issuedQty,
    lastMovementAt: movements.map(m => reportAmount(m.createdAt || m.date)).sort((a, b) => a - b).pop() || 0
  };
}

function calculateBillingSummaryFromProject(project = {}) {
  const rollup = project.billingRollups || {};
  return {
    contractAmount: reportAmount(rollup.contractAmount),
    approvedChangeOrders: reportAmount(rollup.approvedChangeOrders),
    adjustedContractAmount: reportAmount(rollup.adjustedContractAmount),
    totalBilled: reportAmount(rollup.totalBilled ?? rollup.totalGrossBilled),
    totalCollected: reportAmount(rollup.totalCollected ?? rollup.totalRevenueCollected),
    receivable: reportAmount(rollup.receivable ?? rollup.totalReceivable),
    retentionReceivable: reportAmount(rollup.retentionReceivable),
    billingCount: reportObjectRows(project.billings).length,
    collectionCount: reportObjectRows(project.collections).filter(c => String(c.status || 'posted').toLowerCase() !== 'voided').length
  };
}

function calculateChangeOrderSummaryFromProject(project = {}) {
  const rollup = project.changeOrderRollups || {};
  return {
    pendingCount: reportAmount(rollup.pendingCount),
    approvedCount: reportAmount(rollup.approvedCount),
    rejectedCount: reportAmount(rollup.rejectedCount),
    voidedCount: reportAmount(rollup.voidedCount),
    approvedContractImpact: reportAmount(rollup.approvedContractImpact),
    pendingValue: reportAmount(rollup.pendingValue),
    approvedValue: reportAmount(rollup.approvedValue)
  };
}

function calculateSiteLogSummaryFromProject(project = {}) {
  const rollup = project.siteLogRollups || {};
  return {
    totalLogs: reportAmount(rollup.totalLogs),
    logsThisWeek: reportAmount(rollup.logsThisWeek),
    logsWithGps: reportAmount(rollup.logsWithGps),
    logsWithMedia: reportAmount(rollup.logsWithMedia),
    openIssues: reportAmount(rollup.openIssues),
    openDelays: reportAmount(rollup.openDelays),
    safetyIncidents: reportAmount(rollup.safetyIncidents),
    lastLogDate: rollup.lastLogDate || ''
  };
}

async function calculateLaborSummary(projectId) {
  return calculateLaborSummaryFromProject(await getProjectReportSource(projectId));
}

async function calculateMaterialsSummary(projectId) {
  return calculateMaterialsSummaryFromProject(await getProjectReportSource(projectId));
}

async function calculateBillingSummary(projectId) {
  return calculateBillingSummaryFromProject(await getProjectReportSource(projectId));
}

async function calculateChangeOrderSummary(projectId) {
  return calculateChangeOrderSummaryFromProject(await getProjectReportSource(projectId));
}

async function calculateSiteLogSummary(projectId) {
  return calculateSiteLogSummaryFromProject(await getProjectReportSource(projectId));
}

async function listProjectReportRollups(filters = {}) {
  const snap = await firebase.database().ref('projects').once('value');
  const rows = [];
  snap.forEach(projectSnap => {
    const project = projectSnap.val() || {};
    const rollup = project.reportRollups?.projectSummary;
    const summary = rollup || projectReportSummary(projectSnap.key, project);
    if (filters.status && summary.status !== filters.status) return;
    rows.push(summary);
  });
  return rows.sort((a, b) => String(a.projectName || '').localeCompare(String(b.projectName || '')));
}

async function calculateCashFlow(projectId) {
  const summary = await rebuildProjectReportRollup(projectId);
  const cashIn = summary.totalCollected;
  const cashOut = summary.laborCost + summary.materialCost + summary.otherCost;
  return {
    projectId,
    cashIn,
    cashOut,
    netCashFlow: cashIn - cashOut,
    generatedAt: Date.now()
  };
}

async function calculateProfitAnalysis(projectId) {
  const summary = await rebuildProjectReportRollup(projectId);
  return {
    projectId,
    revenueCollected: summary.totalCollected,
    adjustedContractAmount: summary.adjustedContractAmount,
    totalCost: summary.totalCost,
    estimatedProfit: summary.estimatedProfit,
    projectedProfit: summary.projectedProfit,
    margin: summary.margin,
    receivable: summary.receivable,
    generatedAt: Date.now()
  };
}

async function generateReportSnapshot(projectId, type = 'project_summary', period = {}) {
  if (!projectId) throw new Error('Project ID is required.');
  const sourceProject = await getProjectReportSource(projectId);
  const projectSummary = projectReportSummary(projectId, sourceProject);
  await firebase.database().ref(`projects/${projectId}/reportRollups/projectSummary`).set({
    ...projectSummary,
    updatedBy: reportUserId()
  });
  const laborSummary = calculateLaborSummaryFromProject(sourceProject);
  const materialSummary = calculateMaterialsSummaryFromProject(sourceProject);
  const billingSummary = calculateBillingSummaryFromProject(sourceProject);
  const changeOrderSummary = calculateChangeOrderSummaryFromProject(sourceProject);
  const siteLogSummary = calculateSiteLogSummaryFromProject(sourceProject);
  const cashFlow = {
    projectId,
    cashIn: projectSummary.totalCollected,
    cashOut: projectSummary.totalCost,
    netCashFlow: projectSummary.totalCollected - projectSummary.totalCost,
    generatedAt: Date.now()
  };
  const profitAnalysis = {
    projectId,
    revenueCollected: projectSummary.totalCollected,
    adjustedContractAmount: projectSummary.adjustedContractAmount,
    totalCost: projectSummary.totalCost,
    estimatedProfit: projectSummary.estimatedProfit,
    projectedProfit: projectSummary.projectedProfit,
    margin: projectSummary.margin,
    receivable: projectSummary.receivable,
    generatedAt: Date.now()
  };
  const now = Date.now();
  const periodKey = period.periodKey || period.weekKey || period.monthKey || new Date(now).toISOString().slice(0, 10);
  const payload = {
    type,
    periodKey,
    generatedAt: now,
    generatedBy: reportUserId(),
    generatedByName: reportUserName(),
    sourceRollupVersion: 'reports-v1',
    snapshot: {
      projectSummary,
      billingSummary: {
        ...billingSummary
      },
      laborSummary,
      materialSummary,
      changeOrderSummary,
      siteLogSummary,
      costSummary: {
        laborCost: projectSummary.laborCost,
        materialCost: projectSummary.materialCost,
        totalCost: projectSummary.totalCost
      },
      cashFlow,
      profitAnalysis,
      notes: period.notes || ''
    }
  };
  const ref = firebase.database().ref(`projects/${projectId}/reportSnapshots`).push();
  await ref.set(payload);
  return { id: ref.key, ...payload };
}

function rebuildWeeklyReportRollup(projectId, weekKey) {
  return generateReportSnapshot(projectId, 'weekly', { weekKey, periodKey: weekKey });
}

function rebuildMonthlyReportRollup(projectId, monthKey) {
  return generateReportSnapshot(projectId, 'monthly', { monthKey, periodKey: monthKey });
}

function exportReport(projectId, type = 'project_summary') {
  return generateReportSnapshot(projectId, type).then(snapshot => {
    downloadTextFile(`Report_${projectId}_${type}_${snapshot.periodKey}.json`, JSON.stringify(snapshot, null, 2), 'application/json');
    return snapshot;
  });
}

function formatProjectLabel(projectId) {
  const project = _projectCache.find(p => p.id === projectId);
  if (project?.name) return project.name;
  if (project?.id && !String(project.id).startsWith('-')) return project.id;
  if (projectId && String(projectId).startsWith('-')) return 'Unlinked project';
  return projectId || '-';
}

function reportProjectList(value) {
  if (typeof normalizeProjectList === 'function') return normalizeProjectList(value);
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, enabled]) => enabled !== false && enabled !== null)
      .map(([key]) => String(key));
  }
  return [];
}

function initAdminSummary() {
  const el = $('accountSummary');
  const user = window._currentUser || {};
  const projects = reportProjectList(user.projects);
  const bossOf = reportProjectList(user.bossOf);
  const role = typeof normalizeRole === 'function' ? normalizeRole(user.role) : String(user.role || '').toLowerCase();
  const canManageTeam = ['boss', 'owner', 'admin'].includes(role);
  const projectText = projects.map(formatProjectLabel).join(', ') || 'No projects assigned yet';
  const bossOfText = bossOf.map(formatProjectLabel).join(', ') || '-';
  if (!el) return;
  el.innerHTML = `
    ${canManageTeam ? `
      <div class="admin-summary-actions">
        <button class="btn-ws-secondary" onclick="switchAdminSection('team')">&#x1F465; Manage Team / Assign Projects</button>
        <button class="btn-ws-secondary" onclick="switchAdminSection('requests')">&#x2709; Review Access Requests</button>
      </div>` : ''}
    <div class="summary-table-wrap">
      <table class="summary-table">
        <tbody>
          <tr><td>Name</td><td>${escapeHtml(user.name || user.displayName || 'User')}</td></tr>
          <tr><td>Email</td><td>${escapeHtml(user.email || '-')}</td></tr>
          <tr><td>Role</td><td>${escapeHtml(reportRoleLabel(user.role))}</td></tr>
          <tr><td>Projects</td><td>${escapeHtml(projectText)}</td></tr>
          <tr><td>Boss Of</td><td>${escapeHtml(bossOfText)}</td></tr>
        </tbody>
      </table>
    </div>`;
}

function auditActorProfile(row) {
  const uid = row?.userId || row?.uid || '';
  const user = uid ? _auditUsersCache[uid] : null;
  const name = row?.userName || user?.name || user?.email || uid || '-';
  const email = row?.userEmail || user?.email || '';
  return { uid, name, email, avatarUrl: user?.avatarUrl || '', position: user?.position || '', role: user?.role || row?.userRole || '' };
}

function auditActorSearchText(row) {
  const actor = auditActorProfile(row);
  return [actor.name, actor.email, actor.uid].filter(Boolean).join(' ').toLowerCase();
}

function auditActorHtml(row) {
  const actor = auditActorProfile(row);
  const secondary = [actor.position || reportRoleLabel(actor.role), actor.email]
    .filter(Boolean)
    .join(' | ');
  return `
    <div class="audit-actor-card">
      ${teamAvatar(actor)}
      <div>
        <div class="audit-actor-name">${escapeHtml(actor.name)}</div>
        ${secondary ? `<div class="audit-actor-sub">${escapeHtml(secondary)}</div>` : ''}
      </div>
    </div>`;
}

function auditActionLabel(row = {}) {
  const action = String(row.action || 'action').replace(/_/g, ' ').trim();
  const entity = String(row.entityType || row.module || '').replace(/_/g, ' ').trim();
  const label = [action, entity].filter(Boolean).join(' ');
  return label.replace(/\b\w/g, c => c.toUpperCase());
}

function auditModuleLabel(row = {}) {
  return String(row.entityType || row.module || 'system').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function auditActionClass(row = {}) {
  const text = `${row.action || ''} ${row.entityType || ''} ${row.module || ''}`.toLowerCase();
  if (text.includes('reject') || text.includes('void') || text.includes('archive') || text.includes('delete')) return 'audit-danger';
  if (text.includes('approve') || text.includes('release') || text.includes('complete')) return 'audit-success';
  if (text.includes('billing') || text.includes('collection') || text.includes('payment')) return 'audit-finance';
  if (text.includes('material') || text.includes('supplier') || text.includes('po')) return 'audit-materials';
  if (text.includes('labor') || text.includes('payroll') || text.includes('cash')) return 'audit-labor';
  return 'audit-neutral';
}

function auditRecordSummary(row = {}) {
  const parts = [];
  const record = row.entityId || row.recordId || '';
  if (record) parts.push(`Record ${record}`);
  if (row.previousStatus || row.newStatus) parts.push(`${row.previousStatus || '-'} -> ${row.newStatus || '-'}`);
  if (row.notes) parts.push(row.notes);
  return parts.join(' | ');
}

function auditRowFingerprint(row = {}) {
  return [
    row.action || '',
    row.entityType || row.module || '',
    row.entityId || row.recordId || '',
    row.userId || row.uid || '',
    row.timestamp || '',
    row.projectId || ''
  ].join('|');
}

function auditMergeRows() {
  const seen = new Set();
  _auditRowsCache = [..._auditGlobalRowsCache, ..._auditFallbackRowsCache]
    .filter(row => {
      const key = auditRowFingerprint(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  syncAuditProjectFilter();
  renderAuditLog(_auditRowsCache);
}

function syncAuditProjectFilter() {
  const projectSel = $('auditFilterProject');
  if (!projectSel) return;
  const previous = projectSel.value || '';
  const projects = [...new Set(_auditRowsCache.map(r => r.projectId).filter(Boolean))].sort();
  projectSel.innerHTML = '<option value="">All projects</option>' + projects.map(pid => `<option value="${escapeHtml(pid)}">${escapeHtml(formatProjectLabel(pid))}</option>`).join('');
  if (previous && projects.includes(previous)) projectSel.value = previous;
  projectSel.dataset.loaded = '1';
}

function detachAuditFallbackListeners() {
  _auditFallbackListeners.forEach(ref => ref.off());
  _auditFallbackListeners = [];
}

function collectProjectFallbackAuditRows(snap) {
  const rows = [];
  snap.forEach(projectSnap => {
    const projectId = projectSnap.key;
    const project = projectSnap.val() || {};
    Object.entries(project.auditLogs || {}).forEach(([id, row]) => {
      rows.push({
        id,
        sourcePath: `projects/${projectId}/auditLogs/${id}`,
        projectId: row?.projectId || projectId,
        ...(row || {})
      });
    });
  });
  return rows;
}

function collectSupplierFallbackAuditRows(snap) {
  const rows = [];
  snap.forEach(supplierSnap => {
    const supplierId = supplierSnap.key;
    const supplierAuditRows = supplierSnap.val() || {};
    Object.entries(supplierAuditRows || {}).forEach(([id, row]) => {
      rows.push({
        id,
        sourcePath: `supplierAuditLogs/${supplierId}/${id}`,
        entityType: row?.entityType || 'supplier',
        entityId: row?.entityId || supplierId,
        ...(row || {})
      });
    });
  });
  return rows;
}

function initAuditLog() {
  const user = window._currentUser;
  if (!user || !(typeof isBoss === 'function' ? isBoss(user.role) : user.role === 'boss')) {
    const el = $('auditLogFeed');
    if (el) el.innerHTML = '<p class="empty-hint">Audit log is available for admins only.</p>';
    return;
  }
  if (_auditListener) {
    _auditListener.off();
    _auditListener = null;
  }
  detachAuditFallbackListeners();
  _auditGlobalRowsCache = [];
  _auditFallbackRowsCache = [];
  _auditRowsCache = [];
  firebase.database().ref('users').once('value')
    .then(snap => {
      const users = {};
      snap.forEach(c => {
        users[c.key] = { uid: c.key, ...c.val() };
      });
      _auditUsersCache = users;
    })
    .catch(e => console.error('audit user lookup failed:', e))
    .finally(() => renderAuditLog(_auditRowsCache));

  const ref = firebase.database().ref('auditLogs');
  _auditListener = ref;
  ref.on('value', snap => {
    const el = $('auditLogFeed');
    if (!el) return;
    const rows = [];
    snap.forEach(c => {
      rows.push({ id: c.key, sourcePath: `auditLogs/${c.key}`, ...c.val() });
    });
    _auditGlobalRowsCache = rows;
    auditMergeRows();
  });

  const projectAuditRef = firebase.database().ref('projects');
  const supplierAuditRef = firebase.database().ref('supplierAuditLogs');
  _auditFallbackListeners = [projectAuditRef, supplierAuditRef];
  projectAuditRef.on('value', snap => {
    _auditFallbackRowsCache = [
      ...collectProjectFallbackAuditRows(snap),
      ..._auditFallbackRowsCache.filter(row => !String(row.sourcePath || '').startsWith('projects/'))
    ];
    auditMergeRows();
  });
  supplierAuditRef.on('value', snap => {
    _auditFallbackRowsCache = [
      ..._auditFallbackRowsCache.filter(row => !String(row.sourcePath || '').startsWith('supplierAuditLogs/')),
      ...collectSupplierFallbackAuditRows(snap)
    ];
    auditMergeRows();
  });
}

function renderAuditLog(rows = _auditRowsCache) {
  const el = $('auditLogFeed');
  if (!el) return;
  const actionNeedle = String($('auditFilterAction')?.value || '').trim().toLowerCase();
  const userNeedle = String($('auditFilterUser')?.value || '').trim().toLowerCase();
  const projectNeedle = String($('auditFilterProject')?.value || '').trim().toLowerCase();

  const filtered = rows.filter(r => {
    const action = String(r.action || '').toLowerCase();
    const module = String(r.entityType || r.module || '').toLowerCase();
    const actor = auditActorSearchText(r);
    const pid = String(r.projectId || '').toLowerCase();
    return (!actionNeedle || action.includes(actionNeedle) || module.includes(actionNeedle)) &&
      (!userNeedle || actor.includes(userNeedle)) &&
      (!projectNeedle || !pid || pid === projectNeedle);
  });

  setText('auditCountBadge', filtered.length);
  if (!filtered.length) {
    el.innerHTML = '<p class="empty-hint">No audit entries found.</p>';
    return;
  }

  el.innerHTML = `<div style="display:grid;gap:8px">
    ${filtered.map(r => `
      <div class="health-card audit-card ${auditActionClass(r)}">
        <div class="health-hdr audit-card-head">
          <div>
            <span class="audit-module-pill">${escapeHtml(auditModuleLabel(r))}</span>
            <span class="health-name">${escapeHtml(auditActionLabel(r))}</span>
          </div>
          <span class="health-score" style="font-size:12px">${escapeHtml(new Date(r.timestamp || Date.now()).toLocaleString('en-PH'))}</span>
        </div>
        <div class="audit-card-grid">
          <div>
            <div class="audit-meta-label">Actor</div>
            ${auditActorHtml(r)}
          </div>
          <div>
            <div class="audit-meta-label">Project</div>
            <div class="audit-project-name">${escapeHtml(formatProjectLabel(r.projectId || '-'))}</div>
            ${auditRecordSummary(r) ? `<div class="audit-actor-sub">${escapeHtml(auditRecordSummary(r))}</div>` : ''}
          </div>
        </div>
        <div class="audit-detail-line">
          ${r.fallbackPath ? '<span>Source: Local fallback audit path</span>' : '<span>Source: Global audit log</span>'}
          ${r.details ? `<span>Details: ${escapeHtml(JSON.stringify(r.details))}</span>` : ''}
        </div>
      </div>`).join('')}
  </div>`;
}

function initSystemStatus() {
  const el = $('systemStatus');
  if (!el) return;
  const user = window._currentUser || {};
  el.innerHTML = `
    <div class="summary-table-wrap">
      <table class="summary-table">
        <tbody>
          <tr><td>App</td><td>ACPM</td></tr>
          <tr><td>Current Role</td><td>${escapeHtml(reportRoleLabel(user.role))}</td></tr>
          <tr><td>Current User</td><td>${escapeHtml(user.name || 'User')}</td></tr>
          <tr><td>Project Context</td><td>${escapeHtml(window._currentPid || 'Hub')}</td></tr>
          <tr><td>Offline Cache</td><td>${navigator.onLine ? 'Online' : 'Offline'}</td></tr>
        </tbody>
      </table>
    </div>`;
}

function initTeamAdmin() {
  if (!(typeof isBoss === 'function' ? isBoss(window._currentUser?.role) : window._currentUser?.role === 'boss')) {
    const el = $('teamAdminList');
    if (el) el.innerHTML = '<p class="empty-hint">Team admin is available for admins only.</p>';
    return;
  }
  if (_teamAdminListener) {
    _teamAdminListener.off();
    _teamAdminListener = null;
  }
  const el = $('teamAdminList');
  if (el) el.innerHTML = '<p class="empty-hint">Loading users and projects...</p>';

  const renderWithProjectNames = () => loadProjectsForAssignments(false)
    .catch(() => [])
    .then(() => renderTeamAdmin(_teamUsersCache));

  const ref = firebase.database().ref('users');
  _teamAdminListener = ref;
  ref.on('value', snap => {
    const users = [];
    snap.forEach(c => {
      const user = { uid: c.key, ...c.val() };
      if (String(user.status || 'active').toLowerCase() === 'pending') return false;
      users.push(user);
      return false;
    });
    users.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    _teamUsersCache = users;
    renderWithProjectNames();
  });
}

function projectAssignmentRows(projects) {
  return projects.map(p => `
    <label class="assign-proj-row">
      <input type="checkbox" value="${escapeHtml(p.id)}">
      <span>
        <span class="assign-proj-name">${escapeHtml(p.name || p.id)}</span>
        <span class="assign-proj-sub">${escapeHtml(p.status || 'active')}</span>
      </span>
    </label>
  `).join('');
}

function collectProjectAssignmentFallbacks() {
  const map = new Map((_projectCache || []).filter(p => p?.id).map(p => [p.id, p]));
  document.querySelectorAll('.proj-card[data-pid]').forEach(card => {
    const id = card.getAttribute('data-pid');
    if (!id || map.has(id)) return;
    const name = card.querySelector('.proj-name')?.textContent?.trim() || id;
    const statusText = card.querySelector('.active-tag, .completed-tag')?.textContent?.trim().toLowerCase() || 'active';
    map.set(id, {
      id,
      name,
      status: statusText.includes('completed') ? 'completed' : 'active'
    });
  });
  reportProjectList(window._currentUser?.projects).forEach(pid => {
    if (pid && !map.has(pid)) map.set(pid, { id: pid, name: formatProjectLabel(pid), status: 'assigned' });
  });
  return Array.from(map.values())
    .filter(p => p?.id)
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

function renderProjectAssignmentList(projects, note = '') {
  _projectCache = projects;
  const sel = $('assignProjectList');
  setText('assignProjectCount', projects.length ? `${projects.length} available` : 'No projects');
  if (!sel) return projects;
  if (projects.length) {
    sel.innerHTML = `${note ? `<p class="empty-hint">${escapeHtml(note)}</p>` : ''}${projectAssignmentRows(projects)}`;
  } else {
    sel.innerHTML = '<p class="empty-hint">No projects loaded. Go back to Hub, refresh projects, then open Project Access again.</p>';
  }
  return projects;
}

function fetchProjectsForAssignments() {
  return firebase.database().ref('projects').once('value')
    .then(snap => {
      const projects = [];
      snap.forEach(c => {
      projects.push({ id: c.key, ...c.val() });
    });
      projects.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      if (projects.length) {
        _projectCache = projects;
        return projects;
      }
      const fallbackProjects = collectProjectAssignmentFallbacks();
      _projectCache = fallbackProjects;
      return fallbackProjects;
    });
}

function loadProjectsForAssignments(renderList = true) {
  const sel = $('assignProjectList');
  if (renderList && sel) sel.innerHTML = '<p class="empty-hint">Loading projects...</p>';
  if (renderList) setText('assignProjectCount', 'Loading...');

  return fetchProjectsForAssignments()
    .then(projects => renderList ? renderProjectAssignmentList(projects) : projects)
    .catch(e => {
      console.error('loadProjectsForAssignments failed:', e);
      const fallbackProjects = collectProjectAssignmentFallbacks();
      _projectCache = fallbackProjects;
      if (!renderList) return fallbackProjects;
      if (fallbackProjects.length) {
        return renderProjectAssignmentList(fallbackProjects, 'Using projects already loaded in Hub.');
      }
      const message = e?.message || e?.code || 'permission denied';
      setText('assignProjectCount', 'Load failed');
      if (sel) sel.innerHTML = `<p class="empty-hint">Could not load projects: ${escapeHtml(message)}</p>`;
      return [];
    });
}

function requestStatusBadge(status) {
  const clean = String(status || 'pending').toLowerCase();
  if (clean === 'approved') return '<span class="badge badge-green">Approved</span>';
  if (clean === 'rejected') return '<span class="badge badge-red">Rejected</span>';
  return '<span class="badge badge-amber">Pending</span>';
}

function accessRequestName(request = {}) {
  return request.fullName || request.displayName || request.name || request.email || request.uid || 'User';
}

function accessRequestProjectRows(uid) {
  const projects = (_projectCache || [])
    .filter(p => p?.id)
    .filter(p => String(p.status || 'active').toLowerCase() === 'active');
  if (!projects.length) return '<p class="empty-hint">No active projects loaded. You can approve now and assign projects later from Team Admin.</p>';
  return projects.map(p => `
    <label class="assign-proj-row access-request-project-row">
      <input type="checkbox" data-access-project="1" data-request-uid="${escapeHtml(uid)}" value="${escapeHtml(p.id)}">
      <span>
        <span class="assign-proj-name">${escapeHtml(p.name || p.id)}</span>
        <span class="assign-proj-sub">${escapeHtml(p.status || 'active')}</span>
      </span>
    </label>
  `).join('') + '<p class="empty-hint access-request-note">Showing active projects only. Completed or archived projects can be assigned later from Team Admin.</p>';
}

function collectAccessRequestProjects(uid) {
  return Array.from(document.querySelectorAll('[data-access-project="1"]'))
    .filter(cb => cb.getAttribute('data-request-uid') === uid && cb.checked)
    .map(cb => cb.value)
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function projectAccessMap(projectIds = []) {
  return Array.from(new Set(projectIds.filter(Boolean).map(String)))
    .sort((a, b) => a.localeCompare(b))
    .reduce((map, pid) => {
      map[pid] = true;
      return map;
    }, {});
}

function initAccessRequests() {
  if (!(typeof isBoss === 'function' ? isBoss(window._currentUser?.role) : window._currentUser?.role === 'boss')) {
    const el = $('accessRequestList');
    if (el) el.innerHTML = '<p class="empty-hint">Access requests are available for admins only.</p>';
    return;
  }
  if (_accessRequestListener) {
    _accessRequestListener.off();
    _accessRequestListener = null;
  }
  const el = $('accessRequestList');
  if (el) el.innerHTML = '<p class="empty-hint">Loading access requests...</p>';
  const ref = firebase.database().ref('accessRequests').orderByChild('status').equalTo('pending');
  _accessRequestListener = ref;
  ref.on('value', snap => {
    const rows = [];
    snap.forEach(c => {
      rows.push({ id: c.key, uid: c.key, ...c.val() });
      return false;
    });
    rows.sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0));
    _accessRequestsCache = rows;
    loadProjectsForAssignments(false).catch(() => []).then(() => renderAccessRequests(rows));
  }, error => {
    console.error('initAccessRequests failed:', error);
    if (el) el.innerHTML = `<p class="empty-hint">Could not load access requests: ${escapeHtml(error?.message || error?.code || 'permission denied')}</p>`;
  });
}

function renderAccessRequests(rows = _accessRequestsCache) {
  const el = $('accessRequestList');
  if (!el) return;
  setText('accessRequestCount', rows.length);
  if (!rows.length) {
    el.innerHTML = '<p class="empty-hint">No pending account access requests.</p>';
    return;
  }
  el.innerHTML = `<div class="access-request-list">
    ${rows.map(request => {
      const uid = request.uid || request.id;
      const requestedAt = request.requestedAt ? new Date(request.requestedAt).toLocaleString('en-PH') : '-';
      return `<div class="access-request-card">
        <div class="access-request-main">
          <div class="access-request-title">${escapeHtml(accessRequestName(request))}</div>
          <div class="access-request-meta">${escapeHtml(request.email || '-')} | ${escapeHtml(request.position || '-')} | ${escapeHtml(request.provider || 'password')}</div>
          <div class="access-request-sub">Requested ${escapeHtml(requestedAt)}</div>
          <div class="access-request-projects">${accessRequestProjectRows(uid)}</div>
        </div>
        <div class="access-request-side">
          ${requestStatusBadge(request.status)}
          <label class="field-label" for="accessRole_${escapeHtml(uid)}">Role</label>
          <select id="accessRole_${escapeHtml(uid)}">${teamRoleOptions('apm')}</select>
          <div class="lifecycle-request-actions">
            <button class="btn-save-payroll" onclick='approveAccessRequest(${JSON.stringify(uid)})'>Approve</button>
            <button class="btn-mc" onclick='rejectAccessRequest(${JSON.stringify(uid)})'>Reject</button>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

async function approveAccessRequest(uid) {
  if (!(typeof isBoss === 'function' ? isBoss(window._currentUser?.role) : window._currentUser?.role === 'boss')) {
    showToast('You do not have permission to approve users.', 'error');
    return;
  }
  const request = _accessRequestsCache.find(r => (r.uid || r.id) === uid) ||
    (await firebase.database().ref(`accessRequests/${uid}`).once('value')).val();
  if (!request) {
    showToast('Access request not found.', 'error');
    return;
  }
  const role = normalizeTeamRole($(`accessRole_${uid}`)?.value || 'apm');
  const rc1Allowed = typeof isRc1ActiveRole === 'function'
    ? isRc1ActiveRole(role)
    : ['boss', 'owner', 'admin', 'pm', 'apm'].includes(role);
  if (!rc1Allowed) {
    showToast('Only Boss/Admin/PM/APM are active in RC1.', 'error');
    return;
  }
  const projects = collectAccessRequestProjects(uid);
  if (!projects.length && ['pm', 'apm'].includes(role) && !confirm('Approve without project assignment? The user can log in but may not see a project until assigned.')) return;

  const now = Date.now();
  const admin = window._currentUser || {};
  const historyKey = firebase.database().ref(`accessRequests/${uid}/statusHistory`).push().key;
  const userProfile = {
    uid,
    displayName: accessRequestName(request),
    name: accessRequestName(request),
    email: request.email || '',
    position: request.position || '',
    role,
    assignedProjects: projects,
    projects: projectAccessMap(projects),
    bossOf: {},
    status: 'active',
    provider: request.provider || '',
    approvedBy: admin.uid || null,
    approvedByName: admin.name || null,
    approvedAt: now,
    profileComplete: false,
    createdAt: request.requestedAt || now,
    updatedAt: now
  };
  const updates = {
    [`users/${uid}`]: userProfile,
    [`accessRequests/${uid}/status`]: 'approved',
    [`accessRequests/${uid}/role`]: role,
    [`accessRequests/${uid}/assignedProjects`]: projects,
    [`accessRequests/${uid}/approvedBy`]: admin.uid || null,
    [`accessRequests/${uid}/approvedByName`]: admin.name || null,
    [`accessRequests/${uid}/approvedAt`]: now,
    [`accessRequests/${uid}/updatedAt`]: now,
    [`accessRequests/${uid}/statusHistory/${historyKey}`]: {
      status: 'approved',
      by: admin.uid || null,
      byName: admin.name || null,
      at: now,
      role,
      assignedProjects: projects
    }
  };
  try {
    await firebase.database().ref().update(updates);
    auditLog('approve', 'accessRequest', uid, { role, assignedProjects: projects, email: request.email || '' });
    if (typeof createNotificationEvent === 'function') {
      createNotificationEvent({
        global: true,
        module: 'accounts',
        type: 'access_request_approved',
        payload: { uid, email: request.email || '', displayName: userProfile.displayName, role }
      }).catch(() => {});
    }
    if (typeof sendNotification === 'function') {
      sendNotification({ to: uid, type: 'access_approved', message: 'Your ACPM access was approved. Please complete your profile after login.' }).catch(() => {});
    }
    showToast(`${userProfile.displayName} approved.`);
    initAccessRequests();
    initTeamAdmin();
  } catch (e) {
    console.error('approveAccessRequest failed:', e);
    showToast(`Failed to approve request: ${e?.message || e?.code || 'permission denied'}`, 'error');
  }
}

async function rejectAccessRequest(uid) {
  if (!(typeof isBoss === 'function' ? isBoss(window._currentUser?.role) : window._currentUser?.role === 'boss')) {
    showToast('You do not have permission to reject users.', 'error');
    return;
  }
  const reason = prompt('Reason for rejection (optional):') || '';
  const now = Date.now();
  const admin = window._currentUser || {};
  const historyKey = firebase.database().ref(`accessRequests/${uid}/statusHistory`).push().key;
  try {
    await firebase.database().ref().update({
      [`accessRequests/${uid}/status`]: 'rejected',
      [`accessRequests/${uid}/rejectionReason`]: reason.trim(),
      [`accessRequests/${uid}/rejectedBy`]: admin.uid || null,
      [`accessRequests/${uid}/rejectedByName`]: admin.name || null,
      [`accessRequests/${uid}/rejectedAt`]: now,
      [`accessRequests/${uid}/updatedAt`]: now,
      [`accessRequests/${uid}/statusHistory/${historyKey}`]: {
        status: 'rejected',
        by: admin.uid || null,
        byName: admin.name || null,
        at: now,
        reason: reason.trim()
      }
    });
    auditLog('reject', 'accessRequest', uid, { reason: reason.trim() });
    if (typeof createNotificationEvent === 'function') {
      createNotificationEvent({
        global: true,
        module: 'accounts',
        type: 'access_request_rejected',
        payload: { uid, reason: reason.trim() }
      }).catch(() => {});
    }
    showToast('Access request rejected.');
    initAccessRequests();
  } catch (e) {
    console.error('rejectAccessRequest failed:', e);
    showToast(`Failed to reject request: ${e?.message || e?.code || 'permission denied'}`, 'error');
  }
}

function openProjectAssignModal(uid) {
  const user = _teamUsersCache.find(u => u.uid === uid);
  if (!user) return;
  const title = $('assignUserName');
  const holder = $('assignUserUid');
  const names = $('assignProjectNames');
  const status = $('assignProjectStatus');
  if (title) title.textContent = teamDisplayName(user);
  if (holder) {
    holder.dataset.uid = uid;
    holder.textContent = user.email || teamDisplayName(user);
    holder.title = uid;
  }
  const userProjects = reportProjectList(user.projects);
  if (names) names.textContent = userProjects.map(formatProjectLabel).join(', ') || 'None yet';
  if (status) status.textContent = reportRoleLabel(user.role);
  const modal = $('projectAssignModal');
  modal?.classList.remove('hidden');

  Promise.resolve(loadProjectsForAssignments()).then(() => {
    const picked = new Set(userProjects);
    document.querySelectorAll('#assignProjectList input[type=\"checkbox\"]').forEach(cb => {
      cb.checked = picked.has(cb.value);
    });
  });

}
function closeProjectAssignModal() {
  $('projectAssignModal')?.classList.add('hidden');
}

async function saveProjectAssignments() {
  if (!(typeof isBoss === 'function' ? isBoss(window._currentUser?.role) : window._currentUser?.role === 'boss')) {
    showToast('You do not have permission to manage users.', 'error');
    return;
  }
  const uid = $('assignUserUid')?.dataset.uid || $('assignUserUid')?.textContent;
  if (!uid) return;
  const user = _teamUsersCache.find(u => u.uid === uid);
  if (!user) return;
  const knownProjects = new Set(_projectCache.map(p => p.id));
  const checkedProjectIds = Array.from(document.querySelectorAll('#assignProjectList input[type="checkbox"]:checked'), cb => cb.value);
  const projects = Array.from(new Set(checkedProjectIds))
    .filter(pid => pid && knownProjects.has(pid))
    .sort((a, b) => String(a).localeCompare(String(b)));
  try {
    await firebase.database().ref(`users/${uid}`).update({
      assignedProjects: projects,
      projects: projectAccessMap(projects),
      status: 'active',
      approvedAt: Date.now(),
      approvedBy: window._currentUser?.uid || null,
      updatedAt: Date.now(),
      updatedBy: window._currentUser?.uid || null
    });
    auditLog('update', 'user', uid, { projects });
    if (window._currentUser && window._currentUser.uid === uid) {
      window._currentUser = { ...window._currentUser, projects, status: 'active' };
      if (typeof filterProjectsByRole === 'function') filterProjectsByRole();
      if (typeof renderHub === 'function') renderHub();
    }
    showToast(`${user.name || uid} project access updated`);
    closeProjectAssignModal();
    initTeamAdmin();
  } catch (e) {
    console.error('saveProjectAssignments failed:', e);
    showToast(`Failed to update project access: ${e?.message || e?.code || 'permission denied'}`, 'error');
  }
}

function switchAdminSection(section) {
  const sections = ['summary', 'team', 'requests', 'audit', 'system'];
  sections.forEach(name => {
    const panel = $(`adminSection_${name}`);
    const tab = $(`adminTab_${name}`);
    if (panel) panel.classList.toggle('hidden', name !== section);
    if (tab) tab.classList.toggle('tab-active', name === section);
  });
  if (section === 'team') initTeamAdmin();
  if (section === 'requests') {
    if (typeof initAccessRequests === 'function') initAccessRequests();
    if (typeof initLifecycleRequests === 'function') initLifecycleRequests();
  }
  if (section === 'audit' && typeof initAuditLog === 'function') initAuditLog();
  if (section === 'summary' && typeof initAdminSummary === 'function') initAdminSummary();
  if (section === 'system' && typeof initSystemStatus === 'function') initSystemStatus();
}

function refreshTeamAdmin() {
  const search = $('userSearch');
  if (search) search.value = '';
  initTeamAdmin();
}

function normalizeTeamRole(role) {
  return typeof normalizeRole === 'function'
    ? normalizeRole(role)
    : String(role || 'apm').trim().toLowerCase();
}

function teamRoleOptions(selectedRole) {
  const roles = [
    ['boss', 'Boss / Owner'],
    ['admin', 'Admin'],
    ['pm', 'Project Manager'],
    ['apm', 'Assoc. Project Manager']
  ];
  return roles.map(([value, label]) => `<option value="${value}" ${selectedRole === value ? 'selected' : ''}>${label}</option>`).join('');
}

function teamStatusBadge(user) {
  const status = String(user?.status || 'active').trim().toLowerCase();
  if (status === 'pending') return '<span class="badge badge-amber">Pending</span>';
  if (['disabled', 'suspended', 'archived'].includes(status)) return `<span class="badge badge-red">${escapeHtml(status.charAt(0).toUpperCase() + status.slice(1))}</span>`;
  return '<span class="badge badge-green">Active</span>';
}

function teamProfileBadge(user) {
  if (user?.profileComplete === false) return '<span class="badge badge-amber">Profile needed</span>';
  return '<span class="badge badge-green">Profile ready</span>';
}

function teamDisplayName(user = {}) {
  return user.displayName || user.name || user.fullName || user.email || user.uid || 'User';
}

function teamInitials(user = {}) {
  const name = teamDisplayName(user);
  const words = String(name).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const initials = words.slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('');
  return initials || 'U';
}

function teamAvatar(user = {}) {
  if (user.avatarUrl) {
    return `<span class="team-avatar"><img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(teamDisplayName(user))} profile photo"></span>`;
  }
  return `<span class="team-avatar team-avatar-fallback">${escapeHtml(teamInitials(user))}</span>`;
}

function teamLastSeen(user = {}) {
  const raw = user.lastSeenAt || user.lastLoginAt || user.profileUpdatedAt || user.approvedAt || user.createdAt || null;
  if (!raw) return 'No activity yet';
  if (typeof timeAgo === 'function') return `Seen ${timeAgo(raw)}`;
  return `Seen ${new Date(raw).toLocaleString('en-PH')}`;
}

async function updateUserRole(uid, role) {
  if (!(typeof isBoss === 'function' ? isBoss(window._currentUser?.role) : window._currentUser?.role === 'boss')) {
    showToast('You do not have permission to manage users.', 'error');
    return;
  }
  const nextRole = normalizeTeamRole(role);
  const rc1Allowed = typeof isRc1ActiveRole === 'function'
    ? isRc1ActiveRole(nextRole)
    : ['boss', 'owner', 'admin', 'pm', 'apm'].includes(nextRole);
  if (!rc1Allowed) {
    showToast('Foreman, Safety, and Viewer roles are deferred until the field-user security model is ready.', 'error');
    return;
  }
  const target = _teamUsersCache.find(u => u.uid === uid);
  if (!target) return;
  if (uid === window._currentUser?.uid && nextRole !== 'boss') {
    showToast('You cannot remove your own admin role from this screen.', 'error');
    return;
  }
  if (!confirm(`Set ${target.name || uid} role to ${reportRoleLabel(nextRole)}?`)) return;
  try {
    await firebase.database().ref(`users/${uid}`).update({
      role: nextRole,
      status: 'active',
      approvedAt: Date.now(),
      approvedBy: window._currentUser?.uid || null,
      updatedAt: Date.now(),
      updatedBy: window._currentUser?.uid || null
    });
    auditLog('update', 'user', uid, { role: nextRole });
    showToast(`${target.name || uid} set to ${reportRoleLabel(nextRole)}`);
    initTeamAdmin();
  } catch (e) {
    console.error('updateUserRole failed:', e);
    showToast(`Failed to update user role: ${e?.message || e?.code || 'permission denied'}`, 'error');
  }
}

async function updateUserStatus(uid, nextStatus) {
  if (!(typeof isBoss === 'function' ? isBoss(window._currentUser?.role) : window._currentUser?.role === 'boss')) {
    showToast('You do not have permission to manage users.', 'error');
    return;
  }
  const status = String(nextStatus || '').trim().toLowerCase();
  if (!['active', 'suspended', 'archived'].includes(status)) {
    showToast('Unsupported user status.', 'error');
    return;
  }
  const target = _teamUsersCache.find(u => u.uid === uid);
  if (!target) return;
  if (uid === window._currentUser?.uid && status !== 'active') {
    showToast('You cannot suspend or archive your own account from Team Admin.', 'error');
    return;
  }
  const label = status === 'active' ? 'reactivate' : status;
  if (!confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} ${teamDisplayName(target)}?`)) return;

  const now = Date.now();
  const admin = window._currentUser || {};
  const statusHistoryKey = firebase.database().ref(`users/${uid}/statusHistory`).push().key;
  const updates = {
    [`users/${uid}/status`]: status,
    [`users/${uid}/updatedAt`]: now,
    [`users/${uid}/updatedBy`]: admin.uid || null,
    [`users/${uid}/updatedByName`]: admin.name || null,
    [`users/${uid}/statusHistory/${statusHistoryKey}`]: {
      previousStatus: target.status || 'active',
      status,
      by: admin.uid || null,
      byName: admin.name || null,
      at: now
    }
  };
  if (status === 'active') {
    updates[`users/${uid}/reactivatedAt`] = now;
    updates[`users/${uid}/reactivatedBy`] = admin.uid || null;
    updates[`users/${uid}/suspendedAt`] = null;
    updates[`users/${uid}/archivedAt`] = null;
  } else if (status === 'suspended') {
    updates[`users/${uid}/suspendedAt`] = now;
    updates[`users/${uid}/suspendedBy`] = admin.uid || null;
  } else if (status === 'archived') {
    updates[`users/${uid}/archivedAt`] = now;
    updates[`users/${uid}/archivedBy`] = admin.uid || null;
  }

  try {
    await firebase.database().ref().update(updates);
    auditLog(status === 'active' ? 'reactivate' : status, 'user', uid, { previousStatus: target.status || 'active', status });
    if (typeof createNotificationEvent === 'function') {
      createNotificationEvent({
        global: true,
        module: 'accounts',
        type: `user_${status}`,
        payload: {
          recipientUserId: uid,
          uid,
          displayName: teamDisplayName(target),
          previousStatus: target.status || 'active',
          status
        }
      }).catch(() => {});
    }
    showToast(`${teamDisplayName(target)} is now ${status}.`);
    initTeamAdmin();
  } catch (e) {
    console.error('updateUserStatus failed:', e);
    showToast(`Failed to update user status: ${e?.message || e?.code || 'permission denied'}`, 'error');
  }
}

function filterTeamUsers(term) {
  const needle = String(term || '').trim().toLowerCase();
  document.querySelectorAll('[data-team-user-row]').forEach(row => {
    const hay = row.getAttribute('data-search') || '';
    row.style.display = !needle || hay.includes(needle) ? '' : 'none';
  });
}

function lifecycleRequestTypeLabel(type) {
  return type === 'reopen' ? 'Reopen project' : 'Complete project';
}

function initLifecycleRequests() {
  if (!(typeof isBoss === 'function' ? isBoss(window._currentUser?.role) : window._currentUser?.role === 'boss')) {
    const el = $('lifecycleRequestList');
    if (el) el.innerHTML = '<p class="empty-hint">Lifecycle requests are available for admins only.</p>';
    return;
  }
  if (_lifecycleRequestListener) {
    _lifecycleRequestListener.off();
    _lifecycleRequestListener = null;
  }
  const el = $('lifecycleRequestList');
  if (el) el.innerHTML = '<p class="empty-hint">Loading requests...</p>';

  const ref = firebase.database().ref('projects');
  _lifecycleRequestListener = ref;
  ref.on('value', snap => {
    const rows = [];
    snap.forEach(projectSnap => {
      const projectId = projectSnap.key;
      const project = projectSnap.val() || {};
      Object.entries(project.lifecycleRequests || {}).forEach(([requestId, request]) => {
        rows.push({
          projectId,
          requestId,
          projectName: project.name || projectId,
          currentProjectStatus: project.status || 'active',
          ...request
        });
      });
    });
    rows.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
    _lifecycleRequestsCache = rows;
    renderLifecycleRequests(rows);
  }, error => {
    console.error('initLifecycleRequests failed:', error);
    if (el) el.innerHTML = `<p class="empty-hint">Could not load requests: ${escapeHtml(error?.message || 'permission denied')}</p>`;
  });
}

function renderLifecycleRequests(rows = _lifecycleRequestsCache) {
  const el = $('lifecycleRequestList');
  if (!el) return;
  const filter = String($('lifecycleRequestFilter')?.value || 'pending').toLowerCase();
  const pendingCount = rows.filter(r => (r.status || 'pending') === 'pending').length;
  setText('lifecycleRequestCount', pendingCount);

  const visible = rows.filter(r => filter === 'all' ? true : (r.status || 'pending') === filter);
  if (!visible.length) {
    el.innerHTML = '<p class="empty-hint">No lifecycle requests found.</p>';
    return;
  }

  el.innerHTML = `<div class="lifecycle-request-list">
    ${visible.map(row => {
      const status = row.status || 'pending';
      const requestedBy = row.requestedByName || row.requestedBy || 'APM';
      const requestedAt = row.requestedAt ? timeAgo(row.requestedAt) : 'just now';
      const projectArg = JSON.stringify(row.projectId);
      const requestArg = JSON.stringify(row.requestId);
      const typeArg = JSON.stringify(row.type || 'complete');
      return `<div class="lifecycle-request-card">
        <div class="lifecycle-request-main">
          <div class="lifecycle-request-title">${escapeHtml(lifecycleRequestTypeLabel(row.type))}</div>
          <div class="lifecycle-request-meta">${escapeHtml(row.projectName)} | ${escapeHtml(requestedBy)} | ${escapeHtml(requestedAt)}</div>
          <div class="lifecycle-request-sub">Current status: ${escapeHtml(row.currentProjectStatus || '-')}</div>
        </div>
        <div class="lifecycle-request-side">
          <span class="badge ${status === 'pending' ? 'badge-amber' : status === 'approved' ? 'badge-green' : 'badge-red'}">${escapeHtml(status)}</span>
          ${status === 'pending' ? `<div class="lifecycle-request-actions">
            <button class="btn-save-payroll" onclick='approveLifecycleRequest(${projectArg}, ${requestArg}, ${typeArg})'>Approve</button>
            <button class="btn-mc" onclick='rejectLifecycleRequest(${projectArg}, ${requestArg}, ${typeArg})'>Reject</button>
          </div>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

async function approveLifecycleRequest(projectId, requestId, type) {
  if (!(typeof isBoss === 'function' ? isBoss(window._currentUser?.role) : window._currentUser?.role === 'boss')) {
    showToast('Admin access required.', 'error');
    return;
  }
  const snap = await firebase.database().ref(`projects/${projectId}`).once('value');
  const project = snap.val();
  const request = project?.lifecycleRequests?.[requestId];
  if (!project || !request) {
    showToast('Request not found.', 'error');
    return;
  }
  if ((request.status || 'pending') !== 'pending') {
    showToast('Request is already reviewed.', 'warn');
    return;
  }

  const isReopen = type === 'reopen';
  const nextStatus = isReopen ? 'active' : 'completed';
  const reviewer = window._currentUser || {};
  const updates = {
    [`projects/${projectId}/status`]: nextStatus,
    [`projects/${projectId}/lifecycleRequests/${requestId}/status`]: 'approved',
    [`projects/${projectId}/lifecycleRequests/${requestId}/reviewedAt`]: Date.now(),
    [`projects/${projectId}/lifecycleRequests/${requestId}/reviewedBy`]: reviewer.uid || null,
    [`projects/${projectId}/lifecycleRequests/${requestId}/reviewedByName`]: reviewer.name || null
  };
  if (isReopen) {
    updates[`projects/${projectId}/reopenedAt`] = Date.now();
    updates[`projects/${projectId}/reopenedBy`] = reviewer.uid || null;
    updates[`projects/${projectId}/reopenedByName`] = reviewer.name || null;
  } else {
    updates[`projects/${projectId}/completedAt`] = Date.now();
    updates[`projects/${projectId}/completedBy`] = reviewer.uid || null;
    updates[`projects/${projectId}/completedByName`] = reviewer.name || null;
  }

  await safeDb(() => firebase.database().ref().update(updates), 'Failed to approve request');
  auditLog('approve', 'project', projectId, { lifecycle: type, requestId });
  if (request.requestedBy && typeof sendNotification === 'function') {
    await sendNotification({
      to: request.requestedBy,
      type: 'alert',
      projectId,
      projectName: project.name || projectId,
      message: `Your request to ${isReopen ? 'reopen' : 'complete'} ${project.name || 'the project'} was approved.`
    }).catch(() => {});
  }
  showToast('Lifecycle request approved.');
}

async function rejectLifecycleRequest(projectId, requestId, type) {
  if (!(typeof isBoss === 'function' ? isBoss(window._currentUser?.role) : window._currentUser?.role === 'boss')) {
    showToast('Admin access required.', 'error');
    return;
  }
  if (!confirm('Reject this lifecycle request?')) return;
  const snap = await firebase.database().ref(`projects/${projectId}`).once('value');
  const project = snap.val();
  const request = project?.lifecycleRequests?.[requestId];
  if (!project || !request) {
    showToast('Request not found.', 'error');
    return;
  }
  const reviewer = window._currentUser || {};
  await safeDb(() => firebase.database().ref(`projects/${projectId}/lifecycleRequests/${requestId}`).update({
    status: 'rejected',
    reviewedAt: Date.now(),
    reviewedBy: reviewer.uid || null,
    reviewedByName: reviewer.name || null
  }), 'Failed to reject request');
  auditLog('reject', 'project', projectId, { lifecycle: type, requestId });
  if (request.requestedBy && typeof sendNotification === 'function') {
    await sendNotification({
      to: request.requestedBy,
      type: 'alert',
      projectId,
      projectName: project.name || projectId,
      message: `Your request to ${type === 'reopen' ? 'reopen' : 'complete'} ${project.name || 'the project'} was rejected.`
    }).catch(() => {});
  }
  showToast('Lifecycle request rejected.');
}
function renderTeamAdmin(users) {
  const el = $('teamAdminList');
  if (!el) return;
  const counts = {
    boss: users.filter(u => {
      const role = normalizeTeamRole(u.role);
      return (typeof isBoss === 'function' ? isBoss(role) : role === 'boss') || role === 'pm';
    }).length,
    apm: users.filter(u => normalizeTeamRole(u.role) === 'apm').length,
  };
  setText('teamUserCount', users.length);
  setText('teamBossCount', counts.boss);
  setText('teamApmCount', counts.apm);

  if (!users.length) {
    el.innerHTML = '<p class="empty-hint">No users found.</p>';
    return;
  }

  el.innerHTML = `<div style="overflow-x:auto"><table class="summary-table">
    <thead><tr>
      <th>Team Member</th><th>Status</th><th>Role / Projects</th><th>Admin Action</th>
    </tr></thead>
    <tbody>
      ${users.map(user => {
        const role = normalizeTeamRole(user.role);
        const projects = reportProjectList(user.projects);
        const bossOf = reportProjectList(user.bossOf);
        const projectNames = projects.map(formatProjectLabel);
        const projectCount = projectNames.length;
        const projectPreview = projectNames.slice(0, 2).join(', ');
        const status = String(user.status || 'active').toLowerCase();
        const name = teamDisplayName(user);
        const search = [name, user.position, user.email, user.uid, role, status, ...projectNames, ...bossOf.map(formatProjectLabel)].join(' ').toLowerCase();
        return `<tr data-team-user-row data-search="${escapeHtml(search)}">
          <td>
            <div class="team-user-cell">
              ${teamAvatar(user)}
              <div class="team-user-copy">
                <strong>${escapeHtml(name)}</strong>
                <span>${escapeHtml(user.position || 'No position set')}</span>
                <small>${escapeHtml(user.email || 'No email')} | ${escapeHtml(teamLastSeen(user))}</small>
              </div>
            </div>
          </td>
          <td>
            <div class="team-status-stack">
              ${teamStatusBadge(user)}
              ${teamProfileBadge(user)}
            </div>
          </td>
          <td>
            <div style="display:flex;flex-direction:column;gap:10px;min-width:220px">
              <select onchange="updateUserRole('${user.uid}', this.value)" ${user.uid === window._currentUser?.uid ? 'data-self-role="1"' : ''}>
                ${teamRoleOptions(role)}
              </select>
              <div class="team-project-line">
                <span class="team-project-pill">${projectCount ? `${projectCount} project${projectCount === 1 ? '' : 's'}` : 'No projects'}</span>
                <span class="team-project-preview">${escapeHtml(projectPreview || 'Nothing assigned yet')}</span>
                <button class="btn-ws-secondary team-project-btn" onclick="openProjectAssignModal('${user.uid}')">Edit projects</button>
              </div>
            </div>
          </td>
          <td>
            <div class="team-action-stack">
              ${status === 'active'
                ? `<button class="btn-ws-secondary team-status-btn" onclick="updateUserStatus('${user.uid}', 'suspended')">Suspend</button>`
                : `<button class="btn-save-payroll team-status-btn" onclick="updateUserStatus('${user.uid}', 'active')">Reactivate</button>`}
              ${status !== 'archived'
                ? `<button class="btn-mc team-status-btn" onclick="updateUserStatus('${user.uid}', 'archived')">Archive</button>`
                : '<span class="empty-hint">Historical profile</span>'}
            </div>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
  filterTeamUsers($('userSearch')?.value || '');
}

function detachReportsListeners() {
  _reportsListeners.forEach(ref => ref.off());
  _reportsListeners = [];
  if (_teamAdminListener) {
    _teamAdminListener.off();
    _teamAdminListener = null;
  }
  if (_auditListener) {
    _auditListener.off();
    _auditListener = null;
  }
  detachAuditFallbackListeners();
  if (_lifecycleRequestListener) {
    _lifecycleRequestListener.off();
    _lifecycleRequestListener = null;
  }
  if (_accessRequestListener) {
    _accessRequestListener.off();
    _accessRequestListener = null;
  }
}

function reportListenerDiagnostics() {
  return {
    reports: _reportsListeners.length,
    teamAdmin: _teamAdminListener ? 1 : 0,
    audit: _auditListener ? 1 : 0,
    auditFallback: _auditFallbackListeners.length,
    lifecycleRequests: _lifecycleRequestListener ? 1 : 0,
    accessRequests: _accessRequestListener ? 1 : 0
  };
}
// -----------------------------------------------------------------------------
function renderExecutiveDashboard() {
  const user = window._currentUser;
  if (!user || !(typeof isBoss === 'function' ? isBoss(user.role) : user.role === 'boss')) {
    const el = $('executiveDashboard');
    if (el) el.innerHTML = '<p class="empty-hint">Executive dashboard available for admins only.</p>';
    return;
  }

  const ref = firebase.database().ref('projects');
  _reportsListeners.push(ref);
  ref.on('value', snap => {
    const projects = [];
    snap.forEach(c => {
      projects.push({ id: c.key, ...c.val() });
    });
    _systemReportsProjectsCache = projects;
    syncSystemReportPeriodOptions(projects);
    renderSystemReportsFromCache();
  });
}

function reportProjectDateValue(project = {}) {
  const raw = project.completedAt || project.archivedAt || project.updatedAt || project.createdAt || project.createdDate || project.startDate || project.dateStarted;
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reportProjectPeriodKeys(project = {}) {
  const ts = reportProjectDateValue(project);
  if (!ts) return [];
  const date = new Date(ts);
  const year = date.getFullYear();
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return [`${year}`, `${year}-Q${quarter}`];
}

function systemReportPeriodLabel(key) {
  if (key === 'all') return 'All Periods';
  const match = String(key).match(/^(\d{4})-Q([1-4])$/);
  if (match) return `Q${match[2]} ${match[1]}`;
  return String(key);
}

function syncSystemReportPeriodOptions(projects = []) {
  const select = $('systemReportPeriodFilter');
  if (!select) return;
  const previous = select.value || 'all';
  const keys = new Set();
  projects.forEach(project => reportProjectPeriodKeys(project).forEach(key => keys.add(key)));
  const sorted = Array.from(keys).sort((a, b) => b.localeCompare(a));
  select.innerHTML = `<option value="all">All Periods</option>${sorted.map(key => `<option value="${escapeHtml(key)}">${escapeHtml(systemReportPeriodLabel(key))}</option>`).join('')}`;
  select.value = sorted.includes(previous) || previous === 'all' ? previous : 'all';
}

function filteredSystemReportProjects(projects = _systemReportsProjectsCache) {
  const status = $('systemReportStatusFilter')?.value || 'active';
  const period = $('systemReportPeriodFilter')?.value || 'all';
  return projects.filter(project => {
    const projectStatus = String(project.status || 'active').toLowerCase();
    const statusOk = status === 'all'
      ? projectStatus !== 'archived'
      : projectStatus === status;
    const periodOk = period === 'all' || reportProjectPeriodKeys(project).includes(period);
    return statusOk && periodOk;
  });
}

function renderSystemReportsFromCache() {
    const projects = filteredSystemReportProjects();
    const allProjects = _systemReportsProjectsCache || [];
    const status = $('systemReportStatusFilter')?.value || 'active';
    const period = $('systemReportPeriodFilter')?.value || 'all';
    const statusLabel = status === 'all' ? 'All non-archived projects' : status === 'active' ? 'Active projects' : `${status.charAt(0).toUpperCase()}${status.slice(1)} projects`;
    const periodLabel = systemReportPeriodLabel(period).toLowerCase();
    setText('systemReportFilterNote', `${statusLabel}, ${periodLabel}. ${projects.length} shown / ${allProjects.length} total records.`);
    setText('execProjectCountLabel', status === 'active' ? 'Active Projects' : 'Projects in View');

    const healthData = projects.map(p => ({
      ...p,
      summary: reportSummaryForProject(p),
      health: calculateProjectHealth(p)
    })).sort((a, b) => b.health.score - a.health.score);

    const container = $('execProjectHealth');
    if (container) {
      container.innerHTML = healthData.length ? healthData.map(p => {
        const h = p.health;
        const color = h.score >= 80 ? 'var(--green)' : h.score >= 60 ? 'var(--amber)' : 'var(--red)';
        return `
          <div class="health-card" style="border-left-color:${color}">
            <div class="health-hdr">
              <span class="health-name">${escapeHtml(p.name || 'Untitled')}</span>
              <span class="health-score" style="color:${color}">${h.score}</span>
            </div>
            <div class="health-bars">
              <div class="health-bar-wrap"><span>Budget</span><div class="health-bar"><div style="width:${h.budgetPct}%;background:${color}"></div></div><span>${h.budgetPct}%</span></div>
              <div class="health-bar-wrap"><span>Schedule</span><div class="health-bar"><div style="width:${h.schedulePct}%;background:${color}"></div></div><span>${h.schedulePct}%</span></div>
              <div class="health-bar-wrap"><span>Labor</span><div class="health-bar"><div style="width:${h.laborPct}%;background:${color}"></div></div><span>${h.laborPct}%</span></div>
            </div>
            ${h.warnings.length ? `<div class="health-warn">${h.warnings.map(w => `\u26A0 ${w}`).join('<br>')}</div>` : '<div class="health-ok">\u2713 All clear</div>'}
          </div>
        `;
      }).join('') : '<p class="empty-hint">No projects match this report filter.</p>';
    }

    const summaries = healthData.map(p => p.summary || reportSummaryForProject(p));
    const totalBudget = summaries.reduce((s, p) => s + reportAmount(p.totalBudget), 0);
    const totalSpent = summaries.reduce((s, p) => s + reportAmount(p.totalCost), 0);
    const laborBudgetTotal = summaries.reduce((s, p) => s + reportAmount(p.laborBudget), 0);
    const materialBudgetTotal = summaries.reduce((s, p) => s + reportAmount(p.materialBudget), 0);
    const remaining = Math.max(0, totalBudget - totalSpent);
    const spentPct = totalBudget ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;
    const avgHealth = healthData.length ? Math.round(healthData.reduce((s, p) => s + p.health.score, 0) / healthData.length) : 0;
    setText('execActiveProjects', projects.length);
    setText('execTotalBudget', peso(totalBudget));
    setText('execTotalSpent', peso(totalSpent));
    setText('execAvgHealth', avgHealth + '%');

    const healthEl = $('execAvgHealth');
    if (healthEl) {
      healthEl.style.color = avgHealth >= 80 ? 'var(--green)' : avgHealth >= 60 ? 'var(--amber)' : 'var(--red)';
    }


    const chart = $('execBudgetChart');
    const legend = $('execBudgetLegend');
    if (chart) {
      chart.style.background = 'conic-gradient(var(--purple) 0 ' + (spentPct * 0.6) + '%, var(--blue) ' + (spentPct * 0.6) + '% ' + Math.min(100, spentPct * 0.85) + '%, var(--green) ' + Math.min(100, spentPct * 0.85) + '% ' + spentPct + '%, var(--amber) ' + spentPct + '% 100%)';
    }
    if (legend) {
      legend.innerHTML = '<div class="exec-legend-row"><span><i class="exec-legend-swatch" style="background:var(--purple)"></i>Spent</span><strong>' + peso(totalSpent) + '</strong></div>' +
        '<div class="exec-legend-row"><span><i class="exec-legend-swatch" style="background:var(--blue)"></i>Labor Budget</span><strong>' + peso(laborBudgetTotal) + '</strong></div>' +
        '<div class="exec-legend-row"><span><i class="exec-legend-swatch" style="background:var(--green)"></i>Material Budget</span><strong>' + peso(materialBudgetTotal) + '</strong></div>' +
        '<div class="exec-legend-row"><span><i class="exec-legend-swatch" style="background:var(--amber)"></i>Remaining</span><strong>' + peso(remaining) + '</strong></div>';
    }
}

// -----------------------------------------------------------------------------
//  PROJECT HEALTH ALGORITHM
// -----------------------------------------------------------------------------
function calculateProjectHealth(p) {
  const summary = reportSummaryForProject(p);
  const totalSpent = reportAmount(summary.totalCost);
  const budgetPct = summary.totalBudget ? Math.round((totalSpent / summary.totalBudget) * 100) : 0;

  // Budget health (lower is better, but 0% is also bad = no activity)
  let budgetScore = 100;
  if (budgetPct > 95) budgetScore = 30;
  else if (budgetPct > 85) budgetScore = 60;
  else if (budgetPct > 70) budgetScore = 80;
  else if (budgetPct < 5) budgetScore = 50; // No activity yet

  // Schedule health (based on contract dates)
  let scheduleScore = 100;
  const warnings = [];
  if (p.contract?.endDate) {
    const end = new Date(p.contract.endDate);
    const now = new Date();
    const daysLeft = Math.ceil((end - now) / 86400000);
    const start = p.contract.startDate ? new Date(p.contract.startDate) : now;
    const totalDays = Math.max(1, (end - start) / 86400000);
    const elapsedPct = Math.min(100, ((now - start) / (end - start)) * 100);

    if (daysLeft < 0) {
      scheduleScore = 20;
      warnings.push(`Overdue by ${Math.abs(daysLeft)} days`);
    } else if (daysLeft < 14) {
      scheduleScore = 50;
      warnings.push(`${daysLeft} days remaining`);
    } else if (elapsedPct > 80 && budgetPct < 60) {
      scheduleScore = 60;
      warnings.push('Behind schedule');
    }
  }

  // Labor health
  let laborScore = 100;
  const laborBudget = reportAmount(summary.laborBudget);
  if (laborBudget) {
    const laborPct = Math.round((reportAmount(summary.laborCost) / laborBudget) * 100);
    if (laborPct > 95) { laborScore = 40; warnings.push('Labor budget critical'); }
    else if (laborPct > 85) { laborScore = 65; warnings.push('Labor budget warning'); }
  }

  // Overall score (weighted)
  const score = Math.round((budgetScore * 0.4) + (scheduleScore * 0.35) + (laborScore * 0.25));

  return {
    score,
    budgetPct,
    schedulePct: scheduleScore,
    laborPct: laborScore,
    warnings: warnings.slice(0, 3)
  };
}

// -----------------------------------------------------------------------------
//  TEAM PERFORMANCE
// -----------------------------------------------------------------------------
function renderTeamPerformance() {
  const ref = firebase.database().ref('projects');
  _reportsListeners.push(ref);
  ref.on('value', snap => {
    const el = $('teamPerformance');
    if (!el) return;

    // Aggregate worker data across projects
    const workerStats = {};
    snap.forEach(proj => {
      const pid = proj.key;
      const p = proj.val();
      if (p.workers) {
        Object.entries(p.workers).forEach(([wid, w]) => {
          if (!workerStats[w.name]) {
            workerStats[w.name] = { name: w.name, trade: w.trade, projects: [], totalDays: 0, totalPay: 0 };
          }
          workerStats[w.name].projects.push(p.name || pid);
        });
      }
      // Count attendance
      if (p.attendance) {
        Object.entries(p.attendance).forEach(([wid, days]) => {
          // Find worker name
          let wname = wid;
          if (p.workers && p.workers[wid]) wname = p.workers[wid].name;
          if (!workerStats[wname]) {
            workerStats[wname] = { name: wname, trade: 'Unknown', projects: [], totalDays: 0, totalPay: 0 };
          }
          Object.values(days).forEach(d => {
            if (d.status !== 'absent' && d.status !== 'rest') {
              workerStats[wname].totalDays += (d.status === 'half' ? 0.5 : 1);
            }
          });
        });
      }
    });

    const workers = Object.values(workerStats).sort((a, b) => b.totalDays - a.totalDays);

    if (!workers.length) {
      el.innerHTML = '<p class="empty-hint">No worker data yet.</p>';
      return;
    }

    const activeWorkers = workers.filter(w => w.totalDays > 0).length;
    const tradeCount = new Set(workers.map(w => w.trade).filter(Boolean)).size;
    const totalDays = workers.reduce((sum, w) => sum + reportAmount(w.totalDays), 0);
    const topWorker = workers[0];

    el.innerHTML = `
    <div class="team-performance-summary">
      <div><span>Total Workers</span><strong>${workers.length}</strong></div>
      <div><span>Active Workers</span><strong>${activeWorkers}</strong></div>
      <div><span>Trades</span><strong>${tradeCount}</strong></div>
      <div><span>Total Days</span><strong>${totalDays}</strong></div>
      <div><span>Most Active</span><strong>${escapeHtml(topWorker?.name || '-')}</strong></div>
    </div>
    <div class="team-performance-table">
      <table class="summary-table">
        <thead><tr>
          <th>Worker</th><th>Trade</th><th style="text-align:center">Projects</th>
          <th style="text-align:center">Days Worked</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${workers.map(w => `
            <tr class="s-row">
              <td class="s-cell s-bold">${escapeHtml(w.name)}</td>
              <td class="s-cell s-trade">${escapeHtml(w.trade)}</td>
              <td class="s-cell s-center">${w.projects.length}</td>
              <td class="s-cell s-center">${w.totalDays}</td>
              <td class="s-cell">${w.totalDays > 20 ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-amber">Light</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
  });
}

// -----------------------------------------------------------------------------
//  BUDGET VARIANCE ANALYSIS
// -----------------------------------------------------------------------------
function renderBudgetVariance() {
  const ref = firebase.database().ref('projects');
  _reportsListeners.push(ref);
  ref.on('value', snap => {
    const el = $('budgetVariance');
    if (!el) return;

    const rows = [];
    snap.forEach(c => {
      const p = c.val();
      const summary = reportSummaryForProject({ id: c.key, ...p });
      const laborSpent = reportAmount(summary.laborCost);
      const matSpent = reportAmount(summary.materialCost);
      const totalSpent = reportAmount(summary.totalCost);
      const laborVar = reportAmount(summary.laborBudget) - laborSpent;
      const matVar = reportAmount(summary.materialBudget) - matSpent;
      const totalVar = reportAmount(summary.totalBudget) - totalSpent;

      rows.push({
        name: p.name || 'Untitled',
        laborBudget: reportAmount(summary.laborBudget), laborSpent, laborVar,
        matBudget: reportAmount(summary.materialBudget), matSpent, matVar,
        totalBudget: reportAmount(summary.totalBudget), totalSpent, totalVar
      });
    });

    if (!rows.length) {
      el.innerHTML = '<p class="empty-hint">No project data.</p>';
      return;
    }

    const overBudget = rows.filter(r => r.totalVar < 0).length;
    const totalVariance = rows.reduce((sum, r) => sum + reportAmount(r.totalVar), 0);
    const laborVariance = rows.reduce((sum, r) => sum + reportAmount(r.laborVar), 0);
    const materialVariance = rows.reduce((sum, r) => sum + reportAmount(r.matVar), 0);

    el.innerHTML = `
    <div class="budget-variance-summary">
      <div><span>Projects</span><strong>${rows.length}</strong></div>
      <div><span>Over Budget</span><strong class="${overBudget ? 'text-red' : 'text-green'}">${overBudget}</strong></div>
      <div><span>Total Variance</span><strong class="${totalVariance < 0 ? 'text-red' : 'text-green'}">${peso(totalVariance)}</strong></div>
      <div><span>Labor Variance</span><strong class="${laborVariance < 0 ? 'text-red' : 'text-green'}">${peso(laborVariance)}</strong></div>
      <div><span>Material Variance</span><strong class="${materialVariance < 0 ? 'text-red' : 'text-green'}">${peso(materialVariance)}</strong></div>
    </div>
    <div class="budget-variance-table">
      <table class="summary-table">
        <thead><tr>
          <th>Project</th>
          <th style="text-align:right">Labor Budget</th><th style="text-align:right">Spent</th><th style="text-align:right">Variance</th>
          <th style="text-align:right">Mat Budget</th><th style="text-align:right">Spent</th><th style="text-align:right">Variance</th>
          <th style="text-align:right">Total Var</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr class="s-row">
              <td class="s-cell s-bold">${escapeHtml(r.name)}</td>
              <td class="s-cell s-right">${peso(r.laborBudget)}</td>
              <td class="s-cell s-right">${peso(r.laborSpent)}</td>
              <td class="s-cell s-right ${r.laborVar < 0 ? 'text-red' : 'text-green'}">${peso(r.laborVar)}</td>
              <td class="s-cell s-right">${peso(r.matBudget)}</td>
              <td class="s-cell s-right">${peso(r.matSpent)}</td>
              <td class="s-cell s-right ${r.matVar < 0 ? 'text-red' : 'text-green'}">${peso(r.matVar)}</td>
              <td class="s-cell s-right s-bold ${r.totalVar < 0 ? 'text-red' : 'text-green'}">${peso(r.totalVar)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
  });
}

// -----------------------------------------------------------------------------
//  WEEKLY REPORT GENERATOR
// -----------------------------------------------------------------------------
async function generateWeeklyReport() {
  const user = window._currentUser;
  if (!user) return;
  if (!reportCurrentUserIsBoss()) {
    showToast('Reports available for admins only.', 'error');
    return;
  }

  const snap = await firebase.database().ref('projects').once('value');
  const projects = [];
  snap.forEach(c => {
      projects.push({ id: c.key, ...c.val() });
    });

  // Filter for APM's projects
  const myProjects = (typeof isBoss === 'function' ? isBoss(user.role) : user.role === 'boss')
    ? projects
    : projects.filter(p => reportProjectList(user.projects).includes(p.id));

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStr = weekStart.toLocaleDateString('en-PH');

  let report = `WEEKLY PROJECT REPORT\\nGenerated: ${new Date().toLocaleDateString('en-PH')}\\nReporter: ${user.name} (${reportRoleLabel(user.role)})\\n${'='.repeat(60)}\\n\\n`;

  myProjects.forEach(p => {
    const summary = reportSummaryForProject(p);
    const health = calculateProjectHealth(p);

    report += `PROJECT: ${p.name || 'Untitled'}\\n`;
    report += `Status: ${p.status || 'active'} | Health: ${health.score}/100\\n`;
    report += `Budget: ${peso(summary.totalCost)} / ${peso(summary.totalBudget)} (${pct(summary.totalCost, summary.totalBudget)}%)\\n`;
    if (health.warnings.length) {
      report += `Alerts: ${health.warnings.join(', ')}\\n`;
    }
    report += `\\n`;
  });

  downloadTextFile(`WeeklyReport_${todayISO()}.txt`, report, 'text/plain');
  showToast('Weekly report generated!');
}

// -----------------------------------------------------------------------------
window.initReports = initReports;
window.renderProjectReports = renderProjectReports;
window.renderSystemReportsFromCache = renderSystemReportsFromCache;
window.exportCurrentProjectReport = exportCurrentProjectReport;
window.printCurrentProjectReport = printCurrentProjectReport;
window.openSystemReports = openSystemReports;
window.closeSystemReports = closeSystemReports;
window.ensureSystemReportsView = ensureSystemReportsView;
window.initTeamAdmin = initTeamAdmin;
window.switchAdminSection = switchAdminSection;
window.initAdminSummary = initAdminSummary;
window.initAuditLog = initAuditLog;
window.renderAuditLog = renderAuditLog;
window.initLifecycleRequests = initLifecycleRequests;
window.renderLifecycleRequests = renderLifecycleRequests;
window.approveLifecycleRequest = approveLifecycleRequest;
window.rejectLifecycleRequest = rejectLifecycleRequest;
window.initAccessRequests = initAccessRequests;
window.renderAccessRequests = renderAccessRequests;
window.approveAccessRequest = approveAccessRequest;
window.rejectAccessRequest = rejectAccessRequest;
window.initSystemStatus = initSystemStatus;
window.openProjectAssignModal = openProjectAssignModal;
window.closeProjectAssignModal = closeProjectAssignModal;
window.saveProjectAssignments = saveProjectAssignments;
window.refreshTeamAdmin = refreshTeamAdmin;
window.filterTeamUsers = filterTeamUsers;
window.updateUserRole = updateUserRole;
window.updateUserStatus = updateUserStatus;
window.detachReportsListeners = detachReportsListeners;
window.reportListenerDiagnostics = reportListenerDiagnostics;
window.rebuildProjectReportRollup = rebuildProjectReportRollup;
window.rebuildWeeklyReportRollup = rebuildWeeklyReportRollup;
window.rebuildMonthlyReportRollup = rebuildMonthlyReportRollup;
window.listProjectReportRollups = listProjectReportRollups;
window.generateReportSnapshot = generateReportSnapshot;
window.calculateLaborSummary = calculateLaborSummary;
window.calculateMaterialsSummary = calculateMaterialsSummary;
window.calculateBillingSummary = calculateBillingSummary;
window.calculateChangeOrderSummary = calculateChangeOrderSummary;
window.calculateSiteLogSummary = calculateSiteLogSummary;
window.calculateCashFlow = calculateCashFlow;
window.calculateProfitAnalysis = calculateProfitAnalysis;
window.exportReport = exportReport;
window.calculateProjectHealth = calculateProjectHealth;
window.generateWeeklyReport = generateWeeklyReport;
