/**
 * Issue #338 / Group B-foundation — `Tier3Placeholder` privacy contract (AC8).
 *
 * The full path MUST appear only in the `title=` attribute. The visible
 * body uses a fixed string so the blocked path cannot leak via screenshots
 * or accidental copy/paste of rendered text.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Tier3Placeholder } from "@/components/viewers/Tier3Placeholder";

describe("Tier3Placeholder", () => {
  it("does NOT render the path as visible text (privacy / AC8)", () => {
    const { container } = render(<Tier3Placeholder path="/etc/passwd" />);
    const span = container.querySelector("span")!;
    expect(span.textContent ?? "").not.toContain("/etc/passwd");
    expect(span.textContent ?? "").not.toContain("passwd");
    expect(span.textContent ?? "").not.toContain("etc");
  });

  it("forwards path to title= attribute for power-user diagnosis", () => {
    const { container } = render(<Tier3Placeholder path="/etc/passwd" />);
    const span = container.querySelector("span")!;
    expect(span.getAttribute("title")).toBe("/etc/passwd");
  });

  it('exposes data-tier="blocked" for selector hooks', () => {
    const { container } = render(<Tier3Placeholder path="/x" />);
    expect(container.querySelector('[data-tier="blocked"]')).not.toBeNull();
  });

  it("includes a default category in the visible body", () => {
    const { container } = render(<Tier3Placeholder path="/x" />);
    expect(container.textContent ?? "").toContain("system location");
  });

  it("respects custom category", () => {
    const { container } = render(
      <Tier3Placeholder path="/x" category="dangerous scheme" />
    );
    expect(container.textContent ?? "").toContain("dangerous scheme");
  });

  it("does not leak path even with a custom category", () => {
    const winPath = "C:\\Windows\\System32\\config";
    const { container } = render(
      <Tier3Placeholder path={winPath} category="windows root" />
    );
    expect(container.textContent ?? "").not.toContain("System32");
    expect(container.querySelector("span")!.getAttribute("title")).toBe(winPath);
  });
});
