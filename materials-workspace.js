// Materials workspace: shared project groups and supplier prices from PO history.
let _materialOrders = [];
let _materialGroups = {};
let _materialPeople = {};
let _materialDeliveries = {};
let _materialIssues = {};
let _materialLedgerSnapshot = null;
let _materialMovementSnapshot = null;
let _materialGroupSelection = null;
let _materialGroupSaving = false;
let _materialCatalogProjects = [];
let _materialCatalogEntries = [];
let _materialDraftReady = false;
let _materialDraftOwner = '';

function materialToday(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function materialIdentity(item) {
  return [item.desc || item.description || item.item, item.size, item.unit]
    .map(value => String(value || '').trim().toLowerCase()).join('||');
}

function materialOutstandingCost(po) {
  if (!['approved','ordered','partially_delivered'].includes(po.status)) return 0;
  return materialItemsArray(po.items).reduce((sum,item)=>sum+Math.max(0,(Number(item.qtyOrdered??item.qty)||0)-(Number(item.qtyAccepted??item.qtyReceived)||0))*(Number(item.unitCost??item.cost)||0),0);
}

// Older fractional sizes were written as nested Firebase paths (e.g. 1/8).
// Read those leaves without changing or discarding the historical records.
function materialInventoryRows(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  if (Object.prototype.hasOwnProperty.call(value, 'qtyOnHand')) return [{ ...value, key: path, itemKey: path }];
  return Object.entries(value).flatMap(([key, child]) => materialInventoryRows(child, path ? `${path}/${key}` : key));
}

function materialInventoryMap(snap) {
  return Object.fromEntries(materialInventoryRows(snap.val()).map(item => [item.key, item]));
}

function materialPriceFor(item, supplierId = $('poSupplierId')?.value, supplierName = $('poSupplier')?.value) {
  const name = String(supplierName || '').trim().toLowerCase();
  const history = _materialOrders.concat(_materialCatalogProjects.filter(p => p.id !== _mpid).flatMap(p => Object.values(p.purchaseOrders || {}).map(po => ({ ...po, projectName: p.name || 'Another project' }))));
  const orders = history.filter(po => !['cancelled','draft','rejected'].includes(po.status) &&
    (supplierId ? po.supplierId === supplierId : !po.supplierId && name && String(po.supplierName || po.supplier || '').trim().toLowerCase() === name));
  orders.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.createdAt || 0) - (a.createdAt || 0));
  for (const po of orders) {
    const match = materialItemsArray(po.items).find(row => materialIdentity(row) === materialIdentity(item));
    if (match && Number(match.unitCost ?? match.cost) > 0) return { cost: Number(match.unitCost ?? match.cost), date: po.date, projectName: po.projectName || '', poNo: po.poNo || `PO-${String(po.seq || 0).padStart(3, '0')}` };
  }
  return null;
}

function setupMaterialsWorkspace() {
  const panel = $('materialsPanel');
  if (!panel || $('materialWorkspaceNav')) return;
  const builder = $('draftList').closest('.card');
  const history = $('poHistory').closest('.card');
  const ledger = $('ledgerBody').closest('.card');
  const movements = $('materialMovementBody').closest('.card');
  const summary = $('materialsSummary').closest('.card');
  const inventory = $('inventoryList').closest('.card');
  const issuance = $('matIssueItem').closest('.card');
  const host = builder.parentElement;
  const heading = document.createElement('div');
  heading.className = 'material-workspace-heading';
  heading.innerHTML = '<div><span class="material-eyebrow">PROJECT PROCUREMENT</span><h2>Materials</h2></div><button type="button" class="btn-add" onclick="showMaterialsView(\'new\')">+ New order</button>';
  host.insertBefore(heading, host.firstChild);
  const nav = document.createElement('nav');
  nav.id = 'materialWorkspaceNav'; nav.className = 'material-workspace-nav'; nav.setAttribute('aria-label', 'Materials views');
  nav.innerHTML = '<button type="button" data-view="orders" aria-pressed="true">Orders <span id="materialOrderCount">0</span></button><button type="button" data-view="new" aria-pressed="false">New order <span id="materialDraftCount">0</span></button><button type="button" data-view="ledger" aria-pressed="false">Ledger</button>';
  host.insertBefore(nav, builder);
  nav.querySelectorAll('button').forEach(button => button.addEventListener('click', () => showMaterialsView(button.dataset.view)));
  for (const [name, cards] of [['orders', [history]], ['new', [builder]], ['ledger', [ledger, movements, summary]]]) {
    const section = document.createElement('section'); section.id = `materialView_${name}`; section.dataset.materialView = name;
    section.setAttribute('aria-label', name === 'new' ? 'New purchase order' : name === 'ledger' ? 'Material ledger' : 'Purchase orders');
    host.append(section); cards.forEach(card => section.append(card));
  }
  const stock = document.createElement('details'); stock.className = 'material-stock-control';
  stock.innerHTML = '<summary><span>Stock control</span><small>Inventory &amp; issuance</small></summary><p class="material-help">Record materials issued to keep the remaining stock accurate.</p>';
  stock.append($('inventoryAlertContainer'), inventory, issuance); host.append(stock);
  const library = document.createElement('aside'); library.className = 'material-library';
  library.innerHTML = '<div class="material-section-heading"><div><h3>Material groups</h3><p class="material-help">Choose a group, then tick the items you need.</p></div></div><div id="materialGroupList"></div><button type="button" class="btn-ws-secondary" onclick="openMaterialGroup(\'new\')">+ New group</button><h4>From previous orders</h4><div id="materialPreviousOrders"></div>';
  const builderGrid = document.createElement('div'); builderGrid.className = 'material-builder-grid';
  builder.before(builderGrid); builderGrid.append(library, builder); builder.classList.add('material-order-builder');
  builder.querySelector('.card-title').textContent = 'Build your order';
  const save = document.createElement('button'); save.type = 'button'; save.className = 'btn-ws-secondary'; save.id = 'materialSaveDraftGroup';
  save.textContent = 'Save items as a group'; save.onclick = () => openMaterialGroup('draft');
  builder.querySelector('.po-draft-footer').before(save);
  const priceHint = document.createElement('p'); priceHint.id = 'materialPriceHint'; priceHint.className = 'material-help'; priceHint.setAttribute('aria-live', 'polite');
  priceHint.textContent = 'Select a hardware to recall its last prices in this project.';
  builder.querySelector('.po-item-form').before(priceHint);
  for (const [id, label] of Object.entries({ poSupplierSelect: 'Registered hardware', poSupplier: 'Supplier name', poDate: 'Order date', poUrgency: 'Priority', poNotes: 'Notes / reference', poItemDesc: 'Material', poItemSize: 'Size / specification', poItemQty: 'Quantity', poItemUnit: 'Unit', poItemCost: 'Unit price (PHP)' })) {
    const input = $(id); const wrapper = document.createElement('label'); wrapper.className = 'material-field'; wrapper.htmlFor = id;
    const text = document.createElement('span'); text.textContent = label; input.before(wrapper); wrapper.append(text, input);
    input.removeAttribute('style');
  }
  $('poSupplier').addEventListener('input', () => { $('poSupplierId').value = ''; $('poSupplierSelect').value = ''; materialSupplierChanged(); });
  $('poSupplierSelect').addEventListener('change', materialSupplierChanged);
  ['poItemDesc', 'poItemSize', 'poItemUnit'].forEach(id => $(id).addEventListener('change', recallMaterialPrice));
  const recall = document.createElement('button'); recall.type = 'button'; recall.className = 'btn-ws-secondary'; recall.textContent = 'Use hardware prices';
  recall.onclick = () => {
    let count = 0;
    _draftItems.forEach(item => { const price = materialPriceFor(item); if (price) { item.cost = price.cost; item.total = item.qty * price.cost; item.priceDate = price.date; count++; } });
    renderDraft(); showToast(count ? `Updated ${count} item prices from this hardware's history.` : 'No matching prices for this hardware yet.', count ? 'success' : 'warn');
  };
  priceHint.after(recall);
  const dialog = document.createElement('dialog'); dialog.id = 'materialGroupDialog'; dialog.className = 'material-group-dialog'; dialog.setAttribute('aria-labelledby', 'materialGroupTitle');
  dialog.innerHTML = '<div class="material-section-heading"><h2 id="materialGroupTitle">Material group</h2><button type="button" class="btn-ws-secondary" id="materialGroupClose">Close</button></div><label class="material-field" for="materialGroupName"><span>Group name</span><input id="materialGroupName" maxlength="80" placeholder="e.g. Drywall or Consumables"></label><p class="material-help">Save material names, specifications, units and usual quantities. Prices come from the selected hardware.</p><div id="materialGroupItems"></div><p id="materialGroupError" role="alert"></p><div class="material-group-actions"><button type="button" class="btn-ws-secondary" id="materialGroupSave">Save group</button><button type="button" class="btn-add" id="materialGroupAdd">Add selected to order</button></div>';
  document.body.append(dialog);
  $('materialGroupClose').onclick = () => dialog.close();
  $('materialGroupSave').onclick = saveMaterialGroup;
  $('materialGroupAdd').onclick = addMaterialGroupToDraft;
  const addLine = document.createElement('button'); addLine.type = 'button'; addLine.className = 'btn-ws-secondary'; addLine.textContent = '+ Add material';
  addLine.onclick = () => appendMaterialGroupItem({ desc: '', size: '', unit: 'pcs', qty: 1 }, $('materialGroupItems').children.length);
  $('materialGroupItems').after(addLine);
  // Native dialog handles focus trapping, Escape and focus restoration.
  const deliveryModes = document.createElement('div'); deliveryModes.className = 'material-delivery-modes';
  deliveryModes.innerHTML = '<button type="button" class="btn-add" onclick="fillRemainingDelivery()">Receive all remaining</button><button type="button" class="btn-ws-secondary" onclick="clearDeliveryQuantities()">Partial delivery / issues</button><p class="material-help">Check the quantities, then confirm this delivery.</p>';
  $('deliveryItemsList').before(deliveryModes);
  const evidence=document.createElement('div');evidence.className='material-delivery-evidence';
  evidence.innerHTML='<label class="material-field"><span>Delivery / issue notes</span><textarea id="deliveryNotes" rows="2" placeholder="Shortages, damaged items, or replacement arrangements"></textarea></label><label class="material-field"><span>Receipt or delivery photos (optional)</span><input id="deliveryPhotos" type="file" accept="image/*" multiple></label><p class="material-help">Up to 4 photos, 10 MB each. Photos are attached when you confirm this delivery.</p>';
  $('deliveryItemsList').after(evidence);
  showMaterialsView('orders');
  setupMaterialCatalog();
}

function showMaterialsView(view) {
  document.querySelectorAll('[data-material-view]').forEach(section => { section.hidden = section.dataset.materialView !== view; });
  document.querySelectorAll('#materialWorkspaceNav [data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
}

function alignMaterialApmFlow() {
  const flow = $('apmMaterialsFlow');
  if (!flow) return;
  $('materialView_orders')?.prepend(flow);
  const heading = flow.querySelector('h2'); if (heading) heading.textContent = 'Delivery overview';
  if ($('apmMaterialsMore')) $('apmMaterialsMore').hidden = true;
  document.querySelectorAll('#materialsPanel .apm-materials-advanced').forEach(element => element.classList.remove('apm-materials-advanced'));
}

function initMaterialsWorkspace(pid) {
  setupMaterialsWorkspace();
  _materialOrders = []; _materialGroups = {}; _materialDeliveries = {}; _materialIssues = {}; _materialPeople = {};
  _materialCatalogProjects = []; _materialCatalogEntries = [];
  _materialLedgerSnapshot = null; _materialMovementSnapshot = null; _materialGroupSelection = null;
  $('materialGroupDialog')?.close();
  showMaterialsView('orders');
  restoreMaterialDraft();
  renderMaterialLibrary();
  const subscribe = (path, apply) => {
    const ref = firebase.database().ref(path);
    matListen(ref, snap => { if (_mpid !== pid) return; apply(snap.val() || {}); refreshMaterialHistoryViews(); });
  };
  subscribe(`projects/${pid}/materialGroups`, value => { _materialGroups = value; renderMaterialLibrary(); });
  subscribe(`projects/${pid}/deliveries`, value => { _materialDeliveries = value; });
  subscribe(`projects/${pid}/materialIssuances`, value => { _materialIssues = value; });
  // Read only display names from the existing authorized directory; no new permissions.
  subscribe('users', value => { _materialPeople = Object.fromEntries(Object.entries(value).map(([id, person]) => [id, person.name || person.displayName || 'Name unavailable'])); });
}

function refreshMaterialHistoryViews() {
  if (_materialLedgerSnapshot) renderMaterialLedger(_materialLedgerSnapshot);
  if (_materialMovementSnapshot) renderMaterialMovements(_materialMovementSnapshot);
}

function renderMaterialLibrary() {
  const list = $('materialGroupList'); if (!list) return;
  list.replaceChildren();
  const groups = Object.entries(_materialGroups).filter(([, group]) => !group.archived);
  groups.sort((a, b) => String(a[1].name).localeCompare(String(b[1].name))).forEach(([key, group]) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'material-group-tile';
    button.innerHTML = `<strong>${escapeHtml(group.name)}</strong><span>${materialItemsArray(group.items).length} materials <span aria-hidden="true">+</span></span>`;
    button.onclick = () => openMaterialGroup('saved', key); list.append(button);
  });
  if (!groups.length) list.innerHTML = '<p class="material-library-empty">No saved groups yet.<br>Build an order and choose “Save items as a group”, or start from a previous order below.</p>';
  const previous = $('materialPreviousOrders'); previous.replaceChildren();
  _materialOrders.filter(po => po.status !== 'cancelled').slice(0, 8).forEach(po => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'material-previous-order';
    button.innerHTML = `<strong>${escapeHtml(po.poNo || `PO-${String(po.seq || 0).padStart(3, '0')}`)}</strong><span>${escapeHtml(po.supplierName || po.supplier || 'Supplier')} · ${materialItemsArray(po.items).length} items</span>`;
    button.onclick = () => openMaterialGroup('order', po.id); previous.append(button);
  });
  if (!previous.children.length) previous.innerHTML = '<p class="material-help">Submitted orders will appear here.</p>';
  setText('materialOrderCount', String(_materialOrders.length));
  renderMaterialCatalog();
}

function openMaterialGroup(source, key = '') {
  if (!canTouchMaterialsProject()) return;
  let items, name = '';
  if (source === 'new') items = [{ desc: '', size: '', unit: 'pcs', qty: 1 }];
  else if (source === 'draft') items = _draftItems;
  else if (source === 'saved') { const group = _materialGroups[key]; if (!group) return; items = materialItemsArray(group.items); name = group.name; }
  else if (source === 'catalog') { const entry = _materialCatalogEntries[Number(key)]; if (!entry) return; items = entry.items; name = entry.groupName || ''; }
  else { const po = _materialOrders.find(order => order.id === key); if (!po) return; items = materialItemsArray(po.items); }
  if (!items?.length) { showToast('Add materials to your draft first.', 'warn'); return; }
  _materialGroupSelection = { pid: _mpid, key: source === 'saved' ? key : '', items: items.map(item => ({ desc: item.desc || item.description || '', size: item.size || '', unit: item.unit || '', qty: Number(item.qty ?? item.qtyOrdered) || 1 })) };
  $('materialGroupName').value = name;
  $('materialGroupError').textContent = '';
  $('materialGroupSave').textContent = source === 'saved' ? 'Update group' : 'Save group';
  const list = $('materialGroupItems'); list.replaceChildren();
  _materialGroupSelection.items.forEach(appendMaterialGroupItem);
  $('materialGroupDialog').showModal();
}

function appendMaterialGroupItem(item, index) {
    const row = document.createElement('div'); row.className = 'material-group-item';
    row.innerHTML = `<label class="material-group-check"><input type="checkbox" checked data-pick="${index}" aria-label="Include ${escapeHtml(item.desc)}"><span>${escapeHtml(item.desc)}</span></label><label class="material-field"><span>Material</span><input data-field="desc" value="${escapeHtml(item.desc)}" maxlength="100" aria-label="Material ${index + 1}"></label><label class="material-field"><span>Specification</span><input data-field="size" value="${escapeHtml(item.size)}" maxlength="80" aria-label="Specification ${index + 1}"></label><label class="material-field"><span>Unit</span><input data-field="unit" value="${escapeHtml(item.unit)}" maxlength="30" aria-label="Unit ${index + 1}"></label><label class="material-field"><span>Quantity</span><input data-field="qty" type="number" min="0.001" step="any" value="${item.qty}" aria-label="Quantity ${index + 1}"></label>`;
    $('materialGroupItems').append(row);
}

function selectedMaterialGroupItems() {
  const items = [];
  document.querySelectorAll('#materialGroupItems .material-group-item').forEach(row => {
    if (!row.querySelector('[data-pick]').checked) return;
    const item = {};
    row.querySelectorAll('[data-field]').forEach(input => { item[input.dataset.field] = input.value.trim(); });
    item.qty = Number(item.qty);
    if (!item.desc || !item.unit || !Number.isFinite(item.qty) || item.qty <= 0) throw new Error('Each selected material needs a name, unit and a quantity greater than zero.');
    items.push(item);
  });
  if (!items.length) throw new Error('Select at least one material.');
  return items;
}

async function saveMaterialGroup() {
  if (_materialGroupSaving || !_materialGroupSelection || _materialGroupSelection.pid !== _mpid || !canTouchMaterialsProject()) return;
  const pid = _mpid;
  try {
    const name = $('materialGroupName').value.trim();
    if (!name) throw new Error('Give this group a name.');
    const items = selectedMaterialGroupItems();
    const existing = Object.entries(_materialGroups).find(([id, group]) => id !== _materialGroupSelection.key && String(group.name).toLowerCase() === name.toLowerCase());
    if (existing) throw new Error('A group with this name already exists. Open that group to update it, or choose a different name.');
    _materialGroupSaving = true; $('materialGroupSave').disabled = true;
    const ref = firebase.database().ref(`projects/${pid}/materialGroups`);
    const id = _materialGroupSelection.key || ref.push().key;
    await safeDb(() => ref.child(id).set({ name, items, updatedAt: Date.now(), updatedBy: materialUserId(), updatedByName: materialUserName() }), 'Failed to save material group');
    if (_mpid !== pid) return;
    _materialGroupSelection.key = id; $('materialGroupSave').textContent = 'Update group';
    $('materialGroupError').textContent = ''; showToast(`Saved “${name}” for this project.`);
  } catch (error) { $('materialGroupError').textContent = error.message; }
  finally { _materialGroupSaving = false; $('materialGroupSave').disabled = false; }
}

function addMaterialGroupToDraft() {
  if (!_materialGroupSelection || _materialGroupSelection.pid !== _mpid || !canTouchMaterialsProject()) return;
  try {
    const items = selectedMaterialGroupItems();
    items.forEach(item => {
      const price = materialPriceFor(item);
      const existing = _draftItems.find(row => materialIdentity(row) === materialIdentity(item));
      if (existing) { existing.qty += item.qty; existing.total = existing.qty * existing.cost; }
      else _draftItems.push({ ...item, cost: price?.cost || 0, total: item.qty * (price?.cost || 0), priceDate: price?.date || '' });
    });
    renderDraft(); $('materialGroupDialog').close(); showMaterialsView('new');
    showToast(`Added ${items.length} materials. Review quantities and unit prices before submitting.`);
  } catch (error) { $('materialGroupError').textContent = error.message; }
}

function materialSupplierChanged() {
  const supplier = $('poSupplierId')?.value;
  if (supplier && $('poSupplierSelect')) $('poSupplierSelect').value = supplier;
  setText('materialPriceHint', _draftItems.length ? 'Hardware changed. Draft prices stay as entered; choose Use hardware prices to refresh them.' : 'Last prices are matched by hardware, material, specification and unit. Prices remain editable.');
  recallMaterialPrice();
}

function recallMaterialPrice() {
  const price = materialPriceFor({ desc: $('poItemDesc')?.value, size: $('poItemSize')?.value, unit: $('poItemUnit')?.value });
  if (!price) return;
  $('poItemCost').value = price.cost;
  setText('materialPriceHint', `Last ordered at ${peso(price.cost)} per ${$('poItemUnit').value} · ${price.date} · ${price.poNo}${price.projectName ? ` · ${price.projectName}` : ''}. Price is editable.`);
}

function editMaterialDraft(index, field, input) {
  if (!canTouchMaterialsProject()) return;
  const item = _draftItems[index]; if (!item) return;
  item[field] = ['qty', 'cost'].includes(field) ? Number(input.value) : input.value.trim();
  item.total = (Number(item.qty) || 0) * (Number(item.cost) || 0);
  const row = input.closest('.draft-row'); if (row) row.querySelector('.draft-total').textContent = peso(item.total);
  setText('draftTotal', peso(_draftItems.reduce((sum, value) => sum + value.total, 0)));
  saveMaterialDraft();
}

// Private recovery on this device only, isolated by account and project.
function materialDraftKey() { return `acpm:po-draft:v1:${window._currentUser?.uid || ''}:${_mpid || ''}`; }
function saveMaterialDraft() {
  if (!_materialDraftReady || !_mpid || !window._currentUser?.uid || _materialDraftOwner !== window._currentUser.uid) return;
  const fields = Object.fromEntries(['poSupplier','poSupplierId','poDate','poNotes','poUrgency','poExpectedDate','poItemDesc','poItemSize','poItemUnit','poItemQty','poItemCost'].map(id => [id,$(id)?.value || '']));
  try {
    if (!_draftItems.length && !fields.poSupplier && !fields.poNotes && !fields.poItemDesc) localStorage.removeItem(materialDraftKey());
    else localStorage.setItem(materialDraftKey(),JSON.stringify({ items:_draftItems, fields, savedAt:Date.now() }));
    setText('materialDraftRecovery',_draftItems.length || fields.poSupplier || fields.poItemDesc ? 'Draft saved on this device. Only Submit Purchase Order sends it for approval.' : 'Your draft is saved on this device as you work.');
  } catch (_) { setText('materialDraftRecovery','Draft recovery is unavailable on this device. Keep this tab open until you submit.'); }
}
function restoreMaterialDraft() {
  _materialDraftReady=false;
  _materialDraftOwner=window._currentUser?.uid || '';
  ['poSupplier','poSupplierId','poSupplierSelect','poDate','poNotes','poItemDesc','poItemSize','poItemUnit','poItemQty','poItemCost','poExpectedDate'].forEach(id=>{if($(id))$(id).value='';});
  if($('poUrgency'))$('poUrgency').value='normal';
  try {
    const data=JSON.parse(localStorage.getItem(materialDraftKey()) || 'null');
    if(data && Array.isArray(data.items)) {
      _draftItems=data.items.filter(item=>item&&typeof item.desc==='string').map(item=>({...item,total:(Number(item.qty)||0)*(Number(item.cost)||0)}));
      for(const [id,value] of Object.entries(data.fields || {})) if(['poSupplier','poSupplierId','poDate','poNotes','poUrgency','poExpectedDate','poItemDesc','poItemSize','poItemUnit','poItemQty','poItemCost'].includes(id)&&$(id))$(id).value=String(value);
      setText('materialDraftRecovery','Recovered your previous draft on this device. Review it before submitting.');
    }
  }catch(_){}
  _materialDraftReady=true;
}
function setupMaterialCatalog() {
  const library=document.querySelector('.material-library');if(!library || $('materialCatalogSearch'))return;
  const catalog=document.createElement('section');catalog.className='material-catalog';
  catalog.innerHTML='<h4>Material catalog</h4><label class="material-field"><span>Find a material or group</span><input id="materialCatalogSearch" type="search" placeholder="e.g. Gypsum or framing"></label><button type="button" class="btn-ws-secondary" id="materialCatalogLoad">Browse accessible projects</button><p id="materialCatalogStatus" class="material-help">Search this project’s previously ordered materials.</p><div id="materialCatalogResults"></div>';
  library.append(catalog);$('materialCatalogSearch').oninput=renderMaterialCatalog;
  $('materialCatalogLoad').onclick=async()=>{
    const pid=_mpid,uid=window._currentUser?.uid,button=$('materialCatalogLoad');button.disabled=true;
    setText('materialCatalogStatus','Loading materials from projects you can access…');
    try{
      const projects=await fetchAccessibleProjectsOnce();
      if(pid!==_mpid || uid!==window._currentUser?.uid)return;
      _materialCatalogProjects=projects;renderMaterialCatalog();
      setText('materialCatalogStatus',`Loaded ${projects.length} accessible projects. Groups are copied into this project; prices retain their source and date.`);
    }catch(error){setText('materialCatalogStatus','Could not load other projects. You can still use this project’s materials.');}
    finally{button.disabled=false;}
  };
  const hint=document.createElement('p');hint.id='materialDraftRecovery';hint.className='material-help';hint.setAttribute('aria-live','polite');$('draftList').before(hint);
  const expected=document.createElement('label');expected.className='material-field';expected.innerHTML='<span>Expected delivery (optional)</span><input id="poExpectedDate" type="date" aria-label="Expected delivery date">';
  document.querySelector('#materialsPanel .po-meta-grid')?.append(expected);
  document.querySelector('.material-order-builder')?.addEventListener('input',saveMaterialDraft);
  document.querySelector('.material-order-builder')?.addEventListener('change',saveMaterialDraft);
}
function renderMaterialCatalog() {
  const el=$('materialCatalogResults');if(!el)return;
  const query=String($('materialCatalogSearch')?.value || '').trim().toLowerCase();
  const projects=[{id:_mpid,name:'This project',purchaseOrders:Object.fromEntries(_materialOrders.map(po=>[po.id,po]))},..._materialCatalogProjects.filter(p=>p.id!==_mpid)];
  const entries=[],seen=new Set();
  projects.forEach(project=>{
    if(project.id!==_mpid)Object.values(project.materialGroups || {}).filter(group=>!group.archived).forEach(group=>entries.push({title:group.name,groupName:group.name,source:project.name,items:materialItemsArray(group.items)}));
    Object.values(project.purchaseOrders || {}).filter(po=>!['cancelled','rejected','draft'].includes(po.status)).forEach(po=>materialItemsArray(po.items).forEach(item=>{
      const identity=materialIdentity(item);if(seen.has(identity))return;seen.add(identity);
      entries.push({title:`${item.desc || item.description || item.item} ${item.size || ''}`.trim(),source:project.name,items:[{...item,qty:1}]});
    }));
  });
  _materialCatalogEntries=entries;
  el.replaceChildren();let count=0;
  entries.forEach((entry,index)=>{
    if(query&&!`${entry.title} ${entry.source} ${entry.items.map(i=>i.desc||i.description).join(' ')}`.toLowerCase().includes(query))return;
    if(++count>12)return;
    const button=document.createElement('button');button.type='button';button.className='material-previous-order';button.innerHTML=`<strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.source)} · ${entry.items.length===1?escapeHtml(entry.items[0].unit || ''):`${entry.items.length} items`}</span>`;button.onclick=()=>openMaterialGroup('catalog',String(index));el.append(button);
  });
  if(!count)el.innerHTML='<p class="material-help">No matching materials yet.</p>';
  if(count>12)el.insertAdjacentHTML('beforeend','<p class="material-help">Search to narrow the remaining results.</p>');
}

function materialDuplicateOrders(project, input) {
  const signature=items=>materialItemsArray(items).map(item=>`${materialIdentity(item)}||${Number(item.qtyOrdered??item.qty)}||${Number(item.unitCost??item.cost)}`).sort().join('\n');
  const match=signature(input.items);
  return Object.entries(project.purchaseOrders || {}).filter(([,po])=>!['cancelled','rejected'].includes(po.status) && po.date===input.date &&
    (input.supplierId ? po.supplierId===input.supplierId : String(po.supplierName || po.supplier || '').trim().toLowerCase()===input.supplier.toLowerCase()) && signature(po.items)===match).map(([,po])=>po.poNo || `PO-${String(po.seq || 0).padStart(3,'0')}`);
}

function fillRemainingDelivery() {
  document.querySelectorAll('#deliveryItemsList .delivery-qty-received').forEach(input => {
    if (input.disabled) return;
    input.value = input.max;
    const row = input.closest('.delivery-item-row');
    row.querySelector('select').value = 'good';
    const rejected = row.querySelector('.delivery-qty-rejected'); if (rejected) rejected.value = 0;
  });
}

function clearDeliveryQuantities() {
  document.querySelectorAll('#deliveryItemsList input').forEach(input => { input.value = ''; });
  document.querySelector('#deliveryItemsList input:not(:disabled)')?.focus();
}

function materialMovementPerson(movement) {
  return movement.createdByName || _materialPeople[movement.createdBy] ||
    (movement.createdBy === window._currentUser?.uid ? materialUserName() : 'Name unavailable');
}

function materialReadableSource(movement) {
  const po = _materialOrders.find(order => order.id === movement.poId || order.id === movement.sourceId);
  const poNo = movement.poNo || po?.poNo || (po?.seq ? `PO-${String(po.seq).padStart(3, '0')}` : 'Purchase order');
  if (movement.sourceType === 'delivery' || movement.deliveryId) {
    const id = movement.deliveryId || movement.sourceId;
    const delivery = _materialDeliveries[id] || {};
    const batches = Object.entries(_materialDeliveries).filter(([, row]) => row.poId === (movement.poId || delivery.poId)).sort((a, b) => (a[1].receivedAt || 0) - (b[1].receivedAt || 0) || a[0].localeCompare(b[0]));
    const index = batches.findIndex(([key]) => key === id);
    const number = delivery.deliveryNo || movement.deliveryNo || (index >= 0 ? `Batch ${index + 1}` : 'Delivery');
    return `${poNo} / ${number}${delivery.reference ? ` · ${delivery.reference}` : ''}`;
  }
  if (movement.sourceType === 'materialIssuance' || movement.issueId) return _materialIssues[movement.issueId || movement.sourceId]?.issueNo || movement.issueNo || 'Material issue';
  return poNo;
}

function materialLedgerReceipt(row) {
  const po = _materialOrders.find(order => order.id === row.poId);
  if (!po) return null;
  const item = materialItemsArray(po.items).find(item => item.itemId === row.poItemId) || materialItemsArray(po.items).find(item => materialIdentity(item) === materialIdentity(row));
  if (!item) return null;
  const accepted = Number(item.qtyAccepted ?? item.qtyReceived) || 0;
  const ordered = Number(item.qtyOrdered ?? item.qty) || 0;
  return { accepted, ordered, status: row.status === 'cancelled' || po.status === 'cancelled' ? 'Cancelled' : accepted >= ordered && ordered > 0 ? 'Delivered' : accepted > 0 ? 'Partial' : 'Awaiting delivery' };
}
