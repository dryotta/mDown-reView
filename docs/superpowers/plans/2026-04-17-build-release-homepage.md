# Build, Release & Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MIT license, polished README, GitHub Pages homepage, and an automated GitHub Actions release pipeline that publishes Windows + macOS installers on tag push.

**Architecture:** Five sequential deliverables: (1) MIT LICENSE, (2) package metadata updates, (3) README replacing boilerplate, (4) static `docs/` homepage served by GitHub Pages, (5) `release.yml` workflow with create-release → parallel matrix build → publish-release job chain triggered by `v*.*.*` tags. Each task is independent and commits clean.

**Tech Stack:** GitHub Actions, `gh` CLI (pre-installed on all runners), `dtolnay/rust-toolchain`, `actions/cache@v4`, Tauri 2 (`npm run tauri:build`), plain HTML/CSS

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `LICENSE` | Create | MIT license text |
| `package.json` | Modify | Add `description` field |
| `src-tauri/Cargo.toml` | Modify | Add `license` and `authors` fields |
| `README.md` | Replace | Developer-focused project README with badges |
| `docs/index.html` | Create | GitHub Pages landing page (HTML only, no JS) |
| `docs/style.css` | Create | Dark developer theme for landing page |
| `.github/workflows/release.yml` | Create | Tag-triggered release pipeline |

---

## Task 1: Add MIT LICENSE

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create LICENSE**

Create `LICENSE` in the repo root with this exact content:

```
MIT License

Copyright (c) 2026 davidzh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

## Task 2: Update package metadata

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add description to package.json**

In `package.json`, insert `"description"` after the `"private"` line:

```json
  "private": true,
  "description": "A desktop markdown reviewer for developers",
  "version": "0.1.0",
```

- [ ] **Step 2: Update Cargo.toml [package] section**

Replace the current `[package]` block in `src-tauri/Cargo.toml` with:

```toml
[package]
name = "markdown-review"
version = "0.1.0"
description = "A markdown review desktop application"
license = "MIT"
authors = ["davidzh"]
edition = "2021"
```

- [ ] **Step 3: Commit**

```bash
git add package.json src-tauri/Cargo.toml
git commit -m "chore: add license and description to package metadata"
```

---

## Task 3: Write README

**Files:**
- Replace: `README.md`

- [ ] **Step 1: Replace README.md entirely**

```markdown
# Markdown Review

> A desktop markdown reviewer for developers

[![CI](https://github.com/dryotta/markdown-review/actions/workflows/ci.yml/badge.svg)](https://github.com/dryotta/markdown-review/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/dryotta/markdown-review)](https://github.com/dryotta/markdown-review/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Browse, read, and annotate `.md` and `.mdx` files natively on Windows and macOS.

## Features

- **File tree** — browse your entire docs folder with native folder navigation
- **Tabbed viewer** — open multiple files side by side
- **Syntax highlighting** — code blocks rendered with Shiki
- **File associations** — opens `.md` and `.mdx` files directly from your OS
- **Comments** — annotate sections inline

## Download

Get the latest release from the [Releases page](https://github.com/dryotta/markdown-review/releases/latest).

| Platform | Installer |
|----------|-----------|
| Windows  | `Markdown Review_x.x.x_x64-setup.exe` |
| macOS    | `Markdown Review_x.x.x_x64.dmg` / `_aarch64.dmg` |

## Development

**Prerequisites:** [Node.js LTS](https://nodejs.org) · [Rust stable](https://rustup.rs)

```bash
npm install
npm run tauri       # dev server with hot reload
npm test            # unit tests (Vitest)
npm run test:e2e    # E2E tests (Playwright)
```

## License

MIT — see [LICENSE](LICENSE)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: write developer-focused README"
```

---

## Task 4: Create GitHub Pages homepage

**Files:**
- Create: `docs/style.css`
- Create: `docs/index.html`

Note: The homepage references `docs/screenshot.png`. Take a screenshot of the running app and save it there. If you don't have one yet, skip the screenshot section in `index.html` (delete the `<section class="screenshot">` block) and add it later.

- [ ] **Step 1: Create `docs/style.css`**

```css
:root {
  --bg: #0d1117;
  --surface: #161b22;
  --border: #30363d;
  --text: #e6edf3;
  --muted: #8b949e;
  --accent: #58a6ff;
  --accent-hover: #79b8ff;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.6;
}

a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); }

nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  border-bottom: 1px solid var(--border);
  max-width: 1100px;
  margin: 0 auto;
}

.logo { font-weight: 600; font-size: 1.1rem; color: var(--text); }

.hero {
  text-align: center;
  padding: 5rem 2rem;
  max-width: 800px;
  margin: 0 auto;
}

.hero h1 {
  font-size: clamp(2rem, 5vw, 3.5rem);
  font-weight: 700;
  margin-bottom: 1rem;
  line-height: 1.2;
}

.hero p {
  font-size: 1.2rem;
  color: var(--muted);
  margin-bottom: 2rem;
}

.cta { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }

.btn-primary,
.btn-secondary {
  padding: 0.75rem 1.75rem;
  border-radius: 6px;
  font-weight: 600;
  font-size: 1rem;
  transition: opacity 0.15s;
}

.btn-primary { background: var(--accent); color: #0d1117; }

.btn-secondary {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-primary:hover,
.btn-secondary:hover { opacity: 0.85; color: inherit; }

.screenshot {
  max-width: 1000px;
  margin: 2rem auto;
  padding: 0 2rem;
}

.screenshot img {
  width: 100%;
  border-radius: 8px;
  border: 1px solid var(--border);
  display: block;
}

.features {
  max-width: 1000px;
  margin: 4rem auto;
  padding: 0 2rem;
}

.features h2 { text-align: center; font-size: 2rem; margin-bottom: 2rem; }

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1.5rem;
}

.feature {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.5rem;
}

.feature h3 { margin-bottom: 0.5rem; font-size: 1.1rem; }
.feature p { color: var(--muted); font-size: 0.95rem; }

.install {
  max-width: 700px;
  margin: 4rem auto;
  padding: 0 2rem;
  text-align: center;
}

.install h2 { font-size: 1.5rem; margin-bottom: 1rem; }

.install pre {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.5rem;
  text-align: left;
  overflow-x: auto;
  margin-bottom: 1rem;
}

.install code {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.9rem;
  color: var(--text);
}

.install p { color: var(--muted); }

footer {
  text-align: center;
  padding: 3rem 2rem;
  color: var(--muted);
  border-top: 1px solid var(--border);
  margin-top: 4rem;
}

@media (max-width: 600px) {
  .hero { padding: 3rem 1.5rem; }
  nav { padding: 1rem 1.5rem; }
}
```

- [ ] **Step 2: Create `docs/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="A desktop markdown reviewer for developers">
  <title>Markdown Review</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <nav>
    <span class="logo">Markdown Review</span>
    <a href="https://github.com/dryotta/markdown-review">GitHub</a>
  </nav>

  <section class="hero">
    <h1>Review markdown files like a developer</h1>
    <p>A native desktop app for browsing, reading, and annotating .md and .mdx files on Windows and macOS.</p>
    <div class="cta">
      <a href="https://github.com/dryotta/markdown-review/releases/latest" class="btn-primary">Download</a>
      <a href="https://github.com/dryotta/markdown-review" class="btn-secondary">View on GitHub</a>
    </div>
  </section>

  <section class="screenshot">
    <img src="screenshot.png" alt="Markdown Review showing a file tree and rendered markdown document">
  </section>

  <section class="features">
    <h2>Features</h2>
    <div class="feature-grid">
      <div class="feature">
        <h3>File Tree</h3>
        <p>Browse your entire documentation folder with native folder navigation.</p>
      </div>
      <div class="feature">
        <h3>Tabbed Viewer</h3>
        <p>Open multiple files side by side in a clean tabbed interface.</p>
      </div>
      <div class="feature">
        <h3>Syntax Highlighting</h3>
        <p>Code blocks rendered with accurate syntax highlighting via Shiki.</p>
      </div>
      <div class="feature">
        <h3>.md &amp; .mdx Support</h3>
        <p>First-class support for Markdown and MDX with OS file associations.</p>
      </div>
    </div>
  </section>

  <section class="install">
    <h2>Build from source</h2>
    <pre><code>git clone https://github.com/dryotta/markdown-review
cd markdown-review
npm install
npm run tauri</code></pre>
    <p>Requires <a href="https://nodejs.org">Node.js LTS</a> and <a href="https://www.rust-lang.org">Rust stable</a>.</p>
  </section>

  <footer>
    <p>MIT License &middot; <a href="https://github.com/dryotta/markdown-review">GitHub</a></p>
  </footer>

</body>
</html>
```

- [ ] **Step 3: Preview in browser**

Open `docs/index.html` directly in a browser (double-click the file or use `file://` URL). Verify:
- Dark background with blue "Download" button visible
- Four feature cards in a responsive grid
- No layout breakage at narrow viewport width

- [ ] **Step 4: Commit**

```bash
git add docs/index.html docs/style.css
git commit -m "docs: add GitHub Pages homepage"
```

---

## Task 5: Create release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write

jobs:
  create-release:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.tag.outputs.tag }}
    steps:
      - uses: actions/checkout@v4
      - name: Get tag name
        id: tag
        run: echo "tag=${GITHUB_REF_NAME}" >> "$GITHUB_OUTPUT"
      - name: Create draft release
        run: |
          gh release create "${{ steps.tag.outputs.tag }}" \
            --draft \
            --title "Markdown Review ${{ steps.tag.outputs.tag }}" \
            --notes "Download the installer for your platform from the Assets section below."
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  build:
    needs: create-release
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            artifact_glob: src-tauri/target/release/bundle/nsis/*.exe
          - os: macos-latest
            artifact_glob: src-tauri/target/release/bundle/dmg/*.dmg
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - name: Set up Rust (stable)
        uses: dtolnay/rust-toolchain@stable

      - name: Cache cargo registry
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            src-tauri/target
          key: ${{ runner.os }}-cargo-${{ hashFiles('src-tauri/Cargo.lock') }}
          restore-keys: ${{ runner.os }}-cargo-

      - name: Set up Node.js (LTS)
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - name: Install npm dependencies
        run: npm ci

      - name: Build Tauri app
        run: npm run tauri:build
        env:
          TAURI_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
          TAURI_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}

      - name: Upload artifact to release
        shell: bash
        run: |
          file=$(ls ${{ matrix.artifact_glob }} | head -1)
          gh release upload "${{ needs.create-release.outputs.tag }}" "$file"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  publish-release:
    needs: [create-release, build]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Publish release
        run: gh release edit "${{ needs.create-release.outputs.tag }}" --draft=false
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Validate YAML syntax**

```bash
python -c "import yaml, sys; yaml.safe_load(open('.github/workflows/release.yml')); print('YAML valid')"
```

Expected output: `YAML valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow for Windows and macOS"
```

---

## Task 6: Enable GitHub Pages (manual)

This step requires browser access to the repository settings — it cannot be done via code.

- [ ] **Step 1: Enable Pages**

1. Go to `https://github.com/dryotta/markdown-review/settings/pages`
2. Under **Source**, select **Deploy from a branch**
3. Branch: `main` · Folder: `/docs`
4. Click **Save**

GitHub will publish the site at `https://dryotta.github.io/markdown-review/` within ~1 minute.

- [ ] **Step 2: Verify**

Visit `https://dryotta.github.io/markdown-review/` and confirm the dark homepage loads with the hero section and feature cards.

---

## How to trigger a release

Once all tasks are complete, create and push a tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The `release.yml` workflow will start, create a draft GitHub Release, build Windows and macOS installers in parallel (~15 min), attach both artifacts, then publish the release automatically.
