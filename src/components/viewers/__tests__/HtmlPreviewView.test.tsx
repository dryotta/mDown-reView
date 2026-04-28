import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";

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

import { HtmlPreviewView } from "../HtmlPreviewView";
import { openExternalUrl, fetchRemoteAsset, getFileViewerPref, setFileViewerPref } from "@/lib/tauri-commands";
import { warn } from "@/logger";
import { useStore } from "@/store";

beforeEach(() => {
  (openExternalUrl as unknown as { mockClear: () => void }).mockClear();
  (fetchRemoteAsset as unknown as { mockClear: () => void }).mockClear();
  (getFileViewerPref as unknown as { mockClear: () => void }).mockClear();
  (setFileViewerPref as unknown as { mockClear: () => void }).mockClear();
  vi.mocked(warn).mockClear();
});

describe("HtmlPreviewView — sandbox toggles (H1)", () => {
  it("renders sandboxed iframe with default safe sandbox", () => {
    const { container } = render(<HtmlPreviewView content="<h1>Hello</h1>" />);
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(screen.getByRole("button", { name: /allow external images/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enable scripts/i })).toBeInTheDocument();
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

  it("toggling 'Allow external images' keeps sandbox safe and flips aria-pressed", () => {
    const { container } = render(<HtmlPreviewView content="<p>test</p>" />);
    const btn = screen.getByRole("button", { name: /allow external images/i });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
    const btn2 = screen.getByRole("button", { name: /disallow external images/i });
    expect(btn2.getAttribute("aria-pressed")).toBe("true");
    cleanup();
  });

  it("toggling 'Enable scripts' switches sandbox to allow-scripts (no allow-same-origin)", () => {
    const { container } = render(<HtmlPreviewView content="<p>test</p>" />);
    fireEvent.click(screen.getByRole("button", { name: /enable scripts/i }));
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");
    cleanup();
  });

  it("invariant: sandbox NEVER combines allow-scripts and allow-same-origin", () => {
    const { container } = render(<HtmlPreviewView content="<p>test</p>" />);
    const imgBtn = () => screen.getByRole("button", { name: /(allow|disallow) external images/i });
    const scrBtn = () => screen.getByRole("button", { name: /(enable|disable) scripts/i });
    const sandboxOf = () => container.querySelector("iframe")!.getAttribute("sandbox") ?? "";
    const combos: [boolean, boolean][] = [[false,false],[true,false],[false,true],[true,true],[true,false],[false,false]];
    let curImg = false, curScr = false;
    for (const [wantImg, wantScr] of combos) {
      if (wantImg !== curImg) { fireEvent.click(imgBtn()); curImg = wantImg; }
      if (wantScr !== curScr) { fireEvent.click(scrBtn()); curScr = wantScr; }
      const sb = sandboxOf();
      const hasScripts = sb.includes("allow-scripts");
      const hasSameOrigin = sb.includes("allow-same-origin");
      expect(hasScripts && hasSameOrigin).toBe(false);
    }
    cleanup();
  });

  it("with images on + scripts off, fetches remote <img> via fetch_remote_asset", async () => {
    // jsdom URL.createObjectURL is not implemented by default — stub it.
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let next = 0;
    URL.createObjectURL = vi.fn(() => `blob:mock-${++next}`) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    try {
      const html = '<p><img src="https://cdn.example.com/x.png" alt="x"></p>';
      const { container } = render(<HtmlPreviewView content={html} filePath="/wk/page.html" />);
      fireEvent.click(screen.getByRole("button", { name: /allow external images/i }));
      await waitFor(() => {
        expect(fetchRemoteAsset).toHaveBeenCalledWith("https://cdn.example.com/x.png");
      });
      await waitFor(() => {
        const srcdoc = container.querySelector("iframe")?.getAttribute("srcdoc") ?? "";
        expect(srcdoc).toMatch(/src="blob:mock-\d+"/);
      });
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      cleanup();
    }
  });

  it("toggling images calls setFileViewerPref IPC for persistence (#212)", async () => {
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

  it("loads persisted pref on mount (#212)", async () => {
    (getFileViewerPref as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allow_images: true });
    render(<HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />);
    await waitFor(() => {
      expect(getFileViewerPref).toHaveBeenCalledWith("/wk/page.html");
    });
    // The button should reflect the persisted state
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /disallow external images/i })).toBeInTheDocument();
    });
    cleanup();
  });
});

// Helper: dispatch a synthetic MessageEvent that mimics what the bridge IIFE
// would post. The handler filters by `event.source` so we have to spoof the
// iframe contentWindow as the source.
function dispatchBridgeMsg(
  iframe: HTMLIFrameElement | null,
  data: Record<string, unknown>,
  sourceOverride?: Window | null,
) {
  const source = sourceOverride !== undefined ? sourceOverride : (iframe?.contentWindow ?? null);
  const ev = new MessageEvent("message", { data, source: source as Window | null });
  act(() => {
    window.dispatchEvent(ev);
  });
}

function nonceOf(iframe: HTMLIFrameElement): string {
  const srcdoc = iframe.getAttribute("srcdoc") ?? "";
  const m = srcdoc.match(/NONCE=("[^"]+")/);
  if (!m) throw new Error("no NONCE in srcdoc");
  return JSON.parse(m[1]) as string;
}

describe("HtmlPreviewView — comment mode removed", () => {
  it("does not render a comment mode toggle button", () => {
    render(<HtmlPreviewView content="<p>test</p>" filePath="/wk/page.html" />);
    expect(screen.queryByRole("button", { name: /comment mode/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enter comment/i })).not.toBeInTheDocument();
    cleanup();
  });
});

describe("HtmlPreviewView — link bridge in scripts mode (H2)", () => {
  function enableScripts() {
    fireEvent.click(screen.getByRole("button", { name: /enable scripts/i }));
  }

  it("external link → openExternalUrl", () => {
    const { container } = render(<HtmlPreviewView content="<p>x</p>" filePath="/wk/page.html" />);
    enableScripts();
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const nonce = nonceOf(iframe);
    dispatchBridgeMsg(iframe, {
      source: "mdr-html-bridge", nonce, type: "link", href: "https://example.com",
    });
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com");
    cleanup();
  });

  it("workspace link → store.openFile with resolved path", () => {
    useStore.setState({ root: "/wk" });
    const openFileSpy = vi.spyOn(useStore.getState(), "openFile").mockImplementation(() => {});
    const { container } = render(<HtmlPreviewView content="<p>x</p>" filePath="/wk/page.html" />);
    enableScripts();
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const nonce = nonceOf(iframe);
    dispatchBridgeMsg(iframe, {
      source: "mdr-html-bridge", nonce, type: "link", href: "./other.md",
    });
    expect(openFileSpy).toHaveBeenCalledWith("/wk/other.md");
    openFileSpy.mockRestore();
    cleanup();
  });

  it("javascript: link is blocked, openExternalUrl NOT called", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<HtmlPreviewView content="<p>x</p>" filePath="/wk/page.html" />);
    enableScripts();
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const nonce = nonceOf(iframe);
    dispatchBridgeMsg(iframe, {
      source: "mdr-html-bridge", nonce, type: "link", href: "javascript:alert(1)",
    });
    expect(openExternalUrl).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    cleanup();
  });

  it("non-string href is blocked", () => {
    const { container } = render(<HtmlPreviewView content="<p>x</p>" filePath="/wk/page.html" />);
    enableScripts();
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const nonce = nonceOf(iframe);
    dispatchBridgeMsg(iframe, {
      source: "mdr-html-bridge", nonce, type: "link", href: 42,
    });
    expect(openExternalUrl).not.toHaveBeenCalled();
    cleanup();
  });

  it("link message with wrong nonce is ignored", () => {
    const { container } = render(<HtmlPreviewView content="<p>x</p>" filePath="/wk/page.html" />);
    enableScripts();
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    dispatchBridgeMsg(iframe, {
      source: "mdr-html-bridge", nonce: "WRONG", type: "link", href: "https://evil.example",
    });
    expect(openExternalUrl).not.toHaveBeenCalled();
    cleanup();
  });

  it("openExternalUrl failure logs via warn()", async () => {
    vi.mocked(openExternalUrl).mockRejectedValueOnce(new Error("plugin unavailable"));
    const { container } = render(<HtmlPreviewView content="<p>x</p>" filePath="/wk/page.html" />);
    enableScripts();
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const nonce = nonceOf(iframe);
    dispatchBridgeMsg(iframe, {
      source: "mdr-html-bridge", nonce, type: "link", href: "https://example.com",
    });
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("[HtmlPreviewView] link open failed:"),
      );
    });
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
