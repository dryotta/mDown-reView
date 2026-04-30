# 10 · Inline HTML & Special Markdown

GitHub-style raw HTML allowed by the sanitize schema in
`src/components/viewers/markdown/sanitizeSchema.ts` — anything outside
the schema is silently dropped (rule 3 in `docs/security.md`).

## Keyboard hints — `<kbd>`

Press <kbd>Ctrl</kbd> + <kbd>K</kbd> on Windows or <kbd>⌘</kbd> + <kbd>K</kbd>
on macOS to open the search overlay.

The Vim-style sequence <kbd>g</kbd> <kbd>g</kbd> jumps to the top of the file.

## Subscripts and superscripts — `<sub>` / `<sup>`

Water is H<sub>2</sub>O. Carbon dioxide is CO<sub>2</sub>.
The fourth power is x<sup>4</sup>.
Footnote-like superscript<sup>[1]</sup> may also appear inline.

## Abbreviation — `<abbr>`

The <abbr title="Markdown Review Sidecar Format">MRSF</abbr> spec is the
on-disk shape of `*.review.yaml` files. The <abbr title="Inter-Process
Communication">IPC</abbr> chokepoint lives in `tauri-commands.ts`.

## Definition with `<dfn>`

A <dfn>chokepoint</dfn> is a single file or function that all callers
must funnel through, so cross-cutting concerns (logging, sanitisation,
error wrapping) can be enforced in one place.

## Mark / highlight — `<mark>`

Search results are visually <mark>highlighted</mark> by wrapping matches
with `<mark>` from `useSourceHighlighting` (`docs/security.md` rule 16).

## Disclosure — `<details>` / `<summary>`

<details>
<summary>Click to expand: full plugin order in MarkdownViewer</summary>

```
1. rehype-raw                 → re-parse inline HTML from the AST
2. rehype-footnote-prefix     → S1: strip pre-existing user-content-
3. rehype-katex (lazy)        → math nodes → KaTeX HTML+MathML
4. rehype-katex-style         → S2: drop `style` from non-KaTeX
5. rehype-sanitize            → strip anything not in sanitizeSchema
6. rehype-slug + autolink     → assign ids and prepend anchors
```

</details>

<details>
<summary>Nested disclosure — outer</summary>

Outer body content.

<details>
<summary>Inner disclosure</summary>

Inner body — nested `<details>` should expand independently.

</details>

End of outer body.

</details>

## GitHub-flavoured alerts (via `remark-github-alerts`)

> [!NOTE]
> Useful information that users should know, even when skimming content.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.

## Multi-paragraph alert

> [!TIP]
> First paragraph of the tip.
>
> Second paragraph in the same alert. Should not break out of the
> styled box — `remark-github-alerts` keeps the multi-paragraph
> blockquote intact.
>
> Third paragraph with `inline code` and **emphasis**.

## Sanitize regression tests (these MUST be stripped)

The lines below are deliberate XSS attempts. They should render as
plain text (or as nothing at all). If any actually executes, the
sanitize schema is broken — file an issue immediately citing rule 3 in
`docs/security.md`.

<script>alert("XSS via <script>")</script>

<iframe src="https://example.com"></iframe>

<form action="https://example.com" method="post"><input type="text"/></form>

<button onclick="alert('XSS via on*')">Click me</button>

<a href="javascript:alert('XSS via javascript:')">javascript: link</a>

<style>body { background: red !important }</style>

<object data="data:text/html,<script>alert(1)</script>"></object>

<embed src="https://example.com"></embed>

## Trailing checklist

- [ ] All five GFM alerts render with distinct icons + colors.
- [ ] `<kbd>`, `<sub>`, `<sup>`, `<abbr>`, `<mark>` all render.
- [ ] Disclosure widgets expand/collapse on click.
- [ ] None of the deliberate-XSS payloads execute (no alert dialogs).
- [ ] DevTools console: zero errors / warnings related to script execution.
