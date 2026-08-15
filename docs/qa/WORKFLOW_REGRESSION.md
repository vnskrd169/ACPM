# Workflow Regression

End-to-end scenarios that must pass before declaring the system ready for
office use. Each scenario lists pass criteria around hidden actions, broken
scroll, stale data, duplicate writes, success state, and history.

> Automated layout/scroll/action-reachability coverage for all of these
> scenarios runs in `node scripts/ui_layout_local_audit.js` (no credentials,
> mocked Firebase + stress data). The scenario steps below remain the manual
> acceptance walkthrough for real data.

## 1. WORKFORCE: worker -> attendance -> cash advance -> payroll -> RFP

1. Add a trade; add 3 workers (long names + normal names) with daily rates.
2. Mark attendance for a full week (present / half / OT / holiday mix).
3. Request a cash advance; approve + release it (boss).
4. Compile payroll; confirm the week is archived with correct gross,
   deductions (CA + gov if enabled), and NET.
5. Generate the RFP (archive) — verify NET total, trade grouping, foreman,
   payment method; Copy Text + Download PDF.
6. Payroll Review table shows correct per-worker rows.

Pass criteria: every roster/trade control reachable at 1366×768 and 375×667;
timecard grid scrolls horizontally without clipping the OT inputs; archived
payroll amounts survive refresh/logout/login; RFP modal fits and its actions
are reachable; no duplicate payroll log for the same week; **Escape closes
any open dialog without exiting the workspace** (regression-guarded in the
local audit).

## 2. PROCUREMENT: request -> quotation -> approval -> PO -> delivery -> receive

> Full expanded procurement (material request, quotation comparison, PR,
> payment request) is the **next workstream** — see the hardening report.
> The flow below is the currently-shipped PO pipeline.

1. Create a PO with multiple line items; edit/remove an item in the draft.
2. Submit for approval; PM/boss approves.
3. Record a **partial** delivery (e.g. 60 of 100); verify PO shows
   PARTIALLY DELIVERED, correct received/remaining per line.
4. Record the remaining delivery; verify FULLY DELIVERED and that delivery
   history keeps BOTH records (no overwrite).
5. Approve the supplier invoice (3-way match); verify matched/mismatch state.
6. Generate PO RFP and Invoice RFP; verify totals and copy/PDF.

Pass criteria: draft items editable/removable without recreating the PO;
partial deliveries never overwrite history; receiving more than ordered is
blocked; budget `materialSpent` reflects received cost only; PO/invoice RFP
totals match the ledger; no duplicate movements; refresh keeps totals.

## 3. TASK: create -> start -> progress -> verification -> completed

1. Create a task with assignee + due date; start work; add progress update.
2. Submit for verification (APM cannot self-complete).
3. PM verifies and completes.

Pass criteria: status transitions follow role rules; task cards remain
reachable when many tasks exist; no duplicate task writes on double-click;
history shows each transition.

## 4. PMOS: project -> task -> photo/update -> sync -> ACPM

1. From PMOS mobile: create/update a task, attach a photo, log a site update.
2. Open the same project in ACPM office.

Pass criteria: the record appears immediately (one source of truth — no PMOS
copy); photo renders; activity/notification records exist; offline queue
flushes on reconnect without duplicating records.

## 5. BILLING: progress -> billing -> approval -> collection

1. Save a contract (client, amount, downpayment %, retention %).
2. Create a progress billing; approve it.
3. Record a collection (partial) and allocate; verify receivable balance and
   status (partially_collected -> collected).
4. Generate the client-billing RFP and a billing output snapshot.

Pass criteria: rollup totals match the sum of records after refresh; retention
math correct; RFP shows GROSS / deductions / retention / NET / receivable;
outputs archive without altering billing amounts; no double allocation.

## Cross-cutting pass criteria (all scenarios)

- No hidden action; no broken scroll; no stale data after refresh.
- No duplicate writes (double-click safety).
- Correct success state + correct history/activity trail.
- Financial values identical after refresh, logout/login, and browser resize.
- Zero console errors; one malformed record never breaks a whole render.
