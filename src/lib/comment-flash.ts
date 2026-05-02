// Cross-surface flash effect: clicking a marker (in either viewer) or a
// panel row triggers the same yellow→transparent fade in BOTH surfaces.
// We use a window-scoped CustomEvent rather than store state so the
// effect is purely visual — no React render churn for what is animation.
//
// Iter 3 of issue #280 promotes the previous untagged `CommentFlashDetail`
// shape to a discriminated union over `kind: "file" | "line" | "range" |
// "unmatched"`. Listeners must `switch (detail.kind)` and end the switch
// with `default: assertNeverFlashKind(detail)` — TypeScript then catches
// drift if a future kind is added without updating every listener (the
// same pattern used by `assertNeverAnchorKind` in `src/lib/anchor-derive.ts`).

import { warn as logWarn } from "@/logger";
import type { MatchedComment } from "@/lib/tauri-commands";
import { deriveAnchor } from "@/lib/anchor-derive";

/** Set of `kind` discriminants — exactly four values, no more, no fewer. */
export type CommentFlashKind = "file" | "line" | "range" | "unmatched";

/**
 * Tagged discriminated union for cross-surface flash events.
 *
 * - `file`      — file-anchored comment; the body has no DOM target, only
 *                 the panel row (looked up by `commentId`) flashes.
 * - `line`      — single-line anchor; matched line is `line` (1-indexed).
 * - `range`     — multi-line anchor; flash every line `line..endLine`
 *                 inclusive. `endLine` MUST be `>= line` (the lib clamps
 *                 violators down to `kind:"line"` and emits a warning —
 *                 see `emitCommentFlash` below).
 * - `unmatched` — comment whose anchor failed to match the current file
 *                 (orphaned / matched_line_number <= 0); only the panel
 *                 row (looked up by `commentId`) flashes.
 */
export type CommentFlashDetail =
  | { kind: "file"; filePath: string; commentId: string }
  | { kind: "line"; filePath: string; line: number; commentId?: string }
  | { kind: "range"; filePath: string; line: number; endLine: number; commentId?: string }
  | { kind: "unmatched"; filePath: string; commentId: string };

const EVENT_NAME = "comment-flash";
const FLASH_CLASS = "comment-flashing";

/**
 * Dispatch a flash event. Defensive clamp: a `kind:"range"` whose
 * `endLine < line` is a programming error upstream (the matcher should
 * never produce one). Rather than dispatching a malformed range that
 * would silently no-op the body listener's `for (ln=line; ln<=endLine)`
 * loop, we log and downgrade to `kind:"line"`.
 *
 * The warning is emitted via `logger.warn` (which prepends `[web]`); the
 * full final message is of the form:
 *   `[web] flash kind=range with end_line<line, file=<filePath>, comment_id=<id>`
 */
export function emitCommentFlash(detail: CommentFlashDetail): void {
  if (typeof window === "undefined") return;
  let dispatched: CommentFlashDetail = detail;
  if (detail.kind === "range" && detail.endLine < detail.line) {
    void logWarn(
      `flash kind=range with end_line<line, file=${detail.filePath}, comment_id=${detail.commentId ?? "?"}`
    );
    dispatched = {
      kind: "line",
      filePath: detail.filePath,
      line: detail.line,
      commentId: detail.commentId,
    };
  }
  window.dispatchEvent(new CustomEvent<CommentFlashDetail>(EVENT_NAME, { detail: dispatched }));
}

/**
 * Imperatively (re)start the CSS flash animation on `el`. Removing the
 * class, forcing a layout flush via `void el.offsetWidth`, then re-adding
 * defeats the browser's "same animation already running, no restart"
 * optimisation — so re-clicking a marker re-fires the fade every time.
 */
export function flashElement(el: HTMLElement): void {
  el.classList.remove(FLASH_CLASS);
  // Force reflow so the animation is treated as a fresh run.
  void el.offsetWidth;
  el.classList.add(FLASH_CLASS);
}

export function onCommentFlash(handler: (detail: CommentFlashDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const ce = e as CustomEvent<CommentFlashDetail>;
    if (ce.detail) handler(ce.detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

/**
 * Exhaustive-switch guard for the `CommentFlashDetail.kind` discriminator.
 * Usage: `default: assertNeverFlashKind(detail)` in switch blocks.
 * Mirrors `assertNeverAnchorKind` in `src/lib/anchor-derive.ts`.
 */
export function assertNeverFlashKind(x: never): never {
  throw new Error(`unhandled CommentFlashDetail kind: ${JSON.stringify(x)}`);
}

// ─── MatchedComment → CommentFlashDetail bridge ─────────────────────────────
// CommentsPanel emits flashes from MatchedComment objects; the viewer
// emit sites pass plain line numbers. Centralising the derivation here
// keeps the logic next to the union definition (so a future kind addition
// shows up in one place) and keeps CommentsPanel under its file budget.

/**
 * Derive the flash discriminator from a MatchedComment. Routes the
 * `kind` decision through `deriveAnchor()` (rule 31 in
 * `docs/architecture.md` — never raw `anchor_kind` string equality at
 * consumer sites; let the typed adapter own the discrimination so any
 * future Rust addition to `Anchor` surfaces as a TS error here):
 *   - `deriveAnchor(c).kind === "file"`             → "file"
 *   - `isOrphaned` / `matchedLineNumber <= 0`        → "unmatched"
 *   - `end_line > matchedLineNumber`                 → "range"
 *   - else                                            → "line"
 *
 * `original_line` is preserved on the wire by iter 1 of #280 but is not
 * load-bearing for kind selection — `matchedLineNumber` is the runtime-
 * resolved coordinate the body listener queries.
 */
export function commentFlashKindFor(comment: MatchedComment): CommentFlashKind {
  if (deriveAnchor(comment).kind === "file") return "file";
  if (comment.isOrphaned || comment.matchedLineNumber <= 0) return "unmatched";
  const endLine = comment.end_line;
  if (endLine != null && endLine > comment.matchedLineNumber) return "range";
  return "line";
}

/** Build the discriminated `CommentFlashDetail` for a panel-row click. */
export function buildFlashDetail(
  comment: MatchedComment,
  filePath: string
): CommentFlashDetail {
  const kind = commentFlashKindFor(comment);
  switch (kind) {
    case "file":
      return { kind: "file", filePath, commentId: comment.id };
    case "unmatched":
      return { kind: "unmatched", filePath, commentId: comment.id };
    case "range":
      return {
        kind: "range",
        filePath,
        line: comment.matchedLineNumber,
        endLine: comment.end_line as number,
        commentId: comment.id,
      };
    case "line":
      return {
        kind: "line",
        filePath,
        line: comment.matchedLineNumber,
        commentId: comment.id,
      };
    default:
      assertNeverFlashKind(kind);
  }
}
