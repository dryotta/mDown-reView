import { useEffect } from "react";

export function useScrollToLine(
  containerRef: React.RefObject<HTMLElement | null>,
  lineAttribute: string,
  lineTransform?: (line: number) => string | number,
  onScrollTo?: (line: number) => void,
) {
  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent).detail.line;
      const attrValue = lineTransform ? lineTransform(line) : line;
      const el = containerRef.current?.querySelector(`[${lineAttribute}="${attrValue}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("comment-flash");
        setTimeout(() => el.classList.remove("comment-flash"), 1500);
      }
      onScrollTo?.(line);
    };
    window.addEventListener("scroll-to-line", handler);
    return () => window.removeEventListener("scroll-to-line", handler);
  }, [containerRef, lineAttribute, lineTransform, onScrollTo]);
}
