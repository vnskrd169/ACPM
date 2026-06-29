# ACPM Roles and Permissions v1 QA Checklist

Status: DATA FOUNDATION IMPLEMENTED - MANUAL FIREBASE QA PENDING

## Role Normalization

- [x] Legacy `boss` remains admin-capable.
- [x] Legacy `apm` remains assigned-project operational role.
- [x] New values accepted in app helpers:
  - `owner`
  - `admin`
  - `pm`
  - `foreman`
  - `safety`
  - `viewer`
- [x] Role labels render through `roleLabel()`.

Result: PASS STATIC

## UI Visibility

- [x] Billing and Reports use financial-role visibility.
- [x] Foreman/Safety can see Site Log tab.
- [x] Viewer can see Site Log tab as the read-only landing area.
- [x] Foreman/Safety do not see Billing/Reports/Admin tabs.
- [x] Viewer has no edit capability through `canEditProject()`.
- [ ] Browser QA each role using real Firebase users.

Result: PASS STATIC / PENDING REAL ROLE USERS

## Firebase Rules

- [x] `users/{uid}/role` validation accepts RC1 role set.
- [x] Admin checks include `boss`, `owner`, and `admin`.
- [x] Assigned project broad writes are limited to `pm` and `apm`.
- [x] Site Log paths explicitly allow assigned `foreman` and `safety`.
- [x] Project notification event hooks allow assigned field users for Site Log events.
- [ ] Deploy rules to Firebase.
- [ ] Test with Firebase emulator or real QA users.

Result: PASS STATIC / PENDING DEPLOYED RULE QA

## Sensitive Module Restrictions

- [x] Foreman/Safety hidden from profit, billing, collections, reports, team, and admin tabs.
- [x] Viewer is read-only in app helpers and routes to Site Log instead of a hidden module.
- [ ] Confirm direct Firebase writes to Billing/Collections are denied for field/viewer accounts.

Result: WARNING - app-level visibility implemented; deployed rules QA pending

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

## Known Limitations

- No dedicated role-switching QA account set is present in the repo.
- Field users currently land on Site Log, not a custom Foreman/Safety dashboard.
- Firebase rules should be deployed before judging live audit-log/permission warnings.
- Direct-database read restriction for field/viewer roles still needs deployed-rule QA with real role accounts.

## Stability Gate

Roles v1 can be marked STABLE when:

- [ ] Real users for each role can login/refresh/logout correctly.
- [ ] Each role sees only intended tabs/modules.
- [ ] Field roles can create Site Logs but cannot write financial modules.
- [ ] Viewer can read assigned projects but cannot write.
- [ ] Firebase rules are deployed and verified.
