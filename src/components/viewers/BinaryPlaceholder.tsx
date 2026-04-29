import { type ReactNode } from "react";
import { basename } from "@/lib/path-utils";
import {
  getBinaryIconCategory,
  getMimeHint,
  formatBytes,
  type BinaryIconCategory,
} from "@/lib/file-types";

interface Props {
  path: string;
  /** File size in bytes. */
  size?: number;
  /** Last-modified time as epoch milliseconds; row is omitted when null/undefined. */
  mtime?: number | null;
}

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

/**
 * Pure metadata display for binary files. All actions (hex toggle, copy path,
 * reveal in folder) surface through the ViewerToolbar mounted by
 * BinaryViewerShell — the body is content/metadata only.
 */
export function BinaryPlaceholder({ path, size, mtime }: Props) {
  const name = basename(path);
  const category = getBinaryIconCategory(path);
  const mime = getMimeHint(path);

  return (
    <div className="viewer-placeholder">
      <FileIcon category={category} />
      <p className="binary-filename">{name}</p>
      <p className="binary-mime">{mime}</p>
      {mtime != null && (
        <p className="binary-mtime" data-testid="binary-mtime">
          {new Date(mtime).toLocaleString()}
        </p>
      )}
      {size !== undefined && (
        <p className="binary-size">{formatBytes(size)}</p>
      )}
    </div>
  );
}
