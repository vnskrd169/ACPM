# ACPM Billing v1 Phase 2 QA Checklist

Status: DATA FOUNDATION IMPLEMENTED - MANUAL FIREBASE QA PENDING

Scope:

- No UI redesign.
- Labor v1 and Materials v1 remain frozen.
- Phase 2 focuses on linked collections, downpayment/mobilization billing, retention, deductions, immutable output archives, and rebuild-based rollups.

Version:

```text
Service worker cache: acpm-v54
Billing script: billing.js?v=54
```

## Files Changed for Phase 2

```text
billing.js
database.rules.json
BILLING_SCHEMA.md
QA_BILLING_PHASE2.md
workspace.html
dashboard.html
index.html
sw.js
```

## Firebase Paths to Verify

```text
projects/{projectId}/billings
projects/{projectId}/collections
projects/{projectId}/billingAllocations
projects/{projectId}/retentionLedger
projects/{projectId}/billingAdjustments
projects/{projectId}/billingOutputs
projects/{projectId}/billingEvents
projects/{projectId}/billingRollups
```

## Helper Functions to Verify

```text
createDownpaymentBilling(projectId, data)
createMobilizationBilling(projectId, data)
recordCollection(projectId, data)
calculateBillingReceivable(projectId, billingId)
validateCollectionAllocation(projectId, collectionId, billingId, amount)
allocateCollectionToBilling(projectId, collectionId, billingId, amount)
allocateCollectionToOldestBillings(projectId, collectionId, amount)
createBillingDeduction(projectId, billingId, data)
approveBillingDeduction(projectId, billingId, deductionId)
rejectBillingDeduction(projectId, billingId, deductionId)
voidBillingDeduction(projectId, billingId, deductionId, reason)
calculateRetentionForBilling(projectId, billingId)
releaseRetention(projectId, billingId, data)
generateBillingOutputSnapshot(projectId, options)
listBillingOutputs(projectId)
rebuildBillingRollups(projectId)
```

## Phase 2 Test Flow

### 1. Linked Collections

- [ ] Create approved Billing A for `10000`.
- [ ] Record Collection 1 for `3000` with `billingId = Billing A`.
- [ ] Verify `billingAllocations` contains one allocation for `3000`.
- [ ] Verify Billing A `currentReceivable = 7000`.
- [ ] Record Collection 2 for `7000` with `billingId = Billing A`.
- [ ] Verify Billing A `currentReceivable = 0`.
- [ ] Attempt to allocate `1` more to Billing A.
- [ ] Expected: blocked with overpayment validation.

Result: PENDING MANUAL QA

### 2. Unallocated / Auto Allocation Compatibility

- [ ] Create approved Billing B for `5000`.
- [ ] Record Collection 3 for `2000` without `billingId`.
- [ ] Verify current simple UI does not break.
- [ ] Verify helper auto-allocates to oldest approved receivable where possible.
- [ ] Verify excess amount remains as `unappliedAmount` if collection exceeds open receivables.

Result: PENDING MANUAL QA

### 3. Downpayment / Mobilization

- [ ] Save contract with downpayment terms.
- [ ] Call `createDownpaymentBilling(projectId, data)`.
- [ ] Approve downpayment billing.
- [ ] Verify total billed and receivable increase.
- [ ] Record collection against the downpayment billing.
- [ ] Verify total collected increases and cost remains unchanged.
- [ ] Call `createMobilizationBilling(projectId, data)`.
- [ ] Verify mobilization follows the same revenue-only behavior.

Result: PENDING MANUAL QA

### 4. Retention

- [ ] Create approved billing for `10000` with `retentionPct = 10`.
- [ ] Verify rollup:
  - `totalGrossBilled = 10000`
  - `totalRetentionHeld = 1000`
  - `totalCurrentCollectible = 9000`
  - `retentionReceivable = 1000`
- [ ] Allocate collection up to `9000`.
- [ ] Verify current receivable becomes `0`.
- [ ] Call `releaseRetention(projectId, billingId, { amount: 1000 })`.
- [ ] Verify `retentionLedger` row exists.
- [ ] Verify retention outstanding decreases.

Result: PENDING MANUAL QA

### 5. Deductions

- [ ] Add pending deduction to a billing.
- [ ] Verify pending deduction does not affect rollups.
- [ ] Approve deduction.
- [ ] Verify `totalApprovedDeductions` increases.
- [ ] Verify receivable decreases.
- [ ] Reject another deduction.
- [ ] Verify rejected deduction is ignored.
- [ ] Void approved deduction.
- [ ] Verify row remains and rollups ignore it.

Result: PENDING MANUAL QA

### 6. Billing Output Archive

- [ ] Generate output snapshot for an approved billing.
- [ ] Verify `billingOutputs/{outputId}` contains copied snapshot data.
- [ ] Change contract/client/project name.
- [ ] Re-open output snapshot.
- [ ] Verify archived snapshot did not change.
- [ ] Verify output generation does not affect revenue/cost rollups.

Result: PENDING MANUAL QA

### 7. Rollup Rebuild

- [ ] Run `rebuildBillingRollups(projectId)`.
- [ ] Verify rollups are rebuilt from history, not incremented totals.
- [ ] Verify fields:
  - `contractAmount`
  - `approvedChangeOrders`
  - `totalBilled`
  - `totalCollected`
  - `totalRetentionHeld`
  - `totalRetentionReleased`
  - `retentionReceivable`
  - `receivable`
  - `laborCost`
  - `materialCost`
  - `estimatedProfit`
  - `margin`
- [ ] Refresh workspace.
- [ ] Verify rollup values remain correct.
- [ ] Restart app/browser.
- [ ] Verify rollup values remain correct.

Result: PENDING MANUAL QA

## Firebase Rules / Index QA

- [x] `database.rules.json` parses.
- [x] `billingAllocations` indexes added.
- [x] `retentionLedger` indexes added.
- [x] `billingOutputs` indexes include `status`.
- [ ] Deploy rules to Firebase.
- [ ] Confirm real Firebase accepts allocation rows.
- [ ] Confirm real Firebase accepts retention ledger rows.
- [ ] Confirm real Firebase accepts immutable output rows.

Result: PARTIAL - LOCAL STATIC CHECK PASSED, REAL FIREBASE QA PENDING

## Known Limitations

- Dedicated Phase 2 UI controls are not redesigned yet.
- The current simple collection form uses auto-allocation for compatibility when no billing is selected.
- Overpayment prevention is enforced in app helper code; heavy concurrent office usage may eventually need Cloud Functions.
- Billing output archive is JSON/text-first, not yet a polished PDF or tax-certified invoice.
- Existing legacy billings/collections may need manual migration if exact billing-level allocation history is required.

## Phase 2 Stability Gate

Billing Phase 2 can be marked STABLE only when:

- [ ] Real Firebase QA passes linked collections and overpayment prevention.
- [ ] Downpayment/mobilization is verified as revenue-only.
- [ ] Retention held/released/outstanding is verified.
- [ ] Deductions are verified against rollups.
- [ ] Billing output snapshots are verified immutable.
- [ ] Dashboard reads `billingRollups` after refresh and app restart.
- [ ] No Labor or Materials files were modified for Phase 2.
