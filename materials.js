// ═══════════════════════════════════════════════════════════════
//  ACPM v3 — materials.js
//  Purchase Orders · Item Ledger · History · PNG Export
// ═══════════════════════════════════════════════════════════════

let _matPid   = null;
let _draftItems = [];   // current PO draft items

// ── Boot ──────────────────────────────────────────────────────────
function initMaterials(pid) {
  _matPid = pid;
  _draftItems = [];
  renderDraft();
  watchBudgetMat(pid);
  watchLedger(pid);
  watchPOHistory(pid);
}

// ── Materials budget KPIs ─────────────────────────────────────────
function watchBudgetMat(pid) {
  listen(firebase.database().ref(`projects/${pid}`), snap => {
    const d      = snap.val() || {};
    const budget = parseFloat(d.materialBudget) || 0;
    const spent  = parseFloat(d.materialSpent)  || 0;
    const left   = budget - spent;
    setText('mbBudget', peso(budget));
    setText('mbSpent',  peso(spent));
    const el = $('mbLeft');
    if (el) { el.textContent = peso(left); el.className = `kpi-num ${left < 0 ? 'kpi-danger' : 'kpi-safe'}`; }
  });
}

// ══════════════════════════════════════════════════════
//  DRAFT PO — build before submitting
// ══════════════════════════════════════════════════════
function addDraftItem() {
  const desc = $('poItemDesc')?.value.trim();
  const qty  = parseFloat($('poItemQty')?.value)  || 0;
  const unit = $('poItemUnit')?.value.trim()       || '';
  const cost = parseFloat($('poItemCost')?.value)  || 0;

  if (!desc)   { alert('Enter item description.'); return; }
  if (qty <= 0) { alert('Enter valid quantity.'); return; }

  _draftItems.push({ desc, qty, unit, cost, total: qty * cost });
  $('poItemDesc').value = '';
  $('poItemQty').value  = '';
  $('poItemUnit').value = '';
  $('poItemCost').value = '';
  renderDraft();
}

function removeDraftItem(i) {
  _draftItems.splice(i, 1);
  renderDraft();
}

function renderDraft() {
  const el = $('draftList');
  if (!el) return;

  if (!_draftItems.length) {
    el.innerHTML = '<p class="empty-hint">No items added yet. Fill the form above and click Add Item.</p>';
    setText('draftTotal', peso(0));
    return;
  }

  el.innerHTML = _draftItems.map((item, i) => `
    <div class="draft-row">
      <span class="draft-desc">${item.desc}</span>
      <span class="draft-qty">${item.qty} ${item.unit}</span>
      <span class="draft-cost">${peso(item.cost)}/unit</span>
      <span class="draft-total">${peso(item.total)}</span>
      <button class="draft-del" onclick="removeDraftItem(${i})">✕</button>
    </div>`).join('');

  const total = _draftItems.reduce((s, x) => s + x.total, 0);
  setText('draftTotal', peso(total));
}

// ══════════════════════════════════════════════════════
//  SUBMIT PO
// ══════════════════════════════════════════════════════
async function submitPO() {
  if (!_matPid) return;
  if (!_draftItems.length) { alert('Add at least one item first.'); return; }

  const supplier = $('poSupplier')?.value.trim();
  const date     = $('poDate')?.value;
  const notes    = $('poNotes')?.value.trim() || '';

  if (!supplier) { alert('Enter supplier name.'); return; }
  if (!date)     { alert('Enter PO date.'); return; }

  const total = _draftItems.reduce((s, x) => s + x.total, 0);

  const po = {
    supplier,
    date,
    notes,
    items:      _draftItems,
    total,
    status:     'ordered',
    createdAt:  Date.now(),
    createdDate: new Date().toLocaleDateString('en-PH')
  };

  // Save PO
  const poRef = await firebase.database().ref(`projects/${_matPid}/purchaseOrders`).push(po);

  // Save each item to the flat ledger
  const ledgerUpdates = {};
  _draftItems.forEach((item, i) => {
    const key = `${poRef.key}_${i}`;
    ledgerUpdates[key] = {
      poId:     poRef.key,
      supplier,
      date,
      desc:     item.desc,
      qty:      item.qty,
      unit:     item.unit,
      cost:     item.cost,
      total:    item.total,
      status:   'ordered',
      createdAt: Date.now()
    };
  });
  await firebase.database().ref(`projects/${_matPid}/ledger`).update(ledgerUpdates);

  // Clear draft
  _draftItems = [];
  $('poSupplier').value = '';
  $('poDate').value     = '';
  $('poNotes').value    = '';
  renderDraft();

  alert(`✅ PO submitted! ${_draftItems.length} items · ${peso(total)}`);
}

// ══════════════════════════════════════════════════════
//  LEDGER — all items flat
// ══════════════════════════════════════════════════════
function watchLedger(pid) {
  listen(firebase.database().ref(`projects/${pid}/ledger`), snap => {
    const tbody = $('ledgerBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let paidTotal = 0;

    if (!snap.exists()) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">No items yet. Create a Purchase Order above.</td></tr>`;
      setText('ledgerTotal', peso(0));
      return;
    }

    snap.forEach(c => {
      const key = c.key;
      const m   = c.val();
      const isPaid = m.status === 'paid' || m.status === 'delivered';
      if (isPaid) paidTotal += m.total || 0;

      const statusOpts = ['ordered','delivered','paid','cancelled']
        .map(s => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`)
        .join('');

      tbody.innerHTML += `
        <tr class="led-row ${m.status === 'cancelled' ? 'led-cancelled' : ''}">
          <td class="l-cell">${m.date || '—'}</td>
          <td class="l-cell l-supplier">${m.supplier || '—'}</td>
          <td class="l-cell l-desc">${m.desc}</td>
          <td class="l-cell l-center">${m.qty} ${m.unit}</td>
          <td class="l-cell l-right">${peso(m.cost)}</td>
          <td class="l-cell l-right l-bold">${peso(m.total)}</td>
          <td class="l-cell">
            <select class="status-sel" onchange="updateLedgerStatus('${key}',this.value,'${m.poId}')">
              ${statusOpts}
            </select>
          </td>
          <td class="l-cell l-center">
            <button class="del-item-btn" onclick="deleteLedgerItem('${key}','${m.desc}')">✕</button>
          </td>
        </tr>`;
    });

    // Update paid/delivered total and project aggregate
    setText('ledgerTotal', peso(paidTotal));
    firebase.database().ref(`projects/${pid}`).update({ materialSpent: paidTotal });
  });
}

async function updateLedgerStatus(key, status, poId) {
  if (!_matPid) return;
  await firebase.database().ref(`projects/${_matPid}/ledger/${key}`).update({ status });
  // also update on PO if needed
}

async function deleteLedgerItem(key, desc) {
  if (!_matPid || !confirm(`Delete "${desc}"?`)) return;
  await firebase.database().ref(`projects/${_matPid}/ledger/${key}`).remove();
}

// ══════════════════════════════════════════════════════
//  PO HISTORY
// ══════════════════════════════════════════════════════
function watchPOHistory(pid) {
  listen(firebase.database().ref(`projects/${pid}/purchaseOrders`), snap => {
    const container = $('poHistory');
    if (!container) return;
    container.innerHTML = '';

    if (!snap.exists()) {
      container.innerHTML = '<p class="empty-hint" style="padding:20px">No purchase orders yet.</p>';
      return;
    }

    const entries = [];
    snap.forEach(c => entries.unshift({ id: c.key, ...c.val() }));

    entries.forEach(po => {
      const itemRows = (po.items || []).map(it =>
        `<div class="po-item-row">
          <span class="po-item-desc">${it.desc}</span>
          <span class="po-item-qty">${it.qty} ${it.unit}</span>
          <span class="po-item-cost">${peso(it.cost)}</span>
          <span class="po-item-total">${peso(it.total)}</span>
        </div>`
      ).join('');

      container.innerHTML += `
        <div class="po-card">
          <div class="po-card-hdr">
            <div>
              <p class="po-date-lbl">${po.date}</p>
              <p class="po-supplier">${po.supplier}</p>
              ${po.notes ? `<p class="po-notes">${po.notes}</p>` : ''}
            </div>
            <div class="po-card-right">
              <span class="po-total">${peso(po.total)}</span>
              <button class="po-export-btn" onclick="exportPOImage('${po.id}')">📷 Save as Image</button>
            </div>
          </div>
          <div class="po-item-hdr">
            <span>Item</span><span>Qty</span><span>Unit Cost</span><span>Total</span>
          </div>
          ${itemRows}
        </div>`;
    });
  });
}

// ══════════════════════════════════════════════════════
//  EXPORT PO AS PNG IMAGE
// ══════════════════════════════════════════════════════
async function exportPOImage(poId) {
  if (!_matPid) return;

  const snap = await firebase.database().ref(`projects/${_matPid}/purchaseOrders/${poId}`).once('value');
  const po   = snap.val();
  if (!po) return;

  // Build an off-screen render div styled for a clean PNG
  const wrap = document.createElement('div');
  wrap.style.cssText = `
    position:fixed; left:-9999px; top:0;
    width:600px; background:#ffffff; color:#111111;
    font-family:'Segoe UI',Arial,sans-serif; font-size:13px;
    padding:32px; box-sizing:border-box;`;

  const itemsHTML = (po.items || []).map(it => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${it.desc}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${it.qty} ${it.unit}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${peso(it.cost)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700">${peso(it.total)}</td>
    </tr>`).join('');

  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#6b7280;margin-bottom:4px">PURCHASE ORDER</div>
        <div style="font-size:22px;font-weight:900;color:#111">${_matPid}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:#6b7280">Date</div>
        <div style="font-weight:700">${po.date}</div>
      </div>
    </div>
    <div style="background:#f3f4f6;border-radius:8px;padding:12px 16px;margin-bottom:20px">
      <div style="font-size:11px;color:#6b7280;font-weight:700;margin-bottom:2px">SUPPLIER</div>
      <div style="font-size:16px;font-weight:800">${po.supplier}</div>
      ${po.notes ? `<div style="font-size:12px;color:#6b7280;margin-top:4px">${po.notes}</div>` : ''}
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#1e293b;color:#fff">
          <th style="padding:8px;text-align:left;font-size:11px;font-weight:700">ITEM</th>
          <th style="padding:8px;text-align:center;font-size:11px;font-weight:700">QTY</th>
          <th style="padding:8px;text-align:right;font-size:11px;font-weight:700">UNIT COST</th>
          <th style="padding:8px;text-align:right;font-size:11px;font-weight:700">TOTAL</th>
        </tr>
      </thead>
      <tbody>${itemsHTML}</tbody>
    </table>
    <div style="display:flex;justify-content:flex-end;margin-top:16px">
      <div style="background:#0f172a;color:#fff;border-radius:8px;padding:12px 20px;text-align:right">
        <div style="font-size:11px;color:#94a3b8;font-weight:600;margin-bottom:2px">TOTAL AMOUNT</div>
        <div style="font-size:22px;font-weight:900">${peso(po.total)}</div>
      </div>
    </div>
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;text-align:center">
      ACPM · Art and Choi Project Management · Generated ${new Date().toLocaleDateString('en-PH')}
    </div>`;

  document.body.appendChild(wrap);

  try {
    const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const link   = document.createElement('a');
    link.download = `PO_${po.supplier.replace(/\s+/g,'_')}_${po.date}.png`;
    link.href     = canvas.toDataURL('image/png');
    link.click();
  } catch (e) {
    alert('Export failed. Make sure html2canvas is loaded.');
    console.error(e);
  } finally {
    document.body.removeChild(wrap);
  }
}

// ── Util ──────────────────────────────────────────────────────────
function setText(id, v) { const e = $(id); if (e) e.textContent = v; }