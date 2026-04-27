import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MarkdownViewer } from "../MarkdownViewer";

vi.mock("@tauri-apps/api/core");

const convertAssetUrlMock = vi.fn((src: string) => `asset://${src}`);

vi.mock("@/lib/tauri-commands", async () => ({
  ...(await vi.importActual<typeof import("@/lib/tauri-commands")>("@/lib/tauri-commands")),
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
  convertAssetUrl: (src: string) => convertAssetUrlMock(src),
  fetchRemoteAsset: vi.fn().mockResolvedValue({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    contentType: "image/png",
  }),
}));

vi.mock("@/logger");

const writeText = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));

// Mock shared Shiki module
vi.mock("@/lib/shiki", () => ({
  getSharedHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue("<pre><code>mock</code></pre>"),
  }),
}));

vi.mock("@shikijs/rehype", () => ({
  default: () => () => {},
}));

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: vi.fn(() => ({ threads: [], comments: [], loading: false, reload: vi.fn() })),
}));

const addCommentMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: vi.fn(() => ({
    addComment: addCommentMock,
    addReply: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    resolveComment: vi.fn(),
    unresolveComment: vi.fn(),
    commitMoveAnchor: vi.fn(),
  })),
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

vi.mock("@/components/comments/LineCommentMargin", () => ({
  LineCommentMargin: () => null,
}));

const FILE_PATH = "/docs/README.md";

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockClear();
  writeText.mockResolvedValue(undefined);
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

  it("applies md-wrap-cascade class to markdown-body surface (#153)", async () => {
    render(<MarkdownViewer content="hello" filePath={FILE_PATH} />);

    await waitFor(() => {
      const body = document.querySelector(".markdown-body");
      expect(body).toBeInTheDocument();
      expect(body?.classList.contains("md-wrap-cascade")).toBe(true);
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

  // ── #65 G2: code-block hover copy button ────────────────────────────────
  it("clicking the copy button writes the raw code source to the clipboard", async () => {
    const content = "```js\nconst x = 1;\nconsole.log(x);\n```";
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    const btn = await screen.findByRole("button", { name: /copy code/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("const x = 1;\nconsole.log(x);");
    });
  });

  it("after click, the copy button reads 'Copied' then reverts to 'Copy' after 1.5s", async () => {
    const content = "```js\nconst x = 1;\n```";
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    const btn = await screen.findByRole("button", { name: /copy code/i });
    expect(btn).toHaveTextContent(/^Copy$/);

    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveTextContent(/^Copied$/));
    // The 1500ms revert timer runs on real timers; allow up to 3000ms to
    // avoid flake without slowing the suite materially.
    await waitFor(() => expect(btn).toHaveTextContent(/^Copy$/), {
      timeout: 3000,
    });
  });

  it("mermaid code blocks do NOT render a copy button", async () => {
    const content = "```mermaid\ngraph TD; A-->B;\n```";
    const { container } = render(
      <MarkdownViewer content={content} filePath={FILE_PATH} />,
    );
    await waitFor(() => {
      expect(document.querySelector(".markdown-body")).toBeInTheDocument();
    });
    expect(container.querySelector(".code-copy-btn")).toBeNull();
    expect(screen.queryByRole("button", { name: /copy code/i })).toBeNull();
  });

  it("plain ``` blocks (no language tag) DO render a copy button", async () => {
    const content = "```\nplain text\n```";
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);
    expect(
      await screen.findByRole("button", { name: /copy code/i }),
    ).toBeInTheDocument();
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
  it("relative image src gets transformed via convertAssetUrl", async () => {
    convertAssetUrlMock.mockClear();
    convertAssetUrlMock.mockImplementation((src: string) => `asset://${src}`);

    const content = `![alt](./image.png)`;
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      const img = document.querySelector("img");
      expect(img).toBeInTheDocument();
      expect(convertAssetUrlMock).toHaveBeenCalledWith("/docs/./image.png");
      expect(img?.src).toContain("asset://");
    });
  });

  it("https image is blocked by default and renders as a placeholder", async () => {
    convertAssetUrlMock.mockClear();

    const content = `![alt](https://example.com/img.png)`;
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      const placeholder = document.querySelector("[data-remote-image-placeholder]");
      expect(placeholder).toBeInTheDocument();
    });
    // No <img> element should be rendered for the blocked remote image.
    expect(document.querySelector("img")).not.toBeInTheDocument();
    // convertAssetUrl is for local paths only — must not be called for https.
    expect(convertAssetUrlMock).not.toHaveBeenCalledWith("https://example.com/img.png");
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

// ─── Iter 5 Wave 1 — split preserves dispatch behavior ───────────────────────

describe("Iter 5 Wave 1 — split-preservation", () => {
  it("fenced code block continues to be wrapped in <pre> (HighlightedCode fallback) under the commentable envelope", async () => {
    const content = "```ts\nconst x = 1;\n```";
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      // The pre callback now wraps in CommentableWrapper. While Shiki resolves
      // (mocked), HighlightedCode renders its <pre><code> fallback inside the
      // wrapper. Either path keeps the data-source-line on the wrapper.
      const wrapper = document.querySelector(".markdown-body .md-commentable-block");
      expect(wrapper).not.toBeNull();
    });
  });

  it("$$x$$ KaTeX block renders without throwing and keeps the body mounted", async () => {
    const content = "$$x = 1$$";
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);

    await waitFor(() => {
      // We don't load real rehype-katex in jsdom, but the rendering pipeline
      // must not throw — the markdown-body still mounts even before KaTeX
      // resolves.
      expect(document.querySelector(".markdown-body")).toBeInTheDocument();
    });
  });
});



// ─── F6: right-click context menu ───────────────────────────────────────────
describe("F6 – right-click context menu", () => {
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    "clipboard",
  ) ?? Object.getOwnPropertyDescriptor(navigator, "clipboard");

  beforeEach(() => {
    addCommentMock.mockClear();
  });

  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });

  async function openMenuOnLine(content: string, line: number) {
    render(<MarkdownViewer content={content} filePath={FILE_PATH} />);
    await waitFor(() => {
      expect(document.querySelector(".markdown-body")).toBeInTheDocument();
    });
    const lineEl = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-source-line="${line}"]`,
      );
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.contextMenu(lineEl, { clientX: 50, clientY: 60 });
    await waitFor(() => {
      expect(document.querySelector(".comment-context-menu")).not.toBeNull();
    });
  }

  it("right-click renders the menu with the three actions", async () => {
    await openMenuOnLine("# heading\n\nbody line", 3);
    expect(screen.getByRole("menuitem", { name: /Comment on selection/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Copy link to line/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Mark line as discussed/i })).toBeTruthy();
  });

  it("Mark line as discussed calls addComment with severity=none + body=discussed", async () => {
    await openMenuOnLine("# heading\n\nbody line", 3);
    fireEvent.click(screen.getByRole("menuitem", { name: /Mark line as discussed/i }));
    await waitFor(() => expect(addCommentMock).toHaveBeenCalled());
    const call = addCommentMock.mock.calls[0];
    expect(call[0]).toBe(FILE_PATH);
    expect(call[1]).toBe("discussed");
    expect(call[2]).toEqual({ kind: "line", line: 3 });
    expect(call[3]).toBeUndefined();
    expect(call[4]).toBe("none");
  });

  it("Copy link to line writes mdrv:// URL to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await openMenuOnLine("# heading\n\nbody line", 3);
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy link to line/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toMatch(/^mdrv:\/\/.*\?line=3$/);
  });
});
