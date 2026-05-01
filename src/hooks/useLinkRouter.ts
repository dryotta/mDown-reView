/**
 * Single consumer-facing dispatcher for link clicks (issue #338 / AC6).
 *
 * Replaces ad-hoc `routeLinkClick` switch statements in the markdown and
 * HTML viewers with one hook that handles the full classify → dispatch
 * flow. Synchronous TS shape classification (`routeLinkClick`) handles
 * fragments, schemes, and shape-based absolute paths; the async Rust
 * `path_classify` IPC disambiguates workspace-shaped relative hrefs into
 * inside / outside / system tiers via canonical paths.
 *
 * Consumers MUST NOT switch on a returned `LinkRoute` — the hook IS the
 * dispatcher. Each click is dispatched via `void dispatch(href, ctx)`.
 *
 * Fail-closed (security-expert finding for #338): any IPC failure or
 * unexpected exception treats the link as tier-3 (block + warn). We
 * never default-allow on error.
 */

import { useCallback } from "react";
import { useStore } from "@/store";
import { commands } from "@/lib/bindings";
import { openExternalUrl } from "@/lib/tauri-commands";
import {
  routeLinkClick,
  assertNeverLinkRoute,
  type LinkRoute,
} from "@/lib/url-policy";
import { warn } from "@/logger";

export interface LinkRouterCtx {
  /**
   * Source file path of the document containing the link. Used as
   * `baseDir` for relative href resolution AND as the lookup key for
   * the per-tab `allowOutsideWorkspace` Set.
   */
  filePath: string | null;
  /**
   * When the click originates inside an iframe (HtmlPreviewView), this
   * is the iframe's `contentDocument` — used to scroll-to-fragment
   * without postMessage. The markdown viewer omits this; same-document
   * fragments fall back to `document.getElementById`.
   */
  iframeDoc?: Document;
}

export type LinkDispatcher = (href: string, ctx: LinkRouterCtx) => Promise<void>;

/** Returns a stable dispatcher that resolves + routes an href. */
export function useLinkRouter(): LinkDispatcher {
  return useCallback<LinkDispatcher>(async (href, ctx) => {
    // Read mutable store state imperatively — never subscribe (rule 9 of
    // `docs/design-patterns.md`).
    const state = useStore.getState();
    const workspaceRoot = state.root ?? "";
    const baseDir = ctx.filePath ?? undefined;

    const route: LinkRoute = routeLinkClick(href, {
      baseDir,
      workspaceRoot,
    });

    try {
      switch (route.kind) {
        case "fragment":
          scrollToFragment(route.fragment, ctx.iframeDoc);
          return;

        case "external":
          await openExternalUrl(route.href).catch((e: unknown) => {
            void warn(`[useLinkRouter] external open failed: ${stringifyError(e)}`);
          });
          return;

        case "workspace":
        case "workspace-outside": {
          // Async: ask Rust for canonical-path classification so a tier-3
          // system path smuggled via a workspace-shaped relative href is
          // caught at the canonical layer.
          const result = await commands.pathClassify(href, ctx.filePath ?? null);
          if (result.status === "error") {
            // Fail-closed — treat IPC failure as tier-3.
            void warn(`[useLinkRouter] path_classify failed: ${result.error}`);
            return;
          }
          const classification = result.data;

          if (classification.tier === "system") {
            void warn(
              `[useLinkRouter] system path blocked (flavor=${classification.flavor}): ${href}`
            );
            return;
          }

          if (classification.tier === "outside") {
            const sourceTabPath = ctx.filePath;
            const allowed = sourceTabPath
              ? state.allowOutsideWorkspace.has(sourceTabPath)
              : false;
            if (!allowed) {
              void warn(
                `[useLinkRouter] outside-workspace blocked (toggle off): ${href}`
              );
              return;
            }
          }

          // tier === "inside" OR an outside path the user explicitly allowed.
          const targetPath = classification.canonical;
          const fragment = "fragment" in route ? route.fragment : undefined;

          if (ctx.filePath && targetPath === ctx.filePath) {
            // Same-file fragment-only navigation.
            if (fragment) scrollToFragment(fragment, ctx.iframeDoc);
            return;
          }

          if (fragment) {
            state.setPendingFragment({ path: targetPath, fragment });
          }
          state.openFile(targetPath);
          return;
        }

        case "absolute-blocked":
        case "scheme-blocked":
        case "other-blocked": {
          const detail =
            route.kind === "scheme-blocked"
              ? route.scheme
              : route.kind === "absolute-blocked"
                ? route.flavor
                : route.reason;
          void warn(
            `[useLinkRouter] blocked link (${route.kind}/${detail}): ${route.href}`
          );
          return;
        }

        default:
          assertNeverLinkRoute(route);
      }
    } catch (e) {
      // Defense-in-depth: any unexpected exception is treated as
      // fail-closed (block + warn) per security-expert review of #338.
      void warn(`[useLinkRouter] dispatch threw: ${stringifyError(e)}`);
    }
  }, []);
}

function scrollToFragment(fragment: string, iframeDoc?: Document): void {
  const root: Document = iframeDoc ?? document;
  const target = root.getElementById(fragment);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
