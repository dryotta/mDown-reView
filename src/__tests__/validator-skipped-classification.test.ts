import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Issue #140 — contract test: exe-implementation-validator must classify
 * a failing exit code as SKIPPED (not FAIL) when the only failing check
 * is a missing-prerequisite artifact (NSIS bundle, signed .app, CLI shim
 * binary) AND the diff under test doesn't touch the relevant installer
 * source paths.
 *
 * Motivating regression: feature-issue-90-sticky-viewer-toolbar-iter-1
 * retro shows the validator emitting the contradictory payload
 *   summary: "exit 1 — 13 passed, 1 failed"
 *   note:    "treat as SKIPPED if installer artifact is out of scope"
 * — pushing the classification choice upstream and forcing the
 * orchestrator skill to re-derive ground truth on every iterate run.
 */

const VALIDATOR_PATH = resolve(
  __dirname,
  "../../.claude/agents/exe-implementation-validator.md",
);
const VALIDATOR = readFileSync(VALIDATOR_PATH, "utf8");

describe("exe-implementation-validator SKIPPED classification (issue #140)", () => {
  it("declares an explicit Classification: PASS | FAIL | SKIPPED section", () => {
    expect(VALIDATOR).toMatch(
      /Classification:\s*PASS\s*\|\s*FAIL\s*\|\s*SKIPPED.*#140/,
    );
  });

  it("rules out the 'failing exit code = FAIL' shortcut", () => {
    expect(VALIDATOR).toMatch(/failing exit code is NOT automatically `?FAIL`?/);
  });

  it("names the prerequisite-artifact failure modes (NSIS, signed .app, CLI shim)", () => {
    expect(VALIDATOR.toLowerCase()).toContain("nsis");
    expect(VALIDATOR.toLowerCase()).toContain("signed");
    expect(VALIDATOR.toLowerCase()).toContain("cli shim");
  });

  it("cites the verbatim error tokens the validator should grep for", () => {
    // The retro pinpoints "No NSIS bundle dir found" — that exact token must
    // appear so a future validator agent grep matches the runtime output.
    expect(VALIDATOR).toContain("No NSIS bundle dir found");
  });

  it("requires the diff to NOT touch the installer source paths to qualify", () => {
    expect(VALIDATOR).toContain("src-tauri/installer/");
    expect(VALIDATOR).toMatch(/src-tauri\/dmg\/|bundle\.macOS/);
    expect(VALIDATOR).toMatch(/cli_shim/);
  });

  it("requires the per-test breakdown (not just exit code) to drive classification", () => {
    expect(VALIDATOR).toMatch(/per-test breakdown/i);
    expect(VALIDATOR).toMatch(/13 passed, 1 failed|passed.*failed/);
  });

  it("forbids the hedging-payload anti-pattern called out in the retro", () => {
    expect(VALIDATOR.toLowerCase()).toContain("never emit a hedging payload");
    expect(VALIDATOR).toContain("treat as SKIPPED if installer artifact is out of scope");
    expect(VALIDATOR.toLowerCase()).toContain("do not push the choice upstream");
  });

  it("requires citing the exact stderr token that triggered SKIPPED so the orchestrator can audit", () => {
    expect(VALIDATOR.toLowerCase()).toContain("cite the exact stderr token");
  });
});
