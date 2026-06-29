# ACPM Change Orders v1 Workflow and Firebase Schema

Status: DATA FOUNDATION IMPLEMENTED - MANUAL QA PENDING

Labor v1 and Materials v1 are frozen. Billing Phase 2 data foundation is implemented but still needs real Firebase QA. Change Orders v1 must preserve the current working UI while moving the workflow toward historical integrity and rebuild-based financial rollups.

## Purpose

Change Orders track approved contract changes after the original scope is agreed.

They affect:

- adjusted contract amount
- project budget deltas
- billing rollups
- receivables when billed
- estimated profit
- history and audit trail

They must not silently rewrite original contract, original budgets, Labor history, or Materials history.

## Current Snapshot

Existing path:

```text
projects/{projectId}/changeOrders
projects/{projectId}/coCounter
projects/{projectId}/laborBudgetDelta
projects/{projectId}/materialBudgetDelta
```

Legacy behavior before v1 refactor:

- A change order can be created with description, requester, date, labor impact, materials impact, and notes.
- Status can move between `pending`, `approved`, and `rejected`.
- Approved status updates `laborBudgetDelta` and `materialBudgetDelta`.
- Billing rollups are rebuilt after status changes.
- Delete action permanently removed a change order.

Production gap fixed in v1 data foundation:

- Deletion now becomes `status = voided`. Approved/rejected/voided change orders remain historical records.
- Approved project budget deltas are rebuilt from change-order history instead of increment/decrement math.
- `changeOrderEvents` and `notificationEvents` rows are created for submitted, approved, rejected, voided, and billing-linked actions.
- `changeOrderRollups` is rebuilt from `projects/{projectId}/changeOrders`.

## Target Workflow

```text
Request
Review
Approve / Reject
Contract Adjustment
Billing Rollup Update
History / Archive
```

## Design Principles

1. Never delete historical change orders.
2. Rejected change orders remain archived.
3. Voided change orders remain archived and ignored by rollups.
4. Approved change orders affect adjusted contract amount.
5. Approved change orders may affect project budget deltas.
6. Change order billing should be explicit; approval changes contract value, but billing still needs a Billing record.
7. Dashboard and reports read rebuildable rollups, not one-off calculated totals.
8. Every status change writes an event/audit row.

## Firebase Structure

```text
projects/{projectId}/
  changeOrders/{changeOrderId}/
    coNo
    seq
    date
    requestedBy
    requestedByRole
    description
    reason
    category
    status
    contractImpact
    laborImpact
    materialsImpact
    otherImpact
    totalImpact
    affectsContract
    affectsBudget
    billingId
    billingStatus
    notes
    attachments/{attachmentId}/
      type
      name
      url
      uploadedAt
      uploadedBy
    createdAt
    createdBy
    reviewedAt
    reviewedBy
    approvedAt
    approvedBy
    rejectedAt
    rejectedBy
    voidedAt
    voidedBy
    voidReason

  changeOrderEvents/{eventId}/
    type
    changeOrderId
    date
    amount
    fromStatus
    toStatus
    description
    createdAt
    createdBy

  changeOrderRollups/
    pendingCount
    approvedCount
    rejectedCount
    voidedCount
    pendingValue
    approvedValue
    rejectedValue
    approvedContractImpact
    approvedLaborImpact
    approvedMaterialsImpact
    lastUpdatedAt
    updatedBy
```

Existing compatibility paths to preserve:

```text
projects/{projectId}/changeOrders
projects/{projectId}/coCounter
projects/{projectId}/laborBudgetDelta
projects/{projectId}/materialBudgetDelta
```

## Statuses

```text
draft
pending
reviewed
approved
rejected
voided
superseded
```

Rollup rules:

- `approved` affects contract/budget rollups.
- `pending`, `reviewed`, and `draft` are visible but do not affect approved totals.
- `rejected`, `voided`, and `superseded` stay in history but are ignored by approved totals.

## Financial Rules

Approved contract impact:

```text
approvedChangeOrders = sum approved non-void changeOrders.totalImpact where affectsContract = true
adjustedContractAmount = originalContractAmount + approvedChangeOrders
```

Budget delta impact:

```text
laborBudgetDelta = sum approved non-void changeOrders.laborImpact where affectsBudget = true
materialBudgetDelta = sum approved non-void changeOrders.materialsImpact where affectsBudget = true
```

Billing impact:

- A change order approval increases adjusted contract value.
- A change order does not become collected revenue by itself.
- To bill a change order, create a Billing record with `type = change_order` and `changeOrderIds`.
- Billing rollups should read approved change orders from history during `rebuildBillingRollups(projectId)`.

Estimated profit:

```text
estimatedProfit = totalRevenueCollected - laborCost - materialCost
```

Approved change orders can improve expected contract value, but profit remains based on collected revenue and costs unless reports choose a contract-value projection.

## Helper Functions Needed

| Helper | Purpose |
| --- | --- |
| `createChangeOrder(projectId, data)` | Creates pending historical request. |
| `listChangeOrders(projectId)` | Reads change order history. |
| `reviewChangeOrder(projectId, changeOrderId, data)` | Marks reviewed without approving. |
| `approveChangeOrder(projectId, changeOrderId)` | Approves, writes event, rebuilds CO and Billing rollups. |
| `rejectChangeOrder(projectId, changeOrderId, reason)` | Rejects and preserves history. |
| `voidChangeOrder(projectId, changeOrderId, reason)` | Voids instead of deleting, rebuilds rollups. |
| `rebuildChangeOrderRollups(projectId)` | Rebuilds CO totals from history. |
| `syncProjectBudgetDeltasFromChangeOrders(projectId)` | Rebuilds budget deltas from approved CO history. |
| `linkChangeOrderBilling(projectId, changeOrderId, billingId)` | Links billed change order to Billing history. |
| `createChangeOrderEvent(projectId, event)` | Appends immutable event trail. |

Implemented helper functions in `changeorders.js`:

- `createChangeOrder(projectId, data)`
- `listChangeOrders(projectId)`
- `reviewChangeOrder(projectId, changeOrderId, notes)`
- `approveChangeOrder(projectId, changeOrderId)`
- `rejectChangeOrder(projectId, changeOrderId, reason)`
- `voidChangeOrder(projectId, changeOrderId, reason)`
- `rebuildChangeOrderRollups(projectId)`
- `syncProjectBudgetDeltasFromChangeOrders(projectId)`
- `linkChangeOrderBilling(projectId, changeOrderId, billingId)`
- `createChangeOrderEvent(projectId, event)`

Implementation notes:

- The Change Order watcher rebuilds CO rollups, project budget deltas, and Billing rollups from history, including the empty-list case.
- Billing linkage validates both records, writes `changeOrders/{id}/billingId`, mirrors the link under `billings/{billingId}/changeOrderIds/{changeOrderId}`, and creates a future notification event.

Browser/UI compatibility functions are still exported:

- `addChangeOrder()`
- `approveRejectCO(key, newStatus)`
- `deleteCO(key, status)` now voids instead of deleting.

## Firebase Indexes Needed

```json
"changeOrders": {
  ".indexOn": ["seq", "coNo", "status", "date", "createdAt", "requestedBy", "billingId"]
},
"changeOrderEvents": {
  ".indexOn": ["type", "changeOrderId", "date", "createdAt", "toStatus"]
},
"changeOrderRollups": {
  ".indexOn": ["lastUpdatedAt"]
}
```

## Migration Notes

Existing rows should map as:

```text
seq -> seq
description -> description
requestedBy -> requestedBy
date -> date
laborImpact -> laborImpact
materialsImpact -> materialsImpact
totalImpact -> laborImpact + materialsImpact
status -> status
createdAt -> createdAt
createdBy -> createdBy
affectsContract = true
affectsBudget = true
```

Existing permanent delete behavior must be replaced with `status = voided`.

## Known Limitations

- Current button icon still uses an `X`, but its aria label/title and behavior are void, not delete.
- Attachments are architecture-ready but not implemented.
- Change-order billing can be linked through the helper layer, but a dedicated UI can come after data integrity is stable.
- Contract/legal approval details vary by client and may require custom printed output later.
- Manual Firebase QA for creating, approving, rejecting, voiding, and billing-linking a safe test change order is still pending to avoid polluting live project records without a QA project.

## Completion Definition

Change Orders v1 can be marked STABLE when:

- Change orders are never permanently deleted.
- Approved/rejected/voided status history is preserved.
- Approved change orders rebuild contract and budget impact from history.
- Billing rollups include approved change orders.
- Rejected/voided change orders do not affect approved totals.
- QA passes on real Firebase after refresh and app restart.
