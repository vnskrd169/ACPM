# AI Command Center RC1

Audit date: 2026-08-30

## Release decision

The zero-budget AI Command Center is ready for a Staging Hosting and Realtime
Database rules release candidate. AI Cloud Functions are not ready to deploy.
The existing Staging deployment command therefore deploys only Hosting and
rules, and its legacy `-IncludeAiProvider` option now stops with the exact
prerequisite instead of exposing partially protected callables.

Production Hosting may receive dormant code after the release gate and normal
review. Full AI workflow activation remains blocked by Cloud Functions billing
and Web App Check. Existing ACPM continues to work when `/ai` is absent.

## RC1 scope

RC1 contains deterministic Needs Action detection, project attention,
deterministic Daily Brief, read-only provider output, Waiting On You decisions,
human decision capture, and controlled action drafts with review or cancel.
It adds no autonomous execution and no task, purchase-order, delivery,
schedule, supplier-message, billing, payment, payroll, attendance, or other
business-record mutation.

### Feature matrix

| Feature | Zero-budget | Real AI required |
| --- | --- | --- |
| Needs Action | YES | NO |
| Daily Brief | YES | NO |
| Project Attention | YES | NO |
| Waiting On You | YES* | NO* |
| Human Decision | YES | NO |
| Action Draft | YES | NO |
| Advanced AI analysis | NO | YES |
| LLM synthesis | NO | YES |
| Autonomous execution | NO | NOT SUPPORTED |

`*` Waiting On You is populated only when valid decision records are present.
Creating or changing those records requires the server workflow described
below; deterministic browser detection never invents decision records.

## Zero-budget and provider-dependent behavior

Needs Action, the Daily Brief, project attention, and project navigation are
derived in the browser from already-authorized project snapshots. They add no
new database read and make no write. Deterministic text is labeled
`Rule-based · no AI generation`; provider output remains separately labeled.

OpenAI is used only by the server-side, Staging-only manual dry-run callable.
When generation is disabled, that path fails closed before a provider call.
No OpenAI key or SDK is shipped to the browser. A missing `OPENAI_API_KEY` is
non-fatal to Hosting, deterministic monitoring, Office, PMOS, or APM Workspace.
There is no scheduled AI Function.

## Role access

| Surface | Boss / Owner / Admin | PM | APM | Inactive / anonymous |
| --- | --- | --- | --- | --- |
| AI Command Center and sanitized `/ai/uiStatus` | Yes | Yes | No | No |
| `/ai/config` | Yes | No | No | No |
| Provider output and decision/draft reads | Yes | Yes | No | No |
| Human decision callable | Active only | Active only | No | No |
| Action draft review/cancel callable | Active only | Active only | No | No |
| APM Workspace | Existing role behavior | Existing role behavior | Yes | No |

Browser visibility is not an authorization boundary. RTDB rules and callable
code independently validate the active profile and normalized role. APM access
to AI remains intentionally denied.

## Callable security review

| Callable | Auth and role | App Check | Capacity | Release state |
| --- | --- | --- | --- | --- |
| `stagingManualAiDryRun` | Firebase Auth; boss/owner/admin; Staging project guard | Enforced | 1 instance, concurrency 1 | Dormant; provider and billing prerequisites not met |
| `submitAiDecision` | Firebase Auth; live active boss/owner/admin/PM profile | Not enforced | 5 instances, concurrency 10 | Deployment blocked |
| `reviewAiActionDraft` | Firebase Auth; live active boss/owner/admin/PM profile | Not enforced | 5 instances, concurrency 10 | Deployment blocked |

The write callables strictly validate IDs, timestamps, action enums, selected
stored options, note lengths, record schemas, and cross-record relationships.
They use RTDB transactions, stable submission IDs, idempotent replay checks,
immutable final states, and safe public error codes. Their restricted database
identity can write only allowlisted `/ai` paths. Instance and concurrency caps
bound platform capacity; they do not replace App Check.

## App Check status

**APP CHECK: BLOCKED**

Activation is unsafe today because ACPM has no registered Web App Check
attestation keys and no browser App Check initialization. Enforcing App Check
on the two browser write callables now would reject legitimate users.

Exact prerequisite:

1. Enable the reCAPTCHA Enterprise API in both Firebase projects.
2. Create separate Web score-based keys for the Staging and Production domains;
   do not place localhost on the Production key.
3. Register each ACPM Web app and its key under Firebase App Check.
4. Add a current supported Firebase Web App Check SDK and initialize it before
   any callable use. ACPM currently loads Firebase Web SDK 8.10.1, so this must
   include a reviewed compat/modular SDK upgrade and regression pass.
5. Configure supported App Check debug tokens for localhost, emulator, CI, and
   Playwright rather than weakening enforcement.
6. Observe App Check metrics in Staging, then change both browser write
   callables to `enforceAppCheck: true` and rerun the full gate.
7. Remove the Staging Functions deployment block only in that reviewed change.
   Consider replay protection for the sensitive write calls only after its IAM
   and limited-use client-token prerequisites are validated.

App Check supplements Firebase Authentication and server-side authorization;
it never replaces them. See the Firebase documentation for
[App Check](https://firebase.google.com/docs/app-check),
[Web reCAPTCHA Enterprise setup](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider),
and [callable enforcement](https://firebase.google.com/docs/app-check/cloud-functions).

## Firebase plan status

An authenticated Cloud Billing API read on 2026-08-30 returned
`billingEnabled: false` for both `acpm-project-system` and
`acpm-project-system-qa`. Firebase Cloud Functions deployment requires the
Blaze plan. This blocks Human Decision, Action Draft creation/review, and the
Staging provider dry run; it does not block the deterministic Command Center,
Office, PMOS, APM Workspace, Hosting, or RTDB rules. Billing must be changed by
an authorized owner outside this codebase and should include budget alerts.
See [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

## `/ai` namespace and service boundary

The explicit namespace is `config`, `projectTargets`, `agents`,
`runtimeStatus`, `uiStatus`, `conditions`, `events`, `runs`, `findings`,
`recommendations`, `decisions`, `actionDrafts`, `actionDraftEvents`, and
`idempotency`. Decision audit events are append-only children at
`decisions/{decisionId}/history`; there is intentionally no separate
`decisionEvents` root.

Unknown `/ai` children fail closed. Browser writes are denied. Management reads
are bounded and indexed for the actual time-ordered queries on events, runs,
recommendations, decisions, action drafts, and action-draft events. The
`acpm-ai-service` identity may read only approved operational context and may
write only explicit `/ai` children. It cannot write projects, tasks, purchase
orders, deliveries, suppliers, users, notifications, audit logs, attendance,
change orders, billing, collections, payments, or payroll.

## Decision and action-draft semantics

A human decision records choose, defer, or dismiss against a stored open
decision. Choose and dismiss are final; defer keeps the decision open. A
structured chosen option may deterministically create a draft. A plain-text
option or an option without an action intent creates none.

Drafts allow only `follow_up_supplier`, `prepare_material_request`,
`prepare_task_update`, `prepare_site_follow_up`, and
`prepare_internal_note`. Review means `Reviewed — not executed`. Review and
cancel are final and historical. There is no execute state, adapter, outbound
message, approval, or business mutation.

## Default and migration safety

Code defaults are `enabled = false`, `generationEnabled = false`,
`uiEnabled = false`, and `dryRun = true`. Missing `/ai/config`,
`/ai/uiStatus`, `/ai/runtimeStatus`, or `/ai/projectTargets` fails closed:
the Command Center is hidden, generation cannot run, no scheduler runs, and
existing ACPM behavior is unchanged. Production does not need `/ai` seeded to
load existing projects or business modules.

## Environment isolation and release assets

Localhost selects Staging unless the existing explicit `?env=production`
override is used. Staging hosts are locked to `acpm-project-system-qa` and
Production hosts to `acpm-project-system`. `.firebaserc` has no default project.
Both Office shells use the same versioned JS/CSS set and `sw.js` cache
`acpm-v147`; the PWA gate verifies the cached asset list and stale-cache purge.

## Staging procedure

1. Confirm the reviewed commit and a clean worktree.
2. Run the repository release gate and review its evidence.
3. Deploy only rules and Hosting with `npm.cmd run deploy:staging`.
4. Do not pass `-IncludeAiProvider`; it intentionally fails while prerequisites
   are unmet.
5. Smoke login, Office, PMOS, APM Home, Attendance, Tasks, Materials, and the
   authorized Command Center.
6. If the zero-budget Command Center should be visible, an authorized Firebase
   administrator may deliberately create only the sanitized `/ai/uiStatus`
   projection with schema `0.1`, `uiEnabled: true`,
   `systemStatus: not_configured`, and a current integer `updatedAt`. Do not
   create fake decisions, projects, or provider output.
7. Verify Daily Brief and Needs Action are labeled deterministic. Treat callable
   controls as unavailable until Functions are deployed after all prerequisites.

## Production procedure

1. Promote only the exact reviewed Staging commit.
2. Back up Production RTDB before publishing changed rules.
3. Publish reviewed rules with
   `.\scripts\deploy-production.ps1 -ConfirmProduction -DatabaseOnly`.
4. Deploy Hosting with
   `.\scripts\deploy-production.ps1 -ConfirmProduction`.
5. Verify login and existing project loads before any AI activation.
6. Run a non-destructive role and zero-budget smoke test.
7. If approved for the internal pilot, create only the sanitized `uiStatus`
   projection described above. Leave `/ai/config` absent or disabled and leave
   generation disabled.
8. Do not deploy Production Functions in this RC. The guarded Production script
   contains no Functions target.

## Emergency disable and rollback

Use a trusted Firebase administrative path, never a browser editor:

- set `/ai/uiStatus/uiEnabled` to `false` to hide Command Center;
- set `/ai/config/enabled` to `false` to stop AI processing;
- set `/ai/config/generationEnabled` to `false` to stop provider generation.

If any AI node is malformed or absent, fail-closed behavior already hides or
disables it. Office, PMOS, APM Workspace, and business records remain usable.
For a Hosting regression, use Firebase Hosting release history to roll back or
redeploy the last known-good commit through the confirmed Production script.
Do not delete `/ai` history and do not restore or rewrite business records as
part of an AI rollback.

## Known limitations

- AI Functions are blocked by billing and App Check prerequisites.
- Human Decision and Action Draft write controls are unavailable until those
  Functions are safely deployed.
- Advanced analysis and LLM synthesis are not configured.
- Deterministic intelligence reflects only authorized project records already
  loaded in the browser and never claims undetected cost, stock, schedule, or
  causal impact.
- The Functions production audit has no high/critical finding but reports seven
  moderate transitive `uuid` advisories through the current latest
  `firebase-admin` storage chain. The offered forced fix downgrades
  `firebase-admin` across a breaking major; it is not applied. Functions remain
  undeployed, and the advisory must be rechecked before their later release.
- There is no scheduler and no autonomous execution.
