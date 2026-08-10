const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(content, needle, message) {
  assert(content.includes(needle), message || `Missing ${needle}`);
}

function main() {
  const workspace = read('workspace.html');
  const main = read('main.js');
  const changeorders = read('changeorders.js');
  const sitelog = read('sitelog.js');
  const materials = read('materials.js');
  const labor = read('labor.js');

  assertIncludes(workspace, 'id="tab_changeorders"', 'Change Orders tab must exist');
  assertIncludes(workspace, 'onclick="switchTab(\'changeorders\')"', 'Change Orders tab must call switchTab');
  assertIncludes(workspace, 'data-role-visible="apm,pm,boss,owner,admin"', 'Change Orders tab must be visible to RC1 management roles');
  assertIncludes(workspace, 'id="changeordersPanel"', 'Change Orders panel must exist');
  for (const id of ['coDesc', 'coReqBy', 'coDate', 'coNotes', 'coLaborImpact', 'coMaterialsImpact', 'coList']) {
    assertIncludes(workspace, `id="${id}"`, `Change Orders UI missing ${id}`);
  }
  assertIncludes(workspace, 'onclick="addChangeOrder()"', 'Change Orders submit button must call addChangeOrder');
  assertIncludes(workspace, 'onclick="filterCOs(\'pending\')"', 'Change Orders pending filter must exist');
  assertIncludes(workspace, 'onclick="filterCOs(\'approved\')"', 'Change Orders approved filter must exist');
  assertIncludes(workspace, 'onclick="filterCOs(\'rejected\')"', 'Change Orders rejected filter must exist');
  assertIncludes(workspace, 'onclick="exportCOsCSV()"', 'Change Orders export action must exist');

  assertIncludes(changeorders, 'function addChangeOrder()', 'addChangeOrder UI handler must exist');
  assertIncludes(changeorders, "approveRejectCO('${co.id}','approved')", 'Rendered pending CO cards must expose approve action');
  assertIncludes(changeorders, "approveRejectCO('${co.id}','rejected')", 'Rendered pending CO cards must expose reject action');
  assertIncludes(changeorders, "approveRejectCO('${co.id}','pending')", 'Rendered approved/rejected CO cards must expose revert action');
  assertIncludes(changeorders, "deleteCO('${co.id}','${status}')", 'Rendered active CO cards must expose void action');
  assertIncludes(changeorders, 'Void this change order?', 'CO destructive UI must be void, not delete');
  assertIncludes(changeorders, 'voidChangeOrder(_copid, key, reason.trim())', 'CO void UI must call voidChangeOrder');

  assertIncludes(workspace, 'id="tab_sitelog"', 'Site Log tab must exist');
  assertIncludes(workspace, 'onclick="switchTab(\'sitelog\')"', 'Site Log tab must call switchTab');
  assertIncludes(workspace, 'id="sitelogPanel"', 'Site Log panel must exist');
  for (const id of [
    'siteLogSummary',
    'logFilterInput',
    'logDate',
    'logNotes',
    'logWork',
    'logManpower',
    'logEquipment',
    'logVisitors',
    'logIssues',
    'logDelays',
    'logSafety',
    'logSafetyIncidents',
    'logWeather',
    'logPhotos',
    'siteLogList'
  ]) {
    assertIncludes(workspace, `id="${id}"`, `Site Log UI missing ${id}`);
  }
  assertIncludes(workspace, 'onclick="saveLog()"', 'Site Log save action must exist');
  assertIncludes(workspace, 'onclick="exportSiteLogs()"', 'Site Log export action must exist');

  assertIncludes(sitelog, 'async function saveLog()', 'saveLog UI handler must exist');
  assertIncludes(sitelog, "setFieldError($('logDate'), 'Select a date.')", 'saveLog must validate date');
  assertIncludes(sitelog, 'Write notes or work accomplished first.', 'saveLog must require notes or work accomplished');
  assertIncludes(sitelog, 'Log date cannot be in the future.', 'saveLog must reject future dates');
  assertIncludes(sitelog, 'createSiteLog(_slpid, data)', 'saveLog must call createSiteLog helper');
  assertIncludes(sitelog, 'async function deleteLog(key)', 'Site Log void UI handler must exist');
  assertIncludes(sitelog, 'Void this log entry?', 'Site Log destructive UI must be void, not delete');
  assertIncludes(sitelog, 'voidSiteLog(_slpid, key, reason.trim())', 'Site Log void UI must call voidSiteLog');
  assertIncludes(sitelog, 'async function exportSiteLogs()', 'Site Log export handler must exist');

  // Materials — PO RFP (Request for Payment) export wiring
  assertIncludes(materials, 'data-action="rfp"', 'PO cards must expose an RFP action');
  assertIncludes(materials, "else if (action === 'rfp') generatePORFP(poId)", 'PO card RFP action must call generatePORFP');
  assertIncludes(materials, 'async function generatePORFP(poId)', 'generatePORFP UI handler must exist');
  assertIncludes(materials, 'REQUEST FOR PAYMENT (RFP) - PURCHASE ORDER', 'PO RFP text must carry the RFP header');
  assertIncludes(materials, 'TOTAL AMOUNT:', 'PO RFP text must include the total amount');
  assertIncludes(materials, 'window.generatePORFP = generatePORFP', 'generatePORFP must be exported');
  assertIncludes(labor, "if (data.source === 'po') { downloadPORFP(doc, data); return; }", 'downloadRFP must route PO RFPs to downloadPORFP');
  assertIncludes(labor, 'function downloadPORFP(doc, data)', 'downloadPORFP PDF helper must exist');

  assertIncludes(main, "'changeorders'", 'Workspace switcher must include Change Orders');
  assertIncludes(main, "'sitelog'", 'Workspace switcher must include Site Log');

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'Change Orders tab/panel/form/actions are wired in current workspace shell',
      'Change Orders visible approve/reject/revert/void actions call workflow helpers',
      'Site Log tab/panel/form/save/export actions are wired in current workspace shell',
      'Site Log visible save/void/export actions call workflow helpers',
      'Materials PO cards expose an RFP action wired to generatePORFP (copy text + PDF)',
      'downloadRFP routes PO RFPs to the downloadPORFP PDF helper',
      'Workspace switcher includes Change Orders and Site Log modules'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
}
