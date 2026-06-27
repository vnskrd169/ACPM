# Labor v1 Final QA

Status: STABLE

Labor v1 is ready for final manual QA before Materials v1. This checklist is limited to verification and release confidence. Do not add new Labor features during this pass.

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
- PASS when payroll deducts only from the worker who received the advance.
- PASS when deduction is capped by the current amortization rule.
- PASS when `deductedAmount` increases by exactly the payroll deduction.
- PASS when `deducted` becomes `true` only after `deductedAmount >= amount`.
- PASS when advance deduction appears under the correct trade group.

Verified code paths:

- `compilePayroll()` calculates remaining balance as `amount - deductedAmount`.
- `confirmSavePayroll()` writes updated `deductedAmount`, `deducted`, and `lastDeductedAt`.
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
  - `projects/{projectId}/advances/{workerId}`: `weekKey`, `date`, `deducted`, `trade`
  - `projects/{projectId}/attendanceHistory`: `savedAt`, `weekKey`
  - `projects/{projectId}/payrollLogs`: `savedAt`, `weekKey`

## Release Decision

Labor v1 can be marked STABLE when:

- All required pass checks are complete.
- Known limitations remain acceptable.
- Firebase rules are deployed/imported to production.
- A manual JSON backup is downloaded before real payroll use.

## Known Limitations

- Workers still store `trade` by name, not `tradeId`.
- Payroll archive is one log per compile with nested `byTrade`, not separate Firebase nodes per trade.
- RFP is generated from selected week live attendance/current trade settings, not from a stored archived RFP node.
- Payroll math is client-side; no backend payroll validator exists yet.
- Firebase rules indexes must be deployed/imported before production use.

## Final Mark

Labor v1: STABLE

Ready for: Materials v1
