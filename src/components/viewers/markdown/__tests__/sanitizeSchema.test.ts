import { describe, it, expect } from "vitest";
import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { sanitizeSchema } from "../sanitizeSchema";
import { rehypeFootnotePrefix } from "../rehype-footnote-prefix";
import { rehypeKatexStyle } from "../rehype-katex-style";

function sanitize(html: string): string {
  return String(
    unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeSanitize, sanitizeSchema)
      .use(rehypeStringify)
      .processSync(html),
  );
}

/** Mirrors the production rehype pipeline order in MarkdownViewer.tsx. */
function sanitizeFull(html: string): string {
  return String(
    unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeFootnotePrefix)
      .use(rehypeKatexStyle)
      .use(rehypeSanitize, sanitizeSchema)
      .use(rehypeStringify)
      .processSync(html),
  );
}

describe("sanitizeSchema", () => {
  it("preserves <details>/<summary> with the open attribute", () => {
    const out = sanitize("<details open><summary>hi</summary>body</details>");
    expect(out).toContain("<details");
    expect(out).toContain("open");
    expect(out).toContain("<summary>hi</summary>");
    expect(out).toContain("body");
  });

  it("strips <script> tags entirely", () => {
    const out = sanitize("<p>safe</p><script>alert(1)</script>");
    expect(out).toContain("<p>safe</p>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("strips on* event handler attributes", () => {
    const out = sanitize('<a href="https://x" onclick="alert(1)">x</a>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain("href");
  });

  it("strips inline style attributes", () => {
    const out = sanitize('<p style="color:red">x</p>');
    expect(out).not.toMatch(/style=/i);
    expect(out).toContain("<p>");
  });

  it("blocks javascript: URLs in href", () => {
    const out = sanitize('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it("strips <iframe> entirely", () => {
    const out = sanitize('<iframe src="https://evil"></iframe>');
    expect(out).not.toContain("<iframe");
  });

  it("preserves <kbd>, <sub>, <sup>, <mark>", () => {
    const out = sanitize("<kbd>K</kbd><sub>s</sub><sup>p</sup><mark>m</mark>");
    expect(out).toContain("<kbd>K</kbd>");
    expect(out).toContain("<sub>s</sub>");
    expect(out).toContain("<sup>p</sup>");
    expect(out).toContain("<mark>m</mark>");
  });

  it("preserves img width/height attributes", () => {
    const out = sanitize('<img src="x.png" width="100" height="50" alt="a">');
    expect(out).toMatch(/width=("100"|100)/);
    expect(out).toMatch(/height=("50"|50)/);
  });

  it("preserves <video controls src> with allowed attrs", () => {
    const out = sanitize('<video controls src="./demo.mp4" width="320"></video>');
    expect(out).toContain("<video");
    expect(out).toContain("controls");
    expect(out).toContain('src="./demo.mp4"');
    expect(out).toMatch(/width=("320"|320)/);
  });

  it("preserves <audio controls src>", () => {
    const out = sanitize('<audio controls src="./clip.mp3"></audio>');
    expect(out).toContain("<audio");
    expect(out).toContain("controls");
    expect(out).toContain('src="./clip.mp3"');
  });

  it("strips on* handlers from <video>", () => {
    const out = sanitize(
      '<video src="./x.mp4" controls onerror="alert(1)" onplay="alert(2)"></video>',
    );
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/onplay/i);
    expect(out).toContain("<video");
  });

  it("preserves <source src> inside <video>", () => {
    const out = sanitize(
      '<video controls><source src="./demo.webm" type="video/webm" /></video>',
    );
    expect(out).toContain("<source");
    expect(out).toContain('src="./demo.webm"');
    expect(out).toContain('type="video/webm"');
  });

  // B3: KaTeX-emitted output must survive sanitization. KaTeX produces a
  // styled-HTML twin (span.katex / .katex-html) AND a parallel MathML twin
  // (.katex-mathml > math > semantics > …) for accessibility. Both have to
  // make it through the schema or the math will render blank or bare.
  it("preserves a KaTeX-shaped HTML+MathML fragment", () => {
    const fragment =
      '<span class="katex">' +
        '<span class="katex-mathml">' +
          '<math xmlns="http://www.w3.org/1998/Math/MathML">' +
            '<semantics>' +
              '<mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow>' +
              '<annotation encoding="application/x-tex">E=mc^2</annotation>' +
            '</semantics>' +
          '</math>' +
        '</span>' +
        '<span class="katex-html" aria-hidden="true">' +
          '<span class="base" style="height:0.8641em">' +
            '<span class="mord mathnormal">E</span>' +
          '</span>' +
        '</span>' +
      '</span>';
    const out = sanitize(fragment);

    // HTML twin survived with its classes and inline style.
    expect(out).toContain('class="katex"');
    expect(out).toContain('class="katex-html"');
    expect(out).toContain('class="katex-mathml"');
    expect(out).toContain('class="base"');
    expect(out).toContain('style="height:0.8641em"');
    expect(out).toMatch(/aria-hidden="true"/);

    // MathML twin survived with semantics + annotation.
    expect(out).toContain("<math");
    expect(out).toContain("<semantics");
    expect(out).toContain("<mrow");
    expect(out).toContain("<msup");
    expect(out).toContain("<annotation");
    expect(out).toContain('encoding="application/x-tex"');
    expect(out).toContain("E=mc^2");
  });

  // S4: raw markdown HTML `<span style=…>` MUST have its `style` stripped
  // by the full pipeline (rehype-katex-style runs before sanitize). KaTeX-
  // classed spans keep their style — see S2 and the KaTeX-shaped test above.
  it("S4: full pipeline strips style from non-KaTeX <span>", () => {
    const out = sanitizeFull('<span style="position:fixed;inset:0">x</span>');
    expect(out).not.toMatch(/style=/i);
    expect(out).toContain("<span>x</span>");
  });

  it("S4: full pipeline preserves style on KaTeX-classed <span>", () => {
    const out = sanitizeFull(
      '<span class="katex"><span class="base" style="height:0.8641em">E</span></span>',
    );
    expect(out).toContain('style="height:0.8641em"');
  });

  it("S4: full pipeline strips style from bare <math>", () => {
    const out = sanitizeFull('<math style="color:red"><mn>1</mn></math>');
    expect(out).not.toMatch(/style=/i);
  });

  // S1: footnote ids should land at `user-content-fn-…` (single prefix)
  // after the full pipeline — never `user-content-user-content-…`.
  it("S1: full pipeline single-prefixes footnote ids (no double user-content-)", () => {
    const out = sanitizeFull(
      '<sup data-footnote-ref><a href="#user-content-fn-1" id="user-content-fnref-1" class="footnote-ref">1</a></sup>' +
        '<section data-footnotes class="footnotes"><ol>' +
        '<li id="user-content-fn-1"><p>note <a href="#user-content-fnref-1" class="footnote-backref">↩</a></p></li>' +
        "</ol></section>",
    );
    expect(out).not.toContain("user-content-user-content-");
    expect(out).toContain('id="user-content-fn-1"');
    expect(out).toContain('id="user-content-fnref-1"');
    expect(out).toContain('href="#user-content-fn-1"');
    expect(out).toContain('href="#user-content-fnref-1"');
  });
});
