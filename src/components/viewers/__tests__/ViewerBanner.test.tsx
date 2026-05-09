/**
 * Issue #338 / Group B-foundation — `ViewerBanner` + `selectBannerVariant`.
 *
 * Pure-function precedence is locked down for all 5 variants + null;
 * the component renders are smoke-tested for AC10 ("at most one banner
 * with at most one button") and Allow-button click wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ViewerBanner,
  selectBannerVariant,
  type BannerInputs,
} from "@/components/viewers/ViewerBanner";
import { useStore } from "@/store";

vi.mock("@/logger", () => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

const baseInputs: BannerInputs = {
  tier3Count: 0,
  tier2Count: 0,
  externalImageCount: 0,
  allowOutsideForThisTab: false,
  allowExternalImagesForThisTab: false,
  tabPath: "/ws/a.md",
};

beforeEach(() => {
  // Reset Zustand allow set so click handlers in tests start clean.
  useStore.setState({
    allowOutsideWorkspace: new Set<string>(),
    allowedRemoteImageDocs: {},
  } as never);
});

describe("selectBannerVariant", () => {
  it("returns null when all counts are zero", () => {
    expect(selectBannerVariant(baseInputs)).toBeNull();
  });

  it("tier-3 wins over every other tier", () => {
    const v = selectBannerVariant({
      ...baseInputs,
      tier3Count: 1,
      tier2Count: 5,
      externalImageCount: 5,
      allowOutsideForThisTab: true,
      allowExternalImagesForThisTab: true,
    });
    expect(v).toEqual({ kind: "tier3-references" });
  });

  it("tier-2 blocked when toggle off and tabPath present", () => {
    const v = selectBannerVariant({ ...baseInputs, tier2Count: 2 });
    expect(v).toEqual({ kind: "tier2-references-blocked", tabPath: "/ws/a.md" });
  });

  it("tier-2 allowed when toggle on", () => {
    const v = selectBannerVariant({
      ...baseInputs,
      tier2Count: 2,
      allowOutsideForThisTab: true,
    });
    expect(v).toEqual({ kind: "tier2-references-allowed" });
  });

  it("falls through to null when tabPath is missing on every blocked tier", () => {
    const v = selectBannerVariant({
      ...baseInputs,
      tabPath: null,
      tier2Count: 1,
      externalImageCount: 1,
    });
    // Both blocked variants gate on `tabPath`; without it we cannot key
    // the per-tab Allow toggle, so the precedence falls through to null.
    expect(v).toBeNull();
  });

  it("external-images blocked when toggle off and tabPath present", () => {
    const v = selectBannerVariant({ ...baseInputs, externalImageCount: 3 });
    expect(v).toEqual({ kind: "external-images-blocked", tabPath: "/ws/a.md" });
  });

  it("external-images allowed when toggle on", () => {
    const v = selectBannerVariant({
      ...baseInputs,
      externalImageCount: 3,
      allowExternalImagesForThisTab: true,
    });
    expect(v).toEqual({ kind: "external-images-allowed" });
  });

  it("tier-2 takes precedence over external-images", () => {
    const v = selectBannerVariant({
      ...baseInputs,
      tier2Count: 1,
      externalImageCount: 1,
    });
    expect(v).toEqual({ kind: "tier2-references-blocked", tabPath: "/ws/a.md" });
  });
});

describe("<ViewerBanner>", () => {
  it("renders nothing for null variant", () => {
    const { container } = render(<ViewerBanner variant={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("tier-3 variant: copy + zero buttons (AC10 — never an Allow on tier-3)", () => {
    render(<ViewerBanner variant={{ kind: "tier3-references" }} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it.each([
    { kind: "tier3-references" as const },
    { kind: "tier2-references-blocked" as const, tabPath: "/ws/a.md" },
    { kind: "tier2-references-allowed" as const },
    { kind: "external-images-blocked" as const, tabPath: "/ws/a.md" },
    { kind: "external-images-allowed" as const },
  ])("$kind: at most one button (AC10)", (variant) => {
    render(<ViewerBanner variant={variant} />);
    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBeLessThanOrEqual(1);
  });

  it("tier-2 blocked Allow click → store.extendScopeForTab(tabPath) flips flag after IPC resolves", async () => {
    render(
      <ViewerBanner
        variant={{ kind: "tier2-references-blocked", tabPath: "/ws/a.md" }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /allow/i }));
    // Issue #359 / AC3 — flag-flip is gated on the
    // `extend_window_scope_files` IPC. Mocked invoke resolves
    // synchronously through several microtasks (bindings → unwrap →
    // extendScopeForTab); a setTimeout(0) flushes the whole chain.
    await new Promise((r) => setTimeout(r, 0));
    expect(useStore.getState().allowOutsideWorkspace.has("/ws/a.md")).toBe(true);
  });

  it("external-images blocked Allow click → store.allowRemoteImagesForDoc(tabPath)", () => {
    render(
      <ViewerBanner
        variant={{ kind: "external-images-blocked", tabPath: "/ws/a.md" }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /allow external/i }));
    expect(useStore.getState().allowedRemoteImageDocs["/ws/a.md"]).toBe(true);
  });
});
