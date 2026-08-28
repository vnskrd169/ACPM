# ACPM AI Command Center Foundation

Status: **contracts and deterministic routing only; disabled and not deployed**

## Purpose and V0.1 boundary

The AI Command Center is planned as an optional analysis layer over ACPM. V0.1
is read-only relative to existing business records because purchase orders,
billing, payroll, payments, change orders, official communications, and task
schedules are controlled operational records. A model must not approve,
release, delete, or silently modify them.

This foundation contains no Firebase reads or writes, no Cloud Function
exports, no provider SDK, no network call, and no Office or PMOS UI change.
The `DisabledProvider` is the only provider implementation.

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

## Future AI namespace

No database namespace is added in this commit. A later, separately reviewed
phase may introduce:

```text
ai/config
ai/agents/{agentId}
ai/events/{eventId}
ai/runs/{runId}
ai/findings/{runId}/{agentId}
ai/recommendations/{recommendationId}
ai/decisions/{decisionId}
ai/idempotency/{dedupHash}
```

AI records must remain outside existing business paths.

## Future security model

A later backend phase must be feature-flagged off by default and use a
down-scoped server identity. That identity may read only approved ACPM context
and write only inside `/ai`. Browser clients must never receive provider keys
or directly write AI runs/findings. Human decision capture must record human
input only; it must not execute business mutations.

Provider credentials belong in a server-side secret manager and must never be
stored in RTDB, source control, environment files shipped by Hosting, logs, or
browser code.

## Failure isolation

ACPM Office and PMOS must continue operating normally when AI is disabled,
unconfigured, unavailable, slow, or returns invalid output. Future AI work
must run outside existing save/approval/payment paths, and an AI failure must
never roll back or block an ACPM business workflow.
