const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const requiredDocs = [
  'LABOR_SCHEMA.md',
  'QA_LABOR.md',
  'MATERIALS_SCHEMA.md',
  'QA_MATERIALS.md',
  'BILLING_SCHEMA.md',
  'QA_BILLING.md',
  'QA_BILLING_PHASE2.md',
  'CHANGEORDER_SCHEMA.md',
  'QA_CHANGEORDER.md',
  'SITELOG_SCHEMA.md',
  'QA_SITELOG.md',
  'SUPPLIERS_SCHEMA.md',
  'QA_SUPPLIERS.md',
  'REPORTS_SCHEMA.md',
  'QA_REPORTS.md',
  'ROLES_SCHEMA.md',
  'QA_ROLES.md',
  'AUDIT_SCHEMA.md',
  'QA_AUDIT.md',
  'NOTIFICATION_EVENTS.md',
  'QA_NOTIFICATIONS.md',
  'DASHBOARD_INTEGRATION.md',
  'QA_DASHBOARD.md',
  'OPERATIONS.md',
  'RC1_READINESS.md',
  'RC1_POST_DEPLOY_QA.md'
];

const modulePairs = [
  ['Labor', 'LABOR_SCHEMA.md', 'QA_LABOR.md'],
  ['Materials', 'MATERIALS_SCHEMA.md', 'QA_MATERIALS.md'],
  ['Billing', 'BILLING_SCHEMA.md', 'QA_BILLING.md'],
  ['Billing Phase 2', 'BILLING_SCHEMA.md', 'QA_BILLING_PHASE2.md'],
  ['Change Orders', 'CHANGEORDER_SCHEMA.md', 'QA_CHANGEORDER.md'],
  ['Site Logs', 'SITELOG_SCHEMA.md', 'QA_SITELOG.md'],
  ['Suppliers', 'SUPPLIERS_SCHEMA.md', 'QA_SUPPLIERS.md'],
  ['Reports', 'REPORTS_SCHEMA.md', 'QA_REPORTS.md'],
  ['Roles', 'ROLES_SCHEMA.md', 'QA_ROLES.md'],
  ['Audit', 'AUDIT_SCHEMA.md', 'QA_AUDIT.md'],
  ['Notifications', 'NOTIFICATION_EVENTS.md', 'QA_NOTIFICATIONS.md'],
  ['Dashboard', 'DASHBOARD_INTEGRATION.md', 'QA_DASHBOARD.md']
];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(file, needle, label = needle) {
  const content = read(file);
  assert(content.includes(needle), `${file} must mention ${label}`);
}

function main() {
  for (const file of requiredDocs) {
    assert(exists(file), `Missing required RC1 document: ${file}`);
    assert(read(file).trim().length > 80, `${file} looks empty or incomplete`);
  }

  for (const [moduleName, schemaFile, qaFile] of modulePairs) {
    const schema = read(schemaFile);
    const qa = read(qaFile);
    assert(/Status:/i.test(schema) || /Workflow|Firebase|Schema/i.test(schema), `${schemaFile} must document ${moduleName} workflow/schema status`);
    assert(/Status:/i.test(qa), `${qaFile} must include a Status line`);
    assert(/Known Limitations/i.test(schema) || /Known Limitations/i.test(qa), `${moduleName} docs must include known limitations`);
    assert(/QA|Checklist|Result|PASS|WARNING|FAILED/i.test(qa), `${qaFile} must include QA evidence/checklist language`);
  }

  assertIncludes('RC1_READINESS.md', 'Status: RC1 READY', 'explicit RC1-ready status');
  assertIncludes('RC1_READINESS.md', 'Live Firebase RC1 gate: PASS', 'live Firebase RC1 gate result');
  assertIncludes('RC1_READINESS.md', 'cache v97', 'current PWA cache evidence');
  assertIncludes('RC1_READINESS.md', 'main.js?v=95', 'current main.js shell evidence');
  assertIncludes('RC1_READINESS.md', 'node scripts/rc1_final_readiness_gate.js', 'final readiness gate command');
  assertIncludes('RC1_READINESS.md', 'PASS_RC1_READY', 'current final readiness pass result');
  assertIncludes('RC1_READINESS.md', 'Change Orders browser click-through after cache v97', 'Change Orders visible reject modal pass evidence');
  assertIncludes('RC1_READINESS.md', 'RUN_REAL_QA=1 node scripts/rc1_post_deploy_gate.js', 'real backend RC1 gate command');
  assertIncludes('RC1_READINESS.md', 'Dedicated deployed-rule security gate: PASS', 'deployed PM/APM security gate pass evidence');
  assertIncludes('RC1_POST_DEPLOY_QA.md', 'LIVE FIREBASE GATE PASSED', 'post-deploy gate passed status');
  assertIncludes('RC1_POST_DEPLOY_QA.md', 'Real Firebase Gate', 'real Firebase gate instructions');
  assertIncludes('RC1_POST_DEPLOY_QA.md', 'read-only for repository configuration', 'read-only local gate behavior');
  assertIncludes('RC1_POST_DEPLOY_QA.md', 'PASS_WITH_REAL_QA_SKIPPED', 'local gate expected result');
  assertIncludes('RC1_POST_DEPLOY_QA.md', 'PASS', 'real gate expected result');
  assertIncludes('RC1_POST_DEPLOY_QA.md', 'PASS_RC1_READY', 'final readiness expected result');
  assertIncludes('QA_SITELOG.md', 'Browser smoke test after cache v96', 'Site Log browser smoke pass evidence');
  assertIncludes('OPERATIONS.md', 'Publishing Firebase Rules', 'Firebase rules publishing runbook');
  assertIncludes('OPERATIONS.md', 'node scripts/rc1_post_deploy_gate.js', 'RC1 gate command');
  assertIncludes('OPERATIONS.md', 'node scripts/rc1_final_readiness_gate.js', 'RC1 final readiness gate command');

  assertIncludes('QA_ROLES.md', 'Foreman/Safety/Viewer are disabled from active workspace/project access', 'field role deny evidence');
  assertIncludes('QA_ROLES.md', 'scripts/roles_live_account_qa.js', 'live role-account QA evidence');
  assertIncludes('ROLES_SCHEMA.md', 'Roadmap item: build a child-level Firebase read refactor', 'field-role future roadmap');
  assertIncludes('ROLES_SCHEMA.md', 'read-only live account verification', 'role-account gate schema evidence');
  assertIncludes('RC1_POST_DEPLOY_QA.md', 'scripts/roles_live_account_qa.js', 'post-deploy role-account gate command');
  assertIncludes('RC1_POST_DEPLOY_QA.md', 'scripts/rc1_final_readiness_gate.js', 'post-deploy final readiness gate command');
  assertIncludes('QA_AUDIT.md', 'supplierAuditLogs/{supplierId}', 'supplier audit fallback path');
  assertIncludes('QA_NOTIFICATIONS.md', 'globalNotificationEvents', 'global notification event path');
  assertIncludes('QA_SUPPLIERS.md', 'supplier-local fallback', 'supplier fallback evidence');
  assertIncludes('QA_DASHBOARD.md', 'Dashboard static QA', 'dashboard static QA evidence');
  assertIncludes('QA_CHANGEORDER.md', 'UI workflow static QA', 'Change Order UI workflow static QA evidence');
  assertIncludes('QA_CHANGEORDER.md', 'Browser click-through workflow QA, reject modal path after cache v97', 'Change Order reject modal browser QA evidence');
  assertIncludes('QA_SITELOG.md', 'UI workflow static QA', 'Site Log UI workflow static QA evidence');

  console.log(JSON.stringify({
    result: 'PASS',
    documentsChecked: requiredDocs.length,
    modulePairsChecked: modulePairs.length,
    checks: [
      'required schema and QA documents exist',
      'module docs include status/QA/known limitation evidence',
      'RC1 readiness is explicitly RC1-ready after final role/UI sign-off',
      'RC1 readiness includes live Firebase gate pass evidence',
      'RC1 readiness includes current v97/v95 shell evidence',
      'post-deploy real Firebase gate is documented',
      'local post-deploy gate is documented as read-only',
      'roles/audit/notification/supplier/dashboard RC1 evidence is documented',
      'Change Order reject modal browser evidence and Site Log UI workflow static evidence are documented'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
}
