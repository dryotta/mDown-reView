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
import { dirname } from "@/lib/path-utils";
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
    // `routeLinkClick`'s `baseDir` is the FILE's directory, not the file
    // itself. Mirrors the pre-useLinkRouter call site in MarkdownComponentsMap.
    const baseDir = ctx.filePath ? dirname(ctx.filePath) : undefined;

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
          // caught at the canonical layer. `base_dir` is the FILE's parent
          // dir (matches the renderer-side resolveWorkspacePath contract).
          const result = await commands.pathClassify(href, baseDir ?? null);
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
          // Use `route.path` (already-resolved + URL-decoded by routeLinkClick →
          // resolveWorkspacePath) as the target. The IPC's `canonical` is the
          // post-canonicalize form, which is fine in production but can drift
          // in tests with stub IPC mocks. `route.path` is the renderer-side
          // resolved path that openFile expects (consistent with prior pre-
          // useLinkRouter behavior).
          const targetPath =
            (route.kind === "workspace" || route.kind === "workspace-outside") && "path" in route
              ? route.path
              : classification.canonical;
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
          {
            const detail =
              route.kind === "scheme-blocked" ? route.scheme : route.flavor;
            void warn(
              `[useLinkRouter] blocked link (${route.kind}/${detail}): ${route.href}`
            );
            return;
          }

        case "other-blocked": {
          // `outside-workspace` is special: routeLinkClick short-circuits when
          // resolveWorkspacePath returns null (path resolves above the workspace
          // root). Per #338 spec, those paths still get a tier-2 vs tier-3
          // disambiguation via the IPC + the per-tab allowOutsideWorkspace toggle.
          // Other reasons (`type/length`, `no-basedir`, `decode`) are hard
          // shape failures — never reach the IPC.
          if (route.reason !== "outside-workspace") {
            void warn(
              `[useLinkRouter] blocked link (other-blocked/${route.reason}): ${route.href}`
            );
            return;
          }
          const result = await commands.pathClassify(route.href, baseDir ?? null);
          if (result.status === "error") {
            void warn(`[useLinkRouter] path_classify failed: ${result.error}`);
            return;
          }
          const classification = result.data;
          if (classification.tier === "system") {
            void warn(
              `[useLinkRouter] system path blocked (flavor=${classification.flavor}): ${route.href}`
            );
            return;
          }
          // tier === "outside" or "inside" (the IPC may resolve via canonicalize
          // to inside even though renderer-side resolveWorkspacePath rejected).
          if (classification.tier === "outside") {
            const sourceTabPath = ctx.filePath;
            const allowed = sourceTabPath
              ? state.allowOutsideWorkspace.has(sourceTabPath)
              : false;
            if (!allowed) {
              void warn(
                `[useLinkRouter] outside-workspace blocked (toggle off): ${route.href}`
              );
              return;
            }
          }
          // Open the canonical path the IPC computed. No fragment for
          // outside-workspace path — routeLinkClick already stripped query/
          // fragment before resolution; recovery would require re-parsing.
          const targetPath = classification.canonical;
          if (ctx.filePath && targetPath === ctx.filePath) return;
          state.openFile(targetPath);
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
