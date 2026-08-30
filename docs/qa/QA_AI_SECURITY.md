# QA: ACPM AI Security Foundation

## Scope

Phase 2 proves the RTDB permission boundary before any provider, trigger,
schedule, callable, generation path, or UI exists. Tests use the local RTDB
emulator only and do not seed or deploy Production.

## Identity and namespace

The backend helper initializes a named Firebase Admin app with
`databaseAuthVariableOverride.uid = acpm-ai-service`. The service has no entry
under `/users`; rules also reserve that UID against browser profile creation.

Allowed reads are exactly:

```text
projects/{projectId}/tasks/**
projects/{projectId}/purchaseOrders/**
projects/{projectId}/deliveries/**
projects/{projectId}/inventory/**
projects/{projectId}/materialMovements/**
projects/{projectId}/purchaseRequests/**
projects/{projectId}/siteLogs/**
projects/{projectId}/punchList/**
projects/{projectId}/pmosIssues/**
pmosIssues/**
```

Allowed writes are exactly the explicit children under `/ai`: `config`,
`projectTargets`, `agents`, `runtimeStatus`, `uiStatus`, `conditions`, `events`,
`runs`, `findings`, `recommendations`, `decisions`, `actionDrafts`,
`actionDraftEvents`, and `idempotency`. Decision audit events are children of
each decision's `history`; there is no separate `decisionEvents` root. A bulk
`/ai` write and unknown child names are denied.

## Browser read matrix

| Path group | boss/owner/admin | PM | APM | inactive/anonymous |
| --- | --- | --- | --- | --- |
| sanitized output and runtime status | read | read | denied | denied |
| sanitized `uiStatus` projection | read | read | denied | denied |
| config | read | denied | denied | denied |
| conditions and idempotency | denied | denied | denied | denied |
| any `/ai` write | denied | denied | denied | denied |

APM access is deferred in V0.1 because AI output is initially a management
review surface and the output model does not yet provide project-scoped read
rules. Adding APM access would require project-scoped records and separate
authorization tests.

## PM-readable UI availability projection

PM remains denied from `/ai/config`. That node is the authoritative internal
configuration and contains generation, dry-run, retry, event, and timezone
controls that the browser does not need for Command Center gating.

The service-owned `/ai/uiStatus` projection contains exactly:

```text
schemaVersion = 0.1
uiEnabled = boolean
systemStatus = disabled | not_configured | ready | degraded | unavailable
updatedAt = non-negative integer timestamp
```

Active boss, owner, admin, and PM users may read this projection. Only
`acpm-ai-service` may write it. APM, inactive, and anonymous users are denied,
and unknown fields fail validation. The projection is derived server-side from
the authoritative config and sanitized runtime status. Missing `uiStatus`
means the UI is disabled; browser code must not fall back to `/ai/config`.
This adds no business-record permission and does not weaken the original
config boundary.

## Supplier limitation

Current supplier records contain ordinary context and sensitive bank/account
fields at the same RTDB node. RTDB grants cascade downward, so rules cannot
grant record/list access and then hide sensitive children. The service is
therefore denied all `/suppliers` reads in Phase 2, including direct bank and
account field reads.

Safe supplier names/IDs already embedded in purchase orders and deliveries may
be used. `SUPPLIER_CONTEXT_FIELD_ALLOWLIST` permits only `name`, `specialty`,
and `status` for a future separately authorized supplier projection; its unit
test proves bank/account fields are dropped. The allowlist does not grant
database access.

## Disabled and emergency-stop model

The code-owned config defaults keep `enabled`, `generationEnabled`,
`uiEnabled`, and every initial event flag false; `dryRun` is true. No RTDB
Production config is seeded. Provider execution checks both master and
generation flags, while either false is an emergency stop. Human Decision and
Action Draft callables have no provider or business-execution path. Their
deployment remains blocked for RC1 until Firebase billing and supported Web
App Check prerequisites are complete; see
`docs/release/AI_COMMAND_CENTER_RC1.md`.

## Local proof commands

With the RTDB emulator available on port 18200:

```text
npx firebase emulators:exec --only database --config firebase.emulator.json --project acpm-ai-security-test "npm run test:ai:rules"
npm run test:ai:static
npm --prefix functions test
npm --prefix functions run typecheck
```

The emulator suite proves allowed AI writes and context reads, proves PM can
read only the sanitized UI projection while remaining denied from config,
rejects broad project and sensitive reads, rejects business/auth/notification/audit writes,
checks the complete browser role matrix, and prevents a role-bearing service
profile. The static gate scans backend source for obvious non-AI writes,
provider key patterns, enabled defaults, unreviewed Firebase triggers/callables,
bounded callable capacity, and the required Admin auth override.
