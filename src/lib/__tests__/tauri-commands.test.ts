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

  it("rejects file:// URLs without calling plugin", async () => {
    await expect(openExternalUrl("file:///etc/passwd")).rejects.toThrow(/Blocked/);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("rejects javascript: URLs without calling plugin", async () => {
    await expect(openExternalUrl("javascript:alert(1)")).rejects.toThrow(/Blocked/);
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

  it("setCommentResolved forwards resolved flag to invoke", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const m = invoke as ReturnType<typeof vi.fn>;
    m.mockClear();
    m.mockResolvedValueOnce(undefined);
    const { setCommentResolved } = await import("../tauri-commands");
    await setCommentResolved("/p/file.md", "c3", true);
    expect(m).toHaveBeenCalledWith("set_comment_resolved", {
      filePath: "/p/file.md",
      commentId: "c3",
      resolved: true,
    });
  });

  it("setCommentResolved supports false for unresolve", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const m = invoke as ReturnType<typeof vi.fn>;
    m.mockClear();
    m.mockResolvedValueOnce(undefined);
    const { setCommentResolved } = await import("../tauri-commands");
    await setCommentResolved("/p/file.md", "c4", false);
    expect(m).toHaveBeenCalledWith("set_comment_resolved", {
      filePath: "/p/file.md",
      commentId: "c4",
      resolved: false,
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
