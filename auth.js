//  ACPM — auth.js
//  Lightweight auth system using Firebase Database (NOT Auth).
//  Roles: boss | apm | viewer
//  No Firebase Auth costs — uses simple username/password hash
//  stored in Firebase DB under /users/{uid}
// ════════════════════════════════════════════════════════════

const AUTH_VERSION = '1';
let _currentAuthUser = null;

// ── Simple hash (not cryptographically secure but sufficient for internal tool)
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

// ── Initialize Auth UI ──────────────────────────────────────
function initAuth() {
  const saved = localStorage.getItem('acpm_auth');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.uid && parsed.token) {
        validateSession(parsed.uid, parsed.token);
        return;
      }
    } catch(e) {}
  }
  showAuthScreen();
}

function showAuthScreen() {
  const overlay = document.createElement('div');
  overlay.id = 'authOverlay';
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <div class="auth-box">
      <div class="auth-brand">
        <div class="auth-logo">LB</div>
        <div>
          <div class="auth-name">ACPM</div>
          <div class="auth-sub">LeBuild Design & Construction</div>
        </div>
      </div>
      <div class="auth-form">
        <input type="text" id="authUser" placeholder="Username" autocomplete="username">
        <input type="password" id="authPass" placeholder="Password" autocomplete="current-password">
        <button class="auth-btn" onclick="doLogin()">Sign In</button>
      </div>
      <div class="auth-hint">Contact admin for access credentials</div>
      <div id="authError" class="auth-error hidden"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('authUser').focus();
  document.getElementById('authPass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
}

async function doLogin() {
  const userIn = document.getElementById('authUser');
  const passIn = document.getElementById('authPass');
  const errEl = document.getElementById('authError');
  const btn = document.querySelector('.auth-btn');

  const username = userIn?.value.trim().toLowerCase();
  const password = passIn?.value;

  if (!username || !password) {
    errEl.textContent = 'Enter username and password';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const snap = await firebase.database().ref(`users/${username}`).once('value');
    const userData = snap.val();

    if (!userData || userData.passHash !== simpleHash(password)) {
      errEl.textContent = 'Invalid credentials';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign In';
      return;
    }

    // Generate session token
    const token = simpleHash(username + Date.now() + Math.random());
    const session = {
      uid: username,
      name: userData.name || username,
      role: userData.role || 'viewer',
      token: token,
      projects: userData.projects || [],
      bossOf: userData.bossOf || [],
      loginAt: Date.now()
    };

    // Store session in Firebase for server-side validation
    await firebase.database().ref(`sessions/${username}`).set({
      token, loginAt: Date.now(), ip: 'client'
    });

    localStorage.setItem('acpm_auth', JSON.stringify(session));
    _currentAuthUser = session;
    window._currentUser = session;

    // Remove overlay and init app
    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.remove();

    showToast(`Welcome, ${session.name} (${session.role})`);
    initAppForUser();

  } catch (e) {
    console.error(e);
    errEl.textContent = 'Connection error. Check internet.';
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

async function validateSession(uid, token) {
  try {
    const snap = await firebase.database().ref(`sessions/${uid}`).once('value');
    const sessionData = snap.val();
    if (!sessionData || sessionData.token !== token) {
      logout();
      return;
    }

    const userSnap = await firebase.database().ref(`users/${uid}`).once('value');
    const userData = userSnap.val();
    if (!userData) { logout(); return; }

    _currentAuthUser = {
      uid, name: userData.name || uid,
      role: userData.role || 'viewer',
      token, projects: userData.projects || [],
      bossOf: userData.bossOf || [],
      loginAt: sessionData.loginAt
    };
    window._currentUser = _currentAuthUser;
    initAppForUser();

  } catch (e) {
    console.error(e);
    // Offline mode - use cached session
    _currentAuthUser = JSON.parse(localStorage.getItem('acpm_auth'));
    window._currentUser = _currentAuthUser;
    initAppForUser();
  }
}

function logout() {
  const uid = _currentAuthUser?.uid;
  if (uid) firebase.database().ref(`sessions/${uid}`).remove().catch(()=>{});
  localStorage.removeItem('acpm_auth');
  _currentAuthUser = null;
  window._currentUser = null;
  location.reload();
}

function initAppForUser() {
  // Update UI based on role
  const role = _currentAuthUser?.role || 'viewer';

  // Boss sees everything, APM sees assigned projects
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
    el.style.display = role === 'boss' ? '' : 'none';
  });

  // Re-render hub with role-aware data
  renderHub();

  // Boss-only background housekeeping (cheap, fire-and-forget)
  if (role === 'boss') {
    scanComplianceAcrossProjects().catch(() => {});
    pruneAuditLog().catch(() => {});
  }
}

function filterProjectsByRole() {
  const user = _currentAuthUser;
  if (!user || user.role === 'boss') return; // Boss sees all

  const allowed = user.projects || [];
  window._allowedProjects = new Set(allowed);
}

function canAccessProject(pid) {
  const user = _currentAuthUser;
  if (!user) return false;
  if (user.role === 'boss') return true;
  if (user.bossOf && user.bossOf.includes(pid)) return true;
  return (user.projects || []).includes(pid);
}

function canEditProject(pid) {
  const user = _currentAuthUser;
  if (!user) return false;
  if (user.role === 'boss') return true;
  if (user.bossOf && user.bossOf.includes(pid)) return true;
  return (user.projects || []).includes(pid);
}

// ── Expose ──────────────────────────────────────────────────
window.initAuth = initAuth;
window.doLogin = doLogin;
window.logout = logout;
window.canAccessProject = canAccessProject;
window.canEditProject = canEditProject;
window.getCurrentUser = () => _currentAuthUser;