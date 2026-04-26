import { useEffect } from "react";
import { useStore } from "@/store";

function scrollToLineInContainer(
  container: HTMLElement | null,
  line: number,
  lineAttribute: string,
  lineTransform?: (line: number) => string | number,
): boolean {
  const attrValue = lineTransform ? lineTransform(line) : line;
  const el = container?.querySelector(`[${lineAttribute}="${attrValue}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("comment-flash");
  setTimeout(() => el.classList.remove("comment-flash"), 1500);
  return true;
}

export function useScrollToLine(
  containerRef: React.RefObject<HTMLElement | null>,
  lineAttribute: string,
  lineTransform?: (line: number) => string | number,
  onScrollTo?: (line: number) => void,
  filePath?: string,
) {
  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent).detail.line;
      scrollToLineInContainer(containerRef.current, line, lineAttribute, lineTransform);
      onScrollTo?.(line);
    };
    window.addEventListener("scroll-to-line", handler);
    return () => window.removeEventListener("scroll-to-line", handler);
  }, [containerRef, lineAttribute, lineTransform, onScrollTo]);

  // Iter 10 Group B — drain any queued cross-file scroll target. The viewer
  // mounts after CommentsPanel queues the target, so on mount (and on
  // filePath change) we consume-by-filePath. If the line element isn't in
  // the DOM yet (async file content), retry once after a frame.
  useEffect(() => {
    if (!filePath) return;
    const target = useStore.getState().consumePendingScrollTarget(filePath);
    if (!target) return;
    const tryScroll = () =>
      scrollToLineInContainer(containerRef.current, target.line, lineAttribute, lineTransform);
    if (!tryScroll()) {
      requestAnimationFrame(() => { tryScroll(); });
    }
    onScrollTo?.(target.line);
    if (target.commentId) {
      useStore.getState().setFocusedThread(target.commentId);
    }
  }, [filePath, containerRef, lineAttribute, lineTransform, onScrollTo]);
}
