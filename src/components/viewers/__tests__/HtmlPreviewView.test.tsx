import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";

const { addCommentMock } = vi.hoisted(() => ({
  addCommentMock: vi.fn<(filePath: string, text: string, anchor?: unknown) => Promise<void>>(
    async () => {},
  ),
}));

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");
vi.mock("@/lib/tauri-commands", () => ({
  resolveHtmlAssets: vi.fn((html: string) => Promise.resolve(html)),
  openExternalUrl: vi.fn(async () => {}),
}));
vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: () => ({ addComment: addCommentMock }),
}));

import { HtmlPreviewView } from "../HtmlPreviewView";

beforeEach(() => {
  addCommentMock.mockClear();
});

describe("HtmlPreviewView (legacy)", () => {
  it("renders sandboxed iframe with content", () => {
    const { container } = render(<HtmlPreviewView content="<h1>Hello</h1>" />);
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
  });

  it("shows safety warning banner", () => {
    render(<HtmlPreviewView content="<p>test</p>" />);
    expect(screen.getByText(/sandboxed preview/i)).toBeInTheDocument();
  });

  it("toggles to unsafe mode", () => {
    const { container } = render(<HtmlPreviewView content="<p>test</p>" />);
    fireEvent.click(screen.getByRole("button", { name: /enable scripts/i }));
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");
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

describe("HtmlPreviewView — comment-mode bridge", () => {
  it("selection event triggers addComment with html_range", async () => {
    const { container } = render(<HtmlPreviewView content="<p>hi</p>" filePath="/wk/page.html" />);
    fireEvent.click(screen.getByRole("button", { name: /enter comment mode/i }));
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    // Read the per-mount nonce from the injected srcdoc.
    const srcdoc = iframe.getAttribute("srcdoc") ?? "";
    const nonceMatch = srcdoc.match(/NONCE=("[^"]+")/);
    expect(nonceMatch).toBeTruthy();
    const nonce = JSON.parse(nonceMatch![1]) as string;

    dispatchBridgeMsg(iframe, {
      source: "mdr-html-bridge",
      nonce,
      type: "selection",
      selectorPath: "body > p",
      startOffset: 0,
      endOffset: 2,
      selectedText: "hi",
      clientX: 10,
      clientY: 20,
    });

    const composer = await screen.findByTestId("html-preview-composer");
    const textarea = composer.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "looks weird" } });
    fireEvent.click(composer.querySelector(".comment-btn-primary") as HTMLButtonElement);

    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const call = addCommentMock.mock.calls[0];
    expect(call[0]).toBe("/wk/page.html");
    expect(call[1]).toBe("looks weird");
    const anchor = call[2] as { kind: string; selector_path: string; start_offset: number; end_offset: number; selected_text: string };
    expect(anchor.kind).toBe("html_range");
    expect(anchor.selector_path).toBe("body > p");
    expect(anchor.start_offset).toBe(0);
    expect(anchor.end_offset).toBe(2);
    expect(anchor.selected_text).toBe("hi");
    cleanup();
  });

  it("click event triggers addComment with html_element", async () => {
    const { container } = render(<HtmlPreviewView content="<p>x</p>" filePath="/wk/page.html" />);
    fireEvent.click(screen.getByRole("button", { name: /enter comment mode/i }));
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const nonce = JSON.parse(iframe.getAttribute("srcdoc")!.match(/NONCE=("[^"]+")/)![1]) as string;

    dispatchBridgeMsg(iframe, {
      source: "mdr-html-bridge",
      nonce,
      type: "click",
      selectorPath: "body > p",
      tag: "p",
      textPreview: "x",
      clientX: 5,
      clientY: 5,
    });

    const composer = await screen.findByTestId("html-preview-composer");
    const textarea = composer.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "noted" } });
    fireEvent.click(composer.querySelector(".comment-btn-primary") as HTMLButtonElement);

    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const anchor = addCommentMock.mock.calls[0][2] as { kind: string; selector_path: string; tag: string; text_preview: string };
    expect(anchor.kind).toBe("html_element");
    expect(anchor.selector_path).toBe("body > p");
    expect(anchor.tag).toBe("p");
    expect(anchor.text_preview).toBe("x");
    cleanup();
  });

  it("messages with wrong nonce are ignored", () => {
    const { container } = render(<HtmlPreviewView content="<p>x</p>" filePath="/wk/page.html" />);
    fireEvent.click(screen.getByRole("button", { name: /enter comment mode/i }));
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    dispatchBridgeMsg(iframe, {
      source: "mdr-html-bridge",
      nonce: "WRONG",
      type: "click",
      selectorPath: "body",
      tag: "body",
      textPreview: "",
      clientX: 0,
      clientY: 0,
    });
    expect(screen.queryByTestId("html-preview-composer")).toBeNull();
    expect(addCommentMock).not.toHaveBeenCalled();
    cleanup();
  });

  it("messages from other windows are ignored", () => {
    const { container } = render(<HtmlPreviewView content="<p>x</p>" filePath="/wk/page.html" />);
    fireEvent.click(screen.getByRole("button", { name: /enter comment mode/i }));
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const nonce = JSON.parse(iframe.getAttribute("srcdoc")!.match(/NONCE=("[^"]+")/)![1]) as string;
    // source: a different window object (the host window itself)
    dispatchBridgeMsg(iframe, {
      source: "mdr-html-bridge",
      nonce,
      type: "click",
      selectorPath: "body",
      tag: "body",
      textPreview: "",
      clientX: 0,
      clientY: 0,
    }, window);
    expect(screen.queryByTestId("html-preview-composer")).toBeNull();
    cleanup();
  });

  it("comment-mode toggle gates message handling", () => {
    const { container } = render(<HtmlPreviewView content="<p>x</p>" filePath="/wk/page.html" />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;

    // Initially OFF — no nonce in srcdoc, dispatching anything is dropped.
    dispatchBridgeMsg(iframe, {
      source: "mdr-html-bridge",
      nonce: "anything",
      type: "click",
      selectorPath: "body",
      tag: "body",
      textPreview: "",
      clientX: 0,
      clientY: 0,
    });
    expect(screen.queryByTestId("html-preview-composer")).toBeNull();

    // Toggle ON.
    fireEvent.click(screen.getByRole("button", { name: /enter comment mode/i }));
    const iframe2 = container.querySelector("iframe") as HTMLIFrameElement;
    const nonce = JSON.parse(iframe2.getAttribute("srcdoc")!.match(/NONCE=("[^"]+")/)![1]) as string;
    dispatchBridgeMsg(iframe2, {
      source: "mdr-html-bridge", nonce, type: "click",
      selectorPath: "body", tag: "body", textPreview: "", clientX: 0, clientY: 0,
    });
    expect(screen.getByTestId("html-preview-composer")).toBeInTheDocument();

    // Toggle OFF — composer dismissed and further events ignored.
    fireEvent.click(screen.getByRole("button", { name: /exit comment mode/i }));
    expect(screen.queryByTestId("html-preview-composer")).toBeNull();
    dispatchBridgeMsg(iframe2, {
      source: "mdr-html-bridge", nonce, type: "click",
      selectorPath: "body", tag: "body", textPreview: "", clientX: 0, clientY: 0,
    });
    expect(screen.queryByTestId("html-preview-composer")).toBeNull();
    cleanup();
  });
});
