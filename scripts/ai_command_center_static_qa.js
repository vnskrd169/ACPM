'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'ai-command-center.js');
const attentionPath = path.join(root, 'ai-attention.js');
const v2ModelPath = path.join(root, 'ai-command-center-v2.js');
const stylePath = path.join(root, 'assets', 'brand', 'ai-command-center.css');
const dashboardPath = path.join(root, 'dashboard.html');
const workspacePath = path.join(root, 'workspace.html');
const swPath = path.join(root, 'sw.js');
const fixturePath = path.join(root, 'tests', 'e2e', 'ai-command-center-fixtures.ts');
const specPath = path.join(root, 'tests', 'e2e', 'ai-command-center.spec.ts');
const v2SpecPath = path.join(root, 'tests', 'e2e', 'ai-command-center-v2.spec.ts');
const qaPath = path.join(root, 'docs', 'qa', 'QA_AI_COMMAND_CENTER_UI.md');
const zeroBudgetDocPath = path.join(root, 'docs', 'ai', 'AI_ZERO_BUDGET_MODE.md');
const humanDecisionDocPath = path.join(root, 'docs', 'ai', 'AI_HUMAN_DECISIONS.md');
const actionDraftDocPath = path.join(root, 'docs', 'ai', 'AI_ACTION_DRAFTS.md');
const v2DocPath = path.join(root, 'docs', 'ai', 'AI_COMMAND_CENTER_V2.md');
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
const v2Model = read(v2ModelPath);
const styles = read(stylePath);
const dashboard = read(dashboardPath);
const workspace = read(workspacePath);
const sw = read(swPath);
const fixtures = read(fixturePath);
const spec = read(specPath);
const v2Spec = read(v2SpecPath);

gate(Boolean(source && attention && v2Model && styles), 'AI Command Center, attention/V2 model, or stylesheet is missing');
gate(
  occurrences(dashboard, 'ai-attention.js?v=2') === 1
    && occurrences(workspace, 'ai-attention.js?v=2') === 1
    && occurrences(dashboard, 'ai-command-center-v2.js?v=1') === 1
    && occurrences(workspace, 'ai-command-center-v2.js?v=1') === 1
    && occurrences(dashboard, 'ai-command-center.js?v=9') === 1
    && occurrences(workspace, 'ai-command-center.js?v=9') === 1
    && dashboard.indexOf('ai-attention.js?v=2') < dashboard.indexOf('ai-command-center-v2.js?v=1')
    && dashboard.indexOf('ai-command-center-v2.js?v=1') < dashboard.indexOf('ai-command-center.js?v=9')
    && workspace.indexOf('ai-attention.js?v=2') < workspace.indexOf('ai-command-center-v2.js?v=1')
    && workspace.indexOf('ai-command-center-v2.js?v=1') < workspace.indexOf('ai-command-center.js?v=9'),
  'dashboard/workspace must each contain exactly one versioned AI browser module reference'
);
gate(
  occurrences(dashboard, 'assets/brand/ai-command-center.css?v=7') === 1
    && occurrences(workspace, 'assets/brand/ai-command-center.css?v=7') === 1,
  'dashboard/workspace must each contain exactly one versioned AI stylesheet reference'
);
gate(
  /const CACHE_NAME = 'acpm-v150';/.test(sw)
    && occurrences(sw, './ai-attention.js?v=2') === 1
    && occurrences(sw, './ai-command-center-v2.js?v=1') === 1
    && occurrences(sw, './ai-command-center.js?v=9') === 1
    && occurrences(sw, './assets/brand/ai-command-center.css?v=7') === 1,
  'service-worker cache name/assets are stale, missing, or duplicated'
);
gate(
  !/(?:from\s+['"]openai|import\s*\(['"]openai|cdn[^'"\s]*openai|unpkg[^'"\s]*openai)/i.test(source + attention + v2Model),
  'browser module must not import an OpenAI/provider SDK'
);
gate(
  !/\.ref\s*\(\s*['"`]\/?ai\/[^'"`]+['"`]\s*\)\s*\.(?:set|update|remove|push|transaction)\s*\(/s.test(source + v2Model),
  'browser module must not write beneath /ai'
);
gate(!/['"`]\/?ai\/config(?:\/|['"`])/.test(source + v2Model), 'browser module must not read /ai/config');
gate(
  /getAccessibleProjectSnapshots/.test(source)
    && !/\.ref\s*\(\s*['"`]\/?projects(?:\/|['"`])/.test(source)
    && !/(?:firebase|database\s*\(|\.ref\s*\()/.test(attention + v2Model),
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
  /function buildDailyBrief\(/.test(attention)
    && /lines:\s*\['Everything looks on track\.', 'No operational issues currently need your attention\.'\]/.test(attention)
    && /lines\.slice\(0, 6\)/.test(attention)
    && /!hasUnreportedAttention && summaries\.some/.test(attention),
  'Daily Brief must be deterministic, preserve the exact calm state, cap at six lines, and guard its calm remainder'
);
gate(
  /Deterministic daily brief/.test(source)
    && /Rule-based · no AI generation/.test(source)
    && /ACPMAttention\.buildDailyBrief/.test(source)
    && /dataset\.detectedBy = brief\.detectedBy/.test(source),
  'Daily Brief UI must clearly distinguish rule-based wording from AI-generated output'
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
    && /LIMITS\s*=\s*\{\s*runs:\s*100, events:\s*100, findings:\s*60, recommendations:\s*100, decisions:\s*100, actionDrafts:\s*100, actionDraftEvents:\s*100\s*\}/.test(source),
  'AI output queries must use explicit bounded limits'
);
gate(
  /httpsCallable\('submitAiDecision'\)/.test(source)
    && /function setDecisionSubmitting\(/.test(source)
    && /No business action was performed/.test(source)
    && !/data-ai-(?:approve-purchase|update-task|change-schedule|send-message|create-po)/i.test(source),
  'decision workflow must use only the server callable, lock duplicate UI submission, and preserve the human-intent boundary'
);
gate(
  /httpsCallable\('reviewAiActionDraft'\)/.test(source)
    && /function setActionDraftSubmitting\(/.test(source)
    && /Reviewed — not executed/.test(source)
    && /data-ai-draft-action="review"/.test(source)
    && /data-ai-draft-action="cancel"/.test(source)
    && !/data-ai-draft-action="(?:execute|send|create-po|create-task|apply|approve-purchase|update-schedule)"/i.test(source),
  'action drafts must use the reviewed callable, expose review/cancel only, and label review as not executed'
);
gate(
  /function mutationWorkflowsAvailable\(\)[\s\S]{0,100}window\.ACPM_IS_STAGING === true/.test(source)
    && /data-ai-production-read-only/.test(source)
    && /if \(!mutationWorkflowsAvailable\(\)\) return;/.test(source),
  'Production must render decisions and action drafts read-only and guard callable submission paths'
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
    'Z9_PROVIDER_OFF_MONITORING', 'Z10_AI_DECISION_AND_ATTENTION', 'Z11_DAILY_BRIEF',
    'Z12_PROVIDER_OFF_DECISIONS', 'Z13_ACTION_DRAFTS', 'Z14_PROVIDER_OFF_ACTION_DRAFTS'].every(name => fixtures.includes(name)),
  'all fourteen zero-budget and action-draft UI scenarios must exist'
);
gate(
  (spec.match(/\btest\('/g) || []).length === 57
    && (spec.match(/test\('[^']*Daily Brief/g) || []).length === 3
    && (spec.match(/test\('[^']*Human decision workflow/g) || []).length === 12
    && (spec.match(/test\('[^']*Action Draft workflow/g) || []).length === 9
    && /PM browser never attempts \/ai\/config read/.test(spec),
  'Playwright suite must contain 57 Command Center checks, including Daily Brief, human-decision, and nine action-draft checks'
);
gate(
  /Company Pulse/.test(source)
    && /AI Team/.test(source)
    && /Intelligence Timeline/.test(source)
    && /Ask Command Center/.test(source)
    && /Operations Attention/.test(source),
  'V2 hierarchy must expose Company Pulse, AI Team, Activity, Ask, and Operations Attention'
);
gate(
  /SUPPORTED_INTENTS\s*=\s*Object\.freeze/.test(v2Model)
    && ['company_priority', 'project_attention', 'blocked_tasks', 'attendance_unresolved',
      'partial_deliveries', 'recent_changes', 'waiting_decisions', 'action_drafts']
      .every(intent => v2Model.includes(`'${intent}'`)),
  'V2 deterministic query engine must publish the reviewed finite intent set'
);
gate(
  /generatedBy:\s*generatedBy/.test(v2Model)
    && /generatedBy:\s*'deterministic'/.test(v2Model)
    && /That question requires advanced AI analysis, which is not configured in the current pilot\./.test(v2Model),
  'Ask answers must distinguish deterministic/AI provenance and fail safely for unsupported questions'
);
gate(
  /function buildCompanyPulse\(/.test(v2Model)
    && /function buildAiTeam\(/.test(v2Model)
    && /function buildProjectIntelligence\(/.test(v2Model)
    && /function normalizeTimeline\(/.test(v2Model)
    && /function buildHandoffs\(/.test(v2Model),
  'V2 normalized presentation models are incomplete'
);
gate(
  ['PM Agent', 'Planning Monitor', 'Materials Monitor', 'Site / QA Monitor'].every(name => v2Model.includes(name))
    && /item\.status === 'running'/.test(v2Model)
    && /status = 'ANALYZING'/.test(v2Model)
    && /status = 'NOT_CONFIGURED'/.test(v2Model),
  'AI Team must include four agents and derive working states only from real active runs/configuration'
);
gate(
  /relationshipIds:\s*linksFrom/.test(v2Model)
    && /explicit:\s*true/.test(v2Model)
    && /No explicit handoff chain recorded/.test(source),
  'agent handoffs must require explicit stored relationships and preserve an independent-record state'
);
gate(
  !/(?:healthPercent|riskPercent|scheduleConfidence|financialExposure|completionScore)/.test(v2Model + source)
    && /No action has executed/.test(v2Model)
    && /Read-only answer\. No business action was created or changed\./.test(source),
  'V2 must not invent health/risk metrics or cross the no-execution boundary'
);
gate(
  (v2Spec.match(/\btest\('/g) || []).length === 17
    && /APM access remains denied/.test(v2Spec)
    && /unsupported question returns/.test(v2Spec)
    && /mobile layout/.test(v2Spec)
    && /document overflow/.test(v2Spec),
  'V2 Playwright suite must contain the seventeen focused security, query, hierarchy, responsive, and Production capability checks'
);
gate(
  fs.existsSync(qaPath)
    && fs.existsSync(path.join(root, 'docs', 'ai', 'AI_COMMAND_CENTER_ARCHITECTURE.md'))
    && fs.existsSync(zeroBudgetDocPath)
    && fs.existsSync(humanDecisionDocPath)
    && fs.existsSync(actionDraftDocPath)
    && fs.existsSync(v2DocPath),
  'Command Center QA and architecture documentation must exist'
);

if (failures.length) {
  console.error('AI Command Center static QA failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`AI Command Center static QA passed (${gates} gates).`);
console.log('Verified: V2 hierarchy/query models, assets/cache, fail-closed role and uiStatus gating, no provider SDK/config read/direct AI writes/evidence fetch, snapshot-only deterministic detection, truthful agent states, explicit-link-only handoffs, Production read-only decision/draft controls, callable-only Staging workflows, allowlisted navigation, bounded detachable AI listeners, and 74 focused browser checks.');
