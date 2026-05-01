import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");
vi.mock("@/lib/tauri-commands", () => ({
  resolveHtmlAssets: vi.fn((html: string) => Promise.resolve(html)),
  openExternalUrl: vi.fn(async () => {}),
  fetchRemoteAsset: vi.fn(async () => ({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    contentType: "image/png",
  })),
  getFileViewerPref: vi.fn(async () => null),
  setFileViewerPref: vi.fn(async () => {}),
}));

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: () => ({
    threads: [],
    comments: [],
    loading: false,
    reload: () => {},
  }),
}));

vi.mock("@/store", () => {
  const state = {
    root: "/wk",
    readingWidth: 800,
    toggleCommentsPane: vi.fn(),
    zoomByFiletype: {} as Record<string, number>,
    bumpZoom: () => {},
    setZoom: vi.fn((ext: string, val: number) => {
      state.zoomByFiletype[ext] = val;
    }),
    openFile: vi.fn(),
    pendingFragment: null as { path: string; fragment: string } | null,
    setPendingFragment: vi.fn((entry: { path: string; fragment: string } | null) => {
      state.pendingFragment = entry;
    }),
    consumePendingFragment: vi.fn((path: string) => {
      const p = state.pendingFragment;
      if (!p || p.path !== path) return null;
      state.pendingFragment = null;
      return p.fragment;
    }),
    // Issue #338 / Wave-2 — ViewerBanner subscribes to per-tab allow flags.
    allowOutsideWorkspace: new Set<string>(),
    allowedRemoteImageDocs: {} as Record<string, boolean>,
  };
  const useStore = (selector: (s: typeof state) => unknown) => selector(state);
  (useStore as unknown as { getState: () => typeof state }).getState = () => state;
  return { useStore };
});

// Issue #338 / Wave-2 — iframe link clicks delegate to `useLinkRouter` (the
// consumer-facing reduction). Mock the hook so unit tests can assert the
// dispatcher was invoked with the correct (href, ctx) without exercising the
// IPC `path_classify` chain. Per-route warn coverage lives in
// `useLinkRouter.test.ts`.
const mockDispatch = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useLinkRouter", () => ({
  useLinkRouter: () => mockDispatch,
}));

import { HtmlPreviewView } from "../HtmlPreviewView";
import { openExternalUrl, fetchRemoteAsset, getFileViewerPref, setFileViewerPref } from "@/lib/tauri-commands";
import { warn } from "@/logger";
import { useStore } from "@/store";

beforeEach(() => {
  (fetchRemoteAsset as unknown as { mockClear: () => void }).mockClear();
  (getFileViewerPref as unknown as { mockClear: () => void }).mockClear();
  (setFileViewerPref as unknown as { mockClear: () => void }).mockClear();
  vi.mocked(warn).mockClear();
  // Reset zoomByFiletype so per-test mutations cannot leak across tests.
  const state = (useStore as unknown as { getState: () => { zoomByFiletype: Record<string, number> } }).getState();
  state.zoomByFiletype = {};
});

describe("HtmlPreviewView  hard-locked sandbox", () => {
  it("renders sandboxed iframe with allow-same-origin only", () => {
    const { container } = render(<HtmlPreviewView content="<h1>Hello</h1>" />);
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
    cleanup();
  });

  it("does not render a scripts toggle button", () => {
    render(<HtmlPreviewView content="<p>test</p>" />);
    expect(screen.queryByRole("button", { name: /enable scripts/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /disable scripts/i })).not.toBeInTheDocument();
    cleanup();
  });

  it("hides the banner on benign HTML (no scripts, no external images)", () => {
    const { container } = render(<HtmlPreviewView content="<p>just text</p>" />);
    expect(container.querySelector(".viewer-info-banner")).not.toBeInTheDocument();
    cleanup();
  });

  it("shows a contextual 'scripts blocked' banner when content has <script>", () => {
    render(<HtmlPreviewView content="<p>hi</p><script>alert(1)</script>" />);
    expect(screen.getByText(/scripts blocked by sandbox/i)).toBeInTheDocument();
    // No external images → no toggle button.
    expect(screen.queryByRole("button", { name: /external images/i })).not.toBeInTheDocument();
    cleanup();
  });

  it("shows the 'External images disabled' banner + toggle when content has remote <img>", () => {
    render(<HtmlPreviewView content='<img src="https://example.com/x.png">' />);
    expect(screen.getByText(/external images disabled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /allow external images/i })).toBeInTheDocument();
    // Script copy is NOT present.
    expect(screen.queryByText(/scripts blocked/i)).not.toBeInTheDocument();
    cleanup();
  });

  it("combines copy when both <script> and remote <img> are present", () => {
    render(
      <HtmlPreviewView content='<script>x</script><img src="https://example.com/x.png">' />,
    );
    expect(
      screen.getByText(/scripts blocked by sandbox.*external images disabled/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /allow external images/i })).toBeInTheDocument();
    cleanup();
  });

  it("banner uses shared viewer-info-banner class with no inline style (#212)", () => {
    render(<HtmlPreviewView content="<script>x</script>" />);
    const banner = screen.getByText(/scripts blocked/i).closest(".viewer-info-banner");
    expect(banner).toBeInTheDocument();
    expect(banner?.getAttribute("style")).toBeNull();
    cleanup();
  });

  it("toggling 'Allow external images' keeps sandbox at allow-same-origin", () => {
    const { container } = render(
      <HtmlPreviewView content='<img src="https://example.com/x.png">' />,
    );
    const btn = screen.getByRole("button", { name: /allow external images/i });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
    cleanup();
  });

  it("sandbox NEVER contains allow-scripts", () => {
    const { container } = render(<HtmlPreviewView content="<p>test</p>" />);
    const sb = container.querySelector("iframe")?.getAttribute("sandbox") ?? "";
    expect(sb).not.toContain("allow-scripts");
    cleanup();
  });
});

describe("HtmlPreviewViewimage toggle persistence (#212)", () => {
  it("toggling images calls setFileViewerPref IPC for persistence", async () => {
    render(
      <HtmlPreviewView
        content='<img src="https://example.com/x.png">'
        filePath="/wk/page.html"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /allow external images/i }));
    await waitFor(() => {
      expect(setFileViewerPref).toHaveBeenCalledWith("/wk/page.html", true);
    });
    fireEvent.click(screen.getByRole("button", { name: /disallow external images/i }));
    await waitFor(() => {
      expect(setFileViewerPref).toHaveBeenCalledWith("/wk/page.html", false);
    });
    cleanup();
  });

  it("loads persisted pref on mount", async () => {
    (getFileViewerPref as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allow_images: true });
    render(
      <HtmlPreviewView
        content='<img src="https://example.com/x.png">'
        filePath="/wk/page.html"
      />,
    );
    await waitFor(() => {
      expect(getFileViewerPref).toHaveBeenCalledWith("/wk/page.html");
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /disallow external images/i })).toBeInTheDocument();
    });
    cleanup();
  });
});

describe("HtmlPreviewView  comment mode removed", () => {
  it("does not render a comment mode toggle button", () => {
    render(<HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />);
    expect(screen.queryByRole("button", { name: /comment mode/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enter comment/i })).not.toBeInTheDocument();
    cleanup();
  });
});

describe("HtmlPreviewView — iframe link dispatch (Wave-2)", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
  });

  it("anchor click in iframe delegates to useLinkRouter with iframeDoc", () => {
    const { container } = render(
      <HtmlPreviewView content='<a href="https://example.com">link</a>' filePath="/wk/page.html" />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument;
    if (!doc) {
      throw new Error("contentDocument is null — jsdom limitation");
    }
    fireEvent.load(iframe);
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", "https://example.com");
    anchor.textContent = "link";
    doc.body.appendChild(anchor);
    fireEvent.click(anchor);
    expect(mockDispatch).toHaveBeenCalledWith("https://example.com", {
      filePath: "/wk/page.html",
      iframeDoc: doc,
    });
    // The component never calls `openExternalUrl` directly anymore.
    expect(openExternalUrl).not.toHaveBeenCalled();
    cleanup();
  });

  it("workspace fragment click delegates to useLinkRouter (no inline routing)", () => {
    const { container } = render(
      <HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    fireEvent.load(iframe);
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", "./page.html#section-y");
    anchor.textContent = "same";
    doc.body.appendChild(anchor);
    fireEvent.click(anchor);
    expect(mockDispatch).toHaveBeenCalledWith("./page.html#section-y", {
      filePath: "/wk/page.html",
      iframeDoc: doc,
    });
    cleanup();
  });

  it("cross-file fragment click delegates to useLinkRouter", () => {
    const { container } = render(
      <HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    fireEvent.load(iframe);
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", "./other.html#section-x");
    anchor.textContent = "other";
    doc.body.appendChild(anchor);
    fireEvent.click(anchor);
    expect(mockDispatch).toHaveBeenCalledWith("./other.html#section-x", {
      filePath: "/wk/page.html",
      iframeDoc: doc,
    });
    cleanup();
  });

  it("fragment-only anchor click is intercepted (preventDefault) and dispatched", () => {
    const { container } = render(
      <HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    fireEvent.load(iframe);
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", "#how-it-works");
    anchor.textContent = "jump";
    doc.body.appendChild(anchor);
    const event = new doc.defaultView!.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mockDispatch).toHaveBeenCalledWith("#how-it-works", {
      filePath: "/wk/page.html",
      iframeDoc: doc,
    });
    cleanup();
  });

  // Blocked-route arms (absolute / scheme / other) MUST still preventDefault
  // at the component level so WebView2 cannot navigate while the async hook
  // resolves the IPC. Per-route warn assertions live in `useLinkRouter.test.ts`.
  it("absolute-blocked iframe anchor click is preventDefault'd and dispatched", () => {
    const { container } = render(
      <HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    fireEvent.load(iframe);
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", "/etc/passwd");
    anchor.textContent = "abs";
    doc.body.appendChild(anchor);
    const event = new doc.defaultView!.MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mockDispatch).toHaveBeenCalledWith("/etc/passwd", {
      filePath: "/wk/page.html",
      iframeDoc: doc,
    });
    expect(openExternalUrl).not.toHaveBeenCalled();
    cleanup();
  });

  it("scheme-blocked iframe anchor click is preventDefault'd and dispatched", () => {
    const { container } = render(
      <HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    fireEvent.load(iframe);
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", "javascript:alert(1)");
    anchor.textContent = "js";
    doc.body.appendChild(anchor);
    const event = new doc.defaultView!.MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mockDispatch).toHaveBeenCalledWith("javascript:alert(1)", {
      filePath: "/wk/page.html",
      iframeDoc: doc,
    });
    expect(openExternalUrl).not.toHaveBeenCalled();
    cleanup();
  });

  it("other-blocked iframe anchor click is preventDefault'd and dispatched", () => {
    const { container } = render(
      <HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    fireEvent.load(iframe);
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", "../../etc/passwd");
    anchor.textContent = "outside";
    doc.body.appendChild(anchor);
    const event = new doc.defaultView!.MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mockDispatch).toHaveBeenCalledWith("../../etc/passwd", {
      filePath: "/wk/page.html",
      iframeDoc: doc,
    });
    expect(openExternalUrl).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("HtmlPreviewView — zoom application", () => {
  it("sets `zoom` on iframe documentElement at default zoom (1.0)", () => {
    const { container } = render(<HtmlPreviewView content="<p>x</p>" />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("contentDocument is null — jsdom limitation");
    // Production code calls `setProperty("zoom", String(zoom))`. Read back
    // via the same accessor for an exact-match oracle (no regex).
    expect(doc.documentElement.style.getPropertyValue("zoom")).toBe("1");
    // Effect is silent — no warn() should fire for the happy path.
    expect(warn).not.toHaveBeenCalled();
    cleanup();
  });

  it("reflects a non-default store zoom on iframe documentElement", () => {
    const state = (useStore as unknown as { getState: () => { zoomByFiletype: Record<string, number> } }).getState();
    state.zoomByFiletype[".html"] = 1.25;

    const { container } = render(<HtmlPreviewView content="<p>x</p>" />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe.contentDocument!.documentElement.style.getPropertyValue("zoom")).toBe("1.25");
    cleanup();
  });

  it("re-applies `zoom` after iframe `load` (regression — srcDoc swap re-runs effect)", () => {
    const state = (useStore as unknown as { getState: () => { zoomByFiletype: Record<string, number> } }).getState();
    state.zoomByFiletype[".html"] = 1.5;

    const { container } = render(<HtmlPreviewView content="<p>x</p>" />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    // Simulate the wholesale-document swap that happens when `srcDoc` is
    // committed by removing the prior `zoom` property; the effect must
    // re-set it after the iframeDocEpoch bump triggered by `load`.
    doc.documentElement.style.removeProperty("zoom");
    expect(doc.documentElement.style.getPropertyValue("zoom")).toBe("");

    fireEvent.load(iframe);
    expect(doc.documentElement.style.getPropertyValue("zoom")).toBe("1.5");
    cleanup();
  });

  it("re-applies `zoom` when the store value changes (regression — `zoom` dep)", () => {
    const state = (useStore as unknown as { getState: () => { zoomByFiletype: Record<string, number> } }).getState();
    state.zoomByFiletype[".html"] = 1;

    const { container, rerender } = render(<HtmlPreviewView content="<p>x</p>" />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe.contentDocument!.documentElement.style.getPropertyValue("zoom")).toBe("1");

    state.zoomByFiletype[".html"] = 2;
    rerender(<HtmlPreviewView content="<p>x</p>" />);
    expect(iframe.contentDocument!.documentElement.style.getPropertyValue("zoom")).toBe("2");
    cleanup();
  });

  it("wrapper no longer carries an inline fontSize style (regression — wrapper CSS does not cross iframe boundary)", () => {
    const { container } = render(<HtmlPreviewView content="<p>x</p>" />);
    const wrapper = container.querySelector(".html-preview") as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.fontSize).toBe("");
    cleanup();
  });
});

describe("HtmlPreviewView — anchor title injection", () => {
  it("stamps title attributes on anchors in the resolved srcDoc", async () => {
    const { container } = render(
      <HtmlPreviewView
        content='<a href="./other.html">x</a> <a href="https://example.com">y</a>'
        filePath="/wk/page.html"
      />,
    );
    await waitFor(() => {
      const iframe = container.querySelector("iframe") as HTMLIFrameElement;
      const srcDoc = iframe.getAttribute("srcdoc") ?? "";
      expect(srcDoc).toContain('title="other.html"');
      expect(srcDoc).toContain('title="https://example.com"');
    });
    cleanup();
  });
});
