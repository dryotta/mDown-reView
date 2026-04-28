import { describe, it, expect } from "vitest";
import { formatBadgeCount, BADGE_CAP } from "../format-badge-count";

describe("formatBadgeCount", () => {
  it("returns the number as string for counts at or below cap", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(50)).toBe("50");
    expect(formatBadgeCount(BADGE_CAP)).toBe("99");
  });

  it('returns "99+" for counts above cap', () => {
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(999)).toBe("99+");
  });
});
