# ACPM Architectural Review & 3-Year Reliability Roadmap

**Date:** 2026-06-23
**Reviewer:** Principal Software Architect (External)
**System:** ACPM (Art and Choi Project Management) v1.0.0
**Current Users:** 6 (3 PMs, 3 APMs)
**Target:** 10+ users, 3 years minimal maintenance

---

## Executive Summary

ACPM is a **functional, well-organized construction management PWA** that successfully handles real-time project tracking, labor payroll, materials procurement, and budget monitoring. The recent Firebase Auth migration (Stage 1) was a critical security improvement.

However, the system is currently architected as a **"thick client"** — business logic, access control, and data validation all run in the browser. For a 3-year, low-maintenance operational target with growing team size, **this is the single biggest risk**.

**Verdict:** The system will survive 6 months. It will struggle at 12 months. It will likely break or become unmaintainable by 24-36 months without structural intervention.

**The good news:** The intervention required is manageable, can be done incrementally, and does not require a rewrite.

---

## 1. Current Architecture Assessment

### 1.1 Stack Overview

| Layer | Technology | Assessment |
|-------|-----------|------------|
| **Frontend** | Vanilla HTML/CSS/JS (no framework) | ⚠️ Functional but brittle at scale |
| **Hosting** | Unknown (likely static/Firebase Hosting) | ? Needs verification |
| **Auth** | Firebase Auth (Email/Password) | ✅ Good after Stage 1 migration |
| **Database** | Firebase Realtime Database | ⚠️ Works but has limits |
| **Backend Logic** | None — lives entirely in browser JS | ❌ Critical risk |
| **Validation** | Client-side only | ❌ Critical risk |
| **Security** | Firebase Rules + client-side checks | ⚠️ Rules are secondary, not primary |
| **Offline** | Service Worker + IndexedDB | ✅ Good for a PWA |
| **Backup** | Manual (Firebase Console export) | ❌ Not automated |
| **CI/CD** | None visible | ❌ Manual deployment |
| **Testing** | None visible | ❌ Zero test coverage |
| **Monitoring** | Console logs only | ❌ No production monitoring |

### 1.2 Data Model (Firebase RTDB)

```
/users/{uid}           → { name, role, projects, bossOf }
/projects/{pid}        → { name, status, laborBudget, materialBudget, ...
                         trades, workers, attendance, payrollLogs,
                         purchaseOrders, ledger, inventory, billings,
                         collections, contract, changeOrders, siteLogs,
                         tasks, equipment, compliance, defects, notes }
/suppliers             → { name, specialty, contact, ... }
/auditLogs             → { action, entityType, userId, timestamp, ... }
/notifications/{uid}   → { title, body, read, createdAt, ... }
/complianceAlertsSent  → { ... }
```

**Assessment:** Deeply nested, project-centric model. All project data lives under one node. This is simple but creates problems:
- **No referential integrity** — delete a project and related records have no cleanup cascade
- **Hard to query across projects** — must load entire project tree
- **No data normalization** — supplier names duplicated, worker names duplicated
- **Risk of data corruption** — one bad write can corrupt an entire project

### 1.3 Module Architecture

```
index.html (shell)
├── main.js        → Hub, Workspace lifecycle, Dashboard
├── auth.js        → Firebase Auth, role management
├── utils.js       → Shared helpers, safeDb, auditLog
├── labor.js       → Trades, Workers, Attendance, Payroll, RFP
├── materials.js   → PO Draft, Submit, Approval, Delivery, Invoice, Ledger, Inventory
├── billing.js     → Contract, Billings, Collections
├── changeorders.js → Change Order workflow
├── sitelog.js     → Daily site logs
├── suppliers.js   → Supplier directory
├── equipment.js   → Equipment tracking, hours, expenses, service
├── compliance.js  → Compliance records, alerts
├── defects.js     → Punch list / defects
├── tasks.js       → Task management, Kanban board
├── notifications.js → In-app notifications
├── report.js      → Reports and analytics
├── sw.js          → Service Worker (PWA offline)
└── database.rules.json → Firebase security rules
```

**Assessment:** The modular split is sensible. Each module is ~10-40KB. The shared `utils.js` reduces duplication. However:
- **Global namespace pollution** — `window._currentPid`, `window._currentUser`, `window._isReadOnly`
- **No module isolation** — any script can access any other script's internals
- **Event listeners accumulate** — manual `detach*Listeners()` is error-prone

---

## 2. What's Working Well (Don't Break These)

### ✅ Strengths

1. **PWA Design** — Works offline, installable, mobile-first. The SW self-clearing cache is a smart pattern.
2. **Modular Code Organization** — Each domain has its own file. Easy to locate logic.
3. **Audit Logging** — `auditLog()` is fire-and-forget, provides accountability trail.
4. **Shared Utilities** — `utils.js` centralizes formatting, escaping, CSV generation, safe DB wrapper.
5. **Role-Based UI** — `data-boss-only`, `data-role-visible` attributes are a clean CSS-driven approach.
6. **Firebase Auth Migration** — The Stage 1 migration from `simpleHash` to Firebase Auth was critical and well-executed.
7. **Budget KPIs** — Real-time budget tracking with visual warnings (80% warning, 95% critical).
8. **Offline Queue** — `syncQueue` in IndexedDB for offline writes that sync when reconnected.
9. **Health Scores** — `calculateProjectHealth()` gives at-a-glance project status.
10. **Accessibility** — Skip link, ARIA labels on buttons, semantic HTML.

---

## 3. Critical Risks (The "Will Fail Within 3 Years" List)

### 🔴 CRITICAL: No Server-Side Authority

**The Problem:** Every business rule is enforced in the browser. The Firebase rules are a "safety net" but not the primary authority.

**Examples of client-side trust:**
- `canEditProject()` runs in `auth.js` — trivially bypassed by modifying `window._currentUser`
- `submitPO()` checks `canTouchMaterialsProject()` — but the Firebase rule just checks `auth != null`
- Payroll calculations happen in `labor.js` — an attacker can submit arbitrary payroll amounts
- Budget deltas (`laborBudgetDelta`) are set by client — no server-side validation of change order approval chains

**Why this matters:**
- A disgruntled employee with basic JS knowledge can modify their role to `boss` in DevTools
- A compromised browser extension or malware can manipulate Firebase writes
- Data integrity depends on "everyone playing nice"

**The Fix:** Add Firebase Cloud Functions (or a lightweight backend) to enforce business rules server-side. The browser should be a "dumb terminal" — render data, capture input, send to API. The API decides if the action is allowed.

### 🔴 CRITICAL: No Data Validation

**The Problem:** Firebase RTDB accepts any JSON structure. There is no schema enforcement.

**Real scenarios that will corrupt data:**
- A user types a string into a number field → `laborBudget` becomes `"abc"` → all budget math breaks
- A PO is submitted with `qty: -5` → inventory logic inverts
- A worker's hourly rate is set to `999999` → payroll calculation explodes
- Two users edit the same project simultaneously → last-write-wins, data loss

**The Fix:** Cloud Functions with Joi/Yup/Zod validation. Every write goes through a function that validates type, range, and business rules before touching the database.

### 🔴 CRITICAL: No Automated Backups

**The Problem:** Backups are manual (Firebase Console → Export). No one will remember to do this for 3 years.

**Real scenario:** A user accidentally clicks "Delete Project" and types DELETE. Or a bug in a new version wipes data. Or Firebase has an outage and data is corrupted.

**The Fix:**
- **Immediate:** Set up Firebase's automated backups (Blaze plan required, ~$5/month)
- **Better:** Cloud Function triggered by `schedule` that exports RTDB to Cloud Storage daily
- **Best:** Cloud Function that snapshots critical data before any destructive operation

### 🟠 HIGH: No Testing Infrastructure

**The Problem:** Zero automated tests. Every change is tested manually by clicking through the UI.

**Why this matters:** As the team grows, features will be added. Each addition risks breaking existing functionality. Without tests, you discover bugs in production.

**The Fix:**
- Unit tests for `utils.js` functions (formatting, calculations, validation)
- Integration tests for Firebase rules (using `@firebase/rules-unit-testing`)
- E2E tests for critical paths (login → create project → submit PO → approve → record delivery)

**Recommended tool:** Vitest (fast, zero-config) for unit tests; Playwright for E2E.

### 🟠 HIGH: No Staging Environment

**The Problem:** All changes go directly to production. The `sw.js` cache means users might get old code. The Firebase rules are live immediately.

**Real scenario:** You deploy a new version with a bug in `labor.js`. The bug corrupts payroll data for all active projects. There is no rollback.

**The Fix:**
- Create a second Firebase project (`acpm-staging`)
- Deploy changes to staging first, test with real data (anonymized), then promote to production
- Use Firebase Hosting channels for preview deployments

### 🟠 HIGH: Firebase Rules Lag Behind UI

**The Problem:** The `database.rules.json` has broad permissions. Example:
```json
"projects": {
  ".read": "auth != null",
  ".write": "auth != null",
  "$pid": {
    ".write": "auth != null && (root.child('users/' + auth.uid + '/role').val() === 'boss' || ...)"
  }
}
```

This means any authenticated user can write to any project if they know the project ID. The role check is complex and error-prone.

**The Fix:** Tighten rules to match the API layer. If you add Cloud Functions, make rules `auth != null` for reads but restrict writes to an admin service account. All writes go through Cloud Functions.

### 🟡 MEDIUM: Realtime Database Limitations

**The Problem:** Firebase RTDB is great for chat, but constraining for structured business data:
- No querying (can't query "all POs with status='pending' across all projects" without loading everything)
- No transactions across multiple nodes (can't atomically update inventory AND ledger)
- No server-side computed fields (can't have a `totalSpent` that auto-updates)
- Deep nesting makes reads inefficient (opening a project loads ALL its data)

**The Fix:** Migrate to **Cloud Firestore** (still Firebase, but document-based with proper querying). This is a significant migration but Firebase provides tools. Alternatively, accept the limitations and denormalize data aggressively.

### 🟡 MEDIUM: No Error Boundaries or Crash Recovery

**The Problem:** If any module throws an unhandled exception, the entire app can become unresponsive. There's no `try/catch` around the listener callbacks.

**Real scenario:** `renderTradeChips()` gets a malformed trade object → throws → the trade list never renders → the user can't assign workers → payroll is blocked.

**The Fix:**
- Wrap every Firebase listener callback in `try/catch`
- Add a global `window.onerror` handler that shows a "Something went wrong" message
- Add retry logic for failed Firebase operations

### 🟡 MEDIUM: Service Worker Cache Versioning is Manual

**The Problem:** `CACHE_NAME = 'acpm-v6'` is hardcoded. If you forget to bump it, users get stale code. If you bump it wrong, users get broken code.

**The Fix:**
- Add a build step that injects a git hash or timestamp into `CACHE_NAME`
- Or use a "cache-busting" query string approach
- Or migrate to Workbox (Google's tool for this exact problem)

### 🟢 LOW: Global Namespace Pollution

**The Problem:** The app uses `window._currentUser`, `window._currentPid`, `window._db`, etc. Any browser extension or third-party script can overwrite these.

**The Fix:** Wrap the entire app in an IIFE or ES modules. Use `import`/`export` instead of `window.*` globals. This requires a build step (Vite, Rollup, or Webpack).

---

## 4. Recommended Architecture ("Set It and Forget It")

### 4.1 Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER (PWA)                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │  UI      │  │  State   │  │  Offline │                  │
│  │  (React/ │  │  (Zustand│  │  Cache   │                  │
│  │  Vanilla)│  │  /Redux) │  │  (IDB)   │                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│       │             │             │                         │
│  ┌────┴─────────────┴─────────────┴─────────────────────┐  │
│  │  HTTP Client (fetch/axios) — calls API, not DB      │  │
│  └────────────────────┬──────────────────────────────────┘  │
└───────────────────────┼─────────────────────────────────────┘
                        │ HTTPS
┌───────────────────────┼─────────────────────────────────────┐
│  FIREBASE / GCP       │                                     │
│  ┌────────────────────┴──────────────────────────────────┐  │
│  │  CLOUD FUNCTIONS (Node.js) — Business Logic Layer      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐             │  │
│  │  │  Auth    │  │  Validate│  │  Process │             │  │
│  │  │  Check   │→ │  Input   │→ │  Biz Rule│             │  │
│  │  └──────────┘  └──────────┘  └──────────┘             │  │
│  │       │                               │               │  │
│  │       └───────────────────────────────┘               │  │
│  │                    │                                    │  │
│  │  ┌─────────────────┴─────────────────────────────────┐  │  │
│  │  │  FIRESTORE (primary) / RTDB (legacy sync)         │  │  │
│  │  └───────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  CLOUD SCHEDULER → Daily backup to Cloud Storage     │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  FIREBASE AUTH (existing) — Keep                     │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Why This Architecture?

| Principle | How It's Achieved |
|-----------|-------------------|
| **Server is the authority** | Cloud Functions validate every request |
| **Data is protected** | Firebase rules are strict; all writes go through functions |
| **Changes are safe** | Staging environment + automated tests before production |
| **Backups are automatic** | Cloud Scheduler + Cloud Storage |
| **Scaling is free** | Firebase handles infrastructure; you write code |
| **Cost is predictable** | Blaze plan pay-as-you-go; ~$10-50/month for 10-20 users |
| **No ops team needed** | Firebase manages servers, SSL, CDN, auth |

---

## 5. Migration Roadmap (Incremental, Low-Risk)

### Phase 1: Harden (Weeks 1-2) — Do This First
**Goal:** Prevent catastrophic data loss and unauthorized access immediately.

| Task | Effort | Impact |
|------|--------|--------|
| 1.1 Enable Firebase Blaze plan + automated daily backups | 30 min | 🔴 Critical |
| 1.2 Export full RTDB to JSON as a baseline restore point | 15 min | 🔴 Critical |
| 1.3 Audit all `database.rules.json` — tighten project-scoped rules | 2 hours | 🔴 Critical |
| 1.4 Add `requireEdit()` / `requireBoss()` to EVERY write function | 4 hours | 🔴 Critical |
| 1.5 Add input validation to all forms (min/max, type checks) | 4 hours | 🟠 High |
| 1.6 Create staging Firebase project (`acpm-staging`) | 1 hour | 🟠 High |
| 1.7 Add `window.onerror` global handler + user-friendly error screen | 1 hour | 🟡 Medium |

### Phase 2: API Layer (Weeks 3-6)
**Goal:** Move business logic from browser to server. This is the structural fix.

| Task | Effort | Impact |
|------|--------|--------|
| 2.1 Set up Firebase Cloud Functions project | 2 hours | 🔴 Critical |
| 2.2 Create `onCall` functions for critical mutations: `createProject`, `submitPO`, `approvePO`, `savePayroll`, `addBillingRequest` | 16 hours | 🔴 Critical |
| 2.3 Add server-side validation (Joi or Zod) to all functions | 8 hours | 🔴 Critical |
| 2.4 Update client code to call Cloud Functions instead of direct DB writes | 12 hours | 🔴 Critical |
| 2.5 Tighten Firebase rules: allow reads for authenticated users, restrict writes to admin service account only | 4 hours | 🔴 Critical |
| 2.6 Test all critical paths on staging before production | 8 hours | 🟠 High |

### Phase 3: Modernize (Weeks 7-12)
**Goal:** Improve developer experience, add testing, prepare for growth.

| Task | Effort | Impact |
|------|--------|--------|
| 3.1 Add Vite build system ( bundling, code splitting, environment variables) | 4 hours | 🟡 Medium |
| 3.2 Convert JS to ES modules (remove `window.*` globals) | 8 hours | 🟡 Medium |
| 3.3 Add TypeScript (gradual migration, start with `utils.js`) | 16 hours | 🟡 Medium |
| 3.4 Add Vitest unit tests for `utils.js` and calculation functions | 8 hours | 🟠 High |
| 3.5 Add Firebase Rules unit tests | 4 hours | 🟠 High |
| 3.6 Add Playwright E2E tests for critical user journeys | 12 hours | 🟠 High |
| 3.7 Replace manual `sw.js` cache with Workbox auto-generated caching | 4 hours | 🟡 Medium |
| 3.8 Add CI/CD pipeline (GitHub Actions → deploy to staging → promote to production) | 8 hours | 🟠 High |

### Phase 4: Scale (Months 4-6)
**Goal:** Handle more users, more projects, more data without performance degradation.

| Task | Effort | Impact |
|------|--------|--------|
| 4.1 Evaluate migration from RTDB to Cloud Firestore | 4 hours | 🟡 Medium |
| 4.2 If migrating: plan denormalization strategy, run migration scripts | 40 hours | 🟡 Medium |
| 4.3 Add database indexing for common queries | 4 hours | 🟡 Medium |
| 4.4 Add Firebase Performance Monitoring | 2 hours | 🟡 Medium |
| 4.5 Add Firebase Crashlytics for error tracking | 2 hours | 🟡 Medium |
| 4.6 Add data retention policies (auto-archive old completed projects) | 8 hours | 🟡 Medium |

---

## 6. Immediate Action Items (Do These Today)

### 6.1 Backup Your Data (15 minutes)
```bash
# In Firebase Console:
# 1. Go to Realtime Database → Data tab
# 2. Click the "⋮" menu → Export JSON
# 3. Save to a dated file: ACPM-backup-2026-06-23.json
# 4. Store in a secure location (Google Drive, encrypted USB, etc.)
```

### 6.2 Enable Automated Backups (30 minutes)
```bash
# 1. Upgrade Firebase project to Blaze plan (pay-as-you-go)
# 2. Go to Realtime Database → Backups tab
# 3. Enable automated backups → daily → Cloud Storage bucket
# 4. Cost: ~$0.10/GB/month for storage + backup operation fees
```

### 6.3 Fix the Most Dangerous Rule (30 minutes)

In `database.rules.json`, the `projects` node allows any authenticated user to write:
```json
"projects": {
  ".read": "auth != null",
  ".write": "auth != null",  // ← THIS IS DANGEROUS
  ...
}
```

**Fix:** Remove the top-level `.write` and rely only on `$pid` level:
```json
"projects": {
  ".read": "auth != null",
  // REMOVE: ".write": "auth != null"
  "$pid": {
    ".read": "auth != null",
    ".write": "auth != null && (root.child('users/' + auth.uid + '/role').val() === 'boss' || root.child('users/' + auth.uid + '/projects').hasChild($pid))"
  }
}
```

### 6.4 Add This Line to Every Module (1 hour)

Every module's write functions should start with:
```javascript
if (!requireEdit(window._currentPid)) return;
```

Audit these files for missing guards:
- `labor.js`: `addTrade`, `addWorker`, `saveAdvance`, `markAttendance`, `compilePayroll`
- `materials.js`: `addDraftItem`, `updateLedgerStatus`, `deleteLedgerItem`
- `billing.js`: `addBillingRequest`, `addCollection`, `deleteBilling`
- `changeorders.js`: `addChangeOrder`, `deleteCO`
- `tasks.js`: `addTask`, `updateTaskStatus`, `deleteTask`
- `equipment.js`: `addEquipment`, `logEquipHours`, `deleteEquipment`
- `compliance.js`: `addCompliance`, `renewCompliance`, `deleteCompliance`
- `defects.js`: `addDefect`, `closeDefect`, `deleteDefect`
- `sitelog.js`: `saveSiteLog`, `deleteSiteLog`

### 6.5 Create a Staging Project (1 hour)

```bash
# 1. In Firebase Console, create new project: acpm-staging
# 2. Enable Auth (Email/Password) with same users (use test passwords)
# 3. Copy database structure from production (use the JSON export)
# 4. Update database.rules.json to staging
# 5. Test all workflows before touching production
```

---

## 7. Cost Projection (Firebase Blaze Plan)

| Component | Monthly Estimate (6 users) | Monthly Estimate (15 users) |
|-----------|---------------------------|----------------------------|
| Firebase Auth | Free (under 10k users/month) | Free |
| Realtime Database | $5 (under 10GB stored, 10GB transfer) | $15-25 |
| Cloud Functions (1M invocations) | $0 (free tier) | $0-5 |
| Cloud Storage (backups) | $1 | $3-5 |
| Firebase Hosting | Free (under 10GB/month) | Free |
| **Total** | **~$6-10/month** | **~$20-40/month** |

**Note:** If you migrate to Cloud Firestore, costs shift from RTDB bandwidth to Firestore document reads/writes. For 10-20 users, expect similar costs.

---

## 8. Technical Debt Register

| Debt Item | Severity | Created | Resolved By | Notes |
|-----------|----------|---------|-------------|-------|
| Client-side role enforcement | 🔴 Critical | v1.0 | Phase 2 (Cloud Functions) | Browser can be bypassed |
| No server-side validation | 🔴 Critical | v1.0 | Phase 2 (Cloud Functions) | Invalid data accepted |
| No automated backups | 🔴 Critical | v1.0 | Phase 1 (Firebase Backups) | Manual only currently |
| No test coverage | 🟠 High | v1.0 | Phase 3 (Testing) | Zero tests |
| No staging environment | 🟠 High | v1.0 | Phase 1 (Staging Project) | Direct to production |
| Firebase Rules too broad | 🟠 High | v1.0 | Phase 1 (Rule Tightening) | Authenticated = write access |
| Global namespace pollution | 🟡 Medium | v1.0 | Phase 3 (ES Modules) | `window._*` variables |
| Manual SW cache versioning | 🟡 Medium | v1.0 | Phase 3 (Workbox) | Hardcoded `acpm-v6` |
| RTDB deep nesting | 🟡 Medium | v1.0 | Phase 4 (Firestore) | Hard to query across projects |
| No error boundaries | 🟡 Medium | v1.0 | Phase 1 (Global Handler) | App can crash silently |

---

## 9. Final Recommendations

### For the Business Owner (LeBuild)

1. **Budget $2,000-3,000 and 4-6 weeks** for Phase 1 + Phase 2 (hardening + API layer). This is a one-time investment that buys you 3 years of stability.
2. **Do not add new major features** until Phase 2 is complete. New features on a shaky foundation = more debt.
3. **Hire a Firebase/Node.js contractor for Phase 2** if your team doesn't have backend experience. This is 2-3 weeks of work for a senior developer.
4. **Keep the PWA approach** — it works, users like it, offline capability is valuable on construction sites.
5. **Plan for Firestore migration in Year 2** — RTDB will hit query limitations as you scale past 20 projects.

### For the Development Team

1. **Stop adding features to `main.js` and `labor.js`.** They are already 944 and 1662 lines. Split into smaller files.
2. **Every new write function MUST use `requireEdit()`** — make this non-negotiable.
3. **Run the staging environment** — every code change goes to staging first, tested, then promoted.
4. **Document the data model** — write down what each node expects (types, ranges, required fields).
5. **Add the global error handler this week** — it's 10 lines and prevents user-facing crashes.

### For the 3-Year Vision

The goal is a system where:
- ✅ Users can't corrupt data, even intentionally
- ✅ Backups happen automatically without human intervention
- ✅ New features can be added without fear of breaking existing ones
- ✅ A new developer can onboard in 1 day, not 1 week
- ✅ The system runs for 6 months without anyone touching the infrastructure
- ✅ Scaling from 6 to 20 users requires zero architectural changes

**Current state:** 3/10 (functional but fragile)
**After Phase 1:** 5/10 (safe from catastrophic loss)
**After Phase 2:** 7/10 (structurally sound, secure)
**After Phase 3:** 8/10 (maintainable, tested)
**After Phase 4:** 9/10 (scalable, monitored)

---

## 10. One-Pager: "What to Do This Week"

```
Monday:   Backup production data → JSON export
Tuesday:  Enable Firebase Blaze plan + automated backups
Wednesday: Fix database.rules.json (remove top-level .write)
Thursday: Add requireEdit() to all unguarded write functions
Friday:   Create acpm-staging Firebase project, test rules
Weekend:  Deploy rules to production, verify no permission errors
```

---

*Review completed. Questions or need implementation assistance for any phase, ask.*
