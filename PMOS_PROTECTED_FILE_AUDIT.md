# PMOS Protected ACPM Core File Audit

## Audit Date
2026-07-17

## Branch
`feature/pmos-official-app`

## Base Commit
`109e3479d1424e677f2bba1f0216bbaa247707e6`

## Protected File Analysis

| File | Changed Since 109e347 | PMOS Required | Unrelated ACPM Change | Deployed | Required Action |
|------|----------------------|---------------|----------------------|----------|-----------------|
| `main.js` | No | N/A | N/A | No | None — unchanged |
| `auth.js` | No | N/A | N/A | No | None — unchanged |
| `dashboard.html` | No | N/A | N/A | No | None — unchanged |
| `style.css` | **Yes** (~940 lines appended) | **Yes** — PMOS v2.0 app shell styles | **No** — purely additive PMOS section at end of file | **No** | Extract PMOS styles to separate CSS file; restore original style.css |
| `sw.js` | **Yes** (cache rename, PMOS_CACHE, message listener) | **Yes** — PMOS needs separate cache scope | **No** — all changes are PMOS-specific | **No** | Revert sw.js to original; create `patches/pmos-sw-proposed.patch` with PMOS-specific changes; create `pmos-sw.js` for standalone PMOS worker |
| `database.rules.json` | **Yes** (clientGeneratedId indexes) | **Yes** — offline dedup requires indexes | **No** — all changes are PMOS-specific | **No** | Revert database.rules.json to original; `database.rules.pmos-proposed.json` already exists as proposed patch |
| `storage.rules` | No | N/A | N/A | No | Proposed file exists at `storage.rules.pmos-proposed` |
| `manifest.json` | **Yes** (rebranding, icons, theme) | **Yes** — PMOS needs separate manifest | **No** — all changes are PMOS-specific | **No** | Revert manifest.json to original; `pmos-manifest.json` already exists as PMOS-specific manifest |
| `face-attendance.js` | **Yes** (feature flag gate) | **Yes** — feature gating needed | **No** — all changes are PMOS-specific | **No** | Revert face-attendance.js to original; move feature flag logic to `acpm-shell.js` config |
| `face-attendance.js` | **Yes** | **Yes** | No | No | See above |
| `notifications.js` | No | N/A | N/A | No | None — unchanged |
| `report.js` | No | N/A | N/A | No | None — unchanged |
| `labor.js` | No | N/A | N/A | No | None — unchanged |
| `materials.js` | No | N/A | N/A | No | None — unchanged |
| `billing.js` | No | N/A | N/A | No | None — unchanged |
| `changeorders.js` | No | N/A | N/A | No | None — unchanged |
| `sitelog.js` | No | N/A | N/A | No | None — unchanged |
| `suppliers.js` | No | N/A | N/A | No | None — unchanged |
| `equipment.js` | No | N/A | N/A | No | None — unchanged |
| `compliance.js` | No | N/A | N/A | No | None — unchanged |
| `defects.js` | No | N/A | N/A | No | None — unchanged |
| `tasks.js` | No | N/A | N/A | No | None — unchanged |
| `utils.js` | No | N/A | N/A | No | None — unchanged |

## Protected File Details

### 1. `sw.js` — Modified
- **Change**: Cache name renamed from `acpm-v...` to `acpm-pmos-v1`; added `PMOS_CACHE` constant; added message event listener for `skipWaiting`; updated fetch handler for PMOS asset routing; added PMOS assets to ASSETS array
- **PMOS Required**: Yes — PMOS needs independent cache versioning and update flow
- **Restore Action**: Revert to committed version
- **Extraction**: Create `patches/pmos-sw-proposed.patch` with exact changes; alternatively create `pmos-sw.js` as standalone PMOS worker

### 2. `database.rules.json` — Modified
- **Change**: Added `clientGeneratedId` to `.indexOn` for `pmosUpdates`, `pmosSiteLogs`, `pmosIssues`, `pmosMaterialRequests`, `pmosTasks`, `pmosMeetingNotes`, `pmosPhotoLogs`, and attendance paths
- **PMOS Required**: Yes — offline dedup queries depend on these indexes
- **Restore Action**: Revert to committed version
- **Extraction**: `database.rules.pmos-proposed.json` already exists — verified as complete

### 3. `style.css` — Modified
- **Change**: ~940 lines of PMOS v2.0 styles appended at end of file (line 8454+)
- **PMOS Required**: Yes — styles for loading screen, offline banner, update/install prompts, bottom nav, home screen, toast, action sheets, etc.
- **Restore Action**: Extract PMOS styles to `assets/brand/pmos-app.css`; restore original `style.css`
- **Note**: All changes are additive, no existing ACPM styles were modified

### 4. `manifest.json` — Modified
- **Change**: Rebranded name/short_name/description; new icons with SVG references; updated theme_color; added scope, categories, lang
- **PMOS Required**: Yes — PMOS needs its own manifest for PWA installability
- **Restore Action**: Revert to committed version
- **Extraction**: `pmos-manifest.json` already exists as PMOS-specific manifest

### 5. `face-attendance.js` — Modified
- **Change**: Feature flag gate at top of IIFE checking `PMOS_CONFIG.faceAttendanceEnabled`
- **PMOS Required**: Yes — PMOS needs to control whether face attendance initializes
- **Restore Action**: Revert to committed version
- **Extraction**: Feature flag logic should move to `acpm-shell.js` where `PMOS_CONFIG` is defined; `face-attendance.js` should load but the gating should happen at the config level

## Summary of Required Actions

| File | Restore Action | Extraction Method |
|------|---------------|-------------------|
| `sw.js` | `git checkout -- sw.js` | Create `patches/pmos-sw-proposed.patch` |
| `database.rules.json` | `git checkout -- database.rules.json` | Already exists: `database.rules.pmos-proposed.json` |
| `style.css` | Extract PMOS styles to separate file first, then `git checkout -- style.css` | Create `assets/brand/pmos-app.css` |
| `manifest.json` | `git checkout -- manifest.json` | Already exists: `pmos-manifest.json` |
| `face-attendance.js` | `git checkout -- face-attendance.js` | Feature flag stays in `acpm-shell.js` config |
