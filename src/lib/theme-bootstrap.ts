/**
 * Theme bootstrap — pure logic the FOUC `<script>` in `index.html`
 * embeds verbatim. Extracting the parser here gives us a single
 * source for the persist key + parse shape, plus a Vitest seam over
 * the five branches the inline script can take.
 *
 * Drift guard: the unit test in `theme-bootstrap.test.ts` asserts
 * `index.html` contains `STORAGE_KEY` literally, so a key rename in
 * `src/store/index.ts` (`name: "mdownreview-ui"`) cannot silently
 * skew from the bootstrap.
 *
 * Why not import this module from `index.html` directly?
 * `<script type="module">` is fetched async — by the time it runs
 * the page would already have flashed against the WebView2 default
 * background. The inline `<script>` in `index.html` is therefore
 * still required; this module exists to test the logic and to
 * dedupe the persist-key constant.
 */

export const STORAGE_KEY = "mdownreview-ui";

export type BootstrapTheme = "light" | "dark";

export interface BootstrapDeps {
  /** Wraps `localStorage.getItem(STORAGE_KEY)`. May throw on
   *  privacy-restricted storage; the caller catches. */
  readPersisted: () => string | null;
  /** Wraps `window.matchMedia("(prefers-color-scheme: dark)").matches`. */
  prefersDark: () => boolean;
}

/**
 * Resolve the initial theme using the same shape the inline FOUC
 * script reads. Falls back to OS preference, then to `dark`.
 *
 * Branch matrix (covered by Vitest):
 *   1. Stored `"light"` / `"dark"` → returned verbatim.
 *   2. Stored `"system"` (or unknown string) → resolved via OS.
 *   3. Missing key (null) → resolved via OS.
 *   4. JSON parse failure → caller's catch path returns `"dark"`.
 *   5. `localStorage` getter throws → caller's catch path returns `"dark"`.
 */
export function resolveBootstrapTheme(deps: BootstrapDeps): BootstrapTheme {
  const raw = deps.readPersisted();
  if (raw) {
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown } };
    const theme = parsed.state?.theme;
    if (theme === "light" || theme === "dark") {
      return theme;
    }
  }
  return deps.prefersDark() ? "dark" : "light";
}
