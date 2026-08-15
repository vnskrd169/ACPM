# UI Regression Checklist

Reusable checks for ACPM + PMOS layout, PWA, and interaction regressions.
Run these before any production release and after any CSS/HTML/JS change.

## Automated gates (always run)

```bash
node scripts/ui_layout_static_qa.js     # static layout + PWA version hygiene (no browser)
node scripts/ui_workflow_static_qa.js   # workflow wiring (tabs, buttons -> handlers)
node scripts/pmos_release_static_qa.js  # PMOS release wiring
node scripts/rc1_static_gate.js         # RC1 static gate
npx vitest run                          # unit tests
node scripts/ui_layout_local_audit.js   # FULL local browser audit — mocked Firebase, stress data, NO credentials
node scripts/ui_layout_live_audit.js    # live browser audit (needs QA login; see RESPONSIVE_QA.md)
```

### Local audit harness (no credentials, runs offline)

`scripts/ui_layout_local_audit.js` is the primary regression gate. It boots a
static server, seeds a stress dataset through a mocked Firebase (30 workers,
20 projects, full attendance week, 6 POs with partial deliveries, 25 material
rows, 20 tasks, billings, site logs, change orders), then probes every viewport
of the matrix for:

- page scroll traps (`scrollHeight > innerHeight` when content is long);
- horizontal overflow (offenders listed; intentional scroll wrappers tolerated);
- reachable primary actions (Compile Payroll, RFP, roster, Submit PO, project
  Open) — includes retry when async re-renders detach the node mid-measure;
- modal viewport fit + reachable footer actions + **Escape closes the modal
  without exiting the workspace**;
- payroll compile dialog, RFP modal, cash advance modal, delivery modal;
- PO builder with 30 draft line items (overflow + Submit PO reachability);
- tab switching across all workspace panels;
- duplicated DOM ids;
- PMOS shell: bottom nav visible, all nav views (home/updates/tasks/more) +
  create sheet at every viewport, console-error capture;
- console errors / pageerrors captured for the whole session.

Expected: **464/464 PASS** (8 viewports × workspace + hub + PMOS). Exit code 0.

## 1. Page horizontal overflow

- `document.documentElement.scrollWidth <= window.innerWidth` on every major tab
  at every viewport (see RESPONSIVE_QA.md matrix).
- Any element with `right > innerWidth + 2` must be inside an intentional
  horizontal scroll wrapper (`.table-wrap`, `.overflow-scroll`, `.grid-scroll`,
  `.tab-scroll`, `.payroll-review-scroll`).
- `width: 100vw` is banned unless wrapped in `min()`.
- Images/videos must never widen a card (`img, video { max-width: 100% }`).

## 2. Modal viewport overflow

- Every modal is `.modal-overlay > .modal-box`.
- `.modal-box` must keep `max-height: 90dvh/88vh` + `overflow-y: auto` +
  `overscroll-behavior: contain`.
- Open the tallest dialogs (payroll confirm, RFP, delivery, invoice, advance
  history, worker edit, project assign) at 1366×768 and 375×667:
  - the box fits the viewport;
  - the footer actions (Approve / Save / Close / Copy / Download) are
    reachable by scrolling inside the modal;
  - Escape closes; scroll does not bleed into the page behind.

## 3. Action accessibility

For every workflow ask: *can the user always reach the next action?*
- Save / Submit / Approve / Reject / Receive / Issue / Compile Payroll /
  Generate RFP / Export / Close must be visible or scroll-to-reachable at
  1366×768 and 375×667.
- No primary action may sit inside a height-capped container with
  `overflow: hidden` and no internal scroll.
- Sticky headers must not cover row content or block the last row.

## 4. Missing scroll path

- The page must own vertical scrolling: `document.documentElement.scrollHeight
  > innerHeight` whenever content exceeds the viewport.
- Panels (`#xxxPanel`) must never be height-capped without an internal scroll
  strategy.
- Tab bars (`#tabs`, `.hub-tab-row`) must scroll horizontally when the tab set
  is wider than the viewport.

## 5. Duplicated IDs

- No `id` may repeat within a page (breaks `$('#id')`, label `for`, listeners).

## 6. Runtime console errors

- Zero `console.error` / `pageerror` during a full session (login -> every tab
  -> open modals -> export -> logout).
- Zero failed asset requests caused by the app (service worker, css/js, fonts).
- One malformed record must not crash a whole dashboard render (defensive
  rendering: `(record || {})`, `?.`, array guards in render loops).

## 7. Asset versions / PWA cache

- `sw.js` `CACHE_NAME` must be bumped on every UI release (e.g. `acpm-v136`).
- `pmos-sw.js` + `pmos/pmos-sw.js` `PMOS_CACHE` bumped together (`pmos-cache-v6`).
- HTML asset params match the release (`style.css?v=110`, `main.js?v=108`,
  `labor.js?v=98`, `materials.js?v=96`, pmos `../style.css?v=110`,
  `../main.js?v=108`).
- Old caches are purged automatically on SW activate (already implemented) —
  verify with a hard refresh, normal refresh, PWA reopen, and logout/login.

## 8. Responsive breakpoints

Covered in `RESPONSIVE_QA.md`. Minimum supported matrix:

| Class      | Widths                      |
| ---------- | --------------------------- |
| Desktop    | 1920, 1440, 1366, 1280      |
| Tablet     | 1024, 768 (portrait)        |
| Mobile     | 390, 375                    |

## Sign-off

- [ ] `ui_layout_static_qa` PASS
- [ ] No horizontal overflow at any matrix viewport
- [ ] All dialogs fit + scroll internally
- [ ] No unreachable primary actions
- [ ] No console errors
- [ ] PWA cache + asset versions bumped and verified served
