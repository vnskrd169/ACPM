// ═══════════════════════════════════════════════════════════════
//  ACPM v6 — sitelog.js  (FIXED)
//  · Logs now pile up correctly — listener is registered once
//  · Auto-fills today's date on init
//  · Captures time + GPS location on every save
//  · Delete works correctly
// ═══════════════════════════════════════════════════════════════

let _slpid = null;
let _slListenerRegistered = false;

function initSiteLog(pid) {
  _slpid = pid;
  _slListenerRegistered = false;

  // Auto-fill today's date
  const dateInp = document.getElementById('logDate');
  if (dateInp) dateInp.value = new Date().toISOString().slice(0,10);

  watchSiteLog(pid);
}

function watchSiteLog(pid) {
  if (_slListenerRegistered) return;
  _slListenerRegistered = true;

  listen(firebase.database().ref(`projects/${pid}/siteLogs`), snap => {
    const el = document.getElementById('siteLogList');
    if (!el) return;
    el.innerHTML = '';

    if (!snap.exists()) {
      el.innerHTML = '<p class="empty-hint">No entries yet. Add your first log above.</p>';
      return;
    }

    // Collect and reverse for newest-first
    const entries = [];
    snap.forEach(c => entries.push({ id: c.key, ...c.val() }));
    entries.reverse();

    entries.forEach(e => {
      const locHTML = e.location
        ? `<a class="log-loc" href="https://maps.google.com/?q=${e.location}" target="_blank" rel="noopener">📍 Location</a>`
        : '';
      const timeHTML = e.time ? `<span class="log-time">⏰ ${e.time}</span>` : '';

      const div = document.createElement('div');
      div.className = 'log-entry';
      div.innerHTML = `
        <div class="log-entry-hdr">
          <span class="log-date">${e.date || '—'}</span>
          ${timeHTML}
          ${locHTML}
          <span class="log-saved" style="flex:1">Saved ${e.savedDate||''}</span>
          <button class="del-log" onclick="deleteLog('${e.id}')">✕</button>
        </div>
        <p class="log-notes">${(e.notes||'').replace(/\n/g,'<br>')}</p>`;
      el.appendChild(div);
    });
  });
}

async function saveLog() {
  if (!_slpid) { showToast('No active project.','error'); return; }
  const dateInp  = document.getElementById('logDate');
  const notesInp = document.getElementById('logNotes');
  const date  = dateInp?.value;
  const notes = notesInp?.value.trim();
  if (!date)  { showToast('Select a date.','error'); return; }
  if (!notes) { showToast('Write something first.','error'); return; }

  const now      = new Date();
  const timeStr  = now.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
  const savedDate= now.toLocaleDateString('en-PH');

  const logData = { date, notes, time: timeStr, savedAt: Date.now(), savedDate };

  const doSave = async (data) => {
    await firebase.database().ref(`projects/${_slpid}/siteLogs`).push(data);
    if (dateInp)  dateInp.value  = new Date().toISOString().slice(0,10);
    if (notesInp) notesInp.value = '';
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
      { timeout: 4000 }
    );
  } else {
    await doSave(logData);
    showToast('Log saved ✓');
  }
}

async function deleteLog(key) {
  if (!_slpid || !confirm('Delete this log entry?')) return;
  await firebase.database().ref(`projects/${_slpid}/siteLogs/${key}`).remove();
  showToast('Entry deleted','warn');
}