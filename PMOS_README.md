# ACPM PMOS — Project Mobile Operations System

PMOS is the field data capture subsystem of ACPM (Art and Choi Project Management). It allows field personnel to capture site data on mobile devices, which is reviewable from the ACPM Office Hub.

## Architecture

```
/                              — ACPM root application
  pmos.html                    — Compatibility redirect → /pmos/
  pmos/                        — PMOS PWA application (standalone scope)
    index.html                 — PMOS entry point (PWA-enabled)
    pmos-sw.js                 — PMOS service worker (scope: /pmos/)
    pmos-manifest.json         — PMOS PWA manifest
    offline.html               — Offline fallback page
    icons/                     — PWA icons (generated at build time)

  pmos.js                      — Mobile field application (loaded by /pmos/index.html)
  pmos-office.js               — Office Hub review and routing (embedded in ACPM Dashboard)
  meeting-notes.js             — Meeting Notes module
  face-attendance.js           — Optional Selfie Attendance module (disabled by default)
  acpm-shell.js                — Shared shell utilities, version constants, helpers
  pmos-subscription-manager.js — Centralized Firebase listener management
  pmos-pagination.js           — Reusable Firebase pagination with cursors
  pmos-photo-lightbox.js       — Photo Gallery lightbox for Office Hub
  pmos-tests.js                — Legacy test skeleton (replaced by Vitest)

  assets/brand/acpm-brand.css  — ACPM design tokens
  assets/brand/pmos-app.css    — PMOS application styles
  database.rules.pmos-proposed.json — Proposed PMOS database rules
  storage.rules.pmos-proposed  — Proposed PMOS storage rules
  patches/                     — Proposed integration patches for ACPM core
```

## Mobile Entry

- **URL**: `pmos.html` (redirects to `/pmos/`)
- **Direct URL**: `/pmos/`
- **Authentication**: Firebase Auth (shared with ACPM)
- **PWA**: Installable via browser prompt; service worker (scoped to `/pmos/`) caches app shell offline
- **Navigation**: Bottom tabs — Home, Updates, Create, Tasks, More

## Office Hub

- **URL**: Embedded in ACPM Dashboard via `pmos-office.js`
- **Views**: Inbox, Project Feed, Issue Board, Material Requests, Follow-ups, Site Logs, Photo Gallery, Meeting Notes, Reports
- **View-aware subscriptions**: Only active view listeners are retained via `PMOSSubscriptionManager`
- **Pagination**: Bounded initial queries with Load More for all 8 views
- **Access**: Role-based visibility (APM, PM, Boss, Owner, Admin)

## Firebase Paths

### Global (Root-level)
```
pmosUpdates           — Quick updates
pmosSiteLogs          — Daily site logs
pmosIssues            — Punchlist / issues
pmosMaterialRequests  — Material requests
pmosTasks             — Follow-up tasks
pmosPhotoLogs         — Photo proofs
pmosMeetingNotes      — Meeting notes
pmosSelfieAttendance  — Selfie attendance (face attendance)
```

### Project Fallback (Permission-denied)
```
projects/{pid}/pmosUpdates
projects/{pid}/pmosSiteLogs
projects/{pid}/pmosIssues
projects/{pid}/pmosMaterialRequests
projects/{pid}/pmosTasks
projects/{pid}/pmosPhotoLogs
projects/{pid}/pmosMeetingNotes
projects/{pid}/pmosSelfieAttendance
```

## Upload Providers

| Provider | Status | Notes |
|---|---|---|
| Google Drive | Primary | Default upload provider (Apps Script transport) |
| Google Drive | Fallback | Optional, via Apps Script endpoint |

## Offline Mode

PMOS supports offline operation for all modules:
- Records are saved to IndexedDB when offline
- Photos are compressed and queued in IndexedDB
- Automatic sync when connection is restored
- Manual retry for failed items
- Offline queue persists across page reloads

## User Roles

| Role | Read | Write | Review | Admin |
|---|---|---|---|---|
| Field User (APM/Foreman) | Assigned projects | Own records | No | No |
| Project Manager | Assigned projects | Own records | Yes | No |
| Boss/Owner/Admin | All projects | All records | Yes | Yes |
| Viewer | Assigned projects | No | No | No |

## PMOS Modules (7 Core + 1 Optional)

| Module | Status | Notes |
|---|---|---|
| Quick Update | ✅ Complete | Category, note, priority, due date |
| Site Log | ✅ Complete | Date, weather, manpower, accomplishment, remarks |
| Issue | ✅ Complete | Location, assigned to, priority, status workflow |
| Material Request | ✅ Complete | Item, quantity, unit, needed date, purpose |
| Follow-up Task | ✅ Complete | Person, due date, priority, status |
| Photo Proof | ✅ Complete | Camera/upload, compression, queue |
| Meeting Notes | ✅ Complete | Attendees, agenda, decisions, action items |
| Selfie Attendance | ⚠️ Optional | Disabled by default (feature flag) |

## PMOSFaceAttendance Lifecycle

```js
PMOSFaceAttendance.isEnabled()  // Checks PMOS_CONFIG.faceAttendanceEnabled
PMOSFaceAttendance.open()       // Lazy init: loads models, starts camera
PMOSFaceAttendance.close()      // Stops camera, unsubscribes listeners, clears timers
PMOSFaceAttendance.destroy()    // Full cleanup
PMOSFaceAttendance.getState()   // Returns current lifecycle state
```

- Disabled by default — no models, camera, or listeners initialized
- All side effects start only through explicit `open()` calls

## Local Development

```bash
# Serve locally
npx serve .

# Run unit tests (Vitest + jsdom)
npm run test:pmos

# Run Firebase Emulator rules tests (requires Java 21+)
npm run test:pmos:rules

# Run Playwright E2E tests (requires emulator + server)
npm run test:e2e

# Open in browser
open http://localhost:3000/pmos/
```

## PWA Installation

1. Open `/pmos/` in Chrome on Android or Safari on iOS
2. An install prompt appears (or use browser menu → "Add to Home Screen")
3. The app opens in standalone mode with offline caching
4. The PMOS service worker is scoped to `/pmos/` only — does not affect ACPM root

## Deployment

See `PMOS_DEPLOYMENT.md` for full deployment instructions.

## Key Files

| File | Purpose |
|---|---|
| `PMOS_CURRENT_STATUS.md` | Current implementation status |
| `PMOS_QA_REPORT.md` | Test results and QA findings |
| `PMOS_UAT_CHECKLIST.md` | Owner UAT checklist |
| `PMOS_DEPLOYMENT.md` | Deployment procedures |
| `PMOS_ARCHITECTURE.md` | System architecture |
| `PMOS_DATA_MODEL.md` | Firebase data model |
| `PMOS_SECURITY.md` | Security rules documentation |
| `PMOS_CHANGED_FILES_AUDIT.md` | Git change audit |
| `PMOS_PROTECTED_FILE_AUDIT.md` | Protected ACPM core audit |
| `PMOS_DEPLOYMENT_INCIDENT_AUDIT.md` | Deployment incident documentation |
| `PMOS_ACPM_INTEGRATION_PENDING.md` | Proposed ACPM integrations |
| `BRAND_ASSETS.md` | Brand asset documentation |

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| "Select an assigned active project" | User not assigned | Ask admin to assign projects |
| Photo upload fails | Drive script expired | Check Drive deployment; photos stay queued locally and retry |
| "Firebase rules need deployment" | Proposed rules not deployed | Owner must review and approve proposed rules |
| Offline records not syncing | Connection issue | Check connection; tap "Sync Now" in More tab |
| PMOS not loading offline | First load required | Visit `/pmos/` once while online to cache the shell |
| Root pmos.html shows blank | Redirect not configured | Ensure `pmos.html` has the redirect script |
