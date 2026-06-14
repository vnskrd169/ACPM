// ═══════════════════════════════════════════════════════════════
//  ACPM v4 — suppliers.js  |  Supplier Directory
// ═══════════════════════════════════════════════════════════════
let _suppid=null;
function initSuppliers(pid){ _suppid=pid; watchSuppliers(pid); }

function watchSuppliers(pid){
  listen(firebase.database().ref(`projects/${pid}/suppliers`), snap=>{
    const el=$('supplierList'); if (!el) return;
    el.innerHTML='';
    if (!snap.exists()){ el.innerHTML='<p class="empty-hint">No suppliers yet. Add one above.</p>'; return; }
    snap.forEach(c=>{
      const s=c.val();
      el.innerHTML+=`<div class="supplier-card">
        <div class="supplier-info">
          <span class="supplier-name">${s.name}</span>
          <span class="supplier-contact">${s.contact||''}</span>
          <span class="supplier-specialty">${s.specialty||''}</span>
        </div>
        <div class="supplier-actions">
          <button class="btn-use-supplier" onclick="useSupplierInPO('${s.name}')">Use in PO</button>
          <button class="btn-edit-supplier" onclick="editSupplier('${c.key}','${s.name}','${s.contact||''}','${s.specialty||''}')">✎ Edit</button>
          <button class="btn-del-supplier"  onclick="deleteSupplier('${c.key}','${s.name}')">✕</button>
        </div>
      </div>`;
    });
  });
}

async function addSupplier(){
  if (!_suppid) return;
  const name     =$('supName')?.value.trim();
  const contact  =$('supContact')?.value.trim()||'';
  const specialty=$('supSpecialty')?.value.trim()||'';
  if (!name){ alert('Enter supplier name.'); return; }
  await firebase.database().ref(`projects/${_suppid}/suppliers`).push({name,contact,specialty,addedAt:Date.now()});
  $('supName').value=''; $('supContact').value=''; $('supSpecialty').value='';
}

async function editSupplier(key,oldName,oldContact,oldSpec){
  const name     =prompt('Supplier name:',oldName);     if (!name)    return;
  const contact  =prompt('Contact / phone:',oldContact)||'';
  const specialty=prompt('Specialty:',oldSpec)||'';
  await firebase.database().ref(`projects/${_suppid}/suppliers/${key}`).update({name,contact,specialty});
}

async function deleteSupplier(key,name){
  if (!confirm(`Delete supplier "${name}"?`)) return;
  await firebase.database().ref(`projects/${_suppid}/suppliers/${key}`).remove();
}

function useSupplierInPO(name){
  // Switch to materials tab and fill supplier field
  switchTab('materials');
  const inp=document.getElementById('poSupplier');
  if (inp){ inp.value=name; inp.focus(); }
}