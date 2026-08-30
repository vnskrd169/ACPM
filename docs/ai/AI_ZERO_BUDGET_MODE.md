# AI Command Center vNext: Zero-Budget Mode

## Purpose

The Command Center is construction operations software first. It answers “What needs attention across my projects?” without requiring OpenAI, a paid API, a deployed Firebase Function, or generative output.

## Security and data architecture

Deterministic attention is calculated in the browser only for active `boss`, `owner`, `admin`, and `pm` users who already have Command Center access. It consumes the same authorized project snapshots already loaded by ACPM Office through `getAccessibleProjectSnapshots()` and the `acpm:accessible-projects` event.

The implementation adds no Firebase listener, query, polling loop, root read, projection write, or browser business write. `/ai` rules, `/ai/uiStatus`, provider isolation, APM denial, supplier rules, and business-record permissions are unchanged. On a directly opened workspace page, the available snapshot is intentionally limited to that current authorized project; users return to the Office dashboard for the company-wide loaded set.

## Deterministic intelligence versus generative AI

- **Deterministic intelligence** evaluates stored ACPM fields using documented rules. Cards say “System detected” and have `detectedBy: deterministic`.
- **Generative AI** is optional provider-backed analysis. Existing recommendations, findings, runs, and decisions retain their AI labeling and `Waiting On You` meaning.
- Provider-off status does not disable deterministic monitoring or make the Command Center appear broken.

## AttentionItem contract

Every UI attention item has:

`id`, `projectId`, `projectName`, `category`, `severity`, `title`, `summary`, `sourceType`, `sourceId`, `occurredAt`, `age`, `status`, `recommendedDestination`, and `detectedBy`.

Categories are `attendance`, `task`, `materials`, `delivery`, `site_issue`, and `verification`. `recommendedDestination` is an enum (`attendance`, `task`, `materials`, `issue`, or `project`), never a stored URL or arbitrary path.

## Exact attention rules

1. **Task overdue:** a non-completed/non-cancelled task whose stored `dueDate` is before today in Asia/Manila.
2. **Task blocked:** a task whose normalized stored status is `blocked`/`waiting`. A blocked overdue task is represented once.
3. **For verification:** a task whose normalized status is `for_verification`/`review`.
4. **Attendance incomplete:** yesterday is applicable only when at least one expected active worker has a recorded non-`unmarked` state. Other expected active workers without a finalized state are counted as **unresolved attendance**, never absent. Stored worker start/end dates constrain expectation when present.
5. **Partial delivery:** an approved, ordered, or partially delivered purchase-order line with finite stored ordered and accepted/received quantities where ordered is greater than received. It displays exact received, ordered, and pending quantities. Lines without both reliable quantities are ignored.
6. **Material request pending:** a request in a stored pending/submitted/review/approved/procurement/ordered/partially-delivered/bought state. Draft, rejected, delivered, cancelled, and archived records do not alert.
7. **Site issue open:** an unresolved punch-list, PMOS issue, or legacy defect record.
8. **Aging site issue:** an open issue with a reliable stored occurrence time at least **3 elapsed days** old. Age alone never makes an item critical.
9. **Stock:** no attention item is derived from estimated or absent site inventory. Inventory and reorder-point data are not used by this model.

Duplicate task, request, and issue identifiers across canonical/legacy collections are emitted once.

## Priority mapping

- **Critical:** only when the source record explicitly stores `critical` severity/priority.
- **High:** a blocked overdue task, or a source record explicitly stores `high`/`major` severity/priority.
- **Medium:** ordinary overdue task, ordinary blocked task, partial delivery, aging site issue, or unresolved previous-day attendance.
- **Low:** for-verification task, pending material request, or recent open site issue without stored escalation.

The UI renders the normalized severity; it does not recalculate or visually inflate it.

## Needs Action versus Waiting On You

- **Needs Action** contains deterministic, read-only operational items that navigate to existing ACPM screens.
- **Waiting On You** contains actual open `/ai/decisions` requiring human judgment.

They are separate sections, labels, sources, and counts. Navigating from Needs Action does not mutate a record.

## Project summaries

Each active loaded project shows its real attention count and exact critical/high/medium/low breakdown. A project with zero items says “On track.” There is no arbitrary health percentage or score.

## Deterministic Daily Brief

The Daily Brief is generated locally from the normalized attention items and their deterministic project summaries. It uses no LLM or provider SDK. The UI labels it “Rule-based · no AI generation” so it cannot be confused with provider-backed recommendations.

The brief is capped at six lines. It reports the attention total and highest-priority item, then includes only detected attendance, blocked/overdue task, partial-delivery, and aging-site-issue signals. It never derives schedule impact, cost impact, stock availability, or causal relationships. The calm remainder appears only when at least one loaded project has a deterministic zero-attention summary and no detected item beyond the priority item is omitted from those lines; the zero-attention state uses two concise lines.

## Provider-independent behavior

When OpenAI is not configured, the System area shows “Advanced AI analysis — Not configured” and “Operational monitoring — Available.” The PM Agent reports advanced analysis unavailable; Planning Monitor and Materials Monitor report rule-based monitoring active. No LLM agent is labeled working unless an actual running provider-backed run names that agent.

## Future provider enhancement

A future Blaze-enabled staging environment may enrich deterministic signals with validated provider analysis. Such output must remain separately labeled, schema-validated, read-only in the browser, evidence-grounded, and isolated behind the existing `/ai` service-write boundary.
