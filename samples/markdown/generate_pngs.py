"""Generate small valid PNG fixtures for manual-test markdown samples.

Uses only stdlib (zlib + struct). Outputs to samples/manual-testing/images/.
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent / "images"


def write_png(path: Path, width: int, height: int, rgba_rows: list[bytes]) -> None:
    """Write a minimal RGBA PNG. rgba_rows = list of raw RGBA bytes per row, each width*4 long."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    raw = b"".join(b"\x00" + row for row in rgba_rows)  # filter byte 0 (None) per scanline
    idat = zlib.compress(raw, 9)
    iend = b""
    path.write_bytes(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", iend))


def solid_color(width: int, height: int, rgba: tuple[int, int, int, int]) -> list[bytes]:
    pixel = bytes(rgba)
    row = pixel * width
    return [row] * height


def gradient(width: int, height: int) -> list[bytes]:
    rows: list[bytes] = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            r = int(255 * x / max(1, width - 1))
            g = int(255 * y / max(1, height - 1))
            b = 128
            row.extend((r, g, b, 255))
        rows.append(bytes(row))
    return rows


def checkerboard(width: int, height: int, square: int = 8) -> list[bytes]:
    rows: list[bytes] = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            on = ((x // square) + (y // square)) % 2 == 0
            if on:
                row.extend((30, 30, 30, 255))
            else:
                row.extend((230, 230, 230, 255))
        rows.append(bytes(row))
    return rows


def transparent_circle(diameter: int) -> list[bytes]:
    """A ring with full transparency outside the disk — exercises alpha channel."""
    rows: list[bytes] = []
    r2 = (diameter / 2) ** 2
    cx = cy = diameter / 2
    for y in range(diameter):
        row = bytearray()
        for x in range(diameter):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            d2 = dx * dx + dy * dy
            if d2 <= r2:
                # Inside the disk — colored by polar angle.
                row.extend((90, 140, 220, 255))
            else:
                row.extend((0, 0, 0, 0))  # transparent
        rows.append(bytes(row))
    return rows


def tall_strip(width: int = 80, height: int = 600) -> list[bytes]:
    """Tall narrow PNG to test viewer scaling on extreme aspect ratios."""
    rows: list[bytes] = []
    for y in range(height):
        v = int(255 * y / max(1, height - 1))
        row = bytes((255 - v, 60, v, 255)) * width
        rows.append(row)
    return rows


def wide_strip(width: int = 600, height: int = 80) -> list[bytes]:
    rows: list[bytes] = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            v = int(255 * x / max(1, width - 1))
            g = max(0, 200 - v)
            row.extend((v, g, 100, 255))
        rows.append(bytes(row))
    return rows


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "solid-blue-200.png", 200, 200, solid_color(200, 200, (40, 80, 200, 255)))
    write_png(OUT / "gradient-300.png", 300, 200, gradient(300, 200))
    write_png(OUT / "checkerboard-160.png", 160, 160, checkerboard(160, 160, 16))
    write_png(OUT / "transparent-disk-120.png", 120, 120, transparent_circle(120))
    write_png(OUT / "tall-strip-80x600.png", 80, 600, tall_strip(80, 600))
    write_png(OUT / "wide-strip-600x80.png", 600, 80, wide_strip(600, 80))
    write_png(OUT / "tiny-16.png", 16, 16, gradient(16, 16))
    print("wrote", len(list(OUT.glob("*.png"))), "PNG files to", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
