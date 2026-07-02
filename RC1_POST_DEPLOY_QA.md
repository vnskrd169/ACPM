# ACPM RC1 Post-Deploy QA Runbook

Status: LIVE FIREBASE GATE PASSED ON 2026-07-02

Purpose: verify that the live Firebase Realtime Database rules are compatible with the local RC1 app and that any deployed-rule warnings have a safe fallback path.

Latest result:

```text
RUN_REAL_QA=1 node scripts/rc1_post_deploy_gate.js
PASS
```

## Do Not Skip

RC1 is not final until this runbook passes against the live Firebase backend.

Publish rules first:

```powershell
firebase use acpm-project-system
firebase deploy --only database
```

Console alternative:

1. Firebase Console > Realtime Database > Rules.
2. Paste the full contents of `database.rules.json`.
3. Publish.

## Local Gate

This does not create Firebase records:

```powershell
node scripts/rc1_post_deploy_gate.js
```

Expected result:

```text
PASS_WITH_REAL_QA_SKIPPED
```

The local gate is read-only for repository configuration. It verifies `firebase.json`, `.firebaserc`, and `database.rules.json` instead of creating or modifying them.

## Final Readiness Gate

After local and live Firebase gates pass, run:

```powershell
node scripts/rc1_final_readiness_gate.js
```

Expected current result:

```text
PASS_RC1_READY
```

Expected final RC1 result after dedicated Admin/PM/APM QA credentials are verified:

```text
PASS_RC1_READY
```

For a strict release job, set:

```powershell
$env:ACPM_REQUIRE_RC1_FINAL="1"
node scripts/rc1_final_readiness_gate.js
Remove-Item Env:\ACPM_REQUIRE_RC1_FINAL
```

## Real Firebase Gate

This creates archived QA records. Use only with the approved QA/Boss account.

```powershell
$env:ACPM_QA_EMAIL="your-qa-email"
$env:ACPM_QA_PASSWORD="your-qa-password"
$env:RUN_REAL_QA="1"
node scripts/rc1_post_deploy_gate.js
Remove-Item Env:\ACPM_QA_EMAIL
Remove-Item Env:\ACPM_QA_PASSWORD
Remove-Item Env:\RUN_REAL_QA
```

Expected result:

```text
PASS
```

## Must Pass

- `scripts/firebase_rules_gate.js`
- `scripts/roles_rc1_matrix_qa.js`
- `scripts/roles_live_account_qa.js`
- `scripts/roles_live_inventory_qa.js`
- `scripts/rc1_deployed_rules_security_qa.js`
- `scripts/rc1_final_readiness_gate.js`
- `scripts/dashboard_static_qa.js`
- `scripts/changeorder_static_qa.js`
- `scripts/audit_notification_supplier_static_qa.js`
- `scripts/pwa_cache_static_qa.js`
- `scripts/reports_listener_static_qa.js`
- `scripts/rc1_docs_static_qa.js`
- `scripts/historical_integrity_static_qa.js`
- `scripts/suppliers_v1_real_qa.js`
- `scripts/audit_notifications_v1_real_qa.js`
- `scripts/labor_v1_cash_advance_real_qa.js`
- `scripts/reports_v1_real_qa.js`
- `scripts/sitelog_v1_real_qa.js`
- `scripts/changeorder_v1_real_qa.js`
- `scripts/billing_phase2_real_qa.js`

## Manual Browser Checks After Real Gate

- Sign in as Boss.
- Open Dashboard.
- Confirm dashboard finishes as an authenticated role view, not `auth-checking`.
- Open an active project workspace.
- Confirm dashboard project cards/actions open `workspace.html?projectId=...`.
- Open Reports and verify no browser console errors.
- Open Extras and verify Change Orders/Suppliers render.
- Open Team Admin and verify role options are only Boss/Admin/PM/APM.
- Confirm project fallback audit rows are written if global audit writes are denied by deployed rules.

## Optional Role-Account Gate

The post-deploy gate now runs `scripts/roles_live_account_qa.js`. With no role credentials it returns `PASS_WITH_ROLE_ACCOUNTS_SKIPPED`; with supplied credentials it signs in read-only and verifies account access.

The role-account gate reports `rc1CoveredRoles`, `rc1MissingRoleQa`, `rc1RoleAccountQaComplete`, and `nextRequiredOwnerAction`. The final readiness gate consumes those fields directly, so RC1 cannot pass until Admin, PM, and APM credential QA are all covered.

For RC1 final sign-off, provide or create dedicated QA accounts for these active roles:

- `Admin`
- `PM`
- `APM`

Do not create these users through automation unless the owner explicitly approves the account names, emails, passwords, and intended project assignments. The QA gate is intentionally read-only after sign-in and does not create, edit, or delete Firebase Auth users or project records.

Minimum profile requirements:

- Admin: `users/{uid}.role = "admin"`; may read project index.
- PM: `users/{uid}.role = "pm"`; has at least one assigned project when project-level access is being verified.
- APM: `users/{uid}.role = "apm"`; has at least one assigned project when project-level access is being verified.

Field roles remain future-only for RC1. Foreman/Safety/Viewer credentials are not required for RC1 because those roles are disabled and the live inventory currently has no deferred-role profiles. Before enabling them in a later release, create dedicated deny-test accounts and complete the child-level Firebase read refactor.

Supported credential formats:

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

No users or projects are created by this role-account gate.

## Live User-Role Inventory Gate

Before asking for passwords, run the read-only inventory with a Boss/Admin credential:

```powershell
$env:ACPM_QA_EMAIL="your-boss-or-admin-email"
$env:ACPM_QA_PASSWORD="your-boss-or-admin-password"
node scripts/roles_live_inventory_qa.js
Remove-Item Env:\ACPM_QA_EMAIL
Remove-Item Env:\ACPM_QA_PASSWORD
```

Latest inventory on 2026-07-02:

- Result: PASS_READ_ONLY_INVENTORY
- Writes attempted: false
- Live profiles after QA provisioning: `admin` = 1, `pm` = 1, `apm` = 3, `boss` = 2
- No live `foreman`, `safety`, or `viewer` profiles were present in `users`.
- RC1 profile inventory readiness: ready.
- Admin/PM/APM dedicated credential run through `scripts/roles_live_account_qa.js`: PASS.

The inventory script reports `rc1RequiredProfilesPresent`, `rc1RequiredProfilesMissing`, and `nextRequiredOwnerAction` so the final role blocker can be read directly from live Firebase without writing data.

## Latest Dedicated Role-Account QA

Owner-approved Admin/PM/APM QA accounts were provisioned with `scripts/provision_rc1_role_qa_accounts.js`.

Current result:

- `scripts/roles_live_account_qa.js`: PASS
- `scripts/rc1_deployed_rules_security_qa.js`: PASS
- PM/APM full-root `projects` read: denied.
- PM/APM assigned project read: allowed.
- PM assigned project count: 1
- Firebase CLI status in this workspace: unavailable (`firebase` command not found), but Firebase Console publish succeeded.

Final role/security sign-off:

- `scripts/roles_live_account_qa.js` passed with Admin/PM/APM credentials.
- `scripts/rc1_deployed_rules_security_qa.js` passed with PM/APM credentials.
- `rc1RoleAccountQaComplete = true`.

## Remaining RC1 Warnings If Real Gate Fails

- Supplier canonical global events/rollups may still be denied if rules were not published.
- Global audit rows may still be denied by deployed rules; project fallback audit rows must continue to write and render in Admin Audit Log.
- Field-role deny QA needs dedicated Foreman/Safety/Viewer test users before field access can ever be activated; it is a future activation gate, not an RC1 blocker, because the latest live inventory found no deferred-role profiles to test.
- Full browser Change Order reject modal click-through passed after cache v97 using live Firebase project `qa_mr342wcu_8satiur8`, which was archived after the test.
