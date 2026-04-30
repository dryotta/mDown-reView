"""Generate image-viewer fixtures (JPG, GIF, BMP, ICO, WebP, PNG variants).

Uses Pillow for non-trivial encoders. SVG samples are written separately
as text. Run from repo root (or any cwd):

    python samples/generate_images.py

Output: samples/images/  (10+ files across the formats mdownreview supports).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent  # repo root
OUT = ROOT / "samples" / "images"


def font(size: int) -> ImageFont.ImageFont:
    """Return a Pillow font; fall back to default if no TTF available."""
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        try:
            return ImageFont.truetype("DejaVuSans.ttf", size)
        except OSError:
            return ImageFont.load_default()


def jpeg_photo() -> Image.Image:
    """A photo-like JPEG: gradient sky + sun + noise (simulates compression artifacts)."""
    width, height = 800, 500
    img = Image.new("RGB", (width, height))
    px = img.load()
    for y in range(height):
        # Sky gradient: warm at top, cooler near horizon
        t = y / height
        r = int(255 * (1 - 0.6 * t))
        g = int(220 * (1 - 0.4 * t))
        b = int(255 * (0.5 + 0.5 * t))
        for x in range(width):
            px[x, y] = (r, g, b)
    # Sun
    draw = ImageDraw.Draw(img)
    cx, cy, sr = width * 0.7, height * 0.3, 80
    for r in range(sr, 0, -1):
        a = (sr - r) / sr
        draw.ellipse(
            (cx - r, cy - r, cx + r, cy + r),
            fill=(int(255 * (1 - 0.1 * a)), int(220 * (1 - 0.3 * a)), int(150 * (1 - 0.6 * a))),
        )
    # Soften with a slight blur to mimic JPEG-friendly content
    img = img.filter(ImageFilter.GaussianBlur(radius=1.5))
    # Add subtle noise
    noise = Image.new("RGB", (width, height))
    npx = noise.load()
    import random
    rng = random.Random(42)  # deterministic
    for y in range(height):
        for x in range(width):
            n = rng.randint(-8, 8)
            npx[x, y] = (n & 0xFF, n & 0xFF, n & 0xFF)
    img = Image.blend(img, noise, 0.05)
    return img


def png_icon_with_transparency() -> Image.Image:
    """256×256 PNG with full alpha — circle on transparent background."""
    size = 256
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Outer ring
    draw.ellipse((8, 8, size - 8, size - 8), fill=(36, 99, 235, 255))
    # Inner circle (lighter)
    draw.ellipse((40, 40, size - 40, size - 40), fill=(96, 165, 250, 255))
    # White checkmark-style strokes
    draw.line([(80, 130), (118, 168), (180, 96)], fill=(255, 255, 255, 255), width=18)
    return img


def gif_static() -> Image.Image:
    """Single-frame indexed-color GIF (palette-based)."""
    size = 200
    img = Image.new("RGB", (size, size), (40, 40, 40))
    draw = ImageDraw.Draw(img)
    palette = [
        (220, 50, 47),
        (203, 75, 22),
        (181, 137, 0),
        (133, 153, 0),
        (42, 161, 152),
        (38, 139, 210),
        (108, 113, 196),
        (211, 54, 130),
    ]
    cell = size // 4
    for i, color in enumerate(palette):
        x = (i % 4) * cell
        y = (i // 4) * cell
        draw.rectangle((x, y, x + cell - 2, y + cell - 2), fill=color)
    return img.convert("P", palette=Image.Palette.ADAPTIVE, colors=64)


def gif_animated_frames(width: int = 160, height: int = 160, frames: int = 12) -> list[Image.Image]:
    """Generate a sequence of frames showing a rotating dot for an animated GIF."""
    out: list[Image.Image] = []
    for i in range(frames):
        img = Image.new("RGB", (width, height), (15, 23, 42))
        draw = ImageDraw.Draw(img)
        # Background grid
        for k in range(0, width, 20):
            draw.line([(k, 0), (k, height)], fill=(30, 41, 59), width=1)
            draw.line([(0, k), (width, k)], fill=(30, 41, 59), width=1)
        # Rotating dot
        angle = 2 * math.pi * i / frames
        cx = width / 2 + 50 * math.cos(angle)
        cy = height / 2 + 50 * math.sin(angle)
        draw.ellipse((cx - 12, cy - 12, cx + 12, cy + 12), fill=(244, 114, 182))
        # Center dot
        draw.ellipse((width / 2 - 4, height / 2 - 4, width / 2 + 4, height / 2 + 4), fill=(148, 163, 184))
        out.append(img.convert("P", palette=Image.Palette.ADAPTIVE, colors=32))
    return out


def bmp_logo() -> Image.Image:
    """A small BMP — uncompressed, classic Windows-era format."""
    width, height = 240, 80
    img = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, width, height), outline=(30, 41, 59), width=4)
    f = font(28)
    draw.text((20, 22), "mdownreview", fill=(30, 41, 59), font=f)
    return img


def ico_favicon() -> list[Image.Image]:
    """A favicon ICO — multiple sizes packed into one file."""
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
    out: list[Image.Image] = []
    for w, h in sizes:
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        draw.ellipse((1, 1, w - 1, h - 1), fill=(37, 99, 235, 255))
        # White "M" for "markdown"
        f = font(int(h * 0.65))
        draw.text((w * 0.18, h * 0.05), "M", fill=(255, 255, 255, 255), font=f)
        out.append(img)
    return out


def webp_photo() -> Image.Image:
    """A WebP — modern format with great compression. Reuse the JPEG photo body."""
    return jpeg_photo()


def png_large() -> Image.Image:
    """A larger PNG (~1MB) — exercises the image viewer's handling of bigger files."""
    width, height = 1200, 800
    img = Image.new("RGB", (width, height))
    px = img.load()
    for y in range(height):
        for x in range(width):
            r = int(127 + 127 * math.sin(2 * math.pi * x / 200))
            g = int(127 + 127 * math.sin(2 * math.pi * y / 200))
            b = int(127 + 127 * math.sin(2 * math.pi * (x + y) / 200))
            px[x, y] = (r, g, b)
    return img


def png_one_pixel() -> Image.Image:
    """A 1×1 pixel — extreme degenerate case."""
    img = Image.new("RGBA", (1, 1), (37, 99, 235, 255))
    return img


def png_portrait() -> Image.Image:
    """A 200×500 portrait PNG."""
    img = Image.new("RGB", (200, 500))
    px = img.load()
    for y in range(500):
        for x in range(200):
            t = y / 500
            px[x, y] = (int(255 * (1 - t)), int(255 * t), 200)
    return img


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    # JPEG
    jpeg_photo().save(OUT / "01-photo.jpg", format="JPEG", quality=82, optimize=True)

    # PNG with alpha
    png_icon_with_transparency().save(OUT / "02-icon-256-alpha.png", format="PNG", optimize=True)

    # GIF — single frame
    gif_static().save(OUT / "03-palette-static.gif", format="GIF", optimize=True)

    # GIF — animated
    frames = gif_animated_frames()
    frames[0].save(
        OUT / "04-rotating-dot-animated.gif",
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        duration=80,
        loop=0,
        optimize=True,
    )

    # BMP
    bmp_logo().save(OUT / "05-logo.bmp", format="BMP")

    # ICO
    ico_imgs = ico_favicon()
    ico_imgs[-1].save(OUT / "06-favicon.ico", format="ICO", sizes=[i.size for i in ico_imgs])

    # WebP
    webp_photo().save(OUT / "07-photo.webp", format="WEBP", quality=85, method=6)

    # PNG — large
    png_large().save(OUT / "08-large-1200x800.png", format="PNG", optimize=True)

    # PNG — extreme portrait
    png_portrait().save(OUT / "09-portrait-200x500.png", format="PNG", optimize=True)

    # PNG — 1×1 pixel
    png_one_pixel().save(OUT / "10-one-pixel.png", format="PNG")

    files = sorted(OUT.glob("*"))
    print(f"wrote {len(files)} image fixture(s):")
    for f in files:
        print(f"  {f.relative_to(ROOT)}  ({f.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
