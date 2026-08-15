let _supListener = null;

const SUPPLIER_STATUSES = {
  active: 'active',
  archived: 'archived',
  disabled: 'disabled'
};

function canManageSuppliers() {
  const user = window._currentUser;
  if (!user || (typeof isBoss === 'function' ? !isBoss(user.role) : user.role !== 'boss')) {
    showToast('Boss access required to manage suppliers.', 'error');
    return false;
  }
  if (window._currentPid && typeof isProjectReadOnly === 'function' && isProjectReadOnly(window._currentPid)) {
    showReadOnlyBlocked();
    return false;
  }
  return true;
}

function initSuppliers() {
  if (_supListener) { _supListener.off(); _supListener = null; }
  watchGlobalSuppliers();
}

function detachSupplierListeners() {
  if (_supListener) { _supListener.off(); _supListener = null; }
}

function supplierUserId() {
  return window._currentUser?.uid || firebase.auth().currentUser?.uid || 'system';
}

function supplierUserName() {
  const authUser = firebase.auth().currentUser;
  return window._currentUser?.name || window._currentUser?.displayName || authUser?.displayName || authUser?.email || 'System';
}

function supplierStatus(supplier) {
  const status = String(supplier?.status || SUPPLIER_STATUSES.active).toLowerCase();
  return SUPPLIER_STATUSES[status] ? status : SUPPLIER_STATUSES.active;
}

function supplierActive(supplier) {
  return supplierStatus(supplier) === SUPPLIER_STATUSES.active;
}

function supplierRows(snap, options = {}) {
  const rows = [];
  if (!snap || !snap.exists()) return rows;
  snap.forEach(c => {
    const row = { key: c.key, ...c.val() };
    row.status = supplierStatus(row);
    if (options.includeArchived || supplierActive(row)) rows.push(row);
  });
  return rows;
}

async function createSupplierEvent(event = {}) {
  if (!event.type) return null;
  const now = Date.now();
  const ref = firebase.database().ref('supplierEvents').push();
  const payload = {
    ...event,
    createdAt: event.createdAt || now,
    createdBy: event.createdBy || supplierUserId(),
    createdByName: event.createdByName || supplierUserName()
  };
  try {
    await ref.set(payload);
    return { id: ref.key, path: `supplierEvents/${ref.key}`, ...payload };
  } catch (e) {
    if (!event.supplierId) {
      console.warn('supplier event skipped:', e?.code || e?.message || e);
      return null;
    }
    const fallbackRef = firebase.database().ref(`suppliers/${event.supplierId}/events/${ref.key}`);
    try {
      await fallbackRef.set({
        ...payload,
        globalPathDenied: true,
        fallbackPath: true
      });
      return { id: ref.key, path: `suppliers/${event.supplierId}/events/${ref.key}`, ...payload };
    } catch (fallbackError) {
      console.warn('supplier event skipped:', fallbackError?.code || fallbackError?.message || fallbackError);
      return null;
    }
  }
}

async function createSupplierNotificationEvent(type, payload = {}) {
  if (!type) return null;
  const ref = firebase.database().ref('globalNotificationEvents').push();
  const event = {
    module: 'suppliers',
    type,
    status: 'pending',
    consumed: false,
    createdAt: Date.now(),
    createdBy: supplierUserId(),
    createdByName: supplierUserName(),
    ...payload
  };
  try {
    await ref.set(event);
    return { id: ref.key, path: `globalNotificationEvents/${ref.key}`, ...event };
  } catch (e) {
    if (!payload.supplierId) {
      console.warn('supplier notification event skipped:', e?.code || e?.message || e);
      return null;
    }
    const fallbackRef = firebase.database().ref(`suppliers/${payload.supplierId}/notificationEvents/${ref.key}`);
    try {
      await fallbackRef.set({
        ...event,
        globalPathDenied: true,
        fallbackPath: true
      });
      return { id: ref.key, path: `suppliers/${payload.supplierId}/notificationEvents/${ref.key}`, ...event };
    } catch (fallbackError) {
      console.warn('supplier notification event skipped:', fallbackError?.code || fallbackError?.message || fallbackError);
      return null;
    }
  }
}

async function listSuppliers(options = {}) {
  const snap = await firebase.database().ref('suppliers').once('value');
  return supplierRows(snap, options).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function listSupplierTransactions(supplierIdOrName) {
  const needle = String(supplierIdOrName || '').trim().toLowerCase();
  if (!needle) return [];
  const projectsSnap = await firebase.database().ref('projects').once('value');
  const rows = [];
  projectsSnap.forEach(projectSnap => {
    const projectId = projectSnap.key;
    const project = projectSnap.val() || {};
    const pos = project.purchaseOrders || {};
    Object.entries(pos).forEach(([poId, po]) => {
      const supplierId = String(po?.supplierId || '').toLowerCase();
      const supplierName = String(po?.supplierName || po?.supplier || '').toLowerCase();
      if (supplierId === needle || supplierName === needle) {
        rows.push({
          type: 'purchaseOrder',
          projectId,
          projectName: project.name || projectId,
          poId,
          poNo: po.poNo || '',
          status: po.status || '',
          deliveryStatus: po.deliveryStatus || '',
          total: parseFloat(po.total || po.totalCost) || 0,
          date: po.date || '',
          createdAt: po.createdAt || 0
        });
      }
    });
    Object.entries(project.deliveries || {}).forEach(([deliveryId, delivery]) => {
      const supplierId = String(delivery?.supplierId || '').toLowerCase();
      const supplierName = String(delivery?.supplierName || delivery?.supplier || '').toLowerCase();
      if (supplierId === needle || supplierName === needle) {
        rows.push({
          type: 'delivery',
          projectId,
          projectName: project.name || projectId,
          deliveryId,
          poId: delivery.poId || '',
          status: delivery.status || '',
          deliveryDate: delivery.deliveryDate || delivery.date || '',
          total: parseFloat(delivery.totalCost || delivery.total || delivery.acceptedCost) || 0,
          createdAt: delivery.receivedAt || delivery.createdAt || 0
        });
      }
    });
  });
  return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function rebuildSupplierRollup(supplierId) {
  if (!supplierId) return null;
  const supplierSnap = await firebase.database().ref(`suppliers/${supplierId}`).once('value');
  const supplier = supplierSnap.val() || {};
  const transactions = await listSupplierTransactions(supplierId);
  const supplierNameTransactions = supplier.name ? await listSupplierTransactions(supplier.name) : [];
  const merged = [...transactions, ...supplierNameTransactions]
    .filter((row, index, arr) => arr.findIndex(x =>
      x.type === row.type &&
      x.projectId === row.projectId &&
      (x.poId || '') === (row.poId || '') &&
      (x.deliveryId || '') === (row.deliveryId || '')
    ) === index);
  const poRows = merged.filter(row => row.type === 'purchaseOrder');
  const deliveryRows = merged.filter(row => row.type === 'delivery');
  const totalPOAmount = poRows.reduce((sum, row) => sum + (parseFloat(row.total) || 0), 0);
  const outstandingDeliveries = poRows.filter(row => !['fully_delivered', 'closed'].includes(String(row.deliveryStatus || '').toLowerCase())).length;
  const rollup = {
    supplierId,
    supplierName: supplier.name || '',
    totalPurchaseOrders: poRows.length,
    totalPOAmount,
    totalDeliveries: deliveryRows.length,
    outstandingDeliveries,
    lastPODate: poRows.map(row => row.date).filter(Boolean).sort().pop() || '',
    lastDeliveryDate: deliveryRows.map(row => row.deliveryDate).filter(Boolean).sort().pop() || '',
    lastUpdatedAt: Date.now(),
    updatedBy: supplierUserId()
  };
  try {
    await firebase.database().ref(`supplierRollups/${supplierId}`).set(rollup);
  } catch (e) {
    try {
      await firebase.database().ref(`suppliers/${supplierId}/rollup`).set({
        ...rollup,
        globalPathDenied: true,
        fallbackPath: true
      });
      rollup.fallbackPath = `suppliers/${supplierId}/rollup`;
    } catch (fallbackError) {
      console.warn('supplier rollup write skipped:', fallbackError?.code || fallbackError?.message || fallbackError);
    }
  }
  return rollup;
}

async function createSupplier(data = {}) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Supplier name is required.');
  const now = Date.now();
  const ref = firebase.database().ref('suppliers').push();
  const payload = {
    name,
    contact: data.contact || '',
    specialty: data.specialty || '',
    bankName: data.bankName || '',
    accNum: data.accNum || '',
    accName: data.accName || '',
    notes: data.notes || '',
    status: SUPPLIER_STATUSES.active,
    addedAt: now,
    addedBy: supplierUserId(),
    addedByName: supplierUserName(),
    createdAt: now,
    createdBy: supplierUserId(),
    createdByName: supplierUserName(),
    updatedAt: now,
    updatedBy: supplierUserId(),
    statusHistory: {
      [`${now}_created`]: {
        fromStatus: '',
        toStatus: SUPPLIER_STATUSES.active,
        notes: data.notes || '',
        createdAt: now,
        createdBy: supplierUserId(),
        createdByName: supplierUserName()
      }
    }
  };
  await ref.set(payload);
  await createSupplierEvent({
    type: 'created',
    supplierId: ref.key,
    supplierName: name,
    createdAt: now,
    createdBy: supplierUserId(),
    createdByName: supplierUserName()
  }).catch(e => console.warn('supplier create event skipped:', e?.code || e?.message || e));
  await createSupplierNotificationEvent('supplier_created', {
    supplierId: ref.key,
    supplierName: name
  }).catch(e => console.warn('supplier create notification skipped:', e?.code || e?.message || e));
  await rebuildSupplierRollup(ref.key).catch(e => console.warn('supplier rollup rebuild skipped:', e?.code || e?.message || e));
  return { key: ref.key, ...payload };
}

async function updateSupplier(key, data = {}) {
  if (!key) throw new Error('Supplier ID is required.');
  const snap = await firebase.database().ref(`suppliers/${key}`).once('value');
  if (!snap.exists()) throw new Error('Supplier not found.');
  const now = Date.now();
  const updates = {
    ...data,
    updatedAt: now,
    updatedBy: supplierUserId(),
    updatedByName: supplierUserName(),
    [`statusHistory/${now}_updated`]: {
      fromStatus: supplierStatus(snap.val()),
      toStatus: supplierStatus(data.status ? data : snap.val()),
      notes: data.notes || 'Supplier updated',
      createdAt: now,
      createdBy: supplierUserId(),
      createdByName: supplierUserName()
    }
  };
  await firebase.database().ref(`suppliers/${key}`).update(updates);
  await createSupplierEvent({
    type: 'updated',
    supplierId: key,
    supplierName: data.name || '',
    createdAt: now
  }).catch(e => console.warn('supplier update event skipped:', e?.code || e?.message || e));
  await createSupplierNotificationEvent('supplier_updated', {
    supplierId: key,
    supplierName: data.name || (snap.val() || {}).name || ''
  }).catch(e => console.warn('supplier update notification skipped:', e?.code || e?.message || e));
  await rebuildSupplierRollup(key).catch(e => console.warn('supplier rollup rebuild skipped:', e?.code || e?.message || e));
  return true;
}

async function archiveSupplier(key, reason = '') {
  if (!key) throw new Error('Supplier ID is required.');
  if (!reason.trim()) throw new Error('Archive reason is required.');
  const snap = await firebase.database().ref(`suppliers/${key}`).once('value');
  if (!snap.exists()) throw new Error('Supplier not found.');
  const supplier = snap.val() || {};
  const now = Date.now();
  const updates = {};
  updates[`suppliers/${key}/status`] = SUPPLIER_STATUSES.archived;
  updates[`suppliers/${key}/archivedAt`] = now;
  updates[`suppliers/${key}/archivedBy`] = supplierUserId();
  updates[`suppliers/${key}/archivedByName`] = supplierUserName();
  updates[`suppliers/${key}/archiveReason`] = reason.trim();
  updates[`suppliers/${key}/updatedAt`] = now;
  updates[`suppliers/${key}/updatedBy`] = supplierUserId();
  updates[`suppliers/${key}/statusHistory/${now}_archived`] = {
    fromStatus: supplierStatus(supplier),
    toStatus: SUPPLIER_STATUSES.archived,
    notes: reason.trim(),
    createdAt: now,
    createdBy: supplierUserId(),
    createdByName: supplierUserName()
  };
  await firebase.database().ref().update(updates);
  await createSupplierEvent({
    type: 'archived',
    supplierId: key,
    supplierName: supplier.name || '',
    description: reason.trim(),
    createdAt: now,
    createdBy: supplierUserId(),
    createdByName: supplierUserName()
  }).catch(e => console.warn('supplier archive event skipped:', e?.code || e?.message || e));
  await createSupplierNotificationEvent('supplier_archived', {
    supplierId: key,
    supplierName: supplier.name || '',
    reason: reason.trim()
  }).catch(e => console.warn('supplier archive notification skipped:', e?.code || e?.message || e));
  await rebuildSupplierRollup(key).catch(e => console.warn('supplier rollup rebuild skipped:', e?.code || e?.message || e));
  return { key, ...supplier, status: SUPPLIER_STATUSES.archived };
}

function watchGlobalSuppliers() {
  _supListener = firebase.database().ref('suppliers');
  _supListener.on('value', snap => {
    const el = $('supplierList');
    if (!el) return;
    el.innerHTML = '';

    if (!snap.exists()) {
      el.innerHTML = '<p class="empty-hint">No suppliers yet. Add one above.</p>';
      refreshSupplierDropdown(snap);
      return;
    }

    const suppliers = supplierRows(snap);
    suppliers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const fragment = document.createDocumentFragment();
    suppliers.forEach(s => {
      const bankLine = (s.bankName || s.accNum)
        ? `<div class="supplier-bank">${escapeHtml(s.bankName || '')} ${s.accNum ? '\u00B7 Acct: ' + escapeHtml(s.accNum) : ''} ${s.accName ? '\u00B7 ' + escapeHtml(s.accName) : ''}</div>`
        : '';

      const card = document.createElement('div');
      card.className = 'supplier-card';
      card.setAttribute('data-name', escapeHtml([
        s.name, s.contact, s.specialty, s.bankName, s.accNum, s.accName
      ].filter(Boolean).join(' ').toLowerCase()));
      card.innerHTML = `
        <div class="supplier-info">
          <span class="supplier-name">${escapeHtml(s.name)}</span>
          ${s.specialty ? `<span class="supplier-specialty">${escapeHtml(s.specialty)}</span>` : ''}
          ${s.contact ? `<span class="supplier-contact">${escapeHtml(s.contact)}</span>` : ''}
          ${bankLine}
        </div>
        <div class="supplier-actions">
          <button class="btn-use-supplier" data-key="${s.key}" data-name="${escapeHtml(s.name).replace(/'/g, "\\'")}">Use in PO</button>
          <button class="btn-edit-supplier" aria-label="Edit ${escapeHtml(s.name)}" data-key="${s.key}">\u270E Edit</button>
          <button class="btn-del-supplier" aria-label="Delete ${escapeHtml(s.name)}" data-key="${s.key}" data-name="${escapeHtml(s.name).replace(/'/g, "\\'")}">\u2715</button>
        </div>
      `;

      card.querySelector('.btn-use-supplier').addEventListener('click', (e) => useSupplierInPO(e.target.dataset.name, e.target.dataset.key));
      card.querySelector('.btn-edit-supplier').addEventListener('click', (e) => openEditSupplier(e.target.dataset.key));
      card.querySelector('.btn-del-supplier').addEventListener('click', (e) => deleteSupplier(e.target.dataset.key, e.target.dataset.name));

      fragment.appendChild(card);
    });

    el.appendChild(fragment);
    refreshSupplierDropdown(snap);
  });
}

async function addSupplier() {
  if (!canManageSuppliers()) return;
  const name = $('supName')?.value.trim();
  const contact = $('supContact')?.value.trim() || '';
  const spec = $('supSpecialty')?.value.trim() || '';
  const bank = $('supBank')?.value.trim() || '';
  const accNum = $('supAccNum')?.value.trim() || '';
  const accName = $('supAccName')?.value.trim() || '';
  if (!name) { setFieldError($('supName'), 'Enter supplier name.'); return; }
  if (name.length > 50) { setFieldError($('supName'), 'Name too long (max 50).'); return; }

  // Check for duplicate
  const dupSnap = await firebase.database().ref('suppliers').orderByChild('name').equalTo(name).once('value');
  if (dupSnap.exists()) { showToast(`Supplier "${name}" already exists.`, 'error'); return; }

  const created = await safeDb(() => createSupplier({
    name, contact, specialty: spec, bankName: bank, accNum, accName
  }), 'Failed to add supplier');

  ['supName', 'supContact', 'supSpecialty', 'supBank', 'supAccNum', 'supAccName'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });
  auditLog('create', 'supplier', created.key, { name });
  showToast(`\u2705 ${name} added`);
}

function openEditSupplier(key) {
  if (!canManageSuppliers()) return;
  firebase.database().ref(`suppliers/${key}`).once('value', snap => {
    const s = snap.val() || {};
    $('editSupKey').value = key;
    $('editSupName').value = s.name || '';
    $('editSupContact').value = s.contact || '';
    $('editSupSpec').value = s.specialty || '';
    $('editSupBank').value = s.bankName || '';
    $('editSupAccNum').value = s.accNum || '';
    $('editSupAccName').value = s.accName || '';
    $('editSupplierModal').classList.remove('hidden');
  });
}

function closeEditSupplier() {
  $('editSupplierModal').classList.add('hidden');
}

async function saveEditSupplier() {
  if (!canManageSuppliers()) return;
  const key = $('editSupKey').value;
  const name = $('editSupName').value.trim();
  const contact = $('editSupContact').value.trim() || '';
  const spec = $('editSupSpec').value.trim() || '';
  const bank = $('editSupBank').value.trim() || '';
  const accNum = $('editSupAccNum').value.trim() || '';
  const accName = $('editSupAccName').value.trim() || '';
  if (!name) { setFieldError($('supName'), 'Name required.'); return; }
  if (name.length > 50) { setFieldError($('supName'), 'Name too long.'); return; }

  await safeDb(() => updateSupplier(key, {
    name, contact, specialty: spec, bankName: bank, accNum, accName
  }), 'Failed to update supplier');

  closeEditSupplier();
  auditLog('update', 'supplier', key, { name });
  showToast(`${name} updated \u2713`);
}

async function deleteSupplier(key, name) {
  if (!canManageSuppliers()) return;
  if (!confirm(`Archive supplier "${name}"? Historical POs and deliveries will remain linked.`)) return;
  const reason = prompt('Reason for archiving this supplier:');
  if (!reason || !reason.trim()) {
    showToast('Archive cancelled. A reason is required.', 'warn');
    return;
  }
  await safeDb(() => archiveSupplier(key, reason.trim()), 'Failed to archive supplier');
  auditLog('archive', 'supplier', key, { name, reason: reason.trim() });
  showToast(`${name} archived`, 'warn');
}

function useSupplierInPO(name, key = '') {
  switchTab('materials');
  const inp = $('poSupplier');
  const idInput = $('poSupplierId');
  if (idInput) idInput.value = key || '';
  if (inp) { inp.value = name; inp.focus(); }
  showToast(`${name} selected for PO`);
}

function filterSuppliers(query) {
  const cards = document.querySelectorAll('.supplier-card');
  const q = query.toLowerCase().trim();
  cards.forEach(card => {
    const name = card.getAttribute('data-name') || '';
    card.style.display = name.includes(q) ? 'flex' : 'none';
  });
}

async function exportSuppliersCSV() {
  const suppliers = await listSuppliers({ includeArchived: true });
  if (!suppliers.length) { showToast('No suppliers to export.', 'warn'); return; }

  let csv = 'Name,Status,Contact,Specialty,Bank Name,Account Number,Account Name,Archived At,Archive Reason\n';
  suppliers.forEach(s => {
    csv += `${escapeCsv(s.name || '')},${escapeCsv(s.status || 'active')},${escapeCsv(s.contact || '')},${escapeCsv(s.specialty || '')},${escapeCsv(s.bankName || '')},${escapeCsv(s.accNum || '')},${escapeCsv(s.accName || '')},${s.archivedAt || ''},${escapeCsv(s.archiveReason || '')}\n`;
  });

  downloadTextFile(`Suppliers_${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv');
  showToast('Suppliers exported!');
}

// ── Expose to global scope ────────────────────────────────────
window.initSuppliers = initSuppliers;
window.detachSupplierListeners = detachSupplierListeners;
window.createSupplier = createSupplier;
window.updateSupplier = updateSupplier;
window.archiveSupplier = archiveSupplier;
window.listSuppliers = listSuppliers;
window.listSupplierTransactions = listSupplierTransactions;
window.rebuildSupplierRollup = rebuildSupplierRollup;
window.createSupplierEvent = createSupplierEvent;
window.addSupplier = addSupplier;
window.openEditSupplier = openEditSupplier;
window.closeEditSupplier = closeEditSupplier;
window.saveEditSupplier = saveEditSupplier;
window.deleteSupplier = deleteSupplier;
window.useSupplierInPO = useSupplierInPO;
window.filterSuppliers = filterSuppliers;
window.exportSuppliersCSV = exportSuppliersCSV;
