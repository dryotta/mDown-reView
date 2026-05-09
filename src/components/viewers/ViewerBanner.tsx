/**
 * Shared banner component for both markdown and HTML viewers
 * (issue #338 / AC7+AC10 — "at most one banner with at most one button").
 *
 * Variant selection is delegated to the pure `selectBannerVariant` function
 * so precedence is testable in isolation. The component renders nothing
 * when the variant is `null` (no banner needed).
 *
 * Precedence (highest first):
 *   1. tier-3 references (system / dangerous schemes) — no Allow button.
 *   2. tier-2 references (outside-workspace) — Allow toggle when blocked.
 *   3. external image references — Allow toggle when blocked.
 *
 * Each tier surfaces a "blocked" variant when the toggle is off and an
 * informational "allowed" variant when the user has opted in. AC10
 * forbids stacking — a single ViewerBanner instance is always shown.
 */

import { useStore } from "@/store";

export type BannerVariant =
  | { kind: "tier3-references" }
  | { kind: "tier2-references-blocked"; tabPath: string }
  | { kind: "tier2-references-allowed" }
  | { kind: "external-images-blocked"; tabPath: string }
  | { kind: "external-images-allowed" };

export interface BannerInputs {
  /** Number of tier-3 references (system / dangerous schemes) detected. */
  tier3Count: number;
  /** Number of outside-workspace references (tier-2). */
  tier2Count: number;
  /** Number of external https/http `<img>` sources. */
  externalImageCount: number;
  /** Per-tab outside-workspace allow flag (read from Zustand). */
  allowOutsideForThisTab: boolean;
  /** Per-tab external-image allow flag (read from Zustand). */
  allowExternalImagesForThisTab: boolean;
  /** Source-of-truth tab path; null for non-tab contexts (no Allow button). */
  tabPath: string | null;
}

/**
 * Pure precedence function. Returns the highest-priority unallowed variant
 * (or the lowest-priority "allowed" variant when all higher tiers are
 * either zero or already allowed). Returns `null` when no banner is needed.
 *
 * The "blocked" variants gate on `tabPath` — without a tab path we cannot
 * key the per-tab Allow toggle, so we fall through to the next tier
 * rather than render a button-less blocked banner.
 */
export function selectBannerVariant(inputs: BannerInputs): BannerVariant | null {
  if (inputs.tier3Count > 0) {
    return { kind: "tier3-references" };
  }
  if (inputs.tier2Count > 0) {
    if (!inputs.allowOutsideForThisTab && inputs.tabPath) {
      return { kind: "tier2-references-blocked", tabPath: inputs.tabPath };
    }
    if (inputs.allowOutsideForThisTab) {
      return { kind: "tier2-references-allowed" };
    }
  }
  if (inputs.externalImageCount > 0) {
    if (!inputs.allowExternalImagesForThisTab && inputs.tabPath) {
      return { kind: "external-images-blocked", tabPath: inputs.tabPath };
    }
    if (inputs.allowExternalImagesForThisTab) {
      return { kind: "external-images-allowed" };
    }
  }
  return null;
}

export interface ViewerBannerProps {
  variant: BannerVariant | null;
}

export function ViewerBanner({ variant }: ViewerBannerProps) {
  if (!variant) return null;
  const { copy, button } = bannerCopy(variant);
  return (
    <div className="viewer-banner" data-variant={variant.kind} role="status">
      <span className="viewer-banner__copy">{copy}</span>
      {button && (
        <button
          type="button"
          className="viewer-banner__action"
          onClick={button.onClick}
        >
          {button.label}
        </button>
      )}
    </div>
  );
}

interface BannerCopy {
  copy: string;
  button: { label: string; onClick: () => void } | null;
}

function bannerCopy(variant: BannerVariant): BannerCopy {
  switch (variant.kind) {
    case "tier3-references":
      return {
        copy: "⚠ This document references absolute paths or system locations that mdownreview will not follow.",
        button: null,
      };
    case "tier2-references-blocked": {
      const { tabPath } = variant;
      return {
        copy: "⚠ This document references files outside your workspace.",
        button: {
          label: "Allow for this session",
          // Issue #359 / AC3 — route through the store action so the
          // asset-protocol scope grant resolves BEFORE the renderer flag
          // flips. The action awaits the IPC then flips the flag; on
          // reject the flag stays unset and the banner remains visible.
          // MVVM seam (architect-expert): View no longer calls IPC
          // directly; the ViewModel owns IPC + flag mutation atomically.
          onClick: () => {
            void useStore.getState().extendScopeForTab(tabPath).catch(() => {
              // Already logged by the store action; the still-visible
              // banner IS the user-facing failure signal.
            });
          },
        },
      };
    }
    case "tier2-references-allowed":
      return {
        copy: "ℹ Outside-workspace references allowed for this session.",
        button: null,
      };
    case "external-images-blocked": {
      const { tabPath } = variant;
      return {
        copy: "ℹ External images disabled.",
        button: {
          label: "Allow external images",
          onClick: () => useStore.getState().allowRemoteImagesForDoc(tabPath),
        },
      };
    }
    case "external-images-allowed":
      return { copy: "ℹ External images loaded via proxy.", button: null };
  }
}
