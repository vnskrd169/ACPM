(function configureAcpmEnvironment(window, document) {
  'use strict';

  const ENVIRONMENTS = Object.freeze({
    production: Object.freeze({
      name: 'production',
      firebase: Object.freeze({
        apiKey: 'AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA',
        authDomain: 'acpm-project-system.firebaseapp.com',
        databaseURL: 'https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app',
        projectId: 'acpm-project-system',
        storageBucket: 'acpm-project-system.firebasestorage.app',
        messagingSenderId: '330800177544',
        appId: '1:330800177544:web:8f29dcd81ca39976849a3d'
      }),
      manifest: 'manifest.json',
      pmosManifest: './pmos-manifest.json'
    }),
    staging: Object.freeze({
      name: 'staging',
      firebase: Object.freeze({
        apiKey: 'AIzaSyC4qihU8oA4vbmIPusoURYfkQ8u-J3nF9g',
        authDomain: 'acpm-project-system-qa.firebaseapp.com',
        databaseURL: 'https://acpm-project-system-qa-default-rtdb.asia-southeast1.firebasedatabase.app',
        projectId: 'acpm-project-system-qa',
        messagingSenderId: '305843466655',
        appId: '1:305843466655:web:01afca0060f7ee8e8f8daa'
      }),
      manifest: 'manifest-staging.json',
      pmosManifest: './pmos-manifest-staging.json'
    })
  });

  const hostname = String(window.location.hostname || '').toLowerCase();
  const productionHosts = new Set([
    'acpm-project-system.web.app',
    'acpm-project-system.firebaseapp.com'
  ]);
  const stagingHosts = new Set([
    'acpm-project-system-qa.web.app',
    'acpm-project-system-qa.firebaseapp.com'
  ]);
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';
  let environmentName = stagingHosts.has(hostname) || isLocal ? 'staging' : 'production';

  // A local production override is intentionally explicit. Public production
  // hosts can never be switched away from production with a URL parameter.
  if (isLocal) {
    const requested = new URLSearchParams(window.location.search).get('env');
    if (requested === 'production' || requested === 'staging') {
      environmentName = requested;
    }
  }
  if (productionHosts.has(hostname)) environmentName = 'production';

  const environment = ENVIRONMENTS[environmentName];
  window.ACPM_ENVIRONMENTS = ENVIRONMENTS;
  window.ACPM_ENVIRONMENT = environment.name;
  window.ACPM_FIREBASE_CONFIG = environment.firebase;
  window.ACPM_IS_STAGING = environment.name === 'staging';

  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) {
    manifest.setAttribute(
      'href',
      window.ACPM_PAGE === 'pmos' ? environment.pmosManifest : environment.manifest
    );
  }

  if (!window.ACPM_IS_STAGING) return;

  document.documentElement.classList.add('acpm-staging');
  if (!document.title.startsWith('[STAGING]')) {
    document.title = `[STAGING] ${document.title}`;
  }

  const showStagingMarker = function showStagingMarker() {
    if (document.getElementById('acpmStagingMarker')) return;
    const marker = document.createElement('div');
    marker.id = 'acpmStagingMarker';
    marker.className = 'acpm-staging-marker';
    marker.setAttribute('role', 'status');
    marker.textContent = 'STAGING - TEST DATA';
    document.body.appendChild(marker);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showStagingMarker, { once: true });
  } else {
    showStagingMarker();
  }
})(window, document);
