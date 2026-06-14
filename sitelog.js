// ═══════════════════════════════════════════════════════════════
//  ACPM v4 — sitelog.js  |  Daily Site Journal
// ═══════════════════════════════════════════════════════════════
let _slpid=null;
function initSiteLog(pid){ _slpid=pid; watchSiteLog(pid); }

function watchSiteLog(pid){
  listen(firebase.database().ref(`projects/${pid}/siteLogs`), snap=>{
    const el=$('siteLogList'); if (!el) return;
    el.innerHTML='';
    if (!snap.exists()){ el.innerHTML='<p class="empty-hint">No entries yet. Add your first log above.</p>'; return; }
    const entries=[]; snap.forEach(c=>entries.unshift({id:c.key,...c.val()}));
    entries.forEach(e=>{
      el.innerHTML+=`<div class="log-entry">
        <div class="log-entry-hdr">
          <span class="log-date">${e.date}</span>
          <span class="log-saved">Logged ${e.savedDate||''}</span>
          <button class="del-log" onclick="deleteLog('${e.id}')">✕</button>
        </div>
        <p class="log-notes">${(e.notes||'').replace(/\n/g,'<br>')}</p>
      </div>`;
    });
  });
}

async function saveLog(){
  if (!_slpid) return;
  const date =$('logDate')?.value;
  const notes=$('logNotes')?.value.trim();
  if (!date)  { alert('Select a date.'); return; }
  if (!notes) { alert('Write something first.'); return; }
  await firebase.database().ref(`projects/${_slpid}/siteLogs`).push({
    date, notes, savedAt:Date.now(), savedDate:new Date().toLocaleDateString('en-PH')
  });
  $('logDate').value=''; $('logNotes').value='';
}

async function deleteLog(key){
  if (!_slpid||!confirm('Delete this log entry?')) return;
  await firebase.database().ref(`projects/${_slpid}/siteLogs/${key}`).remove();
}