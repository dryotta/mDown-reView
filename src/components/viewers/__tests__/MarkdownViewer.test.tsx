import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MarkdownViewer } from "../MarkdownViewer";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((src: string) => `asset://${src}`),
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/logger");

// Mock heavy async deps
vi.mock("shiki", () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue("<pre><code>mock</code></pre>"),
  }),
}));

vi.mock("@shikijs/rehype", () => ({
  default: () => () => {},
}));

// Mock child components to simplify testing
vi.mock("../FrontmatterBlock", () => ({
  FrontmatterBlock: ({ data }: { data: Record<string, unknown> }) => (
    <div data-testid="frontmatter-block">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} data-testid={`fm-${k}`}>
          {k}: {String(v)}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("../TableOfContents", () => ({
  TableOfContents: ({ headings }: { headings: { text: string; slug: string; level: number }[] }) =>
    headings.length >= 3 ? (
      <nav data-testid="toc">
        {headings.map((h) => (
          <a key={h.slug} href={`#${h.slug}`}>
            {h.text}
          </a>
        ))}
      </nav>
    ) : null,
  extractHeadings: (md: string) => {
    const lines = md.split("\n");
    return lines
      .map((line) => {
        const m = line.match(/^(#{1,3})\s+(.+)$/);
        if (!m) return null;
        const text = m[2].trim();
        return {
          level: m[1].length,
          text,
          slug: text.toLowerCase().replace(/\s+/g, "-"),
        };
      })
      .filter(Boolean);
  },
}));

vi.mock("@/components/comments/CommentMargin", () => ({
  CommentMargin: () => null,
}));

const FILE_PATH = "/docs/README.md";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 10.1: headings, code blocks ─────────────────────────────────────────────

describe("10.1 – headings and code blocks", () => {
  it("renders headings", async () => {
    const content = "# Hello World\n\nSome text.";
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Hello World" })).toBeInTheDocument();
    });
  });

  it("renders a code block without error", async () => {
    const content = "```typescript\nconst x = 1;\n```";
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      // The markdown body should be rendered
      expect(document.querySelector(".markdown-body")).toBeInTheDocument();
    });
  });

  it("unknown language tag renders without error", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const content = "```unknownlang\nsome code\n```";
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      expect(document.querySelector(".markdown-body")).toBeInTheDocument();
    });
    consoleErrorSpy.mockRestore();
  });
});

// ─── 10.2: GFM table and task lists ──────────────────────────────────────────

describe("10.2 – GFM table and task lists", () => {
  it("GFM table renders as <table>", async () => {
    const content = `| A | B |\n|---|---|\n| 1 | 2 |`;
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      expect(document.querySelector("table")).toBeInTheDocument();
    });
  });

  it("task list items render as disabled checkboxes", async () => {
    const content = `- [x] Done\n- [ ] Todo`;
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      expect(checkboxes.length).toBeGreaterThan(0);
      checkboxes.forEach((cb) => {
        expect(cb).toBeDisabled();
      });
    });
  });
});

// ─── 10.3: image src transformation ──────────────────────────────────────────

describe("10.3 – image src transformation", () => {
  it("relative image src gets transformed via convertFileSrc", async () => {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const mockConvert = convertFileSrc as ReturnType<typeof vi.fn>;
    mockConvert.mockImplementation((src: string) => `asset://${src}`);

    const content = `![alt](./image.png)`;
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      const img = document.querySelector("img");
      expect(img).toBeInTheDocument();
      expect(mockConvert).toHaveBeenCalledWith("/docs/./image.png");
      expect(img?.src).toContain("asset://");
    });
  });

  it("http image passes through without transformation", async () => {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const mockConvert = convertFileSrc as ReturnType<typeof vi.fn>;
    mockConvert.mockClear();

    const content = `![alt](https://example.com/img.png)`;
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      const img = document.querySelector("img");
      expect(img).toBeInTheDocument();
    });
    // convertFileSrc should NOT be called for http URLs
    expect(mockConvert).not.toHaveBeenCalledWith("https://example.com/img.png");
  });
});

// ─── 10.4: FrontmatterBlock and TOC ──────────────────────────────────────────

describe("10.4 – FrontmatterBlock and TableOfContents", () => {
  it("FrontmatterBlock renders when frontmatter is present", async () => {
    const content = `---\ntitle: Test\nauthor: Dave\n---\n# Hello`;
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      expect(screen.getByTestId("frontmatter-block")).toBeInTheDocument();
    });
  });

  it("TOC renders when doc has 3+ headings", async () => {
    const content = `# H1\n\n## H2\n\n### H3\n\nContent`;
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      expect(screen.getByTestId("toc")).toBeInTheDocument();
    });
  });

  it("TOC does not render for fewer than 3 headings", async () => {
    const content = `# H1\n\n## H2\n\nContent`;
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      expect(document.querySelector(".markdown-body")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("toc")).not.toBeInTheDocument();
  });
});

// ─── 10.5: file size warning ──────────────────────────────────────────────────

describe("10.5 – file size warning", () => {
  it("file >500 KB shows warning banner", async () => {
    const fileSize = 501 * 1024; // 501 KB
    render(<MarkdownViewer content="content" filePath={FILE_PATH} fileSize={fileSize} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(/large/i);
    });
  });

  it("file ≤500 KB shows no warning banner", async () => {
    const fileSize = 500 * 1024; // exactly 500 KB
    render(<MarkdownViewer content="content" filePath={FILE_PATH} fileSize={fileSize} />);

    await waitFor(() => {
      expect(document.querySelector(".markdown-body")).toBeInTheDocument();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("no fileSize prop shows no warning banner", async () => {
    render(<MarkdownViewer content="content" filePath={FILE_PATH} />);

    await waitFor(() => {
      expect(document.querySelector(".markdown-body")).toBeInTheDocument();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
