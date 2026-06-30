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

if (!fs.existsSync(firebaseJsonPath)) {
  const firebaseJson = {
    database: {
      rules: 'database.rules.json'
    }
  };
  fs.writeFileSync(firebaseJsonPath, `${JSON.stringify(firebaseJson, null, 2)}\n`);
}

if (!fs.existsSync(firebasercPath)) {
  const firebaserc = {
    projects: {
      default: 'acpm-project-system'
    }
  };
  fs.writeFileSync(firebasercPath, `${JSON.stringify(firebaserc, null, 2)}\n`);
}

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
