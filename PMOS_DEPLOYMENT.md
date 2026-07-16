# PMOS Deployment Guide

## Staging Deployment

```bash
# Deploy to Firebase preview channel
firebase hosting:channel:deploy pmos-staging

# Test at the generated preview URL
```

## Production Deployment

```bash
# 1. Run all checks
node --check pmos.js
node --check pmos-office.js
node --check meeting-notes.js
node --check face-attendance.js
node --check acpm-shell.js
node scripts/rc1_static_gate.js
node scripts/pwa_cache_static_qa.js

# 2. Deploy hosting and rules
firebase deploy --only hosting,database,storage

# 3. Verify
firebase hosting:channel:open live
```

## Cache Versioning

When deploying PMOS updates:

1. Update `CACHE_VERSION` in `acpm-shell.js`: `acpm-pmos-v2`, `acpm-pmos-v3`, etc.
2. Update version query strings in `pmos.html`:
   - `pmos.js?v=4`
   - `pmos-office.js?v=6`
   - `meeting-notes.js?v=1`
3. Update `sw.js`:
   - `PMOS_CACHE = 'pmos-cache-v2'`
   - Add new assets to ASSETS array
4. Run cache validation:
   ```bash
   node scripts/pwa_cache_static_qa.js
   ```

## Rollback

```bash
# Rollback hosting to previous version
firebase hosting:clone v1 v0 live

# Or use the Firebase Console to rollback
```

## Firebase Rules Deployment

```bash
# Database rules
firebase deploy --only database

# Storage rules
firebase deploy --only storage

# Dry run (validate syntax)
firebase deploy --only database --dry-run
```

## First Controlled Site Test

1. Deploy to staging channel
2. Test with one project manager + one site engineer
3. Verify authentication, project access, and photo upload
4. Test offline mode
5. If stable, promote to production

## Required Environment

- Firebase project: `acpm-project-system`
- Firebase Hosting: `acpm-project-system.web.app`
- Firebase Database: `acpm-project-system-default-rtdb.asia-southeast1`
- Firebase Storage: `acpm-project-system.firebasestorage.app`
