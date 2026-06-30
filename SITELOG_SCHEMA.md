# ACPM Site Log v1 Workflow and Firebase Schema

Status: SITE LOG V1 RC1 WORKFLOW/DATA STABLE - REAL FIREBASE QA PASSED; MEDIA UPLOAD/OFFLINE QUEUE FUTURE

Site Log v1 must support real daily construction documentation while staying future-ready for offline use and media upload.

## Purpose

The Site Log is the daily record of what happened on site. It supports coordination, claims, delay tracking, safety records, punch lists, and management reporting.

## Current Snapshot

Existing path:

```text
projects/{projectId}/siteLogs
```

Existing behavior:

- Saves date, notes, weather, automatic time, saved date, saved user, and optional GPS coordinates.
- Lists logs grouped by month and date.
- Exports text report.
- Delete action now voids a log instead of permanently removing it.
- Photos can be rendered if a `photos` array exists, but upload flow is not implemented.

Production gaps fixed in v1 data foundation:

- Site logs now support structured work, manpower, visitors, equipment, issues, delays, safety, media URL metadata, GPS, events, notification hooks, and rollups.
- `siteLogEvents` records posted/revised/voided events.
- `statusHistory` records posted/revised/voided transitions on the log itself.
- `siteLogRollups` rebuilds from historical `siteLogs`.

Remaining RC1 limitations:

- Firebase Storage upload is not implemented; RC1 supports photo/media URL metadata only.
- Offline Site Log queueing is not implemented; generic PWA caching remains separate from field-entry retry.

## Target Workflow

```text
Daily Log
Weather
Manpower
Visitors
Equipment
Issues / Delays
Safety
Photos / Videos
GPS
Comments
History
Reports
```

## Firebase Structure

```text
projects/{projectId}/
  siteLogs/{logId}/
    logNo
    date
    time
    status
    weather/
      summary
      temperature
      rainfall
      condition
    manpower/{entryId}/
      tradeId
      tradeName
      foremanName
      workerCount
      notes
    visitors/{visitorId}/
      name
      company
      purpose
      timeIn
      timeOut
      notes
    equipment/{equipmentId}/
      name
      type
      qty
      hoursUsed
      status
      notes
    issues/{issueId}/
      type
      severity
      description
      responsibleParty
      status
      createdAt
    delays/{delayId}/
      cause
      description
      affectedScope
      estimatedImpactDays
      status
    safety/
      toolboxMeeting
      incidents
      ppeCompliance
      notes
    media/{mediaId}/
      type
      name
      url
      storagePath
      thumbnailUrl
      caption
      uploadedAt
      uploadedBy
      offlinePending
    gps/
      latitude
      longitude
      accuracy
      capturedAt
    notes
    comments/{commentId}/
      text
      createdAt
      createdBy
    savedAt
    savedDate
    savedBy
    updatedAt
    updatedBy
    statusHistory/{historyId}/
      fromStatus
      toStatus
      notes
      createdAt
      createdBy
    voidedAt
    voidedBy
    voidReason

  siteLogEvents/{eventId}/
    type
    logId
    date
    description
    createdAt
    createdBy

  siteLogRollups/
    totalLogs
    logsThisWeek
    logsWithGps
    logsWithMedia
    openIssues
    openDelays
    safetyIncidents
    lastLogDate
    lastUpdatedAt
```

## Statuses

```text
draft
posted
revised
voided
```

Rules:

- `posted` logs are active history.
- `revised` logs remain active but should show revision metadata.
- `voided` logs remain in Firebase and are hidden from active daily views by default.

## Media Upload Architecture

Preferred storage:

```text
Firebase Storage:
projects/{projectId}/siteLogs/{logId}/{mediaId}
```

Realtime Database stores metadata only:

```text
type = photo | video | document
url
storagePath
thumbnailUrl
caption
uploadedAt
uploadedBy
offlinePending
```

Upload rules:

- Save log metadata first.
- Upload media to Storage.
- Write media metadata after upload succeeds.
- If offline, queue media metadata with `offlinePending = true` and upload later.

## Offline Readiness

Site Log should be designed for field use:

- Form data can be saved locally before upload.
- Offline queue should store pending log writes and pending media uploads separately.
- Each queued item should have a client-generated ID to avoid duplicate posts after retry.
- Sync must be idempotent where possible.

## Helper Functions Needed

| Helper | Purpose |
| --- | --- |
| `createSiteLog(projectId, data)` | Creates posted site log with date/time/user metadata. |
| `listSiteLogs(projectId, filters)` | Reads active and archived logs. |
| `updateSiteLog(projectId, logId, data)` | Updates log and writes revision metadata. |
| `voidSiteLog(projectId, logId, reason)` | Voids instead of deleting. |
| `createSiteLogEvent(projectId, event)` | Appends site-log event history. |
| `addSiteLogMedia(projectId, logId, file)` | Uploads media and writes metadata. |
| `queueSiteLogOffline(projectId, data)` | Stores pending log while offline. |
| `syncPendingSiteLogs(projectId)` | Replays local pending logs safely. |
| `rebuildSiteLogRollups(projectId)` | Rebuilds summary counts from history. |
| `exportSiteLogReport(projectId, filters)` | Exports daily/weekly/monthly log history. |

Implemented helper functions in `sitelog.js`:

- `createSiteLog(projectId, data)`
- `listSiteLogs(projectId, filters)`
- `updateSiteLog(projectId, logId, data)`
- `voidSiteLog(projectId, logId, reason)`
- `createSiteLogEvent(projectId, event)`
- `rebuildSiteLogRollups(projectId)`

Real Firebase QA helper:

- `scripts/sitelog_v1_real_qa.js`

Real Firebase QA evidence, 2026-06-30:

- Result: PASS
- QA project: `qa_mr0rtiv7_93fzm10z`
- Project name: `QA_RC1_SiteLogs_v76_1782831460197`
- Created structured log, reopened/listed it, revised it, voided it, rebuilt rollups, verified event history and notification hooks.
- QA project was archived after the run.

Existing UI functions preserved:

- `saveLog()`
- `deleteLog(key)` now voids instead of deleting.
- `exportSiteLogs()`
- `filterLogs(query)`

## Firebase Indexes Needed

```json
"siteLogs": {
  ".indexOn": ["date", "status", "savedAt", "savedBy"]
},
"siteLogEvents": {
  ".indexOn": ["type", "logId", "date", "createdAt"]
},
"siteLogRollups": {
  ".indexOn": ["lastUpdatedAt"]
}
```

## Migration Notes

Existing rows should map as:

```text
date -> date
notes -> notes
weather -> weather.summary
time -> time
location -> gps latitude/longitude string migration if possible
savedAt -> savedAt
savedDate -> savedDate
savedBy -> savedBy
status = posted
```

Existing permanent delete behavior must be replaced by `status = voided`.

## Known Limitations

- Site Log now has structured text fields, but not a full dedicated editor for each nested item.
- Media metadata can be stored through photo URLs, but Firebase Storage upload is not implemented in RC1.
- Offline log queue is not implemented in RC1.
- Weather is manually entered; no weather API integration is planned for v1.
- GPS availability depends on browser/device permission.
- Real Firebase QA creates permanent historical QA records, so QA projects are archived after each run.

## Completion Definition

Site Log v1 RC1 gate:

- [x] Logs are never permanently deleted.
- [x] Daily log entries preserve date/time/user/GPS history.
- [x] Structured sections can be saved and re-opened.
- [x] Photo URL metadata writes under `media` and remains historical.
- [x] Events and notification hooks are written for posted/revised/voided.
- [x] Rollups rebuild from historical logs and exclude voided logs from active totals.
- [x] Reports can read historical `siteLogs` and `siteLogRollups`.
- [ ] Firebase Storage upload is future work before media-heavy field deployment.
- [ ] Offline pending-log queue is future work before offline field deployment.
