'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
let gates = 0;

function gate(condition, message) {
  gates += 1;
  if (!condition) failures.push(message);
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

const apm = read('apm-workspace-vnext.js');
const auth = read('auth.js');
const main = read('main.js');
const labor = read('labor.js');
const materials = read('materials.js');
const tasks = read('tasks.js');
const payrollMath = read('payroll-math.js');
const style = read('style.css');
const dashboard = read('dashboard.html');
const workspace = read('workspace.html');
const sw = read('sw.js');
const docs = read('docs/ux/APM_WORKSPACE_VNEXT.md');

gate(
  occurrences(dashboard, 'apm-workspace-vnext.js?v=1') === 1
    && occurrences(workspace, 'apm-workspace-vnext.js?v=1') === 1
    && occurrences(sw, './apm-workspace-vnext.js?v=1') === 1,
  'APM vNext module must load and be cached exactly once'
);
gate(/const CACHE_NAME = 'acpm-v149';/.test(sw), 'APM release must use acpm-v149');
gate(/function isApm\(\)/.test(apm) && /if \(!isApm\(\)\) return false;/.test(apm), 'APM workspace rendering must fail closed by role');
gate(/renderApmHome/.test(main) && /renderApmProjectHome/.test(main), 'dashboard and project home must route through APM vNext');
gate(/Needs attention/.test(apm) && /Everything is on track/.test(apm), 'home must provide exception and calm states');
gate(/Attendance/.test(apm) && /Material Request/.test(apm) && /Site Update/.test(apm) && /Tasks/.test(apm), 'daily quick actions must be present');
gate(!/<[^>]+id="tab_tasks"[^>]+data-feature-visible="extras"/.test(dashboard) && !/<[^>]+id="tab_tasks"[^>]+data-feature-visible="extras"/.test(workspace), 'Tasks must be a primary APM workspace tab');
gate(/_apmMoreExpanded/.test(auth) && /_apmMoreExpanded/.test(main), 'APM More state must remain session-only');
gate(/unmarked:\s*\{\s*label: 'Unmarked'/.test(payrollMath), 'attendance contract must include explicit Unmarked');
gate(/if \(status === 'unmarked'\)[\s\S]{0,180}\.set\(null\)/.test(labor), 'selecting Unmarked must clear rather than persist attendance');
gate(/if \(existing && existing.status && existing.status !== 'unmarked'\) return;/.test(labor), 'Mark All Present must preserve already-recorded attendance');
gate(/Recorded/.test(labor) && /Mark All Present/.test(labor), 'daily attendance controls must be present');
gate(/Stock not verified/.test(materials) && !/Out of Stock/i.test(materials), 'materials must use honest unverified-stock language');
gate(/Today/.test(tasks) && /Upcoming/.test(tasks) && /Blocked/.test(tasks) && /For Verification/.test(tasks) && /Completed \/ History/.test(tasks), 'daily task filters and explicit history access must exist');
gate(/<details class="apm-advanced-details">/.test(apm) && /apm-materials-advanced/.test(materials), 'advanced project and material information must use progressive disclosure');
gate(/\.role-apm/.test(style) && /overflow-x:\s*auto/.test(style), 'APM presentation must be role-scoped and wide records scroll intentionally');
gate(!/["'`]\/?ai\//.test(apm), 'APM workspace must not read or write the AI namespace');
gate(!/firebase\.database|\.ref\s*\(/.test(apm), 'APM presentation module must not create a parallel database access path');
gate(/No database or storage rules are changed/.test(docs) && /Intentionally deferred/.test(docs), 'APM vNext design and role boundaries must be documented');

if (failures.length) {
  console.error('APM workspace static QA failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({ result: 'PASS', gates }, null, 2));
