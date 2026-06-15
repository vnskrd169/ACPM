// ═══════════════════════════════════════════════════════════════
//  ACPM vNext — Global Suppliers Module
// ═══════════════════════════════════════════════════════════════

function initSuppliers() { 
  // No longer needs a project ID. This is global for the whole system.
  watchGlobalSuppliers(); 
}

function watchGlobalSuppliers() {
  // Point to the root level 'suppliers' node
  listen(firebase.database().ref('suppliers'), snap => {
    const el = $('supplierList'); 
    if (!el) return;
    el.innerHTML = '';
    
    if (!snap.exists()) {
      el.innerHTML = '<p class="empty-hint">No suppliers in system.</p>'; 
      return; 
    }

    snap.forEach(c => {
      const s = c.val();
      const key = c.key;
      el.innerHTML += `
        <div class="supplier-card">
          <div class="supplier-info">
            <span class="supplier-name">${s.name}</span>
            <span class="supplier-contact">${s.contact || 'No contact'}</span>
            <span class="supplier-specialty">${s.specialty || 'General'}</span>
            <div style="font-size:10px; color:var(--muted2); margin-top:4px;">
               ${s.bankName || 'No bank info'} | ${s.accNum || 'No account'}
            </div>
          </div>
          <div class="supplier-actions">
            <button class="btn-use-supplier" onclick="useSupplierInPO('${s.name}')">Use</button>
            <button class="btn-edit-supplier" onclick="editSupplier('${key}')">✎ Edit</button>
            <button class="btn-del-supplier" onclick="deleteSupplier('${key}','${s.name}')">✕</button>
          </div>
        </div>`;
    });
  });
}

async function addSupplier() {
  const name      = $('supName')?.value.trim();
  const contact   = $('supContact')?.value.trim() || '';
  const specialty = $('supSpecialty')?.value.trim() || '';
  const bankName  = $('supBank')?.value.trim() || '';
  const accNum    = $('supAccNum')?.value.trim() || '';

  if (!name) { alert('Enter supplier name.'); return; }

  // Push to root 'suppliers' node
  await firebase.database().ref('suppliers').push({
    name, contact, specialty, bankName, accNum, addedAt: Date.now()
  });
  
  // Clear inputs
  $('supName').value=''; $('supContact').value=''; $('supSpecialty').value='';
  $('supBank').value=''; $('supAccNum').value='';
}

async function editSupplier(key) {
  const snap = await firebase.database().ref(`suppliers/${key}`).once('value');
  const s = snap.val();
  
  const name      = prompt('Supplier name:', s.name); if (!name) return;
  const contact   = prompt('Contact:', s.contact || '');
  const specialty = prompt('Specialty:', s.specialty || '');
  const bankName  = prompt('Bank Name:', s.bankName || '');
  const accNum    = prompt('Account No:', s.accNum || '');
  
  await firebase.database().ref(`suppliers/${key}`).update({
    name, contact, specialty, bankName, accNum
  });
}

async function deleteSupplier(key, name) {
  if (!confirm(`Delete supplier "${name}" from the entire system?`)) return;
  await firebase.database().ref(`suppliers/${key}`).remove();
}