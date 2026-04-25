/**
 * Regression test for BLOCK 1 (react-tauri-expert): the StatusBar previously
 * called `useFileContent(activeTabPath)` alongside ViewerRouter's call,
 * doubling every `read_text_file` IPC + UTF-8 decode + line count for the
 * active tab. This test mounts both components against the activeTabPath and
 * asserts `read_text_file` is invoked exactly once per tab activation.
 *
 * The ViewModel contract: `useFileContent` is the SOLE caller of
 * `read_text_file`; consumers needing file metadata read from the
 * `fileMetaByPath` cache populated by `useFileContent` on success.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { ViewerRouter } from "@/components/viewers/ViewerRouter";
import { StatusBar } from "@/components/StatusBar/StatusBar";
import { useStore } from "@/store";
import * as commands from "@/lib/tauri-commands";

vi.mock("@/lib/tauri-commands");
vi.mock("@/logger");

// Stub the ready-state child viewer so the test exercises the IPC plumbing
// without rendering Shiki / markdown / image internals.
vi.mock("@/components/viewers/EnhancedViewer", () => ({
  EnhancedViewer: () => <div data-testid="enhanced-stub" />,
}));
vi.mock("@/components/viewers/SkeletonLoader", () => ({
  SkeletonLoader: () => <div data-testid="skeleton-stub" />,
}));

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
  vi.clearAllMocks();
});

describe("StatusBar + ViewerRouter — single read_text_file IPC per tab activation", () => {
  it("invokes read_text_file exactly once when both consumers mount for the same path", async () => {
    vi.mocked(commands.readTextFile).mockResolvedValue({
      content: "# hello\n",
      size_bytes: 8,
      line_count: 1,
    });

    const path = "/repo/notes.md";
    useStore.setState({
      activeTabPath: path,
      tabs: [{ path, scrollTop: 0, lastAccessedAt: Date.now() }],
    });

    render(
      <>
        <ViewerRouter path={path} />
        <StatusBar />
      </>,
    );

    // Drain the read promise + any post-resolve effects.
    await act(async () => {});

    expect(commands.readTextFile).toHaveBeenCalledTimes(1);
    expect(commands.readTextFile).toHaveBeenCalledWith(path);

    // The StatusBar reads sizeBytes/lineCount from the store cache populated
    // by `useFileContent`. Verify the cache is in fact populated so the
    // single-IPC path is functionally correct, not just count-correct.
    const meta = useStore.getState().fileMetaByPath[path];
    expect(meta).toEqual({ sizeBytes: 8, lineCount: 1 });
  });

  it("invokes read_text_file twice when the active tab changes (once per path)", async () => {
    vi.mocked(commands.readTextFile).mockImplementation(async (p: string) => ({
      content: `# ${p}\n`,
      size_bytes: p.length + 4,
      line_count: 1,
    }));

    const pathA = "/repo/a.md";
    const pathB = "/repo/b.md";
    useStore.setState({
      activeTabPath: pathA,
      tabs: [{ path: pathA, scrollTop: 0, lastAccessedAt: 1 }],
    });

    const { rerender } = render(
      <>
        <ViewerRouter path={pathA} />
        <StatusBar />
      </>,
    );
    await act(async () => {});
    expect(commands.readTextFile).toHaveBeenCalledTimes(1);

    // Switch active tab to pathB.
    act(() => {
      useStore.setState({
        activeTabPath: pathB,
        tabs: [{ path: pathB, scrollTop: 0, lastAccessedAt: 2 }],
      });
    });
    rerender(
      <>
        <ViewerRouter path={pathB} />
        <StatusBar />
      </>,
    );
    await act(async () => {});

    expect(commands.readTextFile).toHaveBeenCalledTimes(2);
    expect(commands.readTextFile).toHaveBeenNthCalledWith(1, pathA);
    expect(commands.readTextFile).toHaveBeenNthCalledWith(2, pathB);
  });
});
