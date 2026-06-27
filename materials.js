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
  watchMaterialMovements(pid);
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
    snap.forEach(c => {
      _inventory[c.key] = c.val();
    });
    renderInventoryList(snap);
    renderInventoryAlerts(snap);
    renderMaterialIssueOptions();
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
  snap.forEach(c => {
    items.push({ key: c.key, ...c.val() });
  });
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
function renderMaterialIssueOptions() {
  const sel = $('matIssueItem');
  if (!sel) return;

  const prev = sel.value;
  const items = Object.entries(_inventory || {})
    .map(([key, item]) => ({ key, ...(item || {}) }))
    .filter(item => (parseFloat(item.qtyOnHand) || 0) > 0)
    .sort((a, b) => String(a.item || a.description || '').localeCompare(String(b.item || b.description || '')));

  sel.innerHTML = '<option value="">Select stock item</option>';
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.key;
    opt.textContent = `${item.item || item.description || item.key}${item.size ? ' [' + item.size + ']' : ''} - ${item.qtyOnHand || 0} ${item.unit || ''}`;
    opt.dataset.item = item.item || item.description || '';
    opt.dataset.description = item.description || item.item || '';
    opt.dataset.size = item.size || '';
    opt.dataset.unit = item.unit || '';
    opt.dataset.cost = item.avgCost || 0;
    opt.dataset.qty = item.qtyOnHand || 0;
    sel.appendChild(opt);
  });

  if ([...sel.options].some(opt => opt.value === prev)) sel.value = prev;
}

async function submitMaterialIssuance() {
  if (!_mpid) return;
  if (!canTouchMaterialsProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }

  const sel = $('matIssueItem');
  const itemKey = sel?.value || '';
  const opt = sel?.options[sel.selectedIndex];
  const qtyIssued = parseFloat($('matIssueQty')?.value) || 0;
  const issuedTo = $('matIssueTo')?.value.trim() || '';
  const scope = $('matIssueScope')?.value.trim() || '';
  const purpose = $('matIssuePurpose')?.value.trim() || '';

  if (!itemKey || !opt) { showToast('Select stock item to issue.', 'error'); return; }
  if (qtyIssued <= 0) { showToast('Enter valid issue quantity.', 'error'); return; }
  if (!issuedTo) { showToast('Enter issued to / receiver.', 'error'); return; }
  const availableQty = parseFloat(opt.dataset.qty) || 0;
  if (qtyIssued > availableQty) {
    const itemLabel = opt.dataset.item || opt.dataset.description || 'selected item';
    showToast(`Only ${availableQty} ${opt.dataset.unit || ''} available for ${itemLabel}.`, 'error');
    return;
  }

  try {
    const result = await issueMaterial(_mpid, {
      issuedTo,
      scope,
      purpose,
      items: [{
        itemKey,
        desc: opt.dataset.item || opt.dataset.description || itemKey,
        description: opt.dataset.description || opt.dataset.item || itemKey,
        size: opt.dataset.size || '',
        unit: opt.dataset.unit || '',
        qtyIssued,
        unitCost: parseFloat(opt.dataset.cost) || 0
      }]
    });

    ['matIssueQty', 'matIssueTo', 'matIssueScope', 'matIssuePurpose'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    if (sel) sel.value = '';
    auditLog('issue', 'materialIssuance', result.issueId, { projectId: _mpid, totalCost: result.totalCost });
    showToast(`Material issued. ${result.issueNo}`);
  } catch (e) {
    console.error('submitMaterialIssuance failed:', e);
    showToast(e?.message || 'Failed to issue material.', 'error');
  }
}

function loadGlobalSuppliersForPO() {
  firebase.database().ref('suppliers').once('value', snap => {
    refreshSupplierDropdown(snap);
  });
}

// ══════════════════════════════════════════════════════
//  PO DRAFT BUILDER
// ══════════════════════════════════════════════════════
function addDraftItem() {
  if (!canTouchMaterialsProject()) return;
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

function removeDraftItem(i) {
  if (!canTouchMaterialsProject()) return;
  _draftItems.splice(i, 1);
  renderDraft();
}

function canTouchMaterialsProject() {
  return typeof requireEdit === 'function'
    ? requireEdit(_mpid)
    : !!_mpid && typeof canEditProject === 'function' && canEditProject(_mpid);
}

function materialUserId() {
  return window._currentUser?.uid || 'unknown';
}

function materialItemsArray(items) {
  if (Array.isArray(items)) return items;
  return Object.entries(items || {}).map(([key, value]) => ({ itemId: key, ...(value || {}) }));
}

function buildMaterialItemKey(item) {
  return item.itemKey || normalizeInvKey(item.desc || item.description, item.size);
}

function buildPoItem(raw, index = 0) {
  const desc = String(raw.desc || raw.description || '').trim();
  const size = String(raw.size || '').trim();
  const qty = parseFloat(raw.qtyOrdered ?? raw.qty) || 0;
  const cost = parseFloat(raw.unitCost ?? raw.cost) || 0;
  const itemId = raw.itemId || `item_${String(index + 1).padStart(3, '0')}`;
  const itemKey = buildMaterialItemKey({ ...raw, desc, size });
  const qtyReceived = parseFloat(raw.qtyReceived) || 0;
  const qtyAccepted = parseFloat(raw.qtyAccepted) || qtyReceived || 0;
  const qtyRejected = parseFloat(raw.qtyRejected) || 0;
  const qtyCancelled = parseFloat(raw.qtyCancelled) || 0;

  return {
    itemId,
    itemKey,
    desc,
    description: desc,
    size,
    qty,
    qtyOrdered: qty,
    qtyReceived,
    qtyAccepted,
    qtyRejected,
    qtyCancelled,
    qtyRemaining: Math.max(0, qty - qtyAccepted - qtyCancelled),
    unit: String(raw.unit || '').trim(),
    cost,
    unitCost: cost,
    total: qty * cost,
    totalCost: qty * cost,
    reorderPoint: parseFloat(raw.reorderPoint) || Math.ceil(qty * 0.3)
  };
}

function materialMovementPayload(data) {
  const now = Date.now();
  return {
    type: data.type,
    date: data.date || new Date(now).toISOString().slice(0, 10),
    createdAt: data.createdAt || now,
    createdBy: data.createdBy || materialUserId(),
    itemKey: data.itemKey || '',
    description: data.description || data.desc || '',
    size: data.size || '',
    unit: data.unit || '',
    qtyIn: parseFloat(data.qtyIn) || 0,
    qtyOut: parseFloat(data.qtyOut) || 0,
    unitCost: parseFloat(data.unitCost ?? data.cost) || 0,
    movementCost: parseFloat(data.movementCost ?? data.total) || 0,
    balanceAfter: parseFloat(data.balanceAfter) || 0,
    sourceType: data.sourceType || '',
    sourceId: data.sourceId || '',
    poId: data.poId || '',
    deliveryId: data.deliveryId || '',
    issueId: data.issueId || '',
    supplierId: data.supplierId || '',
    supplierName: data.supplierName || data.supplier || '',
    notes: data.notes || ''
  };
}

async function createMaterialMovement(pid, movement) {
  if (!pid) throw new Error('Project id is required.');
  const ref = firebase.database().ref(`projects/${pid}/materialMovements`).push();
  const payload = materialMovementPayload(movement);
  await safeDb(() => ref.set(payload), 'Failed to create material movement');
  return { id: ref.key, ...payload };
}

function addMaterialMovementUpdate(pid, updates, movement) {
  const key = firebase.database().ref().push().key;
  updates[`projects/${pid}/materialMovements/${key}`] = materialMovementPayload(movement);
  return key;
}

async function createPurchaseOrder(pid, input) {
  if (!pid) throw new Error('Project id is required.');
  const items = materialItemsArray(input.items).map(buildPoItem);
  if (!items.length) throw new Error('At least one PO item is required.');

  const supplierName = String(input.supplierName || input.supplier || '').trim();
  if (!supplierName) throw new Error('Supplier is required.');

  const total = items.reduce((sum, item) => sum + (parseFloat(item.totalCost ?? item.total) || 0), 0);
  const counterRef = firebase.database().ref(`projects/${pid}/poCounter`);
  const counterResult = await counterRef.transaction(current => (current || 0) + 1);
  const seq = counterResult.snapshot.val();
  const poId = firebase.database().ref(`projects/${pid}/purchaseOrders`).push().key;
  const now = Date.now();
  const poNo = `PO-${String(seq).padStart(3, '0')}`;

  const po = {
    supplier: supplierName,
    supplierName,
    supplierId: input.supplierId || '',
    date: input.date,
    notes: input.notes || '',
    urgency: input.urgency || 'normal',
    items,
    total,
    committedCost: 0,
    receivedCost: 0,
    issuedCost: 0,
    seq,
    poNo,
    status: 'pending_approval',
    deliveryStatus: 'not_ordered',
    invoiceStatus: 'none',
    approvalWorkflow: {
      submittedBy: materialUserId(),
      submittedAt: now,
      approvedBy: null,
      approvedAt: null
    },
    createdAt: now,
    createdBy: materialUserId(),
    createdDate: new Date(now).toLocaleDateString('en-PH')
  };

  const invSnap = await firebase.database().ref(`projects/${pid}/inventory`).once('value');
  const liveInv = {};
  invSnap.forEach(c => {
    liveInv[c.key] = c.val();
  });

  const updates = {};
  updates[`projects/${pid}/purchaseOrders/${poId}`] = po;
  items.forEach((item, i) => {
    updates[`projects/${pid}/ledger/${poId}_${item.itemId}`] = {
      poId,
      poItemId: item.itemId,
      supplier: supplierName,
      supplierName,
      supplierId: input.supplierId || '',
      date: input.date,
      desc: item.desc,
      size: item.size || '',
      qty: item.qty,
      unit: item.unit,
      cost: item.cost,
      total: item.total,
      status: 'pending_approval',
      createdAt: now
    };

    if (!liveInv[item.itemKey]) {
      updates[`projects/${pid}/inventory/${item.itemKey}`] = {
        itemKey: item.itemKey,
        item: item.desc,
        description: item.desc,
        size: item.size || '',
        unit: item.unit,
        qtyOnHand: 0,
        avgCost: item.cost,
        totalValue: 0,
        reorderPoint: item.reorderPoint,
        lastUpdated: now,
        lastMovementAt: now
      };
    }
  });

  addMaterialMovementUpdate(pid, updates, {
    type: 'po_submit',
    date: input.date,
    sourceType: 'purchaseOrder',
    sourceId: poId,
    poId,
    supplierId: input.supplierId || '',
    supplierName,
    movementCost: total,
    notes: input.notes || ''
  });

  await safeDb(() => firebase.database().ref().update(updates), 'Failed to submit PO');
  return { poId, po, seq };
}

async function getPurchaseOrder(pid, poId) {
  const snap = await firebase.database().ref(`projects/${pid}/purchaseOrders/${poId}`).once('value');
  const po = snap.val();
  return po ? { id: poId, ...po } : null;
}

async function listPurchaseOrders(pid) {
  const snap = await firebase.database().ref(`projects/${pid}/purchaseOrders`).once('value');
  const orders = [];
  snap.forEach(c => {
    orders.push({ id: c.key, ...c.val() });
  });
  return orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function calculateReceivedQtyByPOItem(pid, poId) {
  const snap = await firebase.database().ref(`projects/${pid}/deliveries`).orderByChild('poId').equalTo(poId).once('value');
  const totals = {};
  snap.forEach(deliverySnap => {
    const delivery = deliverySnap.val() || {};
    if (delivery.status === 'voided') return;
    materialItemsArray(delivery.items).forEach(item => {
      const key = item.poItemId || item.itemId || item.itemKey || buildMaterialItemKey(item);
      const accepted = parseFloat(item.qtyAccepted ?? item.qtyReceived) || 0;
      const rejected = parseFloat(item.qtyRejected) || 0;
      if (!totals[key]) totals[key] = { qtyReceived: 0, qtyAccepted: 0, qtyRejected: 0 };
      totals[key].qtyReceived += parseFloat(item.qtyReceived) || accepted;
      totals[key].qtyAccepted += accepted;
      totals[key].qtyRejected += rejected;
    });
  });
  return totals;
}

async function receiveDelivery(pid, poId, input) {
  if (!pid || !poId) throw new Error('Project and PO are required.');
  const po = await getPurchaseOrder(pid, poId);
  if (!po) throw new Error('Purchase order not found.');

  const poItems = materialItemsArray(po.items).map((item, index) => ({ ...buildPoItem(item, index), _index: index }));
  const receivedMap = await calculateReceivedQtyByPOItem(pid, poId);
  const date = input.date || input.deliveryDate || new Date().toISOString().slice(0, 10);
  const deliveryId = firebase.database().ref(`projects/${pid}/deliveries`).push().key;
  const updates = {};
  const deliveryItems = [];
  let allGood = true;

  materialItemsArray(input.items).forEach(raw => {
    const index = Number.isInteger(raw.index) ? raw.index : parseInt(raw.index, 10);
    const poItem = poItems[index] || poItems.find(item => item.itemId === raw.poItemId || item.itemKey === raw.itemKey);
    if (!poItem) return;

    const qtyReceived = parseFloat(raw.qtyReceived) || 0;
    if (qtyReceived <= 0) return;

    const condition = raw.condition || 'good';
    const qtyAccepted = condition === 'damaged' ? 0 : qtyReceived;
    const qtyRejected = condition === 'damaged' ? qtyReceived : 0;
    const prior = receivedMap[poItem.itemId] || receivedMap[poItem.itemKey] || {};
    const priorAccepted = parseFloat(prior.qtyAccepted) || parseFloat(poItem.qtyAccepted) || 0;
    const ordered = parseFloat(poItem.qtyOrdered ?? poItem.qty) || 0;
    const remaining = Math.max(0, ordered - priorAccepted);

    if (qtyReceived > remaining) {
      throw new Error(`${poItem.desc} exceeds remaining PO quantity. Remaining: ${remaining}.`);
    }
    if (condition !== 'good') allGood = false;

    deliveryItems.push({
      poItemId: poItem.itemId,
      itemKey: poItem.itemKey,
      desc: poItem.desc,
      description: poItem.desc,
      size: poItem.size || '',
      qtyOrdered: ordered,
      qtyReceived,
      qtyAccepted,
      qtyRejected,
      unit: poItem.unit,
      unitCost: poItem.unitCost,
      cost: poItem.cost,
      acceptedCost: qtyAccepted * poItem.unitCost,
      condition
    });

    const nextAccepted = priorAccepted + qtyAccepted;
    const nextRejected = (parseFloat(prior.qtyRejected) || parseFloat(poItem.qtyRejected) || 0) + qtyRejected;
    updates[`projects/${pid}/purchaseOrders/${poId}/items/${poItem._index}/qtyReceived`] = nextAccepted + nextRejected;
    updates[`projects/${pid}/purchaseOrders/${poId}/items/${poItem._index}/qtyAccepted`] = nextAccepted;
    updates[`projects/${pid}/purchaseOrders/${poId}/items/${poItem._index}/qtyRejected`] = nextRejected;
    updates[`projects/${pid}/purchaseOrders/${poId}/items/${poItem._index}/qtyRemaining`] = Math.max(0, ordered - nextAccepted);
    updates[`projects/${pid}/purchaseOrders/${poId}/items/${poItem._index}/lastReceivedAt`] = Date.now();
  });

  if (!deliveryItems.length) throw new Error('Enter quantities received.');

  const acceptedItems = deliveryItems.filter(item => item.qtyAccepted > 0);
  const inventoryResult = await updateInventoryFromReceiving(pid, acceptedItems, { updates, date });
  const acceptedCost = inventoryResult.items.reduce((sum, item) => sum + item.movementCost, 0);
  const currentBudgetUpdates = {};
  const currentReceivedCost = await calculateMaterialBudgetSpent(pid, { updates: currentBudgetUpdates });
  const nextReceivedCost = currentReceivedCost + acceptedCost;

  inventoryResult.items.forEach(item => {
    addMaterialMovementUpdate(pid, updates, {
      type: 'receive',
      date,
      itemKey: item.itemKey,
      description: item.desc || item.description,
      size: item.size,
      unit: item.unit,
      qtyIn: item.qtyAccepted,
      unitCost: item.unitCost,
      movementCost: item.movementCost,
      balanceAfter: item.balanceAfter,
      sourceType: 'delivery',
      sourceId: deliveryId,
      poId,
      deliveryId,
      supplierId: po.supplierId || '',
      supplierName: po.supplierName || po.supplier || '',
      notes: input.notes || input.reference || ''
    });
  });

  const projectedTotals = {};
  poItems.forEach(item => {
    const prior = receivedMap[item.itemId] || receivedMap[item.itemKey] || {};
    projectedTotals[item.itemId] = parseFloat(prior.qtyAccepted) || parseFloat(item.qtyAccepted) || 0;
  });
  deliveryItems.forEach(item => {
    projectedTotals[item.poItemId] = (projectedTotals[item.poItemId] || 0) + item.qtyAccepted;
  });

  const totalOrdered = poItems.reduce((sum, item) => sum + (parseFloat(item.qtyOrdered ?? item.qty) || 0), 0);
  const totalAccepted = Object.values(projectedTotals).reduce((sum, qty) => sum + (parseFloat(qty) || 0), 0);
  const deliveryStatus = totalAccepted >= totalOrdered ? 'fully_delivered' : 'partially_delivered';
  const orders = await listPurchaseOrders(pid);
  const nextCommitted = orders
    .map(order => order.id === poId ? { ...order, status: deliveryStatus } : order)
    .filter(order => ['approved', 'ordered', 'partially_delivered'].includes(order.status))
    .reduce((sum, order) => sum + (parseFloat(order.total) || 0), 0);

  updates[`projects/${pid}/deliveries/${deliveryId}`] = {
    poId,
    poNo: po.poNo || `PO-${String(po.seq || '???').padStart(3, '0')}`,
    date,
    deliveryDate: date,
    reference: input.reference || '',
    items: deliveryItems,
    receivedAt: Date.now(),
    receivedBy: materialUserId(),
    supplierId: po.supplierId || '',
    supplierName: po.supplierName || po.supplier || '',
    status: allGood ? 'received' : 'received_with_issues',
    notes: input.notes || ''
  };
  updates[`projects/${pid}/purchaseOrders/${poId}/deliveryStatus`] = deliveryStatus;
  updates[`projects/${pid}/purchaseOrders/${poId}/status`] = deliveryStatus;
  updates[`projects/${pid}/purchaseOrders/${poId}/lastDelivery`] = deliveryId;
  updates[`projects/${pid}/purchaseOrders/${poId}/lastDeliveryDate`] = date;
  updates[`projects/${pid}/purchaseOrders/${poId}/receivedCost`] = (parseFloat(po.receivedCost) || 0) + acceptedCost;
  updates[`projects/${pid}/materialCommitted`] = nextCommitted;
  updates[`projects/${pid}/materialReceivedCost`] = nextReceivedCost;
  updates[`projects/${pid}/materialSpent`] = nextReceivedCost;

  await safeDb(() => firebase.database().ref().update(updates), 'Failed to record delivery');
  return { deliveryId, deliveryStatus, acceptedCost, items: deliveryItems };
}

async function updateInventoryFromReceiving(pid, receivedItems, options = {}) {
  const invSnap = await firebase.database().ref(`projects/${pid}/inventory`).once('value');
  const liveInv = {};
  invSnap.forEach(c => {
    liveInv[c.key] = c.val();
  });

  const now = Date.now();
  const updates = options.updates || {};
  const results = [];
  receivedItems.forEach(item => {
    const qtyAccepted = parseFloat(item.qtyAccepted ?? item.qtyReceived) || 0;
    if (qtyAccepted <= 0) return;

    const key = item.itemKey || buildMaterialItemKey(item);
    const current = liveInv[key] || {};
    const currentQty = parseFloat(current.qtyOnHand) || 0;
    const currentValue = parseFloat(current.totalValue) || ((parseFloat(current.avgCost) || 0) * currentQty);
    const unitCost = parseFloat(item.unitCost ?? item.cost) || 0;
    const addedValue = qtyAccepted * unitCost;
    const nextQty = currentQty + qtyAccepted;
    const nextValue = currentValue + addedValue;
    const avgCost = nextQty > 0 ? nextValue / nextQty : unitCost;

    updates[`projects/${pid}/inventory/${key}`] = {
      ...current,
      itemKey: key,
      item: item.desc || item.description || current.item || '',
      description: item.description || item.desc || current.description || current.item || '',
      size: item.size || current.size || '',
      unit: item.unit || current.unit || '',
      qtyOnHand: nextQty,
      avgCost,
      totalValue: nextValue,
      reorderPoint: parseFloat(current.reorderPoint) || parseFloat(item.reorderPoint) || 0,
      lastReceived: options.date || item.date || new Date(now).toISOString().slice(0, 10),
      lastReceivedAt: now,
      lastUpdated: now,
      lastMovementAt: now
    };

    results.push({
      ...item,
      itemKey: key,
      qtyAccepted,
      unitCost,
      movementCost: addedValue,
      balanceAfter: nextQty
    });
  });

  if (!options.updates && Object.keys(updates).length) {
    await safeDb(() => firebase.database().ref().update(updates), 'Failed to update inventory');
  }
  return { updates, items: results };
}

async function validateStockAvailability(pid, issueItems) {
  const invSnap = await firebase.database().ref(`projects/${pid}/inventory`).once('value');
  const inventory = {};
  invSnap.forEach(c => {
    inventory[c.key] = c.val();
  });

  materialItemsArray(issueItems).forEach(item => {
    const itemKey = item.itemKey || buildMaterialItemKey(item);
    const qtyIssued = parseFloat(item.qtyIssued ?? item.qty) || 0;
    const onHand = parseFloat(inventory[itemKey]?.qtyOnHand) || 0;
    if (qtyIssued <= 0) throw new Error(`Invalid issue quantity for ${item.desc || item.description || itemKey}.`);
    if (qtyIssued > onHand) {
      throw new Error(`Insufficient stock for ${item.desc || item.description || itemKey}. Available: ${onHand}, requested: ${qtyIssued}.`);
    }
  });

  return inventory;
}

async function updateInventoryFromIssuance(pid, issueItems, options = {}) {
  const inventory = options.inventory || await validateStockAvailability(pid, issueItems);
  const now = Date.now();
  const updates = options.updates || {};
  const results = [];

  materialItemsArray(issueItems).forEach(item => {
    const itemKey = item.itemKey || buildMaterialItemKey(item);
    const current = inventory[itemKey] || {};
    const qtyIssued = parseFloat(item.qtyIssued ?? item.qty) || 0;
    const currentQty = parseFloat(current.qtyOnHand) || 0;
    if (qtyIssued > currentQty) throw new Error(`Insufficient stock for ${item.desc || item.description || itemKey}.`);

    const unitCost = parseFloat(item.unitCost ?? item.cost ?? current.avgCost) || 0;
    const nextQty = currentQty - qtyIssued;
    const movementCost = qtyIssued * unitCost;
    const nextValue = Math.max(0, (parseFloat(current.totalValue) || (currentQty * unitCost)) - movementCost);

    updates[`projects/${pid}/inventory/${itemKey}`] = {
      ...current,
      itemKey,
      item: current.item || item.desc || item.description || '',
      description: current.description || item.description || item.desc || '',
      size: current.size || item.size || '',
      unit: current.unit || item.unit || '',
      qtyOnHand: nextQty,
      avgCost: unitCost,
      totalValue: nextValue,
      lastIssuedAt: now,
      lastUpdated: now,
      lastMovementAt: now
    };

    results.push({
      ...item,
      itemKey,
      qtyIssued,
      unitCost,
      movementCost,
      balanceAfter: nextQty
    });
  });

  if (!options.updates && Object.keys(updates).length) {
    await safeDb(() => firebase.database().ref().update(updates), 'Failed to update inventory');
  }
  return { updates, items: results };
}

async function issueMaterial(pid, input) {
  if (!pid) throw new Error('Project id is required.');
  const issueItems = materialItemsArray(input.items);
  if (!issueItems.length) throw new Error('At least one material item is required.');

  const inventory = await validateStockAvailability(pid, issueItems);
  const issueId = firebase.database().ref(`projects/${pid}/materialIssuances`).push().key;
  const now = Date.now();
  const issueNo = input.issueNo || `ISS-${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}-${issueId.slice(-5)}`;
  const updates = {};
  const inventoryResult = await updateInventoryFromIssuance(pid, issueItems, { updates, inventory });
  const totalCost = inventoryResult.items.reduce((sum, item) => sum + item.movementCost, 0);

  updates[`projects/${pid}/materialIssuances/${issueId}`] = {
    issueNo,
    date: input.date || new Date(now).toISOString().slice(0, 10),
    issuedTo: input.issuedTo || '',
    requestedBy: input.requestedBy || '',
    location: input.location || '',
    scope: input.scope || '',
    purpose: input.purpose || '',
    notes: input.notes || '',
    createdAt: now,
    createdBy: materialUserId(),
    status: 'posted',
    totalCost,
    items: inventoryResult.items
  };

  inventoryResult.items.forEach(item => {
    addMaterialMovementUpdate(pid, updates, {
      type: 'issue',
      date: input.date,
      itemKey: item.itemKey,
      description: item.desc || item.description,
      size: item.size,
      unit: item.unit,
      qtyOut: item.qtyIssued,
      unitCost: item.unitCost,
      movementCost: item.movementCost,
      balanceAfter: item.balanceAfter,
      sourceType: 'materialIssuance',
      sourceId: issueId,
      issueId,
      notes: input.notes || ''
    });
  });

  await safeDb(() => firebase.database().ref().update(updates), 'Failed to issue material');
  return { issueId, issueNo, totalCost };
}

async function calculateMaterialBudgetSpent(pid, options = {}) {
  const movementSnap = await firebase.database().ref(`projects/${pid}/materialMovements`).once('value');
  let receivedCost = 0;
  movementSnap.forEach(c => {
    const movement = c.val() || {};
    if (movement.type === 'receive') {
      receivedCost += parseFloat(movement.movementCost) || 0;
    }
  });

  const updates = options.updates || {};
  updates[`projects/${pid}/materialReceivedCost`] = receivedCost;
  updates[`projects/${pid}/materialSpent`] = receivedCost;

  if (!options.updates) {
    await safeDb(() => firebase.database().ref().update(updates), 'Failed to update material budget');
  }
  return receivedCost;
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
  const supplierId = $('poSupplierId')?.value.trim() || '';
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

  try {
    const result = await createPurchaseOrder(_mpid, {
      supplier,
      supplierName: supplier,
      supplierId,
      date,
      notes,
      urgency,
      items: _draftItems
    });

    _draftItems = [];
    ['poSupplier', 'poSupplierId', 'poDate', 'poNotes'].forEach(id => { const e = $(id); if (e) e.value = ''; });
    const sel = $('poSupplierSelect'); if (sel) sel.value = '';
    renderDraft();
    auditLog('create', 'purchaseOrder', result.poId, { seq: result.seq, supplier, total, projectId: _mpid });
    notifyProject(_mpid, {
      type: 'billing',
      message: `PO #${String(result.seq).padStart(3, '0')} (${peso(total)} to ${supplier}) needs your approval`
    }).catch(() => {});
    showToast(`\u1F4CB PO #${String(result.seq).padStart(3, '0')} submitted for approval`);
  } catch (e) {
    console.error('submitPO failed:', e);
    showToast(e?.message || 'Failed to submit PO. Try again.', 'error');
  }
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
    const po = await getPurchaseOrder(_mpid, poId);
    await safeDb(() => firebase.database().ref(`projects/${_mpid}/purchaseOrders/${poId}`).update({
      status: 'approved',
      committedCost: parseFloat(po?.total) || 0,
      'approvalWorkflow/approvedBy': window._currentUser.uid,
      'approvalWorkflow/approvedAt': Date.now()
    }), 'Failed to approve PO');

    const ledgerSnap = await firebase.database().ref(`projects/${_mpid}/ledger`).orderByChild('poId').equalTo(poId).once('value');
    const updates = {};
    ledgerSnap.forEach(c => {
      updates[`${c.key}/status`] = 'ordered';
    });

    if (Object.keys(updates).length) {
      await safeDb(() => firebase.database().ref(`projects/${_mpid}/ledger`).update(updates), 'Failed to update ledger items');
    }

    await createMaterialMovement(_mpid, {
      type: 'po_approve',
      date: po?.date,
      sourceType: 'purchaseOrder',
      sourceId: poId,
      poId,
      supplierId: po?.supplierId || '',
      supplierName: po?.supplierName || po?.supplier || '',
      movementCost: parseFloat(po?.total) || 0
    });

    const orders = await listPurchaseOrders(_mpid);
    const committed = orders
      .filter(order => ['approved', 'ordered', 'partially_delivered'].includes(order.status))
      .reduce((sum, order) => sum + (parseFloat(order.total) || 0), 0);
    await safeDb(() => firebase.database().ref(`projects/${_mpid}`).update({ materialCommitted: committed }), 'Failed to update committed materials');

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
async function openDeliveryModal(poId) {
  _currentDeliveryPO = poId;
  try {
    const po = await getPurchaseOrder(_mpid, poId);
    if (!po) return;
    const receivedMap = await calculateReceivedQtyByPOItem(_mpid, poId);
    const items = materialItemsArray(po.items).map(buildPoItem);

    const list = $('deliveryItemsList');
    if (list) {
      list.innerHTML = items.map((item, i) => {
        const received = receivedMap[item.itemId] || receivedMap[item.itemKey] || {};
        const acceptedQty = parseFloat(received.qtyAccepted) || parseFloat(item.qtyAccepted) || 0;
        const remaining = Math.max(0, (parseFloat(item.qtyOrdered ?? item.qty) || 0) - acceptedQty);
        return `
        <div class="delivery-item-row">
          <span class="delivery-item-name">${escapeHtml(item.desc)} ${item.size ? `[${escapeHtml(item.size)}]` : ''}</span>
          <span class="delivery-item-ordered">Ordered: ${item.qty} ${escapeHtml(item.unit)} &middot; Remaining: ${remaining} ${escapeHtml(item.unit)}</span>
          <input type="number" class="delivery-qty-received" id="delQty_${i}" placeholder="Qty Received" inputmode="decimal" max="${remaining}" ${remaining <= 0 ? 'disabled' : ''}>
          <select id="delCondition_${i}">
            <option value="good">Good</option>
            <option value="damaged">Damaged</option>
            <option value="incomplete">Incomplete</option>
          </select>
        </div>
      `;
      }).join('');
    }
    $('deliveryDate').value = new Date().toISOString().slice(0, 10);
    $('deliveryModal').classList.remove('hidden');
  } catch (e) {
    console.error('openDeliveryModal failed:', e);
    showToast('Failed to load delivery form.', 'error');
  }
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

  const deliveryDate = $('deliveryDate')?.value;
  const deliveryRef = $('deliveryRef')?.value.trim() || '';

  if (!deliveryDate) { showToast('Enter delivery date.', 'error'); return; }

  // Validate delivery date not in future
  const inputDate = new Date(deliveryDate + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  if (inputDate > today) { showToast('Delivery date cannot be in the future.', 'error'); return; }

  try {
    const po = await getPurchaseOrder(_mpid, _currentDeliveryPO);
    const items = materialItemsArray(po?.items || []).map((item, i) => ({
      index: i,
      poItemId: item.itemId || `item_${String(i + 1).padStart(3, '0')}`,
      itemKey: item.itemKey || buildMaterialItemKey(item),
      qtyReceived: parseFloat($(`delQty_${i}`)?.value) || 0,
      condition: $(`delCondition_${i}`)?.value || 'good'
    })).filter(item => item.qtyReceived > 0);

    const result = await receiveDelivery(_mpid, _currentDeliveryPO, {
      date: deliveryDate,
      reference: deliveryRef,
      items
    });

    auditLog('delivery', 'purchaseOrder', _currentDeliveryPO, {
      deliveryKey: result.deliveryId,
      items: result.items.length,
      acceptedCost: result.acceptedCost,
      projectId: _mpid
    });

    closeDeliveryModal();
    showToast(`\u1F4E6 Delivery recorded. Status: ${result.deliveryStatus.replace(/_/g, ' ')}`);
  } catch (e) {
    console.error('confirmDelivery failed:', e);
    showToast(e?.message || 'Failed to record delivery.', 'error');
  }
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
  delSnap.forEach(c => {
    deliveries.push(c.val());
  });

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
    _prevMatSpent = paidTotal;
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
function materialActionLabel(type) {
  return {
    po_submit: 'PO Submit',
    po_approve: 'Approval',
    receive: 'Receive',
    issue: 'Issue',
    adjust_in: 'Adjust In',
    adjust_out: 'Adjust Out',
    return: 'Return',
    cancel: 'Cancel',
    invoice: 'Invoice'
  }[type] || String(type || 'Movement').replace(/_/g, ' ');
}

function formatMaterialMovementDate(value) {
  const ts = parseFloat(value) || 0;
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return '-';
  }
}

function formatMaterialMovementQty(movement) {
  const inQty = parseFloat(movement.qtyIn) || 0;
  const outQty = parseFloat(movement.qtyOut) || 0;
  const unit = escapeHtml(movement.unit || '');
  if (inQty > 0) return `<span class="movement-in">+${inQty} ${unit}</span>`;
  if (outQty > 0) return `<span class="movement-out">-${outQty} ${unit}</span>`;
  return '-';
}

function movementSourceLabel(movement) {
  const sourceType = movement.sourceType || '';
  const sourceId = movement.sourceId || movement.poId || movement.deliveryId || movement.issueId || '';
  if (!sourceType && !sourceId) return '-';
  const shortId = sourceId ? String(sourceId).slice(-6) : '';
  return `${sourceType || 'source'}${shortId ? ' #' + shortId : ''}`;
}

function watchMaterialMovements(pid) {
  const ref = firebase.database().ref(`projects/${pid}/materialMovements`).orderByChild('createdAt').limitToLast(80);
  matListen(ref, snap => {
    const tbody = $('materialMovementBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!snap.exists()) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No material movement history yet.</td></tr>`;
      setText('materialMovementCount', '0 rows');
      return;
    }

    const movements = [];
    snap.forEach(c => {
      movements.push({ id: c.key, ...(c.val() || {}) });
    });
    movements.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const fragment = document.createDocumentFragment();
    movements.forEach(movement => {
      const row = document.createElement('tr');
      row.className = 'led-row';
      const itemName = movement.description || movement.supplierName || movement.poId || '-';
      const size = movement.size ? ` <span class="po-item-size">[${escapeHtml(movement.size)}]</span>` : '';
      row.innerHTML = `
        <td class="l-cell">${formatMaterialMovementDate(movement.createdAt)}</td>
        <td class="l-cell"><span class="movement-type">${escapeHtml(materialActionLabel(movement.type))}</span></td>
        <td class="l-cell l-desc">${escapeHtml(itemName)}${size}</td>
        <td class="l-cell l-center">${formatMaterialMovementQty(movement)}</td>
        <td class="l-cell l-right">${movement.movementCost ? peso(movement.movementCost) : '-'}</td>
        <td class="l-cell">${escapeHtml(movementSourceLabel(movement))}</td>
        <td class="l-cell">${escapeHtml(String(movement.createdBy || '-').slice(0, 12))}</td>
      `;
      fragment.appendChild(row);
    });

    tbody.appendChild(fragment);
    setText('materialMovementCount', `${movements.length} row${movements.length === 1 ? '' : 's'}`);
  });
}

function poStatusLabel(status) {
  return {
    draft: 'Draft',
    pending_approval: 'Submitted',
    submitted: 'Submitted',
    approved: 'Approved',
    ordered: 'Approved',
    partially_delivered: 'Partially Delivered',
    fully_delivered: 'Fully Delivered',
    closed: 'Closed',
    cancelled: 'Cancelled'
  }[status] || String(status || 'Submitted').replace(/_/g, ' ');
}

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
    snap.forEach(c => {
      entries.unshift({ id: c.key, ...c.val() });
    });

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
        const itemRows = (po.items || []).map(it => {
          const orderedQty = parseFloat(it.qtyOrdered ?? it.qty) || 0;
          const acceptedQty = parseFloat(it.qtyAccepted) || 0;
          const remainingQty = Math.max(0, parseFloat(it.qtyRemaining ?? (orderedQty - acceptedQty)) || 0);
          return `
          <div class="po-item-row">
            <span class="po-item-desc">${escapeHtml(it.desc)}${it.size ? ` <span class="po-item-size">[${escapeHtml(it.size)}]</span>` : ''}</span>
            <span class="po-item-qty">${orderedQty} ${escapeHtml(it.unit)}<br><small>Recv ${acceptedQty} / Rem ${remainingQty}</small></span>
            <span class="po-item-cost">${peso(it.cost)}</span>
            <span class="po-item-total">${peso(it.total)}</span>
          </div>`;
        }).join('');

        const statusClass = {
          draft: 'po-pending',
          pending_approval: 'po-pending',
          submitted: 'po-pending',
          approved: 'po-approved',
          ordered: 'po-approved',
          partially_delivered: 'po-partial',
          fully_delivered: 'po-delivered',
          closed: 'po-delivered',
          cancelled: 'po-cancelled'
        }[po.status] || '';
        const statusBadge = `<span class="po-status-badge ${statusClass}">${escapeHtml(poStatusLabel(po.status))}</span>`;

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
        } else if (po.status === 'approved' || po.status === 'ordered' || po.status === 'partially_delivered') {
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
window.submitMaterialIssuance = submitMaterialIssuance;
window.createPurchaseOrder = createPurchaseOrder;
window.getPurchaseOrder = getPurchaseOrder;
window.listPurchaseOrders = listPurchaseOrders;
window.receiveDelivery = receiveDelivery;
window.calculateReceivedQtyByPOItem = calculateReceivedQtyByPOItem;
window.updateInventoryFromReceiving = updateInventoryFromReceiving;
window.issueMaterial = issueMaterial;
window.updateInventoryFromIssuance = updateInventoryFromIssuance;
window.createMaterialMovement = createMaterialMovement;
window.calculateMaterialBudgetSpent = calculateMaterialBudgetSpent;
window.validateStockAvailability = validateStockAvailability;
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
