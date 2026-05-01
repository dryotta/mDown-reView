import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Tauri plugin registration parity contract.
 *
 * Background: shipping v0.4.0 of mdownreview, the macOS auto-update flow
 * downloaded + verified + installed the new bundle correctly, then the
 * "Restart Now" button silently failed. Root cause: `@tauri-apps/plugin-process`
 * was imported on the JS side (for `relaunch()`) but `tauri-plugin-process`
 * was never added to `src-tauri/Cargo.toml` and never `init()`-registered
 * in `src-tauri/src/lib.rs`. The matching ACL `process:default` was also
 * missing from `src-tauri/capabilities/default.json`. Vitest unit tests
 * passed because they mock `@tauri-apps/plugin-process` end-to-end and
 * never exercise a real Tauri host.
 *
 * Contract enforced here: for every `@tauri-apps/plugin-X` import in
 * production `src/` code, `tauri-plugin-X` MUST appear in
 * `src-tauri/Cargo.toml` AND `tauri_plugin_X::init()` MUST appear in
 * `src-tauri/src/lib.rs`. Built-in `@tauri-apps/api/*` modules need no
 * registration and are excluded.
 *
 * This is a static source-scan test (matches the established
 * `forbid_*_test.rs` / `ipc-mock-parity.test.ts` pattern in this repo).
 * Running it under Vitest keeps it close to the JS imports it polices.
 */

const ROOT = resolve(__dirname, "../..");
const SRC_DIR = resolve(ROOT, "src");
const CARGO_TOML = readFileSync(resolve(ROOT, "src-tauri/Cargo.toml"), "utf8");
const LIB_RS = readFileSync(resolve(ROOT, "src-tauri/src/lib.rs"), "utf8");

// Walk every JSON file under src-tauri/capabilities/ rather than hard-coding
// `default.json`. Tauri v2 supports multi-file capability layouts (e.g., a
// future `main-window.json` for window-scoped permissions); restricting the
// scan to a single file would silently miss permissions defined elsewhere.
function loadAllCapabilityJson(): string {
  const dir = resolve(ROOT, "src-tauri/capabilities");
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    out.push(readFileSync(join(dir, entry), "utf8"));
  }
  return out.join("\n");
}
const CAPS_JSON = loadAllCapabilityJson();

// Walk the src/ tree and collect every `@tauri-apps/plugin-<name>` reference,
// from both static `import ... from "@tauri-apps/plugin-X"` and dynamic
// `import("@tauri-apps/plugin-X")` forms. Exclude test/mock files — they
// must not introduce new plugin dependencies, and a mock import would be a
// false positive.
function collectPluginImports(dir: string, out: Set<string> = new Set()): Set<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "__mocks__" || entry === "__tests__" || entry === "node_modules") {
        continue;
      }
      collectPluginImports(full, out);
    } else if (
      st.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      const src = readFileSync(full, "utf8");
      // Restrict to actual import syntax — `from "@tauri-apps/plugin-X"`
      // (static) and `import("@tauri-apps/plugin-X")` (dynamic). A bare
      // mention in a comment / doc string / test fixture must NOT trip
      // the parity contract; the contract is about real wire-up, not
      // textual references.
      const re = /(?:from\s+|import\s*\(\s*)["']@tauri-apps\/plugin-([a-z][a-z0-9-]*)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        out.add(m[1]);
      }
    }
  }
  return out;
}

const PLUGIN_NAMES = collectPluginImports(SRC_DIR);

// kebab → snake (e.g. `clipboard-manager` → `clipboard_manager`) for the
// Rust `tauri_plugin_<name>::init()` symbol.
function toRustModule(kebab: string): string {
  return kebab.replace(/-/g, "_");
}

describe("Tauri plugin registration parity (JS imports ↔ Rust init)", () => {
  it("scans a non-empty plugin set from production src/ (sanity)", () => {
    expect(PLUGIN_NAMES.size).toBeGreaterThan(0);
    // Spot-check well-known plugins so a wholesale rename of src/ doesn't
    // make this test silently extract zero plugins.
    expect(PLUGIN_NAMES.has("opener")).toBe(true);
    expect(PLUGIN_NAMES.has("log")).toBe(true);
  });

  it("every @tauri-apps/plugin-X import is declared in src-tauri/Cargo.toml", () => {
    const missing: string[] = [];
    for (const name of PLUGIN_NAMES) {
      // Match `tauri-plugin-<name> = ...` at start of a line (ignoring
      // leading whitespace). Comments mentioning the crate elsewhere
      // don't count as a real dependency declaration.
      const re = new RegExp(`^\\s*tauri-plugin-${name}\\s*=`, "m");
      if (!re.test(CARGO_TOML)) {
        missing.push(`tauri-plugin-${name}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `JS-side imports require these Rust crates in src-tauri/Cargo.toml:\n  ${missing.join("\n  ")}\n` +
          `Without the dep, the matching tauri_plugin_<name>::init() call will fail to compile.`
      );
    }
  });

  it("every @tauri-apps/plugin-X import has a tauri_plugin_X::init() call in src-tauri/src/lib.rs", () => {
    const missing: string[] = [];
    for (const name of PLUGIN_NAMES) {
      const rustMod = toRustModule(name);
      // Require an actual call site (`init(` / `Builder::new(`), not a
      // bare symbol reference. Trailing `\s*\(` rules out comments and
      // doc-strings that mention the symbol but don't invoke it. The
      // `Builder::new(` arm covers plugins like `tauri-plugin-log` that
      // are constructed into a local variable and then registered
      // separately as `.plugin(local_var)` — requiring a literal
      // `.plugin(tauri_plugin_X::...)` would false-fail on that idiom.
      // (Limit: a commented-out `// tauri_plugin_X::init()` line still
      // matches; static text analysis without a Rust parser cannot
      // distinguish. Cargo dep + ACL gates would still catch the actual
      // breakage.)
      const re = new RegExp(`tauri_plugin_${rustMod}::(?:init|Builder::new)\\s*\\(`);
      if (!re.test(LIB_RS)) {
        missing.push(`tauri_plugin_${rustMod}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `JS-side imports require these init() calls in src-tauri/src/lib.rs:\n  ${missing
          .map((m) => `.plugin(${m}::init())`)
          .join("\n  ")}\n` +
          `Without the registration, the matching plugin:<name>|<command> IPC will be unrouted ` +
          `and reject at runtime — exactly the bug class that hid the missing tauri-plugin-process ` +
          `registration through v0.4.0 (macOS "Restart Now" no-op after auto-update).`
      );
    }
  });

  it("every @tauri-apps/plugin-X import has at least one matching <name>:* ACL entry under capabilities/", () => {
    const missing: string[] = [];
    for (const name of PLUGIN_NAMES) {
      // Match any colon-suffixed permission for this plugin —
      // `<name>:default`, `<name>:allow-*`, `<name>:deny-*`, or any future
      // Tauri v2 permission shape. Presence of any permission proves the
      // plugin's IPC has been ACL-considered, which is the property this
      // test exists to enforce. (The narrower question of whether the
      // chosen permission is least-privilege is a security-review concern,
      // not a parity concern.)
      const re = new RegExp(`"${name}:[a-z][a-z0-9-]*"`);
      if (!re.test(CAPS_JSON)) {
        missing.push(`${name}:<permission>`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `JS-side imports require at least one ACL entry per plugin under src-tauri/capabilities/*.json:\n  ${missing
          .map((m) => `"${m}"`)
          .join(",\n  ")}\n` +
          `Without any ACL, the plugin commands will be denied at runtime even if the plugin is registered.`
      );
    }
  });
});
