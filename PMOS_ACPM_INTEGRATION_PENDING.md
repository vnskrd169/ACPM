# PMOS-ACPM Integration Pending

## Purpose

This document tracks PMOS features that require integration with the ACPM core system. These integrations must be reviewed and approved by the ACPM owner before production deployment.

## 1. Firebase Database Rules

**File**: `database.rules.json`

PMOS requires additional `.indexOn` declarations and write rule modifications for the following paths:
- `pmosUpdates` — added `clientGeneratedId` index
- `pmosSiteLogs` — added `clientGeneratedId` index
- `pmosIssues` — added `clientGeneratedId` index
- `pmosMaterialRequests` — added `clientGeneratedId` index
- `pmosTasks` — added `clientGeneratedId` index
- `pmosMeetingNotes` — added `clientGeneratedId` index
- `pmosPhotoLogs` — added `clientGeneratedId` index
- `projects/{pid}/{date}/` attendance path — added `clientGeneratedId` index

**Proposed isolated rules**: `database.rules.pmos-proposed.json`

**Action required**: Owner review and approval before deployment.

## 2. Firebase Storage Rules

PMOS requires Storage rules for `pmos/` and `pmos-face/` upload paths.

**Proposed isolated rules**: `storage.rules.pmos-proposed`

**Action required**: Owner review and approval before deployment.

## 3. Service Worker (sw.js)

PMOS adds:
- `PMOS_CACHE = 'pmos-cache-v2'` cache name
- `ASSETS` array with PMOS-specific files
- `skipWaiting` message handler
- Old cache cleanup (`acpm-pmos-v1`)

**Current status**: PMOS additions are isolated using PMOS-specific cache names and version checks. No core ACPM caching is modified.

**Action required**: Owner review to confirm no service worker conflicts.

## 4. Style Sheet (style.css)

PMOS styles are added in clearly marked sections with `/* PMOS */` comment headers. No existing ACPM styles are modified.

**Action required**: Owner review to confirm visual compatibility.

## 5. Face Attendance Feature Flag

**File**: `face-attendance.js`

The face attendance module is **disabled by default** via `PMOS_CONFIG.faceAttendanceEnabled = false`. When disabled:
- No face-api models are downloaded
- No camera permissions are requested
- No Firebase listeners are started
- No UI is rendered

**Action required**: Owner can enable by setting `PMOS_CONFIG.faceAttendanceEnabled = true` in `acpm-shell.js`.

## 6. Notification Integration

PMOS notifications use the existing `createNotificationEvent()` system. No changes to the ACPM notification core are required.

**Action required**: Verify notification routing works correctly during UAT.

## 7. Photo Upload Provider

Google Drive is the **only** photo upload provider (Apps Script transport). Firebase Storage is fully disabled — `storage.rules` denies all writes.

**Configuration**: `PMOS_CONFIG.photoProvider` in `acpm-shell.js`

**Action required**: Owner can configure the provider preference.

## 8. Meeting Notes Integration

Meeting Notes is fully functional in both PMOS Mobile and PMOS Office. The module is accessible via:
- PMOS Mobile Create action sheet
- PMOS Office navigation tabs (Meeting Notes tab)
- PMOS Office Inbox and Project Feed

**Status**: Fully integrated and ready for UAT.

## Summary

| Integration | Status | Owner Action |
|---|---|---|
| Database Rules | Proposed | Review and approve `database.rules.pmos-proposed.json` |
| Storage Rules | Proposed | Review and approve `storage.rules.pmos-proposed` |
| Service Worker | Isolated | Review for conflicts |
| Styles | Isolated | Review visual compatibility |
| Face Attendance | Gated | Enable via config flag |
| Notifications | Using existing API | Verify during UAT |
| Photo Upload | Firebase primary | Configure provider preference |
| Meeting Notes | Fully integrated | UAT verification |

## Deployment Order

1. Owner reviews and approves proposed rules
2. Deploy database rules (from production `database.rules.json` or proposed)
3. Deploy storage rules (from proposed or custom)
4. Deploy hosting (PMOS files)
5. Verify in controlled site test
6. Enable Face Attendance if desired
7. Production deployment
