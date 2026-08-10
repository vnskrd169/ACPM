let _bpid = null;
let _contractListener = null;
let _billingsListener = null;
let _collectionsListener = null;
let _billingAdjustmentsListener = null;
let _billingAllocationsListener = null;
let _retentionLedgerListener = null;
let _billingRollupListener = null;
let _billingOutputsListener = null;
let _billingRollupRebuildTimer = null;
let _billingRollupRebuildSources = {};

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
  watchBillingAdjustments(pid);
  watchBillingAllocations(pid);
  watchRetentionLedger(pid);
  watchBillingOutputs(pid);
}

function detachBillingListeners() {
  if (_contractListener) { _contractListener.off(); _contractListener = null; }
  if (_billingsListener) { _billingsListener.off(); _billingsListener = null; }
  if (_collectionsListener) { _collectionsListener.off(); _collectionsListener = null; }
  if (_billingAdjustmentsListener) { _billingAdjustmentsListener.off(); _billingAdjustmentsListener = null; }
  if (_billingAllocationsListener) { _billingAllocationsListener.off(); _billingAllocationsListener = null; }
  if (_retentionLedgerListener) { _retentionLedgerListener.off(); _retentionLedgerListener = null; }
  if (_billingRollupListener) { _billingRollupListener.off(); _billingRollupListener = null; }
  if (_billingOutputsListener) { _billingOutputsListener.off(); _billingOutputsListener = null; }
  if (_billingRollupRebuildTimer) { clearTimeout(_billingRollupRebuildTimer); _billingRollupRebuildTimer = null; }
}

function scheduleBillingRollupRebuild(pid, sources = {}) {
  if (!pid) return;
  _billingRollupRebuildSources = { ..._billingRollupRebuildSources, ...sources };
  if (_billingRollupRebuildTimer) clearTimeout(_billingRollupRebuildTimer);
  _billingRollupRebuildTimer = setTimeout(() => {
    const rebuildSources = _billingRollupRebuildSources;
    _billingRollupRebuildSources = {};
    _billingRollupRebuildTimer = null;
    rebuildBillingRollups(pid, rebuildSources).catch(err => {
      console.error('Failed to rebuild billing rollups:', err);
    });
  }, 400);
}

// ══════════════════════════════════════════════════════
//  CONTRACT SETUP
// ══════════════════════════════════════════════════════
function billingUserId() {
  return (window._currentUser && window._currentUser.uid) || 'unknown';
}

function billingUserName() {
  return window._currentUser?.name || window._currentUser?.email || 'System';
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

function billingChildRows(obj) {
  return Object.entries(obj || {}).map(([id, value]) => ({ id, ...(value || {}) }));
}

function billingRecordApproved(record) {
  const status = (record && record.status) || '';
  return status === 'approved' || status === 'posted' || status === 'released' || !status;
}

function billingDeductionTotal(record) {
  if (!record) return 0;
  const deductionRows = billingChildRows(record.deductions);
  if (deductionRows.length) {
    return deductionRows
    .filter(d => billingActive(d) && billingRecordApproved(d))
    .reduce((sum, d) => sum + billingAmount(d.amount), 0);
  }
  return billingAmount(record.deductionTotal);
}

function calculateBillingRetentionAmount(record, gross = billingGross(record), deductions = billingDeductionTotal(record)) {
  if (!record) return 0;
  if (record.retentionAmount !== undefined) return billingAmount(record.retentionAmount);
  const base = Math.max(0, gross - deductions);
  const fixed = billingAmount(record.retentionFixedAmount);
  if ((record.retentionMode || '').toLowerCase() === 'fixed' || fixed > 0) {
    return Math.min(base, fixed);
  }
  return Math.min(base, base * (billingAmount(record.retentionPct) / 100));
}

function billingCurrentCollectible(record) {
  const gross = billingGross(record);
  const deductions = billingDeductionTotal(record);
  const retention = calculateBillingRetentionAmount(record, gross, deductions);
  return Math.max(0, gross - deductions - retention);
}

function billingSnapRows(snap) {
  const rows = [];
  if (!snap || !snap.exists()) return rows;
  snap.forEach(child => {
    rows.push({ id: child.key, ...child.val() });
    return false;
  });
  return rows;
}

function activeBillingMap(rows = []) {
  const map = {};
  rows.filter(b => billingActive(b) && billingApproved(b)).forEach(b => { map[b.id] = b; });
  return map;
}

function activeCollectionMap(rows = []) {
  const map = {};
  rows.filter(billingActive).forEach(c => { map[c.id] = c; });
  return map;
}

function effectiveAllocationRows(collections = [], allocations = []) {
  const activeCollections = activeCollectionMap(collections);
  const mirrored = (allocations || []).filter(a =>
    billingActive(a) &&
    a.collectionId &&
    a.billingId &&
    activeCollections[a.collectionId]
  );
  const mirroredCollectionIds = new Set(mirrored.map(a => a.collectionId));
  const legacy = [];

  (collections || []).filter(billingActive).forEach(col => {
    const nestedRows = billingChildRows(col.allocations).filter(a => billingActive(a) && a.billingId);
    if (nestedRows.length && !mirroredCollectionIds.has(col.id)) {
      nestedRows.forEach(a => {
        legacy.push({
          id: a.id,
          collectionId: col.id,
          billingId: a.billingId,
          amount: billingAmount(a.amount),
          allocationType: a.allocationType || 'manual',
          status: a.status || 'posted',
          createdAt: a.createdAt || col.createdAt || col.savedAt || 0
        });
      });
      return;
    }
    if (!col.billingId || mirroredCollectionIds.has(col.id) || col.allocationMode === 'phase2') return;
    legacy.push({
      id: `legacy_${col.id}`,
      collectionId: col.id,
      billingId: col.billingId,
      amount: collectionNet(col),
      allocationType: 'legacy',
      status: col.status || 'posted',
      createdAt: col.createdAt || col.savedAt || 0
    });
  });

  return [...mirrored, ...legacy].map(a => ({
    ...a,
    amount: billingAmount(a.amount)
  }));
}

function retentionReleaseRows(collections = [], retentionLedger = []) {
  const ledgerRows = (retentionLedger || []).filter(r =>
    billingActive(r) &&
    billingRecordApproved(r) &&
    String(r.type || '').toLowerCase() === 'release'
  );
  const ledgerCollectionIds = new Set(ledgerRows.map(r => r.collectionId).filter(Boolean));
  const collectionRows = (collections || []).filter(billingActive).map(c => ({
    id: `collection_${c.id}`,
    billingId: c.billingId || '',
    collectionId: c.id,
    amount: billingAmount(c.retentionReleased),
    type: 'release',
    status: c.status || 'posted'
  })).filter(r => r.amount > 0 && !ledgerCollectionIds.has(r.collectionId));
  return [...collectionRows, ...ledgerRows].map(r => ({
    ...r,
    amount: billingAmount(r.amount)
  }));
}

function billingAllocationSummary(billingId, collections = [], allocations = [], retentionLedger = []) {
  const allocationRows = effectiveAllocationRows(collections, allocations)
    .filter(a => a.billingId === billingId);
  const allocatedCollectionTotal = allocationRows.reduce((sum, a) => sum + billingAmount(a.amount), 0);
  const retentionReleased = retentionReleaseRows(collections, retentionLedger)
    .filter(r => !r.billingId || r.billingId === billingId)
    .reduce((sum, r) => sum + billingAmount(r.amount), 0);
  return { allocationRows, allocatedCollectionTotal, retentionReleased };
}

function outputNo(seq) {
  return `OUT-${String(seq || 0).padStart(4, '0')}`;
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
  const deductionTotal = billingAmount(input.deductionTotal);
  const retentionMode = input.retentionMode || (billingAmount(input.retentionFixedAmount) > 0 ? 'fixed' : 'percent');
  const retentionDraft = {
    grossAmount,
    deductionTotal,
    retentionMode,
    retentionPct: billingAmount(input.retentionPct),
    retentionFixedAmount: billingAmount(input.retentionFixedAmount),
    retentionAmount: input.retentionAmount
  };
  const retentionAmount = calculateBillingRetentionAmount(retentionDraft, grossAmount, deductionTotal);
  const currentCollectible = Math.max(0, grossAmount - retentionAmount - deductionTotal);
  const netBillable = currentCollectible;
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
    retentionMode,
    retentionPct: billingAmount(input.retentionPct),
    retentionFixedAmount: billingAmount(input.retentionFixedAmount),
    retentionAmount,
    retentionReleased: 0,
    retentionReceivable: retentionAmount,
    deductionTotal,
    netBillable,
    currentCollectible,
    allocatedCollectionTotal: 0,
    currentReceivable: currentCollectible,
    collectedAmount: 0,
    receivableBalance: currentCollectible,
    outputSnapshotIds: input.outputSnapshotIds || null,
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

async function createDownpaymentBilling(pid, input = {}) {
  const contract = await getContract(pid) || {};
  const amount = billingAmount(input.amount ?? input.grossAmount ?? contract.downPaymentAmount ?? contract.downPayment);
  if (amount <= 0) throw new Error('Downpayment amount must be greater than zero.');
  return createBilling(pid, {
    ...input,
    type: 'downpayment',
    description: input.description || 'Downpayment billing',
    amount,
    grossAmount: amount
  });
}

async function createMobilizationBilling(pid, input = {}) {
  const amount = billingAmount(input.amount ?? input.grossAmount);
  if (amount <= 0) throw new Error('Mobilization amount must be greater than zero.');
  return createBilling(pid, {
    ...input,
    type: 'mobilization',
    description: input.description || 'Mobilization billing',
    amount,
    grossAmount: amount
  });
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
  await createBillingNotificationEvent(pid, 'billing_approved', { billingId });
  await rebuildBillingRollups(pid);
}

async function listCollections(pid) {
  const snap = await billingProjectRef(pid, 'collections').once('value');
  return billingSnapRows(snap);
}

async function listCollectionAllocations(pid) {
  const snap = await billingProjectRef(pid, 'billingAllocations').once('value');
  return billingSnapRows(snap);
}

async function listRetentionLedger(pid) {
  const snap = await billingProjectRef(pid, 'retentionLedger').once('value');
  return billingSnapRows(snap);
}

async function calculateBillingReceivable(pid, billingId) {
  if (!pid || !billingId) throw new Error('Missing billing reference.');
  const [billingSnap, collections, allocations, retentionLedger] = await Promise.all([
    billingProjectRef(pid, `billings/${billingId}`).once('value'),
    listCollections(pid),
    listCollectionAllocations(pid),
    listRetentionLedger(pid)
  ]);
  const billing = { id: billingId, ...(billingSnap.val() || {}) };
  if (!billingSnap.exists() || !billingActive(billing)) {
    return {
      billingId,
      grossAmount: 0,
      deductionTotal: 0,
      retentionAmount: 0,
      retentionReleased: 0,
      retentionReceivable: 0,
      currentCollectible: 0,
      allocatedCollectionTotal: 0,
      currentReceivable: 0,
      totalReceivable: 0
    };
  }
  const grossAmount = billingGross(billing);
  const deductionTotal = billingDeductionTotal(billing);
  const retentionAmount = calculateBillingRetentionAmount(billing, grossAmount, deductionTotal);
  const currentCollectible = Math.max(0, grossAmount - deductionTotal - retentionAmount);
  const allocationSummary = billingAllocationSummary(billingId, collections, allocations, retentionLedger);
  const retentionReleased = Math.min(retentionAmount, allocationSummary.retentionReleased);
  const retentionReceivable = Math.max(0, retentionAmount - retentionReleased);
  const allocatedCollectionTotal = allocationSummary.allocatedCollectionTotal;
  const currentReceivable = Math.max(0, currentCollectible - allocatedCollectionTotal);
  return {
    billingId,
    grossAmount,
    deductionTotal,
    retentionAmount,
    retentionReleased,
    retentionReceivable,
    currentCollectible,
    allocatedCollectionTotal,
    currentReceivable,
    totalReceivable: currentReceivable + retentionReceivable,
    allocationRows: allocationSummary.allocationRows
  };
}

async function calculateCollectionUnapplied(pid, collectionId) {
  if (!pid || !collectionId) throw new Error('Missing collection reference.');
  const [collectionSnap, allocations] = await Promise.all([
    billingProjectRef(pid, `collections/${collectionId}`).once('value'),
    listCollectionAllocations(pid)
  ]);
  const collection = { id: collectionId, ...(collectionSnap.val() || {}) };
  const allocated = allocations
    .filter(a => billingActive(a) && a.collectionId === collectionId)
    .reduce((sum, a) => sum + billingAmount(a.amount), 0);
  const retentionApplied = billingAmount(collection.retentionReleased);
  const applied = allocated + Math.min(retentionApplied, collectionNet(collection));
  return {
    collectionId,
    amount: collectionNet(collection),
    allocated,
    retentionApplied,
    unappliedAmount: Math.max(0, collectionNet(collection) - applied)
  };
}

async function syncBillingDerivedFields(pid, billingId) {
  const summary = await calculateBillingReceivable(pid, billingId);
  const billingSnap = await billingProjectRef(pid, `billings/${billingId}`).once('value');
  const billing = billingSnap.val() || {};
  if (!billingSnap.exists() || !billingActive(billing)) return summary;
  const nextStatus = summary.currentReceivable <= 0 && summary.currentCollectible > 0
    ? 'collected'
    : summary.allocatedCollectionTotal > 0
      ? 'partially_collected'
      : billing.status;
  await safeDb(() => billingProjectRef(pid, `billings/${billingId}`).update({
    deductionTotal: summary.deductionTotal,
    retentionAmount: summary.retentionAmount,
    retentionReleased: summary.retentionReleased,
    retentionReceivable: summary.retentionReceivable,
    netBillable: summary.currentCollectible,
    currentCollectible: summary.currentCollectible,
    allocatedCollectionTotal: summary.allocatedCollectionTotal,
    collectedAmount: summary.allocatedCollectionTotal,
    currentReceivable: summary.currentReceivable,
    receivableBalance: summary.currentReceivable,
    status: nextStatus,
    updatedAt: billingNow(),
    updatedBy: billingUserId()
  }), 'Failed to sync billing balance');
  return summary;
}

async function syncCollectionDerivedFields(pid, collectionId) {
  const summary = await calculateCollectionUnapplied(pid, collectionId);
  await safeDb(() => billingProjectRef(pid, `collections/${collectionId}`).update({
    allocatedAmount: summary.allocated,
    unappliedAmount: summary.unappliedAmount,
    updatedAt: billingNow(),
    updatedBy: billingUserId()
  }), 'Failed to sync collection allocation');
  return summary;
}

async function validateCollectionAllocation(pid, collectionId, billingId, amount) {
  const allocationAmount = billingAmount(amount);
  if (!pid || !collectionId || !billingId) throw new Error('Missing allocation reference.');
  if (allocationAmount <= 0) throw new Error('Allocation amount must be greater than zero.');
  const [collectionSnap, billingSnap] = await Promise.all([
    billingProjectRef(pid, `collections/${collectionId}`).once('value'),
    billingProjectRef(pid, `billings/${billingId}`).once('value')
  ]);
  if (!collectionSnap.exists()) throw new Error('Collection not found.');
  if (!billingSnap.exists()) throw new Error('Billing not found.');
  const collection = { id: collectionId, ...collectionSnap.val() };
  const billing = { id: billingId, ...billingSnap.val() };
  if (!billingActive(collection)) throw new Error('Voided collections cannot be allocated.');
  if (!billingActive(billing) || !billingApproved(billing)) throw new Error('Only active approved billings can receive collections.');
  const collectionBalance = await calculateCollectionUnapplied(pid, collectionId);
  const billingBalance = await calculateBillingReceivable(pid, billingId);
  if (allocationAmount > collectionBalance.unappliedAmount + 0.0001) {
    throw new Error(`Allocation exceeds unapplied collection balance (${peso(collectionBalance.unappliedAmount)}).`);
  }
  if (allocationAmount > billingBalance.currentReceivable + 0.0001) {
    throw new Error(`Allocation exceeds billing receivable (${peso(billingBalance.currentReceivable)}).`);
  }
  return { collection, billing, collectionBalance, billingBalance, amount: allocationAmount };
}

async function allocateCollectionToBilling(pid, collectionId, billingId, amount, options = {}) {
  const validated = await validateCollectionAllocation(pid, collectionId, billingId, amount);
  const allocationRef = billingProjectRef(pid, 'billingAllocations').push();
  const allocationId = allocationRef.key;
  const payload = {
    collectionId,
    billingId,
    billingNo: validated.billing.billingNo || '',
    amount: validated.amount,
    allocationType: options.allocationType || 'manual',
    status: options.status || 'posted',
    createdAt: billingNow(),
    createdBy: billingUserId()
  };
  const updates = {};
  updates[`billingAllocations/${allocationId}`] = payload;
  updates[`collections/${collectionId}/allocations/${allocationId}`] = payload;
  await safeDb(() => billingProjectRef(pid).update(updates), 'Failed to allocate collection');
  await syncBillingDerivedFields(pid, billingId);
  await syncCollectionDerivedFields(pid, collectionId);
  await createBillingEvent(pid, {
    type: 'collection_allocate',
    billingId,
    collectionId,
    amount: validated.amount,
    status: payload.status,
    sourceType: 'billingAllocation',
    sourceId: allocationId
  });
  if (!options.skipRebuild) await rebuildBillingRollups(pid);
  return { id: allocationId, ...payload };
}

async function allocateCollectionToOldestBillings(pid, collectionId, amount) {
  const billings = (await listBillings(pid))
    .filter(b => billingActive(b) && billingApproved(b))
    .sort((a, b) => (a.seq || 0) - (b.seq || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  let remaining = billingAmount(amount);
  const allocations = [];
  for (const billing of billings) {
    if (remaining <= 0) break;
    const balance = await calculateBillingReceivable(pid, billing.id);
    const toApply = Math.min(remaining, balance.currentReceivable);
    if (toApply <= 0) continue;
    const allocation = await allocateCollectionToBilling(pid, collectionId, billing.id, toApply, {
      allocationType: 'auto_oldest',
      skipRebuild: true
    });
    allocations.push(allocation);
    remaining -= toApply;
  }
  await syncCollectionDerivedFields(pid, collectionId);
  if (allocations.length) await rebuildBillingRollups(pid);
  return { allocations, unappliedAmount: Math.max(0, remaining) };
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
  const allocatableCash = Math.max(0, netCashReceived - retentionReleased);
  if (input.billingId) {
    const balance = await calculateBillingReceivable(pid, input.billingId);
    if (allocatableCash > balance.currentReceivable + 0.0001) {
      throw new Error(`Collection exceeds billing receivable (${peso(balance.currentReceivable)}).`);
    }
    if (retentionReleased > balance.retentionReceivable + 0.0001) {
      throw new Error(`Retention collection exceeds outstanding retention (${peso(balance.retentionReceivable)}).`);
    }
  }
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
    allocatedAmount: 0,
    unappliedAmount: netCashReceived,
    allocationMode: input.allocationMode || 'phase2',
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

  if (payload.billingId && allocatableCash > 0) {
    await allocateCollectionToBilling(pid, collectionId, payload.billingId, allocatableCash, {
      allocationType: input.allocationType || 'manual',
      skipRebuild: true
    });
  } else if (input.allocateToOldest !== false) {
    await allocateCollectionToOldestBillings(pid, collectionId, allocatableCash);
  } else {
    await syncCollectionDerivedFields(pid, collectionId);
  }

  await createBillingEvent(pid, {
    type: 'collection_post',
    billingId: payload.billingId,
    collectionId,
    amount: netCashReceived,
    description: payload.description,
    status: payload.status
  });
  await createBillingNotificationEvent(pid, 'collection_received', {
    billingId: payload.billingId,
    billingNo: payload.billingNo || '',
    collectionId,
    collectionNo: payload.collectionNo || '',
    amount: netCashReceived,
    paymentMethod: payload.paymentMethod || '',
    referenceNo: payload.referenceNo || ''
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

async function createBillingDeduction(pid, billingId, input = {}) {
  if (!pid || !billingId) throw new Error('Missing billing reference.');
  const amount = billingAmount(input.amount);
  if (amount <= 0) throw new Error('Deduction amount must be greater than zero.');
  const ref = billingProjectRef(pid, `billings/${billingId}/deductions`).push();
  const deductionId = ref.key;
  const payload = {
    type: input.type || 'other',
    description: String(input.description || input.reason || '').trim(),
    amount,
    status: input.status || 'pending',
    reason: input.reason || '',
    notes: input.notes || '',
    createdAt: billingNow(),
    createdBy: billingUserId()
  };
  await safeDb(() => ref.set(payload), 'Failed to create billing deduction');
  await createBillingEvent(pid, {
    type: 'deduction_create',
    billingId,
    adjustmentId: deductionId,
    amount,
    description: payload.description,
    status: payload.status
  });
  await syncBillingDerivedFields(pid, billingId);
  await rebuildBillingRollups(pid);
  return { id: deductionId, ...payload };
}

async function updateBillingDeductionStatus(pid, billingId, deductionId, status) {
  if (!pid || !billingId || !deductionId) throw new Error('Missing deduction reference.');
  if (!['approved', 'rejected', 'voided', 'pending'].includes(status)) throw new Error('Invalid deduction status.');
  await safeDb(() => billingProjectRef(pid, `billings/${billingId}/deductions/${deductionId}`).update({
    status,
    updatedAt: billingNow(),
    updatedBy: billingUserId(),
    [`${status}At`]: billingNow(),
    [`${status}By`]: billingUserId()
  }), 'Failed to update billing deduction');
  await createBillingEvent(pid, {
    type: status === 'approved' ? 'deduction_approve' : `deduction_${status}`,
    billingId,
    adjustmentId: deductionId,
    status
  });
  await syncBillingDerivedFields(pid, billingId);
  await rebuildBillingRollups(pid);
}

function approveBillingDeduction(pid, billingId, deductionId) {
  return updateBillingDeductionStatus(pid, billingId, deductionId, 'approved');
}

function rejectBillingDeduction(pid, billingId, deductionId) {
  return updateBillingDeductionStatus(pid, billingId, deductionId, 'rejected');
}

async function voidBillingDeduction(pid, billingId, deductionId, reason = 'Voided billing deduction') {
  if (!pid || !billingId || !deductionId) throw new Error('Missing deduction reference.');
  await safeDb(() => billingProjectRef(pid, `billings/${billingId}/deductions/${deductionId}`).update({
    status: 'voided',
    voidReason: reason,
    voidedAt: billingNow(),
    voidedBy: billingUserId(),
    updatedAt: billingNow(),
    updatedBy: billingUserId()
  }), 'Failed to void billing deduction');
  await createBillingEvent(pid, {
    type: 'deduction_void',
    billingId,
    adjustmentId: deductionId,
    description: reason,
    status: 'voided'
  });
  await syncBillingDerivedFields(pid, billingId);
  await rebuildBillingRollups(pid);
}

function calculateRetentionForBilling(pid, billingId) {
  return calculateBillingReceivable(pid, billingId);
}

async function releaseRetention(pid, billingId, input = {}) {
  if (!pid || !billingId) throw new Error('Missing billing reference.');
  const amount = billingAmount(input.amount);
  if (amount <= 0) throw new Error('Retention release amount must be greater than zero.');
  const balance = await calculateBillingReceivable(pid, billingId);
  if (amount > balance.retentionReceivable + 0.0001) {
    throw new Error(`Retention release exceeds outstanding retention (${peso(balance.retentionReceivable)}).`);
  }
  const ref = billingProjectRef(pid, 'retentionLedger').push();
  const retentionId = ref.key;
  const payload = {
    billingId,
    collectionId: input.collectionId || '',
    type: 'release',
    amount,
    status: input.status || 'approved',
    date: input.date || new Date().toISOString().slice(0, 10),
    notes: input.notes || '',
    createdAt: billingNow(),
    createdBy: billingUserId()
  };
  await safeDb(() => ref.set(payload), 'Failed to release retention');
  await createBillingEvent(pid, {
    type: 'retention_release',
    billingId,
    collectionId: payload.collectionId,
    amount,
    status: payload.status
  });
  await syncBillingDerivedFields(pid, billingId);
  await rebuildBillingRollups(pid);
  return { id: retentionId, ...payload };
}

async function generateBillingOutputSnapshot(pid, options = {}) {
  if (!pid) throw new Error('Missing project id.');
  const sourceBillingIds = Array.isArray(options.billingIds)
    ? options.billingIds
    : options.billingId ? [options.billingId] : [];
  if (!sourceBillingIds.length) throw new Error('Select at least one billing for output.');
  const [projectSnap, contract, billings, collections, allocations, adjustments, retentionLedger, rollup] = await Promise.all([
    billingProjectRef(pid).once('value'),
    getContract(pid),
    listBillings(pid),
    listCollections(pid),
    listCollectionAllocations(pid),
    billingProjectRef(pid, 'billingAdjustments').once('value').then(billingSnapRows),
    listRetentionLedger(pid),
    rebuildBillingRollups(pid)
  ]);
  const project = projectSnap.val() || {};
  const selectedBillings = billings.filter(b => sourceBillingIds.includes(b.id));
  if (!selectedBillings.length) throw new Error('Selected billing not found.');
  const selectedBillingIdSet = new Set(selectedBillings.map(b => b.id));
  const selectedAllocationRows = effectiveAllocationRows(collections, allocations)
    .filter(a => selectedBillingIdSet.has(a.billingId));
  const selectedRetentionRows = retentionReleaseRows(collections, retentionLedger)
    .filter(r => !r.billingId || selectedBillingIdSet.has(r.billingId));
  const sourceCollectionIds = new Set([
    ...selectedAllocationRows.map(a => a.collectionId),
    ...selectedRetentionRows.map(r => r.collectionId).filter(Boolean)
  ]);
  const selectedCollections = collections.filter(c => sourceCollectionIds.has(c.id));
  const selectedAdjustments = adjustments.filter(a => !a.billingId || selectedBillingIdSet.has(a.billingId));
  const selectedRetention = selectedRetentionRows;
  const totals = selectedBillings.reduce((acc, b) => {
    const gross = billingGross(b);
    const deductions = billingDeductionTotal(b);
    const retention = calculateBillingRetentionAmount(b, gross, deductions);
    const collectible = Math.max(0, gross - deductions - retention);
    acc.gross += gross;
    acc.deductions += deductions;
    acc.retention += retention;
    acc.netBillable += collectible;
    return acc;
  }, { gross: 0, deductions: 0, retention: 0, netBillable: 0 });
  totals.collected = selectedAllocationRows.reduce((sum, a) => sum + billingAmount(a.amount), 0)
    + selectedRetentionRows
      .filter(r => r.collectionId)
      .reduce((sum, r) => sum + billingAmount(r.amount), 0);
  totals.receivable = Math.max(0, totals.netBillable - totals.collected);

  const seq = options.seq || await nextBillingSeq(pid, 'nextOutputNo');
  const ref = billingProjectRef(pid, 'billingOutputs').push();
  const outputId = ref.key;
  const sourceBillingMap = {};
  const sourceCollectionMap = {};
  const sourceAdjustmentMap = {};
  selectedBillings.forEach(b => { sourceBillingMap[b.id] = true; });
  selectedCollections.forEach(c => { sourceCollectionMap[c.id] = true; });
  selectedAdjustments.forEach(a => { sourceAdjustmentMap[a.id] = true; });
  const payload = {
    type: options.type || 'billing_output',
    status: 'archived',
    outputNo: options.outputNo || outputNo(seq),
    billingId: selectedBillings[0]?.id || '',
    sourceBillingIds: sourceBillingMap,
    sourceCollectionIds: sourceCollectionMap,
    sourceAdjustmentIds: sourceAdjustmentMap,
    generatedAt: billingNow(),
    generatedBy: billingUserId(),
    snapshotVersion: 1,
    title: options.title || 'Billing Output',
    snapshot: {
      project: {
        id: pid,
        name: project.name || '',
        status: project.status || ''
      },
      client: {
        name: (contract && (contract.clientName || contract.client)) || ''
      },
      contract: contract || {},
      billing: selectedBillings,
      collections: selectedCollections,
      deductions: selectedBillings.flatMap(b => billingChildRows(b.deductions).map(d => ({ billingId: b.id, ...d }))),
      retention: selectedRetention,
      totals,
      rollup: rollup || {}
    },
    textSnapshot: options.textSnapshot || JSON.stringify({
      title: options.title || 'Billing Output',
      project: project.name || pid,
      client: (contract && (contract.clientName || contract.client)) || '',
      totals
    }, null, 2)
  };
  await safeDb(() => ref.set(payload), 'Failed to archive billing output');
  const linkUpdates = {};
  selectedBillings.forEach(b => {
    linkUpdates[`billings/${b.id}/outputSnapshotIds/${outputId}`] = true;
  });
  await safeDb(() => billingProjectRef(pid).update(linkUpdates), 'Failed to link billing output');
  await createBillingEvent(pid, {
    type: 'billing_output_archive',
    billingId: payload.billingId,
    amount: totals.netBillable,
    sourceType: 'billingOutput',
    sourceId: outputId,
    status: payload.status
  });
  return { id: outputId, ...payload };
}

async function listBillingOutputs(pid) {
  const snap = await billingProjectRef(pid, 'billingOutputs').once('value');
  return billingSnapRows(snap);
}

async function calculateReceivable(pidOrBillings, maybeCollections) {
  let billings = pidOrBillings;
  let collections = maybeCollections;
  if (typeof pidOrBillings === 'string') {
    const [rollup] = await Promise.all([
      rebuildBillingRollups(pidOrBillings)
    ]);
    return billingAmount(rollup && rollup.receivable);
  }
  const totalNetBillable = (billings || []).filter(b => billingActive(b) && billingApproved(b)).reduce((sum, b) => sum + billingCurrentCollectible(b), 0);
  const totalCollected = (collections || []).filter(billingActive).reduce((sum, c) => sum + collectionNet(c), 0);
  return Math.max(0, totalNetBillable - totalCollected);
}

async function rebuildBillingRollups(pid, sources = {}) {
  if (!pid) return null;
  const [
    laborCostSnap,
    materialCostSnap,
    contractSnap,
    billingsSnap,
    collectionsSnap,
    adjustmentsSnap,
    changeOrdersSnap,
    allocationsSnap,
    retentionSnap
  ] = await Promise.all([
    billingProjectRef(pid, 'laborSpent').once('value'),
    billingProjectRef(pid, 'materialSpent').once('value'),
    sources.contractSnap ? Promise.resolve(sources.contractSnap) : billingProjectRef(pid, 'contract').once('value'),
    sources.billingsSnap ? Promise.resolve(sources.billingsSnap) : billingProjectRef(pid, 'billings').once('value'),
    sources.collectionsSnap ? Promise.resolve(sources.collectionsSnap) : billingProjectRef(pid, 'collections').once('value'),
    sources.adjustmentsSnap ? Promise.resolve(sources.adjustmentsSnap) : billingProjectRef(pid, 'billingAdjustments').once('value'),
    sources.changeOrdersSnap ? Promise.resolve(sources.changeOrdersSnap) : billingProjectRef(pid, 'changeOrders').once('value'),
    sources.allocationsSnap ? Promise.resolve(sources.allocationsSnap) : billingProjectRef(pid, 'billingAllocations').once('value'),
    sources.retentionSnap ? Promise.resolve(sources.retentionSnap) : billingProjectRef(pid, 'retentionLedger').once('value')
  ]);
  const contract = contractSnap.val() || {};
  const allBillings = billingSnapRows(billingsSnap);
  const billings = allBillings.filter(b => billingActive(b) && billingApproved(b));
  const billingsById = activeBillingMap(allBillings);
  const collections = billingSnapRows(collectionsSnap).filter(billingActive);
  const adjustments = billingSnapRows(adjustmentsSnap).filter(a => billingActive(a) && (a.status || '') === 'approved');
  const changeOrders = billingSnapRows(changeOrdersSnap).filter(co => (co.status || '') === 'approved' && co.affectsContract !== false);
  const allocationRows = effectiveAllocationRows(collections, billingSnapRows(allocationsSnap))
    .filter(a => billingsById[a.billingId]);
  const retentionRows = retentionReleaseRows(collections, billingSnapRows(retentionSnap))
    .filter(r => !r.billingId || billingsById[r.billingId]);

  const contractAmount = billingAmount(contract.originalAmount ?? contract.amount);
  const approvedChangeOrders = changeOrders.reduce((sum, co) => {
    if (co.totalImpact !== undefined) return sum + billingAmount(co.totalImpact);
    return sum + billingAmount(co.laborImpact) + billingAmount(co.materialsImpact) + billingAmount(co.otherImpact) + billingAmount(co.amount);
  }, 0);
  const adjustedContractAmount = contractAmount + approvedChangeOrders;
  const receivableAdjustments = adjustments.filter(a => a.affectsReceivable !== false);
  const additionAdjustments = receivableAdjustments
    .filter(a => signedAdjustmentAmount(a) > 0)
    .reduce((sum, a) => sum + signedAdjustmentAmount(a), 0);
  const approvedAdjustmentDeductions = receivableAdjustments
    .filter(a => signedAdjustmentAmount(a) < 0)
    .reduce((sum, a) => sum + Math.abs(signedAdjustmentAmount(a)), 0);
  const totalBilledGross = billings.reduce((sum, b) => sum + billingGross(b), 0) + additionAdjustments;
  const billingDeductions = billings.reduce((sum, b) => sum + billingDeductionTotal(b), 0);
  const totalApprovedDeductions = billingDeductions + approvedAdjustmentDeductions;
  const totalRetentionHeldRaw = billings.reduce((sum, b) => {
    return sum + calculateBillingRetentionAmount(b, billingGross(b), billingDeductionTotal(b));
  }, 0);
  const totalRetentionReleased = Math.min(
    totalRetentionHeldRaw,
    retentionRows.reduce((sum, r) => sum + billingAmount(r.amount), 0)
  );
  const totalRetentionCollected = Math.min(
    totalRetentionHeldRaw,
    retentionRows
      .filter(r => r.collectionId)
      .reduce((sum, r) => sum + billingAmount(r.amount), 0)
  );
  const retentionReceivable = Math.max(0, totalRetentionHeldRaw - totalRetentionReleased);
  const totalCurrentCollectible = Math.max(0, totalBilledGross - totalApprovedDeductions - totalRetentionHeldRaw);
  const totalAllocatedCollections = allocationRows.reduce((sum, a) => sum + billingAmount(a.amount), 0);
  const totalRevenueCollected = collections.reduce((sum, c) => sum + collectionNet(c), 0);
  const totalAppliedCollections = totalAllocatedCollections + totalRetentionCollected;
  const unappliedCollections = Math.max(0, totalRevenueCollected - totalAppliedCollections);
  const currentReceivable = Math.max(0, totalCurrentCollectible - totalAllocatedCollections);
  const totalReceivable = currentReceivable + retentionReceivable;
  const laborCost = billingAmount(laborCostSnap.val());
  const materialCost = billingAmount(materialCostSnap.val());
  const totalCost = laborCost + materialCost;
  const estimatedProfit = totalRevenueCollected - totalCost;
  const estimatedProfitPct = totalRevenueCollected > 0 ? Math.round((estimatedProfit / totalRevenueCollected) * 100) : 0;
  const margin = totalRevenueCollected > 0 ? estimatedProfit / totalRevenueCollected : 0;
  const rollup = {
    contractAmount,
    originalContractAmount: contractAmount,
    approvedChangeOrders,
    approvedChangeOrderTotal: approvedChangeOrders,
    adjustedContractAmount,
    approvedAdjustments: additionAdjustments - approvedAdjustmentDeductions,
    totalApprovedAdjustments: additionAdjustments - approvedAdjustmentDeductions,
    totalBilled: totalBilledGross,
    totalBilledGross,
    totalGrossBilled: totalBilledGross,
    totalRetentionHeld: totalRetentionHeldRaw,
    totalRetentionReleased,
    totalRetentionCollected,
    retentionReceivable,
    totalDeductions: totalApprovedDeductions,
    totalApprovedDeductions,
    totalNetBillable: totalCurrentCollectible,
    totalCurrentCollectible,
    totalAllocatedCollections,
    totalAppliedCollections,
    unappliedCollections,
    totalCollected: totalRevenueCollected,
    totalRevenueCollected,
    currentReceivable,
    totalReceivable,
    receivable: totalReceivable,
    laborCost,
    materialCost,
    totalCost,
    estimatedProfit,
    estimatedProfitPct,
    margin,
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

async function createBillingNotificationEvent(pid, type, payload = {}) {
  if (!pid || !type) return null;
  const ref = billingProjectRef(pid, 'notificationEvents').push();
  const event = {
    module: 'billing',
    type,
    status: 'pending',
    consumed: false,
    projectId: pid,
    createdAt: billingNow(),
    createdBy: billingUserId(),
    createdByName: billingUserName(),
    ...payload
  };
  try {
    await ref.set(event);
    return { id: ref.key, ...event };
  } catch (error) {
    console.warn('Billing notification hook skipped:', error?.code || error?.message || error);
    return null;
  }
}

function watchContract(pid) {
  _contractListener = firebase.database().ref(`projects/${pid}/contract`);
  _contractListener.on('value', snap => {
    hidePanelSkeleton('billingSkeleton');
    const c = snap.val() || {};
    const hasContract = !!c.amount;

    const setupForm = $('contractSetupForm');
    const dashboard = $('contractDashboard');
    if (setupForm) setupForm.classList.toggle('hidden', hasContract);
    if (dashboard) dashboard.classList.toggle('hidden', !hasContract);

    if (hasContract) renderContractDashboard(c, pid);
    if (hasContract) scheduleBillingRollupRebuild(pid, { contractSnap: snap });
  });
}

function watchBillingRollups(pid) {
  _billingRollupListener = billingProjectRef(pid, 'billingRollups');
  _billingRollupListener.on('value', snap => {
    applyBillingDashboardRollup(snap.val() || {});
  });
}

function watchBillingAdjustments(pid) {
  _billingAdjustmentsListener = billingProjectRef(pid, 'billingAdjustments');
  _billingAdjustmentsListener.on('value', snap => {
    scheduleBillingRollupRebuild(pid, { adjustmentsSnap: snap });
  });
}

function watchBillingAllocations(pid) {
  _billingAllocationsListener = billingProjectRef(pid, 'billingAllocations');
  _billingAllocationsListener.on('value', snap => {
    scheduleBillingRollupRebuild(pid, { allocationsSnap: snap });
  });
}

function watchRetentionLedger(pid) {
  _retentionLedgerListener = billingProjectRef(pid, 'retentionLedger');
  _retentionLedgerListener.on('value', snap => {
    scheduleBillingRollupRebuild(pid, { retentionSnap: snap });
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

  if (amount <= 0) { setFieldError($('contractAmt'), 'Enter contract amount.'); return; }
  if (!client) { setFieldError($('contractClient'), 'Enter client name.'); return; }
  if (client.length > 100) { setFieldError($('contractClient'), 'Client name too long.'); return; }

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
  const totalBilled = billingAmount(rollup.totalBilled ?? rollup.totalGrossBilled);
  const totalCollected = billingAmount(rollup.totalCollected ?? rollup.totalRevenueCollected);
  const retentionHeld = billingAmount(rollup.retentionReceivable ?? rollup.totalRetentionHeld);
  const netCollected = totalCollected;
  const outstanding = billingAmount(rollup.receivable ?? rollup.totalReceivable ?? rollup.currentReceivable);
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
function billingTypeLabel(type) {
  const labels = {
    progress: 'Progress',
    downpayment: 'Downpayment',
    mobilization: 'Mobilization'
  };
  return labels[String(type || 'progress').toLowerCase()] || 'Progress';
}

function billingDisplayNo(record, fallbackIndex = 0) {
  return record.billingNo || `BILL-${String(record.seq || fallbackIndex || 0).padStart(4, '0')}`;
}

function billingReceivableDisplay(record) {
  const current = record.currentReceivable !== undefined
    ? billingAmount(record.currentReceivable)
    : billingAmount(record.receivableBalance ?? billingCurrentCollectible(record));
  return current + billingAmount(record.retentionReceivable);
}

function renderBillingSelectOptions(rows = []) {
  const targets = [$('colBillingId'), $('outputBillingId')].filter(Boolean);
  if (!targets.length) return;
  const eligible = rows
    .filter(b => billingActive(b) && billingApproved(b))
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));

  targets.forEach(select => {
    const previous = select.value;
    const isCollectionTarget = select.id === 'colBillingId';
    select.innerHTML = isCollectionTarget
      ? '<option value="">Auto-allocate to oldest approved billing</option>'
      : '<option value="">Select approved billing</option>';

    eligible.forEach((billing, idx) => {
      const option = document.createElement('option');
      option.value = billing.id;
      option.dataset.billingNo = billingDisplayNo(billing, idx + 1);
      option.textContent = `${option.dataset.billingNo} - ${billingTypeLabel(billing.type)} - ${peso(billingReceivableDisplay(billing))} receivable`;
      select.appendChild(option);
    });

    if ([...select.options].some(option => option.value === previous)) {
      select.value = previous;
    }
  });
}

function billingActionHtml(record) {
  const active = billingActive(record);
  const approved = active && billingApproved(record);
  const retentionBalance = billingAmount(record.retentionReceivable);
  return `
    <span class="billing-actions">
      ${active ? `<button class="billing-mini-btn" data-action="deduct" data-bid="${record.id}">Deduct</button>` : ''}
      ${active && retentionBalance > 0 ? `<button class="billing-mini-btn" data-action="retention" data-bid="${record.id}">Release</button>` : ''}
      ${approved ? `<button class="billing-mini-btn" data-action="snapshot" data-bid="${record.id}">Snapshot</button>` : ''}
      ${active ? `<button class="del-item-btn" aria-label="Void billing" data-action="void" data-bid="${record.id}">\u2715</button>` : '<span style="font-size:10px;color:var(--muted)">VOID</span>'}
    </span>
  `;
}

function bindBillingRowActions(tr) {
  tr.querySelectorAll('[data-action][data-bid]').forEach(button => {
    const id = button.getAttribute('data-bid');
    const action = button.getAttribute('data-action');
    button.addEventListener('click', () => {
      if (action === 'deduct') addBillingDeductionFromUI(id);
      if (action === 'retention') releaseRetentionFromUI(id);
      if (action === 'snapshot') generateBillingOutputForBilling(id);
      if (action === 'void') deleteBilling(id);
    });
  });
}

function watchBillings(pid) {
  _billingsListener = firebase.database().ref(`projects/${pid}/billings`);
  _billingsListener.on('value', snap => {
    const tbody = $('billingsBody'); if (!tbody) return;
    tbody.innerHTML = '';
    let seq = 1;

    if (!snap.exists()) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">No billing requests yet.</td></tr>`;
      renderBillingSelectOptions([]);
      scheduleBillingRollupRebuild(pid, { billingsSnap: snap });
      return;
    }

    const rows = [];
    snap.forEach(c => {
      rows.unshift({ id: c.key, ...c.val() });
    });
    rows.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    renderBillingSelectOptions(rows);

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
        <td class="b-cell">${escapeHtml(billingDisplayNo(b, seq++))}</td>
        <td class="b-cell">${escapeHtml(billingTypeLabel(b.type))}</td>
        <td class="b-cell">${b.date || '\u2014'}</td>
        <td class="b-cell">${escapeHtml(b.description || '\u2014')}</td>
        <td class="b-cell b-right b-bold">${peso(billingGross(b))}</td>
        <td class="b-cell b-right b-bold">${peso(billingReceivableDisplay(b))}</td>
        <td class="b-cell">
          <select class="status-sel ${statusClass}" aria-label="Billing status for ${b.id}" onchange="updateBillingStatus('${b.id}',this.value)">
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
          ${billingActionHtml(b)}
        </td>
      `;
      bindBillingRowActions(tr);
      fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);
    scheduleBillingRollupRebuild(pid, { billingsSnap: snap });
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
  const type = ($('billType') && $('billType').value) || 'progress';
  const retentionPct = parseFloat(($('billRetentionPct') && $('billRetentionPct').value) || '') || 0;
  const deductionTotal = parseFloat(($('billDeduction') && $('billDeduction').value) || '') || 0;
  if (!date) { setFieldError($('billDate'), 'Enter billing date.'); return; }
  if (!desc) { setFieldError($('billDesc'), 'Enter description.'); return; }
  if (amount <= 0) { setFieldError($('billAmount'), 'Enter billing amount.'); return; }
  if (retentionPct < 0 || retentionPct > 100) { setFieldError($('billRetentionPct'), 'Retention must be from 0% to 100%.'); return; }
  if (deductionTotal < 0 || deductionTotal >= amount) { setFieldError($('billDeduction'), 'Deduction must be lower than billing amount.'); return; }
  if (desc.length > 200) { setFieldError($('billDesc'), 'Description too long (max 200).'); return; }

  // Validate date not in future
  const inputDate = new Date(date + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  if (inputDate > today) { showToast('Billing date cannot be in the future.', 'error'); return; }

  try {
    const payload = {
      date,
      description: desc,
      amount,
      type,
      status: 'submitted',
      deductionTotal,
      retentionPct
    };
    const billing = type === 'downpayment'
      ? await createDownpaymentBilling(_bpid, payload)
      : type === 'mobilization'
        ? await createMobilizationBilling(_bpid, payload)
        : await createBilling(_bpid, payload);
    $('billDate').value = ''; $('billDesc').value = ''; $('billAmount').value = '';
    if ($('billRetentionPct')) $('billRetentionPct').value = '';
    if ($('billDeduction')) $('billDeduction').value = '';
    auditLog('create', 'billing', billing.id, { seq: billing.seq, amount, projectId: _bpid });
    showToast(`${billingTypeLabel(type)} ${billingDisplayNo(billing)} added`);
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
      tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No collections yet.</td></tr>`;
      setText('collectionGrand', peso(0));
      scheduleBillingRollupRebuild(pid, { collectionsSnap: snap });
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
        <td class="b-cell">${escapeHtml(col.billingNo || (col.billingId ? col.billingId.slice(-8) : 'Auto / Unallocated'))}</td>
        <td class="b-cell b-right b-bold" style="color:var(--green)">${peso(collectionNet(col))}</td>
        <td class="b-cell b-right">${peso(col.unappliedAmount)}</td>
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
      <td class="b-cell" colspan="3">Total Collected</td>
      <td class="b-cell b-right" style="color:var(--green);font-weight:800">${peso(grand)}</td>
      <td></td><td></td>
    `;
    fragment.appendChild(totalTr);
    tbody.appendChild(fragment);
    setText('collectionGrand', peso(grand));

    firebase.database().ref(`projects/${pid}/contract`).once('value', cSnap => {
      if (cSnap.exists()) renderContractDashboard(cSnap.val(), pid);
    });
    scheduleBillingRollupRebuild(pid, { collectionsSnap: snap });
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
  const billingSelect = $('colBillingId');
  const billingId = billingSelect ? billingSelect.value : '';
  const billingNo = billingSelect && billingSelect.selectedOptions[0]
    ? billingSelect.selectedOptions[0].dataset.billingNo || ''
    : '';
  const retentionReleased = parseFloat(($('colRetentionReleased') && $('colRetentionReleased').value) || '') || 0;
  const referenceNo = (($('colReference') && $('colReference').value) || '').trim();
  if (!date) { showToast('Enter date received.', 'error'); return; }
  if (!desc) { showToast('Enter description.', 'error'); return; }
  if (amount <= 0) { showToast('Enter amount received.', 'error'); return; }
  if (retentionReleased < 0 || retentionReleased > amount) { showToast('Retention release cannot exceed collection amount.', 'error'); return; }
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
      billingId,
      billingNo,
      retentionReleased,
      referenceNo,
      type: 'collection'
    });
    $('colDate').value = ''; $('colDesc').value = ''; $('colAmount').value = '';
    if ($('colRetentionReleased')) $('colRetentionReleased').value = '';
    if ($('colReference')) $('colReference').value = '';
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

async function addBillingDeductionFromUI(billingId) {
  if (!_bpid || !billingId) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const amount = parseFloat(prompt('Deduction amount:') || '0') || 0;
  if (amount <= 0) {
    showToast('Deduction cancelled.', 'warn');
    return;
  }
  const reason = (prompt('Deduction reason:') || 'Billing deduction').trim();
  if (!reason) {
    showToast('Deduction reason is required.', 'error');
    return;
  }
  try {
    const deduction = await createBillingDeduction(_bpid, billingId, {
      amount,
      reason,
      description: reason,
      status: 'approved'
    });
    auditLog('create', 'billingDeduction', deduction.id, { billingId, amount, projectId: _bpid });
    showToast(`Deduction ${peso(amount)} applied`);
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Failed to apply deduction.', 'error');
  }
}

async function releaseRetentionFromUI(billingId) {
  if (!_bpid || !billingId) return;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const amount = parseFloat(prompt('Retention collection amount:') || '0') || 0;
  if (amount <= 0) {
    showToast('Retention collection cancelled.', 'warn');
    return;
  }
  const notes = (prompt('Retention collection notes:') || 'Retention released and collected').trim();
  try {
    const billingSnap = await billingProjectRef(_bpid, `billings/${billingId}`).once('value');
    const billing = { id: billingId, ...(billingSnap.val() || {}) };
    const collection = await recordCollection(_bpid, {
      amount,
      amountReceived: amount,
      retentionReleased: amount,
      billingId,
      billingNo: billingDisplayNo(billing),
      date: new Date().toISOString().slice(0, 10),
      description: notes,
      referenceNo: 'retention-release',
      type: 'retention_release_collection',
      status: 'posted',
      allocateToOldest: false
    });
    auditLog('collect', 'billingRetention', collection.id, { billingId, amount, projectId: _bpid });
    showToast(`Retention ${peso(amount)} collected`);
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Failed to collect retention.', 'error');
  }
}

async function generateBillingOutputForBilling(billingId, title = '') {
  if (!_bpid || !billingId) return null;
  if (!canTouchBillingProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return null;
  }
  try {
    const output = await generateBillingOutputSnapshot(_bpid, {
      billingId,
      title: title || 'Billing Output'
    });
    auditLog('archive', 'billingOutput', output.id, { billingId, projectId: _bpid });
    showToast(`${output.outputNo} archived`);
    return output;
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Failed to archive billing output.', 'error');
    return null;
  }
}

async function generateBillingOutputFromUI() {
  const select = $('outputBillingId');
  const billingId = select ? select.value : '';
  const title = (($('outputTitle') && $('outputTitle').value) || '').trim();
  if (!billingId) {
    showToast('Select an approved billing first.', 'error');
    return;
  }
  const output = await generateBillingOutputForBilling(billingId, title);
  if (output && $('outputTitle')) $('outputTitle').value = '';
}

function watchBillingOutputs(pid) {
  _billingOutputsListener = billingProjectRef(pid, 'billingOutputs');
  _billingOutputsListener.on('value', snap => {
    const tbody = $('billingOutputsBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!snap.exists()) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No archived billing outputs yet.</td></tr>`;
      return;
    }
    const rows = billingSnapRows(snap)
      .sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
    const fragment = document.createDocumentFragment();
    rows.forEach(output => {
      const totals = (output.snapshot && output.snapshot.totals) || {};
      const billingIds = Object.keys(output.sourceBillingIds || {});
      const tr = document.createElement('tr');
      tr.className = 'bill-row';
      tr.innerHTML = `
        <td class="b-cell">${escapeHtml(output.outputNo || output.id.slice(-8))}</td>
        <td class="b-cell">${output.generatedAt ? new Date(output.generatedAt).toLocaleDateString() : '\u2014'}</td>
        <td class="b-cell">${escapeHtml(output.title || 'Billing Output')}</td>
        <td class="b-cell">${escapeHtml(billingIds.length ? `${billingIds.length} billing(s)` : (output.billingId || '\u2014'))}</td>
        <td class="b-cell b-right b-bold">${peso(totals.netBillable)}</td>
        <td class="b-cell">${escapeHtml(output.status || 'archived')}</td>
      `;
      fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);
  });
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
window.createDownpaymentBilling = createDownpaymentBilling;
window.createMobilizationBilling = createMobilizationBilling;
window.listBillings = listBillings;
window.approveBilling = approveBilling;
window.recordCollection = recordCollection;
window.listCollections = listCollections;
window.listCollectionAllocations = listCollectionAllocations;
window.calculateBillingReceivable = calculateBillingReceivable;
window.validateCollectionAllocation = validateCollectionAllocation;
window.allocateCollectionToBilling = allocateCollectionToBilling;
window.allocateCollectionToOldestBillings = allocateCollectionToOldestBillings;
window.createAdjustment = createAdjustment;
window.updateBillingAdjustmentStatus = updateBillingAdjustmentStatus;
window.createBillingDeduction = createBillingDeduction;
window.approveBillingDeduction = approveBillingDeduction;
window.rejectBillingDeduction = rejectBillingDeduction;
window.voidBillingDeduction = voidBillingDeduction;
window.calculateRetentionForBilling = calculateRetentionForBilling;
window.releaseRetention = releaseRetention;
window.generateBillingOutputSnapshot = generateBillingOutputSnapshot;
window.listBillingOutputs = listBillingOutputs;
window.scheduleBillingRollupRebuild = scheduleBillingRollupRebuild;
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
window.addBillingDeductionFromUI = addBillingDeductionFromUI;
window.releaseRetentionFromUI = releaseRetentionFromUI;
window.generateBillingOutputForBilling = generateBillingOutputForBilling;
window.generateBillingOutputFromUI = generateBillingOutputFromUI;
window.exportBillingSummary = exportBillingSummary;
