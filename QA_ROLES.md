# ACPM Roles and Permissions v1 QA Checklist

Status: RC1 MANAGEMENT ROLES ONLY - BROWSER/DEPLOYED QA PENDING

## Role Normalization

- [x] Legacy `boss` remains admin-capable.
- [x] Legacy `apm` remains assigned-project operational role.
- [x] RC1 active values accepted in app helpers:
  - `owner`
  - `admin`
  - `pm`
- [x] Future values remain labelable/documented but are disabled for active access:
  - `foreman`
  - `safety`
  - `viewer`
- [x] Role labels render through `roleLabel()`.

Result: PASS STATIC

## UI Visibility

- [x] Billing and Reports use financial-role visibility.
- [x] Foreman/Safety/Viewer are not included in active tab visibility.
- [x] Foreman/Safety/Viewer are blocked by `isRc1ActiveRole()` before app initialization.
- [x] Viewer has no edit capability through `canEditProject()`.
- [x] Extras toggle is visible for APM, PM, Boss, Owner, and Admin so Change Orders/Suppliers are reachable.
- [x] Extras feature flag no longer overrides role visibility for hidden optional tabs.
- [ ] Browser QA each role using real Firebase users.

Result: PASS STATIC / PENDING REAL ROLE USERS

## Firebase Rules

- [x] `users/{uid}/role` validation accepts RC1 roles plus future documented roles to avoid destructive migration.
- [x] Admin checks include `boss`, `owner`, and `admin`.
- [x] Assigned project broad writes are limited to `pm` and `apm`.
- [x] Site Log paths allow only Boss/Owner/Admin/PM/APM in RC1.
- [x] Project notification event hooks allow only Boss/Owner/Admin/PM/APM in RC1.
- [ ] Deploy rules to Firebase.
- [ ] Test with Firebase emulator or real QA users.

Result: PASS STATIC / PENDING DEPLOYED RULE QA

## Sensitive Module Restrictions

- [x] Foreman/Safety/Viewer are disabled from active workspace/project access.
- [x] Direct Firebase project reads for Foreman/Safety/Viewer are not granted by RC1 rules.
- [x] Direct Firebase project writes for Foreman/Safety/Viewer are not granted by RC1 rules.
- [ ] Confirm deployed rules deny field/viewer project reads and writes with real QA accounts.

Result: PASS STATIC / PENDING DEPLOYED ROLE QA

## Field Role Deferral Gate

Previous unsafe rule:

```text
projects/{projectId}.read = admin OR assigned project member OR bossOf
```

Impact:

- Foreman/Safety/Viewer UI hides financial tabs.
- Direct Firebase reads can still access the full assigned project object, including financial child paths.
- Firebase Realtime Database child rules cannot revoke access once parent `.read` grants it.

RC1 decision:

- Full project read is limited to Boss/Owner/Admin/PM/APM.
- Foreman/Safety/Viewer are documented future roles only.
- Boss/Admin/PM/APM management workflow keeps full project snapshots.
- Browser QA with real role accounts after rules deployment remains pending.

Future roadmap:

- Design child-level Firebase read model for field-user access.
- Activate Foreman/Safety/Viewer only after direct-read QA proves sensitive data is isolated.

## Static QA Results

- [x] `node --check auth.js`
- [x] `node --check report.js`
- [x] `node --check notifications.js`
- [x] `node --check sitelog.js`
- [x] Firebase rules JSON parse
- [x] Browser smoke test after cache v62:
  - dashboard route loaded as Boss without console warnings/errors
  - workspace route preserved `projectId` after refresh
  - signed-in `login.html` redirected to `dashboard.html`
- [x] Local HTTP smoke after cache v73 confirmed updated app shell files serve.
- [x] Browser role smoke after cache v73:
  - signed-in Boss dashboard reached `auth-ready`
  - `auth.js?v=73` and `main.js?v=73` loaded
  - Site Log and Extras visibility are limited to `apm,pm,boss,owner,admin`
  - console warnings/errors: none

## Known Limitations

- No dedicated role-switching QA account set is present in the repo.
- Field users are intentionally not active in RC1.
- Firebase rules should be deployed before judging live audit-log/permission warnings.
- Direct-database denial for field/viewer roles still needs deployed-rule QA with real role accounts.
- Browser role-switch QA for PM/APM/Admin accounts is still pending after cache v73.
- Child-level Firebase read refactor is future roadmap before field-user activation.

## Stability Gate

Roles v1 can be marked STABLE when:

- [ ] Real users for Boss/Owner/Admin/PM/APM can login/refresh/logout correctly.
- [ ] Boss/Owner/Admin/PM/APM see only intended tabs/modules.
- [ ] Foreman/Safety/Viewer cannot enter dashboard/workspace as active users.
- [ ] Foreman/Safety/Viewer direct Firebase reads/writes to project paths are denied in deployed rules.
- [ ] Firebase rules are deployed and verified.
