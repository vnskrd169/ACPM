let _bpid = null;
let _contractListener = null;
let _billingsListener = null;
let _collectionsListener = null;
let _billingRollupListener = null;

function canTouchBillingProject() {
  return typeof requireEdit === 'function'
    ? requireEdit(_bpid)
    : !!_bpid && typeof canEditProject === 'function' && canEditProject(_bpid);
}

function initBilling(pid) {
  _bpid = pid;
  detachBillingListeners();
  watchContract(pid);
  watchBillingRollups(pid);
  watchBillings(pid);
  watchCollections(pid);
}

function detachBillingListeners() {
  if (_contractListener) { _contractListener.off(); _contractListener = null; }
  if (_billingsListener) { _billingsListener.off(); _billingsListener = null; }
  if (_collectionsListener) { _collectionsListener.off(); _collectionsListener = null; }
  if (_billingRollupListener) { _billingRollupListener.off(); _billingRollupListener = null; }
}

// ══════════════════════════════════════════════════════
//  CONTRACT SETUP
// ══════════════════════════════════════════════════════
function billingUserId() {
  return (window._currentUser && window._currentUser.uid) || 'unknown';
}

function billingProjectRef(pid, path = '') {
  return firebase.database().ref(`projects/${pid}${path ? `/${path}` : ''}`);
}

function billingNow() {
  return Date.now();
}

function billingAmount(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function billingActive(record) {
  const status = (record && record.status) || '';
  return status !== 'cancelled' && status !== 'voided' && status !== 'rejected';
}

function billingApproved(record) {
  const status = (record && record.status) || '';
  return ['approved', 'sent', 'partially_collected', 'collected', 'closed'].includes(status);
}

function signedAdjustmentAmount(record) {
  const amount = billingAmount(record && record.amount);
  const type = String((record && record.type) || '').toLowerCase();
  if (['deduction', 'retention_hold', 'withholding_tax'].includes(type)) return -amount;
  return amount;
}

function billingGross(record) {
  return billingAmount(record && (record.grossAmount ?? record.amount));
}

function billingNet(record) {
  if (!record) return 0;
  if (record.netBillable !== undefined) return billingAmount(record.netBillable);
  return Math.max(0, billingGross(record) - billingAmount(record.retentionAmount) - billingAmount(record.deductionTotal));
}

function collectionNet(record) {
  if (!record) return 0;
  if (record.netCashReceived !== undefined) return billingAmount(record.netCashReceived);
  if (record.amountReceived !== undefined) return billingAmount(record.amountReceived);
  return billingAmount(record.amount);
}

function billingSnapRows(snap) {
  const rows = [];
  if (!snap || !snap.exists()) return rows;
  snap.forEach(child => rows.push({ id: child.key, ...child.val() }));
  return rows;
}

function billingNo(seq) {
  return `BILL-${String(seq || 0).padStart(4, '0')}`;
}

function collectionNo(seq) {
  return `COL-${String(seq || 0).padStart(4, '0')}`;
}

function adjustmentNo(seq) {
  return `ADJ-${String(seq || 0).padStart(4, '0')}`;
}

async function nextBillingSeq(pid, counterName) {
  const counterRef = billingProjectRef(pid, `billingConfig/${counterName}`);
  const seedSnap = await counterRef.once('value');
  if (!seedSnap.exists() && counterName === 'nextBillingNo') {
    const [legacyCounterSnap, billingsSnap] = await Promise.all([
      billingProjectRef(pid, 'billingCounter').once('value'),
      billingProjectRef(pid, 'billings').once('value')
    ]);
    let maxSeq = billingAmount(legacyCounterSnap.val());
    billingsSnap.forEach(child => {
      maxSeq = Math.max(maxSeq, billingAmount((child.val() || {}).seq));
    });
    await counterRef.set(maxSeq);
  }
  const result = await counterRef.transaction(current => (current || 0) + 1);
  return result.snapshot.val();
}

async function getContract(pid) {
  if (!pid) return null;
  const snap = await billingProjectRef(pid, 'contract').once('value');
  return snap.val() || null;
}

function normalizeContract(input = {}, existing = {}) {
  const amount = billingAmount(input.originalAmount ?? input.amount ?? existing.originalAmount ?? existing.amount);
  const downPct = billingAmount(input.downPaymentPct ?? input.downPct ?? existing.downPaymentPct ?? existing.downPct);
  const retention = billingAmount(input.retentionPct ?? input.retention ?? existing.retentionPct ?? existing.retention);
  const approvedChangeOrderTotal = billingAmount(existing.approvedChangeOrderTotal);
  const downPayment = amount * (downPct / 100);
  const clientName = String(input.clientName ?? input.client ?? existing.clientName ?? existing.client ?? '').trim();
  const createdAt = existing.createdAt || existing.savedAt || billingNow();
  const createdBy = existing.createdBy || existing.savedBy || billingUserId();

  return {
    clientName,
    client: clientName,
    originalAmount: amount,
    amount,
    approvedChangeOrderTotal,
    adjustedContractAmount: amount + approvedChangeOrderTotal,
    downPaymentPct: downPct,
    downPct,
    downPaymentAmount: downPayment,
    downPayment,
    retentionPct: retention,
    retention,
    retentionMode: input.retentionMode || existing.retentionMode || 'percent',
    startDate: input.startDate ?? existing.startDate ?? '',
    endDate: input.endDate ?? existing.endDate ?? '',
    status: input.status || existing.status || 'active',
    savedDate: existing.savedDate || new Date().toLocaleDateString('en-PH'),
    savedAt: existing.savedAt || createdAt,
    savedBy: existing.savedBy || createdBy,
    createdAt,
    createdBy,
    updatedAt: billingNow(),
    updatedBy: billingUserId()
  };
}

async function saveContractData(pid, input = {}) {
  if (!pid) throw new Error('Missing project id.');
  const existing = await getContract(pid);
  const payload = normalizeContract(input, existing || {});
  await safeDb(() => billingProjectRef(pid, 'contract').update(payload), 'Failed to save contract');
  await createBillingEvent(pid, {
    type: existing ? 'contract_update' : 'contract_create',
    amount: payload.originalAmount,
    description: payload.clientName
  });
  await rebuildBillingRollups(pid);
  return payload;
}

async function listBillings(pid) {
  const snap = await billingProjectRef(pid, 'billings').once('value');
  return billingSnapRows(snap);
}

async function createBilling(pid, input = {}) {
  if (!pid) throw new Error('Missing project id.');
  const grossAmount = billingAmount(input.grossAmount ?? input.amount);
  if (grossAmount <= 0) throw new Error('Billing amount must be greater than zero.');
  const seq = input.seq || await nextBillingSeq(pid, 'nextBillingNo');
  const retentionAmount = billingAmount(input.retentionAmount);
  const deductionTotal = billingAmount(input.deductionTotal);
  const netBillable = Math.max(0, grossAmount - retentionAmount - deductionTotal);
  const ref = billingProjectRef(pid, 'billings').push();
  const billingId = ref.key;
  const payload = {
    billingNo: input.billingNo || billingNo(seq),
    seq,
    type: input.type || 'progress',
    status: input.status || 'submitted',
    date: input.date || new Date().toISOString().slice(0, 10),
    dueDate: input.dueDate || '',
    periodStart: input.periodStart || '',
    periodEnd: input.periodEnd || '',
    description: String(input.description || '').trim(),
    percentComplete: billingAmount(input.percentComplete),
    grossAmount,
    amount: grossAmount,
    retentionPct: billingAmount(input.retentionPct),
    retentionAmount,
    deductionTotal,
    netBillable,
    collectedAmount: 0,
    receivableBalance: netBillable,
    createdAt: billingNow(),
    createdBy: billingUserId(),
    savedAt: billingNow(),
    savedBy: billingUserId()
  };

  await safeDb(() => ref.set(payload), 'Failed to add billing');
  await createBillingEvent(pid, {
    type: 'billing_submit',
    billingId,
    amount: grossAmount,
    description: payload.description,
    status: payload.status
  });
  await rebuildBillingRollups(pid);
  return { id: billingId, ...payload };
}

async function approveBilling(pid, billingId) {
  if (!pid || !billingId) throw new Error('Missing billing reference.');
  await safeDb(() => billingProjectRef(pid, `billings/${billingId}`).update({
    status: 'approved',
    approvedAt: billingNow(),
    approvedBy: billingUserId(),
    updatedAt: billingNow(),
    updatedBy: billingUserId()
  }), 'Failed to approve billing');
  await createBillingEvent(pid, { type: 'billing_approve', billingId, status: 'approved' });
  await rebuildBillingRollups(pid);
}

async function listCollections(pid) {
  const snap = await billingProjectRef(pid, 'collections').once('value');
  return billingSnapRows(snap);
}

async function recordCollection(pid, input = {}) {
  if (!pid) throw new Error('Missing project id.');
  const amountReceived = billingAmount(input.amountReceived ?? input.amount);
  if (amountReceived <= 0) throw new Error('Collection amount must be greater than zero.');
  const seq = input.seq || await nextBillingSeq(pid, 'nextCollectionNo');
  const retentionReleased = billingAmount(input.retentionReleased);
  const withholdingTax = billingAmount(input.withholdingTax);
  const otherDeductions = billingAmount(input.otherDeductions);
  const netCashReceived = Math.max(0, amountReceived - withholdingTax - otherDeductions);
  const ref = billingProjectRef(pid, 'collections').push();
  const collectionId = ref.key;
  const payload = {
    collectionNo: input.collectionNo || collectionNo(seq),
    date: input.date || new Date().toISOString().slice(0, 10),
    billingId: input.billingId || '',
    billingNo: input.billingNo || '',
    amountReceived,
    amount: amountReceived,
    retentionReleased,
    withholdingTax,
    otherDeductions,
    netCashReceived,
    paymentMethod: input.paymentMethod || '',
    referenceNo: input.referenceNo || '',
    paidBy: input.paidBy || '',
    notes: input.notes || '',
    description: String(input.description || input.notes || '').trim(),
    type: input.type || 'collection',
    status: input.status || 'posted',
    createdAt: billingNow(),
    createdBy: billingUserId(),
    savedAt: billingNow(),
    savedBy: billingUserId()
  };

  await safeDb(() => ref.set(payload), 'Failed to record collection');

  if (payload.billingId) {
    const billingRef = billingProjectRef(pid, `billings/${payload.billingId}`);
    const billingSnap = await billingRef.once('value');
    const billing = billingSnap.val() || {};
    const collectedAmount = billingAmount(billing.collectedAmount) + netCashReceived;
    const receivableBalance = Math.max(0, billingNet(billing) - collectedAmount);
    await safeDb(() => billingRef.update({
      collectedAmount,
      receivableBalance,
      status: receivableBalance <= 0 ? 'collected' : 'partially_collected',
      updatedAt: billingNow(),
      updatedBy: billingUserId()
    }), 'Failed to update billing balance');
  }

  await createBillingEvent(pid, {
    type: 'collection_post',
    billingId: payload.billingId,
    collectionId,
    amount: netCashReceived,
    description: payload.description,
    status: payload.status
  });
  await rebuildBillingRollups(pid);
  return { id: collectionId, ...payload };
}

async function createAdjustment(pid, input = {}) {
  if (!pid) throw new Error('Missing project id.');
  const amount = billingAmount(input.amount);
  if (amount <= 0) throw new Error('Adjustment amount must be greater than zero.');
  const seq = input.seq || await nextBillingSeq(pid, 'nextAdjustmentNo');
  const ref = billingProjectRef(pid, 'billingAdjustments').push();
  const adjustmentId = ref.key;
  const payload = {
    adjustmentNo: input.adjustmentNo || adjustmentNo(seq),
    date: input.date || new Date().toISOString().slice(0, 10),
    type: input.type || 'deduction',
    billingId: input.billingId || '',
    amount,
    reason: input.reason || '',
    notes: input.notes || '',
    status: input.status || 'posted',
    createdAt: billingNow(),
    createdBy: billingUserId()
  };
  await safeDb(() => ref.set(payload), 'Failed to create billing adjustment');
  await createBillingEvent(pid, {
    type: payload.type === 'addition' ? 'addition_post' : 'deduction_post',
    billingId: payload.billingId,
    adjustmentId,
    amount,
    description: payload.reason,
    status: payload.status
  });
  await rebuildBillingRollups(pid);
  return { id: adjustmentId, ...payload };
}

async function updateBillingAdjustmentStatus(pid, adjustmentId, status) {
  if (!pid || !adjustmentId) throw new Error('Missing adjustment reference.');
  if (!['approved', 'rejected', 'voided', 'pending'].includes(status)) throw new Error('Invalid adjustment status.');
  await safeDb(() => billingProjectRef(pid, `billingAdjustments/${adjustmentId}`).update({
    status,
    updatedAt: billingNow(),
    updatedBy: billingUserId(),
    [`${status}At`]: billingNow(),
    [`${status}By`]: billingUserId()
  }), 'Failed to update billing adjustment');
  await createBillingEvent(pid, {
    type: status === 'approved' ? 'adjustment_approve' : `adjustment_${status}`,
    adjustmentId,
    status
  });
  await rebuildBillingRollups(pid);
}

async function calculateReceivable(pidOrBillings, maybeCollections) {
  let billings = pidOrBillings;
  let collections = maybeCollections;
  if (typeof pidOrBillings === 'string') {
    [billings, collections] = await Promise.all([
      listBillings(pidOrBillings),
      listCollections(pidOrBillings)
    ]);
  }
  const totalNetBillable = (billings || []).filter(b => billingActive(b) && billingApproved(b)).reduce((sum, b) => sum + billingNet(b), 0);
  const totalCollected = (collections || []).filter(billingActive).reduce((sum, c) => sum + collectionNet(c), 0);
  return Math.max(0, totalNetBillable - totalCollected);
}

async function rebuildBillingRollups(pid) {
  if (!pid) return null;
  const [laborCostSnap, materialCostSnap, contractSnap, billingsSnap, collectionsSnap, adjustmentsSnap, changeOrdersSnap] = await Promise.all([
    billingProjectRef(pid, 'laborSpent').once('value'),
    billingProjectRef(pid, 'materialSpent').once('value'),
    billingProjectRef(pid, 'contract').once('value'),
    billingProjectRef(pid, 'billings').once('value'),
    billingProjectRef(pid, 'collections').once('value'),
    billingProjectRef(pid, 'billingAdjustments').once('value'),
    billingProjectRef(pid, 'changeOrders').once('value')
  ]);
  const contract = contractSnap.val() || {};
  const billings = billingSnapRows(billingsSnap).filter(b => billingActive(b) && billingApproved(b));
  const collections = billingSnapRows(collectionsSnap).filter(billingActive);
  const adjustments = billingSnapRows(adjustmentsSnap).filter(a => billingActive(a) && (a.status || '') === 'approved');
  const changeOrders = billingSnapRows(changeOrdersSnap).filter(co => (co.status || '') === 'approved');
  const contractAmount = billingAmount(contract.originalAmount ?? contract.amount);
  const approvedChangeOrders = changeOrders.reduce((sum, co) => {
    return sum + Math.max(0, billingAmount(co.laborImpact) + billingAmount(co.materialsImpact) + billingAmount(co.amount));
  }, 0);
  const adjustedContractAmount = contractAmount + approvedChangeOrders;
  const totalApprovedAdjustments = adjustments.reduce((sum, a) => sum + signedAdjustmentAmount(a), 0);
  const totalBilledGross = billings.reduce((sum, b) => sum + billingGross(b), 0);
  const totalRetentionHeld = Math.max(0,
    billings.reduce((sum, b) => sum + billingAmount(b.retentionAmount), 0) -
    collections.reduce((sum, c) => sum + billingAmount(c.retentionReleased), 0)
  );
  const totalDeductions = billings.reduce((sum, b) => sum + billingAmount(b.deductionTotal), 0) +
    adjustments.filter(a => signedAdjustmentAmount(a) < 0).reduce((sum, a) => sum + Math.abs(signedAdjustmentAmount(a)), 0);
  const totalNetBillable = Math.max(0, billings.reduce((sum, b) => sum + billingNet(b), 0) + totalApprovedAdjustments);
  const totalCollected = collections.reduce((sum, c) => sum + collectionNet(c), 0);
  const receivable = Math.max(0, totalNetBillable - totalCollected);
  const laborCost = billingAmount(laborCostSnap.val());
  const materialCost = billingAmount(materialCostSnap.val());
  const totalCost = laborCost + materialCost;
  const estimatedProfit = totalCollected - totalCost;
  const estimatedProfitPct = totalCollected > 0 ? Math.round((estimatedProfit / totalCollected) * 100) : 0;
  const rollup = {
    contractAmount,
    originalContractAmount: contractAmount,
    approvedChangeOrders,
    approvedChangeOrderTotal: approvedChangeOrders,
    adjustedContractAmount,
    approvedAdjustments: totalApprovedAdjustments,
    totalApprovedAdjustments,
    totalBilled: totalBilledGross,
    totalBilledGross,
    totalRetentionHeld,
    totalDeductions,
    totalNetBillable,
    totalCollected,
    totalReceivable: receivable,
    receivable,
    laborCost,
    materialCost,
    totalCost,
    estimatedProfit,
    estimatedProfitPct,
    lastUpdatedAt: billingNow(),
    updatedBy: billingUserId()
  };
  await safeDb(() => billingProjectRef(pid, 'billingRollups').set(rollup), 'Failed to rebuild billing rollup');
  return rollup;
}

async function calculateBillingRollup(pid) {
  return rebuildBillingRollups(pid);
}

async function calculateRevenueVsCost(pid) {
  const rollup = await rebuildBillingRollups(pid);
  if (!rollup) return null;
  return {
    revenue: rollup.totalCollected,
    billed: rollup.totalBilled,
    collected: rollup.totalCollected,
    receivable: rollup.receivable,
    laborCost: rollup.laborCost,
    materialCost: rollup.materialCost,
    totalCost: rollup.totalCost,
    estimatedProfit: rollup.estimatedProfit,
    estimatedProfitPct: rollup.estimatedProfitPct
  };
}

async function createBillingEvent(pid, event = {}) {
  if (!pid) return null;
  const ref = billingProjectRef(pid, 'billingEvents').push();
  const payload = {
    type: event.type || 'billing_event',
    date: event.date || new Date().toISOString().slice(0, 10),
    createdAt: billingNow(),
    createdBy: billingUserId(),
    billingId: event.billingId || '',
    collectionId: event.collectionId || '',
    adjustmentId: event.adjustmentId || '',
    amount: billingAmount(event.amount),
    description: event.description || '',
    status: event.status || '',
    sourceType: event.sourceType || 'billing',
    sourceId: event.sourceId || ''
  };
  await safeDb(() => ref.set(payload), 'Failed to write billing event');
  return { id: ref.key, ...payload };
}

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

function watchBillingRollups(pid) {
  _billingRollupListener = billingProjectRef(pid, 'billingRollups');
  _billingRollupListener.on('value', snap => {
    applyBillingDashboardRollup(snap.val() || {});
  });
}

async function saveContract(pidOrInput, maybeInput) {
  if (typeof pidOrInput === 'string') {
    return saveContractData(pidOrInput, maybeInput || {});
  }
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

  await saveContractData(_bpid, {
    amount,
    downPct: downpct,
    retention,
    client,
    startDate,
    endDate
  });

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

  await saveContractData(_bpid, {
    amount,
    downPct: downpct,
    retention,
    client,
    startDate,
    endDate
  });

  closeEditContractModal();
  auditLog('update', 'contract', null, { client, amount, projectId: _bpid });
  showToast('Contract updated \u2713');
}

function renderContractDashboard(c, pid) {
  setText('cdClient', c.client || '\u2014');
  setText('cdAmount', peso(c.adjustedContractAmount || c.amount));
  setText('cdDownPay', `${peso(c.downPayment)} (${c.downPct || 0}%)`);
  setText('cdRetention', `${c.retention || 0}%`);
  setText('cdDates', `${c.startDate || '\u2014'} \u2192 ${c.endDate || '\u2014'}`);

  billingProjectRef(pid, 'billingRollups').once('value')
    .then(snap => applyBillingDashboardRollup(snap.val() || {}));
}

function applyBillingDashboardRollup(rollup = {}) {
  const totalBilled = billingAmount(rollup.totalBilled);
  const totalCollected = billingAmount(rollup.totalCollected);
  const retentionHeld = billingAmount(rollup.totalRetentionHeld);
  const netCollected = Math.max(0, totalCollected - retentionHeld);
  const outstanding = billingAmount(rollup.receivable ?? rollup.totalReceivable);
  const contractAmount = billingAmount(rollup.adjustedContractAmount ?? rollup.contractAmount);

  setText('cdTotalBilled', peso(totalBilled));
  setText('cdTotalCollected', peso(totalCollected));
  setText('cdRetentionHeld', peso(retentionHeld));
  setText('cdNetCollected', peso(netCollected));
  setText('cdOutstanding', peso(outstanding));

  const pctCollected = pct(totalCollected, contractAmount);
  const bar = $('cdProgressBar');
  if (bar) {
    bar.style.width = pctCollected + '%';
    bar.className = `billing-fill ${budgetBarClass(pctCollected)}`;
  }
  setText('cdProgressPct', `${pctCollected}% collected`);
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
    snap.forEach(c => {
      rows.unshift({ id: c.key, ...c.val() });
    });
    rows.sort((a, b) => (a.seq || 0) - (b.seq || 0));

    const fragment = document.createDocumentFragment();
    rows.forEach(b => {
      const statusClass = {
        pending: 'bill-pending',
        submitted: 'bill-pending',
        approved: 'bill-sent',
        sent: 'bill-sent',
        partially_collected: 'bill-collected',
        collected: 'bill-collected',
        cancelled: 'bill-cancelled',
        voided: 'bill-cancelled'
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
            <option value="submitted" ${b.status === 'submitted' ? 'selected' : ''}>Submitted</option>
            <option value="approved" ${b.status === 'approved' ? 'selected' : ''}>Approved</option>
            <option value="sent" ${b.status === 'sent' ? 'selected' : ''}>Sent</option>
            <option value="partially_collected" ${b.status === 'partially_collected' ? 'selected' : ''}>Partially Collected</option>
            <option value="collected" ${b.status === 'collected' ? 'selected' : ''}>Collected</option>
            <option value="voided" ${b.status === 'voided' ? 'selected' : ''}>Voided</option>
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

  try {
    const billing = await createBilling(_bpid, {
      date,
      description: desc,
      amount,
      type: 'progress',
      status: 'submitted'
    });
    $('billDate').value = ''; $('billDesc').value = ''; $('billAmount').value = '';
    auditLog('create', 'billing', billing.id, { seq: billing.seq, amount, projectId: _bpid });
    showToast(`Billing #${billing.seq} added`);
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Failed to add billing.', 'error');
    return;
  }
}

async function updateBillingStatus(key, status) {
  if (!_bpid) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_bpid}/billings/${key}`).update({
    status, updatedAt: Date.now(), updatedBy: billingUserId()
  }), 'Failed to update status');
  await createBillingEvent(_bpid, {
    type: status === 'cancelled' ? 'billing_void' : `billing_${status}`,
    billingId: key,
    status
  });
  await rebuildBillingRollups(_bpid);
  auditLog('update', 'billing', key, { status, projectId: _bpid });
  showToast(`Status updated to ${status}`);
}

async function deleteBilling(key) {
  if (!_bpid) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Void this billing request?\n\nThe history will remain in Firebase.')) return;
  const reason = prompt('Reason for voiding this billing:') || 'Voided from Billing UI';
  if (!reason.trim()) {
    showToast('Void cancelled.', 'warn');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_bpid}/billings/${key}`).update({
    status: 'voided',
    voidedAt: Date.now(),
    voidedBy: billingUserId(),
    voidReason: reason.trim(),
    updatedAt: Date.now(),
    updatedBy: billingUserId()
  }), 'Failed to void billing');
  await createBillingEvent(_bpid, {
    type: 'billing_void',
    billingId: key,
    description: reason.trim(),
    status: 'voided'
  });
  await rebuildBillingRollups(_bpid);
  auditLog('void', 'billing', key, { projectId: _bpid });
  showToast('Billing request voided', 'warn');
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
    snap.forEach(c => {
      rows.unshift({ id: c.key, ...c.val() });
    });
    rows.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));

    const fragment = document.createDocumentFragment();
    rows.forEach(col => {
      if (billingActive(col)) grand += collectionNet(col);
      const tr = document.createElement('tr');
      tr.className = 'bill-row';
      tr.innerHTML = `
        <td class="b-cell">${col.date || '\u2014'}</td>
        <td class="b-cell">${escapeHtml(col.description || '\u2014')}</td>
        <td class="b-cell b-right b-bold" style="color:var(--green)">${peso(collectionNet(col))}</td>
        <td class="b-cell b-center">
          ${col.status !== 'voided' ? `<button class="del-item-btn" aria-label="Void collection" data-cid="${col.id}">\u2715</button>` : '<span style="font-size:10px;color:var(--muted)">VOID</span>'}
        </td>
      `;
      if (col.status !== 'voided') {
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

  try {
    const collection = await recordCollection(_bpid, {
      date,
      description: desc,
      amount,
      type: 'collection'
    });
    $('colDate').value = ''; $('colDesc').value = ''; $('colAmount').value = '';
    auditLog('create', 'collection', collection.id, { amount, projectId: _bpid });
    showToast(`Collection of ${peso(amount)} recorded`);
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Failed to record collection.', 'error');
  }
}

async function deleteCollection(key) {
  if (!_bpid) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Void this collection record?\n\nThe history will remain in Firebase.')) return;
  const reason = prompt('Reason for voiding this collection:') || 'Voided from Billing UI';
  if (!reason.trim()) {
    showToast('Void cancelled.', 'warn');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_bpid}/collections/${key}`).update({
    status: 'voided',
    voidedAt: Date.now(),
    voidedBy: billingUserId(),
    voidReason: reason.trim()
  }), 'Failed to void collection');
  await createBillingEvent(_bpid, {
    type: 'collection_void',
    collectionId: key,
    description: reason.trim(),
    status: 'voided'
  });
  await rebuildBillingRollups(_bpid);
  auditLog('void', 'collection', key, { projectId: _bpid });
  showToast('Collection voided', 'warn');
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
window.getContract = getContract;
window.saveContract = saveContract;
window.createBilling = createBilling;
window.listBillings = listBillings;
window.approveBilling = approveBilling;
window.recordCollection = recordCollection;
window.listCollections = listCollections;
window.createAdjustment = createAdjustment;
window.updateBillingAdjustmentStatus = updateBillingAdjustmentStatus;
window.rebuildBillingRollups = rebuildBillingRollups;
window.calculateBillingRollup = calculateBillingRollup;
window.calculateReceivable = calculateReceivable;
window.calculateRevenueVsCost = calculateRevenueVsCost;
window.createBillingEvent = createBillingEvent;
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
