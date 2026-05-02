import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { useCommentFlashListener } from "@/hooks/useCommentFlashListener";
import { emitCommentFlash } from "@/lib/comment-flash";

vi.mock("@/logger");

/**
 * Smoke tests for the body-side flash hook. Asserts the kind-switch
 * (line / range / file / unmatched) drives the right DOM mutations:
 *   - line  → flash exactly the matching `[data-source-line]` element
 *   - range → flash every element between `line` and `endLine` inclusive
 *   - file / unmatched → no body element flashed (panel/toolbar own those)
 */
function setupBody(filePath: string, lineCount: number) {
  const root = document.createElement("div");
  for (let i = 1; i <= lineCount; i++) {
    const el = document.createElement("p");
    el.setAttribute("data-source-line", String(i));
    root.appendChild(el);
  }
  document.body.appendChild(root);
  const ref = createRef<HTMLElement>();
  // Cast: createRef<HTMLElement>() returns a read-only ref; tests legitimately
  // assign the element here to mimic the React-managed ref population.
  (ref as { current: HTMLElement | null }).current = root;
  const hook = renderHook(() => useCommentFlashListener(filePath, ref));
  const flashed = () =>
    Array.from(root.querySelectorAll<HTMLElement>(".comment-flashing")).map((el) =>
      el.getAttribute("data-source-line")
    );
  return { root, ref, hook, flashed };
}

describe("useCommentFlashListener", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("flashes a single line for kind:'line'", () => {
    const { hook, flashed } = setupBody("/a.md", 5);
    emitCommentFlash({ kind: "line", filePath: "/a.md", line: 3 });
    expect(flashed()).toEqual(["3"]);
    hook.unmount();
  });

  it("fans out across line..endLine for kind:'range'", () => {
    const { hook, flashed } = setupBody("/a.md", 10);
    emitCommentFlash({
      kind: "range",
      filePath: "/a.md",
      line: 4,
      endLine: 6,
    });
    expect(flashed()).toEqual(["4", "5", "6"]);
    hook.unmount();
  });

  it("ignores events for other files", () => {
    const { hook, flashed } = setupBody("/a.md", 5);
    emitCommentFlash({ kind: "line", filePath: "/other.md", line: 2 });
    expect(flashed()).toEqual([]);
    hook.unmount();
  });

  it("kind:'file' is a no-op on the body listener", () => {
    const { hook, flashed } = setupBody("/a.md", 5);
    emitCommentFlash({
      kind: "file",
      filePath: "/a.md",
      commentId: "c1",
    });
    expect(flashed()).toEqual([]);
    hook.unmount();
  });

  it("kind:'unmatched' is a no-op on the body listener", () => {
    const { hook, flashed } = setupBody("/a.md", 5);
    emitCommentFlash({
      kind: "unmatched",
      filePath: "/a.md",
      commentId: "c1",
    });
    expect(flashed()).toEqual([]);
    hook.unmount();
  });

  it("custom selector targets a different attribute (SourceView's data-line-idx)", () => {
    const root = document.createElement("div");
    for (let i = 0; i < 5; i++) {
      const el = document.createElement("p");
      el.setAttribute("data-line-idx", String(i));
      root.appendChild(el);
    }
    document.body.appendChild(root);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = root;
    const hook = renderHook(() =>
      useCommentFlashListener("/s.txt", ref, {
        selector: (line) => `[data-line-idx="${line - 1}"]`,
      })
    );
    emitCommentFlash({ kind: "line", filePath: "/s.txt", line: 3 });
    const flashed = Array.from(
      root.querySelectorAll<HTMLElement>(".comment-flashing")
    ).map((el) => el.getAttribute("data-line-idx"));
    expect(flashed).toEqual(["2"]);
    hook.unmount();
  });
});
