# ACPM Changelog

## v0.9.0-rc6 (Full Regression Verification) - 2026-08-10

### Verified release signature

- Full regression run against the RC6 working tree, all green:
  - Playwright Office/PMOS suite: **24/24 PASS**.
  - Unit suites (core, pagination, subscription-manager, labor-smoke,
    payroll-math): **74/74 PASS**.
  - Emulator-backed rules: production roles 13/13, payroll financial 13/13,
    PMOS database 24/24 (run via `firebase emulators:exec`; a bare `npm
    test` cannot reach the emulator on port 18200).
  - Storage rules suite remains `describe.skip` — documented pinned
    `cloud-storage-rules-runtime-v1.1.3` limitation compiling cross-service
    `database()` access, not an app defect.
  - Static gates 9/9 PASS: rc1_static, pwa_cache, rc1_docs, pmos_release,
    historical_integrity, ui_workflow, pm_apm_task_workflow, dev_shell,
    environment, plus firebase_rules_gate.
  - JS syntax checks clean; `database.rules.json` and `firebase.json` parse.
- Status docs refreshed to the RC6/v134 baseline: `CURRENT_TASK.md` and
  `PMOS_CURRENT_STATUS.md` now document cache `acpm-v134`, PMOS caches
  `pmos-cache-v4` / `acpm-pmos-v4`, `labor.js?v=97`, `payroll-math.js?v=2`,
  the dev shell, and the verified regression evidence.

## v0.9.0-rc6 (Payroll Integrity + Local Dev Shell) - 2026-08-09

### Financial integrity (unit + emulator verified)
- Added double-save idempotency guard in `labor.js` and a pure
  `isPayrollPeriodAlreadySaved()` helper in `payroll-math.js`: calling
  compilePayroll twice for the same period never consumes the same cash
  advance twice. Regression tests cover repeat compile, refresh, and modal
  reopen paths (`tests/pmos/payroll-math.test.ts`, `tests/pmos/labor-smoke.test.ts`).
- Hardened `database.rules.json` released-payroll protection: field-level
  `.validate` immutability on finalized/released payroll logs, cash advance
  deduction fields, and historical rate snapshots; APM app-level guard added
  in `labor.js`. Verified in the emulator suite
  `tests/pmos/rules-financial.test.ts` (13 checks).
- Full test suite: 124 passed / 0 failed / 10 skipped (storage suite
  documented runtime limitation of the Firebase emulator, not app code).

### Local Dev Shell (debugging aid, never deployed)
- Added `dev-shell.html` + `dev/dev-bypass.js` — a localhost-only, `?dev=1`
  / session-flag-gated bypass of the login wall that points the app at a
  local RTDB emulator (port 18300) seeded via `dev/seed-dev-data.js`.
  Fail-closed: on any remote host it does nothing; `dev/**` and
  `dev-shell.html` are excluded from hosting deploys (`firebase.json` ignore)
  and enforced by `scripts/dev_shell_static_qa.js`.
- End-to-end dev-shell smoke verified in a real browser: launcher, mock
  boss session, emulator data (workers/attendance/advances/payroll log),
  DEV SHELL badge, no login wall.

### Release ops
- Cache version bumps: `sw.js` acpm-v133 → acpm-v134, PMOS workers
  pmos-cache-v3 → v4, shell label acpm-pmos-v3 → v4; `labor.js?v=97`,
  `payroll-math.js?v=2`. Static gates updated and passing.

## v0.9.0-rc5 (Payroll Financial Hardening) - 2026-08-08

### Financial integrity (verified by unit tests)
- Centralized all payroll formulas in a new pure, unit-tested module
  `payroll-math.js` (gross pay, cash advance eligibility/deduction, rate
  resolution). `labor.js` now delegates to it — one source of truth.
- Replaced the 20%-of-gross cash advance amortization cap with the verified
  rule: deduct the exact eligible balance, capped at the worker's gross pay so
  NET never goes negative; the unpaid remainder carries forward.
- Proven scenarios A-D (NET ₱5,000 / ₱3,000 / ₱0-with-carry / released-rate
  immutability) plus no-double-deduction and multi-advance budget tests in
  `tests/pmos/payroll-math.test.ts`.
- RFP for a compiled week now uses the verified archived NET payroll log
  (snapshot rates + net amounts); uncompiled weeks show a PROVISIONAL GROSS
  warning. A later rate edit cannot change a released RFP.
- Archived attendance history now displays the snapshot rate instead of the
  current live rate (released payroll stays ₱850 even if the rate is later
  edited to ₱900).

### UX
- Worker editing (name / trade / rate) via an edit modal, with a note that
  released payroll archives are immutable.
- Safe deactivate + reactivate workflow; inactive workers are listed in the
  roster with Reactivate actions and status history preserved.
- Payroll review modal now shows a per-worker Gross / Cash Advance Deduction /
  NET table, an explicit Other Deductions line, and warnings for missing rates,
  carried-forward balances, and negative NET.
- Compiled-week badge on the period indicator; negative manual deductions are
  rejected.

### PWA
- Cache `acpm-v133`, `style.css?v=108`, `payroll-math.js?v=1`, `labor.js?v=96`;
  static QA gates updated to match.

## v0.9.0-rc4 (Isolated Staging) - 2026-07-31

### Release Safety
- Added hostname-selected Production and Staging Firebase configurations.
- Created an isolated QA Firebase project and Realtime Database so test records
  cannot modify live construction data.
- Made local development use Staging by default; local Production access now
  requires `?env=production`.
- Removed the Firebase default project alias and added guarded deployment
  scripts with explicit project IDs.
- Added a persistent `STAGING - TEST DATA` marker and separate staging PWA
  manifests.
- Staging candidate uses `acpm-v132`, `style.css?v=107`,
  `auth.js?v=98`, `main.js?v=106`, `pmos-cache-v3`, and `acpm-pmos-v3`.
- Fixed logout listener cleanup so Firebase project/module subscriptions detach
  before the signed-out route transition.
- Added reproducible Staging-only Auth provisioning for Email/Password and
  Google sign-in without changing Production Authentication.
- Verified the isolated Staging lifecycle against real Firebase, then promoted
  the exact v132 Hosting build to Production through the guarded release path.

## v0.9.0-rc3 (Office + PMOS Operations) - 2026-07-29

### Workflow
- Added the canonical six-state task lifecycle with PM verification.
- Unified ACPM Office and PMOS task records under the project task path.
- Added Mission Board operational priorities and task/activity history.
- Made Project Manager a company-wide operations role and kept APM assigned-only.
- Restricted PM assignment controls to APM project assignments.

### Security
- Tightened active-role and project-assignment checks across project and legacy
  PMOS paths.
- Prevented PM project archive and APM lifecycle changes.
- Added a production database rules emulator suite with 13 passing scenarios.
- Kept Foreman, Safety, and Viewer disabled for RC1.

### Routing and PWA
- Replaced the legacy `index.html` application copy with a compatibility redirect.
- Preserved workspace project selection across refresh.
- Prevented E2E service-worker updates from reloading tests mid-run.
- Deployed production cache for this milestone was `acpm-v130`.

### Quality
- Full ACPM Office/PMOS Playwright suite: 24/24 PASS.
- Fixed malformed dashboard panel boundaries that hid Team Admin inside
  project modules, and added a PM Project Assignments regression test.
- Fixed dashboard warning and active-project cards displaying generated HTML
  as text, and added a browser regression assertion for rendered attention rows.
- Fixed light-theme report cards turning black on hover and aligned project
  health names with the active theme text color.
- PMOS unit suite, static workflow gates, Firebase rule parse, and Firebase CLI
  rules dry-run included in the release gate.
- Added `TASKS_SCHEMA.md` and `QA_TASKS.md`.

## v0.9.0-rc2 (Production Hardening) — 2026-07-25

### Production Hardening
- Fixed auth.js syntax error: `doLogin()` marked `async` with `finally` block for button state restoration
- Added `handleAuthFormSubmit()` for correct Enter-to-submit behavior in login/request-access contexts
- Wrapped login form in `<form>` element, added `aria-label` to all auth inputs
- Updated `.gitignore` with service-account and env file exclusion patterns
- Removed `nul` reserved filename from worktree

### Accessibility
- Added ~30 `aria-label` attributes to static form inputs in `index.html`
- Added `aria-label` to textareas across site log, equipment, and compliance panels
- Replaced deprecated `apple-mobile-web-app-capable` meta with `mobile-web-app-capable` on 4 HTML files

### Quality
- Fixed trailing whitespace in `style.css` and `CURRENT_TASK.md`
- All QA scripts pass: rc1_static_gate, pwa_cache_static_qa, rc1_docs_static_qa
- Browser smoke test: PASS — login renders, Ctrl+K works, responsive layouts, no JS runtime errors

### Documentation
- Created `docs/PRODUCTION_RUNBOOK.md` — deployment, rollback, emergency procedures
- Created `docs/PILOT_PLAN.md` — controlled office pilot scope, criteria, training
- Updated `CURRENT_TASK.md` with full Production Hardening status

### PWA
- Bumped cache to `acpm-v126`
- Added `ux-palette.js?v=1` to service worker cache list
- Version consistency across `index.html`, `dashboard.html`, `workspace.html`, `login.html`

## v0.9.0-rc1 — 2026-07

- Initial RC1 deployment with core engineering, UI design system, UX optimization
- Focused live QA for onboarding, notifications, Team Admin
- PMOS field shell with Google Drive photo upload configuration
- PWA cache: `acpm-v125`
