const { spawnSync } = require('child_process');

const node = process.execPath;
const runRealQa = process.env.RUN_REAL_QA === '1';
const hasCreds = !!process.env.ACPM_QA_EMAIL && !!process.env.ACPM_QA_PASSWORD;
const hasRoleCreds = !!process.env.ACPM_ROLE_QA_ACCOUNTS ||
  (!!process.env.ACPM_PM_QA_EMAIL && !!process.env.ACPM_PM_QA_PASSWORD && !!process.env.ACPM_APM_QA_EMAIL && !!process.env.ACPM_APM_QA_PASSWORD);

const localCommands = [
  ['node', ['--check', 'auth.js']],
  ['node', ['--check', 'main.js']],
  ['node', ['--check', 'report.js']],
  ['node', ['--check', 'notifications.js']],
  ['node', ['--check', 'labor.js']],
  ['node', ['--check', 'materials.js']],
  ['node', ['--check', 'billing.js']],
  ['node', ['--check', 'changeorders.js']],
  ['node', ['--check', 'sitelog.js']],
  ['node', ['--check', 'suppliers.js']],
  ['node', ['--check', 'equipment.js']],
  ['node', ['--check', 'compliance.js']],
  ['node', ['--check', 'defects.js']],
  ['node', ['--check', 'tasks.js']],
  ['node', ['--check', 'pmos-task-adapter.js']],
  ['node', ['--check', 'pmos.js']],
  ['node', ['--check', 'scripts/pm_apm_task_workflow_static_qa.js']],
  ['node', ['--check', 'scripts/roles_rc1_matrix_qa.js']],
  ['node', ['--check', 'scripts/dashboard_static_qa.js']],
  ['node', ['--check', 'scripts/changeorder_static_qa.js']],
  ['node', ['--check', 'scripts/audit_notification_supplier_static_qa.js']],
  ['node', ['--check', 'scripts/pwa_cache_static_qa.js']],
  ['node', ['--check', 'scripts/reports_listener_static_qa.js']],
  ['node', ['--check', 'scripts/rc1_docs_static_qa.js']],
  ['node', ['--check', 'scripts/historical_integrity_static_qa.js']],
  ['node', ['--check', 'scripts/ui_workflow_static_qa.js']],
  ['node', ['--check', 'scripts/roles_live_account_qa.js']],
  ['node', ['--check', 'scripts/roles_live_inventory_qa.js']],
  ['node', ['--check', 'scripts/rc1_deployed_rules_security_qa.js']],
  ['node', ['--check', 'scripts/rc1_final_readiness_gate.js']],
  ['node', ['--check', 'scripts/rc1_static_gate.js']],
  ['node', ['--check', 'scripts/firebase_rules_gate.js']],
  ['node', ['scripts/roles_rc1_matrix_qa.js']],
  ['node', ['scripts/roles_live_account_qa.js']],
  ['node', ['scripts/roles_live_inventory_qa.js']],
  ['node', ['scripts/dashboard_static_qa.js']],
  ['node', ['scripts/changeorder_static_qa.js']],
  ['node', ['scripts/audit_notification_supplier_static_qa.js']],
  ['node', ['scripts/pwa_cache_static_qa.js']],
  ['node', ['scripts/reports_listener_static_qa.js']],
  ['node', ['scripts/rc1_docs_static_qa.js']],
  ['node', ['scripts/historical_integrity_static_qa.js']],
  ['node', ['scripts/ui_workflow_static_qa.js']],
  ['node', ['scripts/rc1_static_gate.js']],
  ['node', ['scripts/firebase_rules_gate.js']]
];

localCommands.splice(localCommands.length - 2, 0, ['node', ['scripts/pm_apm_task_workflow_static_qa.js']]);

if (hasRoleCreds) {
  localCommands.push(['node', ['scripts/rc1_deployed_rules_security_qa.js']]);
}

const realQaCommands = [
  ['node', ['scripts/suppliers_v1_real_qa.js']],
  ['node', ['scripts/audit_notifications_v1_real_qa.js']],
  ['node', ['scripts/labor_v1_cash_advance_real_qa.js']],
  ['node', ['scripts/reports_v1_real_qa.js']],
  ['node', ['scripts/sitelog_v1_real_qa.js']],
  ['node', ['scripts/changeorder_v1_real_qa.js']],
  ['node', ['scripts/billing_phase2_real_qa.js']]
];

function displayCommand(command, args) {
  return [command, ...args].join(' ');
}

function run(command, args) {
  const executable = command === 'node' ? node : command;
  const label = displayCommand(command, args);
  const result = spawnSync(executable, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false
  });
  return {
    command: label,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

function main() {
  const results = [];
  for (const [command, args] of localCommands) {
    const result = run(command, args);
    results.push(result);
    if (result.status !== 0) break;
  }

  const localFailed = results.some(r => r.status !== 0);
  const realQaResults = [];
  let realQaSkippedReason = '';

  if (!localFailed && runRealQa && hasCreds) {
    for (const [command, args] of realQaCommands) {
      const result = run(command, args);
      realQaResults.push(result);
      if (result.status !== 0) break;
    }
  } else if (!runRealQa) {
    realQaSkippedReason = 'RUN_REAL_QA is not 1; real Firebase write QA skipped intentionally.';
  } else if (!hasCreds) {
    realQaSkippedReason = 'ACPM_QA_EMAIL and/or ACPM_QA_PASSWORD missing; real Firebase write QA skipped.';
  }

  const realQaFailed = realQaResults.some(r => r.status !== 0);
  const payload = {
    result: localFailed || realQaFailed ? 'FAILED' : realQaResults.length ? 'PASS' : 'PASS_WITH_REAL_QA_SKIPPED',
    localCommands: results.map(r => ({ command: r.command, status: r.status })),
    realQaCommands: realQaResults.map(r => ({ command: r.command, status: r.status })),
    realQaSkippedReason,
    nextStep: realQaSkippedReason
      ? 'For live backend verification, set RUN_REAL_QA=1 plus ACPM_QA_EMAIL/ACPM_QA_PASSWORD. For deployed PM/APM rules verification, also set ACPM_ROLE_QA_ACCOUNTS or PM/APM role credentials.'
      : 'Review script outputs and update docs/release/RC1_READINESS.md with deployed-rule QA evidence.'
  };

  console.log(JSON.stringify(payload, null, 2));

  if (localFailed || realQaFailed) {
    const failed = [...results, ...realQaResults].find(r => r.status !== 0);
    if (failed) {
      console.error(`FAILED: ${failed.command}`);
      if (failed.stdout) console.error(failed.stdout);
      if (failed.stderr) console.error(failed.stderr);
    }
    process.exit(1);
  }
}

main();
