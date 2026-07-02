# ACPM Change Orders v1 QA Checklist

Status: WORKFLOW/DATA STABLE - REAL FIREBASE QA PASSED; STATIC WORKFLOW QA PASSED; BOSS EXTRAS SMOKE PASSED

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
- Boss browser Extras smoke passed after cache `acpm-v85`; Change Order text rendered with no console errors.
- Global `/auditLogs` may still be denied by deployed rules in the browser, but project fallback audit rows are written under `projects/{projectId}/auditLogs` and read by the Admin Audit Log.

## Static QA Results

- [x] `node --check changeorders.js`
- [x] `node --check billing.js`
- [x] `node --check scripts/changeorder_v1_real_qa.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke test after cache v56: workspace loaded, `changeorders.js?v=56` present, console had no errors/warnings.
- [x] Local HTTP markup/cache smoke after cache v75
- [x] Change Order static workflow QA:
  - Script: `scripts/changeorder_static_qa.js`
  - Result: PASS
  - Verified no exported permanent delete path.
  - Verified create/review/approve/reject/void helpers, status history, events, notification hooks, void reason/audit path, rebuild-based rollups, budget deltas, and billing linkage validation.
- [x] Historical wording QA:
  - Script: `scripts/historical_integrity_static_qa.js`
  - Result: PASS
  - Verified loaded modules no longer present permanent-delete wording; legacy Change Order fallback prompt now says void, not permanent deletion.
- [x] Browser read-only smoke after cache v85:
  - Signed-in Boss workspace route rendered.
  - Extras button was reachable.
  - Change Order and Supplier text rendered.
  - Console errors: none.
- [x] Browser read-only smoke after cache v92:
  - Signed-in Boss workspace route rendered through the then-current `main.js?v=90` and `style.css?v=92`.
  - Change Orders tab opened from the visible workspace nav.
  - Change Orders panel rendered totals, filters, export action, and existing historical row.
  - Console errors: none.
- [x] Label cleanup smoke after cache v94:
  - `changeorders.js?v=94` loaded.
  - Invalid `\u1Fxxx` escapes were removed from Change Order impact labels.
  - Browser label sweep found no broken glyphs.
- [x] Reject modal hardening after cache v97:
  - `changeorders.js?v=95` replaces the native prompt-based reject reason with an in-app modal.
  - Service worker cache bumped to `acpm-v97`.
  - Static syntax and app-shell gates verify the updated script/cache path.
- [x] UI workflow static QA:
  - Script: `scripts/ui_workflow_static_qa.js`
  - Result: PASS
  - Verifies the current workspace shell exposes the Change Orders tab, form fields, submit/filter/export actions, and rendered approve/reject/revert/void action wiring.
- [x] Browser click-through workflow QA, create + approve path after cache v96:
  - Project: `qa_mr33kg3o_micv8zg1` archived after test.
  - Signed-in Boss opened Change Orders from visible workspace tab.
  - Visible form submitted `CO-001` with labor/material impacts.
  - Visible approve button moved `CO-001` from Pending to Approved.
  - Console errors: none.
- [x] Browser click-through workflow QA, reject modal path after cache v97:
  - Project: `qa_mr342wcu_8satiur8` archived after test.
  - Signed-in Boss opened Change Orders from visible workspace tab with `changeorders.js?v=95`.
  - Visible form submitted `CO-001`.
  - Visible Reject button opened the in-app reject modal without a native browser prompt.
  - Modal reason `RC1 visible reject modal sign-off` saved to Firebase.
  - Live Firebase row status became `rejected`, `rejectedByName` was populated, and the rejected card stayed visible.
  - Project fallback audit rows were written for create and update under `projects/qa_mr342wcu_8satiur8/auditLogs`.
  - Browser console errors: none. Warnings: global `/auditLogs` write denied, with fallback audit write confirmed.
- [x] Real Firebase create/approve/reject/void/link/collect test in QA project

## Stability Gate

Change Orders v1 RC1 gate:

- [x] No normal UI path permanently deletes a change order.
- [x] Approved/rejected/voided records remain readable after refresh.
- [x] Rollups rebuild correctly from history.
- [x] Billing rollups receive approved contract impact.
- [x] Real Firebase QA passes.
- [x] Static workflow QA passes.
- [x] UI workflow static QA passes for visible controls and action wiring.
- [x] Repeat Boss browser read-only smoke when the in-app browser connector is responsive.
- [x] Full visible reject modal click-through passes against live Firebase.
