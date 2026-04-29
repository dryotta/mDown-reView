import { useCallback, useDeferredValue, useEffect, useRef, useState, type RefObject } from "react";
import { findRangesInContainer } from "@/lib/find-in-page";
import { info } from "@/logger";

/**
 * #65 G1 — Ctrl+F find-in-page. Uses the CSS Custom Highlight API
 * (`CSS.highlights` + `new Highlight(...ranges)`) to paint matches WITHOUT
 * mutating the DOM. react-markdown re-renders blow away DOM `<mark>`
 * wrappers, so we hold Range objects in JS and let the browser paint via
 * `::highlight(find-hit)`. (docs/design-patterns.md rule 1: hooks are wires,
 * not state owners.)
 *
 * Hard cap of 1000 matches; beyond that we log once via `@/logger` `info`
 * and stop accumulating. jsdom does not implement the Highlight API → the hook
 * degrades to a no-op in unit tests so they don't crash.
 */
export const FIND_HIT_KEY = "find-hit";
export const FIND_HIT_CURRENT_KEY = "find-hit-current";
export const MAX_FIND_MATCHES = 1000;

export interface FindInPageState {
  /** Whether the find bar is open. */
  open: boolean;
  /** Live query text (immediate). */
  query: string;
  /** Total match count (capped at {@link MAX_FIND_MATCHES}). */
  matches: number;
  /** Active match index (0-based), or -1 when matches===0. */
  current: number;
  setQuery: (q: string) => void;
  next: () => void;
  prev: () => void;
  /** Open the find bar. */
  openBar: () => void;
  /** Close the find bar and clear all painted highlights. */
  close: () => void;
}

type HighlightCtor = new (...ranges: Range[]) => object;
interface HighlightRegistry {
  set(key: string, value: object): void;
  delete(key: string): boolean;
  clear(): void;
  readonly size?: number;
}

function getHighlightApi(): { Ctor: HighlightCtor; registry: HighlightRegistry } | null {
  if (typeof CSS === "undefined") return null;
  const css = CSS as unknown as { highlights?: HighlightRegistry };
  const g = globalThis as unknown as { Highlight?: HighlightCtor };
  if (!css.highlights || typeof g.Highlight !== "function") return null;
  return { Ctor: g.Highlight, registry: css.highlights };
}

function clearHighlights(): void {
  const api = getHighlightApi();
  if (!api) return;
  api.registry.delete(FIND_HIT_KEY);
  api.registry.delete(FIND_HIT_CURRENT_KEY);
}

export function useFindInPage(
  containerRef: RefObject<HTMLElement | null>,
  contentSignature: string | number
): FindInPageState {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState(0);
  const [current, setCurrent] = useState(-1);
  // Keep the live Range[] outside React state — Range objects are mutable
  // host objects; storing them in setState would tempt re-renders we
  // don't need. (docs/design-patterns.md rule 1.)
  const rangesRef = useRef<Range[]>([]);

  const deferredQuery = useDeferredValue(query);

  const openBar = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    setOpen(false);
    rangesRef.current = [];
    setMatches(0);
    setCurrent(-1);
    clearHighlights();
  }, []);

  // Re-walk the container whenever the bar is open and either the query or
  // the rendered content changes. Cleared synchronously when the bar
  // closes (handled in `close()`).
  useEffect(() => {
    const api = getHighlightApi();
    if (!api) {
      // jsdom / older WebViews — degrade to no-op.
      rangesRef.current = [];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- jsdom guard reset
      setMatches(0);
      setCurrent(-1);
      return;
    }
    const container = containerRef.current;
    if (!open || !deferredQuery || !container) {
      rangesRef.current = [];
      setMatches(0);
      setCurrent(-1);
      api.registry.delete(FIND_HIT_KEY);
      api.registry.delete(FIND_HIT_CURRENT_KEY);
      return;
    }

    const found = findRangesInContainer(container, deferredQuery, MAX_FIND_MATCHES);
    if (found.length >= MAX_FIND_MATCHES) {
      void info(`useFindInPage: match cap reached (${MAX_FIND_MATCHES}); refine your query`); // fire-and-forget log inside sync effect
    }
    rangesRef.current = found;
    setMatches(found.length);
    setCurrent(found.length === 0 ? -1 : 0);

    if (found.length === 0) {
      api.registry.delete(FIND_HIT_KEY);
      api.registry.delete(FIND_HIT_CURRENT_KEY);
      return;
    }
    api.registry.set(FIND_HIT_KEY, new api.Ctor(...found));
    api.registry.set(FIND_HIT_CURRENT_KEY, new api.Ctor(found[0]));
    // Scroll first match into view.
    const first = found[0].startContainer.parentElement;
    first?.scrollIntoView({ block: "nearest" });
  }, [open, deferredQuery, contentSignature, containerRef]);

  // Re-paint the "current" highlight whenever the active index changes,
  // independent of a re-walk. Also scrolls into view.
  useEffect(() => {
    const api = getHighlightApi();
    if (!api) return;
    const ranges = rangesRef.current;
    if (current < 0 || current >= ranges.length) {
      api.registry.delete(FIND_HIT_CURRENT_KEY);
      return;
    }
    api.registry.set(FIND_HIT_CURRENT_KEY, new api.Ctor(ranges[current]));
    const target = ranges[current].startContainer.parentElement;
    target?.scrollIntoView({ block: "nearest" });
  }, [current]);

  // Cleanup on unmount: don't leave painted ranges behind.
  useEffect(() => {
    return () => {
      clearHighlights();
    };
  }, []);

  const next = useCallback(() => {
    setCurrent((i) => {
      const n = rangesRef.current.length;
      if (n === 0) return -1;
      return (i + 1) % n;
    });
  }, []);

  const prev = useCallback(() => {
    setCurrent((i) => {
      const n = rangesRef.current.length;
      if (n === 0) return -1;
      return (i - 1 + n) % n;
    });
  }, []);

  return {
    open,
    query,
    matches,
    current,
    setQuery,
    next,
    prev,
    openBar,
    close,
  };
}
