import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HtmlPreviewView } from "../HtmlPreviewView";

describe("HtmlPreviewView", () => {
  it("renders sandboxed iframe with content", () => {
    const { container } = render(<HtmlPreviewView content="<h1>Hello</h1>" />);
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
  });

  it("shows safety warning banner", () => {
    render(<HtmlPreviewView content="<p>test</p>" />);
    expect(screen.getByText(/sandboxed preview/i)).toBeInTheDocument();
  });

  it("toggles to unsafe mode", () => {
    const { container } = render(<HtmlPreviewView content="<p>test</p>" />);
    fireEvent.click(screen.getByRole("button", { name: /enable scripts/i }));
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts");
  });
});
