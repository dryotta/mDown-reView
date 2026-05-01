import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";

vi.mock("@/lib/mermaid-singleton", () => ({
  renderMermaid: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg">…</svg>' }),
}));

vi.mock("@/hooks/useTheme", () => ({ useTheme: () => "light" }));

const storeState = {
  mermaidPopoutOpenFor: null as string | null,
  openMermaidPopout: vi.fn(),
  closeMermaidPopout: vi.fn(),
};

vi.mock("@/store", () => {
  const useStore = (sel?: (s: typeof storeState) => unknown) =>
    sel ? sel(storeState) : storeState;
  (useStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;
  return { useStore };
});

vi.mock("../mermaid/MermaidRenderer", () => ({
  MermaidRenderer: (props: { content: string; path?: string | null }) => {
    (globalThis as unknown as { __lastRendererProps: unknown }).__lastRendererProps = props;
    return <div data-testid="renderer-stub" />;
  },
}));

import { MermaidEmbedded } from "../mermaid/MermaidEmbedded";

beforeEach(() => {
  vi.clearAllMocks();
  storeState.openMermaidPopout.mockReset();
  (globalThis as unknown as { __lastRendererProps: unknown }).__lastRendererProps = undefined;
});

describe("MermaidEmbedded", () => {
  it("renders the popout button inside the embedded wrapper", () => {
    const { container } = render(<MermaidEmbedded content="graph TD; A-->B;" />);
    const wrapper = container.querySelector(".mermaid-embedded");
    expect(wrapper).not.toBeNull();
    const btn = screen.getByRole("button", { name: /pop out/i });
    expect(wrapper?.contains(btn)).toBe(true);
  });

  it("popout button is a real button element with type=button (no implicit submit)", () => {
    render(<MermaidEmbedded content="graph TD; A-->B;" />);
    const btn = screen.getByRole("button", { name: /pop out/i });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("clicking the popout button calls openMermaidPopout(content) once", () => {
    const content = "graph TD; A-->B;";
    render(<MermaidEmbedded content={content} />);
    const btn = screen.getByRole("button", { name: /pop out/i });
    fireEvent.click(btn);
    expect(storeState.openMermaidPopout).toHaveBeenCalledTimes(1);
    expect(storeState.openMermaidPopout).toHaveBeenCalledWith(content);
  });

  it("popout button has the .mermaid-embedded__popout-btn class (CSS hover hook)", () => {
    render(<MermaidEmbedded content="graph TD; A-->B;" />);
    const btn = screen.getByRole("button", { name: /pop out/i });
    expect(btn.classList.contains("mermaid-embedded__popout-btn")).toBe(true);
  });

  it("wrapper div has the .mermaid-embedded class (positioning context)", () => {
    const { container } = render(<MermaidEmbedded content="graph TD; A-->B;" />);
    const wrapper = container.querySelector("div.mermaid-embedded");
    expect(wrapper).not.toBeNull();
  });

  it("renders MermaidRenderer without a path prop (no source-line walk on embedded blocks)", () => {
    render(<MermaidEmbedded content="graph TD; A-->B;" />);
    const props = (globalThis as unknown as {
      __lastRendererProps: { content: string; path?: string | null };
    }).__lastRendererProps;
    expect(props).toBeDefined();
    expect(props.content).toBe("graph TD; A-->B;");
    expect(props.path == null).toBe(true);
  });
});
