// ============================================================
//  ACPM — materials.js  |  Materials & Procurement Module
//  Depends on: main.js (currentActiveProjectId, fmt, activeListeners)
// ============================================================

// ── Category Balance Budgets (static; adjust as needed) ──────
const MAT_CATEGORY_BUDGETS = {
    'Architectural': 822900,
    'Plumbing'     : 117200,
    'Electrical'   : 432840,
    'Cabinets'     : 456575
};

const CATEGORY_BALANCE_IDS = {
    'Architectural': 'balArch',
    'Plumbing'     : 'balPlumb',
    'Electrical'   : 'balElec',
    'Cabinets'     : 'balCabinets'
};

// ── Add Material Order ────────────────────────────────────────
async function addMaterialOrder() {
    if (!currentActiveProjectId) { alert('Walang active project!'); return; }

    const desc     = document.getElementById('matDesc').value.trim();
    const size     = document.getElementById('matSize').value.trim();
    const qty      = parseFloat(document.getElementById('matQty').value)  || 0;
    const unit     = document.getElementById('matUnit').value.trim();
    const cat      = document.getElementById('matCat').value;
    const unitCost = parseFloat(document.getElementById('matCost').value) || 0;

    if (!desc)   { alert('Pakisulat ang Description!'); return; }
    if (qty <= 0) { alert('Pakilagay ng valid na Quantity!'); return; }

    const newMaterial = {
        description : desc,
        size        : size,
        qty         : qty,
        unit        : unit,
        category    : cat,
        unitCost    : unitCost,
        totalCost   : qty * unitCost,
        status      : 'ordered',
        remarks     : '',
        timestamp   : Date.now()
    };

    await firebase.database()
        .ref(`projects/${currentActiveProjectId}/materials`).push(newMaterial);

    // Clear inputs
    ['matDesc','matSize','matQty','matUnit','matCost'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

// ── Update Material Status ────────────────────────────────────
function updateMatStatus(key, newStatus) {
    if (!currentActiveProjectId) return;
    firebase.database()
        .ref(`projects/${currentActiveProjectId}/materials/${key}`)
        .update({ status: newStatus });
}

// ── Update Material Remarks ───────────────────────────────────
function updateMatRemarks(key, value) {
    if (!currentActiveProjectId) return;
    firebase.database()
        .ref(`projects/${currentActiveProjectId}/materials/${key}`)
        .update({ remarks: value });
}

// ── Delete Material ───────────────────────────────────────────
function deleteMaterial(key, description) {
    if (!currentActiveProjectId) return;
    if (!confirm(`Delete "${description}"?`)) return;
    firebase.database()
        .ref(`projects/${currentActiveProjectId}/materials/${key}`)
        .remove();
}

// ── Listen to Materials (Real-time) ──────────────────────────
function listenToMaterials() {
    if (!currentActiveProjectId) return;

    const ref = firebase.database().ref(`projects/${currentActiveProjectId}/materials`);
    activeListeners.push(ref);

    ref.on('value', (snap) => {
        const tbody = document.getElementById('materialsTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        // Reset per-category spending
        const catSpent = { Architectural: 0, Plumbing: 0, Electrical: 0, Cabinets: 0 };
        let globalSpent = 0;

        if (!snap.exists()) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-500 text-xs">Walang materials pa. Mag-add sa form sa itaas.</td></tr>`;
            updateCategoryBalances(catSpent, 0);
            return;
        }

        snap.forEach(child => {
            const key = child.key;
            const m   = child.val();

            const total    = parseFloat(m.totalCost) || 0;
            const isPaid   = m.status === 'paid';
            const isDelivered = m.status === 'delivered';

            if (isPaid || isDelivered) {
                if (catSpent[m.category] !== undefined) catSpent[m.category] += total;
                globalSpent += total;
            }

            const statusColors = {
                'ordered'   : 'bg-blue-950 text-blue-400 border-blue-900/50',
                'delivered' : 'bg-amber-950 text-amber-400 border-amber-900/50',
                'paid'      : 'bg-emerald-950 text-emerald-400 border-emerald-900/50',
                'cancelled' : 'bg-red-950 text-red-400 border-red-900/50'
            };
            const statusClass = statusColors[m.status] || statusColors['ordered'];

            tbody.innerHTML += `
                <tr class="border-t border-slate-800 hover:bg-slate-800/30 transition text-xs ${m.status === 'cancelled' ? 'opacity-50' : ''}">
                    <td class="p-3 font-medium text-white">${m.description || '—'}</td>
                    <td class="p-3 text-slate-400">${m.size || '—'}</td>
                    <td class="p-3 text-center text-slate-300">${m.qty || 0} ${m.unit || ''}</td>
                    <td class="p-3 text-right text-slate-300">${fmt(m.unitCost)}</td>
                    <td class="p-3 text-right font-bold text-amber-400">${fmt(total)}</td>
                    <td class="p-3 text-center">
                        <select onchange="updateMatStatus('${key}', this.value)"
                            class="bg-slate-950 border border-slate-800 text-xs rounded-lg px-2 py-1 outline-none ${statusClass}">
                            <option value="ordered"   ${m.status === 'ordered'    ? 'selected' : ''}>Ordered</option>
                            <option value="delivered" ${m.status === 'delivered'  ? 'selected' : ''}>Delivered</option>
                            <option value="paid"      ${m.status === 'paid'       ? 'selected' : ''}>Paid</option>
                            <option value="cancelled" ${m.status === 'cancelled'  ? 'selected' : ''}>Cancelled</option>
                        </select>
                    </td>
                    <td class="p-3">
                        <input type="text" value="${m.remarks || ''}" placeholder="Remarks..."
                            onblur="updateMatRemarks('${key}', this.value)"
                            class="w-full bg-transparent border-b border-slate-700 text-slate-400 text-xs outline-none focus:border-blue-500 py-0.5 transition">
                    </td>
                    <td class="p-3 text-center">
                        <button onclick="deleteMaterial('${key}', '${(m.description || '').replace(/'/g,"\\'")}' )"
                            class="text-red-500 hover:text-red-300 font-bold text-xs px-2 py-1 rounded transition">
                            ✕
                        </button>
                    </td>
                </tr>`;
        });

        updateCategoryBalances(catSpent, globalSpent);

        // Update project aggregate
        firebase.database()
            .ref(`projects/${currentActiveProjectId}`)
            .update({ totalMaterialSpent: globalSpent });
    });
}

// ── Update Balance Cards ──────────────────────────────────────
function updateCategoryBalances(catSpent, globalSpent) {
    Object.keys(CATEGORY_BALANCE_IDS).forEach(cat => {
        const elId    = CATEGORY_BALANCE_IDS[cat];
        const el      = document.getElementById(elId);
        if (!el) return;
        const budget  = MAT_CATEGORY_BUDGETS[cat] || 0;
        const spent   = catSpent[cat] || 0;
        const balance = budget - spent;
        el.textContent = fmt(balance);
        el.className   = `text-base font-bold mt-1 block ${balance < 0 ? 'text-red-400' : 'text-emerald-400'}`;
    });

    const totalLabel = document.getElementById('matTotalLabel');
    if (totalLabel) totalLabel.textContent = fmt(globalSpent);
}
