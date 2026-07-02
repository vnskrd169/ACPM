# ACPM Notification Events v1 QA Checklist

Status: STABLE - PROJECT AND GLOBAL EVENT HOOKS LIVE QA PASSED; PUSH IS FUTURE

## Event Paths

- [x] Project-scoped `projects/{projectId}/notificationEvents` exists.
- [x] Global `globalNotificationEvents` exists.
- [x] User inbox `notifications/{uid}` remains unchanged.
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

## Explicit Non-Goal

- [x] No push notifications implemented.
- [x] No service worker push subscription implemented.
- [x] No event consumer implemented yet.
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

## Stability Gate

Notification Events v1 can be marked STABLE when:

- [x] Real workflows create project-scoped event rows.
- [x] Supplier workflows create supplier-local fallback event rows when global hooks are denied.
- [x] Real workflows create global event rows after deployed rules are updated.
- [x] Events remain readable after refresh through real Firebase read-back QA.
- [x] Events do not create duplicate user inbox notifications in current helper workflow QA.
- [x] Future consumer requirements remain documented.
