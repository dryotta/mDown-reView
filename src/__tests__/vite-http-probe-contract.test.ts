import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Contract test for issue #155: both test-exploratory-loop and
// test-exploratory-e2e SKILL.md must document the HTTP probe of
// http://localhost:1420 (with a real timeout) and prescribe a
// kill-and-respawn recovery path on probe failure. Without this,
// Vite's silent listener-crash mode (process alive, port closed)
// silently corrupts every iteration — chrome-error://chromewebdata/
// gets loaded instead of the app and exploratory runs read
// nonsense observations.

const ROOT = join(__dirname, "..", "..");
const LOOP_SKILL = join(ROOT, ".claude", "skills", "test-exploratory-loop", "SKILL.md");
const E2E_SKILL = join(ROOT, ".claude", "skills", "test-exploratory-e2e", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Vite HTTP-probe contract (issue #155)", () => {
  describe("test-exploratory-loop SKILL.md", () => {
    const text = read(LOOP_SKILL);

    it("documents the per-iteration HTTP probe of localhost:1420", () => {
      expect(text).toMatch(/Invoke-WebRequest[^\n]*localhost:1420/);
      expect(text).toMatch(/TimeoutSec\s+3/);
    });

    it("explains the failure mode the probe protects against", () => {
      // Must call out that the shell-alive check is not enough — the
      // listener can crash silently. This is the whole point of #155.
      expect(text).toMatch(/listener.*(crash|drop)|silent/i);
    });

    it("prescribes a kill-and-respawn recovery on probe failure", () => {
      expect(text).toMatch(/Stop-Process[^\n]*-Id/);
      expect(text).toMatch(/npx vite/);
      expect(text).toMatch(/re-?probe/i);
    });

    it("references issue #155 so the rule's motivation is auditable", () => {
      expect(text).toMatch(/#155/);
    });

    it("places the probe before invoking the inner test-exploratory-e2e skill", () => {
      const probeIdx = text.search(/Invoke-WebRequest[^\n]*localhost:1420/);
      const innerInvokeIdx = text.search(/Run one round.*test-exploratory-e2e/);
      expect(probeIdx).toBeGreaterThan(-1);
      expect(innerInvokeIdx).toBeGreaterThan(-1);
      expect(probeIdx).toBeLessThan(innerInvokeIdx);
    });
  });

  describe("test-exploratory-e2e SKILL.md", () => {
    const text = read(E2E_SKILL);

    it("documents the same HTTP probe in the inner pre-flight", () => {
      expect(text).toMatch(/Invoke-WebRequest[^\n]*localhost:1420/);
      expect(text).toMatch(/TimeoutSec\s+3/);
    });

    it("prescribes the same kill-and-respawn recovery", () => {
      expect(text).toMatch(/Stop-Process[^\n]*-Id/);
      expect(text).toMatch(/npx vite/);
    });

    it("forbids the unsafe Stop-Process -Name node shortcut", () => {
      // -Name node would kill every Node process on the box, including
      // the Vitest watcher and any other tooling. The probe recovery
      // must use -Id with the `vite` shellId's PID.
      expect(text).toMatch(/Stop-Process -Name node/);
      // The match above is the FORBIDDEN-token literal we expect to be
      // mentioned in a forbidding context. Verify it's preceded by
      // "Never" or similar:
      const idx = text.indexOf("Stop-Process -Name node");
      const before = text.slice(Math.max(0, idx - 40), idx).toLowerCase();
      expect(before).toMatch(/never|do not|don't/);
    });

    it("references issue #155", () => {
      expect(text).toMatch(/#155/);
    });
  });
});
