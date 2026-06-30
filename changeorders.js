let _copid = null;
let _coListeners = [];

const CHANGE_ORDER_STATUSES = {
  draft: 'draft',
  pending: 'pending',
  reviewed: 'reviewed',
  approved: 'approved',
  rejected: 'rejected',
  voided: 'voided',
  superseded: 'superseded'
};

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

function coUserId() {
  return window._currentUser?.uid || firebase.auth().currentUser?.uid || 'system';
}

function coUserName() {
  const authUser = firebase.auth().currentUser;
  return window._currentUser?.name || window._currentUser?.displayName || authUser?.displayName || authUser?.email || 'System';
}

function coProjectRef(pid, child = '') {
  return firebase.database().ref(`projects/${pid}${child ? `/${child}` : ''}`);
}

function coAmount(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function coStatus(co) {
  const status = String(co?.status || CHANGE_ORDER_STATUSES.pending).toLowerCase();
  return CHANGE_ORDER_STATUSES[status] ? status : CHANGE_ORDER_STATUSES.pending;
}

function coIsApproved(co) {
  return coStatus(co) === CHANGE_ORDER_STATUSES.approved;
}

function coIsVoided(co) {
  const status = coStatus(co);
  return status === CHANGE_ORDER_STATUSES.voided || status === CHANGE_ORDER_STATUSES.superseded;
}

function coTotalImpact(co) {
  if (co && co.totalImpact !== undefined) return coAmount(co.totalImpact);
  return coAmount(co?.laborImpact) + coAmount(co?.materialsImpact) + coAmount(co?.otherImpact) + coAmount(co?.amount);
}

function coSnapRows(snap) {
  const rows = [];
  if (!snap || !snap.exists()) return rows;
  snap.forEach(child => {
    rows.push({ id: child.key, ...child.val() });
  });
  return rows;
}

async function createChangeOrderEvent(pid, event) {
  if (!pid || !event?.type) return null;
  const payload = {
    ...event,
    createdAt: event.createdAt || Date.now(),
    createdBy: event.createdBy || coUserId(),
    createdByName: event.createdByName || coUserName()
  };
  const ref = coProjectRef(pid, 'changeOrderEvents').push();
  await ref.set(payload);
  return ref.key;
}

async function createChangeOrderNotificationEvent(pid, type, payload = {}) {
  if (!pid || !type) return null;
  const ref = coProjectRef(pid, 'notificationEvents').push();
  await ref.set({
    module: 'changeOrders',
    type,
    status: 'pending',
    consumed: false,
    projectId: pid,
    createdAt: Date.now(),
    createdBy: coUserId(),
    createdByName: coUserName(),
    ...payload
  });
  return ref.key;
}

async function listChangeOrders(pid) {
  const snap = await coProjectRef(pid, 'changeOrders').once('value');
  return coSnapRows(snap).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function calculateChangeOrderRollup(orders) {
  const rollup = {
    totalCount: orders.length,
    pendingCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    voidedCount: 0,
    reviewedCount: 0,
    pendingValue: 0,
    approvedValue: 0,
    rejectedValue: 0,
    approvedContractImpact: 0,
    approvedLaborImpact: 0,
    approvedMaterialsImpact: 0,
    approvedOtherImpact: 0
  };

  orders.forEach(co => {
    const status = coStatus(co);
    const totalImpact = coTotalImpact(co);
    if (status === CHANGE_ORDER_STATUSES.voided || status === CHANGE_ORDER_STATUSES.superseded) {
      rollup.voidedCount += 1;
      return;
    }
    if (status === CHANGE_ORDER_STATUSES.approved) {
      rollup.approvedCount += 1;
      rollup.approvedValue += totalImpact;
      if (co.affectsContract !== false) rollup.approvedContractImpact += totalImpact;
      if (co.affectsBudget !== false) {
        rollup.approvedLaborImpact += coAmount(co.laborImpact);
        rollup.approvedMaterialsImpact += coAmount(co.materialsImpact);
        rollup.approvedOtherImpact += coAmount(co.otherImpact) + coAmount(co.amount);
      }
      return;
    }
    if (status === CHANGE_ORDER_STATUSES.rejected) {
      rollup.rejectedCount += 1;
      rollup.rejectedValue += totalImpact;
      return;
    }
    if (status === CHANGE_ORDER_STATUSES.reviewed) {
      rollup.reviewedCount += 1;
      rollup.pendingValue += totalImpact;
      return;
    }
    rollup.pendingCount += 1;
    rollup.pendingValue += totalImpact;
  });

  return rollup;
}

async function rebuildChangeOrderRollups(pid, sources = {}) {
  if (!pid) return null;
  const snap = sources.changeOrdersSnap || await coProjectRef(pid, 'changeOrders').once('value');
  const rows = coSnapRows(snap);
  const rollup = {
    ...calculateChangeOrderRollup(rows),
    lastUpdatedAt: Date.now(),
    updatedBy: coUserId()
  };
  await coProjectRef(pid, 'changeOrderRollups').set(rollup);
  return rollup;
}

async function syncProjectBudgetDeltasFromChangeOrders(pid, sources = {}) {
  if (!pid) return null;
  const snap = sources.changeOrdersSnap || await coProjectRef(pid, 'changeOrders').once('value');
  const rows = coSnapRows(snap);
  const approved = rows.filter(co => coIsApproved(co) && !coIsVoided(co) && co.affectsBudget !== false);
  const laborBudgetDelta = approved.reduce((sum, co) => sum + coAmount(co.laborImpact), 0);
  const materialBudgetDelta = approved.reduce((sum, co) => sum + coAmount(co.materialsImpact), 0);
  await firebase.database().ref().update({
    [`projects/${pid}/laborBudgetDelta`]: laborBudgetDelta,
    [`projects/${pid}/materialBudgetDelta`]: materialBudgetDelta
  });
  return { laborBudgetDelta, materialBudgetDelta };
}

async function finalizeChangeOrderFinancials(pid, sources = {}) {
  const [rollup, budgetDeltas] = await Promise.all([
    rebuildChangeOrderRollups(pid, sources),
    syncProjectBudgetDeltasFromChangeOrders(pid, sources)
  ]);
  if (typeof rebuildBillingRollups === 'function') {
    await rebuildBillingRollups(pid, sources);
  }
  return { rollup, budgetDeltas };
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
      finalizeChangeOrderFinancials(pid, { changeOrdersSnap: snap }).catch(err => console.warn('Change order rollup rebuild failed', err));
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
      const status = coStatus(co);
      const laborImpact = coAmount(co.laborImpact);
      const materialsImpact = coAmount(co.materialsImpact);
      const totalImpact = coTotalImpact(co);

      if (status === 'approved') {
        totalApproved += totalImpact;
        totalLabor += laborImpact;
        totalMaterials += materialsImpact;
      }
      if (status === 'pending' || status === 'reviewed' || status === 'draft') totalPending += totalImpact;

      const statusMap = {
        pending: { cls: 'co-pending', label: '\u23F3 Pending', actions: `
          <button class="co-approve-btn" aria-label="Approve CO" onclick="approveRejectCO('${co.id}','approved')">\u2713 Approve</button>
          <button class="co-reject-btn" aria-label="Reject CO" onclick="approveRejectCO('${co.id}','rejected')">\u2715 Reject</button>` },
        reviewed: { cls: 'co-pending', label: 'Reviewed', actions: `
          <button class="co-approve-btn" aria-label="Approve CO" onclick="approveRejectCO('${co.id}','approved')">\u2713 Approve</button>
          <button class="co-reject-btn" aria-label="Reject CO" onclick="approveRejectCO('${co.id}','rejected')">\u2715 Reject</button>` },
        approved: { cls: 'co-approved', label: '\u2713 Approved', actions: `<button class="co-revert-btn" aria-label="Revert CO" onclick="approveRejectCO('${co.id}','pending')">\u21A9 Revert</button>` },
        rejected: { cls: 'co-rejected', label: '\u2715 Rejected', actions: `<button class="co-revert-btn" aria-label="Revert CO" onclick="approveRejectCO('${co.id}','pending')">\u21A9 Revert</button>` },
        voided: { cls: 'co-rejected', label: 'Voided', actions: '' },
        superseded: { cls: 'co-rejected', label: 'Superseded', actions: '' }
      };
      const s = statusMap[status] || statusMap.pending;

      const card = document.createElement('div');
      card.className = `co-card ${s.cls}`;
      card.setAttribute('data-status', status);
      card.innerHTML = `
        <div class="co-card-hdr">
          <div class="co-card-left">
            <span class="co-number">CO-${String(co.seq || '?').padStart(3, '0')}</span>
            <span class="co-status-badge ${s.cls}-badge">${s.label}</span>
          </div>
          <div class="co-card-right">
            <span class="co-total-impact">${totalImpact >= 0 ? '+' : ''}${peso(totalImpact)}</span>
            ${status === 'voided' ? '' : `<button class="del-item-btn" aria-label="Void CO" title="Void change order" onclick="deleteCO('${co.id}','${status}')">\u2715</button>`}
          </div>
        </div>
        <div class="co-body">
          <p class="co-desc">${escapeHtml(co.description || '\u2014')}</p>
          <p class="co-meta">Requested by: <strong>${escapeHtml(co.requestedBy || '\u2014')}</strong> \u00B7 ${co.date || '\u2014'}</p>
          ${co.voidReason ? `<p class="co-notes">Void reason: ${escapeHtml(co.voidReason)}</p>` : ''}
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
    finalizeChangeOrderFinancials(pid, { changeOrdersSnap: snap }).catch(err => console.warn('Change order rollup rebuild failed', err));
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
async function createChangeOrder(projectId, data = {}) {
  if (!projectId) throw new Error('Project ID is required.');
  const counterRef = coProjectRef(projectId, 'coCounter');
  const result = await counterRef.transaction(current => (current || 0) + 1);
  const seq = result.snapshot.val();
  const now = Date.now();
  const laborImpact = coAmount(data.laborImpact);
  const materialsImpact = coAmount(data.materialsImpact);
  const otherImpact = coAmount(data.otherImpact);
  const totalImpact = data.totalImpact !== undefined
    ? coAmount(data.totalImpact)
    : laborImpact + materialsImpact + otherImpact + coAmount(data.amount);
  const payload = {
    seq,
    coNo: `CO-${String(seq).padStart(3, '0')}`,
    description: data.description || '',
    requestedBy: data.requestedBy || '',
    requestedByRole: data.requestedByRole || '',
    date: data.date || new Date(now).toISOString().slice(0, 10),
    category: data.category || 'general',
    reason: data.reason || '',
    laborImpact,
    materialsImpact,
    otherImpact,
    totalImpact,
    affectsContract: data.affectsContract !== false,
    affectsBudget: data.affectsBudget !== false,
    billingId: data.billingId || '',
    billingStatus: data.billingStatus || 'unbilled',
    notes: data.notes || '',
    status: CHANGE_ORDER_STATUSES.pending,
    createdAt: now,
    createdBy: coUserId(),
    createdByName: coUserName(),
    statusHistory: {
      [`${now}_created`]: {
        fromStatus: '',
        toStatus: CHANGE_ORDER_STATUSES.pending,
        notes: data.notes || '',
        createdAt: now,
        createdBy: coUserId(),
        createdByName: coUserName()
      }
    }
  };
  const ref = coProjectRef(projectId, 'changeOrders').push();
  const eventRef = coProjectRef(projectId, 'changeOrderEvents').push();
  const notificationRef = coProjectRef(projectId, 'notificationEvents').push();
  const updates = {};
  updates[`projects/${projectId}/changeOrders/${ref.key}`] = payload;
  updates[`projects/${projectId}/changeOrderEvents/${eventRef.key}`] = {
      type: 'submitted',
      changeOrderId: ref.key,
      date: payload.date,
      amount: totalImpact,
      toStatus: CHANGE_ORDER_STATUSES.pending,
    description: payload.description,
    createdAt: now,
    createdBy: coUserId(),
    createdByName: coUserName()
  };
  updates[`projects/${projectId}/notificationEvents/${notificationRef.key}`] = {
    module: 'changeOrders',
    type: 'change_order_submitted',
    status: 'pending',
    consumed: false,
    projectId,
    changeOrderId: ref.key,
    coNo: payload.coNo,
    amount: totalImpact,
    createdAt: now,
    createdBy: coUserId(),
    createdByName: coUserName()
  };
  await firebase.database().ref().update(updates);
  await finalizeChangeOrderFinancials(projectId);
  return { id: ref.key, ...payload };
}

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

  try {
    const created = await safeDb(() => createChangeOrder(_copid, {
      description: desc,
      requestedBy: reqBy,
      date,
      laborImpact: labor,
      materialsImpact: materials,
      notes
    }), 'Failed to submit change order');

    ['coDesc', 'coReqBy', 'coDate', 'coLaborImpact', 'coMaterialsImpact', 'coNotes'].forEach(id => {
      const e = $(id); if (e) e.value = '';
    });
    auditLog('create', 'changeOrder', created.id, { seq: created.seq, labor, materials, projectId: _copid });
    showToast(`CO-${String(created.seq).padStart(3, '0')} submitted`);
  } catch (e) {
    console.error(e);
    showToast('Failed to submit change order. Try again.', 'error');
    return;
  }
}

// ══════════════════════════════════════════════════════
//  APPROVE / REJECT — Updates laborBudgetDelta & materialBudgetDelta
//  NEVER touches the immutable baseline laborBudget / materialBudget
// ══════════════════════════════════════════════════════
async function legacyApproveRejectCO(key, newStatus) {
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

async function legacyDeleteCO(key, status) {
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
  await safeDb(() => firebase.database().ref(`projects/${_copid}/changeOrders/${key}`).update({
    status: CHANGE_ORDER_STATUSES.voided,
    voidedAt: Date.now(),
    voidedBy: coUserId(),
    voidReason: 'Legacy void fallback'
  }), 'Failed to void CO');
  if (typeof rebuildBillingRollups === 'function') {
    await rebuildBillingRollups(_copid);
  }
  auditLog('void', 'changeOrder', key, { status, projectId: _copid });
  showToast('Change order voided', 'warn');
}

async function updateChangeOrderStatus(projectId, changeOrderId, newStatus, notes = '') {
  if (!projectId || !changeOrderId) throw new Error('Project and change order ID are required.');
  if (!CHANGE_ORDER_STATUSES[newStatus]) throw new Error(`Unsupported change order status: ${newStatus}`);

  const snap = await coProjectRef(projectId, `changeOrders/${changeOrderId}`).once('value');
  if (!snap.exists()) throw new Error('Change order not found.');
  const co = snap.val();
  const oldStatus = coStatus(co);
  const now = Date.now();
  const userId = coUserId();
  const userName = coUserName();
  const basePath = `projects/${projectId}/changeOrders/${changeOrderId}`;
  const updates = {};

  updates[`${basePath}/status`] = newStatus;
  updates[`${basePath}/updatedAt`] = now;
  updates[`${basePath}/updatedBy`] = userId;
  updates[`${basePath}/${newStatus}At`] = now;
  updates[`${basePath}/${newStatus}By`] = userId;
  updates[`${basePath}/${newStatus}ByName`] = userName;
  updates[`${basePath}/${newStatus}Date`] = new Date(now).toLocaleDateString('en-PH');
  updates[`${basePath}/statusHistory/${now}_${newStatus}`] = {
    fromStatus: oldStatus,
    toStatus: newStatus,
    notes,
    createdAt: now,
    createdBy: userId,
    createdByName: userName
  };
  if (newStatus === CHANGE_ORDER_STATUSES.voided) {
    updates[`${basePath}/voidReason`] = notes || 'Voided by user';
  }
  if (newStatus === CHANGE_ORDER_STATUSES.rejected) {
    updates[`${basePath}/rejectReason`] = notes || '';
  }

  const eventRef = coProjectRef(projectId, 'changeOrderEvents').push();
  const notificationRef = coProjectRef(projectId, 'notificationEvents').push();
  updates[`projects/${projectId}/changeOrderEvents/${eventRef.key}`] = {
    type: newStatus,
    changeOrderId,
    date: co.date || new Date(now).toISOString().slice(0, 10),
    amount: coTotalImpact(co),
    fromStatus: oldStatus,
    toStatus: newStatus,
    description: co.description || '',
    notes,
    createdAt: now,
    createdBy: userId,
    createdByName: userName
  };
  updates[`projects/${projectId}/notificationEvents/${notificationRef.key}`] = {
    module: 'changeOrders',
    type: `change_order_${newStatus}`,
    status: 'pending',
    consumed: false,
    projectId,
    changeOrderId,
    coNo: co.coNo || `CO-${String(co.seq || '?').padStart(3, '0')}`,
    fromStatus: oldStatus,
    toStatus: newStatus,
    amount: coTotalImpact(co),
    createdAt: now,
    createdBy: userId,
    createdByName: userName
  };
  await firebase.database().ref().update(updates);
  await finalizeChangeOrderFinancials(projectId);
  return { id: changeOrderId, ...co, status: newStatus, oldStatus };
}

function approveChangeOrder(projectId, changeOrderId) {
  return updateChangeOrderStatus(projectId, changeOrderId, CHANGE_ORDER_STATUSES.approved);
}

function reviewChangeOrder(projectId, changeOrderId, notes = '') {
  return updateChangeOrderStatus(projectId, changeOrderId, CHANGE_ORDER_STATUSES.reviewed, notes);
}

function rejectChangeOrder(projectId, changeOrderId, reason = '') {
  return updateChangeOrderStatus(projectId, changeOrderId, CHANGE_ORDER_STATUSES.rejected, reason);
}

function voidChangeOrder(projectId, changeOrderId, reason = '') {
  return updateChangeOrderStatus(projectId, changeOrderId, CHANGE_ORDER_STATUSES.voided, reason);
}

async function linkChangeOrderBilling(projectId, changeOrderId, billingId) {
  if (!projectId || !changeOrderId || !billingId) throw new Error('Project, change order, and billing ID are required.');
  const [coSnap, billingSnap] = await Promise.all([
    coProjectRef(projectId, `changeOrders/${changeOrderId}`).once('value'),
    coProjectRef(projectId, `billings/${billingId}`).once('value')
  ]);
  if (!coSnap.exists()) throw new Error('Change order not found.');
  if (!billingSnap.exists()) throw new Error('Billing record not found.');
  const co = coSnap.val() || {};
  const billing = billingSnap.val() || {};
  if (coStatus(co) !== CHANGE_ORDER_STATUSES.approved || coIsVoided(co)) {
    throw new Error('Only approved active change orders can be linked to billing.');
  }
  const billingStatus = String(billing.status || '').toLowerCase();
  if (['voided', 'cancelled', 'rejected'].includes(billingStatus)) {
    throw new Error('Voided, cancelled, or rejected billings cannot be linked to change orders.');
  }
  const billingType = String(billing.type || 'change_order').toLowerCase();
  if (billingType !== 'change_order') {
    throw new Error('Change orders must be linked to a change_order billing record.');
  }
  const now = Date.now();
  const eventRef = coProjectRef(projectId, 'changeOrderEvents').push();
  const notificationRef = coProjectRef(projectId, 'notificationEvents').push();
  const updates = {};
  updates[`projects/${projectId}/changeOrders/${changeOrderId}/billingId`] = billingId;
  updates[`projects/${projectId}/changeOrders/${changeOrderId}/billingStatus`] = 'linked';
  updates[`projects/${projectId}/changeOrders/${changeOrderId}/billingLinkedAt`] = now;
  updates[`projects/${projectId}/changeOrders/${changeOrderId}/billingLinkedBy`] = coUserId();
  updates[`projects/${projectId}/billings/${billingId}/changeOrderIds/${changeOrderId}`] = true;
  updates[`projects/${projectId}/changeOrderEvents/${eventRef.key}`] = {
    type: 'billing_linked',
    changeOrderId,
    billingId,
    amount: coTotalImpact(co),
    createdAt: now,
    createdBy: coUserId(),
    createdByName: coUserName()
  };
  updates[`projects/${projectId}/notificationEvents/${notificationRef.key}`] = {
    module: 'changeOrders',
    type: 'change_order_billing_linked',
    status: 'pending',
    consumed: false,
    projectId,
    changeOrderId,
    billingId,
    coNo: co.coNo || `CO-${String(co.seq || '?').padStart(3, '0')}`,
    amount: coTotalImpact(co),
    createdAt: now,
    createdBy: coUserId(),
    createdByName: coUserName()
  };
  await firebase.database().ref().update(updates);
  await finalizeChangeOrderFinancials(projectId);
  return true;
}

async function approveRejectCO(key, newStatus) {
  if (!_copid) return;
  if (!canTouchChangeOrdersProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  let notes = '';
  if (newStatus === CHANGE_ORDER_STATUSES.rejected) {
    notes = prompt('Reason for rejection (optional):') || '';
  }
  try {
    const updated = await safeDb(() => updateChangeOrderStatus(_copid, key, newStatus, notes), 'Failed to update CO status');
    auditLog('update', 'changeOrder', key, { oldStatus: updated.oldStatus, newStatus, projectId: _copid });
    const action = newStatus === 'approved' ? 'approved \u2713' : newStatus === 'rejected' ? 'rejected \u2715' : 'moved to pending';
    showToast(`CO-${String(updated.seq || '?').padStart(3, '0')} ${action}`);
  } catch (e) {
    console.error(e);
  }
}

async function deleteCO(key, status) {
  if (!_copid) return;
  if (!canTouchChangeOrdersProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (status === CHANGE_ORDER_STATUSES.voided) {
    showToast('This change order is already voided.', 'warn');
    return;
  }
  if (!confirm('Void this change order? The record will stay in history and be ignored by rollups.')) return;
  const reason = prompt('Reason for voiding this change order:');
  if (!reason || !reason.trim()) {
    showToast('Void cancelled. A reason is required.', 'warn');
    return;
  }
  try {
    const updated = await safeDb(() => voidChangeOrder(_copid, key, reason.trim()), 'Failed to void CO');
    auditLog('void', 'changeOrder', key, { previousStatus: updated.oldStatus, projectId: _copid, reason: reason.trim() });
    showToast(`CO-${String(updated.seq || '?').padStart(3, '0')} voided`, 'warn');
  } catch (e) {
    console.error(e);
  }
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
    const total = coTotalImpact(co);
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
window.createChangeOrder = createChangeOrder;
window.listChangeOrders = listChangeOrders;
window.rebuildChangeOrderRollups = rebuildChangeOrderRollups;
window.syncProjectBudgetDeltasFromChangeOrders = syncProjectBudgetDeltasFromChangeOrders;
window.updateChangeOrderStatus = updateChangeOrderStatus;
window.reviewChangeOrder = reviewChangeOrder;
window.approveChangeOrder = approveChangeOrder;
window.rejectChangeOrder = rejectChangeOrder;
window.voidChangeOrder = voidChangeOrder;
window.linkChangeOrderBilling = linkChangeOrderBilling;
window.createChangeOrderEvent = createChangeOrderEvent;
window.approveRejectCO = approveRejectCO;
window.deleteCO = deleteCO;
window.filterCOs = filterCOs;
window.exportCOsCSV = exportCOsCSV;
