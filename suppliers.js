let _supListener = null;

function initSuppliers() {
  if (_supListener) { _supListener.off(); _supListener = null; }
  watchGlobalSuppliers();
}

function detachSupplierListeners() {
  if (_supListener) { _supListener.off(); _supListener = null; }
}

function watchGlobalSuppliers() {
  _supListener = firebase.database().ref('suppliers');
  _supListener.on('value', snap => {
    const el = $('supplierList');
    if (!el) return;
    el.innerHTML = '';

    if (!snap.exists()) {
      el.innerHTML = '<p class="empty-hint">No suppliers yet. Add one above.</p>';
      refreshSupplierDropdown(snap);
      return;
    }

    const suppliers = [];
    snap.forEach(c => suppliers.push({ key: c.key, ...c.val() }));
    suppliers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const fragment = document.createDocumentFragment();
    suppliers.forEach(s => {
      const bankLine = (s.bankName || s.accNum)
        ? `<div class="supplier-bank">🏦 ${escapeHtml(s.bankName || '')} ${s.accNum ? '· Acct: ' + escapeHtml(s.accNum) : ''} ${s.accName ? '· ' + escapeHtml(s.accName) : ''}</div>`
        : '';
      
      const card = document.createElement('div');
      card.className = 'supplier-card';
      card.setAttribute('data-name', escapeHtml((s.name || '').toLowerCase()));
      card.innerHTML = `
        <div class="supplier-info">
          <span class="supplier-name">${escapeHtml(s.name)}</span>
          ${s.specialty ? `<span class="supplier-specialty">${escapeHtml(s.specialty)}</span>` : ''}
          ${s.contact ? `<span class="supplier-contact">📞 ${escapeHtml(s.contact)}</span>` : ''}
          ${bankLine}
        </div>
        <div class="supplier-actions">
          <button class="btn-use-supplier" aria-label="Use ${escapeHtml(s.name)} in PO" onclick="useSupplierInPO('${escapeHtml(s.name).replace(/'/g, "\\'")}')">Use in PO</button>
          <button class="btn-edit-supplier" aria-label="Edit ${escapeHtml(s.name)}" onclick="openEditSupplier('${s.key}')">✎ Edit</button>
          <button class="btn-del-supplier" aria-label="Delete ${escapeHtml(s.name)}" onclick="deleteSupplier('${s.key}','${escapeHtml(s.name).replace(/'/g, "\\'")}')">✕</button>
        </div>
      `;
      fragment.appendChild(card);
    });

    el.appendChild(fragment);
    refreshSupplierDropdown(snap);
  });
}

async function addSupplier() {
  const name = $('supName')?.value.trim();
  const contact = $('supContact')?.value.trim() || '';
  const spec = $('supSpecialty')?.value.trim() || '';
  const bank = $('supBank')?.value.trim() || '';
  const accNum = $('supAccNum')?.value.trim() || '';
  const accName = $('supAccName')?.value.trim() || '';
  if (!name) { showToast('Enter supplier name.', 'error'); return; }
  if (name.length > 50) { showToast('Name too long (max 50).', 'error'); return; }
  
  await safeDb(() => firebase.database().ref('suppliers').push({
    name, contact, specialty: spec, bankName: bank, accNum, accName, addedAt: Date.now(), addedBy: _currentUser.uid
  }), 'Failed to add supplier');
  
  ['supName', 'supContact', 'supSpecialty', 'supBank', 'supAccNum', 'supAccName'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });
  auditLog('create', 'supplier', null, { name });
  showToast(`✅ ${name} added`);
}

function openEditSupplier(key) {
  firebase.database().ref(`suppliers/${key}`).once('value', snap => {
    const s = snap.val() || {};
    $('editSupKey').value = key;
    $('editSupName').value = s.name || '';
    $('editSupContact').value = s.contact || '';
    $('editSupSpec').value = s.specialty || '';
    $('editSupBank').value = s.bankName || '';
    $('editSupAccNum').value = s.accNum || '';
    $('editSupAccName').value = s.accName || '';
    $('editSupplierModal').classList.remove('hidden');
  });
}

function closeEditSupplier() {
  $('editSupplierModal').classList.add('hidden');
}

async function saveEditSupplier() {
  const key = $('editSupKey').value;
  const name = $('editSupName').value.trim();
  const contact = $('editSupContact').value.trim() || '';
  const spec = $('editSupSpec').value.trim() || '';
  const bank = $('editSupBank').value.trim() || '';
  const accNum = $('editSupAccNum').value.trim() || '';
  const accName = $('editSupAccName').value.trim() || '';
  if (!name) { showToast('Name required.', 'error'); return; }
  if (name.length > 50) { showToast('Name too long.', 'error'); return; }
  
  await safeDb(() => firebase.database().ref(`suppliers/${key}`).update({
    name, contact, specialty: spec, bankName: bank, accNum, accName, updatedAt: Date.now(), updatedBy: _currentUser.uid
  }), 'Failed to update supplier');
  
  closeEditSupplier();
  auditLog('update', 'supplier', key, { name });
  showToast(`${name} updated ✓`);
}

async function deleteSupplier(key, name) {
  if (!confirm(`Delete supplier "${name}" from the entire system?`)) return;
  await safeDb(() => firebase.database().ref(`suppliers/${key}`).remove(), 'Failed to delete supplier');
  auditLog('delete', 'supplier', key, { name });
  showToast(`${name} removed`, 'warn');
}

function useSupplierInPO(name) {
  switchTab('materials');
  const inp = $('poSupplier');
  if (inp) { inp.value = name; inp.focus(); }
  showToast(`${name} selected for PO`);
}

function filterSuppliers(query) {
  const cards = document.querySelectorAll('.supplier-card');
  const q = query.toLowerCase().trim();
  cards.forEach(card => {
    const name = card.getAttribute('data-name') || '';
    card.style.display = name.includes(q) ? 'flex' : 'none';
  });
}

async function exportSuppliersCSV() {
  const snap = await firebase.database().ref('suppliers').once('value');
  if (!snap.exists()) { showToast('No suppliers to export.', 'warn'); return; }

  let csv = 'Name,Contact,Specialty,Bank Name,Account Number,Account Name\n';
  snap.forEach(c => {
    const s = c.val();
    csv += `${escapeCsv(s.name || '')},${escapeCsv(s.contact || '')},${escapeCsv(s.specialty || '')},${escapeCsv(s.bankName || '')},${escapeCsv(s.accNum || '')},${escapeCsv(s.accName || '')}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Suppliers_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Suppliers exported!');
}
