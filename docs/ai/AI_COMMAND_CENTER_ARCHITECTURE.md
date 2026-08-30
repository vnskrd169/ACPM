# ACPM AI Command Center

Status: **staging-only OpenAI adapter and manual dry-run runtime prepared; disabled and not deployed**

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

### Phase 4 OpenAI adapter

`OpenAIProvider` is the first real adapter and is the only backend module that
imports the official OpenAI Node SDK. The reviewed dependency is pinned at
`openai@7.8.0`. It uses the Responses API with strict JSON Schema structured
output, `store=false`, no tools, an idempotency header, a per-request timeout,
and explicit retry handling. The adapter has no Firebase import, database
credential, ACPM tool, URL-fetch facility, or business-record access.

Application code uses `analysis` and `synthesis` model aliases. Both currently
resolve inside the adapter to `gpt-5.6-luna`, selected as the current
cost-sensitive model for this bounded structured analysis. Raw model IDs do
not appear in agents, routing, orchestration, context assembly, or persisted
run records. Runs record `analysis+synthesis`, not the provider model ID.

Provider-compatible structural Zod schemas deliberately contain no opaque
refinements and are converted by the SDK to strict JSON Schema. Successful
provider parsing is still passed through the stricter local Zod schema,
cross-field unknown-value rules, evidence grounding, and unsupported numeric
claim validation. Provider structured output is an additional boundary, not a
replacement for local validation.

Prompts are versioned as `materials-v1`, `planning-v1`, and `pm-v1`. Their
server-only instructions say that all source text is untrusted data, embedded
instructions must be ignored, missing facts stay unknown, evidence must exist
in context, and exact schedule/cost numbers cannot be estimated. Prompt bodies
and raw provider responses are never persisted.

Provider exceptions map to safe codes only:

- `provider_timeout`
- `provider_rate_limited`
- `provider_unavailable`
- `provider_auth_failed`
- `provider_bad_request`
- `provider_invalid_output`
- `provider_unknown_error`

Timeout/network, HTTP 408/429, and 5xx failures retry with bounded exponential
backoff up to `maxAttempts`. Authentication, bad configuration/request, and
invalid output do not retry. API keys, headers, raw response bodies, prompts,
and upstream error messages are not logged or persisted.

## Staging-only manual runtime

The sole deployable entrypoint is `stagingManualAiDryRun`. It is a callable
with App Check enforcement, authenticated `boss`/`owner`/`admin` custom-claim
authorization, one maximum instance, Secret Manager binding, and a hard check
for Firebase project `acpm-project-system-qa`. It requires explicit
`projectId` and `eventId`, an enabled enrolled target with activation time,
global AI/generation enabled, and `dryRun=true`. Existing event/run transaction
claims prevent accidental repeat processing.

The callable uses the restricted `acpm-ai-service` Admin app. It cannot read
the project root, suppliers, users, or forbidden business collections. The
OpenAI provider receives only the `GroundedContext` assembled before the call.
Dry-run completion can create `/ai/runs`, `/ai/findings`, event status, and a
sanitized `/ai/runtimeStatus`; it cannot create recommendations or decisions.

Runtime status contains only schema version, provider alias, one of
`not_configured|healthy|degraded|unavailable`, checked/success timestamps, and
a safe error code. It contains no account, API, model, request, prompt, or
secret metadata.

`OPENAI_API_KEY` is declared only with Firebase Functions `defineSecret` and is
read only inside the staging callable runtime. It is never stored in RTDB,
frontend assets, committed environment files, provider metadata, or logs.
Staging deployment requires the explicit `-IncludeAiProvider` switch;
Production deployment excludes Functions entirely.

As of the Phase 4 implementation, both Firebase projects are on a plan that
cannot enable Secret Manager. No staging secret, config, target, fixture,
Function deployment, or live provider call was created. Production remains
unconfigured and therefore disabled by the typed defaults.

## Isolated AI namespace and service permissions

Explicit Phase 3 paths are:

```text
ai/config
ai/projectTargets/{projectId}
ai/agents/{agentId}
ai/runtimeStatus
ai/uiStatus
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

### Sanitized UI availability projection

`/ai/config` remains the authoritative internal configuration and remains
readable only by the service and active boss, owner, and admin users. PM does
not need its generation, dry-run, event, retry, or timezone controls and stays
denied from the node.

`/ai/uiStatus` is a minimal service-owned projection for Command Center feature
gating. It contains exactly `schemaVersion`, `uiEnabled`, `systemStatus`, and
`updatedAt`. `systemStatus` is one of `disabled`, `not_configured`, `ready`,
`degraded`, or `unavailable`. It contains no provider account or API detail,
model or prompt metadata, target or schedule data, raw config, secret state,
or internal error.

The pure `deriveUiStatus(config, runtimeStatus, updatedAt)` mapping fails closed:
disabled config/generation/UI controls produce `disabled`, missing runtime
status produces `not_configured`, healthy maps to `ready`, and degraded or
unavailable remain high-level sanitized states. The existing staging runtime
updates this projection whenever it saves runtime health. No scheduler was
added. Until a deployed runtime owns maintenance, emulator and UI tests seed
the projection directly as service-owned fixture data.

Active boss, owner, admin, and PM users may read `uiStatus`; only
`acpm-ai-service` may write it. APM, inactive, and anonymous users are denied.
Missing `uiStatus` means the Command Center is hidden and no browser fallback
to `/ai/config` is allowed. This projection changes no project or business
permission.

### Read-only Office Command Center

Phase 5 adds a company-level Office view to `dashboard.html` and
`workspace.html`; it is deliberately not a project workspace tab. Navigation
is created only after an active boss, owner, admin, or PM profile successfully
reads a valid `/ai/uiStatus` with `uiEnabled=true`. Missing, false, invalid, or
denied status fails closed: navigation and view markup are removed and no AI
output subscription starts. APM, inactive, anonymous, and unknown-role users
never attempt the gate or output reads.

Opening the view rechecks `uiStatus`, then attaches one bounded listener to
sanitized runtime status and bounded collections for runs, events, findings,
recommendations, and decisions. Closing, logout, account change, environment
reinitialization, and cleanup detach every listener. Refresh detaches the old
set before creating a new set. The module exposes lifecycle methods so Office
can initialize, open, close, refresh, or clean up deterministically.

The UI derives only high-level operational presentation: active logical agents,
open recommendations and decisions, Manila-local runs today, sanitized provider
health, recent activity, and validated human-review detail. Open decisions sort
by severity and age. Unknown and None impacts never display numeric values;
Possible and Confirmed values display only finite validated numbers.

Evidence is provenance text, not a browser read capability. The view escapes and
prints the supplied path, record ID, and field without fetching that path.
Project names are reused only from metadata Office has already loaded, with a
`Project <id>` fallback. Prompts, chain of thought, raw responses, provider/model
identifiers, credentials, raw internal errors, and unrestricted database paths
are not exposed.

Phase 5 remains read-only. Review opens an informational detail surface with no
approve, reject, resolve, acknowledge, dismiss, provider-call, or business-write
action. Browser code imports no provider SDK, reads no `/ai/config`, and performs
no `/ai` write. Query indexes on `createdAt` support the bounded reads without
changing any Phase 2/3/5A read or write permission.

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

It cannot list projects or read a whole project. It can write only the twelve
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

The real provider remains restricted to the separately reviewed Staging manual
dry-run boundary with Secret Manager, strict structured output, timeout/error
mapping, and `store=false`. Production provider use and automatic scheduling
remain disabled. A scheduler would require a separate export review and may
iterate only enabled `/ai/projectTargets`.

The UI supplies reviewed bounded read models and explicit
provenance/uncertainty presentation. Phase 6 adds the separately reviewed
`submitAiDecision` callable for server-owned choose, defer, and dismiss intent.
It verifies the caller's live active management profile, validates linked AI
records, and transactionally updates only `/ai/decisions/{decisionId}` with an
append-only child history event. Browser direct writes, automatic business
actions, provider dependency, and Production enablement remain out of scope.
Web App Check enforcement remains deferred until ACPM has a configured browser
attestation provider; Firebase Authentication and live profile authorization
are required now.
