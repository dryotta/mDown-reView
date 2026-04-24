import { extname } from "@/lib/path-utils";

export type FileCategory =
  | "markdown"
  | "json"
  | "csv"
  | "html"
  | "mermaid"
  | "kql"
  | "image"
  | "text";

const CATEGORY_MAP: Record<string, FileCategory> = {
  ".md": "markdown",
  ".mdx": "markdown",
  ".json": "json",
  ".jsonc": "json",
  ".csv": "csv",
  ".tsv": "csv",
  ".html": "html",
  ".htm": "html",
  ".mermaid": "mermaid",
  ".mmd": "mermaid",
  ".kql": "kql",
  ".csl": "kql",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".svg": "image",
  ".webp": "image",
  ".bmp": "image",
  ".ico": "image",
};

const VISUALIZABLE: Set<FileCategory> = new Set([
  "markdown",
  "json",
  "csv",
  "html",
  "mermaid",
  "kql",
]);

const DEFAULT_VIEW: Record<FileCategory, "source" | "visual"> = {
  markdown: "visual",
  json: "visual",
  csv: "visual",
  html: "source",
  mermaid: "visual",
  kql: "visual",
  image: "visual",
  text: "source",
};

export function getFileCategory(path: string): FileCategory {
  const ext = extname(path);
  return CATEGORY_MAP[ext] ?? "text";
}

export function hasVisualization(category: FileCategory): boolean {
  return VISUALIZABLE.has(category);
}

export function getDefaultView(category: FileCategory): "source" | "visual" {
  return DEFAULT_VIEW[category];
}

// Map file extension → Shiki language id. The same ids are also accepted by
// the Rust fold-region detector (`src-tauri/src/core/fold_regions.rs`), which
// recognises both `python`/`py` and `yaml`/`yml` for its indent-language hint,
// so this single table serves both syntax highlighting and folding.
const SHIKI_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", rs: "rust", go: "go", java: "java",
  c: "c", cpp: "cpp", h: "c", css: "css", html: "html",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  sh: "bash", bash: "bash", md: "markdown", sql: "sql",
  rb: "ruby", php: "php", swift: "swift", kt: "kotlin", cs: "csharp",
  xml: "xml", kql: "kql", csl: "kql",
};

export function getShikiLanguage(path: string): string {
  const ext = extname(path).slice(1);
  return SHIKI_LANGUAGE_MAP[ext] ?? "text";
}

// Fold-region language hint. Currently identical to the Shiki id space — the
// Rust side only inspects the value to decide between brace- and indent-based
// folding and accepts the Shiki names. Kept as a separate export so future
// divergence has an obvious seam.
export function getFoldLanguage(path: string): string {
  return getShikiLanguage(path);
}
