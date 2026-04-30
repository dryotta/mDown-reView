# Markdown Manual-Test Samples

A curated set of markdown files designed to exercise every feature
mdownreview's renderer supports. Sister-folders under
[`../`](../) cover the other viewers (`json/`, `csv/`, `html/`,
`mermaid/`, `kql/`, `source/`, `audio/`, `binary/`).

## Index

| # | File | What it covers |
|---|---|---|
| 01 | [`01-gfm-basics.md`](./01-gfm-basics.md) | Headings, paragraphs, emphasis, lists, blockquotes, links, autolinks, strikethrough, horizontal rules |
| 02 | [`02-tables.md`](./02-tables.md) | Tables of various sizes, alignment, complex cell content (links, code, emphasis), edge cases |
| 03 | [`03-code-blocks.md`](./03-code-blocks.md) | Shiki syntax highlighting across 12+ languages, very-long lines, mixed indentation, copy-button hover |
| 04 | [`04-task-lists-and-footnotes.md`](./04-task-lists-and-footnotes.md) | GFM task lists (nested), footnote references and definitions |
| 05 | [`05-math-katex.md`](./05-math-katex.md) | Inline math, display math, complex equations (matrix, integrals, summations) — exercises the lazy KaTeX chunk |
| 06 | [`06-mermaid.md`](./06-mermaid.md) | Inline `` ```mermaid `` fences — flowchart, sequence, gantt, state, pie, class, ER |
| 07 | [`07-images-local.md`](./07-images-local.md) | Local image embedding (relative paths) — PNG, SVG, transparent alpha, extreme aspect ratios |
| 08 | [`08-images-remote.md`](./08-images-remote.md) | Remote image embedding via the `fetch_remote_asset` proxy chokepoint — common stable hosts |
| 09 | [`09-images-mixed-and-edge-cases.md`](./09-images-mixed-and-edge-cases.md) | Mixed local + remote, broken paths (404), missing alt text, links wrapping images, captions |
| 10 | [`10-html-and-special.md`](./10-html-and-special.md) | Inline HTML allowed by the sanitize schema — `<kbd>`, `<details>`, `<sub>`, `<sup>`, `<abbr>`, GFM alerts |
| 11 | [`11-kitchen-sink.md`](./11-kitchen-sink.md) | One-page everything — useful for screenshots and regression scans |

## How to use

1. Build or run mdownreview (e.g. `npm run tauri:dev`).
2. **File → Open Folder…** and select `samples/` (the parent folder of this one).
3. Click into `markdown/` and walk through each numbered file in order.
4. Spot-check:
   - Markdown renders without console errors (open DevTools with **Window → Toggle Developer Tools** / **F12**).
   - Code blocks pick up Shiki highlighting and a copy button on hover.
   - KaTeX renders math without `unsafe-inline` style breakage.
   - Mermaid diagrams render inline.
   - Local images appear (asset-protocol path).
   - Remote images appear (proxy path).
   - Tables and tasklists honour GFM.
   - Comments can be added against any block, line, or word range.

## Known gaps (intentional)

These files do **not** exercise:

- **CSV / JSON / image / HTML / Mermaid file viewers** — those have dedicated sister folders next to this one (`../csv/`, `../json/`, `../html/`, `../mermaid/`); this folder is markdown-only.
- **Source-view (`SourceView.tsx`)** — see `../source/` for a multi-language tour.
- **Comments lifecycle** — open one of these files and exercise commenting manually; that flow has its own e2e specs.
- **Watcher reload** — edit a file in your editor while the app is open to test that.

## Regenerating PNG fixtures

If a PNG in `images/` is corrupted or you want to vary the content:

```sh
python samples/markdown/generate_pngs.py
```

The script uses Python stdlib only (no PIL needed) and writes 7 small valid PNGs.

## Licensing

All content in this folder is contributed under the repo's MIT license.
SVG images are hand-written; PNG images are generated from `generate_pngs.py`.
Remote-image references in `08-images-remote.md` and
`09-images-mixed-and-edge-cases.md` point at well-known stable hosts
(GitHub Avatars, raw.githubusercontent.com, picsum.photos) — they're
loaded through mdownreview's bounded `fetch_remote_asset` proxy.
