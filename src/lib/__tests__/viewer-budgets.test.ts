import { describe, it, expect } from "vitest";
import { SIZE_WARN_THRESHOLD } from "@/lib/viewer-budgets";

describe("viewer-budgets", () => {
  it("SIZE_WARN_THRESHOLD is 500 KiB", () => {
    expect(SIZE_WARN_THRESHOLD).toBe(500 * 1024);
  });
});
