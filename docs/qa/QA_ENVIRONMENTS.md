# ACPM Production and Staging QA

Status: STABLE - PRODUCTION AND STAGING V132 LIVE VERIFIED

Last verified: 2026-07-31

## Environment Isolation

| Check | Result | Evidence |
| --- | --- | --- |
| Separate Firebase projects | PASS | Production uses `acpm-project-system`; Staging uses `acpm-project-system-qa`. |
| Separate Realtime Databases | PASS | Staging uses `acpm-project-system-qa-default-rtdb` in `asia-southeast1`. |
| Hostname selection | PASS | Public Staging selected QA config. Production remained on its existing v130 shell and ignored `?env=staging`. |
| Local safety default | PASS | Localhost selects Staging unless `?env=production` is explicit. |
| Visible test indicator | PASS | Public Staging displayed `STAGING - TEST DATA` and `[STAGING]` page title. |
| PWA manifest isolation | PASS | Staging selected `manifest-staging.json`; PMOS selects `pmos-manifest-staging.json`. |
| Service worker | PASS | Public Staging active controller is `/sw.js`; v132 supersedes the initially verified v131 shell after logout-listener cleanup. |
| PMOS cache | PASS | Public PMOS shell serves `pmos-cache-v3`; signed-out PMOS correctly redirects to Staging login. |
| Production deploy guard | PASS | Production script failed closed without `-ConfirmProduction`. |
| Firebase rules deploy | PASS | QA database rules parsed and released successfully. |
| QA Authentication | PASS | Email/Password Auth initialized; isolated Boss QA profile signed in successfully. |
| QA Google provider | PASS | Staging OAuth brand/client provisioned with Firebase CLI; `google.com` is enabled and returns an `accounts.google.com` authorization URI. |
| QA Google UI flows | PASS | Both **Continue with Google** and **Request with Google** open the provider flow without `auth/operation-not-allowed`. |
| Production promotion | PASS | Exact Staging-verified v132 source promoted through the guarded Hosting-only deployment. |

## Regression QA

| Suite | Result |
| --- | --- |
| Environment static gate | PASS |
| JavaScript syntax and JSON parse | PASS |
| PWA cache static gate | PASS |
| RC1 static gate | PASS |
| PMOS release static gate | PASS |
| PMOS unit tests | PASS - 56/56 |
| Production role rules emulator | PASS - 13/13 |
| ACPM Office/PMOS Playwright | PASS - 24/24 |
| Public Staging console/page errors | PASS - none during signed-out shell smoke |
| Real Staging project lifecycle | PASS - create, open, refresh, edit, complete, reopen, archive, restore, final archive |
| Real Production signed-in smoke | PASS - Boss profile, five active cards, refresh, logout, no console errors |

## Bug Found And Fixed

- Real Staging logout initially produced `permission_denied at /projects`.
- Root cause: Hub and module Firebase listeners were still attached during the
  signed-out Auth transition.
- Fix: Auth cleanup now detaches Hub, workspace, Labor, Materials, Billing,
  Change Orders, Site Log, suppliers, equipment, compliance, defects, tasks,
  reports, and notification listeners before redirecting.
- Verification: logout/login rerun on public Staging v132 produced no console
  errors, followed by the clean full lifecycle pass.

## Known Limitations

- Staging starts empty and intentionally contains no copied production records.
- PMOS images continue to use the approved Google Drive Apps Script.
- Disposable QA lifecycle records remain archived in the isolated QA database
  as test evidence.

## Result

- Environment isolation: **PASS**
- Staging Hosting and database rules: **PASS**
- Signed-in Staging workflow: **PASS**
- Staging Google Authentication: **PASS**
- Production v132 promotion: **PASS**
- Environment release shell: **STABLE**
