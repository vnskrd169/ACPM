# ACPM Roles and Permissions v1 QA Checklist

Status: RC1 MANAGEMENT ROLES LOCKED - BOSS BROWSER SMOKE PASSED; FIELD-ROLE DEPLOYED DENY QA PENDING

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
- [x] Foreman/Safety/Viewer are not offered in Team Admin role assignment.
- [x] Direct calls to `updateUserRole()` reject Foreman/Safety/Viewer before writing.
- [x] Foreman/Safety/Viewer are blocked by `isRc1ActiveRole()` before app initialization.
- [x] Viewer has no edit capability through `canEditProject()`.
- [x] Extras toggle is visible for APM, PM, Boss, Owner, and Admin so Change Orders/Suppliers are reachable.
- [x] Extras feature flag no longer overrides role visibility for hidden optional tabs.
- [x] Boss browser smoke passed after cache v80.
- [ ] Browser QA PM/APM/Admin using real Firebase users.

Result: PASS STATIC + BOSS BROWSER SMOKE / PENDING REAL PM/APM/ADMIN ROLE USERS

## Firebase Rules

- [x] `users/{uid}/role` validation accepts only RC1 active roles for new/updated assignments.
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
- Team Admin does not expose Foreman/Safety/Viewer during RC1.
- Browser QA with real role accounts after rules deployment remains pending.

Future roadmap:

- Design child-level Firebase read model for field-user access.
- Activate Foreman/Safety/Viewer only after direct-read QA proves sensitive data is isolated.
- Keep future role names documented as roadmap roles, not active RC1 assignments.

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
- [x] Static role lock check after cache v76:
  - Team Admin no longer renders Foreman/Safety/Viewer role options.
  - `updateUserRole()` rejects non-RC1 active role values before writing.
  - Firebase `users/{uid}/role` validation accepts only `boss|owner|admin|pm|apm`.
  - Workspace/dashboard/index served `report.js?v=76`, `auth.js?v=73`, `main.js?v=73`, and `changeorders.js?v=75` from the ACPM workspace.
- [x] RC1 static gate after cache v81:
  - Script: `scripts/rc1_static_gate.js`
  - Result: PASS
  - Confirmed field roles are excluded from active Firebase access patterns.
  - Confirmed Team Admin active role options are Boss/Admin/PM/APM only.
  - Confirmed v81 cache/script references.
- [x] Local syntax/rules check after cache v76:
  - `node --check auth.js`
  - `node --check report.js`
  - `node --check main.js`
  - `node --check notifications.js`
  - `node --check sitelog.js`
  - `node --check billing.js`
  - `node --check changeorders.js`
  - `node --check scripts/changeorder_v1_real_qa.js`
  - `node --check scripts/billing_phase2_real_qa.js`
  - Firebase rules JSON parse
- [x] Browser role smoke after cache v80:
  - signed-in Boss dashboard reached `auth-ready`
  - workspace route loaded and preserved `projectId`
  - `labor.js?v=80`, `notifications.js?v=79`, and `report.js?v=78` loaded
  - Team Admin role selects exposed only `boss`, `admin`, `pm`, and `apm`
  - Foreman/Safety/Viewer text and values were absent from active role assignment controls
  - console errors: none
  - warning observed: deployed audit-log write still returns `permission_denied`; tracked in Audit v1 docs

## Known Limitations

- No dedicated role-switching QA account set is present in the repo.
- Field users are intentionally not active in RC1.
- Firebase rules should be deployed before judging live audit-log/permission warnings.
- Direct-database denial for field/viewer roles still needs deployed-rule QA with real role accounts.
- Browser role-switch QA for PM/APM/Admin accounts is still pending after cache v73.
- Browser role smoke for Boss passed at v80; PM/APM/Admin account-specific browser QA is still pending.
- Child-level Firebase read refactor is future roadmap before field-user activation.

## Stability Gate

Roles v1 can be marked STABLE when:

- [ ] Real users for Boss/Owner/Admin/PM/APM can login/refresh/logout correctly.
- [ ] Boss/Owner/Admin/PM/APM see only intended tabs/modules.
- [ ] Foreman/Safety/Viewer cannot enter dashboard/workspace as active users.
- [ ] Foreman/Safety/Viewer direct Firebase reads/writes to project paths are denied in deployed rules.
- [ ] Firebase rules are deployed and verified.
