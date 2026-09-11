# Materials groups and workspace refresh

Implemented on `codex/materials-groups-ux`, based on the current Firebase-hosted frontend (`origin/feature/ai-command-center-v2`). Before deployment, the baseline workspace, dashboard, main, auth, stylesheet and service worker matched the live files.

## Behavior

- Orders, New order and Ledger views preserve the existing PO, invoice and export actions. Stock control is collapsed by default. APM delivery overview stays available within Orders.
- Shared project groups live at `projects/{pid}/materialGroups/{groupId}`. Each group stores its name, material descriptions, specifications, units, usual quantities and update attribution. Groups can be created directly, from a draft or from a previous order, and edited later.
- Adding groups stacks matching draft materials. Draft quantities, prices, names, units and specifications are editable. A group never submits a PO.
- Hardware price recall uses this project's noncancelled PO history, matching supplier ID, description, specification and unit. Group definitions never store prices. Changing hardware preserves manually entered draft prices until the user chooses Use hardware prices.
- Receive all remaining fills the receipt form. Users review and confirm the batch. Partial receipts can separate damaged quantities from accepted quantities. The existing approval checks remain in place.
- Receipt writes update linked ledger quantities/status in the same multi-location update as stock and PO quantities; paid and cancelled ledger statuses are preserved. Ledger display also derives receipt progress from linked POs for existing records.
- New deliveries receive sequential `DR-###` numbers. Older deliveries display their PO and chronological batch number without rewriting history. People use names from the existing authorized directory or an explicit unavailable-name fallback.
- Older fractional-size stock paths are read as nested leaves. New stock keys encode unsafe characters and include units. Receiving reuses matching historical inventory rather than duplicating it.
- Materials dates default to the device's local date. Service worker release: `acpm-v152`; Materials module version: 98.

## Verification

- `node scripts/materials_workspace_qa.cjs`: 19 assertions covering navigation, saved groups, stacking, supplier/size/unit price separation, legacy stock, names, batch references, partial/replacement receipts, over-receiving, duplicate receipt lines, damaged quantities and read-only group access. Uses JSDOM and an isolated in-memory Firebase fixture, not production writes.
- `node scripts/pwa_cache_static_qa.js`: pass.
- `node scripts/environment_static_qa.js`: pass.
- `node scripts/rc1_static_gate.js`: pass.
- Browser inspection of the local preview at desktop and mobile widths; group selection, price-filled draft and direct group creation verified. No page horizontal overflow observed at 390px.
- Staging hosting deployment completed; served workspace, dashboard, Materials modules/styles and service worker matched the tested files.

The local preview is generated with `python scripts/build_materials_preview.py`. Serve the project root, then open `/dev/materials-preview.html`. Its sample data and all dev/test/backend sources are excluded from Firebase Hosting.

No database rules or historical production quantities are migrated by this release. Groups and price recall are project-scoped. The existing cross-client stock-update concurrency model is unchanged; the new submission guards prevent repeated clicks in one page, not simultaneous updates from separate clients.
