
//  · Firebase Auth (optional, falls back to anonymous)
//  · Offline persistence enabled
//  · Input sanitization (XSS prevention)
//  · Loading states on all async ops
//  · Project search/filter (debounced)
//  · Keyboard shortcuts
//  · Toast notifications with queue
//  · Error boundaries on all Firebase calls
// ═══════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA",
  authDomain: "acpm-project-system.firebaseapp.com",
  databaseURL: "https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "acpm-project-system",
  storageBucket: "acpm-project-system.firebasestorage.app",
  messagingSenderId: "330800177544",
  appId: "1:330800177544:web:8f29dcd81ca39976849a3d"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);

}

let currentProjectId = null, currentProjectLocked = true;
let _listeners = [], _toastQueue = [], _toastShowing = false;
let _authUser = null;
let _filterDebounce = null;

// ── Utilities ─────────────────────────────────────────────────
function peso(n) {
  return '\u20B1' + (parseFloat(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(s, b) { return (!b) ? 0 : Math.min(100, Math.round((s / b) * 100)); }
function $(id) { return document.getElementById(id); }
function setText(id, v) { const e = $(id); if (e) e.textContent = v; }
function budgetBarClass(p) { return p >= 95 ? 'bar-danger' : p >= 80 ? 'bar-warn' : 'bar-ok'; }
function kpiAlertClass(p) { return p >= 95 ? 'kpi-danger' : p >= 80 ? 'kpi-warn' : ''; }

// XSS-safe HTML builder
function html(strings, ...values) {
  return strings.reduce((result, str, i) => {
    const val = values[i];
    if (val === undefined) return result + str;
    return result + str + escapeHtml(String(val));
  }, '');
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Debounce utility ──────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Listeners ─────────────────────────────────────────────────
function listen(ref, cb) {
  ref.on('value', cb);
  _listeners.push(ref);
}
function detachAll() {
  _listeners.forEach(r => r.off());
  _listeners = [];
  if (typeof detachLaborListeners === 'function') detachLaborListeners();
  if (typeof detachMatListeners === 'function') detachMatListeners();
  if (typeof detachBillingListeners === 'function') detachBillingListeners();
  if (typeof detachCOListeners === 'function') detachCOListeners();
}

// ── Toast Queue System ──────────────────────────────────────
function showToast(msg, type = 'success') {
  _toastQueue.push({ msg, type });
  if (!_toastShowing) _processToastQueue();
}
function _processToastQueue() {
  if (!_toastQueue.length) { _toastShowing = false; return; }
  _toastShowing = true;
  const { msg, type } = _toastQueue.shift();
  let t = $('acpm-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'acpm-toast';
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:12px 22px;border-radius:12px;font-size:13px;font-weight:700;z-index:9999;transition:opacity .3s,transform .3s;pointer-events:none;max-width:88vw;text-align:center;opacity:0;transform:translateX(-50%) translateY(20px);';
    document.body.appendChild(t);
  }
  const c = {
    success: { bg: '#064e3b', color: '#6ee7b7', border: '#10b981' },
    error:   { bg: '#7f1d1d', color: '#fca5a5', border: '#ef4444' },
    warn:    { bg: '#451a03', color: '#fcd34d', border: '#f59e0b' },
    info:    { bg: '#1e3a5f', color: '#93c5fd', border: '#1e40af' }
  }[type] || c.success;
  t.style.background = c.bg;
  t.style.color = c.color;
  t.style.border = `1px solid ${c.border}`;
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._tmr);
  t._tmr = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(_processToastQueue, 300);
  }, 3000);
}

// ── Loading Spinner ───────────────────────────────────────────
function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn._originalText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;
  } else {a
    btn.textContent = btn._originalText || btn.textContent;
    btn.disabled = false;
  }
}

// ── Safe Firebase Wrapper ───────────────────────────────────
async function safeDb(op, errorMsg) {
  try { return await op(); }
  catch (e) { console.error(e); showToast(errorMsg || 'Operation failed', 'error'); throw e; }
}

// ── Auth (Anonymous fallback) ─────────────────────────────────
firebase.auth().onAuthStateChanged(user => {
  _authUser = user;
  if (!user) firebase.auth().signInAnonymously().catch(() => {});
});

// ── Service Worker ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ── Keyboard Shortcuts ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
  }
  if (e.ctrlKey || e.metaKey) {
    const tabs = ['labor','materials','billing','changeorders','sitelog','suppliers'];
    const num = parseInt(e.key);
    // FIXED: Check workspace is visible, not hub
    if (num >= 1 && num <= 6 && !$('workspaceView')?.classList.contains('hidden')) {
      e.preventDefault();
      switchTab(tabs[num - 1]);
    }
  }
});

// ── Init ──────────────────────────────────────────────────────
window.onload = () => {
  showHubTab('active');
  renderHub();
};

function showHubTab(tab) {
  ['active','completed'].forEach(t => {
    $(t + 'ProjectsPane')?.classList.toggle('hidden', t !== tab);
    $('hubTab_' + t)?.classList.toggle('tab-active', t === tab);
  });
}

// ═════════════════════════════════════════════════════════════
//  HUB
// ═════════════════════════════════════════════════════════════
function renderHub() {
  const ag = $('projectGrid'), cg = $('completedGrid');
  if (!ag) return;
  listen(firebase.database().ref('projects'), snap => {
    ag.innerHTML = ''; cg.innerHTML = '';
    let aC = 0, cC = 0;
    if (!snap.exists()) {
      ag.innerHTML = '<p class="hub-empty">No projects yet — create one above.</p>';
      cg.innerHTML = '<p class="hub-empty">No completed projects.</p>';
      renderComparison([]);
      return;
    }
    const all = [];
    snap.forEach(child => {
      const id = child.key, d = child.val() || {};
      all.push({ id, ...d });
      const lb = parseFloat(d.laborBudget) || 0, mb = parseFloat(d.materialBudget) || 0;
      const ls = parseFloat(d.laborSpent) || 0, ms = parseFloat(d.materialSpent) || 0;
      const lp = pct(ls, lb), mp = pct(ms, mb), done = d.status === 'completed';
      const card = buildProjectCard(id, d, lb, mb, ls, ms, lp, mp, done);
      if (done) { cg.innerHTML += card; cC++; } else { ag.innerHTML += card; aC++; }
    });
    if (!aC) ag.innerHTML = '<p class="hub-empty">No active projects.</p>';
    if (!cC) cg.innerHTML = '<p class="hub-empty">No completed projects yet.</p>';
    renderComparison(all);
  });
}

function buildProjectCard(id, d, lb, mb, ls, ms, lp, mp, done) {
  const lA = kpiAlertClass(lp), mA = kpiAlertClass(mp);
  const badge = done
    ? '<span class="completed-tag">✓ DONE</span>'
    : '<span class="active-tag">ACTIVE</span>';
  const actions = done
    ? html`<div class="proj-actions">
        <button class="btn-unlock" onclick="enterProject('${escapeHtml(id)}',true)">🔓 View</button>
        <button class="btn-reopen" onclick="reopenProject('${escapeHtml(id)}')">↩ Reopen</button>
        <button class="btn-delete" onclick="deleteProject('${escapeHtml(id)}')">🗑</button>
      </div>`
    : html`<div class="proj-actions">
        <button class="proj-open-btn" onclick="enterProject('${escapeHtml(id)}')">Open Workspace →</button>
        <button class="btn-complete" onclick="markComplete('${escapeHtml(id)}')">✓ Done</button>
        <button class="btn-delete" onclick="deleteProject('${escapeHtml(id)}')">🗑</button>
      </div>`;
  return html`<div class="proj-card ${done ? 'proj-card-done' : ''}" data-name="${id.toLowerCase()}">
    <div class="proj-card-top"><div>
      <p class="proj-label">PROJECT</p><h3 class="proj-name">${id}</h3>
      <p class="proj-date">Created ${d.created || '—'}${d.completedDate ? ' · Done ' + d.completedDate : ''}</p>
    </div>${badge}</div>
    <div class="proj-budgets">
      <div class="budget-row"><span class="budget-label">👷 Labor</span><span class="budget-val ${lA}">${peso(lb)}</span></div>
      <div class="mini-bar"><div class="mini-fill ${budgetBarClass(lp)}" style="width:${lp}%"></div></div>
      <p class="budget-sub">${peso(ls)} spent · ${lp}% ${lp >= 80 ? '<span class="warn-tag">' + (lp >= 95 ? '⚠ CRITICAL' : '⚠ HIGH') + '</span>' : ''}</p>
      <div class="budget-row" style="margin-top:8px"><span class="budget-label">📦 Materials</span><span class="budget-val ${mA}">${peso(mb)}</span></div>
      <div class="mini-bar"><div class="mini-fill ${budgetBarClass(mp)}" style="width:${mp}%"></div></div>
      <p class="budget-sub">${peso(ms)} spent · ${mp}% ${mp >= 80 ? '<span class="warn-tag">' + (mp >= 95 ? '⚠ CRITICAL' : '⚠ HIGH') + '</span>' : ''}</p>
    </div>${actions}</div>`;
}

function renderComparison(projects) {
  const el = $('comparisonView'); if (!el) return;
  if (!projects || projects.length < 2) {
    el.innerHTML = '<p class="empty-hint">Add 2+ projects to see comparison.</p>';
    return;
  }
  el.innerHTML = projects.map(p => {
    const lb = parseFloat(p.laborBudget) || 0, mb = parseFloat(p.materialBudget) || 0;
    const ls = parseFloat(p.laborSpent) || 0, ms = parseFloat(p.materialSpent) || 0;
    const total = lb + mb, spent = ls + ms, p2 = pct(spent, total);
    return html`<div class="cmp-row">
      <span class="cmp-name" title="${p.id}">${p.id}</span>
      <div class="cmp-bars">
        <div class="cmp-bar-wrap"><div style="width:${pct(ls, lb)}%;height:5px;border-radius:3px;background:var(--blue-l);transition:width .4s"></div></div>
        <div class="cmp-bar-wrap"><div style="width:${pct(ms, mb)}%;height:5px;border-radius:3px;background:var(--amber);transition:width .4s"></div></div>
      </div>
      <span class="cmp-pct ${kpiAlertClass(p2)}">${p2}%</span>
      <span class="cmp-total">${peso(spent)} / ${peso(total)}</span>
    </div>`;
  }).join('');
}

// FIXED: Debounced filter
function filterProjects(query) {
  if (_filterDebounce) clearTimeout(_filterDebounce);
  _filterDebounce = setTimeout(() => {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.proj-card').forEach(card => {
      const name = card.getAttribute('data-name') || '';
      card.style.display = name.includes(q) ? '' : 'none';
    });
  }, 150);
}

// ═════════════════════════════════════════════════════════════
//  PROJECT CRUD
// ═════════════════════════════════════════════════════════════
async function createProject() {
  const btn = document.activeElement;
  const name = $('newName').value.trim();
  const lb = parseFloat($('newLaborBudget').value) || 0;
  const mb = parseFloat($('newMaterialBudget').value) || 0;
  if (!name) { showToast('Enter a project name.', 'error'); return; }
  if (lb <= 0) { showToast('Enter a valid Labor Budget.', 'error'); return; }
  if (mb <= 0) { showToast('Enter a valid Materials Budget.', 'error'); return; }
  if (name.length > 50) { showToast('Project name too long (max 50 chars).', 'error'); return; }

  setLoading(btn, true);
  try {
    const snap = await safeDb(() => firebase.database().ref(`projects/${name}`).once('value'), 'Failed to check project');
    if (snap.exists()) { showToast(`"${name}" already exists.`, 'error'); return; }
    await safeDb(() => firebase.database().ref(`projects/${name}`).set({
      laborBudget: lb, materialBudget: mb, laborSpent: 0, materialSpent: 0,
      status: 'active', created: new Date().toLocaleDateString('en-PH')
    }), 'Failed to create project');
    $('newName').value = ''; $('newLaborBudget').value = ''; $('newMaterialBudget').value = '';
    showToast(`✅ Project "${name}" created!`);
  } finally { setLoading(btn, false); }
}

async function markComplete(id) {
  if (!confirm(`Mark "${id}" as completed?\n\nThis will lock the project.`)) return;
  await safeDb(() => firebase.database().ref(`projects/${id}`).update({
    status: 'completed', completedDate: new Date().toLocaleDateString('en-PH')
  }), 'Failed to complete project');
  showToast(`"${id}" marked complete ✓`);
}

async function reopenProject(id) {
  if (!confirm(`Reopen "${id}" as active?`)) return;
  await safeDb(() => firebase.database().ref(`projects/${id}`).update({
    status: 'active', completedDate: null
  }), 'Failed to reopen project');
  showToast(`"${id}" reopened`);
}

async function deleteProject(id) {
  if (!confirm(`⚠ Delete "${id}" and ALL its data?\n\nThis cannot be undone.`)) return;
  const c = prompt('Type DELETE to confirm permanent deletion:');
  if (c !== 'DELETE') { showToast('Cancelled.', 'warn'); return; }
  await safeDb(() => firebase.database().ref(`projects/${id}`).remove(), 'Failed to delete project');
  showToast(`"${id}" deleted`, 'warn');
}

// ═════════════════════════════════════════════════════════════
//  WORKSPACE NAVIGATION
// ═════════════════════════════════════════════════════════════
function enterProject(id, readOnly = false) {
  detachAll();
  currentProjectId = id;
  currentProjectLocked = readOnly;
  $('hubView').classList.add('hidden');
  $('workspaceView').classList.remove('hidden');
  $('wsName').textContent = id;
  $('lockedBanner')?.classList.toggle('hidden', !readOnly);
  switchTab('labor');
  if (typeof initLabor === 'function')        initLabor(id);
  if (typeof initMaterials === 'function')    initMaterials(id);
  if (typeof initSiteLog === 'function')      initSiteLog(id);
  if (typeof initSuppliers === 'function')    initSuppliers();
  if (typeof initBilling === 'function')      initBilling(id);
  if (typeof initChangeOrders === 'function') initChangeOrders(id);
}

function exitHub() {
  detachAll();
  currentProjectId = null;
  $('workspaceView').classList.add('hidden');
  $('hubView').classList.remove('hidden');
  renderHub();
}

function unlockForEdit() {
  $('lockedBanner')?.classList.add('hidden');
  currentProjectLocked = false;
  showToast('Project unlocked for editing', 'warn');
}

const ALL_TABS = ['labor','materials','billing','changeorders','sitelog','suppliers'];
function switchTab(tab) {
  ALL_TABS.forEach(t => {
    $(t + 'Panel')?.classList.add('hidden');
    $('tab_' + t)?.classList.remove('tab-active');
  });
  $(tab + 'Panel')?.classList.remove('hidden');
  $('tab_' + tab)?.classList.add('tab-active');
}

// ═════════════════════════════════════════════════════════════
//  EXPORT ALL DATA
// ═════════════════════════════════════════════════════════════
async function exportAllData() {
  if (!currentProjectId) { showToast('Open a project first.', 'warn'); return; }
  showToast('Preparing export...', 'info');
  try {
    const snap = await firebase.database().ref(`projects/${currentProjectId}`).once('value');
    const data = snap.val() || {};
    const exportObj = {
      project: currentProjectId,
      exportedAt: new Date().toISOString(),
      data: data
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ACPM_Backup_${currentProjectId}_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Project data exported!');
  } catch (e) {
    showToast('Export failed.', 'error');
  }
}

