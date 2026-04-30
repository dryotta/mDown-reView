/**
 * Parity test: the TS fixtures in `ipc-event-fixtures.ts` must match the
 * Rust struct shapes at the canonical emit sites. Locates each struct by
 * NAME (regex matching `pub struct <Name> { ... }`) — never by line
 * number, which would be a maintenance bomb (cf. test-strategy.md
 * regression-test rules).
 *
 * Honors the spec intent of #311 R5 ("compares fixture shapes against the
 * real Rust emit sites") without the line-pinning brittleness the spec
 * literal wording implied. Companion to the Rust serde JSON wire-shape
 * test at `src-tauri/src/watcher_tests.rs::ipc_event_payloads_serialize_to_frontend_contract`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  fileChangedContent,
  fileChangedReview,
  fileChangedReviewJson,
  fileChangedDeleted,
  folderChanged,
  commentsChanged,
} from "./fixtures/ipc-event-fixtures";

const repoRoot = resolve(__dirname, "..", "..");
const watcherRsPath = resolve(repoRoot, "src-tauri", "src", "watcher.rs");
const commentsModRsPath = resolve(
  repoRoot,
  "src-tauri",
  "src",
  "commands",
  "comments",
  "mod.rs",
);

function parseStructFields(src: string, structName: string): string[] {
  // Match `pub struct <Name> { ...fields... }` allowing leading derive(s)
  // on prior lines. Capture the body, then strip line comments and
  // extract `pub <name>:` declarations in source order.
  const pattern = new RegExp(
    String.raw`pub\s+struct\s+${structName}\s*\{([^}]+)\}`,
    "s",
  );
  const match = src.match(pattern);
  if (!match) {
    throw new Error(`struct ${structName} not found in source`);
  }
  const body = match[1];
  const lines = body.split("\n").map((l) => l.replace(/\/\/.*$/, "").trim());
  const fields: string[] = [];
  for (const line of lines) {
    const f = line.match(/pub\s+(\w+)\s*:/);
    if (f) fields.push(f[1]);
  }
  if (fields.length === 0) {
    throw new Error(`struct ${structName} parsed body has no pub fields`);
  }
  return fields;
}

describe("IPC event fixture / Rust struct parity", () => {
  describe("FileChangeEvent (src-tauri/src/watcher.rs)", () => {
    const rustFields = parseStructFields(
      readFileSync(watcherRsPath, "utf8"),
      "FileChangeEvent",
    );

    it("Rust struct exposes path + kind, in that order", () => {
      expect(rustFields).toEqual(["path", "kind"]);
    });

    it.each([
      ["content", fileChangedContent()],
      ["review (.yaml)", fileChangedReview()],
      ["review (.json)", fileChangedReviewJson()],
      ["deleted", fileChangedDeleted()],
    ])("fileChanged-%s factory keys match Rust fields", (_label, payload) => {
      expect(Object.keys(payload).sort()).toEqual([...rustFields].sort());
    });

    it("kind values are limited to the Rust classification set", () => {
      const watcherSrc = readFileSync(watcherRsPath, "utf8");
      // Locate the classification block at watcher.rs:489-496 by content.
      const classification = watcherSrc.match(
        /let kind = match[\s\S]+?=>\s*"content"[\s\S]+?\};/,
      );
      expect(classification, "kind classification block not found").toBeTruthy();
      const block = classification![0];
      for (const v of ["content", "review", "deleted"]) {
        expect(block, `kind="${v}" missing from Rust classification`).toContain(
          `"${v}"`,
        );
      }

      // Cross-check: every fixture's kind value is in the set above.
      const allKinds = new Set<string>([
        fileChangedContent().kind,
        fileChangedReview().kind,
        fileChangedReviewJson().kind,
        fileChangedDeleted().kind,
      ]);
      for (const k of allKinds) {
        expect(["content", "review", "deleted"]).toContain(k);
      }
    });

    it("review fixtures emit sidecar paths; content/deleted emit source paths", () => {
      // Path-shape contract from the kind classification at watcher.rs:489-496:
      // a path is "review" iff it ends with .review.yaml or .review.json.
      const isSidecar = (p: string) =>
        p.endsWith(".review.yaml") || p.endsWith(".review.json");
      expect(isSidecar(fileChangedReview().path)).toBe(true);
      expect(isSidecar(fileChangedReviewJson().path)).toBe(true);
      expect(isSidecar(fileChangedContent().path)).toBe(false);
      expect(isSidecar(fileChangedDeleted().path)).toBe(false);
    });
  });

  describe("FolderChangeEvent (src-tauri/src/watcher.rs)", () => {
    const rustFields = parseStructFields(
      readFileSync(watcherRsPath, "utf8"),
      "FolderChangeEvent",
    );

    it("Rust struct exposes only `path`", () => {
      expect(rustFields).toEqual(["path"]);
    });

    it("folderChanged factory keys match Rust fields", () => {
      expect(Object.keys(folderChanged()).sort()).toEqual([...rustFields].sort());
    });
  });

  describe("CommentsChangedEvent (src-tauri/src/commands/comments/mod.rs)", () => {
    const rustFields = parseStructFields(
      readFileSync(commentsModRsPath, "utf8"),
      "CommentsChangedEvent",
    );

    it("Rust struct exposes only `file_path` (snake_case)", () => {
      expect(rustFields).toEqual(["file_path"]);
    });

    it("commentsChanged factory keys match Rust fields", () => {
      expect(Object.keys(commentsChanged()).sort()).toEqual(
        [...rustFields].sort(),
      );
    });
  });
});
