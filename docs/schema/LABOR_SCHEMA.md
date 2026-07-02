# ACPM Labor v1 Schema

Status: STABLE - REAL FIREBASE CASH ADVANCE QA PASSED

This document is the production contract for the Labor module. Labor v1 keeps active work simple and archives compiled payroll permanently.

Final QA checklist: see [`QA_LABOR.md`](../qa/QA_LABOR.md).

## Workflow

Project -> Trades / Scopes -> Foreman per Trade -> Workers -> Cash Advances -> Attendance -> Payroll Compilation -> RFP -> Payroll Archive -> Reports

## Firebase Paths

```text
projects/{projectId}/payrollConfig
  type
  startDay
  overtimeThreshold
  nightDiffRate
  govDeductionsEnabled
  sssEmployerPct
  philhealthPct
  pagibigEmployerAmt

projects/{projectId}/trades/{tradeId}
  name
  foremanName
  paymentMethod
  notes
  createdAt
  settingsUpdatedAt
  settingsUpdatedBy

projects/{projectId}/workers/{workerId}
  name
  trade
  dailyRate
  addedAt
  addedBy

projects/{projectId}/attendance/{workerId}/{date}
  workerId
  date
  weekKey
  status
  regularHours
  overtimeHours
  nightDiffHours
  paidHours
  multiplier
  notes
  markedAt
  markedBy

projects/{projectId}/advances/{workerId}/{advanceId}
  date
  weekKey
  workerName
  trade
  amount
  notes
  status
  requestedBy
  requestedByUid
  requestedAt
  approvedBy
  approvedByName
  approvedAt
  rejectedBy
  rejectedByName
  rejectedAt
  releasedBy
  releasedByName
  releasedAt
  deducted
  deductedAmount
  lastDeductedAt
  closedBy
  closedByName
  closedAt
  statusHistory/{eventId}
  recordedBy
  recordedByUid
  addedAt
  addedBy

projects/{projectId}/cashAdvanceEvents/{eventId}
  type
  workerId
  advanceId
  status
  notes
  amount
  payrollLogId
  createdAt
  createdBy
  createdByName

projects/{projectId}/notificationEvents/{eventId}
  module
  type
  status
  consumed
  payload
  createdAt
  createdBy
  createdByName

projects/{projectId}/attendanceHistory/{logId}
  projectId
  weekStart
  weekEnd
  weekKey
  period
  entries[]
  savedAt
  compiledBy

projects/{projectId}/payrollLogs/{logId}
  projectId
  weekStart
  weekEnd
  weekKey
  period
  gross
  regular
  ot
  nightDiff
  cashAdvanceDeductions
  otherDeductions
  deductions
  net
  byTrade
  workerDetails
  attendance
  cashAdvancesDeducted
  govDeductions
  savedAt
  savedDate
  savedBy
  status
```

## Design Decisions

- Trades are the payroll grouping boundary. Each trade stores its own foreman and payment method.
- Workers keep their current trade name for v1 compatibility. Payroll archives also store worker trade, foreman, and rate so old weeks remain readable even if the live roster changes.
- Worker removal is a soft deactivation in RC1. `workers/{workerId}` remains in Firebase with `active = false`, `status = inactive`, inactive metadata, and status history. Attendance and cash advance rows are not deleted.
- Trade removal is a soft archive in RC1. `trades/{tradeId}` remains in Firebase with `status = archived` and archive metadata so historical trade/foreman/payment context remains recoverable.
- Active attendance is stored by worker/date. Each record carries `weekKey`, so the selected payroll period can be reset without touching other weeks.
- Active cash advances are stored by worker, with `weekKey`, trade, deducted amount, and paid status. This supports multiple advances per worker and running balances.
- Cash advances follow a full lifecycle: `draft`, `submitted`, `pending_approval`, `approved`, `rejected`, `released`, `deducted`, `closed`.
- New cash advance requests start as `pending_approval`. They are not deducted from payroll until marked `released`.
- Legacy advances without a `status` are treated as `released` for payroll compatibility, so old active balances do not require a migration.
- Cash advances are never deleted in the normal workflow. Incorrect or finished requests are closed with status history.
- `cashAdvanceEvents` stores immutable workflow events. `notificationEvents` stores notification hooks for future Notification module consumption; no live notification delivery is implemented in Labor v1.
- Payroll logs are immutable v1 archives. Each log stores the full `byTrade`, worker details, attendance snapshot, and cash advance deductions used at compile time.
- RFP output is generated per trade/foreman from the selected week. The generated text/PDF is derived from current attendance and trade settings.

## Indexes

Realtime Database rules define indexes for:

- `projects/{projectId}/trades`: `name`, `foremanName`
- `projects/{projectId}/workers`: `name`, `trade`, `active`, `addedAt`
- `projects/{projectId}/attendance/{workerId}`: `weekKey`, `date`
- `projects/{projectId}/advances/{workerId}`: `weekKey`, `date`, `deducted`, `trade`, `status`, `requestedByUid`, `approvedBy`, `releasedBy`, `closedAt`
- `projects/{projectId}/cashAdvanceEvents`: `type`, `workerId`, `advanceId`, `status`, `createdAt`
- `projects/{projectId}/notificationEvents`: `module`, `type`, `status`, `consumed`, `createdAt`
- `projects/{projectId}/attendanceHistory`: `savedAt`, `weekKey`
- `projects/{projectId}/payrollLogs`: `savedAt`, `weekKey`

## Known v1 Constraints

- The live worker record stores `trade` by name instead of `tradeId`. Archives are still safe because payroll logs snapshot trade and foreman details at compile time.
- Payroll archive is one log per compile, with trade groups nested under `byTrade`. It is not split into separate Firebase nodes per trade.
- There is no backend payroll validator yet. Firebase rules protect access and shape lightly, while payroll math still runs client-side.
- Cash advance approval is enforced in client helpers. Firebase rules index and shape the data, but role-specific approval validation is not server-enforced without Cloud Functions.
