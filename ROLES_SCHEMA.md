# ACPM Roles and Permissions v1

Status: DATA FOUNDATION IMPLEMENTED - MANUAL QA PENDING

ACPM preserves legacy `boss` and `apm` roles while adding a production-ready role model for field and management users.

## Roles

| Role | Canonical Value | Purpose |
| --- | --- | --- |
| Boss / Owner | `boss` or `owner` | Full company/admin access, financials, settings, team, audit logs. |
| Admin | `admin` | Full admin access except identity ownership decisions remain business controlled. |
| Project Manager | `pm` | Assigned project management with financial/report visibility. |
| Assoc. Project Manager | `apm` | Assigned project operations without full profit/collection visibility by default. |
| Foreman | `foreman` | Field site log access only. No profit, billing, collections, or admin settings. |
| Safety | `safety` | Field safety/site log access only. No profit, billing, collections, or admin settings. |
| Viewer | `viewer` | Read-only assigned project access. |

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
- `isFieldRole(role)`
- `isViewerRole(role)`
- `canWriteFieldLog(projectId)`
- `roleLabel(role)`

## UI Visibility

Workspace tab visibility:

- Labor: `boss`, `owner`, `admin`, `pm`, `apm`
- Materials: `boss`, `owner`, `admin`, `pm`, `apm`
- Billing: financial roles only
- Site Log: management plus `foreman`, `safety`, and read-only `viewer`
- Change Orders: management/APM roles
- Suppliers: management/APM roles
- Reports: financial roles only
- Admin/Team/Audit: admin roles only

## Firebase Rules

Rules now accept:

```text
boss owner admin pm apm foreman safety viewer
```

Admin-rule checks accept:

```text
boss owner admin
```

Project write fallback is limited to assigned `pm` and `apm`. Field roles receive explicit write access for Site Log paths only.

## Known Limitations

- Firebase rules are improved but still need full emulator/deployed-rule QA.
- Field-role access is focused on Site Logs for RC1. Viewer lands on Site Log as a read-only assigned-project area. Dedicated Foreman/Safety dashboards can come after RC1.
- PM financial visibility is enabled because PM is a management role in the RC1 directive.
- Existing data may still store `boss`; this remains valid and is intentionally preserved.
