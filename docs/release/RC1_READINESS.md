# ACPM RC1 Readiness Gate

Status: RC1 READY - PRODUCTION AND ISOLATED STAGING V132 LIVE VERIFIED

Current deployed release: cache v132, `style.css?v=107`,
`auth.js?v=98`, `main.js?v=106`, `tasks.js?v=95`,
`notifications.js?v=86`, `report.js?v=97`, `pmos-office.js?v=4`,
PMOS app v3, and canonical PMOS task adapter v2.

Last updated: 2026-07-31

## Current Production Sprint

- ACPM Office and PMOS use one canonical task record under
  `projects/{projectId}/tasks/{taskId}`.
- PM has company-wide project visibility, project creation, APM assignment,
  financial review, and task verification.
- APM remains assigned-project only and submits completed work for PM
  verification.
- Task states are `pending`, `in_progress`, `blocked`,
  `for_verification`, `completed`, and `cancelled`.
- Completed tasks are terminal and leave Pending Works automatically.
- `index.html` is a compatibility redirect only; it does not render private UI.
- Firebase Storage remains optional and disabled for PMOS photos; the configured
  Google Drive Apps Script remains the photo transport.

## Current Pass Areas

| Area | Result | Evidence |
| --- | --- | --- |
| Authentication / routing / PWA shell | PASS | Multi-page route foundation is active. Current PWA cache static QA verifies cache v132, manifest `login.html` start URL, versioned `style.css?v=107`, environment selector v1, current `auth.js?v=98`, current `main.js?v=106`, and synchronized app-shell script versions. |
| Production / Staging isolation | PASS | Separate Firebase projects, databases, manifests, deployment targets, and visible Staging marker passed public browser QA. Real Staging lifecycle and real Production signed-in smoke passed on v132. See `docs/qa/QA_ENVIRONMENTS.md`. |
| Dashboard integration | PASS | Rollup data QA, dashboard static QA, Boss browser smoke, and live Firebase RC1 gate passed. Live v116 smoke confirms Hub is the return target from Team Admin and System Reports does not open accidentally. |
| Project lifecycle | PASS | Active/completed/archive behavior previously verified; dashboard cards render active and completed actions. |
| Labor v1 | PASS | Real Firebase cash advance/payroll archive QA passed via `scripts/labor_v1_cash_advance_real_qa.js`. |
| Materials v1 | PASS | Materials v1 documented stable; movement ledger/status/budget stabilization complete. |
| Billing v1 Phase 2 | PASS | Real Firebase helper QA plus browser UI/dashboard smoke passed. |
| Change Orders v1 | PASS | Real Firebase workflow/data QA passed; static workflow QA passed; Boss Extras smoke passed at cache `acpm-v85`; visible create/approve and reject-modal browser workflows passed against live Firebase. |
| Site Logs v1 | PASS with known limitation | Real Firebase workflow/data QA passed; media upload/offline queue remain future. |
| Reports v1 data foundation | PASS | Real Firebase rollup/snapshot QA passed; listener cleanup/static listener QA passed after adding the project-report and access-request listener checks; Boss Reports smoke passed at cache `acpm-v85`; current app shell loads `report.js?v=97`. |
| Roles RC1 lock | PASS | Firebase emulator role QA passed 13/13. PM has intended company-wide project access and may assign APM projects; APM is assigned-project only; pending/suspended/deferred roles are denied. |
| Task engine / PMOS sync | PASS | Canonical lifecycle static QA passed, production rules passed 13/13, and the complete Office/PMOS Playwright suite passed 24/24, including PM Project Assignments and light-theme report visibility. |

## Current Warning / Blocker Areas

| Area | Result | Why It Is Not Final |
| --- | --- | --- |
| Suppliers v1 | PASS | Core workflow, supplier canonical event/notification/rollup paths, and fallback behavior passed in real Firebase QA. |
| Audit Logs | PASS with warning | Project fallback and supplier fallback audit behavior passed in real Firebase QA. Browser/live evidence still shows global `/auditLogs` can be denied by deployed rules, so project fallback audit rows remain required. |
| Global Notification Events | PASS | Project and global notification event hooks passed in real Firebase QA. In-app bell consumption is wired and polished with per-user Clear read behavior, map-shaped project listener support, and sign-out listener cleanup; push notifications are intentionally future. |
| Firebase rules deployment | PASS | Published Realtime Database rules allow PM company-wide project visibility while denying APM root listing and allowing APM assigned-project access. |
| PM/APM/Admin role QA | PASS | `scripts/roles_live_account_qa.js` passes for Admin, PM, and APM with `rc1RoleAccountQaComplete = true`. |
| Account Onboarding | PASS | Focused live Firebase QA on 2026-07-13 passed signup, `accessRequests/{uid}`, Admin approval, profile setup, inline profile-photo persistence, self-write denial, suspend/reactivate/archive, audit, and notification event workflow. |
| Full real-write signup QA | PASS with controlled historical records | `scripts/account_onboarding_live_qa.js` creates labeled QA Auth/request/user records and leaves the QA user archived instead of deleting history. Do not bulk-delete historical request/user rows. |
| Controlled full real-write RC1 QA | ACCEPTED RELEASE RISK | The owner intentionally deferred a broad full-system real-write RC1 QA pass for now. Current evidence covers focused feature-batch QA plus existing module gates; any remaining full-system production issues should be captured from real project use and fixed as critical production bugs. |
| Task transition enforcement | WARNING | PM verification is enforced in the Office/PMOS task services. The broad assigned-project write grant means a future field-user release should add child-level transition rules before exposing external accounts. |

## Current Automated Evidence - 2026-07-29

```text
npx playwright test
24/24 PASS

firebase emulators:exec --only database --config firebase.emulator.json \
  --project acpm-production-rules-test "npm.cmd run test:production:rules"
13/13 PASS

firebase deploy --only database --dry-run --project acpm-project-system
PASS - rules syntax valid

firebase deploy --only hosting --project acpm-project-system
PASS - cache v130 released

node scripts/onboarding_ui_polish_smoke.js
PASS - live Boss notifications, Project Assignments, and profile UI

ACPM_REQUIRE_RC1_FINAL=1 node scripts/rc1_final_readiness_gate.js
PASS_RC1_READY - no warnings or failures

Live cache v130 focused browser smoke
PASS - five active-project attention rows rendered without raw HTML
PASS - light report hover rgb(247, 245, 255), readable project text
```

The browser suite covers PM/APM role surfaces, workspace refresh,
legacy-route redirection, PMOS forms, Office review views, offline queue,
deferred Viewer denial, responsive field layout, PWA behavior, and logout
cleanup.

Live v123 account/admin QA on 2026-07-13:

- Hosted app served cache `acpm-v125`, `auth.js?v=95`, `main.js?v=102`, `notifications.js?v=85`, `report.js?v=97`, and `style.css?v=103`.
- Request Access created a real Auth account plus `accessRequests/{uid}` pending record.
- Boss/Admin approval wrote the operational `users/{uid}` profile, audit log, global notification event, and direct notification.
- First approved login forced My Profile setup; profile fields and inline profile photo persisted.
- User self-write attempts for role/projects/status were denied.
- Team Admin suspend/reactivate/archive preserved history and blocked suspended/archived logins.
- Profile photo support uses Google Drive uploads with compressed inline avatar fallback (no Firebase Storage).
- UI polish smoke passed for mobile login/request pending, notification dropdown, Team Admin avatars/actions, and My Profile modal.
- Team Admin navigation smoke after cache v125 confirmed Admin sub-tabs remain visible in Admin mode, Team Admin opens directly to the Team assignment view, and project module tabs stay hidden.
| Hosting hygiene | PASS | Firebase Hosting ignore rules exclude root and nested Markdown files, test scripts, package metadata, and `nul`. Live static verification confirms private paths return 404 and cache v130 serves the corrected dashboard and report styles. |

## Stop Condition

Final live module and role security verification passed on 2026-07-02 and re-verified live on 2026-08-15 (pre-company-deploy):

```text
RUN_REAL_QA=1 node scripts/rc1_post_deploy_gate.js
Result: PASS (2026-07-02)

ACPM_ROLE_QA_ACCOUNTS=[admin,pm,apm] node scripts/roles_live_account_qa.js
Result: PASS (2026-08-15) — admin/pm/apm live role+project access verified

ACPM_ROLE_QA_ACCOUNTS=[pm,apm] node scripts/rc1_deployed_rules_security_qa.js
Result: PASS (2026-08-15) — PM root access / APM root-deny verified against live rules

node scripts/rc1_final_readiness_gate.js
Result: PASS_RC1_READY (2026-08-15) — zero failures, zero warnings
```

Foreman/Safety/Viewer are deferred and must not be activated until a future child-level read model and deployed-rule deny QA pass.

## RC1 QA Commands Passed Locally

```text
node --check auth.js
node --check main.js
node --check report.js
node --check notifications.js
node --check labor.js
node --check scripts/labor_v1_cash_advance_real_qa.js
node --check scripts/dashboard_static_qa.js
node --check scripts/changeorder_static_qa.js
node --check scripts/audit_notification_supplier_static_qa.js
node --check scripts/pwa_cache_static_qa.js
node --check scripts/reports_listener_static_qa.js
node --check scripts/rc1_docs_static_qa.js
node --check scripts/historical_integrity_static_qa.js
node --check scripts/roles_live_account_qa.js
node --check scripts/roles_live_inventory_qa.js
node --check scripts/rc1_final_readiness_gate.js
node --check scripts/rc1_static_gate.js
node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8'))"
node scripts/dashboard_static_qa.js
node scripts/changeorder_static_qa.js
node scripts/audit_notification_supplier_static_qa.js
node scripts/pwa_cache_static_qa.js
node scripts/reports_listener_static_qa.js
node scripts/rc1_docs_static_qa.js
node scripts/historical_integrity_static_qa.js
node scripts/roles_live_account_qa.js
node scripts/roles_live_inventory_qa.js
node scripts/rc1_final_readiness_gate.js
node scripts/firebase_rules_gate.js
node scripts/rc1_static_gate.js
node scripts/rc1_post_deploy_gate.js
```

Browser smoke passed:

- Dashboard route as signed-in Boss.
- Workspace route with `projectId` preserved.
- Team Admin role options exclude Foreman/Safety/Viewer.
- Loaded current cache/script set includes `style.css?v=103`, `auth.js?v=95`, `main.js?v=102`, `labor.js?v=94`, `materials.js?v=94`, `billing.js?v=75`, `changeorders.js?v=95`, `sitelog.js?v=94`, `suppliers.js?v=94`, `equipment.js?v=94`, `compliance.js?v=88`, `defects.js?v=94`, `tasks.js?v=94`, `notifications.js?v=85`, `report.js?v=97`, and `pmos-office.js?v=4`.
- Local browser smoke after PWA gate confirmed dashboard route loads cache v89 script set, auth settles to `role-boss auth-ready`, loader hides, and console errors are empty.
- Local browser smoke after historical-safety patch confirmed `labor.js?v=87` and `materials.js?v=87` load on dashboard with no console errors.
- Materials label polish after cache v93 removed invalid `\u1Fxxx` escapes from PO buttons and stock labels; static gate verifies clean `Approve Invoice` and `Image` labels.
- Materials browser smoke after cache v93 confirmed the Materials tab loads `materials.js?v=93` and visible PO buttons have no broken glyphs.
- Invalid Unicode escape cleanup after cache v94 removed broken-glyph label risk from Labor, Change Orders, Site Logs, Suppliers, Equipment, Defects, and Tasks; static gate now blocks invalid `\u1Fxxx` escapes across app modules.
- Browser label sweep after cache v94 opened Labor, Change Orders, Site Log, Suppliers, Tasks, Equipment, and Defects tabs; all current module scripts loaded and broken-glyph count was `0`.
- Login shell alignment after cache v96 updated `login.html` to load the current auth/routing scripts (`utils.js?v=84`, `auth.js?v=85`, `main.js?v=96`), and static gates now block stale login shell versions.
- PWA update hardening after cache v96 added an active service-worker update check and one-time reload on controller change so old cached dashboard/workspace shells are replaced after a version bump.
- Browser PWA update smoke after cache v96 reproduced an old controlled shell on the first redirected dashboard load, then confirmed the refreshed route loaded `main.js?v=96`, `labor.js?v=94`, `materials.js?v=93`, `changeorders.js?v=94`, and the other current module versions.
- Change Orders reject modal hardening after cache v97 updated the current app shell to `changeorders.js?v=95` and `acpm-v97`.
- Change Orders browser click-through after cache v97 created `CO-001` in `qa_mr342wcu_8satiur8`, opened the in-app reject modal, saved the rejection reason, confirmed Firebase status `rejected`, confirmed project fallback audit rows, and archived the QA project.
- Local browser smoke after optional-module historical-safety patch confirmed `equipment.js?v=88`, `compliance.js?v=88`, `defects.js?v=88`, and `tasks.js?v=88` load on dashboard with no console errors.
- Local browser smoke after Change Orders wording patch confirmed `changeorders.js?v=89` loads on dashboard with no console errors.
- Local browser workspace smoke after cache v89 confirmed `projectId = -Ow60wuOtFmGmXo1cBOp` remains in the route, workspace reaches `role-boss auth-ready`, and console errors are empty.
- Local browser smoke after cache v92 confirmed versioned stylesheet loading, Admin Requests/Audit tab navigation remains clickable on a read-only project, and Audit rows render.
- Local browser read-only surface smoke after cache v92 confirmed Reports, Change Orders, and Suppliers tabs render with no console errors.
- Final dashboard shell smoke after cache v92 confirmed `style.css?v=92`, the then-current `main.js?v=90`, `role-boss auth-ready`, hidden loader, and no console errors.
- Signed-in `login.html` smoke after cache v92 redirected to `dashboard.html`, loaded `style.css?v=92`, reached `role-boss auth-ready`, and had no console errors.
- Dashboard contains workspace handoff action for active project via `openProjectFromHub(projectId)`.
- Reports button read-only smoke passed with no console errors.
- Extras/Change Orders read-only smoke passed with no console errors.
- Console errors: none.
- Historical browser warning note: older browser log buffers may retain pre-deploy audit permission warnings by timestamp; live Firebase RC1 gate passed after rules update.

Additional live fallback QA passed:

- Supplier fallback QA result: PASS
- Audit project fallback QA: PASS
- Active QA projects after cleanup: `0`
- RC1 static gate result: PASS
- Dashboard static QA: PASS
- Change Order static workflow QA: PASS
- Report listener cleanup static QA: PASS
- Report cross-project listener static QA: PASS
- Audit fallback review static QA: PASS
- Safer supplier audit fallback root path static QA: PASS
- Audit/notification/supplier integration static QA: PASS
- PWA/cache consistency static QA: PASS
- RC1 docs/static completion QA: PASS
- Historical integrity static QA: PASS, including Labor, Materials, Equipment, Compliance, Defects, Tasks, Billing, Change Orders, Site Logs, Suppliers, and Project lifecycle delete/archive flows.
- UI workflow static QA: PASS, including visible Change Order and Site Log tab/form/action wiring.
- RC1 role matrix static QA: PASS
- RC1 role/UI/rule matrix static QA after cache v96: PASS
- Live role-account gate: PASS for Boss/Admin/PM/APM accounts; `rc1RoleAccountQaComplete = true`.
- Live user-role inventory after final QA: PASS_READ_ONLY_INVENTORY; live `users` contains `admin` = 1, `pm` = 2, `apm` = 2, and `boss` = 2, with no `foreman`, `safety`, or `viewer` profiles.
- Live Boss Team Admin browser smoke after cache v97: PASS; signed-in Boss rendered 4 live management profiles, including 2 APM users, with role dropdowns limited to Boss/Admin/PM/APM and no console errors.
- Live inventory now reports RC1-specific profile readiness fields: Admin, PM, and APM profiles are present.
- Owner-approved RC1 QA Admin/PM/APM Auth accounts were provisioned on 2026-07-02 using `scripts/provision_rc1_role_qa_accounts.js`.
- Dedicated Admin/PM/APM role-account QA: PASS. Admin and PM can read the project index; APM is denied full-root `projects` reads and can read assigned project data.
- Dedicated deployed-rule security gate: PASS. `scripts/rc1_deployed_rules_security_qa.js` verifies PM company-wide visibility and APM root-deny/assigned-project-allow behavior.
- Credentialed post-deploy local gate: PASS_WITH_REAL_QA_SKIPPED with `scripts/rc1_deployed_rules_security_qa.js` included and passing.
- RC1 final readiness gate with dedicated Admin/PM/APM credentials: PASS_RC1_READY. Field-role deny QA is a future activation gate because no deferred-role profiles exist.
- Cache v129 live Boss UI smoke: PASS. Project Assignments renders 7 users,
  all Boss admin tabs are visible, project module tabs remain hidden in admin
  mode, notifications render, and My Profile fits the production viewport.
- RC1 post-deploy local gate: PASS_WITH_REAL_QA_SKIPPED; rerun with Boss credential also covered the live role inventory script.
- Live Firebase RC1 gate: PASS on 2026-07-02
- Live real QA scripts passed: Suppliers, Audit/Notifications, Labor cash advance/payroll, Reports, Site Logs, Change Orders, and Billing Phase 2.

QA cleanup:

```text
activeQaProjects = 0
```

## Next Recommended Step

Prepare the RC1 release package/tag. Do not activate Foreman/Safety/Viewer until the future child-level Firebase read model exists and dedicated deny QA passes.

Use `node scripts/rc1_final_readiness_gate.js` as the release decision gate. It must return `PASS_RC1_READY` before ACPM is declared RC1. Current result: `PASS_RC1_READY`.

Role-account sign-off path:

- Admin, PM, and APM QA accounts now exist with owner approval.
- Firebase rules now allow PM company-wide project reads and deny APM full-root
  reads while allowing assigned-project access.
- Run `scripts/roles_live_account_qa.js` with those credentials.
- Run `scripts/rc1_deployed_rules_security_qa.js` with PM/APM credentials.
- Confirmed `rc1RoleAccountQaComplete = true`.
- Rerun `scripts/rc1_final_readiness_gate.js` for release verification.
