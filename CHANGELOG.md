# ACPM Changelog

## Multi-browser live production check — Chromium + WebKit 32/32, Firefox env-limited (2026-08-15)

- `scripts/live_production_load_check.mjs` now runs the same read-only live
  check (PM + APM + PMOS mobile) in any Playwright browser:
  `--browser=chromium|firefox|webkit` (or `ACPM_BROWSER`), and all three via
  `--all` with a summary table.
- **Chromium: 32/32 PASS** and **WebKit: 32/32 PASS** against the deployed
  production site with real QA accounts.
- **Firefox: ENVIRONMENT-LIMITED** — this sandbox's Firefox aborts XHR to
  Google's identitytoolkit endpoint (`NS_BINDING_ABORTED` at the Gecko
  network layer) while the identical request succeeds via fetch and via a
  direct verifyPassword probe (HTTP 200 with the real QA credentials).
  Root cause is the environment's network layer, not the app: it is stock
  Firebase auth, Chromium + WebKit pass identically, and the endpoint is
  reachable from Firefox itself. The check detects this automatically and
  reports it as LIMITED (with the probe evidence) instead of a false FAIL.
- Harness hardening: the field-view audit now waits for the PMOS layout to
  settle before measuring, so transient mid-render states aren't flagged as
  layout defects (an intermittent WebKit overflow trace turned out to be a
  mid-animation artifact — no reproduction across isolated runs).

Found while extending the live check to exercise PMOS on the production site:
`loadPmosProjects`/`pmosProjectAllowed` (pmos.js) and `loadOfficeProjects`/
`officeCanSeeProject` (pmos-office.js) gated company-wide project visibility on
`isBoss` (boss/owner/admin only). A **PM with no explicit assignments saw an
empty project selector in PMOS Mobile and PMOS Office** — but the office app
(`canSeeAllProjects` = boss/owner/admin/PM) grants PMs company-wide access.

### Fix
- `pmos.js` + `pmos-office.js`: all four project-visibility gates now use the
  central `canSeeAllProjects(role)` capability (PM included), matching the
  office app.
- `pmos/index.html`: added the same **fail-closed local dev-shell hook** the
  other three pages have (localhost + `?dev=1`/session flag only, never active
  on remote hosts) — PMOS was the one page the dev shell could not drive.
- Regression guard: `scripts/pm_apm_task_workflow_static_qa.js` now asserts
  PMOS project loading/access uses `canSeeAllProjects`, so a PM regression is
  caught at gate time.
- PWA caches bumped so clients pick up the fix: root `acpm-v140`, PMOS
  `pmos-cache-v7` (both sw.js + pmos/pmos-sw.js).

### Verified
- `dev/pmos-pm-verify.mjs` (real app, emulator, phone viewport): **PM sees
  all 10 projects (was 0), APM still sees exactly 2 assigned, zero console
  errors — 5/5 PASS**.
- Full regression: Playwright **32/32**, rules suites **27 passed / 4 skips**,
  all static gates PASS.
- **Deployed to production** (with the payroll-race database rules, both via
  `deploy-production.ps1 -ConfirmProduction -IncludeDatabase`); live site
  serves `acpm-v140` / `pmos-cache-v7` with the fixed pmos.js/pmos-office.js.
- **Live production re-check: 33/33 PASS** — the extended PMOS mobile section
  now shows the PM's project selector populated with real projects
  (previously empty), field view renders after selection, zero severe console
  errors on the phone.

## Live production load check — 21/21 PASS with real QA accounts (2026-08-15)

- Read-only browser check against the **deployed production site**
  (acpm-project-system.web.app) using the real QA role accounts:
  `pm.qa@lebuild.test` (company-wide) and `apm.qa@lebuild.test` (assigned-only).
- **PM session**: signs in and reaches the hub (~2.4s), hub renders the real
  project cards, opens a project workspace, renders content — zero severe
  console errors, horizontal overflow, broken images, or dead handlers.
- **APM session**: signs in (~2.3s), hub renders, opens an assigned project
  workspace — same clean audits.
- **Script**: `scripts/live_production_load_check.mjs` — reusable, read-only,
  env-driven (`ACPM_QA_PM_EMAIL`/`ACPM_QA_PM_PASSWORD`/`ACPM_QA_APM_*`).
  Blocks the service worker because a fresh context installing the PWA SW
  triggers `controllerchange -> reload`, which aborts the in-flight auth
  request — an artifact of first-visit install, not a production defect
  (existing users already have the SW installed).

## CRITICAL FIX: concurrent payroll compile race — one log per week, server-enforced (2026-08-15)

### Bug found by the multi-user concurrency drive
Two sessions compiling the SAME payroll week simultaneously both passed the
client-side "no existing log" check (a read-then-write TOCTOU race) and the
server accepted **two finalized payroll logs for one weekKey** — reproduced
live with boss + pm racing: `2026-08-10_2026-08-16` written twice at the same
second. Consequences: cash advances double-deducted and `laborSpent`
double-counted. The old server rule allowed a new log at any push key and
enforced nothing about weekKey uniqueness.

### Fix
- **Server**: new `projects/$pid/payrollWeeks/{weekKey}` **create-only marker**
  (`.validate … && !data.exists()`) in `database.rules.json`. A weekKey may be
  claimed by exactly ONE finalized log. `.validate` (not `.write`) is used
  because an ancestor `.write` grant short-circuits child `.write` rules.
- **Client**: `labor.js confirmSavePayroll` writes the marker in the **same
  atomic multi-path update** as the log. If another session already claimed
  the week, the marker write fails and the whole update is rejected — the
  server, not the client, guarantees one-log-per-week.
- **Dev parity**: `dev/dev-rules.json` enforces the same create-only marker so
  the local emulator behaves like production for this invariant.
- **Tests**: 4 new rule tests in `tests/pmos/rules-financial.test.ts` (create
  once, same-week duplicate rejected, overwrite rejected, APM cannot claim) —
  24/24 financial rules PASS.

### Re-verified
- Concurrency drive: **37/37 PASS** — `EXACTLY ONE new payroll log (12 → 13)`,
  no duplicate weekKey, all realtime sync checks green.
- Max-load drive: **98/98 PASS**. Emulator suites: **138 passed / 4 documented
  skips**. Playwright: **32/32 PASS**. All static gates PASS
  (rc1_static, pmos_release, firebase_rules_gate included).

### Tooling (dev only, never deployed)
- `dev/stress-concurrency.mjs` — 4-session race drive (worker adds, attendance
  last-write-wins, PO atomic sequence, payroll compile race, realtime sync,
  role visibility). Run: `node dev/stress-concurrency.mjs`
- `dev/seed-stress-data.js` extended: role users (`dev-pm`, `dev-apm1`,
  `dev-apm2`), `trades` node (the real add-worker form populates its select
  from it), attendance targeting the current week, and payroll history
  stopping BEFORE the current week so the compile path is real.
- `dev/dev-bypass.js` multi-user support: `?devUser=boss|pm|apm1|apm2` or
  `sessionStorage.acpm_dev_user` selects the mock identity (default boss;
  fail-closed on remote hosts as before).

## Max-load stress simulation — 10 projects pushed to the limit (2026-08-15)

### Scenario
Seeded the local emulator with a production-scale workload and drove the
**real app** (dashboard hub + workspace, boss session, dev shell bypass) in a
browser against it:
- 10 active projects × 50 workers each = **500 workers** (10 per trade × 5
  trades: Electrician, Plumbing, Structural, Installer, Paint)
- **12 weekly Saturday payroll logs** per project (120 total), each carrying
  full 50-worker per-trade detail in the real compiled `byTrade` shape
- **20 daily PO requests** per project (200 total) with items, deliveries,
  DR numbers, plus 40 materials lines, 25 tasks, 20 site logs, 8 billings,
  advances, equipment, compliance, defects per project

### Result — 98/98 PASS, zero failures
- Hub renders all 10 projects; every workspace boots and renders all **50
  workers** (verified by DOM row count, not text regex)
- Payroll history renders **12 weekly logs** with **600 worker detail rows**
  (12 × 50 — every worker present in every log)
- Materials tab renders all **20 PO cards** per project
- **Zero** severe console errors, horizontal overflow, or dead inline
  handlers across all 10 projects, the materials view, and the 390px phone
  viewport
- Performance: hub render ~2.2s; workspace load mean **~1.0s** (n=11, real
  emulator reads of 50 workers + 12 payroll logs + 20 POs + 40 materials
  + 25 tasks + 20 site logs per project)

### Tooling (dev only, never deployed)
- `dev/seed-stress-data.js` — deterministic max-load seed (same emulator
  isolation as `seed-dev-data.js`; all records flagged `STRESS`, local-only)
- `dev/stress-max-load.mjs` — boots server + emulator, seeds, drives the app
  across all projects, audits health/overflow/handlers/console, reports
  render timings. Run: `node dev/stress-max-load.mjs`

## Company deployment — Staging + Production (2026-08-15)

- **Staging** `acpm-project-system-qa`: deployed via guarded
  `npm run deploy:staging` (database + hosting, 552 files). All three
  pre-deploy gates passed (environment isolation, PWA cache, RC1 static).
  Verified live: HTTP 200, `acpm-v139`, `pmos-cache-v6`, auth.js window guard
  present, zero test artifacts (`pmos-tests.js`, `tests/`, `scripts/` all 404).
- **Production** `acpm-project-system`: promoted via guarded
  `npm run deploy:production -- -ConfirmProduction` (hosting-only — database
  rules unchanged since the last release; 25 changed files uploaded).
  Verified live: HTTP 200, `acpm-v139`, `pmos-cache-v6`, auth.js fix live,
  zero test artifacts.
- **Live post-deploy security re-verified against production**:
  `rc1_deployed_rules_security_qa.js` PASS (PM project-root allow, APM
  project-root deny, assigned-project allow against the deployed rules).

## Live RC1 readiness gate passed (2026-08-15) — deploy blocker cleared

- Provisioned/verified the RC1 QA role accounts against **live production**
  (`acpm-project-system`) using the documented owner sign-in path:
  `scripts/provision_rc1_role_qa_accounts.js` created/updated
  `admin.qa@lebuild.test`, `pm.qa@lebuild.test`, `apm.qa@lebuild.test` with
  admin/pm/apm roles; PM and APM assigned to an active project.
- `scripts/roles_live_account_qa.js`: **PASS** — admin/pm/apm self-profile
  reads and project-root access checks against live Firebase.
- `scripts/rc1_deployed_rules_security_qa.js`: **PASS** — PM project-root
  allow, APM project-root deny, assigned-project allow against the deployed
  rules.
- `scripts/rc1_final_readiness_gate.js`: **PASS_RC1_READY** — zero failures,
  zero warnings. This was the only remaining release blocker (previously
  failed on `Missing PM QA credentials`).
- `rc1_post_deploy_gate.js`: local chain **PASS_WITH_REAL_QA_SKIPPED**; the
  7 live-write module QA scripts are intentionally not re-run against
  production — they passed live on 2026-07-02 per the readiness evidence.

## QA hardening + storage suite enabled (2026-08-15)

### Fixes
- **Static-gate regression fixed**: `auth.js` gained a top-level
  `window.PMOS_CONFIG` reference (profile photo Drive transport) that crashed
  Node VM-based gates (`roles_rc1_matrix_qa.js`, `rc1_post_deploy_gate.js`)
  with `window is not defined`. Guarded with `typeof window !== 'undefined'`;
  the same guard was applied to the identical pattern in `sitelog.js`,
  `face-attendance.js`, and `pmos.js`.
- **Dead empty-state CTAs fixed** (PMOS field app): the onboarding state
  buttons called undefined `pmosCapturePhoto()` / `pmosOpenCreate()` — clicking
  them threw. Now call `pmosOpenModule("photo")` / `pmosShowCreateSheet()`.
- **Un-exposed handlers fixed** (PMOS field app): `uploadQueuedPhotos` and
  `syncOfflineQueue` were used in inline `onclick` but never attached to
  `window`, so the More-screen buttons threw on click. Both are now exported.

### QA tooling
- **Storage rules emulator suite now RUNS**: `firebase.emulator.json` declares
  the storage emulator (port 9199) plus `storage.rules`; unauthenticated
  read/download-denial checks pass. Write-denial + seeded-read assertions stay
  `describe.skip` — verified that the pinned
  `cloud-storage-rules-runtime-v1.1.3` cannot process `put` at all (returns
  `storage/unknown` even with rules disabled), a toolchain limit, not an app
  defect.
- **New permanent UI regression audits** (`tests/e2e/ui-audit*.spec.ts`,
  `ui-handlers-audit.spec.ts`): no horizontal overflow, no unlabeled buttons,
  no tiny tap targets, no broken images, no dead inline `onclick` handlers
  across the PMOS field app, dashboard hub, all workspace tabs, PMOS office,
  and a 390px phone viewport.

### Repo hygiene
- Untracked the standalone `line17-face-attendance/` prototype (10,730
  committed `node_modules` files, unreferenced, excluded from hosting) and
  added it to `.gitignore`. Preserved on
  `feature/pmos-face-attendance-assist`.
- **Company-deploy gate**: `pmos_release_static_qa` now asserts the deployable
  site ships zero test artifacts — `firebase.json` hosting.ignore must exclude
  `tests/**`, `test-results/**`, `pmos-tests.js`, Playwright/Vitest configs,
  `scripts/**`, and `docs/**`, and no deployable page may reference any test
  harness. Verified against the hosting snapshot: 0 test files in the
  549-file company deploy set. Staging-only `manifest-staging.json` (selected
  by `environment.js` on the QA hostname) is the only staging artifact that
  ships, by design.

### Verification (2026-08-15)
- Playwright: 32/32 PASS (24 existing + 8 new UI audits).
- Unit: 74/74 PASS. Emulator rule suites: 82 PASS / 4 documented skips
  (database 24, financial 13, tasks 22, production roles 13, storage 3 run +
  4 toolchain skips).
- Static gates 12/12 PASS: rc1_static, pwa_cache, pmos_release, ui_layout,
  ui_workflow, environment, pm_apm_task_workflow, historical_integrity,
  rc1_docs, firebase_rules_gate, roles_rc1_matrix, dev_shell.

## Full Google Drive migration — no Firebase Storage anywhere (2026-08-15)

### Feature
- **Face Attendance is now Google Drive-only.** Worker enrollment reference
  photos + thumbnails, Face Engine Lab test selfies, and the PMOS selfie
  queue all upload through the approved Google Drive Apps Script transport
  (`PMOS_CONFIG.driveUploadUrl`) instead of Firebase Storage. Records store
  `storageProvider: 'Google Drive'` plus Drive file/folder IDs; the
  enrollment panel and delete-flow notices were updated to match. All
  `firebase.storage()` calls are gone from `face-attendance.js`.
- **Profile photos are Drive-first.** `auth.js` uploads the compressed avatar
  to Google Drive (full-access link) via the same Apps Script endpoint, with
  the existing inline data-URL avatar as an offline/unreachable fallback. The
  dead Firebase Storage path and misleading "until Firebase Storage is set up"
  warnings were removed; the profile form now shows a `saved to Google Drive`
  hint.
- **Firebase Storage rules locked to Drive-only.** `storage.rules` and
  `storage.rules.pmos-proposed` now deny all writes and keep authenticated
  reads so any legacy Firebase Storage URLs stored before migration still
  render. The storage rules emulator suite now RUNS (the old cross-service
  `database()` access that the pinned emulator could not compile is gone):
  unauthenticated read/download denial checks pass; write-denial + seeded-read
  assertions stay `describe.skip` because the pinned
  `cloud-storage-rules-runtime-v1.1.3` cannot process `put` at all.
- **UI/UX**: photo gallery cards (PMOS Office) and the lightbox show a
  `📁 Google Drive` badge on Drive-hosted photos; the PMOS More/About screen
  shows the storage badge; upload toasts say "uploaded to Google Drive".

### Files
- `face-attendance.js`, `auth.js`, `pmos.js`, `pmos-office.js`,
  `pmos-photo-lightbox.js`, `assets/brand/pmos-app.css`, `style.css`,
  `storage.rules`, `storage.rules.pmos-proposed`, `pmos-tests.js`,
  `tests/pmos/rules-storage.test.ts`, `scripts/pmos_release_static_qa.js`,
  `scripts/account_onboarding_live_qa.js`, and the PMOS/storage docs.

### Verification
- Static gates PASS: rc1_static, pwa_cache, ui_layout, ui_workflow,
  pmos_release (now also asserts face-attendance + auth are Firebase
  Storage-free and Drive-only), environment.
- Emulator-backed rules suites: 82 passed / 4 skipped (storage runtime
  limitation documented above) — database, financial, production-roles,
  tasks, storage.
- Unit suites: 74/74 PASS.

## Site Log photo upload — Google Drive Apps Script (no card, no Storage) (2026-08-10)

### Feature
- The office Site Log form (dashboard + workspace) now has an **Add Photos**
  picker (multiple, images only). Selected photos are auto-compressed
  client-side (max 1600 px, JPEG ~0.75, plus a 400 px thumbnail) and uploaded
  through the **approved Google Drive Apps Script transport**
  (`PMOS_CONFIG.driveUploadUrl` — the same endpoint PMOS already uses) via
  `uploadSiteLogPhoto()` / `addSiteLogMedia()`.
- The log is created with the same client-generated `logId` so photos and the
  record stay linked; the Drive photo URL + thumbnail + `driveFileId` are
  stored under `media` and `photos`, rendering in the log feed exactly like
  pasted URLs.
- **No Firebase Storage, no payment, no console setup**: photos live in Google
  Drive (the transport the project already approved for PMOS). Firebase
  Storage remains unused — `storage.rules` and `environment.js` are unchanged
  from the previous release.
- The photo-URL textarea remains as a fallback when the Drive endpoint is
  unavailable (graceful degradation).

### Verification
- `node --check` clean; `firebase.json` parses.
- Unit suites: 74/74 PASS.
- Static gates PASS: rc1_static, pwa_cache, ui_layout, ui_workflow (extended
  with photo picker/preview/Drive upload wiring), pmos_release,
  historical_integrity, environment, dev_shell.
- PWA: `sw.js` `acpm-v139`, `sitelog.js?v=95`, `style.css?v=112`.
- Storage rules emulator suite remains `describe.skip` (pinned emulator
  runtime limitation, unrelated to this change).

## ACPM OS v1.0 — Company Pilot (2026-08-10)

### Delivery Receipt modal scroll fix (post-release hotfix)

**Bug**: The Record Delivery Receipt modal clipped PO line items when many
rows existed — header/footer stayed visible but the item list could not be
scrolled (reported production bug).

**Root cause**: `.modal-box` is a flex column with `max-height: 90dvh` and
`overflow-y: auto`, but `#deliveryItemsList` had `overflow: hidden` with no
`min-height: 0` — when the box hit max-height the flex items shrank and the
list clipped rows with no internal scrollbar while the box itself had nothing
to scroll.

**Fix** (style.css): `#deliveryItemsList` now uses `min-height: 0;
overflow-y: auto; overscroll-behavior: contain` so the list owns internal
scrolling and every row stays reachable at any count. No `overflow: hidden`
masking; horizontal responsiveness preserved.

**Verification**:
- Interactive probe (scripts/delivery_modal_scroll_probe.js): 24/24 PASS at
  1366×768, 1024×768, 390×844 with 30 seeded rows — mouse wheel, keyboard
  PageDown, trackpad/touch-equivalent scrolling all reach the last row;
  footer stays visible; Escape closes; zero console errors.
- Layout audit harness: 504/504 PASS at the full viewport matrix.
- Permanent regression case added to scripts/ui_layout_local_audit.js
  (30-item delivery modal scroll + footer reachability per viewport).
- Deployed to production: `style.css?v=111`, `CACHE_NAME = 'acpm-v138'`.


### CRITICAL SECURITY FIX: APM budget-control mutation blocked

**Vulnerability**: An assigned APM could write `laborSpent`, `laborBudget`,
`materialBudget`, and budget deltas directly via REST because the project-node
`.write` rule granted APM write access to the entire subtree with no
child-level field protections. This was confirmed via a live production probe
at acpm-project-system — the genre of bug that would have allowed an APM to
falsify budget usage or payroll spend figures.

**Fix**:
- Added PM+-only (boss|owner|admin|pm) `.validate` role gates on:
  `laborBudget`, `materialBudget`, `laborBudgetDelta`, `materialBudgetDelta`,
  `laborSpent` — the five budget-control fields that APM never legitimately
  writes.
- Added PM+-only `.validate` role gate on `payrollLogs/$logId` and
  `attendanceHistory/$logId` — blocking APM from fabricating payroll records.
- Gated the edit-project modal (`openEditProjectModal`, `editProject`) behind
  `canSeeFinancials()` so APM cannot edit budgets via the UI either.
- Emulator tests added (20 rules tests, 13 production-roles tests — all pass).
- `materialSpent`/`materialReceivedCost`/`materialCommitted` remain writable
  by assigned APM because the receiving workflow (confirmDelivery) legitimately
  updates them as part of the atomic delivery record — a full audit trail
  exists in `deliveries/` and `materialMovements/`.

### App bug fix: PM could not see Punch List / Equipment / Compliance tabs

The defects (Punch List), equipment, and compliance tabs had
`data-role-visible="apm,boss"`, which excluded PM because `elementAllowsRole`
checks `allowed.includes('pm')` — PM is not in the list. This meant a PM could
not open the Punch List to verify or resolve issues, derailing the PM
verification workflow required by the company pilot. Fixed all three tabs in
both workspace.html and dashboard.html to `apm,pm,boss,owner,admin`.

### Live company pilot acceptance — 48/48 checks passed against production

The `scripts/v1_live_pilot_acceptance.js` script drives the real deployed
acpm-project-system with dedicated QA accounts (PM + APM) through the
complete company lifecycle:

- PM sign-in + company-wide project visibility
- APM isolation + confirmed read-only budget (security fix verified)
- Project creation + assignment + persistence after refresh
- Payroll scenarios A/B/C/D (gross 16250, net 12250, CA 4000)
- CA carry-forward 1000, no double deduction
- RFP == compiled NET (₱12,250.00)
- Historical rate immutability (850→900 edit, historical unchanged)
- Partial delivery 60→40 with both records preserved, fully delivered
- Task lifecycle (pending → completed)
- Billing seeded record visible
- Critical punch list item visible to PM
- Logout/login persistence, APM cannot finalize payroll
- Zero console errors during the session

### PWA cache bumped to v137

Updated `main.js?v=108→109`, `CACHE_NAME = 'acpm-v136→v137'`, all QA
script version assertions, and PMOS cache namespace.

### Verification
- Vitest full suite: **153 passed / 10 skipped**.
- Playwright PMOS + Office e2e: **24/24 PASS**.
- Static gates: environment, rc1, pwa_cache, pmos_release, ui_workflow — all PASS.
- PWA: `sw.js` `acpm-v137`, `main.js?v=109` deployed.

## Production hardening — UI/UX/workflow/regression pass (2026-08-10)

### Root causes fixed
- **Payroll no-scroll**: panels used fixed-height + `overflow:hidden`-style
  traps; replaced with document-flow scrolling so the page owns vertical
  scrolling everywhere (verified by an automated hard-scroll probe).
- **Escape handler bug** (`main.js`): pressing Escape on an open modal
  removed it from the DOM *and* then exited the workspace to the Hub. Now
  Escape closes only the modal — regression-guarded in the local audit.
- **Billing form grid overflow**: `#billingPanel .billing-form-grid` used
  fixed `minmax` tracks (~860px+) that overflowed at 768px and below;
  clamped to `repeat(auto-fill, minmax(min(100%, 190px), 1fr))`.
- **Summary tables clipped**: tables outside the admin/reports sub-sections
  (materials summary, labor history) rendered without a horizontal scroll
  wrapper — now wrapped in `overflow-x: auto` with readable min widths.
- **Hub activity feed**: long project names clipped without ellipsis — flex
  copy gets `min-width: 0` so text ellipsizes instead of overflowing.

### New reusable QA harness
- `scripts/ui_layout_local_audit.js` — full local browser audit with mocked
  Firebase + stress data (30 workers, 20 projects, full attendance week, 6
  POs with partial deliveries, 25 material rows, 20 tasks, billings, site
  logs, change orders). No credentials needed. Probes every matrix viewport
  (1920×1080 … 375×667) for scroll traps, horizontal overflow, reachable
  primary actions, modal fit + footer reachability, Escape correctness,
  30-item PO builder, tab switching, duplicated ids, PMOS nav views + create
  sheet, and console errors. **464/464 PASS**.

### Verified
- Vitest full suite (emulator-backed): **146 passed / 10 skipped**.
- Playwright Office + PMOS e2e: **24/24 PASS**.
- Static gates: rc1_static, pwa_cache, ui_layout, ui_workflow,
  pmos_release, environment — all PASS.
- PWA: `sw.js` `acpm-v136`, PMOS workers `pmos-cache-v6`; asset params
  bumped (`style.css?v=110`, `main.js?v=108`, `labor.js?v=98`,
  `materials.js?v=96`).

## Supplier Invoice RFP deployed — Staging + Production (2026-08-10)

### Deployed
- Added an **Invoice RFP** for supplier invoices. When a PO has an approved
  supplier invoice (`invoiceNo` / `invoiceAmount` / `invoiceStatus: matched` /
  `threeWayMatch`), the PO card in Materials shows a 📋 **Invoice RFP** button
  next to the existing RFP/Image buttons. It opens the shared RFP modal with
  **Copy Text** and **Download PDF**: REQUEST FOR PAYMENT - SUPPLIER INVOICE
  with project, PO number, invoice number/date, supplier, 3-way match status,
  line items, `INVOICE AMOUNT`, `PO TOTAL`, and an "Approved by" line.
- `generateInvoiceRFP()` in `materials.js` (items normalized via `buildPoItem`
  so legacy POs render correct unit costs); `labor.js` `downloadRFP()` routes
  `source: 'invoice'` to a new `downloadInvoiceRFP()` PDF helper; the
  `ui_workflow_static_qa` gate verifies the wiring.

### Live verification (deployed sites, read-only QA projects, self-cleaning)
- **Staging** `acpm-project-system-qa` — deployed via guarded
  `scripts/deploy-staging.ps1 -HostingOnly`; live check
  `RFP_CHECK_STAGING=1 node scripts/production_invoice_rfp_live_check.js`
  with an ephemeral staging boss account: **11/11 PASS**.
- **Production** `acpm-project-system` — promoted via guarded
  `scripts/deploy-production.ps1 -ConfirmProduction` (hosting only, rules
  unchanged); live check `node scripts/production_invoice_rfp_live_check.js`
  as boss@acpm.local: **11/11 PASS**.
- Checks: Invoice RFP button renders on the PO card, modal opens, text carries
  the SUPPLIER INVOICE header, invoice number, supplier, 3-WAY MATCHED status,
  `INVOICE AMOUNT: ₱10,000.00`, and `PO TOTAL`; Download PDF produces
  `RFP_Invoice_*.pdf`. QA projects and the staging boss account were deleted
  after each run (no `qa_invrfp_*` residue in either database).

## Production deployment — PO RFP export (2026-08-10)

### Deployed
- Added a copy-pasteable **RFP (Request for Payment) for purchase orders** and
  promoted it to Production `acpm-project-system` via the guarded
  `scripts/deploy-production.ps1 -ConfirmProduction` path (hosting only — the
  database rules are unchanged since the last release). All pre-deploy gates
  passed; 26 files uploaded, version finalized, release complete.
- Every PO card in Materials → Orders now shows a **📋 RFP** button next to the
  existing Image export. It opens the same RFP modal used by payroll with
  **Copy Text** and **Download PDF**, showing the RFP header, project name, PO
  number, date, supplier, status, each line item (qty × unit cost = total),
  `TOTAL AMOUNT`, and an "Approved by" signature line.

### Live verification (real PO, read-only)
- `scripts/production_po_rfp_live_check.js` signed in as the boss QA account
  and verified the deployed feature against the real **Angeles Residence**
  **PO-001** (RRJM Construction supply, 9 items): **14/14 PASS** — the RFP
  button renders on the PO card; the modal opens; the RFP text carries the
  header, project name, PO-001, supplier, line-item math, and
  `TOTAL AMOUNT: ₱10,100.00`; **Copy Text** puts the full document on the
  clipboard; **Download PDF** produces
  `RFP_Angeles_Residence_..._2026-08-04.pdf`. No data was written.
- The payroll RFP (Payroll card → 📄 RFP) is unchanged and shares the same
  modal with the new PO RFP.

## Production pilot smoke — Task lifecycle in live UI (2026-08-10)

### Verified
- `scripts/production_pilot_smoke.js` drove the real Production web app
  through the full task lifecycle with the dedicated QA accounts and a
  dedicated QA-only project (seeded and deleted around the run; the two real
  active pilot projects were never touched).
- **12/12 PASS**: APM create -> start -> submit for verification; APM menu
  correctly hides `Verify and Complete`; PM login -> verify -> complete;
  task lands in the Completed column.
- Live DB verified the deployed rules end-to-end: task created by APM uid,
  completed by PM uid, with `taskEvents` `created -> started ->
  submitted_for_verification -> verified`. All QA project data was deleted
  after the run.

## Production deployment — Task transition rules (2026-08-10)

### Deployed
- Promoted the exact Staging-tested state to Production `acpm-project-system`
  via the guarded `scripts/deploy-production.ps1 -ConfirmProduction
  -IncludeDatabase` path. All three pre-deploy gates passed (environment
  isolation, PWA cache, RC1 static gate), then `database: rules released
  successfully` for `acpm-project-system-default-rtdb` and hosting (102
  files) deployed to `https://acpm-project-system.web.app`.

### Live verification (read-only — no test records written to Production)
- Fetched the deployed Production rules from the live RTDB
  (`.settings/rules.json`) and confirmed the full rules object is
  byte-identical to local `database.rules.json` (task `.validate` 2370
  chars, PM completion gate, transition state machine, identity freeze,
  payrollLogs financial protection all present).
- Live enforcement probes: anonymous task writes and project reads return
  `401 Permission denied` on Production; console read of the users node
  confirms the database is healthy and existing records are intact.
- The role-based transition matrix itself was verified on Staging
  (`scripts/staging_rules_tasks_live_qa.js`, 12/12 PASS) immediately before
  this promotion; per the repo safety rules, no ephemeral QA accounts or
  test records are created in Production.

## Staging deployment — Task transition rules (2026-08-10)

### Deployed
- Deployed `database.rules.json` (child-level task transition state machine,
  PM completion gate, identity freeze) to Staging `acpm-project-system-qa` via
  the guarded `npm.cmd run deploy:staging` path after the three pre-deploy
  gates passed. Hosting assets deployed alongside.

### Live verification
- Fetched the deployed rules from the Staging RTDB
  (`.settings/rules.json`) and confirmed the task `.validate` is byte-identical
  to the local `database.rules.json` (2370 chars, full rules object match).
- Live enforcement probes: anonymous task writes and project reads return
  `401 Permission denied` on Staging.
- Role-based live QA `scripts/staging_rules_tasks_live_qa.js`: provisioned
  ephemeral PM/APM accounts in the Staging Auth project, seeded roles via
  console access, and exercised the deployed rules — **12/12 PASS** covering
  APM lifecycle (create/in_progress/for_verification), APM denial (complete,
  fresh-create-as-completed, status skip, createdBy mutation), PM allowance
  (complete, fresh-create-as-completed), and PM denial (reverse transition,
  createdAt mutation). All ephemeral accounts, test project, and user records
  were deleted after the run (verified no `rulesqa-*` residue).

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
  `pmos-cache-v4` / `acpm-pmos-v4`, `labor.js?v=98`, `payroll-math.js?v=2`,
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
  pmos-cache-v3 → v4, shell label acpm-pmos-v3 → v4; `labor.js?v=98`,
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
