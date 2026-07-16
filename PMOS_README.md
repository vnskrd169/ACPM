# ACPM PMOS — Project Mobile Operations System

PMOS is the field data capture subsystem of ACPM (Art and Choi Project Management). It allows field personnel to capture site data on mobile devices, which is reviewable from the ACPM Office Hub.

## Architecture

```
pmos.html          — PWA-enabled mobile entry page
pmos.js            — Mobile field application (Home, Updates, Create, Tasks, More)
pmos-office.js    — Office Hub review and routing (embedded in ACPM Dashboard)
meeting-notes.js  — Meeting Notes module
face-attendance.js— Optional Selfie Attendance module
acpm-shell.js     — Shared shell utilities, version constants, helpers
acpm-brand.css    — Design tokens
pmos-manifest.json— PWA manifest for PMOS
```

## Mobile Entry

- **URL**: `pmos.html`
- **Authentication**: Firebase Auth (shared with ACPM)
- **PWA**: Installable via browser prompt; service worker caches assets offline
- **Navigation**: Bottom tabs — Home, Updates, Create, Tasks, More

## Office Hub

- **URL**: Embedded in ACPM Dashboard via `pmos-office.js`
- **Views**: Inbox, Project Feed, Issue Board, Material Requests, Follow-ups, Site Logs, Photo Gallery, Reports
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
pmosSelfieAttendance  — Selfie attendance
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
| Firebase Storage | Primary | Default upload provider |
| Google Drive | Fallback | Optional, via Apps Script endpoint |

The photo upload system tries Firebase Storage first, then falls back to Google Drive.

## Offline Mode

PMOS supports offline operation for all modules:
- Records are saved to IndexedDB when offline
- Photos are compressed and queued in IndexedDB
- Automatic sync when connection is restored
- Manual retry for failed items

## User Roles

| Role | Read | Write | Review | Admin |
|---|---|---|---|---|
| Field User (APM/Foreman) | Assigned projects | Own records | No | No |
| Project Manager | Assigned projects | Own records | Yes | No |
| Boss/Owner/Admin | All projects | All records | Yes | Yes |
| Viewer | Assigned projects | No | No | No |

## Local Development

1. Clone the repository
2. Serve locally:
   ```
   npx serve .
   ```
   or use Firebase Emulator:
   ```
   firebase emulators:start
   ```
3. Open `http://localhost:3000/pmos.html` (or emulator URL)

## PWA Installation

1. Open `pmos.html` in Chrome on Android or Safari on iOS
2. An install prompt appears (or use browser menu → "Add to Home Screen")
3. The app opens in standalone mode with offline caching

## Deployment

See `PMOS_DEPLOYMENT.md` for full deployment instructions.

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| "Select an assigned active project" | User not assigned | Ask admin to assign projects |
| Photo upload fails | Drive script expired | Check Drive deployment; Firebase Storage should still work |
| "Firebase rules need deployment" | Rules not deployed | Run `firebase deploy --only database` |
| Offline records not syncing | Connection issue | Check connection; tap "Sync Now" in More tab |
