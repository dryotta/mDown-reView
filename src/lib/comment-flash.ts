// Cross-surface flash effect: clicking a marker (in either viewer) or a
// panel row triggers the same yellow→transparent fade in BOTH surfaces.
// We use a window-scoped CustomEvent rather than store state so the
// effect is purely visual — no React render churn for what is animation.

export interface CommentFlashDetail {
  /** Sidecar/source file path the comment is anchored to. */
  filePath: string;
  /** Canonical (matched) line number — the line the marker targets. */
  line: number;
  /** Optional inclusive end line for multi-line anchors. */
  endLine?: number;
  /** Optional comment id; lets listeners single out a specific row. */
  commentId?: string;
}

const EVENT_NAME = "comment-flash";
const FLASH_CLASS = "comment-flashing";

export function emitCommentFlash(detail: CommentFlashDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CommentFlashDetail>(EVENT_NAME, { detail }));
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
