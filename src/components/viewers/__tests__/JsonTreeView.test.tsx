import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// In-test JSONC stripper that mirrors the Rust implementation enough to
// keep the view-layer tests focused on rendering.
function fakeStrip(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (escaped) { out += ch; escaped = false; i++; continue; }
    if (ch === "\\" && inString) { out += ch; escaped = true; i++; continue; }
    if (ch === '"') { inString = !inString; out += ch; i++; continue; }
    if (inString) { out += ch; i++; continue; }
    if (ch === "/" && next === "/") {
      i += 2; while (i < text.length && text[i] !== "\n") i++; continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i + 1 < text.length) {
        if (text[i] === "*" && text[i + 1] === "/") { i += 2; break; }
        i++;
      }
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") { i++; continue; }
    }
    out += ch;
    i++;
  }
  return out;
}

vi.mock("@/lib/tauri-commands", () => ({
  stripJsonComments: vi.fn(async (text: string) => fakeStrip(text)),
}));

const { addCommentMock, setFocusedThreadMock } = vi.hoisted(() => ({
  addCommentMock: vi.fn<(filePath: string, text: string, anchor?: unknown) => Promise<void>>(
    async () => {},
  ),
  setFocusedThreadMock: vi.fn(),
}));

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: () => ({
    threads: [],
    comments: [],
    loading: false,
    reload: () => {},
  }),
}));

vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: () => ({ addComment: addCommentMock }),
}));

vi.mock("@/store", () => {
  const state = {
    setFocusedThread: setFocusedThreadMock,
    zoomByFiletype: {} as Record<string, number>,
    bumpZoom: () => {},
    setZoom: () => {},
  };
  const useStore = (selector: (s: typeof state) => unknown) => selector(state);
  (useStore as unknown as { getState: () => typeof state }).getState = () => state;
  return { useStore };
});

import { JsonTreeView } from "../JsonTreeView";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("JsonTreeView — rendering (existing behaviour)", () => {
  it("renders root object with key count", async () => {
    render(<JsonTreeView content='{"a":1,"b":2}' />);
    expect(await screen.findByText(/2 keys/)).toBeInTheDocument();
  });

  it("renders string values", async () => {
    render(<JsonTreeView content='{"name":"hello"}' />);
    expect(await screen.findByText(/"hello"/)).toBeInTheDocument();
  });

  it("expands/collapses on click", async () => {
    render(<JsonTreeView content='{"obj":{"key":"value"}}' />);
    await waitFor(() => {
      expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    });
    const toggles = screen.getAllByRole("button");
    fireEvent.click(toggles[0]);
  });

  it("handles arrays", async () => {
    render(<JsonTreeView content='[1,2,3]' />);
    expect(await screen.findByText(/3 items/)).toBeInTheDocument();
  });

  it("handles invalid JSON gracefully", async () => {
    render(<JsonTreeView content="not json" />);
    expect(await screen.findByText(/invalid json/i)).toBeInTheDocument();
  });

  it("handles JSONC with comments and trailing commas", async () => {
    const jsonc = `{
      // line comment
      "key": "value",
      /* block comment */
      "arr": [1, 2, 3,],
    }`;
    render(<JsonTreeView content={jsonc} />);
    expect(await screen.findByText(/2 keys/)).toBeInTheDocument();
    expect(await screen.findByText(/"value"/)).toBeInTheDocument();
  });

  it("handles empty object", async () => {
    render(<JsonTreeView content='{}' />);
    expect(await screen.findByText(/0 keys/)).toBeInTheDocument();
  });
});

describe("JsonTreeView — Group C iter 7 (commentable paths)", () => {
  it("encodes array elements with numeric-index segments (B5: predicates deferred)", async () => {
    const content = JSON.stringify({ users: [{ id: 42, name: "x" }, { id: 7 }] });
    const { container } = render(<JsonTreeView content={content} path="/data.json" />);
    // Wait for tree to render.
    await screen.findByText(/2 items/);
    // Expand the first array element so its inner path is rendered too.
    const expandButtons = Array.from(container.querySelectorAll("[data-json-path='users[0]'] button.json-toggle"));
    if (expandButtons.length > 0) fireEvent.click(expandButtons[0]);
    const paths = Array.from(container.querySelectorAll("[data-json-path]"))
      .map((el) => el.getAttribute("data-json-path"));
    expect(paths).toContain("users[0]");
    expect(paths).toContain("users[0].name");
    expect(paths).toContain("users[1]");
  });

  it("falls back to numeric-index segments when an array element has no id-like field", async () => {
    const content = JSON.stringify({ tags: ["a", "b"] });
    const { container } = render(<JsonTreeView content={content} path="/data.json" />);
    await screen.findByText(/2 items/);
    const paths = Array.from(container.querySelectorAll("[data-json-path]"))
      .map((el) => el.getAttribute("data-json-path"));
    expect(paths).toContain("tags[0]");
    expect(paths).toContain("tags[1]");
  });

  // B1.b (iter 7 forward-fix) — predicate priority, recast for B5: every
  // shape MUST emit numeric-index paths regardless of inner key/name/id.
  it("array of {key:...} objects → uses [0] (no [key=...] predicate)", async () => {
    const content = JSON.stringify({ items: [{ key: "alpha", v: 1 }] });
    const { container } = render(<JsonTreeView content={content} path="/d.json" />);
    await screen.findByText(/1 items/);
    const paths = Array.from(container.querySelectorAll("[data-json-path]"))
      .map((el) => el.getAttribute("data-json-path"));
    expect(paths).toContain("items[0]");
    expect(paths.some((p) => p?.includes("[key="))).toBe(false);
  });

  it("array of {name:...} objects → uses [0] (no [name=...] predicate)", async () => {
    const content = JSON.stringify({ items: [{ name: "x", v: 1 }] });
    const { container } = render(<JsonTreeView content={content} path="/d.json" />);
    await screen.findByText(/1 items/);
    const paths = Array.from(container.querySelectorAll("[data-json-path]"))
      .map((el) => el.getAttribute("data-json-path"));
    expect(paths).toContain("items[0]");
    expect(paths.some((p) => p?.includes("[name="))).toBe(false);
  });

  it("array of {id, key, name} → uses [0] (no predicate of any kind)", async () => {
    const content = JSON.stringify({ items: [{ id: 1, key: "k", name: "n" }] });
    const { container } = render(<JsonTreeView content={content} path="/d.json" />);
    await screen.findByText(/1 items/);
    const paths = Array.from(container.querySelectorAll("[data-json-path]"))
      .map((el) => el.getAttribute("data-json-path"));
    expect(paths).toContain("items[0]");
    expect(paths.some((p) => p && /\[(id|key|name)=/.test(p))).toBe(false);
  });

  it("clicking '+' on a path calls addComment with the json_path anchor and (for scalars) scalar_text", async () => {
    const content = JSON.stringify({ users: [{ id: 42, name: "alice" }] });
    const { container } = render(<JsonTreeView content={content} path="/data.json" />);
    await screen.findByText(/1 items/);
    // Expand `users[0]` so its `name` child is rendered.
    const objToggle = container.querySelector("[data-json-path='users[0]'] button.json-toggle") as HTMLButtonElement;
    fireEvent.click(objToggle);
    const node = container.querySelector('[data-json-path="users[0].name"]')!;
    const addBtn = node.querySelector(":scope > .json-node-row > button.json-path-add") as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    fireEvent.click(addBtn);
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "typo?" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const [filePath, text, anchor] = addCommentMock.mock.calls[0];
    expect(filePath).toBe("/data.json");
    expect(text).toBe("typo?");
    expect(anchor).toEqual({
      kind: "json_path",
      json_path: "users[0].name",
      scalar_text: "alice",
    });
  });

  it("non-scalar (object/array) leaves the scalar_text field unset", async () => {
    const content = JSON.stringify({ obj: { x: 1 } });
    const { container } = render(<JsonTreeView content={content} path="/data.json" />);
    await screen.findAllByText(/1 keys/);
    const node = container.querySelector('[data-json-path="obj"]')!;
    const addBtn = node.querySelector(":scope > .json-node-row > button.json-path-add") as HTMLButtonElement;
    fireEvent.click(addBtn);
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const [, , anchor] = addCommentMock.mock.calls[0];
    expect(anchor).toEqual({ kind: "json_path", json_path: "obj" });
    expect(anchor).not.toHaveProperty("scalar_text");
  });

  it("when no `path` prop is provided, no '+' affordance is rendered (read-only mode)", async () => {
    render(<JsonTreeView content='{"a":1}' />);
    await screen.findByText(/1 keys/);
    expect(document.querySelectorAll("button.json-path-add").length).toBe(0);
  });

  it("scalar_text is capped at 200 characters", async () => {
    const long = "x".repeat(500);
    const content = JSON.stringify({ s: long });
    const { container } = render(<JsonTreeView content={content} path="/data.json" />);
    await screen.findByText(/"x{500}"/);
    const node = container.querySelector('[data-json-path="s"]')!;
    const addBtn = node.querySelector(":scope > .json-node-row > button.json-path-add") as HTMLButtonElement;
    fireEvent.click(addBtn);
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const [, , anchor] = addCommentMock.mock.calls[0];
    expect((anchor as { scalar_text: string }).scalar_text.length).toBe(200);
  });

  // D2 — object keys containing `.`, `[`, or `]` are escaped via the
  // `parent["a.b"]` JSON-string syntax so the Rust resolver can decode the
  // segment unambiguously.
  it("D2 — keys containing '.' or '[' use JSON-string-escaped bracket segments", async () => {
    const content = JSON.stringify({ "a.b": 1, "x[y]": 2 });
    const { container } = render(<JsonTreeView content={content} path="/d.json" />);
    await screen.findByText(/2 keys/);
    const paths = Array.from(container.querySelectorAll("[data-json-path]"))
      .map((el) => el.getAttribute("data-json-path"));
    expect(paths).toContain('["a.b"]');
    expect(paths).toContain('["x[y]"]');
    // The dot-notation form must NOT appear as a child path.
    expect(paths).not.toContain("a.b");
  });

  it("D2 — escaped path is round-trippable through addComment", async () => {
    const content = JSON.stringify({ "a.b": "v" });
    const { container } = render(<JsonTreeView content={content} path="/d.json" />);
    await screen.findByText(/1 keys/);
    const node = container.querySelector('[data-json-path=\'["a.b"]\']')!;
    const addBtn = node.querySelector(":scope > .json-node-row > button.json-path-add") as HTMLButtonElement;
    fireEvent.click(addBtn);
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "comment" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const [, , anchor] = addCommentMock.mock.calls[0];
    expect((anchor as { json_path: string }).json_path).toBe('["a.b"]');
  });

  // D3 — the `+` button used to be `visibility: hidden`, which removed it
  // from the accessibility tree and made it unreachable by Tab. After the
  // CSS fix, the button is a native `<button>` (tabIndex 0 implicit) and
  // can be focused programmatically, putting it in the tab order. That is
  // enough to assert keyboard reachability — `:focus-visible` styling is
  // visual and not asserted here (jsdom does not match `:focus-visible`).
  it("D3 — '+' button on a scalar leaf is keyboard-focusable (in the tab order)", async () => {
    const content = JSON.stringify({ s: "v" });
    const { container } = render(<JsonTreeView content={content} path="/d.json" />);
    await screen.findByText(/1 keys/);
    const node = container.querySelector('[data-json-path="s"]')!;
    const addBtn = node.querySelector(":scope > .json-node-row > button.json-path-add") as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    expect(addBtn.tagName).toBe("BUTTON");
    // Native buttons must NOT be removed from the tab order via tabIndex=-1.
    expect(addBtn.tabIndex).toBeGreaterThanOrEqual(0);
    addBtn.focus();
    expect(document.activeElement).toBe(addBtn);
  });
});
