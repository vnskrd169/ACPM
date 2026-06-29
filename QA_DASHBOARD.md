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

Result: PASS STATIC / PENDING REAL FIREBASE QA

## Billing / Receivable Display

- [x] Project card shows compact financial line when rollups exist.
- [x] Financial line includes contract, billed, collected, and receivable values.
- [ ] Verify real Firebase billing rollup values display correctly after refresh.

Result: PASS STATIC / PENDING REAL FIREBASE QA

## Static QA Results

- [x] `node --check main.js`
- [x] Browser smoke test after cache v60: `main.js?v=60`, dashboard alerts, and project search loaded.
- [ ] Browser console clean after deployed Firebase rules: current live smoke still shows known audit-log permission warnings.
- [ ] Dashboard reload after report/billing rollup rebuild
- [ ] Project switching preserves dashboard/workspace route behavior

## Known Limitations

- Pending approvals and recent cross-module events are not yet centralized on dashboard.
- Manual QA requires QA-safe project rollups to avoid polluting live records.
