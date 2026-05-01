/**
 * Anchor tooltip helpers — shared between MarkdownViewer and HtmlPreviewView.
 *
 * `tooltipForRoute` produces a human-readable label for a routed link:
 *   • external  → the full URL                         e.g. `https://tauri.app`
 *   • workspace → workspace-relative path (+ #frag)    e.g. `docs/intro.md#install`
 *   • fragment  → `#fragment`
 *   • blocked   → null (caller should omit the title attribute)
 *
 * `injectAnchorTitles` walks anchor tags in a raw HTML string and stamps a
 * `title="…"` attribute when one is absent. Used by the HTML preview's
 * resolve-assets pipeline so author-supplied HTML gets the same hover hints
 * the markdown viewer renders natively via the React anchor component.
 *
 * Pure string transforms — no DOM, no React, no IPC. Mirrors the regex-based
 * shape of `lib/html-image-rewrite.ts`. The regex misses pathological cases
 * (e.g. `>` inside attribute values); the worst-case failure is that a tag
 * keeps its original lack-of-title, never that we corrupt the HTML.
 */

import { assertNeverLinkRoute, routeLinkClick, type LinkRoute, type RouteLinkContext } from "./url-policy";

// `<a` followed by attribute glob then closing `>`. `[^>]*` deliberately
// non-greedy across `>`-in-attribute-quotes — safe failure mode is a missed
// injection (see file header).
const A_TAG_RE = /<a\b([^>]*)>/gi;
const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const TITLE_PRESENT_RE = /\btitle\s*=/i;

export function tooltipForRoute(
  route: LinkRoute,
  workspaceRoot: string,
): string | null {
  switch (route.kind) {
    case "fragment":
      return `#${decodeFragment(route.fragment)}`;
    case "external":
      return route.href;
    case "workspace":
    case "workspace-outside": {
      // `workspace-outside` is reserved for Group B's IPC classifier and is
      // not yet emitted by `routeLinkClick` in iter 1; iter 1 keeps the
      // workspace tooltip shape — Group C will distinguish them visually.
      const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
      const path = route.path.replace(/\\/g, "/");
      const rel = root && (path === root || path.startsWith(`${root}/`))
        ? path.slice(root.length + 1) || path
        : path;
      return route.fragment ? `${rel}#${decodeFragment(route.fragment)}` : rel;
    }
    case "absolute-blocked":
    case "scheme-blocked":
    case "other-blocked":
      return null;
    default:
      return assertNeverLinkRoute(route);
  }
}

function decodeFragment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function htmlEscapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function injectAnchorTitles(html: string, ctx: RouteLinkContext): string {
  return html.replace(A_TAG_RE, (full, attrs: string) => {
    if (TITLE_PRESENT_RE.test(attrs)) return full;
    const hrefMatch = HREF_RE.exec(attrs);
    if (!hrefMatch) return full;
    const href = hrefMatch[1] ?? hrefMatch[2] ?? "";
    if (!href) return full;
    const route = routeLinkClick(href, ctx);
    const tooltip = tooltipForRoute(route, ctx.workspaceRoot);
    if (!tooltip) return full;
    return `<a${attrs} title="${htmlEscapeAttr(tooltip)}">`;
  });
}
