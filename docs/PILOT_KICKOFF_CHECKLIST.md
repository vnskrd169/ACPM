# ACPM Controlled Pilot — Kickoff Checklist

## Pre-Pilot Setup

### Project
- [ ] Select one real construction project (low-to-medium complexity)
- [ ] Do NOT migrate legacy data — start fresh in ACPM
- [ ] Maintain parallel Excel tracking throughout pilot

### Personnel
- [ ] Identify Boss/Admin user
- [ ] Identify Project Manager user
- [ ] Identify Associate PM user
- [ ] Verify each user has a Firebase Auth account (email/password or Google)
- [ ] Verify each user is approved in ACPM (status: active)
- [ ] Assign each user to the pilot project via Team Admin
- [ ] Verify each user can access the project workspace

### Training
- [ ] Schedule 30-minute walkthrough per user
- [ ] Cover: hub navigation, workspace tabs, Ctrl+K command palette
- [ ] Cover: module-specific workflows (labor, materials, billing, site log)
- [ ] Provide written quick-start guide (`docs/product/ONBOARDING_CHEAT_SHEET.md`)
- [ ] Confirm users can log in and navigate independently

## Week 1 — Onboarding & Labor

### Daily Tasks
- [ ] Record attendance for all workers
- [ ] Create new workers if needed
- [ ] Log any issues in `docs/PILOT_ISSUE_LOG.md`
- [ ] Reconcile attendance totals with Excel daily

### End-of-Week Review
- [ ] Verify weekly payroll compilation
- [ ] Verify RFP totals match Excel
- [ ] Verify per-trade separation is correct
- [ ] Review issue log with pilot users
- [ ] Document any needed process adjustments

## Week 2 — Materials

### Daily Tasks
- [ ] Create POs for material orders
- [ ] Record deliveries (partial and full)
- [ ] Issue materials from inventory
- [ ] Reconcile inventory levels with Excel

### End-of-Week Review
- [ ] Verify PO approval workflow
- [ ] Verify inventory levels match Excel
- [ ] Verify material movement ledger is complete
- [ ] Review issue log

## Week 3 — Billing & Site Log

### Daily Tasks
- [ ] Record site log entries
- [ ] Create billing requests as needed
- [ ] Record collections
- [ ] Log change orders if applicable

### End-of-Week Review
- [ ] Verify billing totals match contract values
- [ ] Verify collected amounts match Excel
- [ ] Verify site log entries are complete
- [ ] Review issue log

## Week 4 — Reports & Reconciliation

### Daily Tasks
- [ ] Compare Dashboard totals to module values
- [ ] Compare Reports totals to source records
- [ ] Reconcile ALL data with Excel backup

### Go/No-Go Decision
- [ ] All core workflows used daily for 2+ consecutive weeks
- [ ] Users report system is faster or equivalent to Excel
- [ ] No critical bugs reported in final week
- [ ] ACPM data matches Excel reconciliation
- [ ] **Go**: Expand to 2-3 projects
- [ ] **No-Go**: Return to Excel, re-pilot after fixes

## Rollback Triggers (Stop Pilot Immediately)
- [ ] Data loss — any record lost/corrupted unrecoverably
- [ ] Financial discrepancy > PHP 500 vs Excel
- [ ] Critical security breach
- [ ] Downtime exceeding 4 hours
- [ ] Users decline to continue
