const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mainCheck() {
  assert(/function dashboardRollup\(p\)[\s\S]*reportRollups\?\.projectSummary[\s\S]*billingRollups/.test(main), 'dashboardRollup must prefer reportRollups then billingRollups');
  assert(/function dashboardTotalSpent\(p\)[\s\S]*rollup\.totalCost[\s\S]*dashboardLaborSpent\(p\) \+ dashboardMaterialSpent\(p\) \+ dashboardOtherSpent\(p\)/.test(main), 'dashboardTotalSpent must use rollup totalCost with legacy fallback');
  assert(main.includes('function dashboardPendingApprovalItems(projects = [])'), 'dashboard pending approval helper must exist');
  assert(main.includes('lifecycleRequests'), 'dashboard alerts must include lifecycle requests');
  assert(main.includes('notificationEvents'), 'dashboard alerts/recent activity must include notification events');
  assert(main.includes('openIssues') && main.includes('openDelays'), 'dashboard alerts must include site-log issue/delay rollups');
  assert(main.includes('function dashboardRecentItems(projects = [])'), 'dashboard recent activity helper must exist');
  assert(main.includes('function renderDashboardSummary(projects'), 'dashboard summary renderer must exist');
  assert(main.includes('function renderDashboardAlerts(projects)'), 'dashboard alerts renderer must exist');
  assert(main.includes('window.renderDashboardAlerts = renderDashboardAlerts'), 'dashboard alerts renderer must be exported for QA/manual refresh');
  assert(main.includes('window.dashboardPendingApprovalItems = dashboardPendingApprovalItems'), 'dashboard pending approval helper must be exported');
  assert(main.includes('window.dashboardRecentItems = dashboardRecentItems'), 'dashboard recent activity helper must be exported');

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'dashboard rollup source priority',
      'rollup-aware total spent',
      'pending approval alert source',
      'notification event alert/recent source',
      'site-log issue/delay alert source',
      'dashboard QA helper exports'
    ]
  }, null, 2));
}

try {
  mainCheck();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
}
