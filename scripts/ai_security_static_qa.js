'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceRoots = [
  path.join(root, 'functions', 'src', 'ai'),
  path.join(root, 'functions', 'src', 'firebase')
];

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(fullPath) : (entry.name.endsWith('.ts') ? [fullPath] : []);
  });
}

const entrypointPath = path.join(root, 'functions', 'src', 'index.ts');
const files = [
  ...sourceRoots.flatMap(sourceFiles),
  ...(fs.existsSync(entrypointPath) ? [entrypointPath] : [])
];
const failures = [];
const aiSourceFiles = sourceFiles(path.join(root, 'functions', 'src', 'ai'));
const forbiddenRoots = [
  'projects',
  'suppliers',
  'users',
  'billing',
  'billings',
  'payroll',
  'changeOrders',
  'notifications',
  'auditLogs'
];
const mutationMethods = '(?:set|update|remove|push|transaction)';
const quote = "['\"`]";
const allowedAiCollections = new Set([
  'config',
  'projectTargets',
  'agents',
  'runtimeStatus',
  'uiStatus',
  'conditions',
  'events',
  'runs',
  'findings',
  'recommendations',
  'decisions',
  'idempotency'
]);

function isAllowedLiteralWritePath(writePath) {
  const normalized = writePath.replace(/^\/+|\/+$/g, '');
  const [namespace, collection] = normalized.split('/');
  return namespace === 'ai' && allowedAiCollections.has(collection);
}

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file);

  for (const forbiddenRoot of forbiddenRoots) {
    const modularWrite = new RegExp(
      mutationMethods + '\\s*\\(\\s*(?:ref|child)\\s*\\([^)]*' + quote
        + '\\/?' + forbiddenRoot + '(?:\\/|' + quote + ')',
      's'
    );
    const chainedWrite = new RegExp(
      '(?:ref|child)\\s*\\(\\s*' + quote + '\\/?' + forbiddenRoot
        + '(?:\\/|' + quote + ')[^)]*\\)[\\s\\S]{0,160}\\.'
        + mutationMethods + '\\s*\\(',
      's'
    );
    if (modularWrite.test(source) || chainedWrite.test(source)) {
      failures.push(`${relative}: possible write to forbidden /${forbiddenRoot} path`);
    }
  }

  const literalWritePatterns = [
    new RegExp(
      mutationMethods + '\\s*\\(\\s*(?:ref|child)\\s*\\([^)]*?'
        + quote + "([^'\"`]+)" + quote + '\\s*\\)',
      'gs'
    ),
    new RegExp(
      '(?:ref|child)\\s*\\(\\s*' + quote + "([^'\"`]+)" + quote
        + '\\s*\\)\\s*\\.' + mutationMethods + '\\s*\\(',
      'gs'
    )
  ];
  for (const pattern of literalWritePatterns) {
    for (const match of source.matchAll(pattern)) {
      if (!isAllowedLiteralWritePath(match[1])) {
        failures.push(`${relative}: literal backend write is outside an explicit /ai collection (${match[1]})`);
      }
    }
  }

  if (/\bsk-[A-Za-z0-9_-]{12,}|\bapiKey\s*[:=]\s*['"][^'"]+/i.test(source)) {
    failures.push(`${relative}: provider credential pattern found`);
  }
  if (/\bOPENAI_API_KEY\b/.test(source) && relative !== path.join('functions', 'src', 'index.ts')) {
    failures.push(`${relative}: OPENAI_API_KEY may appear only in the server entrypoint Secret Manager binding`);
  }
  if (/console\.(?:log|info|warn|error|debug)\s*\([^)]*(?:OPENAI_API_KEY|apiKey)/is.test(source)) {
    failures.push(`${relative}: possible provider credential logging found`);
  }

  const deployableTrigger = /\b(?:onSchedule|onValueCreated|onValueWritten|onCall|onRequest)\s*\(/;
  if (deployableTrigger.test(source) && relative !== path.join('functions', 'src', 'index.ts')) {
    failures.push(`${relative}: deployable Firebase trigger or callable found`);
  }
  if (/from\s+['"]openai(?:\/[^'"]*)?['"]/.test(source)
      && relative !== path.join('functions', 'src', 'ai', 'providers', 'openai.ts')) {
    failures.push(`${relative}: direct OpenAI import is outside the provider adapter`);
  }

  if (
    /\.ref\s*\(\s*['"`]\/?projects\/?['"`]\s*\)/.test(source)
    || /\bref\s*\([^,]+,\s*['"`]\/?projects\/?['"`]\s*\)/.test(source)
  ) {
    failures.push(`${relative}: project-root read/listing pattern found`);
  }
}

const ignoredFrontendDirectories = new Set([
  '.git', '.firebase', 'node_modules', 'functions', 'docs', 'scripts', 'tests',
  'test-results', 'playwright-report', 'dev', 'line17-face-attendance'
]);
function deployableFrontendFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory() && ignoredFrontendDirectories.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return deployableFrontendFiles(fullPath);
    return /\.(?:html|js|mjs|cjs)$/i.test(entry.name) ? [fullPath] : [];
  });
}
const frontendFiles = deployableFrontendFiles(root);
for (const file of frontendFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file);
  if (/\bOPENAI_API_KEY\b|\bsk-[A-Za-z0-9_-]{12,}|from\s+['"]openai(?:\/[^'"]*)?['"]/i.test(source)) {
    failures.push(`${relative}: OpenAI credential or SDK reference found in deployable frontend`);
  }
  if (/['"`]\/?ai\/config(?:\/|['"`])/.test(source)) {
    failures.push(`${relative}: browser code must not read /ai/config for UI feature gating`);
  }
  if (/['"`]\/?ai\/uiStatus(?:\/|['"`])[\s\S]{0,200}\.(?:set|update|remove|push|transaction)\s*\(/.test(source)) {
    failures.push(`${relative}: browser code must not write /ai/uiStatus`);
  }
}

function repositoryTextFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory() && new Set([
      '.git', '.firebase', '.tmp_jdk', 'tmp_jdk', 'node_modules', 'lib',
      'test-results', 'playwright-report', 'line17-face-attendance'
    ]).has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return repositoryTextFiles(fullPath);
    return /\.(?:ts|js|mjs|cjs|json|html|md|ps1)$/i.test(entry.name) ? [fullPath] : [];
  });
}
for (const file of repositoryTextFiles(root)) {
  if (/\bsk-[A-Za-z0-9_-]{12,}/.test(fs.readFileSync(file, 'utf8'))) {
    failures.push(`${path.relative(root, file)}: provider-key-shaped value found in repository text`);
  }
}

const aiSources = aiSourceFiles
  .map(file => fs.readFileSync(file, 'utf8'))
  .join('\n');
if (/\b(?:projectSnapshot|rawProject|fullProject)\b/.test(aiSources)) {
  failures.push('functions/src/ai: possible full project snapshot passed through AI code');
}
if (!/TASK_CONTEXT_FIELDS/.test(aiSources) || !/MATERIAL_CONTEXT_FIELDS/.test(aiSources) || !/ISSUE_CONTEXT_FIELDS/.test(aiSources)) {
  failures.push('functions/src/ai: explicit grounded-context field allowlists are missing');
}

const contractsPath = path.join(root, 'functions', 'src', 'ai', 'contracts.ts');
const contracts = fs.readFileSync(contractsPath, 'utf8');
for (const requiredDefault of [
  /enabled:\s*false/,
  /generationEnabled:\s*false/,
  /uiEnabled:\s*false/,
  /dryRun:\s*true/,
  /timeZone:\s*'Asia\/Manila'/
]) {
  if (!requiredDefault.test(contracts)) {
    failures.push('functions/src/ai/contracts.ts: a required disabled default is missing');
  }
}

const adminSource = fs.readFileSync(path.join(root, 'functions', 'src', 'firebase', 'admin.ts'), 'utf8');
if (!/databaseAuthVariableOverride\s*:/.test(adminSource) || !/AI_SERVICE_UID/.test(adminSource)) {
  failures.push('functions/src/firebase/admin.ts: restricted RTDB auth override is missing');
}

const openAiProviderPath = path.join(root, 'functions', 'src', 'ai', 'providers', 'openai.ts');
const openAiProviderSource = fs.readFileSync(openAiProviderPath, 'utf8');
if (/firebase|database\.ref|initializeApp|getDatabase/i.test(openAiProviderSource)) {
  failures.push('functions/src/ai/providers/openai.ts: provider adapter must not access Firebase');
}
if (!/store:\s*false/.test(openAiProviderSource) || !/zodTextFormat/.test(openAiProviderSource)) {
  failures.push('functions/src/ai/providers/openai.ts: strict non-stored structured output boundary is missing');
}

const databaseRules = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8'));
const aiRules = databaseRules.rules && databaseRules.rules.ai;
const configReadRule = aiRules && aiRules.config && aiRules.config['.read'];
const expectedConfigReadRule = "auth != null && (auth.uid === 'acpm-ai-service' || (root.child('users/' + auth.uid + '/status').val() === 'active' && root.child('users/' + auth.uid + '/role').val().matches(/^(boss|owner|admin)$/)))";
if (configReadRule !== expectedConfigReadRule) {
  failures.push('database.rules.json: /ai/config must remain limited to active boss, owner, admin, and service reads');
}

const uiStatusRules = aiRules && aiRules.uiStatus;
const uiStatusFields = 'schemaVersion|uiEnabled|systemStatus|updatedAt';
const expectedUiStatusReadRule = "auth != null && (auth.uid === 'acpm-ai-service' || (root.child('users/' + auth.uid + '/status').val() === 'active' && root.child('users/' + auth.uid + '/role').val().matches(/^(boss|owner|admin|pm)$/)))";
if (
  !uiStatusRules
  || uiStatusRules['.read'] !== expectedUiStatusReadRule
  || uiStatusRules['.write'] !== "auth != null && auth.uid === 'acpm-ai-service'"
  || !uiStatusRules.$other
  || uiStatusRules.$other['.validate'] !== `$other.matches(/^(${uiStatusFields})$/)`
) {
  failures.push('database.rules.json: /ai/uiStatus must be a service-owned, management-readable four-field projection');
}

const uiStatusSchemaPath = path.join(root, 'functions', 'src', 'ai', 'schemas.ts');
const uiStatusSchemaSource = fs.readFileSync(uiStatusSchemaPath, 'utf8');
if (
  !/aiUiStatusSchema\s*=\s*z\.object\(\{[\s\S]*?schemaVersion:[\s\S]*?uiEnabled:[\s\S]*?systemStatus:[\s\S]*?updatedAt:[\s\S]*?\}\)\.strict\(\)/.test(uiStatusSchemaSource)
) {
  failures.push('functions/src/ai/schemas.ts: strict four-field uiStatus schema is missing');
}

function inspectAiWrites(node, pathParts = ['ai']) {
  if (!node || typeof node !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(node, '.write')) {
    const writeRule = node['.write'];
    if (
      writeRule !== false
      && (typeof writeRule !== 'string' || !writeRule.includes("auth.uid === 'acpm-ai-service'"))
    ) {
      failures.push(`database.rules.json: non-service /${pathParts.join('/')} write rule found`);
    }
  }
  for (const [key, child] of Object.entries(node)) {
    if (!key.startsWith('.')) inspectAiWrites(child, [...pathParts, key]);
  }
}
inspectAiWrites(databaseRules.rules && databaseRules.rules.ai);

const functionsPackage = JSON.parse(fs.readFileSync(path.join(root, 'functions', 'package.json'), 'utf8'));
const dependencies = {
  ...(functionsPackage.dependencies || {}),
  ...(functionsPackage.devDependencies || {})
};
for (const providerSdk of ['@anthropic-ai/sdk', '@google/generative-ai']) {
  if (providerSdk in dependencies) {
    failures.push(`functions/package.json: unapproved provider SDK ${providerSdk}`);
  }
}
if (dependencies.openai !== '7.8.0') {
  failures.push('functions/package.json: OpenAI SDK must stay pinned to reviewed version 7.8.0');
}
if (dependencies['firebase-functions'] !== '7.3.2') {
  failures.push('functions/package.json: Firebase Functions SDK must stay pinned to reviewed version 7.3.2');
}

if (!fs.existsSync(entrypointPath)) {
  failures.push('functions/src/index.ts: reviewed staging manual entrypoint is missing');
} else {
  const entrypoint = fs.readFileSync(entrypointPath, 'utf8');
  const onCallCount = (entrypoint.match(/\bonCall\s*\(/g) || []).length;
  if (onCallCount !== 1 || !/stagingManualAiDryRun/.test(entrypoint)) {
    failures.push('functions/src/index.ts: only the stagingManualAiDryRun callable may be exported');
  }
  for (const requirement of [
    /defineSecret\(['"]OPENAI_API_KEY['"]\)/,
    /enforceAppCheck:\s*true/,
    /STAGING_PROJECT_ID/,
    /MANAGEMENT_ROLES/,
    /dry_run_required/
  ]) {
    if (!requirement.test(entrypoint) && !(
      requirement.source === 'dry_run_required' && fs.readFileSync(path.join(root, 'functions', 'src', 'ai', 'staging-manual.ts'), 'utf8').includes('dry_run_required')
    )) {
      failures.push('functions/src/index.ts: a staging callable safety guard is missing');
    }
  }
  if (/\b(?:onSchedule|onValueCreated|onValueWritten|onRequest)\s*\(/.test(entrypoint)) {
    failures.push('functions/src/index.ts: unapproved trigger or HTTP function found');
  }
}

const stagingDeploy = fs.readFileSync(path.join(root, 'scripts', 'deploy-staging.ps1'), 'utf8');
const productionDeploy = fs.readFileSync(path.join(root, 'scripts', 'deploy-production.ps1'), 'utf8');
if (!/IncludeAiProvider/.test(stagingDeploy) || !/functions:ai-staging/.test(stagingDeploy)) {
  failures.push('scripts/deploy-staging.ps1: explicit opt-in AI Functions deployment is missing');
}
if (/functions(?::ai-staging)?/.test(productionDeploy)) {
  failures.push('scripts/deploy-production.ps1: Production deployment must exclude AI Functions');
}

if (failures.length > 0) {
  console.error('AI security static QA failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`AI security static QA passed (${files.length} backend source files scanned).`);
console.log('Verified: pinned OpenAI adapter only, Secret Manager binding, no frontend key/SDK, no credential logging, /ai-only runtime writes, sanitized service-owned uiStatus with PM config isolation, no provider Firebase access, no project-root listing/full snapshots, staging-only callable guards, Production Functions excluded, and disabled defaults.');
