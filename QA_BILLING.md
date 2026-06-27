# ACPM Billing v1 Phase 1 QA Checklist

Status: PHASE 1 REAL FIREBASE QA FAILED - NOT STABLE

## Real Firebase QA Results - 2026-06-27

Project tested:

```text
projectId = -Ow60wuOtFmGmXo1cBOp
projectName = asd
```

Test data used:

```text
Contract amount: 100,000
Billing #1: 30,000
Collection #1: 10,000
Approved change order test row: 5,000
Billing #2: 20,000
Collection #2: 15,000
```

### Result Summary

| Item | Result | Evidence |
| --- | --- | --- |
| Save contract amount | PASS | Contract saved to Firebase with `contractAmount = 100000`; UI showed contract dashboard. |
| Create billing #1 | PASS | `billings` contains `BILL-0001`, amount `30000`, status later updated to `approved`. |
| Approve billing #1 | PASS | Billing #1 status became `approved`; `billingEvents` wrote `billing_approved`. |
| Record partial collection | PASS | `collections` contains `COL-0001`, `netCashReceived = 10000`. |
| Confirm first receivable | PASS | Rollup after first cycle: `totalBilled = 30000`, `totalCollected = 10000`, `receivable = 20000`. |
| Create billing #2 | PASS | `billings` contains `BILL-0002`, amount `20000`. |
| Record another collection | PASS | `collections` contains `COL-0002`, amount `15000`. |
| Add adjustment/change order if supported | WARNING | Added approved change-order QA row via Firebase REST; `approvedChangeOrders` became `5000`. This was not tested through a Billing UI. |
| Confirm rollups after billing #2 / collection #2 | FAILED | Expected active totals before cleanup: `totalBilled = 50000`, `totalCollected = 25000`, `receivable = 25000`. Stored `billingRollups` remained `totalBilled = 30000`, `totalCollected = 10000`, `receivable = 20000`. |
| Void billing/collection and preserve history | WARNING | Billing #2 and Collection #2 were voided by Firebase REST cleanup and rows remained present. Browser automation stopped responding during reload, so UI void flow was not fully verified. |
| Confirm `billingEvents` are written | PASS | Events found: `contract_create`, `billing_submit`, `billing_approved`, `collection_post`, `billing_submit`, `collection_post`, `billing_approved`, `billing_void`, `collection_void`. |
| Confirm dashboard reads billing rollups correctly | FAILED | Not confirmed. Current Billing UI dashboard visibly reads live `billings`/`collections`; stored `billingRollups` were stale after the second cycle. |

### Rollup Values Observed

Before void cleanup, expected active rollup should have been:

```text
contractAmount = 100000
approvedChangeOrders = 5000
totalBilled = 50000
totalCollected = 25000
receivable = 25000
laborCost = 0
materialCost = 35
estimatedProfit = 24965
```

Stored Firebase `billingRollups` before cleanup:

```text
contractAmount = 100000
approvedChangeOrders = 5000
totalBilled = 30000
totalCollected = 10000
receivable = 20000
laborCost = 0
materialCost = 35
estimatedProfit = 9965
```

After cleanup:

```text
Billing #2 status = voided, row preserved
Collection #2 status = voided, row preserved
QA change-order test row status = rejected after verification
Billing #1 and Collection #1 remain active
```

### Phase 1 Stability Decision

Billing v1 Phase 1 is NOT STABLE yet.

Blocking issue:

- `billingRollups` can become stale after later billing/collection transactions. Historical rows are saved, but rollup recalculation did not include Billing #2 and Collection #2 during real Firebase QA.

Required before marking STABLE:

- Fix rollup recalculation so every billing create/status change, collection post/void, adjustment, and change-order-impact trigger rebuilds from the authoritative Firebase history.
- Re-run the same real Firebase test and confirm expected active totals before any cleanup.
- Confirm dashboard/report consumers read the corrected rollup values or intentionally read live history with documented behavior.

Scope:

- Backend/data foundation only.
- No Billing UI redesign.
- Labor v1 and Materials v1 remain frozen.

## Files and Paths to Verify

Firebase paths:

```text
projects/{projectId}/contract
projects/{projectId}/billingConfig
projects/{projectId}/billings
projects/{projectId}/collections
projects/{projectId}/billingAdjustments
projects/{projectId}/billingEvents
projects/{projectId}/billingRollups
projects/{projectId}/billingOutputs
```

## Phase 1 Helper QA

### Contract

- [ ] Call existing Contract Save UI.
- [ ] Verify `projects/{projectId}/contract` stores both compatibility fields and v1 fields:
  - `amount`
  - `originalAmount`
  - `client`
  - `clientName`
  - `downPct`
  - `downPaymentPct`
  - `downPayment`
  - `downPaymentAmount`
  - `retention`
  - `retentionPct`
- [ ] Verify contract save writes one `billingEvents` row with `contract_create` or `contract_update`.
- [ ] Verify contract save recalculates `billingRollups`.
- [ ] Verify contract save does not create an automatic hidden collection.

Result: PENDING MANUAL QA

### Billing Creation

- [ ] Create a Billing Request using the existing UI.
- [ ] Verify a row is created under `billings`.
- [ ] Verify fields:
  - `billingNo`
  - `seq`
  - `type`
  - `status`
  - `grossAmount`
  - `amount`
  - `netBillable`
  - `receivableBalance`
  - `createdAt`
  - `createdBy`
- [ ] Verify `billingEvents` receives `billing_submit`.
- [ ] Verify `billingRollups.totalBilled` increases.
- [ ] Verify `billingRollups.totalCollected` does not increase from billing creation alone.

Result: PENDING MANUAL QA

### Billing Approval

- [ ] Run `approveBilling(projectId, billingId)` from browser console or future UI action.
- [ ] Verify billing status becomes `approved`.
- [ ] Verify `approvedAt` and `approvedBy` are saved.
- [ ] Verify `billingEvents` receives `billing_approve`.
- [ ] Verify rollups recalculate without changing cost.

Result: PENDING MANUAL QA

### Collections

- [ ] Add a collection using the existing UI.
- [ ] Verify a row is created under `collections`.
- [ ] Verify fields:
  - `collectionNo`
  - `amountReceived`
  - `amount`
  - `netCashReceived`
  - `status`
  - `createdAt`
  - `createdBy`
- [ ] Verify `billingEvents` receives `collection_post`.
- [ ] Verify `billingRollups.totalCollected` increases.
- [ ] Verify collection does not reduce `laborSpent`, `materialSpent`, or any cost field.
- [ ] Verify `billingRollups.receivable` decreases based on active billings minus active collections.

Result: PENDING MANUAL QA

### Linked Partial Collection

- [ ] Run `recordCollection(projectId, { billingId, amount })` against a billing with a larger `netBillable`.
- [ ] Verify billing `collectedAmount` increases.
- [ ] Verify billing `receivableBalance` decreases.
- [ ] Verify billing status becomes `partially_collected` while balance remains.
- [ ] Post remaining balance and verify status becomes `collected`.

Result: PENDING MANUAL QA

### Adjustments

- [ ] Run `createAdjustment(projectId, { billingId, type: 'deduction', amount, reason })`.
- [ ] Verify row exists under `billingAdjustments`.
- [ ] Verify `billingEvents` receives `deduction_post`.
- [ ] Verify `billingRollups.totalDeductions` increases.

Result: PENDING MANUAL QA

### Rollups

- [ ] Run `calculateBillingRollup(projectId)`.
- [ ] Verify rollup fields:
  - `contractAmount`
  - `approvedChangeOrders`
  - `totalBilled`
  - `totalCollected`
  - `receivable`
  - `laborCost`
  - `materialCost`
  - `estimatedProfit`
- [ ] Verify revenue values come only from billings/collections.
- [ ] Verify cost values come only from `laborSpent` and `materialSpent`.
- [ ] Verify `estimatedProfit = totalCollected - laborCost - materialCost`.

Result: PENDING MANUAL QA

### Void / History Preservation

- [ ] Void a billing using the existing delete button.
- [ ] Verify billing row remains under `billings`.
- [ ] Verify status becomes `voided`.
- [ ] Verify `voidedAt`, `voidedBy`, and `voidReason` exist.
- [ ] Verify `billingEvents` receives `billing_void`.
- [ ] Void a collection using the existing delete button.
- [ ] Verify collection row remains under `collections`.
- [ ] Verify `billingEvents` receives `collection_void`.

Result: PENDING MANUAL QA

## Firebase Rules and Index QA

- [ ] Confirm `database.rules.json` includes indexes for:
  - `billingConfig`
  - `billings`
  - `collections`
  - `billingAdjustments`
  - `billingEvents`
  - `billingOutputs`
  - `billingRollups`
- [ ] Confirm project-level read/write permissions still protect Billing paths.
- [ ] Confirm `billingEvents` requires `type`, `createdAt`, and `createdBy`.

Result: PENDING MANUAL QA

## Known Limitations

- No polished Billing UI redesign yet.
- Existing UI still has simple billing and collection forms.
- Collections can be posted without selecting a billing from the current UI; linked collection is helper-supported but not fully exposed in UI.
- Existing status dropdown still allows status-only changes; revenue and receivable rollups still rely on collection records, not status labels.
- Downpayment/mobilization billing is schema/helper-ready but not fully exposed as a dedicated UI workflow.
- Retention and deductions are supported by fields/helpers but need Phase 2 UI.
- Invoice/RFP output archive path is indexed but not generated yet.
- Firebase Realtime Database rules cannot fully enforce accounting immutability without Cloud Functions; app code preserves history by voiding records instead of deleting them.

## Phase 1 Completion Gate

Billing Phase 1 can pass when:

- [ ] Static checks pass.
- [ ] Firebase rules JSON parses.
- [ ] Existing Billing UI can save contract, create billing, create collection, and void records.
- [ ] Rollups recalculate correctly.
- [ ] Revenue and cost remain separated.
- [ ] No Labor or Materials code was modified for Billing.
