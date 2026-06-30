# ACPM Suppliers v1 Workflow and Firebase Schema

Status: SUPPLIERS V1 STABLE WITH LOCAL FALLBACKS - GLOBAL HOOK RULE DEPLOYMENT STILL RECOMMENDED

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

Fallback paths used when deployed global hook rules lag behind local rules:

```text
suppliers/{supplierId}/events/{eventId}/
suppliers/{supplierId}/notificationEvents/{eventId}/
suppliers/{supplierId}/rollup
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

Real Firebase QA helper:

- `scripts/suppliers_v1_real_qa.js`

Real Firebase QA evidence, 2026-06-30:

- Result: WARNING
- Supplier: `qa_mr0s3baz_mak0ptki`
- QA project: `qa_mr0s3crv_lrol7jfk`
- Core supplier create/update/archive passed.
- Linked PO/delivery transaction read passed.
- Calculated rollup matched expected history:
  - total purchase orders: `1`
  - total PO amount: `1200`
  - total deliveries: `1`
  - outstanding deliveries: `1`
- QA project and QA suppliers were archived after the run.

Fallback stabilization QA evidence, 2026-06-30:

- Result: PASS
- Supplier: `qa_mr0t91hn_9obvdra6`
- QA project: `qa_mr0t93ha_t04akhvq`
- Supplier-local fallback rollup persisted at `suppliers/qa_mr0t91hn_9obvdra6/rollup`.
- Supplier-local fallback events persisted: `created`, `updated`, `archived`.
- Supplier-local fallback notification events persisted: `supplier_created`, `supplier_updated`, `supplier_archived`.

Live deployed-rule warning:

- Current deployed Firebase rules denied writes/reads for:
  - `supplierEvents`
  - `globalNotificationEvents`
  - `supplierRollups`
- Local `database.rules.json` already contains these paths. Publish/deploy the current rules before marking Suppliers v1 stable.

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
- Deployed Firebase rules should still be updated so global supplier rollups/events/notification hooks persist at the canonical paths.
- Supplier event/notification/rollup hooks use supplier-local fallbacks, so supplier history remains durable even if global event rules lag behind.
- Rule deployment gate helper: `scripts/firebase_rules_gate.js`.
