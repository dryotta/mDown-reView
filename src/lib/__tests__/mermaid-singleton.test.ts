import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { __resetForTests, renderMermaid } from "../mermaid-singleton";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, _content: string) => ({ svg: "<svg/>" })),
  },
}));

// Resolve the mocked module once for assertions.
async function getMermaidMock() {
  const mod = await import("mermaid");
  return mod.default as unknown as {
    initialize: Mock<(opts: Record<string, unknown>) => void>;
    render: Mock<(id: string, content: string) => Promise<{ svg: string }>>;
  };
}

beforeEach(async () => {
  const mermaid = await getMermaidMock();
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
  mermaid.render.mockImplementation((_id: string, _content: string) =>
    Promise.resolve({ svg: "<svg/>" }),
  );
  __resetForTests();
});

describe("renderMermaid", () => {
  it("initializes once and renders with the requested theme", async () => {
    const mermaid = await getMermaidMock();
    const result = await renderMermaid({
      theme: "default",
      id: "a",
      content: "graph TD; A;",
    });

    expect(result).toEqual({ svg: "<svg/>" });
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: "default",
      securityLevel: "strict",
    });
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    expect(mermaid.render).toHaveBeenCalledWith("a", "graph TD; A;");
  });

  it("does not re-initialize when the theme matches the cached value", async () => {
    const mermaid = await getMermaidMock();
    await renderMermaid({ theme: "default", id: "a", content: "graph TD; A;" });
    await renderMermaid({ theme: "default", id: "b", content: "graph TD; B;" });

    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mermaid.render).toHaveBeenCalledTimes(2);
  });

  it("re-initializes when the theme changes", async () => {
    const mermaid = await getMermaidMock();
    await renderMermaid({ theme: "default", id: "a", content: "graph TD; A;" });
    await renderMermaid({ theme: "dark", id: "b", content: "graph TD; B;" });

    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
    expect(mermaid.initialize.mock.calls[0]?.[0]).toMatchObject({ theme: "default" });
    expect(mermaid.initialize.mock.calls[1]?.[0]).toMatchObject({ theme: "dark" });
  });

  it("serializes concurrent calls so renders never interleave", async () => {
    const mermaid = await getMermaidMock();
    mermaid.render.mockImplementation(
      (_id: string, _content: string) =>
        new Promise<{ svg: string }>((resolve) =>
          setTimeout(() => resolve({ svg: "<svg/>" }), 10),
        ),
    );

    const [a, b] = await Promise.all([
      renderMermaid({ theme: "default", id: "a", content: "graph TD; A;" }),
      renderMermaid({ theme: "dark", id: "b", content: "graph TD; B;" }),
    ]);

    expect(a.svg).toBe("<svg/>");
    expect(b.svg).toBe("<svg/>");

    const initOrder = mermaid.initialize.mock.invocationCallOrder;
    const renderOrder = mermaid.render.mock.invocationCallOrder;
    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
    expect(mermaid.render).toHaveBeenCalledTimes(2);

    // initialize(default) -> render(a) -> initialize(dark) -> render(b)
    expect(initOrder[0]).toBeLessThan(renderOrder[0]!);
    expect(renderOrder[0]).toBeLessThan(initOrder[1]!);
    expect(initOrder[1]).toBeLessThan(renderOrder[1]!);

    // First initialize is for the default theme; second is for dark.
    expect(mermaid.initialize.mock.calls[0]?.[0]).toMatchObject({ theme: "default" });
    expect(mermaid.initialize.mock.calls[1]?.[0]).toMatchObject({ theme: "dark" });
    // Renders fired in submission order.
    expect(mermaid.render.mock.calls[0]?.[0]).toBe("a");
    expect(mermaid.render.mock.calls[1]?.[0]).toBe("b");
  });

  it("propagates render errors to the caller", async () => {
    const mermaid = await getMermaidMock();
    const boom = new Error("boom");
    mermaid.render.mockImplementationOnce(() => Promise.reject(boom));

    await expect(
      renderMermaid({ theme: "default", id: "a", content: "graph TD; A;" }),
    ).rejects.toBe(boom);
  });

  it("always passes securityLevel: 'strict' to initialize", async () => {
    const mermaid = await getMermaidMock();
    await renderMermaid({ theme: "default", id: "a", content: "graph TD; A;" });
    await renderMermaid({ theme: "dark", id: "b", content: "graph TD; B;" });

    for (const call of mermaid.initialize.mock.calls) {
      expect(call[0]).toMatchObject({ securityLevel: "strict" });
    }
  });
});
