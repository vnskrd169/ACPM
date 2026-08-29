# ACPM AI Command Center

Status: **deterministic fake-provider pipeline; disabled and not deployed**

## Purpose and boundary

The AI Command Center is an optional analysis layer over ACPM. It is read-only
relative to existing business records: purchase orders, billing, payroll,
payments, change orders, official communications, and task schedules remain
controlled operational records. AI cannot approve, release, delete, or modify
them.

Phase 3 adds internal source readers, a deterministic reconciler,
transactional AI stores, grounded context assembly, logical agents, and a
deterministic `FakeProvider`. It exports no Cloud Function, performs no
provider network call, includes no provider SDK, and changes no Office/PMOS UI
or business-data write path.

## Explicit project enrollment

The service cannot list `/projects`, by design. Reconciliation receives a
project ID and requires a service-controlled record at
`ai/projectTargets/{projectId}`. This target contains scanning controls only:

```text
schemaVersion = 0.1
enabled = false
activationAt = null
scanTasks = false
scanMaterials = false
scanIssues = false
lastScanAt = null
```

Enabling a target requires numeric `activationAt`. The strict schema rejects
project names, client details, financial values, and every unknown child.
Disabling stops later scans without deleting historical AI records.
Management may read targets; only `acpm-ai-service` may write them. APM and
browser identities cannot write.

There is no scheduler export. An explicit caller may invoke
`reconcileProject(projectId, now)`, after which the source reader accesses only
authorized child collections for that exact project. It never reads or lists
the project root. Production config and targets are not seeded.

## Reconciliation and condition lifecycle

Detection is pure code; a model never decides if an event exists. Manila
calendar semantics apply to date-only task and delivery fields. The four event
types are:

- `task_overdue`: a non-terminal task has a valid due date before Manila today.
- `material_stock_low`: numeric quantity on hand is at or below an explicit
  numeric reorder point/threshold. A missing threshold is never guessed.
- `site_issue_created`: a root PMOS, project fallback, punch-list, or nested
  site-log issue was created at/after target activation.
- `material_delivery_overdue`: remaining quantity exists and an explicit
  expected/promised delivery date is before Manila today. PO/needed dates are
  never substituted.

Root and fallback PMOS issues share a logical identity when a canonical or
client-generated ID is available. Terminal tasks, pre-activation issues,
missing thresholds, and missing expected delivery dates produce deterministic
suppressions rather than events.

Conditions are keyed from project ID, event type, logical source, and logical
record identity. Transactions implement:

```text
false -> true  open cycle; create one deterministic event
true  -> true  update evaluation time; do not duplicate
true  -> false resolve active event
false -> true  open the next numbered recurrence cycle
```

Condition changes, event/idempotency claims, event creation, and run claims use
RTDB transactions and deterministic IDs. Repeated, concurrent, retry, and
at-least-once invocations converge on the same logical event/run.

Events contain only schema/event/project identifiers, source path/record/field
references, a source digest, condition/dedup keys, timestamps, status, and
run ID. They never copy a project snapshot.

## Logical agents and routing

`materials`, `planning`, and `pm` are logical context boundaries, not separate
deployed models. Routing is deterministic:

| Event | Route |
| --- | --- |
| `material_delivery_overdue` | materials -> planning -> pm |
| `material_stock_low` | materials -> planning when linked work exists -> pm |
| `task_overdue` | planning -> materials when material/procurement relevance exists -> pm |
| `site_issue_created` | planning -> materials when material/procurement relevance exists -> pm |

The PM agent always runs last. Materials and planning receive only relevant
allowlisted context. PM receives deterministic event facts, validated earlier
findings, and evidence references—not unrestricted project data.

## Grounded context and validation

Context assembly selects explicit task, material, issue, and line-item fields.
It never passes a raw Firebase object or project snapshot. Payroll, rates,
billing, payments, collections, bank/account data, private-user data, and
supplier account details are excluded. Supplier reads remain denied; safe IDs
or names already embedded in an allowed purchase record may be selected.
User-entered text remains data, never instructions.

Every factual assertion references evidence by `path`, `recordId`, and
`field`. Provider output is untrusted until strict Zod validation and grounding
validation pass. Evidence must exist in the supplied context. Numeric schedule
days or cost amounts are rejected unless deterministic context explicitly
supports that exact number. Unknown values remain null with a reason.

## Provider boundary

`LlmProvider` defines health and structured generation without naming a vendor.
`FakeProvider` is development/test-only and makes no network calls. It
deterministically simulates valid output, unknown schedule/cost impacts,
decision/no-decision output, invalid JSON-like and schema-invalid output,
timeout, transient failure, and permanent failure. `DisabledProvider` remains
the no-I/O default boundary.

Provider credentials do not exist in Phase 3. Future credentials belong in a
server-side secret manager, never RTDB, source control, Hosting output, logs,
or browser code.

## Isolated AI namespace and service permissions

Explicit Phase 3 paths are:

```text
ai/config
ai/projectTargets/{projectId}
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

Unknown `/ai` children are denied. Only `acpm-ai-service` may write. Active
boss, owner, admin, and PM users can read sanitized operational AI output and
targets; config excludes PM. Conditions/idempotency are service-only. Browser
writes, APM access, anonymous access, and inactive-user access are denied.

The named Firebase Admin app uses `databaseAuthVariableOverride` with UID
`acpm-ai-service`, so rules still constrain it. Its reads are limited to these
already reviewed paths:

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

It cannot list projects or read a whole project. It can write only the eleven
explicit `/ai` children. Supplier reads are deliberately not granted because
parent RTDB reads would expose sensitive siblings. Existing human-role
branches remain unchanged.

## Flags and dry-run contract

Defaults are `enabled=false`, `generationEnabled=false`, `uiEnabled=false`,
`dryRun=true`, `timeZone=Asia/Manila`, `maxAttempts=3`, and every event flag
false. Targets also default disabled.

Detection requires global `enabled`, an enabled target with `activationAt`, a
matching target scan flag, and the event-type flag. Generation requires both
`enabled` and `generationEnabled`; either false causes zero provider calls.

Dry run is audit-only. With `dryRun=true`, validated analysis may save a run
and per-agent findings and complete the AI event/run, but it creates no
recommendation or decision. With `dryRun=false`, a validated PM finding creates
one deterministic recommendation and creates an open decision only when human
judgment is required. Neither mode writes business records.

## Failure isolation and remaining work

Timeouts, provider errors, schema failures, bad evidence, and unsupported
numeric claims fail closed. A safe error code may be saved on the AI run/event;
no recommendation or decision is created. AI never participates in ACPM save,
approval, payment, or scheduling paths, so Office and PMOS keep operating.

A real provider requires a separately reviewed server adapter, secret-manager
integration, bounded retry/timeout policy, observability, privacy review, and
provider tests. A scheduler would require a separate export review and may
iterate only enabled `/ai/projectTargets`.

UI remains deferred. Before output is exposed, ACPM needs reviewed read models,
clear provenance/uncertainty presentation, and a server-owned human-decision
workflow. Browser resolution and automatic business actions stay out of scope.
