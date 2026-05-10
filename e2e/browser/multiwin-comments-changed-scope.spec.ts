/**
 * Browser E2E — `comments-changed` must be scoped to windows that own
 * the mutated path.
 *
 * Tests rule `multiwin-window-scoped-events` (and the table entry that
 * marks `comments-changed` as ❌-current → `emit_filter` future) in
 * .claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md.
 *
 * Today's behaviour: `commands/comments/mod.rs:90` uses a global
 * `Emitter::emit` that broadcasts to every window. The future fix
 * (Section C2 of issue #315) routes the event through `emit_filter`
 * with a registry-owns-path predicate. This spec is a documentation
 * skeleton until that lands — the body describes the contract the test
 * will assert once `emit_filter` is in place.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe("multiwin-comments-changed-scope (E2)", () => {
  test.skip(
    true,
    "FIXME: pending #315 Section C2 — comments-changed is currently a global broadcast; will become emit_filter once the registry-owns-path predicate ships"
  );

  test("a comment mutation only refreshes windows that own the file", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Future-state contract once Section C2 lands:
    //
    //  1. Two simulated windows: one mounted on /folder-a and one on
    //     /folder-b. The test counts how many times each receives
    //     `comments-changed` after a save in /folder-a.
    //
    //  2. The /folder-b window must observe ZERO `comments-changed`
    //     events; the /folder-a window must observe exactly ONE.
    //
    //  3. The assertion is structural — the test must NOT lean on a
    //     frontend "is this mine?" filter, because that filter is the
    //     workaround the rule forbids.

    await page.addInitScript(() => {
      (window as Record<string, unknown>).__COMMENTS_CHANGED_RECEIVED__ = 0;
      window.addEventListener("comments-changed-mock", () => {
        (window as Record<string, number>).__COMMENTS_CHANGED_RECEIVED__! += 1;
      });
    });

    await page.goto("/");

    const received = await page.evaluate(
      () => (window as Record<string, number>).__COMMENTS_CHANGED_RECEIVED__ ?? -1
    );
    // Once C2 lands, this becomes a precise count assertion (0 for
    // unrelated windows, 1 for the owning window).
    expect(received).toBe(0);
  });
});
