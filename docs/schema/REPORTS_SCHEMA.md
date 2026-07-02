# ACPM Reports v1 Workflow and Rollup Architecture

Status: REPORTS V1 DATA/ROLLUP STABLE - REAL FIREBASE QA PASSED; BOSS BROWSER SMOKE PASSED; LISTENER STATIC QA PASSED

Reports v1 centralizes project, cost, revenue, cash flow, and executive reporting. Reports must read historical records and module rollups wherever practical instead of recalculating business totals ad hoc in the UI.

## Purpose

Reports answer management questions:

- How much is the project worth?
- How much has been spent?
- How much has been billed?
- How much has been collected?
- What is still receivable?
- What is the estimated profit?
- Which projects need attention?

## Current Snapshot

Current reporting behavior:

- Executive dashboard reads project fields.
- Budget variance reads `laborSpent`, `materialSpent`, and project budgets.
- Weekly report is generated from current project snapshots.
- Audit/team/admin reports are mixed into `report.js`.

Production updates:

- Visible executive dashboard, budget variance, project health, and weekly text report now use rollup-aware project summaries instead of raw `laborSpent/materialSpent` direct totals.
- Report data helpers now read Billing, Change Order, Site Log, Labor, and Materials rollup-compatible sources.
- Weekly/monthly report snapshots can now be archived as immutable JSON records.

## Target Reports

```text
Project Summary
Labor Summary
Material Summary
Billing Summary
Cash Flow
Profit Analysis
Weekly Summary
Monthly Summary
Executive Summary
```

## Data Source Priority

Reports should use this priority:

1. Immutable historical records
2. Module rollups rebuilt from history
3. Current project fields only for display metadata and compatibility

Examples:

```text
Labor cost -> labor rollups / payrollLogs
Material cost -> material receiving/movement history / materialSpent
Billing revenue -> billingRollups
Change order contract value -> approved change order history / billingRollups
Site activity -> siteLogs / siteLogRollups
```

## Firebase Structure

```text
projects/{projectId}/
  reportRollups/
    projectSummary/
      projectId
      projectName
      status
      contractAmount
      approvedChangeOrders
      totalBudget
      totalCost
      laborCost
      materialCost
      totalBilled
      totalCollected
      receivable
      estimatedProfit
      margin
      progressPct
      lastUpdatedAt
    weekly/{weekKey}/
      weekStart
      weekEnd
      laborCost
      materialCost
      billed
      collected
      cashFlow
      keyEvents
      createdAt
    monthly/{monthKey}/
      monthStart
      monthEnd
      laborCost
      materialCost
      billed
      collected
      receivable
      profit
      createdAt

  reportSnapshots/{snapshotId}/
    type
    periodKey
    generatedAt
    generatedBy
    sourceRollupVersion
    snapshot/
      projectSummary
      laborSummary
      materialSummary
      billingSummary
      cashFlow
      profitAnalysis
      notes
```

Cross-project boss reports can be generated from:

```text
projects/{projectId}/reportRollups/projectSummary
projects/{projectId}/billingRollups
projects/{projectId}/laborSpent
projects/{projectId}/materialSpent
```

## Rollup Rules

Project summary:

```text
totalCost = laborCost + materialCost + otherCost
estimatedProfit = totalCollected - totalCost
margin = estimatedProfit / totalCollected
receivable = billingRollups.receivable
```

Budget status:

```text
budgetUsedPct = totalCost / totalBudget
remainingBudget = totalBudget - totalCost
```

Cash flow:

```text
cashIn = billing collections
cashOut = labor payroll + material receiving cost + other cash expenses
netCashFlow = cashIn - cashOut
```

## Helper Functions Needed

| Helper | Purpose |
| --- | --- |
| `rebuildProjectReportRollup(projectId)` | Reads module rollups/history and writes project report summary. |
| `rebuildWeeklyReportRollup(projectId, weekKey)` | Builds weekly report from archived weekly records. |
| `rebuildMonthlyReportRollup(projectId, monthKey)` | Builds monthly report from historical records. |
| `listProjectReportRollups(filters)` | Reads summaries for dashboard/executive reporting. |
| `generateReportSnapshot(projectId, type, period)` | Saves immutable report snapshot. |
| `calculateCashFlow(projectId, period)` | Calculates cash in/out from history. |
| `calculateProfitAnalysis(projectId, period)` | Calculates revenue, costs, receivable, and margin. |
| `exportReport(projectId, type, options)` | Exports report from snapshot or rollup. |

Implemented helper functions in `report.js`:

- `rebuildProjectReportRollup(projectId)`
- `rebuildWeeklyReportRollup(projectId, weekKey)`
- `rebuildMonthlyReportRollup(projectId, monthKey)`
- `listProjectReportRollups(filters)`
- `generateReportSnapshot(projectId, type, period)`
- `calculateLaborSummary(projectId)`
- `calculateMaterialsSummary(projectId)`
- `calculateBillingSummary(projectId)`
- `calculateChangeOrderSummary(projectId)`
- `calculateSiteLogSummary(projectId)`
- `calculateCashFlow(projectId)`
- `calculateProfitAnalysis(projectId)`
- `exportReport(projectId, type)`

Real Firebase QA helper:

- `scripts/reports_v1_real_qa.js`

Real Firebase QA evidence, 2026-06-30:

- Result: PASS
- QA project: `qa_mr0saqj7_ckl0p39g`
- Project name: `QA_RC1_Reports_v78_1782832263376`
- Snapshot: `qa_mr0sarpv_kp1e7mya`
- Verified persisted `reportRollups/projectSummary`.
- Verified immutable `reportSnapshots/{snapshotId}`.
- Verified project, labor, material, billing, change order, site log, cash flow, and profit summaries.
- QA project was archived after the run.

## Firebase Indexes Needed

```json
"reportRollups": {
  ".indexOn": ["lastUpdatedAt"]
},
"reportSnapshots": {
  ".indexOn": ["type", "periodKey", "generatedAt", "generatedBy"]
}
```

## Known Limitations

- Boss browser visual smoke passed after cache `acpm-v85` with `report.js?v=84`; app-shell reload confirmed `report.js?v=86`.
- Cross-project reporting currently uses three tracked project listeners for Executive, Team, and Budget views. Static listener QA passes, but large-company performance profiling is future work.
- Formal accounting reports are outside v1; this is operational construction reporting.
- Real Firebase QA creates permanent archived QA records.

## Completion Definition

Reports v1 RC1 gate:

- [x] Project reports read module rollups and historical records.
- [x] Weekly/monthly report snapshots can be regenerated and archived.
- [x] Visible report widgets use rollup-aware project summaries.
- [x] Revenue and cost remain separated.
- [x] Real Firebase rollup/snapshot QA passed.
- [x] Boss browser smoke after `report.js?v=84`.
- [x] App refresh visual QA for signed-in Boss workspace route.
- [x] Cross-project report listener hygiene static QA.
