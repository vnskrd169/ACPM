let _lpid = null;
let _laborListeners = [];
let _payrollConfig = { type: 'weekly', startDay: 1, overtimeThreshold: 8, nightDiffRate: 1.1, govDeductionsEnabled: false, sssEmployerPct: 8.5, philhealthPct: 3, pagibigEmployerAmt: 100 };
let _pendingPayrollData = null;
let _workersRegistered = false;
let _projectName = '';
let _projectSettings = { leader: '', payMethod: 'Bank' };
let _tradeMetaByName = {};
let _activeWeekKey = '';
let _compiledWeekKeys = new Set();
let _workersSnap = null;
let _attendanceSnap = null;
let _advancesSnap = null;

function getWeekKey(start = $('weekStart')?.value, end = $('weekEnd')?.value) {
  return start && end ? `${start}_${end}` : '';
}

function normalizeTradeName(name) {
  return String(name || 'Unassigned').trim() || 'Unassigned';
}

function getTradeMeta(trade) {
  const key = normalizeTradeName(trade).toLowerCase();
  const meta = _tradeMetaByName[key] || {};
  return {
    foremanName: meta.foremanName || _projectSettings.leader || '',
    paymentMethod: meta.paymentMethod || _projectSettings.payMethod || 'Bank',
    notes: meta.notes || ''
  };
}

function canTouchLaborProject() {
  return typeof requireEdit === 'function'
    ? requireEdit(_lpid)
    : !!_lpid && typeof canEditProject === 'function' && canEditProject(_lpid);
}

const ATTENDANCE_STATUS = {
  present:  { label: 'Present',    multiplier: 1.0, hours: 8 },
  half:     { label: 'Half Day',   multiplier: 0.5, hours: 4 },
  absent:   { label: 'Absent',     multiplier: 0,   hours: 0 },
  leave:    { label: 'Paid Leave', multiplier: 1.0, hours: 8 },
  rest:     { label: 'Rest Day',   multiplier: 0,   hours: 0 },
  holiday:  { label: 'Holiday',    multiplier: 2.0, hours: 8 }
};

function initLabor(pid) {
  _lpid = pid;
  _projectName = '';
  _workersRegistered = false;
  _pendingPayrollData = null;
  _tradeMetaByName = {};
  _compiledWeekKeys = new Set();
  _workersSnap = null;
  _attendanceSnap = null;
  _advancesSnap = null;
  detachLaborListeners();
  loadPayrollConfig(pid);
  loadProjectSettings(pid);
  watchLaborBudget(pid);
  watchTrades(pid);
  watchPayrollLogs(pid);
  watchTimecardHistory(pid);
  watchAdvances(pid);

  // Fetch the human-readable project name (used in RFP, exports, etc.)
  firebase.database().ref(`projects/${pid}/name`).once('value', snap => {
    _projectName = snap.val() || pid;
  });

  // Set default week range
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const ws = $('weekStart');
  const we = $('weekEnd');
  if (ws && !ws.value) ws.value = monday.toISOString().slice(0, 10);
  if (we && !we.value) we.value = sunday.toISOString().slice(0, 10);
  _activeWeekKey = getWeekKey();
  renderPeriodIndicator();
}

// ══════════════════════════════════════════════════════
//  PROJECT SETTINGS (RFP leader / payment method)
// ══════════════════════════════════════════════════════
function loadProjectSettings(pid) {
  firebase.database().ref(`projects/${pid}/settings`).once('value', snap => {
    const data = snap.val() || {};
    _projectSettings = { leader: data.leader || '', payMethod: data.payMethod || 'Bank' };
  });
}

async function saveTradeSettings(tradeKey) {
  if (!_lpid) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const foremanName = $(`tradeForeman_${tradeKey}`)?.value.trim() || '';
  const paymentMethod = $(`tradePayment_${tradeKey}`)?.value || 'Bank';
  const notes = $(`tradeNotes_${tradeKey}`)?.value.trim() || '';
  await safeDb(() => firebase.database().ref(`projects/${_lpid}/trades/${tradeKey}`).update({
    foremanName,
    paymentMethod,
    notes,
    settingsUpdatedAt: Date.now(),
    settingsUpdatedBy: window._currentUser?.uid || null
  }), 'Failed to save trade settings');
  showToast('Trade RFP settings saved');
}

function detachLaborListeners() {
  _laborListeners.forEach(ref => ref.off());
  _laborListeners = [];
  if (_tcHistoryListener) {
    _tcHistoryListener.off();
    _tcHistoryListener = null;
  }
  _workersSnap = null;
  _attendanceSnap = null;
  _advancesSnap = null;
}

function laborListen(ref, cb) {
  ref.on('value', cb);
  _laborListeners.push(ref);
}

// ── Payroll Config ──────────────────────────────────────────
function loadPayrollConfig(pid) {
  firebase.database().ref(`projects/${pid}/payrollConfig`).once('value', snap => {
    if (snap.exists()) {
      _payrollConfig = { ..._payrollConfig, ...snap.val() };
    }
    // Update UI
    const cycleEl = $('payrollCycle');
    const otEl = $('otThreshold');
    const nightEl = $('nightDiffRate');
    const govEl = $('govDeductionsEnabled');
    const sssEl = $('sssEmployerPct');
    const philEl = $('philhealthPct');
    const pagiEl = $('pagibigEmployerAmt');

    if (cycleEl) cycleEl.value = _payrollConfig.type;
    if (otEl) otEl.value = _payrollConfig.overtimeThreshold;
    if (nightEl) nightEl.value = _payrollConfig.nightDiffRate;
    if (govEl) govEl.checked = !!_payrollConfig.govDeductionsEnabled;
    if (sssEl) sssEl.value = _payrollConfig.sssEmployerPct || 8.5;
    if (philEl) philEl.value = _payrollConfig.philhealthPct || 3;
    if (pagiEl) pagiEl.value = _payrollConfig.pagibigEmployerAmt || 100;

    // Toggle gov deductions config visibility
    const govConfig = $('govDeductionsConfig');
    if (govConfig) govConfig.classList.toggle('hidden', !_payrollConfig.govDeductionsEnabled);
  });
}

async function savePayrollConfig() {
  if (!_lpid) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const govEnabled = $('govDeductionsEnabled')?.checked || false;
  const config = {
    type: $('payrollCycle')?.value || 'weekly',
    overtimeThreshold: parseFloat($('otThreshold')?.value) || 8,
    nightDiffRate: parseFloat($('nightDiffRate')?.value) || 1.1,
    govDeductionsEnabled: govEnabled,
    sssEmployerPct: parseFloat($('sssEmployerPct')?.value) || 8.5,
    philhealthPct: parseFloat($('philhealthPct')?.value) || 3,
    pagibigEmployerAmt: parseFloat($('pagibigEmployerAmt')?.value) || 100
  };

  // Toggle visibility of gov deductions config
  const govConfig = $('govDeductionsConfig');
  if (govConfig) govConfig.classList.toggle('hidden', !govEnabled);

  await safeDb(() => firebase.database().ref(`projects/${_lpid}/payrollConfig`).set(config), 'Failed to save config');
  _payrollConfig = config;
  showToast('Payroll settings saved');
}

// ── Budget KPIs ─────────────────────────────────────────────
function watchLaborBudget(pid) {
  const ref = firebase.database().ref(`projects/${pid}`);
  laborListen(ref, snap => {
    const d = snap.val() || {};
    const budget = (parseFloat(d.laborBudget) || 0) + (parseFloat(d.laborBudgetDelta) || 0);
    const spent = parseFloat(d.laborSpent) || 0;
    const left = budget - spent;
    const p = pct(spent, budget);
    setText('lbBudget', peso(budget));
    setText('lbSpent', peso(spent));
    const el = $('lbLeft');
    if (el) { el.textContent = peso(left); el.className = `kpi-num ${left < 0 ? 'kpi-danger' : 'kpi-safe'}`; }
    const wb = $('laborBudgetWarn');
    if (wb) {
      wb.classList.toggle('hidden', p < 80);
      wb.className = `budget-warn-bar ${p >= 95 ? 'warn-critical' : 'warn-high'} ${p < 80 ? 'hidden' : ''}`;
      wb.textContent = p >= 95
        ? `\u26A0\uFE0F CRITICAL \u2014 Labor budget ${p}% used! Only ${peso(left)} remaining.`
        : `\u26A0\uFE0F WARNING \u2014 Labor budget ${p}% used. ${peso(left)} remaining.`;
    }
  });
}

// ══════════════════════════════════════════════════════
//  TRADES
// ══════════════════════════════════════════════════════
let _tradesSnap = null;

function watchTrades(pid) {
  const ref = firebase.database().ref(`projects/${pid}/trades`);
  laborListen(ref, snap => {
    _tradesSnap = snap;
    renderTradeChips(snap);
    populateTradeSelect(snap);
    // Attach worker listeners only once
    if (!_workersRegistered) {
      _workersRegistered = true;
      watchWorkers(pid);
    }
  });
}

function renderTradeChips(snap) {
  const el = $('tradeList'); if (!el) return;
  el.innerHTML = '';
  _tradeMetaByName = {};
  if (!snap.exists()) { el.innerHTML = '<p class="empty-hint">No trades yet.</p>'; return; }
  snap.forEach(c => {
    const t = c.val();
    const tradeName = normalizeTradeName(t.name);
    _tradeMetaByName[tradeName.toLowerCase()] = {
      id: c.key,
      name: tradeName,
      foremanName: t.foremanName || _projectSettings.leader || '',
      paymentMethod: t.paymentMethod || _projectSettings.payMethod || 'Bank',
      notes: t.notes || ''
    };
    const chip = document.createElement('div');
    chip.className = 'trade-chip trade-scope-card';
    chip.innerHTML = `
      <div class="trade-scope-top">
        <span class="trade-chip-name">${escapeHtml(tradeName)}</span>
        <span class="trade-scope-actions">
          <button class="chip-edit" aria-label="Rename trade" data-action="rename" data-key="${c.key}" data-name="${escapeHtml(tradeName)}">\u270E</button>
          <button class="chip-del" aria-label="Delete trade" data-action="delete" data-key="${c.key}" data-name="${escapeHtml(tradeName)}">\u2715</button>
        </span>
      </div>
      <div class="trade-scope-grid">
        <input id="tradeForeman_${c.key}" type="text" placeholder="Foreman / leader" value="${escapeHtml(t.foremanName || _projectSettings.leader || '')}">
        <select id="tradePayment_${c.key}">
          ${['Bank', 'GCash', 'Cash', 'Check', 'Others'].map(pm => `<option value="${pm}" ${(t.paymentMethod || _projectSettings.payMethod || 'Bank') === pm ? 'selected' : ''}>${pm === 'Bank' ? 'Bank Transfer' : pm}</option>`).join('')}
        </select>
        <input id="tradeNotes_${c.key}" type="text" placeholder="Notes optional" value="${escapeHtml(t.notes || '')}">
        <button class="btn-scope-save" data-action="settings" data-key="${c.key}">Save</button>
      </div>`;

    // Delegated events instead of inline onclick
    chip.querySelector('[data-action="rename"]').addEventListener('click', (e) => {
      renameTrade(e.target.dataset.key, e.target.dataset.name);
    });
    chip.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      deleteTrade(e.target.dataset.key, e.target.dataset.name);
    });
    chip.querySelector('[data-action="settings"]').addEventListener('click', (e) => {
      saveTradeSettings(e.target.dataset.key);
    });

    el.appendChild(chip);
  });
}

async function addTrade() {
  const inp = $('newTradeName');
  const name = inp?.value.trim();
  if (!name || !_lpid) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (name.length > 30) { showToast('Trade name too long (max 30).', 'error'); return; }

  // Check for duplicate trade name
  const snap = await firebase.database().ref(`projects/${_lpid}/trades`).orderByChild('name').equalTo(name).once('value');
  if (snap.exists()) { showToast(`Trade "${name}" already exists.`, 'error'); return; }

  await safeDb(() => firebase.database().ref(`projects/${_lpid}/trades`).push({
    name,
    foremanName: '',
    paymentMethod: _projectSettings.payMethod || 'Bank',
    notes: '',
    createdAt: Date.now()
  }), 'Failed to add trade');
  inp.value = '';
  auditLog('create', 'trade', null, { name, projectId: _lpid });
  showToast(`Trade "${name}" added`);
}

async function renameTrade(key, old) {
  const n = prompt(`Rename "${old}":`, old);
  if (!n || !n.trim() || n === old || !_lpid) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (n.trim().length > 30) { showToast('Name too long.', 'error'); return; }
  await safeDb(() => firebase.database().ref(`projects/${_lpid}/trades/${key}`).update({ name: n.trim() }), 'Failed to rename');
  auditLog('update', 'trade', key, { oldName: old, newName: n.trim() });
  showToast(`Trade renamed to "${n.trim()}"`);
}

async function deleteTrade(key, name) {
  if (!_lpid) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm(`Delete trade "${name}"?\n\nWorkers with this trade will keep it.`)) return;
  await safeDb(() => firebase.database().ref(`projects/${_lpid}/trades/${key}`).remove(), 'Failed to delete trade');
  auditLog('delete', 'trade', key, { name });
  showToast(`Trade "${name}" deleted`, 'warn');
}

function populateTradeSelect(snap) {
  const sel = $('workerTradeSelect'); if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">\u2014 Select Trade \u2014</option>';
  snap?.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.val().name;
    opt.textContent = c.val().name;
    sel.appendChild(opt);
  });
  sel.value = prev;
}

// ══════════════════════════════════════════════════════
//  WORKERS
// ══════════════════════════════════════════════════════

function watchWorkers(pid) {
  const wRef = firebase.database().ref(`projects/${pid}/workers`);
  laborListen(wRef, wSnap => {
    _workersSnap = wSnap;
    renderLaborWorkspaceViews();
  });

  const attRef = firebase.database().ref(`projects/${pid}/attendance`);
  laborListen(attRef, attSnap => {
    _attendanceSnap = attSnap;
    renderLaborWorkspaceViews();
  });
}

function renderLaborWorkspaceViews() {
  if (!_lpid || !_workersSnap) return;
  if (_advancesSnap) renderRoster(_workersSnap, _lpid, _advancesSnap);
  if (_attendanceSnap) buildGrid(_lpid, _workersSnap, _attendanceSnap);
}

function renderRoster(wSnap, pid, allAdvSnap) {
  const el = $('rosterList'); if (!el) return;
  el.innerHTML = '';
  if (!wSnap.exists()) { el.innerHTML = '<p class="empty-hint">No workers yet.</p>'; return; }

  wSnap.forEach(c => {
    const w = c.val();
    const wid = c.key;

    let pending = 0;
    const workerAdv = allAdvSnap?.child?.(wid);
    if (workerAdv?.exists()) {
      workerAdv.forEach(a => {
        pending += cashAdvanceActiveOutstanding(a.val());
      });
    }

    const div = document.createElement('div');
    div.className = 'roster-row';
    div.id = `roster_${wid}`;
    div.innerHTML = `<div class="roster-info">
      <span class="roster-name">${escapeHtml(w.name)}</span>
      <div class="roster-info-row">
        <span class="roster-trade-tag">${escapeHtml(w.trade || 'No Trade')}</span>
        <span class="adv-badge-wrap">${pending > 0 ? `<span class="adv-badge">\u20B1${pending.toLocaleString()} advance</span>` : ''}</span>
      </div>
    </div>
    <span class="roster-rate">${peso(w.dailyRate)}/day</span>
    <button class="btn-advance" data-action="advance" data-wid="${wid}" data-name="${escapeHtml(w.name)}">\u20B1 Advance</button>
    <button class="del-worker" aria-label="Remove worker" data-action="remove" data-wid="${wid}">\u2715</button>`;

    div.querySelector('[data-action="advance"]').addEventListener('click', (e) => {
      openAdvanceModal(e.target.dataset.wid, e.target.dataset.name);
    });
    div.querySelector('[data-action="remove"]').addEventListener('click', (e) => {
      removeWorker(e.target.dataset.wid);
    });

    el.appendChild(div);
  });
}

async function addWorker() {
  if (!_lpid) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const name = $('workerName')?.value.trim();
  const trade = $('workerTradeSelect')?.value;
  const rate = parseFloat($('workerRate')?.value) || 0;
  if (!name) { showToast('Enter worker name.', 'error'); return; }
  if (!trade) { showToast('Select a trade.', 'error'); return; }
  if (rate <= 0) { showToast('Enter daily rate.', 'error'); return; }
  if (name.length > 50) { showToast('Name too long (max 50).', 'error'); return; }

  // Check for duplicate worker name
  const dupSnap = await firebase.database().ref(`projects/${_lpid}/workers`).orderByChild('name').equalTo(name).once('value');
  if (dupSnap.exists()) { showToast(`Worker "${name}" already exists.`, 'error'); return; }

  // Validate daily rate is reasonable (not extreme)
  if (rate > 50000) {
    if (!confirm(`Daily rate ${peso(rate)} seems very high. Continue?`)) return;
  }

  const workerData = { name, trade, dailyRate: rate, addedAt: Date.now(), addedBy: window._currentUser.uid };
  await safeDb(() => firebase.database().ref(`projects/${_lpid}/workers`).push(workerData), 'Failed to add worker');
  $('workerName').value = ''; $('workerRate').value = '';
  auditLog('create', 'worker', null, { name, trade, rate, projectId: _lpid });
  showToast(`${name} added to roster`);
}

async function removeWorker(wid) {
  if (!_lpid) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Remove this worker and ALL their attendance and advance records?\n\nThis cannot be undone.')) return;
  const confirmText = prompt('Type REMOVE WORKER to confirm permanent removal:');
  if (confirmText !== 'REMOVE WORKER') {
    showToast('Removal cancelled.', 'warn');
    return;
  }

  // Atomic multi-path delete
  const attSnap = await firebase.database().ref(`projects/${_lpid}/attendance/${wid}`).once('value');
  const advSnap = await firebase.database().ref(`projects/${_lpid}/advances/${wid}`).once('value');
  const updates = {};
  updates[`projects/${_lpid}/workers/${wid}`] = null;
  attSnap.forEach(c => {
    updates[`projects/${_lpid}/attendance/${wid}/${c.key}`] = null;
  });
  advSnap.forEach(c => {
    updates[`projects/${_lpid}/advances/${wid}/${c.key}`] = null;
  });

  await safeDb(() => firebase.database().ref().update(updates), 'Failed to remove worker');
  auditLog('delete', 'worker', wid, { projectId: _lpid });
  showToast('Worker removed');
}

// ══════════════════════════════════════════════════════
//  CASH ADVANCES
// ══════════════════════════════════════════════════════
let _advWid = null, _advName = '';

const CASH_ADVANCE_STATUSES = {
  draft: 'Draft',
  submitted: 'Submitted',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  released: 'Released',
  deducted: 'Deducted',
  closed: 'Closed'
};

function currentLaborUserLabel() {
  return window._currentUser?.name || window._currentUser?.displayName || window._currentUser?.email || 'Staff';
}

function canApproveCashAdvance() {
  const role = String(window._currentUser?.role || '').toLowerCase();
  return role === 'boss';
}

function normalizeAdvanceStatus(a = {}) {
  if (a.status) return a.status;
  if (a.deducted) return 'closed';
  return 'released';
}

function cashAdvanceOutstanding(a = {}) {
  return Math.max(0, (parseFloat(a.amount) || 0) - (parseFloat(a.deductedAmount) || 0));
}

function cashAdvancePayrollEligible(a = {}) {
  const status = normalizeAdvanceStatus(a);
  return ['released', 'deducted'].includes(status) && cashAdvanceOutstanding(a) > 0;
}

function cashAdvanceActiveOutstanding(a = {}) {
  const status = normalizeAdvanceStatus(a);
  if (['rejected', 'closed'].includes(status)) return 0;
  return cashAdvanceOutstanding(a);
}

function cashAdvanceStatusLabel(a = {}) {
  return CASH_ADVANCE_STATUSES[normalizeAdvanceStatus(a)] || 'Pending Approval';
}

function cashAdvanceStatusClass(a = {}) {
  const status = normalizeAdvanceStatus(a);
  return ['released', 'deducted', 'closed'].includes(status) ? 'adv-deducted' : 'adv-pending';
}

async function createCashAdvanceEvent(pid, wid, advanceId, type, details = {}) {
  if (!pid || !wid || !advanceId) return null;
  const ref = firebase.database().ref(`projects/${pid}/cashAdvanceEvents`).push();
  const payload = {
    type,
    workerId: wid,
    advanceId,
    status: details.status || '',
    notes: details.notes || '',
    amount: parseFloat(details.amount) || 0,
    createdAt: Date.now(),
    createdBy: window._currentUser?.uid || 'unknown',
    createdByName: currentLaborUserLabel()
  };
  try {
    await safeDb(() => ref.set(payload), 'Failed to write cash advance event');
  } catch (error) {
    console.warn('Cash advance event hook failed; primary workflow already continues.', error);
    return null;
  }
  return { id: ref.key, ...payload };
}

async function createLaborNotificationEvent(pid, type, payload = {}) {
  if (!pid) return null;
  const ref = firebase.database().ref(`projects/${pid}/notificationEvents`).push();
  const event = {
    module: 'labor',
    type,
    status: 'pending',
    consumed: false,
    payload,
    createdAt: Date.now(),
    createdBy: window._currentUser?.uid || null,
    createdByName: currentLaborUserLabel()
  };
  try {
    await safeDb(() => ref.set(event), 'Failed to write notification event');
  } catch (error) {
    console.warn('Labor notification hook failed; primary workflow already continues.', error);
    return null;
  }
  return { id: ref.key, ...event };
}

async function updateCashAdvanceStatus(wid, key, nextStatus, notes = '') {
  if (!_lpid || !wid || !key) throw new Error('Missing cash advance reference.');
  if (!CASH_ADVANCE_STATUSES[nextStatus]) throw new Error('Invalid cash advance status.');
  if (['approved', 'rejected', 'released', 'closed'].includes(nextStatus) && !canApproveCashAdvance()) {
    throw new Error('Only Admin/Boss/Project Manager can approve, reject, release, or close cash advances.');
  }
  const snap = await firebase.database().ref(`projects/${_lpid}/advances/${wid}/${key}`).once('value');
  if (!snap.exists()) throw new Error('Cash advance not found.');
  const advance = snap.val() || {};
  const now = Date.now();
  const eventKey = firebase.database().ref().push().key;
  const updates = {};
  updates[`projects/${_lpid}/advances/${wid}/${key}/status`] = nextStatus;
  updates[`projects/${_lpid}/advances/${wid}/${key}/statusUpdatedAt`] = now;
  updates[`projects/${_lpid}/advances/${wid}/${key}/statusUpdatedBy`] = window._currentUser?.uid || null;
  updates[`projects/${_lpid}/advances/${wid}/${key}/statusUpdatedByName`] = currentLaborUserLabel();
  updates[`projects/${_lpid}/advances/${wid}/${key}/statusHistory/${eventKey}`] = {
    status: nextStatus,
    notes,
    at: now,
    by: window._currentUser?.uid || null,
    byName: currentLaborUserLabel()
  };
  if (nextStatus === 'approved') {
    updates[`projects/${_lpid}/advances/${wid}/${key}/approvedAt`] = now;
    updates[`projects/${_lpid}/advances/${wid}/${key}/approvedBy`] = window._currentUser?.uid || null;
    updates[`projects/${_lpid}/advances/${wid}/${key}/approvedByName`] = currentLaborUserLabel();
  }
  if (nextStatus === 'rejected') {
    updates[`projects/${_lpid}/advances/${wid}/${key}/rejectedAt`] = now;
    updates[`projects/${_lpid}/advances/${wid}/${key}/rejectedBy`] = window._currentUser?.uid || null;
    updates[`projects/${_lpid}/advances/${wid}/${key}/rejectedByName`] = currentLaborUserLabel();
    updates[`projects/${_lpid}/advances/${wid}/${key}/rejectionNotes`] = notes;
  }
  if (nextStatus === 'released') {
    updates[`projects/${_lpid}/advances/${wid}/${key}/releasedAt`] = now;
    updates[`projects/${_lpid}/advances/${wid}/${key}/releasedBy`] = window._currentUser?.uid || null;
    updates[`projects/${_lpid}/advances/${wid}/${key}/releasedByName`] = currentLaborUserLabel();
  }
  if (nextStatus === 'closed') {
    updates[`projects/${_lpid}/advances/${wid}/${key}/closedAt`] = now;
    updates[`projects/${_lpid}/advances/${wid}/${key}/closedBy`] = window._currentUser?.uid || null;
    updates[`projects/${_lpid}/advances/${wid}/${key}/closedByName`] = currentLaborUserLabel();
    updates[`projects/${_lpid}/advances/${wid}/${key}/closeNotes`] = notes;
  }

  await safeDb(() => firebase.database().ref().update(updates), 'Failed to update cash advance status');
  await createCashAdvanceEvent(_lpid, wid, key, `cash_advance_${nextStatus}`, {
    status: nextStatus,
    notes,
    amount: advance.amount || 0
  });
  await createLaborNotificationEvent(_lpid, `cash_advance_${nextStatus}`, {
    workerId: wid,
    advanceId: key,
    status: nextStatus,
    amount: advance.amount || 0,
    workerName: advance.workerName || _advName || wid
  });
  return { id: key, ...advance, status: nextStatus };
}

function openAdvanceModal(wid, name) {
  _advWid = wid; _advName = name;
  const nameEl = $('advanceWorkerName');
  if (nameEl) nameEl.textContent = name;
  const dateEl = $('advanceDate');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
  loadAdvanceHistory(wid);
  $('advanceModal').classList.remove('hidden');
}

function closeAdvanceModal() { $('advanceModal').classList.add('hidden'); }

function loadAdvanceHistory(wid) {
  const el = $('advanceHistory'); if (!el) return;
  firebase.database().ref(`projects/${_lpid}/advances/${wid}`).once('value', snap => {
    el.innerHTML = '';
    let total = 0;
    if (!snap.exists()) {
      el.innerHTML = '<p class="empty-hint">No advances yet.</p>';
      setText('advanceTotalLabel', peso(0)); return;
    }
    snap.forEach(c => {
      const a = c.val();
      total += cashAdvanceActiveOutstanding(a);
      const row = document.createElement('div');
      row.className = 'advance-row';
      const status = normalizeAdvanceStatus(a);
      const actions = [];
      if (canApproveCashAdvance() && ['draft', 'submitted', 'pending_approval'].includes(status)) {
        actions.push(`<button class="btn-mini" data-adv-action="approved" data-key="${c.key}">Approve</button>`);
        actions.push(`<button class="btn-mini" data-adv-action="rejected" data-key="${c.key}">Reject</button>`);
      }
      if (canApproveCashAdvance() && status === 'approved') {
        actions.push(`<button class="btn-mini" data-adv-action="released" data-key="${c.key}">Release</button>`);
      }
      if (canApproveCashAdvance() && !['rejected', 'closed'].includes(status)) {
        actions.push(`<button class="del-advance" data-adv-action="closed" data-key="${c.key}">Close</button>`);
      }
      row.innerHTML = `<span class="advance-date">${a.date}</span>
        <span class="advance-amt">${peso(a.amount)}</span>
        ${a.notes ? `<span class="advance-note">${escapeHtml(a.notes)}</span>` : ''}
        <span class="advance-status ${cashAdvanceStatusClass(a)}">${cashAdvanceStatusLabel(a)}</span>
        <span class="advance-actions">${actions.join(' ')}</span>`;

      row.querySelectorAll('[data-adv-action]').forEach(btn => {
        btn.addEventListener('click', () => handleAdvanceStatusAction(wid, btn.dataset.key, btn.dataset.advAction));
      });
      el.appendChild(row);
    });
    setText('advanceTotalLabel', peso(total));
  });
}

async function saveAdvance() {
  if (!_lpid || !_advWid) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const date = $('advanceDate')?.value;
  const amount = parseFloat($('advanceAmount')?.value) || 0;
  const notes = $('advanceNotes')?.value.trim() || '';
  if (!date) { showToast('Enter date.', 'error'); return; }
  if (amount <= 0) { showToast('Enter amount.', 'error'); return; }
  if (notes.length > 200) { showToast('Notes too long (max 200).', 'error'); return; }

  // Validate date not in future
  const inputDate = new Date(date + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  if (inputDate > today) { showToast('Date cannot be in the future.', 'error'); return; }

  // Resolve worker name + trade so the transaction log is self-describing
  const wSnap = await firebase.database().ref(`projects/${_lpid}/workers/${_advWid}`).once('value');
  const w = wSnap.val() || {};
  const workerName = w.name || _advName || _advWid;
  const trade = w.trade || '';

  const advRef = firebase.database().ref(`projects/${_lpid}/advances/${_advWid}`).push();
  const advanceId = advRef.key;
  const now = Date.now();
  const advancePayload = {
    date, amount, notes,
    weekKey: getWeekKey(),
    workerName, trade,
    status: 'pending_approval',
    requestedBy: currentLaborUserLabel(),
    requestedByUid: window._currentUser?.uid || null,
    requestedAt: now,
    submittedAt: now,
    pendingApprovalAt: now,
    statusHistory: {
      requested: {
        status: 'pending_approval',
        notes: 'Cash advance submitted for approval.',
        at: now,
        by: window._currentUser?.uid || null,
        byName: currentLaborUserLabel()
      }
    },
    recordedBy: window._currentUser?.displayName || window._currentUser?.email || 'Staff',
    recordedByUid: window._currentUser?.uid || null,
    deducted: false, deductedAmount: 0,
    addedAt: now, addedBy: window._currentUser.uid
  };
  await safeDb(() => advRef.set(advancePayload), 'Failed to save advance');

  $('advanceDate').value = ''; $('advanceAmount').value = ''; $('advanceNotes').value = '';
  loadAdvanceHistory(_advWid);
  auditLog('create', 'advance', null, { workerId: _advWid, amount, projectId: _lpid });
  await createCashAdvanceEvent(_lpid, _advWid, advanceId, 'cash_advance_pending_approval', {
    status: 'pending_approval',
    notes,
    amount
  });
  await createLaborNotificationEvent(_lpid, 'cash_advance_pending_approval', {
    workerId: _advWid,
    advanceId,
    workerName,
    amount,
    trade
  });
  showToast(`Advance request of ${peso(amount)} submitted for ${workerName}`);
}

async function handleAdvanceStatusAction(wid, key, action) {
  if (!_lpid) return;
  if (!canApproveCashAdvance()) {
    showToast('Only Admin/Boss/Project Manager can approve or release advances.', 'error');
    return;
  }
  const label = CASH_ADVANCE_STATUSES[action] || action;
  let notes = '';
  if (['rejected', 'closed'].includes(action)) {
    notes = prompt(`Notes for ${label}:`) || '';
    if (!notes.trim()) {
      showToast('Action cancelled. Notes are required.', 'warn');
      return;
    }
  } else if (!confirm(`Mark this cash advance as ${label}?`)) {
    return;
  }
  try {
    await updateCashAdvanceStatus(wid, key, action, notes.trim());
    loadAdvanceHistory(wid);
    renderAdvanceLog();
    auditLog('update', 'advance', key, { workerId: wid, status: action, projectId: _lpid });
    showToast(`Cash advance marked ${label}`);
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Failed to update cash advance.', 'error');
  }
}

// ── Centralized Cash Advance Transaction Log (all workers) ──────
function watchAdvances(pid) {
  const ref = firebase.database().ref(`projects/${pid}/advances`);
  laborListen(ref, snap => {
    _advancesSnap = snap;
    renderLaborWorkspaceViews();
    renderAdvanceLog();
  });
}

function renderAdvanceLog() {
  const el = $('advanceLogContent'); if (!el || !_lpid) return;
  const ws = $('weekStart')?.value;
  const we = $('weekEnd')?.value;

  if (_workersSnap && _advancesSnap) {
    renderAdvanceLogFromSnapshots(el, _workersSnap, _advancesSnap, ws, we);
    return;
  }

  firebase.database().ref(`projects/${_lpid}/workers`).once('value', wSnap => {
    firebase.database().ref(`projects/${_lpid}/advances`).once('value', advSnap => {
      renderAdvanceLogFromSnapshots(el, wSnap, advSnap, ws, we);
    });
  });
}

function renderAdvanceLogFromSnapshots(el, wSnap, advSnap, ws, we) {
  const workers = {};
  wSnap.forEach(c => {
    workers[c.key] = c.val();
  });

  const rows = [];
  advSnap.forEach(workerAdv => {
    const wid = workerAdv.key;
    const w = workers[wid] || {};
    workerAdv.forEach(entrySnap => {
      const a = entrySnap.val();
      rows.push({
        key: entrySnap.key, wid,
        workerName: a.workerName || w.name || wid,
        trade: a.trade || w.trade || '',
        date: a.date,
        amount: a.amount || 0,
        notes: a.notes || '',
        deducted: !!a.deducted,
        deductedAmount: a.deductedAmount || 0,
        recordedBy: a.recordedBy || '',
        addedAt: a.addedAt || 0,
        status: normalizeAdvanceStatus(a)
      });
    });
  });

  const filtered = (ws && we)
    ? rows.filter(r => r.date >= ws && r.date <= we)
    : rows;

  filtered.sort((a, b) => (b.addedAt || b.date || '').toString().localeCompare((a.addedAt || a.date || '').toString()));

  if (!filtered.length) {
    el.innerHTML = `<p class="empty-hint">${(ws && we) ? 'No advances in the selected period.' : 'No advance records yet.'}</p>`;
    return;
  }

  const totalOut = filtered.reduce((s, r) => s + cashAdvanceActiveOutstanding(r), 0);
  const totalDeducted = filtered.reduce((s, r) => s + r.deductedAmount, 0);

  el.innerHTML = `<div style="overflow-x:auto">
    <table class="advance-log-table">
      <thead><tr>
        <th class="al-worker">Worker</th>
        <th class="al-trade">Trade</th>
        <th class="al-date">Date</th>
        <th class="al-amount" style="text-align:right">Amount</th>
        <th class="al-notes">Notes</th>
        <th class="al-status">Status</th>
        <th class="al-by">Recorded By</th>
      </tr></thead>
      <tbody>
        ${filtered.map(r => `<tr>
          <td class="al-worker">${escapeHtml(r.workerName)}</td>
          <td class="al-trade">${escapeHtml(r.trade || '\u2014')}</td>
          <td class="al-date">${r.date || '\u2014'}</td>
          <td class="al-amount" style="text-align:right">${peso(r.amount)}</td>
          <td class="al-notes">${escapeHtml(r.notes) || '\u2014'}</td>
          <td class="al-status ${cashAdvanceStatusClass(r)}">${cashAdvanceStatusLabel(r)}</td>
          <td class="al-by">${escapeHtml(r.recordedBy) || '\u2014'}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <td colspan="3" style="font-weight:600">Period Totals</td>
        <td class="al-amount" style="text-align:right;font-weight:600">${peso(filtered.reduce((s, r) => s + r.amount, 0))}</td>
        <td colspan="2" style="font-size:11px;color:var(--muted)">Outstanding: ${peso(totalOut)} \u00B7 Deducted: ${peso(totalDeducted)}</td>
        <td></td>
      </tr></tfoot>
    </table>
  </div>`;
}

async function deleteAdvance(wid, key) {
  if (!_lpid) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Close this advance record?\n\nThe history will remain in Firebase and it will no longer be deducted.')) return;
  const notes = prompt('Reason for closing this advance:') || '';
  if (!notes.trim()) {
    showToast('Close cancelled. Notes are required.', 'warn');
    return;
  }
  await updateCashAdvanceStatus(wid, key, 'closed', notes.trim());
  if (_advWid === wid) loadAdvanceHistory(wid);
  renderAdvanceLog();
  auditLog('close', 'advance', key, { workerId: wid, projectId: _lpid });
}

// ══════════════════════════════════════════════════════
//  TIMECARD GRID
// ══════════════════════════════════════════════════════
function buildGrid(pid, wSnap, attSnap) {
  const container = $('timecardGrid'); if (!container) return;
  const days = getWeekDays();

  const attendance = {};
  attSnap?.forEach(workerAtt => {
    const wid = workerAtt.key;
    attendance[wid] = {};
    workerAtt.forEach(daySnap => {
      attendance[wid][daySnap.key] = daySnap.val();
    });
  });

  const byTrade = {};
  wSnap.forEach(c => {
    const w = { id: c.key, ...c.val() };
    if (!byTrade[w.trade]) byTrade[w.trade] = [];
    byTrade[w.trade].push(w);
  });

  if (!wSnap.exists()) {
    container.innerHTML = '<p class="empty-hint" style="padding:20px">Add workers to the roster first.</p>';
    updateAttendanceSummary({});
    return;
  }

  const dayHdrs = days.map(d =>
    `<th class="g-day-hdr">${d.short}<br><span class="g-day-date">${d.num}</span></th>`
  ).join('');

  let html = '';
  const summaryData = {};

  Object.entries(byTrade).forEach(([trade, workers]) => {
    let tradeTotal = 0;
    const rows = workers.map(w => {
      let sub = 0, daysPresent = 0, daysHalf = 0, daysHoliday = 0, otHours = 0;

      const cells = days.map(d => {
        const att = attendance[w.id]?.[d.iso] || { status: 'absent', overtimeHours: 0, nightDiffHours: 0 };
        const status = att.status || 'absent';
        const config = ATTENDANCE_STATUS[status] || ATTENDANCE_STATUS.absent;

        if (status === 'present' || status === 'leave') daysPresent++;
        if (status === 'half') daysHalf++;
        if (status === 'holiday') daysHoliday++;
        otHours += att.overtimeHours || 0;

        const pay = calculateGrossPay(w.dailyRate, att);
        sub += pay.total;

        const statusOptions = Object.entries(ATTENDANCE_STATUS).map(([key, val]) =>
          `<option value="${key}" ${status === key ? 'selected' : ''}>${val.label}</option>`
        ).join('');

        return `<td class="g-cell">
          <select class="attendance-sel status-${status}" data-wid="${w.id}" data-date="${d.iso}" onchange="handleAttendanceChange(this)">
            ${statusOptions}
          </select>
          <input type="number" class="ot-input" placeholder="OT" value="${att.overtimeHours || ''}"
            onchange="updateAttendanceOT('${w.id}','${d.iso}',this.value)" title="Overtime hours">
        </td>`;
      }).join('');

      tradeTotal += sub;
      summaryData[w.id] = { name: w.name, trade, rate: w.dailyRate, days: daysPresent + daysHalf * 0.5 + daysHoliday, sub, otHours };

      return `<tr class="g-row">
        <td class="g-name">${escapeHtml(w.name)}</td>
        <td class="g-rate">${peso(w.dailyRate)}</td>
        ${cells}
        <td class="g-sub">${peso(sub)}</td>
      </tr>`;
    }).join('');

    html += `<div class="trade-block">
      <div class="trade-hdr">
        <span class="trade-hdr-name">${escapeHtml(trade)}</span>
        <span class="trade-hdr-total">${peso(tradeTotal)}</span>
      </div>
      <div class="grid-scroll">
        <table class="g-table">
          <thead><tr>
            <th class="g-hdr-name">Worker</th>
            <th class="g-hdr-rate">Rate/Day</th>
            ${dayHdrs}
            <th class="g-hdr-sub">Subtotal</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  });

  container.innerHTML = html;
  updateAttendanceSummary(summaryData);
}

// ── Handle attendance dropdown change with proper class update ──
function handleAttendanceChange(selectEl) {
  const wid = selectEl.dataset.wid;
  const iso = selectEl.dataset.date;
  const status = selectEl.value;

  // Update visual class
  selectEl.className = `attendance-sel status-${status}`;

  // Save to Firebase
  markAttendance(wid, iso, status, 0, 0, '');
}

// ── Calculate Gross Pay with OT & Night Diff ───────────────
function calculateGrossPay(rate, att) {
  const status = att.status || 'absent';
  const config = ATTENDANCE_STATUS[status] || ATTENDANCE_STATUS.absent;
  const regularPay = rate * config.multiplier;
  const otPay = (rate / 8 * 1.25) * (att.overtimeHours || 0);
  const nightDiffPay = (rate / 8 * 0.1) * (att.nightDiffHours || 0);
  return { regularPay, otPay, nightDiffPay, total: regularPay + otPay + nightDiffPay };
}

async function markAttendance(wid, iso, status, overtimeHours = 0, nightDiffHours = 0, notes = '') {
  if (!_lpid) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }

  // Validate date is not in the future
  const inputDate = new Date(iso + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (inputDate > today) { showToast('Cannot mark attendance for future dates.', 'error'); return; }
  const weekKey = getWeekKey();
  if (_compiledWeekKeys.has(weekKey) && !confirm('This week is already compiled. Edit archived attendance anyway?')) return;

  const config = ATTENDANCE_STATUS[status] || ATTENDANCE_STATUS.present;

  await safeDb(() => firebase.database().ref(`projects/${_lpid}/attendance/${wid}/${iso}`).set({
    workerId: wid, date: iso, status,
    weekKey,
    regularHours: config.hours,
    overtimeHours: parseFloat(overtimeHours) || 0,
    nightDiffHours: parseFloat(nightDiffHours) || 0,
    paidHours: config.hours + (parseFloat(overtimeHours) || 0) + (parseFloat(nightDiffHours) || 0),
    multiplier: config.multiplier,
    notes,
    markedAt: Date.now(),
    markedBy: window._currentUser.uid
  }), 'Failed to save attendance');
}

async function updateAttendanceOT(wid, iso, otHours) {
  if (!_lpid) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const weekKey = getWeekKey();
  if (_compiledWeekKeys.has(weekKey) && !confirm('This week is already compiled. Edit archived OT anyway?')) return;
  await safeDb(() => firebase.database().ref(`projects/${_lpid}/attendance/${wid}/${iso}`).update({
    overtimeHours: parseFloat(otHours) || 0,
    weekKey,
    updatedAt: Date.now()
  }), 'Failed to update OT');
}

function getWeekDays() {
  const s = $('weekStart')?.value;
  const e = $('weekEnd')?.value;
  const days = [];
  const start = s ? new Date(s + 'T12:00:00') : (() => {
    const t = new Date();
    t.setHours(12, 0, 0, 0);
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    return t;
  })();
  const end = e ? new Date(e + 'T12:00:00') : new Date(start.getTime() + 6 * 86400000);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    days.push({
      iso,
      short: d.toLocaleDateString('en-PH', { weekday: 'short' }),
      num: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
    });
  }
  return days;
}

function setWeekInputsFromKey(weekKey) {
  if (!weekKey || !weekKey.includes('_')) return;
  const [start, end] = weekKey.split('_');
  if ($('weekStart')) $('weekStart').value = start;
  if ($('weekEnd')) $('weekEnd').value = end;
}

function handleWeekRangeChange() {
  const nextKey = getWeekKey();
  if (!_activeWeekKey || nextKey === _activeWeekKey) return;
  const ok = confirm('Changing week will reset unsaved attendance for this period. Continue?');
  if (!ok) {
    setWeekInputsFromKey(_activeWeekKey);
    return;
  }
  applyWeek({ weekChanged: true });
}

function applyWeek(options = {}) {
  if (!_lpid) return;
  const ws = $('weekStart')?.value;
  const we = $('weekEnd')?.value;
  if (ws && we && new Date(ws) > new Date(we)) {
    showToast('Week start must be before week end.', 'error');
    return;
  }
  _activeWeekKey = getWeekKey(ws, we);
  renderPeriodIndicator();
  firebase.database().ref(`projects/${_lpid}/workers`).once('value', wSnap => {
    firebase.database().ref(`projects/${_lpid}/attendance`).once('value', attSnap => {
      buildGrid(_lpid, wSnap, attSnap);
      renderAdvanceLog();
      if (options.weekChanged) loadCompiledWeekNotice(_activeWeekKey);
    });
  });
}

async function loadCompiledWeekNotice(weekKey) {
  if (!_lpid || !weekKey) return;
  const snap = await firebase.database().ref(`projects/${_lpid}/payrollLogs`).orderByChild('weekKey').equalTo(weekKey).once('value');
  if (snap.exists()) {
    showToast('This week already has a compiled payroll archive. Review Payroll Logs before editing.', 'warn');
  }
}

async function resetCurrentAttendance() {
  if (!_lpid) return;
  if (!canTouchLaborProject()) return;
  const days = getWeekDays();
  if (!days.length) return;
  if (_compiledWeekKeys.has(getWeekKey()) && !confirm('This week is already compiled. Reset archived attendance anyway?')) return;
  if (!confirm('Reset attendance for the selected week only? This will clear the current sheet dates, not other weeks.')) return;
  const wSnap = await firebase.database().ref(`projects/${_lpid}/workers`).once('value');
  const updates = {};
  wSnap.forEach(c => {
    days.forEach(d => {
      updates[`projects/${_lpid}/attendance/${c.key}/${d.iso}`] = null;
    });
  });
  await safeDb(() => firebase.database().ref().update(updates), 'Failed to reset attendance');
  auditLog('reset', 'attendance', getWeekKey(), { projectId: _lpid });
  showToast('Attendance reset for selected week.');
  applyWeek();
}

// ── Period indicator badge under the timecard grid ──────────────
function renderPeriodIndicator() {
  const el = $('periodIndicator'); if (!el) return;
  const ws = $('weekStart')?.value;
  const we = $('weekEnd')?.value;
  if (!ws || !we) { el.innerHTML = ''; return; }
  const fmt = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  const dayCount = Math.round((new Date(we + 'T12:00:00') - new Date(ws + 'T12:00:00')) / 86400000) + 1;
  el.innerHTML = `<div class="period-indicator">
    <span class="period-indicator-badge">\u1F4C5 ${fmt(ws)} \u2014 ${fmt(we)}</span>
    <span class="period-indicator-range">${dayCount} day${dayCount === 1 ? '' : 's'} selected</span>
  </div>`;
}

function updateAttendanceSummary(data) {
  const el = $('attendanceSummary'); if (!el) return;
  const entries = Object.values(data);
  if (!entries.length) { el.innerHTML = '<p class="empty-hint">No attendance data yet.</p>'; return; }
  const grand = entries.reduce((s, w) => s + w.sub, 0);
  el.innerHTML = `<div style="overflow-x:auto"><table class="summary-table">
    <thead><tr>
      <th>Worker</th><th>Trade</th><th>Rate/Day</th><th style="text-align:center">Days</th><th style="text-align:center">OT Hrs</th><th style="text-align:right">Subtotal</th>
    </tr></thead>
    <tbody>
      ${entries.map(w => `<tr class="s-row">
        <td class="s-cell">${escapeHtml(w.name)}</td>
        <td class="s-cell s-trade">${escapeHtml(w.trade)}</td>
        <td class="s-cell">${peso(w.rate)}</td>
        <td class="s-cell s-center">${w.days}</td>
        <td class="s-cell s-center">${w.otHours}</td>
        <td class="s-cell s-right s-bold">${peso(w.sub)}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr class="s-total-row">
      <td class="s-cell" colspan="5">GROSS THIS PERIOD</td>
      <td class="s-cell s-right s-bold">${peso(grand)}</td>
    </tr></tfoot>
  </table></div>`;
}

// ══════════════════════════════════════════════════════
//  COMPILE PAYROLL (with Government Deductions)
// ══════════════════════════════════════════════════════
async function compilePayroll() {
  if (!_lpid) return;
  if (!canTouchLaborProject()) return;
  const start = $('weekStart')?.value || '\u2014';
  const end = $('weekEnd')?.value || '\u2014';

  const [wSnap, attSnap, advSnap, projSnap] = await Promise.all([
    firebase.database().ref(`projects/${_lpid}/workers`).once('value'),
    firebase.database().ref(`projects/${_lpid}/attendance`).once('value'),
    firebase.database().ref(`projects/${_lpid}/advances`).once('value'),
    firebase.database().ref(`projects/${_lpid}`).once('value')
  ]);

  const days = getWeekDays();
  const weekSet = new Set(days.map(d => d.iso));

  const workers = {};
  wSnap.forEach(c => {
    workers[c.key] = c.val();
  });

  const weekKey = getWeekKey(start, end);
  const byTrade = {};
  let grandRegular = 0, grandOT = 0, grandNight = 0, grandGross = 0;
  const attendanceToArchive = [];
  const workerPayroll = {};

  attSnap.forEach(workerAtt => {
    const wid = workerAtt.key;
    const w = workers[wid];
    if (!w) return;

    let workerRegular = 0, workerOT = 0, workerNight = 0, workerDays = 0;

    workerAtt.forEach(daySnap => {
      const att = daySnap.val();
      if (!weekSet.has(att.date)) return;

      const pay = calculateGrossPay(w.dailyRate, att);
      workerRegular += pay.regularPay;
      workerOT += pay.otPay;
      workerNight += pay.nightDiffPay;
      if (att.status === 'half') workerDays += 0.5;
      else if (att.status !== 'absent' && att.status !== 'rest') workerDays++;

      attendanceToArchive.push({
        ...att,
        weekKey,
        workerName: w.name,
        trade: w.trade || 'Unassigned',
        dailyRate: w.dailyRate || 0,
        foremanName: getTradeMeta(w.trade).foremanName,
        compiledAt: Date.now()
      });
    });

    const workerGross = workerRegular + workerOT + workerNight;
    grandRegular += workerRegular;
    grandOT += workerOT;
    grandNight += workerNight;
    grandGross += workerGross;

    const tradeName = normalizeTradeName(w.trade);
    if (!byTrade[tradeName]) {
      const tradeMeta = getTradeMeta(tradeName);
      byTrade[tradeName] = {
        trade: tradeName,
        foremanName: tradeMeta.foremanName,
        paymentMethod: tradeMeta.paymentMethod,
        notes: tradeMeta.notes,
        workers: {},
        total: 0,
        regular: 0,
        ot: 0,
        night: 0,
        cashAdvanceDeductions: 0,
        net: 0
      };
    }

    byTrade[tradeName].workers[wid] = {
      name: w.name, trade: tradeName, foremanName: byTrade[tradeName].foremanName, rate: w.dailyRate, days: workerDays,
      regular: workerRegular, ot: workerOT, night: workerNight, gross: workerGross
    };
    byTrade[tradeName].total += workerGross;
    byTrade[tradeName].regular += workerRegular;
    byTrade[tradeName].ot += workerOT;
    byTrade[tradeName].night += workerNight;

    workerPayroll[wid] = { gross: workerGross, regular: workerRegular, ot: workerOT, night: workerNight, name: w.name, trade: tradeName, foremanName: byTrade[tradeName].foremanName, rate: w.dailyRate, days: workerDays };
  });

  if (!grandGross) { showToast('No attendance marked for this week.', 'warn'); return; }

  // Process advances with SMART amortization
  const pendingAdvances = {};
  let totalPending = 0;
  advSnap?.forEach(workerAdv => {
    const wid = workerAdv.key;
    const wname = workers[wid]?.name || wid;
    const workerGross = workerPayroll[wid]?.gross || 0;

    workerAdv.forEach(advEntry => {
      const a = advEntry.val();
      if (a.deducted) return;
      if (!cashAdvancePayrollEligible(a)) return;
      if (a.date && end !== '\u2014' && a.date > end) return;

      const advanceTrade = normalizeTradeName(a.trade || workers[wid]?.trade);
      const remaining = a.amount - (a.deductedAmount || 0);
      const maxDeduct = Math.min(workerGross * 0.2, remaining);
      const deductThisPayroll = maxDeduct > 0 ? maxDeduct : 0;
      if (deductThisPayroll <= 0) return;

      if (!pendingAdvances[wid]) pendingAdvances[wid] = {
        name: wname,
        trade: workers[wid]?.trade || '',
        foremanName: getTradeMeta(workers[wid]?.trade).foremanName,
        advances: [],
        totalDeduct: 0
      };
      pendingAdvances[wid].advances.push({
        key: advEntry.key,
        ...a,
        trade: advanceTrade,
        deductThisPayroll,
        remainingAfter: remaining - deductThisPayroll
      });
      pendingAdvances[wid].totalDeduct += deductThisPayroll;
      totalPending += deductThisPayroll;
      const deductionTrade = byTrade[advanceTrade] ? advanceTrade : normalizeTradeName(workers[wid]?.trade);
      if (byTrade[deductionTrade]) {
        byTrade[deductionTrade].cashAdvanceDeductions += deductThisPayroll;
      }
    });
  });

  Object.values(byTrade).forEach(group => {
    group.net = group.total - group.cashAdvanceDeductions;
  });

  // Government deductions calculation
  let sssEmployerTotal = 0, philhealthEmployerTotal = 0, pagibigEmployerTotal = 0;
  const govEnabled = _payrollConfig.govDeductionsEnabled;

  if (govEnabled) {
    const sssRate = (_payrollConfig.sssEmployerPct || 8.5) / 100;
    const philRate = (_payrollConfig.philhealthPct || 3) / 100;
    const pagibigAmt = _payrollConfig.pagibigEmployerAmt || 100;

    Object.values(workerPayroll).forEach(wp => {
      if (wp.gross > 0) {
        sssEmployerTotal += wp.gross * sssRate;
        philhealthEmployerTotal += wp.gross * philRate;
        pagibigEmployerTotal += pagibigAmt;
      }
    });
  }

  _pendingPayrollData = {
    start, end, weekKey,
    grandRegular, grandOT, grandNight, grandGross,
    byTrade, pendingAdvances, totalPending,
    prevSpent: parseFloat(projSnap.val()?.laborSpent) || 0,
    attendanceToArchive,
    workerPayroll,
    govEnabled,
    sssEmployerTotal,
    philhealthEmployerTotal,
    pagibigEmployerTotal,
    employerTotalCost: grandGross + sssEmployerTotal + philhealthEmployerTotal + pagibigEmployerTotal
  };

  showPayrollModal();
}

function showPayrollModal() {
  const d = _pendingPayrollData; if (!d) return;

  setText('payrollRegular', peso(d.grandRegular));
  setText('payrollOT', peso(d.grandOT));
  setText('payrollNight', peso(d.grandNight));
  setText('payrollGross', peso(d.grandGross));

  const periodEl = $('payrollPeriod');
  if (periodEl) periodEl.textContent = `${d.start} \u2013 ${d.end}`;
  setText('totalAdvances', peso(d.totalPending));
  const tradeSummary = $('payrollTradeSummary');
  if (tradeSummary) {
    tradeSummary.innerHTML = Object.entries(d.byTrade).sort().map(([trade, group]) => `
      <div class="payroll-trade-summary-row">
        <span>
          <strong>${escapeHtml(trade)}</strong>
          ${group.foremanName ? `<small>${escapeHtml(group.foremanName)}</small>` : ''}
        </span>
        <span>${peso(group.net || group.total || 0)}</span>
      </div>
    `).join('');
  }

  // Government deductions display
  const govDisplay = $('govDeductionsDisplay');
  if (govDisplay) {
    govDisplay.classList.toggle('hidden', !d.govEnabled);
    if (d.govEnabled) {
      setText('sssEmployerDisplay', peso(d.sssEmployerTotal));
      setText('philhealthEmployerDisplay', peso(d.philhealthEmployerTotal));
      setText('pagibigEmployerDisplay', peso(d.pagibigEmployerTotal));
    }
  }

  // Employer total cost
  const costDisplay = $('employerCostDisplay');
  if (costDisplay) {
    costDisplay.textContent = `Employer Total Cost: ${peso(d.employerTotalCost)}`;
    costDisplay.classList.toggle('hidden', !d.govEnabled);
  }

  const advList = $('advanceDeductList');
  if (advList) {
    advList.innerHTML = d.totalPending <= 0
      ? '<p class="empty-hint" style="padding:4px 0">No pending advances.</p>'
      : Object.entries(d.byTrade).filter(([, group]) => group.cashAdvanceDeductions > 0).map(([trade, group]) => {
          const workerRows = Object.entries(d.pendingAdvances)
            .filter(([, w]) => normalizeTradeName(w.trade) === trade)
            .map(([, w]) => `<div class="adv-deduct-row">
              <span class="adv-deduct-name">${escapeHtml(w.name)}</span>
              <span class="adv-deduct-detail">
                ${w.advances.map(a => `${peso(a.deductThisPayroll)} now · ${peso(a.remainingAfter)} remaining`).join(' · ')}
              </span>
            </div>`).join('');
          return `<div class="adv-deduct-group">
            <div class="adv-deduct-group-title">${escapeHtml(trade)}${group.foremanName ? ` · ${escapeHtml(group.foremanName)}` : ''}<span>${peso(group.cashAdvanceDeductions)}</span></div>
            ${workerRows}
          </div>`;
        }).join('');
  }

  $('manualDeductInput').value = '';
  updatePayrollNet();
  $('payrollModal').classList.remove('hidden');
}

function updatePayrollNet() {
  if (!_pendingPayrollData) return;
  const deduct = parseFloat($('manualDeductInput')?.value) || 0;
  const net = _pendingPayrollData.grandGross - _pendingPayrollData.totalPending - deduct;
  const netEl = $('payrollNet');
  if (netEl) {
    netEl.textContent = peso(net);
    netEl.style.color = net < 0 ? 'var(--red)' : 'var(--green)';
  }
}

function closePayrollModal() { $('payrollModal').classList.add('hidden'); }

async function confirmSavePayroll() {
  const d = _pendingPayrollData; if (!d) return;
  if (!canTouchLaborProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const manualDeduct = parseFloat($('manualDeductInput')?.value) || 0;
  const net = d.grandGross - d.totalPending - manualDeduct;

  if (net < 0) { showToast('Net payroll cannot be negative.', 'error'); return; }

  const logKey = firebase.database().ref().push().key;
  const updates = {};
  const existingWeek = await firebase.database().ref(`projects/${_lpid}/payrollLogs`).orderByChild('weekKey').equalTo(d.weekKey).once('value');
  if (existingWeek.exists() && !confirm('This week already has a payroll log. Save another compiled record for the same week?')) return;

  // Archive attendance
  updates[`projects/${_lpid}/attendanceHistory/${logKey}`] = {
    period: `${d.start}\u2013${d.end}`,
    projectId: _lpid,
    weekStart: d.start,
    weekEnd: d.end,
    weekKey: d.weekKey,
    savedAt: Date.now(),
    entries: d.attendanceToArchive,
    compiledBy: window._currentUser.uid
  };

  // Save payroll log with gov deductions
  const logData = {
    projectId: _lpid,
    weekStart: d.start,
    weekEnd: d.end,
    weekKey: d.weekKey,
    period: `${d.start}\u2013${d.end}`,
    gross: d.grandGross,
    regular: d.grandRegular,
    ot: d.grandOT,
    nightDiff: d.grandNight,
    cashAdvanceDeductions: d.totalPending,
    otherDeductions: manualDeduct,
    deductions: d.totalPending + manualDeduct,
    net,
    byTrade: d.byTrade,
    workerDetails: d.workerPayroll,
    attendance: d.attendanceToArchive,
    cashAdvancesDeducted: d.pendingAdvances,
    savedAt: Date.now(),
    savedDate: new Date().toLocaleDateString('en-PH'),
    savedBy: window._currentUser.uid,
    status: 'finalized'
  };

  // Add government deductions to log if enabled
  if (d.govEnabled) {
    logData.govDeductions = {
      sssEmployer: d.sssEmployerTotal,
      philhealthEmployer: d.philhealthEmployerTotal,
      pagibigEmployer: d.pagibigEmployerTotal,
      employerTotalCost: d.employerTotalCost
    };
  }

  updates[`projects/${_lpid}/payrollLogs/${logKey}`] = logData;
  updates[`projects/${_lpid}/laborSpent`] = d.prevSpent + net;

  // Update advances with amortization
  if (d.totalPending > 0) {
    for (const [wid, wAdv] of Object.entries(d.pendingAdvances)) {
      for (const adv of wAdv.advances) {
        const newDeducted = (adv.deductedAmount || 0) + adv.deductThisPayroll;
        const isFullyPaid = newDeducted >= adv.amount;
        const nextStatus = isFullyPaid ? 'closed' : 'deducted';
        const statusEventKey = firebase.database().ref().push().key;
        updates[`projects/${_lpid}/advances/${wid}/${adv.key}/deductedAmount`] = newDeducted;
        updates[`projects/${_lpid}/advances/${wid}/${adv.key}/deducted`] = isFullyPaid;
        updates[`projects/${_lpid}/advances/${wid}/${adv.key}/lastDeductedAt`] = Date.now();
        updates[`projects/${_lpid}/advances/${wid}/${adv.key}/status`] = nextStatus;
        updates[`projects/${_lpid}/advances/${wid}/${adv.key}/statusUpdatedAt`] = Date.now();
        updates[`projects/${_lpid}/advances/${wid}/${adv.key}/statusUpdatedBy`] = window._currentUser?.uid || null;
        updates[`projects/${_lpid}/advances/${wid}/${adv.key}/statusHistory/${statusEventKey}`] = {
          status: nextStatus,
          notes: `Payroll deduction ${peso(adv.deductThisPayroll)} applied for ${d.weekKey}.`,
          payrollLogId: logKey,
          at: Date.now(),
          by: window._currentUser?.uid || null,
          byName: currentLaborUserLabel()
        };
        const advanceEventKey = firebase.database().ref().push().key;
        const notificationEventKey = firebase.database().ref().push().key;
        updates[`projects/${_lpid}/cashAdvanceEvents/${advanceEventKey}`] = {
          type: 'cash_advance_payroll_deducted',
          workerId: wid,
          advanceId: adv.key,
          status: nextStatus,
          amount: adv.deductThisPayroll,
          notes: `Payroll deduction applied for ${d.weekKey}.`,
          payrollLogId: logKey,
          createdAt: Date.now(),
          createdBy: window._currentUser?.uid || 'unknown',
          createdByName: currentLaborUserLabel()
        };
        updates[`projects/${_lpid}/notificationEvents/${notificationEventKey}`] = {
          module: 'labor',
          type: 'cash_advance_payroll_deducted',
          status: 'pending',
          consumed: false,
          payload: {
            workerId: wid,
            advanceId: adv.key,
            payrollLogId: logKey,
            amount: adv.deductThisPayroll,
            nextStatus
          },
          createdAt: Date.now(),
          createdBy: window._currentUser?.uid || null,
          createdByName: currentLaborUserLabel()
        };
      }
    }
  }

  try {
    await safeDb(() => firebase.database().ref().update(updates), 'Failed to save payroll');
  } catch (e) {
    showToast('Failed to save payroll. No data was lost.', 'error');
    console.error(e);
    return;
  }

  auditLog('payroll', 'payroll', logKey, {
    period: d.start + '\u2013' + d.end, gross: d.grandGross, net, projectId: _lpid
  });

  const endDate = $('weekEnd')?.value;
  if (endDate) {
    const nextStart = new Date(endDate + 'T12:00:00');
    nextStart.setDate(nextStart.getDate() + 1);
    const nextEnd = new Date(nextStart);
    nextEnd.setDate(nextStart.getDate() + 6);
    if ($('weekStart')) $('weekStart').value = nextStart.toISOString().slice(0, 10);
    if ($('weekEnd')) $('weekEnd').value = nextEnd.toISOString().slice(0, 10);
  }

  closePayrollModal();
  showToast(`\u2705 Payroll saved! Gross: ${peso(d.grandGross)} \u00B7 Net: ${peso(net)}${d.govEnabled ? ` \u00B7 Employer Cost: ${peso(d.employerTotalCost)}` : ''}`);
  applyWeek();
}

// ══════════════════════════════════════════════════════
//  PAYSLIP GENERATION (with Government Deductions)
// ══════════════════════════════════════════════════════
function generatePayslips() {
  const d = _pendingPayrollData;
  if (!d) return;

  const list = $('payslipList');
  if (!list) return;

  list.innerHTML = '';

  // Calculate per-worker gov deductions if enabled
  const sssRate = d.govEnabled ? ((d.sssEmployerTotal / d.grandGross) || 0) : 0;
  const philRate = d.govEnabled ? ((d.philhealthEmployerTotal / d.grandGross) || 0) : 0;
  const pagibigAmt = d.govEnabled ? (d.pagibigEmployerTotal / Object.keys(d.workerPayroll).length) : 0;

  Object.entries(d.workerPayroll).forEach(([wid, worker]) => {
    const advances = d.pendingAdvances[wid];
    const totalDeductions = (advances?.totalDeduct || 0);
    const netPay = worker.gross - totalDeductions;

    const slip = document.createElement('div');
    slip.className = 'payslip-card';

    let govDeductionsHTML = '';
    if (d.govEnabled && worker.gross > 0) {
      const sss = worker.gross * sssRate;
      const phil = worker.gross * philRate;
      govDeductionsHTML = `
        <div class="payslip-row"><span>SSS (Employer)</span><span>${peso(sss)}</span></div>
        <div class="payslip-row"><span>PhilHealth (Employer)</span><span>${peso(phil)}</span></div>
        <div class="payslip-row"><span>Pag-IBIG (Employer)</span><span>${peso(pagibigAmt)}</span></div>
      `;
    }

    slip.innerHTML = `
      <div class="payslip-hdr">
        <span class="payslip-name">${escapeHtml(worker.name)}</span>
        <span class="payslip-period">${d.start} \u2013 ${d.end}</span>
      </div>
      <div class="payslip-body">
        <div class="payslip-row"><span>Regular Pay</span><span>${peso(worker.regular)}</span></div>
        <div class="payslip-row"><span>Overtime</span><span>${peso(worker.ot)}</span></div>
        <div class="payslip-row"><span>Night Differential</span><span>${peso(worker.night)}</span></div>
        <div class="payslip-row payslip-gross"><span>Gross</span><span>${peso(worker.gross)}</span></div>
        ${totalDeductions > 0 ? `<div class="payslip-row"><span>Cash Advances</span><span class="text-red">-${peso(totalDeductions)}</span></div>` : ''}
        ${govDeductionsHTML}
        <div class="payslip-row payslip-net"><span>NET PAY</span><span class="text-green">${peso(netPay)}</span></div>
      </div>
      <button class="btn-ws-secondary" data-wid="${wid}">\u2B07\uFE0F PDF</button>
    `;

    slip.querySelector('[data-wid]').addEventListener('click', () => downloadSinglePayslip(wid));
    list.appendChild(slip);
  });

  $('payslipModal').classList.remove('hidden');
}

function closePayslipModal() { $('payslipModal').classList.add('hidden'); }

function downloadSinglePayslip(wid) {
  const d = _pendingPayrollData;
  if (!d || !window.jspdf) return;
  const worker = d.workerPayroll[wid];
  if (!worker) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const advances = d.pendingAdvances[wid];
  const totalDeductions = (advances?.totalDeduct || 0);
  const netPay = worker.gross - totalDeductions;

  doc.setFontSize(18).setFont('helvetica', 'bold');
  doc.text('PAYSLIP', 105, 20, { align: 'center' });
  doc.setFontSize(10).setFont('helvetica', 'normal');
  doc.text('LeBuild Design & Construction', 105, 28, { align: 'center' });

  doc.setFontSize(12).setFont('helvetica', 'bold');
  doc.text(worker.name, 20, 45);
  doc.setFontSize(10).setFont('helvetica', 'normal');
  doc.text(`Period: ${d.start} \u2013 ${d.end}`, 20, 52);
  doc.text(`Daily Rate: ${peso(worker.rate)}`, 20, 58);

  let y = 70;
  doc.setFontSize(11).setFont('helvetica', 'bold');
  doc.text('EARNINGS', 20, y); y += 7;
  doc.setFontSize(10).setFont('helvetica', 'normal');
  doc.text('Regular Pay', 25, y); doc.text(peso(worker.regular), 180, y, { align: 'right' }); y += 6;
  doc.text('Overtime', 25, y); doc.text(peso(worker.ot), 180, y, { align: 'right' }); y += 6;
  doc.text('Night Differential', 25, y); doc.text(peso(worker.night), 180, y, { align: 'right' }); y += 8;

  doc.setFontSize(11).setFont('helvetica', 'bold');
  doc.text('Gross Pay', 25, y); doc.text(peso(worker.gross), 180, y, { align: 'right' }); y += 10;

  if (totalDeductions > 0) {
    doc.setFontSize(11).setFont('helvetica', 'bold');
    doc.text('DEDUCTIONS', 20, y); y += 7;
    doc.setFontSize(10).setFont('helvetica', 'normal');
    doc.text('Cash Advances', 25, y); doc.text(`-${peso(totalDeductions)}`, 180, y, { align: 'right' }); y += 8;
  }

  doc.setDrawColor(0).setLineWidth(0.5);
  doc.line(20, y, 190, y); y += 8;

  doc.setFontSize(14).setFont('helvetica', 'bold');
  doc.text('NET PAY', 25, y); doc.text(peso(netPay), 180, y, { align: 'right' });

  if (d.govEnabled) {
    y += 10;
    doc.setFontSize(8).setFont('helvetica', 'normal');
    doc.text('* Govt deductions (SSS/PhilHealth/Pag-IBIG) are employer share and do not reduce net pay.', 20, y);
  }

  doc.setFontSize(8).setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleDateString('en-PH')} \u00B7 ACPM System`, 105, 280, { align: 'center' });

  doc.save(`Payslip_${worker.name.replace(/\s+/g, '_')}_${d.start}.pdf`);
}

function downloadAllPayslips() {
  showToast('Individual download recommended for now', 'warn');
}

// ══════════════════════════════════════════════════════
//  TIMECARD HISTORY
// ══════════════════════════════════════════════════════
let _tcHistoryListener = null;

function watchTimecardHistory(pid) {
  if (_tcHistoryListener) { _tcHistoryListener.off(); _tcHistoryListener = null; }
  const ref = firebase.database().ref(`projects/${pid}/attendanceHistory`);
  _tcHistoryListener = ref;
  ref.on('value', snap => renderTimecardHistory(snap));
}

function renderTimecardHistory(snap) {
  const el = $('timecardHistoryList'); if (!el) return;
  el.innerHTML = '';

  if (!snap || !snap.exists()) {
    el.innerHTML = '<p class="empty-hint">No archived attendance yet. Compile payroll to save records.</p>';
    return;
  }

  const entries = [];
  snap.forEach(c => {
    const data = c.val();
    const tcCount = data.entries ? data.entries.length : 0;
    entries.push({ key: c.key, ...data, tcCount });
  });
  entries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  // Gather every workerId referenced across all archives and resolve names/trades/rates
  const workerIds = new Set();
  entries.forEach(e => (e.entries || []).forEach(t => { if (t.workerId) workerIds.add(t.workerId); }));

  if (!workerIds.size) {
    entries.forEach(e => appendHistoryCard(el, e, {}));
    return;
  }

  // Resolve all worker profiles in one read
  firebase.database().ref(`projects/${_lpid}/workers`).once('value', wSnap => {
    const workers = {};
    wSnap.forEach(c => {
      workers[c.key] = c.val();
    });

    // Some archived workers may have been removed — fall back to any name stored on the entry itself
    entries.forEach(e => appendHistoryCard(el, e, workers));
  });
}

function appendHistoryCard(el, e, workers) {
  const div = document.createElement('div');
  div.className = 'tc-history-card';
  div.innerHTML = `
    <div class="tc-history-hdr" data-key="${e.key}">
      <div class="tc-history-left">
        <span class="tc-history-period">\u1F4C5 ${escapeHtml(e.period || '\u2014')}</span>
        <span class="tc-history-meta">${e.tcCount} entries \u00B7 ${e.savedAt ? new Date(e.savedAt).toLocaleDateString('en-PH') : '\u2014'}</span>
      </div>
      <span class="tc-history-toggle" id="tcToggle_${e.key}">\u25BC</span>
    </div>
    <div class="tc-history-body hidden" id="tcBody_${e.key}">
      <div class="tc-history-table-wrap">
        <table class="summary-table">
          <thead><tr>
            <th>Worker</th><th>Trade</th><th>Date</th><th>Status</th>
            <th style="text-align:right">Daily Rate</th>
            <th style="text-align:center">OT Hrs</th>
            <th style="text-align:right">Subtotal</th>
          </tr></thead>
          <tbody>${renderTimecardRows(e.entries, workers)}</tbody>
        </table>
      </div>
    </div>
  `;
  div.querySelector('.tc-history-hdr').addEventListener('click', () => toggleTCHistory(e.key));
  el.appendChild(div);
}

function renderTimecardRows(entries, workers) {
  if (!entries || !entries.length) return '<tr><td colspan="7" class="empty-cell">No attendance data</td></tr>';
  const rows = [...entries].sort((a, b) => {
    const wName = (workers[a.workerId]?.name || a.workerName || a.workerId || '').localeCompare(workers[b.workerId]?.name || b.workerName || b.workerId || '');
    if (wName !== 0) return wName;
    return (a.date || '').localeCompare(b.date || '');
  });
  return rows.map(tc => {
    // Resolve worker identity from the live workers snapshot, with fallbacks
    const w = workers[tc.workerId] || {};
    const name = w.name || tc.workerName || tc.workerId || '\u2014';
    const trade = w.trade || tc.trade || '\u2014';
    const rate = w.dailyRate || tc.dailyRate || 0;
    const pay = (rate && tc.status) ? calculateGrossPay(rate, tc) : { total: 0 };
    const fmtDate = tc.date ? new Date(tc.date + 'T12:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014';
    const statusLabel = ATTENDANCE_STATUS[tc.status]?.label || escapeHtml(tc.status || '\u2014');
    return `
      <tr class="s-row">
        <td class="s-cell">${escapeHtml(name)}</td>
        <td class="s-cell s-trade">${escapeHtml(trade)}</td>
        <td class="s-cell">${fmtDate}</td>
        <td class="s-cell">${statusLabel}</td>
        <td class="s-cell s-right">${peso(rate)}</td>
        <td class="s-cell s-center">${tc.overtimeHours ? (tc.overtimeHours + 'h') : '\u2014'}</td>
        <td class="s-cell s-right s-bold">${peso(pay.total)}</td>
      </tr>`;
  }).join('');
}

function toggleTCHistory(key) {
  const body = $(`tcBody_${key}`);
  const toggle = $(`tcToggle_${key}`);
  if (!body || !toggle) return;
  const isHidden = body.classList.contains('hidden');
  body.classList.toggle('hidden', !isHidden);
  toggle.textContent = isHidden ? '\u25B2' : '\u25BC';
}

// ══════════════════════════════════════════════════════
//  RFP GENERATOR + PDF
// ══════════════════════════════════════════════════════
async function generateRFP() {
  if (!_lpid) return;
  const start = $('weekStart')?.value || '\u2014';
  const end = $('weekEnd')?.value || '\u2014';

  const [wSnap, attSnap] = await Promise.all([
    firebase.database().ref(`projects/${_lpid}/workers`).once('value'),
    firebase.database().ref(`projects/${_lpid}/attendance`).once('value')
  ]);

  const days = getWeekDays();
  const weekSet = new Set(days.map(d => d.iso));

  const workers = {};
  wSnap.forEach(c => {
    workers[c.key] = c.val();
  });

  const byTrade = {};
  let grand = 0, filteredDays = 0;

  attSnap.forEach(workerAtt => {
    const wid = workerAtt.key;
    const w = workers[wid];
    if (!w) return;

    workerAtt.forEach(daySnap => {
      const tc = daySnap.val();
      // ── Period filter: only count days inside the selected week ──
      if (!weekSet.has(tc.date)) return;
      if (tc.status === 'absent' || tc.status === 'rest') return;

      const tradeKey = w.trade || 'Unassigned';
      if (!byTrade[tradeKey]) byTrade[tradeKey] = [];

      let entry = byTrade[tradeKey].find(x => x.name === w.name);
      if (!entry) {
        entry = { name: w.name, rate: w.dailyRate, days: 0, sub: 0, ot: 0 };
        byTrade[tradeKey].push(entry);
      }
      const pay = calculateGrossPay(w.dailyRate, tc);
      entry.days += (tc.status === 'half' ? 0.5 : 1);
      entry.sub += pay.total;
      entry.ot += pay.otPay;
      grand += pay.total;
      filteredDays++;
    });
  });

  if (!grand) {
    showToast('No attendance in the selected period to generate RFP.', 'warn');
    return;
  }

  const today = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  const projectName = _projectName || _lpid;
  const groups = Object.entries(byTrade).sort().map(([trade, ws]) => {
    const meta = getTradeMeta(trade);
    const workers = ws.sort((a, b) => a.name.localeCompare(b.name));
    const total = workers.reduce((s, w) => s + w.sub, 0);
    return { trade, workers, total, ...meta };
  });

  const lines = [];
  groups.forEach((group, index) => {
    if (index) lines.push('', '='.repeat(54), '');
    lines.push(
      `REQUEST FOR PAYMENT (RFP) - ${group.trade.toUpperCase()}`,
      `Project        : ${projectName}`,
      `Scope / Trade  : ${group.trade}`,
      `Foreman        : ${group.foremanName || '___________________________'}`,
      `Period         : ${start} to ${end}`,
      `Date Prepared  : ${today}`,
      `Payment Method : ${group.paymentMethod || 'Bank'}`,
      group.notes ? `Notes          : ${group.notes}` : '',
      '\u2500'.repeat(54)
    );
    group.workers.forEach(w => {
      lines.push(`  ${w.name.padEnd(26)} ${String(w.days).padStart(4)} day/s x ${peso(w.rate).padStart(10)} = ${peso(w.sub).padStart(12)}`);
    });
    lines.push(
      `  ${'Scope Subtotal'.padEnd(50)} ${peso(group.total).padStart(12)}`,
      '',
      'Approved by: ___________________________'
    );
  });
  lines.push('', '\u2500'.repeat(54), `ALL SCOPES TOTAL: ${peso(grand)}`);

  window._rfpData = { lines, start, end, grand, byTrade, groups, projectName };
  $('rfpOutput').value = lines.join('\n');
  $('rfpModal').classList.remove('hidden');
}

function closeRFP() { $('rfpModal').classList.add('hidden'); }

// Modern Clipboard API
async function copyRFP() {
  const ta = $('rfpOutput');
  if (!ta) return;
  try {
    await navigator.clipboard.writeText(ta.value);
    showToast('RFP copied to clipboard!');
  } catch (err) {
    // Fallback for older browsers
    ta.select();
    document.execCommand('copy');
    showToast('RFP copied to clipboard!');
  }
}

function downloadRFP() {
  if (!window._rfpData) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const lm = 20, rm = 190;
  let y = 20;

  const today = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  const projectName = _rfpData.projectName || _lpid;
  (_rfpData.groups || []).forEach((group, index) => {
    if (index) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(14).setFont('helvetica', 'bold');
    doc.text(`REQUEST FOR PAYMENT - ${group.trade.toUpperCase()}`, lm, y); y += 7;
    doc.setFontSize(9).setFont('helvetica', 'normal');
    doc.text(`Project        : ${projectName}`, lm, y); y += 5;
    doc.text(`Scope / Trade  : ${group.trade}`, lm, y); y += 5;
    doc.text(`Foreman        : ${group.foremanName || '___________________________'}`, lm, y); y += 5;
    doc.text(`Period         : ${_rfpData.start} to ${_rfpData.end}`, lm, y); y += 5;
    doc.text(`Date Prepared  : ${today}`, lm, y); y += 5;
    doc.text(`Payment Method : ${group.paymentMethod || 'Bank'}`, lm, y); y += 5;
    if (group.notes) { doc.text(`Notes          : ${group.notes}`, lm, y); y += 5; }
    doc.setDrawColor(60, 80, 120).setLineWidth(0.4);
    doc.line(lm, y, rm, y); y += 6;

    doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(40, 80, 180);
    doc.text(group.trade.toUpperCase(), lm, y); y += 5; doc.setTextColor(0);
    group.workers.forEach(w => {
      doc.setFont('helvetica', 'normal').setFontSize(8);
      doc.text(w.name, lm + 3, y);
      doc.text(`${w.days} day/s \u00D7 ${peso(w.rate)}`, lm + 70, y);
      doc.text(peso(w.sub), rm, y, { align: 'right' }); y += 5;
    });
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('Scope Subtotal', lm + 3, y);
    doc.text(peso(group.total), rm, y, { align: 'right' }); y += 9;
    doc.setFontSize(8).setFont('helvetica', 'normal');
    doc.text('Approved by: ___________________________', lm, y);
  });
  const safeName = (projectName || _lpid).replace(/[^\w\-]+/g, '_');
  doc.save(`RFP_${safeName}_${_rfpData.start}.pdf`);
}

// ══════════════════════════════════════════════════════
//  PAYROLL LOGS ARCHIVE + EXPORT
// ══════════════════════════════════════════════════════
function watchPayrollLogs(pid) {
  const ref = firebase.database().ref(`projects/${pid}/payrollLogs`);
  laborListen(ref, snap => {
    const el = $('payrollLogsBody'); if (!el) return;
    const tradeTotals = {};
    let grandTotal = 0;
    _compiledWeekKeys = new Set();

    if (!snap.exists()) {
      el.innerHTML = `<p class="empty-hint">No payroll logs yet. Compile a week to create the first record.</p>`;
      renderTradeTotals({}, 0);
      return;
    }

    const rows = [];
    snap.forEach(c => {
      const row = { id: c.key, ...c.val() };
      if (row.weekKey) _compiledWeekKeys.add(row.weekKey);
      rows.push(row);
    });
    rows.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    let html = '';
    rows.forEach((e, idx) => {
      grandTotal += e.net || e.gross || 0;
      if (e.byTrade) Object.entries(e.byTrade).forEach(([t, d]) => {
        tradeTotals[t] = (tradeTotals[t] || 0) + (d.net || d.total || 0);
      });

      const trades = e.byTrade
        ? Object.entries(e.byTrade).sort((a, b) => (b[1].total || 0) - (a[1].total || 0))
        : [];

      const workerCount = trades.reduce((n, [, d]) => n + (d.workers ? Object.keys(d.workers).length : 0), 0);
      const govBadge = e.govDeductions
        ? `<span class="paylog-gov-badge">Gov: ${peso(e.govDeductions.employerTotalCost)}</span>`
        : '';
      const deductBadge = e.deductions > 0
        ? `<span class="paylog-deduct-badge">Advances -${peso(e.deductions)}</span>`
        : '';

      const tradeCards = trades.map(([trade, d]) => {
        const wRows = d.workers
          ? Object.entries(d.workers).sort((a, b) => (b[1].gross || 0) - (a[1].gross || 0)).map(([wid, w]) => `
              <tr class="paylog-worker-row">
                <td class="paylog-w-name">${escapeHtml(w.name)}</td>
                <td class="paylog-w-days">${w.days || 0} d</td>
                <td class="paylog-w-rate">${peso(w.rate)}</td>
                <td class="paylog-w-gross">${peso(w.gross || 0)}</td>
              </tr>`).join('')
          : `<tr><td colspan="4" class="empty-cell">No worker detail</td></tr>`;
        return `<div class="payroll-trade-card">
          <div class="payroll-trade-hdr">
            <span class="payroll-trade-name">${escapeHtml(trade)}${d.foremanName ? ` · ${escapeHtml(d.foremanName)}` : ''}</span>
            <span class="payroll-trade-total">${peso(d.net || d.total || 0)}</span>
          </div>
          <div class="payroll-trade-meta">
            Gross ${peso(d.total || 0)} · Advances -${peso(d.cashAdvanceDeductions || 0)} · Payment ${escapeHtml(d.paymentMethod || 'Bank')}
          </div>
          <table class="paylog-worker-table">
            <thead><tr><th>Worker</th><th>Days</th><th>Rate</th><th style="text-align:right">Gross</th></tr></thead>
            <tbody>${wRows}</tbody>
          </table>
        </div>`;
      }).join('');

      html += `
        <div class="payroll-log-entry">
          <div class="payroll-log-hdr" onclick="togglePayrollLog('${e.id}')">
            <div class="payroll-log-left">
              <span class="payroll-log-period">\u1F4C5 ${escapeHtml(e.period || '\u2014')}</span>
              <span class="payroll-log-meta">Saved ${escapeHtml(e.savedDate || '\u2014')} \u00B7 ${workerCount} workers \u00B7 ${trades.length} trades</span>
            </div>
            <div class="payroll-log-right">
              ${deductBadge}${govBadge}
              <span class="payroll-log-gross">${peso(e.gross || 0)}</span>
              <span class="payroll-log-net">${peso(e.net || e.gross || 0)}</span>
              <span class="payroll-log-toggle" id="plogToggle_${e.id}">\u25BC</span>
            </div>
          </div>
          <div class="payroll-log-body hidden" id="plogBody_${e.id}">
            ${tradeCards || '<p class="empty-hint">No trade breakdown saved.</p>'}
          </div>
        </div>`;
    });

    html += `<div class="payroll-log-grand">
      <span>Total Labor Disbursed (all logs)</span>
      <span class="payroll-log-grand-amt">${peso(grandTotal)}</span>
    </div>`;

    el.innerHTML = html;
    renderTradeTotals(tradeTotals, grandTotal);
  });
}

function togglePayrollLog(id) {
  const body = $(`plogBody_${id}`);
  const toggle = $(`plogToggle_${id}`);
  if (!body || !toggle) return;
  const isHidden = body.classList.contains('hidden');
  body.classList.toggle('hidden', !isHidden);
  toggle.textContent = isHidden ? '\u25B2' : '\u25BC';
}

function renderTradeTotals(totals, grand) {
  const el = $('tradeTotals'); if (!el) return;
  if (!Object.keys(totals).length) { el.innerHTML = '<p class="empty-hint">No data yet.</p>'; return; }
  el.innerHTML = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([t, v]) => {
    const p2 = grand ? Math.round((v / grand) * 100) : 0;
    return `<div class="tt-row">
      <span class="tt-trade">${escapeHtml(t)}</span>
      <div class="tt-bar-wrap"><div class="tt-bar" style="width:${p2}%"></div></div>
      <span class="tt-pct">${p2}%</span>
      <span class="tt-val">${peso(v)}</span>
    </div>`;
  }).join('');
}

async function exportPayrollCSV() {
  if (!_lpid) return;
  const snap = await firebase.database().ref(`projects/${_lpid}/payrollLogs`).once('value');
  if (!snap.exists()) { showToast('No payroll data to export.', 'warn'); return; }

  const rows = [];
  snap.forEach(c => {
    rows.push(c.val());
  });
  rows.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  let csv = 'Date,Period,Regular,OT,Night Diff,Gross,Deductions,Net,GovDeductions\n';
  rows.forEach(r => {
    const gov = r.govDeductions ? peso(r.govDeductions.employerTotalCost) : '';
    csv += `${r.savedDate || ''},${r.period || ''},${r.regular || 0},${r.ot || 0},${r.nightDiff || 0},${r.gross || 0},${r.deductions || 0},${r.net || r.gross || 0},${gov}\n`;
  });

  downloadTextFile(`Payroll_${_lpid}_${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv');
  showToast('Payroll CSV exported!');
}

// ── Expose to global scope ────────────────────────────────────
window.initLabor = initLabor;
window.detachLaborListeners = detachLaborListeners;
window.savePayrollConfig = savePayrollConfig;
window.saveProjectSettings = () => showToast('RFP settings are now saved per trade/scope.', 'warn');
window.saveTradeSettings = saveTradeSettings;
window.addTrade = addTrade;
window.renameTrade = renameTrade;
window.deleteTrade = deleteTrade;
window.addWorker = addWorker;
window.removeWorker = removeWorker;
window.openAdvanceModal = openAdvanceModal;
window.closeAdvanceModal = closeAdvanceModal;
window.saveAdvance = saveAdvance;
window.deleteAdvance = deleteAdvance;
window.updateCashAdvanceStatus = updateCashAdvanceStatus;
window.handleAdvanceStatusAction = handleAdvanceStatusAction;
window.createCashAdvanceEvent = createCashAdvanceEvent;
window.createLaborNotificationEvent = createLaborNotificationEvent;
window.handleAttendanceChange = handleAttendanceChange;
window.markAttendance = markAttendance;
window.updateAttendanceOT = updateAttendanceOT;
window.handleWeekRangeChange = handleWeekRangeChange;
window.applyWeek = applyWeek;
window.resetCurrentAttendance = resetCurrentAttendance;
window.compilePayroll = compilePayroll;
window.closePayrollModal = closePayrollModal;
window.updatePayrollNet = updatePayrollNet;
window.confirmSavePayroll = confirmSavePayroll;
window.generatePayslips = generatePayslips;
window.closePayslipModal = closePayslipModal;
window.downloadSinglePayslip = downloadSinglePayslip;
window.downloadAllPayslips = downloadAllPayslips;
window.generateRFP = generateRFP;
window.closeRFP = closeRFP;
window.copyRFP = copyRFP;
window.downloadRFP = downloadRFP;
window.exportPayrollCSV = exportPayrollCSV;
window.toggleTCHistory = toggleTCHistory;
window.togglePayrollLog = togglePayrollLog;
