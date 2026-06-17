/* ═══════════════════════════════════════════════════════════
   ACPM — Main Controller (Hub + Workspace + Shared Utilities)
   ═══════════════════════════════════════════════════════════ */

// ── Firebase Config (v8) ──────────────────────────────────
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
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

// ── Globals ───────────────────────────────────────────────
let _currentPid = null;
let _hubListeners = [];
let _searchDebounce = null;
let _isReadOnly = false;

// ── DOM helpers ───────────────────────────────────────────
const $ = id => document.getElementById(id);
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };

// FIXED: peso() now returns actual ₱ character, not \u20B1
function peso(n) {
  if (n === undefined || n === null) return '₱0.00';
  const num = parseFloat(n) || 0;
  return '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(part, whole) {
  if (!whole || !parseFloat(whole)) return 0;
  return Math.round((parseFloat(part) / parseFloat(whole)) * 100);
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// REMOVED: html tagged template that was causing the bug
// Now we use direct innerHTML with escapeHtml() for user data

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const existing = document.querySelector('.toast-msg');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast-msg toast-${type}`;
  toast.textContent = msg;
  toast.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
    background:${type === 'error' ? '#450a0a' : type === 'warn' ? '#451a03' : '#064e3b'};
    color:${type === 'error' ? '#ef4444' : type === 'warn' ? '#f59e0b' : '#34d399'};
    border:1px solid ${type === 'error' ? '#7f1d1d' : type === 'warn' ? '#78350f' : '#065f46'};
    padding:10px 20px;border-radius:10px;font-size:13px;font-weight:700;z-index:1000;
    box-shadow:0 4px 12px rgba(0,0,0,.4);`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Safe DB wrapper ───────────────────────────────────────
async function safeDb(fn, errMsg) {
  try { return await fn(); } 
  catch (e) { console.error(e); showToast(errMsg || 'Database error', 'error'); throw e; }
}

// ════════════════════════════════════════════════════════
//  HUB — Project Dashboard
// ════════════════════════════════════════════════════════

window.onload = () => {
  showHubTab('active');
  renderHub();
  initPWA();
};

function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    window.deferredPrompt = e;
    const bar = $('installBar');
    if (bar) bar.classList.remove('hidden');
  });
  const installBtn = $('installBtn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
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
  const ref = firebase.database().ref('projects').orderByChild('status').equalTo(isActive ? 'active' : 'completed');

  ref.on('value', snap => {
    const grid = isActive ? $('projectGrid') : $('completedGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const projects = [];
    snap.forEach(c => projects.push({ id: c.key, ...c.val() }));
    projects.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (!projects.length) {
      grid.innerHTML = `<p class="hub-empty">No ${isActive ? 'active' : 'completed'} projects.</p>`;
      renderDashboardSummary([]);
      renderComparison([]);
      return;
    }

    projects.forEach(p => {
      const card = buildProjectCard(p);
      grid.appendChild(card);
    });

    renderDashboardSummary(projects);
    renderComparison(projects);
  });
  _hubListeners.push(ref);
}

// FIXED: buildProjectCard now uses proper DOM creation instead of html tagged template
function buildProjectCard(p) {
  const div = document.createElement('div');
  div.className = `proj-card ${p.status === 'completed' ? 'proj-card-done' : ''}`;
  div.setAttribute('data-name', (p.name || '').toLowerCase());

  const laborBudget = parseFloat(p.laborBudget) || 0;
  const laborSpent = parseFloat(p.laborSpent) || 0;
  const matBudget = parseFloat(p.materialBudget) || 0;
  const matSpent = parseFloat(p.materialSpent) || 0;
  const totalBudget = laborBudget + matBudget;
  const totalSpent = laborSpent + matSpent;
  const remaining = totalBudget - totalSpent;
  const pctUsed = pct(totalSpent, totalBudget);

  const isHealthy = pctUsed < 80;
  const isWarning = pctUsed >= 80 && pctUsed < 95;
  const isCritical = pctUsed >= 95;

  const statusClass = p.status === 'completed' ? 'completed-tag' : 'active-tag';
  const statusText = p.status === 'completed' ? 'COMPLETED' : 'ACTIVE';

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
        <span class="budget-val">${peso(totalBudget)}</span>
      </div>
      <div class="mini-bar">
        <div class="mini-fill ${isCritical ? 'bar-danger' : isWarning ? 'bar-warn' : 'bar-ok'}" style="width:${Math.min(pctUsed, 100)}%"></div>
      </div>
      <div class="budget-sub">
        ${isCritical ? '<span class="warn-tag">⚠ CRITICAL</span>' : isWarning ? '<span class="warn-tag">⚠ WARNING</span>' : '<span style="color:var(--green)">✓ Healthy</span>'}
        <span>${peso(totalSpent)} spent · ${pctUsed}%</span>
      </div>
      <div class="budget-row" style="margin-top:6px">
        <span class="budget-label">👷 Labor</span>
        <span class="budget-val">${peso(laborBudget)}</span>
      </div>
      <div class="mini-bar">
        <div class="mini-fill ${pct(laborSpent, laborBudget) >= 95 ? 'bar-danger' : pct(laborSpent, laborBudget) >= 80 ? 'bar-warn' : 'bar-ok'}" style="width:${Math.min(pct(laborSpent, laborBudget), 100)}%"></div>
      </div>
      <div class="budget-sub">${peso(laborSpent)} spent · ${pct(laborSpent, laborBudget)}%</div>
      <div class="budget-row" style="margin-top:6px">
        <span class="budget-label">📦 Materials</span>
        <span class="budget-val">${peso(matBudget)}</span>
      </div>
      <div class="mini-bar">
        <div class="mini-fill ${pct(matSpent, matBudget) >= 95 ? 'bar-danger' : pct(matSpent, matBudget) >= 80 ? 'bar-warn' : 'bar-ok'}" style="width:${Math.min(pct(matSpent, matBudget), 100)}%"></div>
      </div>
      <div class="budget-sub">${peso(matSpent)} spent · ${pct(matSpent, matBudget)}%</div>
    </div>
    <div class="proj-actions">
      ${p.status === 'active' 
        ? `<button class="proj-open-btn" onclick="enterProject('${p.id}')">Open Workspace →</button>
           <button class="btn-complete" onclick="markComplete('${p.id}')">✓ Done</button>`
        : `<button class="btn-reopen" onclick="reopenProject('${p.id}')">↻ Reopen</button>`
      }
      <button class="btn-delete" onclick="deleteProject('${p.id}')">🗑</button>
    </div>
  `;

  return div;
}

function renderDashboardSummary(projects) {
  const el = $('dashboardSummary');
  if (!el) return;

  if (!projects.length) {
    el.innerHTML = '<p class="empty-hint">No projects yet. Create one above.</p>';
    return;
  }

  const active = projects.filter(p => p.status === 'active').length;
  const totalBudget = projects.reduce((s, p) => s + (parseFloat(p.laborBudget) || 0) + (parseFloat(p.materialBudget) || 0), 0);
  const totalSpent = projects.reduce((s, p) => s + (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0), 0);
  const remaining = totalBudget - totalSpent;
  const overallPct = pct(totalSpent, totalBudget);

  const critical = projects.filter(p => {
    const totalB = (parseFloat(p.laborBudget) || 0) + (parseFloat(p.materialBudget) || 0);
    const totalS = (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0);
    return pct(totalS, totalB) >= 95;
  }).length;

  const warning = projects.filter(p => {
    const totalB = (parseFloat(p.laborBudget) || 0) + (parseFloat(p.materialBudget) || 0);
    const totalS = (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0);
    const pUsed = pct(totalS, totalB);
    return pUsed >= 80 && pUsed < 95;
  }).length;

  el.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card">
        <span class="kpi-label">Active Projects</span>
        <span class="kpi-num">${active}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Total Budget</span>
        <span class="kpi-num">${peso(totalBudget)}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Total Spent</span>
        <span class="kpi-num kpi-danger">${peso(totalSpent)}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Remaining</span>
        <span class="kpi-num ${remaining < 0 ? 'kpi-danger' : 'kpi-safe'}">${peso(remaining)}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Overall Progress</span>
        <span class="kpi-num ${overallPct >= 95 ? 'kpi-danger' : overallPct >= 80 ? 'kpi-warn' : 'kpi-safe'}">${overallPct}%</span>
      </div>
    </div>
    ${critical > 0 ? `<div class="budget-warn-bar warn-critical">⚠ ${critical} project${critical !== 1 ? 's' : ''} with CRITICAL budget usage!</div>` : ''}
    ${warning > 0 && critical === 0 ? `<div class="budget-warn-bar warn-high">⚠ ${warning} project${warning !== 1 ? 's' : ''} with HIGH budget usage.</div>` : ''}
    ${critical === 0 && warning === 0 ? `<div style="font-size:12px;color:var(--green);padding:8px 0">✓ All projects are within budget limits.</div>` : ''}
  `;
}

function renderComparison(projects) {
  const el = $('comparisonView');
  if (!el) return;

  if (projects.length < 2) {
    el.innerHTML = '<p class="empty-hint">Add 2+ projects to compare budgets.</p>';
    return;
  }

  const maxBudget = Math.max(...projects.map(p => (parseFloat(p.laborBudget) || 0) + (parseFloat(p.materialBudget) || 0)));

  el.innerHTML = projects.map(p => {
    const totalB = (parseFloat(p.laborBudget) || 0) + (parseFloat(p.materialBudget) || 0);
    const totalS = (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0);
    const pUsed = pct(totalS, totalB);
    const barWidth = maxBudget ? (totalB / maxBudget) * 100 : 0;

    return `
      <div class="cmp-row">
        <span class="cmp-name">${escapeHtml(p.name || 'Untitled')}</span>
        <div class="cmp-bars">
          <div class="cmp-bar-wrap"><div class="mini-fill ${pUsed >= 95 ? 'bar-danger' : pUsed >= 80 ? 'bar-warn' : 'bar-ok'}" style="width:${barWidth}%"></div></div>
        </div>
        <span class="cmp-pct">${pUsed}%</span>
        <span class="cmp-total">${peso(totalS)} / ${peso(totalB)}</span>
      </div>
    `;
  }).join('');
}

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
  const name = $('newName')?.value.trim();
  const laborBudget = parseFloat($('newLaborBudget')?.value) || 0;
  const materialBudget = parseFloat($('newMaterialBudget')?.value) || 0;

  if (!name) { showToast('Enter project name.', 'error'); return; }
  if (name.length > 50) { showToast('Name too long (max 50).', 'error'); return; }

  const dupCheck = await firebase.database().ref('projects').orderByChild('name').equalTo(name).once('value');
  if (dupCheck.exists()) { showToast('A project with that name already exists.', 'error'); return; }

  const now = Date.now();
  const projectData = {
    name, laborBudget, materialBudget,
    laborSpent: 0, materialSpent: 0,
    status: 'active',
    createdAt: now,
    createdDate: new Date().toLocaleDateString('en-PH')
  };

  await safeDb(() => firebase.database().ref('projects').push(projectData), 'Failed to create project');
  $('newName').value = ''; $('newLaborBudget').value = ''; $('newMaterialBudget').value = '';
  showToast(`Project "${name}" created!`);
}

async function markComplete(pid) {
  if (!confirm('Mark this project as completed?')) return;
  await safeDb(() => firebase.database().ref(`projects/${pid}`).update({ status: 'completed' }), 'Failed to update');
  showToast('Project marked as completed');
}

async function reopenProject(pid) {
  if (!confirm('Reopen this project?')) return;
  await safeDb(() => firebase.database().ref(`projects/${pid}`).update({ status: 'active' }), 'Failed to update');
  showToast('Project reopened');
}

async function deleteProject(pid) {
  if (!confirm('Type DELETE to confirm permanent deletion:')) return;
  const confirmText = prompt('Type DELETE to confirm:');
  if (confirmText !== 'DELETE') { showToast('Deletion cancelled.', 'warn'); return; }
  await safeDb(() => firebase.database().ref(`projects/${pid}`).remove(), 'Failed to delete');
  showToast('Project deleted', 'warn');
}

function detachHubListeners() {
  _hubListeners.forEach(ref => ref.off());
  _hubListeners = [];
}

// ════════════════════════════════════════════════════════
//  WORKSPACE — Enter / Exit
// ════════════════════════════════════════════════════════

async function enterProject(pid) {
  _currentPid = pid;
  const snap = await firebase.database().ref(`projects/${pid}`).once('value');
  const p = snap.val();
  if (!p) { showToast('Project not found.', 'error'); return; }

  setText('wsName', p.name || 'Untitled');
  $('hubView').classList.add('hidden');
  $('workspaceView').classList.remove('hidden');

  // Reset read-only state
  _isReadOnly = false;
  $('lockedBanner')?.classList.add('hidden');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('read-only'));

  // Init all modules
  initLabor(pid);
  initMaterials(pid);
  initBilling(pid);
  initChangeOrders(pid);
  initSiteLog(pid);
  initSuppliers(pid);

  // Default to labor tab
  switchTab('labor');
}

function exitHub() {
  // Detach all module listeners
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
  $(`panel_${tab}`)?.classList.remove('hidden');
}

function unlockForEdit() {
  _isReadOnly = false;
  $('lockedBanner')?.classList.add('hidden');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('read-only'));
  showToast('Workspace unlocked for editing');
}

async function exportAllData() {
  if (!_currentPid) return;
  const snap = await firebase.database().ref(`projects/${_currentPid}`).once('value');
  const data = snap.val();
  if (!data) return;

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ACPM_${_currentPid}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
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
});