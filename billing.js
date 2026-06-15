// ═══════════════════════════════════════════════════════════════
//  ACPM v5 — billing.js
//  Progress Billing: contract → down payment → tranches → collections
// ═══════════════════════════════════════════════════════════════

let _bpid = null;

function initBilling(pid) {
  _bpid = pid;
  watchContract(pid);
  watchBillings(pid);
  watchCollections(pid);
}

// ══════════════════════════════════════════════════════
//  CONTRACT SETUP
// ══════════════════════════════════════════════════════
function watchContract(pid) {
  listen(firebase.database().ref(`projects/${pid}/contract`), snap => {
    const c = snap.val() || {};
    const hasContract = !!c.amount;

    $('contractSetupForm').classList.toggle('hidden', hasContract);
    $('contractDashboard').classList.toggle('hidden', !hasContract);

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

  if (amount <= 0) { alert('Enter contract amount.'); return; }
  if (!client)     { alert('Enter client name.'); return; }

  const downPayment = amount * (downpct / 100);

  await firebase.database().ref(`projects/${_bpid}/contract`).set({
    amount, downPct: downpct, downPayment, retention,
    client, startDate, endDate,
    savedAt: Date.now(),
    savedDate: new Date().toLocaleDateString('en-PH')
  });

  // If down payment > 0, auto-record it as first collection
  if (downPayment > 0) {
    await firebase.database().ref(`projects/${_bpid}/collections`).push({
      date: startDate || new Date().toISOString().slice(0,10),
      amount: downPayment,
      description: 'Down Payment',
      type: 'down_payment',
      savedAt: Date.now()
    });
  }
}

async function editContract() {
  if (!confirm('Edit contract details? Down payment collection will not be removed.')) return;
  const snap = await firebase.database().ref(`projects/${_bpid}/contract`).once('value');
  const c = snap.val() || {};
  $('contractAmount').value    = c.amount    || '';
  $('contractDownPct').value   = c.downPct   || '';
  $('contractRetention').value = c.retention || '';
  $('contractClient').value    = c.client    || '';
  $('contractStart').value     = c.startDate || '';
  $('contractEnd').value       = c.endDate   || '';
  await firebase.database().ref(`projects/${_bpid}/contract`).remove();
}

function renderContractDashboard(c, pid) {
  setText('cdClient',    c.client || '—');
  setText('cdAmount',    peso(c.amount));
  setText('cdDownPay',   `${peso(c.downPayment)} (${c.downPct || 0}%)`);
  setText('cdRetention', `${c.retention || 0}%`);
  setText('cdDates',     `${c.startDate || '—'} → ${c.endDate || '—'}`);

  // Compute totals from live data
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

    // Progress bar
    const pctCollected = pct(totalCollected, c.amount);
    const bar = $('cdProgressBar');
    if (bar) { bar.style.width = pctCollected + '%'; bar.className = `billing-fill ${budgetBarClass(pctCollected)}`; }
    setText('cdProgressPct', `${pctCollected}% collected`);
  });
}

// ══════════════════════════════════════════════════════
//  BILLING REQUESTS (tranches)
// ══════════════════════════════════════════════════════
function watchBillings(pid) {
  listen(firebase.database().ref(`projects/${pid}/billings`), snap => {
    const tbody = $('billingsBody'); if (!tbody) return;
    tbody.innerHTML = '';
    let seq = 1;

    if (!snap.exists()) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No billing requests yet.</td></tr>`;
      return;
    }

    const rows = []; snap.forEach(c => rows.unshift({ id: c.key, ...c.val() }));
    rows.forEach(b => {
      const statusClass = { pending:'bill-pending', sent:'bill-sent', collected:'bill-collected', cancelled:'bill-cancelled' }[b.status] || 'bill-pending';
      tbody.innerHTML += `
        <tr class="bill-row">
          <td class="b-cell">Billing #${b.seq || seq++}</td>
          <td class="b-cell">${b.date || '—'}</td>
          <td class="b-cell">${b.description || '—'}</td>
          <td class="b-cell b-right b-bold">${peso(b.amount)}</td>
          <td class="b-cell">
            <select class="status-sel ${statusClass}" onchange="updateBillingStatus('${b.id}',this.value)">
              <option value="pending"   ${b.status==='pending'   ?'selected':''}>Pending</option>
              <option value="sent"      ${b.status==='sent'      ?'selected':''}>Sent</option>
              <option value="collected" ${b.status==='collected' ?'selected':''}>Collected</option>
              <option value="cancelled" ${b.status==='cancelled' ?'selected':''}>Cancelled</option>
            </select>
          </td>
          <td class="b-cell b-center">
            <button class="del-item-btn" onclick="deleteBilling('${b.id}')">✕</button>
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
  if (!date)     { alert('Enter billing date.'); return; }
  if (!desc)     { alert('Enter description (e.g. 2nd tranche — roofing complete).'); return; }
  if (amount<=0) { alert('Enter billing amount.'); return; }

  // Get next seq number
  const snap = await firebase.database().ref(`projects/${_bpid}/billings`).once('value');
  const seq  = (snap.numChildren() || 0) + 1;

  await firebase.database().ref(`projects/${_bpid}/billings`).push({
    date, description: desc, amount, seq, status: 'pending',
    savedAt: Date.now()
  });
  $('billDate').value = ''; $('billDesc').value = ''; $('billAmount').value = '';
}

async function updateBillingStatus(key, status) {
  if (!_bpid) return;
  await firebase.database().ref(`projects/${_bpid}/billings/${key}`).update({ status });
}

async function deleteBilling(key) {
  if (!_bpid || !confirm('Delete this billing request?')) return;
  await firebase.database().ref(`projects/${_bpid}/billings/${key}`).remove();
}

// ══════════════════════════════════════════════════════
//  COLLECTIONS
// ══════════════════════════════════════════════════════
function watchCollections(pid) {
  listen(firebase.database().ref(`projects/${pid}/collections`), snap => {
    const tbody = $('collectionsBody'); if (!tbody) return;
    tbody.innerHTML = '';
    let grand = 0;

    if (!snap.exists()) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No collections yet.</td></tr>`;
      setText('collectionGrand', peso(0)); return;
    }

    const rows = []; snap.forEach(c => rows.unshift({ id: c.key, ...c.val() }));
    rows.forEach(col => {
      grand += col.amount || 0;
      tbody.innerHTML += `
        <tr class="bill-row">
          <td class="b-cell">${col.date || '—'}</td>
          <td class="b-cell">${col.description || '—'}</td>
          <td class="b-cell b-right b-bold" style="color:var(--green)">${peso(col.amount)}</td>
          <td class="b-cell b-center">
            ${col.type !== 'down_payment' ? `<button class="del-item-btn" onclick="deleteCollection('${col.id}')">✕</button>` : '<span style="font-size:10px;color:var(--muted)">DP</span>'}
          </td>
        </tr>`;
    });

    tbody.innerHTML += `<tr class="hist-total-row">
      <td class="b-cell" colspan="2">Total Collected</td>
      <td class="b-cell b-right" style="color:var(--green);font-weight:800">${peso(grand)}</td>
      <td></td>
    </tr>`;
    setText('collectionGrand', peso(grand));

    // Refresh dashboard totals
    watchContract(pid);
  });
}

async function addCollection() {
  if (!_bpid) return;
  const date   = $('colDate').value;
  const desc   = $('colDesc').value.trim();
  const amount = parseFloat($('colAmount').value) || 0;
  if (!date)     { alert('Enter date received.'); return; }
  if (!desc)     { alert('Enter description (e.g. 2nd tranche payment).'); return; }
  if (amount<=0) { alert('Enter amount received.'); return; }
  await firebase.database().ref(`projects/${_bpid}/collections`).push({
    date, description: desc, amount, type: 'collection', savedAt: Date.now()
  });
  $('colDate').value = ''; $('colDesc').value = ''; $('colAmount').value = '';
}

async function deleteCollection(key) {
  if (!_bpid || !confirm('Remove this collection record?')) return;
  await firebase.database().ref(`projects/${_bpid}/collections/${key}`).remove();
}