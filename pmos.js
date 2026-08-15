/* ==========================================================================
   ACPM PMOS — Project Mobile Operations System (Upgraded v2.0)
   Official field capture application for ACPM.

   Dependency: acpm-shell.js (must be loaded first for version constants,
   UUID generator, draft storage, normalization helpers, etc.)

   Preserved: All existing 6 modules, offline photo queue, Drive upload,
   Firebase Storage fallback, dual-path listeners, permission fallback,
   record deduplication.

   Added: Home screen, bottom navigation, draft/edit/archive workflow,
   full offline queue for all modules, notification hooks, audit trail.
   ========================================================================== */

(function () {
  'use strict';

  /* ---- Version ---- */
  const PMOS_VERSION = window.PMOS_VERSION || '1.0.0';
  const LAST_PROJECT_KEY = 'line17_pmos_last_project';
  const PMOS_SOURCE = 'Line17 PMOS';
  const GENERAL_STATUSES = ['New', 'Reviewed', 'In Progress', 'Waiting', 'Done', 'Archived'];
  const PRIORITIES = ['Normal', 'High', 'Critical', 'Low'];
  const PHOTO_CATEGORIES = ['Progress', 'Issue', 'Delivery', 'Safety', 'Quality', 'Before', 'After'];
  const PHOTO_DB_NAME = 'line17_pmos_photo_queue';
  const PHOTO_DB_VERSION = 2;
  const PHOTO_STORE = 'photoQueue';

  /* ---- Offline Queue Database for ALL modules ---- */
  const OFFLINE_DB_NAME = 'pmos_offline_queue';
  const OFFLINE_DB_VERSION = 1;
  const OFFLINE_STORE = 'offlineQueue';

  /* ---- Drive upload URL (from PMOS_CONFIG, falls back to hardcoded default) ---- */
  const PMOS_DRIVE_UPLOAD_URL = (typeof window !== 'undefined' && window.PMOS_CONFIG && window.PMOS_CONFIG.driveUploadUrl) || 'https://script.google.com/macros/s/AKfycbxNQ1PunSoV2gCpdfrHs10D7kNC5YUnIyq0IHmFsI4MrDq3wHsJZaCiEcxP2RkHNA5P/exec';
  const MODULE_ORDER = ['home', 'quick', 'sitelog', 'photo', 'issue', 'material', 'task', 'meeting'];

  const MODULES = {
    quick: {
      label: 'Quick Update',
      collection: 'pmosUpdates',
      icon: '&#x26A1;',
      fields: [
        ['category', 'Category', 'select', ['General', 'Schedule', 'Materials', 'Labor', 'Client', 'Safety', 'Quality']],
        ['note', 'Note', 'textarea'],
        ['workAccomplished', 'Work Accomplished', 'textarea'],
        ['blockers', 'Blockers', 'textarea'],
        ['nextActivity', 'Next Activity', 'textarea'],
        ['priority', 'Priority', 'select', PRIORITIES],
        ['status', 'Status', 'select', GENERAL_STATUSES],
        ['dueDate', 'Due Date', 'date']
      ]
    },
    sitelog: {
      label: 'Site Log',
      collection: 'pmosSiteLogs',
      icon: '&#x1F4CB;',
      fields: [
        ['date', 'Date', 'date'],
        ['weather', 'Weather', 'text'],
        ['workingHours', 'Working Hours', 'text'],
        ['manpowerCount', 'Manpower Count', 'number'],
        ['manpowerByTrade', 'Manpower by Trade', 'textarea'],
        ['subcontractors', 'Subcontractors', 'text'],
        ['visitors', 'Visitors', 'text'],
        ['equipment', 'Equipment Used', 'textarea'],
        ['deliveries', 'Deliveries Received', 'textarea'],
        ['accomplishment', 'Accomplishment', 'textarea'],
        ['siteInstructions', 'Site Instructions', 'textarea'],
        ['delays', 'Delays', 'textarea'],
        ['safetyObservations', 'Safety Observations', 'textarea'],
        ['qualityObservations', 'Quality Observations', 'textarea'],
        ['incidents', 'Incidents', 'textarea'],
        ['nextDayPlan', 'Next Day Plan', 'textarea'],
        ['remarks', 'Remarks', 'textarea']
      ]
    },
    issue: {
      label: 'Punchlist / Issue',
      collection: 'pmosIssues',
      icon: '&#x26A0;',
      fields: [
        ['location', 'Location', 'text'],
        ['issue', 'Issue', 'textarea'],
        ['category', 'Category', 'select', ['Structural', 'Architectural', 'MEPFS', 'Safety', 'Quality', 'Design', 'Other']],
        ['assignedTo', 'Assigned To', 'text'],
        ['responsibleTrade', 'Responsible Trade', 'text'],
        ['priority', 'Priority', 'select', PRIORITIES],
        ['status', 'Status', 'select', ['Open', 'Assigned', 'In Progress', 'For Verification', 'Closed', 'Reopened', 'Archived']],
        ['dueDate', 'Due Date', 'date'],
        ['targetDate', 'Target Date', 'date'],
        ['photoUrl', 'Photo URL Optional', 'url'],
        ['resolution', 'Resolution Notes', 'textarea']
      ]
    },
    material: {
      label: 'Material Request',
      collection: 'pmosMaterialRequests',
      icon: '&#x1F4E6;',
      fields: [
        ['item', 'Item', 'text'],
        ['description', 'Description', 'textarea'],
        ['specification', 'Specification', 'text'],
        ['quantity', 'Quantity', 'number'],
        ['unit', 'Unit', 'text'],
        ['preferredBrand', 'Preferred Brand', 'text'],
        ['neededDate', 'Needed Date', 'date'],
        ['purpose', 'Purpose', 'textarea'],
        ['priority', 'Priority', 'select', PRIORITIES],
        ['remarks', 'Remarks', 'textarea'],
        ['status', 'Status', 'select', ['Draft', 'Submitted', 'Under Review', 'Approved', 'Partially Approved', 'Rejected', 'For Procurement', 'Ordered', 'Partially Delivered', 'Delivered', 'Cancelled', 'Archived']]
      ]
    },
    task: {
      label: 'Follow-up Task',
      collection: 'tasks',
      icon: '&#x2705;',
      /* Uses canonical path: projects/{id}/tasks */
      fields: [
        ['title', 'Task', 'textarea'],
        ['assignedToName', 'Person', 'text'],
        ['company', 'Company Optional', 'text'],
        ['dueDate', 'Due Date', 'date'],
        ['priority', 'Priority', 'select', PRIORITIES],
        ['description', 'Remarks', 'textarea']
      ]
    },
    meeting: {
      label: 'Meeting Notes',
      collection: 'pmosMeetingNotes',
      icon: '&#x1F91D;',
      fields: [
        ['meetingTitle', 'Meeting Title', 'text'],
        ['meetingDate', 'Meeting Date', 'date'],
        ['meetingType', 'Meeting Type', 'select', ['Site Coordination', 'Client Meeting', 'Technical Meeting', 'Contractor Meeting', 'Admin Meeting', 'Inspection', 'Safety Meeting', 'Internal Meeting', 'Other']],
        ['attendees', 'Attendees', 'textarea'],
        ['location', 'Location / Platform', 'text'],
        ['agenda', 'Agenda', 'textarea'],
        ['discussion', 'Discussion Summary', 'textarea'],
        ['decisions', 'Decisions', 'textarea'],
        ['actionItems', 'Action Items', 'textarea'],
        ['assignedPersons', 'Assigned Persons', 'text'],
        ['targetDates', 'Target Dates', 'text'],
        ['status', 'Status', 'select', ['Draft', 'Submitted', 'Reviewed', 'Action Required', 'Closed', 'Archived']]
      ]
    },
    photo: {
      label: 'Site Camera',
      collection: 'pmosPhotoLogs',
      icon: '&#x1F4F7;',
      fields: [
        ['caption', 'Caption', 'textarea'],
        ['location', 'Location', 'text'],
        ['category', 'Category', 'select', PHOTO_CATEGORIES]
      ]
    }
  };

  var FIREBASE_CONNECTED = null;     /* null = unknown, true = connected, false = disconnected */
  var FIREBASE_LISTENER_ATTACHED = false;
  var CONNECTION_OVERRIDE = null;    /* manually forced status by setSync */
  var CONNECTION_OVERRIDE_EXPIRY = 0;

  const state = {
    initialized: false,
    projects: [],
    currentProjectId: '',
    records: [],
    listeners: [],
    activeModule: 'home',
    photoFile: null,
    photoPreviewUrl: '',
    photoQueue: [],
    photoQueueUrls: [],
    photoUploadActive: false,
    globalReadDeniedNotified: false,
    fallbackReadDeniedNotified: false,
    homeListenersAttached: false,
    pagination: { inbox: 0, feed: 0, issues: 0, materials: 0, tasks: 0, sitelogs: 0, photos: 0 },
    /* Edit tracking: when set, saves update instead of creating new */
    editingRecord: null
  };

  /* ============================================================
     HELPERS
     ============================================================ */
  function h(text) {
    return typeof escapeHtml === 'function' ? escapeHtml(text) : String(text || '');
  }

  function projectList(value) {
    if (typeof normalizeProjectList === 'function') return normalizeProjectList(value);
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    if (value && typeof value === 'object') {
      return Object.entries(value)
        .filter(([, enabled]) => enabled !== false && enabled !== null)
        .map(([key]) => String(key));
    }
    return [];
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function pmosProjectAllowed(pid) {
    const user = window._currentUser || {};
    if (!pid) return false;
    if (typeof isBoss === 'function' && isBoss(user.role)) return true;
    return projectList(user.projects).includes(pid) || projectList(user.bossOf).includes(pid);
  }

  function canEditPmosRecord(record) {
    const user = window._currentUser || {};
    if (!record || !user) return false;
    if (typeof isBoss === 'function' && isBoss(user.role)) return true;
    const isOwner = record.createdBy === user.uid;
    const isDraftOrQueued = record.draft === true || record.syncStatus === 'queued' || record.syncStatus === 'failed';
    const isNotReviewed = !record.reviewedAt && !['Reviewed', 'Done', 'Archived'].includes(String(record.status || ''));
    return isOwner && (isDraftOrQueued || isNotReviewed);
  }

  function canArchiveRecord(record) {
    const user = window._currentUser || {};
    if (!record) return false;
    if (typeof isBoss === 'function' && isBoss(user.role)) return true;
    if (record.archived) return false;
    return record.createdBy === user.uid && !['Done', 'Archived'].includes(String(record.status || ''));
  }

  function localProject() { return state.projects.find(p => p.id === state.currentProjectId) || null; }

  /* ============================================================
     TASK VISIBILITY HELPERS
     ============================================================ */
  function isTeamWideRole(role) {
    return ['boss', 'owner', 'admin', 'pm', 'apm'].indexOf(String(role || '').toLowerCase()) !== -1;
  }

  function canUserSeeTask(task) {
    var user = window._currentUser || {};
    if (!user || !user.uid) return false;
    /* PM/APM can coordinate all tasks inside an accessible project. */
    if (isTeamWideRole(user.role)) return true;
    /* Creator can always see their own tasks */
    if (task.createdBy === user.uid) return true;
    /* Field users see only tasks assigned to them */
    if (task.assignedToUid && task.assignedToUid === user.uid) return true;
    return false;
  }

  function getTaskVisibility(user) {
    if (!user || !user.uid) return 'none';
    if (isTeamWideRole(user.role)) return 'all';
    return 'own';
  }

  /* ============================================================
     OFFLINE QUEUE (All Modules)
     ============================================================ */
  function openOfflineDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB not available')); return; }
      const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      req.onupgradeneeded = () => {
        const dbi = req.result;
        if (!dbi.objectStoreNames.contains(OFFLINE_STORE)) {
          const store = dbi.createObjectStore(OFFLINE_STORE, { keyPath: 'localId' });
          store.createIndex('syncStatus', 'syncStatus', { unique: false });
          store.createIndex('module', 'module', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open offline queue.'));
    });
  }

  async function offlineDbStore(mode = 'readonly') {
    const dbi = await openOfflineDb();
    const tx = dbi.transaction(OFFLINE_STORE, mode);
    return { dbi, tx, store: tx.objectStore(OFFLINE_STORE) };
  }

  async function idbGetAllOffline() {
    const { dbi, store } = await offlineDbStore();
    try { return await idbRequest(store.getAll()); } finally { dbi.close(); }
  }

  async function idbGetOffline(localId) {
    const { dbi, store } = await offlineDbStore();
    try { return await idbRequest(store.get(localId)); } finally { dbi.close(); }
  }

  async function idbPutOffline(record) {
    const { dbi, tx, store } = await offlineDbStore('readwrite');
    try {
      await idbRequest(store.put(record));
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save offline record.'));
      });
    } finally { dbi.close(); }
  }

  async function idbDeleteOffline(localId) {
    const { dbi, tx, store } = await offlineDbStore('readwrite');
    try {
      await idbRequest(store.delete(localId));
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not delete offline record.'));
      });
    } finally { dbi.close(); }
  }

  async function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed.'));
    });
  }

  /* ---- Photo IndexedDB (preserved from original) ---- */
  function openPhotoDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB not available')); return; }
      const req = indexedDB.open(PHOTO_DB_NAME, PHOTO_DB_VERSION);
      req.onupgradeneeded = () => {
        const dbi = req.result;
        if (!dbi.objectStoreNames.contains(PHOTO_STORE)) {
          const store = dbi.createObjectStore(PHOTO_STORE, { keyPath: 'localId' });
          store.createIndex('uploadStatus', 'metadata.uploadStatus', { unique: false });
          store.createIndex('createdAt', 'metadata.createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open PMOS photo queue.'));
    });
  }

  async function photoDbStore(mode = 'readonly') {
    const dbi = await openPhotoDb();
    const tx = dbi.transaction(PHOTO_STORE, mode);
    return { dbi, tx, store: tx.objectStore(PHOTO_STORE) };
  }

  async function idbGetAllPhotos() {
    const { dbi, store } = await photoDbStore();
    try { return await idbRequest(store.getAll()); } finally { dbi.close(); }
  }

  async function idbGetPhoto(localId) {
    const { dbi, store } = await photoDbStore();
    try { return await idbRequest(store.get(localId)); } finally { dbi.close(); }
  }

  async function idbPutPhoto(record) {
    const { dbi, tx, store } = await photoDbStore('readwrite');
    try {
      await idbRequest(store.put(record));
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save photo queue.'));
      });
    } finally { dbi.close(); }
  }

  async function idbDeletePhoto(localId) {
    const { dbi, tx, store } = await photoDbStore('readwrite');
    try {
      await idbRequest(store.delete(localId));
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not delete photo.'));
      });
    } finally { dbi.close(); }
  }

  /* Image helpers preserved */
  function imageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image.')); };
      img.src = url;
    });
  }

  function canvasToJpegBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => { if (blob) resolve(blob); else reject(new Error('Could not compress photo.')); }, 'image/jpeg', quality);
    });
  }

  async function resizePhotoBlob(file, maxWidth, quality) {
    const img = await imageFromBlob(file);
    const scale = Math.min(1, maxWidth / Math.max(img.naturalWidth || img.width, 1));
    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvasToJpegBlob(canvas, quality);
  }

  function safePhotoName(name) {
    const base = String(name || 'site-photo').replace(/\.[a-z0-9]+$/i, '').toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'site-photo';
    return `${base}.jpg`;
  }

  function photoDateFolder(ts) { return new Date(ts).toISOString().slice(0, 10); }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '0 KB';
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function activeModuleEntries() { return MODULE_ORDER.map(key => [key, MODULES[key]]).filter(([, mod]) => !!mod); }
  function captureModuleEntries() { return MODULE_ORDER.filter(k => k !== 'home').map(key => [key, MODULES[key]]).filter(([, mod]) => !!mod); }

  /* ============================================================
     LOADING & INIT
     ============================================================ */
  async function loadPmosProjects() {
    const user = window._currentUser || {};
    const projects = [];
    if (typeof isBoss === 'function' && isBoss(user.role)) {
      const snap = await db.ref('projects').once('value');
      snap.forEach(child => {
        const p = child.val() || {};
        if ((p.status || 'active') === 'active') projects.push({ ...p, id: child.key });
      });
    } else {
      const ids = Array.from(new Set([...projectList(user.projects), ...projectList(user.bossOf)]));
      const snaps = await Promise.all(ids.map(id => db.ref(`projects/${id}`).once('value').then(s => [id, s.val()])));
      snaps.forEach(([id, p]) => { if (p && (p.status || 'active') === 'active') projects.push({ ...p, id }); });
    }
    return projects.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  /* ---- Combined Connection Status ---- */
  function getConnectionState() {
    /* Check for manual override from setSync (e.g. 'Syncing...', 'Sync failed') */
    if (CONNECTION_OVERRIDE && Date.now() < CONNECTION_OVERRIDE_EXPIRY) {
      return CONNECTION_OVERRIDE;
    }
    CONNECTION_OVERRIDE = null;

    var online = navigator.onLine;
    var firebaseConnected = FIREBASE_CONNECTED;

    /* --- Determine combined state --- */
    if (!online) return 'offline';
    if (firebaseConnected === null) return 'reconnecting';  /* checking... */
    if (firebaseConnected === false) return 'reconnecting'; /* browser online, Firebase not yet */
    if (firebaseConnected === true) return 'online';
    return 'offline';
  }

  function getConnectionLabel(state) {
    var pending = getPendingOfflineCount();
    var pendingLabel = pending > 0 ? ' (' + pending + ' pending)' : '';
    var labels = {
      online: '\u{1F310} Online',
      reconnecting: '\u{1F504} Reconnecting' + pendingLabel,
      offline: '\u26A0\uFE0F Offline \u2014 saved locally' + pendingLabel,
      syncing: '\u{1F504} Syncing...',
      sync_failed: '\u26A0\uFE0F Sync failed' + pendingLabel
    };
    return labels[state] || labels.offline;
  }

  function getConnectionType(state) {
    var types = {
      online: 'ok',
      reconnecting: 'saving',
      offline: 'error',
      syncing: 'saving',
      sync_failed: 'error'
    };
    return types[state] || 'error';
  }

  /* ---- Track real last successful sync time ---- */
  var LAST_SUCCESSFUL_SYNC_TIME = Date.now();

  function getPendingOfflineCount() {
    var count = 0;
    try {
      count += state.photoQueue.filter(function (item) {
        return !['Synced', 'Uploaded'].includes(String(item.metadata?.uploadStatus || 'Queued'));
      }).length;
    } catch (e) { /* ignore */ }
    return count;
  }

  function getLastSyncLabel() {
    return new Date(LAST_SUCCESSFUL_SYNC_TIME).toLocaleTimeString('en-PH');
  }

  function updateConnectionStatus() {
    var el = $('pmosSyncStatus');
    if (!el) return;
    var state = getConnectionState();
    var label = getConnectionLabel(state);
    var type = getConnectionType(state);
    el.className = 'pmos-sync pmos-sync-' + type;
    el.title = label;
    el.textContent = label;
  }

  /* ---- Attach Firebase connection listener ---- */
  function attachFirebaseConnectionListener() {
    if (FIREBASE_LISTENER_ATTACHED) return;
    FIREBASE_LISTENER_ATTACHED = true;
    try {
      var connectedRef = firebase.database().ref('.info/connected');
      connectedRef.on('value', function (snap) {
        FIREBASE_CONNECTED = snap.val() === true;
        CONNECTION_OVERRIDE = null;
        updateConnectionStatus();
      }, function (err) {
        console.warn('Firebase connection listener error:', err);
        FIREBASE_CONNECTED = navigator.onLine;
        updateConnectionStatus();
      });
    } catch (e) {
      console.warn('Could not attach Firebase connection listener:', e);
      FIREBASE_CONNECTED = navigator.onLine;
    }
  }

  /* ---- Override setSync to also update connection state ---- */
  function setSync(message, type) {
    var el = $('pmosSyncStatus');
    if (!el) return;

    /* Save sync result for state machine */
    if (type === 'saving' || type === 'ok' || type === 'error') {
      /* Map: 'saving' → syncing, 'ok' → clear override, 'error' → sync_failed */
      if (type === 'saving') {
        CONNECTION_OVERRIDE = 'syncing';
        CONNECTION_OVERRIDE_EXPIRY = Date.now() + 10000;
      } else if (type === 'ok') {
        CONNECTION_OVERRIDE = null;
        CONNECTION_OVERRIDE_EXPIRY = 0;
      } else if (type === 'error') {
        CONNECTION_OVERRIDE = 'sync_failed';
        CONNECTION_OVERRIDE_EXPIRY = Date.now() + 60000;  /* show for 60s */
      }
    }

    el.className = 'pmos-sync pmos-sync-' + (type || 'ok');
    el.textContent = message;
    el.title = message;

    if (typeof pmosSyncStatus === 'function') pmosSyncStatus(message, type || 'idle');

    /* After short-lived messages, restore combined status */
    if (type === 'ok') {
      LAST_SUCCESSFUL_SYNC_TIME = Date.now();
      clearTimeout(el._syncRestoreTimeout);
      el._syncRestoreTimeout = setTimeout(updateConnectionStatus, 3000);
    }
  }

  /* ============================================================
     RENDER — HOME SCREEN
     ============================================================ */
  function renderHome() {
    const project = localProject();
    const records = state.records.filter(r => !r.archived && (!project || r.projectId === project.id));
    const today = todayISO();

    const pendingIssues = records.filter(r => r.collection === 'pmosIssues' && !['Closed', 'Archived'].includes(String(r.status || 'Open')));
    const overdueTasks = records.filter(r => (r.collection === 'pmosTasks' || r.collection === 'tasks') && r.dueDate && r.dueDate < today && !['Done', 'Archived', 'completed', 'archived'].includes(String(r.status || 'Open')));
    const pendingMaterials = records.filter(r => r.collection === 'pmosMaterialRequests' && !['Delivered', 'Cancelled', 'Archived'].includes(String(r.status || 'Submitted')));
    const pendingPhotos = state.photoQueue.filter(item => !['Synced', 'Uploaded'].includes(String(item.metadata?.uploadStatus || 'Queued'))).length;
    const pendingSync = pendingPhotos;

    const name = window._currentUser?.name || 'User';
    const projectName = project?.name || '—';
    var connState = getConnectionState();
    var connLabel = getConnectionLabel(connState);
    var connType = getConnectionType(connState);
    var connClass = connState === 'online' ? 'pmos-online' : connState === 'reconnecting' ? 'pmos-reconnecting' : 'pmos-offline';

    return `
      <section class="pmos-home">
        <div class="pmos-home-header">
          <div>
            <div class="pmos-greeting">Hello, ${h(name)}</div>
            <div class="pmos-home-project">${h(projectName)}</div>
          </div>
          <div class="pmos-home-actions">
            <span class="pmos-home-status ${connClass}" title="${h(connLabel)}">
              ${h(connLabel)}
            </span>
          </div>
        </div>

        <div class="pmos-home-date">${new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>

        <div class="pmos-home-stats">
          <div class="pmos-stat-card" onclick="pmosOpenModule('issue')">
            <strong>${pendingIssues.length}</strong>
            <span>Open Issues</span>
          </div>
          <div class="pmos-stat-card" onclick="pmosOpenModule('task')">
            <strong>${overdueTasks.length}</strong>
            <span>Overdue Tasks</span>
          </div>
          <div class="pmos-stat-card" onclick="pmosOpenModule('material')">
            <strong>${pendingMaterials.length}</strong>
            <span>Materials Pending</span>
          </div>
          <div class="pmos-stat-card">
            <strong>${pendingSync}</strong>
            <span>Pending Sync</span>
          </div>
        </div>

        ${pendingPhotos ? `<div class="pmos-home-alert" onclick="document.getElementById('pmosNavTab_photos')?.click()">
          <span>&#x26A0;&#xFE0F;</span> ${pendingPhotos} photo${pendingPhotos > 1 ? 's' : ''} waiting to upload
        </div>` : ''}

        <div class="pmos-home-section">
          <div class="pmos-section-head">
            <h3>Quick Actions</h3>
          </div>
          <div class="pmos-home-actions-grid">
            <button class="pmos-action-card" onclick="pmosOpenModule('quick')">
              <span>&#x26A1;</span> Quick Update
            </button>
            <button class="pmos-action-card" onclick="pmosOpenModule('sitelog')">
              <span>&#x1F4CB;</span> Site Log
            </button>
            <button class="pmos-action-card" onclick="pmosOpenModule('issue')">
              <span>&#x26A0;</span> Report Issue
            </button>
            <button class="pmos-action-card" onclick="pmosOpenModule('material')">
              <span>&#x1F4E6;</span> Material Request
            </button>
            <button class="pmos-action-card" onclick="pmosOpenModule('task')">
              <span>&#x2705;</span> Follow-up Task
            </button>
            <button class="pmos-action-card" onclick="pmosOpenModule('photo')">
              <span>&#x1F4F7;</span> Site Camera
            </button>
            <button class="pmos-action-card" onclick="pmosOpenModule('meeting')">
              <span>&#x1F91D;</span> Meeting Notes
            </button>
          </div>
        </div>

        ${renderTodayTasks(records)}

        <div class="pmos-home-section">
          <div class="pmos-section-head">
            <h3>Recent Updates</h3>
          </div>
          <div id="pmosHomeRecent" class="pmos-home-recent">
            ${renderHomeRecent(records.slice(0, 5))}
          </div>
        </div>
      </section>
    `;
  }

  /* ---- Today's Tasks Section ---- */
  function renderTodayTasks(records) {
    var pid = state.currentProjectId;
    var adapter = window.PmosTaskAdapter;
    var user = window._currentUser || {};
    var visibility = getTaskVisibility(user);

    var allTaskRecords = records.filter(function (r) {
      return (r.collection === 'pmosTasks' || r.collection === 'tasks') && !r.archived;
    });

    // Normalize via adapter
    var tasks = allTaskRecords.map(function (t) {
      return adapter ? adapter.normalizeTask(t) : t;
    }).filter(Boolean);

    // Filter by assignedToUid for non-team-wide roles
    var visibleTasks = tasks.filter(function (t) {
      return visibility === 'all' ? true : canUserSeeTask(t);
    });

    var today = todayISO();
    var closedStatuses = ['Done', 'Archived', 'completed', 'archived'];
    var openCount = visibleTasks.filter(function (t) {
      return closedStatuses.indexOf(String(t.status || 'open')) === -1;
    }).length;

    var overdueCount = visibleTasks.filter(function (t) {
      return t.dueDate && t.dueDate < today && closedStatuses.indexOf(String(t.status || 'open')) === -1;
    }).length;

    var topTasks = visibleTasks
      .filter(function (t) { return closedStatuses.indexOf(String(t.status || 'open')) === -1; })
      .sort(function (a, b) {
        var aDue = a.dueDate || '9999';
        var bDue = b.dueDate || '9999';
        return aDue.localeCompare(bDue) || (b.createdAt || 0) - (a.createdAt || 0);
      })
      .slice(0, 3);

    function taskCardMini(t) {
      var title = h(t.title || t.task || 'Task').slice(0, 45);
      var assignee = h(t.assignedToName || t.person || t.assignedTo || 'Unassigned');
      var dueStr = t.dueDate ? '<span class="pmos-task-due">' + (t.dueDate < today ? '&#x26A0; Overdue' : t.dueDate) + '</span>' : '';
      var statusClass = t.status === 'overdue' || (t.dueDate && t.dueDate < today) ? 'pmos-task-overdue-tag' : '';
      var priorityLower = String(t.priority || '').toLowerCase();
      var priorityDot = '<span class="pmos-task-priority-dot pmos-priority-' + (priorityLower || 'normal') + '"></span>';
      return '<div class="pmos-task-mini-card ' + statusClass + '" onclick="pmosShowNav(\'tasks\')">' +
        '<div class="pmos-task-mini-hdr">' +
          '<strong>' + title + '</strong>' +
          dueStr +
        '</div>' +
        '<div class="pmos-task-mini-meta">' +
          '<span>' + priorityDot + ' ' + assignee + '</span>' +
          '<span class="badge badge-' + (priorityLower === 'critical' || priorityLower === 'high' ? 'red' : 'purple') + '">' + h(t.priority || 'Normal') + '</span>' +
        '</div>' +
        (t.progress ? '<div class="pmos-task-mini-progress"><div class="task-progress-bar" style="width:' + t.progress + '%"></div></div>' : '') +
      '</div>';
    }

    return '<div class="pmos-home-section pmos-today-tasks">' +
      '<div class="pmos-section-head">' +
        '<h3>&#x2705; Today\'s Tasks</h3>' +
        '<button class="pmos-btn-link" onclick="pmosShowNav(\'tasks\')">View All</button>' +
      '</div>' +
      '<div class="pmos-today-task-stats">' +
        '<div class="pmos-today-stat" onclick="pmosShowNav(\'tasks\')">' +
          '<strong>' + openCount + '</strong>' +
          '<span>Open</span>' +
        '</div>' +
        '<div class="pmos-today-stat pmos-today-stat-overdue" onclick="pmosShowNav(\'tasks\')">' +
          '<strong>' + overdueCount + '</strong>' +
          '<span>Overdue</span>' +
        '</div>' +
        '<div class="pmos-today-stat" onclick="pmosOpenModule(\'task\')">' +
          '<strong>+</strong>' +
          '<span>New Task</span>' +
        '</div>' +
      '</div>' +
      (topTasks.length ? '<div class="pmos-today-task-list">' + topTasks.map(taskCardMini).join('') + '</div>' : window.renderOnboardingState({variant:'inline',icon:'📋',title:'No tasks yet',desc:'Tap the + button below to add your first task for this project.',ctaLabel:'Create Task',ctaAction:'pmosShowCreateSheet()'})) +
    '</div>';
  }

  function renderHomeRecent(records) {
    if (!records.length) return window.renderOnboardingState({variant:'inline',icon:'📸',title:'No recent updates',desc:'Capture a photo, log an issue, or complete a task to see your activity here.',ctaLabel:'Take Photo',ctaAction:'pmosOpenModule("photo")'});
    return records.map(r => {
      const label = r.note || r.issue || r.item || r.task || r.meetingTitle || r.caption || r.accomplishment || 'Record';
      const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-PH') : '';
      const moduleIconStr = moduleIcon(r.collection);
      const sClass = statusBadgeClass(r.status || 'New');
      return `<div class="pmos-task-row pmos-recent-card">
        <div class="pmos-task-row-left">
          <div class="pmos-task-row-title">
            <span class="pmos-module-icon-sm">${moduleIconStr}</span>
            <strong>${h(label).slice(0, 60)}</strong>
          </div>
          <div class="pmos-task-row-meta">
            ${r.moduleLabel ? `<span>${h(r.moduleLabel)}</span>` : ''}
            <span>&#x1F4C5; ${date}</span>
            ${r.draft ? '<span class="badge badge-amber badge-xs">Draft</span>' : ''}
          </div>
        </div>
        <div class="pmos-task-row-right">
          <span class="badge badge-${sClass}">${h(r.status || 'New')}</span>
        </div>
      </div>`;
    }).join('');
  }

  function moduleIcon(collection) {
    const icons = {
      pmosUpdates: '&#x26A1;', pmosSiteLogs: '&#x1F4CB;', pmosIssues: '&#x26A0;',
      pmosMaterialRequests: '&#x1F4E6;', pmosTasks: '&#x2705;', pmosPhotoLogs: '&#x1F4F7;', pmosMeetingNotes: '&#x1F91D;',
      tasks: '&#x2705;'
    };
    return icons[collection] || '&#x1F4DD;';
  }

  function statusBadgeClass(status) {
    if (['Done', 'Delivered', 'Closed', 'Approved'].includes(status)) return 'green';
    if (['Critical', 'High'].includes(status) || ['Open', 'Reopened'].includes(status)) return 'red';
    if (['Waiting', 'For Verification', 'Under Review'].includes(status)) return 'amber';
    return 'purple';
  }

  /* ============================================================
     RENDER — SHELL WITH BOTTOM NAV
     ============================================================ */
  function renderPmosShell() {
    const app = $('pmosApp');
    if (!app) return;

    app.innerHTML = `
      <!-- Header -->
      <header class="pmos-header">
        <div class="pmos-header-left">
          <svg width="28" height="28" viewBox="0 0 256 256" fill="none">
            <rect x="8" y="8" width="240" height="240" rx="40" fill="#0f766e"/>
            <rect x="16" y="16" width="224" height="224" rx="32" fill="#134e4a"/>
            <rect x="52" y="64" width="10" height="120" rx="2.5" fill="#14b8a6"/>
            <rect x="52" y="64" width="46" height="10" rx="2.5" fill="#14b8a6"/>
            <rect x="88" y="64" width="10" height="50" rx="2.5" fill="#14b8a6"/>
            <rect x="52" y="105" width="46" height="10" rx="2.5" fill="#14b8a6"/>
            <rect x="108" y="64" width="10" height="120" rx="2.5" fill="#2dd4bf"/>
            <rect x="120" y="82" width="10" height="102" rx="2.5" fill="#2dd4bf"/>
            <rect x="132" y="64" width="10" height="120" rx="2.5" fill="#2dd4bf"/>
          </svg>
          <div>
            <div class="pmos-header-title">ACPM PMOS</div>
            <div class="pmos-header-sub" id="pmosHeaderProject">Select project</div>
          </div>
        </div>
        <div class="pmos-header-right">
          <span class="pmos-header-version">v${h(PMOS_VERSION)}</span>
          <button class="pmos-header-btn" onclick="logout()" title="Sign out" aria-label="Sign out">&#x1F6AA;</button>
        </div>
      </header>

      <!-- Project Selector -->
      <section class="pmos-project-bar">
        <label class="pmos-field pmos-field-inline">
          <select id="pmosProjectSelect" aria-label="Select project"></select>
        </label>
        <div id="pmosSyncStatus" class="pmos-sync pmos-sync-ok">Ready</div>
      </section>

      <!-- Main Content Area -->
      <div id="pmosContent" class="pmos-content">
        <div class="pmos-home pmos-loading-state">
          <!-- Header skeleton -->
          <div class="pmos-home-header">
            <div>
              <div class="pmos-skeleton pmos-skeleton-text" style="width:100px;height:12px;margin-bottom:8px"></div>
              <div class="pmos-skeleton pmos-skeleton-text" style="width:200px;height:20px;border-radius:4px"></div>
            </div>
            <div class="pmos-skeleton" style="width:80px;height:24px;border-radius:12px;flex-shrink:0"></div>
          </div>
          <!-- Date skeleton -->
          <div class="pmos-skeleton pmos-skeleton-text" style="width:150px;margin-bottom:20px;height:14px"></div>
          <!-- Stat cards -->
          <div class="pmos-home-stats">
            <div class="pmos-skeleton pmos-skeleton-card" style="height:72px"></div>
            <div class="pmos-skeleton pmos-skeleton-card" style="height:72px"></div>
            <div class="pmos-skeleton pmos-skeleton-card" style="height:72px"></div>
            <div class="pmos-skeleton pmos-skeleton-card" style="height:72px"></div>
          </div>
          <!-- Alert skeleton -->
          <div class="pmos-skeleton pmos-skeleton-card" style="height:48px;margin-bottom:20px"></div>
          <!-- Action grid -->
          <div class="pmos-home-actions-grid">
            <div class="pmos-skeleton pmos-skeleton-card" style="height:72px"></div>
            <div class="pmos-skeleton pmos-skeleton-card" style="height:72px"></div>
            <div class="pmos-skeleton pmos-skeleton-card" style="height:72px"></div>
            <div class="pmos-skeleton pmos-skeleton-card" style="height:72px"></div>
          </div>
          <!-- Tasks skeleton -->
          <div style="margin-top:24px">
            <div class="pmos-skeleton pmos-skeleton-text" style="width:120px;margin-bottom:12px;height:14px"></div>
            <div class="pmos-skeleton pmos-skeleton-card" style="height:56px;margin-bottom:8px"></div>
            <div class="pmos-skeleton pmos-skeleton-card" style="height:56px;margin-bottom:8px"></div>
            <div class="pmos-skeleton pmos-skeleton-card" style="height:56px"></div>
          </div>
        </div>
      </div>

      <!-- Bottom Navigation -->
      <nav class="pmos-bottom-nav" role="tablist" aria-label="PMOS navigation">
        <button class="pmos-nav-btn is-active" id="pmosNavTab_home" role="tab" onclick="pmosShowNav('home')" aria-selected="true">
          <span class="pmos-nav-icon">&#x1F3E0;</span>
          <span class="pmos-nav-label">Home</span>
        </button>
        <button class="pmos-nav-btn" id="pmosNavTab_updates" role="tab" onclick="pmosShowNav('updates')" aria-selected="false">
          <span class="pmos-nav-icon">&#x1F4AC;</span>
          <span class="pmos-nav-label">Updates</span>
        </button>
        <button class="pmos-nav-btn pmos-nav-create" id="pmosNavTab_create" role="tab" onclick="pmosShowCreateSheet()" aria-selected="false">
          <span class="pmos-nav-icon pmos-nav-create-icon">+</span>
          <span class="pmos-nav-label">Create</span>
        </button>
        <button class="pmos-nav-btn" id="pmosNavTab_tasks" role="tab" onclick="pmosShowNav('tasks')" aria-selected="false">
          <span class="pmos-nav-icon">&#x2705;</span>
          <span class="pmos-nav-label">Tasks</span>
          <span id="pmosTaskBadge" class="pmos-nav-badge hidden">0</span>
        </button>
        <button class="pmos-nav-btn" id="pmosNavTab_more" role="tab" onclick="pmosShowNav('more')" aria-selected="false">
          <span class="pmos-nav-icon">&#x2699;&#xFE0F;</span>
          <span class="pmos-nav-label">More</span>
        </button>
      </nav>

      <!-- Action Sheet (for Create button) -->
      <div id="pmosActionSheet" class="pmos-action-sheet hidden" role="dialog" aria-label="Create new record">
        <div class="pmos-action-sheet-backdrop" onclick="pmosHideCreateSheet()"></div>
        <div class="pmos-action-sheet-content">
          <div class="pmos-action-sheet-head">New Field Record</div>
          ${captureModuleEntries().map(([key, mod]) =>
            `<button class="pmos-action-sheet-btn" onclick="pmosOpenModule('${key}')">
              <span>${mod.icon || ''}</span> ${h(mod.label)}
            </button>`
          ).join('')}
          <button class="pmos-action-sheet-btn pmos-action-sheet-cancel" onclick="pmosHideCreateSheet()">Cancel</button>
        </div>
      </div>

      <!-- Toast Container -->
      <div id="pmosToastContainer" class="pmos-toast-container" role="status" aria-live="polite"></div>
    `;

    populateProjectSelect();
    attachPmosHandlers();
    setDefaultDates();
    pmosShowNav('home');
  }

  function populateProjectSelect() {
    const select = $('pmosProjectSelect');
    if (!select) return;
    if (!state.projects.length) {
      select.innerHTML = '<option value="">No active projects assigned</option>';
      return;
    }
    const last = localStorage.getItem(LAST_PROJECT_KEY);
    const initial = state.projects.some(p => p.id === last) ? last : state.projects[0].id;
    state.currentProjectId = state.currentProjectId || initial;
    select.innerHTML = state.projects.map(p => `<option value="${h(p.id)}">${h(p.name || p.id)}</option>`).join('');
    select.value = state.currentProjectId;
    updateHeaderProject();
  }

  function updateHeaderProject() {
    const el = $('pmosHeaderProject');
    if (el) {
      const proj = localProject();
      el.textContent = proj ? h(proj.name || proj.id) : 'Select project';
    }
  }

  function attachPmosHandlers() {
    $('pmosProjectSelect')?.addEventListener('change', e => {
      state.currentProjectId = e.target.value;
      localStorage.setItem(LAST_PROJECT_KEY, state.currentProjectId);
      updateHeaderProject();
      setSync('Project selected', 'ok');
      refreshContent();
    });

    document.querySelectorAll('[data-pmos-open]').forEach(btn => {
      btn.addEventListener('click', () => pmosOpenModule(btn.dataset.pmosOpen));
    });

    document.querySelectorAll('[data-pmos-form]').forEach(form => {
      form.addEventListener('submit', e => {
        e.preventDefault();
        savePmosModule(form.dataset.pmosForm, e.submitter);
      });
    });

    $('pmosTakePhotoBtn')?.addEventListener('click', () => $('pmos_photo_camera')?.click());
    $('pmosChoosePhotoBtn')?.addEventListener('click', () => $('pmos_photo_picker')?.click());
    $('pmos_photo_camera')?.addEventListener('change', e => handlePhotoSelection(e.target.files?.[0]));
    $('pmos_photo_picker')?.addEventListener('change', e => handlePhotoSelection(e.target.files?.[0]));
    $('pmosRetryAllPhotosBtn')?.addEventListener('click', () => uploadQueuedPhotos(true));

    /* Draft auto-save */
    document.querySelectorAll('[data-pmos-form]').forEach(form => {
      const key = form.dataset.pmosForm;
      form.addEventListener('input', () => {
        if (key && key !== 'photo') {
          const data = readModulePayload(key);
          if (typeof pmosSaveDraft === 'function') pmosSaveDraft(key, data);
        }
      });
    });
  }

  function setDefaultDates() {
    const today = todayISO();
    captureModuleEntries().forEach(([key, mod]) => {
      mod.fields.forEach(([name, , type]) => {
        const el = $(`pmos_${key}_${name}`);
        if (el && type === 'date' && !el.value) el.value = today;
      });
    });
  }

  /* ============================================================
     NAVIGATION
     ============================================================ */
  function pmosShowNav(tab) {
    document.querySelectorAll('.pmos-nav-btn').forEach(b => b.classList.remove('is-active'));
    const btn = $(`pmosNavTab_${tab}`);
    if (btn) btn.classList.add('is-active');

    state.activeModule = tab;
    document.querySelectorAll('.pmos-form-card').forEach(el => el.classList.add('hidden'));

    const content = $('pmosContent');
    if (!content) return;

    switch (tab) {
      case 'home': content.innerHTML = renderHome(); break;
      case 'updates': renderUpdatesView(content); break;
      case 'tasks': renderTasksView(content); break;
      case 'more': renderMoreView(content); break;
      default: content.innerHTML = renderHome();
    }

    content.scrollTop = 0;
  }

  function pmosShowCreateSheet() {
    const sheet = $('pmosActionSheet');
    if (sheet) sheet.classList.remove('hidden');
  }

  function pmosHideCreateSheet() {
    const sheet = $('pmosActionSheet');
    if (sheet) sheet.classList.add('hidden');
  }

  function pmosOpenModule(key) {
    pmosHideCreateSheet();
    if (key === 'home') { pmosShowNav('home'); return; }
    const mod = MODULES[key];
    if (!mod) return;

    // Show forms in content area
    const content = $('pmosContent');
    if (!content) return;

    content.innerHTML = renderModuleForm(key, mod);
    setDefaultDates();

    // Restore draft if exists
    if (typeof pmosGetDraft === 'function') {
      const draft = pmosGetDraft(key);
      if (draft && draft._draftSavedAt) {
        mod.fields.forEach(([name]) => {
          const el = $(`pmos_${key}_${name}`);
          if (el && draft[name] !== undefined && draft[name] !== '') el.value = draft[name];
        });
      }
    }

    // Attach form handler
    const form = document.querySelector(`[data-pmos-form="${key}"]`);
    if (form) {
      form.addEventListener('submit', e => {
        e.preventDefault();
        savePmosModule(key, e.submitter);
      });
      form.addEventListener('input', () => {
        if (key !== 'photo' && typeof pmosSaveDraft === 'function') {
          const data = readModulePayload(key);
          pmosSaveDraft(key, data);
        }
      });
    }

    content.scrollTop = 0;
    content.querySelector('.pmos-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.pmosShowNav = pmosShowNav;
  window.pmosShowCreateSheet = pmosShowCreateSheet;
  window.pmosHideCreateSheet = pmosHideCreateSheet;
  window.pmosOpenModule = pmosOpenModule;

  /* ---- Legacy task save fallback (when adapter is not loaded) ---- */
  async function saveTaskLegacy(project, mod, payload) {
    const now = Date.now();
    const ref = db.ref('pmosTasks').push();
    const clientId = typeof pmosUuid === 'function' ? pmosUuid() : 'pmos_' + now;
    const record = {
      task: payload.title || payload.task || '',
      person: payload.assignedToName || payload.person || '',
      company: payload.company || '',
      remarks: payload.description || payload.remarks || '',
      dueDate: payload.dueDate || '',
      priority: payload.priority || 'Normal',
      status: payload.status || 'Open',
      progress: 0,
      id: ref.key,
      clientGeneratedId: clientId,
      module: 'Follow-ups',
      projectId: project.id,
      projectName: project.name || project.id,
      schemaVersion: typeof PMOS_SCHEMA_VERSION !== 'undefined' ? PMOS_SCHEMA_VERSION : '1.0',
      syncStatus: 'synced',
      draft: false,
      createdAt: now,
      updatedAt: now,
      createdBy: window._currentUser?.uid || '',
      createdByName: window._currentUser?.name || '',
      source: PMOS_SOURCE
    };
    try {
      await ref.set(record);
      setSync('Task saved (legacy path).', 'ok');
      pmosToast('Task created');
      clearPmosForm('task');
    } catch (e) {
      if (String(e?.code || '').toLowerCase().includes('permission')) {
        try {
          await db.ref('projects/' + project.id + '/pmosTasks/' + ref.key).set({
            ...record, globalPathDenied: true
          });
          setSync('Task saved under project.', 'ok');
          pmosToast('Task created');
          clearPmosForm('task');
          return;
        } catch (fbError) {
          console.error('Task fallback failed:', fbError);
        }
      }
      throw e;
    }
  }

  function pmosTaskById(taskId) {
    var adapter = window.PmosTaskAdapter;
    var raw = state.records.find(function (record) {
      return (record.collection === 'tasks' || record.collection === 'pmosTasks') &&
        record.id === taskId &&
        (!state.currentProjectId || record.projectId === state.currentProjectId);
    });
    return raw && adapter ? adapter.normalizeTask(raw) : raw;
  }

  function pmosTaskActionButtons(task) {
    var adapter = window.PmosTaskAdapter;
    var transitions = adapter && adapter.TASK_TRANSITIONS ? adapter.TASK_TRANSITIONS[task.status] || [] : [];
    var role = typeof normalizeRole === 'function'
      ? normalizeRole(window._currentUser?.role)
      : String(window._currentUser?.role || '').toLowerCase();
    var canVerify = ['boss', 'owner', 'admin', 'pm'].includes(role);
    var buttons = [];
    if (transitions.includes('in_progress')) {
      buttons.push('<button type="button" class="pmos-btn-primary" onclick="pmosTransitionTask(\'in_progress\')">Start / Resume</button>');
    }
    if (transitions.includes('blocked')) {
      buttons.push('<button type="button" class="pmos-btn-secondary" onclick="pmosTransitionTask(\'blocked\')">Mark Blocked</button>');
    }
    if (transitions.includes('for_verification')) {
      buttons.push('<button type="button" class="pmos-btn-primary" onclick="pmosTransitionTask(\'for_verification\')">Submit for Verification</button>');
    }
    if (transitions.includes('completed') && canVerify) {
      buttons.push('<button type="button" class="pmos-btn-primary" onclick="pmosTransitionTask(\'completed\')">Verify and Complete</button>');
    }
    if (transitions.includes('cancelled')) {
      buttons.push('<button type="button" class="pmos-btn-secondary pmos-btn-danger" onclick="pmosTransitionTask(\'cancelled\')">Cancel Task</button>');
    }
    return buttons.join('');
  }

  /* ---- PMOS task detail and field action sheet ---- */
  function pmosOpenTaskDetails(taskId) {
    if (!taskId || !state.currentProjectId) return;
    var task = pmosTaskById(taskId);
    if (!task) {
      pmosToast('Task could not be found. Refresh and try again.', 'error');
      return;
    }
    var existing = $('pmosTaskDetailSheet');
    if (existing) existing.remove();
    var proofUrl = task.completionProof && task.completionProof.url ? task.completionProof.url : '';
    var sheet = document.createElement('div');
    sheet.id = 'pmosTaskDetailSheet';
    sheet.className = 'pmos-action-sheet';
    sheet.dataset.taskId = taskId;
    sheet.innerHTML = `
      <div class="pmos-action-sheet-backdrop" onclick="pmosCloseTaskDetails()"></div>
      <section class="pmos-action-sheet-content pmos-task-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="pmosTaskDetailTitle">
        <div class="pmos-action-sheet-head">
          <div>
            <span class="pmos-eyebrow">Today's Mission</span>
            <h2 id="pmosTaskDetailTitle">${h(task.title || 'Task')}</h2>
          </div>
          <button type="button" class="pmos-icon-btn" onclick="pmosCloseTaskDetails()" aria-label="Close task details">&times;</button>
        </div>
        <div class="pmos-task-detail-meta">
          <span>${h(task.assignedToName || 'Unassigned')}</span>
          <span>${h(task.dueDate || 'No deadline')}</span>
          <span>${h(window.PmosTaskAdapter.statusLabel(task.status))}</span>
        </div>
        ${task.description ? `<p class="pmos-task-detail-copy">${h(task.description)}</p>` : ''}
        ${task.blockedReason ? `<div class="pmos-task-detail-warning">${h(task.blockedReason)}</div>` : ''}
        <label class="pmos-field">
          <span>Work accomplished / completion note</span>
          <textarea id="pmosTaskCompletionNote" rows="3" placeholder="Describe exactly what was completed">${h(task.completionNote || '')}</textarea>
        </label>
        <label class="pmos-field">
          <span>Proof link (Google Drive, optional)</span>
          <input id="pmosTaskProofUrl" type="url" placeholder="https://drive.google.com/..." value="${h(proofUrl)}">
        </label>
        <label class="pmos-field">
          <span>Blocked reason</span>
          <textarea id="pmosTaskBlockedReason" rows="2" placeholder="What is preventing work?">${h(task.blockedReason || '')}</textarea>
        </label>
        <div class="pmos-action-sheet-actions">${pmosTaskActionButtons(task)}</div>
      </section>`;
    document.body.appendChild(sheet);
    requestAnimationFrame(function () { sheet.classList.add('is-open'); });
  }

  function pmosCloseTaskDetails() {
    var sheet = $('pmosTaskDetailSheet');
    if (!sheet) return;
    sheet.classList.remove('is-open');
    setTimeout(function () { sheet.remove(); }, 180);
  }

  async function pmosTransitionTask(status) {
    var sheet = $('pmosTaskDetailSheet');
    var taskId = sheet && sheet.dataset.taskId;
    var pid = state.currentProjectId;
    var adapter = window.PmosTaskAdapter;
    if (!taskId || !pid || !adapter || !adapter.transitionCanonicalTask) return;
    var completionNote = $('pmosTaskCompletionNote')?.value.trim() || '';
    var proofUrl = $('pmosTaskProofUrl')?.value.trim() || '';
    var blockedReason = $('pmosTaskBlockedReason')?.value.trim() || '';
    if (status === 'for_verification' && !completionNote) {
      pmosToast('Add a completion note before submitting.', 'warn');
      $('pmosTaskCompletionNote')?.focus();
      return;
    }
    if (status === 'blocked' && !blockedReason) {
      pmosToast('Add the reason the work is blocked.', 'warn');
      $('pmosTaskBlockedReason')?.focus();
      return;
    }
    if (status === 'cancelled' && !blockedReason) {
      pmosToast('Add a cancellation reason.', 'warn');
      $('pmosTaskBlockedReason')?.focus();
      return;
    }
    try {
      await adapter.transitionCanonicalTask(pid, taskId, status, {
        reason: blockedReason,
        completionNote: completionNote,
        completionProof: proofUrl ? { url: proofUrl, addedAt: Date.now(), addedBy: window._currentUser?.uid || '' } : null
      });
      if (typeof pmosAuditLog === 'function') {
        pmosAuditLog('transition', 'task', pid, taskId, 'Task moved to ' + status);
      }
      if (status === 'for_verification' && typeof createNotificationEvent === 'function') {
        createNotificationEvent({
          projectId: pid,
          module: 'tasks',
          type: 'task_verification_requested',
          payload: {
            recordId: taskId,
            message: 'Task ready for PM verification.',
            recipientRole: 'pm',
            link: 'workspace.html?projectId=' + encodeURIComponent(pid) + '&tab=tasks&fromNotif=1'
          }
        }).catch(function () {});
      }
      pmosCloseTaskDetails();
      pmosToast(status === 'for_verification' ? 'Sent for PM verification' : 'Task updated');
    } catch (error) {
      console.error('PMOS task transition failed:', error);
      pmosToast(error?.message || 'Task update failed.', 'error');
    }
  }
  window.pmosOpenTaskDetails = pmosOpenTaskDetails;
  window.pmosCloseTaskDetails = pmosCloseTaskDetails;
  window.pmosTransitionTask = pmosTransitionTask;

  /* ---- Handle deep-link from notifications ---- */
  function handlePmosDeepLink() {
    try {
      var params = new URLSearchParams(window.location.search);
      var projectParam = params.get('project');
      var taskParam = params.get('task');
      if (projectParam && taskParam) {
        // Set the project if not already set
        var select = $('pmosProjectSelect');
        if (select && select.value !== projectParam) {
          select.value = projectParam;
          state.currentProjectId = projectParam;
          localStorage.setItem(LAST_PROJECT_KEY, projectParam);
          updateHeaderProject();
        }
        // After project is set and data loaded, open the task
        setTimeout(function () {
          pmosOpenTaskDetails(taskParam);
        }, 1000);
      }
    } catch (e) {
      console.warn('Deep-link handling failed:', e);
    }
  }

  /* ============================================================
     FORM RENDERING
     ============================================================ */
  function moduleFormFields(key, mod) {
    return mod.fields.map(f => fieldControl(key, f)).join('');
  }

  function fieldControl(moduleKey, field) {
    const [name, label, type, options] = field;
    const id = `pmos_${moduleKey}_${name}`;
    if (type === 'textarea') {
      return `<label class="pmos-field"><span>${h(label)}</span><textarea id="${id}" rows="3" placeholder="${h(label)}"></textarea></label>`;
    }
    if (type === 'select') {
      return `<label class="pmos-field"><span>${h(label)}</span><select id="${id}">
        ${(options || []).map(opt => `<option value="${h(opt)}">${h(opt)}</option>`).join('')}
      </select></label>`;
    }
    return `<label class="pmos-field"><span>${h(label)}</span><input id="${id}" type="${type}" placeholder="${h(label)}" ${type === 'number' ? 'inputmode="decimal"' : ''}></label>`;
  }

  function renderModuleForm(key, mod) {
    const showDraftBtn = key !== 'photo';
    return `<section class="pmos-form-card">
      <div class="pmos-card-head">
        <div>
          <div class="pmos-eyebrow">Field Capture</div>
          <h2>${mod.icon || ''} ${h(mod.label)}</h2>
        </div>
        <button class="pmos-back-btn" type="button" onclick="pmosShowNav('home')" aria-label="Back to home">&larr;</button>
      </div>
      <form data-pmos-form="${key}">
        <div class="pmos-form-grid">
          ${key === 'photo' ? renderPhotoCapture() : ''}
          ${mod.fields.map(f => fieldControl(key, f)).join('')}
        </div>
        <div class="pmos-form-actions">
          ${key !== 'photo' ? `<button class="pmos-btn-draft" type="button" onclick="savePmosDraft('${key}')">Save Draft</button>` : ''}
          <button class="pmos-save" type="submit">Save ${h(mod.label)}</button>
        </div>
      </form>
    </section>`;
  }

  function renderPhotoCapture() {
    return `<div class="pmos-photo-capture">
      <input id="pmos_photo_camera" type="file" accept="image/*" capture="environment" class="pmos-file-input">
      <input id="pmos_photo_picker" type="file" accept="image/*" class="pmos-file-input">
      <div class="pmos-photo-buttons">
        <button class="pmos-capture-btn" type="button" id="pmosTakePhotoBtn">&#x1F4F7; Take Photo</button>
        <button class="pmos-capture-btn" type="button" id="pmosChoosePhotoBtn">&#x1F5BC;&#xFE0F; Choose Photo</button>
      </div>
      <div id="pmosPhotoPreviewWrap" class="pmos-photo-preview hidden">
        <img id="pmosPhotoPreview" alt="Selected site photo preview">
        <div id="pmosPhotoSize" class="pmos-photo-size"></div>
      </div>
    </div>`;
  }

  function handlePhotoSelection(file) {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      setSync('Select an image file.', 'error');
      return;
    }
    state.photoFile = file;
    if (state.photoPreviewUrl) URL.revokeObjectURL(state.photoPreviewUrl);
    state.photoPreviewUrl = URL.createObjectURL(file);
    const img = $('pmosPhotoPreview');
    if (img) img.src = state.photoPreviewUrl;
    $('pmosPhotoPreviewWrap')?.classList.remove('hidden');
    setText('pmosPhotoSize', `Selected: ${file.name} - ${formatBytes(file.size)}`);
    setSync('Draft. Add details, then save.', 'saving');
  }

  /* ============================================================
     DRAFT / READ / SAVE
     ============================================================ */
  function readModulePayload(key) {
    const mod = MODULES[key];
    if (!mod) return {};
    const payload = {};
    mod.fields.forEach(([name, , type]) => {
      const el = $(`pmos_${key}_${name}`);
      let value = el?.value || '';
      if (type === 'number') value = Number(value || 0);
      if (typeof value === 'string') value = value.trim();
      payload[name] = value;
    });
    return payload;
  }

  function validatePmosPayload(key, payload) {
    const requiredByModule = {
      quick: ['category', 'note'],
      sitelog: ['date', 'weather', 'accomplishment'],
      issue: ['location', 'issue'],
      material: ['item', 'quantity', 'unit', 'neededDate'],
      task: ['title', 'dueDate'],
      meeting: ['meetingTitle', 'meetingDate', 'meetingType'],
      photo: ['caption', 'location', 'category']
    };
    const missing = (requiredByModule[key] || []).find(name => payload[name] === undefined || payload[name] === '');
    return missing ? `${missing.replace(/([A-Z])/g, ' $1')} is required.` : '';
  }

  async function savePmosDraft(key) {
    if (key === 'photo' || !MODULES[key]) return;
    const payload = readModulePayload(key);
    if (typeof pmosSaveDraft === 'function') pmosSaveDraft(key, payload);
    setSync('Draft saved locally.', 'saving');
    pmosToast('Draft saved', 'success');
  }
  window.savePmosDraft = savePmosDraft;

  async function savePmosModule(key, button) {
    if (key === 'photo') {
      await savePhotoLog(button);
      return;
    }
    const mod = MODULES[key];
    const payload = readModulePayload(key);      /* --- EDIT MODE: update existing record instead of creating new --- */
    if (state.editingRecord && state.editingRecord.collection === mod.collection) {
      await saveExistingRecord(key, mod, payload, button);
      return;
    }

    const project = localProject();
    if (!project || !pmosProjectAllowed(project.id)) {
      setSync('Select an assigned active project first.', 'error');
      return;
    }
    const validation = validatePmosPayload(key, payload);
    if (validation) { setSync(validation, 'error'); return; }

    if (typeof pmosClearDraft === 'function') pmosClearDraft(key);

    await withBusy(button, async () => {
      if (!navigator.onLine) {
        await saveOffline(key, project, mod, payload);
        return;
      }

      setSync('Saving...', 'saving');

      /* ---- Task module uses canonical path: projects/{id}/tasks ---- */
      if (key === 'task') {
        try {
          const adapter = window.PmosTaskAdapter;
          if (adapter) {
            const result = await adapter.createCanonicalTask(project.id, payload);
            setSync('Task saved to ACPM.', 'ok');
            pmosToast('Task created');
            clearPmosForm(key);
            if (typeof pmosAuditLog === 'function') {
              pmosAuditLog('create', 'acpm_tasks', project.id, result.key, 'Follow-up task created via PMOS');
            }
            createPmosNotification(key, { ...payload, id: result.key, projectId: project.id });
          } else {
            // Adapter not loaded — fallback to legacy path
            await saveTaskLegacy(project, mod, payload);
          }
        } catch (e) {
          console.error('Task save failed:', e);
          await saveOffline(key, project, mod, payload);
        }
        return;
      }

      /* ---- Non-task modules: save to existing collection path ---- */
      const now = Date.now();
      const ref = db.ref(mod.collection).push();
      const clientId = typeof pmosUuid === 'function' ? pmosUuid() : `pmos_${now}`;
      const record = {
        ...payload,
        id: ref.key,
        clientGeneratedId: clientId,
        module: mod.label,
        projectId: project.id,
        projectName: project.name || project.id,
        schemaVersion: typeof PMOS_SCHEMA_VERSION !== 'undefined' ? PMOS_SCHEMA_VERSION : '1.0',
        syncStatus: 'synced',
        draft: false,
        createdAt: now,
        updatedAt: now,
        createdBy: window._currentUser?.uid || '',
        createdByName: window._currentUser?.name || '',
        source: PMOS_SOURCE
      };
      if (!record.status) record.status = 'New';

      try {
        await ref.set(record);
        setSync('Saved to Firebase. ACPM can see it.', 'ok');
        pmosToast('PMOS record saved');
        clearPmosForm(key);
        createPmosNotification(key, record);
        if (typeof pmosAuditLog === 'function') {
          pmosAuditLog('create', `pmos_${key}`, project.id, ref.key, `Created ${mod.label}`);
        }
      } catch (e) {
        if (String(e?.code || '').toLowerCase().includes('permission')) {
          try {
            await db.ref(`projects/${project.id}/${mod.collection}/${ref.key}`).set({
              ...record, globalPathDenied: true, fallbackPath: `projects/${project.id}/${mod.collection}/${ref.key}`
            });
            setSync('Saved under project.', 'ok');
            pmosToast('PMOS record saved');
            clearPmosForm(key);
            return;
          } catch (fallbackError) {
            console.error('PMOS fallback failed:', fallbackError);
          }
        }
        // Offline save fallback
        await saveOffline(key, project, mod, payload);
      }
    });
  }

  async function saveOffline(key, project, mod, payload) {
    const now = Date.now();
    const clientId = typeof pmosUuid === 'function' ? pmosUuid() : `pmos_${now}`;
    const offlineRecord = {
      localId: clientId,
      module: key,
      collection: mod.collection,
      projectId: project.id,
      projectName: project.name || project.id,
      payload,
      syncStatus: 'queued',
      createdAt: now,
      updatedAt: now,
      createdBy: window._currentUser?.uid || '',
      createdByName: window._currentUser?.name || '',
      retryCount: 0
    };
    try {
      await idbPutOffline(offlineRecord);
      setSync('Saved offline. Will sync when connected.', 'saving');
      pmosToast('Saved offline');
      clearPmosForm(key);
    } catch (dbError) {
      console.error('Offline save failed:', dbError);
      setSync('Could not save offline. Check device storage.', 'error');
    }
  }

  async function syncOfflineQueue() {
    if (!navigator.onLine) return;
    try {
      const items = await idbGetAllOffline();
      if (!items.length) return;
      setSync(`Syncing ${items.length} offline record(s)...`, 'saving');
      let synced = 0;
      for (const item of items) {
        try {
          /* Tasks use canonical path: projects/{projectId}/tasks. Other modules use root-level ref. */
          var isTask = item.collection === 'tasks';
          var targetRef;
          if (isTask && item.projectId) {
            targetRef = db.ref('projects/' + item.projectId + '/' + item.collection).push();
          } else {
            targetRef = db.ref(item.collection).push();
          }

          /* Check if a record with this clientGeneratedId already exists to prevent duplicates */
          var existingRef = isTask && item.projectId
            ? db.ref('projects/' + item.projectId + '/' + item.collection)
            : db.ref(item.collection);
          const existingCheck = await existingRef
            .orderByChild('clientGeneratedId')
            .equalTo(item.localId)
            .limitToFirst(1)
            .once('value');
          if (existingCheck.exists()) {
            // Already synced remotely, just clean up local copy
            await idbDeleteOffline(item.localId);
            synced++;
            continue;
          }
          /* Prevent duplicate by checking clientGeneratedId */
          const record = {
            ...item.payload,
            id: targetRef.key,
            clientGeneratedId: item.localId,
            module: MODULES[item.module]?.label || item.module,
            projectId: item.projectId,
            projectName: item.projectName,
            schemaVersion: typeof PMOS_SCHEMA_VERSION !== 'undefined' ? PMOS_SCHEMA_VERSION : '1.0',
            syncStatus: 'synced',
            draft: false,
            createdAt: item.createdAt,
            updatedAt: Date.now(),
            createdBy: item.createdBy || window._currentUser?.uid || '',
            createdByName: item.createdByName || window._currentUser?.name || '',
            source: PMOS_SOURCE
          };
          if (!record.status) record.status = 'New';
          await targetRef.set(record);
          await idbDeleteOffline(item.localId);
          /* Create notification for synced offline record */
          try {
            if (typeof createNotificationEvent === 'function' && MODULES[item.module]) {
              const notifTypes = {
                quick: 'quick_update_submitted', sitelog: 'site_log_submitted', issue: 'issue_submitted',
                material: 'material_request_submitted', task: 'follow_up_created', meeting: 'meeting_notes_created', photo: 'photo_proof_uploaded'
              };
              createNotificationEvent({
                projectId: item.projectId, module: 'pmos_' + (item.module || 'general'),
                type: notifTypes[item.module] || 'pmos_record_submitted',
                payload: {
                  message: `Offline ${MODULES[item.module]?.label || 'PMOS'} record synced`,
                  projectName: item.projectName,
                  idempotencyKey: `pmos_offline_sync:${item.localId}`,
                  recordId: ref.key
                }
              });
            }
          } catch (notifError) {
            console.warn('Offline sync notification skipped:', notifError);
          }
          synced++;
        } catch (e) {
          console.warn('Offline sync item failed:', item.localId, e?.code || e?.message);
          await idbPutOffline({ ...item, syncStatus: 'failed', retryCount: (item.retryCount || 0) + 1, lastError: String(e?.message || e?.code || 'Unknown') });
        }
      }
      if (synced) {
        setSync(`${synced} record(s) synced.`, 'ok');
        pmosToast(`${synced} offline record(s) synced`);
        refreshContent();
      }
    } catch (e) {
      console.warn('Offline sync failed:', e);
    }
  }

  async function retryOfflineItem(localId) {
    const item = await idbGetOffline(localId);
    if (!item) return;
    try {
      await idbPutOffline({ ...item, syncStatus: 'queued', retryCount: 0, lastError: '' });
    } catch {}
    await syncOfflineQueue();
  }
  window.retryOfflineItem = retryOfflineItem;

  /* ============================================================
     PHOTO UPLOAD (Preserved from original, with improvements)
     ============================================================ */
  async function loadPhotoQueue() {
    try {
      const rows = await idbGetAllPhotos();
      const now = Date.now();
      for (const item of rows) {
        const meta = item.metadata || {};
        if (meta.uploadStatus === 'Uploading' && (now - (meta.updatedAt || meta.createdAt || 0)) > 30000) {
          item.metadata = { ...meta, uploadStatus: 'Failed', uploadProgress: 0, errorMessage: 'Upload was interrupted.', updatedAt: now };
          await idbPutPhoto(item);
        }
      }
      state.photoQueue = rows.sort((a, b) => (b.metadata?.createdAt || 0) - (a.metadata?.createdAt || 0));
      renderPhotoQueue();
    } catch (e) {
      console.error('Photo queue load failed:', e);
      setHTML('pmosPhotoQueueList', '<p class="empty-hint">Could not read local photo queue.</p>');
    }
  }

  function renderPhotoQueue() {
    const el = $('pmosPhotoQueueList');
    if (!el) return;
    state.photoQueueUrls.forEach(url => URL.revokeObjectURL(url));
    state.photoQueueUrls = [];
    const rows = state.photoQueue.filter(item => !['Uploaded', 'Synced'].includes(String(item.metadata?.uploadStatus || 'Queued')));
    renderPendingSyncCount();
    if (!rows.length) {
      el.innerHTML = window.renderOnboardingState({variant:'inline',icon:'📸',title:'No pending uploads',desc:'Photos you take on site will queue here before uploading.'});
      return;
    }
    el.innerHTML = rows.map(item => {
      const meta = item.metadata || {};
      const thumbUrl = item.thumbnailBlob ? URL.createObjectURL(item.thumbnailBlob) : '';
      if (thumbUrl) state.photoQueueUrls.push(thumbUrl);
      const progress = Math.max(0, Math.min(100, Number(meta.uploadProgress || 0)));
      const canRetry = ['Queued', 'Failed', 'Uploading'].includes(String(meta.uploadStatus || 'Queued'));
      return `<article class="pmos-queue-item">
        ${thumbUrl ? `<img src="${thumbUrl}" alt="">` : '<div class="pmos-queue-thumb">Photo</div>'}
        <div class="pmos-queue-main">
          <strong>${h(meta.caption || meta.originalFileName || 'Site photo')}</strong>
          <span>${h(meta.projectName || meta.projectId || '')}</span>
          <div class="pmos-progress"><i style="width:${progress}%"></i></div>
          ${meta.errorMessage ? `<em>${h(meta.errorMessage)}</em>` : ''}
        </div>
        <div class="pmos-queue-actions">
          <b>${h(meta.uploadStatus || 'Queued')}</b>
          ${canRetry ? `<button type="button" onclick="pmosRetryPhoto('${h(item.localId)}')">Retry</button>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  /* ---- Photo save (preserved with Firebase Storage as primary) ---- */
  async function savePhotoLog(button) {
    const project = localProject();
    if (!project || !pmosProjectAllowed(project.id)) { setSync('Select an assigned active project first.', 'error'); return; }
    const payload = readModulePayload('photo');
    const validation = validatePmosPayload('photo', payload);
    if (validation) { setSync(validation, 'error'); return; }
    if (!state.photoFile) { setSync('Take or choose a photo first.', 'error'); return; }

    await withBusy(button, async () => {
      setSync('Compressing photo...', 'saving');
      const now = Date.now();
      const localId = `photo_${now}_${Math.random().toString(36).slice(2, 9)}`;
      const compressedBlob = await resizePhotoBlob(state.photoFile, 1600, 0.82);
      const thumbnailBlob = await resizePhotoBlob(state.photoFile, 400, 0.78);
      const metadata = {
        ...payload, localId, module: MODULES.photo.label,
        projectId: project.id, projectName: project.name || project.id,
        originalFileName: state.photoFile.name || 'site-photo.jpg',
        originalSize: state.photoFile.size || 0, compressedSize: compressedBlob.size || 0,
        thumbnailSize: thumbnailBlob.size || 0,
        uploadStatus: 'Queued', uploadProgress: 0, source: PMOS_SOURCE,
        status: 'New', createdAt: now, updatedAt: now,
        createdBy: window._currentUser?.uid || '', createdByName: window._currentUser?.name || ''
      };
      await idbPutPhoto({ localId, metadata, imageBlob: compressedBlob, thumbnailBlob });
      clearPmosForm('photo');
      await loadPhotoQueue();
      setSync(navigator.onLine ? 'Saved locally. Upload starting...' : 'Saved locally.', 'saving');
      pmosToast('Photo saved locally');
      if (navigator.onLine) uploadQueuedPhotos();

      if (typeof pmosAuditLog === 'function') {
        pmosAuditLog('photo_capture', 'pmos_photo', project.id, localId, 'Photo captured');
      }
    });
  }

  async function uploadQueuedPhotos(includeFailed) {
    if (state.photoUploadActive) return;
    if (!navigator.onLine) { setSync('Offline. Photo uploads saved locally.', 'saving'); return; }
    await loadPhotoQueue();
    const queue = state.photoQueue.filter(item => {
      const status = String(item.metadata?.uploadStatus || 'Queued');
      return status === 'Queued' || (includeFailed && ['Failed', 'Uploading'].includes(status));
    });
    if (!queue.length) return;
    state.photoUploadActive = true;
    try {
      for (const item of queue) await uploadPhotoQueueItem(item);
    } finally {
      state.photoUploadActive = false;
      await loadPhotoQueue();
    }
  }

  async function uploadPhotoQueueItem(item) {
    let current = await updateQueuedPhoto(item, { uploadStatus: 'Uploading', uploadProgress: 1, errorMessage: '' });
    const meta = current.metadata || {};
    const ts = meta.createdAt || Date.now();
    const filename = `${ts}_${safePhotoName(meta.originalFileName)}`;
    const folder = `pmos/${meta.projectId}/photoLogs/${photoDateFolder(ts)}`;
    const storagePath = meta.storagePath || `${folder}/${filename}`;
    const thumbnailStoragePath = meta.thumbnailStoragePath || `${folder}/thumb_${filename}`;

    try {
      let photoUrl = meta.photoUrl || '';
      let thumbnailUrl = meta.thumbnailUrl || '';

      if (!photoUrl) {
        /* Google Drive only — Firebase Storage is not used */
        const uploaded = await uploadPhotoToDrive(
          meta, current.imageBlob, current.thumbnailBlob,
          storagePath, thumbnailStoragePath,
          pct => patchPhotoQueueView(current.localId, { uploadProgress: pct })
        );
        photoUrl = uploaded.photoUrl;
        thumbnailUrl = uploaded.thumbnailUrl;
        var driveFileId = uploaded.photoFileId || '';
        var thumbnailDriveFileId = uploaded.thumbnailFileId || '';
        var driveFolderId = uploaded.driveFolderId || '';

        current = await updateQueuedPhoto(current, {
          photoUrl, thumbnailUrl, uploadProgress: 96
        });
      }

      const finalRef = db.ref(MODULES.photo.collection).push();
      const uploadedAt = Date.now();
      const uploadedMeta = current.metadata || {};
      const finalRecord = {
        id: finalRef.key, projectId: meta.projectId, projectName: meta.projectName,
        caption: meta.caption, location: meta.location, category: meta.category,
        photoUrl, thumbnailUrl,
        driveFileId: driveFileId || meta.driveFileId || '',
        thumbnailDriveFileId: thumbnailDriveFileId || meta.thumbnailDriveFileId || '',
        driveFolderId: driveFolderId || meta.driveFolderId || '',
        storageProvider: 'Google Drive',
        originalFileName: meta.originalFileName, compressedSize: meta.compressedSize || current.imageBlob?.size || 0,
        uploadStatus: 'Uploaded', source: PMOS_SOURCE,
        createdAt: meta.createdAt, uploadedAt, status: 'New', module: MODULES.photo.label,
        createdBy: meta.createdBy || window._currentUser?.uid || '',
        createdByName: meta.createdByName || window._currentUser?.name || '',
        updatedAt: uploadedAt, schemaVersion: typeof PMOS_SCHEMA_VERSION !== 'undefined' ? PMOS_SCHEMA_VERSION : '1.0'
      };

      try { await finalRef.set(finalRecord); } catch (e) {
        if (!String(e?.code || '').toLowerCase().includes('permission')) throw e;
        await db.ref(`projects/${meta.projectId}/${MODULES.photo.collection}/${finalRef.key}`).set({ ...finalRecord, globalPathDenied: true });
      }
      await idbDeletePhoto(current.localId);
      setSync('Photo uploaded to Google Drive.', 'ok');
      pmosToast('Photo uploaded to Google Drive');
    } catch (e) {
      console.error('Photo upload failed:', e);
      await updateQueuedPhoto(current, { uploadStatus: 'Failed', uploadProgress: 0, errorMessage: e.message || e.code || 'Upload failed' });
      setSync('Photo upload failed. Local copy kept.', 'error');
    }
  }

  async function updateQueuedPhoto(item, patch) {
    const next = { ...item, metadata: { ...(item.metadata || {}), ...patch, updatedAt: Date.now() } };
    await idbPutPhoto(next);
    const idx = state.photoQueue.findIndex(q => q.localId === next.localId);
    if (idx >= 0) state.photoQueue[idx] = next; else state.photoQueue.unshift(next);
    renderPhotoQueue();
    return next;
  }

  function patchPhotoQueueView(localId, patch) {
    const idx = state.photoQueue.findIndex(q => q.localId === localId);
    if (idx < 0) return;
    state.photoQueue[idx] = { ...state.photoQueue[idx], metadata: { ...(state.photoQueue[idx].metadata || {}), ...patch } };
    renderPhotoQueue();
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(reader.error || new Error('Could not read photo.'));
      reader.readAsDataURL(blob);
    });
  }

  function driveThumbnailUrl(fileId, size) { return fileId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${size || 800}` : ''; }

  async function uploadPhotoToDrive(meta, imageBlob, thumbnailBlob, storagePath, thumbnailStoragePath, onProgress) {
    if (!PMOS_DRIVE_UPLOAD_URL) throw new Error('PMOS Drive upload URL not configured.');
    onProgress(8);
    const [photoBase64, thumbnailBase64] = await Promise.all([blobToBase64(imageBlob), blobToBase64(thumbnailBlob)]);
    onProgress(35);
    const fileName = storagePath.split('/').pop() || safePhotoName(meta.originalFileName);
    const thumbnailFileName = thumbnailStoragePath.split('/').pop() || `thumb_${fileName}`;
    const response = await fetch(PMOS_DRIVE_UPLOAD_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        localId: meta.localId, projectId: meta.projectId, projectName: meta.projectName,
        projectFolderName: meta.projectName || meta.projectId,
        date: photoDateFolder(meta.createdAt || Date.now()), fileName, thumbnailFileName,
        photoMimeType: 'image/jpeg', thumbnailMimeType: 'image/jpeg', photoBase64, thumbnailBase64
      })
    });
    onProgress(82);
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch (e) { throw new Error(`Drive upload invalid response: ${text.slice(0, 120)}`); }

    /* ---- Normalize Drive response fields ---- */
    // Accept various response field name conventions
    const normalizeField = function(field) {
      for (var i = 1; i < arguments.length; i++) {
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
    const thumbnailUrl = data.thumbnailFileId ? driveThumbnailUrl(data.thumbnailFileId, 800) : data.thumbnailUrl;
    onProgress(96);
    return {
      photoUrl: data.photoUrl,
      thumbnailUrl: thumbnailUrl,
      photoFileId: data.fileId || data.photoFileId || '',
      thumbnailFileId: data.thumbnailFileId || '',
      driveFolderId: data.folderId || '',
      storageProvider: 'Google Drive'
    };
  }

  function clearPmosForm(key) {
    const mod = MODULES[key];
    if (!mod) return;
    mod.fields.forEach(([name, , type, options]) => {
      const el = $(`pmos_${key}_${name}`);
      if (!el) return;
      if (type === 'select') el.value = options?.[0] || '';
      else if (type === 'date') el.value = todayISO();
      else el.value = '';
    });
    if (key === 'photo') {
      state.photoFile = null;
      if (state.photoPreviewUrl) URL.revokeObjectURL(state.photoPreviewUrl);
      state.photoPreviewUrl = '';
      const preview = $('pmosPhotoPreview');
      if (preview) preview.removeAttribute('src');
      $('pmosPhotoPreviewWrap')?.classList.add('hidden');
      setText('pmosPhotoSize', '');
      const camera = $('pmos_photo_camera');
      const picker = $('pmos_photo_picker');
      if (camera) camera.value = '';
      if (picker) picker.value = '';
    }
    if (typeof pmosClearDraft === 'function') pmosClearDraft(key);
  }

  /* ============================================================
     UPDATE VIEW — Show Recent Updates
     ============================================================ */
  function renderUpdatesView(content) {
    const pid = state.currentProjectId;
    const records = state.records
      .filter(r => !r.archived && (!pid || r.projectId === pid))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 50);

    const byModule = {};
    captureModuleEntries().forEach(([key, mod]) => {
      const modRecords = records.filter(r => r.collection === mod.collection);
      if (modRecords.length) byModule[key] = modRecords;
    });

    content.innerHTML = `
      <div class="pmos-updates-view">
        <div class="pmos-card-head">
          <h2>Recent Updates</h2>
          <span class="pmos-count">${records.length} records</span>
        </div>
        ${Object.entries(byModule).length ? Object.entries(byModule).map(([key, items]) => `
          <section class="pmos-update-group">
            <h3>${MODULES[key]?.icon || ''} ${h(MODULES[key]?.label || key)} <span>(${items.length})</span></h3>
            ${items.slice(0, 10).map(r => updateRecordRow(r)).join('')}
            ${items.length > 10 ? `<button class="pmos-load-more" onclick="pmosOpenModule('${key}')">View all ${items.length} records</button>` : ''}
          </section>
        `).join('') : window.renderOnboardingState({variant:'inline',icon:'📝',title:'No records yet',desc:'Tap Create below to add your first field record — photo, issue, material, or update.',ctaLabel:'Create Record',ctaAction:'pmosShowCreateSheet()'})}
      </div>
    `;
  }

  /* ---- Shared Module Record Card Row ---- */
  function pmosModuleRow(r) {
    const title = r.note || r.issue || r.item || r.task || r.meetingTitle || r.caption || r.accomplishment || 'Record';
    const label = r.moduleLabel || getModuleLabelForCollection(r.collection) || '';
    const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-PH') : '';
    const moduleIcon = moduleIcon(r.collection);
    const priorityLower = String(r.priority || '').toLowerCase();
    const status = r.status || 'New';
    const isDraft = r.draft === true;
    const isArchived = r.archived === true;
    const canEdit = canEditPmosRecord(r);
    const editAttr = canEdit ? ` onclick="editPmosRecord('${h(r.collection)}','${h(r.id)}','${h(r.projectId || '')}')"` : '';
    const clickableClass = canEdit ? 'pmos-record-clickable' : '';

    const sClass = statusBadgeClass(status);
    const priorityDot = priorityLower ? `<span class="pmos-task-priority-dot pmos-priority-${priorityLower}" title="${h(r.priority)}"></span>` : '';
    const priorityBadge = r.priority ? `<span class="badge badge-${r.priority === 'Critical' || r.priority === 'High' ? 'red' : r.priority === 'Low' ? 'amber' : 'purple'}">${h(r.priority)}</span>` : '';
    const draftBadge = isDraft ? '<span class="badge badge-amber badge-xs">Draft</span>' : '';
    const archivedBadge = isArchived ? '<span class="badge badge-dim badge-xs">Archived</span>' : '';

    return `<div class="pmos-task-row ${clickableClass}"${editAttr}>
      <div class="pmos-task-row-left">
        <div class="pmos-task-row-title">
          <span class="pmos-module-icon-sm">${moduleIcon}</span>
          <strong>${h(title).slice(0, 80)}</strong>
          ${priorityDot}
        </div>
        <div class="pmos-task-row-meta">
          ${label ? `<span>${h(label)}</span>` : ''}
          <span>&#x1F4C5; ${date}</span>
          ${priorityBadge}
          ${draftBadge}
          ${archivedBadge}
        </div>
      </div>
      <div class="pmos-task-row-right">
        <span class="badge badge-${sClass}">${h(status)}</span>
      </div>
    </div>`;
  }

  function getModuleLabelForCollection(collection) {
    for (var i = 0; i < MODULE_ORDER.length; i++) {
      var key = MODULE_ORDER[i];
      var mod = MODULES[key];
      if (mod && mod.collection === collection) return mod.label;
    }
    return '';
  }

  function updateRecordRow(r) {
    return pmosModuleRow(r);
  }

  /* ============================================================
     TASKS VIEW
     ============================================================ */
  function renderTasksView(content) {
    const pid = state.currentProjectId;
    const adapter = window.PmosTaskAdapter;
    const user = window._currentUser || {};
    const visibility = getTaskVisibility(user);

    // Read tasks from both paths using adapter if available, else fallback to records
    var rawTasks = state.records
      .filter(r => (r.collection === 'pmosTasks' || r.collection === 'tasks') && !r.archived && (!pid || r.projectId === pid));

    // Normalize tasks via adapter
    var tasks = rawTasks.map(function (t) {
      return adapter ? adapter.normalizeTask(t) : t;
    }).filter(Boolean);

    // Filter by assignedToUid for non-team-wide roles
    var visibleTasks = tasks.filter(function (t) {
      return visibility === 'all' ? true : canUserSeeTask(t);
    });

    // Separate my tasks vs team tasks for team-wide roles
    var myTasks = visibility === 'all'
      ? tasks.filter(function (t) { return t.assignedToUid === user.uid || t.createdBy === user.uid; })
      : visibleTasks;
    var teamTasks = visibility === 'all'
      ? tasks.filter(function (t) { return t.assignedToUid !== user.uid && t.createdBy !== user.uid; })
      : [];

    // Sort by due date
    visibleTasks.sort(function (a, b) {
      var aDue = a.dueDate || '9999';
      var bDue = b.dueDate || '9999';
      return aDue.localeCompare(bDue) || (b.createdAt || 0) - (a.createdAt || 0);
    });

    const today = todayISO();
    var closedStatuses = ['Done', 'Archived', 'Cancelled', 'completed', 'cancelled', 'archived'];
    var overdue = visibleTasks.filter(function (t) { return t.dueDate && t.dueDate < today && closedStatuses.indexOf(String(t.status || 'open')) === -1; });
    var dueToday = visibleTasks.filter(function (t) { return t.dueDate === today && closedStatuses.indexOf(String(t.status || 'open')) === -1; });
    var open = visibleTasks.filter(function (t) { return closedStatuses.indexOf(String(t.status || 'open')) === -1; });

    const badgeEl = $('pmosTaskBadge');
    if (badgeEl) {
      const count = overdue.length;
      badgeEl.textContent = count;
      badgeEl.classList.toggle('hidden', count === 0);
    }

    /* Build tab headers for team-wide roles */
    var tabHtml = visibility === 'all'
      ? '<div class="pmos-tasks-tabs" role="tablist">' +
        '<button class="pmos-tasks-tab is-active" data-tab="mytasks" role="tab" onclick="switchPmosTaskTab(\'mytasks\')">My Tasks (' + myTasks.length + ')</button>' +
        '<button class="pmos-tasks-tab" data-tab="teamtasks" role="tab" onclick="switchPmosTaskTab(\'teamtasks\')">Team Tasks (' + teamTasks.length + ')</button>' +
        '<button class="pmos-tasks-tab" data-tab="all" role="tab" onclick="switchPmosTaskTab(\'all\')">All (' + visibleTasks.length + ')</button>' +
        '</div>'
      : '';

    content.innerHTML = `
      <div class="pmos-tasks-view">
        <div class="pmos-card-head">
          <h2>Follow-up Tasks</h2>
          <button class="pmos-btn-small" onclick="pmosOpenModule('task')">+ New Task</button>
        </div>
        ${tabHtml}
        <div id="pmosTasksList">
        ${overdue.length ? `<section class="pmos-task-section">
          <h3 class="pmos-task-overdue">&#x26A0;&#xFE0F; Overdue (${overdue.length})</h3>
          ${overdue.slice(0, 10).map(function (t) { return taskRow(t); }).join('')}
        </section>` : ''}
        ${dueToday.length ? `<section class="pmos-task-section">
          <h3>&#x1F4C5; Due Today (${dueToday.length})</h3>
          ${dueToday.slice(0, 10).map(function (t) { return taskRow(t); }).join('')}
        </section>` : ''}
        <section class="pmos-task-section">
          <h3>Open (${open.length})</h3>
          ${open.slice(0, 20).map(function (t) { return taskRow(t); }).join('')}
          ${!open.length && !overdue.length ? window.renderOnboardingState({variant:'inline',icon:'📋',title:'No tasks in this view',desc:'Tasks you create or get assigned will appear here. Tap the + button to create one.',ctaLabel:'Create Task',ctaAction:'pmosShowCreateSheet()'}) : ''}
        </section>
        </div>
      </div>
    `;

    // Store task arrays for tab switching
    content._pmosMyTasks = myTasks;
    content._pmosTeamTasks = teamTasks;
    content._pmosAllTasks = visibleTasks;
  }

  /* ---- Tab switching for team-wide task views ---- */
  function switchPmosTaskTab(tab) {
    var tabs = document.querySelectorAll('.pmos-tasks-tab');
    tabs.forEach(function (b) { b.classList.remove('is-active'); });
    var activeBtn = document.querySelector('.pmos-tasks-tab[data-tab="' + tab + '"]');
    if (activeBtn) activeBtn.classList.add('is-active');

    var content = $('pmosContent');
    if (!content) return;
    var myTasks = content._pmosMyTasks || [];
    var teamTasks = content._pmosTeamTasks || [];
    var allTasks = content._pmosAllTasks || [];

    var selectedTasks = tab === 'mytasks' ? myTasks : tab === 'teamtasks' ? teamTasks : allTasks;
    var today = todayISO();
    var closedStatuses = ['Done', 'Archived', 'Cancelled', 'completed', 'cancelled', 'archived'];

    selectedTasks.sort(function (a, b) {
      var aDue = a.dueDate || '9999';
      var bDue = b.dueDate || '9999';
      return aDue.localeCompare(bDue) || (b.createdAt || 0) - (a.createdAt || 0);
    });

    var overdue = selectedTasks.filter(function (t) { return t.dueDate && t.dueDate < today && closedStatuses.indexOf(String(t.status || 'open')) === -1; });
    var dueToday = selectedTasks.filter(function (t) { return t.dueDate === today && closedStatuses.indexOf(String(t.status || 'open')) === -1; });
    var open = selectedTasks.filter(function (t) { return closedStatuses.indexOf(String(t.status || 'open')) === -1; });

    var listEl = $('pmosTasksList');
    if (!listEl) return;
    listEl.innerHTML =
      (overdue.length ? '<section class="pmos-task-section"><h3 class="pmos-task-overdue">&#x26A0;&#xFE0F; Overdue (' + overdue.length + ')</h3>' + overdue.slice(0, 10).map(function (t) { return taskRow(t); }).join('') + '</section>' : '') +
      (dueToday.length ? '<section class="pmos-task-section"><h3>&#x1F4C5; Due Today (' + dueToday.length + ')</h3>' + dueToday.slice(0, 10).map(function (t) { return taskRow(t); }).join('') + '</section>' : '') +
      '<section class="pmos-task-section"><h3>Open (' + open.length + ')</h3>' +
      (open.slice(0, 20).map(function (t) { return taskRow(t); }).join('') || (!open.length && !overdue.length ? '<p class="empty-hint">No tasks in this view.</p>' : '')) +
      '</section>';
  }
  window.switchPmosTaskTab = switchPmosTaskTab;

  function taskRow(t) {
    // Use normalized field names (fallback to legacy PMOS field names)
    var title = h(t.title || t.task || 'Task').slice(0, 60);
    var assignee = h(t.assignedToName || t.person || t.assignedTo || 'Unassigned');
    var priority = t.priority || 'Normal';
    var priorityLower = String(priority).toLowerCase();
    var today = todayISO();
    var isOverdue = t.dueDate && t.dueDate < today && ['pending', 'open', 'in_progress', 'blocked', 'for_verification', ''].indexOf(String(t.status || 'pending').toLowerCase()) !== -1;

    // Priority indicator: colored left border
    var priorityBorder = priorityLower === 'critical' ? 'pmos-task-critical' :
      priorityLower === 'high' ? 'pmos-task-high' :
      priorityLower === 'low' ? 'pmos-task-low' : '';

    // Status badges
    var status = String(t.status || 'open').toLowerCase();
    var statusBadge = status === 'completed' || status === 'done' ? '<span class="pmos-task-status-badge pmos-task-status-done">&#x2713; Done</span>' :
      status === 'in_progress' ? '<span class="pmos-task-status-badge pmos-task-status-progress">&#x1F504; In Progress</span>' :
      status === 'blocked' ? '<span class="pmos-task-status-badge pmos-task-status-blocked">&#x26D4; Blocked</span>' :
      status === 'for_verification' ? '<span class="pmos-task-status-badge pmos-task-status-review">&#x25C9; For Verification</span>' :
      status === 'cancelled' ? '<span class="pmos-task-status-badge pmos-task-status-cancelled">&#x00D7; Cancelled</span>' :
      isOverdue ? '<span class="pmos-task-status-badge pmos-task-status-overdue">&#x26A0;&#xFE0F; Overdue</span>' :
      status === 'pending' || status === 'open' ? '<span class="pmos-task-status-badge pmos-task-status-open">&#x25CB; Pending</span>' : '';

    var progress = t.progress ? '<div class="pmos-task-progress-wrap"><div class="pmos-task-progress-bar"><i style="width:' + t.progress + '%"></i></div><span class="pmos-task-progress-label">' + t.progress + '%</span></div>' : '';

    var photoCount = t.photos ? (typeof t.photos === 'object' ? Object.keys(t.photos).length : parseInt(t.photos) || 0) : 0;
    var photoBadge = photoCount > 0 ? '<span class="pmos-task-photo-badge">&#x1F4F7; ' + photoCount + '</span>' : '';

    var priorityLabel = String(priority).charAt(0).toUpperCase() + String(priority).slice(1).toLowerCase();

    return '<div class="pmos-task-row ' + priorityBorder + '" data-task-id="' + h(t.id) + '" onclick="pmosOpenTaskDetails(\'' + h(t.id) + '\')">' +
      '<div class="pmos-task-row-left">' +
        '<div class="pmos-task-row-title">' +
          '<strong>' + title + '</strong>' +
          '<span class="pmos-task-priority-dot pmos-priority-' + priorityLower + '" title="' + h(priorityLabel) + '"></span>' +
        '</div>' +
        '<div class="pmos-task-row-meta">' +
          '<span class="pmos-task-assignee">&#x1F464; ' + assignee + '</span>' +
          (t.dueDate ? '<span class="pmos-task-due-badge ' + (isOverdue ? 'pmos-task-due-overdue' : '') + '">&#x1F4C5; ' + h(t.dueDate) + '</span>' : '') +
          photoBadge +
        '</div>' +
        progress +
      '</div>' +
      '<div class="pmos-task-row-right">' +
        statusBadge +
      '</div>' +
    '</div>';
  }

  /* ============================================================
     MORE / SETTINGS VIEW
     ============================================================ */
  function renderMoreView(content) {
    const user = window._currentUser || {};
    const pendingSync = state.photoQueue.filter(item => !['Synced', 'Uploaded'].includes(String(item.metadata?.uploadStatus || 'Queued'))).length;
    const faceEnabled = window.PMOS_CONFIG?.faceAttendanceEnabled;

    content.innerHTML = `
      <div class="pmos-more-view">
        <div class="pmos-card-head">
          <h2>Settings &amp; About</h2>
        </div>

        <section class="pmos-more-section">
          <h3>Account</h3>
          <div class="pmos-more-row"><span>User</span><strong>${h(user.name || '')}</strong></div>
          <div class="pmos-more-row"><span>Role</span><strong>${h(typeof roleLabel === 'function' ? roleLabel(user.role) : user.role || '')}</strong></div>
          <div class="pmos-more-row"><span>Status</span><strong>${h(getConnectionLabel(getConnectionState()))}</strong></div>
          <div class="pmos-more-row"><span>Firebase</span><strong>${FIREBASE_CONNECTED === true ? 'Connected' : FIREBASE_CONNECTED === null ? 'Checking...' : 'Disconnected'}</strong></div>
          <div class="pmos-more-row"><span>Last Sync</span><strong>${h(getLastSyncLabel())}</strong></div>
          <div class="pmos-more-row"><span>Pending Queue</span><strong>${pendingSync}</strong></div>
          <button class="pmos-more-btn" onclick="syncOfflineQueue()">Sync Now</button>
          <button class="pmos-more-btn" onclick="uploadQueuedPhotos(true)">Upload Photos Now</button>
          <button class="pmos-more-btn" onclick="logout()">Sign Out</button>
        </section>

        <section class="pmos-more-section">
          <h3>Photo Upload Queue</h3>
          <div id="pmosPhotoQueueList" class="pmos-list"></div>
          <button class="pmos-more-btn" onclick="uploadQueuedPhotos(true)">Retry All Uploads</button>
        </section>

        <section class="pmos-more-section">
          <h3>About</h3>
          <div class="pmos-more-row"><span>App</span><strong>ACPM PMOS</strong></div>
          <div class="pmos-more-row"><span>Version</span><strong>${h(PMOS_VERSION)}</strong></div>
          <div class="pmos-more-row"><span>Cache</span><strong>${typeof CACHE_VERSION !== 'undefined' ? CACHE_VERSION : 'acpm-pmos-v1'}</strong></div>
          <div class="pmos-more-row"><span>Schema</span><strong>${typeof PMOS_SCHEMA_VERSION !== 'undefined' ? PMOS_SCHEMA_VERSION : '1.0'}</strong></div>
          <div class="pmos-more-row"><span>Face Attendance</span><strong>${faceEnabled ? 'Enabled' : 'Disabled'}</strong></div>
          <div class="pmos-more-row"><span>Photo Storage</span><span class="pmos-drive-badge">&#x1F4C1; Google Drive</span></div>
          ${navigator.onLine && 'beforeinstallprompt' in window ? `<button class="pmos-more-btn" onclick="pmosInstallApp()">Install App</button>` : ''}
          <a class="pmos-more-link" href="dashboard.html">&#x1F3E0; Open ACPM Office</a>
        </section>
      </div>
    `;
  }

  /* ============================================================
     NOTIFICATIONS
     ============================================================ */
  async function createPmosNotification(key, record) {
    try {
      if (typeof createNotificationEvent === 'function') {
        const moduleMap = {
          quick: 'pmos_updates', sitelog: 'pmos_site_log', issue: 'pmos_issues',
          material: 'pmos_materials', task: 'pmos_tasks', meeting: 'pmos_meetings', photo: 'pmos_photos'
        };
        const notifTypes = {
          quick: 'quick_update_submitted', sitelog: 'site_log_submitted', issue: 'issue_submitted',
          material: 'material_request_submitted', task: 'follow_up_created', meeting: 'meeting_notes_created', photo: 'photo_proof_uploaded'
        };
        const notifType = notifTypes[key] || 'pmos_record_submitted';
        const idempotencyKey = typeof pmosNotifIdempotencyKey === 'function'
          ? pmosNotifIdempotencyKey(notifType, record.projectId, record.clientGeneratedId || record.id)
          : `${notifType}:${record.projectId}:${record.id}`;

        await createNotificationEvent({
          projectId: record.projectId,
          module: moduleMap[key] || 'pmos',
          type: notifType,
          payload: {
            message: `${MODULES[key]?.label || 'PMOS'} record created: ${record.note || record.issue || record.item || record.task || record.meetingTitle || record.caption || ''}`,
            projectName: record.projectName,
            idempotencyKey,
            notifyRole: 'pm,apm,boss,owner,admin',
            recordId: record.id
          }
        });
      }
    } catch (e) {
      console.warn('PMOS notification skipped:', e?.message || e);
    }
  }

  /* ============================================================
     RECORD EDIT
     ============================================================ */
  async function editPmosRecord(collection, id, projectId) {
    const records = state.records.filter(r => r.collection === collection && r.id === id && r.projectId === projectId);
    const record = records[0];
    if (!record || !canEditPmosRecord(record)) {
      pmosToast('This record cannot be edited.', 'warn');
      return;
    }
    const key = stateKeyByCollection(collection);
    if (!key) { pmosToast('Unknown module.', 'error'); return; }

    /* Store edit tracking so savePmosModule updates instead of creates */
    state.editingRecord = {
      collection: record.collection,
      id: record.id,
      projectId: record.projectId || projectId,
      sourcePath: record.sourcePath || '',
      sourceType: record.sourceType || 'global'
    };

    pmosOpenModule(key);
    // Pre-fill fields
    if (MODULES[key]) {
      MODULES[key].fields.forEach(([name]) => {
        const el = $(`pmos_${key}_${name}`);
        if (el && record[name] !== undefined && record[name] !== null) {
          el.value = record[name];
        }
      });
    }
    pmosToast('Edit mode: modify and re-save', 'info');
  }

  /* Update existing record instead of creating new */
  async function saveExistingRecord(key, mod, payload, button) {
    const editInfo = state.editingRecord;
    if (!editInfo) return;

    const useProjectPath = editInfo.sourceType === 'project' || editInfo.sourcePath.startsWith('project:');
    const path = useProjectPath && editInfo.projectId
      ? `projects/${editInfo.projectId}/${mod.collection}/${editInfo.id}`
      : `${mod.collection}/${editInfo.id}`;

    await withBusy(button, async () => {
      setSync('Updating...', 'saving');
      const now = Date.now();
      const updates = {
        ...payload,
        updatedAt: now,
        updatedBy: window._currentUser?.uid || '',
        updatedByName: window._currentUser?.name || ''
      };
      try {
        await db.ref(path).update(updates);
        state.editingRecord = null;
        setSync('Record updated.', 'ok');
        pmosToast('Record updated');
        clearPmosForm(key);
        if (typeof pmosAuditLog === 'function') {
          pmosAuditLog('edit', `pmos_${key}`, editInfo.projectId, editInfo.id, `Edited ${mod.label}`);
        }
      } catch (e) {
        if (editInfo.projectId && String(e?.code || '').toLowerCase().includes('permission')) {
          try {
            await db.ref(`projects/${editInfo.projectId}/${mod.collection}/${editInfo.id}`).update(updates);
            state.editingRecord = null;
            setSync('Record updated under project path.', 'ok');
            pmosToast('Record updated');
            clearPmosForm(key);
            return;
          } catch (fbError) {
            console.error('Edit fallback failed:', fbError);
          }
        }
        console.error('Edit failed:', e);
        setSync('Could not update record.', 'error');
        pmosToast('Update failed', 'error');
      }
    });
  }
  window.editPmosRecord = editPmosRecord;

  function stateKeyByCollection(collection) {
    for (const [key, mod] of Object.entries(MODULES)) {
      if (mod.collection === collection) return key;
    }
    return null;
  }

  /* ============================================================
     LISTENERS (preserved dual-path with improved cleanup)
     ============================================================ */
  function detachPmosListeners() {
    state.listeners.forEach(ref => {
      if (ref && typeof ref.off === 'function') ref.off();
    });
    state.listeners = [];
  }

  function notePmosReadFallback(err, scope) {
    const denied = String(err?.code || err?.message || '').toLowerCase().includes('permission');
    if (!denied) { console.warn(`PMOS ${scope} listener skipped:`, err); return; }
    if (scope === 'global') {
      if (state.globalReadDeniedNotified) return;
      state.globalReadDeniedNotified = true;
      setSync('Firebase rules need deployment. Reading project fallback records.', 'saving');
      return;
    }
    if (state.fallbackReadDeniedNotified) return;
    state.fallbackReadDeniedNotified = true;
  }

  function watchPmosRecords() {
    detachPmosListeners();
    state.records = [];

    captureModuleEntries().forEach(([key, mod]) => {
      if (!mod.collection) return;
      /* Skip root-level listener for tasks — they live at projects/{id}/tasks, not root 'tasks' */
      if (mod.collection === 'tasks') return;
      const ref = db.ref(mod.collection).limitToLast(80);
      const sourceKey = `root:${mod.collection}`;
      const callback = snap => {
        state.records = state.records.filter(r => r.sourceKey !== sourceKey);
        snap.forEach(child => {
          const record = child.val() || {};
          if (pmosProjectAllowed(record.projectId)) {
            state.records.push({ ...record, id: record.id || child.key, moduleKey: key, moduleLabel: mod.label, collection: mod.collection, sourceKey });
          }
        });
        refreshContent();
      };
      ref.on('value', callback, err => notePmosReadFallback(err, 'global'));
      state.listeners.push({ ref, callback, type: 'global' });
    });

    state.projects.forEach(project => {
      captureModuleEntries().forEach(([key, mod]) => {
        if (!mod.collection) return;
        const ref = db.ref(`projects/${project.id}/${mod.collection}`).limitToLast(40);
        const sourceKey = `project:${project.id}:${mod.collection}`;
        const callback = snap => {
          state.records = state.records.filter(r => r.sourceKey !== sourceKey);
          snap.forEach(child => {
            const record = child.val() || {};
            if (pmosProjectAllowed(record.projectId || project.id)) {
              state.records.push({
                ...record, id: record.id || child.key, projectId: record.projectId || project.id,
                projectName: record.projectName || project.name || project.id,
                moduleKey: key, moduleLabel: mod.label, collection: mod.collection, sourceKey
              });
            }
          });
          refreshContent();
        };
        ref.on('value', callback, err => notePmosReadFallback(err, 'project fallback'));
        state.listeners.push({ ref, callback, type: 'project' });
      });

      /* ---- Also listen to legacy pmosTasks path for backward compatibility ---- */
      if (project.id) {
        var legacyTaskKey = 'pmosTasks';
        var legacySourceKey = 'project:' + project.id + ':pmosTasks';
        var legacyRef = db.ref('projects/' + project.id + '/pmosTasks').limitToLast(40);
        var legacyCb = function (snap) {
          state.records = state.records.filter(function (r) { return r.sourceKey !== legacySourceKey; });
          snap.forEach(function (child) {
            var record = child.val() || {};
            if (pmosProjectAllowed(record.projectId || project.id)) {
              state.records.push({
                ...record, id: record.id || child.key, projectId: record.projectId || project.id,
                projectName: record.projectName || project.name || project.id,
                moduleKey: 'task', moduleLabel: 'Follow-up Tasks', collection: 'pmosTasks', sourceKey: legacySourceKey
              });
            }
          });
          refreshContent();
        };
        legacyRef.on('value', legacyCb, function () { /* silent */ });
        state.listeners.push({ ref: legacyRef, callback: legacyCb, type: 'project' });
      }
    });
  }

  function refreshContent() {
    const tab = state.activeModule || 'home';
    if (tab === 'home') {
      const content = $('pmosContent');
      if (content) content.innerHTML = renderHome();
    } else if (tab === 'updates') {
      renderUpdatesView($('pmosContent'));
    } else if (tab === 'tasks') {
      renderTasksView($('pmosContent'));
    }
    renderPhotoQueue();
  }

  function renderPendingSyncCount() {
    const pending = state.photoQueue.filter(item => !['Synced', 'Uploaded'].includes(String(item.metadata?.uploadStatus || 'Queued'))).length;
    const badge = $('pmosPendingSyncBadge');
    if (badge) badge.textContent = `${pending} pending sync`;
  }

  /* ============================================================
     RETRY PHOTO
     ============================================================ */
  async function pmosRetryPhoto(localId) {
    const item = await idbGetPhoto(localId);
    if (!item) { await loadPhotoQueue(); return; }
    await updateQueuedPhoto(item, { uploadStatus: 'Queued', uploadProgress: 0, errorMessage: '' });
    await uploadQueuedPhotos(true);
  }
  window.pmosRetryPhoto = pmosRetryPhoto;
  window.uploadQueuedPhotos = uploadQueuedPhotos;
  window.syncOfflineQueue = syncOfflineQueue;

  /* ============================================================
     INIT
     ============================================================ */
  async function initLine17Pmos() {
    if (state.initialized) return;
    state.initialized = true;
    try {
      state.projects = await loadPmosProjects();
      renderPmosShell();
      if (state.currentProjectId) localStorage.setItem(LAST_PROJECT_KEY, state.currentProjectId);
      watchPmosRecords();
      await loadPhotoQueue();

      /* Attach Firebase connection listener (distinct from navigator.onLine) */
      attachFirebaseConnectionListener();

      /* Set up online/offline event handlers */
      window.addEventListener('online', () => {
        FIREBASE_CONNECTED = null;  /* Will be updated by .info/connected listener */
        CONNECTION_OVERRIDE = null;
        updateConnectionStatus();
        uploadQueuedPhotos(true);
        syncOfflineQueue();
        refreshContent();
        if (typeof pmosOnlineIndicator === 'function') pmosOnlineIndicator();
      });
      window.addEventListener('offline', () => {
        FIREBASE_CONNECTED = false;
        CONNECTION_OVERRIDE = null;
        updateConnectionStatus();
        refreshContent();
        if (typeof pmosOnlineIndicator === 'function') pmosOnlineIndicator();
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) {
          uploadQueuedPhotos(true);
          syncOfflineQueue();
        }
      });

      updateConnectionStatus();
      pmosShowNav('home');
      if (navigator.onLine) {
        uploadQueuedPhotos(true);
        syncOfflineQueue();
      }
      if (typeof pmosOnlineIndicator === 'function') pmosOnlineIndicator();
      /* Handle deep-link from notifications */
      setTimeout(handlePmosDeepLink, 1500);
    } catch (e) {
      console.error('PMOS init failed:', e);
      const app = $('pmosApp');
      if (app) app.innerHTML = `<div class="pmos-loading-card">Could not load PMOS. ${h(e.message || e.code || '')}</div>`;
    }
  }

  window.initLine17Pmos = initLine17Pmos;
})();
