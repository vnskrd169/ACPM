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
  const explicitRole = String(data.role || '').trim().toLowerCase();
  if (explicitRole === 'boss' || explicitRole === 'apm') {
    return explicitRole;
  }
  if (explicitRole === 'viewer') return 'apm';
  if ((data.bossOf || []).length > 0) return 'boss';
  return 'apm';
}

function normalizeRole(role) {
  const normalized = String(role || 'apm').trim().toLowerCase();
  return normalized === 'boss' ? 'boss' : 'apm';
}

function isBoss(role) {
  return normalizeRole(role) === 'boss';
}

function roleLabel(role) {
  return isBoss(role) ? 'Admin / Boss / Project Manager' : 'Assoc. Project Manager';
}

function teamRoleLabel(role) {
  return roleLabel(role);
}

// ── Helpers ──────────────────────────────────────────────────

/** Normalise the login input to an email.
 *  Users can type "boss" or "boss@acpm.local" — both work. */
function normaliseEmail(input) {
  const s = input.trim().toLowerCase();
  if (!s) return '';
  return s.includes('@') ? s : s + EMAIL_DOMAIN;
}

function isRealEmail(input) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input || '').trim());
}

/** Build a human-friendly display name from the email prefix. */
function displayNameFromEmail(email) {
  const local = email.split('@')[0];
  // Capitalise first letter of each word-segment
  return local.replace(/[_\-\.]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function authErrorMessage(e, fallback = 'Could not complete request.') {
  switch (e?.code) {
    case 'auth/email-already-in-use':
      return 'Account already exists. Sign in instead.';
    case 'auth/invalid-email':
      return 'Invalid email format.';
    case 'auth/weak-password':
      return 'Password is too weak.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled yet in Firebase Authentication.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Google sign-in in Firebase.';
    case 'PERMISSION_DENIED':
      return 'Account created, but profile setup was blocked. Ask an admin to add your profile.';
    default:
      return fallback;
  }
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
      return {
        uid,
        name:       data.name || displayNameFromEmail(firebase.auth().currentUser?.email || uid),
        role,
        status:     data.status || 'active',
        position:   data.position || '',
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
  const role = 'apm';
  const fallback = {
    uid,
    name: displayNameFromEmail(email || uid),
    role,
    status: 'pending',
    position: '',
    projects: [],
    bossOf: [],
    loginAt: Date.now(),
    email: email || null
  };

  // Write it into DB so it exists for next login
  firebase.database().ref(`users/${uid}`).set({
    name: fallback.name,
    email: email || null,
    role: fallback.role,
    status: fallback.status,
    position: fallback.position,
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
    badge.textContent = `${profile?.name || 'User'} - ${roleLabel(role)}`;
    badge.title = `Signed in as ${profile?.name || 'User'} (${profile?.uid || 'unknown'})`;
  }
  if (profile?.status && profile.status !== 'active' && !isBoss(profile.role)) {
    showPendingAccessScreen(profile);
    return;
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
      const overlay = document.getElementById('authOverlay');
      if (overlay) overlay.remove();
      applyProfile(profile);
    } else {
      // Signed out — show login screen
      _currentAuthUser = null;
      window._currentUser = { uid: 'anonymous', role: 'apm', name: 'System' };
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

function showPendingAccessScreen(profile) {
  let overlay = document.getElementById('authOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'authOverlay';
    overlay.className = 'auth-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="auth-box">
      <div class="auth-brand">
        <div class="auth-logo">LB</div>
        <div>
          <div class="auth-name">Request Pending</div>
          <div class="auth-sub">LeBuild Design &amp; Construction</div>
        </div>
      </div>
      <div class="auth-pending">
        <div class="auth-pending-title">Admin approval needed</div>
        <div class="auth-pending-text">Your account request was received. An admin must approve your role and assign projects before you can use ACPM.</div>
        <div class="auth-pending-meta">
          <div><span>Name</span><strong>${escapeHtml(profile.name || 'User')}</strong></div>
          <div><span>Position</span><strong>${escapeHtml(profile.position || '-')}</strong></div>
          <div><span>Email</span><strong>${escapeHtml(profile.email || '-')}</strong></div>
        </div>
      </div>
      <button class="auth-btn auth-btn-secondary" onclick="logout()">Back to Sign In</button>
    </div>
  `;
}

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
        <input type="email" id="authUser" placeholder="Email address" autocomplete="email">
        <input type="password" id="authPass" placeholder="Password" autocomplete="current-password">
        <button class="auth-btn" id="authLoginBtn" onclick="doLogin()">Sign In</button>
        <button class="auth-btn auth-btn-google" onclick="doGoogleSignIn()">Continue with Google</button>
        <div class="auth-divider"><span>Request access</span></div>
        <input type="text" id="requestName" placeholder="Full name" autocomplete="name">
        <input type="text" id="requestPosition" placeholder="Position" autocomplete="organization-title">
        <input type="email" id="requestEmail" placeholder="Google email / work email" autocomplete="email">
        <input type="password" id="requestPass" placeholder="Password for email request" autocomplete="new-password">
        <button class="auth-btn auth-btn-secondary" onclick="doRequestAccess()">Submit Request</button>
        <button class="auth-btn auth-btn-secondary" onclick="doGoogleAccessRequest()">Request with Google</button>
      </div>
      <div class="auth-hint">Requests stay pending until an admin approves your role and projects.</div>
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
  document.getElementById('requestPass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doRequestAccess();
  });
}

// ── Login ────────────────────────────────────────────────────

async function doLogin() {
  const userIn  = document.getElementById('authUser');
  const passIn  = document.getElementById('authPass');
  const errEl   = document.getElementById('authError');
  const btn     = document.getElementById('authLoginBtn');

  const email    = normaliseEmail(userIn?.value || '');
  const password = passIn?.value || '';

  if (!email || !password) {
    errEl.textContent = 'Enter email and password';
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
        msg = 'Invalid email format';
        break;
    }
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

// ── Password Reset ──────────────────────────────────────────

function requestAccessFields({ requireEmail = true, requirePassword = true } = {}) {
  const name = document.getElementById('requestName')?.value?.trim() || '';
  const position = document.getElementById('requestPosition')?.value?.trim() || '';
  const rawEmail = document.getElementById('requestEmail')?.value || '';
  const email = normaliseEmail(rawEmail);
  const password = document.getElementById('requestPass')?.value || '';
  const errEl = document.getElementById('authError');

  if (!name) return { ok: false, errEl, message: 'Enter your full name.' };
  if (!position) return { ok: false, errEl, message: 'Enter your position.' };
  if (requireEmail && !email) return { ok: false, errEl, message: 'Enter your email.' };
  if (requireEmail && !isRealEmail(rawEmail)) return { ok: false, errEl, message: 'Use a real email address.' };
  if (requirePassword && password.length < 6) return { ok: false, errEl, message: 'Password must be at least 6 characters.' };
  return { ok: true, errEl, name, position, email, password };
}

async function saveAccessRequest(user, details = {}, provider = 'password') {
  const email = user.email || details.email || '';
  const ref = firebase.database().ref(`users/${user.uid}`);
  const existingSnap = await ref.once('value');
  if (existingSnap.exists()) {
    const existing = existingSnap.val() || {};
    if (existing.status === 'active' || existing.role === 'boss' || (existing.projects || []).length) {
      return existing;
    }
  }
  const profile = {
    name: details.name || user.displayName || displayNameFromEmail(email || user.uid),
    position: details.position || '',
    email,
    role: 'apm',
    status: 'pending',
    projects: [],
    bossOf: [],
    provider,
    requestedAt: Date.now(),
    createdAt: Date.now()
  };
  await ref.set(profile);
  return profile;
}

async function doRequestAccess() {
  const fields = requestAccessFields();
  if (!fields.ok) {
    fields.errEl.textContent = fields.message;
    fields.errEl.classList.remove('hidden');
    return;
  }
  const buttons = document.querySelectorAll('.auth-btn');
  buttons.forEach(btn => { btn.disabled = true; });
  fields.errEl.textContent = 'Sending access request...';
  fields.errEl.classList.remove('hidden');

  try {
    const cred = await firebase.auth().createUserWithEmailAndPassword(fields.email, fields.password);
    await cred.user.updateProfile({ displayName: fields.name }).catch(() => {});
    await saveAccessRequest(cred.user, fields, 'password');
    fields.errEl.textContent = 'Access request sent. An admin must approve your role and projects before you can use ACPM.';
    await firebase.auth().signOut();
  } catch (e) {
    console.error('Access request error:', e);
    fields.errEl.textContent = authErrorMessage(e, 'Could not send access request.');
    buttons.forEach(btn => { btn.disabled = false; });
  }
}

async function doGoogleSignIn() {
  const errEl = document.getElementById('authError');
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await firebase.auth().signInWithPopup(provider);
  } catch (e) {
    console.error('Google sign-in error:', e);
    errEl.textContent = authErrorMessage(e, 'Could not sign in with Google.');
    errEl.classList.remove('hidden');
  }
}

async function doGoogleAccessRequest() {
  const fields = requestAccessFields({ requireEmail: false, requirePassword: false });
  if (!fields.ok) {
    fields.errEl.textContent = fields.message;
    fields.errEl.classList.remove('hidden');
    return;
  }
  const buttons = document.querySelectorAll('.auth-btn');
  buttons.forEach(btn => { btn.disabled = true; });
  fields.errEl.textContent = 'Opening Google sign-in...';
  fields.errEl.classList.remove('hidden');

  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await firebase.auth().signInWithPopup(provider);
    await saveAccessRequest(cred.user, fields, 'google');
    fields.errEl.textContent = 'Access request sent. An admin must approve your role and projects before you can use ACPM.';
    await firebase.auth().signOut();
  } catch (e) {
    console.error('Google access request error:', e);
    fields.errEl.textContent = authErrorMessage(e, 'Could not send Google access request.');
    buttons.forEach(btn => { btn.disabled = false; });
  }
}

const doRegister = doRequestAccess;
async function doResetPassword() {
  const userIn = document.getElementById('authUser');
  const rawEmail = userIn?.value || '';
  const email  = normaliseEmail(rawEmail);
  const errEl  = document.getElementById('authError');

  if (!email) {
    errEl.textContent = 'Enter your email above first';
    errEl.classList.remove('hidden');
    return;
  }
  if (!isRealEmail(rawEmail)) {
    errEl.textContent = 'Password reset needs the real email address';
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
      msg = 'No account found for that email.';
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
  const role = normalizeRole(_currentAuthUser?.role || 'apm');
  const extrasEnabled = typeof getFeatureFlag === 'function' ? getFeatureFlag('extras', false) : false;

  // Role-based CSS classes
  document.body.classList.remove('role-boss', 'role-apm', 'role-viewer');
  if (role === 'boss') {
    document.body.classList.add('role-boss');
  } else {
    document.body.classList.add('role-apm');
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

  document.querySelectorAll('[data-feature-visible="extras"]').forEach(el => {
    el.style.display = extrasEnabled ? '' : 'none';
  });

  const extrasToggle = document.getElementById('extrasToggleBtn');
  if (extrasToggle) {
    extrasToggle.classList.toggle('is-enabled', extrasEnabled);
    extrasToggle.textContent = extrasEnabled ? 'Extras On' : 'Extras';
    extrasToggle.title = extrasEnabled ? 'Hide optional tabs' : 'Show optional tabs';
  }

  const preferredTab = isBoss(role) ? '#tab_reports' : '#tab_labor';
  const activeWorkspaceTab = document.querySelector('.tab-btn.tab-active:not(#tab_admin)');
  if (!activeWorkspaceTab || activeWorkspaceTab.style.display === 'none' || !activeWorkspaceTab.id || (isBoss(role) && activeWorkspaceTab.id !== 'tab_reports')) {
    const fallback = document.querySelector(preferredTab);
    if (fallback && fallback.style.display !== 'none') fallback.click();
  }

  const createCard = document.querySelector('.hub-create-card');
  if (createCard) createCard.style.display = isBoss(role) ? '' : 'none';

  if (typeof initNotifications === 'function') initNotifications();

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
window.doRegister        = doRegister;
window.doRequestAccess   = doRequestAccess;
window.doGoogleSignIn    = doGoogleSignIn;
window.doGoogleAccessRequest = doGoogleAccessRequest;
window.doResetPassword   = doResetPassword;
window.logout            = logout;
window.canAccessProject  = canAccessProject;
window.canEditProject    = canEditProject;
window.getCurrentUser    = () => _currentAuthUser;
window.normalizeRole     = normalizeRole;
window.isBoss            = isBoss;
window.roleLabel         = roleLabel;
window.teamRoleLabel     = teamRoleLabel;
