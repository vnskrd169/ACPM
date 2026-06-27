let _copid = null;
let _coListeners = [];

function canTouchChangeOrdersProject() {
  return typeof requireEdit === 'function'
    ? requireEdit(_copid)
    : !!_copid && typeof canEditProject === 'function' && canEditProject(_copid);
}

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
    snap.forEach(c => {
      orders.push({ id: c.key, ...c.val() });
    });
    orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    let totalApproved = 0, totalPending = 0, totalLabor = 0, totalMaterials = 0;
    const fragment = document.createDocumentFragment();

    orders.forEach(co => {
      const laborImpact = parseFloat(co.laborImpact) || 0;
      const materialsImpact = parseFloat(co.materialsImpact) || 0;
      const totalImpact = laborImpact + materialsImpact;

      if (co.status === 'approved') {
        totalApproved += totalImpact;
        totalLabor += laborImpact;
        totalMaterials += materialsImpact;
      }
      if (co.status === 'pending') totalPending += totalImpact;

      const statusMap = {
        pending: { cls: 'co-pending', label: '\u23F3 Pending', actions: `
          <button class="co-approve-btn" aria-label="Approve CO" onclick="approveRejectCO('${co.id}','approved')">\u2713 Approve</button>
          <button class="co-reject-btn" aria-label="Reject CO" onclick="approveRejectCO('${co.id}','rejected')">\u2715 Reject</button>` },
        approved: { cls: 'co-approved', label: '\u2713 Approved', actions: `<button class="co-revert-btn" aria-label="Revert CO" onclick="approveRejectCO('${co.id}','pending')">\u21A9 Revert</button>` },
        rejected: { cls: 'co-rejected', label: '\u2715 Rejected', actions: `<button class="co-revert-btn" aria-label="Revert CO" onclick="approveRejectCO('${co.id}','pending')">\u21A9 Revert</button>` }
      };
      const s = statusMap[co.status] || statusMap.pending;

      const card = document.createElement('div');
      card.className = `co-card ${s.cls}`;
      card.setAttribute('data-status', co.status);
      card.innerHTML = `
        <div class="co-card-hdr">
          <div class="co-card-left">
            <span class="co-number">CO-${String(co.seq || '?').padStart(3, '0')}</span>
            <span class="co-status-badge ${s.cls}-badge">${s.label}</span>
          </div>
          <div class="co-card-right">
            <span class="co-total-impact">${totalImpact >= 0 ? '+' : ''}${peso(totalImpact)}</span>
            <button class="del-item-btn" aria-label="Delete CO" onclick="deleteCO('${co.id}','${co.status}')">\u2715</button>
          </div>
        </div>
        <div class="co-body">
          <p class="co-desc">${escapeHtml(co.description || '\u2014')}</p>
          <p class="co-meta">Requested by: <strong>${escapeHtml(co.requestedBy || '\u2014')}</strong> \u00B7 ${co.date || '\u2014'}</p>
          ${co.notes ? `<p class="co-notes">${escapeHtml(co.notes)}</p>` : ''}
          <div class="co-impact-row">
            <div class="co-impact-item">
              <span class="co-impact-label">\u1F477 Labor Impact</span>
              <span class="co-impact-val ${laborImpact >= 0 ? 'pos' : 'neg'}">${laborImpact >= 0 ? '+' : ''}${peso(laborImpact)}</span>
            </div>
            <div class="co-impact-item">
              <span class="co-impact-label">\u1F4E6 Materials Impact</span>
              <span class="co-impact-val ${materialsImpact >= 0 ? 'pos' : 'neg'}">${materialsImpact >= 0 ? '+' : ''}${peso(materialsImpact)}</span>
            </div>
          </div>
        </div>
        <div class="co-actions">${s.actions}</div>
      `;
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
    renderCOSummary(orders, { totalApproved, totalPending, totalLabor, totalMaterials });
  });
}

function renderCOSummary(orders, totals) {
  setText('coTotalApproved', peso(totals.totalApproved || 0));
  setText('coTotalPending', peso(totals.totalPending || 0));
  setText('coLaborImpactKpi', peso(totals.totalLabor || 0));
  setText('coMaterialsImpactKpi', peso(totals.totalMaterials || 0));
  setText('coCount', `${orders.length} change order${orders.length !== 1 ? 's' : ''}`);
}

// ══════════════════════════════════════════════════════
//  ADD CHANGE ORDER
// ══════════════════════════════════════════════════════
async function addChangeOrder() {
  if (!_copid) return;
  if (!canTouchChangeOrdersProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const desc = $('coDesc').value.trim();
  const reqBy = $('coReqBy').value.trim();
  const date = $('coDate').value;
  const labor = parseFloat($('coLaborImpact').value) || 0;
  const materials = parseFloat($('coMaterialsImpact').value) || 0;
  const notes = $('coNotes').value.trim() || '';

  if (!desc) { showToast('Enter change order description.', 'error'); return; }
  if (!reqBy) { showToast('Enter who requested this.', 'error'); return; }
  if (!date) { showToast('Enter date.', 'error'); return; }
  if (labor === 0 && materials === 0) { showToast('Enter at least one cost impact.', 'error'); return; }
  if (desc.length > 300) { showToast('Description too long (max 300).', 'error'); return; }

  // Validate date is not in the future
  const inputDate = new Date(date + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (inputDate > today) { showToast('Date cannot be in the future.', 'error'); return; }

  const counterRef = firebase.database().ref(`projects/${_copid}/coCounter`);
  let seq;
  try {
    const result = await counterRef.transaction(current => (current || 0) + 1);
    seq = result.snapshot.val();
  } catch (e) {
    showToast('Failed to generate CO number. Try again.', 'error');
    return;
  }

  await safeDb(() => firebase.database().ref(`projects/${_copid}/changeOrders`).push({
    seq, description: desc, requestedBy: reqBy, date,
    laborImpact: labor, materialsImpact: materials, notes,
    status: 'pending', createdAt: Date.now(), createdBy: window._currentUser.uid
  }), 'Failed to submit change order');

  ['coDesc', 'coReqBy', 'coDate', 'coLaborImpact', 'coMaterialsImpact', 'coNotes'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });
  auditLog('create', 'changeOrder', null, { seq, labor, materials, projectId: _copid });
  showToast(`CO-${String(seq).padStart(3, '0')} submitted`);
}

// ══════════════════════════════════════════════════════
//  APPROVE / REJECT — Updates laborBudgetDelta & materialBudgetDelta
//  NEVER touches the immutable baseline laborBudget / materialBudget
// ══════════════════════════════════════════════════════
async function approveRejectCO(key, newStatus) {
  if (!_copid) return;
  if (!canTouchChangeOrdersProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }

  const [coSnap, projSnap] = await Promise.all([
    firebase.database().ref(`projects/${_copid}/changeOrders/${key}`).once('value'),
    firebase.database().ref(`projects/${_copid}`).once('value')
  ]);

  const co = coSnap.val();
  const proj = projSnap.val() || {};
  const oldStatus = co.status;

  const laborImpact = parseFloat(co.laborImpact) || 0;
  const materialsImpact = parseFloat(co.materialsImpact) || 0;

  // Use Delta fields — baseline budgets remain immutable
  let laborDelta = parseFloat(proj.laborBudgetDelta) || 0;
  let materialDelta = parseFloat(proj.materialBudgetDelta) || 0;

  // Revert previous approved impact if it was approved
  if (oldStatus === 'approved') {
    laborDelta -= laborImpact;
    materialDelta -= materialsImpact;
  }

  // Apply new approved impact
  if (newStatus === 'approved') {
    laborDelta += laborImpact;
    materialDelta += materialsImpact;
  }

  const updates = {};
  updates[`projects/${_copid}/changeOrders/${key}/status`] = newStatus;
  updates[`projects/${_copid}/changeOrders/${key}/${newStatus}At`] = Date.now();
  updates[`projects/${_copid}/changeOrders/${key}/${newStatus}By`] = window._currentUser.uid;
  updates[`projects/${_copid}/changeOrders/${key}/${newStatus}Date`] = new Date().toLocaleDateString('en-PH');
  updates[`projects/${_copid}/laborBudgetDelta`] = laborDelta;
  updates[`projects/${_copid}/materialBudgetDelta`] = materialDelta;

  await safeDb(() => firebase.database().ref().update(updates), 'Failed to update CO status');
  if (typeof rebuildBillingRollups === 'function') {
    await rebuildBillingRollups(_copid);
  }
  auditLog('update', 'changeOrder', key, { oldStatus, newStatus, projectId: _copid });

  const action = newStatus === 'approved' ? 'approved \u2713' : newStatus === 'rejected' ? 'rejected \u2715' : 'reverted to pending';
  showToast(`CO-${String(co.seq).padStart(3, '0')} ${action}`);
}

async function deleteCO(key, status) {
  if (!_copid) return;
  if (!canTouchChangeOrdersProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (status === 'approved') {
    if (!confirm('\u26A0\uFE0F This CO is APPROVED. Deleting it will NOT revert the budget change.\n\nTo revert the budget, first revert the CO to pending, then delete it.\n\nContinue anyway?')) return;
  } else {
    if (!confirm('Delete this change order?')) return;
  }
  const confirmText = prompt('Type DELETE CO to confirm permanent deletion:');
  if (confirmText !== 'DELETE CO') {
    showToast('Deletion cancelled.', 'warn');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_copid}/changeOrders/${key}`).remove(), 'Failed to delete CO');
  if (typeof rebuildBillingRollups === 'function') {
    await rebuildBillingRollups(_copid);
  }
  auditLog('delete', 'changeOrder', key, { status, projectId: _copid });
  showToast('Change order deleted', 'warn');
}

function filterCOs(status) {
  document.querySelectorAll('#coList .co-card').forEach(card => {
    card.style.display = (status === 'all' || card.getAttribute('data-status') === status) ? '' : 'none';
  });
  document.querySelectorAll('[data-co-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-co-filter') === status);
  });
}

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

// ── Expose to global scope ────────────────────────────────────
window.initChangeOrders = initChangeOrders;
window.detachCOListeners = detachCOListeners;
window.addChangeOrder = addChangeOrder;
window.approveRejectCO = approveRejectCO;
window.deleteCO = deleteCO;
window.filterCOs = filterCOs;
window.exportCOsCSV = exportCOsCSV;
