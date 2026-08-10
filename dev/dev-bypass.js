// ============================================================
//  ACPM LOCAL DEV SHELL — auth/database bypass (dev only)
// ============================================================
//  What this is:
//    A localhost-only debugging shell for the ACPM web app. It lets a
//    developer open the real workspace/dashboard/login pages WITHOUT the
//    Firebase login wall, against a LOCAL RTDB emulator seeded with test
//    data. The goal is to debug the labor/payroll workflow (roster,
//    attendance, payroll review, cash advances, RFP) with instant access.
//
//  Security model (fail-closed):
//    - This script ONLY activates when served from a local hostname
//      (localhost / 127.0.0.1 / empty) AND the user opted in explicitly
//      via `?dev=1` in the URL or the dev.html launcher's session flag.
//    - On ANY remote host (production, staging, preview, etc.) this file
//      returns immediately and never installs the mock auth or emulator
//      wiring. Production behavior is byte-for-byte unchanged.
//    - The `dev/` directory is excluded from Firebase Hosting deploys
//      (see firebase.json hosting.ignore), so this file cannot ship.
//    - The database is redirected to a LOCAL emulator (port 18300), never
//      to the real staging/production project.
// ============================================================

(function () {
  'use strict';

  var host = String(window.location.hostname || '').toLowerCase();
  var isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '' || host === '::1';

  var optedIn = false;
  try {
    var params = new URLSearchParams(window.location.search);
    optedIn = params.get('dev') === '1' || sessionStorage.getItem('acpm_dev_shell') === '1';
  } catch (e) { /* sessionStorage unavailable - treat as not opted in */ }

  // ── Fail-closed guard ─────────────────────────────────────
  if (!isLocalHost || !optedIn) {
    if (!isLocalHost && window.location.pathname.indexOf('dev') !== -1) {
      try { window.location.replace('/login.html'); } catch (e) {}
    }
    return;
  }

  window.__ACPM_DEV_SHELL__ = true;
  window.ACPM_DEV_SHELL = true;

  // ── Restore navigation state stripped by dev-server clean-URL redirects ──
  // `serve` (and some static hosts) 301-redirect workspace.html?x=1 -> /workspace
  // and drop the query string. The launcher stores the target project in
  // sessionStorage; restore it into the URL before main.js reads location.search.
  try {
    var devProject = sessionStorage.getItem('acpm_dev_project');
    if (devProject) {
      var u = new URL(window.location.href);
      if (!u.searchParams.get('projectId')) {
        u.searchParams.set('projectId', devProject);
      }
      u.searchParams.set('dev', '1');
      window.history.replaceState(null, '', u.toString());
    }
  } catch (e) { /* ignore */ }

  var DEV_DB_HOST = '127.0.0.1';
  var DEV_DB_PORT = 18300;

  // ── Redirect the Realtime Database to the local emulator ──
  // main.js calls firebase.initializeApp() at load time; wrap it so the
  // emulator is wired immediately after init and before any data read.
  // (If the Firebase CDN failed to load, `firebase` may be undefined —
  // bail out and let the app surface its own error.)
  if (typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function') return;
  var _realInit = firebase.initializeApp.bind(firebase);
  firebase.initializeApp = function (config) {
    var app = _realInit(config);
    try {
      firebase.database().useEmulator(DEV_DB_HOST, DEV_DB_PORT);
      if (window.console) console.info('[ACPM DEV SHELL] database -> emulator', DEV_DB_HOST + ':' + DEV_DB_PORT);
    } catch (e) {
      if (window.console) console.warn('[ACPM DEV SHELL] emulator wiring failed:', e && e.message);
    }
    return app;
  };

  // ── Mock Firebase Auth (immediate boss session) ───────────
  var DEV_USER = {
    uid: 'dev-boss',
    email: 'dev@acpm.local',
    displayName: 'DEV Boss',
    emailVerified: true,
    isAnonymous: false
  };

  var mockAuth = {
    currentUser: DEV_USER,
    Auth: { Persistence: { LOCAL: 'local' } },
    setPersistence: function () { return Promise.resolve(); },
    signInWithEmailAndPassword: function () { return Promise.resolve({ user: DEV_USER }); },
    signInWithPopup: function () { return Promise.resolve({ user: DEV_USER }); },
    createUserWithEmailAndPassword: function () { return Promise.resolve({ user: DEV_USER }); },
    signOut: function () { return Promise.resolve(); },
    sendPasswordResetEmail: function () { return Promise.resolve(); },
    updateProfile: function () { return Promise.resolve(); },
    reload: function () { return Promise.resolve(); },
    getIdToken: function () { return Promise.resolve('dev-shell-token'); },
    useEmulator: function () {},
    onAuthStateChanged: function (cb) {
      // Fire asynchronously so listeners registered during boot still receive it.
      setTimeout(function () { try { cb(DEV_USER); } catch (e) {} }, 0);
      return function () {};
    },
    onIdTokenChanged: function (cb) {
      setTimeout(function () { try { cb(DEV_USER); } catch (e) {} }, 0);
      return function () {};
    }
  };

  firebase.auth = function () { return mockAuth; };
  firebase.auth.Auth = mockAuth.Auth;

  // ── Visible DEV badge (dismissible) + exit ────────────────
  function mountBadge() {
    if (document.getElementById('acpmDevShellBadge')) return;
    var badge = document.createElement('div');
    badge.id = 'acpmDevShellBadge';
    badge.setAttribute('role', 'status');
    badge.style.cssText = [
      'position:fixed', 'right:14px', 'bottom:14px', 'z-index:2147483000',
      'background:#7c3aed', 'color:#fff', 'font:600 12px/1.4 Inter,system-ui,sans-serif',
      'padding:8px 12px', 'border-radius:10px', 'box-shadow:0 6px 20px rgba(0,0,0,.35)',
      'display:flex', 'align-items:center', 'gap:8px', 'cursor:pointer', 'user-select:none'
    ].join(';');
    badge.innerHTML = '⚗️ DEV SHELL <span style="opacity:.8">(local emulator)</span> <span id="acpmDevShellExit" style="background:rgba(255,255,255,.22);border-radius:6px;padding:1px 6px">exit</span>';
    badge.addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'acpmDevShellExit') {
        try { sessionStorage.removeItem('acpm_dev_shell'); } catch (e) {}
        try { window.location.href = '/login.html'; } catch (e) {}
      }
    });
    document.body.appendChild(badge);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountBadge, { once: true });
  } else {
    mountBadge();
  }
})();
