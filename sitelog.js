let _slpid = null;
let _slListener = null;
let _logFilterDebounce = null;

function initSiteLog(pid) {
  console.log('🔧 initSiteLog called for pid:', pid);
  _slpid = pid;
  if (_slListener) { 
    console.log('📡 Detaching old listener');
    _slListener.off(); 
    _slListener = null; 
  }

  const dateInp = $('logDate');
  if (dateInp) dateInp.value = new Date().toISOString().slice(0, 10);

  watchSiteLog(pid);
}

function detachSiteLogListeners() {
  console.log('📡 Detaching site log listener');
  if (_slListener) { _slListener.off(); _slListener = null; }
}

function watchSiteLog(pid) {
  console.log('👁️ watchSiteLog starting for pid:', pid);
  const ref = firebase.database().ref(`projects/${pid}/siteLogs`);
  _slListener = ref;

  ref.on('value', snap => {
    console.log('📨 SiteLog data received:', snap.exists() ? 'EXISTS' : 'EMPTY', 'Key count:', snap.numChildren());

    const el = $('siteLogList');
    if (!el) {
      console.error('❌ siteLogList element not found!');
      return;
    }

    el.innerHTML = '';

    if (!snap.exists()) {
      console.log('ℹ️ No site logs found');
      el.innerHTML = '<p class="empty-hint">No logs yet. Add your first entry above.</p>';
      renderSiteLogSummary([]);
      return;
    }

    const entries = [];
    snap.forEach(c => {
      const val = c.val();
      console.log('📄 Entry:', c.key, 'Date:', val.date, 'Notes:', val.notes?.substring(0, 20));
      entries.push({ id: c.key, ...val });
    });

    console.log('📊 Total entries:', entries.length);

    // Sort by savedAt descending (newest first)
    entries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    // Group by MONTH first, then by date
    const byMonth = {};
    entries.forEach(e => {
      const dateStr = e.date || 'Unknown';
      const monthKey = dateStr !== 'Unknown' ? dateStr.slice(0, 7) : 'Unknown';
      if (!byMonth[monthKey]) byMonth[monthKey] = {};
      if (!byMonth[monthKey][dateStr]) byMonth[monthKey][dateStr] = [];
      byMonth[monthKey][dateStr].push(e);
    });

    console.log('📅 Month groups:', Object.keys(byMonth));

    // Sort months descending
    const sortedMonths = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));

    sortedMonths.forEach(monthKey => {
      const monthGroup = document.createElement('div');
      monthGroup.className = 'log-month-group';

      // Month header
      let monthLabel = monthKey;
      if (monthKey !== 'Unknown') {
        try {
          const [year, month] = monthKey.split('-');
          monthLabel = new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString('en-PH', { 
            year: 'numeric', month: 'long' 
          });
        } catch { monthLabel = monthKey; }
      }

      const monthCount = Object.values(byMonth[monthKey]).reduce((sum, day) => sum + day.length, 0);

      const monthHeader = document.createElement('div');
      monthHeader.className = 'log-month-header';
      monthHeader.innerHTML = `<span class="log-month-label">📅 ${monthLabel}</span><span class="log-month-count">${monthCount} entr${monthCount !== 1 ? 'ies' : 'y'}</span>`;
      monthGroup.appendChild(monthHeader);

      // Sort dates within month descending
      const sortedDates = Object.keys(byMonth[monthKey]).sort((a, b) => b.localeCompare(a));

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
        dayHeader.innerHTML = `<span class="log-day-label">📆 ${dayLabel}</span><span class="log-day-count">${byMonth[monthKey][date].length} entr${byMonth[monthKey][date].length !== 1 ? 'ies' : 'y'}</span>`;
        dayGroup.appendChild(dayHeader);

        byMonth[monthKey][date].forEach(e => {
          const locHTML = e.location
            ? `<a class="log-loc" href="https://maps.google.com/?q=${e.location}" target="_blank" rel="noopener">📍 Location</a>`
            : '';
          const timeHTML = e.time ? `<span class="log-time">⏰ ${e.time}</span>` : '';
          const weatherHTML = e.weather ? `<span class="log-weather">🌤️ ${escapeHtml(e.weather)}</span>` : '';

          const div = document.createElement('div');
          div.className = 'log-entry';
          div.setAttribute('data-id', e.id);
          div.innerHTML = `
            <div class="log-entry-hdr">
              <span class="log-date">${e.date || '—'}</span>
              ${timeHTML}
              ${weatherHTML}
              ${locHTML}
              <span class="log-saved">${e.savedDate || ''}</span>
              <button class="del-log" aria-label="Delete log" onclick="deleteLog('${e.id}')">✕</button>
            </div>
            <p class="log-notes">${escapeHtml(e.notes || '').replace(/\n/g, '<br>')}</p>
            ${e.photos ? `<div class="log-photos">${e.photos.map(p => `<img src="${p}" class="log-photo" onclick="window.open('${p}','_blank')">`).join('')}</div>` : ''}`;
          dayGroup.appendChild(div);
        });

        monthGroup.appendChild(dayGroup);
      });

      el.appendChild(monthGroup);
    });

    renderSiteLogSummary(entries);
    console.log('✅ SiteLog rendering complete');
    
    // Ensure scroll works
    setTimeout(ensureScrollable, 100);
  }, error => {
    console.error('❌ Firebase error in watchSiteLog:', error);
    showToast('Error loading site logs: ' + error.message, 'error');
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

function filterLogs(query) {
  if (_logFilterDebounce) clearTimeout(_logFilterDebounce);
  _logFilterDebounce = setTimeout(() => {
    const q = query.toLowerCase().trim();

    document.querySelectorAll('.log-entry').forEach(entry => {
      const text = entry.textContent.toLowerCase();
      entry.style.display = text.includes(q) ? '' : 'none';
    });

    document.querySelectorAll('.log-day-group').forEach(group => {
      const visible = group.querySelectorAll('.log-entry:not([style*="none"])').length;
      group.style.display = visible > 0 ? '' : 'none';
    });

    document.querySelectorAll('.log-month-group').forEach(group => {
      const visible = group.querySelectorAll('.log-day-group:not([style*="none"])').length;
      group.style.display = visible > 0 ? '' : 'none';
    });

    if (!q) {
      document.querySelectorAll('.log-entry, .log-day-group, .log-month-group').forEach(el => {
        el.style.display = '';
      });
    }
  }, 150);
}


// ════════════════════════════════════════════════════════
// SCROLL FIX — Ensure siteLogList is scrollable
// ════════════════════════════════════════════════════════

function ensureScrollable() {
  const el = $('siteLogList');
  if (!el) return;

  // Force scroll styles via JS
  el.style.maxHeight = '60vh';
  el.style.overflowY = 'auto';
  el.style.overflowX = 'hidden';
  el.style.display = 'flex';
  el.style.flexDirection = 'column';

  // Check if content is taller than container
  const isOverflowing = el.scrollHeight > el.clientHeight;
  console.log('📏 Scroll check:', el.scrollHeight, '>', el.clientHeight, '=', isOverflowing);

  if (!isOverflowing) {
    // If not overflowing, try to find the parent and make it scrollable
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (parent.classList.contains('card') || parent.classList.contains('panel')) {
        parent.style.maxHeight = '80vh';
        parent.style.overflowY = 'auto';
        console.log('📏 Made parent scrollable:', parent.className);
        break;
      }
      parent = parent.parentElement;
    }
  }
}

// Call after rendering
setTimeout(ensureScrollable, 100);