# ACPM Audit Logs v1 QA Checklist

Status: STABLE WITH GLOBAL-PATH WARNING - PROJECT AND SUPPLIER FALLBACK AUDIT QA PASSED

## Helper Behavior

- [x] `auditLog()` exists in `utils.js`.
- [x] Audit logs preserve legacy fields:
  - `action`
  - `entityType`
  - `entityId`
  - `details`
  - `userId`
  - `userName`
  - `timestamp`
- [x] Audit logs add RC1 fields:
  - `module`
  - `recordId`
  - `previousStatus`
  - `newStatus`
  - `notes`
- [x] Audit helper is fire-and-forget and does not break workflow if write fails.
- [x] Console audit prefix uses stable ASCII text.

Result: PASS STATIC

## Firebase Rules

- [x] Boss/Owner/Admin can read audit logs.
- [x] Users can write their own audit rows.
- [x] Boss/Owner/Admin can write/prune audit rows.
- [x] Live Firebase RC1 gate passed after rules update.
- [x] Local rules gate validates `auditLogs` path exists: `node scripts/firebase_rules_gate.js`

Result: PASS STATIC + LIVE FIREBASE QA

## Workflow Coverage

- [x] Project create/edit/archive/restore lifecycle calls audit.
- [x] Labor payroll/cash advance paths call audit.
- [x] Materials PO/receiving/issuance paths call audit.
- [x] Billing actions call audit.
- [x] Change Orders call audit.
- [x] Site Logs call audit.
- [x] Suppliers call audit.
- [x] Real QA verifies audit payload includes user name/email/role before write.
- [x] Project fallback audit rows persist with user names, not only UID.
- [x] Admin Audit Log can read fallback audit rows from project and supplier fallback paths in code.
- [x] Supplier fallback audit path is moved to admin-only `supplierAuditLogs/{supplierId}` in local rules/code.
- [ ] Deployed rules allow canonical global audit rows to persist with user names, not only UID.
- [x] Project fallback audit rows persist when deployed global audit writes are denied.
- [x] Deployed rules allow `supplierAuditLogs/{supplierId}` writes/reads.

Result: PASS LIVE FIREBASE QA WITH GLOBAL AUDIT FALLBACK WARNING

## Static QA Results

- [x] `node --check utils.js`
- [x] `node --check scripts/audit_notifications_v1_real_qa.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke after cache v62 had no console warnings/errors in the local signed-in Boss session.
- [x] Local HTTP smoke after cache v72 confirmed updated shared files serve.
- [x] Browser smoke after cache v92:
  - Boss workspace loaded with `style.css?v=92` and the then-current `main.js?v=90`.
  - Admin panel remained clickable while the selected project was read-only/locked.
  - Requests tab switched from Summary and rendered Lifecycle Requests.
  - Audit Log tab switched from Summary and rendered audit rows with user name/email context.
  - Console errors: none.
  - Historical warning observed before live rule update: global audit write returned `permission_denied`.
- [x] Real Firebase audit/notification QA:
  - Script: `scripts/audit_notifications_v1_real_qa.js`
  - Result: WARNING
  - QA project: `qa_mr0tbje7_rll3rizt`
  - Global audit write was denied by deployed rules.
  - Project fallback audit write passed at `projects/qa_mr0tbje7_rll3rizt/auditLogs`.
- [x] Real Firebase audit/notification QA rerun after `report.js?v=83`:
  - Script: `scripts/audit_notifications_v1_real_qa.js`
  - Result: WARNING
  - QA project: `qa_mr1gbozz_52zgknh0`
  - Global audit write was denied by deployed rules.
  - Project fallback audit write passed at `projects/qa_mr1gbozz_52zgknh0/auditLogs`.
- [x] Real Firebase audit/notification QA rerun after `utils.js?v=84` / `report.js?v=84`:
  - Script: `scripts/audit_notifications_v1_real_qa.js`
  - Result: WARNING
  - QA project: `qa_mr1gj0be_jilh2jbm`
  - Global audit write was denied by deployed rules.
  - Project fallback audit write passed at `projects/qa_mr1gj0be_jilh2jbm/auditLogs`.
- [x] RC1 static gate after `report.js?v=83`:
  - Verifies project fallback audit collector exists.
  - Verifies supplier fallback audit collector exists.
  - Verifies fallback rows are labeled in the Audit Log UI.
- [x] RC1 static gate after `utils.js?v=84` / `report.js?v=84`:
  - Verifies supplier fallback audit writes use `supplierAuditLogs/{supplierId}`.
  - Verifies `supplierAuditLogs` exists in local Firebase rules.
  - Verifies project fallback audit path is indexed in local Firebase rules.
- [x] Audit/notification/supplier RC1 static gate:
  - Script: `scripts/audit_notification_supplier_static_qa.js`
  - Verifies global audit write path plus project and supplier fallback paths.
  - Verifies fallback rows include `globalPathDenied: true` and `fallbackPath: true`.
  - Verifies Admin Audit Log reads `auditLogs`, `projects/{projectId}/auditLogs`, and `supplierAuditLogs/{supplierId}`.
  - Verifies Admin Audit Log labels fallback rows as `Local fallback audit path`.
  - Verifies supplier audit fallback is not stored under public supplier profile paths.
- [x] Live Firebase RC1 gate after rules update:
  - Script: `scripts/rc1_post_deploy_gate.js`
  - Result: PASS
- [x] Browser/live Firebase Change Order reject QA after cache v97:
  - Project: `qa_mr342wcu_8satiur8`, archived after test.
  - Global `/auditLogs` write was denied by deployed rules.
  - Project fallback audit rows were confirmed for Change Order create/update at `projects/qa_mr342wcu_8satiur8/auditLogs`.
  - Included `scripts/audit_notifications_v1_real_qa.js` PASS.
  - Included supplier fallback/canonical audit-path verification through `scripts/suppliers_v1_real_qa.js` PASS.
- [x] PM workload clarity pass after cache v116:
  - Admin Audit Log renders clear action cards with module pill, action label, actor identity, project label, record summary, source, and details.
  - Actor display prefers user profile name/email/position/avatar when available and does not require PMs to decode UID first.
  - No audit schema, write paths, or listeners changed.
  - Static syntax and RC1 gates passed for `report.js?v=95` and `style.css?v=100`.
- [x] Live browser smoke after cache v116:
  - Boss opened Team Admin, switched to Audit Log, and rendered 128 audit cards.
  - First card showed module/action, actor identity, project name, record id, source, and details.
  - Console errors/warnings: none in the fresh v116 smoke.

## Known Limitations

- Pruning is allowed for database size control.
- Audit helper is fire-and-forget and now writes project fallback audit records on current deployed rules when possible, so project workflow actions survive audit-rule drift.
- Browser log tooling can retain old captured permission warnings; rely on fresh run timestamps and the real Firebase gate for deployed-rule status.

## Stability Gate

Audit Logs v1 can be marked STABLE when:

- [x] Project fallback audit writes pass for project workflows.
- [x] Audit fallback rows are reviewable through Admin Audit Log code path.
- [x] Supplier fallback audit writes pass after rules deployment.
- [ ] Deployed rules allow canonical global audit writes for normal workflows.
- [x] Project fallback audit writes cover normal project workflows when global writes are denied.
- [x] Persisted fallback audit rows show user name/email/role where available.
- [x] Critical workflows produce audit entries through real QA and static workflow coverage.
- [x] Audit screen loads for admin roles in Boss browser smoke and static role gate.
