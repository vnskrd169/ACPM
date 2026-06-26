let _slpid = null;
let _slListener = null;
let _logFilterDebounce = null;

function canTouchSiteLogProject() {
  return typeof requireEdit === 'function'
    ? requireEdit(_slpid)
    : !!_slpid && typeof canEditProject === 'function' && canEditProject(_slpid);
}

function initSiteLog(pid) {
  _slpid = pid;
  if (_slListener) { _slListener.off(); _slListener = null; }

  const dateInp = $('logDate');
  if (dateInp) dateInp.value = new Date().toISOString().slice(0, 10);

  watchSiteLog(pid);
}

function detachSiteLogListeners() {
  if (_slListener) { _slListener.off(); _slListener = null; }
}

function watchSiteLog(pid) {
  const ref = firebase.database().ref(`projects/${pid}/siteLogs`);
  _slListener = ref;

  ref.on('value', snap => {
    const el = $('siteLogList');
    if (!el) return;
    el.innerHTML = '';

    if (!snap.exists()) {
      el.innerHTML = '<p class="empty-hint">No logs yet. Add your first log above.</p>';
      renderSiteLogSummary([]);
      return;
    }

    const entries = [];
    snap.forEach(c => entries.push({ id: c.key, ...c.val() }));
    entries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    // Group by month, then by date
    const byMonth = {};
    entries.forEach(e => {
      const dateStr = e.date || 'Unknown';
      const monthKey = dateStr !== 'Unknown' ? dateStr.slice(0, 7) : 'Unknown';
      if (!byMonth[monthKey]) byMonth[monthKey] = {};
      if (!byMonth[monthKey][dateStr]) byMonth[monthKey][dateStr] = [];
      byMonth[monthKey][dateStr].push(e);
    });

    const sortedMonths = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));

    sortedMonths.forEach(monthKey => {
      const monthGroup = document.createElement('div');
      monthGroup.className = 'log-month-group';

      let monthLabel = monthKey;
      if (monthKey !== 'Unknown') {
        try {
          const [year, month] = monthKey.split('-');
          monthLabel = new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString('en-PH', { year: 'numeric', month: 'long' });
        } catch { monthLabel = monthKey; }
      }

      const monthCount = Object.values(byMonth[monthKey]).reduce((sum, day) => sum + day.length, 0);

      const monthHeader = document.createElement('div');
      monthHeader.className = 'log-month-header';
      monthHeader.innerHTML = `<span class="log-month-label"><span class="log-month-toggle">\u25BC</span> \u1F4C5 ${monthLabel}</span><span class="log-month-count">${monthCount} entr${monthCount !== 1 ? 'ies' : 'y'}</span>`;
      monthHeader.addEventListener('click', () => monthGroup.classList.toggle('collapsed'));
      monthGroup.appendChild(monthHeader);

      const monthBody = document.createElement('div');
      monthBody.className = 'log-month-body';

      const sortedDates = Object.keys(byMonth[monthKey]).sort((a, b) => b.localeCompare(a));

      sortedDates.forEach(date => {
        const dayGroup = document.createElement('div');
        dayGroup.className = 'log-day-group';

        const dayHeader = document.createElement('div');
        dayHeader.className = 'log-day-header';
        let dayLabel;
        try {
          dayLabel = new Date(date).toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        } catch { dayLabel = date; }
        dayHeader.innerHTML = `<span class="log-day-label">\u1F4C6 ${dayLabel}</span><span class="log-day-count">${byMonth[monthKey][date].length} entr${byMonth[monthKey][date].length !== 1 ? 'ies' : 'y'}</span>`;
        dayGroup.appendChild(dayHeader);

        byMonth[monthKey][date].forEach(e => {
          const locHTML = e.location
            ? `<a class="log-loc" href="https://maps.google.com/?q=${e.location}" target="_blank" rel="noopener">\u1F4CD Location</a>`
            : '';
          const timeHTML = e.time ? `<span class="log-time">\u23F0 ${e.time}</span>` : '';
          const weatherHTML = e.weather ? `<span class="log-weather">\u1F324\uFE0F ${escapeHtml(e.weather)}</span>` : '';

          const div = document.createElement('div');
          div.className = 'log-entry';
          div.setAttribute('data-id', e.id);
          div.innerHTML = `
            <div class="log-entry-hdr">
              <span class="log-date">${e.date || '\u2014'}</span>
              ${timeHTML}
              ${weatherHTML}
              ${locHTML}
              <span class="log-saved">${e.savedDate || ''}</span>
              <button class="del-log" aria-label="Delete log" data-lid="${e.id}">\u2715</button>
            </div>
            <p class="log-notes">${escapeHtml(e.notes || '').replace(/\n/g, '<br>')}</p>
            ${e.photos ? `<div class="log-photos">${e.photos.map(p => `<img src="${p}" class="log-photo" onclick="window.open('${p}','_blank')">`).join('')}</div>` : ''}`;

          div.querySelector('[data-lid]').addEventListener('click', () => deleteLog(e.id));
          dayGroup.appendChild(div);
        });

        monthBody.appendChild(dayGroup);
      });

      monthGroup.appendChild(monthBody);
      el.appendChild(monthGroup);
    });

    renderSiteLogSummary(entries);
  }, error => {
    console.error('Firebase error in watchSiteLog:', error);
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
        <span class="log-summary-item">\u1F4DD ${total} total log${total !== 1 ? 's' : ''}</span>
        <span class="log-summary-item">\u1F4CD ${withLocation} with location</span>
        <span class="log-summary-item">\u1F4C5 ${thisWeek} this week</span>
      </div>`;
  }
}

async function saveLog() {
  if (!_slpid) { showToast('No active project.', 'error'); return; }
  if (!canTouchSiteLogProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const dateInp = $('logDate');
  const notesInp = $('logNotes');
  const weatherInp = $('logWeather');
  const date = dateInp?.value;
  const notes = notesInp?.value.trim();
  const weather = weatherInp?.value.trim() || '';
  if (!date) { showToast('Select a date.', 'error'); return; }
  if (!notes) { showToast('Write something first.', 'error'); return; }
  if (notes.length > 2000) { showToast('Notes too long (max 2000 chars).', 'error'); return; }

  // Validate date not in future
  const inputDate = new Date(date + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  if (inputDate > today) { showToast('Log date cannot be in the future.', 'error'); return; }

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  const savedDate = now.toLocaleDateString('en-PH');

  const logData = {
    date, notes, weather,
    time: timeStr, savedAt: Date.now(), savedDate, savedBy: window._currentUser.uid
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
        auditLog('create', 'siteLog', null, { date, hasLocation: true, projectId: _slpid });
        showToast('Log saved with location \u1F4CD');
      },
      async () => {
        await doSave(logData);
        auditLog('create', 'siteLog', null, { date, hasLocation: false, projectId: _slpid });
        showToast('Log saved \u2713');
      },
      { timeout: 4000, enableHighAccuracy: true }
    );
  } else {
    await doSave(logData);
    showToast('Log saved \u2713');
  }
}

async function deleteLog(key) {
  if (!_slpid) return;
  if (!canTouchSiteLogProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Delete this log entry?\n\nThis cannot be undone.')) return;
  const confirmText = prompt('Type DELETE LOG to confirm permanent deletion:');
  if (confirmText !== 'DELETE LOG') {
    showToast('Deletion cancelled.', 'warn');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_slpid}/siteLogs/${key}`).remove(), 'Failed to delete log');
  auditLog('delete', 'siteLog', key, { projectId: _slpid });
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
    '\u2550'.repeat(63),
    '  SITE LOG EXPORT',
    `  Project: ${_slpid}`,
    `  Generated: ${new Date().toLocaleDateString('en-PH')}`,
    '\u2550'.repeat(63),
    ''
  ];

  entries.forEach(e => {
    lines.push(`\u1F4C5 ${e.date} ${e.time || ''}`);
    lines.push(`   ${e.notes}`);
    if (e.weather) lines.push(`   \u1F324\uFE0F ${e.weather}`);
    if (e.location) lines.push(`   \u1F4CD ${e.location}`);
    lines.push('');
  });

  downloadTextFile(`SiteLog_${_slpid}_${new Date().toISOString().slice(0,10)}.txt`, lines.join('\n'), 'text/plain');
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
      document.querySelectorAll('.log-entry, .log-day-group, .log-month-group').forEach(el => el.style.display = '');
    }
  }, 150);
}

// ── Expose to global scope ────────────────────────────────────
window.initSiteLog = initSiteLog;
window.detachSiteLogListeners = detachSiteLogListeners;
window.saveLog = saveLog;
window.deleteLog = deleteLog;
window.exportSiteLogs = exportSiteLogs;
window.filterLogs = filterLogs;
