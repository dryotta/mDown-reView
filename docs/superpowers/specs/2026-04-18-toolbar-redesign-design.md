# Toolbar Redesign — Segmented Button Groups

## Problem

The current toolbar uses flat, unstyled text buttons scattered across the bar with a "mDown reView" title on the left. It looks unprofessional and lacks visual grouping of related actions.

## Design

Replace with a **segmented button group** layout (macOS-native style):

### Layout (left → right)

1. **Open group** — bordered segment: `[📄 Open File | 📁 Open Folder]`
2. **Separator** — 1px vertical divider
3. **Panel toggles group** — bordered segment: `[⬚ Folders | 💬 Comments]`
4. **Spacer** — flex: 1 pushes remaining items right
5. **Theme button** — standalone: icon + label (☀ Light / 🌙 Dark / ◑ System)
6. **About button** — standalone: icon + label (ⓘ About)

### Removed

- "mDown reView" app title text from toolbar

### Active Toggle State

Tinted background, not solid fill:
- **Light theme**: `background: rgba(9,105,218,0.08)`, `color: #0969da`
- **Dark theme**: `background: rgba(88,166,255,0.12)`, `color: #58a6ff`

### Button Group Styling

- Grouped buttons share a single `border: 1px solid var(--color-border)` with `border-radius: 6px`
- Adjacent buttons separated by a 1px internal border
- Individual buttons have no border — the group container provides it

### Icons

Inline SVG icons (no external dependencies). Each button gets a 14×14 SVG icon:
- Open File: document icon
- Open Folder: folder icon
- Folders: sidebar/panel icon
- Comments: speech bubble icon
- Theme: sun (light) / moon (dark) / half-circle (system)
- About: info circle icon

### Theme-Aware Variables

New CSS custom properties added to both light and dark themes:
- `--color-toggle-active-bg` — tinted accent background for active toggles
- `--color-toggle-active-bg-hover` — slightly darker on hover
- `--color-btn-group-bg` — button group background (white / dark surface)

### Standalone Utility Buttons

Theme and About buttons are unstyled (no border, transparent background) with muted text color. They highlight on hover.

## Files Changed

- `src/App.tsx` — new JSX structure with segmented groups, SVG icon components, remove app-title
- `src/styles/app.css` — new `.toolbar-btn-group` styles, updated toggle active state, remove `.app-title`
- `e2e/panels.spec.ts` — update selectors if needed for new structure

## Testing

- Existing e2e tests 24.1–24.6 must continue to pass (button titles unchanged)
- Visual verification in both light and dark themes
