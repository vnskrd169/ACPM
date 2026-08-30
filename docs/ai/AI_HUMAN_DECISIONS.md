# AI Human Decision Workflow

## Human-intent boundary

Phase 6 records management intent about an AI recommendation. It does not execute the selected option. The workflow has no task, purchase-order, schedule, supplier-message, billing, payment, change-order, or other business-record mutation path.

The browser cannot write `/ai`. It sends a narrowly validated request to the authenticated `submitAiDecision` callable. The callable verifies the caller's live ACPM user profile, then uses the existing restricted `acpm-ai-service` RTDB identity for the decision transaction.

## Authorization

The callable requires:

- Firebase Authentication;
- an ACPM user profile whose current status is `active`; and
- a current role of `boss`, `owner`, `admin`, or `pm`.

APM, inactive, anonymous, missing-profile, and unrecognized-role callers are denied. The caller supplies no trusted role or status value. A caller-scoped RTDB connection reads only that caller's own profile; the restricted AI service identity remains denied from `/users` and all business-record writes.

## Decision model and actions

Decisions remain at `/ai/decisions/{decisionId}` with `open`, `resolved`, or `dismissed` status.

- **Choose:** accepts only an exact option already stored on the open decision, sets `resolved`, and records the option and resolution metadata.
- **Defer:** keeps the decision `open` and records who deferred it and when.
- **Dismiss:** sets `dismissed` without deleting the record. It means no decision or action is required from that recommendation.

An optional plain-text note is trimmed, limited to 500 characters, rejected when it contains unsafe control characters, escaped in the UI, and treated only as user data.

## Validation and immutability

Before mutation, the server validates the request schema, decision schema, expected creation timestamp, stored option, and the decision/recommendation/event/project/run relationships. The final transaction repeats the decision-state and option checks.

Choose and dismiss are immutable final outcomes. A different second submission receives `decision_already_resolved`. The browser disables controls while a request is pending, and a stable submission ID makes an identical retry idempotent. Concurrent managers can race, but exactly one final transaction wins.

## Audit history

Each accepted choose, defer, or dismiss action appends an event at:

`/ai/decisions/{decisionId}/history/{submissionId}`

The event contains only the decision/project IDs, action, selected stored option when applicable, actor UID and role, timestamp, and optional note. It contains no auth token, provider response, prompt, secret, or reasoning trace. The history event and decision state are committed in the same RTDB transaction.

Resolved and dismissed decisions remain stored. Their recommendation remains visible, and management can reopen the recorded decision from recommendation history.

## Failure handling

Callable errors map to stable safe codes. The UI does not optimistically finalize a decision; it updates only after server confirmation. Authentication, authorization, malformed/stale records, invalid options, duplicate conflicts, concurrent resolution, transaction failure, network failure, and unavailable callable states leave Office and PMOS operational.

## Zero-budget compatibility

The workflow does not call OpenAI and does not require provider configuration. Deterministic Needs Action items remain separate and are never converted into AI decision records.

## Future controlled-action phase

A future phase may translate a separately authorized human decision into a controlled business action. That would require new per-action schemas, authorization, previews, business rules, audit records, idempotency, and release review. Phase 6 intentionally provides none of those execution paths. Web App Check enforcement can also be added after ACPM has a configured browser attestation provider; Phase 6 relies on Firebase Authentication plus live ACPM profile authorization.
