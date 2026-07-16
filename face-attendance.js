(function () {
  /* ---- Feature Gate ---- */
  if (!window.PMOS_CONFIG || !window.PMOS_CONFIG.faceAttendanceEnabled) {
    return;
  }

  const FACE_SOURCE = 'Line17 PMOS Face Attendance Assist';
  const FACE_MODEL = 'face-api-ssd-mobilenetv1-face-recognition-v1';
  const FACE_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.min.js';
  const DEFAULT_MODEL_URL = './models/face-api';
  const FACE_DB_NAME = 'line17_face_attendance_queue';
  const FACE_DB_VERSION = 1;
  const FACE_STORE = 'selfieQueue';
  const STRONG_DEFAULT = 0.40;
  const POSSIBLE_DEFAULT = 0.55;

  const faceState = {
    injected: false,
    pmosInjected: false,
    settings: null,
    workers: [],
    enrollmentWorkerId: '',
    labFile: null,
    labResult: null,
    pmosFile: null,
    pmosPreviewUrl: '',
    pmosScanResult: null,
    pmosQueue: [],
    pmosQueueUrls: [],
    pmosUploadActive: false,
    inboxRows: [],
    listeners: [],
    engineReady: false,
    engineError: ''
  };

  function h(text) {
    return typeof escapeHtml === 'function' ? escapeHtml(text) : String(text ?? '');
  }

  function userRole() {
    return String(window._currentUser?.role || '').toLowerCase();
  }

  function canManageFaces() {
    return ['boss', 'owner', 'admin', 'pm'].includes(userRole());
  }

  function canReviewAttendance() {
    return ['boss', 'owner', 'admin', 'pm'].includes(userRole());
  }

  function canPostPayroll() {
    return ['boss', 'owner', 'admin', 'pm'].includes(userRole());
  }

  function assignedProjectIds() {
    const user = window._currentUser || {};
    const normalize = typeof normalizeProjectList === 'function'
      ? normalizeProjectList
      : value => Array.isArray(value) ? value.filter(Boolean).map(String) : Object.keys(value || {});
    if (typeof isBoss === 'function' && isBoss(user.role)) return null;
    return Array.from(new Set([...normalize(user.projects), ...normalize(user.bossOf)]));
  }

  function projectAllowed(pid) {
    if (!pid) return false;
    const ids = assignedProjectIds();
    return ids === null || ids.includes(pid);
  }

  function todayKey(ts = Date.now()) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  function timeText(ts) {
    return ts ? new Date(ts).toLocaleString('en-PH') : '-';
  }

  function safeName(name = 'face-photo.jpg') {
    const base = String(name || 'face-photo')
      .replace(/\.[a-z0-9]+$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'face-photo';
    return `${base}.jpg`;
  }

  function faceSettings() {
    return {
      strongThreshold: Number(faceState.settings?.strongThreshold || STRONG_DEFAULT),
      possibleThreshold: Number(faceState.settings?.possibleThreshold || POSSIBLE_DEFAULT),
      modelUrl: faceState.settings?.modelUrl || DEFAULT_MODEL_URL,
      attendanceSelfieRetentionDays: Number(faceState.settings?.attendanceSelfieRetentionDays || 120),
      testPhotoRetentionDays: Number(faceState.settings?.testPhotoRetentionDays || 30),
      matchingEnabled: faceState.settings?.matchingEnabled !== false
    };
  }

  function matchLabel(distance) {
    const settings = faceSettings();
    if (!Number.isFinite(distance)) return 'Unknown';
    if (distance <= settings.strongThreshold) return 'Strong Match';
    if (distance <= settings.possibleThreshold) return 'Possible Match';
    return 'Unknown';
  }

  function setStatus(id, message, type = 'ok') {
    const el = $(id);
    if (!el) return;
    el.className = `face-status face-status-${type}`;
    el.textContent = message;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some(s => s.src === src)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load face engine script: ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureFaceEngine(statusId = '') {
    if (faceState.engineReady && window.faceapi) return window.faceapi;
    if (faceState.engineError) throw new Error(faceState.engineError);
    try {
      if (statusId) setStatus(statusId, 'Loading face engine...', 'saving');
      if (!window.faceapi) await loadScript(FACE_SCRIPT_URL);
      const api = window.faceapi;
      if (!api?.nets?.ssdMobilenetv1 || !api?.nets?.faceLandmark68Net || !api?.nets?.faceRecognitionNet) {
        throw new Error('Loaded face-api library does not expose the required SSD, landmark, and recognition networks.');
      }
      const modelUrl = faceSettings().modelUrl;
      await Promise.all([
        api.nets.ssdMobilenetv1.loadFromUri(modelUrl),
        api.nets.faceLandmark68Net.loadFromUri(modelUrl),
        api.nets.faceRecognitionNet.loadFromUri(modelUrl)
      ]);
      faceState.engineReady = true;
      if (statusId) setStatus(statusId, 'Face engine ready.', 'ok');
      return api;
    } catch (e) {
      faceState.engineError = `${e.message || e}. Add face-api model files under ${faceSettings().modelUrl} or update Face Settings.`;
      if (statusId) setStatus(statusId, faceState.engineError, 'error');
      throw new Error(faceState.engineError);
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
        reject(new Error('Could not read image.'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, quality = 0.82) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode image.')), 'image/jpeg', quality);
    });
  }

  async function resizeImageBlob(file, maxWidth = 1600, quality = 0.82) {
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
    return canvasToBlob(canvas, quality);
  }

  async function sha256Blob(blob) {
    const buf = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  async function detectDescriptor(fileOrBlob, statusId = '') {
    const api = await ensureFaceEngine(statusId);
    const img = await imageFromBlob(fileOrBlob);
    const detections = await api
      .detectAllFaces(img, new api.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    if (!detections.length) {
      return { ok: false, faceDetected: false, multipleFacesDetected: false, error: 'No face detected.' };
    }
    if (detections.length > 1) {
      return { ok: false, faceDetected: true, multipleFacesDetected: true, error: 'Multiple faces detected. Use one worker per photo.' };
    }
    const box = detections[0].detection?.box;
    const minFace = Math.min(box?.width || 0, box?.height || 0);
    if (minFace < 80) {
      return { ok: false, faceDetected: true, multipleFacesDetected: false, error: 'Face is too small. Move closer and retake.' };
    }
    return {
      ok: true,
      faceDetected: true,
      multipleFacesDetected: false,
      descriptor: Array.from(detections[0].descriptor),
      box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
    };
  }

  function euclidean(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Number(a[i]) - Number(b[i]);
      sum += d * d;
    }
    return Math.sqrt(sum);
  }

  async function loadSettings() {
    try {
      const snap = await db.ref('faceSettings').once('value');
      faceState.settings = snap.val() || {};
    } catch (e) {
      faceState.settings = {};
    }
    return faceSettings();
  }

  async function loadEnrolledWorkers(projectId = '') {
    const rows = [];
    try {
      const snap = await db.ref('workers').once('value');
      snap.forEach(child => {
        const worker = child.val() || {};
        const enrollment = worker.faceEnrollment || {};
        const descriptors = Array.isArray(enrollment.descriptors)
          ? enrollment.descriptors
          : Array.isArray(worker.faceDescriptors) ? worker.faceDescriptors : [];
        const activeProjects = Array.isArray(worker.activeProjectIds) ? worker.activeProjectIds.map(String) : [];
        const status = String(enrollment.faceEnrollmentStatus || worker.faceEnrollmentStatus || '').toLowerCase();
        if (!worker.consentRecorded && !enrollment.consentRecorded) return;
        if (status === 'revoked') return;
        if (worker.active === false || worker.status === 'inactive' || worker.disabled === true) return;
        if (!descriptors.length) return;
        if (projectId && activeProjects.length && !activeProjects.includes(projectId)) return;
        rows.push({
          id: child.key,
          workerId: worker.workerId || child.key,
          projectId: worker.projectId || '',
          projectWorkerId: worker.projectWorkerId || '',
          workerName: worker.workerName || worker.name || child.key,
          trade: worker.trade || '',
          dailyRate: worker.dailyRate || 0,
          profilePhotoUrl: worker.profilePhotoUrl || enrollment.referencePhotos?.[0]?.thumbnailUrl || enrollment.referencePhotos?.[0]?.photoUrl || '',
          descriptors,
          enrollment
        });
      });
    } catch (e) {
      console.warn('Root worker descriptor load failed:', e);
    }
    if (rows.length || !projectId) return rows;
    try {
      const snap = await db.ref(`projects/${projectId}/workers`).once('value');
      snap.forEach(child => {
        const worker = child.val() || {};
        const enrollment = worker.faceEnrollment || {};
        const descriptors = enrollment.descriptors || worker.faceDescriptors || [];
        const status = String(enrollment.faceEnrollmentStatus || worker.faceEnrollmentStatus || '').toLowerCase();
        if (!enrollment.consentRecorded && !worker.consentRecorded) return;
        if (status === 'revoked') return;
        if (worker.active === false || worker.status === 'inactive') return;
        if (!Array.isArray(descriptors) || !descriptors.length) return;
        rows.push({
          id: `${projectId}_${child.key}`,
          workerId: `${projectId}_${child.key}`,
          projectId,
          projectWorkerId: child.key,
          workerName: worker.name || child.key,
          trade: worker.trade || '',
          dailyRate: worker.dailyRate || 0,
          profilePhotoUrl: enrollment.referencePhotos?.[0]?.thumbnailUrl || enrollment.referencePhotos?.[0]?.photoUrl || '',
          descriptors,
          enrollment
        });
      });
    } catch (e) {
      console.warn('Project worker descriptor load failed:', e);
    }
    return rows;
  }

  async function compareDescriptor(descriptor, projectId = '') {
    const workers = await loadEnrolledWorkers(projectId);
    const matches = [];
    workers.forEach(worker => {
      let best = Infinity;
      (worker.descriptors || []).forEach(d => {
        const vector = d.vector || d.descriptor || d;
        const distance = euclidean(descriptor, vector);
        if (distance < best) best = distance;
      });
      if (Number.isFinite(best)) {
        matches.push({
          workerId: worker.workerId || worker.id,
          globalWorkerId: worker.id,
          projectWorkerId: worker.projectWorkerId || '',
          projectId: worker.projectId || projectId,
          workerName: worker.workerName,
          trade: worker.trade || '',
          dailyRate: worker.dailyRate || 0,
          photoUrl: worker.profilePhotoUrl || '',
          distance: Number(best.toFixed(4)),
          matchLabel: matchLabel(best)
        });
      }
    });
    matches.sort((a, b) => a.distance - b.distance);
    const topMatches = matches.slice(0, 3);
    const best = topMatches[0] || null;
    return { best, topMatches, enrolledCount: workers.length };
  }

  function uploadBlob(path, blob, contentType = 'image/jpeg') {
    return new Promise((resolve, reject) => {
      if (!firebase.storage) {
        reject(new Error('Firebase Storage SDK is not loaded.'));
        return;
      }
      const ref = firebase.storage().ref(path);
      const task = ref.put(blob, { contentType });
      task.on(firebase.storage.TaskEvent.STATE_CHANGED, null, reject, async () => {
        try {
          resolve({ path, url: await ref.getDownloadURL() });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  function writeAudit(action, entityType, entityId, details = {}) {
    try {
      if (typeof auditLog === 'function') auditLog(action, entityType, entityId, details);
    } catch (e) { /* no-op */ }
  }

  function injectAcpm() {
    if (faceState.injected || !document.querySelector('#workspaceView .tab-group')) return;
    faceState.injected = true;
    const tabs = document.querySelector('#workspaceView .tab-group');
    if (tabs && !$('tab_face')) {
      tabs.insertAdjacentHTML('beforeend', '<button id="tab_face" class="tab-btn" onclick="switchTab(\'face\')" data-role-visible="apm,pm,boss,owner,admin">Face Attendance</button>');
    }
    const workspace = $('workspaceView');
    if (workspace && !$('facePanel')) {
      workspace.insertAdjacentHTML('beforeend', facePanelMarkup());
    }
    const originalSwitch = window.switchTab;
    if (typeof originalSwitch === 'function' && !originalSwitch._facePatched) {
      const patched = function (tab) {
        originalSwitch(tab);
        if (tab === 'face') initFacePanel();
      };
      patched._facePatched = true;
      window.switchTab = patched;
    }
  }

  function facePanelMarkup() {
    return `<div id="facePanel" class="panel hidden">
      <div class="face-head">
        <div>
          <div class="sec-label">Face Attendance Assist</div>
          <h2>Worker enrollment, lab testing, and attendance review</h2>
          <p>Matches are suggestions only. Every attendance draft stays For Review until an authorized user approves it.</p>
        </div>
        <div class="face-head-actions">
          <button class="btn-ws-secondary" type="button" onclick="faceRefreshAll()">Refresh</button>
          <a class="btn-ws-secondary" href="pmos.html#selfie-scan">Open PMOS Selfie Scan</a>
        </div>
      </div>
      <div class="face-tabs">
        ${['enroll', 'lab', 'inbox', 'settings', 'audit'].map((key, idx) => `<button id="faceTab_${key}" class="${idx === 0 ? 'is-active' : ''}" type="button" onclick="showFaceView('${key}')">${faceTabLabel(key)}</button>`).join('')}
      </div>
      <div id="faceContent" class="face-content"></div>
    </div>`;
  }

  function faceTabLabel(key) {
    return {
      enroll: 'Worker Face Enrollment',
      lab: 'Face Engine Lab',
      inbox: 'Labor Attendance Inbox',
      settings: 'Face Settings',
      audit: 'Audit Logs'
    }[key] || key;
  }

  async function initFacePanel() {
    await loadSettings();
    showFaceView(faceState.activeView || 'enroll');
    watchFaceInbox();
  }

  function showFaceView(view) {
    faceState.activeView = view;
    document.querySelectorAll('.face-tabs button').forEach(btn => btn.classList.toggle('is-active', btn.id === `faceTab_${view}`));
    const renderers = {
      enroll: renderEnrollmentView,
      lab: renderLabView,
      inbox: renderInboxView,
      settings: renderSettingsView,
      audit: renderAuditView
    };
    (renderers[view] || renderEnrollmentView)();
  }

  async function loadProjectWorkers(pid) {
    if (!pid) return [];
    const snap = await db.ref(`projects/${pid}/workers`).once('value');
    const rows = [];
    snap.forEach(child => {
      const worker = child.val() || {};
      if (worker.active === false || worker.status === 'inactive') return;
      rows.push({ ...worker, id: child.key });
    });
    rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    faceState.workers = rows;
    return rows;
  }

  async function renderEnrollmentView() {
    const pid = window._currentPid;
    const el = $('faceContent');
    if (!el) return;
    if (!pid) {
      el.innerHTML = '<p class="empty-hint">Open a project first to enroll workers.</p>';
      return;
    }
    el.innerHTML = '<p class="empty-hint">Loading workers...</p>';
    const workers = await loadProjectWorkers(pid);
    const selected = workers.find(w => w.id === faceState.enrollmentWorkerId) || workers[0] || null;
    faceState.enrollmentWorkerId = selected?.id || '';
    el.innerHTML = `<div class="face-grid">
      <section class="face-card">
        <div class="face-card-head">
          <div><h3>Roster Workers</h3><p>Select a worker, record consent, then upload 3 to 5 reference photos.</p></div>
        </div>
        <div class="face-worker-list">
          ${workers.length ? workers.map(w => workerEnrollRow(w, w.id === faceState.enrollmentWorkerId)).join('') : '<p class="empty-hint">No active workers in this project.</p>'}
        </div>
      </section>
      <section class="face-card" id="faceEnrollDetail">${selected ? enrollmentDetailMarkup(selected) : '<p class="empty-hint">Select a worker.</p>'}</section>
    </div>`;
  }

  function workerEnrollRow(worker, selected) {
    const e = worker.faceEnrollment || {};
    const status = e.faceEnrollmentStatus || worker.faceEnrollmentStatus || 'Not Enrolled';
    return `<button class="face-worker-row ${selected ? 'is-active' : ''}" type="button" onclick="selectFaceWorker('${h(worker.id)}')">
      <span><strong>${h(worker.name || worker.id)}</strong><small>${h(worker.trade || 'No trade')}</small></span>
      <b>${h(status)}</b>
    </button>`;
  }

  function enrollmentDetailMarkup(worker) {
    const e = worker.faceEnrollment || {};
    const photos = Array.isArray(e.referencePhotos) ? e.referencePhotos : [];
    const descriptors = Array.isArray(e.descriptors) ? e.descriptors : [];
    const canEdit = canManageFaces();
    return `<div class="face-card-head">
        <div><h3>${h(worker.name || worker.id)}</h3><p>${h(worker.trade || 'No trade')} - ${worker.dailyRate ? h(typeof peso === 'function' ? peso(worker.dailyRate) : worker.dailyRate) + '/day' : 'No rate'}</p></div>
        <span class="badge badge-purple">${h(e.faceEnrollmentStatus || 'Not Enrolled')}</span>
      </div>
      <div class="face-notice">Consent is required before enrollment and matching. Reference images and selfies are stored in Firebase Storage; only URLs, storage paths, descriptors, status, and audit records are stored in RTDB.</div>
      <div class="face-form-grid">
        <label><span>Consent Recorded</span><select id="faceConsent"><option value="false">No</option><option value="true" ${e.consentRecorded ? 'selected' : ''}>Yes</option></select></label>
        <label><span>Consent Method</span><select id="faceConsentMethod">
          ${['Written', 'Digital', 'Manual Upload'].map(m => `<option ${e.consentMethod === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select></label>
        <label><span>Enrollment Notes</span><input id="faceEnrollmentNotes" value="${h(e.enrollmentNotes || '')}" placeholder="Optional notes"></label>
        <label><span>Reference Photos</span><input id="faceReferenceFiles" type="file" accept="image/*" multiple ${canEdit ? '' : 'disabled'}></label>
      </div>
      <div class="face-actions">
        <button class="btn-save-payroll" type="button" onclick="saveFaceEnrollment('${h(worker.id)}')" ${canEdit ? '' : 'disabled'}>Process and Save Enrollment</button>
        <button class="btn-ws-secondary" type="button" onclick="revokeFaceEnrollment('${h(worker.id)}')" ${canEdit ? '' : 'disabled'}>Revoke Enrollment</button>
        <button class="btn-ws-secondary" type="button" onclick="deleteFaceData('${h(worker.id)}')" ${canEdit ? '' : 'disabled'}>Delete Face Data</button>
      </div>
      <div id="faceEnrollStatus" class="face-status face-status-ok">Ready. Recommended photos: front, slight left, slight right, normal lighting, hard hat if common.</div>
      <div class="face-photo-grid">
        ${photos.length ? photos.map(p => `<a href="${h(p.photoUrl)}" target="_blank" rel="noopener"><img src="${h(p.thumbnailUrl || p.photoUrl)}" alt="Reference photo"></a>`).join('') : '<p class="empty-hint">No reference photos saved.</p>'}
      </div>
      <div class="face-mini-table">
        <div><span>Descriptors</span><strong>${descriptors.length}</strong></div>
        <div><span>Model</span><strong>${h(e.descriptorModel || FACE_MODEL)}</strong></div>
        <div><span>Updated</span><strong>${h(timeText(e.updatedAt))}</strong></div>
      </div>`;
  }

  async function selectFaceWorker(workerId) {
    faceState.enrollmentWorkerId = workerId;
    renderEnrollmentView();
  }

  async function saveFaceEnrollment(workerId) {
    const pid = window._currentPid;
    if (!pid || !workerId) return;
    if (!canManageFaces()) {
      showToast('Admin or PM access is required for face enrollment.', 'error');
      return;
    }
    const consentRecorded = $('faceConsent')?.value === 'true';
    if (!consentRecorded) {
      setStatus('faceEnrollStatus', 'Consent must be recorded before enrollment.', 'error');
      return;
    }
    const files = Array.from($('faceReferenceFiles')?.files || []);
    if (files.length < 3 || files.length > 5) {
      setStatus('faceEnrollStatus', 'Upload 3 to 5 reference photos for production enrollment.', 'error');
      return;
    }
    const workerSnap = await db.ref(`projects/${pid}/workers/${workerId}`).once('value');
    const worker = workerSnap.val() || {};
    const globalWorkerId = `${pid}_${workerId}`;
    const now = Date.now();
    const referencePhotos = [];
    const descriptors = [];
    let valid = 0;

    try {
      setStatus('faceEnrollStatus', 'Loading face models and validating photos...', 'saving');
      await ensureFaceEngine('faceEnrollStatus');
      for (const file of files) {
        const compressed = await resizeImageBlob(file, 1400, 0.84);
        const thumb = await resizeImageBlob(file, 360, 0.78);
        const detection = await detectDescriptor(compressed, 'faceEnrollStatus');
        if (!detection.ok) {
          setStatus('faceEnrollStatus', `${file.name || 'Photo'} rejected: ${detection.error}`, 'error');
          continue;
        }
        const photoId = db.ref().push().key;
        const filename = `${Date.now()}_${safeName(file.name)}`;
        const photoPath = `faceEnrollment/${globalWorkerId}/${filename}`;
        const thumbPath = `faceEnrollment/${globalWorkerId}/thumb_${filename}`;
        const [photoUpload, thumbUpload] = await Promise.all([
          uploadBlob(photoPath, compressed),
          uploadBlob(thumbPath, thumb)
        ]);
        referencePhotos.push({
          photoId,
          photoUrl: photoUpload.url,
          thumbnailUrl: thumbUpload.url,
          storagePath: photoUpload.path,
          thumbnailStoragePath: thumbUpload.path,
          uploadedAt: Date.now(),
          uploadedBy: window._currentUser?.uid || ''
        });
        descriptors.push({
          descriptorId: db.ref().push().key,
          vector: detection.descriptor,
          sourcePhotoId: photoId,
          model: FACE_MODEL,
          createdAt: Date.now()
        });
        valid++;
        writeAudit('reference_photo_added', 'faceEnrollment', globalWorkerId, { projectId: pid, workerId, workerName: worker.name || '', photoId });
        writeAudit('descriptor_generated', 'faceEnrollment', globalWorkerId, { projectId: pid, workerId, workerName: worker.name || '', photoId, model: FACE_MODEL });
      }
      const status = valid >= 3 ? 'Complete' : valid > 0 ? 'Partial' : 'Failed';
      const enrollment = {
        workerId: globalWorkerId,
        workerName: worker.name || '',
        trade: worker.trade || '',
        dailyRate: worker.dailyRate || 0,
        activeProjectIds: [pid],
        consentRecorded: true,
        consentRecordedAt: worker.faceEnrollment?.consentRecordedAt || now,
        consentMethod: $('faceConsentMethod')?.value || 'Written',
        faceEnrollmentStatus: status,
        referencePhotos,
        descriptors,
        descriptorModel: FACE_MODEL,
        enrollmentNotes: $('faceEnrollmentNotes')?.value.trim() || '',
        enrolledBy: window._currentUser?.uid || '',
        enrolledAt: worker.faceEnrollment?.enrolledAt || now,
        updatedAt: Date.now()
      };
      const updates = {};
      updates[`projects/${pid}/workers/${workerId}/faceEnrollment`] = enrollment;
      updates[`projects/${pid}/workers/${workerId}/faceDescriptors`] = descriptors;
      updates[`projects/${pid}/workers/${workerId}/consentRecorded`] = true;
      updates[`projects/${pid}/workers/${workerId}/faceEnrollmentStatus`] = status;
      updates[`workers/${globalWorkerId}`] = {
        workerId: globalWorkerId,
        projectId: pid,
        projectWorkerId: workerId,
        workerName: worker.name || '',
        name: worker.name || '',
        trade: worker.trade || '',
        dailyRate: worker.dailyRate || 0,
        activeProjectIds: [pid],
        active: worker.active !== false,
        status: worker.status || 'active',
        consentRecorded: true,
        consentRecordedAt: enrollment.consentRecordedAt,
        faceEnrollmentStatus: status,
        faceEnrollment: enrollment,
        faceDescriptors: descriptors,
        updatedAt: Date.now()
      };
      await db.ref().update(updates);
      writeAudit('enrollment_created', 'faceEnrollment', globalWorkerId, { projectId: pid, workerId, workerName: worker.name || '', status, validPhotos: valid });
      setStatus('faceEnrollStatus', `Enrollment ${status}. ${valid} valid reference photos saved.`, status === 'Complete' ? 'ok' : 'saving');
      await renderEnrollmentView();
    } catch (e) {
      console.error('Enrollment failed:', e);
      setStatus('faceEnrollStatus', e.message || 'Enrollment failed.', 'error');
    }
  }

  async function revokeFaceEnrollment(workerId) {
    const pid = window._currentPid;
    if (!pid || !workerId || !canManageFaces()) return;
    if (!confirm('Revoke face matching for this worker? Existing attendance records are preserved.')) return;
    const globalWorkerId = `${pid}_${workerId}`;
    const updates = {};
    const now = Date.now();
    updates[`projects/${pid}/workers/${workerId}/faceEnrollment/faceEnrollmentStatus`] = 'Revoked';
    updates[`projects/${pid}/workers/${workerId}/faceEnrollment/revokedAt`] = now;
    updates[`projects/${pid}/workers/${workerId}/faceEnrollmentStatus`] = 'Revoked';
    updates[`workers/${globalWorkerId}/faceEnrollment/faceEnrollmentStatus`] = 'Revoked';
    updates[`workers/${globalWorkerId}/faceEnrollment/revokedAt`] = now;
    updates[`workers/${globalWorkerId}/faceEnrollmentStatus`] = 'Revoked';
    await db.ref().update(updates);
    writeAudit('biometric_data_revoked', 'faceEnrollment', globalWorkerId, { projectId: pid, workerId });
    showToast('Face enrollment revoked.', 'warn');
    renderEnrollmentView();
  }

  async function deleteFaceData(workerId) {
    const pid = window._currentPid;
    if (!pid || !workerId || !canManageFaces()) return;
    if (!confirm('Delete stored face descriptors and reference metadata for this worker? Storage files may also be removed when rules permit.')) return;
    const globalWorkerId = `${pid}_${workerId}`;
    const snap = await db.ref(`projects/${pid}/workers/${workerId}/faceEnrollment/referencePhotos`).once('value');
    const deletePaths = [];
    snap.forEach(child => {
      const p = child.val() || {};
      if (p.storagePath) deletePaths.push(p.storagePath);
      if (p.thumbnailStoragePath) deletePaths.push(p.thumbnailStoragePath);
    });
    await Promise.all(deletePaths.map(path => firebase.storage?.().ref(path).delete().catch(() => null)));
    const updates = {};
    updates[`projects/${pid}/workers/${workerId}/faceEnrollment`] = {
      workerId: globalWorkerId,
      workerName: '',
      consentRecorded: false,
      faceEnrollmentStatus: 'Revoked',
      referencePhotos: [],
      descriptors: [],
      descriptorModel: FACE_MODEL,
      updatedAt: Date.now(),
      revokedAt: Date.now()
    };
    updates[`projects/${pid}/workers/${workerId}/faceDescriptors`] = null;
    updates[`projects/${pid}/workers/${workerId}/consentRecorded`] = false;
    updates[`projects/${pid}/workers/${workerId}/faceEnrollmentStatus`] = 'Revoked';
    updates[`workers/${globalWorkerId}`] = null;
    await db.ref().update(updates);
    writeAudit('biometric_data_deleted', 'faceEnrollment', globalWorkerId, { projectId: pid, workerId });
    showToast('Face data deleted.', 'warn');
    renderEnrollmentView();
  }

  function renderLabView() {
    const el = $('faceContent');
    if (!el) return;
    el.innerHTML = `<section class="face-card">
      <div class="face-card-head">
        <div><h3>Face Engine Lab</h3><p>Upload a test selfie, compare only against enrolled workers, then save the reviewed test result.</p></div>
      </div>
      <div class="face-form-grid">
        <label><span>Test Selfie</span><input id="faceLabFile" type="file" accept="image/*" capture="user"></label>
        <label><span>Project Filter</span><select id="faceLabProject"><option value="">All enrolled workers</option></select></label>
      </div>
      <div class="face-actions">
        <button class="btn-save-payroll" type="button" onclick="runFaceLab()">Run Test Scan</button>
        <button class="btn-ws-secondary" type="button" onclick="saveFaceLabResult('Confirmed')">Confirm Match</button>
        <button class="btn-ws-secondary" type="button" onclick="saveFaceLabResult('Rejected')">Reject Match</button>
        <button class="btn-ws-secondary" type="button" onclick="saveFaceLabResult('Unknown')">Mark Unknown</button>
        <button class="btn-ws-secondary" type="button" onclick="saveFaceLabResult('Saved')">Save Test Result</button>
      </div>
      <div id="faceLabStatus" class="face-status face-status-ok">Ready.</div>
      <div id="faceLabResult" class="face-lab-result"><p class="empty-hint">No test run yet.</p></div>
    </section>`;
    loadLabProjects();
    $('faceLabFile')?.addEventListener('change', e => {
      faceState.labFile = e.target.files?.[0] || null;
    });
  }

  async function loadLabProjects() {
    const select = $('faceLabProject');
    if (!select) return;
    const ids = assignedProjectIds();
    const snap = await db.ref('projects').once('value');
    const rows = [];
    snap.forEach(child => {
      if (ids !== null && !ids.includes(child.key)) return;
      const p = child.val() || {};
      rows.push({ id: child.key, name: p.name || child.key });
    });
    select.innerHTML = '<option value="">All enrolled workers</option>' + rows.map(p => `<option value="${h(p.id)}">${h(p.name)}</option>`).join('');
  }

  async function runFaceLab() {
    const file = faceState.labFile || $('faceLabFile')?.files?.[0];
    if (!file) {
      setStatus('faceLabStatus', 'Choose a test selfie first.', 'error');
      return;
    }
    try {
      setStatus('faceLabStatus', 'Scanning test selfie...', 'saving');
      const compressed = await resizeImageBlob(file, 1400, 0.84);
      const detection = await detectDescriptor(compressed, 'faceLabStatus');
      if (!detection.ok) {
        faceState.labResult = { detection, topMatches: [], best: null };
        setStatus('faceLabStatus', detection.error, 'error');
        renderLabResult(file, null, []);
        return;
      }
      const projectId = $('faceLabProject')?.value || '';
      const comparison = await compareDescriptor(detection.descriptor, projectId);
      faceState.labResult = { detection, ...comparison, file, compressed };
      setStatus('faceLabStatus', comparison.best ? `Best result: ${comparison.best.workerName} (${comparison.best.distance})` : 'No enrolled workers matched.', comparison.best ? 'ok' : 'saving');
      renderLabResult(file, comparison.best, comparison.topMatches);
    } catch (e) {
      console.error('Face lab failed:', e);
      setStatus('faceLabStatus', e.message || 'Face lab failed.', 'error');
    }
  }

  function renderLabResult(file, best, topMatches) {
    const el = $('faceLabResult');
    if (!el) return;
    const preview = file ? URL.createObjectURL(file) : '';
    el.innerHTML = `<div class="face-result-grid">
      <div>${preview ? `<img src="${preview}" alt="Test selfie">` : '<div class="face-empty-img">No selfie</div>'}<span>Test selfie</span></div>
      <div>${best?.photoUrl ? `<img src="${h(best.photoUrl)}" alt="Best match">` : '<div class="face-empty-img">No match</div>'}<span>${h(best?.workerName || 'Unknown')}</span></div>
    </div>
    <div class="face-mini-table">
      <div><span>Match Label</span><strong>${h(best?.matchLabel || 'Unknown')}</strong></div>
      <div><span>Distance</span><strong>${best ? h(best.distance) : '-'}</strong></div>
      <div><span>Enrolled Compared</span><strong>${h(faceState.labResult?.enrolledCount || 0)}</strong></div>
    </div>
    <table class="hist-table face-table">
      <thead><tr><th>Rank</th><th>Worker</th><th>Distance</th><th>Label</th></tr></thead>
      <tbody>${topMatches.length ? topMatches.map((m, i) => `<tr><td>${i + 1}</td><td>${h(m.workerName)}</td><td>${h(m.distance)}</td><td>${h(m.matchLabel)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-cell">No enrolled workers available.</td></tr>'}</tbody>
    </table>`;
  }

  async function saveFaceLabResult(reviewStatus = 'Saved') {
    if (!faceState.labResult) {
      setStatus('faceLabStatus', 'Run a test scan first.', 'error');
      return;
    }
    try {
      const result = faceState.labResult;
      const testRef = db.ref('faceMatchTests').push();
      let upload = { url: '', path: '' };
      if (result.compressed) {
        upload = await uploadBlob(`faceMatchTests/${testRef.key}_${safeName(result.file?.name || 'test-selfie.jpg')}`, result.compressed);
      }
      const best = result.best || {};
      const record = {
        testId: testRef.key,
        testPhotoUrl: upload.url,
        testStoragePath: upload.path,
        faceDetected: !!result.detection?.faceDetected,
        multipleFacesDetected: !!result.detection?.multipleFacesDetected,
        bestMatchWorkerId: best.workerId || '',
        bestMatchWorkerName: best.workerName || '',
        bestMatchDistance: best.distance ?? null,
        matchLabel: best.matchLabel || 'Unknown',
        topMatches: result.topMatches || [],
        reviewStatus,
        reviewedBy: window._currentUser?.uid || '',
        reviewedAt: Date.now(),
        createdAt: Date.now()
      };
      await testRef.set(record);
      writeAudit('face_match_test_saved', 'faceMatchTest', testRef.key, { reviewStatus, bestMatchWorkerId: record.bestMatchWorkerId });
      setStatus('faceLabStatus', `Test saved as ${reviewStatus}.`, 'ok');
    } catch (e) {
      console.error('Save face lab result failed:', e);
      setStatus('faceLabStatus', e.message || 'Could not save test result.', 'error');
    }
  }

  function watchFaceInbox() {
    faceState.listeners.forEach(ref => ref.off());
    faceState.listeners = [];
    loadInboxProjectIds().then(projectIds => {
      if (!projectIds.length) {
        faceState.inboxRows = [];
        if (faceState.activeView === 'inbox') renderInboxView();
        return;
      }
      projectIds.forEach(pid => {
        const ref = db.ref(`pmosSelfieAttendance/${pid}`);
        ref.on('value', snap => {
          faceState.inboxRows = faceState.inboxRows.filter(row => row.projectId !== pid);
          const rows = [];
          snap.forEach(dateSnap => {
            dateSnap.forEach(itemSnap => rows.push({ ...(itemSnap.val() || {}), id: itemSnap.key, sourcePath: `pmosSelfieAttendance/${pid}/${dateSnap.key}/${itemSnap.key}` }));
          });
          faceState.inboxRows = faceState.inboxRows.concat(rows).sort((a, b) => (b.submittedAt || b.createdAt || 0) - (a.submittedAt || a.createdAt || 0));
          if (faceState.activeView === 'inbox') renderInboxView();
        }, err => console.warn('Face inbox listener failed:', err));
        faceState.listeners.push(ref);
      });
    });
  }

  async function loadInboxProjectIds() {
    const ids = assignedProjectIds();
    if (ids !== null) return ids;
    const snap = await db.ref('projects').once('value');
    const rows = [];
    snap.forEach(child => rows.push(child.key));
    return rows;
  }

  function renderInboxView() {
    const el = $('faceContent');
    if (!el) return;
    const rows = faceState.inboxRows || [];
    el.innerHTML = `<section class="face-card">
      <div class="face-card-head"><div><h3>Labor Attendance Inbox</h3><p>Review AI-assisted selfie attendance drafts before payroll.</p></div></div>
      <div class="face-inbox-list">
        ${rows.length ? rows.map(attendanceCard).join('') : '<p class="empty-hint">No selfie attendance drafts yet.</p>'}
      </div>
    </section>`;
  }

  function attendanceCard(row) {
    const approved = row.reviewStatus === 'Approved';
    const posted = row.payrollStatus === 'Posted';
    return `<article class="face-att-card">
      ${row.thumbnailUrl || row.selfieUrl ? `<img src="${h(row.thumbnailUrl || row.selfieUrl)}" alt="Selfie thumbnail">` : '<div class="face-empty-img">No photo</div>'}
      <div class="face-att-main">
        <div class="face-att-title">${h(row.suggestedWorkerName || 'Unknown worker')} <span>${h(row.matchLabel || 'Unknown')}</span></div>
        <div class="face-att-meta">${h(row.projectName || row.projectId)} - ${h(row.attendanceType || '')} - ${h(row.dailyCode || '')}</div>
        <div class="face-att-meta">Captured ${h(timeText(row.capturedAt))} - Distance ${row.matchDistance ?? '-'}</div>
        <div class="face-att-meta">Review: ${h(row.reviewStatus || 'For Review')} - Payroll: ${h(row.payrollStatus || 'Not Posted')} - Upload: ${h(row.uploadStatus || '')}</div>
      </div>
      <div class="face-att-actions">
        <button type="button" onclick="reviewFaceAttendance('${h(row.projectId)}','${h(row.date || todayKey(row.capturedAt))}','${h(row.attendanceId || row.id)}','Approved')" ${canReviewAttendance() ? '' : 'disabled'}>Approve</button>
        <button type="button" onclick="reviewFaceAttendance('${h(row.projectId)}','${h(row.date || todayKey(row.capturedAt))}','${h(row.attendanceId || row.id)}','Rejected')" ${canReviewAttendance() ? '' : 'disabled'}>Reject</button>
        <button type="button" onclick="reviewFaceAttendance('${h(row.projectId)}','${h(row.date || todayKey(row.capturedAt))}','${h(row.attendanceId || row.id)}','Needs Correction')" ${canReviewAttendance() ? '' : 'disabled'}>Needs Correction</button>
        <button type="button" onclick="changeFaceAttendanceWorker('${h(row.projectId)}','${h(row.date || todayKey(row.capturedAt))}','${h(row.attendanceId || row.id)}')" ${canReviewAttendance() ? '' : 'disabled'}>Change Worker</button>
        <button type="button" onclick="markFaceAttendanceUnknown('${h(row.projectId)}','${h(row.date || todayKey(row.capturedAt))}','${h(row.attendanceId || row.id)}')" ${canReviewAttendance() ? '' : 'disabled'}>Mark Unknown</button>
        <button type="button" onclick="postFaceAttendancePayroll('${h(row.projectId)}','${h(row.date || todayKey(row.capturedAt))}','${h(row.attendanceId || row.id)}')" ${approved && !posted && canPostPayroll() ? '' : 'disabled'}>Post to Payroll</button>
        ${row.selfieUrl ? `<a href="${h(row.selfieUrl)}" target="_blank" rel="noopener">Original Photo</a>` : ''}
      </div>
    </article>`;
  }

  async function updateAttendance(projectId, date, attendanceId, patch) {
    const path = `pmosSelfieAttendance/${projectId}/${date}/${attendanceId}`;
    await db.ref(path).update({ ...patch, updatedAt: Date.now() });
    await db.ref(`projects/${projectId}/pmosSelfieAttendance/${date}/${attendanceId}`).update({ ...patch, updatedAt: Date.now() }).catch(() => null);
  }

  async function reviewFaceAttendance(projectId, date, attendanceId, status) {
    if (!canReviewAttendance()) {
      showToast('Admin or PM access is required.', 'error');
      return;
    }
    await updateAttendance(projectId, date, attendanceId, {
      reviewStatus: status,
      reviewedBy: window._currentUser?.uid || '',
      reviewedByName: window._currentUser?.name || '',
      reviewedAt: Date.now()
    });
    writeAudit(`attendance_${status.toLowerCase().replace(/\s+/g, '_')}`, 'pmosSelfieAttendance', attendanceId, { projectId, date, newStatus: status });
    showToast(`Attendance marked ${status}.`);
  }

  async function changeFaceAttendanceWorker(projectId, date, attendanceId) {
    const workerName = prompt('Enter corrected worker name:');
    if (!workerName) return;
    const workerId = prompt('Enter corrected worker ID if known:') || '';
    await updateAttendance(projectId, date, attendanceId, {
      suggestedWorkerId: workerId,
      suggestedWorkerName: workerName.trim(),
      reviewStatus: 'Needs Correction',
      correctedBy: window._currentUser?.uid || '',
      correctedAt: Date.now()
    });
    writeAudit('match_manually_changed', 'pmosSelfieAttendance', attendanceId, { projectId, date, workerId, workerName });
    showToast('Matched worker changed for review.');
  }

  async function markFaceAttendanceUnknown(projectId, date, attendanceId) {
    await updateAttendance(projectId, date, attendanceId, {
      suggestedWorkerId: '',
      suggestedWorkerName: 'Unknown',
      matchLabel: 'Unknown',
      reviewStatus: 'For Review',
      reviewedBy: window._currentUser?.uid || '',
      reviewedAt: Date.now()
    });
    writeAudit('attendance_marked_unknown', 'pmosSelfieAttendance', attendanceId, { projectId, date });
    showToast('Attendance marked unknown.');
  }

  async function postFaceAttendancePayroll(projectId, date, attendanceId) {
    if (!canPostPayroll()) {
      showToast('Payroll access is required.', 'error');
      return;
    }
    const snap = await db.ref(`pmosSelfieAttendance/${projectId}/${date}/${attendanceId}`).once('value');
    const row = snap.val() || {};
    if (row.reviewStatus !== 'Approved') {
      showToast('Approve attendance before posting to payroll.', 'error');
      return;
    }
    const workerKey = row.projectWorkerId || String(row.suggestedWorkerId || '').replace(`${projectId}_`, '');
    if (!workerKey || row.suggestedWorkerName === 'Unknown') {
      showToast('Select a valid worker before payroll posting.', 'error');
      return;
    }
    const status = String(row.attendanceType || '').toLowerCase().includes('half') ? 'half' : 'present';
    const updates = {};
    updates[`projects/${projectId}/attendance/${workerKey}/${date}`] = {
      status,
      overtimeHours: 0,
      nightDiffHours: 0,
      source: FACE_SOURCE,
      sourceAttendanceId: attendanceId,
      weekKey: '',
      date,
      savedAt: Date.now(),
      savedBy: window._currentUser?.uid || '',
      savedByName: window._currentUser?.name || ''
    };
    updates[`pmosSelfieAttendance/${projectId}/${date}/${attendanceId}/payrollStatus`] = 'Posted';
    updates[`pmosSelfieAttendance/${projectId}/${date}/${attendanceId}/payrollPostedAt`] = Date.now();
    updates[`pmosSelfieAttendance/${projectId}/${date}/${attendanceId}/payrollPostedBy`] = window._currentUser?.uid || '';
    updates[`projects/${projectId}/pmosSelfieAttendance/${date}/${attendanceId}/payrollStatus`] = 'Posted';
    updates[`projects/${projectId}/pmosSelfieAttendance/${date}/${attendanceId}/payrollPostedAt`] = Date.now();
    updates[`projects/${projectId}/pmosSelfieAttendance/${date}/${attendanceId}/payrollPostedBy`] = window._currentUser?.uid || '';
    await db.ref().update(updates);
    writeAudit('attendance_posted_to_payroll', 'pmosSelfieAttendance', attendanceId, { projectId, date, workerKey, status });
    showToast('Attendance posted to payroll.');
  }

  function renderSettingsView() {
    const s = faceSettings();
    const el = $('faceContent');
    if (!el) return;
    el.innerHTML = `<section class="face-card">
      <div class="face-card-head"><div><h3>Face Settings</h3><p>Thresholds use distance, not fake certainty percentages.</p></div></div>
      <div class="face-form-grid">
        <label><span>Strong Match Distance</span><input id="faceStrongThreshold" type="number" min="0" max="2" step="0.01" value="${h(s.strongThreshold)}"></label>
        <label><span>Possible Match Distance</span><input id="facePossibleThreshold" type="number" min="0" max="2" step="0.01" value="${h(s.possibleThreshold)}"></label>
        <label><span>Model URL</span><input id="faceModelUrl" value="${h(s.modelUrl)}"></label>
        <label><span>Attendance Selfie Retention Days</span><input id="faceSelfieRetention" type="number" min="1" value="${h(s.attendanceSelfieRetentionDays)}"></label>
        <label><span>Test Photo Retention Days</span><input id="faceTestRetention" type="number" min="1" value="${h(s.testPhotoRetentionDays)}"></label>
        <label><span>Matching Enabled</span><select id="faceMatchingEnabled"><option value="true" ${s.matchingEnabled ? 'selected' : ''}>Enabled</option><option value="false" ${!s.matchingEnabled ? 'selected' : ''}>Disabled</option></select></label>
      </div>
      <div class="face-notice">Client-side matching requires descriptor reads in the browser. Firebase rules restrict this to authenticated project users, but stronger privacy needs a backend matcher later.</div>
      <div class="face-actions">
        <button class="btn-save-payroll" type="button" onclick="saveFaceSettings()" ${canManageFaces() ? '' : 'disabled'}>Save Settings</button>
      </div>
      <div id="faceSettingsStatus" class="face-status face-status-ok">Ready.</div>
    </section>`;
  }

  async function saveFaceSettings() {
    if (!canManageFaces()) {
      showToast('Admin or PM access is required.', 'error');
      return;
    }
    const settings = {
      strongThreshold: Number($('faceStrongThreshold')?.value || STRONG_DEFAULT),
      possibleThreshold: Number($('facePossibleThreshold')?.value || POSSIBLE_DEFAULT),
      modelUrl: $('faceModelUrl')?.value.trim() || DEFAULT_MODEL_URL,
      attendanceSelfieRetentionDays: Number($('faceSelfieRetention')?.value || 120),
      testPhotoRetentionDays: Number($('faceTestRetention')?.value || 30),
      matchingEnabled: $('faceMatchingEnabled')?.value !== 'false',
      updatedAt: Date.now(),
      updatedBy: window._currentUser?.uid || ''
    };
    await db.ref('faceSettings').update(settings);
    faceState.settings = settings;
    faceState.engineReady = false;
    faceState.engineError = '';
    writeAudit('face_settings_updated', 'faceSettings', 'global', settings);
    setStatus('faceSettingsStatus', 'Face settings saved.', 'ok');
  }

  async function renderAuditView() {
    const el = $('faceContent');
    if (!el) return;
    el.innerHTML = '<section class="face-card"><p class="empty-hint">Loading audit logs...</p></section>';
    const rows = [];
    try {
      const snap = await db.ref('auditLogs').orderByChild('timestamp').limitToLast(120).once('value');
      snap.forEach(child => {
        const row = child.val() || {};
        if (String(row.entityType || '').toLowerCase().includes('face') || String(row.entityType || '').includes('pmosSelfieAttendance') || String(row.action || '').includes('attendance')) {
          rows.push({ ...row, id: child.key });
        }
      });
    } catch (e) {
      console.warn('Global face audit read failed:', e);
    }
    rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    el.innerHTML = `<section class="face-card">
      <div class="face-card-head"><div><h3>Face Attendance Audit Logs</h3><p>Enrollment, matching, review, correction, deletion, and payroll posting records.</p></div></div>
      <table class="hist-table face-table">
        <thead><tr><th>Time</th><th>Action</th><th>User</th><th>Entity</th><th>Project</th></tr></thead>
        <tbody>${rows.length ? rows.map(r => `<tr><td>${h(timeText(r.timestamp))}</td><td>${h(r.action)}</td><td>${h(r.userName || r.userId || '')}</td><td>${h(r.entityType || '')}</td><td>${h(r.projectId || r.details?.projectId || '')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">No face attendance audit rows yet.</td></tr>'}</tbody>
      </table>
    </section>`;
  }

  function faceRefreshAll() {
    if (faceState.activeView) showFaceView(faceState.activeView);
    watchFaceInbox();
  }

  function openFaceDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not available on this device.'));
        return;
      }
      const req = indexedDB.open(FACE_DB_NAME, FACE_DB_VERSION);
      req.onupgradeneeded = () => {
        const dbi = req.result;
        if (!dbi.objectStoreNames.contains(FACE_STORE)) {
          const store = dbi.createObjectStore(FACE_STORE, { keyPath: 'localId' });
          store.createIndex('uploadStatus', 'metadata.uploadStatus', { unique: false });
          store.createIndex('createdAt', 'metadata.createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open face attendance queue.'));
    });
  }

  async function idbReq(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed.'));
    });
  }

  async function faceQueueStore(mode = 'readonly') {
    const dbi = await openFaceDb();
    const tx = dbi.transaction(FACE_STORE, mode);
    return { dbi, tx, store: tx.objectStore(FACE_STORE) };
  }

  async function idbPutFace(record) {
    const { dbi, tx, store } = await faceQueueStore('readwrite');
    try {
      await idbReq(store.put(record));
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save selfie queue item.'));
      });
    } finally {
      dbi.close();
    }
  }

  async function idbGetAllFaces() {
    const { dbi, store } = await faceQueueStore();
    try {
      return await idbReq(store.getAll());
    } finally {
      dbi.close();
    }
  }

  async function idbGetFace(localId) {
    const { dbi, store } = await faceQueueStore();
    try {
      return await idbReq(store.get(localId));
    } finally {
      dbi.close();
    }
  }

  async function idbDeleteFace(localId) {
    const { dbi, tx, store } = await faceQueueStore('readwrite');
    try {
      await idbReq(store.delete(localId));
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not delete queue item.'));
      });
    } finally {
      dbi.close();
    }
  }

  function injectPmos() {
    if (faceState.pmosInjected || !document.querySelector('.pmos-quick-actions') || !$('pmosForms')) return;
    faceState.pmosInjected = true;
    document.querySelector('.pmos-quick-actions').insertAdjacentHTML('afterbegin', `<button class="pmos-action" type="button" id="pmosFaceOpenBtn">
      <span>Selfie Scan Attendance</span><small>For Review</small>
    </button>`);
    $('pmosForms').insertAdjacentHTML('afterbegin', pmosFaceFormMarkup());
    const queueSection = document.querySelector('#pmosPhotoQueueList')?.closest('.pmos-today');
    if (queueSection) {
      queueSection.insertAdjacentHTML('afterend', `<section class="pmos-today" id="pmosFaceQueueSection">
        <div class="pmos-card-head">
          <div><div class="pmos-eyebrow">Face Attendance Queue</div><h2>Pending selfie attendance</h2></div>
          <button class="pmos-capture-btn" type="button" id="pmosFaceRetryAllBtn">Retry All</button>
        </div>
        <div id="pmosFaceQueueList" class="pmos-list"><p class="empty-hint">No pending selfie uploads.</p></div>
      </section>`);
    }
    attachPmosFaceHandlers();
    loadPmosFaceQueue();
    if (window.location.hash === '#selfie-scan' || window.location.pathname.includes('/attendance/selfie-scan')) {
      openPmosFaceScan();
    }
  }

  function pmosFaceFormMarkup() {
    return `<section id="pmosForm_faceAttendance" class="pmos-form-card hidden">
      <div class="pmos-card-head">
        <div><div class="pmos-eyebrow">Attendance</div><h2>Selfie Scan Attendance</h2></div>
      </div>
      <form id="pmosFaceForm">
        <div class="pmos-form-grid">
          <label class="pmos-field"><span>Project</span><select id="pmosFaceProject"></select></label>
          <label class="pmos-field"><span>Attendance Type</span><select id="pmosFaceType"><option>Time In</option><option>Time Out</option><option>Half-day</option><option>OT Note</option></select></label>
          <label class="pmos-field"><span>Daily Code</span><input id="pmosFaceDailyCode" readonly placeholder="Generated after project select"></label>
        </div>
        <div class="pmos-photo-capture">
          <input id="pmosFaceCamera" type="file" accept="image/*" capture="user" class="pmos-file-input">
          <input id="pmosFacePicker" type="file" accept="image/*" class="pmos-file-input">
          <div class="pmos-photo-buttons">
            <button class="pmos-capture-btn" type="button" id="pmosFaceTakeBtn">Take Selfie</button>
            <button class="pmos-capture-btn" type="button" id="pmosFaceChooseBtn">Choose Selfie</button>
          </div>
          <div id="pmosFacePreviewWrap" class="pmos-photo-preview hidden">
            <img id="pmosFacePreview" alt="Selected selfie preview">
            <div id="pmosFaceScanStatus" class="pmos-photo-size">Selfie selected.</div>
          </div>
        </div>
        <div id="pmosFaceResult" class="face-pmos-result"><p class="empty-hint">Take a selfie, then scan.</p></div>
        <div class="pmos-photo-buttons">
          <button class="pmos-save" type="button" id="pmosFaceScanBtn">Scan Selfie</button>
          <button class="pmos-save" type="submit" id="pmosFaceSubmitBtn">Submit Attendance Draft</button>
        </div>
      </form>
    </section>`;
  }

  function pmosProjectOptions() {
    const select = $('pmosProjectSelect');
    if (!select) return '<option value="">No project selected</option>';
    return Array.from(select.options).map(opt => `<option value="${h(opt.value)}" ${opt.selected ? 'selected' : ''}>${h(opt.textContent)}</option>`).join('');
  }

  function attachPmosFaceHandlers() {
    $('pmosFaceOpenBtn')?.addEventListener('click', openPmosFaceScan);
    $('pmosFaceTakeBtn')?.addEventListener('click', () => $('pmosFaceCamera')?.click());
    $('pmosFaceChooseBtn')?.addEventListener('click', () => $('pmosFacePicker')?.click());
    $('pmosFaceCamera')?.addEventListener('change', e => handlePmosFaceFile(e.target.files?.[0]));
    $('pmosFacePicker')?.addEventListener('change', e => handlePmosFaceFile(e.target.files?.[0]));
    $('pmosFaceProject')?.addEventListener('change', generateDailyCode);
    $('pmosFaceScanBtn')?.addEventListener('click', runPmosFaceScan);
    $('pmosFaceForm')?.addEventListener('submit', e => {
      e.preventDefault();
      submitPmosFaceDraft(e.submitter);
    });
    $('pmosFaceRetryAllBtn')?.addEventListener('click', () => uploadPmosFaceQueue(true));
  }

  function openPmosFaceScan() {
    injectPmos();
    document.querySelectorAll('.pmos-form-card').forEach(el => el.classList.add('hidden'));
    $('pmosForm_faceAttendance')?.classList.remove('hidden');
    document.querySelectorAll('.pmos-action').forEach(btn => btn.classList.remove('is-active'));
    $('pmosFaceOpenBtn')?.classList.add('is-active');
    const select = $('pmosFaceProject');
    if (select) select.innerHTML = pmosProjectOptions();
    generateDailyCode();
    $('pmosForm_faceAttendance')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function generateDailyCode() {
    const pid = $('pmosFaceProject')?.value || $('pmosProjectSelect')?.value || '';
    const date = todayKey();
    if (!pid) return;
    try {
      const ref = db.ref(`attendanceDailyCodes/${pid}/${date}`);
      const snap = await ref.once('value');
      let code = snap.val()?.dailyCode || '';
      if (!code) {
        code = `L17-${Math.floor(100 + Math.random() * 900)}`;
        await ref.set({ projectId: pid, date, dailyCode: code, createdAt: Date.now(), createdBy: window._currentUser?.uid || '' });
      }
      const el = $('pmosFaceDailyCode');
      if (el) el.value = code;
    } catch (e) {
      const el = $('pmosFaceDailyCode');
      if (el) el.value = 'Offline - pending';
    }
  }

  function handlePmosFaceFile(file) {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      setHTML('pmosFaceResult', '<p class="empty-hint">Select an image file.</p>');
      return;
    }
    faceState.pmosFile = file;
    faceState.pmosScanResult = null;
    if (faceState.pmosPreviewUrl) URL.revokeObjectURL(faceState.pmosPreviewUrl);
    faceState.pmosPreviewUrl = URL.createObjectURL(file);
    const img = $('pmosFacePreview');
    if (img) img.src = faceState.pmosPreviewUrl;
    $('pmosFacePreviewWrap')?.classList.remove('hidden');
    setText('pmosFaceScanStatus', `Selected: ${file.name || 'selfie'} (${Math.round((file.size || 0) / 1024)} KB)`);
  }

  async function runPmosFaceScan() {
    const file = faceState.pmosFile;
    const pid = $('pmosFaceProject')?.value || $('pmosProjectSelect')?.value || '';
    if (!file || !pid) {
      setHTML('pmosFaceResult', '<p class="empty-hint">Select a project and selfie first.</p>');
      return;
    }
    try {
      setText('pmosFaceScanStatus', 'Scanning selfie...');
      await loadSettings();
      if (!faceSettings().matchingEnabled) throw new Error('Face matching is disabled in Face Settings.');
      const compressed = await resizeImageBlob(file, 1400, 0.84);
      const thumbnail = await resizeImageBlob(file, 360, 0.78);
      const hash = await sha256Blob(compressed);
      const detection = await detectDescriptor(compressed, 'pmosFaceScanStatus');
      if (!detection.ok) {
        faceState.pmosScanResult = { detection, topMatches: [], best: null, compressed, thumbnail, imageHash: hash };
        renderPmosFaceResult(null, []);
        setText('pmosFaceScanStatus', detection.error);
        return;
      }
      const comparison = await compareDescriptor(detection.descriptor, pid);
      faceState.pmosScanResult = { detection, ...comparison, compressed, thumbnail, imageHash: hash };
      renderPmosFaceResult(comparison.best, comparison.topMatches);
      setText('pmosFaceScanStatus', comparison.best ? `Suggested: ${comparison.best.workerName}` : 'No enrolled worker matched.');
    } catch (e) {
      console.error('PMOS face scan failed:', e);
      setHTML('pmosFaceResult', `<p class="empty-hint">${h(e.message || 'Scan failed.')}</p>`);
      setText('pmosFaceScanStatus', e.message || 'Scan failed.');
    }
  }

  function renderPmosFaceResult(best, topMatches) {
    setHTML('pmosFaceResult', `<div class="face-mini-table">
      <div><span>Suggested Worker</span><strong>${h(best?.workerName || 'Unknown')}</strong></div>
      <div><span>Match Label</span><strong>${h(best?.matchLabel || 'Unknown')}</strong></div>
      <div><span>Distance</span><strong>${best ? h(best.distance) : '-'}</strong></div>
    </div>
    <table class="hist-table face-table">
      <thead><tr><th>Rank</th><th>Worker</th><th>Distance</th><th>Label</th></tr></thead>
      <tbody>${topMatches.length ? topMatches.map((m, i) => `<tr><td>${i + 1}</td><td>${h(m.workerName)}</td><td>${h(m.distance)}</td><td>${h(m.matchLabel)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-cell">Unknown / Needs Manual Review</td></tr>'}</tbody>
    </table>`);
  }

  async function getOptionalLocation() {
    if (!navigator.geolocation) return null;
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(pos => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      }), () => resolve(null), { enableHighAccuracy: false, maximumAge: 120000, timeout: 6000 });
    });
  }

  async function submitPmosFaceDraft(button) {
    const pid = $('pmosFaceProject')?.value || $('pmosProjectSelect')?.value || '';
    const projectName = $('pmosFaceProject')?.selectedOptions?.[0]?.textContent || $('pmosProjectSelect')?.selectedOptions?.[0]?.textContent || pid;
    const attendanceType = $('pmosFaceType')?.value || 'Time In';
    const scan = faceState.pmosScanResult;
    if (!pid || !faceState.pmosFile || !scan) {
      setText('pmosFaceScanStatus', 'Scan the selfie before submitting.');
      return;
    }
    const now = Date.now();
    const date = todayKey(now);
    const localId = `face_${now}_${Math.random().toString(36).slice(2, 9)}`;
    const attendanceId = db.ref().push().key;
    const best = scan.best || {};
    const dailyCode = $('pmosFaceDailyCode')?.value || '';
    const metadata = {
      localId,
      attendanceId,
      projectId: pid,
      projectName,
      date,
      attendanceType,
      capturedAt: now,
      submittedAt: now,
      uploadStatus: 'Queued',
      uploadProgress: 0,
      faceDetected: !!scan.detection?.faceDetected,
      multipleFacesDetected: !!scan.detection?.multipleFacesDetected,
      suggestedWorkerId: best.workerId || '',
      projectWorkerId: best.projectWorkerId || '',
      suggestedWorkerName: best.workerName || 'Unknown',
      matchDistance: best.distance ?? null,
      matchLabel: best.matchLabel || 'Unknown',
      topMatches: scan.topMatches || [],
      dailyCode,
      gpsLocation: await getOptionalLocation(),
      imageHash: scan.imageHash || '',
      reviewStatus: 'For Review',
      payrollStatus: 'Not Posted',
      source: FACE_SOURCE,
      createdBy: window._currentUser?.uid || '',
      createdByName: window._currentUser?.name || '',
      originalFileName: faceState.pmosFile.name || 'selfie.jpg',
      originalSize: faceState.pmosFile.size || 0,
      compressedSize: scan.compressed?.size || 0,
      thumbnailSize: scan.thumbnail?.size || 0
    };
    await idbPutFace({ localId, metadata, imageBlob: scan.compressed, thumbnailBlob: scan.thumbnail });
    await loadPmosFaceQueue();
    writeAudit('selfie_submitted', 'pmosSelfieAttendance', attendanceId, { projectId: pid, attendanceType, matchLabel: metadata.matchLabel });
    writeAudit('match_suggested', 'pmosSelfieAttendance', attendanceId, { projectId: pid, suggestedWorkerId: metadata.suggestedWorkerId, matchDistance: metadata.matchDistance });
    showToast('Attendance draft saved locally.');
    setText('pmosFaceScanStatus', navigator.onLine ? 'Saved locally. Upload starting...' : 'Saved locally. It will sync when online.');
    if (navigator.onLine) uploadPmosFaceQueue(true);
    if (button) button.blur();
  }

  async function loadPmosFaceQueue() {
    try {
      const rows = await idbGetAllFaces();
      faceState.pmosQueue = rows.sort((a, b) => (b.metadata?.createdAt || b.metadata?.capturedAt || 0) - (a.metadata?.createdAt || a.metadata?.capturedAt || 0));
      renderPmosFaceQueue();
    } catch (e) {
      setHTML('pmosFaceQueueList', '<p class="empty-hint">Could not read local selfie queue.</p>');
    }
  }

  function renderPmosFaceQueue() {
    const el = $('pmosFaceQueueList');
    if (!el) return;
    faceState.pmosQueueUrls.forEach(url => URL.revokeObjectURL(url));
    faceState.pmosQueueUrls = [];
    const rows = faceState.pmosQueue.filter(item => item.metadata?.uploadStatus !== 'Synced');
    if (!rows.length) {
      el.innerHTML = '<p class="empty-hint">No pending selfie uploads.</p>';
      return;
    }
    el.innerHTML = rows.map(item => {
      const meta = item.metadata || {};
      const thumbUrl = item.thumbnailBlob ? URL.createObjectURL(item.thumbnailBlob) : '';
      if (thumbUrl) faceState.pmosQueueUrls.push(thumbUrl);
      const progress = Math.max(0, Math.min(100, Number(meta.uploadProgress || 0)));
      return `<article class="pmos-queue-item">
        ${thumbUrl ? `<img src="${thumbUrl}" alt="">` : '<div class="pmos-queue-thumb">Selfie</div>'}
        <div class="pmos-queue-main">
          <strong>${h(meta.suggestedWorkerName || 'Unknown')} - ${h(meta.attendanceType || '')}</strong>
          <span>${h(meta.projectName || meta.projectId || '')} - ${h(meta.dailyCode || '')} - ${h(meta.matchLabel || 'Unknown')}</span>
          <div class="pmos-progress"><i style="width:${progress}%"></i></div>
          ${meta.errorMessage ? `<em>${h(meta.errorMessage)}</em>` : ''}
        </div>
        <div class="pmos-queue-actions">
          <b>${h(meta.uploadStatus || 'Queued')}</b>
          <button type="button" onclick="pmosRetryFaceAttendance('${h(item.localId)}')">Retry</button>
        </div>
      </article>`;
    }).join('');
  }

  async function updateFaceQueueItem(item, patch) {
    const next = { ...item, metadata: { ...(item.metadata || {}), ...patch, updatedAt: Date.now() } };
    await idbPutFace(next);
    const idx = faceState.pmosQueue.findIndex(q => q.localId === next.localId);
    if (idx >= 0) faceState.pmosQueue[idx] = next;
    else faceState.pmosQueue.unshift(next);
    renderPmosFaceQueue();
    return next;
  }

  async function uploadPmosFaceQueue(includeFailed = false) {
    if (faceState.pmosUploadActive || !navigator.onLine) return;
    await loadPmosFaceQueue();
    const queue = faceState.pmosQueue.filter(item => {
      const status = String(item.metadata?.uploadStatus || 'Queued');
      return status === 'Queued' || status === 'Local Draft' || (includeFailed && ['Failed', 'Uploading'].includes(status));
    });
    if (!queue.length) return;
    faceState.pmosUploadActive = true;
    try {
      for (const item of queue) await uploadPmosFaceQueueItem(item);
    } finally {
      faceState.pmosUploadActive = false;
      await loadPmosFaceQueue();
    }
  }

  async function uploadPmosFaceQueueItem(item) {
    let current = await updateFaceQueueItem(item, { uploadStatus: 'Uploading', uploadProgress: 3, errorMessage: '' });
    const meta = current.metadata || {};
    const filename = `${meta.attendanceId}_${safeName(meta.originalFileName || 'selfie.jpg')}`;
    const folder = `attendanceSelfies/${meta.projectId}/${meta.date}`;
    const storagePath = `${folder}/${filename}`;
    const thumbnailStoragePath = `${folder}/thumb_${filename}`;
    try {
      const [photoUpload, thumbUpload] = await Promise.all([
        uploadBlob(storagePath, current.imageBlob),
        uploadBlob(thumbnailStoragePath, current.thumbnailBlob)
      ]);
      current = await updateFaceQueueItem(current, {
        uploadProgress: 82,
        selfieUrl: photoUpload.url,
        thumbnailUrl: thumbUpload.url,
        storagePath: photoUpload.path,
        thumbnailStoragePath: thumbUpload.path
      });
      const existing = await db.ref(`pmosSelfieAttendance/${meta.projectId}/${meta.date}`).once('value');
      let duplicateWarning = '';
      existing.forEach(child => {
        const row = child.val() || {};
        if (row.imageHash && row.imageHash === meta.imageHash) duplicateWarning = 'Possible reused selfie image.';
        if (row.suggestedWorkerId && row.suggestedWorkerId === meta.suggestedWorkerId && row.attendanceType === meta.attendanceType) duplicateWarning = 'Possible duplicate attendance type for worker today.';
      });
      const record = {
        ...meta,
        selfieUrl: photoUpload.url,
        thumbnailUrl: thumbUpload.url,
        storagePath: photoUpload.path,
        thumbnailStoragePath: thumbUpload.path,
        uploadStatus: 'Synced',
        uploadedAt: Date.now(),
        duplicateWarning,
        reviewStatus: 'For Review',
        payrollStatus: 'Not Posted'
      };
      const updates = {};
      updates[`pmosSelfieAttendance/${meta.projectId}/${meta.date}/${meta.attendanceId}`] = record;
      updates[`projects/${meta.projectId}/pmosSelfieAttendance/${meta.date}/${meta.attendanceId}`] = record;
      await db.ref().update(updates);
      await idbDeleteFace(current.localId);
      showToast('Attendance draft synced to ACPM.');
    } catch (e) {
      console.error('Face attendance upload failed:', e);
      await updateFaceQueueItem(current, {
        uploadStatus: 'Failed',
        uploadProgress: 0,
        errorMessage: e.message || e.code || 'Upload failed'
      });
    }
  }

  async function pmosRetryFaceAttendance(localId) {
    const item = await idbGetFace(localId);
    if (!item) {
      await loadPmosFaceQueue();
      return;
    }
    await updateFaceQueueItem(item, { uploadStatus: 'Queued', uploadProgress: 0, errorMessage: '' });
    await uploadPmosFaceQueue(true);
  }

  function boot() {
    loadSettings();
    if (window.ACPM_PAGE === 'pmos' || String(location.pathname).toLowerCase().endsWith('/pmos.html')) {
      const timer = setInterval(() => {
        injectPmos();
        if (faceState.pmosInjected) clearInterval(timer);
      }, 300);
      window.addEventListener('online', () => uploadPmosFaceQueue(true));
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) uploadPmosFaceQueue(true);
      });
    } else {
      const timer = setInterval(() => {
        injectAcpm();
        if (faceState.injected) clearInterval(timer);
      }, 300);
    }
  }

  window.selectFaceWorker = selectFaceWorker;
  window.saveFaceEnrollment = saveFaceEnrollment;
  window.revokeFaceEnrollment = revokeFaceEnrollment;
  window.deleteFaceData = deleteFaceData;
  window.showFaceView = showFaceView;
  window.faceRefreshAll = faceRefreshAll;
  window.runFaceLab = runFaceLab;
  window.saveFaceLabResult = saveFaceLabResult;
  window.saveFaceSettings = saveFaceSettings;
  window.reviewFaceAttendance = reviewFaceAttendance;
  window.changeFaceAttendanceWorker = changeFaceAttendanceWorker;
  window.markFaceAttendanceUnknown = markFaceAttendanceUnknown;
  window.postFaceAttendancePayroll = postFaceAttendancePayroll;
  window.pmosRetryFaceAttendance = pmosRetryFaceAttendance;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
