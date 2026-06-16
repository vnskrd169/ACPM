// ═══════════════════════════════════════════════════════════════
//  ACPM v6 — sitelog.js
//  FIXES:
//  · Logs now pile up correctly (listener was being re-registered)
//  · Auto date fills current date on init
//  · Auto time captured on save
//  · Location (GPS) captured on save if permitted
// ═══════════════════════════════════════════════════════════════

let _slpid = null;

function initSiteLog(pid) {
  _slpid = pid;

  // Auto-fill today's date
  const dateInp = $('logDate');
  if (dateInp && !dateInp.value) {
    dateInp.value = new Date().toISOString().slice(0, 10);
  }

  watchSiteLog(pid);
}

function watchSiteLog(pid) {
  listen(firebase.database().ref(`projects/${pid}/siteLogs`), snap => {
    const el = $('siteLogList'); if (!el) return;
    el.innerHTML = '';

    if (!snap.exists()) {
      el.innerHTML = '<p class="empty-hint">No entries yet. Add your first log above.</p>';
      return;
    }

    // Newest first
    const entries = [];
    snap.forEach(c => entries.unshift({ id: c.key, ...c.val() }));

    entries.forEach(e => {
      const locBadge = e.location
        ? `<a class="log-loc" href="https://maps.google.com/?q=${e.location}" target="_blank">📍 View Location</a>`
        : '';
      el.innerHTML += `
        <div class="log-entry">
          <div class="log-entry-hdr">
            <span class="log-date">${e.date}</span>
            ${e.time ? `<span class="log-time">⏰ ${e.time}</span>` : ''}
            ${locBadge}
            <span class="log-saved" style="flex:1">Saved ${e.savedDate||''}</span>
            <button class="del-log" onclick="deleteLog('${e.id}')">✕</button>
          </div>
          <p class="log-notes">${(e.notes||'').replace(/\n/g,'<br>')}</p>
        </div>`;
    });
  });
}

async function saveLog() {
  if (!_slpid) return;
  const date  = $('logDate')?.value;
  const notes = $('logNotes')?.value.trim();
  if (!date)  { showToast('Select a date.','error'); return; }
  if (!notes) { showToast('Write something first.','error'); return; }

  const now      = new Date();
  const timeStr  = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  const savedDate= now.toLocaleDateString('en-PH');

  const logData = {
    date, notes, time: timeStr, savedAt: Date.now(), savedDate
  };

  // Try to get GPS location
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async pos => {
        logData.location = `${pos.coords.latitude},${pos.coords.longitude}`;
        await firebase.database().ref(`projects/${_slpid}/siteLogs`).push(logData);
        showToast('Log saved with location 📍');
      },
      async () => {
        // Location denied — save without it
        await firebase.database().ref(`projects/${_slpid}/siteLogs`).push(logData);
        showToast('Log saved (no location)');
      },
      { timeout: 5000 }
    );
  } else {
    await firebase.database().ref(`projects/${_slpid}/siteLogs`).push(logData);
    showToast('Log saved');
  }

  $('logDate').value  = new Date().toISOString().slice(0, 10); // reset to today
  $('logNotes').value = '';
}

async function deleteLog(key) {
  if (!_slpid || !confirm('Delete this log entry?')) return;
  await firebase.database().ref(`projects/${_slpid}/siteLogs/${key}`).remove();
  showToast('Log entry deleted','warn');
}