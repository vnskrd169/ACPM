# ACPM Audit Logs v1

Status: PROJECT/SUPPLIER FALLBACK AUDIT WORKING - GLOBAL AUDIT PATH DEPLOYED-RULE WARNING

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
suppliers/{supplierId}/auditLogs/{logId}
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
- Live Firebase rules must be deployed before canonical global audit writes can pass real Firebase QA.
- Project and supplier fallback audit paths preserve records when the global audit path is denied.
- Some modules still pass rich status details inside `details`; the helper now mirrors common status keys to top-level fields.

## Real Firebase QA Evidence

Script:

```text
scripts/audit_notifications_v1_real_qa.js
```

2026-06-30 result: WARNING

- User inbox notification: PASS
- Project-scoped notification event: PASS
- Audit helper shape/user metadata: PASS
- Project fallback audit write: PASS
- Deployed global Firebase audit write: WARNING, denied by live rules
- QA project: `qa_mr0tbje7_rll3rizt`, archived after run
- Audit fallback path: `projects/qa_mr0tbje7_rll3rizt/auditLogs`

Local `database.rules.json` contains the intended global audit rules. Publish current rules and rerun the QA script before marking the canonical global audit path stable.
