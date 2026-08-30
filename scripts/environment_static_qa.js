const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const parse = file => JSON.parse(read(file));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function main() {
  const environment = read('environment.js');
  const main = read('main.js');
  const firebaseRc = parse('.firebaserc');
  const productionDeploy = read('scripts/deploy-production.ps1');
  const stagingDeploy = read('scripts/deploy-staging.ps1');
  const pages = ['login.html', 'dashboard.html', 'workspace.html', 'pmos/index.html'];

  assert(environment.includes("projectId: 'acpm-project-system'"), 'production project config must exist');
  assert(environment.includes("projectId: 'acpm-project-system-qa'"), 'staging project config must exist');
  assert(environment.includes('acpm-project-system-qa-default-rtdb'), 'staging must use its isolated database');
  assert(environment.includes("if (productionHosts.has(hostname)) environmentName = 'production'"), 'production hostname must be locked to production');
  assert(environment.includes("environmentName = stagingHosts.has(hostname) || isLocal ? 'staging' : 'production'"), 'local development must default to staging');
  assert(main.includes('const firebaseConfig = window.ACPM_FIREBASE_CONFIG;'), 'main.js must use the environment-selected Firebase config');
  assert(!main.includes('AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA'), 'main.js must not hardcode production Firebase config');

  pages.forEach(file => {
    const html = read(file);
    const prefix = file.startsWith('pmos/') ? '../' : '';
    const environmentRef = `<script src="${prefix}environment.js?v=1"></script>`;
    assert(html.includes(environmentRef), `${file} must load environment.js`);
    assert(html.indexOf(environmentRef) < html.indexOf(`${prefix}main.js?v=112`), `${file} must load environment.js before main.js`);
  });

  assert(firebaseRc.projects.production === 'acpm-project-system', 'production alias must target the live project');
  assert(firebaseRc.projects.staging === 'acpm-project-system-qa', 'staging alias must target the QA project');
  assert(!Object.prototype.hasOwnProperty.call(firebaseRc.projects, 'default'), 'Firebase config must not have an unsafe default project');
  assert(stagingDeploy.includes("$ProjectId = 'acpm-project-system-qa'"), 'staging deploy must pin the QA project');
  assert(!stagingDeploy.includes('acpm-project-system '), 'staging deploy must not contain the production project target');
  assert(productionDeploy.includes("$ProjectId = 'acpm-project-system'"), 'production deploy must pin the live project');
  assert(productionDeploy.includes('[switch]$ConfirmProduction'), 'production deploy must require explicit confirmation');
  assert(productionDeploy.includes('if (-not $ConfirmProduction)'), 'production deploy must fail closed without confirmation');
  assert(parse('manifest-staging.json').start_url === './login.html', 'staging app manifest must open login');
  assert(parse('pmos/pmos-manifest-staging.json').start_url === './index.html', 'staging PMOS manifest must open scoped shell');

  console.log(JSON.stringify({
    result: 'PASS',
    productionProject: 'acpm-project-system',
    stagingProject: 'acpm-project-system-qa',
    checks: [
      'isolated Firebase configurations',
      'hostname-locked production selection',
      'staging-default local development',
      'environment script order',
      'no Firebase default deploy alias',
      'guarded production deployment'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
}
