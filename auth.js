//  ACPM — auth.js  (Stage 1: Firebase Authentication)
//  Replaces the old simpleHash + /sessions system with
//  firebase.auth().signInWithEmailAndPassword + onAuthStateChanged.
//
//  Public API (unchanged contract):
//    initAuth()              — called by main.js on DOMContentLoaded
//    doLogin()               — login handler (onclick from auth UI)
//    doResetPassword()       — sends password-reset email
//    logout()                — signs out and reloads
//    canAccessProject(pid)   — role/assignment gate
//    canEditProject(pid)     — role/assignment gate
//    getCurrentUser()        — returns the internal _currentAuthUser
//
//  Global side-effects (consumed by every other module):
//    window._currentUser     — { uid, name, role, projects, bossOf }
//    document.body classes   — role-boss, role-apm, role-viewer
// ════════════════════════════════════════════════════════════

const AUTH_VERSION = '2';
const EMAIL_DOMAIN = '@acpm.local';
let _currentAuthUser = null;
let _profileListener = null;

function inferRoleFromIdentity(uid, email, data = {}) {
  const local = String(email || uid || '').split('@')[0].toLowerCase();
  const explicitRole = String(data.role || '').trim().toLowerCase();
  const display = String(data.name || '').trim().toLowerCase();
  if (explicitRole === 'boss' || explicitRole === 'apm' || explicitRole === 'viewer') {
    if (explicitRole === 'viewer' && (display.includes('admin') || display.includes('boss') || local.includes('admin') || local.includes('boss') || local === 'owner')) {
      return 'boss';
    }
    return explicitRole;
  }
  if ((data.bossOf || []).length > 0) return 'boss';
  if (display.includes('admin') || display.includes('boss') || local.includes('admin') || local.includes('boss') || local === 'owner') return 'boss';
  if (local.includes('boss') || local.includes('admin') || local === 'owner') return 'boss';
  return 'viewer';
}

function normalizeRole(role) {
  return String(role || 'viewer').trim().toLowerCase();
}

function isBoss(role) {
  return normalizeRole(role) === 'boss';
}

// ── Helpers ──────────────────────────────────────────────────

/** Normalise the login input to an email.
 *  Users can type "boss" or "boss@acpm.local" — both work. */
function normaliseEmail(input) {
  const s = input.trim().toLowerCase();
  return s.includes('@') ? s : s + EMAIL_DOMAIN;
}

/** Build a human-friendly display name from the email prefix. */
function displayNameFromEmail(email) {
  const local = email.split('@')[0];
  // Capitalise first letter of each word-segment
  return local.replace(/[_\-\.]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Load user profile from /users/{uid} ─────────────────────
//  After Firebase Auth confirms identity, we fetch the role,
//  project assignments, and bossOf list from the Realtime DB.

async function loadUserProfile(uid) {
  try {
    const snap = await firebase.database()
      .ref(`users/${uid}`)
      .once('value');
      const data = snap.val();

    if (data) {
      const email = firebase.auth().currentUser?.email || null;
      const role = normalizeRole(inferRoleFromIdentity(uid, email, data));
      if (role === 'boss' && normalizeRole(data.role) !== 'boss') {
        firebase.database().ref(`users/${uid}/role`).set('boss').catch(() => {});
      }
      return {
        uid,
        name:       data.name || displayNameFromEmail(firebase.auth().currentUser?.email || uid),
        role,
        projects:   data.projects || [],
        bossOf:     data.bossOf || [],
        loginAt:    Date.now(),
        email
      };
    }
  } catch (e) {
    console.error('loadUserProfile error:', e);
  }

  // Profile node missing (e.g. first-login before Step 4 migration).
  // Bootstrap a minimal profile so the user isn't locked out.
  const email = firebase.auth().currentUser?.email;
  const role = normalizeRole(inferRoleFromIdentity(uid, email, {}));
  const fallback = {
    uid,
    name: displayNameFromEmail(email || uid),
    role,
    projects: [],
    bossOf: [],
    loginAt: Date.now(),
    email: email || null
  };

  // Write it into DB so it exists for next login
  firebase.database().ref(`users/${uid}`).set({
    name: fallback.name,
    role: fallback.role,
    projects: [],
    bossOf: [],
    createdAt: Date.now()
  }).catch(() => {});

  return fallback;
}

/** Apply the profile to window globals and kick off the UI. */
function applyProfile(profile) {
  _currentAuthUser = profile;
  window._currentUser = profile;
  const badge = document.getElementById('currentUserBadge');
  if (badge) {
    const role = normalizeRole(profile?.role);
    badge.textContent = `${profile?.name || 'User'} · ${role}`;
    badge.title = `Signed in as ${profile?.name || 'User'} (${profile?.uid || 'unknown'})`;
  }
  initAppForUser();
}

// ── Auth State Observer ───────────────────────────────────────
//  Firebase Auth SDK persists the session across refreshes and
//  tabs automatically — no more localStorage acpm_auth tokens.

function startAuthObserver() {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      // Authenticated — load the profile from RTDB
      const profile = await loadUserProfile(user.uid);
      applyProfile(profile);

      // Also remove the old auth overlay if it's still visible
      const overlay = document.getElementById('authOverlay');
      if (overlay) overlay.remove();
    } else {
      // Signed out — show login screen
      _currentAuthUser = null;
      window._currentUser = { uid: 'anonymous', role: 'admin', name: 'System' };
      const badge = document.getElementById('currentUserBadge');
      if (badge) {
        badge.textContent = 'System';
        badge.title = 'Signed out';
      }
      showAuthScreen();
    }
  });
}

// ── Initialize Auth UI ──────────────────────────────────────

function initAuth() {
  // Firebase Auth persistence is LOCAL by default (survives refresh,
  // cleared only by explicit signOut or password change).
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  startAuthObserver();
}

// ── Login Screen ────────────────────────────────────────────

function showAuthScreen() {
  // Don't double-render
  if (document.getElementById('authOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'authOverlay';
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <div class="auth-box">
      <div class="auth-brand">
        <div class="auth-logo">LB</div>
        <div>
          <div class="auth-name">ACPM</div>
          <div class="auth-sub">LeBuild Design &amp; Construction</div>
        </div>
      </div>
      <div class="auth-form">
        <input type="text" id="authUser" placeholder="Username" autocomplete="username">
        <input type="password" id="authPass" placeholder="Password" autocomplete="current-password">
        <button class="auth-btn" onclick="doLogin()">Sign In</button>
      </div>
      <div class="auth-hint">Contact admin for access credentials</div>
      <div id="authError" class="auth-error hidden"></div>
      <div class="auth-reset-row">
        <button class="auth-reset-btn" onclick="doResetPassword()">Forgot password?</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('authUser').focus();

  // Enter key submits login
  document.getElementById('authPass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('authUser').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('authPass').focus();
  });
}

// ── Login ────────────────────────────────────────────────────

async function doLogin() {
  const userIn  = document.getElementById('authUser');
  const passIn  = document.getElementById('authPass');
  const errEl   = document.getElementById('authError');
  const btn     = document.querySelector('.auth-btn');

  const email    = normaliseEmail(userIn?.value || '');
  const password = passIn?.value || '';

  if (!email || !password) {
    errEl.textContent = 'Enter username and password';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    await firebase.auth().signInWithEmailAndPassword(email, password);
    // onAuthStateChanged will fire and call applyProfile — nothing else
    // to do here. If sign-in throws, we catch it below.
  } catch (e) {
    console.error('Login error:', e);
    let msg = 'Connection error. Check internet.';
    switch (e.code) {
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        msg = 'Invalid username or password';
        break;
      case 'auth/too-many-requests':
        msg = 'Too many attempts. Try again later.';
        break;
      case 'auth/invalid-email':
        msg = 'Invalid username format';
        break;
    }
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

// ── Password Reset ──────────────────────────────────────────

async function doResetPassword() {
  const userIn = document.getElementById('authUser');
  const email  = normaliseEmail(userIn?.value || '');
  const errEl  = document.getElementById('authError');

  if (!email) {
    errEl.textContent = 'Enter your username above first';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    await firebase.auth().sendPasswordResetEmail(email);
    errEl.textContent = 'Password reset email sent. Check your inbox.';
    errEl.classList.remove('hidden');
  } catch (e) {
    let msg = 'Could not send reset email.';
    if (e.code === 'auth/user-not-found') {
      msg = 'No account found for that username.';
    }
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  }
}

// ── Logout ──────────────────────────────────────────────────

function logout() {
  firebase.auth().signOut().catch(() => {});
  // onAuthStateChanged (sign-out path) will clear _currentAuthUser
  // and reload via showAuthScreen. No explicit reload needed.
}

// ── App Bootstrap ───────────────────────────────────────────

function initAppForUser() {
  const role = normalizeRole(_currentAuthUser?.role || 'viewer');

  // Role-based CSS classes
  document.body.classList.remove('role-boss', 'role-apm', 'role-viewer');
  if (role === 'boss') {
    document.body.classList.add('role-boss');
  } else if (role === 'apm') {
    document.body.classList.add('role-apm');
  } else {
    document.body.classList.add('role-viewer');
  }

  // Filter projects based on assignment
  filterProjectsByRole();

  // Show/hide boss-only features
  document.querySelectorAll('[data-boss-only]').forEach(el => {
    el.style.display = isBoss(role) ? '' : 'none';
  });

  document.querySelectorAll('[data-role-visible]').forEach(el => {
    const visible = String(el.dataset.roleVisible || '').trim().toLowerCase();
    if (!visible || visible === 'all') {
      el.style.display = '';
      return;
    }
    if (visible === 'none') {
      el.style.display = 'none';
      return;
    }
    const allowed = visible.split(',').map(v => v.trim()).filter(Boolean);
    el.style.display = allowed.includes(role) || (allowed.includes('boss') && isBoss(role)) ? '' : 'none';
  });

  const visibleTabs = Array.from(document.querySelectorAll('.hub-tab, .tab-btn'))
    .filter(el => el.offsetParent !== null && !el.classList.contains('hidden'));
  const activeWorkspaceTab = document.querySelector('.tab-btn.tab-active:not(#tab_admin):not(#tab_reports)');
  if (!activeWorkspaceTab || activeWorkspaceTab.style.display === 'none') {
    const fallback = document.querySelector(isBoss(role) ? '#tab_reports' : '#tab_labor');
    if (fallback && fallback.style.display !== 'none') fallback.click();
  }

  const createCard = document.querySelector('.hub-create-card');
  if (createCard) createCard.style.display = isBoss(role) ? '' : 'none';

  // Re-render hub with role-aware data
  renderHub();

  // Boss-only background housekeeping
  if (isBoss(role)) {
    scanComplianceAcrossProjects().catch(() => {});
    pruneAuditLog().catch(() => {});
  }
}

// ── Role / Access Helpers ───────────────────────────────────

function filterProjectsByRole() {
  const user = _currentAuthUser;
  if (!user || isBoss(user.role)) return;
  const allowed = user.projects || [];
  window._allowedProjects = new Set(allowed);
}

function canAccessProject(pid) {
  const user = _currentAuthUser;
  if (!user) return false;
  if (isBoss(user.role)) return true;
  if (user.bossOf && user.bossOf.includes(pid)) return true;
  return (user.projects || []).includes(pid);
}

function canEditProject(pid) {
  const user = _currentAuthUser;
  if (!user) return false;
  if (isBoss(user.role)) return true;
  if (user.bossOf && user.bossOf.includes(pid)) return true;
  return (user.projects || []).includes(pid);
}

// ── Expose ──────────────────────────────────────────────────
window.initAuth          = initAuth;
window.doLogin           = doLogin;
window.doResetPassword   = doResetPassword;
window.logout            = logout;
window.canAccessProject  = canAccessProject;
window.canEditProject    = canEditProject;
window.getCurrentUser   = () => _currentAuthUser;
