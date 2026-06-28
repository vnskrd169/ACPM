# ACPM Reports v1 QA Checklist

Status: ARCHITECTURE READY - IMPLEMENTATION PENDING

Scope:

- No UI redesign.
- Reports should read historical data and rollups wherever practical.

## Project Summary

- [ ] Rebuild project report rollup.
- [ ] Verify project name/status come from project metadata.
- [ ] Verify contract amount and approved change orders come from Billing/Change Order history.
- [ ] Verify labor cost comes from Labor rollups/history.
- [ ] Verify material cost comes from Materials receiving/history.
- [ ] Verify total billed, collected, and receivable come from `billingRollups`.
- [ ] Verify estimated profit and margin are calculated from collected revenue minus costs.

Result: PENDING IMPLEMENTATION QA

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

- [ ] Generate weekly report snapshot.
- [ ] Generate monthly report snapshot.
- [ ] Generate executive summary.
- [ ] Verify snapshots do not change after project settings change.
- [ ] Verify reports read archived records, not only current UI state.

Result: PENDING IMPLEMENTATION QA

## Firebase / Performance

- [ ] Verify reports avoid scanning full histories where rollups are available.
- [ ] Verify report listeners detach when leaving project.
- [ ] Verify cross-project boss report does not create duplicate listeners.
- [ ] Verify report paths are indexed.

Result: PENDING IMPLEMENTATION QA

## Known Limitations

- Existing report UI is still snapshot/project-field driven.
- Report snapshots and centralized report rollups are not implemented yet.
- Full accounting/tax reports are outside v1.

## Stability Gate

Reports v1 can be marked STABLE when:

- [ ] Rollups are used as primary report source.
- [ ] Historical records are used for drill-down.
- [ ] Weekly/monthly snapshots are archived.
- [ ] Cross-project executive report performs acceptably.
- [ ] Real Firebase QA passes after refresh/app restart.
