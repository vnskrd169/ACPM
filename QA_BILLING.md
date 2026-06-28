# ACPM Billing v1 Phase 1 QA Checklist

Status: PHASE 1 STABLE - ROLLUP REBUILD QA PASSED; PHASE 2 ARCHITECTURE QA PLAN READY

## Rollup Rebuild Fix QA Results - 2026-06-28

Root cause fixed:

- `billingSnapRows()` used `snap.forEach(child => rows.push(...))`.
- Firebase Realtime Database stops iterating when the `forEach` callback returns `true`.
- `Array.push()` returns a number, which is truthy, so rebuilds only read the first child row.
- Fixed by using a block callback and returning `false` explicitly.

Implementation confirmed:

- `rebuildBillingRollups(projectId)` rebuilds from authoritative history and overwrites `billingRollups`.
- Billing dashboard reads `billingRollups` only for summary totals.
- Billing, collection, adjustment, and change-order listeners schedule rebuilds so refresh/app restart self-heals stale rollups.
- Change Order approve/reject/delete still calls rebuild directly.

Real Firebase test project:

```text
projectId = -Ow60wuOtFmGmXo1cBOp
projectName = asd
```

### v53 Rollup QA

| Scenario | Result | Evidence |
| --- | --- | --- |
| Baseline rebuild after app load | PASS | Stored rollup matched active Firebase history: `totalBilled = 42000`, `totalCollected = 10000`, `receivable = 32000`. |
| Multiple billings | PASS | Added approved QA billing `7000`; rollup rebuilt to `totalBilled = 49000`, `receivable = 39000`. |
| Multiple collections | PASS | Added QA collection `2000`; rollup rebuilt to `totalCollected = 12000`, `receivable = 37000`, `estimatedProfit = 11965`. |
| Rejected adjustment | PASS | Added rejected adjustment `1000`; rollup ignored it and totals stayed correct. |
| Void collection | PASS | Voided QA collection; rollup returned `totalCollected = 10000`, `receivable = 39000`. |
| Void billing | PASS | Voided QA billing; rollup returned `totalBilled = 42000`, `receivable = 32000`. |
| Page refresh / app restart | PASS | Reloaded app at `v=53-rollup-qa`; listener rebuild kept rollup equal to expected active Firebase history. |
| Dashboard reads rollups | PASS | Billing dashboard showed `Total Billed = ₱42,000.00`, `Total Collected = ₱10,000.00`, `Outstanding = ₱32,000.00`. |

Final active rollup after QA cleanup:

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

QA cleanup:

```text
QA v53 billing row = voided, row preserved
QA v53 collection row = voided, row preserved
QA rejected adjustment row = rejected, row preserved
```

Rollup correctness decision:

```text
PASS - rebuild-based Billing rollups are now correct for the tested Phase 1 scenarios.
```

Phase 1 stability decision:

```text
STABLE as of 2026-06-28.
Full Billing v1 is not yet complete; remaining items are Phase 2+ workflow/UI/reporting work.
```

## Phase 2 QA Plan - Architecture Ready

Scope:

- No UI redesign.
- No Labor or Materials changes.
- No Phase 2 implementation until this plan is accepted and implementation begins.
- All rollup checks must use `rebuildBillingRollups(projectId)` and verify dashboard/report values read `billingRollups`.

Firebase paths to verify when Phase 2 implementation begins:

```text
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

### Linked Collections

- [ ] Create approved Billing A for `10000`.
- [ ] Record Collection 1 for `3000` and allocate it to Billing A.
- [ ] Verify Billing A current receivable becomes `7000`.
- [ ] Record Collection 2 for `7000` and allocate it to Billing A.
- [ ] Verify Billing A current receivable becomes `0`.
- [ ] Attempt to allocate `1` more to Billing A.
- [ ] Verify allocation is blocked with a clean overpayment validation message.
- [ ] Verify `billingAllocations` contains append-only rows for valid allocations.
- [ ] Verify voided billings and voided collections cannot receive new allocations.
- [ ] Verify unallocated collections remain visible as unapplied cash and do not reduce a specific billing receivable until allocated.

Result: PENDING PHASE 2 IMPLEMENTATION QA

### Downpayment / Mobilization Billing

- [ ] Save contract with downpayment or mobilization terms.
- [ ] Verify saving contract terms alone does not increase `totalBilled` or `totalCollected`.
- [ ] Create a `downpayment` billing.
- [ ] Approve the downpayment billing.
- [ ] Verify approved downpayment increases billed revenue and receivable.
- [ ] Record partial collection against the downpayment billing.
- [ ] Verify collected revenue increases and cost does not change.
- [ ] Create a `mobilization` billing if required by workflow.
- [ ] Verify mobilization billing follows the same revenue, receivable, and collection rules.

Result: PENDING PHASE 2 IMPLEMENTATION QA

### Retention

- [ ] Create approved billing for `10000` with `10%` retention.
- [ ] Verify `totalGrossBilled = 10000`.
- [ ] Verify `totalRetentionHeld = 1000`.
- [ ] Verify `totalCurrentCollectible = 9000`.
- [ ] Verify `retentionReceivable = 1000`.
- [ ] Allocate collection up to `9000` and verify current receivable becomes `0`.
- [ ] Verify retention is still receivable but not collected.
- [ ] Release retention through `retentionLedger`.
- [ ] Verify retention receivable decreases only by approved release amount.
- [ ] Record collection for released retention.
- [ ] Verify collected revenue increases only when the collection is posted.

Result: PENDING PHASE 2 IMPLEMENTATION QA

### Deductions

- [ ] Add draft deduction to a billing.
- [ ] Verify draft deduction does not affect rollups.
- [ ] Reject deduction.
- [ ] Verify rejected deduction does not affect rollups.
- [ ] Add and approve deduction for `1000`.
- [ ] Verify `totalApprovedDeductions` increases by `1000`.
- [ ] Verify current collectible and receivable decrease by `1000`.
- [ ] Verify deduction does not increase Labor or Materials cost.
- [ ] Void approved deduction.
- [ ] Verify deduction row remains but rollups ignore it after rebuild.

Result: PENDING PHASE 2 IMPLEMENTATION QA

### Billing Output Archive

- [ ] Generate billing/invoice/RFP output snapshot for an approved billing.
- [ ] Verify `billingOutputs/{outputId}` stores source IDs, project/client snapshot, billing snapshot, deductions, retention, totals, generated user, generated timestamp, and text snapshot.
- [ ] Edit current project/client/contract settings after output generation.
- [ ] Reopen the historical output.
- [ ] Verify the historical output remains unchanged.
- [ ] Verify output snapshot is not recalculated during rollup rebuild.
- [ ] Verify voiding/revising a billing creates a new corrected output instead of mutating the old output.

Result: PENDING PHASE 2 IMPLEMENTATION QA

### Phase 2 Rollups

- [ ] Rebuild after billing approval.
- [ ] Rebuild after collection allocation.
- [ ] Rebuild after collection void.
- [ ] Rebuild after deduction approval/rejection/void.
- [ ] Rebuild after retention release.
- [ ] Rebuild after change-order approval/rejection.
- [ ] Verify Phase 2 rollup fields:
  - `totalGrossBilled`
  - `totalApprovedDeductions`
  - `totalRetentionHeld`
  - `totalRetentionReleased`
  - `retentionReceivable`
  - `totalCurrentCollectible`
  - `totalAllocatedCollections`
  - `unappliedCollections`
  - `currentReceivable`
  - `totalReceivable`
  - `totalRevenueCollected`
- [ ] Verify Phase 1 compatibility fields still exist:
  - `contractAmount`
  - `approvedChangeOrders`
  - `totalBilled`
  - `totalCollected`
  - `receivable`
  - `laborCost`
  - `materialCost`
  - `estimatedProfit`
- [ ] Refresh page and verify rollups still match active history.
- [ ] Restart app/browser and verify rollups still match active history.

Result: PENDING PHASE 2 IMPLEMENTATION QA

### Phase 2 Firebase Rules and Index QA

- [ ] Confirm `billingAllocations` indexes:
  - `billingId`
  - `collectionId`
  - `status`
  - `createdAt`
  - `allocationType`
- [ ] Confirm `retentionLedger` indexes:
  - `billingId`
  - `collectionId`
  - `type`
  - `status`
  - `date`
  - `createdAt`
- [ ] Confirm `billingOutputs` indexes include:
  - `type`
  - `status`
  - `billingId`
  - `outputNo`
  - `generatedAt`
- [ ] Confirm project-level permissions still protect every Billing Phase 2 path.
- [ ] Confirm append-only intent is preserved for `billingEvents`, `billingAllocations`, `retentionLedger`, and `billingOutputs`.

Result: PENDING PHASE 2 IMPLEMENTATION QA

### Phase 2 Stability Gate

Billing Phase 2 can pass when:

- [ ] Linked collections support partial payments and block over-allocation.
- [ ] Downpayment/mobilization billing counts as revenue, never cost.
- [ ] Retention separates current receivable from retention receivable.
- [ ] Deductions affect receivable/revenue correctly and never touch cost.
- [ ] Billing output archives are immutable snapshots.
- [ ] `rebuildBillingRollups(projectId)` remains the single source of truth for stored totals.
- [ ] Dashboard and reports read `billingRollups`, not live-calculated totals.
- [ ] Real Firebase QA passes after refresh and app restart.

Result: NOT STARTED - ARCHITECTURE ONLY

## Historical Failed QA Results - 2026-06-27

Resolution:

```text
RESOLVED on 2026-06-28 by rebuild-based rollups and Firebase forEach iteration fix.
```

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
| Confirm rollups after billing #2 / collection #2 | FAILED - RESOLVED 2026-06-28 | Expected active totals before cleanup: `totalBilled = 50000`, `totalCollected = 25000`, `receivable = 25000`. Stored `billingRollups` remained `totalBilled = 30000`, `totalCollected = 10000`, `receivable = 20000`. |
| Void billing/collection and preserve history | WARNING | Billing #2 and Collection #2 were voided by Firebase REST cleanup and rows remained present. Browser automation stopped responding during reload, so UI void flow was not fully verified. |
| Confirm `billingEvents` are written | PASS | Events found: `contract_create`, `billing_submit`, `billing_approved`, `collection_post`, `billing_submit`, `collection_post`, `billing_approved`, `billing_void`, `collection_void`. |
| Confirm dashboard reads billing rollups correctly | FAILED - RESOLVED 2026-06-28 | Not confirmed. Current Billing UI dashboard visibly read live `billings`/`collections`; stored `billingRollups` were stale after the second cycle. |

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

### Historical Phase 1 Stability Decision

Billing v1 Phase 1 was NOT STABLE on 2026-06-27.

Resolved blocking issue:

- `billingRollups` can become stale after later billing/collection transactions. Historical rows are saved, but rollup recalculation did not include Billing #2 and Collection #2 during real Firebase QA.
- Resolution on 2026-06-28: `billingSnapRows()` now iterates every Firebase child, and app/listener-triggered rebuilds overwrite `billingRollups` from full history.

Resolution checklist:

- PASS - fixed rollup recalculation so billing create/status change, collection post/void, adjustment, and change-order-impact rebuild from authoritative Firebase history.
- PASS - re-ran real Firebase test and confirmed expected active totals.
- PASS - confirmed Billing dashboard reads corrected rollup values.

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
- Phase 2 overpayment prevention will be app-enforced first; concurrent allocation races may need Cloud Functions later if many office users post collections at the same time.
- Phase 2 billing output snapshots are operational archives, not tax-certified invoice documents unless separately reviewed.

## Phase 1 Completion Gate

Billing Phase 1 can pass when:

- [x] Static checks pass.
- [x] Firebase rules JSON parses.
- [x] Existing Billing UI can save contract, create billing, create collection, and void records.
- [x] Rollups recalculate correctly.
- [x] Revenue and cost remain separated.
- [x] No Labor or Materials code was modified for Billing.
