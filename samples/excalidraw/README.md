# Excalidraw fixtures

Test files for the Excalidraw 3-mode viewer (issue #352 / PR #353).
Open `samples/` in mdownreview to exercise each routing path.

| File | Routes to | What it exercises |
|---|---|---|
| `1-shapes.excalidraw` | `ExcalidrawView` (canonical scene) | Visual mode default, Source mode shows raw scene JSON with Tier-1 commenting, Editor mode allows in-place editing |
| `2-flowchart.excalidraw` | `ExcalidrawView` (canonical scene) | Multi-element scene (4 nodes + 3 arrows + title) — stresses Visual rendering and Source-mode commenting on a non-trivial JSON document |
| `3-icons.excalidrawlib` | `ExcalidrawView` (library) | Library file with 3 reusable items — Visual mode renders the palette grid; Editor mode allows library-item editing |
| `4-shapes.excalidraw.svg` | `ExcalidrawView` (image variant) | Real SVG bytes with embedded scene in the canonical Excalidraw `<!-- payload-start -->BASE64<!-- payload-end -->` markers; Source mode is read-only (extracted JSON shown), Visual mode re-renders the scene |
| `5-shapes.excalidraw.png` | `ExcalidrawView` (image variant) | Real PNG bytes with embedded scene in a `tEXt` chunk keyed `application/vnd.excalidraw+json`; same Source/Visual semantics as the SVG variant |

Both image variants encode the same scene as `1-shapes.excalidraw` so a
side-by-side open of all three demonstrates that the three storage shapes
(canonical JSON, SVG-embedded, PNG-embedded) round-trip identically.

## Embedding format

The PNG and SVG variants use the **uncompressed** payload shape ("Format B"
in Excalidraw's decoders): the embedded text is the verbatim canonical
scene JSON whose top-level `type === "excalidraw"`. Excalidraw's own
decoders (`decodePngMetadata`, `decodeSvgBase64Payload`) return that JSON
unchanged when the parsed object lacks an `encoded` field but has
`type === "excalidraw"`. This is wire-compatible with `loadFromBlob` and
needs no `pako`/deflate dependency — the canonical exporter uses Format A
(deflated + base64) but accepts both on the read path.

## Regeneration

The fixtures are byte-deterministic (fixed timestamps, fixed seeds):

```sh
python samples/generate_excalidraw.py
```

Stdlib only — no Pillow, no pako, no node.

## Round-trip verification

`_verify.mjs` is a small dev-only script that re-implements the
Excalidraw decode contract verbatim and parses each fixture:

```sh
node samples/excalidraw/_verify.mjs
```

It prints one line per fixture and exits non-zero on any failure. Useful
when bumping `@excalidraw/excalidraw` or changing the embed shape.

## Visual reference

Both `4-shapes.excalidraw.svg` and `5-shapes.excalidraw.png` also render
visibly when opened outside Excalidraw — the SVG draws best-effort shape
representations of the embedded scene, and the PNG carries a small
banded background. Visual fidelity is intentionally rough; the embedded
scene JSON is the source of truth for any re-open.
