# QA: Deterministic AI Pipeline

## Scope

This verifies the Phase 3 internal pipeline using explicit targets,
deterministic detectors, restricted stores, and `FakeProvider`. It does not
deploy a scheduler, call a real provider, expose UI, or mutate business data.

## Safety invariants

- Global defaults remain `enabled=false`, `generationEnabled=false`,
  `uiEnabled=false`, and `dryRun=true`; every event flag is false.
- Target defaults are disabled with null activation and scan flags false. No
  Production target is seeded.
- The service cannot read/list `/projects`; it reads approved child collections
  only for a caller-supplied, enrolled project ID.
- All AI writes stay below the explicit `/ai` collections.
- Browser writes, APM access, supplier reads, and unknown `/ai` children remain
  denied.
- Context is field-allowlisted. Raw project snapshots and payroll, billing,
  payment, bank, private-user, and supplier-account fields are absent.
- Unsupported evidence or numeric schedule/cost claims fail closed.

## Automated commands

From the repository root:

```powershell
Set-Location functions
npm.cmd run typecheck
npm.cmd test
Set-Location ..
node scripts/ai_security_static_qa.js
```

Run the AI rules suite through the Realtime Database emulator:

```powershell
npx.cmd firebase-tools emulators:exec --only database --config firebase.emulator.json --project acpm-ai-security-test "npx.cmd vitest run tests/pmos/rules-ai-security.test.ts"
```

Also run existing rules suites, PMOS core, payroll/labor, every static QA
script, and the Office/PMOS Playwright regression suite.

## Required proof

Automated coverage includes:

- service target access/schema, browser write denial, APM denial, disabled
  targets, and activation-time suppression;
- overdue/terminal tasks, low/missing-threshold stock, fresh/historical issues,
  PMOS root/fallback deduplication, and missing expected-delivery dates;
- condition open/stable/resolve/recurrence and repeated/concurrent claims;
- context allowlists, sensitive-field exclusion, prompt-like text as data, and
  no supplier access;
- exact routing and PM-last execution;
- fake valid, unknown, invalid, timeout, transient, and permanent scenarios;
- accepted/rejected evidence and rejected unsupported schedule/cost numbers;
- event-to-run-to-findings-to-recommendation flow, conditional open decisions,
  failure isolation, and unchanged source objects;
- zero provider calls when disabled and audit-only dry-run behavior.

## Dry-run acceptance

With `dryRun=true`, validated runs/findings may be stored and the event/run may
complete. No recommendation or decision may exist. With generation disabled,
there is no provider call or run/finding/recommendation/decision. Explicit
reconciliation may run only when global AI and the target/event scan flags are
enabled because detection itself is deterministic.

## Failure acceptance

Timeouts, provider errors, invalid JSON-like values, schema failures, bad
evidence, and unsupported numeric impacts leave no recommendation or decision.
Only sanitized status and safe errors may be stored under `/ai`. Office/PMOS
source objects must compare equal before and after processing.

## Deferred checks

Real-provider credentials/network behavior, deployed scheduling, UI display,
browser decision resolution, and business actions are not testable because
those capabilities deliberately do not exist in Phase 3.
