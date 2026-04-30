# mdownreview Sample Files

A curated set of files designed to exercise every viewer mdownreview
ships, plus enough complexity per file to spot regressions visually.

Open this folder in mdownreview (**File → Open Folder**) and click
through each subfolder. Each subfolder targets one viewer.

## Index — by viewer

| Folder | Viewer | What it exercises |
|---|---|---|
| [`markdown/`](./markdown/) | `MarkdownViewer` | GFM, KaTeX, Mermaid, footnotes, task lists, GitHub alerts, local + remote images, sanitization edge cases |
| [`json/`](./json/) | `JsonView` | Flat / nested / array / mixed-types / unicode / `.jsonc` (with comments) |
| [`csv/`](./csv/) | `CsvView` | Simple / wide / tab-separated / unicode / embedded quotes & commas |
| [`html/`](./html/) | `HtmlPreviewView` | Sandboxed iframe — simple / styled / **JS-must-not-execute** / with images |
| [`mermaid/`](./mermaid/) | `MermaidView` (.mmd, .mermaid) | Flowchart, sequence, state, class, gantt, ER |
| [`kql/`](./kql/) | `KqlPlanView` | Simple / multi-stage / `.csl` extension |
| [`source/`](./source/) | `SourceView` (Shiki) | Rust, TS, Python, Go, C++, Java, SQL, YAML, TOML, Dockerfile, Makefile, shell, diff |
| [`images/`](./images/) | `ImageViewer` | JPEG, PNG (RGBA / large / portrait / 1px), GIF (static + animated), BMP, ICO, WebP, SVG (gradients + diagrams) |
| [`binary/`](./binary/) | `BinaryPlaceholder` | ZIP, raw binary blob, no-extension blob, WAV (audio is treated as binary) |

## What to spot-check, by viewer

### Markdown — `markdown/`
See [`markdown/README.md`](./markdown/README.md) for the per-file index. Scope summary:
- Headings get autolinked anchors.
- Code blocks pick up Shiki highlighting + hover-revealed copy button (mermaid blocks excluded).
- KaTeX renders inline + block math without `unsafe-inline` style breakage.
- Mermaid fenced blocks render inline via the same `MermaidView` chunk.
- Local images load via `asset:` (rule 14 in `docs/security.md`); remote via the bounded `fetch_remote_asset` proxy.
- All sanitization XSS payloads (`<script>`, `javascript:` URLs, on-handlers) are stripped.

### JSON — `json/`
- Visual mode renders the parse tree with collapsible nodes.
- `.jsonc` honors `//` and `/* ... */` comments in source view.
- Source-mode toggle re-shows the raw bytes with Shiki json/jsonc highlighting.

### CSV — `csv/`
- Headers row is detected.
- Embedded quotes / commas / newlines round-trip.
- TSV files (tab-separated) are routed to the same viewer.

### HTML — `html/`
- Iframe sandbox is `allow-same-origin` only — CSS renders, JS does not (rule 12a in `docs/security.md`).
- The 03-script-sandbox-test page should render but **never** show an alert dialog or change its `#result` div text.
- Images load both relative (`../markdown/images/...`) and remote.

### Mermaid — `mermaid/`
- Each `.mmd` file renders a single diagram with theme-aware palette.
- `securityLevel: "strict"` blocks click-events.

### KQL — `kql/`
- Both `.kql` and `.csl` route to `KqlPlanView`.
- Multi-stage queries render as a tree.

### Source — `source/`
- Each language gets a different Shiki palette.
- Fold-region detector (Rust side) recognises both brace-style (`.rs` / `.ts` / `.go` / etc.) and indent-style (`.py` / `.yaml`).
- Files with no extension (Dockerfile, Makefile) use the basename map to pick the right Shiki language.

### Images — `images/`
- Full coverage of every extension routed to `ImageViewer`: `.jpg`, `.png`, `.gif`, `.bmp`, `.ico`, `.webp`, `.svg`.
- Static + animated GIF (the rotating dot in `04-rotating-dot-animated.gif` should loop).
- Extreme aspect ratios (1×1 pixel, 200×500 portrait, 1200×800 landscape) — the viewer should scale sensibly.
- PNG with alpha, JPEG with photo-like content, ICO with multiple embedded sizes.

### Audio (treated as binary)
- mdownreview no longer ships a dedicated audio viewer. `.wav`, `.mp3`,
  `.ogg`, `.flac`, `.m4a`, and `.aac` files are routed to
  `BinaryPlaceholder` like any other binary blob — see `binary/`.

### Binary — `binary/`
- `BinaryPlaceholder` shows MIME hint + size + appropriate icon.
- ZIP files get the archive icon; WAV files get the audio icon; raw
  `.bin` files get the generic icon.
- No content is rendered (the file is binary; not safely previewable).

## Regenerating generated fixtures

Three scripts re-create the binary fixtures (everything else is hand-written text):

```sh
# 7 small PNGs used INSIDE markdown image samples (deterministic, stdlib only)
python samples/markdown/generate_pngs.py

# 10 image-viewer fixtures across every format mdownreview supports (requires Pillow)
python samples/generate_images.py

# WAV + ZIP + raw binary blobs into samples/binary/ (stdlib only)
python samples/generate_binary.py
```

`generate_images.py` requires Pillow (`pip install Pillow`); the other
two use Python stdlib only.

## Notes on remote-image samples

Some samples reference remote URLs (notably `markdown/08-images-remote.md`,
`markdown/09-images-mixed-and-edge-cases.md`, `html/04-with-images.html`).
On first load mdownreview may prompt for per-document allowance — that's
the `viewerPrefsSlice.allowedRemoteImageDocs` gate (intentionally not
persisted across restarts).

## Licensing

All hand-written content is contributed under the repo's MIT license.
Image fixtures are generated by `markdown/generate_pngs.py` and
`generate_images.py`. WAV + ZIP + raw binary fixtures are generated by
`generate_binary.py`. Remote-image references point at well-known stable
hosts (GitHub avatars, raw.githubusercontent, picsum.photos) and are
loaded through mdownreview's bounded HTTPS image proxy.
