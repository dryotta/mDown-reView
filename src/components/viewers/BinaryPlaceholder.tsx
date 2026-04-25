import { useState, type ReactNode } from "react";
import { basename } from "@/lib/path-utils";
import {
  getBinaryIconCategory,
  getMimeHint,
  formatBytes,
  type BinaryIconCategory,
} from "@/lib/file-types";
import {
  copyToClipboard,
  openInDefaultApp,
  revealInFolder,
} from "@/lib/tauri-commands";
import { warn } from "@/logger";
import { HexView } from "./HexView";

interface Props {
  path: string;
  /** File size in bytes; gates the "Show as hex" toggle (≥ 1 MB → disabled). */
  size?: number;
}

/** Hex view is gated to keep memory + render cost predictable. */
const HEX_MAX_BYTES = 1024 * 1024;

// ── Inline SVG icon map ───────────────────────────────────────────────────
// Tiny pictograms keyed by `getBinaryIconCategory`. Each is a 24×24 stroke-
// only SVG so it inherits `currentColor` from the surrounding text.
const ICON_PATHS: Record<BinaryIconCategory, ReactNode> = {
  archive: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M12 7v2M12 11v2M12 15v2" />
    </>
  ),
  audio: (
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="14" height="12" rx="2" />
      <path d="M17 10l4-2v8l-4-2z" />
    </>
  ),
  pdf: (
    <>
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v6h6" />
      <path d="M9 14h6M9 17h4" />
    </>
  ),
  font: (
    <>
      <path d="M5 20l5-14h4l5 14M7.5 15h9" />
    </>
  ),
  exe: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M7 14l2 2-2 2M11 18h6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  other: (
    <>
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v6h6" />
    </>
  ),
};

function FileIcon({ category }: { category: BinaryIconCategory }) {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid={`binary-icon-${category}`}
    >
      {ICON_PATHS[category]}
    </svg>
  );
}

export function BinaryPlaceholder({ path, size }: Props) {
  const [showHex, setShowHex] = useState(false);
  const name = basename(path);
  const category = getBinaryIconCategory(path);
  const mime = getMimeHint(path);
  const sizeOk = size !== undefined && size < HEX_MAX_BYTES;

  const handleOpen = () => {
    void openInDefaultApp(path).catch((e) =>
      warn(`openInDefaultApp failed: ${String(e)}`),
    );
  };
  const handleReveal = () => {
    void revealInFolder(path).catch((e) =>
      warn(`revealInFolder failed: ${String(e)}`),
    );
  };
  const handleCopy = () => {
    // navigator.clipboard for renderer-only fallback; the Tauri plugin wrapper
    // covers the desktop path. Try the plugin first (matches link-copy UX).
    void copyToClipboard(path).catch((e) =>
      warn(`copyToClipboard failed: ${String(e)}`),
    );
  };

  if (showHex) {
    return (
      <div className="binary-placeholder binary-placeholder--hex">
        <div className="binary-placeholder__header">
          <span className="binary-filename">{name}</span>
          <button type="button" onClick={() => setShowHex(false)}>
            ← Back
          </button>
        </div>
        <HexView path={path} />
      </div>
    );
  }

  return (
    <div className="binary-placeholder">
      <FileIcon category={category} />
      <p className="binary-filename">{name}</p>
      <p className="binary-mime">{mime}</p>
      {size !== undefined && (
        <p className="binary-size">{formatBytes(size)}</p>
      )}
      <div className="binary-actions">
        <button type="button" onClick={handleOpen}>
          Open in default app
        </button>
        <button type="button" onClick={handleReveal}>
          Reveal in folder
        </button>
        <button type="button" onClick={handleCopy}>
          Copy path
        </button>
        <button
          type="button"
          onClick={() => setShowHex(true)}
          disabled={!sizeOk}
          title={
            sizeOk
              ? "Render the first bytes as hex"
              : "Hex view is disabled for files ≥ 1 MB"
          }
        >
          Show as hex
        </button>
      </div>
    </div>
  );
}
