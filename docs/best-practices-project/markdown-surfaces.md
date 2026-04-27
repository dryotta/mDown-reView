# ReactMarkdown Surface Guard

Every `<ReactMarkdown>` mounting site must inherit the overflow-wrap cascade
(`src/styles/md-wrap-cascade.css`) to prevent long unbreakable tokens from
pushing the page sideways. This guard exists because the same defect recurred
across #91 and #150 — each time a new surface shipped without the cascade.

## The rule

The wrapper element around every `<ReactMarkdown>` must have a `className`
that is in the lint allowlist (`scripts/check-markdown-surfaces.mjs`).
Currently allowlisted: `markdown-body`, `comment-text`.

The lint runs as `npm run lint:markdown-surfaces` and is included in `npm run lint`.
PRs introducing an unguarded surface fail CI.

## How to add a new ReactMarkdown surface

1. **Create the wrapper element** with a descriptive CSS class, e.g.:
   ```tsx
   <div className="my-new-surface md-wrap-cascade">
     <ReactMarkdown>{content}</ReactMarkdown>
   </div>
   ```

2. **Add `md-wrap-cascade`** to the wrapper's `className` so the four
   overflow-wrap rule groups apply automatically.

3. **Add the class to the lint allowlist** in
   `scripts/check-markdown-surfaces.mjs`:
   ```js
   const ALLOWLIST = new Set(["markdown-body", "comment-text", "my-new-surface"]);
   ```

4. **Run the lint** to verify: `npm run lint:markdown-surfaces`.

## The four rule groups

Defined once in `src/styles/md-wrap-cascade.css`:

| Group | Rule | Purpose |
|-------|------|---------|
| 1. Container | `overflow-wrap: anywhere` | Break long tokens at the surface boundary |
| 2. Inline code | `code { overflow-wrap: anywhere }` | Wrap long backticked tokens |
| 3. Fenced pre | `pre { overflow: auto }` + `pre, pre code { overflow-wrap: normal; white-space: pre }` | Keep fenced code horizontally scrollable |
| 4. Table cells | `th, td { overflow-wrap: anywhere }` | Wrap long tokens in table cells |

## Architecture references

- `docs/architecture.md` — layer separation (CSS is View layer)
- `docs/principles.md` — Reliable pillar, Zero Bug Policy
