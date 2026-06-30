# ACPM RC1 Readiness Gate

Status: NOT RC1 YET - CORE MODULES STABLE; GLOBAL RULE DEPLOYMENT AND ROLE QA REMAIN

Last updated: 2026-06-30

## Current Pass Areas

| Area | Result | Evidence |
| --- | --- | --- |
| Authentication / routing / PWA shell | PASS | Multi-page route foundation is active; browser smoke confirms signed-in Boss dashboard/workspace loads. |
| Dashboard integration | PASS with warning | Rollup data QA passed; Boss browser smoke passed at cache `acpm-v80`. Audit permission warning remains. |
| Project lifecycle | PASS | Active/completed/archive behavior previously verified; dashboard cards render active and completed actions. |
| Labor v1 | PASS | Real Firebase cash advance/payroll archive QA passed via `scripts/labor_v1_cash_advance_real_qa.js`. |
| Materials v1 | PASS | Materials v1 documented stable; movement ledger/status/budget stabilization complete. |
| Billing v1 Phase 2 | PASS | Real Firebase helper QA plus browser UI/dashboard smoke passed. |
| Change Orders v1 | PASS with warning | Real Firebase workflow/data QA passed; browser click-through remains a warning. |
| Site Logs v1 | PASS with known limitation | Real Firebase workflow/data QA passed; media upload/offline queue remain future. |
| Reports v1 data foundation | PASS with warning | Real Firebase rollup/snapshot QA passed; listener cleanup static QA passed; broad browser report smoke remains pending. |
| Roles RC1 lock | PASS with warning | Boss browser smoke confirms only Boss/Admin/PM/APM role options; PM/APM/Admin account QA remains pending. |

## Current Warning / Blocker Areas

| Area | Result | Why It Is Not Final |
| --- | --- | --- |
| Suppliers v1 | PASS with recommendation | Core workflow and supplier-local fallback event/notification/rollup QA passed. Canonical global paths still need rules deployment. |
| Audit Logs | PASS with warning | Project/supplier fallback audit works. Canonical global audit path still needs rules deployment. |
| Global Notification Events | WARNING | Project notification events and supplier-local fallback events pass; global event hooks are blocked by deployed-rule drift. Push notifications are intentionally future. |
| Firebase rules deployment | BLOCKER FOR RC1 | Local `database.rules.json` parses and `scripts/firebase_rules_gate.js` passes, but deployed rules are behind local rules. |
| Field-role deny QA | WARNING / PENDING | Foreman/Safety/Viewer are disabled in app/rules locally, but live deny behavior needs deployed rules or dedicated QA accounts. |
| PM/APM/Admin role browser QA | WARNING / PENDING | Boss smoke passed. Dedicated PM/APM/Admin QA accounts are not available in this repo. |

## Stop Condition

RC1 cannot be honestly declared until the local Firebase rules are published or otherwise verified against the live Realtime Database.

Required deployment gate:

```text
firebase deploy --only database
```

or publish the contents of `database.rules.json` through Firebase Console > Realtime Database > Rules.

After deployment, rerun:

```text
node scripts/firebase_rules_gate.js
node scripts/suppliers_v1_real_qa.js
node scripts/audit_notifications_v1_real_qa.js
node scripts/labor_v1_cash_advance_real_qa.js
node scripts/reports_v1_real_qa.js
```

## RC1 QA Commands Passed Locally

```text
node --check auth.js
node --check main.js
node --check report.js
node --check notifications.js
node --check labor.js
node --check scripts/labor_v1_cash_advance_real_qa.js
node --check scripts/rc1_static_gate.js
node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8'))"
node scripts/firebase_rules_gate.js
node scripts/rc1_static_gate.js
```

Browser smoke passed:

- Dashboard route as signed-in Boss.
- Workspace route with `projectId` preserved.
- Team Admin role options exclude Foreman/Safety/Viewer.
- Loaded cache/script set includes `labor.js?v=80`, `notifications.js?v=79`, and `report.js?v=82`.
- Console errors: none.
- Console warnings: audit-log deployed-rule permission warning remains.

Additional live fallback QA passed:

- Supplier fallback QA result: PASS
- Audit project fallback QA: PASS
- Active QA projects after cleanup: `0`
- RC1 static gate result: PASS
- Report listener cleanup static QA: PASS

QA cleanup:

```text
activeQaProjects = 0
```

## Next Recommended Step

Publish the Firebase rules, then rerun supplier/audit/notification QA. If those pass, continue with remaining broad browser smoke for Reports, Change Orders click-through, and PM/APM/Admin role-account checks.
