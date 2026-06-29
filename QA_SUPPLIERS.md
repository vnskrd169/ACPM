# ACPM Suppliers v1 QA Checklist

Status: DATA FOUNDATION IMPLEMENTED - MANUAL FIREBASE QA PENDING

Scope:

- Preserve Materials v1.
- No UI redesign.
- Stabilize supplier profile, archive/history, and PO linkage foundation.

## Existing Behavior to Preserve

- [x] Boss can create supplier.
- [x] Boss can edit supplier.
- [x] Supplier quick-select still fills Materials PO supplier fields.
- [x] Supplier directory filters by text.
- [x] Supplier export works.

Result: PASS STATIC / PENDING REAL FIREBASE WORKFLOW QA

## Historical Integrity

- [x] Delete action is replaced by archive action.
- [x] Archived supplier remains under `suppliers/{supplierId}`.
- [x] Archived supplier has:
  - `status = archived`
  - `archivedAt`
  - `archivedBy`
  - `archiveReason`
- [x] Active supplier directory hides archived suppliers.
- [x] Export includes archived suppliers with status and archive reason.

Result: PASS STATIC / PENDING REAL FIREBASE WORKFLOW QA

## Materials Linkage

- [x] Supplier quick-use passes supplier ID into `poSupplierId`.
- [x] Materials PO path can keep storing `supplierId` and `supplierName`.
- [x] Archived suppliers are excluded from the shared PO quick-select dropdown.
- [ ] Create PO from supplier and verify linkage in real Firebase.
- [ ] Verify delivery history reads linked supplier POs.

Result: PASS STATIC / PENDING REAL FIREBASE QA

## Supplier Rollups

- [x] `rebuildSupplierRollup(supplierId)` helper exists.
- [x] Rollup reads historical project POs and computes:
  - total purchase orders
  - total PO amount
  - outstanding deliveries
  - last PO date
- [ ] Verify against real Firebase project PO data.

Result: PASS STATIC / PENDING REAL FIREBASE QA

## Firebase Rules / Index QA

- [x] Add/verify indexes for:
  - `suppliers.name`
  - `suppliers.specialty`
  - `suppliers.status`
  - `suppliers.updatedAt`
  - `suppliers.archivedAt`
  - `supplierEvents.type`
  - `supplierEvents.supplierId`
  - `supplierEvents.createdAt`
  - `supplierRollups.supplierId`
  - `supplierRollups.lastUpdatedAt`
- [x] Supplier writes remain boss-only.
- [x] Supplier reads remain available to authenticated users for PO selection.

Result: PASS STATIC

## Static QA Results

- [x] `node --check suppliers.js`
- [x] `node --check utils.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke test after cache bump: `utils.js?v=58` and `suppliers.js?v=58` loaded, supplier fields present.
- [ ] Browser console clean after deployed Firebase rules: current live smoke still shows older audit-log permission warning from cached/live rules.
- [ ] Real Firebase create/edit/archive/PO-link test in QA project

## Known Limitations

- Supplier performance is a basic rollup, not a full scorecard.
- Materials submit was not modified because Materials v1 is frozen.
- Manual Firebase QA is pending because supplier create/archive produces permanent records.

## Stability Gate

Suppliers v1 can be marked STABLE when:

- [ ] Create/edit/archive works in real Firebase.
- [ ] Archived suppliers remain historical and are hidden from active selection.
- [ ] Materials POs keep supplier ID/name linkage.
- [ ] Supplier rollups match historical POs.
- [ ] Refresh/logout/login/project switching does not break supplier views.
