import { useEffect } from "react";

export type AppliedTheme = "light" | "dark" | "system";

/**
 * Applies the given theme to `<html data-theme="...">`. When `theme` is
 * `"system"`, follows the OS `prefers-color-scheme: dark` media query and
 * updates the attribute on changes. Cleans up the media-query listener on
 * unmount or when `theme` changes.
 */
export function useApplyTheme(theme: AppliedTheme): void {
  useEffect(() => {
    const html = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      if (theme === "system") {
        html.setAttribute("data-theme", mq.matches ? "dark" : "light");
      } else {
        html.setAttribute("data-theme", theme);
      }
    }

    applyTheme();
    mq.addEventListener("change", applyTheme);
    return () => mq.removeEventListener("change", applyTheme);
  }, [theme]);
}
