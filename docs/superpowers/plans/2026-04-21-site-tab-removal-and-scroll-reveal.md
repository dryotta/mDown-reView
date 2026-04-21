# Site: Tab Removal + Scroll Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant "GitHub Releases" download tab and add a scroll-reveal fade-in animation to page sections.

**Architecture:** Two independent edits to `site/index.html` and `site/style.css` — no new files, no build step. Tab removal deletes HTML, one JS block, and two CSS rule blocks. Scroll reveal adds a CSS transition, three HTML class attributes, and an IntersectionObserver block to the existing inline script.

**Tech Stack:** Vanilla HTML/CSS/JS, IntersectionObserver API

**Spec:** `docs/superpowers/specs/2026-04-21-site-tab-removal-and-scroll-reveal-design.md`

---

## File Map

| File | Changes |
|------|---------|
| `site/index.html` | Task 1: remove tab button + panel + JS fallback. Task 2: add `.reveal` to 3 elements + IntersectionObserver block |
| `site/style.css` | Task 1: remove `.releases-block` + `.btn-releases` rules. Task 2: add `.reveal` transition rules |

---

## Task 1: Remove GitHub Releases Tab

**Files:**
- Modify: `site/index.html`
- Modify: `site/style.css`

### 1a — Remove the tab button from HTML

- [ ] **Step 1: Delete the "GitHub Releases" tab button**

In `site/index.html`, find and remove this exact line (it is between the Script tab button and the closing `</div>` of `.tab-bar`):

```html
            <button class="tab-btn" data-tab="releases">GitHub Releases</button>
```

After removal, the `.tab-bar` div should contain exactly two buttons:
```html
          <div class="tab-bar">
            <button class="tab-btn active" data-tab="download">Download</button>
            <button class="tab-btn" data-tab="script">Script</button>
          </div>
```

### 1b — Remove the tab panel from HTML

- [ ] **Step 2: Delete the `#tab-releases` panel**

In `site/index.html`, find and remove this entire block (6 lines):

```html
          <div class="tab-panel hidden" id="tab-releases">
            <div class="releases-block">
              <p>Browse all releases, download any version, or find builds for all platforms.</p>
              <a href="https://github.com/dryotta/mdownreview/releases/latest" class="btn-releases">View all releases on GitHub →</a>
            </div>
          </div>
```

### 1c — Remove the JS fallback block

- [ ] **Step 3: Delete the unknown-platform releases-tab fallback**

In the `<script>` block of `site/index.html`, find and remove this entire block (7 lines including comment):

```js
    // If unknown platform, default to releases tab
    if (!detected) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      document.querySelector('[data-tab="releases"]').classList.add('active');
      document.getElementById('tab-releases').classList.remove('hidden');
    }
```

Nothing replaces it — when platform is unknown the Download tab stays active (it is `active` by default in the HTML), and the fetch callback's `else` branch already sets `dl-btn` to the generic releases URL.

### 1d — Remove CSS rules

- [ ] **Step 4: Delete `.releases-block` and `.btn-releases` CSS rules**

In `site/style.css`, find and remove this entire block (33 lines):

```css
.releases-block {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 2rem 1.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
}

.releases-block p {
  color: var(--muted);
  font-size: 0.9rem;
  max-width: 400px;
}

.btn-releases {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 1.5rem;
  border-radius: 8px;
  background: var(--surface-hover);
  border: 1px solid var(--border-hover);
  color: var(--text);
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.btn-releases:hover { border-color: var(--accent-1); color: var(--text); }
```

### 1e — Verify and commit

- [ ] **Step 5: Verify no dead references remain**

```bash
grep -n "releases\|tab-releases\|btn-releases\|releases-block" site/index.html site/style.css
```

Expected matches (these are fine — they are outbound links to GitHub, not dead internal references):
- `site/index.html`: lines referencing `releases/latest` in `href` attributes (in the download row and "Not your platform?" link)

Expected to be absent:
- `data-tab="releases"`, `id="tab-releases"`, `class="btn-releases"`, `class="releases-block"`, `[data-tab="releases"]`

- [ ] **Step 6: Open `site/index.html` in a browser and verify**

Open the file directly in a browser (no server needed). Check:
- Download section shows only two tabs: "Download" and "Script"
- Clicking each tab works
- On an unknown platform (or with JS disabled), the Download tab is shown by default
- No layout breaks

- [ ] **Step 7: Commit**

```bash
git add site/index.html site/style.css
git commit -m "feat: remove GitHub Releases tab from download section"
```

---

## Task 2: Add Scroll Reveal

**Files:**
- Modify: `site/style.css`
- Modify: `site/index.html`

### 2a — Add CSS

- [ ] **Step 1: Append scroll reveal CSS to `site/style.css`**

Add these 16 lines at the very end of `site/style.css` (after the `@media (max-width: 768px)` block):

```css

/* ── Scroll Reveal ── */
.reveal {
  opacity: 0;
  transform: translateY(28px);
  transition: opacity 0.55s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.55s cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; transform: none; transition: none; }
}
```

### 2b — Add `.reveal` class to sections

- [ ] **Step 2: Add `reveal` class to `#how-it-works` section**

In `site/index.html`, find:
```html
  <section id="how-it-works" class="section-wide">
```
Replace with:
```html
  <section id="how-it-works" class="section-wide reveal">
```

- [ ] **Step 3: Add `reveal` class to `#install` section**

Find:
```html
  <section id="install" class="section">
```
Replace with:
```html
  <section id="install" class="section reveal">
```

- [ ] **Step 4: Add `reveal` class to `<footer>`**

Find:
```html
  <footer>
```
Replace with:
```html
  <footer class="reveal">
```

### 2c — Add IntersectionObserver JS

- [ ] **Step 5: Append IntersectionObserver to the script block**

In `site/index.html`, find the closing `</script>` tag and add these lines immediately before it:

```js
    // ── Scroll reveal ──────────────────────────────────────────────
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          observer.unobserve(e.target);
        }
      }),
      { threshold: 0.08 }
    );
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
```

### 2d — Verify and commit

- [ ] **Step 6: Open `site/index.html` in a browser and verify**

Open the file in a browser. Check:
- On load: only the hero and nav are visible; `#how-it-works`, `#install`, and footer are invisible (opacity 0)
- Scrolling down: each section fades and slides up into view as it enters the viewport
- Once revealed, scrolling back up does not hide the section again
- Nav anchor links (`#how-it-works`, `#install`) still scroll to the correct position — the sections are in the DOM even when invisible

To verify reduced-motion: open DevTools → Rendering → Enable "Emulate CSS media feature prefers-reduced-motion" → reload. All sections should be visible immediately with no animation.

- [ ] **Step 7: Commit**

```bash
git add site/index.html site/style.css
git commit -m "feat: add scroll reveal animation to page sections"
```
