import { describe, it, expect } from "vitest";
import { getFileCategory, hasVisualization, getDefaultView, getShikiLanguage, getFoldLanguage } from "@/lib/file-types";

describe("getFileCategory", () => {
  it("classifies markdown files", () => {
    expect(getFileCategory("readme.md")).toBe("markdown");
    expect(getFileCategory("doc.MDX")).toBe("markdown");
  });

  it("classifies JSON files", () => {
    expect(getFileCategory("config.json")).toBe("json");
    expect(getFileCategory("settings.jsonc")).toBe("json");
  });

  it("classifies CSV/TSV files", () => {
    expect(getFileCategory("data.csv")).toBe("csv");
    expect(getFileCategory("data.tsv")).toBe("csv");
  });

  it("classifies HTML files", () => {
    expect(getFileCategory("page.html")).toBe("html");
    expect(getFileCategory("page.htm")).toBe("html");
  });

  it("classifies Mermaid files", () => {
    expect(getFileCategory("flow.mermaid")).toBe("mermaid");
    expect(getFileCategory("flow.mmd")).toBe("mermaid");
  });

  it("classifies KQL files", () => {
    expect(getFileCategory("query.kql")).toBe("kql");
    expect(getFileCategory("query.csl")).toBe("kql");
  });

  it("classifies image files", () => {
    expect(getFileCategory("photo.png")).toBe("image");
    expect(getFileCategory("photo.jpg")).toBe("image");
    expect(getFileCategory("photo.jpeg")).toBe("image");
    expect(getFileCategory("icon.svg")).toBe("image");
    expect(getFileCategory("icon.gif")).toBe("image");
    expect(getFileCategory("icon.webp")).toBe("image");
    expect(getFileCategory("icon.bmp")).toBe("image");
    expect(getFileCategory("icon.ico")).toBe("image");
  });

  it("classifies other text files", () => {
    expect(getFileCategory("app.ts")).toBe("text");
    expect(getFileCategory("main.py")).toBe("text");
    expect(getFileCategory("Makefile")).toBe("text");
  });

  it("handles case insensitivity", () => {
    expect(getFileCategory("FILE.JSON")).toBe("json");
    expect(getFileCategory("IMAGE.PNG")).toBe("image");
  });

  it("handles files with no extension", () => {
    expect(getFileCategory("Makefile")).toBe("text");
    expect(getFileCategory("Dockerfile")).toBe("text");
  });
});

describe("hasVisualization", () => {
  it("returns true for visualizable categories", () => {
    expect(hasVisualization("markdown")).toBe(true);
    expect(hasVisualization("json")).toBe(true);
    expect(hasVisualization("csv")).toBe(true);
    expect(hasVisualization("html")).toBe(true);
    expect(hasVisualization("mermaid")).toBe(true);
    expect(hasVisualization("kql")).toBe(true);
  });

  it("returns false for non-visualizable categories", () => {
    expect(hasVisualization("text")).toBe(false);
    expect(hasVisualization("image")).toBe(false);
  });
});

describe("getDefaultView", () => {
  it("returns visual for markdown, json, csv, mermaid, kql", () => {
    expect(getDefaultView("markdown")).toBe("visual");
    expect(getDefaultView("json")).toBe("visual");
    expect(getDefaultView("csv")).toBe("visual");
    expect(getDefaultView("mermaid")).toBe("visual");
    expect(getDefaultView("kql")).toBe("visual");
  });

  it("returns source for html and text", () => {
    expect(getDefaultView("html")).toBe("source");
    expect(getDefaultView("text")).toBe("source");
  });

  it("returns visual for image", () => {
    expect(getDefaultView("image")).toBe("visual");
  });
});

describe("getShikiLanguage", () => {
  it("maps TypeScript / JavaScript family", () => {
    expect(getShikiLanguage("a.ts")).toBe("typescript");
    expect(getShikiLanguage("a.tsx")).toBe("tsx");
    expect(getShikiLanguage("a.js")).toBe("javascript");
    expect(getShikiLanguage("a.jsx")).toBe("jsx");
  });

  it("maps Python", () => {
    expect(getShikiLanguage("script.py")).toBe("python");
  });

  it("maps YAML (both extensions)", () => {
    expect(getShikiLanguage("conf.yaml")).toBe("yaml");
    expect(getShikiLanguage("conf.yml")).toBe("yaml");
  });

  it("maps KQL aliases (.kql and .csl)", () => {
    expect(getShikiLanguage("query.kql")).toBe("kql");
    expect(getShikiLanguage("query.csl")).toBe("kql");
  });

  it("maps JSON / Markdown", () => {
    expect(getShikiLanguage("pkg.json")).toBe("json");
    expect(getShikiLanguage("readme.md")).toBe("markdown");
  });

  it("returns 'text' for unknown / missing extensions", () => {
    expect(getShikiLanguage("Makefile")).toBe("text");
    expect(getShikiLanguage("data.unknownext")).toBe("text");
    expect(getShikiLanguage("noext")).toBe("text");
  });

  it("returns 'text' for .mdx (not in Shiki map even though it is a markdown category)", () => {
    // Documents the current behavior: `.mdx` maps to the markdown FileCategory
    // but is not in the Shiki language table, so source highlighting falls back
    // to plain text. Kept as a regression guard.
    expect(getShikiLanguage("doc.mdx")).toBe("text");
  });

  it("is case-insensitive (extname lowercases)", () => {
    expect(getShikiLanguage("App.TS")).toBe("typescript");
    expect(getShikiLanguage("Q.KQL")).toBe("kql");
  });
});

describe("getFoldLanguage", () => {
  it("currently mirrors getShikiLanguage", () => {
    expect(getFoldLanguage("a.py")).toBe("python");
    expect(getFoldLanguage("a.yml")).toBe("yaml");
    expect(getFoldLanguage("a.ts")).toBe("typescript");
    expect(getFoldLanguage("a.unknownext")).toBe("text");
  });
});
