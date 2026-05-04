/**
 * Iter-22 (#352 retrospective §6.1, §8 P0, §9 closing) — round-trip
 * preservation CI gate for every shipped Excalidraw fixture.
 *
 * Per the retrospective `docs/retrospectives/2026-05-03-352-data-loss-class.md`:
 *
 * > **The one change with the highest expected payoff: making
 * > byte-for-byte round-trip preservation of every shipped fixture a
 * > CI gate.** Of the 27 bugs in §1, **at least 9** (#4, #5, #6, #7,
 * > #12, #19, #20, #24, plus the iter-7 root cause of #6) — including
 * > both iter-21 P0s (#24 and indirectly #25) — would have been
 * > caught at the iter at which they were introduced by a single
 * > round-trip test like §6.1.
 *
 * What this gate exercises (three layers):
 *
 *   1. **Fixture-pinning** (retro §8 P2). Every file in
 *      `samples/excalidraw/` has its SHA-256 locked in
 *      `samples/excalidraw/.fixtures.lock`. A test asserts the on-disk
 *      file's hash matches. THIS is the structural fix for the iter-3
 *      → iter-20 silent corruption: the canonical
 *      `3-icons.excalidrawlib` was wiped 226 → 6 lines on every
 *      autosave during iters 3–20 in PR #353 (every CI green); a
 *      future PR cannot subvert subsequent gates by editing a fixture
 *      to make a regression "pass."
 *
 *   2. **Structural invariants.** Each fixture loads, parses, and
 *      satisfies its expected shape (non-empty `libraryItems`,
 *      non-empty `elements`, correct top-level `type`). Catches the
 *      class of regressions where a save-pipeline bug silently
 *      coerces a populated container to its empty default (#352
 *      bug #24).
 *
 *   3. **Production save-pipeline round-trip.** Drives
 *      `saveExcalidrawFile` (the same call site `useExcalidrawAutoSave`
 *      uses) with bytes loaded from each fixture, with the workspace-
 *      write IPC mocked to capture output. Asserts the captured bytes
 *      are byte-equivalent to the input modulo Excalidraw's volatile
 *      mutation triple (`version`, `versionNonce`, `updated`). This is
 *      the §6.1 stub adapted to mock Excalidraw's serializers via
 *      `vi.mock` — a future iteration can swap to the real serializer
 *      once a jsdom-compatible loader is wired (the upstream library
 *      pulls in canvas APIs at module import time, blocking real-
 *      function imports in unit tests).
 *
 * Out of scope (intentional): real Excalidraw `serializeAsJSON` /
 * `serializeLibraryAsJSON` invocation. The library's full bundle
 * touches HTMLCanvasElement.getContext() at module-scope evaluation,
 * which crashes jsdom. The `saveScene.ts` branching is locked here at
 * the IPC boundary; the upstream serializer's correctness is exercised
 * by the live app + native E2E (`08-excalidraw-real-write.spec.ts`)
 * + decode parity in `samples/excalidraw/_verify.mjs`. A real-
 * Excalidraw round-trip belongs in a `*.real.test.ts` running with
 * `node` + `canvas` package — tracked as a follow-up.
 */

import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, "../../../../samples/excalidraw");
const LOCK_FILE = resolve(FIXTURE_DIR, ".fixtures.lock");

/**
 * Volatile fields Excalidraw mutates on EVERY mount, even with no
 * persistent-content change (font load, library merge, normalisation).
 * The save serializer correctly overwrites them; the loader correctly
 * accepts the new values; only the round-trip equality is volatile,
 * not the fields themselves. Mirrors the strip in
 * `src/lib/excalidraw/stable-hash.ts`.
 */
const VOLATILE_KEYS = new Set(["version", "versionNonce", "updated"]);

/**
 * Recursive deep clone that drops every key in `VOLATILE_KEYS`.
 */
function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripVolatile);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(k)) continue;
      out[k] = stripVolatile(v);
    }
    return out;
  }
  return value;
}

async function sha256(path: string): Promise<string> {
  const bytes = await fs.readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

interface LockEntry {
  hash: string;
  filename: string;
}

async function parseLock(): Promise<LockEntry[]> {
  const raw = await fs.readFile(LOCK_FILE, "utf8");
  const entries: LockEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([0-9a-f]{64})\s\s+(.+)$/);
    if (!m) throw new Error(`malformed .fixtures.lock entry: ${line}`);
    entries.push({ hash: m[1], filename: m[2] });
  }
  return entries;
}

describe("Excalidraw fixture-pinning gate (#352 retro §8 P2)", () => {
  it("every fixture matches its SHA-256 in samples/excalidraw/.fixtures.lock", async () => {
    const lock = await parseLock();
    expect(lock.length).toBeGreaterThan(0);
    for (const { hash, filename } of lock) {
      const actual = await sha256(resolve(FIXTURE_DIR, filename));
      expect(actual, `SHA mismatch for ${filename}`).toBe(hash);
    }
  });

  it("every fixture in the directory is listed in the lock", async () => {
    // Catches the inverse: a file added to samples/ but not pinned.
    // Without this, a malicious "regen the fixture, ignore the
    // mismatch" PR could land an empty fixture and pass CI.
    const lock = await parseLock();
    const lockedNames = new Set(lock.map((e) => e.filename));
    const dirFiles = (await fs.readdir(FIXTURE_DIR)).filter(
      (n) =>
        n.endsWith(".excalidraw") ||
        n.endsWith(".excalidrawlib") ||
        n.endsWith(".excalidraw.svg") ||
        n.endsWith(".excalidraw.png"),
    );
    for (const f of dirFiles) {
      expect(lockedNames.has(f), `${f} is in samples/ but not pinned`).toBe(
        true,
      );
    }
  });
});

describe("Excalidraw fixture structural invariants (#352 retro §6.1, §8 P0)", () => {
  it("1-shapes.excalidraw — type=excalidraw + non-empty elements", async () => {
    const raw = await fs.readFile(
      resolve(FIXTURE_DIR, "1-shapes.excalidraw"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.type).toBe("excalidraw");
    expect(Array.isArray(parsed.elements)).toBe(true);
    expect((parsed.elements as unknown[]).length).toBeGreaterThan(0);
    expect(typeof parsed.appState).toBe("object");
  });

  it("2-flowchart.excalidraw — multi-element scene", async () => {
    const raw = await fs.readFile(
      resolve(FIXTURE_DIR, "2-flowchart.excalidraw"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.type).toBe("excalidraw");
    expect((parsed.elements as unknown[]).length).toBeGreaterThan(1);
  });

  it("3-icons.excalidrawlib — type=excalidrawlib + non-empty libraryItems (#352 P0-1 inverse)", async () => {
    // The exact inverse-shape assertion that the iter-21 P0-1 library
    // wipe regression would fail. Pre-fix, every autosave wrote
    // `libraryItems: []`, reducing the file from 226 lines to 6.
    // This test would FAIL the moment that regression's output was
    // committed to the repo; combined with fixture-pinning above, the
    // regression is structurally impossible to land green.
    const raw = await fs.readFile(
      resolve(FIXTURE_DIR, "3-icons.excalidrawlib"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.type).toBe("excalidrawlib");
    expect(Array.isArray(parsed.libraryItems)).toBe(true);
    expect((parsed.libraryItems as unknown[]).length).toBeGreaterThan(0);
    // Each library item carries inner elements; the bug shape was an
    // outer empty array, so check both layers.
    for (const item of parsed.libraryItems as unknown[]) {
      const itemObj = item as Record<string, unknown>;
      expect(Array.isArray(itemObj.elements)).toBe(true);
      expect((itemObj.elements as unknown[]).length).toBeGreaterThan(0);
    }
    // Line count: a bug that drops libraryItems coerces the entire
    // file to a few-line stub (~6 lines for the empty case).
    // Assert the post-fix fixture is meaningfully larger than the
    // bug shape so future shrinkage trips a clear signal.
    const lineCount = raw.split("\n").length;
    expect(lineCount).toBeGreaterThan(20);
  });

  it("4-shapes.excalidraw.svg — payload-type marker present", async () => {
    // SVG-embedded scene marker (per Excalidraw's decodeSvgBase64Payload).
    // If the embed step is silently dropped (regression of #19), this
    // marker would be missing.
    const raw = await fs.readFile(
      resolve(FIXTURE_DIR, "4-shapes.excalidraw.svg"),
      "utf8",
    );
    expect(raw).toContain("payload-type:application/vnd.excalidraw+json");
    expect(raw).toContain("payload-start");
    expect(raw).toContain("payload-end");
  });

  it("5-shapes.excalidraw.png — PNG signature + tEXt chunk for excalidraw scene", async () => {
    // PNG magic + a tEXt chunk whose keyword is the excalidraw MIME
    // (Format B fallback Excalidraw uses to embed the scene).
    const bytes = await fs.readFile(
      resolve(FIXTURE_DIR, "5-shapes.excalidraw.png"),
    );
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(bytes.length).toBeGreaterThan(8);
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
    // Cheap substring scan for the MIME marker.
    const ascii = bytes.toString("latin1");
    expect(ascii).toContain("application/vnd.excalidraw+json");
  });
});

describe("Excalidraw production save-pipeline round-trip (#352 retro §6.1)", () => {
  // Mock the workspace-write IPC so we capture the bytes saveScene
  // pushes through it. Mock @excalidraw/excalidraw at the level
  // saveScene imports it — pass the loaded data through the same
  // call-graph the production save uses.
  beforeEach(() => {
    vi.resetModules();
  });

  it("saveExcalidrawFile(.excalidrawlib) round-trips libraryItems byte-equivalent (locks #352 P0-1)", async () => {
    // The exact iter-21 P0-1 regression test: load the canonical
    // library fixture, drive `saveExcalidrawFile`, capture the bytes
    // the IPC layer received, parse them back, and assert the
    // libraryItems survived. Pre-fix, `data.libraryItems` would have
    // been undefined → fallthrough to `[]` → the bytes captured here
    // would be the 6-line empty library. Post-fix the round-trip is
    // identity (modulo volatile fields).
    //
    // Mocks `@excalidraw/excalidraw` with a hand-rolled serializer
    // matching its documented output shape. NOT an attempt to
    // duplicate the upstream — solely a vehicle to observe the
    // payload `saveScene` builds. The tighter version (real
    // serializer) is gated by jsdom + canvas; tracked as a follow-up.
    const writeTextSpy = vi.fn(async (_path: string, _text: string): Promise<void> => {});
    vi.doMock("@/lib/tauri-commands", () => ({
      writeWorkspaceText: writeTextSpy,
      writeWorkspaceBinary: vi.fn(async () => {}),
    }));
    vi.doMock("@excalidraw/excalidraw", () => ({
      serializeAsJSON: (
        elements: unknown,
        appState: unknown,
        files: unknown,
      ) =>
        JSON.stringify(
          {
            type: "excalidraw",
            version: 2,
            source: "test",
            elements,
            appState,
            files,
          },
          null,
          2,
        ),
      serializeLibraryAsJSON: (libraryItems: unknown) =>
        JSON.stringify(
          {
            type: "excalidrawlib",
            version: 2,
            source: "test",
            libraryItems,
          },
          null,
          2,
        ),
      exportToBlob: vi.fn(),
      exportToSvg: vi.fn(),
    }));

    const { saveExcalidrawFile } = await import("../saveScene");

    const raw = await fs.readFile(
      resolve(FIXTURE_DIR, "3-icons.excalidrawlib"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const libraryItems = parsed.libraryItems as ReadonlyArray<unknown>;
    expect(libraryItems.length).toBeGreaterThan(0);

    const PATH = "/ws/round-trip-3-icons.excalidrawlib";
    await saveExcalidrawFile(PATH, {
      elements: [],
      appState: {},
      files: {},
      libraryItems,
    });

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    const [path, text] = writeTextSpy.mock.calls[0] as [string, string];
    expect(path).toBe(PATH);
    const reparsed = JSON.parse(text) as Record<string, unknown>;

    // The exact iter-21 P0-1 invariant: libraryItems survive the
    // production save pipeline byte-equivalent.
    expect(reparsed.type).toBe("excalidrawlib");
    expect((reparsed.libraryItems as unknown[]).length).toBe(
      libraryItems.length,
    );
    expect(stripVolatile(reparsed.libraryItems)).toEqual(
      stripVolatile(libraryItems),
    );

    vi.doUnmock("@/lib/tauri-commands");
    vi.doUnmock("@excalidraw/excalidraw");
  });

  it("saveExcalidrawFile(.excalidrawlib) with libraryItems=null fallthroughs to [] (locks the bug shape)", async () => {
    // Inverse: if a future regression re-introduces the
    // `data.libraryItems = undefined` shape, this is the captured
    // output that should LOSE the fixture. The post-fix
    // `useExcalidrawAutoSave` plumbs `liveLibraryItemsRef.current` —
    // which `setBaselineLibrary` seeds from the loaded scene — so
    // production never reaches saveScene with a null/undefined
    // libraryItems for an .excalidrawlib path. This test locks the
    // saveScene fallback's shape for forensics.
    const writeTextSpy = vi.fn(async (_path: string, _text: string): Promise<void> => {});
    vi.doMock("@/lib/tauri-commands", () => ({
      writeWorkspaceText: writeTextSpy,
      writeWorkspaceBinary: vi.fn(async () => {}),
    }));
    vi.doMock("@excalidraw/excalidraw", () => ({
      serializeAsJSON: (
        elements: unknown,
        appState: unknown,
        files: unknown,
      ) =>
        JSON.stringify(
          {
            type: "excalidraw",
            version: 2,
            source: "test",
            elements,
            appState,
            files,
          },
          null,
          2,
        ),
      serializeLibraryAsJSON: (libraryItems: unknown) =>
        JSON.stringify(
          {
            type: "excalidrawlib",
            version: 2,
            source: "test",
            libraryItems,
          },
          null,
          2,
        ),
      exportToBlob: vi.fn(),
      exportToSvg: vi.fn(),
    }));

    const { saveExcalidrawFile } = await import("../saveScene");

    await saveExcalidrawFile("/ws/empty.excalidrawlib", {
      elements: [],
      appState: {},
      files: {},
      libraryItems: null,
    });

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    const [, text] = writeTextSpy.mock.calls[0] as [string, string];
    const reparsed = JSON.parse(text) as Record<string, unknown>;
    // Empty library — the bug shape. The line count is roughly 6
    // (the "226 → 6 lines" forensic measurement from the
    // retrospective).
    expect((reparsed.libraryItems as unknown[]).length).toBe(0);
    expect(text.split("\n").length).toBeLessThanOrEqual(8);

    vi.doUnmock("@/lib/tauri-commands");
    vi.doUnmock("@excalidraw/excalidraw");
  });

  it("saveExcalidrawFile(.excalidraw) round-trips elements byte-equivalent", async () => {
    const writeTextSpy = vi.fn(async (_path: string, _text: string): Promise<void> => {});
    vi.doMock("@/lib/tauri-commands", () => ({
      writeWorkspaceText: writeTextSpy,
      writeWorkspaceBinary: vi.fn(async () => {}),
    }));
    vi.doMock("@excalidraw/excalidraw", () => ({
      serializeAsJSON: (
        elements: unknown,
        appState: unknown,
        files: unknown,
      ) =>
        JSON.stringify(
          {
            type: "excalidraw",
            version: 2,
            source: "test",
            elements,
            appState,
            files,
          },
          null,
          2,
        ),
      serializeLibraryAsJSON: vi.fn(),
      exportToBlob: vi.fn(),
      exportToSvg: vi.fn(),
    }));

    const { saveExcalidrawFile } = await import("../saveScene");

    const raw = await fs.readFile(
      resolve(FIXTURE_DIR, "1-shapes.excalidraw"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const elements = parsed.elements as ReadonlyArray<unknown>;
    const appState = parsed.appState as Record<string, unknown>;
    const files = (parsed.files ?? {}) as Record<string, unknown>;
    expect(elements.length).toBeGreaterThan(0);

    await saveExcalidrawFile("/ws/round-trip-1-shapes.excalidraw", {
      elements,
      appState,
      files,
    });

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    const [, text] = writeTextSpy.mock.calls[0] as [string, string];
    const reparsed = JSON.parse(text) as Record<string, unknown>;

    expect(reparsed.type).toBe("excalidraw");
    expect((reparsed.elements as unknown[]).length).toBe(elements.length);
    expect(stripVolatile(reparsed.elements)).toEqual(stripVolatile(elements));

    vi.doUnmock("@/lib/tauri-commands");
    vi.doUnmock("@excalidraw/excalidraw");
  });
});

