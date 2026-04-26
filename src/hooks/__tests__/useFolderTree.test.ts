import { describe, it, expect } from "vitest";
import { buildFolderTree } from "../useFolderTree";
import type { DirEntry } from "@/lib/tauri-commands";
import type { GhostEntry } from "@/store";

function makeEntry(name: string, path: string, is_dir: boolean): DirEntry {
  return { name, path, is_dir };
}

describe("buildFolderTree", () => {
  const ROOT = "/project";
  const noGhosts: GhostEntry[] = [];

  it("returns [] for null root", () => {
    const result = buildFolderTree(null, {}, {}, "", noGhosts);
    expect(result).toEqual([]);
  });

  it("returns [] for empty childrenCache", () => {
    const result = buildFolderTree(ROOT, {}, {}, "", noGhosts);
    expect(result).toEqual([]);
  });

  it("builds flat list from root entries", () => {
    const cache: Record<string, DirEntry[]> = {
      [ROOT]: [
        makeEntry("readme.md", "/project/readme.md", false),
        makeEntry("src", "/project/src", true),
      ],
    };
    const result = buildFolderTree(ROOT, cache, {}, "", noGhosts);
    expect(result).toEqual([
      { path: "/project/readme.md", isDir: false, depth: 0, name: "readme.md" },
      { path: "/project/src", isDir: true, depth: 0, name: "src" },
    ]);
  });

  it("collapsed folders omit children", () => {
    const cache: Record<string, DirEntry[]> = {
      [ROOT]: [makeEntry("src", "/project/src", true)],
      "/project/src": [makeEntry("index.ts", "/project/src/index.ts", false)],
    };
    const result = buildFolderTree(ROOT, cache, {}, "", noGhosts);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src");
  });

  it("expanded folders include children at increased depth", () => {
    const cache: Record<string, DirEntry[]> = {
      [ROOT]: [makeEntry("src", "/project/src", true)],
      "/project/src": [makeEntry("index.ts", "/project/src/index.ts", false)],
    };
    const expanded = { "/project/src": true };
    const result = buildFolderTree(ROOT, cache, expanded, "", noGhosts);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      path: "/project/src/index.ts",
      isDir: false,
      depth: 1,
      name: "index.ts",
    });
  });

  it("filter correctly hides non-matching files", () => {
    const cache: Record<string, DirEntry[]> = {
      [ROOT]: [
        makeEntry("readme.md", "/project/readme.md", false),
        makeEntry("notes.txt", "/project/notes.txt", false),
      ],
    };
    const result = buildFolderTree(ROOT, cache, {}, "readme", noGhosts);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("readme.md");
  });

  it("filter keeps directories that have matching descendants", () => {
    const cache: Record<string, DirEntry[]> = {
      [ROOT]: [makeEntry("src", "/project/src", true)],
      "/project/src": [
        makeEntry("match.ts", "/project/src/match.ts", false),
        makeEntry("other.js", "/project/src/other.js", false),
      ],
    };
    const expanded = { "/project/src": true };
    const result = buildFolderTree(ROOT, cache, expanded, "match", noGhosts);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("src");
    expect(result[1].name).toBe("match.ts");
  });

  it("filter is case-insensitive", () => {
    const cache: Record<string, DirEntry[]> = {
      [ROOT]: [makeEntry("README.md", "/project/README.md", false)],
    };
    const result = buildFolderTree(ROOT, cache, {}, "readme", noGhosts);
    expect(result).toHaveLength(1);
  });

  it("ghost entries are inserted at the correct depth", () => {
    const cache: Record<string, DirEntry[]> = {
      [ROOT]: [makeEntry("src", "/project/src", true)],
      "/project/src": [makeEntry("app.ts", "/project/src/app.ts", false)],
    };
    const expanded = { "/project/src": true };
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/src/deleted.ts", sidecarPath: "/project/src/deleted.ts.review.json" },
    ];
    const result = buildFolderTree(ROOT, cache, expanded, "", ghosts);
    const ghost = result.find((n) => n.isGhost);
    expect(ghost).toBeDefined();
    expect(ghost!.depth).toBe(1);
    expect(ghost!.name).toBe("deleted.ts");
    expect(ghost!.path).toBe("/project/src/deleted.ts");
  });

  it("ghost entries are not duplicated if already in tree", () => {
    const cache: Record<string, DirEntry[]> = {
      [ROOT]: [makeEntry("file.md", "/project/file.md", false)],
    };
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/file.md", sidecarPath: "/project/file.md.review.json" },
    ];
    const result = buildFolderTree(ROOT, cache, {}, "", ghosts);
    const matches = result.filter((n) => n.path === "/project/file.md");
    expect(matches).toHaveLength(1);
    expect(matches[0].isGhost).toBeUndefined();
  });

  it("ghost entries at root depth get depth 0", () => {
    const cache: Record<string, DirEntry[]> = {
      [ROOT]: [makeEntry("src", "/project/src", true)],
    };
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/orphan.md", sidecarPath: "/project/orphan.md.review.json" },
    ];
    const result = buildFolderTree(ROOT, cache, {}, "", ghosts);
    const ghost = result.find((n) => n.isGhost);
    expect(ghost).toBeDefined();
    expect(ghost!.depth).toBe(0);
  });

  it("ghost entries with backslash paths are handled", () => {
    const winRoot = "C:\\project";
    const cache: Record<string, DirEntry[]> = {
      [winRoot]: [makeEntry("src", "C:\\project\\src", true)],
      "C:\\project\\src": [],
    };
    const expanded = { "C:\\project\\src": true };
    const ghosts: GhostEntry[] = [
      { sourcePath: "C:\\project\\src\\ghost.md", sidecarPath: "C:\\project\\src\\ghost.md.review.json" },
    ];
    const result = buildFolderTree(winRoot, cache, expanded, "", ghosts);
    const ghost = result.find((n) => n.isGhost);
    expect(ghost).toBeDefined();
    expect(ghost!.name).toBe("ghost.md");
    expect(ghost!.depth).toBe(1);
  });

  // Issue #89 regression — cross-form ghost dedupe.
  //
  // Before AC #4 the scanner emitted `\\?\C:\…` verbatim paths while
  // `read_dir` emitted bare `C:\…`; the dedupe check
  // (`flatList.some((n) => n.path === ghost.sourcePath)`) string-compared
  // cross-form and missed, surfacing a duplicate ghost beside the real
  // file. AC #4 aligns the producers; this test pins the renderer-side
  // defensive normalisation that survives if either side regresses.
  it("dedupes a verbatim cache entry against a bare ghost path (issue #89)", () => {
    const winRoot = "C:\\proj";
    const cache: Record<string, DirEntry[]> = {
      [winRoot]: [makeEntry("a.md", "\\\\?\\C:\\proj\\a.md", false)],
    };
    const ghosts: GhostEntry[] = [
      { sourcePath: "C:\\proj\\a.md", sidecarPath: "C:\\proj\\a.md.review.yaml" },
    ];
    const result = buildFolderTree(winRoot, cache, {}, "", ghosts);
    expect(result).toHaveLength(1);
    expect(result[0].isGhost).toBeFalsy();
  });
});
