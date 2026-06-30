# ACPM Dashboard Rollup Integration

Status: ROLLUP INTEGRATION DATA QA PASSED - BOSS BROWSER SMOKE PASSED; GLOBAL QA STILL PENDING

The dashboard should summarize project health from module rollups where available, while preserving legacy field fallbacks for older projects.

## Source Priority

```text
projects/{projectId}/reportRollups/projectSummary
projects/{projectId}/billingRollups
projects/{projectId}/laborSpent + materialSpent legacy fields
```

## Implemented Dashboard Helpers

In `main.js`:

- `dashboardRollup(project)`
- `dashboardLaborSpent(project)`
- `dashboardMaterialSpent(project)`
- `dashboardOtherSpent(project)`
- `dashboardTotalSpent(project)`
- `dashboardPendingApprovalItems(projects)`
- `dashboardRecentItems(projects)`

## Displayed Fields

Project cards now use rollup-aware cost totals for:

- labor spent
- material spent
- other spent
- total spent
- remaining budget
- budget used percentage
- warning/critical budget alerts
- CSV export totals

Reports/executive dashboard widgets now use the same rollup-aware project summaries for:

- executive total spent
- executive health cards
- budget variance
- weekly text export budget line

When billing/report rollups exist, project cards also show:

- contract amount or adjusted contract amount
- total billed
- total collected
- receivable

Dashboard alert/recent activity helpers also read:

- pending `lifecycleRequests`
- pending project `notificationEvents`
- open Site Log issues/delays from report/site-log rollups

## Known Limitations

- Dashboard shows pending lifecycle/notification event counts in the alerts bar, but does not yet have a dedicated approvals panel.
- Dashboard still relies on project snapshots loaded through the existing hub listener.
- Full cross-module alert drill-down is not implemented yet.
- Real Firebase report rollup QA passed on archived QA project `qa_mr0saqj7_ckl0p39g`.
- Browser dashboard smoke after `report.js?v=78` / `sw.js` cache `acpm-v78` is still pending.
