# ACPM Audit Logs v1 QA Checklist

Status: DATA FOUNDATION IMPLEMENTED - DEPLOYED RULE QA PENDING

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

Result: PASS STATIC / PENDING DEPLOYED RULE QA

## Workflow Coverage

- [x] Project create/edit/archive/restore lifecycle calls audit.
- [x] Labor payroll/cash advance paths call audit.
- [x] Materials PO/receiving/issuance paths call audit.
- [x] Billing actions call audit.
- [x] Change Orders call audit.
- [x] Site Logs call audit.
- [x] Suppliers call audit.
- [ ] Manual QA verify audit rows appear with user names, not only UID.

Result: PASS STATIC / PENDING REAL FIREBASE QA

## Static QA Results

- [x] `node --check utils.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke after cache v62 had no console warnings/errors in the local signed-in Boss session.
- [x] Local HTTP smoke after cache v72 confirmed updated shared files serve.
- [ ] Browser smoke after cache v71 timed out in automation and still needs manual verification.
- [ ] Browser smoke after deployed rules

## Known Limitations

- Current live browser smoke still showed audit permission warnings before rules deployment.
- Pruning is allowed for database size control.

## Stability Gate

Audit Logs v1 can be marked STABLE when:

- [ ] Deployed rules allow audit writes for normal workflows.
- [ ] Audit rows show user name/email/role where available.
- [ ] Critical workflows produce audit entries.
- [ ] Audit screen loads for admin roles only.
