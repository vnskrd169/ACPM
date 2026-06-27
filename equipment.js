//  ACPM — equipment.js
//  Equipment rental tracking, maintenance schedules, fuel logs
//  Tracks costs per project to avoid budget surprises
// ════════════════════════════════════════════════════════════

let _epid = null;
let _equipListeners = [];

function canTouchEquipmentProject() {
  return typeof requireEdit === 'function'
    ? requireEdit(_epid)
    : !!_epid && typeof canEditProject === 'function' && canEditProject(_epid);
}

function initEquipment(pid) {
  _epid = pid;
  detachEquipListeners();
  watchEquipment(pid);
  watchEquipSummary(pid);
}

function detachEquipListeners() {
  _equipListeners.forEach(ref => ref.off());
  _equipListeners = [];
}

function equipListen(ref, cb) {
  ref.on('value', cb);
  _equipListeners.push(ref);
}

// ══════════════════════════════════════════════════════
//  WATCH + RENDER
// ══════════════════════════════════════════════════════
function watchEquipment(pid) {
  const ref = firebase.database().ref(`projects/${pid}/equipment`);
  equipListen(ref, snap => {
    const container = $('equipmentList');
    if (!container) return;
    container.innerHTML = '';

    if (!snap.exists()) {
      container.innerHTML = '<p class="empty-hint">No equipment tracked yet.</p>';
      return;
    }

    const items = [];
    snap.forEach(c => {
      items.push({ id: c.key, ...c.val() });
    });
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const fragment = document.createDocumentFragment();
    items.forEach(item => {
      const isOverdue = item.nextService && new Date(item.nextService) < new Date();
      const statusColor = item.status === 'active' ? 'var(--green)' :
                          item.status === 'rented' ? 'var(--blue)' :
                          item.status === 'maintenance' ? 'var(--amber)' : 'var(--red)';

      const card = document.createElement('div');
      card.className = `equip-card ${isOverdue ? 'equip-overdue' : ''}`;
      card.innerHTML = `
        <div class="equip-hdr">
          <div>
            <span class="equip-name">${escapeHtml(item.name)}</span>
            <span class="equip-type">${escapeHtml(item.type || 'Equipment')}</span>
          </div>
          <span class="equip-status" style="color:${statusColor};border-color:${statusColor}">${item.status || 'active'}</span>
        </div>
        <div class="equip-details">
          <div class="equip-detail">
            <span class="equip-label">Rental Rate</span>
            <span class="equip-val">${peso(item.rentalRate || 0)}/${item.rateUnit || 'day'}</span>
          </div>
          <div class="equip-detail">
            <span class="equip-label">Total Cost</span>
            <span class="equip-val">${peso(item.totalCost || 0)}</span>
          </div>
          <div class="equip-detail">
            <span class="equip-label">Hours Used</span>
            <span class="equip-val">${item.hoursUsed || 0}h</span>
          </div>
          <div class="equip-detail">
            <span class="equip-label">Next Service</span>
            <span class="equip-val ${isOverdue ? 'overdue' : ''}">${item.nextService || 'N/A'}</span>
          </div>
        </div>
        ${item.notes ? `<div class="equip-notes">${escapeHtml(item.notes)}</div>` : ''}
        <div class="equip-actions">
          <button class="btn-equip-action" onclick="logEquipHours('${item.id}')">\u23F1 Log Hours</button>
          <button class="btn-equip-action" onclick="logEquipExpense('${item.id}')">\u1F4B0 Log Expense</button>
          <button class="btn-equip-action" onclick="scheduleEquipService('${item.id}')">\u2699 Service</button>
          <button class="del-item-btn" onclick="deleteEquipment('${item.id}')">\u2715</button>
        </div>
      `;
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  });
}

function watchEquipSummary(pid) {
  const ref = firebase.database().ref(`projects/${pid}/equipment`);
  equipListen(ref, snap => {
    let totalCost = 0, activeCount = 0, maintenanceCount = 0, overdueCount = 0;
    const now = new Date();
    snap.forEach(c => {
      const item = c.val();
      totalCost += parseFloat(item.totalCost) || 0;
      if (item.status === 'active') activeCount++;
      if (item.status === 'maintenance') maintenanceCount++;
      if (item.nextService && new Date(item.nextService) < now) overdueCount++;
    });

    setText('equipTotalCost', peso(totalCost));
    setText('equipActive', activeCount);
    setText('equipMaint', maintenanceCount);
    setText('equipOverdue', overdueCount);
  });
}

// ══════════════════════════════════════════════════════
//  ADD / MANAGE EQUIPMENT
// ══════════════════════════════════════════════════════
async function addEquipment() {
  if (!_epid) return;
  if (!canTouchEquipmentProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const name = $('equipName')?.value.trim();
  const type = $('equipType')?.value || 'other';
  const rentalRate = parseFloat($('equipRate')?.value) || 0;
  const rateUnit = $('equipRateUnit')?.value || 'day';
  const notes = $('equipNotes')?.value.trim() || '';

  if (!name) { showToast('Enter equipment name.', 'error'); return; }

  await safeDb(() => firebase.database().ref(`projects/${_epid}/equipment`).push({
    name, type, rentalRate, rateUnit, notes,
    status: 'active', totalCost: 0, hoursUsed: 0,
    createdAt: Date.now(), createdBy: window._currentUser?.uid || 'system'
  }), 'Failed to add equipment');

  ['equipName', 'equipRate', 'equipNotes'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });
  if ($('equipType')) $('equipType').value = 'other';

  auditLog('create', 'equipment', null, { name, type, projectId: _epid });
  showToast(`Equipment "${name}" added`);
}

async function logEquipHours(equipId) {
  if (!_epid) return;
  if (!canTouchEquipmentProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const hours = prompt('Hours used:');
  if (hours === null) return;
  const h = parseFloat(hours);
  if (isNaN(h) || h <= 0) { showToast('Enter valid hours.', 'error'); return; }

  const snap = await firebase.database().ref(`projects/${_epid}/equipment/${equipId}`).once('value');
  const item = snap.val();
  if (!item) return;

  const newHours = (item.hoursUsed || 0) + h;
  const rate = parseFloat(item.rentalRate) || 0;
  const newCost = (item.totalCost || 0) + (rate * h);

  await safeDb(() => firebase.database().ref(`projects/${_epid}/equipment/${equipId}`).update({
    hoursUsed: newHours, totalCost: newCost,
    updatedAt: Date.now(), updatedBy: window._currentUser?.uid || 'system'
  }), 'Failed to log hours');

  auditLog('update', 'equipment', equipId, { hoursAdded: h, projectId: _epid });
  showToast(`${h}h logged for ${item.name}`);
}

async function logEquipExpense(equipId) {
  if (!_epid) return;
  if (!canTouchEquipmentProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const amount = prompt('Expense amount (₱):');
  if (amount === null) return;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) { showToast('Enter valid amount.', 'error'); return; }

  const snap = await firebase.database().ref(`projects/${_epid}/equipment/${equipId}`).once('value');
  const item = snap.val();
  if (!item) return;

  const newCost = (item.totalCost || 0) + amt;
  await safeDb(() => firebase.database().ref(`projects/${_epid}/equipment/${equipId}`).update({
    totalCost: newCost,
    updatedAt: Date.now(), updatedBy: window._currentUser?.uid || 'system'
  }), 'Failed to log expense');

  // Also log in project expenses
  await safeDb(() => firebase.database().ref(`projects/${_epid}/expenses`).push({
    date: todayISO(),
    category: 'equipment',
    description: `${item.name} - expense`,
    amount: amt,
    equipmentId: equipId,
    createdAt: Date.now(), createdBy: window._currentUser?.uid || 'system'
  }), 'Failed to log expense');

  auditLog('update', 'equipment', equipId, { expense: amt, projectId: _epid });
  showToast(`Expense ${peso(amt)} logged for ${item.name}`);
}

async function scheduleEquipService(equipId) {
  if (!_epid) return;
  if (!canTouchEquipmentProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const nextService = prompt('Next service date (YYYY-MM-DD):');
  if (!nextService) return;

  await safeDb(() => firebase.database().ref(`projects/${_epid}/equipment/${equipId}`).update({
    nextService, status: 'maintenance',
    updatedAt: Date.now(), updatedBy: window._currentUser?.uid || 'system'
  }), 'Failed to schedule service');

  auditLog('update', 'equipment', equipId, { nextService, projectId: _epid });
  showToast('Service scheduled');
}

async function deleteEquipment(equipId) {
  if (!_epid) return;
  if (!canTouchEquipmentProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Delete this equipment record?\n\nThis cannot be undone.')) return;
  const confirmText = prompt('Type DELETE EQUIPMENT to confirm permanent deletion:');
  if (confirmText !== 'DELETE EQUIPMENT') {
    showToast('Deletion cancelled.', 'warn');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_epid}/equipment/${equipId}`).remove(), 'Failed to delete');
  auditLog('delete', 'equipment', equipId, { projectId: _epid });
  showToast('Equipment deleted', 'warn');
}

// ── Expose ──────────────────────────────────────────────────
window.initEquipment = initEquipment;
window.detachEquipListeners = detachEquipListeners;
window.addEquipment = addEquipment;
window.logEquipHours = logEquipHours;
window.logEquipExpense = logEquipExpense;
window.scheduleEquipService = scheduleEquipService;
window.deleteEquipment = deleteEquipment;
