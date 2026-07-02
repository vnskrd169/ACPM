# ACPM Materials v1 QA Checklist

Status: MATERIALS v1 STABLE

Scope: backend/data foundation only. Do not judge UI polish in this QA pass.

## Phase 3 Stabilization Results

Date tested: June 27, 2026

Project tested: `-Ow60wuOtFmGmXo1cBOp`

Results:

- PASS: Visible Material Movement Ledger added to the Materials module.
- PASS: Movement ledger shows `PO Submit`, `Approval`, `Receive`, and `Issue` rows.
- PASS: Movement ledger shows date/time, action, item/source, quantity, cost, source, and user id when available.
- PASS: PO status display now uses contractor lifecycle labels:
  - Draft
  - Submitted
  - Approved
  - Partially Delivered
  - Fully Delivered
  - Closed
- PASS: Existing QA PO displays `Fully Delivered`.
- PASS: Stock-out validation prevents issuance when requested quantity exceeds available stock.
- PASS: Stock-out validation shows clean message: `Only 7 bag available for QA Cement.`
- PASS: Stock-out attempt did not add a new movement row.
- PASS: Receiving remains the source of `materialSpent`.
- PASS: Issuance does not affect `materialSpent`.
- PASS: PO submit alone does not affect `materialSpent`.
- PASS: Database verification after stock-out test:
  - `materialSpent`: 35
  - `materialReceivedCost`: 35
  - `materialCommitted`: 0
  - Cement stock: 7
  - Steel stock: 5
  - Movement counts: `po_submit = 1`, `po_approve = 1`, `receive = 4`, `issue = 1`
- PASS: `materials.js` syntax check passed.
- PASS: `database.rules.json` JSON parse passed.

Materials v1 stable limitations:

- Material Issuance UI remains intentionally minimal and supports one item per issue.
- Movement ledger is read-only.
- Old PO records created before Materials v1 may not have complete item tracking fields.
- Realtime Database cannot fully enforce append-only movement history without narrower write rules or Cloud Functions.

## Phase 2 Manual QA Results

Date tested: June 27, 2026

Project tested: `-Ow60wuOtFmGmXo1cBOp`

Test PO:

- Supplier: `QA Supplier Phase2`
- Item 1: `QA Cement`, `40kg`, 10 bags at 2 each
- Item 2: `QA Steel Bar`, `10mm`, 5 pcs at 3 each
- PO total: 35

Results:

- PASS: Existing PO submit UI uses `createPurchaseOrder()`.
- PASS: PO created one historical `purchaseOrders/{poId}` record.
- PASS: PO item rows store compatible old fields and new item tracking fields.
- PASS: PO History shows received and remaining quantity per item.
- PASS: Approval moved PO to approved after fixing Firebase nested update path.
- PASS: Partial receiving used `receiveDelivery()`.
- PASS: First delivery received 4 cement and 2 steel.
- PASS: Inventory increased cumulatively to 4 cement and 2 steel.
- PASS: Remaining quantities displayed as 6 cement and 3 steel before final receiving.
- PASS: Final delivery received remaining 6 cement and 3 steel.
- PASS: PO became fully delivered.
- PASS: Inventory increased cumulatively to 10 cement and 5 steel.
- PASS: Minimal Material Issuance UI issued 3 cement to site/trade.
- PASS: Inventory decreased to 7 cement and 5 steel.
- PASS: `materialSpent` stayed 35 after issuance and did not double-count stock-out.
- PASS: `materialReceivedCost` is 35.
- PASS: `materialCommitted` is 0 after full delivery.
- PASS: Firebase `materialMovements` contains expected QA movement rows:
  - `po_submit`: 1
  - `po_approve`: 1
  - `receive`: 4
  - `issue`: 1
- PASS: No console errors after the approval fix and v46 reload.

Fix applied during QA:

- `approvePO()` used dotted Firebase update keys (`approvalWorkflow.approvedBy`), which Realtime Database rejects. Updated to slash paths (`approvalWorkflow/approvedBy`, `approvalWorkflow/approvedAt`) and bumped Materials asset cache to v46.

Known Phase 2 limitations:

- Material Issuance UI is intentionally minimal and supports one item per issue for now.
- Movement history now has a visible read-only ledger as of Phase 3.
- Old PO records created before Materials v1 may not have complete item tracking fields.
- Realtime Database still cannot fully enforce append-only movements without narrower write rules or Cloud Functions.

## Firebase Rules and Indexes

- Confirm `database.rules.json` deploys without syntax errors.
- Confirm `purchaseOrders` indexes include `seq`, `poNo`, `status`, `supplierId`, `createdAt`, `date`, and `deliveryStatus`.
- Confirm `deliveries` indexes include `poId`, `deliveryDate`, `receivedAt`, `status`, and `supplierId`.
- Confirm `inventory` indexes include `itemKey`, `description`, `qtyOnHand`, and `lastMovementAt`.
- Confirm `materialMovements` indexes include `type`, `date`, `createdAt`, `itemKey`, `poId`, `deliveryId`, `issueId`, and `supplierId`.
- Confirm `materialIssuances` indexes include `issueNo`, `date`, `createdAt`, `issuedTo`, `scope`, and `status`.
- Confirm `ledger` indexes include `poId`, `poItemId`, `status`, `supplierId`, `date`, and `createdAt`.
- Confirm `suppliers` indexes include `name`, `specialty`, and `updatedAt`.

## Purchase Order

- Create a new PO using the existing Materials form.
- Verify exactly one record appears under `projects/{projectId}/purchaseOrders/{poId}`.
- Verify each PO item has old compatible fields: `desc`, `qty`, `unit`, `cost`, `total`.
- Verify each PO item also has new fields: `itemId`, `itemKey`, `qtyOrdered`, `qtyAccepted`, `qtyRejected`, `qtyRemaining`, `unitCost`, `totalCost`.
- Verify matching `ledger/{poId}_{itemId}` rows are created.
- Verify inventory shell records are created with `qtyOnHand = 0`.
- Verify one `materialMovements` record is created with `type = po_submit`.
- Verify `materialSpent` does not increase on PO submit.

## Approval

- Approve the PO as Boss/Admin/Project Manager.
- Verify PO status becomes `approved`.
- Verify ledger rows move to `ordered`.
- Verify one `materialMovements` record is created with `type = po_approve`.
- Verify `materialCommitted` updates from approved/open POs.
- Verify inventory does not increase on approval.

## Receiving and Partial Delivery

- Record a partial delivery for one PO item.
- Verify one delivery appears under `projects/{projectId}/deliveries/{deliveryId}`.
- Verify delivery item has `poItemId`, `itemKey`, `qtyReceived`, `qtyAccepted`, `qtyRejected`, and `acceptedCost`.
- Verify accepted quantity increases `inventory/{itemKey}/qtyOnHand`.
- Verify one `materialMovements` record is created per accepted item with `type = receive`.
- Verify PO item cumulative fields update: `qtyReceived`, `qtyAccepted`, and `qtyRemaining`.
- Verify PO `deliveryStatus` becomes `partially_delivered`.
- Verify `materialReceivedCost` and `materialSpent` increase by accepted receiving cost.

## Multiple Deliveries Against One PO

- Reopen the same PO and record a second delivery.
- Verify remaining quantity is based on cumulative accepted prior deliveries.
- Verify the system blocks receiving more than remaining ordered quantity.
- Verify inventory increases only by the second accepted delivery quantity.
- Verify another `receive` movement is appended.
- Verify PO becomes `fully_delivered` only after cumulative accepted quantity reaches ordered quantity.
- Verify a fully delivered PO is removed from open `materialCommitted` rollup.

## Damaged or Rejected Receiving

- Record a delivery line with condition `damaged`.
- Verify the delivery stores `qtyRejected`.
- Verify damaged quantity does not increase inventory.
- Verify damaged quantity does not increase `materialSpent`.
- Verify delivery status records an issue.

## Material Issuance Helper

This phase adds helper functions only; no UI screen is added yet.

- From console or a controlled test harness, call `issueMaterial(projectId, input)` with an available stock item.
- Verify a record appears under `materialIssuances/{issueId}`.
- Verify inventory decreases by issued quantity.
- Verify one `materialMovements` record is created per issued item with `type = issue`.
- Verify `materialSpent` does not change after issuance.
- Verify issuing more than stock throws an error and writes nothing.

## Budget

- Verify `materialSpent` is controlled by receiving cost, not ledger status changes.
- Change a ledger row status manually and confirm it does not rewrite `materialSpent`.
- Verify dashboard Materials KPI updates after receiving.

## Listener and Compatibility

- Switch away from the project and back.
- Verify Materials listeners do not duplicate records in the UI.
- Refresh the workspace.
- Verify existing old PO records still render.
- Verify new PO records still render in the existing PO History UI.

## RC1 UI Label Polish

- [x] PO action buttons use clean text labels:
  - `Approve Invoice`
  - `Record Delivery`
  - `Image`
- [x] Materials UI no longer uses invalid `\u1Fxxx` emoji escapes that rendered as broken characters in browser text.
- [x] Static gate verifies clean Materials PO labels:
  - Script: `scripts/rc1_static_gate.js`
  - Result: PASS after `materials.js?v=93`.
- [x] Browser smoke after cache v93:
  - Signed-in Boss workspace opened Materials tab.
  - `materials.js?v=93` loaded.
  - Visible PO action buttons rendered cleanly as `Approve Invoice` and `Image`.
  - Broken glyph scan for `Ὄ`, `὏`, and replacement characters returned no button matches.
  - Console errors: none.

## Known Limitations

- Realtime Database rules cannot fully enforce append-only movement history while project-level writes remain broad.
- Issuance has backend helper support only in phase 1; full UI and reports are phase 2.
- Old PO items may not have `itemId` until migrated or re-saved.
- Budget rollup is now based on receiving movements for new records; old pre-movement ledger data may need a migration pass if exact historical totals must be preserved.
- Legacy ledger delete is now a cancel/void action. Rows remain under `ledger/{ledgerId}` with `status = cancelled`, cancellation metadata, and audit trail.
