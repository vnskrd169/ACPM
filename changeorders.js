// ═══════════════════════════════════════════════════════════════
//  ACPM v5 — changeorders.js
//  Change Orders: auto-numbered · cost impact · approve/reject
//  Approved COs automatically update project budget
// ═══════════════════════════════════════════════════════════════

let _copid = null;

function initChangeOrders(pid) {
  _copid = pid;
  watchChangeOrders(pid);
}

// ══════════════════════════════════════════════════════
//  WATCH + RENDER
// ══════════════════════════════════════════════════════
function watchChangeOrders(pid) {
  listen(firebase.database().ref(`projects/${pid}/changeOrders`), snap => {
    const container = $('coList'); if (!container) return;
    container.innerHTML = '';

    if (!snap.exists()) {
      container.innerHTML = '<p class="empty-hint">No change orders yet. Create one above.</p>';
      renderCOSummary([], {});
      return;
    }

    const orders = [];
    snap.forEach(c => orders.push({ id: c.key, ...c.val() }));
    orders.reverse();

    // Summary totals
    let totalApproved = 0, totalPending = 0, totalLabor = 0, totalMaterials = 0;

    orders.forEach(co => {
      const laborImpact    = parseFloat(co.laborImpact)    || 0;
      const materialsImpact= parseFloat(co.materialsImpact)|| 0;
      const totalImpact    = laborImpact + materialsImpact;

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

      container.innerHTML += `
        <div class="co-card ${s.cls}">
          <div class="co-card-hdr">
            <div class="co-card-left">
              <span class="co-number">CO-${String(co.seq||'?').padStart(3,'0')}</span>
              <span class="co-status-badge ${s.cls}-badge">${s.label}</span>
            </div>
            <div class="co-card-right">
              <span class="co-total-impact">${totalImpact >= 0 ? '+' : ''}${peso(totalImpact)}</span>
              <button class="del-item-btn" onclick="deleteCO('${co.id}','${co.status}')">✕</button>
            </div>
          </div>
          <div class="co-body">
            <p class="co-desc">${co.description || '—'}</p>
            <p class="co-meta">Requested by: <strong>${co.requestedBy || '—'}</strong> · ${co.date || '—'}</p>
            ${co.notes ? `<p class="co-notes">${co.notes}</p>` : ''}
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
  const labor     = parseFloat($('coLaborImpact').value)    || 0;
  const materials = parseFloat($('coMaterialsImpact').value)|| 0;
  const notes     = $('coNotes').value.trim() || '';

  if (!desc)  { alert('Enter change order description.'); return; }
  if (!reqBy) { alert('Enter who requested this.'); return; }
  if (!date)  { alert('Enter date.'); return; }
  if (labor === 0 && materials === 0) { alert('Enter at least one cost impact (labor or materials).'); return; }

  const snap = await firebase.database().ref(`projects/${_copid}/changeOrders`).once('value');
  const seq  = (snap.numChildren() || 0) + 1;

  await firebase.database().ref(`projects/${_copid}/changeOrders`).push({
    seq, description: desc, requestedBy: reqBy, date,
    laborImpact: labor, materialsImpact: materials, notes,
    status: 'pending', createdAt: Date.now()
  });

  ['coDesc','coReqBy','coDate','coLaborImpact','coMaterialsImpact','coNotes'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });
}

// ══════════════════════════════════════════════════════
//  APPROVE / REJECT — auto-updates project budget
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

  const laborImpact     = parseFloat(co.laborImpact)    || 0;
  const materialsImpact = parseFloat(co.materialsImpact)|| 0;

  let laborBudget    = parseFloat(proj.laborBudget)    || 0;
  let materialBudget = parseFloat(proj.materialBudget) || 0;

  // Revert previous budget change if was approved
  if (oldStatus === 'approved') {
    laborBudget    -= laborImpact;
    materialBudget -= materialsImpact;
  }

  // Apply new budget change if now approving
  if (newStatus === 'approved') {
    laborBudget    += laborImpact;
    materialBudget += materialsImpact;
  }

  await firebase.database().ref(`projects/${_copid}/changeOrders/${key}`).update({
    status: newStatus,
    [`${newStatus}At`]: Date.now(),
    [`${newStatus}Date`]: new Date().toLocaleDateString('en-PH')
  });

  await firebase.database().ref(`projects/${_copid}`).update({
    laborBudget, materialBudget
  });

  const action = newStatus === 'approved' ? 'approved ✓' : newStatus === 'rejected' ? 'rejected ✕' : 'reverted to pending';
  alert(`CO-${String(co.seq).padStart(3,'0')} ${action}${newStatus === 'approved' ? `\n\nBudget updated:\nLabor: +${peso(laborImpact)}\nMaterials: +${peso(materialsImpact)}` : ''}`);
}

async function deleteCO(key, status) {
  if (!_copid) return;
  if (status === 'approved') {
    if (!confirm('⚠ This CO is APPROVED. Deleting it will NOT revert the budget change. Continue?')) return;
  } else {
    if (!confirm('Delete this change order?')) return;
  }
  await firebase.database().ref(`projects/${_copid}/changeOrders/${key}`).remove();
}