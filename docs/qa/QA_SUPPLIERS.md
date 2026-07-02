# ACPM Suppliers v1 QA Checklist

Status: SUPPLIERS V1 STABLE - CANONICAL LIVE FIREBASE PATHS PASSED

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

Result: PASS - REAL FIREBASE CORE WORKFLOW QA

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
- [x] Supplier create/update/archive writes status history.
- [x] Supplier create/update/archive event hooks persist in supplier-local fallback paths when global hook paths are denied.
- [x] Verify canonical global event paths after deployed Firebase rules are updated.

Result: PASS - REAL FIREBASE QA

## Materials Linkage

- [x] Supplier quick-use passes supplier ID into `poSupplierId`.
- [x] Materials PO path can keep storing `supplierId` and `supplierName`.
- [x] Archived suppliers are excluded from the shared PO quick-select dropdown.
- [x] Create PO from supplier and verify linkage in real Firebase.
- [x] Verify delivery history reads linked supplier POs.
- [x] Static verification: `listSupplierTransactions()` reads matching delivery records in addition to POs.

Result: PASS - REAL FIREBASE QA

## Supplier Rollups

- [x] `rebuildSupplierRollup(supplierId)` helper exists.
- [x] Rollup reads historical project POs and computes:
  - total purchase orders
  - total PO amount
  - total deliveries
  - outstanding deliveries
  - last PO date
  - last delivery date
- [x] Verify calculated rollup against real Firebase project PO data.
- [x] Verify persisted supplier-local fallback rollup when `supplierRollups/{supplierId}` is denied.
- [x] Verify canonical `supplierRollups/{supplierId}` after deploying current rules.

Result: PASS - CALCULATION AND CANONICAL/FALLBACK PERSISTENCE VERIFIED

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
- [x] Deploy current `database.rules.json` and verify canonical paths:
  - `supplierEvents` write/read
  - `globalNotificationEvents` write/read
  - `supplierRollups` write/read

Result: PASS STATIC + LIVE FIREBASE QA

## Static QA Results

- [x] `node --check suppliers.js`
- [x] `node --check utils.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke test after cache bump: `utils.js?v=58` and `suppliers.js?v=58` loaded, supplier fields present.
- [x] `node --check scripts/suppliers_v1_real_qa.js`
- [x] Real Firebase create/edit/archive/PO-link test in QA project:
  - Script: `scripts/suppliers_v1_real_qa.js`
  - Result: WARNING
  - Supplier: `qa_mr0s3baz_mak0ptki`
  - QA project: `qa_mr0s3crv_lrol7jfk`
  - Core supplier workflow passed.
  - Rollup calculation passed.
  - Deployed rules denied `supplierEvents`, `globalNotificationEvents`, and persisted `supplierRollups`.
- [x] QA cleanup: active QA projects `0`; leftover active QA supplier from an interrupted run archived.
- [x] Browser smoke test after cache v92:
  - Signed-in Boss workspace route rendered through the then-current `main.js?v=90` and `style.css?v=92`.
  - Suppliers tab opened from the visible workspace nav.
  - Supplier Directory rendered with existing supplier rows and PO/Edit/Archive actions visible.
  - Console errors: none.
- [x] Label cleanup smoke after cache v94:
  - `suppliers.js?v=94` loaded.
  - Invalid `\u1Fxxx` escapes were removed from Supplier bank/contact labels.
  - Browser label sweep found no broken glyphs.
- [x] Live Firebase RC1 gate passed after deployed-rule update.
- [x] Local rules deployment gate:
  - `node scripts/firebase_rules_gate.js`
  - Verified `firebase.json` and `.firebaserc` without modifying repository files
  - Confirmed local rules include `supplierEvents`, `supplierRollups`, and `globalNotificationEvents`
- [x] Audit/notification/supplier RC1 static gate:
  - Script: `scripts/audit_notification_supplier_static_qa.js`
  - Confirms canonical supplier event/rollup paths and supplier-local fallback paths exist in code.
  - Confirms supplier writes remain Boss/Owner/Admin-only in local rules.
  - Confirms local rules do not grant Foreman/Safety/Viewer role access for RC1.
- [x] Real Firebase fallback QA after `suppliers.js?v=81`:
  - Script: `scripts/suppliers_v1_real_qa.js`
  - Result: PASS
  - Supplier: `qa_mr0t91hn_9obvdra6`
  - QA project: `qa_mr0t93ha_t04akhvq`
  - Rollup path: `suppliers/qa_mr0t91hn_9obvdra6/rollup`
  - Local event types: `created`, `updated`, `archived`
  - Local notification event types: `supplier_created`, `supplier_updated`, `supplier_archived`
- [x] Real Firebase canonical QA after live rules update:
  - Script: `scripts/rc1_post_deploy_gate.js`
  - Result: PASS
  - Included `scripts/suppliers_v1_real_qa.js` PASS.
  - Verified canonical supplier events, global notification events, and supplier rollups are accepted by live rules.

## Known Limitations

- Supplier performance is a basic operational rollup, not a full vendor scorecard.
- Materials submit was not modified because Materials v1 is frozen.
- Supplier create/update/archive still preserves local fallback history if future deployed-rule drift happens again.

## Stability Gate

Suppliers v1 can be marked STABLE when:

- [x] Create/edit/archive works in real Firebase.
- [x] Archived suppliers remain historical and are hidden from active selection.
- [x] Materials POs keep supplier ID/name linkage.
- [x] Supplier rollup calculation matches historical POs.
- [x] Persisted supplier-local fallback rollups/events pass on current deployed rules.
- [x] Canonical global supplier rollups/events pass after rules deployment.
- [x] Refresh/project switching smoke passed for supplier views in Boss browser read-only smoke.
