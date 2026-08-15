let _slpid = null;
let _slListener = null;
let _logFilterDebounce = null;

const SITE_LOG_STATUSES = {
  draft: 'draft',
  posted: 'posted',
  revised: 'revised',
  voided: 'voided'
};

// -- Site Log photo upload (Google Drive Apps Script, no card) ----
// Reuses the same approved Drive transport as PMOS (PMOS_CONFIG.driveUploadUrl):
// photos are compressed client-side, base64-encoded, and POSTed to the Apps
// Script endpoint. No Firebase Storage, no payment, no console setup.
const SITE_LOG_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const SITE_LOG_PHOTO_MAX_IMAGE_DIMENSION = 1600;
const SITE_LOG_PHOTO_COMPRESS_QUALITY = 0.75;
const SITE_LOG_PHOTO_THUMB_DIMENSION = 400;
const SITE_LOG_PHOTO_THUMB_QUALITY = 0.78;
const SITE_LOG_DRIVE_UPLOAD_URL = (typeof window !== 'undefined' && window.PMOS_CONFIG && window.PMOS_CONFIG.driveUploadUrl)
  || 'https://script.google.com/macros/s/AKfycbxNQ1PunSoV2gCpdfrHs10D7kNC5YUnIyq0IHmFsI4MrDq3wHsJZaCiEcxP2RkHNA5P/exec';
let _slPendingPhotos = [];

function siteLogDriveAvailable() {
  try {
    return typeof fetch === 'function' && !!SITE_LOG_DRIVE_UPLOAD_URL;
  } catch (e) {
    return false;
  }
}

function siteLogPhotoFileName(file, index) {
  const base = String(file?.name || `photo_${index + 1}`)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9._-]/gi, '_')
    .slice(0, 60) || `photo_${index + 1}`;
  return `${Date.now()}_${index}_${base}`;
}

function readSiteLogFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read photo file.'));
    reader.readAsDataURL(file);
  });
}

function loadSiteLogImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not process site log photo.'));
    img.src = src;
  });
}

async function compressSiteLogImage(file, maxDim = SITE_LOG_PHOTO_MAX_IMAGE_DIMENSION, quality = SITE_LOG_PHOTO_COMPRESS_QUALITY) {
  const dataUrl = await readSiteLogFileDataUrl(file);
  const img = await loadSiteLogImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Photo compression is unavailable in this browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Photo compression failed.');
  return { blob, width: canvas.width, height: canvas.height };
}

function siteLogBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Could not read photo.'));
    reader.readAsDataURL(blob);
  });
}

function siteLogDriveThumbnailUrl(fileId, size) {
  return fileId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${size || 800}` : '';
}

async function uploadSiteLogPhoto(pid, logId, file, index = 0) {
  if (!siteLogDriveAvailable()) {
    throw new Error('Photo upload is not available on this device.');
  }
  if (file.size > SITE_LOG_PHOTO_MAX_BYTES) {
    throw new Error(`Photo "${file.name}" is larger than 10 MB.`);
  }
  const compressed = await compressSiteLogImage(file);
  const thumbnail = await compressSiteLogImage(file, SITE_LOG_PHOTO_THUMB_DIMENSION, SITE_LOG_PHOTO_THUMB_QUALITY);
  const ts = Date.now();
  const safeName = siteLogPhotoFileName(file, index);
  const fileName = `${safeName}.jpg`;
  const thumbnailFileName = `thumb_${fileName}`;
  const folder = `siteLog/${pid}/${new Date(ts).toISOString().slice(0, 10)}`;
  const [photoBase64, thumbnailBase64] = await Promise.all([
    siteLogBlobToBase64(compressed.blob),
    siteLogBlobToBase64(thumbnail.blob)
  ]);
  const response = await fetch(SITE_LOG_DRIVE_UPLOAD_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      localId: logId || '', projectId: pid, projectName: pid,
      projectFolderName: pid,
      date: new Date(ts).toISOString().slice(0, 10), fileName, thumbnailFileName,
      photoMimeType: 'image/jpeg', thumbnailMimeType: 'image/jpeg',
      photoBase64, thumbnailBase64
    })
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (e) { throw new Error(`Drive upload invalid response: ${text.slice(0, 120)}`); }

  const normalizeField = function(field) {
    for (let i = 1; i < arguments.length; i++) {
      if (data[arguments[i]]) return data[arguments[i]];
    }
    return data[field] || '';
  };
  data.photoUrl = normalizeField('photoUrl', 'fileUrl', 'viewUrl', 'downloadUrl');
  data.fileId = normalizeField('fileId', 'photoFileId');
  data.thumbnailUrl = normalizeField('thumbnailUrl', 'thumbUrl');
  data.thumbnailFileId = normalizeField('thumbnailFileId', 'thumbFileId');
  data.folderId = normalizeField('folderId', 'driveFolderId');

  if (!response.ok || data.ok === false) {
    const driveError = String(data.error || '');
    if (driveError.includes('getFolderById')) throw new Error('Drive folder not accessible.');
    if (/access|denied|authorization|permission/i.test(driveError)) throw new Error('Drive upload access denied.');
    throw new Error(driveError || `Drive upload failed with HTTP ${response.status}`);
  }
  if (!data.photoUrl || !data.thumbnailUrl) throw new Error('Drive upload did not return photo links.');
  const thumbnailUrl = data.thumbnailFileId ? siteLogDriveThumbnailUrl(data.thumbnailFileId, 800) : data.thumbnailUrl;
  return {
    mediaNo: index + 1,
    type: 'photo',
    name: String(file.name || fileName),
    url: data.photoUrl,
    storagePath: `${folder}/${fileName}`,
    thumbnailUrl,
    caption: '',
    uploadedAt: ts,
    uploadedBy: slUserId(),
    uploadedByName: slUserName(),
    offlinePending: false,
    storageProvider: 'Google Drive',
    driveFileId: data.fileId || '',
    driveFolderId: data.folderId || '',
    size: compressed.blob.size,
    width: compressed.width,
    height: compressed.height
  };
}

async function addSiteLogMedia(projectId, logId, file) {
  return uploadSiteLogPhoto(projectId, logId, file, 0);
}

// -- Photo selection previews (office site log form) -------------
function onLogPhotoSelected(input) {
  const files = Array.from(input?.files || []);
  if (!files.length) return;
  const images = files.filter(f => String(f.type || '').startsWith('image/'));
  if (images.length < files.length) showToast('Only image files are accepted.', 'warn');
  _slPendingPhotos = _slPendingPhotos.concat(images);
  renderLogPhotoPreviews();
  if (input) input.value = '';
}

function removeSelectedLogPhoto(index) {
  _slPendingPhotos.splice(index, 1);
  renderLogPhotoPreviews();
}

function clearSelectedLogPhotos() {
  _slPendingPhotos = [];
  renderLogPhotoPreviews();
}

function renderLogPhotoPreviews() {
  const container = document.getElementById('logPhotoPreview');
  if (!container) return;
  container.innerHTML = '';
  container.classList.toggle('hidden', _slPendingPhotos.length === 0);
  const countEl = document.getElementById('logPhotoCount');
  if (countEl) {
    countEl.classList.toggle('hidden', _slPendingPhotos.length === 0);
    countEl.textContent = `${_slPendingPhotos.length} photo${_slPendingPhotos.length !== 1 ? 's' : ''} selected`;
  }
  _slPendingPhotos.forEach((file, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'log-photo-thumb';
    const img = document.createElement('img');
    img.alt = file.name || 'Site photo';
    img.src = URL.createObjectURL(file);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'log-photo-remove';
    removeBtn.setAttribute('aria-label', 'Remove photo');
    removeBtn.textContent = '\u2715';
    removeBtn.onclick = () => removeSelectedLogPhoto(index);
    thumb.appendChild(img);
    thumb.appendChild(removeBtn);
    container.appendChild(thumb);
  });
}

function canTouchSiteLogProject() {
  if (typeof canWriteFieldLog === 'function') return canWriteFieldLog(_slpid);
  return typeof requireEdit === 'function'
    ? requireEdit(_slpid)
    : !!_slpid && typeof canEditProject === 'function' && canEditProject(_slpid);
}

function initSiteLog(pid) {
  _slpid = pid;
  if (_slListener) { _slListener.off(); _slListener = null; }

  // Clear any photo selections carried over from a previous project/form
  _slPendingPhotos = [];
  renderLogPhotoPreviews();

  const dateInp = $('logDate');
  if (dateInp) dateInp.value = new Date().toISOString().slice(0, 10);

  watchSiteLog(pid);
}

function detachSiteLogListeners() {
  if (_slListener) { _slListener.off(); _slListener = null; }
}

function slUserId() {
  return window._currentUser?.uid || firebase.auth().currentUser?.uid || 'system';
}

function slUserName() {
  const authUser = firebase.auth().currentUser;
  return window._currentUser?.name || window._currentUser?.displayName || authUser?.displayName || authUser?.email || 'System';
}

function siteLogProjectRef(pid, child = '') {
  return firebase.database().ref(`projects/${pid}${child ? `/${child}` : ''}`);
}

function siteLogStatus(entry) {
  const status = String(entry?.status || SITE_LOG_STATUSES.posted).toLowerCase();
  return SITE_LOG_STATUSES[status] ? status : SITE_LOG_STATUSES.posted;
}

function siteLogActive(entry) {
  return siteLogStatus(entry) !== SITE_LOG_STATUSES.voided;
}

function siteLogRows(snap) {
  const rows = [];
  if (!snap || !snap.exists()) return rows;
  snap.forEach(child => {
    rows.push({ id: child.key, ...normalizeSiteLog(child.val()) });
    return false;
  });
  return rows;
}

function normalizeSiteLog(entry = {}) {
  const weather = typeof entry.weather === 'string'
    ? { summary: entry.weather }
    : (entry.weather || { summary: '' });
  const gps = entry.gps || (() => {
    if (!entry.location || typeof entry.location !== 'string') return null;
    const parts = entry.location.split(',').map(v => parseFloat(v.trim()));
    if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
    return { latitude: parts[0], longitude: parts[1], capturedAt: entry.savedAt || 0 };
  })();
  const media = entry.media || {};
  const photos = Array.isArray(entry.photos)
    ? entry.photos
    : Object.values(media).filter(m => (m.type || '') === 'photo' && m.url).map(m => m.url);
  return {
    ...entry,
    status: siteLogStatus(entry),
    weather,
    gps,
    photos
  };
}

function linesToItems(text, mapper) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => mapper(line, index));
}

function siteLogIssueItems(text) {
  return linesToItems(text, (line, index) => ({
    issueNo: index + 1,
    type: 'general',
    severity: 'normal',
    description: line,
    status: 'open',
    createdAt: Date.now()
  }));
}

function siteLogDelayItems(text) {
  return linesToItems(text, (line, index) => ({
    delayNo: index + 1,
    cause: 'general',
    description: line,
    status: 'open',
    createdAt: Date.now()
  }));
}

function siteLogMediaItems(text) {
  return linesToItems(text, (line, index) => ({
    mediaNo: index + 1,
    type: 'photo',
    name: `Photo ${index + 1}`,
    url: line,
    caption: '',
    uploadedAt: Date.now(),
    uploadedBy: slUserId(),
    offlinePending: false
  }));
}

function arrayToObject(prefix, rows) {
  return (rows || []).reduce((acc, row, index) => {
    acc[`${prefix}_${index + 1}`] = row;
    return acc;
  }, {});
}

async function createSiteLogEvent(pid, event = {}) {
  if (!pid || !event.type) return null;
  const now = Date.now();
  const ref = siteLogProjectRef(pid, 'siteLogEvents').push();
  await ref.set({
    ...event,
    createdAt: event.createdAt || now,
    createdBy: event.createdBy || slUserId(),
    createdByName: event.createdByName || slUserName()
  });
  return ref.key;
}

async function createSiteLogNotificationEvent(pid, type, payload = {}) {
  if (!pid || !type) return null;
  const ref = siteLogProjectRef(pid, 'notificationEvents').push();
  await ref.set({
    module: 'siteLogs',
    type,
    status: 'pending',
    consumed: false,
    projectId: pid,
    createdAt: Date.now(),
    createdBy: slUserId(),
    createdByName: slUserName(),
    ...payload
  });
  return ref.key;
}

function calculateSiteLogRollups(entries) {
  const active = entries.filter(siteLogActive);
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const datedActive = active.filter(e => e.date);
  const openIssues = active.reduce((sum, e) => {
    const issues = Object.values(e.issues || {});
    return sum + issues.filter(i => (i.status || 'open') !== 'closed').length;
  }, 0);
  const openDelays = active.reduce((sum, e) => {
    const delays = Object.values(e.delays || {});
    return sum + delays.filter(d => (d.status || 'open') !== 'closed').length;
  }, 0);
  const safetyIncidents = active.reduce((sum, e) => {
    const safety = e.safety || {};
    const incidentText = String(safety.incidents || '').trim();
    return sum + (incidentText ? 1 : 0);
  }, 0);
  const logsWithMedia = active.filter(e => Object.keys(e.media || {}).length || (e.photos || []).length).length;
  const logsWithGps = active.filter(e => e.gps || e.location).length;
  const lastLogDate = datedActive.map(e => e.date).sort().pop() || '';
  return {
    totalLogs: active.length,
    voidedLogs: entries.length - active.length,
    logsThisWeek: datedActive.filter(e => new Date(e.date) >= weekAgo).length,
    logsWithGps,
    logsWithMedia,
    openIssues,
    openDelays,
    safetyIncidents,
    lastLogDate
  };
}

async function rebuildSiteLogRollups(pid, sources = {}) {
  if (!pid) return null;
  const snap = sources.siteLogsSnap || await siteLogProjectRef(pid, 'siteLogs').once('value');
  const rollup = {
    ...calculateSiteLogRollups(siteLogRows(snap)),
    lastUpdatedAt: Date.now(),
    updatedBy: slUserId()
  };
  await siteLogProjectRef(pid, 'siteLogRollups').set(rollup);
  return rollup;
}

async function listSiteLogs(pid, filters = {}) {
  const snap = await siteLogProjectRef(pid, 'siteLogs').once('value');
  let rows = siteLogRows(snap);
  if (!filters.includeVoided) rows = rows.filter(siteLogActive);
  if (filters.date) rows = rows.filter(e => e.date === filters.date);
  return rows.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

async function createSiteLog(projectId, data = {}) {
  if (!projectId) throw new Error('Project ID is required.');
  if (!data.date) throw new Error('Site log date is required.');
  if (!data.notes && !data.workAccomplished) throw new Error('Site log needs notes or work accomplished.');

  const now = Date.now();
  const counterRef = siteLogProjectRef(projectId, 'siteLogCounter');
  const result = await counterRef.transaction(current => (current || 0) + 1);
  const seq = result.snapshot.val();
  const logRef = data.logId
    ? siteLogProjectRef(projectId, `siteLogs/${data.logId}`)
    : siteLogProjectRef(projectId, 'siteLogs').push();
  const eventRef = siteLogProjectRef(projectId, 'siteLogEvents').push();
  const notificationRef = siteLogProjectRef(projectId, 'notificationEvents').push();
  const timeStr = data.time || new Date(now).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  const mediaRows = Array.isArray(data.mediaRows)
    ? data.mediaRows
    : siteLogMediaItems(data.photoUrls || '');
  const payload = {
    logNo: `SL-${String(seq).padStart(4, '0')}`,
    seq,
    date: data.date,
    time: timeStr,
    status: SITE_LOG_STATUSES.posted,
    weather: typeof data.weather === 'string' ? { summary: data.weather } : (data.weather || { summary: '' }),
    notes: data.notes || '',
    workAccomplished: data.workAccomplished || '',
    manpowerNotes: data.manpowerNotes || '',
    manpower: arrayToObject('manpower', linesToItems(data.manpowerNotes || '', (line, index) => ({
      entryNo: index + 1,
      tradeName: '',
      foremanName: '',
      workerCount: 0,
      notes: line
    }))),
    visitorNotes: data.visitorNotes || '',
    visitors: arrayToObject('visitor', linesToItems(data.visitorNotes || '', (line, index) => ({
      visitorNo: index + 1,
      name: line,
      company: '',
      purpose: '',
      notes: line
    }))),
    equipmentNotes: data.equipmentNotes || '',
    equipment: arrayToObject('equipment', linesToItems(data.equipmentNotes || '', (line, index) => ({
      equipmentNo: index + 1,
      name: line,
      qty: 1,
      status: 'used',
      notes: line
    }))),
    issues: arrayToObject('issue', siteLogIssueItems(data.issueNotes || '')),
    delays: arrayToObject('delay', siteLogDelayItems(data.delayNotes || '')),
    safety: {
      toolboxMeeting: !!data.toolboxMeeting,
      incidents: data.safetyIncidents || '',
      ppeCompliance: data.ppeCompliance || '',
      notes: data.safetyNotes || ''
    },
    media: arrayToObject('media', mediaRows),
    photos: mediaRows.filter(m => (m.type || '') === 'photo' && m.url).map(m => m.url),
    gps: data.gps || null,
    location: data.location || '',
    savedAt: now,
    savedDate: new Date(now).toLocaleDateString('en-PH'),
    savedBy: slUserId(),
    savedByName: slUserName(),
    createdAt: now,
    createdBy: slUserId(),
    createdByName: slUserName(),
    updatedAt: now,
    updatedBy: slUserId(),
    statusHistory: {
      [`${now}_posted`]: {
        fromStatus: '',
        toStatus: SITE_LOG_STATUSES.posted,
        notes: data.notes || data.workAccomplished || '',
        createdAt: now,
        createdBy: slUserId(),
        createdByName: slUserName()
      }
    }
  };

  const updates = {};
  updates[`projects/${projectId}/siteLogs/${logRef.key}`] = payload;
  updates[`projects/${projectId}/siteLogEvents/${eventRef.key}`] = {
    type: 'posted',
    logId: logRef.key,
    date: payload.date,
    description: payload.notes || payload.workAccomplished || '',
    createdAt: now,
    createdBy: slUserId(),
    createdByName: slUserName()
  };
  updates[`projects/${projectId}/notificationEvents/${notificationRef.key}`] = {
    module: 'siteLogs',
    type: 'site_log_submitted',
    status: 'pending',
    consumed: false,
    projectId,
    logId: logRef.key,
    logNo: payload.logNo,
    date: payload.date,
    createdAt: now,
    createdBy: slUserId(),
    createdByName: slUserName()
  };
  await firebase.database().ref().update(updates);
  await rebuildSiteLogRollups(projectId);
  return { id: logRef.key, ...payload };
}

async function updateSiteLog(projectId, logId, data = {}) {
  if (!projectId || !logId) throw new Error('Project and log ID are required.');
  const snap = await siteLogProjectRef(projectId, `siteLogs/${logId}`).once('value');
  if (!snap.exists()) throw new Error('Site log not found.');
  const existing = normalizeSiteLog(snap.val());
  const now = Date.now();
  const nextStatus = data.status || SITE_LOG_STATUSES.revised;
  await siteLogProjectRef(projectId, `siteLogs/${logId}`).update({
    ...data,
    status: nextStatus,
    updatedAt: now,
    updatedBy: slUserId(),
    updatedByName: slUserName(),
    [`statusHistory/${now}_${nextStatus}`]: {
      fromStatus: siteLogStatus(existing),
      toStatus: nextStatus,
      notes: data.notes || 'Site log revised',
      createdAt: now,
      createdBy: slUserId(),
      createdByName: slUserName()
    }
  });
  await createSiteLogEvent(projectId, {
    type: 'revised',
    logId,
    date: data.date || '',
    description: data.notes || 'Site log revised'
  });
  await createSiteLogNotificationEvent(projectId, 'site_log_revised', {
    logId,
    logNo: existing.logNo || '',
    date: data.date || existing.date || ''
  });
  await rebuildSiteLogRollups(projectId);
  return true;
}

async function voidSiteLog(projectId, logId, reason = '') {
  if (!projectId || !logId) throw new Error('Project and log ID are required.');
  if (!reason.trim()) throw new Error('Void reason is required.');
  const snap = await siteLogProjectRef(projectId, `siteLogs/${logId}`).once('value');
  if (!snap.exists()) throw new Error('Site log not found.');
  const log = normalizeSiteLog(snap.val());
  const now = Date.now();
  const eventRef = siteLogProjectRef(projectId, 'siteLogEvents').push();
  const notificationRef = siteLogProjectRef(projectId, 'notificationEvents').push();
  const updates = {};
  updates[`projects/${projectId}/siteLogs/${logId}/status`] = SITE_LOG_STATUSES.voided;
  updates[`projects/${projectId}/siteLogs/${logId}/voidedAt`] = now;
  updates[`projects/${projectId}/siteLogs/${logId}/voidedBy`] = slUserId();
  updates[`projects/${projectId}/siteLogs/${logId}/voidedByName`] = slUserName();
  updates[`projects/${projectId}/siteLogs/${logId}/voidReason`] = reason.trim();
  updates[`projects/${projectId}/siteLogs/${logId}/updatedAt`] = now;
  updates[`projects/${projectId}/siteLogs/${logId}/updatedBy`] = slUserId();
  updates[`projects/${projectId}/siteLogs/${logId}/statusHistory/${now}_voided`] = {
    fromStatus: siteLogStatus(log),
    toStatus: SITE_LOG_STATUSES.voided,
    notes: reason.trim(),
    createdAt: now,
    createdBy: slUserId(),
    createdByName: slUserName()
  };
  updates[`projects/${projectId}/siteLogEvents/${eventRef.key}`] = {
    type: 'voided',
    logId,
    date: log.date || '',
    description: reason.trim(),
    createdAt: now,
    createdBy: slUserId(),
    createdByName: slUserName()
  };
  updates[`projects/${projectId}/notificationEvents/${notificationRef.key}`] = {
    module: 'siteLogs',
    type: 'site_log_voided',
    status: 'pending',
    consumed: false,
    projectId,
    logId,
    logNo: log.logNo || '',
    date: log.date || '',
    createdAt: now,
    createdBy: slUserId(),
    createdByName: slUserName()
  };
  await firebase.database().ref().update(updates);
  await rebuildSiteLogRollups(projectId);
  return { id: logId, ...log, status: SITE_LOG_STATUSES.voided };
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
      if (canTouchSiteLogProject()) {
        rebuildSiteLogRollups(pid, { siteLogsSnap: snap }).catch(err => console.warn('Site log rollup rebuild failed', err));
      }
      return;
    }

    const entries = siteLogRows(snap).filter(siteLogActive);
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
      monthHeader.innerHTML = `<span class="log-month-label"><span class="log-month-toggle">\u25BC</span> ${monthLabel}</span><span class="log-month-count">${monthCount} entr${monthCount !== 1 ? 'ies' : 'y'}</span>`;
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
        dayHeader.innerHTML = `<span class="log-day-label">${dayLabel}</span><span class="log-day-count">${byMonth[monthKey][date].length} entr${byMonth[monthKey][date].length !== 1 ? 'ies' : 'y'}</span>`;
        dayGroup.appendChild(dayHeader);

        byMonth[monthKey][date].forEach(e => {
          const locHTML = e.location
            ? `<a class="log-loc" href="https://maps.google.com/?q=${e.location}" target="_blank" rel="noopener">Location</a>`
            : '';
          const timeHTML = e.time ? `<span class="log-time">\u23F0 ${e.time}</span>` : '';
          const weatherSummary = e.weather?.summary || '';
          const weatherHTML = weatherSummary ? `<span class="log-weather">${escapeHtml(weatherSummary)}</span>` : '';
          const structuredBits = [];
          if (e.workAccomplished) structuredBits.push(`<strong>Work:</strong> ${escapeHtml(e.workAccomplished)}`);
          if (e.manpowerNotes) structuredBits.push(`<strong>Manpower:</strong> ${escapeHtml(e.manpowerNotes)}`);
          if (e.equipmentNotes) structuredBits.push(`<strong>Equipment:</strong> ${escapeHtml(e.equipmentNotes)}`);
          if (e.visitorNotes) structuredBits.push(`<strong>Visitors:</strong> ${escapeHtml(e.visitorNotes)}`);
          if (e.safety?.notes) structuredBits.push(`<strong>Safety:</strong> ${escapeHtml(e.safety.notes)}`);
          const issueCount = Object.keys(e.issues || {}).length;
          const delayCount = Object.keys(e.delays || {}).length;
          if (issueCount) structuredBits.push(`<strong>Issues:</strong> ${issueCount}`);
          if (delayCount) structuredBits.push(`<strong>Delays:</strong> ${delayCount}`);

          const div = document.createElement('div');
          div.className = 'log-entry';
          div.setAttribute('data-id', e.id);
          const canVoid = canTouchSiteLogProject();
          div.innerHTML = `
            <div class="log-entry-hdr">
              <span class="log-date">${e.date || '\u2014'}</span>
              ${timeHTML}
              ${weatherHTML}
              ${locHTML}
              <span class="log-saved">${e.savedDate || ''}</span>
              ${canVoid ? `<button class="del-log" aria-label="Void log" title="Void log" data-lid="${e.id}">\u2715</button>` : ''}
            </div>
            <p class="log-notes">${escapeHtml(e.notes || '').replace(/\n/g, '<br>')}</p>
            ${structuredBits.length ? `<div class="log-structured">${structuredBits.join('<br>')}</div>` : ''}
            ${e.photos ? `<div class="log-photos">${e.photos.map(p => `<img src="${p}" class="log-photo" onclick="window.open('${p}','_blank')">`).join('')}</div>` : ''}`;

          div.querySelector('[data-lid]')?.addEventListener('click', () => deleteLog(e.id));
          dayGroup.appendChild(div);
        });

        monthBody.appendChild(dayGroup);
      });

      monthGroup.appendChild(monthBody);
      el.appendChild(monthGroup);
    });

    renderSiteLogSummary(entries);
    if (canTouchSiteLogProject()) {
      rebuildSiteLogRollups(pid, { siteLogsSnap: snap }).catch(err => console.warn('Site log rollup rebuild failed', err));
    }
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
        <span class="log-summary-item">${total} total log${total !== 1 ? 's' : ''}</span>
        <span class="log-summary-item">${withLocation} with location</span>
        <span class="log-summary-item">${thisWeek} this week</span>
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
  const workInp = $('logWork');
  const manpowerInp = $('logManpower');
  const equipmentInp = $('logEquipment');
  const visitorsInp = $('logVisitors');
  const issuesInp = $('logIssues');
  const delaysInp = $('logDelays');
  const safetyInp = $('logSafety');
  const incidentsInp = $('logSafetyIncidents');
  const photosInp = $('logPhotos');
  const date = dateInp?.value;
  const notes = notesInp?.value.trim();
  const weather = weatherInp?.value.trim() || '';
  const workAccomplished = workInp?.value.trim() || '';
  if (!date) { setFieldError($('logDate'), 'Select a date.'); return; }
  if (!notes && !workAccomplished) { setFieldError($('logNotes'), 'Write notes or work accomplished first.'); return; }
  if (notes.length > 2000) { setFieldError($('logNotes'), 'Notes too long (max 2000 chars).'); return; }

  // Validate date not in future
  const inputDate = new Date(date + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  if (inputDate > today) { showToast('Log date cannot be in the future.', 'error'); return; }

  const logData = {
    date,
    notes,
    weather: { summary: weather },
    workAccomplished,
    manpowerNotes: manpowerInp?.value.trim() || '',
    equipmentNotes: equipmentInp?.value.trim() || '',
    visitorNotes: visitorsInp?.value.trim() || '',
    issueNotes: issuesInp?.value.trim() || '',
    delayNotes: delaysInp?.value.trim() || '',
    safetyNotes: safetyInp?.value.trim() || '',
    safetyIncidents: incidentsInp?.value.trim() || '',
    photoUrls: photosInp?.value.trim() || ''
  };

  const doSave = async (data) => {
    let saveData = data;
    if (_slPendingPhotos.length) {
      if (siteLogDriveAvailable()) {
        // Upload selected photos to Google Drive under a client-generated log
        // key, then create the log referencing the exact same key + photo URLs.
        const logId = siteLogProjectRef(_slpid, 'siteLogs').push().key;
        const mediaRows = [];
        for (let i = 0; i < _slPendingPhotos.length; i++) {
          try {
            mediaRows.push(await uploadSiteLogPhoto(_slpid, logId, _slPendingPhotos[i], i));
          } catch (uploadError) {
            console.error('Site log photo upload failed:', uploadError?.code || uploadError?.message || uploadError);
            showToast(`Photo ${i + 1} failed to upload. Log not saved — fix the file or remove it and retry.`, 'error');
            return null;
          }
        }
        const urlRows = Array.isArray(data.mediaRows) ? data.mediaRows : [];
        saveData = { ...data, logId, mediaRows: urlRows.concat(mediaRows) };
      } else {
        showToast('Photo upload is not available yet — save the log, then add photo URLs manually.', 'warn');
        clearSelectedLogPhotos();
      }
    }
    const saved = await safeDb(() => createSiteLog(_slpid, saveData), 'Failed to save log');
    if (!saved) return null;
    // Only clear the selected photos once the log (and its media) is saved.
    clearSelectedLogPhotos();
    if (dateInp) dateInp.value = new Date().toISOString().slice(0, 10);
    if (notesInp) notesInp.value = '';
    if (weatherInp) weatherInp.value = '';
    [workInp, manpowerInp, equipmentInp, visitorsInp, issuesInp, delaysInp, safetyInp, incidentsInp, photosInp].forEach(inp => {
      if (inp) inp.value = '';
    });
    return saved;
  };

  const afterSave = (saved) => {
    if (!saved) return;
    auditLog('create', 'siteLog', saved.id, { date, hasLocation: !!logData.gps, projectId: _slpid });
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async pos => {
        logData.location = `${pos.coords.latitude},${pos.coords.longitude}`;
        logData.gps = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy || null,
          capturedAt: Date.now()
        };
        const saved = await doSave(logData);
        if (!saved) return;
        afterSave(saved);
        showToast('Log saved with location');
      },
      async () => {
        const saved = await doSave(logData);
        if (!saved) return;
        afterSave(saved);
        showToast('Log saved \u2713');
      },
      { timeout: 4000, enableHighAccuracy: true }
    );
  } else {
    const saved = await doSave(logData);
    if (!saved) return;
    afterSave(saved);
    showToast('Log saved \u2713');
  }
}

async function deleteLog(key) {
  if (!_slpid) return;
  if (!canTouchSiteLogProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('Void this log entry? The record will stay in history and be hidden from active views.')) return;
  const reason = prompt('Reason for voiding this site log:');
  if (!reason || !reason.trim()) {
    showToast('Void cancelled. A reason is required.', 'warn');
    return;
  }
  await safeDb(() => voidSiteLog(_slpid, key, reason.trim()), 'Failed to void log');
  auditLog('void', 'siteLog', key, { projectId: _slpid, reason: reason.trim() });
  showToast('Entry voided', 'warn');
}

async function exportSiteLogs() {
  if (!_slpid) return;
  const entries = await listSiteLogs(_slpid);
  if (!entries.length) { showToast('No logs to export.', 'warn'); return; }

  const lines = [
    '\u2550'.repeat(63),
    '  SITE LOG EXPORT',
    `  Project: ${_slpid}`,
    `  Generated: ${new Date().toLocaleDateString('en-PH')}`,
    '\u2550'.repeat(63),
    ''
  ];

  entries.forEach(e => {
    lines.push(`${e.date} ${e.time || ''}`);
    lines.push(`   ${e.notes}`);
    if (e.workAccomplished) lines.push(`   Work: ${e.workAccomplished}`);
    if (e.weather?.summary) lines.push(`   ${e.weather.summary}`);
    if (e.manpowerNotes) lines.push(`   Manpower: ${e.manpowerNotes}`);
    if (e.equipmentNotes) lines.push(`   Equipment: ${e.equipmentNotes}`);
    if (e.visitorNotes) lines.push(`   Visitors: ${e.visitorNotes}`);
    if (e.safety?.notes) lines.push(`   Safety: ${e.safety.notes}`);
    if (e.location) lines.push(`   ${e.location}`);
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
window.createSiteLog = createSiteLog;
window.listSiteLogs = listSiteLogs;
window.updateSiteLog = updateSiteLog;
window.voidSiteLog = voidSiteLog;
window.rebuildSiteLogRollups = rebuildSiteLogRollups;
window.createSiteLogEvent = createSiteLogEvent;
window.saveLog = saveLog;
window.deleteLog = deleteLog;
window.exportSiteLogs = exportSiteLogs;
window.filterLogs = filterLogs;
window.onLogPhotoSelected = onLogPhotoSelected;
window.removeSelectedLogPhoto = removeSelectedLogPhoto;
window.clearSelectedLogPhotos = clearSelectedLogPhotos;
window.addSiteLogMedia = addSiteLogMedia;
window.uploadSiteLogPhoto = uploadSiteLogPhoto;
window.siteLogDriveAvailable = siteLogDriveAvailable;
