'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'ai-command-center.js');
const attentionPath = path.join(root, 'ai-attention.js');
const stylePath = path.join(root, 'assets', 'brand', 'ai-command-center.css');
const dashboardPath = path.join(root, 'dashboard.html');
const workspacePath = path.join(root, 'workspace.html');
const swPath = path.join(root, 'sw.js');
const fixturePath = path.join(root, 'tests', 'e2e', 'ai-command-center-fixtures.ts');
const specPath = path.join(root, 'tests', 'e2e', 'ai-command-center.spec.ts');
const qaPath = path.join(root, 'docs', 'qa', 'QA_AI_COMMAND_CENTER_UI.md');
const zeroBudgetDocPath = path.join(root, 'docs', 'ai', 'AI_ZERO_BUDGET_MODE.md');
const failures = [];
let gates = 0;

function gate(condition, message) {
  gates += 1;
  if (!condition) failures.push(message);
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

const source = read(sourcePath);
const attention = read(attentionPath);
const styles = read(stylePath);
const dashboard = read(dashboardPath);
const workspace = read(workspacePath);
const sw = read(swPath);
const fixtures = read(fixturePath);
const spec = read(specPath);

gate(Boolean(source && attention && styles), 'AI Command Center, attention model, or stylesheet is missing');
gate(
  occurrences(dashboard, 'ai-attention.js?v=1') === 1
    && occurrences(workspace, 'ai-attention.js?v=1') === 1
    && occurrences(dashboard, 'ai-command-center.js?v=3') === 1
    && occurrences(workspace, 'ai-command-center.js?v=3') === 1
    && dashboard.indexOf('ai-attention.js?v=1') < dashboard.indexOf('ai-command-center.js?v=3')
    && workspace.indexOf('ai-attention.js?v=1') < workspace.indexOf('ai-command-center.js?v=3'),
  'dashboard/workspace must each contain exactly one versioned AI browser module reference'
);
gate(
  occurrences(dashboard, 'assets/brand/ai-command-center.css?v=2') === 1
    && occurrences(workspace, 'assets/brand/ai-command-center.css?v=2') === 1,
  'dashboard/workspace must each contain exactly one versioned AI stylesheet reference'
);
gate(
  /const CACHE_NAME = 'acpm-v144';/.test(sw)
    && occurrences(sw, './ai-attention.js?v=1') === 1
    && occurrences(sw, './ai-command-center.js?v=3') === 1
    && occurrences(sw, './assets/brand/ai-command-center.css?v=2') === 1,
  'service-worker cache name/assets are stale, missing, or duplicated'
);
gate(
  !/(?:from\s+['"]openai|import\s*\(['"]openai|cdn[^'"\s]*openai|unpkg[^'"\s]*openai)/i.test(source + attention),
  'browser module must not import an OpenAI/provider SDK'
);
gate(
  !/\.ref\s*\(\s*['"`]\/?ai\/[^'"`]+['"`]\s*\)\s*\.(?:set|update|remove|push|transaction)\s*\(/s.test(source),
  'browser module must not write beneath /ai'
);
gate(!/['"`]\/?ai\/config(?:\/|['"`])/.test(source), 'browser module must not read /ai/config');
gate(
  /getAccessibleProjectSnapshots/.test(source)
    && !/\.ref\s*\(\s*['"`]\/?projects(?:\/|['"`])/.test(source)
    && !/(?:firebase|database\s*\(|\.ref\s*\()/.test(attention),
  'deterministic attention must reuse authorized Office snapshots without Firebase reads or listeners'
);
gate(
  /destinationTabs\s*=\s*\{\s*attendance:\s*'labor', task:\s*'tasks', materials:\s*'materials', issue:\s*'defects', project:\s*'dashboard'\s*\}/.test(source)
    && /DESTINATIONS:\s*Object\.freeze\(\['attendance', 'task', 'materials', 'issue', 'project'\]\)/.test(attention),
  'attention navigation must use explicit model and UI allowlists'
);
gate(
  /detectedBy:\s*'deterministic'/.test(attention)
    && /Unresolved attendance/.test(attention)
    && !/Out of Stock|stock shortage/i.test(attention),
  'deterministic model must identify its source, preserve unresolved attendance, and avoid stock claims'
);
gate(
  !/(?:evidence|reference|ref)\s*\.\s*path[\s\S]{0,160}(?:database\(\)|\.ref\s*\()/i.test(source)
    && !/(?:database\(\)|\.ref\s*\()[\s\S]{0,160}(?:evidence|reference|ref)\s*\.\s*path/i.test(source),
  'browser module must not fetch arbitrary evidence paths'
);
gate(
  /MANAGEMENT_ROLES\s*=\s*\['boss', 'owner', 'admin', 'pm'\]/.test(source)
    && !/MANAGEMENT_ROLES[^\n]*['"]apm['"]/.test(source),
  'browser role gate must allow only management roles and exclude APM'
);
gate(
  /db\.ref\('ai\/uiStatus'\)\.once\('value'\)/.test(source)
    && /uiEnabled !== true/.test(source)
    && /removeNavigation\(\);[\s\S]{0,80}removeView\(\)/.test(source),
  'uiStatus gate must be a fail-closed one-time read'
);
gate(
  /function initialize\(/.test(source)
    && /function open\(/.test(source)
    && /function close\(/.test(source)
    && /function cleanup\(/.test(source)
    && /function refresh\(/.test(source),
  'required initialize/open/close/cleanup/refresh lifecycle is incomplete'
);
gate(
  /reference\.off\('value', onValue\)/.test(source)
    && /stopOutputListeners\(\)/.test(source)
    && /listenerCount:\s*state\.listeners\.length/.test(source),
  'bounded listeners must have observable deterministic cleanup'
);
gate(
  (source.match(/limitToLast\(/g) || []).length >= 2
    && /LIMITS\s*=\s*\{\s*runs:\s*100, events:\s*100, findings:\s*60, recommendations:\s*100, decisions:\s*100\s*\}/.test(source),
  'AI output queries must use explicit bounded limits'
);
gate(
  /Decision actions are not yet enabled\./.test(source)
    && !/data-ai-(?:approve|reject|resolve|acknowledge|dismiss)/i.test(source),
  'decision detail must remain read-only'
);
gate(
  ['A_HEALTHY_NO_ISSUES', 'B_ACTIVE_RUNS', 'C_ONE_OPEN_RECOMMENDATION', 'D_TWO_WAITING_DECISIONS',
    'E_UNKNOWN_IMPACTS', 'F_CRITICAL_GROUNDED', 'G_PROVIDER_DEGRADED', 'H_AI_DISABLED']
    .every(name => fixtures.includes(name)),
  'all deterministic A-H synthetic UI scenarios must exist'
);
gate(
  ['Z1_NO_ATTENTION', 'Z2_OVERDUE_TASK', 'Z3_BLOCKED_TASK', 'Z4_UNRESOLVED_ATTENDANCE',
    'Z5_PARTIAL_DELIVERY', 'Z6_OPEN_SITE_ISSUE', 'Z7_AGING_SITE_ISSUE', 'Z8_MULTIPLE_PROJECTS',
    'Z9_PROVIDER_OFF_MONITORING', 'Z10_AI_DECISION_AND_ATTENTION'].every(name => fixtures.includes(name)),
  'all ten zero-budget UI scenarios must exist'
);
gate(
  (spec.match(/\btest\('/g) || []).length === 33
    && /PM browser never attempts \/ai\/config read/.test(spec),
  'Playwright suite must contain the required 33 Command Center checks'
);
gate(
  fs.existsSync(qaPath)
    && fs.existsSync(path.join(root, 'docs', 'ai', 'AI_COMMAND_CENTER_ARCHITECTURE.md'))
    && fs.existsSync(zeroBudgetDocPath),
  'Command Center QA and architecture documentation must exist'
);

if (failures.length) {
  console.error('AI Command Center static QA failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`AI Command Center static QA passed (${gates} gates).`);
console.log('Verified: assets/cache, fail-closed role and uiStatus gating, no provider SDK/config read/AI writes/evidence fetch, snapshot-only deterministic detection, allowlisted navigation, bounded detachable AI listeners, read-only decisions, A-H and zero-budget fixtures, and 33 browser checks.');
