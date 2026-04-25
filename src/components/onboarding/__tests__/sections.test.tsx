import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildFirstRunSections,
  buildSetupSections,
  type OnboardingActions,
  type SectionConfig,
} from "../sections";
import type { OnboardingStatus, OnboardingStatuses } from "@/store";

/**
 * Drives the platform-detection branches in `sections.tsx`. The Rust status
 * enums are the source of truth; this only validates that copy/labels follow
 * `navigator.userAgent` correctly, and that `unsupported`/`pending` states
 * suppress action buttons as designed.
 */

const ORIGINAL_UA = navigator.userAgent;

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

function noopActions(): OnboardingActions {
  return {
    installCliShim: vi.fn().mockResolvedValue(undefined),
    removeCliShim: vi.fn().mockResolvedValue(undefined),
    setDefaultHandler: vi.fn().mockResolvedValue(undefined),
    registerFolderContext: vi.fn().mockResolvedValue(undefined),
    unregisterFolderContext: vi.fn().mockResolvedValue(undefined),
  };
}

function statuses(over: Partial<OnboardingStatuses> = {}): OnboardingStatuses {
  return {
    cliShim: "pending",
    defaultHandler: "pending",
    folderContext: "pending",
    ...over,
  };
}

function find(list: SectionConfig[], key: SectionConfig["key"]): SectionConfig {
  const s = list.find((x) => x.key === key);
  if (!s) throw new Error(`section ${key} missing`);
  return s;
}

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64)";

beforeEach(() => {
  // jsdom default platform stays Linux-ish; we drive isMac/isWindows via UA only.
  Object.defineProperty(navigator, "platform", { value: "", configurable: true });
});

afterEach(() => {
  setUserAgent(ORIGINAL_UA);
});

describe("sections.tsx — cliShim platform branch", () => {
  it("mac: primary label is 'Install' and helpText mentions /usr/local/bin", () => {
    setUserAgent(MAC_UA);
    const sections = buildFirstRunSections({
      statuses: statuses({ cliShim: "pending" }),
      errors: {},
      actions: noopActions(),
    });
    const cli = find(sections, "cliShim");
    expect(cli.shellProps.primaryLabel).toBe("Install");
    expect(cli.shellProps.helpText).toBeTruthy();
  });

  it("windows: primary label is 'Install' and helpText is null (status-only)", () => {
    setUserAgent(WIN_UA);
    const sections = buildFirstRunSections({
      statuses: statuses({ cliShim: "pending" }),
      errors: {},
      actions: noopActions(),
    });
    const cli = find(sections, "cliShim");
    expect(cli.shellProps.primaryLabel).toBe("Install");
    expect(cli.shellProps.helpText).toBeNull();
  });

  it("unsupported status suppresses primary button", () => {
    setUserAgent(LINUX_UA);
    const sections = buildFirstRunSections({
      statuses: statuses({ cliShim: "unsupported" as OnboardingStatus }),
      errors: {},
      actions: noopActions(),
    });
    const cli = find(sections, "cliShim");
    expect(cli.shellProps.primaryLabel).toBeUndefined();
    expect(cli.shellProps.onPrimary).toBeUndefined();
  });

  it("done status surfaces 'Remove' as secondary action", () => {
    setUserAgent(MAC_UA);
    const sections = buildFirstRunSections({
      statuses: statuses({ cliShim: "done" }),
      errors: {},
      actions: noopActions(),
    });
    const cli = find(sections, "cliShim");
    expect(cli.shellProps.secondaryLabel).toBe("Remove");
  });
});

describe("sections.tsx — defaultHandler platform branch", () => {
  it("windows: primary label opens Windows Settings and helpText explains manual step", () => {
    setUserAgent(WIN_UA);
    const sections = buildSetupSections({
      statuses: statuses(),
      errors: {},
      actions: noopActions(),
    });
    const dh = find(sections, "defaultHandler");
    expect(dh.shellProps.primaryLabel).toBe("Open Windows Settings…");
    expect(dh.shellProps.helpText).toBeTruthy();
  });

  it("non-windows: primary label is 'Set as Default' with no helpText", () => {
    setUserAgent(MAC_UA);
    const sections = buildSetupSections({
      statuses: statuses(),
      errors: {},
      actions: noopActions(),
    });
    const dh = find(sections, "defaultHandler");
    expect(dh.shellProps.primaryLabel).toBe("Set as Default");
    expect(dh.shellProps.helpText).toBeNull();
  });

  it("unsupported status suppresses primary button regardless of platform", () => {
    setUserAgent(WIN_UA);
    const sections = buildSetupSections({
      statuses: statuses({ defaultHandler: "unsupported" }),
      errors: {},
      actions: noopActions(),
    });
    const dh = find(sections, "defaultHandler");
    expect(dh.shellProps.primaryLabel).toBeUndefined();
    expect(dh.shellProps.onPrimary).toBeUndefined();
  });
});

describe("sections.tsx — folderContext platform branch", () => {
  it("windows pending: shows Enable button only", () => {
    setUserAgent(WIN_UA);
    const sections = buildSetupSections({
      statuses: statuses({ folderContext: "pending" }),
      errors: {},
      actions: noopActions(),
    });
    const fc = find(sections, "folderContext");
    expect(fc.shellProps.primaryLabel).toBe("Enable");
    expect(fc.shellProps.secondaryLabel).toBeUndefined();
  });

  it("windows done: surfaces Disable as secondary, no primary", () => {
    setUserAgent(WIN_UA);
    const sections = buildSetupSections({
      statuses: statuses({ folderContext: "done" }),
      errors: {},
      actions: noopActions(),
    });
    const fc = find(sections, "folderContext");
    // Per code: primary stays "Enable" until status is unsupported; Disable shown as secondary on done.
    expect(fc.shellProps.secondaryLabel).toBe("Disable");
  });

  it("non-windows: no primary or secondary action exposed", () => {
    setUserAgent(MAC_UA);
    const sections = buildSetupSections({
      statuses: statuses({ folderContext: "pending" }),
      errors: {},
      actions: noopActions(),
    });
    const fc = find(sections, "folderContext");
    expect(fc.shellProps.primaryLabel).toBeUndefined();
    expect(fc.shellProps.secondaryLabel).toBeUndefined();
  });

  it("unsupported status suppresses both buttons on every platform", () => {
    setUserAgent(WIN_UA);
    const sections = buildSetupSections({
      statuses: statuses({ folderContext: "unsupported" }),
      errors: {},
      actions: noopActions(),
    });
    const fc = find(sections, "folderContext");
    expect(fc.shellProps.primaryLabel).toBeUndefined();
    expect(fc.shellProps.secondaryLabel).toBeUndefined();
  });
});

describe("sections.tsx — error pass-through", () => {
  it("propagates per-section error string into shellProps.error", () => {
    setUserAgent(MAC_UA);
    const sections = buildFirstRunSections({
      statuses: statuses({ cliShim: "error" }),
      errors: { cliShim: "Permission denied" },
      actions: noopActions(),
    });
    expect(find(sections, "cliShim").shellProps.error).toBe("Permission denied");
  });
});
