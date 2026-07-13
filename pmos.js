(function () {
  const LAST_PROJECT_KEY = 'line17_pmos_last_project';
  const PMOS_SOURCE = 'Line17 PMOS';
  const GENERAL_STATUSES = ['New', 'Reviewed', 'In Progress', 'Waiting', 'Done', 'Archived'];
  const PRIORITIES = ['Normal', 'High', 'Critical', 'Low'];
  const PHOTO_CATEGORIES = ['Progress', 'Issue', 'Delivery', 'Safety', 'Quality', 'Before', 'After'];
  const PHOTO_DB_NAME = 'line17_pmos_photo_queue';
  const PHOTO_DB_VERSION = 1;
  const PHOTO_STORE = 'photoQueue';
  const PMOS_DRIVE_UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbxNQ1PunSoV2gCpdfrHs10D7kNC5YUnIyq0IHmFsI4MrDq3wHsJZaCiEcxP2RkHNA5P/exec';
  const MODULE_ORDER = ['quick', 'sitelog', 'photo', 'issue', 'material', 'task'];

  const MODULES = {
    quick: {
      label: 'Quick Update',
      collection: 'pmosUpdates',
      fields: [
        ['category', 'Category', 'select', ['General', 'Schedule', 'Materials', 'Labor', 'Client', 'Safety', 'Quality']],
        ['note', 'Note', 'textarea'],
        ['priority', 'Priority', 'select', PRIORITIES],
        ['status', 'Status', 'select', GENERAL_STATUSES],
        ['dueDate', 'Due Date', 'date']
      ]
    },
    sitelog: {
      label: 'Site Log',
      collection: 'pmosSiteLogs',
      fields: [
        ['date', 'Date', 'date'],
        ['weather', 'Weather', 'text'],
        ['manpowerCount', 'Manpower Count', 'number'],
        ['accomplishment', 'Accomplishment', 'textarea'],
        ['remarks', 'Remarks', 'textarea']
      ]
    },
    issue: {
      label: 'Punchlist / Issue',
      collection: 'pmosIssues',
      fields: [
        ['location', 'Location', 'text'],
        ['issue', 'Issue', 'textarea'],
        ['assignedTo', 'Assigned To', 'text'],
        ['priority', 'Priority', 'select', PRIORITIES],
        ['status', 'Status', 'select', GENERAL_STATUSES],
        ['dueDate', 'Due Date', 'date'],
        ['photoUrl', 'Photo URL Optional', 'url']
      ]
    },
    material: {
      label: 'Material Request',
      collection: 'pmosMaterialRequests',
      fields: [
        ['item', 'Item', 'text'],
        ['quantity', 'Quantity', 'number'],
        ['unit', 'Unit', 'text'],
        ['neededDate', 'Needed Date', 'date'],
        ['purpose', 'Purpose', 'textarea'],
        ['status', 'Status', 'select', ['Pending', 'Approved', 'Bought', 'Delivered', 'Cancelled']]
      ]
    },
    task: {
      label: 'Follow-up Task',
      collection: 'pmosTasks',
      fields: [
        ['task', 'Task', 'textarea'],
        ['person', 'Person', 'text'],
        ['company', 'Company Optional', 'text'],
        ['dueDate', 'Due Date', 'date'],
        ['priority', 'Priority', 'select', PRIORITIES],
        ['status', 'Status', 'select', GENERAL_STATUSES]
      ]
    },
    photo: {
      label: 'Site Camera',
      collection: 'pmosPhotoLogs',
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
    photoFile: null,
    photoPreviewUrl: '',
    photoQueue: [],
    photoQueueUrls: [],
    photoUploadActive: false,
    globalReadDeniedNotified: false,
    fallbackReadDeniedNotified: false
  };

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

  function pmosProjectAllowed(pid) {
    const user = window._currentUser || {};
    if (!pid) return false;
    if (typeof isBoss === 'function' && isBoss(user.role)) return true;
    return projectList(user.projects).includes(pid) || projectList(user.bossOf).includes(pid);
  }

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
      snaps.forEach(([id, p]) => {
        if (p && (p.status || 'active') === 'active') projects.push({ ...p, id });
      });
    }
    return projects.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  function currentProject() {
    return state.projects.find(p => p.id === state.currentProjectId) || null;
  }

  function setSync(message, type = 'ok') {
    const el = $('pmosSyncStatus');
    if (!el) return;
    el.className = `pmos-sync pmos-sync-${type}`;
    el.textContent = message;
  }

  function activeModuleEntries() {
    return MODULE_ORDER.map(key => [key, MODULES[key]]).filter(([, mod]) => !!mod);
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '0 KB';
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function safePhotoName(name = 'site-photo.jpg') {
    const base = String(name || 'site-photo')
      .replace(/\.[a-z0-9]+$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'site-photo';
    return `${base}.jpg`;
  }

  function photoDateFolder(ts = Date.now()) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  function openPhotoDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not available on this device.'));
        return;
      }
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

  async function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed.'));
    });
  }

  async function idbGetAllPhotos() {
    const { dbi, store } = await photoDbStore();
    try {
      return await idbRequest(store.getAll());
    } finally {
      dbi.close();
    }
  }

  async function idbGetPhoto(localId) {
    const { dbi, store } = await photoDbStore();
    try {
      return await idbRequest(store.get(localId));
    } finally {
      dbi.close();
    }
  }

  async function idbPutPhoto(record) {
    const { dbi, tx, store } = await photoDbStore('readwrite');
    try {
      await idbRequest(store.put(record));
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save local photo queue.'));
      });
    } finally {
      dbi.close();
    }
  }

  async function idbDeletePhoto(localId) {
    const { dbi, tx, store } = await photoDbStore('readwrite');
    try {
      await idbRequest(store.delete(localId));
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not delete uploaded photo queue item.'));
      });
    } finally {
      dbi.close();
    }
  }

  function imageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read selected image.'));
      };
      img.src = url;
    });
  }

  function canvasToJpegBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Could not compress photo.'));
      }, 'image/jpeg', quality);
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

  async function loadPhotoQueue() {
    try {
      const rows = await idbGetAllPhotos();
      const now = Date.now();
      for (const item of rows) {
        const meta = item.metadata || {};
        if (meta.uploadStatus === 'Uploading' && (now - (meta.updatedAt || meta.createdAt || 0)) > 30000) {
          item.metadata = {
            ...meta,
            uploadStatus: 'Failed',
            uploadProgress: 0,
            errorMessage: 'Upload was interrupted. Check connection/CORS, then retry.',
            updatedAt: now
          };
          await idbPutPhoto(item);
        }
      }
      state.photoQueue = rows.sort((a, b) => (b.metadata?.createdAt || 0) - (a.metadata?.createdAt || 0));
      renderPhotoQueue();
    } catch (e) {
      console.error('PMOS photo queue load failed:', e);
      setHTML('pmosPhotoQueueList', '<p class="empty-hint">Could not read local photo queue on this device.</p>');
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
          <span>${h(meta.projectName || meta.projectId || '')} - ${h(meta.location || 'No location')} - ${h(photoDateFolder(meta.createdAt))}</span>
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

  function uploadBlobResumable(path, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const storage = firebase.storage?.();
      if (!storage) {
        reject(new Error('Firebase Storage SDK is not loaded.'));
        return;
      }
      const ref = storage.ref(path);
      const uploadBytesResumable = (storageRef, fileBlob, metadata) => storageRef.put(fileBlob, metadata);
      const task = uploadBytesResumable(ref, blob, { contentType: 'image/jpeg' });
      const timeout = setTimeout(() => {
        try { task.cancel(); } catch (_) {}
        reject(new Error('Storage upload did not start. Check Firebase Storage CORS/rules for this app origin.'));
      }, 45000);
      task.on(firebase.storage.TaskEvent.STATE_CHANGED, snap => {
        const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
        onProgress(pct);
      }, err => {
        clearTimeout(timeout);
        reject(err);
      }, async () => {
        clearTimeout(timeout);
        try {
          resolve({ ref, url: await ref.getDownloadURL() });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(reader.error || new Error('Could not read photo for Drive upload.'));
      reader.readAsDataURL(blob);
    });
  }

  function driveThumbnailUrl(fileId, size = 800) {
    return fileId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${size}` : '';
  }

  async function uploadPhotoToDrive(meta, imageBlob, thumbnailBlob, storagePath, thumbnailStoragePath, onProgress) {
    if (!PMOS_DRIVE_UPLOAD_URL) throw new Error('PMOS Drive upload URL is not configured.');
    onProgress(8);
    const [photoBase64, thumbnailBase64] = await Promise.all([
      blobToBase64(imageBlob),
      blobToBase64(thumbnailBlob)
    ]);
    onProgress(35);
    const fileName = storagePath.split('/').pop() || safePhotoName(meta.originalFileName);
    const thumbnailFileName = thumbnailStoragePath.split('/').pop() || `thumb_${fileName}`;
    const response = await fetch(PMOS_DRIVE_UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        localId: meta.localId,
        projectId: meta.projectId,
        projectName: meta.projectName,
        projectFolderName: meta.projectName || meta.projectId,
        date: photoDateFolder(meta.createdAt || Date.now()),
        fileName,
        thumbnailFileName,
        photoMimeType: 'image/jpeg',
        thumbnailMimeType: 'image/jpeg',
        photoBase64,
        thumbnailBase64
      })
    });
    onProgress(82);
    const text = await response.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Drive upload returned an invalid response: ${text.slice(0, 120)}`);
    }
    if (!response.ok || data.ok === false) {
      const driveError = String(data.error || '');
      if (driveError.includes('getFolderById')) {
        throw new Error('Drive folder is not accessible. Check Apps Script folder ID and deploy it using the Drive owner account.');
      }
      if (/access|denied|tinanggihan|authorization|permission/i.test(driveError)) {
        throw new Error('Drive upload access denied. In Apps Script deployment, set Execute as: Me and Who has access: Anyone with the link, then deploy a new version.');
      }
      throw new Error(driveError || `Drive upload failed with HTTP ${response.status}`);
    }
    if (!data.photoUrl || !data.thumbnailUrl) {
      throw new Error('Drive upload did not return photo links.');
    }
    const thumbnailUrl = data.thumbnailFileId ? driveThumbnailUrl(data.thumbnailFileId, 800) : data.thumbnailUrl;
    onProgress(96);
    return {
      photoUrl: data.photoUrl,
      thumbnailUrl,
      storagePath: data.storagePath || `drive://${data.photoFileId || fileName}`,
      thumbnailStoragePath: data.thumbnailStoragePath || `drive://${data.thumbnailFileId || thumbnailFileName}`,
      photoFileId: data.photoFileId || '',
      thumbnailFileId: data.thumbnailFileId || '',
      storageProvider: 'Google Drive'
    };
  }

  function moduleButton(key, mod) {
    return `<button class="pmos-action" type="button" data-pmos-open="${key}">
      <span>${h(mod.label)}</span><small>${h(mod.collection.replace('pmos', ''))}</small>
    </button>`;
  }

  function fieldControl(moduleKey, field) {
    const [name, label, type, options] = field;
    const id = `pmos_${moduleKey}_${name}`;
    if (type === 'textarea') {
      return `<label class="pmos-field"><span>${h(label)}</span><textarea id="${id}" rows="4" placeholder="${h(label)}"></textarea></label>`;
    }
    if (type === 'select') {
      return `<label class="pmos-field"><span>${h(label)}</span><select id="${id}">
        ${(options || []).map(opt => `<option value="${h(opt)}">${h(opt)}</option>`).join('')}
      </select></label>`;
    }
    return `<label class="pmos-field"><span>${h(label)}</span><input id="${id}" type="${type}" placeholder="${h(label)}" ${type === 'number' ? 'inputmode="decimal"' : ''}></label>`;
  }

  function photoForm(mod) {
    return `<section id="pmosForm_photo" class="pmos-form-card hidden">
      <div class="pmos-card-head">
        <div><div class="pmos-eyebrow">Field Capture</div><h2>${h(mod.label)}</h2></div>
      </div>
      <form data-pmos-form="photo">
        <div class="pmos-photo-capture">
          <input id="pmos_photo_camera" type="file" accept="image/*" capture="environment" class="pmos-file-input">
          <input id="pmos_photo_picker" type="file" accept="image/*" class="pmos-file-input">
          <div class="pmos-photo-buttons">
            <button class="pmos-capture-btn" type="button" id="pmosTakePhotoBtn">Take Photo</button>
            <button class="pmos-capture-btn" type="button" id="pmosChoosePhotoBtn">Choose Photo</button>
          </div>
          <div id="pmosPhotoPreviewWrap" class="pmos-photo-preview hidden">
            <img id="pmosPhotoPreview" alt="Selected site photo preview">
            <div id="pmosPhotoSize" class="pmos-photo-size"></div>
          </div>
        </div>
        <div class="pmos-form-grid">
          ${mod.fields.map(f => fieldControl('photo', f)).join('')}
        </div>
        <button class="pmos-save" type="submit">Save Locally / Save & Upload</button>
      </form>
    </section>`;
  }

  function moduleForm(key, mod) {
    if (key === 'photo') return photoForm(mod);
    return `<section id="pmosForm_${key}" class="pmos-form-card ${key === 'quick' ? '' : 'hidden'}">
      <div class="pmos-card-head">
        <div><div class="pmos-eyebrow">Field Capture</div><h2>${h(mod.label)}</h2></div>
      </div>
      <form data-pmos-form="${key}">
        <div class="pmos-form-grid">
          ${mod.fields.map(f => fieldControl(key, f)).join('')}
        </div>
        <button class="pmos-save" type="submit">Save ${h(mod.label)}</button>
      </form>
    </section>`;
  }

  function renderPmosShell() {
    const app = $('pmosApp');
    if (!app) return;
    app.innerHTML = `
      <header class="pmos-top">
        <div>
          <div class="pmos-brand">Line17 PMOS</div>
          <div class="pmos-sub">Field input for ACPM</div>
        </div>
        <button class="pmos-logout" type="button" onclick="logout()">Sign out</button>
      </header>

      <section class="pmos-project-card">
        <label class="pmos-field">
          <span>Current Project</span>
          <select id="pmosProjectSelect"></select>
        </label>
        <div id="pmosSyncStatus" class="pmos-sync pmos-sync-ok">Ready</div>
      </section>

      <section class="pmos-today">
        <div class="pmos-card-head">
          <div><div class="pmos-eyebrow">Today</div><h1>Field capture dashboard</h1></div>
          <div id="pmosPendingSyncBadge" class="pmos-sync-count">0 pending sync</div>
          <a class="pmos-open-acpm" href="dashboard.html">ACPM</a>
        </div>
        <div id="pmosPendingList" class="pmos-list"><p class="empty-hint">No pending items due today.</p></div>
      </section>

      <section class="pmos-quick-actions">
        ${activeModuleEntries().map(([key, mod]) => moduleButton(key, mod)).join('')}
      </section>

      <div id="pmosForms">
        ${activeModuleEntries().map(([key, mod]) => moduleForm(key, mod)).join('')}
      </div>

      <section class="pmos-today">
        <div class="pmos-card-head">
          <div><div class="pmos-eyebrow">Sync Queue</div><h2>Pending photo uploads</h2></div>
          <button class="pmos-capture-btn" type="button" id="pmosRetryAllPhotosBtn">Retry All</button>
        </div>
        <div id="pmosPhotoQueueList" class="pmos-list"><p class="empty-hint">No pending photo uploads.</p></div>
      </section>

      <section class="pmos-today">
        <div class="pmos-card-head">
          <div><div class="pmos-eyebrow">Recent</div><h2>Latest synced updates</h2></div>
        </div>
        <div id="pmosRecentList" class="pmos-list"><p class="empty-hint">No PMOS updates yet.</p></div>
      </section>
    `;

    populateProjectSelect();
    attachPmosHandlers();
    setDefaultDates();
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
  }

  function attachPmosHandlers() {
    $('pmosProjectSelect')?.addEventListener('change', e => {
      state.currentProjectId = e.target.value;
      localStorage.setItem(LAST_PROJECT_KEY, state.currentProjectId);
      setSync('Project selected', 'ok');
      renderPmosLists();
    });

    document.querySelectorAll('[data-pmos-open]').forEach(btn => {
      btn.addEventListener('click', () => openPmosModule(btn.dataset.pmosOpen));
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
  }

  function handlePhotoSelection(file) {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      setSync('Select an image file for Site Camera.', 'error');
      return;
    }
    state.photoFile = file;
    if (state.photoPreviewUrl) URL.revokeObjectURL(state.photoPreviewUrl);
    state.photoPreviewUrl = URL.createObjectURL(file);
    const img = $('pmosPhotoPreview');
    if (img) img.src = state.photoPreviewUrl;
    $('pmosPhotoPreviewWrap')?.classList.remove('hidden');
    setText('pmosPhotoSize', `Selected: ${file.name || 'site photo'} - ${formatBytes(file.size)}`);
    setSync('Local Draft. Add details, then save locally.', 'saving');
  }

  function setDefaultDates() {
    const today = todayISO();
    activeModuleEntries().forEach(([key, mod]) => {
      mod.fields.forEach(([name, , type]) => {
        const el = $(`pmos_${key}_${name}`);
        if (el && type === 'date' && !el.value) el.value = today;
      });
    });
  }

  function openPmosModule(key) {
    document.querySelectorAll('.pmos-form-card').forEach(el => el.classList.add('hidden'));
    $(`pmosForm_${key}`)?.classList.remove('hidden');
    document.querySelectorAll('.pmos-action').forEach(btn => btn.classList.toggle('is-active', btn.dataset.pmosOpen === key));
    $(`pmosForm_${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function readModulePayload(key) {
    const mod = MODULES[key];
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
      photo: ['caption', 'location', 'category']
    };
    const missing = (requiredByModule[key] || []).find(name => payload[name] === undefined || payload[name] === '');
    if (missing) return `${missing.replace(/([A-Z])/g, ' $1')} is required.`;
    return '';
  }

  async function savePhotoLog(button) {
    const project = currentProject();
    if (!project || !pmosProjectAllowed(project.id)) {
      setSync('Select an assigned active project first.', 'error');
      return;
    }
    const payload = readModulePayload('photo');
    const validation = validatePmosPayload('photo', payload);
    if (validation) {
      setSync(validation, 'error');
      return;
    }
    if (!state.photoFile) {
      setSync('Take or choose a photo first.', 'error');
      return;
    }

    await withBusy(button, async () => {
      setSync('Compressing photo...', 'saving');
      const now = Date.now();
      const localId = `photo_${now}_${Math.random().toString(36).slice(2, 9)}`;
      const compressedBlob = await resizePhotoBlob(state.photoFile, 1600, 0.82);
      const thumbnailBlob = await resizePhotoBlob(state.photoFile, 400, 0.78);
      const metadata = {
        ...payload,
        localId,
        module: MODULES.photo.label,
        projectId: project.id,
        projectName: project.name || project.id,
        originalFileName: state.photoFile.name || 'site-photo.jpg',
        originalSize: state.photoFile.size || 0,
        compressedSize: compressedBlob.size || 0,
        thumbnailSize: thumbnailBlob.size || 0,
        uploadStatus: 'Queued',
        uploadProgress: 0,
        source: PMOS_SOURCE,
        status: 'New',
        createdAt: now,
        updatedAt: now,
        createdBy: window._currentUser?.uid || '',
        createdByName: window._currentUser?.name || ''
      };

      await idbPutPhoto({
        localId,
        metadata,
        imageBlob: compressedBlob,
        thumbnailBlob
      });
      clearPmosForm('photo');
      await loadPhotoQueue();
      setSync(navigator.onLine ? 'Saved locally / Pending upload. Upload starting...' : 'Saved locally / Pending upload.', 'saving');
      showToast('Photo saved locally');
      if (navigator.onLine) uploadQueuedPhotos();
    });
  }

  async function updateQueuedPhoto(item, patch) {
    const next = {
      ...item,
      metadata: {
        ...(item.metadata || {}),
        ...patch,
        updatedAt: Date.now()
      }
    };
    await idbPutPhoto(next);
    const idx = state.photoQueue.findIndex(q => q.localId === next.localId);
    if (idx >= 0) state.photoQueue[idx] = next;
    else state.photoQueue.unshift(next);
    renderPhotoQueue();
    return next;
  }

  function patchPhotoQueueView(localId, patch) {
    const idx = state.photoQueue.findIndex(q => q.localId === localId);
    if (idx < 0) return;
    state.photoQueue[idx] = {
      ...state.photoQueue[idx],
      metadata: {
        ...(state.photoQueue[idx].metadata || {}),
        ...patch
      }
    };
    renderPhotoQueue();
  }

  async function uploadQueuedPhotos(includeFailed = false) {
    if (state.photoUploadActive) return;
    if (!navigator.onLine) {
      setSync('Offline. Photo uploads are saved locally.', 'saving');
      return;
    }
    await loadPhotoQueue();
    const queue = state.photoQueue.filter(item => {
      const status = String(item.metadata?.uploadStatus || 'Queued');
      return status === 'Queued' || (includeFailed && ['Failed', 'Uploading'].includes(status));
    });
    if (!queue.length) return;
    state.photoUploadActive = true;
    try {
      for (const item of queue) {
        await uploadPhotoQueueItem(item);
      }
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
    const folder = `drive/pmosPhotoLogs/${meta.projectId}/${photoDateFolder(ts)}`;
    const storagePath = meta.storagePath || `${folder}/${filename}`;
    const thumbnailStoragePath = meta.thumbnailStoragePath || `${folder}/thumb_${filename}`;

    try {
      let photoUrl = meta.photoUrl || '';
      let thumbnailUrl = meta.thumbnailUrl || '';
      if (!photoUrl) {
        const uploaded = await uploadPhotoToDrive(meta, current.imageBlob, current.thumbnailBlob, storagePath, thumbnailStoragePath, pct => {
          patchPhotoQueueView(current.localId, { uploadProgress: pct, storagePath, thumbnailStoragePath });
        });
        photoUrl = uploaded.photoUrl;
        thumbnailUrl = uploaded.thumbnailUrl;
        current = await updateQueuedPhoto(current, {
          photoUrl,
          thumbnailUrl,
          storagePath: uploaded.storagePath || storagePath,
          thumbnailStoragePath: uploaded.thumbnailStoragePath || thumbnailStoragePath,
          photoFileId: uploaded.photoFileId || '',
          thumbnailFileId: uploaded.thumbnailFileId || '',
          storageProvider: uploaded.storageProvider || 'Google Drive',
          uploadProgress: 96
        });
      }

      const finalRef = db.ref(MODULES.photo.collection).push();
      const uploadedAt = Date.now();
      const uploadedMeta = current.metadata || {};
      const finalRecord = {
        id: finalRef.key,
        projectId: meta.projectId,
        projectName: meta.projectName,
        caption: meta.caption,
        location: meta.location,
        category: meta.category,
        photoUrl,
        thumbnailUrl,
        storagePath: uploadedMeta.storagePath || storagePath,
        thumbnailStoragePath: uploadedMeta.thumbnailStoragePath || thumbnailStoragePath,
        storageProvider: uploadedMeta.storageProvider || 'Google Drive',
        photoFileId: uploadedMeta.photoFileId || '',
        thumbnailFileId: uploadedMeta.thumbnailFileId || '',
        originalFileName: meta.originalFileName,
        compressedSize: meta.compressedSize || current.imageBlob?.size || 0,
        uploadStatus: 'Synced',
        source: PMOS_SOURCE,
        createdAt: meta.createdAt,
        uploadedAt,
        status: 'New',
        module: MODULES.photo.label,
        createdBy: meta.createdBy || window._currentUser?.uid || '',
        createdByName: meta.createdByName || window._currentUser?.name || '',
        updatedAt: uploadedAt
      };

      try {
        await finalRef.set(finalRecord);
      } catch (e) {
        if (!String(e?.code || e?.message || '').toLowerCase().includes('permission')) throw e;
        await db.ref(`projects/${meta.projectId}/${MODULES.photo.collection}/${finalRef.key}`).set({
          ...finalRecord,
          globalPathDenied: true,
          fallbackPath: `projects/${meta.projectId}/${MODULES.photo.collection}/${finalRef.key}`
        });
      }
      await idbDeletePhoto(current.localId);
      setSync('Photo uploaded. ACPM can now see it.', 'ok');
      showToast('Photo uploaded to ACPM');
    } catch (e) {
      console.error('PMOS photo upload failed:', e);
      await updateQueuedPhoto(current, {
        uploadStatus: 'Failed',
        uploadProgress: 0,
        storagePath,
        thumbnailStoragePath,
        errorMessage: e.message || e.code || 'Upload failed'
      });
      setSync('Photo upload failed. Local copy kept for retry.', 'error');
    }
  }

  async function savePmosModule(key, button) {
    if (key === 'photo') {
      await savePhotoLog(button);
      return;
    }
    const project = currentProject();
    if (!project || !pmosProjectAllowed(project.id)) {
      setSync('Select an assigned active project first.', 'error');
      return;
    }
    const mod = MODULES[key];
    const payload = readModulePayload(key);
    const validation = validatePmosPayload(key, payload);
    if (validation) {
      setSync(validation, 'error');
      return;
    }

    await withBusy(button, async () => {
      setSync('Saving...', 'saving');
      const ref = db.ref(mod.collection).push();
      const now = Date.now();
      const record = {
        ...payload,
        id: ref.key,
        module: mod.label,
        projectId: project.id,
        projectName: project.name || project.id,
        createdAt: now,
        updatedAt: now,
        createdBy: window._currentUser?.uid || '',
        createdByName: window._currentUser?.name || '',
        source: PMOS_SOURCE
      };
      if (!record.status && key !== 'sitelog' && key !== 'photo') record.status = 'New';
      try {
        await ref.set(record);
        setSync('Saved to Firebase. ACPM can now see it.', 'ok');
        showToast('PMOS record saved');
        clearPmosForm(key);
      } catch (e) {
        if (String(e?.code || e?.message || '').toLowerCase().includes('permission')) {
          try {
            await db.ref(`projects/${project.id}/${mod.collection}/${ref.key}`).set({
              ...record,
              globalPathDenied: true,
              fallbackPath: `projects/${project.id}/${mod.collection}/${ref.key}`
            });
            setSync('Saved under project. Deploy PMOS rules to enable global inbox sync.', 'ok');
            showToast('PMOS record saved under project');
            clearPmosForm(key);
            return;
          } catch (fallbackError) {
            console.error('PMOS fallback save failed:', fallbackError);
          }
        }
        console.error('PMOS save failed:', e);
        setSync(`Save failed: ${e.message || e.code || 'Firebase error'}`, 'error');
        showToast('Firebase save failed', 'error');
      }
    });
  }

  function clearPmosForm(key) {
    const mod = MODULES[key];
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
  }

  function detachPmosListeners() {
    state.listeners.forEach(ref => ref.off());
    state.listeners = [];
  }

  function notePmosReadFallback(err, scope = 'global') {
    const permissionDenied = String(err?.code || err?.message || '').toLowerCase().includes('permission');
    if (!permissionDenied) {
      console.warn(`PMOS ${scope} listener skipped:`, err);
      return;
    }
    if (scope === 'global') {
      if (state.globalReadDeniedNotified) return;
      state.globalReadDeniedNotified = true;
      console.info('PMOS global inbox is waiting for deployed Firebase rules. Reading project fallback records.');
      setSync('Firebase rules need deployment. Reading project fallback records.', 'saving');
      return;
    }
    if (state.fallbackReadDeniedNotified) return;
    state.fallbackReadDeniedNotified = true;
    console.info('PMOS project fallback listener denied by Firebase rules.');
  }

  function watchPmosRecords() {
    detachPmosListeners();
    state.records = [];
    activeModuleEntries().forEach(([key, mod]) => {
      const ref = db.ref(mod.collection).limitToLast(80);
      const sourceKey = `root:${mod.collection}`;
      ref.on('value', snap => {
        state.records = state.records.filter(r => r.sourceKey !== sourceKey);
        snap.forEach(child => {
          const record = child.val() || {};
          if (pmosProjectAllowed(record.projectId)) {
            state.records.push({ ...record, id: record.id || child.key, moduleKey: key, moduleLabel: mod.label, collection: mod.collection, sourceKey });
          }
        });
        renderPmosLists();
      }, err => notePmosReadFallback(err, 'global'));
      state.listeners.push(ref);
    });
    state.projects.forEach(project => {
      activeModuleEntries().forEach(([key, mod]) => {
        const ref = db.ref(`projects/${project.id}/${mod.collection}`).limitToLast(40);
        const sourceKey = `project:${project.id}:${mod.collection}`;
        ref.on('value', snap => {
          state.records = state.records.filter(r => r.sourceKey !== sourceKey);
          snap.forEach(child => {
            const record = child.val() || {};
            if (pmosProjectAllowed(record.projectId || project.id)) {
              state.records.push({
                ...record,
                id: record.id || child.key,
                projectId: record.projectId || project.id,
                projectName: record.projectName || project.name || project.id,
                moduleKey: key,
                moduleLabel: mod.label,
                collection: mod.collection,
                sourceKey
              });
            }
          });
          renderPmosLists();
        }, err => notePmosReadFallback(err, 'project fallback'));
        state.listeners.push(ref);
      });
    });
  }

  function renderPmosLists() {
    const pid = state.currentProjectId;
    const records = state.records
      .filter(r => !pid || r.projectId === pid)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const today = todayISO();
    const pending = records.filter(r => {
      const status = String(r.status || 'New');
      const due = r.dueDate || r.neededDate || r.date;
      return due && due <= today && !['Done', 'Archived', 'Delivered', 'Cancelled'].includes(status);
    }).slice(0, 8);
    const recent = records.slice(0, 12);
    setHTML('pmosPendingList', pending.length ? pending.map(recordCard).join('') : '<p class="empty-hint">No pending items due today.</p>');
    setHTML('pmosRecentList', recent.length ? recent.map(recordCard).join('') : '<p class="empty-hint">No PMOS updates yet.</p>');
    renderPendingSyncCount();
  }

  function recordTitle(r) {
    return r.note || r.issue || r.item || r.task || r.meetingTitle || r.caption || r.accomplishment || r.moduleLabel || 'PMOS record';
  }

  function recordCard(r) {
    const date = r.dueDate || r.neededDate || r.date || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '');
    return `<article class="pmos-record">
      <div>
        <strong>${h(recordTitle(r))}</strong>
        <span>${h(r.moduleLabel || r.module || '')} - ${h(r.projectName || r.projectId || '')}</span>
      </div>
      <div class="pmos-record-meta">
        ${r.priority ? `<b>${h(r.priority)}</b>` : ''}
        ${r.status ? `<b>${h(r.status)}</b>` : ''}
        ${r.uploadStatus ? `<b>${h(r.uploadStatus)}</b>` : ''}
        ${date ? `<b>${h(date)}</b>` : ''}
      </div>
    </article>`;
  }

  function renderPendingSyncCount() {
    const pending = state.photoQueue.filter(item => !['Synced', 'Uploaded'].includes(String(item.metadata?.uploadStatus || 'Queued'))).length;
    setText('pmosPendingSyncBadge', `${pending} pending sync`);
  }

  async function pmosRetryPhoto(localId) {
    const item = await idbGetPhoto(localId);
    if (!item) {
      await loadPhotoQueue();
      return;
    }
    await updateQueuedPhoto(item, { uploadStatus: 'Queued', uploadProgress: 0, errorMessage: '' });
    await uploadQueuedPhotos(true);
  }

  async function initLine17Pmos() {
    if (state.initialized) return;
    state.initialized = true;
    try {
      state.projects = await loadPmosProjects();
      renderPmosShell();
      if (state.currentProjectId) localStorage.setItem(LAST_PROJECT_KEY, state.currentProjectId);
      watchPmosRecords();
      await loadPhotoQueue();
      window.addEventListener('online', () => uploadQueuedPhotos(true));
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) uploadQueuedPhotos(true);
      });
      setSync(state.projects.length ? 'Ready to capture field updates.' : 'No active projects assigned.', state.projects.length ? 'ok' : 'error');
      openPmosModule('quick');
      if (navigator.onLine) uploadQueuedPhotos(true);
    } catch (e) {
      console.error('PMOS init failed:', e);
      const app = $('pmosApp');
      if (app) app.innerHTML = `<div class="pmos-loading-card">Could not load PMOS. ${h(e.message || e.code || '')}</div>`;
    }
  }

  window.initLine17Pmos = initLine17Pmos;
  window.pmosRetryPhoto = pmosRetryPhoto;
})();
