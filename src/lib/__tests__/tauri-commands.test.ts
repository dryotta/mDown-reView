import { describe, it, expect, vi, beforeEach } from "vitest";
import { convertFileSrc } from "@tauri-apps/api/core";

// Mock the underlying Tauri plugins. The wrappers in tauri-commands.ts use
// dynamic imports, so vi.mock intercepts them when the wrapper is invoked.
const writeText = vi.fn().mockResolvedValue(undefined);
const openUrl = vi.fn().mockResolvedValue(undefined);
const relaunch = vi.fn().mockResolvedValue(undefined);
const open = vi.fn().mockResolvedValue("/some/path");

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));

vi.mock("@tauri-apps/api/core");

import {
  convertAssetUrl,
  copyToClipboard,
  openExternalUrl,
  restartApp,
  showOpenDialog,
} from "../tauri-commands";

beforeEach(() => {
  writeText.mockClear();
  openUrl.mockClear();
  relaunch.mockClear();
  open.mockClear();
  // Re-apply the shared mock's convertFileSrc implementation. Vitest's
  // global `vi.restoreAllMocks()` (in test-setup.ts) wipes implementations
  // of `vi.fn()` mocks between tests, so we must re-prime this each time.
  vi.mocked(convertFileSrc).mockImplementation(
    (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
  );
});

describe("copyToClipboard", () => {
  it("forwards text to plugin writeText", async () => {
    await copyToClipboard("hello world");
    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("handles empty string", async () => {
    await copyToClipboard("");
    expect(writeText).toHaveBeenCalledWith("");
  });

  it("propagates errors from the underlying plugin", async () => {
    writeText.mockRejectedValueOnce(new Error("clipboard locked"));
    await expect(copyToClipboard("x")).rejects.toThrow("clipboard locked");
  });
});

describe("openExternalUrl", () => {
  it("forwards https URLs to plugin openUrl", async () => {
    await openExternalUrl("https://example.com");
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("forwards http URLs to plugin openUrl", async () => {
    await openExternalUrl("http://example.com");
    expect(openUrl).toHaveBeenCalledWith("http://example.com");
  });

  it("forwards mailto: URLs to plugin openUrl", async () => {
    await openExternalUrl("mailto:user@example.com");
    expect(openUrl).toHaveBeenCalledWith("mailto:user@example.com");
  });

  it("forwards tel: URLs to plugin openUrl", async () => {
    await openExternalUrl("tel:+15555550123");
    expect(openUrl).toHaveBeenCalledWith("tel:+15555550123");
  });

  it("rejects file:// URLs without calling plugin", async () => {
    await expect(openExternalUrl("file:///etc/passwd")).rejects.toThrow(/Blocked/);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("rejects javascript: URLs without calling plugin", async () => {
    await expect(openExternalUrl("javascript:alert(1)")).rejects.toThrow(/Blocked/);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("rejects data: URLs without calling plugin", async () => {
    await expect(openExternalUrl("data:text/html,<script>alert(1)</script>")).rejects.toThrow(/Blocked/);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("rejects vbscript: URLs without calling plugin", async () => {
    await expect(openExternalUrl("vbscript:msgbox(1)")).rejects.toThrow(/Blocked/);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("rejects smb: URLs without calling plugin", async () => {
    await expect(openExternalUrl("smb://evil/share")).rejects.toThrow(/Blocked/);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("rejects empty string", async () => {
    await expect(openExternalUrl("")).rejects.toThrow(/Blocked/);
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("restartApp", () => {
  it("calls plugin relaunch with no args", async () => {
    await restartApp();
    expect(relaunch).toHaveBeenCalledWith();
  });

  it("propagates errors from the underlying plugin", async () => {
    relaunch.mockRejectedValueOnce(new Error("relaunch failed"));
    await expect(restartApp()).rejects.toThrow("relaunch failed");
  });
});

describe("convertAssetUrl", () => {
  it("delegates to convertFileSrc and returns its asset URL", async () => {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const mock = convertFileSrc as ReturnType<typeof vi.fn>;
    mock.mockClear();

    const result = convertAssetUrl("/abs/path/to/image.png");

    expect(mock).toHaveBeenCalledWith("/abs/path/to/image.png");
    expect(result).toBe(`asset://localhost/${encodeURIComponent("/abs/path/to/image.png")}`);
  });

  it("passes the path through unchanged", async () => {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const mock = convertFileSrc as ReturnType<typeof vi.fn>;
    mock.mockClear();

    convertAssetUrl("C:\\Users\\me\\file.png");
    expect(mock).toHaveBeenCalledWith("C:\\Users\\me\\file.png");
  });
});

describe("showOpenDialog", () => {
  it("forwards options to plugin open", async () => {
    open.mockResolvedValueOnce("/a/b");
    const result = await showOpenDialog({ directory: true, multiple: false });
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(result).toBe("/a/b");
  });

  it("uses empty options object as default", async () => {
    open.mockResolvedValueOnce(null);
    const result = await showOpenDialog();
    expect(open).toHaveBeenCalledWith({});
    expect(result).toBeNull();
  });

  it("returns array result for multiple=true", async () => {
    open.mockResolvedValueOnce(["/a", "/b"]);
    const result = await showOpenDialog({ multiple: true });
    expect(result).toEqual(["/a", "/b"]);
  });
});

describe("comment-mutation wrappers", () => {
  it("editComment forwards filePath, commentId, text to invoke", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const m = invoke as ReturnType<typeof vi.fn>;
    m.mockClear();
    m.mockResolvedValueOnce(undefined);
    const { editComment } = await import("../tauri-commands");
    await editComment("/p/file.md", "c1", "new text");
    expect(m).toHaveBeenCalledWith("edit_comment", {
      filePath: "/p/file.md",
      commentId: "c1",
      text: "new text",
    });
  });

  it("deleteComment forwards filePath and commentId to invoke", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const m = invoke as ReturnType<typeof vi.fn>;
    m.mockClear();
    m.mockResolvedValueOnce(undefined);
    const { deleteComment } = await import("../tauri-commands");
    await deleteComment("/p/file.md", "c2");
    expect(m).toHaveBeenCalledWith("delete_comment", {
      filePath: "/p/file.md",
      commentId: "c2",
    });
  });
});

describe("installUpdate", () => {
  it("invokes install_update with no args", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const m = invoke as ReturnType<typeof vi.fn>;
    m.mockClear();
    m.mockResolvedValueOnce(undefined);
    const { installUpdate } = await import("../tauri-commands");
    await installUpdate();
    expect(m).toHaveBeenCalledWith("install_update");
  });

  it("propagates errors from the underlying invoke", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const m = invoke as ReturnType<typeof vi.fn>;
    m.mockClear();
    m.mockRejectedValueOnce(new Error("bundle fetch failed"));
    const { installUpdate } = await import("../tauri-commands");
    await expect(installUpdate()).rejects.toThrow("bundle fetch failed");
  });
});

describe("tokenizeWords", () => {
  it("calls invoke('tokenize_words', { text }) and returns the spans", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const m = invoke as ReturnType<typeof vi.fn>;
    m.mockClear();
    m.mockResolvedValueOnce([
      { start: 0, end: 5, text: "hello" },
      { start: 6, end: 11, text: "world" },
    ]);
    const { tokenizeWords } = await import("../tauri-commands");
    const spans = await tokenizeWords("hello world");
    expect(m).toHaveBeenCalledWith("tokenize_words", { text: "hello world" });
    expect(spans).toEqual([
      { start: 0, end: 5, text: "hello" },
      { start: 6, end: 11, text: "world" },
    ]);
  });

  it("returns an empty array when invoke resolves with []", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const m = invoke as ReturnType<typeof vi.fn>;
    m.mockClear();
    m.mockResolvedValueOnce([]);
    const { tokenizeWords } = await import("../tauri-commands");
    const spans = await tokenizeWords("");
    expect(m).toHaveBeenCalledWith("tokenize_words", { text: "" });
    expect(spans).toEqual([]);
  });
});

describe("deriveAnchor — WordRange (Group D-wire, iter 3)", () => {
  it("derives a word_range Anchor from the flat word_range payload sibling", async () => {
    const { deriveAnchor } = await import("@/types/comments");
    const a = deriveAnchor({
      id: "c1",
      author: "a",
      timestamp: "t",
      text: "x",
      resolved: false,
      anchor_kind: "word_range",
      word_range: {
        start_word: 2,
        end_word: 5,
        line: 7,
        snippet: "the quick brown",
        line_text_hash: "a".repeat(64),
      },
    });
    expect(a.kind).toBe("word_range");
    if (a.kind === "word_range") {
      expect(a.start_word).toBe(2);
      expect(a.end_word).toBe(5);
      expect(a.line).toBe(7);
      expect(a.snippet).toBe("the quick brown");
      expect(a.line_text_hash.length).toBe(64);
    }
  });

  it("falls through to derived line anchor when word_range payload is missing", async () => {
    const { deriveAnchor } = await import("@/types/comments");
    const a = deriveAnchor({
      id: "c1",
      author: "a",
      timestamp: "t",
      text: "x",
      resolved: false,
      anchor_kind: "word_range",
      line: 9,
    });
    // Missing payload: deriveAnchor's switch breaks out and falls back to
    // the flat-line constructor (matches the established sibling pattern).
    expect(a.kind).toBe("line");
    if (a.kind === "line") expect(a.line).toBe(9);
  });
});

describe("onboarding & platform-integration wrappers", () => {
  async function getInvoke() {
    const { invoke } = await import("@tauri-apps/api/core");
    const m = invoke as ReturnType<typeof vi.fn>;
    m.mockClear();
    return m;
  }

  it("onboardingState calls onboarding_state with no args", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce({
      schema_version: 1,
      last_welcomed_version: null,
      last_seen_sections: [],
    });
    const { onboardingState } = await import("../tauri-commands");
    const r = await onboardingState();
    expect(m).toHaveBeenCalledWith("onboarding_state");
    expect(r.schema_version).toBe(1);
  });

  it("onboardingMarkWelcomed forwards version", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce(undefined);
    const { onboardingMarkWelcomed } = await import("../tauri-commands");
    await onboardingMarkWelcomed("0.3.4");
    expect(m).toHaveBeenCalledWith("onboarding_mark_welcomed", { version: "0.3.4" });
  });

  it("cliShimStatus returns the status string from invoke", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce("done");
    const { cliShimStatus } = await import("../tauri-commands");
    const r = await cliShimStatus();
    expect(m).toHaveBeenCalledWith("cli_shim_status");
    expect(r).toBe("done");
  });

  it("cliShimStatus propagates invoke errors", async () => {
    const m = await getInvoke();
    m.mockRejectedValueOnce(new Error("ipc dead"));
    const { cliShimStatus } = await import("../tauri-commands");
    await expect(cliShimStatus()).rejects.toThrow("ipc dead");
  });

  it("installCliShim calls install_cli_shim", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce(undefined);
    const { installCliShim } = await import("../tauri-commands");
    await installCliShim();
    expect(m).toHaveBeenCalledWith("install_cli_shim");
  });

  it("removeCliShim calls remove_cli_shim", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce(undefined);
    const { removeCliShim } = await import("../tauri-commands");
    await removeCliShim();
    expect(m).toHaveBeenCalledWith("remove_cli_shim");
  });

  it("defaultHandlerStatus returns status string", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce("unknown");
    const { defaultHandlerStatus } = await import("../tauri-commands");
    const r = await defaultHandlerStatus();
    expect(m).toHaveBeenCalledWith("default_handler_status");
    expect(r).toBe("unknown");
  });

  it("setDefaultHandler calls set_default_handler", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce(undefined);
    const { setDefaultHandler } = await import("../tauri-commands");
    await setDefaultHandler();
    expect(m).toHaveBeenCalledWith("set_default_handler");
  });

  it("folderContextStatus returns status string", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce("missing");
    const { folderContextStatus } = await import("../tauri-commands");
    const r = await folderContextStatus();
    expect(m).toHaveBeenCalledWith("folder_context_status");
    expect(r).toBe("missing");
  });

  it("registerFolderContext calls register_folder_context", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce(undefined);
    const { registerFolderContext } = await import("../tauri-commands");
    await registerFolderContext();
    expect(m).toHaveBeenCalledWith("register_folder_context");
  });

  it("unregisterFolderContext calls unregister_folder_context", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce(undefined);
    const { unregisterFolderContext } = await import("../tauri-commands");
    await unregisterFolderContext();
    expect(m).toHaveBeenCalledWith("unregister_folder_context");
  });
});

describe("system integration wrappers (Section E)", () => {
  async function getInvoke() {
    const { invoke } = await import("@tauri-apps/api/core");
    const m = invoke as ReturnType<typeof vi.fn>;
    m.mockClear();
    return m;
  }

  it("revealInFolder forwards path to reveal_in_folder", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce(undefined);
    const { revealInFolder } = await import("../tauri-commands");
    await revealInFolder("/ws/sample.bin");
    expect(m).toHaveBeenCalledWith("reveal_in_folder", { path: "/ws/sample.bin" });
  });

  it("openInDefaultApp forwards path to open_in_default_app", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce(undefined);
    const { openInDefaultApp } = await import("../tauri-commands");
    await openInDefaultApp("/ws/sample.bin");
    expect(m).toHaveBeenCalledWith("open_in_default_app", { path: "/ws/sample.bin" });
  });

  it("statFile forwards path to stat_file and returns the FileStat", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce({ size_bytes: 4242 });
    const { statFile } = await import("../tauri-commands");
    const result = await statFile("/ws/foo.bin");
    expect(m).toHaveBeenCalledWith("stat_file", { path: "/ws/foo.bin" });
    expect(result).toEqual({ size_bytes: 4242 });
  });

  it("revealInFolder propagates rejection (typed SystemError)", async () => {
    const m = await getInvoke();
    m.mockRejectedValueOnce({ kind: "PathOutsideWorkspace" });
    const { revealInFolder } = await import("../tauri-commands");
    await expect(revealInFolder("/etc/shadow")).rejects.toMatchObject({
      kind: "PathOutsideWorkspace",
    });
  });
});



//  Iter 1 / F0  new IPC surface dispatch table 

describe("F0 IPC surface", () => {
  // Re-import to pick up the same mocked invoke. These tests assert that the
  // TS wrappers route to the correct Tauri command name with the correct
  // argument shape  the dispatch contract that keeps the IPC chokepoint
  // honest.
  it("updateComment dispatches to update_comment with patch payload", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    const { updateComment } = await import("../tauri-commands");
    await updateComment("/ws/a.md", "c1", {
      kind: "set_resolved",
      data: { resolved: true },
    });
    expect(invoke).toHaveBeenCalledWith("update_comment", {
      filePath: "/ws/a.md",
      commentId: "c1",
      patch: { kind: "set_resolved", data: { resolved: true } },
    });
  });

  it("updateComment forwards set_resolved=false for unresolve", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    const { updateComment } = await import("../tauri-commands");
    await updateComment("/ws/a.md", "c2", {
      kind: "set_resolved",
      data: { resolved: false },
    });
    expect(invoke).toHaveBeenCalledWith("update_comment", {
      filePath: "/ws/a.md",
      commentId: "c2",
      patch: { kind: "set_resolved", data: { resolved: false } },
    });
  });

  it("updateComment dispatches move_anchor with tagged Anchor payload", async () => {
    // Wire-shape contract: the tagged `{kind, anchor_kind, ...}` Anchor must
    // pass through unchanged so the Rust `AnchorRepr` deserialiser accepts
    // it. Asserting the exact patch object guards against an over-eager
    // wrapper introducing accidental field reshaping.
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    const { updateComment } = await import("../tauri-commands");
    await updateComment("/ws/a.md", "c3", {
      kind: "move_anchor",
      data: { new_anchor: { kind: "file" } },
    });
    expect(invoke).toHaveBeenCalledWith("update_comment", {
      filePath: "/ws/a.md",
      commentId: "c3",
      patch: { kind: "move_anchor", data: { new_anchor: { kind: "file" } } },
    });
  });

  it("getFileBadges dispatches to get_file_badges with filePaths", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValueOnce({ "/ws/a.md": { count: 2, max_severity: "high" } });
    const { getFileBadges } = await import("../tauri-commands");
    const out = await getFileBadges(["/ws/a.md"]);
    expect(invoke).toHaveBeenCalledWith("get_file_badges", { filePaths: ["/ws/a.md"] });
    expect(out["/ws/a.md"].count).toBe(2);
    expect(out["/ws/a.md"].max_severity).toBe("high");
  });

  it("exportReviewSummary dispatches to export_review_summary", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValueOnce("# Review summary\n");
    const { exportReviewSummary } = await import("../tauri-commands");
    const out = await exportReviewSummary("/ws");
    expect(invoke).toHaveBeenCalledWith("export_review_summary", { workspace: "/ws" });
    expect(out).toContain("# Review summary");
  });

  it("setAuthor dispatches to set_author and returns trimmed name", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValueOnce("Alice");
    const { setAuthor } = await import("../tauri-commands");
    const out = await setAuthor("  Alice  ");
    expect(invoke).toHaveBeenCalledWith("set_author", { name: "  Alice  " });
    expect(out).toBe("Alice");
  });

  it("does not log to console.error during the dispatch happy path", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const { updateComment } = await import("../tauri-commands");
    await updateComment("/ws/a.md", "c1", {
      kind: "add_reaction",
      data: { user: "u", kind: "thumbs_up", ts: "2025-01-01T00:00:00Z" },
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── Iter 2 / Group B — Anchor discriminated union ────────────────────────
//
// `MrsfComment.anchor` is a tagged union whose `kind` matches the Rust
// serde wire `anchor_kind` (snake_case). These tests exercise the IPC
// mock fixture path: the wrapper returns shapes carrying `anchor` so
// downstream consumers can discriminate on `anchor.kind` instead of the
// removed flat sibling fields.

describe("getFileComments — Anchor discriminated union", () => {
  async function getInvoke() {
    const { invoke } = await import("@tauri-apps/api/core");
    const m = invoke as ReturnType<typeof vi.fn>;
    m.mockClear();
    return m;
  }

  it("returns comments with anchor.kind === 'line' for line-anchored fixture", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce([
      {
        root: {
          id: "c-line",
          author: "tester",
          timestamp: "2025-01-01T00:00:00Z",
          text: "line-anchored",
          resolved: false,
          line: 7,
          matchedLineNumber: 7,
          isOrphaned: false,
          // NB: real wire never includes `anchor` for v1.0 line-anchored
          // comments. Test mirrors that — derivation through `deriveAnchor`
          // is what production code must use.
        },
        replies: [],
      },
    ]);
    const { getFileComments } = await import("../tauri-commands");
    const { deriveAnchor } = await import("@/types/comments");
    const threads = await getFileComments("/ws/a.md");
    expect(threads).toHaveLength(1);
    const root = threads[0].root;
    expect((root as { anchor?: unknown }).anchor).toBeUndefined();
    const a = deriveAnchor(root);
    expect(a.kind).toBe("line");
    if (a.kind === "line") {
      expect(a.line).toBe(7);
    }
  });

  it("returns comments with anchor.kind === 'image_rect' for image-anchored fixture", async () => {
    const m = await getInvoke();
    m.mockResolvedValueOnce([
      {
        root: {
          id: "c-img",
          author: "tester",
          timestamp: "2025-01-01T00:00:00Z",
          text: "image-anchored",
          resolved: false,
          matchedLineNumber: 0,
          isOrphaned: false,
          anchor_kind: "image_rect",
          image_rect: {
            x_pct: 0.25,
            y_pct: 0.5,
            w_pct: 0.1,
            h_pct: 0.1,
          },
        },
        replies: [],
      },
    ]);
    const { getFileComments } = await import("../tauri-commands");
    const { deriveAnchor } = await import("@/types/comments");
    const threads = await getFileComments("/ws/img.png");
    expect(threads).toHaveLength(1);
    const root = threads[0].root;
    const a = deriveAnchor(root);
    expect(a.kind).toBe("image_rect");
    if (a.kind === "image_rect") {
      expect(a.x_pct).toBeCloseTo(0.25);
      expect(a.y_pct).toBeCloseTo(0.5);
    }
  });

  it("does not log to console.error during the dispatch happy path", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await getInvoke();
    m.mockResolvedValueOnce([]);
    const { getFileComments } = await import("../tauri-commands");
    const threads = await getFileComments("/ws/empty.md");
    expect(threads).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
