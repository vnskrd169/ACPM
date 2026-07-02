# ACPM Audit Logs v1

Status: STABLE WITH GLOBAL-PATH WARNING - PROJECT AND SUPPLIER FALLBACK AUDIT QA PASSED

Audit logs preserve important user actions across ACPM.

## Firebase Path

```text
auditLogs/{logId}/
  action
  entityType
  entityId
  module
  recordId
  details
  previousStatus
  newStatus
  notes
  userId
  userName
  userEmail
  userRole
  projectId
  timestamp
  date
```

Fallback paths used when the global audit path is denied:

```text
projects/{projectId}/auditLogs/{logId}
supplierAuditLogs/{supplierId}/{logId}
```

## Required Actions

Audit calls exist across major workflows for:

- create
- update/edit
- approve
- reject
- void
- archive
- restore
- complete/reopen
- receive
- issue
- collect
- backup/export

## Helper

Implemented in `utils.js`:

```text
auditLog(action, entityType, entityId, details)
```

The helper is fire-and-forget and must never break the calling workflow. It writes compatibility fields (`entityType`, `entityId`) and RC1 fields (`module`, `recordId`, `previousStatus`, `newStatus`, `notes`).

## Retention

`pruneAuditLog(keepLatest = 2000)` keeps the database small by pruning oldest logs. This is admin-only housekeeping.

## Known Limitations

- Audit logs are append-only by convention, but boss/admin pruning is allowed.
- Project fallback audit paths preserve records if future global audit rules drift.
- Supplier fallback audit uses the safer admin-only root `supplierAuditLogs/{supplierId}`.
- Admin Audit Log reads global audit rows plus project/supplier fallback audit rows, deduplicates them, and labels fallback-source rows.
- Some modules still pass rich status details inside `details`; the helper now mirrors common status keys to top-level fields.

## Real Firebase QA Evidence

Script:

```text
scripts/audit_notifications_v1_real_qa.js
```

2026-07-02 result: PASS through `scripts/rc1_post_deploy_gate.js`

- Canonical global audit write: WARNING, can be denied by deployed rules
- Supplier fallback audit read/write: PASS
- Project fallback audit read/write: PASS
- User metadata fields persisted: PASS

Earlier 2026-06-30 result: WARNING

- User inbox notification: PASS
- Project-scoped notification event: PASS
- Audit helper shape/user metadata: PASS
- Project fallback audit write: PASS
- Deployed global Firebase audit write: WARNING, denied by live rules
- Latest QA project: `qa_mr1gj0be_jilh2jbm`, archived after run
- Audit fallback path: `projects/qa_mr1gj0be_jilh2jbm/auditLogs`

Latest browser/live workflow evidence after cache v97:

- Change Order reject modal QA project: `qa_mr342wcu_8satiur8`, archived after run
- Global `/auditLogs` write: WARNING, denied by deployed rules
- Project fallback audit rows: PASS for Change Order create/update at `projects/qa_mr342wcu_8satiur8/auditLogs`
- Static fallback gate: PASS. `scripts/audit_notification_supplier_static_qa.js` verifies fallback markers `globalPathDenied: true` and `fallbackPath: true`, project/supplier fallback paths, Admin Audit Log fallback readers, and the visible fallback source label.

Audit review UI evidence:

- `report.js?v=84` reads `auditLogs`, `projects/{projectId}/auditLogs`, and `supplierAuditLogs/{supplierId}`.
- Fallback rows are merged, deduplicated, and labeled as `Local fallback audit path`.
- `detachReportsListeners()` detaches audit fallback listeners during project/logout cleanup.

Safer supplier fallback path:

- `utils.js?v=84` writes future supplier audit fallback rows to `supplierAuditLogs/{supplierId}` instead of under public supplier profiles.
- Live RC1 Firebase gate passed supplier fallback audit writes after rules update.

Local `database.rules.json` contains the intended global audit rules, but current browser/live workflow evidence still shows global audit writes may be denied in the deployed database. RC1 relies on project/supplier fallback audit paths until deployed global audit behavior is revalidated as clean.
