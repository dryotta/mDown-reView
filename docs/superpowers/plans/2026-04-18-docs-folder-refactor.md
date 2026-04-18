# Docs Folder Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the GitHub Pages website from `docs/` to `site/`, clean up scaffold SVGs from `public/`, and add a GitHub Actions workflow to deploy `site/` to GitHub Pages.

**Architecture:** Three sequential file-system tasks followed by one manual GitHub settings step. No source code changes. Each task commits independently.

**Tech Stack:** GitHub Actions (`actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`, `actions/configure-pages@v5`), static HTML/CSS

---

## File Map

| File | Action |
|---|---|
| `docs/index.html` | Move → `site/index.html` |
| `docs/style.css` | Move → `site/style.css` |
| `public/tauri.svg` | Delete |
| `public/vite.svg` | Delete |
| `.github/workflows/pages.yml` | Create |

---

## Task 1: Move website files to `site/`

**Files:**
- Create: `site/index.html`
- Create: `site/style.css`
- Delete: `docs/index.html`
- Delete: `docs/style.css`

- [ ] **Step 1: Create the `site/` directory and move files**

```bash
mkdir -p site
git mv docs/index.html site/index.html
git mv docs/style.css site/style.css
```

- [ ] **Step 2: Verify the moves**

```bash
ls site/
# Expected: index.html  style.css

ls docs/
# Expected: superpowers/   (no index.html or style.css)
```

- [ ] **Step 3: Commit**

```bash
git add site/index.html site/style.css
git commit -m "refactor: move GitHub Pages website from docs/ to site/"
```

---

## Task 2: Remove scaffold SVGs from `public/`

**Files:**
- Delete: `public/tauri.svg`
- Delete: `public/vite.svg`

- [ ] **Step 1: Delete the scaffold files**

```bash
git rm public/tauri.svg public/vite.svg
```

- [ ] **Step 2: Verify `public/` is now empty**

```bash
ls public/ 2>/dev/null || echo "empty"
# Expected: empty (or no output)
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove Vite scaffold SVGs from public/"
```

---

## Task 3: Add GitHub Pages deployment workflow

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/pages.yml` with this exact content:

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site/
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Verify the file was created**

```bash
cat .github/workflows/pages.yml
# Expected: full YAML contents as above
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: add GitHub Actions workflow to deploy site/ to GitHub Pages"
```

---

## Task 4: Switch GitHub Pages source (manual)

This step cannot be scripted — it requires clicking in the GitHub UI.

- [ ] **Step 1: Open the repository settings**

Go to: `https://github.com/<owner>/markdown-review/settings/pages`

- [ ] **Step 2: Change the source**

Under **Build and deployment → Source**, change from:
> Deploy from a branch → `main` / `/docs`

to:
> **GitHub Actions**

Click **Save**.

- [ ] **Step 3: Verify the deployment triggered**

Go to the **Actions** tab. You should see a "Deploy GitHub Pages" workflow run triggered by the earlier push to `main`. Wait for it to complete (green check).

- [ ] **Step 4: Confirm the live site**

Visit the GitHub Pages URL (shown in repo Settings → Pages after deployment). The Markdown Review landing page should load correctly.
