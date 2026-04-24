import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAboutInfo } from "@/hooks/useAboutInfo";
import * as commands from "@/lib/tauri-commands";

vi.mock("@/lib/tauri-commands");
vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAboutInfo", () => {
  it("loads version and log path on mount", async () => {
    vi.mocked(commands.getAppVersion).mockResolvedValue("1.2.3");
    vi.mocked(commands.getLogPath).mockResolvedValue("/path/to/log");

    const { result } = renderHook(() => useAboutInfo());

    await act(async () => {});

    expect(result.current.version).toBe("1.2.3");
    expect(result.current.logPath).toBe("/path/to/log");
  });

  it('sets "unknown" on version error', async () => {
    vi.mocked(commands.getAppVersion).mockRejectedValue(new Error("no version"));
    vi.mocked(commands.getLogPath).mockResolvedValue("/path/to/log");

    const { result } = renderHook(() => useAboutInfo());

    await act(async () => {});

    expect(result.current.version).toBe("unknown");
    expect(result.current.logPath).toBe("/path/to/log");
  });

  it('sets "Unavailable" on log path error', async () => {
    vi.mocked(commands.getAppVersion).mockResolvedValue("1.0.0");
    vi.mocked(commands.getLogPath).mockRejectedValue(new Error("no path"));

    const { result } = renderHook(() => useAboutInfo());

    await act(async () => {});

    expect(result.current.version).toBe("1.0.0");
    expect(result.current.logPath).toBe("Unavailable");
  });
});
