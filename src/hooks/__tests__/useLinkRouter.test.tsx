/**
 * Issue #338 / Group B-foundation — `useLinkRouter` dispatcher tests.
 *
 * Covers each `LinkRoute` variant + the async `path_classify` outcomes
 * (inside / outside / system / IPC error). Asserts fail-closed posture:
 * any IPC failure or unexpected exception MUST result in no navigation
 * and a `warn` log line.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLinkRouter } from "@/hooks/useLinkRouter";
import { commands } from "@/lib/bindings";
import { openExternalUrl } from "@/lib/tauri-commands";
import { useStore } from "@/store";
import { warn } from "@/logger";

vi.mock("@/lib/bindings", () => ({
  commands: {
    pathClassify: vi.fn(),
  },
}));
vi.mock("@/lib/tauri-commands", () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/logger", () => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

const mockedPathClassify = vi.mocked(commands.pathClassify);
const mockedOpenExternal = vi.mocked(openExternalUrl);
const mockedWarn = vi.mocked(warn);

function setupStore({
  root = "/ws",
  allowSet = new Set<string>(),
}: { root?: string | null; allowSet?: Set<string> } = {}) {
  const openFile = vi.fn();
  const setPendingFragment = vi.fn();
  useStore.setState({
    root,
    allowOutsideWorkspace: allowSet,
    openFile,
    setPendingFragment,
  } as Partial<ReturnType<typeof useStore.getState>> as never);
  return { openFile, setPendingFragment };
}

beforeEach(() => {
  vi.clearAllMocks();
});

function getDispatch() {
  const { result } = renderHook(() => useLinkRouter());
  return result.current;
}

describe("useLinkRouter", () => {
  it("fragment: scrolls to element by id (no IPC, no openFile)", async () => {
    setupStore();
    const el = document.createElement("h2");
    el.id = "sec-2";
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);

    const dispatch = getDispatch();
    await dispatch("#sec-2", { filePath: "/ws/a.md" });

    expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(mockedPathClassify).not.toHaveBeenCalled();
    document.body.removeChild(el);
  });

  it("external: delegates to openExternalUrl (no IPC, no openFile)", async () => {
    const { openFile } = setupStore();
    const dispatch = getDispatch();
    await dispatch("https://example.com/x", { filePath: "/ws/a.md" });

    expect(mockedOpenExternal).toHaveBeenCalledWith("https://example.com/x");
    expect(openFile).not.toHaveBeenCalled();
    expect(mockedPathClassify).not.toHaveBeenCalled();
  });

  it("workspace: tier=inside → openFile is called with the canonical path", async () => {
    const { openFile } = setupStore();
    mockedPathClassify.mockResolvedValueOnce({
      status: "ok",
      data: { tier: "inside", canonical: "/ws/b.md" },
    });
    const dispatch = getDispatch();
    await dispatch("./b.md", { filePath: "/ws/a.md" });

    expect(openFile).toHaveBeenCalledWith("/ws/b.md");
    expect(mockedWarn).not.toHaveBeenCalled();
  });

  it("workspace-outside-shaped + tier=outside + toggle off → blocked, warn, no openFile", async () => {
    const { openFile } = setupStore({ allowSet: new Set() });
    mockedPathClassify.mockResolvedValueOnce({
      status: "ok",
      data: { tier: "outside", canonical: "/elsewhere/c.md" },
    });
    const dispatch = getDispatch();
    await dispatch("../c.md", { filePath: "/ws/a.md" });

    expect(openFile).not.toHaveBeenCalled();
    expect(mockedWarn).toHaveBeenCalledWith(
      expect.stringContaining("outside-workspace blocked")
    );
  });

  it("workspace + tier=outside + toggle ON for source tab → openFile is called", async () => {
    const { openFile } = setupStore({ allowSet: new Set(["/ws/a.md"]) });
    mockedPathClassify.mockResolvedValueOnce({
      status: "ok",
      data: { tier: "outside", canonical: "/elsewhere/c.md" },
    });
    const dispatch = getDispatch();
    await dispatch("../c.md", { filePath: "/ws/a.md" });

    expect(openFile).toHaveBeenCalledWith("/elsewhere/c.md");
  });

  it("workspace + tier=system → blocked, warn, no openFile (fail-closed)", async () => {
    const { openFile } = setupStore();
    mockedPathClassify.mockResolvedValueOnce({
      status: "ok",
      data: { tier: "system", flavor: "posix" },
    });
    const dispatch = getDispatch();
    await dispatch("./looks-relative-but-resolves-to-etc", { filePath: "/ws/a.md" });

    expect(openFile).not.toHaveBeenCalled();
    expect(mockedWarn).toHaveBeenCalledWith(expect.stringContaining("system path blocked"));
  });

  it("workspace + tier=system flavor=windows → still blocked at content chokepoint", async () => {
    // Companion to the posix test above — pins the asymmetry codified
    // in rule 17b of `docs/security.md`: even after user-initiated opens
    // (file picker, CLI, drag-drop) now accept Tier::System paths
    // including AppData / `C:\Windows\` / UNC, the content-initiated
    // path (`useLinkRouter` → `path_classify`) MUST still reject them.
    // A markdown link to a Windows system path is the muscle-memory-
    // phishing vector the DENY list defends against.
    const { openFile } = setupStore();
    mockedPathClassify.mockResolvedValueOnce({
      status: "ok",
      data: { tier: "system", flavor: "windows" },
    });
    const dispatch = getDispatch();
    await dispatch("./somewhere/that-resolves-to-appdata.md", { filePath: "/ws/a.md" });

    expect(openFile).not.toHaveBeenCalled();
    expect(mockedWarn).toHaveBeenCalledWith(
      expect.stringContaining("system path blocked (flavor=windows)"),
    );
  });

  it("path_classify IPC error → fail-closed (no openFile, warn)", async () => {
    const { openFile } = setupStore();
    mockedPathClassify.mockResolvedValueOnce({ status: "error", error: "boom" });
    const dispatch = getDispatch();
    await dispatch("./b.md", { filePath: "/ws/a.md" });

    expect(openFile).not.toHaveBeenCalled();
    expect(mockedWarn).toHaveBeenCalledWith(expect.stringContaining("path_classify failed"));
  });

  it("absolute-blocked → warn, no IPC, no openFile", async () => {
    const { openFile } = setupStore();
    const dispatch = getDispatch();
    await dispatch("/etc/passwd", { filePath: "/ws/a.md" });

    expect(mockedPathClassify).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
    expect(mockedWarn).toHaveBeenCalledWith(
      expect.stringContaining("blocked link (absolute-blocked")
    );
  });

  it("scheme-blocked → warn, no IPC, no openExternalUrl", async () => {
    setupStore();
    const dispatch = getDispatch();
    await dispatch("javascript:alert(1)", { filePath: "/ws/a.md" });

    expect(mockedOpenExternal).not.toHaveBeenCalled();
    expect(mockedWarn).toHaveBeenCalledWith(expect.stringContaining("blocked link (scheme-blocked"));
  });

  it("other-blocked (no baseDir) → warn, no openFile", async () => {
    const { openFile } = setupStore();
    const dispatch = getDispatch();
    await dispatch("./somewhere", { filePath: null });

    expect(openFile).not.toHaveBeenCalled();
    expect(mockedWarn).toHaveBeenCalledWith(expect.stringContaining("blocked link (other-blocked"));
  });

  it("workspace + tier=inside + same-file fragment → no openFile, scroll-only", async () => {
    const { openFile, setPendingFragment } = setupStore();
    mockedPathClassify.mockResolvedValueOnce({
      status: "ok",
      data: { tier: "inside", canonical: "/ws/a.md" },
    });
    const el = document.createElement("h2");
    el.id = "anchor-x";
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);

    const dispatch = getDispatch();
    await dispatch("./a.md#anchor-x", { filePath: "/ws/a.md" });

    expect(openFile).not.toHaveBeenCalled();
    expect(setPendingFragment).not.toHaveBeenCalled();
    expect(el.scrollIntoView).toHaveBeenCalled();
    document.body.removeChild(el);
  });

  it("workspace + tier=inside + cross-file fragment → setPendingFragment + openFile", async () => {
    const { openFile, setPendingFragment } = setupStore();
    mockedPathClassify.mockResolvedValueOnce({
      status: "ok",
      data: { tier: "inside", canonical: "/ws/b.md" },
    });
    const dispatch = getDispatch();
    await dispatch("./b.md#sec-3", { filePath: "/ws/a.md" });

    expect(setPendingFragment).toHaveBeenCalledWith({ path: "/ws/b.md", fragment: "sec-3" });
    expect(openFile).toHaveBeenCalledWith("/ws/b.md");
  });
});
