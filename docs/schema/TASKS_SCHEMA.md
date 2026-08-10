# ACPM Tasks v1

Status: RC1 IMPLEMENTED - PM/APM WORKFLOW AND PMOS ADAPTER VERIFIED

## Purpose

Tasks are project-owned operational records. ACPM Office and PMOS Field use the
same canonical task record; PMOS does not create a second business record.

## Canonical Paths

```text
projects/{projectId}/tasks/{taskId}
projects/{projectId}/taskEvents/{eventId}
projects/{projectId}/activity/{activityId}
```

`tasks` stores current state. `taskEvents` and `activity` are append-only
history feeds used by the task timeline, Mission Board, notifications, and
future reports.

## Lifecycle

```text
pending
  -> in_progress
  -> blocked
  -> in_progress
  -> for_verification
  -> completed

pending | in_progress | blocked | for_verification
  -> cancelled
```

- APM manages execution and submits work for verification.
- Boss, Owner, Admin, or PM verifies and completes work.
- Completed and cancelled tasks are terminal. Recurring work creates a new
  task rather than reopening historical work.
- Legacy values such as `open`, `done`, and `archived` are normalized at the
  application boundary.

## Task Record

```text
id
projectId
title
description
assignedToUid
assignedToName
performedByName
priority
category
startDate
dueDate
status
progress
verificationAuthority
completionNote
completionProof
comments
attachments
linkedProcurement
linkedIssues
budgetImpact
source
createdAt
createdBy
createdByName
updatedAt
updatedBy
updatedByName
```

Lifecycle transitions add their own timestamps and actors, including
`startedAt`, `submittedForVerificationAt`, `verifiedAt`, `completedAt`, and
`cancelledAt` when applicable.

## Write Strategy

Task creation and lifecycle transitions use one multi-location Firebase update
for the task, task event, and project activity row. Generic task edits cannot
write lifecycle status or `completedAt`; they must use the transition helper.

## Listeners

- ACPM Office attaches one tracked listener to
  `projects/{projectId}/tasks`.
- PMOS uses the canonical adapter and removes the previous project listeners
  before a project switch.
- Workspace exit, project switch, and logout call the module cleanup paths.

## Role Model

- Boss / Owner / Admin: company-wide review and completion.
- PM: company-wide project visibility, task review, and completion.
- APM: assigned-project task execution and submission for verification.
- Foreman / Safety / Viewer: disabled for RC1.

## Known Limitations

- Realtime Database rules enforce active roles and project assignment, while
  the PM-only completion transition is also enforced in application services.
  A future child-level write model should enforce every task transition at the
  database layer before external field accounts are introduced.
- Attachments use existing project/PMOS upload mechanisms. Firebase Storage is
  not required for RC1.
- Recurring scheduling is represented by creating a new task; there is no
  automatic recurrence scheduler in RC1.
