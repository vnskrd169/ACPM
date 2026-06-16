// ═══════════════════════════════════════════════════════════════
//  ACPM v6 — main.js
//  FIXES: comparison bar live update · createProject budget bug
//         global suppliers · tab ids corrected
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
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

// ── Globals ───────────────────────────────────────────────────
let currentProjectId     = null;
let currentProjectLocked = true;
let _listeners           = [];

// ── Helpers ───────────────────────────────────────────────────
function peso(n) {
  return '₱' + (parseFloat(n)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function pct(spent,budget){ return (!budget)?0:Math.min(100,Math.round((spent/budget)*100)); }
function listen(ref,cb)   { ref.on('value',cb); _listeners.push(ref); }
function detachAll()       { _listeners.forEach(r=>r.off()); _listeners=[]; }
function $(id)             { return document.getElementById(id); }
function setText(id,v)     { const e=$(id); if(e) e.textContent=v; }
function budgetBarClass(p) { return p>=95?'bar-danger':p>=80?'bar-warn':'bar-ok'; }
function kpiAlertClass(p)  { return p>=95?'kpi-danger':p>=80?'kpi-warn':''; }

// ── Toast notification (replaces alert) ───────────────────────
function showToast(msg, type='success') {
  let t = $('toastMsg');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toastMsg';
    t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      padding:12px 24px;border-radius:12px;font-size:13px;font-weight:700;
      z-index:9999;transition:opacity .3s;pointer-events:none;max-width:90vw;text-align:center`;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = type==='error'?'#7f1d1d':type==='warn'?'#451a03':'#064e3b';
  t.style.color      = type==='error'?'#fca5a5':type==='warn'?'#fcd34d':'#6ee7b7';
  t.style.border     = `1px solid ${type==='error'?'#ef4444':type==='warn'?'#f59e0b':'#10b981'}`;
  t.style.opacity    = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>{ t.style.opacity='0'; }, 3000);
}

// ── PWA Registration ──────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch(err => console.log('SW failed:', err));
  });
}

// ── Boot ──────────────────────────────────────────────────────
window.onload = () => { showHubTab('active'); renderHub(); };

// ── Hub tabs ──────────────────────────────────────────────────
function showHubTab(tab) {
  ['active','completed'].forEach(t => {
    $(t+'ProjectsPane')?.classList.toggle('hidden', t!==tab);
    $('hubTab_'+t)?.classList.toggle('tab-active', t===tab);
  });
}

// ── Render hub ────────────────────────────────────────────────
// FIX: renderComparison is now INSIDE the live listener so it
//      updates every time any project's data changes
function renderHub() {
  const activeGrid    = $('projectGrid');
  const completedGrid = $('completedGrid');
  if (!activeGrid) return;

  listen(firebase.database().ref('projects'), snap => {
    activeGrid.innerHTML=''; completedGrid.innerHTML='';
    let aC=0, cC=0;

    if (!snap.exists()) {
      activeGrid.innerHTML='<p class="hub-empty">No projects yet — create one above.</p>';
      completedGrid.innerHTML='<p class="hub-empty">No completed projects.</p>';
      renderComparison([]); return;
    }

    const all=[];
    snap.forEach(child=>{
      const id=child.key, d=child.val()||{};
      all.push({id,...d});
      const lb=parseFloat(d.laborBudget)||0, mb=parseFloat(d.materialBudget)||0;
      const ls=parseFloat(d.laborSpent)||0,  ms=parseFloat(d.materialSpent)||0;
      const lp=pct(ls,lb), mp=pct(ms,mb);
      const done=d.status==='completed';
      const card=buildProjectCard(id,d,lb,mb,ls,ms,lp,mp,done);
      if (done){ completedGrid.innerHTML+=card; cC++; }
      else     { activeGrid.innerHTML+=card;    aC++; }
    });

    if (!aC) activeGrid.innerHTML='<p class="hub-empty">No active projects.</p>';
    if (!cC) completedGrid.innerHTML='<p class="hub-empty">No completed projects yet.</p>';

    // FIX: always call renderComparison with live data
    renderComparison(all);
  });
}

function buildProjectCard(id,d,lb,mb,ls,ms,lp,mp,done) {
  const lA=kpiAlertClass(lp), mA=kpiAlertClass(mp);
  const badge = done
    ? `<span class="proj-status completed-tag">✓ DONE</span>`
    : `<span class="proj-status active-tag">ACTIVE</span>`;
  const actions = done
    ? `<div class="proj-actions">
         <button class="btn-unlock" onclick="enterProject('${id}',true)">🔓 View</button>
         <button class="btn-reopen" onclick="reopenProject('${id}')">↩ Reopen</button>
         <button class="btn-delete" onclick="deleteProject('${id}')">🗑</button>
       </div>`
    : `<div class="proj-actions">
         <button class="proj-open-btn" onclick="enterProject('${id}')">Open Workspace →</button>
         <button class="btn-complete"  onclick="markComplete('${id}')">✓ Done</button>
         <button class="btn-delete"    onclick="deleteProject('${id}')">🗑</button>
       </div>`;
  return `<div class="proj-card ${done?'proj-card-done':''}">
    <div class="proj-card-top"><div>
      <p class="proj-label">PROJECT</p>
      <h3 class="proj-name">${id}</h3>
      <p class="proj-date">Created ${d.created||'—'} ${d.completedDate?'· Completed '+d.completedDate:''}</p>
    </div>${badge}</div>
    <div class="proj-budgets">
      <div class="budget-row">
        <span class="budget-label">👷 Labor</span>
        <span class="budget-val ${lA}">${peso(lb)}</span>
      </div>
      <div class="mini-bar"><div class="mini-fill ${budgetBarClass(lp)}" style="width:${lp}%"></div></div>
      <p class="budget-sub">${peso(ls)} spent · ${lp}%
        ${lp>=80?`<span class="warn-tag">${lp>=95?'⚠ CRITICAL':'⚠ HIGH'}</span>`:''}
      </p>
      <div class="budget-row" style="margin-top:8px">
        <span class="budget-label">📦 Materials</span>
        <span class="budget-val ${mA}">${peso(mb)}</span>
      </div>
      <div class="mini-bar"><div class="mini-fill ${budgetBarClass(mp)}" style="width:${mp}%"></div></div>
      <p class="budget-sub">${peso(ms)} spent · ${mp}%
        ${mp>=80?`<span class="warn-tag">${mp>=95?'⚠ CRITICAL':'⚠ HIGH'}</span>`:''}
      </p>
    </div>${actions}
  </div>`;
}

// ── Project lifecycle ─────────────────────────────────────────
async function markComplete(id) {
  if (!confirm(`Mark "${id}" as completed? It will move to Completed tab.`)) return;
  await firebase.database().ref(`projects/${id}`).update({
    status:'completed',
    completedDate: new Date().toLocaleDateString('en-PH')
  });
  showToast(`✓ "${id}" marked as completed`);
}

async function reopenProject(id) {
  if (!confirm(`Reopen "${id}" as active?`)) return;
  await firebase.database().ref(`projects/${id}`).update({ status:'active', completedDate:null });
  showToast(`"${id}" reopened`);
}

async function deleteProject(id) {
  if (!confirm(`⚠ Delete "${id}" and ALL its data? This cannot be undone.`)) return;
  const c = prompt(`Type DELETE to confirm permanent removal of "${id}"`);
  if (c !== 'DELETE') { showToast('Cancelled.','warn'); return; }
  await firebase.database().ref(`projects/${id}`).remove();
  showToast(`"${id}" deleted`,'warn');
}

// ── Comparison — renders all projects side by side ────────────
// FIX: now called inside the live listener in renderHub()
// shows all projects (active + completed) together
function renderComparison(projects) {
  const el=$('comparisonView'); if (!el) return;
  if (!projects || projects.length < 2) {
    el.innerHTML='<p class="empty-hint">Add 2+ projects to see budget comparison.</p>';
    return;
  }
  el.innerHTML = projects.map(p=>{
    const lb=parseFloat(p.laborBudget)||0,  mb=parseFloat(p.materialBudget)||0;
    const ls=parseFloat(p.laborSpent)||0,   ms=parseFloat(p.materialSpent)||0;
    const total=lb+mb, spent=ls+ms;
    const p2=pct(spent,total);
    const lp=pct(ls,lb), mp=pct(ms,mb);
    return `<div class="cmp-row">
      <span class="cmp-name" title="${p.id}">${p.id}</span>
      <div class="cmp-bars">
        <div class="cmp-bar-wrap" title="Labor: ${peso(ls)} / ${peso(lb)}">
          <div style="width:${lp}%;height:5px;border-radius:3px;background:var(--blue-l);transition:width .4s"></div>
        </div>
        <div class="cmp-bar-wrap" title="Materials: ${peso(ms)} / ${peso(mb)}">
          <div style="width:${mp}%;height:5px;border-radius:3px;background:var(--amber);transition:width .4s"></div>
        </div>
      </div>
      <span class="cmp-pct ${kpiAlertClass(p2)}">${p2}%</span>
      <span class="cmp-total">${peso(spent)} / ${peso(total)}</span>
    </div>`;
  }).join('');
}

// ── Create project ────────────────────────────────────────────
// FIX: was setting laborBudget:mb (wrong value) in previous version
async function createProject() {
  const name = $('newName').value.trim();
  const lb   = parseFloat($('newLaborBudget').value)    || 0;
  const mb   = parseFloat($('newMaterialBudget').value) || 0;
  if (!name) { showToast('Enter a project name.','error'); return; }
  if (lb<=0) { showToast('Enter a valid Labor Budget.','error'); return; }
  if (mb<=0) { showToast('Enter a valid Materials Budget.','error'); return; }

  const snap = await firebase.database().ref(`projects/${name}`).once('value');
  if (snap.exists()) { showToast(`"${name}" already exists.`,'error'); return; }

  // FIX: laborBudget:lb, materialBudget:mb — correct values, single write
  await firebase.database().ref(`projects/${name}`).set({
    laborBudget    : lb,
    materialBudget : mb,
    laborSpent     : 0,
    materialSpent  : 0,
    status         : 'active',
    created        : new Date().toLocaleDateString('en-PH')
  });

  $('newName').value=''; $('newLaborBudget').value=''; $('newMaterialBudget').value='';
  showToast(`✅ Project "${name}" created!`);
}

// ── Enter / Exit workspace ────────────────────────────────────
function enterProject(id, readOnly=false) {
  detachAll();
  currentProjectId     = id;
  currentProjectLocked = readOnly;

  $('hubView').classList.add('hidden');
  $('workspaceView').classList.remove('hidden');
  $('wsName').textContent = id;

  const banner = $('lockedBanner');
  if (banner) banner.classList.toggle('hidden', !readOnly);

  switchTab('labor');

  if (typeof initLabor        === 'function') initLabor(id);
  if (typeof initMaterials    === 'function') initMaterials(id);
  if (typeof initSiteLog      === 'function') initSiteLog(id);
  if (typeof initSuppliers    === 'function') initSuppliers();   // global — no pid
  if (typeof initBilling      === 'function') initBilling(id);
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
  $('lockedBanner').classList.add('hidden');
  currentProjectLocked = false;
  showToast('Project unlocked for editing','warn');
}

// ── Tab switcher ──────────────────────────────────────────────
const ALL_TABS = ['labor','materials','sitelog','suppliers','billing','changeorders'];

function switchTab(tab) {
  ALL_TABS.forEach(t => {
    $(t+'Panel')?.classList.add('hidden');
    $('tab_'+t)?.classList.remove('tab-active');
  });
  $(tab+'Panel')?.classList.remove('hidden');
  $('tab_'+tab)?.classList.add('tab-active');
}