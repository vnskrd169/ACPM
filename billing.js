
//  · Proper listener lifecycle (no duplicates)
//  · XSS-safe rendering
//  · Loading states
//  · Billing history with filtering
//  · Collections linked to billing requests
//  · Export billing summary
// ═══════════════════════════════════════════════════════════════

let _bpid = null;
let _contractListener = null;
let _billingsListener = null;
let _collectionsListener = null;

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
  const amount    = parseFloat($('contractAmount').value)    || 0;
  const downpct   = parseFloat($('contractDownPct').value)   || 0;
  const retention = parseFloat($('contractRetention').value) || 0;
  const client    = $('contractClient').value.trim();
  const startDate = $('contractStart').value;
  const endDate   = $('contractEnd').value;

  if (amount <= 0) { showToast('Enter contract amount.', 'error'); return; }
  if (!client)     { showToast('Enter client name.', 'error'); return; }
  if (client.length > 100) { showToast('Client name too long.', 'error'); return; }

  const downPayment = amount * (downpct / 100);

  await safeDb(() => firebase.database().ref(`projects/${_bpid}/contract`).set({
    amount, downPct: downpct, downPayment, retention,
    client, startDate, endDate,
    savedAt: Date.now(),
    savedDate: new Date().toLocaleDateString('en-PH')
  }), 'Failed to save contract');

  if (downPayment > 0) {
    await safeDb(() => firebase.database().ref(`projects/${_bpid}/collections`).push({
      date: startDate || new Date().toISOString().slice(0, 10),
      amount: downPayment,
      description: 'Down Payment',
      type: 'down_payment',
      savedAt: Date.now()
    }), 'Failed to record down payment');
  }
  showToast('Contract saved ✓');
}

async function editContract() {
  if (!confirm('Edit contract details?\n\nDown payment collection will not be removed.')) return;
  const snap = await firebase.database().ref(`projects/${_bpid}/contract`).once('value');
  const c = snap.val() || {};
  $('contractAmount').value    = c.amount    || '';
  $('contractDownPct').value   = c.downPct   || '';
  $('contractRetention').value = c.retention || '';
  $('contractClient').value    = c.client    || '';
  $('contractStart').value     = c.startDate || '';
  $('contractEnd').value       = c.endDate   || '';
  await safeDb(() => firebase.database().ref(`projects/${_bpid}/contract`).remove(), 'Failed to remove contract');
  showToast('Contract removed for editing');
}

function renderContractDashboard(c, pid) {
  setText('cdClient',    c.client || '—');
  setText('cdAmount',    peso(c.amount));
  setText('cdDownPay',   `${peso(c.downPayment)} (${c.downPct || 0}%)`);
  setText('cdRetention', `${c.retention || 0}%`);
  setText('cdDates',     `${c.startDate || '—'} → ${c.endDate || '—'}`);

  Promise.all([
    firebase.database().ref(`projects/${pid}/billings`).once('value'),
    firebase.database().ref(`projects/${pid}/collections`).once('value')
  ]).then(([bSnap, cSnap]) => {
    let totalBilled = 0, totalCollected = 0;
    bSnap.forEach(b => { if (b.val().status !== 'cancelled') totalBilled += b.val().amount || 0; });
    cSnap.forEach(col => { totalCollected += col.val().amount || 0; });

    const retentionHeld = totalCollected * ((c.retention || 0) / 100);
    const netCollected  = totalCollected - retentionHeld;
    const outstanding   = (c.amount || 0) - totalCollected;
    const billable      = (c.amount || 0) - totalBilled;

    setText('cdTotalBilled',     peso(totalBilled));
    setText('cdTotalCollected',  peso(totalCollected));
    setText('cdRetentionHeld',   peso(retentionHeld));
    setText('cdNetCollected',    peso(netCollected));
    setText('cdOutstanding',     peso(outstanding));
    setText('cdBillable',        peso(billable));

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
    
    rows.forEach(b => {
      const statusClass = { 
        pending: 'bill-pending', 
        sent: 'bill-sent', 
        collected: 'bill-collected', 
        cancelled: 'bill-cancelled' 
      }[b.status] || 'bill-pending';
      tbody.innerHTML += `<tr class="bill-row" data-status="${b.status}">
        <td class="b-cell">Billing #${b.seq || seq++}</td>
        <td class="b-cell">${b.date || '—'}</td>
        <td class="b-cell">${escapeHtml(b.description || '—')}</td>
        <td class="b-cell b-right b-bold">${peso(b.amount)}</td>
        <td class="b-cell">
          <select class="status-sel ${statusClass}" onchange="updateBillingStatus('${b.id}',this.value)">
            <option value="pending"   ${b.status === 'pending'   ? 'selected' : ''}>Pending</option>
            <option value="sent"      ${b.status === 'sent'      ? 'selected' : ''}>Sent</option>
            <option value="collected" ${b.status === 'collected' ? 'selected' : ''}>Collected</option>
            <option value="cancelled" ${b.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select>
        </td>
        <td class="b-cell b-center">
          <button class="del-item-btn" aria-label="Delete billing" onclick="deleteBilling('${b.id}')">✕</button>
        </td>
      </tr>`;
    });
  });
}

async function addBillingRequest() {
  if (!_bpid) return;
  const date   = $('billDate').value;
  const desc   = $('billDesc').value.trim();
  const amount = parseFloat($('billAmount').value) || 0;
  if (!date)     { showToast('Enter billing date.', 'error'); return; }
  if (!desc)     { showToast('Enter description.', 'error'); return; }
  if (amount <= 0) { showToast('Enter billing amount.', 'error'); return; }
  if (desc.length > 200) { showToast('Description too long (max 200).', 'error'); return; }

  const newRef = firebase.database().ref(`projects/${_bpid}/billings`).push();
  const snap = await firebase.database().ref(`projects/${_bpid}/billings`).once('value');
  const seq  = (snap.numChildren() || 0) + 1;

  await safeDb(() => newRef.set({
    date, description: desc, amount, seq, status: 'pending',
    savedAt: Date.now()
  }), 'Failed to add billing');
  $('billDate').value = ''; $('billDesc').value = ''; $('billAmount').value = '';
  showToast(`Billing #${seq} added`);
}

async function updateBillingStatus(key, status) {
  if (!_bpid) return;
  await safeDb(() => firebase.database().ref(`projects/${_bpid}/billings/${key}`).update({ status }), 'Failed to update status');
  showToast(`Status updated to ${status}`);
}

async function deleteBilling(key) {
  if (!_bpid || !confirm('Delete this billing request?')) return;
  await safeDb(() => firebase.database().ref(`projects/${_bpid}/billings/${key}`).remove(), 'Failed to delete billing');
  showToast('Billing request deleted', 'warn');
}

// Filter billings by status
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
    
    rows.forEach(col => {
      grand += col.amount || 0;
      tbody.innerHTML += `<tr class="bill-row">
        <td class="b-cell">${col.date || '—'}</td>
        <td class="b-cell">${escapeHtml(col.description || '—')}</td>
        <td class="b-cell b-right b-bold" style="color:var(--green)">${peso(col.amount)}</td>
        <td class="b-cell b-center">
          ${col.type !== 'down_payment' ? `<button class="del-item-btn" aria-label="Delete collection" onclick="deleteCollection('${col.id}')">✕</button>` : '<span style="font-size:10px;color:var(--muted)">DP</span>'}
        </td>
      </tr>`;
    });

    tbody.innerHTML += `<tr class="hist-total-row">
      <td class="b-cell" colspan="2">Total Collected</td>
      <td class="b-cell b-right" style="color:var(--green);font-weight:800">${peso(grand)}</td>
      <td></td>
    </tr>`;
    setText('collectionGrand', peso(grand));

    firebase.database().ref(`projects/${pid}/contract`).once('value', cSnap => {
      if (cSnap.exists()) renderContractDashboard(cSnap.val(), pid);
    });
  });
}

async function addCollection() {
  if (!_bpid) return;
  const date   = $('colDate').value;
  const desc   = $('colDesc').value.trim();
  const amount = parseFloat($('colAmount').value) || 0;
  if (!date)     { showToast('Enter date received.', 'error'); return; }
  if (!desc)     { showToast('Enter description.', 'error'); return; }
  if (amount <= 0) { showToast('Enter amount received.', 'error'); return; }
  if (desc.length > 200) { showToast('Description too long.', 'error'); return; }
  await safeDb(() => firebase.database().ref(`projects/${_bpid}/collections`).push({
    date, description: desc, amount, type: 'collection', savedAt: Date.now()
  }), 'Failed to record collection');
  $('colDate').value = ''; $('colDesc').value = ''; $('colAmount').value = '';
  showToast(`Collection of ${peso(amount)} recorded`);
}

async function deleteCollection(key) {
  if (!_bpid || !confirm('Remove this collection record?')) return;
  await safeDb(() => firebase.database().ref(`projects/${_bpid}/collections/${key}`).remove(), 'Failed to remove collection');
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
  // FIXED: Use actual newlines
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

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Billing_${_bpid}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Billing summary exported!');
}

function escapeCsv(text) {
  if (!text) return '';
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}
