// =======================================================================
// GLOBAL STATE SYSTEM
// =======================================================================
let currentActiveProjectId = null; 

// Initial Budgets Matrix (Directly mapped from your Excel tracker categories)
const initialBudgets = {
    Architectural: 822900,
    Plumbing: 117200,
    Electrical: 432840,
    Cabinets: 456575
};

// =======================================================================
// SYSTEM NAVIGATION CONTROLLERS
// =======================================================================

// 1. GATEWAY ACCESS: Open specific project workspace environment
function enterProjectWorkspace(projectId) {
    currentActiveProjectId = projectId; 

    // Update Workspace View Header UI Labels dynamically
    document.getElementById('activeSiteNameLabel').innerText = projectId;

    // Toggle viewport container screens
    document.getElementById('projectHubView').classList.add('hidden');
    document.getElementById('activeWorkspaceView').classList.remove('hidden');

    // Force default sub-tab to Labor & Payroll on launch
    switchTab('labor');

    // Establish realtime database event streams for this specific site
    listenToMaterials();
    
    // Safety check if your existing labor compiler listener exists
    if (typeof listenToLaborRecords === "function") {
        listenToLaborRecords(projectId); 
    }
}

// 2. INNER DESKTOP WORKSPACE TAB ROUTER
function switchTab(tabName) {
    const panels = {
        labor: document.getElementById('laborPanel'),
        materials: document.getElementById('materialsPanel'),
        misc: document.getElementById('miscPanel')
    };
    const buttons = {
        labor: document.getElementById('tabLaborBtn'),
        materials: document.getElementById('tabMaterialsBtn'),
        misc: document.getElementById('tabMiscBtn')
    };

    // Cycle through view instances and balance active color classes
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

// 3. EXIT STRATEGY: Close workspace state and reset variables safely
function exitToHub() {
    // Terminate existing open data streams to prevent cross-leakage across sites
    if (currentActiveProjectId) {
        firebase.database().ref(`projects/${currentActiveProjectId}/materials`).off();
        firebase.database().ref(`projects/${currentActiveProjectId}/labor`).off();
    }

    // Toggle viewport screens
    document.getElementById('activeWorkspaceView').classList.add('hidden');
    document.getElementById('projectHubView').classList.remove('hidden');

    // Reset current active memory scope back to zero
    currentActiveProjectId = null;
}

// =======================================================================
// LOGISTICS MANAGEMENT SUITE (MATERIALS MODULE)
// =======================================================================

// ACTION: Log New Purchase Request to Database Context Path
async function addMaterialOrder() {
    if (!currentActiveProjectId) return;

    const desc = document.getElementById('matDesc').value.trim();
    const size = document.getElementById('matSize').value.trim();
    const qty = parseFloat(document.getElementById('matQty').value) || 0;
    const unit = document.getElementById('matUnit').value.trim();
    const category = document.getElementById('matCat').value;
    const unitCost = parseFloat(document.getElementById('matCost').value) || 0;
    const totalCost = qty * unitCost;

    if (!desc || qty <= 0) {
        alert("Please output a valid description and quantity value!");
        return;
    }

    const newMaterial = {
        description: desc,
        size: size,
        qty: qty,
        unit: unit,
        category: category,
        unitCost: unitCost,
        totalCost: totalCost,
        status: 'ordered', // Base status stage inside check-check workflow Lifecycle
        remarks: '',
        timestamp: Date.now()
    };

    try {
        await firebase.database().ref(`projects/${currentActiveProjectId}/materials`).push(newMaterial);
        
        // Reset input UI entries cleanly
        document.getElementById('matDesc').value = '';
        document.getElementById('matSize').value = '';
        document.getElementById('matQty').value = '';
        document.getElementById('matUnit').value = '';
        document.getElementById('matCost').value = '';
        
    } catch (error) {
        console.error("Firebase upload sequence error:", error);
    }
}

// STREAM: Realtime Verification Database Pipeline Engine
function listenToMaterials() {
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

                // Budget deduction fires to financial summary cards if status is Paid or Delivered
                if (mat.status === 'paid' || mat.status === 'delivered') {
                    spent[mat.category] += mat.totalCost;
                }

                // Row highlighting rendering logic (Flashing warning indicator for hold entries)
                let rowBgClass = "border-b border-slate-800 hover:bg-slate-900/50 transition";
                if (mat.status === 'hold') {
                    rowBgClass = "bg-red-950/30 border-b border-red-900 text-red-200 animate-pulse";
                }

                // Internal verification template button utility
                const getStatusBtnClass = (currentStatus, targetStatus, activeColor) => {
                    return currentStatus === targetStatus 
                        ? `px-2 py-1 rounded font-bold text-[10px] ${activeColor} text-white shadow` 
                        : `px-2 py-1 rounded font-medium text-[10px] bg-slate-950 text-slate-500 hover:text-slate-300`;
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
                        <input type="text" value="${mat.remarks || ''}" placeholder="Add auditing log notes..." 
                            onchange="updateMatRemarks('${key}', this.value)"
                            class="bg-transparent hover:bg-slate-950 focus:bg-slate-950 border border-transparent focus:border-slate-800 text-xs text-slate-300 rounded p-1 w-full outline-none transition">
                    </td>
                    <td class="p-4 text-center">
                        <button onclick="deleteMaterial('${key}')" class="text-slate-500 hover:text-red-400 font-bold transition">✕</button>
                    </td>
                `;
                materialsTableBody.appendChild(tr);
            });
        }

        // Live refresh output trackers
        document.getElementById('matTotalLabel').innerText = `₱${overallTotalCost.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        
        // Matrix Budget calculation balances output compilation
        updateDashboardCard('balArch', initialBudgets.Architectural - spent.Architectural);
        updateDashboardCard('balPlumb', initialBudgets.Plumbing - spent.Plumbing);
        updateDashboardCard('balElec', initialBudgets.Electrical - spent.Electrical);
        updateDashboardCard('balCabinets', initialBudgets.Cabinets - spent.Cabinets);
    });
}

// WIDGET CONTROL: Live budget alert trigger values 
function updateDashboardCard(elementId, finalBalance) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    el.innerText = `₱${finalBalance.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    
    // If running balance drops below ₱20,000 threshold, trigger warning state layout
    if (finalBalance <= 20000) { 
        el.className = "text-base font-bold text-red-500 animate-pulse mt-1 block";
    } else {
        el.className = "text-base font-bold text-emerald-400 mt-1 block";
    }
}

// INLINE MUTATION: Fast status updater toggles
function updateMatStatus(key, newStatus) {
    if (!currentActiveProjectId) return;
    firebase.database().ref(`projects/${currentActiveProjectId}/materials/${key}`).update({ status: newStatus });
}

// INLINE MUTATION: Fast text remarks updater logs
function updateMatRemarks(key, newRemarks) {
    if (!currentActiveProjectId) return;
    firebase.database().ref(`projects/${currentActiveProjectId}/materials/${key}`).update({ remarks: newRemarks });
}

// DESTRUCTIVE ACTION: Remove row completely from targeted Firebase node
function deleteMaterial(key) {
    if (!currentActiveProjectId) return;
    if (confirm("Are you sure you want to permanently delete this material ledger item?")) {
        firebase.database().ref(`projects/${currentActiveProjectId}/materials/${key}`).remove();
    }
}