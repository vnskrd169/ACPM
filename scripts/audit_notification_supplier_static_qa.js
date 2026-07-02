const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getRulePath(rules, parts) {
  let cursor = rules;
  for (const part of parts) {
    cursor = cursor && cursor[part];
  }
  return cursor;
}

function assertRulePath(rules, parts) {
  const node = getRulePath(rules, parts);
  assert(node, `Missing Firebase rule path: ${parts.join('/')}`);
  return node;
}

function main() {
  const utils = read('utils.js');
  const report = read('report.js');
  const notifications = read('notifications.js');
  const suppliers = read('suppliers.js');
  const rules = JSON.parse(read('database.rules.json')).rules;

  assert(utils.includes('function auditLog(action, entityType, entityId, details = {})'), 'utils.js must expose auditLog helper');
  assert(utils.includes("firebase.database().ref('auditLogs').push(logEntry"), 'auditLog must attempt global auditLogs writes first');
  assert(utils.includes('persistAuditFallback(logEntry)'), 'auditLog must call fallback when global write is denied');
  assert(utils.includes('function persistAuditFallback(logEntry)'), 'persistAuditFallback helper must exist');
  assert(utils.includes('projects/${projectId}/auditLogs'), 'project audit fallback must write projects/{projectId}/auditLogs');
  assert(utils.includes('supplierAuditLogs/${logEntry.entityId}'), 'supplier audit fallback must write root supplierAuditLogs/{supplierId}');
  assert(utils.includes('globalPathDenied: true'), 'audit fallback rows must mark globalPathDenied');
  assert(utils.includes('fallbackPath: true'), 'audit fallback rows must mark fallbackPath');
  assert(!utils.includes('suppliers/${logEntry.entityId}/auditLogs'), 'supplier audit fallback must not write under public suppliers/{supplierId}/auditLogs');

  assert(report.includes('function collectProjectFallbackAuditRows(snap)'), 'report.js must collect project fallback audit rows');
  assert(report.includes('function collectSupplierFallbackAuditRows(snap)'), 'report.js must collect supplier fallback audit rows');
  assert(report.includes('sourcePath: `projects/${projectId}/auditLogs/${id}`'), 'report.js must preserve project fallback audit source path');
  assert(report.includes('sourcePath: `supplierAuditLogs/${supplierId}/${id}`'), 'report.js must preserve supplier fallback audit source path');
  assert(report.includes('Local fallback audit path'), 'report.js must label fallback audit rows');
  assert(report.includes("firebase.database().ref('auditLogs')"), 'report.js must read canonical global auditLogs');
  assert(report.includes("firebase.database().ref('supplierAuditLogs')"), 'report.js must read supplierAuditLogs fallback root');
  assert(report.includes('_auditFallbackListeners = [projectAuditRef, supplierAuditRef]'), 'audit fallback listeners must be tracked for cleanup');
  assert(report.includes('function detachAuditFallbackListeners()'), 'audit fallback listener cleanup helper must exist');

  assert(notifications.includes('function createNotificationEvent({ projectId = \'\', module = \'general\', type, payload = {}, global = false })'), 'createNotificationEvent helper must exist');
  assert(notifications.includes("'globalNotificationEvents'"), 'createNotificationEvent must support globalNotificationEvents');
  assert(notifications.includes('`projects/${projectId}/notificationEvents`'), 'createNotificationEvent must support project notificationEvents');
  assert(notifications.includes('window.createNotificationEvent = createNotificationEvent'), 'createNotificationEvent must be exported');

  assert(suppliers.includes("firebase.database().ref('supplierEvents').push()"), 'suppliers must write canonical supplierEvents');
  assert(suppliers.includes('suppliers/${event.supplierId}/events/${ref.key}'), 'suppliers must preserve local event fallback');
  assert(suppliers.includes("firebase.database().ref('globalNotificationEvents').push()"), 'suppliers must write canonical globalNotificationEvents');
  assert(suppliers.includes('suppliers/${payload.supplierId}/notificationEvents/${ref.key}'), 'suppliers must preserve local notification fallback');
  assert(suppliers.includes('supplierRollups/${supplierId}'), 'suppliers must write canonical supplierRollups');
  assert(suppliers.includes('suppliers/${supplierId}/rollup'), 'suppliers must preserve local rollup fallback');
  assert(!suppliers.includes('/auditLogs'), 'suppliers.js must not create supplier audit subpaths directly');

  const projectAuditRules = assertRulePath(rules, ['projects', '$pid', 'auditLogs']);
  const projectNotificationRules = assertRulePath(rules, ['projects', '$pid', 'notificationEvents']);
  const supplierRules = assertRulePath(rules, ['suppliers']);
  const supplierEventsRules = assertRulePath(rules, ['supplierEvents']);
  const supplierRollupsRules = assertRulePath(rules, ['supplierRollups']);
  const globalNotificationRules = assertRulePath(rules, ['globalNotificationEvents']);
  const globalAuditRules = assertRulePath(rules, ['auditLogs']);
  const supplierAuditRules = assertRulePath(rules, ['supplierAuditLogs']);

  assert(JSON.stringify(projectAuditRules).includes('boss|owner|admin') && JSON.stringify(projectAuditRules).includes('pm|apm'), 'project audit rules must allow RC1 admin and assigned PM/APM access');
  assert(JSON.stringify(projectNotificationRules).includes('boss|owner|admin|pm|apm'), 'project notification events must be limited to active RC1 roles');
  assert(JSON.stringify(supplierRules).includes('boss|owner|admin'), 'supplier writes must be admin-only for RC1');
  assert(JSON.stringify(supplierEventsRules).includes('boss|owner|admin'), 'supplier events must be admin-only for RC1');
  assert(JSON.stringify(supplierRollupsRules).includes('boss|owner|admin'), 'supplier rollups writes must be admin-only for RC1');
  assert(JSON.stringify(globalNotificationRules).includes('boss|owner|admin'), 'global notification events must be admin-only for RC1');
  assert(JSON.stringify(globalAuditRules).includes('boss|owner|admin'), 'global audit logs must be admin-readable for RC1');
  assert(JSON.stringify(supplierAuditRules).includes('boss|owner|admin'), 'supplier audit logs must be admin-readable for RC1');

  const rulesText = JSON.stringify(rules);
  assert(!/matches\([^)]*(foreman|safety|viewer)/i.test(rulesText), 'Firebase role rules must not grant Foreman/Safety/Viewer access in RC1');

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'global audit with project and supplier fallback paths',
      'admin audit screen reads canonical and fallback paths',
      'notification event helper uses project/global event paths',
      'supplier events, notification events, and rollups preserve canonical plus fallback paths',
      'Firebase rules include required audit/notification/supplier paths',
      'RC1 rules do not grant Foreman/Safety/Viewer access'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
}
