# Face Attendance Assist QA

## Model Setup

The module uses real face descriptors through `@vladmandic/face-api`. It does not fake recognition if the model assets are missing.

Default model path:

```text
/models/face-api
```

Required model files for the default engine:

```text
ssd_mobilenetv1_model-weights_manifest.json
ssd_mobilenetv1_model-shard1
face_landmark_68_model-weights_manifest.json
face_landmark_68_model-shard1
face_recognition_model-weights_manifest.json
face_recognition_model-shard1
face_recognition_model-shard2
```

The path can be changed in ACPM > Face Attendance > Face Settings. Until the files are deployed, enrollment, lab scans, and PMOS selfie scans show a setup error instead of returning fake matches.

## Privacy and Safety Checks

- Confirm only enrolled workers are loaded for matching.
- Confirm `consentRecorded = true` is required before enrollment.
- Confirm revoked, inactive, disabled, or descriptorless workers are excluded.
- Confirm no base64 images are written to Realtime Database.
- Confirm reference photos, selfies, and test photos upload to Firebase Storage paths only.
- Confirm every selfie attendance starts with `reviewStatus: "For Review"` and `payrollStatus: "Not Posted"`.
- Confirm payroll posting is blocked until review status is `Approved`.
- Confirm audit rows are created for enrollment, descriptor generation, selfie submission, match suggestion, correction, approval, rejection, deletion, revocation, and payroll posting.

## Acceptance Tests

1. Enroll a worker with 3 valid photos.
2. Reject an enrollment photo with no face.
3. Reject an enrollment photo with multiple faces.
4. Scan a selfie of an enrolled worker in Face Engine Lab.
5. Show the expected worker as `Strong Match` when distance is within the configured threshold.
6. Scan an unknown person.
7. Show `Unknown / Needs Manual Review` when the distance is over the configured threshold.
8. Submit selfie attendance in PMOS while offline.
9. Confirm the selfie Blob, thumbnail Blob, and metadata are in IndexedDB.
10. Reopen PMOS online and confirm automatic sync.
11. Confirm the draft appears in ACPM Labor Attendance Inbox.
12. Approve attendance.
13. Reject attendance.
14. Change the suggested worker manually.
15. Confirm payroll cannot be posted until the draft is approved.
16. Confirm approved attendance can be posted to the existing labor attendance grid.
17. Confirm audit logs are visible in the Face Attendance Audit Logs view.

## Firebase Paths

```text
/workers/{projectId_workerId}
/projects/{projectId}/workers/{workerId}/faceEnrollment
/projects/{projectId}/workers/{workerId}/faceDescriptors
/pmosSelfieAttendance/{projectId}/{date}/{attendanceId}
/projects/{projectId}/pmosSelfieAttendance/{date}/{attendanceId}
/faceMatchTests/{testId}
/attendanceDailyCodes/{projectId}/{date}
/auditLogs/{logId}
/faceSettings
```

## Storage Paths

```text
/faceEnrollment/{projectId_workerId}/{timestamp}_{safeFilename}
/attendanceSelfies/{projectId}/{yyyy-mm-dd}/{attendanceId}_{safeFilename}
/attendanceSelfies/{projectId}/{yyyy-mm-dd}/thumb_{attendanceId}_{safeFilename}
/faceMatchTests/{testId}_{safeFilename}
```

## Known Production Note

Client-side matching requires descriptor reads in the browser. RTDB rules restrict descriptor metadata to authenticated ACPM/PMOS roles, but a backend matcher is the preferred future hardening step for stronger biometric privacy.
