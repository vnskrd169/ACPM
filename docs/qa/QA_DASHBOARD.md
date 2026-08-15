# ACPM Dashboard Rollup Integration QA

Status: ROLLUP INTEGRATION DATA QA PASSED - BOSS BROWSER SMOKE PASSED; STATIC DASHBOARD QA PASSED

## Browser Smoke - 2026-06-30

PASS:

- Dashboard route loaded as signed-in Boss with `auth-ready`.
- `labor.js?v=80`, `notifications.js?v=79`, and current report bundle were loaded during Boss smoke passes.
- Project cards, dashboard summary, active/completed filters, and workspace CTA rendered.
- Console errors: none.
- Local HTTP smoke after cache v81 confirmed `utils.js?v=81`, `suppliers.js?v=81`, and `acpm-v81` service worker.

WARNING:

- Browser log tooling can retain old captured audit warnings by timestamp; live Firebase RC1 gate passed on 2026-07-02.

## Rollup Source QA

- [x] Dashboard helper prefers `reportRollups.projectSummary`.
- [x] Dashboard helper falls back to `billingRollups`.
- [x] Dashboard helper falls back to legacy `laborSpent` and `materialSpent`.
- [x] Project cards use rollup-aware total cost.
- [x] Dashboard summary totals use rollup-aware total cost.
- [x] Budget alerts use rollup-aware total cost.
- [x] Hub CSV export uses rollup-aware labor/material/total cost.
- [x] Alerts aggregate pending lifecycle requests and notification events from loaded project snapshots.
- [x] Alerts aggregate open Site Log issues/delays from rollups.

Result: PASS STATIC + REAL FIREBASE ROLLUP QA

## Billing / Receivable Display

- [x] Project card shows compact financial line when rollups exist.
- [x] Financial line includes contract, billed, collected, and receivable values.
- [x] Recent activity reads project lifecycle timestamps plus notification events.
- [x] Recent activity separator cleaned to plain ASCII to avoid garbled browser text.
- [x] Verify real Firebase report/billing rollup values are persisted for dashboard consumption.
- [x] Verify visual dashboard display after refresh in signed-in Boss browser smoke.

Result: PASS DATA QA + BOSS BROWSER SMOKE

## Static QA Results

- [x] `node --check main.js`
- [x] `node --check report.js`
- [x] `node --check scripts/reports_v1_real_qa.js`
- [x] Browser smoke test after cache v60: `main.js?v=60`, dashboard alerts, and project search loaded.
- [x] Local HTTP smoke after cache v73: `dashboard.html`, `workspace.html`, and `sw.js` return 200 with expected script/cache versions.
- [x] Browser smoke test after cache v73 loaded signed-in Boss dashboard with clean console.
- [x] Dashboard static QA:
  - Script: `scripts/dashboard_static_qa.js`
  - Result: PASS
  - Verified rollup source priority, rollup-aware total spent, lifecycle/notification/site-log alert sources, and QA helper exports.
- [x] Real Firebase Reports/Dashboard rollup data QA:
  - Project: `qa_mr0saqj7_ckl0p39g`
  - Verified `reportRollups/projectSummary` persisted totals for contract, cost, collected, receivable, and estimated profit.
- [x] Live Firebase RC1 gate after deployed-rule update passed; old browser log entries may remain in the automation buffer by timestamp.
- [x] Dashboard visual reload after report/billing rollup rebuild covered by Boss smoke and persisted rollup QA.
- [x] Project switching/dashboard-to-workspace route behavior covered by routing/browser smoke.
- [x] Browser smoke after cache v92:
  - `style.css?v=92` and the then-current `main.js?v=90` loaded.
  - Completed/read-only project workspace kept Boss/Admin panel navigation clickable.
  - Admin Requests and Audit tabs switched correctly.
  - Signed-in `login.html` redirected to `dashboard.html` and loaded `style.css?v=92`.
  - Console errors: none.
- [x] Browser label sweep after cache v94:
  - Opened Labor, Change Orders, Site Log, Suppliers, Tasks, Equipment, and Defects from workspace navigation.
  - Confirmed affected module scripts loaded at v94.
  - Broken-glyph scan returned `0`.
- [x] Login shell static QA after cache v96:
  - Confirmed `login.html` loads current `utils.js?v=84`, `auth.js?v=85`, and `main.js?v=95`.
  - Confirmed service worker caches the current login shell scripts.
  - Confirmed `main.js` actively checks for service worker updates and reloads once a new worker controls the page.
- [x] PM workload clarity pass after cache v116:
  - Recent Activity now renders project name, action label, optional actor, relative time/date, and module-colored status dot.
  - No new Firebase reads, writes, paths, or listeners were added.
  - Static syntax and PWA shell gates passed for `main.js?v=99` and `style.css?v=100`.
- [x] Live browser smoke after cache v116:
  - Signed-in Boss reached `dashboard.html` with Hub visible and System Reports hidden.
  - Hub button from Team Admin returned to the Hub, not System Reports.
  - Served dashboard shell had no mojibake markers in visible body text.
  - Console errors/warnings: none after the defensive service-worker registration fix.
- [x] Browser PWA update smoke after cache v96:
  - First signed-in redirected dashboard load reproduced the old cached shell.
  - Follow-up route after the service-worker update loaded current `main.js?v=95`, `labor.js?v=94`, `materials.js?v=93`, `changeorders.js?v=94`, `sitelog.js?v=94`, `suppliers.js?v=94`, `equipment.js?v=94`, `defects.js?v=94`, and `tasks.js?v=94`.
  - Console errors: none; known deployed-rule audit warning remains.

## Known Limitations

- Pending approvals appear as dashboard alert counts. A dedicated approvals panel is future UI polish because Boss Lifecycle Requests already has the actionable approval view.
- Manual QA requires QA-safe project rollups to avoid polluting live records.
- PM/APM/Admin role-specific browser QA still needs periodic real QA account reruns after major rules changes.
- Browser automation logs may retain old warning entries; use fresh timestamps and real Firebase gate output for deployed-rule status.
