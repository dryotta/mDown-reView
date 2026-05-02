import { useEffect, useRef } from "react";
import {
  assertNeverFlashKind,
  flashElement,
  onCommentFlash,
} from "@/lib/comment-flash";

/**
 * Body-side listener for cross-surface comment-flash events. Both
 * `MarkdownViewer` and `SourceView` use this hook to keep their flash
 * behaviour in lock-step (and to keep MarkdownViewer under the 400-line
 * architecture rule 23 cap).
 *
 * Behaviour by `detail.kind`:
 *   - `file` / `unmatched`: no-op — body has no DOM element to flash;
 *     the toolbar pill (file-level) and the panel row (commentId lookup)
 *     own those highlights.
 *   - `line`:  flash the single matching element.
 *   - `range`: fan out from `detail.line` to `detail.endLine` inclusive.
 *
 * Selector defaults to `[data-source-line="${line}"]` (MarkdownViewer's
 * convention). `SourceView` passes a custom selector that targets its
 * 0-indexed `[data-line-idx="${line - 1}"]` rows.
 *
 * **Iter 2 of #252 — virtualised viewers**: SourceView's row may be
 * outside the rendered window. Pass `onMissingElement(line)` returning
 * `true` to drive the virtualiser's `scrollToIndex(...)` and re-query
 * the selector after a frame; returning `false` drops the flash silently
 * (matches the pre-virtualisation behaviour for collapsed-fold targets).
 */
export function useCommentFlashListener(
  filePath: string,
  bodyRef: React.RefObject<HTMLElement | null>,
  options?: {
    selector?: (line: number) => string;
    onMissingElement?: (line: number) => boolean;
  }
): void {
  // Hold the latest selector + onMissingElement in refs so a fresh
  // closure each render doesn't tear down + re-subscribe the window
  // listener every commit. Refs are updated *after* render via useEffect
  // so we never write during render (React rule: no ref mutations in
  // the render body).
  const selectorRef = useRef<((line: number) => string) | undefined>(options?.selector);
  const onMissingRef = useRef<((line: number) => boolean) | undefined>(
    options?.onMissingElement,
  );
  useEffect(() => {
    selectorRef.current = options?.selector;
    onMissingRef.current = options?.onMissingElement;
  });

  useEffect(() => {
    return onCommentFlash((detail) => {
      if (detail.filePath !== filePath) return;
      const root = bodyRef.current;
      if (!root) return;
      const selector =
        selectorRef.current ?? ((line: number) => `[data-source-line="${line}"]`);

      function flashLineWithRetry(line: number) {
        const el = root!.querySelector(selector(line)) as HTMLElement | null;
        if (el) {
          flashElement(el);
          return;
        }
        const onMissing = onMissingRef.current;
        if (!onMissing || !onMissing(line)) return;
        // The override claimed the lookup (e.g. virtualiser scrolled into
        // range). Re-query across up to FLASH_RETRY_FRAMES frames so React
        // has time to mount the newly-visible row before flashElement.
        // The bounded loop matches the scroll-restore retry pattern in
        // ViewerRouter and SourceView (#252 iter 2 — virtualizer
        // measurement + commit can take 2-3 frames before a far-off-screen
        // row exists in the DOM).
        const FLASH_RETRY_FRAMES = 5;
        let remaining = FLASH_RETRY_FRAMES;
        const attempt = () => {
          remaining--;
          const found = root!.querySelector(selector(line)) as HTMLElement | null;
          if (found) {
            flashElement(found);
            return;
          }
          if (remaining > 0) requestAnimationFrame(attempt);
        };
        requestAnimationFrame(attempt);
      }

      switch (detail.kind) {
        case "file":
        case "unmatched":
          // No body element to flash — owned by the panel/toolbar.
          return;
        case "line": {
          flashLineWithRetry(detail.line);
          return;
        }
        case "range": {
          // Fan out across [line, endLine] inclusive. Range size is bounded
          // by the file's line count (10 MB cap upstream); typical authored
          // ranges are single-line to small-paragraph. Body and panel
          // listeners process the same span so user-perceived flash
          // behaviour is symmetric across surfaces.
          for (let ln = detail.line; ln <= detail.endLine; ln++) {
            flashLineWithRetry(ln);
          }
          return;
        }
        default:
          assertNeverFlashKind(detail);
      }
    });
  }, [filePath, bodyRef]);
}
