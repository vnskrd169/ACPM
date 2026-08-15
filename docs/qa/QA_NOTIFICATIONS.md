# ACPM Notification Events v1 QA Checklist

Status: STABLE - IN-APP EVENT FEED LIVE; PUSH IS FUTURE

## Event Paths

- [x] Project-scoped `projects/{projectId}/notificationEvents` exists.
- [x] Global `globalNotificationEvents` exists.
- [x] User inbox `notifications/{uid}` remains unchanged.
- [x] Per-user event read state uses event-local `readBy/{uid}`.
- [x] Firebase indexes exist for module/type/status/consumed/createdAt.

Result: PASS STATIC / PROJECT EVENTS REAL QA

## Helper

- [x] `createNotificationEvent()` exists in `notifications.js`.
- [x] Helper writes project-scoped events when `projectId` is provided.
- [x] Helper writes global events when `global = true` or no project is provided.
- [x] Helper sets:
  - `module`
  - `type`
  - `status = pending`
  - `consumed = false`
  - `createdAt`
  - `createdBy`

- [x] Helper is best-effort and returns `null` instead of blocking workflows when future event hooks are denied.

Result: PASS STATIC + LIVE FIREBASE QA

## Module Hooks

- [x] Cash Advance creates notification events.
- [x] Change Orders creates notification events.
- [x] Site Logs creates notification events.
- [x] Suppliers creates global notification events, with supplier-local fallback when the global path is denied.
- [x] Verify project-scoped event hook in real Firebase QA.
- [x] Verify global event hooks after deploying current Firebase rules.
- [x] Verify Billing, Change Order, Site Log, Supplier, and Labor event/audit hooks in real Firebase QA.

Result: PASS LIVE FIREBASE QA

## In-App Feed

- [x] Bell listener reads `notifications/{uid}`.
- [x] Bell listener reads project `notificationEvents` for the current workspace.
- [x] Bell listener reads all accessible project events for Boss/Admin dashboard view.
- [x] Bell listener reads `globalNotificationEvents` for Boss/Admin users.
- [x] Bell filters by project access, optional recipient user, and optional recipient role.
- [x] Badge count uses unread direct inbox plus unread event hooks.
- [x] Mark-as-read writes to direct inbox rows or event-local `readBy/{uid}` without deleting event hooks.

Result: PASS STATIC + LIVE FIREBASE QA

## Explicit Non-Goal

- [x] No push notifications implemented.
- [x] No service worker push subscription implemented.
- [x] No browser push/event worker implemented yet.
- [x] Notification feed icons use stable ASCII labels instead of malformed Unicode escapes.

Result: PASS

## Static QA Results

- [x] `node --check notifications.js`
- [x] `node --check scripts/audit_notifications_v1_real_qa.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke after cache v62 had no console warnings/errors in the local signed-in Boss session.
- [x] Local HTTP smoke after cache v72 confirmed updated shared files serve.
- [ ] Browser smoke after cache v71 timed out in automation and still needs manual verification.
- [x] Real Firebase audit/notification QA:
  - Script: `scripts/audit_notifications_v1_real_qa.js`
  - Result: WARNING
  - User inbox notification: PASS
  - Project event: PASS
  - Global event: denied by deployed rules.
- [x] Real Firebase supplier-local notification fallback QA:
  - Script: `scripts/suppliers_v1_real_qa.js`
  - Supplier: `qa_mr0t91hn_9obvdra6`
  - Local fallback notification events: `supplier_created`, `supplier_updated`, `supplier_archived`
- [x] Audit/notification/supplier RC1 static gate:
  - Script: `scripts/audit_notification_supplier_static_qa.js`
  - Verifies `createNotificationEvent()` writes project/global event paths.
  - Verifies supplier workflows use global notification events with supplier-local fallback.
  - Verifies local rules include required notification event paths.
- [x] Live Firebase RC1 gate after rules update:
  - Script: `scripts/rc1_post_deploy_gate.js`
  - Result: PASS
  - Included global notification event verification through `scripts/audit_notifications_v1_real_qa.js`.
  - Included supplier global notification hooks through `scripts/suppliers_v1_real_qa.js`.
  - Included Site Log and Change Order project notification hooks through their real QA scripts.
- [x] Live browser smoke after cache v116:
  - Boss notification bell opened from the Hub.
  - Feed rendered direct/event rows and the Clear read control.
  - Console errors/warnings: none in the fresh v116 smoke.

## 2026-07-10 End-to-End Investigation

Root cause:

- FAILED: the app bell only watched `notifications/{uid}`.
- PASS: module event hooks were already writing project/global notification event records.
- IMPACT: cash advance, change order, site log, supplier, and other event-hook rows existed in Firebase but did not appear in the visible bell unless a module also called `sendNotification()`.

Fixes verified statically:

- [x] `notifications.js` merges direct inbox rows, project event hooks, global event hooks, and read state.
- [x] `database.rules.json` continues to use existing project/global notification event paths; no new root read-state path is required.
- [x] `materials.js` writes `po_approved` notification event hooks.
- [x] `billing.js` writes `billing_approved` and `collection_received` notification event hooks.
- [x] `sw.js` cache bumped to `acpm-v107`.
- [x] App shells load `style.css?v=98`, `materials.js?v=94`, `billing.js?v=75`, and `notifications.js?v=84`.
- [x] Read notifications can be cleared per user without deleting historical Firebase records.

Manual/live QA plan:

- [x] Create safe QA project event and confirm it exists under `projects/{projectId}/notificationEvents`.
- [x] Confirm signed-in Boss/Admin sees badge increment and feed row.
- [x] Mark row read and confirm event-local `readBy/{uid}` is written.
- [x] Refresh and confirm read state persists.
- [x] Simulate unassigned APM client filter and confirm the QA event does not render.

Live Firebase QA evidence:

```text
node scripts/notifications_end_to_end_live_qa.js
Result: PASS
Project: notif_smoke_mrehjx8u_tzprx0js (archived)
Event: projects/notif_smoke_mrehjx8u_tzprx0js/notificationEvents/qa_mrehjx8u_d2hv0pjx
Read state: projects/notif_smoke_mrehjx8u_tzprx0js/notificationEvents/qa_mrehjx8u_d2hv0pjx/readBy/xa5YJlq1BCZw13H5uRJ1CGsCwgd2
Click routing: PASS, notification opened project workspace route
```

2026-07-12 focused live Firebase QA:

```text
node scripts/notifications_end_to_end_live_qa.js
Result: PASS
Project: notif_smoke_mrhwikqk_1e4t6b5f (archived)
Event: projects/notif_smoke_mrhwikqk_1e4t6b5f/notificationEvents/qa_mrhwikqk_v76ef6f6
Read state: projects/notif_smoke_mrhwikqk_1e4t6b5f/notificationEvents/qa_mrhwikqk_v76ef6f6/readBy/xa5YJlq1BCZw13H5uRJ1CGsCwgd2
Badge visible: PASS
Rendered unread row: PASS
Click routing to project workspace: PASS
Mark read persisted: PASS
Refresh preserved read state: PASS
Unassigned client filter: PASS
QA project archived: PASS
```

2026-07-13 focused live Firebase QA on cache `acpm-v123`:

```text
node scripts/notifications_end_to_end_live_qa.js
Result: PASS
Project: notif_smoke_mrih7d68_a9s1emhx (archived)
Event: projects/notif_smoke_mrih7d68_a9s1emhx/notificationEvents/qa_mrih7d68_dxe20nrd
Read state: projects/notif_smoke_mrih7d68_a9s1emhx/notificationEvents/qa_mrih7d68_dxe20nrd/readBy/xa5YJlq1BCZw13H5uRJ1CGsCwgd2
Badge visible: PASS
Rendered unread row: PASS
Click routing to project workspace: PASS
Mark read persisted: PASS
Refresh preserved read state: PASS
Unassigned client filter: PASS
QA project archived: PASS
```

Bug found during QA:

- FAILED first run: read state was written but refresh still rendered the QA event as unread.
- FIXED: `normalizeEventNotification()` now checks the event row's `readBy` map when deriving `read`.
- Cleanup: failed QA/smoke projects `qa_mregeomi_q4chjxhi`, `qa_mreh2qub_ut39cid4`, `qa_mreh3cj4_298new7g`, `qa_mreh3y0p_d424s2wu`, and `qa_mreh4ip5_wcmb6uda` were archived and marked/left as QA cleanup records.

2026-07-10 UI cleanup:

- [x] Notification dropdown now uses card-style rows instead of raw debug-looking rows.
- [x] Notification cards open their explicit link when available, otherwise they open the related project workspace.
- [x] Project notification cards append a target tab and highlight the opened module panel so the user can see where the action is needed.
- [x] QA/test notification rows are hidden from the normal in-app feed.
- [x] Notification badge and dropdown inline styles moved into `style.css`.
- [x] Private app pages no longer load unused reCAPTCHA Enterprise script, removing the stray bottom-right badge from dashboard/workspace.

## Stability Gate

Notification Events v1 can be marked STABLE when:

- [x] Real workflows create project-scoped event rows.
- [x] Supplier workflows create supplier-local fallback event rows when global hooks are denied.
- [x] Real workflows create global event rows after deployed rules are updated.
- [x] Events remain readable after refresh through real Firebase read-back QA.
- [x] Events do not create duplicate user inbox notifications in current helper workflow QA.
- [x] Future consumer requirements remain documented.
