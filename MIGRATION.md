# ACPM — Stage 1 Migration Runbook (Firebase Auth)

This is your step-by-step guide for migrating ACPM from the custom
`simpleHash` password scheme to Firebase Authentication. Do this **once**,
in order. Total time: ~10 minutes + 1 minute per user.

> ⚠️ **Read all 7 steps before starting.** Step 5 (publishing rules) will
> lock out anyone still using the old login flow. Have all Auth accounts
> created *before* you publish.

> ✅ **Code migration complete.** `auth.js` has been rewritten to use
> `firebase.auth().signInWithEmailAndPassword` + `onAuthStateChanged`.
> The login screen now accepts usernames (auto-appends `@acpm.local`),
> includes a "Forgot password?" link, and no longer relies on `/sessions/`
> or `localStorage` tokens. You only need to do the Firebase Console steps
> below (Steps 1–7) and then publish the rules.

---

## Why this is happening

The old system stored passwords as a 32-bit hash in the database. That
hash is trivially brute-forceable, and more importantly, **the database
cannot tell a real login from an attacker** — so rules couldn't enforce
authentication. After this migration:

- Passwords live in Firebase Auth (bcrypt'd server-side) — never in your DB.
- The DB rules (`database.rules.json`) enforce `auth != null` on every read/write.
- Sessions are managed by Firebase — no stealable token in localStorage.

---

## Step 1 — Enable Email/Password sign-in

1. Open the [Firebase Console](https://console.firebase.google.com/) → your project (`acpm-project-system`).
2. Left nav → **Build → Authentication → Get started** (if not already enabled).
3. Tab **Sign-in method**.
4. Click **Email/Password** → **Enable** → **Save**.
   (Leave "Email link (passwordless)" off.)

---

## Step 2 — Inventory your existing users

1. Console → **Realtime Database** → **Data**.
2. Navigate to `users/`.
3. For each child node (each one is a username like `boss`, `apm1`, etc.),
   note down:
   - The **key** (the old username — e.g. `boss`)
   - `name`, `role`, `projects`, `bossOf` (you'll re-create these)

You'll need this list for Step 3.

---

## Step 3 — Create a Firebase Auth account for each user

For **each** user from Step 2:

1. Console → **Authentication → Users → Add user**.
2. **Email**: use the convention `{username}@acpm.local`.
   - Example: old username `boss` → `boss@acpm.local`
   - This keeps the login screen working with a familiar identifier
     while satisfying Firebase's email-format requirement.
3. **Password**: a temporary password (e.g. `LeBuild2026!`).
   - The user will change it at first login — see Step 7.
4. Click **Add user**.
5. **Copy the new User UID** (the long string starting with a random
   character sequence — shown in the users table). You'll need it for Step 4.

---

## Step 4 — Mirror the user profile to the new Auth UID

For each user, create a new `users/{authUid}` node that mirrors their
old profile. Either use the Console's data editor, or run this once per
user in your browser console while logged into the old system:

```js
// Run in browser DevTools console on the ACPM site.
// Replace OLD_USERNAME and NEW_AUTH_UID for each user.
(async () => {
  const oldKey = 'OLD_USERNAME';          // e.g. 'boss'
  const newUid = 'NEW_AUTH_UID';          // from Firebase Console

  const snap = await firebase.database().ref(`users/${oldKey}`).once('value');
  const profile = snap.val();
  if (!profile) { console.error('Old profile not found:', oldKey); return; }

  // Carry over everything except the old passHash (no longer needed).
  const { passHash, ...cleanProfile } = profile;
  await firebase.database().ref(`users/${newUid}`).set({
    ...cleanProfile,
    migratedFrom: oldKey,
    migratedAt:   Date.now()
  });
  console.log(`✓ Migrated ${oldKey} → ${newUid}`);
})();
```

After all users are mirrored, **delete the old `/users/{username}`
nodes** (the ones keyed by username, not by Auth UID) — they're dead
weight and their `passHash` is now meaningless.

Also delete all of `/sessions/*` — the new auth system doesn't use it.

---

## Step 5 — Publish the new database rules

1. Console → **Realtime Database → Rules**.
2. Open `database.rules.json` (in this repo) and paste its full contents.
3. Click **Publish**.

> ⚠️ From this moment, the old `simpleHash` login flow is broken by
> design — `users/{username}/passHash` no longer matches anything.
> Anyone with an old tab open will get errors on next DB write. That's
> expected; they just need to refresh and log in with their new
> credentials.

---

## Step 6 — Verify

1. Open the ACPM site in a fresh private window.
2. Log in with `boss@acpm.local` + the temp password.
3. Confirm:
   - You land on the Hub and see projects.
   - The Reports tab is visible (boss-only feature).
   - DevTools → Console has no permission-denied errors.
4. Repeat with one APM account — confirm they see only their assigned projects.

---

## Step 7 — Tell users to reset their passwords

Each user should:

1. Log in with `theirname@acpm.local` + the temp password you gave them.
2. Click **Settings → Change password** (or use Firebase's password-reset
   email flow — Console → Authentication → click a user → … → Reset password).

The login screen accepts the email/username as-is. If you used the
`{username}@acpm.local` convention, users can keep typing just their
username and the auth code will append the domain — they don't need to
memorize a new email format.

---

## Rollback (emergency only)

If something breaks and you need to undo:

1. Console → **Realtime Database → Rules** → revert to the previous rules (or `".read": true, ".write": true` as a temporary emergency measure).
2. Console → **Authentication → Sign-in method** → disable Email/Password.
3. The old `simpleHash` code path is already gone from `auth.js`, so you'd
   also need to `git revert` the Stage 1 commit.

**Don't run in this state for long.** This is a "stop the bleeding" option,
not a permanent one.

---

## After migration

- **Old `/users/{username}` nodes**: delete after all users are confirmed migrated.
- **Old `/sessions/*`**: delete.
- **`database.rules.json`**: keep in the repo — it's now source-controlled like any other code.
