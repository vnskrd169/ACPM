# ACPM Materials v1 Workflow and Firebase Schema

Status: MATERIALS v1 STABLE

Labor v1 is frozen. Materials v1 starts from workflow and data architecture first. No UI polish should be started until this schema is accepted.

## Phase 1 Implementation Notes

Implemented in phase 1:

- Firebase indexes for Materials paths were added to `database.rules.json`.
- Existing PO submission now flows through `createPurchaseOrder()`.
- Existing receiving now flows through `receiveDelivery()`.
- New PO records keep old UI-compatible fields while adding item keys, item IDs, received quantity fields, and supplier ID support.
- Receiving now writes delivery records, material movement records, inventory updates, PO cumulative delivery fields, and material budget rollups.
- Inventory issuance foundation was added through `issueMaterial()` and `updateInventoryFromIssuance()`, but no UI screen has been added yet.
- Ledger UI still displays existing ledger rows, but it no longer owns `materialSpent`.

Phase 1 intentionally did not redesign Materials UI.

## Operating Model

Materials v1 should match a practical contractor procurement flow:

1. Supplier
2. Purchase Request, optional
3. Purchase Order
4. Approval
5. Delivery
6. Receiving
7. Stock
8. Material Issuance
9. Remaining Inventory
10. Budget Update
11. History
12. Reports

The source of truth must be historical transactions, not only the current inventory balance.

## Current System Snapshot

Existing Materials paths:

```text
projects/{projectId}/purchaseOrders
projects/{projectId}/deliveries
projects/{projectId}/inventory
projects/{projectId}/ledger
projects/{projectId}/materialSpent
suppliers/{supplierId}
```

Existing strengths:

- PO submission already creates historical PO records.
- Boss approval already exists.
- Delivery receiving already updates inventory.
- Supplier directory already exists globally.
- Module listener cleanup exists through `detachMatListeners()`.

Current gaps before Materials v1 can be called production-ready:

- Multiple deliveries against one PO are not fully calculated from cumulative prior deliveries.
- Partial deliveries need item-level remaining quantity tracking.
- Inventory has current balance, but no immutable stock movement ledger.
- Material issuance does not yet exist as a first-class stock-out transaction.
- Reports can still depend on live/current values instead of historical movements.
- Budget update is based on ledger status, but should be tied to accepted receiving or invoice policy.
- Firebase indexes do not yet cover delivery, movement, issuance, and reporting queries.

## Design Principles

1. Purchase orders are historical immediately after submission.
2. Approved, delivered, received, issued, adjusted, or cancelled actions must append history.
3. Inventory balance is a projection of material movements.
4. Reports read transaction history, then summarize.
5. No stock reduction is allowed without an issuance record.
6. No stock increase is allowed without a receiving or adjustment record.
7. Existing Firebase paths should be evolved, not replaced unnecessarily.
8. The schema must scale to 50+ projects, hundreds of items, multiple suppliers, and many project months.

## Proposed Firebase Structure

```text
projects/{projectId}/
  materialBudget
  materialBudgetDelta
  materialSpent
  materialCommitted
  materialReceivedCost

  materialConfig/
    spendPolicy: "received_cost"
    nextPONumber
    nextPRNumber
    nextIssueNumber

  purchaseRequests/{requestId}/
    requestNo
    status
    requestedBy
    requestedAt
    neededBy
    purpose
    notes
    items/{requestItemId}/
      itemKey
      description
      size
      unit
      qtyRequested
      remarks
    convertedToPoId

  purchaseOrders/{poId}/
    poNo
    seq
    supplierId
    supplierName
    date
    status
    deliveryStatus
    invoiceStatus
    urgency
    notes
    total
    committedCost
    receivedCost
    issuedCost
    createdAt
    createdBy
    approvedAt
    approvedBy
    closedAt
    closedBy
    sourceRequestId
    items/{poItemId}/
      itemKey
      description
      size
      unit
      qtyOrdered
      qtyReceived
      qtyAccepted
      qtyRejected
      qtyCancelled
      qtyRemaining
      unitCost
      totalCost
      lastReceivedAt

  deliveries/{deliveryId}/
    poId
    poNo
    deliveryNo
    deliveryDate
    reference
    status
    receivedAt
    receivedBy
    supplierId
    supplierName
    notes
    items/{deliveryItemId}/
      poItemId
      itemKey
      description
      size
      unit
      qtyReceived
      qtyAccepted
      qtyRejected
      condition
      unitCost
      acceptedCost

  inventory/{itemKey}/
    itemKey
    description
    size
    unit
    qtyOnHand
    avgCost
    totalValue
    reorderPoint
    lastReceivedAt
    lastIssuedAt
    lastMovementAt

  materialMovements/{movementId}/
    type
    date
    createdAt
    createdBy
    itemKey
    description
    size
    unit
    qtyIn
    qtyOut
    unitCost
    movementCost
    balanceAfter
    sourceType
    sourceId
    poId
    deliveryId
    issueId
    supplierId
    supplierName
    notes

  materialIssuances/{issueId}/
    issueNo
    date
    issuedTo
    requestedBy
    location
    scope
    purpose
    createdAt
    createdBy
    status
    totalCost
    items/{issueItemId}/
      itemKey
      description
      size
      unit
      qtyIssued
      unitCost
      totalCost
      balanceAfter

  ledger/{ledgerId}/
    poId
    poItemId
    supplierId
    supplierName
    date
    desc
    size
    qty
    unit
    cost
    total
    status
    createdAt
```

Global supplier structure remains:

```text
suppliers/{supplierId}/
  name
  specialty
  contact
  email
  address
  bankName
  accName
  accNum
  createdAt
  updatedAt
```

## Status Values

Purchase request:

```text
draft
submitted
converted
cancelled
```

Purchase order:

```text
pending_approval
approved
ordered
partially_delivered
fully_delivered
closed
cancelled
```

Delivery:

```text
received
received_with_issues
voided
```

Issuance:

```text
posted
voided
```

Movement type:

```text
po_submit
po_approve
receive
issue
adjust_in
adjust_out
return
cancel
invoice
```

## Budget Policy

Recommended Materials v1 policy:

- `materialCommitted`: sum of approved/open PO amounts that are not cancelled or closed.
- `materialReceivedCost`: sum of accepted receiving costs.
- `materialSpent`: equals `materialReceivedCost` for dashboard budget health.

Reason:

For a contractor, once materials are received on site, the project has consumed budget even if the supplier invoice is not yet paid. Invoice matching remains useful, but project cost control should not wait for payment status.

## Transaction Rules

### Submit PO

Writes:

- `purchaseOrders/{poId}`
- `ledger/{poId}_{poItemId}` rows
- optional inventory shell records with zero stock
- `materialMovements/{movementId}` with `type = po_submit`

Rules:

- PO becomes historical immediately.
- Do not add stock on PO submit.
- Do not increase `materialSpent` on PO submit.
- Increase `materialCommitted` only after approval.

### Approve PO

Writes:

- `purchaseOrders/{poId}/status = approved`
- approval fields
- matching ledger status
- `materialMovements/{movementId}` with `type = po_approve`
- project `materialCommitted`

Rules:

- Boss/Admin/Project Manager only.
- Approved PO can receive deliveries.
- Approval does not add inventory.

### Receive Delivery

Writes:

- immutable `deliveries/{deliveryId}`
- item cumulative fields under `purchaseOrders/{poId}/items/{poItemId}`
- `inventory/{itemKey}` balance and value
- one `materialMovements/{movementId}` per accepted item
- PO `deliveryStatus`
- project `materialReceivedCost` and `materialSpent`

Rules:

- Must support multiple deliveries for one PO.
- Must support partial delivery per item.
- Must calculate remaining quantity from all prior accepted deliveries.
- Rejected/damaged quantity should be recorded but should not increase stock.
- Inventory update should use fresh snapshot or transaction logic to avoid stale balance.

### Issue Materials

Writes:

- immutable `materialIssuances/{issueId}`
- `inventory/{itemKey}` reduced balance
- one `materialMovements/{movementId}` per issued item

Rules:

- Issued quantity cannot exceed `qtyOnHand`.
- Issuance reduces stock.
- Issuance does not change `materialSpent`, because the project already counted cost on receiving.
- Reports use issuance records to show consumption by location, scope, or purpose.

### Adjust Inventory

Writes:

- `inventory/{itemKey}`
- `materialMovements/{movementId}` with `adjust_in` or `adjust_out`

Rules:

- Adjustment requires reason notes.
- Adjustment is history, not silent overwrite.
- Boss/Admin/Project Manager only, unless later delegated.

## Reporting Sources

Reports must not depend only on `inventory`.

| Report | Source of truth |
| --- | --- |
| PO History | `purchaseOrders` |
| Delivery History | `deliveries` |
| Stock On Hand | `inventory` plus latest `materialMovements` for audit |
| Issuance History | `materialIssuances` |
| Budget Summary | `materialReceivedCost`, `materialCommitted`, `materialSpent`, verified against movements |
| Supplier Summary | `purchaseOrders`, `deliveries`, `ledger` |
| Item Movement Report | `materialMovements` |

## Firebase Indexes Needed

Add under `projects/{projectId}`:

```json
"purchaseRequests": {
  ".indexOn": ["requestNo", "status", "requestedAt", "neededBy"]
},
"purchaseOrders": {
  ".indexOn": ["seq", "poNo", "status", "supplierId", "createdAt", "date", "deliveryStatus"]
},
"deliveries": {
  ".indexOn": ["poId", "deliveryDate", "receivedAt", "status", "supplierId"]
},
"inventory": {
  ".indexOn": ["itemKey", "description", "qtyOnHand", "lastMovementAt"]
},
"materialMovements": {
  ".indexOn": ["type", "date", "createdAt", "itemKey", "poId", "deliveryId", "issueId", "supplierId"]
},
"materialIssuances": {
  ".indexOn": ["issueNo", "date", "createdAt", "issuedTo", "scope", "status"]
},
"ledger": {
  ".indexOn": ["poId", "poItemId", "status", "supplierId", "date", "createdAt"]
}
```

Phase 1 index status: implemented in `database.rules.json`.

Append-only note:

`materialMovements/{movementId}` now validates required movement fields. Full append-only protection is limited while project-level writes remain broad in Realtime Database rules. The app writes movements append-only, but Cloud Functions or narrower write rules would be needed to make this fully tamper-resistant.

## Phase 1 Helper Functions

Added helper functions in `materials.js`:

- `createPurchaseOrder(projectId, input)`
- `getPurchaseOrder(projectId, poId)`
- `listPurchaseOrders(projectId)`
- `receiveDelivery(projectId, poId, input)`
- `calculateReceivedQtyByPOItem(projectId, poId)`
- `updateInventoryFromReceiving(projectId, receivedItems, options)`
- `issueMaterial(projectId, input)`
- `updateInventoryFromIssuance(projectId, issueItems, options)`
- `createMaterialMovement(projectId, movement)`
- `calculateMaterialBudgetSpent(projectId, options)`
- `validateStockAvailability(projectId, issueItems)`

Phase 1 helper behavior:

- PO submit creates historical PO records.
- Receiving creates delivery records and material movement records.
- Receiving increases inventory only for accepted quantities.
- Issuance creates issuance and material movement records.
- Issuance decreases inventory.
- Receiving cost updates `materialReceivedCost` and `materialSpent`.
- Issuance does not double-count budget.

## Listener Strategy

Materials v1 should keep active listeners narrow:

- Current project budget summary.
- Current project inventory.
- Current project PO history, ideally limited/sorted when possible.
- Current project material alerts.

Use one-time reads for:

- Opening a single PO modal.
- Loading delivery details.
- Loading report exports.
- Supplier lookup, unless the supplier panel is open.

Every project switch must call `detachMatListeners()` before attaching new listeners.

## Migration Plan

Keep existing paths:

- `purchaseOrders`
- `deliveries`
- `inventory`
- `ledger`
- `suppliers`

Add new paths:

- `purchaseRequests`
- `materialMovements`
- `materialIssuances`
- `materialConfig`
- project rollups: `materialCommitted`, `materialReceivedCost`

For old PO records:

- Treat array index as temporary `poItemId` when needed.
- Derive `itemKey` using `normalizeInvKey(description, size)`.
- Recalculate delivery status by summing all matching delivery records.
- Do not rewrite old historical records unless a migration script is intentionally run.

## Implementation Order

1. Update Firebase rules indexes for Materials paths.
2. Add Material service helpers:
   - `buildItemKey()`
   - `buildPoItem()`
   - `sumPoDeliveries()`
   - `recalculatePoDeliveryStatus()`
   - `writeMaterialMovement()`
   - `recalculateMaterialBudgetRollups()`
3. Refactor PO submit to store item IDs and supplier IDs cleanly.
4. Refactor receiving to support cumulative multiple/partial deliveries.
5. Add material issuance stock-out workflow.
6. Make budget dashboard read `materialSpent`, `materialCommitted`, and `materialReceivedCost`.
7. Make Materials reports read historical transaction paths.
8. Run Materials v1 QA.

## Materials v1 QA Checklist

### Supplier

- Supplier can be selected from global directory.
- Typed supplier still works if no directory entry exists.
- Supplier ID is stored when selected.

### Purchase Order

- Submitting a PO creates exactly one PO record.
- PO number is unique per project.
- PO appears in history immediately after submission.
- Existing POs are never overwritten.
- PO submit does not add inventory.

### Approval

- APM can submit PO.
- Boss/Admin/Project Manager can approve PO.
- Approval updates status and committed budget.
- Approval does not add inventory.

### Delivery and Receiving

- One PO can receive multiple deliveries.
- Partial deliveries update only received item quantities.
- Full delivery is detected only after cumulative accepted quantity reaches ordered quantity.
- Rejected quantity is recorded but not added to stock.
- Inventory increases only after accepted receiving.
- Each received item creates a material movement.

### Issuance

- Issuance cannot exceed stock on hand.
- Issuance reduces inventory.
- Each issued item creates a material movement.
- Issuance history remains readable after project reload.

### Budget

- `materialCommitted` reflects approved/open POs.
- `materialReceivedCost` reflects accepted receiving.
- `materialSpent` follows the configured spend policy.
- Dashboard budget updates after receiving.

### Reports

- PO report reads `purchaseOrders`.
- Delivery report reads `deliveries`.
- Issuance report reads `materialIssuances`.
- Stock movement report reads `materialMovements`.
- Inventory report can show current `inventory`, but must link back to movements for audit.

### Reliability

- Switching projects detaches old Materials listeners.
- No duplicate listeners after tab switching.
- No duplicate Firebase writes on submit/receive/issue.
- Offline cached app still loads the latest Materials code after service worker version bump.

## Known Limitations for v1

- Firebase Realtime Database cannot enforce all cross-node business rules by itself.
- Multi-node inventory updates are still client-driven unless moved to Cloud Functions.
- True accounting payment status is separate from project cost tracking.
- Old historical POs may not have stable `poItemId` until touched or migrated.

## Completion Definition

Materials v1 can be marked stable only when:

- PO, approval, delivery, receiving, issuance, inventory, budget, and reports all use this structure.
- Movement history exists for every stock-changing action.
- Multiple and partial deliveries are verified.
- Reports read historical records.
- Firebase indexes match all query paths.
- Manual QA checklist passes on a real Firebase project.
