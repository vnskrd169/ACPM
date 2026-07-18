# PMOS Photo Upload — Deployment Checklist

**Feature**: Google Drive-only photo upload for PMOS (Site Camera / Photo Proof)  
**Branch**: `feature/pmos-official-app`  
**Last updated**: 2026-07-17  

> This checklist ensures the Drive-only photo pipeline is fully ready before
> production deployment. Each section must be verified and signed off.

---

## Section A — Google Drive Apps Script Endpoint

| # | Item | Status | Notes |
|---|---|---|---|
| A1 | Apps Script project exists | ☐ | Must be deployed as a **Web App** |
| A2 | Web App deployed with **correct access** | ☐ | Set to "Execute as: Me" / "Who has access: Anyone" (or domain-restricted) |
| A3 | Endpoint URL configured in `acpm-shell.js` | ✅ | `PMOS_CONFIG.driveUploadUrl` is set — confirm URL matches latest deployment |
| A4 | Endpoint reachable from PMOS (no CORS issues) | ☐ | Test POST via browser or `curl` |
| A5 | **Photo upload** returns valid response | ☐ | Must include `photoUrl` or `fileUrl` field |
| A6 | **Thumbnail upload** returns valid response | ☐ | Must include `thumbnailUrl` or `thumbUrl` or `thumbnailFileId` |
| A7 | Google Drive **target folder** confirmed | ☐ | Check folder ID in Apps Script — photos should land in correct project folder |
| A8 | File naming convention verified | ☐ | Format: `{timestamp}_{safename}.jpg` — folder structure: `pmos/{projectId}/photoLogs/{date}/` |
| A9 | Response format: redundant field names accepted | ✅ | `uploadPhotoToDrive()` normalizes: `fileUrl`/`viewUrl`/`downloadUrl` → `photoUrl`; `fileId` → `photoFileId`; `thumbUrl` → `thumbnailUrl`; `folderId` → `driveFolderId` |

### Apps Script Response Contract

```js
// Expected success response (any of these field name conventions work):
{
  "success": true,
  "ok": true,                        // Either success or ok
  "photoUrl": "...",                 // Direct image URL
  "fileUrl": "...",                  // Alternative field name
  "viewUrl": "...",                  // Alternative field name
  "downloadUrl": "...",              // Alternative field name
  "fileId": "...",                   // Google Drive file ID
  "photoFileId": "...",              // Explicit photo file ID
  "fileName": "...",
  "folderId": "...",                 // Drive folder ID
  "driveFolderId": "...",            // Alternative field name
  "mimeType": "image/jpeg",
  "thumbnailUrl": "...",             // Optional: direct thumbnail URL
  "thumbUrl": "...",                 // Alternative field name
  "thumbnailFileId": "..."           // Optional: thumbnail file ID
}
```

---

## Section B — Firebase Realtime Database

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | Firebase Realtime Database **enabled** | ☐ | Check Firebase Console → Realtime Database |
| B2 | PMOS RTDB paths allowed by **active rules** | ☐ | Deployed `database.rules.json` must include PMOS paths (see Section D) |
| B3 | **Firebase Storage NOT required** | ✅ | No `firebase.storage()` calls in active PMOS photo path |
| B4 | **Firebase Storage rules NOT deployed** | ✅ | `storage.rules` unchanged — `database.rules.json` only |
| B5 | Existing ACPM rules **preserved** | ☐ | Merge PMOS paths into existing `database.rules.json` — do not replace |
| B6 | `pmosPhotoLogs` path **has `.indexOn`** | ✅ | `projectId`, `clientGeneratedId`, `location`, `category`, `uploadStatus`, `createdAt` |
| B7 | **Dry run** validates before deploy | ☐ | Run `firebase deploy --only database --dry-run` |

### RTDB Paths Used by PMOS Photos

```
/pmosPhotoLogs/{photoLogId}
```

### Required fields in each record:

```json
{
  "id": "<firebase push key>",
  "projectId": "<project id>",
  "projectName": "<project name>",
  "caption": "<user caption>",
  "location": "<location text>",
  "category": "<Progress|Issue|Delivery|Safety|Quality|Before|After>",
  "photoUrl": "<Google Drive image URL>",
  "thumbnailUrl": "<Google Drive thumbnail URL>",
  "driveFileId": "<Drive file ID>",
  "thumbnailDriveFileId": "<Drive thumbnail file ID>",
  "driveFolderId": "<Drive folder ID>",
  "storageProvider": "Google Drive",
  "originalFileName": "<original filename>",
  "compressedSize": <bytes>,
  "uploadStatus": "Uploaded",
  "source": "Line17 PMOS",
  "status": "New",
  "module": "Site Camera",
  "createdAt": <epoch ms>,
  "uploadedAt": <epoch ms>,
  "createdBy": "<user uid>",
  "createdByName": "<user name>",
  "updatedAt": <epoch ms>,
  "schemaVersion": "1.0"
}
```

---

## Section C — PMOS Configuration

| # | Item | Status | Notes |
|---|---|---|---|
| C1 | `photoStorageProvider = "googleDrive"` | ✅ | Set in `acpm-shell.js` → `PMOS_CONFIG` |
| C2 | `useFirebaseStoragePhotos = false` | ✅ | Explicitly disabled |
| C3 | `useGoogleDrivePhotos = true` | ✅ | Primary upload path |
| C4 | `driveUploadUrl` matches **deployed Apps Script URL** | ☐ | Confirm URL in `acpm-shell.js` equals latest deployment ID |
| C5 | Offline queue stores photo in IndexedDB | ✅ | `line17_pmos_photo_queue` — confirmed working in unit tests |
| C6 | Auto-sync on `navigator.onLine` event | ✅ | `uploadQueuedPhotos()` called on connectivity restore |
| C7 | Manual Retry button available | ✅ | "Retry All Uploads" / "Sync Now" in PMOS More tab |
| C8 | `uploadStatus` lifecycle preserved | ✅ | `Queued → Uploading → Uploaded → Synced` (Failed on error, with Retry) |
| C9 | No `firebase.storage` calls in active path | ✅ | Verified: zero calls in `uploadPhotoQueueItem()` or `savePhotoLog()` |
| C10 | `uploadToFirebaseStorage()` removed | ✅ | Dead function deleted |
| C11 | `uploadBlobResumable()` flagged | 🟡 | Still present but dead code — consider removing |

---

## Section D — Firebase Database Rules Merge

> **Do not deploy until owner approves the final merged rules.**

### Current state:

| File | Content | Status |
|---|---|---|
| `database.rules.json` | Production ACPM rules | Active (deployed) — no PMOS paths |
| `database.rules.pmos-proposed.json` | PMOS rules (clean, validated) | Proposed — not deployed |
| `firebase.json` → `database.rules` | Points to `database.rules.json` | Unchanged |

### Merge procedure:

1. Open `database.rules.json` (production)
2. Add the following PMOS paths from `database.rules.pmos-proposed.json`:
   - `pmosUpdates`
   - `pmosSiteLogs`
   - `pmosIssues`
   - `pmosMaterialRequests`
   - `pmosTasks`
   - `pmosMeetingNotes`
   - `pmosPhotoLogs`
   - `pmosSelfieAttendance` *(if enabled — currently disabled)*
   - `globalNotificationEvents`
   - `pmosAuditLog`
3. **Preserve** all existing ACPM paths (`users`, `projects`, etc.)
4. Validate: `node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8'))" && echo 'Valid JSON'`
5. Dry run: `firebase deploy --only database --dry-run`
6. Only deploy after **owner written approval**

### Minimal acceptable rules for beta:

```json
"pmosPhotoLogs": {
  ".read": "auth != null",
  ".indexOn": ["projectId", "clientGeneratedId", "location", "category", "uploadStatus", "createdAt"],
  "$recordId": {
    ".write": "auth != null && newData.exists()"
  }
}
```

---

## Section E — ACPM Office Hub / Gallery Verification

| # | Item | Status | Notes |
|---|---|---|---|
| E1 | Photo Proof Gallery renders thumbnails | ☐ | Gallery uses `thumbnailUrl` — works with Google Drive thumbnail links |
| E2 | View Original opens full-size photo | ☐ | `pmos-photo-lightbox.js` opens `photoUrl` — works with Drive URLs |
| E3 | Fallback: if `thumbnailUrl` missing, use `photoUrl` | ☐ | `pmos-office.js` should fallback gracefully |
| E4 | Fallback: if `photoUrl` missing, show broken state | ☐ | Clear broken/missing photo indicator |
| E5 | `storageProvider` displayed in debug/details | ✅ | Lightbox shows provider tag ("Google Drive") |
| E6 | Inbox receives new photo logs | ☐ | Photo logs appear in ACPM Inbox feed |
| E7 | Status workflow still works (New/Reviewed/Archived) | ☐ | Office Hub status controls unchanged |
| E8 | No Firebase Storage URL assumptions | ✅ | Gallery uses `photoUrl`/`thumbnailUrl` directly — no Firebase Storage dependency |

---

## Section F — Pre-Deployment Commands

```bash
# 1. Syntax check all PMOS files
node --check pmos.js
node --check pmos-office.js
node --check acpm-shell.js
node --check pmos-subscription-manager.js
node --check pmos-pagination.js
node --check pmos-photo-lightbox.js
node --check meeting-notes.js

# 2. Run unit tests
npm run test:pmos

# 3. Run syntax check on proposed rules
node -e "JSON.parse(require('fs').readFileSync('database.rules.pmos-proposed.json','utf8'))" && echo "Rules JSON valid"

# 4. Dry run database rules
firebase deploy --only database --dry-run

# 5. Deploy hosting only (no rules changes without approval)
firebase deploy --only hosting

# 6. Verify deployment
firebase hosting:channel:open live
```

---

## Section G — Post-Deployment Smoke Test (Manual)

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Open `/pmos/` in browser | App shell loads, project selector works | ☐ |
| 2 | Select active project | Dashboard shows project name | ☐ |
| 3 | Tap Site Camera | Photo capture UI renders | ☐ |
| 4 | Take/choose photo | Preview appears with file size | ☐ |
| 5 | Add caption + location + category | Fields accept input | ☐ |
| 6 | Tap Save | Photo compresses, saves to queue | ☐ |
| 7 | Check Google Drive folder | Main image file exists | ☐ |
| 8 | Check Google Drive thumbnail folder | Thumbnail file exists | ☐ |
| 9 | Check Firebase RTDB → `/pmosPhotoLogs/{id}` | Record exists with all fields | ☐ |
| 10 | Confirm `storageProvider = "Google Drive"` | No "Firebase Storage" value | ☐ |
| 11 | Confirm `photoUrl` and `thumbnailUrl` | Valid Google Drive URLs | ☐ |
| 12 | Open ACPM → PMOS Office → Photo Gallery | Thumbnails render | ☐ |
| 13 | Click thumbnail → View Original | Full-size image opens from Drive | ☐ |
| 14 | Toggle offline → save photo | "Saved locally" message | ☐ |
| 15 | Check IndexedDB queue | Item with `uploadStatus: "Queued"` | ☐ |
| 16 | Reconnect online → auto-sync | Photo uploads, queue clears | ☐ |
| 17 | Check Network tab | **Zero** `firebasestorage.googleapis.com` calls | ☐ |
| 18 | Check Console | No `firebase.storage` errors | ☐ |

---

## Section H — Sign-Off

| Role | Name | Date | Signature |
|---|---|---|---|
| Developer | | | ☐ |
| QA | | | ☐ |
| Owner | | | ☐ |

---

*Document version: 1.0 — Corresponds to Phase 8 of PMOS Google Drive photo migration.*
