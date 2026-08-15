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
  const billing = read('billing.js');

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
  assertIncludes(workspace, 'id="logPhotoFiles"', 'Site Log photo file input must exist');
  assertIncludes(workspace, 'onchange="onLogPhotoSelected(this)"', 'Site Log photo picker must call onLogPhotoSelected');
  assertIncludes(workspace, 'id="logPhotoPreview"', 'Site Log photo preview container must exist');

  assertIncludes(sitelog, 'async function saveLog()', 'saveLog UI handler must exist');
  assertIncludes(sitelog, "setFieldError($('logDate'), 'Select a date.')", 'saveLog must validate date');
  assertIncludes(sitelog, 'Write notes or work accomplished first.', 'saveLog must require notes or work accomplished');
  assertIncludes(sitelog, 'Log date cannot be in the future.', 'saveLog must reject future dates');
  assertIncludes(sitelog, 'createSiteLog(_slpid, saveData)', 'saveLog must call createSiteLog helper');
  assertIncludes(sitelog, 'async function deleteLog(key)', 'Site Log void UI handler must exist');
  assertIncludes(sitelog, 'Void this log entry?', 'Site Log destructive UI must be void, not delete');
  assertIncludes(sitelog, 'voidSiteLog(_slpid, key, reason.trim())', 'Site Log void UI must call voidSiteLog');
  assertIncludes(sitelog, 'async function exportSiteLogs()', 'Site Log export handler must exist');
  assertIncludes(sitelog, 'async function uploadSiteLogPhoto(pid, logId, file, index = 0)', 'Site Log photo upload helper must exist');
  assertIncludes(sitelog, 'SITE_LOG_DRIVE_UPLOAD_URL', 'Site Log photo uploads must use the Google Drive Apps Script transport');
  assertIncludes(sitelog, 'script.google.com/macros/s/', 'Site Log Drive upload URL must be a Google Apps Script endpoint');
  assertIncludes(sitelog, 'photoBase64', 'Site Log photos must be base64-encoded for the Drive endpoint');
  assertIncludes(sitelog, 'async function compressSiteLogImage(file', 'Site Log photos must be compressed before upload');
  assertIncludes(sitelog, 'function onLogPhotoSelected(input)', 'Site Log photo selection handler must exist');
  assertIncludes(sitelog, 'window.addSiteLogMedia = addSiteLogMedia', 'addSiteLogMedia must be exported');
  assertIncludes(sitelog, 'window.uploadSiteLogPhoto = uploadSiteLogPhoto', 'uploadSiteLogPhoto must be exported');
  assertIncludes(sitelog, 'window.siteLogDriveAvailable = siteLogDriveAvailable', 'siteLogDriveAvailable must be exported');

  // Materials — PO RFP (Request for Payment) export wiring
  assertIncludes(materials, 'data-action="rfp"', 'PO cards must expose an RFP action');
  assertIncludes(materials, "else if (action === 'rfp') generatePORFP(poId)", 'PO card RFP action must call generatePORFP');
  assertIncludes(materials, 'async function generatePORFP(poId)', 'generatePORFP UI handler must exist');
  assertIncludes(materials, 'REQUEST FOR PAYMENT (RFP) - PURCHASE ORDER', 'PO RFP text must carry the RFP header');
  assertIncludes(materials, 'TOTAL AMOUNT:', 'PO RFP text must include the total amount');
  assertIncludes(materials, 'window.generatePORFP = generatePORFP', 'generatePORFP must be exported');
  assertIncludes(materials, 'data-action="inv-rfp"', 'PO cards with a supplier invoice must expose an Invoice RFP action');
  assertIncludes(materials, "else if (action === 'inv-rfp') generateInvoiceRFP(poId)", 'Invoice RFP action must call generateInvoiceRFP');
  assertIncludes(materials, 'async function generateInvoiceRFP(poId)', 'generateInvoiceRFP UI handler must exist');
  assertIncludes(materials, 'REQUEST FOR PAYMENT (RFP) - SUPPLIER INVOICE', 'Supplier invoice RFP text must carry the invoice header');
  assertIncludes(materials, 'INVOICE AMOUNT:', 'Supplier invoice RFP text must include the invoice amount');
  assertIncludes(materials, 'window.generateInvoiceRFP = generateInvoiceRFP', 'generateInvoiceRFP must be exported');
  assertIncludes(labor, "if (data.source === 'po') { downloadPORFP(doc, data); return; }", 'downloadRFP must route PO RFPs to downloadPORFP');
  assertIncludes(labor, 'function downloadPORFP(doc, data)', 'downloadPORFP PDF helper must exist');
  assertIncludes(labor, "if (data.source === 'invoice') { downloadInvoiceRFP(doc, data); return; }", 'downloadRFP must route invoice RFPs to downloadInvoiceRFP');
  assertIncludes(labor, 'function downloadInvoiceRFP(doc, data)', 'downloadInvoiceRFP PDF helper must exist');

  // Billing — client billing RFP (Request for Payment) export wiring
  assertIncludes(billing, 'data-action="rfp"', 'Billing rows must expose an RFP action');
  assertIncludes(billing, "if (action === 'rfp') generateBillingRFP(id)", 'Billing row RFP action must call generateBillingRFP');
  assertIncludes(billing, 'async function generateBillingRFP(billingId)', 'generateBillingRFP UI handler must exist');
  assertIncludes(billing, 'REQUEST FOR PAYMENT (RFP) - CLIENT BILLING', 'Client billing RFP text must carry the billing header');
  assertIncludes(billing, 'NET BILLABLE', 'Client billing RFP text must include the net billable');
  assertIncludes(billing, 'Receivable Balance', 'Client billing RFP text must include the receivable balance');
  assertIncludes(billing, 'window.generateBillingRFP = generateBillingRFP', 'generateBillingRFP must be exported');
  assertIncludes(labor, "if (data.source === 'billing') { downloadBillingRFP(doc, data); return; }", 'downloadRFP must route billing RFPs to downloadBillingRFP');
  assertIncludes(labor, 'function downloadBillingRFP(doc, data)', 'downloadBillingRFP PDF helper must exist');

  assertIncludes(main, "'changeorders'", 'Workspace switcher must include Change Orders');
  assertIncludes(main, "'sitelog'", 'Workspace switcher must include Site Log');

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'Change Orders tab/panel/form/actions are wired in current workspace shell',
      'Change Orders visible approve/reject/revert/void actions call workflow helpers',
      'Site Log tab/panel/form/save/export actions are wired in current workspace shell',
      'Site Log photo picker, preview, compression, and Google Drive upload are wired in the current workspace shell',
      'Site Log visible save/void/export actions call workflow helpers',
      'Materials PO cards expose an RFP action wired to generatePORFP (copy text + PDF)',
      'Materials PO cards with a supplier invoice expose an Invoice RFP wired to generateInvoiceRFP',
      'downloadRFP routes PO RFPs to downloadPORFP and invoice RFPs to downloadInvoiceRFP',
      'Billing rows expose an RFP wired to generateBillingRFP, routed to downloadBillingRFP (copy text + PDF)',
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
