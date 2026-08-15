# PMOS Architecture

## System Overview

```
┌──────────────────────┐     ┌──────────────────────────┐
│    PMOS Mobile        │     │    ACPM Office Hub        │
│    (pmos.html)        │     │    (dashboard.html)        │
│                      │     │                          │
│  ┌────────────────┐  │     │  ┌────────────────────┐  │
│  │ Bottom Nav     │  │     │  │ Inbox / Feed       │  │
│  │ Home/Updates/  │  │     │  │ Issue Board        │  │
│  │ Create/Tasks/  │  │     │  │ Materials          │  │
│  │ More           │  │     │  │ Follow-ups         │  │
│  └────────────────┘  │     │  │ Site Logs          │  │
│                      │     │  │ Photo Gallery      │  │
│  ┌────────────────┐  │     │  │ Reports            │  │
│  │ Form Modules   │  │     │  └────────────────────┘  │
│  │ Quick Update   │  │     └──────────────────────────┘
│  │ Site Log       │  │              │
│  │ Issues         │  │              │
│  │ Materials      │  │              │
│  │ Tasks          │  │              │
│  │ Photos         │  │              │
│  │ Meeting Notes  │  │              │
│  └────────────────┘  │              │
│                      │              │
│  Offline Queue ──────┼──────────────┘
│  (IndexedDB)         │     Firebase Realtime Database
└──────────────────────┘     ┌──────────────────────────┐
                             │ Global: /pmos*           │
                             │ Project: /projects/{pid} │
                             └──────────────────────────┘
```

## Mobile App Flow

1. **Auth check** — `auth.js` verifies Firebase Auth session
2. **Profile load** — User profile loaded from `users/{uid}`
3. **Project load** — Assigned active projects fetched
4. **Shell render** — PMOS header, project bar, bottom nav, content area
5. **Listener setup** — Real-time listeners for PMOS data paths
6. **Photo queue** — IndexedDB photo queue initialized
7. **Online/offline** — Event handlers for connectivity changes

## Office Hub Flow

1. **Inject** — `pmos-office.js` injects PMOS Office section into ACPM Dashboard
2. **Hub integration** — Button in Hub command actions; tab in workspace
3. **Listeners** — Real-time subscriptions to global and project paths
4. **Dedup** — Records deduplicated across multiple data sources
5. **Views** — Inbox, Feed, Issue Board, Materials, Tasks, Site Logs, Photos, Reports

## Subscription Manager

The listener architecture subscribes to:
- **Global paths**: Root-level PMOS collections (`pmosUpdates`, etc.)
- **Project fallback paths**: `projects/{pid}/pmos*` for each assigned project
- **Project-root scan**: Full `projects/` node for fallback records

Deduplication uses composite keys: `collection|projectId|recordId`.

## Offline Queue

All modules support offline operation:
1. **Create record offline** → saves to `pmos_offline_queue` IndexedDB
2. **Photo capture offline** → saves to `line17_pmos_photo_queue` IndexedDB
3. **Sync on reconnect** → `online` event triggers sync
4. **Retry logic** → Manual retry per item; exponential backoff in retry count

## Photo Upload

1. **Capture** → Camera or gallery selection
2. **Compress** → 1600px resize @ 0.82 quality; 400px thumbnail @ 0.78
3. **Queue** → IndexedDB with upload status tracking
4. **Upload** → Google Drive (only) via the approved Apps Script transport
5. **Sync** → Firebase RTDB record created with photo URL
6. **Cleanup** → IndexedDB entry removed on success

## Meeting Notes Module

The Meeting Notes module (`meeting-notes.js`) is a standalone module that:
- Integrates with PMOS mobile via the Create action sheet
- Integrates with PMOS Office via the `pmosRenderMeetingNotes()` renderer
- Uses the `pmosMeetingNotes` database path
- Supports the full status workflow: Draft → Submitted → Reviewed → Action Required → Closed → Archived
- Generates notification events on creation
- Creates audit log entries

## Notification Integration

PMOS notifications use the existing `createNotificationEvent()` system:
- Created in `notifications.js`
- Stored in `projects/{pid}/notificationEvents/` or `globalNotificationEvents/`
- Displayed in the ACPM notification dropdown
- Use idempotency keys to prevent duplicates during offline retry
