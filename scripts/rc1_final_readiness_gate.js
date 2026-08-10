const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const node = process.execPath;
const requireFinal = process.env.ACPM_REQUIRE_RC1_FINAL === '1';

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

function runNode(args, extraEnv = {}) {
  const result = spawnSync(node, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    shell: false,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  return {
    command: ['node', ...args].join(' '),
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

function parseJsonOutput(output, command) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${command} did not return JSON: ${error.message}`);
  }
}

function hasAnyRoleCredentials() {
  if (process.env.ACPM_ROLE_QA_ACCOUNTS) return true;
  return ['ADMIN', 'PM', 'APM', 'FOREMAN', 'SAFETY', 'VIEWER', 'BOSS'].some(role =>
    process.env[`ACPM_${role}_QA_EMAIL`] && process.env[`ACPM_${role}_QA_PASSWORD`]
  ) || (process.env.ACPM_QA_EMAIL && process.env.ACPM_QA_PASSWORD);
}

function main() {
  const readiness = read('docs/release/RC1_READINESS.md');
  const postDeploy = read('docs/release/RC1_POST_DEPLOY_QA.md');
  const qaChangeOrder = read('docs/qa/QA_CHANGEORDER.md');
  const warnings = [];
  const failures = [];
  const evidence = [];

  const requiredReadinessEvidence = [
    'Live Firebase RC1 gate: PASS on 2026-07-02',
    'Live real QA scripts passed: Suppliers, Audit/Notifications, Labor cash advance/payroll, Reports, Site Logs, Change Orders, and Billing Phase 2.',
    'RC1 post-deploy local gate: PASS_WITH_REAL_QA_SKIPPED',
    'RC1 role/UI/rule matrix static QA after cache v96: PASS',
    'Live role-account gate: PASS for Boss/Admin/PM/APM accounts',
    'Change Orders browser click-through after cache v97',
    'Live Boss Team Admin browser smoke after cache v97: PASS',
    'Dedicated deployed-rule security gate: PASS'
  ];
  requiredReadinessEvidence.forEach(needle => {
    try {
      assert(readiness.includes(needle), `RC1_READINESS missing evidence: ${needle}`);
      evidence.push(needle);
    } catch (error) {
      failures.push(error.message);
    }
  });

  try {
    assert(postDeploy.includes('LIVE FIREBASE GATE PASSED ON 2026-07-02'), 'RC1 post-deploy live gate must be documented as passed');
    evidence.push('RC1 post-deploy runbook live gate passed status');
  } catch (error) {
    failures.push(error.message);
  }

  const localGate = runNode(['scripts/rc1_post_deploy_gate.js']);
  if (localGate.status !== 0) {
    failures.push(`${localGate.command} failed`);
  } else {
    const payload = parseJsonOutput(localGate.stdout, localGate.command);
    assert(payload.result === 'PASS_WITH_REAL_QA_SKIPPED' || payload.result === 'PASS', 'Local post-deploy gate must pass', payload);
    evidence.push(`local post-deploy gate ${payload.result}`);
  }

  let coveredRoleSet = new Set();
  const roleGate = runNode(['scripts/roles_live_account_qa.js']);
  if (roleGate.status !== 0) {
    let roleError = `${roleGate.command} failed`;
    try {
      const failurePayload = parseJsonOutput(roleGate.stderr, roleGate.command);
      roleError = `${roleError}: ${failurePayload.error || 'unknown role QA failure'}`;
      if (failurePayload.details?.securityImpact) {
        roleError = `${roleError} (${failurePayload.details.securityImpact})`;
      }
    } catch (error) {
      if (roleGate.stderr) roleError = `${roleError}: ${roleGate.stderr.slice(0, 300)}`;
    }
    failures.push(roleError);
  } else {
    const rolePayload = parseJsonOutput(roleGate.stdout, roleGate.command);
    const coveredRoles = new Set(rolePayload.coveredRoles || []);
    coveredRoleSet = coveredRoles;
    if (rolePayload.result === 'PASS') {
      evidence.push(`live role-account gate covered roles: ${[...coveredRoles].join(', ') || 'none'}`);
    } else {
      evidence.push(rolePayload.result);
    }
    const missingRoleQa = Array.isArray(rolePayload.rc1MissingRoleQa)
      ? rolePayload.rc1MissingRoleQa
      : ['admin', 'pm', 'apm'].filter(role => !coveredRoles.has(role));
    missingRoleQa.forEach(role => warnings.push(`Dedicated ${role.toUpperCase()} live role-account QA is still pending.`));
    if (!hasAnyRoleCredentials()) {
      warnings.push('No dedicated role QA credentials were supplied; only non-credential static and Boss evidence can be used.');
    }
  }

  const deployedRulesGate = runNode(['scripts/rc1_deployed_rules_security_qa.js']);
  if (deployedRulesGate.status !== 0) {
    let ruleError = `${deployedRulesGate.command} failed`;
    try {
      const failurePayload = parseJsonOutput(deployedRulesGate.stderr, deployedRulesGate.command);
      ruleError = `${ruleError}: ${failurePayload.error || 'deployed rules security QA failure'}`;
    } catch (error) {
      if (deployedRulesGate.stderr) ruleError = `${ruleError}: ${deployedRulesGate.stderr.slice(0, 300)}`;
    }
    failures.push(ruleError);
  } else {
    const securityPayload = parseJsonOutput(deployedRulesGate.stdout, deployedRulesGate.command);
    if (securityPayload.result === 'PASS') {
      evidence.push('deployed PM/APM rules security gate PASS');
    } else {
      warnings.push(`Deployed PM/APM rules security gate returned ${securityPayload.result}.`);
    }
  }

  const inventoryGate = runNode(['scripts/roles_live_inventory_qa.js']);
  if (inventoryGate.status !== 0) {
    failures.push(`${inventoryGate.command} failed`);
  } else {
    const inventoryPayload = parseJsonOutput(inventoryGate.stdout, inventoryGate.command);
    if (inventoryPayload.result === 'PASS_READ_ONLY_INVENTORY') {
      evidence.push(`live user-role inventory: ${JSON.stringify(inventoryPayload.roleCounts || {})}`);
      const missingProfiles = new Set(inventoryPayload.rc1RequiredProfilesMissing || []);
      ['admin', 'pm', 'apm'].forEach(role => {
        if (missingProfiles.has(role)) warnings.push(`Live user-role inventory has no ${role.toUpperCase()} profile to verify.`);
      });
      const deferredPresent = inventoryPayload.deferredRolesPresent || [];
      if (deferredPresent.length === 0) {
        evidence.push('live inventory has no deferred field-role profiles; field-role deny account QA remains a future activation gate');
      } else {
        if (!deferredPresent.some(role => coveredRoleSet.has(role))) {
          warnings.push('Deferred-role profiles exist but Foreman/Safety/Viewer deployed-rule deny QA has not been run.');
        }
      }
    } else {
      evidence.push(inventoryPayload.result);
    }
  }

  if (readiness.includes('WARNING / PENDING')) {
    warnings.push('RC1_READINESS still contains WARNING / PENDING rows.');
  }
  if (readiness.includes('FAILED / BLOCKER') || readiness.includes('RULE SECURITY QA FAILED')) {
    failures.push('RC1_READINESS still documents a failed/blocking state.');
  }
  if (!qaChangeOrder.includes('Browser click-through workflow QA, reject modal path after cache v97') ||
      !qaChangeOrder.includes('Full visible reject modal click-through passes against live Firebase')) {
    warnings.push('Visible Change Orders reject modal browser click-through evidence is missing.');
  }

  const result = failures.length
    ? 'FAILED'
    : warnings.length
      ? 'WARNING_NOT_RC1_FINAL'
      : 'PASS_RC1_READY';

  const payload = {
    result,
    requireFinal,
    evidence,
    warnings: [...new Set(warnings)],
    failures,
    nextStep: failures.some(item => item.includes('projects root'))
      ? 'Verify PM company-wide project access and APM assigned-only access, rerun scripts/roles_live_account_qa.js, then rerun this final readiness gate.'
      : failures.length
        ? 'Resolve the failed gate command(s), then rerun this final readiness gate.'
        : warnings.length
          ? 'Create/identify missing Admin/PM/APM profiles if needed, supply dedicated role credentials, run scripts/roles_live_account_qa.js, then rerun this final readiness gate.'
          : 'RC1 final readiness evidence is complete; prepare the release tag/package.'
  };

  console.log(JSON.stringify(payload, null, 2));

  if (failures.length || (requireFinal && warnings.length)) {
    process.exit(1);
  }
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
