"""Generate Excalidraw fixtures for samples/excalidraw/.

Outputs four files exercising every routing path of the Excalidraw viewer
(issue #352 / PR #353):

    samples/excalidraw/
      1-shapes.excalidraw           ΓåÆ canonical scene JSON (raw)
      2-flowchart.excalidraw        ΓåÆ canonical scene JSON, multi-element
      3-icons.excalidrawlib         ΓåÆ canonical library JSON (3 items)
      4-shapes.excalidraw.svg       ΓåÆ real SVG + embedded scene
                                      (`<!-- payload-start -->BASE64<!-- payload-end -->`)
      5-shapes.excalidraw.png       ΓåÆ real PNG + embedded scene
                                      (`tEXt` chunk, keyword
                                      `application/vnd.excalidraw+json`)

Both image embeds use the "Format B" (uncompressed) payload shape: the
tEXt text / decoded base64 is the verbatim canonical scene JSON whose
top-level `type === "excalidraw"`. Excalidraw's own decoders
(`decodePngMetadata` / `decodeSvgBase64Payload`) return the JSON string
as-is when the parsed object lacks an `encoded` field but has
`type === "excalidraw"`, so this works end-to-end with `loadFromBlob`
without needing pako/deflate.

Stdlib only ΓÇö no Pillow, no pako, no node. Run from anywhere:

    python samples/generate_excalidraw.py
"""

from __future__ import annotations

import base64
import json
import struct
import sys
import zlib
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "samples" / "excalidraw"

# Stable "now" so generated files are byte-deterministic ΓÇö same input
# always produces the same bytes (good for diff review + reproducibility).
FIXED_TS_MS = 1_700_000_000_000
EXPORT_SOURCE = "https://excalidraw.com"


# -----------------------------------------------------------------------------
# Element factories
# -----------------------------------------------------------------------------

def _common(idx: int, x: int, y: int, w: int, h: int) -> dict[str, Any]:
    """Common Excalidraw element fields. `idx` seeds deterministic ids."""
    return {
        "id": f"el-{idx:08d}",
        "version": 1,
        "versionNonce": 1_000_000 + idx * 17,
        "isDeleted": False,
        "fillStyle": "solid",
        "strokeWidth": 2,
        "strokeStyle": "solid",
        "roughness": 1,
        "opacity": 100,
        "angle": 0,
        "x": x,
        "y": y,
        "strokeColor": "#1e1e1e",
        "backgroundColor": "transparent",
        "width": w,
        "height": h,
        "seed": 1_000 + idx * 31,
        "groupIds": [],
        "frameId": None,
        "roundness": {"type": 3},
        "boundElements": None,
        "updated": FIXED_TS_MS,
        "link": None,
        "locked": False,
    }


def rect(idx: int, x: int, y: int, w: int, h: int, *, bg: str = "#a5d8ff") -> dict[str, Any]:
    e = _common(idx, x, y, w, h)
    e["type"] = "rectangle"
    e["backgroundColor"] = bg
    return e


def ellipse(idx: int, x: int, y: int, w: int, h: int, *, bg: str = "#ffd8a8") -> dict[str, Any]:
    e = _common(idx, x, y, w, h)
    e["type"] = "ellipse"
    e["backgroundColor"] = bg
    e["roundness"] = {"type": 2}
    return e


def diamond(idx: int, x: int, y: int, w: int, h: int, *, bg: str = "#d0bfff") -> dict[str, Any]:
    e = _common(idx, x, y, w, h)
    e["type"] = "diamond"
    e["backgroundColor"] = bg
    return e


def text(idx: int, x: int, y: int, w: int, h: int, label: str, *, font_size: int = 20) -> dict[str, Any]:
    e = _common(idx, x, y, w, h)
    e["type"] = "text"
    e["text"] = label
    e["originalText"] = label
    e["fontSize"] = font_size
    e["fontFamily"] = 1  # Virgil
    e["textAlign"] = "center"
    e["verticalAlign"] = "middle"
    e["baseline"] = int(font_size * 0.9)
    e["containerId"] = None
    e["lineHeight"] = 1.25
    e["roundness"] = None
    return e


def arrow(idx: int, x: int, y: int, points: list[list[int]]) -> dict[str, Any]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    w = max(xs) - min(xs)
    h = max(ys) - min(ys) or 1
    e = _common(idx, x, y, w, h)
    e["type"] = "arrow"
    e["points"] = points
    e["lastCommittedPoint"] = None
    e["startBinding"] = None
    e["endBinding"] = None
    e["startArrowhead"] = None
    e["endArrowhead"] = "arrow"
    e["roundness"] = {"type": 2}
    return e


# -----------------------------------------------------------------------------
# Scene + library JSON builders
# -----------------------------------------------------------------------------

def scene(elements: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "excalidraw",
        "version": 2,
        "source": EXPORT_SOURCE,
        "elements": elements,
        "appState": {
            "viewBackgroundColor": "#ffffff",
            "gridSize": None,
        },
        "files": {},
    }


def shapes_scene() -> dict[str, Any]:
    """A small scene: rectangle + ellipse + arrow + label. Used by both
    the canonical `.excalidraw` and the SVG/PNG embed fixtures."""
    return scene([
        rect(1, 80, 80, 200, 120, bg="#a5d8ff"),
        text(2, 100, 120, 160, 40, "Hello", font_size=28),
        ellipse(3, 360, 80, 180, 120, bg="#ffd8a8"),
        text(4, 380, 120, 140, 40, "World", font_size=28),
        arrow(5, 290, 140, [[0, 0], [70, 0]]),
    ])


def flowchart_scene() -> dict[str, Any]:
    """A larger scene: 4 nodes connected by arrows + a title. Stresses the
    Visual viewer with multiple elements + arrows."""
    return scene([
        text(0, 200, 20, 240, 40, "Build pipeline", font_size=24),
        rect(1, 80, 100, 160, 80, bg="#b2f2bb"),
        text(2, 100, 125, 120, 30, "source"),
        diamond(3, 320, 100, 160, 80, bg="#ffec99"),
        text(4, 340, 125, 120, 30, "lint?"),
        rect(5, 560, 60, 160, 80, bg="#a5d8ff"),
        text(6, 580, 85, 120, 30, "build"),
        rect(7, 560, 160, 160, 80, bg="#ffc9c9"),
        text(8, 580, 185, 120, 30, "fail"),
        arrow(9, 240, 140, [[0, 0], [80, 0]]),
        arrow(10, 480, 130, [[0, 0], [80, -30]]),
        arrow(11, 480, 150, [[0, 0], [80, 50]]),
    ])


def library_doc() -> dict[str, Any]:
    """Excalidraw library file: 3 reusable items."""
    items = [
        {
            "id": f"lib-item-{i:02d}",
            "status": "published",
            "name": name,
            "created": FIXED_TS_MS,
            "elements": elements,
        }
        for i, (name, elements) in enumerate([
            ("Note", [rect(101, 0, 0, 160, 80, bg="#fff3bf"),
                      text(102, 30, 25, 100, 30, "note")]),
            ("Card", [rect(201, 0, 0, 200, 120, bg="#a5d8ff"),
                      text(202, 30, 50, 140, 30, "card")]),
            ("Stopper", [diamond(301, 0, 0, 120, 120, bg="#ffc9c9"),
                         text(302, 30, 50, 60, 30, "stop")]),
        ], start=1)
    ]
    return {
        "type": "excalidrawlib",
        "version": 2,
        "source": EXPORT_SOURCE,
        "libraryItems": items,
    }


# -----------------------------------------------------------------------------
# SVG export with embedded scene
# -----------------------------------------------------------------------------

SVG_NS = "http://www.w3.org/2000/svg"
SVG_HEADER = f'<svg xmlns="{SVG_NS}" version="1.1" '


def _xml_escape(s: str) -> str:
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;")
             .replace('"', "&quot;"))


def _svg_for_element(el: dict[str, Any]) -> str:
    """Best-effort SVG rendering of an Excalidraw element (visual fidelity
    is intentionally rough; the embedded scene is the source of truth)."""
    t = el["type"]
    x, y, w, h = el["x"], el["y"], el["width"], el["height"]
    stroke = el["strokeColor"]
    fill = el["backgroundColor"] if el["backgroundColor"] != "transparent" else "none"
    sw = el["strokeWidth"]
    if t == "rectangle":
        return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" ry="6" '
                f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
    if t == "ellipse":
        cx, cy = x + w / 2, y + h / 2
        return (f'<ellipse cx="{cx}" cy="{cy}" rx="{w/2}" ry="{h/2}" '
                f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
    if t == "diamond":
        cx, cy = x + w / 2, y + h / 2
        pts = f"{cx},{y} {x+w},{cy} {cx},{y+h} {x},{cy}"
        return (f'<polygon points="{pts}" fill="{fill}" '
                f'stroke="{stroke}" stroke-width="{sw}"/>')
    if t == "text":
        cx, cy = x + w / 2, y + h / 2 + el.get("fontSize", 20) / 3
        fs = el.get("fontSize", 20)
        return (f'<text x="{cx}" y="{cy}" font-family="Virgil, Comic Sans MS, cursive" '
                f'font-size="{fs}" text-anchor="middle" fill="{stroke}">'
                f'{_xml_escape(el.get("text", ""))}</text>')
    if t == "arrow":
        pts = el.get("points") or []
        if len(pts) < 2:
            return ""
        # Polyline + simple arrowhead at the last point.
        path_pts = " ".join(f"{x+px},{y+py}" for px, py in pts)
        ax, ay = x + pts[-1][0], y + pts[-1][1]
        bx, by = x + pts[-2][0], y + pts[-2][1]
        # Compute arrowhead lines.
        dx, dy = ax - bx, ay - by
        length = (dx * dx + dy * dy) ** 0.5 or 1
        ux, uy = dx / length, dy / length
        # Perpendicular.
        px, py = -uy, ux
        head = 10
        h1x, h1y = ax - ux * head + px * head / 2, ay - uy * head + py * head / 2
        h2x, h2y = ax - ux * head - px * head / 2, ay - uy * head - py * head / 2
        return (f'<polyline points="{path_pts}" fill="none" stroke="{stroke}" '
                f'stroke-width="{sw}" stroke-linecap="round"/>'
                f'<polyline points="{h1x:.1f},{h1y:.1f} {ax},{ay} {h2x:.1f},{h2y:.1f}" '
                f'fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round"/>')
    return ""


def render_svg_with_payload(scene_json: dict[str, Any], *, padding: int = 40) -> str:
    """Render an SVG that visually represents the scene + embeds the
    canonical scene JSON via the Excalidraw payload-comment markers.

    The embedded payload uses the uncompressed Format B shape: the
    base64-decoded text is the scene JSON itself, top-level
    `type === "excalidraw"`. Excalidraw's `decodeSvgBase64Payload`
    returns it unchanged in that case (no pako needed).
    """
    elements = scene_json["elements"]
    # Bounds.
    if elements:
        xs1 = [e["x"] for e in elements]
        ys1 = [e["y"] for e in elements]
        xs2 = [e["x"] + e["width"] for e in elements]
        ys2 = [e["y"] + e["height"] for e in elements]
        min_x, min_y = min(xs1), min(ys1)
        max_x, max_y = max(xs2), max(ys2)
    else:
        min_x = min_y = 0
        max_x, max_y = 400, 200
    width = (max_x - min_x) + 2 * padding
    height = (max_y - min_y) + 2 * padding
    bg = scene_json.get("appState", {}).get("viewBackgroundColor", "#ffffff")

    body = "\n".join(f"  {_svg_for_element(el)}" for el in elements if not el.get("isDeleted"))

    payload_json = json.dumps(scene_json, separators=(",", ":"), ensure_ascii=False)
    payload_b64 = base64.b64encode(payload_json.encode("utf-8")).decode("ascii")

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="{SVG_NS}" version="1.1" '
        f'viewBox="{min_x - padding} {min_y - padding} {width} {height}" '
        f'width="{width}" height="{height}">\n'
        '  <!-- svg-source:excalidraw -->\n'
        '  <metadata>\n'
        f'    <!-- payload-type:application/vnd.excalidraw+json -->'
        f'<!-- payload-version:2 -->'
        f'<!-- payload-start -->{payload_b64}<!-- payload-end -->\n'
        '  </metadata>\n'
        f'  <rect x="{min_x - padding}" y="{min_y - padding}" '
        f'width="{width}" height="{height}" fill="{bg}"/>\n'
        f'{body}\n'
        '</svg>\n'
    )


# -----------------------------------------------------------------------------
# PNG export with embedded scene (tEXt chunk)
# -----------------------------------------------------------------------------

def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def _make_png_with_scene(scene_json: dict[str, Any], *, width: int = 400, height: int = 240) -> bytes:
    """Build a small valid RGBA PNG with a `tEXt` chunk holding the scene
    JSON keyed by `application/vnd.excalidraw+json` (Format B)."""
    # Background colour from scene appState (best-effort).
    appstate_bg = scene_json.get("appState", {}).get("viewBackgroundColor") or "#ffffff"

    def _hex_to_rgba(c: str) -> tuple[int, int, int, int]:
        c = c.lstrip("#")
        if len(c) == 3:
            c = "".join(ch * 2 for ch in c)
        if len(c) != 6:
            return (255, 255, 255, 255)
        return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), 255)

    bg = _hex_to_rgba(appstate_bg)

    # Pixel grid: bg + a couple of soft watermark stripes + a thin
    # 1-px frame so the PNG isn't a flat colour. Visual fidelity isn't
    # the goal ΓÇö the embed is.
    rows: list[bytes] = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            on_frame = x == 0 or y == 0 or x == width - 1 or y == height - 1
            band = (y // 24) % 2 == 0
            if on_frame:
                row.extend((30, 30, 30, 255))
            elif band:
                # Slightly tinted band for visible texture.
                row.extend((max(0, bg[0] - 12), max(0, bg[1] - 12),
                            max(0, bg[2] - 12), 255))
            else:
                row.extend(bg)
        rows.append(bytes(row))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    raw = b"".join(b"\x00" + r for r in rows)
    idat = zlib.compress(raw, 9)

    keyword = b"application/vnd.excalidraw+json"
    payload = json.dumps(scene_json, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    text_chunk_data = keyword + b"\x00" + payload  # tEXt format: keyword \0 text

    return (
        sig
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"tEXt", text_chunk_data)
        + _png_chunk(b"IDAT", idat)
        + _png_chunk(b"IEND", b"")
    )


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    s_shapes = shapes_scene()
    s_flow = flowchart_scene()
    lib = library_doc()

    # Canonical JSON files ΓÇö human-readable, 2-space indent.
    (OUT / "1-shapes.excalidraw").write_text(
        json.dumps(s_shapes, indent=2) + "\n", encoding="utf-8"
    )
    (OUT / "2-flowchart.excalidraw").write_text(
        json.dumps(s_flow, indent=2) + "\n", encoding="utf-8"
    )
    (OUT / "3-icons.excalidrawlib").write_text(
        json.dumps(lib, indent=2) + "\n", encoding="utf-8"
    )

    # Image variants ΓÇö real bytes + embedded scene.
    (OUT / "4-shapes.excalidraw.svg").write_text(
        render_svg_with_payload(s_shapes), encoding="utf-8"
    )
    (OUT / "5-shapes.excalidraw.png").write_bytes(
        _make_png_with_scene(s_shapes)
    )

    files = sorted(OUT.glob("*"))
    print(f"wrote {len(files)} fixture(s) to {OUT.relative_to(ROOT)}:")
    for f in files:
        print(f"  {f.name}  ({f.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
