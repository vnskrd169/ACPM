# ACPM Changelog

## v0.9.0-rc2 (Production Hardening) — 2026-07-25

### Production Hardening
- Fixed auth.js syntax error: `doLogin()` marked `async` with `finally` block for button state restoration
- Added `handleAuthFormSubmit()` for correct Enter-to-submit behavior in login/request-access contexts
- Wrapped login form in `<form>` element, added `aria-label` to all auth inputs
- Updated `.gitignore` with service-account and env file exclusion patterns
- Removed `nul` reserved filename from worktree

### Accessibility
- Added ~30 `aria-label` attributes to static form inputs in `index.html`
- Added `aria-label` to textareas across site log, equipment, and compliance panels
- Replaced deprecated `apple-mobile-web-app-capable` meta with `mobile-web-app-capable` on 4 HTML files

### Quality
- Fixed trailing whitespace in `style.css` and `CURRENT_TASK.md`
- All QA scripts pass: rc1_static_gate, pwa_cache_static_qa, rc1_docs_static_qa
- Browser smoke test: PASS — login renders, Ctrl+K works, responsive layouts, no JS runtime errors

### Documentation
- Created `docs/PRODUCTION_RUNBOOK.md` — deployment, rollback, emergency procedures
- Created `docs/PILOT_PLAN.md` — controlled office pilot scope, criteria, training
- Updated `CURRENT_TASK.md` with full Production Hardening status

### PWA
- Bumped cache to `acpm-v126`
- Added `ux-palette.js?v=1` to service worker cache list
- Version consistency across `index.html`, `dashboard.html`, `workspace.html`, `login.html`

## v0.9.0-rc1 — 2026-07

- Initial RC1 deployment with core engineering, UI design system, UX optimization
- Focused live QA for onboarding, notifications, Team Admin
- PMOS field shell with Google Drive photo upload configuration
- PWA cache: `acpm-v125`
