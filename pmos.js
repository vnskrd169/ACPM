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
  
  const PMOS_DRIVE_UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbxNQ1PunSoV2gCpdfrHs10D7kNC5YUnIyq0IHmFsI4MrDq3wHsJZaCiEcxP2RkHNA5P/exec';
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
      collection: 'pmosTasks',
      icon: '&#x2705;',
      fields: [
        ['task', 'Task', 'textarea'],
        ['person', 'Person', 'text'],
        ['company', 'Company Optional', 'text'],
        ['dueDate', 'Due Date', 'date'],
        ['priority', 'Priority', 'select', PRIORITIES],
        ['status', 'Status', 'select', ['Open', 'In Progress', 'Waiting', 'Done', 'Cancelled', 'Archived']],
        ['remarks', 'Remarks', 'textarea']
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

  function setSync(message, type) {
    const el = $('pmosSyncStatus');
    if (!el) return;
    el.className = `pmos-sync pmos-sync-${type || 'ok'}`;
    el.textContent = message;
    if (typeof pmosSyncStatus === 'function') pmosSyncStatus(message, type || 'idle');
  }

  /* ============================================================
     RENDER — HOME SCREEN
     ============================================================ */
  function renderHome() {
    const project = localProject();
    const records = state.records.filter(r => !r.archived && (!project || r.projectId === project.id));
    const today = todayISO();
    
    const pendingIssues = records.filter(r => r.collection === 'pmosIssues' && !['Closed', 'Archived'].includes(String(r.status || 'Open')));
    const overdueTasks = records.filter(r => r.collection === 'pmosTasks' && r.dueDate && r.dueDate < today && !['Done', 'Archived'].includes(String(r.status || 'Open')));
    const pendingMaterials = records.filter(r => r.collection === 'pmosMaterialRequests' && !['Delivered', 'Cancelled', 'Archived'].includes(String(r.status || 'Submitted')));
    const pendingPhotos = state.photoQueue.filter(item => !['Synced', 'Uploaded'].includes(String(item.metadata?.uploadStatus || 'Queued'))).length;
    const pendingSync = pendingPhotos;

    const name = window._currentUser?.name || 'User';
    const projectName = project?.name || '—';
    const online = navigator.onLine;

    return `
      <section class="pmos-home">
        <div class="pmos-home-header">
          <div>
            <div class="pmos-greeting">Hello, ${h(name)}</div>
            <div class="pmos-home-project">${h(projectName)}</div>
          </div>
          <div class="pmos-home-actions">
            <span class="pmos-home-status ${online ? 'pmos-online' : 'pmos-offline'}">
              ${online ? '&#x1F30D; Online' : '&#x26A0; Offline'}
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

  function renderHomeRecent(records) {
    if (!records.length) return '<p class="empty-hint">No recent updates. Tap a quick action above to get started.</p>';
    return records.map(r => {
      const label = r.note || r.issue || r.item || r.task || r.meetingTitle || r.caption || r.accomplishment || 'Record';
      const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-PH') : '';
      return `<div class="pmos-home-recent-item">
        <span class="pmos-recent-icon">${moduleIcon(r.collection)}</span>
        <div>
          <strong>${h(label).slice(0, 60)}</strong>
          <span>${h(r.moduleLabel || '')} &middot; ${date}</span>
        </div>
        <span class="badge badge-${statusBadgeClass(r.status || 'New')}">${h(r.status || 'New')}</span>
      </div>`;
    }).join('');
  }

  function moduleIcon(collection) {
    const icons = {
      pmosUpdates: '&#x26A1;', pmosSiteLogs: '&#x1F4CB;', pmosIssues: '&#x26A0;',
      pmosMaterialRequests: '&#x1F4E6;', pmosTasks: '&#x2705;', pmosPhotoLogs: '&#x1F4F7;', pmosMeetingNotes: '&#x1F91D;'
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
        <div class="pmos-loading-card">Loading...</div>
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
      task: ['task', 'person', 'dueDate'],
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
    const payload = readModulePayload(key);
    
    /* --- EDIT MODE: update existing record instead of creating new --- */
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
      const ref = db.ref(mod.collection).push();
      const now = Date.now();
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
          /* Check if a record with this clientGeneratedId already exists to prevent duplicates */
          const existingCheck = await db.ref(item.collection)
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
          const ref = db.ref(item.collection).push();
          const record = {
            ...item.payload,
            id: ref.key,
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
          await ref.set(record);
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
      el.innerHTML = '<p class="empty-hint">No pending photo uploads.</p>';
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
        /* Try Firebase Storage first */
        if (firebase.storage && window.PMOS_CONFIG?.photoProvider !== 'google-drive') {
          try {
            const result = await uploadToFirebaseStorage(current, storagePath, thumbnailStoragePath);
            photoUrl = result.photoUrl;
            thumbnailUrl = result.thumbnailUrl;
          } catch (storageError) {
            console.warn('Firebase Storage upload failed, trying Drive:', storageError);
            /* Fallback to Drive */
            const uploaded = await uploadPhotoToDrive(meta, current.imageBlob, current.thumbnailBlob, storagePath, thumbnailStoragePath, pct => {
              patchPhotoQueueView(current.localId, { uploadProgress: pct });
            });
            photoUrl = uploaded.photoUrl;
            thumbnailUrl = uploaded.thumbnailUrl;
          }
        } else {
          const uploaded = await uploadPhotoToDrive(meta, current.imageBlob, current.thumbnailBlob, storagePath, thumbnailStoragePath, pct => {
            patchPhotoQueueView(current.localId, { uploadProgress: pct });
          });
          photoUrl = uploaded.photoUrl;
          thumbnailUrl = uploaded.thumbnailUrl;
        }

        current = await updateQueuedPhoto(current, {
          photoUrl, thumbnailUrl, storagePath, thumbnailStoragePath, uploadProgress: 96
        });
      }

      const finalRef = db.ref(MODULES.photo.collection).push();
      const uploadedAt = Date.now();
      const uploadedMeta = current.metadata || {};
      const finalRecord = {
        id: finalRef.key, projectId: meta.projectId, projectName: meta.projectName,
        caption: meta.caption, location: meta.location, category: meta.category,
        photoUrl, thumbnailUrl, storagePath, thumbnailStoragePath,
        storageProvider: photoUrl?.includes('drive.google.com') ? 'Google Drive' : 'Firebase Storage',
        originalFileName: meta.originalFileName, compressedSize: meta.compressedSize || current.imageBlob?.size || 0,
        uploadStatus: 'Synced', source: PMOS_SOURCE,
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
      setSync('Photo uploaded.', 'ok');
      pmosToast('Photo uploaded');
    } catch (e) {
      console.error('Photo upload failed:', e);
      await updateQueuedPhoto(current, { uploadStatus: 'Failed', uploadProgress: 0, errorMessage: e.message || e.code || 'Upload failed' });
      setSync('Photo upload failed. Local copy kept.', 'error');
    }
  }

  async function uploadToFirebaseStorage(item, storagePath, thumbnailStoragePath) {
    const storage = firebase.storage?.();
    if (!storage) throw new Error('Firebase Storage SDK not loaded');
    const meta = item.metadata || {};
    const uploadFile = (ref, blob, onProgress) => {
      return new Promise((resolve, reject) => {
        const task = ref.put(blob, { contentType: 'image/jpeg' });
        const timeout = setTimeout(() => { try { task.cancel(); } catch {} reject(new Error('Storage upload timed out.')); }, 60000);
        task.on(firebase.storage.TaskEvent.STATE_CHANGED,
          snap => { if (snap.totalBytes) onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)); },
          err => { clearTimeout(timeout); reject(err); },
          async () => { clearTimeout(timeout); resolve({ ref, url: await ref.getDownloadURL() }); }
        );
      });
    };

    const [mainResult, thumbResult] = await Promise.all([
      uploadFile(storage.ref(storagePath), item.imageBlob, () => {}),
      thumbnailStoragePath ? uploadFile(storage.ref(thumbnailStoragePath), item.thumbnailBlob, () => {}) : null
    ]);
    return { photoUrl: mainResult.url, thumbnailUrl: thumbResult?.url || '' };
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

  function uploadBlobResumable(path, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const storage = firebase.storage?.();
      if (!storage) { reject(new Error('Firebase Storage SDK not loaded.')); return; }
      const ref = storage.ref(path);
      const task = ref.put(blob, { contentType: 'image/jpeg' });
      const timeout = setTimeout(() => { try { task.cancel(); } catch {} reject(new Error('Storage upload timed out.')); }, 45000);
      task.on(firebase.storage.TaskEvent.STATE_CHANGED,
        snap => { if (snap.totalBytes) onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)); },
        err => { clearTimeout(timeout); reject(err); },
        async () => { clearTimeout(timeout); try { resolve({ ref, url: await ref.getDownloadURL() }); } catch (e) { reject(e); } }
      );
    });
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
    if (!response.ok || data.ok === false) {
      const driveError = String(data.error || '');
      if (driveError.includes('getFolderById')) throw new Error('Drive folder not accessible.');
      if (/access|denied|authorization|permission/i.test(driveError)) throw new Error('Drive upload access denied.');
      throw new Error(driveError || `Drive upload failed with HTTP ${response.status}`);
    }
    if (!data.photoUrl || !data.thumbnailUrl) throw new Error('Drive upload did not return photo links.');
    const thumbnailUrl = data.thumbnailFileId ? driveThumbnailUrl(data.thumbnailFileId, 800) : data.thumbnailUrl;
    onProgress(96);
    return { photoUrl: data.photoUrl, thumbnailUrl, storagePath: `drive://${data.photoFileId || fileName}`, thumbnailStoragePath: `drive://${data.thumbnailFileId || thumbnailFileName}`, photoFileId: data.photoFileId || '', thumbnailFileId: data.thumbnailFileId || '', storageProvider: 'Google Drive' };
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
        `).join('') : '<p class="empty-hint">No records yet. Tap Create to add your first field record.</p>'}
      </div>
    `;
  }

  function updateRecordRow(r) {
    const title = r.note || r.issue || r.item || r.task || r.meetingTitle || r.caption || r.accomplishment || 'Record';
    const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-PH') : '';
    return `<div class="pmos-update-row" ${canEditPmosRecord(r) ? `onclick="editPmosRecord('${h(r.collection)}','${h(r.id)}','${h(r.projectId || '')}')"` : ''}>
      <div class="pmos-update-title">${h(title).slice(0, 80)}</div>
      <div class="pmos-update-meta">
        <span class="badge badge-${statusBadgeClass(r.status || 'New')}">${h(r.status || 'New')}</span>
        ${r.priority ? `<span class="badge badge-${r.priority === 'Critical' || r.priority === 'High' ? 'red' : r.priority === 'Low' ? 'amber' : 'purple'}">${h(r.priority)}</span>` : ''}
        <span>${date}</span>
        ${r.draft ? '<span class="badge badge-amber">Draft</span>' : ''}
        ${r.archived ? '<span class="badge badge-dim">Archived</span>' : ''}
      </div>
      ${canEditPmosRecord(r) ? '<div class="pmos-update-edit-hint">Tap to edit</div>' : ''}
    </div>`;
  }

  /* ============================================================
     TASKS VIEW
     ============================================================ */
  function renderTasksView(content) {
    const pid = state.currentProjectId;
    const tasks = state.records
      .filter(r => r.collection === 'pmosTasks' && !r.archived && (!pid || r.projectId === pid))
      .sort((a, b) => {
        const aDue = a.dueDate || '9999';
        const bDue = b.dueDate || '9999';
        return aDue.localeCompare(bDue) || (b.createdAt || 0) - (a.createdAt || 0);
      });
    const today = todayISO();
    const overdue = tasks.filter(t => t.dueDate && t.dueDate < today && !['Done', 'Archived'].includes(String(t.status || 'Open')));
    const dueToday = tasks.filter(t => t.dueDate === today && !['Done', 'Archived'].includes(String(t.status || 'Open')));
    const open = tasks.filter(t => !['Done', 'Archived'].includes(String(t.status || 'Open')));

    const badgeEl = $('pmosTaskBadge');
    if (badgeEl) {
      const count = overdue.length;
      badgeEl.textContent = count;
      badgeEl.classList.toggle('hidden', count === 0);
    }

    content.innerHTML = `
      <div class="pmos-tasks-view">
        <div class="pmos-card-head">
          <h2>Follow-up Tasks</h2>
          <button class="pmos-btn-small" onclick="pmosOpenModule('task')">+ New Task</button>
        </div>
        ${overdue.length ? `<section class="pmos-task-section">
          <h3 class="pmos-task-overdue">&#x26A0;&#xFE0F; Overdue (${overdue.length})</h3>
          ${overdue.slice(0, 10).map(t => taskRow(t)).join('')}
        </section>` : ''}
        ${dueToday.length ? `<section class="pmos-task-section">
          <h3>&#x1F4C5; Due Today (${dueToday.length})</h3>
          ${dueToday.slice(0, 10).map(t => taskRow(t)).join('')}
        </section>` : ''}
        <section class="pmos-task-section">
          <h3>Open (${open.length})</h3>
          ${open.slice(0, 20).map(t => taskRow(t)).join('')}
          ${!open.length && !overdue.length ? '<p class="empty-hint">No tasks. Create your first follow-up.</p>' : ''}
        </section>
      </div>
    `;
  }

  function taskRow(t) {
    return `<div class="pmos-task-row">
      <div>
        <strong>${h(t.task || 'Task').slice(0, 60)}</strong>
        <span>${h(t.person || 'Unassigned')}${t.dueDate ? ` - Due: ${t.dueDate}` : ''}</span>
      </div>
      <span class="badge badge-${t.priority === 'Critical' || t.priority === 'High' ? 'red' : 'purple'}">${h(t.priority || 'Normal')}</span>
    </div>`;
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
          <div class="pmos-more-row"><span>Status</span><strong>${navigator.onLine ? 'Online' : 'Offline'}</strong></div>
          <div class="pmos-more-row"><span>Last Sync</span><strong>${new Date().toLocaleTimeString('en-PH')}</strong></div>
          <div class="pmos-more-row"><span>Pending Queue</span><strong>${pendingSync}</strong></div>
          <button class="pmos-more-btn" onclick="syncOfflineQueue()">Sync Now</button>
          <button class="pmos-more-btn" onclick="uploadQueuedPhotos(true)">Upload Photos Now</button>
          <button class="pmos-more-btn" onclick="logout()">Sign Out</button>
        </section>

        <section class="pmos-more-section">
          <h3>Photo Upload Queue</h3>
          <div id="pmosPhotoQueueList" class="pmos-list"><p class="empty-hint">No pending photo uploads.</p></div>
          <button class="pmos-more-btn" onclick="uploadQueuedPhotos(true)">Retry All Uploads</button>
        </section>

        <section class="pmos-more-section">
          <h3>About</h3>
          <div class="pmos-more-row"><span>App</span><strong>ACPM PMOS</strong></div>
          <div class="pmos-more-row"><span>Version</span><strong>${h(PMOS_VERSION)}</strong></div>
          <div class="pmos-more-row"><span>Cache</span><strong>${typeof CACHE_VERSION !== 'undefined' ? CACHE_VERSION : 'acpm-pmos-v1'}</strong></div>
          <div class="pmos-more-row"><span>Schema</span><strong>${typeof PMOS_SCHEMA_VERSION !== 'undefined' ? PMOS_SCHEMA_VERSION : '1.0'}</strong></div>
          <div class="pmos-more-row"><span>Face Attendance</span><strong>${faceEnabled ? 'Enabled' : 'Disabled'}</strong></div>
          <div class="pmos-more-row"><span>Photo Provider</span><strong>${window.PMOS_CONFIG?.photoProvider === 'firebase-storage' ? 'Firebase Storage' : 'Google Drive'}</strong></div>
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
      
      /* Set up online/offline event handlers */
      window.addEventListener('online', () => {
        uploadQueuedPhotos(true);
        syncOfflineQueue();
        refreshContent();
        if (typeof pmosOnlineIndicator === 'function') pmosOnlineIndicator();
      });
      window.addEventListener('offline', () => {
        if (typeof pmosOnlineIndicator === 'function') pmosOnlineIndicator();
        refreshContent();
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) {
          uploadQueuedPhotos(true);
          syncOfflineQueue();
        }
      });

      setSync(state.projects.length ? 'Ready to capture field updates.' : 'No active projects assigned.', state.projects.length ? 'ok' : 'error');
      pmosShowNav('home');
      if (navigator.onLine) {
        uploadQueuedPhotos(true);
        syncOfflineQueue();
      }
      if (typeof pmosOnlineIndicator === 'function') pmosOnlineIndicator();
    } catch (e) {
      console.error('PMOS init failed:', e);
      const app = $('pmosApp');
      if (app) app.innerHTML = `<div class="pmos-loading-card">Could not load PMOS. ${h(e.message || e.code || '')}</div>`;
    }
  }

  window.initLine17Pmos = initLine17Pmos;
})();
