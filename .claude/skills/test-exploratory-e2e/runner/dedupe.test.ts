import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeDedupeKey,
  normaliseAnchor,
  loadStore,
  mergeFinding,
  saveStore,
  type Finding,
} from "./dedupe";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ux-dedupe-")); });

describe("normaliseAnchor", () => {
  it("strips dynamic id values", () => {
    expect(normaliseAnchor("button.foo[data-id=abc123]"))
      .toBe("button.foo[data-id]");
  });
  it("strips :nth-child indices", () => {
    expect(normaliseAnchor("li:nth-child(7) > span"))
      .toBe("li:nth-child > span");
  });
  it("leaves stable anchors unchanged", () => {
    expect(normaliseAnchor("button[aria-label='Add comment']"))
      .toBe("button[aria-label='Add comment']");
  });
});

describe("computeDedupeKey", () => {
  it("is stable for same inputs and changes when any field changes", () => {
    const a = computeDedupeKey("MDR-IPC-RAW-JSON-ERROR", "viewer/markdown:abcd1234", "div.error-banner");
    const b = computeDedupeKey("MDR-IPC-RAW-JSON-ERROR", "viewer/markdown:abcd1234", "div.error-banner");
    const c = computeDedupeKey("MDR-IPC-RAW-JSON-ERROR", "viewer/markdown:abcd1234", "div.other");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("mergeFinding", () => {
  it("creates NEW entry on first sight", () => {
    const store = loadStore(join(dir, "k.json"));
    const f: Finding = {
      heuristic_id: "MDR-CONSOLE-ERROR",
      screen_id: "viewer/markdown:abcd1234",
      anchor: "div.x",
      severity: "P1",
      detail: "console.error fired",
      screenshot: "screenshots/step-1.png",
    };
    const r = mergeFinding(store, f, "2026-04-25T00:00:00Z");
    expect(r.status).toBe("NEW");
    expect(store.findings[r.key].reproductions).toBe(1);
  });

  it("marks REPRODUCED on second sight and increments counter", () => {
    const store = loadStore(join(dir, "k.json"));
    const f: Finding = {
      heuristic_id: "MDR-CONSOLE-ERROR",
      screen_id: "viewer/markdown:abcd1234",
      anchor: "div.x",
      severity: "P1",
      detail: "console.error fired",
      screenshot: "screenshots/step-1.png",
    };
    mergeFinding(store, f, "2026-04-20T00:00:00Z");
    const r = mergeFinding(store, f, "2026-04-25T00:00:00Z");
    expect(r.status).toBe("REPRODUCED");
    expect(store.findings[r.key].reproductions).toBe(2);
    expect(store.findings[r.key].first_seen).toBe("2026-04-20T00:00:00Z");
    expect(store.findings[r.key].last_seen).toBe("2026-04-25T00:00:00Z");
  });

  it("round-trips through saveStore/loadStore", () => {
    const path = join(dir, "k.json");
    const store = loadStore(path);
    mergeFinding(store, {
      heuristic_id: "WCAG-1.4.3",
      screen_id: "viewer/markdown:abcd1234",
      anchor: ".x",
      severity: "P2",
      detail: "contrast 3.1:1",
      screenshot: "s.png",
    }, "2026-04-25T00:00:00Z");
    saveStore(path, store);
    expect(existsSync(path)).toBe(true);
    const reloaded = loadStore(path);
    expect(Object.keys(reloaded.findings)).toHaveLength(1);
  });
});
