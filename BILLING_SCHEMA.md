# ACPM Billing v1 Workflow and Firebase Schema

Status: PHASE 1 BACKEND FOUNDATION IMPLEMENTED

Labor v1 and Materials v1 are frozen. Billing v1 must track project revenue, billings, collections, receivables, and profit reporting without changing Labor or Materials.

## Purpose

Billing is the revenue side of ACPM.

- Labor and Materials track project costs.
- Billing tracks contract value, progress billings, collections, receivables, retention, and revenue history.
- Reports compare revenue vs cost so the business can see billed amount, collected cash, remaining receivable, and estimated profit.

## Current System Snapshot

Existing Billing paths:

```text
projects/{projectId}/contract
projects/{projectId}/billings
projects/{projectId}/collections
projects/{projectId}/billingCounter
```

Existing behavior:

- Contract setup stores client, amount, downpayment percent, retention percent, start date, and end date.
- Downpayment is currently written as a collection when contract is saved.
- Billing requests are stored under `billings`.
- Collections are stored under `collections`.
- Contract dashboard calculates total billed, total collected, retention held, net collected, and outstanding.
- CSV export reads `contract`, `billings`, and `collections`.

Current gaps before Billing v1 can be production-ready:

- Downpayment/mobilization is not clearly represented as a billing document.
- Partial payments are not linked to the billing they pay.
- Retention is calculated from collections, but should be tied to billed/contract policy.
- Change order additions are not included in adjusted contract value in Billing.
- Deductions are not first-class records.
- Billing status can be manually changed to collected without actual collection details.
- Deletion is currently permanent; v1 should prefer void/cancel history.
- No immutable billing events ledger exists.
- Reports do not yet compare revenue vs cost, billed vs collected, receivables, and estimated profit from dedicated billing rollups.

## Construction Billing Workflow

Target workflow:

1. Contract setup
2. Optional mobilization/downpayment billing
3. Progress billing request
4. Billing approval/release
5. Invoice or RFP-style output
6. Partial or full collection/payment received
7. Retention tracking
8. Deductions, if needed
9. Change order additions
10. Receivable balance update
11. Billing history/archive
12. Reports and dashboard integration

## Design Principles

1. Billing records are historical once submitted.
2. Collections are historical once posted.
3. Never treat a billing as collected unless a collection/payment record exists.
4. Billing is revenue; Labor and Materials remain costs.
5. Change orders update adjusted contract value only when approved.
6. Retention is tracked separately from cash received.
7. Deductions are explicit records, not silent negative collections.
8. Reports read billing history, not only current dashboard totals.
9. Deletes should become void/cancel actions wherever possible.
10. Existing paths should be evolved, not replaced unnecessarily.

## Proposed Firebase Structure

```text
projects/{projectId}/
  contract/
    clientName
    originalAmount
    approvedChangeOrderTotal
    adjustedContractAmount
    downPaymentPct
    downPaymentAmount
    retentionPct
    retentionMode
    startDate
    endDate
    status
    createdAt
    createdBy
    updatedAt
    updatedBy

  billingConfig/
    nextBillingNo
    nextCollectionNo
    nextAdjustmentNo
    invoicePrefix
    retentionMode
    revenueRecognitionPolicy

  billings/{billingId}/
    billingNo
    seq
    type
    status
    date
    dueDate
    periodStart
    periodEnd
    description
    percentComplete
    grossAmount
    retentionPct
    retentionAmount
    deductionTotal
    netBillable
    collectedAmount
    receivableBalance
    changeOrderIds
    lineItems/{lineItemId}/
      description
      category
      amount
      sourceType
      sourceId
    deductions/{deductionId}/
      description
      amount
      reason
    createdAt
    createdBy
    approvedAt
    approvedBy
    sentAt
    sentBy
    closedAt
    closedBy
    voidedAt
    voidedBy
    voidReason

  collections/{collectionId}/
    collectionNo
    date
    billingId
    billingNo
    amountReceived
    retentionReleased
    withholdingTax
    otherDeductions
    netCashReceived
    paymentMethod
    referenceNo
    paidBy
    notes
    status
    createdAt
    createdBy
    voidedAt
    voidedBy
    voidReason

  billingAdjustments/{adjustmentId}/
    adjustmentNo
    date
    type
    billingId
    amount
    reason
    notes
    status
    createdAt
    createdBy

  billingEvents/{eventId}/
    type
    date
    createdAt
    createdBy
    billingId
    collectionId
    adjustmentId
    amount
    description
    status
    sourceType
    sourceId

  billingOutputs/{outputId}/
    type
    billingId
    outputNo
    generatedAt
    generatedBy
    title
    clientName
    periodLabel
    grossAmount
    retentionAmount
    deductions
    netBillable
    textSnapshot

  billingRollups/
    originalContractAmount
    approvedChangeOrderTotal
    adjustedContractAmount
    totalBilledGross
    totalRetentionHeld
    totalDeductions
    totalNetBillable
    totalCollected
    totalRetentionReleased
    totalReceivable
    totalCost
    estimatedProfit
    estimatedProfitPct
    lastUpdatedAt
```

Existing paths to preserve:

```text
projects/{projectId}/contract
projects/{projectId}/billings
projects/{projectId}/collections
```

New paths to add:

```text
projects/{projectId}/billingConfig
projects/{projectId}/billingAdjustments
projects/{projectId}/billingEvents
projects/{projectId}/billingOutputs
projects/{projectId}/billingRollups
```

## Record Types and Statuses

Billing type:

```text
downpayment
mobilization
progress
change_order
retention_release
final
other
```

Billing status:

```text
draft
submitted
approved
sent
partially_collected
collected
voided
closed
```

Collection status:

```text
posted
voided
```

Adjustment type:

```text
deduction
addition
retention_hold
retention_release
withholding_tax
other
```

Billing event type:

```text
contract_create
contract_update
billing_submit
billing_approve
billing_send
collection_post
collection_void
deduction_post
retention_hold
retention_release
billing_void
output_generate
rollup_recalculate
```

## Core Calculations

Adjusted contract amount:

```text
originalContractAmount + approvedChangeOrderTotal
```

Gross billed:

```text
sum(active billings.grossAmount)
```

Retention held:

```text
sum(active billings.retentionAmount) - sum(collections.retentionReleased)
```

Net billable:

```text
grossAmount - retentionAmount - deductionTotal
```

Collected:

```text
sum(active collections.netCashReceived)
```

Receivable:

```text
sum(active billings.netBillable) - sum(active collections.netCashReceived applied to billings)
```

Total cost:

```text
laborSpent + materialSpent + other approved project costs, if added later
```

Estimated profit:

```text
totalCollected - totalCost
```

Estimated profit by contract:

```text
adjustedContractAmount - projectedTotalCost
```

## Revenue vs Cost Reporting

Reports should read:

```text
Revenue:
  projects/{projectId}/billings
  projects/{projectId}/collections
  projects/{projectId}/billingAdjustments
  projects/{projectId}/billingRollups

Costs:
  projects/{projectId}/laborSpent
  projects/{projectId}/materialSpent
  projects/{projectId}/payrollLogs
  projects/{projectId}/materialMovements
```

Required reports:

| Report | Source |
| --- | --- |
| Contract Summary | `contract`, `billingRollups` |
| Billing History | `billings`, `billingEvents` |
| Collection History | `collections`, `billingEvents` |
| Receivables Aging | `billings`, `collections` |
| Retention Summary | `billings`, `collections`, `billingAdjustments` |
| Revenue vs Cost | `billingRollups`, `laborSpent`, `materialSpent` |
| Estimated Profit | `billingRollups`, project cost rollups |
| Invoice/RFP Output Archive | `billingOutputs` |

## Dashboard Integration

Project dashboard should eventually show:

- Contract amount
- Adjusted contract amount
- Total billed
- Total collected
- Remaining receivable
- Retention held
- Total project cost
- Estimated profit
- Billed vs collected percentage
- Cost vs revenue health

Dashboard values should come from `billingRollups` and existing cost rollups:

```text
revenue = billingRollups.totalCollected
cost = laborSpent + materialSpent
receivable = billingRollups.totalReceivable
estimatedProfit = revenue - cost
```

## Archive and History Behavior

Billing v1 should preserve financial history:

- Submitted billing records are not deleted; they become voided if cancelled.
- Posted collections are not deleted; they become voided if corrected.
- Deductions are separate adjustment records.
- Every major action writes a `billingEvents` row.
- Generated invoice/RFP output stores a text snapshot under `billingOutputs`.
- Rollups can be recalculated from history if needed.

Recommended correction flow:

1. Void incorrect billing or collection.
2. Add reason.
3. Append `billingEvents` row.
4. Recalculate billing rollups.
5. Create corrected billing or collection record.

## Firebase Indexes Needed

Add under `projects/{projectId}`:

```json
"billings": {
  ".indexOn": ["seq", "billingNo", "type", "status", "date", "dueDate", "createdAt"]
},
"collections": {
  ".indexOn": ["collectionNo", "billingId", "date", "status", "createdAt", "referenceNo"]
},
"billingAdjustments": {
  ".indexOn": ["adjustmentNo", "billingId", "type", "status", "date", "createdAt"]
},
"billingEvents": {
  ".indexOn": ["type", "billingId", "collectionId", "date", "createdAt", "status"]
},
"billingOutputs": {
  ".indexOn": ["type", "billingId", "outputNo", "generatedAt"]
}
```

Phase 1 implementation status:

- Implemented in `database.rules.json`.
- Billing helpers now write/read the existing Billing paths plus the new `billingConfig`, `billingAdjustments`, `billingEvents`, and `billingRollups` paths.
- `billingOutputs` is indexed for Phase 2 output/archive work but is not generated in Phase 1.

## Phase 1 Helper Functions Implemented

Implemented in `billing.js`:

| Helper | Purpose |
| --- | --- |
| `getContract(projectId)` | Reads `projects/{projectId}/contract`. |
| `saveContract(projectId, data)` | Saves contract fields using both legacy fields and v1 fields for compatibility. |
| `createBilling(projectId, data)` | Creates a historical billing row, assigns billing number, initializes receivable balance, writes event, recalculates rollup. |
| `listBillings(projectId)` | Lists billing history rows. |
| `approveBilling(projectId, billingId)` | Marks billing approved, writes event, recalculates rollup. |
| `recordCollection(projectId, data)` | Creates posted collection, optionally applies it to one billing, writes event, recalculates rollup. |
| `listCollections(projectId)` | Lists collection history rows. |
| `createAdjustment(projectId, data)` | Creates billing adjustment, writes event, recalculates rollup. |
| `calculateBillingRollup(projectId)` | Rebuilds revenue/cost rollups from contract, billing, collection, adjustment, change-order, labor cost, and material cost records. |
| `calculateReceivable(projectId)` | Calculates receivable from active billings minus active collections. |
| `calculateRevenueVsCost(projectId)` | Returns revenue, billed, collected, receivable, labor cost, material cost, total cost, and estimated profit. |
| `createBillingEvent(projectId, event)` | Appends a Billing event row for traceability. |

Phase 1 UI compatibility:

- Existing Contract, Billing Request, and Collection buttons now call the helper layer.
- Existing tables remain visually unchanged except that new status values can be displayed.
- Contract setup no longer auto-posts downpayment as collected revenue. Downpayment terms are stored on the contract; actual revenue must come from an intentional billing/collection flow.
- Delete actions now void Billing and Collection records instead of removing history.

Phase 1 rollup fields written to `projects/{projectId}/billingRollups`:

```text
contractAmount
approvedChangeOrders
totalBilled
totalCollected
receivable
laborCost
materialCost
estimatedProfit
```

Compatibility aliases are also written:

```text
originalContractAmount
approvedChangeOrderTotal
adjustedContractAmount
totalBilledGross
totalNetBillable
totalReceivable
totalCost
estimatedProfitPct
```

## Migration Plan

Keep existing contract data, but map fields:

```text
contract.amount -> contract.originalAmount
contract.downPct -> contract.downPaymentPct
contract.downPayment -> contract.downPaymentAmount
contract.retention -> contract.retentionPct
contract.client -> contract.clientName
```

Existing `billings` can be treated as:

```text
type = progress
grossAmount = amount
retentionAmount = 0 unless retention policy is applied during migration
netBillable = amount
collectedAmount = 0 unless linked collection exists
```

Existing `collections` can be treated as:

```text
amountReceived = amount
netCashReceived = amount
status = posted
billingId = blank unless manually linked
```

Existing downpayment collection should become a `downpayment` or `mobilization` billing plus a matching collection if exact history is required.

## Billing v1 Implementation Order

1. Add `BILLING_SCHEMA.md`. Done.
2. Add Firebase indexes for Billing paths. Done in Phase 1.
3. Add Billing helper layer. Done in Phase 1 for contract, billings, collections, adjustments, events, rollups, receivable, and revenue-vs-cost.
4. Refactor current UI to use helpers without redesigning UI. Partially done in Phase 1 for contract save, billing create, collection create, status update, and void actions.
5. Add downpayment/mobilization billing support. Pending Phase 2 UI/workflow.
6. Add partial collection linkage to billing records. Helper supports this when `billingId` is supplied; UI linkage is pending.
7. Add retention and deduction calculations. Helper fields exist; full UI is pending.
8. Add billing output archive. Pending.
9. Add dashboard/report integration. Rollups exist; full dashboard/report wiring is pending.
10. Run Billing v1 manual QA. Phase 1 checklist added in `QA_BILLING.md`.

## Billing v1 QA Checklist Plan

### Contract

- Create contract with client, original amount, start/end date, downpayment percent, retention percent.
- Verify adjusted contract amount equals original amount before change orders.
- Verify contract setup does not create hidden revenue unless a billing record is created.

### Downpayment / Mobilization

- Create downpayment billing.
- Post partial or full downpayment collection.
- Verify receivable balance updates.
- Verify revenue vs cost report uses collection and cost separately.

### Progress Billing

- Create progress billing.
- Verify billing is historical after submission.
- Approve and send billing.
- Generate invoice/RFP output snapshot.
- Verify billing history and output archive remain readable after refresh.

### Partial Payments

- Post partial collection against a billing.
- Verify billing status becomes `partially_collected`.
- Post remaining collection.
- Verify billing status becomes `collected`.
- Verify total collected and receivable are correct.

### Retention

- Create billing with retention percent.
- Verify retention held is separated from net billable.
- Release retention later.
- Verify retention held decreases and collected cash increases only through collection records.

### Change Orders

- Approve change order addition.
- Verify adjusted contract amount increases.
- Create change-order billing.
- Verify report separates original contract from change order billings.

### Deductions

- Add billing deduction.
- Verify deduction reduces net billable.
- Verify deduction is visible in billing history.

### Reports

- Verify Revenue vs Cost:
  - Revenue equals collections.
  - Cost equals labor plus materials.
  - Receivable equals net billed minus collected.
  - Estimated profit equals collected minus cost.
- Verify Billing vs Collected.
- Verify Remaining Receivable.
- Verify Estimated Profit.

### Reliability

- Switching projects detaches old Billing listeners.
- Refreshing workspace reloads billing history.
- Voiding a billing or collection does not erase historical rows.
- Export/backup includes Billing paths.

## Known Limitations for Billing v1

- Firebase Realtime Database cannot fully enforce accounting rules without Cloud Functions.
- Existing billings and collections may need migration to link payments to billings.
- Generated invoice/RFP output will be an archived text snapshot first; polished PDF can come later.
- Retention rules vary by client and contract, so v1 should keep retention configurable.
- Tax handling is limited to explicit deduction/withholding fields, not full accounting compliance.
- Estimated profit is operational, not formal accounting profit.
- Phase 1 keeps the simple status dropdown for compatibility; cash/revenue totals still come from collection records, not status labels.

## Completion Definition

Billing v1 can be marked stable when:

- Contract, downpayment, progress billing, collections, retention, deductions, and change-order billings are historical.
- Partial collections update receivables correctly.
- Billing outputs are archived.
- Dashboard shows revenue, collected, receivable, cost, and estimated profit.
- Reports read history, not only current totals.
- Firebase indexes match actual query paths.
- Manual QA passes on a real Firebase project.
