import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import type { MrsfSidecar } from "@/lib/tauri-commands";

const fixturesDir = join(__dirname, "../../__tests__/fixtures/mrsf");

describe("MRSF round-trip", () => {
  it("parses architecture.md.review.yaml", () => {
    const raw = readFileSync(join(fixturesDir, "architecture.md.review.yaml"), "utf-8");
    const sidecar = yaml.load(raw) as MrsfSidecar;
    expect(sidecar.mrsf_version).toBe("1.0");
    expect(sidecar.document).toContain("architecture.md");
    expect(sidecar.comments.length).toBeGreaterThan(0);
  });

  it("parses contributing.md.review.yaml with threading", () => {
    const raw = readFileSync(join(fixturesDir, "contributing.md.review.yaml"), "utf-8");
    const sidecar = yaml.load(raw) as MrsfSidecar;
    expect(sidecar.mrsf_version).toBe("1.0");
    expect(sidecar.comments.length).toBeGreaterThanOrEqual(3);
    // Check reply_to threading
    const replies = sidecar.comments.filter(c => c.reply_to);
    expect(replies.length).toBeGreaterThan(0);
  });

  it("round-trips YAML → object → YAML preserving required fields", () => {
    const raw = readFileSync(join(fixturesDir, "architecture.md.review.yaml"), "utf-8");
    const sidecar = yaml.load(raw) as MrsfSidecar;
    const rewritten = yaml.dump(sidecar, { quotingType: '"', forceQuotes: false });
    const reparsed = yaml.load(rewritten) as MrsfSidecar;
    expect(reparsed.mrsf_version).toBe(sidecar.mrsf_version);
    expect(reparsed.comments.length).toBe(sidecar.comments.length);
    // Verify all required fields survive round-trip
    for (let i = 0; i < sidecar.comments.length; i++) {
      expect(reparsed.comments[i].id).toBe(sidecar.comments[i].id);
      expect(reparsed.comments[i].author).toBe(sidecar.comments[i].author);
      expect(reparsed.comments[i].text).toBe(sidecar.comments[i].text);
    }
  });

  it("all fixture comments have required MRSF fields", () => {
    for (const fixture of ["architecture.md.review.yaml", "contributing.md.review.yaml"]) {
      const raw = readFileSync(join(fixturesDir, fixture), "utf-8");
      const sidecar = yaml.load(raw) as MrsfSidecar;
      for (const c of sidecar.comments) {
        expect(c.id, `${fixture}: missing id`).toBeTruthy();
        expect(c.author, `${fixture}: missing author on ${c.id}`).toBeTruthy();
        expect(c.timestamp, `${fixture}: missing timestamp on ${c.id}`).toBeTruthy();
        expect(c.text, `${fixture}: missing text on ${c.id}`).toBeTruthy();
        expect(typeof c.resolved, `${fixture}: missing resolved on ${c.id}`).toBe("boolean");
      }
    }
  });
});
