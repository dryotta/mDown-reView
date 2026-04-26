import { useState, useCallback, useEffect } from "react";

export interface ContextMenuState<T = unknown> {
  open: boolean;
  x: number;
  y: number;
  payload?: T;
}

/**
 * F6 — generic context-menu state hook. Owns open/closed flag and
 * viewport-relative position. Auto-closes on Esc, on mousedown outside
 * any `.comment-context-menu` element, and on scroll. Pure UI utility —
 * no dependency on the comment domain.
 */
export function useContextMenu<T = unknown>(): {
  state: ContextMenuState<T>;
  openAt: (e: { clientX: number; clientY: number }, payload?: T) => void;
  close: () => void;
} {
  const [state, setState] = useState<ContextMenuState<T>>({ open: false, x: 0, y: 0 });

  const close = useCallback(() => {
    setState((s) => (s.open ? { ...s, open: false } : s));
  }, []);

  const openAt = useCallback((e: { clientX: number; clientY: number }, payload?: T) => {
    setState({ open: true, x: e.clientX, y: e.clientY, payload });
  }, []);

  useEffect(() => {
    if (!state.open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    const onMouseDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t?.closest(".comment-context-menu")) close();
    };
    const onScroll = () => close();
    document.addEventListener("keydown", onKey);
    // Defer click listener by one tick so the same event that opens the
    // menu (via openAt) does not immediately close it.
    const timer = setTimeout(
      () => document.addEventListener("mousedown", onMouseDown),
      0,
    );
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("scroll", onScroll, true);
      clearTimeout(timer);
    };
  }, [state.open, close]);

  return { state, openAt, close };
}
