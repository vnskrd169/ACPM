# ACPM Tasks v1 QA

Status: PASS LOCAL AUTOMATED QA - LIVE PILOT MONITORING REQUIRED

## Workflow Checklist

- [x] New Office task is written to the canonical project task path.
- [x] PMOS-created task writes the same canonical schema.
- [x] Pending task can start.
- [x] In-progress task can be blocked and resumed.
- [x] APM can submit work for verification.
- [x] APM cannot directly complete a task through the task service.
- [x] PM/Admin can verify and complete submitted work.
- [x] Completed and cancelled work remains historical.
- [x] Completed work is excluded from Mission Board Pending Works.
- [x] Generic PMOS edits cannot bypass lifecycle verification.
- [x] Task creation and transitions create task event and activity rows.
- [x] Project switch and logout remove tracked task listeners.
- [x] Workspace refresh preserves `projectId` and reloads Tasks/Mission Board.

## Automated Evidence

```text
node scripts/pm_apm_task_workflow_static_qa.js
PASS

firebase emulators:exec --only database --config firebase.emulator.json \
  --project acpm-production-rules-test "npm.cmd run test:production:rules"
13/13 PASS

npx playwright test
24/24 PASS
```

The browser suite covers PM company-wide visibility, APM assigned-project
visibility, workspace refresh, PMOS field submissions, Office review views,
offline queue behavior, viewer denial, mobile width, and logout cleanup.

## Result

PASS:

- Canonical path and lifecycle are consistent between ACPM Office and PMOS.
- PM verification is required before completion.
- Listener cleanup and project refresh behavior pass browser/static QA.
- Production role rules pass Firebase emulator and Firebase CLI syntax checks.

WARNING:

- The final proof is a controlled live-project pilot with real PM/APM timing,
  intermittent mobile data, and actual completion photos.
- Rules deployed to Staging and Production on 2026-08-10 via the guarded
  release paths; the emulator suite verifies them against the exact
  `database.rules.json` that ships.

FAILED:

- None in the current automated release gate.

## Known Limitations

- No automatic recurring-task scheduler.
- No external Foreman/Safety/Viewer task access in RC1.
- Browser push is outside the current notification scope.

## Child-Level Transition Rules (added)

`database.rules.json` now enforces the canonical task lifecycle at the database
layer (not just the app layer):

- Status must be a canonical value (`pending`, `in_progress`, `blocked`,
  `for_verification`, `completed`, `cancelled`) or a known legacy alias that
  the app normalizes on read.
- Only valid transitions are writable:
  `pending -> in_progress|cancelled`, `in_progress -> blocked|for_verification|
  cancelled`, `blocked -> in_progress|cancelled`, `for_verification ->
  completed|in_progress|blocked|cancelled`.
- Only Boss/Owner/Admin/PM may write a completion status (`completed`, `done`,
  `closed` or case variants); APM completion is denied even on a direct write.
- `createdBy` and `createdAt` are immutable after creation.
- Completed/cancelled tasks are terminal; no transition can leave them.

Verified by `tests/pmos/rules-tasks.test.ts` (22/22 PASS under the database
emulator) and by the strengthened `pm_apm_task_workflow_static_qa` gate.

## Live Staging Verification (deployed rules)

Deployed 2026-08-10 to Staging `acpm-project-system-qa` via the guarded
`npm.cmd run deploy:staging` path. The deployed task `.validate` was fetched
from the live RTDB and confirmed byte-identical to local
`database.rules.json`; anonymous task writes and project reads return
`401 Permission denied`.

`scripts/staging_rules_tasks_live_qa.js` provisions ephemeral PM/APM accounts
in the Staging Auth project, seeds roles via console access, and exercises the
**deployed** rules end-to-end — **12/12 PASS**:

- APM allowed: create `pending`, `pending -> in_progress`,
  `in_progress -> for_verification`.
- APM denied: `for_verification -> completed` (PM gate), fresh create as
  `completed`, `pending -> completed` skip, mutate `createdBy`.
- PM allowed: `for_verification -> completed`, fresh create as `completed`.
- PM denied: `completed -> pending` reverse, mutate `createdAt`.

Run with a Firebase CLI login that can access `acpm-project-system-qa`:

```powershell
node scripts/staging_rules_tasks_live_qa.js
```

The script deletes the test project, user records, and Auth accounts on exit
(verified no `rulesqa-*` residue remains).

Deliberate boundary: the state machine runs when a task already exists. On
create, the transition order is not enforced (any non-completion status in the
vocabulary may be used) and the app itself always creates tasks as `pending`;
metadata edits on terminal tasks are likewise allowed at the rules layer while
the app layer blocks them. None of these bypasses PM completion because the
verifier-role gate applies to every write, completion alias included.
