import { describe, it, expect } from "vitest";
import { bundledLanguages } from "shiki";
import { getFileCategory, hasVisualization, getDefaultView, getShikiLanguage, getFoldLanguage, getFiletypeKey, SHIKI_LANGUAGE_MAP, BASENAME_MAP } from "@/lib/file-types";

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

  it("classifies audio files", () => {
    expect(getFileCategory("song.mp3")).toBe("audio");
    expect(getFileCategory("song.wav")).toBe("audio");
    expect(getFileCategory("song.ogg")).toBe("audio");
    expect(getFileCategory("song.flac")).toBe("audio");
    expect(getFileCategory("song.m4a")).toBe("audio");
    expect(getFileCategory("song.aac")).toBe("audio");
    expect(getFileCategory("UPPER.MP3")).toBe("audio");
  });

  it("classifies video files", () => {
    expect(getFileCategory("clip.mp4")).toBe("video");
    expect(getFileCategory("clip.webm")).toBe("video");
    expect(getFileCategory("clip.mov")).toBe("video");
    expect(getFileCategory("clip.mkv")).toBe("video");
    expect(getFileCategory("UPPER.MP4")).toBe("video");
  });

  it("classifies PDF files (#65 F3)", () => {
    expect(getFileCategory("doc.pdf")).toBe("pdf");
    expect(getFileCategory("DOC.PDF")).toBe("pdf");
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

  it("returns true for audio and video (toolbar consistency, #65 F1/F2)", () => {
    expect(hasVisualization("audio")).toBe(true);
    expect(hasVisualization("video")).toBe(true);
  });

  it("returns true for pdf (#65 F3)", () => {
    expect(hasVisualization("pdf")).toBe(true);
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

  it("returns visual for audio and video (#65 F1/F2)", () => {
    expect(getDefaultView("audio")).toBe("visual");
    expect(getDefaultView("video")).toBe("visual");
  });

  it("returns visual for pdf (#65 F3)", () => {
    expect(getDefaultView("pdf")).toBe("visual");
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

  it("maps new language extensions (#94 Group B)", () => {
    expect(getShikiLanguage("a.lua")).toBe("lua");
    expect(getShikiLanguage("a.dart")).toBe("dart");
    expect(getShikiLanguage("a.scala")).toBe("scala");
    expect(getShikiLanguage("a.zig")).toBe("zig");
    expect(getShikiLanguage("a.groovy")).toBe("groovy");
    expect(getShikiLanguage("a.r")).toBe("r");
    expect(getShikiLanguage("a.ps1")).toBe("powershell");
  });

  it("maps web/app framework extensions (#94 Group B)", () => {
    expect(getShikiLanguage("a.svelte")).toBe("svelte");
    expect(getShikiLanguage("a.vue")).toBe("vue");
    expect(getShikiLanguage("a.astro")).toBe("astro");
    expect(getShikiLanguage("a.graphql")).toBe("graphql");
    expect(getShikiLanguage("a.gql")).toBe("graphql");
    expect(getShikiLanguage("a.prisma")).toBe("prisma");
    expect(getShikiLanguage("a.jsonc")).toBe("jsonc");
  });

  it("maps infra/config extensions (#94 Group B)", () => {
    expect(getShikiLanguage("a.tf")).toBe("terraform");
    expect(getShikiLanguage("a.tfvars")).toBe("terraform");
    expect(getShikiLanguage("a.hcl")).toBe("hcl");
    expect(getShikiLanguage("a.proto")).toBe("protobuf");
    expect(getShikiLanguage("a.gradle")).toBe("groovy");
    expect(getShikiLanguage("a.cmake")).toBe("cmake");
    expect(getShikiLanguage("a.bicep")).toBe("bicep");
    expect(getShikiLanguage("a.ini")).toBe("ini");
    expect(getShikiLanguage("a.conf")).toBe("ini");
    expect(getShikiLanguage("a.env")).toBe("ini");
    expect(getShikiLanguage("a.diff")).toBe("diff");
    expect(getShikiLanguage("a.patch")).toBe("diff");
    expect(getShikiLanguage("a.mm")).toBe("objective-cpp");
  });

  it("falls back to basename matching for extensionless files (#94 Group B)", () => {
    expect(getShikiLanguage("Dockerfile")).toBe("docker");
    expect(getShikiLanguage("dockerfile")).toBe("docker");
    expect(getShikiLanguage("Containerfile")).toBe("docker");
    expect(getShikiLanguage("Makefile")).toBe("make");
    expect(getShikiLanguage("GNUmakefile")).toBe("make");
    expect(getShikiLanguage("CMakeLists.txt")).toBe("cmake");
  });

  it("basename matching works with directory prefixes (#94 Group B)", () => {
    expect(getShikiLanguage("/app/Dockerfile")).toBe("docker");
    expect(getShikiLanguage("C:\\project\\Makefile")).toBe("make");
  });

  it("returns 'text' for unknown / missing extensions", () => {
    expect(getShikiLanguage("data.unknownext")).toBe("text");
    expect(getShikiLanguage("noext")).toBe("text");
    expect(getShikiLanguage("foo.m")).toBe("text"); // .m deliberately deferred — ambiguous
    expect(getShikiLanguage("foo.Dockerfile")).toBe("text"); // extension wins, .dockerfile not mapped
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

describe("Shiki language map runtime guard (#94)", () => {
  it("every SHIKI_LANGUAGE_MAP value is a valid bundled Shiki language (except kql)", () => {
    const invalidEntries: string[] = [];
    for (const [ext, lang] of Object.entries(SHIKI_LANGUAGE_MAP)) {
      if (lang === "kql") continue;
      if (!(lang in bundledLanguages)) {
        invalidEntries.push(`.${ext} → "${lang}"`);
      }
    }
    expect(invalidEntries, `Invalid Shiki language ids: ${invalidEntries.join(", ")}`).toEqual([]);
  });

  it("every BASENAME_MAP value is a valid bundled Shiki language", () => {
    const invalidEntries: string[] = [];
    for (const [name, lang] of Object.entries(BASENAME_MAP)) {
      if (!(lang in bundledLanguages)) {
        invalidEntries.push(`${name} → "${lang}"`);
      }
    }
    expect(invalidEntries, `Invalid Shiki language ids: ${invalidEntries.join(", ")}`).toEqual([]);
  });
});

describe("getFiletypeKey (#65 F1/F2)", () => {
  it("returns .audio for audio files regardless of view mode", () => {
    expect(getFiletypeKey("song.mp3")).toBe(".audio");
    expect(getFiletypeKey("song.wav", "visual")).toBe(".audio");
    expect(getFiletypeKey("song.ogg", "source")).toBe(".audio");
  });

  it("returns .video for video files regardless of view mode", () => {
    expect(getFiletypeKey("clip.mp4")).toBe(".video");
    expect(getFiletypeKey("clip.webm", "visual")).toBe(".video");
    expect(getFiletypeKey("clip.mov", "source")).toBe(".video");
  });

  it("returns .pdf for pdf files regardless of view mode (#65 F3)", () => {
    expect(getFiletypeKey("doc.pdf")).toBe(".pdf");
    expect(getFiletypeKey("doc.pdf", "visual")).toBe(".pdf");
    expect(getFiletypeKey("doc.pdf", "source")).toBe(".pdf");
  });
});
