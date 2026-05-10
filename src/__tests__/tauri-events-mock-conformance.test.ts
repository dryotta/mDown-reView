/**
 * AST conformance test for `vi.mock("@/lib/tauri-events", …)` factories.
 *
 * Issue: PR #372 introduced `listenDragDrop` as a second export from the
 * tauri-events chokepoint. Test files that mount `<App>` (or render any
 * component that transitively calls `listenDragDrop`) need the mock to
 * include that export — but Vitest factory-style mocks are an
 * all-or-nothing replacement. A test file that only listed `listenEvent`
 * silently dropped `listenDragDrop`, and the component tree threw at
 * mount time. Test-expert review of PR #372 (H2).
 *
 * This scanner walks every `*.test.ts(x)` under `src/` using the
 * TypeScript compiler API and:
 *   1. Finds every `vi.mock("@/lib/tauri-events", factory)` call site.
 *   2. Reads the factory's returned object literal.
 *   3. Asserts the literal's keys are a SUPERSET of the chokepoint's
 *      runtime exports (`REQUIRED_EXPORTS`).
 *
 * Test files that pass NO factory get the auto-mock at
 * `src/lib/__mocks__/tauri-events.ts` automatically, so this scanner
 * only ever flags hand-rolled factories that have drifted.
 *
 * Pattern source: mirrors the registry-driven scanner in
 * `src/__tests__/ipc-event-fixture-conformance.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import * as ts from "typescript";

const repoRoot = resolve(__dirname, "..", "..");
const srcRoot = resolve(repoRoot, "src");

/**
 * Every runtime function the chokepoint exports. Keep in lockstep with
 * `src/lib/tauri-events.ts` — adding a new helper there means adding
 * the name here, AND every existing test factory may need updating.
 *
 * Type-only re-exports (`type DragDropEvent`, `type EventName`, …) are
 * NOT in this list — types are erased at runtime and Vitest factories
 * don't need to provide them.
 */
const REQUIRED_EXPORTS = ["listenEvent", "listenDragDrop"] as const;

const TAURI_EVENTS_PATH = "@/lib/tauri-events";

interface MockFactoryOffense {
  file: string;
  missingExports: string[];
  factoryStart: number;
}

function* walk(dir: string): IterableIterator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function isTestFile(file: string): boolean {
  return /\.test\.(ts|tsx)$/.test(file);
}

/**
 * Walks a `vi.mock("@/lib/tauri-events", factory)` factory body and
 * extracts the keys of the object literal it returns. Handles both
 * arrow-function and concise-arrow-with-paren-wrapped-object shapes
 * (the two patterns the codebase uses).
 */
function extractFactoryKeys(factory: ts.Expression): string[] | null {
  if (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory)) {
    const body = factory.body;
    let returned: ts.Expression | undefined;
    if (ts.isParenthesizedExpression(body)) {
      returned = body.expression;
    } else if (ts.isObjectLiteralExpression(body)) {
      returned = body;
    } else if (ts.isBlock(body)) {
      // Find a top-level `return { … }` statement.
      for (const stmt of body.statements) {
        if (ts.isReturnStatement(stmt) && stmt.expression) {
          returned = stmt.expression;
          break;
        }
      }
    }
    if (returned && ts.isObjectLiteralExpression(returned)) {
      return returned.properties
        .map((p) => {
          if (
            (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
            p.name &&
            ts.isIdentifier(p.name)
          ) {
            return p.name.text;
          }
          return null;
        })
        .filter((k): k is string => k !== null);
    }
  }
  return null;
}

function scanFile(file: string): MockFactoryOffense[] {
  const content = readFileSync(file, "utf8");
  if (!content.includes(TAURI_EVENTS_PATH)) return [];

  const offenses: MockFactoryOffense[] = [];
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TSX,
  );

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "vi" &&
      ts.isIdentifier(node.expression.name) &&
      node.expression.name.text === "mock"
    ) {
      const [first, second] = node.arguments;
      if (
        first &&
        ts.isStringLiteral(first) &&
        first.text === TAURI_EVENTS_PATH &&
        second // factory passed
      ) {
        const keys = extractFactoryKeys(second);
        if (keys !== null) {
          const missing = REQUIRED_EXPORTS.filter((req) => !keys.includes(req));
          if (missing.length > 0) {
            offenses.push({
              file,
              missingExports: missing,
              factoryStart: second.getStart(sourceFile),
            });
          }
        }
        // If extractFactoryKeys returned null, the factory shape is
        // unrecognised (e.g. `vi.mock(path, otherFn)`) — flag-free since
        // we can't statically prove the contract.
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return offenses;
}

describe("vi.mock(\"@/lib/tauri-events\") factory conformance", () => {
  it("every hand-rolled factory exports listenEvent + listenDragDrop", () => {
    const offenders: MockFactoryOffense[] = [];
    for (const file of walk(srcRoot)) {
      if (!isTestFile(file)) continue;
      offenders.push(...scanFile(file));
    }
    if (offenders.length > 0) {
      const detail = offenders
        .map(
          (o) =>
            `  ${o.file}: missing [${o.missingExports.join(", ")}] in factory at offset ${o.factoryStart}`,
        )
        .join("\n");
      expect.fail(
        `Test files mocking @/lib/tauri-events must export EVERY chokepoint helper, ` +
          `or pass NO factory and rely on the auto-mock at src/lib/__mocks__/tauri-events.ts.\n${detail}`,
      );
    }
  });
});
