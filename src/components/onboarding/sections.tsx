import type { ReactNode } from "react";
import type { SectionShellProps } from "./SectionShell";
import {
  useStore,
  type OnboardingSectionKey,
  type OnboardingStatuses,
} from "@/store";

/**
 * Cosmetic platform detection. The Rust status enums (`unsupported` variant)
 * are the source of truth — this only tweaks copy/labels.
 */
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform);
}

function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Win/i.test(navigator.userAgent) || /Win/i.test(navigator.platform);
}

export interface OnboardingActions {
  installCliShim: () => Promise<void>;
  removeCliShim: () => Promise<void>;
  setDefaultHandler: () => Promise<void>;
  registerFolderContext: () => Promise<void>;
  unregisterFolderContext: () => Promise<void>;
}

/**
 * Build the standard `OnboardingActions` adapter from the live store state.
 * Reads `useStore.getState()` at call time, so it must be invoked during
 * render (not a hook — no subscriptions). Both panels share this builder to
 * avoid duplicating the 5-line literal.
 */
export function buildOnboardingActions(): OnboardingActions {
  const s = useStore.getState();
  return {
    installCliShim: () => s.installCliShim(),
    removeCliShim: () => s.removeCliShim(),
    setDefaultHandler: () => s.setDefaultHandler(),
    registerFolderContext: () => s.registerFolderContext(),
    unregisterFolderContext: () => s.unregisterFolderContext(),
  };
}

export interface SectionConfig {
  key: "whatIsThis" | "cliShim" | "skills" | "defaultHandler" | "folderContext";
  shellProps: SectionShellProps;
}

export interface BuildSectionsInput {
  statuses: OnboardingStatuses;
  errors: Record<string, string>;
  actions: OnboardingActions;
}

const SKILLS_INSTALL_CMD = "/plugin marketplace add dryotta/mdownreview-skills";

function errorFor(
  errors: Record<string, string>,
  key: OnboardingSectionKey,
): string | undefined {
  return errors[key];
}

function cliShimSection({ statuses, errors, actions }: BuildSectionsInput): SectionConfig {
  const status = statuses.cliShim;
  const mac = isMac();
  const helpText: ReactNode = mac ? (
    <>
      Creates a symlink at <code>/usr/local/bin/mdownreview-cli</code>. May
      prompt for your password.
    </>
  ) : null;
  return {
    key: "cliShim",
    shellProps: {
      title: "Command-line tool",
      description:
        "Run `mdownreview` from any terminal to open files quickly.",
      status,
      primaryLabel: status === "unsupported" ? undefined : "Install",
      onPrimary: status === "unsupported" ? undefined : actions.installCliShim,
      secondaryLabel: status === "done" ? "Remove" : undefined,
      onSecondary: status === "done" ? actions.removeCliShim : undefined,
      error: errorFor(errors, "cliShim"),
      helpText,
    },
  };
}

function skillsSection(): SectionConfig {
  return {
    key: "skills",
    shellProps: {
      title: "AI agent integration",
      description:
        "Install plugins for Claude, Copilot CLI, and other coding agents.",
      status: "done",
      hideStatus: true,
      helpText: (
        <>
          Run this in your agent&apos;s plugin shell:
          <br />
          <code>{SKILLS_INSTALL_CMD}</code>
        </>
      ),
    },
  };
}

function defaultHandlerSection({ statuses, errors, actions }: BuildSectionsInput): SectionConfig {
  const status = statuses.defaultHandler;
  const win = isWindows();
  const primaryLabel = win ? "Open Windows Settings…" : "Set as Default";
  const helpText: ReactNode = win ? (
    <>
      Windows requires you to confirm this manually. In the panel that opens,
      find <code>.md</code> and select mdownreview.
    </>
  ) : null;
  return {
    key: "defaultHandler",
    shellProps: {
      title: "Open .md files with mdownreview",
      description:
        "Make mdownreview the default app for opening markdown files.",
      status,
      primaryLabel: status === "unsupported" ? undefined : primaryLabel,
      onPrimary: status === "unsupported" ? undefined : actions.setDefaultHandler,
      error: errorFor(errors, "defaultHandler"),
      helpText,
    },
  };
}

function folderContextSection({ statuses, errors, actions }: BuildSectionsInput): SectionConfig {
  const status = statuses.folderContext;
  const win = isWindows();
  return {
    key: "folderContext",
    shellProps: {
      title: "Open folder with mdownreview",
      description:
        "Right-click any folder in Finder/Explorer to open it in mdownreview.",
      status,
      primaryLabel:
        status === "unsupported" || !win ? undefined : "Enable",
      onPrimary:
        status === "unsupported" || !win ? undefined : actions.registerFolderContext,
      secondaryLabel:
        status === "done" && win ? "Disable" : undefined,
      onSecondary:
        status === "done" && win ? actions.unregisterFolderContext : undefined,
      error: errorFor(errors, "folderContext"),
    },
  };
}

function whatIsThisSection(): SectionConfig {
  return {
    key: "whatIsThis",
    shellProps: {
      title: "Welcome to mDown reView",
      description:
        "Open a folder of markdown reviews from your AI agent, read them, drop inline comments, save — agent picks them up next round.",
      status: "done",
      hideStatus: true,
    },
  };
}

export function buildFirstRunSections(input: BuildSectionsInput): SectionConfig[] {
  return [
    whatIsThisSection(),
    cliShimSection(input),
    skillsSection(),
    defaultHandlerSection(input),
    folderContextSection(input),
  ];
}

export function buildSetupSections(input: BuildSectionsInput): SectionConfig[] {
  return [
    cliShimSection(input),
    skillsSection(),
    defaultHandlerSection(input),
    folderContextSection(input),
  ];
}
