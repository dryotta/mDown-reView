import { describe, it, expect } from "vitest";
import { buildFolderTree } from "../useFolderTree";
import type { DirEntry } from "@/lib/tauri-commands";
import type { CachedDir } from "@/hooks/useFolderChildren";
import type { GhostEntry } from "@/store";

function makeEntry(name: string, path: string, is_dir: boolean): DirEntry {
  return { name, path, is_dir };
}

/** Wrap DirEntry[] in the CachedDir shape used by childrenCache. */
function wrap(entries: DirEntry[]): CachedDir {
  return { entries, hasMore: false, total: entries.length };
}

describe("buildFolderTree", () => {
  const ROOT = "/project";
  const noGhosts: GhostEntry[] = [];

  it("returns [] for null root", () => {
    const { nodes } = buildFolderTree(null, {}, {}, "", noGhosts);
    expect(nodes).toEqual([]);
  });

  it("returns [] for empty childrenCache", () => {
    const { nodes } = buildFolderTree(ROOT, {}, {}, "", noGhosts);
    expect(nodes).toEqual([]);
  });

  it("builds flat list from root entries", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([
        makeEntry("readme.md", "/project/readme.md", false),
        makeEntry("src", "/project/src", true),
      ]),
    };
    const { nodes } = buildFolderTree(ROOT, cache, {}, "", noGhosts);
    expect(nodes).toEqual([
      { path: "/project/readme.md", isDir: false, depth: 0, name: "readme.md" },
      { path: "/project/src", isDir: true, depth: 0, name: "src" },
    ]);
  });

  it("collapsed folders omit children", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("src", "/project/src", true)]),
      "/project/src": wrap([makeEntry("index.ts", "/project/src/index.ts", false)]),
    };
    const { nodes } = buildFolderTree(ROOT, cache, {}, "", noGhosts);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("src");
  });

  it("expanded folders include children at increased depth", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("src", "/project/src", true)]),
      "/project/src": wrap([makeEntry("index.ts", "/project/src/index.ts", false)]),
    };
    const expanded = { "/project/src": true };
    const { nodes } = buildFolderTree(ROOT, cache, expanded, "", noGhosts);
    expect(nodes).toHaveLength(2);
    expect(nodes[1]).toEqual({
      path: "/project/src/index.ts",
      isDir: false,
      depth: 1,
      name: "index.ts",
    });
  });

  it("filter correctly hides non-matching files", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([
        makeEntry("readme.md", "/project/readme.md", false),
        makeEntry("notes.txt", "/project/notes.txt", false),
      ]),
    };
    const { nodes } = buildFolderTree(ROOT, cache, {}, "readme", noGhosts);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("readme.md");
  });

  it("filter keeps directories that have matching descendants", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("src", "/project/src", true)]),
      "/project/src": wrap([
        makeEntry("match.ts", "/project/src/match.ts", false),
        makeEntry("other.js", "/project/src/other.js", false),
      ]),
    };
    const expanded = { "/project/src": true };
    const { nodes } = buildFolderTree(ROOT, cache, expanded, "match", noGhosts);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].name).toBe("src");
    expect(nodes[1].name).toBe("match.ts");
  });

  it("filter is case-insensitive", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("README.md", "/project/README.md", false)]),
    };
    const { nodes } = buildFolderTree(ROOT, cache, {}, "readme", noGhosts);
    expect(nodes).toHaveLength(1);
  });

  it("ghost entries are inserted at the correct depth", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("src", "/project/src", true)]),
      "/project/src": wrap([makeEntry("app.ts", "/project/src/app.ts", false)]),
    };
    const expanded = { "/project/src": true };
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/src/deleted.ts", sidecarPath: "/project/src/deleted.ts.review.json" },
    ];
    const { nodes } = buildFolderTree(ROOT, cache, expanded, "", ghosts);
    const ghost = nodes.find((n) => n.isGhost);
    expect(ghost).toBeDefined();
    expect(ghost!.depth).toBe(1);
    expect(ghost!.name).toBe("deleted.ts");
    expect(ghost!.path).toBe("/project/src/deleted.ts");
  });

  it("ghost entries are not duplicated if already in tree", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("file.md", "/project/file.md", false)]),
    };
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/file.md", sidecarPath: "/project/file.md.review.json" },
    ];
    const { nodes } = buildFolderTree(ROOT, cache, {}, "", ghosts);
    const matches = nodes.filter((n) => n.path === "/project/file.md");
    expect(matches).toHaveLength(1);
    expect(matches[0].isGhost).toBeUndefined();
  });

  it("ghost entries at root depth get depth 0", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("src", "/project/src", true)]),
    };
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/orphan.md", sidecarPath: "/project/orphan.md.review.json" },
    ];
    const { nodes } = buildFolderTree(ROOT, cache, {}, "", ghosts);
    const ghost = nodes.find((n) => n.isGhost);
    expect(ghost).toBeDefined();
    expect(ghost!.depth).toBe(0);
  });

  it("ghost entries with backslash paths are handled", () => {
    const winRoot = "C:\\project";
    const cache: Record<string, CachedDir> = {
      [winRoot]: wrap([makeEntry("src", "C:\\project\\src", true)]),
      "C:\\project\\src": wrap([]),
    };
    const expanded = { "C:\\project\\src": true };
    const ghosts: GhostEntry[] = [
      { sourcePath: "C:\\project\\src\\ghost.md", sidecarPath: "C:\\project\\src\\ghost.md.review.json" },
    ];
    const { nodes } = buildFolderTree(winRoot, cache, expanded, "", ghosts);
    const ghost = nodes.find((n) => n.isGhost);
    expect(ghost).toBeDefined();
    expect(ghost!.name).toBe("ghost.md");
    expect(ghost!.depth).toBe(1);
  });

  // ── Ghost visibility under collapsed folders (issue #216) ──────────────

  it("omits ghost entries under collapsed parent folders", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("src", "/project/src", true)]),
      "/project/src": wrap([makeEntry("app.ts", "/project/src/app.ts", false)]),
    };
    // src is collapsed (not in expandedFolders)
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/src/deleted.ts", sidecarPath: "/project/src/deleted.ts.review.json" },
    ];
    const { nodes } = buildFolderTree(ROOT, cache, {}, "", ghosts);
    const ghost = nodes.find((n) => n.isGhost);
    expect(ghost).toBeUndefined();
    expect(nodes).toHaveLength(1); // just "src" folder
  });

  it("includes ghost entries under expanded parent folders", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("src", "/project/src", true)]),
      "/project/src": wrap([]),
    };
    const expanded = { "/project/src": true };
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/src/deleted.ts", sidecarPath: "/project/src/deleted.ts.review.json" },
    ];
    const { nodes } = buildFolderTree(ROOT, cache, expanded, "", ghosts);
    const ghost = nodes.find((n) => n.isGhost);
    expect(ghost).toBeDefined();
    expect(ghost!.depth).toBe(1);
  });

  it("root-level ghost entries are always visible regardless of expanded state", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([]),
    };
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/root-ghost.md", sidecarPath: "/project/root-ghost.md.review.json" },
    ];
    const { nodes } = buildFolderTree(ROOT, cache, {}, "", ghosts);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].isGhost).toBe(true);
    expect(nodes[0].name).toBe("root-ghost.md");
  });

  it("deeply nested ghost with ancestor collapsed is hidden and mapped to nearest visible ancestor", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("src", "/project/src", true)]),
      "/project/src": wrap([makeEntry("lib", "/project/src/lib", true)]),
      "/project/src/lib": wrap([]),
    };
    // src expanded, lib collapsed
    const expanded = { "/project/src": true };
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/src/lib/deep.ts", sidecarPath: "/project/src/lib/deep.ts.review.json" },
    ];
    const { nodes, hiddenGhostsByFolder } = buildFolderTree(ROOT, cache, expanded, "", ghosts);
    const ghost = nodes.find((n) => n.isGhost);
    expect(ghost).toBeUndefined();
    expect(hiddenGhostsByFolder).toEqual({
      "/project/src/lib": ["/project/src/lib/deep.ts"],
    });
  });

  it("hiddenGhostsByFolder correctly maps folder to ghost source paths", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("docs", "/project/docs", true)]),
      "/project/docs": wrap([]),
    };
    // docs is collapsed
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/docs/a.md", sidecarPath: "/project/docs/a.md.review.json" },
      { sourcePath: "/project/docs/b.md", sidecarPath: "/project/docs/b.md.review.json" },
    ];
    const { nodes, hiddenGhostsByFolder } = buildFolderTree(ROOT, cache, {}, "", ghosts);
    expect(nodes.filter((n) => n.isGhost)).toHaveLength(0);
    expect(hiddenGhostsByFolder["/project/docs"]).toEqual([
      "/project/docs/a.md",
      "/project/docs/b.md",
    ]);
  });

  it("hiddenGhostsByFolder is empty when all ghosts are visible", () => {
    const cache: Record<string, CachedDir> = {
      [ROOT]: wrap([makeEntry("src", "/project/src", true)]),
      "/project/src": wrap([]),
    };
    const expanded = { "/project/src": true };
    const ghosts: GhostEntry[] = [
      { sourcePath: "/project/src/visible.ts", sidecarPath: "/project/src/visible.ts.review.json" },
    ];
    const { hiddenGhostsByFolder } = buildFolderTree(ROOT, cache, expanded, "", ghosts);
    expect(Object.keys(hiddenGhostsByFolder)).toHaveLength(0);
  });
});
