//  ACPM - main.js (Enhanced v3.0)
//  Firebase v8 compat init, Hub, Workspace lifecycle,
//  Offline cache, Data compression, Health scores
// ============================================================

// -- Firebase Config (v8 compat) -----------------------------
// environment.js selects an isolated backend before this file loads.
const firebaseConfig = window.ACPM_FIREBASE_CONFIG;
if (!firebaseConfig || !firebaseConfig.projectId || !firebaseConfig.databaseURL) {
  throw new Error('ACPM environment configuration did not load before main.js.');
}

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
window._db = db;
window._firebaseProjectId = firebaseConfig.projectId;

// -- Globals -----------------------------------------------
window._currentPid = null;
let _hubListeners = [];
let _projectNotesListener = null;
let _projectDashboardListener = null;
window._isReadOnly = false;
window._currentProjectStatus = null;
window._adminWorkspaceMode = false;
// Overwritten by auth.js once Firebase Auth resolves - this is only
// a pre-auth fallback so other modules don't crash on null access.
window._currentUser = { uid: 'anonymous', role: 'apm', name: 'System', projects: [], bossOf: [] };
window._allowedProjects = null;

function getAppPage() {
  if (window.ACPM_PAGE) return String(window.ACPM_PAGE).toLowerCase();
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  if (path.endsWith('/login.html') || path.endsWith('/login')) return 'login';
  if (path.endsWith('/pmos.html') || path.endsWith('/pmos')) return 'pmos';
  if (path.endsWith('/dashboard.html') || path.endsWith('/dashboard')) return 'dashboard';
  if (path.endsWith('/workspace.html') || path.endsWith('/workspace')) return 'workspace';
  return 'app';
}

function appUrl(page, params = {}) {
  if (page === 'login') return '/login.html';
  if (page === 'pmos') return '/pmos.html';
  if (page === 'workspace') {
    const pid = encodeURIComponent(params.projectId || '');
    return pid ? `/workspace.html?projectId=${pid}` : '/workspace.html';
  }
  return '/dashboard.html';
}

function getRouteProjectId() {
  return new URLSearchParams(window.location.search).get('projectId') || '';
}

// ============================================================
//  Offline Cache Layer (IndexedDB)
//  Stores project data locally for instant load + offline work
// ============================================================
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

// ============================================================
//  Effective-budget helper (unchanged)
// ============================================================
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
        module: event.module || event.type || '',
        actor: event.createdByName || event.byName || event.userName || event.requestedByName || '',
        createdAt: parseFloat(event.createdAt) || 0
      });
    });
    Object.entries(p.activity || {}).forEach(([id, event]) => {
      items.push({
        id,
        projectId: p.id,
        projectName,
        label: String(event.type || `${event.module || 'project'}.${event.action || 'updated'}`).replace(/[._]/g, ' '),
        module: event.module || '',
        actor: event.createdByName || '',
        createdAt: parseFloat(event.createdAt) || 0
      });
    });
  });
  return items
    .filter(item => item.createdAt || item.projectName)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function dashboardActivityLabel(item = {}) {
  const raw = String(item.label || item.status || 'Project update').replace(/_/g, ' ').trim();
  return raw.replace(/\b\w/g, c => c.toUpperCase());
}

function dashboardActivityClass(item = {}) {
  const text = `${item.module || ''} ${item.type || ''} ${item.label || ''}`.toLowerCase();
  if (text.includes('billing') || text.includes('collection')) return 'activity-finance';
  if (text.includes('material') || text.includes('po') || text.includes('delivery')) return 'activity-materials';
  if (text.includes('labor') || text.includes('payroll') || text.includes('cash')) return 'activity-labor';
  if (text.includes('complete') || text.includes('archive')) return 'activity-status';
  return 'activity-project';
}

function dashboardActivityWhen(ts) {
  if (!ts) return '-';
  if (typeof timeAgo === 'function') return timeAgo(ts);
  return new Date(ts).toLocaleDateString('en-PH');
}

// ============================================================
//  HUB - Project Dashboard
// ============================================================

window.addEventListener('DOMContentLoaded', () => {
  initOfflineDB().then(() => {
    initAuth(); // From auth.js
  }).catch(() => {
    // Fallback: run without offline cache
    initAuth();
  }).finally(() => {
    // UX enhancements: command palette, preference restoration
    setTimeout(() => {
      if (typeof initUXEnhancements === 'function') initUXEnhancements();
    }, 500);
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

  if (getAppPage() !== 'pmos') {
    initPWA();
  }
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
  if (window.__ACPM_DISABLE_SW_FOR_E2E__ === true) return;
  if ('serviceWorker' in navigator) {
    let refreshedForNewWorker = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshedForNewWorker) return;
      refreshedForNewWorker = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('sw.js')
      .then(registration => {
        if (!registration || typeof registration.update !== 'function') {
          console.warn('Service Worker registration unavailable');
          return;
        }
        registration.update().catch(console.warn);
        registration.addEventListener?.('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller && !refreshedForNewWorker) {
              refreshedForNewWorker = true;
              window.location.reload();
            }
          });
        });
      })
      .catch(console.error);
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
  return typeof canSeeAllProjects === 'function'
    ? canSeeAllProjects(user.role)
    : ['boss', 'owner', 'admin', 'pm'].includes(String(user.role || '').toLowerCase());
}

function canDeleteProject(pid) {
  const user = window._currentUser || {};
  return typeof isBoss === 'function'
    ? isBoss(user.role)
    : String(user.role || '').toLowerCase() === 'boss';
}

function canManageProjectLifecycle(pid) {
  const user = window._currentUser || {};
  return typeof canSeeAllProjects === 'function'
    ? canSeeAllProjects(user.role)
    : ['boss', 'owner', 'admin', 'pm'].includes(String(user.role || '').toLowerCase());
}

function assignedProjectIds(user = window._currentUser || {}) {
  const normalize = typeof normalizeProjectList === 'function'
    ? normalizeProjectList
    : value => {
      if (Array.isArray(value)) return value.filter(Boolean).map(String);
      if (value && typeof value === 'object') {
        return Object.entries(value)
          .filter(([, enabled]) => enabled !== false && enabled !== null)
          .map(([key]) => String(key));
      }
      return [];
    };
  return Array.from(new Set([
    ...normalize(user.projects),
    ...normalize(user.assignedProjects),
    ...normalize(user.bossOf)
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

function refreshWorkspaceTabVisibility() {
  const role = typeof normalizeRole === 'function'
    ? normalizeRole(window._currentUser?.role || 'apm')
    : (window._currentUser?.role || 'apm');
  const extrasEnabled = typeof getFeatureFlag === 'function' ? getFeatureFlag('extras', true) : true;
  document.querySelectorAll('#workspaceView > .tab-scroll > .tab-group > .tab-btn').forEach(el => {
    if (el.id === 'tab_admin') {
      el.classList.add('hidden');
      el.style.display = 'none';
      return;
    }
    const roleAllowed = typeof elementAllowsRole === 'function' ? elementAllowsRole(el, role) : true;
    const featureAllowed = el.dataset.featureVisible === 'extras' ? extrasEnabled : true;
    el.style.display = roleAllowed && featureAllowed ? '' : 'none';
  });
}

function setAdminWorkspaceMode(enabled) {
  window._adminWorkspaceMode = !!enabled;
  $('workspaceView')?.classList.toggle('workspace-admin-mode', !!enabled);
  if (enabled) {
    document.querySelectorAll('#workspaceView > .tab-scroll > .tab-group > .tab-btn').forEach(el => {
      const keep = el.id === 'tab_admin' || el.id === 'tab_reports';
      el.style.display = keep ? '' : 'none';
      if (el.id === 'tab_admin') el.classList.remove('hidden');
    });
  } else {
    refreshWorkspaceTabVisibility();
  }
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
    renderAttentionProjects(visibleProjects);
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
  const deniedIds = new Set();
  let warningShown = false;
  const render = () => {
    renderProjectHubList(Array.from(projectMap.values()), gridId, tab, isAll);
    if (deniedIds.size && grid && !projectMap.size) {
      grid.innerHTML = '<p class="hub-empty">No accessible assigned projects. Ask an admin to review Team Admin project assignments.</p>';
    }
  };

  ids.forEach(pid => {
    const onError = error => {
      console.warn('Assigned project skipped:', pid, error?.code || error?.message || error);
      deniedIds.add(pid);
      projectMap.delete(pid);
      render();
      if (!warningShown) {
        warningShown = true;
        showToast('Some assigned projects could not be opened. Ask an admin to review project access.', 'warn');
      }
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
        <span>${used}% used | ${peso(remaining)} remaining</span>
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

  const active = projects.filter(p => p.status === 'active');
  const activeCount = active.length;
  const completed = projects.filter(p => p.status === 'completed').length;
  const totalBudget = projects.reduce((s, p) => s + effectiveBudget(p).total, 0);
  const totalSpent = projects.reduce((s, p) => s + dashboardTotalSpent(p), 0);
  const remaining = totalBudget - totalSpent;
  const overallPct = pct(totalSpent, totalBudget);

  const critical = projects.filter(p => {
    const eff = effectiveBudget(p);
    const spent = dashboardTotalSpent(p);
    return eff.total > 0 && pct(spent, eff.total) >= 95;
  });
  const criticalCount = critical.length;

  const warning = projects.filter(p => {
    const eff = effectiveBudget(p);
    const spent = dashboardTotalSpent(p);
    const pUsed = pct(spent, eff.total);
    return pUsed >= 80 && pUsed < 95;
  });

  if (context === 'All') {
    setText('dsAllSumTotal', projects.length);
    setText('dsAllSumActive', activeCount);
    setText('dsAllSumCompleted', completed);
    setText('dsAllSumBudget', peso(totalBudget));
    setText('dsAllSumSpent', peso(totalSpent));
    setText('dsAllSumCritical', criticalCount);
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
    return;
  }

  /* --- New KPI layout --- */
  setText('dsSumCritical', criticalCount);
  setText('dsSumActive', activeCount);

  /* Overdue tasks count */
  var overdueCount = 0;
  active.forEach(function (p) {
    var rollup = dashboardRollup(p);
    var pOverdue = parseFloat(rollup.overdueTasks ?? p.openTaskCount?.overdue) || 0;
    overdueCount += pOverdue;
  });
  setText('dsSumOverdue', overdueCount);

  /* Pending approvals */
  const pendingApprovals = dashboardPendingApprovalItems(projects);
  setText('dsSumPending', pendingApprovals.length);

  /* At-risk project names */
  const criticalNames = criticalCount ? critical.map(function (p) { return p.name || p.id; }).join(', ') : '';
  const subEl = $('dsCriticalNames');
  if (subEl) subEl.textContent = criticalNames ? '&#x2192; ' + criticalNames : 'No projects at risk';

  /* Active projects sub text */
  const budgetPct = pct(totalSpent, totalBudget);
  setText('dsSumActiveSub', budgetPct + '% of budget used');

  /* Budget Health Card */
  setText('dsBudgetTotal', peso(totalBudget));
  setText('dsSumSpent', peso(totalSpent));
  var remEl = $('dsSumRemaining');
  if (remEl) {
    remEl.textContent = peso(remaining);
    remEl.className = remaining < 0 ? 'text-red' : remaining < totalBudget * 0.2 ? 'text-amber' : 'text-green';
  }
  setText('dsSumProgress', overallPct + '%');

  var fillEl = $('dsBudgetFill');
  if (fillEl) {
    var pctVal = Math.min(100, Math.max(0, overallPct));
    fillEl.style.width = pctVal + '%';
    fillEl.style.background = pctVal >= 95
      ? 'linear-gradient(90deg, var(--red), #f87171)'
      : pctVal >= 80
        ? 'linear-gradient(90deg, var(--amber), #fbbf24)'
        : 'linear-gradient(90deg, var(--green), #34d399)';
  }

  /* Inline alert banner below budget health */
  var alertBanner = $('dsAlertBanner');
  if (alertBanner) {
    if (criticalCount > 0) {
      alertBanner.className = 'dash-alert-banner alert-critical';
      alertBanner.innerHTML = '<span class="alert-icon">&#x1F525;</span> <strong>' + criticalCount + '</strong> project' + (criticalCount !== 1 ? 's' : '') + ' over budget &mdash; immediate attention required';
      alertBanner.style.display = '';
    } else if (warning.length > 0) {
      alertBanner.className = 'dash-alert-banner alert-warning';
      alertBanner.innerHTML = '<span class="alert-icon">&#x26A0;&#xFE0F;</span> <strong>' + warning.length + '</strong> project' + (warning.length !== 1 ? 's' : '') + ' approaching budget limit';
      alertBanner.style.display = '';
    } else {
      alertBanner.className = 'dash-alert-banner alert-ok';
      alertBanner.innerHTML = '<span class="alert-icon">&#x2705;</span> All projects within budget limits';
      alertBanner.style.display = '';
    }
  }

  /* Warning line in section label */
  var warnLine = $('dashWarnLine');
  if (warnLine) {
    warnLine.textContent = criticalCount > 0 ? criticalCount + ' at risk' : '';
  }
}

/* ---- Attention Projects Section (between KPIs and project grid) ---- */
function renderAttentionProjects(projects) {
  var el = $('attentionGrid');
  if (!el) return;

  var active = projects.filter(function (p) { return p.status === 'active'; });

  /* Collect all items needing attention */
  var items = [];

  active.forEach(function (p) {
    var eff = effectiveBudget(p);
    var spent = dashboardTotalSpent(p);
    var pctUsed = eff.total > 0 ? pct(spent, eff.total) : 0;
    var rollup = dashboardRollup(p);
    var openIssues = parseFloat(rollup.openIssues ?? p.siteLogRollups?.openIssues) || 0;
    var openDelays = parseFloat(rollup.openDelays ?? p.siteLogRollups?.openDelays) || 0;
    var overdueTasks = parseFloat(rollup.overdueTasks ?? p.openTaskCount?.overdue) || 0;

    /* Critical: over budget */
    if (pctUsed >= 95) {
      items.push({
        level: 'critical',
        project: p,
        icon: '&#x1F525;',
        title: (p.name || p.id) + ' &mdash; Over Budget',
        desc: pctUsed + '% of budget used (' + peso(spent) + ' spent)',
        action: 'Open Project'
      });
    }

    /* Warning: approaching limit */
    if (pctUsed >= 80 && pctUsed < 95) {
      items.push({
        level: 'warning',
        project: p,
        icon: '&#x26A0;&#xFE0F;',
        title: (p.name || p.id) + ' &mdash; Approaching Budget Limit',
        desc: pctUsed + '% of budget used &middot; ' + peso(eff.total - spent) + ' remaining',
        action: 'View Budget'
      });
    }

    /* Open issues */
    if (openIssues > 0) {
      items.push({
        level: 'warning',
        project: p,
        icon: '&#x26A0;&#xFE0F;',
        title: (p.name || p.id) + ' &mdash; ' + openIssues + ' Open Issue' + (openIssues !== 1 ? 's' : ''),
        desc: 'Unresolved site issues need attention',
        action: 'View Log'
      });
    }

    /* Overdue tasks */
    if (overdueTasks > 0) {
      items.push({
        level: 'warning',
        project: p,
        icon: '&#x23F3;',
        title: (p.name || p.id) + ' &mdash; ' + overdueTasks + ' Overdue Task' + (overdueTasks !== 1 ? 's' : ''),
        desc: 'Tasks past their due date',
        action: 'View Tasks'
      });
    }

    /* Delays */
    if (openDelays > 0) {
      items.push({
        level: 'warning',
        project: p,
        icon: '&#x1F4C5;',
        title: (p.name || p.id) + ' &mdash; ' + openDelays + ' Delay' + (openDelays !== 1 ? 's' : '') + ' Reported',
        desc: 'Schedule delays logged in site reports',
        action: 'View Site Log'
      });
    }
  });

  /* Sort: critical first, then by severity */
  items.sort(function (a, b) {
    var order = { critical: 0, warning: 1 };
    return (order[a.level] || 1) - (order[b.level] || 1);
  });

  if (!items.length) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }

  el.style.display = '';
  el.innerHTML = '<div class="sec-label">&#x1F514; Attention Required</div>' +
    items.slice(0, 6).map(function (item) {
      return '<div class="dash-attention-projects-card dash-attn-card-' + item.level + '" onclick="openProjectFromHub(\'' + escapeHtml(item.project.id) + '\')">' +
        '<span class="dash-attn-card-icon">' + item.icon + '</span>' +
        '<div class="dash-attn-card-body">' +
          '<div class="dash-attn-card-title">' + item.title + '</div>' +
          '<div class="dash-attn-card-desc">' + item.desc + '</div>' +
        '</div>' +
        '<span class="dash-attn-card-action">' + item.action + ' &#x2192;</span>' +
      '</div>';
    }).join('') +
    (items.length > 6 ? '<div class="dash-attention-projects-card" style="background:var(--surface2);border:1px solid var(--border);cursor:default;"><div class="dash-attn-card-body" style="text-align:center;color:var(--muted2);font-size:12px;">+' + (items.length - 6) + ' more items needing attention</div></div>' : '');
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
        const date = dashboardActivityWhen(time);
        const actor = p.actor ? ` by ${p.actor}` : '';
        return `
        <div class="activity-row ${dashboardActivityClass(p)}">
          <span class="activity-dot"></span>
          <div class="activity-copy">
            <strong>${escapeHtml(p.projectName || 'Untitled')}</strong>
            <span>${escapeHtml(dashboardActivityLabel(p))}${escapeHtml(actor)} | ${escapeHtml(date)}</span>
          </div>
          <button class="btn-equip-action" onclick="openProjectFromHub('${escapeHtml(p.projectId)}')">Open</button>
        </div>`;
      }
      const status = p.status === 'completed' ? 'Completed' : p.status === 'archived' ? 'Archived' : 'Active';
      const time = p.completedAt || p.archivedAt || p.updatedAt || p.createdAt || null;
      const date = time ? dashboardActivityWhen(time) : (p.createdDate || '-');
      return `
        <div class="activity-row activity-project">
          <span class="activity-dot"></span>
          <div class="activity-copy">
            <strong>${escapeHtml(p.name || 'Untitled')}</strong>
            <span>${status} | ${escapeHtml(date)}</span>
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
    const allowedToCreate = typeof canCreateProjects === 'function'
      ? canCreateProjects(user.role)
      : ['boss', 'owner', 'admin', 'pm'].includes(normalizeRole(user.role));
    if (!allowedToCreate) {
      showToast('Project creation is available to PM and Admin accounts.', 'error');
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

    $('newName').value = ''; $('newLaborBudget').value = ''; $('newMaterialBudget').value = '';
    const search = $('projectSearch');
    if (search) search.value = '';
    showHubTab('active');
    auditLog('create', 'project', newPid, { name, laborBudget, materialBudget, projectId: newPid });
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

function detachProjectDashboardListener() {
  if (_projectDashboardListener) {
    _projectDashboardListener.off();
    _projectDashboardListener = null;
  }
}

function ensureProjectDashboardUi() {
  if (!$('tab_dashboard')) {
    const tabs = document.querySelector('#workspaceView .tab-group');
    tabs?.insertAdjacentHTML('afterbegin', '<button id="tab_dashboard" class="tab-btn" onclick="switchTab(\'dashboard\')" data-role-visible="apm,pm,boss,owner,admin">&#x2302; Mission Board</button>');
  }
  if (!$('dashboardPanel')) {
    const laborPanel = $('laborPanel');
    laborPanel?.insertAdjacentHTML('beforebegin', `
      <div id="dashboardPanel" class="panel hidden">
        <div class="project-dash-grid">
          <section class="panel-card project-dash-hero">
            <div>
              <div class="panel-title">Project Workspace</div>
              <h2 id="pdName">Project</h2>
              <div id="pdMeta" class="project-dash-meta">Loading project details...</div>
            </div>
            <div id="pdStatus" class="badge badge-purple">Active</div>
          </section>

          <section class="panel-card project-budget-card">
            <div class="project-dash-section-head">
              <div>
                <div class="panel-title">Running Budget</div>
                <p class="empty-hint">Labor + material cost against current approved budget.</p>
              </div>
              <strong id="pdBudgetUsed">0%</strong>
            </div>
            <div class="project-budget-bar"><i id="pdBudgetBar"></i></div>
            <div class="project-dash-kpis">
              <div><span>Total Budget</span><strong id="pdTotalBudget">0</strong></div>
              <div><span>Total Cost</span><strong id="pdTotalCost">0</strong></div>
              <div><span>Remaining</span><strong id="pdRemaining">0</strong></div>
              <div><span>Committed</span><strong id="pdCommitted">0</strong></div>
            </div>
          </section>

          <section class="panel-card">
            <div class="panel-title">Project Profile</div>
            <div id="pdProfile" class="project-profile-list"></div>
          </section>

          <section class="panel-card">
            <div class="panel-title">Field Team</div>
            <div id="pdFieldTeam" class="project-profile-list"></div>
          </section>

          <section class="panel-card project-dash-wide">
            <div class="panel-title">Mission Board</div>
            <div id="pdOperations" class="project-dash-kpis"></div>
            <div id="pdMissionList" class="project-mission-list"></div>
          </section>

          <section class="panel-card project-dash-wide">
            <div class="panel-title">Recent Activity</div>
            <div id="pdRecentActivity" class="project-mission-list"></div>
          </section>

          <section class="panel-card project-dash-wide">
            <div class="panel-title">Quick Open</div>
            <div class="project-dash-actions">
              <button class="btn-ws-secondary" type="button" onclick="switchTab('labor')">Labor</button>
              <button class="btn-ws-secondary" type="button" onclick="switchTab('materials')">Materials</button>
              <button class="btn-ws-secondary" type="button" onclick="switchTab('sitelog')">Site Log</button>
              <button class="btn-ws-secondary" type="button" onclick="switchTab('tasks')">Tasks</button>
              <button class="btn-ws-secondary" type="button" onclick="openPmosOffice()">PMOS</button>
              <button class="btn-ws-secondary" type="button" onclick="switchTab('reports')">Reports</button>
            </div>
          </section>
        </div>
      </div>`);
  }
}

function projectAmount(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function projectPeso(value) {
  return typeof peso === 'function' ? peso(value) : `PHP ${projectAmount(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function objectRows(obj = {}) {
  return Object.entries(obj || {}).map(([id, value]) => ({ id, ...(value || {}) }));
}

function projectDateLabel(project = {}) {
  if (project.startDate) return project.startDate;
  if (project.dateStarted) return project.dateStarted;
  if (project.createdDate) return project.createdDate;
  if (project.createdAt) return new Date(project.createdAt).toLocaleDateString('en-PH');
  return '-';
}

function renderProjectDashboard(projectId, project = {}) {
  ensureProjectDashboardUi();
  const trades = objectRows(project.trades).filter(t => t.active !== false && t.status !== 'inactive' && t.archived !== true);
  const workers = objectRows(project.workers).filter(w => w.active !== false && w.status !== 'inactive' && w.status !== 'archived');
  const foremen = Array.from(new Set(trades.map(t => t.foremanName).filter(Boolean)));
  const siteLogs = objectRows(project.siteLogs);
  const tasks = objectRows(project.tasks).map(task => ({
    ...task,
    status: typeof normalizeTaskStatus === 'function'
      ? normalizeTaskStatus(task.status)
      : String(task.status || 'pending').toLowerCase()
  }));
  const activeTasks = tasks.filter(task => !['completed', 'cancelled', 'done', 'archived'].includes(task.status));
  const blockedTasks = activeTasks.filter(task => task.status === 'blocked');
  const verificationTasks = activeTasks.filter(task => task.status === 'for_verification' || task.status === 'review');
  const materialRequests = [
    ...objectRows(project.purchaseRequests),
    ...objectRows(project.pmosMaterialRequests)
  ].filter(request => !['delivered', 'closed', 'cancelled', 'archived', 'rejected'].includes(String(request.status || '').toLowerCase()));
  const criticalIssues = [
    ...objectRows(project.defects),
    ...objectRows(project.pmosIssues)
  ].filter(issue => {
    const status = String(issue.status || '').toLowerCase();
    const priority = String(issue.priority || issue.severity || '').toLowerCase();
    return !['done', 'closed', 'completed', 'archived', 'cancelled'].includes(status) &&
      ['critical', 'high', 'major'].includes(priority);
  });
  const payrollLogs = objectRows(project.payrollLogs);
  const pmosLogs = ['pmosUpdates', 'pmosSiteLogs', 'pmosIssues', 'pmosMaterialRequests', 'pmosTasks', 'pmosPhotoLogs']
    .reduce((sum, key) => sum + objectRows(project[key]).length, 0);

  const laborBudget = projectAmount(project.laborBudget);
  const materialBudget = projectAmount(project.materialBudget);
  const totalBudget = laborBudget + materialBudget;
  const laborSpent = projectAmount(project.laborSpent);
  const materialSpent = projectAmount(project.materialSpent);
  const committed = projectAmount(project.materialCommitted) + projectAmount(project.laborCommitted);
  const totalCost = laborSpent + materialSpent;
  const remaining = totalBudget - totalCost - committed;
  const usedPct = totalBudget ? Math.round(((totalCost + committed) / totalBudget) * 100) : 0;
  const address = project.address || project.projectAddress || project.siteAddress || project.location || 'Not set yet';
  const lastLog = siteLogs
    .map(log => log.date || log.savedDate || (log.savedAt ? new Date(log.savedAt).toISOString().slice(0, 10) : ''))
    .filter(Boolean)
    .sort()
    .pop() || '-';

  setText('pdName', project.name || projectId || 'Project');
  setText('pdMeta', `${address} - Started ${projectDateLabel(project)}`);
  setText('pdStatus', project.status || 'active');
  setText('pdBudgetUsed', `${usedPct}%`);
  setText('pdTotalBudget', projectPeso(totalBudget));
  setText('pdTotalCost', projectPeso(totalCost));
  setText('pdRemaining', projectPeso(remaining));
  setText('pdCommitted', projectPeso(committed));
  const budgetBar = $('pdBudgetBar');
  if (budgetBar) {
    budgetBar.style.width = `${Math.max(0, Math.min(100, usedPct))}%`;
    budgetBar.classList.toggle('is-over', usedPct > 100);
  }

  setHTML('pdProfile', `
    <div><span>Project Name</span><strong>${escapeHtml(project.name || projectId || '-')}</strong></div>
    <div><span>Project Address</span><strong>${escapeHtml(address)}</strong></div>
    <div><span>Date Started</span><strong>${escapeHtml(projectDateLabel(project))}</strong></div>
    <div><span>Status</span><strong>${escapeHtml(project.status || 'active')}</strong></div>
  `);

  const workerPreview = workers.slice(0, 8).map(w => w.name).filter(Boolean).join(', ') || 'No active workers yet';
  setHTML('pdFieldTeam', `
    <div><span>Active Workers</span><strong>${workers.length}</strong></div>
    <div><span>Trades</span><strong>${trades.length}</strong></div>
    <div><span>Foremen / Leaders</span><strong>${escapeHtml(foremen.join(', ') || 'Not set yet')}</strong></div>
    <div><span>Workers</span><strong>${escapeHtml(workerPreview)}</strong></div>
  `);

  setHTML('pdOperations', `
    <div><span>Pending Works</span><strong>${activeTasks.length}</strong></div>
    <div><span>For PM Verification</span><strong>${verificationTasks.length}</strong></div>
    <div><span>Material Requests Waiting</span><strong>${materialRequests.length}</strong></div>
    <div><span>Critical Issues</span><strong>${criticalIssues.length}</strong></div>
  `);
  const missionRows = [
    blockedTasks.length ? { level: 'danger', label: `${blockedTasks.length} blocked task${blockedTasks.length === 1 ? '' : 's'} need resolution`, tab: 'tasks' } : null,
    verificationTasks.length ? { level: 'warn', label: `${verificationTasks.length} task${verificationTasks.length === 1 ? '' : 's'} waiting for PM verification`, tab: 'tasks' } : null,
    materialRequests.length ? { level: 'warn', label: `${materialRequests.length} material request${materialRequests.length === 1 ? '' : 's'} waiting`, tab: 'materials' } : null,
    criticalIssues.length ? { level: 'danger', label: `${criticalIssues.length} critical site issue${criticalIssues.length === 1 ? '' : 's'} open`, tab: 'defects' } : null,
    !payrollLogs.length ? { level: 'info', label: 'No payroll has been compiled for this project yet', tab: 'labor' } : null,
    !siteLogs.length ? { level: 'info', label: 'No site log has been submitted yet', tab: 'sitelog' } : null
  ].filter(Boolean);
  setHTML('pdMissionList', missionRows.length
    ? missionRows.map(row => `<button type="button" class="project-mission-row is-${row.level}" onclick="switchTab('${row.tab}')">
        <span>${escapeHtml(row.label)}</span><strong>Open</strong>
      </button>`).join('')
    : '<div class="project-mission-clear">No urgent action items. Project records are up to date.</div>');

  const recentActivity = objectRows(project.activity)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 6);
  setHTML('pdRecentActivity', recentActivity.length
    ? recentActivity.map(item => `<div class="project-activity-row">
        <span>${escapeHtml(dashboardActivityLabel({ label: item.type || `${item.module || 'project'} updated` }))}</span>
        <small>${escapeHtml(item.createdByName || 'System')} | ${escapeHtml(dashboardActivityWhen(item.createdAt))}</small>
      </div>`).join('')
    : `<div class="project-mission-clear">No project activity recorded yet. Latest site log: ${escapeHtml(lastLog)}.</div>`);
}

function countProjectOpenItems(project = {}) {
  const rows = ['tasks', 'defects', 'pmosIssues', 'pmosTasks', 'pmosMaterialRequests']
    .flatMap(key => objectRows(project[key]).map(item => ({ ...item, sourceKey: key })));
  return rows.filter(item => {
    const status = String(item.status || '').toLowerCase();
    return !['done', 'closed', 'completed', 'archived', 'delivered', 'cancelled'].includes(status);
  }).length;
}

function initProjectDashboard(projectId = window._currentPid) {
  ensureProjectDashboardUi();
  detachProjectDashboardListener();
  if (!projectId) return;
  const ref = db.ref(`projects/${projectId}`);
  _projectDashboardListener = ref;
  ref.on('value', snap => {
    renderProjectDashboard(projectId, snap.val() || {});
  }, err => {
    console.warn('Project dashboard listener failed:', err);
    setHTML('pdProfile', '<p class="empty-hint">Could not load project dashboard.</p>');
  });
}

function openProjectFromHub(pid) {
  if (getAppPage() === 'dashboard') {
    window.location.href = appUrl('workspace', { projectId: pid });
    return;
  }
  enterProject(pid);
}

// ============================================================
//  WORKSPACE - Enter / Exit
// ============================================================

async function enterProject(pid) {
  if (!canAccessProject(pid)) {
    showToast('You do not have access to this project.', 'error');
    return false;
  }

  const p = await loadProjectForCurrentRole(pid);
  if (!p) { showToast('Project not found.', 'error'); return false; }

  window._currentPid = pid;
  window._adminWorkspaceMode = false;
  setText('wsName', p.name || 'Untitled');
  setText('wsContextLabel', 'Active Site');
  ensureProjectDashboardUi();
  setAdminWorkspaceMode(false);
  $('hubView').classList.add('hidden');
  $('systemReportsView')?.classList.add('hidden');
  $('pmosOfficeView')?.classList.add('hidden');
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
  switchTab('dashboard');
  handleNotificationRouteFocus();

  auditLog('enter', 'project', pid, { name: p.name });
  return true;
}

function handleNotificationRouteFocus() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('fromNotif') !== '1') return;
  const tab = params.get('tab') || 'dashboard';
  const allowedTabs = ['dashboard', 'labor', 'materials', 'billing', 'changeorders', 'sitelog', 'tasks', 'reports'];
  const targetTab = allowedTabs.includes(tab) ? tab : 'dashboard';
  setTimeout(() => {
    switchTab(targetTab);
    const panel = $(`${targetTab}Panel`) || $('workspaceView');
    if (!panel) return;
    panel.classList.remove('notif-route-highlight');
    void panel.offsetWidth;
    panel.classList.add('notif-route-highlight');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => panel.classList.remove('notif-route-highlight'), 2600);
  }, 250);
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
  detachProjectDashboardListener();
  if (typeof detachNotifications === 'function') detachNotifications();

  $('workspaceView').classList.add('hidden');
  setAdminWorkspaceMode(false);
  $('systemReportsView')?.classList.add('hidden');
  $('pmosOfficeView')?.classList.add('hidden');
  $('hubView').classList.remove('hidden');
  window._currentPid = null;
  window._currentProjectStatus = null;
  window._isReadOnly = false;
  setText('wsContextLabel', 'Active Site');
  showHubTab('active');
}

function switchTab(tab) {
  if (window._adminWorkspaceMode && !['admin', 'reports'].includes(tab)) {
    tab = 'admin';
  }
  $('systemReportsView')?.classList.add('hidden');
  if (tab !== 'pmos') $('pmosOfficeView')?.classList.add('hidden');
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('tab-active'));
  $(`tab_${tab}`)?.classList.add('tab-active');
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  $(`${tab}Panel`)?.classList.remove('hidden');

  // Trigger view-specific renders
  if (tab === 'dashboard') initProjectDashboard();
  if (tab === 'tasks') renderGanttView();
  if (tab === 'admin' && typeof initTeamAdmin === 'function') initTeamAdmin();
  if (tab === 'reports') initReports();
}

function toggleExtraTabs(forceValue) {
  const current = typeof getFeatureFlag === 'function' ? getFeatureFlag('extras', true) : true;
  const next = typeof forceValue === 'boolean' ? forceValue : !current;
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
  const canManage = typeof canManageProjectAssignments === 'function'
    ? canManageProjectAssignments(window._currentUser?.role)
    : (typeof isBoss === 'function' && isBoss(window._currentUser?.role));
  if (!canManage) {
    showToast('Project assignment access is available to PM and Admin accounts.', 'error');
    return;
  }
  $('hubView')?.classList.add('hidden');
  $('systemReportsView')?.classList.add('hidden');
  $('pmosOfficeView')?.classList.add('hidden');
  $('workspaceView')?.classList.remove('hidden');
  setAdminWorkspaceMode(true);
  window._currentPid = null;
  setText('wsContextLabel', 'Admin Area');
  setText('wsName', 'Team Admin');
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  $('adminPanel')?.classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('tab-active'));
  $('tab_admin')?.classList.remove('hidden');
  $('tab_admin')?.classList.add('tab-active');
  if (typeof initTeamAdmin === 'function') initTeamAdmin();
  if (typeof switchAdminSection === 'function') switchAdminSection('team');
}

function switchAdminSection(section) {
  const sections = ['summary', 'team', 'requests', 'audit', 'system'];
  sections.forEach(name => {
    const panel = $(`adminSection_${name}`);
    const tab = $(`adminTab_${name}`);
    if (panel) panel.classList.toggle('hidden', name !== section);
    if (tab) tab.classList.toggle('tab-active', name === section);
  });
  if (section === 'team' && typeof initTeamAdmin === 'function') initTeamAdmin();
  if (section === 'requests' && typeof initLifecycleRequests === 'function') initLifecycleRequests();
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

// ============================================================
//  PROJECT NOTES
// ============================================================
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
  // Escape: Go back to hub from workspace or close overlays
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // Don't escape from form inputs
    const tag = document.activeElement?.tagName || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
      document.activeElement?.blur();
      e.preventDefault();
      return;
    }
    // Close notification dropdown if open
    const notifDropdown = document.getElementById('notifDropdown');
    if (notifDropdown && !notifDropdown.classList.contains('hidden')) {
      e.preventDefault();
      notifDropdown.classList.add('hidden');
      return;
    }
    // Close any modal overlays
    const overlay = document.querySelector('.modal-overlay, .dialog-overlay, [id*="Modal"], [id*="modal"]');
    if (overlay && overlay.style?.display !== 'none' && !overlay.classList?.contains('hidden')) {
      e.preventDefault();
      overlay.remove ? overlay.remove() : overlay.classList.add('hidden');
      return;
    }
    // Exit workspace views back to hub
    const workspace = $('workspaceView');
    if (workspace && !workspace.classList.contains('hidden')) {
      const hub = $('hubView');
      if (hub && !hub.classList.contains('hidden')) {
        // Already looking at hub, don't exit
        return;
      }
      e.preventDefault();
      exitHub();
      return;
    }
    // Close sub-views
    const systemReports = $('systemReportsView');
    if (systemReports && !systemReports.classList.contains('hidden')) {
      e.preventDefault();
      systemReports.classList.add('hidden');
      $('hubView')?.classList.remove('hidden');
      return;
    }
    const pmosOffice = $('pmosOfficeView');
    if (pmosOffice && !pmosOffice.classList.contains('hidden')) {
      e.preventDefault();
      pmosOffice.classList.add('hidden');
      $('hubView')?.classList.remove('hidden');
    }
  }
  // Ctrl+1-8: Switch workspace tabs
  if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '8') {
    const tabs = ['dashboard', 'labor', 'materials', 'billing', 'sitelog', 'changeorders', 'suppliers', 'reports'];
    const idx = parseInt(e.key) - 1;
    const workspace = $('workspaceView');
    if (tabs[idx] && workspace && !workspace.classList.contains('hidden')) {
      const tabBtn = $(`tab_${tabs[idx]}`);
      if (tabBtn && tabBtn.style.display !== 'none') {
        switchTab(tabs[idx]);
        e.preventDefault();
      }
    }
  }
  // ? Show keyboard shortcuts help
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const active = document.activeElement;
    if (!active || active === document.body || active === $('hubView')) {
      e.preventDefault();
      showShortcutsHelp();
    }
  }
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    showToast('Auto-saved to Firebase', 'success');
  }
});

// ============================================================
//  GLOBAL ERROR HANDLER
//  Catches unhandled errors and shows a user-friendly message.
//  Prevents the app from silently breaking.
// ============================================================
window.addEventListener('error', e => {
  console.error('Global error:', e.error);
  showToast('Something went wrong. Please refresh the page if problems persist.', 'error');
});

window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled promise rejection:', e.reason);
  showToast('A background task failed. Please try again.', 'error');
});

// ============================================================
//  PROGRESS RING (SVG Donut)
// ============================================================
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

// ============================================================
//  EDIT PROJECT
// ============================================================
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

// ============================================================
//  SCROLL TO SECTION HELPER
// ============================================================
function scrollToSection(id) {
  var el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//  DASHBOARD ALERTS BAR
// ============================================================
function renderDashboardAlerts(projects) {
  const active = projects.filter(p => p.status === 'active');
  const activeCount = active.length;

  /* --- Critical: projects at risk (95%+ budget used) --- */
  const criticalProjects = active.filter(p => {
    const eff = effectiveBudget(p);
    const spent = dashboardTotalSpent(p);
    return eff.total > 0 && pct(spent, eff.total) >= 95;
  });

  /* --- Warning: projects approaching limit or with open issues/delays --- */
  const warningProjects = active.filter(p => {
    const eff = effectiveBudget(p);
    const spent = dashboardTotalSpent(p);
    const pUsed = pct(spent, eff.total);
    const rollup = dashboardRollup(p);
    const openIssues = parseFloat(rollup.openIssues ?? p.siteLogRollups?.openIssues) || 0;
    const openDelays = parseFloat(rollup.openDelays ?? p.siteLogRollups?.openDelays) || 0;
    return (pUsed >= 80 && pUsed < 95) || openIssues > 0 || openDelays > 0;
  });

  const pendingApprovals = dashboardPendingApprovalItems(projects);
  const warningCount = warningProjects.length + pendingApprovals.length;

  /* Build attention lists */
  function attnItem(icon, name, detail, projectId) {
    const wsLink = projectId ? ` onclick="openProjectFromHub('${escapeHtml(projectId)}')"` : '';
    return `<div class="dash-attn-item"${wsLink}><span>${icon}</span> <strong>${escapeHtml(name || '')}</strong> ${detail ? '&middot; ' + escapeHtml(detail) : ''}</div>`;
  }

  /* Critical list */
  var criticalHtml = criticalProjects.length
    ? criticalProjects.map(p => attnItem('&#x1F525;', p.name, pct(dashboardTotalSpent(p), effectiveBudget(p).total) + '% used', p.id)).join('')
    : '<span class="dash-attn-item" style="opacity:0.6">All projects within budget</span>';

  /* Warning list */
  var warningItems = [];
  warningProjects.forEach(p => {
    const eff = effectiveBudget(p);
    const spent = dashboardTotalSpent(p);
    const pUsed = pct(spent, eff.total);
    if (pUsed >= 80 && pUsed < 95) {
      warningItems.push(attnItem('&#x1F4B0;', p.name, pUsed + '% budget used', p.id));
    }
    const rollup = dashboardRollup(p);
    const openIssues = parseFloat(rollup.openIssues ?? p.siteLogRollups?.openIssues) || 0;
    const openDelays = parseFloat(rollup.openDelays ?? p.siteLogRollups?.openDelays) || 0;
    if (openIssues > 0) warningItems.push(attnItem('&#x26A0;&#xFE0F;', p.name, openIssues + ' open issues', p.id));
    if (openDelays > 0) warningItems.push(attnItem('&#x23F3;', p.name, openDelays + ' delays', p.id));
  });
  pendingApprovals.forEach(a => {
    warningItems.push(attnItem('&#x1F4CB;', a.projectName, a.label));
  });
  var warningHtml = warningItems.length ? warningItems.slice(0, 6).join('') : '<span class="dash-attn-item" style="opacity:0.6">No warnings</span>';

  /* Info list */
  var infoHtml = activeCount
    ? active.slice(0, 5).map(p => {
        const eff = effectiveBudget(p);
        const spent = dashboardTotalSpent(p);
        const statusIcon = p.status === 'active' ? '&#x1F7E2;' : '&#x1F534;';
        return attnItem(statusIcon, p.name, peso(spent) + ' / ' + peso(eff.total), p.id);
      }).join('') + (activeCount > 5 ? '<span class="dash-attn-item" style="opacity:0.6">+' + (activeCount - 5) + ' more projects</span>' : '')
    : '<span class="dash-attn-item" style="opacity:0.6">No active projects</span>';

  setText('dashAttnCriticalCount', criticalProjects.length);
  setText('dashAttnWarningCount', warningCount);
  setText('dashAttnInfoCount', activeCount);
  setHTML('dashAttnCriticalList', criticalHtml);
  setHTML('dashAttnWarningList', warningHtml);
  setHTML('dashAttnInfoList', infoHtml);

  /* Toggle visibility of attention groups */
  var criticalEl = $('dashAttnCritical');
  if (criticalEl) criticalEl.style.display = criticalProjects.length ? '' : 'none';
}

// ============================================================
//  COMPLETED PROJECTS SUMMARY
// ============================================================
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

// ============================================================
//  HUB CSV EXPORT
// ============================================================
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

// ============================================================
//  MANUAL REFRESH
// ============================================================
function refreshHub() {
  const btn = $('refreshBtn');
  if (btn) {
    btn.classList.add('animate-spin');
    setTimeout(() => btn.classList.remove('animate-spin'), 1000);
  }
  renderHub();
  showToast('Dashboard refreshed', 'success');
}

// -- Expose --------------------------------------------------
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
