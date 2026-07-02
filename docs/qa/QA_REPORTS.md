# ACPM Reports v1 QA Checklist

Status: REPORTS V1 DATA/ROLLUP STABLE - REAL FIREBASE QA PASSED; BOSS BROWSER SMOKE PASSED; LISTENER STATIC QA PASSED

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

Result: PASS - REAL FIREBASE QA

## Labor Summary

- [x] Helper `calculateLaborSummary(projectId)` reads payroll log history where present.
- [x] Verify archived payroll log source remains readable.
- [x] Verify report helper reads historical payroll log rows without overwriting them.
- [x] Verify Boss/Admin report access is enforced by report role helper and browser smoke.
- [ ] Verify PM/APM account-specific report visibility when dedicated role credentials exist.

Result: PASS HELPER QA + BOSS BROWSER QA / PM/APM ROLE-ACCOUNT QA PENDING

## Material Summary

- [x] Helper `calculateMaterialsSummary(projectId)` reads purchase/delivery/issuance/movement history where present.
 - [x] Verify material spent/receiving history is readable.
 - [x] Verify issuance quantity is tracked separately and does not double-count material cost in reports.
 - [x] Verify inventory movement history is readable.

Result: PASS - REAL FIREBASE QA

## Billing Summary

- [x] Helper `calculateBillingSummary(projectId)` reads `billingRollups`.
- [x] Verify billing rollup values are reflected.
- [x] Verify retention receivable is shown separately.
- [x] Verify receivable/profit read from rebuilt billing-compatible rollup.
- [x] Verify report snapshots remain immutable JSON records.

Result: PASS - REAL FIREBASE QA

## Cash Flow

- [x] Verify cash in equals billing collections.
- [x] Verify cash out equals labor/material/other cost summary.
- [x] Verify issuance does not count as extra cash out in report rollup.
- [x] Verify weekly/monthly snapshot period keys are archived through `generateReportSnapshot()`, `rebuildWeeklyReportRollup()`, and `rebuildMonthlyReportRollup()`.

Result: PASS CORE SNAPSHOT QA / DEDICATED PERIOD FILTER UI IS FUTURE POLISH

## Weekly / Monthly / Executive Reports

- [x] Generate weekly report snapshot helper exists.
- [x] Generate monthly report snapshot helper exists.
- [x] Generate executive/project summary snapshot helper exists.
- [x] Snapshot writes immutable JSON under `reportSnapshots`.
- [x] Snapshot includes project, labor, material, billing, change order, site log, cash flow, and profit summary blocks.
 - [x] Verify reports read archived/historical records, not only current UI state.

Result: PASS - REAL FIREBASE SNAPSHOT QA

## Firebase / Performance

- [x] Verify reports prefer module rollups where available.
- [x] Verify report listeners detach when leaving project.
- [x] Verify Team Admin, Audit Log, and lifecycle listeners detach through `detachReportsListeners()`.
- [x] Verify cross-project report listener hygiene through static listener QA.
- [x] Verify report paths are indexed.

Result: PASS STATIC

## Known Limitations

- Boss browser smoke after cache `acpm-v85` passed with `report.js?v=84` loaded and no console errors.
- Full accounting/tax reports are outside v1.
- `scripts/reports_v1_real_qa.js` now creates a minimal rule-compliant project first, then patches report fixtures, so real QA follows the deployed RC1 Firebase write rules instead of relying on privileged fixture shapes.

## Static QA Results

- [x] `node --check report.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke test after cache v59: `report.js?v=59` loaded and Reports panel existed.
- [x] `node --check scripts/reports_v1_real_qa.js`
- [x] `node scripts/rc1_static_gate.js` verifies `detachReportsListeners()` detaches report, team, audit, and lifecycle listeners.
- [x] `node scripts/rc1_static_gate.js` verifies Admin Audit Log reads and labels project/supplier fallback audit rows.
- [x] `node scripts/reports_listener_static_qa.js` verifies report listener hygiene:
  - `initReports()` detaches before attaching.
  - Executive, Team, and Budget report views each register exactly one tracked `projects` listener.
  - Report, Team Admin, Audit, fallback Audit, and Lifecycle Request listeners are cleaned up.
  - Listener diagnostics export exists for manual browser-console inspection.
- [x] Real Firebase rollup/snapshot test in archived QA project:
  - Script: `scripts/reports_v1_real_qa.js`
  - Result: PASS
  - Project: `qa_mr0saqj7_ckl0p39g`
  - Snapshot: `qa_mr0sarpv_kp1e7mya`
- [x] Browser smoke test after cache v85:
  - Signed-in Boss workspace route rendered.
  - Reports button was reachable.
  - Reports area rendered.
  - Loaded `auth.js?v=85`, `utils.js?v=84`, and `report.js?v=84`.
  - Console errors: none.
- [x] Browser app-shell reload after cache v86:
  - Loaded `auth.js?v=85`, `utils.js?v=84`, and `report.js?v=86`.
  - Deeper click retry timed out in browser automation; no new app error was captured before timeout.
- [x] Browser read-only smoke after cache v92:
  - Signed-in Boss workspace route rendered through the then-current `main.js?v=90` and `style.css?v=92`.
  - Reports tab opened from the visible workspace nav.
  - Executive Dashboard / Weekly Report content rendered.
  - Console errors: none.
  - Console warnings: known deployed audit-log permission warning only.
- [x] Browser console has no app errors in Boss Reports smoke.
- [x] Known global audit warning is covered by project/supplier fallback audit QA.

## Stability Gate

Reports v1 can be marked STABLE when:

- [x] Rollups are used as primary report source.
- [x] Historical records are used for drill-down.
- [x] Weekly/monthly snapshots are archived.
- [x] Cross-project report listener hygiene passes static QA.
- [x] Real Firebase data QA passes.
- [x] Boss browser refresh smoke passes for Reports panel.
