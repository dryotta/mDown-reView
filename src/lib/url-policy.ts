// URL-scheme classifiers used by viewer link handlers AND by the external-URL
// chokepoint in `lib/tauri-commands.ts`. Hoisted to one place so the viewer
// classifies clicks the same way the plugin gate enforces.
//
// Allowed external schemes: http(s), mailto, tel.
// Explicitly blocked: javascript, file, data, vbscript.
//
// The split is intentional — `EXTERNAL_LINK_SCHEME` is "delegate to OS
// opener", `BLOCKED_LINK_SCHEME` is "drop with a warn". Any scheme matching
// neither is treated as a workspace-relative path by viewer handlers.

export const EXTERNAL_LINK_SCHEME = /^(https?|mailto|tel):/i;
export const BLOCKED_LINK_SCHEME = /^(javascript|file|data|vbscript):/i;

import { resolveWorkspacePath } from "./path-utils";

// Routing chokepoint shared by MarkdownComponentsMap (in-process anchor
// click) AND HtmlPreviewView (postMessage from sandboxed iframe). Pure
// function — no React, no IPC. The caller dispatches based on the returned
// route kind (open external, open in workspace, ignore, etc.).
//
// Security notes (see docs/security.md rule 13):
//   • The `href` is treated as attacker-controlled (postMessage payloads
//     have no provenance guarantees beyond nonce+source filtering).
//   • Type guard FIRST — non-string / oversized inputs are dropped. The
//     4 KiB cap is well beyond legitimate href lengths and prevents
//     pathological inputs from reaching downstream regex/url parsers.
//   • Leading whitespace is stripped before scheme classification so
//     "\n\tjavascript:..." cannot bypass the blocklist by virtue of HTML
//     parsers tolerating leading whitespace in href attributes.
//   • BLOCKED_LINK_SCHEME is checked BEFORE EXTERNAL_LINK_SCHEME so that
//     a future overlap can never fall through to the external opener.

export interface RouteLinkContext {
  /** Directory of the document the link lives in (for relative resolution). */
  baseDir: string | undefined;
  /** Workspace root used to enforce containment. */
  workspaceRoot: string;
}

// 7-kind discriminated union (issue #338 — tiered link & asset policy).
//
// Layered classification, finest to coarsest:
//   • fragment           — same-document anchor (#sec-2)
//   • external           — http(s) / mailto / tel — delegated to OS opener
//   • workspace          — relative path resolved inside the workspace root
//   • workspace-outside  — well-formed relative path that resolves OUTSIDE the
//                          workspace root (reserved for Group B's IPC
//                          classifier; not yet emitted by routeLinkClick)
//   • absolute-blocked   — OS-rooted path (POSIX `/etc/...`, Windows
//                          `C:\...`, UNC `\\server\share\...`)
//   • scheme-blocked     — explicitly hostile schemes (javascript: / data: /
//                          vbscript: / file:)
//   • other-blocked      — input shape problems (oversized / non-string /
//                          missing baseDir / decode failure / outside-workspace)
//
// Group B will additionally emit `workspace-outside` once `path_classify` IPC
// lands. Group C wires the tier-3 hard-block UI; iter 1 keeps the existing
// "warn + drop" behavior for every blocked variant.
export type LinkRoute =
  | { kind: "fragment"; fragment: string }
  | { kind: "external"; href: string }
  | { kind: "workspace"; path: string; fragment?: string }
  | { kind: "workspace-outside"; path: string; fragment?: string }
  | { kind: "absolute-blocked"; href: string; flavor: "posix" | "windows" | "unc" }
  | { kind: "scheme-blocked"; href: string; scheme: "javascript" | "data" | "vbscript" | "file" }
  | { kind: "other-blocked"; href: string; reason: "type/length" | "no-basedir" | "decode" | "outside-workspace" };

// Mirrors BLOCKED_LINK_SCHEME but captures which scheme matched so the route
// carries the precise discriminator. Kept local — BLOCKED_LINK_SCHEME stays
// authoritative for callers like `tauri-commands.ts:399` that only need a
// boolean test.
const BLOCKED_SCHEME_CAPTURE = /^(javascript|file|data|vbscript):/i;

export function routeLinkClick(rawHref: unknown, ctx: RouteLinkContext): LinkRoute {
  if (typeof rawHref !== "string" || rawHref.length === 0 || rawHref.length > 4096) {
    return {
      kind: "other-blocked",
      href: typeof rawHref === "string" ? rawHref : "",
      reason: "type/length",
    };
  }
  // Strip leading whitespace (HTML parsers tolerate it; the blocklist must not).
  const href = rawHref.replace(/^\s+/, "");
  if (href.length === 0) {
    return { kind: "other-blocked", href: rawHref, reason: "type/length" };
  }
  // Hostile schemes — checked first, BEFORE EXTERNAL_LINK_SCHEME, so a future
  // overlap can never fall through to the external opener.
  const schemeMatch = BLOCKED_SCHEME_CAPTURE.exec(href);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase() as "javascript" | "data" | "vbscript" | "file";
    return { kind: "scheme-blocked", href, scheme };
  }
  if (href.startsWith("#")) {
    return { kind: "fragment", fragment: href.slice(1) };
  }
  if (EXTERNAL_LINK_SCHEME.test(href)) {
    return { kind: "external", href };
  }

  // Strip query + fragment so absolute-path detection sees only the path
  // portion. Mirrors the same prelude in `resolveWorkspacePath`.
  let rest = href;
  const qIdx = rest.indexOf("?");
  if (qIdx >= 0) rest = rest.slice(0, qIdx);
  const hIdx = rest.indexOf("#");
  if (hIdx >= 0) rest = rest.slice(0, hIdx);

  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return { kind: "other-blocked", href, reason: "decode" };
  }

  // Absolute-path detection — must run BEFORE the workspace-relative branch
  // so OS-rooted hrefs are surfaced as their tier-3 absolute flavor instead
  // of being silently dropped by `resolveWorkspacePath`'s containment check.
  // UNC checks mirror A4's UNC reject in `resolveWorkspacePath` verbatim
  // (literal `\\` / `//` post-decode, plus URL-encoded `%5C%5C` pre-decode
  // as defense-in-depth against decodeURIComponent quirks).
  if (/^\\\\/.test(decoded) || /^\/\//.test(decoded) || /^%5[Cc]%5[Cc]/.test(rest)) {
    return { kind: "absolute-blocked", href, flavor: "unc" };
  }
  if (/^[A-Za-z]:[/\\]/.test(decoded)) {
    return { kind: "absolute-blocked", href, flavor: "windows" };
  }
  if (decoded.startsWith("/")) {
    // POSIX-absolute. Previously this fell through to
    // `resolveWorkspacePath`, which treated `/foo.md` as workspace-root-
    // relative — convenient for in-repo links but an OS-root escape vector
    // for adversarial markdown. Iter 1 of #338 promotes it to a tier-3
    // absolute-blocked route; legitimate workspace-root-relative links must
    // be authored as `./foo.md` from the repo root.
    return { kind: "absolute-blocked", href, flavor: "posix" };
  }

  if (!ctx.baseDir) {
    return { kind: "other-blocked", href, reason: "no-basedir" };
  }
  const resolved = resolveWorkspacePath(ctx.workspaceRoot, ctx.baseDir, href);
  if (!resolved) {
    return { kind: "other-blocked", href, reason: "outside-workspace" };
  }
  return {
    kind: "workspace",
    path: resolved.path,
    ...(resolved.fragment ? { fragment: resolved.fragment } : {}),
  };
}

/**
 * Compile-time exhaustiveness helper for `LinkRoute` switches. Place in the
 * `default` arm so adding a new kind to `LinkRoute` produces a TypeScript
 * error at every call site that hasn't been updated.
 *
 *   switch (route.kind) {
 *     case "fragment": ...
 *     // ...all kinds...
 *     default: assertNeverLinkRoute(route);
 *   }
 */
export function assertNeverLinkRoute(route: never): never {
  throw new Error(`unhandled LinkRoute kind: ${JSON.stringify(route)}`);
}
