# PMOS Data Model

## Global Paths (Root-level)

### `pmosUpdates`
| Field | Type | Required | Notes |
|---|---|---|---|
| projectId | string | ✓ | Firebase project ID |
| projectName | string | ✓ | Human-readable project name |
| category | string | ✓ | General, Schedule, Materials, Labor, Client, Safety, Quality |
| note | string | ✓ | Quick update note |
| workAccomplished | string | | What was done |
| blockers | string | | Issues blocking work |
| nextActivity | string | | Planned next work |
| priority | string | | Normal, High, Critical, Low |
| status | string | | New, Reviewed, In Progress, Waiting, Done, Archived |
| dueDate | string | | ISO date |
| createdAt | number | ✓ | Unix timestamp |
| createdBy | string | | User UID |
| createdByName | string | | User display name |
| source | string | | "Line17 PMOS" |

### `pmosSiteLogs`
| Field | Type | Notes |
|---|---|---|
| date, weather, workingHours | string | Basic site info |
| manpowerCount | number | Total workers |
| manpowerByTrade | string | Breakdown by trade |
| subcontractors | string | On-site subcontractors |
| visitors | string | Site visitors |
| equipment | string | Equipment used |
| deliveries | string | Deliveries received |
| accomplishment | string | ✓ Required |
| siteInstructions | string | Instructions given |
| delays | string | Delays encountered |
| safetyObservations | string | Safety notes |
| qualityObservations | string | Quality notes |
| incidents | string | Incidents |
| nextDayPlan | string | Plan for next day |
| remarks | string | Additional notes |

### `pmosIssues`
| Field | Type | Notes |
|---|---|---|
| location | string | ✓ Required |
| issue | string | ✓ Required |
| category | string | Structural, Architectural, MEPFS, Safety, Quality, Design, Other |
| assignedTo | string | Person assigned |
| responsibleTrade | string | Trade responsible |
| priority | string | Normal, High, Critical, Low |
| status | string | Open → Assigned → In Progress → For Verification → Closed → Reopened → Archived |
| dueDate | string | ISO date |
| targetDate | string | Target resolution date |
| photoUrl | string | Optional photo link |
| resolution | string | Resolution notes |

### `pmosMaterialRequests`
| Field | Type | Notes |
|---|---|---|
| item | string | ✓ Required |
| description | string | Detailed description |
| specification | string | Technical spec |
| quantity | number | ✓ Required |
| unit | string | ✓ Required (pcs, kg, m, etc.) |
| preferredBrand | string | Brand preference |
| neededDate | string | ✓ Required |
| purpose | string | Reason for request |
| priority | string | Normal, High, Critical, Low |
| status | string | Draft → Submitted → Under Review → Approved/Partially Approved/Rejected → For Procurement → Ordered → Partially Delivered/Delivered → Cancelled → Archived |

### `pmosTasks`
| Field | Type | Notes |
|---|---|---|
| task | string | ✓ Required |
| person | string | ✓ Required |
| company | string | Company optional |
| dueDate | string | ✓ Required |
| priority | string | Normal, High, Critical, Low |
| status | string | Open → In Progress → Waiting → Done → Cancelled → Archived |
| remarks | string | Additional notes |

### `pmosMeetingNotes`
| Field | Type | Notes |
|---|---|---|
| meetingTitle | string | ✓ Required |
| meetingDate | string | ✓ Required |
| meetingType | string | Site Coordination, Client Meeting, etc. |
| attendees | string | Attendee names |
| location | string | Location or online platform |
| agenda | string | Meeting agenda |
| discussion | string | Discussion summary |
| decisions | string | Decisions made |
| actionItems | string | Action items |
| assignedPersons | string | Persons assigned to actions |
| targetDates | string | Target dates for actions |
| status | string | Draft → Submitted → Reviewed → Action Required → Closed → Archived |

### `pmosPhotoLogs`
| Field | Type | Notes |
|---|---|---|
| caption | string | ✓ Required |
| location | string | ✓ Required |
| category | string | Progress, Issue, Delivery, Safety, Quality, Before, After |
| photoUrl | string | Firebase Storage or Drive URL |
| thumbnailUrl | string | Small preview |
| storageProvider | string | Firebase Storage or Google Drive |
| uploadStatus | string | Queued, Uploading, Synced, Failed |

## Schema Version

All new records include:
```json
{ "schemaVersion": "1.0" }
```

## Audit Fields

Records with edit/archive actions include:
```json
{
  "updatedAt": 1234567890,
  "updatedBy": "uid",
  "updatedByName": "User Name",
  "archived": true,
  "archivedAt": 1234567890,
  "archivedBy": "uid",
  "archiveReason": "Reason"
}
```

## Indexes

Each global PMOS path has appropriate `.indexOn` declarations in `database.rules.json`:
- `projectId` — for project-scoped queries
- `status` — for status filtering
- `priority` — for priority sorting
- `createdAt` — for chronological ordering
- `dueDate` / `neededDate` — for deadline queries
- `assignedTo` / `person` — for assignment queries
- `clientGeneratedId` — for offline deduplication
