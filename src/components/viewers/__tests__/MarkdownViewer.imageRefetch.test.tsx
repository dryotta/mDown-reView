/**
 * Issue #359 / iter-2 — outside-workspace image re-fetch on banner grant.
 *
 * Regression: when the user clicks "Allow for this session" on the
 * tier-2 banner, `extendScopeForTab` grants asset-protocol scope and
 * bumps `allowedScopeGen`. Previously-mounted `<img>` nodes still hold
 * their pre-grant `asset://…` URLs which the WebView has cached as
 * failed responses; without busting those URLs the images stay broken
 * even though scope is now valid.
 *
 * Bug-expert flagged this as "Suspected (still — not in scope of this
 * diff)" during iter-1 review of #359. This test pins the fix.
 *
 * Without the fix (no `allowedScopeGen` consumer in `MarkdownViewer`),
 * the rendered `<img src>` does NOT change after the store mutation
 * and this test fails. With the fix, the src gains `?scopeGen=N`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { MarkdownViewer } from "../MarkdownViewer";
import { useStore } from "@/store";

vi.mock("@tauri-apps/api/core");

const convertAssetUrlMock = vi.fn((src: string) => `asset://${src}`);

vi.mock("@/lib/tauri-commands", async () => ({
  ...(await vi.importActual<typeof import("@/lib/tauri-commands")>("@/lib/tauri-commands")),
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
  convertAssetUrl: (src: string) => convertAssetUrlMock(src),
  fetchRemoteAsset: vi.fn(),
}));

vi.mock("@/logger");

vi.mock("@/lib/shiki", () => ({
  getSharedHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue("<pre><code>mock</code></pre>"),
    getLoadedLanguages: () => [],
    loadLanguage: vi.fn(),
  }),
}));

vi.mock("@shikijs/rehype", () => ({
  default: () => () => {},
}));

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: vi.fn(() => ({ threads: [], comments: [], loading: false, reload: vi.fn() })),
}));

vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: vi.fn(() => ({
    addComment: vi.fn(),
    addReply: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    resolveComment: vi.fn(),
    unresolveComment: vi.fn(),
  })),
}));

const FILE_PATH = "/sys/external/notes.md";
const CONTENT = "![pic](./pic.png)";

beforeEach(() => {
  vi.clearAllMocks();
  convertAssetUrlMock.mockImplementation((src: string) => `asset://${src}`);
  useStore.setState({
    allowOutsideWorkspace: new Set<string>(),
    allowedScopeGen: 0,
  } as never);
});

describe("MarkdownViewer image re-fetch on outside-workspace grant (#359 iter-2)", () => {
  it("appends ?scopeGen=N to asset:// img src after extendScopeForTab grants scope", async () => {
    render(<MarkdownViewer content={CONTENT} filePath={FILE_PATH} />);

    // Initial render: tab is NOT in allowOutsideWorkspace, scopeGen=0,
    // so the img src is the bare asset:// URL — no nonce.
    let img: HTMLImageElement | null = null;
    await waitFor(() => {
      img = document.querySelector("img");
      expect(img).not.toBeNull();
    });
    const initialSrc = img!.getAttribute("src") ?? "";
    expect(initialSrc).toContain("asset://");
    expect(initialSrc).not.toMatch(/scopeGen=/);

    // Simulate the post-IPC effect of `extendScopeForTab`: flip the
    // per-tab allow flag AND bump the scope-gen counter (the store
    // action does both atomically; we drive them directly here so the
    // test does not depend on the IPC mock surface).
    act(() => {
      useStore.getState().allowOutsideForTab(FILE_PATH);
      useStore.setState((s) => ({ allowedScopeGen: s.allowedScopeGen + 1 }) as never);
    });

    // After the grant, the rendered <img> must observe a NEW src
    // carrying the scope-gen nonce — proof that the browser will
    // re-fetch under the just-granted asset-protocol scope.
    await waitFor(() => {
      const refreshed = document.querySelector("img");
      expect(refreshed).not.toBeNull();
      const newSrc = refreshed!.getAttribute("src") ?? "";
      expect(newSrc).toMatch(/[?&]scopeGen=1\b/);
      expect(newSrc.startsWith("asset://")).toBe(true);
    });
  });

  it("does NOT bust the URL when the tab is not in the outside-workspace allow set", async () => {
    render(<MarkdownViewer content={CONTENT} filePath={FILE_PATH} />);

    await waitFor(() => {
      expect(document.querySelector("img")).not.toBeNull();
    });

    // Bumping the global counter alone (e.g., a sibling tab granted scope)
    // must NOT bust this tab's image URLs — only the granted tab gets the
    // nonce, so folder-internal images on other tabs stay cache-friendly.
    act(() => {
      useStore.setState((s) => ({ allowedScopeGen: s.allowedScopeGen + 1 }) as never);
    });

    const img = document.querySelector("img");
    expect(img?.getAttribute("src") ?? "").not.toMatch(/scopeGen=/);
  });
});

// ─── extendScopeForTab bumps allowedScopeGen ────────────────────────────────
// Ensures the store-side wiring matches the View's expectation: every
// successful banner grant produces an observable counter delta.
describe("extendScopeForTab counter bump (#359 iter-2)", () => {
  it("increments allowedScopeGen after IPC resolves", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation(async () => undefined);

    expect(useStore.getState().allowedScopeGen).toBe(0);
    await useStore.getState().extendScopeForTab("/sys/x.md");
    expect(useStore.getState().allowedScopeGen).toBe(1);
    await useStore.getState().extendScopeForTab("/sys/y.md");
    expect(useStore.getState().allowedScopeGen).toBe(2);
  });

  it("does NOT increment when IPC rejects (banner stays visible, no false re-fetch)", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "extend_window_scope_files") throw "denied";
      return undefined;
    });

    expect(useStore.getState().allowedScopeGen).toBe(0);
    await expect(useStore.getState().extendScopeForTab("/sys/x.md")).rejects.toBeDefined();
    expect(useStore.getState().allowedScopeGen).toBe(0);
  });
});
