// ====== FIREBASE PROJECT SYSTEM CONFIGURATION CREDENTIALS ======
const firebaseConfig = {
  apiKey: "AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA",
  authDomain: "acpm-project-system.firebaseapp.com",
  databaseURL: "https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "acpm-project-system",
  storageBucket: "acpm-project-system.firebasestorage.app",
  messagingSenderId: "330800177544",
  appId: "1:330800177544:web:8f29dcd81ca39976849a3d"
};

// Initialize Cloud Firebase Connection Engine
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Global System Variables (Now synchronizing directly to cloud db)
let portfolio = {};
let activeProjectKey = null;
let currentEditingRecordId = null;
let activeModalWorkerId = null;

// ====== REALTIME CLOUD LISTENER (Awtomatikong kumukuha ng bago at real-time data) ======
db.ref("payroll_portfolio").on("value", (snapshot) => {
    const cloudData = snapshot.val();
    portfolio = cloudData ? cloudData : {};
    
    // I-update ang ui elements base sa pinakabagong data mula sa cloud
    document.getElementById("cloudStatusBadge").className = "bg-emerald-600 px-2 py-1 text-[11px] font-bold rounded-md text-white";
    document.getElementById("cloudStatusBadge").innerText = "☁️ Cloud Synced";
    
    if (!activeProjectKey) {
        buildGlobalHubDashboard();
    } else {
        updateBudgetSpeedometers();
        if (document.getElementById("innerTabTracker").classList.contains("hidden")) {
            buildProjectHistoryIndex();
        } else {
            renderScopeControls();
            renderRosterSection();
            renderAllGroupTables();
        }
    }
}, (error) => {
    console.error("Firebase Read Error: ", error);
    document.getElementById("cloudStatusBadge").className = "bg-red-600 px-2 py-1 text-[11px] font-bold rounded-md text-white";
    document.getElementById("cloudStatusBadge").innerText = "❌ Connection Failed";
});

// Cloud Sync Command
function syncPortfolioToCloud() {
    document.getElementById("cloudStatusBadge").className = "bg-amber-600 px-2 py-1 text-[11px] font-bold rounded-md text-white animate-pulse";
    document.getElementById("cloudStatusBadge").innerText = "⚡ Uploading...";
    db.ref("payroll_portfolio").set(portfolio);
}

function exportPortfolioDatabase() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(portfolio, null, 2));
    const dlAnchor = document.createElement('a');
    const date = new Date();
    const timestamp = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `acpm_cloud_backup_${timestamp}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
}

function applyGlobalHoursPreset(targetHours) {
    if(!activeProjectKey) return;
    const rows = document.querySelectorAll('.row-data-holder tr');
    rows.forEach(row => {
        ['mon','tue','wed','thu','fri','sat','sun'].forEach(day => {
            const input = row.querySelector(`.day-${day}`);
            if(input) input.value = targetHours;
        });
    });
}

function openCashAdvanceModal(workerId) {
    activeModalWorkerId = workerId;
    let proj = portfolio[activeProjectKey];
    let worker = proj.roster.find(w => w.id === workerId);
    if(!worker) return;

    if(!worker.cashAdvances) worker.cashAdvances = [];
    if(!worker.carriedBalance) worker.carriedBalance = 0;

    document.getElementById('modalWorkerName').innerText = `Cash Advance Tracker: ${worker.name}`;
    document.getElementById('modalWorkerSub').innerText = `Group: ${worker.group} • Rate: ₱${worker.rate}/day`;
    document.getElementById('vAmountInput').value = '';
    
    renderCashAdvanceModalList();
    document.getElementById('cashAdvanceModal').classList.remove('hidden');
}

function closeCashAdvanceModal() {
    document.getElementById('cashAdvanceModal').classList.add('hidden');
    activeModalWorkerId = null;
    renderAllGroupTables();
}

function saveCashAdvanceEntryToWorker() {
    let proj = portfolio[activeProjectKey];
    let worker = proj.roster.find(w => w.id === activeModalWorkerId);
    if(!worker) return;

    const day = document.getElementById('vDaySelect').value;
    const amt = parseFloat(document.getElementById('vAmountInput').value);

    if(!amt || amt <= 0) return alert("Please input a valid cash advance amount.");

    worker.cashAdvances.push({
        id: Date.now(),
        day: day,
        amount: amt
    });

    document.getElementById('vAmountInput').value = '';
    syncPortfolioToCloud();
    renderCashAdvanceModalList();
}

function removeCashAdvanceItem(advanceId) {
    let proj = portfolio[activeProjectKey];
    let worker = proj.roster.find(w => w.id === activeModalWorkerId);
    if(!worker) return;

    worker.cashAdvances = worker.cashAdvances.filter(v => v.id !== advanceId);
    syncPortfolioToCloud();
    renderCashAdvanceModalList();
}

function renderCashAdvanceModalList() {
    let proj = portfolio[activeProjectKey];
    let worker = proj.roster.find(w => w.id === activeModalWorkerId);
    const tbody = document.getElementById('cashAdvanceModalTableBody');
    
    let total = worker.carriedBalance || 0;
    let listHtml = '';

    if (worker.carriedBalance > 0) {
        listHtml += `
            <tr class="bg-amber-50">
                <td class="p-2 font-sans font-bold text-amber-800">Carried Debt</td>
                <td class="p-2 text-right font-bold text-amber-700">₱${worker.carriedBalance.toLocaleString()}</td>
                <td class="p-2 text-center text-xs text-slate-400 italic">From Past week</td>
            </tr>
        `;
    }

    if(worker.cashAdvances && worker.cashAdvances.length > 0) {
        listHtml += worker.cashAdvances.map(v => {
            total += v.amount;
            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-2 font-sans font-bold text-slate-700">${v.day}</td>
                    <td class="p-2 text-right font-bold text-red-600">₱${v.amount.toLocaleString()}</td>
                    <td class="p-2 text-center">
                        <button onclick="removeCashAdvanceItem(${v.id})" class="text-red-500 hover:underline font-bold cursor-pointer">Delete</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    if (listHtml === '') {
        tbody.innerHTML = `<tr><td colspan="3" class="p-3 text-center text-slate-400 italic">No cash advances recorded.</td></tr>`;
    } else {
        tbody.innerHTML = listHtml;
    }

    document.getElementById('modalCashAdvanceGrandTotal').innerText = `₱${total.toLocaleString('en-US', {minimumFractionDigits:2})}`;
}

function switchToGlobalHub() {
    activeProjectKey = null;
    currentEditingRecordId = null;
    document.getElementById('viewGlobalHub').classList.remove('hidden');
    document.getElementById('viewProjectWorkspace').classList.add('hidden');
    document.getElementById('navTrackerBtn').classList.add('hidden');
    document.getElementById('navHistoryBtn').classList.add('hidden');
    document.getElementById('editAlertBanner').classList.add('hidden');
    document.getElementById('navHubBtn').className = "px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 text-white cursor-pointer";
    document.getElementById('subHeaderContext').innerText = "Global Multi-Site Cloud Portal Hub";
    buildGlobalHubDashboard();
}

function openProjectWorkspace(projectKey) {
    activeProjectKey = projectKey;
    document.getElementById('activeWorkspaceBadge').innerText = projectKey;
    document.getElementById('subHeaderContext').innerText = `Managing Site: ${projectKey}`;
    document.getElementById('viewGlobalHub').classList.add('hidden');
    document.getElementById('viewProjectWorkspace').classList.remove('hidden');
    document.getElementById('navTrackerBtn').classList.remove('hidden');
    document.getElementById('navHistoryBtn').classList.remove('hidden');
    
    updateBudgetSpeedometers();
    setTodaysCalendarWidgets();
    switchToProjectView('tracker');
}

function updateBudgetSpeedometers() {
    let proj = portfolio[activeProjectKey];
    if(!proj) return;
    let budget = proj.laborBudget || 0;
    let spent = 0;
    if(proj.ledgerHistory) proj.ledgerHistory.forEach(h => spent += h.totalAmount);
    let margin = budget - spent;

    document.getElementById('barContractBudget').innerText = `₱${budget.toLocaleString('en-US', {minimumFractionDigits:2})}`;
    document.getElementById('barLaborSpent').innerText = `₱${spent.toLocaleString('en-US', {minimumFractionDigits:2})}`;
    document.getElementById('barRemainingBudget').innerText = `₱${margin.toLocaleString('en-US', {minimumFractionDigits:2})}`;
    
    const remainingBox = document.getElementById('barRemainingBudget').parentElement;
    if(margin < 0) {
        remainingBox.className = "p-2 bg-rose-100 border border-rose-300 rounded animate-pulse";
    } else {
        remainingBox.className = "p-2 bg-emerald-50 rounded";
    }
}

function buildGlobalHubDashboard() {
    const grid = document.getElementById('projectGridSummary');
    grid.innerHTML = '';
    const keys = Object.keys(portfolio);
    if(keys.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-8 text-slate-400 italic bg-white rounded-xl border border-dashed text-sm">No active project locations configured.</div>`;
        return;
    }

    keys.forEach(key => {
        const proj = portfolio[key];
        let grandSpent = 0;
        if(proj.ledgerHistory) proj.ledgerHistory.forEach(h => grandSpent += h.totalAmount);
        let budget = proj.laborBudget || 0;
        let pct = budget > 0 ? ((grandSpent / budget) * 100).toFixed(0) : 0;

        grid.innerHTML += `
            <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:border-blue-400 transition">
                <div class="space-y-2">
                    <div class="flex justify-between items-start">
                        <h4 class="text-base font-bold text-slate-900 tracking-tight">${key}</h4>
                        <button onclick="deleteEntireProjectSite('${key}')" class="text-[10px] text-slate-300 hover:text-red-500 font-bold cursor-pointer">Delete</button>
                    </div>
                    <div class="text-[11px] font-mono text-slate-400">Budget: ₱${budget.toLocaleString()}</div>
                    <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-1">
                        <div class="${pct > 100 ? 'bg-red-500' : 'bg-emerald-500'} h-full" style="width: ${Math.min(pct, 100)}%"></div>
                    </div>
                    <div class="flex justify-between text-[10px] text-slate-500 font-bold">
                        <span>Used: ${pct}%</span>
                        <span>Roster: ${proj.roster?.length || 0} Men</span>
                    </div>
                    <div class="bg-slate-50 p-2 rounded-lg text-xs mt-2">
                        <span class="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Accumulated Spent</span>
                        <span class="text-lg font-black text-emerald-600">₱${grandSpent.toLocaleString()}</span>
                    </div>
                </div>
                <button onclick="openProjectWorkspace('${key}')" class="mt-4 w-full bg-slate-800 hover:bg-blue-600 text-white font-bold text-xs py-2 rounded-lg text-center transition cursor-pointer">
                    Enter Site Workspace →
                </button>
            </div>
        `;
    });
}

function createNewProjectSite() {
    const nameInput = document.getElementById('newProjectNameInput');
    const budgetInput = document.getElementById('newProjectBudgetInput');
    const name = nameInput.value.trim();
    const budget = parseFloat(budgetInput.value) || 0;

    if(!name) return alert("Please supply a valid workspace site name.");
    if(portfolio[name]) return alert("This project name is already monitored.");

    portfolio[name] = { laborBudget: budget, scopes: [], roster: [], ledgerHistory: [] };
    nameInput.value = ''; budgetInput.value = '';
    syncPortfolioToCloud();
}

function deleteEntireProjectSite(key) {
    if(confirm(`Are you absolutely sure you want to permanently delete all data for ${key}?`)) {
        delete portfolio[key]; 
        syncPortfolioToCloud();
    }
}

function switchToProjectView(tab) {
    if(!activeProjectKey) return;
    const tBtn = document.getElementById('navTrackerBtn');
    const hBtn = document.getElementById('navHistoryBtn');
    document.getElementById('navHubBtn').className = "px-3 py-1.5 text-xs font-semibold rounded-md text-slate-400 hover:text-white cursor-pointer";

    if(tab === 'tracker') {
        document.getElementById('innerTabTracker').classList.remove('hidden');
        document.getElementById('innerTabHistory').classList.add('hidden');
        tBtn.className = "px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 text-white cursor-pointer";
        hBtn.className = "px-3 py-1.5 text-xs font-semibold rounded-md text-slate-400 hover:text-white cursor-pointer";
        renderScopeControls(); renderRosterSection(); renderAllGroupTables();
    } else {
        document.getElementById('innerTabTracker').classList.add('hidden');
        document.getElementById('innerTabHistory').classList.remove('hidden');
        tBtn.className = "px-3 py-1.5 text-xs font-semibold rounded-md text-slate-400 hover:text-white cursor-pointer";
        hBtn.className = "px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 text-white cursor-pointer";
        buildProjectHistoryIndex();
    }
}

function addNewScope() {
    const name = document.getElementById('newScopeInput').value.trim();
    const leader = document.getElementById('scopeLeaderInput').value.trim() || "Lead";
    const bank = document.getElementById('scopeBankInput').value.trim() || "Transfer";
    if(!name) return alert("Verify scope parameters.");
    let proj = portfolio[activeProjectKey];
    if(!proj.scopes) proj.scopes = [];
    if(proj.scopes.some(s => s.name.toLowerCase() === name.toLowerCase())) return alert("Scope exists.");
    proj.scopes.push({ name, leader, bank });
    document.getElementById('newScopeInput').value = ''; document.getElementById('scopeLeaderInput').value = ''; document.getElementById('scopeBankInput').value = '';
    syncPortfolioToCloud();
}

function removeScopeGroup(sName) {
    let proj = portfolio[activeProjectKey];
    if(proj.roster && proj.roster.some(w => w.group === sName)) return alert("Workers are currently deployed into this scope.");
    proj.scopes = proj.scopes.filter(s => s.name !== sName);
    syncPortfolioToCloud();
}

function renderScopeControls() {
    let proj = portfolio[activeProjectKey];
    if(!proj || !proj.scopes) return;
    document.getElementById('wGroupSelect').innerHTML = proj.scopes.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    document.getElementById('scopeChipsContainer').innerHTML = proj.scopes.map(s => `
        <div class="bg-slate-50 border border-slate-200 p-2 rounded-lg text-[10px] flex justify-between items-center">
            <div><strong>${s.name}</strong><span class="block text-slate-400">${s.leader} (${s.bank})</span></div>
            <button onclick="removeScopeGroup('${s.name}')" class="text-slate-400 hover:text-red-500 font-bold cursor-pointer">✕</button>
        </div>
    `).join('');
}

function addNewWorkerToRoster() {
    const name = document.getElementById('wName').value.trim();
    const rate = parseFloat(document.getElementById('wRate').value) || 0;
    const group = document.getElementById('wGroupSelect').value;
    if(!name || !group) return alert("Invalid Roster Settings.");
    if(!portfolio[activeProjectKey].roster) portfolio[activeProjectKey].roster = [];
    portfolio[activeProjectKey].roster.push({ id: Date.now(), name, rate, group, cashAdvances: [], carriedBalance: 0 });
    document.getElementById('wName').value = '';
    syncPortfolioToCloud();
}

function dropWorker(id) {
    portfolio[activeProjectKey].roster = portfolio[activeProjectKey].roster.filter(w => w.id !== id);
    syncPortfolioToCloud();
}

function renderRosterSection() {
    let proj = portfolio[activeProjectKey];
    if(!proj || !proj.roster) return;
    document.getElementById('rosterListContainer').innerHTML = proj.roster.map(w => `
        <div class="flex items-center justify-between bg-slate-50 p-2 border border-slate-200 rounded-lg text-xs">
            <div class="truncate"><strong>${w.name}</strong><span class="block text-[9px] text-slate-400 uppercase">${w.group} • ₱${w.rate}/d</span></div>
            <button onclick="dropWorker(${w.id})" class="text-slate-400 hover:text-red-500 font-bold cursor-pointer">✕</button>
        </div>
    `).join('');
}

function renderAllGroupTables() {
    const wrapper = document.getElementById('matrixTablesWrapper');
    wrapper.innerHTML = '';
    let proj = portfolio[activeProjectKey];
    if(!proj) return;
    if(!proj.scopes) proj.scopes = [];
    if(!proj.roster) proj.roster = [];

    proj.scopes.forEach(sc => {
        const groupWorkers = proj.roster.filter(w => w.group === sc.name);
        if (groupWorkers.length === 0) return;

        let tableHtml = `
            <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-3">
                <div class="bg-slate-800 text-white px-3 py-1.5 rounded-lg font-bold text-xs flex justify-between items-center">
                    <span class="uppercase">${sc.name} Matrix</span>
                    <span class="text-[10px] text-blue-300 font-mono bg-slate-700 px-2 py-0.5 rounded">${sc.leader} [${sc.bank}]</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr class="bg-slate-50 border-b border-slate-200 font-mono font-bold text-slate-500">
                                <th class="p-2 min-w-28 text-slate-700">Worker</th>
                                ${['M','T','W','Th','F','S','Su'].map(d => `<th class="p-1 text-center bg-blue-50/50">${d}</th>`).join('')}
                                <th class="p-2 text-center text-red-700">Total Advance / Deduct</th>
                                <th class="p-2 text-center text-blue-700">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 font-mono row-data-holder" data-group-scope="${sc.name}">
        `;

        tableHtml += groupWorkers.map(w => {
            let runningAdvanceSum = w.carriedBalance || 0;
            if(w.cashAdvances) w.cashAdvances.forEach(v => runningAdvanceSum += v.amount);

            return `
                <tr data-worker-id="${w.id}">
                    <td class="p-2 font-bold font-sans text-slate-700">
                        <div>${w.name}</div>
                        ${w.carriedBalance > 0 ? `<div class="text-[10px] text-amber-600 bg-amber-50 px-1 rounded inline-block font-bold">Debt: ₱${w.carriedBalance}</div>` : ''}
                        <button type="button" onclick="openCashAdvanceModal(${w.id})" class="text-[11px] text-blue-600 hover:text-blue-800 underline font-black block mt-1 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 cursor-pointer">
                            📝 Cash Advances (${w.cashAdvances ? w.cashAdvances.length : 0})
                        </button>
                    </td>
                    ${['mon','tue','wed','thu','fri','sat','sun'].map(day => `
                        <td class="p-0.5"><input type="number" class="day-${day} w-9 p-1 text-center border border-slate-200 rounded font-bold" value="8" min="0" max="24"></td>
                    `).join('')}
                    <td class="p-0.5 text-center">
                        <div class="flex flex-col items-center">
                            <input type="number" class="w-16 p-1 text-center text-red-600 border border-slate-200 rounded font-bold bg-red-50/50 deduction-box" value="${runningAdvanceSum}">
                            ${runningAdvanceSum > 0 ? `<span class="text-[9px] font-sans font-bold text-red-500 mt-0.5">Auto-Advance</span>` : ''}
                        </div>
                    </td>
                    <td class="p-2 text-center">
                        <button onclick="processSingleWorkerRfp(${w.id})" class="bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 font-bold text-[9px] px-1.5 py-1 rounded transition border border-slate-200 cursor-pointer">
                            RFP Alone
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        tableHtml += `</tbody></table></div></div>`;
        wrapper.innerHTML += tableHtml;
    });
}

function processSingleWorkerRfp(workerId) {
    let proj = portfolio[activeProjectKey];
    const worker = proj.roster.find(w => w.id === workerId);
    if(!worker) return;
    const row = document.querySelector(`.row-data-holder[data-group-scope="${worker.group}"] tr[data-worker-id="${worker.id}"]`);
    if(!row) return;

    const rfpDateStr = formatDateToFriendly(new Date());
    const scopeMeta = proj.scopes.find(s => s.name === worker.group) || { leader: "Lead", bank: "Routing" };
    let basePay = 0, otPay = 0; const baseHourly = worker.rate / 8;
    
    ['mon','tue','wed','thu','fri','sat','sun'].forEach(day => {
        const hours = parseFloat(row.querySelector(`.day-${day}`).value) || 0;
        if(hours > 8) { basePay += 8 * baseHourly; otPay += (hours - 8) * baseHourly; }
        else { basePay += hours * baseHourly; }
    });
    
    const grossEarnings = basePay + otPay;
    const deducts = parseFloat(row.querySelector('.deduction-box').value) || 0;
    
    let netAmount = grossEarnings - deducts;
    let displayDebtWarning = "";

    if (netAmount < 0) {
        let carryOverDebt = Math.abs(netAmount);
        netAmount = 0;
        displayDebtWarning = `\n(Warning: Deficit of ₱${carryOverDebt.toLocaleString()} will hold over)`;
    }

    let rfpText = `RFP ${rfpDateStr}\n${activeProjectKey}\nPayroll (${worker.group} - Late Add: ${worker.name})\n${scopeMeta.leader}\n${scopeMeta.bank}\n${netAmount.toLocaleString()}${displayDebtWarning}`;
    document.getElementById('outputHeading').innerText = `Isolated RFP Late Entry: ${worker.name}`;
    const wrap = document.getElementById('splitRFPsWrapper'); const txId = `tx_single_${Date.now()}`;
    wrap.innerHTML = `
        <div class="bg-amber-50 p-4 rounded-xl border border-amber-300 space-y-2 col-span-2">
            <div class="flex justify-between items-center"><span class="text-xs font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-200">${worker.name} Standalone</span><button onclick="copyText('${txId}')" class="text-xs font-bold text-blue-600 hover:underline">Copy</button></div>
            <textarea id="${txId}" readonly class="w-full h-32 p-2 font-mono text-xs bg-white border border-slate-200 rounded-lg resize-none">${rfpText}</textarea>
        </div>
    `;
    document.getElementById('outputContainer').classList.remove('hidden');
    document.getElementById('outputContainer').scrollIntoView({ behavior: 'smooth' });
}

function processWeeklyTimecard() {
    let proj = portfolio[activeProjectKey];
    const startVal = document.getElementById('metaCutoffStart').value;
    const endVal = document.getElementById('metaCutoffEnd').value;
    const cutoffText = (startVal && endVal) ? `${formatDateToFriendly(startVal)} to ${formatDateToFriendly(endVal)}` : "Active Block";
    const rfpDateStr = currentEditingRecordId ? proj.ledgerHistory.find(item => item.id === currentEditingRecordId).dateStr : formatDateToFriendly(new Date());
    
    let grandGlobalTotal = 0, dbGroupData = {}, attSnapshot = [];
    document.getElementById('outputHeading').innerText = "Generated RFP Documents";
    const wrap = document.getElementById('splitRFPsWrapper'); wrap.innerHTML = '';
    const activeTables = document.querySelectorAll('.row-data-holder');
    if(activeTables.length === 0) return alert("Nothing to process.");

    let balanceUpdatesToCommit = [];

    activeTables.forEach(tbody => {
        const sName = tbody.getAttribute('data-group-scope');
        const scopeMeta = proj.scopes.find(s => s.name === sName);
        let scopeSum = 0;

        tbody.querySelectorAll('tr').forEach(row => {
            const wId = parseInt(row.getAttribute('data-worker-id'));
            const worker = proj.roster.find(w => w.id === wId);
            if(!worker) return;

            let basePay = 0, otPay = 0, hourly = worker.rate / 8, rawHours = {};
            ['mon','tue','wed','thu','fri','sat','sun'].forEach(d => {
                let h = parseFloat(row.querySelector(`.day-${d}`).value) || 0;
                rawHours[d] = h;
                if(h > 8) { basePay += 8 * hourly; otPay += (h - 8) * hourly; }
                else { basePay += h * hourly; }
            });

            let grossEarnings = basePay + otPay;
            let ded = parseFloat(row.querySelector('.deduction-box').value) || 0;
            
            let netPay = grossEarnings - ded;
            let nextWeekDebt = 0;

            if (netPay < 0) {
                nextWeekDebt = Math.abs(netPay);
                netPay = 0;
            }

            scopeSum += netPay;
            attSnapshot.push({ workerId: wId, workerName: worker.name, groupScope: sName, hours: rawHours, deduction: ded });
            
            balanceUpdatesToCommit.push({ id: wId, carry: nextWeekDebt });
        });

        if(scopeSum < 0) scopeSum = 0;
        grandGlobalTotal += scopeSum; dbGroupData[sName] = scopeSum;

        let rfpText = `RFP ${rfpDateStr}\n${activeProjectKey}\nPayroll (${sName})\n${scopeMeta.leader}\n${scopeMeta.bank}\n${scopeSum.toLocaleString('en-US', {maximumFractionDigits:0})}`;
        let blockId = `tx_scope_${Date.now()}_${Math.floor(Math.random()*100)}`;
        wrap.innerHTML += `
            <div class="bg-white p-4 rounded-xl border border-slate-300 space-y-2">
                <div class="flex justify-between items-center"><span class="text-xs font-bold text-slate-700">${sName} Scope</span><button onclick="copyText('${blockId}')" class="text-xs text-blue-600 font-bold hover:underline">Copy</button></div>
                <textarea id="${blockId}" readonly class="w-full h-32 p-2 font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg resize-none">${rfpText}</textarea>
            </div>
        `;
    });

    if(currentEditingRecordId) {
        let idx = proj.ledgerHistory.findIndex(i => i.id === currentEditingRecordId);
        if(idx !== -1) {
            proj.ledgerHistory[idx].cutoff = cutoffText;
            proj.ledgerHistory[idx].totalAmount = grandGlobalTotal;
            proj.ledgerHistory[idx].groupData = dbGroupData;
            proj.ledgerHistory[idx].attendanceSnapshot = attSnapshot;
        }
        cancelActiveEditingMode();
    } else {
        if(!proj.ledgerHistory) proj.ledgerHistory = [];
        proj.ledgerHistory.unshift({
            id: Date.now(), dateStr: rfpDateStr, cutoff: cutoffText, totalAmount: grandGlobalTotal,
            groupData: dbGroupData, attendanceSnapshot: attSnapshot, dateCalendarStart: startVal, dateCalendarEnd: endVal
        });

        balanceUpdatesToCommit.forEach(update => {
            let targetWorker = proj.roster.find(w => w.id === update.id);
            if (targetWorker) {
                targetWorker.carriedBalance = update.carry;
                targetWorker.cashAdvances = [];
            }
        });
    }

    syncPortfolioToCloud();
    document.getElementById('outputContainer').classList.remove('hidden');
    document.getElementById('outputContainer').scrollIntoView({ behavior: 'smooth' });
}

function buildProjectHistoryIndex() {
    let proj = portfolio[activeProjectKey];
    const tbody = document.getElementById('historyTableBody');
    if(!proj || !proj.ledgerHistory) return;
    
    if(proj.ledgerHistory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400 italic">No saved payouts logged.</td></tr>`;
        return;
    }

    tbody.innerHTML = proj.ledgerHistory.map(item => {
        let pillBreakdown = Object.entries(item.groupData || {})
            .map(([name, val]) => `<span class="inline-block bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] mr-1 border border-slate-200"><strong>${name}:</strong> ₱${val.toLocaleString()}</span>`).join('');
        return `
            <tr class="hover:bg-slate-50">
                <td class="p-3 text-slate-500">${item.dateStr}</td>
                <td class="p-3 text-slate-600">${item.cutoff}</td>
                <td class="p-3">${pillBreakdown}</td>
                <td class="p-3 text-right font-bold text-emerald-600">₱${item.totalAmount.toLocaleString()}</td>
                <td class="p-3 text-center"><button onclick="loadRecordBacktrack(${item.id})" class="bg-amber-500 hover:bg-amber-600 text-white font-bold text-[10px] px-2 py-1 rounded cursor-pointer">Edit Sheet</button></td>
            </tr>
        `;
    }).join('');
}

function loadRecordBacktrack(id) {
    let proj = portfolio[activeProjectKey];
    let item = proj.ledgerHistory.find(i => i.id === id);
    if(!item) return;

    currentEditingRecordId = id;
    document.getElementById('editBannerDate').innerText = item.dateStr;
    document.getElementById('editAlertBanner').classList.remove('hidden');
    if(item.dateCalendarStart) document.getElementById('metaCutoffStart').value = item.dateCalendarStart;
    if(item.dateCalendarEnd) document.getElementById('metaCutoffEnd').value = item.dateCalendarEnd;

    switchToProjectView('tracker');
    item.attendanceSnapshot.forEach(snap => {
        const row = document.querySelector(`.row-data-holder[data-group-scope="${snap.groupScope}"] tr[data-worker-id="${snap.workerId}"]`);
        if(!row) return;
        ['mon','tue','wed','thu','fri','sat','sun'].forEach(d => {
            if(row.querySelector(`.day-${d}`)) row.querySelector(`.day-${d}`).value = snap.hours[d] ?? 8;
        });
        if(row.querySelector('.deduction-box')) row.querySelector('.deduction-box').value = snap.deduction || 0;
    });
}

function cancelActiveEditingMode() {
    currentEditingRecordId = null;
    document.getElementById('editAlertBanner').classList.add('hidden');
    setTodaysCalendarWidgets(); renderAllGroupTables();
}

function wipeActiveProjectLogs() {
    if(confirm("Wipe sheet logs for this project?")) {
        portfolio[activeProjectKey].ledgerHistory = []; 
        syncPortfolioToCloud();
    }
}

function setTodaysCalendarWidgets() {
    const today = new Date();
    const yyyy = today.getFullYear(), mm = String(today.getMonth() + 1).padStart(2, '0'), dd = String(today.getDate()).padStart(2, '0');
    if(!document.getElementById('metaCutoffStart').value) document.getElementById('metaCutoffStart').value = `${yyyy}-${mm}-${dd}`;
    if(!document.getElementById('metaCutoffEnd').value) document.getElementById('metaCutoffEnd').value = `${yyyy}-${mm}-${dd}`;
}

function formatDateToFriendly(dateString) {
    if(!dateString) return "--/--/----";
    const d = new Date(dateString);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function copyText(id) {
    const el = document.getElementById(id); el.select(); document.execCommand('copy');
}
function switchTab(tabName) {
    const laborPanel = document.getElementById('laborPanel');
    const materialsPanel = document.getElementById('materialsPanel');
    const tabLaborBtn = document.getElementById('tabLaborBtn');
    const tabMaterialsBtn = document.getElementById('tabMaterialsBtn');

    if (tabName === 'labor') {
        laborPanel.classList.remove('hidden');
        laborPanel.classList.add('block');
        materialsPanel.classList.remove('block');
        materialsPanel.classList.add('hidden');

        // Button colors
        tabLaborBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white transition";
        tabMaterialsBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition";
    } else {
        materialsPanel.classList.remove('hidden');
        materialsPanel.classList.add('block');
        laborPanel.classList.remove('block');
        laborPanel.classList.add('hidden');

        // Button colors
        tabMaterialsBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white transition";
        tabLaborBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition";
    }
    // TAB SWITCHING FUNCTION
function switchTab(tabName) {
    const laborPanel = document.getElementById('laborPanel');
    const materialsPanel = document.getElementById('materialsPanel');
    const tabLaborBtn = document.getElementById('tabLaborBtn');
    const tabMaterialsBtn = document.getElementById('tabMaterialsBtn');

    if (tabName === 'labor') {
        laborPanel.classList.remove('hidden');
        laborPanel.classList.add('block');
        materialsPanel.classList.remove('block');
        materialsPanel.classList.add('hidden');

        // Button colors
        tabLaborBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white transition";
        tabMaterialsBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition";
    } else {
        materialsPanel.classList.remove('hidden');
        materialsPanel.classList.add('block');
        laborPanel.classList.remove('block');
        laborPanel.classList.add('hidden');

        // Button colors
        tabMaterialsBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white transition";
        tabLaborBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition";
    }
}
}
// GLOBAL VARIABLE REFERENCE FOR THE ACTIVE SITE
let currentActiveProjectId = "Wolflink"; // Fallback identifier for testing

// INITIAL COST BUDGETS (From your Excel Category Matrix)
const initialBudgets = {
    Architectural: 822900,
    Plumbing: 117200,
    Electrical: 432840,
    Cabinets: 456575
};

// TAB NAVIGATION CONTROL
function switchTab(tabName) {
    const laborPanel = document.getElementById('laborPanel');
    const materialsPanel = document.getElementById('materialsPanel');
    const tabLaborBtn = document.getElementById('tabLaborBtn');
    const tabMaterialsBtn = document.getElementById('tabMaterialsBtn');

    if (tabName === 'labor') {
        laborPanel.classList.remove('hidden');
        laborPanel.classList.add('block');
        materialsPanel.classList.remove('block');
        materialsPanel.classList.add('hidden');

        tabLaborBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white transition";
        tabMaterialsBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition";
    } else {
        materialsPanel.classList.remove('hidden');
        materialsPanel.classList.add('block');
        laborPanel.classList.remove('block');
        laborPanel.classList.add('hidden');

        tabMaterialsBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white transition";
        tabLaborBtn.className = "px-4 py-2 text-sm font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition";
    }
}

// ACTION: ADD NEW PURCHASE ORDER ENTRY
async function addMaterialOrder() {
    const desc = document.getElementById('matDesc').value.trim();
    const size = document.getElementById('matSize').value.trim();
    const qty = parseFloat(document.getElementById('matQty').value) || 0;
    const unit = document.getElementById('matUnit').value.trim();
    const category = document.getElementById('matCat').value;
    const unitCost = parseFloat(document.getElementById('matCost').value) || 0;
    const totalCost = qty * unitCost;

    if (!desc || qty <= 0) {
        alert("Please input a valid Description and Quantity!");
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
        status: 'ordered', // Initial state inside lifecycle grid
        remarks: '',
        timestamp: Date.now()
    };

    try {
        await firebase.database().ref(`projects/${currentActiveProjectId}/materials`).push(newMaterial);
        
        // Clear inputs upon success
        document.getElementById('matDesc').value = '';
        document.getElementById('matSize').value = '';
        document.getElementById('matQty').value = '';
        document.getElementById('matUnit').value = '';
        document.getElementById('matCost').value = '';
        
        alert("Material Order successfully logged to Cloud!");
        listenToMaterials();
    } catch (error) {
        console.error("Database connection error:", error);
    }
}

// REALTIME LISTENER: RENDER RE-COMPUTED MATRIX AND TRACKING SHEET
function listenToMaterials() {
    firebase.database().ref(`projects/${currentActiveProjectId}/materials`).on('value', (snapshot) => {
        const materialsTableBody = document.getElementById('materialsTableBody');
        materialsTableBody.innerHTML = ''; 

        let overallTotalCost = 0;
        let spent = { Architectural: 0, Plumbing: 0, Electrical: 0, Cabinets: 0 };

        if (snapshot.exists()) {
            const data = snapshot.val();
            
            Object.keys(data).forEach((key) => {
                const mat = data[key];
                overallTotalCost += mat.totalCost;

                // Budget deduction fires if status is cleared or payment is released
                if (mat.status === 'paid' || mat.status === 'delivered') {
                    spent[mat.category] += mat.totalCost;
                }

                // Row highlighting logic (Red color variant for critical hold items)
                let rowBgClass = "border-b border-slate-700 hover:bg-slate-750 transition";
                if (mat.status === 'hold') {
                    rowBgClass = "bg-red-950/40 border-b border-red-900 text-red-200 animate-pulse";
                }

                // Badge generation logic for the check-check toggle controls
                const getStatusBtnClass = (currentStatus, targetStatus, activeColor) => {
                    return currentStatus === targetStatus 
                        ? `px-2 py-1 rounded font-bold text-[10px] ${activeColor} text-white shadow-md` 
                        : `px-2 py-1 rounded font-medium text-[10px] bg-slate-900 text-slate-500 hover:text-slate-300`;
                };

                const tr = document.createElement('tr');
                tr.className = rowBgClass;
                tr.innerHTML = `
                    <td class="p-3 font-medium text-white">${mat.description}</td>
                    <td class="p-3 text-slate-400">${mat.size || '-'}</td>
                    <td class="p-3 text-center font-semibold">${mat.qty} <span class="text-slate-500 font-normal">${mat.unit}</span></td>
                    <td class="p-3 text-right">₱${mat.unitCost.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                    <td class="p-3 text-right font-bold text-amber-400">₱${mat.totalCost.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                    <td class="p-3 text-center">
                        <div class="inline-flex space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-700">
                            <button onclick="updateMatStatus('${key}', 'ordered')" class="${getStatusBtnClass(mat.status, 'ordered', 'bg-blue-600')}">Ordered</button>
                            <button onclick="updateMatStatus('${key}', 'paid')" class="${getStatusBtnClass(mat.status, 'paid', 'bg-amber-500')}">Paid</button>
                            <button onclick="updateMatStatus('${key}', 'delivered')" class="${getStatusBtnClass(mat.status, 'delivered', 'bg-emerald-600')}">Delivered</button>
                            <button onclick="updateMatStatus('${key}', 'hold')" class="${getStatusBtnClass(mat.status, 'hold', 'bg-red-600')}">Hold</button>
                        </div>
                    </td>
                    <td class="p-3">
                        <input type="text" value="${mat.remarks || ''}" placeholder="Add remarks..." 
                            onchange="updateMatRemarks('${key}', this.value)"
                            class="bg-transparent hover:bg-slate-900 focus:bg-slate-900 border border-transparent focus:border-slate-600 text-xs text-slate-300 rounded p-1 w-full transition">
                    </td>
                    <td class="p-3 text-center">
                        <button onclick="deleteMaterial('${key}')" class="text-red-400 hover:text-red-500 font-bold transition">✕</button>
                    </td>
                `;
                materialsTableBody.appendChild(tr);
            });
        }

        document.getElementById('matTotalLabel').innerText = `₱${overallTotalCost.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        
        // Refresh live balances with structural deduction tracking
        updateDashboardCard('balArch', initialBudgets.Architectural - spent.Architectural);
        updateDashboardCard('balPlumb', initialBudgets.Plumbing - spent.Plumbing);
        updateDashboardCard('balElec', initialBudgets.Electrical - spent.Electrical);
        updateDashboardCard('balCabinets', initialBudgets.Cabinets - spent.Cabinets);
    });
}

// UPDATE FINANCIAL WIDGETS WITH AUTO CRITICAL BALANCE WARNING
function updateDashboardCard(elementId, finalBalance) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    el.innerText = `₱${finalBalance.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    
    // Changes balance color to warning state if category falls below ₱20,000
    if (finalBalance <= 20000) { 
        el.className = "text-lg font-bold text-red-500 animate-pulse";
    } else {
        el.className = "text-lg font-bold text-emerald-400";
    }
}

// INLINE CLOUD UPDATES FOR INTERACTIVE ACTIONS
function updateMatStatus(key, newStatus) {
    firebase.database().ref(`projects/${currentActiveProjectId}/materials/${key}`).update({ status: newStatus });
}

function updateMatRemarks(key, newRemarks) {
    firebase.database().ref(`projects/${currentActiveProjectId}/materials/${key}`).update({ remarks: newRemarks });
}

function deleteMaterial(key) {
    if (confirm("Are you sure you want to delete this material entry?")) {
        firebase.database().ref(`projects/${currentActiveProjectId}/materials/${key}`).remove();
    }
}

// Initialize on app load
listenToMaterials();
