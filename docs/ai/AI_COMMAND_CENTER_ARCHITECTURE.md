# ACPM AI Command Center Foundation

Status: **security foundation and deterministic routing only; disabled and not deployed**

## Purpose and V0.1 boundary

The AI Command Center is planned as an optional analysis layer over ACPM. V0.1
is read-only relative to existing business records because purchase orders,
billing, payroll, payments, change orders, official communications, and task
schedules are controlled operational records. A model must not approve,
release, delete, or silently modify them.

This foundation contains a restricted Firebase Admin initialization helper and
RTDB rules, but no code that performs a Firebase read or write, no Cloud
Function exports, no provider SDK, no network call, and no Office or PMOS UI
change. The `DisabledProvider` is the only provider implementation.

## Logical agents

The initial logical agents are:

- `materials`: analyzes explicitly supplied procurement, delivery, and stock
  facts.
- `planning`: analyzes explicitly supplied tasks, dates, links, and issue facts.
- `pm`: synthesizes validated findings and always runs last.

They are permission and instruction boundaries, not separate deployed models.
Future implementations may use one provider adapter for all three.

## Deterministic routing

Routing is pure code and never selected by a model:

| Event | Route |
| --- | --- |
| `material_delivery_overdue` | materials -> planning -> pm |
| `material_stock_low` | materials -> planning only when linked work exists -> pm |
| `task_overdue` | planning -> materials only when material/procurement relevance exists -> pm |
| `site_issue_created` | planning -> materials only when material/procurement relevance exists -> pm |

The router validates that agent IDs are unique and `pm` is last.

## Grounded context and evidence

Future context assembly must read actual ACPM records, select only allowlisted
fields, and pass an immutable `GroundedContext` to the provider. User-entered
record text is data, not model instructions.

Every asserted fact must point to evidence containing:

- `path`
- `recordId`
- `field`

Provider output is untrusted until it passes the strict Zod schemas and future
evidence-grounding checks. Free-form output must never drive application
logic.

## Unknown-value policy

Unknown facts remain unknown. Schedule days, cost amount, and currency use
`null` when the source records do not establish them. Unknown impacts require
a reason. The schemas reject silently replacing an unknown schedule or cost
impact with zero.

The model must not guess dates, quantities, dependencies, schedule duration,
cost, supplier performance, or project facts.

## Delivery-overdue suppression

Current ACPM purchase orders store the PO date, status, delivery status,
ordered and received quantities, and actual delivery dates. They do not have a
canonical expected/promised delivery date.

Therefore `material_delivery_overdue` is ineligible unless an explicit
`expectedDeliveryDate` or `promisedDeliveryDate` is supplied by a future
approved data contract. Without one, the detector returns:

```text
eligible: false
reason: missing_expected_delivery_date
```

It never substitutes PO creation date, request needed date, supplier history,
actual delivery dates, or a model-generated date.

## Provider abstraction

`LlmProvider` exposes provider health and structured generation without naming
OpenAI, Claude, or another vendor. A future implementation must receive a
grounded context and output schema, honor a timeout and idempotency key, and
return an untrusted value for validation.

The default `DisabledProvider` performs no I/O. Disabled and not-configured
states are ordinary results, not exceptions.

## Isolated AI namespace

Phase 2 reserves these explicit paths:

```text
ai/config
ai/agents/{agentId}
ai/runtimeStatus
ai/conditions/{conditionId}
ai/events/{eventId}
ai/runs/{runId}
ai/findings/{runId}/{agentId}
ai/recommendations/{recommendationId}
ai/decisions/{decisionId}
ai/idempotency/{dedupHash}
```

Unknown `/ai` children are denied. Only `acpm-ai-service` can write the listed
paths. Active boss, owner, admin, and PM users can read sanitized agents,
runtime status, events, runs, findings, recommendations, and decisions. Config
is limited to the service plus active boss, owner, and admin users. Conditions
and idempotency records are service-only. Browser writes, APM access,
anonymous access, and inactive-user access are denied.

AI records remain outside existing business paths. AI output writers must
persist sanitized structured records only; prompts, provider credentials, raw
provider responses, and sensitive source records do not belong in
management-readable output paths.

## Service security model

Firebase Admin is prepared under a named app using
`databaseAuthVariableOverride` with UID `acpm-ai-service`. This makes RTDB
evaluate the service against the same rules emulator-tested here instead of
granting unrestricted Admin database access. The reserved UID cannot be
created as a browser user profile through RTDB rules.

The service may read only:

- `projects/{projectId}/tasks`
- `projects/{projectId}/purchaseOrders`
- `projects/{projectId}/deliveries`
- `projects/{projectId}/inventory`
- `projects/{projectId}/materialMovements`
- `projects/{projectId}/purchaseRequests`
- `projects/{projectId}/siteLogs`
- `projects/{projectId}/punchList`
- `projects/{projectId}/pmosIssues`
- `pmosIssues`

It cannot list projects or read a whole project. It can write only the ten
explicit `/ai` children. Existing rules that previously allowed any
authenticated identity to write self-service auth/notification or append-only
audit records now explicitly exclude this reserved UID; all existing ACPM
human-role branches are unchanged.

Supplier reads are deliberately not granted. RTDB read rules cascade: granting
read access at `suppliers/{supplierId}` also exposes bank/account siblings and
a child rule cannot revoke that access. Phase 2 therefore uses safe supplier
IDs/names already embedded in purchase records. A future supplier context
feature must first add a safe projection or use the code allowlist (`name`,
`specialty`, `status`) and obtain a separately reviewed minimum read path.

`functions/src/ai/security.ts` duplicates the allowed context, AI write, and
supplier-field boundaries as application guards. RTDB rules remain the
authoritative enforcement layer.

## Disabled configuration and emergency stop

The typed defaults are:

```text
enabled=false
generationEnabled=false
uiEnabled=false
dryRun=true
timeZone=Asia/Manila
maxAttempts=3
all four event flags=false
```

No Production config is seeded. Future activation must require both
`enabled` and `generationEnabled`; either false is an emergency generation
stop. `uiEnabled` independently keeps UI exposure off and `dryRun` prevents
business execution. Phase 2 has no execution code, so changing an RTDB value
alone still cannot start generation.

## Future provider boundary

Browser clients must never receive provider keys or directly write AI
runs/findings. Human decision capture must record human input only; it must not
execute business mutations.

Provider credentials belong in a server-side secret manager and must never be
stored in RTDB, source control, environment files shipped by Hosting, logs, or
browser code.

## Failure isolation

ACPM Office and PMOS must continue operating normally when AI is disabled,
unconfigured, unavailable, slow, or returns invalid output. Future AI work
must run outside existing save/approval/payment paths, and an AI failure must
never roll back or block an ACPM business workflow.
