# 01 · GFM Basics

Headings, lists, blockquotes, emphasis, links, autolinks, strikethrough,
inline code, and horizontal rules — the bread-and-butter of every
markdown file.

## Headings — six levels

# H1 Heading
## H2 Heading
### H3 Heading
#### H4 Heading
##### H5 Heading
###### H6 Heading

Each heading should get an autolinked anchor (rehype-slug + autolink).
Try clicking each heading — the URL should update and `Window → History
→ Back` should restore the previous scroll position.

## Emphasis

*italic with single asterisks* — _italic with single underscores_

**bold with double asterisks** — __bold with double underscores__

***bold-italic*** — ___bold-italic also___

~~strikethrough — GFM-only~~

`inline code` and `let answer = 42;` rendered with the inline-code style.

A line that mixes them: a *fast* `Vec<u8>` allocation **must not** ~~reallocate~~.

## Lists — unordered, deeply nested

- Top-level item
  - Nested second level
    - Third level
      - Fourth level — should still render readably
        - Fifth level — gets cramped but should not break layout
- Sibling at top level
  - With **bold** content
  - With `inline code`
  - With [a link inside](https://example.com)

## Lists — ordered, with nested unordered

1. Step one
2. Step two
   - Sub-bullet a
   - Sub-bullet b
     1. Sub-sub-step
     2. Another sub-sub-step
3. Step three with a longer sentence to make sure wrapping inside numbered list items behaves the way every reasonable reader would expect: the second visual line should align under the text, not under the number.

## Definition-style content via emphasis

**Reliability**
: Comments are indestructible — refactors, deletes, and crashes do not lose them.

**Performant**
: Fast startup, fast open, fast search, fast render.

(Definition lists are not standard GFM — the above renders as paragraphs, which is the correct fallback.)

## Blockquotes — single, nested, with content

> A short blockquote. Single paragraph.

> A longer blockquote with **emphasis**, `inline code`, and a [link](https://example.com).
>
> A second paragraph in the same blockquote. The blank `>` line separates the two.

> Outer blockquote
> > Nested blockquote — render style depends on theme; the indent should still be visible.
> > > Triple-nested — the deepest a sane document goes.

## Links

Inline link: [GitHub](https://github.com).

Reference link: [mdownreview repo][repo].

Autolink: <https://www.rust-lang.org>.

Bare URL (GFM autolink): https://www.example.com — should also linkify.

[repo]: https://github.com/dryotta/mdownreview

## Inline images (foreshadow — full image samples in 07/08/09)

Logo: ![logo](./images/logo.svg)

## Horizontal rules

Three dashes:

---

Three asterisks:

***

Three underscores:

___

## Hard line breaks

Two trailing spaces force a hard break (look at the output: this line  
should wrap to the next without a paragraph gap).

## Escapes

Backslash escapes: \*not italic\*, \`not code\`, \[not a link\], \\ literal backslash.

Pound sign at line start without a heading: \# this is not an H1.

## Trailing checklist

- [ ] Headings have anchors and clicking them updates the URL.
- [ ] Nested list bullets don't break layout at depth 5.
- [ ] Strikethrough renders.
- [ ] Autolinks render and are clickable.
- [ ] Triple-nested blockquote stays inside the reading column.
