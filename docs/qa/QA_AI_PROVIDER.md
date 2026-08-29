# QA: Staging OpenAI Provider

## Scope

This verifies the staging-only OpenAI structured provider adapter and guarded
manual dry-run runtime. It does not authorize Production AI, UI, supplier
access, browser decisions, recommendations during dry-run, or business writes.

Reviewed versions and aliases:

```text
openai SDK: 7.8.0
firebase-functions SDK: 7.3.2
analysis -> gpt-5.6-luna
synthesis -> gpt-5.6-luna
materials prompt -> materials-v1
planning prompt -> planning-v1
pm prompt -> pm-v1
```

The Responses API request uses strict structured output, `store=false`, no
tools, timeout, and idempotency key. Local Zod, evidence, grounding, and
numeric-claim validation still run after provider parsing.

## Local gates

```powershell
npm.cmd --prefix functions run typecheck
npm.cmd --prefix functions run build
npm.cmd --prefix functions test
node scripts/ai_security_static_qa.js
node scripts/environment_static_qa.js
```

Mocked OpenAI tests must prove valid/unknown output, prompt-injection text as
data, missing/malformed output, timeout, HTTP 429/500, authentication and bad
request failures, bounded retry, schema mismatch, invalid evidence,
unsupported schedule/cost numbers, no Firebase access in the adapter, and no
secret/error leakage. Existing FakeProvider tests must remain green.

Run the unchanged AI and existing rules emulator suites plus PMOS core,
payroll/labor, local static gates, and Office/PMOS Playwright regression before
any staging deployment.

## Deployment guard

The default staging deploy excludes AI Functions. After every local gate is
green and the staging project supports Functions and Secret Manager:

```powershell
firebase.cmd functions:secrets:set OPENAI_API_KEY --project acpm-project-system-qa
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-staging.ps1 -IncludeAiProvider
```

Never pass the key on a command line, print it, store it in RTDB, or add it to
an environment file. Enter it only through the Firebase CLI secret prompt.
Production deploy scripts must continue excluding Functions, and no Production
secret may be configured.

## Manual staging dry-run prerequisites

- runtime project is exactly `acpm-project-system-qa`;
- caller is authenticated, App Check-valid, and has a management custom claim;
- AI config is valid with `enabled=true`, `generationEnabled=true`,
  `uiEnabled=false`, and `dryRun=true`;
- explicit QA `projectId` is enrolled/enabled with `activationAt`;
- explicit deterministic `eventId` is queued, belongs to that QA project, and
  has no prior run;
- QA data is synthetic and contains no payroll, billing, user, supplier,
  payment, bank, or account data.

The local fixture `ai-provider-staging-qa-v1` covers a synthetic overdue task,
low stock, and site issue while schedule and cost impacts remain unsupported.
Its tests clean all fixture state automatically. Do not create the remote
fixture until the secret/runtime prerequisites are met; live cleanup must run
immediately after evidence capture.

## Acceptance

A successful live dry-run may create or update only:

```text
ai/events/{eventId}
ai/runs/{runId}
ai/findings/{runId}/{agentId}
ai/runtimeStatus
```

It must create no recommendation or decision and mutate no project record.
Every finding must pass local validation, use only context evidence, and keep
unsupported schedule/cost values unknown.

## Current live status

`LIVE PROVIDER QA: BLOCKED`

The staging project cannot currently enable Secret Manager because it is not
on the required billing plan. Therefore `OPENAI_API_KEY` is not configured,
the Function is not deployed, no remote fixture or AI records were created,
and no live OpenAI call occurred. This is an external prerequisite failure,
not a simulated success.
