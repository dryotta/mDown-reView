import { describe, it, expect, vi, beforeEach } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { listenEvent, type EventPayloads } from "@/lib/tauri-events";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listenEvent (Tauri event chokepoint)", () => {
  it("forwards the event name to underlying listen()", async () => {
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(unlisten);

    await listenEvent("file-changed", () => {});

    expect(listen).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listen).mock.calls[0][0]).toBe("file-changed");
  });

  it("invokes the consumer callback with payload (not the event wrapper)", async () => {
    let captured: ((event: { payload: unknown }) => void) | null = null;
    vi.mocked(listen).mockImplementation((_name: string, cb) => {
      captured = cb as (event: { payload: unknown }) => void;
      return Promise.resolve(() => {});
    });

    const cb = vi.fn();
    await listenEvent("comments-changed", cb);

    // Simulate Rust emitting the event
    captured!({ payload: { file_path: "/some/file.md" } });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ file_path: "/some/file.md" });
  });

  it("returns the underlying UnlistenFn so callers can clean up", async () => {
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(unlisten);

    const fn = await listenEvent("menu-about", () => {});
    fn();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("type-narrows the payload by event name (compile-time check)", async () => {
    vi.mocked(listen).mockResolvedValue(() => {});

    // These assignments must compile — they verify the discriminated map.
    await listenEvent("file-changed", (payload) => {
      const p: EventPayloads["file-changed"] = payload;
      expect(p.kind === "content" || p.kind === "review" || p.kind === "deleted").toBe(true);
    });

    await listenEvent("update-progress", (payload) => {
      const p: EventPayloads["update-progress"] = payload;
      // Type assertion: payload.event is the discriminated string union
      expect(["Started", "Progress", "Finished"]).toContain(p.event);
    });

    // Menu events have void payload.
    await listenEvent("menu-open-file", (payload) => {
      const p: void = payload;
      expect(p).toBeUndefined();
    });
  });

  it("propagates rejection from underlying listen()", async () => {
    vi.mocked(listen).mockRejectedValueOnce(new Error("boom"));

    await expect(listenEvent("file-changed", () => {})).rejects.toThrow("boom");
  });
});
