# ACPM Notification Events v1

Status: DATA FOUNDATION IMPLEMENTED - NO PUSH NOTIFICATIONS YET

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
