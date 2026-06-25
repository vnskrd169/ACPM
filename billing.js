let _bpid = null;
let _contractListener = null;
let _billingsListener = null;
let _collectionsListener = null;

function canTouchBillingProject() {
  return !!_bpid && typeof canEditProject === 'function' && canEditProject(_bpid);
}

function initBilling(pid) {
  _bpid = pid;
  detachBillingListeners();
  watchContract(pid);
  watchBillings(pid);
  watchCollections(pid);
}

function detachBillingListeners() {
  if (_contractListener) { _contractListener.off(); _contractListener = null; }
  if (_billingsListener) { _billingsListener.off(); _billingsListener = null; }
  if (_collectionsListener) { _collectionsListener.off(); _collectionsListener = null; }
}

// ══════════════════════════════════════════════════════
//  CONTRACT SETUP
// ══════════════════════════════════════════════════════
function watchContract(pid) {
  _contractListener = firebase.database().ref(`projects/${pid}/contract`);
  _contractListener.on('value', snap => {
    const c = snap.val() || {};
    const hasContract = !!c.amount;

    const setupForm = $('contractSetupForm');
    const dashboard = $('contractDashboard');
    if (setupForm) setupForm.classList.toggle('hidden', hasContract);
    if (dashboard) dashboard.classList.toggle('hidden', !hasContract);

    if (hasContract) renderContractDashboard(c, pid);
  });
}

async function saveContract() {
  if (!_bpid) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const amount = parseFloat($('contractAmount').value) || 0;
  const downpct = parseFloat($('contractDownPct').value) || 0;
  const retention = parseFloat($('contractRetention').value) || 0;
  const client = $('contractClient').value.trim();
  const startDate = $('contractStart').value;
  const endDate = $('contractEnd').value;

  if (amount <= 0) { showToast('Enter contract amount.', 'error'); return; }
  if (!client) { showToast('Enter client name.', 'error'); return; }
  if (client.length > 100) { showToast('Client name too long.', 'error'); return; }

  // Validate dates
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    showToast('Contract end date must be after start date.', 'error'); return;
  }

  const downPayment = amount * (downpct / 100);

  await safeDb(() => firebase.database().ref(`projects/${_bpid}/contract`).set({
    amount, downPct: downpct, downPayment, retention,
    client, startDate, endDate,
    savedAt: Date.now(),
    savedDate: new Date().toLocaleDateString('en-PH'),
    savedBy: window._currentUser.uid
  }), 'Failed to save contract');

  if (downPayment > 0) {
    await safeDb(() => firebase.database().ref(`projects/${_bpid}/collections`).push({
      date: startDate || new Date().toISOString().slice(0, 10),
      amount: downPayment,
      description: 'Down Payment',
      type: 'down_payment',
      savedAt: Date.now(),
      savedBy: window._currentUser.uid
    }), 'Failed to record down payment');
  }
  auditLog('create', 'contract', null, { client, amount, projectId: _bpid });
  showToast('Contract saved \u2713');
}

function openEditContractModal() {
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  firebase.database().ref(`projects/${_bpid}/contract`).once('value', snap => {
    const c = snap.val() || {};
    $('editContractClient').value = c.client || '';
    $('editContractAmount').value = c.amount || '';
    $('editContractDownPct').value = c.downPct || '';
    $('editContractRetention').value = c.retention || '';
    $('editContractStart').value = c.startDate || '';
    $('editContractEnd').value = c.endDate || '';
    $('editContractModal').classList.remove('hidden');
  });
}

function closeEditContractModal() {
  $('editContractModal').classList.add('hidden');
}

async function saveEditContract() {
  if (!_bpid) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const amount = parseFloat($('editContractAmount').value) || 0;
  const downpct = parseFloat($('editContractDownPct').value) || 0;
  const retention = parseFloat($('editContractRetention').value) || 0;
  const client = $('editContractClient').value.trim();
  const startDate = $('editContractStart').value;
  const endDate = $('editContractEnd').value;

  if (amount <= 0) { showToast('Enter contract amount.', 'error'); return; }
  if (!client) { showToast('Enter client name.', 'error'); return; }
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    showToast('End date must be after start date.', 'error'); return;
  }

  const downPayment = amount * (downpct / 100);

  await safeDb(() => firebase.database().ref(`projects/${_bpid}/contract`).update({
    amount, downPct: downpct, downPayment, retention,
    client, startDate, endDate,
    updatedAt: Date.now(),
    updatedBy: window._currentUser.uid
  }), 'Failed to update contract');

  closeEditContractModal();
  auditLog('update', 'contract', null, { client, amount, projectId: _bpid });
  showToast('Contract updated \u2713');
}

function renderContractDashboard(c, pid) {
  setText('cdClient', c.client || '\u2014');
  setText('cdAmount', peso(c.amount));
  setText('cdDownPay', `${peso(c.downPayment)} (${c.downPct || 0}%)`);
  setText('cdRetention', `${c.retention || 0}%`);
  setText('cdDates', `${c.startDate || '\u2014'} \u2192 ${c.endDate || '\u2014'}`);

  Promise.all([
    firebase.database().ref(`projects/${pid}/billings`).once('value'),
    firebase.database().ref(`projects/${pid}/collections`).once('value')
  ]).then(([bSnap, cSnap]) => {
    let totalBilled = 0, totalCollected = 0;
    bSnap.forEach(b => { if (b.val().status !== 'cancelled') totalBilled += b.val().amount || 0; });
    cSnap.forEach(col => { totalCollected += col.val().amount || 0; });

    const retentionHeld = totalCollected * ((c.retention || 0) / 100);
    const netCollected = totalCollected - retentionHeld;
    const outstanding = (c.amount || 0) - totalCollected;

    setText('cdTotalBilled', peso(totalBilled));
    setText('cdTotalCollected', peso(totalCollected));
    setText('cdRetentionHeld', peso(retentionHeld));
    setText('cdNetCollected', peso(netCollected));
    setText('cdOutstanding', peso(outstanding));

    const pctCollected = pct(totalCollected, c.amount);
    const bar = $('cdProgressBar');
    if (bar) {
      bar.style.width = pctCollected + '%';
      bar.className = `billing-fill ${budgetBarClass(pctCollected)}`;
    }
    setText('cdProgressPct', `${pctCollected}% collected`);
  });
}

// ══════════════════════════════════════════════════════
//  BILLING REQUESTS
// ══════════════════════════════════════════════════════
function watchBillings(pid) {
  _billingsListener = firebase.database().ref(`projects/${pid}/billings`);
  _billingsListener.on('value', snap => {
    const tbody = $('billingsBody'); if (!tbody) return;
    tbody.innerHTML = '';
    let seq = 1;

    if (!snap.exists()) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No billing requests yet.</td></tr>`;
      return;
    }

    const rows = [];
    snap.forEach(c => rows.unshift({ id: c.key, ...c.val() }));
    rows.sort((a, b) => (a.seq || 0) - (b.seq || 0));

    const fragment = document.createDocumentFragment();
    rows.forEach(b => {
      const statusClass = {
        pending: 'bill-pending',
        sent: 'bill-sent',
        collected: 'bill-collected',
        cancelled: 'bill-cancelled'
      }[b.status] || 'bill-pending';

      const tr = document.createElement('tr');
      tr.className = 'bill-row';
      tr.setAttribute('data-status', b.status);
      tr.innerHTML = `
        <td class="b-cell">Billing #${b.seq || seq++}</td>
        <td class="b-cell">${b.date || '\u2014'}</td>
        <td class="b-cell">${escapeHtml(b.description || '\u2014')}</td>
        <td class="b-cell b-right b-bold">${peso(b.amount)}</td>
        <td class="b-cell">
          <select class="status-sel ${statusClass}" onchange="updateBillingStatus('${b.id}',this.value)">
            <option value="pending" ${b.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="sent" ${b.status === 'sent' ? 'selected' : ''}>Sent</option>
            <option value="collected" ${b.status === 'collected' ? 'selected' : ''}>Collected</option>
            <option value="cancelled" ${b.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select>
        </td>
        <td class="b-cell b-center">
          <button class="del-item-btn" aria-label="Delete billing" data-bid="${b.id}">\u2715</button>
        </td>
      `;
      tr.querySelector('[data-bid]').addEventListener('click', () => deleteBilling(b.id));
      fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);
  });
}

async function addBillingRequest() {
  if (!_bpid) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const date = $('billDate').value;
  const desc = $('billDesc').value.trim();
  const amount = parseFloat($('billAmount').value) || 0;
  if (!date) { showToast('Enter billing date.', 'error'); return; }
  if (!desc) { showToast('Enter description.', 'error'); return; }
  if (amount <= 0) { showToast('Enter billing amount.', 'error'); return; }
  if (desc.length > 200) { showToast('Description too long (max 200).', 'error'); return; }

  // Validate date not in future
  const inputDate = new Date(date + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  if (inputDate > today) { showToast('Billing date cannot be in the future.', 'error'); return; }

  const counterRef = firebase.database().ref(`projects/${_bpid}/billingCounter`);
  let seq;
  try {
    const result = await counterRef.transaction(current => (current || 0) + 1);
    seq = result.snapshot.val();
  } catch (e) {
    showToast('Failed to generate billing number. Try again.', 'error');
    return;
  }

  await safeDb(() => firebase.database().ref(`projects/${_bpid}/billings`).push({
    date, description: desc, amount, seq, status: 'pending',
    savedAt: Date.now(),
    savedBy: window._currentUser.uid
  }), 'Failed to add billing');

  $('billDate').value = ''; $('billDesc').value = ''; $('billAmount').value = '';
  auditLog('create', 'billing', null, { seq, amount, projectId: _bpid });
  showToast(`Billing #${seq} added`);
}

async function updateBillingStatus(key, status) {
  if (!_bpid) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_bpid}/billings/${key}`).update({
    status, updatedAt: Date.now(), updatedBy: window._currentUser.uid
  }), 'Failed to update status');
  auditLog('update', 'billing', key, { status, projectId: _bpid });
  showToast(`Status updated to ${status}`);
}

async function deleteBilling(key) {
  if (!_bpid) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Delete this billing request?\n\nThis cannot be undone.')) return;
  const confirmText = prompt('Type DELETE BILLING to confirm permanent deletion:');
  if (confirmText !== 'DELETE BILLING') {
    showToast('Deletion cancelled.', 'warn');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_bpid}/billings/${key}`).remove(), 'Failed to delete billing');
  auditLog('delete', 'billing', key, { projectId: _bpid });
  showToast('Billing request deleted', 'warn');
}

function filterBillings(status) {
  document.querySelectorAll('#billingsBody tr[data-status]').forEach(row => {
    row.style.display = (status === 'all' || row.getAttribute('data-status') === status) ? '' : 'none';
  });
}

// ══════════════════════════════════════════════════════
//  COLLECTIONS
// ══════════════════════════════════════════════════════
function watchCollections(pid) {
  _collectionsListener = firebase.database().ref(`projects/${pid}/collections`);
  _collectionsListener.on('value', snap => {
    const tbody = $('collectionsBody'); if (!tbody) return;
    tbody.innerHTML = '';
    let grand = 0;

    if (!snap.exists()) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No collections yet.</td></tr>`;
      setText('collectionGrand', peso(0));
      return;
    }

    const rows = [];
    snap.forEach(c => rows.unshift({ id: c.key, ...c.val() }));
    rows.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));

    const fragment = document.createDocumentFragment();
    rows.forEach(col => {
      grand += col.amount || 0;
      const tr = document.createElement('tr');
      tr.className = 'bill-row';
      tr.innerHTML = `
        <td class="b-cell">${col.date || '\u2014'}</td>
        <td class="b-cell">${escapeHtml(col.description || '\u2014')}</td>
        <td class="b-cell b-right b-bold" style="color:var(--green)">${peso(col.amount)}</td>
        <td class="b-cell b-center">
          ${col.type !== 'down_payment' ? `<button class="del-item-btn" aria-label="Delete collection" data-cid="${col.id}">\u2715</button>` : '<span style="font-size:10px;color:var(--muted)">DP</span>'}
        </td>
      `;
      if (col.type !== 'down_payment') {
        tr.querySelector('[data-cid]').addEventListener('click', () => deleteCollection(col.id));
      }
      fragment.appendChild(tr);
    });

    const totalTr = document.createElement('tr');
    totalTr.className = 'hist-total-row';
    totalTr.innerHTML = `
      <td class="b-cell" colspan="2">Total Collected</td>
      <td class="b-cell b-right" style="color:var(--green);font-weight:800">${peso(grand)}</td>
      <td></td>
    `;
    fragment.appendChild(totalTr);
    tbody.appendChild(fragment);
    setText('collectionGrand', peso(grand));

    firebase.database().ref(`projects/${pid}/contract`).once('value', cSnap => {
      if (cSnap.exists()) renderContractDashboard(cSnap.val(), pid);
    });
  });
}

async function addCollection() {
  if (!_bpid) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const date = $('colDate').value;
  const desc = $('colDesc').value.trim();
  const amount = parseFloat($('colAmount').value) || 0;
  if (!date) { showToast('Enter date received.', 'error'); return; }
  if (!desc) { showToast('Enter description.', 'error'); return; }
  if (amount <= 0) { showToast('Enter amount received.', 'error'); return; }
  if (desc.length > 200) { showToast('Description too long.', 'error'); return; }

  // Validate date not in future
  const inputDate = new Date(date + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  if (inputDate > today) { showToast('Collection date cannot be in the future.', 'error'); return; }

  await safeDb(() => firebase.database().ref(`projects/${_bpid}/collections`).push({
    date, description: desc, amount, type: 'collection', savedAt: Date.now(), savedBy: window._currentUser.uid
  }), 'Failed to record collection');

  $('colDate').value = ''; $('colDesc').value = ''; $('colAmount').value = '';
  auditLog('create', 'collection', null, { amount, projectId: _bpid });
  showToast(`Collection of ${peso(amount)} recorded`);
}

async function deleteCollection(key) {
  if (!_bpid) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Remove this collection record?\n\nThis cannot be undone.')) return;
  const confirmText = prompt('Type DELETE COLLECTION to confirm permanent deletion:');
  if (confirmText !== 'DELETE COLLECTION') {
    showToast('Deletion cancelled.', 'warn');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_bpid}/collections/${key}`).remove(), 'Failed to remove collection');
  auditLog('delete', 'collection', key, { projectId: _bpid });
  showToast('Collection removed', 'warn');
}

// Export billing summary
async function exportBillingSummary() {
  if (!_bpid) return;
  const [bSnap, cSnap, contractSnap] = await Promise.all([
    firebase.database().ref(`projects/${_bpid}/billings`).once('value'),
    firebase.database().ref(`projects/${_bpid}/collections`).once('value'),
    firebase.database().ref(`projects/${_bpid}/contract`).once('value')
  ]);

  const contract = contractSnap.val() || {};
  let csv = 'ACPM Billing Summary\n';
  csv += `Project,${_bpid}\n`;
  csv += `Client,${escapeCsv(contract.client || 'N/A')}\n`;
  csv += `Contract Amount,${contract.amount || 0}\n`;
  csv += `Retention %,${contract.retention || 0}\n\n`;

  csv += 'BILLING REQUESTS\n';
  csv += 'Seq,Date,Description,Amount,Status\n';
  bSnap.forEach(c => {
    const b = c.val();
    csv += `${b.seq || ''},${b.date || ''},${escapeCsv(b.description || '')},${b.amount || 0},${b.status || 'pending'}\n`;
  });

  csv += '\nCOLLECTIONS\n';
  csv += 'Date,Description,Amount\n';
  cSnap.forEach(c => {
    const col = c.val();
    csv += `${col.date || ''},${escapeCsv(col.description || '')},${col.amount || 0}\n`;
  });

  downloadTextFile(`Billing_${_bpid}_${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv');
  showToast('Billing summary exported!');
}

// ── Expose to global scope ────────────────────────────────────
window.initBilling = initBilling;
window.detachBillingListeners = detachBillingListeners;
window.saveContract = saveContract;
window.openEditContractModal = openEditContractModal;
window.closeEditContractModal = closeEditContractModal;
window.saveEditContract = saveEditContract;
window.addBillingRequest = addBillingRequest;
window.updateBillingStatus = updateBillingStatus;
window.deleteBilling = deleteBilling;
window.filterBillings = filterBillings;
window.addCollection = addCollection;
window.deleteCollection = deleteCollection;
window.exportBillingSummary = exportBillingSummary;
