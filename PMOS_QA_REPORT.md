# PMOS QA Report

**Date**: 2026-07-19
**Branch**: `feature/pmos-official-app`
**Base commit**: `109e3479d1424e677f2bba1f0216bbaa247707e6`

## Test Environment

- **OS**: Windows (Git Bash)
- **Node.js**: Available
- **Java**: OpenJDK 21 (portable, extracted locally — required for Firebase Emulator)
- **Chrome**: Installed
- **Firebase project**: `acpm-project-system` (production — NOT used for testing)
- **Vitest**: 56 unit tests passing (all PASS)

## Syntax Checks

| File | Result |
|------|--------|
| `pmos.js` | ✅ PASS |
| `pmos-office.js` | ✅ PASS |
| `acpm-shell.js` | ✅ PASS |
| `meeting-notes.js` | ✅ PASS |
| `face-attendance.js` | ✅ PASS |
| `pmos-subscription-manager.js` | ✅ PASS |
| `pmos-pagination.js` | ✅ PASS |
| `pmos-photo-lightbox.js` | ✅ PASS |
| `pmos/pmos-sw.js` | ✅ PASS |

## Unit Test Results (Vitest + jsdom)

| Test Suite | Tests | Result |
|---|---|---|
| `tests/pmos/core.test.ts` | 40 | ✅ PASS |
| `tests/pmos/pagination.test.ts` | 12 | ✅ PASS |
| `tests/pmos/subscription-manager.test.ts` | 13 | ✅ PASS |
| **Total** | **56** | **✅ PASS** |

### Core Test Coverage (40 tests)
- `escapeHtml`, `pmosNormalizeRecord`, `pmosDedupKey`, `pmosSafeFilename`
- Client-generated UUID, schema version defaults, project name resolution
- Draft eligibility, edit eligibility, archive/restore eligibility
- Viewer write denial, status transitions
- Notification event ID, recipient selection, record linking
- Offline queue — enqueue, persistence, retry, conflict handling
- Photo metadata ordering, logout cleanup

### Pagination Test Coverage (12 tests)
- Page sizes (Inbox: 30, Issues: 30, Materials: 25, etc.)
- State management (loading, hasMore, error, records)
- Cursor generation and next-page appending
- Stable newest-first ordering and key tie-breaking
- Duplicate prevention, project/filter reset
- Empty results and final-page detection

### Subscription Manager Test Coverage (13 tests)
- `subscribe()` and `unsubscribe()` API
- Group-based cleanup (`unsubscribeGroup`)
- Full cleanup (`unsubscribeAll`)
- Duplicate key prevention
- View switching cleanup
- Project change cleanup
- Setup failure does not leave ghost entries
- Active count tracking

## Firebase Emulator Rules Tests

**Status**: ⚠️ BLOCKED

Both test suites are written and config is complete:
- `tests/pmos/rules-database.test.ts` — 22 database rule assertions
- `tests/pmos/rules-storage.test.ts` — 10 storage rule assertions

**Blocking issues:**
1. Firebase emulator JARs cannot download from `firebasestorage.googleapis.com` (network/environment restriction)
2. `firebase` peer dependency of `@firebase/rules-unit-testing` needs separate install

**Resolution**: Run in an environment with internet access and execute:
```bash
npm install --save-dev firebase --legacy-peer-deps
export JAVA_HOME=./tmp_jdk/jdk-21.0.1+12
export PATH=$JAVA_HOME/bin:$PATH
npx firebase emulators:exec --config firebase.pmos.test.json --only database,storage "npx vitest run tests/pmos/rules-database.test.ts tests/pmos/rules-storage.test.ts"
```

## Playwright E2E Tests

**Status**: ⚠️ BLOCKED

17 test cases are configured and discovered via `npx playwright test --list`:
- Field User (8 tests): app shell, all PMOS modules, offline queue
- Reviewer (4 tests): Office views, Issue Board, Meeting Notes
- Viewer (1 test): limited access
- Boss (1 test): full access
- PWA/Offline (2 tests): offline shell
- Logout (1 test): state cleanup

**Blocking issues:**
1. Requires Firebase Emulator running with test data
2. Requires local web server (`serve` configured in playwright.config.ts)

**Resolution**: Run in an environment with emulator access:
```bash
npm run test:e2e
```

## Git Diff Check

| Check | Result |
|-------|--------|
| `git diff --check 109e347...HEAD` | ✅ PASS (no whitespace errors after cleanup) |

## Dead Code Review Results

The following items were reviewed and cleaned across all PMOS files:
- ✅ Unused variables — reviewed and scoped correctly
- ✅ Unused functions — all exported functions are referenced
- ✅ Stale TODO comments — remaining TODOs are for future enhancements, not blocking features
- ✅ Duplicate event handlers — single event delegation pattern used
- ✅ `_pmosToastTimer` — confirmed correctly scoped
- ✅ Test-only globals — no test code leaks into production files
- ✅ Unused feature flags — `faceAttendanceEnabled` is the only flag, properly consumed
- ✅ Duplicate CSS — no duplicate rules across style.css, acpm-brand.css, pmos-app.css

## Known Issues

1. Firebase Emulator binary download blocked by network — rules tests and E2E tests require external environment
2. Playwright tests require both emulator + web server
3. Paginated views blend real-time subscriptions (first page) with bounded queries (Load More) — acceptable for field use but not a pure cursor pattern

## Release Recommendation

**READY FOR UAT** — Phase 10 (Drive-only photo upload) complete. All planned implementation items are finished. Remaining items are owner actions:
1. Owner UAT in controlled environment
2. Preview/staging deployment approval
3. Firebase Emulator rules tests (requires internet for JAR download)
4. Playwright E2E tests (requires emulator + server)
5. Production deployment approval
