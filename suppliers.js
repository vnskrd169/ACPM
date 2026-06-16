// ═══════════════════════════════════════════════════════════════
//  ACPM v6 — suppliers.js
//  GLOBAL suppliers (not per-project)
//  · Bank name + account number stored per supplier
//  · Bank details appear in PO PNG export automatically
//  · "Use in PO" switches to Orders tab and fills supplier name
// ═══════════════════════════════════════════════════════════════

function initSuppliers() {
  watchGlobalSuppliers();
}

function watchGlobalSuppliers() {
  listen(firebase.database().ref('suppliers'), snap => {
    const el = $('supplierList'); if (!el) return;
    el.innerHTML = '';

    if (!snap.exists()) {
      el.innerHTML = '<p class="empty-hint">No suppliers yet. Add one above.</p>';
      return;
    }

    snap.forEach(c => {
      const s   = c.val();
      const key = c.key;
      el.innerHTML += `
        <div class="supplier-card">
          <div class="supplier-info">
            <span class="supplier-name">${s.name}</span>
            ${s.specialty ? `<span class="supplier-specialty">${s.specialty}</span>` : ''}
            ${s.contact   ? `<span class="supplier-contact">📞 ${s.contact}</span>` : ''}
            ${s.bankName||s.accNum ? `
              <div class="supplier-bank">
                🏦 ${s.bankName||''} ${s.accNum?'· Acct: '+s.accNum:''} ${s.accName?'· '+s.accName:''}
              </div>` : ''}
          </div>
          <div class="supplier-actions">
            <button class="btn-use-supplier" onclick="useSupplierInPO('${s.name}')">Use in PO</button>
            <button class="btn-edit-supplier" onclick="editSupplier('${key}')">✎ Edit</button>
            <button class="btn-del-supplier"  onclick="deleteSupplier('${key}','${(s.name||'').replace(/'/g,"\\'")}')">✕</button>
          </div>
        </div>`;
    });

    // Refresh PO quick-select whenever suppliers change
    if (typeof loadGlobalSuppliersForPO === 'function') loadGlobalSuppliersForPO();
  });
}

async function addSupplier() {
  const name    = $('supName')?.value.trim();
  const contact = $('supContact')?.value.trim()   || '';
  const spec    = $('supSpecialty')?.value.trim()  || '';
  const bank    = $('supBank')?.value.trim()       || '';
  const accNum  = $('supAccNum')?.value.trim()     || '';
  const accName = $('supAccName')?.value.trim()    || '';

  if (!name) { showToast('Enter supplier name.','error'); return; }

  await firebase.database().ref('suppliers').push({
    name, contact, specialty: spec,
    bankName: bank, accNum, accName,
    addedAt: Date.now()
  });

  ['supName','supContact','supSpecialty','supBank','supAccNum','supAccName'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });
  showToast(`✅ ${name} added to directory`);
}

async function editSupplier(key) {
  const snap = await firebase.database().ref(`suppliers/${key}`).once('value');
  const s    = snap.val() || {};

  // Populate edit modal
  $('editSupKey').value     = key;
  $('editSupName').value    = s.name    || '';
  $('editSupContact').value = s.contact || '';
  $('editSupSpec').value    = s.specialty || '';
  $('editSupBank').value    = s.bankName  || '';
  $('editSupAccNum').value  = s.accNum    || '';
  $('editSupAccName').value = s.accName   || '';
  $('editSupplierModal').classList.remove('hidden');
}

async function saveEditSupplier() {
  const key     = $('editSupKey').value;
  const name    = $('editSupName').value.trim();
  const contact = $('editSupContact').value.trim() || '';
  const spec    = $('editSupSpec').value.trim()    || '';
  const bank    = $('editSupBank').value.trim()    || '';
  const accNum  = $('editSupAccNum').value.trim()  || '';
  const accName = $('editSupAccName').value.trim() || '';

  if (!name) { showToast('Name is required.','error'); return; }

  await firebase.database().ref(`suppliers/${key}`).update({
    name, contact, specialty: spec, bankName: bank, accNum, accName
  });
  $('editSupplierModal').classList.add('hidden');
  showToast(`${name} updated`);
}

function closeEditSupplier() { $('editSupplierModal').classList.add('hidden'); }

async function deleteSupplier(key, name) {
  if (!confirm(`Delete supplier "${name}" from the entire system?`)) return;
  await firebase.database().ref(`suppliers/${key}`).remove();
  showToast(`${name} removed`,'warn');
}

function useSupplierInPO(name) {
  switchTab('materials');
  const inp = $('poSupplier');
  if (inp) { inp.value = name; inp.focus(); }
  showToast(`${name} selected for PO`);
}