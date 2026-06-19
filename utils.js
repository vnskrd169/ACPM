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

// ── Audit log (currently console-only; TODO: Firestore `auditLogs`) ──
// TODO: Replace _currentUser with real Firebase Auth identity.
function auditLog(action, entityType, entityId, details = {}) {
  const user = (typeof window !== 'undefined' && window._currentUser) ? window._currentUser : { uid: 'anonymous', role: 'admin', name: 'System' };
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
}

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
