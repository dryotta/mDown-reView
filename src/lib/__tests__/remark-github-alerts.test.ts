import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";
import { remarkGithubAlerts } from "@/lib/remark-github-alerts";

function parse(md: string): Root {
  return unified().use(remarkParse).use(remarkGithubAlerts).parse(md) as Root;
}

function process(md: string): Root {
  const proc = unified().use(remarkParse).use(remarkGithubAlerts);
  const tree = proc.parse(md);
  return proc.runSync(tree) as Root;
}

describe("remark-github-alerts", () => {
  for (const kind of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const) {
    it(`rewrites [!${kind}] blockquote into md-alert div + title`, () => {
      const md = `> [!${kind}]\n> Body line one\n> Body line two\n`;
      const tree = process(md);
      const bq = tree.children[0] as { type: string; data?: { hName?: string; hProperties?: { className?: string[] } }; children: unknown[] };
      expect(bq.type).toBe("blockquote");
      expect(bq.data?.hName).toBe("div");
      expect(bq.data?.hProperties?.className).toEqual([
        "md-alert",
        `md-alert-${kind.toLowerCase()}`,
      ]);
      const title = bq.children[0] as { data?: { hName?: string; hProperties?: { className?: string[] } }; children: { value: string }[] };
      expect(title.data?.hName).toBe("p");
      expect(title.data?.hProperties?.className).toEqual(["md-alert-title"]);
      expect(title.children[0].value).toBe(
        kind.charAt(0) + kind.slice(1).toLowerCase(),
      );
      expect(bq).toMatchSnapshot();
    });
  }

  it("leaves a non-matching blockquote untouched", () => {
    const md = "> Just a plain quote\n> with two lines\n";
    const tree = parse(md);
    const transformed = process(md);
    expect(transformed.children[0]).toEqual(tree.children[0]);
    const bq = transformed.children[0] as { data?: unknown };
    expect(bq.data).toBeUndefined();
    expect(transformed.children[0]).toMatchSnapshot();
  });

  it("ignores unknown bracketed tokens like [!INFO]", () => {
    const md = "> [!INFO]\n> body\n";
    const tree = process(md);
    const bq = tree.children[0] as { data?: unknown };
    expect(bq.data).toBeUndefined();
  });
});
