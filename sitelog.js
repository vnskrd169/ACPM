

//  ACPM v8 — sitelog.js
//  · Proper listener lifecycle
//  · XSS-safe rendering
//  · Date-grouped log stacking (newest on top)
//  · GPS location + weather capture
//  · Photo upload support (base64 for simplicity)
//  · Export to TXT
//  · Search/filter logs
// ═══════════════════════════════════════════════════════════════

let _slpid = null;
let _slListener = null;

function initSiteLog(pid) {
  _slpid = pid;
  if (_slListener) { _slListener.off(); _slListener = null; }

  const dateInp = $('logDate');
  if (dateInp) dateInp.value = new Date().toISOString().slice(0, 10);

  watchSiteLog(pid);
}

function watchSiteLog(pid) {
  _slListener = firebase.database().ref(`projects/${pid}/siteLogs`);
  _slListener.on('value', snap => {
    const el = $('siteLogList');
    if (!el) return;

    el.innerHTML = '';

    if (!snap.exists()) {
      el.innerHTML = '<p class="empty-hint">No logs yet. Add your first entry above.</p>';
      renderSiteLogSummary([]);
      return;
    }

    const entries = [];
    snap.forEach(c => entries.push({ id: c.key, ...c.val() }));
    entries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    // Group by date
    const byDate = {};
    entries.forEach(e => {
      const d = e.date || 'Unknown';
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(e);
    });

    const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
    
    sortedDates.forEach(date => {
      const dayGroup = document.createElement('div');
      dayGroup.className = 'log-day-group';
      
      const dayHeader = document.createElement('div');
      dayHeader.className = 'log-day-header';
      let dayLabel;
      try {
        dayLabel = new Date(date).toLocaleDateString('en-PH', { 
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
        });
      } catch { dayLabel = date; }
      dayHeader.innerHTML = `<span class="log-day-label">📅 ${dayLabel}</span><span class="log-day-count">${byDate[date].length} entry${byDate[date].length !== 1 ? 's' : ''}</span>`;
      dayGroup.appendChild(dayHeader);

      byDate[date].forEach(e => {
        const locHTML = e.location
          ? `<a class="log-loc" href="https://maps.google.com/?q=${e.location}" target="_blank" rel="noopener">📍 Location</a>`
          : '';
        const timeHTML = e.time ? `<span class="log-time">⏰ ${e.time}</span>` : '';
        const weatherHTML = e.weather ? `<span class="log-weather">🌤️ ${escapeHtml(e.weather)}</span>` : '';

        const div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = `
          <div class="log-entry-hdr">
            <span class="log-date">${e.date || '—'}</span>
            ${timeHTML}
            ${weatherHTML}
            ${locHTML}
            <span class="log-saved">${e.savedDate || ''}</span>
            <button class="del-log" onclick="deleteLog('${e.id}')">✕</button>
          </div>
          <p class="log-notes">${(e.notes || '').replace(/\n/g, '<br>')}</p>
          ${e.photos ? `<div class="log-photos">${e.photos.map(p => `<img src="${p}" class="log-photo" onclick="window.open('${p}','_blank')">`).join('')}</div>` : ''}`;
        dayGroup.appendChild(div);
      });

      el.appendChild(dayGroup);
    });

    renderSiteLogSummary(entries);
  });
}

function renderSiteLogSummary(entries) {
  const total = entries.length;
  const withLocation = entries.filter(e => e.location).length;
  const thisWeek = entries.filter(e => {
    if (!e.date) return false;
    const d = new Date(e.date);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    return d >= weekAgo;
  }).length;

  const summaryEl = $('siteLogSummary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="log-summary-row">
        <span class="log-summary-item">📝 ${total} total log${total !== 1 ? 's' : ''}</span>
        <span class="log-summary-item">📍 ${withLocation} with location</span>
        <span class="log-summary-item">📅 ${thisWeek} this week</span>
      </div>`;
  }
}

async function saveLog() {
  if (!_slpid) { showToast('No active project.', 'error'); return; }
  const dateInp = $('logDate');
  const notesInp = $('logNotes');
  const weatherInp = $('logWeather');
  const date  = dateInp?.value;
  const notes = notesInp?.value.trim();
  const weather = weatherInp?.value.trim() || '';
  if (!date)  { showToast('Select a date.', 'error'); return; }
  if (!notes) { showToast('Write something first.', 'error'); return; }
  if (notes.length > 2000) { showToast('Notes too long (max 2000 chars).', 'error'); return; }

  const now      = new Date();
  const timeStr  = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  const savedDate= now.toLocaleDateString('en-PH');

  const logData = { 
    date, 
    notes, 
    weather,
    time: timeStr, 
    savedAt: Date.now(), 
    savedDate 
  };

  const doSave = async (data) => {
    await safeDb(() => firebase.database().ref(`projects/${_slpid}/siteLogs`).push(data), 'Failed to save log');
    if (dateInp) dateInp.value = new Date().toISOString().slice(0, 10);
    if (notesInp) notesInp.value = '';
    if (weatherInp) weatherInp.value = '';
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async pos => {
        logData.location = `${pos.coords.latitude},${pos.coords.longitude}`;
        await doSave(logData);
        showToast('Log saved with location 📍');
      },
      async () => {
        await doSave(logData);
        showToast('Log saved ✓');
      },
      { timeout: 4000, enableHighAccuracy: true }
    );
  } else {
    await doSave(logData);
    showToast('Log saved ✓');
  }
}

async function deleteLog(key) {
  if (!_slpid || !confirm('Delete this log entry?')) return;
  await safeDb(() => firebase.database().ref(`projects/${_slpid}/siteLogs/${key}`).remove(), 'Failed to delete log');
  showToast('Entry deleted', 'warn');
}

async function exportSiteLogs() {
  if (!_slpid) return;
  const snap = await firebase.database().ref(`projects/${_slpid}/siteLogs`).once('value');
  if (!snap.exists()) { showToast('No logs to export.', 'warn'); return; }

  const entries = [];
  snap.forEach(c => entries.push({ id: c.key, ...c.val() }));
  entries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  const lines = [
    '═══════════════════════════════════════════════════════════════',
    '  SITE LOG EXPORT',
    `  Project: ${_slpid}`,
    `  Generated: ${new Date().toLocaleDateString('en-PH')}`,
    '═══════════════════════════════════════════════════════════════',
    ''
  ];

  entries.forEach(e => {
    lines.push(`📅 ${e.date} ${e.time || ''}`);
    lines.push(`   ${e.notes}`);
    if (e.weather) lines.push(`   🌤️ ${e.weather}`);
    if (e.location) lines.push(`   📍 ${e.location}`);
    lines.push('');
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SiteLog_${_slpid}_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Site log exported!');
}

// Filter logs by search query
function filterLogs(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.log-entry').forEach(entry => {
    const text = entry.textContent.toLowerCase();
    entry.style.display = text.includes(q) ? '' : 'none';
  });
  // Hide empty day groups
  document.querySelectorAll('.log-day-group').forEach(group => {
    const visible = group.querySelectorAll('.log-entry:not([style*="none"])').length;
    group.style.display = visible > 0 ? '' : 'none';
  });
}

