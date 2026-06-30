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
  const sw = read('sw.js');
  const htmlFiles = ['index.html', 'dashboard.html', 'workspace.html'];
  const html = Object.fromEntries(htmlFiles.map(file => [file, read(file)]));

  assert(/const CACHE_NAME = 'acpm-v82'/.test(sw), 'service worker cache must be acpm-v82');
  for (const [file, content] of Object.entries(html)) {
    assert(extractScriptVersion(content, 'utils.js') === '81', `${file} must load utils.js?v=81`);
    assert(extractScriptVersion(content, 'suppliers.js') === '81', `${file} must load suppliers.js?v=81`);
    assert(extractScriptVersion(content, 'labor.js') === '80', `${file} must load labor.js?v=80`);
    assert(extractScriptVersion(content, 'notifications.js') === '79', `${file} must load notifications.js?v=79`);
    assert(extractScriptVersion(content, 'report.js') === '82', `${file} must load report.js?v=82`);
  }
  assert(sw.includes('./utils.js?v=81'), 'service worker must cache utils.js?v=81');
  assert(sw.includes('./suppliers.js?v=81'), 'service worker must cache suppliers.js?v=81');
  assert(sw.includes('./report.js?v=82'), 'service worker must cache report.js?v=82');

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
  assert(/function detachReportsListeners\(\)[\s\S]*_teamAdminListener\.off\(\)[\s\S]*_auditListener\.off\(\)[\s\S]*_lifecycleRequestListener\.off\(\)/.test(report), 'detachReportsListeners must detach report, team, audit, and lifecycle listeners');

  for (const requiredPath of [
    'supplierEvents',
    'supplierRollups',
    'globalNotificationEvents',
    'auditLogs',
    'projects',
    'users'
  ]) {
    assert(Object.prototype.hasOwnProperty.call(rules.rules, requiredPath), `rules missing ${requiredPath}`);
  }

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'v82 cache/script references',
      'RC1 active role validation',
      'field roles excluded from active access patterns',
      'Team Admin active role options',
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
