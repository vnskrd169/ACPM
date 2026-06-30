# ACPM Dashboard Rollup Integration QA

Status: ROLLUP INTEGRATION DATA QA PASSED - BOSS BROWSER SMOKE PASSED; GLOBAL QA STILL PENDING

## Browser Smoke - 2026-06-30

PASS:

- Dashboard route loaded as signed-in Boss with `auth-ready`.
- `labor.js?v=80`, `notifications.js?v=79`, and `report.js?v=78` were loaded.
- Project cards, dashboard summary, active/completed filters, and workspace CTA rendered.
- Console errors: none.
- Local HTTP smoke after cache v81 confirmed `utils.js?v=81`, `suppliers.js?v=81`, and `acpm-v81` service worker.

WARNING:

- Workspace smoke still reports deployed audit-log permission warnings. This is tracked under Audit v1 / Firebase deployed-rule drift and does not block dashboard rendering.

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

Result: PASS STATIC / PENDING REAL FIREBASE QA

## Billing / Receivable Display

- [x] Project card shows compact financial line when rollups exist.
- [x] Financial line includes contract, billed, collected, and receivable values.
- [x] Recent activity reads project lifecycle timestamps plus notification events.
- [x] Recent activity separator cleaned to plain ASCII to avoid garbled browser text.
- [x] Verify real Firebase report/billing rollup values are persisted for dashboard consumption.
- [ ] Verify visual dashboard display after refresh in browser.

Result: PASS DATA QA / BROWSER SMOKE PENDING

## Static QA Results

- [x] `node --check main.js`
- [x] `node --check report.js`
- [x] `node --check scripts/reports_v1_real_qa.js`
- [x] Browser smoke test after cache v60: `main.js?v=60`, dashboard alerts, and project search loaded.
- [x] Local HTTP smoke after cache v73: `dashboard.html`, `workspace.html`, and `sw.js` return 200 with expected script/cache versions.
- [x] Browser smoke test after cache v73 loaded signed-in Boss dashboard with clean console.
- [x] Real Firebase Reports/Dashboard rollup data QA:
  - Project: `qa_mr0saqj7_ckl0p39g`
  - Verified `reportRollups/projectSummary` persisted totals for contract, cost, collected, receivable, and estimated profit.
- [ ] Browser console clean after deployed Firebase rules: current live smoke still shows known audit-log permission warnings.
- [ ] Dashboard visual reload after report/billing rollup rebuild
- [ ] Project switching preserves dashboard/workspace route behavior

## Known Limitations

- Pending approvals appear as dashboard alert counts, but a full approvals panel is still pending.
- Manual QA requires QA-safe project rollups to avoid polluting live records.
- PM/APM/Admin role-specific browser QA still needs real QA accounts.
