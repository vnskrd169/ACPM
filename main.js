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
window._isReadOnly = false;
// Overwritten by auth.js once Firebase Auth resolves — this is only
// a pre-auth fallback so other modules don't crash on null access.
window._currentUser = { uid: 'anonymous', role: 'viewer', name: 'System', projects: [], bossOf: [] };
window._allowedProjects = null;

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

function renderHub() {
  detachHubListeners();
  const tab = document.querySelector('.hub-tab.tab-active')?.id?.replace('hubTab_', '') || 'active';
  const isAll = tab === 'all';

  const gridId = isAll ? 'allProjectsGrid' : (tab === 'active' ? 'projectGrid' : 'completedGrid');
  const grid = $(gridId);
  if (grid) grid.innerHTML = '<p class="hub-empty">Loading...</p>';

  // Role-based filtering
  const user = window._currentUser;
  let projectsRef;
  if (isAll) {
    projectsRef = db.ref('projects');
  } else {
    projectsRef = db.ref('projects').orderByChild('status').equalTo(tab);
  }

  projectsRef.on('value', snap => {
    const el = $(gridId);
    if (!el) return;
    el.innerHTML = '';

    const projects = [];
    snap.forEach(c => {
      const pid = c.key;
      // Filter by role
      if (!canAccessProject(pid)) return;
      projects.push({ id: pid, ...c.val() });
    });
    projects.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (!projects.length) {
      el.innerHTML = `<p class="hub-empty">No ${isAll ? '' : tab} projects.</p>`;
      if (isAll) {
        renderDashboardSummary([], 'All');
        renderComparison([], 'comparisonViewAll');
        renderDashboardAlerts([]);
      } else if (tab === 'active') {
        renderDashboardSummary([]);
        renderComparison([]);
        renderDashboardAlerts([]);
      } else {
        renderCompletedSummary([]);
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    projects.forEach(p => fragment.appendChild(buildProjectCard(p)));
    el.appendChild(fragment);

    if (isAll) {
      renderDashboardSummary(projects, 'All');
      renderComparison(projects, 'comparisonViewAll');
      renderDashboardAlerts(projects);
    } else if (tab === 'active') {
      renderDashboardSummary(projects);
      renderComparison(projects);
      renderDashboardAlerts(projects);
    } else {
      renderCompletedSummary(projects);
    }

    // Cache for offline
    projects.forEach(p => cacheProject(p.id, p));
  }, error => {
    console.error('Firebase error:', error);
    if (grid) grid.innerHTML = `<p class="hub-empty">Error loading projects. Check console.</p>`;
    showToast('Error loading projects: ' + error.message, 'error');
  });
  _hubListeners.push(projectsRef);
}

function buildProjectCard(p) {
    const div = document.createElement('div');
    div.className = `proj-card ${p.status === 'completed' ? 'proj-card-done' : ''}`;
    div.setAttribute('data-name', (p.name || '').toLowerCase());
    div.setAttribute('data-pid', p.id);

    const eff = effectiveBudget(p);
    const laborSpent = parseFloat(p.laborSpent) || 0;
    const matSpent = parseFloat(p.materialSpent) || 0;
    const totalSpent = laborSpent + matSpent;
    const remaining = eff.total - totalSpent;
    const pctUsed = pct(totalSpent, eff.total);

    const pUsedTotal = pctUsed;
    const pUsedLabor = pct(laborSpent, eff.labor);
    const pUsedMat   = pct(matSpent, eff.material);

    const wTotal = Math.min(pUsedTotal, 100);
    const wLabor = Math.min(pUsedLabor, 100);
    const wMat   = Math.min(pUsedMat, 100);
    const dTotal = wTotal > 0 && wTotal < 2 ? 2 : wTotal;
    const dLabor = wLabor > 0 && wLabor < 2 ? 2 : wLabor;
    const dMat   = wMat   > 0 && wMat   < 2 ? 2 : wMat;

    const isWarning = pctUsed >= 80 && pctUsed < 95;
    const isCritical = pctUsed >= 95;

    const statusClass = p.status === 'completed' ? 'completed-tag' : 'active-tag';
    const statusText = p.status === 'completed' ? 'COMPLETED' : 'ACTIVE';

    const hasDelta = (parseFloat(p.laborBudgetDelta) || 0) || (parseFloat(p.materialBudgetDelta) || 0);
    const coNote = hasDelta
      ? `<div class="budget-sub" style="color:var(--purple-xl)">\u21BB; includes approved change orders</div>` : '';

    // Health score indicator
    const health = typeof calculateProjectHealth === 'function' ? calculateProjectHealth(p) : { score: 100, warnings: [] };
    const healthColor = health.score >= 80 ? 'var(--green)' : health.score >= 60 ? 'var(--amber)' : 'var(--red)';
    const healthBadge = `<span class="health-mini" style="color:${healthColor}">\u2665 ${health.score}</span>`;

    div.innerHTML = `
      <div class="proj-card-top">
        <div>
          <span class="proj-label">PROJECT</span>
          <h3 class="proj-name">${escapeHtml(p.name || 'Untitled')}</h3>
          <span class="proj-date">Created ${p.createdDate || '\u2014'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${healthBadge}
          ${buildProgressRing(pctUsed, isCritical, isWarning)}
          <span class="${statusClass}">${statusText}</span>
        </div>
      </div>
      <div class="budget-section">
        <div class="budget-row">
          <span class="budget-label">\u1F4B0; Total Budget</span>
          <span class="budget-val">${peso(eff.total)}</span>
        </div>
        <div class="mini-bar">
          <div class="mini-fill ${budgetBarClass(pUsedTotal)}" style="width:${dTotal}%"></div>
        </div>
        <div class="budget-sub">
          ${isCritical ? '<span class="warn-tag critical">\u26A0; CRITICAL</span>' : isWarning ? '<span class="warn-tag">\u26A0; WARNING</span>' : '<span style="color:var(--green)">\u2713; Healthy</span>'}
          <span>${peso(totalSpent)} spent \u00B7; ${pctUsed}%</span>
        </div>
        ${coNote}
        <div class="budget-row" style="margin-top:6px">
          <span class="budget-label">\u1F477; Labor</span>
          <span class="budget-val">${peso(eff.labor)}</span>
        </div>
        <div class="mini-bar">
          <div class="mini-fill ${budgetBarClass(pUsedLabor)}" style="width:${dLabor}%"></div>
        </div>
        <div class="budget-sub">${peso(laborSpent)} spent \u00B7; ${pUsedLabor}%</div>
        <div class="budget-row" style="margin-top:6px">
          <span class="budget-label">\u1F4E6; Materials</span>
          <span class="budget-val">${peso(eff.material)}</span>
        </div>
        <div class="mini-bar">
          <div class="mini-fill ${budgetBarClass(pUsedMat)}" style="width:${dMat}%"></div>
        </div>
        <div class="budget-sub">${peso(matSpent)} spent \u00B7; ${pUsedMat}%</div>
      </div>
      <div class="proj-actions">
        ${p.status === 'active'
          ? `<button class="proj-open-btn" data-action="open">Open Workspace \u2192;</button>
             <button class="btn-complete" data-action="complete">\u2713; Done</button>`
          : `<button class="btn-reopen" data-action="reopen">\u21BB; Reopen</button>`
        }
        ${canEditProject(p.id) ? `
          <button class="btn-edit-proj" data-action="edit">\u270E; Edit</button>
          <button class="btn-delete" data-action="delete">\u1F5D1;</button>
        ` : ''}
      </div>
    `;

    div.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'open') enterProject(p.id);
      else if (action === 'complete') markComplete(p.id);
      else if (action === 'reopen') reopenProject(p.id);
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
  const totalSpent = projects.reduce((s, p) =>
    s + (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0), 0);
  const remaining = totalBudget - totalSpent;
  const overallPct = pct(totalSpent, totalBudget);

  const critical = projects.filter(p => {
    const eff = effectiveBudget(p);
    const spent = (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0);
    return pct(spent, eff.total) >= 95;
  }).length;

  const warning = projects.filter(p => {
    const eff = effectiveBudget(p);
    const spent = (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0);
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
      ? `<div class="budget-warn-bar warn-critical">\u26A0; ${critical} project${critical !== 1 ? 's' : ''} with CRITICAL budget usage!</div>`
      : warning > 0
        ? `<div class="budget-warn-bar warn-high">\u26A0; ${warning} project${warning !== 1 ? 's' : ''} with HIGH budget usage.</div>`
        : `<div style="font-size:12px;color:var(--green);padding:8px 0">\u2713; All projects are within budget limits.</div>`;
}

function renderComparison(projects, targetId = 'comparisonView') {
  const el = $(targetId);
  if (!el) return;

  if (projects.length < 2) {
    el.innerHTML = '<p class="empty-hint">Add 2+ projects to compare budgets.</p>';
    return;
  }

  const totals = projects.map(p => effectiveBudget(p).total);
  const maxBudget = Math.max(...totals);

  el.innerHTML = projects.map((p, i) => {
    const eff = effectiveBudget(p);
    const spent = (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0);
    const pUsed = pct(spent, eff.total);
    const barWidth = maxBudget ? (totals[i] / maxBudget) * 100 : 0;
    return `
      <div class="cmp-row">
        <span class="cmp-name">${escapeHtml(p.name || 'Untitled')}</span>
        <div class="cmp-bars">
          <div class="cmp-bar-wrap"><div class="mini-fill ${budgetBarClass(pUsed)}" style="width:${barWidth}%"></div></div>
        </div>
        <span class="cmp-pct">${pUsed}%</span>
        <span class="cmp-total">${peso(spent)} / ${peso(eff.total)}</span>
      </div>`;
  }).join('');
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
    auditLog('create', 'project', null, { name, laborBudget, materialBudget });
    showToast(`Project "${name}" created!`);
  });
}

async function markComplete(pid) {
  if (!canEditProject(pid)) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Mark this project as completed?\n\nThis will lock the project for editing.')) return;
  await safeDb(() => db.ref(`projects/${pid}`).update({ status: 'completed', completedAt: Date.now() }), 'Failed to update');
  auditLog('complete', 'project', pid, {});
  showToast('Project marked as completed');
}

async function reopenProject(pid) {
  if (!canEditProject(pid)) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Reopen this project?')) return;
  await safeDb(() => db.ref(`projects/${pid}`).update({ status: 'active', reopenedAt: Date.now() }), 'Failed to update');
  auditLog('reopen', 'project', pid, {});
  showToast('Project reopened');
}

async function deleteProject(pid) {
  if (!canEditProject(pid)) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('\u26A0\uFE0F; WARNING: This will permanently delete ALL project data including workers, timecards, payroll, materials, billing, and site logs.\n\nClick OK to proceed to typed confirmation.')) return;
  const confirmText = prompt('Type DELETE to confirm permanent deletion:');
  if (confirmText !== 'DELETE') { showToast('Deletion cancelled.', 'warn'); return; }

  await safeDb(() => db.ref(`projects/${pid}`).remove(), 'Failed to delete');
  auditLog('delete', 'project', pid, {});
  showToast('Project and all data deleted', 'warn');
}

function detachHubListeners() {
  _hubListeners.forEach(ref => ref.off());
  _hubListeners = [];
}

// ════════════════════════════════════════════════════════════
//  WORKSPACE — Enter / Exit
// ════════════════════════════════════════════════════════════

async function enterProject(pid) {
  if (!canAccessProject(pid)) {
    showToast('You do not have access to this project.', 'error');
    return;
  }

  window._currentPid = pid;
  const snap = await db.ref(`projects/${pid}`).once('value');
  const p = snap.val();
  if (!p) { showToast('Project not found.', 'error'); return; }

  setText('wsName', p.name || 'Untitled');
  $('hubView').classList.add('hidden');
  $('workspaceView').classList.remove('hidden');

  window._isReadOnly = false;
  $('lockedBanner')?.classList.add('hidden');
  document.querySelectorAll('.panel').forEach(pn => pn.classList.remove('read-only'));

  // Init all modules
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

  // Load project notes
  loadProjectNotes(pid);

  switchTab('labor');
  auditLog('enter', 'project', pid, { name: p.name });
}

function exitHub() {
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
  detachNotifications();

  $('workspaceView').classList.add('hidden');
  $('hubView').classList.remove('hidden');
  window._currentPid = null;
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
  window._isReadOnly = false;
  $('lockedBanner')?.classList.add('hidden');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('read-only'));
  auditLog('unlock', 'project', window._currentPid, {});
  showToast('Workspace unlocked for editing');
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

// ════════════════════════════════════════════════════════════
//  PROJECT NOTES
// ════════════════════════════════════════════════════════════
function loadProjectNotes(pid) {
  db.ref(`projects/${pid}/notes`).on('value', snap => {
    const ta = $('projectNotesInput');
    if (ta && document.activeElement !== ta) {
      ta.value = snap.val()?.text || '';
    }
  });
}

async function saveProjectNotes() {
  const pid = window._currentPid;
  if (!pid) return;
  if (!canEditProject(pid)) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
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
    if (tabs[idx] && !$('workspaceView').classList.contains('hidden')) {
      switchTab(tabs[idx]);
      e.preventDefault();
    }
  }
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    showToast('Auto-saved to Firebase \u2601\uFE0F;', 'success');
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
  if (!canEditProject(pid)) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
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
  if (!canEditProject(pid)) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const vName = validateProjectName($('editProjName')?.value);
  if (!vName.ok) { showToast(vName.msg, 'error'); return; }
  const name = vName.value;

  const vLabor = validateBudget($('editProjLaborBudget')?.value);
  if (!vLabor.ok) { showToast(vLabor.msg, 'error'); return; }
  const laborBudget = vLabor.value;

  const vMaterial = validateBudget($('editProjMaterialBudget')?.value);
  if (!vMaterial.ok) { showToast(vMaterial.msg, 'error'); return; }
  const materialBudget = vMaterial.value;

  const dupCheck = await db.ref('projects').orderByChild('name').equalTo(name).once('value');
  if (dupCheck.exists()) {
    const keys = Object.keys(dupCheck.val());
    if (keys.length > 1 || keys[0] !== pid) {
      showToast('A project with that name already exists.', 'error'); return;
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
    const spent = (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0);
    return pct(spent, eff.total) >= 95;
  }).length;

  const warning = projects.filter(p => {
    const eff = effectiveBudget(p);
    const spent = (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0);
    const pUsed = pct(spent, eff.total);
    return pUsed >= 80 && pUsed < 95;
  }).length;

  const active = projects.filter(p => p.status === 'active').length;
  const totalBudget = projects.reduce((s, p) => s + effectiveBudget(p).total, 0);
  const totalSpent = projects.reduce((s, p) =>
    s + (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0), 0);

  if (critical > 0) {
    el.className = 'dashboard-alerts warn-critical';
    el.innerHTML = `\u26A0\uFE0F; <strong>${critical} project${critical !== 1 ? 's' : ''}</strong> with CRITICAL budget usage &nbsp;|&nbsp; ${warning} warning &nbsp;|&nbsp; ${active} active &nbsp;|&nbsp; Budget: ${peso(totalSpent)} / ${peso(totalBudget)}`;
  } else if (warning > 0) {
    el.className = 'dashboard-alerts warn-high';
    el.innerHTML = `\u26A0\uFE0F; <strong>${warning} project${warning !== 1 ? 's' : ''}</strong> approaching budget limit &nbsp;|&nbsp; ${active} active &nbsp;|&nbsp; Budget: ${peso(totalSpent)} / ${peso(totalBudget)}`;
  } else if (projects.length) {
    el.className = 'dashboard-alerts warn-ok';
    el.innerHTML = `\u2713; All ${active} active project${active !== 1 ? 's' : ''} within budget &nbsp;|&nbsp; Total: ${peso(totalSpent)} / ${peso(totalBudget)}`;
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
  const totalSpent = projects.reduce((s, p) =>
    s + (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0), 0);
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
    const snap = await db.ref('projects').once('value');
    const projects = [];
    snap.forEach(c => {
      if (canAccessProject(c.key)) projects.push({ id: c.key, ...c.val() });
    });
    projects.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (!projects.length) { showToast('No projects to export.', 'warn'); return; }

    let csv = 'Project Name,Status,Created Date,Labor Budget,Material Budget,Total Budget,Labor Spent,Material Spent,Total Spent,Remaining,% Used,Health Score\\n';
    projects.forEach(p => {
      const eff = effectiveBudget(p);
      const laborSpent = parseFloat(p.laborSpent) || 0;
      const matSpent = parseFloat(p.materialSpent) || 0;
      const totalSpent = laborSpent + matSpent;
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
window.editProject = editProject;
window.openEditProjectModal = openEditProjectModal;
window.closeEditProjectModal = closeEditProjectModal;
window.enterProject = enterProject;
window.openTeamAdmin = openTeamAdmin;
window.switchAdminSection = switchAdminSection;
window.exitHub = exitHub;
window.switchTab = switchTab;
window.unlockForEdit = unlockForEdit;
window.exportAllData = exportAllData;
window.filterProjects = filterProjects;
window.showHubTab = showHubTab;
window.saveProjectNotes = saveProjectNotes;
window.exportHubCSV = exportHubCSV;
window.refreshHub = refreshHub;
window.renderDashboardAlerts = renderDashboardAlerts;
