# QA Account Onboarding

Status: STABLE for RC1 account onboarding after focused live Firebase QA on cache `acpm-v123`.

## Root Cause Found

Signup previously wrote pending users to `users/{uid}` only. Admin Requests was wired to project lifecycle requests, not account access requests, and Firebase rules had no canonical `accessRequests/{uid}` path. Result: a user could exist in Firebase Auth and see Request Pending, while Admin > Requests had no pending signup row.

Live QA also found two production race/stability issues:

- Firebase Auth fired `onAuthStateChanged` immediately after account creation, before `accessRequests/{uid}` finished writing. This could replace the signup form with a misleading Request Pending screen during the request transaction.
- Boss/Admin cross-project listeners could survive sign-out and be evaluated under the next PM/APM session. Auth sign-out now detaches report/admin/notification listeners before the next profile applies.

## QA Checklist

- PASS: signup code now writes `accessRequests/{uid}` with uid, email, fullName, position, requestedAt, status, and provider.
- PASS: signup does not show success unless access request write succeeds.
- PASS: email request recovery attempts to write `accessRequests/{uid}` if Auth account already exists.
- PASS: orphan Auth accounts with no `users/{uid}` and no `accessRequests/{uid}` can submit a missing request from the Request Pending screen.
- PASS: Admin > Requests has a separate Access Requests lane.
- PASS: approval writes `users/{uid}` with role, assigned projects, active status, approval metadata, and `profileComplete: false`.
- PASS: rejection preserves `accessRequests/{uid}` and writes rejected metadata.
- PASS: Team Admin filters out `status: pending` users and reads approved users from `users/{uid}`.
- PASS: first approved login prompts My Profile setup when `profileComplete` is false.
- PASS: profile edits write only safe self-profile fields.
- PASS: suspended, disabled, and archived profiles are blocked at login, including admin roles.
- PASS: Team Admin supports suspend, reactivate, and archive without deleting the user profile.
- PASS: Team Admin hides raw UIDs from normal request/project assignment scanning.
- PASS: Dashboard and notification listeners support rules-compatible project maps and legacy assignment arrays.
- PASS: database rules JSON parses.
- PASS: JavaScript syntax checks pass for `auth.js` and `report.js`.
- PASS: Firebase Realtime Database rules were published; Boss can read `/accessRequests`.
- WARNING: Existing orphan Auth accounts created before the rules publish must use Send Missing Request once.
- PASS: profile photos upload to Google Drive (full-access link) with a compressed inline avatar fallback; initials fallback remains available when no photo is selected.

## Manual Browser QA Required After Rules Publish

1. Create a new test account with Request Access.
2. Confirm `accessRequests/{uid}` exists in Firebase.
3. Sign in as Boss/Admin.
4. Open Admin > Requests and approve the test account with role/project.
5. Confirm `users/{uid}` exists and request status is `approved`.
6. Confirm user appears in Team Admin.
7. Log in as the approved user.
8. Confirm My Profile modal appears.
9. Save display name, position, mobile, optional photo, and optional signature.
10. Refresh, logout, and login again; confirm profile persists and role/project fields are not editable by the user.
11. Reject a second test request and confirm it remains historical.

## Focused Live Firebase QA - 2026-07-13

Command:

```text
node scripts/account_onboarding_live_qa.js
```

Result: `PASS`

- PASS: Request Access created a real Firebase Auth account and `accessRequests/{uid}` pending record.
- PASS: Boss/Admin Requests displayed the pending signup and approved it with APM role plus assigned project.
- PASS: Approval wrote `users/{uid}` with `status: active`, `profileComplete: false`, role, project map, approval metadata, audit record, global notification event, and direct user notification.
- PASS: First approved login displayed My Profile setup.
- PASS: Profile fields saved and persisted after refresh/sign-out/sign-in.
- PASS: profile photo saved and persisted to Google Drive (or compressed inline avatar if the Drive endpoint is unreachable).
- PASS: user self-write attempts for role, projects, and status were denied by Firebase rules.
- PASS: Team Admin suspend, reactivate, and archive status workflow updated history without hard delete.
- PASS: suspended and archived users were blocked at login with clear status messages.
- PASS: QA user final state was `archived`; historical request/user records were preserved.

Evidence:

```text
result: PASS
profilePhotoSaved: true
profilePhotoUploadedToStorage: false
profilePhotoWarning: Profile photo was saved inline because Google Drive upload was unavailable.
selfRoleWriteDenied: true
selfProjectWriteDenied: true
selfStatusWriteDenied: true
qaUserFinalStatus: archived
```

## UI Polish Smoke - 2026-07-13

Command:

```text
node scripts/onboarding_ui_polish_smoke.js
```

Result: `PASS`

- PASS: mobile Signup/Login card fits the viewport after responsive overlay spacing cleanup.
- PASS: mobile Request Pending screen fits the viewport and has no horizontal overflow.
- PASS: Notifications dropdown fits the desktop viewport, has a clear title, and shows no mojibake.
- PASS: Team Admin rendered users with avatar/initials and status-action stacks.
- PASS: Team Admin mode hid project module tabs such as Labor, Materials, Billing, Site Log, Extras, and PMOS.
- PASS: My Profile modal rendered inside the viewport and explains that role/project assignment fields are admin-only.
- PASS: no severe console issues; Playwright service-worker warnings were expected in the test environment.

## Live Browser Smoke - 2026-07-11

- PASS: Hosted `https://acpm-project-system.web.app` serves the current versioned shell.
- PASS: Boss login reached `auth-ready`.
- PASS: Team Admin rendered 7 live users, 7 avatars, and 7 status-action groups.
- PASS: Team Admin role options were limited to `boss`, `admin`, `pm`, and `apm`.
- PASS: Team Admin mode showed only Admin and Reports tabs; project modules such as Labor/Materials were hidden.
- PASS: Requests tab opened and showed `0` pending requests without exposing raw UID labels.
- PASS: project assignment helpers support both `projects/{projectId}: true` maps and legacy arrays.
- PASS: notification project listeners support map-shaped project assignments.
- PASS: notification panel exposed Mark read and Clear read controls.
- PASS: Hub button returned to the project dashboard, not System Reports.

## Known Limitations

- Browser UI cannot delete Firebase Auth accounts. Suspended/archived user state is preferred over hard delete.
- RC1 supports one primary role per user. Multi-role permissions are future work.
- Profile photos are stored in Google Drive (shareable `avatarUrl`) via the Apps Script transport, falling back to a compressed inline avatar in `users/{uid}/avatarUrl` when the Drive endpoint is unreachable. This keeps avatars small and full-access without any Firebase Storage dependency.
- Firebase Auth account deletion remains a console/admin task; ACPM only controls app-level access in `users/{uid}`.
