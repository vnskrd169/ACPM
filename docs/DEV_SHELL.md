# ACPM Local Dev Shell

A **localhost-only** bypass of the Firebase login wall for debugging the
labor / payroll workflow (Roster → Attendance → Payroll Review → Cash
Advances → RFP) without typing credentials, against a **local emulator** —
never against staging or production data.

> ⚠️ This is a debugging tool. It is deliberately excluded from Firebase
> Hosting deploys (`firebase.json` → `hosting.ignore` includes `dev/**` and
> `dev-shell.html`), and its guard is fail-closed: on any remote host it does
> nothing. The static gate `scripts/dev_shell_static_qa.js` enforces this.

---

## Prerequisites

- Node 18+ (uses `fetch`).
- Firebase CLI (`npx firebase` works from the repo).
- The Firebase Emulator Suite JARs (already cached in this repo's workflow).

## Quick start

```bash
# 1. Start the dev emulator (database only, port 18300)
npx firebase emulators:start --config dev/firebase.dev.json --project acpm-project-system-qa

# 2. In a second terminal, seed the emulator with demo data
node dev/seed-dev-data.js

# 3. Serve the app locally
npx serve -s -l 5555 .

# 4. Open the shell launcher
#    http://localhost:5555/dev-shell.html
```

From `dev-shell.html` you can jump straight into:

- **Open Workspace — dev-pilot** — the labor/payroll workspace
- **Open Dashboard** — the hub
- **Login page (auto-enters)** — login page with mock session

> ℹ️ Use the **launcher buttons** — not raw `?dev=1` URLs. Local static
> servers like `serve` 301-redirect `workspace.html` → `/workspace` and
> **strip the query string**, so a hand-typed `?dev=1` may be dropped. The
> launcher stores the opt-in and the target project in `sessionStorage`
> first, and the bypass restores `projectId` into the URL on the next page.

Any page opened after the launcher sets the session flag boots **as a boss**
with mock auth and reads/writes the **local emulator**.

## What gets seeded

`node dev/seed-dev-data.js` writes to the local emulator under the namespace
that the app SDK derives from its `databaseURL`
(`acpm-project-system-qa-default-rtdb`). Keep the `NS` constant aligned with
that derived name if the emulator/project IDs ever change, or the app will
read an empty namespace.

| Node | Contents |
|---|---|
| `users/dev-boss` | boss profile, status `active` |
| `projects/dev-pilot` | demo project + `payrollConfig` |
| `projects/dev-pilot/workers` | `w1` ₱1,000 (Carpentry), `w2` ₱850 (Masonry), `w3` ₱1,200 (Electrical) |
| `projects/dev-pilot/attendance/*` | current Mon–Fri, status `present` |
| `projects/dev-pilot/advances/*` | every lifecycle branch (released eligible, closed, pending_approval, rejected) |
| `projects/dev-pilot/payrollLogs/prior-week-finalized` | archived log with **snapshot rate ₱850** for `w1` (current rate ₱1,000) |
| `projects/dev-pilot/cashAdvanceEvents` | one released event |

Expected current-week math in the Payroll Review:

- **w1** gross ₱5,000 − CA ₱3,500 (₱1,500 oldest + ₱2,000) = **₱1,500 net**
- **w2** gross ₱4,250 − CA ₱0 (₱3,000 pending + ₱1,000 rejected are NOT eligible) = **₱4,250 net**
- **w3** gross ₱6,000 − CA ₱5,000 = **₱1,000 net**

The archived prior-week log (rate ₱850, NET ₱3,750) proves **snapshot
preservation**: open **Payroll → RFP** for that period and confirm the
request still shows ₱850 and NET ₱3,750 even though `w1`'s current rate is
₱1,000.

## Security / fail-closed behavior

1. **`dev/dev-bypass.js`** activates only when
   `hostname ∈ {localhost, 127.0.0.1, ::1, ''}` **and**
   (`?dev=1` **or** `sessionStorage.acpm_dev_shell === '1'`).
2. When inactive it returns immediately — production pages behave exactly
   as before (real Firebase Auth + real rules).
3. When active it redirects `firebase.database()` to
   `127.0.0.1:18300` via `useEmulator` — it **cannot** read or write the
   real staging/production database.
4. `dev/**`, `dev/dev-bypass.js`, and `dev-shell.html` are **never deployed**
   (hosting ignore + static gate). Even if a copy leaked, remote hosts fail
   closed.
5. A purple **DEV SHELL** badge is pinned bottom-right; click **exit** to
   clear the session flag and return to the real login flow.

> ⚠️ **Storage note:** only the Realtime Database is redirected to the
> emulator. All photo uploads (PMOS, Site Log, Face Attendance, profile
> photos) go to **Google Drive** through the configured Apps Script endpoint,
> which is not redirected by the shell. Avoid uploading real files during
> dev-shell debugging unless that is intended.

## QA gate

```bash
node scripts/dev_shell_static_qa.js
```

Asserts: hosting ignore contains `dev/**` and `dev-shell.html`; the bypass
and the three HTML hooks are guarded; the seed targets the emulator only; and
`index.html` never references the bypass.

## Cleanup

When you are done debugging:

```bash
# Stop the emulator
# (Ctrl+C in the emulator terminal, or)
npx firebase emulators:stop

# Optional: remove local-only artifacts
git clean -fdx dev/ dev-shell.html   # review first!
```

The shell never needs to be removed from the repo for a production deploy —
`firebase.json` already prevents it from shipping.
