// Live probe: do the deployed Production rules allow PM to write PO + payroll paths?
// Uses pm.qa on a scratch QA project seeded via console access. Self-cleaning.
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROD_KEY = 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA';
const DB = 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app';
const EMAIL = 'pm.qa@lebuild.test';
const PASS = 'Lebuild2026';

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let b = null;
        try { b = JSON.parse(d); } catch { b = d; }
        resolve({ status: res.statusCode, body: b });
      });
    });
    r.on('error', reject);
    if (opts.body) r.write(JSON.stringify(opts.body));
    r.end();
  });
}

(async () => {
  // 1) console token for seeding/cleanup
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
  const token = cfg.tokens.access_token;

  // 2) sign in as PM
  const auth = await req(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${PROD_KEY}`, {
    method: 'POST',
    body: { email: EMAIL, password: PASS, returnSecureToken: true }
  });
  const idToken = auth.body.idToken;
  const pmUid = auth.body.localId;
  console.log('PM sign-in:', auth.status, 'uid=', pmUid);

  // 3) find pm uid in users node (in case localId differs from assigned uid)
  const users = await req(`${DB}/users.json?access_token=${token}`);
  let assignedUid = null;
  Object.entries(users.body || {}).forEach(([uid, u]) => {
    if ((u.email || '').toLowerCase() === EMAIL) assignedUid = uid;
  });
  console.log('Assigned uid in DB:', assignedUid, '(auth uid:', pmUid + ')');
  const uid = assignedUid || pmUid;

  // 4) seed scratch project
  const pid = 'qa_probe_' + Date.now().toString(36);
  const now = Date.now();
  const seed = {
    name: 'QA RULES PROBE - DELETE AFTER',
    status: 'active',
    createdAt: now,
    materialBudget: 500000,
    materialBudgetDelta: 0,
    materialSpent: 0,
    materialCommitted: 0,
    members: { [uid]: { role: 'pm', joinedAt: now } },
    assignments: { [uid]: { role: 'pm', joinedAt: now } }
  };
  let r = await req(`${DB}/projects/${pid}.json?access_token=${token}`, { method: 'PUT', body: seed });
  console.log('seed project:', r.status, pid);
  r = await req(`${DB}/users/${uid}/projects/${pid}.json?access_token=${token}`, { method: 'PUT', body: { role: 'pm', joinedAt: now } });
  console.log('assign user:', r.status);

  const authQ = `?auth=${idToken}`;
  const base = `${DB}/projects/${pid}`;
  const results = [];

  // 5) PO write path probe (mirrors createPurchaseOrder writes)
  const poId = 'po_probe';
  const itemKey = 'probe_item';
  const po = {
    supplier: 'Probe Supplier', supplierName: 'Probe Supplier', supplierId: '',
    date: new Date().toISOString().slice(0, 10), notes: '', urgency: 'normal',
    items: [{ itemId: 'item_001', itemKey, desc: 'Probe Item', description: 'Probe Item', size: '', qty: 1, qtyOrdered: 1, qtyReceived: 0, qtyAccepted: 0, qtyRejected: 0, qtyCancelled: 0, qtyRemaining: 1, unit: 'pc', cost: 100, unitCost: 100, total: 100, totalCost: 100, reorderPoint: 1 }],
    total: 100, committedCost: 0, receivedCost: 0, issuedCost: 0,
    seq: 1, poNo: 'PO-001', status: 'pending_approval', deliveryStatus: 'not_ordered', invoiceStatus: 'none',
    approvalWorkflow: { submittedBy: uid, submittedAt: now, approvedBy: null, approvedAt: null },
    createdAt: now, createdBy: uid, createdDate: new Date(now).toLocaleDateString('en-PH')
  };

  // a) poCounter transaction (needs READ + WRITE for a JS-SDK transaction)
  r = await req(`${base}/poCounter.json${authQ}`);
  results.push(['poCounter read (tx requires)', r.status]);
  r = await req(`${base}/poCounter.json${authQ}`, { method: 'PUT', body: 1 });
  results.push(['poCounter write (tx base)', r.status]);

  // a2) multi-path PATCH with a COMPLETE movement object (app never writes partial movements)
  const poUpdates = {};
  poUpdates[`purchaseOrders/${poId}/poNo`] = 'PO-001';
  poUpdates[`ledger/${poId}_item_001/status`] = 'pending_approval';
  poUpdates[`materialMovements/m_probe3`] = { type: 'po_submit', createdAt: now, createdBy: uid, movementCost: 100, sourceType: 'purchaseOrder', sourceId: poId, poId, supplierName: 'Probe Supplier' };
  r = await req(`${base}.json${authQ}`, { method: 'PATCH', body: poUpdates });
  results.push(['multi-path PATCH (complete movement object)', r.status]);

  // b) purchaseOrders write
  r = await req(`${base}/purchaseOrders/${poId}.json${authQ}`, { method: 'PUT', body: po });
  results.push(['purchaseOrders write', r.status]);

  // c) ledger write
  r = await req(`${base}/ledger/${poId}_item_001.json${authQ}`, {
    method: 'PUT',
    body: { poId, poItemId: 'item_001', supplier: 'Probe Supplier', supplierName: 'Probe Supplier', supplierId: '', date: po.date, desc: 'Probe Item', size: '', qty: 1, unit: 'pc', cost: 100, total: 100, status: 'pending_approval', createdAt: now }
  });
  results.push(['ledger write', r.status]);

  // d) inventory write
  r = await req(`${base}/inventory/${itemKey}.json${authQ}`, {
    method: 'PUT',
    body: { itemKey, item: 'Probe Item', description: 'Probe Item', size: '', unit: 'pc', qtyOnHand: 0, avgCost: 100, totalValue: 0, reorderPoint: 1, lastUpdated: now, lastMovementAt: now }
  });
  results.push(['inventory write', r.status]);

  // e) materialMovements write
  r = await req(`${base}/materialMovements/m_probe.json${authQ}`, {
    method: 'PUT',
    body: { type: 'po_submit', date: po.date, createdAt: now, createdBy: uid, itemKey, description: 'Probe Item', size: '', unit: 'pc', qtyIn: 0, qtyOut: 0, unitCost: 100, movementCost: 100, balanceAfter: 0, sourceType: 'purchaseOrder', sourceId: poId, poId, deliveryId: '', issueId: '', supplierId: '', supplierName: 'Probe Supplier', notes: '' }
  });
  results.push(['materialMovements write', r.status]);

  // f) full PO object + materialMovements + ledger + inventory in one update (exactly what createPurchaseOrder does)
  const updates = {};
  updates[`purchaseOrders/${poId}`] = { ...po, status: 'pending_approval' };
  updates[`ledger/${poId}_item_001/status`] = 'pending_approval';
  updates[`inventory/${itemKey}/qtyOnHand`] = 0;
  updates[`materialMovements/m_probe2`] = { type: 'po_submit', createdAt: now, createdBy: uid, movementCost: 100, sourceType: 'purchaseOrder', sourceId: poId, poId, supplierName: 'Probe Supplier' };
  r = await req(`${base}.json${authQ}`, { method: 'PATCH', body: updates });
  results.push(['full multi-path update (exact createPurchaseOrder)', r.status]);

  // g) payrollLogs write (mirrors compilePayroll save)
  const logKey = 'wk_probe';
  const payrollLog = {
    weekKey: '2026-08-03_2026-08-08',
    compiledAt: now, compiledBy: uid,
    gross: 1000, net: 900, cashAdvanceDeductions: 100,
    status: 'released',
    workerCount: 1,
    notes: 'QA probe'
  };
  r = await req(`${base}/payrollLogs/${logKey}.json${authQ}`, { method: 'PUT', body: payrollLog });
  results.push(['payrollLogs write', r.status]);

  // h) attendanceHistory / advance transitions used by compilePayroll
  r = await req(`${base}/attendanceHistory/wk_probe.json${authQ}`, { method: 'PUT', body: { worker1: { present: true } } });
  results.push(['attendanceHistory write', r.status]);

  console.log('\n=== PROBE RESULTS ===');
  results.forEach(([label, status]) => {
    const ok = status === 200;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${status} ${label}`);
  });
  const allOk = results.every(([, s]) => s === 200);
  console.log(allOk ? '\nALL WRITES ALLOWED by deployed rules' : '\nSOME WRITES DENIED by deployed rules');

  // 6) cleanup
  r = await req(`${DB}/projects/${pid}.json?access_token=${token}`, { method: 'DELETE' });
  console.log('cleanup project:', r.status);
  r = await req(`${DB}/users/${uid}/projects/${pid}.json?access_token=${token}`, { method: 'DELETE' });
  console.log('cleanup assignment:', r.status);
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(2); });
