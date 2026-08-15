# ACPM — Getting Started Guide

**Set up Firebase Auth, provision your first project, and onboard your office team.**

> **Target audience:** Office admin / IT lead / Boss setting up ACPM for the first time.
> **Estimated time:** 20–30 minutes for initial setup.

---

## Table of Contents

1. [Before You Begin](#1-before-you-begin)
2. [Enable Email/Password Sign-In](#2-enable-emailpassword-sign-in)
3. [Create Your Firebase Auth Users](#3-create-your-firebase-auth-users)
4. [Provision User Profiles in the Database](#4-provision-user-profiles-in-the-database)
5. [Create Your First Project](#5-create-your-first-project)
6. [Assign Users to Projects](#6-assign-users-to-projects)
7. [Verify Access Control](#7-verify-access-control)
8. [Onboard Your Team](#8-onboard-your-team)
9. [Quick Reference](#9-quick-reference)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Before You Begin

### What You Need

| Item | Where to Get It | Purpose |
|------|----------------|---------|
| **Firebase Console access** | [console.firebase.google.com](https://console.firebase.google.com) | Manage Auth, Database, and users |
| **List of office team** | Admin / HR | Name, position, role, project assignments |
| **User passwords** | You create these | Shared securely (see [Password Policy](#password-policy)) |

### Roles in ACPM

| Role | Label | Can Do |
|------|-------|--------|
| `boss` | Boss / Owner | Everything — create projects, approve access, see all data |
| `owner` | Boss / Owner | Same as `boss` |
| `admin` | Admin | Same as `boss` |
| `pm` | Project Manager | Edit assigned projects, see financials, manage team |
| `apm` | Assoc. Project Manager | Edit assigned projects, no financials |
| `foreman` | Foreman | Field-only (future release) |
| `safety` | Safety | Field-only (future release) |
| `viewer` | Viewer | Read-only access to assigned projects |

> **For RC1** (current release), only `boss`, `owner`, `admin`, `pm`, and `apm` are active roles.

### Firebase Project Details

| Detail | Value |
|--------|-------|
| **Project ID** | `acpm-project-system` |
| **Project name** | ACPM - Project Management System |
| **Web app URL** | `https://acpm-project-system.web.app` |
| **Database location** | `asia-southeast1` |

---

## 2. Enable Email/Password Sign-In

Firebase Auth must have the **Email/Password** sign-in provider enabled for users to log in.

### Steps

1. Open the [Firebase Console](https://console.firebase.google.com/project/acpm-project-system/authentication).
2. Sign in with the Google account that owns the Firebase project.
3. In the left sidebar, click **Authentication**.
4. Click the **Sign-in method** tab.
5. Find **Email/Password** in the provider list.
6. Click the row, then toggle **Enable** to ON.
7. Click **Save**.

![Firebase Authentication > Sign-in method > Email/Password toggle](https://via.placeholder.com/800x200?text=Enable+Email/Password+Sign-In)

> ✅ **Verify:** The Email/Password provider now shows **Enabled** in the list.

---

## 3. Create Your Firebase Auth Users

Each team member needs a **Firebase Auth account** (email + password) before they can log in.

### Recommended Email Convention

Use the `@acpm.local` email domain for simplicity:

| Person | Email |
|--------|-------|
| Boss | `boss@acpm.local` |
| Project Manager | `pm@acpm.local` |
| Assoc. PM | `apm@acpm.local` |

Users can type just the username part at login — ACPM automatically appends `@acpm.local`.
For example, typing `boss` is the same as `boss@acpm.local`.

> **For real people**, use their actual email (e.g., `juandelacruz@gmail.com`) if they already have one. The `@acpm.local` shortcut works for both.

### Create a User

1. In the Firebase Console, go to **Authentication** → **Users** tab.
2. Click **+ Add user**.
3. Enter the **email** (e.g., `boss@acpm.local`).
4. Enter a **password** (see [Password Policy](#password-policy)).
5. Click **Add user**.

![Firebase Authentication > Add user dialog](https://via.placeholder.com/800x200?text=Add+User+Dialog)

### Password Policy

| Rule | Recommendation |
|------|---------------|
| Minimum length | 6 characters |
| Complexity | At least one uppercase + one number |
| Example | `Choiraboy169!` |
| Sharing | Send via secure channel (not in plain text email) |
| Reset | Users can reset their own password via the login screen's **Forgot password?** link |

### Create All Initial Users

For a typical office setup, create at minimum:

| Email | Password | Role (next step) |
|-------|----------|-------------------|
| `boss@acpm.local` | `YourPassword!1` | `boss` |
| `pm@acpm.local` | `YourPassword!1` | `pm` |
| `apm@acpm.local` | `YourPassword!1` | `apm` |

> ⚠️ **Important:** Creating a Firebase Auth account only gives the user an identity. They still need a **user profile** in the database (next step) to access the app.

---

## 4. Provision User Profiles in the Database

After creating Firebase Auth users, you must create their **profile records** in the Realtime Database at `users/{uid}`.

### Option A: Automated Script (Recommended)

The fastest way is to run the provisioning script:

```bash
# 1. Set your boss credentials (already have a boss@acpm.local Auth account)
export ACPM_QA_EMAIL="boss@acpm.local"
export ACPM_QA_PASSWORD="YourPassword!1"

# 2. Run the provisioning script
node scripts/provision_rc1_role_qa_accounts.js
```

This creates profiles for:
- `admin.qa@lebuild.test` → role: `admin` → sees all projects
- `pm.qa@lebuild.test` → role: `pm` → assigned to one active project
- `apm.qa@lebuild.test` → role: `apm` → assigned to one active project

### Option B: Manual Profile Creation (via Database)

You can also create profiles directly in the Firebase Realtime Database.

1. In the Firebase Console, go to **Realtime Database** → **Data**.
2. Hover over the root and click **+ Add node**.
3. Enter the key: `users/{authUid}` (replace `{authUid}` with the user's Firebase Auth UID).
4. Click **+ Add** for each field:

![Firebase Database > Add user profile](https://via.placeholder.com/800x200?text=Add+User+Profile+in+Database)

### Profile Schema

```json
{
  "users": {
    "{authUid}": {
      "name": "Juan Dela Cruz",
      "email": "pm@acpm.local",
      "position": "Project Manager",
      "role": "pm",
      "status": "active",
      "profileComplete": true,
      "projects": {
        "{projectId}": true
      },
      "assignedProjects": ["{projectId}"],
      "bossOf": [],
      "mobile": "09171234567",
      "signature": "JDC",
      "updatedAt": 1712345678000
    }
  }
}
```

### Field Reference

| Field | Required | Description | Who Can Edit |
|-------|----------|-------------|--------------|
| `name` | ✅ Yes | Display name | User + Boss |
| `email` | ✅ Yes | Email address | Boss only |
| `position` | ✅ Yes | Job title | User + Boss |
| `role` | ✅ Yes | `boss` / `owner` / `admin` / `pm` / `apm` | Boss only |
| `status` | ✅ Yes | `active` / `suspended` / `disabled` / `archived` | Boss only |
| `projects` | For PM/APM | Map of `{projectId}: true` | Boss only |
| `bossOf` | For Boss | Array of project IDs they oversee | Boss only |
| `profileComplete` | ✅ Yes | Set to `true` after setup | User + Boss |
| `mobile` | No | Contact number | User + Boss |
| `signature` | No | Initials / signature name | User + Boss |
| `updatedAt` | ✅ Yes | Unix timestamp in milliseconds | Auto |

---

## 5. Create Your First Project

### Via ACPM Dashboard (Recommended)

1. Log in as **Boss** at `https://acpm-project-system.web.app`.
2. You'll see the **Dashboard** (project hub).
3. Click the **Create Project** card or button.
4. Fill in:
   - **Project name** (e.g., "Batangas Phase 1")
   - **Labor Budget** (optional, e.g., 500000)
   - **Materials Budget** (optional, e.g., 1200000)
5. Click **Create**.

![ACPM Dashboard > Create Project dialog](https://via.placeholder.com/800x200?text=Create+Project+Dialogue)

> ✅ The new project card appears in the project list.

### Via Firebase Console

Alternatively, create the project record directly:

1. Go to **Realtime Database** → **Data**.
2. Add node: `projects/{projectId}`.
3. Required fields:
   ```json
   {
     "name": "Batangas Phase 1",
     "status": "active",
     "createdAt": 1712345678000,
     "createdDate": "2026-04-05"
   }
   ```
4. Optional fields:
   - `laborBudget` (number)
   - `materialBudget` (number)
   - `notes` (string)
   - `location` (string)

### Project Schema

```json
{
  "projects": {
    "{projectId}": {
      "name": "Batangas Phase 1",
      "status": "active",
      "createdAt": 1712345678000,
      "createdDate": "2026-04-05",
      "laborBudget": 500000,
      "materialBudget": 1200000,
      "notes": "Key contacts: Engr. Santos - 0917xxxxxxx"
    }
  }
}
```

| Field | Required | Values |
|-------|----------|--------|
| `name` | ✅ | String, max 100 chars |
| `status` | ✅ | `active` / `completed` / `archived` |
| `createdAt` | ✅ | Unix timestamp (milliseconds) |
| `laborBudget` | No | Number ≥ 0 |
| `materialBudget` | No | Number ≥ 0 |

---

## 6. Assign Users to Projects

Users can only see projects they are **assigned to**.

### For PM / APM Users

Add the project to the user's `projects` map:

```json
{
  "users": {
    "{authUid}": {
      "projects": {
        "batangas-phase-1": true
      },
      "assignedProjects": ["batangas-phase-1"]
    }
  }
}
```

> **Both** `projects` (map format for Firebase rules) and `assignedProjects` (array format for UI) should be set for compatibility.

### For Boss / Owner Users

Boss-level users see **all projects** automatically — no assignment needed.

They can also be assigned as `bossOf` specific projects for oversight reporting:

```json
{
  "users": {
    "{authUid}": {
      "bossOf": ["batangas-phase-1"]
    }
  }
}
```

### Via Firebase Console

1. Go to **Realtime Database** → **Data** → `users/{authUid}`.
2. Add or edit the `projects` and `assignedProjects` fields.
3. Click **Save**.

---

## 7. Verify Access Control

Before onboarding your team, verify that access control works correctly.

### Test Matrix

| Test | User | Expected Result |
|------|------|-----------------|
| Boss sees all projects | `boss@acpm.local` | All projects visible in Dashboard |
| PM sees assigned projects | `pm@acpm.local` | Only assigned projects visible |
| APM sees assigned projects | `apm@acpm.local` | Only assigned projects visible |
| Unauthorized user blocked | Unknown email | Login fails with "Invalid username or password" |
| Suspended user blocked | Suspended user | Shows "This account is suspended" message |

### Quick Verification Script

```bash
node scripts/roles_live_account_qa.js
```

This script runs automated checks on role-based access. Requires:
- Boss credentials (set `ACPM_QA_EMAIL` and `ACPM_QA_PASSWORD`)
- PM credentials (set `ACPM_RC1_PM_EMAIL` and `ACPM_RC1_PM_EMAIL`)
- APM credentials (set `ACPM_RC1_APM_EMAIL` and `ACPM_RC1_APM_EMAIL`)

---

## 8. Onboard Your Team

### Step 1: Share Login Information

Send each team member:

- **App URL:** `https://acpm-project-system.web.app`
- **Username:** Their email (or just the `@acpm.local` prefix)
- **Password:** The password you created
- **Role:** Their assigned role (so expectations are clear)

### Step 2: Quick Start Guide

Share the [Onboarding Cheat Sheet](product/ONBOARDING_CHEAT_SHEET.md) — it's written in Filipino for field workers and covers:

- How to log in
- How to mark attendance
- How to create purchase orders
- How to log site activities
- Common troubleshooting

### Step 3: First Login

The team member:

1. Opens the app URL on their phone or laptop.
2. Types their username and password.
3. Clicks **Sign In**.
4. Sees the **Dashboard** with their assigned project(s).
5. Clicks a project card to enter the **Workspace**.

### Step 4: Profile Setup (First-time only)

On first login, the app prompts the user to complete their profile:

- **Display name** (editable)
- **Position / title** (editable)
- **Mobile number** (editable)
- **Profile photo** (optional — can use initials)
- **Signature / initials** (optional)

> The user can edit these fields later from their profile.

### Step 5: Role-Specific Training

| Role | Key Modules to Learn |
|------|---------------------|
| **Boss / Owner** | Dashboard (overview), Reports, Admin (user management) |
| **PM** | Labor (payroll review), Billing, Materials (PO approval), Reports |
| **APM** | Labor (daily attendance), Materials (PO creation), Site Log, Tasks |

---

## 9. Quick Reference

### Database Paths

| Path | Purpose |
|------|---------|
| `users/{uid}` | User profiles (role, projects, status) |
| `projects/{pid}` | Project data (name, budget, status) |
| `accessRequests/{uid}` | Pending account signup requests |
| `auditLogs/` | Change history for approvals and admin actions |
| `notifications/{uid}/` | User-specific notification inbox |

### Firebase Auth Admin API

For advanced scripting, use the Firebase Auth REST API:

```bash
# Get user by email
curl -X GET "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"boss@acpm.local"}'

# API Key (for reference):
# AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA
```

### Useful Environment Variables

| Variable | Purpose | Used By |
|----------|---------|---------|
| `ACPM_QA_EMAIL` | Boss/admin email for QA scripts | Scripts |
| `ACPM_QA_PASSWORD` | Boss/admin password for QA scripts | Scripts |
| `ACPM_RC1_QA_PASSWORD` | Password for QC test accounts | `provision_rc1_role_qa_accounts.js` |
| `ACPM_RC1_QA_PROJECT_ID` | Override project for QA assignment | `provision_rc1_role_qa_accounts.js` |

---

## 10. Troubleshooting

### "Invalid username or password"

| Cause | Solution |
|-------|----------|
| Wrong email format | Try full email (e.g., `boss@acpm.local`) instead of just `boss` |
| Wrong password | Use **Forgot password?** on the login screen to reset |
| Account doesn't exist | Check Firebase Console > Authentication > Users |
| Account exists but no profile | Create `users/{uid}` with `status: "active"` (see [Section 4](#4-provision-user-profiles-in-the-database)) |

### Account exists but sees "Request Pending"

**Cause:** The user has a Firebase Auth account but no `users/{uid}` profile with `status: "active"`.

**Solution:**
1. Go to Firebase Console > Realtime Database > Data.
2. Check if `users/{uid}` exists.
3. If not, create the profile (see [Section 4](#4-provision-user-profiles-in-the-database)).
4. Ensure `status` is set to `"active"`.
5. Have the user log out and log in again.

### "You do not have access"

**Cause:** The user is not assigned to the project they're trying to open.

**Solution:**
1. Go to Firebase Console > Realtime Database > Data > `users/{uid}`.
2. Add the project to the `projects` map: `"projectId": true`.
3. Also add to `assignedProjects` array: `["projectId"]`.

### "This account is suspended / archived"

**Cause:** An admin changed the user's status to `suspended`, `disabled`, or `archived`.

**Solution:** Ask an admin to change the user's `status` back to `active` in the database.

### User can't see financial data

**Cause:** The user's role is `apm`, which does not have financial access.

**Solution:** If the user needs financial access, change their role to `pm` or higher in `users/{uid}/role`.

### Google Sign-In doesn't work

**Cause:** Google sign-in may not be enabled, or the domain is not authorized.

**Solution:**
1. In Firebase Console > Authentication > Sign-in method, enable **Google**.
2. Add your app domain to **Authorized domains** (Settings > Authorized domains).
3. The app domain is `acpm-project-system.web.app`.

### Need to delete a user permanently

**Note:** ACPM does not support hard-deleting users from the app. Use the Firebase Console:

1. Go to **Authentication** > **Users**.
2. Find the user and click the **⋮** menu.
3. Select **Delete account**.

> **Best practice:** Use `suspended` or `archived` status instead of hard-deleting, so audit logs and historical records remain intact.

---

## Appendix: User Onboarding Checklist

Copy this checklist for each new team member:

| Step | Completed? |
|------|------------|
| Firebase Auth account created | ☐ |
| `users/{uid}` profile created with role and status | ☐ |
| User assigned to projects (`projects` map + `assignedProjects` array) | ☐ |
| Password shared securely | ☐ |
| App URL shared (`https://acpm-project-system.web.app`) | ☐ |
| User logs in successfully | ☐ |
| User sees correct projects | ☐ |
| User completes profile setup | ☐ |
| User trained on relevant modules | ☐ |

---

*Last updated: July 2026 · ACPM v0.9.0-rc1*
