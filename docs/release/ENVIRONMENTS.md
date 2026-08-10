# ACPM Environments

ACPM uses two isolated Firebase projects. Staging is the proving ground; live
construction records remain in Production.

| Environment | Hosting | Firebase project | Realtime Database |
| --- | --- | --- | --- |
| Production | `https://acpm-project-system.web.app` | `acpm-project-system` | `acpm-project-system-default-rtdb` |
| Staging | `https://acpm-project-system-qa.web.app` | `acpm-project-system-qa` | `acpm-project-system-qa-default-rtdb` |

## Safety Rules

- Never copy real payroll, billing, personal, or project records into Staging.
- Staging records are disposable and must use clearly fake QA names.
- Public Production hostnames are hard-locked to the Production Firebase config.
- Localhost uses Staging by default.
- Use `?env=production` locally only for an intentional read/verification task.
- `.firebaserc` has no default alias. Every deployment must name its project.
- Production deployment requires the explicit `-ConfirmProduction` switch.

## Normal Release Flow

1. Make and review the change locally.
2. Run:

```powershell
npm.cmd run test:environments
node scripts/pwa_cache_static_qa.js
node scripts/rc1_static_gate.js
```

3. Deploy code and rules to Staging:

```powershell
npm.cmd run deploy:staging
```

4. Test authentication, refresh, project switching, create/edit/archive,
   affected module workflows, and PMOS on Staging.
5. Promote the exact tested source state to Production:

```powershell
.\scripts\deploy-production.ps1 -ConfirmProduction
```

6. Include database rules only after rule review and emulator QA:

```powershell
.\scripts\deploy-production.ps1 -ConfirmProduction -IncludeDatabase
```

## Local URLs

- Staging backend (default): `http://127.0.0.1:8018/login.html`
- Explicit Staging: `http://127.0.0.1:8018/login.html?env=staging`
- Explicit Production: `http://127.0.0.1:8018/login.html?env=production`

The active Staging build always displays `STAGING - TEST DATA` at the top of
the screen and prefixes the page title with `[STAGING]`.

## QA Authentication Configuration

Staging Email/Password and Google providers are configured independently from
Production. To reproduce or repair the Staging provider configuration, run:

```powershell
npm.cmd run configure:staging:auth
```

The command uses `firebase.auth.staging.json`, explicitly targets
`acpm-project-system-qa`, and provisions the Staging OAuth brand/client when
needed. It does not change Production Authentication.

Firebase Storage is not required. Do not enable Storage for PMOS photos; the
existing Google Drive Apps Script remains the approved transport.

## Recovery

If a release fails Staging QA, do not deploy Production. Fix the same branch,
bump the cache/script versions when assets change, redeploy Staging, and repeat
the failed workflow. Production remains on its last verified version.
