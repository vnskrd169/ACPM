# ACPM Site Log v1 QA Checklist

Status: SITE LOG V1 RC1 WORKFLOW/DATA STABLE - REAL FIREBASE QA PASSED; MEDIA UPLOAD/OFFLINE QUEUE FUTURE

Scope:

- Data foundation and minimal functional UI wiring.
- No visual redesign yet.
- Do not touch stable Labor or Materials.

## Existing Behavior to Preserve

- [x] Save helper supports date, notes, work accomplished, weather, manpower, equipment, visitors, issues, delays, safety, photo URLs.
- [x] Automatic current time is stored.
- [x] Posted/revised/voided status history is stored on the log record.
- [x] GPS is requested when browser permission allows.
- [x] Log appears grouped by month and date through existing listener.
- [x] Summary counts total logs, GPS logs, and current-week logs.
- [x] Text export reads active historical logs.
- [x] Listener detaches when switching projects.

Result: PASS - REAL FIREBASE QA

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
- [x] Fixed Firebase `forEach` iteration so log history/rollups read every child, not only the first row.

Result: PASS - REAL FIREBASE QA

## Structured Daily Log

- [x] Save weather summary.
- [x] Save manpower notes into structured entries.
- [x] Save visitor notes into structured entries.
- [x] Save equipment notes into structured entries.
- [x] Save issues.
- [x] Save delays.
- [x] Save safety notes/incidents.
- [ ] Save comments.
- [x] Reopen saved log and verify all sections load correctly.

Result: PASS - REAL FIREBASE QA FOR STRUCTURED CORE SECTIONS

## Photo / Video Upload

- [ ] Upload photo to Firebase Storage.
- [x] Verify URL metadata can be written under `siteLogs/{logId}/media`.
- [x] Verify media URL remains attached after refresh/reload via helper read.
- [ ] Upload video if enabled.
- [ ] Verify failed upload does not corrupt the log.
- [x] Verify media remains attached after refresh.

Result: WARNING - URL metadata supported and QA-passed; Firebase Storage upload not implemented

## GPS / Time

- [x] Save log with GPS data.
- [x] Verify latitude/longitude/accuracy are stored.
- [ ] Save log with GPS denied.
- [ ] Verify log still saves without GPS through browser permission denial.
- [x] Verify automatic/manual time is stored in consistent format.

Result: PASS HELPER QA / PENDING BROWSER PERMISSION-DENIAL QA

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
- [ ] Export daily report through browser UI.
- [ ] Export weekly report through reports UI.
- [x] Verify reports/helpers read historical records and rollups.

Result: PASS HELPER QA / PENDING BROWSER EXPORT QA

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
- Real Firebase QA creates permanent history; QA projects are archived after each run.
- Browser media-upload and geolocation-denial QA remain pending.

## Static QA Results

- [x] `node --check sitelog.js`
- [x] Firebase rules JSON parse after Site Log rule update
- [x] Browser smoke test after cache v57: `sitelog.js?v=57` loaded, structured fields existed, console had no errors/warnings.
- [x] Real Firebase save/reopen/revise/void/rollup/events/notification test in archived QA project:
  - Script: `scripts/sitelog_v1_real_qa.js`
  - Result: PASS
  - Project: `qa_mr0rtiv7_93fzm10z`
  - Project name: `QA_RC1_SiteLogs_v76_1782831460197`
- [ ] Browser smoke test after cache v76

## Stability Gate

Site Log v1 RC1 gate:

- [x] Logs are never permanently deleted.
- [x] Structured sections save and reload.
- [x] Photo URL metadata works and preserves history.
- [x] GPS metadata stores and reloads when provided.
- [x] Rollups/events/notification hooks are written and reloadable.
- [x] Reports can read historical records/rollups.
- [ ] Firebase Storage upload is future work.
- [ ] Offline retry is future work.
- [ ] Browser smoke after v76 remains pending.
