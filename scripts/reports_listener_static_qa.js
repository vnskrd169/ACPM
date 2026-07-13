const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const report = fs.readFileSync(path.join(root, 'report.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function functionBody(name) {
  const marker = `function ${name}(`;
  const start = report.indexOf(marker);
  assert(start >= 0, `Missing ${name}()`);
  const brace = report.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < report.length; i += 1) {
    if (report[i] === '{') depth += 1;
    if (report[i] === '}') {
      depth -= 1;
      if (depth === 0) return report.slice(brace + 1, i);
    }
  }
  throw new Error(`Could not parse ${name}() body`);
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function main() {
  const initReports = functionBody('initReports');
  const detach = functionBody('detachReportsListeners');
  const project = functionBody('renderProjectReports');
  const executive = functionBody('renderExecutiveDashboard');
  const team = functionBody('renderTeamPerformance');
  const budget = functionBody('renderBudgetVariance');

  assert(/^\s*detachReportsListeners\(\);/.test(initReports), 'initReports must detach old report listeners before adding new ones');

  assert(detach.includes('_reportsListeners.forEach(ref => ref.off())'), 'detachReportsListeners must turn off report refs');
  assert(detach.includes('_reportsListeners = []'), 'detachReportsListeners must clear report ref list');
  assert(detach.includes('_teamAdminListener.off()'), 'detachReportsListeners must turn off Team Admin listener');
  assert(detach.includes('_auditListener.off()'), 'detachReportsListeners must turn off Audit listener');
  assert(detach.includes('detachAuditFallbackListeners()'), 'detachReportsListeners must turn off fallback audit listeners');
  assert(detach.includes('_lifecycleRequestListener.off()'), 'detachReportsListeners must turn off Lifecycle Requests listener');
  assert(detach.includes('_accessRequestListener.off()'), 'detachReportsListeners must turn off Access Requests listener');

  for (const [name, body] of [
    ['renderProjectReports', project],
    ['renderExecutiveDashboard', executive],
    ['renderTeamPerformance', team],
    ['renderBudgetVariance', budget]
  ]) {
    assert(countMatches(body, /_reportsListeners\.push\(ref\)/g) === 1, `${name} must add exactly one tracked report listener`);
    assert(
      countMatches(body, /firebase\.database\(\)\.ref\('projects'\)/g) === 1 ||
      countMatches(body, /firebase\.database\(\)\.ref\(`projects\/\$\{projectId\}`\)/g) === 1,
      `${name} must open exactly one projects listener`
    );
    assert(countMatches(body, /\.on\('value'/g) === 1, `${name} must attach exactly one value listener`);
  }

  assert(countMatches(report, /_reportsListeners\.push\(ref\)/g) === 4, 'Report module must have exactly four tracked report listeners');
  assert(report.includes('function reportListenerDiagnostics()'), 'Report listener diagnostics helper must exist');
  assert(report.includes('window.reportListenerDiagnostics = reportListenerDiagnostics'), 'Report listener diagnostics helper must be exported');

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'initReports detaches before attaching',
      'all report listeners are tracked',
      'report/team/audit/lifecycle listeners are cleaned up',
      'project and cross-project report views use one projects listener each',
      'listener diagnostics export exists'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
}
