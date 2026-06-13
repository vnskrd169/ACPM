
console.log("ACPM System Loading..."); // Para malaman natin sa F12 kung nagload ang file

function createNewProjectSite() {
    console.log("Create button clicked!"); // Check kung gumagana na ang button
    const nameInput = document.getElementById('newProjectName');
    const budgetInput = document.getElementById('newProjectBudget');
    
    if (!nameInput || !budgetInput) {
        console.error("Inputs not found!");
        return;
    }
    
    const name = nameInput.value.trim();
    const budget = parseFloat(budgetInput.value) || 0;

    if (!name || budget <= 0) {
        alert("State name of site and budget allocated");
        return;
    }

    // Firebase write command
    firebase.database().ref('projects/' + name).set({
        allottedLaborBudget: budget,
        totalLaborSpent: 0,
        timestamp: Date.now()
    }).then(() => {
        alert("Project " + name + " initialized successfully!");
        nameInput.value = '';
        budgetInput.value = '';
    }).catch((error) => {
        console.error("Firebase Error:", error);
    });
}function createNewProjectSite() {
    // Siguraduhing walang typos dito at nasa loob ito ng file na na-save
    console.log("Function is working!"); 
    // ... rest of your code
    // Bagong input sa HTML para sa Material Budget
const materialBudget = parseFloat(document.getElementById('newMaterialBudget').value) || 0;

// Update sa pag-save sa Firebase
async function addMaterialOrder() {
    if (!currentActiveProjectId) return;
    
    const desc = document.getElementById('matDesc').value.trim();
    const qty = parseFloat(document.getElementById('matQty').value) || 0;
    const unitCost = parseFloat(document.getElementById('matCost').value) || 0;
    const category = document.getElementById('matCat').value;
    
    if (!desc || qty <= 0) {
        alert("Pakisulat ang wastong description at quantity!");
        return;
    }

    const newMaterial = { 
        description: desc, 
        qty: qty, 
        unitCost: unitCost, 
        totalCost: qty * unitCost, 
        category: category, 
        status: 'ordered', 
        timestamp: Date.now() 
    };

    // Paggamit ng await para siguradong tapos bago mag-clear
    await firebase.database().ref(`projects/${currentActiveProjectId}/materials`).push(newMaterial);
    
    // I-clear ang inputs
    document.getElementById('matDesc').value = '';
    document.getElementById('matQty').value = '';
    document.getElementById('matCost').value = '';
}

// 2. LISTEN TO MATERIALS (Simplified Tracking)
function listenToMaterials() {
    if (!currentActiveProjectId) return;
    
    firebase.database().ref(`projects/${currentActiveProjectId}/materials`).on('value', async (snapshot) => {
        let totalSpent = 0;

        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const mat = child.val();
                if (mat.status === 'paid' || mat.status === 'delivered') {
                    totalSpent += mat.totalCost;
                }
            });
        }

        // I-save ang total spent sa project node para laging updated
        await firebase.database().ref(`projects/${currentActiveProjectId}`).update({
            totalMaterialSpent: totalSpent
        });
        
        // I-update ang UI (Global budget vs Spent)
        updateMaterialUI(totalSpent);
    });
}
}
// =======================================================================
// 1. FIREBASE INITIALIZATION & CONFIGURATION BLOCK
// =======================================================================
const firebaseConfig = {
    apiKey: "AIzaSyAs-YOUR-ACTUAL-API-KEY-HERE",
    authDomain: "acpm-project-management.firebaseapp.com",
    databaseURL: "https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app/", // <-- PALITAN MO ITO NG TOTOONG FIREBASE REALTIME URL MO!
    projectId: "acpm-project-management",
    storageBucket: "acpm-project-management.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef1234567890"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Global System Scope Memory
let currentActiveProjectId = null; 
let projectScopesDataMemory = {}; 

const initialBudgets = {
    Architectural: 822900,
    Plumbing: 117200,
    Electrical: 432840,
    Cabinets: 456575
};

// Automatic load global tracker triggers on launch loop
document.addEventListener("DOMContentLoaded", () => {
    // Set system default date indicators to active modern dates
    const todayStr = new Date().toISOString().split('T')[0];
    if(document.getElementById('cutoffStart')) document.getElementById('cutoffStart').value = todayStr;
    if(document.getElementById('cutoffEnd')) document.getElementById('cutoffEnd').value = todayStr;
    
    listenToGlobalHubRegistry();
});

// =======================================================================
// 2. PRIMARY TAB ROUTERS AND GATEWAYS ENGINE
// =======================================================================

function enterProjectWorkspace(projectId) {
    currentActiveProjectId = projectId; 

    document.getElementById('activeSiteNameLabel').innerText = projectId;
    document.getElementById('projectHubView').classList.add('hidden');
    document.getElementById('activeWorkspaceView').classList.remove('hidden');

    // Default target sub-screen interface state is Labor Management
    switchTab('labor');

    // Fire data streaming sync loops instantly
    listenToMaterials();
    listenToLaborRecords(projectId);
}

function switchTab(tabName) {
    const panels = {
        labor: document.getElementById('laborPanel'),
        materials: document.getElementById('materialsPanel')
    };
    const buttons = {
        labor: document.getElementById('tabLaborBtn'),
        materials: document.getElementById('tabMaterialsBtn')
    };

    Object.keys(panels).forEach(key => {
        if (!panels[key] || !buttons[key]) return;
        
        if (key === tabName) {
            panels[key].classList.remove('hidden');
            panels[key].classList.add('block');
            buttons[key].className = "px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white shadow transition";
        } else {
            panels[key].classList.remove('block');
            panels[key].classList.add('hidden');
            buttons[key].className = "px-4 py-2 text-sm font-semibold rounded-lg bg-slate-900 text-slate-400 hover:text-slate-200 transition";
        }
    });
}

function exitToHub() {
    if (currentActiveProjectId) {
        firebase.database().ref(`projects/${currentActiveProjectId}/materials`).off();
        firebase.database().ref(`projects/${currentActiveProjectId}/roster`).off();
        firebase.database().ref(`projects/${currentActiveProjectId}/scopes`).off();
    }
    document.getElementById('activeWorkspaceView').classList.add('hidden');
    document.getElementById('projectHubView').classList.remove('hidden');
    currentActiveProjectId = null;
}

// =======================================================================
// 3. LABOR CALCULATIONS & PAYROLL TIMECARD STRUCTURAL LOOPS
// =======================================================================

function listenToGlobalHubRegistry() {
    firebase.database().ref('projects').on('value', (snapshot) => {
        const grid = document.getElementById('projectRegistryGrid');
        if (!grid) return;
        grid.innerHTML = '';

        if (!snapshot.exists()) {
            grid.innerHTML = `<p class="text-slate-500 text-xs italic p-4">No active construction project targets currently launched.</p>`;
            return;
        }

        snapshot.forEach((child) => {
            const projectId = child.key;
            const projectData = child.val();
            
            const budget = projectData.allottedLaborBudget || 0;
            const spent = projectData.totalLaborSpent || 0;
            const pct = budget > 0 ? Math.min(Math.round((spent / budget) * 100), 100) : 0;
            
            let rosterCount = 0;
            if (projectData.roster) rosterCount = Object.keys(projectData.roster).length;

            const card = document.createElement('div');
            card.className = "bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col justify-between space-y-4";
            card.innerHTML = `
                <div>
                    <div class="flex justify-between items-start">
                        <h3 class="text-base font-bold text-white tracking-tight">${projectId}</h3>
                        <button onclick="deleteEntireProjectLocation('${projectId}')" class="text-[10px] font-semibold text-slate-600 hover:text-red-400 transition">Delete</button>
                    </div>
                    <p class="text-xs text-slate-400 mt-1">Budget: ₱${budget.toLocaleString()}</p>
                    <div class="w-full bg-slate-950 h-2 rounded-full mt-3 overflow-hidden border border-slate-800">
                        <div class="bg-emerald-500 h-full transition-all duration-500" style="width: ${pct}%"></div>
                    </div>
                    <div class="flex justify-between text-[11px] font-medium text-slate-400 mt-1.5">
                        <span>Used: ${pct}%</span>
                        <span>Roster: ${rosterCount} Men</span>
                    </div>
                </div>
                <div class="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
                    <span class="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Accumulated Spent</span>
                    <span class="text-sm font-black text-emerald-400">₱${spent.toLocaleString()}</span>
                </div>
                <button onclick="enterProjectWorkspace('${projectId}')" class="w-full bg-slate-850 hover:bg-slate-800 border border-slate-700/60 text-white text-xs font-bold py-2.5 rounded-xl transition">
                    Enter Site Workspace →
                </button>
            `;
            grid.appendChild(card);
        });
    });
}

async function createNewProjectSite() {
    const nameInput = document.getElementById('newProjectName');
    const budgetInput = document.getElementById('newProjectBudget');
    const name = nameInput.value.trim();
    const budget = parseFloat(budgetInput.value) || 0;

    if (!name || budget <= 0) {
        alert("Pakisulat ang wastong pangalan ng site at budget framework bago i-save!");
        return;
    }
    await firebase.database().ref(`projects/${name}`).set({ allottedLaborBudget: budget, totalLaborSpent: 0, timestamp: Date.now() });
    nameInput.value = ''; budgetInput.value = '';
}

function listenToLaborRecords(projectId) {
    firebase.database().ref(`projects/${projectId}`).on('value', (snap) => {
        if (!snap.exists()) return;
        const data = snap.val();
        const budget = data.allottedLaborBudget || 0;
        const spent = data.totalLaborSpent || 0;
        const margin = budget - spent;

        if(document.getElementById('scopeLaborBudget')) document.getElementById('scopeLaborBudget').innerText = `₱${budget.toLocaleString('en-US', {minimumFractionDigits:2})}`;
        if(document.getElementById('scopeLaborSpent')) document.getElementById('scopeLaborSpent').innerText = `₱${spent.toLocaleString('en-US', {minimumFractionDigits:2})}`;
        
        const marginLabel = document.getElementById('scopeLaborMargin');
        if (marginLabel) {
            marginLabel.innerText = `₱${margin.toLocaleString('en-US', {minimumFractionDigits:2})}`;
            marginLabel.className = margin < 0 ? "text-base font-bold text-red-500 animate-pulse mt-1 block" : "text-base font-bold text-emerald-400 mt-1 block";
        }
    });

    firebase.database().ref(`projects/${projectId}/scopes`).on('value', (snap) => {
        const select = document.getElementById('workerScopeSelect');
        if (!select) return;
        select.innerHTML = '';
        projectScopesDataMemory = {};

        if (snap.exists()) {
            snap.forEach((child) => {
                const scopeId = child.key;
                const scopeVal = child.val();
                projectScopesDataMemory[scopeId] = scopeVal;
                const opt = document.createElement('option');
                opt.value = scopeId;
                opt.innerText = scopeVal.scopeName || scopeId;
                select.appendChild(opt);
            });
        }
    });

    firebase.database().ref(`projects/${projectId}/roster`).on('value', (snap) => {
        const container = document.getElementById('timecardGridContainer');
        if (!container) return;
        container.innerHTML = '';

        if (!snap.exists()) {
            container.innerHTML = `<div class="p-6 text-center bg-slate-900 border border-slate-800 rounded-xl text-slate-500 text-xs">Wala pang idinedeploy na manggagawa sa site na ito.</div>`;
            return;
        }

        snap.forEach((child) => {
            const workerId = child.key;
            const worker = child.val();
            const card = document.createElement('div');
            card.className = "bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3 shadow";
            card.innerHTML = `
                <div class="flex flex-wrap justify-between items-center border-b border-slate-800 pb-2">
                    <div>
                        <h4 class="text-sm font-bold text-white">${worker.name}</h4>
                        <p class="text-[11px] text-slate-400 mt-0.5">Account Scope Target: <span class="text-blue-400 font-semibold">${worker.scopeName || 'Unassigned'}</span></p>
                    </div>
                    <div class="text-right"><span class="text-xs text-slate-400">Daily Rate: </span><span class="text-xs font-bold text-emerald-400">₱${worker.rate.toLocaleString()}</span></div>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-7 gap-2">
                    ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `
                        <div class="bg-slate-950 p-2 rounded border border-slate-850 text-center">
                            <label class="text-[10px] text-slate-500 font-bold block uppercase tracking-wider mb-1">${day}</label>
                            <input type="number" data-worker="${workerId}" data-day="${day.toLowerCase()}" value="${worker.hours?.[day.toLowerCase()] || 0}" 
                                class="w-full bg-slate-900 border border-slate-800 rounded p-1 text-center text-xs text-white font-bold outline-none focus:border-slate-600 hour-input-field">
                        </div>
                    `).join('')}
                </div>
                <div class="flex justify-between items-center text-xs pt-1">
                    <button onclick="terminateWorkerDeployment('${workerId}')" class="text-slate-500 hover:text-red-400 font-semibold transition">Remove Worker</button>
                    <span class="text-[11px] font-medium text-slate-400">Gross Comp: <span class="font-bold text-white underline" id="grossComp-${workerId}">₱0.00</span></span>
                </div>
            `;
            container.appendChild(card);
            calculateIndividualRowLiveCompensation(workerId, worker.rate);
        });
        attachInputHookListeners();
    });
}

async function saveScopeAccount() {
    if (!currentActiveProjectId) return;
    const name = document.getElementById('scopeNameInput').value.trim();
    const leader = document.getElementById('scopeLeaderInput').value.trim();
    const bank = document.getElementById('scopeBankInput').value.trim();
    if (!name) return;
    await firebase.database().ref(`projects/${currentActiveProjectId}/scopes`).push({ scopeName: name, scopeLeader: leader, bankAccount: bank });
    document.getElementById('scopeNameInput').value = ''; document.getElementById('scopeLeaderInput').value = ''; document.getElementById('scopeBankInput').value = '';
}

async function deployWorkerToRoster() {
    if (!currentActiveProjectId) return;
    const name = document.getElementById('workerNameInput').value.trim();
    const rate = parseFloat(document.getElementById('workerRateInput').value) || 0;
    const scopeId = document.getElementById('workerScopeSelect').value;
    if (!name || rate <= 0) return;
    const selectedScopeName = projectScopesDataMemory[scopeId]?.scopeName || '';
    await firebase.database().ref(`projects/${currentActiveProjectId}/roster`).push({
        name: name, rate: rate, scopeId: scopeId, scopeName: selectedScopeName, hours: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 }
    });
    document.getElementById('workerNameInput').value = '';
}

function fillAllEightHours() { document.querySelectorAll('.hour-input-field').forEach(el => { el.value = 8; triggerInlineInputChange(el); }); }
function clearTimecardGrid() { document.querySelectorAll('.hour-input-field').forEach(el => { el.value = 0; triggerInlineInputChange(el); }); }

function triggerInlineInputChange(el) {
    const workerId = el.getAttribute('data-worker');
    const day = el.getAttribute('data-day');
    const val = parseFloat(el.value) || 0;
    firebase.database().ref(`projects/${currentActiveProjectId}/roster/${workerId}/hours/${day}`).set(val);
}
function attachInputHookListeners() { document.querySelectorAll('.hour-input-field').forEach(el => { el.removeEventListener('change', () => triggerInlineInputChange(el)); el.addEventListener('change', () => triggerInlineInputChange(el)); }); }

function calculateIndividualRowLiveCompensation(workerId, rate) {
    firebase.database().ref(`projects/${currentActiveProjectId}/roster/${workerId}/hours`).on('value', (snap) => {
        let tot = 0; if (snap.exists()) { snap.forEach(h => { tot += parseFloat(h.val()) || 0; }); }
        const comp = (tot / 8) * rate;
        const label = document.getElementById(`grossComp-${workerId}`);
        if (label) label.innerText = `₱${comp.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    });
}

async function compileTimecardPayouts() {
    if (!currentActiveProjectId) return;
    firebase.database().ref(`projects/${currentActiveProjectId}/roster`).once('value', async (snapshot) => {
        if (!snapshot.exists()) return;
        let totalPayrollSpentThisWeek = 0;
        snapshot.forEach((child) => {
            const worker = child.val();
            let hoursCount = 0;
            if (worker.hours) { Object.keys(worker.hours).forEach(d => { hoursCount += parseFloat(worker.hours[d]) || 0; }); }
            totalPayrollSpentThisWeek += (hoursCount / 8) * worker.rate;
        });
        const currentRef = firebase.database().ref(`projects/${currentActiveProjectId}/totalLaborSpent`);
        currentRef.once('value', async (currentSpentSnap) => {
            const oldSpentValue = currentSpentSnap.val() || 0;
            await firebase.database().ref(`projects/${currentActiveProjectId}`).update({ totalLaborSpent: oldSpentValue + totalPayrollSpentThisWeek });
            alert(`Matagumpay na na-compile ang payroll sahod nagkakahalaga ng ₱${totalPayrollSpentThisWeek.toLocaleString()}`);
            clearTimecardGrid();
        });
    });
}

function terminateWorkerDeployment(key) { if (confirm("Alisin ang manggagawang ito sa roster ng active site?")) firebase.database().ref(`projects/${currentActiveProjectId}/roster/${key}`).remove(); }
function deleteEntireProjectLocation(projectId) { if (confirm(`Sigurado ka bang nais mong permanenteng burahin ang buong site record ng "${projectId}"?`)) firebase.database().ref(`projects/${projectId}`).remove(); }

// =======================================================================
// 4. PROCUREMENT MATRIX LOGISTICS MODULE (MATERIALS MODULE)
// =======================================================================

async function addMaterialOrder() {
    if (!currentActiveProjectId) return;
    const desc = document.getElementById('matDesc').value.trim();
    const size = document.getElementById('matSize').value.trim();
    const qty = parseFloat(document.getElementById('matQty').value) || 0;
    const unit = document.getElementById('matUnit').value.trim();
    const category = document.getElementById('matCat').value;
    const unitCost = parseFloat(document.getElementById('matCost').value) || 0;
    const totalCost = qty * unitCost;

    if (!desc || qty <= 0) { alert("Pakisulat ang wastong description at quantity value!"); return; }
    
    const newMaterial = { description: desc, size: size, qty: qty, unit: unit, category: category, unitCost: unitCost, totalCost: totalCost, status: 'ordered', remarks: '', timestamp: Date.now() };
    await firebase.database().ref(`projects/${currentActiveProjectId}/materials`).push(newMaterial);
    
    document.getElementById('matDesc').value = ''; document.getElementById('matSize').value = ''; document.getElementById('matQty').value = ''; document.getElementById('matUnit').value = ''; document.getElementById('matCost').value = '';
}

function listenToMaterials() {
    // Imbis na hiwa-hiwalay na spent per category:
let overallTotalCost = 0;

// Sa loob ng loop (pag-compute ng items):
if (mat.status === 'paid' || mat.status === 'delivered') {
    overallTotalCost += mat.totalCost;
}

// I-update ang Firebase para sa Global Material Spent
firebase.database().ref(`projects/${currentActiveProjectId}`).update({ totalMaterialSpent: overallTotalCost });
    if (!currentActiveProjectId) return;
    firebase.database().ref(`projects/${currentActiveProjectId}/materials`).on('value', (snapshot) => {
        const materialsTableBody = document.getElementById('materialsTableBody');
        if (!materialsTableBody) return;
        materialsTableBody.innerHTML = ''; 

        let overallTotalCost = 0;
        let spent = { Architectural: 0, Plumbing: 0, Electrical: 0, Cabinets: 0 };

        if (snapshot.exists()) {
            const data = snapshot.val();
            Object.keys(data).forEach((key) => {
                const mat = data[key];
                overallTotalCost += mat.totalCost;

                if (mat.status === 'paid' || mat.status === 'delivered') { spent[mat.category] += mat.totalCost; }

                let rowBgClass = "border-b border-slate-800 hover:bg-slate-900/50 transition text-slate-300";
                if (mat.status === 'hold') rowBgClass = "bg-red-950/30 border-b border-red-900 text-red-200 animate-pulse";

                const getStatusBtnClass = (currentStatus, targetStatus, activeColor) => {
                    return currentStatus === targetStatus ? `px-2 py-1 rounded font-bold text-[10px] ${activeColor} text-white shadow` : `px-2 py-1 rounded font-medium text-[10px] bg-slate-950 text-slate-500 hover:text-slate-300`;
                };

                const tr = document.createElement('tr');
                tr.className = rowBgClass;
                tr.innerHTML = `
                    <td class="p-4 font-medium text-white">${mat.description}</td>
                    <td class="p-4 text-slate-400">${mat.size || '-'}</td>
                    <td class="p-4 text-center font-semibold">${mat.qty} <span class="text-slate-500 font-normal">${mat.unit}</span></td>
                    <td class="p-4 text-right">₱${mat.unitCost.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                    <td class="p-4 text-right font-bold text-amber-400">₱${mat.totalCost.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                    <td class="p-4 text-center">
                        <div class="inline-flex space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                            <button onclick="updateMatStatus('${key}', 'ordered')" class="${getStatusBtnClass(mat.status, 'ordered', 'bg-blue-600')}">Ordered</button>
                            <button onclick="updateMatStatus('${key}', 'paid')" class="${getStatusBtnClass(mat.status, 'paid', 'bg-amber-500')}">Paid</button>
                            <button onclick="updateMatStatus('${key}', 'delivered')" class="${getStatusBtnClass(mat.status, 'delivered', 'bg-emerald-600')}">Delivered</button>
                            <button onclick="updateMatStatus('${key}', 'hold')" class="${getStatusBtnClass(mat.status, 'hold', 'bg-red-600')}">Hold</button>
                        </div>
                    </td>
                    <td class="p-4">
                        <input type="text" value="${mat.remarks || ''}" placeholder="Add auditing log notes..." onchange="updateMatRemarks('${key}', this.value)"
                            class="bg-transparent hover:bg-slate-950 focus:bg-slate-950 border border-transparent focus:border-slate-800 text-xs text-slate-300 rounded p-1 w-full outline-none transition">
                    </td>
                    <td class="p-4 text-center"><button onclick="deleteMaterial('${key}')" class="text-slate-500 hover:text-red-400 font-bold transition">✕</button></td>
                `;
                materialsTableBody.appendChild(tr);
            });
        }

        if(document.getElementById('matTotalLabel')) document.getElementById('matTotalLabel').innerText = `₱${overallTotalCost.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        
        updateDashboardCard('balArch', initialBudgets.Architectural - spent.Architectural);
        updateDashboardCard('balPlumb', initialBudgets.Plumbing - spent.Plumbing);
        updateDashboardCard('balElec', initialBudgets.Electrical - spent.Electrical);
        updateDashboardCard('balCabinets', initialBudgets.Cabinets - spent.Cabinets);
    });
}

function updateDashboardCard(elementId, finalBalance) {
    const el = document.getElementById(elementId); if (!el) return;
    el.innerText = `₱${finalBalance.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    el.className = finalBalance <= 20000 ? "text-base font-bold text-red-500 animate-pulse mt-1 block" : "text-base font-bold text-emerald-400 mt-1 block";
}

function updateMatStatus(key, newStatus) { if (currentActiveProjectId) firebase.database().ref(`projects/${currentActiveProjectId}/materials/${key}`).update({ status: newStatus }); }
// Real-time update auditing remarks logs
function updateMatRemarks(key, newRemarks) { if (currentActiveProjectId) firebase.database().ref(`projects/${currentActiveProjectId}/materials/${key}`).update({ remarks: newRemarks }); }
function deleteMaterial(key) { if (currentActiveProjectId && confirm("Permanently delete this material ledger item?")) firebase.database().ref(`projects/${currentActiveProjectId}/materials/${key}`).remove(); }