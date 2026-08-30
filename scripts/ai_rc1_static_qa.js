'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const parse = relativePath => JSON.parse(read(relativePath));
const checks = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks.push(message);
}

function assertIncludes(source, values, label) {
  for (const value of values) {
    assert(source.includes(value), `${label} must include ${value}`);
  }
}

function main() {
  const aiDoc = read('docs/release/AI_COMMAND_CENTER_RC1.md');
  const pilotDoc = read('docs/release/ACPM_PRODUCTION_PILOT_RC1.md');
  const entrypoint = read('functions/src/index.ts');
  const contracts = read('functions/src/ai/contracts.ts');
  const commandCenter = read('ai-command-center.js');
  const stagingDeploy = read('scripts/deploy-staging.ps1');
  const productionDeploy = read('scripts/deploy-production.ps1');
  const firebaseRc = parse('.firebaserc');
  const firebaseConfig = parse('firebase.json');
  const databaseRules = parse('database.rules.json');
  const aiRules = databaseRules.rules.ai;

  assertIncludes(aiDoc, [
    '## RC1 scope',
    '### Feature matrix',
    '## Zero-budget and provider-dependent behavior',
    '## Role access',
    '## Callable security review',
    '**APP CHECK: BLOCKED**',
    '## Firebase plan status',
    '## `/ai` namespace and service boundary',
    '## Decision and action-draft semantics',
    '## Default and migration safety',
    '## Environment isolation and release assets',
    '## Staging procedure',
    '## Production procedure',
    '## Emergency disable and rollback',
    '## Known limitations',
    'billingEnabled: false',
    'Autonomous execution | NO | NOT SUPPORTED'
  ], 'AI Command Center RC1 runbook');

  assertIncludes(pilotDoc, [
    '## Pilot decision',
    '### Available without Functions',
    '### Requires Functions',
    '## Role matrix',
    '**APP CHECK: BLOCKED**',
    '## Production default and data safety',
    '## Short Staging smoke',
    '## Guarded Production deployment order',
    '## Rollback',
    '## Known limitations',
    '-DatabaseOnly',
    'Real OpenAI is deferred'
  ], 'Production Pilot RC1 runbook');

  const callableNames = [...entrypoint.matchAll(/export const (\w+) = onCall\(/g)].map(match => match[1]);
  assert(JSON.stringify(callableNames) === JSON.stringify([
    'stagingManualAiDryRun',
    'submitAiDecision',
    'reviewAiActionDraft'
  ]), 'only the three reviewed AI callables are exported');
  assert(!/\b(?:onSchedule|onValueCreated|onValueWritten|onRequest)\s*\(/.test(entrypoint), 'no scheduled, database-triggered, or raw HTTP AI Function is exported');
  assert(/stagingManualAiDryRun[\s\S]*?enforceAppCheck:\s*true/.test(entrypoint), 'Staging provider callable enforces App Check');
  assert(/submitAiDecision[\s\S]*?enforceAppCheck:\s*false/.test(entrypoint), 'Human Decision App Check blocker remains explicit');
  assert(/reviewAiActionDraft[\s\S]*?enforceAppCheck:\s*false/.test(entrypoint), 'Action Draft App Check blocker remains explicit');
  assert((entrypoint.match(/concurrency:\s*(?:1|10)/g) || []).length === 3, 'all callable concurrency is bounded');

  for (const disabledDefault of ['enabled: false', 'generationEnabled: false', 'uiEnabled: false', 'dryRun: true']) {
    assert(contracts.includes(disabledDefault), `fail-closed default is retained: ${disabledDefault}`);
  }
  assert(commandCenter.includes("if (!value || value.schemaVersion !== '0.1' || value.uiEnabled !== true) return null;"), 'missing or disabled uiStatus hides the Command Center');
  assert(!/firebase-app-check|\.appCheck\s*\(/i.test(commandCenter), 'browser App Check is not falsely claimed as initialized');

  assert(firebaseRc.projects.production === 'acpm-project-system', 'Production Firebase target is pinned');
  assert(firebaseRc.projects.staging === 'acpm-project-system-qa', 'Staging Firebase target is pinned');
  assert(!Object.prototype.hasOwnProperty.call(firebaseRc.projects, 'default'), 'Firebase has no default deploy alias');
  assert(Array.isArray(firebaseConfig.functions) && firebaseConfig.functions[0].codebase === 'ai-staging', 'AI Functions remain in the reviewed codebase');
  assert(firebaseConfig.hosting.ignore.includes('dev') && firebaseConfig.hosting.ignore.includes('dev/**'), 'development fixtures are excluded from Hosting');

  assert(stagingDeploy.includes('AI Functions deployment blocked: enable Firebase billing, configure and validate Web App Check'), 'Staging Functions deploy fails closed on prerequisites');
  assert(!/functions(?::ai-staging)?/.test(stagingDeploy), 'Staging release script contains no deployable Functions target');
  assert(productionDeploy.includes('[switch]$ConfirmProduction'), 'Production deployment requires explicit confirmation');
  assert(productionDeploy.includes('[switch]$DatabaseOnly'), 'Production rules-only release path is explicit');
  assert(productionDeploy.includes("'database'"), 'Production rules-only target is present');
  assert(!/functions(?::ai-staging)?/.test(productionDeploy), 'Production release script contains no Functions target');

  const expectedAiChildren = [
    'config', 'projectTargets', 'agents', 'runtimeStatus', 'uiStatus',
    'conditions', 'events', 'runs', 'findings', 'recommendations', 'decisions',
    'actionDrafts', 'actionDraftEvents', 'idempotency', '$other'
  ];
  assert(JSON.stringify(Object.keys(aiRules)) === JSON.stringify(['.read', '.write', ...expectedAiChildren]), 'the complete `/ai` root is explicit and ordered');
  assert(aiRules['.read'] === false && aiRules['.write'] === false, 'the `/ai` root denies broad browser access');
  assert(aiRules.$other['.read'] === false && aiRules.$other['.write'] === false, 'unknown `/ai` children fail closed');
  for (const [name, field] of [
    ['events', 'createdAt'],
    ['runs', 'createdAt'],
    ['recommendations', 'createdAt'],
    ['decisions', 'createdAt'],
    ['actionDrafts', 'createdAt'],
    ['actionDraftEvents', 'timestamp']
  ]) {
    assert((aiRules[name]['.indexOn'] || []).includes(field), `/ai/${name} retains its bounded-query index`);
  }

  console.log(JSON.stringify({
    result: 'PASS',
    checks: checks.length,
    appCheck: 'BLOCKED_AND_DEPLOYMENT_GUARDED',
    functions: 'BLOCKED_BY_PREREQUISITES',
    zeroBudget: 'HOSTING_AND_RULES_RELEASEABLE'
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
}
