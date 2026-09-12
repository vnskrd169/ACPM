// Connected project views. All totals are derived from the current authorized snapshot.
(function (root) {
  'use strict';
  const rows = value => Object.entries(value || {}).filter(([, v]) => v && typeof v === 'object').map(([id, v]) => ({ ...v, id }));
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const sum = (list, fn) => list.reduce((total, item) => total + num(fn(item)), 0);
  const status = value => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  const closed = item => ['completed', 'done', 'closed', 'cancelled', 'archived', 'rejected', 'voided'].includes(status(item.status));
  const date = (value = new Date()) => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const stamp = value => typeof value === 'number' ? value : Date.parse(value || '') || 0;
  const poName = po => po.poNo || (po.seq ? `PO-${String(po.seq).padStart(3, '0')}` : 'Purchase order');
  const supplier = po => po.supplierName || po.supplier || 'Supplier not named';
  const poLines = po => rows(po.items);
  const ordered = line => Math.max(0, num(line.qtyOrdered ?? line.qty));
  const accepted = line => Math.max(0, num(line.qtyAccepted ?? line.qtyReceived));
  const cost = line => Math.max(0, num(line.unitCost ?? line.cost));
  const poRemaining = po => ['approved', 'ordered', 'partially_delivered'].includes(status(po.status))
    ? sum(poLines(po), line => Math.max(0, ordered(line) - accepted(line)) * cost(line)) : 0;
  function finance(project) {
    const orders = rows(project.purchaseOrders).filter(po => !closed(po));
    const ledger = rows(project.ledger).filter(row => status(row.status) !== 'cancelled');
    const materialReceived = num(project.materialReceivedCost ?? project.materialSpent ?? sum(orders, po => sum(poLines(po), line => accepted(line) * cost(line))));
    const labor = num(project.laborSpent), other = num(project.otherSpent);
    const materialBudget = num(project.materialBudget) + num(project.materialBudgetDelta);
    const laborBudget = num(project.laborBudget) + num(project.laborBudgetDelta);
    const materialCommitted = rows(project.purchaseOrders).length ? sum(orders, poRemaining) : num(project.materialCommitted);
    const committed = materialCommitted + num(project.laborCommitted);
    const invoices = orders.filter(po => num(po.invoiceAmount) > 0);
    const paidRows = ledger.filter(row => status(row.status) === 'paid');
    // A delivery or matched invoice is never proof of payment.
    const markedPaid = sum(paidRows, row => row.total ?? num(row.qty) * num(row.cost));
    const invoiceUnverified = sum(invoices, po => Math.max(0, num(po.invoiceAmount) - sum(paidRows.filter(row => row.poId === po.id), row => row.total ?? num(row.qty) * num(row.cost))));
    return { laborBudget, materialBudget, budget: laborBudget + materialBudget, labor, other, materialReceived,
      incurred: labor + materialReceived + other, committed, materialCommitted,
      available: laborBudget + materialBudget - labor - materialReceived - other - committed,
      orderedTotal: sum(orders.filter(po => !['draft','pending_approval'].includes(status(po.status))), po => po.total ?? sum(poLines(po), line => ordered(line)*cost(line))),
      awaitingApproval: sum(orders.filter(po => status(po.status) === 'pending_approval'), po => po.total),
      invoiced: sum(invoices, po => po.invoiceAmount), markedPaid, invoiceUnverified, orders, invoices, paidRows };
  }
  function records(project) {
    const result = [];
    const push = (collection, tab, label, title, when, detail) => rows(project[collection]).forEach(row => {
      result.push({ ...row, collection, tab, label, title: title(row), when: stamp(when(row)), detail: detail(row), state: status(row.status).replace(/_/g,' ') || 'Recorded' });
    });
    push('purchaseOrders','materials','Purchase order', po => `${poName(po)} · ${supplier(po)}`, po => po.createdAt || po.date, po => po.notes || '');
    const deliveries = rows(project.deliveries).sort((a,b)=>stamp(a.receivedAt || a.deliveryDate)-stamp(b.receivedAt || b.deliveryDate) || a.id.localeCompare(b.id));
    const batches = {};
    deliveries.forEach(row => {
      const po = rows(project.purchaseOrders).find(po => po.id === row.poId) || {};
      const batch = batches[row.poId] = (batches[row.poId] || 0) + 1;
      result.push({...row, collection:'deliveries',tab:'materials',label:'Delivery',title:`${poName(po)} / ${row.deliveryNo || `Batch ${batch}`}`,when:stamp(row.receivedAt || row.deliveryDate || row.date),detail:[supplier(po),row.reference,row.notes].filter(Boolean).join(' · '),state:status(row.status) || 'received'});
    });
    push('tasks','tasks','Task', r=>r.title || 'Task',r=>r.updatedAt || r.createdAt, r=>[r.assignedToName || r.assignedTo,r.blockedReason,r.returnReason,r.description].filter(Boolean).join(' · '));
    push('siteLogs','sitelog','Site update',r=>`${r.logNo || 'Site update'} · ${r.date || ''}`,r=>r.updatedAt || r.createdAt || r.savedAt || r.date,r=>[r.workAccomplished,r.linkedTaskTitle,r.notes,...rows(r.issues).map(i=>i.description || i.title || i.issue),...rows(r.delays).map(i=>i.description || i.reason)].filter(Boolean).join(' · '));
    push('defects','defects','Punch item',r=>r.title || r.description || r.issue || 'Punch item',r=>r.updatedAt || r.createdAt || r.date,r=>[r.location,r.assignedToName,r.notes].filter(Boolean).join(' · '));
    push('changeOrders','changeorders','Change order',r=>`${r.coNo || r.changeOrderNo || 'Change order'} · ${r.title || r.description || ''}`,r=>r.updatedAt || r.createdAt || r.date,r=>r.reason || r.notes || '');
    push('payrollLogs','labor','Payroll',r=>r.payrollNo || `Payroll · ${r.weekStart || r.date || 'Compiled'}`,r=>r.createdAt || r.compiledAt || r.date,r=>r.tradeName || r.trade || '');
    push('collections','billing','Client collection',r=>r.collectionNo || 'Client collection',r=>r.createdAt || r.date,r=>r.reference || r.notes || '');
    push('billings','billing','Client billing',r=>r.billingNo || 'Client billing',r=>r.createdAt || r.date,r=>r.description || r.notes || '');
    return result.sort((a,b)=>b.when-a.when || a.title.localeCompare(b.title));
  }
  function actions(project, now = new Date()) {
    const today = date(now), list = [];
    const add = (row, collection, tab, title, owner, reason, urgency = 1, action = 'Open record') => list.push({id:row.id,collection,tab,title,owner,reason,urgency,action,when:stamp(row.submittedForVerificationAt || row.approvalWorkflow?.submittedAt || row.createdAt || row.date)});
    rows(project.purchaseOrders).filter(po=>!closed(po)).forEach(po=>{
      const name = `${poName(po)} · ${supplier(po)}`;
      if (status(po.status)==='pending_approval') add(po,'purchaseOrders','materials',name,'Boss / Owner','Purchase order needs approval',2,'Review order');
      if (po.invoiceStatus==='mismatch') add(po,'purchaseOrders','materials',name,'PM / Boss','Invoice amount or delivered quantities do not match',3,'Review invoice');
      if (poRemaining(po)>0) {
        const due = po.expectedDeliveryDate || po.expectedDate || po.neededBy || '';
        add(po,'purchaseOrders','materials',name,'APM',due ? `${due<today?'Delivery overdue':'Delivery expected'} · ${due}` : 'Approved materials still to receive · expected date not set',due && due<today ? 3 : 1,'Receive materials');
      }
    });
    rows(project.tasks).filter(r=>!closed(r)).forEach(task=>{
      const s=status(task.status), owner=task.assignedToName || task.assignedTo || 'APM · unassigned';
      if (['for_verification','review'].includes(s)) add(task,'tasks','tasks',task.title || 'Task','PM / Boss','Completion is waiting for verification',2,'Verify task');
      else if (s==='blocked') add(task,'tasks','tasks',task.title || 'Task',owner,task.blockedReason || 'A blocker needs resolution',3,'Resolve blocker');
      else if(task.dueDate && task.dueDate<=today) add(task,'tasks','tasks',task.title || 'Task',owner,`${task.dueDate<today?'Overdue':'Due today'} · ${task.dueDate}`,task.dueDate<today?3:2,'Update task');
      else if(task.returnReason) add(task,'tasks','tasks',task.title || 'Task',owner,`Returned: ${task.returnReason}`,2,'Revise task');
    });
    rows(project.changeOrders).filter(r=>['pending','submitted','pending_approval'].includes(status(r.status))).forEach(r=>add(r,'changeOrders','changeorders',r.title || r.description || 'Change order','PM / Boss','Change needs approval before it affects the budget',2,'Review change'));
    rows(project.defects).filter(r=>!closed(r)).forEach(r=>add(r,'defects','defects',r.title || r.description || r.issue || 'Punch item',r.assignedToName || r.assignedTo || 'APM',`${r.location || 'Site'} · ${r.priority || r.severity || 'open'} issue`,['critical','high','major'].includes(status(r.priority || r.severity))?3:1,'Review issue'));
    rows(project.siteLogs).filter(r=>!['voided','draft'].includes(status(r.status))).forEach(log=>{
      const problems=[...rows(log.issues),...rows(log.delays)].filter(r=>!closed(r));
      if(problems.length)add(log,'siteLogs','sitelog',`${log.logNo || 'Site report'} · ${log.date || ''}`,'APM / PM',`${problems.length} unresolved site issue${problems.length===1?'':'s'} or delays`,2,'Review site report');
    });
    const latest = rows(project.siteLogs).filter(r=>!['voided','draft'].includes(status(r.status))).map(r=>r.date || date(r.createdAt || r.savedAt || 0)).sort().pop();
    if(!['completed','archived'].includes(status(project.status)) && latest!==today) add({id:'',date:latest},'siteLogs','sitelog','Today’s site update','APM',latest?`Latest report: ${latest}`:'No site update recorded yet',1,'Post site update');
    return list.sort((a,b)=>b.urgency-a.urgency || a.when-b.when);
  }
  const api = { rows, num, status, date, finance, records, actions, poRemaining };
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  root.ProjectInsights=api;
  if(typeof document==='undefined') return;
  let current = null, currentId = '', query='', filter='all', routeHandled='';
  const byId = id=>document.getElementById(id);
  const h = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value=>typeof peso==='function'?peso(value):`PHP ${num(value).toFixed(2)}`;
  const financial = ()=>['boss','owner','admin','pm'].includes(status(root._currentUser?.role));
  function dialog(title, body) {
    let el=byId('projectRecordDialog');
    if(!el){el=document.createElement('dialog');el.id='projectRecordDialog';el.className='workspace-dialog';el.setAttribute('aria-labelledby','projectRecordTitle');document.body.append(el);}
    el.innerHTML=`<header><h2 id="projectRecordTitle">${h(title)}</h2><button type="button" class="btn-ws-secondary" data-close>Close</button></header>${body}`;
    el.querySelector('[data-close]').onclick=()=>el.close();
    if(!el.open)el.showModal();return el;
  }
  function openSource(record, receive=false) {
    byId('projectRecordDialog')?.close();
    if(record.tab==='billing'&&!financial())return;
    if(['defects','changeorders'].includes(record.tab)) toggleExtraTabs(true);
    switchTab(record.tab);
    if(record.tab==='materials') {
      showMaterialsView('orders');
      const poId=record.collection==='deliveries'?record.poId:record.id;
      if(receive && poId && typeof openDeliveryModal==='function') {openDeliveryModal(poId);return;}
      const search=byId('poFilterInput'); if(search){search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));}
      const card=byId(`poc_${poId}`);if(card){card.scrollIntoView({block:'center',behavior:'smooth'});card.classList.add('workspace-record-focus');setTimeout(()=>card.classList.remove('workspace-record-focus'),3000);}
    } else if(record.tab==='tasks') {
      if(typeof setApmTaskFilter==='function')setApmTaskFilter('all');
      const card=Array.from(document.querySelectorAll('[data-task-id]')).find(el=>el.dataset.taskId===record.id);
      card?.scrollIntoView({block:'center',behavior:'smooth'});card?.querySelector('button')?.focus();
    } else if(record.tab==='sitelog') {
      const log=current?.siteLogs?.[record.id];
      if(log && byId('logFilterInput')) {byId('logFilterInput').value=log.date || '';filterLogs(byId('logFilterInput').value);byId('siteLogList')?.scrollIntoView({block:'start',behavior:'smooth'});}
      else byId('logWork')?.focus();
    }
  }
  function showRecord(record) {
    const info=[['Type',record.label || record.collection],['Status',record.state || status(record.status).replace(/_/g,' ')],['Date',record.when?new Date(record.when).toLocaleString('en-PH'):'Not recorded'],['Recorded by',record.createdByName || record.receivedByName || record.updatedByName || 'Name not recorded']];
    const lines=record.collection==='purchaseOrders'?poLines(record):record.collection==='deliveries'?rows(record.items):[];
    const el=dialog(record.title,`<dl class="workspace-record-meta">${info.map(([k,v])=>`<div><dt>${h(k)}</dt><dd>${h(v)}</dd></div>`).join('')}</dl><p class="workspace-record-notes">${h(record.detail || 'No additional notes.')}</p>${lines.length?`<div class="workspace-table-scroll"><table><thead><tr><th>Material</th><th>Quantity</th><th>Accepted</th><th>Unit price</th></tr></thead><tbody>${lines.map(line=>`<tr><td>${h(line.desc||line.description||line.item)} ${h(line.size||'')}</td><td>${h(line.qtyOrdered??line.qtyReceived??line.qty)} ${h(line.unit)}</td><td>${h(accepted(line))}</td><td>${money(cost(line))}</td></tr>`).join('')}</tbody></table></div>`:''}<footer><button type="button" class="btn-add" data-source>Open ${h(record.tab==='materials'?'purchase order':record.label || 'module')}</button></footer>`);
    el.querySelector('[data-source]').onclick=()=>openSource(record);
    const media=rows(record.media).filter(item=>/^https:\/\//i.test(item.url || ''));
    if(media.length){const photos=document.createElement('div');photos.className='workspace-photo-links';media.forEach((item,index)=>{const link=document.createElement('a');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=item.name || `Photo ${index+1}`;photos.append(link);});el.querySelector('footer').before(photos);}
  }
  function financialDetail(metric) {
    if(!current || !financial())return;
    const f=finance(current), details={
      budget:['Approved budget','Base budgets plus approved budget adjustments.',[['Labor budget',f.laborBudget,'labor'],['Materials budget',f.materialBudget,'materials']]],
      incurred:['Recorded cost','Materials are counted when accepted. Labor uses the recorded labor total. Supplier payment is a separate step.',[['Labor',f.labor,'labor'],['Materials accepted',f.materialReceived,'materials'],['Other recorded costs',f.other,'reports']]],
      committed:['Still committed','Only outstanding quantities on approved orders are included; delivered quantities are not counted twice.',f.orders.filter(po=>poRemaining(po)>0).map(po=>[`${poName(po)} · ${supplier(po)}`,poRemaining(po),'materials',po.id]).concat(num(current.laborCommitted)?[['Labor commitment',num(current.laborCommitted),'labor']]:[])],
      available:['Available budget','Approved budget − recorded cost − outstanding commitments.',[['Approved budget',f.budget],['Recorded cost',-f.incurred],['Outstanding commitments',-f.committed],['Available',f.available]]],
      invoices:['Supplier invoices','Invoice matching checks the order and receipt. It does not confirm that money was paid.',f.invoices.map(po=>[`${po.invoiceNo || 'Invoice'} · ${poName(po)} · ${supplier(po)}`,num(po.invoiceAmount),'materials',po.id])],
      paid:['Payment status to reconcile','These are historical ledger entries explicitly marked paid. Other invoices remain unverified: the app does not yet hold a complete supplier payment register. Do not treat the unverified balance as confirmed debt.',[['Ledger marked paid',f.markedPaid,'materials'],['Invoice balance to verify',f.invoiceUnverified,'materials']]]
    };
    const [title,note,list]=details[metric] || details.budget;
    const el=dialog(title,`<p class="workspace-record-notes">${h(note)}</p><div class="workspace-breakdown">${list.length?list.map(([label,amount,tab,id],i)=>`<button type="button" data-breakdown="${i}" ${tab?'':'disabled'}><span>${h(label)}</span><strong>${money(amount)}</strong>${tab?'<small>Open records →</small>':''}</button>`).join(''):'<p>No outstanding records.</p>'}</div>`);
    el.querySelectorAll('[data-breakdown]').forEach(button=>button.onclick=()=>{const row=list[Number(button.dataset.breakdown)];openSource({id:row[3] || '',tab:row[2],collection:'purchaseOrders'});});
  }
  function renderLists() {
    if(!current)return;
    const target=byId('workspaceRecordList');if(!target)return;
    let list=records(current).filter(r=>financial()||r.tab!=='billing');
    if(filter!=='all')list=list.filter(r=>r.tab===filter);
    if(query)list=list.filter(r=>[r.title,r.detail,r.label,r.createdByName,r.receivedByName,r.updatedByName,r.state,...rows(r.items).map(i=>[i.desc,i.description,i.size].join(' '))].join(' ').toLowerCase().includes(query));
    byId('workspaceRecordCount').textContent=`${list.length} matching record${list.length===1?'':'s'}`;
    target.replaceChildren();
    list.slice(0,60).forEach(record=>{const button=document.createElement('button');button.type='button';button.className='workspace-timeline-row';button.innerHTML=`<span class="workspace-record-type">${h(record.label)}</span><span><strong>${h(record.title)}</strong><small>${h(record.detail.slice(0,180))}</small></span><span><small>${h(record.when?new Date(record.when).toLocaleDateString('en-PH'):'Date not recorded')}</small><small>${h(record.state)}</small></span>`;button.onclick=()=>showRecord(record);target.append(button);});
    if(!list.length)target.innerHTML='<p class="workspace-empty">No matching records. Try another name or reference.</p>';
    if(list.length>60){const note=document.createElement('p');note.className='workspace-empty';note.textContent='Showing the latest 60 matches. Use search or a module filter to narrow the results.';target.append(note);}
  }
  function render(projectId, project) {
    current=project; if(currentId!==projectId){query='';filter='all';byId('projectRecordDialog')?.close();}currentId=projectId;
    const panel=byId('dashboardPanel');if(!panel)return;
    setupSiteUpdate();
    const taskSelect=byId('logLinkedTask');if(taskSelect){const chosen=taskSelect.value;taskSelect.replaceChildren();taskSelect.add(new Option('No linked task',''));rows(project.tasks).filter(r=>!closed(r)||r.id===chosen).forEach(r=>taskSelect.add(new Option(r.title || 'Task',r.id)));taskSelect.value=chosen;}
    let host=byId('workspaceInsights');
    if(!host){host=document.createElement('section');host.id='workspaceInsights';host.className='workspace-insights';panel.prepend(host);}
    const focus=document.activeElement?.id, start=document.activeElement?.selectionStart;
    const apm=status(root._currentUser?.role)==='apm', f=finance(project), todo=actions(project);
    const deadlines=rows(project.tasks).filter(r=>!closed(r)&&r.dueDate), late=deadlines.filter(r=>r.dueDate<date()&&!['for_verification','review'].includes(status(r.status)));
    const budgetState=f.budget<=0?'Budget not set':f.available<0?'Budget exceeded':f.available<f.budget*.15?'Budget getting tight':'Within recorded budget';
    host.innerHTML=`<header class="workspace-insights-heading"><div><span class="material-eyebrow">${apm?'APM WORKSPACE':'MISSION BOARD'} · ${h(date())}</span><h2>${h(project.name || 'Project')}</h2><p>${apm?'Record site progress, deliveries, and issues for the office.':'Your next decisions, current budget, and project records.'}</p></div><button type="button" class="btn-add" data-site>Post site update</button></header>
      <div class="workspace-health"><span class="${late.length?'is-alert':''}">${late.length?`${late.length} overdue task${late.length===1?'':'s'}`:deadlines.length?'No overdue task deadlines':'No active task deadlines recorded'}</span>${financial()?`<span class="${f.available<0?'is-alert':''}">${h(budgetState)}</span>`:''}<span>${todo.length} action${todo.length===1?'':'s'} to review</span></div>
      ${financial()?`<section class="workspace-card"><div class="workspace-section-head"><h3>Budget & commitments</h3><button type="button" class="workspace-text-button" data-explain>Explain these totals</button></div><div class="workspace-finance-grid">${[['budget','Approved budget',f.budget],['incurred','Recorded cost',f.incurred],['committed','Still committed',f.committed],['available','Available budget',f.available],['invoices','Supplier invoices',f.invoiced],['paid','Ledger marked paid',f.markedPaid]].map(([key,label,amount])=>`<button type="button" data-metric="${key}" class="${amount<0?'is-alert':''}"><span>${label}</span><strong>${money(amount)}</strong><small>View breakdown →</small></button>`).join('')}</div><p class="workspace-footnote">Pending approval: ${money(f.awaitingApproval)}. Invoice balance to verify: ${money(f.invoiceUnverified)}. Payment records are incomplete; receiving is not payment.</p></section>`:''}
      <section class="workspace-card"><div class="workspace-section-head"><h3>${apm?'Follow up & report':'Needs action'}</h3><span>${todo.length} items</span></div><div id="workspaceActionList"></div></section>
      <section class="workspace-card"><div class="workspace-section-head"><div><h3>Project timeline & search</h3><p>Find materials, people, suppliers, tasks, and document numbers.</p></div><span id="workspaceRecordCount" aria-live="polite"></span></div><div class="workspace-search"><input id="workspaceRecordSearch" type="search" aria-label="Search project records" placeholder="Search a material, name, PO or delivery…" value="${h(query)}"><select id="workspaceRecordFilter" aria-label="Filter records by module">${[['all','All records'],['materials','Materials & deliveries'],['tasks','Tasks'],['sitelog','Site updates'],['defects','Punch list'],['changeorders','Change orders'],['labor','Payroll'],...(financial()?[['billing','Client billing']]:[])].map(([v,t])=>`<option value="${v}"${filter===v?' selected':''}>${t}</option>`).join('')}</select></div><div id="workspaceRecordList"></div></section>`;
    host.querySelector('[data-site]').onclick=()=>openSource({tab:'sitelog',id:''});
    host.querySelectorAll('[data-metric]').forEach(b=>b.onclick=()=>financialDetail(b.dataset.metric));
    host.querySelector('[data-explain]')?.addEventListener('click',()=>financialDetail('available'));
    const list=byId('workspaceActionList');
    const financeCard=host.querySelector('.workspace-finance-grid')?.closest('section');
    if(financeCard){const overview=document.createElement('div');overview.className='workspace-overview';financeCard.before(overview);overview.append(list.closest('section'),financeCard);}
    todo.slice(0,20).forEach(item=>{const b=document.createElement('button');b.type='button';b.className=`workspace-action-row urgency-${item.urgency}`;const days=item.when?Math.max(0,Math.floor((Date.now()-item.when)/86400000)):null;b.innerHTML=`<span><strong>${h(item.title)}</strong><small>${h(item.reason)}</small><small>Next: ${h(item.owner)}${days!==null?` · ${days===0?'Today':`${days} day${days===1?'':'s'} old`}`:''}</small></span><b>${h(item.action)} →</b>`;b.onclick=()=>openSource(item,item.action==='Receive materials');list.append(b);});
    if(!todo.length)list.innerHTML='<p class="workspace-empty">No pending actions found in the recorded data.</p>';
    if(todo.length>20)list.insertAdjacentHTML('beforeend',`<p class="workspace-footnote">${todo.length-20} more items are available in the project modules.</p>`);
    byId('workspaceRecordSearch').oninput=e=>{query=e.target.value.trim().toLowerCase();renderLists();};
    byId('workspaceRecordFilter').onchange=e=>{filter=e.target.value;renderLists();};renderLists();
    if(focus==='workspaceRecordSearch'){byId(focus).focus();try{byId(focus).setSelectionRange(start,start);}catch(_){}}
    const legacy=panel.querySelector('.project-dash-grid');if(legacy)legacy.classList.add('workspace-legacy-details');
    if(apm){panel.querySelector('.apm-project-hero')?.setAttribute('hidden','');panel.querySelector('.apm-project-today')?.setAttribute('hidden','');}
    const params=new URLSearchParams(location.search), recordId=params.get('recordId'), collection=params.get('recordCollection');
    const routeKey=`${projectId}:${collection}:${recordId}`;
    if(params.get('fromNotif')==='1' && recordId && collection && routeKey!==routeHandled){const record=records(project).find(r=>r.id===recordId&&r.collection===collection);if(record && (record.tab!=='billing'||financial())){routeHandled=routeKey;showRecord(record);}}
  }
  root.renderConnectedWorkspace=render;
  root.openProjectRecord=showRecord;
  root.openWorkspaceSource=openSource;
  function setupSiteUpdate() {
    const form=document.querySelector('#sitelogPanel .log-form');if(!form || byId('apmSiteCore'))return;
    const core=document.createElement('div');core.id='apmSiteCore';core.className='workspace-site-core';
    const advanced=document.createElement('details');advanced.className='workspace-site-details';advanced.innerHTML='<summary>Additional site details</summary>';
    const field=(id,label,target)=>{const input=byId(id);if(!input)return;const wrapper=document.createElement('label');wrapper.className='material-field';const text=document.createElement('span');text.textContent=label;wrapper.append(text,input);target.append(wrapper);};
    field('logDate','Report date',core);field('logWork','Work accomplished',core);field('logIssues','Issues / decisions needed (one per line)',core);field('logDelays','Delays / blockers (one per line)',core);
    const link=document.createElement('label');link.className='material-field';link.innerHTML='<span>Related task (optional)</span><select id="logLinkedTask" aria-label="Related task"><option value="">No linked task</option></select>';core.append(link);
    field('logSafetyIncidents','Safety incidents (if any)',core);
    for(const [id,label] of [['logNotes','Additional notes'],['logManpower','Manpower / trades'],['logEquipment','Equipment used'],['logVisitors','Visitors'],['logSafety','Safety notes'],['logWeather','Weather'],['logPhotos','Photo links']])field(id,label,advanced);
    form.prepend(core);const photos=form.querySelector('.log-photo-row');if(photos)photos.before(advanced);else form.append(advanced);
    form.querySelectorAll('.task-form-row,.log-date-row').forEach(row=>{if(!row.children.length)row.remove();});
    const save=form.querySelector('[onclick="saveLog()"]');if(save)save.textContent='Post site update';
    const hint=form.querySelector('.log-photo-hint');if(hint)hint.textContent='Attach progress, delivery, or issue photos · up to 10 MB each';
  }
  root.setupApmSiteUpdate=setupSiteUpdate;
})(typeof window!=='undefined'?window:globalThis);
