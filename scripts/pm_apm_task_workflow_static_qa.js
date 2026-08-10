'use strict';

const fs = require('fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return '';
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

function run() {
  const auth = read('auth.js');
  const main = read('main.js');
  const tasks = read('tasks.js');
  const adapter = read('pmos-task-adapter.js');
  const pmos = read('pmos.js');
  const notifications = read('notifications.js');
  const report = read('report.js');
  const workspace = read('workspace.html');
  const dashboard = read('dashboard.html');
  const rules = read('database.rules.json');

  ['pending', 'in_progress', 'blocked', 'for_verification', 'completed', 'cancelled'].forEach(status => {
    assert(tasks.includes(status), `Office task workflow must include ${status}`);
    assert(adapter.includes(status), `PMOS task adapter must include ${status}`);
  });

  assert(tasks.includes("in_progress: ['blocked', 'for_verification', 'cancelled']"), 'Office task transitions must submit work for verification');
  assert(tasks.includes("for_verification: ['completed', 'in_progress', 'blocked', 'cancelled']"), 'Office task verification must support complete or return');
  assert(adapter.includes("in_progress:      ['blocked', 'for_verification', 'cancelled']"), 'PMOS adapter transitions must match Office');
  assert(adapter.includes("for_verification: ['completed', 'in_progress', 'blocked', 'cancelled']"), 'PMOS verification transitions must match Office');
  assert(tasks.includes('Submit the task for verification. A PM or Admin completes it.'), 'Office must block APM direct completion');
  assert(adapter.includes('PM verification is required before completion.'), 'PMOS must block APM direct completion');
  assert(!functionBody(adapter, 'updateCanonicalTask').includes("safeUpdates.status = 'completed'"), 'Generic PMOS task updates must not bypass verification');
  assert(functionBody(adapter, 'updateCanonicalTask').includes('Math.min(99'), 'Generic PMOS task progress must stop before completion');

  const watchBody = functionBody(tasks, 'watchTasks');
  const listenerCount = (watchBody.match(/taskListen\(ref, 'value', callback\)/g) || []).length;
  assert(listenerCount === 1, `Office task board must register exactly one tracked listener, found ${listenerCount}`);
  assert(functionBody(tasks, 'taskListen').includes('ref.on(eventName, callback)'), 'Tracked task listener helper must attach its exact callback');
  assert(tasks.includes('ref.off(eventName, callback)'), 'Office task listener must detach its exact callback');
  assert(adapter.includes("entry.ref.off('value', entry.callback)"), 'PMOS task listeners must detach exact callbacks');

  ['taskEvents', 'activity'].forEach(path => {
    assert(tasks.includes(path), `Office task workflow must write ${path}`);
    assert(adapter.includes(path), `PMOS task workflow must write ${path}`);
    assert(rules.includes(`"${path}"`), `Firebase rules must define ${path}`);
  });

  // Child-level transition state machine must live in database.rules.json so the
  // assigned-project write grant cannot bypass PM verification or lifecycle order.
  assert(rules.includes("newData.child('status').val() !== 'completed'"), 'Firebase rules must gate completed on a verifier role');
  assert(rules.includes("root.child('users/' + auth.uid + '/role').val().matches(/^(boss|owner|admin|pm)$/)"), 'Firebase rules must define the PM verification role set');
  assert(rules.includes("data.child('status').val() === 'for_verification'"), 'Firebase rules must define the for_verification state machine');
  assert(rules.includes("data.child('status').val() === 'pending'"), 'Firebase rules must define the pending state machine');
  assert(rules.includes("newData.child('createdBy').val() === data.child('createdBy').val()"), 'Firebase rules must freeze task creator identity');
  assert(rules.includes("newData.child('createdAt').val() === data.child('createdAt').val()"), 'Firebase rules must freeze task creation time');

  assert(auth.includes('function canSeeAllProjects(role)'), 'Central PM project visibility capability must exist');
  assert(auth.includes('function canCreateProjects(role)'), 'Central PM project creation capability must exist');
  assert(auth.includes('function canManageProjectAssignments(role)'), 'Central project assignment capability must exist');
  assert(/function canReadFullProject\(pid\)[\s\S]*canSeeAllProjects\(user\.role\)/.test(auth), 'PM full-project reads must match company-wide project visibility');
  assert(/function canWriteFieldLog\(pid\)[\s\S]*canSeeAllProjects\(user\.role\)/.test(auth), 'PM field-log writes must match company-wide project visibility');
  assert(main.includes('canCreateProjects(user.role)'), 'Project creation must use centralized role capability');
  assert(report.includes('canManageProjectAssignments(actorRole)'), 'Team Admin must use centralized assignment capability');
  assert(report.includes("actorRole === 'pm' && normalizeTeamRole(user.role) !== 'apm'"), 'PM assignments must be limited to APM targets');

  [workspace, dashboard].forEach((html, index) => {
    const page = index ? 'dashboard.html' : 'workspace.html';
    assert(html.includes('Project Assignments'), `${page} must expose Project Assignments`);
    assert(html.includes('data-project-manager'), `${page} must use PM capability visibility`);
    assert(html.includes("switchTab('tasks')"), `${page} must expose the Tasks workspace`);
  });

  assert(main.includes('Mission Board'), 'Project workspace must use Mission Board as the operational landing view');
  assert(main.includes("setHTML('pdMissionList'"), 'Mission Board must render actionable work');
  assert(main.includes("'completed', 'archived', 'delivered', 'cancelled'"), 'Open-item count must exclude completed work');
  assert(notifications.includes("return 'tasks'"), 'Task notifications must route to the Tasks workspace');
  assert(pmos.includes("pmosTransitionTask(\\'for_verification\\')"), 'PMOS must expose Submit for Verification');
  assert(pmos.includes("pmosTransitionTask(\\'completed\\')"), 'PMOS must expose PM verification completion');

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'canonical six-state task lifecycle',
      'PM verification authority',
      'single Office task listener with exact cleanup',
      'PMOS listener cleanup',
      'task event and project activity writes',
      'central PM project and assignment capabilities',
      'PM-to-APM assignment restriction',
      'Mission Board operational landing view',
      'task notification deep routing',
      'completed work excluded from open-item counts',
      'child-level task transition state machine in Firebase rules'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAIL', error: error.message }, null, 2));
  process.exit(1);
}
