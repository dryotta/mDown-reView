/**
 * Issue #359 / AC7 — dead-code seal for `classifyAndMarkReadOnly`.
 *
 * The helper used to live in `src/store/tabsHelpers.ts` and fired a
 * separate `path_classify` IPC after `openFile` to backfill
 * `Tab.readOnly`. As of #359 the readonly classification is derived
 * from the `register_window_file` result inside `openFile` itself and
 * applied atomically with tab insertion (rule 16) — the helper is
 * deleted along with both call sites in `tabs.ts`.
 *
 * This AST-level scan walks every `*.ts(x)` under `src/` and fails
 * if the identifier `classifyAndMarkReadOnly` reappears anywhere
 * (function declaration, call, import, re-export, type reference).
 * Mirrors the registry-driven scanner pattern in
 * `src/__tests__/ipc-event-fixture-conformance.test.ts`.
 *
 * Per AGENTS.md "Never Increase Engineering Debt" — every change
 * holds debt flat or reduces it; the dead-code seal locks the
 * deletion in so a future drive-by refactor cannot silently
 * re-introduce the helper as a workaround.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as ts from "typescript";

const repoRoot = resolve(__dirname, "..", "..");
const srcRoot = resolve(repoRoot, "src");

const FORBIDDEN_NAME = "classifyAndMarkReadOnly";

/** Walks every `.ts` / `.tsx` file under `src/`. */
function* walkTsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // node_modules wouldn't normally appear under src/, but skip defensively.
      if (entry === "node_modules") continue;
      yield* walkTsFiles(full);
      continue;
    }
    if (st.isFile() && (full.endsWith(".ts") || full.endsWith(".tsx"))) {
      yield full;
    }
  }
}

/**
 * Recursively visits every `Identifier` node under `node`. Catches
 * function declarations, call sites, imports, re-exports, and any
 * type reference that mentions the forbidden name.
 */
function findIdentifierHits(
  node: ts.Node,
  source: ts.SourceFile,
  hits: Array<{ line: number; column: number }>,
): void {
  if (ts.isIdentifier(node) && node.text === FORBIDDEN_NAME) {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    hits.push({ line: line + 1, column: character + 1 });
  }
  ts.forEachChild(node, (child) => findIdentifierHits(child, source, hits));
}

describe("dead-code seal: classifyAndMarkReadOnly is gone (issue #359 / AC7)", () => {
  it("does not appear anywhere under src/ (function, call, import, re-export, type)", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(srcRoot)) {
      // The seal test itself MUST mention the name (in strings/comments)
      // so it can scan for it; skip the seal file but only via a path
      // suffix check (not name-based exclusion of arbitrary files).
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      if (rel === "src/__tests__/no-classify-and-mark-readonly.test.ts") continue;

      const text = readFileSync(file, "utf8");
      // Quick string filter avoids parsing every file in src/.
      if (!text.includes(FORBIDDEN_NAME)) continue;

      const sf = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        /*setParentNodes*/ true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const hits: Array<{ line: number; column: number }> = [];
      findIdentifierHits(sf, sf, hits);
      for (const { line, column } of hits) {
        offenders.push(`${rel}:${line}:${column}`);
      }
    }
    expect(
      offenders,
      `classifyAndMarkReadOnly must not reappear after issue #359 — found ${offenders.length} reference(s):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
