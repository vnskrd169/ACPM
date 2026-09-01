const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appHtmlFiles = ['dashboard.html', 'workspace.html'];
const requiredShellFiles = ['./', './index.html', './login.html', './dashboard.html', './workspace.html', './manifest.json'];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function localScripts(html) {
  const rows = [];
  const re = /<script\s+src="([^"]+\.js\?v=\d+)"><\/script>/g;
  let match;
  while ((match = re.exec(html))) {
    if (!/^https?:\/\//.test(match[1])) rows.push(match[1]);
  }
  return rows;
}

function localStyles(html) {
  const rows = [];
  const re = /<link\s+rel="stylesheet"\s+href="([^"]+\.css\?v=\d+)">/g;
  let match;
  while ((match = re.exec(html))) {
    if (!/^https?:\/\//.test(match[1])) rows.push(match[1]);
  }
  return rows;
}

function serviceWorkerAssets(sw) {
  const re = /'(\.\/[^']*)'/g;
  const rows = [];
  let match;
  while ((match = re.exec(sw))) rows.push(match[1]);
  return rows;
}

function main() {
  const manifest = JSON.parse(read('manifest.json'));
  const sw = read('sw.js');
  const mainJs = read('main.js');
  const pages = Object.fromEntries(appHtmlFiles.map(file => [file, read(file)]));
  const indexHtml = read('index.html');
  const loginHtml = read('login.html');
  const assetSet = new Set(serviceWorkerAssets(sw));

  assert(manifest.start_url === './login.html', 'PWA manifest start_url must open login.html');
  assert(JSON.stringify(localStyles(loginHtml)) === JSON.stringify(['style.css?v=114']), 'login.html must include versioned style.css?v=114');
  assert(mainJs.includes("navigator.serviceWorker.register('sw.js')"), 'main.js must register sw.js');
  assert(mainJs.includes('registration.update()'), 'main.js must actively check for service worker updates');
  assert(mainJs.includes("addEventListener('controllerchange'"), 'main.js must reload when a new service worker controls the page');
  assert(JSON.stringify(localScripts(loginHtml)) === JSON.stringify(['environment.js?v=1', 'utils.js?v=87', 'auth.js?v=99', 'main.js?v=112']), 'login.html must include current environment/auth shell scripts');
  assert(indexHtml.includes("window.location.replace('./login.html' + suffix)"), 'legacy index.html must redirect to login.html');
  assert(localScripts(indexHtml).length === 0, 'legacy index.html must not duplicate the private app shell');
  assert(sw.includes("const CACHE_NAME = 'acpm-v151'"), 'service worker cache must be acpm-v151');
  assert(sw.includes('caches.delete(k)'), 'service worker must purge stale caches on activate');
  assert(sw.includes('self.clients.claim()'), 'service worker must claim clients after activation');

  for (const file of requiredShellFiles) {
    assert(assetSet.has(file), `service worker must cache ${file}`);
  }
  for (const script of localScripts(loginHtml)) {
    assert(assetSet.has(`./${script}`), `service worker must cache login shell script ./${script}`);
  }

  const baseline = localScripts(pages[appHtmlFiles[0]]);
  const baselineStyles = localStyles(pages[appHtmlFiles[0]]);
  assert(baseline.length >= 10, 'dashboard.html must include local app scripts with versions');
  assert(JSON.stringify(baselineStyles) === JSON.stringify(['style.css?v=114', 'assets/brand/ai-command-center.css?v=7']), 'dashboard.html must include current versioned styles');
  for (const file of appHtmlFiles) {
    const scripts = localScripts(pages[file]);
    const styles = localStyles(pages[file]);
    assert(JSON.stringify(scripts) === JSON.stringify(baseline), `${file} script versions/order must match dashboard.html`);
    assert(JSON.stringify(styles) === JSON.stringify(baselineStyles), `${file} stylesheet versions/order must match dashboard.html`);
    for (const script of scripts) {
      assert(assetSet.has(`./${script}`), `service worker must cache ./${script}`);
    }
    for (const style of styles) {
      assert(assetSet.has(`./${style}`), `service worker must cache ./${style}`);
    }
  }

  for (const file of ['utils.js', 'auth.js', 'main.js', 'payroll-math.js', 'labor.js', 'materials.js', 'billing.js', 'changeorders.js', 'sitelog.js', 'suppliers.js', 'notifications.js', 'report.js']) {
    const matches = baseline.filter(script => script.startsWith(`${file}?v=`));
    assert(matches.length === 1, `app shell must include one versioned ${file}`);
  }

  console.log(JSON.stringify({
    result: 'PASS',
    cacheName: 'acpm-v151',
    pages: appHtmlFiles,
    scriptCount: baseline.length,
    checks: [
      'manifest opens login.html',
      'login shell scripts are current',
      'service worker registration exists',
      'service worker update/reload path exists',
      'stale caches are purged',
      'versioned stylesheet is cached',
      'dashboard/workspace script versions match',
      'legacy index route redirects without a duplicate app shell',
      'service worker caches every versioned local script',
      'core module scripts are versioned once'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
}
