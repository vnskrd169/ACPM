# ACPM

ACPM is LeBuild's construction project management PWA for project operations, payroll, procurement, billing, reports, and role-controlled Firebase collaboration.

Status: Release Candidate 1 ready.

## Live App

- GitHub Pages: https://vnskrd169.github.io/ACPM/
- Firebase project: `acpm-project-system`

## Root Structure

```text
/
|-- index.html              # Legacy/app entry redirect support
|-- login.html              # Auth entry
|-- dashboard.html          # Project hub
|-- workspace.html          # Project workspace
|-- auth.js                 # Auth/session guard
|-- main.js                 # Dashboard, routing, shared app shell
|-- labor.js                # Labor/payroll module
|-- materials.js            # Materials/procurement module
|-- billing.js              # Billing helpers
|-- changeorders.js         # Change order workflow
|-- sitelog.js              # Site log workflow
|-- suppliers.js            # Supplier workflow
|-- report.js               # Reports module
|-- notifications.js        # Notification event hooks
|-- style.css               # App styling
|-- sw.js                   # PWA service worker
|-- manifest.json           # PWA manifest
|-- database.rules.json     # Firebase Realtime Database rules
|-- scripts/                # QA, release, and Firebase verification scripts
`-- docs/                   # Architecture, schema, QA, and release documents
```

## Documentation

- [Documentation index](docs/README.md)
- [RC1 readiness](docs/release/RC1_READINESS.md)
- [Post-deploy QA](docs/release/RC1_POST_DEPLOY_QA.md)
- [Operations runbook](docs/release/OPERATIONS.md)

## RC1 Verification

Run the local release gates before publishing changes:

```powershell
node scripts/rc1_docs_static_qa.js
node scripts/rc1_static_gate.js
node scripts/rc1_post_deploy_gate.js
node scripts/rc1_final_readiness_gate.js
```

Live Firebase write QA requires approved QA credentials and should only be run intentionally:

```powershell
$env:RUN_REAL_QA="1"
$env:ACPM_QA_EMAIL="approved-qa-email"
$env:ACPM_QA_PASSWORD="approved-qa-password"
node scripts/rc1_post_deploy_gate.js
```

## RC1 Role Policy

Active RC1 access is limited to:

- Boss / Owner
- Admin
- PM / APM

Foreman, Safety, and Viewer are documented as future roles and remain disabled until a child-level Firebase read model is implemented and tested.
