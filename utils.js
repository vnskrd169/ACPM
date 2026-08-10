/* ══════════════════════════════════════════════════════════════
   ACPM — Shared Utilities
   Single home for helpers that were previously duplicated across
   labor/materials/billing/changeorders/suppliers/sitelog.
   MUST be loaded before all other scripts.
   ══════════════════════════════════════════════════════════════ */

// ── DOM helpers ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };

const FEATURE_STORAGE_KEYS = {
  extras: 'acpm_showExtras'
};

function getFeatureFlag(name, fallback = false) {
  try {
    const raw = localStorage.getItem(FEATURE_STORAGE_KEYS[name] || `acpm_${name}`);
    if (raw === null) return fallback;
    return raw === '1' || raw === 'true';
  } catch (e) {
    return fallback;
  }
}

function setFeatureFlag(name, enabled) {
  try {
    localStorage.setItem(FEATURE_STORAGE_KEYS[name] || `acpm_${name}`, enabled ? '1' : '0');
  } catch (e) { /* ignore storage failures */ }
}

// ── Formatting ──────────────────────────────────────────────
function peso(n) {
  if (n === undefined || n === null) return '₱0.00';
  const num = parseFloat(n) || 0;
  return '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(part, whole) {
  if (!whole || !parseFloat(whole)) return 0;
  return Math.round((parseFloat(part) / parseFloat(whole)) * 100);
}

function budgetBarClass(p) {
  return p >= 95 ? 'bar-danger' : p >= 80 ? 'bar-warn' : 'bar-ok';
}

// ── HTML escaping (safe text injection) ─────────────────────
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// ── CSV escaping (RFC 4180-ish) ─────────────────────────────
function escapeCsv(text) {
  if (text === null || text === undefined) return '';
  const s = String(text);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Build + download a CSV/text file.
function downloadTextFile(filename, content, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isoDateStr() {
  return new Date().toISOString().slice(0, 10);
}

// ════════════════════════════════════════════════════════════
//  PREMIUM TOAST SYSTEM
//  Animated, icon-rich, queue-aware notifications.
//  Types: success, error, warn, info
// ════════════════════════════════════════════════════════════
const TOAST_EMOJIS = {
  success: '✅',
  error: '❌',
  warn: '⚠️',
  info: 'ℹ️'
};

let _toastQueue = [];
let _toastShowing = false;

function showToast(msg, type = 'success', duration = 3500) {
  _toastQueue.push({ msg, type, duration });
  if (!_toastShowing) _processToastQueue();
}

function _processToastQueue() {
  if (!_toastQueue.length) { _toastShowing = false; return; }
  _toastShowing = true;
  const { msg, type, duration } = _toastQueue.shift();
  _renderToast(msg, type, duration);
}

function _renderToast(msg, type, duration) {
  if (!document.body) { _toastShowing = false; _processToastQueue(); return; }
  const existing = document.querySelector('.toast-msg');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast-msg toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');

  const icon = TOAST_EMOJIS[type] || 'ℹ️';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${escapeHtml(msg)}</span><button class="toast-dismiss" aria-label="Dismiss">✕</button>`;

  toast.querySelector('.toast-dismiss').addEventListener('click', () => {
    toast.classList.add('toast-exit');
    setTimeout(() => { toast.remove(); _processToastQueue(); }, 200);
  });

  document.body.appendChild(toast);

  // Trigger entrance animation
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  setTimeout(() => {
    if (!toast.parentNode) return;
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-exit');
    setTimeout(() => {
      toast.remove();
      _processToastQueue();
    }, 250);
  }, duration);
}

// ════════════════════════════════════════════════════════════
//  ERROR MESSAGE TRANSLATION
//  Never show raw Firebase errors to users.
// ════════════════════════════════════════════════════════════
const ERROR_MESSAGES = {
  'permission_denied': 'You don\'t have permission to perform this action. Contact your admin.',
  'network_error': 'Connection lost. Please check your internet and try again.',
  'disconnected': 'Connection lost. Please check your internet and try again.',
  'unavailable': 'Service temporarily unavailable. Please try again in a moment.',
  'timeout': 'Request timed out. Please try again.',
  'unknown': 'Something went wrong. Please try again.',
  'overlap': 'This record conflicts with an existing entry. Please check the dates.',
  'duplicate': 'A record with the same details already exists.',
  'validation': 'Please check your input and try again.',
  'not_found': 'The requested record could not be found. It may have been removed.',
  'quota_exceeded': 'Database quota temporarily exceeded. Please try again later.',
  'rate_limit': 'Too many requests. Please wait a moment and try again.'
};

function friendlyError(error) {
  if (!error) return ERROR_MESSAGES.unknown;
  const code = error.code || error.message || String(error);
  const msg = ERROR_MESSAGES[code] ||
    ERROR_MESSAGES[Object.keys(ERROR_MESSAGES).find(k => code.toLowerCase().includes(k))] ||
    ERROR_MESSAGES.unknown;
  return msg;
}

// ════════════════════════════════════════════════════════════
//  PREFERENCE PERSISTENCE (Smart Memory)
//  Remember user's workspace state across sessions.
// ════════════════════════════════════════════════════════════
const PREF_KEYS = {
  lastProjectId: 'acpm_lastProjectId',
  lastTab: 'acpm_lastTab',
  lastHubTab: 'acpm_lastHubTab',
  collapsedPanels: 'acpm_collapsedPanels',
  theme: 'acpm_theme',
  lastFilters: 'acpm_lastFilters',
  sidebarState: 'acpm_sidebarState'
};

function savePreference(key, value) {
  try {
    const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
    localStorage.setItem(key, serialized);
  } catch (e) { /* silent */ }
}

function loadPreference(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch { return raw; }
  } catch (e) { return fallback; }
}

function removePreference(key) {
  try { localStorage.removeItem(key); } catch (e) { /* silent */ }
}

// ════════════════════════════════════════════════════════════
//  OPTIMISTIC UI HELPERS
//  Update UI instantly before Firebase confirms
// ════════════════════════════════════════════════════════════
function optimisticUpdate(elId, renderFn) {
  const el = $(elId);
  if (!el) return () => {};
  const prevHTML = el.innerHTML;
  try {
    renderFn();
  } catch (e) {
    el.innerHTML = prevHTML;
  }
  return () => {
    el.innerHTML = prevHTML;
  };
}

// ════════════════════════════════════════════════════════════
//  PRELOAD HELPERS — warm caches so data appears instantly
// ════════════════════════════════════════════════════════════
function preloadProjectData(pid) {
  if (!pid || typeof firebase === 'undefined') return;
  // Fire the query so Firebase SDK warms its connection cache
  firebase.database().ref(`projects/${pid}`).once('value', snap => {
    // Cache the result for instant re-use
    if (typeof cacheProject === 'function') {
      cacheProject(pid, { id: pid, ...snap.val() });
    }
  }, () => { /* preload failures are non-critical */ });
}

// ════════════════════════════════════════════════════════════
//  ONBOARDING STATE RENDERER
//  Premium guided empty state with next-action prompts
//  Usage: container.innerHTML = renderOnboardingState(options)
//  Options: { icon, title, desc, steps[], ctaLabel, ctaAction,
//             ctaHref, subText, variant: 'full'|'card'|'inline' }
// ════════════════════════════════════════════════════════════
function renderOnboardingState(opts = {}) {
  const {
    icon = '📋',
    title = 'Get Started',
    desc = '',
    steps = [],
    ctaLabel = '',
    ctaAction = null,
    ctaHref = '',
    subText = '',
    variant = 'full'
  } = opts;

  if (variant === 'card') {
    return `<div class="onboarding-card" ${ctaAction ? `data-action="${escapeHtml(ctaAction)}"` : ''}>
      <div class="onboarding-card-icon">${icon}</div>
      <div class="onboarding-card-content">
        <div class="onboarding-card-title">${escapeHtml(title)}</div>
        <div class="onboarding-card-desc">${escapeHtml(desc)}</div>
      </div>
      <div class="onboarding-card-arrow">→</div>
    </div>`;
  }

  if (variant === 'inline') {
    return `<div class="empty-state-inline">
      <div style="font-size:24px;margin-bottom:8px;opacity:0.5">${icon}</div>
      <div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:4px">${escapeHtml(title)}</div>
      ${desc ? `<div style="font-size:12px;color:var(--muted);line-height:1.4">${escapeHtml(desc)}</div>` : ''}
      ${ctaLabel ? `<button class="btn-primary btn-sm mt-2" ${ctaAction ? `onclick="${escapeHtml(ctaAction)}"` : ''}>${escapeHtml(ctaLabel)}</button>` : ''}
    </div>`;
  }

  // full variant
  const stepsHtml = steps.length ? `<div class="onboarding-state-steps">
    ${steps.map((s, i) => `<div class="onboarding-state-step">
      <div class="onboarding-state-step-num">${i + 1}</div>
      <span>${escapeHtml(s)}</span>
    </div>`).join('')}
  </div>` : '';

  return `<div class="onboarding-state">
    <div class="onboarding-state-icon">${icon}</div>
    <div class="onboarding-state-title">${escapeHtml(title)}</div>
    ${desc ? `<div class="onboarding-state-desc">${escapeHtml(desc)}</div>` : ''}
    ${stepsHtml}
    ${ctaLabel ? `<div class="onboarding-state-cta">
      ${ctaHref ? `<a href="${escapeHtml(ctaHref)}" class="btn-primary btn-lg">${escapeHtml(ctaLabel)}</a>`
        : `<button class="btn-primary btn-lg" ${ctaAction ? `onclick="${escapeHtml(ctaAction)}"` : ''}>${escapeHtml(ctaLabel)}</button>`}
      ${subText ? `<span class="onboarding-state-sub">${escapeHtml(subText)}</span>` : ''}
    </div>` : ''}
  </div>`;
}

window.renderOnboardingState = renderOnboardingState;

// ════════════════════════════════════════════════════════════
//  PANEL SKELETON → CONTENT TRANSITION
//  When data arrives, fade out the skeleton and fade in the
//  real panel content simultaneously. The content is wrapped
//  in .panel-content-wrap (opacity: 0 initially).
// ════════════════════════════════════════════════════════════
function hidePanelSkeleton(skeletonId) {
  const el = $(skeletonId);
  if (!el) return;

  // Find the content wrapper sibling and fade it in
  const contentWrap = el.nextElementSibling?.classList.contains('panel-content-wrap')
    ? el.nextElementSibling
    : el.parentNode?.querySelector('.panel-content-wrap');
  if (contentWrap) {
    contentWrap.classList.add('loaded');
  }

  // Fade out skeleton then remove
  el.classList.add('panel-skeleton-hidden');
  setTimeout(() => {
    if (el.parentNode) el.remove();
  }, 250);
}

window.hidePanelSkeleton = hidePanelSkeleton;

// ── Toast (kept here so all modules share one) ──────────────
window.showToast = showToast;
window.friendlyError = friendlyError;
window.savePreference = savePreference;
window.loadPreference = loadPreference;
window.removePreference = removePreference;
window.optimisticUpdate = optimisticUpdate;
window.preloadProjectData = preloadProjectData;

window.PREF_KEYS = PREF_KEYS;

// ════════════════════════════════════════════════════════════
//  safeCounterIncrement — Atomic counter increment via transaction
//  Prevents race conditions when two writes try to increment
//  the same counter simultaneously.
// ════════════════════════════════════════════════════════════
function safeCounterIncrement(ref, amount) {
  return ref.transaction(current => {
    return (parseFloat(current) || 0) + amount;
  }, (error, committed, snapshot) => {
    if (error || !committed) {
      console.warn('counter transaction failed/aborted', error);
    }
  }, true);
}

window.safeCounterIncrement = safeCounterIncrement;

// ── Safe DB wrapper ─────────────────────────────────────────
async function safeDb(fn, errMsg) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    showToast(friendlyError(e) || errMsg || 'Database error', 'error');
    throw e;
  }
}

// ── Audit log ────────────────────────────────────────────────
function auditLog(action, entityType, entityId, details = {}) {
  const user = (typeof window !== 'undefined' && window._currentUser) ? window._currentUser : { uid: 'anonymous', role: 'apm', name: 'System' };
  const activePid = (typeof window !== 'undefined' && window._currentPid) ? window._currentPid : null;
  const pid = details.projectId || activePid || null;
  const now = Date.now();
  const logEntry = {
    action,
    entityType,
    entityId,
    module: entityType,
    recordId: entityId,
    details,
    previousStatus: details.previousStatus || details.oldStatus || null,
    newStatus: details.newStatus || details.status || null,
    notes: details.notes || details.reason || null,
    userId: user.uid,
    userName: user.name,
    userEmail: user.email || null,
    userRole: user.role,
    timestamp: now,
    date: new Date().toLocaleDateString('en-PH'),
    projectId: pid
  };
  console.log('AUDIT:', logEntry);

  try {
    if (typeof firebase !== 'undefined' && firebase.database) {
      firebase.database().ref('auditLogs').push(logEntry, error => {
        if (error) {
          console.warn('auditLog global write skipped:', error.code || error.message || error);
          persistAuditFallback(logEntry);
        }
      });
      if (pid && entityType !== 'task') {
        const activityEntry = {
          type: `${entityType}.${action}`,
          module: entityType,
          action,
          recordId: entityId || '',
          projectId: pid,
          title: details.title || details.name || details.description || '',
          previousStatus: logEntry.previousStatus,
          newStatus: logEntry.newStatus,
          notes: logEntry.notes,
          createdAt: now,
          createdBy: user.uid || 'system',
          createdByName: user.name || 'System'
        };
        firebase.database().ref(`projects/${pid}/activity`).push(activityEntry, activityError => {
          if (activityError) console.warn('project activity write skipped:', activityError.code || activityError.message || activityError);
        });
      }
    }
  } catch (e) { /* never let audit logging break the calling action */ }
}

function persistAuditFallback(logEntry) {
  try {
    if (typeof firebase === 'undefined' || !firebase.database || !logEntry) return;
    const projectId = logEntry.projectId || logEntry.details?.projectId || '';
    let fallbackPath = '';
    if (projectId) {
      fallbackPath = `projects/${projectId}/auditLogs`;
    } else if (logEntry.entityType === 'supplier' && logEntry.entityId) {
      fallbackPath = `supplierAuditLogs/${logEntry.entityId}`;
    }
    if (!fallbackPath) return;
    firebase.database().ref(fallbackPath).push({
      ...logEntry,
      globalPathDenied: true,
      fallbackPath: true
    }, fallbackError => {
      if (fallbackError) console.warn('auditLog fallback skipped:', fallbackError.code || fallbackError.message || fallbackError);
    });
  } catch (e) { /* audit fallback is also fire-and-forget */ }
}

async function pruneAuditLog(keepLatest = 2000) {
  try {
    const snap = await firebase.database().ref('auditLogs').orderByChild('timestamp').once('value');
    const keys = [];
    snap.forEach(c => { keys.push(c.key); });
    if (keys.length <= keepLatest) return;
    const updates = {};
    keys.slice(0, keys.length - keepLatest).forEach(k => updates[k] = null);
    await firebase.database().ref('auditLogs').update(updates);
  } catch (e) { console.error('pruneAuditLog failed', e); }
}

window.pruneAuditLog = pruneAuditLog;
window.auditLog = auditLog;

// ════════════════════════════════════════════════════════════
//  withBusy — generic double-submit guard
// ════════════════════════════════════════════════════════════
async function withBusy(btn, asyncFn) {
  if (!btn) return asyncFn();
  if (btn.dataset.busy === '1') return;
  const orig = btn.innerHTML;
  btn.dataset.busy = '1';
  btn.classList.add('is-busy');
  btn.disabled = true;
  try {
    return await asyncFn();
  } finally {
    btn.dataset.busy = '0';
    btn.classList.remove('is-busy');
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

async function withBusyId(btnId, asyncFn) {
  return withBusy($(btnId), asyncFn);
}

// ════════════════════════════════════════════════════════════
//  delegateEvent
// ════════════════════════════════════════════════════════════
function delegateEvent(root, eventName, selector, handler) {
  const el = typeof root === 'string' ? $(root) : root;
  if (!el) return () => {};
  const wrapped = e => {
    const target = e.target.closest(selector);
    if (target && el.contains(target)) handler(e, target, target.dataset);
  };
  el.addEventListener(eventName, wrapped);
  return () => el.removeEventListener(eventName, wrapped);
}

function getKey(ds, attr = 'key') {
  return ds && ds[attr];
}

// ════════════════════════════════════════════════════════════
//  Inventory key normalization
// ════════════════════════════════════════════════════════════
function normalizeInvKey(desc, size = '') {
  return `${String(desc || '').trim().toLowerCase()}||${String(size || '').trim().toLowerCase()}`;
}

// ════════════════════════════════════════════════════════════
//  Shared Validators
// ════════════════════════════════════════════════════════════
function validateString(value, maxLen = 100) {
  const s = String(value || '').trim();
  if (!s) return { ok: false, msg: 'Required field is empty.' };
  if (s.length > maxLen) return { ok: false, msg: `Too long (max ${maxLen} characters).` };
  return { ok: true, value: s };
}

function validateNumber(value, min = 0, max = 999999999) {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return { ok: false, msg: 'Must be a valid number.' };
  if (n < min) return { ok: false, msg: `Must be at least ${min}.` };
  if (n > max) return { ok: false, msg: `Must be at most ${max}.` };
  return { ok: true, value: n };
}

function validateProjectName(name) {
  return validateString(name, 50);
}

function validateBudget(amount) {
  return validateNumber(amount, 0, 999999999);
}

function validateEmail(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return { ok: false, msg: 'Email is required.' };
  if (!s.includes('@')) return { ok: false, msg: 'Invalid email format.' };
  return { ok: true, value: s };
}

window.validateString = validateString;
window.validateNumber = validateNumber;
window.validateProjectName = validateProjectName;
window.validateBudget = validateBudget;
window.validateEmail = validateEmail;
window.getFeatureFlag = getFeatureFlag;
window.setFeatureFlag = setFeatureFlag;

// ── Access Guard ──────────────────────────────────────────
function isProjectReadOnly(pid) {
  if (!pid) return false;
  const activePid = (typeof window !== 'undefined' && window._currentPid) || null;
  const status = activePid === pid
    ? String(window._currentProjectStatus || '').toLowerCase()
    : '';
  return status === 'completed'
    || status === 'archived'
    || (!!window._isReadOnly && (!activePid || activePid === pid));
}

function showReadOnlyBlocked() {
  showToast('This project is read-only. Reopen it before making changes.', 'warn');
}

function requireEdit(pid) {
  const user = (typeof window !== 'undefined' && window._currentUser) || {};
  if (!pid) {
    showToast('No active project.', 'error');
    return false;
  }
  if (!user.uid || user.uid === 'anonymous') {
    showToast('You must be signed in.', 'error');
    return false;
  }
  if (isProjectReadOnly(pid)) {
    showReadOnlyBlocked();
    return false;
  }
  if (typeof canEditProject === 'function' && canEditProject(pid)) return true;
  showToast('You do not have edit access to this project.', 'error');
  return false;
}

function requireBoss(action) {
  const user = (typeof window !== 'undefined' && window._currentUser) || {};
  if (!user.uid || user.uid === 'anonymous') {
    showToast('You must be signed in.', 'error');
    return false;
  }
  const role = (typeof normalizeRole === 'function') ? normalizeRole(user.role) : String(user.role || '').toLowerCase();
  if (role === 'boss') return true;
  showToast(`Boss access required to ${action || 'perform this action'}.`, 'error');
  return false;
}

window.requireEdit = requireEdit;
window.requireBoss = requireBoss;
window.isProjectReadOnly = isProjectReadOnly;
window.showReadOnlyBlocked = showReadOnlyBlocked;

// ════════════════════════════════════════════════════════════
//  Supplier dropdown (shared by materials + suppliers modules)
// ════════════════════════════════════════════════════════════
function refreshSupplierDropdown(snap) {
  const sel = $('poSupplierSelect');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Quick-select supplier —</option>';
  if (snap && snap.exists()) {
    const suppliers = [];
    snap.forEach(c => {
      const supplier = { key: c.key, ...c.val() };
      if ((supplier.status || 'active') !== 'archived' && (supplier.status || 'active') !== 'disabled') {
        suppliers.push(supplier);
      }
    });
    suppliers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    suppliers.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.key;
      opt.textContent = `${s.name}${s.specialty ? ' (' + s.specialty + ')' : ''}`;
      opt.dataset.name = s.name || '';
      sel.appendChild(opt);
    });
  }
  sel.value = prev;
}

function applySupplierSelection() {
  const sel = $('poSupplierSelect');
  const idInput = $('poSupplierId');
  const nameInput = $('poSupplier');
  if (!sel || !sel.value) return;
  const opt = sel.options[sel.selectedIndex];
  if (idInput) idInput.value = sel.value;
  if (nameInput) nameInput.value = opt.dataset.name || opt.textContent;
  sel.value = '';
}

// ════════════════════════════════════════════════════════════
//  FORM FIELD VALIDATION HELPERS
//  Inline error/success display without intrusive alerts.
//  CSS classes: .input-error, .input-success, .form-error-text, .form-success-text
// ════════════════════════════════════════════════════════════

function setFieldError(el, message) {
  if (!el) return;
  clearFieldError(el);
  el.classList.add('input-error');
  const parent = el.parentElement;
  if (!parent) return;
  // Remove any existing success text from this field
  const existingSuccess = parent.querySelector('.form-success-text');
  if (existingSuccess) existingSuccess.remove();
  const errorEl = document.createElement('div');
  errorEl.className = 'form-error-text';
  errorEl.role = 'alert';
  errorEl.textContent = message || 'Invalid value.';
  parent.insertBefore(errorEl, el.nextSibling);
  el.focus();
}

function setFieldSuccess(el, message) {
  if (!el) return;
  clearFieldError(el);
  el.classList.add('input-success');
  if (!message) return;
  const parent = el.parentElement;
  if (!parent) return;
  const successEl = document.createElement('div');
  successEl.className = 'form-success-text';
  successEl.textContent = message;
  parent.insertBefore(successEl, el.nextSibling);
}

function clearFieldError(el) {
  if (!el) return;
  el.classList.remove('input-error', 'input-success');
  const parent = el.parentElement;
  if (!parent) return;
  const existing = parent.querySelector('.form-error-text, .form-success-text');
  if (existing) existing.remove();
}

function clearAllFieldErrors(container) {
  if (!container) return;
  container.querySelectorAll('.input-error, .input-success').forEach(el => {
    el.classList.remove('input-error', 'input-success');
  });
  container.querySelectorAll('.form-error-text, .form-success-text, .field-status').forEach(el => {
    el.remove();
  });
}

window.setFieldError = setFieldError;
window.setFieldSuccess = setFieldSuccess;
window.clearFieldError = clearFieldError;
window.clearAllFieldErrors = clearAllFieldErrors;

// ════════════════════════════════════════════════════════════
//  AUTO-CLEAR VALIDATION ERRORS ON INPUT
//  When user types in a field with .input-error, clear it.
// ════════════════════════════════════════════════════════════
let _fvInitialized = false;

function initFieldValidation() {
  if (_fvInitialized) return;
  _fvInitialized = true;

  document.body.addEventListener('input', function(e) {
    var target = e.target;
    if (!target || !target.classList) return;
    if (target.classList.contains('input-error')) {
      clearFieldError(target);
    }
  });

  // Also clear on change for select elements
  document.body.addEventListener('change', function(e) {
    var target = e.target;
    if (!target || !target.classList) return;
    if (target.classList.contains('input-error')) {
      clearFieldError(target);
    }
  });
}

// Auto-init on DOMContentLoaded
if (typeof document !== 'undefined') {
  if (document.body && document.readyState !== 'loading') {
    initFieldValidation();
  } else {
    document.addEventListener('DOMContentLoaded', initFieldValidation);
  }
}
