# ACPM Production Pilot RC1

Audit date: 2026-08-30

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

Production fails closed before deliberate pilot activation:

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
