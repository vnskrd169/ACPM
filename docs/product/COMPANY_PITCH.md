# ACPM Company Proposal

**Para sa:** LeBuild Design & Construction Management
**From:** [Your Name]
**Date:** [Date of presentation]
**System:** ACPM — Art and Choi Project Management

---

## Problem: How We Work Today

| Task | Current Process | Problem |
|------|---------------|---------|
| **Attendance** | Notebook o Excel | Nawawala, hindi real-time, manual computation |
| **Purchase Orders** | Messenger o text | Walang record, hindi malaman kung approved na, nawawala ang resibo |
| **Budget Tracking** | Excel file | Ilang versions, hindi updated, mali-mali |
| **Payroll** | Manual computation | Tagal, prone to error, walang backup |
| **Site Reports** | Viber group | Nalulunod sa messages, walang archive |
| **Client Billing** | Spreadsheet | Hindi alam kung bayad na, pending pa, o overdue |

**Result:** Delayed payroll, overspent budgets, lost receipts, at paulit-ulit na tanong: *"Magkano na ang budget? Bayad na ba? Nandiyan ba ang cement?"*

---

## Solution: ACPM

**Isang app. Lahat ng project data. Nasa phone. Real-time. Offline-ready.**

### Ano ang Kayang Gawin

| Module | Para Saan |
|--------|-----------|
| **Labor** | Attendance logging, automatic payroll computation, RFP generation |
| **Materials** | Purchase Order submission, approval workflow, delivery tracking, inventory |
| **Billing** | Contract recording, billing requests, collection tracking |
| **Budget** | Real-time budget vs actual, automatic warnings pag malapit nang maubos |
| **Tasks** | Kanban board, assigned tasks, deadlines, progress tracking |
| **Site Log** | Daily activity reports, photo-ready (future) |
| **Compliance** | Permit renewals, expiration alerts |
| **Defects** | Punch list, issue tracking, close/reopen |
| **Reports** | Summary dashboards, CSV export |

---

## Key Benefits

### 1. Real-Time Budget Visibility

Hindi na kailangang magtanong. Tingin lang sa app, alam mo na:
- Magkano ang total budget
- Magkano na ang nagastos
- Magkano ang natitira
- Critical ba (red), warning (yellow), o OK (green)?

### 2. Mobile-First — Works on Any Phone

- Hindi kailangan ng laptop sa site
- Site foreman logs attendance on their phone
- PM checks PO status while traveling
- Works offline, syncs when connected

### 3. Approval Workflow

- PO hindi pwedeng bilhin hangga't hindi approved
- Billing request hindi pwedeng i-send hangga't hindi recorded
- Audit trail: alam kung sino ang gumawa, kailan, at ano

### 4. No More Lost Data

- Lahat nasa cloud (Firebase by Google)
- Weekly backup
- Role-based access: boss sees everything, APM sees only their projects

### 5. Payroll in Minutes, Not Hours

- Mark attendance daily (1 minute)
- Compile weekly payroll (2 minutes)
- Automatic computation: basic pay, OT, night differential, government deductions
- Export to CSV or RFP format

---

## Pilot Results

[Fill this after Week 3 pilot]

| Pilot User | Role | Feedback | Status |
|------------|------|----------|--------|
| [Name] | PM | [Quote] | ✅ Adopted |
| [Name] | APM | [Quote] | ✅ Adopted |

---

## Cost

| Item | Cost |
|------|------|
| Firebase Hosting | Free |
| Firebase Authentication | Free |
| Firebase Database | Free (1GB storage, 10GB download/month) |
| **Total Monthly Cost** | **₱0** |

*Note: Kung lalaki ang company (20+ users, 50+ projects), estimated cost: $5-10/month (~₱300-600). Still negligible compared to lost time and errors.*

---

## Rollout Plan

### Phase 1: Pilot (Month 1)
- 2-3 users
- 1 active project
- Demo data + real testing

### Phase 2: Core Team (Month 2)
- All 6 PMs/APMs
- 3-5 active projects
- Weekly training/check-in

### Phase 3: Full Adoption (Month 3)
- All active projects in system
- Old spreadsheets retired
- Monthly review process

---

## What We Need

| Resource | From Whom | When |
|----------|-----------|------|
| Go-signal to proceed | Management | This week |
| List of active users (names, roles, projects) | Admin / HR | Week 1 |
| 1 hour for training session | All users | Week 2 |
| Feedback weekly for 1 month | All users | Month 1 |

---

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Users resistant to change | Start with pilot users, show benefits, provide cheat sheet |
| Internet issues on site | PWA works offline, syncs when connected |
| Data loss | Weekly backup, Firebase reliability, audit logs |
| Too complex for field workers | Cheat sheet, 10-minute demo, mobile-first design |
| System breaks | Free tier, no lock-in, data can be exported anytime |

---

## Why Now?

1. **The system is built and working.** Not a proposal for future development. It's ready to use today.
2. **Free.** No budget needed. No procurement process.
3. **Low risk.** If it doesn't work, we can stop anytime. Data is exportable.
4. **Competitive advantage.** Other construction companies still use spreadsheets. We can be ahead.

---

## Bottom Line

> *"Hindi na tayo magtatanong kung magkano ang budget, kung bayad na si client, o kung dumating na ang cement. Nandiyan na ang sagot sa app."*

**ACPM = less time asking, more time building.**

---

## Ask

**Management approval to pilot ACPM with 2-3 users for 1 month.**

After pilot, we evaluate. If working, we roll out to the full team. If not, we adjust.

**No cost. Low risk. High potential return.**

---

## Appendix: System Overview

**Technology:** Firebase (Google) — Realtime Database, Authentication, Hosting
**Access:** Web app (PWA) — works on any phone, tablet, or laptop
**Security:** Login required, role-based access, audit logs
**Data ownership:** LeBuild (exportable anytime)
**Support:** [Your name] — admin, trainer, first point of contact

---

*Handa na akong mag-demo. 10 minutes lang. Tingin niyo, try natin.*
