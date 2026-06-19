// ════════════════════════════════════════════════════════════
//  ACPM — main.js
//  Firebase init, Hub (project dashboard), Workspace lifecycle.
//  Shared helpers ($, peso, escapeHtml, escapeCsv, withBusy,
//  delegateEvent, normalizeInvKey, auditLog, etc.) live in utils.js.
// ════════════════════════════════════════════════════════════

// ── Firebase Config (v9 modular) ─────────────────────────────
// TODO: Migrate to Firestore.
// TODO: Replace with real Firebase Auth identity.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getDatabase, ref, onValue, get, set, update, push, remove, query, orderByChild, equalTo, off
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA",
  authDomain: "acpm-project-system.firebaseapp.com",
  databaseURL: "https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "acpm-project-system",
  storageBucket: "acpm-project-system.firebasestorage.app",
  messagingSenderId: "330800177544",
  appId: "1:330800177544:web:8f29dcd81ca39976849a3d"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Expose for other (still-compat-shaped) module files during migration.
// Once every module file is converted to modular imports, this line can be removed.
window._db = db;
// ── Globals ───────────────────────────────────────────────
let _currentPid = null;
let _hubListeners = [];
let _isReadOnly = false;
let _currentUser = { uid: 'anonymous', role: 'admin', name: 'System' }; // TODO: Firebase Auth

// ════════════════════════════════════════════════════════════
//  Effective-budget helper
//  Baselines (laborBudget/materialBudget) are IMMUTABLE.
//  Change orders contribute a derived delta stored on the project.
//  Effective = baseline + delta. Used by hub + workspace everywhere.
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

window.onload = () => {
  try {
    const connectedRef = ref(db, '.info/connected');
    onValue(connectedRef, snap => {
      const badge = $('syncBadge');
      if (snap.val() === true) {
        if (badge) { badge.textContent = '☁️ Synced'; badge.className = 'badge badge-green'; }
      } else {
        if (badge) { badge.textContent = '⚠️ Offline'; badge.className = 'badge badge-amber'; }
        showToast('Working offline. Changes will sync when connected.', 'warn');
      }
    });
  } catch (e) {
    console.error('Firebase connection check failed:', e);
  }

  showHubTab('active');
  initPWA();
};

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
}

function renderHub() {
  detachHubListeners();
  const tab = document.querySelector('.hub-tab.tab-active')?.id?.replace('hubTab_', '') || 'active';
  const isActive = tab === 'active';

  const grid = isActive ? $('projectGrid') : $('completedGrid');
  if (grid) grid.innerHTML = '<p class="hub-empty">Loading...</p>';

  const projectsRef = query(ref(db, 'projects'), orderByChild('status'), equalTo(isActive ? 'active' : 'completed'));

  const unsubscribe = onValue(projectsRef, snap => {
    const el = isActive ? $('projectGrid') : $('completedGrid');
    if (!el) return;
    el.innerHTML = '';

    const projects = [];
    snap.forEach(c => projects.push({ id: c.key, ...c.val() }));
    projects.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (!projects.length) {
      el.innerHTML = `<p class="hub-empty">No ${isActive ? 'active' : 'completed'} projects. Create one above!</p>`;
      renderDashboardSummary([]);
      renderComparison([]);
      return;
    }

    const fragment = document.createDocumentFragment();
    projects.forEach(p => fragment.appendChild(buildProjectCard(p)));
    el.appendChild(fragment);

    renderDashboardSummary(projects);
    renderComparison(projects);
  }, error => {
    console.error('Firebase error:', error);
    if (grid) grid.innerHTML = `<p class="hub-empty">Error loading projects. Check console.</p>`;
    showToast('Error loading projects: ' + error.message, 'error');
  });
  _hubListeners.push(unsubscribe);
}

// Hub card uses data-pid attributes; one delegated listener handles all actions.
// No user-controlled text is interpolated into onclick.
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

  const isWarning = pctUsed >= 80 && pctUsed < 95;
  const isCritical = pctUsed >= 95;

  const statusClass = p.status === 'completed' ? 'completed-tag' : 'active-tag';
  const statusText = p.status === 'completed' ? 'COMPLETED' : 'ACTIVE';

  const hasDelta = (parseFloat(p.laborBudgetDelta) || 0) || (parseFloat(p.materialBudgetDelta) || 0);
  const coNote = hasDelta
    ? `<div class="budget-sub" style="color:var(--purple-xl)">↻ includes approved change orders</div>` : '';

  div.innerHTML = `
    <div class="proj-card-top">
      <div>
        <span class="proj-label">PROJECT</span>
        <h3 class="proj-name">${escapeHtml(p.name || 'Untitled')}</h3>
        <span class="proj-date">Created ${p.createdDate || '—'}</span>
      </div>
      <span class="${statusClass}">${statusText}</span>
    </div>
    <div class="budget-section">
      <div class="budget-row">
        <span class="budget-label">💰 Total Budget</span>
        <span class="budget-val">${peso(eff.total)}</span>
      </div>
      <div class="mini-bar">
        <div class="mini-fill ${budgetBarClass(pctUsed)}" style="width:${Math.min(pctUsed, 100)}%"></div>
      </div>
      <div class="budget-sub">
        ${isCritical ? '<span class="warn-tag critical">⚠ CRITICAL</span>' : isWarning ? '<span class="warn-tag">⚠ WARNING</span>' : '<span style="color:var(--green)">✓ Healthy</span>'}
        <span>${peso(totalSpent)} spent · ${pctUsed}%</span>
      </div>
      ${coNote}
      <div class="budget-row" style="margin-top:6px">
        <span class="budget-label">👷 Labor</span>
        <span class="budget-val">${peso(eff.labor)}</span>
      </div>
      <div class="mini-bar">
        <div class="mini-fill ${budgetBarClass(pct(laborSpent, eff.labor))}" style="width:${Math.min(pct(laborSpent, eff.labor), 100)}%"></div>
      </div>
      <div class="budget-sub">${peso(laborSpent)} spent · ${pct(laborSpent, eff.labor)}%</div>
      <div class="budget-row" style="margin-top:6px">
        <span class="budget-label">📦 Materials</span>
        <span class="budget-val">${peso(eff.material)}</span>
      </div>
      <div class="mini-bar">
        <div class="mini-fill ${budgetBarClass(pct(matSpent, eff.material))}" style="width:${Math.min(pct(matSpent, eff.material), 100)}%"></div>
      </div>
      <div class="budget-sub">${peso(matSpent)} spent · ${pct(matSpent, eff.material)}%</div>
    </div>
    <div class="proj-actions">
      ${p.status === 'active'
        ? `<button class="proj-open-btn" data-action="open">Open Workspace →</button>
           <button class="btn-complete" data-action="complete">✓ Done</button>`
        : `<button class="btn-reopen" data-action="reopen">↻ Reopen</button>`
      }
      <button class="btn-delete" data-action="delete">🗑</button>
    </div>
  `;

  // Delegated actions for this card.
  div.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'open') enterProject(p.id);
    else if (action === 'complete') markComplete(p.id);
    else if (action === 'reopen') reopenProject(p.id);
    else if (action === 'delete') deleteProject(p.id);
  });

  return div;
}

function renderDashboardSummary(projects) {
  const el = $('dashSummary');
  if (!el) return;

  const active = projects.filter(p => p.status === 'active').length;
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

  // Populate the hub summary stat tiles.
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

  // Append dynamic warning line under the tiles (re-render safe).
  let warn = document.getElementById('dashWarnLine');
  if (!warn) {
    warn = document.createElement('div');
    warn.id = 'dashWarnLine';
    el.appendChild(warn);
  }
  warn.innerHTML =
    critical > 0
      ? `<div class="budget-warn-bar warn-critical">⚠ ${critical} project${critical !== 1 ? 's' : ''} with CRITICAL budget usage!</div>`
      : warning > 0
        ? `<div class="budget-warn-bar warn-high">⚠ ${warning} project${warning !== 1 ? 's' : ''} with HIGH budget usage.</div>`
        : `<div style="font-size:12px;color:var(--green);padding:8px 0">✓ All projects are within budget limits.</div>`;
}

function renderComparison(projects) {
  const el = $('comparisonView');
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

// Debounced project search (called from the input's oninput in index.html).
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

async function createProject() {
  const btn = event?.currentTarget;
  await withBusy(btn, async () => {
    const name = $('newName')?.value.trim();
    const laborBudget = parseFloat($('newLaborBudget')?.value) || 0;
    const materialBudget = parseFloat($('newMaterialBudget')?.value) || 0;

    if (!name) { showToast('Enter project name.', 'error'); return; }
    if (name.length > 50) { showToast('Name too long (max 50).', 'error'); return; }

    const dupCheck = await get(query(ref(db, 'projects'), orderByChild('name'), equalTo(name)));
    if (dupCheck.exists()) { showToast('A project with that name already exists.', 'error'); return; }

    const projectData = {
      name, laborBudget, materialBudget,
      laborSpent: 0, materialSpent: 0, materialCommitted: 0,
      laborBudgetDelta: 0, materialBudgetDelta: 0,   // CO-derived; recomputed by changeorders module
      status: 'active',
      createdAt: Date.now(),
      createdDate: new Date().toLocaleDateString('en-PH'),
      payrollConfig: { type: 'weekly', overtimeThreshold: 8, nightDiffRate: 1.1 }
    };

    await safeDb(() => push(ref(db, 'projects'), projectData), 'Failed to create project');
    $('newName').value = ''; $('newLaborBudget').value = ''; $('newMaterialBudget').value = '';
    auditLog('create', 'project', null, { name, laborBudget, materialBudget });
    showToast(`Project "${name}" created!`);
  });
}

async function markComplete(pid) {
  if (!confirm('Mark this project as completed?\n\nThis will lock the project for editing.')) return;
  await safeDb(() => update(ref(db, `projects/${pid}`), { status: 'completed', completedAt: Date.now() }), 'Failed to update');
  auditLog('complete', 'project', pid, {});
  showToast('Project marked as completed');
}

async function reopenProject(pid) {
  if (!confirm('Reopen this project?')) return;
  await safeDb(() => update(ref(db, `projects/${pid}`), { status: 'active', reopenedAt: Date.now() }), 'Failed to update');
  auditLog('reopen', 'project', pid, {});
  showToast('Project reopened');
}

async function deleteProject(pid) {
  if (!confirm('⚠️ WARNING: This will permanently delete ALL project data including workers, timecards, payroll, materials, billing, and site logs.\n\nType DELETE to confirm:')) return;
  const confirmText = prompt('Type DELETE to confirm permanent deletion:');
  if (confirmText !== 'DELETE') { showToast('Deletion cancelled.', 'warn'); return; }

  await safeDb(() => remove(ref(db, `projects/${pid}`)), 'Failed to delete');
  auditLog('delete', 'project', pid, {});
  showToast('Project and all data deleted', 'warn');
}

function detachHubListeners() {
  _hubListeners.forEach(unsubscribe => unsubscribe());
  _hubListeners = [];
}

// ════════════════════════════════════════════════════════════
//  WORKSPACE — Enter / Exit
// ════════════════════════════════════════════════════════════

async function enterProject(pid) {
  _currentPid = pid;
  const snap = await get(ref(db, `projects/${pid}`));
  const p = snap.val();
  if (!p) { showToast('Project not found.', 'error'); return; }

  setText('wsName', p.name || 'Untitled');
  $('hubView').classList.add('hidden');
  $('workspaceView').classList.remove('hidden');

  _isReadOnly = false;
  $('lockedBanner')?.classList.add('hidden');
  document.querySelectorAll('.panel').forEach(pn => pn.classList.remove('read-only'));

  // Init all modules (each registers its own listeners + detach fn).
  initLabor(pid);
  initMaterials(pid);
  initBilling(pid);
  initChangeOrders(pid);
  initSiteLog(pid);
  initSuppliers();

  switchTab('labor');
  auditLog('enter', 'project', pid, { name: p.name });
}

function exitHub() {
  // Detach every module's listeners cleanly (no orphans, no leaked DB reads).
  detachLaborListeners();
  detachMatListeners();
  detachBillingListeners();
  detachCOListeners();
  detachSiteLogListeners();
  detachSupplierListeners();

  $('workspaceView').classList.add('hidden');
  $('hubView').classList.remove('hidden');
  _currentPid = null;
  renderHub();
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('tab-active'));
  $(`tab_${tab}`)?.classList.add('tab-active');
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  $(`${tab}Panel`)?.classList.remove('hidden');
}

function unlockForEdit() {
  _isReadOnly = false;
  $('lockedBanner')?.classList.add('hidden');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('read-only'));
  auditLog('unlock', 'project', _currentPid, {});
  showToast('Workspace unlocked for editing');
}

async function exportAllData() {
  if (!_currentPid) return;
  const snap = await get(ref(db, `projects/${_currentPid}`));
  const data = snap.val();
  if (!data) return;

  downloadTextFile(
    `ACPM_${_currentPid}_${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(data, null, 2),
    'application/json'
  );
  auditLog('export', 'project', _currentPid, { format: 'json' });
  showToast('Project data exported!');
}

// Keyboard shortcuts
window.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key >= '1' && e.key <= '6') {
    const tabs = ['labor', 'materials', 'billing', 'changeorders', 'sitelog', 'suppliers'];
    const idx = parseInt(e.key) - 1;
    if (tabs[idx] && !$('workspaceView').classList.contains('hidden')) {
      switchTab(tabs[idx]);
      e.preventDefault();
    }
  }
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    showToast('Auto-saved to Firebase ☁️', 'success');
  }
});

// ── Expose to global scope ────────────────────────────────────
// Required because this file is loaded as <script type="module">,
// so top-level functions are NOT automatically global. Anything
// referenced via inline onclick="" / oninput="" in index.html
// must be attached to window explicitly here.
window.createProject = createProject;
window.markComplete = markComplete;
window.reopenProject = reopenProject;
window.deleteProject = deleteProject;
window.enterProject = enterProject;
window.exitHub = exitHub;
window.switchTab = switchTab;
window.unlockForEdit = unlockForEdit;
window.exportAllData = exportAllData;
window.filterProjects = filterProjects;
window.showHubTab = showHubTab;