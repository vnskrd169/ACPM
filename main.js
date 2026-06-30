//  ACPM — main.js (Enhanced v3.0)
//  Firebase v8 compat init, Hub, Workspace lifecycle,
//  Offline cache, Data compression, Health scores
// ════════════════════════════════════════════════════════════

// ── Firebase Config (v8 compat) ─────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA",
  authDomain: "acpm-project-system.firebaseapp.com",
  databaseURL: "https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "acpm-project-system",
  storageBucket: "acpm-project-system.firebasestorage.app",
  messagingSenderId: "330800177544",
  appId: "1:330800177544:web:8f29dcd81ca39976849a3d"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
window._db = db;

// ── Globals ───────────────────────────────────────────────
window._currentPid = null;
let _hubListeners = [];
let _projectNotesListener = null;
window._isReadOnly = false;
window._currentProjectStatus = null;
// Overwritten by auth.js once Firebase Auth resolves — this is only
// a pre-auth fallback so other modules don't crash on null access.
window._currentUser = { uid: 'anonymous', role: 'apm', name: 'System', projects: [], bossOf: [] };
window._allowedProjects = null;

function getAppPage() {
  if (window.ACPM_PAGE) return String(window.ACPM_PAGE).toLowerCase();
  const path = window.location.pathname.toLowerCase();
  if (path.endsWith('/login.html')) return 'login';
  if (path.endsWith('/dashboard.html')) return 'dashboard';
  if (path.endsWith('/workspace.html')) return 'workspace';
  return 'app';
}

function appUrl(page, params = {}) {
  if (page === 'login') return 'login.html';
  if (page === 'workspace') {
    const pid = encodeURIComponent(params.projectId || '');
    return pid ? `workspace.html?projectId=${pid}` : 'workspace.html';
  }
  return 'dashboard.html';
}

function getRouteProjectId() {
  return new URLSearchParams(window.location.search).get('projectId') || '';
}

// ════════════════════════════════════════════════════════════
//  Offline Cache Layer (IndexedDB)
//  Stores project data locally for instant load + offline work
// ════════════════════════════════════════════════════════════
const DB_NAME = 'acpm_offline';
const DB_VERSION = 1;
let _idb = null;

function initOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { _idb = req.result; resolve(_idb); };
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

async function cacheProject(id, data) {
  if (!_idb) return;
  const tx = _idb.transaction('projects', 'readwrite');
  const store = tx.objectStore('projects');
  await store.put({ id, data, cachedAt: Date.now() });
}

async function getCachedProject(id) {
  if (!_idb) return null;
  return new Promise((resolve) => {
    const tx = _idb.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result?.data || null);
    req.onerror = () => resolve(null);
  });
}

async function queueOfflineWrite(path, data) {
  if (!_idb) return;
  const tx = _idb.transaction('syncQueue', 'readwrite');
  const store = tx.objectStore('syncQueue');
  await store.put({ path, data, timestamp: Date.now() });
}

// ════════════════════════════════════════════════════════════
//  Effective-budget helper (unchanged)
// ════════════════════════════════════════════════════════════
function effectiveBudget(p) {
  const laborBase = parseFloat(p.laborBudget) || 0;
  const matBase = parseFloat(p.materialBudget) || 0;
  const laborDelta = parseFloat(p.laborBudgetDelta) || 0;
  const matDelta = parseFloat(p.materialBudgetDelta) || 0;
  return {
    labor: laborBase + laborDelta,
    material: matBase + matDelta,
    total: laborBase + matBase + laborDelta + matDelta
  };
}

function dashboardRollup(p) {
  return p?.reportRollups?.projectSummary || p?.billingRollups || {};
}

function dashboardLaborSpent(p) {
  const rollup = dashboardRollup(p);
  return parseFloat(rollup.laborCost ?? p.laborSpent) || 0;
}

function dashboardMaterialSpent(p) {
  const rollup = dashboardRollup(p);
  return parseFloat(rollup.materialCost ?? p.materialSpent) || 0;
}

function dashboardOtherSpent(p) {
  const rollup = dashboardRollup(p);
  return parseFloat(rollup.otherCost ?? p.otherSpent) || 0;
}

function dashboardTotalSpent(p) {
  const rollup = dashboardRollup(p);
  return parseFloat(rollup.totalCost ?? NaN) || (dashboardLaborSpent(p) + dashboardMaterialSpent(p) + dashboardOtherSpent(p));
}

function dashboardPendingApprovalItems(projects = []) {
  const items = [];
  projects.forEach(p => {
    Object.entries(p.lifecycleRequests || {}).forEach(([id, req]) => {
      if (String(req.status || 'pending').toLowerCase() === 'pending') {
        items.push({
          id,
          projectId: p.id,
          projectName: p.name || p.id,
          label: req.type === 'reopen' ? 'Reopen request' : req.type === 'complete' ? 'Completion request' : 'Lifecycle request',
          type: req.type || 'lifecycle_request',
          createdAt: parseFloat(req.requestedAt || req.createdAt) || 0
        });
      }
    });
    Object.entries(p.notificationEvents || {}).forEach(([id, event]) => {
      if (String(event.status || 'pending').toLowerCase() === 'pending' && event.consumed !== true) {
        items.push({
          id,
          projectId: p.id,
          projectName: p.name || p.id,
          label: String(event.type || 'Notification').replace(/_/g, ' '),
          type: event.type || 'notification_event',
          module: event.module || '',
          createdAt: parseFloat(event.createdAt) || 0
        });
      }
    });
  });
  return items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function dashboardRecentItems(projects = []) {
  const items = [];
  projects.forEach(p => {
    const projectName = p.name || p.id;
    const projectStatus = p.status === 'completed' ? 'Completed' : p.status === 'archived' ? 'Archived' : 'Active';
    items.push({
      projectId: p.id,
      projectName,
      label: projectStatus,
      createdAt: p.completedAt || p.archivedAt || p.updatedAt || p.createdAt || 0
    });
    Object.entries(p.notificationEvents || {}).forEach(([id, event]) => {
      items.push({
        id,
        projectId: p.id,
        projectName,
        label: String(event.type || event.module || 'Project event').replace(/_/g, ' '),
        createdAt: parseFloat(event.createdAt) || 0
      });
    });
  });
  return items
    .filter(item => item.createdAt || item.projectName)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ════════════════════════════════════════════════════════════
//  HUB — Project Dashboard
// ════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', () => {
  initOfflineDB().then(() => {
    initAuth(); // From auth.js
  }).catch(() => {
    // Fallback: run without offline cache
    initAuth();
  });

  try {
    const connectedRef = db.ref('.info/connected');
    connectedRef.on('value', snap => {
      const badge = $('syncBadge');
      if (snap.val() === true) {
        if (badge) { badge.textContent = '\u2601\uFE0F Synced'; badge.className = 'badge badge-green'; }
        syncOfflineQueue();
      } else {
        if (badge) { badge.textContent = '\u26A0\uFE0F Offline'; badge.className = 'badge badge-amber'; }
        showToast('Working offline. Changes will sync when connected.', 'warn');
      }
    });
  } catch (e) {
    console.error('Firebase connection check failed:', e);
  }

  initPWA();
});

async function syncOfflineQueue() {
  if (!_idb) return;
  const tx = _idb.transaction('syncQueue', 'readonly');
  const store = tx.objectStore('syncQueue');
  const req = store.getAll();
  req.onsuccess = async () => {
    const items = req.result;
    if (!items.length) return;
    for (const item of items) {
      try {
        await db.ref(item.path).set(item.data);
        const delTx = _idb.transaction('syncQueue', 'readwrite');
        delTx.objectStore('syncQueue').delete(item.id);
      } catch (e) {
        console.error('Sync failed for', item.path, e);
      }
    }
    if (items.length) showToast(`${items.length} offline changes synced`);
  };
}

function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    window.deferredPrompt = e;
    $('installBar')?.classList.remove('hidden');
  });
  $('installBtn')?.addEventListener('click', async () => {
    const prompt = window.deferredPrompt;
    if (!prompt) return;
    prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === 'accepted') {
      $('installBar')?.classList.add('hidden');
      showToast('App installed!');
    }
  });
}

function showHubTab(tab) {
  document.querySelectorAll('.hub-tab').forEach(t => t.classList.remove('tab-active'));
  $(`hubTab_${tab}`)?.classList.add('tab-active');
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
  $(`${tab}ProjectsPane`)?.classList.remove('hidden');
  renderHub();

  requestAnimationFrame(() => {
    const visibleGrid = document.querySelector('.tab-pane:not(.hidden) [id$="Grid"]');
    if (visibleGrid) {
      visibleGrid.style.display = 'none';
      void visibleGrid.offsetHeight;
      visibleGrid.style.display = '';
    }
  });
}

function canListAllProjects(user = window._currentUser || {}) {
  return typeof isBoss === 'function'
    ? isBoss(user.role)
    : String(user.role || '').toLowerCase() === 'boss';
}

function canDeleteProject(pid) {
  const user = window._currentUser || {};
  return typeof isBoss === 'function'
    ? isBoss(user.role)
    : String(user.role || '').toLowerCase() === 'boss';
}

function canManageProjectLifecycle(pid) {
  const user = window._currentUser || {};
  return typeof isBoss === 'function'
    ? isBoss(user.role)
    : String(user.role || '').toLowerCase() === 'boss';
}

function assignedProjectIds(user = window._currentUser || {}) {
  return Array.from(new Set([
    ...(Array.isArray(user.projects) ? user.projects : []),
    ...(Array.isArray(user.bossOf) ? user.bossOf : [])
  ].filter(Boolean)));
}

function canReadProjectSnapshot(pid) {
  return typeof canReadFullProject === 'function'
    ? canReadFullProject(pid)
    : canAccessProject(pid);
}

async function loadProjectForCurrentRole(pid) {
  if (!canReadProjectSnapshot(pid)) return null;
  const snap = await db.ref(`projects/${pid}`).once('value');
  return snap.exists() ? { id: pid, ...snap.val() } : null;
}

function projectMatchesHubTab(project, tab, isAll) {
  if ((project.status || 'active') === 'archived') {
    return isAll && canListAllProjects(window._currentUser || {});
  }
  if (isAll) return true;
  return (project.status || 'active') === tab;
}

function sortProjectsNewest(projects) {
  return projects.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function renderProjectHubList(projects, gridId, tab, isAll) {
  const el = $(gridId);
  if (!el) return;

  const visibleProjects = sortProjectsNewest(projects.filter(p => projectMatchesHubTab(p, tab, isAll)));
  el.innerHTML = '';

  if (!visibleProjects.length) {
    el.innerHTML = `<p class="hub-empty">No ${isAll ? '' : tab} projects.</p>`;
    if (isAll) {
      renderDashboardSummary([], 'All');
      renderComparison([], 'comparisonViewAll');
      renderRecentActivity([], 'recentActivityViewAll');
      renderDashboardAlerts([]);
    } else if (tab === 'active') {
      renderDashboardSummary([]);
      renderComparison([]);
      renderRecentActivity([]);
      renderDashboardAlerts([]);
    } else {
      renderCompletedSummary([]);
    }
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleProjects.forEach(p => fragment.appendChild(buildProjectCard(p)));
  el.appendChild(fragment);

  if (isAll) {
    renderDashboardSummary(visibleProjects, 'All');
    renderComparison(visibleProjects, 'comparisonViewAll');
    renderRecentActivity(visibleProjects, 'recentActivityViewAll');
    renderDashboardAlerts(visibleProjects);
  } else if (tab === 'active') {
    renderDashboardSummary(visibleProjects);
    renderComparison(visibleProjects);
    renderRecentActivity(visibleProjects);
    renderDashboardAlerts(visibleProjects);
  } else {
    renderCompletedSummary(visibleProjects);
  }

  visibleProjects.forEach(p => cacheProject(p.id, p));
}

function watchAssignedProjects(user, gridId, tab, isAll) {
  const grid = $(gridId);
  const ids = assignedProjectIds(user);
  if (!ids.length) {
    renderProjectHubList([], gridId, tab, isAll);
    return;
  }

  const projectMap = new Map();
  const render = () => renderProjectHubList(Array.from(projectMap.values()), gridId, tab, isAll);

  ids.forEach(pid => {
    const onError = error => {
      console.error('Firebase project load error:', error);
      if (grid) grid.innerHTML = '<p class="hub-empty">Error loading assigned projects. Check console.</p>';
      showToast('Error loading assigned projects: ' + error.message, 'error');
    };
    const projectRef = db.ref(`projects/${pid}`);
    projectRef.on('value', snap => {
      if (snap.exists()) {
        projectMap.set(pid, { id: pid, ...snap.val() });
      } else {
        projectMap.delete(pid);
      }
      render();
    }, onError);
    _hubListeners.push(projectRef);
  });
}

async function fetchAccessibleProjectsOnce(statusFilter = null) {
  const user = window._currentUser || {};
  const projects = [];

  if (canListAllProjects(user)) {
    const snap = await db.ref('projects').once('value');
    snap.forEach(c => {
      projects.push({ id: c.key, ...c.val() });
    });
  } else {
    const ids = assignedProjectIds(user);
    const loadedProjects = await Promise.all(ids.map(pid => loadProjectForCurrentRole(pid)));
    loadedProjects.forEach(project => {
      if (project) projects.push(project);
    });
  }

  const filtered = statusFilter
    ? projects.filter(p => (p.status || 'active') === statusFilter)
    : projects;
  return sortProjectsNewest(filtered);
}

function renderHub() {
  detachHubListeners();
  const tab = document.querySelector('.hub-tab.tab-active')?.id?.replace('hubTab_', '') || 'active';
  const isAll = tab === 'all';
  const gridId = isAll ? 'allProjectsGrid' : (tab === 'active' ? 'projectGrid' : 'completedGrid');
  const grid = $(gridId);
  if (grid) grid.innerHTML = '<p class="hub-empty">Loading...</p>';

  const user = window._currentUser || {};
  if (!canListAllProjects(user)) {
    watchAssignedProjects(user, gridId, tab, isAll);
    return;
  }

  const projectsRef = db.ref('projects');

  projectsRef.on('value', snap => {
    const projects = [];
    snap.forEach(c => {
      projects.push({ id: c.key, ...c.val() });
    });
    renderProjectHubList(projects, gridId, tab, isAll);
  }, error => {
    console.error('Firebase error:', error);
    if (grid) grid.innerHTML = '<p class="hub-empty">Error loading projects. Check console.</p>';
    showToast('Error loading projects: ' + error.message, 'error');
  });
  _hubListeners.push(projectsRef);
}

function budgetHealthLabel(percentUsed) {
  if (percentUsed >= 95) return { text: 'Over Budget', className: 'critical' };
  if (percentUsed >= 80) return { text: 'Warning', className: 'warning' };
  return { text: 'Healthy', className: 'healthy' };
}

function budgetMetricRow(label, budget, spent) {
  const used = pct(spent, budget);
  const remaining = budget - spent;
  const barWidth = Math.min(Math.max(used, spent > 0 ? 2 : 0), 100);
  const health = budgetHealthLabel(used);
  return `
    <div class="budget-metric-row">
      <div class="budget-metric-head">
        <span>${label}</span>
        <strong>${peso(spent)} / ${peso(budget)}</strong>
      </div>
      <div class="mini-bar">
        <div class="mini-fill ${budgetBarClass(used)}" style="width:${barWidth}%"></div>
      </div>
      <div class="budget-metric-foot">
        <span class="budget-health ${health.className}">${health.text}</span>
        <span>${used}% used · ${peso(remaining)} remaining</span>
      </div>
    </div>`;
}

function buildProjectCard(p) {
  const div = document.createElement('div');
  div.className = `proj-card ${p.status === 'completed' ? 'proj-card-done' : ''}`;
  div.setAttribute('data-name', (p.name || '').toLowerCase());
  div.setAttribute('data-pid', p.id);

  const eff = effectiveBudget(p);
  const laborSpent = dashboardLaborSpent(p);
  const matSpent = dashboardMaterialSpent(p);
  const otherBudget = Math.max(0, eff.total - eff.labor - eff.material);
  const otherSpent = dashboardOtherSpent(p);
  const totalSpent = dashboardTotalSpent(p);
  const remaining = eff.total - totalSpent;
  const pctUsed = pct(totalSpent, eff.total);
  const isWarning = pctUsed >= 80 && pctUsed < 95;
  const isCritical = pctUsed >= 95;
  const status = p.status || 'active';
  const statusClass = status === 'completed' ? 'completed-tag' : status === 'archived' ? 'archived-tag' : 'active-tag';
  const statusText = status === 'completed' ? 'Completed' : status === 'archived' ? 'Archived' : 'Active';
  const health = typeof calculateProjectHealth === 'function' ? calculateProjectHealth(p) : { score: 100, warnings: [] };
  const healthColor = health.score >= 80 ? 'var(--green)' : health.score >= 60 ? 'var(--amber)' : 'var(--red)';
  const budgetHealth = budgetHealthLabel(pctUsed);
  const hasDelta = (parseFloat(p.laborBudgetDelta) || 0) || (parseFloat(p.materialBudgetDelta) || 0);
  const rollup = dashboardRollup(p);
  const hasFinancialRollup = ['contractAmount', 'adjustedContractAmount', 'totalBilled', 'totalCollected', 'receivable', 'estimatedProfit'].some(key => rollup[key] !== undefined);
  const financialLine = hasFinancialRollup ? `
    <div class="budget-sub budget-note">
      Contract ${peso(parseFloat(rollup.adjustedContractAmount ?? rollup.contractAmount) || 0)}
      &nbsp;|&nbsp; Billed ${peso(parseFloat(rollup.totalBilled ?? rollup.totalBilledGross) || 0)}
      &nbsp;|&nbsp; Collected ${peso(parseFloat(rollup.totalCollected ?? rollup.totalRevenueCollected) || 0)}
      &nbsp;|&nbsp; Receivable ${peso(parseFloat(rollup.receivable ?? rollup.totalReceivable) || 0)}
    </div>` : '';
  const canLifecycle = canManageProjectLifecycle(p.id);
  const budgetRows = [
    budgetMetricRow('Labor Budget', eff.labor, laborSpent),
    budgetMetricRow('Materials Budget', eff.material, matSpent),
    otherBudget ? budgetMetricRow('Other Budget', otherBudget, otherSpent) : ''
  ].join('');

  div.innerHTML = `
    <div class="proj-card-top">
      <div>
        <span class="proj-label">Project</span>
        <h3 class="proj-name">${escapeHtml(p.name || 'Untitled')}</h3>
        <span class="proj-date">Created ${escapeHtml(p.createdDate || '-')}</span>
      </div>
      <div class="proj-card-meta">
        <span class="health-mini" style="color:${healthColor}">Health ${health.score}</span>
        ${buildProgressRing(pctUsed, isCritical, isWarning)}
        <span class="${statusClass}">${statusText}</span>
      </div>
    </div>
    <div class="budget-section">
      <div class="budget-card-total">
        <div>
          <span class="budget-label">Budget Used</span>
          <strong>${peso(totalSpent)} / ${peso(eff.total)}</strong>
        </div>
        <div>
          <span class="budget-label">Remaining</span>
          <strong class="${remaining < 0 ? 'text-red' : 'text-green'}">${peso(remaining)}</strong>
        </div>
      </div>
      <div class="mini-bar total-budget-bar">
        <div class="mini-fill ${budgetBarClass(pctUsed)}" style="width:${Math.min(Math.max(pctUsed, totalSpent > 0 ? 2 : 0), 100)}%"></div>
      </div>
      <div class="budget-sub">
        <span class="budget-health ${budgetHealth.className}">${budgetHealth.text}</span>
        <span>${pctUsed}% used</span>
      </div>
      ${financialLine}
      ${hasDelta ? '<div class="budget-sub budget-note">Includes approved change orders</div>' : ''}
      ${budgetRows}
    </div>
    <div class="proj-actions">
      ${status === 'archived'
        ? `${canDeleteProject(p.id) ? '<button class="btn-reopen" data-action="restore">Restore</button>' : ''}`
        : status === 'active'
          ? `<button class="proj-open-btn" data-action="open">Open Workspace</button>
             <button class="btn-complete" data-action="complete">${canLifecycle ? '\u2713 Done' : 'Request Done'}</button>`
          : `<button class="proj-open-btn" data-action="open">View Workspace</button>
             <button class="btn-reopen" data-action="reopen">${canLifecycle ? 'Reopen' : 'Request Reopen'}</button>`
      }
      ${canEditProject(p.id) && status === 'active' ? '<button class="btn-edit-proj" data-action="edit">Edit</button>' : ''}
      ${canDeleteProject(p.id) && status !== 'archived' ? '<button class="btn-delete" data-action="delete">Archive</button>' : ''}
    </div>
  `;

  div.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'open') openProjectFromHub(p.id);
    else if (action === 'complete') markComplete(p.id);
    else if (action === 'reopen') reopenProject(p.id);
    else if (action === 'restore') restoreProject(p.id);
    else if (action === 'edit') openEditProjectModal(p.id);
    else if (action === 'delete') deleteProject(p.id);
  });

  return div;
}

function renderDashboardSummary(projects, context = '') {
  const el = context === 'All' ? $('dashSummaryAll') : $('dashSummary');
  if (!el) return;

  const active = projects.filter(p => p.status === 'active').length;
  const completed = projects.filter(p => p.status === 'completed').length;
  const totalBudget = projects.reduce((s, p) => s + effectiveBudget(p).total, 0);
  const totalSpent = projects.reduce((s, p) => s + dashboardTotalSpent(p), 0);
  const remaining = totalBudget - totalSpent;
  const overallPct = pct(totalSpent, totalBudget);

  const critical = projects.filter(p => {
    const eff = effectiveBudget(p);
    const spent = dashboardTotalSpent(p);
    return pct(spent, eff.total) >= 95;
  }).length;

  const warning = projects.filter(p => {
    const eff = effectiveBudget(p);
    const spent = dashboardTotalSpent(p);
    const pUsed = pct(spent, eff.total);
    return pUsed >= 80 && pUsed < 95;
  }).length;

  if (context === 'All') {
    setText('dsAllSumTotal', projects.length);
    setText('dsAllSumActive', active);
    setText('dsAllSumCompleted', completed);
    setText('dsAllSumBudget', peso(totalBudget));
    setText('dsAllSumSpent', peso(totalSpent));
    const remEl = $('dsAllSumRemaining');
    if (remEl) {
      remEl.textContent = peso(remaining);
      remEl.className = `dash-stat-val ${remaining < 0 ? 'text-red' : 'text-green'}`;
    }
    const progEl = $('dsAllSumProgress');
    if (progEl) {
      progEl.textContent = overallPct + '%';
      progEl.className = `dash-stat-val ${overallPct >= 95 ? 'text-red' : overallPct >= 80 ? 'text-amber' : 'text-green'}`;
    }
  } else {
    setText('dsSumActive', active);
    setText('dsSumBudget', peso(totalBudget));
    setText('dsSumSpent', peso(totalSpent));
    const remEl = $('dsSumRemaining');
    if (remEl) {
      remEl.textContent = peso(remaining);
      remEl.className = `dash-stat-val ${remaining < 0 ? 'text-red' : 'text-green'}`;
    }
    const progEl = $('dsSumProgress');
    if (progEl) {
      progEl.textContent = overallPct + '%';
      progEl.className = `dash-stat-val ${overallPct >= 95 ? 'text-red' : overallPct >= 80 ? 'text-amber' : 'text-green'}`;
    }
  }

  let warn = el.querySelector('#dashWarnLine');
  if (!warn) {
    warn = document.createElement('div');
    warn.id = 'dashWarnLine';
    el.appendChild(warn);
  }
  warn.innerHTML =
    critical > 0
      ? `<div class="budget-warn-bar warn-critical">Warning: ${critical} project${critical !== 1 ? 's' : ''} over budget.</div>`
      : warning > 0
        ? `<div class="budget-warn-bar warn-high">Warning: ${warning} project${warning !== 1 ? 's are' : ' is'} approaching budget limit.</div>`
        : `<div style="font-size:12px;color:var(--green);padding:8px 0">All projects are within budget limits.</div>`;
}

function renderComparison(projects, targetId = 'comparisonView') {
  const el = $(targetId);
  if (!el) return;

  if (projects.length < 2) {
    el.innerHTML = '<p class="empty-hint">Add 2+ projects to compare budgets.</p>';
    return;
  }

  el.innerHTML = projects.map((p, i) => {
    const eff = effectiveBudget(p);
    const spent = dashboardTotalSpent(p);
    const pUsed = pct(spent, eff.total);
    const remaining = eff.total - spent;
    const health = budgetHealthLabel(pUsed);
    const barWidth = Math.min(Math.max(pUsed, spent > 0 ? 2 : 0), 100);
    return `
      <div class="cmp-card">
        <div class="cmp-card-head">
          <strong>${escapeHtml(p.name || 'Untitled')}</strong>
          <span class="budget-health ${health.className}">${health.text}</span>
        </div>
        <div class="cmp-bar-wrap"><div class="mini-fill ${budgetBarClass(pUsed)}" style="width:${barWidth}%"></div></div>
        <div class="cmp-card-grid">
          <span><b>${pUsed}%</b> used</span>
          <span>${peso(spent)} spent</span>
          <span>${peso(remaining)} remaining</span>
        </div>
      </div>`;
  }).join('');
}

function renderRecentActivity(projects, targetId = 'recentActivityView') {
  const el = $(targetId);
  if (!el) return;
  const items = dashboardRecentItems(projects)
    .slice(0, 5)
    .map(p => {
      if (p.label) {
        const time = p.createdAt || null;
        const date = time ? new Date(time).toLocaleDateString('en-PH') : '-';
        return `
        <div class="activity-row">
          <div>
            <strong>${escapeHtml(p.projectName || 'Untitled')}</strong>
            <span>${escapeHtml(p.label)} - ${escapeHtml(date)}</span>
          </div>
          <button class="btn-equip-action" onclick="openProjectFromHub('${escapeHtml(p.projectId)}')">Open</button>
        </div>`;
      }
      const status = p.status === 'completed' ? 'Completed' : p.status === 'archived' ? 'Archived' : 'Active';
      const time = p.completedAt || p.archivedAt || p.updatedAt || p.createdAt || null;
      const date = time ? new Date(time).toLocaleDateString('en-PH') : (p.createdDate || '-');
      return `
        <div class="activity-row">
          <div>
            <strong>${escapeHtml(p.name || 'Untitled')}</strong>
            <span>${status} - ${escapeHtml(date)}</span>
          </div>
          <button class="btn-equip-action" onclick="openProjectFromHub('${escapeHtml(p.id)}')">Open</button>
        </div>`;
    });
  el.innerHTML = items.length ? items.join('') : '<p class="empty-hint">No recent project activity yet.</p>';
}

let _searchDebounce = null;
function filterProjects(query) {
  if (_searchDebounce) clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.proj-card').forEach(card => {
      const name = card.getAttribute('data-name') || '';
      card.style.display = name.includes(q) ? '' : 'none';
    });
  }, 150);
}

async function createProject(evt) {
  const btn = evt?.currentTarget || document.querySelector('.btn-create');
  await withBusy(btn, async () => {
    const user = window._currentUser || {};
    if (normalizeRole(user.role) !== 'boss') {
      showToast('Boss access required to create projects.', 'error');
      return;
    }

    const vName = validateProjectName($('newName')?.value);
    if (!vName.ok) { showToast(vName.msg, 'error'); return; }
    const name = vName.value;

    const vLabor = validateBudget($('newLaborBudget')?.value);
    if (!vLabor.ok) { showToast(vLabor.msg, 'error'); return; }
    const laborBudget = vLabor.value;

    const vMaterial = validateBudget($('newMaterialBudget')?.value);
    if (!vMaterial.ok) { showToast(vMaterial.msg, 'error'); return; }
    const materialBudget = vMaterial.value;

    const dupCheck = await db.ref('projects').orderByChild('name').equalTo(name).once('value');
    if (dupCheck.exists()) { showToast('A project with that name already exists.', 'error'); return; }

    const projectData = {
      name, laborBudget, materialBudget,
      laborSpent: 0, materialSpent: 0, materialCommitted: 0,
      laborBudgetDelta: 0, materialBudgetDelta: 0,
      status: 'active',
      createdAt: Date.now(),
      createdDate: new Date().toLocaleDateString('en-PH'),
      payrollConfig: { type: 'weekly', overtimeThreshold: 8, nightDiffRate: 1.1 }
    };

    const newRef = await safeDb(() => db.ref('projects').push(projectData), 'Failed to create project');
    const newPid = newRef.key;

    // Auto-assign to creator
    if (user && user.role === "apm") {
      const currentProjects = Array.from(new Set(user.projects || [])).sort((a, b) => String(a).localeCompare(String(b)));
      const uniqueProjects = Array.from(new Set([...currentProjects, newPid])).sort((a, b) => String(a).localeCompare(String(b)));
      await db.ref(`users/${user.uid}/projects`).set(uniqueProjects);
      user.projects = uniqueProjects;
      window._currentUser = user;
    }

    $('newName').value = ''; $('newLaborBudget').value = ''; $('newMaterialBudget').value = '';
    const search = $('projectSearch');
    if (search) search.value = '';
    showHubTab('active');
    auditLog('create', 'project', null, { name, laborBudget, materialBudget });
    showToast(`Project "${name}" created!`);
  });
}

async function markComplete(pid) {
  if (!canEditProject(pid)) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!canManageProjectLifecycle(pid)) {
    await requestProjectLifecycleChange(pid, 'complete');
    return;
  }
  if (!confirm('Mark this project as completed?\n\nThis will lock the project for editing.')) return;
  await safeDb(() => db.ref(`projects/${pid}`).update({
    status: 'completed',
    completedAt: Date.now(),
    completedBy: window._currentUser?.uid || null,
    completedByName: window._currentUser?.name || null
  }), 'Failed to update');
  if (window._currentPid === pid) {
    window._currentProjectStatus = 'completed';
    window._isReadOnly = true;
    $('lockedBanner')?.classList.remove('hidden');
    document.querySelectorAll('.panel').forEach(pn => pn.classList.add('read-only'));
  }
  auditLog('complete', 'project', pid, {});
  showToast('Project marked as completed');
}

async function reopenProject(pid) {
  if (!canEditProject(pid)) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!canManageProjectLifecycle(pid)) {
    await requestProjectLifecycleChange(pid, 'reopen');
    return;
  }
  if (!confirm('Reopen this project?')) return;
  await safeDb(() => db.ref(`projects/${pid}`).update({
    status: 'active',
    reopenedAt: Date.now(),
    reopenedBy: window._currentUser?.uid || null,
    reopenedByName: window._currentUser?.name || null
  }), 'Failed to update');
  if (window._currentPid === pid) {
    window._currentProjectStatus = 'active';
    window._isReadOnly = false;
    $('lockedBanner')?.classList.add('hidden');
    document.querySelectorAll('.panel').forEach(pn => pn.classList.remove('read-only'));
  }
  auditLog('reopen', 'project', pid, {});
  showToast('Project reopened');
}

async function requestProjectLifecycleChange(pid, requestType) {
  if (!canAccessProject(pid)) {
    showToast('You do not have access to this project.', 'error');
    return;
  }

  const actionLabel = requestType === 'reopen' ? 'reopen' : 'completion';
  if (!confirm(`Request project ${actionLabel}? Boss/Admin/PM will be notified.`)) return;

  const projectSnap = await db.ref(`projects/${pid}`).once('value');
  const project = projectSnap.val();
  if (!project) {
    showToast('Project not found.', 'error');
    return;
  }

  if (requestType === 'complete' && project.status !== 'active') {
    showToast('Only active projects can be requested for completion.', 'warn');
    return;
  }
  if (requestType === 'reopen' && project.status !== 'completed') {
    showToast('Only completed projects can be requested for reopening.', 'warn');
    return;
  }

  const user = window._currentUser || {};
  const request = {
    type: requestType,
    status: 'pending',
    requestedAt: Date.now(),
    requestedBy: user.uid || null,
    requestedByName: user.name || 'APM',
    projectStatus: project.status || 'active'
  };

  await safeDb(() => db.ref(`projects/${pid}/lifecycleRequests`).push(request), 'Failed to save request');
  auditLog('request', 'project', pid, { lifecycle: requestType });

  const bossSnap = await db.ref('users').once('value');
  const notifications = [];
  bossSnap.forEach(c => {
    const recipient = c.val() || {};
    if ((typeof isBoss === 'function' ? isBoss(recipient.role) : recipient.role === 'boss') && typeof sendNotification === 'function') {
      notifications.push(sendNotification({
        to: c.key,
        type: 'alert',
        projectId: pid,
        projectName: project.name || pid,
        message: `${user.name || 'APM'} requested to ${requestType === 'reopen' ? 'reopen' : 'complete'} ${project.name || 'this project'}.`
      }));
    }
  });
  await Promise.allSettled(notifications);
  showToast(`Project ${actionLabel} request sent to Boss/Admin/PM.`);
}

async function deleteProject(pid) {
  return archiveProject(pid);
}

async function archiveProject(pid) {
  if (!canDeleteProject(pid)) {
    showToast('Boss access required to archive projects.', 'error');
    return;
  }
  const snap = await db.ref(`projects/${pid}`).once('value');
  const project = snap.val();
  if (!project) {
    showToast('Project not found.', 'error');
    return;
  }
  if (!confirm('Archive this project?\n\nIt will be hidden from Active and Completed tabs but can be restored from All Projects.')) return;

  await safeDb(() => db.ref(`projects/${pid}`).update({
    status: 'archived',
    archivedAt: Date.now(),
    archivedBy: window._currentUser?.uid || null,
    archivedByName: window._currentUser?.name || null,
    previousStatus: project.status || 'active'
  }), 'Failed to archive');
  if (window._currentPid === pid) {
    window._currentProjectStatus = 'archived';
    window._isReadOnly = true;
    $('lockedBanner')?.classList.remove('hidden');
    document.querySelectorAll('.panel').forEach(pn => pn.classList.add('read-only'));
  }
  auditLog('archive', 'project', pid, { previousStatus: project.status || 'active' });
  showToast('Project archived. It can be restored from All Projects.', 'warn');
}

async function restoreProject(pid) {
  if (!canDeleteProject(pid)) {
    showToast('Boss access required to restore projects.', 'error');
    return;
  }
  const snap = await db.ref(`projects/${pid}`).once('value');
  const project = snap.val();
  if (!project) {
    showToast('Project not found.', 'error');
    return;
  }
  const restoreStatus = ['active', 'completed'].includes(project.previousStatus) ? project.previousStatus : 'active';
  if (!confirm(`Restore this project to ${restoreStatus}?`)) return;
  await safeDb(() => db.ref(`projects/${pid}`).update({
    status: restoreStatus,
    restoredAt: Date.now(),
    restoredBy: window._currentUser?.uid || null,
    restoredByName: window._currentUser?.name || null,
    archivedAt: null,
    archivedBy: null,
    archivedByName: null
  }), 'Failed to restore');
  if (window._currentPid === pid) {
    window._currentProjectStatus = restoreStatus;
    window._isReadOnly = restoreStatus === 'completed';
    $('lockedBanner')?.classList.toggle('hidden', !window._isReadOnly);
    document.querySelectorAll('.panel').forEach(pn => pn.classList.toggle('read-only', window._isReadOnly));
  }
  auditLog('restore', 'project', pid, { status: restoreStatus });
  showToast('Project restored');
}

function detachHubListeners() {
  _hubListeners.forEach(ref => ref.off());
  _hubListeners = [];
}

function detachProjectNotesListener() {
  if (_projectNotesListener) {
    _projectNotesListener.off();
    _projectNotesListener = null;
  }
}

function openProjectFromHub(pid) {
  if (getAppPage() === 'dashboard') {
    window.location.href = appUrl('workspace', { projectId: pid });
    return;
  }
  enterProject(pid);
}

// ════════════════════════════════════════════════════════════
//  WORKSPACE — Enter / Exit
// ════════════════════════════════════════════════════════════

async function enterProject(pid) {
  if (!canAccessProject(pid)) {
    showToast('You do not have access to this project.', 'error');
    return false;
  }

  const p = await loadProjectForCurrentRole(pid);
  if (!p) { showToast('Project not found.', 'error'); return false; }

  window._currentPid = pid;
  setText('wsName', p.name || 'Untitled');
  $('hubView').classList.add('hidden');
  $('workspaceView').classList.remove('hidden');

  window._currentProjectStatus = p.status || 'active';
  window._isReadOnly = p.status === 'completed' || p.status === 'archived';
  $('lockedBanner')?.classList.toggle('hidden', !window._isReadOnly);
  document.querySelectorAll('.panel').forEach(pn => pn.classList.toggle('read-only', window._isReadOnly));

  initLabor(pid);
  initMaterials(pid);
  initBilling(pid);
  initChangeOrders(pid);
  initSiteLog(pid);
  initSuppliers();
  initTasks(pid);
  initEquipment(pid);
  initCompliance(pid);
  initDefects(pid);
  initNotifications();
  loadProjectNotes(pid);
  const role = typeof normalizeRole === 'function' ? normalizeRole(window._currentUser?.role || 'apm') : (window._currentUser?.role || 'apm');
  switchTab(typeof canSeeFinancials === 'function' && canSeeFinancials(role) ? 'reports' : 'labor');

  auditLog('enter', 'project', pid, { name: p.name });
  return true;
}

function exitHub() {
  if (getAppPage() === 'workspace') {
    window.location.href = appUrl('dashboard');
    return;
  }
  detachLaborListeners();
  detachMatListeners();
  detachBillingListeners();
  detachCOListeners();
  detachSiteLogListeners();
  detachSupplierListeners();
  detachTaskListeners();
  detachEquipListeners();
  detachComplianceListeners();
  detachDefectListeners();
  detachProjectNotesListener();
  if (typeof detachNotifications === 'function') detachNotifications();

  $('workspaceView').classList.add('hidden');
  $('hubView').classList.remove('hidden');
  window._currentPid = null;
  window._currentProjectStatus = null;
  window._isReadOnly = false;
  renderHub();
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('tab-active'));
  $(`tab_${tab}`)?.classList.add('tab-active');
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  $(`${tab}Panel`)?.classList.remove('hidden');

  // Trigger view-specific renders
  if (tab === 'tasks') renderGanttView();
  if (tab === 'admin' && typeof initTeamAdmin === 'function') initTeamAdmin();
  if (tab === 'reports') initReports();
}

function toggleExtraTabs(forceValue) {
  const next = typeof forceValue === 'boolean'
    ? forceValue
    : !(typeof getFeatureFlag === 'function' ? getFeatureFlag('extras', false) : false);
  if (typeof setFeatureFlag === 'function') setFeatureFlag('extras', next);

  const role = typeof normalizeRole === 'function'
    ? normalizeRole(window._currentUser?.role || 'apm')
    : (window._currentUser?.role || 'apm');
  document.querySelectorAll('[data-feature-visible="extras"]').forEach(el => {
    const roleAllowed = typeof elementAllowsRole === 'function'
      ? elementAllowsRole(el, role)
      : true;
    el.style.display = next && roleAllowed ? '' : 'none';
  });

  const extrasToggle = document.getElementById('extrasToggleBtn');
  if (extrasToggle) {
    extrasToggle.classList.toggle('is-enabled', next);
    extrasToggle.textContent = next ? 'Extras On' : 'Extras';
    extrasToggle.title = next ? 'Hide optional tabs' : 'Show optional tabs';
  }

  const activeTab = document.querySelector('.tab-btn.tab-active');
  if (!next && activeTab && activeTab.dataset.featureVisible === 'extras') {
    if (typeof isBoss === 'function' && isBoss(window._currentUser?.role)) {
      const fallback = document.getElementById('tab_reports');
      fallback?.click();
    } else {
      const fallback = document.getElementById('tab_labor');
      fallback?.click();
    }
  }
}

function openTeamAdmin() {
  $('hubView')?.classList.add('hidden');
  $('workspaceView')?.classList.remove('hidden');
  window._currentPid = window._currentPid || null;
  const wsName = $('wsName');
  if (wsName) wsName.textContent = 'Team Admin';
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  $('adminPanel')?.classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('tab-active'));
  $('tab_admin')?.classList.add('tab-active');
  if (typeof initTeamAdmin === 'function') initTeamAdmin();
  if (typeof switchAdminSection === 'function') switchAdminSection('summary');
}

function switchAdminSection(section) {
  const sections = ['summary', 'team', 'audit', 'system'];
  sections.forEach(name => {
    const panel = $(`adminSection_${name}`);
    const tab = $(`adminTab_${name}`);
    if (panel) panel.classList.toggle('hidden', name !== section);
    if (tab) tab.classList.toggle('tab-active', name === section);
  });
  if (section === 'team' && typeof initTeamAdmin === 'function') initTeamAdmin();
  if (section === 'audit' && typeof initAuditLog === 'function') initAuditLog();
  if (section === 'summary' && typeof initAdminSummary === 'function') initAdminSummary();
  if (section === 'system' && typeof initSystemStatus === 'function') initSystemStatus();
}

function unlockForEdit() {
  const pid = window._currentPid;
  if (!pid) return;
  reopenProject(pid);
}

async function exportAllData() {
  const pid = window._currentPid;
  if (!pid) return;
  const snap = await db.ref(`projects/${pid}`).once('value');
  const data = snap.val();
  if (!data) return;

  downloadTextFile(
    `ACPM_${pid}_${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(data, null, 2),
    'application/json'
  );
  auditLog('export', 'project', pid, { format: 'json' });
  showToast('Project data exported!');
}

async function exportDatabaseBackup() {
  const user = window._currentUser || {};
  if (!canListAllProjects(user)) {
    showToast('Boss access required to download database backup.', 'error');
    return;
  }

  const backupPaths = ['projects', 'users', 'suppliers', 'auditLogs', 'notifications', 'complianceAlertsSent'];
  const backup = {
    _meta: {
      app: 'ACPM',
      exportedAt: new Date().toISOString(),
      exportedBy: {
        uid: user.uid || null,
        name: user.name || null,
        email: user.email || null,
        role: user.role || null
      },
      format: 'firebase-rtdb-json-snapshot',
      paths: backupPaths
    }
  };

  const failed = [];
  await Promise.all(backupPaths.map(async path => {
    try {
      const snap = await db.ref(path).once('value');
      backup[path] = snap.val() || null;
    } catch (error) {
      failed.push({ path, message: error?.message || error?.code || 'read failed' });
      backup[path] = null;
    }
  }));

  if (failed.length) backup._meta.failedPaths = failed;

  downloadTextFile(
    `ACPM_Database_Backup_${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(backup, null, 2),
    'application/json'
  );
  auditLog('backup', 'database', 'manual-json', { paths: backupPaths, failed: failed.map(f => f.path) });
  showToast(failed.length ? 'Backup downloaded with some unreadable paths noted.' : 'Database backup downloaded.');
}

// ════════════════════════════════════════════════════════════
//  PROJECT NOTES
// ════════════════════════════════════════════════════════════
function loadProjectNotes(pid) {
  detachProjectNotesListener();
  _projectNotesListener = db.ref(`projects/${pid}/notes`);
  _projectNotesListener.on('value', snap => {
    const ta = $('projectNotesInput');
    if (ta && document.activeElement !== ta) {
      ta.value = snap.val()?.text || '';
    }
  });
}

async function saveProjectNotes() {
  const pid = window._currentPid;
  if (!pid) return;
  if (typeof requireEdit === 'function' ? !requireEdit(pid) : !canEditProject(pid)) return;
  const text = $('projectNotesInput')?.value?.trim() || '';
  await safeDb(() => db.ref(`projects/${pid}/notes`).set({
    text, updatedAt: Date.now(), updatedBy: window._currentUser.uid
  }), 'Failed to save notes');
  showToast('Notes saved');
}

// Keyboard shortcuts
window.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key >= '1' && e.key <= '8') {
    const tabs = ['labor', 'materials', 'billing', 'changeorders', 'sitelog', 'suppliers', 'tasks', 'equipment', 'compliance', 'defects', 'reports'];
    const idx = parseInt(e.key) - 1;
    const workspace = $('workspaceView');
    if (tabs[idx] && workspace && !workspace.classList.contains('hidden')) {
      switchTab(tabs[idx]);
      e.preventDefault();
    }
  }
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    showToast('Auto-saved to Firebase', 'success');
  }
});

// ════════════════════════════════════════════════════════════
//  GLOBAL ERROR HANDLER
//  Catches unhandled errors and shows a user-friendly message.
//  Prevents the app from silently breaking.
// ════════════════════════════════════════════════════════════
window.addEventListener('error', e => {
  console.error('Global error:', e.error);
  showToast('Something went wrong. Please refresh the page if problems persist.', 'error');
});

window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled promise rejection:', e.reason);
  showToast('A background task failed. Please try again.', 'error');
});

// ════════════════════════════════════════════════════════════
//  PROGRESS RING (SVG Donut)
// ════════════════════════════════════════════════════════════
function buildProgressRing(pctUsed, isCritical, isWarning) {
  const circumference = 2 * Math.PI * 18;
  const offset = circumference - (Math.min(pctUsed, 100) / 100) * circumference;
  const color = isCritical ? 'var(--red)' : isWarning ? 'var(--amber)' : 'var(--green)';
  const bgColor = isCritical ? 'var(--red-glow)' : isWarning ? 'var(--amber-glow)' : 'var(--green-glow)';
  return `<svg class="proj-ring" viewBox="0 0 40 40" width="44" height="44">
    <circle cx="20" cy="20" r="18" fill="none" stroke="${bgColor}" stroke-width="3"/>
    <circle cx="20" cy="20" r="18" fill="none" stroke="${color}" stroke-width="3"
      stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
      stroke-linecap="round" transform="rotate(-90 20 20)"
      style="transition:stroke-dashoffset 0.6s ease"/>
    <text x="20" y="20" text-anchor="middle" dominant-baseline="central"
      fill="var(--text)" font-size="9" font-weight="800">${pctUsed}%</text>
  </svg>`;
}

// ════════════════════════════════════════════════════════════
//  EDIT PROJECT
// ════════════════════════════════════════════════════════════
window._editProjectId = null;

function openEditProjectModal(pid) {
  if (typeof requireEdit === 'function' ? !requireEdit(pid) : !canEditProject(pid)) return;
  const snap = db.ref(`projects/${pid}`).once('value').then(snap => {
    const p = snap.val();
    if (!p) { showToast('Project not found.', 'error'); return; }
    window._editProjectId = pid;
    $('editProjName').value = p.name || '';
    $('editProjLaborBudget').value = p.laborBudget || 0;
    $('editProjMaterialBudget').value = p.materialBudget || 0;
    $('editProjectModal').classList.remove('hidden');
  });
}

function closeEditProjectModal() {
  $('editProjectModal')?.classList.add('hidden');
  window._editProjectId = null;
}

async function editProject() {
  const pid = window._editProjectId;
  if (!pid) return;
  if (typeof requireEdit === 'function' ? !requireEdit(pid) : !canEditProject(pid)) return;
  const vName = validateProjectName($('editProjName')?.value);
  if (!vName.ok) { showToast(vName.msg, 'error'); return; }
  const name = vName.value;

  const vLabor = validateBudget($('editProjLaborBudget')?.value);
  if (!vLabor.ok) { showToast(vLabor.msg, 'error'); return; }
  const laborBudget = vLabor.value;

  const vMaterial = validateBudget($('editProjMaterialBudget')?.value);
  if (!vMaterial.ok) { showToast(vMaterial.msg, 'error'); return; }
  const materialBudget = vMaterial.value;

  if (canListAllProjects(window._currentUser || {})) {
    const dupCheck = await db.ref('projects').orderByChild('name').equalTo(name).once('value');
    if (dupCheck.exists()) {
      const keys = Object.keys(dupCheck.val());
      if (keys.length > 1 || keys[0] !== pid) {
        showToast('A project with that name already exists.', 'error'); return;
      }
    }
  }

  await safeDb(() =>
    db.ref(`projects/${pid}`).update({ name, laborBudget, materialBudget }),
    'Failed to update project'
  );
  closeEditProjectModal();
  auditLog('edit', 'project', pid, { name, laborBudget, materialBudget });
  showToast(`Project "${name}" updated!`);
}

// ════════════════════════════════════════════════════════════
//  DASHBOARD ALERTS BAR
// ════════════════════════════════════════════════════════════
function renderDashboardAlerts(projects) {
  const el = $('dashboardAlerts');
  if (!el) return;

  const critical = projects.filter(p => {
    const eff = effectiveBudget(p);
    const spent = dashboardTotalSpent(p);
    return pct(spent, eff.total) >= 95;
  }).length;

  const warning = projects.filter(p => {
    const eff = effectiveBudget(p);
    const spent = dashboardTotalSpent(p);
    const pUsed = pct(spent, eff.total);
    return pUsed >= 80 && pUsed < 95;
  }).length;

  const active = projects.filter(p => p.status === 'active').length;
  const totalBudget = projects.reduce((s, p) => s + effectiveBudget(p).total, 0);
  const totalSpent = projects.reduce((s, p) => s + dashboardTotalSpent(p), 0);
  const pendingApprovals = dashboardPendingApprovalItems(projects).length;
  const openIssues = projects.reduce((sum, p) => sum + (parseFloat(dashboardRollup(p).openIssues ?? p.siteLogRollups?.openIssues) || 0), 0);
  const openDelays = projects.reduce((sum, p) => sum + (parseFloat(dashboardRollup(p).openDelays ?? p.siteLogRollups?.openDelays) || 0), 0);
  const opsLine = ` &nbsp;|&nbsp; Pending: ${pendingApprovals} &nbsp;|&nbsp; Issues: ${openIssues} &nbsp;|&nbsp; Delays: ${openDelays}`;

  if (critical > 0) {
    el.className = 'dashboard-alerts warn-critical';
    el.innerHTML = `<strong>${critical} project${critical !== 1 ? 's' : ''}</strong> over budget &nbsp;|&nbsp; ${warning} warning &nbsp;|&nbsp; ${active} active &nbsp;|&nbsp; Budget: ${peso(totalSpent)} / ${peso(totalBudget)}${opsLine}`;
  } else if (warning > 0) {
    el.className = 'dashboard-alerts warn-high';
    el.innerHTML = `<strong>${warning} project${warning !== 1 ? 's' : ''}</strong> approaching budget limit &nbsp;|&nbsp; ${active} active &nbsp;|&nbsp; Budget: ${peso(totalSpent)} / ${peso(totalBudget)}${opsLine}`;
  } else if (projects.length) {
    el.className = (pendingApprovals || openIssues || openDelays) ? 'dashboard-alerts warn-high' : 'dashboard-alerts warn-ok';
    el.innerHTML = `All ${active} active project${active !== 1 ? 's' : ''} within budget &nbsp;|&nbsp; Total: ${peso(totalSpent)} / ${peso(totalBudget)}${opsLine}`;
  } else {
    el.className = 'dashboard-alerts';
    el.innerHTML = '';
  }
}

// ════════════════════════════════════════════════════════════
//  COMPLETED PROJECTS SUMMARY
// ════════════════════════════════════════════════════════════
function renderCompletedSummary(projects) {
  const count = projects.length;
  setText('dsCompCount', count);
  const totalBudget = projects.reduce((s, p) => s + effectiveBudget(p).total, 0);
  const totalSpent = projects.reduce((s, p) => s + dashboardTotalSpent(p), 0);
  setText('dsCompBudget', peso(totalBudget));
  setText('dsCompSpent', peso(totalSpent));
  const remEl = $('dsCompRemaining');
  if (remEl) {
    const remaining = totalBudget - totalSpent;
    remEl.textContent = peso(remaining);
    remEl.className = `dash-stat-val ${remaining < 0 ? 'text-red' : 'text-green'}`;
  }
  const progEl = $('dsCompProgress');
  if (progEl) {
    const overallPct = pct(totalSpent, totalBudget);
    progEl.textContent = overallPct + '%';
    progEl.className = `dash-stat-val ${overallPct >= 95 ? 'text-red' : overallPct >= 80 ? 'text-amber' : 'text-green'}`;
  }
}

// ════════════════════════════════════════════════════════════
//  HUB CSV EXPORT
// ════════════════════════════════════════════════════════════
async function exportHubCSV() {
  const btn = event?.currentTarget;
  await withBusy(btn, async () => {
    const projects = await fetchAccessibleProjectsOnce();

    if (!projects.length) { showToast('No projects to export.', 'warn'); return; }

    let csv = 'Project Name,Status,Created Date,Labor Budget,Material Budget,Total Budget,Labor Spent,Material Spent,Total Spent,Remaining,% Used,Health Score\\n';
    projects.forEach(p => {
      const eff = effectiveBudget(p);
      const laborSpent = dashboardLaborSpent(p);
      const matSpent = dashboardMaterialSpent(p);
      const totalSpent = dashboardTotalSpent(p);
      const remaining = eff.total - totalSpent;
      const pctUsed = pct(totalSpent, eff.total);
      const health = typeof calculateProjectHealth === 'function' ? calculateProjectHealth(p).score : 100;
      csv += `"${(p.name || '').replace(/"/g, '""')}",${p.status || 'active'},"${p.createdDate || ''}",${p.laborBudget || 0},${p.materialBudget || 0},${eff.total},${laborSpent},${matSpent},${totalSpent},${remaining},${pctUsed}%,${health}\\n`;
    });

    downloadTextFile(
      `ACPM_Hub_Export_${new Date().toISOString().slice(0, 10)}.csv`,
      csv, 'text/csv'
    );
    showToast(`Exported ${projects.length} projects to CSV`);
  });
}

// ════════════════════════════════════════════════════════════
//  MANUAL REFRESH
// ════════════════════════════════════════════════════════════
function refreshHub() {
  const btn = $('refreshBtn');
  if (btn) {
    btn.classList.add('animate-spin');
    setTimeout(() => btn.classList.remove('animate-spin'), 1000);
  }
  renderHub();
  showToast('Dashboard refreshed', 'success');
}

// ── Expose ──────────────────────────────────────────────────
window.createProject = createProject;
window.markComplete = markComplete;
window.reopenProject = reopenProject;
window.deleteProject = deleteProject;
window.archiveProject = archiveProject;
window.restoreProject = restoreProject;
window.editProject = editProject;
window.openEditProjectModal = openEditProjectModal;
window.closeEditProjectModal = closeEditProjectModal;
window.enterProject = enterProject;
window.openProjectFromHub = openProjectFromHub;
window.getAppPage = getAppPage;
window.appUrl = appUrl;
window.getRouteProjectId = getRouteProjectId;
window.openTeamAdmin = openTeamAdmin;
window.switchAdminSection = switchAdminSection;
window.exitHub = exitHub;
window.switchTab = switchTab;
window.unlockForEdit = unlockForEdit;
window.exportAllData = exportAllData;
window.exportDatabaseBackup = exportDatabaseBackup;
window.filterProjects = filterProjects;
window.showHubTab = showHubTab;
window.saveProjectNotes = saveProjectNotes;
window.exportHubCSV = exportHubCSV;
window.refreshHub = refreshHub;
window.renderDashboardAlerts = renderDashboardAlerts;
window.dashboardPendingApprovalItems = dashboardPendingApprovalItems;
window.dashboardRecentItems = dashboardRecentItems;
