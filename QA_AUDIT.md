# ACPM Audit Logs v1 QA Checklist

Status: PROJECT/SUPPLIER FALLBACK AUDIT WORKING - GLOBAL AUDIT PATH DEPLOYED-RULE WARNING

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
- [ ] Deploy rules and verify live browser warning is gone.
- [x] Local rules gate validates `auditLogs` path exists: `node scripts/firebase_rules_gate.js`

Result: PASS STATIC / PENDING DEPLOYED RULE QA

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
- [ ] Deployed rules allow canonical global audit rows to persist with user names, not only UID.

Result: PASS FALLBACK / WARNING GLOBAL DEPLOYED RULES

## Static QA Results

- [x] `node --check utils.js`
- [x] `node --check scripts/audit_notifications_v1_real_qa.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke after cache v62 had no console warnings/errors in the local signed-in Boss session.
- [x] Local HTTP smoke after cache v72 confirmed updated shared files serve.
- [ ] Browser smoke after cache v71 timed out in automation and still needs manual verification.
- [x] Real Firebase audit/notification QA:
  - Script: `scripts/audit_notifications_v1_real_qa.js`
  - Result: WARNING
  - QA project: `qa_mr0tbje7_rll3rizt`
  - Global audit write was denied by deployed rules.
  - Project fallback audit write passed at `projects/qa_mr0tbje7_rll3rizt/auditLogs`.
- [ ] Browser smoke after deployed rules

## Known Limitations

- Current live browser smoke may still show canonical global audit permission warnings before rules deployment.
- Pruning is allowed for database size control.
- Audit helper is fire-and-forget and now writes project/supplier fallback audit records when possible, so workflow actions survive audit-rule drift.

## Stability Gate

Audit Logs v1 can be marked STABLE when:

- [x] Project fallback audit writes pass for project workflows.
- [ ] Deployed rules allow canonical global audit writes for normal workflows.
- [x] Persisted fallback audit rows show user name/email/role where available.
- [ ] Critical workflows produce audit entries.
- [ ] Audit screen loads for admin roles only.
