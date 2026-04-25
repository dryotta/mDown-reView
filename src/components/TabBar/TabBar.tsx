import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store";
import { useUnresolvedCounts } from "@/hooks/useUnresolvedCounts";
import "@/styles/tab-bar.css";
import { basename } from "@/lib/path-utils";

const SCROLL_STEP_PX = 200;

function TabItem({
  path,
  unresolvedCount,
  tabRef,
}: {
  path: string;
  unresolvedCount: number;
  tabRef?: (el: HTMLDivElement | null) => void;
}) {
  const activeTabPath = useStore((s) => s.activeTabPath);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const isActive = activeTabPath === path;
  const name = basename(path);

  return (
    <div
      ref={tabRef}
      className={`tab${isActive ? " active" : ""}`}
      title={path}
      onClick={() => setActiveTab(path)}
      role="tab"
      aria-selected={isActive}
    >
      <span className="tab-name">{name}</span>
      {unresolvedCount > 0 && (
        <span className="tab-badge">{unresolvedCount}</span>
      )}
      <button
        className="tab-close"
        aria-label={`Close ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          closeTab(path);
        }}
      >
        ×
      </button>
    </div>
  );
}

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabPath = useStore((s) => s.activeTabPath);
  const tabPaths = useMemo(() => tabs.map((t) => t.path), [tabs]);
  const unresolvedCounts = useUnresolvedCounts(tabPaths);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 0);
    // 1px slack to avoid flicker on sub-pixel rounding.
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  // Recompute overflow when tabs change or container resizes.
  useEffect(() => {
    updateOverflow();
    const el = scrollRef.current;
    if (!el) return;

    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    let ro: ResizeObserver | undefined;
    if (typeof RO === "function") {
      ro = new RO(() => updateOverflow());
      ro.observe(el);
    }
    window.addEventListener("resize", updateOverflow);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [updateOverflow, tabs.length]);

  // Auto-scroll active tab into view, but only when the active tab itself
  // changes — not on every tabs-array mutation. Cheap visibility check first
  // to avoid a janky scroll when the tab is already visible.
  useLayoutEffect(() => {
    if (!activeTabPath) return;
    const el = tabRefs.current.get(activeTabPath);
    const container = scrollRef.current;
    if (!el || !container) return;
    if (el.offsetParent === null) return; // not laid out / hidden

    const tabStart = el.offsetLeft;
    const tabEnd = tabStart + el.offsetWidth;
    const viewStart = container.scrollLeft;
    const viewEnd = viewStart + container.clientWidth;
    if (tabStart >= viewStart && tabEnd <= viewEnd) return; // already in view

    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "nearest", inline: "nearest" });
    }
    // updateOverflow after scroll; rAF lets layout settle first.
    requestAnimationFrame(updateOverflow);
  }, [activeTabPath, updateOverflow]);

  const scrollBy = useCallback((dx: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dx, behavior: "smooth" });
  }, []);

  if (tabs.length === 0) return null;

  const setTabRef = (path: string) => (el: HTMLDivElement | null) => {
    if (el) tabRefs.current.set(path, el);
    else tabRefs.current.delete(path);
  };

  return (
    <div className="tab-bar-wrapper">
      {canScrollLeft && (
        <button
          type="button"
          className="tab-chevron tab-chevron-left"
          aria-label="Scroll tabs left"
          onClick={() => scrollBy(-SCROLL_STEP_PX)}
        >
          ‹
        </button>
      )}
      <div
        ref={scrollRef}
        className="tab-bar"
        role="tablist"
        onScroll={updateOverflow}
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.path}
            path={tab.path}
            unresolvedCount={unresolvedCounts[tab.path] ?? 0}
            tabRef={setTabRef(tab.path)}
          />
        ))}
      </div>
      {canScrollRight && (
        <button
          type="button"
          className="tab-chevron tab-chevron-right"
          aria-label="Scroll tabs right"
          onClick={() => scrollBy(SCROLL_STEP_PX)}
        >
          ›
        </button>
      )}
    </div>
  );
}
