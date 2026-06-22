//  ACPM — compliance.js
//  Document & Compliance Tracker
//  Tracks permits, insurance, business licenses, and contract expiry
//  dates per project. Surfaces warnings on the exec dashboard and via
//  notifications. Zero extra storage cost — only stores metadata +
//  an optional external link (Google Drive / Imgur), never the file
//  itself, so we stay inside the free Firebase tier.
// ════════════════════════════════════════════════════════════

let _compPid = null;
let _compListeners = [];

const COMPLIANCE_TYPES = [
  'Building Permit', 'Business Permit', 'Insurance (CGL)', 'Insurance (Workers Comp)',
  'Contractor License', 'Fire Safety Permit', 'Environmental Permit', 'Contract', 'Other'
];

function initCompliance(pid) {
  _compPid = pid;
  detachComplianceListeners();
  populateCompDocTypeSelect();
  watchCompliance(pid);
}

function populateCompDocTypeSelect() {
  const sel = $('compDocType');
  if (!sel || sel.options.length) return; // only populate once
  COMPLIANCE_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    sel.appendChild(opt);
  });
}

function canTouchComplianceProject() {
  return !!_compPid && typeof canEditProject === 'function' && canEditProject(_compPid);
}

function detachComplianceListeners() {
  _compListeners.forEach(ref => ref.off());
  _compListeners = [];
}

function complianceListen(ref, cb) {
  ref.on('value', cb);
  _compListeners.push(ref);
}

// ══════════════════════════════════════════════════════
//  WATCH + RENDER (per project)
// ══════════════════════════════════════════════════════
function watchCompliance(pid) {
  const ref = firebase.database().ref(`projects/${pid}/compliance`);
  complianceListen(ref, snap => {
    const container = $('complianceList');
    if (!container) return;

    if (!snap.exists()) {
      container.innerHTML = '<p class="empty-hint">No documents tracked yet.</p>';
      updateComplianceSummary([]);
      return;
    }

    const items = [];
    snap.forEach(c => items.push({ id: c.key, ...c.val() }));
    items.sort((a, b) => daysUntil(a.expiryDate) - daysUntil(b.expiryDate));

    updateComplianceSummary(items);

    container.innerHTML = items.map(item => {
      const days = daysUntil(item.expiryDate);
      let statusClass = 'comp-ok', statusLabel = 'Valid';
      if (days === null) { statusClass = 'comp-ok'; statusLabel = 'No expiry'; }
      else if (days < 0) { statusClass = 'comp-expired'; statusLabel = `Expired ${Math.abs(days)}d ago`; }
      else if (days <= 30) { statusClass = 'comp-warn'; statusLabel = `${days}d left`; }

      return `
        <div class="comp-card ${statusClass}" data-cid="${item.id}">
          <div class="comp-hdr">
            <span class="comp-type">${escapeHtml(item.docType)}</span>
            <span class="comp-status-pill ${statusClass}">${statusLabel}</span>
          </div>
          <div class="comp-name">${escapeHtml(item.name || '')}</div>
          <div class="comp-meta">
            ${item.expiryDate ? `Expires: ${item.expiryDate}` : 'No expiry date'}
            ${item.refNo ? ` &middot; Ref: ${escapeHtml(item.refNo)}` : ''}
          </div>
          ${item.link ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener" class="comp-link">View document \u2197</a>` : ''}
          ${item.notes ? `<div class="comp-notes">${escapeHtml(item.notes)}</div>` : ''}
          <div class="comp-actions">
            <button class="btn-equip-action" onclick="renewCompliance('${item.id}')">\u21BB Renew</button>
            <button class="del-item-btn" onclick="deleteCompliance('${item.id}')">\u2715</button>
          </div>
        </div>
      `;
    }).join('');
  });
}

function updateComplianceSummary(items) {
  const expired = items.filter(i => daysUntil(i.expiryDate) !== null && daysUntil(i.expiryDate) < 0).length;
  const expiringSoon = items.filter(i => {
    const d = daysUntil(i.expiryDate);
    return d !== null && d >= 0 && d <= 30;
  }).length;

  setText('compTotal', items.length);
  setText('compExpired', expired);
  setText('compExpiringSoon', expiringSoon);

  const badge = $('complianceBadge');
  if (badge) {
    const alertCount = expired + expiringSoon;
    if (alertCount > 0) {
      badge.textContent = alertCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

// ══════════════════════════════════════════════════════
//  ADD / RENEW / DELETE
// ══════════════════════════════════════════════════════
async function addCompliance() {
  if (!_compPid) return;
  if (!canTouchComplianceProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const docType = $('compDocType')?.value || COMPLIANCE_TYPES[0];
  const name = $('compName')?.value.trim();
  const refNo = $('compRefNo')?.value.trim() || '';
  const expiryDate = $('compExpiryDate')?.value || '';
  const link = $('compLink')?.value.trim() || '';
  const notes = $('compNotes')?.value.trim() || '';

  if (!name) { showToast('Enter a document name.', 'error'); return; }

  await safeDb(() => firebase.database().ref(`projects/${_compPid}/compliance`).push({
    docType, name, refNo, expiryDate, link, notes,
    createdAt: Date.now(), createdBy: window._currentUser?.uid || 'system'
  }), 'Failed to add document');

  ['compName', 'compRefNo', 'compExpiryDate', 'compLink', 'compNotes'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });

  auditLog('create', 'compliance', null, { name, docType, projectId: _compPid });
  showToast(`"${name}" added to compliance tracker`);
}

async function renewCompliance(docId) {
  if (!_compPid) return;
  if (!canTouchComplianceProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const newExpiry = prompt('New expiry date (YYYY-MM-DD):');
  if (!newExpiry) return;

  const snap = await firebase.database().ref(`projects/${_compPid}/compliance/${docId}`).once('value');
  const item = snap.val();
  if (!item) return;

  await safeDb(() => firebase.database().ref(`projects/${_compPid}/compliance/${docId}`).update({
    expiryDate: newExpiry,
    renewedAt: Date.now(),
    renewedBy: window._currentUser?.uid || 'system',
    previousExpiry: item.expiryDate || null
  }), 'Failed to renew document');

  auditLog('update', 'compliance', docId, { renewed: newExpiry, projectId: _compPid });
  showToast(`${item.name} renewed to ${newExpiry}`);
}

async function deleteCompliance(docId) {
  if (!_compPid || !confirm('Delete this compliance record?')) return;
  if (!canTouchComplianceProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  await safeDb(() => firebase.database().ref(`projects/${_compPid}/compliance/${docId}`).remove(), 'Failed to delete');
  auditLog('delete', 'compliance', docId, { projectId: _compPid });
  showToast('Document deleted', 'warn');
}

// ══════════════════════════════════════════════════════
//  CROSS-PROJECT ALERTS (for boss exec dashboard / notifications)
//  Call once on app init (boss role) — scans all projects, pushes a
//  notification once per item per day so it doesn't spam.
// ══════════════════════════════════════════════════════
async function scanComplianceAcrossProjects() {
  const user = window._currentUser;
  if (!user || user.role !== 'boss') return;

  const snap = await firebase.database().ref('projects').once('value');
  const todayKey = todayISO();
  const alerts = [];

  for (const c of (() => { const arr = []; snap.forEach(x => arr.push(x)); return arr; })()) {
    const pid = c.key;
    const proj = c.val();
    const compliance = proj.compliance || {};
    Object.entries(compliance).forEach(([cid, item]) => {
      const days = daysUntil(item.expiryDate);
      if (days !== null && days <= 30) {
        alerts.push({
          projectId: pid, projectName: proj.name || pid,
          docName: item.name, docType: item.docType, days
        });
      }
    });
  }

  if (!alerts.length) return;

  // De-dupe per day using a flag in DB so we don't re-notify every reload.
  const flagRef = firebase.database().ref(`complianceAlertsSent/${todayKey}`);
  const flagSnap = await flagRef.once('value');
  if (flagSnap.exists()) return;

  const message = alerts.length === 1
    ? `${alerts[0].docName} (${alerts[0].projectName}) ${alerts[0].days < 0 ? 'has expired' : `expires in ${alerts[0].days}d`}`
    : `${alerts.length} permits/contracts need attention across your projects`;

  await sendNotification({
    to: user.uid, type: 'alert', message,
    projectId: alerts[0].projectId, projectName: alerts[0].projectName
  });

  await flagRef.set(true);
}

// ── Expose ──────────────────────────────────────────────────
window.initCompliance = initCompliance;
window.detachComplianceListeners = detachComplianceListeners;
window.addCompliance = addCompliance;
window.renewCompliance = renewCompliance;
window.deleteCompliance = deleteCompliance;
window.scanComplianceAcrossProjects = scanComplianceAcrossProjects;
window.COMPLIANCE_TYPES = COMPLIANCE_TYPES;
