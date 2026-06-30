# ACPM Dashboard Rollup Integration QA

Status: DATA FOUNDATION IMPLEMENTED - MANUAL FIREBASE QA PENDING

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
- [ ] Verify real Firebase billing rollup values display correctly after refresh.

Result: PASS STATIC / PENDING REAL FIREBASE QA

## Static QA Results

- [x] `node --check main.js`
- [x] Browser smoke test after cache v60: `main.js?v=60`, dashboard alerts, and project search loaded.
- [x] Local HTTP smoke after cache v73: `dashboard.html`, `workspace.html`, and `sw.js` return 200 with expected script/cache versions.
- [x] Browser smoke test after cache v73 loaded signed-in Boss dashboard with clean console.
- [ ] Browser console clean after deployed Firebase rules: current live smoke still shows known audit-log permission warnings.
- [ ] Dashboard reload after report/billing rollup rebuild
- [ ] Project switching preserves dashboard/workspace route behavior

## Known Limitations

- Pending approvals appear as dashboard alert counts, but a full approvals panel is still pending.
- Manual QA requires QA-safe project rollups to avoid polluting live records.
- PM/APM/Admin role-specific browser QA still needs real QA accounts.
