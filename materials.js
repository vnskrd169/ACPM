let _mpid = null;
let _draftItems = [];
let _matListeners = [];
let _inventory = {};
let _currentDeliveryPO = null;
let _currentInvoicePO = null;
let _prevMatSpent = -1;

function initMaterials(pid) {
  _mpid = pid; _draftItems = [];
  detachMatListeners();
  renderDraft();
  watchMatBudget(pid);
  watchLedger(pid);
  watchPOHistory(pid);
  watchInventory(pid);
  loadGlobalSuppliersForPO();

  // Set default PO date to today
  const poDate = $('poDate');
  if (poDate && !poDate.value) poDate.value = new Date().toISOString().slice(0, 10);
}

function detachMatListeners() {
  _matListeners.forEach(ref => ref.off());
  _matListeners = [];
}

function matListen(ref, cb) {
  ref.on('value', cb);
  _matListeners.push(ref);
}

// ── Budget KPIs ─────────────────────────────────────────────
function watchMatBudget(pid) {
  const ref = firebase.database().ref(`projects/${pid}`);
  matListen(ref, snap => {
    const d = snap.val() || {};
    const budget = (parseFloat(d.materialBudget) || 0) + (parseFloat(d.materialBudgetDelta) || 0);
    const spent = parseFloat(d.materialSpent) || 0;
    const left = budget - spent;
    const p = pct(spent, budget);
    setText('mbBudget', peso(budget));
    setText('mbSpent', peso(spent));
    const el = $('mbLeft');
    if (el) { el.textContent = peso(left); el.className = `kpi-num ${left < 0 ? 'kpi-danger' : 'kpi-safe'}`; }
    const wb = $('matBudgetWarn');
    if (wb) {
      wb.classList.toggle('hidden', p < 80);
      wb.className = `budget-warn-bar ${p >= 95 ? 'warn-critical' : 'warn-high'} ${p < 80 ? 'hidden' : ''}`;
      wb.textContent = p >= 95
        ? `\u26A0\uFE0F CRITICAL \u2014 Materials budget ${p}% used! Only ${peso(left)} left.`
        : `\u26A0\uFE0F WARNING \u2014 Materials budget ${p}% used. ${peso(left)} remaining.`;
    }
  });
}

// ── Inventory Tracking ──────────────────────────────────────
function watchInventory(pid) {
  const ref = firebase.database().ref(`projects/${pid}/inventory`);
  matListen(ref, snap => {
    _inventory = {};
    snap.forEach(c => { _inventory[c.key] = c.val(); });
    renderInventoryList(snap);
    renderInventoryAlerts(snap);
  });
}

function renderInventoryList(snap) {
  const el = $('inventoryList'); if (!el) return;
  el.innerHTML = '';

  if (!snap.exists()) {
    el.innerHTML = '<p class="empty-hint">No inventory tracked yet. Record deliveries to update stock.</p>';
    return;
  }

  const items = [];
  snap.forEach(c => items.push({ key: c.key, ...c.val() }));
  items.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));

  const table = document.createElement('table');
  table.className = 'summary-table';
  table.innerHTML = `
    <thead><tr>
      <th>Item</th><th>Size</th><th style="text-align:center">Stock</th><th>Unit</th>
      <th style="text-align:center">Reorder Point</th><th>Status</th><th>Last Received</th>
    </tr></thead>
    <tbody>
      ${items.map(item => {
        const isLow = item.qtyOnHand <= (item.reorderPoint || 0);
        return `<tr class="s-row ${isLow ? 'inventory-low' : ''}">
          <td class="s-cell s-bold">${escapeHtml(item.item)}</td>
          <td class="s-cell">${escapeHtml(item.size) || '\u2014'}</td>
          <td class="s-cell s-center ${isLow ? 'text-red' : 'text-green'}">${item.qtyOnHand}</td>
          <td class="s-cell">${escapeHtml(item.unit)}</td>
          <td class="s-cell s-center">${item.reorderPoint || 0}</td>
          <td class="s-cell">${isLow ? '\u1F534 LOW STOCK' : '\u2713 OK'}</td>
          <td class="s-cell">${item.lastReceived || '\u2014'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  `;
  el.appendChild(table);
}

function renderInventoryAlerts(snap) {
  const container = $('inventoryAlertContainer');
  if (!container) return;
  container.innerHTML = '';

  const alerts = [];
  snap.forEach(c => {
    const item = c.val();
    if (item.qtyOnHand <= (item.reorderPoint || 0)) {
      alerts.push(`${escapeHtml(item.item)} (${item.qtyOnHand} ${escapeHtml(item.unit)})`);
    }
  });

  if (alerts.length) {
    const banner = document.createElement('div');
    banner.className = 'budget-warn-bar warn-critical';
    banner.innerHTML = `\u1F534 LOW STOCK ALERT: ${alerts.join(' \u00B7 ')}`;
    container.appendChild(banner);
  }
}

// ── Load global suppliers for PO quick-select ───────────────
function loadGlobalSuppliersForPO() {
  firebase.database().ref('suppliers').once('value', snap => {
    refreshSupplierDropdown(snap);
  });
}

// ══════════════════════════════════════════════════════
//  PO DRAFT BUILDER
// ══════════════════════════════════════════════════════
function addDraftItem() {
  const desc = $('poItemDesc')?.value.trim();
  const size = $('poItemSize')?.value.trim() || '';
  const qty = parseFloat($('poItemQty')?.value) || 0;
  const unit = $('poItemUnit')?.value.trim() || '';
  const cost = parseFloat($('poItemCost')?.value) || 0;
  if (!desc) { showToast('Enter item description.', 'error'); return; }
  if (qty <= 0) { showToast('Enter valid quantity.', 'error'); return; }
  if (cost <= 0) { showToast('Enter valid unit cost.', 'error'); return; }
  if (desc.length > 100) { showToast('Description too long (max 100).', 'error'); return; }

  _draftItems.push({ desc, size, qty, unit, cost, total: qty * cost });
  ['poItemDesc', 'poItemSize', 'poItemQty', 'poItemUnit', 'poItemCost'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });
  $('poItemDesc')?.focus();
  renderDraft();
}

function removeDraftItem(i) { _draftItems.splice(i, 1); renderDraft(); }

function canTouchMaterialsProject() {
  return !!_mpid && typeof canEditProject === 'function' && canEditProject(_mpid);
}

function renderDraft() {
  const el = $('draftList'); if (!el) return;
  if (!_draftItems.length) {
    el.innerHTML = '<p class="empty-hint">No items yet. Fill the form above and click + Add Item.</p>';
    setText('draftTotal', peso(0)); return;
  }

  const fragment = document.createDocumentFragment();
  _draftItems.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'draft-row';
    row.innerHTML = `
      <span class="draft-desc">${escapeHtml(item.desc)}${item.size ? ` <span class="draft-size">[${escapeHtml(item.size)}]</span>` : ''}</span>
      <span class="draft-qty">${item.qty} ${escapeHtml(item.unit)}</span>
      <span class="draft-cost">${peso(item.cost)}/unit</span>
      <span class="draft-total">${peso(item.total)}</span>
      <button class="draft-del" aria-label="Remove item" data-index="${i}">\u2715</button>
    `;
    row.querySelector('.draft-del').addEventListener('click', () => removeDraftItem(i));
    fragment.appendChild(row);
  });
  el.innerHTML = '';
  el.appendChild(fragment);
  setText('draftTotal', peso(_draftItems.reduce((s, x) => s + x.total, 0)));
}

// ── Submit PO with Approval Workflow ────────────────────────
async function submitPO() {
  if (!_mpid) return;
  if (!canTouchMaterialsProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!_draftItems.length) { showToast('Add at least one item first.', 'error'); return; }

  const supplier = $('poSupplier')?.value.trim();
  const date = $('poDate')?.value;
  const notes = $('poNotes')?.value.trim() || '';
  const urgency = $('poUrgency')?.value || 'normal';

  if (!supplier) { showToast('Enter supplier name.', 'error'); return; }
  if (!date) { showToast('Enter PO date.', 'error'); return; }
  if (supplier.length > 50) { showToast('Supplier name too long.', 'error'); return; }

  // Validate date not in future
  const inputDate = new Date(date + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  if (inputDate > today) { showToast('PO date cannot be in the future.', 'error'); return; }

  const total = _draftItems.reduce((s, x) => s + x.total, 0);

  // Budget check
  const budgetSnap = await firebase.database().ref(`projects/${_mpid}`).once('value');
  const budget = budgetSnap.val();
  const remaining = ((parseFloat(budget.materialBudget) || 0) + (parseFloat(budget.materialBudgetDelta) || 0)) - (parseFloat(budget.materialSpent) || 0);

  if (total > remaining) {
    if (!confirm(`\u26A0\uFE0F This PO (${peso(total)}) exceeds remaining budget (${peso(remaining)}). Submit anyway?`)) return;
  }

  const counterRef = firebase.database().ref(`projects/${_mpid}/poCounter`);
  let seq;
  try {
    const result = await counterRef.transaction(current => (current || 0) + 1);
    seq = result.snapshot.val();
  } catch (e) {
    showToast('Failed to generate PO number. Try again.', 'error');
    return;
  }

  const po = {
    supplier, date, notes, urgency,
    items: _draftItems,
    total, seq,
    status: 'pending_approval',
    approvalWorkflow: {
      submittedBy: window._currentUser.uid,
      submittedAt: Date.now(),
      approvedBy: null,
      approvedAt: null
    },
    deliveryStatus: 'not_ordered',
    invoiceStatus: 'none',
    createdAt: Date.now(),
    createdDate: new Date().toLocaleDateString('en-PH')
  };

  const poRef = await safeDb(() => firebase.database().ref(`projects/${_mpid}/purchaseOrders`).push(po), 'Failed to submit PO');

  // Create ledger entries
  const ledgerUpdates = {};
  _draftItems.forEach((item, i) => {
    ledgerUpdates[`${poRef.key}_${i}`] = {
      poId: poRef.key,
      supplier, date,
      desc: item.desc,
      size: item.size || '',
      qty: item.qty,
      unit: item.unit,
      cost: item.cost,
      total: item.total,
      status: 'pending_approval',
      createdAt: Date.now()
    };
  });
  await safeDb(() => firebase.database().ref(`projects/${_mpid}/ledger`).update(ledgerUpdates), 'Failed to update ledger');

  // Set reorder points for new items if not exists
  const invUpdates = {};
  _draftItems.forEach(item => {
    const invKey = normalizeInvKey(item.desc, item.size);
    if (!_inventory[invKey]) {
      invUpdates[invKey] = {
        item: item.desc,
        size: item.size || '',
        unit: item.unit,
        qtyOnHand: 0,
        reorderPoint: Math.ceil(item.qty * 0.3),
        lastUpdated: Date.now()
      };
    }
  });
  if (Object.keys(invUpdates).length) {
    await safeDb(() => firebase.database().ref(`projects/${_mpid}/inventory`).update(invUpdates), 'Failed to update inventory');
  }

  _draftItems = [];
  ['poSupplier', 'poDate', 'poNotes'].forEach(id => { const e = $(id); if (e) e.value = ''; });
  const sel = $('poSupplierSelect'); if (sel) sel.value = '';
  renderDraft();
  auditLog('create', 'purchaseOrder', poRef.key, { seq, supplier, total, projectId: _mpid });
  notifyProject(_mpid, {
    type: 'billing',
    message: `PO #${String(seq).padStart(3, '0')} (${peso(total)} to ${supplier}) needs your approval`
  }).catch(() => {});
  showToast(`\u1F4CB PO #${String(seq).padStart(3, '0')} submitted for approval`);
}

// ── Approve PO (boss-only — APMs submit, bosses approve) ────
async function approvePO(poId) {
  if (!_mpid) return;
  const user = window._currentUser;
  const isBoss = user?.role === 'boss' || (user?.bossOf || []).includes(_mpid);
  if (!isBoss) {
    showToast('Only a boss can approve purchase orders.', 'error');
    return;
  }

  try {
    await safeDb(() => firebase.database().ref(`projects/${_mpid}/purchaseOrders/${poId}`).update({
      status: 'approved',
      'approvalWorkflow.approvedBy': window._currentUser.uid,
      'approvalWorkflow.approvedAt': Date.now()
    }), 'Failed to approve PO');

    const ledgerSnap = await firebase.database().ref(`projects/${_mpid}/ledger`).orderByChild('poId').equalTo(poId).once('value');
    const updates = {};
    ledgerSnap.forEach(c => { updates[`${c.key}/status`] = 'ordered'; });

    if (Object.keys(updates).length) {
      await safeDb(() => firebase.database().ref(`projects/${_mpid}/ledger`).update(updates), 'Failed to update ledger items');
    }

    auditLog('approve', 'purchaseOrder', poId, { projectId: _mpid, ledgerItems: Object.keys(updates).length });
    showToast('PO approved and ready to order');
  } catch (e) {
    console.error('approvePO failed:', e);
    showToast(`Failed to approve PO: ${e?.message || 'unknown error'}`, 'error');
  }
}

// ══════════════════════════════════════════════════════
//  DELIVERY RECEIPT (3-Way Match Step 1)
// ══════════════════════════════════════════════════════
function openDeliveryModal(poId) {
  _currentDeliveryPO = poId;
  firebase.database().ref(`projects/${_mpid}/purchaseOrders/${poId}`).once('value', snap => {
    const po = snap.val();
    if (!po) return;

    const list = $('deliveryItemsList');
    if (list) {
      list.innerHTML = (po.items || []).map((item, i) => `
        <div class="delivery-item-row">
          <span class="delivery-item-name">${escapeHtml(item.desc)} ${item.size ? `[${escapeHtml(item.size)}]` : ''}</span>
          <span class="delivery-item-ordered">Ordered: ${item.qty} ${escapeHtml(item.unit)}</span>
          <input type="number" class="delivery-qty-received" id="delQty_${i}" placeholder="Qty Received" inputmode="decimal">
          <select id="delCondition_${i}">
            <option value="good">Good</option>
            <option value="damaged">Damaged</option>
            <option value="incomplete">Incomplete</option>
          </select>
        </div>
      `).join('');
    }
    $('deliveryDate').value = new Date().toISOString().slice(0, 10);
    $('deliveryModal').classList.remove('hidden');
  });
}

function closeDeliveryModal() {
  $('deliveryModal').classList.add('hidden');
  _currentDeliveryPO = null;
}

async function confirmDelivery() {
  if (!_mpid || !_currentDeliveryPO) return;
  if (!canTouchMaterialsProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }

  const [poSnap, invSnap] = await Promise.all([
    firebase.database().ref(`projects/${_mpid}/purchaseOrders/${_currentDeliveryPO}`).once('value'),
    firebase.database().ref(`projects/${_mpid}/inventory`).once('value')
  ]);
  const po = poSnap.val();
  if (!po) return;

  // Build live inventory map from fresh snapshot
  const liveInv = {};
  invSnap.forEach(c => { liveInv[c.key] = c.val(); });

  const deliveryDate = $('deliveryDate')?.value;
  const deliveryRef = $('deliveryRef')?.value.trim() || '';

  if (!deliveryDate) { showToast('Enter delivery date.', 'error'); return; }

  // Validate delivery date not in future
  const inputDate = new Date(deliveryDate + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  if (inputDate > today) { showToast('Delivery date cannot be in the future.', 'error'); return; }

  const receivedItems = [];
  const invUpdates = {};
  let allGood = true;

  (po.items || []).forEach((item, i) => {
    const qtyReceived = parseFloat($(`delQty_${i}`)?.value) || 0;
    const condition = $(`delCondition_${i}`)?.value || 'good';

    if (qtyReceived > 0) {
      receivedItems.push({
        desc: item.desc,
        size: item.size || '',
        qtyOrdered: item.qty,
        qtyReceived,
        unit: item.unit,
        condition
      });

      // Update inventory from live snapshot
      const invKey = normalizeInvKey(item.desc, item.size);
      const current = liveInv[invKey]?.qtyOnHand || 0;
      invUpdates[invKey] = {
        item: item.desc,
        size: item.size || '',
        unit: item.unit,
        qtyOnHand: current + qtyReceived,
        lastReceived: deliveryDate,
        lastUpdated: Date.now()
      };

      if (condition !== 'good') allGood = false;
    }
  });

  if (!receivedItems.length) { showToast('Enter quantities received.', 'error'); return; }

  const deliveryKey = firebase.database().ref().push().key;
  const updates = {};

  updates[`projects/${_mpid}/deliveries/${deliveryKey}`] = {
    poId: _currentDeliveryPO,
    date: deliveryDate,
    reference: deliveryRef,
    items: receivedItems,
    receivedAt: Date.now(),
    receivedBy: window._currentUser.uid,
    status: allGood ? 'complete' : 'has_issues'
  };

  // Update PO status
  const totalOrdered = po.items.reduce((s, i) => s + i.qty, 0);
  const totalReceived = receivedItems.reduce((s, i) => s + i.qtyReceived, 0);
  const deliveryStatus = totalReceived >= totalOrdered ? 'fully_delivered' : 'partially_delivered';

  updates[`projects/${_mpid}/purchaseOrders/${_currentDeliveryPO}/deliveryStatus`] = deliveryStatus;
  updates[`projects/${_mpid}/purchaseOrders/${_currentDeliveryPO}/lastDelivery`] = deliveryKey;
  updates[`projects/${_mpid}/purchaseOrders/${_currentDeliveryPO}/lastDeliveryDate`] = deliveryDate;

  Object.assign(updates, Object.fromEntries(
    Object.entries(invUpdates).map(([k, v]) => [`projects/${_mpid}/inventory/${k}`, v])
  ));

  await safeDb(() => firebase.database().ref().update(updates), 'Failed to record delivery');
  auditLog('delivery', 'purchaseOrder', _currentDeliveryPO, { deliveryKey, items: receivedItems.length, projectId: _mpid });

  closeDeliveryModal();
  showToast(`\u1F4E6 Delivery recorded! ${allGood ? 'All items good.' : 'Some items have issues.'}`);
}

// ══════════════════════════════════════════════════════
//  INVOICE APPROVAL (3-Way Match Step 2)
// ══════════════════════════════════════════════════════
function openInvoiceModal(poId) {
  _currentInvoicePO = poId;
  $('invoicePoId').value = poId;
  $('invoiceNo').value = '';
  $('invoiceDate').value = new Date().toISOString().slice(0, 10);
  $('invoiceAmount').value = '';
  $('threeWayMatchResult').innerHTML = '';
  $('invoiceModal').classList.remove('hidden');
}

function closeInvoiceModal() {
  $('invoiceModal').classList.add('hidden');
  _currentInvoicePO = null;
}

async function confirmInvoice() {
  if (!_mpid || !_currentInvoicePO) return;
  if (!canTouchMaterialsProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }

  const invoiceNo = $('invoiceNo')?.value.trim();
  const invoiceDate = $('invoiceDate')?.value;
  const invoiceAmount = parseFloat($('invoiceAmount')?.value) || 0;

  if (!invoiceNo) { showToast('Enter invoice number.', 'error'); return; }
  if (!invoiceDate) { showToast('Enter invoice date.', 'error'); return; }
  if (invoiceAmount <= 0) { showToast('Enter invoice amount.', 'error'); return; }

  // Validate date not in future
  const inputDate = new Date(invoiceDate + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  if (inputDate > today) { showToast('Invoice date cannot be in the future.', 'error'); return; }

  const [poSnap, delSnap] = await Promise.all([
    firebase.database().ref(`projects/${_mpid}/purchaseOrders/${_currentInvoicePO}`).once('value'),
    firebase.database().ref(`projects/${_mpid}/deliveries`).orderByChild('poId').equalTo(_currentInvoicePO).once('value')
  ]);

  const po = poSnap.val();
  const deliveries = [];
  delSnap.forEach(c => deliveries.push(c.val()));

  const totalDelivered = deliveries.reduce((sum, d) =>
    sum + d.items.reduce((s, i) => s + i.qtyReceived, 0), 0
  );
  const totalOrdered = po.items.reduce((s, i) => s + i.qty, 0);
  const totalDeliveredValue = deliveries.reduce((sum, d) => {
    return sum + d.items.reduce((s, item) => {
      const poItem = po.items.find(pi => pi.desc === item.desc && pi.size === item.size);
      return s + (poItem ? item.qtyReceived * poItem.cost : 0);
    }, 0);
  }, 0);

  const qtyMatch = Math.abs(totalDelivered - totalOrdered) < 0.01;
  const valueMatch = Math.abs(invoiceAmount - (po.total || 0)) < 1;
  const matchStatus = qtyMatch && valueMatch ? 'matched' : 'mismatch';

  await safeDb(() => firebase.database().ref(`projects/${_mpid}/purchaseOrders/${_currentInvoicePO}`).update({
    invoiceNo,
    invoiceAmount,
    invoiceDate,
    invoiceStatus: matchStatus,
    threeWayMatch: {
      poTotal: po.total,
      deliveredQty: totalDelivered,
      orderedQty: totalOrdered,
      deliveredValue: totalDeliveredValue,
      invoiceAmount,
      qtyMatch,
      valueMatch,
      status: matchStatus,
      approvedAt: Date.now(),
      approvedBy: window._currentUser.uid
    }
  }), 'Failed to approve invoice');

  auditLog('invoice', 'purchaseOrder', _currentInvoicePO, { invoiceNo, amount: invoiceAmount, matchStatus, projectId: _mpid });

  closeInvoiceModal();
  showToast(`Invoice ${matchStatus === 'matched' ? '\u2713 3-way matched' : '\u26A0 Mismatch detected \u2014 review needed'}`);
}

// ══════════════════════════════════════════════════════
//  LEDGER
// ══════════════════════════════════════════════════════
function watchLedger(pid) {
  const ref = firebase.database().ref(`projects/${pid}/ledger`);
  matListen(ref, snap => {
    const tbody = $('ledgerBody'); if (!tbody) return;
    tbody.innerHTML = '';
    let paidTotal = 0, orderCount = 0;

    if (!snap.exists()) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">No items yet. Create a Purchase Order above.</td></tr>`;
      setText('ledgerTotal', peso(0));
      setText('ledgerCount', '0 items');
      updateMaterialsSummary(snap); return;
    }

    const fragment = document.createDocumentFragment();
    snap.forEach(c => {
      const key = c.key, m = c.val();
      orderCount++;
      const isPaid = m.status === 'paid' || m.status === 'delivered';
      if (isPaid) paidTotal += m.total || 0;

      const statusOpts = ['pending_approval','ordered','delivered','paid','cancelled'].map(s =>
        `<option value="${s}" ${m.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>`
      ).join('');

      const tr = document.createElement('tr');
      tr.className = `led-row ${m.status === 'cancelled' ? 'led-cancelled' : ''}`;
      tr.innerHTML = `
        <td class="l-cell">${m.date || '\u2014'}</td>
        <td class="l-cell l-supplier">${escapeHtml(m.supplier || '\u2014')}</td>
        <td class="l-cell l-desc">${escapeHtml(m.desc)}</td>
        <td class="l-cell">${escapeHtml(m.size || '\u2014')}</td>
        <td class="l-cell l-center">${m.qty} ${escapeHtml(m.unit)}</td>
        <td class="l-cell l-right">${peso(m.cost)}</td>
        <td class="l-cell l-right l-bold">${peso(m.total)}</td>
        <td class="l-cell">
          <select class="status-sel" onchange="updateLedgerStatus('${key}',this.value)">${statusOpts}</select>
        </td>
        <td class="l-cell l-center">
          <button class="del-item-btn" aria-label="Delete item" onclick="deleteLedgerItem('${key}','${escapeHtml(m.desc || '').replace(/'/g, "\\'")}')">\u2715</button>
        </td>
      `;
      fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);
    setText('ledgerTotal', peso(paidTotal));
    setText('ledgerCount', `${orderCount} item${orderCount !== 1 ? 's' : ''}`);
    if (paidTotal !== _prevMatSpent) {
      safeDb(() => firebase.database().ref(`projects/${pid}`).update({ materialSpent: paidTotal }), 'Failed to sync material spend')
        .then(() => { _prevMatSpent = paidTotal; })
        .catch(() => {});
    }
    updateMaterialsSummary(snap);
  });
}

async function updateLedgerStatus(key, status) {
  if (!_mpid) return;
  if (!canTouchMaterialsProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_mpid}/ledger/${key}`).update({ status }), 'Failed to update status');
  auditLog('update', 'ledger', key, { status, projectId: _mpid });
  showToast(`Status updated to ${status}`);
}

async function deleteLedgerItem(key, desc) {
  if (!_mpid) return;
  if (!canTouchMaterialsProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm(`Delete "${desc}"?\n\nThis cannot be undone.`)) return;
  const confirmText = prompt('Type DELETE LEDGER ITEM to confirm permanent deletion:');
  if (confirmText !== 'DELETE LEDGER ITEM') {
    showToast('Deletion cancelled.', 'warn');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_mpid}/ledger/${key}`).remove(), 'Failed to delete item');
  auditLog('delete', 'ledger', key, { desc, projectId: _mpid });
  showToast('Item deleted', 'warn');
}

// ══════════════════════════════════════════════════════
//  MATERIALS SUMMARY
// ══════════════════════════════════════════════════════
function updateMaterialsSummary(snap) {
  const el = $('materialsSummary'); if (!el) return;
  if (!snap || !snap.exists()) { el.innerHTML = '<p class="empty-hint">No items yet.</p>'; return; }

  const grouped = {};
  snap.forEach(c => {
    const m = c.val();
    if (m.status === 'cancelled') return;
    const key = normalizeInvKey(m.desc, m.size);
    if (!grouped[key]) grouped[key] = { desc: m.desc, size: m.size || '', totalQty: 0, unit: m.unit || '', totalCost: 0, count: 0 };
    grouped[key].totalQty += parseFloat(m.qty) || 0;
    grouped[key].totalCost += parseFloat(m.total) || 0;
    grouped[key].count++;
  });

  if (!Object.keys(grouped).length) { el.innerHTML = '<p class="empty-hint">No active items.</p>'; return; }

  el.innerHTML = `<div style="overflow-x:auto"><table class="summary-table">
    <thead><tr>
      <th>Item</th><th>Size</th><th style="text-align:center">Total Qty</th><th>Unit</th>
      <th style="text-align:right">Total Cost</th><th style="text-align:right">PO Count</th>
    </tr></thead>
    <tbody>
      ${Object.values(grouped).sort((a, b) => b.totalCost - a.totalCost).map(g => `
        <tr class="s-row">
          <td class="s-cell s-bold">${escapeHtml(g.desc)}</td>
          <td class="s-cell">${escapeHtml(g.size) || '\u2014'}</td>
          <td class="s-cell s-center">${g.totalQty}</td>
          <td class="s-cell">${escapeHtml(g.unit)}</td>
          <td class="s-cell s-right s-bold">${peso(g.totalCost)}</td>
          <td class="s-cell s-right">${g.count}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ══════════════════════════════════════════════════════
//  PO HISTORY (Enhanced with Actions)
// ══════════════════════════════════════════════════════
function watchPOHistory(pid) {
  const ref = firebase.database().ref(`projects/${pid}/purchaseOrders`);
  matListen(ref, snap => {
    const container = $('poHistory'); if (!container) return;
    container.innerHTML = '';

    if (!snap.exists()) {
      container.innerHTML = '<p class="empty-hint" style="padding:20px">No purchase orders yet. Create one above.</p>';
      return;
    }

    const entries = [];
    snap.forEach(c => entries.unshift({ id: c.key, ...c.val() }));

    const byMonth = {};
    entries.forEach(po => {
      const dateStr = po.date || po.createdDate || 'Unknown';
      const monthKey = dateStr !== 'Unknown' ? dateStr.slice(0, 7) : 'Unknown';
      if (!byMonth[monthKey]) byMonth[monthKey] = [];
      byMonth[monthKey].push(po);
    });

    const sortedMonths = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));

    sortedMonths.forEach(monthKey => {
      let monthLabel = monthKey;
      if (monthKey !== 'Unknown') {
        try {
          const [year, month] = monthKey.split('-');
          monthLabel = new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString('en-PH', { year: 'numeric', month: 'long' });
        } catch { monthLabel = monthKey; }
      }

      const monthGroup = document.createElement('div');
      monthGroup.className = 'po-month-group';
      monthGroup.setAttribute('data-month', monthKey);

      const monthHeader = document.createElement('div');
      monthHeader.className = 'po-month-header';
      monthHeader.innerHTML = `<span class="po-month-label">\u1F4C5 ${monthLabel}</span><span class="po-month-count">${byMonth[monthKey].length} PO${byMonth[monthKey].length !== 1 ? 's' : ''}</span>`;
      monthGroup.appendChild(monthHeader);

      byMonth[monthKey].forEach(po => {
        const itemRows = (po.items || []).map(it => `
          <div class="po-item-row">
            <span class="po-item-desc">${escapeHtml(it.desc)}${it.size ? ` <span class="po-item-size">[${escapeHtml(it.size)}]</span>` : ''}</span>
            <span class="po-item-qty">${it.qty} ${escapeHtml(it.unit)}</span>
            <span class="po-item-cost">${peso(it.cost)}</span>
            <span class="po-item-total">${peso(it.total)}</span>
          </div>`).join('');

        const statusBadge = {
          pending_approval: '<span class="po-status-badge po-pending">\u23F3 Pending Approval</span>',
          approved: '<span class="po-status-badge po-approved">\u2713 Approved</span>',
          ordered: '<span class="po-status-badge po-ordered">\u1F4E6 Ordered</span>',
          partially_delivered: '<span class="po-status-badge po-partial">\u1F4E6 Partial Delivery</span>',
          fully_delivered: '<span class="po-status-badge po-delivered">\u2713 Delivered</span>',
          cancelled: '<span class="po-status-badge po-cancelled">\u2715 Cancelled</span>'
        }[po.status] || `<span class="po-status-badge">${po.status}</span>`;

        const urgencyBadge = po.urgency === 'critical' ? '<span class="urgency-badge urgency-critical">\u1F534 CRITICAL</span>' :
                            po.urgency === 'urgent' ? '<span class="urgency-badge urgency-urgent">\u26A0\uFE0F URGENT</span>' : '';

        const deliveryBadge = po.deliveryStatus === 'fully_delivered' ? '<span class="del-badge del-ok">\u2713 Delivered</span>' :
                             po.deliveryStatus === 'partially_delivered' ? '<span class="del-badge del-partial">\u1F4E6 Partial</span>' :
                             '<span class="del-badge del-none">Not Delivered</span>';

        const invoiceBadge = po.invoiceStatus === 'matched' ? '<span class="inv-badge inv-matched">\u2713 3-Way Matched</span>' :
                            po.invoiceStatus === 'mismatch' ? '<span class="inv-badge inv-mismatch">\u26A0 Mismatch</span>' :
                            '<span class="inv-badge inv-none">No Invoice</span>';

        const poCard = document.createElement('div');
        poCard.className = 'po-card';
        poCard.id = `poc_${po.id}`;
        poCard.setAttribute('data-supplier', escapeHtml((po.supplier || '').toLowerCase()));
        poCard.setAttribute('data-date', po.date || '');

        // Action buttons based on status
        let actions = '';
        if (po.status === 'pending_approval') {
          actions = `<button class="po-approve-btn" data-po="${po.id}" data-action="approve">\u2713 Approve PO</button>`;
        } else if (po.status === 'approved' || po.status === 'ordered') {
          actions = `
            <button class="po-mark-btn" data-po="${po.id}" data-action="delivery">\u1F4E6 Record Delivery</button>
            <button class="po-mark-btn po-paid-btn" data-po="${po.id}" data-action="invoice">\u1F4CB Approve Invoice</button>
          `;
        } else if (po.deliveryStatus === 'fully_delivered' && po.invoiceStatus !== 'matched') {
          actions = `<button class="po-mark-btn po-paid-btn" data-po="${po.id}" data-action="invoice">\u1F4CB Approve Invoice</button>`;
        }

        poCard.innerHTML = `
          <div class="po-card-hdr">
            <div>
              <div class="po-status-row">${statusBadge} ${urgencyBadge}</div>
              <p class="po-date-lbl">${po.date} \u00B7 PO-${String(po.seq || '???').padStart(3, '0')}</p>
              <p class="po-supplier">${escapeHtml(po.supplier)}</p>
              ${po.notes ? `<p class="po-notes">${escapeHtml(po.notes)}</p>` : ''}
              <div class="po-badges-row">${deliveryBadge} ${invoiceBadge}</div>
            </div>
            <div class="po-card-right">
              <span class="po-total">${peso(po.total)}</span>
              <div class="po-btns">
                ${actions}
                <button class="po-export-btn" data-po="${po.id}" data-action="export">\u1F4F7 Image</button>
              </div>
            </div>
          </div>
          <div class="po-item-hdr">
            <span>Item / Size</span><span>Qty</span><span>Unit Cost</span><span>Total</span>
          </div>
          ${itemRows}`;

        // Attach delegated events
        poCard.querySelectorAll('[data-action]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            const poId = e.target.dataset.po;
            if (action === 'approve') approvePO(poId);
            else if (action === 'delivery') openDeliveryModal(poId);
            else if (action === 'invoice') openInvoiceModal(poId);
            else if (action === 'export') exportPOImage(poId);
          });
        });

        monthGroup.appendChild(poCard);
      });

      container.appendChild(monthGroup);
    });
  });
}

// ── Export PO as PNG ────────────────────────────────────────
async function exportPOImage(poId) {
  if (!_mpid) return;
  const snap = await firebase.database().ref(`projects/${_mpid}/purchaseOrders/${poId}`).once('value');
  const po = snap.val(); if (!po) return;

  let bankInfo = '';
  const suppSnap = await firebase.database().ref('suppliers').once('value');
  suppSnap.forEach(c => {
    const s = c.val();
    if (s.name === po.supplier && (s.bankName || s.accNum)) {
      bankInfo = `${s.bankName || ''} ${s.accNum ? '\u00B7 Acct: ' + s.accNum : ''} ${s.accName ? '\u00B7 ' + s.accName : ''}`.trim();
    }
  });

  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:-9999px;top:0;width:640px;background:#ffffff;
    color:#111;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;padding:36px;box-sizing:border-box;`;

  const itemsHTML = (po.items || []).map(it => `<tr>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb">
      ${escapeHtml(it.desc)}${it.size ? ` <em style="color:#6b7280;font-size:11px">[${escapeHtml(it.size)}]</em>` : ''}
    </td>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${it.qty} ${escapeHtml(it.unit)}</td>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${peso(it.cost)}</td>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700">${peso(it.total)}</td>
  </tr>`).join('');

  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;color:#6b7280;margin-bottom:4px">PURCHASE ORDER</div>
        <div style="font-size:22px;font-weight:900">${_mpid}</div>
        <div style="font-size:14px;color:#374151;margin-top:4px">PO-${String(po.seq || '???').padStart(3, '0')}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;color:#6b7280">Date</div>
        <div style="font-weight:700;font-size:14px">${po.date}</div>
      </div>
    </div>
    <div style="background:#f3f4f6;border-radius:10px;padding:12px 16px;margin-bottom:20px">
      <div style="font-size:10px;color:#6b7280;font-weight:700;margin-bottom:3px">SUPPLIER</div>
      <div style="font-size:17px;font-weight:900">${escapeHtml(po.supplier)}</div>
      ${bankInfo ? `<div style="font-size:12px;color:#374151;margin-top:4px;font-weight:600">\u1F3E6 ${escapeHtml(bankInfo)}</div>` : ''}
      ${po.notes ? `<div style="font-size:12px;color:#6b7280;margin-top:4px">${escapeHtml(po.notes)}</div>` : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <thead><tr style="background:#1e293b;color:#fff">
        <th style="padding:8px;text-align:left;font-size:11px">ITEM / SIZE</th>
        <th style="padding:8px;text-align:center;font-size:11px">QTY</th>
        <th style="padding:8px;text-align:right;font-size:11px">UNIT COST</th>
        <th style="padding:8px;text-align:right;font-size:11px">TOTAL</th>
      </tr></thead>
      <tbody>${itemsHTML}</tbody>
    </table>
    <div style="display:flex;justify-content:flex-end">
      <div style="background:#0f172a;color:#fff;border-radius:10px;padding:13px 20px;text-align:right">
        <div style="font-size:10px;color:#94a3b8;font-weight:600;margin-bottom:2px">TOTAL AMOUNT</div>
        <div style="font-size:24px;font-weight:900">${peso(po.total)}</div>
      </div>
    </div>
    <div style="margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;text-align:center">
      ACPM \u00B7 Art and Choi Project Management \u00B7 Generated ${new Date().toLocaleDateString('en-PH')}
    </div>`;

  document.body.appendChild(wrap);
  try {
    const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const link = document.createElement('a');
    link.download = `PO_${po.supplier.replace(/\s+/g, '_')}_${po.date}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('PO image downloaded!');
  } catch(e) {
    showToast('Export failed. Check console.', 'error');
    console.error(e);
  } finally {
    document.body.removeChild(wrap);
  }
}

// Export ledger to CSV
async function exportLedgerCSV() {
  if (!_mpid) return;
  const snap = await firebase.database().ref(`projects/${_mpid}/ledger`).once('value');
  if (!snap.exists()) { showToast('No ledger data to export.', 'warn'); return; }

  let csv = 'Date,Supplier,Description,Size,Qty,Unit,Unit Cost,Total,Status\n';
  snap.forEach(c => {
    const m = c.val();
    csv += `${m.date || ''},${escapeCsv(m.supplier || '')},${escapeCsv(m.desc || '')},${escapeCsv(m.size || '')},${m.qty || 0},${escapeCsv(m.unit || '')},${m.cost || 0},${m.total || 0},${m.status || 'ordered'}\n`;
  });

  downloadTextFile(`Ledger_${_mpid}_${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv');
  showToast('Ledger exported to CSV!');
}

// Filter PO history
let _poFilterDebounce = null;
function filterPOHistory(query) {
  if (_poFilterDebounce) clearTimeout(_poFilterDebounce);
  _poFilterDebounce = setTimeout(() => {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.po-card').forEach(card => {
      const supplier = card.getAttribute('data-supplier') || '';
      const date = card.getAttribute('data-date') || '';
      card.style.display = (supplier.includes(q) || date.includes(q)) ? '' : 'none';
    });
    document.querySelectorAll('.po-month-group').forEach(group => {
      const visible = group.querySelectorAll('.po-card:not([style*="none"])').length;
      group.style.display = visible > 0 ? '' : 'none';
    });
    if (!q) {
      document.querySelectorAll('.po-card, .po-month-group').forEach(el => el.style.display = '');
    }
  }, 150);
}

// ── Expose to global scope ────────────────────────────────────
window.initMaterials = initMaterials;
window.detachMatListeners = detachMatListeners;
window.addDraftItem = addDraftItem;
window.removeDraftItem = removeDraftItem;
window.submitPO = submitPO;
window.approvePO = approvePO;
window.openDeliveryModal = openDeliveryModal;
window.closeDeliveryModal = closeDeliveryModal;
window.confirmDelivery = confirmDelivery;
window.openInvoiceModal = openInvoiceModal;
window.closeInvoiceModal = closeInvoiceModal;
window.confirmInvoice = confirmInvoice;
window.updateLedgerStatus = updateLedgerStatus;
window.deleteLedgerItem = deleteLedgerItem;
window.exportLedgerCSV = exportLedgerCSV;
window.filterPOHistory = filterPOHistory;
window.exportPOImage = exportPOImage;
