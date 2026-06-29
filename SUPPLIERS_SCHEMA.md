# ACPM Suppliers v1 Workflow and Firebase Schema

Status: DATA FOUNDATION IMPLEMENTED - MANUAL QA PENDING

Suppliers are global company records used by Materials purchase orders, deliveries, and procurement reporting.

## Workflow

```text
Supplier Profile
Create / Update
Use in Purchase Order
Delivery History
Performance / Outstanding Deliveries
Archive
History / Reports
```

## Firebase Structure

```text
suppliers/{supplierId}/
  name
  contact
  specialty
  bankName
  accNum
  accName
  notes
  status
  addedAt
  addedBy
  createdAt
  createdBy
  updatedAt
  updatedBy
  statusHistory/{historyId}/
    fromStatus
    toStatus
    notes
    createdAt
    createdBy
  archivedAt
  archivedBy
  archiveReason

supplierEvents/{eventId}/
  type
  supplierId
  supplierName
  description
  createdAt
  createdBy

supplierRollups/{supplierId}/
  supplierId
  supplierName
  totalPurchaseOrders
  totalPOAmount
  totalDeliveries
  outstandingDeliveries
  lastPODate
  lastDeliveryDate
  lastUpdatedAt
  updatedBy

globalNotificationEvents/{eventId}/
  module
  type
  status
  consumed
  supplierId
  createdAt
  createdBy
```

## Statuses

```text
active
archived
disabled
```

Rules:

- Active suppliers appear in the Supplier Directory and Materials quick-select dropdown.
- Archived suppliers remain in Firebase and exports, but are hidden from active selection.
- Suppliers are not hard-deleted by normal UI actions.

## Materials Linkage

Materials purchase orders already store:

```text
projects/{projectId}/purchaseOrders/{poId}/supplierId
projects/{projectId}/purchaseOrders/{poId}/supplierName
```

Supplier rollups derive PO and delivery history from existing project purchase orders and deliveries. This avoids changing the frozen Materials v1 workflow.

## Implemented Helpers

- `createSupplier(data)`
- `updateSupplier(supplierId, data)`
- `archiveSupplier(supplierId, reason)`
- `listSuppliers(options)`
- `listSupplierTransactions(supplierIdOrName)`
- `rebuildSupplierRollup(supplierId)`
- `createSupplierEvent(event)`

Existing UI functions preserved:

- `addSupplier()`
- `saveEditSupplier()`
- `deleteSupplier()` now archives instead of deleting.
- `useSupplierInPO(name, supplierId)`
- `filterSuppliers(query)`
- `exportSuppliersCSV()`

## Known Limitations

- Supplier rollups rebuild from existing project POs and deliveries when supplier helpers run; Materials PO submit is not modified in this pass.
- Supplier performance is currently basic: total POs, total PO amount, delivery count, outstanding delivery count, last PO date, and last delivery date.
- Supplier notes/history UI is still minimal.
- Manual Firebase QA is pending because create/archive operations produce permanent historical records.
