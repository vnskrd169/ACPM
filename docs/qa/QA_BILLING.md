# ACPM Billing v1 QA Checklist

Status: BILLING V1 PHASE 2 STABLE - REAL FIREBASE QA + BROWSER UI/DASHBOARD SMOKE PASSED

Authoritative detailed Phase 2 evidence lives in `QA_BILLING_PHASE2.md`.

This file is the RC1 summary so the release audit does not mix current pass evidence with superseded pre-fix checklists.

## Scope

- Billing tracks revenue, collections, receivables, retention, deductions, and billing output archives.
- Labor and Materials remain cost sources.
- `billingRollups` are rebuilt from historical records, not increment/decrement totals.
- Dashboard and Reports consume persisted rollups where practical.
- No Labor or Materials files were modified for Billing Phase 2.

## Firebase Paths

```text
projects/{projectId}/contract
projects/{projectId}/billingConfig
projects/{projectId}/billings
projects/{projectId}/collections
projects/{projectId}/billingAllocations
projects/{projectId}/retentionLedger
projects/{projectId}/billingAdjustments
projects/{projectId}/billingOutputs
projects/{projectId}/billingEvents
projects/{projectId}/billingRollups
```

## Phase 1 Rollup Rebuild Evidence

Result: PASS - RESOLVED 2026-06-28

Fixed root cause:

- `billingSnapRows()` previously returned the result of `Array.push()` inside `snapshot.forEach()`.
- Firebase Realtime Database stops iterating when the callback returns `true`.
- Because `push()` returns a number, rebuilds could read only the first child row.
- Fix: use a block callback and explicitly return `false`.

Verified after fix:

- Multiple billings are included.
- Multiple collections are included.
- Rejected adjustments are ignored.
- Voided billings/collections remain historical and are ignored by active totals.
- Page refresh/app restart keeps rollups correct.
- Billing dashboard reads corrected `billingRollups`.

Historical QA project:

```text
projectId = -Ow60wuOtFmGmXo1cBOp
```

Final active rollup after cleanup:

```text
contractAmount = 100000
approvedChangeOrders = 0
totalBilled = 42000
totalCollected = 10000
receivable = 32000
laborCost = 0
materialCost = 35
estimatedProfit = 9965
```

## Phase 2 Workflow Evidence

Result: PASS - REAL FIREBASE HELPER QA + BROWSER SMOKE

QA runner:

```text
scripts/billing_phase2_real_qa.js
```

Final expanded real Firebase project:

```text
projectId = qa_mr0fje94_un0q8n4t
projectName = QA_RC1_Billing_Phase2_v74_1782810832360
qaRunResult = PASS
```

Verified:

- Linked collections support partial payments.
- Overpayment allocation is blocked.
- Unallocated/auto allocation compatibility works.
- Downpayment and mobilization billings count as revenue, never cost.
- Retention held/released/outstanding values rebuild correctly.
- Deductions affect receivable/revenue correctly and do not touch Labor/Materials cost.
- Voided approved deductions remain historical and are ignored by rollups.
- Billing output snapshots are immutable after source project/client edits.
- Excess auto-allocation leaves unapplied cash.
- Standalone non-cash retention release works.
- Dashboard reads persisted `billingRollups` after route restart.
- Browser Billing tab smoke verified Phase 2 controls rendered with zero console errors.

Rollup evidence from Phase 2 QA:

```text
contractAmount = 100000
totalBilled = 26000
totalCollected = 24000
totalRetentionHeld = 1200
totalRetentionCollected = 1000
retentionReceivable = 0
totalDeductions = 500
totalAllocatedCollections = 22500
totalAppliedCollections = 23500
unappliedCollections = 500
receivable = 1800
laborCost = 1500
materialCost = 2000
estimatedProfit = 20500
```

## Rules / Index QA

Result: PASS LOCAL RULES PARSE + LIVE FIREBASE PATH WRITE QA

- `database.rules.json` parses.
- Billing paths are indexed:
  - `billingConfig`
  - `billings`
  - `collections`
  - `billingAllocations`
  - `retentionLedger`
  - `billingAdjustments`
  - `billingOutputs`
  - `billingEvents`
  - `billingRollups`
- Real Firebase accepted Phase 2 write paths during helper QA.
- Current RC1 post-deploy gate includes Billing syntax checks.

## Bugs Found And Fixed Before User QA

- Rebuild iteration bug caused stale rollups after later billing/collection transactions.
- Helper-created collections were temporarily counted by both legacy `collection.billingId` compatibility and explicit allocation rows.
- `unappliedCollections` subtracted only regular billing allocations before retention cash applications were included.
- UI retention action wrote only a non-cash ledger release before being corrected to record retention collection when cash is received.
- Voided approved deductions were still counted through stale totals before `billingDeductionTotal()` was corrected.

## Known Limitations

- Billing UI is functional/minimal, not fully redesigned.
- Billing output archive is JSON/text-first, not a polished PDF or tax-certified invoice.
- Firebase Realtime Database rules cannot fully enforce all accounting immutability/concurrency rules without Cloud Functions.
- Heavy concurrent collection allocation may eventually need server-side transaction enforcement.
- Existing legacy billings/collections may need manual migration if exact billing-level allocation history is required for pre-v1 records.

## RC1 Stability Gate

- [x] Contract, downpayment, progress billing, collections, retention, deductions, and change-order-compatible billings are historical.
- [x] Partial collections update receivables correctly.
- [x] Billing outputs are archived as immutable snapshots.
- [x] Dashboard reads revenue, collected, receivable, cost, and estimated profit from rollups.
- [x] Reports can read Billing rollups.
- [x] Real Firebase Phase 2 QA passed.
- [x] Browser Billing tab smoke passed.
- [x] Syntax checks pass through `scripts/rc1_post_deploy_gate.js`.

Final RC1 decision:

```text
BILLING V1 PHASE 2 STABLE.
```
