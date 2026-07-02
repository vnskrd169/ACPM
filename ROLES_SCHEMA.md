# ACPM Roles and Permissions v1

Status: RC1 MANAGEMENT ROLES LOCKED - STATIC ROLE/UI/RULE MATRIX AND LIVE FIREBASE GATE PASSED; FIELD ROLES DEFERRED

ACPM preserves legacy `boss` and `apm` roles while locking RC1 access to management users only.

## RC1 Active Roles

| Role | Canonical Value | Purpose |
| --- | --- | --- |
| Boss / Owner | `boss` or `owner` | Full company/admin access, financials, settings, team, audit logs. |
| Admin | `admin` | Full admin access except identity ownership decisions remain business controlled. |
| Project Manager | `pm` | Assigned project management with financial/report visibility. |
| Assoc. Project Manager | `apm` | Assigned project operations without full profit/collection visibility by default. |

## Future Roles - Disabled For RC1

These role names remain documented for roadmap planning, but they are not active in RC1, are not available in Team Admin role assignment, and must not access workspace/project data:

| Future Role | Canonical Value | Planned Purpose |
| --- | --- | --- |
| Foreman | `foreman` | Field site log access after secure child-level reads are implemented. |
| Safety | `safety` | Field safety/site log access after secure child-level reads are implemented. |
| Viewer | `viewer` | Read-only project view after secure child-level reads are implemented. |

## Compatibility

Existing records continue working:

```text
boss -> admin capability
apm -> assigned project operations
```

No destructive migration is required.

## App Helpers

Implemented in `auth.js`:

- `normalizeRole(role)`
- `isBoss(role)`
- `canSeeFinancials(role)`
- `canEditAssignedProject(role)`
- `isRc1ActiveRole(role)`
- `isFieldRole(role)`
- `isViewerRole(role)`
- `canWriteFieldLog(projectId)`
- `roleLabel(role)`

RC1 active access requires an explicit active role value. Unknown, blank, Foreman, Safety, and Viewer values are not treated as APM by the RC1 access gate.

## UI Visibility

Workspace tab visibility:

- Labor: `boss`, `owner`, `admin`, `pm`, `apm`
- Materials: `boss`, `owner`, `admin`, `pm`, `apm`
- Billing: financial roles only
- Site Log: `boss`, `owner`, `admin`, `pm`, `apm`
- Change Orders: management/APM roles
- Suppliers: management/APM roles
- Extras toggle: management/APM roles so Change Orders and Suppliers are reachable
- Reports: financial roles only
- Admin/Team/Audit: admin roles only

## Firebase Rules

Rules validate only RC1 active role assignments:

```text
boss owner admin pm apm
```

Admin-rule checks accept:

```text
boss owner admin
```

Project write fallback is limited to assigned `pm` and `apm`.
Foreman/Safety/Viewer have no active project read/write access in RC1.

## RC1 Firebase Access

Project reads/writes are limited to:

```text
boss owner admin pm apm
```

Foreman/Safety/Viewer are blocked by app helpers and do not receive project data access in RC1.

## Future Roadmap

Before activating field-user roles, implement and QA a secure child-level Firebase read model for:

- project shell metadata
- Site Logs
- field-safe attachments/photos
- field-safe notifications
- no billing/collections/profit/budget access

Roadmap item: build a child-level Firebase read refactor before enabling Foreman/Safety/Viewer. The future model must avoid parent project `.read` grants and expose only field-safe child paths.

## QA Evidence

- `scripts/roles_rc1_matrix_qa.js` verifies the active role matrix, deferred-role deny behavior, financial visibility, assigned-project capabilities, and role-based UI helper behavior.
- Result on 2026-07-01: PASS.
- Service worker cache bumped to `acpm-v86`; app shell now loads `auth.js?v=85`.
- RC1 role matrix rerun after cache `acpm-v89`: PASS.
- RC1 role/UI/rules matrix rerun after cache `acpm-v96`: PASS. This now scans actual `workspace.html`, `dashboard.html`, and `index.html` role visibility attributes, Team Admin role options, and Firebase role match expressions.
- Browser Boss smoke after cache `acpm-v89`: dashboard and workspace reached `role-boss auth-ready`, workspace preserved `projectId`, and no JavaScript console errors were observed.
- Browser Boss smoke after cache `acpm-v92`: Admin Requests and Audit tabs remain clickable on read-only/completed project workspaces.
- Browser Boss role smoke after cache `acpm-v96`: dashboard reached `role-boss auth-ready`, no field-role visibility leaks were found, Team Admin role dropdowns exposed only Boss/Admin/PM/APM, and console errors were empty.
- `scripts/roles_live_account_qa.js` added after cache `acpm-v96` for read-only live account verification. It signs in supplied QA accounts, verifies profile/project access for Boss/Admin/PM/APM, verifies deployed-rule denial for Foreman/Safety/Viewer, and performs no Firebase writes.
- Boss live role-account QA after cache `acpm-v96`: PASS. The read-only gate confirmed self-profile read and admin-capable project-root read against live Firebase.
- `scripts/roles_live_inventory_qa.js` added after cache `acpm-v97` for read-only live role inventory. It signs in with a Boss/Admin credential, reads `users`, redacts identifiers, counts roles, and performs no Firebase writes.
- Live role inventory on 2026-07-02: PASS_READ_ONLY_INVENTORY. Current profiles contain `boss` = 2 and `apm` = 2; no `admin`, `pm`, `foreman`, `safety`, or `viewer` profiles exist in the live `users` path.
- Live Boss Team Admin browser smoke after cache `acpm-v97`: PASS. The UI rendered 4 live management profiles, including 2 APM profiles, role dropdowns exposed only Boss/Admin/PM/APM, Foreman/Safety/Viewer options were absent, and console errors were empty.

## Known Limitations

- Firebase rules are improved but still need full emulator/deployed-rule QA.
- Field-user roles are deferred for RC1.
- PM financial visibility is enabled because PM is a management role in the RC1 directive.
- Existing data may still store `boss`; this remains valid and is intentionally preserved.
- Existing historical user records with future role names are not deleted, but new/updated RC1 role assignments must use Boss/Admin/PM/APM values.
- Full RC1 management account proof still needs dedicated Admin/PM/APM credentials. Boss account coverage passed through the reusable read-only gate, but no new Auth users were created.
- Live inventory proves the current Realtime Database has Boss/APM profiles only. Admin/PM and deferred-role account QA remains unavailable until those users are created and credentials are supplied.
- Field-role deny account QA is a future activation gate because Foreman/Safety/Viewer are not active in RC1 and the latest live inventory found no deferred-role profiles.
- Child-level Firebase read refactor is a future roadmap item before Foreman/Safety/Viewer activation.
