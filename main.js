// ═══════════════════════════════════════════════════════════════
//  ACPM v3 — main.js  |  Firebase · Hub · Navigation
//  Script order: main.js → labor.js → materials.js
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
  
  // ── Global state ─────────────────────────────────────────────────
  let currentProjectId = null;
  let _listeners = [];
  
  // ── Helpers ──────────────────────────────────────────────────────
  function peso(n) {
    return '₱' + (parseFloat(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(spent, budget) {
    if (!budget) return 0;
    return Math.min(100, Math.round((spent / budget) * 100));
  }
  function listen(ref, cb) {
    ref.on('value', cb);
    _listeners.push(ref);
  }
  function detachAll() {
    _listeners.forEach(r => r.off());
    _listeners = [];
  }
  function $(id) { return document.getElementById(id); }
  
  // ── Hub boot ─────────────────────────────────────────────────────
  window.onload = () => renderHub();
  
  function renderHub() {
    const grid = $('projectGrid');
    if (!grid) return;
  
    listen(firebase.database().ref('projects'), snap => {
      grid.innerHTML = '';
      if (!snap.exists()) {
        grid.innerHTML = `<p class="hub-empty">No projects yet — create one above.</p>`;
        return;
      }
      snap.forEach(child => {
        const id = child.key;
        const d  = child.val() || {};
        const lb = parseFloat(d.laborBudget)    || 0;
        const mb = parseFloat(d.materialBudget) || 0;
        const ls = parseFloat(d.laborSpent)     || 0;
        const ms = parseFloat(d.materialSpent)  || 0;
        const lp = pct(ls, lb);
        const mp = pct(ms, mb);
  
        const barClass = p => p >= 90 ? 'bar-danger' : p >= 60 ? 'bar-warn' : 'bar-ok';
  
        grid.innerHTML += `
          <div class="proj-card">
            <div class="proj-card-top">
              <div>
                <p class="proj-label">PROJECT</p>
                <h3 class="proj-name">${id}</h3>
                <p class="proj-date">Created ${d.created || '—'}</p>
              </div>
              <span class="proj-status">ACTIVE</span>
            </div>
            <div class="proj-budgets">
              <div class="budget-row">
                <span class="budget-label">👷 Labor</span>
                <span class="budget-val">${peso(lb)}</span>
              </div>
              <div class="mini-bar"><div class="mini-fill ${barClass(lp)}" style="width:${lp}%"></div></div>
              <p class="budget-sub">${peso(ls)} spent · ${lp}% used</p>
              <div class="budget-row" style="margin-top:10px">
                <span class="budget-label">📦 Materials</span>
                <span class="budget-val">${peso(mb)}</span>
              </div>
              <div class="mini-bar"><div class="mini-fill ${barClass(mp)}" style="width:${mp}%"></div></div>
              <p class="budget-sub">${peso(ms)} spent · ${mp}% used</p>
            </div>
            <button class="proj-open-btn" onclick="enterProject('${id}')">Open Workspace →</button>
          </div>`;
      });
    });
  }
  
  // ── Create project ────────────────────────────────────────────────
  async function createProject() {
    const name = $('newName').value.trim();
    const lb   = parseFloat($('newLaborBudget').value)    || 0;
    const mb   = parseFloat($('newMaterialBudget').value) || 0;
  
    if (!name) { alert('Enter a project name.'); return; }
    if (lb <= 0) { alert('Enter a valid Labor Budget.'); return; }
    if (mb <= 0) { alert('Enter a valid Materials Budget.'); return; }
  
    const snap = await firebase.database().ref(`projects/${name}`).once('value');
    if (snap.exists()) { alert(`"${name}" already exists.`); return; }
  
    await firebase.database().ref(`projects/${name}`).set({
      laborBudget:    lb,
      materialBudget: mb,
      laborSpent:     0,
      materialSpent:  0,
      created: new Date().toLocaleDateString('en-PH')
    });
  
    $('newName').value = '';
    $('newLaborBudget').value = '';
    $('newMaterialBudget').value = '';
  }
  
  // ── Workspace enter/exit ──────────────────────────────────────────
  function enterProject(id) {
    detachAll();
    currentProjectId = id;
    $('hubView').classList.add('hidden');
    $('workspaceView').classList.remove('hidden');
    $('wsName').textContent = id;
    switchTab('labor');
    if (typeof initLabor     === 'function') initLabor(id);
    if (typeof initMaterials === 'function') initMaterials(id);
  }
  
  function exitHub() {
    detachAll();
    currentProjectId = null;
    $('workspaceView').classList.add('hidden');
    $('hubView').classList.remove('hidden');
    renderHub();
  }
   // Delete Button
   const delBtn = document.createElement('button');
   delBtn.className = "ml-4 bg-red-600 px-3 py-1 rounded text-xs hover:bg-red-500";
   delBtn.innerText = "Delete";
   delBtn.onclick = (e) => deleteProject(projectId, e); // Pass the event
   div.appendChild(btn);
   div.appendChild(delBtn);
   listContainer.appendChild(div);
  
  // ── Tab switcher ──────────────────────────────────────────────────
  function switchTab(tab) {
    ['laborPanel','materialsPanel'].forEach(p => $(p)?.classList.add('hidden'));
    ['tabLabor','tabMaterials'].forEach(b => $(b)?.classList.remove('tab-active'));
    $(tab === 'labor' ? 'laborPanel'    : 'materialsPanel')?.classList.remove('hidden');
    $(tab === 'labor' ? 'tabLabor'      : 'tabMaterials')?.classList.add('tab-active');
  }
  async function deleteProject(projectId, event) {
    // 1. Pigilan ang event propagation (para hindi bumukas ang workspace pag-click ng delete)
    event.stopPropagation();
    
    // 2. Confirmation (Importante para hindi aksidenteng mabura)
    const confirmed = confirm(`Babala: Buburahin nito ang project na "${projectId}" at lahat ng data nito (Materials, Payroll, Roster). Ituloy?`);
    
    if (confirmed) {
        try {
            await firebase.database().ref(`projects/${projectId}`).remove();
            alert("Project deleted successfully.");
            // Note: Hindi na kailangang i-refresh ang UI manually dahil 
            // naka-.on('value') listener tayo sa loadProjectList().
        } catch (error) {
            console.error("Error deleting project:", error);
            alert("Nagkaroon ng error sa pagbura.");
        }
    }
}