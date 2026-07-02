const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rulesPath = path.join(root, 'database.rules.json');
const firebaseJsonPath = path.join(root, 'firebase.json');
const firebasercPath = path.join(root, '.firebaserc');

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`${label} is not valid JSON: ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const rules = readJson(rulesPath, 'database.rules.json');
assert(rules && rules.rules, 'database.rules.json must contain a top-level "rules" object.');

const requiredRulePaths = [
  ['rules', 'suppliers'],
  ['rules', 'supplierEvents'],
  ['rules', 'supplierRollups'],
  ['rules', 'globalNotificationEvents'],
  ['rules', 'auditLogs'],
  ['rules', 'supplierAuditLogs'],
  ['rules', 'projects', '$pid', 'auditLogs'],
  ['rules', 'projects'],
  ['rules', 'users']
];

const missing = requiredRulePaths.filter(parts => {
  let cursor = rules;
  for (const part of parts) {
    cursor = cursor && cursor[part];
  }
  return !cursor;
});

if (missing.length) {
  throw new Error(`Missing required rules paths: ${missing.map(parts => parts.join('/')).join(', ')}`);
}

assert(fs.existsSync(firebaseJsonPath), 'firebase.json must exist before RC1 Firebase rules deployment.');
assert(fs.existsSync(firebasercPath), '.firebaserc must exist before RC1 Firebase rules deployment.');

const firebaseJson = readJson(firebaseJsonPath, 'firebase.json');
const firebaserc = readJson(firebasercPath, '.firebaserc');
assert(firebaseJson.database && firebaseJson.database.rules === 'database.rules.json', 'firebase.json must deploy database.rules.json.');
assert(firebaserc.projects && firebaserc.projects.default === 'acpm-project-system', '.firebaserc default project must be acpm-project-system.');

console.log(JSON.stringify({
  result: 'PASS',
  rulesFile: 'database.rules.json',
  helperFiles: ['firebase.json', '.firebaserc'],
  requiredRulePaths: requiredRulePaths.map(parts => parts.join('/')),
  deployCommands: [
    'npm install -g firebase-tools',
    'firebase login',
    'firebase use acpm-project-system',
    'firebase deploy --only database'
  ],
  consoleAlternative: [
    'Firebase Console > Realtime Database > Rules',
    'Paste the contents of database.rules.json',
    'Publish',
    'Rerun: node scripts/suppliers_v1_real_qa.js'
  ]
}, null, 2));
