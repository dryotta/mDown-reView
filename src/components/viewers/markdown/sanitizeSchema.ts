/**
 * rehype-sanitize schema for MarkdownViewer.
 *
 * Pairs with `rehype-raw` to allow a small, GitHub-like set of inline HTML
 * tags inside markdown WHILE structurally stripping anything dangerous:
 *   - `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`
 *     (other than the GFM task-list checkbox `defaultSchema` already permits)
 *     are all dropped because they are absent from `tagNames`.
 *   - `on*` event handler attributes are stripped because they are absent
 *     from per-tag and `*` attribute lists.
 *   - Inline `style` attributes are stripped (XSS surface via CSS expressions
 *     and url(javascript:…) on legacy engines, plus reader-styling override).
 *
 * The base is `defaultSchema` from rehype-sanitize, which itself enforces a
 * URL scheme allowlist for `href`/`src` (no `javascript:` or `data:` for
 * navigation); we only ADD on top of it.
 *
 * Keep additions minimal — every new tag/attribute is a new XSS surface.
 */
import { defaultSchema } from "rehype-sanitize";
import type { Schema } from "hast-util-sanitize";

const baseTagNames = defaultSchema.tagNames ?? [];
const baseAttributes = defaultSchema.attributes ?? {};

const ADDED_TAGS: string[] = [
  // Most are already in defaultSchema; we add what is missing for GitHub
  // parity. `details`, `summary`, `kbd`, `sub`, `sup`, `picture`, `source`,
  // `dl`, `dt`, `dd` are already permitted by defaultSchema.
  "mark",
  "figure",
  "figcaption",
  // A4: media tags. Defense-in-depth: src goes through defaultSchema's
  // protocol allowlist (no `javascript:`/`vbscript:`).
  "video",
  "audio",
];

export const sanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: Array.from(new Set([...baseTagNames, ...ADDED_TAGS])),
  attributes: {
    ...baseAttributes,
    // Allow `details` to be initially open via the `open` boolean attribute.
    details: [...(baseAttributes.details ?? []), "open"],
    // `<source>` inside `<picture>` / `<video>` / `<audio>` — minimum useful set.
    source: [
      ...(baseAttributes.source ?? []),
      "src",
      "srcSet",
      "media",
      "type",
      "sizes",
    ],
    // Extend `<img>`: width/height/loading/alignment for layout, srcset for
    // responsive images. We deliberately do NOT add `style`.
    img: [
      ...(baseAttributes.img ?? []),
      "alt",
      "title",
      "width",
      "height",
      "loading",
      "align",
      "srcSet",
      "sizes",
    ],
    // A4: media tags — a small attribute set covering playback ergonomics
    // without admitting any scriptable surface.
    video: [
      "src",
      "controls",
      "width",
      "height",
      "muted",
      "loop",
      "poster",
      "preload",
      "autoplay",
      "playsinline",
    ],
    audio: [
      "src",
      "controls",
      "loop",
      "muted",
      "preload",
      "autoplay",
    ],
    // Allow `class` on the autolink-headings anchor and code blocks (Shiki/
    // language- markers). defaultSchema already permits className on a few
    // elements but not universally.
    a: [
      ...(baseAttributes.a ?? []),
      "ariaHidden",
      ["className", "heading-anchor"],
    ],
  },
  // Inherit defaultSchema's protocol allowlist for href/src — this is what
  // blocks `javascript:`, `vbscript:`, `data:` for navigation, and similar.
};
