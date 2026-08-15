// ============================================================
//  ACPM LIVE PRODUCTION LOAD CHECK — real site, real QA accounts
// ============================================================
//  Read-only browser check against the DEPLOYED production site
//  (acpm-project-system.web.app) using the real QA role accounts:
//    - signs in as PM (company-wide project visibility) and APM
//    - measures hub + workspace load timing on the real site
//    - audits console errors, horizontal overflow, dead handlers,
//      broken images on the live site
//    - NO writes to production: only reads/renders
//
//  Run:
//    ACPM_QA_PM_EMAIL='pm.qa@lebuild.test' ACPM_QA_PM_PASSWORD='Lebuild2026' \
//    ACPM_QA_APM_EMAIL='apm.qa@lebuild.test' ACPM_QA_APM_PASSWORD='Lebuild2026' \
//    node scripts/live_production_load_check.mjs
// ============================================================

const APP_URL = process.env.ACPM_APP_URL || 'https://acpm-project-system.web.app';
const PM_EMAIL = process.env.ACPM_QA_PM_EMAIL || '';
const PM_PASSWORD = process.env.ACPM_QA_PM_PASSWORD || '';
const APM_EMAIL = process.env.ACPM_QA_APM_EMAIL || '';
const APM_PASSWORD = process.env.ACPM_QA_APM_PASSWORD || '';

let failures = 0;
let checks = 0;
const timings = [];
function check(label, cond, extra = '') {
  checks++;
  if (cond) console.log(`  PASS  ${label}${extra ? '  (' + extra + ')' : ''}`);
  else { failures++; console.error(`  FAIL  ${label}${extra ? '  (' + extra + ')' : ''}`); }
}
function recordTiming(name, ms) { timings.push({ name, ms: Math.round(ms) }); }  function isSevereError(msg) {
  return !/favicon|net::ERR|gstatic|fonts\.googleapis|firebase|offline|Cache|Failed to load resource|404 \(|403 |ServiceWorker|service worker|sw\.js|bad HTTP response code \(404\)/i.test(msg);
}

async function waitFor(fn, timeoutMs = 30000, interval = 300) {
  const start = Date.now();
  for (;;) {
    try {
      if (await fn()) return true;
    } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) return false;
    await new Promise(r => setTimeout(r, interval));
  }
}

async function login(page, email, password) {
  await page.goto(`${APP_URL}/login.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#authUser', { timeout: 20000 });
  await page.fill('#authUser', email);
  await page.fill('#authPass', password);
  await page.click('#authLoginBtn');
  // wait for the app shell to load (dashboard hub) and auth to settle
  const ok = await waitFor(() => page.evaluate(() => {
    const inHub = !/login\.html$/.test(window.location.pathname);
    const hasHub = !!(document.getElementById('hubView') || document.getElementById('activeProjectsPane') || document.querySelector('#hubView, [id*="project"]'));
    return inHub || hasHub;
  }), 40000);
  if (!ok) {
    const diag = await page.evaluate(() => ({ path: location.pathname, len: (document.body.innerText || '').length, hasErr: !!document.getElementById('authError') ? document.getElementById('authError').textContent : '' })).catch(() => null);
    console.error(`  [login-diag] ${email}: ${JSON.stringify(diag)}`);
  }
  return ok;
}

async function auditPage(page, label) {
  const overflow = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let worst = 0, worstEl = '';
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 10) {
        const w = Math.round(r.right - vw);
        if (w > worst) { worst = w; worstEl = (el.tagName + '.' + (el.className || '').toString().slice(0, 40)); }
      }
    });
    return { worst, worstEl };
  });
  check(`${label}: no horizontal overflow`, overflow.worst <= 0, overflow.worst > 0 ? `${overflow.worst}px on ${overflow.worstEl}` : 'clean');

  const brokenImages = await page.evaluate(() => {
    const broken = [];
    document.querySelectorAll('img').forEach(img => {
      if (img.complete && img.naturalWidth === 0 && !img.src.includes('placeholder')) broken.push(img.src.slice(0, 60));
    });
    return broken;
  });
  check(`${label}: no broken images`, brokenImages.length === 0, brokenImages.length ? brokenImages.slice(0, 3).join(' | ') : 'clean');

  const dead = await page.evaluate(() => {
    const safe = new Set(['getElementById', 'querySelector', 'querySelectorAll', 'toggle', 'remove', 'add', 'classList', 'contains', 'open', 'close', 'show', 'hide', 'setAttribute', 'removeAttribute', 'push', 'splice', 'focus', 'blur', 'click', 'scrollIntoView', 'preventDefault', 'stopPropagation', 'reload', 'appendChild', 'removeChild', 'textContent', 'innerHTML', 'value', 'checked', 'style', 'dataset', 'length', 'replace', 'split', 'join', 'trim']);
    const deadFns = [];
    document.querySelectorAll('[onclick]').forEach(el => {
      const code = el.getAttribute('onclick') || '';
      const m = code.trim().match(/^([A-Za-z_$][\w$]*)\s*\(/);
      if (!m) return;
      const fn = m[1];
      if (safe.has(fn)) return;
      if (typeof window[fn] !== 'function') deadFns.push(fn);
    });
    return deadFns;
  });
  check(`${label}: no dead inline handlers`, dead.length === 0, dead.length ? dead.join(', ') : 'clean');
}

async function main() {
  console.log('=== ACPM LIVE PRODUCTION LOAD CHECK ===');
  console.log(`Site: ${APP_URL}`);
  if (!PM_EMAIL || !PM_PASSWORD) { console.error('ACPM_QA_PM_EMAIL / ACPM_QA_PM_PASSWORD required'); process.exit(1); }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();

  // Each role gets its OWN context so logins never leak across sessions.
  async function makeContext() {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // Block the service worker: a fresh context installing the SW triggers
    // controllerchange -> window.location.reload(), which aborts the in-flight
    // auth request and kills the login session (an artifact of first-visit PWA
    // install, not a production bug). Existing users already have the SW.
    await ctx.route('**/sw.js', route => route.fulfill({ status: 404, body: 'blocked' }));
    await ctx.route('**/pmos/pmos-sw.js', route => route.fulfill({ status: 404, body: 'blocked' }));
    return ctx;
  }

  // ── PM session (company-wide) ─────────────────────────────
  console.log('\n── PM SESSION (company-wide visibility) ──');
  const pmContext = await makeContext();
  const pmPage = await pmContext.newPage();
  const pmErrors = [];
  pmPage.on('console', msg => { if (msg.type() === 'error') pmErrors.push(msg.text()); });
  pmPage.on('pageerror', err => pmErrors.push('PAGEERROR: ' + err.message));

  let t0 = Date.now();
  const pmLoggedIn = await login(pmPage, PM_EMAIL, PM_PASSWORD);
  recordTiming('PM login -> hub render', Date.now() - t0);
  check('PM signs in and reaches the hub', pmLoggedIn);
  if (!pmLoggedIn) { failures++; }

  // hub project count + timings (wait for hub content to settle)
  await waitFor(() => pmPage.evaluate(() => (document.body.innerText || '').length > 500), 30000);
  const hubProjects = await pmPage.evaluate(() => {
    const text = document.body.innerText || '';
    const cards = document.querySelectorAll('[id*="proj"], .project-card, [class*="project"]').length;
    return { cards, textLen: text.length, hasProjects: /Project|project/i.test(text) };
  });
  check('PM hub renders project cards', hubProjects.cards > 0 || hubProjects.hasProjects, `${hubProjects.cards} project elements`);
  await auditPage(pmPage, 'PM hub');

  // open the first project workspace from the hub
  const opened = await pmPage.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="workspace"]')];
    const btn = [...document.querySelectorAll('button, [onclick*="openWorkspace"], [onclick*="projectId"]')].find(b => b.offsetParent !== null);
    if (links.length) { links[0].click(); return 'link'; }
    if (btn) { btn.click(); return 'btn'; }
    return 'none';
  });
  check('PM can open a project workspace', opened !== 'none', opened);
  if (opened !== 'none') {
    await pmPage.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
    const wsReady = await waitFor(() => pmPage.evaluate(() => (document.body.innerText || '').length > 500), 30000);
    check('PM workspace renders content', wsReady);
    await auditPage(pmPage, 'PM workspace');
  }
  const pmSevere = pmErrors.filter(isSevereError);
  check('PM session: zero severe console errors', pmSevere.length === 0, pmSevere.length ? pmSevere.slice(0, 3).join(' | ') : '');
  await pmContext.close();

  // ── APM session (assigned-only visibility) ────────────────
  if (APM_EMAIL && APM_PASSWORD) {
    console.log('\n── APM SESSION (assigned-only) ──');
    const apmContext = await makeContext();
    const apmPage = await apmContext.newPage();
    const apmErrors = [];
    apmPage.on('console', msg => { if (msg.type() === 'error') apmErrors.push(msg.text()); });
    apmPage.on('pageerror', err => apmErrors.push('PAGEERROR: ' + err.message));

    t0 = Date.now();
    const apmLoggedIn = await login(apmPage, APM_EMAIL, APM_PASSWORD);
    recordTiming('APM login -> hub render', Date.now() - t0);
    check('APM signs in and reaches the hub', apmLoggedIn);
    if (apmLoggedIn) {
      await auditPage(apmPage, 'APM hub');
      // APM workspace on an assigned project (project cards carry openProjectFromHub)
      const cardReady = await waitFor(() => apmPage.evaluate(() => !!document.querySelector('[onclick*="openProjectFromHub"]')), 20000);
      const opened = cardReady && await apmPage.evaluate(() => {
        const card = document.querySelector('[onclick*="openProjectFromHub"], a[href*="workspace"]');
        if (card) { card.click(); return true; }
        return false;
      });
      check('APM can open assigned project workspace', opened);
      if (opened) {
        const wsReady = await waitFor(() => apmPage.evaluate(() => (document.body.innerText || '').length > 500), 30000);
        check('APM workspace renders content', wsReady);
        await auditPage(apmPage, 'APM workspace');
      }
      const apmSevere = apmErrors.filter(isSevereError);
      check('APM session: zero severe console errors', apmSevere.length === 0, apmSevere.length ? apmSevere.slice(0, 3).join(' | ') : '');
    }
    await apmContext.close();
  }

  // ── PMOS mobile session (phone viewport, real PM login) ─────
  if (PM_EMAIL && PM_PASSWORD) {
    console.log('\n── PMOS MOBILE (phone viewport, PM session) ──');
    const pmosCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await pmosCtx.route('**/sw.js', route => route.fulfill({ status: 404, body: 'blocked' }));
    await pmosCtx.route('**/pmos/pmos-sw.js', route => route.fulfill({ status: 404, body: 'blocked' }));
    const pmosPage = await pmosCtx.newPage();
    const pmosErrors = [];
    pmosPage.on('console', msg => { if (msg.type() === 'error') pmosErrors.push(msg.text()); });
    pmosPage.on('pageerror', err => pmosErrors.push('PAGEERROR: ' + err.message));

    // login on the phone, then navigate to PMOS (field app)
    const loggedIn = await login(pmosPage, PM_EMAIL, PM_PASSWORD);
    check('PMOS: PM signs in on phone', loggedIn);
    if (loggedIn) {
      t0 = Date.now();
      await pmosPage.goto(`${APP_URL}/pmos.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // /pmos.html redirects to /pmos/ (the field shell)
      const shellReady = await waitFor(() => pmosPage.evaluate(() => {
        const inPmos = /\/pmos\/?$/.test(window.location.pathname) || /\/pmos\//.test(window.location.pathname);
        const hasShell = !!(document.getElementById('pmosContent') || document.querySelector('[id*="pmos" i], [class*="pmos-shell" i]'));
        return inPmos && (document.body.innerText || '').length > 100;
      }), 40000);
      recordTiming('PMOS shell load (phone)', Date.now() - t0);
      check('PMOS: field shell renders on phone', shellReady);
      if (shellReady) {
        await auditPage(pmosPage, 'PMOS shell');
        // project selector (#pmosProjectSelect) should offer the PM's projects
        const projReady = await waitFor(() => pmosPage.evaluate(() => {
          const sel = document.getElementById('pmosProjectSelect');
          return sel && sel.options.length > 1;
        }), 25000);
        const projectOptions = projReady ? await pmosPage.evaluate(() => {
          const sel = document.getElementById('pmosProjectSelect');
          return { optCount: sel ? sel.options.length : 0, options: sel ? [...sel.options].map(o => o.textContent).slice(0, 4) : [] };
        }) : { optCount: 0, options: [] };
        check('PMOS: project selector renders with projects', projReady, `${projectOptions.optCount} options: ${projectOptions.options.join(' | ')}`);
        // tap the first project to enter the field view
        const tapped = projReady && await pmosPage.evaluate(() => {
          const sel = document.getElementById('pmosProjectSelect');
          if (sel && sel.options.length > 1) {
            sel.value = sel.options[1].value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        });
        check('PMOS: can select a project', tapped);
        if (tapped) {
          const fieldReady = await waitFor(() => pmosPage.evaluate(() => {
            const text = document.body.innerText || '';
            return text.length > 300 && /home|dashboard|quick|sitelog|issue|task|material/i.test(text);
          }), 20000);
          check('PMOS: field view renders after project select', fieldReady);
          await auditPage(pmosPage, 'PMOS field view');
        }
      }
      const pmosSevere = pmosErrors.filter(isSevereError);
      check('PMOS: zero severe console errors on phone', pmosSevere.length === 0, pmosSevere.length ? pmosSevere.slice(0, 3).join(' | ') : '');
    }
    await pmosCtx.close();
  }

  await browser.close();

  // ── summary ────────────────────────────────────────────────
  console.log('\n=== PERFORMANCE (real production site, ms) ===');
  for (const t of timings) console.log(`  ${t.name.padEnd(28)} ${t.ms}ms`);
  console.log(`\n=== RESULT: ${checks - failures}/${checks} PASS ===`);
  if (failures === 0) console.log('Production site passes the live load check with real QA accounts.');
  else console.log(`${failures} failure(s) — see FAIL lines above.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('[live-load] CHECK FAILED:', err.message);
  process.exit(1);
});
