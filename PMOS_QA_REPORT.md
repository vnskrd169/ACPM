# PMOS QA Report

**Date:** 2026-07-19
**Status:** PASS - PMOS RC1 sendout QA complete
**Production Firebase project:** `acpm-project-system`

## Scope

This pass verifies the ACPM PMOS field app and PMOS Office surface for company usage readiness:

- ACPM/PMOS branding assets, colors, manifest, and local asset references
- Drive-only photo configuration, with Firebase Storage removed from the PMOS rollout shell
- PMOS scoped service worker and root ACPM service worker isolation
- Field capture workflows
- PMOS Office/reviewer workflows
- RC1 role rules, including blocking Viewer/field future roles
- Offline queue and offline shell behavior
- Syntax, static QA, JSON/rules parse, and Firebase database dry-run

## Implementation Findings

| Area | Result | Evidence |
|---|---:|---|
| PMOS shell without Firebase Storage | PASS | `pmos/index.html` no longer loads Firebase Storage SDK or `face-attendance.js`. |
| Google Drive photo path | PASS | `acpm-shell.js` keeps `photoStorageProvider: "googleDrive"`, `useFirebaseStoragePhotos: false`, and Drive Apps Script URL configured. |
| Face Attendance for PMOS sendout | PASS | Disabled and unloaded from PMOS field shell. No Firebase Storage dependency in sendout path. |
| PMOS scoped service worker | PASS | `/pmos/pmos-sw.js` uses `pmos-cache-v2`; root `sw.js` leaves `/pmos/` routes to scoped PMOS worker. |
| ACPM app shell cache | PASS | Root cache is `acpm-v125`; `main.js` shell is cache-busted to `main.js?v=102`. |
| Hidden action sheet click blocking | FIXED | `.pmos-action-sheet.hidden` now forces `display: none`, `visibility: hidden`, and `pointer-events: none`. |
| PMOS PWA registration conflict | FIXED | `main.js` no longer registers the root ACPM service worker on the PMOS page. PMOS uses its scoped worker only. |
| Viewer access | PASS | Viewer is blocked in RC1 with the planned field-user release message. |

## Browser QA

Command:

```powershell
npm.cmd run test:e2e -- --project=chromium tests/e2e/pmos-workflow.spec.ts --reporter=line
```

Result:

- **17 passed / 0 failed**

Covered:

- PMOS shell load
- Quick Update create/submit
- Site Log create/submit
- Issue create/submit
- Material Request create/submit
- Follow-up Task create/submit
- Meeting Notes create/submit
- Offline queue
- PMOS Office open
- PMOS Office tab switching
- Issue Board
- Meeting Notes Office view
- Viewer blocked in RC1
- Boss access
- `pmos.html` redirect/load
- Offline reload with service worker
- Logout cleanup

## Unit QA

Command:

```powershell
npm.cmd run test:pmos
```

Result:

- **3 files passed**
- **56 tests passed**

Suites:

- `tests/pmos/core.test.ts`
- `tests/pmos/pagination.test.ts`
- `tests/pmos/subscription-manager.test.ts`

## Static / Rules QA

Passed:

```powershell
node scripts\pmos_release_static_qa.js
node scripts\rc1_static_gate.js
node scripts\pwa_cache_static_qa.js
node scripts\rc1_docs_static_qa.js
node --check acpm-shell.js
node --check pmos.js
node --check pmos-office.js
node --check pmos-subscription-manager.js
node --check pmos-photo-lightbox.js
node --check main.js
node --check sw.js
node --check pmos\pmos-sw.js
node --check pmos-sw.js
node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8')); JSON.parse(require('fs').readFileSync('firebase.json','utf8')); console.log('json ok')"
firebase.cmd deploy --only database --dry-run
```

Firebase database dry-run result:

- Rules syntax valid
- Dry run complete

## Known Limitations

- Real Google Drive photo upload was not live-write tested in this pass to avoid creating company test uploads. The configured Apps Script endpoint is present and the PMOS app is wired to use it.
- Firebase Storage remains present in the repository for future/non-PMOS paths, but the PMOS sendout shell does not load or use it.
- Face Attendance remains intentionally disabled for PMOS RC1 sendout.
- RC1 active roles are Boss/Owner, Admin, PM, and APM. Viewer, Foreman, and Safety stay documented as future roles until child-level Firebase read rules are designed.

## Release Recommendation

**PASS - PMOS is ready for controlled company sendout/UAT.**

Use the deployed ACPM site and ask users to refresh once after deployment so `acpm-v125`, `main.js?v=102`, and `pmos-cache-v2` are active.
