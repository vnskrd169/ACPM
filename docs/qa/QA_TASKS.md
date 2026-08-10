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
- Database rules do not yet implement a child-level transition state machine;
  active internal users are trusted within their assigned project.

FAILED:

- None in the current automated release gate.

## Known Limitations

- No automatic recurring-task scheduler.
- No external Foreman/Safety/Viewer task access in RC1.
- Browser push is outside the current notification scope.
