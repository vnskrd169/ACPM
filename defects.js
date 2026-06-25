//  ACPM — defects.js
//  Punch List / Defects Tracker
//  Pre-turnover deficiency list per project. Assign, prioritize,
//  and close out items before handover. No file storage cost —
//  optional photo is an external link (Drive/Imgur), same pattern
//  as compliance.js, to stay on the free Firebase tier.
// ════════════════════════════════════════════════════════════

let _defPid = null;
let _defListeners = [];

const DEFECT_SEVERITY = ['minor', 'major', 'critical'];

function canTouchDefectsProject() {
  return !!_defPid && typeof canEditProject === 'function' && canEditProject(_defPid);
}

function initDefects(pid) {
  _defPid = pid;
  detachDefectListeners();
  watchDefects(pid);
}

function detachDefectListeners() {
  _defListeners.forEach(ref => ref.off());
  _defListeners = [];
}

function defectListen(ref, cb) {
  ref.on('value', cb);
  _defListeners.push(ref);
}

// ══════════════════════════════════════════════════════
//  WATCH + RENDER
// ══════════════════════════════════════════════════════
function watchDefects(pid) {
  const ref = firebase.database().ref(`projects/${pid}/punchList`);
  defectListen(ref, snap => {
    const container = $('defectList');
    if (!container) return;

    if (!snap.exists()) {
      container.innerHTML = '<p class="empty-hint">No punch list items. Site\'s clean \u2014 or no one\'s looked yet.</p>';
      updateDefectSummary([]);
      return;
    }

    const items = [];
    snap.forEach(c => items.push({ id: c.key, ...c.val() }));

    const severityRank = { critical: 0, major: 1, minor: 2 };
    items.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      return (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3);
    });

    updateDefectSummary(items);

    container.innerHTML = items.map(item => {
      const sevColor = item.severity === 'critical' ? 'var(--red)' : item.severity === 'major' ? 'var(--amber)' : 'var(--blue)';
      const isClosed = item.status === 'closed';
      return `
        <div class="defect-card ${isClosed ? 'defect-closed' : ''}" data-did="${item.id}">
          <div class="defect-hdr">
            <span class="defect-severity" style="color:${sevColor};border-color:${sevColor}">${escapeHtml(item.severity || 'minor')}</span>
            <span class="defect-status-pill ${isClosed ? 'defect-status-closed' : 'defect-status-open'}">${isClosed ? '\u2713 Closed' : '\u23F3 Open'}</span>
          </div>
          <div class="defect-desc">${escapeHtml(item.description || '')}</div>
          <div class="defect-meta">
            ${item.location ? `\u1F4CD ${escapeHtml(item.location)} \u00B7 ` : ''}
            ${item.assignee ? `Assigned: ${escapeHtml(item.assignee)} \u00B7 ` : 'Unassigned \u00B7 '}
            Raised ${timeAgo(item.createdAt)}
          </div>
          ${item.photoLink ? `<a href="${escapeHtml(item.photoLink)}" target="_blank" rel="noopener" class="defect-link">View photo \u2197</a>` : ''}
          ${isClosed && item.resolutionNotes ? `<div class="defect-resolution">\u2713 ${escapeHtml(item.resolutionNotes)}</div>` : ''}
          <div class="defect-actions">
            ${!isClosed ? `<button class="btn-equip-action" onclick="closeDefect('${item.id}')">\u2713 Mark Resolved</button>` : `<button class="btn-equip-action" onclick="reopenDefect('${item.id}')">\u21A9 Reopen</button>`}
            <button class="del-item-btn" onclick="deleteDefect('${item.id}')">\u2715</button>
          </div>
        </div>
      `;
    }).join('');
  });
}

function updateDefectSummary(items) {
  const open = items.filter(i => i.status !== 'closed').length;
  const critical = items.filter(i => i.status !== 'closed' && i.severity === 'critical').length;
  const closed = items.filter(i => i.status === 'closed').length;

  setText('defTotal', items.length);
  setText('defOpen', open);
  setText('defCritical', critical);
  setText('defClosed', closed);

  const badge = $('defectsBadge');
  if (badge) {
    if (open > 0) { badge.textContent = open; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }
}

// ══════════════════════════════════════════════════════
//  ADD / RESOLVE / DELETE
// ══════════════════════════════════════════════════════
async function addDefect() {
  if (!_defPid) return;
  if (!canTouchDefectsProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const description = $('defDesc')?.value.trim();
  const location = $('defLocation')?.value.trim() || '';
  const severity = $('defSeverity')?.value || 'minor';
  const assignee = $('defAssignee')?.value.trim() || '';
  const photoLink = $('defPhotoLink')?.value.trim() || '';

  if (!description) { showToast('Describe the defect first.', 'error'); return; }
  if (description.length > 500) { showToast('Description too long (max 500).', 'error'); return; }

  await safeDb(() => firebase.database().ref(`projects/${_defPid}/punchList`).push({
    description, location, severity, assignee, photoLink,
    status: 'open', createdAt: Date.now(), createdBy: window._currentUser?.uid || 'system'
  }), 'Failed to add punch list item');

  ['defDesc', 'defLocation', 'defAssignee', 'defPhotoLink'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });

  auditLog('create', 'defect', null, { description, severity, projectId: _defPid });

  if (severity === 'critical') {
    notifyProject(_defPid, { type: 'alert', message: `Critical punch list item: ${description}` }).catch(() => {});
  }

  showToast('Punch list item added');
}

async function closeDefect(defId) {
  if (!_defPid) return;
  if (!canTouchDefectsProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const notes = prompt('Resolution notes (optional):') || '';

  await safeDb(() => firebase.database().ref(`projects/${_defPid}/punchList/${defId}`).update({
    status: 'closed',
    resolutionNotes: notes,
    closedAt: Date.now(),
    closedBy: window._currentUser?.uid || 'system'
  }), 'Failed to close item');

  auditLog('update', 'defect', defId, { status: 'closed', projectId: _defPid });
  showToast('Item marked resolved \u2713');
}

async function reopenDefect(defId) {
  if (!_defPid) return;
  if (!canTouchDefectsProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_defPid}/punchList/${defId}`).update({
    status: 'open', reopenedAt: Date.now(), reopenedBy: window._currentUser?.uid || 'system'
  }), 'Failed to reopen item');
  auditLog('update', 'defect', defId, { status: 'open', projectId: _defPid });
  showToast('Item reopened');
}

async function deleteDefect(defId) {
  if (!_defPid) return;
  if (!canTouchDefectsProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Delete this punch list item?\n\nThis cannot be undone.')) return;
  const confirmText = prompt('Type DELETE PUNCH ITEM to confirm permanent deletion:');
  if (confirmText !== 'DELETE PUNCH ITEM') {
    showToast('Deletion cancelled.', 'warn');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_defPid}/punchList/${defId}`).remove(), 'Failed to delete item');
  auditLog('delete', 'defect', defId, { projectId: _defPid });
  showToast('Item deleted', 'warn');
}

async function exportDefectsCSV() {
  if (!_defPid) return;
  const snap = await firebase.database().ref(`projects/${_defPid}/punchList`).once('value');
  if (!snap.exists()) { showToast('No punch list items to export.', 'warn'); return; }

  let csv = 'Description,Location,Severity,Assignee,Status,Raised,Resolved,Resolution Notes\n';
  snap.forEach(c => {
    const d = c.val();
    csv += `${escapeCsv(d.description || '')},${escapeCsv(d.location || '')},${d.severity || ''},${escapeCsv(d.assignee || '')},${d.status || ''},${d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-PH') : ''},${d.closedAt ? new Date(d.closedAt).toLocaleDateString('en-PH') : ''},${escapeCsv(d.resolutionNotes || '')}\n`;
  });

  downloadTextFile(`PunchList_${_defPid}_${todayISO()}.csv`, csv, 'text/csv');
  showToast('Punch list exported!');
}

// ── Expose ──────────────────────────────────────────────────
window.initDefects = initDefects;
window.detachDefectListeners = detachDefectListeners;
window.addDefect = addDefect;
window.closeDefect = closeDefect;
window.reopenDefect = reopenDefect;
window.deleteDefect = deleteDefect;
window.exportDefectsCSV = exportDefectsCSV;
window.DEFECT_SEVERITY = DEFECT_SEVERITY;
