# 04 · Task Lists & Footnotes

GFM task lists (with nesting) and standard footnote references / definitions.

## Task list — flat

- [x] Open this folder in mdownreview
- [x] Click through `01-gfm-basics.md`
- [ ] Click through `02-tables.md`
- [ ] Toggle dark mode and confirm checkboxes recolor
- [ ] Open DevTools (F12) and confirm zero `console.error` / `console.warn`

## Task list — nested

- [x] Engineering excellence
  - [x] Rust-First with MVVM
  - [x] Never Increase Engineering Debt
  - [ ] Zero Bug Policy[^zerobug]
- [ ] Charter pillars
  - [x] Professional
  - [x] Reliable
  - [x] Performant
  - [ ] Lean
  - [x] Architecturally Sound
- [ ] Documentation freshness sweep
  - [x] Update `docs/test-strategy.md`
  - [x] Cross-reference from `docs/architecture.md`
  - [ ] Update `docs/observability.md`
  - [ ] Update `docs/security.md`

## Footnotes

This paragraph references a footnote[^one]. Another sentence references a
second footnote[^two] and the same footnote can be referenced
multiple times[^one] — the second reference becomes the literal "↩"
back-link target on the first definition.

A long footnote reference[^long] sits in the middle of this sentence,
followed by another with code in the body[^codey], and one with a
[link inside the footnote body itself][^linked].

[^zerobug]: Every confirmed bug ships with a regression test that
  reproduces the original failure mode. See `docs/principles.md`.

[^one]: First short footnote. Should appear at the bottom with a `↩`
  back-link to its first reference.

[^two]: Second footnote — also short.

[^long]: A longer footnote that spans multiple lines.

    A second paragraph in the same footnote — separated by a blank line
    and indented by four spaces, per CommonMark footnote-extension
    convention.

[^codey]: Footnote bodies can contain `inline code` and even fenced
  blocks:

    ```rust
    fn main() {
        println!("inside a footnote");
    }
    ```

[^linked]: Footnote with a [link](https://github.com/dryotta/mdownreview)
  inside.

## Trailing checklist

- [ ] Checked vs unchecked task list items render with distinct visual states.
- [ ] Nested task lists indent correctly.
- [ ] Footnote `↩` back-links jump back to the original reference (rehype-footnote-prefix keeps the IDs sane after sanitize).
- [ ] Multi-paragraph footnotes render both paragraphs.
- [ ] A footnote's fenced code block highlights via Shiki just like a top-level fence.
