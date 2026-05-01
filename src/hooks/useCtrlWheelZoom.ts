import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * Attaches a non-passive `wheel` listener to `ref.current` that turns
 * `Ctrl+wheel` (or `Cmd+wheel` on macOS) into a zoom step. Listener is
 * registered with `{ passive: false }` so `preventDefault()` actually
 * suppresses the browser's default page-zoom-or-scroll, leaving the
 * per-filetype `useZoom` slice as the single source of truth.
 *
 * No-ops on plain wheel events (no Ctrl/Cmd modifier) so normal scrolling
 * inside the viewer is untouched.
 *
 * Optional `targetGetter` is for surfaces whose listener target is not
 * available at mount time (e.g., an iframe's `contentDocument` that only
 * resolves after `onLoad`); when supplied, it overrides `ref.current` and
 * the effect re-runs whenever `epoch` changes so callers can re-attach
 * after the iframe document is replaced.
 */
export function useCtrlWheelZoom(
  ref: RefObject<HTMLElement | null>,
  zoomIn: () => void,
  zoomOut: () => void,
  options?: {
    targetGetter?: () => EventTarget | null | undefined;
    epoch?: unknown;
  },
): void {
  useEffect(() => {
    const target = options?.targetGetter ? options.targetGetter() : ref.current;
    if (!target) return;
    const onWheel = (event: Event) => {
      const e = event as WheelEvent;
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else if (e.deltaY > 0) zoomOut();
    };
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
  }, [ref, zoomIn, zoomOut, options?.targetGetter, options?.epoch]);
}
