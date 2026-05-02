import { useEffect } from "react";
import { useStore } from "@/store";

function scrollToLineInContainer(
  container: HTMLElement | null,
  line: number,
  lineAttribute: string,
  lineTransform?: (line: number) => string | number,
  scrollOverride?: (line: number) => boolean,
): boolean {
  // Iter 2 of #252 — `scrollOverride` lets virtualised viewers (SourceView)
  // route the scroll through their virtualizer's `scrollToIndex` API instead
  // of the DOM querySelector + `scrollIntoView` path. The override returns
  // `true` to claim the scroll; we then skip the DOM lookup. Non-virtualised
  // viewers (MarkdownViewer) leave the override unset and use the fallback.
  if (scrollOverride && scrollOverride(line)) return true;
  const attrValue = lineTransform ? lineTransform(line) : line;
  const el = container?.querySelector(`[${lineAttribute}="${attrValue}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  // The cross-surface flash is owned by `lib/comment-flash.ts` and
  // dispatched explicitly by the panel / marker click sites; keep the
  // scroll path focused on movement only so the two effects compose
  // independently.
  return true;
}

export function useScrollToLine(
  containerRef: React.RefObject<HTMLElement | null>,
  lineAttribute: string,
  lineTransform?: (line: number) => string | number,
  onScrollTo?: (line: number) => void,
  filePath?: string,
  scrollOverride?: (line: number) => boolean,
) {
  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent).detail.line;
      scrollToLineInContainer(
        containerRef.current,
        line,
        lineAttribute,
        lineTransform,
        scrollOverride,
      );
      onScrollTo?.(line);
    };
    window.addEventListener("scroll-to-line", handler);
    return () => window.removeEventListener("scroll-to-line", handler);
  }, [containerRef, lineAttribute, lineTransform, onScrollTo, scrollOverride]);

  // Iter 10 Group B — drain any queued cross-file scroll target. The viewer
  // mounts after CommentsPanel queues the target, so on mount (and on
  // filePath change) we consume-by-filePath. If the line element isn't in
  // the DOM yet (async file content), retry once after a frame.
  useEffect(() => {
    if (!filePath) return;
    const target = useStore.getState().consumePendingScrollTarget(filePath);
    if (!target) return;
    let cancelled = false;
    let rafHandle: number | null = null;
    const tryScroll = () =>
      scrollToLineInContainer(
        containerRef.current,
        target.line,
        lineAttribute,
        lineTransform,
        scrollOverride,
      );
    if (!tryScroll()) {
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null;
        if (cancelled) return;
        tryScroll();
      });
    }
    onScrollTo?.(target.line);
    if (target.commentId) {
      useStore.getState().setFocusedThread(target.commentId);
    }
    return () => {
      cancelled = true;
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    };
  }, [filePath, containerRef, lineAttribute, lineTransform, onScrollTo, scrollOverride]);
}
