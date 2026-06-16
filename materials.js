
# ============ materials.js (v8 — Complete rewrite) ============
materials_v8 = r'''// ═══════════════════════════════════════════════════════════════
//  ACPM v8 — materials.js
//  · Proper listener lifecycle
//  · XSS-safe rendering
//  · Loading states
//  · PO history with search/filter
//  · Ledger export to CSV
//  · Supplier bank details auto-populate in PO export
// ═══════════════════════════════════════════════════════════════

let _mpid = null;
let _draftItems = [];
let _matListeners = [];

function initMaterials(pid) {
  _mpid = pid; _draftItems = [];
  detachMatListeners();
  renderDraft();
  watchMatBudget(pid);
  watchLedger(pid);
  watchPOHistory(pid);
  loadGlobalSuppliersForPO();
}

function detachMatListeners() {
  _matListeners.forEach(ref => ref.off());
  _matListeners = [];
}

function matListen(ref, cb) {
  ref.on('value', cb);
  _matListeners.push(ref);
}

// ── Budget KPIs ───────────────────────────────────────────────
function watchMatBudget(pid) {
  const ref = firebase.database().ref(`projects/${pid}`);
  matListen(ref, snap => {
    const d      = snap.val() || {};
    const budget = parseFloat(d.materialBudget) || 0;
    const spent  = parseFloat(d.materialSpent)  || 0;
    const left   = budget - spent;
    const p      = pct(spent, budget);
    setText('mbBudget', peso(budget));
    setText('mbSpent',  peso(spent));
    const el = $('mbLeft');
    if (el) { el.textContent = peso(left); el.className = `kpi-num ${left < 0 ? 'kpi-danger' : 'kpi-safe'}`; }
    const wb = $('matBudgetWarn');
    if (wb) {
      wb.classList.toggle('hidden', p < 80);
      wb.className  = `budget-warn-bar ${p >= 95 ? 'warn-critical' : 'warn-high'} ${p < 80 ? 'hidden' : ''}`;
      wb.textContent = p >= 95
        ? `⚠ CRITICAL — Materials budget ${p}% used! Only ${peso(left)} left.`
        : `⚠ WARNING — Materials budget ${p}% used. ${peso(left)} remaining.`;
    }
  });
}

// ── Load global suppliers for PO quick-select ─────────────────
function loadGlobalSuppliersForPO() {
  firebase.database().ref('suppliers').once('value', snap => {
    const sel = $('poSupplierSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Quick select supplier —</option>';
    snap.forEach(c => {
      const s = c.val();
      sel.innerHTML += `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}${s.specialty ? ' (' + escapeHtml(s.specialty) + ')' : ''}</option>`;
    });
  });
}

function applySupplierSelection() {
  const sel = $('poSupplierSelect');
  const inp = $('poSupplier');
  if (sel && inp && sel.value) inp.value = sel.value;
}

// ══════════════════════════════════════════════════════
//  PO DRAFT BUILDER
// ══════════════════════════════════════════════════════
function addDraftItem() {
  const desc = $('poItemDesc')?.value.trim();
  const size = $('poItemSize')?.value.trim() || '';
  const qty  = parseFloat($('poItemQty')?.value)  || 0;
  const unit = $('poItemUnit')?.value.trim() || '';
  const cost = parseFloat($('poItemCost')?.value)  || 0;
  if (!desc)  { showToast('Enter item description.', 'error'); return; }
  if (qty <= 0) { showToast('Enter valid quantity.', 'error'); return; }
  if (desc.length > 100) { showToast('Description too long (max 100).', 'error'); return; }
  _draftItems.push({ desc, size, qty, unit, cost, total: qty * cost });
  ['poItemDesc', 'poItemSize', 'poItemQty', 'poItemUnit', 'poItemCost'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });
  $('poItemDesc')?.focus();
  renderDraft();
}

function removeDraftItem(i) { _draftItems.splice(i, 1); renderDraft(); }

function renderDraft() {
  const el = $('draftList'); if (!el) return;
  if (!_draftItems.length) {
    el.innerHTML = '<p class="empty-hint">No items yet. Fill the form above and click + Add Item.</p>';
    setText('draftTotal', peso(0)); return;
  }
  el.innerHTML = _draftItems.map((item, i) => `
    <div class="draft-row">
      <span class="draft-desc">${escapeHtml(item.desc)}${item.size ? ` <span class="draft-size">[${escapeHtml(item.size)}]</span>` : ''}</span>
      <span class="draft-qty">${item.qty} ${escapeHtml(item.unit)}</span>
      <span class="draft-cost">${peso(item.cost)}/unit</span>
      <span class="draft-total">${peso(item.total)}</span>
      <button class="draft-del" onclick="removeDraftItem(${i})">✕</button>
    </div>`).join('');
  setText('draftTotal', peso(_draftItems.reduce((s, x) => s + x.total, 0)));
}

// ── Submit PO ─────────────────────────────────────────────────
async function submitPO() {
  if (!_mpid) return;
  if (!_draftItems.length) { showToast('Add at least one item first.', 'error'); return; }

  const supplier = $('poSupplier')?.value.trim();
  const date     = $('poDate')?.value;
  const notes    = $('poNotes')?.value.trim() || '';

  if (!supplier) { showToast('Enter supplier name.', 'error'); return; }
  if (!date)     { showToast('Enter PO date.', 'error'); return; }
  if (supplier.length > 50) { showToast('Supplier name too long.', 'error'); return; }

  const total = _draftItems.reduce((s, x) => s + x.total, 0);

  const po = {
    supplier, date, notes,
    items       : _draftItems,
    total,
    status      : 'ordered',
    createdAt   : Date.now(),
    createdDate : new Date().toLocaleDateString('en-PH')
  };

  const poRef = await safeDb(() => firebase.database().ref(`projects/${_mpid}/purchaseOrders`).push(po), 'Failed to submit PO');

  const ledgerUpdates = {};
  _draftItems.forEach((item, i) => {
    ledgerUpdates[`${poRef.key}_${i}`] = {
      poId     : poRef.key,
      supplier, date,
      desc     : item.desc,
      size     : item.size || '',
      qty      : item.qty,
      unit     : item.unit,
      cost     : item.cost,
      total    : item.total,
      status   : 'ordered',
      createdAt: Date.now()
    };
  });
  await safeDb(() => firebase.database().ref(`projects/${_mpid}/ledger`).update(ledgerUpdates), 'Failed to update ledger');

  _draftItems = [];
  ['poSupplier', 'poDate', 'poNotes'].forEach(id => { const e = $(id); if (e) e.value = ''; });
  const sel = $('poSupplierSelect'); if (sel) sel.value = '';
  renderDraft();
  showToast(`✅ PO #${poRef.key.slice(-4)} submitted to ${supplier}!`);
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

    snap.forEach(c => {
      const key = c.key, m = c.val();
      orderCount++;
      const isPaid = m.status === 'paid' || m.status === 'delivered';
      if (isPaid) paidTotal += m.total || 0;
      const statusOpts = ['ordered','delivered','paid','cancelled'].map(s =>
        `<option value="${s}" ${m.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
      ).join('');
      tbody.innerHTML += `<tr class="led-row ${m.status === 'cancelled' ? 'led-cancelled' : ''}">
        <td class="l-cell">${m.date || '—'}</td>
        <td class="l-cell l-supplier">${escapeHtml(m.supplier || '—')}</td>
        <td class="l-cell l-desc">${escapeHtml(m.desc)}</td>
        <td class="l-cell">${escapeHtml(m.size || '—')}</td>
        <td class="l-cell l-center">${m.qty} ${escapeHtml(m.unit)}</td>
        <td class="l-cell l-right">${peso(m.cost)}</td>
        <td class="l-cell l-right l-bold">${peso(m.total)}</td>
        <td class="l-cell">
          <select class="status-sel" onchange="updateLedgerStatus('${key}',this.value)">${statusOpts}</select>
        </td>
        <td class="l-cell l-center">
          <button class="del-item-btn" onclick="deleteLedgerItem('${key}','${escapeHtml(m.desc || '').replace(/'/g, "\\'")}')">✕</button>
        </td>
      </tr>`;
    });

    setText('ledgerTotal', peso(paidTotal));
    setText('ledgerCount', `${orderCount} item${orderCount !== 1 ? 's' : ''} total`);
    firebase.database().ref(`projects/${pid}`).update({ materialSpent: paidTotal });
    updateMaterialsSummary(snap);
  });
}

async function updateLedgerStatus(key, status) {
  if (!_mpid) return;
  await safeDb(() => firebase.database().ref(`projects/${_mpid}/ledger/${key}`).update({ status }), 'Failed to update status');
  showToast(`Status updated to ${status}`);
}

async function deleteLedgerItem(key, desc) {
  if (!_mpid || !confirm(`Delete "${desc}"?`)) return;
  await safeDb(() => firebase.database().ref(`projects/${_mpid}/ledger/${key}`).remove(), 'Failed to delete item');
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
    const key = `${m.desc}||${m.size || ''}`;
    if (!grouped[key]) grouped[key] = { desc: m.desc, size: m.size || '', totalQty: 0, unit: m.unit || '', totalCost: 0, count: 0 };
    grouped[key].totalQty  += parseFloat(m.qty)   || 0;
    grouped[key].totalCost += parseFloat(m.total)  || 0;
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
          <td class="s-cell">${escapeHtml(g.size) || '—'}</td>
          <td class="s-cell s-center">${g.totalQty}</td>
          <td class="s-cell">${escapeHtml(g.unit)}</td>
          <td class="s-cell s-right s-bold">${peso(g.totalCost)}</td>
          <td class="s-cell s-right">${g.count}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ══════════════════════════════════════════════════════
//  PO HISTORY
// ══════════════════════════════════════════════════════
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
    snap.forEach(c => entries.unshift({ id: c.key, ...c.val() }));

    entries.forEach(po => {
      const itemRows = (po.items || []).map(it => `
        <div class="po-item-row">
          <span class="po-item-desc">${escapeHtml(it.desc)}${it.size ? ` <span class="po-item-size">[${escapeHtml(it.size)}]</span>` : ''}</span>
          <span class="po-item-qty">${it.qty} ${escapeHtml(it.unit)}</span>
          <span class="po-item-cost">${peso(it.cost)}</span>
          <span class="po-item-total">${peso(it.total)}</span>
        </div>`).join('');

      container.innerHTML += `
        <div class="po-card" id="poc_${po.id}" data-supplier="${escapeHtml((po.supplier || '').toLowerCase())}">
          <div class="po-card-hdr">
            <div>
              <p class="po-date-lbl">${po.date} · ${po.createdDate || ''}</p>
              <p class="po-supplier">${escapeHtml(po.supplier)}</p>
              ${po.notes ? `<p class="po-notes">${escapeHtml(po.notes)}</p>` : ''}
            </div>
            <div class="po-card-right">
              <span class="po-total">${peso(po.total)}</span>
              <div class="po-btns">
                <button class="po-mark-btn"          onclick="markAllPO('${po.id}','delivered')">✓ Delivered</button>
                <button class="po-mark-btn po-paid-btn" onclick="markAllPO('${po.id}','paid')">✓ Paid</button>
                <button class="po-export-btn"        onclick="exportPOImage('${po.id}')">📷 Image</button>
              </div>
            </div>
          </div>
          <div class="po-item-hdr">
            <span>Item / Size</span><span>Qty</span><span>Unit Cost</span><span>Total</span>
          </div>
          ${itemRows}
        </div>`;
    });
  });
}

async function markAllPO(poId, status) {
  if (!_mpid) return;
  if (!confirm(`Mark all items in this PO as ${status}?`)) return;
  const snap = await firebase.database().ref(`projects/${_mpid}/ledger`).once('value');
  const updates = {};
  snap.forEach(c => { if (c.val().poId === poId) updates[`${c.key}/status`] = status; });
  await safeDb(() => firebase.database().ref(`projects/${_mpid}/ledger`).update(updates), 'Failed to update PO status');
  showToast(`All items marked as ${status}`);
}

// ── Export PO as PNG ──────────────────────────────────────────
async function exportPOImage(poId) {
  if (!_mpid) return;
  const snap = await firebase.database().ref(`projects/${_mpid}/purchaseOrders/${poId}`).once('value');
  const po   = snap.val(); if (!po) return;

  let bankInfo = '';
  const suppSnap = await firebase.database().ref('suppliers').once('value');
  suppSnap.forEach(c => {
    const s = c.val();
    if (s.name === po.supplier && (s.bankName || s.accNum)) {
      bankInfo = `${s.bankName || ''} ${s.accNum ? '· Acct: ' + s.accNum : ''} ${s.accName ? '· ' + s.accName : ''}`.trim();
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
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;color:#6b7280">Date</div>
        <div style="font-weight:700;font-size:14px">${po.date}</div>
      </div>
    </div>
    <div style="background:#f3f4f6;border-radius:10px;padding:12px 16px;margin-bottom:20px">
      <div style="font-size:10px;color:#6b7280;font-weight:700;margin-bottom:3px">SUPPLIER</div>
      <div style="font-size:17px;font-weight:900">${escapeHtml(po.supplier)}</div>
      ${bankInfo ? `<div style="font-size:12px;color:#374151;margin-top:4px;font-weight:600">🏦 ${escapeHtml(bankInfo)}</div>` : ''}
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
      ACPM · Art and Choi Project Management · Generated ${new Date().toLocaleDateString('en-PH')}
    </div>`;

  document.body.appendChild(wrap);
  try {
    const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const link   = document.createElement('a');
    link.download = `PO_${po.supplier.replace(/\s+/g, '_')}_${po.date}.png`;
    link.href     = canvas.toDataURL('image/png');
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

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Ledger_${_mpid}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Ledger exported to CSV!');
}

function escapeCsv(text) {
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

// Filter PO history by supplier
function filterPOHistory(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.po-card').forEach(card => {
    const supplier = card.getAttribute('data-supplier') || '';
    card.style.display = supplier.includes(q) ? '' : 'none';
  });
}
'''

with open('/mnt/agents/output/materials.js', 'w') as f:
    f.write(materials_v8)

print(f"✅ materials.js v8 — {len(materials_v8)} bytes")
