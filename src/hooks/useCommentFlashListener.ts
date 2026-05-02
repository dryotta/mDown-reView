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
 */
export function useCommentFlashListener(
  filePath: string,
  bodyRef: React.RefObject<HTMLElement | null>,
  options?: { selector?: (line: number) => string }
): void {
  // Hold the latest selector in a ref so a fresh closure each render
  // doesn't tear down + re-subscribe the window listener every commit.
  // The ref is updated *after* render via useEffect so we never write
  // during render (React rule: no ref mutations in the render body).
  const selectorRef = useRef<((line: number) => string) | undefined>(options?.selector);
  useEffect(() => {
    selectorRef.current = options?.selector;
  });

  useEffect(() => {
    return onCommentFlash((detail) => {
      if (detail.filePath !== filePath) return;
      const root = bodyRef.current;
      if (!root) return;
      const selector =
        selectorRef.current ?? ((line: number) => `[data-source-line="${line}"]`);
      switch (detail.kind) {
        case "file":
        case "unmatched":
          // No body element to flash — owned by the panel/toolbar.
          return;
        case "line": {
          const el = root.querySelector(selector(detail.line)) as HTMLElement | null;
          if (el) flashElement(el);
          return;
        }
        case "range": {
          for (let ln = detail.line; ln <= detail.endLine; ln++) {
            const el = root.querySelector(selector(ln)) as HTMLElement | null;
            if (el) flashElement(el);
          }
          return;
        }
        default:
          assertNeverFlashKind(detail);
      }
    });
  }, [filePath, bodyRef]);
}
