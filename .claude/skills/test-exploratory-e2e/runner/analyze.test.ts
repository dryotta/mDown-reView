import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRules, type Snapshot } from "./analyze";

const FX = join(__dirname, "fixtures");
const load = (name: string): Snapshot =>
  JSON.parse(readFileSync(join(FX, `${name}.json`), "utf8"));

describe("rule engine — deterministic families", () => {
  it("MDR-IPC-RAW-JSON-ERROR fires on raw kind/message JSON in DOM", () => {
    const hits = runRules(load("mdr-ipc-raw-json-error"));
    expect(hits.map((h) => h.id)).toContain("MDR-IPC-RAW-JSON-ERROR");
  });

  it("WCAG-1.4.3 fires when contrast < 4.5:1 on body text", () => {
    const hits = runRules(load("wcag-1.4.3-fail"));
    const wcag = hits.find((h) => h.id === "WCAG-1.4.3");
    expect(wcag).toBeDefined();
    expect(wcag!.anchor).toBe("span.comment-meta");
  });

  it("WCAG-1.4.3 does NOT fire when contrast >= 4.5:1", () => {
    const hits = runRules(load("wcag-1.4.3-pass"));
    expect(hits.find((h) => h.id === "WCAG-1.4.3")).toBeUndefined();
  });

  it("WCAG-4.1.2 fires on icon-only button without accessible name", () => {
    const hits = runRules(load("wcag-4.1.2-fail"));
    expect(hits.map((h) => h.id)).toContain("WCAG-4.1.2");
  });

  it("MDR-CONSOLE-ERROR fires when any console.error is in the bundle", () => {
    const hits = runRules(load("mdr-console-error"));
    expect(hits.map((h) => h.id)).toContain("MDR-CONSOLE-ERROR");
  });

  it("AP-EMOJI-AS-ICON fires when emoji used inside button without svg", () => {
    const hits = runRules(load("ap-emoji-as-icon"));
    expect(hits.map((h) => h.id)).toContain("AP-EMOJI-AS-ICON");
  });
});
