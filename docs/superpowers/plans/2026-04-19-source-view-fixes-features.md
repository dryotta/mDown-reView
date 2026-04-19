# Source View Fixes and Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 bugs (comment button positioning, PNG loading, HTML image loading), add 2 features (code folding, in-file search), and create test fixture files.

**Architecture:** Bug fixes are surgical changes to existing components. Code folding uses a pure `computeFoldRegions()` function consumed by SourceView. Search uses a `useSearch()` hook with a floating SearchBar overlay. Image loading switches from `convertFileSrc` (needs asset protocol) to `readBinaryFile` (returns base64 data URLs).

**Tech Stack:** React, TypeScript, Vitest, CSS

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/fold-regions.ts` | Create | Pure fold region computation (braces + indentation) |
| `src/lib/__tests__/fold-regions.test.ts` | Create | Tests for fold region detection |
| `src/lib/resolve-html-assets.ts` | Create | Resolve local image paths in HTML to base64 data URLs |
| `src/lib/__tests__/resolve-html-assets.test.ts` | Create | Tests for HTML asset resolution |
| `src/hooks/useSearch.ts` | Create | In-file search hook (query, matches, navigation) |
| `src/hooks/__tests__/useSearch.test.ts` | Create | Tests for search hook |
| `src/components/viewers/SearchBar.tsx` | Create | Floating search bar UI |
| `src/styles/search-bar.css` | Create | Search bar styles |
| `src/components/viewers/__tests__/SearchBar.test.tsx` | Create | Tests for SearchBar component |
| `src/components/viewers/SourceView.tsx` | Modify | Add fold UI, search integration, fix gutter layout |
| `src/styles/source-viewer.css` | Modify | Fix gutter layout, add fold + search styles |
| `src/components/viewers/ImageViewer.tsx` | Modify | Switch from convertFileSrc to readBinaryFile |
| `src/components/viewers/__tests__/ImageViewer.test.tsx` | Modify | Update mocks for readBinaryFile |
| `src/components/viewers/HtmlPreviewView.tsx` | Modify | Add filePath prop, resolve local images |
| `src/components/viewers/__tests__/HtmlPreviewView.test.tsx` | Modify | Test image resolution |
| `src/components/viewers/EnhancedViewer.tsx` | Modify | Pass filePath to HtmlPreviewView |
| `e2e/fixtures/` | Create | New fixture files for testing |

---

### Task 1: Fix Comment + Button Layout

**Files:**
- Modify: `src/components/viewers/SourceView.tsx`
- Modify: `src/styles/source-viewer.css`
- Modify: `src/components/viewers/__tests__/SourceView.test.tsx`

- [ ] **Step 1: Update CSS for 2-zone gutter**

Replace the gutter styles in `src/styles/source-viewer.css` (lines 67-99):

```css
.source-line-gutter {
  display: flex;
  align-items: flex-start;
  width: 60px;
  min-width: 60px;
  color: var(--color-muted);
  user-select: none;
  position: sticky;
  left: 0;
  background: var(--color-bg);
  z-index: 1;
}

.source-line:hover .source-line-gutter {
  background: var(--color-hover);
}

.source-line-comment-zone {
  width: 20px;
  min-width: 20px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 2px;
}

.source-line-comment-zone .comment-plus-btn {
  font-size: 14px;
  width: 18px;
  height: 18px;
  padding: 0;
  line-height: 18px;
  border-radius: 3px;
  opacity: 0;
  transition: opacity 0.1s;
}

.source-line:hover .source-line-comment-zone .comment-plus-btn {
  opacity: 1;
}

.source-line-number-zone {
  flex: 1;
  text-align: right;
  padding-right: 8px;
  font-size: 12px;
  padding-top: 1px;
  line-height: 20px;
}
```

Remove the old `.source-line-number`, `.source-line-add-comment` rules.

- [ ] **Step 2: Update SourceView JSX gutter structure**

In `src/components/viewers/SourceView.tsx`, replace the gutter `<span>` (lines 156-168):

```tsx
<span className="source-line-gutter">
  <span className="source-line-comment-zone">
    <button
      className="comment-plus-btn"
      aria-label="Add comment"
      onClick={() => setCommentingLine(
        commentingLine === lineNum ? null : lineNum
      )}
    >
      +
    </button>
  </span>
  <span className="source-line-number-zone">{lineNum}</span>
</span>
```

The button is always rendered (CSS controls visibility via opacity on hover). Remove the `hoveredLine` state and `onMouseEnter`/`onMouseLeave` from `.source-line` since the CSS hover handles it now.

- [ ] **Step 3: Clean up unused hover state**

In `src/components/viewers/SourceView.tsx`, remove:
- `const [hoveredLine, setHoveredLine] = useState<number | null>(null);`
- `onMouseEnter={() => setHoveredLine(lineNum)}`
- `onMouseLeave={() => setHoveredLine(null)}`

These are no longer needed since the CSS `:hover` on `.source-line` controls button visibility.

- [ ] **Step 4: Update test**

In `src/components/viewers/__tests__/SourceView.test.tsx`, update the hover test (line 30-38):

```typescript
it("shows add-comment button on line hover", async () => {
  render(<SourceView content={"const x = 1;"} path="/test.ts" filePath="/test.ts" />);
  await waitFor(() => {
    expect(screen.getByText("1")).toBeInTheDocument();
  });
  // Button is always rendered, CSS controls visibility
  expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
});
```

The button is now always in the DOM (opacity controlled by CSS), so we don't need to trigger hover.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/components/viewers/__tests__/SourceView.test.tsx`
Then: `npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/viewers/SourceView.tsx src/styles/source-viewer.css src/components/viewers/__tests__/SourceView.test.tsx
git commit -m "fix: reposition comment button to dedicated gutter zone

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Fix PNG Image Loading

**Files:**
- Modify: `src/components/viewers/ImageViewer.tsx`
- Modify: `src/components/viewers/__tests__/ImageViewer.test.tsx`

- [ ] **Step 1: Update ImageViewer tests**

Replace `src/components/viewers/__tests__/ImageViewer.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ImageViewer } from "../ImageViewer";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");
vi.mock("@/lib/tauri-commands", () => ({
  readBinaryFile: vi.fn().mockResolvedValue("iVBORw0KGgoAAAANSUhEUg=="),
}));

import { readBinaryFile } from "@/lib/tauri-commands";

describe("ImageViewer", () => {
  beforeEach(() => {
    vi.mocked(readBinaryFile).mockResolvedValue("iVBORw0KGgoAAAANSUhEUg==");
  });

  it("renders image with data URL after loading", async () => {
    render(<ImageViewer path="/photos/test.png" />);
    await waitFor(() => {
      const img = screen.getByRole("img");
      expect(img.getAttribute("src")).toContain("data:image/png;base64,");
    });
    expect(readBinaryFile).toHaveBeenCalledWith("/photos/test.png");
  });

  it("shows filename in header", () => {
    render(<ImageViewer path="/photos/test.png" />);
    expect(screen.getByText("test.png")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    render(<ImageViewer path="/photos/test.png" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error for failed load", async () => {
    vi.mocked(readBinaryFile).mockRejectedValue(new Error("file_too_large"));
    render(<ImageViewer path="/photos/huge.png" />);
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });

  it("does not render any comment UI", async () => {
    const { container } = render(<ImageViewer path="/photos/test.png" />);
    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });
    expect(container.querySelector(".comment-plus-btn")).toBeNull();
  });
});
```

- [ ] **Step 2: Rewrite ImageViewer to use readBinaryFile**

Replace `src/components/viewers/ImageViewer.tsx`:

```typescript
import { useState, useEffect } from "react";
import { readBinaryFile } from "@/lib/tauri-commands";
import { extname } from "@/lib/path-utils";

interface Props {
  path: string;
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

export function ImageViewer({ path }: Props) {
  const [fit, setFit] = useState(true);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filename = path.split(/[\\/]/).pop() || path;
  const mime = MIME_MAP[extname(path)] ?? "image/png";

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    setDimensions(null);
    readBinaryFile(path)
      .then((base64) => {
        if (!cancelled) setDataUrl(`data:${mime};base64,${base64}`);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => { cancelled = true; };
  }, [path, mime]);

  return (
    <div className="image-viewer" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="image-viewer-header" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: "1px solid var(--color-border, #d0d7de)", fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>{filename}</span>
        {dimensions && (
          <span style={{ color: "var(--color-muted, #656d76)" }}>
            {dimensions.w} × {dimensions.h}
          </span>
        )}
        <button
          onClick={() => setFit(!fit)}
          style={{ marginLeft: "auto", padding: "2px 8px", border: "1px solid var(--color-border, #d0d7de)", background: "var(--color-surface, #f6f8fa)", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
        >
          {fit ? "Original size" : "Fit to view"}
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 16 }}>
        {error && <div style={{ color: "var(--color-danger, #cf222e)", padding: 16 }}>Error loading image: {error}</div>}
        {!dataUrl && !error && <div style={{ color: "var(--color-muted, #656d76)", padding: 16 }}>Loading image…</div>}
        {dataUrl && (
          <img
            src={dataUrl}
            alt={filename}
            onLoad={(e) => {
              const img = e.currentTarget;
              setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            style={{
              maxWidth: fit ? "100%" : undefined,
              maxHeight: fit ? "100%" : undefined,
              objectFit: fit ? "contain" : undefined,
            }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/components/viewers/__tests__/ImageViewer.test.tsx`
Then: `npx vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/viewers/ImageViewer.tsx src/components/viewers/__tests__/ImageViewer.test.tsx
git commit -m "fix: load images via readBinaryFile instead of convertFileSrc

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Fix HTML Preview Image Loading

**Files:**
- Create: `src/lib/resolve-html-assets.ts`
- Create: `src/lib/__tests__/resolve-html-assets.test.ts`
- Modify: `src/components/viewers/HtmlPreviewView.tsx`
- Modify: `src/components/viewers/__tests__/HtmlPreviewView.test.tsx`
- Modify: `src/components/viewers/EnhancedViewer.tsx`

- [ ] **Step 1: Write tests for resolveLocalAssets**

Create `src/lib/__tests__/resolve-html-assets.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveLocalAssets } from "@/lib/resolve-html-assets";

vi.mock("@/lib/tauri-commands", () => ({
  readBinaryFile: vi.fn(),
}));

import { readBinaryFile } from "@/lib/tauri-commands";

describe("resolveLocalAssets", () => {
  beforeEach(() => {
    vi.mocked(readBinaryFile).mockResolvedValue("AAAA");
  });

  it("replaces relative img src with data URL", async () => {
    const html = '<img src="photo.png">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toContain("data:image/png;base64,AAAA");
    expect(result).not.toContain("photo.png");
  });

  it("resolves paths relative to HTML file directory", async () => {
    const html = '<img src="./images/cat.jpg">';
    await resolveLocalAssets(html, "/docs/page.html");
    expect(readBinaryFile).toHaveBeenCalledWith("/docs/images/cat.jpg");
  });

  it("leaves http URLs untouched", async () => {
    const html = '<img src="https://example.com/img.png">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toBe(html);
    expect(readBinaryFile).not.toHaveBeenCalled();
  });

  it("leaves data URLs untouched", async () => {
    const html = '<img src="data:image/png;base64,AAAA">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toBe(html);
  });

  it("handles multiple images", async () => {
    const html = '<img src="a.png"><img src="b.jpg">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toContain("data:image/png;base64,AAAA");
    expect(result).toContain("data:image/jpeg;base64,AAAA");
  });

  it("handles failed loads gracefully", async () => {
    vi.mocked(readBinaryFile).mockRejectedValue(new Error("not found"));
    const html = '<img src="missing.png">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toContain("missing.png");
  });
});
```

- [ ] **Step 2: Implement resolveLocalAssets**

Create `src/lib/resolve-html-assets.ts`:

```typescript
import { readBinaryFile } from "@/lib/tauri-commands";
import { dirname, extname } from "@/lib/path-utils";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".css": "text/css",
};

function isLocalPath(src: string): boolean {
  return !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:") && !src.startsWith("//");
}

function resolvePath(src: string, htmlDir: string): string {
  if (src.startsWith("/") || src.startsWith("\\") || /^[a-zA-Z]:/.test(src)) return src;
  // Remove leading ./
  const clean = src.replace(/^\.\//, "");
  return `${htmlDir}/${clean}`;
}

export async function resolveLocalAssets(html: string, htmlFilePath: string): Promise<string> {
  const htmlDir = dirname(htmlFilePath);
  const srcPattern = /(<img\b[^>]*?\bsrc=")([^"]+)(")/gi;

  const matches: { full: string; prefix: string; src: string; suffix: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = srcPattern.exec(html)) !== null) {
    if (isLocalPath(m[2])) {
      matches.push({ full: m[0], prefix: m[1], src: m[2], suffix: m[3], index: m.index });
    }
  }

  if (matches.length === 0) return html;

  const replacements = await Promise.all(
    matches.map(async ({ src }) => {
      const absPath = resolvePath(src, htmlDir);
      const mime = MIME_MAP[extname(absPath)] ?? "application/octet-stream";
      try {
        const base64 = await readBinaryFile(absPath);
        return `data:${mime};base64,${base64}`;
      } catch {
        return src; // keep original on failure
      }
    })
  );

  let result = html;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { prefix, suffix, index, full } = matches[i];
    result = result.slice(0, index) + prefix + replacements[i] + suffix + result.slice(index + full.length);
  }

  return result;
}
```

- [ ] **Step 3: Run resolveLocalAssets tests**

Run: `npx vitest run src/lib/__tests__/resolve-html-assets.test.ts`
Expected: All PASS

- [ ] **Step 4: Update HtmlPreviewView to accept filePath and resolve assets**

Replace `src/components/viewers/HtmlPreviewView.tsx`:

```typescript
import { useState, useEffect } from "react";
import { resolveLocalAssets } from "@/lib/resolve-html-assets";

interface Props {
  content: string;
  filePath?: string;
}

export function HtmlPreviewView({ content, filePath }: Props) {
  const [unsafeMode, setUnsafeMode] = useState(false);
  const [resolvedContent, setResolvedContent] = useState(content);
  const [resolving, setResolving] = useState(false);
  const sandbox = unsafeMode ? "allow-same-origin allow-scripts" : "allow-same-origin";

  useEffect(() => {
    if (!filePath) {
      setResolvedContent(content);
      return;
    }
    let cancelled = false;
    setResolving(true);
    resolveLocalAssets(content, filePath)
      .then((resolved) => {
        if (!cancelled) setResolvedContent(resolved);
      })
      .catch(() => {
        if (!cancelled) setResolvedContent(content);
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => { cancelled = true; };
  }, [content, filePath]);

  return (
    <div className="html-preview" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="html-preview-banner" style={{ padding: "6px 12px", background: "var(--color-warning-bg, #fff3cd)", borderBottom: "1px solid var(--color-warning-border, #ffc107)", fontSize: 12 }}>
        ⚠ Sandboxed preview — scripts and external resources disabled
        {resolving && <span style={{ marginLeft: 8 }}>⏳ Resolving local images…</span>}
        <button
          className="comment-btn"
          aria-label={unsafeMode ? "Disable scripts" : "Enable scripts"}
          onClick={() => setUnsafeMode(!unsafeMode)}
          style={{ marginLeft: 8 }}
        >
          {unsafeMode ? "Disable scripts" : "Enable scripts"}
        </button>
      </div>
      <iframe
        srcDoc={resolvedContent}
        sandbox={sandbox}
        title="HTML preview"
        style={{ width: "100%", border: "none", minHeight: 400, flex: 1, background: "white" }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Pass filePath through EnhancedViewer**

In `src/components/viewers/EnhancedViewer.tsx`, update the `renderVisualView` function's html case (line 77):

```typescript
    case "html":
      return <HtmlPreviewView content={content} filePath={filePath} />;
```

- [ ] **Step 6: Update HtmlPreviewView tests**

Replace `src/components/viewers/__tests__/HtmlPreviewView.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HtmlPreviewView } from "../HtmlPreviewView";

vi.mock("@/lib/resolve-html-assets", () => ({
  resolveLocalAssets: vi.fn((html: string) => Promise.resolve(html)),
}));

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
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/resolve-html-assets.ts src/lib/__tests__/resolve-html-assets.test.ts src/components/viewers/HtmlPreviewView.tsx src/components/viewers/__tests__/HtmlPreviewView.test.tsx src/components/viewers/EnhancedViewer.tsx
git commit -m "fix: resolve local images in HTML preview via readBinaryFile

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Code Folding — computeFoldRegions

**Files:**
- Create: `src/lib/fold-regions.ts`
- Create: `src/lib/__tests__/fold-regions.test.ts`

- [ ] **Step 1: Write fold region tests**

Create `src/lib/__tests__/fold-regions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeFoldRegions, type FoldRegion } from "@/lib/fold-regions";

describe("computeFoldRegions — brace matching", () => {
  it("detects simple brace block", () => {
    const lines = ["function foo() {", "  return 1;", "}"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([{ startLine: 1, endLine: 3 }]);
  });

  it("detects nested brace blocks", () => {
    const lines = ["if (x) {", "  if (y) {", "    z();", "  }", "}"];
    const regions = computeFoldRegions(lines);
    expect(regions).toContainEqual({ startLine: 1, endLine: 5 });
    expect(regions).toContainEqual({ startLine: 2, endLine: 4 });
  });

  it("ignores braces inside strings", () => {
    const lines = ['const s = "a { b";', "const t = 1;"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([]);
  });

  it("ignores braces inside comments", () => {
    const lines = ["// function foo() {", "const x = 1;"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([]);
  });

  it("detects bracket blocks", () => {
    const lines = ["const arr = [", "  1,", "  2,", "];"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([{ startLine: 1, endLine: 4 }]);
  });

  it("requires minimum 2 inner lines to fold", () => {
    const lines = ["{ }", "x"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([]);
  });
});

describe("computeFoldRegions — indentation", () => {
  it("detects indentation block in Python-like code", () => {
    const lines = ["def foo():", "  x = 1", "  y = 2", "z = 3"];
    const regions = computeFoldRegions(lines);
    expect(regions).toContainEqual({ startLine: 1, endLine: 3 });
  });

  it("detects nested indentation blocks", () => {
    const lines = ["class Foo:", "  def bar():", "    pass", "  def baz():", "    pass"];
    const regions = computeFoldRegions(lines);
    expect(regions).toContainEqual({ startLine: 1, endLine: 5 });
    expect(regions).toContainEqual({ startLine: 2, endLine: 3 });
    expect(regions).toContainEqual({ startLine: 4, endLine: 5 });
  });

  it("skips blank lines in indentation tracking", () => {
    const lines = ["def foo():", "  x = 1", "", "  y = 2", "z = 3"];
    const regions = computeFoldRegions(lines);
    expect(regions).toContainEqual({ startLine: 1, endLine: 4 });
  });

  it("returns empty for flat file", () => {
    const lines = ["a", "b", "c"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement computeFoldRegions**

Create `src/lib/fold-regions.ts`:

```typescript
export interface FoldRegion {
  startLine: number; // 1-based
  endLine: number;   // 1-based, inclusive
}

const OPENERS: Record<string, string> = { "{": "}", "[": "]", "(": ")" };
const CLOSERS = new Set(["}", "]", ")"]);

// Strip strings and comments, return only structural characters
function stripStringsAndComments(line: string): string {
  let result = "";
  let inString: string | null = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inString) {
      if (ch === "\\" && i + 1 < line.length) { i += 2; continue; }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; i++; continue; }
    if (ch === "/" && i + 1 < line.length && line[i + 1] === "/") break; // line comment
    result += ch;
    i++;
  }
  return result;
}

function computeBraceRegions(lines: string[]): FoldRegion[] {
  const regions: FoldRegion[] = [];
  const stack: { char: string; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const stripped = stripStringsAndComments(lines[i]);
    for (const ch of stripped) {
      if (OPENERS[ch]) {
        stack.push({ char: ch, line: i + 1 });
      } else if (CLOSERS.has(ch)) {
        // Find matching opener
        for (let j = stack.length - 1; j >= 0; j--) {
          if (OPENERS[stack[j].char] === ch) {
            const start = stack[j].line;
            const end = i + 1;
            stack.splice(j, 1);
            if (end - start >= 2) {
              regions.push({ startLine: start, endLine: end });
            }
            break;
          }
        }
      }
    }
  }

  return regions;
}

function getIndent(line: string): number {
  const m = /^(\s*)/.exec(line);
  if (!m) return 0;
  let count = 0;
  for (const ch of m[1]) {
    count += ch === "\t" ? 4 : 1;
  }
  return count;
}

function computeIndentRegions(lines: string[]): FoldRegion[] {
  const regions: FoldRegion[] = [];
  const indents = lines.map((l) => l.trim() === "" ? -1 : getIndent(l));

  for (let i = 0; i < lines.length; i++) {
    if (indents[i] < 0) continue; // skip blank
    const baseIndent = indents[i];

    // Check if next non-blank line has deeper indent
    let nextNonBlank = i + 1;
    while (nextNonBlank < lines.length && indents[nextNonBlank] < 0) nextNonBlank++;
    if (nextNonBlank >= lines.length || indents[nextNonBlank] <= baseIndent) continue;

    // Find end of indented block
    let end = nextNonBlank;
    for (let j = nextNonBlank + 1; j < lines.length; j++) {
      if (indents[j] < 0) continue; // skip blank
      if (indents[j] <= baseIndent) break;
      end = j;
    }

    if (end > i) {
      regions.push({ startLine: i + 1, endLine: end + 1 });
    }
  }

  return regions;
}

export function computeFoldRegions(lines: string[]): FoldRegion[] {
  const braceRegions = computeBraceRegions(lines);
  // Use brace regions if we found some; otherwise fall back to indentation
  if (braceRegions.length >= 1) {
    return braceRegions;
  }
  return computeIndentRegions(lines);
}
```

- [ ] **Step 3: Run fold region tests**

Run: `npx vitest run src/lib/__tests__/fold-regions.test.ts`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/fold-regions.ts src/lib/__tests__/fold-regions.test.ts
git commit -m "feat: add fold region computation for code folding

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Code Folding — SourceView Integration

**Files:**
- Modify: `src/components/viewers/SourceView.tsx`
- Modify: `src/styles/source-viewer.css`

- [ ] **Step 1: Add fold styles to source-viewer.css**

Append to `src/styles/source-viewer.css`:

```css
/* ── Code folding ──────────────────────────────────────────────── */

.source-line-fold-toggle {
  font-size: 10px;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  margin-top: 3px;
}

.source-line-fold-toggle:hover {
  background: var(--color-hover);
  color: var(--color-text);
}

.source-line-fold-zone {
  width: 14px;
  min-width: 14px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.source-fold-placeholder {
  display: flex;
  min-height: 20px;
  line-height: 20px;
  padding-left: 74px;
  color: var(--color-muted);
  background: var(--color-surface);
  border-top: 1px dashed var(--color-border);
  border-bottom: 1px dashed var(--color-border);
  font-size: 12px;
  font-style: italic;
  cursor: pointer;
}

.source-fold-placeholder:hover {
  background: var(--color-hover);
}
```

- [ ] **Step 2: Update gutter to include fold zone**

Update the `.source-line-gutter` width in CSS to 74px (20px comment + 14px fold + 40px number):

```css
.source-line-gutter {
  display: flex;
  align-items: flex-start;
  width: 74px;
  min-width: 74px;
  color: var(--color-muted);
  user-select: none;
  position: sticky;
  left: 0;
  background: var(--color-bg);
  z-index: 1;
}
```

Also update `.line-comment-section` padding-left from 68px to 82px to account for wider gutter:

```css
.line-comment-section {
  padding: 4px 12px 4px 82px;
  ...
}
```

- [ ] **Step 3: Integrate folding into SourceView**

In `src/components/viewers/SourceView.tsx`:

1. Add import: `import { computeFoldRegions, type FoldRegion } from "@/lib/fold-regions";`
2. Add state: `const [collapsedLines, setCollapsedLines] = useState<Set<number>>(new Set());`
3. Memoize fold regions: `const foldRegions = useMemo(() => computeFoldRegions(lines), [content]);`
4. Build lookup: `const foldStartMap = useMemo(() => { const m = new Map<number, FoldRegion>(); foldRegions.forEach(r => { if (!m.has(r.startLine) || m.get(r.startLine)!.endLine < r.endLine) m.set(r.startLine, r); }); return m; }, [foldRegions]);`
5. Reset collapsed state on file change: add `useEffect(() => { setCollapsedLines(new Set()); }, [filePath]);`

Update the line rendering to:
- Skip lines that fall inside a collapsed region
- Show fold chevron for lines that start a region
- Show a `⋯ N lines hidden` placeholder after collapsed lines

Replace the `lines.map(...)` block:

```tsx
{(() => {
  const rendered: React.ReactNode[] = [];
  let skipUntil = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;

    if (lineNum <= skipUntil) continue;

    const foldRegion = foldStartMap.get(lineNum);
    const isCollapsed = foldRegion && collapsedLines.has(lineNum);

    if (isCollapsed && foldRegion) {
      // Render the start line + placeholder
      rendered.push(renderLine(idx, lineNum, foldRegion, true));
      const hiddenCount = foldRegion.endLine - foldRegion.startLine - 1;
      rendered.push(
        <div
          key={`fold-${lineNum}`}
          className="source-fold-placeholder"
          onClick={() => toggleFold(lineNum)}
        >
          ⋯ {hiddenCount} line{hiddenCount !== 1 ? "s" : ""} hidden
        </div>
      );
      skipUntil = foldRegion.endLine - 1; // skip inner lines, render close line
      continue;
    }

    rendered.push(renderLine(idx, lineNum, foldRegion ?? null, false));
  }
  return rendered;
})()}
```

Add helper functions inside the component:

```typescript
const toggleFold = (lineNum: number) => {
  setCollapsedLines((prev) => {
    const next = new Set(prev);
    if (next.has(lineNum)) next.delete(lineNum);
    else next.add(lineNum);
    return next;
  });
};

function renderLine(idx: number, lineNum: number, foldRegion: FoldRegion | null, isCollapsed: boolean) {
  const line = lines[idx];
  const lineHash = fnv1a8(line.trim());
  const lineComments = (comments ?? []).filter(
    (c) => c.anchorType === "line" && c.lineHash === lineHash
  );
  return (
    <div key={idx}>
      <div className="source-line">
        <span className="source-line-gutter">
          <span className="source-line-comment-zone">
            <button
              className="comment-plus-btn"
              aria-label="Add comment"
              onClick={() => setCommentingLine(commentingLine === lineNum ? null : lineNum)}
            >
              +
            </button>
          </span>
          <span className="source-line-fold-zone">
            {foldRegion && (
              <button
                className="source-line-fold-toggle"
                aria-label={isCollapsed ? "Expand" : "Collapse"}
                onClick={() => toggleFold(lineNum)}
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
            )}
          </span>
          <span className="source-line-number-zone">{lineNum}</span>
        </span>
        <span
          className="source-line-content"
          dangerouslySetInnerHTML={{
            __html: highlightedLines[idx]
              ? extractInnerCode(highlightedLines[idx])
              : escapeHtml(line),
          }}
        />
      </div>
      {(commentingLine === lineNum || lineComments.length > 0) && (
        <LineCommentMargin
          filePath={filePath}
          lineNumber={lineNum}
          lineHash={lineHash}
          showInput={commentingLine === lineNum}
          onCloseInput={() => setCommentingLine(null)}
        />
      )}
    </div>
  );
}
```

Add `useMemo` to imports.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/viewers/SourceView.tsx src/styles/source-viewer.css
git commit -m "feat: add code folding to source view

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: In-File Search — useSearch Hook

**Files:**
- Create: `src/hooks/useSearch.ts`
- Create: `src/hooks/__tests__/useSearch.test.ts`

- [ ] **Step 1: Write useSearch tests**

Create `src/hooks/__tests__/useSearch.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSearch } from "../useSearch";

describe("useSearch", () => {
  it("returns empty matches for empty query", () => {
    const { result } = renderHook(() => useSearch("hello world"));
    expect(result.current.matches).toEqual([]);
    expect(result.current.currentIndex).toBe(-1);
  });

  it("finds all matches case-insensitively", () => {
    const { result } = renderHook(() => useSearch("foo bar Foo BAR foo"));
    act(() => result.current.setQuery("foo"));
    expect(result.current.matches).toHaveLength(3);
    expect(result.current.matches[0]).toEqual({ lineIndex: 0, startCol: 0, endCol: 3 });
    expect(result.current.matches[1]).toEqual({ lineIndex: 0, startCol: 8, endCol: 11 });
    expect(result.current.matches[2]).toEqual({ lineIndex: 0, startCol: 16, endCol: 19 });
    expect(result.current.currentIndex).toBe(0);
  });

  it("finds matches across multiple lines", () => {
    const { result } = renderHook(() => useSearch("line1 x\nline2 x\nline3"));
    act(() => result.current.setQuery("x"));
    expect(result.current.matches).toHaveLength(2);
    expect(result.current.matches[0].lineIndex).toBe(0);
    expect(result.current.matches[1].lineIndex).toBe(1);
  });

  it("navigates forward with next()", () => {
    const { result } = renderHook(() => useSearch("a a a"));
    act(() => result.current.setQuery("a"));
    expect(result.current.currentIndex).toBe(0);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(1);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(2);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(0); // wraps
  });

  it("navigates backward with prev()", () => {
    const { result } = renderHook(() => useSearch("a a a"));
    act(() => result.current.setQuery("a"));
    act(() => result.current.prev());
    expect(result.current.currentIndex).toBe(2); // wraps back
  });

  it("resets currentIndex when query changes", () => {
    const { result } = renderHook(() => useSearch("foo bar"));
    act(() => result.current.setQuery("foo"));
    act(() => result.current.next());
    act(() => result.current.setQuery("bar"));
    expect(result.current.currentIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Implement useSearch**

Create `src/hooks/useSearch.ts`:

```typescript
import { useState, useMemo, useCallback } from "react";

export interface SearchMatch {
  lineIndex: number;
  startCol: number;
  endCol: number;
}

export function useSearch(content: string) {
  const [query, setQueryRaw] = useState("");
  const [currentIndex, setCurrentIndex] = useState(-1);

  const matches = useMemo(() => {
    if (!query) return [];
    const results: SearchMatch[] = [];
    const lines = content.split("\n");
    const lowerQuery = query.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const lowerLine = lines[i].toLowerCase();
      let pos = 0;
      while (pos <= lowerLine.length - lowerQuery.length) {
        const idx = lowerLine.indexOf(lowerQuery, pos);
        if (idx === -1) break;
        results.push({ lineIndex: i, startCol: idx, endCol: idx + query.length });
        pos = idx + 1;
      }
    }
    return results;
  }, [content, query]);

  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setCurrentIndex(q ? 0 : -1);
  }, []);

  const next = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  return { query, setQuery, matches, currentIndex, next, prev };
}
```

- [ ] **Step 3: Run useSearch tests**

Run: `npx vitest run src/hooks/__tests__/useSearch.test.ts`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSearch.ts src/hooks/__tests__/useSearch.test.ts
git commit -m "feat: add useSearch hook for in-file text search

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: In-File Search — SearchBar Component and SourceView Integration

**Files:**
- Create: `src/components/viewers/SearchBar.tsx`
- Create: `src/styles/search-bar.css`
- Create: `src/components/viewers/__tests__/SearchBar.test.tsx`
- Modify: `src/components/viewers/SourceView.tsx`

- [ ] **Step 1: Write SearchBar tests**

Create `src/components/viewers/__tests__/SearchBar.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchBar } from "../SearchBar";

describe("SearchBar", () => {
  it("renders input and match count", () => {
    render(<SearchBar query="foo" matchCount={5} currentIndex={2} onQueryChange={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText("Find...")).toHaveValue("foo");
    expect(screen.getByText("3 of 5")).toBeInTheDocument();
  });

  it("shows 'No results' when matchCount is 0 and query is non-empty", () => {
    render(<SearchBar query="xyz" matchCount={0} currentIndex={-1} onQueryChange={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("calls onQueryChange on input", () => {
    const onChange = vi.fn();
    render(<SearchBar query="" matchCount={0} currentIndex={-1} onQueryChange={onChange} onNext={vi.fn()} onPrev={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Find..."), { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("calls onNext on Enter, onPrev on Shift+Enter", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(<SearchBar query="a" matchCount={3} currentIndex={0} onQueryChange={vi.fn()} onNext={onNext} onPrev={onPrev} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("Find...");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNext).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onPrev).toHaveBeenCalled();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<SearchBar query="" matchCount={0} currentIndex={-1} onQueryChange={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByPlaceholderText("Find..."), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement SearchBar**

Create `src/components/viewers/SearchBar.tsx`:

```typescript
import { useRef, useEffect } from "react";
import "@/styles/search-bar.css";

interface Props {
  query: string;
  matchCount: number;
  currentIndex: number;
  onQueryChange: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function SearchBar({ query, matchCount, currentIndex, onQueryChange, onNext, onPrev, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        type="text"
        className="search-bar-input"
        placeholder="Find..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="search-bar-count">
        {query && matchCount > 0 && `${currentIndex + 1} of ${matchCount}`}
        {query && matchCount === 0 && <span className="search-bar-no-results">No results</span>}
      </span>
      <button className="search-bar-btn" onClick={onPrev} aria-label="Previous match" disabled={matchCount === 0}>▲</button>
      <button className="search-bar-btn" onClick={onNext} aria-label="Next match" disabled={matchCount === 0}>▼</button>
      <button className="search-bar-btn" onClick={onClose} aria-label="Close search">✕</button>
    </div>
  );
}
```

Create `src/styles/search-bar.css`:

```css
.search-bar {
  position: absolute;
  top: 4px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--color-surface, #f6f8fa);
  border: 1px solid var(--color-border, #d0d7de);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  z-index: 10;
  font-size: 13px;
}

.search-bar-input {
  border: 1px solid var(--color-border, #d0d7de);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 13px;
  width: 200px;
  outline: none;
  font-family: inherit;
  background: var(--color-bg, #fff);
  color: var(--color-text, #1f2328);
}

.search-bar-input:focus {
  border-color: var(--color-accent, #0969da);
}

.search-bar-count {
  font-size: 12px;
  color: var(--color-muted, #656d76);
  min-width: 60px;
  text-align: center;
}

.search-bar-no-results {
  color: var(--color-danger, #cf222e);
}

.search-bar-btn {
  border: none;
  background: none;
  cursor: pointer;
  padding: 2px 6px;
  font-size: 12px;
  color: var(--color-muted, #656d76);
  border-radius: 3px;
}

.search-bar-btn:hover:not(:disabled) {
  background: var(--color-hover, #f3f4f6);
  color: var(--color-text, #1f2328);
}

.search-bar-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* Search highlights in source lines */
.search-match {
  background: var(--color-search-match, #fff59d);
  border-radius: 2px;
}

.search-match-current {
  background: var(--color-search-current, #ffb74d);
  border-radius: 2px;
}
```

- [ ] **Step 3: Integrate search into SourceView**

In `src/components/viewers/SourceView.tsx`:

1. Add imports:
```typescript
import { useSearch, type SearchMatch } from "@/hooks/useSearch";
import { SearchBar } from "./SearchBar";
```

2. Add search state:
```typescript
const [searchOpen, setSearchOpen] = useState(false);
const { query, setQuery, matches, currentIndex, next, prev } = useSearch(content);
```

3. Add Ctrl+F keyboard handler:
```typescript
useEffect(() => {
  function onKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      setSearchOpen(true);
    }
  }
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, []);
```

4. Build a match lookup for rendering: `matchesByLine`:
```typescript
const matchesByLine = useMemo(() => {
  const map = new Map<number, { match: SearchMatch; isCurrent: boolean }[]>();
  matches.forEach((m, i) => {
    const arr = map.get(m.lineIndex) ?? [];
    arr.push({ match: m, isCurrent: i === currentIndex });
    map.set(m.lineIndex, arr);
  });
  return map;
}, [matches, currentIndex]);
```

5. Create a function to highlight matches in a line's HTML:
```typescript
function highlightSearchInLine(lineHtml: string, lineIdx: number): string {
  const lineMatches = matchesByLine.get(lineIdx);
  if (!lineMatches || !query) return lineHtml;
  // For plain text (no highlighting), wrap matches in <mark>
  // For highlighted HTML, we apply on the raw text of the line
  const line = lines[lineIdx];
  const parts: string[] = [];
  let last = 0;
  for (const { match, isCurrent } of lineMatches) {
    parts.push(escapeHtml(line.slice(last, match.startCol)));
    const cls = isCurrent ? "search-match-current" : "search-match";
    parts.push(`<mark class="${cls}">${escapeHtml(line.slice(match.startCol, match.endCol))}</mark>`);
    last = match.endCol;
  }
  parts.push(escapeHtml(line.slice(last)));
  return parts.join("");
}
```

6. In the `renderLine` function, when search is active and there are matches on this line, use `highlightSearchInLine` instead of the Shiki output:
```typescript
const hasSearchMatch = query && matchesByLine.has(idx);
// ...
dangerouslySetInnerHTML={{
  __html: hasSearchMatch
    ? highlightSearchInLine("", idx)
    : highlightedLines[idx]
      ? extractInnerCode(highlightedLines[idx])
      : escapeHtml(line),
}}
```

7. Add SearchBar overlay at the top of `.source-view`:
```tsx
<div className={`source-view${wordWrap ? " wrap-enabled" : ""}`} style={{ position: "relative" }}>
  {searchOpen && (
    <SearchBar
      query={query}
      matchCount={matches.length}
      currentIndex={currentIndex}
      onQueryChange={setQuery}
      onNext={next}
      onPrev={prev}
      onClose={() => { setSearchOpen(false); setQuery(""); }}
    />
  )}
  ...
```

8. Auto-scroll current match into view:
```typescript
useEffect(() => {
  if (currentIndex >= 0 && matches[currentIndex]) {
    const lineNum = matches[currentIndex].lineIndex + 1;
    const el = document.querySelector(`.source-line:nth-child(${lineNum})`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}, [currentIndex, matches]);
```

- [ ] **Step 4: Run SearchBar tests**

Run: `npx vitest run src/components/viewers/__tests__/SearchBar.test.tsx`
Expected: All PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/viewers/SearchBar.tsx src/styles/search-bar.css src/components/viewers/__tests__/SearchBar.test.tsx src/components/viewers/SourceView.tsx
git commit -m "feat: add Ctrl+F search with highlight and navigation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Test Fixture Files

**Files:**
- Create: `e2e/fixtures/sample.mermaid`
- Create: `e2e/fixtures/sample.py`
- Create: `e2e/fixtures/sample.yaml`
- Create: `e2e/fixtures/sample-with-images.html`

- [ ] **Step 1: Create fixture files**

`e2e/fixtures/sample.mermaid`:
```
graph TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B
```

`e2e/fixtures/sample.py`:
```python
class Calculator:
    def __init__(self):
        self.history = []

    def add(self, a, b):
        result = a + b
        self.history.append(result)
        return result

    def clear(self):
        self.history = []

def main():
    calc = Calculator()
    print(calc.add(1, 2))

if __name__ == "__main__":
    main()
```

`e2e/fixtures/sample.yaml`:
```yaml
project:
  name: mDown reView
  version: 1.0.0
  features:
    - markdown viewing
    - syntax highlighting
    - review comments
  settings:
    theme: auto
    fontSize: 14
    wordWrap: false
```

`e2e/fixtures/sample-with-images.html`:
```html
<!DOCTYPE html>
<html>
<head><title>Page with Images</title></head>
<body>
  <h1>Image Test</h1>
  <p>This page references a local image:</p>
  <img src="sample.png" alt="Test image" width="100">
  <p>And an external image (should stay as-is):</p>
  <img src="https://via.placeholder.com/100" alt="Placeholder">
</body>
</html>
```

- [ ] **Step 2: Create a minimal PNG file**

Create `e2e/fixtures/sample.png` — a 1×1 red pixel PNG. Use Node.js to write the minimal binary:

```bash
node -e "const fs = require('fs'); fs.writeFileSync('e2e/fixtures/sample.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64'));"
```

- [ ] **Step 3: Commit**

```bash
git add e2e/fixtures/sample.mermaid e2e/fixtures/sample.py e2e/fixtures/sample.yaml e2e/fixtures/sample-with-images.html e2e/fixtures/sample.png
git commit -m "test: add fixture files for mermaid, python, yaml, html, png

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Final Validation

- [ ] **Step 1: Run unit tests**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 2: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: All PASS

- [ ] **Step 3: Run E2E tests**

Run: `npm run test:e2e`
Expected: All PASS
