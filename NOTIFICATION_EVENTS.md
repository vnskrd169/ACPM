# ACPM Notification Events v1

Status: PROJECT EVENTS QA PASSED - SUPPLIER LOCAL FALLBACK PASSED - GLOBAL EVENTS DEPLOYED-RULE WARNING

Notification Events are future-consumable records. They do not send push notifications yet.

## Firebase Paths

Project-scoped:

```text
projects/{projectId}/notificationEvents/{eventId}/
  module
  type
  status
  consumed
  projectId
  createdAt
  createdBy
  createdByName
  payload fields...
```

Global:

```text
globalNotificationEvents/{eventId}/
  module
  type
  status
  consumed
  createdAt
  createdBy
  createdByName
  payload fields...
```

User inbox notifications remain separate:

```text
notifications/{uid}/{notificationId}
```

## Helper

Implemented in `notifications.js`:

```text
createNotificationEvent({ projectId, module, type, payload, global })
```

## Event Producers

Existing module event hooks include:

- cash advance submitted/approved/rejected/released/deducted/closed
- payroll compiled
- PO/material movements through Materials helpers
- billing/collection events
- change order submitted/approved/rejected/voided
- site log submitted/voided
- supplier created/updated/archived

## Consumption Rules

Future notification service should:

1. Read events where `consumed = false`.
2. Decide recipients based on module, project assignment, and role.
3. Create user-facing records under `notifications/{uid}`.
4. Mark source event consumed with timestamp and processor metadata.

## Known Limitations

- Push/browser notifications are not implemented.
- Event-to-recipient routing is not implemented.
- Event records are append-only by convention, not by hard Firebase rule.
- Global notification event persistence is blocked until deployed Firebase rules match local `database.rules.json`.
- Supplier workflow writes supplier-local fallback notification events under `suppliers/{supplierId}/notificationEvents` when the global path is denied.
- The generic `createNotificationEvent()` helper is best-effort and returns `null` if an event hook is denied, so workflows are not blocked by future notification infrastructure.

## Real Firebase QA Evidence

Script:

```text
scripts/audit_notifications_v1_real_qa.js
```

2026-06-30 result: WARNING

- User inbox notification: PASS
- Mark notification read: PASS
- Project-scoped notification event: PASS
- Global notification event: WARNING, denied by deployed rules
- QA project: `qa_mr0sjs8e_oypq9gsr`, archived after run

Supplier-local fallback QA, 2026-06-30:

- Script: `scripts/suppliers_v1_real_qa.js`
- Supplier: `qa_mr0t91hn_9obvdra6`
- Local fallback notification events: `supplier_created`, `supplier_updated`, `supplier_archived`
