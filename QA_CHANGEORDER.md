# ACPM Change Orders v1 QA Checklist

Status: ARCHITECTURE READY - IMPLEMENTATION PENDING

Scope:

- Architecture first.
- No UI redesign.
- Do not touch stable Labor or Materials.
- Preserve current working Change Orders behavior until v1 implementation begins.

## Existing Behavior to Preserve

- [ ] Create change order with description, requested by, date, labor impact, materials impact, and notes.
- [ ] Pending change order appears in list.
- [ ] Approving a change order updates project budget deltas.
- [ ] Rejecting a change order keeps the row visible.
- [ ] Billing rollups rebuild after status change.
- [ ] Export CSV still works.

Result: PENDING IMPLEMENTATION QA

## V1 Historical Integrity

- [ ] Delete action is replaced by void action.
- [ ] Voided change order row remains under `changeOrders`.
- [ ] Voided row has:
  - `status = voided`
  - `voidedAt`
  - `voidedBy`
  - `voidReason`
- [ ] Rejected change orders remain archived.
- [ ] Approved change orders remain archived.
- [ ] No approved/rejected/voided row is permanently deleted during normal UI use.

Result: PENDING IMPLEMENTATION QA

## Approval / Rejection Workflow

- [ ] Create pending change order.
- [ ] Approve it.
- [ ] Verify approved event is written.
- [ ] Verify approved CO affects adjusted contract amount.
- [ ] Verify approved CO affects budget deltas if `affectsBudget = true`.
- [ ] Reject a separate change order.
- [ ] Verify rejected event is written.
- [ ] Verify rejected CO does not affect approved totals.
- [ ] Revert/supersede behavior is documented and does not corrupt deltas.

Result: PENDING IMPLEMENTATION QA

## Rollup Rebuild

- [ ] Run `rebuildChangeOrderRollups(projectId)`.
- [ ] Verify approved totals are rebuilt from active approved history.
- [ ] Verify rejected/voided rows are ignored by approved totals.
- [ ] Run `syncProjectBudgetDeltasFromChangeOrders(projectId)`.
- [ ] Verify `laborBudgetDelta` and `materialBudgetDelta` match approved history.
- [ ] Run `rebuildBillingRollups(projectId)`.
- [ ] Verify `approvedChangeOrders` matches approved CO history.
- [ ] Refresh workspace and verify values remain correct.

Result: PENDING IMPLEMENTATION QA

## Billing Linkage

- [ ] Approve change order.
- [ ] Create Billing record with `type = change_order`.
- [ ] Link billing to change order.
- [ ] Verify change order shows billing reference.
- [ ] Verify Billing receivable comes from Billing record, not from CO approval alone.
- [ ] Verify collection against CO billing affects revenue only.

Result: PENDING IMPLEMENTATION QA

## Firebase Rules / Index QA

- [ ] Add/verify indexes for:
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
- [ ] Verify project permissions still protect Change Orders.
- [ ] Verify event rows require `type`, `createdAt`, and `createdBy`.

Result: PENDING IMPLEMENTATION QA

## Known Limitations

- Current implementation still has permanent delete behavior and must be refactored before v1 stable.
- Dedicated printed change-order approval output is not implemented.
- Attachments are not implemented.
- Billing linkage is architecture-defined but not yet wired as a full UI workflow.

## Stability Gate

Change Orders v1 can be marked STABLE when:

- [ ] No normal UI path permanently deletes a change order.
- [ ] Approved/rejected/voided records remain readable after refresh.
- [ ] Rollups rebuild correctly from history.
- [ ] Billing rollups receive approved contract impact.
- [ ] Real Firebase QA passes.
