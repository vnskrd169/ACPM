/* ==========================================================================
   ACPM App Shell — Reusable UI Components
   Shared shell elements for PMOS mobile, PMOS Office, and future ACPM modules.

   Version: 1.0.0
   Dependencies: acpm-brand.css, style.css, auth.js
   ========================================================================== */

/* ---- Version Constants ---- */
const APP_VERSION = '1.0.0';
const PMOS_VERSION = '1.0.0';
const CACHE_VERSION = 'acpm-pmos-v4';
const BUILD_DATE = '2026-07-17';

window.APP_VERSION = APP_VERSION;
window.PMOS_VERSION = PMOS_VERSION;
window.CACHE_VERSION = CACHE_VERSION;

/* ---- UUID Generator (client-side stable IDs) ---- */
function pmosUuid() {
  return 'pmos_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}
window.pmosUuid = pmosUuid;

/* ---- Toast System ---- */
function pmosToast(message, type = 'success', duration = 3500) {
  const container = $('pmosToastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `pmos-toast pmos-toast-${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  toast.style.animation = 'pmosToastIn 0.3s var(--acpm-ease-out)';
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'pmosToastOut 0.25s ease-in forwards';
    setTimeout(() => toast.remove(), 260);
  }, duration);
}
window.pmosToast = pmosToast;

/* ---- Offline/Online Indicator ---- */
function pmosOnlineIndicator() {
  const el = $('pmosOnlineIndicator');
  if (!el) return;
  const online = navigator.onLine;
  el.className = `pmos-online-indicator ${online ? 'pmos-online' : 'pmos-offline'}`;
  el.innerHTML = online
    ? '<span class="pmos-dot pmos-dot-green"></span> Online'
    : '<span class="pmos-dot pmos-dot-red"></span> Offline';
  el.title = online ? 'Connected to network' : 'Working offline';
}
window.pmosOnlineIndicator = pmosOnlineIndicator;

/* ---- Sync Status Display ---- */
function pmosSyncStatus(message, type = 'idle') {
  const el = $('pmosSyncBadge');
  if (!el) return;
  el.className = `pmos-sync-badge pmos-sync-${type}`;
  el.textContent = message;
}
window.pmosSyncStatus = pmosSyncStatus;

/* ---- Photo Upload Provider (Google Drive only) ---- */
const PHOTO_PROVIDERS = {
  googleDrive: 'google-drive'
};

const PMOS_CONFIG = {
  /* ---- Photo upload provider ---- */
  photoStorageProvider: 'googleDrive',       // Google Drive only — Firebase Storage is fully disabled
  useFirebaseStoragePhotos: false,           // Must remain false — Firebase Storage accepts no writes (storage.rules)
  useGoogleDrivePhotos: true,                // Sole upload path

  /* ---- Google Drive Apps Script endpoint ---- */
  driveUploadUrl: 'https://script.google.com/macros/s/AKfycbxNQ1PunSoV2gCpdfrHs10D7kNC5YUnIyq0IHmFsI4MrDq3wHsJZaCiEcxP2RkHNA5P/exec',

  /* ---- Photo compression settings ---- */
  maxPhotoSize: 20 * 1024 * 1024,            // 20 MB
  maxPhotoDimension: 2048,
  photoQuality: 0.82,
  thumbnailDimension: 400,
  thumbnailQuality: 0.78,
  maxFileSizeMB: 20,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],

  faceAttendanceEnabled: false               // Feature flag — not related to photos
};

window.PHOTO_PROVIDERS = PHOTO_PROVIDERS;
window.PMOS_CONFIG = PMOS_CONFIG;

/* ---- Photo Helpers ---- */
function pmosSafeFileName(name = 'photo.jpg') {
  const base = String(name || 'photo')
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'photo';
  return `${base}.jpg`;
}

function pmosDateFolder(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function pmosStoragePath(projectId, module, fileId, fileName) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const safeName = pmosSafeFileName(fileName);
  return `pmos/${projectId}/${module}/${year}/${month}/${fileId}-${safeName}`;
}

window.pmosSafeFileName = pmosSafeFileName;
window.pmosDateFolder = pmosDateFolder;
window.pmosStoragePath = pmosStoragePath;

/* ---- Busy / Loading Button ---- */
async function withBusyPmos(button, fn) {
  if (!button) { await fn(); return; }
  if (button.disabled) return;
  const original = button.textContent;
  button.disabled = true;
  button.innerHTML = '<span class="pmos-spinner"></span> Working...';
  try {
    await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
window.withBusyPmos = withBusyPmos;

/* ---- Record Schema Version ---- */
const PMOS_SCHEMA_VERSION = '1.0';
window.PMOS_SCHEMA_VERSION = PMOS_SCHEMA_VERSION;

/* ---- Record Normalization ---- */
function pmosNormalizeRecord(record, collection, projectId, projectName) {
  const now = Date.now();
  return {
    id: record.id || record.clientGeneratedId || pmosUuid(),
    clientGeneratedId: record.clientGeneratedId || pmosUuid(),
    projectId: record.projectId || projectId || '',
    projectName: record.projectName || projectName || '',
    module: record.module || '',
    moduleLabel: record.moduleLabel || '',
    collection: collection || '',
    sourcePath: record.sourcePath || '',
    sourceType: record.sourceType || 'global',
    schemaVersion: PMOS_SCHEMA_VERSION,
    status: record.status || 'New',
    archived: record.archived === true,
    archivedAt: record.archivedAt || null,
    archivedBy: record.archivedBy || '',
    archiveReason: record.archiveReason || '',
    syncStatus: record.syncStatus || 'synced',
    syncError: record.syncError || '',
    draft: record.draft === true,
    createdBy: record.createdBy || '',
    createdByName: record.createdByName || '',
    createdAt: record.createdAt || now,
    updatedBy: record.updatedBy || '',
    updatedByName: record.updatedByName || '',
    updatedAt: record.updatedAt || now,
    reviewedBy: record.reviewedBy || '',
    reviewedByName: record.reviewedByName || '',
    reviewedAt: record.reviewedAt || null,
    returnedBy: record.returnedBy || '',
    returnedReason: record.returnedReason || '',
    returnedAt: record.returnedAt || null,
    ...record
  };
}
window.pmosNormalizeRecord = pmosNormalizeRecord;

/* ---- Deduplication ---- */
function pmosDedupKey(record) {
  return record.id || record.clientGeneratedId || `${record.collection || ''}|${record.projectId || ''}|${record.createdAt || ''}`;
}

function pmosDeduplicate(records) {
  const seen = new Set();
  return records.filter(r => {
    const key = pmosDedupKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
window.pmosDedupKey = pmosDedupKey;
window.pmosDeduplicate = pmosDeduplicate;

/* ---- Audit Logging ---- */
async function pmosAuditLog(action, module, projectId, recordId, summary, extra = {}) {
  const user = window._currentUser || {};
  const log = {
    actorUid: user.uid || 'system',
    actorName: user.name || 'System',
    action,
    module: module || 'pmos',
    projectId: projectId || '',
    recordId: recordId || '',
    timestamp: Date.now(),
    safeSummary: String(summary || '').slice(0, 200),
    source: 'pmos',
    ...extra
  };
  try {
    const ref = firebase.database().ref('auditLogs').push();
    await ref.set(log);
    return { id: ref.key, ...log };
  } catch (e) {
    console.warn('PMOS audit log skipped:', e?.code || e?.message || e);
    return null;
  }
}
window.pmosAuditLog = pmosAuditLog;

/* ---- Notification Idempotency ---- */
function pmosNotifIdempotencyKey(action, projectId, recordId) {
  return `${action}:${projectId}:${recordId}:${PMOS_SCHEMA_VERSION}`;
}
window.pmosNotifIdempotencyKey = pmosNotifIdempotencyKey;

/* ---- Status Transition Helper ---- */
const PMOS_STATUS_WORKFLOW = ['Draft', 'New', 'Reviewed', 'In Progress', 'Waiting', 'Done', 'Archived'];
const PMOS_MATERIAL_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Partially Approved', 'Rejected', 'For Procurement', 'Ordered', 'Partially Delivered', 'Delivered', 'Cancelled', 'Archived'];
const PMOS_ISSUE_STATUSES = ['Open', 'Assigned', 'In Progress', 'For Verification', 'Closed', 'Reopened', 'Archived'];
const PMOS_TASK_STATUSES = ['Open', 'In Progress', 'Waiting', 'Done', 'Cancelled', 'Archived'];
const PMOS_MEETING_STATUSES = ['Draft', 'Submitted', 'Reviewed', 'Action Required', 'Closed', 'Archived'];

function pmosValidTransitions(currentStatus, workflow) {
  const idx = workflow.indexOf(currentStatus);
  if (idx < 0) return workflow;
  return workflow.slice(idx);
}
window.PMOS_STATUS_WORKFLOW = PMOS_STATUS_WORKFLOW;
window.PMOS_MATERIAL_STATUSES = PMOS_MATERIAL_STATUSES;
window.PMOS_ISSUE_STATUSES = PMOS_ISSUE_STATUSES;
window.PMOS_TASK_STATUSES = PMOS_TASK_STATUSES;
window.PMOS_MEETING_STATUSES = PMOS_MEETING_STATUSES;
window.pmosValidTransitions = pmosValidTransitions;

/* ---- Draft Storage (localStorage) ---- */
function pmosGetDraft(moduleKey) {
  try {
    const raw = localStorage.getItem(`pmos_draft_${moduleKey}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function pmosSaveDraft(moduleKey, data) {
  try {
    localStorage.setItem(`pmos_draft_${moduleKey}`, JSON.stringify({ ...data, _draftSavedAt: Date.now() }));
  } catch (e) {
    console.warn('Could not save draft:', e);
  }
}

function pmosClearDraft(moduleKey) {
  try {
    localStorage.removeItem(`pmos_draft_${moduleKey}`);
  } catch {}
}

window.pmosGetDraft = pmosGetDraft;
window.pmosSaveDraft = pmosSaveDraft;
window.pmosClearDraft = pmosClearDraft;
