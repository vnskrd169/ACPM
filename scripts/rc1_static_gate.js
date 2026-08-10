const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function extractScriptVersion(html, file) {
  const match = html.match(new RegExp(`${file.replace('.', '\\.')}\\?v=(\\d+)`));
  return match ? match[1] : '';
}

function main() {
  const rules = JSON.parse(read('database.rules.json'));
  const rulesText = JSON.stringify(rules);
  const report = read('report.js');
  const auth = read('auth.js');
  const style = read('style.css');
  const mainSource = read('main.js');
  const notifications = read('notifications.js');
  const appSources = [
    'auth.js',
    'main.js',
    'labor.js',
    'materials.js',
    'billing.js',
    'changeorders.js',
    'sitelog.js',
    'suppliers.js',
    'equipment.js',
    'compliance.js',
    'defects.js',
    'tasks.js',
    'notifications.js',
    'report.js',
    'utils.js'
  ];
  const materials = read('materials.js');
  const sw = read('sw.js');
  const htmlFiles = ['dashboard.html', 'workspace.html'];
  const html = Object.fromEntries(htmlFiles.map(file => [file, read(file)]));
  const indexHtml = read('index.html');
  const loginHtml = read('login.html');

  assert(/const CACHE_NAME = 'acpm-v136'/.test(sw), 'service worker cache must be acpm-v136');
  assert(loginHtml.includes('<link rel="stylesheet" href="style.css?v=110">'), 'login.html must load style.css?v=110');
  assert(extractScriptVersion(loginHtml, 'environment.js') === '1', 'login.html must load environment.js?v=1');
  assert(extractScriptVersion(loginHtml, 'utils.js') === '87', 'login.html must load utils.js?v=87');
  assert(extractScriptVersion(loginHtml, 'auth.js') === '98', 'login.html must load auth.js?v=98');
  assert(extractScriptVersion(loginHtml, 'main.js') === '108', 'login.html must load main.js?v=108');
  assert(indexHtml.includes("window.location.replace('./login.html' + suffix)"), 'legacy index.html must redirect to the maintained login route');
  assert(!/<script\s+src=/.test(indexHtml), 'legacy index.html must not duplicate the private app shell');
  for (const [file, content] of Object.entries(html)) {
    assert(content.includes('<link rel="stylesheet" href="style.css?v=110">'), `${file} must load style.css?v=110`);
    assert(extractScriptVersion(content, 'environment.js') === '1', `${file} must load environment.js?v=1`);
    assert(extractScriptVersion(content, 'utils.js') === '87', `${file} must load utils.js?v=87`);
    assert(extractScriptVersion(content, 'auth.js') === '98', `${file} must load auth.js?v=98`);
    assert(extractScriptVersion(content, 'main.js') === '108', `${file} must load main.js?v=108`);
    assert(extractScriptVersion(content, 'suppliers.js') === '94', `${file} must load suppliers.js?v=94`);
    assert(extractScriptVersion(content, 'payroll-math.js') === '2', `${file} must load payroll-math.js?v=2`);
    assert(extractScriptVersion(content, 'labor.js') === '98', `${file} must load labor.js?v=98`);
    assert(extractScriptVersion(content, 'materials.js') === '96', `${file} must load materials.js?v=96`);
    assert(extractScriptVersion(content, 'billing.js') === '76', `${file} must load billing.js?v=76`);
    assert(extractScriptVersion(content, 'notifications.js') === '86', `${file} must load notifications.js?v=86`);
    assert(extractScriptVersion(content, 'report.js') === '97', `${file} must load report.js?v=97`);
  }
  assert(sw.includes('./utils.js?v=87'), 'service worker must cache utils.js?v=87');
  assert(sw.includes('./environment.js?v=1'), 'service worker must cache environment.js?v=1');
  assert(sw.includes('./style.css?v=110'), 'service worker must cache style.css?v=110');
  assert(sw.includes('./auth.js?v=98'), 'service worker must cache auth.js?v=98');
  assert(sw.includes('./main.js?v=108'), 'service worker must cache main.js?v=108');
  assert(sw.includes('./payroll-math.js?v=2'), 'service worker must cache payroll-math.js?v=2');
  assert(sw.includes('./labor.js?v=98'), 'service worker must cache labor.js?v=98');
  assert(sw.includes('./materials.js?v=96'), 'service worker must cache materials.js?v=96');
  assert(sw.includes('./billing.js?v=76'), 'service worker must cache billing.js?v=76');
  assert(sw.includes('./suppliers.js?v=94'), 'service worker must cache suppliers.js?v=94');
  assert(sw.includes('./report.js?v=97'), 'service worker must cache report.js?v=97');
  assert(sw.includes('./changeorders.js?v=95'), 'service worker must cache changeorders.js?v=95');
  assert(sw.includes('./sitelog.js?v=94'), 'service worker must cache sitelog.js?v=94');
  assert(sw.includes('./equipment.js?v=94'), 'service worker must cache equipment.js?v=94');
  assert(sw.includes('./defects.js?v=94'), 'service worker must cache defects.js?v=94');
  assert(sw.includes('./tasks.js?v=95'), 'service worker must cache tasks.js?v=95');
  assert(sw.includes('./notifications.js?v=86'), 'service worker must cache notifications.js?v=86');
  assert(sw.includes("url.pathname === '/pmos/'") && sw.includes("url.pathname.startsWith('/pmos/')"), 'root service worker must leave /pmos/ routes to the scoped PMOS service worker');
  assert(auth.includes("typeof detachHubListeners === 'function'"), 'auth logout cleanup must detach Hub Firebase listeners');
  assert(auth.includes("typeof detachLaborListeners === 'function'"), 'auth logout cleanup must detach Labor Firebase listeners');
  assert(auth.includes("typeof detachMatListeners === 'function'"), 'auth logout cleanup must detach Materials Firebase listeners');
  assert(auth.includes("typeof detachReportsListeners === 'function'"), 'auth logout cleanup must detach report/admin Firebase listeners');
  assert(auth.includes("typeof detachNotifications === 'function'"), 'auth logout cleanup must detach notification Firebase listeners');

  assert(mainSource.includes('...normalize(user.assignedProjects)'), 'dashboard assigned-project loading must support assignedProjects and project maps');
  assert(notifications.includes('...normalize(user.assignedProjects)'), 'notification listeners must support map-shaped assigned projects');
  assert(report.includes('function updateUserStatus'), 'Team Admin must expose suspend/reactivate/archive status workflow');
  assert(report.includes('window.updateUserStatus = updateUserStatus'), 'Team Admin user status workflow must be exported');
  assert(!report.includes('UID ${escapeHtml(uid)}'), 'Access request cards must not expose raw UID in normal admin scanning');

  const activeRolePattern = 'boss|owner|admin|pm|apm';
  assert(rulesText.includes(activeRolePattern), 'rules must include RC1 active role pattern');
  assert(rulesText.includes("newData.child('role').val().matches(/^(boss|owner|admin|pm|apm)$/)"), 'user role validation must only accept RC1 active roles');
  assert(!rulesText.includes('boss|owner|admin|pm|apm|foreman'), 'rules must not include field roles in management access patterns');
  assert(!rulesText.includes('boss|owner|admin|pm|apm|viewer'), 'rules must not include viewer in management access patterns');
  assert(!rulesText.includes('boss|owner|admin|pm|apm|safety'), 'rules must not include safety in management access patterns');

  assert(report.includes("['boss', 'Boss / Owner']"), 'Team Admin role options must include Boss / Owner');
  assert(report.includes("['admin', 'Admin']"), 'Team Admin role options must include Admin');
  assert(report.includes("['pm', 'Project Manager']"), 'Team Admin role options must include PM');
  assert(report.includes("['apm', 'Assoc. Project Manager']"), 'Team Admin role options must include APM');
  assert(!/teamRoleOptions[\s\S]*\['foreman'/.test(report), 'Team Admin role options must not include Foreman');
  assert(!/teamRoleOptions[\s\S]*\['safety'/.test(report), 'Team Admin role options must not include Safety');
  assert(!/teamRoleOptions[\s\S]*\['viewer'/.test(report), 'Team Admin role options must not include Viewer');
  assert(report.includes('Foreman, Safety, and Viewer roles are deferred'), 'updateUserRole must reject deferred field roles');
  assert(auth.includes('function isRc1ActiveRole'), 'auth helper must expose isRc1ActiveRole');
  assert(auth.includes("const RC1_ACTIVE_ROLES = new Set(['boss', 'owner', 'admin', 'pm', 'apm'])"), 'auth helper must define RC1 active roles only');
  assert(/function isRc1ActiveRole\(role\)[\s\S]*explicitRole[\s\S]*RC1_ACTIVE_ROLES\.has\(explicitRole\)/.test(auth), 'isRc1ActiveRole must require an explicit active role');
  assert(/function detachReportsListeners\(\)[\s\S]*_teamAdminListener\.off\(\)[\s\S]*_auditListener\.off\(\)[\s\S]*_lifecycleRequestListener\.off\(\)/.test(report), 'detachReportsListeners must detach report, team, audit, and lifecycle listeners');
  assert(report.includes('collectProjectFallbackAuditRows'), 'report audit UI must collect project fallback audit rows');
  assert(report.includes('collectSupplierFallbackAuditRows'), 'report audit UI must collect supplier fallback audit rows');
  assert(report.includes("firebase.database().ref('supplierAuditLogs')"), 'report audit UI must read supplier audit fallback from admin-only root path');
  assert(report.includes('Local fallback audit path'), 'report audit UI must label fallback audit rows');
  assert(read('utils.js').includes('supplierAuditLogs/${logEntry.entityId}'), 'audit fallback must write supplier audit rows outside public supplier profiles');
  assert(read('main.js').includes('registration.update()'), 'main.js must actively check for service worker updates');
  assert(read('main.js').includes("addEventListener('controllerchange'"), 'main.js must reload on service worker controller changes');
  assert(/#adminPanel\.read-only\s*\{[\s\S]*pointer-events:\s*auto/.test(style), 'Admin panel must remain clickable while completed projects are read-only');
  assert(/\[data-theme="light"\][\s\S]*--surface-hover:\s*#f7f5ff/.test(style), 'Light theme must define a readable hover surface');
  assert(/#systemReportsView \.health-name[\s\S]*color:\s*var\(--text\)/.test(style), 'System Report project names must use theme text color');
  assert(read('main.js').includes("const sections = ['summary', 'team', 'requests', 'audit', 'system'];"), 'main Admin switcher must include lifecycle requests and audit sections');
  appSources.forEach(sourceFile => {
    assert(!/\\u1F[0-9A-Fa-f]{3}/.test(read(sourceFile)), `${sourceFile} must not use invalid \\u1Fxxx emoji escapes`);
  });
  assert(materials.includes('>Approve Invoice</button>'), 'Materials PO invoice button must have clean text');
  assert(materials.includes('>Image</button>'), 'Materials PO image export button must have clean text');

  for (const requiredPath of [
    'supplierEvents',
    'supplierRollups',
    'globalNotificationEvents',
    'auditLogs',
    'supplierAuditLogs',
    'projects',
    'users'
  ]) {
    assert(Object.prototype.hasOwnProperty.call(rules.rules, requiredPath), `rules missing ${requiredPath}`);
  }
  assert(rules.rules.projects.$pid.auditLogs, 'rules missing project fallback audit path');
  assert(JSON.stringify(rules.rules.projects.$pid.auditLogs).includes('.indexOn'), 'project fallback audit path must be indexed');
  assert(JSON.stringify(rules.rules.supplierAuditLogs).includes('.indexOn'), 'supplier fallback audit path must be indexed');

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'v133 cache/style and script references',
      'login shell uses current auth/routing scripts',
      'service worker update/reload path',
      'auth logout detaches project and module listeners',
      'RC1 active role validation',
      'explicit RC1 role gate',
      'field roles excluded from active access patterns',
      'Team Admin active role options',
      'Admin panel navigation remains clickable in read-only projects',
      'Invalid Unicode escape labels are absent from app modules',
      'Materials PO buttons use clean labels',
      'Audit fallback rows readable in Admin Audit Log code path',
      'required Firebase root paths'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
}
