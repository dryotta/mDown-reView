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
    setZoom: () => {},
    openFile: vi.fn(),
  };
  const useStore = (selector: (s: typeof state) => unknown) => selector(state);
  (useStore as unknown as { getState: () => typeof state }).getState = () => state;
  return { useStore };
});

import { HtmlPreviewView } from "../HtmlPreviewView";
import { openExternalUrl, fetchRemoteAsset, getFileViewerPref, setFileViewerPref } from "@/lib/tauri-commands";
import { warn } from "@/logger";

beforeEach(() => {
  (fetchRemoteAsset as unknown as { mockClear: () => void }).mockClear();
  (getFileViewerPref as unknown as { mockClear: () => void }).mockClear();
  (setFileViewerPref as unknown as { mockClear: () => void }).mockClear();
  vi.mocked(warn).mockClear();
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

  it("shows safety warning banner", () => {
    render(<HtmlPreviewView content="<p>test</p>" />);
    expect(screen.getByText(/sandboxed preview/i)).toBeInTheDocument();
    cleanup();
  });

  it("banner uses shared viewer-info-banner class with no inline style (#212)", () => {
    render(<HtmlPreviewView content="<p>test</p>" />);
    const banner = screen.getByText(/sandboxed preview/i).closest(".viewer-info-banner");
    expect(banner).toBeInTheDocument();
    expect(banner?.getAttribute("style")).toBeNull();
    cleanup();
  });

  it("toggling 'Allow external images' keeps sandbox at allow-same-origin", () => {
    const { container } = render(<HtmlPreviewView content="<p>test</p>" />);
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

describe("HtmlPreviewView  FileCommentBadge", () => {
  it("renders a FileCommentBadge when filePath is provided", () => {
    render(<HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />);
    expect(screen.getByRole("button", { name: /add comment/i })).toBeInTheDocument();
    cleanup();
  });
});

describe("HtmlPreviewView  image toggle persistence (#212)", () => {
  it("toggling images calls setFileViewerPref IPC for persistence", async () => {
    render(<HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />);
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
    render(<HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />);
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

describe("HtmlPreviewView — safe-mode link interception (H3)", () => {
  it("safe-mode iframe click on anchor calls openExternalUrl", () => {
    const { container } = render(
      <HtmlPreviewView content='<a href="https://example.com">link</a>' filePath="/wk/page.html" />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    // In safe mode (allow-same-origin), the onLoad handler installs a
    // click listener on contentDocument. jsdom exposes contentDocument
    // directly, so we simulate a click there.
    const doc = iframe.contentDocument;
    if (!doc) {
      // jsdom should provide contentDocument for srcdoc iframes
      throw new Error("contentDocument is null — jsdom limitation");
    }
    // Fire the iframe load event to trigger handler installation.
    fireEvent.load(iframe);
    // Now simulate a click on the anchor within the contentDocument.
    // jsdom doesn't parse srcdoc into the contentDocument, so we need to
    // create a synthetic anchor inside it.
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", "https://example.com");
    anchor.textContent = "link";
    doc.body.appendChild(anchor);
    fireEvent.click(anchor);
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com");
    cleanup();
  });
});
