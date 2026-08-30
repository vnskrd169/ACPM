# ACPM Controlled Action Drafts

## Purpose

Phase 7A adds a review-only layer between a resolved human decision and any
future controlled action. A draft records proposed intent; it cannot execute,
send, purchase, pay, schedule, bill, delete, or mutate an ACPM business record.

The flow is:

`Detection / Recommendation -> Human Decision -> Resolved structured option -> Action Draft -> Human Review`

There is no execution step in this phase.

## Allowed action types

Only these server-validated draft types are accepted:

- `follow_up_supplier`
- `prepare_material_request`
- `prepare_task_update`
- `prepare_site_follow_up`
- `prepare_internal_note`

They describe draft intent only. Purchase approval, payment release, change
order approval, outbound messages, schedule/billing changes, deletion, and all
other unlisted types are rejected.

## Strict mapping model

A draft can be created only from the selected option's stored, validated
`actionIntent`. The intent supplies its allowlisted type, title, summary, and
strict payload. The system never derives an action type from the option label
or other natural-language text. A resolved plain-text option, or a structured
option without `actionIntent`, legitimately creates no draft.

Draft IDs are deterministic for the source decision and option. Replaying the
same successful resolution therefore returns the existing draft rather than
creating a duplicate. Explicit unknown payload values remain null in the
validated domain model and render as `Unknown`; ACPM does not infer quantity,
price, supplier, required date, cost, schedule impact, or causality.

## Review and cancellation

Active `boss`, `owner`, `admin`, and `pm` users may call the server review
workflow. APM is denied. The only transitions are:

- `draft -> reviewed`
- `draft -> cancelled`

Reviewed means a human inspected the proposal. The UI always states
`Reviewed — not executed`. Cancellation preserves the draft and records the
actor and time; it does not delete the draft or alter its source decision.
Reviewed and cancelled records are final and historical.

## Audit and security boundary

Drafts live under `/ai/actionDrafts`. Safe append-only events live under
`/ai/actionDraftEvents` and contain only draft/decision/project IDs, action,
actor UID/role, and timestamp. No prompt, tokens, secret, raw provider output,
or unrestricted payload is included.

Browsers may read these paths only for active management roles and cannot write
them directly. Creation, review, and cancellation use the restricted
`acpm-ai-service` database identity and explicit `/ai` path assertions. The
service still has no business-record write permission.

## Zero-budget support and future execution

Draft creation and review are deterministic and do not call OpenAI or any other
provider. Provider availability is irrelevant.

A future execution phase would require a separate security, permission,
validation, idempotency, audit, UI, and release review. Phase 7A provides no
execution status, business adapter, or execution control.
