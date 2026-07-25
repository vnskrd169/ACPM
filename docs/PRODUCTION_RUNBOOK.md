# ACPM Production Runbook

## Overview
This document covers deployment, monitoring, rollback, and emergency procedures for the ACPM Project Management System.

---

## Deployment

### Hosting Deployment
```bash
firebase deploy --only hosting --project acpm-project-system
```

### Realtime Database Rules
```bash
firebase deploy --only database --project acpm-project-system
```

### Storage Rules
```bash
firebase deploy --only storage --project acpm-project-system
```

### Full Deploy
```bash
firebase deploy --project acpm-project-system
```

---

## Pre-Deployment Checklist

1. Run all static QA scripts:
   ```bash
   node scripts/rc1_static_gate.js
   node scripts/pwa_cache_static_qa.js
   node scripts/rc1_docs_static_qa.js
   ```

2. Verify JavaScript syntax:
   ```bash
   node --check utils.js main.js auth.js labor.js
   ```

3. Bump PWA cache version in `sw.js` and update version strings in all HTML files.

4. Review git diff for unintended changes.

---

## Post-Deployment Smoke Test

1. Open `https://acpm-project-system.web.app/` in a private/incognito window.
2. Verify login page renders with no console errors.
3. Test Ctrl+K opens the command palette.
4. Verify responsive layout at 1280px and 375px widths.
5. Check that all assets load (no 404s in console).

---

## Rollback Procedure

### If deployment causes issues:

1. Identify the previous stable commit:
   ```bash
   git log --oneline -10
   ```

2. Rollback hosting to the previous deployment:
   ```bash
   firebase hosting:clone acpm-project-system:live acpm-project-system:live --only hosting
   ```
   Or use the Firebase Console: Hosting > Versions > Rollback.

3. Rollback database rules:
   ```bash
   git checkout <previous-commit> -- database.rules.json
   firebase deploy --only database --project acpm-project-system
   ```

4. If PWA cache shows stale UI, instruct users to:
   - Clear site data in Chrome DevTools > Application > Clear Storage.
   - Or uninstall and re-install the PWA.

---

## Emergency Access Disable

If an emergency requires disabling access:

1. **Disable all Firebase Auth users** via Firebase Console > Authentication > Users.
2. **Or** deploy restrictive database rules:
   ```json
   {
     "rules": { ".read": false, ".write": false }
   }
   ```
3. **Or** disable the Firebase project via GCP Console.

---

## Data Backup

Firebase Realtime Database does not have automatic backups. Periodically export:

```bash
firebase database:get / --project acpm-project-system > backup-$(date +%Y%m%d).json
```

Store backups in a secure, off-network location.

---

## Known PWA Cache Behavior

- Cache version: `acpm-v126`
- After deployment, users must refresh twice or close/reopen the app to receive the update.
- The service worker updates in the background; the new version activates on next launch.
- To force an immediate update, users can clear site data.

---

## Monitoring

- Firebase Console > Database > Usage for read/write monitoring.
- Firebase Console > Hosting for bandwidth and request monitoring.
- Browser console errors should be reported via the application's audit log.

---

## Incident Response

1. **Database performance degradation**: Check Firebase Console > Database > Usage. Add indexes if queries are slow.
2. **Authentication failures**: Check Firebase Console > Authentication for provider status.
3. **Data integrity issues**: Export current data, restore from previous backup, reconcile manually.
4. **UI rendering issues**: Check browser console for JS errors. Rollback hosting if issue is in current deploy.

---

## Contact

For production issues, contact the development team via the project's issue tracker.
