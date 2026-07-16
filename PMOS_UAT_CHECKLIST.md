# PMOS User Acceptance Checklist

> Use this checklist for one-pass owner review of the PMOS official app upgrade.

## Branding and App Shell

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| ACPM logo displays correctly | Logo mark visible on loading screen | ☐ | ☐ | |
| PMOS logo displays correctly | PMOS brand visible in header | ☐ | ☐ | |
| Loading screen | Animated branded loading with status text | ☐ | ☐ | |
| App version | Version number visible in More tab | ☐ | ☐ | |
| Bottom navigation | Home, Updates, Create, Tasks, More tabs visible | ☐ | ☐ | |
| Create action sheet | Tapping Create opens action sheet with all modules | ☐ | ☐ | |
| Project context | Current project shown in header and bar | ☐ | ☐ | |
| No raw project UIDs | Only human-readable project names displayed | ☐ | ☐ | |

## Installation (PWA)

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| Installable | Install prompt appears on supported browsers | ☐ | ☐ | |
| Standalone mode | Opens without browser chrome | ☐ | ☐ | |
| Update prompt | New version banner appears after deploy | ☐ | ☐ | |
| Offline fallback | Cached PMOS shell loads offline | ☐ | ☐ | |
| Existing pmos.html | Old links still work | ☐ | ☐ | |

## Authentication

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| Valid user sign-in | Field user can sign in | ☐ | ☐ | |
| Inactive user blocked | Suspended/archived user shown pending screen | ☐ | ☐ | |
| Unassigned user | Cannot view project records | ☐ | ☐ | |
| Logout | Signs out and returns to login | ☐ | ☐ | |

## Quick Update

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| Create | Draft saves locally, submit writes to Firebase | ☐ | ☐ | |
| Draft resume | Saved draft restores after page refresh | ☐ | ☐ | |
| Appears in Office | Submitted update visible in PMOS Office Inbox | ☐ | ☐ | |
| Duplicate prevention | Same record not created twice | ☐ | ☐ | |

## Site Log

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| All fields | Date, weather, manpower, accomplishment, etc. | ☐ | ☐ | |
| Offline save | Draft saved offline, syncs on reconnect | ☐ | ☐ | |
| Appears in Office | Submitted log visible in Site Logs view | ☐ | ☐ | |

## Issues

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| Create issue | Report issue with location, priority, assignee | ☐ | ☐ | |
| Status workflow | Open → Assigned → In Progress → Verified → Closed | ☐ | ☐ | |
| Edit own issue | Can edit own open issues | ☐ | ☐ | |
| Archive | Can archive own issues | ☐ | ☐ | |

## Material Requests

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| All fields | Item, quantity, unit, needed date, purpose | ☐ | ☐ | |
| Status workflow | Draft → Submitted → Reviewed → Approved/Rejected → Ordered → Delivered | ☐ | ☐ | |
| Self-approval prevented | User cannot approve own request | ☐ | ☐ | |

## Follow-up Tasks

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| Create task | Task with person, due date, priority | ☐ | ☐ | |
| Task views | Overdue, due today, open sections | ☐ | ☐ | |
| Badge | Task badge in bottom nav shows overdue count | ☐ | ☐ | |

## Meeting Notes

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| Create meeting | Title, date, type, attendees, agenda, etc. | ☐ | ☐ | |
| Status workflow | Draft → Submitted → Reviewed → Closed → Archived | ☐ | ☐ | |
| Appears in Office | Meeting visible in Office Meeting Notes tab | ☐ | ☐ | |
| Meeting Notes filters | Filter by project, status, type, date | ☐ | ☐ | |
| Office Meeting Notes tab | Tab appears in PMOS Office navigation | ☐ | ☐ | |
| Meeting Notes report | Print meeting report with all fields | ☐ | ☐ | |
| Action item conversion | Action items tracked in detail view | ☐ | ☐ | |

## Photos

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| Camera capture | Camera opens | ☐ | ☐ | |
| Compression | Photo compressed to ~1600px | ☐ | ☐ | |
| Upload progress | Progress bar visible during upload | ☐ | ☐ | |
| Retry failed | Failed uploads show retry button | ☐ | ☐ | |
| Queue visible | Pending uploads shown in More tab | ☐ | ☐ | |
| Photo Gallery lightbox | Office gallery opens lightbox with navigation | ☐ | ☐ | |

## Offline Mode

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| Record offline | All modules save to IndexedDB offline | ☐ | ☐ | |
| Queue persists | Queue survives page refresh | ☐ | ☐ | |
| Auto-sync | Reconnect triggers sync | ☐ | ☐ | |
| No duplicates | Only one remote record created per offline save | ☐ | ☐ | |
| Offline queue states | Draft, queued, syncing, synced, failed, conflict | ☐ | ☐ | |
| Retry failed items | Manual retry for individual failed items | ☐ | ☐ | |

## Office Hub

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| Inbox loads | Records appear in PMOS Office Inbox | ☐ | ☐ | |
| Filters work | Project, module, status, priority, date filters | ☐ | ☐ | |
| Issue Board | Issues display with status and priority | ☐ | ☐ | |
| Photo Gallery | Photos display with thumbnails | ☐ | ☐ | |
| Photo Gallery lightbox | Click thumbnail opens lightbox | ☐ | ☐ | |
| Meeting Notes tab | Tab appears in navigation | ☐ | ☐ | |
| Meeting Notes view | Records display with filters and status | ☐ | ☐ | |
| Subscription manager | Listeners managed centrally | ☐ | ☐ | |
| Pagination / Load More | Bounded queries, Load More button | ☐ | ☐ | |
| Reports | Daily report, issues, materials, tasks, meetings | ☐ | ☐ | |

## Selfie Attendance

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| Feature flag | Disabled by default (PMOS_CONFIG.faceAttendanceEnabled) | ☐ | ☐ | |
| Not mandatory | Core PMOS works without face attendance | ☐ | ☐ | |
| No models loaded | face-api models not downloaded when disabled | ☐ | ☐ | |
| No camera calls | Camera permissions not requested when disabled | ☐ | ☐ | |
| No UI artifacts | No blank attendance panel when disabled | ☐ | ☐ | |

## Security

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| Unassigned read denied | User cannot read projects not assigned to | ☐ | ☐ | |
| Viewer write denied | Viewer role cannot create records | ☐ | ☐ | |
| Archived protected | Archived records not editable | ☐ | ☐ | |
| Own record edit | Can edit own drafts/queued/unreviewed records | ☐ | ☐ | |
| Cannot edit others | Cannot edit other user's protected records | ☐ | ☐ | |

## General Quality

| Item | Expected | Pass | Fail | Notes |
|---|---|---|---|---|
| No console errors | Open DevTools, no critical errors | ☐ | ☐ | |
| Mobile layout | No horizontal overflow, proper safe areas | ☐ | ☐ | |
| Empty states | Useful messages when no records | ☐ | ☐ | |
| Loading states | Clear indicators during operations | ☐ | ☐ | |
| Subscription listener count | Stable listener count across view switches | ☐ | ☐ | |
| Pagination behavior | Load More loads next page without duplicates | ☐ | ☐ | |
| Lightbox navigation | Next/prev/close/escape all work | ☐ | ☐ | |
| Sync indicator | Shows sync status in header | ☐ | ☐ | |
