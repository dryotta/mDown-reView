import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Per-event emit-target lint.
 *
 * Enforces rule `multiwin-window-scoped-events` in
 * `.claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md`. The rule body owns
 * a 5-column markdown table whose columns are
 *   `Event | Target (rule) | Required emit method | Current call site | Current state`.
 *
 * The lint operates as a **table ↔ EventPayloads parity check** so that:
 *
 *   1. Every key declared in `src/lib/tauri-events.ts::EventPayloads`
 *      MUST appear as a row in the table — otherwise an event flowed
 *      into the codebase without the multi-window emit-target review.
 *   2. Every row in the table MUST appear as a key in `EventPayloads`
 *      — otherwise the table documents a phantom event the renderer
 *      no longer subscribes to (Docs Reflect Shipped Code).
 *
 * Rows whose "Current state" cell starts with `❌` document a
 * KNOWN-CURRENT-VIOLATION the rule has accepted as future work; those
 * rows are still required to exist as parity entries but the lint does
 * not assert their call site. Rows starting with `✅` are checked for
 * a soft signal — at least one Rust file under `src-tauri/src/`
 * mentions the event-name literal — so a future delete that drops
 * the call site without updating the table is caught.
 *
 * Self-tests at the bottom guard the parser itself.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SPEC_PATH = join(REPO_ROOT, ".claude", "agents", "tauri-coding-expert", "knowledge", "tauri-v2-patterns.md");
const EVENTS_PATH = join(__dirname, "..", "lib", "tauri-events.ts");
const RUST_SRC = join(REPO_ROOT, "src-tauri", "src");

interface TableRow {
  event: string;
  target: string; // column 2: "Target (rule)", e.g. "one (firing window)" or "all"
  emitMethod: string;
  currentState: string; // raw cell, may start with `✅` or `❌`
  ok: boolean;
}

/**
 * Parse the per-event emit-target table out of v2-patterns.md.
 *
 * The table starts with a header line containing `| Event | Target` and
 * ends at the first non-table line (any line that does not start with
 * `|`). The separator line (`|---|---|...`) is skipped.
 */
export function parseEmitTargetTable(markdown: string): TableRow[] {
  const lines = markdown.split(/\r?\n/);
  let inTable = false;
  let headerSeen = false;
  const rows: TableRow[] = [];

  for (const line of lines) {
    if (!inTable) {
      // Header looks like: `| Event | Target (rule) | …`
      if (/^\|\s*Event\s*\|\s*Target/.test(line)) {
        inTable = true;
      }
      continue;
    }
    // Inside the table body.
    if (!line.trim().startsWith("|")) {
      // First non-table line ends the table.
      break;
    }
    if (!headerSeen) {
      // The next `|` line after the header is the `|---|---|` separator.
      headerSeen = true;
      continue;
    }
    // Body row. Split on `|`, trim, drop the leading + trailing empty cells.
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((_c, i, arr) => i !== 0 && i !== arr.length - 1);
    if (cells.length < 5) continue;
    const eventCell = cells[0];
    const targetCell = cells[1];
    const emitCell = cells[2];
    const stateCell = cells[4];

    // Event name is the first backtick-quoted token in column 1.
    const m = eventCell.match(/`([^`]+)`/);
    if (!m) continue;
    const event = m[1];
    const ok = stateCell.startsWith("✅");
    rows.push({
      event,
      target: targetCell,
      emitMethod: emitCell,
      currentState: stateCell,
      ok,
    });
  }

  return rows;
}

/**
 * Parse the keys of the `EventPayloads` interface in tauri-events.ts.
 *
 * Looks for `interface EventPayloads { … }`, then pulls every line of
 * the form `"event-name": …;` (string-literal key, colon, anything).
 */
export function parseEventPayloadsKeys(source: string): string[] {
  const start = source.indexOf("interface EventPayloads");
  if (start === -1) return [];
  // Find the `{` that opens the body.
  const braceOpen = source.indexOf("{", start);
  if (braceOpen === -1) return [];
  // Walk braces to find the matching close.
  let depth = 0;
  let braceClose = -1;
  for (let i = braceOpen; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        braceClose = i;
        break;
      }
    }
  }
  if (braceClose === -1) return [];
  const body = source.slice(braceOpen + 1, braceClose);
  const keys: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    // Match `"event-name":` at the start of the property declaration.
    const m = line.match(/^"([^"]+)"\s*:/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

function* walk(dir: string): IterableIterator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (name === "target" || name === ".git") continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function isTestFile(rel: string): boolean {
  return (
    /\.test\.(ts|tsx|rs)$/.test(rel) ||
    rel.includes(`${sep}__tests__${sep}`) ||
    rel.includes(`${sep}tests${sep}`)
  );
}

describe("multiwin-window-scoped-events: per-event emit-target table", () => {
  const md = readFileSync(SPEC_PATH, "utf8");
  const events = readFileSync(EVENTS_PATH, "utf8");
  const rows = parseEmitTargetTable(md);
  const payloadKeys = parseEventPayloadsKeys(events);

  it("table exists in v2-patterns.md and parses to >= 1 row", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("EventPayloads parses to >= 1 key", () => {
    expect(payloadKeys.length).toBeGreaterThan(0);
  });

  it("every EventPayloads key has a row in the v2-patterns.md table", () => {
    const tableEvents = new Set(rows.map((r) => r.event));
    const missing = payloadKeys.filter((k) => !tableEvents.has(k));
    expect(
      missing,
      `These EventPayloads keys are missing rows in the per-event ` +
        `emit-target table at .claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md ` +
        `(rule multiwin-window-scoped-events). Add a row documenting ` +
        `Target / Required emit method / Current call site / Current state.\n  ${missing.join(
          "\n  "
        )}`
    ).toEqual([]);
  });

  it("every table row has a key in EventPayloads", () => {
    const payloadSet = new Set(payloadKeys);
    const phantom = rows.map((r) => r.event).filter((e) => !payloadSet.has(e));
    expect(
      phantom,
      `These rows in the per-event emit-target table reference events ` +
        `that no longer exist in src/lib/tauri-events.ts::EventPayloads. ` +
        `Either restore the listener or delete the row (rule multiwin-window-scoped-events).\n  ${phantom.join(
          "\n  "
        )}`
    ).toEqual([]);
  });

  it("every ✅ row is mentioned by at least one Rust file under src-tauri/src/", () => {
    // Soft check: a `✅` row claims a current call site exists. If no
    // Rust source file mentions the event-name string literal, the row
    // is lying. We only flag the disappearance — the exact emit method
    // is not validated here (rows already document that in column 3).
    const allRust: string[] = [];
    for (const f of walk(RUST_SRC)) {
      if (!f.endsWith(".rs")) continue;
      const rel = f.slice(RUST_SRC.length + 1);
      if (isTestFile(rel)) continue;
      allRust.push(readFileSync(f, "utf8"));
    }
    const corpus = allRust.join("\n");
    const orphaned = rows
      .filter((r) => r.ok)
      .map((r) => r.event)
      .filter((evt) => !corpus.includes(`"${evt}"`));
    expect(
      orphaned,
      `These ✅-marked events have no string-literal mention in any ` +
        `non-test Rust file under src-tauri/src/. The "Current call site" ` +
        `column lies — either restore the emit or update the row's state ` +
        `(rule multiwin-window-scoped-events).\n  ${orphaned.join("\n  ")}`
    ).toEqual([]);
  });

  it("no `.emit(\"<window-scoped-event>\", …)` broadcast in non-test Rust", () => {
    // STRUCTURAL REGRESSION GUARD for the original bug: Tauri 2.x's
    // `Emitter::emit` is a global broadcast on every receiver
    // (verified at `tauri-2.10.3/src/manager/mod.rs::emit` — iterates
    // all webviews). Calling `.emit("menu-open-file", …)` on a
    // `WebviewWindow` does NOT scope delivery to that window — it
    // wakes EVERY window's listener, so each window fires the action.
    //
    // For events whose Target column says `one (...)` (i.e. window-
    // scoped), the call site MUST use `.emit_to(...)`. For events
    // whose Target says `all`, broadcast `.emit(...)` is correct.
    // For `set` / `emit_filter`, broadcast is also wrong but is
    // covered by the per-event manual rows + future C2 work.
    //
    // This lint scans non-test Rust for the literal pattern
    // `.emit("<event-name>"` for every window-scoped row. A match
    // is a regression. The `.emit_to(...)` form does NOT match
    // because the literal is `.emit_to(` (extra characters before
    // the `(`).
    const allRust: { rel: string; content: string }[] = [];
    for (const f of walk(RUST_SRC)) {
      if (!f.endsWith(".rs")) continue;
      const rel = f.slice(RUST_SRC.length + 1);
      if (isTestFile(rel)) continue;
      allRust.push({ rel, content: readFileSync(f, "utf8") });
    }
    const windowScoped = rows.filter((r) => r.ok && /^one\b/.test(r.target));
    const violations: string[] = [];
    for (const row of windowScoped) {
      // Match `.emit("<name>"` literally — `.emit_to(...)` and
      // `.emit_filter(...)` cannot match because they have
      // additional characters between `.emit` and the `(`.
      const needle = `.emit("${row.event}"`;
      for (const { rel, content } of allRust) {
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comments — the rule's prose mentions
          // `.emit("foo", …)` to explain WHY it is wrong.
          const trimmed = line.trimStart();
          if (
            trimmed.startsWith("//") ||
            trimmed.startsWith("///") ||
            trimmed.startsWith("//!") ||
            trimmed.startsWith("*")
          ) {
            continue;
          }
          if (line.includes(needle)) {
            violations.push(
              `${rel.replace(/\\/g, "/")}:${i + 1} — ${line.trim()}`,
            );
          }
        }
      }
    }
    expect(
      violations,
      `Window-scoped events (Target = "one (...)") MUST be emitted ` +
        `via \`emit_to(label, …)\`, never via \`Emitter::emit\` on a ` +
        `\`WebviewWindow\` / \`Webview\` / \`Window\` receiver. The ` +
        `latter is a global broadcast (see ` +
        `tauri-2.10.3/src/manager/mod.rs::emit) — every window's ` +
        `listener fires, re-introducing the multi-window menu/CLI ` +
        `routing bug. Rule multiwin-window-scoped-events.\n  ` +
        violations.join("\n  "),
    ).toEqual([]);
  });

  // ── Parser self-tests ──────────────────────────────────────────────

  describe("parseEmitTargetTable (self-test)", () => {
    const sample = [
      "before",
      "",
      "| Event | Target (rule) | Required emit method | Current call site | Current state |",
      "|---|---|---|---|---|",
      "| `evt-a` | one | `emit_to(label, …)` | `lib.rs:1` | ✅ |",
      "| `evt-b` | all | `app.emit(…)` | `lib.rs:2` | ❌ violates rule X |",
      "",
      "after",
    ].join("\n");

    it("extracts 2 rows from a 2-row sample", () => {
      const out = parseEmitTargetTable(sample);
      expect(out).toHaveLength(2);
    });

    it("identifies ✅ rows", () => {
      const out = parseEmitTargetTable(sample);
      expect(out[0].ok).toBe(true);
    });

    it("identifies ❌ rows", () => {
      const out = parseEmitTargetTable(sample);
      expect(out[1].ok).toBe(false);
    });

    it("strips backticks from the event name", () => {
      const out = parseEmitTargetTable(sample);
      expect(out[0].event).toBe("evt-a");
      expect(out[1].event).toBe("evt-b");
    });

    it("captures the Target column verbatim for window-scoped detection", () => {
      // The structural broadcast lint relies on the Target column to
      // know which events must be window-scoped. Pin the parsing here.
      const out = parseEmitTargetTable(sample);
      expect(out[0].target).toBe("one");
      expect(out[1].target).toBe("all");
    });

    it("returns [] when no header line is found", () => {
      const out = parseEmitTargetTable("just some prose, no table at all");
      expect(out).toEqual([]);
    });

    it("stops at the first non-table line after the body", () => {
      const trailing = [
        "| Event | Target (rule) | Required emit method | Current call site | Current state |",
        "|---|---|---|---|---|",
        "| `evt-a` | one | `emit_to(label, …)` | `lib.rs:1` | ✅ |",
        "",
        "| `should-not-be-parsed` | one | `…` | `…` | ✅ |",
      ].join("\n");
      const out = parseEmitTargetTable(trailing);
      expect(out.map((r) => r.event)).toEqual(["evt-a"]);
    });
  });

  describe("parseEventPayloadsKeys (self-test)", () => {
    it("extracts every quoted property from a sample interface", () => {
      const src = [
        `export interface EventPayloads {`,
        `  "file-changed": { path: string };`,
        `  "folder-changed": { path: string };`,
        `  // a comment that should not match`,
        `  "args-received": void;`,
        `}`,
      ].join("\n");
      expect(parseEventPayloadsKeys(src)).toEqual([
        "file-changed",
        "folder-changed",
        "args-received",
      ]);
    });

    it("returns [] when EventPayloads is absent", () => {
      expect(parseEventPayloadsKeys("export type Foo = string;")).toEqual([]);
    });

    it("ignores nested-object braces inside property types", () => {
      const src = [
        `interface EventPayloads {`,
        `  "a": { nested: { deep: number } };`,
        `  "b": void;`,
        `}`,
      ].join("\n");
      expect(parseEventPayloadsKeys(src)).toEqual(["a", "b"]);
    });
  });
});
