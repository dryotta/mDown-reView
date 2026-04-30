/**
 * Contract test for issue #311 — locks down the rule that IPC event
 * payloads in tests must come from the shared fixture factories
 * (`src/__tests__/fixtures/ipc-event-fixtures.ts`), never from inline
 * `{ path, kind }` / `{ file_path }` object literals.
 *
 * Two layers:
 *   1. expectTypeOf — every factory returns the exact `EventPayloads[K]`.
 *      If `EventPayloads` drifts from the Rust struct, this fails at
 *      type-check time.
 *   2. Source scan — walks every `*.test.ts(x)` under `src/` and rejects
 *      inline payload literals invoked through captured listener
 *      callbacks. The allow-list excludes the fixture file, this file,
 *      the parity test, and the chokepoint type declaration.
 *
 * Companion to:
 *   - `src/__tests__/ipc-event-fixtures-vs-rust.test.ts` — Rust↔TS
 *     parity (struct-by-name source scrape).
 *   - `src-tauri/src/watcher_tests.rs::ipc_event_payloads_serialize_to_frontend_contract`
 *     — Rust serde JSON wire-shape pin.
 *   - rule 26 in `docs/test-strategy.md` and §4 in
 *     `docs/best-practices-project/test-patterns.md`.
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type { EventPayloads } from "@/lib/tauri-events";
import {
  fileChangedContent,
  fileChangedReview,
  fileChangedReviewJson,
  fileChangedDeleted,
  folderChanged,
  commentsChanged,
} from "./fixtures/ipc-event-fixtures";

const repoRoot = resolve(__dirname, "..", "..");
const srcRoot = resolve(repoRoot, "src");

const ALLOW_LIST = new Set<string>([
  "src/__tests__/fixtures/ipc-event-fixtures.ts",
  "src/__tests__/ipc-event-fixture-conformance.test.ts",
  "src/__tests__/ipc-event-fixtures-vs-rust.test.ts",
  "src/lib/tauri-events.ts",
]);

interface Hit {
  file: string;
  line: number;
  snippet: string;
  kind: "file-changed" | "comments-changed" | "folder-changed";
}

// All three regexes share the same call-site ident gate — only flag
// invocations through identifiers that look like a captured listener
// callback (cb / callback / *Cb / *Callback / *Changed / *Handler). This
// is what eliminates false positives from anchor variants
// (`canonicalizeAnchor({ kind: ... })`), error tagged unions
// (`mockRejectedValueOnce({ kind: "PathOutsideWorkspace" })`), and
// matchers (`toEqual({ kind: ... })`, `toHaveBeenCalledWith({ file_path:
// ... })`). Each scan is additionally gated on the file mentioning the
// matching event name (see `EVENT_NAME_GATE` checks below).
//
// Negative-lookbehind `(?<![A-Za-z_$])` prevents matching inside method
// names like `.fooBar(`.
const CALLBACK_IDENT = String.raw`(?<![A-Za-z_$])(\w*(?:cb|Cb|callback|Callback|Changed|Handler))`;

// File-changed payload: `{ ...kind: ... }` invoked through a callback.
const FILE_CHANGED_RE = new RegExp(
  CALLBACK_IDENT + String.raw`\s*!?\s*\(\s*\{[^{}]*\bkind\s*:[^{}]*\}\s*\)`,
  "g",
);

// Comments-changed payload: `{ ...file_path: ... }` invoked through a callback.
const COMMENTS_CHANGED_RE = new RegExp(
  CALLBACK_IDENT + String.raw`\s*!?\s*\(\s*\{[^{}]*\bfile_path\s*:[^{}]*\}\s*\)`,
  "g",
);

// Folder-changed payload: `{ path: ... }` invoked through a callback.
const FOLDER_CHANGED_RE = new RegExp(
  CALLBACK_IDENT + String.raw`\s*!?\s*\(\s*\{\s*path\s*:[^{}]*\}\s*\)`,
  "g",
);

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function walkTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules") continue;
      walkTestFiles(full, acc);
    } else if (/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

function scanFile(rel: string, source: string): Hit[] {
  const hits: Hit[] = [];

  // Each scan is gated on the file mentioning the matching event name —
  // a cheap proxy for "this test file deals with that IPC event". This
  // is what excludes anchor/error/matcher false positives in unrelated
  // tests. The event name appears either in `listenEvent("...")` (in
  // the hook source) or in `c[0] === "..."` (in tests that pluck the
  // captured callback from the mock-call array).
  const mentionsFileChanged = source.includes('"file-changed"') || source.includes("'file-changed'");
  const mentionsCommentsChanged =
    source.includes('"comments-changed"') || source.includes("'comments-changed'");
  const mentionsFolderChanged =
    source.includes('"folder-changed"') || source.includes("'folder-changed'");

  if (mentionsFileChanged) {
    for (const match of source.matchAll(FILE_CHANGED_RE)) {
      const ident = match[1];
      // Belt-and-suspenders: skip factory call names if they ever
      // happen to match the callback-ident pattern.
      if (ident.startsWith("fileChanged") || ident.startsWith("makeFileChanged")) continue;
      hits.push({
        file: rel,
        line: lineOf(source, match.index ?? 0),
        snippet: match[0],
        kind: "file-changed",
      });
    }
  }

  if (mentionsCommentsChanged) {
    for (const match of source.matchAll(COMMENTS_CHANGED_RE)) {
      const ident = match[1];
      if (ident.startsWith("commentsChanged") || ident.startsWith("makeCommentsChanged")) continue;
      hits.push({
        file: rel,
        line: lineOf(source, match.index ?? 0),
        snippet: match[0],
        kind: "comments-changed",
      });
    }
  }

  if (mentionsFolderChanged) {
    for (const match of source.matchAll(FOLDER_CHANGED_RE)) {
      const ident = match[1];
      if (ident.startsWith("folderChanged") || ident.startsWith("makeFolderChanged")) continue;
      hits.push({
        file: rel,
        line: lineOf(source, match.index ?? 0),
        snippet: match[0],
        kind: "folder-changed",
      });
    }
  }

  return hits;
}

describe("IPC event fixture conformance (issue #311)", () => {
  describe("Part A — type-check-time fixture conformance", () => {
    it("fileChangedContent returns EventPayloads['file-changed']", () => {
      expectTypeOf(fileChangedContent()).toEqualTypeOf<EventPayloads["file-changed"]>();
    });
    it("fileChangedReview returns EventPayloads['file-changed']", () => {
      expectTypeOf(fileChangedReview()).toEqualTypeOf<EventPayloads["file-changed"]>();
    });
    it("fileChangedReviewJson returns EventPayloads['file-changed']", () => {
      expectTypeOf(fileChangedReviewJson()).toEqualTypeOf<EventPayloads["file-changed"]>();
    });
    it("fileChangedDeleted returns EventPayloads['file-changed']", () => {
      expectTypeOf(fileChangedDeleted()).toEqualTypeOf<EventPayloads["file-changed"]>();
    });
    it("folderChanged returns EventPayloads['folder-changed']", () => {
      expectTypeOf(folderChanged()).toEqualTypeOf<EventPayloads["folder-changed"]>();
    });
    it("commentsChanged returns EventPayloads['comments-changed']", () => {
      expectTypeOf(commentsChanged()).toEqualTypeOf<EventPayloads["comments-changed"]>();
    });
  });

  describe("Part B — runtime source scan for inline payload literals", () => {
    const testFiles = walkTestFiles(srcRoot);

    it("walks at least one test file (sanity check on the walker itself)", () => {
      expect(testFiles.length).toBeGreaterThan(10);
    });

    it("rejects inline IPC event payload literals in test files", () => {
      const allHits: Hit[] = [];
      for (const abs of testFiles) {
        const rel = abs.slice(repoRoot.length + 1).split("\\").join("/");
        if (ALLOW_LIST.has(rel)) continue;
        const source = readFileSync(abs, "utf8");
        allHits.push(...scanFile(rel, source));
      }

      if (allHits.length > 0) {
        const formatted = allHits
          .map(
            (h) =>
              `  ${h.file}:${h.line} — ${h.kind}\n    ${h.snippet}\n    fix: import the matching factory from "@/__tests__/fixtures/ipc-event-fixtures"`,
          )
          .join("\n");
        throw new Error(
          `Found ${allHits.length} inline IPC event payload literal(s) in test files. ` +
            `Per rule 26 in docs/test-strategy.md, all listenEvent callback invocations ` +
            `must use the shared fixture factories.\n\n${formatted}`,
        );
      }
    });
  });
});
