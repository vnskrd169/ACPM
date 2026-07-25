//  ACPM - auth.js  (Stage 1: Firebase Authentication)
//  Replaces the old simpleHash + /sessions system with
//  firebase.auth().signInWithEmailAndPassword + onAuthStateChanged.
//
//  Public API (unchanged contract):
//    initAuth() - called by main.js on DOMContentLoaded
//    doLogin() - login handler (onclick from auth UI)
//    doResetPassword() - sends password-reset email
//    logout() - signs out and reloads
//    canAccessProject(pid) - role/assignment gate
//    canEditProject(pid) - role/assignment gate
//    getCurrentUser() - returns the internal _currentAuthUser
//
//  Global side-effects (consumed by every other module):
//    window._currentUser - { uid, name, role, projects, bossOf }
//    document.body classes - role-boss, role-apm, role-viewer
// ============================================================

const AUTH_VERSION = '2';
const EMAIL_DOMAIN = '@acpm.local';
const PROFILE_PHOTO_STORAGE_ENABLED = false;
const PROFILE_PHOTO_MAX_INLINE_BYTES = 180 * 1024;
let _currentAuthUser = null;
let _profileListener = null;
let _accessRequestInProgress = false;

const ROLE_DEFINITIONS = {
  boss: { label: 'Boss / Owner', admin: true, financial: true, projectEdit: true, field: false, readOnly: false },
  owner: { label: 'Boss / Owner', admin: true, financial: true, projectEdit: true, field: false, readOnly: false },
  admin: { label: 'Admin', admin: true, financial: true, projectEdit: true, field: false, readOnly: false },
  pm: { label: 'Project Manager', admin: false, financial: true, projectEdit: true, field: false, readOnly: false },
  apm: { label: 'Assoc. Project Manager', admin: false, financial: false, projectEdit: true, field: false, readOnly: false },
  foreman: { label: 'Foreman', admin: false, financial: false, projectEdit: false, field: true, readOnly: false },
  safety: { label: 'Safety', admin: false, financial: false, projectEdit: false, field: true, readOnly: false },
  viewer: { label: 'Viewer', admin: false, financial: false, projectEdit: false, field: false, readOnly: true }
};

const RC1_ACTIVE_ROLES = new Set(['boss', 'owner', 'admin', 'pm', 'apm']);

function inferRoleFromIdentity(uid, email, data = {}) {
  const explicitRole = String(data.role || '').trim().toLowerCase();
  if (ROLE_DEFINITIONS[explicitRole]) {
    return explicitRole;
  }
  if (normalizeProjectList(data.bossOf).length > 0) return 'boss';
  return 'apm';
}

function normalizeRole(role) {
  const normalized = String(role || 'apm').trim().toLowerCase();
  return ROLE_DEFINITIONS[normalized] ? normalized : 'apm';
}

function isBoss(role) {
  const normalized = normalizeRole(role);
  return !!ROLE_DEFINITIONS[normalized]?.admin;
}

function isRc1ActiveRole(role) {
  const explicitRole = String(role || '').trim().toLowerCase();
  return RC1_ACTIVE_ROLES.has(explicitRole);
}

function canSeeFinancials(role) {
  const normalized = normalizeRole(role);
  return !!ROLE_DEFINITIONS[normalized]?.financial;
}

function canEditAssignedProject(role) {
  const normalized = normalizeRole(role);
  return !!ROLE_DEFINITIONS[normalized]?.projectEdit;
}

function canReadFullAssignedProject(role) {
  const normalized = normalizeRole(role);
  return isBoss(normalized) || normalized === 'pm' || normalized === 'apm';
}

function isFieldRole(role) {
  const normalized = normalizeRole(role);
  return !!ROLE_DEFINITIONS[normalized]?.field;
}

function isViewerRole(role) {
  const normalized = normalizeRole(role);
  return !!ROLE_DEFINITIONS[normalized]?.readOnly;
}

function roleLabel(role) {
  const normalized = normalizeRole(role);
  return ROLE_DEFINITIONS[normalized]?.label || ROLE_DEFINITIONS.apm.label;
}

function teamRoleLabel(role) {
  return roleLabel(role);
}

function normalizeProjectList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, enabled]) => enabled !== false && enabled !== null)
      .map(([key]) => String(key));
  }
  return [];
}

function accessRequestDisplayName(data = {}, fallback = '') {
  return data.fullName || data.displayName || data.name || fallback || 'User';
}

function elementAllowsRole(el, role) {
  const visible = String(el?.dataset?.roleVisible || '').trim().toLowerCase();
  if (!visible || visible === 'all') return true;
  if (visible === 'none') return false;
  const normalized = normalizeRole(role);
  const allowed = visible.split(',').map(v => v.trim()).filter(Boolean);
  return allowed.includes(normalized) ||
    (allowed.includes('boss') && isBoss(normalized)) ||
    (allowed.includes('financial') && canSeeFinancials(normalized));
}

// -- Helpers --------------------------------------------------

/** Normalise the login input to an email.
 *  Users can type "boss" or "boss@acpm.local" - both work. */
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
      return `This domain is not authorized for Google sign-in in Firebase. Add "${window.location.hostname || window.location.origin}" to Firebase Authentication > Settings > Authorized domains.`;
    case 'PERMISSION_DENIED':
      return 'Account created, but profile setup was blocked. Ask an admin to add your profile.';
    default:
      return fallback;
  }
}

// -- Load user profile from /users/{uid} ---------------------
//  After Firebase Auth confirms identity, we fetch the role,
//  project assignments, and bossOf list from the Realtime DB.

async function loadUserProfile(uid) {
  try {
    const snap = await firebase.database()
      .ref(`users/${uid}`)
      .once('value');
      const data = snap.val();

    if (data) {
      const email = data.email || firebase.auth().currentUser?.email || null;
      const role = normalizeRole(inferRoleFromIdentity(uid, email, data));
      return {
        uid,
        name:       data.displayName || data.name || displayNameFromEmail(firebase.auth().currentUser?.email || uid),
        displayName: data.displayName || data.name || '',
        role,
        status:     data.status || 'active',
        position:   data.position || '',
        projects:   normalizeProjectList(data.projects),
        assignedProjects: normalizeProjectList(data.assignedProjects || data.projects),
        bossOf:     normalizeProjectList(data.bossOf),
        loginAt:    Date.now(),
        lastLoginAt: data.lastLoginAt || null,
        lastSeenAt: data.lastSeenAt || null,
        email,
        mobile: data.mobile || '',
        avatarUrl: data.avatarUrl || '',
        avatarPath: data.avatarPath || '',
        signature: data.signature || '',
        profileComplete: data.profileComplete !== false
      };
    }

    const reqSnap = await firebase.database().ref(`accessRequests/${uid}`).once('value');
    const request = reqSnap.val();
    if (request) {
      return {
        uid,
        name: accessRequestDisplayName(request, displayNameFromEmail(firebase.auth().currentUser?.email || uid)),
        displayName: accessRequestDisplayName(request, ''),
        role: 'apm',
        status: request.status || 'pending',
        position: request.position || '',
        projects: [],
        assignedProjects: [],
        bossOf: [],
        loginAt: Date.now(),
        email: request.email || firebase.auth().currentUser?.email || null,
        provider: request.provider || '',
        requestedAt: request.requestedAt || null,
        pendingReason: request.status === 'rejected'
          ? (request.rejectionReason || request.reason || 'Your access request was rejected. Please contact an admin.')
          : 'Your account request is waiting for admin approval.'
      };
    }
  } catch (e) {
    console.error('loadUserProfile error:', e);
  }

  const email = firebase.auth().currentUser?.email;
  return {
    uid,
    name: displayNameFromEmail(email || uid),
    role: 'apm',
    status: 'pending',
    position: '',
    projects: [],
    assignedProjects: [],
    bossOf: [],
    loginAt: Date.now(),
    email: email || null,
    pendingReason: 'Your Auth account exists, but no access request was found. Submit Request Access again so an admin can approve it.'
  };
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
  if (!isRc1ActiveRole(profile?.role)) {
    showPendingAccessScreen({
      ...profile,
      status: 'pending',
      pendingReason: 'This role is planned for a future field-user release and is not active in RC1.'
    });
    return;
  }
  if (profile?.status && profile.status !== 'active') {
    const status = String(profile.status || 'pending').toLowerCase();
    const statusReason = status === 'suspended'
      ? 'This account is suspended. Ask an admin to reactivate access.'
      : status === 'archived'
        ? 'This account is archived. Ask an admin to restore access if this was a mistake.'
        : status === 'disabled'
          ? 'This account is disabled. Ask an admin to review access.'
          : profile.pendingReason;
    showPendingAccessScreen({ ...profile, pendingReason: statusReason || profile.pendingReason });
    return;
  }
  recordUserSeen(profile);
  initAppForUser();
}

function recordUserSeen(profile = _currentAuthUser) {
  if (!profile?.uid || profile.status !== 'active') return;
  const now = Date.now();
  firebase.database().ref(`users/${profile.uid}`).update({
    lastLoginAt: now,
    lastSeenAt: now
  }).catch(e => console.warn('lastSeenAt update skipped:', e?.code || e?.message || e));
}

// -- Auth State Observer ---------------------------------------
//  Firebase Auth SDK persists the session across refreshes and
//  tabs automatically - no more localStorage acpm_auth tokens.

function setAppLoading(isLoading) {
  document.body.classList.toggle('auth-checking', !!isLoading);
  const loader = document.getElementById('appLoading');
  if (loader) loader.classList.toggle('hidden', !isLoading);
}

function lockPrivateUi(isLocked) {
  document.body.classList.toggle('auth-locked', !!isLocked);
  if (isLocked) document.body.classList.remove('auth-ready');
}

function unlockPrivateUi() {
  setAppLoading(false);
  lockPrivateUi(false);
  document.body.classList.add('auth-ready');
}

function cleanupAuthScopedListeners() {
  if (typeof detachReportsListeners === 'function') detachReportsListeners();
  if (typeof detachNotifications === 'function') detachNotifications();
}

function showPublicAuthUi() {
  setAppLoading(false);
  lockPrivateUi(true);
}

function currentAppPage() {
  if (typeof window.getAppPage === 'function') return window.getAppPage();
  if (window.ACPM_PAGE) return String(window.ACPM_PAGE).toLowerCase();
  const path = window.location.pathname.toLowerCase();
  if (path.endsWith('/login.html')) return 'login';
  if (path.endsWith('/pmos.html')) return 'pmos';
  if (path.endsWith('/dashboard.html')) return 'dashboard';
  if (path.endsWith('/workspace.html')) return 'workspace';
  return 'app';
}

function routeTo(page, params = {}) {
  if (typeof window.appUrl === 'function') {
    window.location.replace(window.appUrl(page, params));
    return;
  }
  if (page === 'login') window.location.replace('login.html');
  else if (page === 'pmos') window.location.replace('pmos.html');
  else if (page === 'workspace' && params.projectId) window.location.replace(`workspace.html?projectId=${encodeURIComponent(params.projectId)}`);
  else window.location.replace('dashboard.html');
}

function isProtectedPage() {
  return ['dashboard', 'workspace', 'pmos'].includes(currentAppPage());
}

function startAuthObserver() {
  firebase.auth().onAuthStateChanged(async (user) => {
    setAppLoading(true);
    lockPrivateUi(true);
    if (user) {
      if (_accessRequestInProgress && currentAppPage() === 'login') {
        setAppLoading(false);
        lockPrivateUi(true);
        return;
      }
      // Authenticated - load the profile from RTDB
      try {
        const profile = await loadUserProfile(user.uid);
        const overlay = document.getElementById('authOverlay');
        if (overlay) overlay.remove();
        applyProfile(profile);
      } catch (e) {
        console.error('Auth profile load error:', e);
        await firebase.auth().signOut().catch(() => {});
        showAuthScreen();
      }
    } else {
      // Signed out - show login screen
      cleanupAuthScopedListeners();
      _currentAuthUser = null;
      window._currentUser = { uid: 'anonymous', role: 'apm', name: 'System' };
      const badge = document.getElementById('currentUserBadge');
      if (badge) {
        badge.textContent = 'System';
        badge.title = 'Signed out';
      }
      if (isProtectedPage()) {
        routeTo('login');
        return;
      }
      showAuthScreen();
    }
  });
}

// -- Initialize Auth UI --------------------------------------

function initAuth() {
  // Firebase Auth persistence is LOCAL by default (survives refresh,
  // cleared only by explicit signOut or password change).
  setAppLoading(true);
  lockPrivateUi(true);
  firebase.auth()
    .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(startAuthObserver)
    .catch(e => {
      console.warn('Auth persistence fallback:', e);
      startAuthObserver();
    });
}

// -- Login Screen --------------------------------------------

function showPendingAccessScreen(profile) {
  showPublicAuthUi();
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
        <div class="auth-pending-title">${profile.status === 'rejected' ? 'Request rejected' : 'Admin approval needed'}</div>
        <div class="auth-pending-text">${escapeHtml(profile.pendingReason || 'Your account request was received. An admin must approve your role and assign projects before you can use ACPM.')}</div>
        <div class="auth-pending-meta">
          <div><span>Name</span><strong>${escapeHtml(profile.name || 'User')}</strong></div>
          <div><span>Position</span><strong>${escapeHtml(profile.position || '-')}</strong></div>
          <div><span>Email</span><strong>${escapeHtml(profile.email || '-')}</strong></div>
        </div>
      </div>
      ${profile.status !== 'approved' ? `
        <div class="auth-form auth-pending-recovery">
          <input type="text" id="pendingRequestName" placeholder="Full name" value="${escapeHtml(profile.displayName || profile.name || '')}" autocomplete="name">
          <input type="text" id="pendingRequestPosition" placeholder="Position" value="${escapeHtml(profile.position || '')}" autocomplete="organization-title">
          <button class="auth-btn" id="pendingRequestBtn" onclick="submitPendingAccessRequest()">Send Missing Request</button>
        </div>
        <div id="pendingRequestError" class="auth-error hidden"></div>
      ` : ''}
      <button class="auth-btn auth-btn-secondary" onclick="logout()">Back to Sign In</button>
    </div>
  `;
}

function showAuthScreen() {
  showPublicAuthUi();
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
      <form class="auth-form" id="loginForm" onsubmit="event.preventDefault(); doLogin(); return false;" aria-label="Sign in">
        <input type="email" id="authUser" placeholder="Email address" autocomplete="email" aria-label="Email address">
        <input type="password" id="authPass" placeholder="Password" autocomplete="current-password" aria-label="Password">
        <button class="auth-btn" id="authLoginBtn" type="submit">Sign In</button>
        <button class="auth-btn auth-btn-google" type="button" onclick="doGoogleSignIn()">Continue with Google</button>
        <div class="auth-divider"><span>Request access</span></div>
        <input type="text" id="requestName" placeholder="Full name" autocomplete="name" aria-label="Full name">
        <input type="text" id="requestPosition" placeholder="Position" autocomplete="organization-title" aria-label="Position">
        <input type="email" id="requestEmail" placeholder="Google email / work email" autocomplete="email" aria-label="Google email">
        <input type="password" id="requestPass" placeholder="Password for email request" autocomplete="new-password" aria-label="Password for email request">
        <button class="auth-btn auth-btn-secondary" type="button" onclick="doRequestAccess()">Submit Request</button>
        <button class="auth-btn auth-btn-secondary" type="button" onclick="doGoogleAccessRequest()">Request with Google</button>
      </form>
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

// -- Login ----------------------------------------------------

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
  btn.textContent = 'Signing in...';

  try {
    await firebase.auth().signInWithEmailAndPassword(email, password);
    // onAuthStateChanged will fire and call applyProfile - nothing else
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

// -- Password Reset ------------------------------------------

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
  const userRef = firebase.database().ref(`users/${user.uid}`);
  const existingSnap = await userRef.once('value');
  if (existingSnap.exists()) {
    const existing = existingSnap.val() || {};
    if (existing.status === 'active' || isBoss(existing.role) || normalizeProjectList(existing.projects).length) {
      return existing;
    }
  }

  const requestRef = firebase.database().ref(`accessRequests/${user.uid}`);
  const existingRequestSnap = await requestRef.once('value');
  const existingRequest = existingRequestSnap.val() || {};
  const historyKey = requestRef.child('statusHistory').push().key;
  const now = Date.now();
  const request = {
    ...existingRequest,
    uid: user.uid,
    fullName: details.name || user.displayName || existingRequest.fullName || displayNameFromEmail(email || user.uid),
    displayName: details.name || user.displayName || existingRequest.displayName || displayNameFromEmail(email || user.uid),
    position: details.position || '',
    email,
    status: 'pending',
    provider,
    requestedAt: existingRequest.requestedAt || now,
    updatedAt: now,
    statusHistory: {
      ...(existingRequest.statusHistory || {}),
      [historyKey]: {
        status: 'pending',
        by: user.uid,
        byName: details.name || user.displayName || '',
        at: now,
        provider,
        note: existingRequestSnap.exists() ? 'Access request refreshed by user.' : 'Access request submitted.'
      }
    }
  };
  await requestRef.set(request);
  return request;
}

async function submitPendingAccessRequest() {
  const user = firebase.auth().currentUser;
  const errEl = document.getElementById('pendingRequestError');
  const btn = document.getElementById('pendingRequestBtn');
  if (!user) {
    if (errEl) {
      errEl.textContent = 'Sign in again, then submit the access request.';
      errEl.classList.remove('hidden');
    }
    return;
  }
  const name = document.getElementById('pendingRequestName')?.value?.trim() || user.displayName || displayNameFromEmail(user.email || user.uid);
  const position = document.getElementById('pendingRequestPosition')?.value?.trim() || '';
  if (!name || !position) {
    if (errEl) {
      errEl.textContent = 'Enter your full name and position so an admin can approve you.';
      errEl.classList.remove('hidden');
    }
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending...';
  }
  try {
    const provider = user.providerData?.some(p => p.providerId === 'google.com') ? 'google' : 'password';
    await saveAccessRequest(user, { name, position, email: user.email || '' }, provider);
    if (errEl) {
      errEl.textContent = 'Access request sent. Ask an admin to approve you in Admin > Requests.';
      errEl.classList.remove('hidden');
    }
    showToast('Access request sent.');
  } catch (e) {
    console.error('submitPendingAccessRequest failed:', e);
    if (errEl) {
      errEl.textContent = authErrorMessage(e, 'Could not send access request. Ask an admin to check database rules.');
      errEl.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Send Missing Request';
    }
  }
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

  let createdUserUid = '';
  _accessRequestInProgress = true;
  try {
    const cred = await firebase.auth().createUserWithEmailAndPassword(fields.email, fields.password);
    createdUserUid = cred.user.uid;
    await cred.user.updateProfile({ displayName: fields.name }).catch(() => {});
    await saveAccessRequest(cred.user, fields, 'password');
    fields.errEl.textContent = 'Access request sent. An admin must approve your role and projects before you can use ACPM.';
    await firebase.auth().signOut();
    buttons.forEach(btn => { btn.disabled = false; });
  } catch (e) {
    console.error('Access request error:', e);
    if (e.code === 'auth/email-already-in-use') {
      try {
        const cred = await firebase.auth().signInWithEmailAndPassword(fields.email, fields.password);
        await cred.user.updateProfile({ displayName: fields.name }).catch(() => {});
        await saveAccessRequest(cred.user, fields, 'password');
        fields.errEl.textContent = 'Access request recovered and sent. An admin must approve your role and projects before you can use ACPM.';
        await firebase.auth().signOut();
        buttons.forEach(btn => { btn.disabled = false; });
        return;
      } catch (recoverError) {
        console.error('Access request recovery failed:', recoverError);
      }
    }
    if (createdUserUid && firebase.auth().currentUser?.uid === createdUserUid) {
      await firebase.auth().currentUser.delete().catch(() => {});
      await firebase.auth().signOut().catch(() => {});
    }
    fields.errEl.textContent = authErrorMessage(e, 'Could not save the access request. The Auth account was not considered approved or complete; try again or ask an admin to check database rules.');
    buttons.forEach(btn => { btn.disabled = false; });
  } finally {
    _accessRequestInProgress = false;
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

  let createdGoogleUid = '';
  _accessRequestInProgress = true;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await firebase.auth().signInWithPopup(provider);
    createdGoogleUid = cred.additionalUserInfo?.isNewUser ? cred.user.uid : '';
    await saveAccessRequest(cred.user, fields, 'google');
    fields.errEl.textContent = 'Access request sent. An admin must approve your role and projects before you can use ACPM.';
    await firebase.auth().signOut();
    buttons.forEach(btn => { btn.disabled = false; });
  } catch (e) {
    console.error('Google access request error:', e);
    if (createdGoogleUid && firebase.auth().currentUser?.uid === createdGoogleUid) {
      await firebase.auth().currentUser.delete().catch(() => {});
      await firebase.auth().signOut().catch(() => {});
    }
    fields.errEl.textContent = authErrorMessage(e, 'Could not send Google access request.');
    buttons.forEach(btn => { btn.disabled = false; });
  } finally {
    _accessRequestInProgress = false;
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

// -- Logout --------------------------------------------------

function shouldPromptProfileSetup(profile = _currentAuthUser) {
  return !!profile && profile.status === 'active' && profile.profileComplete === false;
}

function maybePromptProfileSetup() {
  if (shouldPromptProfileSetup()) {
    setTimeout(() => showMyProfileSetup(_currentAuthUser), 120);
  }
}

function closeMyProfileSetup() {
  const modal = document.getElementById('myProfileSetupModal');
  if (!modal) return;
  if (shouldPromptProfileSetup()) {
    showToast('Please complete your profile before continuing.', 'warn');
    return;
  }
  modal.remove();
}

function showMyProfileSetup(profile = {}) {
  let modal = document.getElementById('myProfileSetupModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'myProfileSetupModal';
    modal.className = 'modal-overlay profile-setup-overlay';
    document.body.appendChild(modal);
  }
  const avatar = profile.avatarUrl
    ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="Profile photo">`
    : `<span>${escapeHtml(String(profile.name || profile.email || 'U').slice(0, 1).toUpperCase())}</span>`;
  modal.innerHTML = `
    <div class="modal-box profile-setup-box">
      <div class="modal-title">My Profile</div>
      <p class="empty-hint">Complete your basic contact details. Role and project assignments stay admin-only.</p>
      <div class="profile-setup-grid">
        <div class="profile-avatar-preview" id="profileAvatarPreview">${avatar}</div>
        <div class="profile-fields">
          <label class="field-label" for="profileDisplayName">Display name</label>
          <input id="profileDisplayName" type="text" value="${escapeHtml(profile.displayName || profile.name || '')}" placeholder="Your name">
          <label class="field-label" for="profilePosition">Position / title</label>
          <input id="profilePosition" type="text" value="${escapeHtml(profile.position || '')}" placeholder="Project Manager">
          <label class="field-label" for="profileMobile">Mobile number</label>
          <input id="profileMobile" type="tel" value="${escapeHtml(profile.mobile || '')}" placeholder="09xx xxx xxxx">
          <label class="field-label" for="profilePhoto">Profile photo</label>
          <input id="profilePhoto" type="file" accept="image/*">
          <label class="field-label" for="profileSignature">Signature / initials (optional)</label>
          <input id="profileSignature" type="text" value="${escapeHtml(profile.signature || '')}" placeholder="Signature name or initials">
        </div>
      </div>
      <div id="profileSetupError" class="auth-error hidden"></div>
      <div class="modal-actions">
        ${profile.profileComplete === false ? '' : '<button class="btn-mc" onclick="closeMyProfileSetup()">Close</button>'}
        <button id="profileSaveBtn" class="btn-save-payroll" onclick="saveMyProfile()">Save Profile</button>
      </div>
    </div>
  `;
}

async function uploadProfilePhoto(uid, file) {
  if (!file) return {};
  if (!String(file.type || '').startsWith('image/')) throw new Error('Profile photo must be an image file.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Profile photo must be 5 MB or smaller.');
  const safeName = String(file.name || 'avatar.jpg').replace(/[^a-z0-9._-]/gi, '_').slice(0, 80);
  if (!PROFILE_PHOTO_STORAGE_ENABLED || !firebase.storage) {
    return {
      avatarUrl: await inlineProfilePhotoDataUrl(file),
      avatarPath: `inline:${safeName}`,
      avatarUpdatedAt: Date.now()
    };
  }
  const path = `profilePhotos/${uid}/${Date.now()}_${safeName}`;
  const ref = firebase.storage().ref(path);
  await ref.put(file, { contentType: file.type || 'image/jpeg' });
  return {
    avatarUrl: await ref.getDownloadURL(),
    avatarPath: path,
    avatarUpdatedAt: Date.now()
  };
}

function readProfilePhotoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read profile photo.'));
    reader.readAsDataURL(file);
  });
}

function loadProfilePhotoImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not process profile photo.'));
    img.src = src;
  });
}

async function inlineProfilePhotoDataUrl(file) {
  const raw = await readProfilePhotoDataUrl(file);
  try {
    const img = await loadProfilePhotoImage(raw);
    const side = Math.min(256, Math.max(1, img.naturalWidth || img.width || 1), Math.max(1, img.naturalHeight || img.height || 1));
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Profile photo compression is unavailable.');
    const sourceW = img.naturalWidth || img.width;
    const sourceH = img.naturalHeight || img.height;
    const sourceSide = Math.min(sourceW, sourceH);
    const sx = Math.max(0, (sourceW - sourceSide) / 2);
    const sy = Math.max(0, (sourceH - sourceSide) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(img, sx, sy, sourceSide, sourceSide, 0, 0, side, side);
    for (const quality of [0.82, 0.72, 0.62]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= PROFILE_PHOTO_MAX_INLINE_BYTES) return dataUrl;
    }
  } catch (error) {
    if (raw.length <= PROFILE_PHOTO_MAX_INLINE_BYTES) return raw;
  }
  throw new Error('Profile photo is too large after compression. Please choose a smaller image.');
}

async function saveMyProfile() {
  const user = firebase.auth().currentUser;
  if (!user || !_currentAuthUser?.uid) return;
  const errEl = document.getElementById('profileSetupError');
  const btn = document.getElementById('profileSaveBtn');
  const displayName = document.getElementById('profileDisplayName')?.value?.trim() || '';
  const position = document.getElementById('profilePosition')?.value?.trim() || '';
  const mobile = document.getElementById('profileMobile')?.value?.trim() || '';
  const signature = document.getElementById('profileSignature')?.value?.trim() || '';
  const photo = document.getElementById('profilePhoto')?.files?.[0] || null;
  if (!displayName) {
    if (errEl) {
      errEl.textContent = 'Display name is required.';
      errEl.classList.remove('hidden');
    }
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  let photoWarning = '';
  try {
    let photoUpdates = {};
    if (photo) {
      try {
        photoUpdates = await uploadProfilePhoto(user.uid, photo);
      } catch (photoError) {
        console.warn('profile photo upload skipped:', photoError?.code || photoError?.message || photoError);
        photoWarning = 'Profile saved, but photo upload is unavailable. Initials will be used until Firebase Storage is set up.';
      }
    }
    const updates = {
      displayName,
      name: displayName,
      position,
      mobile,
      signature,
      profileComplete: true,
      profileUpdatedAt: Date.now(),
      updatedAt: Date.now()
    };
    Object.assign(updates, photoUpdates);
    await firebase.database().ref(`users/${user.uid}`).update(updates);
    await user.updateProfile({
      displayName,
      photoURL: photoUpdates.avatarUrl || user.photoURL || null
    }).catch(() => {});
    _currentAuthUser = { ..._currentAuthUser, ...updates };
    window._currentUser = _currentAuthUser;
    const badge = document.getElementById('currentUserBadge');
    if (badge) badge.textContent = `${displayName} - ${roleLabel(_currentAuthUser.role)}`;
    document.getElementById('myProfileSetupModal')?.remove();
    showToast(photoWarning || 'Profile saved.', photoWarning ? 'warn' : 'success');
  } catch (e) {
    console.error('saveMyProfile failed:', e);
    if (errEl) {
      errEl.textContent = e?.message || 'Could not save profile.';
      errEl.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save Profile';
    }
  }
}

function logout() {
  setAppLoading(true);
  lockPrivateUi(true);
  firebase.auth().signOut().catch(() => {});
  // onAuthStateChanged (sign-out path) will clear _currentAuthUser
  // and reload via showAuthScreen. No explicit reload needed.
}

// -- App Bootstrap -------------------------------------------

async function initAppForUser() {
  const page = currentAppPage();
  if (page === 'login') {
    routeTo('dashboard');
    return;
  }
  if (page === 'pmos') {
    document.body.classList.remove('role-boss', 'role-owner', 'role-admin', 'role-pm', 'role-apm', 'role-foreman', 'role-safety', 'role-viewer');
    document.body.classList.add(`role-${normalizeRole(_currentAuthUser?.role || 'apm')}`);
    filterProjectsByRole();
    if (typeof initLine17Pmos === 'function') await initLine17Pmos();
    unlockPrivateUi();
    maybePromptProfileSetup();
    return;
  }
  const role = normalizeRole(_currentAuthUser?.role || 'apm');
  const extrasEnabled = typeof getFeatureFlag === 'function' ? getFeatureFlag('extras', true) : true;

  // Role-based CSS classes
  document.body.classList.remove('role-boss', 'role-owner', 'role-admin', 'role-pm', 'role-apm', 'role-foreman', 'role-safety', 'role-viewer');
  document.body.classList.add(`role-${role}`);
  document.body.classList.toggle('role-boss', isBoss(role));

  // Filter projects based on assignment
  filterProjectsByRole();

  // Show/hide boss-only features
  document.querySelectorAll('[data-boss-only]').forEach(el => {
    el.style.display = isBoss(role) ? '' : 'none';
  });

  document.querySelectorAll('[data-role-visible]').forEach(el => {
    el.style.display = elementAllowsRole(el, role) ? '' : 'none';
  });

  document.querySelectorAll('[data-feature-visible="extras"]').forEach(el => {
    el.style.display = extrasEnabled && elementAllowsRole(el, role) ? '' : 'none';
  });

  const extrasToggle = document.getElementById('extrasToggleBtn');
  if (extrasToggle) {
    extrasToggle.classList.toggle('is-enabled', extrasEnabled);
    extrasToggle.textContent = extrasEnabled ? 'Extras On' : 'Extras';
    extrasToggle.title = extrasEnabled ? 'Hide optional tabs' : 'Show optional tabs';
    // Position Extras toggle at the end of the tab group
    const tabGroup = extrasToggle.closest('.tab-group');
    if (tabGroup && extrasToggle.parentNode === tabGroup) {
      tabGroup.appendChild(extrasToggle);
    }
  }

  const preferredTab = canSeeFinancials(role) ? '#tab_reports' : (isFieldRole(role) || isViewerRole(role)) ? '#tab_sitelog' : '#tab_labor';
  const activeWorkspaceTab = document.querySelector('.tab-btn.tab-active:not(#tab_admin)');
  if (!activeWorkspaceTab || activeWorkspaceTab.style.display === 'none' || !activeWorkspaceTab.id || (canSeeFinancials(role) && activeWorkspaceTab.id !== 'tab_reports')) {
    const fallback = document.querySelector(preferredTab);
    if (fallback && fallback.style.display !== 'none') fallback.click();
  }

  const createCard = document.querySelector('.hub-create-card');
  if (createCard) createCard.style.display = isBoss(role) ? '' : 'none';

  if (typeof initNotifications === 'function') initNotifications();

  if (page === 'workspace') {
    const pid = typeof getRouteProjectId === 'function'
      ? getRouteProjectId()
      : new URLSearchParams(window.location.search).get('projectId');
    if (!pid) {
      routeTo('dashboard');
      return;
    }
    try {
      const opened = await enterProject(pid);
      if (!opened) {
        routeTo('dashboard');
        return;
      }
    } catch (e) {
      console.error('Workspace route failed:', e);
      showToast('Could not open that workspace. Returning to dashboard.', 'error');
      routeTo('dashboard');
      return;
    }
    unlockPrivateUi();
    maybePromptProfileSetup();
  } else {
    // Re-render hub with role-aware data
    renderHub();
    unlockPrivateUi();
    maybePromptProfileSetup();
  }

  // Boss-only background housekeeping
  if (isBoss(role)) {
    scanComplianceAcrossProjects().catch(() => {});
    pruneAuditLog().catch(() => {});
  }
}

// -- Role / Access Helpers -----------------------------------

function filterProjectsByRole() {
  const user = _currentAuthUser;
  if (!user || isBoss(user.role)) return;
  const allowed = normalizeProjectList(user.projects);
  window._allowedProjects = new Set(allowed);
}

function canAccessProject(pid) {
  const user = _currentAuthUser;
  if (!user) return false;
  if (!isRc1ActiveRole(user.role)) return false;
  if (isBoss(user.role)) return true;
  if (normalizeProjectList(user.bossOf).includes(pid)) return true;
  return normalizeProjectList(user.projects).includes(pid);
}

function canEditProject(pid) {
  const user = _currentAuthUser;
  if (!user) return false;
  if (!isRc1ActiveRole(user.role)) return false;
  if (isBoss(user.role)) return true;
  if (normalizeProjectList(user.bossOf).includes(pid)) return true;
  if (!canEditAssignedProject(user.role)) return false;
  return normalizeProjectList(user.projects).includes(pid);
}

function canReadFullProject(pid) {
  const user = _currentAuthUser;
  if (!user) return false;
  if (!isRc1ActiveRole(user.role)) return false;
  if (isBoss(user.role)) return true;
  if (!canReadFullAssignedProject(user.role)) return false;
  return normalizeProjectList(user.projects).includes(pid) || normalizeProjectList(user.bossOf).includes(pid);
}

function canWriteFieldLog(pid) {
  const user = _currentAuthUser;
  if (!user) return false;
  if (!isRc1ActiveRole(user.role)) return false;
  if (isBoss(user.role)) return true;
  if (isViewerRole(user.role)) return false;
  return normalizeProjectList(user.projects).includes(pid) || normalizeProjectList(user.bossOf).includes(pid);
}

// -- Expose --------------------------------------------------
window.initAuth          = initAuth;


window.doLogin           = doLogin;
window.doRegister        = doRegister;
window.doRequestAccess   = doRequestAccess;
window.submitPendingAccessRequest = submitPendingAccessRequest;
window.doGoogleSignIn    = doGoogleSignIn;
window.doGoogleAccessRequest = doGoogleAccessRequest;
window.doResetPassword   = doResetPassword;
window.logout            = logout;
window.canAccessProject  = canAccessProject;
window.canEditProject    = canEditProject;
window.getCurrentUser    = () => _currentAuthUser;
window.normalizeRole     = normalizeRole;
window.isBoss            = isBoss;
window.isRc1ActiveRole   = isRc1ActiveRole;
window.canSeeFinancials  = canSeeFinancials;
window.canEditAssignedProject = canEditAssignedProject;
window.canReadFullAssignedProject = canReadFullAssignedProject;
window.canReadFullProject = canReadFullProject;
window.isFieldRole       = isFieldRole;
window.isViewerRole      = isViewerRole;
window.canWriteFieldLog  = canWriteFieldLog;
window.elementAllowsRole = elementAllowsRole;
window.roleLabel         = roleLabel;
window.teamRoleLabel     = teamRoleLabel;
window.normalizeProjectList = normalizeProjectList;
window.showMyProfileSetup = showMyProfileSetup;
window.closeMyProfileSetup = closeMyProfileSetup;
window.saveMyProfile = saveMyProfile;
