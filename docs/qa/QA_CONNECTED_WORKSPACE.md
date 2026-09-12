# Connected workspace release — 2026-09-12

## Scope

Adds a project Mission Board with actionable records and responsible roles, budget explanations, project record search and timeline, accessible-project materials catalog, dated hardware price references, and account/project-specific local order drafts. Adds duplicate order warnings, expected delivery dates, delivery notes/photo metadata, task return reasons and record links in notifications. Simplifies daily reporting around the APM role.

The material group dialog remains centered. Existing materials groups, receive-all/partial workflows, readable references and collapsed stock tools are retained.

## Validation

- `node scripts/materials_workspace_qa.cjs`: 20 isolated checks, including receipt notes/photo metadata and remaining material commitments.
- `node scripts/connected_workspace_qa.cjs`: 21 isolated checks covering finances, action ownership, search, role-specific views, APM form, catalog/price reuse, draft isolation, duplicate warnings, task revisions and delayed geolocation duplicate-save prevention.
- Environment isolation, PWA cache, release static gates and APM workspace checks.
- JavaScript syntax checks and `git diff --check`.
- Browser preview: desktop Mission Board, centered breakdown dialog and 390px APM reporting layout. Fixture uses in-memory data and does not write production records.
- Production baseline matched the preceding deployed commit before release.

## Data and practical limits

This is a Hosting release without database/rules migration or historical financial/stock changes. Accessible-project catalog loading is explicit and uses the existing permission-aware project query. Draft recovery is local to the current browser origin, account and project.

Invoice amounts are not treated as payments. Payment cards describe legacy ledger entries marked paid; remaining invoice amounts are labeled for verification. A complete supplier payment register and historical reconciliation are outside this release.

Photo metadata persistence is tested with fixtures. Actual uploads use the existing site-log Drive transport; no real photo upload was made during QA. Existing cross-client receipt concurrency behavior and existing evidence-based AI functionality are unchanged.

## Deployment

Run the existing staging Hosting-only script and guarded production Hosting script. Service worker cache: `acpm-v154`. Check served assets against the local release and inspect the live Seasons project without submitting records.

Completed: staging and production Hosting deployments for commit `254c977`. Nine served assets matched the local release in both environments. The signed-in live Seasons workspace showed the new Mission Board, two delivery batches, the existing fully delivered PO-001 and all three saved material groups. No browser console errors were reported. No production records were submitted during verification.
