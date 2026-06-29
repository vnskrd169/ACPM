# ACPM Audit Logs v1

Status: DATA FOUNDATION IMPLEMENTED - DEPLOYED RULE QA PENDING

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
- Live Firebase rules must be deployed before browser warnings can be considered fixed.
- Some modules still pass rich status details inside `details`; the helper now mirrors common status keys to top-level fields.
