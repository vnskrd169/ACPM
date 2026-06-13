// ============================================================
//  ACPM — main.js  |  Global Hub & Navigation
//  Load order: main.js → labor.js → materials.js
// ============================================================

const firebaseConfig = {
    apiKey: "AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA",
    authDomain: "acpm-project-system.firebaseapp.com",
    databaseURL: "https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "acpm-project-system",
    storageBucket: "acpm-project-system.firebasestorage.app",
    messagingSenderId: "330800177544",
    appId: "1:330800177544:web:8f29dcd81ca39976849a3d"
};

if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }

// ── Global State ────────────────────────────────────────────
let currentActiveProjectId = null;
let activeListeners = [];   // track refs so we can .off() them on exit

// ── Helpers ─────────────────────────────────────────────────
function fmt(n) {
    return '₱' + (parseFloat(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function detachAllListeners() {
    activeListeners.forEach(ref => ref.off());
    activeListeners = [];
}

// ── Dashboard / Project Hub ──────────────────────────────────
function loadProjectList() {
    const grid = document.getElementById('projectRegistryGrid');
    if (!grid) return;

    const ref = firebase.database().ref('projects');
    activeListeners.push(ref);

    ref.on('value', (snapshot) => {
        grid.innerHTML = '';
        if (!snapshot.exists()) {
            grid.innerHTML = '<p class="text-slate-500 text-sm col-span-3 text-center py-8">No projects yet. Initialize one above.</p>';
            return;
        }
        snapshot.forEach((child) => {
            const pid  = child.key;
            const data = child.val() || {};
            const budget  = parseFloat(data.allottedLaborBudget)  || 0;
            const lSpent  = parseFloat(data.totalLaborSpent)       || 0;
            const mSpent  = parseFloat(data.totalMaterialSpent)    || 0;
            const pctUsed = budget > 0 ? Math.min(100, Math.round((lSpent / budget) * 100)) : 0;

            const card = document.createElement('div');
            card.className = 'bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-3 hover:border-blue-700 transition cursor-pointer';
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <h3 class="font-black text-white text-sm leading-tight">📁 ${pid}</h3>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-900/50">ACTIVE</span>
                </div>
                <div class="space-y-1 text-[11px] text-slate-400">
                    <div class="flex justify-between"><span>Labor Budget</span><span class="text-white font-bold">${fmt(budget)}</span></div>
                    <div class="flex justify-between"><span>Labor Spent</span><span class="text-red-400 font-bold">${fmt(lSpent)}</span></div>
                    <div class="flex justify-between"><span>Materials Spent</span><span class="text-amber-400 font-bold">${fmt(mSpent)}</span></div>
                </div>
                <div>
                    <div class="flex justify-between text-[10px] text-slate-500 mb-1">
                        <span>Labor Budget Used</span><span>${pctUsed}%</span>
                    </div>
                    <div class="w-full bg-slate-800 rounded-full h-1.5">
                        <div class="h-1.5 rounded-full ${pctUsed >= 90 ? 'bg-red-500' : pctUsed >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}" style="width:${pctUsed}%"></div>
                    </div>
                </div>
                <button onclick="enterProjectWorkspace('${pid}')" class="w-full mt-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 rounded-lg shadow transition">
                    Open Workspace →
                </button>`;
            grid.appendChild(card);
        });
    });
}

// ── Create New Project ───────────────────────────────────────
async function createNewProjectSite() {
    const nameInput   = document.getElementById('newProjectName');
    const budgetInput = document.getElementById('newProjectBudget');
    const name        = nameInput.value.trim();
    const budget      = parseFloat(budgetInput.value) || 0;

    if (!name)       { alert('Pakisulat ang Project Name!'); return; }
    if (budget <= 0) { alert('Pakilagay ang valid na Labor Budget!'); return; }

    // Check if already exists
    const snap = await firebase.database().ref(`projects/${name}`).once('value');
    if (snap.exists()) { alert(`Project "${name}" ay mayroon na!`); return; }

    await firebase.database().ref(`projects/${name}`).set({
        allottedLaborBudget : budget,
        totalLaborSpent     : 0,
        totalMaterialSpent  : 0,
        timestamp           : Date.now()
    });

    nameInput.value   = '';
    budgetInput.value = '';
    alert(`✅ Project "${name}" initialized!`);
}

// ── Enter Workspace ──────────────────────────────────────────
function enterProjectWorkspace(projectId) {
    detachAllListeners();
    currentActiveProjectId = projectId;

    document.getElementById('projectHubView').classList.add('hidden');
    document.getElementById('activeWorkspaceView').classList.remove('hidden');

    const label = document.getElementById('activeSiteNameLabel');
    if (label) label.textContent = projectId;

    // Default to Labor tab
    switchTab('labor');

    // Fire module listeners
    if (typeof listenToLaborRecords   === 'function') listenToLaborRecords(projectId);
    if (typeof listenToMaterials      === 'function') listenToMaterials();
    if (typeof loadProjectScopeStats  === 'function') loadProjectScopeStats(projectId);
}

// ── Exit to Hub ──────────────────────────────────────────────
function exitToHub() {
    detachAllListeners();
    currentActiveProjectId = null;

    document.getElementById('activeWorkspaceView').classList.add('hidden');
    document.getElementById('projectHubView').classList.remove('hidden');

    loadProjectList();
}

// ── Tab Switcher ─────────────────────────────────────────────
function switchTab(tab) {
    const laborPanel     = document.getElementById('laborPanel');
    const materialsPanel = document.getElementById('materialsPanel');
    const laborBtn       = document.getElementById('tabLaborBtn');
    const materialsBtn   = document.getElementById('tabMaterialsBtn');

    if (tab === 'labor') {
        laborPanel.classList.remove('hidden');
        materialsPanel.classList.add('hidden');
        laborBtn.classList.replace('bg-slate-900', 'bg-blue-600');
        laborBtn.classList.replace('text-slate-400', 'text-white');
        materialsBtn.classList.replace('bg-blue-600', 'bg-slate-900');
        materialsBtn.classList.replace('text-white', 'text-slate-400');
    } else {
        materialsPanel.classList.remove('hidden');
        laborPanel.classList.add('hidden');
        materialsBtn.classList.replace('bg-slate-900', 'bg-blue-600');
        materialsBtn.classList.replace('text-slate-400', 'text-white');
        laborBtn.classList.replace('bg-blue-600', 'bg-slate-900');
        laborBtn.classList.replace('text-white', 'text-slate-400');
    }
}

// ── Scope Account Management ─────────────────────────────────
async function saveScopeAccount() {
    if (!currentActiveProjectId) return;
    const name   = document.getElementById('scopeNameInput').value.trim();
    const leader = document.getElementById('scopeLeaderInput').value.trim();
    const bank   = document.getElementById('scopeBankInput').value.trim();

    if (!name || !leader) { alert('Pakisulat ang Scope Name at Leader Name!'); return; }

    const scopeKey = name.replace(/\s+/g, '_').toLowerCase();
    await firebase.database().ref(`projects/${currentActiveProjectId}/scopes/${scopeKey}`).set({ name, leader, bank });

    document.getElementById('scopeNameInput').value   = '';
    document.getElementById('scopeLeaderInput').value = '';
    document.getElementById('scopeBankInput').value   = '';

    refreshScopeSelect();
    alert(`✅ Scope "${name}" saved!`);
}

function refreshScopeSelect() {
    if (!currentActiveProjectId) return;
    firebase.database().ref(`projects/${currentActiveProjectId}/scopes`).once('value', (snap) => {
        const sel = document.getElementById('workerScopeSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">— Select Scope —</option>';
        snap.forEach(child => {
            const s = child.val();
            sel.innerHTML += `<option value="${child.key}">${s.name}</option>`;
        });
    });
}

// ── Worker Roster ────────────────────────────────────────────
async function deployWorkerToRoster() {
    if (!currentActiveProjectId) return;
    const name    = document.getElementById('workerNameInput').value.trim();
    const rate    = parseFloat(document.getElementById('workerRateInput').value) || 750;
    const scopeId = document.getElementById('workerScopeSelect').value;

    if (!name)    { alert('Pakisulat ang Worker Name!'); return; }
    if (!scopeId) { alert('Pumili ng Scope para sa worker!'); return; }

    await firebase.database().ref(`projects/${currentActiveProjectId}/workers`).push({
        name, dailyRate: rate, scopeId, timestamp: Date.now()
    });

    document.getElementById('workerNameInput').value = '';
    alert(`✅ ${name} deployed!`);
}

// ── Boot ─────────────────────────────────────────────────────
window.onload = () => {
    loadProjectList();
};
