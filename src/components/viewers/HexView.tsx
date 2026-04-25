import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { readBinaryFile } from "@/lib/tauri-commands";
import { warn } from "@/logger";

interface Props {
  path: string;
}

const ROW_HEIGHT = 18; // px — fixed so virtualization math is trivial
const BYTES_PER_ROW = 16;
const OVERSCAN_ROWS = 8;
const VIRTUALIZE_THRESHOLD = 32 * 1024; // bytes; smaller files render in full

/** Decode a base64 string returned by `read_binary_file` into a Uint8Array. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Lookup table: byte → 2-char uppercase hex. Built once per module. */
const HEX_TABLE: string[] = (() => {
  const t = new Array<string>(256);
  for (let i = 0; i < 256; i++) t[i] = i.toString(16).toUpperCase().padStart(2, "0");
  return t;
})();

/** Format an 8-digit big-endian offset, uppercase. Exported for tests. */
export function formatOffset(n: number): string {
  return n.toString(16).toUpperCase().padStart(8, "0");
}

/** Render bytes 0..15 of a row to a hex pair string ("48 65 6C 6C ..."). */
export function rowHex(bytes: Uint8Array, start: number): string {
  const end = Math.min(start + BYTES_PER_ROW, bytes.length);
  const parts: string[] = [];
  for (let i = start; i < end; i++) parts.push(HEX_TABLE[bytes[i]]);
  return parts.join(" ");
}

/** Map non-printable / non-ASCII bytes to '.' for the gutter. */
export function rowAscii(bytes: Uint8Array, start: number): string {
  const end = Math.min(start + BYTES_PER_ROW, bytes.length);
  let out = "";
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
  }
  return out;
}

export function HexView({ path }: Props) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);

  // R3 — relies on `key={path}` at the parent (BinaryPlaceholder/ViewerRouter)
  // to remount this component on path change, so an explicit
  // `setBytes(null)` reset effect is no longer required.
  useEffect(() => {
    let cancelled = false;
    readBinaryFile(path)
      .then((b64) => {
        if (cancelled) return;
        try {
          setBytes(base64ToBytes(b64));
        } catch (e) {
          warn(`HexView decode error: ${String(e)}`);
          setError("decode_failed");
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Track viewport height so virtualization renders just the visible window.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setViewportHeight(el.clientHeight || 400);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalRows = bytes ? Math.ceil(bytes.length / BYTES_PER_ROW) : 0;
  const virtualize = bytes ? bytes.length >= VIRTUALIZE_THRESHOLD : false;

  const { firstRow, lastRow } = useMemo(() => {
    if (!virtualize) return { firstRow: 0, lastRow: totalRows };
    const visibleRows = Math.ceil(viewportHeight / ROW_HEIGHT);
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
    const last = Math.min(totalRows, first + visibleRows + OVERSCAN_ROWS * 2);
    return { firstRow: first, lastRow: last };
  }, [virtualize, scrollTop, viewportHeight, totalRows]);

  if (error) {
    return (
      <div className="hex-view hex-view--error">
        Error loading binary: {error}
      </div>
    );
  }
  if (!bytes) {
    return <div className="hex-view hex-view--loading">Loading…</div>;
  }

  const rows: ReactElement[] = [];
  for (let r = firstRow; r < lastRow; r++) {
    const offset = r * BYTES_PER_ROW;
    rows.push(
      <div
        key={r}
        className="hex-row"
        style={{
          position: virtualize ? "absolute" : "static",
          top: virtualize ? r * ROW_HEIGHT : undefined,
          height: ROW_HEIGHT,
          lineHeight: `${ROW_HEIGHT}px`,
        }}
        data-row={r}
      >
        <span className="hex-offset">{formatOffset(offset)}</span>
        <span className="hex-bytes">{rowHex(bytes, offset)}</span>
        <span className="hex-ascii">{rowAscii(bytes, offset)}</span>
      </div>,
    );
  }

  return (
    <div
      ref={containerRef}
      className="hex-view"
      style={{ overflow: "auto", height: "100%", fontFamily: "monospace" }}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      data-testid="hex-view"
    >
      <div
        style={{
          position: "relative",
          height: virtualize ? totalRows * ROW_HEIGHT : "auto",
        }}
      >
        {rows}
      </div>
    </div>
  );
}
