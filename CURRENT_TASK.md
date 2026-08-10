# ACPM Current Task

## Objective

Ship the ACPM Office + PMOS Field production sprint as one reliable
construction operations system for PM and APM use.

## Current Status

Status: RC6 PAYROLL INTEGRITY + LOCAL DEV SHELL — FULL REGRESSION VERIFIED

Branch: `feature/pmos-official-app` (pushed to origin, 2026-08-10)

Latest production release state (2026-08-10):

- Task transition rules deployed to **Staging + Production** via the guarded
  release paths (commit `6edff0a`); deployed rules byte-identical to local and
  live-verified (Staging role matrix 12/12, Production enforcement probes).
- **PO RFP export** deployed to Production (commit `118545e`); every PO card in
  Materials has a 📋 RFP button (Copy Text + Download PDF) verified live on the
  real Angeles Residence PO-001 (**14/14 PASS**).

Deployed release:

- Service worker: `acpm-v134`
- Stylesheet: `style.css?v=108`
- Office main: `main.js?v=106`
- Auth: `auth.js?v=98`
- Labor: `labor.js?v=98`
- Payroll math: `payroll-math.js?v=2`
- Utils: `utils.js?v=87`
- PMOS: app v3 with task adapter v2, office v4
- PMOS caches: `pmos-cache-v4` and `acpm-pmos-v4`

## Completed Work

### Payroll integrity (RC5 + RC6)
- Centralized all payroll formulas in `payroll-math.js` (gross pay, cash
  advance eligibility/deduction, rate resolution) — one source of truth,
  unit-tested.
- Cash advance deduction uses the verified rule: deduct the exact eligible
  balance, capped at gross pay so NET never goes negative; the unpaid
  remainder carries forward.
- Added a double-save idempotency guard in `labor.js` with the pure
  `isPayrollPeriodAlreadySaved()` helper: compiling the same period twice
  never consumes the same cash advance twice.
- Released/finalized payroll records are immutable at the rules layer:
  field-level `.validate` equality on net, gross, deductions, weekKey, cash
  advance deductions, and rate snapshots; verified by the emulator suite
  `tests/pmos/rules-financial.test.ts` (13 checks).
- RFP for a compiled week uses the archived NET payroll log (snapshot rates);
  uncompiled weeks show a PROVISIONAL GROSS warning. A later rate edit cannot
  change a released RFP.
- Archived attendance history displays the snapshot rate instead of the
  current live rate.
- Payroll review modal shows per-worker Gross / Cash Advance Deduction / NET
  with warnings for missing rates, carry-forward balances, and negative NET.

### Production releases (2026-08-10)
- Child-level task transition rules (`projects/{pid}/tasks/{taskId}` `.validate`
  state machine: canonical vocabulary, valid transitions, PM-only completion
  gate, immutable createdBy/createdAt, terminal states) deployed to Staging
  `acpm-project-system-qa` and Production `acpm-project-system`. Verified live:
  deployed rules fetched and diffed byte-identical to `database.rules.json`;
  anonymous writes → `401`; Staging role matrix via
  `scripts/staging_rules_tasks_live_qa.js` (12/12 PASS, ephemeral accounts,
  self-cleaning).
- PO RFP export: `generatePORFP()` in `materials.js` + `downloadPORFP()` in
  `labor.js`; Production hosting promoted via guarded
  `deploy-production.ps1 -ConfirmProduction`. Verified live with
  `scripts/production_po_rfp_live_check.js` on real Angeles PO-001 (14/14 PASS:
  RFP text with line items + TOTAL AMOUNT, clipboard copy, PDF download;
  read-only).
- Live task lifecycle smoke `scripts/production_pilot_smoke.js`: 12/12 PASS in
  the real Production UI (dedicated QA project, deleted after).
- Deployed-rules write probe `scripts/live_po_payroll_probe.js`: the rules
  allow PM order/payroll writes 10/10 on well-formed active projects (the
  earlier "stuck" report was not a rules regression).

### Local Dev Shell (debugging aid, never deployed)
- `dev-shell.html` + `dev/dev-bypass.js`: localhost-only, `?dev=1` /
  session-flag-gated bypass of the login wall pointing at a local RTDB
  emulator (port 18300) seeded via `dev/seed-dev-data.js`.
- Fail-closed on any remote host; `dev/**` and `dev-shell.html` are excluded
  from hosting deploys and enforced by `scripts/dev_shell_static_qa.js`.

### Core operations (RC1–RC4, unchanged)
- PM has company-wide project visibility, project creation, APM assignment,
  financial review, and task verification.
- APM remains assigned-project only.
- Canonical task lifecycle implemented:
  `pending -> in_progress -> blocked/resume -> for_verification -> completed`.
- Completed/cancelled tasks are terminal and historical.
- ACPM Office and PMOS use `projects/{projectId}/tasks/{taskId}`.
- Task transitions create `taskEvents` and project `activity` atomically.
- Mission Board excludes completed work and prioritizes operational actions.
- Foreman/Safety/Viewer remain disabled for RC1.
- Firebase Storage is not used by PMOS RC1; photo transport is Google Drive
  Apps Script.
- Production and Staging use separate Firebase projects and databases.
- Hostname selection cannot redirect the public production hostname to
  Staging.
- Local development defaults to Staging; `?env=production` is an explicit
  local override.
- Production deployment fails closed unless `-ConfirmProduction` is supplied.
- Staging Hosting and database rules deployed at
  `https://acpm-project-system-qa.web.app`; Production Hosting at
  `https://acpm-project-system.web.app`.
- Staging Email/Password and Google Authentication provisioned separately via
  `firebase.auth.staging.json`.

## Files Added (RC5/RC6 + 2026-08-10 releases)

- `payroll-math.js`
- `dev-shell.html`, `dev/` (`dev-bypass.js`, `dev-rules.json`,
  `seed-dev-data.js`, `firebase.dev.json`)
- `docs/DEV_SHELL.md`
- `tests/pmos/payroll-math.test.ts`, `tests/pmos/labor-smoke.test.ts`,
  `tests/pmos/rules-financial.test.ts`, `tests/pmos/rules-tasks.test.ts`
- `scripts/dev_shell_static_qa.js`
- `scripts/staging_rules_tasks_live_qa.js`, `scripts/live_po_payroll_probe.js`,
  `scripts/production_pilot_smoke.js`,
  `scripts/production_po_rfp_live_check.js`

## QA Passed

- Full regression run (2026-08-10):
  - Playwright Office/PMOS suite: 24/24 PASS.
  - Unit suites: 74/74 PASS (core, pagination, subscription-manager,
    labor-smoke, payroll-math).
  - Production Firebase role rules emulator: 13/13 PASS.
  - Payroll financial rules emulator: 13/13 PASS.
  - PMOS database rules emulator: 24/24 PASS.
  - Task transition rules emulator (`tests/pmos/rules-tasks.test.ts`): 22/22
    PASS — canonical transitions, PM completion gate, creator identity
    immutability, terminal-state enforcement.
  - Storage rules suite skipped (documented pinned emulator runtime
    limitation, not an app defect).
  - Static gates 9/9 PASS: rc1_static, pwa_cache, rc1_docs, pmos_release,
    historical_integrity, ui_workflow, pm_apm_task_workflow, dev_shell,
    environment, plus firebase_rules_gate (ui_workflow extended for the PO RFP
    wiring).
  - JS syntax checks clean; `database.rules.json` and `firebase.json` parse.
- Live production verification (2026-08-10):
  - Staging deployed task-rules role matrix: 12/12 PASS.
  - Production pilot smoke (real UI task lifecycle): 12/12 PASS.
  - Production PO RFP on real Angeles PO-001: 14/14 PASS.
  - Deployed-rules order/payroll write probe: 10/10 PASS.
- Prior release gates (RC1–RC4): dashboard attention lists render as
  interactive project rows; light-theme report card hover surfaces; Boss UI
  smoke; environment isolation static/browser QA; real Staging lifecycle;
  real Production Boss smoke; Staging Google provider enabled; logout
  listener cleanup fixed in `auth.js?v=98`.

## Known Limitations

- Child-level task transition rules are enforced in `database.rules.json`
  (canonical transitions, PM completion gate, immutable creator identity,
  terminal states), verified by `tests/pmos/rules-tasks.test.ts`, and **deployed
  to Staging + Production** (guarded paths, live-verified 2026-08-10). External
  field roles remain disabled for RC1.
- Project `.write` rules intentionally deny PM/APM writes to archived/completed
  projects (boss/owner/admin are never blocked); ordering or payroll in a
  closed project fails with a permission error by design — reactivate the
  project or use a boss account.
- The storage rules emulator suite remains skipped: `cloud-storage-rules-`
  `runtime-v1.1.3` cannot compile cross-service `database()` access in
  `storage.rules.pmos-proposed`. Re-enable after the emulator runtime upgrade.
- Browser push notifications are future scope.
- Automated recurring task scheduling is future scope.
- PMOS photos depend on the configured Google Drive Apps Script.
- Live role-account QA (PM/APM/Boss) still needs dedicated credentials; the
  final readiness gate reports these as warnings.

## Remaining Steps

1. Continue the controlled office pilot and record findings in
   `docs/PILOT_ISSUE_LOG.md`.
2. Develop and verify future changes in Staging before guarded Production
   promotion.
3. Branch `feature/pmos-official-app` is pushed to GitHub
   (`vnskrd169/ACPM`); open the PR when ready to merge into `main`.

## Exact Commands

```powershell
npm.cmd run test:pmos
npm.cmd run test:environments
npx.cmd playwright test
node scripts/rc1_post_deploy_gate.js
node scripts/rc1_final_readiness_gate.js
# Emulator-backed rule suites (must run under the emulator):
npx firebase emulators:exec --only database --config firebase.emulator.json --project acpm-production-rules-test "npm.cmd run test:pmos:rules"
npx firebase emulators:exec --only database --config firebase.emulator.json --project acpm-production-rules-test "npx vitest run tests/pmos/rules-financial.test.ts tests/pmos/production-roles-database.test.ts"
```
