const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assert(condition, label, details = {}) {
  if (!condition) {
    const err = new Error(label);
    err.details = details;
    throw err;
  }
}

function loadAuthHelpers() {
  const auth = read('auth.js');
  const helperEnd = auth.indexOf('function normaliseEmail');
  assert(helperEnd > 0, 'Could not isolate auth role helper block');
  const helperSource = auth.slice(0, helperEnd);
  const context = { console };
  vm.createContext(context);
  vm.runInContext(`${helperSource}
globalThis.__setCurrentUser = user => { _currentAuthUser = user; };
globalThis.__helpers = {
  normalizeRole,
  isBoss,
  isRc1ActiveRole,
  canSeeFinancials,
  canEditAssignedProject,
  canReadFullAssignedProject,
  isFieldRole,
  isViewerRole,
  roleLabel,
  elementAllowsRole
};`, context);
  return context.__helpers;
}

function extractDataRoleVisibleValues(html, relPath) {
  const values = [];
  const pattern = /data-role-visible\s*=\s*"([^"]*)"/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    values.push({ relPath, value: match[1], index: match.index });
  }
  return values;
}

function verifyActualUiAndRules() {
  const activeRoles = ['boss', 'owner', 'admin', 'pm', 'apm'];
  const deferredRoles = ['foreman', 'safety', 'viewer'];
  const allowedVisibilityTokens = new Set([...activeRoles, 'financial', 'none', 'all']);
  const htmlFiles = ['workspace.html', 'dashboard.html', 'index.html'];

  htmlFiles.flatMap(relPath => extractDataRoleVisibleValues(read(relPath), relPath)).forEach(entry => {
    const tokens = entry.value.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
    tokens.forEach(token => {
      assert(allowedVisibilityTokens.has(token), `Unsupported UI role visibility token: ${token}`, entry);
      assert(!deferredRoles.includes(token), `Deferred role exposed in active UI visibility: ${token}`, entry);
    });
  });

  const reportJs = read('report.js');
  const optionsStart = reportJs.indexOf('function teamRoleOptions');
  const optionsEnd = reportJs.indexOf('function teamStatusBadge');
  assert(optionsStart > -1 && optionsEnd > optionsStart, 'Could not isolate Team Admin role options');
  const teamOptionsSource = reportJs.slice(optionsStart, optionsEnd);
  activeRoles.filter(role => role !== 'owner').forEach(role => {
    assert(teamOptionsSource.includes(`['${role}'`), `Team Admin is missing RC1 active role option: ${role}`);
  });
  deferredRoles.forEach(role => {
    assert(!teamOptionsSource.includes(`['${role}'`), `Team Admin exposes deferred role option: ${role}`);
    assert(!teamOptionsSource.includes(`value="${role}"`), `Team Admin renders deferred role option value: ${role}`);
  });

  const authJs = read('auth.js');
  assert(authJs.includes("const RC1_ACTIVE_ROLES = new Set(['boss', 'owner', 'admin', 'pm', 'apm']);"), 'RC1 active role set changed unexpectedly');
  assert(authJs.includes('!isRc1ActiveRole(profile?.role)'), 'Auth startup must block non-RC1 roles before app initialization');

  const rules = read('database.rules.json');
  assert(rules.includes("newData.child('role').val().matches(/^(boss|owner|admin|pm|apm)$/)"), 'User role validation must be limited to RC1 active roles');
  const roleMatchExpressions = [...rules.matchAll(/matches\(\/\^\(([^)]*)\)\$\/\)/g)]
    .map(match => match[1].split('|').map(v => v.trim().toLowerCase()).filter(Boolean));
  assert(roleMatchExpressions.length > 0, 'No Firebase role match expressions found');
  deferredRoles.forEach(role => {
    roleMatchExpressions.forEach(tokens => {
      assert(!tokens.includes(role), `Firebase role rule exposes deferred role token: ${role}`, { tokens });
    });
  });
}

function main() {
  const h = loadAuthHelpers();
  const activeRoles = ['boss', 'owner', 'admin', 'pm', 'apm'];
  const deferredRoles = ['foreman', 'safety', 'viewer'];
  const inactiveRoles = [...deferredRoles, '', 'unknown', 'contractor', null, undefined];

  activeRoles.forEach(role => {
    assert(h.isRc1ActiveRole(role) === true, `${role} must be active for RC1`);
  });
  inactiveRoles.forEach(role => {
    assert(h.isRc1ActiveRole(role) === false, `${String(role)} must not be active for RC1`);
  });

  ['boss', 'owner', 'admin'].forEach(role => {
    assert(h.isBoss(role) === true, `${role} must have admin capability`);
    assert(h.canSeeFinancials(role) === true, `${role} must see financials`);
    assert(h.canEditAssignedProject(role) === true, `${role} must edit assigned projects`);
    assert(h.canReadFullAssignedProject(role) === true, `${role} must read full assigned projects`);
  });

  assert(h.isBoss('pm') === false, 'PM must not be admin');
  assert(h.canSeeFinancials('pm') === true, 'PM must see financials in RC1');
  assert(h.canEditAssignedProject('pm') === true, 'PM must edit assigned projects');
  assert(h.canReadFullAssignedProject('pm') === true, 'PM must read assigned full projects');

  assert(h.isBoss('apm') === false, 'APM must not be admin');
  assert(h.canSeeFinancials('apm') === false, 'APM must not see full financials by default');
  assert(h.canEditAssignedProject('apm') === true, 'APM must edit assigned projects');
  assert(h.canReadFullAssignedProject('apm') === true, 'APM must read assigned full projects');

  ['foreman', 'safety'].forEach(role => {
    assert(h.isFieldRole(role) === true, `${role} must remain documented as field role`);
    assert(h.isViewerRole(role) === false, `${role} must not be viewer`);
    assert(h.canSeeFinancials(role) === false, `${role} must not see financials`);
    assert(h.canEditAssignedProject(role) === false, `${role} must not edit assigned projects`);
    assert(h.canReadFullAssignedProject(role) === false, `${role} must not read full projects`);
  });

  assert(h.isFieldRole('viewer') === false, 'Viewer must not be field-write capable');
  assert(h.isViewerRole('viewer') === true, 'Viewer must remain documented as viewer');
  assert(h.canSeeFinancials('viewer') === false, 'Viewer must not see financials');
  assert(h.canEditAssignedProject('viewer') === false, 'Viewer must not edit projects');
  assert(h.canReadFullAssignedProject('viewer') === false, 'Viewer must not read full projects');

  const financialEl = { dataset: { roleVisible: 'financial' } };
  const bossEl = { dataset: { roleVisible: 'boss' } };
  const managementEl = { dataset: { roleVisible: 'boss,owner,admin,pm,apm' } };
  assert(h.elementAllowsRole(financialEl, 'pm') === true, 'PM must see financial UI');
  assert(h.elementAllowsRole(financialEl, 'apm') === false, 'APM must not see financial-only UI');
  assert(h.elementAllowsRole(financialEl, 'foreman') === false, 'Foreman must not see financial UI');
  assert(h.elementAllowsRole(bossEl, 'admin') === true, 'Admin must see boss/admin UI');
  assert(h.elementAllowsRole(bossEl, 'pm') === false, 'PM must not see admin-only UI');
  deferredRoles.forEach(role => {
    assert(h.elementAllowsRole(managementEl, role) === false, `${role} must be hidden from management workspace UI`);
  });

  verifyActualUiAndRules();

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'RC1 active role matrix',
      'deferred field/viewer roles inactive',
      'financial visibility matrix',
      'assigned-project capability matrix',
      'role-based UI visibility helpers',
      'actual workspace/dashboard role visibility attributes',
      'Team Admin active role option lock',
      'Firebase rules deferred-role token exclusion'
    ]
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
