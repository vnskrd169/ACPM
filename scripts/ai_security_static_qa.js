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

const files = sourceRoots.flatMap(sourceFiles);
const failures = [];
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
const mutationMethods = '(?:set|update|remove|push)';
const quote = "['\"`]";
const allowedAiCollections = new Set([
  'config',
  'agents',
  'runtimeStatus',
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
        + '\\s*\\)[\\s\\S]{0,160}\\.' + mutationMethods + '\\s*\\(',
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

  if (/\b(?:OPENAI|ANTHROPIC|GEMINI|CLAUDE)_API_KEY\b|\bsk-[A-Za-z0-9_-]{12,}|\bapiKey\s*[:=]\s*['"][^'"]+/i.test(source)) {
    failures.push(`${relative}: provider credential pattern found`);
  }

  if (/\b(?:onSchedule|onValueCreated|onValueWritten|onCall|onRequest)\s*\(/.test(source)) {
    failures.push(`${relative}: deployable Firebase trigger or callable found`);
  }
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

const functionsPackage = JSON.parse(fs.readFileSync(path.join(root, 'functions', 'package.json'), 'utf8'));
const dependencies = {
  ...(functionsPackage.dependencies || {}),
  ...(functionsPackage.devDependencies || {})
};
for (const providerSdk of ['openai', '@anthropic-ai/sdk', '@google/generative-ai', 'firebase-functions']) {
  if (providerSdk in dependencies) {
    failures.push(`functions/package.json: forbidden Phase 2 dependency ${providerSdk}`);
  }
}

if (fs.existsSync(path.join(root, 'functions', 'src', 'index.ts'))) {
  failures.push('functions/src/index.ts: deployable functions entrypoint must not exist in Phase 2');
}

if (failures.length > 0) {
  console.error('AI security static QA failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`AI security static QA passed (${files.length} backend source files scanned).`);
console.log('Verified: /ai write boundary patterns, disabled defaults, restricted Admin auth, no provider SDK/keys, no deployable trigger.');
