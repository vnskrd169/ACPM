# ACPM Operations Runbook

This is the low-maintenance checklist for running ACPM without keeping the whole system in someone's head.

## What ACPM expects

- Firebase Authentication enabled with Email/Password.
- Realtime Database rules published from `database.rules.json`.
- User profiles stored under `/users/{authUid}`.
- Projects stored under `/projects/{projectId}`.
- Service worker cache version bumped when app files change.

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
3. Publish Firebase rules if permissions changed.
4. Test login, project open, create, edit, and notification flows.
5. Verify an assigned PM/APM account can only touch their allowed work.

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
