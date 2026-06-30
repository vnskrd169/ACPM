# ACPM Notification Events v1 QA Checklist

Status: DATA FOUNDATION IMPLEMENTED - MANUAL QA PENDING

## Event Paths

- [x] Project-scoped `projects/{projectId}/notificationEvents` exists.
- [x] Global `globalNotificationEvents` exists.
- [x] User inbox `notifications/{uid}` remains unchanged.
- [x] Firebase indexes exist for module/type/status/consumed/createdAt.

Result: PASS STATIC

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

Result: PASS STATIC

## Module Hooks

- [x] Cash Advance creates notification events.
- [x] Change Orders creates notification events.
- [x] Site Logs creates notification events.
- [x] Suppliers creates global notification events.
- [ ] Verify Billing/Materials event hooks in real Firebase QA.

Result: PASS STATIC / PENDING REAL FIREBASE QA

## Explicit Non-Goal

- [x] No push notifications implemented.
- [x] No service worker push subscription implemented.
- [x] No event consumer implemented yet.
- [x] Notification feed icons use stable ASCII labels instead of malformed Unicode escapes.

Result: PASS

## Static QA Results

- [x] `node --check notifications.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke after cache v62 had no console warnings/errors in the local signed-in Boss session.
- [x] Local HTTP smoke after cache v72 confirmed updated shared files serve.
- [ ] Browser smoke after cache v71 timed out in automation and still needs manual verification.

## Stability Gate

Notification Events v1 can be marked STABLE when:

- [ ] Real workflows create event rows.
- [ ] Events remain readable after refresh.
- [ ] Events do not create duplicate user inbox notifications.
- [ ] Future consumer requirements remain documented.
