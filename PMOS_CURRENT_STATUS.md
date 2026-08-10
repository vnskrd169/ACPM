# PMOS Current Status

**Date:** 2026-08-10
**Status:** RC6 PAYROLL INTEGRITY + LOCAL DEV SHELL — FULL REGRESSION VERIFIED
**Photo storage policy:** Google Drive Apps Script only for PMOS RC1
**Firebase Storage:** Not used by the PMOS sendout shell

## Summary

PMOS is ready for controlled company usage. The field app uses the scoped
`/pmos/` shell, Drive-only photo configuration, isolated PMOS cache
`pmos-cache-v4`, and root ACPM cache `acpm-v134`. Payroll integrity work
(pure `payroll-math.js` formulas, cash advance carry-forward, immutable
released payroll) and the local dev shell (never deployed) are fully
verified by the 2026-08-10 full regression run.

## Current Parameters

| Parameter | Current Value | Status |
|---|---|---:|
| Root app cache | `acpm-v134` | PASS |
| Main shell script | `main.js?v=106` | PASS |
| PMOS shell cache | `acpm-pmos-v4` | PASS |
| PMOS scoped cache | `pmos-cache-v4` | PASS |
| PMOS manifest start URL | `./` | PASS |
| Root manifest start URL | `./login.html` | PASS |
| PMOS theme color | `#0f766e` | PASS |
| ACPM brand files | `assets/brand/acpm/*` | PASS |
| PMOS CSS | `assets/brand/pmos-app.css` | PASS |
| Photo provider | Google Drive Apps Script | PASS |
| Firebase Storage in PMOS shell | Not loaded | PASS |
| Face Attendance in PMOS shell | Not loaded | PASS |
| Payroll math module | `payroll-math.js?v=2` | PASS |
| Labor module | `labor.js?v=97` | PASS |

## QA Evidence (full regression 2026-08-10)

- Playwright Office/PMOS browser QA: **24 passed / 0 failed**
- PMOS + payroll unit tests: **74 passed / 0 failed**
- PMOS database rules emulator: **24 passed / 0 failed**
- Payroll financial rules emulator: **13 passed / 0 failed**
- Production role rules emulator: **13 passed / 0 failed**
- Storage rules suite: **skipped** — documented pinned emulator runtime
  limitation (cross-service `database()` access not compiled by
  `cloud-storage-rules-runtime-v1.1.3`), not an app defect.
- Static gates 9/9: rc1_static, pwa_cache, rc1_docs, pmos_release,
  historical_integrity, ui_workflow, pm_apm_task_workflow, dev_shell,
  environment — all PASS.
- JS syntax checks for changed PMOS/PWA files: **PASS**
- Firebase JSON/rules parse: **PASS**

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
- Payroll compile with cash advance deduction and carry-forward
- RFP from archived NET payroll (snapshot rates)
- Local dev shell (`dev-shell.html`, localhost only, never deployed)

## Known Limitations

- Storage rules emulator suite stays skipped until the emulator runtime is
  upgraded (pinned `cloud-storage-rules-runtime-v1.1.3` limitation).
- Real Google Drive upload was not live-write tested in this pass.
- Face Attendance remains disabled.
- Viewer, Foreman, and Safety are future roles and cannot access project data
  in RC1.
- Firebase Storage files/rules may still exist for future paths, but PMOS RC1
  does not use them.

## Recommendation

Proceed with company UAT using the deployed Firebase Hosting site after
deployment. Ask users to hard refresh once or reopen the app after install so
the new service worker/cache versions are active.
