# ACPM Billing v1 Phase 2 QA Checklist

Status: STABLE - REAL FIREBASE QA + BROWSER UI/DASHBOARD SMOKE PASSED

Scope:

- No UI redesign.
- Labor v1 and Materials v1 remain frozen.
- Phase 2 focuses on linked collections, downpayment/mobilization billing, retention, deductions, immutable output archives, and rebuild-based rollups.

Version:

```text
Service worker cache: acpm-v74
Billing script: billing.js?v=74
```

## Files Changed for Phase 2

```text
billing.js
database.rules.json
docs/schema/BILLING_SCHEMA.md
docs/qa/QA_BILLING_PHASE2.md
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

## Minimal UI Wiring to Verify

```text
Billing request form
- type: progress / downpayment / mobilization
- optional retention percentage
- optional deduction

Collections form
- optional billing link
- auto-allocation when no billing is selected
- optional retention release amount
- reference number

Billing table
- type
- gross amount
- receivable
- status
- deduction / retention release / output snapshot / void actions

Billing output archive
- select approved billing
- generate immutable JSON/text output snapshot
- list archived outputs
```

## Phase 2 Test Flow

### 1. Linked Collections

- [ ] Create approved Billing A for `10000`.
- [x] Real Firebase helper QA created approved Billing A for `10000`.
- [x] Real Firebase helper QA recorded Collection 1 for `3000` with `billingId = Billing A`.
- [x] Real Firebase helper QA verified `billingAllocations` contains one allocation for `3000`.
- [x] Real Firebase helper QA verified Billing A current receivable behavior:
  - `currentReceivable = 6000`
  - `retentionReceivable = 1000`
  - `totalReceivable = 7000`
- [x] Real Firebase helper QA recorded Collection 2 for `6000` with `billingId = Billing A`.
- [x] Verify Billing A `currentReceivable = 0`.
- [x] Real Firebase helper QA attempted to allocate `1` more to Billing A.
- [x] Expected: blocked with overpayment validation.

Result: PASS - REAL FIREBASE HELPER QA

### 2. Unallocated / Auto Allocation Compatibility

- [x] Real Firebase helper QA created approved Billing B for `5000`.
- [x] Real Firebase helper QA recorded Collection 3 for `2000` without `billingId`.
- [x] Real Firebase helper QA verified helper auto-allocates to oldest approved receivable where possible.
- [x] Real Firebase helper QA verified `unappliedAmount = 0` when fully allocated.
- [x] Browser UI smoke for no selected billing controls.
- [x] Real Firebase helper QA verified excess amount remains as `unappliedAmount` if collection exceeds open receivables.

Result: PASS - REAL FIREBASE HELPER QA AND BROWSER CONTROL SMOKE

### 3. Downpayment / Mobilization

- [x] Real Firebase helper QA saved contract with downpayment terms.
- [x] Real Firebase helper QA created downpayment billing with `createDownpaymentBilling(projectId, data)`.
- [x] Real Firebase helper QA approved downpayment billing.
- [x] Real Firebase helper QA verified total billed and receivable increase.
- [x] Real Firebase helper QA recorded auto-allocated collection against oldest approved billing.
- [x] Real Firebase helper QA verified total collected increases and cost remains unchanged.
- [x] Real Firebase helper QA created mobilization billing with `createMobilizationBilling(projectId, data)`.
- [x] Real Firebase helper QA verified mobilization follows the same revenue-only behavior.
- [x] Browser UI smoke for the billing type selector.

Result: PASS - REAL FIREBASE HELPER QA AND BROWSER CONTROL SMOKE

### 4. Retention

- [x] Real Firebase helper QA created approved billing for `10000` with `retentionPct = 10`.
- [x] Real Firebase helper QA verified rollup:
  - `totalGrossBilled = 10000`
  - `totalRetentionHeld = 1000`
  - `totalCurrentCollectible = 9000`
  - `retentionReceivable = 1000`
- [x] Real Firebase helper QA allocated collection up to `9000`.
- [x] Real Firebase helper QA verified current receivable becomes `0`.
- [x] Real Firebase helper QA recorded retention collection with `retentionReleased = 1000`.
- [x] Real Firebase helper QA verified retention outstanding decreases.
- [x] Real Firebase helper QA verified `unappliedCollections` does not double-count retention cash.
- [x] Standalone non-cash `releaseRetention()` ledger flow verified:
  - retention receivable decreases
  - total collected cash does not increase
  - remaining current receivable stays collectible

Result: PASS - REAL FIREBASE HELPER QA FOR RETENTION COLLECTION AND NON-CASH RELEASE

### 5. Deductions

- [x] Real Firebase helper QA added pending deduction to a billing.
- [x] Real Firebase helper QA verified pending deduction does not affect rollups.
- [x] Real Firebase helper QA approved deduction.
- [x] Real Firebase helper QA verified `totalApprovedDeductions` increases.
- [x] Real Firebase helper QA verified receivable decreases.
- [x] Real Firebase helper QA rejected another deduction.
- [x] Real Firebase helper QA verified rejected deduction is ignored.
- [x] Void approved deduction.
- [x] Verify row remains and rollups ignore it.

Result: PASS - REAL FIREBASE HELPER QA

### 6. Billing Output Archive

- [x] Real Firebase helper QA generated output snapshot for an approved billing.
- [x] Real Firebase helper QA verified `billingOutputs/{outputId}` contains copied snapshot data.
- [x] Change contract/client/project name.
- [x] Re-open output snapshot.
- [x] Verify archived snapshot did not change.
- [x] Real Firebase helper QA verified output generation does not affect revenue/cost rollups.

Result: PASS - REAL FIREBASE HELPER QA

### 7. Rollup Rebuild

- [x] Real Firebase helper QA ran `rebuildBillingRollups(projectId)`.
- [x] Real Firebase helper QA verified rollups are rebuilt from history, not incremented totals.
- [x] Real Firebase helper QA verified fields:
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
- [x] Refresh workspace.
- [x] Verify Billing UI controls remain available after refresh.
- [x] Restart/reload dashboard route.
- [x] Verify dashboard reads persisted billing rollup after app/browser route restart.

Result: PASS - REAL FIREBASE ROLLUP QA AND DASHBOARD BROWSER SMOKE

## Firebase Rules / Index QA

- [x] `database.rules.json` parses.
- [x] `billingAllocations` indexes added.
- [x] `retentionLedger` indexes added.
- [x] `billingOutputs` indexes include `status`.
- [x] Live Firebase accepted Phase 2 writes on all required paths during real-backend QA.
- [x] Confirm real Firebase accepts allocation rows.
- [x] Confirm real Firebase accepts retention collection rows.
- [x] Confirm real Firebase accepts immutable output rows.

Result: PASS - LOCAL RULES PARSE AND LIVE FIREBASE PATH WRITE QA PASSED

## Local Verification - 2026-06-30

PASS:

- `node --check billing.js`
- `node --check main.js`
- `node --check auth.js`
- `node --check notifications.js`
- `node --check sitelog.js`
- `node --check utils.js`
- `database.rules.json` JSON parse
- Local HTTP `workspace.html?v=74`, `dashboard.html?v=74`, and `index.html?v=74` returned 200.
- Local served markup contains `billing.js?v=74`.
- Local served markup contains `billType`, `billRetentionPct`, `billDeduction`, `colBillingId`, `colRetentionReleased`, `outputBillingId`, and `billingOutputsBody`.
- `sw.js` contains `acpm-v74` and caches `billing.js?v=74`.

Superseded warning:

- An earlier in-app browser smoke timed out before returning the selected tab.
- That warning is now superseded by later browser evidence: Billing tab opened successfully, Phase 2 controls rendered, dashboard rollup smoke passed, and console errors were empty.

## Real Firebase Helper QA - 2026-06-30

PASS:

- QA runner: `scripts/billing_phase2_real_qa.js`
- Final expanded real Firebase project created and archived:
  - `projectId = qa_mr0fje94_un0q8n4t`
  - `projectName = QA_RC1_Billing_Phase2_v74_1782810832360`
  - `qaRunResult = PASS`
- Verified linked collection allocation and overpayment prevention.
- Verified downpayment and mobilization as revenue billings.
- Verified retention collection does not create unapplied cash.
- Verified pending/approved/rejected deduction behavior.
- Verified voided deduction is ignored by rollups.
- Verified billing output snapshot remains immutable after source project/client edits.
- Verified excess auto-allocation leaves unapplied cash.
- Verified standalone non-cash retention release helper.
- Verified persisted `billingRollups`.
- Browser smoke opened the Billing tab and verified all Phase 2 controls rendered with zero console errors.
- Dashboard browser smoke verified a temporary active project card displayed:
  - Contract `100000`
  - Billed `24000`
  - Collected `24000`
  - Receivable `0`
  from persisted `billingRollups`.
- Temporary dashboard QA project was archived after verification:
  - `projectId = -OwMmutG_C3zWXWx2PDO`
- Active QA cleanup confirmed no active `QA_RC1_*` projects remained.

Rollup evidence:

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

Bugs found and fixed before user QA:

- New linked collections were temporarily counted by the legacy `collection.billingId` compatibility path before explicit `billingAllocations` rows were written.
- Fix: helper-created collections now write `allocationMode = phase2`, and legacy allocation fallback ignores those rows.
- Rollup `unappliedCollections` previously subtracted only regular billing allocations; it now subtracts retention cash applications too via `totalAppliedCollections`.
- UI retention action now records a retention collection with `retentionReleased`, instead of writing only a non-cash retention ledger release.
- Voided approved deductions were still counted through stale `deductionTotal`; `billingDeductionTotal()` now treats existing deduction rows as authoritative, even when their approved total becomes zero.

WARNING:

- Failed QA project from the first run was archived and marked failed:
  - `projectId = qa_mr0382n3_3o77s5yo`
  - `qaRunResult = FAILED`
  - reason: pre-fix allocation compatibility bug
- Failed QA project from the expanded deduction-void run was archived and marked failed:
  - `projectId = qa_mr03kmq7_9k30b9st`
  - `qaRunResult = FAILED`
  - reason: pre-fix voided deduction rollup bug

## Known Limitations

- Minimal Phase 2 UI wiring exists and browser Billing-tab/dashboard smoke passed, but it has not been visually redesigned.
- The collection form uses auto-allocation for compatibility when no billing is selected.
- Overpayment prevention is enforced in app helper code; heavy concurrent office usage may eventually need Cloud Functions.
- Billing output archive is JSON/text-first, not yet a polished PDF or tax-certified invoice.
- Existing legacy billings/collections may need manual migration if exact billing-level allocation history is required.

## Phase 2 Stability Gate

Billing Phase 2 can be marked STABLE only when:

- [x] Real Firebase QA passes linked collections and overpayment prevention.
- [x] Downpayment/mobilization is verified as revenue-only.
- [x] Retention held/released/outstanding is verified.
- [x] Deductions are verified against rollups.
- [x] Billing output snapshots are verified immutable.
- [x] Dashboard reads `billingRollups` after refresh and app restart.
- [x] No Labor or Materials files were modified for Phase 2.
