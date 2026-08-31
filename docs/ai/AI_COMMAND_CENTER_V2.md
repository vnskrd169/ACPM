# ACPM AI Command Center V2

Status: local development on `feature/ai-command-center-v2`
Production Pilot RC1 remains unchanged and hidden while `/ai/uiStatus` is absent.

## Product vision

The Command Center is ACPM's construction intelligence operations room. It
presents a small, specialized AI operations team that helps management
understand company activity, project attention, recent intelligence, grounded
recommendations, and waiting decisions.

V2 keeps the RC1 deterministic attention engine, Daily Brief, provider
contracts, findings, recommendations, decisions, and Controlled Action Drafts
as its backbone. Those records now support a broader operations-room identity
instead of appearing as one large overdue-item dashboard.

V2 never presents fake AI activity or fake autonomy. Rule-based results are
explicitly labeled. `ANALYZING` appears only when a stored run has
`status: running` and names that agent. No animation implies work that is not
recorded.

## Information hierarchy

The primary navigation is intentionally shallow:

1. **Overview** — Company Pulse, deterministic Daily Brief, Ask Command
   Center, Operations Attention, project summary, Waiting On You, Action
   Drafts, recommendations, and system status.
2. **Projects** — company project list and selected Project Intelligence.
3. **AI Team** — responsibilities, truthful states, finding counts, and only
   explicitly linked handoffs.
4. **Activity** — provenance-labeled intelligence timeline plus progressively
   disclosed run history.

Waiting On You remains restricted to actual `/ai/decisions`. Deterministic
operational exceptions remain in Operations Attention. Action Drafts remain a
separate review-only queue.

## Company Pulse

Company Pulse uses only canonical counts from already-authorized snapshots and
bounded AI records:

- active projects;
- projects with current deterministic attention;
- open deterministic findings;
- high and critical attention items;
- open management decisions;
- Action Drafts pending review;
- recorded intelligence activity today; and
- the highest-ranked deterministic attention item.

It does not display health, risk, completion, schedule-confidence, or financial
exposure percentages. No such score is calculated unless a future canonical
contract explicitly supplies and validates it.

The Daily Brief remains inside Company Pulse and retains the label
`Rule-based · no AI generation`.

## AI Team and responsibilities

### PM Agent

- synthesizes validated cross-domain findings;
- prioritizes management attention;
- prepares grounded recommendations; and
- frames management decisions.

The PM Agent is provider-dependent for advanced synthesis. With no configured
provider it reports `NOT_CONFIGURED`, while deterministic monitors continue.

### Planning Monitor

- overdue and blocked tasks;
- work submitted for verification;
- unresolved attendance signals already supported by the attention model; and
- dependencies or schedule evidence only when canonical fields exist.

### Materials Monitor

- material and purchase requests;
- ordered and received quantities;
- partial deliveries; and
- inventory only when an exact, explicitly verified record supports it.

It does not guess site stock or supplier responsibility.

### Site / QA Monitor

- open and aging site issues;
- punch and verification signals; and
- unresolved site concerns.

### Truthful agent states

| State | Rule |
| --- | --- |
| `MONITORING` | A deterministic specialized monitor is active; no provider is implied. |
| `IDLE` | Advanced analysis is available but no stored active run names the agent. |
| `ANALYZING` | A stored run is currently `running` and explicitly includes the agent ID. |
| `NOT_CONFIGURED` | Advanced provider-backed analysis is not configured. |
| `DEGRADED` | The sanitized system status reports degraded advanced analysis. |

`WAITING_FOR_PROVIDER` is reserved for a future canonical runtime state. V2
does not derive it from elapsed time or UI activity.

## Intelligence timeline

The normalized timeline may contain:

- `SYSTEM_DETECTED` from stored `/ai/events`;
- `RULE_BASED_MONITOR` from deterministic `AttentionItem` records;
- `AI_ANALYSIS` from stored runs and recommendations;
- `HUMAN_DECISION` from `/ai/decisions`; and
- `ACTION_DRAFT` from `/ai/actionDrafts` and `/ai/actionDraftEvents`.

Every timeline entry carries a safe record type/id reference, project scope,
timestamp, actor, and provenance label. Missing timestamps remain unavailable;
they are not replaced with a fabricated recent time.

`/ai/conditions` remains service-only under the current security model, so the
browser does not read it or weaken its rule. Management-visible condition
history enters the timeline through the reviewed `/ai/events` projection.

Agent handoffs are shown only when stored IDs such as `eventId`, `runId`,
`recommendationId`, `decisionId`, or `actionDraftId` connect two records. Time
proximity and matching prose never create a relationship. With no explicit
link, the UI says that no handoff chain is recorded.

## Project Intelligence

Project drill-down groups normalized data into:

- current attention;
- Planning signals;
- Materials signals;
- Site / QA signals;
- recommendations, waiting decisions, and Action Drafts; and
- recent project-scoped intelligence activity.

The view reuses project snapshots ACPM Office has already authorized and
loaded. It does not add per-project Firebase listeners, list the project root,
or calculate a health percentage.

## Ask Command Center

Ask Command Center is a zero-budget, deterministic, read-only query layer. A
question is matched against a finite intent set and an optional known project
name. The question is never used as a Firebase path, selector, command, or
business mutation.

Supported intents:

| Intent | Grounded source |
| --- | --- |
| `company_priority` | highest-ranked current `AttentionItem` |
| `project_attention` | project-scoped attention items |
| `blocked_tasks` | blocked task attention items |
| `overdue_tasks` | overdue task attention items |
| `verification_tasks` | verification attention items |
| `attendance_unresolved` | unresolved-attendance attention items |
| `partial_deliveries` | partial-delivery attention items |
| `pending_material_requests` | pending-request attention items |
| `open_site_issues` | open site-issue attention items |
| `aging_site_issues` | aging site-issue attention items |
| `recent_changes` | normalized bounded intelligence timeline |
| `materials_summary` | Materials categories in current attention |
| `planning_summary` | Planning categories in current attention |
| `site_summary` | Site / QA categories in current attention |
| `waiting_decisions` | open `/ai/decisions` |
| `action_drafts` | draft-status `/ai/actionDrafts` |

English and limited Tagalog keyword patterns are supported. Known project
names are matched against the in-memory authorized project list.

Unsupported questions return exactly:

> That question requires advanced AI analysis, which is not configured in the
> current pilot.

The normalized `CommandCenterAnswer` contains `intent`, `scope`, `projectId`,
`title`, `summary`, `facts`, `sourceRefs`, `generatedBy`, and `timestamp`.
`generatedBy` is `deterministic` in V2 zero-budget mode. The contract preserves
`ai` as a separate future provenance value; the current browser makes no
provider call.

Answers never infer cost impact, schedule impact, delay days, supplier blame,
stock shortage, or causal relationships from operational coincidence.

## Provider-ready architecture

The future optional path is:

```text
question
  -> deterministic intent gate
  -> allowlisted context assembler
  -> optional server-side provider
  -> structured grounded answer
  -> schema and evidence validation
  -> CommandCenterAnswer
```

Provider credentials remain server-only. A future provider must not receive a
full project snapshot, bypass authorization, read arbitrary evidence paths, or
replace the deterministic fallback.

## Security and performance

- management roles remain boss, owner, admin, and PM;
- APM access remains denied before any `/ai` read;
- `/ai/uiStatus` remains the fail-closed UI gate;
- `/ai/config` remains protected and is never read by the browser;
- Ask is read-only and creates no Firebase or business write;
- project/user text is escaped before HTML rendering;
- evidence references remain display-only and are never fetched as paths;
- existing authorized Office project snapshots are reused;
- AI listeners remain bounded and detachable;
- Action Draft events use one bounded collection listener;
- no per-card or per-project listener, root project listing, polling loop, or
  provider call was added.

## No-execution boundary

V2 does not send messages, apply changes, create purchase orders, pay, modify
schedules, approve purchases, or execute an Action Draft. Existing Human
Decision and Controlled Action Draft callables remain separate reviewed
workflows. A reviewed draft is still explicitly “not executed.”

Production activation, `/ai/uiStatus` seeding, Functions deployment, OpenAI,
Secret Manager configuration, scheduler setup, and Production data changes are
outside Phase 8.
