// ═══════════════════════════════════════════════════════════════
//  ACPM v3 — labor.js  |  Dynamic Trades · Timecard · RFP PDF
// ═══════════════════════════════════════════════════════════════

let _laborPid = null;

// ── Boot ──────────────────────────────────────────────────────────
function initLabor(pid) {
  _laborPid = pid;
  watchBudget(pid);
  watchTrades(pid);
  watchHistory(pid);
}

// ── Budget KPIs ───────────────────────────────────────────────────
function watchBudget(pid) {
  listen(firebase.database().ref(`projects/${pid}`), snap => {
    const d = snap.val() || {};
    const budget = parseFloat(d.laborBudget) || 0;
    const spent  = parseFloat(d.laborSpent)  || 0;
    const left   = budget - spent;
    setText('lbBudget', peso(budget));
    setText('lbSpent',  peso(spent));
    const el = $('lbLeft');
    if (el) { el.textContent = peso(left); el.className = `kpi-num ${left < 0 ? 'kpi-danger' : 'kpi-safe'}`; }
  });
}

// ══════════════════════════════════════════════════════
//  TRADES — dynamic add / rename / delete
// ══════════════════════════════════════════════════════
function watchTrades(pid) {
  listen(firebase.database().ref(`projects/${pid}/trades`), snap => {
    renderTradeManager(snap, pid);
    watchWorkers(pid, snap);  // re-render workers when trades change
  });
}

function renderTradeManager(snap, pid) {
  const list = $('tradeList');
  if (!list) return;
  list.innerHTML = '';
  if (!snap.exists()) {
    list.innerHTML = '<p class="empty-hint">No trades yet. Add one →</p>';
    return;
  }
  snap.forEach(c => {
    const t = c.val();
    list.innerHTML += `
      <div class="trade-chip">
        <span class="trade-chip-name">${t.name}</span>
        <button class="chip-edit" onclick="renameTrade('${c.key}','${t.name}')">✎</button>
        <button class="chip-del"  onclick="deleteTrade('${c.key}','${t.name}')">✕</button>
      </div>`;
  });
}

async function addTrade() {
  const inp = $('newTradeName');
  const name = inp?.value.trim();
  if (!name || !_laborPid) return;
  await firebase.database().ref(`projects/${_laborPid}/trades`).push({ name });
  inp.value = '';
}

async function renameTrade(key, oldName) {
  const newName = prompt(`Rename "${oldName}" to:`, oldName);
  if (!newName || !newName.trim() || newName === oldName || !_laborPid) return;
  await firebase.database().ref(`projects/${_laborPid}/trades/${key}`).update({ name: newName.trim() });
}

async function deleteTrade(key, name) {
  if (!_laborPid) return;
  if (!confirm(`Delete trade "${name}"? Workers under this trade will lose their trade label.`)) return;
  await firebase.database().ref(`projects/${_laborPid}/trades/${key}`).remove();
}

// ══════════════════════════════════════════════════════
//  WORKERS — roster
// ══════════════════════════════════════════════════════
function watchWorkers(pid, tradesSnap) {
  listen(firebase.database().ref(`projects/${pid}/workers`), wSnap => {
    renderRoster(wSnap);
    populateTradeSelect(tradesSnap);
    rebuildGrid(pid, wSnap);
  });
  // also rebuild grid when timecards change
  listen(firebase.database().ref(`projects/${pid}/timecards`), tcSnap => {
    firebase.database().ref(`projects/${pid}/workers`).once('value', wSnap => {
      rebuildGrid(pid, wSnap, tcSnap);
    });
  });
}

function populateTradeSelect(tradesSnap) {
  const sel = $('workerTradeSelect');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Select Trade —</option>';
  if (tradesSnap && tradesSnap.exists()) {
    tradesSnap.forEach(c => {
      sel.innerHTML += `<option value="${c.val().name}">${c.val().name}</option>`;
    });
  }
  sel.value = prev;
}

function renderRoster(wSnap) {
  const list = $('rosterList');
  if (!list) return;
  list.innerHTML = '';
  if (!wSnap.exists()) {
    list.innerHTML = '<p class="empty-hint">No workers yet.</p>';
    return;
  }
  wSnap.forEach(c => {
    const w = c.val();
    list.innerHTML += `
      <div class="roster-row">
        <div class="roster-info">
          <span class="roster-name">${w.name}</span>
          <span class="roster-trade-tag">${w.trade || 'No Trade'}</span>
        </div>
        <span class="roster-rate">${peso(w.dailyRate)}/day</span>
        <button class="del-worker" onclick="removeWorker('${c.key}')">✕</button>
      </div>`;
  });
}

async function addWorker() {
  if (!_laborPid) return;
  const name  = $('workerName')?.value.trim();
  const trade = $('workerTradeSelect')?.value;
  const rate  = parseFloat($('workerRate')?.value) || 0;
  if (!name)       { alert('Enter worker name.'); return; }
  if (!trade)      { alert('Select a trade first.'); return; }
  if (rate <= 0)   { alert('Enter daily rate.'); return; }
  await firebase.database().ref(`projects/${_laborPid}/workers`).push({ name, trade, dailyRate: rate, addedAt: Date.now() });
  $('workerName').value = '';
  $('workerRate').value = '';
}

async function removeWorker(wid) {
  if (!_laborPid || !confirm('Remove this worker?')) return;
  await firebase.database().ref(`projects/${_laborPid}/workers/${wid}`).remove();
}

// ══════════════════════════════════════════════════════
//  TIMECARD GRID
// ══════════════════════════════════════════════════════
function rebuildGrid(pid, wSnap, tcSnap) {
  if (tcSnap) {
    _renderGrid(pid, wSnap, tcSnap);
  } else {
    firebase.database().ref(`projects/${pid}/timecards`).once('value', tc => _renderGrid(pid, wSnap, tc));
  }
}

function _renderGrid(pid, wSnap, tcSnap) {
  const container = $('timecardGrid');
  if (!container) return;

  const days = getWeekDays();
  const tc   = {};
  tcSnap?.forEach(c => { tc[c.key] = c.val(); });

  // Group by trade
  const byTrade = {};
  wSnap.forEach(c => {
    const w = { id: c.key, ...c.val() };
    if (!byTrade[w.trade]) byTrade[w.trade] = [];
    byTrade[w.trade].push(w);
  });

  if (!wSnap.exists()) {
    container.innerHTML = '<p class="empty-hint" style="padding:24px">Add workers to the roster first.</p>';
    return;
  }

  const dayHdrs = days.map(d => `<th class="g-day-hdr">${d.short}<br><span class="g-day-date">${d.num}</span></th>`).join('');

  let html = '';
  Object.entries(byTrade).forEach(([trade, workers]) => {
    let tradeGrand = 0;
    const rowsHtml = workers.map(w => {
      let sub = 0;
      const cells = days.map(d => {
        const key = `${w.id}_${d.iso}`;
        const on  = tc[key]?.present || false;
        if (on) sub += w.dailyRate;
        return `<td class="g-cell"><input type="checkbox" class="g-check" ${on ? 'checked' : ''}
          onchange="markDay('${w.id}','${d.iso}',this.checked,${w.dailyRate},'${trade}')"></td>`;
      }).join('');
      tradeGrand += sub;
      return `<tr class="g-row">
        <td class="g-name">${w.name}</td>
        <td class="g-rate">${peso(w.dailyRate)}</td>
        ${cells}
        <td class="g-sub" id="ws_${w.id}">${peso(sub)}</td>
      </tr>`;
    }).join('');

    html += `<div class="trade-block">
      <div class="trade-hdr">
        <span class="trade-hdr-name">${trade}</span>
        <span class="trade-hdr-total">${peso(tradeGrand)}</span>
      </div>
      <div class="grid-scroll">
        <table class="g-table">
          <thead><tr>
            <th class="g-hdr-name">Worker</th>
            <th class="g-hdr-rate">Rate/Day</th>
            ${dayHdrs}
            <th class="g-hdr-sub">Subtotal</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

async function markDay(wid, iso, present, rate, trade) {
  if (!_laborPid) return;
  await firebase.database()
    .ref(`projects/${_laborPid}/timecards/${wid}_${iso}`)
    .set({ workerId: wid, date: iso, present, dailyRate: rate, trade });
}

function getWeekDays() {
  const s = $('weekStart')?.value;
  const e = $('weekEnd')?.value;
  const days = [];
  const start = s ? new Date(s) : (() => {
    const t = new Date();
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    return t;
  })();
  const end = e ? new Date(e) : new Date(start.getTime() + 6 * 86400000);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    days.push({
      iso,
      short: d.toLocaleDateString('en-PH', { weekday: 'short' }),
      num:   d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
    });
  }
  return days;
}

function applyWeek() {
  if (!_laborPid) return;
  firebase.database().ref(`projects/${_laborPid}/workers`).once('value', wSnap => rebuildGrid(_laborPid, wSnap));
}

// ══════════════════════════════════════════════════════
//  COMPILE & SAVE PAYROLL
// ══════════════════════════════════════════════════════
async function compilePayroll() {
  if (!_laborPid) return;
  const start = $('weekStart')?.value || '—';
  const end   = $('weekEnd')?.value   || '—';

  const [wSnap, tcSnap, projSnap] = await Promise.all([
    firebase.database().ref(`projects/${_laborPid}/workers`).once('value'),
    firebase.database().ref(`projects/${_laborPid}/timecards`).once('value'),
    firebase.database().ref(`projects/${_laborPid}`).once('value')
  ]);

  const workers = {};
  wSnap.forEach(c => { workers[c.key] = c.val(); });

  const byTrade = {};
  let grand = 0;

  tcSnap.forEach(c => {
    const tc = c.val();
    if (!tc.present) return;
    const w = workers[tc.workerId];
    if (!w) return;
    if (!byTrade[tc.trade]) byTrade[tc.trade] = { workers: {}, total: 0 };
    const bt = byTrade[tc.trade];
    if (!bt.workers[tc.workerId]) bt.workers[tc.workerId] = { name: w.name, rate: w.dailyRate, days: 0, subtotal: 0 };
    bt.workers[tc.workerId].days++;
    bt.workers[tc.workerId].subtotal += w.dailyRate;
    bt.total += w.dailyRate;
    grand    += w.dailyRate;
  });

  if (!grand) { alert('No attendance marked yet.'); return; }
  if (!confirm(`Save payroll of ${peso(grand)} for ${start} → ${end}?`)) return;

  await firebase.database().ref(`projects/${_laborPid}/payrollHistory`).push({
    period: `${start} – ${end}`, total: grand, byTrade,
    savedAt: Date.now(), savedDate: new Date().toLocaleDateString('en-PH')
  });

  const prev = parseFloat(projSnap.val()?.laborSpent) || 0;
  await firebase.database().ref(`projects/${_laborPid}`).update({ laborSpent: prev + grand });
  alert(`✅ Payroll saved! Total: ${peso(grand)}`);
}

// ══════════════════════════════════════════════════════
//  GENERATE RFP
// ══════════════════════════════════════════════════════
async function generateRFP() {
  if (!_laborPid) return;
  const start = $('weekStart')?.value || '—';
  const end   = $('weekEnd')?.value   || '—';

  const [wSnap, tcSnap] = await Promise.all([
    firebase.database().ref(`projects/${_laborPid}/workers`).once('value'),
    firebase.database().ref(`projects/${_laborPid}/timecards`).once('value')
  ]);

  const workers = {};
  wSnap.forEach(c => { workers[c.key] = c.val(); });

  const byTrade = {};
  let grand = 0;

  tcSnap.forEach(c => {
    const tc = c.val();
    if (!tc.present) return;
    const w = workers[tc.workerId];
    if (!w) return;
    if (!byTrade[tc.trade]) byTrade[tc.trade] = [];
    let e = byTrade[tc.trade].find(x => x.name === w.name);
    if (!e) { e = { name: w.name, rate: w.dailyRate, days: 0, sub: 0 }; byTrade[tc.trade].push(e); }
    e.days++; e.sub += w.dailyRate; grand += w.dailyRate;
  });

  if (!grand) { alert('No attendance data to generate RFP.'); return; }

  const today = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  const lines = [
    `REQUEST FOR PAYMENT (RFP)`,
    `Project : ${_laborPid}`,
    `Period  : ${start} to ${end}`,
    `Date    : ${today}`,
    `${'─'.repeat(52)}`,
    ``
  ];

  Object.entries(byTrade).forEach(([trade, ws]) => {
    lines.push(trade.toUpperCase());
    ws.forEach(w => {
      const col1 = w.name.padEnd(24);
      const col2 = `${w.days} day/s x ${peso(w.rate)}`.padEnd(22);
      lines.push(`  ${col1} ${col2} ${peso(w.sub).padStart(12)}`);
    });
    const tTotal = ws.reduce((s, w) => s + w.sub, 0);
    lines.push(`  ${'Trade Subtotal'.padEnd(48)} ${peso(tTotal).padStart(12)}`);
    lines.push('');
  });

  lines.push(`${'─'.repeat(52)}`);
  lines.push(`  ${'TOTAL LABOR PAYROLL'.padEnd(48)} ${peso(grand).padStart(12)}`);
  lines.push(``);
  lines.push(`Prepared by: ___________________________`);
  lines.push(`Approved by: ___________________________`);

  // store for PDF download
  window._rfpData = { lines, start, end, grand, byTrade, pid: _laborPid };

  $('rfpOutput').value = lines.join('\n');
  $('rfpModal').classList.remove('hidden');
}

function closeRFP() { $('rfpModal').classList.add('hidden'); }

function copyRFP() {
  const ta = $('rfpOutput');
  ta.select();
  document.execCommand('copy');
  alert('Copied to clipboard!');
}

function downloadRFP() {
  if (!window._rfpData) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const lm = 20, rm = 190, tw = rm - lm;
  let y = 20;

  // Header block
  doc.setFontSize(14).setFont('helvetica', 'bold');
  doc.text('REQUEST FOR PAYMENT', lm, y); y += 7;
  doc.setFontSize(9).setFont('helvetica', 'normal');
  doc.text(`Project : ${_rfpData.pid}`, lm, y); y += 5;
  doc.text(`Period  : ${_rfpData.start} to ${_rfpData.end}`, lm, y); y += 5;
  doc.text(`Date    : ${new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}`, lm, y); y += 6;

  doc.setDrawColor(60, 80, 120).setLineWidth(0.4);
  doc.line(lm, y, rm, y); y += 6;

  // Per-trade tables
  Object.entries(_rfpData.byTrade).forEach(([trade, ws]) => {
    doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(40, 80, 180);
    doc.text(trade.toUpperCase(), lm, y); y += 5;
    doc.setTextColor(0);

    ws.forEach(w => {
      doc.setFont('helvetica', 'normal').setFontSize(8);
      doc.text(w.name, lm + 3, y);
      doc.text(`${w.days} day/s × ${peso(w.rate)}`, lm + 55, y);
      doc.text(peso(w.sub), rm, y, { align: 'right' });
      y += 5;
    });

    const tTotal = ws.reduce((s, w) => s + w.sub, 0);
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('Trade Subtotal', lm + 3, y);
    doc.text(peso(tTotal), rm, y, { align: 'right' });
    y += 7;

    if (y > 260) { doc.addPage(); y = 20; }
  });

  doc.setDrawColor(60, 80, 120).line(lm, y, rm, y); y += 6;
  doc.setFontSize(10).setFont('helvetica', 'bold');
  doc.text('TOTAL LABOR PAYROLL', lm, y);
  doc.text(peso(_rfpData.grand), rm, y, { align: 'right' }); y += 14;

  doc.setFontSize(8).setFont('helvetica', 'normal');
  doc.text('Prepared by: ___________________________', lm, y); y += 7;
  doc.text('Approved by: ___________________________', lm, y);

  doc.save(`RFP_${_rfpData.pid}_${_rfpData.start}.pdf`);
}

// ══════════════════════════════════════════════════════
//  PAYROLL HISTORY
// ══════════════════════════════════════════════════════
function watchHistory(pid) {
  listen(firebase.database().ref(`projects/${pid}/payrollHistory`), snap => {
    const tbody = $('historyBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const tradeTotals = {};
    let grand = 0;

    if (!snap.exists()) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No payroll records yet.</td></tr>`;
      renderTradeTotals({}, 0);
      return;
    }

    const rows = [];
    snap.forEach(c => rows.unshift({ ...c.val() }));

    rows.forEach(e => {
      grand += e.total || 0;
      if (e.byTrade) {
        Object.entries(e.byTrade).forEach(([t, d]) => {
          tradeTotals[t] = (tradeTotals[t] || 0) + (d.total || 0);
        });
      }
      const breakdown = e.byTrade
        ? Object.entries(e.byTrade).map(([t, d]) => `${t}: ${peso(d.total)}`).join(' · ')
        : '—';
      tbody.innerHTML += `
        <tr class="hist-row">
          <td class="h-cell">${e.savedDate || '—'}</td>
          <td class="h-cell">${e.period   || '—'}</td>
          <td class="h-cell h-breakdown">${breakdown}</td>
          <td class="h-cell h-amount">${peso(e.total)}</td>
        </tr>`;
    });

    tbody.innerHTML += `
      <tr class="hist-total-row">
        <td class="h-cell" colspan="3">Total Labor Disbursed</td>
        <td class="h-cell h-amount">${peso(grand)}</td>
      </tr>`;

    renderTradeTotals(tradeTotals, grand);
  });
}

function renderTradeTotals(totals, grand) {
  const el = $('tradeTotals');
  if (!el) return;
  if (!Object.keys(totals).length) {
    el.innerHTML = '<p class="empty-hint">No data yet.</p>';
    return;
  }
  el.innerHTML = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([t, v]) => {
      const p = grand ? Math.round((v / grand) * 100) : 0;
      return `<div class="tt-row">
        <span class="tt-trade">${t}</span>
        <div class="tt-bar-wrap"><div class="tt-bar" style="width:${p}%"></div></div>
        <span class="tt-pct">${p}%</span>
        <span class="tt-val">${peso(v)}</span>
      </div>`;
    }).join('');
}

// ── Util ──────────────────────────────────────────────────────────
function setText(id, v) { const e = $(id); if (e) e.textContent = v; }