"""Generate small binary fixtures for samples/binary/.

Outputs:
- samples/binary/tone-440hz-1s.wav         (1 second, 440 Hz, mono, 16-bit WAV)
- samples/binary/chord-1s.wav              (1 second, A-major chord, mono WAV)
- samples/binary/archive.zip               (small ZIP with three text files)
- samples/binary/random-256.bin            (256 bytes of pseudo-random data)
- samples/binary/header-only.bin           (8-byte header — for binary placeholder)

The two .wav files are kept here (not in a separate audio/ folder) because
mdownreview no longer ships a dedicated audio viewer — audio files are
displayed in BinaryPlaceholder like any other binary blob.

All using stdlib only.
"""

from __future__ import annotations

import math
import os
import struct
import sys
import wave
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # repo root (samples/.. = repo)


def write_wave(path: Path, samples: list[int], sample_rate: int = 22050) -> None:
    """Write a 16-bit mono PCM WAV from a list of int16 samples."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(sample_rate)
        w.writeframes(b"".join(struct.pack("<h", max(-32768, min(32767, s))) for s in samples))


def sine_samples(freq_hz: float, seconds: float, sample_rate: int = 22050, amp: float = 0.4) -> list[int]:
    n = int(seconds * sample_rate)
    return [int(amp * 32767 * math.sin(2 * math.pi * freq_hz * i / sample_rate)) for i in range(n)]


def chord_samples(freqs: list[float], seconds: float, sample_rate: int = 22050, amp: float = 0.3) -> list[int]:
    n = int(seconds * sample_rate)
    out: list[int] = []
    for i in range(n):
        v = sum(math.sin(2 * math.pi * f * i / sample_rate) for f in freqs)
        out.append(int(amp * 32767 * v / max(1, len(freqs))))
    return out


def main() -> int:
    binary = ROOT / "samples" / "binary"
    binary.mkdir(parents=True, exist_ok=True)

    # 1-second 440Hz tone (concert A) — exercises the audio icon in BinaryPlaceholder
    write_wave(binary / "tone-440hz-1s.wav", sine_samples(440, 1.0))

    # 1-second A-major chord (A4 + C#5 + E5)
    write_wave(binary / "chord-1s.wav", chord_samples([440.0, 554.37, 659.25], 1.0))

    # Small ZIP with three text files
    zip_path = binary / "archive.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "readme.txt",
            "This is a sample ZIP archive used by mdownreview's BinaryPlaceholder fixture.\n",
        )
        z.writestr("data/numbers.txt", "1\n2\n3\n4\n5\n")
        z.writestr("data/greeting.txt", "Hello from inside the ZIP!\n")

    # Pseudo-random binary blob (deterministic seed → reproducible)
    rng = bytes((i * 73 + 5) & 0xFF for i in range(256))
    (binary / "random-256.bin").write_bytes(rng)

    # An 8-byte file with a recognizable header (no extension recognition).
    (binary / "header-only.bin").write_bytes(b"\x7fELF\x02\x01\x01\x00")

    files = list(binary.glob("*"))
    print(f"wrote {len(files)} fixture(s):")
    for f in sorted(files):
        size = f.stat().st_size
        print(f"  {f.relative_to(ROOT)}  ({size} bytes)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
