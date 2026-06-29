# ACPM Site Log v1 QA Checklist

Status: DATA FOUNDATION IMPLEMENTED - MANUAL FIREBASE QA PENDING

Scope:

- Data foundation and minimal functional UI wiring.
- No visual redesign yet.
- Do not touch stable Labor or Materials.

## Existing Behavior to Preserve

- [x] Save helper supports date, notes, work accomplished, weather, manpower, equipment, visitors, issues, delays, safety, photo URLs.
- [x] Automatic current time is stored.
- [x] GPS is requested when browser permission allows.
- [x] Log appears grouped by month and date through existing listener.
- [x] Summary counts total logs, GPS logs, and current-week logs.
- [x] Text export reads active historical logs.
- [x] Listener detaches when switching projects.

Result: PASS STATIC / PENDING REAL FIREBASE WORKFLOW QA

## Historical Integrity

- [x] Delete action is replaced by void action.
- [x] Voided log remains under `siteLogs`.
- [x] Voided log includes:
  - `status = voided`
  - `voidedAt`
  - `voidedBy`
  - `voidReason`
- [x] Active views hide voided logs by default.
- [x] Helper `listSiteLogs(projectId, { includeVoided: true })` can read voided logs when requested.

Result: PASS STATIC / PENDING REAL FIREBASE WORKFLOW QA

## Structured Daily Log

- [x] Save weather summary.
- [x] Save manpower notes into structured entries.
- [x] Save visitor notes into structured entries.
- [x] Save equipment notes into structured entries.
- [x] Save issues.
- [x] Save delays.
- [x] Save safety notes/incidents.
- [ ] Save comments.
- [ ] Reopen saved log and verify all sections load correctly.

Result: PASS STATIC / PENDING MANUAL REOPEN QA

## Photo / Video Upload

- [ ] Upload photo to Firebase Storage.
- [x] Verify URL metadata can be written under `siteLogs/{logId}/media`.
- [ ] Verify media URL opens.
- [ ] Upload video if enabled.
- [ ] Verify failed upload does not corrupt the log.
- [ ] Verify media remains attached after refresh.

Result: WARNING - URL metadata supported, Firebase Storage upload not implemented

## GPS / Time

- [ ] Save log with GPS permission granted.
- [ ] Verify latitude/longitude/accuracy are stored.
- [ ] Save log with GPS denied.
- [ ] Verify log still saves without GPS.
- [ ] Verify automatic date/time is stored in consistent format.

Result: PENDING IMPLEMENTATION QA

## Offline Readiness

- [ ] Simulate offline mode.
- [ ] Save pending site log locally.
- [ ] Restore online mode.
- [ ] Sync pending log.
- [ ] Verify no duplicate log is created after refresh/retry.
- [ ] Verify pending media uploads remain queued until successful.

Result: PENDING IMPLEMENTATION QA

## Rollups / Reports

- [x] Run `rebuildSiteLogRollups(projectId)` helper exists and writes `siteLogRollups`.
- [x] Verify code calculates:
  - total logs
  - logs this week
  - logs with GPS
  - logs with media
  - open issues
  - open delays
  - safety incidents
- [ ] Export daily report.
- [ ] Export weekly report.
- [ ] Verify reports read historical records.

Result: PASS STATIC / PENDING REAL FIREBASE QA

## Firebase Rules / Index QA

- [x] Add/verify indexes for:
  - `siteLogs.date`
  - `siteLogs.status`
  - `siteLogs.savedAt`
  - `siteLogs.savedBy`
  - `siteLogEvents.type`
  - `siteLogEvents.logId`
  - `siteLogEvents.createdAt`
- [x] Verify project permissions protect Site Log paths through project-level rules.
- [ ] Verify media upload permissions if Firebase Storage is enabled.

Result: PASS STATIC

## Known Limitations

- UI is functional but not polished.
- Firebase Storage rules are not documented because upload is not implemented.
- Offline media upload needs a separate queue from database writes.
- Manual Firebase QA is pending because posted/voided records create permanent history.

## Static QA Results

- [x] `node --check sitelog.js`
- [x] Firebase rules JSON parse after Site Log rule update
- [x] Browser smoke test after cache v57: `sitelog.js?v=57` loaded, structured fields existed, console had no errors/warnings.
- [ ] Real Firebase save/void/reopen test in QA project

## Stability Gate

Site Log v1 can be marked STABLE when:

- [ ] Logs are never permanently deleted.
- [ ] Structured sections save and reload.
- [ ] Photo upload works and preserves metadata.
- [ ] GPS success/failure paths both work.
- [ ] Offline retry does not duplicate logs.
- [ ] Reports read historical records.
