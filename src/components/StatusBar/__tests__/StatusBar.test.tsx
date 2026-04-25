import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Profiler } from "react";
import { act, render, screen } from "@testing-library/react";
import { StatusBar, formatSize, formatRelative, truncatePath } from "../StatusBar";
import { useStore } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── pure formatter helpers ─────────────────────────────────────────────────

describe("formatSize", () => {
  it("formats bytes under 1 KiB", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("formats KiB with one decimal", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
  });

  it("formats MiB with one decimal", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(Math.round(3.4 * 1024 * 1024))).toBe("3.4 MB");
  });
});

describe("formatRelative", () => {
  const now = 1_000_000_000_000;
  it("returns 'just now' within the last 60 seconds", () => {
    expect(formatRelative(now - 5_000, now)).toBe("just now");
    expect(formatRelative(now - 59_000, now)).toBe("just now");
  });

  it("returns minutes for sub-hour deltas", () => {
    expect(formatRelative(now - 2 * 60_000, now)).toMatch(/2 minutes ago/);
    expect(formatRelative(now - 60_000, now)).toMatch(/minute/);
  });

  it("returns hours for sub-day deltas", () => {
    expect(formatRelative(now - 3 * 60 * 60_000, now)).toMatch(/3 hours ago/);
  });
});

describe("truncatePath", () => {
  it("returns the path unchanged when short", () => {
    expect(truncatePath("/a/b.md", 60)).toBe("/a/b.md");
  });

  it("truncates from the start with an ellipsis", () => {
    const long = "/" + "x".repeat(200) + "/file.md";
    const out = truncatePath(long, 30);
    expect(out.length).toBe(30);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("/file.md")).toBe(true);
  });
});

// ─── StatusBar component ───────────────────────────────────────────────────

describe("StatusBar – rendering", () => {
  it("renders an empty placeholder when there is no active tab", () => {
    useStore.setState({ activeTabPath: null });
    render(<StatusBar />);
    const bar = screen.getByRole("status");
    expect(bar).toHaveClass("status-bar-empty");
    expect(bar.textContent).toBe("");
  });

  it("renders path, size, and line count from the store's fileMetaByPath cache", () => {
    useStore.setState({
      activeTabPath: "/repo/notes.md",
      fileMetaByPath: { "/repo/notes.md": { sizeBytes: 2048, lineCount: 120 } },
    });
    render(<StatusBar />);

    expect(screen.getByText("/repo/notes.md")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("120 lines")).toBeInTheDocument();
  });

  it("formats line count with thousands separators", () => {
    useStore.setState({
      activeTabPath: "/repo/big.md",
      fileMetaByPath: { "/repo/big.md": { sizeBytes: 1024, lineCount: 12345 } },
    });
    render(<StatusBar />);
    expect(screen.getByText("12,345 lines")).toBeInTheDocument();
  });

  it("omits size and line count when no fileMeta is cached yet (still loading)", () => {
    useStore.setState({ activeTabPath: "/repo/notes.md", fileMetaByPath: {} });
    render(<StatusBar />);
    expect(screen.queryByText(/lines$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/KB|MB|\bB$/)).not.toBeInTheDocument();
  });

  it("shows reload labels when timestamps are present", () => {
    const now = Date.now();
    useStore.setState({
      activeTabPath: "/repo/notes.md",
      lastFileReloadedAt: { "/repo/notes.md": now - 10_000 },
      lastCommentsReloadedAt: { "/repo/notes.md": now - 10_000 },
    });
    render(<StatusBar />);
    expect(screen.getByText(/File reloaded just now/)).toBeInTheDocument();
    expect(screen.getByText(/Comments reloaded just now/)).toBeInTheDocument();
  });
});

describe("StatusBar – timer tick refreshes labels", () => {
  it("transitions from 'just now' to 'N minutes ago' after the interval fires", () => {
    vi.useFakeTimers();
    const start = new Date("2024-01-01T12:00:00Z").getTime();
    vi.setSystemTime(start);

    useStore.setState({
      activeTabPath: "/repo/notes.md",
      lastFileReloadedAt: { "/repo/notes.md": start - 30_000 }, // 30s ago
    });

    render(<StatusBar />);
    expect(screen.getByText(/File reloaded just now/)).toBeInTheDocument();

    // Advance system time + drain the 60s interval tick.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // Now 90s have elapsed since the timestamp → "1 minute ago".
    expect(screen.queryByText(/just now/)).not.toBeInTheDocument();
    expect(screen.getByText(/File reloaded .*minute.*ago/)).toBeInTheDocument();
  });
});

describe("StatusBar – fine-grained scalar selectors", () => {
  it("does not re-render when an unrelated path's reload timestamp changes", () => {
    useStore.setState({
      activeTabPath: "/repo/active.md",
      lastFileReloadedAt: { "/repo/active.md": 1000 },
    });

    let renderCount = 0;
    render(
      <Profiler id="sb" onRender={() => { renderCount += 1; }}>
        <StatusBar />
      </Profiler>,
    );
    const baseline = renderCount;
    expect(baseline).toBeGreaterThan(0);

    // Update an unrelated path → active path's selector returns the same number.
    act(() => {
      useStore.setState((s) => ({
        lastFileReloadedAt: { ...s.lastFileReloadedAt, "/repo/other.md": 9999 },
      }));
    });
    expect(renderCount).toBe(baseline);

    // Same for comments map.
    act(() => {
      useStore.setState((s) => ({
        lastCommentsReloadedAt: { ...s.lastCommentsReloadedAt, "/repo/other.md": 9999 },
      }));
    });
    expect(renderCount).toBe(baseline);

    // Same for fileMetaByPath — only the active path's entry should re-render.
    act(() => {
      useStore.setState((s) => ({
        fileMetaByPath: { ...s.fileMetaByPath, "/repo/other.md": { sizeBytes: 1, lineCount: 1 } },
      }));
    });
    expect(renderCount).toBe(baseline);

    // Updating the active path's timestamp DOES trigger a re-render.
    act(() => {
      useStore.setState((s) => ({
        lastFileReloadedAt: { ...s.lastFileReloadedAt, "/repo/active.md": 2000 },
      }));
    });
    expect(renderCount).toBeGreaterThan(baseline);
  });
});
