import type { MouseEvent } from "react";

interface Props {
  /** Unresolved-thread count on this line/block. Renders nothing if 0. */
  count: number;
  /** Click handler — typically emits `comment-flash` for the anchored line. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Extra className appended to the base `comment-marker`. */
  className?: string;
}

// Word-style speech bubble glyph (single path). `id="m-bubble"` is referenced
// from the second instance below in the stacked variant via `xlink:href`-style
// reuse — but inlined directly to keep the icon self-contained per surface.
function Bubble() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 2.5h10A1.5 1.5 0 0 1 14.5 4v6A1.5 1.5 0 0 1 13 11.5H7.5l-3.1 2.7a.5.5 0 0 1-.83-.38V11.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5z" />
    </svg>
  );
}

/**
 * Bare blue speech-bubble marker rendered in the gutter of source/markdown
 * views when a line/block has unresolved comment threads.
 *
 * - One bubble for `count === 1`
 * - Two stacked bubbles for `count >= 2`
 *
 * Intentionally a bare glyph — no chip, no border, no halo. Click is the
 * caller's responsibility (typically: emit a `comment-flash` event for the
 * matching line so the panel scrolls + flashes the same threads).
 */
export function CommentMarker({ count, onClick, className }: Props) {
  if (count <= 0) return null;
  const stacked = count >= 2;
  const label = count === 1 ? "1 comment" : `${count} comments`;
  const cls = `comment-marker${stacked ? " comment-marker--stacked" : ""}${className ? ` ${className}` : ""}`;
  return (
    <button type="button" className={cls} onClick={onClick} aria-label={label} title={label}>
      {stacked && (
        <span className="comment-marker-back" aria-hidden="true">
          <Bubble />
        </span>
      )}
      <span className="comment-marker-front">
        <Bubble />
      </span>
    </button>
  );
}
