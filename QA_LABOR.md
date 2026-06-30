# Labor v1 Final QA

Status: STABLE - REAL FIREBASE CASH ADVANCE QA PASSED

Labor v1 baseline was stable before Materials v1. Cash Advance approval workflow was later redesigned for production integrity and verified against the real Firebase backend for ACPM Release Candidate 1.

## RC1 Real Firebase QA - 2026-06-30

PASS:

- QA runner: `scripts/labor_v1_cash_advance_real_qa.js`
- Real Firebase project created and archived:
  - `projectId = qa_mr0su95p_uhl84j7m`
  - `projectName = QA_RC1_LaborCashAdvance_1782833173981`
  - `payrollLogId = qa_mr0su95p_my097b13`
- Verified trade-specific foremen were archived under payroll `byTrade`.
- Verified pending, approved-but-unreleased, and rejected cash advances remained historical and were not deducted.
- Verified released cash advances deducted only from the correct worker and trade.
- Verified full deduction closed the advance.
- Verified partial deduction remained `deducted` with remaining balance.
- Verified `statusHistory`, `cashAdvanceEvents`, and `notificationEvents` were written.
- Verified archived attendance and payroll stayed readable after the QA project was archived.

Deductions verified:

```text
Carpenter released advance deducted = 1000
Electrical released advance deducted = 560
Total cash advance deduction = 1560
```

Bugs found and fixed before user QA:

- Cash advance event hooks and Labor notification hooks could make the UI report failure if a future/deployed hook rule drifted. They are now best-effort, so the primary cash advance workflow continues even if an event hook is denied.

## Scope

Workflow under test:

Project -> Trades / Scopes -> Foreman per Trade -> Workers -> Cash Advances -> Attendance -> Payroll Compilation -> RFP -> Payroll Archive -> Reports

## Pre-QA Setup

- Use a test project or a real project with known sample workers.
- Create at least two trades/scopes.
- Assign a different foreman/payment method to each trade.
- Add at least two workers per trade.
- Add at least one cash advance to workers in different trades.
- Use one selected weekly period only while testing compile/RFP.

## Required Pass Checks

### 1. Trade-Based Structure

- PASS when each trade stores its own `foremanName`, `paymentMethod`, and optional `notes`.
- PASS when workers are grouped by trade in the attendance grid.
- PASS when payroll summary displays each trade separately.
- PASS when no project-level foreman is required for payroll/RFP.

### 2. Archived Payroll Reopen Safety

- PASS when expanding Payroll Logs Archive does not write to live `attendance`, `advances`, or `workers`.
- PASS when expanding Archived Attendance Records does not change current week attendance.
- PASS when selecting a previously compiled week only shows a warning and does not overwrite current week data.
- PASS when current week attendance remains unchanged after opening archived payroll/attendance cards.

Verified code paths:

- `watchPayrollLogs()` reads `projects/{projectId}/payrollLogs`.
- `togglePayrollLog()` only toggles DOM visibility.
- `watchTimecardHistory()` reads `projects/{projectId}/attendanceHistory`.
- `toggleTCHistory()` only toggles DOM visibility.

### 3. RFP vs Trade / Foreman Archive

- PASS when generated RFP sections are separated by trade.
- PASS when each RFP section shows the trade foreman from the same trade settings used by payroll compilation.
- PASS when RFP worker totals match the selected week attendance before payroll compile.
- PASS when payroll archive `byTrade.{trade}.foremanName` matches the RFP foreman if RFP is generated before any later trade setting change.

Known limitation:

- Regenerated RFP uses current trade settings. If a foreman/payment method is edited after payroll compile, regenerated RFP may differ from archived `byTrade`. For v1, generate or save/export the RFP during the payroll run.

### 4. Cash Advance Balance

- PASS when multiple advances per worker are allowed.
- PASS when a new advance starts as `pending_approval`.
- PASS when pending approval, approved-but-not-released, rejected, and closed advances are not deducted by payroll.
- PASS when only `released` or legacy active advances are eligible for payroll deduction.
- PASS when payroll deducts only from the worker who received the advance.
- PASS when deduction is capped by the current amortization rule.
- PASS when `deductedAmount` increases by exactly the payroll deduction.
- PASS when partial deduction changes status to `deducted`.
- PASS when `deducted` becomes `true` and status becomes `closed` only after `deductedAmount >= amount`.
- PASS when advance deduction appears under the correct trade group.
- PASS when rejected and closed cash advances remain visible in history.
- PASS when `cashAdvanceEvents` receives request, approval/release/reject/close, and payroll deduction events.
- PASS when `notificationEvents` receives pending notification hooks but no actual Notification module delivery is triggered.

Verified code paths:

- `compilePayroll()` calculates remaining balance as `amount - deductedAmount`.
- `compilePayroll()` ignores cash advances that are not released/legacy-eligible.
- `confirmSavePayroll()` writes updated `deductedAmount`, `deducted`, `lastDeductedAt`, `status`, and `statusHistory`.
- Payroll archive stores deductions in `cashAdvancesDeducted`.

### 5. Listener Cleanup

- PASS when opening another project calls `initLabor(projectId)` and old Labor listeners are detached first.
- PASS when switching week does not create new persistent Firebase listeners.
- PASS when roster, attendance grid, and advance log update from the shared Labor snapshots.
- PASS when leaving workspace calls `detachLaborListeners()`.

Verified code paths:

- `initLabor()` calls `detachLaborListeners()` before creating new listeners.
- `detachLaborListeners()` detaches Labor listeners and archived attendance history listener.
- `applyWeek()` performs one-time reads only.
- `renderLaborWorkspaceViews()` coordinates roster/attendance rendering from cached snapshots.

### 6. Duplicate Firebase Reads / Listeners

- PASS when persistent listeners are limited to:
  - `projects/{projectId}`
  - `projects/{projectId}/trades`
  - `projects/{projectId}/workers`
  - `projects/{projectId}/attendance`
  - `projects/{projectId}/advances`
  - `projects/{projectId}/attendanceHistory`
  - `projects/{projectId}/payrollLogs`
- PASS when compile/RFP/export actions use one-time reads only.
- PASS when no nested persistent listeners are created inside other persistent listeners.

### 7. Firebase Rules Indexes

- PASS when rules include indexes matching Labor query paths:
  - `projects/{projectId}/trades`: `name`, `foremanName`
  - `projects/{projectId}/workers`: `name`, `trade`, `active`, `addedAt`
  - `projects/{projectId}/attendance/{workerId}`: `weekKey`, `date`
  - `projects/{projectId}/advances/{workerId}`: `weekKey`, `date`, `deducted`, `trade`, `status`, `requestedByUid`, `approvedBy`, `releasedBy`, `closedAt`
  - `projects/{projectId}/cashAdvanceEvents`: `type`, `workerId`, `advanceId`, `status`, `createdAt`
  - `projects/{projectId}/notificationEvents`: `module`, `type`, `status`, `consumed`, `createdAt`
  - `projects/{projectId}/attendanceHistory`: `savedAt`, `weekKey`
  - `projects/{projectId}/payrollLogs`: `savedAt`, `weekKey`

## Release Decision

Labor v1 is marked STABLE when:

- All required pass checks are complete.
- Known limitations remain acceptable.
- Firebase rules are deployed/imported to production.
- A manual JSON backup is downloaded before real payroll use.

## Known Limitations

- Workers still store `trade` by name, not `tradeId`.
- Payroll archive is one log per compile with nested `byTrade`, not separate Firebase nodes per trade.
- RFP is generated from selected week live attendance/current trade settings, not from a stored archived RFP node.
- Payroll math is client-side; no backend payroll validator exists yet.
- Cash advance approval/release permissions are enforced in client helpers, not server-side Cloud Functions.
- Firebase rules indexes must be deployed/imported before production use.

## Final Mark

Labor v1 baseline: STABLE

Cash Advance approval workflow: STABLE - REAL FIREBASE QA PASSED

Ready for: Materials v1
