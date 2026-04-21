# Branding Redesign — Design Spec

**Date:** 2026-04-21  
**Status:** Approved

## Overview

Refresh app icons, favicon, website branding, and landing-page color palette to match a new reference design. The reference shows a clean rounded-square "m" icon with a blue→indigo gradient fill, and implies a more restrained palette with no extraneous green, cyan, or purple accents.

---

## 1. Color Palette

### Gradient (primary brand expression)
| Stop | Color | Usage |
|------|-------|-------|
| Top (0%) | `#7B7FF5` — periwinkle | Icon "m" top, button gradient start |
| Bottom (100%) | `#4B4FD9` — deep indigo | Icon "m" bottom, button gradient end |

Gradient definition in SVG: `linearGradient` in `userSpaceOnUse`, `y1≈8 y2≈70` (matching "m" text bounds in 100×100 viewBox).

CSS shorthand: `linear-gradient(150deg, #7B7FF5, #4B4FD9)`

### Website CSS variable changes (`site/style.css`)
| Variable | Before | After |
|----------|--------|-------|
| `--accent-1` | `#6366f1` | `#5C60EF` (slightly richer) |
| `--accent-2` | `#a855f7` | **removed** |
| `--green` | `#4ade80` | **removed** |
| `--purple` | `#c084fc` | **removed** |
| `--cyan` | `#22d3ee` | **removed** |
| `--accent-dark` | *(new)* | `#4B4FD9` |

### Website usage updates
- **`.gradient-text`**: `linear-gradient(135deg, var(--accent-1), var(--accent-2), var(--cyan))` → `linear-gradient(150deg, #7B7FF5, #4B4FD9)`
- **`.btn-primary` + `.btn-download` gradients**: `linear-gradient(135deg, var(--accent-1), var(--accent-2))` → `linear-gradient(150deg, var(--accent-1), var(--accent-dark))`
- **`.badge .dot`** (pulsing dot): `var(--green)` → `var(--accent-1)`
- **`.copy-btn.copied`**: green tint → accent-1 indigo tint (`rgba(92,96,239,0.06)` bg, `rgba(92,96,239,0.3)` border, `var(--accent-1)` color)
- **Inline `<code>` color** (`.step-header h3 code, .workflow-step > p code`): `var(--purple)` → `var(--accent-1)`
- **Warning colors** (`--warning-bg`, `--warning-border`, `--warning-text`): **unchanged** — semantic meaning preserved

The hardcoded colors inside `.app-mock` (GitHub dark theme syntax colors: `#ff7b72`, `#d2a8ff`, `#a5d6ff`) are left as-is — they represent the actual app's UI, not site branding.

---

## 2. Icon SVG (`src-tauri/icons/icon.svg`)

**Purpose:** Source for rasterized Tauri icons (PNG, ICO, ICNS). Dark background baked in.

**Changes:**
- Add `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="50" y1="8" x2="50" y2="70">` with stops `#7B7FF5` → `#4B4FD9`
- Background rect: keep `fill="#18181b"` (near-black, good for rasterization)
- Border rect stroke: `stroke="#6366f1"` → `stroke="url(#g)"`
- Text "m" fill: `fill="#6366f1"` → `fill="url(#g)"`

**Note:** After updating `icon.svg`, the rasterized PNG/ICO/ICNS files must be regenerated:
```
npx tauri icon src-tauri/icons/icon.svg
```
This is out of scope for this task (rewrites binary files; user should run manually or as part of CI). The SVG source update is in scope.

---

## 3. Favicon SVG (`site/favicon.svg`)

**Purpose:** Website favicon. Supports adaptive dark/light via CSS media query.

**Changes:**
- Same gradient definition as `icon.svg`
- Border stroke and "m" fill → `url(#g)`
- Background rect: replace `fill="#18181b"` with a CSS-class-driven fill:
  ```xml
  <style>
    .bg { fill: #f5f5f8; }
    @media (prefers-color-scheme: dark) { .bg { fill: #1a1b2e; } }
  </style>
  ```
  Background rect gets `class="bg"` instead of hardcoded fill.

---

## 4. Icon Folder Cleanup (`src-tauri/icons/`)

### Keep
| File | Reason |
|------|--------|
| `icon.svg` | Source file |
| `icon.ico` | Windows executable icon (tauri.conf.json) |
| `icon.icns` | macOS app icon (tauri.conf.json) |
| `32x32.png` | Referenced in tauri.conf.json |
| `128x128.png` | Referenced in tauri.conf.json |
| `128x128@2x.png` | Referenced in tauri.conf.json |
| `icon.png` | General fallback used by Tauri internally |

### Delete
| File/Dir | Reason |
|----------|--------|
| `64x64.png` | Not referenced anywhere |
| `StoreLogo.png` | Windows Store — not used |
| `Square30x30Logo.png` | Windows Store MSIX — not used |
| `Square44x44Logo.png` | Windows Store MSIX — not used |
| `Square71x71Logo.png` | Windows Store MSIX — not used |
| `Square89x89Logo.png` | Windows Store MSIX — not used |
| `Square107x107Logo.png` | Windows Store MSIX — not used |
| `Square142x142Logo.png` | Windows Store MSIX — not used |
| `Square150x150Logo.png` | Windows Store MSIX — not used |
| `Square284x284Logo.png` | Windows Store MSIX — not used |
| `Square310x310Logo.png` | Windows Store MSIX — not used |
| `android/` | Android platform — not supported |
| `ios/` | iOS platform — not supported |

---

## Out of Scope

- Regenerating rasterized PNG/ICO/ICNS files (manual step after SVG update)
- Changing the app's internal CSS (`src/styles/`) — those use a separate GitHub-inspired palette appropriate to the markdown viewer UI
- Changing any HTML structure or copy
