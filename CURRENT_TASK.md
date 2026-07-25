# ACPM Current Task

## Objective
Bring ACPM closer to RC1 by improving production clarity and reducing PM workload without adding unnecessary features. Current focus: user identity, Team Admin readability, notification/account onboarding stability, and project/action traceability.

## Completed Work
- Deployed RC1 foundation fixes for authentication, routing, Dashboard/Hub, project lifecycle, Labor, Materials, Billing Phase 1, notifications, PMOS Office, and account onboarding.
- Fixed account access request flow so signup writes `accessRequests/{uid}` and Admin Requests can approve/reject from that canonical path.
- Added Request Pending recovery for Auth accounts missing an access request.
- Fixed project assignment data shape so `users/{uid}/projects/{projectId}: true` matches Firebase rules while preserving `assignedProjects`.
- Migrated existing affected user assignment arrays to project maps in live Firebase.
- Added notification read/clear handling without deleting historical notification records.
- Fixed PMOS Office display so project UIDs are not shown as the primary label and completed/archived project records are hidden from active PMOS views.
- Improved Team Admin roster readability with avatar/initials, name, email, position, profile completion, status, last-seen signal, role, and project assignment grouped for faster admin scanning.
- Added safe `lastLoginAt` / `lastSeenAt` active-user writes and deployed matching database rules.
- Bumped PWA cache/script set to `acpm-v125`, `style.css?v=103`, `auth.js?v=95`, `main.js?v=102`, `notifications.js?v=85`, and `report.js?v=97`.
- Improved Hub Recent Activity rows with clearer action labels, optional actor names, relative time/date, and module-colored status dots.
- Improved Admin Audit Log rows with module pills, action labels, actor identity, project labels, record summary, source, and detail text.
- Removed the stale duplicate Audit Log renderer from `report.js`.
- Tightened Firebase Hosting ignores so Markdown handoff/docs such as `CURRENT_TASK.md` are no longer publicly served.
- Fixed the stale RC1 static gate assertion so `report.js?v=95` is enforced correctly.
- Cleaned service worker comment/output text around cache handling so deployed offline text is readable.
- Repaired mojibake in the app shell files and converted touched decorative Unicode comments/dashes to ASCII-safe source text.
- Fixed PWA registration when the browser blocks service workers by guarding the registration object before calling `update()`.
- Updated Reports listener static QA so the project report listener and access request listener cleanup are verified instead of treated as a regression.
- Deployed current hosting and rules to Firebase project `acpm-project-system` after the v116 verification pass.
- Blocked suspended, disabled, and archived profiles at login, including admin roles.
- Added Team Admin suspend/reactivate/archive actions without deleting user records.
- Removed raw UID display from normal access-request and project-assignment scanning.
- Fixed PM/APM notification listeners to support rules-compatible project maps as well as legacy arrays.
- Made assigned-project dashboard loading resilient when a stale/unpermitted project assignment exists; accessible projects still load and the user gets a clean admin-review warning.
- Fixed Team Admin mode so only top-level project module tabs are hidden; Admin sub-tabs such as Team, Requests, Audit Log, and System remain visible.
- Changed the Team Admin header shortcut to open directly to the Team assignment view, with Account Summary shortcuts for Manage Team and Review Access Requests.
- Removed raw UID from the normal Account Summary view and kept project assignment focused on readable project names.
- Fixed the signup/request access auth-state race so Firebase Auth account creation does not render a misleading Request Pending screen before `accessRequests/{uid}` is written.
- Added profile photo persistence without requiring Firebase Storage by storing small compressed inline avatars in `users/{uid}/avatarUrl`; initials fallback remains available when no photo is selected.
- Added auth sign-out listener cleanup for Reports/Admin/Notifications so Boss root listeners do not survive into PM/APM sessions.
- Deployed hosting cache `acpm-v125` to `https://acpm-project-system.web.app`.
- Focused live Firebase onboarding QA passed on cache `acpm-v125`: signup, access request, Admin approval, profile completion with inline avatar persistence, audit/notification creation, self-write denial, suspend/reactivate/archive, and blocked suspended/archived login all passed. QA user final state was archived.
- Focused live Firebase notification QA passed on cache `acpm-v125`: event record, listener, badge, dropdown render, click-through to workspace, mark-read persistence, refresh persistence, unassigned-recipient filtering, and QA project archive all passed.
- UI polish smoke passed: mobile login/request pending fit the viewport, notification dropdown rendered cleanly, Team Admin avatars/action stacks rendered, project tabs stayed hidden in Team Admin, and My Profile modal fit the viewport.
- Accepted release risk recorded: broad controlled full real-write RC1 QA is intentionally deferred for now. Focused onboarding/notification QA and existing module gates remain the evidence base until real project use produces new bug reports.
- PMOS company-sendout QA completed: PMOS field shell is Firebase Storage-free, uses Google Drive Apps Script photo configuration, keeps Face Attendance disabled/unloaded, and validates ACPM/PMOS branding assets, manifests, colors, and local asset references.
- Fixed PMOS scoped service worker isolation: root `sw.js` leaves `/pmos/` routes to the scoped PMOS worker, and `main.js` skips root PWA registration on the PMOS page.
- Fixed hidden PMOS action sheet pointer blocking so closed create sheets cannot intercept form Save buttons.
- Updated PMOS browser QA harness so Firebase Auth/RTDB mocks are not overwritten by Firebase CDN scripts, Viewer is blocked for RC1, and service-worker offline reload is tested separately from normal workflow tests.

## Files Changed In Current RC1 Batch
- `auth.js`
- `acpm-shell.js`
- `assets/brand/pmos-app.css`
- `billing.js`
- `dashboard.html`
- `database.rules.json`
- `docs/qa/QA_ACCOUNT_ONBOARDING.md`
- `docs/qa/QA_NOTIFICATIONS.md`
- `docs/release/RC1_READINESS.md`
- `docs/schema/ACCOUNT_ONBOARDING_SCHEMA.md`
- `docs/schema/NOTIFICATION_EVENTS.md`
- `firebase.json`
- `index.html`
- `login.html`
- `main.js`
- `materials.js`
- `notifications.js`
- `PMOS_CURRENT_STATUS.md`
- `PMOS_QA_REPORT.md`
- `pmos-office.js`
- `pmos/pmos-sw.js`
- `pmos/index.html`
- `pmos-sw.js`
- `pmos.js`
- `report.js`
- `scripts/notifications_end_to_end_live_qa.js`
- `scripts/onboarding_ui_polish_smoke.js`
- `scripts/pmos_release_static_qa.js`
- `scripts/pwa_cache_static_qa.js`
- `scripts/rc1_docs_static_qa.js`
- `scripts/rc1_static_gate.js`
- `storage.rules`
- `style.css`
- `sw.js`
- `tests/e2e/helpers.ts`
- `tests/e2e/pmos-workflow.spec.ts`
- `workspace.html`

## Checks Already Passed
- `node --check main.js`
- `node --check report.js`
- `node --check auth.js`
- `node --check notifications.js`
- `node --check pmos-office.js`
- `node scripts/rc1_static_gate.js`
- `node scripts/pwa_cache_static_qa.js`
- `node scripts/rc1_docs_static_qa.js`
- `node scripts/reports_listener_static_qa.js`
- `node scripts/rc1_static_gate.js` now includes regression guards for map-shaped project notifications, Team Admin status workflow, and hidden raw UID labels.
- Local Playwright UI polish smoke against `http://127.0.0.1:8018` confirmed Team Admin defaults to the Team assignment view, Admin sub-tabs are visible, and project module tabs stay hidden.
- `node scripts/rc1_post_deploy_gate.js` returned `PASS_WITH_REAL_QA_SKIPPED`; all local/static commands passed and write-heavy real Firebase QA was skipped intentionally because `RUN_REAL_QA` was not set.
- `node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8')); console.log('rules json ok')"`
- `node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8')); console.log('firebase json ok')"`
- Firebase Hosting deploy completed for `https://acpm-project-system.web.app` after the current v116 asset set.
- Firebase Database rules deploy completed after access request and `lastSeenAt` rule fixes.
- `firebase.cmd deploy --only database --dry-run` confirmed deployed database rules syntax remains valid.
- Live static fetch confirms `sw.js`, `dashboard.html`, and `login.html` serve `acpm-v125`, `style.css?v=103`, `auth.js?v=95`, `main.js?v=102`, `notifications.js?v=85`, and `report.js?v=97`.
- Live browser smoke against `https://acpm-project-system.web.app` after the Team Admin navigation fix passed: Team Admin defaults to Team, Admin sub-tabs are visible, project module tabs are hidden, and profile/notification smoke checks still pass.
- Live static fetch confirms `CURRENT_TASK.md`, `docs/qa/QA_ACCOUNT_ONBOARDING.md`, and `scripts/rc1_static_gate.js` return 404 from Hosting.
- Live static fetch confirmed hosted `dashboard.html` has no mojibake markers.
- Live static fetch confirmed `CURRENT_TASK.md`, `README.md`, `docs/qa/QA_AUDIT.md`, and `scripts/rc1_static_gate.js` return 404 after Hosting ignore cleanup.
- Live browser smoke against `https://acpm-project-system.web.app/login.html?qa=rc1-smoke-v116` passed:
  - Boss login reached Dashboard/Hub.
  - Team Admin rendered 7 team rows with 7 avatar cells and no Labor tab visible in admin mode.
  - Requests tab rendered with 0 pending requests.
  - Audit Log rendered 128 audit cards.
  - Notification bell opened and rendered rows plus Clear read control.
  - Hub button returned to Hub with System Reports hidden.
  - Console errors/warnings: none.
- PMOS static release QA passed: field shell is Firebase Storage-free, Drive Apps Script photo path is configured, Face Attendance is disabled/unloaded from PMOS rollout shell, PMOS cache versions are bumped, manifests parse, local assets exist, and brand/PMOS shell text has no mojibake.
- PMOS full Playwright browser QA passed: `npm.cmd run test:e2e -- --project=chromium tests/e2e/pmos-workflow.spec.ts --reporter=line` returned 17 passed / 0 failed.
- PMOS unit QA passed: `npm.cmd run test:pmos` returned 56 passed / 0 failed.
- Firebase dry-run after the PMOS pass returned database rules syntax valid and dry run complete.

## Unresolved Bugs / Risks
- In-app browser connector failed during smoke setup in this environment (`failed to write kernel assets`), but standalone Playwright live browser smoke passed against the deployed v116 site.
- Some live QA/test records may remain from earlier RC1 validation and should be reviewed before final production handoff.
- `.firebase/` is present locally from deploy cache and should not be committed unless intentionally needed.
- Firebase Storage is not required for RC1 profile photos. Small avatars are stored inline in Realtime Database; Firebase Storage remains the future path for larger profile media.
- Focused live onboarding QA creates labeled historical QA Auth/request/user records and archives the QA app profile; do not bulk-delete historical records.
- Broad controlled full real-write RC1 QA is deferred by owner decision. Treat this as an accepted release risk, not as proof that every module is bug-free under full-system write load.
- Real Google Drive PMOS photo upload was not live-write tested in this pass to avoid creating company test uploads; PMOS is wired to the existing Apps Script endpoint and uses Drive-only configuration.

## Remaining Implementation Steps
1. Review and archive/remove safe QA records intentionally, never by bulk delete.
2. If any files affecting PWA cache are changed, bump cache/script versions and rerun PWA cache QA.
3. Periodically rerun live browser smoke after major workflow/rules changes.

## Exact Next Commands / Tests
```powershell
git status --short
node --check auth.js
node --check main.js
node --check report.js
node --check notifications.js
node --check pmos-office.js
node --check pmos.js
node --check acpm-shell.js
node scripts/pmos_release_static_qa.js
node scripts/rc1_static_gate.js
node scripts/pwa_cache_static_qa.js
node scripts/rc1_docs_static_qa.js
npm.cmd run test:pmos
npm.cmd run test:e2e -- --project=chromium tests/e2e/pmos-workflow.spec.ts --reporter=line
node scripts/onboarding_ui_polish_smoke.js
node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8')); console.log('rules json ok')"
firebase.cmd deploy --only database,hosting
```
