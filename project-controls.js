// Payment records describe money already paid; this module never transfers money.
(function (root) {
  'use strict';
  const rows = value => Object.entries(value || {}).filter(([,v]) => v && typeof v === 'object').map(([id,v]) => ({...v,id}));
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const cents = value => Math.round(number(value) * 100);
  const key = item => [item.desc || item.description || item.item,item.size,item.unit].map(v=>String(v || '').trim().toLowerCase()).join('|');
  const poName = po => po.poNo || `PO-${String(po.seq || 0).padStart(3,'0')}`;
  function payrollRows(log) {
    const workers = rows(log.workerDetails).length ? rows(log.workerDetails) : rows(log.byTrade).flatMap(trade=>rows(trade.workers).map(w=>({...w,trade:trade.id})));
    return workers.map(worker=>{
      const advance = cents(log.cashAdvancesDeducted?.[worker.id]?.totalDeduct);
      return {...worker,name:worker.name || 'Worker name unavailable',grossCents:cents(worker.gross),advanceCents:advance,netCents:cents(worker.net ?? worker.gross)- (worker.net == null ? advance : 0)};
    });
  }
  function balance(events,kind,sourceId,due) {
    const relevant = rows(events).filter(e=>e.kind===kind && e.sourceId===sourceId);
    const voided = new Set(relevant.filter(e=>e.type==='void').map(e=>e.voids));
    const active = relevant.filter(e=>e.type!=='void' && !voided.has(e.id));
    const paid = active.filter(e=>e.type==='payment').reduce((s,e)=>s+number(e.amountCents),0);
    const credits = active.filter(e=>e.type==='credit').reduce((s,e)=>s+number(e.amountCents),0);
    return {paid,credits,remaining:cents(due)-paid-credits,history:relevant,voided};
  }
  function planning(project,planId,plan) {
    const ordered = rows(project.purchaseOrders).filter(po=>!['cancelled','rejected','draft'].includes(po.status)).flatMap(po=>rows(po.items).map(line=>({...line,poStatus:po.status})));
    return rows(plan.items).map(item=>{
      const matches=ordered.filter(line=>line.planId===planId && key(line)===key(item));
      const submitted=matches.filter(l=>l.poStatus==='pending_approval').reduce((s,l)=>s+number(l.qtyOrdered??l.qty),0);
      const committed=matches.filter(l=>l.poStatus!=='pending_approval').reduce((s,l)=>s+number(l.qtyOrdered??l.qty),0);
      const received=matches.reduce((s,l)=>s+number(l.qtyAccepted??l.qtyReceived),0);
      return {...item,planned:number(item.qty),submitted,ordered:committed,received,toOrder:Math.max(0,number(item.qty)-submitted-committed),toReceive:Math.max(0,committed-received)};
    });
  }
  function validatePayment(input,today) {
    if(!['payment','credit'].includes(input.type))throw Error('Choose a payment or supplier credit.');
    if(!Number.isSafeInteger(input.amountCents)||input.amountCents<=0||input.amountCents>100000000000)throw Error('Enter a positive amount with at most two decimal places.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||input.date>today||Number.isNaN(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date)throw Error('Use a valid payment date, today or earlier.');
    for(const [field,label,max] of [['reference','Payment or receipt reference',120],['payeeName','Payee name',120],['notes','Notes',500]]){
      if(typeof input[field]!=='string'||input[field].length>max||(field!=='notes'&&!input[field].trim()))throw Error(`${label} is required (maximum ${max} characters).`);
    }
    if(input.kind==='payroll'&&input.type!=='payment')throw Error('Payroll credits are not supported.');
    if(!['cash','bank','ewallet','other'].includes(input.method))throw Error('Choose a payment method.');
    return input;
  }
  const api={rows,cents,payrollRows,balance,planning,validatePayment};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.ProjectControls=api;
  if(typeof document==='undefined')return;
  let pid='',project={},events={},paymentRef=null,account='',paymentReady=false,paymentError='',saving=false;
  const el=id=>document.getElementById(id);
  const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>typeof peso==='function'?peso(value/100):`PHP ${(value/100).toFixed(2)}`;
  const today=()=>materialToday();
  const financial=()=>['boss','owner','admin','pm'].includes(root._currentUser?.role);
  const editable=()=>typeof canEditProject==='function' && canEditProject(pid);
  function dialog(title,body){
    let node=el('projectControlDialog');
    if(!node){node=document.createElement('dialog');node.id='projectControlDialog';node.className='workspace-dialog project-control-dialog';node.setAttribute('aria-labelledby','projectControlTitle');document.body.append(node);}
    node.innerHTML=`<header><h2 id="projectControlTitle">${h(title)}</h2><button type="button" class="btn-ws-secondary" data-close>Close</button></header>${body}<p data-error role="alert" class="control-error"></p>`;
    node.querySelector('[data-close]').onclick=()=>node.close();
    if(!node.open)node.showModal();return node;
  }
  function detach(){if(paymentRef)paymentRef.off();paymentRef=null;events={};paymentReady=false;paymentError='';pid='';account='';project={};el('projectControlDialog')?.close();['payrollControlPanel','materialView_payments','materialView_planning'].forEach(id=>el(id)?.replaceChildren());}
  root.detachProjectControls=detach;
  function setup(){
    const nav=el('materialWorkspaceNav');
    if(nav && !el('materialView_planning')){
      for(const [view,label] of [['planning','Material plan'],['payments','Supplier balances']]){
        const button=document.createElement('button');button.type='button';button.dataset.view=view;button.textContent=label;button.setAttribute('aria-pressed','false');button.onclick=()=>showMaterialsView(view);nav.append(button);
        const panel=document.createElement('section');panel.id=`materialView_${view}`;panel.dataset.materialView=view;panel.hidden=true;panel.setAttribute('aria-label',label);panel.className='control-panel';nav.parentElement.insertBefore(panel,nav.parentElement.querySelector('.material-stock-control'));
      }
    }
    const labor=el('laborPanel');
    if(labor&&!el('payrollControlPanel')){const panel=document.createElement('section');panel.id='payrollControlPanel';panel.className='control-panel';labor.prepend(panel);}
  }
  function render(projectId,snapshot){
    if(!projectId)return;
    const newAccount=`${root._currentUser?.uid || ''}:${root._currentUser?.role || ''}`;
    if(pid!==projectId||account!==newAccount){
      detach();pid=projectId;account=newAccount;
      if(financial()){
        paymentRef=firebase.database().ref(`projectPaymentEvents/${pid}`);
        paymentRef.on('value',snap=>{if(pid!==projectId||account!==newAccount)return;events=snap.val()||{};paymentReady=true;paymentError='';renderPayments();},()=>{if(pid!==projectId||account!==newAccount)return;paymentReady=false;paymentError='Payment records could not be loaded. Refresh before recording a payment.';renderPayments();});
      }
    }
    project=snapshot||{};setup();
    const heading=el('workspaceInsights')?.querySelector('h2');
    if(el('wsName'))el('wsName').textContent=project.name || 'Untitled';
    if(heading&&financial()&&editable()&&!el('workspaceEditProject')){const b=document.createElement('button');b.id='workspaceEditProject';b.type='button';b.className='workspace-text-button';b.textContent='✎ Edit project name';b.onclick=renameProject;heading.after(b);}
    renderPlans();renderPayments();
  }
  root.renderProjectControls=render;
  function renameProject(){
    if(!financial()||!editable())return;
    const targetPid=pid,oldName=project.name;
    const node=dialog('Edit project name',`<form><label>Project name<input name="name" maxlength="100" value="${h(oldName)}" required></label><button type="submit" class="btn-add">Save name</button></form>`);
    node.querySelector('form').onsubmit=async e=>{
      e.preventDefault();if(saving||pid!==targetPid||!financial()||!editable())return;
      try{
        const result=validateProjectName(node.querySelector('[name=name]').value);if(!result.ok)throw Error(result.msg);
        saving=true;e.submitter.disabled=true;
        if(typeof canListAllProjects==='function'&&canListAllProjects(root._currentUser)){
          const duplicates=await firebase.database().ref('projects').orderByChild('name').equalTo(result.value).once('value');
          if(rows(duplicates.val()).some(p=>p.id!==targetPid))throw Error('A project with that name already exists.');
        }
        const saved=await firebase.database().ref(`projects/${targetPid}/name`).transaction(name=>name===oldName?result.value:undefined);
        if(!saved.committed)throw Error('The project name changed in another session. Reopen this form before saving.');
        if(pid===targetPid){node.close();showToast('Project name updated.');}
      }catch(error){node.querySelector('[data-error]').textContent=error.message;}finally{saving=false;e.submitter.disabled=false;}
    };
  }
  function paymentTable(kind){
    const sources=kind==='payroll'?rows(project.payrollLogs).sort((a,b)=>number(b.savedAt)-number(a.savedAt)):rows(project.purchaseOrders).filter(po=>!['cancelled','rejected','draft'].includes(po.status)||rows(events).some(e=>e.kind==='supplier'&&e.sourceId===po.id));
    if(!sources.length)return `<p class="workspace-empty">${kind==='payroll'?'No finalized payroll yet. Prepare and review a payroll below; its payment record appears here after finalizing.':'No purchase orders yet.'}</p>`;
    return `<div class="workspace-table-scroll"><table class="control-table"><thead><tr><th>${kind==='payroll'?'Payroll period':'Order / hardware'}</th><th>${kind==='payroll'?'Net payroll':'Invoice'}</th><th>Payments</th><th>Credits</th><th>Balance</th><th></th></tr></thead><tbody>${sources.map(source=>{
      const known=kind==='payroll'||number(source.invoiceAmount)>0;
      const b=balance(events,kind,source.id,kind==='payroll'?source.net:source.invoiceAmount);
      const label=kind==='payroll'?`${source.weekStart || source.period || 'Payroll'}${source.weekEnd?' — '+source.weekEnd:''}`:`${poName(source)} · ${source.supplierName || source.supplier || 'Hardware'}`;
      return `<tr><td><strong>${h(label)}</strong>${kind==='supplier'?`<small>${h(source.invoiceNo || 'Invoice reference not recorded')} · ${h(source.invoiceStatus || 'Not checked')}</small>`:'<small>Finalized payroll • payment tracked separately</small>'}</td><td>${known?money(cents(kind==='payroll'?source.net:source.invoiceAmount)):'Not recorded'}</td><td>${paymentReady?money(b.paid):'—'}</td><td>${paymentReady?money(b.credits):'—'}</td><td>${!paymentReady?'—':!known?'Invoice needed':`${money(Math.abs(b.remaining))}<small>${b.remaining<0?'Overpaid / credit':b.remaining===0?'Settled from recorded entries':'Remaining from recorded entries'}</small>`}</td><td><button type="button" class="btn-ws-secondary" data-payment-source="${h(source.id)}" data-kind="${kind}">Review / payments</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function renderPayments(){
    const payroll=el('payrollControlPanel'),supplier=el('materialView_payments');
    const nav=document.querySelector('#materialWorkspaceNav [data-view="payments"]');
    if(nav)nav.hidden=!financial();
    if(payroll)payroll.hidden=!financial();
    if(!financial()){if(supplier)supplier.hidden=true;return;}
    const note=paymentError || (!paymentReady?'Loading payment register…':'Record payments already made, including historical payments, before treating these balances as reconciled. Old ledger “paid” labels are not imported automatically.');
    if(payroll)payroll.innerHTML=`<div class="workspace-section-head"><div><h2>Payroll review & payments</h2><p>Review → finalize payroll → record payment</p></div></div><p class="workspace-footnote">${h(note)}</p>${paymentTable('payroll')}`;
    if(supplier)supplier.innerHTML=`<div class="workspace-section-head"><div><h2>Supplier balances</h2><p>Orders, invoices, payments and credits in one place.</p></div></div><p class="workspace-footnote">${h(note)}</p>${paymentTable('supplier')}`;
    [payroll,supplier].filter(Boolean).forEach(panel=>panel.querySelectorAll('[data-payment-source]').forEach(b=>b.onclick=()=>openPayment(b.dataset.kind,b.dataset.paymentSource)));
    const metric=el('workspaceInsights')?.querySelector('[data-metric="paid"]');
    if(metric){
      const balances=rows(project.purchaseOrders).map(po=>balance(events,'supplier',po.id,po.invoiceAmount));
      const paid=balances.reduce((s,b)=>s+b.paid,0),remaining=balances.reduce((s,b)=>s+b.remaining,0);
      metric.innerHTML=`<span>Supplier payments recorded</span><strong>${paymentReady?money(paid):'—'}</strong><small>Open payment register →</small>`;
      metric.onclick=()=>{switchTab('materials');showMaterialsView('payments');};
      const footnote=metric.closest('section')?.querySelector('.workspace-footnote');
      if(footnote)footnote.textContent=paymentReady?`Invoice balance from recorded payments and credits: ${money(remaining)}. Include historical payments before treating this as reconciled; orders without invoice amounts need checking.`:note;
    }
  }
  function openPayment(kind,sourceId){
    if(!financial())return;
    const source=(kind==='payroll'?project.payrollLogs:project.purchaseOrders)?.[sourceId];if(!source)return;
    const sourceLabel=kind==='payroll'?`Payroll · ${source.weekStart || source.period || ''}${source.weekEnd?' — '+source.weekEnd:''}`:`${poName(source)} · ${source.supplierName || source.supplier || 'Hardware'}`;
    const b=balance(events,kind,sourceId,kind==='payroll'?source.net:source.invoiceAmount);
    const workers=kind==='payroll'?payrollRows(source):[];
    const unallocated=kind==='payroll'?workers.reduce((sum,w)=>sum+w.netCents,0)-cents(source.net):0;
    const workerTable=kind==='payroll'?`<p class="workspace-footnote">Archived rates and attendance are preserved.${unallocated?` ${money(unallocated)} differs between worker net amounts and the payroll total. Review batch deductions before assigning individual payments.`:''}</p><div class="workspace-table-scroll"><table class="control-table"><thead><tr><th>Worker</th><th>Rate / days</th><th>Regular</th><th>OT / night</th><th>Gross</th><th>Advance</th><th>Net after advance</th></tr></thead><tbody>${workers.map(w=>`<tr><td>${h(w.name)}<small>${h(w.trade)}</small></td><td>${money(cents(w.rate))} / ${h(w.days)}</td><td>${money(cents(w.regular))}</td><td>${money(cents(number(w.ot)+number(w.night)))}</td><td>${money(w.grossCents)}</td><td>${money(w.advanceCents)}</td><td>${money(w.netCents)}</td></tr>`).join('')}</tbody></table></div>`:'';
    const sourceInfo=kind==='supplier'?`<p>${h(source.invoiceNo || 'Invoice number not recorded')} · ${h(source.invoiceStatus || 'Invoice not checked')} · ${h(source.deliveryStatus || source.status)}</p>${source.invoiceStatus==='mismatch'?'<p class="control-error">Invoice mismatch is still open. Verify the invoice and delivery before recording a settlement.</p>':''}`:'';
    const node=dialog(sourceLabel,`${sourceInfo}${workerTable}<div class="control-totals"><span>Payments <strong>${paymentReady?money(b.paid):'—'}</strong></span><span>Credits <strong>${paymentReady?money(b.credits):'—'}</strong></span><span>Recorded balance <strong>${paymentReady?(kind==='supplier'&&number(source.invoiceAmount)<=0?'Invoice not recorded':money(b.remaining)):'—'}</strong></span></div><p class="workspace-footnote">Payment entries do not change payroll, material cost or inventory. Confirm historical payments are included before relying on the balance.</p><div class="control-payment-history">${b.history.length?b.history.sort((a,b)=>number(b.createdAt)-number(a.createdAt)).map(entry=>`<article><strong>${h(entry.date)} · ${h(entry.type)} ${money(entry.amountCents)}</strong><p>${h(entry.payeeName)} · ${h(entry.reference)} · ${h(entry.method)}</p><small>${h(entry.notes)} · Recorded by ${h(entry.createdByName)}</small>${entry.type!=='void'?(b.voided.has(entry.id)?'<span>Voided — retained for history</span>':`<button type="button" class="workspace-text-button" data-void="${h(entry.id)}">Correct / void entry</button>`):''}</article>`).join(''):'<p>No payment entries recorded yet.</p>'}</div>${paymentReady&&editable()?`<form id="paymentEntryForm"><h3>Record a payment already made</h3><div class="control-form-grid"><label>Entry type<select name="type"><option value="payment">Payment</option>${kind==='supplier'?'<option value="credit">Supplier credit note</option>':''}</select></label><label>Amount (PHP)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Date<input name="date" type="date" value="${today()}" max="${today()}" required></label><label>Method<select name="method"><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="ewallet">E-wallet</option><option value="other">Other / credit note</option></select></label><label>Paid to / payee<input name="payeeName" maxlength="120" list="paymentPayees" value="${kind==='supplier'?h(source.supplierName || source.supplier || ''):''}" required><datalist id="paymentPayees">${workers.map(w=>`<option value="${h(w.name)}"></option>`).join('')}</datalist></label><label>Receipt / transaction / credit note reference<input name="reference" maxlength="120" required></label><label class="control-wide">Notes<input name="notes" maxlength="500" placeholder="Allocation, payment coverage or explanation"></label></div><button type="submit" class="btn-add">Save payment record</button></form>`:`<p class="workspace-footnote">${h(paymentError || 'Payment recording is unavailable until the register is loaded and you have edit access.')}</p>`}`);
    const targetPid=pid,actor={uid:root._currentUser.uid,name:root._currentUser.name || root._currentUser.displayName || 'Name unavailable'};
    const eventId=firebase.database().ref(`projectPaymentEvents/${targetPid}`).push().key;
    node.querySelector('form')?.addEventListener('submit',async e=>{
      e.preventDefault();if(saving||pid!==targetPid||!financial()||!editable())return;
      const data=Object.fromEntries(new FormData(e.target));
      try{
        const amount=Number(data.amount);if(!Number.isFinite(amount)||Math.abs(amount*100-Math.round(amount*100))>0.00001)throw Error('Use at most two decimal places.');
        const input=validatePayment({...data,amountCents:cents(amount),kind,sourceId,payeeName:data.payeeName.trim(),reference:data.reference.trim(),notes:data.notes.trim()},today());delete input.amount;
        if(rows(events).some(x=>x.type===input.type&&x.kind===kind&&x.sourceId===sourceId&&x.date===input.date&&x.reference.toLowerCase()===input.reference.toLowerCase()&&!b.voided.has(x.id)))throw Error('An entry with this date and reference already exists. Review the history first.');
        if((kind==='payroll'||number(source.invoiceAmount)>0) && input.amountCents>b.remaining && !confirm('This amount exceeds the recorded balance. Save it as an overpayment / credit after checking the amount?'))return;
        saving=true;e.submitter.disabled=true;
        await firebase.database().ref(`projectPaymentEvents/${targetPid}/${eventId}`).set({...input,createdAt:Date.now(),createdBy:actor.uid,createdByName:actor.name});
        if(pid===targetPid){openPayment(kind,sourceId);showToast('Payment record saved.');}
      }catch(error){node.querySelector('[data-error]').textContent=error.message;}finally{saving=false;if(e.submitter)e.submitter.disabled=false;}
    });
    node.querySelectorAll('[data-void]').forEach(button=>button.onclick=async()=>{
      if(saving||pid!==targetPid||!editable()||!financial())return;
      const reason=prompt('Why is this entry incorrect? It will remain in history; record the corrected payment separately.');if(!reason?.trim())return;
      if(reason.length>500){node.querySelector('[data-error]').textContent='Keep the correction reason within 500 characters.';return;}
      const original=events[button.dataset.void];if(!original)return;
      try{saving=true;button.disabled=true;await firebase.database().ref(`projectPaymentEvents/${targetPid}/void_${button.dataset.void}`).set({kind,sourceId,type:'void',amountCents:0,date:today(),payeeName:original.payeeName,reference:original.reference,method:original.method,notes:reason.trim(),voids:button.dataset.void,createdAt:Date.now(),createdBy:actor.uid,createdByName:actor.name});if(pid===targetPid)openPayment(kind,sourceId);}catch(error){node.querySelector('[data-error]').textContent=error.message;}finally{saving=false;button.disabled=false;}
    });
  }
  root.openProjectPaymentRecord=openPayment;
  function renderPlans(){
    const panel=el('materialView_planning');if(!panel)return;
    const plans=rows(project.materialPlans).filter(p=>!p.archived);
    panel.innerHTML=`<div class="workspace-section-head"><div><h2>Material plan</h2><p>Plan a work package, then order only what it still needs.</p></div>${editable()?'<button type="button" class="btn-add" data-new-plan>+ Work package</button>':''}</div><p class="workspace-footnote">Only orders created from a work package count toward it. Existing orders stay unallocated until you link them. Pending approval quantities are reserved to avoid ordering them twice.</p>${plans.length?plans.map(plan=>{
      const lines=planning(project,plan.id,plan);
      return `<article class="control-plan"><div class="workspace-section-head"><h3>${h(plan.name)}</h3><div><button type="button" class="btn-ws-secondary" data-edit-plan="${h(plan.id)}" ${!editable()?'disabled':''}>Edit plan</button> <button type="button" class="btn-add" data-order-plan="${h(plan.id)}" ${!editable()||!lines.some(l=>l.toOrder>0)?'disabled':''}>Order remaining</button></div></div><div class="workspace-table-scroll"><table class="control-table"><thead><tr><th>Material / specification</th><th>Planned</th><th>Awaiting approval</th><th>Ordered</th><th>Received</th><th>Still to order</th></tr></thead><tbody>${lines.map(l=>`<tr><td>${h(l.desc)} ${h(l.size)}<small>${h(l.unit)}</small></td><td>${h(l.planned)}</td><td>${h(l.submitted)}</td><td>${h(l.ordered)}</td><td>${h(l.received)}</td><td>${h(l.toOrder)}</td></tr>`).join('')}</tbody></table></div><button type="button" class="workspace-text-button" data-link-plan="${h(plan.id)}" ${!editable()?'disabled':''}>Link an existing order</button></article>`;
    }).join(''):'<p class="workspace-empty">No work packages yet. Start from a saved material group, such as Ceiling framing, and set the total quantities needed.</p>'}`;
    panel.querySelector('[data-new-plan]')?.addEventListener('click',()=>editPlan());
    panel.querySelectorAll('[data-edit-plan]').forEach(b=>b.onclick=()=>editPlan(b.dataset.editPlan));
    panel.querySelectorAll('[data-order-plan]').forEach(b=>b.onclick=()=>orderPlan(b.dataset.orderPlan));
    panel.querySelectorAll('[data-link-plan]').forEach(b=>b.onclick=()=>linkPlan(b.dataset.linkPlan));
  }
  function editPlan(id){
    if(!editable())return;
    const existing=project.materialPlans?.[id],targetPid=pid;
    const node=dialog(existing?'Edit work package':'New work package',`<form id="materialPlanForm"><label>Work package name<input name="name" maxlength="80" value="${h(existing?.name || '')}" required></label>${!existing?`<label>Start from a material group<select id="planGroup"><option value="">Choose a group or add materials below</option>${rows(project.materialGroups).filter(g=>!g.archived).map(g=>`<option value="${h(g.id)}">${h(g.name)}</option>`).join('')}</select></label>`:''}<p class="workspace-footnote">Quantities are the total needed for this work package. Keep material names, specifications and units consistent with linked orders.</p><div id="planLines"></div><button type="button" class="btn-ws-secondary" data-add-line>+ Material</button><button type="submit" class="btn-add">Save work package</button></form>`);
    const add=item=>{const row=document.createElement('div');row.className='control-plan-line';row.innerHTML=`<label>Material<input data-field="desc" maxlength="150" value="${h(item.desc || '')}" required></label><label>Specification<input data-field="size" maxlength="100" value="${h(item.size || '')}"></label><label>Unit<input data-field="unit" maxlength="30" value="${h(item.unit || 'pcs')}" required></label><label>Planned quantity<input data-field="qty" type="number" min="0.001" step="any" value="${h(item.qty || 1)}" required></label><button type="button" class="workspace-text-button" aria-label="Remove material">Remove</button>`;row.querySelector('button').onclick=()=>row.remove();el('planLines').append(row);};
    rows(existing?.items).forEach(add);if(!existing)add({});
    node.querySelector('[data-add-line]').onclick=()=>add({});
    el('planGroup')?.addEventListener('change',e=>{const group=project.materialGroups?.[e.target.value];if(!group)return;el('planLines').replaceChildren();rows(group.items).forEach(add);if(!node.querySelector('[name="name"]').value)node.querySelector('[name="name"]').value=group.name;});
    node.querySelector('form').onsubmit=async e=>{
      e.preventDefault();if(saving||pid!==targetPid||!editable())return;
      try{
        const name=node.querySelector('[name="name"]').value.trim();if(!name||name.length>80)throw Error('Enter a work package name.');
        const items=Array.from(node.querySelectorAll('.control-plan-line')).map(row=>Object.fromEntries(Array.from(row.querySelectorAll('[data-field]')).map(i=>[i.dataset.field,i.dataset.field==='qty'?Number(i.value):i.value.trim()])));
        if(!items.length||items.length>100||items.some(i=>!i.desc||!i.unit||!Number.isFinite(i.qty)||i.qty<=0))throw Error('Add 1–100 materials with names, units and positive quantities.');
        if(new Set(items.map(key)).size!==items.length)throw Error('Combine duplicate materials into one planned quantity.');
        saving=true;e.submitter.disabled=true;
        const target=firebase.database().ref(`projects/${targetPid}/materialPlans/${id || firebase.database().ref().push().key}`);
        const result=await target.transaction(current=>{
          if(existing && JSON.stringify(current)!==JSON.stringify(existing))return;
          return {name,items,createdAt:existing?.createdAt || Date.now(),updatedAt:Date.now(),updatedBy:root._currentUser.uid,updatedByName:root._currentUser.name || root._currentUser.displayName || 'Name unavailable'};
        });
        if(!result.committed)throw Error('This work package changed in another session. Close and reopen it before saving.');
        if(pid===targetPid){node.close();showToast('Work package saved.');}
      }catch(error){node.querySelector('[data-error]').textContent=error.message;}finally{saving=false;if(e.submitter)e.submitter.disabled=false;}
    };
  }
  function orderPlan(id){
    if(!editable())return;
    const plan=project.materialPlans?.[id];if(!plan)return;
    const lines=planning(project,id,plan).filter(l=>l.toOrder>0);
    lines.forEach(line=>{
      const inDraft=_draftItems.filter(d=>d.planId===id&&key(d)===key(line)).reduce((sum,d)=>sum+number(d.qty),0);
      const qty=Math.max(0,line.toOrder-inDraft);if(!qty)return;
      const price=materialPriceFor(line);
      _draftItems.push({desc:line.desc,size:line.size || '',unit:line.unit,qty,cost:price?.cost || 0,total:qty*(price?.cost || 0),planId:id,planName:plan.name});
    });
    renderDraft();showMaterialsView('new');showToast('Remaining quantities added to your draft. Select hardware and review prices before submitting.');
  }
  function linkPlan(planId){
    if(!editable())return;
    const plan=project.materialPlans?.[planId],targetPid=pid;
    const candidates=rows(project.purchaseOrders).filter(po=>rows(po.items).some(line=>!line.planId&&rows(plan.items).some(item=>key(item)===key(line))));
    const node=dialog('Link an existing order',`<p>Matching, unallocated material lines will be assigned to ${h(plan.name)}. Their quantities and delivery history stay intact.</p><label>Purchase order<select id="linkPlanOrder">${candidates.map(po=>`<option value="${h(po.id)}">${h(poName(po))} · ${h(po.supplierName || po.supplier)}</option>`).join('')}</select></label><button class="btn-add" data-link ${!candidates.length?'disabled':''}>Link matching materials</button>`);
    node.querySelector('[data-link]').onclick=async e=>{
      if(saving||pid!==targetPid||!editable())return;
      try{saving=true;e.target.disabled=true;const orderId=el('linkPlanOrder').value;const result=await firebase.database().ref(`projects/${targetPid}/purchaseOrders/${orderId}/items`).transaction(items=>{
        if(!items)return;const next=JSON.parse(JSON.stringify(items));Object.values(next).forEach(line=>{if(!line.planId&&rows(plan.items).some(item=>key(item)===key(line))){line.planId=planId;line.planName=plan.name;}});return next;
      });if(!result.committed)throw Error('Order no longer exists.');if(pid===targetPid){node.close();showToast('Matching materials linked.');}}catch(error){node.querySelector('[data-error]').textContent=error.message;}finally{saving=false;e.target.disabled=false;}
    };
  }
})(typeof window!=='undefined'?window:globalThis);
