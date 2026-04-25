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
  // B3: KaTeX-emitted MathML. KaTeX outputs both styled HTML (spans with
  // `katex*` classes) AND a parallel MathML tree wrapped in <math>…</math>
  // for accessibility / screen readers. Both must survive sanitization.
  // None of these tags are scriptable surfaces — they are pure presentation /
  // semantic markup, so allowing them is safe.
  "math",
  "semantics",
  "annotation",
  "mrow",
  "mi",
  "mo",
  "mn",
  "ms",
  "mtext",
  "mspace",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "msqrt",
  "mroot",
  "mover",
  "munder",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
  "mpadded",
  "mphantom",
  "mstyle",
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
    // S2: `style` survives sanitization on `<span>` and `<math>` ONLY because
    // KaTeX visual fidelity requires it (vertical-align / height offsets the
    // KaTeX renderer emits as inline style cannot be expressed via classes
    // alone). The narrow rehype transformer in `./rehype-katex-style.ts`
    // (run BEFORE sanitize) DROPS `style` from any `<span>`/`<math>` whose
    // class doesn't start with `katex`, so authored markdown HTML like
    // `<span style="position:fixed;inset:0">…</span>` cannot overlay the
    // viewport. Real defenses for the residual KaTeX-classed surface:
    //   1. Modern CSS engines neuter `expression(…)` and `javascript:` inside
    //      style values (only legacy IE ever evaluated them).
    //   2. The app's CSP `img-src` blocks remote `url(…)` from leaking pixels.
    //   3. KaTeX itself is the trust root for these spans — if KaTeX is
    //      compromised, residual UI-redress is the accepted risk.
    span: [
      ...(baseAttributes.span ?? []),
      "className",
      "style",
      "ariaHidden",
    ],
    // MathML twin (the accessible/semantic side of KaTeX output). MathML
    // tags are pure presentation/semantics with no scriptable surface, so
    // allowing the standard MathML attribute set is safe.
    math: ["className", "style", "xmlns", "display", "ariaHidden"],
    semantics: ["className"],
    annotation: ["className", "encoding"],
    mrow: ["className"],
    mi: ["className", "mathvariant"],
    mo: ["className", "mathvariant", "stretchy", "fence", "lspace", "rspace", "accent"],
    mn: ["className", "mathvariant"],
    ms: ["className"],
    mtext: ["className"],
    mspace: ["className", "width"],
    msup: ["className"],
    msub: ["className"],
    msubsup: ["className"],
    mfrac: ["className", "linethickness"],
    msqrt: ["className"],
    mroot: ["className"],
    mover: ["className", "accent"],
    munder: ["className", "accentunder"],
    munderover: ["className", "accent", "accentunder"],
    mtable: ["className"],
    mtr: ["className"],
    mtd: ["className"],
    mpadded: ["className"],
    mphantom: ["className"],
    mstyle: ["className", "displaystyle", "scriptlevel"],
    // GitHub-style alerts (B1): wrap div + title paragraph emitted by
    // `remark-github-alerts`. Class tokens are restricted to the exact
    // allowlist so this remains a hard-coded surface — not a free `class=`.
    div: [
      ...(baseAttributes.div ?? []),
      [
        "className",
        "md-alert",
        "md-alert-note",
        "md-alert-tip",
        "md-alert-important",
        "md-alert-warning",
        "md-alert-caution",
      ],
    ],
    p: [...(baseAttributes.p ?? []), ["className", "md-alert-title"]],
  },
  // S1: GFM footnotes already emit ids prefixed with `user-content-`
  // (mdast-util-gfm-footnote does this internally). The pre-sanitize
  // transform in `./rehype-footnote-prefix.ts` (run BEFORE sanitize) strips
  // that pre-existing prefix from clobber-class attributes (id, name,
  // ariaDescribedBy, ariaLabelledBy) on footnote nodes only — sanitize then
  // re-applies the prefix cleanly via the inherited default `clobberPrefix:
  // "user-content-"`. The matching `<a href="#user-content-fn-1">` is left
  // alone because sanitize never prefixes hrefs; keeping the original prefix
  // on the href keeps it in sync with the post-sanitize prefixed id.
  // Inherit defaultSchema's protocol allowlist for href/src — this is what
  // blocks `javascript:`, `vbscript:`, `data:` for navigation, and similar.
};
