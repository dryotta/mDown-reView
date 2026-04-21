import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  enrichCommentsWithCommit,
  resetCommitCache,
} from "@/hooks/useCommitEnricher";
import type { MrsfComment } from "@/lib/tauri-commands";
import * as commands from "@/lib/tauri-commands";

vi.mock("@/lib/tauri-commands");

function makeComment(overrides: Partial<MrsfComment> = {}): MrsfComment {
  return {
    id: "c1",
    author: "Test (t)",
    timestamp: "2026-01-01T00:00:00Z",
    text: "test",
    resolved: false,
    ...overrides,
  };
}

describe("enrichCommentsWithCommit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommitCache();
  });

  it("adds commit SHA to comments that lack it", async () => {
    vi.mocked(commands.getGitHead).mockResolvedValue("abc123def456");
    const comments = [makeComment({ id: "c1" })];
    const result = await enrichCommentsWithCommit(
      comments,
      "/path/to/file.md"
    );
    expect(result[0].commit).toBe("abc123def456");
  });

  it("does not overwrite existing commit field", async () => {
    vi.mocked(commands.getGitHead).mockResolvedValue("newsha");
    const comments = [makeComment({ id: "c1", commit: "oldsha" })];
    const result = await enrichCommentsWithCommit(
      comments,
      "/path/to/file.md"
    );
    expect(result[0].commit).toBe("oldsha");
  });

  it("returns comments unchanged when git is unavailable", async () => {
    vi.mocked(commands.getGitHead).mockResolvedValue(null);
    const comments = [makeComment({ id: "c1" })];
    const result = await enrichCommentsWithCommit(
      comments,
      "/other/path/file.md"
    );
    expect(result[0].commit).toBeUndefined();
  });

  it("returns comments unchanged on error", async () => {
    vi.mocked(commands.getGitHead).mockRejectedValue(
      new Error("git not found")
    );
    const comments = [makeComment({ id: "c1" })];
    const result = await enrichCommentsWithCommit(
      comments,
      "/another/path/file.md"
    );
    expect(result[0].commit).toBeUndefined();
  });
});
