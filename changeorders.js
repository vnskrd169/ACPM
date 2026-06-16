
# ============ changeorders.js (v8 — Complete rewrite) ============
co_v8 = r'''// ═══════════════════════════════════════════════════════════════
//  ACPM v8 — changeorders.js
//  · Proper listener lifecycle
//  · XSS-safe rendering
//  · Loading states
//  · CO export to CSV
//  · Better status tracking
// ═══════════════════════════════════════════════════════════════

let _copid = null;
let _coListeners = [];

function initChangeOrders(pid) {
  _copid = pid;
  detachCOListeners();
  watchChangeOrders(pid);
}

function detachCOListeners() {
  _coListeners.forEach(ref => ref.off());
  _coListeners = [];
}

function coListen(ref, cb) {
  ref.on('value', cb);
  _coListeners.push(ref);
}

// ══════════════════════════════════════════════════════
//  WATCH + RENDER
// ══════════════════════════════════════════════════════
function watchChangeOrders(pid) {
  const ref = firebase.database().ref(`projects/${pid}/changeOrders`);
  coListen(ref, snap => {
    const container = $('coList'); if (!container) return;
    container.innerHTML = '';

    if (!snap.exists()) {
      container.innerHTML = '<p class="empty-hint">No change orders yet. Create one above.</p>';
      renderCOSummary([], {});
      return;
    }

    const orders = [];
    snap.forEach(c => orders.push({ id: c.key, ...c.val() }));
    orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    let totalApproved = 0, totalPending = 0, totalLabor = 0, totalMaterials = 0;

    orders.forEach(co => {
      const laborImpact     = parseFloat(co.laborImpact)     || 0;
      const materialsImpact = parseFloat(co.materialsImpact) || 0;
      const totalImpact     = laborImpact + materialsImpact;

      if (co.status === 'approved') {
        totalApproved += totalImpact;
        totalLabor    += laborImpact;
        totalMaterials+= materialsImpact;
      }
      if (co.status === 'pending') totalPending += totalImpact;

      const statusMap = {
        pending : { cls:'co-pending',  label:'⏳ Pending',  actions: `
          <button class="co-approve-btn" onclick="approveRejectCO('${co.id}','approved')">✓ Approve</button>
          <button class="co-reject-btn"  onclick="approveRejectCO('${co.id}','rejected')">✕ Reject</button>` },
        approved: { cls:'co-approved', label:'✓ Approved', actions: `<button class="co-revert-btn" onclick="approveRejectCO('${co.id}','pending')">↩ Revert</button>` },
        rejected: { cls:'co-rejected', label:'✕ Rejected', actions: `<button class="co-revert-btn" onclick="approveRejectCO('${co.id}','pending')">↩ Revert</button>` }
      };
      const s = statusMap[co.status] || statusMap.pending;

      container.innerHTML += `<div class="co-card ${s.cls}" data-status="${co.status}">
        <div class="co-card-hdr">
          <div class="co-card-left">
            <span class="co-number">CO-${String(co.seq || '?').padStart(3, '0')}</span>
            <span class="co-status-badge ${s.cls}-badge">${s.label}</span>
          </div>
          <div class="co-card-right">
            <span class="co-total-impact">${totalImpact >= 0 ? '+' : ''}${peso(totalImpact)}</span>
            <button class="del-item-btn" onclick="deleteCO('${co.id}','${co.status}')">✕</button>
          </div>
        </div>
        <div class="co-body">
          <p class="co-desc">${escapeHtml(co.description || '—')}</p>
          <p class="co-meta">Requested by: <strong>${escapeHtml(co.requestedBy || '—')}</strong> · ${co.date || '—'}</p>
          ${co.notes ? `<p class="co-notes">${escapeHtml(co.notes)}</p>` : ''}
          <div class="co-impact-row">
            <div class="co-impact-item">
              <span class="co-impact-label">👷 Labor Impact</span>
              <span class="co-impact-val ${laborImpact >= 0 ? 'pos' : 'neg'}">${laborImpact >= 0 ? '+' : ''}${peso(laborImpact)}</span>
            </div>
            <div class="co-impact-item">
              <span class="co-impact-label">📦 Materials Impact</span>
              <span class="co-impact-val ${materialsImpact >= 0 ? 'pos' : 'neg'}">${materialsImpact >= 0 ? '+' : ''}${peso(materialsImpact)}</span>
            </div>
          </div>
        </div>
        <div class="co-actions">${s.actions}</div>
      </div>`;
    });

    renderCOSummary(orders, { totalApproved, totalPending, totalLabor, totalMaterials });
  });
}

function renderCOSummary(orders, totals) {
  setText('coTotalApproved',   peso(totals.totalApproved   || 0));
  setText('coTotalPending',    peso(totals.totalPending    || 0));
  setText('coLaborImpact',     peso(totals.totalLabor      || 0));
  setText('coMaterialsImpact', peso(totals.totalMaterials  || 0));
  setText('coCount',           `${orders.length} change order${orders.length !== 1 ? 's' : ''}`);
}

// ══════════════════════════════════════════════════════
//  ADD CHANGE ORDER
// ══════════════════════════════════════════════════════
async function addChangeOrder() {
  if (!_copid) return;
  const desc      = $('coDesc').value.trim();
  const reqBy     = $('coReqBy').value.trim();
  const date      = $('coDate').value;
  const labor     = parseFloat($('coLaborImpact').value)     || 0;
  const materials = parseFloat($('coMaterialsImpact').value) || 0;
  const notes     = $('coNotes').value.trim() || '';

  if (!desc)  { showToast('Enter change order description.', 'error'); return; }
  if (!reqBy) { showToast('Enter who requested this.', 'error'); return; }
  if (!date)  { showToast('Enter date.', 'error'); return; }
  if (labor === 0 && materials === 0) { showToast('Enter at least one cost impact.', 'error'); return; }
  if (desc.length > 300) { showToast('Description too long (max 300).', 'error'); return; }

  const snap = await firebase.database().ref(`projects/${_copid}/changeOrders`).once('value');
  const seq  = (snap.numChildren() || 0) + 1;

  await safeDb(() => firebase.database().ref(`projects/${_copid}/changeOrders`).push({
    seq, description: desc, requestedBy: reqBy, date,
    laborImpact: labor, materialsImpact: materials, notes,
    status: 'pending', createdAt: Date.now()
  }), 'Failed to submit change order');

  ['coDesc', 'coReqBy', 'coDate', 'coLaborImpact', 'coMaterialsImpact', 'coNotes'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });
  showToast(`CO-${String(seq).padStart(3, '0')} submitted`);
}

// ══════════════════════════════════════════════════════
//  APPROVE / REJECT
// ══════════════════════════════════════════════════════
async function approveRejectCO(key, newStatus) {
  if (!_copid) return;

  const [coSnap, projSnap] = await Promise.all([
    firebase.database().ref(`projects/${_copid}/changeOrders/${key}`).once('value'),
    firebase.database().ref(`projects/${_copid}`).once('value')
  ]);

  const co   = coSnap.val();
  const proj = projSnap.val() || {};
  const oldStatus = co.status;

  const laborImpact     = parseFloat(co.laborImpact)     || 0;
  const materialsImpact = parseFloat(co.materialsImpact) || 0;

  let laborBudget    = parseFloat(proj.laborBudget)    || 0;
  let materialBudget = parseFloat(proj.materialBudget) || 0;

  if (oldStatus === 'approved') {
    laborBudget    -= laborImpact;
    materialBudget -= materialsImpact;
  }

  if (newStatus === 'approved') {
    laborBudget    += laborImpact;
    materialBudget += materialsImpact;
  }

  await safeDb(() => firebase.database().ref(`projects/${_copid}/changeOrders/${key}`).update({
    status: newStatus,
    [`${newStatus}At`]: Date.now(),
    [`${newStatus}Date`]: new Date().toLocaleDateString('en-PH')
  }), 'Failed to update CO status');

  await safeDb(() => firebase.database().ref(`projects/${_copid}`).update({
    laborBudget, materialBudget
  }), 'Failed to update budget');

  const action = newStatus === 'approved' ? 'approved ✓' : newStatus === 'rejected' ? 'rejected ✕' : 'reverted to pending';
  showToast(`CO-${String(co.seq).padStart(3, '0')} ${action}`);
}

async function deleteCO(key, status) {
  if (!_copid) return;
  if (status === 'approved') {
    if (!confirm('⚠ This CO is APPROVED. Deleting it will NOT revert the budget change. Continue?')) return;
  } else {
    if (!confirm('Delete this change order?')) return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_copid}/changeOrders/${key}`).remove(), 'Failed to delete CO');
  showToast('Change order deleted', 'warn');
}

// Filter COs by status
function filterCOs(status) {
  document.querySelectorAll('#coList .co-card').forEach(card => {
    card.style.display = (status === 'all' || card.getAttribute('data-status') === status) ? '' : 'none';
  });
}

// Export COs to CSV
async function exportCOsCSV() {
  if (!_copid) return;
  const snap = await firebase.database().ref(`projects/${_copid}/changeOrders`).once('value');
  if (!snap.exists()) { showToast('No change orders to export.', 'warn'); return; }

  let csv = 'Seq,Date,Description,Requested By,Labor Impact,Materials Impact,Total Impact,Status,Notes\n';
  snap.forEach(c => {
    const co = c.val();
    const total = (parseFloat(co.laborImpact) || 0) + (parseFloat(co.materialsImpact) || 0);
    csv += `${co.seq || ''},${co.date || ''},${escapeCsv(co.description || '')},${escapeCsv(co.requestedBy || '')},${co.laborImpact || 0},${co.materialsImpact || 0},${total},${co.status || 'pending'},${escapeCsv(co.notes || '')}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ChangeOrders_${_copid}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Change orders exported!');
}

function escapeCsv(text) {
  if (!text) return '';
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}
'''

with open('/mnt/agents/output/changeorders.js', 'w') as f:
    f.write(co_v8)

print(f"✅ changeorders.js v8 — {len(co_v8)} bytes")
