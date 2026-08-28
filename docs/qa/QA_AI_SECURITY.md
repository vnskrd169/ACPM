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
`agents`, `runtimeStatus`, `conditions`, `events`, `runs`, `findings`,
`recommendations`, `decisions`, and `idempotency`. A bulk `/ai` write and
unknown child names are denied.

## Browser read matrix

| Path group | boss/owner/admin | PM | APM | inactive/anonymous |
| --- | --- | --- | --- | --- |
| sanitized output and runtime status | read | read | denied | denied |
| config | read | denied | denied | denied |
| conditions and idempotency | denied | denied | denied | denied |
| any `/ai` write | denied | denied | denied | denied |

APM access is deferred in V0.1 because AI output is initially a management
review surface and the output model does not yet provide project-scoped read
rules. Adding APM access would require project-scoped records and separate
authorization tests.

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
Production config is seeded. Future execution must check both master and
generation flags, while either false is an emergency stop. In Phase 2 there is
no deployable execution entrypoint, so generation cannot run regardless of
database state.

## Local proof commands

With the RTDB emulator available on port 18200:

```text
npx firebase emulators:exec --only database --config firebase.emulator.json --project acpm-ai-security-test "npm run test:ai:rules"
npm run test:ai:static
npm --prefix functions test
npm --prefix functions run typecheck
```

The emulator suite proves allowed AI writes and context reads, rejects broad
project and sensitive reads, rejects business/auth/notification/audit writes,
checks the complete browser role matrix, and prevents a role-bearing service
profile. The static gate scans backend source for obvious non-AI writes,
provider key patterns, enabled defaults, real provider SDKs, deployable
Firebase triggers/callables, and the required Admin auth override.
