# ACPM Notification Events v1

Status: STABLE - IN-APP EVENT FEED LIVE; PUSH IS FUTURE

Notification Events are now consumed by the in-app notification bell. They do not send browser push notifications yet.

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

Per-user read state for project/global event hooks:

```text
projects/{projectId}/notificationEvents/{eventId}/readBy/{uid}: timestamp
globalNotificationEvents/{eventId}/readBy/{uid}: timestamp
```

## Helper

Implemented in `notifications.js`:

```text
createNotificationEvent({ projectId, module, type, payload, global })
```

The in-app listener also normalizes:

- `notifications/{uid}` direct inbox rows
- `projects/{projectId}/notificationEvents` project event hooks
- `globalNotificationEvents` admin/global event hooks
- `readBy/{uid}` event read state

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

In-app notification feed should:

1. Read direct user inbox records.
2. Read project events for the active/accesssible project set.
3. Read global events for Boss/Admin users.
4. Filter by project access, optional `recipientUserId`, and optional `recipientRole`.
5. Store read state under `readBy/{uid}` without deleting event history.

## Known Limitations

- Push/browser notifications are not implemented.
- Event-to-recipient routing is still basic and client-side: events are visible to users who can read the project unless `recipientUserId` or `recipientRole` narrows visibility.
- Event records are append-only by convention, not by hard Firebase rule.
- Supplier workflow still writes supplier-local fallback notification events under `suppliers/{supplierId}/notificationEvents` if future global rules drift.
- The generic `createNotificationEvent()` helper is best-effort and returns `null` if an event hook is denied, so workflows are not blocked by future notification infrastructure.

## Real Firebase QA Evidence

Script:

```text
scripts/audit_notifications_v1_real_qa.js
```

2026-07-02 result: PASS through `scripts/rc1_post_deploy_gate.js`

- Project-scoped notification event: PASS
- Global notification event: PASS
- Supplier global notification hooks: PASS
- Site Log and Change Order project notification hooks: PASS

Earlier 2026-06-30 result: WARNING

- User inbox notification: PASS
- Mark notification read: PASS
- Project-scoped notification event: PASS
- Global notification event: WARNING, denied by deployed rules
- QA project: `qa_mr0sjs8e_oypq9gsr`, archived after run

Supplier-local fallback QA, 2026-06-30:

- Script: `scripts/suppliers_v1_real_qa.js`
- Supplier: `qa_mr0t91hn_9obvdra6`
- Local fallback notification events: `supplier_created`, `supplier_updated`, `supplier_archived`

Static RC1 integration gate:

- Script: `scripts/audit_notification_supplier_static_qa.js`
- Verifies project/global notification event helper paths.
- Verifies supplier global notification event hooks and supplier-local fallback hooks.
- Verifies local Firebase rules include the required notification event paths.

2026-07-10 investigation fix:

- Root cause: the visible notification bell listened only to `notifications/{uid}` while most modules wrote `projects/{projectId}/notificationEvents` or `globalNotificationEvents`.
- Added in-app listener coverage for project/global event hooks.
- Added event-local `readBy/{uid}` for per-user read state.
- Added missing event hooks for PO approval, billing approval, and collection received.
- Bumped PWA cache/script versions so stale `notifications.js` is not reused.

2026-07-12 focused QA:

- `scripts/notifications_end_to_end_live_qa.js` returned PASS against live Firebase.
- Verified event record creation, Boss/Admin listener consumption, badge display, dropdown rendering, click-through to project workspace, mark-read persistence, refresh persistence, and unassigned-recipient filtering.
- QA project `notif_smoke_mrhwikqk_1e4t6b5f` was archived after the run.

2026-07-13 focused QA on cache `acpm-v123`:

- `scripts/notifications_end_to_end_live_qa.js` returned PASS against live Firebase.
- Verified event path `projects/notif_smoke_mrih7d68_a9s1emhx/notificationEvents/qa_mrih7d68_dxe20nrd`, read state persistence, project workspace click-through, unassigned-recipient filtering, and QA project archive.
