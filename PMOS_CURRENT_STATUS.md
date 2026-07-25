# PMOS Current Status

**Date:** 2026-07-19
**Status:** READY FOR CONTROLLED COMPANY SENDOUT / UAT
**Photo storage policy:** Google Drive Apps Script only for PMOS RC1
**Firebase Storage:** Not used by the PMOS sendout shell

## Summary

PMOS is ready for controlled company usage. The field app now uses the scoped `/pmos/` shell, Drive-only photo configuration, isolated PMOS cache `pmos-cache-v2`, and root ACPM cache `acpm-v125`.

The latest QA pass found and fixed two rollout blockers:

- Hidden PMOS action sheet could intercept clicks while closed.
- PMOS could inherit the root ACPM service worker registration path through `main.js`.

Both are fixed and covered by browser QA.

## Current Parameters

| Parameter | Current Value | Status |
|---|---|---:|
| Root app cache | `acpm-v125` | PASS |
| Main shell script | `main.js?v=102` | PASS |
| PMOS shell cache | `acpm-pmos-v2` | PASS |
| PMOS scoped cache | `pmos-cache-v2` | PASS |
| PMOS manifest start URL | `./` | PASS |
| Root manifest start URL | `./login.html` | PASS |
| PMOS theme color | `#0f766e` | PASS |
| ACPM brand files | `assets/brand/acpm/*` | PASS |
| PMOS CSS | `assets/brand/pmos-app.css` | PASS |
| Photo provider | Google Drive Apps Script | PASS |
| Firebase Storage in PMOS shell | Not loaded | PASS |
| Face Attendance in PMOS shell | Not loaded | PASS |

## QA Evidence

- PMOS Playwright browser QA: **17 passed / 0 failed**
- PMOS unit tests: **56 passed / 0 failed**
- PMOS release static QA: **PASS**
- RC1 static gate: **PASS**
- PWA cache static QA: **PASS**
- RC1 docs static QA: **PASS**
- JS syntax checks for changed PMOS/PWA files: **PASS**
- Firebase JSON/rules parse: **PASS**
- Firebase database dry-run: **PASS**

## Ready Workflows

- Field app load
- Project selection
- Quick Update
- Site Log
- Issue/Punchlist
- Material Request
- Follow-up Task
- Meeting Notes
- Offline queue
- Offline reload through PMOS service worker
- PMOS Office views
- Boss/Reviewer access
- Viewer blocked for RC1
- Logout cleanup

## Known Limitations

- Real Google Drive upload was not live-write tested in this pass.
- Face Attendance remains disabled.
- Viewer, Foreman, and Safety are future roles and cannot access project data in RC1.
- Firebase Storage files/rules may still exist for future paths, but PMOS RC1 does not use them.

## Recommendation

Proceed with company UAT using the deployed Firebase Hosting site after deployment. Ask users to hard refresh once or reopen the app after install so the new service worker/cache versions are active.
