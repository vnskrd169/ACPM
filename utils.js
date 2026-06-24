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
// ONE canonical definition; materials/suppliers/billing/changeorders all use this.
function escapeCsv(text) {
  if (text === null || text === undefined) return '';
  const s = String(text);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Build + download a CSV/text file. Uses REAL newlines (\n), never literal backslash-n.
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

// ── Toast (kept here so all modules share one) ──────────────
function showToast(msg, type = 'success') {
  const existing = document.querySelector('.toast-msg');
  if (existing) existing.remove();
  if (!document.body) return;
  const toast = document.createElement('div');
  toast.className = `toast-msg toast-${type}`;
  toast.textContent = msg;
  toast.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
    background:${type === 'error' ? '#450a0a' : type === 'warn' ? '#451a03' : '#064e3b'};
    color:${type === 'error' ? '#ef4444' : type === 'warn' ? '#f59e0b' : '#34d399'};
    border:1px solid ${type === 'error' ? '#7f1d1d' : type === 'warn' ? '#78350f' : '#065f46'};
    padding:10px 20px;border-radius:10px;font-size:13px;font-weight:700;z-index:1000;
    box-shadow:0 4px 12px rgba(0,0,0,.4);max-width:90vw;text-align:center;`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Safe DB wrapper ─────────────────────────────────────────
async function safeDb(fn, errMsg) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    showToast(errMsg || 'Database error', 'error');
    throw e;
  }
}

// ── Audit log ────────────────────────────────────────────────
// Persisted to Firebase under /auditLogs (global, capped) so the 3 bosses
// can see who-did-what across all 9 projects. Fire-and-forget: never
// blocks or throws on the caller — logging must not break the app.
function auditLog(action, entityType, entityId, details = {}) {
  const user = (typeof window !== 'undefined' && window._currentUser) ? window._currentUser : { uid: 'anonymous', role: 'viewer', name: 'System' };
  const pid = (typeof window !== 'undefined' && window._currentPid) ? window._currentPid : null;
  const logEntry = {
    action, entityType, entityId, details,
    userId: user.uid,
    userName: user.name,
    userRole: user.role,
    timestamp: Date.now(),
    date: new Date().toLocaleDateString('en-PH'),
    projectId: pid
  };
  console.log('\u1F4DD AUDIT:', logEntry);

  try {
    if (typeof firebase !== 'undefined' && firebase.database) {
      firebase.database().ref('auditLogs').push(logEntry).catch(() => {});
    }
  } catch (e) { /* never let audit logging break the calling action */ }
}

// Trim old audit entries to stay inside the free-tier DB size limit.
// Call occasionally (e.g. once per boss login) — not on every write.
async function pruneAuditLog(keepLatest = 2000) {
  try {
    const snap = await firebase.database().ref('auditLogs').orderByChild('timestamp').once('value');
    const keys = [];
    snap.forEach(c => keys.push(c.key));
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
//  Disables the button (with a "…" hint) for the duration of an async
//  operation, always re-enabling on success OR failure.
// ════════════════════════════════════════════════════════════
async function withBusy(btn, asyncFn) {
  if (!btn) return asyncFn();
  if (btn.dataset.busy === '1') return;          // already in flight — swallow
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

// Convenience: attach withBusy by element id, looking up the button at call time.
async function withBusyId(btnId, asyncFn) {
  return withBusy($(btnId), asyncFn);
}

// ════════════════════════════════════════════════════════════
//  delegateEvent — replace inline onclick="fn('USERDATA')"
//  Render data-key (or other data-* attrs) and attach ONE
//  delegated listener that resolves the key safely.
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

// Resolve a key from a delegated target, with a fallback attr name.
function getKey(ds, attr = 'key') {
  return ds && ds[attr];
}

// ════════════════════════════════════════════════════════════
//  Inventory key normalization — "Cement" / "cement" / " cement "
//  must collapse to ONE inventory record.
// ════════════════════════════════════════════════════════════
function normalizeInvKey(desc, size = '') {
  return `${String(desc || '').trim().toLowerCase()}||${String(size || '').trim().toLowerCase()}`;
}

// ════════════════════════════════════════════════════════════
//  Shared Validators — enforce data quality before Firebase writes
//  These run client-side; Firebase Rules provide the final guard.
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

// ── Access Guard ──────────────────────────────────────────
// Centralized gate for write actions. Returns true if the
// current user can edit the given project. Shows a toast
// and returns false otherwise — call at the top of every
// write function.
// Usage:  if (!requireEdit(pid)) return;
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
  if (typeof canEditProject === 'function' && canEditProject(pid)) return true;
  showToast('You do not have edit access to this project.', 'error');
  return false;
}

// Boss-only guard. Returns true if current user is boss.
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

// ════════════════════════════════════════════════════════════
//  Supplier dropdown (shared by materials + suppliers modules)
//  Now keyed by supplierId with name display.
// ════════════════════════════════════════════════════════════
function refreshSupplierDropdown(snap) {
  const sel = $('poSupplierSelect');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Quick-select supplier —</option>';
  if (snap && snap.exists()) {
    const suppliers = [];
    snap.forEach(c => suppliers.push({ key: c.key, ...c.val() }));
    suppliers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    suppliers.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.key;                             // store the KEY, not the name
      opt.textContent = `${s.name}${s.specialty ? ' (' + s.specialty + ')' : ''}`;
      opt.dataset.name = s.name || '';
      sel.appendChild(opt);
    });
  }
  sel.value = prev;
}

// When the dropdown changes, copy the chosen supplier id+name into the PO fields.
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
