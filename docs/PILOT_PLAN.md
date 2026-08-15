# ACPM Controlled Pilot Plan

## Objective
Validate ACPM for daily office use with one real construction project under controlled conditions.

---

## Pilot Scope

### Projects
- **One real project only** — select a low-to-medium complexity project.
- No legacy data migration — start fresh in ACPM.
- Parallel Excel tracking continues for reconciliation.

### Personnel
| Role | Count | Responsibilities |
|------|-------|-----------------|
| Boss / Admin | 1 | Oversight, approvals, user management |
| Project Manager | 1 | Daily operations, reports |
| Associate PM | 1 | Data entry, attendance, materials |

### Excluded Roles
- Field engineers, site supervisors, subcontractors — not included in the pilot.
- Face attendance — deferred until pilot validates core modules.

---

## Pilot Period

**Duration:** 4 weeks (recommended)

| Week | Focus |
|------|-------|
| 1 | Onboarding, project setup, labor attendance |
| 2 | Materials procurement, POs, deliveries |
| 3 | Billing, change orders, site log |
| 4 | Reports reconciliation, feedback, go/no-go decision |

---

## Training

Each pilot user receives:
1. One 30-minute walkthrough of the hub and workspace navigation.
2. Written quick-start guide for their role (see `docs/product/ONBOARDING_CHEAT_SHEET.md`).
3. Contact for reporting issues during pilot.

---

## Daily Issue Logging

All issues found during the pilot are logged in:
- The ACPM project's issue tracker
- A parallel spreadsheet as backup

---

## Rollback Criteria

The pilot will be stopped and Excel-only tracking resumed if any of the following occur:

1. **Data loss** — any record is lost or corrupted and cannot be recovered.
2. **Financial discrepancy** — payroll, billing, or material totals differ from Excel by more than PHP 500.
3. **Critical security breach** — unauthorized access to project data.
4. **Extended downtime** — the application is unavailable for more than 4 hours.
5. **User rejection** — pilot users decline to continue.

---

## Success Criteria

The pilot is considered successful when:

1. All core workflows (labor, materials, billing, site log) are used daily for 2 consecutive weeks.
2. Users report the system is faster or equivalent to Excel tracking.
3. No critical bugs reported in the final week.
4. Data from ACPM matches Excel reconciliation.

---

## Go/No-Go Decision

At the end of Week 4:
- **Go**: Expand to 2-3 projects, add field roles.
- **No-Go**: Return to full Excel tracking, address identified issues, re-pilot.

---

## Data Cleanup

At the end of the pilot:
- QA records may be voided or archived.
- Real project data remains in the system.
- If No-Go: export all data to JSON for archival.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| User adoption resistance | Weekly check-ins, one-on-one support |
| Data entry errors | Daily reconciliation with Excel |
| Mobile access issues | Desktop-first during pilot |
| PWA cache confusion | Clear instructions on refresh behavior |
