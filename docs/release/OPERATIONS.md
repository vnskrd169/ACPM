# ACPM Operations Runbook

This is the low-maintenance checklist for running ACPM without keeping the whole system in someone's head.

## What ACPM expects

- Firebase Authentication enabled with Email/Password.
- Realtime Database rules published from `database.rules.json`.
- User profiles stored under `/users/{authUid}`.
- Projects stored under `/projects/{projectId}`.
- Service worker cache version bumped when app files change. Current staging
  candidate: `acpm-v132`.

## Daily habits

- Use the app normally.
- Keep role assignments current when someone joins or changes responsibility.
- Watch the `auditLogs` feed for unusual changes.
- Check the browser console after major releases for permission errors.

## When adding a new teammate

1. Create the Firebase Auth account.
2. Create `/users/{authUid}` with `name`, `role`, `projects`, and `bossOf`.
3. Assign the minimum set of projects needed.
4. Confirm they can open only the projects they should see.

## Backups

- Export the Realtime Database before major changes.
- Keep a dated copy of the export outside the live Firebase project.
- Treat the export as a restore point, not as an archive you never test.

## Deploying a change

1. Update code.
2. Bump `CACHE_NAME` in `sw.js` if any app file changed.
3. Run `npm run test:environments` and `node scripts/firebase_rules_gate.js`.
4. Deploy to isolated Staging with `npm run deploy:staging`.
5. Test login, project open, create, edit, and notification flows on Staging.
6. Verify an assigned PM/APM account can only touch their allowed work with `node scripts/rc1_deployed_rules_security_qa.js`.
7. Run `npm run test:pmos`, the production rules emulator suite, and
   `npx playwright test`.
8. Promote only the verified candidate:

```powershell
.\scripts\deploy-production.ps1 -ConfirmProduction
```

Add `-IncludeDatabase` only when reviewed Firebase rule changes must also be
published. A normal Production promotion deploys Hosting only.

## Current routes

- `/login.html`: public authentication and access request.
- `/dashboard.html`: Hub and portfolio command center.
- `/workspace.html?projectId={id}`: selected project workspace.
- `/pmos/`: PMOS Field interface.
- `/index.html`: compatibility redirect only.

## Publishing Firebase Rules

Local rules live in `database.rules.json`. RC1 also includes `firebase.json` and `.firebaserc` so rule deployment is repeatable.

CLI path (explicit projects only):

```powershell
npm install -g firebase-tools
firebase login
npm run deploy:staging
.\scripts\deploy-production.ps1 -ConfirmProduction
```

Console path:

1. Open Firebase Console.
2. Go to Realtime Database > Rules.
3. Paste the contents of `database.rules.json`.
4. Publish.
5. Rerun the post-deploy and final readiness gates with QA credentials.

For RC1, run the full post-deploy gate in `RC1_POST_DEPLOY_QA.md` after publishing rules:

```powershell
node scripts/rc1_post_deploy_gate.js
```

Expected local/read-only result: `PASS_WITH_REAL_QA_SKIPPED`.

Set `RUN_REAL_QA=1` and QA credentials only when you intentionally want to create archived Firebase QA records:

```powershell
$env:ACPM_QA_EMAIL="your-qa-email"
$env:ACPM_QA_PASSWORD="your-qa-password"
$env:RUN_REAL_QA="1"
node scripts/rc1_post_deploy_gate.js
```

Expected real-backend result after rules deployment: `PASS`.

Then run the release-decision gate:

```powershell
node scripts/rc1_final_readiness_gate.js
```

Expected current result before dedicated role credentials are supplied: `WARNING_NOT_RC1_FINAL`.

Expected final RC1 result: `PASS_RC1_READY`.

For a strict release job, set `ACPM_REQUIRE_RC1_FINAL=1`; the gate exits non-zero while warnings remain.

The local gate also checks PWA cache consistency so `index.html`, `dashboard.html`, `workspace.html`, and `sw.js` stay on the same versioned script set. It also checks that the required schema/QA documents remain present before RC1 is claimed, that role-account QA is available, and that loaded module delete actions preserve history through archive/void/inactive states.

## Recovery order

If the app starts rejecting legitimate work:

1. Check Firebase Auth is still enabled.
2. Check the published rules match `database.rules.json`.
3. Verify the user profile still exists under `/users/{authUid}`.
4. Confirm the project exists and the user is assigned to it.
5. Inspect the browser console for permission-denied errors.

## Things to avoid

- Do not leave permissive database rules in place longer than necessary.
- Do not depend on client-side role checks as the only guard.
- Do not change the Auth or rules model without updating this runbook.
- Do not enable Foreman/Safety/Viewer until child-level data access rules exist.
- Do not use Firebase Storage for PMOS photos unless the storage architecture is
  explicitly approved; RC1 uses the configured Google Drive Apps Script.
