# ACPM Change Orders v1 QA Checklist

Status: DATA FOUNDATION IMPLEMENTED - MANUAL FIREBASE QA PENDING

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

Result: PASS STATIC / PENDING REAL FIREBASE WORKFLOW QA

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

Result: PASS STATIC / PENDING REAL FIREBASE WORKFLOW QA

## Approval / Rejection Workflow

- [ ] Create pending change order.
- [ ] Approve it.
- [x] Verify approved event write path exists.
- [x] Review helper exists and writes the `reviewed` status through the same status history path.
- [ ] Verify approved CO affects adjusted contract amount.
- [ ] Verify approved CO affects budget deltas if `affectsBudget = true`.
- [ ] Reject a separate change order.
- [x] Verify rejected event write path exists.
- [ ] Verify rejected CO does not affect approved totals.
- [ ] Revert/supersede behavior is documented and does not corrupt deltas.

Result: PASS STATIC / PENDING REAL FIREBASE WORKFLOW QA

## Rollup Rebuild

- [x] Run `rebuildChangeOrderRollups(projectId)` helper exists and writes `changeOrderRollups`.
- [x] Verify approved totals are rebuilt from active approved history in code.
- [x] Verify rejected/voided rows are ignored by approved totals in code.
- [x] Run `syncProjectBudgetDeltasFromChangeOrders(projectId)` helper exists.
- [x] Verify `laborBudgetDelta` and `materialBudgetDelta` match approved history in code.
- [x] Run `rebuildBillingRollups(projectId)` after status changes.
- [x] Verify `approvedChangeOrders` reads approved CO history using `totalImpact`/fallback signed impact.
- [x] Watcher rebuilds rollups and project budget deltas from history, including empty-list reset.
- [ ] Refresh workspace and verify values remain correct.

Result: PASS STATIC / PENDING BROWSER REFRESH QA

## Billing Linkage

- [ ] Approve change order.
- [ ] Create Billing record with `type = change_order`.
- [ ] Link billing to change order.
- [ ] Verify change order shows billing reference.
- [x] Static verification: `linkChangeOrderBilling()` validates both records and mirrors the link under the Billing record.
- [x] Static verification: billing linkage writes a `change_order_billing_linked` notification event.
- [ ] Verify Billing receivable comes from Billing record, not from CO approval alone.
- [ ] Verify collection against CO billing affects revenue only.

Result: PENDING IMPLEMENTATION QA

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

Result: PASS STATIC

## Known Limitations

- Dedicated printed change-order approval output is not implemented.
- Attachments are not implemented.
- Billing linkage is architecture-defined but not yet wired as a full UI workflow.
- Manual Firebase QA is pending because creating, approving, rejecting, and voiding records creates permanent project history.

## Static QA Results

- [x] `node --check changeorders.js`
- [x] `node --check billing.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke test after cache v56: workspace loaded, `changeorders.js?v=56` present, console had no errors/warnings.
- [ ] Browser smoke test after cache v64
  - WARNING 2026-06-29: static assets returned HTTP 200 and syntax checks passed, but the in-app browser automation timed out during navigation before DOM verification. Treat as unresolved browser smoke QA, not a module pass.
- [ ] Browser click-through workflow QA: automation saw Change Order controls in the DOM, but the visible tab locator was not reachable in the current app state.
- [ ] Real Firebase create/approve/reject/void test in QA project

## Stability Gate

Change Orders v1 can be marked STABLE when:

- [ ] No normal UI path permanently deletes a change order.
- [ ] Approved/rejected/voided records remain readable after refresh.
- [ ] Rollups rebuild correctly from history.
- [ ] Billing rollups receive approved contract impact.
- [ ] Real Firebase QA passes.
