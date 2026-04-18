# Build, Release & Homepage Design

**Date:** 2026-04-17  
**Status:** Approved

## Overview

Make the markdown-review Tauri desktop app ready for public release with:
- Automated GitHub Actions release pipeline (Windows + macOS)
- Polished repository README for developer visitors
- Static GitHub Pages homepage served from `docs/`

## Target Audience

Developers who review markdown documentation and PRs locally.

## 1. Release Pipeline

**Trigger:** Push a tag matching `v*.*.*` to main (e.g. `v0.1.0`).

**File:** `.github/workflows/release.yml`

**Jobs:**

1. `create-release` — runs on `ubuntu-latest`
   - Creates a draft GitHub Release for the pushed tag
   - Outputs `release_id` for downstream jobs

2. `build` — matrix `[windows-latest, macos-latest]`, depends on `create-release`
   - Installs Rust stable + Node LTS
   - Runs `npm ci && npm run tauri:build`
   - Uploads platform artifact to the GitHub Release
     - Windows: `.exe` (NSIS installer from `src-tauri/target/release/bundle/nsis/`)
     - macOS: `.dmg` (from `src-tauri/target/release/bundle/dmg/`)
   - Uses existing secrets `TAURI_PRIVATE_KEY` + `TAURI_KEY_PASSWORD` for Windows updater signing
   - macOS code signing deferred (requires Apple Developer cert)

3. `publish-release` — runs after all `build` matrix jobs succeed
   - Removes draft status → Release goes live with all artifacts attached

## 2. README

**File:** `README.md` (replace existing boilerplate)

**Sections:**
- Header: app name + tagline "A desktop markdown reviewer for developers"
- Badges: CI status, latest release, MIT license
- Screenshot (single app screenshot)
- Features: file tree browsing, tabbed viewer, syntax highlighting, .md/.mdx support, commenting
- Download: links to GitHub Releases for Windows (.exe) and macOS (.dmg)
- Development setup: prerequisites (Node LTS, Rust stable) + `npm install && npm run tauri`
- License: MIT

## 3. GitHub Pages Homepage

**Files:** `docs/index.html` + `docs/style.css`  
**GitHub Pages config:** main branch → `docs/` folder

**Page sections:**
1. Hero — app name, tagline, download buttons (Windows + macOS) linking to latest GitHub Release
2. Features — 3–4 cards: file tree navigation, tabbed viewing, syntax highlighting, .md/.mdx file associations
3. Screenshot — single app screenshot
4. Install — dev setup snippet
5. Footer — MIT license, GitHub repo link

**Style:** Dark theme, plain HTML/CSS, no JavaScript, no external dependencies, responsive.

## 4. Supporting Files

- `LICENSE` — MIT license text with current year and author
- `package.json` — add `description` field
- `Cargo.toml` — add `license = "MIT"` and `authors` field

## Out of Scope

- macOS code signing (requires Apple Developer cert)
- CHANGELOG.md, CONTRIBUTING.md (future)
- npm publish
