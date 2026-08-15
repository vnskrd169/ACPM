# PMOS Deployment Guide

## Architecture Overview

PMOS lives under a dedicated `/pmos/` URL scope, isolated from the ACPM root application:

```
/                              — ACPM root application (sw.js, main.js, auth.js, etc.)
  pmos.html                    — Compatibility redirect → /pmos/
  pmos/                        — PMOS PWA application
    index.html                 — PMOS entry point
    pmos-sw.js                 — PMOS service worker (scope: /pmos/)
    pmos-manifest.json          — PMOS PWA manifest
    offline.html               — Offline fallback page
    icons/                     — PWA icons
```

## Service Worker Isolation

- **ACPM worker**: `sw.js` — scope `/` — unmodified
- **PMOS worker**: `pmos/pmos-sw.js` — scope `/pmos/` — standalone
- No scope collision, no double registration, no competing cache cleanup
- PMOS cache names are prefixed with `pmos-cache-` to avoid conflicts

## Preview Deployment

```bash
# Deploy to Firebase preview channel
firebase hosting:channel:deploy pmos-staging

# Test at the generated preview URL
# Note: PMOS assets live under /pmos/ subpath
```

## Production Deployment

```bash
# 1. Run all checks
node --check pmos.js
node --check pmos-office.js
node --check meeting-notes.js
node --check face-attendance.js
node --check acpm-shell.js
node --check pmos-subscription-manager.js
node --check pmos-pagination.js
node --check pmos-photo-lightbox.js
node --check pmos/pmos-sw.js
npm run test:pmos

# 2. Deploy hosting only (rules are proposed — do not deploy without owner approval)
firebase deploy --only hosting

# 3. Verify
firebase hosting:channel:open live
```

## Firebase Rules Deployment (Owner Approval Required)

**Do not deploy the proposed rules without owner review.**

### Proposed rule files:
- `database.rules.pmos-proposed.json` — PMOS database security rules
- `storage.rules.pmos-proposed` — PMOS storage security rules

### Merge procedure:
1. Owner reviews proposed rules
2. Owner merges proposed rules into production rule files
3. Deploy:
```bash
firebase deploy --only database,storage
```

### Dry run (validate syntax only):
```bash
firebase deploy --only database --dry-run
```

## Cache Versioning

When deploying PMOS updates:

1. Update `APP_VERSION` in `acpm-shell.js` (e.g., `1.1.0` → `1.2.0`)
2. Update version query strings in `pmos/index.html`:
   - `../pmos.js?v=N`
   - `../pmos-office.js?v=N`
   - `../meeting-notes.js?v=N`
3. The PMOS service worker (`pmos/pmos-sw.js`) caches updated assets on next load
4. No manual cache version update needed (PMOS worker uses network-first strategy for JS)

## Rollback

```bash
# Rollback hosting to previous version
firebase hosting:clone v1 v0 live

# Or use the Firebase Console to rollback
```

## PMOS Cache Rollback

The PMOS service worker uses cache-first for app shell and network-first for data. To clear PMOS cache:
1. Open Chrome DevTools → Application → Cache Storage
2. Delete `pmos-cache-v1` (or current version)
3. Reload PMOS

## Disabling Face Attendance

Set in `pmos.html` or `pmos/index.html` before the face-attendance.js script:
```js
window.PMOS_CONFIG = window.PMOS_CONFIG || {};
window.PMOS_CONFIG.faceAttendanceEnabled = false;
```

The feature is disabled by default. No models, camera access, or Firebase listeners are initialized when disabled.

## Controlled Site Test Procedure

1. Deploy to preview/staging channel
2. Test with one project manager + one site engineer
3. Verify:
   - Authentication and project access
   - All 7 PMOS modules (Quick Update, Site Log, Issue, Material Request, Follow-up, Meeting Notes, Photos)
   - Photo upload to Google Drive (Apps Script transport, no Firebase Storage)
   - Offline mode + sync
   - Office Hub review
4. If stable, get owner approval for production deployment

## Required Environment

- **Firebase project**: `acpm-project-system`
- **Firebase Hosting**: `acpm-project-system.web.app`
- **Firebase Database**: `acpm-project-system-default-rtdb.asia-southeast1`
- **Firebase Storage**: locked to Drive-only policy — no uploads; authenticated reads only for legacy links

## Emulator Test Setup (for Development/QA)

```bash
# Pre-requisites
npm install --save-dev firebase --legacy-peer-deps
# Java 21+ required (portable JDK available at ./tmp_jdk/)

# Run database + storage rules tests
export JAVA_HOME=./tmp_jdk/jdk-21.0.1+12
export PATH=$JAVA_HOME/bin:$PATH
npx firebase emulators:exec --config firebase.pmos.test.json --only database,storage \
  "npx vitest run tests/pmos/rules-database.test.ts tests/pmos/rules-storage.test.ts"

# Run E2E tests
npm run test:e2e
```
