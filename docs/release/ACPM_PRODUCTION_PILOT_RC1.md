# ACPM Production Pilot RC1

Audit date: 2026-09-01

## Pilot decision

ACPM Production Pilot RC1 is an internal company release. Hosting, reviewed
Realtime Database rules, Office/PMOS, APM Workspace, and the deterministic
zero-budget Command Center are release candidates. Cloud Functions and the
write-capable Human Decision and Action Draft workflows are deferred.

This split is intentional: the core pilot does not need OpenAI or Cloud
Functions, while the callables must not be deployed around billing or App
Check limitations.

## Supported pilot workflows

### Available without Functions

- ACPM Office and existing business workflows
- PMOS
- APM Workspace vNext
- deterministic Needs Action
- deterministic Daily Brief
- project attention and navigation
- provider-off Command Center status
- read-only historical AI recommendations, decisions, and drafts when valid
  records already exist

### Requires Functions

- submitting choose, defer, or dismiss on a Human Decision
- deterministic Action Draft creation after a structured chosen decision
- reviewing or cancelling an Action Draft
- the Staging-only OpenAI dry run

On 2026-08-30, the Cloud Billing API reported billing disabled for both ACPM
Firebase projects. Firebase Functions therefore cannot deploy. In addition,
the browser write callables do not yet enforce App Check, so their deployment
must remain deferred even if billing is enabled first.

## Role matrix

| Capability | Boss / Owner / Admin | PM | APM |
| --- | --- | --- | --- |
| Office/PMOS | Existing permissions | Existing permissions | Existing permissions |
| APM Workspace | Existing role behavior | Existing role behavior | Yes |
| AI Command Center | Yes | Yes | No |
| Human Decisions | Yes when Functions are safe | Yes when Functions are safe | No |
| Action Drafts | Yes when Functions are safe | Yes when Functions are safe | No |
| `/ai/config` | Yes | No | No |

All entries also require an active Firebase-authenticated ACPM profile. Pilot
convenience does not broaden APM or inactive-user access.

## Provider and App Check status

Real OpenAI is deferred. Production has no provider configuration or approved
secret, generation defaults off, the provider SDK is server-only, and there is
no scheduler.

**APP CHECK: BLOCKED**

The exact prerequisite is documented in
`docs/release/AI_COMMAND_CENTER_RC1.md`: separate Staging/Production reCAPTCHA
Enterprise Web keys and Firebase registrations, a reviewed current Web App
Check SDK initialization, supported debug tokens for local/CI, Staging metrics,
then `enforceAppCheck: true` on both write callables and a full release gate.
Firebase Auth and live server-side role/status verification remain mandatory.

## Production default and data safety

Before deliberate pilot activation, Production fails closed with these
defaults:

- `enabled = false`
- `generationEnabled = false`
- `uiEnabled = false`
- no provider call, scheduled scan, or autonomous execution
- no AI business-record mutation

Missing `/ai` nodes are valid and do not prevent existing ACPM from loading.
Deployment does not seed QA data, copy Staging data, create projects, or rewrite
project, payroll, labor, attendance, material, or financial records. The
Staging smoke must use Staging-only test data. Production smoke is read-only
except for normal, explicitly approved pilot operations after validation.

## Release prerequisites

Before Production:

1. Release gate passes on the exact commit.
2. Worktree is clean and the reviewed branch is pushed through the normal
   review process.
3. A current Production RTDB export/backup exists.
4. The short Staging smoke passes for the same source state.
5. Deployment operator has confirmed the explicit Production target.
6. No Functions deployment is included.

## Short Staging smoke

Deploy rules and Hosting with `npm.cmd run deploy:staging`, then check:

1. Login and logout.
2. APM Home and assigned projects.
3. Attendance date view and existing records.
4. Tasks and Materials navigation.
5. PMOS project load.
6. AI Command Center visibility for an authorized management role and denial
   for APM.
7. Deterministic Daily Brief and Needs Action navigation with provider-off
   status.
8. Confirm Human Decision and Action Draft write controls are treated as
   unavailable because Functions are not deployed.

Do not run provider generation, create fake Production data, or turn this into
another Staging development cycle.

## Guarded Production deployment order

1. Push the reviewed branch only after explicit authorization. This readiness
   task does not push.
2. Record the exact commit SHA and take the Production RTDB backup.
3. Publish reviewed RTDB rules only:

   ```powershell
   .\scripts\deploy-production.ps1 -ConfirmProduction -DatabaseOnly
   ```

4. Deploy the exact Hosting/static candidate:

   ```powershell
   .\scripts\deploy-production.ps1 -ConfirmProduction
   ```

5. Do not deploy Functions. A later reviewed release must satisfy billing and
   App Check prerequisites and intentionally update the deployment guard.
6. Verify Production login and confirm existing projects still load.
7. Run a non-destructive Boss/Admin/PM/APM smoke against existing authorized
   records.
8. Deliberately enable only the zero-budget pilot UI, if approved, through a
   trusted Firebase administrative path by creating `/ai/uiStatus` with exactly
   `schemaVersion: "0.1"`, `uiEnabled: true`,
   `systemStatus: "not_configured"`, and a current non-negative integer
   `updatedAt`. Leave processing and generation disabled.
9. Monitor authentication errors, permission denials, console errors, and
   unexpected navigation during first internal use.

The Production script is pinned to `acpm-project-system`, requires
`-ConfirmProduction`, rejects conflicting database switches, and has no
Functions target. `.firebaserc` has no default project alias.

## Production deployment record

Production Pilot RC1 was deployed on 2026-08-30 at 21:52 PHT
(2026-08-30T13:52:46Z) from
`origin/feature/acpm-ai-command-center`.

- Reviewed application commit: `2ee29817eea52ff73a27073abd8d075eb37982b1`
- Hosting safety amendment: `c2abc77787bbd8ca7103e2e1b3ef66afa52c6134`
- Production project: `acpm-project-system`
- Production URL: `https://acpm-project-system.web.app`
- Deployed: Production Hosting, Office/APM Workspace assets, PMOS assets,
  zero-budget Command Center assets, PWA cache `acpm-v147`, and reviewed RTDB
  rules/indexes
- Withheld: all Cloud Functions/callables, Human Decision mutations, Action
  Draft mutations, Staging OpenAI dry run, provider secret/configuration,
  Secret Manager changes, Cloud Scheduler, and real provider activation

The live smoke found that the prior wildcard Hosting ignore did not exclude
root repository/tool directories. The first Hosting release exposed root
`.git` and `.vscode` files. Pilot activation was held, explicit exclusions and
a static gate were added in the Hosting safety amendment, and Hosting was
immediately redeployed. The corrected release contains 163 intended files;
probes for `.git`, `.firebase`, `.vscode`, development shell, and test paths
all return 404. No exposed credential or provider secret was identified.

| Check | Result |
| --- | --- |
| Git branch push | PASS |
| Production Hosting | PASS |
| Production RTDB rules | PASS |
| Login and anonymous protected-route redirect | PASS |
| Dashboard/workspace/PMOS/APM/AI/PWA asset integrity | PASS; live bytes match the reviewed local files and use `no-cache` |
| Service worker | PASS; live `sw.js` is the reviewed `acpm-v147` asset and the browser reported no console errors |
| Existing project data | PASS; read-only shallow verification found the existing projects node with 80 keys |
| APM Workspace role smoke | NOT LIVE VERIFIED; no legitimate Production smoke account was available |
| PMOS authenticated role smoke | NOT LIVE VERIFIED; no legitimate Production smoke account was available |
| Zero-budget Command Center | HIDDEN; `/ai/uiStatus`, `/ai/config`, and `/ai/runtimeStatus` are absent |
| Human Decision mutation | DISABLED; Functions/App Check unavailable |
| Action Draft mutation | DISABLED; Functions/App Check unavailable |
| Real OpenAI | NOT CONFIGURED / DEFERRED |
| Browser console | NONE observed on the public login and anonymous protected-route smoke |

The deployed RTDB rules are an exact canonical match for
`database.rules.json` (SHA-256
`50e2f1921d1dd49f8d15fd947271505bd7793df1299cb51afbd0178598dce572`).
This preserves anonymous-write denial, AI browser-write denial, existing
business permissions, and unchanged APM permissions. Role-specific live reads
remain intentionally unclaimed because no Production account was available.

For the 2026-08-30 deployment, no `/ai` record was seeded. The Command Center
therefore remained hidden and fail closed. Generative processing remained
disabled, there was no deployed callable or scheduler, and autonomous
execution remained impossible. That smoke created no synthetic records and
intentionally modified no business data.

## AI Command Center V2 Production release

AI Command Center V2 was released on 2026-09-01 at 11:33 PHT
(2026-09-01T03:33:00Z) from
`origin/feature/ai-command-center-v2`.

- V2 source and deployed commit:
  `2dbc246bc5b572b11520c8420d45e7ba0f85e113`
- Release ref: `feature/ai-command-center-v2`
- Production project: `acpm-project-system`
- Production URL: `https://acpm-project-system.web.app`
- Hosting: PASS; 164 intended files released with PWA cache `acpm-v150` and
  `ai-command-center.js?v=9`
- RTDB rules: UNCHANGED; the reviewed V2 branch contains no rules difference
  from the existing Production release. Current reviewed rules SHA-256 is
  `43047db388775fd535e2c8aaf541b22a8d5aa435b22907b35017a8fa1f404843`.
- Command Center activation: ACTIVE through the authenticated Firebase
  administrative CLI path. `/ai/uiStatus` contains exactly schema version
  `0.1`, `uiEnabled: true`, `systemStatus: not_configured`, and integer
  `updatedAt: 1788233669136`.
- `/ai/config`: absent. Processing and generation retain fail-closed defaults.
- Functions: NOT DEPLOYED.
- App Check: NOT CONFIGURED.
- Provider/OpenAI: NOT CONFIGURED; observed OpenAI calls: ZERO.

The release gate passed with 112 root unit tests, 101 Functions tests,
Functions type-check, 220 Database/Storage emulator tests with four intentional
Storage-runtime skips, all static QA and deployment guards, 91 tracked
JavaScript syntax checks, and dependency audits with no high/critical
vulnerabilities. Full Playwright produced 119 immediate passes and identified
three stale V2 test expectations; those expectations were corrected and all
four affected interaction/history checks passed. No release-gate application
failure remained.

Public Production smoke passed: Hosting redirected safely to login, the V2
HTML/JS/CSS/PWA assets returned 200, `sw.js` exposed the reviewed `acpm-v150`
shell, `.git`, `.firebase`, `.vscode`, and `test-results` probes returned 404,
and no fatal browser console error was observed. No legitimate authenticated
Production session was available, so APM Workspace, PMOS, management Command
Center, Ask, AI Team, and real-data views are **DEPLOYED / NOT LIVE VERIFIED**.
No account or fixture was created for smoke testing.

Production now renders legitimate Human Decision and Action Draft history as
read-only. Submit, defer, dismiss, review, and cancel mutation controls are
absent in Production and are guarded again at their JavaScript submission
entrypoints. APM access remains denied, browser `/ai` writes remain denied, and
Ask remains deterministic, snapshot-based, read-only, and unable to convert a
question into a path, provider call, draft, decision, or business mutation.

Before release, a current full RTDB restore export was saved outside the
repository as `acpm-project-system-rtdb-20260901-113233.json`. Rollback is
ready: set the sanitized projection's `uiEnabled` to false through the same
trusted administrative path, keep processing/generation disabled, and roll
Hosting back independently. No synthetic Production data was created and no
business record was intentionally modified.

## Rollback

1. Immediately set `/ai/uiStatus/uiEnabled` to `false` through a trusted
   administrative path.
2. Ensure `/ai/config/enabled` and `/ai/config/generationEnabled` are `false`
   if config exists.
3. Roll Hosting back from Firebase Hosting release history, or check out the
   last known-good reviewed commit and redeploy it with
   `.\scripts\deploy-production.ps1 -ConfirmProduction`.
4. If rules caused a regression, publish the last reviewed rules file with the
   confirmed `-DatabaseOnly` path after security review.
5. Leave `/ai` history and all existing ACPM business records untouched.

AI can be hidden and disabled independently; Office, PMOS, APM Workspace, and
existing business data do not depend on it.

## Known limitations

- Production Functions: blocked by disabled billing and incomplete App Check.
- Human Decision writes: deferred with Functions.
- Action Draft creation/review/cancel: deferred with Functions.
- Real OpenAI: deferred and not required for the pilot.
- Zero-budget Command Center activation requires a deliberate sanitized
  `uiStatus` projection; absent state remains safely hidden.
- The Functions audit has no high/critical issue but retains seven moderate
  transitive `uuid` advisories in the latest Firebase Admin storage chain; the
  offered forced fix is a breaking Firebase Admin downgrade. This does not ship
  in Hosting, and Functions remain deferred.
- No scheduled AI scan or autonomous business execution exists.
