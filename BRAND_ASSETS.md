# ACPM Brand Assets

> **Quick reference**: See `assets/brand/README.md` for detailed documentation.

## File Overview

| Asset | Location | Usage |
|---|---|---|
| ACPM Logo Mark | `assets/brand/acpm/logo-mark.svg` | App icon, loading screen |
| ACPM Horizontal | `assets/brand/acpm/logo-horizontal.svg` | Login screen, headers |
| ACPM Stacked | `assets/brand/acpm/logo-stacked.svg` | Vertical layouts, small cards |
| ACPM Monochrome | `assets/brand/acpm/logo-monochrome.svg` | Print, watermarks |
| ACPM Favicon | `assets/brand/acpm/favicon.svg` | Browser tab icon |
| PMOS Logo Horizontal | `assets/brand/pmos/pmos-logo-horizontal.svg` | PMOS app shell |
| PMOS Logo Stacked | `assets/brand/pmos/pmos-logo-stacked.svg` | PMOS vertical layouts |
| PMOS Icon | `assets/brand/pmos/pmos-icon.svg` | PWA icon, badges |
| Brand Tokens CSS | `assets/brand/acpm-brand.css` | Design system variables |

## Brand Tokens

See `assets/brand/acpm-brand.css` for the full ACPM design token set including colors, spacing, typography, shadows, and animation durations.

## Design Principles

- **Premium**: Clean, minimal, architectural aesthetic
- **Modern**: Dark theme with vibrant accent colors
- **Practical**: High contrast, readable on construction sites
- **Consistent**: All ACPM modules share the same visual language

## PWA Icons

The manifest files (`manifest.json`, `pmos-manifest.json`) reference inline SVG icons. When replacing icons:
1. Update the master SVG files in `assets/brand/acpm/` and `assets/brand/pmos/`
2. Update the inline data URIs in both manifest files
3. Update the favicon reference in `pmos.html`
4. Update the loading screen inline SVG in `pmos.html`

## Replacing Logos

When replacing the temporary ACPM/PMOS logo:
1. Replace SVG files in `assets/brand/acpm/` and `assets/brand/pmos/`
2. Update `assets/brand/acpm-brand.css` colors if brand colors change
3. Update `assets/brand/README.md`
4. Regenerate PWA icons
5. Update `manifest.json` and `pmos-manifest.json`
