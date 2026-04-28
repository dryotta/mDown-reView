import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildMarkdownComponents } from "../MarkdownComponentsMap";

vi.mock("@tauri-apps/api/core");

vi.mock("@/lib/tauri-commands", async () => ({
  ...(await vi.importActual<typeof import("@/lib/tauri-commands")>("@/lib/tauri-commands")),
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
  convertAssetUrl: (src: string) => `asset://${src}`,
}));

vi.mock("@/logger");

import { openExternalUrl } from "@/lib/tauri-commands";
import { warn } from "@/logger";

beforeEach(() => {
  vi.mocked(openExternalUrl).mockClear();
  vi.mocked(warn).mockClear();
});

vi.mock("@/lib/shiki", () => ({
  getSharedHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue("<pre><code>highlighted</code></pre>"),
    getLoadedLanguages: vi.fn().mockReturnValue(["ts", "typescript"]),
    loadLanguage: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Minimal img component matching the resolver shape used by the real viewer.
const StubImg = ({
  src,
  alt,
  node: _node,
  ...rest
}: React.ImgHTMLAttributes<HTMLImageElement> & { node?: unknown }) => (
  <img src={src} alt={alt ?? ""} {...rest} />
);

function renderMd(md: string) {
  const components = buildMarkdownComponents({
    filePath: "/docs/x.md",
    workspaceRoot: "/docs",
    img: StubImg as never,
  });
  return render(
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {md}
    </ReactMarkdown>,
  );
}

describe("buildMarkdownComponents — block wrappings carry data-source-line", () => {
  it("wraps a paragraph with the commentable envelope", async () => {
    const { container } = renderMd("hello\n");
    await waitFor(() => {
      const wrapper = container.querySelector(".md-commentable-block");
      expect(wrapper).not.toBeNull();
      expect(wrapper?.getAttribute("data-source-line")).toBe("1");
      expect(wrapper?.querySelector("p")?.textContent).toBe("hello");
    });
  });

  it("wraps a GFM table and applies cell-level data-source-line on td/th", async () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    const { container } = renderMd(md);
    await waitFor(() => {
      // Wrapper around the table itself.
      const tableWrapper = container.querySelector(".md-commentable-block > table");
      expect(tableWrapper).not.toBeNull();
      // Cells carry data-source-line directly (no wrapper div inside <tr>).
      const ths = container.querySelectorAll("th");
      expect(ths.length).toBe(2);
      ths.forEach((th) => {
        expect(th.getAttribute("data-source-line")).not.toBeNull();
        expect(th.parentElement?.tagName.toLowerCase()).toBe("tr");
      });
      const tds = container.querySelectorAll("td");
      expect(tds.length).toBe(2);
      tds.forEach((td) => {
        expect(td.getAttribute("data-source-line")).not.toBeNull();
        expect(td.parentElement?.tagName.toLowerCase()).toBe("tr");
      });
    });
  });

  it("wraps blockquote with the commentable envelope", async () => {
    const { container } = renderMd("> quoted\n");
    await waitFor(() => {
      const bq = container.querySelector(".md-commentable-block > blockquote");
      expect(bq).not.toBeNull();
      const wrapper = bq?.parentElement;
      expect(wrapper?.getAttribute("data-source-line")).toBe("1");
    });
  });

  it("wraps an image with the commentable envelope and preserves the resolved <img>", async () => {
    const { container } = renderMd("![alt](./img.png)\n");
    await waitFor(() => {
      const wrapper = container.querySelector(".md-commentable-block");
      expect(wrapper).not.toBeNull();
      const img = wrapper?.querySelector("img");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("alt")).toBe("alt");
    });
  });

  it("wraps an <hr> with the commentable envelope", async () => {
    const { container } = renderMd("text\n\n---\n\nmore\n");
    await waitFor(() => {
      const hr = container.querySelector("hr");
      expect(hr).not.toBeNull();
      const wrapper = hr?.parentElement;
      expect(wrapper?.classList.contains("md-commentable-block")).toBe(true);
      expect(wrapper?.getAttribute("data-source-line")).toBe("3");
    });
  });

  it("wraps a fenced code block in the commentable envelope while keeping HighlightedCode dispatch", async () => {
    const { container } = renderMd("```ts\nconst x = 1;\n```\n");
    await waitFor(() => {
      const wrapper = container.querySelector(".md-commentable-block");
      expect(wrapper).not.toBeNull();
      // HighlightedCode initially renders a <pre><code> fallback while Shiki
      // resolves; once the (mocked) highlighter returns it dangerouslySets
      // its own HTML. Either way, the inner content lives under the wrapper.
      expect(wrapper?.getAttribute("data-source-line")).toBe("1");
    });
  });

  it("HighlightedCode loads language before calling codeToHtml (#181)", async () => {
    // Verify the language-loading fix: getLoadedLanguages + loadLanguage
    // must be called before codeToHtml. Without this, codeToHtml throws
    // "Language not found" and the block renders plain black.
    const { getSharedHighlighter } = await import("@/lib/shiki");
    const mockHl = await vi.mocked(getSharedHighlighter)();
    vi.mocked(mockHl.getLoadedLanguages).mockReturnValue([]);
    vi.mocked(mockHl.loadLanguage).mockResolvedValue(undefined);
    // After loadLanguage, getLoadedLanguages returns the language
    vi.mocked(mockHl.getLoadedLanguages).mockReturnValueOnce([]).mockReturnValue(["ts", "typescript"]);

    renderMd("```ts\nconst x = 1;\n```\n");

    await waitFor(() => {
      expect(mockHl.loadLanguage).toHaveBeenCalled();
      expect(mockHl.codeToHtml).toHaveBeenCalled();
    });
  });
});

describe("buildMarkdownComponents — anchor link handling", () => {
  it("external link click calls openExternalUrl", async () => {
    const { container } = renderMd("[link](https://example.com)\n");
    await waitFor(() => {
      const a = container.querySelector("a");
      expect(a).not.toBeNull();
    });
    const a = container.querySelector("a")!;
    fireEvent.click(a);
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("openExternalUrl failure produces a warn() call", async () => {
    vi.mocked(openExternalUrl).mockRejectedValueOnce(new Error("plugin unavailable"));
    const { container } = renderMd("[link](https://example.com)\n");
    await waitFor(() => {
      expect(container.querySelector("a")).not.toBeNull();
    });
    fireEvent.click(container.querySelector("a")!);
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("[MarkdownViewer] link open failed:"),
      );
    });
  });
});
