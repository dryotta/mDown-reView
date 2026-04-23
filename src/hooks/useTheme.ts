import { useSyncExternalStore } from "react";

function getTheme(): string {
  return document.documentElement.getAttribute("data-theme") ?? "light";
}

function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

/**
 * Returns the current data-theme attribute from <html>, reactively updating
 * when App.tsx changes it. Uses useSyncExternalStore for tear-free reads.
 */
export function useTheme(): string {
  return useSyncExternalStore(subscribe, getTheme, () => "light");
}
