const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function functionBody(source, name) {
  const patterns = [`async function ${name}(`, `function ${name}(`];
  const start = patterns.map(p => source.indexOf(p)).filter(i => i >= 0).sort((a, b) => a - b)[0];
  assert(start >= 0, `Missing ${name}()`);
  const signatureEnd = source.indexOf(') {', start);
  assert(signatureEnd >= 0, `Could not find ${name}() signature end`);
  const brace = signatureEnd + 2;
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, i);
    }
  }
  throw new Error(`Could not parse ${name}() body`);
}

function assertNoHardDelete(body, label) {
  assert(!/\.remove\s*\(/.test(body), `${label} must not call .remove()`);
  assert(!/set\s*\(\s*null\s*\)/.test(body), `${label} must not call set(null)`);
  assert(!/\]\s*=\s*null\s*;/.test(body), `${label} must not null-delete Firebase paths`);
}

function main() {
  const labor = read('labor.js');
  const materials = read('materials.js');
  const mainJs = read('main.js');
  const billing = read('billing.js');
  const changeorders = read('changeorders.js');
  const sitelog = read('sitelog.js');
  const suppliers = read('suppliers.js');
  const equipment = read('equipment.js');
  const compliance = read('compliance.js');
  const defects = read('defects.js');
  const tasks = read('tasks.js');
  const loadedSources = { labor, materials, mainJs, billing, changeorders, sitelog, suppliers, equipment, compliance, defects, tasks };

  for (const [label, source] of Object.entries(loadedSources)) {
    assert(!/permanent deletion|cannot be undone|Type DELETE/i.test(source), `${label} must not present permanent-delete wording`);
  }

  const removeWorker = functionBody(labor, 'removeWorker');
  assertNoHardDelete(removeWorker, 'Labor removeWorker');
  assert(removeWorker.includes("active: false"), 'Labor removeWorker must mark workers inactive');
  assert(removeWorker.includes("status: 'inactive'"), 'Labor removeWorker must preserve inactive status');
  assert(removeWorker.includes('statusHistory/${statusKey}'), 'Labor removeWorker must append status history');
  assert(removeWorker.includes("auditLog('archive', 'worker'"), 'Labor removeWorker must audit as archive');
  assert(labor.includes('function workerIsActive(worker)'), 'Labor must have active-worker helper');
  assert(labor.includes('function workerHasAttendanceForDays'), 'Labor must keep inactive workers with selected-week attendance visible for payroll');
  assert(/function buildGrid\([\s\S]*workerIsActive\(w\)[\s\S]*workerHasAttendanceForDays/.test(labor), 'Labor buildGrid must include inactive workers with selected-week attendance');

  const deleteTrade = functionBody(labor, 'deleteTrade');
  assertNoHardDelete(deleteTrade, 'Labor deleteTrade');
  assert(deleteTrade.includes("status: 'archived'"), 'Labor deleteTrade must archive trade settings');
  assert(deleteTrade.includes('archivedAt'), 'Labor deleteTrade must preserve archived timestamp');
  assert(deleteTrade.includes("auditLog('archive', 'trade'"), 'Labor deleteTrade must audit as archive');

  const deleteLedgerItem = functionBody(materials, 'deleteLedgerItem');
  assertNoHardDelete(deleteLedgerItem, 'Materials deleteLedgerItem');
  assert(deleteLedgerItem.includes("status: 'cancelled'"), 'Materials deleteLedgerItem must cancel ledger rows');
  assert(deleteLedgerItem.includes('cancelledAt'), 'Materials deleteLedgerItem must preserve cancellation timestamp');
  assert(deleteLedgerItem.includes("auditLog('void', 'ledger'"), 'Materials deleteLedgerItem must audit as void');

  assert(functionBody(mainJs, 'deleteProject').includes('return archiveProject(pid)'), 'Project delete action must route to archiveProject');
  assert(functionBody(mainJs, 'archiveProject').includes("status: 'archived'"), 'Project archive must preserve archived status');
  assert(functionBody(mainJs, 'restoreProject').includes('status: restoreStatus'), 'Project restore must reactivate archived/completed projects');

  for (const [source, deleteName, statusNeedle, label] of [
    [billing, 'deleteBilling', "status: 'voided'", 'Billing deleteBilling'],
    [billing, 'deleteCollection', "status: 'voided'", 'Billing deleteCollection'],
    [changeorders, 'deleteCO', 'voidChangeOrder', 'Change Orders deleteCO'],
    [sitelog, 'deleteLog', 'voidSiteLog', 'Site Logs deleteLog'],
    [suppliers, 'deleteSupplier', 'archiveSupplier', 'Suppliers deleteSupplier'],
    [equipment, 'deleteEquipment', "status: 'archived'", 'Equipment deleteEquipment'],
    [compliance, 'deleteCompliance', "status: 'archived'", 'Compliance deleteCompliance'],
    [defects, 'deleteDefect', "status: 'voided'", 'Defects deleteDefect'],
    [tasks, 'deleteTask', "status: 'archived'", 'Tasks deleteTask']
  ]) {
    const body = functionBody(source, deleteName);
    assertNoHardDelete(body, label);
    assert(body.includes(statusNeedle), `${label} must preserve history through ${statusNeedle}`);
  }

  assert(/function watchEquipment\([\s\S]*item\.status !== 'archived'/.test(equipment), 'Equipment active list must hide archived records');
  assert(/function watchEquipSummary\([\s\S]*item\.status === 'archived'/.test(equipment), 'Equipment summary must ignore archived records');
  assert(/function watchCompliance\([\s\S]*item\.status !== 'archived'/.test(compliance), 'Compliance active list must hide archived records');
  assert(/function scanComplianceAcrossProjects\([\s\S]*item\.status === 'archived'/.test(compliance), 'Compliance alerts must ignore archived records');
  assert(/function watchDefects\([\s\S]*item\.status !== 'voided'/.test(defects), 'Defects active list must hide voided records');
  assert(/function watchTasks\([\s\S]*task\.status !== 'archived'/.test(tasks), 'Tasks board must hide archived records');
  assert(/function watchTaskSummary\([\s\S]*t\.status === 'archived'/.test(tasks), 'Task summary must ignore archived records');

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'Labor worker removal is inactive/history-preserving',
      'Labor trade removal archives trade settings',
      'Materials legacy ledger deletion cancels instead of removing',
      'Project lifecycle delete routes to archive/restore',
      'Billing, Change Orders, Site Logs, and Suppliers use void/archive flows',
      'Equipment, Compliance, Defects, and Tasks use archive/void flows'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
}
