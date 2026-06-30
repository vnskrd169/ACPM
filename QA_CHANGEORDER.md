# ACPM Change Orders v1 QA Checklist

Status: WORKFLOW/DATA STABLE - REAL FIREBASE QA PASSED; BROWSER CLICK-THROUGH QA WARNING

Scope:

- No UI redesign.
- Do not touch stable Labor or Materials.
- Preserve current working Change Orders UI while replacing dangerous delete/incremental math paths.

## Existing Behavior to Preserve

- [x] Create change order helper accepts description, requested by, date, labor impact, materials impact, and notes.
- [x] Pending change order appears through existing listener/render path.
- [x] Approving a change order rebuilds project budget deltas from history.
- [x] Rejecting a change order keeps the row visible.
- [x] Billing rollups rebuild after status change.
- [x] Export CSV path remains present.

Result: PASS - REAL FIREBASE WORKFLOW QA

## V1 Historical Integrity

- [x] Delete action is replaced by void action.
- [x] Voided change order row remains under `changeOrders`.
- [x] Voided row has:
  - `status = voided`
  - `voidedAt`
  - `voidedBy`
  - `voidReason`
- [x] Rejected change orders remain archived.
- [x] Approved change orders remain archived.
- [x] No approved/rejected/voided row is permanently deleted during normal UI use.

Result: PASS - REAL FIREBASE WORKFLOW QA

## Approval / Rejection Workflow

- [x] Create pending change order.
- [x] Approve it.
- [x] Verify approved event write path exists.
- [x] Review helper exists and writes the `reviewed` status through the same status history path.
- [x] Verify approved CO affects adjusted contract amount.
- [x] Verify approved CO affects budget deltas if `affectsBudget = true`.
- [x] Reject a separate change order.
- [x] Verify rejected event write path exists.
- [x] Verify rejected CO does not affect approved totals.
- [x] Revert/supersede behavior is documented and does not corrupt deltas.

Result: PASS - REAL FIREBASE WORKFLOW QA

## Rollup Rebuild

- [x] Run `rebuildChangeOrderRollups(projectId)` helper exists and writes `changeOrderRollups`.
- [x] Verify approved totals are rebuilt from active approved history in code.
- [x] Verify rejected/voided rows are ignored by approved totals in code.
- [x] Run `syncProjectBudgetDeltasFromChangeOrders(projectId)` helper exists.
- [x] Verify `laborBudgetDelta` and `materialBudgetDelta` match approved history in code.
- [x] Run `rebuildBillingRollups(projectId)` after status changes.
- [x] Verify `approvedChangeOrders` reads approved CO history using `totalImpact`/fallback signed impact.
- [x] Watcher rebuilds rollups and project budget deltas from history, including empty-list reset.
- [x] Rebuild/refresh simulation verifies values remain correct.

Result: PASS - REAL FIREBASE REBUILD QA

## Billing Linkage

- [x] Approve change order.
- [x] Create Billing record with `type = change_order`.
- [x] Link billing to change order.
- [x] Verify change order shows billing reference.
- [x] Static verification: `linkChangeOrderBilling()` validates both records and mirrors the link under the Billing record.
- [x] Static verification: billing linkage writes a `change_order_billing_linked` notification event.
- [x] Verify Billing receivable comes from Billing record, not from CO approval alone.
- [x] Verify collection against CO billing affects revenue only.

Result: PASS - REAL FIREBASE WORKFLOW QA

## Firebase Rules / Index QA

- [x] Add/verify indexes for:
  - `changeOrders.seq`
  - `changeOrders.coNo`
  - `changeOrders.status`
  - `changeOrders.date`
  - `changeOrders.createdAt`
  - `changeOrders.requestedBy`
  - `changeOrders.billingId`
  - `changeOrderEvents.type`
  - `changeOrderEvents.changeOrderId`
  - `changeOrderEvents.createdAt`
- [x] Verify project permissions still protect Change Orders through project-level rules.
- [x] Verify event rows require `type`, `createdAt`, and `createdBy`.

Result: PASS STATIC + LIVE FIREBASE PATH WRITE QA

## Real Firebase QA Results - 2026-06-30

PASS:

- QA runner: `scripts/changeorder_v1_real_qa.js`
- Real Firebase project created and archived:
  - `projectId = qa_mr0frgug_hpxjl2rh`
  - `projectName = QA_RC1_ChangeOrders_v75_1782811208967`
  - `qaRunResult = PASS`
- Verified approved CO impacts:
  - `approvedContractImpact = 20500`
  - `approvedLaborImpact = 12000`
  - `approvedMaterialsImpact = 8000`
  - `laborBudgetDelta = 12000`
  - `materialBudgetDelta = 8000`
- Verified Billing rollup integration:
  - `approvedChangeOrders = 20500`
  - `adjustedContractAmount = 520500`
  - `totalBilled = 20500`
  - `totalCollected = 20500`
  - `receivable = 0`
  - `estimatedProfit = 13500`
- Verified rejected CO remains historical and ignored by approved totals.
- Verified voided approved CO remains historical and is removed from approved/budget totals.
- Verified billing link mirrors to `billings/{billingId}/changeOrderIds/{changeOrderId}`.
- Verified change order event rows and future notification event hooks.
- Verified rollups rebuild from history after simulated refresh.

Bugs/gaps fixed before QA:

- `linkChangeOrderBilling()` now rejects non-approved/voided COs, voided/cancelled/rejected billings, and non-`change_order` billing records.
- PWA cache and script tags bumped to `acpm-v75` / `changeorders.js?v=75`.

## Known Limitations

- Dedicated printed change-order approval output is not implemented.
- Attachments are not implemented.
- Billing linkage is helper-level for RC1; a dedicated UI can come after RC1 if needed.
- Browser connector timed out during v75 smoke, so visual click-through should be repeated when available.

## Static QA Results

- [x] `node --check changeorders.js`
- [x] `node --check billing.js`
- [x] `node --check scripts/changeorder_v1_real_qa.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke test after cache v56: workspace loaded, `changeorders.js?v=56` present, console had no errors/warnings.
- [x] Local HTTP markup/cache smoke after cache v75
- [ ] Browser smoke test after cache v75
  - WARNING 2026-06-29: static assets returned HTTP 200 and syntax checks passed, but the in-app browser automation timed out during navigation before DOM verification. Treat as unresolved browser smoke QA, not a module pass.
- [ ] Browser click-through workflow QA: automation saw Change Order controls in the DOM, but the visible tab locator was not reachable in the current app state.
- [x] Real Firebase create/approve/reject/void/link/collect test in QA project

## Stability Gate

Change Orders v1 RC1 gate:

- [x] No normal UI path permanently deletes a change order.
- [x] Approved/rejected/voided records remain readable after refresh.
- [x] Rollups rebuild correctly from history.
- [x] Billing rollups receive approved contract impact.
- [x] Real Firebase QA passes.
- [ ] Repeat browser click-through smoke when the in-app browser connector is responsive before final RC1 sign-off.
