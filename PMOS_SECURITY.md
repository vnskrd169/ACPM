# PMOS Security Guide

## Firebase Realtime Database Rules

PMOS uses Firebase Realtime Database for all data storage. The rules enforce:

### Authentication
- All database access requires Firebase Authentication
- Unauthenticated reads/writes are denied

### Project Access
- Boss/Owner/Admin roles: full read/write access to all projects
- PM/APM roles: read/write only to assigned projects
- Project membership checked via `users/{uid}/projects/{pid}` or `users/{uid}/bossOf/{pid}`

### Write Permissions
- Users can only write to PMOS paths for their assigned projects
- Users cannot approve their own material requests (client-side enforcement requires server-side validation)
- Archived records have write protection via the `archived` flag

### Storage Rules
- Photo uploads are restricted to `pmos/{projectId}/{module}/{year}/{month}/` paths
- Users must be authenticated and assigned to the project

## Local Data Security

### IndexedDB
- Photo queue and offline records stored in IndexedDB
- IndexedDB is sandboxed per browser origin
- No passwords or auth tokens stored
- Queue cleared after successful sync

### localStorage
- Only project preference stored (no credentials)
- Drafts stored locally, cleared on submission

### Session Handling
- Firebase Auth session persists via localStorage (default)
- Logout clears all local state
- Service worker cache cleared on version update

## Face Attendance Limitations

- Face recognition is optional and disabled by default
- Requires explicit feature flag (`PMOS_CONFIG.faceAttendanceEnabled`)
- All attendance records require manual review
- No automatic payroll consequences
- Face descriptors are stored in restricted database paths
- Recognition is confidence-based, not infallible
- Workers must provide consent before enrollment

## Audit Trail

PMOS logs the following actions:
- Record creation
- Record editing
- Status changes
- Archiving/restoration
- Photo capture
- Synchronization conflicts

Audit records are stored in `auditLogs/` with:
- Actor UID and name
- Action type
- Module and project context
- Timestamp
- Human-readable summary

## Known Security Limitations

1. **Client-side permission checks**: Some permission logic runs client-side with server-side rule enforcement as the backstop.
2. **Material request self-approval**: The UI prevents self-approval but Firebase rules allow it — requires a Cloud Function for full enforcement.
3. **No rate limiting**: Firebase provides no built-in rate limiting for writes.
4. **Photo EXIF data**: EXIF data is stripped during client-side compression but not guaranteed removed.
