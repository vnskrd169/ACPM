// ═══════════════════════════════════════════════════════════════
//  ACPM v5 — main.js
//  Hub · Navigation · Project lifecycle · PWA registration
//  Script order: main.js → labor.js → materials.js → sitelog.js
//                → suppliers.js → billing.js → changeorders.js
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

// ── PWA Registration ──────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      console.log('ACPM SW registered:', reg.scope);
    }).catch(err => console.log('SW registration failed:', err));
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
         <button class="btn-unlock" onclick="enterProject('${id}',true)">🔓 Open (Read-only)</button>
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
      <p class="proj-date">Created ${d.created||'—'}</p>
    </div>${badge}</div>
    <div class="proj-budgets">
      <div class="budget-row"><span class="budget-label">👷 Labor</span><span class="budget-val ${lA}">${peso(lb)}</span></div>
      <div class="mini-bar"><div class="mini-fill ${budgetBarClass(lp)}" style="width:${lp}%"></div></div>
      <p class="budget-sub">${peso(ls)} spent · ${lp}% ${lp>=80?`<span class="warn-tag">${lp>=95?'⚠ CRITICAL':'⚠ HIGH'}</span>`:''}</p>
      <div class="budget-row" style="margin-top:8px"><span class="budget-label">📦 Materials</span><span class="budget-val ${mA}">${peso(mb)}</span></div>
      <div class="mini-bar"><div class="mini-fill ${budgetBarClass(mp)}" style="width:${mp}%"></div></div>
      <p class="budget-sub">${peso(ms)} spent · ${mp}% ${mp>=80?`<span class="warn-tag">${mp>=95?'⚠ CRITICAL':'⚠ HIGH'}</span>`:''}</p>
    </div>${actions}
  </div>`;
}

// ── Lifecycle ─────────────────────────────────────────────────
async function markComplete(id) {
  if (!confirm(`Mark "${id}" as completed?`)) return;
  await firebase.database().ref(`projects/${id}`).update({ status:'completed', completedDate:new Date().toLocaleDateString('en-PH') });
}
async function reopenProject(id) {
  if (!confirm(`Reopen "${id}" as active?`)) return;
  await firebase.database().ref(`projects/${id}`).update({ status:'active', completedDate:null });
}
async function deleteProject(id) {
  if (!confirm(`⚠ Delete "${id}" and ALL its data?`)) return;
  const c=prompt(`Type DELETE to confirm`);
  if (c!=='DELETE') { alert('Cancelled.'); return; }
  await firebase.database().ref(`projects/${id}`).remove();
}

// ── Comparison ────────────────────────────────────────────────
function renderComparison(projects) {
  const el=$('comparisonView'); if (!el) return;
  if (projects.length<2){ el.innerHTML='<p class="empty-hint">Add 2+ projects to compare.</p>'; return; }
  el.innerHTML=projects.map(p=>{
    const lb=parseFloat(p.laborBudget)||0, mb=parseFloat(p.materialBudget)||0;
    const ls=parseFloat(p.laborSpent)||0,  ms=parseFloat(p.materialSpent)||0;
    const total=lb+mb, spent=ls+ms, p2=pct(spent,total);
    return `<div class="cmp-row">
      <span class="cmp-name">${p.id}</span>
      <div class="cmp-bars">
        <div class="cmp-bar-wrap"><div class="labor-fill" style="width:${pct(ls,lb)}%;height:5px;border-radius:3px;background:var(--blue-l)"></div></div>
        <div class="cmp-bar-wrap"><div class="mat-fill"   style="width:${pct(ms,mb)}%;height:5px;border-radius:3px;background:var(--amber)"></div></div>
      </div>
      <span class="cmp-pct ${kpiAlertClass(p2)}">${p2}%</span>
      <span class="cmp-total">${peso(spent)} / ${peso(total)}</span>
    </div>`;
  }).join('');
}

// ── Create project ────────────────────────────────────────────
async function createProject() {
  const name=$('newName').value.trim();
  const lb=parseFloat($('newLaborBudget').value)||0;
  const mb=parseFloat($('newMaterialBudget').value)||0;
  if (!name)   { alert('Enter a project name.'); return; }
  if (lb<=0)   { alert('Enter a valid Labor Budget.'); return; }
  if (mb<=0)   { alert('Enter a valid Materials Budget.'); return; }
  const snap=await firebase.database().ref(`projects/${name}`).once('value');
  if (snap.exists()) { alert(`"${name}" already exists.`); return; }
  await firebase.database().ref(`projects/${name}`).set({
    laborBudget:lb, materialBudget:mb, laborSpent:0, materialSpent:0,
    status:'active', created:new Date().toLocaleDateString('en-PH')
  });
  $('newName').value=''; $('newLaborBudget').value=''; $('newMaterialBudget').value='';
}

// ── Enter / Exit ──────────────────────────────────────────────
function enterProject(id, readOnly=false) {
  detachAll();
  currentProjectId     = id;
  currentProjectLocked = readOnly;
  $('hubView').classList.add('hidden');
  $('workspaceView').classList.remove('hidden');
  $('wsName').textContent = id;
  const banner=$('lockedBanner');
  if (banner) banner.classList.toggle('hidden', !readOnly);
  switchTab('labor');
  if (typeof initLabor         ==='function') initLabor(id);
  if (typeof initMaterials     ==='function') initMaterials(id);
  if (typeof initSiteLog       ==='function') initSiteLog(id);
  if (typeof initSuppliers === 'function') initSuppliers();
  if (typeof initBilling       ==='function') initBilling(id);
  if (typeof initChangeOrders  ==='function') initChangeOrders(id);
}

function exitHub() {
  detachAll(); currentProjectId=null;
  $('workspaceView').classList.add('hidden');
  $('hubView').classList.remove('hidden');
  renderHub();
}

function unlockForEdit() { $('lockedBanner').classList.add('hidden'); currentProjectLocked=false; }

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