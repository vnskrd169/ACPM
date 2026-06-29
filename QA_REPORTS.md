# ACPM Reports v1 QA Checklist

Status: DATA FOUNDATION IMPLEMENTED - MANUAL FIREBASE QA PENDING

Scope:

- No UI redesign.
- Reports should read historical data and rollups wherever practical.

## Project Summary

- [x] Rebuild project report rollup helper exists.
- [x] Verify project name/status come from project metadata.
- [x] Verify contract amount and approved change orders come from Billing/Change Order rollup-compatible sources.
- [x] Verify labor cost comes from Billing rollup laborCost or legacy project laborSpent fallback.
- [x] Verify material cost comes from Billing rollup materialCost or legacy project materialSpent fallback.
- [x] Verify total billed, collected, and receivable come from `billingRollups`.
- [x] Verify estimated profit and margin are calculated from collected revenue minus costs.

Result: PASS STATIC / PENDING REAL FIREBASE QA

## Labor Summary

- [ ] Verify report reads payroll logs/history.
- [ ] Verify archived weeks remain readable.
- [ ] Verify current week does not overwrite archived weeks.
- [ ] Verify APM/Boss permissions still apply.

Result: PENDING IMPLEMENTATION QA

## Material Summary

- [ ] Verify report reads purchase/delivery/issuance history.
- [ ] Verify material spent is based on receiving cost only.
- [ ] Verify issuance does not double-count budget.
- [ ] Verify inventory movement history is readable.

Result: PENDING IMPLEMENTATION QA

## Billing Summary

- [ ] Verify report reads `billingRollups`.
- [ ] Verify linked collections and allocations are reflected.
- [ ] Verify retention receivable is shown separately.
- [ ] Verify deductions reduce receivable correctly.
- [ ] Verify output snapshots remain immutable.

Result: PENDING IMPLEMENTATION QA

## Cash Flow

- [ ] Verify cash in equals billing collections.
- [ ] Verify cash out equals labor payroll plus material receiving cost.
- [ ] Verify issuance does not count as cash out unless separately configured.
- [ ] Verify period filtering works weekly/monthly.

Result: PENDING IMPLEMENTATION QA

## Weekly / Monthly / Executive Reports

- [x] Generate weekly report snapshot helper exists.
- [x] Generate monthly report snapshot helper exists.
- [x] Generate executive/project summary snapshot helper exists.
- [x] Snapshot writes immutable JSON under `reportSnapshots`.
- [ ] Verify reports read archived records, not only current UI state.

Result: PASS STATIC / PENDING REAL FIREBASE SNAPSHOT QA

## Firebase / Performance

- [ ] Verify reports avoid scanning full histories where rollups are available.
- [ ] Verify report listeners detach when leaving project.
- [ ] Verify cross-project boss report does not create duplicate listeners.
- [x] Verify report paths are indexed.

Result: PENDING IMPLEMENTATION QA

## Known Limitations

- Existing report UI is still snapshot/project-field driven.
- Existing report UI is still partially project-field driven and needs UI wiring to the new helper layer.
- Full accounting/tax reports are outside v1.

## Static QA Results

- [x] `node --check report.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke test after cache v59: `report.js?v=59` loaded and Reports panel existed.
- [ ] Browser console clean after deployed Firebase rules: current live smoke still shows known audit-log permission warnings.
- [ ] Real Firebase rollup/snapshot test in QA project

## Stability Gate

Reports v1 can be marked STABLE when:

- [ ] Rollups are used as primary report source.
- [ ] Historical records are used for drill-down.
- [ ] Weekly/monthly snapshots are archived.
- [ ] Cross-project executive report performs acceptably.
- [ ] Real Firebase QA passes after refresh/app restart.
