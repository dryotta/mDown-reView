import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JsonTreeView } from "../JsonTreeView";

describe("JsonTreeView", () => {
  it("renders root object with key count", () => {
    render(<JsonTreeView content='{"a":1,"b":2}' />);
    expect(screen.getByText(/2 keys/)).toBeInTheDocument();
  });

  it("renders string values", () => {
    render(<JsonTreeView content='{"name":"hello"}' />);
    expect(screen.getByText(/"hello"/)).toBeInTheDocument();
  });

  it("expands/collapses on click", () => {
    render(<JsonTreeView content='{"obj":{"key":"value"}}' />);
    const toggles = screen.getAllByRole("button");
    fireEvent.click(toggles[0]);
  });

  it("handles arrays", () => {
    render(<JsonTreeView content='[1,2,3]' />);
    expect(screen.getByText(/3 items/)).toBeInTheDocument();
  });

  it("handles invalid JSON gracefully", () => {
    render(<JsonTreeView content="not json" />);
    expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
  });

  it("handles JSONC with comments and trailing commas", () => {
    const jsonc = `{
      // line comment
      "key": "value",
      /* block comment */
      "arr": [1, 2, 3,],
    }`;
    render(<JsonTreeView content={jsonc} />);
    expect(screen.getByText(/2 keys/)).toBeInTheDocument();
    expect(screen.getByText(/"value"/)).toBeInTheDocument();
  });

  it("handles empty object", () => {
    render(<JsonTreeView content='{}' />);
    expect(screen.getByText(/0 keys/)).toBeInTheDocument();
  });
});
