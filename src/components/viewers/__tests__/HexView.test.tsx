import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");
vi.mock("@/lib/tauri-commands", () => ({
  readBinaryFile: vi.fn(),
}));

import { readBinaryFile } from "@/lib/tauri-commands";
import { HexView, formatOffset, rowHex, rowAscii } from "../HexView";

const readMock = readBinaryFile as ReturnType<typeof vi.fn>;

/** "ABCDEFGHIJKLMNOP" + "0123456789abcdef" + "Hello, hex!\x00\x01\x02\xff..."
 *  64 bytes total — covers four 16-byte rows with both printable and non-
 *  printable content. */
function makeFixture(): Uint8Array {
  const text = "ABCDEFGHIJKLMNOP0123456789abcdef";
  const printable = new TextEncoder().encode(text);
  const tail = new Uint8Array([
    0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x2c, 0x20, 0x68, // "Hello, h"
    0x65, 0x78, 0x21, 0x00, 0x01, 0x02, 0xff, 0x7f, // "ex!" + non-printables
    0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0, // all non-printable
    0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, // " !"#$%&'"
  ]);
  const out = new Uint8Array(64);
  out.set(printable, 0);
  out.set(tail, 32);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

beforeEach(() => {
  readMock.mockReset();
});

describe("HexView — pure helpers", () => {
  it("formatOffset pads to 8 uppercase hex digits", () => {
    expect(formatOffset(0)).toBe("00000000");
    expect(formatOffset(16)).toBe("00000010");
    expect(formatOffset(0xdeadbeef)).toBe("DEADBEEF");
  });

  it("rowHex emits 16 space-separated uppercase pairs", () => {
    const bytes = makeFixture();
    const hex = rowHex(bytes, 0);
    expect(hex.split(" ")).toHaveLength(16);
    expect(hex.startsWith("41 42 43 44")).toBe(true); // "ABCD"
  });

  it("rowAscii maps printable ASCII verbatim and non-printable to '.'", () => {
    const bytes = makeFixture();
    expect(rowAscii(bytes, 0)).toBe("ABCDEFGHIJKLMNOP");
    expect(rowAscii(bytes, 16)).toBe("0123456789abcdef");
    // Row 2: "Hello, h" + "ex!" + 4 non-printables + 1 (0x7f → non-printable).
    expect(rowAscii(bytes, 32)).toBe("Hello, hex!.....");
  });

  it("rowAscii handles partial trailing rows", () => {
    const bytes = new Uint8Array([0x41, 0x42, 0x43]); // "ABC"
    expect(rowAscii(bytes, 0)).toBe("ABC");
    expect(rowHex(bytes, 0).split(" ")).toHaveLength(3);
  });
});

describe("HexView — rendering", () => {
  it("renders 4 rows for a 64-byte fixture with offsets incrementing by 16", async () => {
    readMock.mockResolvedValueOnce(bytesToBase64(makeFixture()));
    render(<HexView path="/ws/x.bin" />);
    await waitFor(() => {
      expect(screen.getByTestId("hex-view")).toBeInTheDocument();
    });
    const rows = document.querySelectorAll(".hex-row");
    expect(rows).toHaveLength(4);
    const offsets = Array.from(document.querySelectorAll(".hex-offset")).map(
      (n) => n.textContent,
    );
    expect(offsets).toEqual([
      "00000000",
      "00000010",
      "00000020",
      "00000030",
    ]);
  });

  it("renders the loading state before bytes resolve", () => {
    readMock.mockReturnValueOnce(new Promise(() => {}));
    render(<HexView path="/ws/loading.bin" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows an error state when read fails", async () => {
    readMock.mockRejectedValueOnce(new Error("boom"));
    render(<HexView path="/ws/bad.bin" />);
    await waitFor(() => {
      expect(screen.getByText(/error loading binary/i)).toBeInTheDocument();
    });
  });
});
