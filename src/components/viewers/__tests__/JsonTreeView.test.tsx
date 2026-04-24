import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JsonTreeView } from "../JsonTreeView";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("JsonTreeView", () => {
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
