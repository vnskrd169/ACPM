// ═══════════════════════════════════════════════════════════════
//  ACPM v6 — suppliers.js  (FIXED)
//  · Global — stored at root /suppliers, NOT per project
//  · Bank name + account number + account name stored
//  · Bank details auto-appear in PO PNG export
//  · Edit uses a proper modal (not prompt)
//  · "Use in PO" fills the PO supplier field directly
// ═══════════════════════════════════════════════════════════════

function initSuppliers() { watchGlobalSuppliers(); }

function watchGlobalSuppliers() {
  listen(firebase.database().ref('suppliers'), snap => {
    const el = document.getElementById('supplierList');
    if (!el) return;
    el.innerHTML = '';

    if (!snap.exists()) {
      el.innerHTML = '<p class="empty-hint">No suppliers yet. Add one above.</p>';
      refreshSupplierDropdown(snap);
      return;
    }

    snap.forEach(c => {
      const s = c.val(), key = c.key;
      const bankLine = (s.bankName||s.accNum)
        ? `<div class="supplier-bank">🏦 ${s.bankName||''} ${s.accNum?'· Acct: '+s.accNum:''} ${s.accName?'· '+s.accName:''}</div>`
        : '';
      el.innerHTML += `
        <div class="supplier-card">
          <div class="supplier-info">
            <span class="supplier-name">${s.name}</span>
            ${s.specialty?`<span class="supplier-specialty">${s.specialty}</span>`:''}
            ${s.contact?`<span class="supplier-contact">📞 ${s.contact}</span>`:''}
            ${bankLine}
          </div>
          <div class="supplier-actions">
            <button class="btn-use-supplier"  onclick="useSupplierInPO('${s.name.replace(/'/g,"\\'")}')">Use in PO</button>
            <button class="btn-edit-supplier" onclick="openEditSupplier('${key}')">✎ Edit</button>
            <button class="btn-del-supplier"  onclick="deleteSupplier('${key}','${s.name.replace(/'/g,"\\'")}')">✕</button>
          </div>
        </div>`;
    });

    refreshSupplierDropdown(snap);
  });
}

function refreshSupplierDropdown(snap) {
  const sel = document.getElementById('poSupplierSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Quick-select supplier —</option>';
  if (snap && snap.exists()) {
    snap.forEach(c => {
      const s = c.val();
      sel.innerHTML += `<option value="${s.name}">${s.name}${s.specialty?' ('+s.specialty+')':''}</option>`;
    });
  }
}

function applySupplierSelection() {
  const sel = document.getElementById('poSupplierSelect');
  const inp = document.getElementById('poSupplier');
  if (sel && inp && sel.value) { inp.value = sel.value; sel.value = ''; }
}

async function addSupplier() {
  const name    = document.getElementById('supName')?.value.trim();
  const contact = document.getElementById('supContact')?.value.trim()  || '';
  const spec    = document.getElementById('supSpecialty')?.value.trim()|| '';
  const bank    = document.getElementById('supBank')?.value.trim()     || '';
  const accNum  = document.getElementById('supAccNum')?.value.trim()   || '';
  const accName = document.getElementById('supAccName')?.value.trim()  || '';
  if (!name) { showToast('Enter supplier name.','error'); return; }
  await firebase.database().ref('suppliers').push({ name, contact, specialty:spec, bankName:bank, accNum, accName, addedAt:Date.now() });
  ['supName','supContact','supSpecialty','supBank','supAccNum','supAccName'].forEach(id=>{ const e=document.getElementById(id); if(e)e.value=''; });
  showToast(`✅ ${name} added`);
}

// Edit supplier via modal
function openEditSupplier(key) {
  firebase.database().ref(`suppliers/${key}`).once('value', snap => {
    const s = snap.val() || {};
    document.getElementById('editSupKey').value     = key;
    document.getElementById('editSupName').value    = s.name     || '';
    document.getElementById('editSupContact').value = s.contact  || '';
    document.getElementById('editSupSpec').value    = s.specialty|| '';
    document.getElementById('editSupBank').value    = s.bankName || '';
    document.getElementById('editSupAccNum').value  = s.accNum   || '';
    document.getElementById('editSupAccName').value = s.accName  || '';
    document.getElementById('editSupplierModal').classList.remove('hidden');
  });
}
function closeEditSupplier() { document.getElementById('editSupplierModal').classList.add('hidden'); }
async function saveEditSupplier() {
  const key     = document.getElementById('editSupKey').value;
  const name    = document.getElementById('editSupName').value.trim();
  const contact = document.getElementById('editSupContact').value.trim() || '';
  const spec    = document.getElementById('editSupSpec').value.trim()    || '';
  const bank    = document.getElementById('editSupBank').value.trim()    || '';
  const accNum  = document.getElementById('editSupAccNum').value.trim()  || '';
  const accName = document.getElementById('editSupAccName').value.trim() || '';
  if (!name) { showToast('Name required.','error'); return; }
  await firebase.database().ref(`suppliers/${key}`).update({ name, contact, specialty:spec, bankName:bank, accNum, accName });
  closeEditSupplier();
  showToast(`${name} updated ✓`);
}

async function deleteSupplier(key, name) {
  if (!confirm(`Delete supplier "${name}" from the entire system?`)) return;
  await firebase.database().ref(`suppliers/${key}`).remove();
  showToast(`${name} removed`,'warn');
}

function useSupplierInPO(name) {
  switchTab('materials');
  const inp = document.getElementById('poSupplier');
  if (inp) { inp.value = name; inp.focus(); }
  showToast(`${name} selected for PO`);
}