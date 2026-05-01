# 07 · Local Images (relative paths)

Tests the `convertFileSrc` chokepoint at
`src/components/viewers/MarkdownViewer.tsx:302-309` (rule 14 in
`docs/security.md`): every local `<img src="...">` is rewritten to
`asset:` (or the Windows `http://asset.localhost` form) so the WebView
loads via the asset protocol, never raw `file://`.

All images live in [`./images/`](./images/) — relative paths only.

## Format coverage

### SVG (text-based, scalable)

![Logo — text-based SVG](./images/logo.svg)

![Hand-drawn bar chart in SVG](./images/chart.svg)

![Wide ASCII-style banner SVG](./images/banner.svg)

### PNG (raster, alpha)

![Solid blue 200×200 PNG](./images/solid-blue-200.png)

![300×200 RGB gradient PNG](./images/gradient-300.png)

![Black/white checkerboard PNG](./images/checkerboard-160.png)

![Disk on a transparent background — alpha channel](./images/transparent-disk-120.png)

### Tiny image (16×16)

![Tiny 16×16 gradient — should render at native size unless zoomed](./images/tiny-16.png)

## Aspect-ratio extremes

### Tall narrow strip (80×600) — should not stretch the viewer

![Tall vertical gradient — 80 wide × 600 tall](./images/tall-strip-80x600.png)

### Wide short strip (600×80)

![Wide horizontal gradient — 600 wide × 80 tall](./images/wide-strip-600x80.png)

## Image as a link

[![Click — opens GitHub](./images/logo.svg)](https://github.com)

> Click the image: per rule 13 in `docs/security.md`, `MarkdownViewer.tsx:146-148`
> only opens `http(s)` URLs. The asset is NOT a navigation target — only
> the wrapping `<a href>` is.

## Inline images in flowing text

This sentence has an inline image ![chart](./images/chart.svg) right in
the middle of its text — the viewer should size it sensibly relative to
the text baseline (or wrap it as a block — both are acceptable).

A list with inline image bullets:

- ![logo](./images/logo.svg) Repo logo
- ![banner](./images/banner.svg) Banner
- ![chart](./images/chart.svg) Quarterly chart

## A grid of thumbnails (via table)

| Logo | Chart | Banner |
|---|---|---|
| ![](./images/logo.svg) | ![](./images/chart.svg) | ![](./images/banner.svg) |
| ![](./images/solid-blue-200.png) | ![](./images/gradient-300.png) | ![](./images/checkerboard-160.png) |

## Trailing checklist

- [ ] Every image renders (no broken-image icon).
- [ ] DevTools Network tab shows requests via `asset:` (or `http://asset.localhost`), never `file://` (rule 17 in `docs/security.md`).
- [ ] Tall and wide aspect-ratio images stay inside the reading column without stretching.
- [ ] Click-through on the linked image opens the target (`gh.com`) via the system browser.
- [ ] DevTools console: zero errors / warnings.
