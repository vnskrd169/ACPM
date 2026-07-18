# PMOS User Acceptance Checklist

> Use this checklist for one-pass owner review of the PMOS official app upgrade.

## Branding and App Shell

| Item | Expected | Status |
|---|---|---|
| ACPM logo displays correctly | Logo mark visible on loading screen | ✅ Implemented |
| PMOS logo displays correctly | PMOS brand visible in header | ✅ Implemented |
| Loading screen | Animated branded loading with status text | ✅ Implemented |
| App version | Version number visible in More/Settings | ✅ Implemented (in acpm-shell.js) |
| Bottom navigation | Home, Updates, Create, Tasks, More tabs visible | ✅ Implemented |
| Create action sheet | Tapping Create opens action sheet with all modules | ✅ Implemented |
| Project context | Current project shown in header and bar | ✅ Implemented |
| No raw project UIDs | Only human-readable project names displayed | ✅ Implemented |

## Installation (PWA)

| Item | Expected | Status |
|---|---|---|
| `/pmos/` subpath | PMOS accessible at `/pmos/` | ✅ Implemented |
| Root redirect | `pmos.html` redirects to `/pmos/` with param preservation | ✅ Implemented |
| PMOS worker scoped to `/pmos/` | Worker does not control root ACPM pages | ✅ Implemented |
| ACPM worker untouched | `sw.js` not modified by PMOS branch | ✅ Verified |
| Installable | Install prompt appears on supported browsers | ✅ Implemented |
| Standalone mode | Opens without browser chrome | ✅ Implemented |
| Update prompt | New version banner appears after deploy | ✅ Implemented |
| Offline fallback | Cached PMOS shell loads offline | ✅ Implemented |
| Offline queue | Local drafts accessible offline | ✅ Implemented |
| Existing pmos.html | Old links still work (redirect) | ✅ Implemented |

## Authentication

| Item | Expected | Status |
|---|---|---|
| Valid user sign-in | Field user can sign in | ✅ Implemented |
| Inactive user blocked | Suspended/archived user shown pending screen | ✅ Implemented |
| Unassigned user | Cannot view project records | ✅ Implemented (via rules) |
| Logout | Signs out and returns to login with listener cleanup | ✅ Implemented |

## Quick Update

| Item | Expected | Status |
|---|---|---|
| Create | Draft saves locally, submit writes to Firebase | ✅ Implemented |
| Draft resume | Saved draft restores after page refresh | ✅ Implemented |
| Appears in Office | Submitted update visible in PMOS Office Inbox | ✅ Implemented |
| Duplicate prevention | Same record not created twice | ✅ Implemented |
| Pagination | Bounded queries with Load More in Office | ✅ Implemented |
| Listener cleanup | Subscription manager removes listeners on view switch | ✅ Implemented |

## Site Log

| Item | Expected | Status |
|---|---|---|
| All fields | Date, weather, manpower, accomplishment, etc. | ✅ Implemented |
| Offline save | Draft saved offline, syncs on reconnect | ✅ Implemented |
| Appears in Office | Submitted log visible in Site Logs view | ✅ Implemented |
| Pagination | Bounded queries with Load More | ✅ Implemented |

## Issues

| Item | Expected | Status |
|---|---|---|
| Create issue | Report issue with location, priority, assignee | ✅ Implemented |
| Status workflow | Open → Assigned → In Progress → Verified → Closed | ✅ Implemented |
| Edit own issue | Can edit own open issues | ✅ Implemented |
| Archive | Can archive own issues | ✅ Implemented |
| Pagination | Bounded queries with Load More in Office | ✅ Implemented |

## Material Requests

| Item | Expected | Status |
|---|---|---|
| All fields | Item, quantity, unit, needed date, purpose | ✅ Implemented |
| Status workflow | Draft → Submitted → Reviewed → Approved/Rejected → Ordered → Delivered | ✅ Implemented |
| Self-approval prevented | User cannot approve own request (app-layer only; rules don't restrict) | ⚠️ App-layer only |
| Pagination | Bounded queries with Load More | ✅ Implemented |

## Follow-up Tasks

| Item | Expected | Status |
|---|---|---|
| Create task | Task with person, due date, priority | ✅ Implemented |
| Task views | Overdue, due today, open sections | ✅ Implemented |
| Badge | Task badge in bottom nav shows overdue count | ✅ Implemented |
| Pagination | Bounded queries with Load More | ✅ Implemented |

## Meeting Notes

| Item | Expected | Status |
|---|---|---|
| Create meeting | Title, date, type, attendees, agenda, etc. | ✅ Implemented |
| Status workflow | Draft → Submitted → Reviewed → Closed → Archived | ✅ Implemented |
| Appears in Office | Meeting visible in Office Meeting Notes tab | ✅ Implemented |
| Filters | Filter by project, status, type, date | ✅ Implemented |
| Office Meeting Notes tab | Tab appears in PMOS Office navigation | ✅ Implemented |
| Meeting Notes report | Print meeting report with all fields | ✅ Implemented |
| Action item conversion | Action items convertible to Follow-up tasks | ✅ Implemented |
| Duplicate task prevention | Checks sourceModule/sourceRecordId before creation | ✅ Implemented |
| Pagination | Bounded queries with Load More | ✅ Implemented |

## Photos

| Item | Expected | Status |
|---|---|---|
| Camera capture | Camera opens | ✅ Implemented |
| Compression | Photo compressed to ~1600px | ✅ Implemented |
| Upload progress | Progress bar visible during upload | ✅ Implemented |
| Retry failed | Failed uploads show retry button | ✅ Implemented |
| Queue visible | Pending uploads shown in More tab | ✅ Implemented |
| Photo Gallery lightbox | Office gallery opens lightbox with navigation | ✅ Implemented |
| Lightbox focus trap | Focus trapped and restored on close | ✅ Implemented |
| Lightbox event delegation | Single delegated handler, no duplicate listeners | ✅ Implemented |

## Offline Mode

| Item | Expected | Status |
|---|---|---|
| Record offline | All modules save to IndexedDB offline | ✅ Implemented |
| Queue persists | Queue survives page refresh | ✅ Implemented |
| Auto-sync | Reconnect triggers sync | ✅ Implemented |
| No duplicates | Only one remote record created per offline save | ✅ Implemented |
| Offline queue states | Draft, queued, syncing, synced, failed, conflict | ✅ Implemented |
| Retry failed items | Manual retry for individual failed items | ✅ Implemented |

## Office Hub

| Item | Expected | Status |
|---|---|---|
| Inbox loads | Records appear in PMOS Office Inbox | ✅ Implemented |
| Filters work | Project, module, status, priority, date filters | ✅ Implemented |
| Issue Board | Issues display with status and priority | ✅ Implemented |
| Photo Gallery | Photos display with thumbnails | ✅ Implemented |
| Photo Gallery lightbox | Click thumbnail opens lightbox | ✅ Implemented |
| Meeting Notes tab | Tab appears in navigation | ✅ Implemented |
| Meeting Notes view | Records display with filters and status | ✅ Implemented |
| Subscription manager (view-aware) | Listeners managed centrally per active view | ✅ Implemented |
| Pagination / Load More | Bounded queries, Load More button for all 8 views | ✅ Implemented |
| Listener cleanup on view switch | Inactive view listeners removed | ✅ Implemented |
| Listener cleanup on project change | Previous-project listeners removed | ✅ Implemented |
| Listener cleanup on close | All Office listeners removed | ✅ Implemented |
| Reports | Daily report, issues, materials, tasks, meetings | ✅ Implemented |

## Selfie Attendance

| Item | Expected | Status |
|---|---|---|
| Feature flag | Disabled by default (PMOS_CONFIG.faceAttendanceEnabled) | ✅ Implemented |
| Not mandatory | Core PMOS works without face attendance | ✅ Implemented |
| No models loaded | face-api models not downloaded when disabled | ✅ Implemented |
| No camera calls | Camera permissions not requested when disabled | ✅ Implemented |
| No UI artifacts | No blank attendance panel when disabled | ✅ Implemented |
| Lazy initialization | Models load only on explicit open() | ✅ Implemented |
| Lifecycle API | isEnabled(), open(), close(), destroy(), getState() | ✅ Implemented |
| Media cleanup | close() stops all media tracks | ✅ Implemented |
| Listener cleanup | close() removes Firebase listeners | ✅ Implemented |
| Timer cleanup | close() clears intervals/timeouts | ✅ Implemented |

## Security

| Item | Expected | Status |
|---|---|---|
| Unassigned read denied | User cannot read projects not assigned to | ✅ Implemented (proposed rules) |
| Viewer write denied | Viewer role cannot create records | ✅ Implemented (proposed rules) |
| Archived protected | Archived records not editable | ✅ Implemented (app-layer) |
| Own record edit | Can edit own drafts/queued/unreviewed records | ✅ Implemented |
| Cannot edit others | Cannot edit other user's protected records | ✅ Implemented (app-layer) |
| Audit log append-only | Existing audit entries cannot be overwritten | ✅ Implemented (proposed rules) |

## General Quality

| Item | Expected | Status |
|---|---|---|
| No console errors | Open DevTools, no critical errors | ⚠️ Requires browser runtime |
| Mobile layout | No horizontal overflow, proper safe areas | ✅ Implemented |
| Empty states | Useful messages when no records | ✅ Implemented |
| Loading states | Clear indicators during operations | ✅ Implemented |
| Subscription listener count | Stable listener count across view switches | ✅ Implemented (countable via getActiveCount) |
| Pagination behavior | Load More loads next page without duplicates | ✅ Implemented |
| Lightbox navigation | Next/prev/close/escape all work | ✅ Implemented |
| Sync indicator | Shows sync status in header | ✅ Implemented |
| Whitespace clean | No trailing whitespace in branch files | ✅ Verified |
| Syntax valid | All JS files pass node --check | ✅ Verified |
