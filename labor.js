// ============================================================
//  ACPM — labor.js  |  Labor & Payroll Module
//  Depends on: main.js (currentActiveProjectId, fmt, activeListeners)
// ============================================================

// ── Budget Stats ─────────────────────────────────────────────
function loadProjectScopeStats(projectId) {
    const ref = firebase.database().ref(`projects/${projectId}`);
    activeListeners.push(ref);

    ref.on('value', (snap) => {
        const data   = snap.val() || {};
        const budget = parseFloat(data.allottedLaborBudget) || 0;
        const spent  = parseFloat(data.totalLaborSpent)     || 0;
        const margin = budget - spent;

        const elBudget = document.getElementById('scopeLaborBudget');
        const elSpent  = document.getElementById('scopeLaborSpent');
        const elMargin = document.getElementById('scopeLaborMargin');

        if (elBudget) elBudget.textContent = fmt(budget);
        if (elSpent)  elSpent.textContent  = fmt(spent);
        if (elMargin) {
            elMargin.textContent  = fmt(margin);
            elMargin.className    = `text-base font-bold mt-1 block ${margin < 0 ? 'text-red-400' : 'text-emerald-400'}`;
        }

        // Also refresh scope dropdown whenever project data loads
        refreshScopeSelect();
        renderTimecardGrid(projectId);
    });
}

// ── Timecard Grid ────────────────────────────────────────────
function renderTimecardGrid(projectId) {
    // We need both scopes and workers
    Promise.all([
        firebase.database().ref(`projects/${projectId}/scopes`).once('value'),
        firebase.database().ref(`projects/${projectId}/workers`).once('value'),
        firebase.database().ref(`projects/${projectId}/timecards`).once('value')
    ]).then(([scopeSnap, workerSnap, tcSnap]) => {
        const container = document.getElementById('timecardGridContainer');
        if (!container) return;

        const scopes   = {};
        const workers  = [];
        const timecards = {};

        scopeSnap.forEach(c  => { scopes[c.key]    = c.val(); });
        workerSnap.forEach(c => { workers.push({ id: c.key, ...c.val() }); });
        tcSnap.forEach(c     => { timecards[c.key]  = c.val(); });

        if (Object.keys(scopes).length === 0) {
            container.innerHTML = '<p class="text-slate-500 text-xs text-center py-4">Wala pang scope. Mag-add muna sa "Scopes & Accounts."</p>';
            return;
        }
        if (workers.length === 0) {
            container.innerHTML = '<p class="text-slate-500 text-xs text-center py-4">Wala pang workers. Mag-deploy muna sa "Staff Roster."</p>';
            return;
        }

        container.innerHTML = '';

        // Group workers by scope
        const byScope = {};
        workers.forEach(w => {
            if (!byScope[w.scopeId]) byScope[w.scopeId] = [];
            byScope[w.scopeId].push(w);
        });

        // Get cutoff dates for column headers
        const cutoffStart = document.getElementById('cutoffStart')?.value || '';
        const cutoffEnd   = document.getElementById('cutoffEnd')?.value   || '';
        const days = buildDayColumns(cutoffStart, cutoffEnd);

        Object.keys(byScope).forEach(scopeId => {
            const scope       = scopes[scopeId] || { name: scopeId };
            const scopeWorkers = byScope[scopeId];

            const card = document.createElement('div');
            card.className = 'bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow';
            card.innerHTML = `
                <div class="px-4 py-3 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
                    <div>
                        <h4 class="text-xs font-black text-blue-400 uppercase tracking-wider">${scope.name}</h4>
                        <p class="text-[10px] text-slate-500">${scope.leader || ''} ${scope.bank ? '· ' + scope.bank : ''}</p>
                    </div>
                    <span id="scopeTotal_${scopeId}" class="text-sm font-black text-emerald-400">₱0.00</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr class="bg-slate-950 text-slate-400">
                                <th class="p-3 min-w-[140px]">WORKER</th>
                                <th class="p-3">RATE/DAY</th>
                                ${days.map(d => `<th class="p-2 text-center min-w-[60px]">${d.label}</th>`).join('')}
                                <th class="p-3 text-right">SUBTOTAL</th>
                            </tr>
                        </thead>
                        <tbody id="tcBody_${scopeId}"></tbody>
                    </table>
                </div>`;
            container.appendChild(card);

            // Fill rows
            let scopeTotal = 0;
            const tbody = card.querySelector(`#tcBody_${scopeId}`);

            scopeWorkers.forEach(worker => {
                const row = document.createElement('tr');
                row.className = 'border-t border-slate-800 hover:bg-slate-800/40 transition';

                let workerTotal = 0;
                const dayCells = days.map(day => {
                    const tcKey   = `${worker.id}_${day.key}`;
                    const present = timecards[tcKey]?.present || false;
                    if (present) workerTotal += worker.dailyRate;
                    return `<td class="p-2 text-center">
                        <input type="checkbox" 
                            class="w-4 h-4 accent-emerald-500 cursor-pointer"
                            ${present ? 'checked' : ''}
                            onchange="markAttendance('${worker.id}','${day.key}', this.checked, '${worker.dailyRate}', '${scopeId}')">
                    </td>`;
                }).join('');

                scopeTotal += workerTotal;

                row.innerHTML = `
                    <td class="p-3 font-semibold text-white">${worker.name}</td>
                    <td class="p-3 text-slate-400">${fmt(worker.dailyRate)}</td>
                    ${dayCells}
                    <td class="p-3 text-right font-bold text-amber-400" id="workerSub_${worker.id}">${fmt(workerTotal)}</td>`;
                tbody.appendChild(row);
            });

            const el = card.querySelector(`#scopeTotal_${scopeId}`);
            if (el) el.textContent = fmt(scopeTotal);
        });
    });
}

// ── Build Day Columns from Cutoff Range ──────────────────────
function buildDayColumns(startStr, endStr) {
    const cols = [];
    if (!startStr || !endStr) {
        // Default: show last 7 days
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            cols.push({
                key  : d.toISOString().slice(0, 10),
                label: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
            });
        }
        return cols;
    }
    const start = new Date(startStr);
    const end   = new Date(endStr);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        cols.push({
            key  : iso,
            label: new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
        });
    }
    return cols;
}

// ── Mark Attendance ──────────────────────────────────────────
async function markAttendance(workerId, dayKey, isPresent, dailyRate, scopeId) {
    if (!currentActiveProjectId) return;
    const tcKey = `${workerId}_${dayKey}`;
    await firebase.database()
        .ref(`projects/${currentActiveProjectId}/timecards/${tcKey}`)
        .set({ workerId, dayKey, present: isPresent, dailyRate: parseFloat(dailyRate), scopeId });

    // Recompute worker subtotal live
    recomputeWorkerSubtotal(workerId);
}

function recomputeWorkerSubtotal(workerId) {
    if (!currentActiveProjectId) return;
    firebase.database()
        .ref(`projects/${currentActiveProjectId}/timecards`)
        .orderByChild('workerId').equalTo(workerId)
        .once('value', (snap) => {
            let total = 0;
            snap.forEach(c => {
                const tc = c.val();
                if (tc.present) total += parseFloat(tc.dailyRate) || 0;
            });
            const el = document.getElementById(`workerSub_${workerId}`);
            if (el) el.textContent = fmt(total);
        });
}

// ── Apply Cutoff Filter ──────────────────────────────────────
function applyCutoffFilter() {
    if (currentActiveProjectId) renderTimecardGrid(currentActiveProjectId);
}

// ── Compile Payroll ──────────────────────────────────────────
async function compileTimecardPayouts() {
    if (!currentActiveProjectId) return;

    const cutoffStart = document.getElementById('cutoffStart')?.value || '—';
    const cutoffEnd   = document.getElementById('cutoffEnd')?.value   || '—';

    // Sum all present timecards
    const snap = await firebase.database()
        .ref(`projects/${currentActiveProjectId}/timecards`).once('value');

    let totalAmount = 0;
    snap.forEach(c => {
        const tc = c.val();
        if (tc.present) totalAmount += parseFloat(tc.dailyRate) || 0;
    });

    if (totalAmount === 0) {
        alert('Walang namarkahan na attendance. Wala pang mako-compile.');
        return;
    }

    const confirmed = confirm(
        `Payroll Summary\nPeriod: ${cutoffStart} → ${cutoffEnd}\nTotal: ${fmt(totalAmount)}\n\nI-save sa Payroll History?`
    );
    if (!confirmed) return;

    await firebase.database()
        .ref(`projects/${currentActiveProjectId}/payrollHistory`).push({
            date       : new Date().toLocaleDateString('en-PH'),
            period     : `${cutoffStart} – ${cutoffEnd}`,
            amount     : totalAmount,
            compiledAt : Date.now()
        });

    // Update aggregate
    const projSnap = await firebase.database().ref(`projects/${currentActiveProjectId}`).once('value');
    const prevSpent = parseFloat(projSnap.val()?.totalLaborSpent) || 0;
    await firebase.database().ref(`projects/${currentActiveProjectId}`).update({
        totalLaborSpent: prevSpent + totalAmount
    });

    alert(`✅ Payroll ng ${fmt(totalAmount)} na-save sa history!`);
}

// ── Payroll History Listener ──────────────────────────────────
function listenToLaborRecords(projectId) {
    const ref = firebase.database().ref(`projects/${projectId}/payrollHistory`);
    activeListeners.push(ref);

    ref.on('value', (snap) => {
        const tbody = document.getElementById('historyTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!snap.exists()) {
            tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-slate-500 text-xs">Walang history pa.</td></tr>';
            return;
        }

        snap.forEach(child => {
            const e = child.val();
            tbody.innerHTML += `
                <tr class="border-t border-slate-800 text-xs hover:bg-slate-800/40">
                    <td class="p-3 text-slate-300">${e.date}</td>
                    <td class="p-3 text-slate-400">${e.period || '—'}</td>
                    <td class="p-3 text-right font-bold text-amber-400">${fmt(e.amount)}</td>
                </tr>`;
        });
    });
}
