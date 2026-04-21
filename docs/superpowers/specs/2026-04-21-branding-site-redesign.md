# Branding & Site Redesign

**Date:** 2026-04-21

## Overview

Improve branding consistency across the site and app, simplify the site layout, and overhaul the Install section with platform-aware tabs.

---

## 1. Branding

### Logo text treatment

Split `mdownreview` visually: `m` and `re` in indigo `#6366f1` with underline, `down` and `view` in white (`#fafafa`), rendered in `JetBrains Mono` (monospace).

HTML pattern:
```html
<span class="logo-m">m</span>down<span class="logo-re">re</span>view
```

CSS:
```css
.logo-m, .logo-re {
  color: #6366f1;
  text-decoration: underline;
  text-decoration-color: #6366f1;
  text-underline-offset: 4px;
}
```

Applied consistently in:
- Site nav `.logo`
- App `WelcomeView` `.welcome-title`
- Tauri window title (plain text — no HTML, just `mdownreview` unchanged)

### App icon

Style: dark `#18181b` rounded-square background, `#6366f1` border, indigo `m` glyph at ~68% of icon size, rounded corners.

Deliverable: one master SVG, then exported/rasterised to all Tauri-required sizes:
- `src-tauri/icons/32x32.png`
- `src-tauri/icons/128x128.png`
- `src-tauri/icons/128x128@2x.png`
- `src-tauri/icons/icon.ico` (multi-size: 16, 24, 32, 48, 256)
- `src-tauri/icons/icon.icns` (macOS)
- Windows Store sizes: `Square30x30Logo.png`, `Square44x44Logo.png`, `Square71x71Logo.png`, `Square89x89Logo.png`, `Square107x107Logo.png`, `Square142x142Logo.png`, `Square150x150Logo.png`, `Square284x284Logo.png`, `Square310x310Logo.png`, `StoreLogo.png`
- Site favicon: `site/favicon.svg` + `site/favicon.ico`

---

## 2. Site — Removed elements

- `<section class="screenshot">` and `site/screenshot.png` reference — removed entirely.
- All "Copilot" mentions replaced:
  - Section subtitle: "using Copilot skills" → "using agent skills"
  - Terminal window titles: "Copilot CLI" → "Agent CLI"
  - Agent Skills section: "Install the Copilot skills" → "Install the agent skills"
  - Updating section: "Copilot skills" → "agent skills"

---

## 3. Site — How It Works

### Layout

Replace the current alternating 2-column grid with a single-column step list.

Each step:
```html
<div class="workflow-step">
  <div class="step-header">
    <span class="step-num">01</span>
    <h3>Title</h3>
  </div>
  <p>Description.</p>
  <!-- app-mock only for step 02 -->
</div>
```

CSS changes:
- `.workflow-step`: `display: flex; flex-direction: column; gap: 6px; padding: 20px 0; border-bottom: 1px solid var(--border);`
- Remove `grid-template-columns`, remove `direction: rtl` alternation
- `.step-num`: same `font-size`, `font-weight`, and `color` as the `h3` title — no circle/badge
- Max-width constrained to `~580px`, centered

### Step content

| Step | Heading | Has mock |
|------|---------|----------|
| 01 | Your AI agent writes code | No |
| 02 | Open in mdownreview | Yes — app mock |
| 03 | Summarize with `/mdownreview:read` | No |
| 04 | Fix with `/mdownreview:review` | No |
| 05 | Clean up with `/mdownreview:cleanup` | No |

Steps 1, 3, 4, 5: heading + one-sentence description only. No terminal mock, no app mock.

### App mock (step 02 only)

GitHub dark palette matching the actual app:
- Background: `#0d1117`, surface: `#161b22`, border: `#30363d`
- 2 files in sidebar: `validate.ts` (badge: 1), `middleware.ts`
- 3 code lines: function declaration, highlighted body line, closing brace
- One comment thread: indigo treatment — `background: rgba(99,102,241,0.18)`, `border: 1px solid rgba(99,102,241,0.5)`, `border-left: 4px solid #818cf8`, subtle glow

---

## 4. Site — Install section

Replace the current download grid + script block with a 3-tab component.

### Tabs

| Tab | Content |
|-----|---------|
| Download | Single download button for detected platform, "Other platforms →" link |
| Script | Shell command for detected OS |
| GitHub Releases | Link to releases page |

### Platform detection (JS)

```js
function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() ?? '';
  if (ua.includes('win')) {
    return ua.includes('arm') || platform.includes('arm') ? 'win-arm64' : 'win-x64';
  }
  if (ua.includes('mac')) return 'mac-arm64'; // only ARM64 build available
  return null; // unknown → show GitHub Releases tab
}
```

On load: detect platform → activate matching tab. If `null`, activate "GitHub Releases" tab.

### Download tab

Shows one button: `↓ Download for [Platform]` linking to the versioned artifact (resolved from GitHub API, same pattern as existing code). Below the button: `Other platforms → GitHub Releases page`.

### Script tab

Windows: PowerShell one-liner. macOS: curl one-liner. Unknown platform: show both with labels.

### GitHub Releases tab

Single prominent link: `View all releases on GitHub →`.

### Tab markup

```html
<div class="install-tabs">
  <div class="tab-bar">
    <button class="tab-btn active" data-tab="download">Download</button>
    <button class="tab-btn" data-tab="script">Script</button>
    <button class="tab-btn" data-tab="releases">GitHub Releases</button>
  </div>
  <div class="tab-panel" id="tab-download">…</div>
  <div class="tab-panel hidden" id="tab-script">…</div>
  <div class="tab-panel hidden" id="tab-releases">…</div>
</div>
```

---

## 5. README

- Logo line: keep plain text `mdownreview` (Markdown has no inline color support)
- How It Works list: update skill references to `/mdownreview:read`, `/mdownreview:review`, `/mdownreview:cleanup`
- Remove any "Copilot" mentions — use "agent skills" / "your AI agent"
- Agent Skills section heading: "Agent Skills" (already correct)

---

## Files changed

| File | Change |
|------|--------|
| `site/index.html` | Logo markup, remove screenshot, How It Works rewrite, Install tabs, remove Copilot |
| `site/style.css` | `.logo-m/.logo-re`, workflow step layout, install tabs styles |
| `src/components/WelcomeView.tsx` | Replace `📂` emoji with inline SVG icon; apply brand spans to title |
| `src/styles/welcome-view.css` | `.logo-m/.logo-re` styles; `.welcome-logo svg` sizing |
| `src-tauri/icons/*` | Replace all icon files |
| `site/favicon.svg` | New — brand icon as SVG |
| `site/favicon.ico` | New — brand icon as ICO for browser tab |
| `site/screenshot.png` | Delete |
| `README.md` | Remove Copilot, update skill names with `/` prefix |
