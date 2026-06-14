// ═══════════════════════════════════════════════════════════════
//  ACPM v4 — main.js
//  Hub · Navigation · Project lifecycle (active/completed/delete)
//  Script order: main.js → labor.js → materials.js → sitelog.js → suppliers.js
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
let currentProjectId   = null;
let currentProjectLocked = true;
let _listeners = [];

// ── Helpers ───────────────────────────────────────────────────
function peso(n) {
  return '₱' + (parseFloat(n)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function pct(spent,budget){ return (!budget)?0:Math.min(100,Math.round((spent/budget)*100)); }
function listen(ref,cb){ ref.on('value',cb); _listeners.push(ref); }
function detachAll(){ _listeners.forEach(r=>r.off()); _listeners=[]; }
function $(id){ return document.getElementById(id); }
function setText(id,v){ const e=$(id); if(e) e.textContent=v; }

function budgetBarClass(p){ return p>=95?'bar-danger':p>=80?'bar-warn':'bar-ok'; }
function kpiAlertClass(p){  return p>=95?'kpi-danger':p>=80?'kpi-warn':''; }

// ── Boot ──────────────────────────────────────────────────────
window.onload = ()=>{ showHubTab('active'); renderHub(); };

// ── Hub tab toggle ────────────────────────────────────────────
function showHubTab(tab){
  ['active','completed'].forEach(t=>{
    $(t+'ProjectsPane')?.classList.toggle('hidden', t!==tab);
    $('hubTab_'+t)?.classList.toggle('tab-active', t===tab);
  });
}

// ── Render Hub ────────────────────────────────────────────────
function renderHub(){
  const activeGrid    = $('projectGrid');
  const completedGrid = $('completedGrid');
  if (!activeGrid) return;

  listen(firebase.database().ref('projects'), snap=>{
    activeGrid.innerHTML    = '';
    completedGrid.innerHTML = '';
    let activeCount=0, completedCount=0;

    if (!snap.exists()){
      activeGrid.innerHTML = `<p class="hub-empty">No projects yet — create one above.</p>`;
      completedGrid.innerHTML = `<p class="hub-empty">No completed projects.</p>`;
      renderComparison([]);
      return;
    }

    const allProjects = [];
    snap.forEach(child=>{
      const id=child.key, d=child.val()||{};
      allProjects.push({id,...d});
      const lb=parseFloat(d.laborBudget)||0, mb=parseFloat(d.materialBudget)||0;
      const ls=parseFloat(d.laborSpent)||0,  ms=parseFloat(d.materialSpent)||0;
      const lp=pct(ls,lb), mp=pct(ms,mb);
      const isCompleted = d.status==='completed';

      const card = buildProjectCard(id,d,lb,mb,ls,ms,lp,mp,isCompleted);
      if (isCompleted){ completedGrid.innerHTML+=card; completedCount++; }
      else            { activeGrid.innerHTML+=card;    activeCount++; }
    });

    if (!activeCount)    activeGrid.innerHTML    = `<p class="hub-empty">No active projects.</p>`;
    if (!completedCount) completedGrid.innerHTML = `<p class="hub-empty">No completed projects yet.</p>`;

    renderComparison(allProjects);
  });
}

function buildProjectCard(id,d,lb,mb,ls,ms,lp,mp,isCompleted){
  const lAlert = kpiAlertClass(lp), mAlert = kpiAlertClass(mp);
  const lockBadge = isCompleted
    ? `<span class="proj-status completed-tag">✓ DONE</span>`
    : `<span class="proj-status active-tag">ACTIVE</span>`;

  const actions = isCompleted
    ? `<div class="proj-actions">
         <button class="btn-unlock" onclick="toggleProjectLock('${id}',true)">🔓 Unlock for Edit</button>
         <button class="btn-reopen" onclick="reopenProject('${id}')">↩ Reopen</button>
         <button class="btn-delete" onclick="deleteProject('${id}')">🗑 Delete</button>
       </div>`
    : `<div class="proj-actions">
         <button class="proj-open-btn" onclick="enterProject('${id}')">Open Workspace →</button>
         <button class="btn-complete" onclick="markComplete('${id}')">✓ Mark Complete</button>
         <button class="btn-delete"   onclick="deleteProject('${id}')">🗑</button>
       </div>`;

  return `<div class="proj-card ${isCompleted?'proj-card-done':''}">
    <div class="proj-card-top">
      <div><p class="proj-label">PROJECT</p><h3 class="proj-name">${id}</h3>
        <p class="proj-date">Created ${d.created||'—'}</p></div>
      ${lockBadge}
    </div>
    <div class="proj-budgets">
      <div class="budget-row"><span class="budget-label">👷 Labor</span>
        <span class="budget-val ${lAlert}">${peso(lb)}</span></div>
      <div class="mini-bar"><div class="mini-fill ${budgetBarClass(lp)}" style="width:${lp}%"></div></div>
      <p class="budget-sub">${peso(ls)} spent · ${lp}% used ${lp>=80?`<span class="warn-tag">${lp>=95?'⚠ CRITICAL':'⚠ HIGH'}</span>`:''}</p>
      <div class="budget-row" style="margin-top:8px"><span class="budget-label">📦 Materials</span>
        <span class="budget-val ${mAlert}">${peso(mb)}</span></div>
      <div class="mini-bar"><div class="mini-fill ${budgetBarClass(mp)}" style="width:${mp}%"></div></div>
      <p class="budget-sub">${peso(ms)} spent · ${mp}% used ${mp>=80?`<span class="warn-tag">${mp>=95?'⚠ CRITICAL':'⚠ HIGH'}</span>`:''}</p>
    </div>
    ${actions}
  </div>`;
}

// ── Project lifecycle ─────────────────────────────────────────
async function markComplete(id){
  if (!confirm(`Mark "${id}" as completed? It will move to the Completed tab.`)) return;
  await firebase.database().ref(`projects/${id}`).update({ status:'completed', completedDate: new Date().toLocaleDateString('en-PH') });
}

async function reopenProject(id){
  if (!confirm(`Reopen "${id}" as active?`)) return;
  await firebase.database().ref(`projects/${id}`).update({ status:'active', completedDate: null });
}

async function deleteProject(id){
  if (!confirm(`⚠ Permanently delete "${id}" and ALL its data? This cannot be undone.`)) return;
  if (!confirm(`Are you absolutely sure? Type OK in the next prompt.`)) return;
  const confirm2 = prompt(`Type DELETE to confirm removal of "${id}"`);
  if (confirm2 !== 'DELETE') { alert('Cancelled.'); return; }
  await firebase.database().ref(`projects/${id}`).remove();
}

function toggleProjectLock(id, forEdit){
  // Just enter workspace — lock state handled inside workspace
  enterProject(id, forEdit);
}

// ── Project comparison ────────────────────────────────────────
function renderComparison(projects){
  const el = $('comparisonView');
  if (!el) return;
  if (projects.length < 2){ el.innerHTML='<p class="empty-hint">Add 2+ projects to see comparison.</p>'; return; }

  el.innerHTML = projects.map(p=>{
    const lb=parseFloat(p.laborBudget)||0, mb=parseFloat(p.materialBudget)||0;
    const ls=parseFloat(p.laborSpent)||0,  ms=parseFloat(p.materialSpent)||0;
    const total = lb+mb, spent = ls+ms;
    const p2 = pct(spent,total);
    return `<div class="cmp-row">
      <span class="cmp-name">${p.id}</span>
      <div class="cmp-bars">
        <div class="cmp-bar-wrap" title="Labor: ${peso(ls)} / ${peso(lb)}">
          <div class="cmp-fill labor-fill" style="width:${pct(ls,lb)}%"></div>
        </div>
        <div class="cmp-bar-wrap" title="Materials: ${peso(ms)} / ${peso(mb)}">
          <div class="cmp-fill mat-fill" style="width:${pct(ms,mb)}%"></div>
        </div>
      </div>
      <span class="cmp-pct ${kpiAlertClass(p2)}">${p2}%</span>
      <span class="cmp-total">${peso(spent)} / ${peso(total)}</span>
    </div>`;
  }).join('');
}

// ── Create project ────────────────────────────────────────────
async function createProject(){
  const name = $('newName').value.trim();
  const lb   = parseFloat($('newLaborBudget').value)    || 0;
  const mb   = parseFloat($('newMaterialBudget').value) || 0;
  if (!name)   { alert('Enter a project name.'); return; }
  if (lb <= 0) { alert('Enter a valid Labor Budget.'); return; }
  if (mb <= 0) { alert('Enter a valid Materials Budget.'); return; }
  const snap = await firebase.database().ref(`projects/${name}`).once('value');
  if (snap.exists()) { alert(`"${name}" already exists.`); return; }
  await firebase.database().ref(`projects/${name}`).set({
    laborBudget:mb, materialBudget:mb, laborSpent:0, materialSpent:0,
    status:'active', created:new Date().toLocaleDateString('en-PH')
  });
  // fix: set labor correctly
  await firebase.database().ref(`projects/${name}`).update({ laborBudget: lb });
  $('newName').value=''; $('newLaborBudget').value=''; $('newMaterialBudget').value='';
}

// ── Enter/Exit workspace ──────────────────────────────────────
function enterProject(id, unlocked=false){
  detachAll();
  currentProjectId = id;
  currentProjectLocked = !unlocked;

  $('hubView').classList.add('hidden');
  $('workspaceView').classList.remove('hidden');
  $('wsName').textContent = id;

  // Show lock banner if completed
  firebase.database().ref(`projects/${id}/status`).once('value', snap=>{
    const isCompleted = snap.val()==='completed';
    const banner = $('lockedBanner');
    if (banner) banner.classList.toggle('hidden', !isCompleted || unlocked);
  });

  switchTab('labor');
  if (typeof initLabor     ==='function') initLabor(id);
  if (typeof initMaterials ==='function') initMaterials(id);
  if (typeof initSiteLog   ==='function') initSiteLog(id);
  if (typeof initSuppliers ==='function') initSuppliers(id);
}

function exitHub(){
  detachAll();
  currentProjectId = null;
  $('workspaceView').classList.add('hidden');
  $('hubView').classList.remove('hidden');
  renderHub();
}

function unlockForEdit(){
  const banner = $('lockedBanner');
  if (banner) banner.classList.add('hidden');
  currentProjectLocked = false;
}

// ── Tab switcher ──────────────────────────────────────────────
function switchTab(tab){
  const panels = ['laborPanel','materialsPanel','sitelogPanel','suppliersPanel'];
  const tabs   = ['tabLabor','tabMaterials','tabSitelog','tabSuppliers'];
  panels.forEach(p => $(p)?.classList.add('hidden'));
  tabs.forEach(t   => $(t)?.classList.remove('tab-active'));
  const map = { labor:'laborPanel', materials:'materialsPanel', sitelog:'sitelogPanel', suppliers:'suppliersPanel' };
  const tmap= { labor:'tabLabor',   materials:'tabMaterials',   sitelog:'tabSitelog',   suppliers:'tabSuppliers' };
  $(map[tab])?.classList.remove('hidden');
  $(tmap[tab])?.classList.add('tab-active');
}