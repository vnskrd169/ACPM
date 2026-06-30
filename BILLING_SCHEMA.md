# ACPM Billing v1 Workflow and Firebase Schema

Status: PHASE 1 STABLE - ROLLUP REBUILD QA PASSED; PHASE 2 REAL FIREBASE HELPER QA + BROWSER UI SMOKE PASSED - DASHBOARD RESTART QA PENDING

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
- `billingRollups` are rebuilt from full Firebase history by `rebuildBillingRollups(projectId)`.
- Phase 1 real Firebase QA passed on 2026-06-28 after fixing Firebase `DataSnapshot.forEach()` iteration.

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
| `rebuildBillingRollups(projectId)` | Authoritative rebuild of revenue/cost rollups from contract, approved billings, active collections, approved adjustments, approved change orders, labor cost, and material cost records. |
| `calculateBillingRollup(projectId)` | Compatibility alias for `rebuildBillingRollups(projectId)`. |
| `calculateReceivable(projectId)` | Calculates receivable from active billings minus active collections. |
| `calculateRevenueVsCost(projectId)` | Returns revenue, billed, collected, receivable, labor cost, material cost, total cost, and estimated profit. |
| `createBillingEvent(projectId, event)` | Appends a Billing event row for traceability. |

Phase 1 UI compatibility:

- Existing Contract, Billing Request, and Collection buttons now call the helper layer.
- Existing tables remain visually unchanged except that new status values can be displayed.
- Contract setup no longer auto-posts downpayment as collected revenue. Downpayment terms are stored on the contract; actual revenue must come from an intentional billing/collection flow.
- Delete actions now void Billing and Collection records instead of removing history.
- Billing dashboard summary reads `billingRollups` only.

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

## Billing v1 Phase 2 Architecture

Phase 2 extends the Phase 1 rebuild-based design. It should not increment or decrement stored totals directly. Every billing, collection, retention, deduction, and output archive update must still end with `rebuildBillingRollups(projectId)`, which overwrites `billingRollups` from source history.

Phase 2 goals:

- Link collections to one or more billings while still allowing temporarily unallocated collections.
- Represent downpayment and mobilization as billing records, not hidden collections.
- Track retention receivable separately from immediately collectible receivable.
- Treat deductions as explicit approved/rejected/voidable records.
- Archive generated billing/invoice/RFP output as immutable JSON snapshots.

Phase 2 non-goals:

- No Labor or Materials schema changes.
- No UI redesign.
- No formal accounting/tax replacement.
- No server-side Cloud Functions automation unless selected in a later infrastructure phase.

### Phase 2 Firebase Path Extensions

Existing Phase 1 paths remain valid. Phase 2 adds structure under the same Billing namespace:

```text
projects/{projectId}/
  billingConfig/
    defaultRetentionMode
    defaultRetentionPct
    allowOverpayment
    overpaymentPolicy
    collectionAllocationPolicy
    outputPrefix

  billings/{billingId}/
    type
    status
    grossAmount
    deductionTotal
    retentionMode
    retentionPct
    retentionFixedAmount
    retentionAmount
    retentionReleased
    retentionReceivable
    netBillable
    currentCollectible
    allocatedCollectionTotal
    currentReceivable
    outputSnapshotIds/{outputId}: true
    deductions/{deductionId}/
      type
      description
      amount
      status
      reason
      createdAt
      createdBy
      approvedAt
      approvedBy
      rejectedAt
      rejectedBy
      voidedAt
      voidedBy

  collections/{collectionId}/
    collectionNo
    status
    amountReceived
    netCashReceived
    unappliedAmount
    billingId
    allocationMode
    allocations/{allocationId}/
      billingId
      billingNo
      amount
      allocationType
      createdAt
      createdBy

  billingAllocations/{allocationId}/
    collectionId
    billingId
    amount
    allocationType
    status
    createdAt
    createdBy
    voidedAt
    voidedBy
    voidReason

  retentionLedger/{retentionId}/
    billingId
    collectionId
    type
    amount
    status
    date
    createdAt
    createdBy

  billingAdjustments/{adjustmentId}/
    type
    scope
    billingId
    amount
    status
    affectsContract
    affectsReceivable
    reason
    createdAt
    createdBy
    approvedAt
    approvedBy
    rejectedAt
    rejectedBy
    voidedAt
    voidedBy

  billingOutputs/{outputId}/
    type
    status
    outputNo
    sourceBillingIds/{billingId}: true
    sourceCollectionIds/{collectionId}: true
    sourceAdjustmentIds/{adjustmentId}: true
    generatedAt
    generatedBy
    snapshotVersion
    snapshot/
      project
      client
      contract
      billing
      collections
      deductions
      retention
      totals
      lineItems
    textSnapshot
```

Phase 2 indexes implemented in `database.rules.json`:

```json
"billingAllocations": {
  ".indexOn": ["billingId", "collectionId", "status", "createdAt", "allocationType"]
},
"retentionLedger": {
  ".indexOn": ["billingId", "collectionId", "type", "status", "date", "createdAt"]
},
"billingOutputs": {
  ".indexOn": ["type", "status", "billingId", "outputNo", "generatedAt"]
}
```

### Linked Collections

Collections should support both simple and allocated payment workflows:

- A collection may have `billingId` when it pays one billing.
- A collection may have `allocations` when it is split across multiple billings.
- A collection may be temporarily unallocated when the office receives payment before deciding which billing it pays.
- Each allocation must also be mirrored as an append-only row under `billingAllocations`.

Default allocation rule for Phase 2:

```text
overpaymentPolicy = reject
collectionAllocationPolicy = manual
```

This means:

- Allocation amount cannot exceed the billing's active collectible receivable.
- Allocation amount cannot exceed the collection's unapplied amount.
- Voided billings and voided collections cannot receive new allocations.
- Rejected/voided deductions and rejected/voided adjustments are ignored.
- If overpayment handling is later needed, use `unapplied_credit` as a separate policy instead of silently overpaying a billing.

### Downpayment and Mobilization Billing

Downpayment and mobilization must be normal billing records:

```text
billings/{billingId}/type = downpayment | mobilization
```

Rules:

- Approved downpayment or mobilization billings increase billed revenue and receivable.
- Collections against them increase collected revenue.
- They never increase Labor or Materials cost.
- Contract downpayment fields define the expected amount; the billing record is the historical revenue document.
- Saving contract terms alone should not create hidden billed or collected revenue.

### Retention

Retention is not a cash collection and should not be treated as collected revenue.

Per billing, retention can be:

```text
retentionMode = none | percent | fixed
retentionPct = number
retentionFixedAmount = number
retentionAmount = calculated amount held
retentionReleased = amount later released
retentionReceivable = retentionAmount - retentionReleased
```

Phase 2 calculation:

```text
approvedGross = sum approved billing gross amounts
approvedDeductions = sum approved billing deductions
retentionHeld = sum approved billing retention amounts
currentCollectible = approvedGross - approvedDeductions - retentionHeld
currentReceivable = currentCollectible - allocatedCollections
retentionReceivable = retentionHeld - retentionReleased
totalReceivable = currentReceivable + retentionReceivable
```

Retention release should be explicit:

- Preferred record: `retentionLedger/{retentionId}` with `type = release`.
- Optional billing document: `billings/{billingId}/type = retention_release` if the client requires a separate request document.
- Released retention only becomes collected revenue when a collection is posted.

### Deductions

Deductions reduce the amount collectible from the client. They are not project costs.

Examples:

```text
damages
penalty
backcharge
admin_deduction
withholding
other
```

Rules:

- Draft deductions do not affect totals.
- Rejected deductions do not affect totals.
- Approved deductions reduce `netBillable`, `currentCollectible`, and receivable.
- Voided deductions are preserved but ignored by rebuilds.
- Deductions may live inside a billing for document-specific deductions, or under `billingAdjustments` for project-level revenue adjustments.

### Billing Output Archive

Generated billing, invoice, and RFP-style outputs must be immutable snapshots.

`billingOutputs/{outputId}` should copy all values needed to re-open the historical document:

- project name and address at generation time
- client name and contact at generation time
- contract values at generation time
- source billing IDs and billing numbers
- line items
- deductions
- retention
- collections included, if any
- final totals
- generated text/table payload
- generated user and timestamp

Historical output must not change if the project name, client name, rates, contract terms, deduction descriptions, or current billing settings change later.

### Phase 2 Helper Functions Implemented

Implemented in `billing.js`:

| Helper | Purpose |
| --- | --- |
| `createDownpaymentBilling(projectId, data)` | Creates a billing with `type = downpayment` from contract terms or manual amount. |
| `createMobilizationBilling(projectId, data)` | Creates a billing with `type = mobilization`. |
| `calculateBillingReceivable(projectId, billingId)` | Calculates one billing's current collectible, allocated collections, retention receivable, and remaining balance from history. |
| `validateCollectionAllocation(projectId, collectionId, billingId, amount)` | Rejects allocations that exceed billing receivable, collection unapplied amount, or status rules. |
| `allocateCollectionToBilling(projectId, collectionId, billingId, amount)` | Creates `billingAllocations` and collection allocation records, then rebuilds rollups. |
| `listCollectionAllocations(projectId, filters)` | Reads allocation history by billing or collection. |
| `createBillingDeduction(projectId, billingId, data)` | Adds a draft/pending deduction row. |
| `approveBillingDeduction(projectId, billingId, deductionId)` | Marks deduction approved and rebuilds rollups. |
| `rejectBillingDeduction(projectId, billingId, deductionId)` | Marks deduction rejected and rebuilds rollups. |
| `voidBillingDeduction(projectId, billingId, deductionId, reason)` | Preserves but ignores the deduction. |
| `calculateRetentionForBilling(projectId, billingId)` | Calculates retention held and remaining retention receivable. |
| `releaseRetention(projectId, billingId, data)` | Creates a retention ledger release event; collection is still required to count cash received. |
| `generateBillingOutputSnapshot(projectId, options)` | Writes immutable JSON and text snapshots under `billingOutputs`. |
| `listBillingOutputs(projectId, filters)` | Reads generated historical outputs. |
| `rebuildBillingRollups(projectId)` | Extended to include allocations, deductions, retention, output-independent revenue fields, cost rollups, and compatibility fields. |

Phase 2 implementation notes:

- `recordCollection()` now writes historical collection rows and allocation rows instead of incrementing stored billing totals.
- New helper-created collections write `allocationMode = phase2`, so the legacy compatibility reader does not count `collection.billingId` as an allocation before the explicit `billingAllocations` row is written.
- If `billingId` is supplied, collection allocation is validated against that billing's current receivable before writing.
- If no `billingId` is supplied, the current simple UI stays compatible by auto-allocating against oldest approved receivables where possible; any excess remains `unappliedAmount`.
- `billingAllocations` mirrors collection allocation data so allocation history remains reportable even if the collection display changes.
- Billing deductions are stored under `billings/{billingId}/deductions` and only approved deductions affect rollups.
- Retention releases are stored under `retentionLedger`; released retention is not counted as collected cash unless a collection exists.
- Retention-release cash on a collection is separated from ordinary billing allocation so it does not overpay the current receivable.
- If a retention ledger release and collection retention release reference the same `collectionId`, rollups de-duplicate the release to prevent double-counting.
- Rollup `unappliedCollections` subtracts both ordinary billing allocations and retention cash collections through `totalAppliedCollections`.
- Existing billing deduction child rows are authoritative over stale stored `deductionTotal`; voided/rejected deduction rows remain historical but are ignored by rollups.
- `billingOutputs` snapshots copy project/client/contract/billing/collection/deduction/retention/totals at generation time.
- `billingOutputs` collected totals use selected allocation amounts, not the full collection amount, when one collection is split across multiple billings.
- PWA cache and script version were bumped to `acpm-v74` / `billing.js?v=74` after Phase 2 minimal UI wiring.

Phase 2 minimal UI wiring:

- Billing request form now supports progress, downpayment, and mobilization billing types.
- Billing creation can include retention percentage and a direct deduction amount.
- Collections can optionally link to an approved billing or auto-allocate to oldest approved billing.
- Collections can record a retention release amount and reference number.
- Billing rows display type, gross amount, receivable, status, and actions for deduction, retention release, output snapshot, and void.
- Billing output archive lists immutable output snapshots from `billingOutputs`.

### Phase 2 Rollup Changes

Dashboard and reports should continue reading only `projects/{projectId}/billingRollups`.

Additional Phase 2 rollup fields:

```text
totalGrossBilled
totalApprovedDeductions
totalRetentionHeld
totalRetentionReleased
totalRetentionCollected
retentionReceivable
totalCurrentCollectible
totalAllocatedCollections
totalAppliedCollections
unappliedCollections
currentReceivable
totalReceivable
totalRevenueCollected
```

Recommended definitions:

```text
totalGrossBilled = approved non-void billing gross amounts
totalApprovedDeductions = approved non-void billing deductions and receivable-affecting approved adjustments
totalRetentionHeld = approved retention held from billings
totalRetentionReleased = approved retention release ledger amount plus retention cash collection rows, de-duplicated by collectionId
totalRetentionCollected = retention release amount tied to active collection rows
retentionReceivable = totalRetentionHeld - totalRetentionReleased
totalCurrentCollectible = totalGrossBilled - totalApprovedDeductions - totalRetentionHeld
totalAllocatedCollections = active allocations applied to active billings
totalAppliedCollections = totalAllocatedCollections + totalRetentionCollected
unappliedCollections = active collection amount not allocated to billings or retention collection
currentReceivable = totalCurrentCollectible - totalAllocatedCollections
totalReceivable = currentReceivable + retentionReceivable
totalRevenueCollected = posted non-void net cash received
estimatedProfit = totalRevenueCollected - laborCost - materialCost
```

Compatibility fields from Phase 1 should remain:

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

For compatibility, map:

```text
totalBilled = totalGrossBilled
totalCollected = totalRevenueCollected
receivable = totalReceivable
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
4. Refactor current UI to use helpers without redesigning UI. Minimal Phase 2 wiring implemented for billing type, linked collections, retention release, deductions, and output archive.
5. Add downpayment/mobilization billing support. Helper/data foundation and minimal UI selector implemented in Phase 2.
6. Add partial collection linkage to billing records. Implemented through `billingAllocations` and wired through the collection billing selector.
7. Add retention and deduction calculations. Helper/data foundation implemented; minimal UI supports direct billing deduction and retention release actions.
8. Add billing output archive. Immutable JSON snapshot helper and minimal archive list/generate UI implemented; polished PDF/tax invoice output pending.
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
- Phase 2 overpayment prevention can be enforced in app code, but Firebase Realtime Database rules cannot reliably protect every concurrent allocation race without server-side logic.
- Unapplied credit handling is documented as a future policy; Phase 2 should default to rejecting over-allocation.
- Billing output snapshots are operational archives and should not be treated as government-compliant invoices unless reviewed for local accounting/tax requirements.
- Retention release workflows differ by client. Phase 2 should support the data model first, then validate exact release documents during QA.

## Completion Definition

Billing v1 Phase 1 is stable when:

- Firebase indexes match actual query paths.
- Helper functions save historical contract, billing, collection, adjustment, event, and rollup data.
- `billingRollups` rebuild from full Firebase history and ignore voided/rejected records.
- Dashboard summary reads `billingRollups`.
- Manual QA passes on a real Firebase project.

Phase 1 status:

```text
STABLE as of 2026-06-28.
```

Full Billing v1 can be marked stable when:

- Contract, downpayment, progress billing, collections, retention, deductions, and change-order billings are historical.
- Partial collections update receivables correctly.
- Billing outputs are archived.
- Dashboard shows revenue, collected, receivable, cost, and estimated profit.
- Reports read history, not only current totals.
- Manual QA passes all Billing v1 scenarios on a real Firebase project.
