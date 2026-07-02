# ACPM Site Log v1 QA Checklist

Status: SITE LOG V1 RC1 WORKFLOW/DATA STABLE - REAL FIREBASE QA AND BROWSER SMOKE PASSED; MEDIA UPLOAD/OFFLINE QUEUE FUTURE

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
- [x] Save comments/notes through the `notes` field.
- [x] Reopen saved log and verify all sections load correctly.

Result: PASS - REAL FIREBASE QA FOR STRUCTURED CORE SECTIONS

## Photo / Video Upload

- [ ] Upload photo to Firebase Storage. Future scope.
- [x] Verify URL metadata can be written under `siteLogs/{logId}/media`.
- [x] Verify media URL remains attached after refresh/reload via helper read.
- [ ] Upload video if enabled. Future scope.
- [ ] Verify failed upload does not corrupt the log. Future scope once upload exists.
- [x] Verify media remains attached after refresh.

Result: PASS FOR RC1 URL METADATA / FIREBASE STORAGE UPLOAD FUTURE

## GPS / Time

- [x] Save log with GPS data.
- [x] Verify latitude/longitude/accuracy are stored.
- [x] Save log without GPS when geolocation callback is unavailable or denied in code path.
- [ ] Browser permission-denial click-through is future manual QA when browser permission prompts are available.
- [x] Verify automatic/manual time is stored in consistent format.

Result: PASS HELPER QA / BROWSER PERMISSION-DENIAL PROMPT QA FUTURE

## Offline Readiness - Future Field Deployment

- [ ] Simulate offline mode. Future scope.
- [ ] Save pending site log locally. Future scope.
- [ ] Restore online mode. Future scope.
- [ ] Sync pending log. Future scope.
- [ ] Verify no duplicate log is created after refresh/retry. Future scope.
- [ ] Verify pending media uploads remain queued until successful. Future scope.

Result: FUTURE SCOPE - NOT PART OF RC1 SITE LOG DATA WORKFLOW

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
- [x] Export active site log text through browser-visible Site Log export wiring.
- [x] Export weekly report snapshot wiring is covered by Reports UI/static QA.
- [x] Verify reports/helpers read historical records and rollups.

Result: PASS HELPER QA + UI WIRING STATIC QA

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
- [ ] Verify media upload permissions if Firebase Storage is enabled. Future scope.

Result: PASS STATIC

## Known Limitations

- UI is functional but not polished.
- Firebase Storage rules are not documented because upload is not implemented.
- Offline media upload needs a separate queue from database writes.
- Real Firebase QA creates permanent history; QA projects are archived after each run.
- Firebase Storage media upload and offline field queue are future scope.
- Browser geolocation-denial prompt QA remains future manual QA; the no-GPS save path is covered in code/helper behavior.

## Static QA Results

- [x] `node --check sitelog.js`
- [x] Firebase rules JSON parse after Site Log rule update
- [x] Browser smoke test after cache v57: `sitelog.js?v=57` loaded, structured fields existed, console had no errors/warnings.
- [x] Real Firebase save/reopen/revise/void/rollup/events/notification test in archived QA project:
  - Script: `scripts/sitelog_v1_real_qa.js`
  - Result: PASS
  - Project: `qa_mr0rtiv7_93fzm10z`
  - Project name: `QA_RC1_SiteLogs_v76_1782831460197`
- [x] UI workflow static QA:
  - Script: `scripts/ui_workflow_static_qa.js`
  - Result: PASS
  - Verifies the current workspace shell exposes the Site Log tab, form fields, filter, save/export actions, and visible save/void/export handler wiring.
- [x] Browser smoke test after cache v96:
  - Project: `qa_mr33kg3o_micv8zg1` archived after test.
  - Signed-in Boss opened the Site Log tab in the workspace.
  - Visible save form created a dated log for `2026-07-02`.
  - Rendered list showed `RC1 browser smoke daily site log notes`.
  - Summary updated from `0 total logs` to `1 total log`.
  - Console errors: none.

## Stability Gate

Site Log v1 RC1 gate:

- [x] Logs are never permanently deleted.
- [x] Structured sections save and reload.
- [x] Photo URL metadata works and preserves history.
- [x] GPS metadata stores and reloads when provided.
- [x] Rollups/events/notification hooks are written and reloadable.
- [x] Reports can read historical records/rollups.
- [x] Firebase Storage upload is documented as future work, not an RC1 dependency.
- [x] Offline retry is documented as future work, not an RC1 dependency.
- [x] UI workflow static QA covers current visible Site Log wiring.
- [x] Browser smoke after v96 passed on archived QA project.
