# 09 · Mixed Images & Edge Cases

Local + remote images side by side, plus deliberate failure modes.

## Side by side — local vs remote

| Local PNG | Local SVG | Remote |
|---|---|---|
| ![](./images/solid-blue-200.png) | ![](./images/logo.svg) | ![](https://avatars.githubusercontent.com/u/9919?s=200&v=4) |

## Image with caption (figure-style)

![Quarterly chart — Q4 was the best quarter for PR throughput](./images/chart.svg)
*Figure 1: Quarterly throughput rendered as a hand-built SVG. Counts are illustrative.*

## Missing alt text (accessibility regression candidate)

![](./images/transparent-disk-120.png)

> The image above intentionally has no alt text. Screen readers will
> announce only the filename — not great. Consider it a regression
> target: a future linter could flag empty alts.

## Title attribute (tooltip on hover)

![Hover me](./images/banner.svg "This tooltip text comes from the title attribute")

## Image link wrapping (whole image is a link)

[![Click — opens an issue tracker](./images/chart.svg)](https://github.com/dryotta/mdownreview/issues)

## Broken local path (404 — should show broken-image placeholder)

![Intentionally missing local image](./images/this-file-does-not-exist.png)

## Broken remote URL (DNS failure / 404)

![Intentionally bad URL](https://this.domain.does.not.exist.example.test/image.png)

## Disallowed scheme (must be blocked by sanitize / asset policy)

![Should be stripped or blocked](javascript:alert(1))

> If the image above renders, you have a sanitize regression — open
> `src/components/viewers/markdown/sanitizeSchema.ts` and
> `docs/security.md` rule 13.

## Data URI inline image

![Tiny 1×1 transparent PNG via data URI](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=)

## SVG inline content (not a `<img>` — direct `<svg>` element)

> The sanitize schema in `src/components/viewers/markdown/sanitizeSchema.ts`
> may or may not allow inline SVG. If the diagram below shows, inline SVG
> is allowed. If only the alt text shows, it's been stripped. Either is
> defensible — KaTeX-generated SVG nodes go through a separate path
> (`rehype-katex-style.ts`).

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" width="200" role="img" aria-label="inline SVG demo">
  <rect x="0" y="0" width="100" height="60" fill="#10b981"/>
  <text x="50" y="38" text-anchor="middle" font-family="system-ui" font-size="16" fill="white">inline SVG</text>
</svg>

## A long string of consecutive images (stress layout)

![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png) ![](./images/tiny-16.png)

## Trailing checklist

- [ ] Local + remote images coexist on the same page (no auth state leak between code paths).
- [ ] Broken local path renders broken-image placeholder, doesn't crash.
- [ ] Broken remote URL renders broken-image placeholder, doesn't infinitely retry.
- [ ] `javascript:` image scheme is stripped or blocked — no alert() fires.
- [ ] Data URI images render inline.
- [ ] Inline `<svg>` either renders or is sanitized away (both defensible — see comment in source).
