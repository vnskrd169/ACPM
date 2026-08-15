# ACPM Real Firebase QA — Execution Checklist

## Prerequisites

Before starting, obtain:
- `ACPM_QA_EMAIL` — a Firebase Auth email with Boss/Admin role
- `ACPM_QA_PASSWORD` — the corresponding password
- Firebase Console access to `acpm-project-system`
- API Key: `AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA`

## Automated Script Execution

Once credentials are available, run in order:

```bash
# 1. Account Onboarding (creates test user, approves, assigns project)
set ACPM_QA_EMAIL=your@email.com
set ACPM_QA_PASSWORD=yourpassword
set ACPM_BOSS_QA_EMAIL=your@email.com
set ACPM_BOSS_QA_PASSWORD=yourpassword
node scripts/account_onboarding_live_qa.js

# 2. Labor + Cash Advance
node scripts/labor_v1_cash_advance_real_qa.js

# 3. Change Orders
node scripts/changeorder_v1_real_qa.js

# 4. Billing Phase 2
node scripts/billing_phase2_real_qa.js

# 5. Notifications
node scripts/audit_notifications_v1_real_qa.js

# 6. Static QA (no credentials needed)
node scripts/rc1_static_gate.js
node scripts/pwa_cache_static_qa.js
node scripts/rc1_docs_static_qa.js
```

## Manual End-to-End QA (38 Steps)

Create a project named **"ACPM PRODUCTION QA"** and prefix every record with **"PROD QA"**.

### AUTH (Steps 1-4)
| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 1 | Sign up as new user | Access request created with status `pending` | |
| 2 | Approve access request (as Admin) | User status becomes `active` | |
| 3 | Assign role and project | User can access the QA project workspace | |
| 4 | Complete profile (name, position, mobile) | Profile fields saved, `profileComplete` set | |

### LABOR (Steps 5-13)
| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 5 | Create trade (e.g., "PROD QA Carpentry") | Trade visible in trades list | |
| 6 | Create worker ("PROD QA Worker 1") | Worker added to roster with correct trade/rate | |
| 7 | Record attendance (Present, Half, Absent, Leave) | Status dropdown reflects selection | |
| 8 | Create cash advance for worker | Advance created with status `pending_approval` | |
| 9 | Approve cash advance | Status changes to `approved` | |
| 10 | Release cash advance | Status changes to `released` | |
| 11 | Compile payroll | Payroll log created, totals match attendance | |
| 12 | Verify RFP | Compiled week → RFP = verified archived NET payroll; uncompiled → provisional GROSS with warning | |
| 13 | Verify payroll archive | Archived payroll loads with correct totals | |

### MATERIALS (Steps 14-21)
| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 14 | Create supplier ("PROD QA Supplier") | Supplier appears in directory | |
| 15 | Create PO with 2 line items | PO created with `pending` status | |
| 16 | Approve PO | Status changes to `approved` | |
| 17 | Record partial delivery (item 1: 50%) | Delivery recorded, inventory increases | |
| 18 | Record final delivery | All items fully delivered, status `received` | |
| 19 | Verify inventory | Qty on hand matches delivered qty | |
| 20 | Issue material to scope/worker | Stock decreases by exact issued qty | |
| 21 | Verify movement ledger | Entry with type `issue` visible with amounts | |

### BILLING (Steps 22-26)
| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 22 | Save contract value (e.g., ₱500,000) | Contract dashboard shows correct values | |
| 23 | Create billing request (₱100,000) | Billing created with `pending` status | |
| 24 | Approve billing request | Status changes to `approved` | |
| 25 | Record partial collection (₱50,000) | Collection recorded, receivable updates | |
| 26 | Verify totals | Billed = ₱100,000, Collected = ₱50,000, Receivable = ₱50,000 | |

### CHANGE ORDERS (Steps 27-29)
| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 27 | Create CO (+₱10,000 labor, +₱5,000 materials) | CO created with `pending` status | |
| 28 | Approve CO | Status changes to `approved`, budget deltas update | |
| 29 | Verify budget impact | laborBudgetDelta and materialBudgetDelta updated | |

### SITE LOG (Step 30)
| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 30 | Create site log entry with work notes | Log saved, visible in site log list | |

### NOTIFICATIONS (Steps 31-33)
| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 31 | Verify event created after approve action | Notification event exists in Firebase | |
| 32 | Verify recipient targeting | Correct user receives notification | |
| 33 | Verify read/clear behavior | Marking as read persists on refresh | |

### AUDIT LOG (Steps 34)
| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 34 | Verify audit records | Audit log shows all create/approve/archive actions with correct identity | |

### REPORTS & DASHBOARD (Steps 35-38)
| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 35 | Verify Dashboard totals match source | Labor, material, budget values match module views | |
| 36 | Verify Reports totals match source | Report values match individual module values | |
| 37 | Switch projects and refresh | No stale data from previous project | |
| 38 | Logout and login as different user | No data leakage between users | |

## Cleanup

After QA is complete:
- Archive or void QA records where supported
- Do NOT hard-delete financial/historical QA records
- The QA project "ACPM PRODUCTION QA" can be archived

## Reporting

Record all failures in `docs/PILOT_ISSUE_LOG.md` with:
- Severity (1-4)
- Module
- Description
- Steps to reproduce
- Screenshot/video if applicable
