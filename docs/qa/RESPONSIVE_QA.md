# Responsive QA

How to verify ACPM/PMOS layouts across the supported device matrix, including
the live browser audit used during production hardening.

## Local audit (automated, no credentials — primary gate)

```bash
node scripts/ui_layout_local_audit.js
```

Boots a static server, seeds a stress dataset via a mocked Firebase (same
technique as `tests/e2e/helpers.ts`), and runs the full workspace + hub +
PMOS probe at every matrix viewport. No Firebase credentials or QA accounts
needed — run it on any machine with Playwright installed.

What it does per viewport (1920×1080, 1440×900, 1366×768, 1280×720,
1024×768, 768×1024, 390×844, 375×667):

- page can scroll vertically (no scroll trap);
- no horizontal overflow (offenders are listed when found);
- Labor actions present and reachable (Compile Payroll, RFP, roster add,
  week Apply);
- window hard-scroll works (page really owns vertical scrolling);
- modal fit + reachable footer actions for worker edit, cash advance,
  payroll compile, and RFP dialogs;
- Escape closes the modal without exiting the workspace (regression guard);
- Materials: 30 draft line items render with no overflow and Submit PO
  remains reachable; delivery modal fits;
- all workspace tabs switch without overflow;
- PMOS: bottom nav visible, every nav view (home/updates/tasks/more) and the
  create sheet clean at every viewport;
- console errors / pageerrors captured for the whole session;
- duplicated DOM ids before and after modal open/Escape cycles;
- critical local assets actually loaded (a failed `style.css`/JS would
  otherwise be 404-noise-filtered and an unstyled page would pass the
  overflow checks);
- PMOS: critical shell assets loaded.

Expected result: **464/464 PASS**.

> **Coverage note:** action-reachability in the harness targets the mission's
> highest-risk primary actions (Compile Payroll, RFP, roster add, week Apply,
> Submit PO, project Open). Approve/Reject/Receive/Issue/Verify/Save inside
> billing, change-order, task, and supplier workflows are covered by the
> per-tab overflow checks plus the manual scenario walkthroughs in
> `WORKFLOW_REGRESSION.md`; extend the harness's action matrix if those
> become frequent failure points.

## Live audit (production/staging, needs QA login)

```bash
node scripts/ui_layout_live_audit.js          # Production (boss QA login)
AUDIT_URL=https://acpm-project-system-qa.web.app node scripts/ui_layout_live_audit.js   # Staging
```

Best-effort live probe of the same matrix (scroll, overflow, Labor actions,
Materials overflow, RFP modal fit, console errors).

## Viewport matrix

| #  | Viewport   | Usage                 | Key checks                                                                  |
| -- | ---------- | --------------------- | --------------------------------------------------------------------------- |
| 1  | 1920×1080  | Large desktop         | wide tables readable, no over-stretching                                    |
| 2  | 1440×900   | Common desktop        | dense tables, sticky headers usable                                         |
| 3  | 1366×768   | Standard laptop       | **everything must be fully usable** (primary target for office laptops)     |
| 4  | 1280×720   | Small laptop          | tab bars scroll, no clipped actions                                         |
| 5  | 1024×768   | Tablet landscape      | two-col layouts collapse cleanly                                            |
| 6  | 768×1024   | Tablet portrait       | panels stack to one column, tables scroll horizontally                      |
| 7  | 390×844    | iPhone 12/13/14       | hub tabs scroll, dialogs fit, bottom nav doesn't cover content              |
| 8  | 375×667    | iPhone SE             | smallest target: no horizontal overflow, all primary actions reachable      |

## Per-viewport checklist

- Page scroll: `scrollHeight > innerHeight` when content is long.
- Horizontal overflow: `scrollWidth <= innerWidth`; anything wider must be
  inside a horizontal scroll wrapper.
- Modal fit: tallest dialogs fit and scroll internally; footer actions
  reachable.
- Sticky controls: sticky headers/topbars don't cover content or the last row.
- Dropdown positioning: selects/pickers open on-screen.
- Buttons/inputs: ≥ 38px hit target on mobile; not overlapped.
- Tables: horizontally scrollable, sticky header readable, no body clipping.
- Tabs: tab bar scrolls horizontally when overflowing.
- Navigation: hub tabs, workspace tabs, and PMOS bottom nav all reachable.
- Toast position: toasts visible, not under fixed elements.
- Command palette: opens, scrolls, closes; focus contained.
- Keyboard focus: visible focus ring, Escape closes dialogs.
- Bottom navigation (PMOS): doesn't overlap content; padding accounts for it.

## Known-good baselines (2026-08-10 hardening pass)

- Local audit (`ui_layout_local_audit.js`) after the v136 UI release:
  **464/464 PASS** across the full matrix — workspace (42 checks), hub (8),
  PMOS (8) per viewport.
- Root causes fixed in this pass:
  - **Payroll no-scroll**: fixed height + `overflow: hidden`-style traps in
    panels were replaced by document-flow scrolling; the page owns vertical
    scrolling everywhere (verified by hard-scroll probe).
  - **Escape bug**: Escape on an open modal removed it from the DOM *and*
    exited the workspace to the Hub — now it closes only the modal.
  - **Billing grid overflow**: `#billingPanel .billing-form-grid` used fixed
    `minmax` tracks (≈860px+) that overflowed at 768px — clamped to
    `repeat(auto-fill, minmax(min(100%, 190px), 1fr))`.
  - **Summary tables** outside admin/reports now get the overflow wrapper
    (`overflow-x: auto`) instead of clipping body columns.
  - **Hub activity feed** long project names clipped without ellipsis —
    `min-width: 0` on the flex copy so text ellipsizes.
- `ui_layout_static_qa` PASS (19 checks).
- The payroll area scrolls as normal document flow (page owns vertical
  scrolling; no height-capped panel traps).
