import { describe, it, expect, vi, beforeEach } from "vitest";

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

import {
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
