# QA: ACPM AI Command Center UI

Status: Phase 5 read-only implementation

## Scope and safety boundary

The Command Center is a company-level ACPM Office view on `dashboard.html` and
`workspace.html`. It presents sanitized AI runtime health, bounded run history,
validated findings, recommendations, and open human decisions. It does not
resolve decisions, acknowledge or dismiss recommendations, call a provider, or
write any Firebase record.

The browser feature gate is only `/ai/uiStatus`. The gate fails closed when the
record is missing, invalid, unreadable, or has `uiEnabled !== true`. No AI output
listener is started in that state, and the browser never falls back to
`/ai/config`.

Eligible profiles are active `boss`, `owner`, `admin`, and `pm` users. APM,
inactive, anonymous, and unknown-role users receive no navigation entry and no
AI output subscriptions. `/ai/config` remains denied to PM.

## Read model

When the view opens, it uses bounded listeners for these previously reviewed
sanitized output nodes:

- `/ai/runtimeStatus`
- `/ai/runs` (latest 100 by `createdAt`)
- `/ai/events` (latest 100 by `createdAt`)
- `/ai/findings` (latest 60 keys)
- `/ai/recommendations` (latest 100 by `createdAt`)
- `/ai/decisions` (latest 100 by `createdAt`)

Leaving the view, logout, account change, failed reinitialization, and explicit
cleanup all detach the listeners. Reopening starts one fresh listener set.
Evidence references are rendered as escaped plain text (`path/recordId` and
`field`); the browser never reads the referenced path. Project labels reuse
project metadata already present in Office and otherwise use `Project <id>`.

## Presentation rules

- Logical agents are Working only while a current `running` run includes their
  agent ID. Otherwise a ready system shows Idle.
- Disabled, unavailable, not-configured, and degraded states use the sanitized
  system status rather than inference from private config.
- The review queue includes only open decisions and sorts by linked
  recommendation severity, then age.
- Impact states are Unknown, None, Possible, or Confirmed. Numeric days/currency
  appear only for Possible or Confirmed values that are finite and non-null.
- Provider errors use an allowlist of friendly labels. Prompts, chain of thought,
  raw provider responses, model/API identifiers, credentials, and internal error
  payloads are never rendered.
- Decision detail is informational. It contains no approve, reject, resolve,
  acknowledge, dismiss, or business-mutation action.

## Deterministic fixture scenarios

`tests/e2e/ai-command-center-fixtures.ts` supplies synthetic local-only records:

| Scenario | State |
| --- | --- |
| A | Healthy, no issues |
| B | Active PM, Planning, and Materials runs |
| C | One open recommendation |
| D | Two open Waiting On You decisions |
| E | Unknown cost and schedule, with hostile zero values suppressed |
| F | Critical grounded recommendation with validated numeric impacts |
| G | Provider degraded |
| H | AI disabled |

No production records or credentials are used.

## Automated verification

Run from the repository root:

```powershell
npm run test:ai:ui:static
npx playwright test tests/e2e/ai-command-center.spec.ts
npm run test:ai:static
npm run test:ai:rules
```

The dedicated Playwright file contains the required 22 cases: feature and role
gating, summary/queue/recommendation rendering, conservative impact display,
runtime and activity states, escaped evidence, read-only review, lifecycle
detach/logout, dashboard and workspace navigation, mobile layout, failure
isolation, and PM `/ai/config` isolation.

Before release, also run the existing Office/PMOS Playwright suite, AI unit and
type checks, focused emulator security suite, full PMOS/rules/payroll regression,
and repository static gates. This phase does not deploy or enable Production AI.

Phase 5 verification on 2026-08-29:

- AI Command Center Playwright: 22 passed
- Full Office/PMOS Playwright: 54 passed (22 new + 32 existing)
- AI unit tests: 80 passed; AI type-check passed
- Focused AI rules emulator: 16 passed
- Full PMOS/rules/payroll database + storage emulator: 176 passed, 4 intentionally skipped
- AI security static QA: passed
- AI Command Center static QA: 17 gates passed
- PWA cache, RC1, and responsive layout static gates: passed
- Anonymous local browser smoke: redirected to login with no Command Center and no console errors

## Manual smoke checklist

- Confirm the navigation entry is beside Office command actions, not a project
  workspace tab.
- Confirm Back restores the exact originating dashboard/workspace view.
- Confirm empty, degraded, stale, unavailable, and partial-read-failure messages
  are clear and do not obstruct existing Office controls.
- Confirm narrow mobile layout has no horizontal overflow and cards form a
  single readable column.
- Confirm browser network/database diagnostics contain no `/ai/config` read,
  arbitrary evidence read, provider request, or `/ai` write.
