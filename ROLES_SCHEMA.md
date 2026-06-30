# ACPM Roles and Permissions v1

Status: RC1 MANAGEMENT ROLES LOCKED - BOSS BROWSER SMOKE PASSED; FIELD-ROLE DEPLOYED DENY QA PENDING

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

## Known Limitations

- Firebase rules are improved but still need full emulator/deployed-rule QA.
- Field-user roles are deferred for RC1.
- PM financial visibility is enabled because PM is a management role in the RC1 directive.
- Existing data may still store `boss`; this remains valid and is intentionally preserved.
- Existing historical user records with future role names are not deleted, but new/updated RC1 role assignments must use Boss/Admin/PM/APM values.
- Child-level Firebase read refactor is a future roadmap item before Foreman/Safety/Viewer activation.
