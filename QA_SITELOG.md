# ACPM Site Log v1 QA Checklist

Status: ARCHITECTURE READY - IMPLEMENTATION PENDING

Scope:

- Architecture first.
- No UI redesign yet.
- Do not touch stable Labor or Materials.

## Existing Behavior to Preserve

- [ ] Save log with date, notes, and weather.
- [ ] Automatic current time is stored.
- [ ] GPS is requested when browser permission allows.
- [ ] Log appears grouped by month and date.
- [ ] Summary counts total logs, GPS logs, and current-week logs.
- [ ] Text export works.
- [ ] Listener detaches when switching projects.

Result: PENDING IMPLEMENTATION QA

## Historical Integrity

- [ ] Delete action is replaced by void action.
- [ ] Voided log remains under `siteLogs`.
- [ ] Voided log includes:
  - `status = voided`
  - `voidedAt`
  - `voidedBy`
  - `voidReason`
- [ ] Active views hide voided logs by default.
- [ ] Export/report can include voided logs when requested.

Result: PENDING IMPLEMENTATION QA

## Structured Daily Log

- [ ] Save weather summary.
- [ ] Save manpower entries by trade/foreman.
- [ ] Save visitor entries.
- [ ] Save equipment entries.
- [ ] Save issues.
- [ ] Save delays.
- [ ] Save safety notes/incidents.
- [ ] Save comments.
- [ ] Reopen saved log and verify all sections load correctly.

Result: PENDING IMPLEMENTATION QA

## Photo / Video Upload

- [ ] Upload photo to Firebase Storage.
- [ ] Verify metadata is written under `siteLogs/{logId}/media`.
- [ ] Verify media URL opens.
- [ ] Upload video if enabled.
- [ ] Verify failed upload does not corrupt the log.
- [ ] Verify media remains attached after refresh.

Result: PENDING IMPLEMENTATION QA

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

- [ ] Run `rebuildSiteLogRollups(projectId)`.
- [ ] Verify:
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

Result: PENDING IMPLEMENTATION QA

## Firebase Rules / Index QA

- [ ] Add/verify indexes for:
  - `siteLogs.date`
  - `siteLogs.status`
  - `siteLogs.savedAt`
  - `siteLogs.savedBy`
  - `siteLogEvents.type`
  - `siteLogEvents.logId`
  - `siteLogEvents.createdAt`
- [ ] Verify project permissions protect Site Log paths.
- [ ] Verify media upload permissions if Firebase Storage is enabled.

Result: PENDING IMPLEMENTATION QA

## Known Limitations

- Current UI is simple notes/weather only.
- Current implementation permanently deletes logs and must be refactored before v1 stable.
- Firebase Storage rules are not documented yet.
- Offline media upload needs a separate queue from database writes.

## Stability Gate

Site Log v1 can be marked STABLE when:

- [ ] Logs are never permanently deleted.
- [ ] Structured sections save and reload.
- [ ] Photo upload works and preserves metadata.
- [ ] GPS success/failure paths both work.
- [ ] Offline retry does not duplicate logs.
- [ ] Reports read historical records.
