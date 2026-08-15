# ACPM Account Onboarding Schema

Status: RC1 account onboarding workflow

## Workflow

Signup / request access creates a Firebase Auth account and then writes `accessRequests/{uid}`. The request is not considered successful unless both steps succeed.

Admins approve from Admin > Requests. Approval creates or overwrites the operational profile at `users/{uid}` and keeps the original request as history. Team Admin reads approved users from `users/{uid}` only.

## Firebase Paths

### accessRequests/{uid}

Pending signup request and approval history.

Required fields:
- `uid`
- `email`
- `fullName`
- `position`
- `requestedAt`
- `status`: `pending | approved | rejected`
- `provider`: `password | google`
- `statusHistory/{eventId}`

Approval fields:
- `role`
- `assignedProjects`
- `approvedBy`
- `approvedByName`
- `approvedAt`

Rejection fields:
- `rejectedBy`
- `rejectedByName`
- `rejectedAt`
- `rejectionReason`

### users/{uid}

Approved operational profile.

Core fields:
- `uid`
- `displayName`
- `name`
- `email`
- `position`
- `role`
- `assignedProjects`
- `projects`
- `bossOf`
- `status`: `active | suspended | archived | disabled`
- `approvedBy`
- `approvedAt`
- `profileComplete`

Self-editable profile fields:
- `displayName`
- `name`
- `position`
- `mobile`
- `avatarUrl`
- `avatarPath`
- `signature`
- `profileComplete`

Admin-only fields:
- `role`
- `projects`
- `assignedProjects`
- `bossOf`
- `status`
- `permissions`
- `statusHistory`
- `suspendedAt` / `suspendedBy`
- `reactivatedAt` / `reactivatedBy`
- `archivedAt` / `archivedBy`

### Profile Photo Storage

RC1 stores small compressed profile avatars inline in `users/{uid}/avatarUrl` as a data URL, with `avatarPath` set to an `inline:{fileName}` marker and `avatarUpdatedAt` set to the save timestamp.

Profile photos are uploaded to Google Drive (full-access link) via the Apps Script transport; fallback stores a compressed inline avatar. Historical note — the former Firebase Storage path for larger user-uploaded profile images:

```text
profilePhotos/{uid}/{fileName}
```

Only the signed-in owner should write their own profile image. Authenticated users should read profile images. Switch to Storage only after Storage is created, rules deploy successfully, and profile-photo browser QA passes.

## Design Notes

The browser app must not enumerate Firebase Auth users. Firebase Auth is identity only; ACPM approval state lives in Realtime Database.

Do not hard-delete user profiles for normal operations. Use `suspended`, `archived`, or `disabled` so audit logs and historical records remain meaningful.

RC1 uses one primary role per user. Granular multi-role or per-module permissions are deferred until the permissions model is expanded.

Project access is stored in the rules-compatible map shape `users/{uid}/projects/{projectId}: true`. `assignedProjects[]` remains as a UI-friendly mirror for scanning and export. Readers must support both shapes for backward compatibility.

Suspended, disabled, and archived users cannot enter the app. Reactivation is an admin action that changes `status` back to `active` and appends a `statusHistory` row.
