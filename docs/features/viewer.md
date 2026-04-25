# Viewer

## What it is

mdownreview renders the selected workspace file in the reading pane. It handles markdown (with GFM + Mermaid), source code with syntax highlighting and folding, structured formats (JSON, CSV, KQL plans, HTML), images, and binary files — and also knows how to show an orphaned comments view when the underlying file has been deleted.

## How it works

`ViewerRouter` inspects the file extension and routing hints (including "ghost" state from the watcher) and mounts the appropriate concrete viewer. Each concrete viewer reads content via `useFileContent`, which calls the single Rust IPC command (chokepoint: rule 1 in [`docs/architecture.md`](../architecture.md)) and applies size/binary guards.

Markdown goes through a hardened `react-markdown` pipeline: `remark-gfm` + `rehype-raw` + `rehype-sanitize(sanitizeSchema)` + `rehype-slug` + `rehype-autolink-headings` + `@shikijs/rehype`. Plugin order is load-bearing — sanitization happens between raw HTML re-parse and any downstream plugin that injects elements, so user HTML cannot piggy-back through (rule 12 in [`docs/security.md`](../security.md)). Source files go through `SourceView`, which adds line-based comment anchors, fold regions, and a local search bar. Mermaid diagrams lazy-load the Mermaid renderer through `MermaidView` so the app startup stays within the [performance budget](../performance.md), and embedded ` ```mermaid ` fenced blocks render inline through the same lazy chunk.

Remote `<img>` references are gated: the markdown viewer detects `![…](https://…)` or raw `<img src="https…">` (excluding code fences/inline ticks) and shows an "Allow remote images for this document" banner. Until the user opts in via `viewerPrefsSlice.allowRemoteImagesForDoc`, every remote image renders as a `RemoteImagePlaceholder`. Once allowed, the bytes flow through the bounded `fetch_remote_asset` Rust command (https-only, 8 MB cap, 10 s timeout, `image/*` allowlist, redirect policy capped at 5 https-only hops, semaphore-capped concurrency — rule 27 in [`docs/security.md`](../security.md)) and become `blob:` URLs, leaving the CSP `img-src` intact.

The markdown anchor handler classifies clicks into four cases: in-document `#anchor` (browser default), `javascript:`/`file:`/`data:`/`vbscript:` (dropped + warned), external `http(s)`/`mailto`/`tel` (delegated to the OS opener via `openExternalUrl`), and workspace-relative paths (resolved through `resolveWorkspacePath` for containment, then `useStore.openFile`). The HTML preview iframe applies the same four-case routing inside the safe-mode iframe.

A single Shiki highlighter instance is shared across viewers — see the Shiki singleton rule in [`docs/design-patterns.md`](../design-patterns.md). The table of contents, selection toolbar, and viewer toolbar are composable overlays, not viewer-specific code.

Markdown and HTML preview render inside a centred `.reading-width` column whose width is clamped to `--reading-width` (default 720 px, persisted in `uiSlice.readingWidth`, clamped to `[400, 1600]` by `setReadingWidth`). The viewer toolbar (Source / Visual / Wrap) is sticky-positioned at the top of its scroll container so it stays in view while the body scrolls. Two `ReadingWidthHandle` instances (left and right edges) let the user drag either side of the column outward to grow width symmetrically — a centred-column resize, not an asymmetric drag. The handle writes `--reading-width` to the container during pointermove (no React re-renders mid-drag) and only commits to the Zustand store on pointerup, so the resize stays at 60 fps regardless of body size.

```mermaid
flowchart TD
    File["selected file<br/>(path + watcher status)"] --> Router{"ViewerRouter"}
    Router -- "ghost: deleted on disk,<br/>orphaned comments" --> DV["DeletedFileViewer"]
    Router -- ".md / .mdx" --> MV["MarkdownViewer<br/>(react-markdown + Shiki)"]
    Router -- "Mermaid block / file" --> MM["MermaidView<br/>(lazy-loaded, securityLevel: strict)"]
    Router -- ".json" --> JT["JsonTreeView"]
    Router -- ".csv" --> CT["CsvTableView"]
    Router -- ".html" --> HV["HtmlPreviewView"]
    Router -- "image" --> IV["ImageViewer<br/>(via convertFileSrc)"]
    Router -- "other text<br/>(.ts, .rs, .py, …)" --> SV["SourceView<br/>(line anchors + folding + search)"]
    Router -- "binary or > 10 MB" --> BP["BinaryPlaceholder"]
```

## Key source

- **Router:** `src/components/viewers/ViewerRouter.tsx`
- **Concrete viewers:** `src/components/viewers/{MarkdownViewer,SourceView,EnhancedViewer,MermaidView,JsonTreeView,CsvTableView,HtmlPreviewView,KqlPlanView,ImageViewer,BinaryPlaceholder,DeletedFileViewer}.tsx`
- **Markdown helpers:** `src/components/viewers/markdown/{sanitizeSchema,RemoteImagePlaceholder,useImgResolver,CommentableBlocks}.tsx`
- **Overlays:** `src/components/viewers/{TableOfContents,SearchBar,ViewerToolbar,FrontmatterBlock,SkeletonLoader,ReadingWidthHandle}.tsx`
- **State:** `src/store/viewerPrefs.ts` (per-document remote-image allowance, session-only)
- **Hooks:** `src/hooks/{useFileContent,useSourceHighlighting,useFolding,useScrollToLine,useSearch}.ts`
- **Rust backend:** `src-tauri/src/commands/fs.rs` (`read_text_file`, `read_binary_file`, `check_path_exists`), `src-tauri/src/commands/remote_asset.rs` (bounded HTTPS image proxy)

## Related rules

- File-size budgets and viewer layering — [`docs/architecture.md`](../architecture.md) §Component & viewer boundaries, §File-size budgets.
- Render-cost and Shiki singleton — [`docs/design-patterns.md`](../design-patterns.md) + [`docs/performance.md`](../performance.md).
- Markdown XSS posture (`rehype-raw` + `rehype-sanitize` pairing, Mermaid sandboxing) — rule 12 in [`docs/security.md`](../security.md).
- Bounded remote-asset fetcher — rule 27 in [`docs/security.md`](../security.md).
- UI-visible viewer changes require browser e2e in `e2e/browser/` — rule 7 in [`docs/test-strategy.md`](../test-strategy.md).
