// ═══════════════════════════════════════════════════════════════
//  ACPM v4 — labor.js
//  Trades (dynamic) · Roster · Weekly timecard
//  Cash advances · Attendance summary · Payroll logs archive
//  RFP generator + PDF download
// ═══════════════════════════════════════════════════════════════

let _lpid = null;

// ── Boot ──────────────────────────────────────────────────────
function initLabor(pid){
  _lpid = pid;
  watchLaborBudget(pid);
  watchTrades(pid);
  watchPayrollLogs(pid);
}

// ── KPIs with budget warning ──────────────────────────────────
function watchLaborBudget(pid){
  listen(firebase.database().ref(`projects/${pid}`), snap=>{
    const d=snap.val()||{};
    const budget=parseFloat(d.laborBudget)||0;
    const spent =parseFloat(d.laborSpent) ||0;
    const left  =budget-spent;
    const p     =pct(spent,budget);
    setText('lbBudget', peso(budget));
    setText('lbSpent',  peso(spent));
    const el=$('lbLeft');
    if (el){ el.textContent=peso(left); el.className=`kpi-num ${left<0?'kpi-danger':'kpi-safe'}`; }
    // warning banner
    const wb=$('laborBudgetWarn');
    if (wb){
      wb.classList.toggle('hidden', p<80);
      wb.className = `budget-warn-bar ${p>=95?'warn-critical':'warn-high'} ${p<80?'hidden':''}`;
      wb.textContent = p>=95
        ? `⚠ CRITICAL — Labor budget ${p}% used! Only ${peso(left)} remaining.`
        : `⚠ WARNING — Labor budget ${p}% used. ${peso(left)} remaining.`;
    }
  });
}

// ══════════════════════════════════════════════════════
//  TRADES
// ══════════════════════════════════════════════════════
let _tradesSnap = null;

function watchTrades(pid){
  listen(firebase.database().ref(`projects/${pid}/trades`), snap=>{
    _tradesSnap = snap;
    renderTradeChips(snap);
    populateTradeSelect(snap);
    watchWorkers(pid);
  });
}

function renderTradeChips(snap){
  const el=$('tradeList'); if (!el) return;
  el.innerHTML='';
  if (!snap.exists()){ el.innerHTML='<p class="empty-hint">No trades yet.</p>'; return; }
  snap.forEach(c=>{
    const t=c.val();
    el.innerHTML+=`<div class="trade-chip">
      <span class="trade-chip-name">${t.name}</span>
      <button class="chip-edit" onclick="renameTrade('${c.key}','${t.name}')">✎</button>
      <button class="chip-del"  onclick="deleteTrade('${c.key}','${t.name}')">✕</button>
    </div>`;
  });
}

async function addTrade(){
  const inp=$('newTradeName'); const name=inp?.value.trim();
  if (!name||!_lpid) return;
  await firebase.database().ref(`projects/${_lpid}/trades`).push({name});
  inp.value='';
}
async function renameTrade(key,old){
  const n=prompt(`Rename "${old}":`,old);
  if (!n||!n.trim()||n===old||!_lpid) return;
  await firebase.database().ref(`projects/${_lpid}/trades/${key}`).update({name:n.trim()});
}
async function deleteTrade(key,name){
  if (!_lpid||!confirm(`Delete trade "${name}"?`)) return;
  await firebase.database().ref(`projects/${_lpid}/trades/${key}`).remove();
}

function populateTradeSelect(snap){
  const sel=$('workerTradeSelect'); if (!sel) return;
  const prev=sel.value;
  sel.innerHTML='<option value="">— Select Trade —</option>';
  snap?.forEach(c=>{ sel.innerHTML+=`<option value="${c.val().name}">${c.val().name}</option>`; });
  sel.value=prev;
}

// ══════════════════════════════════════════════════════
//  WORKERS + CASH ADVANCES
// ══════════════════════════════════════════════════════
function watchWorkers(pid){
  listen(firebase.database().ref(`projects/${pid}/workers`), wSnap=>{
    renderRoster(wSnap,pid);
    rebuildGrid(pid,wSnap);
  });
  listen(firebase.database().ref(`projects/${pid}/timecards`), _=>{
    firebase.database().ref(`projects/${pid}/workers`).once('value',wSnap=>rebuildGrid(pid,wSnap));
  });
}

function renderRoster(wSnap,pid){
  const el=$('rosterList'); if (!el) return;
  el.innerHTML='';
  if (!wSnap.exists()){ el.innerHTML='<p class="empty-hint">No workers yet.</p>'; return; }
  wSnap.forEach(c=>{
    const w=c.val();
    el.innerHTML+=`<div class="roster-row">
      <div class="roster-info">
        <span class="roster-name">${w.name}</span>
        <span class="roster-trade-tag">${w.trade||'No Trade'}</span>
      </div>
      <span class="roster-rate">${peso(w.dailyRate)}/day</span>
      <button class="btn-advance" onclick="openAdvanceModal('${c.key}','${w.name}')">₱ Advance</button>
      <button class="del-worker"  onclick="removeWorker('${c.key}')">✕</button>
    </div>`;
  });
}

async function addWorker(){
  if (!_lpid) return;
  const name =document.getElementById('workerName')?.value.trim();
  const trade=document.getElementById('workerTradeSelect')?.value;
  const rate =parseFloat(document.getElementById('workerRate')?.value)||0;
  if (!name)     { alert('Enter worker name.'); return; }
  if (!trade)    { alert('Select a trade.'); return; }
  if (rate<=0)   { alert('Enter daily rate.'); return; }
  await firebase.database().ref(`projects/${_lpid}/workers`).push({name,trade,dailyRate:rate,addedAt:Date.now()});
  document.getElementById('workerName').value='';
  document.getElementById('workerRate').value='';
}

async function removeWorker(wid){
  if (!_lpid||!confirm('Remove this worker?')) return;
  await firebase.database().ref(`projects/${_lpid}/workers/${wid}`).remove();
}

// ── Cash Advance Modal ────────────────────────────────
let _advanceWorkerId=null, _advanceWorkerName='';

function openAdvanceModal(wid,name){
  _advanceWorkerId=wid; _advanceWorkerName=name;
  setText('advanceWorkerName',name);
  loadAdvanceHistory(wid);
  $('advanceModal').classList.remove('hidden');
}
function closeAdvanceModal(){ $('advanceModal').classList.add('hidden'); }

function loadAdvanceHistory(wid){
  const el=$('advanceHistory'); if (!el) return;
  firebase.database().ref(`projects/${_lpid}/advances/${wid}`).once('value',snap=>{
    el.innerHTML='';
    let total=0;
    if (!snap.exists()){ el.innerHTML='<p class="empty-hint">No advances yet.</p>'; setText('advanceTotalLabel',peso(0)); return; }
    snap.forEach(c=>{
      const a=c.val();
      if (!a.deducted) total+=a.amount||0;
      el.innerHTML+=`<div class="advance-row">
        <span class="advance-date">${a.date}</span>
        <span class="advance-amt">${peso(a.amount)}</span>
        <span class="advance-status ${a.deducted?'adv-deducted':'adv-pending'}">${a.deducted?'Deducted':'Pending'}</span>
        <button class="del-advance" onclick="deleteAdvance('${wid}','${c.key}')">✕</button>
      </div>`;
    });
    setText('advanceTotalLabel', peso(total));
  });
}

async function saveAdvance(){
  if (!_lpid||!_advanceWorkerId) return;
  const date  = $('advanceDate')?.value;
  const amount= parseFloat($('advanceAmount')?.value)||0;
  const notes = $('advanceNotes')?.value.trim()||'';
  if (!date)     { alert('Enter date.'); return; }
  if (amount<=0) { alert('Enter amount.'); return; }
  await firebase.database().ref(`projects/${_lpid}/advances/${_advanceWorkerId}`).push({
    date, amount, notes, deducted:false, addedAt:Date.now()
  });
  $('advanceDate').value=''; $('advanceAmount').value=''; $('advanceNotes').value='';
  loadAdvanceHistory(_advanceWorkerId);
}

async function deleteAdvance(wid,key){
  if (!confirm('Remove this advance record?')) return;
  await firebase.database().ref(`projects/${_lpid}/advances/${wid}/${key}`).remove();
  loadAdvanceHistory(wid);
}

// ══════════════════════════════════════════════════════
//  TIMECARD GRID
// ══════════════════════════════════════════════════════
function rebuildGrid(pid,wSnap,tcSnap){
  if (tcSnap){ _renderGrid(pid,wSnap,tcSnap); }
  else { firebase.database().ref(`projects/${pid}/timecards`).once('value',tc=>_renderGrid(pid,wSnap,tc)); }
}

function _renderGrid(pid,wSnap,tcSnap){
  const container=$('timecardGrid'); if (!container) return;
  const days=getWeekDays();
  const tc={}; tcSnap?.forEach(c=>{ tc[c.key]=c.val(); });

  const byTrade={};
  wSnap.forEach(c=>{ const w={id:c.key,...c.val()}; if(!byTrade[w.trade])byTrade[w.trade]=[]; byTrade[w.trade].push(w); });

  if (!wSnap.exists()){ container.innerHTML='<p class="empty-hint" style="padding:20px">Add workers to the roster first.</p>'; updateAttendanceSummary({}); return; }

  const dayHdrs=days.map(d=>`<th class="g-day-hdr">${d.short}<br><span class="g-day-date">${d.num}</span></th>`).join('');
  let html='';
  const summaryData={};

  Object.entries(byTrade).forEach(([trade,workers])=>{
    let tradeGrand=0;
    const rows=workers.map(w=>{
      let sub=0; let daysPresent=0;
      const cells=days.map(d=>{
        const key=`${w.id}_${d.iso}`, on=tc[key]?.present||false;
        if(on){ sub+=w.dailyRate; daysPresent++; }
        return `<td class="g-cell"><input type="checkbox" class="g-check" ${on?'checked':''}
          onchange="markDay('${w.id}','${d.iso}',this.checked,${w.dailyRate},'${trade}')"></td>`;
      }).join('');
      tradeGrand+=sub;
      summaryData[w.id]={name:w.name,trade,rate:w.dailyRate,days:daysPresent,sub};
      return `<tr class="g-row">
        <td class="g-name">${w.name}</td>
        <td class="g-rate">${peso(w.dailyRate)}</td>
        ${cells}
        <td class="g-sub" id="ws_${w.id}">${peso(sub)}</td>
      </tr>`;
    }).join('');

    html+=`<div class="trade-block">
      <div class="trade-hdr">
        <span class="trade-hdr-name">${trade}</span>
        <span class="trade-hdr-total">${peso(tradeGrand)}</span>
      </div>
      <div class="grid-scroll"><table class="g-table">
        <thead><tr><th class="g-hdr-name">Worker</th><th class="g-hdr-rate">Rate/Day</th>${dayHdrs}<th class="g-hdr-sub">Subtotal</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  });
  container.innerHTML=html;
  updateAttendanceSummary(summaryData);
}

async function markDay(wid,iso,present,rate,trade){
  if (!_lpid) return;
  await firebase.database().ref(`projects/${_lpid}/timecards/${wid}_${iso}`)
    .set({workerId:wid,date:iso,present,dailyRate:rate,trade});
}

function getWeekDays(){
  const s=$('weekStart')?.value, e=$('weekEnd')?.value;
  const days=[];
  const start=s?new Date(s):(()=>{ const t=new Date(); t.setDate(t.getDate()-(( t.getDay()+6)%7)); return t; })();
  const end  =e?new Date(e):new Date(start.getTime()+6*86400000);
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const iso=d.toISOString().slice(0,10);
    days.push({iso,short:d.toLocaleDateString('en-PH',{weekday:'short'}),num:d.toLocaleDateString('en-PH',{month:'short',day:'numeric'})});
  }
  return days;
}
function applyWeek(){
  if (!_lpid) return;
  firebase.database().ref(`projects/${_lpid}/workers`).once('value',wSnap=>rebuildGrid(_lpid,wSnap));
}

// ══════════════════════════════════════════════════════
//  ATTENDANCE SUMMARY (visible below grid)
// ══════════════════════════════════════════════════════
function updateAttendanceSummary(summaryData){
  const el=$('attendanceSummary'); if (!el) return;
  const entries=Object.values(summaryData);
  if (!entries.length){ el.innerHTML='<p class="empty-hint">No attendance data yet.</p>'; return; }

  const grand=entries.reduce((s,w)=>s+w.sub,0);
  el.innerHTML=`<table class="summary-table">
    <thead><tr>
      <th>Worker</th><th>Trade</th><th>Rate/Day</th><th>Days</th><th class="s-right">Subtotal</th>
    </tr></thead>
    <tbody>
      ${entries.map(w=>`<tr class="s-row">
        <td class="s-cell">${w.name}</td>
        <td class="s-cell s-trade">${w.trade}</td>
        <td class="s-cell">${peso(w.rate)}</td>
        <td class="s-cell s-center">${w.days}</td>
        <td class="s-cell s-right s-bold">${peso(w.sub)}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr class="s-total-row">
      <td class="s-cell" colspan="4">GROSS PAYROLL</td>
      <td class="s-cell s-right s-bold">${peso(grand)}</td>
    </tr></tfoot>
  </table>`;
}

// ══════════════════════════════════════════════════════
//  COMPILE PAYROLL — with advance deduction modal
// ══════════════════════════════════════════════════════
let _pendingPayrollData=null;

async function compilePayroll(){
  if (!_lpid) return;
  const start=$('weekStart')?.value||'—', end=$('weekEnd')?.value||'—';

  const [wSnap,tcSnap,advSnap,projSnap]=await Promise.all([
    firebase.database().ref(`projects/${_lpid}/workers`).once('value'),
    firebase.database().ref(`projects/${_lpid}/timecards`).once('value'),
    firebase.database().ref(`projects/${_lpid}/advances`).once('value'),
    firebase.database().ref(`projects/${_lpid}`).once('value')
  ]);

  const workers={}; wSnap.forEach(c=>{workers[c.key]=c.val();});
  const byTrade={}; let grand=0;

  tcSnap.forEach(c=>{
    const tc=c.val(); if (!tc.present) return;
    const w=workers[tc.workerId]; if (!w) return;
    if (!byTrade[tc.trade]) byTrade[tc.trade]={workers:{},total:0};
    const bt=byTrade[tc.trade];
    if (!bt.workers[tc.workerId]) bt.workers[tc.workerId]={name:w.name,rate:w.dailyRate,days:0,subtotal:0};
    bt.workers[tc.workerId].days++;
    bt.workers[tc.workerId].subtotal+=w.dailyRate;
    bt.total+=w.dailyRate; grand+=w.dailyRate;
  });

  if (!grand){ alert('No attendance marked yet.'); return; }

  // Gather pending advances
  const pendingAdvances={}; let totalPending=0;
  advSnap?.forEach(workerAdv=>{
    const wid=workerAdv.key; const wname=workers[wid]?.name||wid;
    workerAdv.forEach(advEntry=>{
      const a=advEntry.val();
      if (!a.deducted){
        if (!pendingAdvances[wid]) pendingAdvances[wid]={name:wname,advances:[],total:0};
        pendingAdvances[wid].advances.push({key:advEntry.key,...a});
        pendingAdvances[wid].total+=a.amount||0;
        totalPending+=a.amount||0;
      }
    });
  });

  _pendingPayrollData={ start,end,grand,byTrade,pendingAdvances,totalPending,prevSpent:parseFloat(projSnap.val()?.laborSpent)||0 };
  showPayrollModal();
}

function showPayrollModal(){
  const d=_pendingPayrollData; if (!d) return;
  setText('payrollGross',    peso(d.grand));
  setText('payrollPeriod',   `${d.start} – ${d.end}`);
  setText('totalAdvances',   peso(d.totalPending));

  const advList=$('advanceDeductList');
  if (advList){
    if (!Object.keys(d.pendingAdvances).length){
      advList.innerHTML='<p class="empty-hint">No pending advances.</p>';
    } else {
      advList.innerHTML=Object.values(d.pendingAdvances).map(w=>
        `<div class="adv-deduct-row">
          <span class="adv-deduct-name">${w.name}</span>
          <span class="adv-deduct-detail">${w.advances.length} advance(s) totaling ${peso(w.total)}</span>
        </div>`
      ).join('');
    }
  }

  // Manual deduction input
  $('manualDeductInput').value='';
  const netEl=$('payrollNet');
  if (netEl) netEl.textContent=peso(d.grand);

  $('payrollModal').classList.remove('hidden');
}

function updatePayrollNet(){
  if (!_pendingPayrollData) return;
  const deduct=parseFloat($('manualDeductInput')?.value)||0;
  const net=_pendingPayrollData.grand - deduct;
  setText('payrollNet', peso(net));
}

function closePayrollModal(){ $('payrollModal').classList.add('hidden'); }

async function confirmSavePayroll(){
  const d=_pendingPayrollData; if (!d) return;
  const deduct=parseFloat($('manualDeductInput')?.value)||0;
  const net=d.grand-deduct;
  const weekLabel=`${d.start}–${d.end}`;

  // Save as a NEW log entry (never overwrites — each compile = new record)
  await firebase.database().ref(`projects/${_lpid}/payrollLogs`).push({
    period   : weekLabel,
    gross    : d.grand,
    deductions: deduct,
    net      : net,
    byTrade  : d.byTrade,
    savedAt  : Date.now(),
    savedDate: new Date().toLocaleDateString('en-PH')
  });

  // Mark deducted advances
  if (deduct>0){
    for (const [wid,wAdv] of Object.entries(d.pendingAdvances)){
      for (const adv of wAdv.advances){
        await firebase.database().ref(`projects/${_lpid}/advances/${wid}/${adv.key}`).update({deducted:true});
      }
    }
  }

  // Update project aggregate (accumulate)
  await firebase.database().ref(`projects/${_lpid}`).update({ laborSpent: d.prevSpent + net });

  closePayrollModal();
  alert(`✅ Payroll saved!\nGross: ${peso(d.grand)}\nDeductions: ${peso(deduct)}\nNet: ${peso(net)}`);
}

// ══════════════════════════════════════════════════════
//  RFP GENERATOR + PDF
// ══════════════════════════════════════════════════════
async function generateRFP(){
  if (!_lpid) return;
  const start=$('weekStart')?.value||'—', end=$('weekEnd')?.value||'—';
  const [wSnap,tcSnap]=await Promise.all([
    firebase.database().ref(`projects/${_lpid}/workers`).once('value'),
    firebase.database().ref(`projects/${_lpid}/timecards`).once('value')
  ]);
  const workers={}; wSnap.forEach(c=>{workers[c.key]=c.val();});
  const byTrade={}; let grand=0;
  tcSnap.forEach(c=>{
    const tc=c.val(); if (!tc.present) return;
    const w=workers[tc.workerId]; if (!w) return;
    if (!byTrade[tc.trade]) byTrade[tc.trade]=[];
    let e=byTrade[tc.trade].find(x=>x.name===w.name);
    if (!e){ e={name:w.name,rate:w.dailyRate,days:0,sub:0}; byTrade[tc.trade].push(e); }
    e.days++; e.sub+=w.dailyRate; grand+=w.dailyRate;
  });
  if (!grand){ alert('No attendance data to generate RFP.'); return; }
  const today=new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'});
  const lines=[`REQUEST FOR PAYMENT (RFP)`,`Project : ${_lpid}`,`Period  : ${start} to ${end}`,`Date    : ${today}`,'─'.repeat(52),''];
  Object.entries(byTrade).forEach(([trade,ws])=>{
    lines.push(trade.toUpperCase());
    ws.forEach(w=>{ lines.push(`  ${w.name.padEnd(24)} ${String(w.days).padStart(2)} day/s x ${peso(w.rate).padStart(10)} = ${peso(w.sub).padStart(12)}`); });
    lines.push(`  ${'Trade Subtotal'.padEnd(48)} ${peso(ws.reduce((s,w)=>s+w.sub,0)).padStart(12)}`,'');
  });
  lines.push('─'.repeat(52),`  ${'TOTAL LABOR PAYROLL'.padEnd(48)} ${peso(grand).padStart(12)}`,'','Prepared by: ___________________________','Approved by: ___________________________');
  window._rfpData={lines,start,end,grand,byTrade,pid:_lpid};
  $('rfpOutput').value=lines.join('\n');
  $('rfpModal').classList.remove('hidden');
}
function closeRFP(){ $('rfpModal').classList.add('hidden'); }
function copyRFP(){ const ta=$('rfpOutput'); ta.select(); document.execCommand('copy'); alert('Copied!'); }
function downloadRFP(){
  if (!window._rfpData) return;
  const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:'mm',format:'a4'});
  const lm=20,rm=190; let y=20;
  doc.setFontSize(14).setFont('helvetica','bold'); doc.text('REQUEST FOR PAYMENT',lm,y); y+=7;
  doc.setFontSize(9).setFont('helvetica','normal');
  doc.text(`Project : ${_rfpData.pid}`,lm,y);y+=5;
  doc.text(`Period  : ${_rfpData.start} to ${_rfpData.end}`,lm,y);y+=5;
  doc.text(`Date    : ${new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})}`,lm,y);y+=6;
  doc.setDrawColor(60,80,120).setLineWidth(0.4); doc.line(lm,y,rm,y); y+=6;
  Object.entries(_rfpData.byTrade).forEach(([trade,ws])=>{
    doc.setFontSize(9).setFont('helvetica','bold').setTextColor(40,80,180); doc.text(trade.toUpperCase(),lm,y); y+=5; doc.setTextColor(0);
    ws.forEach(w=>{ doc.setFont('helvetica','normal').setFontSize(8); doc.text(w.name,lm+3,y); doc.text(`${w.days} day/s × ${peso(w.rate)}`,lm+55,y); doc.text(peso(w.sub),rm,y,{align:'right'}); y+=5; });
    doc.setFont('helvetica','bold').setFontSize(8); doc.text('Trade Subtotal',lm+3,y); doc.text(peso(ws.reduce((s,w)=>s+w.sub,0)),rm,y,{align:'right'}); y+=7;
    if (y>260){ doc.addPage(); y=20; }
  });
  doc.setDrawColor(60,80,120).line(lm,y,rm,y); y+=6;
  doc.setFontSize(10).setFont('helvetica','bold'); doc.text('TOTAL LABOR PAYROLL',lm,y); doc.text(peso(_rfpData.grand),rm,y,{align:'right'}); y+=14;
  doc.setFontSize(8).setFont('helvetica','normal'); doc.text('Prepared by: ___________________________',lm,y); y+=7; doc.text('Approved by: ___________________________',lm,y);
  doc.save(`RFP_${_rfpData.pid}_${_rfpData.start}.pdf`);
}

// ══════════════════════════════════════════════════════
//  PAYROLL LOGS ARCHIVE
// ══════════════════════════════════════════════════════
function watchPayrollLogs(pid){
  listen(firebase.database().ref(`projects/${pid}/payrollLogs`), snap=>{
    const tbody=$('payrollLogsBody'); if (!tbody) return;
    tbody.innerHTML='';
    const tradeTotals={}; let grandTotal=0;

    if (!snap.exists()){
      tbody.innerHTML=`<tr><td colspan="5" class="empty-cell">No payroll logs yet.</td></tr>`;
      renderTradeTotals({},0); return;
    }

    const rows=[]; snap.forEach(c=>rows.unshift({id:c.key,...c.val()}));
    rows.forEach(e=>{
      grandTotal+=e.net||e.gross||0;
      if (e.byTrade) Object.entries(e.byTrade).forEach(([t,d])=>{ tradeTotals[t]=(tradeTotals[t]||0)+(d.total||0); });
      const breakdown=e.byTrade?Object.entries(e.byTrade).map(([t,d])=>`${t}: ${peso(d.total)}`).join(' · '):'—';
      tbody.innerHTML+=`<tr class="hist-row">
        <td class="h-cell">${e.savedDate||'—'}</td>
        <td class="h-cell">${e.period||'—'}</td>
        <td class="h-cell h-breakdown">${breakdown}</td>
        <td class="h-cell h-amount">${e.deductions>0?`<span class="deduct-badge">-${peso(e.deductions)}</span> `:''} ${peso(e.gross||0)}</td>
        <td class="h-cell h-amount net-col">${peso(e.net||e.gross||0)}</td>
      </tr>`;
    });
    tbody.innerHTML+=`<tr class="hist-total-row">
      <td class="h-cell" colspan="4">Total Labor Disbursed</td>
      <td class="h-cell h-amount">${peso(grandTotal)}</td>
    </tr>`;
    renderTradeTotals(tradeTotals,grandTotal);
  });
}

function renderTradeTotals(totals,grand){
  const el=$('tradeTotals'); if (!el) return;
  if (!Object.keys(totals).length){ el.innerHTML='<p class="empty-hint">No data yet.</p>'; return; }
  el.innerHTML=Object.entries(totals).sort((a,b)=>b[1]-a[1]).map(([t,v])=>{
    const p=grand?Math.round((v/grand)*100):0;
    return `<div class="tt-row"><span class="tt-trade">${t}</span>
      <div class="tt-bar-wrap"><div class="tt-bar" style="width:${p}%"></div></div>
      <span class="tt-pct">${p}%</span><span class="tt-val">${peso(v)}</span></div>`;
  }).join('');
}