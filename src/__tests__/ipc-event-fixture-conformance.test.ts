/**
 * Contract test for issues #311 and #327 — locks down the rule that IPC
 * event payloads in tests must come from the shared fixture factories
 * (`src/__tests__/fixtures/ipc-event-fixtures.ts`), never from inline
 * `{ path, kind }` / `{ file_path }` / `{ event, content_length }`
 * object literals.
 *
 * Two layers:
 *   1. `expectTypeOf` — every factory returns the exact `EventPayloads[K]`.
 *      If `EventPayloads` drifts from the Rust struct, this fails at
 *      type-check time.
 *   2. AST scan (issue #327) — walks every `*.test.ts(x)` under `src/`
 *      and `*.ts(x)` under `e2e/` using the TypeScript compiler API,
 *      and rejects inline / hoisted / late-assigned object-literal
 *      payloads invoked through captured listener callbacks. Replaces
 *      the regex-based scanner that shipped in #311 (which missed
 *      hoisted literals, optional-chain calls `cb?.(...)`, and
 *      cast-wrapped calls `(cb as any)(...)`).
 *
 *      The scanner is REGISTRY-DRIVEN: every governed event lives in
 *      `GOVERNED_EVENTS` with its fixture-factory whitelist and a
 *      payload discriminator. Adding a new IPC event = adding one
 *      entry. The scanner binds callback aliases at `listenEvent(...)`
 *      sites AND tracks late assignments inside `vi.fn`/`mockImplementation`
 *      mock setups, then flags any callback invocation whose argument
 *      resolves to an `ObjectLiteralExpression` that does not come from
 *      a registered fixture factory.
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
import * as ts from "typescript";
import type { EventPayloads } from "@/lib/tauri-events";
import {
  fileChangedContent,
  fileChangedReview,
  fileChangedReviewJson,
  fileChangedDeleted,
  folderChanged,
  commentsChanged,
  updateProgress,
  updateProgressStarted,
  updateProgressTick,
  updateProgressFinished,
} from "./fixtures/ipc-event-fixtures";

const repoRoot = resolve(__dirname, "..", "..");
const srcRoot = resolve(repoRoot, "src");
const e2eRoot = resolve(repoRoot, "e2e");

const ALLOW_LIST = new Set<string>([
  "src/__tests__/fixtures/ipc-event-fixtures.ts",
  "src/__tests__/fixtures/ipc-event-fixtures-validation.test.ts",
  "src/__tests__/ipc-event-fixture-conformance.test.ts",
  "src/__tests__/ipc-event-fixtures-vs-rust.test.ts",
  "src/lib/tauri-events.ts",
]);

type GovernedEventName =
  | "file-changed"
  | "comments-changed"
  | "folder-changed"
  | "update-progress";

interface GovernedEvent {
  eventName: GovernedEventName;
  /** Functions that legally produce this event's payload. Calls to these
   *  are skipped (they're the sanctioned alternative to inline literals). */
  fixtureFactoryNames: ReadonlyArray<string>;
  /** Discriminator: given the property names of an `ObjectLiteralExpression`,
   *  does it look like THIS event's payload? Designed so each governed
   *  event has a unique answer (file-changed = `kind`+`path`,
   *  comments-changed = `file_path`, folder-changed = `path`-only,
   *  update-progress = `chunk_length`). The order of GOVERNED_EVENTS
   *  matters: the scanner picks the FIRST matching entry, so put the
   *  most-specific events first. */
  discriminator: (props: ReadonlySet<string>) => boolean;
}

const GOVERNED_EVENTS: ReadonlyArray<GovernedEvent> = [
  // Most-specific first.
  {
    eventName: "update-progress",
    fixtureFactoryNames: [
      "updateProgress",
      "updateProgressStarted",
      "updateProgressTick",
      "updateProgressFinished",
      "makeUpdateProgress",
    ],
    // `chunk_length` is unique to update-progress; `content_length`
    // overlaps only with itself.
    discriminator: (p) => p.has("chunk_length"),
  },
  {
    eventName: "comments-changed",
    fixtureFactoryNames: ["commentsChanged", "makeCommentsChanged"],
    discriminator: (p) => p.has("file_path"),
  },
  {
    eventName: "file-changed",
    fixtureFactoryNames: [
      "fileChangedContent",
      "fileChangedReview",
      "fileChangedReviewJson",
      "fileChangedDeleted",
      "makeFileChanged",
    ],
    // file-changed is `{ path, kind }`; folder-changed is `{ path }` ONLY.
    // Disambiguate by requiring `kind`.
    discriminator: (p) => p.has("kind") && p.has("path"),
  },
  {
    eventName: "folder-changed",
    fixtureFactoryNames: ["folderChanged", "makeFolderChanged"],
    // `path` only — must NOT have `kind` (would be file-changed) or
    // `file_path` (would be comments-changed) or `chunk_length`.
    discriminator: (p) =>
      p.has("path") &&
      !p.has("kind") &&
      !p.has("file_path") &&
      !p.has("chunk_length"),
  },
];

const ALL_FIXTURE_FACTORY_NAMES = new Set<string>(
  GOVERNED_EVENTS.flatMap((e) => e.fixtureFactoryNames),
);

// Identifier-shape heuristic for "looks like a captured listener
// callback". Used as an additional gate alongside the
// `listenEvent`-binding map so tests that stash the cb in a non-standard
// name (e.g. `let received = ...; received?.({...})`) still get flagged
// when the stash is named like a callback.
const CALLBACK_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*?(cb|Cb|CB|callback|Callback|listener|Listener|handler|Handler|fn|Fn|Changed|Cmd)$/;

interface Hit {
  file: string;
  line: number;
  column: number;
  snippet: string;
  eventName: GovernedEventName;
  reason: "inline-literal" | "hoisted-literal" | "late-assigned-literal";
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

/**
 * Walks `e2e/**` and returns every `.ts`/`.tsx` file (not just `*.test.ts`).
 * The browser e2e tests use spec/fixture filename conventions like
 * `*.spec.ts` and `fixtures/*.ts`, and they MAY invoke captured listener
 * callbacks directly.
 */
function walkE2eSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules") continue;
      walkE2eSourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Strip wrappers that don't change the underlying expression's value:
 * `(x)`, `x!`, `x as T`, `x satisfies T`. Without this, bypasses like
 * `(cb as any)({...})` and `(cb!)({...})` slip past the "callee is an
 * Identifier" gate.
 */
function unwrapExpression(node: ts.Expression): ts.Expression {
  let cur: ts.Expression = node;
  // Bound the loop — TS can't legally chain these forever, but be safe.
  for (let i = 0; i < 16; i += 1) {
    if (ts.isParenthesizedExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isAsExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isSatisfiesExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isNonNullExpression(cur)) {
      cur = cur.expression;
    } else {
      return cur;
    }
  }
  return cur;
}

/** Object-literal property-name set, including string-literal property names. */
function objectLiteralPropNames(
  obj: ts.ObjectLiteralExpression,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const prop of obj.properties) {
    if (
      (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) &&
      prop.name
    ) {
      const name = prop.name;
      if (ts.isIdentifier(name)) names.add(name.text);
      else if (ts.isStringLiteral(name)) names.add(name.text);
    }
  }
  return names;
}

function pickGovernedEvent(
  obj: ts.ObjectLiteralExpression,
): GovernedEvent | undefined {
  const propNames = objectLiteralPropNames(obj);
  return GOVERNED_EVENTS.find((e) => e.discriminator(propNames));
}

interface Binding {
  kind: "decl" | "assign";
  init: ts.Expression;
  /** Source-text start position of the binding statement; used to filter
   *  bindings to those visible BEFORE a call site (rubber-duck blind-spot:
   *  resolve a callback-arg identifier to the nearest binding that
   *  precedes the invocation, never to a later reassignment). */
  pos: number;
}

interface IdentifierBindings {
  /** ident name → all bindings, in source order. */
  bindings: Map<string, Binding[]>;
  /** ident names that were passed as the second argument to
   *  `listenEvent("<governed-event>", <cb>)`. */
  listenEventCallbacks: Set<string>;
  /** ident names that were assigned the value of a parameter inside a
   *  callback passed to `vi.fn(...)` or `<x>.mockImplementation(...)` —
   *  i.e. captured-callback aliases. Closes the rubber-duck-flagged
   *  hole where a test names the captured cb opaquely (`received` /
   *  `payloadFn` / etc.) instead of using a callback-suffix name. */
  captureAliases: Set<string>;
}

/**
 * True if `node` is the function-expression argument of a `vi.fn(...)`
 * or `<x>.mockImplementation(...)` call. Used to identify "captured
 * callback" contexts where assigning a parameter to an outer variable
 * propagates the listener identity. Returns the parameter names of the
 * enclosing capturing lambda, or undefined if none found.
 */
function captureContextParams(
  node: ts.Node,
): Set<string> | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      (ts.isFunctionExpression(cur) || ts.isArrowFunction(cur)) &&
      cur.parent &&
      ts.isCallExpression(cur.parent) &&
      cur.parent.arguments.includes(cur as ts.Expression)
    ) {
      const callee = unwrapExpression(cur.parent.expression);
      const isViFn =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "vi" &&
        callee.name.text === "fn";
      const isMockImpl =
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "mockImplementation";
      if (isViFn || isMockImpl) {
        const params = new Set<string>();
        for (const p of cur.parameters) {
          if (ts.isIdentifier(p.name)) params.add(p.name.text);
        }
        return params;
      }
    }
    cur = cur.parent;
  }
  return undefined;
}

/**
 * Pre-walk: collect identifier bindings (decl initializers + late `=`
 * assignments, with source positions) and identify identifiers that
 * were registered as callbacks via `listenEvent("<governed-event>",
 * <ident>)` OR captured via assignment from a `vi.fn`/`mockImplementation`
 * callback parameter.
 *
 * Position tracking closes the rubber-duck-flagged hole at "newest-binding
 * wins regardless of call-site position": resolution now restricts to
 * bindings visible BEFORE the invocation.
 *
 * Alias propagation closes the rubber-duck-flagged hole at "opaquely-
 * named captured callbacks": `let received; vi.fn((_, x) => received = x);
 * received?.({...})` is now caught even though `received` does not match
 * `CALLBACK_NAME_RE`.
 */
function collectBindings(sf: ts.SourceFile): IdentifierBindings {
  const bindings = new Map<string, Binding[]>();
  const listenEventCallbacks = new Set<string>();
  const captureAliases = new Set<string>();
  const governedEventNameSet = new Set<string>(
    GOVERNED_EVENTS.map((e) => e.eventName),
  );

  function record(name: string, kind: "decl" | "assign", init: ts.Expression, pos: number) {
    const arr = bindings.get(name);
    if (arr) arr.push({ kind, init, pos });
    else bindings.set(name, [{ kind, init, pos }]);
  }

  function visit(node: ts.Node) {
    // VariableDeclaration with an initializer: `const x = INIT` / `let x = INIT`.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      record(node.name.text, "decl", node.initializer, node.getStart(sf));
    }

    // BinaryExpression with `=` operator: `x = INIT` (late assignment).
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      record(node.left.text, "assign", node.right, node.getStart(sf));

      // Captured-callback alias propagation: `<lhs> = <rhs>` where <rhs>
      // is a parameter of an enclosing vi.fn / mockImplementation lambda.
      const right = unwrapExpression(node.right);
      if (ts.isIdentifier(right)) {
        const params = captureContextParams(node);
        if (params && params.has(right.text)) {
          captureAliases.add(node.left.text);
        }
      }
    }

    // CallExpression to listenEvent("<event>", <cb-ident>): bind cb-ident.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "listenEvent" &&
      node.arguments.length >= 2
    ) {
      const eventArg = node.arguments[0];
      const cbArg = unwrapExpression(node.arguments[1]);
      if (
        ts.isStringLiteral(eventArg) &&
        governedEventNameSet.has(eventArg.text) &&
        ts.isIdentifier(cbArg)
      ) {
        listenEventCallbacks.add(cbArg.text);
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { bindings, listenEventCallbacks, captureAliases };
}

interface ResolvedArg {
  /** The deepest expression we could resolve the argument to. */
  expression: ts.Expression;
  /** "inline-literal" if the call site itself passed an object literal;
   *  "hoisted-literal" if a `const x = {...}` decl resolved to one;
   *  "late-assigned-literal" if a `let x; x = {...}` resolved to one. */
  reason: Hit["reason"];
}

/**
 * Resolve a call argument to its underlying expression. Returns the
 * argument itself for inline literals; for identifiers, returns the
 * (single, well-defined) binding when one exists. If the binding leads
 * to a CallExpression (e.g. `const fx = fileChangedContent();`), the
 * resolved expression is that CallExpression — caller checks whether
 * the callee is a known fixture factory.
 *
 * If an identifier has multiple bindings (declared once, then reassigned
 * elsewhere), we conservatively pick the LAST seen — this matches the
 * runtime value at the point of the invocation in most test files,
 * where re-binding is rare and almost always within the same `it(...)`
 * block.
 */
/**
 * Resolve a call argument to its underlying expression, RESTRICTED to
 * bindings visible at `callPos` (i.e. positioned strictly before the
 * call site). For inline literals returns the argument itself; for
 * identifiers returns the latest visible binding.
 *
 * The position filter closes the rubber-duck-flagged hole where
 * `cb(payload)` in `it("a", ...)` got resolved to a later reassignment
 * of `payload` in `it("b", ...)` — the bindings map is whole-file but
 * runtime visibility is sequential.
 */
function resolveArg(
  arg: ts.Expression,
  ctx: IdentifierBindings,
  callPos: number,
): ResolvedArg | undefined {
  const unwrapped = unwrapExpression(arg);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return { expression: unwrapped, reason: "inline-literal" };
  }
  if (ts.isIdentifier(unwrapped)) {
    const all = ctx.bindings.get(unwrapped.text);
    if (!all || all.length === 0) return undefined;
    // Restrict to bindings visible BEFORE the call site, then walk newest-first.
    const visible = all.filter((b) => b.pos < callPos);
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const b = visible[i];
      const init = unwrapExpression(b.init);
      if (ts.isObjectLiteralExpression(init)) {
        return {
          expression: init,
          reason:
            b.kind === "decl" ? "hoisted-literal" : "late-assigned-literal",
        };
      }
      if (ts.isCallExpression(init)) {
        // Aliased fixture: `const fx = fileChangedContent(); cb(fx);`.
        // Caller will see the CallExpression and skip if it's a factory.
        return { expression: init, reason: "hoisted-literal" };
      }
    }
  }
  return undefined;
}

function scanFileWithAst(rel: string, source: string): Hit[] {
  const hits: Hit[] = [];
  const sf = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const ctx = collectBindings(sf);

  // File-mentions-event gate (cheap proxy):only check for an event's
  // payload literals if the source file mentions the event name string.
  // This is a defence-in-depth filter — even when the discriminator
  // matches the literal, the file must actually deal with the event for
  // the hit to count.
  const mentionsEvent = new Map<GovernedEventName, boolean>();
  for (const e of GOVERNED_EVENTS) {
    mentionsEvent.set(
      e.eventName,
      source.includes(`"${e.eventName}"`) || source.includes(`'${e.eventName}'`),
    );
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (ts.isIdentifier(callee)) {
        const calleeName = callee.text;

        // Skip calls TO fixture factories — those are the sanctioned alternative.
        if (ALL_FIXTURE_FACTORY_NAMES.has(calleeName)) {
          ts.forEachChild(node, visit);
          return;
        }

        // Three ways the callee qualifies as a "captured listener callback":
        //   (a) it was bound at a `listenEvent("<governed-event>", <cb>)` site,
        //   (b) it was assigned-from a parameter inside a `vi.fn(...)`/
        //       `mockImplementation(...)` callback (captured-alias propagation),
        //   (c) its identifier shape matches CALLBACK_NAME_RE.
        const isBoundListener = ctx.listenEventCallbacks.has(calleeName);
        const isAliasListener = ctx.captureAliases.has(calleeName);
        const isShapedListener = CALLBACK_NAME_RE.test(calleeName);
        if (
          (isBoundListener || isAliasListener || isShapedListener) &&
          node.arguments.length >= 1
        ) {
          const arg = node.arguments[0];
          const callPos = node.getStart(sf);
          const resolved = resolveArg(arg, ctx, callPos);
          if (resolved && ts.isObjectLiteralExpression(resolved.expression)) {
            const event = pickGovernedEvent(resolved.expression);
            if (event && mentionsEvent.get(event.eventName)) {
              const lc = sf.getLineAndCharacterOfPosition(callPos);
              const snippet = source
                .slice(callPos, node.getEnd())
                .replace(/\s+/g, " ")
                .slice(0, 120);
              hits.push({
                file: rel,
                line: lc.line + 1,
                column: lc.character + 1,
                snippet,
                eventName: event.eventName,
                reason: resolved.reason,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
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
    it("updateProgress returns EventPayloads['update-progress']", () => {
      expectTypeOf(updateProgress()).toEqualTypeOf<EventPayloads["update-progress"]>();
    });
    it("updateProgressStarted returns EventPayloads['update-progress']", () => {
      expectTypeOf(updateProgressStarted()).toEqualTypeOf<EventPayloads["update-progress"]>();
    });
    it("updateProgressTick returns EventPayloads['update-progress']", () => {
      expectTypeOf(updateProgressTick()).toEqualTypeOf<EventPayloads["update-progress"]>();
    });
    it("updateProgressFinished returns EventPayloads['update-progress']", () => {
      expectTypeOf(updateProgressFinished()).toEqualTypeOf<EventPayloads["update-progress"]>();
    });
  });

  describe("Part B — AST source scan for inline / hoisted / late-assigned IPC payload literals (issue #327)", () => {
    const testFiles = walkTestFiles(srcRoot);

    it("walks at least one test file (sanity check on the walker itself)", () => {
      expect(testFiles.length).toBeGreaterThan(10);
    });

    it("rejects inline / hoisted / late-assigned IPC event payload literals in test files", () => {
      const allHits: Hit[] = [];
      const filesToScan = [...testFiles, ...walkE2eSourceFiles(e2eRoot)];
      for (const abs of filesToScan) {
        const rel = abs.slice(repoRoot.length + 1).split("\\").join("/");
        if (ALLOW_LIST.has(rel)) continue;
        const source = readFileSync(abs, "utf8");
        allHits.push(...scanFileWithAst(rel, source));
      }

      if (allHits.length > 0) {
        const formatted = allHits
          .map(
            (h) =>
              `  ${h.file}:${h.line}:${h.column} — ${h.eventName} (${h.reason})\n    ${h.snippet}\n    fix: import the matching factory from "@/__tests__/fixtures/ipc-event-fixtures"`,
          )
          .join("\n");
        throw new Error(
          `Found ${allHits.length} inline IPC event payload literal(s) in test files. ` +
            `Per rule 26 in docs/test-strategy.md, all listenEvent callback invocations ` +
            `must use the shared fixture factories.\n\n${formatted}`,
        );
      }
    });

    // ---------- Bypass-shape self-tests (issue #327 AC #3) ----------
    // Each shape covers one of the bypasses the regex scanner missed:
    //   1. inline literal (regression for #311 finding 4a — also caught by old regex)
    //   2. hoisted literal `const payload = {...}; cb(payload);`
    //   3. optional-chain call `cb?.({...})`
    //   4. late assignment `let payload; payload = {...}; cb(payload);`
    //   5. cast wrapper `(cb as any)({...})` and `(cb!)({...})`
    //   6. captured callback alias via `vi.fn((_, x) => { someAlias = x; })`
    //
    // The negative tests close AC #4 (no false positives in unrelated files).

    it("flags inline literal callback calls (regression for #311 finding 4a)", () => {
      const src = [
        'const listener = (_p) => {};',
        'listenEvent("file-changed", listener);',
        'listener({ path: "/x.md", kind: "review" });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].eventName).toBe("file-changed");
      expect(hits[0].reason).toBe("inline-literal");
    });

    it("flags hoisted literal `const payload = {...}; cb(payload);` (issue #327 bypass shape)", () => {
      const src = [
        'const cb = (_p) => {};',
        'listenEvent("comments-changed", cb);',
        'const payload = { file_path: "/x.md" };',
        'cb(payload);',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].eventName).toBe("comments-changed");
      expect(hits[0].reason).toBe("hoisted-literal");
    });

    it("flags optional-chain calls `cb?.({...})` (issue #327 bypass shape)", () => {
      const src = [
        'let listenCallback;',
        'listenEvent("update-progress", () => {});',
        'listenCallback?.({ event: "Started", content_length: 1000, chunk_length: 0 });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].eventName).toBe("update-progress");
      expect(hits[0].reason).toBe("inline-literal");
    });

    it("flags late-assigned literals `let p; p = {...}; cb(p);` (rubber-duck blind-spot fix)", () => {
      const src = [
        'const cb = (_p) => {};',
        'listenEvent("folder-changed", cb);',
        'let p;',
        'p = { path: "/dir" };',
        'cb(p);',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].eventName).toBe("folder-changed");
      expect(hits[0].reason).toBe("late-assigned-literal");
    });

    it("flags cast-wrapped calls `(cb as any)({...})` (rubber-duck blind-spot fix)", () => {
      const src = [
        'const cb = (_p) => {};',
        'listenEvent("file-changed", cb);',
        '(cb as any)({ path: "/x.md", kind: "review" });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].eventName).toBe("file-changed");
    });

    it("flags non-null-asserted calls `(cb!)({...})` (rubber-duck blind-spot fix)", () => {
      const src = [
        'const cb = (_p) => {};',
        'listenEvent("file-changed", cb);',
        '(cb!)({ path: "/x.md", kind: "deleted" });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].eventName).toBe("file-changed");
    });

    it("flags captured callback alias via `vi.fn((_, x) => { stash = x; }); stash?.({...})`", () => {
      const src = [
        'let listenCallback;',
        'vi.mock("@/lib/tauri-events", () => ({',
        '  listenEvent: vi.fn((_event, cb) => { listenCallback = cb; }),',
        '}));',
        'listenEvent("update-progress", () => {});',
        'listenCallback?.({ event: "Progress", content_length: null, chunk_length: 50 });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].eventName).toBe("update-progress");
    });

    it("flags opaquely-named captured callback alias `received?.({...})` (rubber-duck blind-spot fix)", () => {
      // `received` does NOT match CALLBACK_NAME_RE — would have slipped
      // past the identifier-shape gate. Capture-alias propagation
      // recognises it via the assignment inside the vi.fn lambda.
      const src = [
        'let received;',
        'vi.mock("@/lib/tauri-events", () => ({',
        '  listenEvent: vi.fn((_event, cb) => { received = cb; }),',
        '}));',
        'listenEvent("comments-changed", () => {});',
        'received?.({ file_path: "/x.md" });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].eventName).toBe("comments-changed");
    });

    it("flags captured-alias propagation via `.mockImplementation(...)` (rubber-duck blind-spot fix)", () => {
      // Same propagation through `.mockImplementation` instead of `vi.fn`.
      const src = [
        'let payloadFn;',
        'vi.mocked(listenEvent).mockImplementation((_e, cb) => { payloadFn = cb; });',
        'listenEvent("file-changed", () => {});',
        'payloadFn?.({ path: "/x.md", kind: "review" });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].eventName).toBe("file-changed");
    });

    it("position-aware: `cb(payload)` in `it1` resolves to its decl, not a later `it2` reassignment (rubber-duck blind-spot fix)", () => {
      // Without position-awareness, `cb(payload)` inside it1 would walk
      // bindings newest-first and pick up the BYPASS reassignment from
      // it2 (false positive flagging the legit it1 call). With pos
      // filtering, it1's call only sees its own legit decl.
      const src = [
        'import { fileChangedContent } from "@/__tests__/fixtures/ipc-event-fixtures";',
        'const cb = (_p) => {};',
        'listenEvent("file-changed", cb);',
        'it("ok", () => {',
        '  const payload = fileChangedContent();',
        '  cb(payload);',
        '});',
        'it("bypass", () => {',
        '  const payload = { path: "/x.md", kind: "review" };',
        '  cb(payload);',
        '});',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      // Exactly ONE hit: the bypass in it2. The legit call in it1 must NOT flag.
      expect(hits.length).toBe(1);
      expect(hits[0].eventName).toBe("file-changed");
      expect(hits[0].reason).toBe("hoisted-literal");
    });

    // ---------- AC #4: no false positives ----------

    it("does NOT flag aliased fixture-factory result `const fx = fileChangedContent(); cb(fx);`", () => {
      const src = [
        'import { fileChangedContent } from "@/__tests__/fixtures/ipc-event-fixtures";',
        'const cb = (_p) => {};',
        'listenEvent("file-changed", cb);',
        'const fx = fileChangedContent();',
        'cb(fx);',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits).toEqual([]);
    });

    it("does NOT flag direct fixture-factory call `cb(fileChangedContent())`", () => {
      const src = [
        'import { fileChangedContent } from "@/__tests__/fixtures/ipc-event-fixtures";',
        'const cb = (_p) => {};',
        'listenEvent("file-changed", cb);',
        'cb(fileChangedContent());',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits).toEqual([]);
    });

    it("does NOT flag unrelated handler calls in a file that mentions a governed event (issue #327 AC #4)", () => {
      // The file mentions "update-progress" but `handler({...})` carries
      // none of the discriminator fields (no `kind`, no `file_path`, no
      // `chunk_length`, no `path`). Must not flag.
      const src = [
        '// File mentions "update-progress" but the handler call is unrelated.',
        'const event = "update-progress";',
        'handler({ content_length: 123, etag: "x" });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits).toEqual([]);
    });

    it("does NOT flag matcher / mock-result / error object literals (`toEqual({ kind: ... })`, `mockRejectedValueOnce({ kind: ... })`)", () => {
      // These look like { kind: ... } literals but they're matcher args
      // — the callee names `toEqual` / `mockRejectedValueOnce` are not
      // listener-shaped, so the scanner must not flag.
      const src = [
        'const listener = (_p) => {};',
        'listenEvent("file-changed", listener);',
        'expect(spy).toHaveBeenCalledWith({ path: "/x.md", kind: "review" });',
        'expect(actual).toEqual({ path: "/x.md", kind: "review" });',
        'invoke.mockRejectedValueOnce({ kind: "PathOutsideWorkspace" });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits).toEqual([]);
    });

    it("does NOT flag callback calls when the file does not mention the governed event name", () => {
      // No `"file-changed"` / `"folder-changed"` / `"comments-changed"` /
      // `"update-progress"` mention — the file-mentions-event gate skips.
      const src = [
        'const cb = (_p) => {};',
        'cb({ path: "/x.md", kind: "review" });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits).toEqual([]);
    });

    // ---------- Discriminator correctness ----------

    it("disambiguates folder-changed (`{path}` only) from file-changed (`{path,kind}`)", () => {
      const src = [
        'const cb = (_p) => {};',
        'listenEvent("folder-changed", cb);',
        'cb({ path: "/dir" });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].eventName).toBe("folder-changed");
    });

    it("registry covers all four governed events from EventPayloads (file-changed, folder-changed, comments-changed, update-progress)", () => {
      const events = GOVERNED_EVENTS.map((e) => e.eventName).sort();
      expect(events).toEqual(
        ["comments-changed", "file-changed", "folder-changed", "update-progress"].sort(),
      );
    });

    it("scanner flags `cb({ event, content_length, chunk_length })` invocations (update-progress)", () => {
      const src = [
        'listenEvent("update-progress", cb);',
        'cb({ event: "Started", content_length: 1000, chunk_length: 0 });',
      ].join("\n");
      const hits = scanFileWithAst("synthetic.test.ts", src);
      expect(hits.some((h) => h.eventName === "update-progress")).toBe(true);
    });
  });
});
