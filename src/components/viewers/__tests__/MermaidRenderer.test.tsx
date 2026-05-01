import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const renderMermaidMock = vi.fn();
const useThemeMock = vi.fn<() => string>();

vi.mock("@/lib/mermaid-singleton", () => ({
  renderMermaid: (opts: { theme: string; id: string; content: string }) => renderMermaidMock(opts),
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => useThemeMock(),
}));

import { MermaidRenderer } from "../mermaid/MermaidRenderer";

beforeEach(() => {
  renderMermaidMock.mockReset();
  renderMermaidMock.mockResolvedValue({
    svg: '<svg data-testid="mermaid-svg"><g class="node" id="flowchart-A-0">A</g></svg>',
  });
  useThemeMock.mockReset();
  useThemeMock.mockReturnValue("light");
});

describe("MermaidRenderer", () => {
  it("renders SVG inside [title='Mermaid diagram'] after the singleton resolves", async () => {
    render(<MermaidRenderer content="graph TD; A-->B;" />);
    await waitFor(() => {
      const wrapper = screen.getByTitle("Mermaid diagram");
      expect(wrapper.querySelector("svg")).not.toBeNull();
    });
  });

  it("maps theme='light' → 'default'", async () => {
    useThemeMock.mockReturnValue("light");
    render(<MermaidRenderer content="graph TD; A-->B;" />);
    await waitFor(() => {
      expect(renderMermaidMock).toHaveBeenCalled();
    });
    expect(renderMermaidMock.mock.calls[0]?.[0]).toMatchObject({ theme: "default" });
  });

  it("maps theme='dark' → 'dark'", async () => {
    useThemeMock.mockReturnValue("dark");
    render(<MermaidRenderer content="graph TD; A-->B;" />);
    await waitFor(() => {
      expect(renderMermaidMock).toHaveBeenCalled();
    });
    expect(renderMermaidMock.mock.calls[0]?.[0]).toMatchObject({ theme: "dark" });
  });

  it("maps theme='system' → 'default'", async () => {
    useThemeMock.mockReturnValue("system");
    render(<MermaidRenderer content="graph TD; A-->B;" />);
    await waitFor(() => {
      expect(renderMermaidMock).toHaveBeenCalled();
    });
    expect(renderMermaidMock.mock.calls[0]?.[0]).toMatchObject({ theme: "default" });
  });

  it("renders .mermaid-error when the singleton rejects", async () => {
    // Local console.error spy so the test-setup.ts afterEach guard
    // (test-strategy.md rule 15) does not flag this expected error.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderMermaidMock.mockRejectedValueOnce(new Error("Parse error"));
    const { container } = render(<MermaidRenderer content="invalid" />);
    await waitFor(() => {
      expect(container.querySelector(".mermaid-error")).not.toBeNull();
    });
    expect(container.querySelector(".mermaid-error")?.textContent).toMatch(/parse error/i);
    errSpy.mockRestore();
  });

  it("stamps data-source-line when path is provided and readOnly is false", async () => {
    renderMermaidMock.mockResolvedValueOnce({
      svg: '<svg><g class="node" id="flowchart-Foo-0">Foo</g></svg>',
    });
    const { container } = render(
      <MermaidRenderer content="Foo --> Bar" path="/tmp/x.md" readOnly={false} />,
    );
    await waitFor(() => {
      const node = container.querySelector("g.node");
      expect(node?.getAttribute("data-source-line")).toBe("1");
    });
  });

  it("does NOT stamp data-source-line when readOnly is true", async () => {
    renderMermaidMock.mockResolvedValueOnce({
      svg: '<svg><g class="node" id="flowchart-Foo-0">Foo</g></svg>',
    });
    const { container } = render(
      <MermaidRenderer content="Foo --> Bar" path="/tmp/x.md" readOnly={true} />,
    );
    await waitFor(() => {
      expect(container.querySelector("g.node")).not.toBeNull();
    });
    expect(container.querySelector("g.node")?.getAttribute("data-source-line")).toBeNull();
  });

  it("calls onSvgReady once with the inserted <svg> after a successful render", async () => {
    const onSvgReady = vi.fn();
    render(<MermaidRenderer content="graph TD; A-->B;" onSvgReady={onSvgReady} />);
    await waitFor(() => {
      expect(onSvgReady).toHaveBeenCalled();
    });
    const svgArg = onSvgReady.mock.calls[0]?.[0];
    expect(svgArg).toBeInstanceOf(SVGElement);
    expect((svgArg as SVGElement).tagName.toLowerCase()).toBe("svg");
  });

  it("caps the node walk at 5000 and warns", async () => {
    // Build a synthetic SVG with > 5000 g.node children.
    const N = 5005;
    const parts: string[] = ["<svg>"];
    for (let i = 0; i < N; i++) {
      parts.push(`<g class="node" id="flowchart-N${i}-0">N${i}</g>`);
    }
    parts.push("</svg>");
    renderMermaidMock.mockResolvedValueOnce({ svg: parts.join("") });

    // Local console.warn spy so the test-setup.ts afterEach guard does not flag.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(
      <MermaidRenderer content="N0\nN1\nN2" path="/tmp/x.md" readOnly={false} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll("g.node").length).toBe(N);
    });
    // Walk is synchronous in a useLayoutEffect right after innerHTML; by the
    // time the assertion above passes, the walk has run.
    expect(warnSpy).toHaveBeenCalledWith("[mermaid] node walk capped at 5000");
    // Node at index 5000 (the 5001st) must NOT have the attribute.
    const allNodes = container.querySelectorAll("g.node");
    expect(allNodes[5000]?.getAttribute("data-source-line")).toBeNull();
    warnSpy.mockRestore();
  });
});
