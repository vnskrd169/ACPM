# ACPM Brand Assets

This directory contains the official ACPM and PMOS brand identity assets.

## Quick Reference

| Asset | File | Usage |
|---|---|---|
| ACPM Logo Mark | `acpm/logo-mark.svg` | App icon, favicon, loading screen, Settings/About |
| ACPM Horizontal | `acpm/logo-horizontal.svg` | Login screen, headers, print materials |
| ACPM Monochrome | `acpm/logo-monochrome.svg` | Single-color prints, watermarks, small-scale use |
| ACPM Favicon | `acpm/favicon.svg` | Browser tab icon (use as is or convert to .ico) |
| PMOS Logo Horizontal | `pmos/pmos-logo-horizontal.svg` | PMOS app shell, loading screen, headers |
| PMOS Icon | `pmos/pmos-icon.svg` | PWA icon, navigation, app badge |
| Brand Tokens | `acpm-brand.css` | CSS custom properties for colors, spacing, typography |

## Logo Usage

### ACPM Logo Mark
- **Primary logo mark** for the ACPM application.
- Always use the full-color version on dark backgrounds.
- Use the monochrome version for print, watermarks, or single-color applications.
- **Clear space**: Minimum 8px on all sides. Avoid crowding.
- **Minimum size**: Do not render below 32px for the mark, 120px for the horizontal version.

### PMOS Logo
- **Sub-brand** of ACPM. Always use with the ACPM mark in the app shell header.
- The PMOS icon may be used alone in the bottom navigation badge.
- **Clear space**: Minimum 8px on all sides.

## Color Palette

| Token | Value | Usage |
|---|---|---|
| `--acpm-brand-primary` | `#7c3aed` | Primary ACPM accent, active states |
| `--acpm-pmos-primary` | `#0f766e` | PMOS brand accent |
| `--acpm-accent-blue` | `#3b82f6` | Secondary accent, links |
| `--acpm-accent-cyan` | `#06b6d4` | Tertiary accent, info |
| `--acpm-surface` | `#111318` | Main background |

See `acpm-brand.css` for the complete token set.

## PWA Icons

When the master SVG is updated, regenerate these raster icons:

1. **favicon.ico** — Convert `favicon.svg` to 32×32 ICO format.
2. **apple-touch-icon.png** — 180×180 PNG, transparent background.
3. **icon-192.png** — 192×192 PNG from `logo-mark.svg`.
4. **icon-512.png** — 512×512 PNG from `logo-mark.svg`.
5. **icon-maskable-192.png** — 192×192 with safe zone padding (use monochrome on brand bg).
6. **icon-maskable-512.png** — 512×512 with safe zone padding.
7. **social-preview.png** — 1200×630 OG image.

### Maskable Icon Requirements
- The icon content must fit within the inner 80% safe zone.
- The outer 20% is reserved for Android's adaptive icon mask.
- Use the monochrome mark on a brand-colored circle.

## Replacing the Temporary Logo

When replacing the logo with a final design:

1. Replace the SVG files in `acpm/` and `pmos/`.
2. Update all PNG icons from the new master SVG.
3. Update `manifest.json` icon references.
4. Verify the favicon renders in all target browsers.
5. Update `BRAND_ASSETS.md` if the file structure changes.

## Source Files

The `source/` directory contains editable source variants for each logo.
Regenerate production SVGs from source files when making brand changes.
