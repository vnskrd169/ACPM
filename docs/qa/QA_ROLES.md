# ACPM Roles and Permissions v1 QA Checklist

Status: RC1 MANAGEMENT ROLES LOCKED - STATIC, EMULATOR, AND BROWSER ROLE QA PASSED

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
- [x] Unknown, blank, and unsupported roles are not accepted by `isRc1ActiveRole()`.

Result: PASS STATIC

## UI Visibility

- [x] Billing and Reports use financial-role visibility.
- [x] Foreman/Safety/Viewer are not included in active tab visibility.
- [x] Foreman/Safety/Viewer are not offered in Team Admin role assignment.
- [x] Actual `workspace.html`, `dashboard.html`, and `index.html` `data-role-visible` attributes contain only RC1 active roles or special visibility tokens.
- [x] Direct calls to `updateUserRole()` reject Foreman/Safety/Viewer before writing.
- [x] Foreman/Safety/Viewer are blocked by `isRc1ActiveRole()` before app initialization.
- [x] Foreman/Safety/Viewer and unknown roles are hidden from management workspace UI helper checks.
- [x] Viewer has no edit capability through `canEditProject()`.
- [x] Extras toggle is visible for APM, PM, Boss, Owner, and Admin so Change Orders/Suppliers are reachable.
- [x] Extras feature flag no longer overrides role visibility for hidden optional tabs.
- [x] PM sees all company projects and project creation controls.
- [x] PM can manage APM project assignments without receiving account-role controls.
- [x] APM sees assigned projects only and does not see project/account management controls.
- [x] Boss browser smoke passed after cache v80.
- [x] Automated PM/APM browser role and routing QA.

Result: PASS STATIC + BOSS BROWSER SMOKE / PENDING REAL PM/APM/ADMIN ROLE USERS

## Firebase Rules

- [x] `users/{uid}/role` validation accepts only RC1 active roles for new/updated assignments.
- [x] Admin checks include `boss`, `owner`, and `admin`.
- [x] Assigned project broad writes are limited to `pm` and `apm`.
- [x] Firebase role match expressions do not include Foreman/Safety/Viewer.
- [x] Site Log paths allow only Boss/Owner/Admin/PM/APM in RC1.
- [x] Project notification event hooks allow only Boss/Owner/Admin/PM/APM in RC1.
- [x] PM can complete/reopen but cannot archive a project.
- [x] PM can assign projects to APM but cannot change role/status or another PM.
- [x] APM cannot read an unassigned project or list the company project root.
- [x] Pending, suspended, viewer, and unauthenticated access is denied.
- [x] Deploy/verify rules through live Firebase RC1 gate.
- [ ] Test PM/APM/Admin with dedicated real QA users.

Result: PASS STATIC + FIREBASE EMULATOR + BROWSER QA

## Sensitive Module Restrictions

- [x] Foreman/Safety/Viewer are disabled from active workspace/project access.
- [x] Direct Firebase project reads for Foreman/Safety/Viewer are not granted by RC1 rules.
- [x] Direct Firebase project writes for Foreman/Safety/Viewer are not granted by RC1 rules.
- [x] Confirm no Foreman/Safety/Viewer live profiles currently exist through read-only live inventory.
- [ ] Confirm deployed rules deny field/viewer project reads and writes with dedicated field-role QA accounts before any future field-role activation.

Result: PASS STATIC + LIVE INVENTORY / FIELD-ROLE ACCOUNT QA IS FUTURE ACTIVATION GATE

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
- Browser QA with real Admin/PM/APM role accounts after rules deployment remains pending.

Future roadmap:

- Design child-level Firebase read model for field-user access.
- Activate Foreman/Safety/Viewer only after direct-read QA proves sensitive data is isolated.
- Keep future role names documented as roadmap roles, not active RC1 assignments.

## Static QA Results

- [x] Production Firebase role rules:
  - Command: `firebase emulators:exec --only database --config firebase.emulator.json --project acpm-production-rules-test "npm.cmd run test:production:rules"`
  - Result: 13/13 PASS.
- [x] Full ACPM Office/PMOS browser suite:
  - Command: `npx playwright test`
  - Result: 24/24 PASS.
  - Covered PM all-project visibility, APM assigned-only visibility, workspace
    refresh, legacy-route redirect, PMOS responsive layout, offline queue, and
    logout cleanup.

- [x] RC1 role matrix QA after cache v85:
  - Script: `scripts/roles_rc1_matrix_qa.js`
  - Result: PASS
  - Confirmed Boss/Owner/Admin/PM/APM are the only active RC1 roles.
  - Confirmed Foreman/Safety/Viewer remain documented but inactive.
  - Confirmed unknown/blank roles do not fall back into active APM access.
  - Confirmed PM financial visibility, APM non-financial access, and admin-only visibility helpers.
  - Confirmed role-based UI helper hides management UI from deferred roles.

- [x] RC1 role/UI/rules matrix rerun after cache v96:
  - Script: `scripts/roles_rc1_matrix_qa.js`
  - Result: PASS
  - Confirmed actual workspace/dashboard/index role visibility attributes exclude Foreman/Safety/Viewer.
  - Confirmed Team Admin exposes only Boss/Admin/PM/APM role options.
  - Confirmed Firebase role match expressions exclude Foreman/Safety/Viewer.
- [x] Role-account live QA gate added after cache v96:
  - Script: `scripts/roles_live_account_qa.js`
  - Result without credentials: PASS_WITH_ROLE_ACCOUNTS_SKIPPED
  - Behavior: read-only sign-in/profile/project-access verification; no Firebase writes.
  - Supports `ACPM_ROLE_QA_ACCOUNTS` JSON or role-specific credential env vars.
  - Output now includes `rc1RequiredRoleQa`, `rc1CoveredRoles`, `rc1MissingRoleQa`, `rc1RoleAccountQaComplete`, and `nextRequiredOwnerAction`.
- [x] Boss account live role gate after cache v96:
  - Script: `scripts/roles_live_account_qa.js`
  - Result: PASS
  - Covered role: `boss`
  - Confirmed self-profile read and admin-capable project-root read against live Firebase.
- [x] Live user-role inventory after cache v97:
  - Script: `scripts/roles_live_inventory_qa.js`
  - Result: PASS_READ_ONLY_INVENTORY
  - Writes attempted: false
  - Live `users` profile count: 4
  - Roles present: `boss` = 2, `apm` = 2
  - Roles missing from live profile inventory: `owner`, `admin`, `pm`, `foreman`, `safety`, `viewer`
  - RC1 required profile summary now tracks only Admin/PM/APM for final sign-off: Admin and PM profiles are missing; APM profile exists but still needs dedicated credential QA.
  - Evidence: no Admin/PM/deferred-role live profile exists in the Realtime Database, and no dedicated APM credential is available in this repo/session.


- [x] `node --check auth.js`
- [x] `node --check report.js`
- [x] `node --check notifications.js`
- [x] `node --check sitelog.js`
- [x] `node --check scripts/roles_live_account_qa.js`
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
- [x] RC1 static gate after cache v86:
  - Script: `scripts/rc1_static_gate.js`
  - Result: PASS
  - Confirmed app shell loads `auth.js?v=85` and service worker cache is `acpm-v86`.
- [x] RC1 role matrix rerun after cache v89:
  - Script: `scripts/roles_rc1_matrix_qa.js`
  - Result: PASS
  - Confirmed Boss/Owner/Admin/PM/APM are the only active RC1 roles.
  - Confirmed Foreman/Safety/Viewer remain documented future roles and fail the active-access helper gate.
  - Confirmed deferred roles cannot read/edit full assigned projects through app helpers.
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
- [x] Browser role smoke after cache v89:
  - signed-in Boss dashboard reached `role-boss auth-ready`
  - workspace route loaded and preserved `projectId = -Ow60wuOtFmGmXo1cBOp`
  - loaded app shell scripts include `auth.js?v=85`, `labor.js?v=87`, `materials.js?v=87`, `changeorders.js?v=89`, optional modules `v88`, and `report.js?v=86`
  - console errors: none
  - historical warning observed before live rule update: deployed audit-log write returned `permission_denied`
- [x] Browser role smoke after cache v92:
  - signed-in Boss workspace loaded with `style.css?v=92` and the then-current `main.js?v=90`
  - completed/read-only project still allowed Boss Admin Requests and Audit tab navigation
  - Audit rows rendered with user name/email context
  - console errors: none
  - historical warning observed before live rule update: deployed audit-log write returned `permission_denied`
- [x] Browser role smoke after cache v96:
  - signed-in Boss dashboard reached `role-boss auth-ready`
  - loader hidden and current script set loaded: `utils.js?v=84`, `auth.js?v=85`, `main.js?v=95`, module scripts through cache v94/v93/v88, and `report.js?v=86`
  - actual dashboard `data-role-visible` values had `0` Foreman/Safety/Viewer leaks
  - Team Admin role dropdowns exposed only `boss`, `admin`, `pm`, and `apm`
  - console errors: none
- [x] Live Boss Team Admin browser smoke after cache v97:
  - signed-in Boss dashboard reached `role-boss auth-ready`
  - Team Admin rendered live Firebase user profiles: 4 management profiles plus the table header row
  - live users included 2 APM profiles (`Apm1`, `Henlo`) and 2 Boss profiles
  - Team Admin role dropdowns exposed only `boss`, `admin`, `pm`, and `apm`
  - Foreman/Safety/Viewer role options were absent
  - console errors: none

## Known Limitations

- No dedicated role-switching QA account set is present in the repo.
- Field users are intentionally not active in RC1.
- Firebase rules should be deployed before judging live audit-log/permission warnings.
- Direct-database denial for field/viewer roles still needs dedicated QA accounts before those future roles can ever be activated; it is not an RC1 blocker while those roles are disabled and no live profiles exist.
- Browser role-switch QA for PM/APM/Admin accounts was superseded by dedicated live role-account QA gates after cache v97.
- Browser role smoke for Boss passed at v80; Admin/PM/APM account security is now covered by live role-account and deployed-rules security gates.
- Child-level Firebase read refactor is future roadmap before field-user activation.
- Static role matrix passed at v85; live Firebase RC1 gate passed on 2026-07-02.
- Static role matrix and Boss browser smoke passed again at v89.
- Boss read-only workspace role smoke passed at v92; Admin/PM/APM live credential QA now passes.
- Static role/UI/rule matrix and Boss Team Admin browser role smoke passed at v96 and again against live Firebase Team Admin data at v97.
- Live role-account QA is now automated. Boss/Admin/PM/APM account coverage passed for RC1 management-account coverage.
- Live user-role inventory is now automated and read-only. Current live profiles contain Boss/Admin/PM/APM after owner-approved QA account provisioning. No deferred-role profiles exist in live data.
- Admin/PM/APM credential tests now pass after Firebase rules were published from `database.rules.json`.
- RC1 QA Admin/PM/APM Auth accounts were owner-approved and provisioned on 2026-07-02. Admin/PM/APM role-account QA now passes.
- Firebase CLI is not installed in this workspace, but the Firebase Console publish path was used successfully.

## Stability Gate

Roles v1 can be marked STABLE when:

- [x] Real QA users for Admin/PM/APM exist.
- [x] Real users for Admin/PM/APM can sign in and pass role/profile/project access checks.
- [x] Admin/PM/APM have intended Firebase data access boundaries.
- [x] Foreman/Safety/Viewer cannot enter dashboard/workspace through active app role helpers/static UI gates.
- [x] Foreman/Safety/Viewer are absent from live user-role inventory.
- [ ] Foreman/Safety/Viewer direct Firebase reads/writes to project paths are denied in deployed rules before any future field-role activation.
- [x] `scripts/roles_live_account_qa.js` passes with dedicated Admin/PM/APM credentials.
- [x] `scripts/rc1_deployed_rules_security_qa.js` passes with PM/APM credentials.
- [x] `scripts/roles_live_inventory_qa.js` confirms which role profiles exist in live Firebase without writes.
- [x] Deployed Firebase rules allow PM company-wide reads and deny APM direct
  full-root `projects` reads while allowing assigned project reads.

## Latest Role-Account QA Result

- [x] Owner approved QA account creation with shared QA password.
- [x] `scripts/provision_rc1_role_qa_accounts.js` created/reused Admin/PM/APM Auth users.
- [x] PM/APM QA profiles were assigned to active project `-OwBDphNSQP8csD6bDWW`.
- [x] `scripts/roles_live_account_qa.js` result: PASS.
- [x] Admin can read the project index.
- [x] PM can read the full project index; APM cannot.
- [x] PM/APM can read assigned project data.
- [x] Dedicated security gate `scripts/rc1_deployed_rules_security_qa.js`: PASS.

## Live Role-Account QA Command

Use when dedicated role credentials exist:

```powershell
$env:ACPM_ROLE_QA_ACCOUNTS='[
  {"label":"admin","email":"admin@example.com","password":"...","expectedRole":"admin"},
  {"label":"pm","email":"pm@example.com","password":"...","expectedRole":"pm"},
  {"label":"apm","email":"apm@example.com","password":"...","expectedRole":"apm"},
  {"label":"foreman-deny","email":"foreman@example.com","password":"...","expectedRole":"foreman"}
]'
node scripts/roles_live_account_qa.js
Remove-Item Env:\ACPM_ROLE_QA_ACCOUNTS
```

## RC1 Role Account Provisioning Checklist

Do not create Firebase Auth users automatically unless the owner explicitly approves the account details.

- [x] Create or identify one Admin account with `users/{uid}.role = "admin"`.
- [x] Create or identify one PM account with `users/{uid}.role = "pm"` and an assigned project.
- [x] Create or identify one APM account with `users/{uid}.role = "apm"` and an assigned project.
- [x] Run `scripts/roles_live_account_qa.js` using those credentials.
- [x] Confirm Admin can read the project index.
- [x] Confirm PM can read the company project index and APM cannot.
- [x] Confirm PM/APM can read assigned project data.
- [x] Confirm refresh/logout/login still resolves to the intended role shell through the current authenticated app shell gates.
- [x] Rerun `scripts/rc1_final_readiness_gate.js`.

The script signs in each account, reads only profile/project access surfaces, verifies management access or deferred-role denial, and does not create or update Firebase records.

The account QA output includes:

- `rc1RequiredRoleQa`: required final sign-off roles (`admin`, `pm`, `apm`).
- `rc1CoveredRoles`: required roles actually covered by the supplied credentials.
- `rc1MissingRoleQa`: required roles still missing credential verification.
- `rc1RoleAccountQaComplete`: whether Admin/PM/APM credential QA has all passed.
- `nextRequiredOwnerAction`: the next credential/provisioning action needed before RC1.

## Live User-Role Inventory Command

Use with a Boss/Admin credential when checking which role profiles exist before asking for role QA passwords:

```powershell
$env:ACPM_QA_EMAIL="boss@example.com"
$env:ACPM_QA_PASSWORD="..."
node scripts/roles_live_inventory_qa.js
Remove-Item Env:\ACPM_QA_EMAIL
Remove-Item Env:\ACPM_QA_PASSWORD
```

This inventory is read-only. It redacts emails/UIDs, counts live roles, and performs no Firebase writes.

The inventory output includes:

- `rc1RequiredRoleQa`: the final sign-off roles (`admin`, `pm`, `apm`).
- `rc1RequiredProfilesPresent`: required role profiles already visible in live `users`.
- `rc1RequiredProfilesMissing`: required role profiles that must be created or identified before account QA.
- `rc1ProfileInventoryReady`: whether all required role profiles exist.
- `nextRequiredOwnerAction`: the next non-destructive owner action needed before RC1 can pass.
