# Payroll payments and material planning — 2026-09-13

## Release scope

- Mission Board: a dedicated project-name editor updates only the name, checks for a conflicting edit, and refreshes the workspace title.
- Payroll: review separates regular, overtime, night pay and advances; archived payroll review retains snapshot rates and amounts. A new register records payments already made, including partial payments, payee, date, method and receipt/reference.
- Suppliers: per-order invoice, payments, credit notes and remaining balance; overpayments remain visible. Corrections add a void event while retaining the original entry.
- Materials: work packages start from saved material groups. Planned, pending approval, ordered, received and still-to-order quantities are tracked by explicit order links. Order remaining adds an editable draft without duplicating quantities already in that draft. Existing matching order lines can be linked without modifying quantities or receipts.

## Storage and authorization

Payment events use `projectPaymentEvents/{projectId}/{eventId}`. Active Boss, Owner, Admin and PM roles may read records; writes require an active project. APM and unauthenticated access are denied. Events are create-only, including against parent-path replacement. Corrections have a deterministic `void_{originalId}` key and must point to the same obligation, preventing a second void of the same entry.

Existing production rules were retrieved read-only and matched the local baseline exactly. Only the new payment-event root is added. Plans use the existing project editing permissions and reside at `projects/{projectId}/materialPlans`; linked PO items carry `planId` and a readable `planName`.

No production payroll, payment, order or project-name records were modified during QA. No bank transfer capability is introduced. Historical ledger paid labels are not automatically imported: users need to enter or reconcile actual prior payments. Worker figures explicitly show net after advances; any unallocated batch deduction is identified separately rather than silently assigned to workers. Payroll finalization permissions and payroll math remain the existing workflow.

## Validation

- `node scripts/project_controls_qa.cjs`: 20 behavior checks covering money, partial payments, credits, voids, payroll review, project-name-only edits, work packages, draft quantities, order linking, duplicate form submission and role cleanup.
- `node scripts/project_controls_rules_qa.cjs`: 20 Realtime Database emulator checks including authorized roles, denied reads/writes, immutable history, invalid sources, malformed amounts, correction integrity and concurrent distinct records.
- Existing materials and connected workspace regression suites: 41 checks.
- Environment, PWA cache and release static gates; APM workspace checks; JavaScript syntax and diff checks.
- Browser QA: centered desktop payroll review, 390px phone layout with document width exactly 390px, work-package quantities and navigation.

The local Windows Java runtime initially could not initialize AF_UNIX loopback sockets. Running the emulator with `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=E:/acpm-nonexistent-socket-dir` made Java fall back to TCP loopback. This setting is process-local, touches no app configuration and is used only for QA.

Cache version: `acpm-v155`. Deploy database rules and Hosting together using the existing staging and guarded production scripts. Verify served assets and rules against this release before the live UI check.

Deployed release `6bc117f` to staging and production. Ten production assets and the complete deployed database rules matched the release exactly. Signed-in live verification on Seasons 35D confirmed the name-only editor, supplier invoice/payment view, material-plan navigation and payroll payment section. The existing PO-001 and delivery history remained visible; the browser reported no console errors. No live form was submitted.
