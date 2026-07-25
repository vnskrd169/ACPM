const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function parseJson(file) {
  try {
    return JSON.parse(read(file));
  } catch (error) {
    throw new Error(`${file} must parse as JSON: ${error.message}`);
  }
}

function localRefsFromHtml(html) {
  const refs = [];
  const patterns = [
    /\b(?:href|src)=["']([^"']+)["']/g
  ];
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html))) refs.push(match[1]);
  });
  return refs
    .filter(ref => ref && !ref.startsWith('http') && !ref.startsWith('data:') && !ref.startsWith('#'))
    .map(ref => ref.split('?')[0].split('#')[0]);
}

function assertLocalRefExists(fromFile, ref) {
  const base = path.dirname(path.join(root, fromFile));
  const target = path.normalize(path.join(base, ref));
  assert(target.startsWith(root), `${fromFile} must not reference outside project root`, { ref });
  assert(fs.existsSync(target), `${fromFile} references missing asset ${ref}`, { target });
}

function assertNoMojibake(file) {
  const text = read(file);
  assert(!/[\uFFFD]/.test(text), `${file} must not contain replacement characters`);
  assert(!/(Ã.|Â.|â€|â€”|â€“|ï¿½)/.test(text), `${file} must not contain common mojibake sequences`);
}

function main() {
  const pmosIndex = read('pmos/index.html');
  const pmosShell = read('acpm-shell.js');
  const pmosApp = read('pmos.js');
  const pmosSw = read('pmos/pmos-sw.js');
  const rootPmosSw = read('pmos-sw.js');
  const pmosManifest = parseJson('pmos/pmos-manifest.json');
  const rootPmosManifest = parseJson('pmos-manifest.json');
  const appManifest = parseJson('manifest.json');
  parseJson('firebase.json');
  parseJson('database.rules.json');

  assert(!pmosIndex.includes('firebase-storage.js'), 'PMOS field shell must not load Firebase Storage SDK');
  assert(!pmosIndex.includes('face-attendance.js'), 'PMOS field shell must not load Face Attendance while Storage is disabled');
  assert(pmosShell.includes("photoStorageProvider: 'googleDrive'"), 'PMOS config must use Google Drive photo provider');
  assert(pmosShell.includes('useFirebaseStoragePhotos: false'), 'PMOS config must keep Firebase Storage photos disabled');
  assert(pmosShell.includes('useGoogleDrivePhotos: true'), 'PMOS config must keep Google Drive photos enabled');
  assert(/driveUploadUrl:\s*'https:\/\/script\.google\.com\/macros\/s\//.test(pmosShell), 'PMOS Drive upload URL must use Google Apps Script');
  assert(pmosShell.includes("faceAttendanceEnabled: false"), 'Face Attendance must remain disabled for PMOS rollout');
  assert(!/firebase\.storage\s*\(/.test(pmosApp), 'PMOS app photo upload path must not call firebase.storage()');
  assert(pmosApp.includes('Google Drive only'), 'PMOS photo upload code must document Drive-only upload path');
  assert(pmosApp.includes("storageProvider: 'Google Drive'"), 'PMOS photo records must store Google Drive as provider');

  assert(pmosSw.includes("pmos-cache-v2"), 'scoped PMOS service worker must use pmos-cache-v2');
  assert(rootPmosSw.includes("pmos-cache-v2"), 'legacy PMOS service worker must use pmos-cache-v2');
  assert(pmosShell.includes("const CACHE_VERSION = 'acpm-pmos-v2'"), 'PMOS shell cache label must be acpm-pmos-v2');
  assert(!pmosSw.includes('../face-attendance.js'), 'scoped PMOS SW must not cache Face Attendance for Drive-only rollout');
  assert(!rootPmosSw.includes('./face-attendance.js'), 'legacy PMOS SW must not cache Face Attendance for Drive-only rollout');

  assert(pmosManifest.start_url === './index.html', 'scoped PMOS manifest must start at ./index.html');
  assert(rootPmosManifest.start_url === './pmos.html', 'root PMOS manifest must start at ./pmos.html');
  assert(appManifest.start_url === './login.html', 'ACPM app manifest must start at login.html');
  assert(String(pmosManifest.theme_color).toLowerCase() === '#0f766e', 'PMOS theme color must use LeBuild/PMOS teal');
  assert(String(appManifest.theme_color).toLowerCase() === '#0f766e', 'ACPM manifest theme color must stay aligned');

  localRefsFromHtml(pmosIndex).forEach(ref => assertLocalRefExists('pmos/index.html', ref));
  ['pmos/pmos-sw.js', 'pmos-sw.js'].forEach(file => {
    const content = read(file);
    const assetMatches = [...content.matchAll(/['"](\.{1,2}\/[^'"]+)['"]/g)].map(m => m[1]);
    assetMatches
      .filter(ref => !ref.endsWith('/') && !ref.includes('firebase') && !ref.includes('google'))
      .forEach(ref => assertLocalRefExists(file, ref));
  });

  [
    'pmos/index.html',
    'pmos.html',
    'pmos/pmos-manifest.json',
    'pmos/pmos-sw.js',
    'pmos-sw.js',
    'pmos.js',
    'acpm-shell.js',
    'assets/brand/README.md',
    'BRAND_ASSETS.md'
  ].forEach(assertNoMojibake);

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'PMOS field shell is Firebase Storage-free',
      'PMOS photo path uses Google Drive Apps Script',
      'Face Attendance remains disabled and unloaded from PMOS rollout shell',
      'PMOS cache versions are bumped',
      'ACPM and PMOS manifest parameters parse and align',
      'PMOS local asset references exist',
      'Brand/PMOS shell text has no mojibake'
    ],
    pmosCache: 'pmos-cache-v2',
    pmosShellCache: 'acpm-pmos-v2',
    photoProvider: 'Google Drive'
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    result: 'FAILED',
    error: error.message,
    details: error.details || {}
  }, null, 2));
  process.exit(1);
}
